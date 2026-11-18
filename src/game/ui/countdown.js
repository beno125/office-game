/**
 * Shared race / round countdown, in the language of the start screen and the
 * "Get ready" loader: a huge Madefor Display word or number in a brand accent
 * (glowing marker colour), and under it the loader's progress line (hairline
 * track, glowing fill, white square handle at its tip) depleting over the
 * step's time. "GO" is the climax: bigger, Wix Blue, a short glow pulse, the
 * line full.
 *
 * Two renderers from one spec: createCountdown() (HTML overlay, kitchen) and
 * drawCountdown() (canvas texture, meeting room screens). Design only: callers
 * keep their own timing and say what to show and for how long.
 */
import "./ui.css";
import "./hud.css";
import { loadWixFonts } from "./fonts.js";

loadWixFonts();

/** Brand accents (hex, so the canvas can use them too; same values as tokens.css). */
export const COUNTDOWN_TONES = {
  peach: "#ff7055",
  amber: "#faad4d",
  green: "#1fc796",
  blue: "#0c6efc",
};
/** Which accent each step uses: 3 → 2 → 1 (kitchen), READY → SET (meeting room), GO. */
export const COUNTDOWN_STEP_TONE = {
  3: COUNTDOWN_TONES.peach,
  2: COUNTDOWN_TONES.amber,
  1: COUNTDOWN_TONES.green,
  READY: COUNTDOWN_TONES.peach,
  SET: COUNTDOWN_TONES.amber,
  GO: COUNTDOWN_TONES.blue,
};
export const COUNTDOWN_GO_TEXT = "GO";

/** Motion (seconds), shared by both renderers. */
export const COUNTDOWN_MOTION = {
  enter: 0.26, // snap into place (slight upward settle and scale)
  enterRise: 0.06, // start offset below, as a share of the text size
  enterScale: 0.9, // start scale
  leave: 0.12, // fast fade out
  goEnter: 0.32,
  goPulse: 0.6, // GO glow pulse
};

/** Canvas renderer layout (shares of the canvas height) and glow (canvas px at 1024 × 576). */
const CANVAS = {
  textSize: 0.42, // READY / SET
  goSize: 0.52, // GO
  maxTextWidth: 0.82, // of the canvas width
  textY: 0.45,
  lineY: 0.78,
  lineWidth: 0.46, // of the canvas width
  lineHeight: 0.014,
  handle: 0.034,
  glow: 46, // text glow blur
  goGlowPeak: 120, // GO pulse peak blur
  grid: 64, // canvas grid cell (px), like the start screen's grid
};

const smoothOut = (k) => 1 - Math.pow(1 - k, 3);
/** Ease-out with a tiny settle (the system's --wx-ease-snap). */
const snapOut = (k) => {
  const c = 1.4;
  const x = k - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
};

// ---------------------------------------------------------------------------
// HTML overlay (kitchen)
// ---------------------------------------------------------------------------

/**
 * @returns {{ root: HTMLDivElement, show(text: string|number, durationSec: number): void, go(): void, clear(): void }}
 */
export function createCountdown() {
  const root = document.createElement("div");
  root.className = "wx-count";
  root.setAttribute("aria-live", "assertive");
  let current = null;
  let key = "";

  const leave = (item) => {
    if (!item) return;
    item.classList.add("is-out");
    window.setTimeout(() => item.remove(), COUNTDOWN_MOTION.leave * 1000 + 40);
  };

  const put = (text, tone, durationSec, isGo) => {
    const k = text + "|" + isGo;
    if (k === key) return;
    key = k;
    leave(current);
    const item = document.createElement("div");
    item.className = "wx-count-item" + (isGo ? " is-go" : "");
    item.style.setProperty("--wx-tone", tone);
    item.style.setProperty("--wx-count-dur", `${durationSec}s`);
    const label = document.createElement("span");
    label.className = "wx-count-text";
    label.textContent = text;
    const line = document.createElement("span");
    line.className = "wx-count-line";
    line.setAttribute("aria-hidden", "true");
    line.appendChild(document.createElement("i"));
    item.append(label, line);
    root.appendChild(item);
    current = item;
  };

  return {
    root,
    /** A number or word, its line depleting over `durationSec`. Same text again does nothing. */
    show(text, durationSec) {
      const t = String(text);
      put(t, COUNTDOWN_STEP_TONE[t] || COUNTDOWN_TONES.blue, durationSec, false);
    },
    go() {
      put(COUNTDOWN_GO_TEXT, COUNTDOWN_STEP_TONE.GO, 0, true);
    },
    /** Fast fade out (the track is clear again). */
    clear() {
      if (!current) return;
      leave(current);
      current = null;
      key = "";
    },
  };
}

// ---------------------------------------------------------------------------
// Canvas renderer (meeting room screens)
// ---------------------------------------------------------------------------

/**
 * Draws one countdown frame on a screen canvas.
 * @param {CanvasRenderingContext2D} c
 * @param {number} w
 * @param {number} h
 * @param {object} s
 * @param {string} s.text       READY / SET / GO
 * @param {string} s.tone       accent (hex)
 * @param {number} s.age        seconds since it appeared
 * @param {number} s.duration   seconds it stays (the line depletes over it; 0 = full, GO)
 * @param {boolean} s.go
 * @param {string} s.font       font stack (Madefor Display first)
 */
export function drawCountdown(c, w, h, s) {
  // Near-black screen with the start screen's canvas grid.
  const bg = c.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#07080c");
  bg.addColorStop(1, "#0d0f15");
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = "rgba(255,255,255,0.045)";
  c.lineWidth = 2;
  c.beginPath();
  for (let x = 0; x <= w; x += CANVAS.grid) {
    c.moveTo(x, 0);
    c.lineTo(x, h);
  }
  for (let y = 0; y <= h; y += CANVAS.grid) {
    c.moveTo(0, y);
    c.lineTo(w, y);
  }
  c.stroke();

  const M = COUNTDOWN_MOTION;
  const enterSec = s.go ? M.goEnter : M.enter;
  const k = Math.min(1, s.age / enterSec);
  const settle = snapOut(k);
  let alpha = smoothOut(Math.min(1, s.age / (enterSec * 0.6)));
  if (s.duration > 0 && s.age > s.duration - M.leave) alpha *= Math.max(0, (s.duration - s.age) / M.leave);
  if (alpha <= 0) {
    return;
  }
  const size = h * (s.go ? CANVAS.goSize : CANVAS.textSize);
  const scale = M.enterScale + (1 - M.enterScale) * settle;
  const rise = size * M.enterRise * (1 - settle);

  c.save();
  c.globalAlpha = alpha;
  c.translate(w / 2, h * CANVAS.textY + rise);
  c.font = `800 ${size}px ${s.font}`;
  const textW = c.measureText(s.text).width;
  const fit = Math.min(1, (w * CANVAS.maxTextWidth) / Math.max(1, textW));
  c.scale(scale * fit, scale * fit);
  c.textAlign = "center";
  c.textBaseline = "middle";
  // Glowing marker colour; GO pulses brighter, then settles.
  const pulse = s.go ? Math.max(0, 1 - s.age / M.goPulse) : 0;
  c.shadowColor = s.tone;
  c.shadowBlur = CANVAS.glow + (CANVAS.goGlowPeak - CANVAS.glow) * pulse;
  c.fillStyle = s.tone;
  c.fillText(s.text, 0, 0);
  // Second pass without the glow keeps the letters crisp and bright.
  c.shadowBlur = 0;
  c.fillText(s.text, 0, 0);
  c.restore();

  // The loader's line: hairline track, glowing fill depleting, white handle at its tip.
  const lw = w * CANVAS.lineWidth;
  const lh = Math.max(2, h * CANVAS.lineHeight);
  const x0 = (w - lw) / 2;
  const y = h * CANVAS.lineY + rise;
  const left = s.go || !(s.duration > 0) ? 1 : Math.max(0, 1 - s.age / s.duration);
  const lineIn = smoothOut(Math.min(1, s.age / enterSec));
  const fillW = lw * left * lineIn;
  c.save();
  c.globalAlpha = alpha;
  c.fillStyle = "rgba(255,255,255,0.12)";
  c.fillRect(x0, y - lh / 2, lw, lh);
  c.shadowColor = s.tone;
  c.shadowBlur = 18 + 30 * pulse;
  c.fillStyle = s.tone;
  c.fillRect(x0, y - lh / 2, fillW, lh);
  c.shadowBlur = 0;
  const hs = h * CANVAS.handle;
  c.fillStyle = "#ffffff";
  c.fillRect(x0 + fillW - hs / 2, y - hs / 2, hs, hs);
  c.lineWidth = 3;
  c.strokeStyle = s.tone;
  c.strokeRect(x0 + fillW - hs / 2, y - hs / 2, hs, hs);
  c.restore();
}
