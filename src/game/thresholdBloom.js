/**
 * Shared selective bloom by threshold (office and kitchen): one UnrealBloomPass
 * in the scene's existing composer, at a reduced resolution, with a high
 * threshold on the HDR (half-float, before tone mapping) image. Only parts
 * made brighter than the threshold glow (emissive intensity above it), so the
 * rest of the scene isn't blurred or brightened, and nothing renders twice.
 */
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

/**
 * Bloom look: strength, blur radius (0..1), HDR threshold (on a pixel's
 * brightest colour channel, so a red light counts as fully as a white one),
 * the soft edge above it, and the bloom's resolution vs. the screen.
 */
export const BLOOM_SETTINGS = { strength: 0.22, radius: 0.55, threshold: 12, softness: 2, resolutionScale: 0.5 };
/**
 * Per-material bloom weight (for parts that should glow softly without being
 * pushed above the threshold, e.g. the video screens): such a material writes
 * BASE + weight into the HDR image's alpha, and the bloom adds that share of
 * its colour. Opaque surfaces write alpha 1 (additive effects stay well below
 * BASE), so only marked materials are affected.
 */
export const BLOOM_WEIGHT_ALPHA_BASE = 4;
/**
 * Bloom group marker (addBloomGroup): a material of the group writes
 * GROUP_BASE + weight into the HDR image's alpha. The main bloom ignores these
 * pixels (alpha at or above it), so the group glows only in its own pass.
 */
export const BLOOM_GROUP_ALPHA_BASE = 8;
/** Emissive intensity for parts that should glow (comfortably above the threshold). */
export const BLOOM_EMISSIVE = {
  /** The car's light bar (lightBar1 and its copies), in its own red. */
  lightBar: 18,
};

/**
 * Adds the bloom pass right after `afterPass` in `composer`.
 * @returns {{ pass: UnrealBloomPass, setEnabled(on: boolean): void }}
 */
export function addThresholdBloom({ THREE, composer, afterPass, settings = BLOOM_SETTINGS }) {
  const scale = settings.resolutionScale ?? 0.5;
  const size = new THREE.Vector2();
  composer.renderer.getDrawingBufferSize(size);
  const pass = new UnrealBloomPass(
    new THREE.Vector2(Math.max(2, size.x * scale), Math.max(2, size.y * scale)),
    settings.strength,
    settings.radius,
    settings.threshold,
  );
  // Threshold on the brightest channel (the stock pass uses luminance, which
  // counts red at ~20%: a red light bar would need a far higher glow than white).
  pass.highPassUniforms.smoothWidth.value = settings.softness ?? 1;
  pass.materialHighPassFilter.fragmentShader = `
    uniform sampler2D tDiffuse;
    uniform vec3 defaultColor;
    uniform float defaultOpacity;
    uniform float luminosityThreshold;
    uniform float smoothWidth;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      float v = max(texel.r, max(texel.g, texel.b));
      float alpha = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
      // Marked materials (alpha above the base) add their own share.
      // (A bloom group's pixels, alpha >= the group base, glow in the group's own pass instead.)
      float weighted = texel.a < ${BLOOM_GROUP_ALPHA_BASE.toFixed(1)} ? clamp(texel.a - ${BLOOM_WEIGHT_ALPHA_BASE.toFixed(1)}, 0.0, 1.0) : 0.0;
      alpha = max(alpha, weighted);
      gl_FragColor = mix(vec4(defaultColor.rgb, defaultOpacity), vec4(texel.rgb, 1.0), alpha);
    }
  `;
  pass.materialHighPassFilter.needsUpdate = true;
  // The composer resizes passes to the full buffer; keep the bloom at its reduced size.
  const setSize = pass.setSize.bind(pass);
  pass.setSize = (w, h) => setSize(Math.max(2, Math.round(w * scale)), Math.max(2, Math.round(h * scale)));
  const passes = composer.passes;
  const at = passes.indexOf(afterPass);
  composer.insertPass(pass, at >= 0 ? at + 1 : 1);
  return {
    pass,
    setEnabled(on) {
      pass.enabled = !!on;
    },
  };
}

/**
 * A bloom of its own for a chosen set of materials (selective: nothing else
 * feeds it), with its own strength, radius and soft threshold. One more
 * UnrealBloomPass (a 5-level mip chain of separable Gaussian blurs on
 * linear-filtered half-float targets, at `resolutionScale` of the drawing
 * buffer, resized with the composer), added after `afterPass`. Mark the
 * materials with `mark(material, weight)`. Their pixels glow by
 * weight × smoothstep(threshold, threshold + knee, brightest channel), so the
 * glow starts softly instead of at a hard cut.
 * @returns {{ pass: UnrealBloomPass, mark(material, weight?): void, setThreshold(threshold, knee): void }}
 */
export function addBloomGroup({ THREE, composer, afterPass, settings }) {
  const scale = settings.resolutionScale ?? 0.5;
  const size = new THREE.Vector2();
  composer.renderer.getDrawingBufferSize(size);
  const pass = new UnrealBloomPass(
    new THREE.Vector2(Math.max(2, size.x * scale), Math.max(2, size.y * scale)),
    settings.strength,
    settings.radius,
    settings.threshold,
  );
  pass.highPassUniforms.smoothWidth.value = settings.knee ?? 0.5;
  pass.materialHighPassFilter.fragmentShader = `
    uniform sampler2D tDiffuse;
    uniform vec3 defaultColor;
    uniform float defaultOpacity;
    uniform float luminosityThreshold;
    uniform float smoothWidth;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      // Only the group's own pixels (alpha at or above the group base).
      float weight = texel.a >= ${BLOOM_GROUP_ALPHA_BASE.toFixed(1)} ? clamp(texel.a - ${BLOOM_GROUP_ALPHA_BASE.toFixed(1)}, 0.0, 1.0) : 0.0;
      float v = max(texel.r, max(texel.g, texel.b));
      float alpha = weight * smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
      gl_FragColor = mix(vec4(defaultColor.rgb, defaultOpacity), vec4(texel.rgb, 1.0), alpha);
    }
  `;
  pass.materialHighPassFilter.needsUpdate = true;
  const setSize = pass.setSize.bind(pass);
  pass.setSize = (w, h) => setSize(Math.max(2, Math.round(w * scale)), Math.max(2, Math.round(h * scale)));
  const passes = composer.passes;
  const at = passes.indexOf(afterPass);
  composer.insertPass(pass, at >= 0 ? at + 1 : 1);
  return {
    pass,
    mark(material, weight = 1) {
      if (!material) return;
      const u = (material.userData.bloomGroupWeight = { value: weight });
      appendFragment(
        material,
        "bloomGroup",
        "uniform float uBloomGroupWeight;\n",
        `gl_FragColor.a = ${BLOOM_GROUP_ALPHA_BASE.toFixed(1)} + clamp(uBloomGroupWeight, 0.0, 1.0);`,
        { uBloomGroupWeight: u },
      );
    },
    setThreshold(threshold, knee) {
      pass.threshold = threshold;
      pass.highPassUniforms.luminosityThreshold.value = threshold;
      pass.highPassUniforms.smoothWidth.value = knee;
    },
  };
}

const _bloomPatched = new WeakSet();
/**
 * Appends `code` at the end of a material's fragment shader, after any earlier
 * patch (`declare` goes before main). Tracked per material (a clone copies
 * userData but not the hook).
 */
function appendFragment(material, key, declare, code, uniforms) {
  if (!material || _bloomPatched.has(material)) return;
  _bloomPatched.add(material);
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    if (prev) prev.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = declare + shader.fragmentShader.replace(/}\s*$/, code + "\n}");
  };
  material.customProgramCacheKey = function () {
    return (prevKey ? prevKey.call(this) : "") + "|" + key;
  };
  material.needsUpdate = true;
}

/**
 * Soft bloom from an opaque material's own colour (`weight`: 0..1 share of its
 * colour), without raising its brightness: the part glows a little and looks
 * the same itself. Calling it again only changes the weight.
 */
export function setBloomWeight(material, weight) {
  if (!material) return;
  if (material.userData.bloomWeight && _bloomPatched.has(material)) {
    material.userData.bloomWeight.value = weight;
    return;
  }
  const u = (material.userData.bloomWeight = { value: weight });
  appendFragment(
    material,
    "bloomWeight",
    "uniform float uBloomWeight;\n",
    `gl_FragColor.a = ${BLOOM_WEIGHT_ALPHA_BASE.toFixed(1)} + clamp(uBloomWeight, 0.0, 1.0);`,
    { uBloomWeight: u },
  );
}

/**
 * Keeps a surface's HDR output just under the bloom threshold, per channel, so
 * it looks the same after tone mapping (anything this bright is already fully
 * saturated). For glossy surfaces whose sharp highlights (e.g. a car lamp's spot
 * light on the table) would otherwise bloom.
 */
export function keepBelowBloomThreshold(material, settings = BLOOM_SETTINGS) {
  const max = (settings.threshold * 0.9).toFixed(2);
  appendFragment(material, "bloomGuard" + max, "", `gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(${max}));`, {});
}
