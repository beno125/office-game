/** URL paths — Astro file routes should mirror these. */

export const SCENE_ROUTES = {
  game: "/",
  office: "/office",
  kitchen: "/kitchen",
  meetingRoom: "/meeting-room",
};

/** Playable worlds in order. N goes forward, B goes back (wraps). */
export const LEVEL_ORDER = [
  SCENE_ROUTES.office,
  SCENE_ROUTES.kitchen,
  SCENE_ROUTES.meetingRoom,
];

function levelUrl(path) {
  const base = String(import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return `${base}${path}`;
}

export function goToAdjacentLevel(currentPath, step) {
  const index = LEVEL_ORDER.indexOf(currentPath);
  if (index < 0 || typeof window === "undefined") return;
  const next =
    LEVEL_ORDER[(index + step + LEVEL_ORDER.length) % LEVEL_ORDER.length];
  const dest = levelUrl(next);
  const here = window.location.pathname.replace(/\/$/, "") || "/";
  const destPath = dest.replace(/\/$/, "") || "/";
  if (here === destPath) return;
  window.location.assign(dest);
}

/** The level after `currentPath` in LEVEL_ORDER, or null at the last one (no wrap). */
export function nextLevelPath(currentPath) {
  const index = LEVEL_ORDER.indexOf(currentPath);
  if (index < 0 || index >= LEVEL_ORDER.length - 1) return null;
  return LEVEL_ORDER[index + 1];
}

const LEVEL_TRANSITION_KEY = "office-game:level-transition";

/**
 * Go to level `path` (a full page load, so the old scene is torn down
 * completely). The next page plays the world transition as its loader.
 */
export function goToLevelWithTransition(path) {
  if (typeof window === "undefined" || !path) return;
  try {
    window.sessionStorage.setItem(LEVEL_TRANSITION_KEY, path);
  } catch (e) {}
  window.location.assign(levelUrl(path));
}

let _arrivedWithTransition = null;

/**
 * True if this page was reached through goToLevelWithTransition. The flag is
 * read (and cleared) once per page load, so a reload doesn't replay it.
 */
export function consumeLevelTransition(path) {
  if (typeof window === "undefined") return false;
  if (_arrivedWithTransition === null) {
    _arrivedWithTransition = "";
    try {
      _arrivedWithTransition = window.sessionStorage.getItem(LEVEL_TRANSITION_KEY) || "";
      window.sessionStorage.removeItem(LEVEL_TRANSITION_KEY);
    } catch (e) {}
  }
  return _arrivedWithTransition === path;
}
