/**
 * The race-time LED board on the start lights (ul-kitchen28 "counterScreen", in counterBody's frame opening).
 *
 * After the reference (an amber LED timing board): big digits built from round
 * amber LEDs on a dark panel, every unlit LED faintly visible, a black frame
 * with a row of steel rivets round its edge. Digits are a 5 × 7 dot font, one
 * dot column between characters; ':' and '.' are a single column. The grid's
 * cells are square (sized from the screen's real width and height), centred,
 * so nothing stretches.
 *
 * Drawn by one shader on the screen's own quad: the frame, rivets and the LED
 * grid are procedural; which LEDs are lit comes from a tiny data texture (one
 * texel per LED), rewritten only when the shown text changes. Lit LEDs glow
 * (a soft halo inside each cell) and bloom through the kitchen bloom's
 * per-material weight (thresholdBloom.js: alpha = BASE + weight).
 *
 * Time: set(seconds) shows it in `format` (m = minutes, s = seconds, S =
 * fractions of a second; other characters as they are). The kitchen feeds it
 * the race clock (see kitchenSceneModule.js).
 */
import { BLOOM_WEIGHT_ALPHA_BASE } from "../game/thresholdBloom.js";

export const KITCHEN_COUNTER_SCREEN = {
  format: "mm:ss.SSS", // m minutes, s seconds, S fractions (as many as written); ':' '.' shown as dots
  digitColor: 0xffb000, // amber
  ledBrightness: 2.2, // a lit LED's brightness (HDR, before tone mapping)
  glow: 0.55, // bloom weight of the lit LEDs (0..1) and the halo around each
  unlitBrightness: 0.07, // an unlit LED (× digitColor): faintly visible
  panelColor: 0x070503, // between the LEDs
  frameColor: 0x0c0c0d, // the black frame
  rivetColor: 0x9aa0a6, // steel rivets
  frameShare: 0.11, // the frame's width, × the screen's height
  rivetPitch: 0.34, // between rivets, × the screen's height
  rivetRadius: 0.36, // × the frame's width
  ledFill: 0.56, // an LED's diameter / its cell (smaller: more dark panel between the LEDs)
  marginCells: 1, // empty LED rows / columns round the text
};

/** 5 × 7 dot font, rows top to bottom; ':' and '.' are one column wide. */
const FONT = {
  0: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ":": ["0", "0", "1", "0", "1", "0", "0"],
  ".": ["0", "0", "0", "0", "0", "0", "1"],
  " ": ["0", "0", "0", "0", "0", "0", "0"],
};
const glyphW = (ch) => (FONT[ch] || FONT[" "])[0].length;

/** Seconds as text in `format` (m / s / S runs; minutes beyond the m digits are kept). */
export function formatCounterTime(sec, format) {
  const fracDigits = (format.match(/S/g) || []).length;
  const scale = 10 ** fracDigits;
  const total = Math.max(0, Math.floor(sec * scale + 1e-6)); // fractions truncated (a clock doesn't round up)
  let frac = total % scale;
  const whole = Math.floor(total / scale);
  const s = whole % 60;
  const m = Math.floor(whole / 60);
  return format.replace(/m+|s+|S+/g, (run) => {
    if (run[0] === "m") return String(Math.min(m, 10 ** run.length - 1)).padStart(run.length, "0");
    if (run[0] === "s") return String(s).padStart(run.length, "0");
    const v = String(frac).padStart(fracDigits, "0").slice(0, run.length);
    frac = 0;
    return v;
  });
}

/**
 * @param {object} o
 * @param {typeof import("three")} o.THREE
 * @param {import("three").Mesh} o.mesh  counterScreen (a flat quad in its local y / z plane, facing -x)
 * @returns {{ set(sec: number): void, dispose(): void }}
 */
export function createCounterScreen({ THREE, mesh }) {
  const C = KITCHEN_COUNTER_SCREEN;
  // The text's grid: columns from the format's glyphs, one gap column between characters.
  const sample = formatCounterTime(0, C.format);
  let textCols = 0;
  for (let i = 0; i < sample.length; i++) textCols += glyphW(sample[i]) + (i ? 1 : 0);
  const cols = textCols + 2 * C.marginCells;
  const rows = 7 + 2 * C.marginCells;

  // Own UVs from the quad's extent (u along +z = right as seen from -x, v up), and its real size.
  const g = mesh.geometry.clone();
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const sx = Math.abs(mesh.scale.z) || 1;
  const sy = Math.abs(mesh.scale.y) || 1;
  const W = (bb.max.z - bb.min.z) * sx;
  const H = (bb.max.y - bb.min.y) * sy;
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getZ(i) - bb.min.z) / (bb.max.z - bb.min.z);
    uv[i * 2 + 1] = (pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y);
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  mesh.geometry = g;

  // Layout (model units): the frame, the panel inside it, square LED cells centred in the panel.
  const frame = C.frameShare * H;
  const innerW = W - 2 * frame;
  const innerH = H - 2 * frame;
  const cell = Math.min(innerW / cols, innerH / rows);

  // Lit LEDs: one texel each (row 0 at the bottom: texture v up).
  const lit = new Uint8Array(cols * rows);
  const litTex = new THREE.DataTexture(lit, cols, rows, THREE.RedFormat, THREE.UnsignedByteType);
  litTex.magFilter = THREE.NearestFilter;
  litTex.minFilter = THREE.NearestFilter;
  litTex.needsUpdate = true;

  const col = new THREE.Color(C.digitColor);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uLit: { value: litTex },
      uGrid: { value: new THREE.Vector2(cols, rows) },
      uSize: { value: new THREE.Vector2(W, H) },
      uFrame: { value: frame },
      uCell: { value: cell },
      uColor: { value: col },
      uLed: { value: C.ledBrightness },
      uUnlit: { value: C.unlitBrightness },
      uGlow: { value: C.glow },
      uFill: { value: C.ledFill },
      uPanel: { value: new THREE.Color(C.panelColor) },
      uFrameCol: { value: new THREE.Color(C.frameColor) },
      uRivetCol: { value: new THREE.Color(C.rivetColor) },
      uRivetPitch: { value: C.rivetPitch * H },
      uRivetR: { value: C.rivetRadius * frame },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uLit;
      uniform vec2 uGrid, uSize;
      uniform float uFrame, uCell, uLed, uUnlit, uGlow, uFill, uRivetPitch, uRivetR;
      uniform vec3 uColor, uPanel, uFrameCol, uRivetCol;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * uSize; // model units from the bottom-left corner
        vec3 col;
        float bloom = 0.0;
        vec2 inner = p - vec2(uFrame);
        vec2 innerSize = uSize - 2.0 * vec2(uFrame);
        if (any(lessThan(inner, vec2(0.0))) || any(greaterThan(inner, innerSize))) {
          // The frame, with rivets along its centre line (evenly, the corners included).
          col = uFrameCol;
          vec2 q = p - vec2(uFrame * 0.5); // rivet line's corner at 0
          vec2 span = uSize - vec2(uFrame);
          vec2 n = max(vec2(1.0), floor(span / uRivetPitch + 0.5));
          vec2 step = span / n;
          vec2 r = q - step * floor(q / step + 0.5); // to the nearest rivet position along each axis
          // On a horizontal edge the rivet is at (nearest x, the edge's line); on a vertical one at (the line, nearest y).
          vec2 dEdge = min(abs(q), abs(q - span));
          float d = min(length(vec2(r.x, dEdge.y)), length(vec2(dEdge.x, r.y)));
          float rv = 1.0 - smoothstep(uRivetR * 0.8, uRivetR, d);
          // A domed rivet: lighter toward its top left.
          col = mix(col, uRivetCol * (0.55 + 0.45 * (1.0 - d / uRivetR)), rv);
        } else {
          // The LED grid, centred in the panel.
          vec2 gridSize = uGrid * uCell;
          vec2 g = (inner - (innerSize - gridSize) * 0.5) / uCell; // cell units
          col = uPanel;
          if (all(greaterThanEqual(g, vec2(0.0))) && all(lessThan(g, uGrid))) {
            vec2 c = floor(g);
            vec2 f = fract(g) - 0.5;
            float d = length(f) * 2.0; // 0 centre .. 1 the cell's edge
            float on = texture2D(uLit, (c + 0.5) / uGrid).r;
            float led = 1.0 - smoothstep(uFill * 0.85, uFill, d);
            float core = 1.0 - smoothstep(0.0, uFill, d); // brighter centre
            float halo = (1.0 - smoothstep(uFill, 1.45, d)) * uGlow * 0.35;
            vec3 lit = uColor * uLed * (0.7 + 0.6 * core) * led + uColor * uLed * halo;
            vec3 dark = uColor * uUnlit * led;
            col = mix(uPanel + dark, uPanel + lit, on);
            bloom = on * uGlow * max(led, halo * 2.0);
          }
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor.a = ${BLOOM_WEIGHT_ALPHA_BASE.toFixed(1)} + clamp(bloom, 0.0, 1.0);
      }`,
  });
  mesh.material = mat;

  let shown = null;
  /** Shows `sec` (redraws the lit LEDs only when the text changes). */
  function set(sec) {
    const text = formatCounterTime(sec, C.format);
    if (text === shown) return;
    shown = text;
    lit.fill(0);
    let x = C.marginCells;
    for (let i = 0; i < text.length; i++) {
      const glyph = FONT[text[i]] || FONT[" "];
      for (let r = 0; r < 7; r++) {
        const row = rows - 1 - (C.marginCells + r); // texture rows count up from the bottom
        for (let k = 0; k < glyph[r].length; k++) if (glyph[r][k] === "1") lit[row * cols + x + k] = 255;
      }
      x += glyph[0].length + 1;
    }
    litTex.needsUpdate = true;
  }
  set(0);

  function dispose() {
    mat.dispose();
    litTex.dispose();
    g.dispose();
  }
  return { set, dispose, text: () => shown };
}
