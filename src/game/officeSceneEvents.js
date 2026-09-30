/** Scene → UI lifecycle events (no Three.js imports). */

const TARGET = typeof window !== "undefined" ? window : globalThis;

function eventName(type) {
  return `office-scene:${type}`;
}

export function emitOfficeSceneEvent(type, detail) {
  TARGET.dispatchEvent(new CustomEvent(eventName(type), { detail }));
}

/** @returns {() => void} unsubscribe */
export function onOfficeSceneEvent(type, handler) {
  const name = eventName(type);
  const wrapped = (e) => handler(e.detail);
  TARGET.addEventListener(name, wrapped);
  return () => TARGET.removeEventListener(name, wrapped);
}
