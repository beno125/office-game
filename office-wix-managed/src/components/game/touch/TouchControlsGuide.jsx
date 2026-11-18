import { useEffect, useRef, useState } from "react";
import { onTouchDrive } from "./touchDrive.js";
import "./touchGuide.css";

/**
 * Touch version of the controls guide (phones / tablets), in the keyboard
 * guide's white outline style, matching the touch control (a ring around
 * the car): "Drag from the car to drive", "Drag behind it to reverse" and
 * "Tap the car to brake". Each part lights up in the neon once used; after
 * driving for a moment and one tap on the car, it fades out and stays gone
 * for the browser session (reversing is shown, not required).
 */

/** Seconds of driving that count as "drag to drive" done. */
const TOUCH_DRIVE_DONE_SEC = 1.5;
/** Pause after the last step before fading out, and the fades (s). */
const GUIDE_DONE_DELAY_SEC = 0.6;
const GUIDE_FADE_IN_SEC = 0.6;
const GUIDE_FADE_OUT_SEC = 0.7;
/** Remembered for this browser session once completed. */
const GUIDE_DONE_KEY = "officeTouchGuideDone";
/** The Space action in every level (brake). */
const TAP_ACTION = "brake";

let doneThisSession = false;
function readDone() {
  if (doneThisSession) return true;
  try {
    return sessionStorage.getItem(GUIDE_DONE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeDone() {
  doneThisSession = true;
  try {
    sessionStorage.setItem(GUIDE_DONE_KEY, "1");
  } catch {
    /* private mode: the module flag covers this page load */
  }
}

/** The control: a ring around the car (seen from above), the knob dragged ahead (or behind). */
function RingIcon({ reverse }) {
  const kx = reverse ? 12 : 52;
  return (
    <svg className="wx-tguide-icon" viewBox="0 0 64 48" aria-hidden="true">
      <ellipse cx="32" cy="24" rx="22" ry="17" />
      <ellipse cx="32" cy="24" rx="9" ry="7" strokeDasharray="2 4" />
      {/* the car, pointing right */}
      <path d="M27 21 H 35 L 38 24 L 35 27 H 27 Z" />
      <circle cx={kx} cy="24" r="5" />
      <path d={reverse ? "M22 24 H 16" : "M42 24 H 48"} strokeDasharray="2 3" />
    </svg>
  );
}

function TapCarIcon() {
  return (
    <svg className="wx-tguide-icon" viewBox="0 0 64 48" aria-hidden="true">
      {/* car body, wheels, then the tap ring above it */}
      <path d="M12 34 V 28 Q 12 24 16 24 H 22 L 27 18 H 40 L 45 24 H 50 Q 54 24 54 28 V 34 Z" />
      <circle cx="21" cy="35" r="4" />
      <circle cx="45" cy="35" r="4" />
      <circle cx="33" cy="10" r="3" />
      <circle cx="33" cy="10" r="7" className="wx-tguide-ripple" />
    </svg>
  );
}

/** @param {{ active: boolean }} props  true once the player has control */
export default function TouchControlsGuide({ active }) {
  const [done] = useState(readDone);
  const [drove, setDrove] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [reversed, setReversed] = useState(false);
  const [phase, setPhase] = useState("hidden"); // hidden | in | out | gone
  const driveSec = useRef(0);
  const timers = useRef([]);

  useEffect(() => {
    if (!active || done || phase !== "hidden") return;
    const id = requestAnimationFrame(() => setPhase("in"));
    return () => cancelAnimationFrame(id);
  }, [active, done, phase]);

  useEffect(() => {
    if (!active || done || phase === "gone") return;
    return onTouchDrive((d) => {
      if (d.kind === "tap") setTapped(true);
      else if (d.kind === "drive") {
        if (d.reverse) setReversed(true);
        driveSec.current += d.dt || 0;
        if (driveSec.current >= TOUCH_DRIVE_DONE_SEC) setDrove(true);
      }
    });
  }, [active, done, phase]);

  useEffect(() => {
    if (phase !== "in" || !drove || !tapped) return;
    writeDone();
    timers.current.push(
      setTimeout(() => setPhase("out"), GUIDE_DONE_DELAY_SEC * 1000),
      setTimeout(() => setPhase("gone"), (GUIDE_DONE_DELAY_SEC + GUIDE_FADE_OUT_SEC) * 1000),
    );
  }, [drove, tapped, phase]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (done || phase === "hidden" || phase === "gone") return null;

  return (
    <div
      className="wx-tguide"
      aria-hidden="true"
      style={{
        opacity: phase === "in" ? 1 : 0,
        transition: `opacity ${phase === "out" ? GUIDE_FADE_OUT_SEC : GUIDE_FADE_IN_SEC}s ease`,
      }}
    >
      <div className={"wx-tguide-step" + (drove ? " is-done" : "")}>
        <RingIcon />
        <span>Drag from the car to drive</span>
      </div>
      <div className={"wx-tguide-step" + (reversed ? " is-done" : "")}>
        <RingIcon reverse />
        <span>Drag behind it to reverse</span>
      </div>
      <div className={"wx-tguide-step" + (tapped ? " is-done" : "")}>
        <TapCarIcon />
        <span>Tap the car to {TAP_ACTION}</span>
      </div>
    </div>
  );
}
