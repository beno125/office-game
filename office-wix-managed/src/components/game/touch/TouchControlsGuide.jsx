import { useEffect, useRef, useState } from "react";
import { onTouchDrive } from "./touchDrive.js";
import "./touchGuide.css";

/**
 * Touch version of the controls guide (phones / tablets), in the keyboard
 * guide's white outline style: "Drag to drive" (a finger with its path) and
 * "Tap the car to brake" (a car with a tap ring). Each part lights up in the
 * guide's neon once done; after both (driven for a moment + one tap on the
 * car), it fades out and stays gone for the browser session.
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

function DragIcon() {
  return (
    <svg className="wx-tguide-icon" viewBox="0 0 64 48" aria-hidden="true">
      {/* the finger's path, then the touch point */}
      <path d="M8 38 C 20 38, 22 14, 40 14" strokeDasharray="2 5" />
      <path d="M36 9 L 42 14 L 36 19" />
      <circle cx="50" cy="14" r="7" />
      <circle cx="50" cy="14" r="2.2" />
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
        <DragIcon />
        <span>Drag to drive</span>
      </div>
      <div className={"wx-tguide-step" + (tapped ? " is-done" : "")}>
        <TapCarIcon />
        <span>Tap the car to {TAP_ACTION}</span>
      </div>
    </div>
  );
}
