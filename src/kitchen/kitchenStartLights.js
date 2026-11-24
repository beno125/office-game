/**
 * The start lights on the kitchen table (ul-kitchen28 "ramzor"): materials and
 * the start sequence, driven by the race's own countdown.
 *
 * Materials: ramzorMainStand white painted metal, counterBody very dark grey
 * plastic with a slight sheen, ramzorBody matte black plastic, ramzorLight1..6
 * red lenses. Each ramzorLight mesh is one column of two round lenses; the
 * model's UVs squash the lower one, so each lens gets its own UVs here (its
 * disc onto the texture's lens circle). Drawn from the reference photo: a dense
 * staggered grid of small round LEDs behind a clear lens, a thin bright rim.
 * Off: the lens is dark, its LED grid still faintly visible. On: the LEDs glow
 * in the current colour (emissive) and bloom through the kitchen bloom's
 * per-material weight (setBloomWeight): far brighter emissive would bloom by
 * the threshold but tone mapping turns such a red orange.
 *
 * Sequence (update(t), t = seconds relative to GO, from the race's countdown
 * timer: t = -timeLeft during the countdown, t = time since GO while racing):
 * light k (0-based, of N) comes on red at t = -(N - k) * interval, so the last
 * one is lit `interval` before GO; at t = 0 every light turns green at once.
 * Each change fades over `fadeSec`. With interval 0.5 and 6 lights the first
 * comes on as the countdown starts (GO - 3 s = the "3"). Off outside the
 * countdown / race.
 *
 * Glow on the surroundings: one soft spot light just ahead of the lit lenses
 * (their weighted centre), aimed out and down along their facing: it lights
 * what's in front of the traffic light only, in the current colour, its
 * intensity per lit lamp (always in the scene, 0 when dark: no shader
 * recompiles).
 *
 * Reflections on the table: each lamp has a soft additive streak lying on the
 * table through where its mirror image is seen from the camera (the ray from
 * the camera to the lamp mirrored below the table, where it meets the table):
 * a long, thin, broken streak along the view, like a light on a wet floor,
 * brightest at the mirror point, reaching back toward the lamp and further
 * toward the viewer. Placed at render time
 * (onBeforeRender, with the camera actually drawn), in the lamp's colour × how
 * lit it is, seen only from in front of the lamp and only where nothing stands
 * between the lamp and that point.
 */
import { setBloomWeight } from "../game/thresholdBloom.js";

export const KITCHEN_START_LIGHTS = {
  lights: ["ramzorLight1", "ramzorLight2", "ramzorLight3", "ramzorLight4", "ramzorLight5", "ramzorLight6"],
  interval: 0.5, // seconds between lights coming on (red)
  fadeSec: 0.08, // a lamp's fade on / off and red -> green: quick, not instant
  red: 0xff0000, // pure: any green in it turns orange at this brightness
  green: 0x00ff2a,
  emissive: 3, // a lit lens's emissive intensity (higher turns the red orange under tone mapping)
  bloom: 1, // a lit lens's bloom weight (0..1 share of its colour; kitchen bloom, setBloomWeight)
  offColor: 0x2a1414, // an unlit lens: dark, a faint red-brown
  offGlow: 0x3a2a2a, // an unlit lens's faint own light, so its LED grid still shows (the lenses face away from most lights)
  offGlowIntensity: 1.2,
  offRoughness: 0.35, // the lens glass
  glow: {
    perLamp: 1.1, // the light cast on the surroundings: the spot light's intensity per lit lamp (physical units)
    distance: 3, // its reach (model units): the table and cars just in front of the gantry
    decay: 2,
    coneDeg: 62, // half-angle of its cone
    penumbra: 1, // fully soft edge
    tiltDeg: 38, // aimed this far below the lenses' facing (out and down)
    front: 0.18, // its place ahead of the lenses (along their facing: just out of the lamp housing)
  },
  reflection: {
    strength: 0.9, // a lit lamp's reflection brightness on the table (additive; the lens itself is set by emissive / bloom)
    width: 0.2, // across the view (model units; a lamp is 0.23 wide)
    length: 2.2, // along the view, ÷ the view's steepness (longer when flatter)
    maxLength: 8, // never longer than this (a very flat view)
    peak: 0.62, // where along it (from the viewer's end) the mirror point and its brightest part are
    tail: 1.1, // how fast it fades toward the viewer (higher = shorter bright part)
    core: 0, // white mixed into the colour (the hot middle of a light's reflection)
    facingSoft: 0.35, // fades out as the camera moves round to the lamp's side (0 from behind)
    blockerRange: 6, // objects this near the lamps are checked for blocking a reflection
    visibilityEase: 0.25, // per frame: a reflection fades in / out over a few frames when blocked / revealed
    lift: 0.055, // above the table: over the kitchen's transparent table overlay (0.045 above it), no z-fighting
  },
  stand: { color: 0xecebe6, roughness: 0.6, metalness: 0.15 }, // ramzorMainStand: painted iron
  counter: { color: 0x141518, roughness: 0.42, metalness: 0 }, // counterBody: dark grey-black plastic, slight sheen
  body: { color: 0x0b0b0c, roughness: 1, metalness: 0 }, // ramzorBody: fully matte black plastic
  texture: {
    size: 512,
    // The lens circle in UV space (the model's mapping): centre and radius.
    u: 0.25,
    v: 0.75,
    r: 0.234,
    ledsAcross: 23, // LEDs across the lens's diameter
    ledFill: 0.72, // an LED's diameter / the grid's pitch
  },
};

/**
 * The lens texture (white LEDs on dark, so the material's colour / emissive tints it): a staggered grid of round LEDs
 * with a soft bright core each, inside the lens circle, a thin rim. Outside the circle: black.
 */
function makeLensTexture(THREE, T) {
  const c = document.createElement("canvas");
  c.width = c.height = T.size;
  const g = c.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, T.size, T.size);
  const cx = T.u * T.size;
  const cy = (1 - T.v) * T.size;
  const R = T.r * T.size;
  // The lens behind the LEDs: a little light so the off state isn't flat.
  const bg = g.createRadialGradient(cx, cy, 0, cx, cy, R);
  bg.addColorStop(0, "#2a2a2a");
  bg.addColorStop(1, "#141414");
  g.fillStyle = bg;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();
  const pitch = (2 * R) / T.ledsAcross;
  const rowStep = (pitch * Math.sqrt(3)) / 2;
  const ledR = (pitch * T.ledFill) / 2;
  const inner = R - pitch * 0.6;
  for (let row = -Math.ceil(R / rowStep); row <= Math.ceil(R / rowStep); row++) {
    const y = cy + row * rowStep;
    const shift = row % 2 ? pitch / 2 : 0;
    for (let col = -Math.ceil(R / pitch) - 1; col <= Math.ceil(R / pitch) + 1; col++) {
      const x = cx + col * pitch + shift;
      if (Math.hypot(x - cx, y - cy) > inner) continue;
      const led = g.createRadialGradient(x, y, 0, x, y, ledR);
      led.addColorStop(0, "#ffffff");
      led.addColorStop(0.55, "#d8d8d8");
      led.addColorStop(1, "#5a5a5a");
      g.fillStyle = led;
      g.beginPath();
      g.arc(x, y, ledR, 0, Math.PI * 2);
      g.fill();
    }
  }
  // The rim (the lens's chrome edge).
  g.strokeStyle = "#9a9a9a";
  g.lineWidth = Math.max(2, R * 0.035);
  g.beginPath();
  g.arc(cx, cy, R - g.lineWidth / 2, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * A lamp's own UVs: its two lenses (the upper / lower half of its local bounds, along local y) each mapped onto the
 * texture's lens circle (centre T.u, T.v, radius T.r). The lenses lie in the local y / z plane.
 */
function lensUVs(THREE, geometry, T) {
  const g = geometry.clone();
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const midY = (bb.min.y + bb.max.y) / 2;
  const pos = g.attributes.position;
  const halves = [new THREE.Box3(), new THREE.Box3()];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) halves[pos.getY(i) >= midY ? 0 : 1].expandByPoint(v.fromBufferAttribute(pos, i));
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const h = halves[pos.getY(i) >= midY ? 0 : 1];
    const cy = (h.min.y + h.max.y) / 2, ry = (h.max.y - h.min.y) / 2 || 1;
    const cz = (h.min.z + h.max.z) / 2, rz = (h.max.z - h.min.z) / 2 || 1;
    uv[i * 2] = T.u + ((pos.getZ(i) - cz) / rz) * T.r;
    uv[i * 2 + 1] = T.v + ((pos.getY(i) - cy) / ry) * T.r;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

/** The top-most parent (the scene): the reflections are placed in world space. */
function scene0(o) {
  while (o.parent) o = o.parent;
  return o;
}

/**
 * @param {object} o
 * @param {typeof import("three")} o.THREE
 * @param {import("three").Object3D} o.root  the kitchen model
 * @param {() => number|null} [o.getTableY]  the table's surface height (for the reflections)
 * @returns {{ update(t: number|null): void, missing: string[], dispose(): void, center: import("three").Vector3|null }}
 */
export function createStartLights({ THREE, root, getTableY = null }) {
  const C = KITCHEN_START_LIGHTS;
  const byName = (n) => {
    const m = root.getObjectByName(n);
    return m && m.isMesh ? m : null;
  };
  const missing = [];
  const owned = [];
  const setMat = (name, mat) => {
    const m = byName(name);
    if (!m) return missing.push(name);
    m.material = mat;
    owned.push(mat);
  };
  setMat("ramzorMainStand", new THREE.MeshStandardMaterial(C.stand));
  setMat("counterBody", new THREE.MeshStandardMaterial(C.counter));
  setMat("ramzorBody", new THREE.MeshStandardMaterial(C.body));

  const tex = makeLensTexture(THREE, C.texture);
  const red = new THREE.Color(C.red);
  const green = new THREE.Color(C.green);
  const lamps = []; // { mat, index }
  const geometries = []; // the lamps' geometry copies (their own UVs)
  C.lights.forEach((name, index) => {
    const m = byName(name);
    if (!m) return missing.push(name);
    const mat = new THREE.MeshStandardMaterial({
      color: C.offColor,
      map: tex,
      roughness: C.offRoughness,
      metalness: 0,
      emissive: 0x000000,
      emissiveMap: tex,
      emissiveIntensity: 0,
      side: THREE.DoubleSide,
    });
    setBloomWeight(mat, 0);
    m.geometry = lensUVs(THREE, m.geometry, C.texture);
    geometries.push(m.geometry);
    m.material = mat;
    owned.push(mat);
    lamps.push({ mat, index });
  });

  // Each lamp: its lenses' centre and the way they face (the lens normal in world space).
  const box = new THREE.Box3();
  for (const L of lamps) {
    const m = byName(C.lights[L.index]);
    m.updateWorldMatrix(true, false);
    L.centre = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3());
    box.union(new THREE.Box3().setFromObject(m));
    const n = m.geometry.attributes.normal;
    L.facing = new THREE.Vector3(n.getX(0), n.getY(0), n.getZ(0))
      .applyMatrix3(new THREE.Matrix3().getNormalMatrix(m.matrixWorld))
      .normalize();
  }
  const facing = lamps.length ? lamps[0].facing.clone() : new THREE.Vector3(-1, 0, 0);

  // The glow on the surroundings: a spot light in front of the lit lenses (their weighted centre), aimed out and
  // down along their facing, with a soft wide cone: it lights what's in front of the traffic light (the table, the
  // cars, the block below) and nothing behind or above it (a point light here lit the stand's bar from 0.3 away and
  // everything behind the lights, through the body).
  const G = C.glow;
  const glow = new THREE.SpotLight(C.red, 0, G.distance, THREE.MathUtils.degToRad(G.coneDeg), G.penumbra, G.decay);
  const aimDir = facing.clone().setY(0).normalize().multiplyScalar(Math.cos(THREE.MathUtils.degToRad(G.tiltDeg)));
  aimDir.y = -Math.sin(THREE.MathUtils.degToRad(G.tiltDeg));
  root.add(glow);
  root.add(glow.target);
  const glowAt = new THREE.Vector3();
  if (!box.isEmpty()) box.getCenter(glowAt);
  /** The light at the lit lenses' centre (weights: how lit each is), `front` ahead of them. */
  function placeGlow(weights) {
    let sum = 0;
    const c = new THREE.Vector3();
    lamps.forEach((L, i) => {
      if (weights[i] > 0) {
        c.addScaledVector(L.centre, weights[i]);
        sum += weights[i];
      }
    });
    if (sum > 0) glowAt.copy(c.divideScalar(sum));
    glow.position.copy(glowAt).addScaledVector(facing, G.front);
    glow.target.position.copy(glow.position).add(aimDir);
    glow.updateMatrixWorld();
    glow.target.updateMatrixWorld();
  }

  // Reflections on the table: one streak per lamp through where its mirror image is seen from the camera (the ray
  // from the camera to the lamp mirrored below the table, where it meets the table), long and broken along the view
  // like a light on a wet floor. Seen only from in front of the lamp (its lens faces the camera), and only where the light
  // can reach that point: nothing between the lamp and it (the red block under the gantry covers the table there).
  const R = C.reflection;
  // The streak, after a light on a wet floor: brightest at the far end (the mirror point, v = 1), a long broken tail
  // toward the viewer (v = 0): uneven bands and specks along it, narrower far away, slightly wavy.
  const spot = (() => {
    const W = 64, H = 512;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    const img = g.createImageData(W, H);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // Per-row breakup: a smoothed random walk (patches of wet shine and duller bits).
    const band = new Float32Array(H);
    let b = 0.7;
    for (let y = 0; y < H; y++) {
      b += (rnd() - 0.5) * 0.35;
      b = Math.min(1, Math.max(0.25, b));
      band[y] = b;
    }
    for (let k = 0; k < 3; k++) for (let y = 1; y < H - 1; y++) band[y] = (band[y - 1] + band[y] * 2 + band[y + 1]) / 4;
    const specks = new Float32Array(W * H);
    for (let i = 0; i < 260; i++) {
      const sx = Math.floor(W / 2 + (rnd() - 0.5) * W * 0.7);
      const sy = Math.floor(rnd() * H);
      specks[sy * W + sx] = 0.6 + rnd() * 0.4;
    }
    for (let y = 0; y < H; y++) {
      const v = 1 - y / (H - 1); // canvas top = texture v 1 (flipY): the far end (toward the lamp)
      // Brightest at the mirror point (v = R.peak), fading toward the lamp and, longer, toward the viewer.
      const along =
        (v > R.peak ? Math.pow(1 - (v - R.peak) / (1 - R.peak), 1.3) : Math.pow(v / R.peak, R.tail)) *
        (0.2 + 0.8 * band[y] * band[y]);
      const halfW = 0.45 + 0.35 * (1 - v); // narrower far away
      const wob = (band[(y + 211) % H] - 0.6) * 0.12; // an irregular sideways drift (ripples on the wet surface)
      for (let x = 0; x < W; x++) {
        const u = ((x / (W - 1)) * 2 - 1 - wob) / halfW;
        const across = Math.exp(-u * u * 3.2);
        const a = along * across + specks[y * W + x] * Math.pow(v, 0.6) * 0.5;
        const i = (y * W + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * Math.min(1, a));
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  // What can stand between a lamp and the table in front of it: the model's meshes near the gantry (their bounds,
  // read live: some are physics props), not the traffic light itself, not the table.
  const own = new Set([...C.lights, "ramzorBody", "ramzorHolder", "ramzorMainStand", "counterBody", "counterScreen"]);
  const near = box.clone().expandByScalar(R.blockerRange);
  const blockers = [];
  root.traverse((o) => {
    if (!o.isMesh || own.has(o.name) || /^mainTable/.test(o.name)) return;
    const b = new THREE.Box3().setFromObject(o);
    if (b.intersectsBox(near) && b.max.y > (box.min.y - 4) && b.getSize(new THREE.Vector3()).length() < 40) blockers.push(o);
  });
  const _bb = new THREE.Box3();
  const _ray = new THREE.Ray();
  const _hit = new THREE.Vector3();
  /** Something between `from` and `to`? */
  function blocked(from, to) {
    _ray.origin.copy(from);
    _ray.direction.subVectors(to, from);
    const d = _ray.direction.length();
    _ray.direction.divideScalar(d);
    for (const o of blockers) {
      if (!o.visible) continue;
      _bb.setFromObject(o);
      if (_bb.containsPoint(from)) return true;
      if (_ray.intersectBox(_bb, _hit) && _hit.distanceTo(from) < d) return true;
    }
    return false;
  }
  const reflGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); // lying flat, its length along local z
  const reflections = [];
  const _c = new THREE.Vector3();
  const _m = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _toCam = new THREE.Vector3();
  const _white = new THREE.Color(1, 1, 1);
  for (const L of lamps) {
    const centre = L.centre;
    // Additive in colour only. The kitchen bloom reads the HDR image's alpha as its per-material marker (opaque 1,
    // weighted 4 + w, bloom group 8 +; thresholdBloom.js); three's AdditiveBlending also adds srcAlpha² into that alpha,
    // so overlapping streaks pushed the table's pixels into the weighted / group ranges and they bloomed. The
    // destination alpha (the marker of whatever is under the streak) is kept as it is.
    const mat = new THREE.MeshBasicMaterial({
      map: spot,
      color: 0x000000,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      depthWrite: false,
      toneMapped: true,
    });
    const mesh = new THREE.Mesh(reflGeo, mat);
    mesh.name = C.lights[L.index] + "_tableReflection";
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false; // placed at render time
    mesh.renderOrder = 3;
    mesh.visible = false;
    const r = { L, mesh, mat, base: new THREE.Color(), seen: 0 };
    mesh.onBeforeRender = (renderer, scene, cam) => {
      const ty = getTableY ? getTableY() : null;
      cam.getWorldPosition(_c);
      let target = 0;
      if (ty != null && _c.y > ty + 0.01 && centre.y > ty) {
        // The lamp mirrored below the table, and where the view of it meets the table.
        _m.set(centre.x, 2 * ty - centre.y, centre.z);
        const s = (_c.y - ty) / (_c.y - _m.y);
        _p.copy(_c).lerp(_m, s);
        _p.y = ty + R.lift;
        // A wet floor's streak along the view through the mirror point: a share `peak` of it toward the lamp (not past
        // the table under it), the rest toward the viewer; longer the flatter the view.
        const dx = _c.x - _p.x, dz = _c.z - _p.z;
        const flat = Math.hypot(dx, dz) || 1;
        const sinElev = (_c.y - ty) / Math.hypot(flat, _c.y - ty);
        const toFoot = Math.hypot(centre.x - _p.x, centre.z - _p.z);
        let len = Math.min(R.maxLength, R.length / Math.max(0.15, sinElev));
        len = Math.min(len, toFoot / Math.max(0.05, 1 - R.peak), (flat * 0.9) / R.peak);
        const ux = dx / flat, uz = dz / flat;
        const shift = len * (R.peak - 0.5); // the plane's centre from the mirror point, toward the viewer
        mesh.position.set(_p.x + ux * shift, _p.y, _p.z + uz * shift);
        mesh.rotation.set(0, Math.atan2(dx, dz), 0);
        mesh.scale.set(R.width, 1, len);
        // Seen from the front only (the lens faces the camera), and only if the light reaches the table there.
        const front = _toCam.subVectors(_c, centre).normalize().dot(L.facing);
        target = Math.min(1, Math.max(0, front / R.facingSoft));
        if (target > 0 && blocked(_m.set(_p.x, ty + 0.03, _p.z), centre)) target = 0;
      }
      r.seen += (target - r.seen) * R.visibilityEase; // no pop as something moves in front
      mat.color.copy(r.base).multiplyScalar(r.seen);
      if (r.seen < 1e-3) mesh.scale.setScalar(1e-6);
      mesh.updateMatrix();
      mesh.matrixWorld.copy(mesh.matrix);
      mesh.modelViewMatrix.multiplyMatrices(cam.matrixWorldInverse, mesh.matrixWorld);
      mesh.normalMatrix.getNormalMatrix(mesh.modelViewMatrix);
    };
    scene0(root).add(mesh);
    owned.push(mat);
    reflections.push(r);
  }

  const N = C.lights.length;
  const ease = (x) => Math.min(1, Math.max(0, x / C.fadeSec));
  const col = new THREE.Color();
  const offGlow = new THREE.Color(C.offGlow).multiplyScalar(C.offGlowIntensity);
  const lit1 = new THREE.Color();
  /** t: seconds relative to GO (negative before it), or null when the lights are dark. */
  function update(t) {
    let lit = 0;
    const g = t == null ? 0 : ease(t); // the green share (0 before GO)
    col.copy(red).lerp(green, g);
    for (const L of lamps) {
      const on = t == null ? 0 : ease(t + (N - L.index) * C.interval);
      // Emissive: the faint unlit glow, fading into the lit colour.
      L.mat.emissive.copy(offGlow).multiplyScalar(1 - on).add(lit1.copy(col).multiplyScalar(on * C.emissive));
      L.mat.emissiveIntensity = 1;
      L.mat.userData.bloomWeight.value = on * C.bloom;
      lit += on;
    }
    const weights = [];
    for (const r of reflections) {
      const on = t == null ? 0 : ease(t + (N - r.L.index) * C.interval);
      weights.push(on);
      r.mesh.visible = on > 0;
      // The lamp's colour with a little white (a reflection's hot core), × how much of it is seen (at render time).
      r.base.copy(col).lerp(_white, R.core).multiplyScalar(on * R.strength);
    }
    glow.color.copy(col);
    glow.intensity = G.perLamp * lit; // each lit lamp adds its share
    placeGlow(weights);
  }
  update(null);

  if (missing.length) console.warn("Start lights: missing in the model:", missing.join(", "));

  function dispose() {
    for (const r of reflections) r.mesh.removeFromParent();
    reflGeo.dispose();
    spot.dispose();
    glow.removeFromParent();
    glow.target.removeFromParent();
    glow.dispose();
    for (const m of owned) m.dispose();
    for (const g of geometries) g.dispose();
    tex.dispose();
  }
  return { update, missing, dispose, center: box.isEmpty() ? null : box.getCenter(new THREE.Vector3()) };
}
