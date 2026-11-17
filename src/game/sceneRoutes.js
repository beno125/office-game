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

/**
 * Go to level `path` with a full page load, so the old scene is torn down
 * completely. The next level's page shows its own loading transition.
 */
export function goToLevelWithTransition(path) {
  if (typeof window === "undefined" || !path) return;
  window.location.assign(levelUrl(path));
}

/**
 * Level transitions keep their level description fully readable at least this
 * long (from the moment it's fully shown), even if loading is very fast.
 */
export const LEVEL_DESCRIPTION_MIN_READ_MS = 5500;
