/**
 * The start lights on the kitchen table (ul-kitchen28 "ramzor"): materials and
 * the start sequence, driven by the race's own countdown.
 *
 * Materials: ramzorMainStand white painted metal, counterBody very dark grey
 * plastic with a slight sheen, ramzorBody matte black plastic, ramzorLight1..6
 * red lenses. Each ramzorLight mesh is one column of two round lenses; the
 * model's UVs squash the lower one, so each lens gets its own UVs here (its
 * disc onto the texture's lens circle). Drawn from the reference photo: a dense
 * staggered grid of small round LEDs behind a clear lens, a thin bright rim.
 * Off: the lens is dark, its LED grid still faintly visible. On: the LEDs glow
 * in the current colour (emissive) and bloom through the kitchen bloom's
 * per-material weight (setBloomWeight): far brighter emissive would bloom by
 * the threshold but tone mapping turns such a red orange.
 *
 * Sequence (update(t), t = seconds relative to GO, from the race's countdown
 * timer: t = -timeLeft during the countdown, t = time since GO while racing):
 * light k (0-based, of N) comes on red at t = -(N - k) * interval, so the last
 * one is lit `interval` before GO; at t = 0 every light turns green at once.
 * Each change fades over `fadeSec`. With interval 0.5 and 6 lights the first
 * comes on as the countdown starts (GO - 3 s = the "3"). Off outside the
 * countdown / race.
 *
 * Glow on the surroundings: one small point light in front of the lenses, its
 * colour the current one, its intensity × the share of lit lenses (always in
 * the scene, 0 when dark: no shader recompiles).
 */
import { setBloomWeight } from "../game/thresholdBloom.js";

export const KITCHEN_START_LIGHTS = {
  lights: ["ramzorLight1", "ramzorLight2", "ramzorLight3", "ramzorLight4", "ramzorLight5", "ramzorLight6"],
  interval: 0.5, // seconds between lights coming on (red)
  fadeSec: 0.08, // a lamp's fade on / off and red -> green: quick, not instant
  red: 0xff0000, // pure: any green in it turns orange at this brightness
  green: 0x00ff2a,
  emissive: 3, // a lit lens's emissive intensity (higher turns the red orange under tone mapping)
  bloom: 1, // a lit lens's bloom weight (0..1 share of its colour; kitchen bloom, setBloomWeight)
  offColor: 0x2a1414, // an unlit lens: dark, a faint red-brown
  offGlow: 0x3a2a2a, // an unlit lens's faint own light, so its LED grid still shows (the lenses face away from most lights)
  offGlowIntensity: 1.2,
  offRoughness: 0.35, // the lens glass
  glow: {
    intensity: 1.6, // the point light at all lenses lit (physical units)
    distance: 2.2, // its reach (model units)
    decay: 2,
    offset: -0.25, // in front of the lenses, along their facing (x; they face -x)
  },
  stand: { color: 0xecebe6, roughness: 0.6, metalness: 0.15 }, // ramzorMainStand: painted iron
  counter: { color: 0x141518, roughness: 0.42, metalness: 0 }, // counterBody: dark grey-black plastic, slight sheen
  body: { color: 0x0b0b0c, roughness: 1, metalness: 0 }, // ramzorBody: fully matte black plastic
  texture: {
    size: 512,
    // The lens circle in UV space (the model's mapping): centre and radius.
    u: 0.25,
    v: 0.75,
    r: 0.234,
    ledsAcross: 23, // LEDs across the lens's diameter
    ledFill: 0.72, // an LED's diameter / the grid's pitch
  },
};

/**
 * The lens texture (white LEDs on dark, so the material's colour / emissive tints it): a staggered grid of round LEDs
 * with a soft bright core each, inside the lens circle, a thin rim. Outside the circle: black.
 */
function makeLensTexture(THREE, T) {
  const c = document.createElement("canvas");
  c.width = c.height = T.size;
  const g = c.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, T.size, T.size);
  const cx = T.u * T.size;
  const cy = (1 - T.v) * T.size;
  const R = T.r * T.size;
  // The lens behind the LEDs: a little light so the off state isn't flat.
  const bg = g.createRadialGradient(cx, cy, 0, cx, cy, R);
  bg.addColorStop(0, "#2a2a2a");
  bg.addColorStop(1, "#141414");
  g.fillStyle = bg;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();
  const pitch = (2 * R) / T.ledsAcross;
  const rowStep = (pitch * Math.sqrt(3)) / 2;
  const ledR = (pitch * T.ledFill) / 2;
  const inner = R - pitch * 0.6;
  for (let row = -Math.ceil(R / rowStep); row <= Math.ceil(R / rowStep); row++) {
    const y = cy + row * rowStep;
    const shift = row % 2 ? pitch / 2 : 0;
    for (let col = -Math.ceil(R / pitch) - 1; col <= Math.ceil(R / pitch) + 1; col++) {
      const x = cx + col * pitch + shift;
      if (Math.hypot(x - cx, y - cy) > inner) continue;
      const led = g.createRadialGradient(x, y, 0, x, y, ledR);
      led.addColorStop(0, "#ffffff");
      led.addColorStop(0.55, "#d8d8d8");
      led.addColorStop(1, "#5a5a5a");
      g.fillStyle = led;
      g.beginPath();
      g.arc(x, y, ledR, 0, Math.PI * 2);
      g.fill();
    }
  }
  // The rim (the lens's chrome edge).
  g.strokeStyle = "#9a9a9a";
  g.lineWidth = Math.max(2, R * 0.035);
  g.beginPath();
  g.arc(cx, cy, R - g.lineWidth / 2, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * A lamp's own UVs: its two lenses (the upper / lower half of its local bounds, along local y) each mapped onto the
 * texture's lens circle (centre T.u, T.v, radius T.r). The lenses lie in the local y / z plane.
 */
function lensUVs(THREE, geometry, T) {
  const g = geometry.clone();
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const midY = (bb.min.y + bb.max.y) / 2;
  const pos = g.attributes.position;
  const halves = [new THREE.Box3(), new THREE.Box3()];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) halves[pos.getY(i) >= midY ? 0 : 1].expandByPoint(v.fromBufferAttribute(pos, i));
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const h = halves[pos.getY(i) >= midY ? 0 : 1];
    const cy = (h.min.y + h.max.y) / 2, ry = (h.max.y - h.min.y) / 2 || 1;
    const cz = (h.min.z + h.max.z) / 2, rz = (h.max.z - h.min.z) / 2 || 1;
    uv[i * 2] = T.u + ((pos.getZ(i) - cz) / rz) * T.r;
    uv[i * 2 + 1] = T.v + ((pos.getY(i) - cy) / ry) * T.r;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

/**
 * @param {object} o
 * @param {typeof import("three")} o.THREE
 * @param {import("three").Object3D} o.root  the kitchen model
 * @returns {{ update(t: number|null): void, missing: string[], dispose(): void }}
 */
export function createStartLights({ THREE, root }) {
  const C = KITCHEN_START_LIGHTS;
  const byName = (n) => {
    const m = root.getObjectByName(n);
    return m && m.isMesh ? m : null;
  };
  const missing = [];
  const owned = [];
  const setMat = (name, mat) => {
    const m = byName(name);
    if (!m) return missing.push(name);
    m.material = mat;
    owned.push(mat);
  };
  setMat("ramzorMainStand", new THREE.MeshStandardMaterial(C.stand));
  setMat("counterBody", new THREE.MeshStandardMaterial(C.counter));
  setMat("ramzorBody", new THREE.MeshStandardMaterial(C.body));

  const tex = makeLensTexture(THREE, C.texture);
  const red = new THREE.Color(C.red);
  const green = new THREE.Color(C.green);
  const lamps = []; // { mat, index }
  const geometries = []; // the lamps' geometry copies (their own UVs)
  C.lights.forEach((name, index) => {
    const m = byName(name);
    if (!m) return missing.push(name);
    const mat = new THREE.MeshStandardMaterial({
      color: C.offColor,
      map: tex,
      roughness: C.offRoughness,
      metalness: 0,
      emissive: 0x000000,
      emissiveMap: tex,
      emissiveIntensity: 0,
      side: THREE.DoubleSide,
    });
    setBloomWeight(mat, 0);
    m.geometry = lensUVs(THREE, m.geometry, C.texture);
    geometries.push(m.geometry);
    m.material = mat;
    owned.push(mat);
    lamps.push({ mat, index });
  });

  // The glow on the stand and around: in front of the lenses' centre.
  const box = new THREE.Box3();
  for (const n of C.lights) {
    const m = byName(n);
    if (m) box.union(new THREE.Box3().setFromObject(m));
  }
  const glow = new THREE.PointLight(C.red, 0, C.glow.distance, C.glow.decay);
  if (!box.isEmpty()) {
    box.getCenter(glow.position);
    glow.position.x += C.glow.offset;
  }
  root.add(glow);

  const N = C.lights.length;
  const ease = (x) => Math.min(1, Math.max(0, x / C.fadeSec));
  const col = new THREE.Color();
  const offGlow = new THREE.Color(C.offGlow).multiplyScalar(C.offGlowIntensity);
  const lit1 = new THREE.Color();
  /** t: seconds relative to GO (negative before it), or null when the lights are dark. */
  function update(t) {
    let lit = 0;
    const g = t == null ? 0 : ease(t); // the green share (0 before GO)
    col.copy(red).lerp(green, g);
    for (const L of lamps) {
      const on = t == null ? 0 : ease(t + (N - L.index) * C.interval);
      // Emissive: the faint unlit glow, fading into the lit colour.
      L.mat.emissive.copy(offGlow).multiplyScalar(1 - on).add(lit1.copy(col).multiplyScalar(on * C.emissive));
      L.mat.emissiveIntensity = 1;
      L.mat.userData.bloomWeight.value = on * C.bloom;
      lit += on;
    }
    glow.color.copy(col);
    glow.intensity = lamps.length ? (C.glow.intensity * lit) / N : 0;
  }
  update(null);

  if (missing.length) console.warn("Start lights: missing in the model:", missing.join(", "));

  function dispose() {
    glow.removeFromParent();
    glow.dispose();
    for (const m of owned) m.dispose();
    for (const g of geometries) g.dispose();
    tex.dispose();
  }
  return { update, missing, dispose };
}
