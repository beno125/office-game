import { useEffect, useRef, useState } from "react";
import { setKitchenSceneMount } from "../kitchen/kitchenSceneMount.js";
import { onKitchenSceneEvent } from "./kitchenSceneEvents.js";
import { SCENE_ROUTES } from "./sceneRoutes.js";
import { useLevelHotkeys } from "./useLevelHotkeys.js";

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.on("vite:beforeUpdate", () => {
    window.location.reload();
  });
  import.meta.hot.on("vite:beforeFullReload", () => {
    window.location.reload();
  });
}

export default function KitchenScene() {
  const rootRef = useRef(null);
  const [phase, setPhase] = useState("loading");
  const [sceneReady, setSceneReady] = useState(false);
  useLevelHotkeys(SCENE_ROUTES.kitchen);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let disposed = false;
    let sceneModule = null;
    setKitchenSceneMount(root);
    const unsubscribeReady = onKitchenSceneEvent("ready", () => {
      if (disposed) return;
      setSceneReady(true);
      setPhase("ready");
    });

    import("../kitchen/kitchenSceneModule.js")
      .then((module) => {
        sceneModule = module;
        module.setKitchenSceneRendering(!disposed);
        if (disposed || !module.isKitchenSceneReady()) return;
        setSceneReady(true);
        setPhase("ready");
      })
      .catch((error) => {
        if (disposed) return;
        console.error("[KitchenScene] failed to load:", error);
        setPhase("error");
      });

    return () => {
      disposed = true;
      unsubscribeReady();
      sceneModule?.setKitchenSceneRendering(false);
      setKitchenSceneMount(null);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="kitchen-scene-root"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "hidden",
        touchAction: "none",
        background: "#1a1a1a",
      }}
    >
      <div id="perfBadge" aria-hidden="true" />
      <div
        aria-live="polite"
        aria-busy={!sceneReady}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          background: "#090914",
          font: "800 15px/1.4 system-ui, sans-serif",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          opacity: sceneReady ? 0 : 1,
          transition: "opacity 650ms ease",
          pointerEvents: "none",
        }}
      >
        {phase === "error"
          ? "Kitchen scene failed to load"
          : "Loading kitchen…"}
      </div>
    </div>
  );
}
