/**
 * Shared plant leaves: the Office plant's leaf (office-scene-optimized/leaf.png,
 * a pothos leaf on black, its stem notch at the top of the image) and its
 * material recipe: unlit (MeshBasicMaterial), double-sided, opaque, the black
 * background cut out by luminance (< 0.06 discarded) rather than alpha.
 * Same as the Office plant1 leaves (officeSceneModule.js setupPlant1LeafSprites).
 */

/** The leaf image's height / width (768 × 1104). */
export const LEAF_ASPECT = 1104 / 768;

/** The leaf texture (loads in the background; usable at once). */
export function loadLeafTexture(THREE, url, onLoad) {
  const tex = new THREE.TextureLoader().load(url, onLoad);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = true;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * The leaf material (the Office recipe). `tint` multiplies the image (white = as in the Office).
 * @param {string} cacheKey  its own program cache key (the shader is patched)
 */
export function createLeafMaterial(THREE, texture, { tint = 0xffffff, cacheKey = "plantLeafMat" } = {}) {
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    color: tint,
    transparent: false,
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
  mat.customProgramCacheKey = () => cacheKey;
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `
#include <map_fragment>
float _leafLum = dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ); // the image itself (a tint doesn't cut more away)
if ( _leafLum < 0.06 ) discard;
diffuseColor.a = 1.0;
`,
    );
  };
  return mat;
}
