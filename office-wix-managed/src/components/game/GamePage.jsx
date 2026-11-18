import { useEffect, useState } from "react";
import IntroPage, { StartBackdrop } from "./IntroPage.jsx";
import { Label, Marker, Title } from "./ui/ui.jsx";
import { onOfficeSceneEvent } from "./officeSceneEvents.js";
import OfficeSceneCopy from "../OfficeSceneCopy.jsx";
import KitchenScene from "./KitchenScene.jsx";

/** Loader overlay above the office (fades as one layer). */
const overlayBase = {
  position: "fixed",
  inset: 0,
  zIndex: 2147483646,
  overflow: "hidden",
  background: "var(--wx-bg)",
  transition: "opacity 750ms ease",
  pointerEvents: "none",
};

/**
 * Loader → office: the backdrop darkens, then the overlay fades out (ms). The
 * office's intro starts when the scene is ready, so this is kept short (was
 * 700 + 750) to show the intro's first shot.
 */
const LOADER_DARKEN_MS = 250;
const LOADER_REVEAL_MS = 750;

function pathIsPlay() {
  if (typeof window === "undefined") return false;
  return window.location.pathname.replace(/\/$/, "") === "/play";
}

/** Intro → loader → play, all on one URL (no navigation). */
export default function GamePage() {
  const [started, setStarted] = useState(pathIsPlay);
  const [bundleReady, setBundleReady] = useState(false);
  const [gumsSettled, setGumsSettled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [transitionPhase, setTransitionPhase] = useState("loading");
  const [activeScene, setActiveScene] = useState("office");

  useEffect(() => {
    if (!started) return;
    // The office is ready (car placed, gums settled, warmed up): its intro starts now.
    return onOfficeSceneEvent("office-scene-ready", () => {
      setGumsSettled(true);
    });
  }, [started]);

  useEffect(() => {
    if (!gumsSettled) return;
    setTransitionPhase("darkening");
    const revealTimer = window.setTimeout(
      () => setTransitionPhase("revealing"),
      LOADER_DARKEN_MS,
    );
    const doneTimer = window.setTimeout(
      () => setTransitionPhase("done"),
      LOADER_DARKEN_MS + LOADER_REVEAL_MS,
    );
    return () => {
      window.clearTimeout(revealTimer);
      window.clearTimeout(doneTimer);
    };
  }, [gumsSettled]);

  useEffect(() => {
    if (!started) return;
    if (gumsSettled) {
      setProgress(100);
      return;
    }

    const ceiling = bundleReady ? 96 : 72;
    const progressTimer = window.setInterval(() => {
      setProgress((current) => {
        if (current >= ceiling) return current;
        const step = Math.max(1, Math.ceil((ceiling - current) * 0.08));
        return Math.min(ceiling, current + step);
      });
    }, 120);

    return () => window.clearInterval(progressTimer);
  }, [started, bundleReady, gumsSettled]);

  if (!started) {
    return <IntroPage onStartPlay={() => setStarted(true)} />;
  }

  const status = !bundleReady
    ? "Loading office world…"
    : !gumsSettled
      ? "Almost ready…"
      : "Ready";

  return (
    <>
      {activeScene === "office" ? (
        <OfficeSceneCopy
          hideModuleLoadingOverlay
          onModuleReady={() => setBundleReady(true)}
          onTransitionToKitchen={() => setActiveScene("kitchen")}
        />
      ) : (
        // The world transition is the kitchen's loader (it stays until the kitchen is ready).
        <KitchenScene waitForTransition />
      )}
      {activeScene === "office" && transitionPhase !== "done" && (
        <div
          aria-live="polite"
          aria-busy={!gumsSettled}
          className="wx-start"
          style={{
            ...overlayBase,
            opacity: transitionPhase === "revealing" ? 0 : 1,
          }}
        >
          <StartBackdrop
            style={{
              opacity: transitionPhase === "loading" ? 1 : 0,
              transition: "opacity 700ms ease",
            }}
          />
          <section
            className="wx-start-menu wx-loader-menu"
            style={{
              opacity: transitionPhase === "loading" ? 1 : 0,
              transform: transitionPhase === "loading" ? "none" : "translateY(10px)",
              transition: "opacity 400ms ease, transform 500ms var(--wx-ease-out)",
            }}
          >
            <Label className="wx-rise" marker="var(--wx-action)">Page 01 · Office</Label>
            <Title size="hero" className="wx-start-title wx-rise">
              <span>Get</span>
              <span>
                ready<span className="wx-start-dot" aria-hidden="true" />
              </span>
            </Title>
            <div className="wx-loader-status wx-rise">
              <Label as="span">
                <Marker color={gumsSettled ? "var(--wx-green-bright)" : "var(--wx-amber)"} />
                {status}
              </Label>
              <span className="wx-loader-percent">
                {progress}
                <small>%</small>
              </span>
            </div>
            <div className="wx-progress" aria-hidden="true">
              <div className="wx-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </section>
        </div>
      )}
    </>
  );
}
