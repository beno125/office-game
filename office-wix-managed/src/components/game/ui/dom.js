/**
 * Design-system pieces for UI built in plain JS (race HUD, popups): the same
 * classes as ./ui.jsx, without React.
 */
import "./ui.css";
import "./hud.css";
import { loadWixFonts } from "./fonts.js";

loadWixFonts();

/** Element with classes and optional text. */
export function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

/** Selection frame (thin blue outline, square corner handles, optional name chip). */
export function frameEl(tag) {
  const f = el("span", "wx-frame");
  f.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 4; i++) f.appendChild(document.createElement("i"));
  if (tag) {
    f.tagEl = el("span", "wx-frame-tag", tag);
    f.appendChild(f.tagEl);
  }
  return f;
}

/** Glowing accent dot. */
export function markerEl(color) {
  const m = el("span", "wx-marker");
  m.setAttribute("aria-hidden", "true");
  if (color) m.style.setProperty("--wx-marker", color);
  return m;
}

/**
 * Pill button. With `frame` (default) it sits in a selectable wrapper (frame
 * on hover / keyboard focus); without, it uses its own hover lift and glow
 * focus ring, and `wrap` is the button itself.
 * @returns {{ wrap: HTMLElement, button: HTMLButtonElement }}
 */
export function buttonEl(label, { variant = "primary", size = "md", frameTag, frame = true } = {}) {
  const button = el("button", `wx-btn wx-btn-${variant}${size !== "md" ? ` wx-btn-${size}` : ""}`);
  button.type = "button";
  button.appendChild(el("span", null, label));
  if (!frame) return { wrap: button, button };
  const wrap = el("span", "wx-selectable");
  wrap.append(button, frameEl(frameTag));
  return { wrap, button };
}

/** Restarts a CSS animation class on an element (e.g. a new countdown number). */
export function replayClass(node, className) {
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
}

/**
 * The game's old status colours → brand accents (scene code still passes the
 * old hex values; car colours and anything else pass through unchanged).
 */
const LEGACY_TONES = {
  "#4dff88": "var(--wx-green-bright)", // win / go / finish
  "#ffd23f": "var(--wx-amber)", // countdown / places / draw
  "#ff3b6b": "var(--wx-red)", // out
  "#fff": "var(--wx-text)",
  "#ffffff": "var(--wx-text)",
};
export function brandTone(color) {
  if (!color) return "var(--wx-text)";
  return LEGACY_TONES[String(color).toLowerCase()] || color;
}
