import { useEffect, useRef, useState } from "react";
import { isTouchDevice } from "./touch/touchDrive.js";
import TouchControlsGuide from "./touch/TouchControlsGuide.jsx";

/**
 * On-screen guide to the driving keys: the arrow keys (inverted T) and Space,
 * drawn as thin white vector outlines like a small piece of a keyboard. A key
 * lights up as a violet → pink neon tube while it's pressed; an arrow that has
 * been used keeps a faint neon tint. Once all four arrows have been used, the
 * guide fades out and doesn't come back for the rest of the browser session.
 *
 * It only listens to key events (passive): it never blocks or changes input.
 */

/** Neon line colours (gradient along the line): Wix Blue → purple, the UI's --wx-action and --wx-purple (were violet #9b4dff → hot pink #ff2fb3). */
const NEON_FROM = "#0c6efc";
const NEON_TO = "#674fe6";
/** Glow around the lit line: blur radius (SVG units) and strength (0..1, opacity of the glow layer). */
const NEON_GLOW_BLUR = 3.2;
const NEON_GLOW_STRENGTH = 0.95;
/** A used arrow keeps this much of the neon after release (0 = back to plain white). */
const NEON_USED_LEVEL = 0.35;
/** Seconds to light up / go back to white. */
const KEY_LIGHT_SEC = 0.1;
/** Guide fade in / out (s), and the pause after the last arrow is used before it fades (s). */
const GUIDE_FADE_IN_SEC = 0.6;
const GUIDE_FADE_OUT_SEC = 0.7;
const GUIDE_DONE_DELAY_SEC = 0.6;
/** "SPACE" label: the UI's label type (Wix Madefor Text). */
const KEY_LABEL_FONT = '600 11px "Wix Madefor Text", system-ui, -apple-system, sans-serif';
/** Line width and corner radius (SVG units, viewBox is 352 × 118). */
const LINE_WIDTH = 1.6;
const KEY_RADIUS = 8;
/** Guide width on screen: clamp(min, preferred vw, max). */
const GUIDE_WIDTH = "clamp(200px, 26vw, 360px)";
/** Distance from the bottom of the screen. */
const GUIDE_BOTTOM = "5vh";
/** Remembered for this browser session once the guide has been completed. */
const GUIDE_DONE_KEY = "officeControlsGuideDone";

/** Keys the game drives with → the guide key they light (arrows and W A S D both drive). */
const KEY_CODES = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  Space: "space",
};
const ARROWS = ["up", "down", "left", "right"];

let guideDoneThisSession = false;
function readGuideDone() {
  if (guideDoneThisSession) return true;
  try {
    return sessionStorage.getItem(GUIDE_DONE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeGuideDone() {
  guideDoneThisSession = true;
  try {
    sessionStorage.setItem(GUIDE_DONE_KEY, "1");
  } catch {
    /* private mode: the module flag still covers this page load */
  }
}

// Layout (SVG units): key size, gap, and the bottom row y.
const K = 44;
const GAP = 8;
const ROW2_Y = 70;
const ARROWS_X = 200; // Left key's x; Down and Right follow
const KEYS = {
  space: { x: 2, y: ROW2_Y, w: 176, h: K },
  left: { x: ARROWS_X, y: ROW2_Y, w: K, h: K },
  down: { x: ARROWS_X + K + GAP, y: ROW2_Y, w: K, h: K },
  right: { x: ARROWS_X + 2 * (K + GAP), y: ROW2_Y, w: K, h: K },
  up: { x: ARROWS_X + K + GAP, y: ROW2_Y - K - GAP, w: K, h: K },
};

/** Arrow symbol inside a key: shaft plus head, pointing in `dir`. */
function arrowPath(dir, k) {
  const cx = k.x + k.w / 2;
  const cy = k.y + k.h / 2;
  const L = 11; // half the shaft length
  const H = 6; // head size
  const rot = { up: 0, right: 90, down: 180, left: 270 }[dir];
  const pts = [
    [0, L, 0, -L], // shaft
    [-H, -L + H, 0, -L], // head, left side
    [H, -L + H, 0, -L], // head, right side
  ];
  const a = (rot * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const tr = (x, y) => `${(cx + x * c - y * s).toFixed(2)} ${(cy + x * s + y * c).toFixed(2)}`;
  return pts.map(([x1, y1, x2, y2]) => `M ${tr(x1, y1)} L ${tr(x2, y2)}`).join(" ");
}

function KeyShape({ id, k, stroke, filter }) {
  return (
    <g filter={filter}>
      <rect
        x={k.x}
        y={k.y}
        width={k.w}
        height={k.h}
        rx={KEY_RADIUS}
        ry={KEY_RADIUS}
        fill="none"
        stroke={stroke}
        strokeWidth={LINE_WIDTH}
        vectorEffect="non-scaling-stroke"
      />
      {id === "space" ? (
        <text
          x={k.x + k.w / 2}
          y={k.y + k.h / 2 + 4}
          textAnchor="middle"
          fill={stroke}
          stroke="none"
          style={{ font: KEY_LABEL_FONT, letterSpacing: "0.14em" }}
        >
          SPACE
        </text>
      ) : (
        <path
          d={arrowPath(id, k)}
          fill="none"
          stroke={stroke}
          strokeWidth={LINE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.active  true once the player has control (after the intro)
 */
export default function ControlsGuide({ active }) {
  // Phones / tablets: the touch version (drag to drive, tap the car).
  const [touch] = useState(isTouchDevice);
  if (touch) return <TouchControlsGuide active={active} />;
  return <KeyboardControlsGuide active={active} />;
}

function KeyboardControlsGuide({ active }) {
  const [done] = useState(readGuideDone);
  const [pressed, setPressed] = useState(() => new Set());
  const [used, setUsed] = useState(() => new Set());
  const [phase, setPhase] = useState("hidden"); // hidden | in | out | gone
  const timers = useRef([]);

  // Fade in when the player gets control.
  useEffect(() => {
    if (!active || done || phase !== "hidden") return;
    const id = requestAnimationFrame(() => setPhase("in"));
    return () => cancelAnimationFrame(id);
  }, [active, done, phase]);

  // Follow the real key presses (passive: nothing is blocked or changed).
  useEffect(() => {
    if (!active || done || phase === "gone") return;
    const down = (e) => {
      const key = KEY_CODES[e.code];
      if (!key) return;
      setPressed((p) => (p.has(key) ? p : new Set(p).add(key)));
      if (key !== "space") setUsed((u) => (u.has(key) ? u : new Set(u).add(key)));
    };
    const up = (e) => {
      const key = KEY_CODES[e.code];
      if (!key) return;
      setPressed((p) => {
        if (!p.has(key)) return p;
        const n = new Set(p);
        n.delete(key);
        return n;
      });
    };
    const blur = () => setPressed(new Set());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [active, done, phase]);

  // All four arrows used: fade out, then remove for the rest of the session.
  useEffect(() => {
    if (phase !== "in" || !ARROWS.every((a) => used.has(a))) return;
    writeGuideDone();
    timers.current.push(
      setTimeout(() => setPhase("out"), GUIDE_DONE_DELAY_SEC * 1000),
      setTimeout(() => setPhase("gone"), (GUIDE_DONE_DELAY_SEC + GUIDE_FADE_OUT_SEC) * 1000),
    );
  }, [used, phase]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (done || phase === "hidden" || phase === "gone") return null;

  const neonLevel = (id) => (pressed.has(id) ? 1 : used.has(id) ? NEON_USED_LEVEL : 0);
  const transition = `opacity ${KEY_LIGHT_SEC}s ease-out`;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        left: "50%",
        bottom: GUIDE_BOTTOM,
        transform: "translateX(-50%)",
        width: GUIDE_WIDTH,
        pointerEvents: "none",
        zIndex: 6,
        opacity: phase === "in" ? 1 : 0,
        transition: `opacity ${phase === "out" ? GUIDE_FADE_OUT_SEC : GUIDE_FADE_IN_SEC}s ease`,
      }}
    >
      <svg viewBox="0 0 352 118" width="100%" style={{ display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id="controlsGuideNeon" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={NEON_FROM} />
            <stop offset="1" stopColor={NEON_TO} />
          </linearGradient>
          <filter id="controlsGuideGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur in="SourceGraphic" stdDeviation={NEON_GLOW_BLUR} result="blur" />
            <feComponentTransfer in="blur" result="glow">
              <feFuncA type="linear" slope={NEON_GLOW_STRENGTH * 2} />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {Object.entries(KEYS).map(([id, k]) => {
          const neon = neonLevel(id);
          return (
            <g key={id}>
              <g style={{ opacity: pressed.has(id) ? 0 : 1, transition }}>
                <KeyShape id={id} k={k} stroke="#ffffff" />
              </g>
              <g style={{ opacity: neon, transition }}>
                <KeyShape id={id} k={k} stroke="url(#controlsGuideNeon)" filter="url(#controlsGuideGlow)" />
              </g>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
