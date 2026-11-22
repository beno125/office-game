/**
 * Milk cartons on the fridge shelves (fridgeBodyLeft / fridgeBodyRight).
 *
 * Look: plain, generic gable-top cartons: a light carton with one coloured
 * band round its shoulders, a simple milk-drop icon and the word "MILK" in a
 * plain font, a soft tinted panel at the bottom, plain print-like lines on the
 * side / back, a light grey gable and a screw cap in the band's colour. Three
 * variants (MILK_CARTON_VARIANTS: blue, red, green), each its own small canvas
 * texture; one shared geometry; one InstancedMesh per variant.
 *
 * Size: real carton proportions (MILK_CARTONS.proportions), the total height
 * set from the shelves: heightShare × the smallest headroom of the shelves
 * used (× scale), so they look like real cartons in a real fridge.
 *
 * Shelves: found from each fridge body's own geometry (findFridgeShelves):
 * its horizontal faces, minus the outer box's top / bottom, sorted by height;
 * two faces closer than SHELF_MAX_THICKNESS form a shelf slab (its top face is
 * the surface), the lowest / highest of the rest are the inside's floor /
 * ceiling. A shelf's headroom is the next face above it.
 *
 * Arrangement: per shelf, tidy front-facing rows from the front edge back
 * (up to maxRows), as many evenly spaced columns as fit; one milk type per
 * column (a few columns each). A little seeded randomness (× jitter): a few
 * degrees of turn and small offsets, now and then a carton turned or out of
 * line a bit more, and rarely a gap (one taken). A carton whose jitter would
 * leave the shelf or touch a neighbour is placed with less, or straight. Each
 * stands exactly on its shelf's top surface. Static (no physics), like the
 * other props behind the fridges' closed glass doors.
 *
 * check() re-tests every carton (footprints against each other, the shelf top
 * and headroom, bounding boxes against the fridge body's triangles).
 */

/** Tuning (world units). */
export const MILK_CARTONS = {
  /** Real carton proportions (cm; a 2-litre gable-top): base width / depth, body height, gable height, fin height, cap radius / height. */
  proportions: { width: 9, depth: 9, body: 23, gable: 4.4, fin: 1.2, capRadius: 1.4, capHeight: 0.8 },
  /** Total height = heightShare × the smallest headroom of the shelves used, × scale (1 = that size). */
  heightShare: 0.92,
  scale: 1,
  /** Rows per shelf (from the front edge back), and the spacing: between columns, between rows, from the shelf's edges. */
  maxRows: 2,
  colGap: 0.1,
  rowGap: 0.14,
  edgeMargin: 0.1,
  /** Randomness (× jitter; 0 = perfectly straight rows): turn (radians, ±) and offset (±) of every carton; */
  jitter: 1,
  yawJitter: 0.05, // ~3°
  offsetJitter: 0.03,
  /** now and then one turned / out of line a bit more (share of cartons, turn, offset); */
  oddShare: 0.08,
  oddYaw: 0.17, // ~10°
  oddOffset: 0.08,
  /** and rarely a gap (share of slots left empty). */
  missingShare: 0.06,
  /** Columns of one milk type in a row (min..max). */
  typeRun: [1, 3],
  /** Placement seed (a different one per fridge). */
  seed: 2711,
  /** Material. */
  roughness: 0.55,
};

/** The milk types: band / cap colour, and how often each is stocked (relative). */
export const MILK_CARTON_VARIANTS = [
  { name: "blue", color: "#2f6fc0", share: 3 },
  { name: "red", color: "#d2453c", share: 2 },
  { name: "green", color: "#3f9a5a", share: 2 },
];

/** Two horizontal faces this close form one shelf slab. */
const SHELF_MAX_THICKNESS = 0.15;

// ---- Seeded random ----
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The shelves of a fridge body mesh, in world space:
 * [{ y (top surface), minX, maxX, minZ, maxZ, headroom }], lowest first.
 */
export function findFridgeShelves(THREE, mesh) {
  mesh.updateMatrixWorld(true);
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  const box = new THREE.Box3().setFromObject(mesh);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  const levels = []; // { y0, y1, minX, maxX, minZ, maxZ }
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld);
    nrm.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    if (nrm.lengthSq() < 1e-12) continue;
    nrm.normalize();
    if (Math.abs(nrm.y) < 0.95) continue; // not horizontal
    const y0 = Math.min(a.y, b.y, c.y), y1 = Math.max(a.y, b.y, c.y);
    let lv = levels.find((l) => Math.abs((l.y0 + l.y1) / 2 - (y0 + y1) / 2) < 0.02);
    if (!lv) levels.push((lv = { y0, y1, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }));
    lv.y0 = Math.min(lv.y0, y0);
    lv.y1 = Math.max(lv.y1, y1);
    for (const p of [a, b, c]) {
      lv.minX = Math.min(lv.minX, p.x);
      lv.maxX = Math.max(lv.maxX, p.x);
      lv.minZ = Math.min(lv.minZ, p.z);
      lv.maxZ = Math.max(lv.maxZ, p.z);
    }
  }
  // Not the outer box's top / bottom (they span the whole body).
  const inner = levels
    .filter((l) => !(Math.abs(l.minX - box.min.x) < 0.01 && Math.abs(l.maxX - box.max.x) < 0.01 && Math.abs(l.minZ - box.min.z) < 0.01 && Math.abs(l.maxZ - box.max.z) < 0.01))
    .sort((p, q) => p.y0 - q.y0);
  const shelves = [];
  for (let i = 0; i < inner.length - 1; i++) {
    const lo = inner[i], hi = inner[i + 1];
    if (hi.y0 - lo.y1 > SHELF_MAX_THICKNESS) continue;
    // A slab: lo is its underside, hi its top surface; headroom up to the next face above.
    const above = inner[i + 2];
    shelves.push({
      y: hi.y1,
      minX: Math.max(lo.minX, hi.minX),
      maxX: Math.min(lo.maxX, hi.maxX),
      minZ: Math.max(lo.minZ, hi.minZ),
      maxZ: Math.min(lo.maxZ, hi.maxZ),
      headroom: above ? above.y0 - hi.y1 : Infinity,
    });
    i++; // both faces used
  }
  return shelves;
}

// ---- Textures (one 512 × 512 canvas per milk type) ----
const ATLAS = 512;
const R_FRONT = { x: 0, y: 0, w: 190, h: 500 };
const R_SIDE = { x: 196, y: 0, w: 190, h: 500 };
const R_BACK = { x: 392, y: 0, w: 118, h: 300 };
const R_GABLE = { x: 392, y: 306, w: 118, h: 96 };
const R_CAP = { x: 392, y: 408, w: 118, h: 100 };
const FONT = "Arial, Helvetica, sans-serif";
const PAPER = "#f6f7f9";

function lines(ctx, x, y, w, rows, gap, color) {
  ctx.fillStyle = color;
  for (let i = 0; i < rows; i++) {
    const len = w * (0.6 + 0.4 * (((i * 37) % 10) / 10));
    ctx.fillRect(x, y + i * gap, len, 3);
  }
}

/** The band round the shoulders: solid colour, a white line, a thin colour line. */
function band(ctx, x, w, color, h) {
  ctx.fillStyle = color;
  ctx.fillRect(x, 0, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, h, w, 5);
  ctx.fillStyle = color;
  ctx.fillRect(x, h + 5, w, 3);
}

function tint(color, a) {
  const n = parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function makeVariantTexture(THREE, renderer, color) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ATLAS;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, ATLAS, ATLAS);
  // Front: band, "MILK", a drop, a tinted foot panel.
  {
    const { x, w, h } = R_FRONT;
    band(ctx, x, w, color, 72);
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `bold 50px ${FONT}`;
    ctx.fillText("MILK", x + w / 2, 175);
    // Drop: a circle with a point on top.
    const cx = x + w / 2, cy = 300, r = 34;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 2.1);
    ctx.bezierCurveTo(cx + r * 0.35, cy - r * 1.3, cx + r, cy - r * 0.6, cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI);
    ctx.bezierCurveTo(cx - r, cy - r * 0.6, cx - r * 0.35, cy - r * 1.3, cx, cy - r * 2.1);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.4, cy - r * 0.1, r * 0.16, r * 0.32, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = tint(color, 0.16);
    ctx.fillRect(x, h - 70, w, 70);
  }
  // Side: band, a light panel with print lines.
  {
    const { x, w, h } = R_SIDE;
    band(ctx, x, w, color, 72);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + 18, 120, w - 36, 260);
    lines(ctx, x + 30, 140, w - 60, 14, 17, "#a3acb6");
    ctx.fillStyle = tint(color, 0.16);
    ctx.fillRect(x, h - 70, w, 70);
  }
  // Back: band, print lines, a barcode.
  {
    const { x, w } = R_BACK;
    band(ctx, x, w, color, 44);
    lines(ctx, x + 12, 80, w - 24, 9, 15, "#a3acb6");
    ctx.fillStyle = "#2a2f38";
    for (let i = 0; i < 22; i++) ctx.fillRect(x + 22 + i * 3.4, 240, (i * 7) % 3 === 0 ? 2.2 : 1.1, 40);
  }
  // Gable: light grey board.
  {
    const G = R_GABLE;
    const gg = ctx.createLinearGradient(0, G.y, 0, G.y + G.h);
    gg.addColorStop(0, "#f2f4f6");
    gg.addColorStop(1, "#dfe3e7");
    ctx.fillStyle = gg;
    ctx.fillRect(G.x, G.y, G.w, G.h);
  }
  // Cap: the band's colour, with ribs.
  {
    const C = R_CAP;
    ctx.fillStyle = color;
    ctx.fillRect(C.x, C.y, C.w, C.h);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    for (let i = 0; i < 16; i++) ctx.fillRect(C.x + i * 7.4, C.y, 2.5, C.h);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  tex.needsUpdate = true;
  return tex;
}

// ---- The carton geometry (bottom centre at the origin, front facing +z) ----
function buildCartonGeometry(THREE, dims) {
  const W = dims.width / 2, D = dims.depth / 2, Hb = dims.body, Hg = dims.gable;
  const pos = [], nor = [], uv = [];
  const uvOf = (R, s, t) => [(R.x + s * R.w) / ATLAS, 1 - (R.y + (1 - t) * R.h) / ATLAS];
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const face = (p, R, st, order) => {
    const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0])).normalize();
    for (const k of order) {
      pos.push(p[k].x, p[k].y, p[k].z);
      nor.push(n.x, n.y, n.z);
      uv.push(...uvOf(R, st[k][0], st[k][1]));
    }
  };
  const quad = (p, R, st) => face(p, R, st, [0, 1, 2, 0, 2, 3]);
  const tri = (p, R, st) => face(p, R, st, [0, 1, 2]);
  const full = [[0, 0], [1, 0], [1, 1], [0, 1]];
  // Body: front, right, back, left (the bottom stands on the shelf; the gable covers the top).
  quad([v3(-W, 0, D), v3(W, 0, D), v3(W, Hb, D), v3(-W, Hb, D)], R_FRONT, full);
  quad([v3(W, 0, D), v3(W, 0, -D), v3(W, Hb, -D), v3(W, Hb, D)], R_SIDE, full);
  quad([v3(W, 0, -D), v3(-W, 0, -D), v3(-W, Hb, -D), v3(W, Hb, -D)], R_BACK, full);
  quad([v3(-W, 0, -D), v3(-W, 0, D), v3(-W, Hb, D), v3(-W, Hb, -D)], R_SIDE, full);
  // Gable: front and back slopes to a ridge along x, end triangles, and the fin.
  const top = Hb + Hg;
  quad([v3(-W, Hb, D), v3(W, Hb, D), v3(W, top, 0), v3(-W, top, 0)], R_GABLE, full);
  quad([v3(W, Hb, -D), v3(-W, Hb, -D), v3(-W, top, 0), v3(W, top, 0)], R_GABLE, full);
  tri([v3(W, Hb, D), v3(W, Hb, -D), v3(W, top, 0)], R_GABLE, [[0, 0], [1, 0], [0.5, 1]]);
  tri([v3(-W, Hb, -D), v3(-W, Hb, D), v3(-W, top, 0)], R_GABLE, [[0, 0], [1, 0], [0.5, 1]]);
  const ft = dims.width * 0.018, fh = top + dims.fin;
  quad([v3(-W, top, ft), v3(W, top, ft), v3(W, fh, ft), v3(-W, fh, ft)], R_GABLE, full);
  quad([v3(W, top, -ft), v3(-W, top, -ft), v3(-W, fh, -ft), v3(W, fh, -ft)], R_GABLE, full);
  quad([v3(-W, fh, ft), v3(W, fh, ft), v3(W, fh, -ft), v3(-W, fh, -ft)], R_GABLE, full);
  quad([v3(W, top, ft), v3(W, top, -ft), v3(W, fh, -ft), v3(W, fh, ft)], R_GABLE, full);
  quad([v3(-W, top, -ft), v3(-W, top, ft), v3(-W, fh, ft), v3(-W, fh, -ft)], R_GABLE, full);
  // Cap: on the front slope's middle, standing on it (along its normal).
  const cap = new THREE.CylinderGeometry(dims.capRadius, dims.capRadius * 1.04, dims.capHeight, 20, 1, false);
  const capUv = cap.attributes.uv;
  for (let i = 0; i < capUv.count; i++) {
    const [u, v] = uvOf(R_CAP, capUv.getX(i), capUv.getY(i));
    capUv.setXY(i, u, v);
  }
  const slopeN = new THREE.Vector3(0, D, Hg).normalize();
  const capQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), slopeN);
  const capAt = new THREE.Vector3(0, Hb + Hg / 2, D / 2).addScaledVector(slopeN, dims.capHeight / 2);
  cap.applyMatrix4(new THREE.Matrix4().compose(capAt, capQ, new THREE.Vector3(1, 1, 1)));
  const capNI = cap.toNonIndexed();
  const geo = new THREE.BufferGeometry();
  const add = (name, arr, size) => {
    const b = capNI.attributes[name].array;
    const out = new Float32Array(arr.length + b.length);
    out.set(arr, 0);
    out.set(b, arr.length);
    geo.setAttribute(name, new THREE.BufferAttribute(out, size));
  };
  add("position", pos, 3);
  add("normal", nor, 3);
  add("uv", uv, 2);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** The carton's footprint corners (xz) at (x, z) turned by yaw. */
function footprint(x, z, yaw, hw, hd) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // Rotation about +y: local (lx, lz) → world (lx c + lz s, -lx s + lz c).
  const pts = [];
  for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) pts.push([x + lx * c + lz * s, z - lx * s + lz * c]);
  return pts;
}

/** Do two convex footprints (4 corners each) overlap, with a gap? (SAT on both squares' edges.) */
function footprintsOverlap(A, B, gap) {
  for (const P of [A, B]) {
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = P[i], [x1, z1] = P[(i + 1) % 4];
      let nx = -(z1 - z0), nz = x1 - x0;
      const l = Math.hypot(nx, nz) || 1;
      nx /= l;
      nz /= l;
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const [x, z] of A) { const d = x * nx + z * nz; amin = Math.min(amin, d); amax = Math.max(amax, d); }
      for (const [x, z] of B) { const d = x * nx + z * nz; bmin = Math.min(bmin, d); bmax = Math.max(bmax, d); }
      if (amax + gap <= bmin || bmax + gap <= amin) return false;
    }
  }
  return true;
}

/**
 * Builds the cartons on the shelves of `fridgeMeshes` and adds them to `scene`.
 * @returns {{ meshes, placements: {x, y, z, yaw, shelf, variant}[], shelves, dims, check(): object, dispose(): void }}
 */
export function createMilkCartons({ THREE, scene, renderer, fridgeMeshes }) {
  const C = MILK_CARTONS;
  const P = C.proportions;
  // Shelves of every fridge.
  const shelvesAll = [];
  const perFridge = [];
  fridgeMeshes.forEach((fridge, fi) => {
    if (!fridge || !fridge.isMesh) return;
    const list = findFridgeShelves(THREE, fridge).map((sh) => ({ fridge: fridge.name, fi, ...sh }));
    perFridge.push(list);
    shelvesAll.push(...list);
  });
  if (!shelvesAll.length) return null;
  // Size: from the smallest headroom.
  const minHead = Math.min(...shelvesAll.map((s) => s.headroom));
  const totalCm = P.body + P.gable + P.fin;
  const k = (C.heightShare * minHead * C.scale) / totalCm; // world units per cm
  const dims = {
    width: P.width * k,
    depth: P.depth * k,
    body: P.body * k,
    gable: P.gable * k,
    fin: P.fin * k,
    capRadius: P.capRadius * k,
    capHeight: P.capHeight * k,
  };
  const height = dims.body + dims.gable + dims.fin;
  const hw = dims.width / 2, hd = dims.depth / 2;
  const J = C.jitter;
  const shareSum = MILK_CARTON_VARIANTS.reduce((a, v) => a + v.share, 0);
  const pickVariant = (r) => {
    let t = r * shareSum;
    for (let i = 0; i < MILK_CARTON_VARIANTS.length; i++) {
      t -= MILK_CARTON_VARIANTS[i].share;
      if (t <= 0) return i;
    }
    return 0;
  };
  const placements = [];
  perFridge.forEach((shelves) => {
    shelves.forEach((sh) => {
      const shelfIndex = shelvesAll.indexOf(sh);
      if (sh.headroom < height + 0.02) return; // too low (only with scale > 1)
      const rand = mulberry32(C.seed + sh.fi * 977 + shelfIndex * 131);
      const m = C.edgeMargin;
      const usableW = sh.maxX - sh.minX - 2 * m;
      const usableD = sh.maxZ - sh.minZ - 2 * m;
      const cols = Math.max(0, Math.floor((usableW + C.colGap) / (dims.width + C.colGap)));
      const rows = Math.min(C.maxRows, Math.max(0, Math.floor((usableD + C.rowGap) / (dims.depth + C.rowGap))));
      if (!cols || !rows) return;
      // Even spacing across the shelf (the spare width shared out between the columns).
      const step = cols > 1 ? (usableW - dims.width) / (cols - 1) : 0;
      const x0 = cols > 1 ? sh.minX + m + hw : (sh.minX + sh.maxX) / 2;
      // A milk type per column, in runs of a few columns.
      const colType = [];
      while (colType.length < cols) {
        const type = pickVariant(rand());
        const run = C.typeRun[0] + Math.floor(rand() * (C.typeRun[1] - C.typeRun[0] + 1));
        for (let i = 0; i < run && colType.length < cols; i++) colType.push(type);
      }
      const placed = [];
      for (let r = 0; r < rows; r++) {
        const zRow = sh.maxZ - m - hd - r * (dims.depth + C.rowGap); // front row first
        for (let c = 0; c < cols; c++) {
          if (rand() < C.missingShare * J) continue; // one taken
          const odd = rand() < C.oddShare * J;
          const yawAmp = (odd ? C.oddYaw : C.yawJitter) * J;
          const offAmp = (odd ? C.oddOffset : C.offsetJitter) * J;
          const jy = (rand() * 2 - 1) * yawAmp, jx = (rand() * 2 - 1) * offAmp, jz = (rand() * 2 - 1) * offAmp;
          const bx = x0 + c * step, bz = zRow;
          // Full jitter, then less, then straight: the first that stays on the shelf and clear of its neighbours.
          for (const f of [1, 0.5, 0]) {
            const x = bx + jx * f, z = bz + jz * f, yaw = jy * f;
            const fp = footprint(x, z, yaw, hw, hd);
            const inside = fp.every(([px, pz]) => px >= sh.minX + m * 0.5 && px <= sh.maxX - m * 0.5 && pz >= sh.minZ + m * 0.5 && pz <= sh.maxZ - m * 0.5);
            if (!inside) continue;
            if (placed.some((o) => footprintsOverlap(o.fp, fp, 0.02))) continue;
            placed.push({ x, z, yaw, fp, variant: colType[c] });
            break;
          }
        }
      }
      for (const p of placed) placements.push({ x: p.x, y: sh.y, z: p.z, yaw: p.yaw, shelf: shelfIndex, variant: p.variant, fp: p.fp });
    });
  });
  // One geometry, a texture / material and an InstancedMesh per milk type.
  const geo = buildCartonGeometry(THREE, dims);
  const meshes = MILK_CARTON_VARIANTS.map((v) => {
    const mat = new THREE.MeshStandardMaterial({ map: makeVariantTexture(THREE, renderer, v.color), roughness: C.roughness, metalness: 0 });
    const n = placements.filter((p) => p.variant === MILK_CARTON_VARIANTS.indexOf(v)).length;
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    mesh.name = "milkCartons_" + v.name;
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  });
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const matrixOf = (p, out) => out.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(up, p.yaw), one);
  for (const p of placements) {
    const mesh = meshes[p.variant];
    mesh.setMatrixAt(mesh.count++, matrixOf(p, mtx));
  }
  for (const mesh of meshes) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.visible = mesh.count > 0;
    scene.add(mesh);
  }

  /** Re-tests every carton: each other, its shelf (exactly on it, inside it, headroom), and the fridge bodies' triangles. */
  function check() {
    const issues = [];
    const boxes = placements.map((p) => geo.boundingBox.clone().applyMatrix4(matrixOf(p, mtx)));
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        if (placements[i].shelf !== placements[j].shelf) continue;
        if (footprintsOverlap(placements[i].fp, placements[j].fp, 0)) issues.push(`cartons ${i} and ${j} overlap`);
      }
    }
    placements.forEach((p, i) => {
      const sh = shelvesAll[p.shelf];
      const b = boxes[i];
      if (Math.abs(b.min.y - sh.y) > 1e-4) issues.push(`carton ${i}: bottom ${b.min.y.toFixed(4)} vs shelf ${sh.y.toFixed(4)}`);
      if (b.max.y > sh.y + sh.headroom - 1e-4) issues.push(`carton ${i}: top ${b.max.y.toFixed(3)} above headroom`);
      if (!p.fp.every(([x, z]) => x >= sh.minX && x <= sh.maxX && z >= sh.minZ && z <= sh.maxZ)) issues.push(`carton ${i}: off its shelf`);
    });
    const tri = new THREE.Triangle();
    const a = new THREE.Vector3(), b2 = new THREE.Vector3(), c2 = new THREE.Vector3();
    for (const fridge of fridgeMeshes) {
      if (!fridge || !fridge.isMesh) continue;
      const pos = fridge.geometry.attributes.position;
      const idx = fridge.geometry.index;
      const n = idx ? idx.count : pos.count;
      for (let t = 0; t < n; t += 3) {
        a.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(fridge.matrixWorld);
        b2.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(fridge.matrixWorld);
        c2.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(fridge.matrixWorld);
        tri.set(a, b2, c2);
        boxes.forEach((bx, i) => {
          const lifted = bx.clone();
          lifted.min.y += 1e-3; // standing on the shelf is not a hit
          if (lifted.intersectsTriangle(tri)) issues.push(`carton ${i} touches ${fridge.name} (triangle ${t / 3})`);
        });
      }
    }
    return { cartons: placements.length, shelves: shelvesAll, dims, boxes, issues };
  }

  return {
    meshes,
    placements,
    shelves: shelvesAll,
    dims,
    check,
    dispose() {
      for (const mesh of meshes) {
        scene.remove(mesh);
        mesh.material.map.dispose();
        mesh.material.dispose();
      }
      geo.dispose();
    },
  };
}
