/**
 * Shared "drag the camera" for every 3D scene (desktop mouse only).
 *
 * Holding the mouse button on the game canvas and dragging orbits the camera
 * around its target (horizontal: yaw, vertical: pitch), as an offset on top of
 * whatever the scene does with its camera that frame (it keeps following the
 * car). The drag has a rubber-band resistance: almost free at first, then each
 * extra pixel moves it less, toward a soft maximum it never passes (a tanh
 * curve, no hard stop). On release, a damped spring brings the offset back to
 * zero: a quick pull, a small overshoot, then exactly zero (the camera is
 * then identical to the scene's own).
 *
 * Use per frame:  drag.update(dt); drag.apply(camera, target); render; drag.restore(camera);
 * (apply / restore leave the scene's own camera logic untouched).
 */

/** Defaults (angles in degrees). */
export const CAMERA_DRAG = {
  /** Degrees of (unresisted) orbit per pixel dragged. */
  sensitivity: 0.22,
  /** Soft maximum offsets (never passed). */
  maxYaw: 40,
  maxPitch: 17,
  /**
   * Resistance curve: offset = max · tanh(drag / (max · resistance)).
   * 1: the first part of the drag moves it 1:1; higher: resistance starts earlier.
   */
  resistance: 1.15,
  /** The orbit never goes below / above these elevations (degrees above the target's horizon). */
  minElevation: 3,
  maxElevation: 78,
  /** Spring back: stiffness (1/s²) and damping ratio (1 critical; a little under for a small overshoot). */
  spring: { stiffness: 150, dampingRatio: 0.72 },
  /** Settled when both the offset (degrees) and its speed (degrees / s) are below these: then exactly zero. */
  settle: { offset: 0.01, speed: 0.05 },
  /** Never through walls / objects: pulled in to this far in front of what's in the way (world units). */
  collisionMargin: 0.25,
};

/**
 * Per-scene overrides (merged over CAMERA_DRAG). The transitions turn less
 * (the sign is never seen from the side or behind).
 */
export const CAMERA_DRAG_SCENES = {
  office: {},
  kitchen: {},
  meetingRoom: {},
  kitchenTransition: { maxYaw: 28, maxPitch: 12, minElevation: -40, maxElevation: 40 },
  signTransition: { maxYaw: 22, maxPitch: 10, minElevation: -30, maxElevation: 30 },
};

const DEG = Math.PI / 180;

/**
 * @param {object} o
 * @param {typeof import("three")} o.THREE
 * @param {HTMLElement} o.element      the canvas the drag starts on
 * @param {string} o.scene             a key of CAMERA_DRAG_SCENES
 * @param {() => boolean} [o.isEnabled]  false: no new drag, a running one is released (springs back)
 * @param {() => import("three").Object3D[]} [o.collisionObjects]  what the camera may not pass through
 * @param {(obj: import("three").Object3D) => boolean} [o.ignore]  objects the camera may pass (e.g. the car it orbits)
 */
export function createCameraDrag(o) {
  const { THREE, element } = o;
  const C = { ...CAMERA_DRAG, ...(CAMERA_DRAG_SCENES[o.scene] || {}) };
  C.spring = { ...CAMERA_DRAG.spring, ...((CAMERA_DRAG_SCENES[o.scene] || {}).spring || {}) };
  const isEnabled = o.isEnabled || (() => true);
  const touchOnly =
    typeof window !== "undefined" && window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches;

  // Offsets (degrees) and spring speeds; raw = the unresisted drag (degrees).
  const st = { yaw: 0, pitch: 0, vYaw: 0, vPitch: 0, rawYaw: 0, rawPitch: 0, dragging: false, pointerId: -1, lastX: 0, lastY: 0 };

  const rubber = (raw, max) => max * Math.tanh(raw / (max * C.resistance));
  const unrubber = (off, max) => {
    const r = Math.max(-0.999, Math.min(0.999, off / max));
    return Math.atanh(r) * max * C.resistance;
  };

  function onDown(e) {
    if (touchOnly || e.pointerType !== "mouse" || e.button !== 0 || !isEnabled()) return;
    st.dragging = true;
    st.pointerId = e.pointerId;
    st.lastX = e.clientX;
    st.lastY = e.clientY;
    // Grabbed during the spring back: carry on from the current offset (no jump).
    st.rawYaw = unrubber(st.yaw, C.maxYaw);
    st.rawPitch = unrubber(st.pitch, C.maxPitch);
    st.vYaw = 0;
    st.vPitch = 0;
    try {
      element.setPointerCapture(e.pointerId);
    } catch (err) {}
    element.style.cursor = "grabbing";
  }
  function onMove(e) {
    if (!st.dragging || e.pointerId !== st.pointerId) return;
    if (!isEnabled()) return release();
    const dx = e.clientX - st.lastX;
    const dy = e.clientY - st.lastY;
    st.lastX = e.clientX;
    st.lastY = e.clientY;
    st.rawYaw -= dx * C.sensitivity; // drag right: the view turns right (the camera orbits left)
    st.rawPitch += dy * C.sensitivity; // drag down: the camera rises (looks down more)
    st.yaw = rubber(st.rawYaw, C.maxYaw);
    st.pitch = rubber(st.rawPitch, C.maxPitch);
  }
  function release() {
    if (!st.dragging) return;
    st.dragging = false;
    try {
      if (element.hasPointerCapture && element.hasPointerCapture(st.pointerId)) element.releasePointerCapture(st.pointerId);
    } catch (err) {}
    st.pointerId = -1;
    element.style.cursor = "";
  }
  function onUp(e) {
    if (e.pointerId === st.pointerId) release();
  }
  element.addEventListener("pointerdown", onDown);
  element.addEventListener("pointermove", onMove);
  element.addEventListener("pointerup", onUp);
  element.addEventListener("pointercancel", onUp);
  element.addEventListener("lostpointercapture", onUp);

  /** Spring back (when not held). */
  function update(dt) {
    if (st.dragging && !isEnabled()) release();
    if (st.dragging || (st.yaw === 0 && st.pitch === 0 && st.vYaw === 0 && st.vPitch === 0)) return;
    const k = C.spring.stiffness;
    const c = 2 * C.spring.dampingRatio * Math.sqrt(k);
    const h = Math.min(dt, 0.05);
    const n = Math.max(1, Math.ceil(h / (1 / 240)));
    const s = h / n;
    for (let i = 0; i < n; i++) {
      st.vYaw += (-k * st.yaw - c * st.vYaw) * s;
      st.vPitch += (-k * st.pitch - c * st.vPitch) * s;
      st.yaw += st.vYaw * s;
      st.pitch += st.vPitch * s;
    }
    const S = C.settle;
    if (Math.abs(st.yaw) < S.offset && Math.abs(st.pitch) < S.offset && Math.abs(st.vYaw) < S.speed && Math.abs(st.vPitch) < S.speed) {
      st.yaw = st.pitch = st.vYaw = st.vPitch = 0;
    }
  }

  // ---- Applying the offset for one render ----
  const saved = { has: false, pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  const _v = new THREE.Vector3();
  const _axis = new THREE.Vector3();
  const _qYaw = new THREE.Quaternion();
  const _qPitch = new THREE.Quaternion();
  const _q = new THREE.Quaternion();
  const _up = new THREE.Vector3(0, 1, 0);
  const _dir = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const _hits = [];

  /** Whether an offset is currently applied / pending (the camera differs from the scene's). */
  const isOffset = () => st.yaw !== 0 || st.pitch !== 0;

  /**
   * Orbit the camera around `target` by the current offset (keeping how the
   * camera is aimed relative to the target). Call restore() after rendering.
   */
  function apply(camera, target) {
    saved.has = false;
    if (!isOffset() || !target) return;
    saved.has = true;
    saved.pos.copy(camera.position);
    saved.quat.copy(camera.quaternion);
    _v.copy(camera.position).sub(target);
    const r = _v.length();
    if (r < 1e-4) return;
    // Yaw around world up, then pitch around the horizontal axis across the view, within the elevation limits.
    _qYaw.setFromAxisAngle(_up, st.yaw * DEG);
    _v.applyQuaternion(_qYaw);
    const elev0 = Math.asin(Math.max(-1, Math.min(1, _v.y / r)));
    const elev = Math.max(C.minElevation * DEG, Math.min(C.maxElevation * DEG, elev0 + st.pitch * DEG));
    _axis.set(_v.z, 0, -_v.x);
    if (_axis.lengthSq() < 1e-10) _axis.set(1, 0, 0);
    _axis.normalize();
    _qPitch.setFromAxisAngle(_axis, -(elev - elev0));
    _v.applyQuaternion(_qPitch);
    _q.multiplyQuaternions(_qPitch, _qYaw);
    // Never through walls: pulled in in front of what's between the target and the camera.
    let dist = r;
    if (o.collisionObjects) {
      _dir.copy(_v).normalize();
      ray.set(target, _dir);
      ray.near = 0;
      ray.far = r;
      _hits.length = 0;
      ray.intersectObjects(o.collisionObjects(), true, _hits);
      for (const h of _hits) {
        if (!visibleChain(h.object) || (o.ignore && o.ignore(h.object))) continue;
        dist = Math.max(0.05, Math.min(r, h.distance - C.collisionMargin));
        break;
      }
    }
    _v.setLength(dist);
    camera.position.copy(target).add(_v);
    camera.quaternion.premultiply(_q);
    camera.updateMatrixWorld(true);
  }
  function restore(camera) {
    if (!saved.has) return;
    camera.position.copy(saved.pos);
    camera.quaternion.copy(saved.quat);
    camera.updateMatrixWorld(true);
    saved.has = false;
  }
  function visibleChain(obj) {
    for (let x = obj; x; x = x.parent) if (!x.visible) return false;
    return true;
  }

  /** Back at the fixed angle at once (e.g. a scene ending). */
  function reset() {
    release();
    st.yaw = st.pitch = st.vYaw = st.vPitch = 0;
  }

  function dispose() {
    release();
    element.removeEventListener("pointerdown", onDown);
    element.removeEventListener("pointermove", onMove);
    element.removeEventListener("pointerup", onUp);
    element.removeEventListener("pointercancel", onUp);
    element.removeEventListener("lostpointercapture", onUp);
  }

  const api = {
    update,
    apply,
    restore,
    reset,
    dispose,
    release,
    get dragging() {
      return st.dragging;
    },
    get offset() {
      return { yaw: st.yaw, pitch: st.pitch };
    },
    /** False on touch-only devices (there one finger drives the car: no camera drag). */
    get desktop() {
      return !touchOnly;
    },
    get atRest() {
      return !st.dragging && !isOffset();
    },
    config: C,
  };
  return api;
}
