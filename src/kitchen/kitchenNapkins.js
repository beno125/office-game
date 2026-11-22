/**
 * Paper napkins flying out of the kitchen's paper dispenser (paperDispencer),
 * drifting all over the kitchen and landing on its surfaces.
 *
 * Emission point: found from the dispenser's own geometry (findDispenserSlot).
 * Its "out" direction is its thinnest axis, pointing toward the room's middle.
 * The recess is the set of horizontal faces that reach back into the
 * dispenser (behind its front face, minus the outer box's own top / bottom);
 * the highest of them is the recess's ceiling, and the napkins start at that
 * face's area-weighted centre, just under it.
 *
 * Release: a batch of 1..2 napkins every 4..5 s (random), each napkin of a
 * batch a little later than the one before (a random stagger).
 *
 * Motion: (1) an exit arc, a cubic Bézier from the slot, first down and out,
 * then curving up, run with an ease-in (from rest), so position and velocity
 * are continuous; (2) floating: at the arc's end the napkin keeps that
 * velocity, which then eases toward where it wants to go: a random point of
 * the room's air (a new one every few seconds, so it travels the whole room
 * at all heights) mixed with a smooth breeze (layered sines), plus a descent
 * that grows in, so it slowly comes down; its orientation drifts on slow
 * sines (gentle tumbling). It stays inside the room (soft steering near the
 * walls / ceiling, hard bounds) and, with rays against every mesh of the
 * kitchen model, steers away from what it is heading into and never moves
 * through it.
 *
 * Landing: a ray straight down finds a surface within reach (an up-facing
 * face: counter, shelf, appliance, table, floor) while it is coming down;
 * there it lands. Its resting pose is flat (its yaw kept); one ray straight
 * down per sheet vertex gives the surface under each, the supports are spread
 * one cell (so the sheet never cuts a ledge's edge between two vertices) and
 * limited in slope (a soft drape), the sheet's plane sits at the highest
 * support and each vertex hangs down to its own, at most drape × the size (a
 * float texture, one row per napkin, read in the vertex shader). It settles
 * over settleTime: slows onto that pose, flattens, its flutter dies away and
 * the drape comes in. Then it rests (no flutter, or restFlutter).
 *
 * Look: a thin square sheet (a subdivided plane), off-white, matte,
 * double-sided, with an embossed quilted pattern (colour + bump map from one
 * small canvas) and a soft light of its own on both faces (a hint of
 * translucency). It flutters in the vertex shader while flying: ripples
 * crossing the sheet, edges waving more than the middle, and a slow fold, all
 * per napkin (seeded), with normals from the same function.
 *
 * Lifecycle: resting napkins stay; beyond maxResting the oldest one fades out.
 * A napkin that finds nowhere to land within maxFlight fades out too. A fixed
 * pool (maxActive) drawn as one InstancedMesh.
 */

/** Tuning (world units, seconds). */
export const KITCHEN_NAPKINS = {
  /** Napkins per batch (random, inclusive) and the time between batches (random within). */
  batchMin: 1,
  batchMax: 2,
  intervalMin: 4,
  intervalMax: 5,
  /** Delay between napkins of one batch (random up to this, cumulative). */
  stagger: 0.35,
  /** Napkin: side length, and the sheet's subdivisions (for smooth bending and draping). */
  size: 1.9,
  segments: 16,
  /** Exit arc: how far it first drops, how far it comes out, how high it then rises, sideways spread (±), and its duration. */
  arcDrop: 0.45, // (with the sheet's half size, keeps its lower edge above the recess floor while it is still inside)
  arcOut: 2.4,
  arcRise: 3.2,
  arcSide: 1.2,
  arcTime: 1.9,
  /** Floating: speed (units/s), and how fast a napkin's velocity follows where it wants to go (s). */
  floatSpeed: 2.2,
  floatResponse: 1.4,
  /** Wandering: a new random target across the room (horizontally) every wanderTimeMin..Max s. */
  wanderTimeMin: 6,
  wanderTimeMax: 11,
  wanderMinHeight: 6,
  /** Up / down swells of the breeze (units/s), on top of the descent. */
  verticalDrift: 0.55,
  /** Drift randomness: how much the breeze turns it off its way (0 = straight to its target), and how quickly it changes over space / time. */
  driftAmount: 0.6,
  driftScale: 0.08,
  driftTime: 0.16,
  /** Vertical: a little lift per napkin (±), and the descent rate (units/s) it comes down at, grown in over descentRamp s. */
  lift: 0.1,
  descentRate: 0.7,
  descentRamp: 5,
  /** Tumbling: how far a sheet tilts (radians) and how fast it turns. */
  tilt: 0.75,
  turnSpeed: 0.35,
  /** Fluttering while flying: strength (× the half size), ripple frequency, speed, and the slow fold; at rest (0 = still). */
  flutter: 0.16,
  flutterFreq: 1.4,
  flutterSpeed: 3.2,
  fold: 0.22,
  restFlutter: 0,
  /** Landing: the steepest surface it lands on (its normal's up part), the settle time (s), the drape (most a vertex hangs, × the size), its softness (max drop per cell, × the cell), and the gap kept above the surface. */
  landNormal: 0.6,
  /** Share of the sheet's vertices that must find the surface (from above) at the landing height, or it doesn't land there. */
  landSupport: 0.15,
  /** Clear space needed above a landing spot: nothing within this height over any part of the sheet (else it flies on). */
  landClear: 3,
  settleTime: 1.1,
  drape: 0.3,
  drapeSlope: 0.9,
  restLift: 0.012,
  /** Lifecycle: most napkins resting at once (the oldest fades beyond it), the longest a napkin flies before fading, fade-in / fade-out. */
  maxResting: 8,
  maxFlight: 60,
  fadeIn: 0.25,
  fadeOut: 1.6,
  /** Most napkins in the scene at once (flying + resting; the pool). */
  maxActive: 16,
  /** Room: kept this far inside its walls / ceiling (soft steering within `wallSoft` of them); the top at most this far above the slot. */
  wallMargin: 1.2,
  wallSoft: 3,
  maxAboveSlot: 18,
  /** Objects bigger than this in two directions are the room's shell (walls / floor / ceiling): the room's bounds come from them. */
  shellSize: 45,
  /** Avoidance while flying: look this far ahead (s of motion) and steer away (this × floatSpeed per s). */
  avoidLookAhead: 1.2,
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
 * @param {{ THREE, scene, root: THREE.Object3D, dispenser: THREE.Mesh }} o
 * @returns {{ update(dt: number): void, dispose(): void, slot, room, pool, active, resting } | null}
 */
export function createKitchenNapkins({ THREE, scene, root, dispenser }) {
  const N = KITCHEN_NAPKINS;
  root.updateMatrixWorld(true);
  // Collision meshes: every visible mesh of the kitchen model (the walls, floor and furniture alike).
  const solids = [];
  const shell = new THREE.Box3();
  const tmpBox = new THREE.Box3();
  const tmpSize = new THREE.Vector3();
  const shellMeshes = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.visible || /Physic$/.test(o.name)) return;
    solids.push(o);
    tmpBox.setFromObject(o);
    if (tmpBox.isEmpty()) return;
    tmpBox.getSize(tmpSize);
    if ([tmpSize.x, tmpSize.y, tmpSize.z].filter((v) => v > N.shellSize).length >= 2) {
      shell.union(tmpBox);
      shellMeshes.push(o);
    }
  });
  const room0 = shell.isEmpty() ? new THREE.Box3().setFromObject(root) : shell;
  const slot = findDispenserSlot(THREE, dispenser, room0.getCenter(new THREE.Vector3()));
  if (!slot) return null;
  // The room: rays from in front of the slot out to the shell (walls / ceiling); the floor is the shell's bottom.
  const ray = new THREE.Raycaster();
  const probe = slot.point.clone().addScaledVector(slot.out, 4).add(new THREE.Vector3(0, 2, 0));
  const reach = (dir, fallback) => {
    ray.set(probe, dir);
    ray.near = 0;
    ray.far = 400;
    const hits = ray.intersectObjects(shellMeshes, false);
    return hits.length ? hits[0].point : fallback;
  };
  const room = new THREE.Box3(
    new THREE.Vector3(reach(new THREE.Vector3(-1, 0, 0), room0.min).x, room0.min.y, reach(new THREE.Vector3(0, 0, -1), room0.min).z),
    new THREE.Vector3(reach(new THREE.Vector3(1, 0, 0), room0.max).x, reach(new THREE.Vector3(0, 1, 0), room0.max).y, reach(new THREE.Vector3(0, 0, 1), room0.max).z),
  );
  room.max.y = Math.min(room.max.y, slot.point.y + N.maxAboveSlot);
  room.min.x += N.wallMargin;
  room.min.z += N.wallMargin;
  room.max.addScalar(-N.wallMargin);
  room.min.y += 0.05; // the floor itself is a landing surface (found by the rays)
  const radius = N.size * 0.5;
  const SEG = N.segments;
  const GRID = SEG + 1;

  // ---- The sheet: geometry, drape heights (a float texture: one row per napkin), material ----
  const geo = new THREE.PlaneGeometry(N.size, N.size, SEG, SEG);
  const aNap = new THREE.InstancedBufferAttribute(new Float32Array(N.maxActive * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const aRest = new THREE.InstancedBufferAttribute(new Float32Array(N.maxActive * 2), 2).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("aNap", aNap); // seed, flutter (× half size), opacity, own time
  geo.setAttribute("aRest", aRest); // drape blend (0 flying … 1 resting), drape row
  const drapeData = new Float32Array(GRID * GRID * N.maxActive);
  const drapeTex = new THREE.DataTexture(drapeData, GRID * GRID, N.maxActive, THREE.RedFormat, THREE.FloatType);
  drapeTex.minFilter = drapeTex.magFilter = THREE.NearestFilter;
  drapeTex.needsUpdate = true;
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
    uDrape: { value: drapeTex },
    uSeg: { value: SEG },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      `attribute vec4 aNap;
      attribute vec2 aRest;
      uniform float uHalf;
      uniform float uFreq;
      uniform float uSpeed;
      uniform float uFold;
      uniform sampler2D uDrape;
      uniform float uSeg;
      varying float vNapAlpha;
      // Flying: the sheet's lift (along its normal) at local (x, y): ripples, edges waving more, a slow fold.
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
      // Resting: how far the sheet hangs below its plane at grid point (i, j) (from the drape texture).
      float napDrape(float i, float j) {
        i = clamp(i, 0.0, uSeg);
        j = clamp(j, 0.0, uSeg);
        return texelFetch(uDrape, ivec2(int(j * (uSeg + 1.0) + i), int(aRest.y)), 0).r;
      }
      ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <beginnormal_vertex>",
        `float e = uHalf * 0.02;
        float hC = napLift(position.xy);
        float dx = (napLift(position.xy + vec2(e, 0.0)) - hC) / e;
        float dy = (napLift(position.xy + vec2(0.0, e)) - hC) / e;
        float gi = floor((position.x / (2.0 * uHalf) + 0.5) * uSeg + 0.5);
        float gj = floor((position.y / (2.0 * uHalf) + 0.5) * uSeg + 0.5);
        float dC = napDrape(gi, gj);
        float cell = 2.0 * uHalf / uSeg;
        float ddx = -(napDrape(gi + 1.0, gj) - napDrape(gi - 1.0, gj)) / (2.0 * cell);
        float ddy = -(napDrape(gi, gj + 1.0) - napDrape(gi, gj - 1.0)) / (2.0 * cell);
        float rb = aRest.x;
        float h = mix(hC, -dC, rb);
        vec3 objectNormal = normalize(vec3(-mix(dx, ddx, rb), -mix(dy, ddy, rb), 1.0));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3(position.xy, position.z + h);
        vNapAlpha = aNap.z;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "varying float vNapAlpha;\nvoid main() {")
      .replace("#include <alphamap_fragment>", "#include <alphamap_fragment>\ndiffuseColor.a *= vNapAlpha;");
  };
  mat.customProgramCacheKey = () => "kitchenNapkin2";
  const mesh = new THREE.InstancedMesh(geo, mat, N.maxActive);
  mesh.name = "kitchenNapkins";
  mesh.count = 0;
  mesh.frustumCulled = false; // they roam the whole room
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 4;
  scene.add(mesh);

  // ---- The pool ----
  // state: "off" | "exit" | "fly" | "settle" | "rest"
  const pool = [];
  for (let i = 0; i < N.maxActive; i++) {
    pool.push({
      row: i,
      state: "off",
      age: 0,
      flyAge: 0,
      seed: 0,
      flutter: 0,
      lift: 0,
      p0: new THREE.Vector3(),
      p1: new THREE.Vector3(),
      p2: new THREE.Vector3(),
      p3: new THREE.Vector3(),
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      yaw: 0,
      target: new THREE.Vector3(),
      targetIn: 0,
      edgeTime: 0,
      noLandFor: 0,
      // settling
      fromPos: new THREE.Vector3(),
      fromQuat: new THREE.Quaternion(),
      restPos: new THREE.Vector3(),
      restQuat: new THREE.Quaternion(),
      settleT: 0,
      restedAt: 0,
      fade: 1, // 1 = visible; fading out when < 1 and `fading`
      fading: false,
      alpha: 0,
    });
  }
  const side = new THREE.Vector3(-slot.out.z, 0, slot.out.x);
  let timer = 0.8; // the first batch shortly after the level is up
  const pending = []; // { at } (seconds until the napkin starts)
  let clock = 0;

  function pickTarget(p) {
    // A random point in the room's air (well inside it), toward which the breeze drifts for a while.
    const m = N.wallSoft;
    p.target.set(
      room.min.x + m + Math.random() * Math.max(0, room.max.x - room.min.x - 2 * m),
      room.min.y + N.wanderMinHeight + Math.random() * Math.max(0, room.max.y - room.min.y - N.wanderMinHeight - m),
      room.min.z + m + Math.random() * Math.max(0, room.max.z - room.min.z - 2 * m),
    );
    p.targetIn = N.wanderTimeMin + Math.random() * (N.wanderTimeMax - N.wanderTimeMin);
  }

  function launch() {
    const p = pool.find((q) => q.state === "off");
    if (!p) return; // pool full: this one is skipped
    p.state = "exit";
    p.age = 0;
    p.flyAge = 0;
    p.seed = Math.random();
    p.flutter = N.flutter * (0.7 + 0.6 * Math.random());
    p.lift = (Math.random() * 2 - 1) * N.lift;
    p.edgeTime = 0;
    p.noLandFor = 0;
    p.fade = 1;
    p.fading = false;
    const sideOff = (Math.random() * 2 - 1) * N.arcSide;
    const slotOff = (Math.random() * 2 - 1) * slot.width * 0.2;
    const s = 0.8 + 0.4 * Math.random();
    // Start hanging from the ceiling's middle (the sheet's centre a little below it), then down, out, and up.
    p.p0.copy(slot.point).addScaledVector(side, slotOff).add(new THREE.Vector3(0, -radius * 0.35, 0));
    p.p1.copy(p.p0).add(new THREE.Vector3(0, -N.arcDrop * s, 0)).addScaledVector(slot.out, N.arcOut * 0.35 * s);
    p.p2.copy(p.p0).add(new THREE.Vector3(0, -N.arcDrop * 0.6 * s, 0)).addScaledVector(slot.out, N.arcOut * s).addScaledVector(side, sideOff * 0.5);
    p.p3.copy(p.p0).add(new THREE.Vector3(0, N.arcRise * s, 0)).addScaledVector(slot.out, N.arcOut * 1.5 * s).addScaledVector(side, sideOff);
    p.pos.copy(p.p0);
    p.vel.set(0, 0, 0);
    p.yaw = Math.atan2(slot.out.x, slot.out.z) + (Math.random() * 2 - 1) * 0.4;
    pickTarget(p);
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
  const _bd = new THREE.Vector3();
  const bezD = (p, s, out) => {
    const u = 1 - s;
    return out
      .subVectors(p.p1, p.p0).multiplyScalar(3 * u * u)
      .addScaledVector(_bd.subVectors(p.p2, p.p1), 6 * u * s)
      .addScaledVector(_bd.subVectors(p.p3, p.p2), 3 * s * s);
  };

  const _want = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _e = new THREE.Euler();
  const _one = new THREE.Vector3(1, 1, 1);
  const _down = new THREE.Vector3(0, -1, 0);
  const _o = new THREE.Vector3();
  const _v = new THREE.Vector3();

  /** The nearest hit of a ray against the kitchen's meshes (with a world-space face normal), or null. */
  function castRay(origin, dir, far) {
    ray.set(origin, dir);
    ray.near = 0;
    ray.far = far;
    const hits = ray.intersectObjects(solids, false);
    if (!hits.length) return null;
    const h = hits[0];
    if (h.face) {
      _n.copy(h.face.normal).transformDirection(h.object.matrixWorld);
      if (_n.dot(dir) > 0) _n.negate(); // facing the ray (double-sided surfaces)
    } else {
      _n.copy(dir).negate();
    }
    return { point: h.point, distance: h.distance, normal: _n };
  }

  /**
   * Lands napkin p: the resting pose (flat, its yaw kept) and its drape. One ray straight down per sheet vertex
   * gives the surface under it; the supports are spread one cell (so the sheet never cuts a ledge's edge between
   * two vertices) and limited in slope (a soft drape); the sheet's plane sits at the highest support, and each
   * vertex hangs down to its support, at most `drape` × the size.
   */
  function land(p, surfaceY) {
    const prevRest = p.restQuat.clone();
    p.restQuat.setFromEuler(_e.set(-Math.PI / 2, p.yaw, 0, "YXZ"));
    const top = surfaceY + N.landClear; // rays start this high (above the sheet), straight down
    const maxHang = N.drape * N.size;
    const sup = new Float32Array(GRID * GRID);
    const cell = N.size / SEG;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        // Local (x, y) → world (resting pose at the landing point).
        _v.set((i / SEG - 0.5) * N.size, (j / SEG - 0.5) * N.size, 0).applyQuaternion(p.restQuat);
        _o.set(p.pos.x + _v.x, top, p.pos.z + _v.z);
        const hit = castRay(_o, _down, top - room.min.y + 0.5);
        if (hit && hit.point.y > surfaceY + 0.3) {
          // Something rises through where the sheet would lie (or hangs just above it): not here.
          p.restQuat.copy(prevRest);
          p.noLandFor = 0.6;
          return false;
        }
        sup[j * GRID + i] = hit ? hit.point.y : -Infinity;
      }
    }
    // Real support only: enough of the sheet must find the surface it touched (from above) at that height;
    // else (it touched something seen only from inside / below) it flies on and tries again a little later.
    let held = 0;
    for (const y of sup) if (y > surfaceY - 0.08 && y < surfaceY + 0.3) held++;
    if (held < sup.length * N.landSupport) {
      p.restQuat.copy(prevRest);
      p.noLandFor = 0.6;
      return false;
    }
    // Spread each support one cell around (a ledge holds the sheet up to the next vertex past it).
    const spread = new Float32Array(GRID * GRID);
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        let m = -Infinity;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii > SEG || jj > SEG) continue;
            m = Math.max(m, sup[jj * GRID + ii]);
          }
        }
        spread[j * GRID + i] = m;
      }
    }
    let planeY = -Infinity;
    for (const v of spread) planeY = Math.max(planeY, v);
    if (!Number.isFinite(planeY)) planeY = surfaceY;
    // Soft drape: no vertex lower than its neighbours by more than drapeSlope × a cell (a few passes).
    const h = new Float32Array(GRID * GRID);
    for (let k = 0; k < h.length; k++) h[k] = Math.max(spread[k], planeY - maxHang);
    const step = N.drapeSlope * cell;
    for (let pass = 0; pass < 6; pass++) {
      for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
          const k = j * GRID + i;
          let m = h[k];
          if (i > 0) m = Math.max(m, h[k - 1] - step);
          if (i < SEG) m = Math.max(m, h[k + 1] - step);
          if (j > 0) m = Math.max(m, h[k - GRID] - step);
          if (j < SEG) m = Math.max(m, h[k + GRID] - step);
          h[k] = m;
        }
      }
    }
    const lift = N.restLift * (1 + p.seed); // a hair above the surface (and above another napkin there)
    const row = p.row * GRID * GRID;
    for (let k = 0; k < h.length; k++) drapeData[row + k] = planeY - h[k]; // how far below the plane
    drapeTex.needsUpdate = true;
    p.restPos.set(p.pos.x, planeY + lift, p.pos.z);
    p.fromPos.copy(p.pos);
    p.fromQuat.copy(p.quat);
    p.settleT = 0;
    p.state = "settle";
    p.vel.set(0, 0, 0);
    // Too many resting: the oldest resting one fades away.
    const resting = pool.filter((q) => (q.state === "rest" || q.state === "settle") && !q.fading);
    if (resting.length > N.maxResting) {
      let oldest = null;
      for (const q of resting) if (q !== p && (!oldest || q.restedAt < oldest.restedAt)) oldest = q;
      if (oldest) oldest.fading = true;
    }
    p.restedAt = clock;
    return true;
  }

  /**
   * Flying: rays against the kitchen's meshes. Ahead (along its velocity): steer away from what it is heading into,
   * and never move through it. Below: a surface within reach, coming down onto it, is where it lands.
   */
  function collide(p, dt) {
    const sp = p.vel.length();
    if (sp > 1e-4) {
      _dir.copy(p.vel).multiplyScalar(1 / sp);
      const look = sp * N.avoidLookAhead + radius * 0.6;
      const hit = castRay(p.pos, _dir, look);
      if (hit && !(hit.normal.y > N.landNormal && p.vel.y < 0)) {
        // Steer away (more the closer it is), and no motion into it once close.
        const near = 1 - hit.distance / look;
        p.vel.addScaledVector(hit.normal, N.floatSpeed * N.avoidSteer * near * dt);
        if (hit.distance < radius * 0.6 + sp * dt) {
          const into = p.vel.dot(hit.normal);
          if (into < 0) p.vel.addScaledVector(hit.normal, -into);
        }
      }
    }
    if (p.noLandFor > 0) p.noLandFor -= dt;
    else if (p.vel.y <= 0.05) {
      const reachDown = radius * 0.55 + Math.max(0, -p.vel.y) * dt + 0.05;
      const hit = castRay(p.pos, _down, reachDown);
      if (hit && hit.normal.y > N.landNormal && land(p, hit.point.y)) return true;
    }
    return false;
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
      if (p.state === "off") continue;
      p.age += dt;
      const t = clock + p.seed * 100;
      let flutterAmp = p.flutter;
      if (p.state === "exit") {
        // Exit arc: s = ease-in (from rest, full speed at the end).
        const x = Math.min(1, p.age / N.arcTime);
        const sEase = x * x * (2 - x);
        const ds = (4 * x - 3 * x * x) / N.arcTime; // ds/dt
        bez(p, sEase, p.pos);
        bezD(p, sEase, p.vel).multiplyScalar(ds);
        const tilt = x * x * (3 - 2 * x);
        p.yaw += Math.sin(t * N.turnSpeed + p.seed * 9) * N.turnSpeed * dt;
        _e.set((-Math.PI / 2 + Math.sin(t * 0.43 + p.seed * 3) * N.tilt) * tilt, p.yaw, Math.sin(t * 0.31 + p.seed * 5) * N.tilt * 0.8 * tilt, "YXZ");
        p.quat.setFromEuler(_e);
        if (x >= 1) p.state = "fly";
      } else if (p.state === "fly") {
        p.flyAge += dt;
        // Wander: toward a random point of the room (a new one now and then), on a smooth breeze, slowly coming down.
        p.targetIn -= dt;
        if (p.targetIn <= 0 || p.pos.distanceTo(p.target) < 3) pickTarget(p);
        const f = N.driftScale, tt = t * N.driftTime;
        const px = p.pos.x * f, py = p.pos.y * f, pz = p.pos.z * f;
        // Across the room: toward its target (horizontally), turned by the breeze.
        _want.set(sn(px + tt, py, pz, p.seed * 13), 0, sn(pz + tt * 0.8, px, py, p.seed * 41));
        _dir.set(p.target.x - p.pos.x, 0, p.target.z - p.pos.z);
        if (_dir.lengthSq() > 1e-6) _dir.normalize();
        _want.multiplyScalar(N.driftAmount).addScaledVector(_dir, 1 - N.driftAmount * 0.6);
        if (_want.lengthSq() > 1e-6) _want.normalize();
        _want.multiplyScalar(N.floatSpeed * (0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.3 + p.seed * 7))));
        // Up and down: gentle swells of the breeze, the napkin's own lift, and the descent (grown in over descentRamp).
        _want.y = sn(py - tt * 0.7, pz, px, p.seed * 29) * N.verticalDrift + p.lift - N.descentRate * Math.min(1, p.flyAge / N.descentRamp);
        // Soft walls / ceiling (the floor is a landing surface).
        let nearEdge = false;
        for (const ax of ["x", "y", "z"]) {
          const lo = p.pos[ax] - room.min[ax], hi = room.max[ax] - p.pos[ax];
          if (ax !== "y" && lo < N.wallSoft) { _want[ax] += N.floatSpeed * (1 - Math.max(0, lo) / N.wallSoft) * 1.5; nearEdge = true; }
          if (hi < N.wallSoft) { _want[ax] -= N.floatSpeed * (1 - Math.max(0, hi) / N.wallSoft) * 1.5; nearEdge = true; }
        }
        p.vel.lerp(_want, 1 - Math.exp(-dt / N.floatResponse));
        const landed = collide(p, dt);
        if (!landed) {
          p.pos.addScaledVector(p.vel, dt);
          p.pos.clamp(room.min, room.max);
          if (p.pos.y <= room.min.y + 1e-3 && !(p.noLandFor > 0)) land(p, room.min.y - 0.05); // the floor (if no mesh was found under it)
          p.edgeTime = nearEdge ? p.edgeTime + dt : 0;
          if (p.flyAge > N.maxFlight) p.fading = true; // never found a place to land
          p.yaw += Math.sin(t * N.turnSpeed + p.seed * 9) * N.turnSpeed * dt;
          _e.set(-Math.PI / 2 + Math.sin(t * 0.43 + p.seed * 3) * N.tilt, p.yaw, Math.sin(t * 0.31 + p.seed * 5) * N.tilt * 0.8, "YXZ");
          p.quat.setFromEuler(_e);
        }
      }
      if (p.state === "settle") {
        // Settling: slows down onto the surface, flattens, the flutter dies away and the drape comes in.
        p.settleT = Math.min(1, p.settleT + dt / N.settleTime);
        const e = 1 - Math.pow(1 - p.settleT, 3); // ease-out
        p.pos.lerpVectors(p.fromPos, p.restPos, e);
        p.quat.slerpQuaternions(p.fromQuat, p.restQuat, e);
        flutterAmp = p.flutter * (1 - e) + N.restFlutter * e;
        if (p.settleT >= 1) p.state = "rest";
      } else if (p.state === "rest") {
        flutterAmp = N.restFlutter;
      }
      if (p.fading) p.fade -= dt / N.fadeOut;
      _m.compose(p.pos, p.quat, _one);
      mesh.setMatrixAt(k, _m);
      const alpha = Math.min(1, p.age / N.fadeIn) * Math.max(0, Math.min(1, p.fade));
      aNap.setXYZW(k, p.seed, flutterAmp, alpha, t);
      // This draw slot: its drape row, and how far the drape is in (0 flying … 1 resting).
      aRest.setY(k, p.row);
      aRest.setX(k, p.state === "rest" ? 1 : p.state === "settle" ? 1 - Math.pow(1 - p.settleT, 3) : 0);
      if (p.fade <= 0) {
        p.state = "off";
        continue;
      }
      k++;
    }
    mesh.count = k;
    mesh.visible = k > 0;
    mesh.instanceMatrix.needsUpdate = true;
    aNap.needsUpdate = true;
    aRest.needsUpdate = true;
  }

  return {
    update,
    slot,
    room,
    pool,
    solids,
    /** Each napkin's drape (how far each sheet vertex hangs below its resting plane; row = pool index), for checks. */
    drapeData,
    grid: GRID,
    get active() {
      return pool.filter((p) => p.state !== "off").length;
    },
    get resting() {
      return pool.filter((p) => p.state === "rest").length;
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
      tex.map.dispose();
      tex.bump.dispose();
      drapeTex.dispose();
    },
  };
}
