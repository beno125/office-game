import { useEffect, useRef, useState } from "react";
import { isTouchDevice } from "./touch/touchDrive.js";
import TouchControlsGuide from "./touch/TouchControlsGuide.jsx";
import "./ui/ui.css";
import "./ui/controlsGuide.css";

/**
 * On-screen guide to the driving keys (desktop), in the design system: the
 * arrow keys (inverted T) and the wide Space key as thin white outlines (the
 * menu icon's line), with short hints in Wix Madefor Text ("Drive", and the
 * Space action), on a soft frosted surface without a border. A key lights up
 * as the violet → pink neon tube while it's pressed; an arrow that has been
 * used keeps a faint neon tint. Once all four arrows have been used, the guide
 * fades out (until the page loads again).
 *
 * It only listens to key events (passive): it never blocks or changes input.
 * Phones / tablets get the touch guide instead.
 */

/** Neon line colours, kept from the original guide (gradient along the line: violet → hot pink). */
const NEON_FROM = "#9b4dff";
const NEON_TO = "#ff2fb3";
/** Glow around the lit line: blur radius (SVG units, sized for the new 1.5 line; was 2.6, then 1.7) and strength (0..1). */
const NEON_GLOW_BLUR = 1.0;
const NEON_GLOW_STRENGTH = 0.95;
/** A used arrow keeps this much of the neon after release (0 = back to plain white). */
const NEON_USED_LEVEL = 0.35;
/** Seconds to light up / go back to white. */
const KEY_LIGHT_SEC = 0.1;
/** Pause after the last arrow is used before the guide leaves (s); its motion is in controlsGuide.css. */
const GUIDE_DONE_DELAY_SEC = 0.6;
const GUIDE_LEAVE_SEC = 0.36; // matches --wx-cguide-leave
/** Line width (the menu icon's line), corner radius and key size / gap (SVG units). */
const LINE_WIDTH = 1.5;
const KEY_RADIUS = 7;
const K = 34;
const GAP = 6;
/** The Space action's name (every level: brake) and the arrows' hint. */
const SPACE_ACTION = "Brake";
const ARROWS_HINT = "Drive";
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

/**
 * Completed (all four arrows used) for this page load only: the guide shows
 * again after the intro whenever the office loads (it used to be remembered
 * for the whole browser session, which hid it on every reload / revisit).
 */
let guideDoneThisLoad = false;
function readGuideDone() {
  return guideDoneThisLoad;
}
function writeGuideDone() {
  guideDoneThisLoad = true;
}

// Layout (SVG units, 1px stroke inset so the lines aren't clipped).
const ARROW_KEYS = {
  up: { x: 1 + K + GAP, y: 1, w: K, h: K },
  left: { x: 1, y: 1 + K + GAP, w: K, h: K },
  down: { x: 1 + K + GAP, y: 1 + K + GAP, w: K, h: K },
  right: { x: 1 + 2 * (K + GAP), y: 1 + K + GAP, w: K, h: K },
};
const ARROWS_VIEW = { w: 2 + 3 * K + 2 * GAP, h: 2 + 2 * K + GAP };
const SPACE_KEY = { x: 1, y: 1, w: 3 * K + 2 * GAP, h: K };
const SPACE_VIEW = { w: 2 + SPACE_KEY.w, h: 2 + K };

/** Minimal outline arrow (shaft + head) inside a key, pointing in `dir`. */
function arrowPath(dir, k) {
  const cx = k.x + k.w / 2;
  const cy = k.y + k.h / 2;
  const L = 7; // half the shaft
  const H = 4.5; // head size
  const rot = { up: 0, right: 90, down: 180, left: 270 }[dir];
  const pts = [
    [0, L, 0, -L],
    [-H, -L + H, 0, -L],
    [H, -L + H, 0, -L],
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
      <rect x={k.x} y={k.y} width={k.w} height={k.h} rx={KEY_RADIUS} ry={KEY_RADIUS} fill="none" stroke={stroke} strokeWidth={LINE_WIDTH} vectorEffect="non-scaling-stroke" />
      {id === "space" ? null : (
        <path d={arrowPath(id, k)} fill="none" stroke={stroke} strokeWidth={LINE_WIDTH} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      )}
    </g>
  );
}

/** Neon gradient + glow, one set per SVG (ids are per SVG). */
function NeonDefs({ id }) {
  return (
    <defs>
      <linearGradient id={`${id}-neon`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={NEON_FROM} />
        <stop offset="1" stopColor={NEON_TO} />
      </linearGradient>
      <filter id={`${id}-glow`} x="-40%" y="-40%" width="180%" height="180%">
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
  );
}

/** One key: white outline, with the neon copy faded in while pressed (or faintly once used). */
function GuideKey({ id, k, svgId, pressed, neon }) {
  const transition = `opacity ${KEY_LIGHT_SEC}s ease-out`;
  return (
    <g>
      <g style={{ opacity: pressed ? 0 : 1, transition }}>
        <KeyShape id={id} k={k} stroke="#ffffff" />
      </g>
      <g style={{ opacity: neon, transition }}>
        <KeyShape id={id} k={k} stroke={`url(#${svgId}-neon)`} filter={`url(#${svgId}-glow)`} />
      </g>
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

  // Enter when the player gets control.
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

  // All four arrows used: leave, then remove for the rest of the session.
  useEffect(() => {
    if (phase !== "in" || !ARROWS.every((a) => used.has(a))) return;
    writeGuideDone();
    timers.current.push(
      setTimeout(() => setPhase("out"), GUIDE_DONE_DELAY_SEC * 1000),
      setTimeout(() => setPhase("gone"), (GUIDE_DONE_DELAY_SEC + GUIDE_LEAVE_SEC) * 1000),
    );
  }, [used, phase]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (done || phase === "hidden" || phase === "gone") return null;

  const neonLevel = (id) => (pressed.has(id) ? 1 : used.has(id) ? NEON_USED_LEVEL : 0);

  return (
    <div className={"wx-cguide" + (phase === "out" ? " is-out" : "")} aria-hidden="true">
      <div className="wx-cguide-group">
        <div className="wx-cguide-space">
          <svg viewBox={`0 0 ${SPACE_VIEW.w} ${SPACE_VIEW.h}`} className="wx-cguide-svg wx-cguide-svg-space">
            <NeonDefs id="cg-space" />
            <GuideKey id="space" k={SPACE_KEY} svgId="cg-space" pressed={pressed.has("space")} neon={neonLevel("space")} />
          </svg>
          <span className="wx-cguide-key-label">Space</span>
        </div>
        <span className="wx-cguide-hint">{SPACE_ACTION}</span>
      </div>
      <span className="wx-cguide-divider" />
      <div className="wx-cguide-group">
        <svg viewBox={`0 0 ${ARROWS_VIEW.w} ${ARROWS_VIEW.h}`} className="wx-cguide-svg wx-cguide-svg-arrows">
          <NeonDefs id="cg-arrows" />
          {Object.entries(ARROW_KEYS).map(([id, k]) => (
            <GuideKey key={id} id={id} k={k} svgId="cg-arrows" pressed={pressed.has(id)} neon={neonLevel(id)} />
          ))}
        </svg>
        <span className="wx-cguide-hint">{ARROWS_HINT}</span>
      </div>
    </div>
  );
}
