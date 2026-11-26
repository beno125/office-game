/**
 * General game menu (top right): an air-intake icon (the car's hood airIn
 * caps: closed = caps face-on, open = caps turned edge-on), a frosted panel
 * with the start screen and the levels, and a small confirmation before
 * leaving a race / round in progress. The level is paused while it's open.
 *
 * Each level page renders it with:
 *   level      its route (SCENE_ROUTES.*), marked as current
 *   getState   () => ({ visible, inPlay }) — polled: shown only when the
 *              player has control (never over intros or loaders); inPlay asks
 *              for the confirmation
 *   onPause    (paused) => void — stop / restart the level's loop
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { SCENE_ROUTES, LEVEL_ORDER, goToLevelWithTransition } from "../sceneRoutes.js";
import { INTRO_LETTERBOX } from "../cinematicIntro.js";
import { Marker } from "./ui.jsx";
import LandscapeHint from "../touch/LandscapeHint.jsx";
import "./gameMenu.css";

/** Menu entries: the start screen, then the levels in LEVEL_ORDER with their names in the game. */
const LEVEL_NAMES = {
  [SCENE_ROUTES.office]: "Office",
  [SCENE_ROUTES.kitchen]: "Kitchen",
  [SCENE_ROUTES.meetingRoom]: "Meeting Room Madness", // the meeting room sign's title
};
const START_ITEM = { path: SCENE_ROUTES.game, name: "Start screen" };
/** How often the page's state is checked (ms) for showing the icon. */
const MENU_STATE_POLL_MS = 250;
/** The icon appears this long after the player gets control: the intro's letterbox bars have slid away first (ms). */
const MENU_SHOW_DELAY_MS = INTRO_LETTERBOX.outSec * 1000 + 300;
/** Class on <body> while the menu pauses the level: the HUD's CSS animations (countdown line) pause too. */
const PAUSED_BODY_CLASS = "wx-game-paused";
/** Panel / dialog close animation (ms, matches gameMenu.css): the centred panel (touch), the side panel (desktop). */
const MENU_CLOSE_MS = 180;
const MENU_SIDE_CLOSE_MS = 280;
/** Desktop (mouse): the menu is a side panel (gameMenu.css, same media query). */
const SIDE_PANEL_MEDIA = "(hover: hover) and (pointer: fine)";
/** Confirmation copy by level (a race in the kitchen, a round in the meeting room). */
const CONFIRM_COPY = {
  [SCENE_ROUTES.kitchen]: { title: "Leave the race?", text: "The race in progress will be lost." },
  [SCENE_ROUTES.meetingRoom]: { title: "Leave the round?", text: "The round in progress will be lost." },
};
const CONFIRM_DEFAULT = { title: "Leave this level?", text: "Your progress here will be lost." };

/** The hood air intake: housing + three holes, each with a cap that turns edge-on when open. */
export function AirIntakeIcon({ open }) {
  return (
    <svg className={"wx-menu-icon" + (open ? " is-open" : "")} viewBox="0 0 44 24" aria-hidden="true">
      <rect x="1" y="1" width="42" height="22" rx="11" ry="11" />
      {[10, 22, 34].map((cx, i) => (
        <g key={cx} className={`wx-menu-intake wx-menu-intake-${i + 1}`}>
          <circle cx={cx} cy="12" r="5.2" />
          <ellipse className="wx-menu-cap" cx={cx} cy="12" rx="3.3" ry="3.3" />
        </g>
      ))}
    </svg>
  );
}

/** Enter / Space activate (the levels catch Space on the page first, so it's handled here). */
function activateOnKey(e, fn) {
  if (e.key === "Enter" || e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) fn();
  }
}

export default function GameMenu({ level, getState, onPause }) {
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirm, setConfirm] = useState(null); // path waiting for confirmation
  const iconRef = useRef(null);
  const panelRef = useRef(null);
  const dialogRef = useRef(null);
  const leavingRef = useRef(false);
  const getStateRef = useRef(getState);
  getStateRef.current = getState;
  const onPauseRef = useRef(onPause);
  onPauseRef.current = onPause;

  useEffect(() => {
    let since = 0; // when the page first said "visible" (0 = not)
    const check = () => {
      const s = getStateRef.current?.();
      const want = !!(s && s.visible);
      if (!want) since = 0;
      else if (!since) since = performance.now();
      setVisible(want && performance.now() - since >= MENU_SHOW_DELAY_MS);
    };
    check();
    const id = window.setInterval(check, MENU_STATE_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  const openMenu = useCallback(() => {
    setClosing(false);
    setOpen(true);
    document.body.classList.add(PAUSED_BODY_CLASS);
    onPauseRef.current?.(true);
  }, []);

  const closeMenu = useCallback((focusIcon = true) => {
    setConfirm(null);
    setClosing(true);
    const side = typeof window.matchMedia === "function" && window.matchMedia(SIDE_PANEL_MEDIA).matches;
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, side ? MENU_SIDE_CLOSE_MS : MENU_CLOSE_MS);
    if (!leavingRef.current) {
      document.body.classList.remove(PAUSED_BODY_CLASS);
      onPauseRef.current?.(false);
    }
    if (focusIcon) iconRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => () => document.body.classList.remove(PAUSED_BODY_CLASS), []);

  const toggle = () => (open && !closing ? closeMenu() : openMenu());

  // Focus moves into the menu (first item) when it opens, into the dialog when it asks.
  useEffect(() => {
    if (!open || closing) return;
    const root = confirm ? dialogRef.current : panelRef.current;
    const first = root?.querySelector("button");
    first?.focus({ preventScroll: true });
  }, [open, closing, confirm]);

  // The icon hides (e.g. the level is leaving): close without resuming twice.
  useEffect(() => {
    if (!visible && open && !closing) closeMenu(false);
  }, [visible, open, closing, closeMenu]);

  const leaveTo = (path) => {
    leavingRef.current = true;
    goToLevelWithTransition(path);
  };

  const choose = (path) => {
    if (path === level) {
      closeMenu();
      return;
    }
    const s = getStateRef.current?.();
    if (s && s.inPlay) setConfirm(path);
    else leaveTo(path);
  };

  // Keys inside the menu: Esc closes (or cancels the dialog), arrows move, Tab stays inside.
  const onMenuKeyDown = (e) => {
    const root = confirm ? dialogRef.current : panelRef.current;
    const items = root ? [...root.querySelectorAll("button")] : [];
    const i = items.indexOf(document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      if (confirm) setConfirm(null);
      else closeMenu();
    } else if (e.key === "Tab") {
      e.preventDefault();
      items[(i + (e.shiftKey ? items.length - 1 : 1) + items.length) % items.length]?.focus();
    } else if (!confirm && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1) + items.length) % items.length]?.focus();
    }
  };

  if (!visible && !open) return null;

  const levels = LEVEL_ORDER.map((path, i) => ({ path, name: LEVEL_NAMES[path] || path, num: String(i + 1).padStart(2, "0") }));
  const copy = CONFIRM_COPY[level] || CONFIRM_DEFAULT;
  const shown = open && !closing;

  return (
    <div className={"wx-menu" + (visible ? " is-visible" : "")} onKeyDown={open ? onMenuKeyDown : undefined}>
      <LandscapeHint show={visible && !open} />
      <button
        ref={iconRef}
        type="button"
        className="wx-menu-button"
        aria-label={shown ? "Close menu" : "Open menu"}
        aria-expanded={shown}
        aria-controls="wx-game-menu"
        onClick={toggle}
        onKeyDown={(e) => activateOnKey(e, toggle)}
      >
        <AirIntakeIcon open={shown} />
      </button>

      {open && (
        <div className={"wx-menu-modal" + (closing ? " is-closing" : "")}>
          {/* Dimmed, slightly blurred backdrop: a click closes the menu. */}
          <div className="wx-menu-backdrop" onPointerDown={() => closeMenu()} aria-hidden="true" />
        <div
          id="wx-game-menu"
          ref={panelRef}
          className="wx-panel wx-menu-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Game menu"
        >
          <h2 className="wx-title wx-title-h2 wx-menu-title">Menu</h2>
          <ul className="wx-menu-list">
            <li>
              <button
                type="button"
                className={"wx-menu-item" + (level === START_ITEM.path ? " is-current" : "")}
                onClick={() => choose(START_ITEM.path)}
                onKeyDown={(e) => activateOnKey(e, () => choose(START_ITEM.path))}
              >
                <span className="wx-menu-item-num" aria-hidden="true">↩</span>
                <span className="wx-menu-item-name">{START_ITEM.name}</span>
              </button>
            </li>
          </ul>
          <hr className="wx-divider" />
          <p className="wx-label wx-menu-section">Levels</p>
          <ul className="wx-menu-list">
            {levels.map((lv) => {
              const current = lv.path === level;
              return (
                <li key={lv.path}>
                  <button
                    type="button"
                    className={"wx-menu-item" + (current ? " is-current" : "")}
                    aria-current={current ? "page" : undefined}
                    onClick={() => choose(lv.path)}
                    onKeyDown={(e) => activateOnKey(e, () => choose(lv.path))}
                  >
                    <span className="wx-menu-item-num">{lv.num}</span>
                    <span className="wx-menu-item-name">{lv.name}</span>
                    {current && (
                      <span className="wx-menu-item-current">
                        <Marker color="var(--wx-action)" />
                        Playing
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        </div>
      )}

      {open && confirm && (
        <div className="wx-menu-confirm-layer">
          <div
            ref={dialogRef}
            className="wx-panel wx-menu-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="wx-menu-confirm-title"
            aria-describedby="wx-menu-confirm-text"
          >
            <h3 id="wx-menu-confirm-title" className="wx-title wx-title-h2">{copy.title}</h3>
            <p id="wx-menu-confirm-text" className="wx-text">{copy.text}</p>
            <div className="wx-menu-confirm-actions">
              <button
                type="button"
                className="wx-btn wx-btn-secondary"
                onClick={() => setConfirm(null)}
                onKeyDown={(e) => activateOnKey(e, () => setConfirm(null))}
              >
                <span>Stay</span>
              </button>
              <button
                type="button"
                className="wx-btn wx-btn-primary"
                onClick={() => leaveTo(confirm)}
                onKeyDown={(e) => activateOnKey(e, () => leaveTo(confirm))}
              >
                <span>Leave</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
