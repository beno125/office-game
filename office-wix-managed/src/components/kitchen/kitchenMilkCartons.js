/**
 * Milk cartons on the fridge shelves (fridgeBodyLeft / fridgeBodyRight).
 *
 * Look: a 1-litre gable-top carton after the reference photo: white body with
 * a blue gingham band round its shoulders, "חלב טרי" in dark blue, a round
 * picture (sky, green hills, a white house with a red roof, a tree), a "3%"
 * badge and "1 ליטר" on the front; a green information panel on its right
 * side; a light grey gable with a fin and a grey screw cap. The brand mark is
 * a generic dairy emblem (no real logo). Drawn once on a canvas (one texture
 * atlas), one merged geometry (body, gable, fin, cap), one InstancedMesh for
 * every carton in both fridges.
 *
 * Shelves: found from each fridge body's own geometry (findFridgeShelves):
 * its horizontal faces, minus the outer box's top / bottom, sorted by height;
 * two faces closer than SHELF_MAX_THICKNESS form a shelf slab (its top face is
 * the surface), the lowest / highest of the rest are the inside's floor /
 * ceiling. A shelf's headroom is the next face above it.
 *
 * Placement: per shelf, seeded (the same every load), cartons are tried at
 * random spots and small turns within the shelf (an edge margin) and kept
 * only if their footprint (an oriented square) is clear of every carton
 * already there (a gap), so they stand in loose rows, never in a grid. Each
 * stands exactly on the shelf's top surface. Static (no physics), like the
 * other props behind the fridges' closed glass doors.
 *
 * checkMilkCartons() re-tests every carton (bounding boxes against each other,
 * the shelf top and headroom, and the fridge body's triangles) and reports.
 */

/** Tuning (world units). */
export const MILK_CARTONS = {
  /** Carton size (a 1-litre carton's proportions, sized to the shelves: ~80% of the upper shelf's headroom):
   *  body width / depth, body height, gable height (ridge above the body), fin height. */
  width: 0.84,
  depth: 0.84,
  bodyHeight: 2.13,
  gableHeight: 0.42,
  finHeight: 0.1,
  /** Screw cap on the front slope: radius, height. */
  capRadius: 0.13,
  capHeight: 0.075,
  /** Cartons per shelf (lower shelf, upper shelf), per fridge; fewer if they don't fit. */
  perShelf: [5, 4],
  /** Kept this far from a shelf's edges, and from each other. */
  edgeMargin: 0.08,
  gap: 0.05,
  /** Turn (radians, ±) away from facing the door; now and then a carton is turned further (sideways). */
  yawJitter: 0.32,
  sidewaysShare: 0.15,
  /** Placement seed (a different one per fridge). */
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
  // Generic dairy emblem: a blue drop and the word "מחלבה" (dairy).
  ctx.fillStyle = BLUE;
  ctx.beginPath();
  ctx.moveTo(318, 196);
  ctx.quadraticCurveTo(342, 226, 336, 238);
  ctx.arc(318, 236, 18, 0.1, Math.PI - 0.1);
  ctx.quadraticCurveTo(296, 226, 318, 196);
  ctx.fill();
  ctx.font = `italic 800 46px ${HEB_FONT}`;
  ctx.fillText("מחלבה", 205, 248);
  ctx.fillStyle = "#d0322b";
  ctx.fillRect(120, 258, 170, 5);
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
function buildCartonGeometry(THREE) {
  const C = MILK_CARTONS;
  const W = C.width / 2, D = C.depth / 2, Hb = C.bodyHeight, Hg = C.gableHeight;
  const pos = [], nor = [], uv = [];
  const uvOf = (R, s, t) => [(R.x + s * R.w) / ATLAS, 1 - (R.y + (1 - t) * R.h) / ATLAS];
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  // A flat quad p0 p1 p2 p3 (counter-clockwise seen from outside), UV corners (s, t).
  const quad = (p, R, st) => {
    const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0])).normalize();
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(p[k].x, p[k].y, p[k].z);
      nor.push(n.x, n.y, n.z);
      uv.push(...uvOf(R, st[k][0], st[k][1]));
    }
  };
  const tri = (p, R, st) => {
    const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0])).normalize();
    for (let k = 0; k < 3; k++) {
      pos.push(p[k].x, p[k].y, p[k].z);
      nor.push(n.x, n.y, n.z);
      uv.push(...uvOf(R, st[k][0], st[k][1]));
    }
  };
  const full = [[0, 0], [1, 0], [1, 1], [0, 1]];
  // Body: front, right, back, left (bottom stands on the shelf; the gable covers the top).
  quad([v3(-W, 0, D), v3(W, 0, D), v3(W, Hb, D), v3(-W, Hb, D)], R_FRONT, full);
  quad([v3(W, 0, D), v3(W, 0, -D), v3(W, Hb, -D), v3(W, Hb, D)], R_SIDE, full);
  quad([v3(W, 0, -D), v3(-W, 0, -D), v3(-W, Hb, -D), v3(W, Hb, -D)], R_BACK, full);
  quad([v3(-W, 0, -D), v3(-W, 0, D), v3(-W, Hb, D), v3(-W, Hb, -D)], R_BACK, full);
  // Gable: front and back slopes to a ridge along x, end triangles, and the fin.
  const top = Hb + Hg;
  quad([v3(-W, Hb, D), v3(W, Hb, D), v3(W, top, 0), v3(-W, top, 0)], R_GABLE, full);
  quad([v3(W, Hb, -D), v3(-W, Hb, -D), v3(-W, top, 0), v3(W, top, 0)], R_GABLE, full);
  tri([v3(W, Hb, D), v3(W, Hb, -D), v3(W, top, 0)], R_GABLE, [[0, 0], [1, 0], [0.5, 1]]);
  tri([v3(-W, Hb, -D), v3(-W, Hb, D), v3(-W, top, 0)], R_GABLE, [[0, 0], [1, 0], [0.5, 1]]);
  const ft = 0.015, fh = top + C.finHeight;
  quad([v3(-W, top, ft), v3(W, top, ft), v3(W, fh, ft), v3(-W, fh, ft)], R_GABLE, full);
  quad([v3(W, top, -ft), v3(-W, top, -ft), v3(-W, fh, -ft), v3(W, fh, -ft)], R_GABLE, full);
  quad([v3(-W, fh, ft), v3(W, fh, ft), v3(W, fh, -ft), v3(-W, fh, -ft)], R_GABLE, full);
  quad([v3(W, top, ft), v3(W, top, -ft), v3(W, fh, -ft), v3(W, fh, ft)], R_GABLE, full);
  quad([v3(-W, top, -ft), v3(-W, top, ft), v3(-W, fh, ft), v3(-W, fh, -ft)], R_GABLE, full);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  // Cap: on the front slope's middle, standing on it (along its normal).
  const cap = new THREE.CylinderGeometry(C.capRadius, C.capRadius * 1.04, C.capHeight, 20, 1, false);
  const capUv = cap.attributes.uv;
  for (let i = 0; i < capUv.count; i++) {
    const [u, v] = uvOf(R_CAP, capUv.getX(i), capUv.getY(i));
    capUv.setXY(i, u, v);
  }
  const slopeN = new THREE.Vector3(0, D, Hg).normalize();
  const capQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), slopeN);
  const capAt = new THREE.Vector3(0, Hb + Hg / 2, D / 2).addScaledVector(slopeN, C.capHeight / 2);
  cap.applyMatrix4(new THREE.Matrix4().compose(capAt, capQ, new THREE.Vector3(1, 1, 1)));
  const capNI = cap.toNonIndexed();
  const merged = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv"]) {
    const a = geo.attributes[name], b = capNI.attributes[name];
    const arr = new Float32Array(a.array.length + b.array.length);
    arr.set(a.array, 0);
    arr.set(b.array, a.array.length);
    merged.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
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
 * @returns {{ mesh, placements: {x, y, z, yaw, shelf}[], shelves, check(): object, dispose(): void }}
 */
export function createMilkCartons({ THREE, scene, renderer, fridgeMeshes }) {
  const C = MILK_CARTONS;
  const height = C.bodyHeight + C.gableHeight + C.finHeight;
  const hw = C.width / 2, hd = C.depth / 2;
  const placements = [];
  const shelvesAll = [];
  fridgeMeshes.forEach((fridge, fi) => {
    if (!fridge || !fridge.isMesh) return;
    const shelves = findFridgeShelves(THREE, fridge);
    const rand = mulberry32(C.seed + fi * 977);
    shelves.forEach((sh, si) => {
      shelvesAll.push({ fridge: fridge.name, ...sh });
      if (sh.headroom < height + 0.02) return; // too low for a carton
      const want = C.perShelf[Math.min(si, C.perShelf.length - 1)];
      const placed = [];
      for (let tries = 0; placed.length < want && tries < 600; tries++) {
        const sideways = rand() < C.sidewaysShare;
        const yaw = (rand() * 2 - 1) * C.yawJitter + (sideways ? (rand() < 0.5 ? 1 : -1) * Math.PI / 2 : 0);
        const x = sh.minX + rand() * (sh.maxX - sh.minX);
        const z = sh.minZ + rand() * (sh.maxZ - sh.minZ);
        const fp = footprint(x, z, yaw, hw, hd);
        const inside = fp.every(([px, pz]) => px >= sh.minX + C.edgeMargin && px <= sh.maxX - C.edgeMargin && pz >= sh.minZ + C.edgeMargin && pz <= sh.maxZ - C.edgeMargin);
        if (!inside) continue;
        if (placed.some((o) => footprintsOverlap(o.fp, fp, C.gap))) continue;
        placed.push({ x, z, yaw, fp });
      }
      for (const p of placed) placements.push({ x: p.x, y: sh.y, z: p.z, yaw: p.yaw, shelf: shelvesAll.length - 1, fp: p.fp });
    });
  });
  const geo = buildCartonGeometry(THREE);
  const mat = new THREE.MeshStandardMaterial({ map: makeAtlas(THREE, renderer), roughness: C.roughness, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, placements.length));
  mesh.name = "milkCartons";
  mesh.count = placements.length;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  placements.forEach((p, i) => {
    q.setFromAxisAngle(up, p.yaw);
    m.compose(new THREE.Vector3(p.x, p.y, p.z), q, one);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  scene.add(mesh);

  /** Re-tests every carton: each other, its shelf (exactly on it, inside it, headroom), and the fridge bodies' triangles. */
  function check() {
    const issues = [];
    const boxes = placements.map((p, i) => {
      mesh.getMatrixAt(i, m);
      return geo.boundingBox.clone().applyMatrix4(m);
    });
    // Each other: oriented footprints (exact), and world boxes for the record.
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
    // The fridge bodies' triangles (each carton's box, its bottom lifted off the shelf by a hair).
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
          lifted.min.y += 1e-3;
          if (lifted.intersectsTriangle(tri)) issues.push(`carton ${i} touches ${fridge.name} (triangle ${t / 3})`);
        });
      }
    }
    return { cartons: placements.length, shelves: shelvesAll, boxes, issues };
  }

  return {
    mesh,
    placements,
    shelves: shelvesAll,
    check,
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.map.dispose();
      mat.dispose();
    },
  };
}
