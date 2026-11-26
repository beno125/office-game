/**
 * The office dog: a life-size border collie lying on the floor (after a reference photo), built in code (no
 * model file): its body and head are each one smooth surface (shapes blended into each other, meshed by
 * marching cubes), the tail a smooth skinned tube; black coat with the breed's white parts (blaze, muzzle, collar and chest,
 * legs and paws, tail tip), a soft fur sheen. It breathes, wags its tail (in spells: harder, softer, resting
 * a moment) and turns its head now and then to a new random look (left / right, up / down, a tilt).
 *
 * Built in metres (dog's frame: +x forward toward its nose, +y up, origin on the floor under its chest), then
 * scaled to the office's units. Visual only (no collider).
 */

/** Tuning. */
export const OFFICE_DOG = {
  coat: 0x121214, // black fur
  white: 0xefece6, // white fur
  nose: 0x0b0b0c,
  eye: 0x2a1a10, // dark brown
  tongue: 0xd8707e,
  /** Fur: a soft sheen at grazing angles (MeshPhysical sheen), matt otherwise. */
  sheen: { amount: 0.9, roughness: 0.5, color: 0x8a8a90 },
  /**
   * The coat's surface: the body and the head are each one smooth surface, the shapes below blended into each
   * other (`blend`, metres) and meshed by marching cubes at `bodyRes` / `headRes` cells across (finer = smoother,
   * slower to build, once); black and white blend over `colourSoft` metres.
   */
  surface: { bodyRes: 92, headRes: 64, blend: 0.045, colourSoft: 0.006, maxTris: 160000 },
  /** The coat's tufts: up to `amount` metres out from the shapes (× each shape's fluff), `tuft` metres across. */
  fur: { amount: 0.016, tuft: 0.03 },
  roughness: 0.82,
  breathe: { period: 2.6, amount: 0.018 }, // s; the chest's rise (share of its height)
  /** Tail: wags side to side; each spell `spell` s long (min / max), at `hz`, with a random strength. */
  tail: {
    hz: 3.2,
    amount: [0.15, 0.55], // radians at the base (min / max of a spell)
    spell: [1.6, 4.5],
    restChance: 0.22, // a spell is a pause instead
    lag: 0.5, // phase lag per segment (the whip)
  },
  /** Head: a new random look every `every` s (min / max), eased there over ~`ease` s. */
  head: {
    every: [1.4, 4.8],
    yaw: 0.6, // ± radians, left / right
    pitch: [-0.18, 0.3], // down / up
    roll: 0.22, // ± tilt
    ease: 0.55,
  },
};

export function createOfficeDog(THREE) {
  const D = OFFICE_DOG;
  const R = D.surface;
  // One fur material for the whole coat (black / white from the vertex colours), a soft sheen.
  const furMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: D.roughness,
    metalness: 0,
    sheen: D.sheen.amount,
    sheenRoughness: D.sheen.roughness,
    sheenColor: new THREE.Color(D.sheen.color),
  });
  const mats = {
    fur: furMat,
    nose: new THREE.MeshStandardMaterial({ color: D.nose, roughness: 0.35 }),
    eye: new THREE.MeshStandardMaterial({ color: D.eye, roughness: 0.1 }),
    tongue: new THREE.MeshStandardMaterial({ color: D.tongue, roughness: 0.45 }),
  };
  const geos = [];
  const colours = [new THREE.Color(D.coat), new THREE.Color(D.white)];
  const COAT = 0, WHITE = 1;

  // --- Shapes, blended into one smooth surface (a distance field, then marching cubes) ---
  /** A shape: ellipsoid (E) or capsule (C), black or white, `f` its fluff (0 smooth → 1 the fullest coat). */
  const E = (color, c, r, rot, f = 0.35) => {
    const p = { kind: 0, color, c, r, inv: null, f };
    if (rot) p.inv = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)).invert().elements;
    return p;
  };
  const C = (color, a, b, rad, f = 0.25) => ({ kind: 1, color, a, b, rad, f });
  // Fur: value noise (two octaves) pushing the surface out / in, in tufts (OFFICE_DOG.fur).
  const hash = (x, y, z) => {
    let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) & 0xffff) / 0xffff;
  };
  const vnoise = (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(hash(xi, yi, zi), hash(xi + 1, yi, zi), u), l(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u), v),
      l(l(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u), l(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u), v),
      w,
    );
  };
  const furNoise = (x, y, z) => {
    const F = D.fur;
    // Tufts, a little longer along the body (the coat lies back along it).
    const a = vnoise(x / (F.tuft * 1.8), y / F.tuft, z / F.tuft);
    const b = vnoise(x / (F.tuft * 0.9) + 17.3, y / (F.tuft * 0.5) + 5.1, z / (F.tuft * 0.5) - 9.7);
    return (a * 0.65 + b * 0.35) * 2 - 1; // -1 … 1
  };
  function sd(p, x, y, z) {
    if (p.kind === 1) {
      const [ax, ay, az] = p.a, [bx, by, bz] = p.b;
      const pax = x - ax, pay = y - ay, paz = z - az, bax = bx - ax, bay = by - ay, baz = bz - az;
      const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
      return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - p.rad;
    }
    let px = x - p.c[0], py = y - p.c[1], pz = z - p.c[2];
    if (p.inv) {
      const e = p.inv;
      const qx = e[0] * px + e[4] * py + e[8] * pz, qy = e[1] * px + e[5] * py + e[9] * pz, qz = e[2] * px + e[6] * py + e[10] * pz;
      px = qx; py = qy; pz = qz;
    }
    const [rx, ry, rz] = p.r;
    const k0 = Math.hypot(px / rx, py / ry, pz / rz);
    const k1 = Math.hypot(px / (rx * rx), py / (ry * ry), pz / (rz * rz));
    return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
  }
  /** Marching cubes over the shapes' smooth union, in a cube round `box` (min / max, metres); `floor`: cut flat at y 0. */
  function surface(MarchingCubes, prims, box, res, blend, floor) {
    const centre = [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2, (box[0][2] + box[1][2]) / 2];
    const half = Math.max(box[1][0] - box[0][0], box[1][1] - box[0][1], box[1][2] - box[0][2]) / 2 + 0.03;
    const mc = new MarchingCubes(res, furMat, false, true, R.maxTris);
    const ISO = mc.isolation;
    const voxel = (2 * half) / res;
    const G = ISO / (3 * voxel);
    const field = mc.field, pal = mc.palette;
    const n = prims.length;
    const d = new Float32Array(n);
    // A bounding sphere per shape: cells far from all of them are outside (the field is clamped there anyway).
    const bound = prims.map((p) =>
      p.kind === 1
        ? [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2, Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]) / 2 + p.rad]
        : [p.c[0], p.c[1], p.c[2], Math.max(...p.r)],
    );
    const far = (3 * ISO) / G + blend; // beyond this the field is at its outside clamp
    let q = 0;
    for (let iz = 0; iz < res; iz++) {
      const z = centre[2] + half * ((iz - res / 2) / (res / 2));
      for (let iy = 0; iy < res; iy++) {
        const y = centre[1] + half * ((iy - res / 2) / (res / 2));
        for (let ix = 0; ix < res; ix++, q++) {
          const x = centre[0] + half * ((ix - res / 2) / (res / 2));
          let near = false;
          for (let i = 0; i < n && !near; i++) {
            const b = bound[i];
            near = Math.hypot(x - b[0], y - b[1], z - b[2]) - b[3] < far;
          }
          if (!near) {
            field[q] = -3 * ISO;
            continue;
          }
          // Smooth union (polynomial smooth min), the colour from the nearest shapes.
          let u = 1e9, best = 1e9, bi = 0;
          for (let i = 0; i < n; i++) {
            const di = sd(prims[i], x, y, z);
            d[i] = di;
            if (di < best) {
              best = di;
              bi = i;
            }
            const h = Math.max(blend - Math.abs(u - di), 0) / blend;
            u = Math.min(u, di) - h * h * blend * 0.25;
          }
          // The coat: tufts out of the surface (as fluffy as the nearest shape); none where it meets the floor.
          if (Math.abs(u) < far) u -= D.fur.amount * prims[bi].f * (0.55 + 0.45 * furNoise(x, y, z)) * Math.min(1, y / 0.03 + 0.2);
          if (floor) u = Math.max(u, -y);
          field[q] = Math.min(3 * ISO, Math.max(-3 * ISO, ISO - u * G));
          if (Math.abs(u) < 4 * voxel) {
            let wr = 0, wg = 0, wb = 0, ws = 0;
            for (let i = 0; i < n; i++) {
              const w = Math.exp(-(d[i] - best) / R.colourSoft);
              const c = colours[prims[i].color];
              wr += c.r * w; wg += c.g * w; wb += c.b * w; ws += w;
            }
            pal[q * 3] = wr / ws; pal[q * 3 + 1] = wg / ws; pal[q * 3 + 2] = wb / ws;
          }
        }
      }
    }
    mc.update();
    const count = mc.count;
    const pos = mc.positionArray.slice(0, count * 3), nor = mc.normalArray.slice(0, count * 3), col = mc.colorArray.slice(0, count * 3);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) pos[i * 3 + k] = centre[k] + half * pos[i * 3 + k];
      const l = Math.hypot(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]) || 1;
      nor[i * 3] /= l; nor[i * 3 + 1] /= l; nor[i * 3 + 2] /= l;
    }
    mc.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    geos.push(g);
    return g;
  }

  // Body: lying on its belly (sphinx pose), hind legs folded at its sides.
  const bodyPrims = [
    E(COAT, [-0.02, 0.15, 0], [0.34, 0.145, 0.155], null, 0.55), // the barrel
    E(COAT, [-0.24, 0.14, 0.1], [0.17, 0.125, 0.1]), // the haunches
    E(COAT, [-0.24, 0.14, -0.1], [0.17, 0.125, 0.1]),
    E(COAT, [0.2, 0.17, 0], [0.18, 0.17, 0.145]), // the chest
    E(WHITE, [0.3, 0.16, 0], [0.11, 0.15, 0.1]), // white chest
    E(WHITE, [0.12, 0.05, 0], [0.16, 0.05, 0.1]), // a little white under the belly
    E(COAT, [0.3, 0.31, 0], [0.11, 0.14, 0.105], [0, 0, -0.5]), // the neck
    E(WHITE, [0.34, 0.3, 0], [0.1, 0.13, 0.11], [0, 0, -0.5]), // the white collar (front)
    E(WHITE, [0.3, 0.28, 0], [0.07, 0.11, 0.13], [0, 0, -0.5]), // (round the sides)
    // The border collie's coat: a big white ruff round the neck, a bib hanging down the chest between the
    // front legs, a black mane over the shoulders, fluffy hind quarters.
    E(WHITE, [0.33, 0.25, 0], [0.11, 0.14, 0.155], [0, 0, -0.45], 1), // the ruff
    E(WHITE, [0.37, 0.11, 0], [0.075, 0.09, 0.08], null, 1), // the bib
    E(COAT, [0.22, 0.33, 0], [0.11, 0.09, 0.135], [0, 0, -0.3], 1), // the mane
    E(COAT, [-0.34, 0.14, 0.11], [0.11, 0.12, 0.09], null, 0.9), // the hind "trousers"
    E(COAT, [-0.34, 0.14, -0.11], [0.11, 0.12, 0.09], null, 0.9),
  ];
  for (const z of [0.075, -0.075]) {
    bodyPrims.push(
      C(COAT, [0.22, 0.1, z], [0.34, 0.05, z], 0.045), // front legs stretched forward, white below
      C(WHITE, [0.33, 0.045, z], [0.55, 0.035, z], 0.038),
      E(WHITE, [0.37, 0.04, z * 1.05], [0.1, 0.03, 0.042], null, 0.9), // feathering behind the forearm
      E(WHITE, [0.58, 0.028, z], [0.055, 0.028, 0.038], null, 0.15), // paws
    );
  }
  for (const s of [1, -1]) {
    bodyPrims.push(
      C(COAT, [-0.34, 0.06, 0.15 * s], [-0.14, 0.04, 0.17 * s], 0.042), // hind legs along the floor
      C(WHITE, [-0.14, 0.035, 0.17 * s], [-0.04, 0.03, 0.175 * s], 0.034),
      E(WHITE, [-0.02, 0.026, 0.175 * s], [0.05, 0.026, 0.035], null, 0.15), // paws
    );
  }
  // Head (head-local; on a pivot at the top of the neck): black skull and ears, white blaze and muzzle.
  const headPrims = [
    E(COAT, [0.04, 0.03, 0], [0.105, 0.09, 0.085], null, 0.2), // skull
    E(COAT, [0.02, 0.0, 0.055], [0.07, 0.07, 0.04], null, 0.7), // cheeks (fluffy)
    E(COAT, [0.02, 0.0, -0.055], [0.07, 0.07, 0.04], null, 0.7),
    E(WHITE, [0.105, 0.068, 0], [0.07, 0.016, 0.01], [0, 0, -0.32], 0.05), // the narrow white blaze up the forehead
    E(COAT, [0.13, -0.008, 0], [0.065, 0.045, 0.05], null, 0.1), // the muzzle's base, black (round the eyes and cheeks)
    E(WHITE, [0.178, -0.016, 0], [0.058, 0.036, 0.039], null, 0.06), // the white front of the muzzle
    E(WHITE, [0.15, 0.026, 0], [0.06, 0.014, 0.011], null, 0.05), // the blaze down the muzzle's top
    E(WHITE, [0.14, -0.05, 0], [0.07, 0.018, 0.035], null, 0.1), // lower jaw
  ];
  for (const s of [1, -1]) {
    // Ears: semi-erect, leaning out to the side, the tips folding forward.
    headPrims.push(
      E(COAT, [-0.005, 0.112, 0.058 * s], [0.034, 0.045, 0.013], [-0.45 * s, 0, 0.15], 0.15), // wide at the base
      E(COAT, [0.006, 0.152, 0.074 * s], [0.02, 0.032, 0.01], [-0.5 * s, 0, -0.45], 0.05), // narrowing, tipping forward
    );
  }

  const dog = new THREE.Group();
  dog.name = "officeDog";
  const body = new THREE.Group();
  dog.add(body);
  const head = new THREE.Group();
  head.position.set(0.38, 0.4, 0);
  head.scale.setScalar(1.0);
  dog.add(head);
  const sphere = new THREE.SphereGeometry(1, 32, 24);
  geos.push(sphere);
  const ell = (parent, mat, pos, r) => {
    const m = new THREE.Mesh(sphere, mat);
    m.position.set(...pos);
    m.scale.set(...r);
    parent.add(m);
    return m;
  };
  ell(head, mats.nose, [0.232, 0.002, 0], [0.019, 0.016, 0.02]); // nose
  ell(head, mats.tongue, [0.16, -0.04, 0], [0.05, 0.012, 0.024]); // tongue (panting)
  for (const z of [0.046, -0.046]) ell(head, mats.eye, [0.108, 0.042, z], [0.016, 0.015, 0.014]); // eyes (glossy, on the black)
  // The coat surfaces (made once the marching cubes module is in).
  const nextFrame = () => new Promise((r) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));
  const ready = import("three/addons/objects/MarchingCubes.js").then(async ({ MarchingCubes }) => {
    const bodyMesh = new THREE.Mesh(surface(MarchingCubes, bodyPrims, [[-0.45, 0, -0.24], [0.68, 0.46, 0.24]], R.bodyRes, R.blend, true), furMat);
    body.add(bodyMesh);
    await nextFrame(); // the head on the next frame (two shorter stalls under the loader, not one)
    const headMesh = new THREE.Mesh(surface(MarchingCubes, headPrims, [[-0.08, -0.08, -0.12], [0.25, 0.2, 0.12]], R.headRes, R.blend * 0.6, false), furMat);
    head.add(headMesh);
  });

  // Tail: one smooth tapered, fluffy tube on a chain of bones (skinned: it bends smoothly), white tip.
  const N = 7, segLen = 0.06, tailLen = N * segLen;
  const tg = new THREE.CylinderGeometry(1, 1, tailLen, 18, 56, false);
  tg.translate(0, -tailLen / 2, 0); // from 0 (root) down to -tailLen along y
  tg.rotateZ(-Math.PI / 2); // along -x (y -> -x)
  {
    const pos = tg.attributes.position;
    const skinI = [], skinW = [], cols = [];
    const tip = new THREE.Color(D.white), coat = new THREE.Color(D.coat), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const s = Math.min(1, Math.max(0, -pos.getX(i) / tailLen)); // 0 root → 1 tip
      // Bushy, the border collie's: full through its length, a long feathered fringe hanging below, a tapering tip.
      const r = 0.05 * (1 - 0.45 * s) * (0.8 + 0.45 * Math.sin(Math.PI * Math.min(1, s * 1.1 + 0.1)));
      const yv = pos.getY(i);
      pos.setY(i, yv * r * (yv < 0 ? 1.55 : 1));
      pos.setZ(i, pos.getZ(i) * r * 1.2);
      const b = Math.min(N - 1, s * N);
      const i0 = Math.min(N - 1, Math.floor(b)), f = b - i0;
      skinI.push(i0, Math.min(N, i0 + 1), 0, 0);
      skinW.push(1 - f, f, 0, 0);
      c.copy(coat).lerp(tip, Math.min(1, Math.max(0, (s - 0.72) / 0.12)));
      cols.push(c.r, c.g, c.b);
    }
    tg.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinI, 4));
    tg.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinW, 4));
    tg.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    tg.computeVertexNormals();
  }
  geos.push(tg);
  const bones = [];
  for (let i = 0; i <= N; i++) {
    const b = new THREE.Bone();
    b.position.x = i ? -segLen : 0;
    b.userData.restZ = i === 0 ? 1.05 : -0.2; // down off the rump, then back toward level along the floor
    b.userData.restY = i === 0 ? 0 : 0.16; // curling round toward the body
    if (i) bones[i - 1].add(b);
    bones.push(b);
  }
  const tailMesh = new THREE.SkinnedMesh(tg, furMat);
  tailMesh.add(bones[0]);
  tailMesh.bind(new THREE.Skeleton(bones));
  tailMesh.frustumCulled = false;
  const tailBase = new THREE.Group();
  tailBase.position.set(-0.36, 0.17, 0);
  tailBase.add(tailMesh);
  dog.add(tailBase);
  const segs = bones.slice(0, N);

  // State: breathing, the tail's spells, the head's looks.
  const rand = (a, b) => a + Math.random() * (b - a);
  const tail = { amount: 0.3, target: 0.3, until: 0, phase: 0 };
  const look = { yaw: 0, pitch: 0, roll: 0, ty: 0, tp: 0, tr: 0, next: 0 };
  let t = 0;
  function update(dt) {
    t += dt;
    // Breathing: the body rises a little.
    body.scale.y = 1 + D.breathe.amount * Math.sin((t / D.breathe.period) * Math.PI * 2);
    // Tail spells.
    if (t >= tail.until) {
      tail.until = t + rand(D.tail.spell[0], D.tail.spell[1]);
      tail.target = Math.random() < D.tail.restChance ? 0.02 : rand(D.tail.amount[0], D.tail.amount[1]);
    }
    tail.amount += (tail.target - tail.amount) * (1 - Math.exp(-dt * 3));
    tail.phase += dt * D.tail.hz * Math.PI * 2;
    segs.forEach((s, i) => {
      s.rotation.z = s.userData.restZ;
      s.rotation.y = s.userData.restY + Math.sin(tail.phase - i * D.tail.lag) * tail.amount * (i ? 0.45 : 1);
    });
    // Head: a new random look now and then, eased there.
    if (t >= look.next) {
      look.next = t + rand(D.head.every[0], D.head.every[1]);
      look.ty = rand(-D.head.yaw, D.head.yaw);
      look.tp = rand(D.head.pitch[0], D.head.pitch[1]);
      look.tr = rand(-D.head.roll, D.head.roll) * (Math.random() < 0.6 ? 0.3 : 1); // a full tilt now and then
    }
    const k = 1 - Math.exp(-dt / Math.max(0.05, D.head.ease / 3));
    look.yaw += (look.ty - look.yaw) * k;
    look.pitch += (look.tp - look.pitch) * k;
    look.roll += (look.tr - look.roll) * k;
    head.rotation.set(look.roll, look.yaw, look.pitch, "YZX");
  }
  update(0);

  function dispose() {
    for (const g of geos) g.dispose();
    for (const m of Object.values(mats)) m.dispose();
  }
  return { object: dog, update, dispose, ready };
}
