import { useEffect, useRef, useState } from "react";
import { setMeetingRoomSceneMount } from "../meeting-room/meetingRoomSceneMount.js";
import { onMeetingRoomSceneEvent } from "./meetingRoomSceneEvents.js";
import { SCENE_ROUTES } from "./sceneRoutes.js";
import { useLevelHotkeys } from "./useLevelHotkeys.js";
import { Label } from "./ui/ui.jsx";
import GameMenu from "./ui/GameMenu.jsx";
import MeetingRoomSignTransition from "./MeetingRoomSignTransition.jsx";

/** Sign loader fade-out once its lights have dimmed. */
const SIGN_FADE_MS = 700;

export default function MeetingRoomScene() {
  const rootRef = useRef(null);
  const [phase, setPhase] = useState("loading");
  const [sceneReady, setSceneReady] = useState(false);
  // The lightbox sign is the loader: it ends (lights dim) once the room is
  // ready, then fades out and is removed.
  const [signFading, setSignFading] = useState(false);
  const [signGone, setSignGone] = useState(false);
  // Warm-up under the sign (texture uploads, shader compiles): the room only
  // starts rendering once it's done and the sign begins its exit.
  const [prepProgress, setPrepProgress] = useState(0);
  const [prepared, setPrepared] = useState(false);
  const moduleRef = useRef(null);
  // Game menu: shown once the player has control (not over the sign or the intro).
  const signGoneRef = useRef(false);
  signGoneRef.current = signGone;
  const getMenuState = () => {
    const st = moduleRef.current?.getMeetingRoomMenuState?.();
    return { visible: !!(st && st.playerHasControl && signGoneRef.current), inPlay: !!(st && st.inPlay) };
  };
  const pauseForMenu = (paused) => moduleRef.current?.setMeetingRoomSceneRendering?.(!paused);
  const startedRef = useRef(false);
  // The warm-up starts once the sign is fully shown (its loader step) and the
  // module is in, whichever comes last; the room keeps loading meanwhile.
  const prepRef = useRef({ requested: false, started: false, disposed: false });
  const startPrep = () => {
    const P = prepRef.current;
    const module = moduleRef.current;
    if (P.started || P.disposed || !P.requested || !module) return;
    P.started = true;
    if (!module.prepareMeetingRoomForReveal) {
      setPrepared(true);
      return;
    }
    module
      .prepareMeetingRoomForReveal((p) => {
        if (!prepRef.current.disposed) setPrepProgress(p);
      })
      .catch((error) => console.warn("[MeetingRoomScene] warm-up failed:", error))
      .finally(() => {
        if (!prepRef.current.disposed) setPrepared(true);
      });
  };
  const requestPrep = () => {
    prepRef.current.requested = true;
    startPrep();
  };
  const startRoom = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    moduleRef.current?.setMeetingRoomSceneRendering(true);
  };
  useLevelHotkeys(SCENE_ROUTES.meetingRoom);

  useEffect(() => {
    if (!signFading) return;
    const timer = window.setTimeout(() => setSignGone(true), SIGN_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [signFading]);

  // The sign has fully finished: the room's cinematic intro starts.
  useEffect(() => {
    if (signGone) moduleRef.current?.startMeetingRoomIntro?.();
  }, [signGone]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let disposed = false;
    let sceneModule = null;
    setMeetingRoomSceneMount(root);
    const unsubscribeReady = onMeetingRoomSceneEvent("ready", () => {
      if (disposed) return;
      setSceneReady(true);
      setPhase("ready");
    });
    const unsubscribeError = onMeetingRoomSceneEvent("error", () => {
      if (disposed) return;
      setPhase("error");
    });

    import("../meeting-room/meetingRoomSceneModule.js")
      .then((module) => {
        sceneModule = module;
        moduleRef.current = module;
        // The warm-up runs under the sign (prepareMeetingRoomForReveal), not on load.
        module.deferMeetingRoomWarmup?.();
        // The cinematic intro plays once the sign has fully gone.
        module.enableMeetingRoomIntro?.();
        // Held until the sign's exit (or straight away if there's no warm-up).
        module.setMeetingRoomSceneRendering(!disposed && (startedRef.current || !module.prepareMeetingRoomForReveal));
        if (!disposed) startPrep();
        if (disposed || !module.isMeetingRoomSceneReady()) return;
        setSceneReady(true);
        setPhase("ready");
      })
      .catch((error) => {
        if (disposed) return;
        console.error("[MeetingRoomScene] failed to load:", error);
        setPhase("error");
      });

    return () => {
      disposed = true;
      prepRef.current.disposed = true;
      unsubscribeReady();
      unsubscribeError();
      sceneModule?.setMeetingRoomSceneRendering(false);
      setMeetingRoomSceneMount(null);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="meeting-room-scene-root"
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
      <GameMenu level={SCENE_ROUTES.meetingRoom} getState={getMenuState} onPause={pauseForMenu} />
      {!signGone && phase !== "error" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 30,
            opacity: signFading ? 0 : 1,
            transition: `opacity ${SIGN_FADE_MS}ms ease`,
            pointerEvents: signFading ? "none" : "auto",
          }}
        >
          <MeetingRoomSignTransition
            ready={sceneReady && prepared}
            roomLoaded={sceneReady}
            prepProgress={prepProgress}
            onLoadingStart={requestPrep}
            onExit={startRoom}
            onFinished={() => {
              startRoom();
              setSignFading(true);
            }}
          />
        </div>
      )}
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
          color: "var(--wx-text-2)",
          background: "var(--wx-bg)",
          opacity: phase === "error" ? 1 : 0,
          transition: "opacity 650ms ease",
          pointerEvents: "none",
        }}
      >
        <Label marker={phase === "error" ? "var(--wx-red)" : "var(--wx-amber)"}>
          {phase === "error"
            ? "Add meeting-room.gltf to public/meeting-room-optimized/"
            : "Loading meeting room…"}
        </Label>
      </div>
    </div>
  );
}
