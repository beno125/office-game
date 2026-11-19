import { useEffect, useRef, useState } from "react";
import { setKitchenSceneMount } from "../kitchen/kitchenSceneMount.js";
import { onKitchenSceneEvent } from "./kitchenSceneEvents.js";
import { SCENE_ROUTES, goToLevelWithTransition, LEVEL_DESCRIPTION_MIN_READ_MS } from "./sceneRoutes.js";
import { useLevelHotkeys } from "./useLevelHotkeys.js";
import WorldTransition from "./WorldTransition.jsx";
import GameMenu from "./ui/GameMenu.jsx";
import { RACE_LAPS } from "../kitchen/kitchenRace.js";

/** Loader fade-out once the kitchen is drawn (the intro plays under it). */
const LOADER_FADE_MS = 600;
/** Fade to dark before leaving for the next level. */
const LEAVE_FADE_MS = 450;
/** Shown on the loader: what this level is ({laps} = the race's lap count). */
const KITCHEN_LEVEL_DESCRIPTION = "Race around the kitchen table. First to finish {laps} laps wins!";
/** The description's fade-in on the loader (its 200 ms delay + 600 ms animation). */
const KITCHEN_DESCRIPTION_SHOW_MS = 800;
/** The loader stays up until the description has been readable for the shared minimum. */
const KITCHEN_DESCRIPTION_MIN_MS = KITCHEN_DESCRIPTION_SHOW_MS + LEVEL_DESCRIPTION_MIN_READ_MS;

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.on("vite:beforeUpdate", () => {
    window.location.reload();
  });
  import.meta.hot.on("vite:beforeFullReload", () => {
    window.location.reload();
  });
}

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
  const [leaving, setLeaving] = useState(false);
  const [minShown, setMinShown] = useState(false);
  const reveal = sceneReady && transitionDone && minShown;
  // Game menu: shown once the player has control (not over the loader or the intro).
  const menuFlagsRef = useRef({ loaderGone: false, leaving: false });
  menuFlagsRef.current = { loaderGone, leaving };
  const getMenuState = () => {
    const s = moduleRef.current?.getKitchenMenuState?.();
    const f = menuFlagsRef.current;
    return { visible: !!(s && s.playerHasControl && f.loaderGone && !f.leaving), inPlay: !!(s && s.inPlay) };
  };
  const pauseForMenu = (paused) => moduleRef.current?.setKitchenSceneRendering?.(!paused);
  useLevelHotkeys(SCENE_ROUTES.kitchen);

  useEffect(() => {
    const timer = window.setTimeout(() => setMinShown(true), KITCHEN_DESCRIPTION_MIN_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // While the transition covers it, the ready kitchen doesn't render (it's hidden;
  // the transition gets the GPU to itself). It resumes for the intro.
  const revealRef = useRef(false);
  revealRef.current = reveal;
  const holdUntilReveal = () => {
    if (!revealRef.current) moduleRef.current?.setKitchenSceneRendering?.(false);
  };

  useEffect(() => {
    if (!reveal) return;
    moduleRef.current?.setKitchenSceneRendering?.(true);
    moduleRef.current?.startKitchenIntro?.();
    const timer = window.setTimeout(() => setLoaderGone(true), LOADER_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [reveal]);

  // "Next level" from the race results: fade out, stop the kitchen, change level.
  useEffect(() => {
    let timer = 0;
    const unsubscribe = onKitchenSceneEvent("next-level", (detail) => {
      const path = detail && detail.path;
      if (!path || timer) return;
      setLeaving(true);
      timer = window.setTimeout(() => {
        moduleRef.current?.setKitchenSceneRendering?.(false);
        goToLevelWithTransition(path);
      }, LEAVE_FADE_MS);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let disposed = false;
    let sceneModule = null;
    setKitchenSceneMount(root);
    const unsubscribeReady = onKitchenSceneEvent("ready", () => {
      if (disposed) return;
      setSceneReady(true);
      holdUntilReveal();
    });

    import("../kitchen/kitchenSceneModule.js")
      .then((module) => {
        sceneModule = module;
        moduleRef.current = module;
        module.setKitchenSceneRendering(!disposed);
        if (disposed || !module.isKitchenSceneReady()) return;
        setSceneReady(true);
        holdUntilReveal();
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
      <GameMenu level={SCENE_ROUTES.kitchen} getState={getMenuState} onPause={pauseForMenu} />
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 40,
          background: "#03030a",
          opacity: leaving ? 1 : 0,
          transition: `opacity ${LEAVE_FADE_MS}ms ease`,
          pointerEvents: leaving ? "auto" : "none",
        }}
      />
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
          <WorldTransition
            onComplete={() => setTransitionDone(true)}
            description={KITCHEN_LEVEL_DESCRIPTION.replace("{laps}", String(RACE_LAPS))}
          />
        </div>
      )}
    </div>
  );
}
