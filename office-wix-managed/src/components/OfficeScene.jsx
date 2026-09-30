import { useEffect, useRef, useState } from "react";
import { onOfficeSceneEvent } from "./game/officeSceneEvents.js";
import { setOfficeSceneMount } from "./office/officeSceneMount.js";

/**
 * @param {object} props
 * @param {boolean} [props.hideModuleLoadingOverlay] — GameLoader owns the loading UI
 * @param {() => void} [props.onModuleReady] — fired when the scene JS chunk has loaded
 * @param {() => void} [props.onTransitionToKitchen] — swaps the active world
 */
export default function OfficeScene({
  hideModuleLoadingOverlay = false,
  onModuleReady,
  onTransitionToKitchen,
}) {
  const rootRef = useRef(null);
  const onReadyRef = useRef(onModuleReady);
  const onTransitionRef = useRef(onTransitionToKitchen);
  onReadyRef.current = onModuleReady;
  onTransitionRef.current = onTransitionToKitchen;
  const [phase, setPhase] = useState("loading");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let disposed = false;
    let sceneModule = null;
    setOfficeSceneMount(root);
    const stopKitchenTransition = onOfficeSceneEvent(
      "transition-to-kitchen",
      () => onTransitionRef.current?.(),
    );
    import("./office/officeSceneModule.js")
      .then((module) => {
        sceneModule = module;
        module.setOfficeSceneRendering(!disposed);
        if (disposed) return;
        setPhase("ready");
        onReadyRef.current?.();
      })
      .catch((err) => {
        if (disposed) return;
        console.error("[OfficeScene] failed to load scene module:", err);
        setPhase("error");
      });

    return () => {
      disposed = true;
      stopKitchenTransition();
      sceneModule?.setOfficeSceneRendering(false);
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

  const showModuleOverlay =
    !hideModuleLoadingOverlay && (phase === "loading" || phase === "error");

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
      {showModuleOverlay && phase === "loading" && (
        <div style={overlayStyle}>Loading 3D scene…</div>
      )}
      {showModuleOverlay && phase === "error" && (
        <div style={overlayStyle}>
          Scene bundle failed to load. Open DevTools → Console (F12) and check for red errors
          (network 404 on <code style={{ color: "#9cf" }}>/office-scene-optimized/</code> is common).
        </div>
      )}
    </div>
  );
}
