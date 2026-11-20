/**
 * The kitchen transition's flying coloured lines, drawn on one 2D canvas.
 *
 * They used to be 120 <span>s with a CSS 3D animation (translateZ + perspective,
 * scaled up to ~27x on screen). The browser draws such layers in tiles, on the
 * compositor, ahead of the page: while a line grew, tiles of it that weren't
 * drawn yet were simply missing, so pieces of lines vanished or appeared in the
 * middle of the screen (with a straight cut across the line). They also faded
 * out from 88% of their flight, while still on screen on wide screens.
 *
 * Here every line follows exactly the same path (same perspective, curve,
 * speed, size, colours, glow) but is drawn by us every frame, so it's always
 * complete. It is at full opacity the whole time it's on screen and is only
 * sent back to the start once its projected position has fully left the screen.
 */

/** Same values as the old CSS (index.css .world-transition-strips span + keyframes). */
export const STRIP_FLIGHT = {
  perspective: 800, // px (the container's CSS perspective)
  z: [-1500, 480], // px: translateZ from → to
  scaleX: [0.25, 4.5],
  scaleY: [0.06, 11],
  endVmax: 132, // translateY at the end of the flight (vmax)
  curve: [0.55, 0.02, 1, 0.42], // cubic-bezier of the whole flight
  /** Fade in while far away at the vanishing point (0 → 8% of the flight, a few px from the centre). */
  fadeIn: { until: 0.08, opacity: 0.95 },
  /** Then 0.95 → 1 by 88% of the flight (as before). No fade-out any more (it was 88% → 100%, partly on screen): full opacity until it has left the screen. */
  full: { at: 0.88, opacity: 1 },
  /** Never drawn narrower than this on screen (px): thinner lines fall between pixels and flicker. Opacity × coverage. */
  minWidth: 1.1,
  /**
   * The old box-shadow glow (0 0 5px, 0 0 10px of the line colour), as soft bands
   * around the line: [distance from the line's edge in local px, opacity].
   */
  glow: [
    [14, 0.01],
    [10, 0.035],
    [7.5, 0.079],
    [5, 0.205],
    [2.5, 0.286],
    [1.25, 0.34],
  ],
  /** Glow bands narrower than this (screen px) are skipped (invisible). */
  minGlow: 0.35,
  /** Canvas resolution cap (device pixels per CSS pixel). */
  maxPixelRatio: 2,
};

/**
 * The start of the scene, like a film's time tunnel: the lines are sucked
 * backward, brake to a stop, hold (pulled slightly toward the centre, glow
 * building), then launch forward into warp speed with a short punch. One
 * global, signed speed drives every line (negative = backward, 0 = stopped,
 * 1 = the normal flight); afterwards they fly exactly as before.
 */
export const STRIP_SEQUENCE = {
  suck: { duration: 1.0, speed: 0.6, curve: (u) => u * u }, // s; backward speed (fraction of full); accelerating
  brake: { duration: 0.5, curve: (u) => 1 - (1 - u) ** 3 }, // to a full stop, strong ease-out
  hold: { duration: 0.4, compress: 0.07, glow: 0.45 }, // s; pulled this much toward the centre; glow +45%
  launch: { duration: 1.1, curve: (u) => (u <= 0 ? 0 : 2 ** (10 * u - 10)) }, // easeInExpo to full speed
  /** Punch on reaching full speed: speed +12% and glow +35% for 0.4 s (a smooth bump), then exactly normal. */
  punch: { speed: 0.12, glow: 0.35, duration: 0.4 },
  /** Streaks: this fraction of their length when stopped, full length at full speed (either direction). */
  minStreak: 0.3,
  /** Below this speed the streak's anchor moves smoothly from the leading end of one direction to the other. */
  anchorSpeed: 0.15,
  /** Density: all lines at the start; the ones sucked into the centre aren't replaced down to this fraction; back to all of them over the launch. */
  minDensity: 0.4,
  /** Brightness (opacity × glow): this much when stopped, 1 at full speed. */
  minBrightness: 0.6,
  /** Camera field of view change (degrees, added to the normal value): narrower while sucked back and holding, wider on the launch, then exactly normal. */
  fov: { hold: -2.5, launch: 3, settle: 0.8 }, // settle: s after the punch to get back to normal
  /** Speed is integrated in steps no longer than this (s), so slow frames keep the same motion. */
  step: 1 / 240,
};
{
  const S = STRIP_SEQUENCE;
  S.brakeAt = S.suck.duration;
  S.holdAt = S.brakeAt + S.brake.duration;
  S.launchAt = S.holdAt + S.hold.duration;
  S.fullAt = S.launchAt + S.launch.duration; // full speed (the punch starts)
  S.normalAt = S.fullAt + S.punch.duration;
}

const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** Everything the sequence sets at scene time t (s). */
export function stripSequenceAt(t) {
  const S = STRIP_SEQUENCE;
  let speed, hold = 0, ramp;
  if (t < S.brakeAt) speed = -S.suck.speed * S.suck.curve(Math.max(0, t) / S.suck.duration);
  else if (t < S.holdAt) speed = -S.suck.speed * (1 - S.brake.curve((t - S.brakeAt) / S.brake.duration));
  else if (t < S.launchAt) speed = 0;
  else if (t < S.fullAt) speed = S.launch.curve((t - S.launchAt) / S.launch.duration);
  else speed = 1;
  const punchU = (t - S.fullAt) / S.punch.duration;
  const punch = punchU > 0 && punchU < 1 ? Math.sin(Math.PI * punchU) : 0;
  speed += S.punch.speed * punch;
  // Hold: rises over the end of the brake and the hold, released over the first part of the launch.
  if (t > S.holdAt - S.brake.duration * 0.5 && t < S.launchAt + S.launch.duration * 0.5)
    hold = t < S.launchAt
      ? smooth((t - (S.holdAt - S.brake.duration * 0.5)) / (S.hold.duration + S.brake.duration * 0.5))
      : 1 - smooth((t - S.launchAt) / (S.launch.duration * 0.5));
  // Density: 1 → minDensity over the suck back and brake, minDensity in the hold, → 1 with the launch speed.
  if (t < S.holdAt) ramp = 1 - smooth(t / S.holdAt);
  else if (t < S.launchAt) ramp = 0;
  else ramp = Math.min(1, Math.max(0, speed));
  const a = Math.min(1, Math.abs(speed));
  let fov;
  if (t < S.holdAt) fov = S.fov.hold * smooth(t / S.holdAt);
  else if (t < S.launchAt) fov = S.fov.hold;
  else if (t < S.fullAt) fov = S.fov.hold + (S.fov.launch - S.fov.hold) * S.launch.curve((t - S.launchAt) / S.launch.duration);
  else fov = S.fov.launch * (1 - smooth((t - S.fullAt) / (S.punch.duration + S.fov.settle)));
  return {
    speed,
    streak: S.minStreak + (1 - S.minStreak) * Math.abs(speed),
    anchor: Math.max(-1, Math.min(1, speed / S.anchorSpeed)), // 1: forward (trailing end inner), -1: backward
    compress: 1 - S.hold.compress * hold,
    glow: 1 + S.hold.glow * hold + S.punch.glow * punch,
    bright: S.minBrightness + (1 - S.minBrightness) * a,
    density: S.minDensity + (1 - S.minDensity) * ramp,
    fov,
  };
}

function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t;
  const Y = (t) => ((ay * t + by) * t + cy) * t;
  const dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const d = dX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= (X(t) - x) / d;
    }
    if (t < 0 || t > 1 || Math.abs(X(t) - x) > 1e-5) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 40; i++) {
        t = (lo + hi) / 2;
        if (X(t) < x) lo = t; else hi = t;
      }
    }
    return Y(t);
  };
}

/**
 * @param {HTMLCanvasElement} canvas  fills the strips container
 * @param {{angle:number,color:string,delay:number,duration:number,length:number,start:number,width:number}[]} strips
 * @param {number} [startTime]  performance.now() of the scene's start (shared with the car)
 * @returns {() => void} stop
 */
export function startTransitionStrips(canvas, strips, startTime = performance.now()) {
  const F = STRIP_FLIGHT;
  const ease = cubicBezier(...F.curve);
  const fadeEase = ease; // the old keyframes used the same curve between opacity steps
  const ctx = canvas.getContext("2d");
  const reduceMotion =
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const startedAt = startTime;
  const SEQ = STRIP_SEQUENCE;
  let flightClock = 0; // s of flight at full speed (the lines' own time)
  let clockAt = 0; // scene time the clock was last advanced to

  // Each line: when its current flight began (flight-clock s). Negative delays: already mid-flight at the start (as before).
  // All of them on screen from the first frame; density then follows the sequence (lines only leave / join at the centre).
  const lines = strips.map((s) => {
    const rad = (s.angle * Math.PI) / 180;
    return { ...s, sin: Math.sin(rad), cos: Math.cos(rad), born: s.delay, active: true };
  });
  let activeCount = lines.length;

  let W = 0, H = 0, dpr = 1, frame = 0;
  const resize = () => {
    W = Math.max(1, canvas.clientWidth);
    H = Math.max(1, canvas.clientHeight);
    dpr = Math.min(window.devicePixelRatio || 1, F.maxPixelRatio);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  /** Where line `l` is at flight progress p (CSS px, relative to the centre). */
  const place = (l, p, vmin, vmax, out, q = { streak: 1, anchor: 1, compress: 1 }) => {
    const e = ease(p);
    const z = F.z[0] + (F.z[1] - F.z[0]) * e;
    const k = F.perspective / (F.perspective - z);
    const sx = F.scaleX[0] + (F.scaleX[1] - F.scaleX[0]) * e;
    const sy = F.scaleY[0] + (F.scaleY[1] - F.scaleY[0]) * e;
    const ty = l.start * vmin * (1 - e) + F.endVmax * vmax * e;
    // rotate(angle) of (0, y): (-y·sin, y·cos); the span's origin sits w/2 right of the centre.
    out.r0 = ty * k; // inner end, distance from the centre (px)
    out.r1 = (ty + l.length * vmin * sy) * k; // outer end
    // Shorter streak along the motion: forward, the trailing (inner) end catches up; backward, the outer end.
    const len = out.r1 - out.r0, mid = (out.r0 + out.r1) / 2 + (q.anchor * len * (1 - q.streak)) / 2;
    out.r0 = (mid - (len * q.streak) / 2) * q.compress;
    out.r1 = (mid + (len * q.streak) / 2) * q.compress;
    out.ox = (l.width / 2) * k;
    out.s = sx * k; // local → screen across the line
    out.w = l.width * out.s; // true on-screen width (px)
    return out;
  };
  const pos = {};

  /** Fully off screen: the inner end (plus the glow) is outside the view; the rest of the line is further out. */
  const offScreen = (l, P) => {
    const m = F.glow[0][0] * P.s + P.w;
    const x = P.ox - P.r0 * l.sin, y = P.r0 * l.cos;
    return x < -W / 2 - m || x > W / 2 + m || y < -H / 2 - m || y > H / 2 + m;
  };

  const draw = (now) => {
    frame = requestAnimationFrame(draw);
    const t = (now - startedAt) / 1000;
    // Advance the flight clock by the speed (integrated: a slow frame moves the lines the same distance).
    while (clockAt < t) {
      const h = Math.min(SEQ.step, t - clockAt);
      flightClock += stripSequenceAt(clockAt + h / 2).speed * h;
      clockAt += h;
    }
    const T = flightClock;
    const q = stripSequenceAt(t);
    const { bright, glow: glowBoost } = q;
    const targetCount = Math.round(lines.length * q.density);
    const vmin = Math.min(window.innerWidth, window.innerHeight) / 100;
    const vmax = Math.max(window.innerWidth, window.innerHeight) / 100;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (reduceMotion) return;
    ctx.setTransform(dpr, 0, 0, dpr, W / 2 * dpr, H / 2 * dpr);
    ctx.lineCap = "round";

    for (const l of lines) {
      let p = (T - l.born) / l.duration;
      // Back to the start only once the flight is over AND it has fully left the screen.
      if (p >= 1 && (!l.active || offScreen(l, place(l, 1, vmin, vmax, pos, q)))) {
        l.born += Math.floor(p) * l.duration;
        p -= Math.floor(p);
      } else if (p < 0) {
        // Sucked back: gone into the vanishing point (faded out there), back to the far end of its flight, off screen.
        l.born -= Math.ceil(-p) * l.duration;
        p += Math.ceil(-p);
        if (l.active && activeCount > targetCount) {
          l.active = false;
          activeCount--;
        }
      }
      if (!l.active) {
        // Joins only while at the vanishing point, flying forward and fading in (never mid-path).
        if (activeCount >= targetCount || q.speed <= 0 || p >= F.fadeIn.until / 2) continue;
        l.active = true;
        activeCount++;
      }
      const P = place(l, p, vmin, vmax, pos, q);
      if (offScreen(l, P)) continue;

      let alpha = p < F.fadeIn.until
        ? F.fadeIn.opacity * fadeEase(p / F.fadeIn.until)
        : p < F.full.at
          ? F.fadeIn.opacity + (F.full.opacity - F.fadeIn.opacity) * fadeEase((p - F.fadeIn.until) / (F.full.at - F.fadeIn.until))
          : F.full.opacity;
      const width = Math.max(P.w, F.minWidth);
      alpha *= Math.min(1, P.w / F.minWidth) * bright;
      if (alpha <= 0) continue;

      // Round caps add half the width at each end: keep the drawn length the same as the span's.
      const half = width / 2;
      const a = Math.min(P.r0 + half, (P.r0 + P.r1) / 2);
      const b = Math.max(P.r1 - half, a);
      const x0 = P.ox - a * l.sin, y0 = a * l.cos;
      const x1 = P.ox - b * l.sin, y1 = b * l.cos;

      ctx.strokeStyle = l.color;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      for (const [d, o] of F.glow) {
        const g = d * P.s;
        if (g < F.minGlow) continue;
        ctx.globalAlpha = Math.min(1, o * alpha * glowBoost);
        ctx.lineWidth = P.w + 2 * g;
        ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  frame = requestAnimationFrame(draw);

  return () => {
    cancelAnimationFrame(frame);
    ro.disconnect();
  };
}
