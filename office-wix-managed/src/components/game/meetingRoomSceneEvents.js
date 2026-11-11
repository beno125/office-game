const TARGET = typeof window !== "undefined" ? window : globalThis;

const eventName = (type) => `meeting-room-scene:${type}`;

export function emitMeetingRoomSceneEvent(type, detail) {
  TARGET.dispatchEvent(new CustomEvent(eventName(type), { detail }));
}

export function onMeetingRoomSceneEvent(type, handler) {
  const name = eventName(type);
  const listener = (event) => handler(event.detail);
  TARGET.addEventListener(name, listener);
  return () => TARGET.removeEventListener(name, listener);
}
