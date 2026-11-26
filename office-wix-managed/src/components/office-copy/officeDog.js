/**
 * The office dog: a life-size border collie lying on the floor (after a reference photo), built from simple
 * smooth shapes (no model file): black coat with the breed's white parts (blaze, muzzle, collar and chest,
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
  sheen: { amount: 0.9, roughness: 0.5, coat: 0x6a6a70, white: 0xffffff },
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
  const fur = (color, sheenColor) =>
    new THREE.MeshPhysicalMaterial({
      color,
      roughness: D.roughness,
      metalness: 0,
      sheen: D.sheen.amount,
      sheenRoughness: D.sheen.roughness,
      sheenColor: new THREE.Color(sheenColor),
    });
  const mats = {
    coat: fur(D.coat, D.sheen.coat),
    white: fur(D.white, D.sheen.white),
    nose: new THREE.MeshStandardMaterial({ color: D.nose, roughness: 0.35 }),
    eye: new THREE.MeshStandardMaterial({ color: D.eye, roughness: 0.12 }),
    tongue: new THREE.MeshStandardMaterial({ color: D.tongue, roughness: 0.45 }),
  };
  const sphere = new THREE.SphereGeometry(1, 28, 20);
  const geos = [sphere];
  const ell = (parent, mat, pos, r, rot) => {
    const m = new THREE.Mesh(sphere, mat);
    m.position.set(...pos);
    m.scale.set(...r);
    if (rot) m.rotation.set(...rot);
    parent.add(m);
    return m;
  };
  const capsule = (parent, mat, a, b, radius) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const len = A.distanceTo(B);
    const g = new THREE.CapsuleGeometry(radius, len, 6, 14);
    geos.push(g);
    const m = new THREE.Mesh(g, mat);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    parent.add(m);
    return m;
  };

  const dog = new THREE.Group();
  dog.name = "officeDog";

  // Body: lying on its belly (sphinx pose), hind legs folded at its sides.
  const body = new THREE.Group();
  dog.add(body);
  ell(body, mats.coat, [-0.02, 0.15, 0], [0.34, 0.145, 0.155]); // the barrel
  ell(body, mats.coat, [-0.24, 0.14, 0.1], [0.17, 0.125, 0.1]); // the haunches
  ell(body, mats.coat, [-0.24, 0.14, -0.1], [0.17, 0.125, 0.1]);
  ell(body, mats.coat, [0.2, 0.17, 0], [0.18, 0.17, 0.145]); // the chest
  ell(body, mats.white, [0.3, 0.16, 0], [0.11, 0.15, 0.1]); // white chest
  ell(body, mats.white, [0.12, 0.05, 0], [0.16, 0.05, 0.1]); // a little white under the belly
  ell(body, mats.coat, [0.3, 0.31, 0], [0.11, 0.14, 0.105], [0, 0, -0.5]); // the neck
  ell(body, mats.white, [0.34, 0.3, 0], [0.1, 0.13, 0.11], [0, 0, -0.5]); // the white collar (front)
  ell(body, mats.white, [0.3, 0.28, 0], [0.07, 0.11, 0.13], [0, 0, -0.5]); // (round the sides)

  // Front legs stretched forward, white below; paws.
  for (const z of [0.075, -0.075]) {
    capsule(body, mats.coat, [0.22, 0.1, z], [0.34, 0.05, z], 0.045);
    capsule(body, mats.white, [0.33, 0.045, z], [0.55, 0.035, z], 0.038);
    ell(body, mats.white, [0.58, 0.028, z], [0.055, 0.028, 0.038]);
  }
  // Hind legs: the folded lower legs along the floor beside the body, white paws to the front.
  for (const s of [1, -1]) {
    capsule(body, mats.coat, [-0.34, 0.06, 0.15 * s], [-0.14, 0.04, 0.17 * s], 0.042);
    capsule(body, mats.white, [-0.14, 0.035, 0.17 * s], [-0.04, 0.03, 0.175 * s], 0.034);
    ell(body, mats.white, [-0.02, 0.026, 0.175 * s], [0.05, 0.026, 0.035]);
  }

  // Head (on a pivot at the top of the neck): black skull and ears, white blaze and muzzle, an open mouth.
  const head = new THREE.Group();
  head.position.set(0.38, 0.4, 0);
  head.scale.setScalar(0.92);
  dog.add(head);
  ell(head, mats.coat, [0.04, 0.03, 0], [0.105, 0.09, 0.085]); // skull
  ell(head, mats.coat, [0.02, 0.0, 0.055], [0.07, 0.07, 0.04]); // cheeks
  ell(head, mats.coat, [0.02, 0.0, -0.055], [0.07, 0.07, 0.04]);
  ell(head, mats.white, [0.11, 0.065, 0], [0.075, 0.018, 0.014], [0, 0, -0.32]); // the blaze up the forehead
  ell(head, mats.white, [0.155, -0.015, 0], [0.085, 0.042, 0.045]); // muzzle
  ell(head, mats.coat, [0.13, 0.012, 0], [0.06, 0.03, 0.04]); // the muzzle's black top (the blaze runs down its middle)
  ell(head, mats.white, [0.15, 0.02, 0], [0.07, 0.018, 0.014]);
  ell(head, mats.nose, [0.235, 0.0, 0], [0.022, 0.018, 0.022]); // nose
  ell(head, mats.white, [0.14, -0.05, 0], [0.07, 0.018, 0.035]); // lower jaw
  ell(head, mats.tongue, [0.16, -0.04, 0], [0.05, 0.012, 0.024]); // tongue (panting)
  for (const z of [0.042, -0.042]) ell(head, mats.eye, [0.115, 0.04, z], [0.014, 0.013, 0.012]);
  // Ears: semi-erect, tips folded forward.
  for (const s of [1, -1]) {
    const ear = new THREE.Group();
    ear.position.set(-0.005, 0.085, 0.062 * s);
    ear.rotation.set(-0.55 * s, 0, 0.2); // leaning out to its side, a little back
    head.add(ear);
    const g = new THREE.ConeGeometry(0.034, 0.08, 12);
    geos.push(g);
    const base = new THREE.Mesh(g, mats.coat);
    base.scale.set(1, 1, 0.45);
    base.position.y = 0.04;
    ear.add(base);
    const tip = new THREE.Mesh(g, mats.coat);
    tip.scale.set(0.6, 0.5, 0.35);
    tip.position.set(0.02, 0.085, 0);
    tip.rotation.z = -1.1;
    ear.add(tip);
  }

  // Tail: a chain of fluffy segments from the rump, down to the floor and curling round; white tip.
  const tailBase = new THREE.Group();
  tailBase.position.set(-0.36, 0.17, 0);
  dog.add(tailBase);
  const segs = [];
  const N = 7;
  let parent = tailBase;
  for (let i = 0; i < N; i++) {
    const seg = new THREE.Group();
    const len = 0.06;
    seg.position.x = i ? -len : 0;
    seg.userData.restZ = i === 0 ? 1.05 : -0.2; // down off the rump, then back toward level along the floor
    seg.userData.restY = i === 0 ? 0 : 0.16; // curling round toward the body
    parent.add(seg);
    const r = 0.048 - i * 0.003;
    ell(seg, i >= N - 2 ? mats.white : mats.coat, [-len / 2, 0, 0], [len * 0.75, r, r * 1.15]);
    segs.push(seg);
    parent = seg;
  }

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
  return { object: dog, update, dispose };
}
