/**
 * Shared cinematic level intro: a timeline of camera shots with eased moves,
 * short fades to black between shots, letterbox bars, a camera override that
 * leaves the gameplay camera untouched (applied just before the render and
 * restored right after), and input blocking while it plays. Each level only
 * defines its shots (durations, `fade` flags, a pose per shot and the final
 * arrival onto its gameplay camera) and its own hooks around it.
 *
 * Used by the kitchen and the meeting room intros.
 */

/** Fade to black between shots (seconds): out, fully black, in. Within the shots' times. */
export const INTRO_FADE = { outSec: 0.35, holdSec: 0.06, inSec: 0.38 };
/** Letterbox bars: height (share of the view, each) and slide in / out times. */
export const INTRO_LETTERBOX = { height: 0.11, inSec: 0.9, outSec: 0.7 };

export function introEase(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
export function introEaseSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}
export const introLerp = (a, b, t) => a + (b - a) * t;

/**
 * @param {object} o
 * @param {typeof import("three")} o.THREE
 * @param {() => import("three").PerspectiveCamera} o.getCamera  the camera rendered with
 * @param {() => HTMLElement|null} o.getMount   element the fade / bars go in
 * @param {{name:string, sec:number, blendIn?:number, fade?:boolean}[]} o.shots
 *   in order; the shot named "arrival" moves from the previous shot's end onto
 *   the gameplay camera (via `arrivalPose`)
 * @param {(i:number, u:number, out:Pose) => Pose} o.shotPose  pose of shot i at 0..1
 * @param {(u:number, from:Pose, out:Pose) => Pose} o.arrivalPose
 * @param {{outSec,holdSec,inSec}} [o.fade]
 * @param {{height,inSec,outSec}} [o.letterbox]
 * @param {() => boolean} [o.blocksInput]  extra condition for blocking input (e.g. the scene is rendering)
 */
export function createCinematicIntro(o) {
  const { THREE, getCamera, getMount, shots, shotPose, arrivalPose } = o;
  const fade = o.fade || INTRO_FADE;
  const letterbox = o.letterbox || INTRO_LETTERBOX;
  const newPose = () => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50, roll: 0 });
  const pose = newPose();
  const prev = newPose();

  const intro = {
    state: "pending", // pending (before it starts) | playing | done
    t: 0,
    totalSec: shots.reduce((t, s) => t + s.sec, 0),
    shots,
    savedPos: new THREE.Vector3(),
    savedQuat: new THREE.Quaternion(),
    savedFov: 50,
    overriding: false,
    bars: null, // letterbox elements
    barsK: 0, // 0 = out, 1 = in
    barsSet: undefined,
    fadeEl: null,

    /** Start time (seconds) of the named shot. */
    shotStart(name) {
      let start = 0;
      for (const sh of shots) {
        if (sh.name === name) return start;
        start += sh.sec;
      }
      return start;
    },

    /** The camera pose at intro time t (shots, blends, the arrival). */
    poseAt(time, out = pose) {
      let t = time;
      let i = 0;
      while (i < shots.length - 1 && t >= shots[i].sec) {
        t -= shots[i].sec;
        i++;
      }
      const shot = shots[i];
      const u = Math.min(1, Math.max(0, t / shot.sec));
      if (shot.name === "arrival") {
        shotPose(i - 1, 1, prev);
        return arrivalPose(u, prev, out);
      }
      shotPose(i, u, out);
      if (shot.blendIn > 0 && i > 0 && t < shot.blendIn) {
        shotPose(i - 1, 1, prev);
        const k = 1 - introEaseSine(t / shot.blendIn);
        out.pos.lerp(prev.pos, k);
        out.look.lerp(prev.look, k);
        out.fov = introLerp(out.fov, prev.fov, k);
        out.roll = introLerp(out.roll, prev.roll, k);
      }
      return out;
    },

    /** Fade-to-black level (0..1) at intro time t: around each `fade` cut. */
    fadeAt(t) {
      let start = 0;
      let a = 0;
      for (let i = 0; i < shots.length; i++) {
        const sh = shots[i];
        if (i > 0 && sh.fade) {
          const cut = start; // the camera switches shots here
          const blackFrom = cut - fade.holdSec / 2;
          const blackTo = cut + fade.holdSec / 2;
          let k = 0;
          if (t >= blackFrom && t <= blackTo) k = 1;
          else if (t < blackFrom && t > blackFrom - fade.outSec) k = 1 - (blackFrom - t) / fade.outSec;
          else if (t > blackTo && t < blackTo + fade.inSec) k = 1 - (t - blackTo) / fade.inSec;
          a = Math.max(a, introEaseSine(Math.max(0, Math.min(1, k))));
        }
        start += sh.sec;
      }
      return a;
    },

    /** Full-screen black overlay for the fades (under the letterbox bars); gone once the intro ends. */
    updateFade() {
      const playing = intro.state === "playing";
      const a = playing ? intro.fadeAt(intro.t) : 0;
      if (!playing || a <= 0) {
        if (intro.fadeEl) {
          intro.fadeEl.remove();
          intro.fadeEl = null;
        }
        return;
      }
      const mount = getMount();
      if (!mount) return;
      if (!intro.fadeEl) {
        const el = document.createElement("div");
        Object.assign(el.style, {
          position: "absolute",
          inset: "0",
          background: "#000",
          zIndex: "3",
          pointerEvents: "none",
          opacity: "0",
        });
        mount.appendChild(el);
        intro.fadeEl = el;
      }
      intro.fadeEl.style.opacity = a.toFixed(3);
    },

    /** Letterbox bars: in while the intro plays, out once it's done (every frame). */
    updateLetterbox(dt) {
      const mount = getMount();
      if (!intro.bars) {
        if (intro.state !== "playing" || !mount) return;
        const bar = (top) => {
          const el = document.createElement("div");
          Object.assign(el.style, {
            position: "absolute",
            left: "0",
            right: "0",
            [top ? "top" : "bottom"]: "0",
            height: `${letterbox.height * 100}%`,
            background: "#000",
            zIndex: "4",
            pointerEvents: "none",
            transform: `translateY(${top ? -100 : 100}%)`,
            willChange: "transform",
          });
          mount.appendChild(el);
          return el;
        };
        intro.bars = [bar(true), bar(false)];
      }
      const target = intro.state === "playing" ? 1 : 0;
      const sec = target ? letterbox.inSec : letterbox.outSec;
      const k0 = intro.barsK;
      intro.barsK = target > k0 ? Math.min(1, k0 + dt / sec) : Math.max(0, k0 - dt / sec);
      if (intro.barsK === k0 && (k0 === 0 || k0 === 1) && intro.barsSet === k0) return;
      const e = introEaseSine(intro.barsK);
      intro.bars[0].style.transform = `translateY(${-100 * (1 - e)}%)`;
      intro.bars[1].style.transform = `translateY(${100 * (1 - e)}%)`;
      intro.barsSet = intro.barsK;
      if (intro.barsK === 0 && intro.state === "done") {
        for (const el of intro.bars) el.remove();
        intro.bars = null;
      }
    },

    /** Puts the camera at `p` for this frame's render (see restoreCamera). */
    applyCamera(p) {
      const camera = getCamera();
      intro.savedPos.copy(camera.position);
      intro.savedQuat.copy(camera.quaternion);
      intro.savedFov = camera.fov;
      camera.position.copy(p.pos);
      camera.up.set(0, 1, 0);
      camera.lookAt(p.look);
      if (p.roll) camera.rotateZ(p.roll);
      if (Math.abs(camera.fov - p.fov) > 1e-4) {
        camera.fov = p.fov;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld();
      intro.overriding = true;
    },

    /** The gameplay camera back, exactly as it was (after the render). */
    restoreCamera() {
      if (!intro.overriding) return;
      const camera = getCamera();
      camera.position.copy(intro.savedPos);
      camera.quaternion.copy(intro.savedQuat);
      if (camera.fov !== intro.savedFov) {
        camera.fov = intro.savedFov;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld();
      intro.overriding = false;
    },
  };

  // While the intro hasn't finished, keys, clicks and the wheel stop here,
  // before any game handler sees them (no skipping, nothing queued for later).
  // Browser shortcuts still work.
  const blocksInput = o.blocksInput || (() => true);
  const block = (e) => {
    if (intro.state === "done" || !blocksInput()) return;
    e.stopImmediatePropagation();
    if (e.type === "keydown" && !e.metaKey && !e.ctrlKey && !e.altKey) e.preventDefault();
  };
  for (const type of ["keydown", "pointerdown", "wheel"]) {
    window.addEventListener(type, block, { capture: true, passive: false });
  }

  return intro;
}
