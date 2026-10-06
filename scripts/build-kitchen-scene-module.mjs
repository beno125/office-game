/**
 * Converts the standalone kitchen HTML into a lazy-loaded application module.
 * Override source: KITCHEN_HTML=/path/to/kitchen-scene.html npm run sync-kitchen
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "src", "kitchen");
const outFile = join(outDir, "kitchenSceneModule.js");
const htmlPath =
  process.env.KITCHEN_HTML ||
  join(
    dirname(root),
    "car-game-wix-table",
    "kitchen-scene-optimize",
    "kitchen-scene.html",
  );

const lines = readFileSync(htmlPath, "utf8").split(/\r?\n/);
const moduleImportIdx = lines.findIndex((line) =>
  /import \* as THREE from "three"/.test(line),
);
const animateIdx = lines.findIndex((line) => /^\s*animate\(\);\s*$/.test(line));
if (moduleImportIdx < 0 || animateIdx < 0) {
  throw new Error(`Could not find kitchen module boundaries in ${htmlPath}`);
}

const marker =
  'import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";';
let source = lines.slice(moduleImportIdx, animateIdx + 1).join("\n");
if (!source.includes(marker)) {
  throw new Error(`Expected import marker not found in ${htmlPath}`);
}

source = source.replace(
  marker,
  `${marker}
import { getKitchenSceneMount } from "./kitchenSceneMount.js";
import { emitKitchenSceneEvent } from "../game/kitchenSceneEvents.js";

const _KITCHEN_BASE = \`\${import.meta.env.BASE_URL}kitchen-scene-optimized/\`;
const _OFFICE_BASE = \`\${import.meta.env.BASE_URL}office-scene-optimized/\`;
const kitchenAsset = (path) => _KITCHEN_BASE + String(path).replace(/^\\.\\//, "");
const officeAsset = (path) => _OFFICE_BASE + String(path).replace(/^\\.\\//, "");

let _kitchenSceneRendering = false;
let _kitchenSceneAnimationFrame = 0;
let _kitchenSceneReady = false;

export function isKitchenSceneReady() {
  return _kitchenSceneReady;
}`,
);

source = source.replace(
  /document\.body\.appendChild\(canvas\)/g,
  "getKitchenSceneMount().appendChild(canvas)",
);
source = source.replace(
  'const KITCHEN_COVER_TEX_DIR = "textures/";',
  'const KITCHEN_COVER_TEX_DIR = kitchenAsset("textures/");',
);
source = source.replace(
  /kLoader\.load\(\s*\n\s*"ul-kitchen13\.gltf",/,
  `kLoader.load(
          kitchenAsset("ul-kitchen13.gltf"),`,
);
source = source.replace(
  `loader.setResourcePath("./");
        loader.load(
          "./car-game13.gltf",`,
  `loader.setResourcePath(_OFFICE_BASE);
        loader.load(
          officeAsset("car-game14.gltf"),`,
);
source = source.replace(
  `      function resize() {
        const w = Math.max(1, window.innerWidth);
        const h = Math.max(1, window.innerHeight);`,
  `      function resize() {
        const mount = getKitchenSceneMount();
        const w = Math.max(1, mount.clientWidth || window.innerWidth);
        const h = Math.max(1, mount.clientHeight || window.innerHeight);`,
);
source = source.replace(
  `      window.addEventListener("resize", resize);
      resize();

      const clock = new THREE.Clock();`,
  `      window.addEventListener("resize", resize);
      resize();
      const _kitchenMountForResize = getKitchenSceneMount();
      if (_kitchenMountForResize && _kitchenMountForResize !== document.body) {
        const _kitchenResizeObserver = new ResizeObserver(() => resize());
        _kitchenResizeObserver.observe(_kitchenMountForResize);
      }

      const clock = new THREE.Clock();`,
);
source = source.replace(
  `                try { applyLightBlend(lightBlend); } catch (e) {}`,
  `                try { applyLightBlend(lightBlend); } catch (e) {}
                _kitchenSceneReady = true;
                emitKitchenSceneEvent("ready");`,
);
source = source.replace(
  "https://dl.polyhaven.org/file/ahjdyYv/HDRIHaven_HDRI_Hall_2k.hdr",
  "https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr",
);

// SMAA already handles edge smoothing. Sharpening amplifies sub-pixel detail
// into visible scene noise, while selective bloom temporarily swaps materials.
source = source.replace(
  `          if (typeof sharpenPass !== "undefined") sharpenPass.enabled = true;`,
  `          if (typeof sharpenPass !== "undefined") sharpenPass.enabled = false;`,
);
source = source.replace(
  `            sharpenPass.enabled = s.sharpen;
          sceneBloomEnabled = s.bloom;`,
  `            sharpenPass.enabled = false;
          sceneBloomEnabled = false;`,
);
source = source.replace(
  `      sharpenPass.enabled = perfSettings.sharpen;
      sceneBloomEnabled = perfSettings.bloom;`,
  `      sharpenPass.enabled = false;
      sceneBloomEnabled = false;`,
);
source = source.replace(
  `      function getBloomRenderScale() {
        return sceneBloomEnabled && perfBloomScale > 0 && perfBloomScale < 1`,
  `      function getBloomRenderScale() {
        if (_kitchenWorldActive && sceneBloomEnabled) return 0.42;
        return sceneBloomEnabled && perfBloomScale > 0 && perfBloomScale < 1`,
);
source = source.replace(
  `        3.0,
        1.6,
        0.12,`,
  `        0.35,
        0.08,
        0.72,`,
);
source = source.replace(
  `      carLightsBloomPass.highPassUniforms.smoothWidth.value = 0.4;
      carLightsBloomPass.threshold = 0.006;`,
  `      carLightsBloomPass.highPassUniforms.smoothWidth.value = 0.03;
      carLightsBloomPass.threshold = 0.72;`,
);
source = source.replace(
  `            bloomIntensity: { value: 2.35 },`,
  `            bloomIntensity: { value: 0.16 },`,
);
source = source.replace(
  `      sharpenPass.enabled = false;
      sceneBloomEnabled = false;`,
  `      sharpenPass.enabled = false;
      sceneBloomEnabled = false;
      carBloomMixPass.enabled = false;`,
);
source = source.replaceAll(
  `              node.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
`,
  ``,
);
source = source.replace(
  `              clone.traverse((n) => {
                if (n.isMesh && n.name === "lightBar1") {
                  n.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
                }
              });
`,
  ``,
);
source = source.replace(
  `                emissiveIntensity: 6.5,
                metalness: 0,
                roughness: 0.3,
              });
            }
            if (node.name === "rearLights") {`,
  `                emissiveIntensity: 6.5,
                metalness: 0,
                roughness: 0.3,
                side: THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: -2,
                polygonOffsetUnits: -2,
              });
              node.renderOrder = 3;
              node.position.z += 0.08;
            }
            if (node.name === "rearLights") {`,
);

const kitchenPlaceCamerasMarker = `      function placeCarViewCameras(lookAt, maxDim) {`;
if (!source.includes(kitchenPlaceCamerasMarker)) {
  throw new Error(`Kitchen camera placement marker not found in ${htmlPath}`);
}
source = source.replace(
  kitchenPlaceCamerasMarker,
  `      function switchToFreeCamera() {
        if (camera === testCamera) return;
        const sourceCamera = camera;
        const freeTarget = controls?.target?.clone() || car?.position?.clone() || new THREE.Vector3();
        testCamera.position.copy(sourceCamera.position);
        testCamera.quaternion.copy(sourceCamera.quaternion);
        camera = testCamera;
        renderScenePass.camera = camera;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        controls.dispose();
        controls = createOrbitControls(camera);
        controls.target.copy(freeTarget);
        controls.enableZoom = true;
        controls.enablePan = true;
        controls.screenSpacePanning = true;
        controls.minDistance = 0.1;
        controls.maxDistance = 1000;
        controls.minPolarAngle = 0;
        controls.maxPolarAngle = Math.PI;
        controls.update();
      }

${kitchenPlaceCamerasMarker}`,
);
source = source.replace(
  `        if (e.code === "Digit2") {
          e.preventDefault();
          switchCarView(carCameraFollow);
        }`,
  `        if (e.code === "Digit2") {
          e.preventDefault();
          switchToFreeCamera();
        }`,
);

source = source.replace(
  `          applySceneEnvironmentToMaterial(waterTapChromeMat);`,
  `          applySceneEnvironmentToMaterial(waterTapChromeMat);
          applySceneEnvironmentToMaterial(_kitchenTableCoverLampMat);
          applySceneEnvironmentToMaterial(_kitchenTableCoverSideMat);`,
);
source = source.replace(
  `      let _kitchenTableCoverLampMat = null;`,
  `      let _kitchenTableCoverLampMat = null;
      let _kitchenTableCoverSideMat = null;`,
);
source = source.replace(
  `      let _kitchenCoverTopMesh = null;`,
  `      let _kitchenCoverTopMesh = null;
      let _mainTableTopAreaLight = null;`,
);
source = source.replace(
  `        _kitchenTableCoverLampMat = null;
        _kitchenCoverTopMesh = null;`,
  `        _kitchenTableCoverLampMat = null;
        _kitchenTableCoverSideMat = null;
        _kitchenCoverTopMesh = null;`,
);
source = source.replace(
  `        _kitchenCoverTopMesh = null;
        if (_kitchenTableTopStencilWriter) {`,
  `        _kitchenCoverTopMesh = null;
        _mainTableTopAreaLight = null;
        if (_kitchenTableTopStencilWriter) {`,
);
source = source.replace(
  `      /** Fewer tiles along the long edge = larger tile pattern on the planes. */
      const KITCHEN_COVER_TILES_X = 8;`,
  `      /** More repeats keep the ceramic tile pattern at a smaller visual scale. */
      const KITCHEN_COVER_TILES_X = 10.75;`,
);
source = source.replace(
  `      function _kitchenCoverMatLite(map, roughnessMap) {
        return new THREE.MeshStandardMaterial({
          map,
          roughnessMap,
          roughness: 1,
          metalness: 0,
          envMapIntensity: 0.2,
          side: THREE.DoubleSide,
        });
      }`,
  `      function _kitchenCoverMatLite(
        map,
        normalMap,
        roughnessMap,
        aoMap,
        metalnessMap,
      ) {
        return new THREE.MeshPhysicalMaterial({
          map,
          normalMap,
          roughnessMap,
          aoMap,
          aoMapIntensity: 0.65,
          metalnessMap,
          roughness: 0.78,
          metalness: 1,
          envMapIntensity: 2.8,
          clearcoat: 1,
          clearcoatRoughness: 0.06,
          side: THREE.DoubleSide,
        });
      }`,
);
source = source.replace(
  `        const [map, roughnessMap] = await Promise.all([
          loadTex("Tiles107_2K-JPG_Color.jpg"),
          loadTex("Tiles107_2K-JPG_Roughness.jpg"),
        ]);
        _configureKitchenCoverTexture(map, true);
        _configureKitchenCoverTexture(roughnessMap, false);
        const topMat = _kitchenCoverMatLite(
          _cloneCoverTexture(map, topRepX, topRepY),
          _cloneCoverTexture(roughnessMap, topRepX, topRepY),
        );
        const sideMat = _kitchenCoverMatLite(
          _cloneCoverTexture(map, sideRepX, sideRepY),
          _cloneCoverTexture(roughnessMap, sideRepX, sideRepY),
        );
        const baseMat = _kitchenCoverMatLite(
          _cloneCoverTexture(map, 1, 1),
          _cloneCoverTexture(roughnessMap, 1, 1),
        );`,
  `        const [map, normalMap, roughnessMap, aoMap, metalnessMap] = await Promise.all([
          loadTex("2K/Poliigon_TilesCeramicWhite_6956_BaseColor.jpg"),
          loadTex("2K/Poliigon_TilesCeramicWhite_6956_Normal.png"),
          loadTex("2K/Poliigon_TilesCeramicWhite_6956_Roughness.jpg"),
          loadTex("2K/Poliigon_TilesCeramicWhite_6956_AmbientOcclusion.jpg"),
          loadTex("2K/Poliigon_TilesCeramicWhite_6956_Metallic.jpg"),
        ]);
        _configureKitchenCoverTexture(map, true);
        _configureKitchenCoverTexture(normalMap, false);
        _configureKitchenCoverTexture(roughnessMap, false);
        _configureKitchenCoverTexture(aoMap, false);
        _configureKitchenCoverTexture(metalnessMap, false);
        const topMat = _kitchenCoverMatLite(
          _cloneCoverTexture(map, topRepX, topRepY),
          _cloneCoverTexture(normalMap, topRepX, topRepY),
          _cloneCoverTexture(roughnessMap, topRepX, topRepY),
          _cloneCoverTexture(aoMap, topRepX, topRepY),
          _cloneCoverTexture(metalnessMap, topRepX, topRepY),
        );
        const sideMat = _kitchenCoverMatLite(
          _cloneCoverTexture(map, sideRepX, sideRepY),
          _cloneCoverTexture(normalMap, sideRepX, sideRepY),
          _cloneCoverTexture(roughnessMap, sideRepX, sideRepY),
          _cloneCoverTexture(aoMap, sideRepX, sideRepY),
          _cloneCoverTexture(metalnessMap, sideRepX, sideRepY),
        );
        const baseMat = _kitchenCoverMatLite(
          _cloneCoverTexture(map, 1, 1),
          _cloneCoverTexture(normalMap, 1, 1),
          _cloneCoverTexture(roughnessMap, 1, 1),
          _cloneCoverTexture(aoMap, 1, 1),
          _cloneCoverTexture(metalnessMap, 1, 1),
        );`,
);
source = source.replace(
  `          const depthWrite = !(opts && opts.depthWrite === false);
          mesh.material = mat;`,
  `          const depthWrite = !(opts && opts.depthWrite === false);
          if (mesh.geometry.attributes.uv && !mesh.geometry.attributes.uv1) {
            mesh.geometry.setAttribute("uv1", mesh.geometry.attributes.uv);
          }
          mesh.material = mat;`,
);
source = source.replace(
  `                _mainLightDownPoints.push({ light: sp, darkIntensity: 60, brightIntensity: 0 });`,
  `                _mainLightDownPoints.push({ light: sp, darkIntensity: 60, brightIntensity: 0 });
                if (li % 2 === 1) {
                  const tableFill = new THREE.PointLight(0x7448ff, 0, 24, 1.6);
                  tableFill.position.set(lampCenter.x, lampBox.min.y - 0.35, lampCenter.z);
                  tableFill.name = "lamp" + li + "TableFill";
                  scene.add(tableFill);
                  _mainLightDownPoints.push({
                    light: tableFill,
                    darkIntensity: 22,
                    brightIntensity: 5,
                  });
                }`,
);
source = source.replace(
  `              _kitchenTableCoverLampMat = topMat;`,
  `              _kitchenTableCoverLampMat = topMat;
              _kitchenTableCoverSideMat = sideMat;`,
);
source = source.replace(
  `                bindKitchenTableCoverPlanes(planeInfo, topMat, sideMat);`,
  `                bindKitchenTableCoverPlanes(planeInfo, topMat, sideMat);
                if (!_mainTableTopAreaLight && planeInfo.topPlane) {
                  planeInfo.topPlane.updateMatrixWorld(true);
                  const lightBox = new THREE.Box3().setFromObject(
                    planeInfo.topPlane,
                  );
                  const lightCenter = lightBox.getCenter(new THREE.Vector3());
                  const lightSize = lightBox.getSize(new THREE.Vector3());
                  _mainTableTopAreaLight = new THREE.RectAreaLight(
                    0xfff8f0,
                    0.58,
                    Math.max(1, lightSize.x * 0.9),
                    Math.max(1, lightSize.z * 0.76),
                  );
                  _mainTableTopAreaLight.position.set(
                    lightCenter.x,
                    lightBox.max.y + 4,
                    lightCenter.z,
                  );
                  _mainTableTopAreaLight.rotation.set(-Math.PI / 2, 0, 0);
                  _mainTableTopAreaLight.name = "mainTableTopAreaLight";
                  _mainTableTopAreaLight.userData.baseIntensity = 0.58;
                  scene.add(_mainTableTopAreaLight);
                  _darkModeOnlyLights.push(_mainTableTopAreaLight);
                }`,
);
source = source.replace(
  `        const zoom = 0.09;`,
  `        const zoom = 0.18;`,
);
source = source.replace(
  `      const CAR_SCALE_MULTIPLIER = 1.24;`,
  `      const CAR_SCALE_MULTIPLIER = 1.52;`,
);
source = source.replace(
  `      const car = new THREE.Group();
      car.rotation.order = "YXZ";
      scene.add(car);`,
  `      const car = new THREE.Group();
      car.rotation.order = "YXZ";
      scene.add(car);
      const carKeyLight = new THREE.PointLight(0xc7eaff, 7.5, 16, 1.8);
      carKeyLight.position.set(-1.2, 3.8, 1.8);
      carKeyLight.name = "kitchenCarKeyLight";
      car.add(carKeyLight);
      const carRimLight = new THREE.PointLight(0xff4fc8, 3.5, 11, 1.8);
      carRimLight.position.set(1.5, 2.4, -2.2);
      carRimLight.name = "kitchenCarRimLight";
      car.add(carRimLight);`,
);
source = source.replace(
  `        const camOffsetYOrbit = maxDim * 0.6 * zoom;`,
  `        const camOffsetYOrbit = maxDim * 0.42 * zoom;`,
);
source = source.replace(
  `      const _KITCHEN_MAX_PIXEL_RATIO = 1;`,
  `      const _KITCHEN_MAX_PIXEL_RATIO = 0.95;
      let _kitchenIdlePhysicsAccumulator = 0;`,
);
source = source.replace(
  `      const _darkModeKitchen = {
        background: 0x05050a,
        ambient: { color: 0xfff0e4, intensity: 0.14 },
        hemisphere: { sky: 0xfff4e8, ground: 0xc8b8a8, intensity: 0.1 },
        dirPink: { color: 0x000000, intensity: 0 },
        dirBlue: { color: 0x000000, intensity: 0 },
        dirFillPink: { color: 0x000000, intensity: 0 },
        dirFillBlue: { color: 0x000000, intensity: 0 },
        pointPink: { color: 0x000000, intensity: 0 },
        pointBlue: { color: 0x000000, intensity: 0 },
        warmKey: { color: 0x000000, intensity: 0 },
        warmFill: { color: 0x000000, intensity: 0 },
      };`,
  `      const _darkModeKitchen = {
        background: 0x02030b,
        ambient: { color: 0x18264f, intensity: 0.16 },
        hemisphere: { sky: 0x245cff, ground: 0x2a073f, intensity: 0.12 },
        dirPink: { color: 0xff2fa8, intensity: 0.2 },
        dirBlue: { color: 0x2b9dff, intensity: 0.3 },
        dirFillPink: { color: 0xb42cff, intensity: 0.12 },
        dirFillBlue: { color: 0x30e3ff, intensity: 0.18 },
        pointPink: { color: 0xff1f9d, intensity: 0.24 },
        pointBlue: { color: 0x246bff, intensity: 0.3 },
        warmKey: { color: 0x000000, intensity: 0 },
        warmFill: { color: 0x000000, intensity: 0 },
      };`,
);
source = source.replace(
  `          _kitchenFloorMat.emissive.setHex(0xe8e4de);
          _kitchenFloorMat.emissiveIntensity = (1 - b) * 0.12;`,
  `          _kitchenFloorMat.emissive.setHex(0x16235a);
          _kitchenFloorMat.emissiveIntensity = (1 - b) * 0.16;`,
);
source = source.replace(
  `      const _kitchenFloorColorDark = new THREE.Color(0xd6d0c8);`,
  `      const _kitchenFloorColorDark = new THREE.Color(0x171b2f);`,
);
source = source.replace(
  `                  0xfff6ee,`,
  `                  0xffffff,`,
);
source = source.replace(
  `                  0xfff8f2,`,
  `                  0xb8d8ff,`,
);
source = source.replace(
  `            try { _legacyDarkLightsScale = 0; applyDarkModePreset(_darkModeKitchen); } catch (e) {}`,
  `            try { _legacyDarkLightsScale = 0.48; applyDarkModePreset(_darkModeKitchen); } catch (e) {}`,
);
source = source.replace(
  `        baseMat.color.set(0xe6c3bd);`,
  `        topMat.color.set(0x647bb8);
        topMat.emissive.setHex(0x0d1d50);
        topMat.emissiveIntensity = 0.2;
        sideMat.color.set(0x9aaee0);
        sideMat.emissive.setHex(0x1a2f70);
        sideMat.emissiveMap = sideMat.aoMap;
        sideMat.emissiveIntensity = 0.58;
        baseMat.color.set(0x302544);
        baseMat.emissive.setHex(0x160a2d);
        baseMat.emissiveIntensity = 0.12;`,
);
source = source.replace(
  `                  color: 0xffffff,
                  emissive: 0xffffff,
                  emissiveIntensity: 6,`,
  `                  color: 0xffffff,
                  emissive: 0xffffff,
                  emissiveIntensity: 1.25,`,
);
source = source.replace(
  `                  mesh: mesh,
                  darkIntensity: 6,
                  brightIntensity: 1,`,
  `                  mesh: mesh,
                  darkIntensity: 1.25,
                  brightIntensity: 1,`,
);
source = source.replace(
  `                  darkIntensity: 22,
                  brightIntensity: 2.5,`,
  `                  darkIntensity: 12,
                  brightIntensity: 2.5,`,
);
source = source.replace(
  `              const _bulbMat = new THREE.MeshBasicMaterial({ color: 0xfffae8 });`,
  `              const _bulbMat = new THREE.MeshBasicMaterial({ color: 0x9eeaff });`,
);
source = source.replace(
  `                  darkIntensity: 6,
                  brightIntensity: 14,`,
  `                  darkIntensity: 3,
                  brightIntensity: 14,`,
);
source = source.replace(
  `        if (renderer.capabilities.isWebGL2) {`,
  `        if (renderer.capabilities.isWebGL2 && !_kitchenWorldActive) {`,
);
source = source.replace(
  `              for (let mi = 1; mi <= 14; mi++) {`,
  `              for (let mi = 1; mi <= 14; mi += 2) {`,
);
source = source.replace(
  `                const sp = new THREE.SpotLight(0x6633ee, 0, 40, Math.PI / 7, 0.8, 1.5);
                sp.position.set(lampCenter.x, lampBox.min.y - 0.1, lampCenter.z);
                sp.target.position.set(lampCenter.x, lampBox.min.y - 30, lampCenter.z);
                sp.castShadow = false;
                sp.name = "lamp" + li + "Spot";
                scene.add(sp);
                scene.add(sp.target);
                _mainLightDownPoints.push({ light: sp, darkIntensity: 60, brightIntensity: 0 });
                if (li % 2 === 1) {`,
  `                const lampLightColor = li % 2 === 1 ? 0xff2bbd : 0x22dfff;
                const sp = new THREE.SpotLight(
                  lampLightColor,
                  0,
                  40,
                  Math.PI / 7,
                  0.78,
                  1.5,
                );
                sp.position.set(
                  lampCenter.x,
                  lampBox.min.y - 0.1,
                  lampCenter.z,
                );
                sp.target.position.set(
                  lampCenter.x,
                  lampBox.min.y - 30,
                  lampCenter.z,
                );
                sp.castShadow = false;
                sp.name = "lamp" + li + "Spot";
                scene.add(sp);
                scene.add(sp.target);
                _mainLightDownPoints.push({
                  light: sp,
                  darkIntensity: 34,
                  brightIntensity: 0,
                });
                if (li % 2 === 1) {`,
);
source = source.replace(
  `        if (physicsWorld) {
          physicsWorld.solver.iterations = s.physicsIterations;
        }
        if (typeof resize === "function") resize();`,
  `        if (physicsWorld) {
          physicsWorld.solver.iterations = s.physicsIterations;
        }
        if (_kitchenWorldActive) {
          renderer.shadowMap.enabled = true;
          renderer.toneMappingExposure = 0.86;
          sceneBloomEnabled = false;
          carBloomMixPass.enabled = false;
          if (typeof carShadowLight !== "undefined") {
            carShadowLight.castShadow = true;
            const shadowSize = _KITCHEN_SHADOW_MAP;
            if (carShadowLight.shadow.mapSize.width !== shadowSize) {
              carShadowLight.shadow.mapSize.set(shadowSize, shadowSize);
              carShadowLight.shadow.map?.dispose();
              carShadowLight.shadow.map = null;
            }
            carShadowLight.shadow.radius = 2;
            const shadowCam = _kitchenShadowCamKitchen;
            carShadowLight.shadow.camera.far = shadowCam.far;
            carShadowLight.shadow.camera.left = shadowCam.left;
            carShadowLight.shadow.camera.right = shadowCam.right;
            carShadowLight.shadow.camera.top = shadowCam.top;
            carShadowLight.shadow.camera.bottom = shadowCam.bottom;
            carShadowLight.shadow.camera.updateProjectionMatrix();
            carShadowLight.shadow.needsUpdate = true;
            renderer.shadowMap.needsUpdate = true;
          }
          if (physicsWorld) {
            physicsWorld.solver.iterations = Math.min(s.physicsIterations, 14);
          }
        }
        if (typeof resize === "function") resize();`,
);
source = source.replace(
  `      const _kitchenShadowCamKitchen = {
        far: 95,
        left: -55,
        right: 55,
        top: 55,
        bottom: -55,
      };`,
  `      const _kitchenShadowCamKitchen = {
        far: 40,
        left: -9,
        right: 9,
        top: 9,
        bottom: -9,
      };`,
);
source = source.replace(
  `        if (active) {
          renderer.shadowMap.enabled = false;
          carShadowLight.castShadow = false;`,
  `        if (active) {
          renderer.shadowMap.enabled = true;
          carShadowLight.castShadow = true;`,
);
source = source.replace(
  `          lightBlend +=
            (lightBlendTarget - lightBlend) *
            Math.min(1, dt / LIGHT_FADE_DURATION);
          applyLightBlend(lightBlend);`,
  `          const lightBlendDelta = lightBlendTarget - lightBlend;
          if (Math.abs(lightBlendDelta) > 0.0001) {
            lightBlend +=
              lightBlendDelta * Math.min(1, dt / LIGHT_FADE_DURATION);
            if (Math.abs(lightBlendTarget - lightBlend) <= 0.0001) {
              lightBlend = lightBlendTarget;
            }
            applyLightBlend(lightBlend);
          }`,
);
source = source.replace(
  `          if (physicsStepDt > 0) {
            physicsWorld.step(1 / 60, physicsStepDt, 3);
          }`,
  `          if (physicsStepDt > 0) {
            const realtimePhysics =
              Math.abs(carState.speed) > 0.05 ||
              carState.velY !== 0 ||
              carFalling ||
              keys.forward ||
              keys.reverse ||
              keys.left ||
              keys.right ||
              keys.brake;
            if (realtimePhysics) {
              _kitchenIdlePhysicsAccumulator = 0;
              physicsWorld.step(1 / 60, physicsStepDt, 3);
            } else {
              _kitchenIdlePhysicsAccumulator += physicsStepDt;
              if (_kitchenIdlePhysicsAccumulator >= 1 / 20) {
                physicsWorld.step(
                  1 / 60,
                  _kitchenIdlePhysicsAccumulator,
                  2,
                );
                _kitchenIdlePhysicsAccumulator = 0;
              }
            }
          }`,
);
source = source.replace(
  `      const _canonWorldQuat = new THREE.Quaternion();`,
  `      const _canonWorldQuat = new THREE.Quaternion();
      const _canonBodyLocalCenter = new THREE.Vector3();
      const _airTiltUp = new THREE.Vector3();`,
);
source = source.replace(
  `      const _reflectionBox = new THREE.Box3();

      function getTablePlaySurfaceY() {
        if (tablePlateMesh) {
          tablePlateMesh.updateMatrixWorld(true);
          _reflectionBox.setFromObject(tablePlateMesh);
          if (!_reflectionBox.isEmpty()) return _reflectionBox.max.y;
        }
        return tableSurfaceY;
      }

      function getMeshTableReflectionPoint(mesh, tableY, out) {
        mesh.updateWorldMatrix(true, false);
        _reflectionBox.setFromObject(mesh);
        out.set(
          (_reflectionBox.min.x + _reflectionBox.max.x) * 0.5,
          tableY + 0.006,
          (_reflectionBox.min.z + _reflectionBox.max.z) * 0.5,
        );
        return out;
      }`,
  `      const _reflectionBox = new THREE.Box3();
      let _cachedTablePlaySurfaceY = null;

      function getTablePlaySurfaceY() {
        if (_cachedTablePlaySurfaceY != null) {
          return _cachedTablePlaySurfaceY;
        }
        if (tablePlateMesh) {
          tablePlateMesh.updateMatrixWorld(true);
          _reflectionBox.setFromObject(tablePlateMesh);
          if (!_reflectionBox.isEmpty()) {
            _cachedTablePlaySurfaceY = _reflectionBox.max.y;
            return _cachedTablePlaySurfaceY;
          }
        }
        return tableSurfaceY;
      }

      function getMeshTableReflectionPoint(entry, tableY, out) {
        const mesh = entry.mesh;
        mesh.updateWorldMatrix(true, false);
        out.copy(entry.localCenter);
        mesh.localToWorld(out);
        out.y = tableY + 0.006;
        return out;
      }`,
);
source = source.replace(
  `      let tableLightGlows = [];
      let _tableLightGlowTex = null;`,
  `      let tableLightGlows = [];
      let _tableLightGlowTex = null;
      let _tableLightGlowGeo = null;`,
);
source = source.replace(
  `      function createTableLightGlowSprite(tint, baseSize) {
        const mat = new THREE.SpriteMaterial({
          map: getTableLightGlowTexture(),
          color: tint,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: true,
          blending: THREE.AdditiveBlending,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(baseSize, baseSize * 0.72, 1);
        sprite.visible = false;
        sprite.renderOrder = 4;
        scene.add(sprite);
        return sprite;
      }`,
  `      function createTableLightGlowSprite(tint, baseSize) {
        if (!_tableLightGlowGeo) {
          _tableLightGlowGeo = new THREE.PlaneGeometry(1, 1);
        }
        const mat = new THREE.MeshBasicMaterial({
          map: getTableLightGlowTexture(),
          color: tint,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: true,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const glowPlane = new THREE.Mesh(_tableLightGlowGeo, mat);
        glowPlane.rotation.x = -Math.PI / 2;
        glowPlane.scale.set(baseSize, baseSize * 0.72, 1);
        glowPlane.visible = false;
        glowPlane.renderOrder = 4;
        scene.add(glowPlane);
        return glowPlane;
      }`,
);
source = source.replace(
  `      function setupTableLightReflections(carRoot) {`,
  `      function getLocalReflectionBounds(mesh) {
        const geometry = mesh?.geometry;
        if (geometry && !geometry.boundingBox) geometry.computeBoundingBox();
        const box = geometry?.boundingBox;
        return {
          localCenter: box
            ? box.getCenter(new THREE.Vector3())
            : new THREE.Vector3(),
          localHalfHeight: box
            ? Math.max(0.12, (box.max.y - box.min.y) * 0.5)
            : 0.12,
          localHalfWidth: box
            ? Math.max(0.1, (box.max.x - box.min.x) * 0.5)
            : 0.1,
        };
      }

      function setupTableLightReflections(carRoot) {`,
);
source = source.replace(
  `          tableLightGlows.push({
            mesh,
            sprite: createTableLightGlowSprite(spec.color, spec.size),
            kind: spec.kind,
            baseSize: spec.size,
          });`,
  `          const bounds = getLocalReflectionBounds(mesh);
          const pairOffset = bounds.localHalfWidth * 0.64;
          for (let side = -1; side <= 1; side += 2) {
            const localCenter = bounds.localCenter.clone();
            localCenter.x += pairOffset * side;
            tableLightGlows.push({
              mesh,
              sprite: createTableLightGlowSprite(spec.color, spec.size * 0.72),
              kind: spec.kind,
              baseSize: spec.size * 0.72,
              localCenter,
              localHalfHeight: bounds.localHalfHeight,
            });
          }`,
);
source = source.replace(
  `            baseSize: 0.24,
          });`,
  `            baseSize: 0.24,
            ...getLocalReflectionBounds(node),
          });`,
);
source = source.replace(
  `          getMeshTableReflectionPoint(entry.mesh, tableY, _v0);
          entry.sprite.position.copy(_v0);
          const heightAbove = Math.max(0.12, _reflectionBox.max.y - tableY);`,
  `          getMeshTableReflectionPoint(entry, tableY, _v0);
          entry.sprite.position.copy(_v0);
          const heightAbove = entry.localHalfHeight;`,
);
source = source.replace(
  `            tablePlateMesh = surfaceMesh;
            surfaceMesh.updateMatrixWorld(true);`,
  `            tablePlateMesh = surfaceMesh;
            _cachedTablePlaySurfaceY = null;
            surfaceMesh.updateMatrixWorld(true);`,
);
source = source.replace(
  `            tablePlateCenter.set(tCenter.x, tTopY, tCenter.z);`,
  `            tablePlateCenter.set(tCenter.x, tTopY, tCenter.z);
            const cyanGamingKey = new THREE.PointLight(
              0x00d9ff,
              6,
              44,
              1.7,
            );
            cyanGamingKey.position.set(
              tCenter.x - tSize.x * 0.32,
              tTopY + 5.5,
              tCenter.z - tSize.z * 0.2,
            );
            cyanGamingKey.userData.baseIntensity = 6;
            cyanGamingKey.name = "kitchenCyanGamingKey";
            scene.add(cyanGamingKey);
            _darkModeOnlyLights.push(cyanGamingKey);

            const magentaGamingKey = new THREE.PointLight(
              0xff1f9d,
              5.5,
              42,
              1.7,
            );
            magentaGamingKey.position.set(
              tCenter.x + tSize.x * 0.3,
              tTopY + 4.5,
              tCenter.z + tSize.z * 0.18,
            );
            magentaGamingKey.userData.baseIntensity = 5.5;
            magentaGamingKey.name = "kitchenMagentaGamingKey";
            scene.add(magentaGamingKey);
            _darkModeOnlyLights.push(magentaGamingKey);`,
);
source = source.replace(
  `          const cbCenter = cbBox.getCenter(new THREE.Vector3());
          const hx = cbSize.x / 2,`,
  `          const cbCenter = cbBox.getCenter(new THREE.Vector3());
          _canonBodyLocalCenter.copy(cbCenter);
          canonBodyMesh.worldToLocal(_canonBodyLocalCenter);
          const hx = cbSize.x / 2,`,
);
source = source.replace(
  `              const cbBox = new THREE.Box3().setFromObject(canonBodyMesh);
              const cbCenter = cbBox.getCenter(_canonWorldPos);
              canonBodyMesh.getWorldQuaternion(_canonWorldQuat);
              canonBodyPhys.position.set(cbCenter.x, cbCenter.y, cbCenter.z);`,
  `              _canonWorldPos.copy(_canonBodyLocalCenter);
              canonBodyMesh.localToWorld(_canonWorldPos);
              canonBodyMesh.getWorldQuaternion(_canonWorldQuat);
              canonBodyPhys.position.set(
                _canonWorldPos.x,
                _canonWorldPos.y,
                _canonWorldPos.z,
              );`,
);
source = source.replace(
  `          const _allCarBodies = [
            canonFLBody, canonFRBody, canonRLBody, canonRRBody,
          ].filter(Boolean);`,
  ``,
);
source = source.replace(
  `              if (_allCarBodies.includes(other)) {`,
  `              if (
                other === canonFLBody ||
                other === canonFRBody ||
                other === canonRLBody ||
                other === canonRRBody
              ) {`,
);
source = source.replace(
  `            targetUp = new THREE.Vector3(-sinP * fx, cosP, -sinP * fz).normalize();`,
  `            targetUp = _airTiltUp
              .set(-sinP * fx, cosP, -sinP * fz)
              .normalize();`,
);
source = source.replace(
  `        const s = perfSettings;`,
  `        const kitchenUltraUsesHighSettings =
          _kitchenWorldActive && perfTierIndex > VISUAL_PARITY_TIER;
        const s = kitchenUltraUsesHighSettings
          ? {
              ...perfSettings,
              ...PERF_TIER_PRESETS[VISUAL_PARITY_TIER],
              name: perfSettings.name,
              tier: perfTierIndex,
            }
          : perfSettings;`,
);
source = source.replace(
  `        _kitchenWorldActive = !!active;
        applyPerformanceSettings();`,
  `        _kitchenWorldActive = !!active;
        applyPerformanceSettings();
        renderer.toneMappingExposure = active ? 0.86 : 1;
        sceneBloomEnabled = false;
        carBloomMixPass.enabled = false;`,
);
const kitchenAnimateMarker = `      function animate() {
        requestAnimationFrame(animate);`;
if (!source.includes(kitchenAnimateMarker)) {
  throw new Error(`Kitchen animation marker not found in ${htmlPath}`);
}
source = source.replace(
  kitchenAnimateMarker,
  `      function animate() {
        if (!_kitchenSceneRendering) {
          _kitchenSceneAnimationFrame = 0;
          return;
        }
        _kitchenSceneAnimationFrame = requestAnimationFrame(animate);`,
);

const kitchenStartMarker = `      animate();`;
if (!source.endsWith(kitchenStartMarker)) {
  throw new Error(`Kitchen animation start marker not found in ${htmlPath}`);
}
source = source.slice(0, -kitchenStartMarker.length) + `      export function setKitchenSceneRendering(active) {
        const shouldRender = Boolean(active);
        if (!shouldRender) {
          _kitchenSceneRendering = false;
          if (_kitchenSceneAnimationFrame) {
            cancelAnimationFrame(_kitchenSceneAnimationFrame);
            _kitchenSceneAnimationFrame = 0;
          }
          return;
        }

        const mount = getKitchenSceneMount();
        if (renderer.domElement.parentElement !== mount) {
          mount.appendChild(renderer.domElement);
        }
        resize();
        if (_kitchenSceneRendering) return;
        _kitchenSceneRendering = true;
        clock.getDelta();
        animate();
      }
      setKitchenSceneRendering(true);`;

source = source.replace(
  `          carShadowLight.position.set(car.position.x + 3, car.position.y + 20, car.position.z + 2);`,
  `          carShadowLight.position.set(
            car.position.x,
            car.position.y + 20,
            car.position.z,
          );`,
);

const requiredOutput = [
  'kitchenAsset("ul-kitchen13.gltf")',
  'officeAsset("car-game14.gltf")',
  'emitKitchenSceneEvent("ready")',
  "getKitchenSceneMount().appendChild(canvas)",
  "setKitchenSceneRendering(active)",
  "_kitchenTableCoverSideMat = sideMat",
  "clearcoatRoughness: 0.06",
  "Poliigon_TilesCeramicWhite_6956_BaseColor.jpg",
  "KITCHEN_COVER_TILES_X = 10.75",
  "left: -9",
  "carShadowLight.castShadow = true",
  "renderer.shadowMap.needsUpdate = true",
  "kitchenUltraUsesHighSettings",
  "car.position.y + 20",
  'name = "lamp" + li + "TableFill"',
  "_KITCHEN_MAX_PIXEL_RATIO = 0.95",
  "mi += 2",
  "lampLightColor",
  "lightBlendDelta",
  "_kitchenIdlePhysicsAccumulator",
  "_cachedTablePlaySurfaceY",
  "_tableLightGlowGeo",
  "pairOffset = bounds.localHalfWidth * 0.64",
  "_canonBodyLocalCenter",
  "background: 0x02030b",
  "_legacyDarkLightsScale = 0.48",
  "topMat.color.set(0x647bb8)",
  "return 0.42",
  "carBloomMixPass.enabled = false",
  "kitchenCyanGamingKey",
  "CAR_SCALE_MULTIPLIER = 1.52",
  "kitchenCarKeyLight",
  "mainTableTopAreaLight",
];
for (const expected of requiredOutput) {
  if (!source.includes(expected)) {
    throw new Error(`Kitchen conversion failed to add: ${expected}`);
  }
}

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, source, "utf8");
console.log(
  "Wrote",
  outFile,
  "from",
  htmlPath,
  `(${source.split("\n").length} lines)`,
);
