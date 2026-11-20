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
 * The start of the scene, like a film's time tunnel, in two directions only:
 * 1. Suck in: the whole field is pulled into the vanishing point, faster and
 *    stronger toward the end, until nearly every line is gathered in a tight,
 *    bright cluster at the centre (a few faint traces left around it). The lines
 *    shrink and gather there (squashed toward the centre), never vanishing.
 * 2. Release: at the peak, a glow flash, and they burst back out: each line
 *    carries on from where it is in the cluster along its own flight, and one
 *    speed curve (fast at once, only rising, settling at full speed) moves them
 *    all, with a short punch on top; afterwards they fly exactly as before.
 */
export const STRIP_SEQUENCE = {
  /** Suck in: duration (s) and curve of the suction (0 → 1): an ease-in, faster and stronger toward the end. */
  suck: { duration: 1.3, curve: (u) => u * u * u },
  /**
   * How far the lines are sucked in, at the peak: every distance from the centre
   * is scaled by `scale` and squashed so nothing is further out than ~`radius` px
   * (distance' = distance·(1 − suction·(1 − scale)) / (1 + suction²·distance/radius)).
   * Widths and glow shrink with the line, but stay at least `minWidth` px wide.
   */
  pull: { scale: 0.35, radius: 40, minWidth: 1.4 },
  /** The bright cluster: a soft glow at the centre (radius px, opacity at the peak), also the release flash. */
  cluster: { radius: 70, opacity: 0.55, color: "170, 200, 255" },
  /** A few lines are left as faint traces around the cluster: every `every`-th line, sucked in only this much, at this opacity. */
  traces: { every: 9, suction: 0.55, opacity: 0.45 },
  /**
   * Release: the one speed curve after the peak, from the burst speed (`from`, fraction of full) up to full
   * speed over `duration` s, ease-out (a strong push at once, then settling): it only ever rises.
   * (Was two curves at once, the suction coming off (ease-out) and the flight speed (ease-in): their sum
   * slowed down to ~1/6 in between, then sped up again.)
   */
  release: { duration: 0.8, from: 0.7, curve: (u) => 1 - (1 - u) ** 3 },
  /**
   * After the release, one wave flowing into the normal flight: the released lines are the burst wave (each
   * pushed a little further along its flight, up to `stagger` of it, so they don't move as one ring) and retire
   * once they've left the screen; a stream of the same lines starts at the release, each at a random point of
   * its first cycle (spread over the whole cycle), so the tunnel fills behind the wave at full density at once.
   * (Was: every line restarted together from the cluster, so they left and came back together: a second wave.)
   */
  stream: { stagger: 0.04 },
  /**
   * The burst wave's own push: it starts at the very beginning of its flight, where the path's curve is
   * nearly flat (it crawled out at ~10 px/s for the first frames). Its flight runs `boost`× faster at the
   * release, easing back to 1× over `duration` s, so it explodes out at once and still only accelerates.
   */
  burstBoost: { boost: 8, duration: 0.55 },
  /** The flash at the moment of release: line glow +120% and the centre glow up to this opacity, fading over this long (s). */
  flash: { glow: 1.2, opacity: 0.6, duration: 0.35 },
  /**
   * Punch on reaching full speed: glow +35% for 0.4 s (a smooth bump), then exactly normal. Speed: no overshoot
   * (was +12%: after the release curve settled it pushed again and then slowed back down, a second rush).
   */
  punch: { speed: 0, glow: 0.35, duration: 0.4 },
  /** Streaks: this fraction of their length when still, full length at full speed (pointing along the motion). */
  minStreak: 0.3,
  /** Below this speed the streak's anchor moves smoothly from the leading end of one direction to the other. */
  anchorSpeed: 0.15,
  /** Brightness (opacity × glow): this much when still, 1 at full speed (and in the cluster). */
  minBrightness: 0.6,
  /** Camera field of view change (degrees, added to the normal value): narrower while sucked in, wider on the release, then exactly normal. */
  fov: { suck: -2.5, release: 3, settle: 0.8 }, // settle: s after the punch to get back to normal
  /** Speed is integrated in steps no longer than this (s), so slow frames keep the same motion. */
  step: 1 / 240,
};
{
  const S = STRIP_SEQUENCE;
  S.releaseAt = S.suck.duration;
  S.fullAt = S.releaseAt + S.release.duration; // full speed (the punch starts)
  S.normalAt = S.fullAt + S.punch.duration;
}

const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const clamp01 = (u) => Math.max(0, Math.min(1, u));

/** Everything the sequence sets at scene time t (s). */
export function stripSequenceAt(t) {
  const S = STRIP_SEQUENCE;
  const h = 1e-3;
  // Suction 0 → 1 over the suck in (its rate drives the streaks while the flight is still); none after the release.
  const suctionAt = (x) => (x < S.releaseAt ? S.suck.curve(clamp01(x / S.suck.duration)) : 0);
  const suction = suctionAt(t);
  const rate = t < S.releaseAt ? (suctionAt(Math.min(t + h, S.releaseAt - 1e-9)) - suctionAt(t - h)) / (Math.min(t + h, S.releaseAt - 1e-9) - (t - h)) : 0;
  const maxRate = 3 / S.suck.duration; // the suck-in curve's rate at its end
  const speed =
    t < S.releaseAt ? 0 : t < S.fullAt ? S.release.from + (1 - S.release.from) * S.release.curve((t - S.releaseAt) / S.release.duration) : 1;
  const punchU = (t - S.fullAt) / S.punch.duration;
  const punch = punchU > 0 && punchU < 1 ? Math.sin(Math.PI * punchU) : 0;
  const flightSpeed = speed + S.punch.speed * punch;
  // Motion along the lines: inward while sucked in (−), outward from the release (+, the flight speed).
  const motion = t < S.releaseAt ? -Math.min(1, rate / maxRate) : flightSpeed;
  const flashU = (t - S.releaseAt) / S.flash.duration;
  const flash = flashU >= 0 && flashU < 1 ? (1 - flashU) ** 2 : 0;
  const a = Math.max(Math.min(1, Math.abs(motion)), suction);
  let fov;
  if (t < S.releaseAt) fov = S.fov.suck * S.suck.curve(clamp01(t / S.suck.duration));
  else if (t < S.fullAt) fov = S.fov.suck + (S.fov.release - S.fov.suck) * smooth((t - S.releaseAt) / S.release.duration);
  else fov = S.fov.release * (1 - smooth((t - S.fullAt) / (S.punch.duration + S.fov.settle)));
  return {
    speed: flightSpeed, // the lines' own flight (0 during the suck in)
    suction,
    streak: S.minStreak + (1 - S.minStreak) * Math.abs(motion),
    anchor: Math.max(-1, Math.min(1, motion / S.anchorSpeed)), // 1: outward (trailing end inner), -1: inward
    glow: 1 + S.flash.glow * flash + S.punch.glow * punch,
    centreGlow: Math.min(1, S.cluster.opacity * suction * suction + S.flash.opacity * flash),
    bright: S.minBrightness + (1 - S.minBrightness) * a,
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
 * @param {{ glowAt?: (t: number) => number }} [extra]  an extra glow multiplier at scene time t (the car's pass)
 * @returns {() => void} stop
 */
export function startTransitionStrips(canvas, strips, startTime = performance.now(), extra = {}) {
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
  let released = false;
  let burstClock = 0; // the burst wave's flight clock (the flight clock with its push)

  // Each line: when its current flight began (flight-clock s). Negative delays: already mid-flight at the start (as before).
  // All of them on screen from the first frame. Every few: a faint trace (sucked in less).
  const random = (i, salt) => { const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453; return x - Math.floor(x); };
  const burstLines = strips.map((s, i) => {
    const rad = (s.angle * Math.PI) / 180;
    return { ...s, sin: Math.sin(rad), cos: Math.cos(rad), born: s.delay, trace: i % SEQ.traces.every === 0, burst: true };
  });
  // The stream after the release (not drawn before it): the same lines, each at a random point of its first cycle.
  const streamLines = burstLines.map((l, i) => ({ ...l, trace: false, burst: false, stream: true, waitFor: random(i, 1) }));
  let lines = burstLines;

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
  const place = (l, p, vmin, vmax, out, q = { streak: 1, anchor: 1, suction: 0 }) => {
    const e = ease(p);
    const z = F.z[0] + (F.z[1] - F.z[0]) * e;
    const k = F.perspective / (F.perspective - z);
    const sx = F.scaleX[0] + (F.scaleX[1] - F.scaleX[0]) * e;
    const sy = F.scaleY[0] + (F.scaleY[1] - F.scaleY[0]) * e;
    const ty = l.start * vmin * (1 - e) + F.endVmax * vmax * e;
    // rotate(angle) of (0, y): (-y·sin, y·cos); the span's origin sits w/2 right of the centre.
    out.r0 = ty * k; // inner end, distance from the centre (px)
    out.r1 = (ty + l.length * vmin * sy) * k; // outer end
    // Shorter streak along the motion: outward, the trailing (inner) end catches up; inward, the outer end.
    const len = out.r1 - out.r0, mid = (out.r0 + out.r1) / 2 + (q.anchor * len * (1 - q.streak)) / 2;
    out.r0 = mid - (len * q.streak) / 2;
    out.r1 = mid + (len * q.streak) / 2;
    // Sucked in: every distance scaled down and squashed toward the centre (same order: lines shrink, never jump).
    const su = q.suction * (l.trace ? SEQ.traces.suction : 1);
    out.su = su;
    if (su > 0) {
      const c = 1 - su * (1 - SEQ.pull.scale);
      const squash = (r) => (r * c) / (1 + (su * su * r) / SEQ.pull.radius);
      out.r0 = squash(out.r0);
      out.r1 = squash(out.r1);
    }
    const midBefore = Math.max(1e-6, mid);
    const ws = su > 0 ? Math.min(1, (out.r0 + out.r1) / 2 / midBefore) : 1; // shrinks as much as the line
    out.ox = (l.width / 2) * k * ws;
    out.s = sx * k * ws; // local → screen across the line
    out.w = l.width * out.s; // true on-screen width (px)
    if (su > 0) out.w = Math.max(out.w, Math.min(l.width * sx * k, SEQ.pull.minWidth));
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
      const v = stripSequenceAt(clockAt + h / 2).speed * h;
      flightClock += v;
      const u = Math.min(1, Math.max(0, (clockAt + h / 2 - SEQ.releaseAt) / SEQ.burstBoost.duration));
      burstClock += v * (1 + (SEQ.burstBoost.boost - 1) * (1 - u) ** 2);
      clockAt += h;
    }
    const vmin = Math.min(window.innerWidth, window.innerHeight) / 100;
    const vmax = Math.max(window.innerWidth, window.innerHeight) / 100;
    if (!released && t >= SEQ.releaseAt) {
      // The release: each line carries on along its own flight from where it is in the cluster (same inner end), no jump.
      released = true;
      const atPeak = stripSequenceAt(SEQ.releaseAt - 1e-6);
      const after = stripSequenceAt(SEQ.releaseAt);
      const clockAtRelease = 0; // the flight is still until the release
      burstLines.forEach((l, i) => {
        const target = place(l, (clockAtRelease - l.born) / l.duration, vmin, vmax, {}, atPeak).r0;
        let lo = 0, hi = 1;
        for (let k = 0; k < 30; k++) {
          const mid = (lo + hi) / 2;
          if (place(l, mid, vmin, vmax, pos, after).r0 < target) lo = mid; else hi = mid;
        }
        l.born = clockAtRelease - (lo + SEQ.stream.stagger * random(i, 2)) * l.duration;
      });
      // The stream starts now: line i comes out of the centre after waitFor × its cycle.
      for (const l of streamLines) l.born = clockAtRelease + l.waitFor * l.duration;
      lines = burstLines.concat(streamLines);
    }
    const T = flightClock;
    const q = stripSequenceAt(t);
    const { bright } = q;
    const glowBoost = q.glow * (extra.glowAt ? extra.glowAt(t) : 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (reduceMotion) return;
    ctx.setTransform(dpr, 0, 0, dpr, W / 2 * dpr, H / 2 * dpr);
    ctx.lineCap = "round";
    if (q.centreGlow > 0.002) {
      // The bright cluster / the release flash at the centre.
      const R = SEQ.cluster.radius;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
      g.addColorStop(0, `rgba(${SEQ.cluster.color}, ${q.centreGlow})`);
      g.addColorStop(0.35, `rgba(${SEQ.cluster.color}, ${q.centreGlow * 0.35})`);
      g.addColorStop(1, `rgba(${SEQ.cluster.color}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(-R, -R, 2 * R, 2 * R);
    }

    for (const l of lines) {
      if (l.retired) continue;
      let p = ((l.burst ? burstClock : T) - l.born) / l.duration;
      if (p < 0) continue; // a stream line not out yet
      // Back to the start only once the flight is over AND it has fully left the screen (the burst wave retires then).
      if (p >= 1 && offScreen(l, place(l, 1, vmin, vmax, pos, q))) {
        if (l.burst && released) {
          l.retired = true;
          continue;
        }
        l.born += Math.floor(p) * l.duration;
        p -= Math.floor(p);
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
      if (l.trace) alpha *= 1 - (1 - SEQ.traces.opacity) * (P.su / SEQ.traces.suction); // a faint trace around the cluster
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
