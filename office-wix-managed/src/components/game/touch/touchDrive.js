/**
 * Touch driving (phones / tablets), shared by every level: one finger drags
 * anywhere and the car drives toward it; a quick tap on the car does the
 * Space action (brake). It only writes the level's own `keys` object (the same
 * forward / reverse / left / right / brake flags the keyboard sets), so the
 * car's physics, the intros / countdown gating and everything else stay as
 * they are. The keyboard keeps working everywhere.
 *
 * Steering: the finger's point on the car's driving plane, compared with the
 * car's heading (forward = sin(angle), cos(angle); "left" turns the angle up).
 * Throttle: the finger's on-screen distance from the car, as a duty cycle on
 * `forward` (the physics only knows full / off). A finger behind the car makes
 * it turn around (full steer, driving forward), like an RC car; it never
 * reverses on its own.
 */
import "./touch.css";

/** Tuning (distances are shares of the screen's shorter side). */
export const TOUCH_DRIVE = {
  deadZone: 0.06, // finger this close to the car: no throttle
  fullThrottleAt: 0.32, // finger this far: full speed
  minThrottle: 0.35, // throttle just past the dead zone
  steerDeadDeg: 7, // heading error under this: drive straight
  steerHoldDeg: 3, // …and once steering, keep it until under this (no flicker)
  behindDeg: 160, // finger this far behind: keep turning the same way
  aimSmooth: 14, // finger aim smoothing (1/s; higher = snappier)
  tapMaxMs: 220, // a tap: shorter than this…
  tapMaxMovePx: 12, // …and moving less than this
  tapBrakeSec: 0.45, // the Space action from a tap: brake held this long
  ringPx: 44, // feedback ring size under the finger
};

const TOUCH_EVENT = "wx-touch-drive"; // window event: { kind: "drive", dt } | { kind: "tap" }

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

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const DEG = Math.PI / 180;

/**
 * @param {object} o
 * @param {typeof import("three")} o.THREE
 * @param {HTMLElement} o.mount      the level's mount (touches on the UI above it never reach it)
 * @param {() => import("three").Camera} o.getCamera
 * @param {() => import("three").Object3D|null} o.getCar   the player's car (position, raycast target)
 * @param {() => number} o.getAngle   the car's heading (carState.angle)
 * @param {() => object} o.getKeys    the input object the keyboard writes
 * @param {() => boolean} o.enabled   the player may drive now (scene running, intro over)
 */
export function createTouchDrive(o) {
  const { THREE, mount } = o;
  const T = TOUCH_DRIVE;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const carWorld = new THREE.Vector3();
  const hit = new THREE.Vector3();
  const aimLocal = new THREE.Vector3();
  const proj = new THREE.Vector3();

  // Feedback: a white outline ring under the finger and a faint line from the car.
  const fx = document.createElement("div");
  fx.className = "wx-touch-fx";
  fx.setAttribute("aria-hidden", "true");
  fx.innerHTML = `<svg class="wx-touch-line"><line x1="0" y1="0" x2="0" y2="0" /></svg><span class="wx-touch-ring"></span>`;
  const ring = fx.querySelector(".wx-touch-ring");
  const line = fx.querySelector("line");
  mount.appendChild(fx);

  let touch = null; // { id, x, y, x0, y0, t0, driving }
  let raf = 0;
  let last = 0;
  let aimAngle = null; // smoothed target heading (radians)
  let steer = 0; // -1 right, 0, 1 left
  let duty = 0; // throttle duty accumulator
  let brakeLeft = 0;
  let wrote = false; // we set flags this touch (so release clears only ours)

  const rect = () => mount.getBoundingClientRect();
  const keys = () => o.getKeys && o.getKeys();

  function setKeys(fwd, left, right, brake) {
    const k = keys();
    if (!k) return;
    k.forward = fwd;
    k.left = left;
    k.right = right;
    k.brake = brake;
    wrote = true;
  }

  function release() {
    if (wrote) setKeys(false, false, false, brakeLeft > 0);
    wrote = brakeLeft > 0;
    touch = null;
    aimAngle = null;
    steer = 0;
    duty = 0;
    fx.classList.remove("is-on");
  }

  function carOnScreen(r) {
    const car = o.getCar();
    const cam = o.getCamera();
    if (!car || !cam) return null;
    car.getWorldPosition(carWorld);
    proj.copy(carWorld).project(cam);
    return { x: (proj.x * 0.5 + 0.5) * r.width, y: (-proj.y * 0.5 + 0.5) * r.height };
  }

  function rayFrom(x, y, r) {
    ndc.set((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, o.getCamera());
  }

  function tapHitsCar(x, y) {
    const car = o.getCar();
    if (!car || !o.getCamera()) return false;
    const r = rect();
    rayFrom(x - r.left, y - r.top, r);
    return raycaster.intersectObject(car, true).length > 0;
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
    if (touch && touch.driving && o.enabled()) drive(dt);
    else if (touch && touch.driving) {
      // Not allowed right now (e.g. the level paused): hold nothing.
      setKeys(false, false, false, brakeLeft > 0);
      fx.classList.remove("is-on");
    }
    if (touch || brakeLeft > 0) raf = requestAnimationFrame(step);
  }

  function drive(dt) {
    const r = rect();
    const fx0 = touch.x - r.left;
    const fy0 = touch.y - r.top;
    const c = carOnScreen(r);
    const car = o.getCar();
    if (!c || !car) return;
    // Feedback.
    fx.classList.add("is-on");
    ring.style.transform = `translate(${fx0}px, ${fy0}px)`;
    line.setAttribute("x1", c.x.toFixed(1));
    line.setAttribute("y1", c.y.toFixed(1));
    line.setAttribute("x2", fx0.toFixed(1));
    line.setAttribute("y2", fy0.toFixed(1));

    // Throttle from the on-screen distance.
    const minSide = Math.max(1, Math.min(r.width, r.height));
    const dist = Math.hypot(fx0 - c.x, fy0 - c.y) / minSide;
    let throttle = 0;
    if (dist > T.deadZone) {
      const k = Math.min(1, (dist - T.deadZone) / Math.max(1e-3, T.fullThrottleAt - T.deadZone));
      throttle = T.minThrottle + (1 - T.minThrottle) * k;
    }

    // Aim: the finger's point on the car's driving plane, in the car's parent space.
    plane.constant = -carWorld.y;
    rayFrom(fx0, fy0, r);
    let left = false;
    let right = false;
    if (raycaster.ray.intersectPlane(plane, hit)) {
      aimLocal.copy(hit);
      if (car.parent) car.parent.worldToLocal(aimLocal);
      const dx = aimLocal.x - car.position.x;
      const dz = aimLocal.z - car.position.z;
      if (dx * dx + dz * dz > 1e-8) {
        const target = Math.atan2(dx, dz);
        aimAngle = aimAngle === null ? target : aimAngle + wrapAngle(target - aimAngle) * (1 - Math.exp(-T.aimSmooth * dt));
        const err = wrapAngle(aimAngle - o.getAngle());
        const a = Math.abs(err);
        if (a > T.behindDeg * DEG && steer !== 0) {
          // Straight behind: keep turning the way it already turns.
        } else if (a > T.steerDeadDeg * DEG || (steer !== 0 && a > T.steerHoldDeg * DEG)) {
          steer = err > 0 ? 1 : -1;
        } else {
          steer = 0;
        }
        left = steer > 0;
        right = steer < 0;
      }
    }
    // Duty cycle: forward is on for `throttle` of the frames.
    let fwd = false;
    if (throttle >= 0.97) fwd = true;
    else if (throttle > 0) {
      duty += throttle;
      if (duty >= 1) {
        duty -= 1;
        fwd = true;
      }
    }
    setKeys(fwd, left && throttle > 0, right && throttle > 0, brakeLeft > 0);
    window.dispatchEvent(new CustomEvent(TOUCH_EVENT, { detail: { kind: "drive", dt: fwd || throttle > 0 ? dt : 0 } }));
  }

  function kick() {
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(step);
    }
  }

  // Capture on the mount: runs before the canvas's own handlers (e.g. orbit
  // controls), so a driving finger never also moves the camera.
  const onDown = (e) => {
    if (e.pointerType !== "touch") return;
    // Only touches on the 3D view drive (the menu, buttons and popups sit above it).
    if (!(e.target instanceof HTMLCanvasElement)) return;
    if (touch) {
      // Only the first finger drives; others are ignored.
      e.stopPropagation();
      return;
    }
    if (!o.enabled()) return;
    e.stopPropagation();
    e.preventDefault();
    touch = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), driving: false };
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
    if (!touch.driving && Math.hypot(touch.x - touch.x0, touch.y - touch.y0) > T.tapMaxMovePx) touch.driving = true;
  };
  const onUp = (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    const quick = performance.now() - touch.t0 < T.tapMaxMs;
    const still = Math.hypot(e.clientX - touch.x0, e.clientY - touch.y0) <= T.tapMaxMovePx;
    const wasDriving = touch.driving;
    release();
    if (e.type === "pointerup" && !wasDriving && quick && still && o.enabled() && tapHitsCar(e.clientX, e.clientY)) {
      brakeLeft = T.tapBrakeSec;
      const k = keys();
      if (k) {
        k.brake = true;
        wrote = true;
      }
      window.dispatchEvent(new CustomEvent(TOUCH_EVENT, { detail: { kind: "tap" } }));
      kick();
    }
  };
  // A finger held still past the tap time starts driving too.
  const holdCheck = window.setInterval(() => {
    if (touch && !touch.driving && performance.now() - touch.t0 >= T.tapMaxMs) touch.driving = true;
  }, 50);
  const noMenu = (e) => {
    if (touch || (e.pointerType === "touch")) e.preventDefault();
  };

  mount.addEventListener("pointerdown", onDown, { capture: true, passive: false });
  mount.addEventListener("pointermove", onMove, { capture: true, passive: false });
  mount.addEventListener("pointerup", onUp, true);
  mount.addEventListener("pointercancel", onUp, true);
  mount.addEventListener("contextmenu", noMenu, true);
  mount.classList.add("wx-touch-surface");

  return {
    /** Let go (e.g. the menu opened or the level left). */
    release() {
      release();
    },
    dispose() {
      release();
      window.clearInterval(holdCheck);
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
