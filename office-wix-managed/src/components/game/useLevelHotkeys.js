import { useEffect } from "react";
import { goToAdjacentLevel } from "./sceneRoutes.js";

/** N = next level, B = previous level. */
export function useLevelHotkeys(currentPath) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.code === "KeyN") {
        event.preventDefault();
        goToAdjacentLevel(currentPath, 1);
        return;
      }
      if (event.code === "KeyB") {
        event.preventDefault();
        goToAdjacentLevel(currentPath, -1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentPath]);
}
