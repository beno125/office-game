/**
 * Touch driving (phones / tablets), shared by every level. Same logic and
 * values as Bruno Simon's folio-2025 "Nipple" input (MIT,
 * github.com/brunosimon/folio-2025, sources/Game/Inputs/Nipple.js + Player.js),
 * adapted to our cars:
 *
 * - The control is anchored on the car. The finger is projected onto the
 *   ground at the car's height; the direction car → finger is where the car
 *   steers, the distance sets the speed.
 * - Speed: progress = (distance − inner) / (outer − inner), clamped 0..1, then
 *   cubed (inner / outer radii in car lengths: 2 / 4.5 on a ~2.9-long car).
 * - Steering: full lock once the finger is 45° off the heading (gradual below).
 * - Reverse: a finger within ±45° behind the car drives backward (steering
 *   flipped like a real car). Hysteresis added: back to forward only past 53°.
 * - Tap: a touch that starts inside the inner radius and never leaves it is a
 *   tap on the car → the level's Space action (brake).
 * - A second finger is ignored (never breaks the drive).
 *
 * Our physics only reads on / off flags, so the amounts become duty cycles on
 * the same `keys` the keyboard writes (forward / reverse / left / right /
 * brake): the car behaves exactly as with the keyboard. Reverse uses the
 * `reverse` flag, so the car brakes first and then backs up, like holding Down.
 */
import "./touch.css";

/** Control values (reference values; radii in car lengths). */
export const TOUCH_DRIVE = {
  innerRadius: 0.7, // dead zone + tap zone around the car (reference: 2 world units)
  outerRadius: 1.55, // full speed here (reference: 4.5)
  speedCurve: 3, // progress^3 (reference)
  fullSteerDeg: 45, // full steering lock at this heading error (reference: (360° − 270°) / 2)
  reverseConeDeg: 45, // finger within ± this behind the car → reverse (reference: forward arc 270°)
  reverseHysteresisDeg: 8, // once reversing, stay until the finger is past cone + this
  fullDuty: 0.97, // a duty above this holds the key down
  tapBrakeSec: 0.45, // Space action from a tap: brake held this long
};

/** Visual values (screen px / seconds). */
export const TOUCH_VISUAL = {
  ringSegments: 64, // ground ring resolution
  knobRadius: 13,
  litArcDeg: 70, // lit part of the ring toward the drag (forward)
  reverseArcDeg: 90, // lit back arc while reversing (the reverse cone)
  fadeSec: 0.18,
};

const TOUCH_EVENT = "wx-touch-drive"; // window event: { kind: "drive", dt, reverse } | { kind: "tap" }
const DEG = Math.PI / 180;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** True on phones / tablets (a coarse pointer without hover). */
export function isTouchDevice() {
  if (typeof window === "undefined") return false;
  const mq = (q) => window.matchMedia && window.matchMedia(q).matches;
  return mq("(hover: none) and (pointer: coarse)") || (navigator.maxTouchPoints > 0 && mq("(pointer: coarse)"));
}

/** Listen to touch driving activity (for the touch controls guide). */
export function onTouchDrive(fn) {
  const h = (e) => fn(e.detail);
  window.addEventListener(TOUCH_EVENT, h);
  return () => window.removeEventListener(TOUCH_EVENT, h);
}

/**
 * @param {object} o
 * @param {typeof import("three")} o.THREE
 * @param {HTMLElement} o.mount       the level's mount (touches on the UI above it never reach it)
 * @param {() => import("three").Camera} o.getCamera
 * @param {() => import("three").Object3D|null} o.getCar   the player's car
 * @param {() => number} o.getAngle    the car's heading (carState.angle; forward = sin, cos; "left" turns it up)
 * @param {() => number} o.getCarLength the car's length in world units
 * @param {() => object} o.getKeys     the input object the keyboard writes
 * @param {() => boolean} o.enabled    the player may drive now (scene running, intro over)
 */
export function createTouchDrive(o) {
  const { THREE, mount } = o;
  const T = TOUCH_DRIVE;
  const V = TOUCH_VISUAL;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const carWorld = new THREE.Vector3();
  const hit = new THREE.Vector3();
  const local = new THREE.Vector3();
  const p3 = new THREE.Vector3();

  // ---- Visual: ground ring around the car + a knob under the finger (SVG) ----
  const fx = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  fx.setAttribute("class", "wx-touch-fx");
  fx.setAttribute("aria-hidden", "true");
  fx.innerHTML =
    '<path class="wx-touch-inner" /><path class="wx-touch-ring" /><path class="wx-touch-lit" />' +
    '<circle class="wx-touch-knob" r="' + V.knobRadius + '" />';
  const innerPath = fx.querySelector(".wx-touch-inner");
  const ringPath = fx.querySelector(".wx-touch-ring");
  const litPath = fx.querySelector(".wx-touch-lit");
  const knob = fx.querySelector(".wx-touch-knob");
  mount.appendChild(fx);

  let touch = null; // { id, x, y, tapCandidate }
  let raf = 0;
  let last = 0;
  let reversing = false;
  let dutyThrottle = 0;
  let dutySteer = 0;
  let brakeLeft = 0;
  let wrote = false;
  let state = null; // last computed drive state (for the visual)

  const rect = () => mount.getBoundingClientRect();
  const keys = () => o.getKeys && o.getKeys();
  const carLength = () => Math.max(1e-4, o.getCarLength ? o.getCarLength() : 1);

  function setKeys(fwd, rev, left, right) {
    const k = keys();
    if (!k) return;
    k.forward = fwd;
    k.reverse = rev;
    k.left = left;
    k.right = right;
    k.brake = brakeLeft > 0;
    wrote = true;
  }

  function release() {
    if (wrote) setKeys(false, false, false, false);
    wrote = brakeLeft > 0;
    touch = null;
    reversing = false;
    dutyThrottle = 0;
    dutySteer = 0;
    state = null;
    fx.classList.remove("is-on");
  }

  /** Finger (client px) → point on the car's ground plane, in the car's parent space. */
  function groundPoint(clientX, clientY, r, out) {
    const car = o.getCar();
    const cam = o.getCamera();
    if (!car || !cam) return false;
    car.getWorldPosition(carWorld);
    plane.constant = -carWorld.y;
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, cam);
    if (!raycaster.ray.intersectPlane(plane, hit)) return false;
    out.copy(hit);
    if (car.parent) car.parent.worldToLocal(out);
    return true;
  }

  /** The drive from the current finger: progress, heading error, reverse. */
  function compute(r) {
    const car = o.getCar();
    if (!car || !groundPoint(touch.x, touch.y, r, local)) return null;
    const dx = local.x - car.position.x;
    const dz = local.z - car.position.z;
    const L = carLength();
    const inner = T.innerRadius * L;
    const outer = T.outerRadius * L;
    const dist = Math.hypot(dx, dz);
    const progress = Math.min(1, Math.max(0, (dist - inner) / (outer - inner)));
    const heading = o.getAngle();
    const target = Math.atan2(dx, dz);
    const delta = wrapAngle(target - heading);
    // Reverse cone behind the car, with hysteresis.
    const behind = Math.PI - Math.abs(delta); // 0 = straight behind
    const limit = (T.reverseConeDeg + (reversing ? T.reverseHysteresisDeg : 0)) * DEG;
    if (progress > 0) reversing = behind < limit;
    // Steering amount: full lock at fullSteerDeg (measured from the rear when reversing).
    const err = reversing ? wrapAngle(target - (heading + Math.PI)) : delta;
    const steerAmount = Math.min(1, Math.abs(err) / (T.fullSteerDeg * DEG));
    // Forward: err > 0 → "left" turns the heading up. Reverse: the opposite key.
    const steerLeft = reversing ? err < 0 : err > 0;
    return { progress, speed: Math.pow(progress, T.speedCurve), steerAmount, steerLeft, target, heading, inner, outer, dist };
  }

  function duty(acc, amount) {
    if (amount >= T.fullDuty) return [acc, true];
    if (amount <= 0) return [acc, false];
    acc += amount;
    if (acc >= 1) return [acc - 1, true];
    return [acc, false];
  }

  function step(now) {
    raf = 0;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (brakeLeft > 0) {
      brakeLeft -= dt;
      if (brakeLeft <= 0 && keys()) {
        keys().brake = false;
        if (!touch) wrote = false;
      }
    }
    if (touch && o.enabled()) {
      const r = rect();
      state = compute(r);
      if (state) {
        if (state.progress > 0) touch.tapCandidate = false;
        let fwd = false;
        let steer = false;
        [dutyThrottle, fwd] = duty(dutyThrottle, state.speed);
        [dutySteer, steer] = duty(dutySteer, state.progress > 0 ? state.steerAmount : 0);
        setKeys(fwd && !reversing, fwd && reversing, steer && state.steerLeft, steer && !state.steerLeft);
        draw(r);
        if (state.progress > 0) {
          window.dispatchEvent(new CustomEvent(TOUCH_EVENT, { detail: { kind: "drive", dt, reverse: reversing } }));
        }
      }
    } else if (touch) {
      // Not allowed right now (paused, intro…): hold nothing.
      setKeys(false, false, false, false);
      fx.classList.remove("is-on");
    }
    if (touch || brakeLeft > 0) raf = requestAnimationFrame(step);
  }

  // ---- Drawing (projected ground ring, lit arc, knob) ----
  function toScreen(x, z, r) {
    const car = o.getCar();
    p3.set(x, car.position.y, z);
    if (car.parent) car.parent.localToWorld(p3);
    p3.project(o.getCamera());
    return [((p3.x * 0.5 + 0.5) * r.width).toFixed(1), ((-p3.y * 0.5 + 0.5) * r.height).toFixed(1)];
  }
  function arcPath(radius, from, to, r, closed) {
    const car = o.getCar();
    const n = Math.max(4, Math.round((V.ringSegments * (to - from)) / (Math.PI * 2)));
    let d = "";
    for (let i = 0; i <= n; i++) {
      const a = from + ((to - from) * i) / n;
      const [sx, sy] = toScreen(car.position.x + Math.sin(a) * radius, car.position.z + Math.cos(a) * radius, r);
      d += (i ? "L" : "M") + sx + " " + sy;
    }
    return d + (closed ? "Z" : "");
  }
  function draw(r) {
    const s = state;
    const car = o.getCar();
    fx.classList.add("is-on");
    fx.style.setProperty("--wx-touch-power", s.progress.toFixed(3));
    fx.classList.toggle("is-reverse", reversing && s.progress > 0);
    fx.classList.toggle("is-driving", s.progress > 0);
    innerPath.setAttribute("d", arcPath(s.inner, 0, Math.PI * 2, r, true));
    ringPath.setAttribute("d", arcPath(s.outer, 0, Math.PI * 2, r, true));
    if (s.progress > 0) {
      const half = (reversing ? V.reverseArcDeg : V.litArcDeg) * 0.5 * DEG;
      const centre = reversing ? s.heading + Math.PI : s.target;
      litPath.setAttribute("d", arcPath(s.outer, centre - half, centre + half, r, false));
    } else litPath.setAttribute("d", "");
    // Knob: the finger, held inside the ring.
    const k = Math.min(1, s.outer / Math.max(1e-6, s.dist));
    const kx = car.position.x + (local.x - car.position.x) * k;
    const kz = car.position.z + (local.z - car.position.z) * k;
    const [sx, sy] = toScreen(kx, kz, r);
    knob.setAttribute("cx", sx);
    knob.setAttribute("cy", sy);
  }

  function kick() {
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(step);
    }
  }

  // Capture on the mount: before the canvas's own handlers, so a driving finger
  // never also moves a camera.
  const onDown = (e) => {
    if (e.pointerType !== "touch") return;
    if (!(e.target instanceof HTMLCanvasElement)) return; // the UI above the view never drives
    if (touch) {
      e.stopPropagation(); // a second finger is ignored
      e.preventDefault();
      return;
    }
    if (!o.enabled()) return;
    e.stopPropagation();
    e.preventDefault();
    touch = { id: e.pointerId, x: e.clientX, y: e.clientY, tapCandidate: false };
    // A tap must start inside the inner radius (on / right around the car).
    const car = o.getCar();
    if (car && groundPoint(e.clientX, e.clientY, rect(), local)) {
      const d = Math.hypot(local.x - car.position.x, local.z - car.position.z);
      touch.tapCandidate = d <= T.innerRadius * carLength();
    }
    try {
      mount.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable: moves still arrive on the mount */
    }
    kick();
  };
  const onMove = (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    e.preventDefault();
    touch.x = e.clientX;
    touch.y = e.clientY;
  };
  const onUp = (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    const tap = e.type === "pointerup" && touch.tapCandidate && o.enabled();
    release();
    if (tap) {
      brakeLeft = T.tapBrakeSec;
      const k = keys();
      if (k) {
        k.brake = true;
        wrote = true;
      }
      fx.classList.remove("is-tap");
      void fx.getBoundingClientRect();
      fx.classList.add("is-tap");
      window.dispatchEvent(new CustomEvent(TOUCH_EVENT, { detail: { kind: "tap" } }));
      kick();
    }
  };
  const noMenu = (e) => {
    if (touch || e.pointerType === "touch") e.preventDefault();
  };

  mount.addEventListener("pointerdown", onDown, { capture: true, passive: false });
  mount.addEventListener("pointermove", onMove, { capture: true, passive: false });
  mount.addEventListener("pointerup", onUp, true);
  mount.addEventListener("pointercancel", onUp, true);
  mount.addEventListener("contextmenu", noMenu, true);
  mount.classList.add("wx-touch-surface");

  return {
    release() {
      release();
    },
    dispose() {
      release();
      if (raf) cancelAnimationFrame(raf);
      mount.removeEventListener("pointerdown", onDown, true);
      mount.removeEventListener("pointermove", onMove, true);
      mount.removeEventListener("pointerup", onUp, true);
      mount.removeEventListener("pointercancel", onUp, true);
      mount.removeEventListener("contextmenu", noMenu, true);
      mount.classList.remove("wx-touch-surface");
      fx.remove();
    },
  };
}
