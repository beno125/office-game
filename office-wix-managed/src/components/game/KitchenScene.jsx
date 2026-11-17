import { useEffect, useRef, useState } from "react";
import { setKitchenSceneMount } from "../kitchen/kitchenSceneMount.js";
import { onKitchenSceneEvent } from "./kitchenSceneEvents.js";
import { SCENE_ROUTES } from "./sceneRoutes.js";
import { useLevelHotkeys } from "./useLevelHotkeys.js";
import WorldTransition from "./WorldTransition.jsx";

/** Loader fade-out once the kitchen is drawn (the intro plays under it). */
const LOADER_FADE_MS = 600;

/**
 * The kitchen with the world-transition loader over it while it loads. With
 * `waitForTransition` (coming from the office) the loader also plays its full
 * transition first; it fades out only once the kitchen is fully drawn, and the
 * cinematic intro starts then.
 */
export default function KitchenScene({ waitForTransition = false }) {
  const rootRef = useRef(null);
  const moduleRef = useRef(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [transitionDone, setTransitionDone] = useState(!waitForTransition);
  const [loaderGone, setLoaderGone] = useState(false);
  const reveal = sceneReady && transitionDone;
  useLevelHotkeys(SCENE_ROUTES.kitchen);

  useEffect(() => {
    if (!reveal) return;
    moduleRef.current?.startKitchenIntro?.();
    const timer = window.setTimeout(() => setLoaderGone(true), LOADER_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [reveal]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let disposed = false;
    let sceneModule = null;
    setKitchenSceneMount(root);
    const unsubscribeReady = onKitchenSceneEvent("ready", () => {
      if (disposed) return;
      setSceneReady(true);
    });

    import("../kitchen/kitchenSceneModule.js")
      .then((module) => {
        sceneModule = module;
        moduleRef.current = module;
        module.setKitchenSceneRendering(!disposed);
        if (disposed || !module.isKitchenSceneReady()) return;
        setSceneReady(true);
      })
      .catch((error) => {
        if (disposed) return;
        console.error("[KitchenScene] failed to load:", error);
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
      {!loaderGone && (
        <div
          aria-busy={!reveal}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 30,
            opacity: reveal ? 0 : 1,
            transition: `opacity ${LOADER_FADE_MS}ms ease`,
            pointerEvents: reveal ? "none" : "auto",
          }}
        >
          <WorldTransition onComplete={() => setTransitionDone(true)} />
        </div>
      )}
    </div>
  );
}
