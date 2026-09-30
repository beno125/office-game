let mountEl = null;

export function setKitchenSceneMount(element) {
  mountEl = element;
}

export function getKitchenSceneMount() {
  return mountEl || document.body;
}
