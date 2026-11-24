/**
 * Stacks of nested plastic drinking cups on the left top closet's lower shelf
 * (ul-kitchen28: the cup "glassInnerWhite1" + "glassColor1" on shelf2).
 *
 * The cup: glassInnerWhite1 is the cup itself (walls, an inner floor, a lip),
 * white plastic; glassColor1 is a coloured sleeve on its outer wall. They stay
 * together as one unit (as modelled).
 *
 * Nesting: from the cup's own vertices: its outer envelope (the widest of both
 * parts at each height) and its inner wall (the white part's narrowest radius
 * at each height above its inner floor), as piecewise-linear profiles round
 * the cup's axis. The nesting step is the smallest lift for which a cup's
 * outer envelope stays inside the cup below's inner wall everywhere they
 * overlap (+ a small clearance), and its bottom above that cup's inner floor:
 * each cup rests in the one below like real nested cups.
 *
 * Shelf: the stacks stand on shelf2 from its left end (between the metal
 * frame's end members), in rows, evenly spaced, the taller stacks in the back
 * row, all the same way round, each stack nudged and turned very slightly (seeded). Every stack
 * stands exactly on the shelf's top surface.
 *
 * Colours (the reference photo's pastels): per cup, weighted, never more than
 * two of the same colour in a row. One InstancedMesh for all the white cups and
 * one per colour for the sleeves (shared geometry and materials).
 */
export const KITCHEN_CUP_STACKS = {
  cupParts: ["glassInnerWhite1", "glassColor1"], // [the cup (white), its sleeve (coloured)]
  shelf: "shelf2",
  bay: [-38.358, -24.12], // usable length (x): between the frame's end members at shelf height
  cupsPerStack: { 3: 0.7, 2: 0.2, 1: 0.1 }, // how many cups a stack has (weights)
  spacing: 0.35, // gap between neighbouring stacks (model units; a cup is 1.13 across)…
  spacingJitter: 0.14, // …± this per gap (× randomness), never under minGap
  minGap: 0.12,
  maxCols: 8, // stacks per row at most (the group from the shelf's left end)
  maxRows: 2, // rows at most (the shelf could take 3)
  rowSpacing: 0.35, // gap between rows
  backClearance: 0.08, // from the shelf's back edge
  edgeClearance: 0.08, // from the bay's ends and the shelf's front edge
  nestClearance: 0.006, // between a cup's outside and the inside of the cup below
  randomness: 1, // × the jitter below (0 = perfectly aligned)
  jitter: { along: 0.04, across: 0.04, yawDeg: 2 }, // per stack (1 unit ≈ 5.6 cm: 0.04 ≈ 2 mm)
  seed: 1977,
  colors: [
    { name: "pink", hex: 0xd6b4c5, weight: 0.5 }, // the reference's pink-lilac, muted (most of the cups)
    { name: "yellow", hex: 0xd8bc78, weight: 0.25 }, // butter yellow, muted
    { name: "blue", hex: 0xa6bccb, weight: 0.25 }, // powder blue, muted
  ],
  maxRun: 2, // never more than this many cups of one colour in a row
  white: { color: 0xdedad4, roughness: 0.42, metalness: 0 },
  selfLight: 0.32, // their own soft light at first (then the kitchen's pastel self-light: dark 0.32 / bright 0.22)…
  selfLightColor: 0.38, // …in their colour × this (less than the soap dispensers: they read too bright)
  plastic: { roughness: 0.5, metalness: 0 },
};

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Piecewise-linear radius at height h through sorted points [{h, r}] (clamped to the ends). */
function profileAt(pts, h) {
  if (h <= pts[0].h) return pts[0].r;
  for (let i = 1; i < pts.length; i++) {
    if (h <= pts[i].h) {
      const a = pts[i - 1], b = pts[i];
      return a.r + ((b.r - a.r) * (h - a.h)) / Math.max(1e-9, b.h - a.h);
    }
  }
  return pts[pts.length - 1].r;
}

/**
 * @param {object} o
 * @param {typeof import("three")} o.THREE
 * @param {import("three").Object3D} o.root  the kitchen model
 * @param {import("three").Texture|null} [o.envMap]  a soft reflection for the plastic
 */
export function createCupStacks({ THREE, root, envMap = null }) {
  const C = KITCHEN_CUP_STACKS;
  const R = C.randomness;
  const rand = seeded(C.seed);
  root.updateMatrixWorld(true);
  const byName = (n) => {
    const m = root.getObjectByName(n);
    return m && m.isMesh ? m : null;
  };
  const missing = [...C.cupParts, C.shelf].filter((n) => !byName(n));
  if (missing.length) throw new Error("Cup stacks: missing in the model: " + missing.join(", "));
  const [white, sleeve] = C.cupParts.map(byName);
  const shelf = byName(C.shelf);

  // ── The cup's profile round its axis ────────────────────────────────────
  const cupBox = new THREE.Box3().setFromObject(white).union(new THREE.Box3().setFromObject(sleeve));
  const axis = new THREE.Box3().setFromObject(white).getCenter(new THREE.Vector3());
  const bottomY = cupBox.min.y;
  const v = new THREE.Vector3();
  /** Per height level of a mesh (rounded): min and max radius round the axis (world space). */
  function levels(mesh) {
    const L = new Map();
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const h = Math.round((v.y - bottomY) * 1000) / 1000;
      const r = Math.hypot(v.x - axis.x, v.z - axis.z);
      const e = L.get(h) || { h, min: Infinity, max: -Infinity };
      e.min = Math.min(e.min, r);
      e.max = Math.max(e.max, r);
      L.set(h, e);
    }
    return [...L.values()].sort((a, b) => a.h - b.h);
  }
  const wl = levels(white);
  const sl = levels(sleeve);
  // Outer envelope: the widest of both parts at each of their levels (each part interpolated at the other's levels).
  const allH = [...new Set([...wl, ...sl].map((e) => e.h))].sort((a, b) => a - b);
  const wMax = wl.map((e) => ({ h: e.h, r: e.max }));
  const sMax = sl.map((e) => ({ h: e.h, r: e.max }));
  const outer = allH.map((h) => ({
    h,
    r: Math.max(h >= wl[0].h && h <= wl[wl.length - 1].h ? profileAt(wMax, h) : 0, h >= sl[0].h && h <= sl[sl.length - 1].h ? profileAt(sMax, h) : 0),
  }));
  // Inner wall: the white cup's narrowest radius at each level above its outer bottom (the lowest level is the outer base).
  const inner = wl.slice(1).map((e) => ({ h: e.h, r: e.min }));
  const floorH = inner[0].h; // the inner floor
  const topH = inner[inner.length - 1].h; // the rim
  const cupH = allH[allH.length - 1];
  // The nesting step: the smallest lift d ≥ floorH with outer(h) + clearance ≤ inner(h + d) wherever h + d is inside.
  /** Does a cup lifted by d fit inside the one below? (sampled finely, and at every profile point of both) */
  const fits = (d) => {
    const hs = [];
    for (let k = 0; k <= 600; k++) hs.push((cupH * k) / 600);
    for (const p of outer) hs.push(p.h);
    for (const p of inner) hs.push(p.h - d);
    for (const h of hs) {
      if (h < 0 || h > cupH) continue;
      const hh = h + d;
      if (hh > topH + 1e-9) continue; // above the cup below's rim: free
      if (profileAt(outer, h) + C.nestClearance > profileAt(inner, hh)) return false;
    }
    return true;
  };
  let nest = cupH;
  for (let d = floorH; d < cupH; d += 0.0005) {
    if (fits(d)) {
      nest = d;
      break;
    }
  }
  const cupD = 2 * Math.max(...outer.map((p) => p.r));

  // ── Layout on the shelf ─────────────────────────────────────────────────
  const shelfBox = new THREE.Box3().setFromObject(shelf);
  const shelfTop = shelfBox.max.y;
  const L = C.bay[1] - C.bay[0] - 2 * C.edgeClearance;
  const D = shelfBox.max.z - shelfBox.min.z - C.backClearance - C.edgeClearance;
  const cols = Math.max(1, Math.min(C.maxCols, Math.floor((L + C.spacing) / (cupD + C.spacing))));
  const rows = Math.max(1, Math.min(C.maxRows, Math.floor((D + C.rowSpacing) / (cupD + C.rowSpacing))));
  const gapX = C.spacing;
  const rowW = rows * cupD + (rows - 1) * C.rowSpacing;
  const z0 = shelfBox.min.z + C.backClearance + (D - rowW) / 2 + cupD / 2;
  const x0 = C.bay[0] + C.edgeClearance + cupD / 2; // the group from the shelf's left end

  // Colours: weighted, never more than maxRun in a row (in placing order).
  const totalW = C.colors.reduce((a, c) => a + c.weight, 0);
  const seq = [];
  function nextColor() {
    for (;;) {
      let u = rand() * totalW;
      let ci = 0;
      while (u > C.colors[ci].weight && ci < C.colors.length - 1) u -= C.colors[ci++].weight;
      const n = seq.length;
      if (n >= C.maxRun && seq.slice(n - C.maxRun).every((c) => c === ci)) continue;
      seq.push(ci);
      return ci;
    }
  }
  const stackW = Object.entries(C.cupsPerStack).map(([k, w]) => ({ k: +k, w }));
  const stackTotal = stackW.reduce((a, s) => a + s.w, 0);
  const pickCount = () => {
    let u = rand() * stackTotal;
    for (const s of stackW) if ((u -= s.w) <= 0) return s.k;
    return stackW[0].k;
  };

  // Per cup: its whole-unit matrix (from the modelled cup) and its colour.
  const cups = []; // { m: Matrix4, color, stack, level }
  const stacks = [];
  const base = new THREE.Matrix4().makeTranslation(-axis.x, -bottomY, -axis.z); // the cup to its axis / bottom
  // Stack heights: drawn for the whole shelf, the tallest to the back rows (row 0 is at the back), shuffled within
  // each row.
  const heights = Array.from({ length: rows * cols }, pickCount).sort((a, b) => b - a);
  const rowHeights = [];
  for (let r = 0; r < rows; r++) {
    const row = heights.slice(r * cols, (r + 1) * cols);
    for (let i = row.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [row[i], row[j]] = [row[j], row[i]];
    }
    rowHeights.push(row);
  }
  for (let r = 0; r < rows; r++) {
    let rowX = x0;
    for (let c = 0; c < cols; c++) {
      const n = rowHeights[r][c];
      // Each gap a little different (the row still starts at the left end).
      if (c > 0) rowX += cupD + Math.max(C.minGap, gapX + (rand() * 2 - 1) * C.spacingJitter * R);
      const sx = rowX + (rand() * 2 - 1) * C.jitter.along * R;
      const sz = z0 + r * (cupD + C.rowSpacing) + (rand() * 2 - 1) * C.jitter.across * R;
      const yaw = THREE.MathUtils.degToRad((rand() * 2 - 1) * C.jitter.yawDeg * R);
      const stack = { x: sx, z: sz, yaw, cups: [] };
      for (let i = 0; i < n; i++) {
        const m = new THREE.Matrix4()
          .makeTranslation(sx, shelfTop + i * nest, sz)
          .multiply(new THREE.Matrix4().makeRotationY(yaw))
          .multiply(base);
        const cup = { m, color: nextColor(), stack: stacks.length, level: i };
        cups.push(cup);
        stack.cups.push(cup);
      }
      stacks.push(stack);
    }
  }

  // ── Meshes: the white cups, and the sleeves per colour ─────────────────
  const group = new THREE.Group();
  group.name = "kitchenCupStacks";
  // Like the kitchen's other pastel plastics (the soap dispensers): a soft light of their own colour, so they read in
  // the closets' shade (the kitchen drives it with its dark / bright mode: pastelMaterials).
  const glowOf = (hex) => new THREE.Color(hex).multiplyScalar(C.selfLightColor);
  const whiteMat = new THREE.MeshStandardMaterial({ ...C.white, envMap, envMapIntensity: 0.25, emissive: glowOf(C.white.color), emissiveIntensity: C.selfLight });
  const colorMats = C.colors.map(
    // Double-sided as in the model (glassColor1's faces point into the cup: its outside is their back).
    (c) => new THREE.MeshStandardMaterial({ color: c.hex, ...C.plastic, side: THREE.DoubleSide, envMap, envMapIntensity: 0.2, emissive: glowOf(c.hex), emissiveIntensity: C.selfLight }),
  );
  const meshes = [];
  const place = (geo, mat, list, partMatrix, name) => {
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    inst.name = name;
    const t = new THREE.Matrix4();
    list.forEach((cup, i) => inst.setMatrixAt(i, t.multiplyMatrices(cup.m, partMatrix)));
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.computeBoundingBox();
    inst.computeBoundingSphere();
    inst.matrixAutoUpdate = false;
    group.add(inst);
    meshes.push(inst);
  };
  place(white.geometry, whiteMat, cups, white.matrixWorld, "kitchenCupWhite");
  C.colors.forEach((c, ci) =>
    place(sleeve.geometry, colorMats[ci], cups.filter((cup) => cup.color === ci), sleeve.matrixWorld, "kitchenCupSleeve_" + c.name),
  );
  root.add(group);
  group.matrix.copy(root.matrixWorld).invert(); // world-space instance matrices under the root (the identity today)
  group.matrixAutoUpdate = false;
  group.updateMatrixWorld(true);
  white.visible = false;
  sleeve.visible = false;

  /** A cup's world box from its parts' vertices. */
  const cupBoxOf = (cup, target) => {
    target.makeEmpty();
    for (const part of [white, sleeve]) {
      const pos = part.geometry.attributes.position;
      const m = new THREE.Matrix4().multiplyMatrices(cup.m, part.matrixWorld);
      for (let i = 0; i < pos.count; i++) target.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
    }
    return target;
  };

  /**
   * Checks: every stack's bottom on the shelf top; the nesting (each cup's outside inside the one below's inside,
   * from the profiles); stacks inside the bay and the shelf, under the shelf above, not touching each other; every
   * cup's box against every triangle of every other visible mesh near it (triangle bounds; the shelf top touch
   * excluded by `eps`).
   */
  function check(eps = 1e-3) {
    const issues = [];
    const stackBoxes = stacks.map((s) => {
      const b = new THREE.Box3();
      for (const cup of s.cups) b.union(cupBoxOf(cup, new THREE.Box3()));
      return b;
    });
    stackBoxes.forEach((b, i) => {
      if (Math.abs(b.min.y - shelfTop) > 1e-3) issues.push(`stack ${i}: bottom ${b.min.y.toFixed(4)} not on the shelf (${shelfTop.toFixed(4)})`);
      if (b.min.x < C.bay[0] || b.max.x > C.bay[1] || b.min.z < shelfBox.min.z || b.max.z > shelfBox.max.z) issues.push(`stack ${i}: off its shelf`);
    });
    for (let a = 0; a < stackBoxes.length; a++)
      for (let b = a + 1; b < stackBoxes.length; b++)
        if (stackBoxes[a].clone().expandByScalar(-eps).intersectsBox(stackBoxes[b])) issues.push(`stacks ${a} and ${b} overlap`);
    // Nesting, from the profiles at the actual step.
    for (let k = 0; k <= 1000; k++) {
      const h = (cupH * k) / 1000;
      if (h + nest > topH) break;
      if (profileAt(outer, h) > profileAt(inner, h + nest)) issues.push(`nesting: walls meet at h ${h.toFixed(3)}`);
    }
    const own = new Set([white, sleeve, ...meshes]);
    const zone = new THREE.Box3();
    stackBoxes.forEach((b) => zone.union(b));
    const tri = new THREE.Box3();
    const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const nb = new THREE.Box3();
    root.traverse((n) => {
      if (!n.isMesh || own.has(n) || !n.visible) return;
      if (n.isInstancedMesh) {
        // Instanced props (the glass jars, plant leaves...): each instance's box.
        const g = n.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        const im = new THREE.Matrix4();
        for (let i = 0; i < n.count; i++) {
          n.getMatrixAt(i, im);
          nb.copy(g.boundingBox).applyMatrix4(im).applyMatrix4(n.matrixWorld);
          stackBoxes.forEach((b, si) => {
            if (b.clone().expandByScalar(-eps).intersectsBox(nb)) issues.push(`stack ${si} overlaps ${n.name}#${i}`);
          });
        }
        return;
      }
      nb.setFromObject(n);
      if (!nb.intersectsBox(zone)) return;
      const hits = stackBoxes.map((b, si) => [b.clone().expandByScalar(-eps), si]).filter(([b]) => b.intersectsBox(nb));
      if (!hits.length) return;
      const pos = n.geometry.attributes.position;
      const idx = n.geometry.index;
      const triCount = idx ? idx.count / 3 : pos.count / 3;
      for (let t = 0; t < triCount; t++) {
        for (let k = 0; k < 3; k++) p[k].fromBufferAttribute(pos, idx ? idx.getX(t * 3 + k) : t * 3 + k).applyMatrix4(n.matrixWorld);
        tri.setFromPoints(p);
        for (const [b, si] of hits) if (b.intersectsBox(tri)) issues.push(`stack ${si} overlaps ${n.name}`);
      }
    });
    return { issues: [...new Set(issues)] };
  }

  function dispose() {
    group.removeFromParent();
    for (const m of meshes) m.dispose();
    whiteMat.dispose();
    colorMats.forEach((m) => m.dispose());
    white.visible = true;
    sleeve.visible = true;
  }

  const counts = C.colors.map((c, ci) => ({ color: c.name, cups: cups.filter((cup) => cup.color === ci).length }));
  const report = {
    shelf: C.shelf,
    usable: { length: +(C.bay[1] - C.bay[0]).toFixed(3), depth: +(shelfBox.max.z - shelfBox.min.z).toFixed(3), top: +shelfTop.toFixed(3) },
    cup: { height: +cupH.toFixed(3), diameter: +cupD.toFixed(3), innerFloor: floorH, rim: topH },
    nestStep: +nest.toFixed(4),
    profiles: { outer: outer.map((p) => [p.h, +p.r.toFixed(3)]), inner: inner.map((p) => [p.h, +p.r.toFixed(3)]) },
    headroom: +(new THREE.Box3().setFromObject(root.getObjectByName("shelf1") || shelf).min.y - shelfTop).toFixed(3),
    rows,
    cols,
    stacks: stacks.length,
    cups: cups.length,
    perStack: [1, 2, 3].map((k) => ({ cups: k, stacks: stacks.filter((s) => s.cups.length === k).length })),
    colors: counts,
  };
  return { group, meshes, check, dispose, report, pastelMaterials: [whiteMat, ...colorMats] };
}
