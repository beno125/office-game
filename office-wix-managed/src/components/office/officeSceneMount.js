/** Set before dynamically importing `officeSceneModule.js` so the canvas mounts inside React. */
let mountEl = null;

export function setOfficeSceneMount(el) {
  mountEl = el;
}

export function getOfficeSceneMount() {
  return mountEl || document.body;
}
