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
