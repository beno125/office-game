import { useEffect, useRef, useState } from "react";
import { LEVEL_ORDER, SCENE_ROUTES } from "./sceneRoutes.js";

/**
 * Loader before the meeting room: an illuminated lightbox sign hanging in a
 * dark room (meeting-room-sign.gltf: base, cup, lights). The meeting room loads
 * underneath; the sign's printed loader shows its real download progress. When
 * the room is ready the bar completes, the lights dim and onFinished() is
 * called (the page then fades this overlay out).
 *
 * Progress: the meeting room module isn't changed, so its own model download
 * is measured here, by wrapping window.fetch while this loader is up and
 * counting the bytes of the meeting room's .gltf as the loader reads them.
 */

const SIGN_GLTF = "meeting-room-sign.gltf";
const SIGN_DIR = "meeting-room-optimized/";
/** Node in the meeting room model whose material colour the sign's base takes. */
const TABLE_NODE_NAME = "tablePlate";

/** Slightly warm white (about 4000 K, a faint warm tint). */
const SIGN_LIGHT_COLOR = 0xfff0dc;
/** Printed ink on the face. */
const SIGN_INK = "#1b1e2a";
const SIGN_BACKGROUND = 0x04060d;
const SIGN_WALL_COLOR = 0x070b18;

/** Timings (ms). */
// Sequence: FADE_IN → LOADING → HOLD → EXIT, each step only after the previous one.
const SIGN_FADE_IN_MS = 1500; // the whole sign fades in (loader held at 0%)
const SIGN_LIGHTS_ON_DELAY_MS = 250; // into the fade-in, the lights come on…
const SIGN_FLICKER_MS = 900; // …with a short flicker, steady before the fade-in ends
const SIGN_LOADER_MIN_MS = 1800; // the bar takes at least this long from 0% to 100%
const SIGN_HOLD_MS = 1000; // full sign, bar at 100%, before the exit
const SIGN_DIM_MS = 700; // exit: lights dim, then onFinished() (the page fades out)
const SIGN_COLOR_WAIT_MS = 900; // longest wait for the table colour before the lights come on

/** Camera: the sign fills this much of the smaller screen dimension, then pushes in. */
const SIGN_FILL = 0.78;
const SIGN_PUSH_IN = 0.07; // fraction of the distance over SIGN_PUSH_SEC
const SIGN_PUSH_SEC = 9;
const SIGN_DRIFT = 0.025; // slow drift amplitude (× sign size)
const SIGN_DRIFT_RATE = 0.16; // Hz

/** Progress split: download, then parse / scene set-up until "ready". */
const SIGN_DOWNLOAD_SHARE = 0.86;
const SIGN_PARSE_SEC = 4; // time constant of the parse share while waiting for "ready"

/** Bloom: soft glow of the face, kept low so the ink stays crisp. */
const SIGN_BLOOM_STRENGTH = 0.32;
const SIGN_BLOOM_RADIUS = 0.4;
const SIGN_BLOOM_THRESHOLD = 0.94;
/** Face brightness when fully lit (the bands just reach the bloom threshold). */
const SIGN_FACE_BRIGHTNESS = 1.0;
/** Light intensities at full power. */
const SIGN_SPILL_INTENSITY = 1.6;
const SIGN_BACK_INTENSITY = 0.9;

/** Face texture: light bands where the tubes are, a soft fall-off at the edges. */
const SIGN_BAND_GAIN = 0.11; // band brightness above the even glow
const SIGN_BAND_WIDTH = 0.3; // gaussian sigma, × tube spacing
const SIGN_EDGE_FALLOFF = 0.07;

const SIGN_FONT_FAMILY = "Wix Madefor Display";
const SIGN_FONT_URL =
  "https://fonts.googleapis.com/css2?family=Wix+Madefor+Display:wght@400;500;700&display=swap";
const SIGN_FONT_STACK = `"${SIGN_FONT_FAMILY}", "Avenir Next", Avenir, "Century Gothic", "Segoe UI", system-ui, sans-serif`;
const SIGN_FONT_WAIT_MS = 1500;

function assetUrl(path) {
  const base = String(import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
  return base + path;
}

// ---------------------------------------------------------------------------
// Download progress of the meeting room model (fetch wrapper)

function isMeetingRoomModelUrl(url) {
  if (!url || url.startsWith("data:")) return false;
  const path = url.split("?")[0];
  return path.includes(SIGN_DIR) && /\.(gltf|glb|bin)$/i.test(path) && !path.endsWith(SIGN_GLTF);
}

function installModelProgress() {
  const originalFetch = window.fetch;
  const state = { loaded: 0, total: 0, started: 0, finished: 0, unknownSize: false, gltfUrl: null };
  const wrapped = function (input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    const result = originalFetch.apply(this, arguments);
    if (!isMeetingRoomModelUrl(String(url || ""))) return result;
    state.started++;
    if (!state.gltfUrl && /\.gltf(\?|$)/i.test(url)) state.gltfUrl = new URL(url, location.href).href;
    return result.then(
      (res) => {
        if (!res.ok || !res.body || typeof ReadableStream === "undefined") {
          state.finished++;
          return res;
        }
        const len =
          Number(res.headers.get("Content-Length")) || Number(res.headers.get("X-File-Size")) || 0;
        if (len > 0 && !res.headers.get("Content-Encoding")) state.total += len;
        else state.unknownSize = true;
        const reader = res.body.getReader();
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          state.finished++;
        };
        const stream = new ReadableStream({
          async pull(controller) {
            try {
              const { done, value } = await reader.read();
              if (done) {
                close();
                controller.close();
                return;
              }
              state.loaded += value.byteLength;
              controller.enqueue(value);
            } catch (error) {
              close();
              controller.error(error);
            }
          },
          cancel(reason) {
            close();
            return reader.cancel(reason);
          },
        });
        return new Response(stream, { status: res.status, statusText: res.statusText, headers: res.headers });
      },
      (error) => {
        state.finished++;
        throw error;
      },
    );
  };
  window.fetch = wrapped;
  return {
    state,
    originalFetch,
    /** Download fraction 0..1 (estimated if the size isn't known). */
    fraction() {
      if (!state.started) return 0;
      if (state.started === state.finished) return 1;
      if (!state.unknownSize && state.total > 0) return Math.min(0.999, state.loaded / state.total);
      return 1 - Math.exp(-state.loaded / 25e6); // no size: an estimate that never reaches 1
    },
    restore() {
      if (window.fetch === wrapped) window.fetch = originalFetch;
    },
  };
}

// ---------------------------------------------------------------------------
// The table colour, read from the start of the meeting room glTF (the JSON
// before "accessors" holds nodes / materials / meshes; the rest is cancelled)

async function readTableColor(THREE, gltfUrl, fetchFn) {
  const res = await fetchFn(gltfUrl, { cache: "force-cache" });
  if (!res.ok || !res.body) throw new Error("table colour: " + res.status);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let cut = -1;
  while (cut < 0 && text.length < 4e6) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    cut = text.search(/[\r\n]\s*"(accessors|bufferViews|buffers)"\s*:/);
  }
  reader.cancel().catch(() => {});
  const json = cut < 0 ? text : text.slice(0, cut).replace(/,\s*$/, "") + "}";
  const gltf = JSON.parse(json);
  const node = (gltf.nodes || []).find((n) => n.name === TABLE_NODE_NAME);
  const mesh = node && gltf.meshes && gltf.meshes[node.mesh];
  const prim = mesh && mesh.primitives && mesh.primitives[0];
  const mat = prim && prim.material != null ? gltf.materials[prim.material] : null;
  if (!mat) throw new Error("table colour: no material on " + TABLE_NODE_NAME);
  const pbr = mat.pbrMetallicRoughness || {};
  const f = pbr.baseColorFactor || [1, 1, 1, 1];
  const color = new THREE.Color().setRGB(f[0], f[1], f[2], THREE.LinearSRGBColorSpace);
  // Colour only from a texture: its average colour (× the factor).
  if (pbr.baseColorTexture && gltf.textures && gltf.images) {
    const tex = gltf.textures[pbr.baseColorTexture.index];
    const img = tex && gltf.images[tex.source];
    if (img && img.uri) {
      const avg = await averageImageColor(THREE, new URL(img.uri, gltfUrl).href);
      color.multiply(avg);
    }
  }
  return { color, source: pbr.baseColorTexture ? "texture average" : "baseColorFactor" };
}

function averageImageColor(THREE, url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 32;
      const ctx = c.getContext("2d");
      ctx.drawImage(im, 0, 0, 32, 32);
      const d = ctx.getImageData(0, 0, 32, 32).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
      }
      const n = d.length / 4;
      resolve(new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace));
    };
    im.onerror = reject;
    im.src = url;
  });
}

// ---------------------------------------------------------------------------
// Font

let _fontPromise = null;
/** The web font's weights are loaded (until then the face uses the fallback stack). */
let _signFontReady = false;
const SIGN_FALLBACK_STACK = `"Avenir Next", Avenir, "Century Gothic", "Segoe UI", system-ui, sans-serif`;
const signFontStack = () => (_signFontReady ? SIGN_FONT_STACK : SIGN_FALLBACK_STACK);

/**
 * Loads 400 / 500 / 700. Waits for the stylesheet first: document.fonts.load()
 * before its @font-face rules exist resolves with nothing, and the canvas would
 * then borrow any loaded weight of the family (the meeting room loads 800).
 */
function loadSignFont() {
  if (_fontPromise) return _fontPromise;
  let link = document.querySelector("link[data-sign-font]");
  const sheetLoaded = new Promise((resolve, reject) => {
    if (link && link.sheet) return resolve();
    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = SIGN_FONT_URL;
      link.dataset.signFont = "1";
      document.head.appendChild(link);
    }
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => reject(new Error("sign font stylesheet failed")), { once: true });
  });
  _fontPromise = sheetLoaded
    .then(() =>
      Promise.all(
        [400, 500, 700].map((w) => document.fonts.load(`${w} 64px "${SIGN_FONT_FAMILY}"`, "Meeting Room 0123456789%")),
      ),
    )
    .then(() => {
      _signFontReady = [400, 500, 700].every((w) => document.fonts.check(`${w} 64px "${SIGN_FONT_FAMILY}"`));
      return _signFontReady;
    });
  return _fontPromise;
}

// ---------------------------------------------------------------------------
// Face artwork (canvas): even warm glow, soft vertical bands at the tubes, text

/** Layout in face units (0..1 from the top-left), like the reference's hierarchy. */
/** The sign's big title, one entry per line. */
const SIGN_TITLE_LINES = ["Meeting", "Room", "Madness"];
/** The title's widest line stays within this width (face units); wider → scaled down. */
const SIGN_TITLE_MAX_WIDTH = 0.72;
/** What the level is about: a subtitle under the title (wrapped, not shrunk). */
const SIGN_DESCRIPTION = "Push your rivals off the table. Last car standing wins!";
/** The description wraps within this width (face units). */
const SIGN_DESCRIPTION_MAX_WIDTH = 0.76;

const FACE_LAYOUT = {
  marginX: 0.105,
  kickerY: 0.17, // small line above the title
  kickerSize: 0.046,
  titleSize: 0.158, // largest title size (two lines fit at this size)
  titleGap: 0.06, // from the small line's baseline to the title's cap top
  titleCapEm: 0.73, // cap height of the typeface (× size)
  titlePitchEm: 1.013, // baseline to baseline (× size)
  loaderGapEm: 0.7, // last title baseline to the loader (× size), when there's no description
  loaderMaxY: 0.745, // a taller block shrinks the title so the loader stays above this
  descSize: 0.048, // description: the reference's smaller line style
  descGapEm: 0.36, // last title baseline to the description's x-height top (× title size)
  descPitchEm: 1.32, // description baseline to baseline (× its size)
  loaderAfterDesc: 0.08, // description's last baseline to the loader
  loaderBarW: 0.5,
  loaderBarH: 0.0065,
  loaderSize: 0.05,
  footY: 0.865, // small line at the bottom
  footSize: 0.046,
};

/** Description lines: one per sentence if each fits, else word-wrapped. */
function wrapDescription(ctx, S, text) {
  if (!text) return [];
  const L = FACE_LAYOUT;
  ctx.font = `400 ${L.descSize * S}px ${signFontStack()}`;
  const maxW = SIGN_DESCRIPTION_MAX_WIDTH * S;
  const fits = (t) => ctx.measureText(t).width <= maxW;
  if (fits(text)) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g)?.map((t) => t.trim()) || [];
  if (sentences.length > 1 && sentences.every(fits)) return sentences;
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? line + " " + word : word;
    if (line && !fits(next)) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Face layout: title size and baselines, description lines and baselines, and
 * the loader's position. The title shrinks (never the description) so the
 * whole block keeps the loader above loaderMaxY.
 */
function faceLayout(ctx, S, content) {
  const L = FACE_LAYOUT;
  const n = Math.max(1, content.title.length);
  const desc = wrapDescription(ctx, S, content.description);
  const m = desc.length;
  // Fixed part (face units) and the part that scales with the title size.
  const fixed = m ? L.descSize + (m - 1) * L.descSize * L.descPitchEm + L.loaderAfterDesc : 0;
  const perSize = L.titleCapEm + (n - 1) * L.titlePitchEm + (m ? L.descGapEm : L.loaderGapEm);
  const fit = (L.loaderMaxY - L.kickerY - L.titleGap - fixed) / perSize;
  const size = Math.min(L.titleSize, fit);
  const first = L.kickerY + L.titleGap + L.titleCapEm * size;
  const baselines = Array.from({ length: n }, (_, i) => first + i * L.titlePitchEm * size);
  const lastTitle = baselines[n - 1];
  const descFirst = lastTitle + L.descGapEm * size + L.descSize;
  const descBaselines = desc.map((_, i) => descFirst + i * L.descSize * L.descPitchEm);
  const loaderY = m ? descBaselines[m - 1] + L.loaderAfterDesc : lastTitle + L.loaderGapEm * size;
  return { size, baselines, desc, descBaselines, loaderY };
}

function drawFace(ctx, S, bands, content) {
  const L = FACE_LAYOUT;
  const warm = { r: 255, g: 240, b: 220 };
  // Even glow + bands (column by column).
  const img = ctx.createImageData(S, 1);
  for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S;
    let k = 0.9;
    for (const bd of bands) k += SIGN_BAND_GAIN * Math.exp(-0.5 * ((u - bd.u) / bd.sigma) ** 2);
    const edge = Math.min(u, 1 - u);
    k *= 1 - SIGN_EDGE_FALLOFF * Math.exp(-edge / 0.06);
    // a faint cool / warm alternation between the bands, like a real diffuser
    let cool = 0;
    for (const bd of bands) cool += Math.exp(-0.5 * ((u - bd.u - bd.sigma * 1.6) / bd.sigma) ** 2);
    const i = x * 4;
    img.data[i] = Math.min(255, warm.r * k - cool * 4);
    img.data[i + 1] = Math.min(255, warm.g * k - cool * 2);
    img.data[i + 2] = Math.min(255, warm.b * k + cool * 6);
    img.data[i + 3] = 255;
  }
  for (let y = 0; y < S; y++) ctx.putImageData(img, 0, y);
  // Vertical fall-off (top / bottom edges).
  const vg = ctx.createLinearGradient(0, 0, 0, S);
  vg.addColorStop(0, "rgba(40,30,20,0.06)");
  vg.addColorStop(0.08, "rgba(40,30,20,0)");
  vg.addColorStop(0.92, "rgba(40,30,20,0)");
  vg.addColorStop(1, "rgba(40,30,20,0.07)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, S, S);

  // Printed text.
  const x0 = L.marginX * S;
  ctx.fillStyle = SIGN_INK;
  ctx.textBaseline = "alphabetic";
  ctx.font = `400 ${L.kickerSize * S}px ${signFontStack()}`;
  ctx.fillText(content.kicker, x0, L.kickerY * S);
  // Title: sized for its line count, and smaller still if its widest line
  // would crowd the right margin.
  const block = faceLayout(ctx, S, content);
  ctx.font = `400 ${block.size * S}px ${signFontStack()}`;
  const widest = Math.max(...content.title.map((t) => ctx.measureText(t).width));
  const titleSize = block.size * Math.min(1, (SIGN_TITLE_MAX_WIDTH * S) / Math.max(1, widest));
  ctx.font = `400 ${titleSize * S}px ${signFontStack()}`;
  const tx = x0 - titleSize * S * 0.05; // optical alignment of the big letters
  content.title.forEach((line, i) => ctx.fillText(line, tx, block.baselines[i] * S));
  // Description: the smaller subtitle line(s), left-aligned with the title.
  ctx.font = `400 ${L.descSize * S}px ${signFontStack()}`;
  block.desc.forEach((line, i) => ctx.fillText(line, x0, block.descBaselines[i] * S));
  // Loader track (the fill and the percentage are live meshes on top).
  ctx.globalAlpha = 0.22;
  ctx.fillRect(x0, block.loaderY * S - L.loaderBarH * S * 0.5, L.loaderBarW * S, L.loaderBarH * S);
  ctx.globalAlpha = 1;
  // Footer: label / bold value pairs.
  let fx = x0;
  for (const [label, value] of content.foot) {
    ctx.font = `400 ${L.footSize * S}px ${signFontStack()}`;
    ctx.fillText(label + " ", fx, L.footY * S);
    fx += ctx.measureText(label + " ").width;
    ctx.font = `700 ${L.footSize * S}px ${signFontStack()}`;
    ctx.fillText(value, fx, L.footY * S);
    fx += ctx.measureText(value).width + ctx.measureText(" ").width;
  }
  return block;
}

function drawPercent(ctx, w, h, text) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = SIGN_INK;
  ctx.textBaseline = "middle";
  ctx.font = `500 ${h * 0.62}px ${signFontStack()}`;
  ctx.fillText(text, 0, h * 0.54);
}

function signContent() {
  const index = LEVEL_ORDER.indexOf(SCENE_ROUTES.meetingRoom);
  return {
    kicker: "Next stop",
    description: SIGN_DESCRIPTION,
    title: SIGN_TITLE_LINES,
    foot: [
      ["Level", String(index + 1)],
      ["of", String(LEVEL_ORDER.length)],
    ],
  };
}

// ---------------------------------------------------------------------------

export default function MeetingRoomSignTransition({ ready, onFinished }) {
  const stageRef = useRef(null);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  // Installed during the first render, so it is in place before the page
  // starts loading the meeting room.
  const [progress] = useState(() => (typeof window !== "undefined" ? installModelProgress() : null));

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !progress) return undefined;
    let disposed = false;
    let raf = 0;
    let cleanup = () => {};
    const t0 = performance.now();

    Promise.all([
      import("three"),
      import("three/addons/loaders/GLTFLoader.js"),
      import("three/addons/postprocessing/EffectComposer.js"),
      import("three/addons/postprocessing/RenderPass.js"),
      import("three/addons/postprocessing/UnrealBloomPass.js"),
      import("three/addons/postprocessing/OutputPass.js"),
      import("three/addons/lights/RectAreaLightUniformsLib.js"),
    ]).then(async ([THREE, { GLTFLoader }, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { RectAreaLightUniformsLib }]) => {
      if (disposed) return;
      RectAreaLightUniformsLib.init();
      const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      // No tone mapping: the face shows its artwork at the exact brightness
      // (OutputPass would tone-map the whole frame and grey the white face).
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.setClearColor(SIGN_BACKGROUND, 1);
      renderer.domElement.style.display = "block";
      renderer.domElement.style.opacity = "0"; // until the FADE_IN step
      stage.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(SIGN_BACKGROUND);
      const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);

      const disposables = new Set();
      const track = (o) => {
        if (o) disposables.add(o);
        return o;
      };
      let gltfScene = null;

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
        if (gltfScene) {
          gltfScene.traverse((o) => {
            if (o.geometry) track(o.geometry);
            if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(track);
          });
        }
        scene.traverse((o) => {
          if (o.geometry) track(o.geometry);
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(track);
          if (o.dispose && o.isLight) track(o);
        });
        for (const d of disposables) {
          try {
            d.dispose();
          } catch (e) {}
        }
        try {
          composer.dispose();
          bloom.dispose();
        } catch (e) {}
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };

      // --- Model -----------------------------------------------------------
      let gltf;
      try {
        gltf = await new GLTFLoader().loadAsync(assetUrl(SIGN_DIR + SIGN_GLTF));
      } catch (error) {
        console.error("[MeetingRoomSign] failed to load", SIGN_GLTF, error);
      }
      if (disposed) return cleanup();
      const root = gltf ? gltf.scene : new THREE.Group();
      gltfScene = root;
      scene.add(root);
      root.updateMatrixWorld(true);
      const base = root.getObjectByName("base");
      const cup = root.getObjectByName("cup");
      const lights = root.getObjectByName("lights");
      const missing = ["base", "cup", "lights"].filter((n) => !root.getObjectByName(n));
      if (missing.length) console.warn("[MeetingRoomSign] missing parts:", missing.join(", "));

      // Sign frame: the face points along the cup's thinnest axis.
      const signBox = new THREE.Box3().setFromObject(root);
      const cupBox = cup ? new THREE.Box3().setFromObject(cup) : signBox.clone();
      const cupSize = cupBox.getSize(new THREE.Vector3());
      const center = signBox.getCenter(new THREE.Vector3());
      const signSize = signBox.getSize(new THREE.Vector3());
      // The model's face normal is +X (cup thinnest along X, in front of the base).
      const normal = new THREE.Vector3(1, 0, 0);
      const faceW = cupSize.z;
      const faceH = cupSize.y;
      const faceCenter = cupBox.getCenter(new THREE.Vector3());
      faceCenter.x = cupBox.max.x + 0.0008;

      // --- Materials -------------------------------------------------------
      const lightColor = new THREE.Color(SIGN_LIGHT_COLOR);
      const baseMat = track(
        new THREE.MeshPhysicalMaterial({
          color: 0x8a6a2a,
          roughness: 0.42,
          metalness: 0,
          clearcoat: 0.25,
          clearcoatRoughness: 0.5,
        }),
      );
      if (base) base.material = baseMat;
      const tubeMat = track(new THREE.MeshBasicMaterial({ color: lightColor.clone() }));
      if (lights) lights.material = tubeMat;
      const cupEdgeMat = track(
        new THREE.MeshStandardMaterial({
          color: lightColor.clone(),
          emissive: lightColor.clone(),
          emissiveIntensity: 0,
          roughness: 0.9,
          metalness: 0,
        }),
      );
      if (cup) cup.material = cupEdgeMat;

      // Hanging rod above the sign (like a ceiling-hung lightbox).
      const rodLen = 6;
      const rod = new THREE.Mesh(track(new THREE.CylinderGeometry(0.018, 0.018, rodLen, 12)), baseMat);
      rod.position.set(signBox.min.x + signSize.x * 0.5, signBox.max.y + rodLen / 2, center.z);
      scene.add(rod);

      // Dark wall behind, catching a halo from the lights.
      const wallMat = track(new THREE.MeshStandardMaterial({ color: SIGN_WALL_COLOR, roughness: 0.95, metalness: 0 }));
      const wall = new THREE.Mesh(track(new THREE.PlaneGeometry(40, 40)), wallMat);
      wall.rotation.y = Math.PI / 2; // faces +X
      wall.position.set(signBox.min.x - 0.9, center.y, center.z);
      scene.add(wall);
      scene.add(new THREE.HemisphereLight(0x1a2244, 0x05060a, 0.18));

      // Light: spill from the face onto the frame (area light in front, facing
      // the sign) and a halo behind it on the wall (points behind the cup).
      const spill = new THREE.RectAreaLight(lightColor, 0, faceW, faceH);
      spill.position.copy(faceCenter).addScaledVector(normal, 0.55);
      spill.lookAt(faceCenter);
      scene.add(spill);
      const backLights = [];
      for (const s of [-0.55, 0, 0.55]) {
        const p = new THREE.PointLight(lightColor, 0, 4.5, 1.6);
        p.position.set(signBox.min.x - 0.15, center.y + s * faceH * 0.6, center.z + s * faceW * 0.6);
        scene.add(p);
        backLights.push(p);
      }

      // --- Face (printed artwork on the cup) --------------------------------
      // Tube centres along the face's horizontal axis, from the lights geometry.
      const bands = [];
      if (lights && lights.geometry) {
        const pos = lights.geometry.attributes.position;
        const v = new THREE.Vector3();
        const zs = [];
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(lights.matrixWorld);
          zs.push(v.z);
        }
        zs.sort((a, b) => a - b);
        let start = zs[0];
        let prev = zs[0];
        const gap = faceW * 0.04;
        const centers = [];
        for (let i = 1; i <= zs.length; i++) {
          if (i === zs.length || zs[i] - prev > gap) {
            centers.push((start + prev) / 2);
            if (i < zs.length) start = zs[i];
          }
          if (i < zs.length) prev = zs[i];
        }
        const spacing = centers.length > 1 ? (centers[centers.length - 1] - centers[0]) / (centers.length - 1) : faceW / 4;
        for (const cz of centers) {
          // Screen right is -Z (camera on +X looking at the face).
          bands.push({ u: (faceCenter.z + faceW / 2 - cz) / faceW, sigma: (spacing / faceW) * SIGN_BAND_WIDTH });
        }
      }

      const content = signContent();
      const faceCanvas = document.createElement("canvas");
      const faceCtx = faceCanvas.getContext("2d");
      const faceTex = track(new THREE.CanvasTexture(faceCanvas));
      faceTex.colorSpace = THREE.SRGBColorSpace;
      faceTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      faceTex.generateMipmaps = true;
      faceTex.minFilter = THREE.LinearMipmapLinearFilter;
      let faceRes = 0;
      // The loader meshes follow the printed layout (it depends on how the
      // description wraps in the loaded font).
      let placeLoader = () => {};
      let faceLoaderY = FACE_LAYOUT.loaderMaxY;
      const drawFaceAt = (S) => {
        faceRes = S;
        faceCanvas.width = faceCanvas.height = S;
        faceLoaderY = drawFace(faceCtx, S, bands, content).loaderY;
        faceTex.needsUpdate = true;
        placeLoader();
      };
      const faceMat = track(new THREE.MeshBasicMaterial({ map: faceTex, color: 0x000000 }));
      const face = new THREE.Group();
      face.position.copy(faceCenter);
      face.rotation.y = Math.PI / 2; // local +Z = world +X (normal), local +X = world -Z (screen right)
      scene.add(face);
      const facePlane = new THREE.Mesh(track(new THREE.PlaneGeometry(faceW, faceH)), faceMat);
      face.add(facePlane);

      // Loader: bar fill + percentage (live; the track line is printed).
      const L = FACE_LAYOUT;
      const toFace = (u, v) => new THREE.Vector3((u - 0.5) * faceW, (0.5 - v) * faceH, 0);
      const inkMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(SIGN_INK), toneMapped: false }));
      const barGeo = track(new THREE.PlaneGeometry(1, 1));
      barGeo.translate(0.5, 0, 0); // grows from its left end
      const bar = new THREE.Mesh(barGeo, inkMat);
      bar.scale.set(1e-4, L.loaderBarH * faceH, 1);
      face.add(bar);
      const pctCanvas = document.createElement("canvas");
      pctCanvas.width = 512;
      pctCanvas.height = 128;
      const pctCtx = pctCanvas.getContext("2d");
      const pctTex = track(new THREE.CanvasTexture(pctCanvas));
      pctTex.colorSpace = THREE.SRGBColorSpace;
      pctTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const pctMat = track(new THREE.MeshBasicMaterial({ map: pctTex, transparent: true, depthWrite: false }));
      const pctH = L.loaderSize * faceH * 1.6;
      const pctW = pctH * 4;
      const pct = new THREE.Mesh(track(new THREE.PlaneGeometry(pctW, pctH)), pctMat);
      face.add(pct);
      placeLoader = () => {
        const barLeft = toFace(L.marginX, faceLoaderY);
        bar.position.set(barLeft.x, barLeft.y, 0.0006);
        const pctAt = toFace(L.marginX + L.loaderBarW + 0.03, faceLoaderY);
        pct.position.set(pctAt.x + pctW / 2, pctAt.y, 0.0006);
      };
      placeLoader();
      let pctShown = "";
      const setPercent = (p) => {
        const text = `${Math.round(p * 100)}%`;
        if (text === pctShown) return;
        pctShown = text;
        drawPercent(pctCtx, pctCanvas.width, pctCanvas.height, text);
        pctTex.needsUpdate = true;
      };

      // --- Post: soft bloom --------------------------------------------------
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), SIGN_BLOOM_STRENGTH, SIGN_BLOOM_RADIUS, SIGN_BLOOM_THRESHOLD);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());

      // --- Size / camera fit --------------------------------------------------
      let baseDist = 5;
      function resize() {
        const w = Math.max(1, stage.clientWidth);
        const h = Math.max(1, stage.clientHeight);
        renderer.setSize(w, h, false);
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        composer.setSize(w, h);
        bloom.resolution.set(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const tanH = tanV * camera.aspect;
        const fitH = signSize.y / 2 / (tanV * SIGN_FILL);
        const fitW = signSize.z / 2 / (tanH * SIGN_FILL);
        baseDist = Math.max(fitH, fitW);
        // Face texture size: about its on-screen size in device pixels (sharp text).
        const facePx = (faceH / (2 * baseDist * tanV)) * h * renderer.getPixelRatio();
        const want = Math.min(renderer.capabilities.maxTextureSize, 2048, Math.max(1024, 2 ** Math.ceil(Math.log2(facePx))));
        if (want !== faceRes) drawFaceAt(want);
      }
      resize();
      window.addEventListener("resize", resize);

      // --- Table colour, font ------------------------------------------------
      const colorReady = (async () => {
        const deadline = performance.now() + 4000;
        while (!progress.state.gltfUrl && performance.now() < deadline && !disposed) {
          await new Promise((r) => setTimeout(r, 50));
        }
        if (!progress.state.gltfUrl) throw new Error("meeting room model request not seen");
        return readTableColor(THREE, progress.state.gltfUrl, progress.originalFetch);
      })()
        .then(({ color, source }) => {
          baseMat.color.copy(color);
          console.info(`[MeetingRoomSign] base colour from ${TABLE_NODE_NAME} (${source}): #${color.getHexString(THREE.SRGBColorSpace)}`);
        })
        .catch((error) => console.warn("[MeetingRoomSign] table colour not read:", error));
      const fontTimeout = new Promise((r) => setTimeout(r, SIGN_FONT_WAIT_MS));
      loadSignFont()
        .then(() => {
          if (!disposed && faceRes) {
            drawFaceAt(faceRes); // redraw in the web font
            pctShown = "";
          }
        })
        .catch(() => {});
      // Lights on once the colour and the font are in (or after a short wait).
      await Promise.race([
        Promise.all([colorReady, Promise.race([loadSignFont().catch(() => false), fontTimeout])]),
        new Promise((r) => setTimeout(r, SIGN_COLOR_WAIT_MS)),
      ]);
      if (disposed) return cleanup();

      // --- Loop: FADE_IN → LOADING → HOLD → EXIT -----------------------------
      const canvasStyle = renderer.domElement.style;
      let step = "FADE_IN";
      let stepAt = performance.now();
      const goTo = (next, now) => {
        step = next;
        stepAt = now;
      };
      let shown = 0; // bar value (0..1), never goes backward
      let downloadDoneAt = 0;
      let finished = false;
      let last = performance.now();
      const dir = new THREE.Vector3();

      const flicker = (ms) => {
        // A few quick blinks rising to steady.
        if (ms < 0) return 0;
        if (ms >= SIGN_FLICKER_MS) return 1;
        const u = ms / SIGN_FLICKER_MS;
        const blinks = [0.08, 0.16, 0.3, 0.38, 0.55];
        let on = 1;
        for (let i = 0; i < blinks.length; i++) if (u > blinks[i]) on = i % 2 ? 1 : 0.15;
        if (u < blinks[0]) on = 0;
        return on * (0.55 + 0.45 * u);
      };

      /** Real progress of the meeting room (it loads from the start, in the background). */
      const realProgress = (now) => {
        if (readyRef.current) return 1;
        const dl = progress.fraction();
        if (dl >= 1 && !downloadDoneAt) downloadDoneAt = now;
        let p = SIGN_DOWNLOAD_SHARE * dl;
        if (downloadDoneAt) {
          p += (1 - SIGN_DOWNLOAD_SHARE) * 0.9 * (1 - Math.exp(-(now - downloadDoneAt) / 1000 / SIGN_PARSE_SEC));
        }
        return Math.min(0.999, p);
      };

      const frame = () => {
        if (disposed) return;
        raf = requestAnimationFrame(frame);
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        const tSec = (now - t0) / 1000;
        const inStep = now - stepAt;
        let power = 1;
        let opacity = 1;

        if (step === "FADE_IN") {
          // Everything fades in; the loader shows 0% and doesn't move.
          const u = Math.min(1, inStep / SIGN_FADE_IN_MS);
          opacity = u * u * (3 - 2 * u);
          power = flicker(inStep - SIGN_LIGHTS_ON_DELAY_MS);
          if (u >= 1) goTo("LOADING", now);
        } else if (step === "LOADING") {
          // Real progress, but never faster than the minimum duration and never backward.
          const cap = Math.min(1, inStep / SIGN_LOADER_MIN_MS);
          const target = Math.min(realProgress(now), cap);
          shown = Math.max(shown, shown + (target - shown) * (1 - Math.exp(-dt * 10)));
          // Complete as soon as it reads 100% (the hold starts from there).
          if (target >= 1 && 1 - shown < 0.005) shown = 1;
          if (shown >= 1 && readyRef.current) goTo("HOLD", now);
        } else if (step === "HOLD") {
          if (inStep >= SIGN_HOLD_MS) goTo("EXIT", now);
        } else if (step === "EXIT") {
          // The lights dim; then the page fades this out and shows the room.
          const u = Math.min(1, inStep / SIGN_DIM_MS);
          power = 1 - 0.85 * u * u;
          if (u >= 1 && !finished) {
            finished = true;
            onFinishedRef.current?.();
          }
        }
        canvasStyle.opacity = opacity.toFixed(3);
        bar.scale.x = Math.max(1e-4, shown * L.loaderBarW * faceW);
        setPercent(shown);

        // Lights.
        faceMat.color.setScalar(power * SIGN_FACE_BRIGHTNESS);
        cupEdgeMat.emissiveIntensity = power * 0.9;
        tubeMat.color.copy(lightColor).multiplyScalar(power);
        spill.intensity = power * SIGN_SPILL_INTENSITY;
        for (const p of backLights) p.intensity = power * SIGN_BACK_INTENSITY;
        bloom.strength = SIGN_BLOOM_STRENGTH * power;

        // Camera: straight on, slow push-in and drift.
        const push = 1 - SIGN_PUSH_IN * (1 - Math.exp(-tSec / (SIGN_PUSH_SEC / 3)));
        const dist = baseDist * push;
        const amp = SIGN_DRIFT * Math.max(signSize.y, signSize.z);
        const w = 2 * Math.PI * SIGN_DRIFT_RATE;
        camera.position.set(
          center.x + dist,
          center.y + Math.sin(tSec * w * 0.8) * amp * 0.6,
          center.z + Math.sin(tSec * w + 1.1) * amp,
        );
        dir.set(center.x, center.y + Math.sin(tSec * w * 0.8 + 0.6) * amp * 0.25, center.z + Math.sin(tSec * w + 1.7) * amp * 0.3);
        camera.lookAt(dir);
        composer.render();
      };
      frame();
    }).catch((error) => {
      console.error("[MeetingRoomSign] failed to start:", error);
      // No sign: still hand over once the room is ready.
      const wait = () => {
        if (disposed) return;
        if (readyRef.current) onFinishedRef.current?.();
        else raf = requestAnimationFrame(wait);
      };
      wait();
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cleanup();
      progress.restore();
    };
  }, [progress]);

  return (
    <div
      ref={stageRef}
      aria-label="Loading the meeting room"
      role="progressbar"
      style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#04060d" }}
    />
  );
}
