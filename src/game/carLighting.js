/**
 * Shared car lamp lighting (from the kitchen scene): the head / tail lamp spot
 * lights attached to the car and aimed at the table, and the table glows under
 * the lamps (a textured headlight beam plus tail, brake and light bar glows;
 * the brake glow brightens while braking). Used by the kitchen (the player's
 * car and the race cars) and the office copy.
 */

/** Table glows per lamp mesh: tint, base size, kind. */
export const CAR_LAMP_GLOW_SPECS = [
  { name: "frontLights", color: 0xffffff, size: 0.44, kind: "front" },
  { name: "rearLights", color: 0xff3333, size: 0.36, kind: "rear" },
  { name: "mainRearBrakeLights", color: 0xff0000, size: 0.4, kind: "brake" },
];
/** Light bar glow (one per lightBar1 mesh). */
export const CAR_LIGHT_BAR_GLOW = { color: 0xff2222, size: 0.24 };
/**
 * Glow strength by kind (brake: on / off). bar: the light bar's red glow on the
 * table under it (one per lightBar1 mesh, so 5 stacked under each car) — off
 * (was 0.38): the light bar glows through the bloom only, not on the table.
 */
export const CAR_LAMP_GLOW_ALPHA = { front: 0.08, rear: 0.52, brakeOn: 0.92, brakeOff: 0.18, bar: 0 };
/** Headlight beam texture's width / length. */
export const HEADLIGHT_BEAM_ASPECT = 652 / 326;
/** Lamp spot lights: colour, intensity, reach (× car length), cone; shared penumbra / decay. */
export const CAR_LAMP_SPOTS = {
  front: { color: 0xfff1d0, intensity: 6.2, reach: 3.4, angle: Math.PI / 3.15 },
  rear: { color: 0xff2a2a, intensity: 2.4, reach: 3.4 * 0.72, angle: Math.PI / 5.2 },
  penumbra: 0.78,
  decay: 1.45,
};

/**
 * @param {object} o
 * @param {typeof import("three")} o.THREE
 * @param {import("three").Scene} o.scene      glows are added here
 * @param {string} o.beamTextureUrl            headlight beam texture
 * @param {number|null} [o.stencilRef]         draw glows only where the table wrote this stencil value (null: no mask)
 */
export function createCarLighting({ THREE, scene, beamTextureUrl, stencilRef = null }) {
  let glowTex = null;
  let beamTex = null;
  let glowGeo = null;
  let beamGeo = null;
  const _corner = new THREE.Vector3();
  const _point = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _box = new THREE.Box3();
  const _tableLocal = new THREE.Vector3();

  function getGlowTexture() {
    if (glowTex) return glowTex;
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.28, "rgba(255,255,255,0.42)");
    g.addColorStop(0.62, "rgba(255,255,255,0.08)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    glowTex = new THREE.CanvasTexture(c);
    glowTex.needsUpdate = true;
    return glowTex;
  }

  function getBeamGeometry() {
    if (beamGeo) return beamGeo;
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const uv = geometry.attributes.uv;
    const pos = geometry.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, pos.getZ(i) + 0.5, pos.getX(i) + 0.5);
    }
    uv.needsUpdate = true;
    beamGeo = geometry;
    return beamGeo;
  }

  function getBeamTexture() {
    if (beamTex) return beamTex;
    const loader = new THREE.TextureLoader();
    beamTex = loader.load(beamTextureUrl);
    beamTex.wrapS = THREE.ClampToEdgeWrapping;
    beamTex.wrapT = THREE.ClampToEdgeWrapping;
    beamTex.anisotropy = 8;
    return beamTex;
  }

  /** A flat additive glow on the table (the headlight beam for kind "front"). */
  function createTableLightGlowSprite(tint, baseSize, kind = "") {
    if (!glowGeo) {
      glowGeo = new THREE.PlaneGeometry(1, 1);
      glowGeo.rotateX(-Math.PI / 2);
    }
    const params = {
      map: kind === "front" ? getBeamTexture() : getGlowTexture(),
      color: kind === "front" ? 0xffffff : tint,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    };
    if (stencilRef != null) {
      Object.assign(params, {
        stencilWrite: true,
        stencilWriteMask: 0x00,
        stencilRef,
        stencilFunc: THREE.EqualStencilFunc,
        stencilFail: THREE.KeepStencilOp,
        stencilZFail: THREE.KeepStencilOp,
        stencilZPass: THREE.KeepStencilOp,
      });
    }
    const mat = new THREE.MeshBasicMaterial(params);
    const glowPlane = new THREE.Mesh(kind === "front" ? getBeamGeometry() : glowGeo, mat);
    glowPlane.scale.set(baseSize, 1, baseSize * 0.72);
    glowPlane.visible = false;
    glowPlane.renderOrder = 4;
    scene.add(glowPlane);
    return glowPlane;
  }

  /** Table glows of a car's lamps, pushed into `list`. */
  function setupTableLightReflections(carRoot, list) {
    for (let si = 0; si < CAR_LAMP_GLOW_SPECS.length; si++) {
      const spec = CAR_LAMP_GLOW_SPECS[si];
      const mesh = carRoot.getObjectByName(spec.name);
      if (!mesh) continue;
      if (spec.kind === "front") {
        list.push({
          mesh,
          sprite: createTableLightGlowSprite(spec.color, spec.size, spec.kind),
          kind: spec.kind,
          baseSize: spec.size,
          side: 0,
        });
        continue;
      }
      for (let side = -1; side <= 1; side += 2) {
        list.push({
          mesh,
          sprite: createTableLightGlowSprite(spec.color, spec.size * 0.72, spec.kind),
          kind: spec.kind,
          baseSize: spec.size * 0.72,
          side,
        });
      }
    }
    carRoot.traverse((node) => {
      if (CAR_LAMP_GLOW_ALPHA.bar < 0.02 || !node.isMesh || node.name !== "lightBar1") return;
      list.push({
        mesh: node,
        sprite: createTableLightGlowSprite(CAR_LIGHT_BAR_GLOW.color, CAR_LIGHT_BAR_GLOW.size),
        kind: "bar",
        baseSize: CAR_LIGHT_BAR_GLOW.size,
        side: 0,
      });
    });
    return list;
  }

  /** Where a lamp's glow lands on the table (and the lamp's world span, kept on the entry). */
  function getMeshTableReflectionPoint(entry, tableY, out) {
    const mesh = entry.mesh || entry;
    mesh.updateWorldMatrix(true, false);
    const geometry = mesh.geometry;
    if (geometry && !geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry && geometry.boundingBox;
    if (!box) {
      mesh.getWorldPosition(out);
      out.y = tableY;
      if (entry && entry !== mesh) {
        entry._worldLampSpan = entry.baseSize || 0.12;
      }
      return out;
    }
    const sizeX = box.max.x - box.min.x;
    const sizeZ = box.max.z - box.min.z;
    const axis = sizeX >= sizeZ ? "x" : "z";
    const span = axis === "x" ? sizeX : sizeZ;
    out.set(
      (box.min.x + box.max.x) * 0.5,
      (box.min.y + box.max.y) * 0.5,
      (box.min.z + box.max.z) * 0.5,
    );
    const side = (entry && entry.side) || 0;
    if (side !== 0 && span > 1e-4) {
      out[axis] = box.min[axis] + span * (side < 0 ? 0.12 : 0.88);
    }
    mesh.localToWorld(out);
    if (entry && entry !== mesh) {
      mesh.getWorldScale(_corner);
      const axisScale = axis === "x" ? _corner.x : _corner.z;
      entry._worldLampSpan = Math.max(0.04, span * Math.abs(axisScale));
    }
    out.y = tableY;
    return out;
  }

  /** Place a car's table glows (headlight beam, tail / brake / light bar glows). */
  function drawCarTableGlows(glows, carYaw, brakeOn, tableY, worldHalfW) {
    _fwd.set(Math.sin(carYaw), 0, Math.cos(carYaw));
    for (let gi = 0; gi < glows.length; gi++) {
      const entry = glows[gi];
      let alpha = 0;
      if (entry.kind === "front") alpha = CAR_LAMP_GLOW_ALPHA.front;
      else if (entry.kind === "rear") alpha = CAR_LAMP_GLOW_ALPHA.rear;
      else if (entry.kind === "brake") alpha = brakeOn ? CAR_LAMP_GLOW_ALPHA.brakeOn : CAR_LAMP_GLOW_ALPHA.brakeOff;
      else if (entry.kind === "bar") alpha = CAR_LAMP_GLOW_ALPHA.bar;
      if (alpha < 0.02) {
        entry.sprite.visible = false;
        continue;
      }
      getMeshTableReflectionPoint(entry, tableY, _point);
      entry.sprite.rotation.set(0, carYaw, 0);
      const lampSpan = entry._worldLampSpan || worldHalfW * 0.5;
      if (entry.kind === "front") {
        const beamWidth = Math.max(0.55, lampSpan * 2.4);
        const beamLength = beamWidth * HEADLIGHT_BEAM_ASPECT;
        _point.addScaledVector(_fwd, beamLength * 0.58);
        entry.sprite.scale.set(beamWidth * 1.2, 1, beamLength);
      } else {
        const sc = Math.max(0.1, Math.min(lampSpan * 0.45, worldHalfW * 0.5));
        entry.sprite.scale.set(sc, 1, sc * 0.85);
      }
      entry.sprite.position.copy(_point);
      entry.sprite.material.opacity = alpha;
      entry.sprite.visible = true;
    }
  }

  function hideGlows(glows) {
    for (let gi = 0; gi < glows.length; gi++) glows[gi].sprite.visible = false;
  }

  /** The table height in `root`'s local space (or the root's own height if there's no table). */
  function tableLocalY(root, tableY) {
    const y = tableY == null ? root.position.y : tableY;
    _tableLocal.set(root.position.x, y, root.position.z);
    root.worldToLocal(_tableLocal);
    return _tableLocal.y;
  }

  /** Aim lamp spots (entries from attachCarHeadTailSpotLights) at the table. */
  function aimCarLampSpots(spots, root, tableY) {
    if (!spots || !spots.length) return;
    const localY = tableLocalY(root, tableY);
    for (let i = 0; i < spots.length; i++) {
      const entry = spots[i];
      const spot = entry.spot;
      const aimY = entry.kind === "front" ? localY : spot.position.y * 0.55 + localY * 0.45;
      spot.target.position.set(spot.position.x, aimY, spot.position.z + entry.zSign * entry.aimAlong);
    }
  }

  function getMeshBoxInCarLocal(car, mesh, outBox) {
    mesh.updateWorldMatrix(true, false);
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    outBox.makeEmpty();
    for (let ix = 0; ix < 2; ix++) {
      for (let iy = 0; iy < 2; iy++) {
        for (let iz = 0; iz < 2; iz++) {
          _corner.set(
            ix ? box.max.x : box.min.x,
            iy ? box.max.y : box.min.y,
            iz ? box.max.z : box.min.z,
          );
          mesh.localToWorld(_corner);
          car.worldToLocal(_corner);
          outBox.expandByPoint(_corner);
        }
      }
    }
    return outBox;
  }

  function attachCarLampSpots(car, mesh, cfg, zSign, kind, distance, halfL, tableY, list, spotsPerLamp) {
    if (!mesh || !mesh.geometry) return;
    getMeshBoxInCarLocal(car, mesh, _box);
    const sizeX = _box.max.x - _box.min.x;
    const midY = (_box.min.y + _box.max.y) * 0.5;
    const lampZ = kind === "front" ? _box.max.z : _box.min.z;
    const halfSpan = sizeX * 0.5;
    const pair = halfSpan > 0.04 && spotsPerLamp !== 1;
    const sides = pair ? [-1, 1] : [0];
    // One spot per lamp (fewer real-time lights) carries the light of both.
    const intensity = cfg.intensity * (halfSpan > 0.04 && !pair ? 2 : 1);
    const aimAlong = Math.max(1.4, halfL * (kind === "front" ? 0.95 : 1.4));
    const localY = tableLocalY(car, tableY);
    for (let si = 0; si < sides.length; si++) {
      const px = sides[si] * halfSpan * 0.76;
      const pz = lampZ;
      const spot = new THREE.SpotLight(cfg.color, intensity, distance, cfg.angle, CAR_LAMP_SPOTS.penumbra, CAR_LAMP_SPOTS.decay);
      const target = new THREE.Object3D();
      spot.name = kind === "front" ? "carFrontSpot" : "carRearSpot";
      target.name = spot.name + "Target";
      spot.position.set(px, midY, pz);
      const aimY = kind === "front" ? localY : midY * 0.55 + localY * 0.45;
      target.position.set(px, aimY, pz + zSign * aimAlong);
      spot.target = target;
      spot.castShadow = false;
      car.add(spot);
      car.add(target);
      list.push({ spot, kind, zSign, aimAlong });
    }
  }

  /**
   * Head and tail lamp spot lights on `car` (positions from the lamp meshes in
   * `carRoot`), pushed into `list`. halfL: the car's half length (model units),
   * carScale: its world scale, tableY: the table's world height (or null).
   * spotsPerLamp: 2 (a spot at each side of a wide lamp, as in the kitchen) or 1
   * (one centred spot with the same total light, for fewer real-time lights).
   */
  function attachCarHeadTailSpotLights(car, carRoot, list, { halfL, carScale, tableY, spotsPerLamp = 2 }) {
    const worldLen = Math.max(0.3, halfL * carScale * 2);
    attachCarLampSpots(car, carRoot.getObjectByName("frontLights"), CAR_LAMP_SPOTS.front, 1, "front", worldLen * CAR_LAMP_SPOTS.front.reach, halfL, tableY, list, spotsPerLamp);
    attachCarLampSpots(car, carRoot.getObjectByName("rearLights"), CAR_LAMP_SPOTS.rear, -1, "rear", worldLen * CAR_LAMP_SPOTS.rear.reach, halfL, tableY, list, spotsPerLamp);
    return list;
  }

  return {
    createTableLightGlowSprite,
    setupTableLightReflections,
    getMeshTableReflectionPoint,
    drawCarTableGlows,
    hideGlows,
    aimCarLampSpots,
    attachCarHeadTailSpotLights,
  };
}
