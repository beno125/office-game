import { useEffect, useRef, useState } from "react";
import { setMeetingRoomSceneMount } from "../meeting-room/meetingRoomSceneMount.js";
import { onMeetingRoomSceneEvent } from "./meetingRoomSceneEvents.js";
import { SCENE_ROUTES } from "./sceneRoutes.js";
import { useLevelHotkeys } from "./useLevelHotkeys.js";

export default function MeetingRoomScene() {
  const rootRef = useRef(null);
  const [phase, setPhase] = useState("loading");
  const [sceneReady, setSceneReady] = useState(false);
  useLevelHotkeys(SCENE_ROUTES.meetingRoom);

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
        module.setMeetingRoomSceneRendering(!disposed);
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
          ? "Add meeting-room.gltf to public/meeting-room-optimized/"
          : "Loading meeting room…"}
      </div>
    </div>
  );
}
