import { useEffect, useRef, useState } from "react";
import { setOfficeSceneMount } from "./office/officeSceneMount.js";

export default function OfficeScene() {
  const rootRef = useRef(null);
  const [phase, setPhase] = useState("loading");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    setOfficeSceneMount(root);
    import("./office/officeSceneModule.js")
      .then(() => setPhase("ready"))
      .catch((err) => {
        console.error("[OfficeScene] failed to load scene module:", err);
        setPhase("error");
      });

    return () => {
      setOfficeSceneMount(null);
    };
  }, []);

  const overlayStyle = {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#e8e8e8",
    font: "14px/1.4 system-ui, sans-serif",
    textAlign: "center",
    padding: "1rem",
    pointerEvents: "none",
    zIndex: 2147483000,
  };

  return (
    <div
      ref={rootRef}
      className="office-scene-root"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        touchAction: "none",
        background: "#1a1a1a",
      }}
    >
      <div id="perfBadge" aria-hidden="true" />
      {phase === "loading" && (
        <div style={overlayStyle}>Loading 3D scene…</div>
      )}
      {phase === "error" && (
        <div style={overlayStyle}>
          Scene bundle failed to load. Open DevTools → Console (F12) and check for red errors
          (network 404 on <code style={{ color: "#9cf" }}>/office-scene-optimized/</code> is common).
        </div>
      )}
    </div>
  );
}
