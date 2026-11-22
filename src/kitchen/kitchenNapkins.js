/**
 * Paper napkins flying out of the kitchen's paper dispenser (paperDispencer).
 *
 * Emission point: found from the dispenser's own geometry (findDispenserSlot).
 * Its "out" direction is its thinnest axis, pointing toward the room's middle.
 * The recess is the set of horizontal faces that reach back into the
 * dispenser (behind its front face, minus the outer box's own top / bottom);
 * the highest of them is the recess's ceiling, and the napkins start at that
 * face's area-weighted centre, just under it.
 *
 * Release: a batch of 1..5 napkins every 4..5 s (random), each napkin of a
 * batch a little later than the one before (a random stagger).
 *
 * Motion: (1) an exit arc, a cubic Bézier from the slot, first down and out,
 * then curving up, run with an ease-in (from rest), so position and velocity
 * are continuous; (2) at its end the napkin keeps that velocity, which then
 * eases toward a breeze: a smooth, per-napkin field of layered sines (a cheap
 * smooth noise) for its direction and speed, while its orientation drifts on
 * slow sines (gentle tumbling). It stays inside the room (soft steering near
 * the walls / floor / ceiling) and never enters the furniture: every static
 * object of the kitchen model is an obstacle box (its bounds, grown by the
 * napkin's radius); the napkin steers away near one and never moves into it.
 *
 * Look: a thin square sheet (a subdivided plane), off-white, matte,
 * double-sided, with an embossed quilted pattern (colour + bump map from one
 * small canvas) and a soft light of its own on both faces (a hint of
 * translucency). It flutters in the vertex shader: ripples crossing the sheet,
 * edges waving more than the middle, and a slow fold, all per napkin
 * (seeded), with normals from the same function so the light follows.
 *
 * Lifecycle: each lives lifetime seconds, fading out at the end (or as soon as
 * it is near the room's edge for too long); a fixed pool (maxActive) drawn as
 * one InstancedMesh.
 */

/** Tuning (world units, seconds). */
export const KITCHEN_NAPKINS = {
  /** Batch size (random, inclusive) and the time between batches (random within). */
  batchMin: 1,
  batchMax: 5,
  intervalMin: 4,
  intervalMax: 5,
  /** Delay between napkins of one batch (random up to this, cumulative). */
  stagger: 0.35,
  /** Napkin: side length, and the sheet's subdivisions (for smooth bending). */
  size: 1.9,
  segments: 16,
  /** Exit arc: how far it first drops, how far it comes out, how high it then rises, sideways spread (±), and its duration. */
  arcDrop: 0.45, // (with the sheet's half size, keeps its lower edge above the recess floor while it is still inside)
  arcOut: 2.4,
  arcRise: 3.2,
  arcSide: 1.2,
  arcTime: 1.9,
  /** Floating: speed of the breeze (units/s), how fast a napkin's velocity follows it (s), and its randomness. */
  floatSpeed: 1.1,
  floatResponse: 1.4,
  /** Drift randomness: how much the breeze's direction varies (0 = straight on), and how quickly it changes over space / time. */
  driftAmount: 0.85,
  driftScale: 0.11,
  driftTime: 0.16,
  /** Vertical: average lift of the breeze (± per napkin), so some climb a little and some settle. */
  lift: 0.12,
  /** Tumbling: how far a sheet tilts (radians) and how fast it turns. */
  tilt: 0.75,
  turnSpeed: 0.35,
  /** Fluttering: strength (× the half size), ripple frequency (waves across the sheet), speed, and the slow fold. */
  flutter: 0.16,
  flutterFreq: 1.4,
  flutterSpeed: 3.2,
  fold: 0.22,
  /** Lifetime (random within), fade-in / fade-out time. */
  lifeMin: 13,
  lifeMax: 17,
  fadeIn: 0.25,
  fadeOut: 1.6,
  /** Most napkins in the air at once (the pool). */
  maxActive: 24,
  /** Room: kept this far inside its walls / floor / ceiling (soft steering within `wallSoft` of them); the top at most this far above the slot. */
  wallMargin: 1.2,
  wallSoft: 3,
  maxAboveSlot: 18,
  /** Obstacles: objects bigger than this in two directions are the room's shell (walls / floor / ceiling), not furniture. */
  shellSize: 45,
  /** Furniture avoidance: look this far ahead (s of motion) and steer away smoothly (this × floatSpeed per s). */
  avoidLookAhead: 1.4,
  avoidSteer: 2.5,
  /** Look: colour, roughness, its own soft light (both faces), bump strength. */
  color: 0xf6f3ec,
  roughness: 0.95,
  glow: 0.12,
  bump: 0.012,
};

// ---- Smooth noise (layered sines; cheap and continuous) ----
function sn(x, y, z, s) {
  return (
    Math.sin(x * 1.0 + s * 1.7 + Math.sin(y * 0.7 + s)) * 0.5 +
    Math.sin(y * 1.3 - z * 0.6 + s * 2.3) * 0.3 +
    Math.sin(z * 0.9 + x * 0.4 - s * 0.9) * 0.2
  );
}

/**
 * The dispenser's slot: { point (world, centre of the recess's ceiling), out (unit, horizontal), down (unit), width }.
 * Returns null if no recess is found.
 */
export function findDispenserSlot(THREE, mesh, roomCenter) {
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  // Out: the thinnest horizontal axis, toward the room's middle.
  const out = size.x < size.z ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const center = box.getCenter(new THREE.Vector3());
  if (roomCenter && out.dot(new THREE.Vector3().subVectors(roomCenter, center)) < 0) out.negate();
  const frontD = out.dot(out.x !== 0 ? new THREE.Vector3(out.x > 0 ? box.max.x : box.min.x, 0, 0) : new THREE.Vector3(0, 0, out.z > 0 ? box.max.z : box.min.z));
  const pos = mesh.geometry.attributes.position;
  const idx = mesh.geometry.index;
  const n = idx ? idx.count : pos.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  const levels = []; // horizontal faces reaching back into the dispenser
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld);
    nrm.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    const area = nrm.length() / 2;
    if (area < 1e-9) continue;
    nrm.normalize();
    if (Math.abs(nrm.y) < 0.85) continue; // not (nearly) horizontal
    const yMin = Math.min(a.y, b.y, c.y), yMax = Math.max(a.y, b.y, c.y);
    if (Math.abs(yMin - box.min.y) < 0.01 || Math.abs(yMax - box.max.y) < 0.01) continue; // the outer box's own top / bottom
    const back = Math.min(a.dot(out), b.dot(out), c.dot(out));
    if (back > frontD - 0.1) continue; // a thin lip on the front, not the recess
    const cy = (a.y + b.y + c.y) / 3;
    let lv = levels.find((l) => Math.abs(l.y - cy) < 0.25);
    if (!lv) levels.push((lv = { y: cy, area: 0, sum: new THREE.Vector3(), minW: Infinity, maxW: -Infinity }));
    lv.area += area;
    lv.sum.addScaledVector(new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3), area);
    const side = new THREE.Vector3(-out.z, 0, out.x); // along the slot
    for (const p of [a, b, c]) {
      lv.minW = Math.min(lv.minW, p.dot(side));
      lv.maxW = Math.max(lv.maxW, p.dot(side));
    }
  }
  if (levels.length < 2) return null;
  levels.sort((p, q) => q.y - p.y);
  const ceiling = levels[0];
  const point = ceiling.sum.multiplyScalar(1 / ceiling.area);
  return { point, out, down: new THREE.Vector3(0, -1, 0), width: ceiling.maxW - ceiling.minW, ceilingY: ceiling.y, floorY: levels[levels.length - 1].y };
}

function makePaperTexture(THREE) {
  const S = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, S, S);
  // Embossed quilting: a diamond grid of soft raised ridges, plus fine fibre noise.
  ctx.strokeStyle = "#b8b8b8";
  ctx.lineWidth = 3;
  for (let i = -S; i < S * 2; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + S, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i, S);
    ctx.lineTo(i + S, 0);
    ctx.stroke();
  }
  const img = ctx.getImageData(0, 0, S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (rnd() - 0.5) * 26;
    for (let k = 0; k < 3; k++) img.data[i + k] = Math.max(0, Math.min(255, img.data[i + k] + v));
  }
  ctx.putImageData(img, 0, 0);
  const bump = new THREE.CanvasTexture(canvas);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(2, 2);
  // Colour: near white, the quilting a touch darker.
  const c2 = document.createElement("canvas");
  c2.width = c2.height = S;
  const x2 = c2.getContext("2d");
  x2.fillStyle = "#ffffff";
  x2.fillRect(0, 0, S, S);
  x2.globalAlpha = 0.06;
  x2.drawImage(canvas, 0, 0);
  const map = new THREE.CanvasTexture(c2);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2, 2);
  return { map, bump };
}

/**
 * @param {{ THREE, scene, root: THREE.Object3D, dispenser: THREE.Mesh, renderer? }} o
 * @returns {{ update(dt: number): void, dispose(): void, slot, room, obstacles: number } | null}
 */
export function createKitchenNapkins({ THREE, scene, root, dispenser }) {
  const N = KITCHEN_NAPKINS;
  root.updateMatrixWorld(true);
  // Obstacles (furniture boxes) and the room's shell (its bounds).
  const shell = new THREE.Box3();
  const obstacles = []; // Box3 (grown later by the napkin's radius)
  const tmpBox = new THREE.Box3();
  const tmpSize = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    if (/Physic$/.test(o.name)) return; // invisible collision proxies
    tmpBox.setFromObject(o);
    if (tmpBox.isEmpty()) return;
    tmpBox.getSize(tmpSize);
    const big = [tmpSize.x, tmpSize.y, tmpSize.z].filter((v) => v > N.shellSize).length;
    if (big >= 2) shell.union(tmpBox);
    else obstacles.push(tmpBox.clone());
  });
  // The room: the shell, but measured from inside (rays from the slot's front out to the shell's surfaces).
  const room0 = shell.isEmpty() ? new THREE.Box3().setFromObject(root) : shell;
  const slot = findDispenserSlot(THREE, dispenser, room0.getCenter(new THREE.Vector3()));
  if (!slot) return null;
  const shellMeshes = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    tmpBox.setFromObject(o);
    tmpBox.getSize(tmpSize);
    if ([tmpSize.x, tmpSize.y, tmpSize.z].filter((v) => v > N.shellSize).length >= 2) shellMeshes.push(o);
  });
  const ray = new THREE.Raycaster();
  const probe = slot.point.clone().addScaledVector(slot.out, 4).add(new THREE.Vector3(0, 2, 0));
  const reach = (dir, fallback) => {
    ray.set(probe, dir);
    ray.far = 400;
    const hits = ray.intersectObjects(shellMeshes, false);
    return hits.length ? hits[0].point : fallback;
  };
  const room = new THREE.Box3(
    new THREE.Vector3(
      reach(new THREE.Vector3(-1, 0, 0), room0.min).x,
      reach(new THREE.Vector3(0, -1, 0), room0.min).y,
      reach(new THREE.Vector3(0, 0, -1), room0.min).z,
    ),
    new THREE.Vector3(
      reach(new THREE.Vector3(1, 0, 0), room0.max).x,
      reach(new THREE.Vector3(0, 1, 0), room0.max).y,
      reach(new THREE.Vector3(0, 0, 1), room0.max).z,
    ),
  );
  room.max.y = Math.min(room.max.y, slot.point.y + N.maxAboveSlot);
  room.min.addScalar(N.wallMargin);
  room.max.addScalar(-N.wallMargin);
  // The napkin's radius grows each obstacle box (a sheet never pokes into furniture).
  const radius = N.size * 0.5;
  for (const bx of obstacles) bx.expandByScalar(radius * 0.6);
  const dispenserBox = new THREE.Box3().setFromObject(dispenser).expandByScalar(radius * 0.6);

  // ---- The sheet: geometry, material (flutter in the vertex shader) ----
  const geo = new THREE.PlaneGeometry(N.size, N.size, N.segments, N.segments);
  const aNap = new THREE.InstancedBufferAttribute(new Float32Array(N.maxActive * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("aNap", aNap); // seed, flutter (× half size), opacity, own time
  const tex = makePaperTexture(THREE);
  const mat = new THREE.MeshStandardMaterial({
    color: N.color,
    map: tex.map,
    bumpMap: tex.bump,
    bumpScale: N.bump,
    roughness: N.roughness,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    emissive: new THREE.Color(N.color),
    emissiveIntensity: N.glow, // a soft light of its own on both faces (thin paper lets light through)
  });
  const uniforms = {
    uHalf: { value: N.size / 2 },
    uFreq: { value: N.flutterFreq },
    uSpeed: { value: N.flutterSpeed },
    uFold: { value: N.fold },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      `attribute vec4 aNap;
      uniform float uHalf;
      uniform float uFreq;
      uniform float uSpeed;
      uniform float uFold;
      varying float vNapAlpha;
      // The sheet's lift (along its normal) at local (x, y): ripples, edges waving more, a slow fold.
      float napLift(vec2 p) {
        float s = aNap.x, t = aNap.w;
        vec2 q = p / uHalf; // -1..1
        float k = 3.14159 * uFreq;
        float edge = smoothstep(0.15, 1.35, length(q));
        float w = sin(q.x * k + t * uSpeed + s * 6.28) * cos(q.y * k * 0.8 - t * uSpeed * 0.83 + s * 3.1) * 0.6
                + sin((q.x + q.y) * k * 0.6 + t * uSpeed * 1.21 + s * 11.0) * 0.4;
        float fold = sin(t * 0.55 + s * 5.0) * (q.x * q.x - q.y * q.y) * uFold
                   + sin(t * 0.37 + s * 9.0) * q.x * q.y * uFold * 0.8;
        return uHalf * (aNap.y * w * (0.25 + 0.75 * edge) + fold);
      }
      ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <beginnormal_vertex>",
        `float e = uHalf * 0.02;
        float hC = napLift(position.xy);
        float dx = (napLift(position.xy + vec2(e, 0.0)) - hC) / e;
        float dy = (napLift(position.xy + vec2(0.0, e)) - hC) / e;
        vec3 objectNormal = normalize(vec3(-dx, -dy, 1.0));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3(position.xy, position.z + hC);
        vNapAlpha = aNap.z;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "varying float vNapAlpha;\nvoid main() {")
      .replace("#include <alphamap_fragment>", "#include <alphamap_fragment>\ndiffuseColor.a *= vNapAlpha;");
  };
  mat.customProgramCacheKey = () => "kitchenNapkin";
  const mesh = new THREE.InstancedMesh(geo, mat, N.maxActive);
  mesh.name = "kitchenNapkins";
  mesh.count = 0;
  mesh.frustumCulled = false; // they roam the whole room
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 4;
  scene.add(mesh);

  // ---- The pool ----
  const pool = [];
  for (let i = 0; i < N.maxActive; i++) {
    pool.push({
      on: false,
      age: 0,
      life: 0,
      seed: 0,
      flutter: 0,
      lift: 0,
      // exit arc (Bézier control points)
      p0: new THREE.Vector3(),
      p1: new THREE.Vector3(),
      p2: new THREE.Vector3(),
      p3: new THREE.Vector3(),
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      yaw: 0,
      edgeTime: 0,
    });
  }
  const side = new THREE.Vector3(-slot.out.z, 0, slot.out.x);
  let timer = 0.8; // the first batch shortly after the level is up
  const pending = []; // { at } (seconds until the napkin starts)

  function launch() {
    const p = pool.find((q) => !q.on);
    if (!p) return; // pool full: this one is skipped
    p.on = true;
    p.age = 0;
    p.life = N.lifeMin + Math.random() * (N.lifeMax - N.lifeMin);
    p.seed = Math.random();
    p.flutter = N.flutter * (0.7 + 0.6 * Math.random());
    p.lift = (Math.random() * 2 - 1) * N.lift;
    p.edgeTime = 0;
    const sideOff = (Math.random() * 2 - 1) * N.arcSide;
    const slotOff = (Math.random() * 2 - 1) * slot.width * 0.2;
    const s = 0.8 + 0.4 * Math.random();
    // Start hanging from the ceiling's middle (the sheet's centre half a sheet below it), then down, out, and up.
    p.p0.copy(slot.point).addScaledVector(side, slotOff).add(new THREE.Vector3(0, -radius * 0.35, 0));
    p.p1.copy(p.p0).add(new THREE.Vector3(0, -N.arcDrop * s, 0)).addScaledVector(slot.out, N.arcOut * 0.35 * s);
    p.p2.copy(p.p0).add(new THREE.Vector3(0, -N.arcDrop * 0.6 * s, 0)).addScaledVector(slot.out, N.arcOut * s).addScaledVector(side, sideOff * 0.5);
    p.p3.copy(p.p0).add(new THREE.Vector3(0, N.arcRise * s, 0)).addScaledVector(slot.out, N.arcOut * 1.5 * s).addScaledVector(side, sideOff);
    p.pos.copy(p.p0);
    p.vel.set(0, 0, 0);
    p.yaw = Math.atan2(slot.out.x, slot.out.z) + (Math.random() * 2 - 1) * 0.4;
  }

  // Bézier position / derivative at s.
  const bez = (p, s, out) => {
    const u = 1 - s;
    return out
      .copy(p.p0).multiplyScalar(u * u * u)
      .addScaledVector(p.p1, 3 * u * u * s)
      .addScaledVector(p.p2, 3 * u * s * s)
      .addScaledVector(p.p3, s * s * s);
  };
  const bezD = (p, s, out) => {
    const u = 1 - s;
    return out
      .subVectors(p.p1, p.p0).multiplyScalar(3 * u * u)
      .addScaledVector(new THREE.Vector3().subVectors(p.p2, p.p1), 6 * u * s)
      .addScaledVector(new THREE.Vector3().subVectors(p.p3, p.p2), 3 * s * s);
  };

  const _want = new THREE.Vector3();
  const _next = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _one = new THREE.Vector3(1, 1, 1);
  let clock = 0;

  const _ahead = new THREE.Vector3();
  /**
   * Keeps a floating napkin out of the furniture, smoothly: if where it is heading (avoidLookAhead seconds on)
   * is inside a box, it steers away from that box's nearest face, gradually; and if it would still enter one
   * this step, the part of its velocity into that face is removed (it slides along it, never through).
   */
  function avoid(p, dt) {
    _ahead.copy(p.pos).addScaledVector(p.vel, N.avoidLookAhead);
    _next.copy(p.pos).addScaledVector(p.vel, dt);
    for (let i = -1; i < obstacles.length; i++) {
      const bx = i < 0 ? dispenserBox : obstacles[i];
      const insideNow = bx.containsPoint(p.pos);
      if (insideNow) {
        // Already inside (it started there): head out the nearest side, gently.
        const dxm = p.pos.x - bx.min.x, dxM = bx.max.x - p.pos.x;
        const dym = p.pos.y - bx.min.y, dyM = bx.max.y - p.pos.y;
        const dzm = p.pos.z - bx.min.z, dzM = bx.max.z - p.pos.z;
        const m = Math.min(dxm, dxM, dym, dyM, dzm, dzM);
        _d.set(m === dxM ? 1 : m === dxm ? -1 : 0, m === dyM ? 1 : m === dym ? -1 : 0, m === dzM ? 1 : m === dzm ? -1 : 0);
        p.vel.addScaledVector(_d, N.floatSpeed * N.avoidSteer * dt);
        continue;
      }
      if (bx.containsPoint(_ahead)) {
        // Heading into it: steer away from the face it would cross first (smooth, a little each frame).
        let best = Infinity, ax = "y", sign = 1;
        for (const a of ["x", "y", "z"]) {
          const v = p.vel[a];
          if (Math.abs(v) < 1e-6) continue;
          const face = v > 0 ? bx.min[a] : bx.max[a];
          const t = (face - p.pos[a]) / v;
          if (t >= 0 && t < best) {
            best = t;
            ax = a;
            sign = v > 0 ? -1 : 1;
          }
        }
        p.vel[ax] += sign * N.floatSpeed * N.avoidSteer * dt;
      }
      if (bx.containsPoint(_next)) {
        // Still about to enter it this step: no motion through the face it crosses (slides along it).
        for (const a of ["x", "y", "z"]) {
          const was = p.pos[a], will = _next[a];
          if ((was <= bx.min[a] && will > bx.min[a]) || (was >= bx.max[a] && will < bx.max[a])) p.vel[a] = 0;
        }
      }
    }
  }

  function update(dt) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.05);
    clock += dt;
    // Batches.
    timer -= dt;
    if (timer <= 0) {
      const n = N.batchMin + Math.floor(Math.random() * (N.batchMax - N.batchMin + 1));
      let at = 0;
      for (let i = 0; i < n; i++) {
        pending.push({ at });
        at += Math.random() * N.stagger;
      }
      timer = N.intervalMin + Math.random() * (N.intervalMax - N.intervalMin);
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      pending[i].at -= dt;
      if (pending[i].at <= 0) {
        launch();
        pending.splice(i, 1);
      }
    }
    let k = 0;
    for (const p of pool) {
      if (!p.on) continue;
      p.age += dt;
      const t = clock + p.seed * 100;
      let tiltBlend = 1;
      if (p.age < N.arcTime) {
        // Exit arc: s = ease-in (from rest, full speed at the end).
        const x = p.age / N.arcTime;
        const sEase = x * x * (2 - x);
        const ds = (4 * x - 3 * x * x) / N.arcTime; // ds/dt
        bez(p, sEase, p.pos);
        bezD(p, sEase, p.vel).multiplyScalar(ds);
        tiltBlend = x * x * (3 - 2 * x);
      } else {
        // Floating: the velocity eases toward the breeze (smooth noise), kept in the room, out of the furniture.
        const f = N.driftScale, ft = N.driftTime;
        const px = p.pos.x * f, py = p.pos.y * f, pz = p.pos.z * f, tt = t * ft;
        _want.set(
          sn(px + tt, py, pz, p.seed * 13),
          sn(py - tt * 0.7, pz, px, p.seed * 29) * 0.5 + p.lift / Math.max(0.01, N.floatSpeed),
          sn(pz + tt * 0.8, px, py, p.seed * 41),
        );
        // Straight on (out from the dispenser) blended with the noise by driftAmount.
        _want.multiplyScalar(N.driftAmount).addScaledVector(slot.out, (1 - N.driftAmount) * 0.6);
        if (_want.lengthSq() > 1e-6) _want.normalize();
        _want.multiplyScalar(N.floatSpeed * (0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.3 + p.seed * 7))));
        // Soft walls: steer back in near the room's edges.
        let nearEdge = false;
        for (const ax of ["x", "y", "z"]) {
          const lo = p.pos[ax] - room.min[ax], hi = room.max[ax] - p.pos[ax];
          if (lo < N.wallSoft) { _want[ax] += N.floatSpeed * (1 - Math.max(0, lo) / N.wallSoft) * 1.5; nearEdge = true; }
          if (hi < N.wallSoft) { _want[ax] -= N.floatSpeed * (1 - Math.max(0, hi) / N.wallSoft) * 1.5; nearEdge = true; }
        }
        p.vel.lerp(_want, 1 - Math.exp(-dt / N.floatResponse));
        avoid(p, dt);
        p.pos.addScaledVector(p.vel, dt);
        // Hard room bounds (it never leaves it).
        p.pos.clamp(room.min, room.max);
        p.edgeTime = nearEdge ? p.edgeTime + dt : 0;
      }
      // Orientation: hanging from the slot at first (sheet facing out), easing into a slow tumble.
      p.yaw += Math.sin(t * N.turnSpeed + p.seed * 9) * N.turnSpeed * dt;
      const pitchFloat = -Math.PI / 2 + Math.sin(t * 0.43 + p.seed * 3) * N.tilt;
      const rollFloat = Math.sin(t * 0.31 + p.seed * 5) * N.tilt * 0.8;
      _e.set(pitchFloat * tiltBlend, p.yaw, rollFloat * tiltBlend, "YXZ");
      _q.setFromEuler(_e);
      _m.compose(p.pos, _q, _one);
      mesh.setMatrixAt(k, _m);
      // Opacity: fade in, fade out at the end of its life (or after lingering at the room's edge).
      const left = Math.min(p.life - p.age, p.edgeTime > 2 ? N.fadeOut - (p.edgeTime - 2) : Infinity);
      const alpha = Math.min(1, p.age / N.fadeIn) * Math.min(1, Math.max(0, left) / N.fadeOut);
      aNap.setXYZW(k, p.seed, p.flutter, alpha, t);
      if (left <= 0) p.on = false;
      k++;
    }
    mesh.count = k;
    mesh.visible = k > 0;
    mesh.instanceMatrix.needsUpdate = true;
    aNap.needsUpdate = true;
  }

  return {
    update,
    slot,
    room,
    obstacles: obstacles.length,
    get active() {
      return pool.filter((p) => p.on).length;
    },
    pool,
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
      tex.map.dispose();
      tex.bump.dispose();
    },
  };
}
