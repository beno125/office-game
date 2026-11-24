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
 * Each group fills its bay in one row along the shelf (x), evenly: copies
 * `spacing` apart (gap between neighbours), the row centred in the bay, as many
 * as fit. Every copy stands exactly on the shelf's top surface (from the shelf
 * mesh's bounds); depth (z) as modelled. The model's own pair is replaced by
 * the row (it floated 0.007 / 0.023 above the shelf).
 *
 * Bays (x): between the inner faces of the metal frame's posts at shelf height
 * (midTopClosetMatalFrame / rightTopClosetMatalFrame). The posts stand only at
 * the shelf's front / back edges, outside its depth, so these are the usable
 * lengths: shelf3 -15.732..1.500 and 1.725..18.958, shelf4 27.514..41.807.
 *
 * Cost: one InstancedMesh per mesh (6 draw calls for all copies), one geometry
 * and one material per kind. The glass uses physical transmission on the high /
 * ultra tiers (three renders the opaque scene once more per frame for it,
 * whatever the number of copies; transmissive objects aren't alpha-blended, so
 * no sorting issues). Lower tiers get a cheap alpha-blended glass instead
 * (setHighQuality(false)): no extra pass, depthWrite off.
 */
export const KITCHEN_SHELF_JARS = {
  spacing: 0.6, // gap between neighbouring copies along the shelf (model units; a small jar is 1.78 wide, a big 1.47)
  endClearance: 0.1, // at least this much between the row's ends and the bay's ends
  groups: [
    { name: "A", parts: ["glassPotCup1", "glassPot1"], shelf: "shelf3", bay: [-15.732, 1.5] },
    { name: "B", parts: ["glassPotBigCup1", "glassPotBig1"], shelf: "shelf3", bay: [1.725, 18.958] },
    { name: "C", parts: ["glassPotBigCup2", "glassPotBig2"], shelf: "shelf4", bay: [27.514, 41.807] },
  ],
  glassNames: ["glassPot1", "glassPotBig1", "glassPotBig2"],
  glass: {
    color: 0xffffff,
    roughness: 0.04, // near-polished: sharp, faint reflections
    metalness: 0,
    transmission: 1, // fully see-through (refracts what's behind it)
    ior: 1.5, // glass
    thickness: 0.12, // wall thickness for the refraction (model units): a slight bend of what's behind
    specularIntensity: 1,
    envMapIntensity: 0.8, // subtle reflections of the neutral environment
    cheapOpacity: 0.22, // lower tiers (no transmission): how much the glass tints what's behind it
  },
  lid: {
    color: 0x5c3a22, // dark brown (a darker one reads black in the kitchen's dim light)
    roughness: 0.85, // matte, no shiny highlight
    metalness: 0,
    envMapIntensity: 0.15,
  },
};

/**
 * @param {object} o
 * @param {typeof import("three")} o.THREE
 * @param {import("three").Object3D} o.root   the kitchen model (its meshes by name)
 * @param {import("three").Texture|null} o.envMap  reflections for the glass (a PMREM texture)
 * @param {boolean} [o.ownsEnvMap]  dispose envMap with the jars
 * @param {boolean} o.highQuality  transmission glass (else the cheap alpha glass)
 */
export function createShelfJars({ THREE, root, envMap, ownsEnvMap = false, highQuality }) {
  const C = KITCHEN_SHELF_JARS;
  root.updateMatrixWorld(true);
  const byName = (n) => {
    const m = root.getObjectByName(n);
    return m && m.isMesh ? m : null;
  };
  const missing = [];
  for (const g of C.groups) for (const n of [...g.parts, g.shelf]) if (!byName(n)) missing.push(n);
  if (missing.length) throw new Error("Shelf jars: missing in the model: " + missing.join(", "));

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: C.glass.color,
    roughness: C.glass.roughness,
    metalness: C.glass.metalness,
    ior: C.glass.ior,
    thickness: C.glass.thickness,
    specularIntensity: C.glass.specularIntensity,
    envMapIntensity: C.glass.envMapIntensity,
    envMap,
  });
  const lidMat = new THREE.MeshStandardMaterial({
    color: C.lid.color,
    roughness: C.lid.roughness,
    metalness: C.lid.metalness,
    envMapIntensity: C.lid.envMapIntensity,
    envMap,
  });

  /** Glass quality: transmission (high) or plain alpha blending (cheap). */
  function setHighQuality(on) {
    glassMat.transmission = on ? C.glass.transmission : 0;
    glassMat.transparent = !on;
    glassMat.opacity = on ? 1 : C.glass.cheapOpacity;
    glassMat.depthWrite = on;
    glassMat.needsUpdate = true;
  }
  setHighQuality(highQuality);

  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  const meshes = [];
  const rows = []; // per group: { name, shelf, bay, count, offsets: [Vector3], parts }
  for (const g of C.groups) {
    const parts = g.parts.map(byName);
    box.makeEmpty();
    for (const p of parts) box.union(tmp.setFromObject(p));
    const shelfTop = tmp.setFromObject(byName(g.shelf)).max.y;
    const w = box.max.x - box.min.x;
    const len = g.bay[1] - g.bay[0] - 2 * C.endClearance;
    const count = Math.max(1, Math.floor((len + C.spacing) / (w + C.spacing)));
    const rowW = count * w + (count - 1) * C.spacing;
    const x0 = (g.bay[0] + g.bay[1]) / 2 - rowW / 2; // the row centred in the bay
    const dy = shelfTop - box.min.y; // stand on the shelf
    const offsets = [];
    for (let i = 0; i < count; i++) offsets.push(new THREE.Vector3(x0 + i * (w + C.spacing) - box.min.x, dy, 0));
    rows.push({ name: g.name, shelf: g.shelf, bay: g.bay, count, width: w, offsets, parts, shelfTop });

    for (const p of parts) {
      const isGlass = C.glassNames.includes(p.name);
      const inst = new THREE.InstancedMesh(p.geometry, isGlass ? glassMat : lidMat, count);
      inst.name = p.name + "_shelfRow";
      inst.castShadow = isGlass ? false : p.castShadow; // clear glass casts no solid shadow
      inst.receiveShadow = p.receiveShadow;
      inst.renderOrder = p.renderOrder;
      const m = new THREE.Matrix4();
      const t = new THREE.Matrix4();
      for (let i = 0; i < count; i++) {
        t.makeTranslation(offsets[i].x, offsets[i].y, offsets[i].z);
        inst.setMatrixAt(i, m.multiplyMatrices(t, p.matrixWorld));
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingBox();
      inst.computeBoundingSphere();
      inst.matrixAutoUpdate = false; // instance matrices are already in world space
      root.add(inst);
      inst.matrix.copy(root.matrixWorld).invert(); // root is the identity today; this keeps the copies in world space anyway
      inst.updateMatrixWorld(true);
      p.visible = false; // the row replaces the model's own copy
      meshes.push(inst);
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
        const b = new THREE.Box3();
        for (const p of r.parts) b.union(tmp.setFromObject(p).translate(r.offsets[i]));
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
    for (const g of C.groups) for (const n of g.parts) {
      const p = root.getObjectByName(n);
      if (p) p.visible = true;
    }
  }

  return { meshes, rows, check, setHighQuality, dispose };
}
