/**
 * Milk cartons on the fridge shelves (fridgeBodyLeft / fridgeBodyRight).
 *
 * Look: after the reference photo (a 1-litre gable-top carton): a white body
 * with a blue gingham band round its shoulders, "חלב טרי" in dark blue, a
 * round picture (sky, green hills, a white house with a red roof, a tree), a
 * "3%" badge, a little speech bubble, "1 ליטר" with small print and a green
 * stamp on the front; a green information panel on the sides; fine print and
 * a barcode on the back; a light grey gable with a fin and a grey screw cap.
 * The brand is invented, in the reference's style: a blue emblem (hills under
 * a sun), the name "שדמות" in bold italic blue and a small red "since 1952"
 * seal. Drawn once on a canvas (one texture atlas); one geometry; one
 * InstancedMesh for every carton in both fridges.
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
 * Arrangement: a small, tidy group in each shelf's inner left corner (at the
 * back, on the left as seen through the door): rows of groupColumns, filled
 * from the back row and the left, all facing the door, with a little seeded
 * randomness (a couple of degrees, small offsets). A carton whose jitter would
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
  /** Cartons per shelf (lower shelf, upper shelf), per fridge; fewer if they don't fit. */
  perShelf: [6, 5],
  /** The group: cartons per row (left to right), and the spacing: between cartons, between rows, from the shelf's back / left edges. */
  groupColumns: 3,
  colGap: 0.06,
  rowGap: 0.08,
  edgeMargin: 0.1,
  /** Randomness (× jitter; 0 = perfectly straight): turn (radians, ±) and offset (±) of each carton. */
  jitter: 1,
  yawJitter: 0.035, // ~2°
  offsetJitter: 0.025,
  /** Placement seed (a different one per fridge / shelf). */
  seed: 2711,
  /** Material. */
  roughness: 0.55,
};

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

// ---- The texture atlas (1024 × 1024) ----
const ATLAS = 1024;
const R_FRONT = { x: 0, y: 0, w: 400, h: 1016 };
const R_SIDE = { x: 408, y: 0, w: 400, h: 1016 };
const R_BACK = { x: 816, y: 0, w: 208, h: 600 };
const R_GABLE = { x: 816, y: 608, w: 208, h: 200 };
const R_CAP = { x: 816, y: 816, w: 208, h: 200 };
const BLUE = "#1d4a9a";
const NAVY = "#183a78";
const HEB_FONT = '"Arial Hebrew", "Noto Sans Hebrew", Arial, sans-serif';

function drawGingham(ctx, x, y, w, h, cell) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, w, h);
  const cols = Math.ceil(w / cell) + 1, rows = Math.ceil(h / cell) + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sr = r % 2 === 0, sc = c % 2 === 0;
      if (!sr && !sc) continue;
      ctx.fillStyle = sr && sc ? BLUE : "#8ea9db";
      ctx.fillRect(x + c * cell, y + r * cell, cell, cell);
    }
  }
  ctx.restore();
}

function textLines(ctx, x, y, w, rows, gap, color) {
  ctx.fillStyle = color;
  for (let i = 0; i < rows; i++) {
    const len = w * (0.55 + 0.45 * ((i * 37) % 10) / 10);
    ctx.fillRect(x + w - len, y + i * gap, len, 4);
  }
}

function drawFront(ctx) {
  const { x, y, w, h } = R_FRONT;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#f3f5f6";
  ctx.fillRect(0, 0, w, h);
  // Shoulder band.
  drawGingham(ctx, 0, 0, w, 150, 25);
  ctx.fillStyle = "#e4e8eb";
  ctx.fillRect(0, 150, w, 6);
  ctx.direction = "rtl";
  ctx.textAlign = "center";
  // Invented brand in the reference's style: a blue emblem (hills under a sun), the name "שדמות" in bold
  // italic blue, and a small red "since" seal (not a real brand or logo).
  ctx.fillStyle = BLUE;
  ctx.beginPath();
  ctx.arc(330, 222, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(330, 214, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(306, 236);
  ctx.quadraticCurveTo(320, 222, 334, 232);
  ctx.quadraticCurveTo(344, 224, 354, 234);
  ctx.lineTo(354, 240);
  ctx.lineTo(306, 240);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = BLUE;
  ctx.font = `italic 900 48px ${HEB_FONT}`;
  ctx.fillText("שדמות", 222, 240);
  ctx.fillStyle = "#d0322b";
  ctx.beginPath();
  ctx.ellipse(92, 224, 40, 24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 15px ${HEB_FONT}`;
  ctx.fillText("מאז", 92, 220);
  ctx.direction = "ltr";
  ctx.font = `800 17px ${HEB_FONT}`;
  ctx.fillText("1952", 92, 238);
  ctx.direction = "rtl";
  ctx.fillStyle = "#d0322b";
  ctx.fillRect(140, 254, 160, 4);
  // "חלב טרי".
  ctx.fillStyle = NAVY;
  ctx.font = `900 120px ${HEB_FONT}`;
  ctx.fillText("חלב", 205, 380);
  ctx.font = `800 64px ${HEB_FONT}`;
  ctx.fillText("טרי", 260, 450);
  // The round picture.
  const cx = 200, cy = 640, r = 165;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const sky = ctx.createLinearGradient(0, cy - r, 0, cy + r);
  sky.addColorStop(0, "#2f78c9");
  sky.addColorStop(0.55, "#a9d4f2");
  sky.addColorStop(1, "#e8f4fb");
  ctx.fillStyle = sky;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.fillStyle = "#ffffff";
  for (const [ex, ey, er] of [[120, 560, 26], [150, 552, 30], [180, 562, 22], [290, 600, 18], [312, 594, 22]]) {
    ctx.beginPath();
    ctx.arc(ex, ey, er, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#69b445";
  ctx.beginPath();
  ctx.ellipse(250, 820, 260, 120, -0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3f8f2e";
  ctx.beginPath();
  ctx.ellipse(80, 850, 240, 110, 0.15, 0, Math.PI * 2);
  ctx.fill();
  // Tree.
  ctx.fillStyle = "#6b4a2b";
  ctx.fillRect(282, 640, 12, 60);
  ctx.fillStyle = "#3c8a2f";
  ctx.beginPath();
  ctx.arc(288, 620, 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4fa23b";
  ctx.beginPath();
  ctx.arc(276, 606, 24, 0, Math.PI * 2);
  ctx.fill();
  // House.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(120, 650, 130, 80);
  ctx.fillStyle = "#c9d3dc";
  ctx.fillRect(120, 650, 30, 80);
  ctx.fillStyle = "#d8322a";
  ctx.beginPath();
  ctx.moveTo(106, 656);
  ctx.lineTo(160, 600);
  ctx.lineTo(262, 610);
  ctx.lineTo(258, 656);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = NAVY;
  for (let i = 0; i < 3; i++) ctx.fillRect(170 + i * 26, 672, 16, 8);
  ctx.fillRect(175, 692, 60, 6);
  ctx.restore();
  // 3% badge.
  ctx.fillStyle = NAVY;
  ctx.beginPath();
  ctx.arc(320, 490, 52, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.direction = "ltr";
  ctx.font = `800 46px ${HEB_FONT}`;
  ctx.fillText("3%", 320, 506);
  ctx.direction = "rtl";
  // Little speech bubble.
  ctx.fillStyle = NAVY;
  ctx.beginPath();
  ctx.ellipse(300, 840, 70, 40, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(282, 798, 18, 0, Math.PI * 2);
  ctx.arc(302, 792, 20, 0, Math.PI * 2);
  ctx.arc(322, 800, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `700 20px ${HEB_FONT}`;
  ctx.fillText("מה אוכלים", 300, 846);
  ctx.fillText("היום?", 300, 868);
  // "1 ליטר" and small print.
  ctx.fillStyle = "#1b1f2a";
  ctx.font = `900 54px ${HEB_FONT}`;
  ctx.fillText("1 ליטר", 255, 935);
  ctx.font = `600 22px ${HEB_FONT}`;
  ctx.fillText("חלב מפוסטר, הומוגני 3% שומן", 235, 970);
  // Green stamp.
  ctx.strokeStyle = "#6cb63e";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(70, 930, 44, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(70, 930, 24, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawSide(ctx) {
  const { x, y, w, h } = R_SIDE;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#58b08f";
  ctx.fillRect(0, 0, w, h);
  drawGingham(ctx, 0, 0, w, 150, 25);
  ctx.fillStyle = "#e4e8eb";
  ctx.fillRect(0, 150, w, 6);
  // White panel with a title, icons and lines.
  ctx.fillStyle = "#f6f8f7";
  ctx.beginPath();
  ctx.roundRect(40, 200, 320, 520, 26);
  ctx.fill();
  ctx.fillStyle = NAVY;
  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.font = `800 30px ${HEB_FONT}`;
  ctx.fillText("ארוחת בוקר טובה", 200, 255);
  for (let i = 0; i < 6; i++) {
    const cx = 110 + (i % 3) * 90, cy = 330 + Math.floor(i / 3) * 150;
    ctx.fillStyle = ["#d9e6f5", "#f3e3c9", "#e2f0da"][i % 3];
    ctx.beginPath();
    ctx.arc(cx, cy, 34, 0, Math.PI * 2);
    ctx.fill();
    textLines(ctx, cx - 40, cy + 50, 80, 2, 12, "#7b8794");
  }
  // Nutrition box.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(40, 760, 320, 200);
  textLines(ctx, 60, 780, 280, 12, 15, "#5d6a77");
  ctx.restore();
}

function drawBack(ctx) {
  const { x, y, w, h } = R_BACK;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#f3f5f6";
  ctx.fillRect(0, 0, w, h);
  drawGingham(ctx, 0, 0, w, 88, 14);
  textLines(ctx, 16, 120, w - 32, 22, 16, "#8a96a3");
  // Barcode.
  ctx.fillStyle = "#1b1f2a";
  for (let i = 0; i < 34; i++) ctx.fillRect(40 + i * 4, 500, (i * 7) % 3 === 0 ? 3 : 1.5, 60);
  ctx.restore();
  // Gable: light grey board.
  const G = R_GABLE;
  const gg = ctx.createLinearGradient(0, G.y, 0, G.y + G.h);
  gg.addColorStop(0, "#f1f3f5");
  gg.addColorStop(1, "#dde2e6");
  ctx.fillStyle = gg;
  ctx.fillRect(G.x, G.y, G.w, G.h);
  // Cap: grey plastic with ribs.
  const C = R_CAP;
  ctx.fillStyle = "#c9ced3";
  ctx.fillRect(C.x, C.y, C.w, C.h);
  ctx.fillStyle = "#b3b9bf";
  for (let i = 0; i < 26; i++) ctx.fillRect(C.x + i * 8, C.y, 3, C.h);
}

function makeAtlas(THREE, renderer) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ATLAS;
  const ctx = canvas.getContext("2d");
  drawFront(ctx);
  drawSide(ctx);
  drawBack(ctx);
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
 * @returns {{ meshes, placements: {x, y, z, yaw, shelf}[], shelves, dims, check(): object, dispose(): void }}
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
  const placements = [];
  perFridge.forEach((shelves) => {
    shelves.forEach((sh, si) => {
      const shelfIndex = shelvesAll.indexOf(sh);
      if (sh.headroom < height + 0.02) return; // too low (only with scale > 1)
      const want = C.perShelf[Math.min(si, C.perShelf.length - 1)];
      const rand = mulberry32(C.seed + sh.fi * 977 + shelfIndex * 131);
      const m = C.edgeMargin;
      const placed = [];
      for (let k = 0; k < want; k++) {
        // Back row first, left to right (the inner left corner: min z is the back, min x the left seen from the door).
        const r = Math.floor(k / C.groupColumns), c = k % C.groupColumns;
        const bx = sh.minX + m + hw + c * (dims.width + C.colGap);
        const bz = sh.minZ + m + hd + r * (dims.depth + C.rowGap);
        const jy = (rand() * 2 - 1) * C.yawJitter * J;
        const jx = (rand() * 2 - 1) * C.offsetJitter * J;
        const jz = (rand() * 2 - 1) * C.offsetJitter * J;
        // Full jitter, then less, then straight: the first that stays on the shelf and clear of its neighbours.
        for (const f of [1, 0.5, 0]) {
          const x = bx + jx * f, z = bz + jz * f, yaw = jy * f;
          const fp = footprint(x, z, yaw, hw, hd);
          const inside = fp.every(([px, pz]) => px >= sh.minX + m * 0.5 && px <= sh.maxX - m * 0.5 && pz >= sh.minZ + m * 0.5 && pz <= sh.maxZ - m * 0.5);
          if (!inside) continue;
          if (placed.some((o) => footprintsOverlap(o.fp, fp, 0.02))) continue;
          placed.push({ x, z, yaw, fp });
          break;
        }
      }
      for (const p of placed) placements.push({ x: p.x, y: sh.y, z: p.z, yaw: p.yaw, shelf: shelfIndex, fp: p.fp });
    });
  });
  // One geometry, one texture / material, one InstancedMesh.
  const geo = buildCartonGeometry(THREE, dims);
  const mat = new THREE.MeshStandardMaterial({ map: makeAtlas(THREE, renderer), roughness: C.roughness, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, placements.length));
  mesh.name = "milkCartons";
  mesh.count = placements.length;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const meshes = [mesh];
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const matrixOf = (p, out) => out.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(up, p.yaw), one);
  placements.forEach((p, i) => mesh.setMatrixAt(i, matrixOf(p, mtx)));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  mesh.visible = placements.length > 0;
  scene.add(mesh);

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
