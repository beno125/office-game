/**
 * Trailing (hanging) plants growing out of the kitchen's top planters
 * ("topPlantBaseLeft" / "topPlantBaseRight": open-top boxes on the top
 * shelves, their rim at the top, an empty inside).
 *
 * Top face: found from each base's own geometry: its upward faces in world
 * space, the highest level is the rim; the opening inside it is the box's inner
 * floor's extent (the next upward level down), at the rim's height.
 *
 * Stems: grown step by step from points inside that opening (a little below the
 * rim), spread over the whole face: hanging stems spill over the front, left or
 * right edge (edgeShares; front ones start anywhere along it, side ones from
 * their end), first up and out, then curling over the edge and hanging down
 * under a growing pull; short bushy stems on a jittered grid fill the crown, with a gentle seeded wander, each
 * its own length, start and curl. Every step is a ray against the scenery near
 * the planter (the planter, shelves, frames, walls, jars...): on a hit the stem
 * slides along the surface it met (bent off it); if it can't, it stops there
 * (shortened). Built as tapered low-poly tubes (thinner toward the tip), all
 * stems of both planters in one mesh.
 *
 * Leaves: the Office plant's leaf and material (src/game/plantLeaves.js), one
 * InstancedMesh for both planters. Along each stem, alternating sides, the
 * notch at the stem, the blade hanging out and down, facing the room, smaller
 * toward the tip, with seeded variation in size and angle. Each leaf's outline
 * (tip, both edges) is checked against the same scenery; a leaf that would
 * enter something tries the other side, then smaller, else is left out.
 * Static, like the Office leaves (they don't move either).
 */
import { LEAF_ASPECT, createLeafMaterial, loadLeafTexture } from "../game/plantLeaves.js";

export const KITCHEN_TRAILING_PLANTS = {
  bases: ["topPlantBaseLeft", "topPlantBaseRight"],
  stemsPerBase: 30, // hanging stems per planter
  edgeShares: { front: 0.5, left: 0.25, right: 0.25 }, // which edge they spill over (shares of stemsPerBase)
  stemLength: [3.5, 9], // range (model units; a planter is 14.8 long, 2.9 tall)
  bushyPerBase: 14, // short stems on top (a full, bushy crown where the plant grows out)
  bushyLength: [0.9, 2.3],
  randomness: 1, // 0 = tidy, 1 = natural (wander, start spread, size and angle variation)
  seed: 4242,
  // Growth
  step: 0.22, // stem segment length
  startDepth: 0.35, // the stems start this far below the rim (out of the inside)
  sideReach: 0.32, // left / right stems start within this share of the opening's length from their end
  rise: [0.35, 0.8], // how much a stem rises out of the planter before curling over (initial up share)
  outward: 0.9, // push toward its edge (front: into the room; left / right) while above / near the planter
  pull: [0.35, 0.75], // downward pull per unit of length over the edge (range: tighter or looser curls)
  hangRate: [1.6, 4.2], // past the edge: how fast a stem turns to hang (per unit of length; range per stem)
  hangOut: [0.1, 0.4], // …toward straight down, leaning out from the planter by this much (range per stem)
  wander: 0.25, // sideways wander per unit of length
  clearance: 0.05, // kept from surfaces
  // Stem tube
  radius: [0.055, 0.02], // at the base → at the tip
  sides: 5,
  stemColor: 0x5f7034, // green-brown, matching the leaves
  // Leaves
  leafDensity: 2.1, // leaves per unit of stem
  leafSize: 0.95, // a leaf's width at the stem's base (height × the image's aspect)
  leafTipScale: 0.55, // its size at the stem's tip (× leafSize)
  leafSizeJitter: 0.22, // ± share
  leafAngleJitterDeg: 34, // ± twist round the stem
  leafRollDeg: 48, // ± roll round the leaf's own midrib (how it turns to the light)
  leafSpread: [0.4, 1], // how far out sideways from the stem (share)
  leafDroop: [0.35, 1.1], // how much the blade hangs down (share)
  leafLean: [-0.15, 0.5], // along the stem (share; forward toward the tip)
  leafFaceTilt: [-0.25, 0.7], // its facing: down … up
  leafStart: 0.5, // no leaves on the first bit of a stem (inside the planter)
  leafTint: 0xffffff, // × the leaf image (white = as in the Office)
};

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A base's top face: the rim's height and the opening (inner floor's x / z extent), world space. */
function findTopFace(THREE, mesh) {
  mesh.updateWorldMatrix(true, false);
  const pos = mesh.geometry.attributes.position;
  const idx = mesh.geometry.index;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const nor = mesh.geometry.attributes.normal;
  const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const levels = new Map(); // y (rounded) → bounds of its upward faces
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
    const area = e1.subVectors(b, a).cross(e2.subVectors(c, a)).length() / 2;
    // Upward by the mesh's own normals (the winding isn't consistent in the model).
    n.fromBufferAttribute(nor, i0).add(e1.fromBufferAttribute(nor, i1)).add(e2.fromBufferAttribute(nor, i2)).applyMatrix3(nm).normalize();
    if (area < 1e-6 || n.y < 0.95) continue;
    const key = Math.round(((a.y + b.y + c.y) / 3) * 50) / 50;
    let L = levels.get(key);
    if (!L) levels.set(key, (L = { y: key, area: 0, box: new THREE.Box3() }));
    L.area += area;
    L.box.expandByPoint(a).expandByPoint(b).expandByPoint(c);
  }
  const sorted = [...levels.values()].sort((p, q) => q.y - p.y);
  if (!sorted.length) return null;
  // The rim: the walls' top (their highest vertices; the model's walls have no top faces, so the top face is the
  // opening at that height). The opening: the largest upward level below it (the inside's floor) gives its extent.
  const outer = new THREE.Box3().setFromObject(mesh);
  const rimY = Math.max(sorted[0].y, outer.max.y);
  const below = sorted.filter((L) => L.y < rimY - 0.2).sort((p, q) => q.area - p.area)[0];
  const inner = below ? below.box : outer.clone().expandByVector(new THREE.Vector3(-0.2, 0, -0.2));
  return { rimY, outer, inner: { minX: inner.min.x, maxX: inner.max.x, minZ: inner.min.z, maxZ: inner.max.z }, floorY: below ? below.y : rimY };
}

/**
 * @param {object} o
 * @param {typeof import("three")} o.THREE
 * @param {import("three").Object3D} o.root  the kitchen model
 * @param {string} o.leafUrl  the Office leaf image
 * @returns {{ group: import("three").Group, check(): {segments:number, leaves:number, hits:string[]}, dispose(): void, report: object }}
 */
export function createTrailingPlants({ THREE, root, leafUrl }) {
  const C = KITCHEN_TRAILING_PLANTS;
  const rand = seeded(C.seed);
  const R = C.randomness;
  const lerp = (a, b, t) => a + (b - a) * t;
  const range = (r) => lerp(r[0], r[1], rand());
  root.updateMatrixWorld(true);

  const group = new THREE.Group();
  group.name = "kitchenTrailingPlants";
  const missing = [];
  const plants = [];
  for (const name of C.bases) {
    const base = root.getObjectByName(name);
    if (!base || !base.isMesh) {
      missing.push(name);
      continue;
    }
    const top = findTopFace(THREE, base);
    if (top) plants.push({ base, top });
  }
  if (missing.length) console.warn("Trailing plants: missing in the model:", missing.join(", "));

  // Scenery the plants must not enter: visible meshes of the model near each planter (the planter itself included).
  const colliders = [];
  {
    const zone = new THREE.Box3();
    for (const P of plants) zone.union(P.top.outer.clone().expandByVector(new THREE.Vector3(C.stemLength[1], C.stemLength[1] + 1, C.stemLength[1])));
    root.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      if (!o.geometry || !o.geometry.attributes.position) return;
      if (new THREE.Box3().setFromObject(o).intersectsBox(zone)) colliders.push(o);
    });
  }
  const ray = new THREE.Raycaster();
  const _n = new THREE.Vector3();
  /** First hit from `from` along unit `dir` within `far`: { distance, normal } or null. */
  function cast(from, dir, far) {
    ray.set(from, dir);
    ray.near = 0;
    ray.far = far;
    let hits = [];
    try {
      hits = ray.intersectObjects(colliders, false);
    } catch (e) {
      hits = [];
    }
    for (const h of hits) {
      if (!h.face) continue;
      _n.copy(h.face.normal).transformDirection(h.object.matrixWorld);
      if (_n.dot(dir) > 0) _n.negate(); // two-sided: the side we came from
      return { distance: h.distance, normal: _n.clone(), name: h.object.name };
    }
    return null;
  }
  const _seg = new THREE.Vector3();
  /** Anything between a and b (inclusive of a `pad` past b)? */
  function blocked(a, b, pad = 0) {
    _seg.subVectors(b, a);
    const d = _seg.length();
    if (d < 1e-6) return null;
    return cast(a, _seg.divideScalar(d).clone(), d + pad);
  }

  /** A leaf's outline (stem → tip, stem → both edges, across, both edges → tip) against the scenery. */
  function outlineBlocked(at, tip, a, b, pad) {
    return (
      blocked(at, tip, pad) || blocked(at, a, pad) || blocked(at, b, pad) || blocked(a, b) || blocked(a, tip) || blocked(b, tip)
    );
  }

  // ── Stems ──────────────────────────────────────────────────────────────
  // Hanging stems spill over the front, left or right edge (by edgeShares); each starts from its own place in the
  // opening (stratified along the edge with jitter, so the whole face is covered), side stems from their end of it.
  // Short bushy stems on a jittered grid over the whole opening fill the crown.
  const stems = []; // { pts: [Vector3], length, plant, out: Vector3 }
  const down = new THREE.Vector3(0, -1, 0);
  const hang = new THREE.Vector3();
  const EDGE = {
    front: new THREE.Vector3(0, 0, 1), // into the room (the back wall is at -z)
    left: new THREE.Vector3(-1, 0, 0),
    right: new THREE.Vector3(1, 0, 0),
  };
  /** How far p is past the planter's edge toward `out` (negative: still over it). */
  const pastEdge = (T, p, out) =>
    out.z > 0 ? p.z - T.outer.max.z : out.x < 0 ? T.outer.min.x - p.x : p.x - T.outer.max.x;
  /**
   * Grows a stem; a hanging one stopped by something before it cleared its edge (pointing up into the air) is grown
   * again, turned toward the front: 45°, then fully.
   */
  function grow(P, start, out, length, rise, pull, lean, bushy = false) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const turn = attempt === 0 || out.z > 0.5 ? out : out.clone().lerp(EDGE.front, attempt === 1 ? 0.5 : 1).normalize();
      const S = growOnce(P, start, turn, length, rise, pull, lean, bushy);
      if (!S) return;
      if (bushy || S.cleared || attempt === 2) {
        stems.push(S);
        return;
      }
    }
  }
  function growOnce(P, start, out, length, rise, pull, lean, bushy) {
    const T = P.top;
    const p = start.clone();
    const sideAxis = new THREE.Vector3().crossVectors(out, down).normalize(); // along the edge
    const dir = new THREE.Vector3().copy(out).multiplyScalar(1 - rise).addScaledVector(sideAxis, lean);
    dir.y = rise;
    dir.normalize();
    const pts = [p.clone()];
    let grown = 0;
    let cleared = false; // over its edge and hanging below the rim
    const hangRate = range(C.hangRate) * (bushy ? 0.5 : 1);
    const hangOut = range(C.hangOut);
    let wa = (rand() - 0.5) * R, wb = (rand() - 0.5) * R;
    while (grown < length) {
      const t = grown / length;
      // Out while over / near the planter, then down: the pull grows as it clears the edge.
      const overPlanter = pastEdge(T, p, out) < 0.4 && p.y > T.rimY - 1;
      if (overPlanter) {
        dir.addScaledVector(out, C.outward * C.step);
        dir.addScaledVector(down, pull * C.step * 0.6);
      } else {
        // Past the edge: gravity takes over: it turns toward hanging (down, leaning out a little), at its own rate.
        hang.copy(down).addScaledVector(out, hangOut).normalize();
        dir.lerp(hang, Math.min(1, hangRate * C.step * (0.6 + t)));
        dir.addScaledVector(down, pull * C.step);
      }
      wa = (wa + (rand() - 0.5) * 0.6) * 0.85;
      wb = (wb + (rand() - 0.5) * 0.6) * 0.85;
      dir.addScaledVector(sideAxis, wa * C.wander * C.step * R);
      dir.addScaledVector(out, wb * C.wander * C.step * R * 0.5);
      dir.normalize();
      // Collide: slide along what's in the way, else stop here.
      let ok = false;
      for (let k = 0; k < 5; k++) {
        const hit = cast(p, dir, C.step + C.clearance + 0.06);
        if (!hit) {
          ok = true;
          break;
        }
        dir.addScaledVector(hit.normal, -dir.dot(hit.normal) + 0.35).normalize();
      }
      if (!ok) break;
      p.addScaledVector(dir, C.step);
      pts.push(p.clone());
      grown += C.step;
      if (pastEdge(T, p, out) > 0.3 && p.y < T.rimY) cleared = true;
      if (p.y < T.rimY - C.stemLength[1] - 2) break;
    }
    if (pts.length < 4) return null;
    return { pts, length: grown, plant: P, out: out.clone(), bushy, cleared };
  }
  const startY = (T) => T.rimY - C.startDepth;
  for (const P of plants) {
    const T = P.top;
    const I = T.inner;
    const inset = 0.25;
    const x0 = I.minX + inset, x1 = I.maxX - inset, z0 = I.minZ + inset, z1 = I.maxZ - inset;
    const shares = C.edgeShares;
    const total = shares.front + shares.left + shares.right || 1;
    const counts = {
      front: Math.round((C.stemsPerBase * shares.front) / total),
      left: Math.round((C.stemsPerBase * shares.left) / total),
    };
    counts.right = Math.max(0, C.stemsPerBase - counts.front - counts.left);
    const jit = (k, n) => (k + 0.5 + (rand() - 0.5) * 0.9 * R) / n; // stratified, jittered 0..1
    // Front: along the whole length, anywhere in the front two thirds of the depth.
    for (let k = 0; k < counts.front; k++) {
      const x = lerp(x0, x1, jit(k, counts.front));
      const z = lerp(z0, z1, 0.33 + rand() * 0.67);
      grow(P, new THREE.Vector3(x, startY(T), z), EDGE.front, range(C.stemLength), range(C.rise), range(C.pull), (rand() - 0.5) * 0.6 * R);
    }
    // Left / right: from their end of the opening, across its whole depth.
    for (const side of ["left", "right"]) {
      const n = counts[side];
      for (let k = 0; k < n; k++) {
        const z = lerp(z0, z1, jit(k, n));
        const reach = rand() * C.sideReach * (x1 - x0);
        const x = side === "left" ? x0 + reach : x1 - reach;
        grow(P, new THREE.Vector3(x, startY(T), z), EDGE[side], range(C.stemLength), range(C.rise), range(C.pull), (rand() - 0.5) * 0.6 * R);
      }
    }
    // Bushy crown: short stems on a jittered grid over the whole opening, arching up and flopping toward the nearest edge.
    const rows = 2;
    const cols = Math.max(1, Math.ceil(C.bushyPerBase / rows));
    for (let k = 0; k < C.bushyPerBase; k++) {
      const c = k % cols, r = Math.floor(k / cols);
      const x = lerp(x0, x1, jit(c, cols));
      const z = lerp(z0, z1, jit(r, rows));
      const dl = x - I.minX, dr = I.maxX - x, df = I.maxZ - z;
      const out = df < Math.min(dl, dr) * 0.6 || (dl > 3 && dr > 3) ? EDGE.front : dl < dr ? EDGE.left : EDGE.right;
      grow(P, new THREE.Vector3(x, startY(T), z), out, range(C.bushyLength), 0.75 + rand() * 0.2, range(C.pull) * 0.7, (rand() - 0.5) * 1.2 * R, true);
    }
  }

  // Tapered tubes, one geometry (parallel-transported frames along each stem).
  const positions = [];
  const normals = [];
  const indices = [];
  const rimMax = new THREE.Vector3(), tan = new THREE.Vector3(), nrm = new THREE.Vector3(), bin = new THREE.Vector3();
  for (const S of stems) {
    const n = S.pts.length;
    const base = positions.length / 3;
    tan.subVectors(S.pts[1], S.pts[0]).normalize();
    nrm.set(1, 0, 0);
    if (Math.abs(tan.dot(nrm)) > 0.9) nrm.set(0, 0, 1);
    nrm.addScaledVector(tan, -nrm.dot(tan)).normalize();
    for (let i = 0; i < n; i++) {
      const p = S.pts[i];
      const nt = i < n - 1 ? rimMax.subVectors(S.pts[i + 1], p).normalize() : tan.clone();
      // Transport the frame onto the new tangent.
      nrm.addScaledVector(nt, -nrm.dot(nt)).normalize();
      tan.copy(nt);
      bin.crossVectors(tan, nrm);
      const t = i / (n - 1);
      const r = lerp(C.radius[0], C.radius[1], t);
      for (let k = 0; k < C.sides; k++) {
        const a = (k / C.sides) * Math.PI * 2;
        const ox = Math.cos(a), oy = Math.sin(a);
        const nx = nrm.x * ox + bin.x * oy, ny = nrm.y * ox + bin.y * oy, nz = nrm.z * ox + bin.z * oy;
        positions.push(p.x + nx * r, p.y + ny * r, p.z + nz * r);
        normals.push(nx, ny, nz);
      }
    }
    for (let i = 0; i < n - 1; i++)
      for (let k = 0; k < C.sides; k++) {
        const a = base + i * C.sides + k, b = base + i * C.sides + ((k + 1) % C.sides);
        const c = a + C.sides, d = b + C.sides;
        indices.push(a, c, b, b, c, d);
      }
  }
  const stemGeo = new THREE.BufferGeometry();
  stemGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  stemGeo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  stemGeo.setIndex(indices);
  stemGeo.computeBoundingSphere();
  // Unlit like the leaves (a lit stem read black next to them in the kitchen's dim light).
  const stemMat = new THREE.MeshBasicMaterial({ color: C.stemColor });
  const stemMesh = new THREE.Mesh(stemGeo, stemMat);
  stemMesh.name = "kitchenTrailingPlantStems";
  group.add(stemMesh);

  // ── Leaves ─────────────────────────────────────────────────────────────
  const leafTex = loadLeafTexture(THREE, leafUrl);
  const leafMat = createLeafMaterial(THREE, leafTex, { tint: C.leafTint, cacheKey: "kitchenTrailingLeafMat" });
  const leafPlacements = []; // Matrix4 + outline points for the check
  const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
  const face = new THREE.Vector3(), blade = new THREE.Vector3(), sideV = new THREE.Vector3();
  const centre = new THREE.Vector3(), tip = new THREE.Vector3(), edgeA = new THREE.Vector3(), edgeB = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const _room = new THREE.Vector3(0, 0.35, 0.6);
  for (const S of stems) {
    const n = S.pts.length;
    const count = Math.max(1, Math.floor((S.length - C.leafStart) * C.leafDensity));
    let sideSign = rand() < 0.5 ? -1 : 1;
    for (let j = 0; j < count; j++) {
      const along = C.leafStart + ((j + 0.5 + (rand() - 0.5) * 0.5 * R) / count) * (S.length - C.leafStart);
      const fi = Math.min(n - 2, Math.floor(along / C.step));
      const at = S.pts[fi].clone().lerp(S.pts[fi + 1], along / C.step - fi);
      tan.subVectors(S.pts[fi + 1], S.pts[fi]).normalize();
      const t = along / S.length;
      let size = C.leafSize * lerp(1, C.leafTipScale, t) * (1 + (rand() * 2 - 1) * C.leafSizeJitter * R);
      // Sideways from the stem (horizontal-ish), out and down; the blade faces the room and a little up.
      sideV.crossVectors(tan, down);
      if (sideV.lengthSq() < 1e-4) sideV.set(1, 0, 0);
      sideV.normalize();
      // Each leaf its own pose: spread, droop, lean, twist round the stem, roll round its midrib, facing tilt.
      const ang = THREE.MathUtils.degToRad((rand() * 2 - 1) * C.leafAngleJitterDeg * R);
      const roll = THREE.MathUtils.degToRad((rand() * 2 - 1) * C.leafRollDeg * R);
      const mixR = (r) => lerp(lerp(r[0], r[1], 0.5), range(r), R);
      const spread = mixR(C.leafSpread), droop = mixR(C.leafDroop), lean = mixR(C.leafLean), tilt = mixR(C.leafFaceTilt);
      const faceSide = (rand() - 0.5) * 0.8 * R;
      let placed = false;
      for (let attempt = 0; attempt < 3 && !placed; attempt++) {
        const sgn = attempt === 1 ? -sideSign : sideSign;
        if (attempt === 2) size *= 0.6;
        blade.copy(sideV).multiplyScalar(spread * sgn).addScaledVector(down, droop).addScaledVector(tan, lean).normalize();
        blade.applyAxisAngle(tan, ang);
        // Facing out of its edge and toward the room, tilted up or down, then rolled round its midrib.
        face.copy(S.out).multiplyScalar(0.7).add(_room).addScaledVector(sideV, (0.25 + faceSide) * sgn);
        face.y += tilt;
        face.addScaledVector(blade, -face.dot(blade)).normalize().applyAxisAngle(blade, roll);
        Y.copy(blade).negate(); // the image's up (tip → notch) points back to the stem
        X.crossVectors(Y, face);
        if (X.lengthSq() < 1e-4) X.set(1, 0, 0);
        X.normalize();
        Z.crossVectors(X, Y).normalize();
        const w = size, h = size * LEAF_ASPECT;
        centre.copy(at).addScaledVector(blade, h / 2);
        tip.copy(at).addScaledVector(blade, h);
        edgeA.copy(centre).addScaledVector(X, w * 0.45);
        edgeB.copy(centre).addScaledVector(X, -w * 0.45);
        // Its outline must be clear of everything (from the stem to the tip and to both edges, and across).
        if (outlineBlocked(at, tip, edgeA, edgeB, C.clearance)) continue;
        m4.makeBasis(X.clone().multiplyScalar(w), Y.clone().multiplyScalar(h), Z).setPosition(centre);
        leafPlacements.push({ m: m4.clone(), at: at.clone(), tip: tip.clone(), a: edgeA.clone(), b: edgeB.clone() });
        placed = true;
        sideSign = -sgn; // alternate
      }
    }
  }
  const leafGeo = new THREE.PlaneGeometry(1, 1);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, Math.max(1, leafPlacements.length));
  leaves.name = "kitchenTrailingPlantLeaves";
  leaves.count = leafPlacements.length;
  leafPlacements.forEach((L, i) => leaves.setMatrixAt(i, L.m));
  leaves.instanceMatrix.needsUpdate = true;
  leaves.computeBoundingSphere();
  group.add(leaves);

  /** Collision check of the result: every stem segment and every leaf outline against the scenery. */
  function check() {
    const hits = [];
    let segments = 0;
    for (const S of stems)
      for (let i = 0; i < S.pts.length - 1; i++) {
        segments++;
        const h = blocked(S.pts[i], S.pts[i + 1]);
        if (h) hits.push(`stem segment hits ${h.name}`);
      }
    for (const L of leafPlacements) {
      const h = outlineBlocked(L.at, L.tip, L.a, L.b, 0);
      if (h) hits.push(`leaf hits ${h.name}`);
    }
    return { segments, leaves: leafPlacements.length, hits };
  }

  function dispose() {
    group.removeFromParent();
    stemGeo.dispose();
    stemMat.dispose();
    leafGeo.dispose();
    leafMat.dispose();
    leafTex.dispose();
    leaves.dispose();
  }

  const report = {
    plants: plants.map((P) => {
      const own = stems.filter((S) => S.plant === P);
      const hanging = own.filter((S) => !S.bushy);
      return {
        base: P.base.name,
        rimY: +P.top.rimY.toFixed(3),
        stems: own.length,
        hanging: {
          front: hanging.filter((S) => S.out.z > 0.5).length,
          left: hanging.filter((S) => S.out.x < -0.5).length,
          right: hanging.filter((S) => S.out.x > 0.5).length,
        },
        bushy: own.length - hanging.length,
      };
    }),
    stems: stems.length,
    stemTriangles: indices.length / 3,
    meanHangingLength: +(stems.filter((S) => !S.bushy).reduce((a, S) => a + S.length, 0) / Math.max(1, stems.filter((S) => !S.bushy).length)).toFixed(2),
    leaves: leafPlacements.length,
  };
  return { group, check, dispose, report, missing };
}
