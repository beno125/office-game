import { useEffect, useRef, useState } from "react";
import { onOfficeSceneEvent } from "./game/officeSceneEvents.js";
import { SCENE_ROUTES } from "./game/sceneRoutes.js";
import { useLevelHotkeys } from "./game/useLevelHotkeys.js";
import { setOfficeSceneMount } from "./office-copy/officeSceneMount.js";
import ControlsGuide from "./game/ControlsGuide.jsx";
import { Label } from "./game/ui/ui.jsx";
import GameMenu from "./game/ui/GameMenu.jsx";

/** Loader fade-out once the scene is ready (ms); the intro starts as it begins. */
const OFFICE_LOADER_FADE_MS = 450;

/**
 * @param {object} props
 * @param {boolean} [props.hideModuleLoadingOverlay] — GameLoader owns the loading UI
 * @param {() => void} [props.onModuleReady] — fired when the scene JS chunk has loaded
 * @param {() => void} [props.onTransitionToKitchen] — swaps the active world
 */
export default function OfficeSceneCopy({
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
  // The loader covers the canvas until the scene is ready (car placed, gums
  // settled, first intro shot drawn), so the first frame seen is the intro.
  const [sceneReady, setSceneReady] = useState(false);
  const [loaderGone, setLoaderGone] = useState(false);
  // The intro has ended and the player has control: show the controls guide.
  const [introDone, setIntroDone] = useState(false);
  useLevelHotkeys(SCENE_ROUTES.office);
  // Game menu: shown once the player has control, hidden once the office leaves for the kitchen.
  const moduleRef = useRef(null);
  const menuFlagsRef = useRef({ introDone: false, leaving: false });
  menuFlagsRef.current.introDone = introDone;
  const getMenuState = () => {
    const f = menuFlagsRef.current;
    return { visible: f.introDone && !f.leaving && !!moduleRef.current, inPlay: false };
  };
  const pauseForMenu = (paused) => moduleRef.current?.setOfficeSceneRendering?.(!paused);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let disposed = false;
    let sceneModule = null;
    setOfficeSceneMount(root);
    const stopKitchenTransition = onOfficeSceneEvent(
      "transition-to-kitchen",
      () => {
        menuFlagsRef.current.leaving = true;
        onTransitionRef.current?.();
      },
    );
    let fadeTimer = 0;
    const revealScene = () => {
      if (disposed || !sceneModule) return;
      setSceneReady(true);
      sceneModule.startOfficeIntro();
      fadeTimer = window.setTimeout(() => setLoaderGone(true), OFFICE_LOADER_FADE_MS);
    };
    const stopSceneReady = onOfficeSceneEvent("office-scene-ready", revealScene);
    const stopIntroDone = onOfficeSceneEvent("office-intro-done", () => {
      if (!disposed) setIntroDone(true);
    });
    import("./office-copy/officeSceneModule.js")
      .then((module) => {
        sceneModule = module;
        moduleRef.current = module;
        module.setOfficeSceneRendering(!disposed);
        if (disposed) return;
        setPhase("ready");
        onReadyRef.current?.();
        if (module.isOfficeSceneReady()) revealScene();
        if (module.isOfficeIntroDone()) setIntroDone(true);
      })
      .catch((err) => {
        if (disposed) return;
        console.error("[OfficeSceneCopy] failed to load scene module:", err);
        setPhase("error");
      });

    return () => {
      disposed = true;
      window.clearTimeout(fadeTimer);
      stopKitchenTransition();
      stopSceneReady();
      stopIntroDone();
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
    color: "var(--wx-text-2)",
    font: "var(--wx-type-body)",
    textAlign: "center",
    padding: "1rem",
    pointerEvents: "none",
    zIndex: 2147483000,
  };

  const showModuleOverlay =
    !hideModuleLoadingOverlay && (phase === "loading" || phase === "error");
  const showSceneLoader = !hideModuleLoadingOverlay && phase !== "error" && !loaderGone;

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
      <ControlsGuide active={introDone} />
      <GameMenu level={SCENE_ROUTES.office} getState={getMenuState} onPause={pauseForMenu} />
      {showSceneLoader && (
        <div
          style={{
            ...overlayStyle,
            background: "var(--wx-bg)",
            opacity: sceneReady ? 0 : 1,
            transition: `opacity ${OFFICE_LOADER_FADE_MS}ms ease`,
          }}
        >
          <Label marker="var(--wx-amber)">Loading 3D scene…</Label>
        </div>
      )}
      {showModuleOverlay && phase === "error" && (
        <div style={overlayStyle}>
          Scene bundle failed to load. Open DevTools → Console (F12) and check for red errors
          (network 404 on <code style={{ color: "var(--wx-action-hover)" }}>/office-scene-optimized/</code> is common).
        </div>
      )}
    </div>
  );
}
