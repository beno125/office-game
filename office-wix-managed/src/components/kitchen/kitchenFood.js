/**
 * Food on the kitchen table's plates: fruit (apples, pears, bananas) on
 * fruitPlate3, vegetables (tomatoes, cucumbers, carrots) on fruitPlate2 and
 * wrapped snacks (generic invented wrappers, no brands) on fruitPlate1.
 *
 * Looks: smooth lathe / sweep models (welded normals, no flat shading) with
 * small canvas-generated colour maps (blush, speckles, stripes, spots), shared
 * geometries and materials, drawn as one InstancedMesh per part (per-instance
 * colour tone; size and rotation vary per item).
 *
 * Arrangement: while the level loads, each plate's items are dropped into the
 * plate in small batches in a separate, off-screen physics world (the plate's
 * real tray collider, see addTrayShapes) and simulated until they rest; the
 * settled poses are stored in the plate's frame and reused on "Race again".
 *
 * Each item is two objects: an invisible physics proxy of one simple shape
 * (see KITCHEN_FOOD.proxy; the pear two spheres) and the detailed model,
 * which copies the proxy's position and rotation every frame (fixed offset:
 * the model is built around the proxy's centre of mass). The proxies use the
 * cup pyramid's physics (shared constants: body type, friction, restitution,
 * contact stiffness, linear damping, wake-up), plus what heaps need (see
 * KITCHEN_FOOD.heap). Every proxy is a dynamic body from the start, asleep at
 * its settled pose; a car (directly or through its plate) or another moving
 * object wakes it; it rests again wherever it lands. Nothing moves it back
 * to a plate except "Race again".
 *
 * Protections each frame (none moves food to a plate): never below the table
 * or the kitchen floor, kept on the table, pushed out of the cars' bumpers
 * (and slowing the cars slightly), speeds capped, invalid (NaN) states
 * recovered in place, lifted out of any floor overlap when falling asleep.
 */
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Tuning (sizes are shares of the size unit; speeds in world units / s, gravity is 480). */
export const KITCHEN_FOOD = {
  plates: { fruitPlate3: "fruit", fruitPlate2: "veg", fruitPlate1: "snacks" },
  /**
   * Items per plate type and kind (was 6 fruit / 6 veg / 5 snacks). Sized to
   * each plate (all the food shares one size): fruit on fruitPlate3 (radius
   * ~3), vegetables on fruitPlate2 (~2.5), snacks on the small fruitPlate1 (~1.6).
   */
  counts: {
    fruit: { apple: 12, pear: 9, banana: 7 }, // bananas 9 → 7 when they grew (bananaScale)
    veg: { tomato: 16, cucumber: 6, carrot: 8 },
    snacks: { bar: 7, pack: 9 },
  },
  /** One size unit for all the food: the smallest plate's radius × this (was 1.15). */
  sizeScale: 0.95,
  /** Bananas relative to the rest (was 1): real banana size next to the apples and pears; collider and mass scale with it. */
  bananaScale: 1.4,
  /** Fruit and vegetables relative to the snacks (was 1, a little small): collider and mass scale with it. */
  produceScale: 1.1,
  /** Per-item variation: size (± share), colour tone (± brightness) and warmth (± red / blue shift). */
  variation: { size: 0.09, tone: 0.09, warmth: 0.035 },
  /** Fixed seed: the plates look the same on every load. */
  seed: 20251119,
  /**
   * Geometry detail (segments; smooth normals keep the curves round). Sized
   * for the gameplay camera: ~52k triangles for all the food (the first
   * version's ~103k cost ~5 fps).
   */
  detail: {
    apple: { around: 20, profile: 18 },
    pear: { around: 18, profile: 20 },
    banana: { around: 14, length: 28 },
    tomato: { around: 18, profile: 14 },
    cucumber: { around: 12, length: 20 },
    carrot: { around: 12, length: 22 },
    wrapper: { around: 16, length: 18 },
    carrotLeaflets: 4, // per sprig (6 sprigs per carrot)
  },
  mass: { apple: 0.6, banana: 0.5, pear: 0.6, tomato: 0.4, cucumber: 0.6, carrot: 0.3, bar: 0.25, pack: 0.2 },
  /**
   * Physics proxies: one simple shape per item type (scaled per item), the
   * only thing the physics simulates; the detailed model follows it. Apple
   * and tomato: a sphere (rolls); pear: two spheres, heavy at the bottom
   * (wobbly roll, settles on its side); banana: one narrow box over its curve
   * (slides, tips, doesn't roll); cucumber: a cylinder (rolls straight);
   * carrot: a tapered cylinder (rolls in an arc); snacks: a flat box (slide,
   * flip). Shares of the item's own size.
   */
  proxy: {
    banana: { halfLength: 0.42, halfHeight: 0.8, depthPad: 0.7 },
    cucumber: { radius: 0.97, length: 0.92 },
    carrot: { thickEnd: 0.9, thinEnd: 0.4, length: 0.88 }, // thinEnd was 0.3 (the tip is blunter now)
    cylinderSegments: 12, // as the cups' cylinders
  },
  /**
   * On top of the cup pyramid's settings, only what heaps need (measured: with
   * the cups' values alone, 43 of 74 items were still awake 30 s after a set
   * of hits, spinning up to 22 rad / s, and the plates never slept). A hit
   * cup pyramid ends as single cups on the table; the food rests in heaps
   * inside dynamic plates, which at gravity 480 keep trembling:
   * - sleepSpeed (cups: 0.6): cannon counts the spin (rad / s) as speed, and a
   *   resting heap still trembles at up to ~2 rad / s; a rolling item spins
   *   much faster, so it rolls on until slow.
   * - rollingAngularDamping (cups: 0.5), for the items that roll (spheres,
   *   cylinders): cannon has no rolling resistance, a heap of them in a bowl
   *   kept rolling about.
   * - restInPlace: an item that stayed within `drift` of one spot for `time`
   *   seconds goes to sleep right there (never moved), with the slow food it
   *   touches (slower than clusterSpeed), so a heap sleeps together.
   * - plateSleep (props: 0.6): a plate under a heap trembles at ~0.25-0.5;
   *   below this it rests, so its food lies on a still plate (a car's push and
   *   fast food still wake it).
   */
  heap: {
    sleepSpeed: 2.2,
    rollingAngularDamping: 0.8,
    restInPlace: { drift: 0.25, time: 0.4, clusterSpeed: 1.5 }, // time was 0.6
  },
  plateSleep: { speed: 1.5, time: 0.3 },
  /**
   * Settling a pile in a plate after a hit (measured, 4 s after a hit at 9:
   * items 0.13-0.15 into each other and 0.14-0.24 into the plate (90th
   * percentile, up to 0.42), 19-60 "pops" per plate (a resting item thrown up
   * at over 1.5 units / s), 95 % of them while overlapping: the solver pushing
   * overlaps apart; plus items rocking in place).
   * - contact (food against food and against the plates; the table keeps the
   *   cups' values): more grip (cups: 0.25), no bounce, softer correction
   *   (cups: stiffness 1e8, relaxation 2), so overlaps are resolved gently.
   * - calm: inside a plate, linear / angular damping ramp up by this much over
   *   `rampTime` seconds after the item wakes (back to normal when it sleeps;
   *   never 1 or more: cannon damps by (1 - d)^dt).
   * - iterations / substeps: the solver's iterations, and physics steps per
   *   1/60 s, while a pile is settling (the scene's own values otherwise).
   * - plateHold: a plate moving slower than this for `time` seconds is held
   *   static again (the pile kept it from ever sleeping).
   */
  pile: {
    contact: { friction: 0.6, restitution: 0, stiffness: 3e7, relaxation: 3 },
    calm: { extraLinear: 0.4, extraAngular: 0.5, rampTime: 0.6, maxDamping: 0.9 },
    iterations: 30,
    substeps: 2, // physics steps per 1/60 s while a pile settles (half the press of gravity 480 per step)
    plateHold: { speed: 0.6, time: 0.25 },
  },
  /** Drawing: an almost resting item (slower than `speed`) is not redrawn for moves under `move` (no visible solver micro-jitter). */
  visualJitter: { move: 0.001, turn: 0.002, speed: 0.3 },
  /** Lifted out of a plate's floor / the table when going to sleep if this deep or more. */
  sleepUnsinkTolerance: 0.01,
  /** Off-screen settling while the level loads. */
  settle: {
    batchSize: 4, // items dropped together
    dropGap: 0.06, // gap above the pile (or the plate floor) when dropped
    /**
     * Gentler gravity than the game's 480 while settling: the resting poses
     * depend on the shapes and friction, not on gravity's strength, and at 480
     * (1/60 s steps) a pile pushes items deep into each other and through the
     * plate's thin floor before the solver catches up.
     */
    gravity: 120,
    batchSteps: 40, // 1/60 s steps between batches
    finalSteps: 600, // most steps after the last batch (stops early once all sleep; was 360, which cut piles off mid-motion)
    iterations: 20,
    sleep: { speed: 0.3, time: 0.3 }, // was 0.08 / 0.5: most piles were still moving at the step cap
    friction: 0.7,
    restitution: 0,
    linearDamping: 0.5,
    angularDamping: 0.75,
    centreBias: 2.6, // > 1 piles toward the middle (radius = max × random^bias)
    rimShare: 0.14, // share of items dropped against the rim
    frameBudgetMs: 6, // settling time per frame during the loader
    depenetrateSteps: 24, // then without gravity, so overlapping items push apart before the poses are stored
    depenetrateDamping: 0.5, // speed kept per step meanwhile (they only separate, never drift)
  },
  /** Speed caps (no tunnelling in a 1/60 s step). */
  scatter: {
    maxSpeed: 26, // horizontal
    maxUp: 22, // vertical
  },
  carDrag: 0.6, // pushing food slows the car: × (food mass / car mass), speed / s
  carPushRestitution: 1.0, // food speed after a shove, × the car's speed toward it (was 1.08)
  /**
   * World units below a surface before an item is lifted back (was 0.04):
   * above a resting contact's normal overlap at gravity 480 (~0.03-0.04),
   * or the lift keeps nudging resting food and it never sleeps.
   */
  sinkTolerance: 0.08,
  /**
   * Last-resort checks: an item with an invalid (NaN / huge) position or
   * speed goes back to its last valid spot; one under the kitchen floor (it
   * fell 14 units at the capped 28 units / s, ~0.47 per step, and tunnelled
   * into the 0.5-thick floor box, which pushed it out underneath: the items
   * that "disappeared") goes back onto the floor.
   */
  recover: { maxCoord: 500, maxSpeed: 200, floorTolerance: 0.08 },
  /**
   * The table's edge keeps the food on the table (the plates stand ~2 units
   * from its front edge: a hit knocked food off, 14 units down to the kitchen
   * floor and out of the race camera's view, so it seemed to vanish). An item
   * reaching the edge (its centre `margin` inside) stops there, keeping `bounce`
   * of its speed back toward the table.
   */
  tableEdge: { margin: 0.25, bounce: 0.15 },
  /** The table's safety net lifts an item at most this much per frame (gently, no velocity added). */
  netStep: 0.03,
  /** The plates (dynamic): never launched by a hit (upward speed, spin and horizontal speed capped). */
  plateClamp: { up: 0.5, spin: 2, speed: 18 },
  /** Plate tray collider: walls at least this thick (outward from the inner face). */
  trayMinWall: 0.12,
  /** The walls' lowest corner stays this far above the plate's base (they never touch the table). */
  trayWallBaseGap: 0.01,
  /**
   * The trays' floors are thin (0.04-0.08), and cannon pushes a body out of
   * a thin convex through its nearer face: food resting with gravity 480's
   * normal overlap (~0.03-0.04) got pushed out under the plate, and food
   * landing at up to ~28 units / s moves ~0.47 in one 1/60 s step. The food
   * meets a floor this thick instead (more than twice that; below the plate's
   * floor, only the food collides with it, not the table).
   */
  trayFoodFloor: 1.2,
  colors: {
    appleRed: ["#8e1418", "#c4261f", "#e0442c"], // dark → bright skin
    appleRedBlush: "#e8c04a",
    appleGreen: ["#8fb33a", "#b4cc4c", "#d3dc6a"],
    appleGreenBlush: "#d4683a",
    appleSpeckle: "#f6e2a8",
    stem: 0x5b3a1e,
    leaf: 0x4f8f2f,
    pear: ["#a9b23a", "#c8c552", "#ddd27a"],
    pearRusset: "#9a7334",
    pearBlush: "#d9763c",
    pearSpeckle: "#6b5a2a",
    banana: ["#e2b92c", "#f3d43e", "#f7e27a"],
    bananaGreen: "#a3b83c",
    bananaStem: "#5c5a26",
    bananaTip: "#2d2416",
    bananaSpot: "#6a461c",
    tomato: ["#b8231a", "#d8361f", "#ee5a2c"],
    calyx: 0x4f9a35,
    cucumber: ["#1f4a1f", "#2e6a2a", "#5c9440"],
    cucumberWart: "#a8cc82",
    carrot: ["#d9661a", "#f08226", "#f7a04a"],
    carrotRidge: "#b9530f",
    carrotCrown: "#8f8a2e",
    carrotLeaf: 0x3f8f2c,
  },
  /** Material response (no glow: no emissive; see the bloom guard in setup). */
  surface: {
    apple: { roughness: 0.4, clearcoat: 0.55, clearcoatRoughness: 0.25 },
    tomato: { roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.18 },
    pear: { roughness: 0.52 },
    cucumber: { roughness: 0.5, bumpScale: 1.2 },
    banana: { roughness: 0.78 },
    carrot: { roughness: 0.82, bumpScale: 1.5 },
    wrapper: { roughness: 0.3, metalness: 0.28 },
    envMapIntensity: 0.6,
  },
  /** Wrapper designs: [base, band, accent, seal] (invented, no text or logos). */
  snackPalettes: [
    ["#6b2fd6", "#ffcf3d", "#ff5d8f", "#c9c3d8"],
    ["#d8312f", "#ffe7a8", "#3a2010", "#e0d6c8"],
    ["#1f9d74", "#f5f0d8", "#ffb347", "#cfe2da"],
    ["#1f63e0", "#9fe3ff", "#ffffff", "#c8d6ee"],
    ["#ff8a1f", "#3b1f0f", "#ffe066", "#eadcc8"],
  ],
};

/**
 * Parse a plate's physics mesh (an open tray: base, floor, walls, rim) into
 * its profile, in the body's frame. With the visible plate, the walls are
 * moved in (wallInset) to its innermost point at the rim: the visible plate's
 * wavy wall reaches further in than the physics tray's straight sides, and
 * food resting against them would cut into it.
 */
export function trayFromMesh(THREE, mesh, center, visual = null) {
  mesh.updateMatrixWorld(true);
  const pos = mesh.geometry.getAttribute("position");
  const v = new THREE.Vector3();
  const levels = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).sub(center);
    let lv = levels.find((l) => Math.abs(l.y - v.y) < 0.01);
    if (!lv) levels.push((lv = { y: v.y, rs: [], angs: [] }));
    lv.rs.push(Math.hypot(v.x, v.z));
    lv.angs.push(Math.atan2(v.z, v.x));
  }
  levels.sort((a, b) => a.y - b.y);
  if (levels.length < 3) return null;
  const bottom = levels[0];
  const top = levels[levels.length - 1];
  const floor = levels[1];
  const segments = new Set(bottom.angs.map((a) => Math.round(a * 1000))).size;
  if (segments < 5) return null;
  let wallInset = 0;
  if (visual && visual.geometry) {
    visual.updateMatrixWorld(true);
    const vp = visual.geometry.getAttribute("position");
    const vbox = new THREE.Box3().setFromObject(visual);
    const yFrom = vbox.min.y + (vbox.max.y - vbox.min.y) * 0.6; // the wall's upper part
    let minR = Infinity;
    for (let i = 0; i < vp.count; i++) {
      v.fromBufferAttribute(vp, i).applyMatrix4(visual.matrixWorld);
      if (v.y < yFrom) continue;
      minR = Math.min(minR, Math.hypot(v.x - center.x, v.z - center.z));
    }
    const inTop = Math.min(...top.rs) * Math.cos(Math.PI / segments);
    if (Number.isFinite(minR)) wallInset = Math.max(0, inTop - minR);
  }
  return {
    bottomY: bottom.y,
    floorY: floor.y,
    topY: top.y,
    bottomR: Math.max(...bottom.rs),
    floorR: Math.max(...floor.rs),
    topInnerR: Math.min(...top.rs),
    topOuterR: Math.max(...top.rs),
    segments,
    phase: bottom.angs[0],
    wallInset,
  };
}

/**
 * The tray as a compound: a floor slab (base → floor level), a thick floor
 * only the food collides with (shapes of foodGroup), and one leaning wall
 * box per side.
 */
export function addTrayShapes(CANNON, body, tray, minWall, foodGroup) {
  const N = tray.segments;
  const cosN = Math.cos(Math.PI / N);
  // Cannon's cylinder puts its first vertex at angle +90° (atan2(z, x)); turn it onto the mesh's.
  const yaw = new CANNON.Quaternion();
  yaw.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.PI / 2 - tray.phase);
  const floorH = tray.floorY - tray.bottomY;
  const slab = new CANNON.Cylinder(tray.bottomR, tray.bottomR, floorH, N);
  slab.collisionFilterMask = ~foodGroup; // the table and the rest, not the food
  body.addShape(slab, new CANNON.Vec3(0, tray.bottomY + floorH / 2, 0), yaw);
  const foodFloorH = KITCHEN_FOOD.trayFoodFloor;
  // Only inside the walls (it once spanned the whole base: a plate shoved over
  // food on the table took that food inside it and pushed it up into the bowl).
  const foodFloorR = (tray.floorR * cosN - tray.wallInset) / cosN;
  const foodFloor = new CANNON.Cylinder(foodFloorR, foodFloorR, foodFloorH, N);
  foodFloor.collisionFilterGroup = foodGroup;
  foodFloor.collisionFilterMask = foodGroup;
  body.addShape(foodFloor, new CANNON.Vec3(0, tray.floorY - foodFloorH / 2, 0), yaw);
  const inFloor = tray.floorR * cosN - tray.wallInset;
  const inTop = tray.topInnerR * cosN - tray.wallInset;
  const outTop = tray.topOuterR * cosN;
  const lean = Math.atan2(inTop - inFloor, tray.topY - tray.floorY);
  const thick = Math.max(minWall, outTop - inTop);
  // Down to (just above) the plate's base, as the real plate's side: food beside the plate is pushed
  // aside by it (from the floor level only, a plate shoved over a snack pressed it into the table).
  const baseY = tray.bottomY + KITCHEN_FOOD.trayWallBaseGap + (thick / 2) * Math.sin(lean);
  const inBase = inFloor - (tray.floorY - baseY) * Math.tan(lean);
  const wallH = tray.topY - baseY;
  const edge = 2 * tray.topOuterR * Math.sin(Math.PI / N) * 1.04;
  const he = new CANNON.Vec3(thick / 2, wallH / 2 / Math.cos(lean), edge / 2);
  const midR = (inBase + inTop) / 2 + thick / 2;
  for (let k = 0; k < N; k++) {
    const a = tray.phase + (2 * Math.PI * (k + 0.5)) / N; // edge middle
    const offset = new CANNON.Vec3(Math.cos(a) * midR, baseY + wallH / 2, Math.sin(a) * midR);
    // Box x points outward (yaw so x → (cos a, sin a)), then leans outward with the wall.
    const qYaw = new CANNON.Quaternion();
    qYaw.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -a);
    const qLean = new CANNON.Quaternion();
    qLean.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), -lean);
    body.addShape(new CANNON.Box(he), offset, qYaw.mult(qLean));
  }
}

/**
 * @param {object} o
 * @param {typeof import("three")} o.THREE
 * @param {typeof import("cannon-es")} o.CANNON
 * @param {import("three").Scene} o.scene
 * @param {import("cannon-es").World} o.world
 * @param {{DEFAULT:number, PROP:number, FOOD:number}} o.groups
 * @param {{table: any, floor: any, prop: any, ramp?: any}} o.materials  cannon materials of the table, floor, plates and ramp (every pair the food can touch gets the food's near-zero bounce, not cannon's default 0.1)
 * @param {() => {top:number, cx:number, cz:number, hx:number, hz:number}|null} o.getTable
 * @param {() => {top:number, cx:number, cz:number, hx:number, hz:number}|null} o.getFloor  the kitchen floor's top and extent
 * @param {number} o.carMass
 * @param {(m: any) => void} [o.guardMaterial]  keeps a material under the bloom threshold
 */
export function createKitchenFood(o) {
  const { THREE, CANNON, scene, world, groups } = o;
  const F = KITCHEN_FOOD;

  // ---- Seeded random (the same plates every load) ----
  let _seed = F.seed >>> 0;
  const rnd = () => {
    _seed = (_seed + 0x6d2b79f5) >>> 0;
    let t = _seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rr = (a, b) => a + (b - a) * rnd();
  const smooth = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  // ---- Physics settings: the cup pyramid's (passed in by the kitchen, so they stay the same) ----
  const CUP = o.cup;
  const foodMat = new CANNON.Material("food");
  for (const other of [o.materials.table, o.materials.floor]) {
    world.addContactMaterial(
      new CANNON.ContactMaterial(foodMat, other, {
        friction: CUP.friction,
        restitution: CUP.restitution,
        contactEquationStiffness: CUP.stiffness,
        contactEquationRelaxation: CUP.relaxation,
      }),
    );
  }
  // In a pile: food against food and against the plates (see pile.contact).
  for (const other of [o.materials.prop, foodMat]) {
    const PC = KITCHEN_FOOD.pile.contact;
    world.addContactMaterial(
      new CANNON.ContactMaterial(foodMat, other, {
        friction: PC.friction,
        restitution: PC.restitution,
        contactEquationStiffness: PC.stiffness,
        contactEquationRelaxation: PC.relaxation,
      }),
    );
  }
  let _boostFrom = 0; // the scene's own solver iterations while a pile settling has them raised (0: not raised)
  if (o.materials.ramp) {
    world.addContactMaterial(new CANNON.ContactMaterial(foodMat, o.materials.ramp, { friction: CUP.friction, restitution: 0, contactEquationStiffness: CUP.stiffness, contactEquationRelaxation: CUP.relaxation }));
  }

  // ---- Canvas textures (generated once, small) ----
  /**
   * A canvas texture. With `patches` (colours), a strip on top holds flat
   * colour patches for the small parts merged into the same mesh (stem, leaf,
   * calyx, carrot tops): one mesh, one draw per kind. The body's v is scaled
   * by userData.vScale; part k samples userData.patchUV(k).
   */
  function canvasTex(w, h, draw, srgb = true, patches = null) {
    const pad = patches ? Math.round(h / 8) : 0;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h + pad;
    const x = c.getContext("2d");
    x.save();
    x.translate(0, pad);
    draw(x, w, h);
    x.restore();
    if (patches) {
      patches.forEach((col, k) => {
        x.fillStyle = col;
        x.fillRect((k * w) / patches.length, 0, w / patches.length, pad);
      });
    }
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = 4;
    t.userData.vScale = h / (h + pad);
    t.userData.patchUV = (k) => [(k + 0.5) / patches.length, 1 - pad / 2 / (h + pad)];
    return t;
  }
  const css = (hex) => "#" + hex.toString(16).padStart(6, "0");
  /** Vertical gradient, bottom (v 0) → top (v 1). */
  const vGrad = (x, w, h, stops) => {
    const g = x.createLinearGradient(0, h, 0, 0);
    stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  };
  /** A soft elliptical blob, drawn wrapped around u (x). */
  const blob = (x, w, cx, cy, rx, ry, color, alpha) => {
    const R = Math.max(rx, ry);
    for (const ox of [-w, 0, w]) {
      x.save();
      x.globalAlpha = alpha;
      x.translate(cx + ox, cy);
      x.scale(rx / R, ry / R);
      const g = x.createRadialGradient(0, 0, 0, 0, 0, R);
      g.addColorStop(0, color);
      g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g;
      x.fillRect(-R, -R, R * 2, R * 2);
      x.restore();
    }
  };
  const dots = (x, w, h, n, color, rMin, rMax, alpha, yFrom = 0, yTo = 1) => {
    x.fillStyle = color;
    for (let i = 0; i < n; i++) {
      x.globalAlpha = alpha * rr(0.5, 1);
      x.beginPath();
      x.arc(rnd() * w, h * rr(yFrom, yTo), rr(rMin, rMax), 0, Math.PI * 2);
      x.fill();
    }
    x.globalAlpha = 1;
  };
  const C = F.colors;
  function appleTex(green) {
    return canvasTex(256, 128, (x, w, h) => {
      const base = green ? C.appleGreen : C.appleRed;
      vGrad(x, w, h, [base[0], base[1], base[2], base[1]]);
      // Blush (a yellow side on red apples, a warm red side on green ones), wrapped around.
      const blush = green ? C.appleGreenBlush : C.appleRedBlush;
      blob(x, w, w * 0.3, h * 0.6, w * 0.32, h * 0.5, blush, 0.55);
      blob(x, w, w * 0.78, h * 0.35, w * 0.16, h * 0.3, blush, 0.3);
      // Fine streaks along the apple (top → bottom).
      x.strokeStyle = green ? "rgba(90,120,20,0.08)" : "rgba(90,10,12,0.1)";
      for (let i = 0; i < 70; i++) {
        x.lineWidth = rr(0.5, 1.1);
        const px = rnd() * w;
        x.beginPath();
        x.moveTo(px, h * rr(0.05, 0.3));
        x.lineTo(px + rr(-3, 3), h * rr(0.6, 0.95));
        x.stroke();
      }
      // Paler stem cavity, then speckles (lenticels).
      blob(x, w, w * 0.5, 0, w, h * 0.12, green ? "#c9c860" : "#c9a248", 0.5);
      dots(x, w, h, 160, C.appleSpeckle, 0.5, 1.1, 0.55, 0.08, 0.92);
    }, true, [css(C.stem), css(C.leaf)]);
  }
  function pearTex() {
    return canvasTex(256, 128, (x, w, h) => {
      vGrad(x, w, h, [C.pear[1], C.pear[2], C.pear[1], C.pear[0]]);
      blob(x, w, w * 0.62, h * 0.7, w * 0.22, h * 0.35, C.pearBlush, 0.35);
      blob(x, w, w * 0.5, 0, w, h * 0.22, C.pearRusset, 0.55); // russet around the stem
      blob(x, w, w * 0.15, h * 0.25, w * 0.1, h * 0.12, C.pearRusset, 0.35);
      dots(x, w, h, 320, C.pearSpeckle, 0.5, 1.2, 0.45);
    }, true, [css(C.stem)]);
  }
  function bananaTex() {
    // u = along the banana (stalk → tip), v = around it.
    return canvasTex(256, 64, (x, w, h) => {
      const g = x.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, C.bananaStem);
      g.addColorStop(0.06, C.bananaGreen);
      g.addColorStop(0.16, C.banana[0]);
      g.addColorStop(0.5, C.banana[1]);
      g.addColorStop(0.84, C.banana[0]);
      g.addColorStop(0.93, C.bananaGreen);
      g.addColorStop(0.97, C.bananaTip);
      g.addColorStop(1, C.bananaTip);
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
      // Soft ridge lines (the 5 edges of the section).
      x.strokeStyle = "rgba(160,120,20,0.35)";
      x.lineWidth = 1.2;
      for (let k = 0; k <= 5; k++) {
        x.beginPath();
        x.moveTo(w * 0.08, (h * k) / 5);
        x.lineTo(w * 0.93, (h * k) / 5);
        x.stroke();
      }
      // Tiny brown spots.
      x.fillStyle = C.bananaSpot;
      for (let i = 0; i < 60; i++) {
        x.globalAlpha = rr(0.25, 0.7);
        x.beginPath();
        x.ellipse(w * rr(0.18, 0.86), rnd() * h, rr(0.6, 1.8), rr(0.5, 1.2), 0, 0, Math.PI * 2);
        x.fill();
      }
      x.globalAlpha = 1;
    });
  }
  function tomatoTex() {
    return canvasTex(128, 64, (x, w, h) => {
      vGrad(x, w, h, [C.tomato[0], C.tomato[1], C.tomato[1], C.tomato[2]]);
      blob(x, w, w * 0.4, h * 0.45, w * 0.3, h * 0.4, C.tomato[2], 0.25);
      blob(x, w, w * 0.5, 0, w, h * 0.2, "#f08a3a", 0.35); // paler around the calyx
    }, true, [css(C.calyx)]);
  }
  function cucumberTex() {
    // u = around, v = along: stripes along the length.
    return canvasTex(128, 256, (x, w, h) => {
      x.fillStyle = C.cucumber[1];
      x.fillRect(0, 0, w, h);
      for (let k = 0; k < 9; k++) {
        const cx = (w * (k + rr(-0.15, 0.15))) / 9;
        const g = x.createLinearGradient(cx - 5, 0, cx + 5, 0);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(0.5, C.cucumber[2]);
        g.addColorStop(1, "rgba(0,0,0,0)");
        x.globalAlpha = 0.55;
        x.fillStyle = g;
        x.fillRect(cx - 5, 0, 10, h);
      }
      x.globalAlpha = 1;
      blob(x, w, w * 0.5, h, w, h * 0.12, C.cucumber[2], 0.6); // paler blossom end
      blob(x, w, w * 0.5, 0, w, h * 0.08, C.cucumber[0], 0.5);
      dots(x, w, h, 140, C.cucumberWart, 0.6, 1.3, 0.6);
    });
  }
  function cucumberBump() {
    return canvasTex(128, 256, (x, w, h) => {
      x.fillStyle = "#808080";
      x.fillRect(0, 0, w, h);
      dots(x, w, h, 220, "#ffffff", 0.8, 1.8, 0.8);
    }, false);
  }
  function carrotTex() {
    // u = around, v = along (tip at the bottom).
    return canvasTex(64, 256, (x, w, h) => {
      vGrad(x, w, h, [C.carrot[0], C.carrot[1], C.carrot[2], C.carrot[1]]);
      x.strokeStyle = C.carrotRidge;
      for (let i = 0; i < 46; i++) {
        x.globalAlpha = rr(0.2, 0.5);
        x.lineWidth = rr(0.6, 1.4);
        const y = rnd() * h;
        const x0 = rnd() * w;
        x.beginPath();
        x.moveTo(x0, y);
        x.lineTo(x0 + rr(8, 30), y + rr(-1, 1));
        x.stroke();
      }
      x.globalAlpha = 1;
      blob(x, w, w * 0.5, 0, w, h * 0.05, C.carrotCrown, 0.7);
    }, true, [css(C.carrotLeaf)]);
  }
  function carrotBump() {
    return canvasTex(64, 256, (x, w, h) => {
      x.fillStyle = "#808080";
      x.fillRect(0, 0, w, h);
      x.strokeStyle = "#2a2a2a";
      for (let i = 0; i < 60; i++) {
        x.globalAlpha = rr(0.3, 0.7);
        x.lineWidth = rr(0.8, 1.6);
        const y = rnd() * h;
        x.beginPath();
        x.moveTo(rnd() * w, y);
        x.lineTo(rnd() * w + w, y + rr(-1, 1));
        x.stroke();
      }
      x.globalAlpha = 1;
    }, false);
  }
  /** All the wrapper designs in one atlas (a row each); each instance picks its row (aDesign). */
  function wrapperAtlas() {
    const n = F.snackPalettes.length;
    return canvasTex(512, 256 * n, (x) => {
      for (let k = 0; k < n; k++) {
        x.save();
        x.translate(0, k * 256);
        x.beginPath();
        x.rect(0, 0, 512, 256);
        x.clip();
        drawWrapper(x, k);
        x.restore();
      }
    });
  }
  function drawWrapper(x, i) {
    // u = along the wrapper, v = around it (top face ≈ v 0.125..0.375, i.e. canvas y 160..224).
    const [base, band, accent, seal] = F.snackPalettes[i % F.snackPalettes.length];
    const w = 512;
    const h = 256;
    {
      x.fillStyle = base;
      x.fillRect(0, 0, w, h);
      const sealW = w * 0.1;
      // Top face: a diagonal band, a wave, a round badge and "pieces" (no text).
      x.save();
      x.beginPath();
      x.rect(sealW, 140, w - sealW * 2, 104);
      x.clip();
      x.fillStyle = band;
      x.beginPath();
      x.moveTo(w * 0.24, 140);
      x.lineTo(w * 0.36, 140);
      x.lineTo(w * 0.28, 244);
      x.lineTo(w * 0.16, 244);
      x.closePath();
      x.fill();
      x.strokeStyle = accent;
      x.lineWidth = 7;
      x.beginPath();
      for (let k = 0; k <= 120; k++) {
        const px = w * 0.4 + k * 1.6;
        const py = 192 + Math.sin(k / 9) * 16;
        if (k) x.lineTo(px, py);
        else x.moveTo(px, py);
      }
      x.stroke();
      x.fillStyle = accent;
      x.beginPath();
      x.arc(w * 0.72, 192, 22, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = band;
      x.beginPath();
      x.arc(w * 0.72, 192, 12, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = "rgba(0,0,0,0.22)";
      for (let k = 0; k < 3; k++) x.fillRect(w * 0.5 + k * 22, 206, 16, 12);
      x.restore();
      // Back: thin stripes.
      x.strokeStyle = "rgba(255,255,255,0.18)";
      x.lineWidth = 3;
      for (let k = 0; k < 7; k++) {
        x.beginPath();
        x.moveTo(sealW, 30 + k * 11);
        x.lineTo(w - sealW, 30 + k * 11);
        x.stroke();
      }
      // Crimped, sealed ends (foil-like, crimp ridges along the length).
      for (const sx of [0, w - sealW]) {
        x.fillStyle = seal;
        x.fillRect(sx, 0, sealW, h);
        x.fillStyle = base;
        x.globalAlpha = 0.35;
        x.fillRect(sx, 0, sealW, h);
        x.globalAlpha = 1;
        x.strokeStyle = "rgba(0,0,0,0.25)";
        x.lineWidth = 1.5;
        for (let k = 0; k < h; k += 6) {
          x.beginPath();
          x.moveTo(sx, k);
          x.lineTo(sx + sealW, k);
          x.stroke();
        }
      }
    }
  }

  // ---- Visual materials (shared) ----
  const S = F.surface;
  const env = { envMapIntensity: S.envMapIntensity };
  const mats = {
    appleRed: new THREE.MeshPhysicalMaterial({ map: appleTex(false), ...S.apple, ...env }),
    appleGreen: new THREE.MeshPhysicalMaterial({ map: appleTex(true), ...S.apple, ...env }),
    pear: new THREE.MeshStandardMaterial({ map: pearTex(), ...S.pear, ...env }),
    banana: new THREE.MeshStandardMaterial({ map: bananaTex(), ...S.banana, ...env }),
    tomato: new THREE.MeshPhysicalMaterial({ map: tomatoTex(), ...S.tomato, ...env }),
    cucumber: new THREE.MeshStandardMaterial({ map: cucumberTex(), bumpMap: cucumberBump(), ...S.cucumber, ...env }),
    carrot: new THREE.MeshStandardMaterial({ map: carrotTex(), bumpMap: carrotBump(), ...S.carrot, ...env }),
    wrapper: new THREE.MeshStandardMaterial({ map: wrapperAtlas(), ...S.wrapper, ...env }),
  };
  {
    // Each wrapper instance samples its design's row of the atlas (a small inset keeps rows from bleeding).
    const n = F.snackPalettes.length;
    const e = (2 / 256).toFixed(5);
    mats.wrapper.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aDesign;")
        .replace("#include <uv_vertex>", `#include <uv_vertex>\nvMapUv.y = (vMapUv.y * (1.0 - 2.0 * ${e}) + ${e} + aDesign) / ${n}.0;`);
    };
    mats.wrapper.customProgramCacheKey = () => "kitchenFoodWrapperAtlas";
  }
  for (const m of Object.values(mats).flat()) if (o.guardMaterial) o.guardMaterial(m);

  // ---- Geometry helpers ----
  /**
   * A grid surface: rings i (0..nI) × j (0..nJ). Closed (around): the seam is
   * duplicated for UVs and its normals welded, and pole rings (radius 0) share
   * one normal, so the shading is smooth everywhere. fn(i, j) → [x, y, z].
   */
  function gridGeometry(nI, nJ, fn, { closed = true, poleStart = false, poleEnd = false, uvFn = null, outward = null } = {}) {
    const pos = [];
    const uv = [];
    for (let i = 0; i <= nI; i++) {
      for (let j = 0; j <= nJ; j++) {
        const p = fn(i, closed ? j % nJ : j);
        pos.push(p[0], p[1], p[2]);
        if (uvFn) uv.push(...uvFn(i, j));
        else uv.push(j / nJ, i / nI);
      }
    }
    const W = nJ + 1;
    const idx = [];
    for (let i = 0; i < nI; i++) {
      for (let j = 0; j < nJ; j++) {
        const a = i * W + j;
        const b = a + 1;
        const c = a + W;
        const d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // Outward check on a middle vertex: flip the winding if the normals point in.
    if (outward) {
      const n = geo.getAttribute("normal");
      const mi = Math.floor(nI / 2);
      const k = mi * W + Math.floor(nJ / 4);
      const c = outward(mi);
      const dot = (pos[k * 3] - c[0]) * n.getX(k) + (pos[k * 3 + 1] - c[1]) * n.getY(k) + (pos[k * 3 + 2] - c[2]) * n.getZ(k);
      if (dot < 0) {
        for (let t = 0; t < idx.length; t += 3) {
          const s = idx[t + 1];
          idx[t + 1] = idx[t + 2];
          idx[t + 2] = s;
        }
        geo.setIndex(idx);
        geo.computeVertexNormals();
      }
    }
    if (!closed) return geo;
    const n = geo.getAttribute("normal");
    const v = new THREE.Vector3();
    for (let i = 0; i <= nI; i++) {
      const pole = (i === 0 && poleStart) || (i === nI && poleEnd);
      if (pole) {
        v.set(0, 0, 0);
        for (let j = 0; j < nJ; j++) v.add(new THREE.Vector3(n.getX(i * W + j), n.getY(i * W + j), n.getZ(i * W + j)));
        v.normalize();
        for (let j = 0; j <= nJ; j++) n.setXYZ(i * W + j, v.x, v.y, v.z);
      } else {
        const a = i * W;
        const b = a + nJ;
        v.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
        n.setXYZ(a, v.x, v.y, v.z);
        n.setXYZ(b, v.x, v.y, v.z);
      }
    }
    n.needsUpdate = true;
    return geo;
  }
  /** Revolve a profile [[r, y], …] (bottom pole → top pole) around y; mod(i, θ) scales the radius; lean(y) shifts x. */
  function revolve(profile, around, mod = null, lean = null) {
    const nI = profile.length - 1;
    return gridGeometry(
      nI,
      around,
      (i, j) => {
        const th = (j / around) * Math.PI * 2;
        const [r0, y] = profile[i];
        const r = r0 * (mod ? mod(i, th) : 1);
        return [Math.cos(th) * r + (lean ? lean(y) : 0), y, -Math.sin(th) * r];
      },
      {
        poleStart: profile[0][0] < 1e-6,
        poleEnd: profile[nI][0] < 1e-6,
        outward: (i) => [lean ? lean(profile[i][1]) : 0, profile[i][1], 0],
      },
    );
  }
  /** Dense smooth profile through control points [[r, y], …] (poles at both ends). */
  function splineProfile(ctrl, n, rScale, yScale) {
    const curve = new THREE.SplineCurve(ctrl.map(([r, y]) => new THREE.Vector2(r, y)));
    return curve.getSpacedPoints(n).map((p, i, a) => [i === 0 || i === a.length - 1 ? 0 : Math.max(0, p.x * rScale), p.y * yScale]);
  }
  /** Centre geometries on the first one's bounding-box centre. */
  function centreOn(main, ...others) {
    main.computeBoundingBox();
    const c = main.boundingBox.getCenter(new THREE.Vector3());
    for (const g of [main, ...others]) g.translate(-c.x, -c.y, -c.z);
  }
  /** A small curved stem: a tube along a quadratic curve. */
  function stemGeometry(base, tipOffset, r, bendX) {
    const p0 = new THREE.Vector3(...base);
    const p2 = p0.clone().add(new THREE.Vector3(...tipOffset));
    const p1 = p0.clone().lerp(p2, 0.5).add(new THREE.Vector3(bendX, 0, 0));
    return new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p0, p1, p2), 5, r, 6, false);
  }
  /** A bent leaf blade (double-sided material) from its base along +x. */
  function leafGeometry(l, w, droop) {
    return gridGeometry(
      8,
      4,
      (i, j) => {
        const s = i / 8;
        const half = 0.5 * w * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.05)), 0.8);
        const zz = (j / 4) * 2 - 1;
        return [s * l, -droop * s * s + Math.abs(zz) * half * 0.35, zz * half];
      },
      { closed: false },
    );
  }
  /** Merge indexed geometries (position, normal, uv), keeping their smooth normals. */
  function mergeAll(parts) {
    for (const p of parts) {
      for (const k of Object.keys(p.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") p.deleteAttribute(k);
      if (!p.index) p.setIndex([...Array(p.getAttribute("position").count).keys()]);
    }
    return mergeGeometries(parts);
  }
  /** One flat UV for a whole part (a colour patch of its kind's texture). */
  function setUV(geo, [u, v]) {
    const n = geo.getAttribute("position").count;
    const a = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      a[i * 2] = u;
      a[i * 2 + 1] = v;
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(a, 2));
    return geo;
  }
  function scaleV(geo, sv) {
    const uv = geo.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * sv);
    return geo;
  }
  /** A thin part seen from both sides (a back copy, flipped), in one front-sided material. */
  function twoSided(geo) {
    const back = geo.clone();
    const idx = back.index.array.slice();
    for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
    back.setIndex(Array.from(idx));
    const n = back.getAttribute("normal");
    for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    return mergeAll([geo, back]);
  }
  /** A chain of spheres along x (radii per step), its origin at the centre of mass. */
  function sphereChain(radii, span) {
    const n = radii.length;
    const xs = radii.map((_, i) => (n === 1 ? 0 : (i / (n - 1) - 0.5) * span));
    const vols = radii.map((r) => r ** 3);
    const comX = xs.reduce((s, x, i) => s + x * vols[i], 0) / vols.reduce((a, b) => a + b, 0);
    return { comX, shapes: radii.map((r, i) => ({ type: "sphere", r, offset: [xs[i] - comX, 0, 0] })) };
  }
  /** Wrapper: x along the length, a rounded section (superellipse), sealed flat at both ends with crimp teeth. */
  function wrapperGeometry(L, Wd, H, { seal, teeth, puff, exp }) {
    const nL = F.detail.wrapper.length;
    const nC = F.detail.wrapper.around;
    const sealLen = seal * L;
    return gridGeometry(
      nL,
      nC,
      (i, j) => {
        const x = (-0.5 + i / nL) * L;
        const s = Math.max(0, Math.min(1, (Math.abs(x) - (L / 2 - sealLen)) / sealLen));
        const ph = (j / nC) * Math.PI * 2;
        const c = Math.cos(ph);
        const sn = Math.sin(ph);
        const sz = Math.sign(c) * Math.pow(Math.abs(c), 2 / exp);
        const sy = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / exp);
        const along = (2 * x) / L;
        const hf = Math.max(0.03, (1 - Math.pow(s, 0.55)) * (1 - puff * along * along * (1 - s)));
        const wf = (1 + 0.05 * s) * (1 - 0.06 * puff * along * along);
        const z = sz * wf * Wd * 0.5;
        // Soft, uneven surface (deterministic ripples), and crimp teeth on the fin edge.
        const ripple = 1 + 0.06 * Math.sin(x * 23.1 + z * 13.7) * Math.sin(z * 17.3 - x * 9.1);
        const y = sy * hf * H * 0.5 * ripple;
        const tooth = Math.abs((((z / Wd + 0.5) * teeth) % 1) - 0.5) * 2; // 0..1 triangle wave
        return [x + Math.sign(x) * s ** 4 * tooth * 0.035 * L, y, z];
      },
      { uvFn: (i, j) => [i / nL, j / nC], outward: () => [0, 0, 0] },
    );
  }

  // ---- Kinds: shared geometry per kind (built once for the size unit) ----
  const D = F.detail;
  const kindDefs = {};
  function defineKinds(U) {
    // Apple: real profile with the stem and base dimples (and soft lobes at the base), stem, leaf.
    {
      const ra = 0.26 * U;
      const K = D.apple.profile;
      const prof = [];
      const lobeW = [];
      for (let i = 0; i <= K; i++) {
        const t = 0.5 - 0.5 * Math.cos((Math.PI * i) / K); // denser near the poles
        const ph = -Math.PI / 2 + Math.PI * t;
        const y0 = Math.sin(ph);
        let x = Math.cos(ph) * (1 + 0.07 * y0) * (1 - 0.06 * Math.max(0, -y0) ** 2);
        let y = 0.86 * y0;
        y -= 0.2 * Math.exp(-((x / 0.3) ** 2)) * Math.max(0, y0);
        y += 0.1 * Math.exp(-((x / 0.22) ** 2)) * Math.max(0, -y0);
        if (i === 0 || i === K) x = 0;
        prof.push([x * ra, y * ra]);
        lobeW.push(Math.max(0, -y0) ** 1.5);
      }
      const body = revolve(prof, D.apple.around, (i, th) => 1 + 0.03 * Math.cos(5 * th) * lobeW[i]);
      const topY = prof[K][1];
      const stem = stemGeometry([0, topY - 0.02 * ra, 0], [0.06 * ra, 0.46 * ra, 0], 0.04 * ra, 0.05 * ra);
      const leaf = leafGeometry(0.62 * ra, 0.28 * ra, 0.12 * ra);
      leaf.rotateZ(0.35).rotateY(0.6).translate(0.04 * ra, topY + 0.3 * ra, 0);
      centreOn(body, stem, leaf);
      const P = mats.appleRed.map.userData; // same layout in both apple textures
      const geo = mergeAll([scaleV(body, P.vScale), setUV(stem, P.patchUV(0)), setUV(twoSided(leaf), P.patchUV(1))]);
      kindDefs.apple = { geo, rolls: true, shapes: [{ type: "sphere", r: ra * 0.93, offset: [0, 0, 0] }], pose: "round" };
    }
    // Pear: wide bottom narrowing into a neck, slightly leaning, stem on top.
    {
      const rp = 0.25 * U;
      const H = 0.8 * U;
      const prof = splineProfile(
        [[0, 0], [0.45, 0.012], [0.8, 0.07], [0.97, 0.19], [1.0, 0.3], [0.93, 0.43], [0.74, 0.56], [0.56, 0.67], [0.46, 0.77], [0.4, 0.86], [0.33, 0.94], [0.17, 0.99], [0, 0.975]],
        D.pear.profile,
        rp,
        H,
      );
      const lean = (y) => 0.1 * rp * (y / H) ** 2;
      const body = revolve(prof, D.pear.around, null, lean);
      const topY = prof[prof.length - 1][1];
      const stem = stemGeometry([lean(topY), topY - 0.03 * rp, 0], [0.12 * rp, 0.5 * rp, 0], 0.045 * rp, -0.06 * rp);
      // Colliders: a big sphere low, a small one in the neck; origin at the centre of mass (by volume).
      const r1 = rp * 0.95;
      const y1 = r1;
      const r2 = rp * 0.46;
      const y2 = H * 0.76;
      const comY = (y1 * r1 ** 3 + y2 * r2 ** 3) / (r1 ** 3 + r2 ** 3);
      body.translate(0, -comY, 0);
      stem.translate(0, -comY, 0);
      const P = mats.pear.map.userData;
      kindDefs.pear = {
        geo: mergeAll([scaleV(body, P.vScale), setUV(stem, P.patchUV(0))]),
        rolls: true,
        shapes: [
          { type: "sphere", r: r1, offset: [0, y1 - comY, 0] },
          { type: "sphere", r: r2, offset: [lean(y2), y2 - comY, 0] },
        ],
        pose: "pear",
      };
    }
    // Banana: a curved sweep with a soft five-ridged section, tapering to a stalk and a dark tip.
    {
      const L = 1.15 * U * F.bananaScale;
      const r = 0.11 * U * F.bananaScale;
      const bend = 0.16 * U * F.bananaScale;
      const nL = D.banana.length;
      const nR = D.banana.around;
      const centre = (t) => [(t - 0.5) * L, -bend * (1 - (2 * t - 1) ** 2)];
      const comZ = -bend * (2 / 3);
      const pent = (ph) => {
        const seg = (2 * Math.PI) / 5;
        const a = ((((ph + seg / 2) % seg) + seg) % seg) - seg / 2;
        return Math.cos(Math.PI / 5) / Math.cos(a);
      };
      const radius = (t) => {
        const bodyW = smooth(0.03, 0.24, t) * (1 - smooth(0.78, 0.985, t));
        const stalk = 0.27 * (1 - smooth(0.12, 0.2, t));
        const tipR = 0.22 * smooth(0.8, 0.9, t);
        const cap = Math.sqrt(Math.max(0, Math.min(1, Math.min(t, 1 - t) / 0.015)));
        return r * Math.max(bodyW * (1 - 0.6 * (t - 0.55) ** 2), stalk, tipR) * cap;
      };
      const body = gridGeometry(
        nL,
        nR,
        (i, j) => {
          const t = i / nL;
          const [cx, cz] = centre(t);
          const [cx2, cz2] = centre(Math.min(1, t + 0.001));
          const [cx1, cz1] = centre(Math.max(0, t - 0.001));
          const tl = Math.hypot(cx2 - cx1, cz2 - cz1) || 1;
          const nx = -(cz2 - cz1) / tl; // horizontal normal of the path
          const nz = (cx2 - cx1) / tl;
          const ph = (j / nR) * Math.PI * 2;
          const ridge = 0.5 * smooth(0.05, 0.25, t) * (1 - smooth(0.82, 0.95, t));
          const rad = radius(t) * (1 + (pent(ph) - 1) * ridge);
          return [cx + nx * Math.cos(ph) * rad, Math.sin(ph) * rad, cz - comZ + nz * Math.cos(ph) * rad];
        },
        {
          poleStart: true,
          poleEnd: true,
          uvFn: (i, j) => [i / nL, j / nR],
          outward: (i) => {
            const [cx, cz] = centre(i / nL);
            return [cx, 0, cz - comZ];
          },
        },
      );
      // Proxy: one narrow box along its length, covering the curve (it slides and tips, but doesn't roll).
      // The curve's centre line spans z -bend/3 .. +2·bend/3 around the centre of mass.
      const P = F.proxy.banana;
      const shapes = [{ type: "box", he: [L * P.halfLength, r * P.halfHeight, bend / 2 + r * P.depthPad], offset: [0, 0, bend / 6], r: r * P.halfHeight }];
      kindDefs.banana = { geo: body, shapes, pose: "lying" };
    }
    // Tomato: slightly flattened with subtle lobes, a star calyx and a short stem.
    {
      const rt = 0.2 * U;
      const K = D.tomato.profile;
      const prof = [];
      const topW = [];
      for (let i = 0; i <= K; i++) {
        const t = 0.5 - 0.5 * Math.cos((Math.PI * i) / K);
        const ph = -Math.PI / 2 + Math.PI * t;
        const y0 = Math.sin(ph);
        let x = Math.cos(ph);
        let y = 0.8 * y0;
        y -= 0.08 * Math.exp(-((x / 0.3) ** 2)) * Math.max(0, y0);
        y += 0.04 * Math.exp(-((x / 0.4) ** 2)) * Math.max(0, -y0);
        if (i === 0 || i === K) x = 0;
        prof.push([x * rt, y * rt]);
        topW.push(0.35 + 0.65 * Math.max(0, y0));
      }
      const body = revolve(prof, D.tomato.around, (i, th) => 1 + 0.03 * Math.cos(5 * th + 0.4) * topW[i]);
      const topY = prof[K][1];
      const parts = [];
      for (let k = 0; k < 5; k++) {
        const sep = gridGeometry(
          6,
          2,
          (i, j) => {
            const s = i / 6;
            const half = 0.13 * rt * Math.pow(1 - s, 0.85) * Math.min(1, s * 4 + 0.3);
            const zz = j - 1;
            return [0.04 * rt + s * 0.5 * rt, topY + 0.03 * rt - 0.16 * rt * s * s + Math.abs(zz) * 0.01 * rt, zz * half];
          },
          { closed: false },
        );
        sep.rotateY((k / 5) * Math.PI * 2 + 0.2);
        parts.push(twoSided(sep));
      }
      parts.push(new THREE.CylinderGeometry(0.04 * rt, 0.055 * rt, 0.2 * rt, 6).translate(0, topY + 0.1 * rt, 0));
      const P = mats.tomato.map.userData;
      const calyx = setUV(mergeAll(parts), P.patchUV(0));
      centreOn(body, calyx);
      kindDefs.tomato = { geo: mergeAll([scaleV(body, P.vScale), calyx]), rolls: true, shapes: [{ type: "sphere", r: rt * 0.86, offset: [0, 0, 0] }], pose: "round" };
    }
    // Cucumber: long, slightly uneven and bent, rounded ends, bumpy skin (bump map).
    {
      const L = 1.1 * U;
      const r = 0.11 * U;
      const n = D.cucumber.length;
      const prof = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const dEnd = Math.min(t, 1 - t) * L;
        const e = r * 1.15;
        const cap = dEnd < e ? Math.sqrt(Math.max(0, 1 - (1 - dEnd / e) ** 2)) : 1;
        const rad = r * (1 + 0.05 * (0.5 - t)) * (1 + 0.025 * Math.sin(t * 9 + 1)) * cap;
        prof.push([i === 0 || i === n ? 0 : rad, (t - 0.5) * L]);
      }
      const body = revolve(prof, D.cucumber.around, null, (y) => 0.05 * L * (1 - ((2 * y) / L) ** 2));
      body.rotateZ(-Math.PI / 2).rotateX(Math.PI / 2); // lying along x, the bend sideways
      centreOn(body);
      // Proxy: one cylinder along its length (rolls straight).
      kindDefs.cucumber = {
        geo: body,
        rolls: true,
        shapes: [{ type: "cylinder", rTop: r * F.proxy.cucumber.radius, rBottom: r * F.proxy.cucumber.radius, h: L * F.proxy.cucumber.length, alongX: 1, offset: [0, 0, 0], r: r * F.proxy.cucumber.radius }],
        pose: "lying",
      };
    }
    // Carrot: tapered, ridged across, a slight bend, leafy tops.
    {
      const L = 1.0 * U;
      const rb = 0.13 * U;
      const prof = splineProfile(
        // A rounded, blunt tip (was [0, 0], [0.07, 0.012], [0.25, 0.15], [0.5, 0.4]: a sharp point).
        [[0, 0], [0.14, 0.006], [0.24, 0.03], [0.36, 0.13], [0.54, 0.38], [0.72, 0.65], [0.88, 0.85], [0.97, 0.95], [1.0, 0.985], [0.82, 1.0], [0.35, 1.008], [0, 1.008]],
        D.carrot.length,
        rb,
        L,
      );
      const body = revolve(
        prof,
        D.carrot.around,
        (i, th) => 1 - 0.035 * Math.pow(0.5 + 0.5 * Math.sin((prof[i][1] / L) * Math.PI * 2 * 13 + 0.7 * Math.sin(th * 2)), 4),
        (y) => 0.05 * L * (1 - y / L) ** 2,
      );
      const topY = prof[prof.length - 1][1];
      const leafParts = [];
      for (let k = 0; k < 6; k++) {
        const len = rb * (1.5 + 0.4 * ((k * 7) % 3));
        const g = [new THREE.CylinderGeometry(0.035 * rb, 0.06 * rb, len, 5).translate(0, len / 2, 0)];
        for (let m = 0; m < D.carrotLeaflets; m++) {
          g.push(new THREE.SphereGeometry(0.3 * rb, 6, 3).scale(1, 0.16, 0.42).rotateY(m * 1.9 + 0.5).translate(0.12 * rb * (m % 2 ? 1 : -1), len * (0.35 + 0.15 * m), 0));
        }
        const sprig = mergeAll(g);
        sprig.rotateZ(0.3 + 0.14 * (k % 2)).rotateY((k / 6) * Math.PI * 2 + 0.3).translate(0, topY - 0.02 * rb, 0);
        leafParts.push(sprig);
      }
      const leaves = mergeAll(leafParts);
      // Lying along x (tip toward -x), the bend sideways.
      body.rotateZ(-Math.PI / 2).rotateX(Math.PI / 2);
      leaves.rotateZ(-Math.PI / 2).rotateX(Math.PI / 2);
      const ch = sphereChain([rb * 0.32, rb * 0.56, rb * 0.8, rb], L * 0.75);
      body.translate(-L / 2 - ch.comX, 0, 0);
      leaves.translate(-L / 2 - ch.comX, 0, 0);
      const P = mats.carrot.map.userData;
      // Proxy: one tapered cylinder along its length, thick end toward +x, a bit narrower than the
      // thick end (rolls in an arc and stops on its side). Its middle is the model's middle (x = -comX).
      const CP = F.proxy.carrot;
      kindDefs.carrot = {
        geo: mergeAll([scaleV(body, P.vScale), setUV(leaves, P.patchUV(0))]),
        rolls: true,
        shapes: [{ type: "cylinder", rTop: rb * CP.thickEnd, rBottom: rb * CP.thinEnd, h: L * CP.length, alongX: 1, offset: [-ch.comX, 0, 0], r: rb * (CP.thickEnd + CP.thinEnd) / 2 }],
        pose: "lying",
      };
    }
    // Wrapped snacks: soft pillows with crimped, sealed fin ends.
    for (const kind of ["bar", "pack"]) {
      const isBar = kind === "bar";
      const L = (isBar ? 0.95 : 0.58) * U;
      const Wd = (isBar ? 0.32 : 0.44) * U;
      const H = (isBar ? 0.1 : 0.17) * U;
      const body = wrapperGeometry(L, Wd, H, { seal: isBar ? 0.09 : 0.11, teeth: isBar ? 7 : 9, puff: isBar ? 0.12 : 0.4, exp: isBar ? 4 : 2.6 });
      kindDefs[kind] = {
        geo: body,
        shapes: [{ type: "box", he: [L * (isBar ? 0.44 : 0.4), H * 0.45, Wd * 0.46], offset: [0, 0, 0], r: Wd * 0.46 }],
        pose: "flat",
      };
    }
  }

  // ---- Instanced batches: one InstancedMesh per (geometry, material) ----
  const batches = new Map(); // key → { geo, mat, refs, mesh, dirty }
  function useBatch(key, geo, mat) {
    let b = batches.get(key);
    if (!b) batches.set(key, (b = { geo, mat, refs: [], mesh: null, dirty: true }));
    return b;
  }

  const plates = []; // { body, tray, items (its own food, for settling) }
  const items = [];
  const _m = new THREE.Matrix4();
  const _w = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _sv = new THREE.Vector3();
  const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
  let settled = false;

  /** The physics proxy: a dynamic body of one simple shape (two spheres for the pear), with the cup pyramid's settings. */
  function makeBody(kindName, s, forSettle) {
    const def = kindDefs[kindName];
    const body = new CANNON.Body({
      mass: F.mass[kindName] * s * s * s * (kindName === "banana" ? F.bananaScale ** 3 : 1),
      material: forSettle ? null : foodMat,
      linearDamping: forSettle ? F.settle.linearDamping : CUP.linearDamping,
      angularDamping: forSettle ? F.settle.angularDamping : kindDefs[kindName].rolls ? F.heap.rollingAngularDamping : CUP.angularDamping,
      allowSleep: true,
      sleepSpeedLimit: forSettle ? F.settle.sleep.speed : F.heap.sleepSpeed,
      sleepTimeLimit: forSettle ? F.settle.sleep.time : CUP.sleepTime,
      collisionFilterGroup: forSettle ? 1 : groups.FOOD,
      collisionFilterMask: forSettle ? -1 : groups.DEFAULT | groups.PROP | groups.FOOD,
    });
    const shapes = [];
    for (const sh of def.shapes) {
      const shape =
        sh.type === "sphere"
          ? new CANNON.Sphere(sh.r * s)
          : sh.type === "cylinder"
            ? new CANNON.Cylinder(sh.rTop * s, sh.rBottom * s, sh.h * s, F.proxy.cylinderSegments)
            : new CANNON.Box(new CANNON.Vec3(sh.he[0] * s, sh.he[1] * s, sh.he[2] * s));
      shape.collisionFilterGroup = groups.FOOD; // meets the trays' thick food floor (see trayFoodFloor)
      let q;
      if (sh.alongX) {
        // Cannon's cylinder runs along y (top at +y): turned to lie along x, top toward +x.
        q = new CANNON.Quaternion();
        q.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), -Math.PI / 2);
      }
      body.addShape(shape, new CANNON.Vec3(sh.offset[0] * s, sh.offset[1] * s, sh.offset[2] * s), q);
      shapes.push({ r: sh.r * s });
    }
    body._minR = Math.min(...shapes.map((x) => x.r));
    return { body, shapes };
  }

  // ---- Setup ----
  /** @param {{name:string, body:any, radius:number, tray:any}[]} plateList */
  function setup(plateList) {
    const known = plateList.filter((pl) => F.plates[pl.name] && pl.tray);
    if (!known.length) return;
    defineKinds(Math.min(...known.map((pl) => pl.radius)) * F.sizeScale);
    const V = F.variation;
    for (const pl of known) {
      const type = F.plates[pl.name];
      const plate = { body: pl.body, tray: pl.tray, items: [], last: null }; // items: the ones attached to it
      plates.push(plate);
      pl.body._foodPlate = plate;
      const list = [];
      for (const [kindName, count] of Object.entries(F.counts[type])) for (let n = 0; n < count; n++) list.push(kindName);
      // Mixed naturally: dropped in a shuffled order.
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      let design = 0;
      for (const kindName of list) {
        const def = kindDefs[kindName];
        const s = (1 + rr(-V.size, V.size)) * (kindName === "bar" || kindName === "pack" ? 1 : F.produceScale);
        const k = 1 + rr(-V.tone, V.tone);
        const wm = rr(-V.warmth, V.warmth);
        // One mesh per kind (parts merged in): red / green apples differ by texture only.
        const parts = [];
        let designIndex = -1;
        if (kindName === "apple") {
          const green = rnd() < 0.35;
          parts.push(useBatch(green ? "appleGreen" : "appleRed", def.geo, green ? mats.appleGreen : mats.appleRed));
        } else if (kindName === "bar" || kindName === "pack") {
          designIndex = design++ % F.snackPalettes.length;
          parts.push(useBatch(kindName, def.geo, mats.wrapper));
        } else {
          parts.push(useBatch(kindName, def.geo, mats[kindName]));
        }
        const { body, shapes } = makeBody(kindName, s, false);
        const item = {
          kindName,
          plate,
          scale: s,
          color: new THREE.Color(k * (1 + wm), k, k * (1 - wm)),
          refs: parts.map((b) => {
            const ref = { batch: b, index: b.refs.length, design: designIndex };
            b.refs.push(ref);
            return ref;
          }),
          body,
          shapes,
          local: new THREE.Matrix4(),
          dropped: false,
          prev: new CANNON.Vec3(),
        };
        body._foodItem = item;
        plate.items.push(item);
        items.push(item);
      }
    }
    for (const b of batches.values()) {
      const mesh = new THREE.InstancedMesh(b.geo, b.mat, b.refs.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // instances move apart once hit
      mesh.name = "kitchenFood";
      for (const ref of b.refs) mesh.setMatrixAt(ref.index, _zero); // hidden until settled
      if (b.mat === mats.wrapper) {
        // The design's row in the atlas (rows from the top: design 0 is the top row).
        const n = F.snackPalettes.length;
        const a = new Float32Array(b.refs.length);
        for (const ref of b.refs) a[ref.index] = n - 1 - ref.design;
        b.geo.setAttribute("aDesign", new THREE.InstancedBufferAttribute(a, 1));
      }
      b.mesh = mesh;
      scene.add(mesh);
    }
    for (const it of items) for (const ref of it.refs) ref.batch.mesh.setColorAt(ref.index, it.color);
    for (const b of batches.values()) if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
  }

  // ---- Off-screen settling (drop in batches, simulate, store the resting poses) ----
  function* settleJob() {
    const T = F.settle;
    for (const plate of plates) {
      const w = new CANNON.World({ gravity: new CANNON.Vec3(0, -T.gravity, 0), allowSleep: true });
      w.broadphase = new CANNON.SAPBroadphase(w);
      w.solver.iterations = T.iterations;
      w.defaultContactMaterial.friction = T.friction;
      w.defaultContactMaterial.restitution = T.restitution;
      w.defaultContactMaterial.contactEquationStiffness = 1e7;
      w.defaultContactMaterial.contactEquationRelaxation = 3;
      const tray = plate.tray;
      const pb = new CANNON.Body({ type: CANNON.Body.STATIC });
      addTrayShapes(CANNON, pb, tray, F.trayMinWall, groups.FOOD);
      w.addBody(pb);
      // Exactly the game's colliders (the tray, with its thick food-only floor), so the stored poses fit them,
      // and the table under the plate (an item rolling off lands beside it, as in the game).
      const table = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
      table.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
      table.position.set(0, tray.bottomY, 0);
      w.addBody(table);
      const inner = tray.floorR * Math.cos(Math.PI / tray.segments) - tray.wallInset;
      const placed = [];
      const its = plate.items;
      for (let start = 0; start < its.length; start += T.batchSize) {
        for (const it of its.slice(start, start + T.batchSize)) {
          const { body } = makeBody(it.kindName, it.scale, true);
          it._settleBody = body;
          // Orientation by kind: round fruit stem-up (tilted), pears upright or lying,
          // long items lying, snacks flat (some upside down); any heading.
          const pose = kindDefs[it.kindName].pose;
          const qYaw = new CANNON.Quaternion();
          qYaw.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rnd() * Math.PI * 2);
          const qT = new CANNON.Quaternion();
          if (pose === "round") qT.setFromEuler(rr(-0.35, 0.35), 0, rr(-0.35, 0.35));
          else if (pose === "pear") qT.setFromEuler(rnd() < 0.4 ? Math.PI / 2 : rr(-0.3, 0.3), 0, rr(-0.2, 0.2));
          else if (pose === "lying") qT.setFromEuler(rr(-0.5, 0.5) + (rnd() < 0.5 ? Math.PI : 0), 0, rr(-0.12, 0.12));
          else qT.setFromEuler((rnd() < 0.3 ? Math.PI : 0) + rr(-0.1, 0.1), 0, rr(-0.1, 0.1));
          qYaw.mult(qT, body.quaternion);
          body.position.set(0, 0, 0);
          body.updateAABB();
          const hx = (body.aabb.upperBound.x - body.aabb.lowerBound.x) / 2;
          const hz = (body.aabb.upperBound.z - body.aabb.lowerBound.z) / 2;
          const reach = Math.max(0.05, inner - Math.max(hx, hz) * 0.9);
          const rho = rnd() < T.rimShare ? reach : reach * Math.pow(rnd(), T.centreBias);
          const ang = rnd() * Math.PI * 2;
          const px = Math.cos(ang) * rho;
          const pz = Math.sin(ang) * rho;
          // Just above whatever is already under its footprint (or the floor).
          let top = tray.floorY;
          for (const other of placed) {
            other.updateAABB();
            const a = other.aabb;
            if (a.lowerBound.x > px + hx || a.upperBound.x < px - hx || a.lowerBound.z > pz + hz || a.upperBound.z < pz - hz) continue;
            top = Math.max(top, a.upperBound.y);
          }
          body.position.set(px, top + T.dropGap - body.aabb.lowerBound.y, pz);
          w.addBody(body);
          placed.push(body);
        }
        for (let s = 0; s < T.batchSteps; s++) {
          w.step(1 / 60);
          yield;
        }
      }
      for (let s = 0; s < T.finalSteps; s++) {
        w.step(1 / 60);
        if (placed.every((b) => b.sleepState === CANNON.Body.SLEEPING)) break;
        yield;
      }
      // De-penetration: a few steps without gravity, so items still pressing into each other
      // (up to ~0.035 measured) are pushed apart by their contacts; then still.
      w.gravity.set(0, 0, 0);
      for (const b of placed) {
        b.velocity.set(0, 0, 0);
        b.angularVelocity.set(0, 0, 0);
        b.wakeUp();
      }
      for (let s = 0; s < T.depenetrateSteps; s++) {
        w.step(1 / 60);
        for (const b of placed) {
          b.velocity.scale(T.depenetrateDamping, b.velocity);
          b.angularVelocity.scale(T.depenetrateDamping, b.angularVelocity);
        }
        yield; // one step at a time (all items awake: the 24 steps in one go took ~80 ms, a jolt in the kitchen transition)
      }
      yield;
      // Store the resting poses (in the plate body's frame), out of the floor (a resting overlap here
      // would push the item and its plate apart the moment it wakes). One that rolled off stays beside the plate.
      for (const it of its) {
        const b = it._settleBody;
        b.updateAABB();
        const inBowl = Math.hypot(b.position.x, b.position.z) < tray.floorR;
        const ground = inBowl ? tray.floorY : tray.bottomY;
        if (b.aabb.lowerBound.y < ground) b.position.y += ground - b.aabb.lowerBound.y + 0.002;
        it.local.compose(_p.set(b.position.x, b.position.y, b.position.z), _q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w), _sv.setScalar(it.scale));
        it.homePlate = plate;
        it.homeLocal = it.local.clone(); // reused on "Race again"
        it._settleBody = null;
      }
    }
    settled = true;
    placeOnPlates();
  }
  let _job = null;
  /** Settle within a time budget per frame (the loader is up meanwhile). */
  async function settle(nextFrame) {
    if (settled) return;
    if (!_job) _job = settleJob();
    while (!settled) {
      const t0 = performance.now();
      while (!settled && performance.now() - t0 < F.settle.frameBudgetMs) {
        if (_job.next().done) break;
      }
      if (!settled) await nextFrame();
    }
  }

  // ---- Drawing ----
  function writeItem(it, mat) {
    for (const ref of it.refs) {
      ref.batch.mesh.setMatrixAt(ref.index, it.dropped ? _zero : mat);
      ref.batch.dirty = true;
    }
  }
  function drawItem(it, force = true) {
    const b = it.body;
    const VJ = F.visualJitter;
    const d = it._drawn;
    if (!force && d && b.velocity.length() < VJ.speed) {
      const dq = Math.abs(d.qx * b.quaternion.x + d.qy * b.quaternion.y + d.qz * b.quaternion.z + d.qw * b.quaternion.w);
      if (Math.hypot(b.position.x - d.x, b.position.y - d.y, b.position.z - d.z) < VJ.move && 2 * Math.acos(Math.min(1, dq)) < VJ.turn) return;
    }
    it._drawn = { x: b.position.x, y: b.position.y, z: b.position.z, qx: b.quaternion.x, qy: b.quaternion.y, qz: b.quaternion.z, qw: b.quaternion.w };
    _w.compose(_p.set(b.position.x, b.position.y, b.position.z), _q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w), _sv.setScalar(it.scale));
    writeItem(it, _w);
  }
  function flush() {
    for (const b of batches.values()) {
      if (b.dirty && b.mesh) {
        b.mesh.instanceMatrix.needsUpdate = true;
        b.dirty = false;
      }
    }
  }

  /**
   * Like the cup pyramid: every item is a dynamic body in the world from the
   * start, asleep at its settled pose on its plate (no jitter while asleep).
   * It wakes when something touches it (a car, its plate, another item) and
   * rests again through the physics' own sleep. Also used by "Race again".
   */
  /**
   * A plate at rest is static (as the table under it): a heap of food on a
   * light dynamic plate never settled (measured after a hit: the fruit sank up
   * to 0.19 into its plate's floor while the plate, 13 vs ~25 of fruit,
   * jittered on the table, and the two kept waking each other: 1,091
   * item-by-item and 229 item/plate wake-ups in 25 s). A car's push (or
   * another prop's) makes it dynamic again first (releasePlate); once it rests
   * again, it is held static.
   */
  function holdPlate(pl) {
    const b = pl.body;
    if (b.type === CANNON.Body.STATIC) return;
    pl.dynMass = b.mass;
    b.velocity.set(0, 0, 0);
    b.angularVelocity.set(0, 0, 0);
    b.type = CANNON.Body.STATIC;
    b.mass = 0;
    b.updateMassProperties();
    b.aabbNeedsUpdate = true;
  }
  function releasePlate(plateBody) {
    const pl = plateBody._foodPlate;
    if (!pl || plateBody.type !== CANNON.Body.STATIC) return;
    plateBody.type = CANNON.Body.DYNAMIC;
    plateBody.mass = pl.dynMass;
    plateBody.updateMassProperties();
    plateBody.wakeUp();
  }
  function placeOnPlates() {
    // The plates rest on the table already (placed there by the kitchen): held static, so the food
    // lies on a still plate (a car's push releases it).
    for (const pl of plates) holdPlate(pl);
    for (const it of items) {
      if (it.dropped) continue;
      const pb = it.homePlate.body;
      _m.compose(_p.set(pb.position.x, pb.position.y, pb.position.z), _q.set(pb.quaternion.x, pb.quaternion.y, pb.quaternion.z, pb.quaternion.w), _sv.set(1, 1, 1));
      _w.multiplyMatrices(_m, it.homeLocal);
      _w.decompose(_p, _q, _sv);
      const b = it.body;
      b.position.set(_p.x, _p.y, _p.z);
      b.quaternion.set(_q.x, _q.y, _q.z, _q.w);
      b.previousPosition.copy(b.position);
      b.interpolatedPosition.copy(b.position);
      b.velocity.set(0, 0, 0);
      b.angularVelocity.set(0, 0, 0);
      b.force.set(0, 0, 0);
      b.torque.set(0, 0, 0);
      b.aabbNeedsUpdate = true;
      if (!b.world) world.addBody(b);
      b.sleep();
      it.prev.copy(b.position);
      it._validPos = b.position.clone();
      it._wasAsleep = true;
      it._restAt = null;
      drawItem(it);
    }
    flush();
  }

  // ---- A car hit a plate: its food wakes (like the cup pyramid on a hit); the plate's motion does the rest ----
  function onPlateTouched(plateBody) {
    for (const it of items) {
      if (it.dropped || it.body.sleepState !== CANNON.Body.SLEEPING) continue;
      if (bowlOf(it.body.position) === plateBody._foodPlate) it.body.wakeUp();
    }
  }

  function capSpeed(b) {
    const h = Math.hypot(b.velocity.x, b.velocity.z);
    if (h > F.scatter.maxSpeed) {
      const k = F.scatter.maxSpeed / h;
      b.velocity.x *= k;
      b.velocity.z *= k;
    }
    if (Math.abs(b.velocity.y) > F.scatter.maxUp) b.velocity.y = Math.sign(b.velocity.y) * F.scatter.maxUp;
  }

  // ---- Car bumpers push the food (and are slowed a little) ----
  const _invQ = new CANNON.Quaternion();
  const _loc = new CANNON.Vec3();
  const _n = new CANNON.Vec3();
  const _sw = new CANNON.Vec3();
  function pushOutOfBumper(bb, st, dt) {
    if (!bb) return;
    const he = bb.shapes[0].halfExtents;
    const off = bb.shapeOffsets[0];
    bb.quaternion.conjugate(_invQ);
    for (const it of items) {
      if (it.dropped) continue;
      const b = it.body;
      let best = 0;
      let bnx = 0;
      let bnz = 0;
      for (let si = 0; si < b.shapes.length; si++) {
        // Shape centre in world, then in the bumper's frame.
        b.quaternion.vmult(b.shapeOffsets[si], _sw);
        _sw.vadd(b.position, _sw);
        _sw.vsub(bb.position, _loc);
        _invQ.vmult(_loc, _loc);
        _loc.vsub(off, _loc);
        const r = it.shapes[si].r;
        if (Math.abs(_loc.y) > he.y + r) continue;
        const cx = Math.max(-he.x, Math.min(he.x, _loc.x));
        const cz = Math.max(-he.z, Math.min(he.z, _loc.z));
        const dx = _loc.x - cx;
        const dz = _loc.z - cz;
        const d2 = dx * dx + dz * dz;
        let depth;
        let nx;
        let nz;
        if (d2 > 1e-10) {
          if (d2 >= r * r) continue;
          const d = Math.sqrt(d2);
          nx = dx / d;
          nz = dz / d;
          depth = r - d;
        } else {
          const px = he.x - Math.abs(_loc.x);
          const pz = he.z - Math.abs(_loc.z);
          if (px < pz) {
            nx = _loc.x < 0 ? -1 : 1;
            nz = 0;
            depth = px + r;
          } else {
            nx = 0;
            nz = _loc.z < 0 ? -1 : 1;
            depth = pz + r;
          }
        }
        if (depth > best) {
          best = depth;
          bnx = nx;
          bnz = nz;
        }
      }
      if (!(best > 0)) continue;
      _n.set(bnx, 0, bnz);
      bb.quaternion.vmult(_n, _n);
      const l = Math.hypot(_n.x, _n.z) || 1;
      const nx = _n.x / l;
      const nz = _n.z / l;
      b.position.x += nx * best;
      b.position.z += nz * best;
      const carVn = bb.velocity.x * nx + bb.velocity.z * nz;
      const vn = b.velocity.x * nx + b.velocity.z * nz;
      const want = Math.max(0, carVn) * F.carPushRestitution;
      if (vn < want) {
        b.velocity.x += nx * (want - vn);
        b.velocity.z += nz * (want - vn);
        capSpeed(b);
      }
      if (st) {
        const drag = F.carDrag * (b.mass / o.carMass) * dt;
        const sp = Math.abs(st.speed);
        st.speed = Math.sign(st.speed) * Math.max(0, sp - drag);
      }
      b.aabbNeedsUpdate = true;
      if (b.sleepState !== CANNON.Body.AWAKE) b.wakeUp();
    }
  }

  // ---- After each physics step: protections, then the visuals ----
  const _invPlate = new CANNON.Quaternion();
  const _rel = new CANNON.Vec3();
  /**
   * Going to sleep: never sunk into a plate's floor or the table (a heap's
   * weight can press its bottom layer in; asleep, it would stay there). Only
   * lifted straight up by the overlap.
   */
  function unsink(it) {
    const b = it.body;
    b.updateAABB();
    const low = b.aabb.lowerBound.y;
    const pl = bowlOf(b.position) || (() => {
      for (const q of plates) if (Math.hypot(b.position.x - q.body.position.x, b.position.z - q.body.position.z) < q.tray.floorR) return q;
      return null;
    })();
    let ground = null;
    if (pl) ground = pl.body.position.y + pl.tray.floorY;
    else {
      const T = o.getTable();
      if (T && Math.abs(b.position.x - T.cx) <= T.hx && Math.abs(b.position.z - T.cz) <= T.hz && b.position.y > T.top - 0.5) ground = T.top;
    }
    if (ground !== null && low < ground - F.sleepUnsinkTolerance) {
      b.position.y += ground - low;
      b.previousPosition.copy(b.position);
      b.interpolatedPosition.copy(b.position);
      b.aabbNeedsUpdate = true;
      it._drawnAsleep = false;
    }
  }
  // ---- Bowl volume (in a plate's frame): inner face and outer face radius at a height ----
  const _bw = new CANNON.Vec3();
  const _bq = new CANNON.Quaternion();
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  function bowlLocal(pl, pos, out) {
    pos.vsub(pl.body.position, out);
    pl.body.quaternion.conjugate(_bq);
    _bq.vmult(out, out);
    return out;
  }
  function innerAt(tr, y) {
    const t = clamp01((y - tr.floorY) / (tr.topY - tr.floorY));
    return (tr.floorR + (tr.topInnerR - tr.floorR) * t) * Math.cos(Math.PI / tr.segments) - tr.wallInset;
  }

  /** The plate whose bowl (inside its walls, below its rim) this centre is in. */
  function bowlOf(pos) {
    for (const pl of plates) {
      const L = bowlLocal(pl, pos, _bw);
      const tr = pl.tray;
      if (L.y >= tr.topY || L.y < tr.floorY - 0.1) continue;
      if (Math.hypot(L.x, L.z) < innerAt(tr, L.y)) return pl;
    }
    return null;
  }
  function finiteBody(b) {
    const R = F.recover;
    const p = b.position;
    const v = b.velocity;
    const w = b.angularVelocity;
    const q = b.quaternion;
    return (
      Number.isFinite(p.x + p.y + p.z + v.x + v.y + v.z + w.x + w.y + w.z + q.x + q.y + q.z + q.w) &&
      Math.abs(p.x) < R.maxCoord && Math.abs(p.y) < R.maxCoord && Math.abs(p.z) < R.maxCoord &&
      v.lengthSquared() < R.maxSpeed * R.maxSpeed
    );
  }
  /** Invalid state: back to its last valid spot (or above its plate), still. */
  function recoverBody(it) {
    const b = it.body;
    if (it._validPos) b.position.copy(it._validPos);
    else b.position.set(it.plate.body.position.x, it.plate.body.position.y + it.plate.tray.topY + 0.5, it.plate.body.position.z);
    const q = b.quaternion;
    if (!Number.isFinite(q.x + q.y + q.z + q.w) || q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w < 1e-6) q.set(0, 0, 0, 1);
    else q.normalize();
    b.velocity.set(0, 0, 0);
    b.angularVelocity.set(0, 0, 0);
    b.previousPosition.copy(b.position);
    b.interpolatedPosition.copy(b.position);
    b.aabbNeedsUpdate = true;
    it.prev.copy(b.position);
  }
  const r0 = (b) => b._minR || 0;
  let _lastUpdate = 0;
  /** Put an item and the slow food it touches (through the whole heap) to sleep where they are. */
  function sleepHeap(start) {
    const lim = F.heap.restInPlace.clusterSpeed;
    const stack = [start];
    const seen = new Set([start]);
    while (stack.length) {
      const it = stack.pop();
      const b = it.body;
      unsink(it);
      b.velocity.set(0, 0, 0);
      b.angularVelocity.set(0, 0, 0);
      b.sleep();
      it._restAt = null;
      it.prev.copy(b.position);
      for (const c of world.contacts) {
        const other = c.bi === b ? c.bj : c.bj === b ? c.bi : null;
        const oi = other && other._foodItem;
        if (!oi || seen.has(oi) || other.sleepState === CANNON.Body.SLEEPING) continue;
        if (other.velocity.length() > lim) continue;
        seen.add(oi);
        stack.push(oi);
      }
    }
  }
  function update() {
    const now = performance.now();
    const dt = _lastUpdate ? Math.min(0.1, (now - _lastUpdate) / 1000) : 0;
    _lastUpdate = now;
    if (!settled && plates.length) {
      // Safety: never shown unsettled (normally done during the loader).
      if (!_job) _job = settleJob();
      while (!_job.next().done);
    }
    const T = o.getTable();
    // The plates: never launched (see plateClamp); back to static once at rest (see holdPlate).
    for (const pl of plates) {
      const pb = pl.body;
      if (pb.type !== CANNON.Body.STATIC) {
        const PH = F.pile.plateHold;
        if (pb.velocity.length() < PH.speed && pb.angularVelocity.length() < PH.speed) pl._slowT = (pl._slowT || 0) + dt;
        else pl._slowT = 0;
        if (pb.sleepState === CANNON.Body.SLEEPING || pl._slowT > PH.time) {
          pl._slowT = 0;
          holdPlate(pl);
        }
      }
      // Invalid (NaN): back to where the level put it, still.
      if (!Number.isFinite(pb.position.x + pb.position.y + pb.position.z + pb.quaternion.w + pb.velocity.x + pb.velocity.y + pb.velocity.z + pb.angularVelocity.x + pb.angularVelocity.y + pb.angularVelocity.z) && pb._home) {
        pb.position.copy(pb._home.pos);
        pb.quaternion.copy(pb._home.quat);
        pb.velocity.set(0, 0, 0);
        pb.angularVelocity.set(0, 0, 0);
        pb.previousPosition.copy(pb.position);
        pb.interpolatedPosition.copy(pb.position);
        pb.aabbNeedsUpdate = true;
      }
      if (pb.sleepState === CANNON.Body.SLEEPING) continue;
      const C = F.plateClamp;
      if (pb.velocity.y > C.up) pb.velocity.y = C.up;
      const sw = pb.angularVelocity.length();
      if (sw > C.spin) pb.angularVelocity.scale(C.spin / sw, pb.angularVelocity);
      const sh = Math.hypot(pb.velocity.x, pb.velocity.z);
      if (sh > C.speed) {
        pb.velocity.x *= C.speed / sh;
        pb.velocity.z *= C.speed / sh;
      }
    }
    let pileAwake = false;
    for (const it of items) {
      if (it.dropped) continue;
      const b = it.body;
      if (b.sleepState === CANNON.Body.SLEEPING) {
        // Just fell asleep (the physics' own sleep): out of any floor first.
        if (!it._wasAsleep) unsink(it);
        it._wasAsleep = true;
        it.prev.copy(b.position);
        continue;
      }
      if (it._wasAsleep !== false) it._wokeAt = now;
      it._wasAsleep = false;
      // Inside a plate: damping ramps up after waking (see pile.calm); normal elsewhere.
      {
        const PC = F.pile.calm;
        const base = kindDefs[it.kindName];
        const lin0 = CUP.linearDamping;
        const ang0 = base.rolls ? F.heap.rollingAngularDamping : CUP.angularDamping;
        if (bowlOf(b.position)) {
          const k = Math.min(1, (now - (it._wokeAt || now)) / 1000 / PC.rampTime);
          b.linearDamping = Math.min(PC.maxDamping, lin0 + PC.extraLinear * k);
          b.angularDamping = Math.min(PC.maxDamping, ang0 + PC.extraAngular * k);
          pileAwake = true;
        } else {
          b.linearDamping = lin0;
          b.angularDamping = ang0;
        }
      }
      if (!finiteBody(b)) recoverBody(it);
      capSpeed(b);
      // Still in one spot for a while (only trembling): asleep where it is, with its heap (see heap).
      const RP = F.heap.restInPlace;
      if (!it._restAt || b.position.distanceTo(it._restAt) > RP.drift) {
        it._restAt = b.position.clone();
        it._restT = 0;
      } else if ((it._restT += dt) > RP.time) {
        sleepHeap(it);
        continue;
      }
      b.updateAABB();
      let low = b.aabb.lowerBound.y;
      // Kept on the table (see tableEdge).
      if (T && b.position.y > T.top - 0.5 && b.position.y < T.top + 6) {
        const E = F.tableEdge;
        const ex = Math.abs(b.position.x - T.cx) - (T.hx - E.margin);
        const ez = Math.abs(b.position.z - T.cz) - (T.hz - E.margin);
        if (ex > 0 && ex < 1.5) {
          const sx = Math.sign(b.position.x - T.cx);
          b.position.x -= sx * ex;
          if (b.velocity.x * sx > 0) b.velocity.x = -b.velocity.x * E.bounce;
        }
        if (ez > 0 && ez < 1.5) {
          const sz = Math.sign(b.position.z - T.cz);
          b.position.z -= sz * ez;
          if (b.velocity.z * sz > 0) b.velocity.z = -b.velocity.z * E.bounce;
        }
      }
      // In a plate (its floor holds it: the table check below doesn't apply there).
      const inPlate = !!bowlOf(b.position);
      // Never below the table top (judged by the centre; the edge check above keeps food on the table);
      // inside a plate, its floor's check above applies instead.
      if (!inPlate && T && Math.abs(b.position.x - T.cx) <= T.hx && Math.abs(b.position.z - T.cz) <= T.hz && b.position.y > T.top - 0.5) {
        if (low < T.top - F.sinkTolerance) {
          b.position.y += Math.min(F.netStep, T.top - low);
          b.updateAABB();
          low = b.aabb.lowerBound.y;
          if (b.velocity.y < 0) b.velocity.y = 0;
        }
      }
      // Never under the kitchen floor (and never off its edge).
      const FL = o.getFloor && o.getFloor();
      if (FL) {
        if (low < FL.top - F.recover.floorTolerance) {
          b.position.y += FL.top - low;
          low = FL.top;
          if (b.velocity.y < 0) b.velocity.y = 0;
        }
        const ex = Math.abs(b.position.x - FL.cx) - (FL.hx - r0(b));
        const ez = Math.abs(b.position.z - FL.cz) - (FL.hz - r0(b));
        if (ex > 0) {
          b.position.x -= Math.sign(b.position.x - FL.cx) * ex;
          b.velocity.x = 0;
        }
        if (ez > 0) {
          b.position.z -= Math.sign(b.position.z - FL.cz) * ez;
          b.velocity.z = 0;
        }
      }
      it.prev.copy(b.position);
      b.aabbNeedsUpdate = true;
      if (finiteBody(b)) (it._validPos || (it._validPos = new CANNON.Vec3())).copy(b.position);
    }
    // A pile settling in a plate: more solver iterations meanwhile (see pile.iterations).
    if (pileAwake && !_boostFrom) {
      _boostFrom = world.solver.iterations;
      world.solver.iterations = Math.max(_boostFrom, F.pile.iterations);
    } else if (!pileAwake && _boostFrom) {
      world.solver.iterations = _boostFrom;
      _boostFrom = 0;
    }
    // Visuals (a sleeping item is drawn once, then left alone; tiny moves of an almost resting one are skipped).
    for (const it of items) {
      if (it.dropped) continue;
      const asleep = it.body.sleepState === CANNON.Body.SLEEPING;
      if (asleep && it._drawnAsleep) continue;
      it._drawnAsleep = asleep;
      drawItem(it, asleep);
    }
    flush();
  }

  function moving() {
    for (const it of items) {
      if (it.dropped) continue;
      const b = it.body;
      if (b.sleepState === CANNON.Body.SLEEPING) continue;
      if (b.velocity.lengthSquared() > 0.01 || b.angularVelocity.lengthSquared() > 0.01) return true;
    }
    return false;
  }

  /** "Race again": every item back to its settled pose on its own plate, asleep (the plates are reset by the kitchen first). */
  function reset() {
    if (!settled) return;
    for (const it of items) it._drawnAsleep = false;
    placeOnPlates();
  }

  return {
    setup,
    settle,
    onPlateTouched,
    pushOutOfBumper,
    update,
    moving,
    reset,
    releasePlate,
    /** Physics steps per 1/60 s: more while a pile settles in a plate (see pile.substeps). */
    substeps: () => (_boostFrom ? F.pile.substeps : 1),
    get settled() {
      return settled;
    },
    get items() {
      return items;
    },
    get plates() {
      return plates;
    },
  };
}
