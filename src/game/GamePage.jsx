import { useEffect, useState } from "react";
import IntroPage, {
  introMenuStyle,
  introPageStyle,
  introTitleStyle,
} from "./IntroPage.jsx";
import { onOfficeSceneEvent } from "./officeSceneEvents.js";
import OfficeScene from "../OfficeScene.jsx";
import KitchenScene from "./KitchenScene.jsx";
import WorldTransition from "./WorldTransition.jsx";

const overlayBase = {
  ...introPageStyle,
  zIndex: 2147483646,
  overflow: "hidden",
  background: "#03030a",
  transition: "opacity 750ms ease",
  pointerEvents: "none",
};

const backdropStyle = {
  position: "absolute",
  inset: 0,
  backgroundImage:
    'linear-gradient(90deg, rgba(5, 7, 20, 0.76) 0%, rgba(5, 7, 20, 0.48) 34%, rgba(5, 7, 20, 0.08) 62%, transparent 78%), url("/intro-background.png")',
  backgroundSize: "cover",
  backgroundPosition: "center",
  transition: "opacity 700ms ease",
};

const loaderCardStyle = {
  ...introMenuStyle,
  position: "relative",
  zIndex: 1,
  transition: "opacity 400ms ease, transform 500ms ease",
};

const loaderTitleStyle = {
  ...introTitleStyle,
};

const statusLine = {
  margin: 0,
  display: "flex",
  justifyContent: "space-between",
  width: "100%",
  boxSizing: "border-box",
  padding: "0.55rem 0.75rem",
  background: "rgba(8, 8, 8, 0.8)",
  borderRadius: "8px",
  font: "800 13px/1.4 system-ui, sans-serif",
  letterSpacing: "0.055em",
  textTransform: "uppercase",
};

const loaderTrackStyle = {
  width: "100%",
  height: "18px",
  overflow: "hidden",
  background: "#fff",
  border: "4px solid #080808",
  borderRadius: "9px",
  boxSizing: "border-box",
};

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
    return onOfficeSceneEvent("gums-tank-initial-settled", () => {
      setGumsSettled(true);
    });
  }, [started]);

  useEffect(() => {
    if (!gumsSettled) return;
    setTransitionPhase("darkening");
    const revealTimer = window.setTimeout(
      () => setTransitionPhase("revealing"),
      700,
    );
    const doneTimer = window.setTimeout(
      () => setTransitionPhase("done"),
      1450,
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
        <OfficeScene
          hideModuleLoadingOverlay
          onModuleReady={() => setBundleReady(true)}
          onTransitionToKitchen={() => setActiveScene("transition")}
        />
      ) : activeScene === "transition" ? (
        <WorldTransition onComplete={() => setActiveScene("kitchen")} />
      ) : (
        <KitchenScene />
      )}
      {activeScene === "office" && transitionPhase !== "done" && (
        <div
          aria-live="polite"
          aria-busy={!gumsSettled}
          style={{
            ...overlayBase,
            opacity: transitionPhase === "revealing" ? 0 : 1,
          }}
        >
          <div
            style={{
              ...backdropStyle,
              opacity: transitionPhase === "loading" ? 1 : 0,
            }}
          />
          <div
            style={{
              ...loaderCardStyle,
              opacity: transitionPhase === "loading" ? 1 : 0,
              transform:
                transitionPhase === "loading"
                  ? "translateY(0) scale(1)"
                  : "translateY(10px) scale(0.98)",
            }}
          >
            <h1 style={loaderTitleStyle}>
              <span style={{ display: "block" }}>Get</span>
              <span style={{ display: "block" }}>Ready</span>
            </h1>
            <p style={statusLine}>
              <span>{status}</span>
              <span>{progress}%</span>
            </p>
            <div style={loaderTrackStyle} aria-hidden="true">
              <div
                className="game-loader-progress"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
