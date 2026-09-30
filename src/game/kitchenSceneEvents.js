const TARGET = typeof window !== "undefined" ? window : globalThis;

const eventName = (type) => `kitchen-scene:${type}`;

export function emitKitchenSceneEvent(type, detail) {
  TARGET.dispatchEvent(new CustomEvent(eventName(type), { detail }));
}

export function onKitchenSceneEvent(type, handler) {
  const name = eventName(type);
  const listener = (event) => handler(event.detail);
  TARGET.addEventListener(name, listener);
  return () => TARGET.removeEventListener(name, listener);
}
