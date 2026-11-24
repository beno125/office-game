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
 * Glow on the surroundings: one soft spot light just ahead of the lit lenses
 * (their weighted centre), aimed out and down along their facing: it lights
 * what's in front of the traffic light only, in the current colour, its
 * intensity per lit lamp (always in the scene, 0 when dark: no shader
 * recompiles).
 *
 * Reflections on the table: drawn by the table top's own shader
 * (attachTableReflection): per lit lamp a glossy highlight where its mirror
 * image is seen (the view reflected off the table against the direction to
 * the lamp), a little longer along the view than across, slightly broken up
 * like a wet surface, only where the lens faces. Part of the table's surface,
 * so it shows only on visible table pixels (anything in front hides it, and
 * nothing else gets it).
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
    perLamp: 1.1, // the light cast on the surroundings: the spot light's intensity per lit lamp (physical units)
    distance: 3, // its reach (model units): the table and cars just in front of the gantry
    decay: 2,
    coneDeg: 62, // half-angle of its cone
    penumbra: 1, // fully soft edge
    tiltDeg: 38, // aimed this far below the lenses' facing (out and down)
    front: 0.18, // its place ahead of the lenses (along their facing: just out of the lamp housing)
  },
  reflection: {
    strength: 0.9, // a lit lamp's reflection brightness on the table (added to the table's own light)
    width: 0.035, // across the view (direction difference: smaller = narrower)
    length: 0.09, // along the view (same units; a little longer than wide, like a light on a glossy floor)
    facingSoft: 0.35, // fades out as the view goes round to the lamp's side (0 from behind it)
    breakup: 0.45, // 0 = smooth, 1 = broken up like a wet surface
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
 * @returns {{ update(t: number|null): void, missing: string[], dispose(): void, center: import("three").Vector3|null }}
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

  // Each lamp: its lenses' centre and the way they face (the lens normal in world space).
  const box = new THREE.Box3();
  for (const L of lamps) {
    const m = byName(C.lights[L.index]);
    m.updateWorldMatrix(true, false);
    L.centre = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3());
    box.union(new THREE.Box3().setFromObject(m));
    const n = m.geometry.attributes.normal;
    L.facing = new THREE.Vector3(n.getX(0), n.getY(0), n.getZ(0))
      .applyMatrix3(new THREE.Matrix3().getNormalMatrix(m.matrixWorld))
      .normalize();
  }
  const facing = lamps.length ? lamps[0].facing.clone() : new THREE.Vector3(-1, 0, 0);

  // The glow on the surroundings: a spot light in front of the lit lenses (their weighted centre), aimed out and
  // down along their facing, with a soft wide cone: it lights what's in front of the traffic light (the table, the
  // cars, the block below) and nothing behind or above it (a point light here lit the stand's bar from 0.3 away and
  // everything behind the lights, through the body).
  const G = C.glow;
  const glow = new THREE.SpotLight(C.red, 0, G.distance, THREE.MathUtils.degToRad(G.coneDeg), G.penumbra, G.decay);
  const aimDir = facing.clone().setY(0).normalize().multiplyScalar(Math.cos(THREE.MathUtils.degToRad(G.tiltDeg)));
  aimDir.y = -Math.sin(THREE.MathUtils.degToRad(G.tiltDeg));
  root.add(glow);
  root.add(glow.target);
  const glowAt = new THREE.Vector3();
  if (!box.isEmpty()) box.getCenter(glowAt);
  /** The light at the lit lenses' centre (weights: how lit each is), `front` ahead of them. */
  function placeGlow(weights) {
    let sum = 0;
    const c = new THREE.Vector3();
    lamps.forEach((L, i) => {
      if (weights[i] > 0) {
        c.addScaledVector(L.centre, weights[i]);
        sum += weights[i];
      }
    });
    if (sum > 0) glowAt.copy(c.divideScalar(sum));
    glow.position.copy(glowAt).addScaledVector(facing, G.front);
    glow.target.position.copy(glow.position).add(aimDir);
    glow.updateMatrixWorld();
    glow.target.updateMatrixWorld();
  }

  // Reflections on the table: drawn by the table top's own shader (attachTableReflection), one glossy highlight per
  // lamp where its mirror image is (the view reflected off the table, against the direction to the lamp), a little
  // longer along the view than across it, only where the lamp's face points (not from behind it). Being part of the
  // table's own surface, they show only on visible table pixels: anything in front hides them, nothing else gets them.
  const R = C.reflection;
  const MAXL = 6;
  const reflUniforms = {
    uLampPos: { value: Array.from({ length: MAXL }, () => new THREE.Vector3()) },
    uLampCol: { value: Array.from({ length: MAXL }, () => new THREE.Vector3()) },
    uLampFacing: { value: facing.clone() },
    uReflShape: { value: new THREE.Vector3(R.width, R.length, R.facingSoft) },
    uReflBreakup: { value: R.breakup },
  };
  lamps.forEach((L, i) => {
    if (i < MAXL) reflUniforms.uLampPos.value[i].copy(L.centre);
  });
  const patched = new Set();
  /** Adds the lamps' reflections to the table top's material (chains any patch it already has). */
  function attachTableReflection(material) {
    if (!material || patched.has(material)) return;
    patched.add(material);
    const prev = material.onBeforeCompile;
    const prevKey = material.customProgramCacheKey;
    material.onBeforeCompile = function (shader, renderer) {
      if (prev) prev.call(this, shader, renderer);
      Object.assign(shader.uniforms, reflUniforms);
      shader.vertexShader = shader.vertexShader
        .replace("void main() {", "varying vec3 vLampWorld;\nvoid main() {")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvLampWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "void main() {",
          `varying vec3 vLampWorld;
uniform vec3 uLampPos[${MAXL}];
uniform vec3 uLampCol[${MAXL}];
uniform vec3 uLampFacing;
uniform vec3 uReflShape; // width (across), length (along the view), facing softness
uniform float uReflBreakup;
float lampHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lampNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lampHash(i), lampHash(i + vec2(1.0, 0.0)), u.x), mix(lampHash(i + vec2(0.0, 1.0)), lampHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {`,
        )
        .replace(
          "#include <opaque_fragment>",
          `{
  vec3 V = normalize(cameraPosition - vLampWorld);
  vec3 Rr = vec3(-V.x, V.y, -V.z); // the view reflected off the (level) table
  vec3 fwd = normalize(vec3(Rr.x, 0.0, Rr.z) + vec3(1e-5, 0.0, 0.0));
  vec3 side = vec3(-fwd.z, 0.0, fwd.x);
  float wet = mix(1.0, 0.35 + 1.1 * lampNoise(vLampWorld.xz * 9.0), uReflBreakup);
  vec3 refl = vec3(0.0);
  for (int i = 0; i < ${MAXL}; i++) {
    if (dot(uLampCol[i], uLampCol[i]) < 1e-8) continue;
    vec3 D = normalize(uLampPos[i] - vLampWorld);
    float across = dot(D - Rr, side);
    float along = D.y - Rr.y; // elevation difference: the streak runs along the view
    float lobe = exp(-(across * across) / (uReflShape.x * uReflShape.x) - (along * along) / (uReflShape.y * uReflShape.y));
    float faceOn = clamp(dot(uLampFacing, -D) / uReflShape.z, 0.0, 1.0); // the lens faces this point
    refl += uLampCol[i] * lobe * faceOn;
  }
  outgoingLight += refl * wet;
}
#include <opaque_fragment>`,
        );
    };
    material.customProgramCacheKey = function () {
      return (prevKey ? prevKey.call(this) : "") + "|startLightRefl";
    };
    material.needsUpdate = true;
  }

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
    const weights = [];
    lamps.forEach((L, i) => {
      const on = t == null ? 0 : ease(t + (N - L.index) * C.interval);
      weights.push(on);
      if (i < MAXL) reflUniforms.uLampCol.value[i].set(col.r, col.g, col.b).multiplyScalar(on * R.strength);
    });
    glow.color.copy(col);
    glow.intensity = G.perLamp * lit; // each lit lamp adds its share
    placeGlow(weights);
  }
  update(null);

  if (missing.length) console.warn("Start lights: missing in the model:", missing.join(", "));

  function dispose() {
    glow.removeFromParent();
    glow.target.removeFromParent();
    glow.dispose();
    for (const m of owned) m.dispose();
    for (const g of geometries) g.dispose();
    tex.dispose();
  }
  return { update, missing, dispose, attachTableReflection, center: box.isEmpty() ? null : box.getCenter(new THREE.Vector3()) };
}
