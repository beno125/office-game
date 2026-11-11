let mountEl = null;

export function setMeetingRoomSceneMount(element) {
  mountEl = element;
}

export function getMeetingRoomSceneMount() {
  return mountEl || document.body;
}
