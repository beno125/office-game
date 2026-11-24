/**
 * Glass jars on the wall shelves under the top closets (ul-kitchen28).
 *
 * Each jar is a group of two model meshes that stay together (their relative
 * position / rotation / scale unchanged): a clear glass pot and its matte dark
 * brown plastic lid.
 *   A: glassPotCup1 + glassPot1         on shelf3, the bay left of the frame's middle post
 *   B: glassPotBigCup1 + glassPotBig1   on shelf3, the bay right of the middle post
 *   C: glassPotBigCup2 + glassPotBig2   on shelf4 (the right closet)
 *
 * Each group fills its bay in one row along the shelf (x): as many copies as
 * fit `spacing` apart, less `fewerThanFit`, spread with equal gaps between them
 * and at both ends. Each copy (the whole group) gets a tiny seeded nudge along /
 * across the shelf and a turn of a degree or two (`jitter`), so the row looks
 * placed by hand but still neat. Every copy stands exactly on the shelf's top
 * surface (from the shelf mesh's bounds). The model's own pair is replaced by
 * the row (it floated 0.007 / 0.023 above the shelf).
 *
 * Bays (x): between the inner faces of the metal frame's posts at shelf height
 * (midTopClosetMatalFrame / rightTopClosetMatalFrame). The posts stand only at
 * the shelf's front / back edges, outside its depth, so these are the usable
 * lengths: shelf3 -15.732..1.500 and 1.725..18.958, shelf4 27.514..41.807.
 *
 * Glass: physical glass, double-sided (the far wall shows through the near
 * one), reflecting `envMap` with the shader's own Fresnel (edges reflect more
 * than the middle), a clear coat, a very faint tint and a Fresnel rim so the
 * outline reads against the wall. Lit by the scene's lights like any surface.
 *
 * Cost: one InstancedMesh per mesh (6 draw calls for all copies), one geometry
 * and one material per kind. The glass uses physical transmission on the high /
 * ultra tiers (three renders the opaque scene once more per frame for it,
 * whatever the number of copies). Transmissive glass writes depth, so copies
 * and other objects occlude it correctly; its refraction shows only opaque
 * things, so glass seen through another glass (along the row, at a steep angle)
 * shows the wall behind instead. Lower tiers get a cheap alpha-blended glass
 * (setHighQuality(false)): no extra pass, depthWrite off, its copies drawn back
 * to front by update(camera).
 */
export const KITCHEN_SHELF_JARS = {
  spacing: 0.6, // minimum gap between neighbouring copies: sets how many fit (model units; a small jar is 1.78 wide, a big 1.47)
  fewerThanFit: 1, // copies left out of each row (of as many as fit), the rest spread over the bay
  endClearance: 0.1, // at least this much between the row's ends and the bay's ends
  // A whole group (lid + pot) is nudged as one, from a fixed seed (the same every load). 1 unit ≈ 5.6 cm (the small
  // jar is ~10 cm across), so 0.05 ≈ 3 mm.
  jitter: {
    along: 0.05, // ± along the shelf (x)
    across: 0.05, // ± across the shelf (z)
    yawDeg: 2, // ± turn about the vertical axis (degrees)
    seed: 20261124,
  },
  groups: [
    { name: "A", parts: ["glassPotCup1", "glassPot1"], shelf: "shelf3", bay: [-15.732, 1.5] },
    { name: "B", parts: ["glassPotBigCup1", "glassPotBig1"], shelf: "shelf3", bay: [1.725, 18.958] },
    { name: "C", parts: ["glassPotBigCup2", "glassPotBig2"], shelf: "shelf4", bay: [27.514, 41.807] },
  ],
  glassNames: ["glassPot1", "glassPotBig1", "glassPotBig2"],
  glass: {
    color: 0xffffff,
    reflection: 0.07, // environment reflection strength (envMapIntensity; 0.7, 0.3 and 0.15 were too strong); the physical shader's Fresnel makes edges reflect more
    roughness: 0.05, // polished, the reflections a little soft
    ior: 1.5, // glass
    thickness: 0.08, // refraction depth (model units): what's behind bends very slightly
    metalness: 0,
    transmission: 1, // fully see-through
    specularIntensity: 1,
    clearcoat: 0, // an extra polished layer for more shine (off: too much)
    clearcoatRoughness: 0.03,
    tint: 0xe9f6f1, // a very faint green-blue (attenuation colour)
    tintDistance: 8, // how far light travels in the glass before taking the tint (model units): faint
    rim: {
      color: 0xd8e8ff, // the pot's outline: a faint bright edge where the surface turns away from the camera
      strength: 0.03,
      power: 3, // higher = thinner edge
    },
    cheapOpacity: 0.35, // lower tiers (no transmission): how much of the glass's own shading covers what's behind it
    cheapColor: 0x1a1e22, // lower tiers: a dark base, so mostly its reflections show (white read as frosted plastic)
  },
  lid: {
    color: 0x5c3a22, // dark brown (a darker one reads black in the kitchen's dim light)
    roughness: 0.85, // matte, no shiny highlight
    metalness: 0,
    envMapIntensity: 0.15,
  },
};

/** Seeded random in [0, 1) (mulberry32). */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {object} o
 * @param {typeof import("three")} o.THREE
 * @param {import("three").Object3D} o.root   the kitchen model (its meshes by name)
 * @param {import("three").Texture|null} o.envMap  the glass's reflections (a PMREM texture)
 * @param {import("three").Texture|null} [o.lidEnvMap]  the lids' reflections (default envMap)
 * @param {boolean} [o.ownsEnvMap]  dispose envMap / lidEnvMap with the jars
 * @param {boolean} o.highQuality  transmission glass (else the cheap alpha glass)
 */
export function createShelfJars({ THREE, root, envMap, lidEnvMap = envMap, ownsEnvMap = false, highQuality }) {
  const C = KITCHEN_SHELF_JARS;
  const G = C.glass;
  root.updateMatrixWorld(true);
  const byName = (n) => {
    const m = root.getObjectByName(n);
    return m && m.isMesh ? m : null;
  };
  const missing = [];
  for (const g of C.groups) for (const n of [...g.parts, g.shelf]) if (!byName(n)) missing.push(n);
  if (missing.length) throw new Error("Shelf jars: missing in the model: " + missing.join(", "));

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: G.color,
    roughness: G.roughness,
    metalness: G.metalness,
    ior: G.ior,
    thickness: G.thickness,
    specularIntensity: G.specularIntensity,
    envMapIntensity: G.reflection,
    clearcoat: G.clearcoat,
    clearcoatRoughness: G.clearcoatRoughness,
    attenuationColor: new THREE.Color(G.tint),
    attenuationDistance: G.tintDistance,
    side: THREE.DoubleSide,
    envMap,
  });
  // The rim: a Fresnel edge added to the lit colour (and, for the cheap glass, to its opacity), so the pot's shape
  // stands out against the dark wall.
  const rimUniforms = {
    uRimColor: { value: new THREE.Color(G.rim.color) },
    uRimStrength: { value: G.rim.strength },
    uRimPower: { value: G.rim.power },
  };
  glassMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, rimUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform float uRimPower;\nvoid main() {")
      .replace(
        "#include <opaque_fragment>",
        `{
          float rimF = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), uRimPower);
          outgoingLight += uRimColor * (uRimStrength * rimF);
          diffuseColor.a = max(diffuseColor.a, min(1.0, uRimStrength * rimF * 2.0));
        }
        #include <opaque_fragment>`,
      );
  };
  glassMat.userData.rim = rimUniforms; // tunable at run time
  glassMat.customProgramCacheKey = () => "kitchenShelfJarGlassRim";
  const lidMat = new THREE.MeshStandardMaterial({
    color: C.lid.color,
    roughness: C.lid.roughness,
    metalness: C.lid.metalness,
    envMapIntensity: C.lid.envMapIntensity,
    envMap: lidEnvMap,
  });

  let transparentGlass = false;
  /** Glass quality: transmission (high) or plain alpha blending (cheap). */
  function setHighQuality(on) {
    transparentGlass = !on;
    glassMat.transmission = on ? G.transmission : 0;
    glassMat.transparent = !on;
    glassMat.opacity = on ? 1 : G.cheapOpacity;
    glassMat.color.set(on ? G.color : G.cheapColor);
    glassMat.depthWrite = on;
    glassMat.needsUpdate = true;
  }
  setHighQuality(highQuality);

  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  const meshes = [];
  const glassRows = []; // { inst, mats: [Matrix4], centres: [Vector3] }: for the back-to-front sort
  const rows = []; // per group: { name, shelf, bay, count, groupMats: [Matrix4], parts, shelfTop }
  const rand = seededRandom(C.jitter.seed);
  const rad = THREE.MathUtils.degToRad;
  for (const g of C.groups) {
    const parts = g.parts.map(byName);
    box.makeEmpty();
    for (const p of parts) box.union(tmp.setFromObject(p));
    const shelfTop = tmp.setFromObject(byName(g.shelf)).max.y;
    const w = box.max.x - box.min.x;
    const L = g.bay[1] - g.bay[0];
    const fit = Math.floor((L - 2 * C.endClearance + C.spacing) / (w + C.spacing));
    const count = Math.max(1, fit - C.fewerThanFit);
    const gap = (L - count * w) / (count + 1); // the same gap between copies and at both ends
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const dy = shelfTop - box.min.y; // stand on the shelf (a turn about the vertical keeps the bottom's height)
    const groupMats = [];
    const toC = new THREE.Matrix4().makeTranslation(-cx, 0, -cz);
    for (let i = 0; i < count; i++) {
      const x = g.bay[0] + gap + w / 2 + i * (w + gap) + (rand() * 2 - 1) * C.jitter.along;
      const z = cz + (rand() * 2 - 1) * C.jitter.across;
      const yaw = rad((rand() * 2 - 1) * C.jitter.yawDeg);
      const m = new THREE.Matrix4().makeRotationY(yaw).multiply(toC);
      m.premultiply(new THREE.Matrix4().makeTranslation(x, dy, z));
      groupMats.push(m); // the whole group's move: about its own centre, then to its place
    }
    rows.push({ name: g.name, shelf: g.shelf, bay: g.bay, count, groupMats, parts, shelfTop });

    for (const p of parts) {
      const isGlass = C.glassNames.includes(p.name);
      const inst = new THREE.InstancedMesh(p.geometry, isGlass ? glassMat : lidMat, count);
      inst.name = p.name + "_shelfRow";
      inst.castShadow = isGlass ? false : p.castShadow; // clear glass casts no solid shadow
      inst.receiveShadow = p.receiveShadow;
      inst.renderOrder = p.renderOrder;
      const mats = groupMats.map((gm) => new THREE.Matrix4().multiplyMatrices(gm, p.matrixWorld));
      mats.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingBox();
      inst.computeBoundingSphere();
      inst.matrixAutoUpdate = false; // instance matrices are already in world space
      root.add(inst);
      inst.matrix.copy(root.matrixWorld).invert(); // root is the identity today; this keeps the copies in world space anyway
      inst.updateMatrixWorld(true);
      p.visible = false; // the row replaces the model's own copy
      meshes.push(inst);
      if (isGlass) glassRows.push({ inst, mats, centres: mats.map((m) => new THREE.Vector3().setFromMatrixPosition(m)), order: mats.map((_, i) => i) });
    }
  }

  /** The copy's world box from its parts' vertices (exact, after the turn). */
  const _v = new THREE.Vector3();
  function copyBox(r, i, target) {
    target.makeEmpty();
    for (const p of r.parts) {
      const pos = p.geometry.attributes.position;
      const m = new THREE.Matrix4().multiplyMatrices(r.groupMats[i], p.matrixWorld);
      for (let k = 0; k < pos.count; k++) target.expandByPoint(_v.fromBufferAttribute(pos, k).applyMatrix4(m));
    }
    return target;
  }

  /**
   * The cheap (alpha-blended) glass: draw each row's copies back to front from the camera, so nearer glass blends
   * over farther glass. (Rows themselves are sorted by three, by their bounds' centre; the transmission glass writes
   * depth and needs no sort.) Call before rendering.
   */
  const _camPos = new THREE.Vector3();
  function update(camera) {
    if (!transparentGlass || !camera) return;
    camera.getWorldPosition(_camPos);
    for (const gr of glassRows) {
      const d = gr.centres.map((c) => c.distanceToSquared(_camPos));
      const order = gr.order.slice().sort((a, b) => d[b] - d[a]);
      if (order.every((v, k) => v === gr.order[k])) continue;
      gr.order = order;
      order.forEach((src, k) => gr.inst.setMatrixAt(k, gr.mats[src]));
      gr.inst.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Bounding-box checks of the row in world space: each copy's box (its two parts) against
   *  - its shelf's top (the copy's bottom must be on it, within 1e-4),
   *  - its bay's ends, the other copies and the other groups' copies,
   *  - every triangle of every other visible mesh in the model (triangle bounds vs the copy's box, shrunk by
   *    `eps` so touching the shelf top isn't a hit).
   * Returns { rows, issues }.
   */
  function check(eps = 1e-3) {
    const issues = [];
    const copies = [];
    for (const r of rows) {
      for (let i = 0; i < r.count; i++) {
        const b = copyBox(r, i, new THREE.Box3());
        copies.push({ group: r.name, i, box: b });
        if (Math.abs(b.min.y - r.shelfTop) > 1e-4) issues.push(`${r.name}#${i}: bottom ${b.min.y} not on shelf top ${r.shelfTop}`);
        if (b.min.x < r.bay[0] || b.max.x > r.bay[1]) issues.push(`${r.name}#${i}: outside its bay`);
      }
    }
    for (let a = 0; a < copies.length; a++)
      for (let b = a + 1; b < copies.length; b++)
        if (shrink(copies[a].box, eps).intersectsBox(copies[b].box))
          issues.push(`${copies[a].group}#${copies[a].i} overlaps ${copies[b].group}#${copies[b].i}`);
    const own = new Set(rows.flatMap((r) => r.parts));
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const tri = new THREE.Box3();
    root.traverse((n) => {
      if (!n.isMesh || n.isInstancedMesh || own.has(n) || !n.visible) return;
      const nb = tmp.setFromObject(n);
      const hits = copies.filter((c) => shrink(c.box, eps).intersectsBox(nb));
      if (!hits.length) return;
      const pos = n.geometry.attributes.position;
      const idx = n.geometry.index;
      const triCount = idx ? idx.count / 3 : pos.count / 3;
      for (let t = 0; t < triCount; t++) {
        for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, idx ? idx.getX(t * 3 + k) : t * 3 + k).applyMatrix4(n.matrixWorld);
        tri.setFromPoints(v);
        for (const c of hits) {
          if (shrink(c.box, eps).intersectsBox(tri)) {
            issues.push(`${c.group}#${c.i} overlaps ${n.name}`);
            c.hit = true;
          }
        }
      }
    });
    return {
      rows: rows.map((r) => ({ group: r.name, shelf: r.shelf, usableLength: +(r.bay[1] - r.bay[0]).toFixed(3), copies: r.count })),
      issues: [...new Set(issues)],
    };
  }
  function shrink(b, e) {
    return tmp2.copy(b).expandByScalar(-e);
  }
  const tmp2 = new THREE.Box3();

  function dispose() {
    for (const m of meshes) {
      m.removeFromParent();
      m.dispose();
    }
    glassMat.dispose();
    lidMat.dispose();
    if (ownsEnvMap && envMap) envMap.dispose();
    if (ownsEnvMap && lidEnvMap && lidEnvMap !== envMap) lidEnvMap.dispose();
    for (const g of C.groups) for (const n of g.parts) {
      const p = root.getObjectByName(n);
      if (p) p.visible = true;
    }
  }

  return { meshes, rows, check, update, setHighQuality, dispose };
}
