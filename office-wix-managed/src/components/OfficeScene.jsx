import { useEffect, useRef } from "react";
import { setOfficeSceneMount } from "./office/officeSceneMount.js";

export default function OfficeScene() {
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    setOfficeSceneMount(root);
    import("./office/officeSceneModule.js").catch((err) => {
      console.error("[OfficeScene] failed to load scene module:", err);
    });

    return () => {
      setOfficeSceneMount(null);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="office-scene-root"
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
    </div>
  );
}
