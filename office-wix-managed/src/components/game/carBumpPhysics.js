/**
 * Car-to-car "bumper car" pushing, shared by the meeting room arena and the
 * kitchen race (extracted from the meeting room scene, unchanged).
 *
 * Cars are oriented boxes on the XZ plane. A pair is tested with SAT; on overlap
 * an impulse is applied at the contact point (so off-centre hits also spin the
 * car), with restitution and friction. Each car's mass is direction-dependent:
 * the car being pushed resists being shoved along its length and gives way
 * sideways. Then the cars are separated fully, split by how easily each moves.
 *
 * A car's kinematics object (K) holds:
 *   x, z        box centre            hx, hz    half width / half length
 *   ux, uz      right axis            fx, fz    forward axis
 *   vx, vz, w   planar velocity and yaw rate (updated in place by the impulse)
 *   inertia     yaw inertia (see carBoxInertia)
 *   resAlong, resSide   directional resistance (set per contact)
 */

export const CAR_MASS = 1.8;
export const CAR_BUMP_RESTITUTION = 0.58;
export const CAR_BUMP_FRICTION = 0.12;
export const CAR_BUMP_SLOP = 0.0015;
/** Closing speed above which a hit restarts a sliding car's impact timer. */
export const CAR_BUMP_RESET_SPEED = 0.6;
/** How fast a driving car's collision push (sideways slide / spin) dies out, 1/s. */
export const CAR_BUMP_SLIDE_DECAY = 2.8;
export const CAR_BUMP_SPIN_DECAY = 3.2;
/** Largest yaw rate a hit may give a driving car (rad/s). */
export const CAR_BUMP_YAW_CAP = 1.4;
/**
 * Directional resistance of the car being pushed, as an effective-mass factor:
 * pushed along its own length (from behind / head-on) it resists hard, pushed
 * from the side it gives way easily. Angles in between blend smoothly (cos²).
 */
export const CAR_PUSH_RESIST_ALONG = 2.4;
export const CAR_PUSH_RESIST_SIDE = 0.65;

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return (1 - t) * a + t * b;
}

/** Yaw inertia of a car box with half extents (hx, hz). */
export function carBoxInertia(hx, hz) {
  const w2 = hx * 2;
  const l2 = hz * 2;
  return (CAR_MASS * (w2 * w2 + l2 * l2)) / 12;
}

/** Inverse effective mass of car K along direction (dx, dz), with directional resistance. */
export function carInvMassAlong(K, dx, dz) {
  const a = K.fx * dx + K.fz * dz;
  const l = K.ux * dx + K.uz * dz;
  return ((a * a) / K.resAlong + (l * l) / K.resSide) / CAR_MASS;
}

/** Velocity change of car K for planar impulse (jx, jz): anisotropic mass tensor. */
export function carApplyImpulse(K, jx, jz, sign) {
  const a = (K.fx * jx + K.fz * jz) / K.resAlong;
  const l = (K.ux * jx + K.uz * jz) / K.resSide;
  K.vx += (sign * (K.fx * a + K.ux * l)) / CAR_MASS;
  K.vz += (sign * (K.fz * a + K.uz * l)) / CAR_MASS;
}

function obbRadius(K, nx, nz) {
  return (
    K.hx * Math.abs(K.ux * nx + K.uz * nz) + K.hz * Math.abs(K.fx * nx + K.fz * nz)
  );
}

function addCornersInside(P, Q, acc) {
  for (let su = -1; su <= 1; su += 2) {
    for (let sf = -1; sf <= 1; sf += 2) {
      const cx = P.x + P.ux * P.hx * su + P.fx * P.hz * sf;
      const cz = P.z + P.uz * P.hx * su + P.fz * P.hz * sf;
      const rx = cx - Q.x;
      const rz = cz - Q.z;
      const lu = rx * Q.ux + rz * Q.uz;
      const lf = rx * Q.fx + rz * Q.fz;
      if (Math.abs(lu) <= Q.hx + 1e-4 && Math.abs(lf) <= Q.hz + 1e-4) {
        acc.x += cx;
        acc.z += cz;
        acc.n += 1;
      }
    }
  }
}

const _bumpAxes = new Float64Array(8);
const _bumpAcc = { x: 0, z: 0, n: 0 };

/** SAT overlap of two car boxes; normal points from A to B. Fills nx, nz, depth, px, pz. */
export function carBoxOverlap(A, B, res) {
  const dx = B.x - A.x;
  const dz = B.z - A.z;
  let best = Infinity;
  let bnx = 0;
  let bnz = 0;
  const axes = _bumpAxes;
  axes[0] = A.ux;
  axes[1] = A.uz;
  axes[2] = A.fx;
  axes[3] = A.fz;
  axes[4] = B.ux;
  axes[5] = B.uz;
  axes[6] = B.fx;
  axes[7] = B.fz;
  for (let i = 0; i < 8; i += 2) {
    const nx = axes[i];
    const nz = axes[i + 1];
    const d = dx * nx + dz * nz;
    const o = obbRadius(A, nx, nz) + obbRadius(B, nx, nz) - Math.abs(d);
    if (o <= 0) return false;
    if (o < best) {
      best = o;
      const sg = d < 0 ? -1 : 1;
      bnx = nx * sg;
      bnz = nz * sg;
    }
  }
  res.nx = bnx;
  res.nz = bnz;
  res.depth = best;
  const acc = _bumpAcc;
  acc.x = 0;
  acc.z = 0;
  acc.n = 0;
  addCornersInside(B, A, acc);
  addCornersInside(A, B, acc);
  if (acc.n > 0) {
    res.px = acc.x / acc.n;
    res.pz = acc.z / acc.n;
  } else {
    res.px = (A.x + B.x) * 0.5;
    res.pz = (A.z + B.z) * 0.5;
  }
  return true;
}

/**
 * Directional resistance for the car being pushed. The striker is whichever car
 * closes faster along the contact normal; the blend between "A pushes B" and
 * "B pushes A" is smooth so near-equal head-on hits stay symmetric.
 */
export function setPushResistance(A, B, nx, nz) {
  const sA = A.vx * nx + A.vz * nz;
  const sB = -(B.vx * nx + B.vz * nz);
  const diff = (sA - sB) / (Math.abs(sA) + Math.abs(sB) + 0.05);
  const bPushed = smoothstep(-0.35, 0.35, diff);
  const weights = [
    [B, bPushed],
    [A, 1 - bPushed],
  ];
  for (let i = 0; i < 2; i++) {
    const K = weights[i][0];
    const w = weights[i][1];
    K.resAlong = lerp(1, CAR_PUSH_RESIST_ALONG, w);
    K.resSide = lerp(1, CAR_PUSH_RESIST_SIDE, w);
  }
}

/**
 * Bumper-car contact between cars A and B (kinematics objects, see top).
 * On overlap: applies the impulse to A / B (vx, vz, w) and fills `res` with
 * nx, nz (A → B), impulsed, hitSpeed and the separation pushA / pushB along the
 * normal (A moves by -n * pushA, B by +n * pushB). Returns false if no overlap.
 */
export function solveCarBump(A, B, res) {
  if (!carBoxOverlap(A, B, res)) return false;
  const nx = res.nx;
  const nz = res.nz;
  setPushResistance(A, B, nx, nz);
  const rAx = res.px - A.x;
  const rAz = res.pz - A.z;
  const rBx = res.px - B.x;
  const rBz = res.pz - B.z;
  const vAx = A.vx + A.w * rAz;
  const vAz = A.vz - A.w * rAx;
  const vBx = B.vx + B.w * rBz;
  const vBz = B.vz - B.w * rBx;
  const rvx = vBx - vAx;
  const rvz = vBz - vAz;
  const vn = rvx * nx + rvz * nz;
  const wAn = carInvMassAlong(A, nx, nz);
  const wBn = carInvMassAlong(B, nx, nz);
  let impulsed = false;
  if (vn < 0) {
    const cAn = rAz * nx - rAx * nz;
    const cBn = rBz * nx - rBx * nz;
    const denom = wAn + wBn + (cAn * cAn) / A.inertia + (cBn * cBn) / B.inertia;
    const j = (-(1 + CAR_BUMP_RESTITUTION) * vn) / denom;
    let jx = nx * j;
    let jz = nz * j;
    let tx = rvx - vn * nx;
    let tz = rvz - vn * nz;
    const tl = Math.hypot(tx, tz);
    if (tl > 1e-5) {
      tx /= tl;
      tz /= tl;
      const vt = rvx * tx + rvz * tz;
      const cAt = rAz * tx - rAx * tz;
      const cBt = rBz * tx - rBx * tz;
      const dt =
        carInvMassAlong(A, tx, tz) +
        carInvMassAlong(B, tx, tz) +
        (cAt * cAt) / A.inertia +
        (cBt * cBt) / B.inertia;
      const jt = clamp(-vt / dt, -CAR_BUMP_FRICTION * j, CAR_BUMP_FRICTION * j);
      jx += tx * jt;
      jz += tz * jt;
    }
    carApplyImpulse(A, jx, jz, -1);
    A.w -= (rAz * jx - rAx * jz) / A.inertia;
    carApplyImpulse(B, jx, jz, 1);
    B.w += (rBz * jx - rBx * jz) / B.inertia;
    impulsed = true;
  }
  // Separate fully, split by how easily each car moves along the normal.
  const depth = Math.max(0, res.depth - CAR_BUMP_SLOP);
  const shareA = wAn / Math.max(1e-6, wAn + wBn);
  res.pushA = depth * shareA;
  res.pushB = depth - res.pushA;
  res.hitSpeed = Math.max(0, -vn);
  res.impulsed = impulsed;
  return true;
}
