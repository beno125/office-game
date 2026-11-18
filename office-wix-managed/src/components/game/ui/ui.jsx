/**
 * Shared game UI components (design system: tokens.css + ui.css).
 * Editor Mode (Wix-style selection frame, snap-to-grid entrances) on Studio
 * Night (near-black, bold Madefor type, pill buttons) with Neon Marker accents.
 */
import "./ui.css";

import { loadWixFonts } from "./fonts.js";

export { loadWixFonts };
loadWixFonts();

/** Brand accents for markers, in the order used for sequences (levels, countdown). */
export const WX_ACCENTS = ["var(--wx-action)", "var(--wx-amber)", "var(--wx-peach)", "var(--wx-purple)", "var(--wx-green-bright)", "var(--wx-red)"];

const cx = (...c) => c.filter(Boolean).join(" ");

/** Thin blue frame with square corner handles; `tag` adds an element-name chip. `on` keeps it visible. */
export function SelectionFrame({ tag, on = false }) {
  return (
    <span className={cx("wx-frame", on && "is-on")} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      {tag ? <span className="wx-frame-tag">{tag}</span> : null}
    </span>
  );
}

/** Wraps an element so the selection frame shows on hover and keyboard focus. */
export function Selectable({ tag, className, children, style }) {
  return (
    <span className={cx("wx-selectable", className)} style={style}>
      {children}
      <SelectionFrame tag={tag} />
    </span>
  );
}

/**
 * Pill button. variant: primary | secondary | ghost; size: sm | md | lg.
 * `frameTag` names it on the selection frame (e.g. "Button").
 * Native <button>: Enter and Space activate it.
 */
export function Button({ variant = "primary", size = "md", icon, iconEnd, frameTag, className, children, type = "button", ...rest }) {
  return (
    <Selectable tag={frameTag}>
      <button type={type} className={cx("wx-btn", `wx-btn-${variant}`, size !== "md" && `wx-btn-${size}`, className)} {...rest}>
        {icon ? <Icon name={icon} /> : null}
        <span>{children}</span>
        {iconEnd ? <Icon name={iconEnd} /> : null}
      </button>
    </Selectable>
  );
}

/** Frosted dark panel. */
export function Panel({ as: Tag = "div", className, children, ...rest }) {
  return (
    <Tag className={cx("wx-panel", className)} {...rest}>
      {children}
    </Tag>
  );
}

/** Headline in Madefor Display. size: hero | h1 | h2 | number. */
export function Title({ as: Tag = "h1", size = "h1", className, children, ...rest }) {
  return (
    <Tag className={cx("wx-title", size !== "h1" && `wx-title-${size}`, className)} {...rest}>
      {children}
    </Tag>
  );
}

/** Small uppercase label; `marker` adds a neon dot in that colour. */
export function Label({ as: Tag = "p", marker, className, children, ...rest }) {
  return (
    <Tag className={cx("wx-label", className)} {...rest}>
      {marker ? <Marker color={marker} /> : null}
      {children}
    </Tag>
  );
}

/** Glowing accent dot. */
export function Marker({ color }) {
  return <span className="wx-marker" style={color ? { "--wx-marker": color } : undefined} aria-hidden="true" />;
}

/** Snap-to-grid entrance; `frame` shows the placement frame while it lands. */
export function Snap({ as: Tag = "div", delay = 0, frame = true, tag, className, style, children, ...rest }) {
  return (
    <Tag className={cx("wx-snap", className)} style={{ ...style, "--wx-delay": `${delay}ms` }} {...rest}>
      {children}
      {frame ? <SelectionFrame tag={tag} /> : null}
    </Tag>
  );
}

/** Thin outline icons (24 × 24 grid, stroke = currentColor). */
const ICON_PATHS = {
  play: "M8 5.5v13l10.5-6.5z",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  refresh: "M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4",
  close: "M6 6l12 12M18 6L6 18",
  flag: "M6 21V4M6 4h11l-2 4 2 4H6",
  keys: "M3.5 8.5h17v10h-17zM7 12h1M11 12h2M16 12h1M8 15.5h8",
};
export function Icon({ name, className, title }) {
  return (
    <svg className={cx("wx-icon", className)} viewBox="0 0 24 24" aria-hidden={title ? undefined : "true"} role={title ? "img" : undefined}>
      {title ? <title>{title}</title> : null}
      <path d={ICON_PATHS[name] || ""} />
    </svg>
  );
}
