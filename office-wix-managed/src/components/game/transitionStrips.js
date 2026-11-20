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
 * @returns {() => void} stop
 */
export function startTransitionStrips(canvas, strips) {
  const F = STRIP_FLIGHT;
  const ease = cubicBezier(...F.curve);
  const fadeEase = ease; // the old keyframes used the same curve between opacity steps
  const ctx = canvas.getContext("2d");
  const reduceMotion =
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const startedAt = performance.now();

  // Each line: when its current flight began (s). Negative delays: already mid-flight at the start (as before).
  const lines = strips.map((s) => {
    const rad = (s.angle * Math.PI) / 180;
    return { ...s, sin: Math.sin(rad), cos: Math.cos(rad), born: s.delay };
  });

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
  const place = (l, p, vmin, vmax, out) => {
    const e = ease(p);
    const z = F.z[0] + (F.z[1] - F.z[0]) * e;
    const k = F.perspective / (F.perspective - z);
    const sx = F.scaleX[0] + (F.scaleX[1] - F.scaleX[0]) * e;
    const sy = F.scaleY[0] + (F.scaleY[1] - F.scaleY[0]) * e;
    const ty = l.start * vmin * (1 - e) + F.endVmax * vmax * e;
    // rotate(angle) of (0, y): (-y·sin, y·cos); the span's origin sits w/2 right of the centre.
    out.r0 = ty * k; // inner end, distance from the centre (px)
    out.r1 = (ty + l.length * vmin * sy) * k; // outer end
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
    const vmin = Math.min(window.innerWidth, window.innerHeight) / 100;
    const vmax = Math.max(window.innerWidth, window.innerHeight) / 100;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (reduceMotion) return;
    ctx.setTransform(dpr, 0, 0, dpr, W / 2 * dpr, H / 2 * dpr);
    ctx.lineCap = "round";

    for (const l of lines) {
      let p = (t - l.born) / l.duration;
      // Back to the start only once the flight is over AND it has fully left the screen.
      if (p >= 1 && offScreen(l, place(l, 1, vmin, vmax, pos))) {
        l.born += Math.floor(p) * l.duration;
        p -= Math.floor(p);
      }
      const P = place(l, p, vmin, vmax, pos);
      if (offScreen(l, P)) continue;

      let alpha = p < F.fadeIn.until
        ? F.fadeIn.opacity * fadeEase(p / F.fadeIn.until)
        : p < F.full.at
          ? F.fadeIn.opacity + (F.full.opacity - F.fadeIn.opacity) * fadeEase((p - F.fadeIn.until) / (F.full.at - F.fadeIn.until))
          : F.full.opacity;
      const width = Math.max(P.w, F.minWidth);
      alpha *= Math.min(1, P.w / F.minWidth);
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
        ctx.globalAlpha = o * alpha;
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
