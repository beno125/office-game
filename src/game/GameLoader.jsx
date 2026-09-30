import { useEffect, useState } from "react";
import { onOfficeSceneEvent } from "./officeSceneEvents.js";
import OfficeScene from "../OfficeScene.jsx";

const overlayBase = {
  position: "fixed",
  inset: 0,
  zIndex: 2147483646,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.75rem",
  background: "#1a1a1a",
  color: "#e8e8e8",
  font: "15px/1.45 system-ui, sans-serif",
  textAlign: "center",
  padding: "1.5rem",
  transition: "opacity 0.45s ease",
  pointerEvents: "none",
};

const statusLine = {
  margin: 0,
  opacity: 0.85,
  fontSize: "13px",
};

/**
 * Entry loader: office scene runs underneath; overlay hides when gums
 * finish falling into the tank and go to sleep (initial fill only).
 */
export default function GameLoader() {
  const [bundleReady, setBundleReady] = useState(false);
  const [gumsSettled, setGumsSettled] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(true);

  useEffect(() => {
    return onOfficeSceneEvent("gums-tank-initial-settled", () => {
      setGumsSettled(true);
    });
  }, []);

  useEffect(() => {
    if (!gumsSettled) return;
    const t = window.setTimeout(() => setOverlayVisible(false), 50);
    return () => window.clearTimeout(t);
  }, [gumsSettled]);

  const status = !bundleReady
    ? "Loading office world…"
    : !gumsSettled
      ? "Filling the gums tank…"
      : "Ready";

  return (
    <>
      <OfficeScene
        hideModuleLoadingOverlay
        onModuleReady={() => setBundleReady(true)}
      />
      <div
        aria-live="polite"
        aria-busy={!gumsSettled}
        style={{
          ...overlayBase,
          opacity: overlayVisible ? 1 : 0,
        }}
      >
        <p style={{ margin: 0, fontSize: "17px", fontWeight: 500 }}>Office Game</p>
        <p style={statusLine}>{status}</p>
      </div>
    </>
  );
}
