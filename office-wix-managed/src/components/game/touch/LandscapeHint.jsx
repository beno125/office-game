import { useEffect, useState } from "react";
import { isTouchDevice } from "./touchDrive.js";
import "./touchGuide.css";

/** Dismissed for this browser session. */
const HINT_DISMISSED_KEY = "wxLandscapeHintDismissed";
const PORTRAIT_QUERY = "(orientation: portrait)";

function readDismissed() {
  try {
    return sessionStorage.getItem(HINT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * "Turn your phone for the best view": a small dismissible hint on touch
 * devices held in portrait. Follows orientation changes; hidden in landscape.
 * @param {{ show: boolean }} props  the level is in play (not over intros / loaders)
 */
export default function LandscapeHint({ show }) {
  const [touch] = useState(isTouchDevice);
  const [portrait, setPortrait] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(PORTRAIT_QUERY).matches);
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    if (!touch || !window.matchMedia) return;
    const mq = window.matchMedia(PORTRAIT_QUERY);
    const on = () => setPortrait(mq.matches);
    mq.addEventListener?.("change", on);
    window.addEventListener("orientationchange", on);
    return () => {
      mq.removeEventListener?.("change", on);
      window.removeEventListener("orientationchange", on);
    };
  }, [touch]);

  if (!touch || !portrait || dismissed || !show) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(HINT_DISMISSED_KEY, "1");
    } catch {
      /* private mode: hidden for this page only */
    }
  };

  return (
    <div className="wx-landscape-hint" role="status">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {/* a phone turning sideways */}
        <rect x="3" y="8" width="18" height="11" rx="2.5" />
        <path d="M7 4.5 A 7 7 0 0 1 15 3.5 M13.5 1.8 L 15.2 3.6 L 13.2 5" />
      </svg>
      <span>Turn your phone sideways for the best view</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.code === "Space") {
            e.preventDefault();
            dismiss();
          }
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 7l10 10M17 7L7 17" />
        </svg>
      </button>
    </div>
  );
}
