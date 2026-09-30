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
  `        _kitchenTableCoverLampMat = null;
        _kitchenCoverTopMesh = null;`,
  `        _kitchenTableCoverLampMat = null;
        _kitchenTableCoverSideMat = null;
        _kitchenCoverTopMesh = null;`,
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
  `      function _kitchenCoverMatLite(map, roughnessMap) {
        return new THREE.MeshPhysicalMaterial({
          map,
          roughnessMap,
          roughness: 0.12,
          metalness: 0.18,
          envMapIntensity: 2.8,
          clearcoat: 1,
          clearcoatRoughness: 0.06,
          side: THREE.DoubleSide,
        });
      }`,
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
  `        const zoom = 0.09;`,
  `        const zoom = 0.18;`,
);
source = source.replace(
  `        const camOffsetYOrbit = maxDim * 0.6 * zoom;`,
  `        const camOffsetYOrbit = maxDim * 0.42 * zoom;`,
);
source = source.replace(
  `      const _KITCHEN_MAX_PIXEL_RATIO = 1;`,
  `      const _KITCHEN_MAX_PIXEL_RATIO = 0.82;
      let _kitchenIdlePhysicsAccumulator = 0;`,
);
source = source.replace(
  `      finalComposer.addPass(carBloomMixPass);`,
  ``,
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
  `                if (li % 2 === 1) {
                  const sp = new THREE.SpotLight(
                    0x6633ee,
                    0,
                    44,
                    Math.PI / 6.2,
                    0.82,
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
                    darkIntensity: 76,
                    brightIntensity: 0,
                  });`,
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
          renderer.shadowMap.enabled = false;
          if (typeof carShadowLight !== "undefined") {
            carShadowLight.castShadow = false;
          }
          if (physicsWorld) {
            physicsWorld.solver.iterations = Math.min(s.physicsIterations, 14);
          }
        }
        if (typeof resize === "function") resize();`,
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
        };
      }

      function setupTableLightReflections(carRoot) {`,
);
source = source.replace(
  `            baseSize: spec.size,
          });`,
  `            baseSize: spec.size,
            ...getLocalReflectionBounds(mesh),
          });`,
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

const requiredOutput = [
  'kitchenAsset("ul-kitchen13.gltf")',
  'officeAsset("car-game14.gltf")',
  'emitKitchenSceneEvent("ready")',
  "getKitchenSceneMount().appendChild(canvas)",
  "setKitchenSceneRendering(active)",
  "_kitchenTableCoverSideMat = sideMat",
  "clearcoatRoughness: 0.06",
  'name = "lamp" + li + "TableFill"',
  "_KITCHEN_MAX_PIXEL_RATIO = 0.82",
  "mi += 2",
  "darkIntensity: 76",
  "lightBlendDelta",
  "_kitchenIdlePhysicsAccumulator",
  "_cachedTablePlaySurfaceY",
  "_canonBodyLocalCenter",
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
