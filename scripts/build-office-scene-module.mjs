/**
 * Reads legacy monolithic office-scene.html and writes src/office/officeSceneModule.js
 * Run: node scripts/build-office-scene-module.mjs
 * Override source: OFFICE_HTML=/path/to/office-scene.html node scripts/...
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "src", "office");
const outFile = join(outDir, "officeSceneModule.js");

const htmlPath =
  process.env.OFFICE_HTML ||
  join(
    dirname(root),
    "car-game-wix-table",
    "office-scene-optimized",
    "office-scene.html",
  );

const html = readFileSync(htmlPath, "utf8");
const lines = html.split(/\r?\n/);
// Line 59 .. 10408 in file (1-based): include `animate();` before </script> (was slice end off by one).
const inner = lines.slice(58, 10408).join("\n");

const marker = `import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";`;

const header = `${marker}
import { getOfficeSceneMount } from "./officeSceneMount.js";

const _OFFICE_BASE = \`\${import.meta.env.BASE_URL}office-scene-optimized/\`;
function officeAsset(relativePath) {
  let p = String(relativePath);
  if (p.startsWith("./")) p = p.slice(2);
  return _OFFICE_BASE + p.split("/").map(encodeURIComponent).join("/");
}
`;

if (!inner.includes(marker)) {
  throw new Error(
    `Expected import marker not found in ${htmlPath} — check line numbers.`,
  );
}

let s = inner.split(marker).join(header);

s = s.replace(
  /document\.body\.appendChild\(canvas\)/g,
  "getOfficeSceneMount().appendChild(canvas)",
);

s = s.replace(
  `const rightScreenVideoSrc = "./Build_a_website_you_love_1080P.mp4";`,
  `const rightScreenVideoSrc = officeAsset("./Build_a_website_you_love_1080P.mp4");`,
);

s = s.replace(
  `const OUTDOOR_FALLBACK_GLTF = "office-table-embed34.gltf";`,
  `const OUTDOOR_FALLBACK_GLTF = officeAsset("office-table-embed34.gltf");`,
);

s = s.replace(
  `new THREE.TextureLoader().load(
          "panoramicView.jpg",`,
  `new THREE.TextureLoader().load(
          officeAsset("panoramicView.jpg"),`,
);

s = s.replace(
  `new THREE.TextureLoader().load(
              "poster1.jpg",`,
  `new THREE.TextureLoader().load(
              officeAsset("poster1.jpg"),`,
);

s = s.replace(
  `new THREE.TextureLoader().load(
                  "poster2.png",`,
  `new THREE.TextureLoader().load(
                  officeAsset("poster2.png"),`,
);

s = s.replace(
  `new THREE.TextureLoader().load("keyboard image.jpg", (tex) => {`,
  `new THREE.TextureLoader().load(officeAsset("keyboard image.jpg"), (tex) => {`,
);

s = s.replace(
  `        new THREE.TextureLoader().load(
          "wixNoteBook.jpg",`,
  `        new THREE.TextureLoader().load(
          officeAsset("wixNoteBook.jpg"),`,
);

s = s.replace(
  `      loader.load(
        "office-table-embed65.gltf",`,
  `      loader.load(
        officeAsset("office-table-embed65.gltf"),`,
);

s = s.replace(
  `            loader.setResourcePath("./");
            loader.load(
              carGltfPath,`,
  `            loader.setResourcePath(\`\${import.meta.env.BASE_URL}office-scene-optimized/\`);
            loader.load(
              officeAsset(carGltfPath),`,
);

s = s.replace(
  `            leftScreenVideoTexture = setupScreenVideo(
              leftScreenMesh,
              leftScreenVideo,
              leftScreenCanvas,
              "./Wix_Harmony_The_new_way_to_create_1080P.mp4",
            );`,
  `            leftScreenVideoTexture = setupScreenVideo(
              leftScreenMesh,
              leftScreenVideo,
              leftScreenCanvas,
              officeAsset("./Wix_Harmony_The_new_way_to_create_1080P.mp4"),
            );`,
);

s = s.replace(
  `      loader.load("airPlane2.gltf", (gltf) => {`,
  `      loader.load(officeAsset("airPlane2.gltf"), (gltf) => {`,
);

s = s.replace(
  `      function resize() {
        const w = Math.max(1, window.innerWidth);
        const h = Math.max(1, window.innerHeight);`,
  `      function resize() {
        const mount = getOfficeSceneMount();
        const w = Math.max(1, mount.clientWidth || window.innerWidth);
        const h = Math.max(1, mount.clientHeight || window.innerHeight);`,
);

s = s.replace(
  `      window.addEventListener("resize", resize);
      resize();

      const clock = new THREE.Clock();`,
  `      window.addEventListener("resize", resize);
      resize();
      const _mountForResize = getOfficeSceneMount();
      if (_mountForResize && _mountForResize !== document.body) {
        const _officeResizeObserver = new ResizeObserver(() => resize());
        _officeResizeObserver.observe(_mountForResize);
      }

      const clock = new THREE.Clock();`,
);

// Remove debug camera hotkeys (C = cycle test camera, T = gums tank) from legacy HTML.
s = s.replace(
  `        if (e.code === "KeyC") {
          e.preventDefault();
          let nextCam;
          if (camera === carCamera || camera === carCameraFollow) nextCam = testCamera;
          else if (camera === gumsTankCamera) nextCam = testCamera;
          else nextCam = carCamera;
          camera = nextCam;
          renderScenePass.camera = camera;
          camera.aspect = window.innerWidth / window.innerHeight;
          camera.updateProjectionMatrix();
          controls.dispose();
          controls = createOrbitControls(camera);
          if (camera === carCamera || camera === carCameraFollow) {
            if (camera === carCamera) {
              getCarCameraLookAtPoint(_carMatrixLookAt);
              controls.target.copy(_carMatrixLookAt);
              syncCarOrbitCamAnglesFromPosition(camera);
              applyCarOrbitCameraFromAngles();
              configureOrbitControlsForCarView(camera);
            } else {
              controls.target.copy(car.position);
            }
            if (camera === carCameraFollow) syncCarFollowCamAnglesFromPosition(camera);
            configureOrbitControlsForCarView(camera);
            syncCarCameraYawTracking();
          } else controls.target.set(0, 0, 0);
          controls.update();
        }
`,
  "",
);

s = s.replace(
  `        if (e.code === "KeyT") {
          e.preventDefault();
          if (!gumsTankObject) return;
          gumsTankObject.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(gumsTankObject);
          if (box.isEmpty()) return;
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const extent = Math.max(size.x, size.y, size.z, 0.12);
          const dist = extent * 2.1;
          camera = gumsTankCamera;
          renderScenePass.camera = camera;
          camera.aspect = window.innerWidth / window.innerHeight;
          camera.updateProjectionMatrix();
          controls.dispose();
          controls = createOrbitControls(gumsTankCamera);
          controls.target.copy(center);
          gumsTankCamera.position.set(
            center.x + dist * 0.72,
            center.y + dist * 0.38,
            center.z + dist * 0.72,
          );
          controls.update();
        }
`,
  "",
);

// Legacy Poly Haven dl link is dead (redirects to 404 + CORS errors in browser).
s = s.replace(
  `https://dl.polyhaven.org/file/ahjdyYv/HDRIHaven_HDRI_Hall_2k.hdr`,
  `https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr`,
);

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, s, "utf8");
console.log("Wrote", outFile, "from", htmlPath, `(${s.split("\n").length} lines)`);
