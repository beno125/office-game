/**
 * Converts the standalone kitchen HTML into a lazy-loaded application module.
 * Override source: KITCHEN_HTML=/path/to/kitchen-scene.html npm run sync-kitchen
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "src", "components", "kitchen");
const outFile = join(outDir, "kitchenSceneModule.js");
const htmlPath =
  process.env.KITCHEN_HTML ||
  join(
    dirname(dirname(root)),
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
          kitchenAsset("ul-kitchen19.gltf"),`,
);
source = source.replace(
  `      function loadKitchenWorld() {
        const loadToken = ++_kitchenLoadToken;
        const kLoader = new GLTFLoader();`,
  `      const MISTER_SPOT_SPEED = 3.6;
      const MISTER_SPOT_SCALE = 9;
      const MISTER_SPOT_TURN_DURATION = 0.72;
      const MISTER_SPOT_HOLD_DURATION = 0.14;
      const MISTER_SPOT_EASE_DIST = 2.8;
      const ROBOT_RAIL_SCALE_Y = 2.4;
      const ROBOT_RAIL_SCALE_X = 1.12;
      const ROBOT_RAIL_OFFSET_Y = 8;
      let _misterSpot = null;

      function _buildRobotRailPath(rail, kmodel) {
        let mesh = rail && rail.isMesh ? rail : null;
        if (!mesh && rail) {
          rail.traverse((n) => {
            if (!mesh && n.isMesh) mesh = n;
          });
        }
        const geom = mesh && mesh.geometry;
        const pos = geom && geom.attributes && geom.attributes.position;
        if (!pos) return null;
        rail.updateMatrix();
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        let y = rail.position.y;
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(rail.matrix);
          if (v.x < minX) minX = v.x;
          if (v.x > maxX) maxX = v.x;
          if (v.z < minZ) minZ = v.z;
          if (v.z > maxZ) maxZ = v.z;
          y = v.y;
        }
        if (!(maxX > minX) || !(maxZ > minZ)) return null;
        const table =
          kmodel &&
          (kmodel.getObjectByName("mainTablePlate") ||
            kmodel.getObjectByName("mainTableBase"));
        if (table) {
          table.updateWorldMatrix(true, false);
          const box = new THREE.Box3().setFromObject(table);
          const pad = 2.5;
          const nMinX = Math.max(minX, box.min.x - pad);
          const nMaxX = Math.min(maxX, box.max.x + pad);
          const nMinZ = Math.max(minZ, box.min.z - pad);
          const nMaxZ = Math.min(maxZ, box.max.z + pad);
          if (nMaxX > nMinX + 4 && nMaxZ > nMinZ + 4) {
            minX = nMinX;
            maxX = nMaxX;
            minZ = nMinZ;
            maxZ = nMaxZ;
          }
        }
        const cx = (minX + maxX) * 0.5;
        const hx = (maxX - minX) * 0.5 * ROBOT_RAIL_SCALE_X;
        minX = cx - hx;
        maxX = cx + hx;
        const zNear = maxZ;
        const cz = (minZ + maxZ) * 0.5;
        const hz = (maxZ - minZ) * 0.5 * ROBOT_RAIL_SCALE_Y;
        minZ = cz - hz;
        maxZ = Math.min(zNear, cz + hz);
        minZ += ROBOT_RAIL_OFFSET_Y;
        maxZ += ROBOT_RAIL_OFFSET_Y;
        const loop = [
          new THREE.Vector3(minX, y, minZ),
          new THREE.Vector3(maxX, y, minZ),
          new THREE.Vector3(maxX, y, maxZ),
          new THREE.Vector3(minX, y, maxZ),
        ];
        const segs = [];
        let acc = 0;
        for (let i = 0; i < 4; i++) {
          const from = loop[i];
          const to = loop[(i + 1) % 4];
          const len = from.distanceTo(to);
          segs.push({ from, to, len, acc });
          acc += len;
        }
        return { segs, pathLength: acc, y };
      }

      function _misterSpotClosestDist(path, x, z) {
        let bestDist = 0;
        let bestD = Infinity;
        for (let i = 0; i < path.segs.length; i++) {
          const seg = path.segs[i];
          const dx = seg.to.x - seg.from.x;
          const dz = seg.to.z - seg.from.z;
          const lenSq = dx * dx + dz * dz;
          let t = 0;
          if (lenSq > 1e-8) {
            t = ((x - seg.from.x) * dx + (z - seg.from.z) * dz) / lenSq;
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
          }
          const px = seg.from.x + dx * t;
          const pz = seg.from.z + dz * t;
          const ddx = px - x;
          const ddz = pz - z;
          const d = ddx * ddx + ddz * ddz;
          if (d < bestD) {
            bestD = d;
            bestDist = seg.acc + t * seg.len;
          }
        }
        return bestDist;
      }

      function _misterSpotSmooth(t) {
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        return t * t * (3 - 2 * t);
      }

      function _misterSpotSegYaw(seg) {
        return Math.atan2(seg.to.x - seg.from.x, seg.to.z - seg.from.z);
      }

      function _misterSpotAngleDelta(from, to) {
        let d = to - from;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return d;
      }

      function _misterSpotPlaceDrive(m) {
        const seg = m.segs[m.seg];
        const len = seg.len;
        const t = len > 1e-6 ? m.along / len : 0;
        m.object.position.set(
          seg.from.x + (seg.to.x - seg.from.x) * t,
          m.y,
          seg.from.z + (seg.to.z - seg.from.z) * t,
        );
        m.object.rotation.y = _misterSpotSegYaw(seg);
      }

      function _misterSpotStartDrive(m, segIndex, along) {
        const segs = m.segs;
        m.seg = segIndex;
        m.mode = "drive";
        const seg = segs[segIndex];
        const len = seg.len;
        const ease = Math.min(MISTER_SPOT_EASE_DIST, len * 0.35);
        if (along < 0) along = 0;
        if (along > len) along = len;
        m.along = along;
        if (ease > 0.12 && along < ease) {
          m.drivePhase = "in";
          m.easeLen = ease;
          m.phaseDur = (2 * ease) / MISTER_SPOT_SPEED;
          m.phaseT = Math.sqrt(along / ease);
        } else if (ease > 0.12 && along > len - ease) {
          m.drivePhase = "out";
          m.easeFrom = len - ease;
          m.easeLen = ease;
          m.phaseDur = (2 * ease) / MISTER_SPOT_SPEED;
          const u = (along - (len - ease)) / ease;
          m.phaseT = 1 - Math.sqrt(Math.max(0, 1 - u));
        } else {
          m.drivePhase = "cruise";
          m.phaseT = 0;
        }
        _misterSpotPlaceDrive(m);
      }

      function _misterSpotArriveCorner(m) {
        const segs = m.segs;
        const seg = segs[m.seg];
        const next = segs[(m.seg + 1) % segs.length];
        m.along = seg.len;
        m.object.position.set(seg.to.x, m.y, seg.to.z);
        m.yawFrom = _misterSpotSegYaw(seg);
        m.yawTo = _misterSpotSegYaw(next);
        m.yawDelta = _misterSpotAngleDelta(m.yawFrom, m.yawTo);
        m.object.rotation.y = m.yawFrom;
        if (Math.abs(m.yawDelta) < 1e-3) {
          _misterSpotStartDrive(m, (m.seg + 1) % segs.length, 0);
          return;
        }
        m.mode = "hold";
        m.holdT = 0;
      }

      function updateMisterSpot(dt) {
        const m = _misterSpot;
        if (!m || !m.object || !m.segs || !m.segs.length) return;
        if (dt < 0) dt = 0;
        const segs = m.segs;
        if (m.mode === "hold") {
          m.holdT += dt;
          m.object.position.set(segs[m.seg].to.x, m.y, segs[m.seg].to.z);
          m.object.rotation.y = m.yawFrom;
          if (m.holdT >= MISTER_SPOT_HOLD_DURATION) {
            m.mode = "turn";
            m.turnT = 0;
          }
          return;
        }
        if (m.mode === "turn") {
          m.turnT +=
            MISTER_SPOT_TURN_DURATION > 1e-6
              ? dt / MISTER_SPOT_TURN_DURATION
              : 1;
          const u = _misterSpotSmooth(m.turnT);
          m.object.position.set(segs[m.seg].to.x, m.y, segs[m.seg].to.z);
          m.object.rotation.y = m.yawFrom + m.yawDelta * u;
          if (m.turnT >= 1) {
            m.object.rotation.y = m.yawTo;
            _misterSpotStartDrive(m, (m.seg + 1) % segs.length, 0);
          }
          return;
        }
        const seg = segs[m.seg];
        const len = seg.len;
        const ease = Math.min(MISTER_SPOT_EASE_DIST, len * 0.35);
        if (m.drivePhase === "in") {
          m.phaseT += m.phaseDur > 1e-6 ? dt / m.phaseDur : 1;
          const u = m.phaseT < 0 ? 0 : m.phaseT > 1 ? 1 : m.phaseT;
          m.along = m.easeLen * u * u;
          if (m.phaseT >= 1) {
            m.along = m.easeLen;
            m.drivePhase = "cruise";
          }
        } else if (m.drivePhase === "out") {
          m.phaseT += m.phaseDur > 1e-6 ? dt / m.phaseDur : 1;
          const u = m.phaseT < 0 ? 0 : m.phaseT > 1 ? 1 : m.phaseT;
          const k = 1 - (1 - u) * (1 - u);
          m.along = m.easeFrom + m.easeLen * k;
          if (m.phaseT >= 1) {
            _misterSpotArriveCorner(m);
            return;
          }
        } else {
          m.along += MISTER_SPOT_SPEED * dt;
          if (ease > 0.12 && m.along >= len - ease) {
            m.along = len - ease;
            m.drivePhase = "out";
            m.easeFrom = len - ease;
            m.easeLen = ease;
            m.phaseT = 0;
            m.phaseDur = (2 * ease) / MISTER_SPOT_SPEED;
          } else if (m.along >= len) {
            _misterSpotArriveCorner(m);
            return;
          }
        }
        _misterSpotPlaceDrive(m);
      }

      function _applyMisterSpotMaterials(root) {
        const env = scene.environment;
        const mattPlastic = (color) => {
          const mat = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.88,
            metalness: 0,
            envMapIntensity: 0.18,
          });
          if (env) mat.envMap = env;
          return mat;
        };
        const stickerColor = new THREE.Color(
          0.8003778457641602,
          0.5333334803581238,
          0.7881258726119995,
        );
        const hotRed = new THREE.MeshBasicMaterial({
          color: 0xff3a00,
          toneMapped: false,
        });
        const whiteLight = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.32,
          metalness: 0,
          emissive: 0xffffff,
          emissiveIntensity: 3.2,
          envMapIntensity: 0,
        });
        const glossyBlack = new THREE.MeshStandardMaterial({
          color: 0x0b0b0b,
          roughness: 0.16,
          metalness: 0.04,
          envMapIntensity: 1.05,
        });
        const rubberPink = new THREE.MeshStandardMaterial({
          color: 0xff79a8,
          roughness: 0.96,
          metalness: 0,
          envMapIntensity: 0.08,
        });
        const screenBlack = new THREE.MeshStandardMaterial({
          color: 0x121212,
          roughness: 0.4,
          metalness: 0.02,
          envMapIntensity: 0.55,
        });
        if (env) {
          glossyBlack.envMap = env;
          rubberPink.envMap = env;
          screenBlack.envMap = env;
        }
        const mats = {
          bodyMainWhite: mattPlastic(0xf3f3f3),
          Text: mattPlastic(0xf3f3f3),
          buttonBaseMain: mattPlastic(0xf0c000),
          stikerPurple: mattPlastic(stickerColor),
          buttonMain: hotRed,
          buttonsSmall: whiteLight,
          eyes: glossyBlack,
          rubber: rubberPink,
          screen: screenBlack,
        };
        root.traverse((n) => {
          if (!n.isMesh) return;
          const mat = mats[n.name];
          if (mat) n.material = mat;
          else applySceneEnvironmentToMaterial(n.material);
        });
      }

      function loadMisterSpot(kmodel, loadToken) {
        const mLoader = new GLTFLoader();
        mLoader.load(
          kitchenAsset("Mister-spot.gltf"),
          (gltf) => {
            if (!_worldSwitched || loadToken !== _kitchenLoadToken) return;
            const mister = gltf.scene;
            mister.name = "MisterSpot";
            mister.scale.setScalar(MISTER_SPOT_SCALE);
            applyKitchenMeshPerf(mister);
            applyTextureAnisotropyToRoot(mister);
            applyPerformanceShadowPolicy(mister);
            mister.traverse((n) => {
              if (!n.isMesh) return;
              n.frustumCulled = true;
            });
            _applyMisterSpotMaterials(mister);
            const rail = kmodel.getObjectByName("robotRail");
            if (rail) rail.visible = false;
            const path = rail ? _buildRobotRailPath(rail, kmodel) : null;
            kmodel.add(mister);
            if (path) {
              const chair = kmodel.getObjectByName("barChairWood");
              const dist0 = chair
                ? _misterSpotClosestDist(path, chair.position.x, chair.position.z)
                : 0;
              let d = dist0 % path.pathLength;
              if (d < 0) d += path.pathLength;
              let segI = 0;
              let along0 = 0;
              for (let i = 0; i < path.segs.length; i++) {
                const s = path.segs[i];
                if (d > s.acc + s.len && i < path.segs.length - 1) continue;
                segI = i;
                along0 = d - s.acc;
                break;
              }
              _misterSpot = {
                object: mister,
                segs: path.segs,
                pathLength: path.pathLength,
                y: path.y,
                seg: 0,
                along: 0,
                mode: "drive",
                drivePhase: "cruise",
              };
              _misterSpotStartDrive(_misterSpot, segI, along0);
            } else if (rail) {
              mister.position.copy(rail.position);
              _misterSpot = null;
            }
          },
          undefined,
          (err) => {
            console.error("Failed to load Mister-spot.gltf:", err);
          },
        );
      }

      function loadKitchenWorld() {
        const loadToken = ++_kitchenLoadToken;
        const kLoader = new GLTFLoader();`,
);
source = source.replace(
  `            scene.add(kmodel);
            _currentWorldModel = kmodel;`,
  `            scene.add(kmodel);
            _currentWorldModel = kmodel;
            loadMisterSpot(kmodel, loadToken);`,
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
            }
            if (node.name === "rearLights") {`,
);

const kitchenCarLampSpotsMarker = `        storedCarScale = carScale;`;
if (!source.includes(kitchenCarLampSpotsMarker)) {
  throw new Error(`Kitchen car lamp spot marker not found in ${htmlPath}`);
}
source = source.replace(
  kitchenCarLampSpotsMarker,
  `        storedCarScale = carScale;
        attachCarHeadTailSpotLights(car);`,
);
if (!source.includes("attachCarHeadTailSpotLights(car)")) {
  throw new Error(`Kitchen car lamp spots were not injected from ${htmlPath}`);
}

const kitchenCarLampSpotsFnMarker = `      function setupTableLightReflections(carRoot) {`;
if (!source.includes(kitchenCarLampSpotsFnMarker)) {
  throw new Error(`Kitchen car lamp spot function marker not found in ${htmlPath}`);
}
source = source.replace(
  kitchenCarLampSpotsFnMarker,
  `      const _carLampSpots = [];
      const _carLampTablePoint = new THREE.Vector3();
      const _lampCarBox = new THREE.Box3();
      const _lampCarCorner = new THREE.Vector3();
      function getMeshBoxInCarLocal(mesh, outBox) {
        mesh.updateWorldMatrix(true, false);
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox;
        outBox.makeEmpty();
        for (let ix = 0; ix < 2; ix++) {
          for (let iy = 0; iy < 2; iy++) {
            for (let iz = 0; iz < 2; iz++) {
              _lampCarCorner.set(
                ix ? box.max.x : box.min.x,
                iy ? box.max.y : box.min.y,
                iz ? box.max.z : box.min.z,
              );
              mesh.localToWorld(_lampCarCorner);
              car.worldToLocal(_lampCarCorner);
              outBox.expandByPoint(_lampCarCorner);
            }
          }
        }
        return outBox;
      }
      function getCarLocalTableY() {
        const tableWorldY = getTablePlaySurfaceY();
        const y = tableWorldY == null ? car.position.y : tableWorldY;
        _carLampTablePoint.set(car.position.x, y, car.position.z);
        car.worldToLocal(_carLampTablePoint);
        return _carLampTablePoint.y;
      }
      function updateCarLampSpotAim() {
        if (!_carLampSpots.length) return;
        const tableLocalY = getCarLocalTableY();
        for (let i = 0; i < _carLampSpots.length; i++) {
          const entry = _carLampSpots[i];
          const spot = entry.spot;
          const aimY =
            entry.kind === "front"
              ? tableLocalY
              : spot.position.y * 0.55 + tableLocalY * 0.45;
          spot.target.position.set(
            spot.position.x,
            aimY,
            spot.position.z + entry.zSign * entry.aimAlong,
          );
        }
      }
      function attachCarHeadTailSpotLights(carRoot) {
        _carLampSpots.length = 0;
        const worldLen = Math.max(0.3, halfL * storedCarScale * 2);
        const distance = worldLen * 3.4;
        attachCarLampSpots(
          carRoot.getObjectByName("frontLights"),
          0xfff1d0,
          1,
          "front",
          6.2,
          distance,
          Math.PI / 3.15,
        );
        attachCarLampSpots(
          carRoot.getObjectByName("rearLights"),
          0xff2a2a,
          -1,
          "rear",
          2.4,
          distance * 0.72,
          Math.PI / 5.2,
        );
      }
      function attachCarLampSpots(
        mesh,
        color,
        zSign,
        kind,
        intensity,
        distance,
        angle,
      ) {
        if (!mesh || !mesh.geometry) return;
        getMeshBoxInCarLocal(mesh, _lampCarBox);
        const sizeX = _lampCarBox.max.x - _lampCarBox.min.x;
        const midY = (_lampCarBox.min.y + _lampCarBox.max.y) * 0.5;
        const lampZ = kind === "front" ? _lampCarBox.max.z : _lampCarBox.min.z;
        const halfSpan = sizeX * 0.5;
        const sides = halfSpan > 0.04 ? [-1, 1] : [0];
        const aimAlong = Math.max(1.4, halfL * (kind === "front" ? 0.95 : 1.4));
        const tableLocalY = getCarLocalTableY();
        for (let si = 0; si < sides.length; si++) {
          const side = sides[si];
          const px = side * halfSpan * 0.76;
          const pz = lampZ;
          const spot = new THREE.SpotLight(color, intensity, distance, angle, 0.78, 1.45);
          const target = new THREE.Object3D();
          spot.name = kind === "front" ? "carFrontSpot" : "carRearSpot";
          target.name = spot.name + "Target";
          spot.position.set(px, midY, pz);
          const aimY =
            kind === "front"
              ? tableLocalY
              : midY * 0.55 + tableLocalY * 0.45;
          target.position.set(px, aimY, pz + zSign * aimAlong);
          spot.target = target;
          spot.castShadow = false;
          car.add(spot);
          car.add(target);
          _carLampSpots.push({ spot, kind, zSign, aimAlong });
        }
      }
      function setupTableLightReflections(carRoot) {`,
);
if (!source.includes("function attachCarHeadTailSpotLights")) {
  throw new Error(`Kitchen car lamp spot function was not injected from ${htmlPath}`);
}

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
      let _kitchenTableCoverSideMat = null;
      let _barChairWoodMat = null;
      let _barChairWoodMatBackup = null;`,
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
                  // A RectAreaLight here re-shaded every surface as the
                  // camera orbited, because three.js evaluates rect-area
                  // light in a basis derived from the view vector. A
                  // directional light gives the same soft top-down fill
                  // with view-independent diffuse.
                  _mainTableTopAreaLight = new THREE.DirectionalLight(
                    0xfff8f0,
                    0.9,
                  );
                  _mainTableTopAreaLight.position.set(
                    lightCenter.x,
                    lightBox.max.y + 24,
                    lightCenter.z,
                  );
                  _mainTableTopAreaLight.target.position.set(
                    lightCenter.x,
                    lightBox.max.y - 6,
                    lightCenter.z,
                  );
                  _mainTableTopAreaLight.castShadow = false;
                  _mainTableTopAreaLight.name = "mainTableTopAreaLight";
                  _mainTableTopAreaLight.userData.baseIntensity = 0.9;
                  scene.add(_mainTableTopAreaLight.target);
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
        sideMat.color.set(0x647bb8);
        sideMat.emissive.setHex(0x0d1d50);
        sideMat.emissiveIntensity = 0.2;
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
        const reflectionSurface = _kitchenCoverTopMesh || tablePlateMesh;
        if (reflectionSurface) {
          reflectionSurface.updateMatrixWorld(true);
          _reflectionBox.setFromObject(reflectionSurface);
          if (!_reflectionBox.isEmpty()) {
            _cachedTablePlaySurfaceY = _reflectionBox.max.y;
            return _cachedTablePlaySurfaceY;
          }
        }
        return tableSurfaceY;
      }

      const _carLightFwd = new THREE.Vector3();
      const _carLightRight = new THREE.Vector3();
      const _lightGlowBox = new THREE.Box3();
      const _lightGlowCenter = new THREE.Vector3();
      const _lightGlowCorner = new THREE.Vector3();

      function updateCarLightAxes() {
        const yaw = carState.angle + (carState.driftAngle || 0);
        _carLightFwd.set(Math.sin(yaw), 0, Math.cos(yaw));
        _carLightRight.set(_carLightFwd.z, 0, -_carLightFwd.x);
      }

      function getMeshTableReflectionPoint(entry, tableY, out) {
        const mesh = entry.mesh || entry;
        mesh.updateWorldMatrix(true, false);
        const geometry = mesh.geometry;
        if (geometry && !geometry.boundingBox) geometry.computeBoundingBox();
        const box = geometry && geometry.boundingBox;
        if (!box) {
          mesh.getWorldPosition(out);
          out.y = tableY;
          if (entry && entry !== mesh) {
            entry._worldLampSpan = entry.baseSize || 0.12;
          }
          return out;
        }
        const sizeX = box.max.x - box.min.x;
        const sizeZ = box.max.z - box.min.z;
        const axis = sizeX >= sizeZ ? "x" : "z";
        const span = axis === "x" ? sizeX : sizeZ;
        out.set(
          (box.min.x + box.max.x) * 0.5,
          (box.min.y + box.max.y) * 0.5,
          (box.min.z + box.max.z) * 0.5,
        );
        const side = (entry && entry.side) || 0;
        if (side !== 0 && span > 1e-4) {
          out[axis] = box.min[axis] + span * (side < 0 ? 0.12 : 0.88);
        }
        mesh.localToWorld(out);
        if (entry && entry !== mesh) {
          mesh.getWorldScale(_lightGlowCorner);
          const axisScale = axis === "x" ? _lightGlowCorner.x : _lightGlowCorner.z;
          entry._worldLampSpan = Math.max(0.04, span * Math.abs(axisScale));
        }
        out.y = tableY;
        return out;
      }`,
);
source = source.replace(
  `      let tableLightGlows = [];
      let _tableLightGlowTex = null;`,
  `      let tableLightGlows = [];
      let _tableLightGlowTex = null;
      let _tableHeadlightBeamTex = null;
      let _tableLightGlowGeo = null;
      let _tableHeadlightBeamGeo = null;
      const HEADLIGHT_BEAM_ASPECT = 652 / 326;`,
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
          _tableLightGlowGeo.rotateX(-Math.PI / 2);
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
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
          stencilWrite: true,
          stencilWriteMask: 0x00,
          stencilRef: 1,
          stencilFunc: THREE.EqualStencilFunc,
          stencilFail: THREE.KeepStencilOp,
          stencilZFail: THREE.KeepStencilOp,
          stencilZPass: THREE.KeepStencilOp,
        });
        const glowPlane = new THREE.Mesh(
          kind === "front" ? getTableHeadlightBeamGeometry() : _tableLightGlowGeo,
          mat,
        );
        glowPlane.scale.set(baseSize, 1, baseSize * 0.72);
        glowPlane.visible = false;
        glowPlane.renderOrder = 4;
        scene.add(glowPlane);
        return glowPlane;
      }`,
);
source = source.replace(
  `      function createTableLightGlowSprite(tint, baseSize) {`,
  `      function getTableHeadlightBeamGeometry() {
        if (_tableHeadlightBeamGeo) return _tableHeadlightBeamGeo;
        const geometry = new THREE.PlaneGeometry(1, 1);
        geometry.rotateX(-Math.PI / 2);
        const uv = geometry.attributes.uv;
        const pos = geometry.attributes.position;
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(i, pos.getZ(i) + 0.5, pos.getX(i) + 0.5);
        }
        uv.needsUpdate = true;
        _tableHeadlightBeamGeo = geometry;
        return _tableHeadlightBeamGeo;
      }

      function getTableHeadlightBeamTexture() {
        if (_tableHeadlightBeamTex) return _tableHeadlightBeamTex;
        const loader = new THREE.TextureLoader();
        _tableHeadlightBeamTex = loader.load(
          officeAsset("textures/headlight-beam.png") + "?v=dim3",
        );
        _tableHeadlightBeamTex.wrapS = THREE.ClampToEdgeWrapping;
        _tableHeadlightBeamTex.wrapT = THREE.ClampToEdgeWrapping;
        _tableHeadlightBeamTex.anisotropy = 8;
        return _tableHeadlightBeamTex;
      }

      function createTableLightGlowSprite(tint, baseSize, kind = "") {`,
);
source = source.replace(
  `          map: getTableLightGlowTexture(),
          color: tint,`,
  `          map:
            kind === "front"
              ? getTableHeadlightBeamTexture()
              : getTableLightGlowTexture(),
          color: kind === "front" ? 0xffffff : tint,`,
);
source = source.replace(
  `          tableLightGlows.push({
            mesh,
            sprite: createTableLightGlowSprite(spec.color, spec.size),
            kind: spec.kind,
            baseSize: spec.size,
          });`,
  `          if (spec.kind === "front") {
            tableLightGlows.push({
              mesh,
              sprite: createTableLightGlowSprite(
                spec.color,
                spec.size,
                spec.kind,
              ),
              kind: spec.kind,
              baseSize: spec.size,
              side: 0,
            });
            continue;
          }
          for (let side = -1; side <= 1; side += 2) {
            tableLightGlows.push({
              mesh,
              sprite: createTableLightGlowSprite(
                spec.color,
                spec.size * 0.72,
                spec.kind,
              ),
              kind: spec.kind,
              baseSize: spec.size * 0.72,
              side,
            });
          }`,
);
source = source.replace(
  `            baseSize: 0.24,
          });`,
  `            baseSize: 0.24,
            side: 0,
          });`,
);
source = source.replace(
  `          getMeshTableReflectionPoint(entry.mesh, tableY, _v0);
          entry.sprite.position.copy(_v0);
          const heightAbove = Math.max(0.12, _reflectionBox.max.y - tableY);
          const sc = entry.baseSize * (0.88 + heightAbove * 0.06);
          entry.sprite.scale.set(sc, sc * 0.72, 1);`,
  `          getMeshTableReflectionPoint(entry, tableY, _v0);
          entry.sprite.rotation.set(0, carYaw, 0);
          const lampSpan = entry._worldLampSpan || worldHalfW * 0.5;
          if (entry.kind === "front") {
            const beamWidth = Math.max(0.55, lampSpan * 2.4);
            const beamLength = beamWidth * HEADLIGHT_BEAM_ASPECT;
            _v0.addScaledVector(_carLightFwd, beamLength * 0.58);
            entry.sprite.scale.set(beamWidth * 1.2, 1, beamLength);
          } else {
            const sc = Math.max(0.1, Math.min(lampSpan * 0.45, worldHalfW * 0.5));
            entry.sprite.scale.set(sc, 1, sc * 0.85);
          }
          entry.sprite.position.copy(_v0);`,
);
source = source.replace(
  `        if (!tableLightGlows.length || !car || !perfSettings.reflection) {`,
  `        if (!tableLightGlows.length || !car || !_kitchenWorldActive) {`,
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
  `            const _matteWhiteDoubleSideMat = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              roughness: 1.0,
              metalness: 0.0,
              side: THREE.DoubleSide,
            });`,
  `            const _matteWhiteDoubleSideMat = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              roughness: 1.0,
              metalness: 0.0,
              envMapIntensity: 0,
              side: THREE.FrontSide,
              polygonOffset: true,
              polygonOffsetFactor: 1,
              polygonOffsetUnits: 1,
            });`,
);
source = source.replace(
  `              if (_matteWhiteDoubleSideNames.has(n.name)) {
                n.material = _matteWhiteDoubleSideMat;
                return;
              }`,
  `              if (_matteWhiteDoubleSideNames.has(n.name)) {
                _stripHorizontalEdgeFaces(n);
                n.material = _matteWhiteDoubleSideMat;
                n.renderOrder = 1;
                return;
              }`,
);
source = source.replace(
  `                envMapIntensity: 1.5,
                side: THREE.DoubleSide,
              });`,
  `                envMapIntensity: 1.5,
                side: THREE.DoubleSide,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -2,
                polygonOffsetUnits: -2,
              });`,
);
source = source.replace(
  `              const _fridgeGlassMat = new THREE.MeshStandardMaterial({
                color: 0x6a9ab0,
                roughness: 0.05,
                metalness: 0.0,
                transparent: true,
                opacity: 0.65,
                envMapIntensity: 1.5,
                side: THREE.DoubleSide,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -2,
                polygonOffsetUnits: -2,
              });
              if (scene.environment) _fridgeGlassMat.envMap = scene.environment;`,
  `              const _fridgeGlassMat = new THREE.MeshBasicMaterial({
                color: 0xe8edf2,
                transparent: true,
                opacity: 0.04,
                side: THREE.DoubleSide,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -4,
                polygonOffsetUnits: -4,
              });`,
);
source = source.replace(
  `                  n.material = _fridgeGlassMat;
                  n.frustumCulled = false;
                  n.translateZ(0.05);`,
  `                  n.material = _fridgeGlassMat;
                  n.frustumCulled = false;
                  n.renderOrder = 3;
                  n.translateZ(0.05);
                  n.visible = false;`,
);
source = source.replace(
  `                  const mat = new THREE.MeshStandardMaterial({
                    color: 0x0a1a66,
                    emissive: 0x0a1a66,
                    emissiveIntensity: 30,`,
  `                  const mat = new THREE.MeshStandardMaterial({
                    color: 0xffffff,
                    emissive: 0xffffff,
                    emissiveIntensity: 10,`,
);
source = source.replace(
  `                    darkIntensity: 30,
                    brightIntensity: 10,`,
  `                    darkIntensity: 10,
                    brightIntensity: 4,`,
);
source = source.replace(
  `                  const fridgeRect = new THREE.RectAreaLight(0x0a1a66, 0, stripLen, stripThick);`,
  `                  const fridgeRect = new THREE.RectAreaLight(0xffffff, 0, stripLen, stripThick);`,
);
source = source.replace(
  `                    light: fridgeRect,
                    darkIntensity: 400,
                    brightIntensity: 150,`,
  `                    light: fridgeRect,
                    darkIntensity: 0,
                    brightIntensity: 0,`,
);
source = source.replace(
  `            kmodel.traverse((n) => {
              if (!n.isMesh) return;
              if (_isKitchenTableCoverPlane(n.name)) return;`,
  `            kmodel.traverse((n) => {
              if (!n.isMesh) return;
              if (
                n.name === "dishwasherPlate" ||
                n.name === "dishwasherScreen"
              ) {
                const isScreen = n.name === "dishwasherScreen";
                const stabilizeMaterial = (sourceMat) => {
                  const stableMat = sourceMat.clone();
                  stableMat.roughness = isScreen ? 0.72 : 1;
                  stableMat.metalness = 0;
                  stableMat.envMapIntensity = isScreen ? 0.12 : 0.02;
                  stableMat.polygonOffset = true;
                  stableMat.polygonOffsetFactor = isScreen ? -2 : 1;
                  stableMat.polygonOffsetUnits = isScreen ? -2 : 1;
                  stableMat.needsUpdate = true;
                  return stableMat;
                };
                n.material = Array.isArray(n.material)
                  ? n.material.map(stabilizeMaterial)
                  : stabilizeMaterial(n.material);
                n.renderOrder = isScreen ? 3 : 2;
                return;
              }
              if (_isKitchenTableCoverPlane(n.name)) return;`,
);
source = source.replace(
  `          carShadowLight.position.set(car.position.x + 3, car.position.y + 20, car.position.z + 2);`,
  `          carShadowLight.position.set(
            car.position.x,
            car.position.y + 20,
            car.position.z,
          );`,
);

source = source.replace(
  `      function updateTableLightReflections() {`,
  `      const _beamFrontPoint = new THREE.Vector3();
      const _beamRearPoint = new THREE.Vector3();

      function getHeadlightBeamCarLength(tableY) {
        let front = null;
        let rear = null;
        for (let gi = 0; gi < tableLightGlows.length; gi++) {
          const e = tableLightGlows[gi];
          if (!front && e.kind === "front") front = e;
          if (!rear && (e.kind === "rear" || e.kind === "brake")) rear = e;
        }
        if (!front || !rear) return 2.4 * car.scale.x;
        getMeshTableReflectionPoint(front, tableY, _beamFrontPoint);
        getMeshTableReflectionPoint(rear, tableY, _beamRearPoint);
        return Math.max(0.5, _beamFrontPoint.distanceTo(_beamRearPoint));
      }

      function updateTableLightReflections() {`,
);
source = source.replace(
  `if (entry.kind === "front") alpha = 0.82;`,
  `if (entry.kind === "front") alpha = 0.08;`,
);
source = source.replace(
  `        const tableY = getTablePlaySurfaceY();
        if (tableY == null) return;
        for (let gi = 0; gi < tableLightGlows.length; gi++) {
          const entry = tableLightGlows[gi];
          let alpha = 0;`,
  `        const tableY = getTablePlaySurfaceY();
        if (tableY == null) return;
        updateCarLampSpotAim();
        updateCarLightAxes();
        const carYaw = carState.angle + (carState.driftAngle || 0);
        const worldHalfW = Math.max(0.08, halfW * storedCarScale);
        const worldHalfL = Math.max(0.08, halfL * storedCarScale);
        for (let gi = 0; gi < tableLightGlows.length; gi++) {
          const entry = tableLightGlows[gi];
          let alpha = 0;`,
);
source = source.replace(
  `      let _mainTableTopAreaLight = null;`,
  `      let _mainTableTopAreaLight = null;
      let _mainTableSideAreaLight = null;`,
);
source = source.replace(
  `        _mainTableTopAreaLight = null;`,
  `        _mainTableTopAreaLight = null;
        _mainTableSideAreaLight = null;`,
);
source = source.replace(
  `                  scene.add(_mainTableTopAreaLight);
                  _darkModeOnlyLights.push(_mainTableTopAreaLight);
                }`,
  `                  scene.add(_mainTableTopAreaLight);
                  _darkModeOnlyLights.push(_mainTableTopAreaLight);
                }
                if (
                  !_mainTableSideAreaLight &&
                  planeInfo.sidePlane &&
                  planeInfo.topPlane
                ) {
                  planeInfo.sidePlane.updateMatrixWorld(true);
                  const sideBox = new THREE.Box3().setFromObject(
                    planeInfo.sidePlane,
                  );
                  const sideCenter = sideBox.getCenter(new THREE.Vector3());
                  const sideSize = sideBox.getSize(new THREE.Vector3());
                  const topCenter = new THREE.Box3()
                    .setFromObject(planeInfo.topPlane)
                    .getCenter(new THREE.Vector3());
                  const normalAxis = sideSize.x <= sideSize.z ? "x" : "z";
                  const spanAxis = normalAxis === "x" ? "z" : "x";
                  const outward =
                    sideCenter[normalAxis] - topCenter[normalAxis] >= 0 ? 1 : -1;
                  _mainTableSideAreaLight = new THREE.RectAreaLight(
                    0xfff8f0,
                    0.62,
                    Math.max(1, sideSize[spanAxis] * 0.9),
                    Math.max(1, sideSize.y * 1.6),
                  );
                  _mainTableSideAreaLight.position.copy(sideCenter);
                  _mainTableSideAreaLight.position[normalAxis] +=
                    outward * Math.max(3, sideSize[spanAxis] * 0.14);
                  _mainTableSideAreaLight.lookAt(sideCenter);
                  _mainTableSideAreaLight.name = "mainTableSideAreaLight";
                  _mainTableSideAreaLight.userData.baseIntensity = 0.62;
                  scene.add(_mainTableSideAreaLight);
                  _darkModeOnlyLights.push(_mainTableSideAreaLight);
                }`,
);
source = source.replace(
  `              const _applyPeselStyleLight = (mesh) => {`,
  `              // peselBlue/Green are nearly black in the model, so lift each
              // panel's own hue instead of recolouring it, with a faint
              // dark-mode-only glow so they stay noticeable.
              const _peselColorPanelNames = new Set([
                "peselBlue",
                "peselGreen",
                "peselOrange",
                "peselPink",
              ]);
              const _applyPeselColorPanel = (mesh) => {
                const lift = (src) => {
                  const mat = src.clone();
                  const peak = Math.max(
                    mat.color.r,
                    mat.color.g,
                    mat.color.b,
                  );
                  if (peak > 0) {
                    mat.color.multiplyScalar(
                      Math.max(1, Math.min(3, 0.2 / peak)),
                    );
                  }
                  mat.emissive = mat.color.clone();
                  mat.emissiveIntensity = 0.08;
                  return mat;
                };
                mesh.material = Array.isArray(mesh.material)
                  ? mesh.material.map(lift)
                  : lift(mesh.material);
                const slots = Array.isArray(mesh.material)
                  ? mesh.material
                  : [mesh.material];
                // One entry per material slot; the light blend loop only
                // reads entry.mesh.material.
                for (let si = 0; si < slots.length; si++) {
                  _peselLightMeshes.push({
                    mesh: { material: slots[si] },
                    darkIntensity: 0.08,
                    brightIntensity: 0,
                  });
                }
              };
              const _applyPeselStyleLight = (mesh) => {`,
);
source = source.replace(
  `                const shelfMatch = /^shelfLiight(\\d+)$/.exec(n.name);`,
  `                // A multi-material panel arrives as suffixed meshes (peselPink_1).
                if (_peselColorPanelNames.has(n.name.replace(/_\\d+$/, ""))) {
                  _applyPeselColorPanel(n);
                  return;
                }
                const shelfMatch = /^shelfLiight(\\d+)$/.exec(n.name);`,
);

source = source.split("ul-kitchen13.gltf").join("ul-kitchen19.gltf");
source = source.replace(
  `const _blackPlasticMeshNames = new Set([
              "coffeeMuchineBody",
              "coffeeTankCup",
              "coffeeStrokEdge",
              "waterTapPlastic",
            ]);`,
  `const _blackPlasticMeshNames = new Set([
              "coffeeMuchineBody",
              "coffeeTankCup",
              "coffeeStrokEdge",
              "waterTapPlastic",
              "iceCoffeeBody",
              "iceCoffeeCup",
              "iceCoffeeHandle",
            ]);`,
);
source = source.replace(
  `const _chromeMetalMeshNames = new Set([
              "coffeeStrok",
              "coffeeHandle",
              "coffeeLegs",
            ]);`,
  `const _chromeMetalMeshNames = new Set([
              "coffeeStrok",
              "coffeeHandle",
              "coffeeLegs",
            ]);
            const _matteMetalMat = new THREE.MeshStandardMaterial({
              color: 0xe8ebef,
              metalness: 1.0,
              roughness: 0.58,
              envMapIntensity: 1.05,
            });
            if (scene.environment) _matteMetalMat.envMap = scene.environment;
            const _matteMetalMeshNames = new Set(["iceCoffeePlate"]);
            const _clearPlasticMat = new THREE.ShaderMaterial({
              transparent: true,
              depthWrite: false,
              depthTest: true,
              side: THREE.DoubleSide,
              toneMapped: true,
              uniforms: {},
              vertexShader: \`
                varying vec3 vWorldPos;
                varying vec3 vWorldNormal;
                void main() {
                  vec4 worldPos = modelMatrix * vec4(position, 1.0);
                  vWorldPos = worldPos.xyz;
                  vWorldNormal = normalize(mat3(modelMatrix) * normal);
                  gl_Position = projectionMatrix * viewMatrix * worldPos;
                }
              \`,
              fragmentShader: \`
                varying vec3 vWorldPos;
                varying vec3 vWorldNormal;
                void main() {
                  vec3 n = normalize(vWorldNormal);
                  vec3 view = normalize(cameraPosition - vWorldPos);
                  float ndv = abs(dot(n, view));
                  float fres = pow(1.0 - ndv, 2.6);
                  float spec = pow(ndv, 28.0) * 0.08;
                  vec3 col = vec3(0.84, 0.94, 1.0) * (0.28 + spec) + vec3(1.0) * fres * 0.5;
                  float alpha = mix(0.01, 0.16, fres) + spec * 0.05;
                  gl_FragColor = vec4(col, clamp(alpha, 0.01, 0.22));
                }
              \`,
            });
            _clearPlasticMat.customProgramCacheKey = () => "iceCoffeeGlassFresnel";
            const _clearPlasticMeshNames = new Set(["iceCoffeeGlass"]);
            const _iceCoffeeUniforms = {
              uTime: { value: 0 },
              uFill: { value: 0.56 },
            };
            if (_iceCoffeeTankMat) _iceCoffeeTankMat.dispose();
            if (_iceCoffeeSurfaceMat) _iceCoffeeSurfaceMat.dispose();
            const _iceCoffeeFill = 0.56;
            const _buildIceCoffeeWaterGeometry = (src) => {
              const pos = src.attributes.position;
              const index = src.index.array;
              const out = [];
              const fill = _iceCoffeeFill;
              for (let i = 0; i < index.length; i += 3) {
                const v = [0, 1, 2].map((k) => {
                  const vi = index[i + k];
                  return [pos.getX(vi), pos.getY(vi), pos.getZ(vi)];
                });
                const poly = [];
                for (let e = 0; e < 3; e++) {
                  const a = v[e];
                  const b = v[(e + 1) % 3];
                  const aIn = a[1] <= fill;
                  const bIn = b[1] <= fill;
                  if (aIn) poly.push(a);
                  if (aIn !== bIn) {
                    const t = (fill - a[1]) / (b[1] - a[1]);
                    poly.push([a[0] + (b[0] - a[0]) * t, fill, a[2] + (b[2] - a[2]) * t]);
                  }
                }
                if (poly.length < 3) continue;
                out.push(poly[0][0], poly[0][1], poly[0][2]);
                out.push(poly[1][0], poly[1][1], poly[1][2]);
                out.push(poly[2][0], poly[2][1], poly[2][2]);
                if (poly.length === 4) {
                  out.push(poly[0][0], poly[0][1], poly[0][2]);
                  out.push(poly[2][0], poly[2][1], poly[2][2]);
                  out.push(poly[3][0], poly[3][1], poly[3][2]);
                }
              }
              const geo = new THREE.BufferGeometry();
              geo.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
              return geo;
            };
            _iceCoffeeTankMat = new THREE.ShaderMaterial({
              transparent: false,
              depthWrite: true,
              depthTest: true,
              side: THREE.BackSide,
              toneMapped: false,
              uniforms: _iceCoffeeUniforms,
              vertexShader: \`
                varying vec3 vLocal;
                void main() {
                  vLocal = position;
                  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
              \`,
              fragmentShader: \`
                varying vec3 vLocal;
                uniform float uFill;
                void main() {
                  float h = clamp((vLocal.y + 1.282) / (uFill + 1.282), 0.0, 1.0);
                  vec2 xz = vLocal.xz / vec2(0.793, 1.648);
                  float radial = clamp(length(xz), 0.0, 1.0);
                  float core = exp(-dot(xz, xz) * 2.2) * pow(1.0 - h, 1.2);
                  vec3 hot = vec3(0.95, 0.0, 0.38);
                  vec3 low = vec3(0.86, 0.0, 0.32);
                  vec3 body = vec3(0.78, 0.0, 0.28);
                  vec3 upper = vec3(0.84, 0.0, 0.34);
                  vec3 edge = vec3(0.52, 0.0, 0.2);
                  vec3 col = mix(hot, low, smoothstep(0.0, 0.18, h));
                  col = mix(col, body, smoothstep(0.12, 0.5, h));
                  col = mix(col, upper, smoothstep(0.55, 1.0, h));
                  col = mix(col, edge, smoothstep(0.45, 1.0, radial) * 0.65);
                  col += hot * core * 0.4;
                  gl_FragColor = vec4(col, 1.0);
                }
              \`,
            });
            _iceCoffeeSurfaceMat = new THREE.ShaderMaterial({
              transparent: false,
              depthWrite: true,
              depthTest: true,
              side: THREE.FrontSide,
              toneMapped: false,
              polygonOffset: true,
              polygonOffsetFactor: -2,
              polygonOffsetUnits: -2,
              uniforms: _iceCoffeeUniforms,
              vertexShader: \`
                varying float vWave;
                varying float vChop;
                uniform float uTime;
                void main() {
                  vec3 pos = position;
                  vec2 p = uv * 2.0 - 1.0;
                  float edge = max(abs(p.x), abs(p.y));
                  float falloff = 1.0 - smoothstep(0.78, 1.0, edge);
                  float w1 = sin(pos.x * 3.2 + uTime * 2.8);
                  float w2 = cos(pos.y * 2.1 - uTime * 2.2);
                  float swirl = sin(length(p) * 6.5 - uTime * 2.5);
                  float wave = (w1 * w2 * 0.7 + swirl * 0.48) * falloff;
                  pos.z += wave * 0.20;
                  vWave = wave;
                  vChop = swirl * w1 * 0.5 + 0.5;
                  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
              \`,
              fragmentShader: \`
                varying float vWave;
                varying float vChop;
                void main() {
                  float crest = smoothstep(-0.35, 0.55, vWave);
                  vec3 deep = vec3(0.42, 0.0, 0.16);
                  vec3 mid = vec3(0.92, 0.0, 0.34);
                  vec3 lift = vec3(1.0, 0.0, 0.4);
                  vec3 col = mix(deep, mid, clamp(vChop, 0.0, 1.0));
                  col = mix(col, lift, crest * 0.85);
                  gl_FragColor = vec4(col, 1.0);
                }
              \`,
            });`,
);
source = source.replace(
  `              if (_chromeMetalMeshNames.has(n.name)) {
                if (Array.isArray(n.material)) {
                  n.material = n.material.map(() => _chromeMetalMat);
                } else {
                  n.material = _chromeMetalMat;
                }
                return;
              }`,
  `              if (_chromeMetalMeshNames.has(n.name)) {
                if (Array.isArray(n.material)) {
                  n.material = n.material.map(() => _chromeMetalMat);
                } else {
                  n.material = _chromeMetalMat;
                }
                return;
              }
              if (_matteMetalMeshNames.has(n.name)) {
                if (Array.isArray(n.material)) {
                  n.material = n.material.map(() => _matteMetalMat);
                } else {
                  n.material = _matteMetalMat;
                }
                return;
              }
              if (_clearPlasticMeshNames.has(n.name)) {
                if (Array.isArray(n.material)) {
                  n.material = n.material.map(() => _clearPlasticMat);
                } else {
                  n.material = _clearPlasticMat;
                }
                n.renderOrder = 2;
                return;
              }
              if (n.name === "iceCoffeeTank") {
                const _tankHide = new THREE.MeshBasicMaterial({
                  transparent: true,
                  opacity: 0,
                  depthWrite: false,
                  colorWrite: false,
                });
                _tankHide.visible = false;
                n.material = _tankHide;
                n.castShadow = false;
                n.receiveShadow = false;
                const _iceCoffeeWater = new THREE.Mesh(
                  _buildIceCoffeeWaterGeometry(n.geometry),
                  _iceCoffeeTankMat,
                );
                _iceCoffeeWater.name = "iceCoffeeWater";
                _iceCoffeeWater.scale.setScalar(0.985);
                _iceCoffeeWater.renderOrder = 4;
                _iceCoffeeWater.castShadow = false;
                _iceCoffeeWater.receiveShadow = false;
                _iceCoffeeWater.frustumCulled = true;
                n.add(_iceCoffeeWater);
                const _iceCoffeeSurface = new THREE.Mesh(
                  new THREE.PlaneGeometry(1.539, 3.196, 4, 5),
                  _iceCoffeeSurfaceMat,
                );
                _iceCoffeeSurface.name = "iceCoffeeSurface";
                _iceCoffeeSurface.rotation.x = -Math.PI / 2;
                _iceCoffeeSurface.position.y = 0.56;
                _iceCoffeeSurface.renderOrder = 5;
                _iceCoffeeSurface.castShadow = false;
                _iceCoffeeSurface.receiveShadow = false;
                _iceCoffeeSurface.frustumCulled = true;
                _iceCoffeeWater.add(_iceCoffeeSurface);
                return;
              }`,
);

source = source.replace(
  `            const _mainTablePlateMat = new THREE.MeshStandardMaterial({
              color: 0x4a3426,
              roughness: 1.0,
              metalness: 0.0,
              envMapIntensity: 0.08,
              side: THREE.DoubleSide,
            });`,
  `            const _mainTablePlateMat = new THREE.MeshStandardMaterial({
              color: 0x4a3426,
              roughness: 1.0,
              metalness: 0.0,
              envMapIntensity: 0,
              side: THREE.DoubleSide,
              polygonOffset: true,
              polygonOffsetFactor: 1,
              polygonOffsetUnits: 1,
            });`,
);
source = source.replace(
  `              _mainTablePlateMat.envMap = scene.environment;`,
  `              _mainTablePlateMat.envMap = null;`,
);
source = source.replace(
  `              if (n.name === "mainTablePlate") {`,
  `              if (n.name === "mainTablePlate") {
                n.renderOrder = 1;`,
);
source = source.replace(
  `              if (_isKitchenTableCoverPlane(n.name)) return;`,
  `              if (
                n.name === "barChairPlastic" ||
                n.name === "barChairWood"
              ) {
                const stabilizeChairMaterial = (sourceMat) => {
                  const stableMat = sourceMat.clone();
                  stableMat.roughness = 0.9;
                  stableMat.metalness = 0;
                  stableMat.envMapIntensity = 0;
                  stableMat.envMap = null;
                  stableMat.needsUpdate = true;
                  return stableMat;
                };
                if (n.name === "barChairWood") {
                  if (!_barChairWoodMatBackup) {
                    _barChairWoodMatBackup = Array.isArray(n.material)
                      ? n.material.map(stabilizeChairMaterial)
                      : stabilizeChairMaterial(n.material);
                  }
                  if (!_barChairWoodMat) {
                    _barChairWoodMat = new THREE.MeshStandardMaterial({
                      color: 0xffffff,
                      emissive: 0xffffff,
                      emissiveIntensity: 0.04,
                      roughness: 1,
                      metalness: 1,
                      envMapIntensity: 0,
                      envMap: null,
                      side: THREE.DoubleSide,
                    });
                    _barChairWoodMat.userData.barChairWoodMaterialBackup =
                      _barChairWoodMatBackup;
                    _barChairWoodMat.onBeforeCompile = (shader) => {
                      shader.fragmentShader = shader.fragmentShader
                        .replace(
                          "#include <map_fragment>",
                          "#include <map_fragment>\\ndiffuseColor.rgb *= 1.35;",
                        )
                        .replace(
                          "#include <roughnessmap_fragment>",
                          "#include <roughnessmap_fragment>\\nroughnessFactor = mix(roughnessFactor, 1.0, 0.6);",
                        );
                    };
                    _barChairWoodMat.customProgramCacheKey = () => "barChairWoodDimmer";
                    const _woodTexDir = KITCHEN_COVER_TEX_DIR + "wood texture/2K/";
                    const _woodLoader = new THREE.TextureLoader();
                    const _loadWoodTex = (file, isColor) =>
                      _woodLoader.loadAsync(encodeURI(_woodTexDir + file)).then((tex) => {
                        tex.wrapS = THREE.RepeatWrapping;
                        tex.wrapT = THREE.RepeatWrapping;
                        tex.repeat.set(2, 2);
                        tex.anisotropy = Math.min(
                          8,
                          renderer.capabilities.getMaxAnisotropy(),
                        );
                        if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
                        return tex;
                      });
                    Promise.all([
                      _loadWoodTex("Poliigon_WoodVeneerOak_7760_BaseColor.jpg", true),
                      _loadWoodTex("Poliigon_WoodVeneerOak_7760_Normal.png", false),
                      _loadWoodTex("Poliigon_WoodVeneerOak_7760_Roughness.jpg", false),
                      _loadWoodTex("Poliigon_WoodVeneerOak_7760_Metallic.jpg", false),
                    ])
                      .then(([map, normalMap, roughnessMap, metalnessMap]) => {
                        _barChairWoodMat.map = map;
                        _barChairWoodMat.emissiveMap = map;
                        _barChairWoodMat.normalMap = normalMap;
                        _barChairWoodMat.roughnessMap = roughnessMap;
                        _barChairWoodMat.metalnessMap = metalnessMap;
                        _barChairWoodMat.needsUpdate = true;
                      })
                      .catch((err) => {
                        console.warn("barChairWood texture load failed", err);
                      });
                  }
                  n.material = _barChairWoodMat;
                  n.renderOrder = 1;
                  return;
                }
                n.material = Array.isArray(n.material)
                  ? n.material.map(stabilizeChairMaterial)
                  : stabilizeChairMaterial(n.material);
                n.renderOrder = 1;
                return;
              }
              if (_isKitchenTableCoverPlane(n.name)) return;`,
);

source = source.replace(
  `      const FLAME_EFFECT_PARTICLE_COUNT = 60;`,
  `      const TRASH_FX_PARTICLE_COUNT = 900;
      /** Keeps additive brightness steady if the count changes. */
      const TRASH_FX_STACK_SCALE = 480 / TRASH_FX_PARTICLE_COUNT;
      /** Padding around the plane's footprint that still counts as "above". */
      const TRASH_FX_EDGE_PAD = 0.6;
      // Portal size relative to the counter opening, and how far it sits
      // below the opening's lip.
      const TRASH_FX_RADIUS_SCALE = 0.62;
      // Drops the black hole floor and the effect together. The floor was
      // covering any part of the effect placed under it, so the glow stayed put.
      const TRASH_FX_Y_OFFSET = -0.45;
      const TRASH_FX_ENABLED = true;
      /** Fits the column into the hole, under the table surface. */
      const TRASH_FX_HEIGHT_SCALE = 0.22;
      /** Particle space is a unit radius; each plane scales it to fit. */
      const TRASH_FX_ROLE_STREAK = 0;
      const TRASH_FX_ROLE_MOTE = 1;
      const TRASH_FX_ROLE_SPARK = 2;
      const _trashFxPlanes = [];
      const _trashFxBox = new THREE.Box3();
      let _trashFxTime = 0;
      let _trashFxFade = 0;
      let _trashFxActivePlane = null;
      const _trashFxRise = new Float32Array(TRASH_FX_PARTICLE_COUNT);
      const _trashFxRiseSpeed = new Float32Array(TRASH_FX_PARTICLE_COUNT);
      const _trashFxSpread = new Float32Array(TRASH_FX_PARTICLE_COUNT * 2);
      const _trashFxMaxHeight = new Float32Array(TRASH_FX_PARTICLE_COUNT);
      const _trashFxRadialDrift = new Float32Array(TRASH_FX_PARTICLE_COUNT);
      const _trashFxSparkDir = new Float32Array(TRASH_FX_PARTICLE_COUNT * 3);
      const _trashFxSparkReach = new Float32Array(TRASH_FX_PARTICLE_COUNT);
      const _trashFxRole = new Float32Array(TRASH_FX_PARTICLE_COUNT);
      const _trashFxLife = new Float32Array(TRASH_FX_PARTICLE_COUNT);
      const _trashFxPositions = new Float32Array(TRASH_FX_PARTICLE_COUNT * 3);
      const _trashFxColors = new Float32Array(TRASH_FX_PARTICLE_COUNT * 3);
      const _trashFxSizeScale = new Float32Array(TRASH_FX_PARTICLE_COUNT);
      const _trashFxPalette = [
        new THREE.Color(0x9fd8ff),
        new THREE.Color(0x66bcff),
        new THREE.Color(0x3f9bff),
        new THREE.Color(0x86ccff),
        new THREE.Color(0xd8f2ff),
        new THREE.Color(0x4fb4ff),
      ];
      for (let i = 0; i < TRASH_FX_PARTICLE_COUNT; i++) {
        // Most of the effect is the ring of streaks; the rest is centre
        // motes and a few sparks that leave the column entirely.
        const roll = i % 10;
        const role =
          roll < 7
            ? TRASH_FX_ROLE_STREAK
            : roll < 9
              ? TRASH_FX_ROLE_MOTE
              : TRASH_FX_ROLE_SPARK;
        _trashFxRole[i] = role;
        _trashFxRise[i] = Math.random();
        const angle = Math.random() * Math.PI * 2;
        let r;
        if (role === TRASH_FX_ROLE_STREAK) {
          r = 0.84 + Math.random() * 0.16;
          _trashFxMaxHeight[i] = 1.5 + Math.random() * 1.9;
          _trashFxRiseSpeed[i] = 0.5 + Math.random() * 0.75;
          _trashFxSizeScale[i] = 2.1 + Math.random() * 1.5;
          _trashFxRadialDrift[i] = 0.1 + Math.random() * 0.3;
        } else if (role === TRASH_FX_ROLE_MOTE) {
          r = Math.sqrt(Math.random()) * 0.72;
          _trashFxMaxHeight[i] = 1.1 + Math.random() * 1.6;
          _trashFxRiseSpeed[i] = 0.35 + Math.random() * 0.6;
          _trashFxSizeScale[i] = 0.5 + Math.random() * 0.75;
          _trashFxRadialDrift[i] = -0.04 + Math.random() * 0.16;
        } else {
          r = 0.4 + Math.random() * 0.6;
          _trashFxMaxHeight[i] = 1;
          _trashFxRiseSpeed[i] = 0.4 + Math.random() * 0.7;
          _trashFxSizeScale[i] = 0.7 + Math.random() * 0.9;
          _trashFxRadialDrift[i] = 0;
          const theta = Math.random() * Math.PI * 2;
          const dirY = -0.15 + Math.random() * 1.05;
          const horiz = Math.sqrt(Math.max(0, 1 - dirY * dirY * 0.25));
          _trashFxSparkDir[i * 3] = Math.cos(theta) * horiz;
          _trashFxSparkDir[i * 3 + 1] = dirY;
          _trashFxSparkDir[i * 3 + 2] = Math.sin(theta) * horiz;
          _trashFxSparkReach[i] = 0.8 + Math.random() * 1.5;
        }
        _trashFxSpread[i * 2] = Math.cos(angle) * r;
        _trashFxSpread[i * 2 + 1] = Math.sin(angle) * r;
        const c = _trashFxPalette[i % _trashFxPalette.length].clone();
        c.multiplyScalar(0.8 + Math.random() * 0.25);
        _trashFxColors[i * 3] = c.r;
        _trashFxColors[i * 3 + 1] = c.g;
        _trashFxColors[i * 3 + 2] = c.b;
      }
      const _trashFxGeo = new THREE.BufferGeometry();
      _trashFxGeo.setAttribute(
        "position",
        new THREE.BufferAttribute(_trashFxPositions, 3),
      );
      _trashFxGeo.setAttribute(
        "color",
        new THREE.BufferAttribute(_trashFxColors, 3),
      );
      _trashFxGeo.setAttribute(
        "sizeScale",
        new THREE.BufferAttribute(_trashFxSizeScale, 1),
      );
      _trashFxGeo.setAttribute(
        "role",
        new THREE.BufferAttribute(_trashFxRole, 1),
      );
      _trashFxGeo.setAttribute(
        "life",
        new THREE.BufferAttribute(_trashFxLife, 1),
      );
      const _trashFxMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uSize: { value: 560 },
          uFade: { value: 0 },
          uStack: { value: TRASH_FX_STACK_SCALE },
        },
        vertexShader: \`
        attribute vec3 color;
        attribute float sizeScale;
        attribute float role;
        attribute float life;
        varying vec3 vColor;
        varying float vRole;
        varying float vLife;
        uniform float uSize;
        void main() {
          vColor = color;
          vRole = role;
          vLife = life;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float att = 1.0 / max(0.1, -mv.z);
          gl_PointSize = min(uSize * att * sizeScale, 110.0);
        }
      \`,
        fragmentShader: \`
        varying vec3 vColor;
        varying float vRole;
        varying float vLife;
        uniform float uFade;
        uniform float uStack;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          // Streaks squeeze the sprite horizontally so each point reads as a
          // vertical shaft of light rather than a round blob.
          float streak = step(vRole, 0.5);
          vec2 q = vec2(c.x * mix(1.0, 7.5, streak), c.y);
          float d = length(q) * 2.0;
          float aa = max(fwidth(d) * 2.35, 0.02);
          float core = exp(-(d * d) / (0.17 + aa * 0.45));
          float halo = exp(-(d * d) * (1.1 + aa * 0.35)) * 0.5;
          float a = core * 0.52 + halo * 0.17;
          float rise = clamp(vLife, 0.0, 1.0);
          float bottomFade = smoothstep(0.0, 0.14, rise);
          float topFade = 1.0 - smoothstep(0.3, 1.0, rise);
          a *= bottomFade * topFade * uFade * uStack;
          vec3 col = vColor;
          float hot = 1.0 - smoothstep(0.0, 0.42, rise);
          col = mix(col, vec3(1.0), hot * 0.8 * core);
          col += vec3(0.05, 0.18, 0.4) * halo;
          col *= 1.0 + core * 0.75;
          gl_FragColor = vec4(col, a * 0.92);
        }
      \`,
      });
      const _trashFxPoints = new THREE.Points(_trashFxGeo, _trashFxMat);
      _trashFxPoints.visible = false;
      _trashFxPoints.frustumCulled = false;
      _trashFxPoints.renderOrder = 5;
      _trashFxPoints.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
      scene.add(_trashFxPoints);

      /** Flat additive rings stacked at the base, built at unit radius. */
      function createTrashFxRing(innerR, outerR, hexColor, baseOpacity, spin) {
        const geo = new THREE.RingGeometry(innerR, outerR, 108);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({
          color: hexColor,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: true,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.visible = false;
        mesh.renderOrder = 5;
        mesh.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
        scene.add(mesh);
        return { mesh, mat, baseOpacity, spin };
      }
      const _trashFxRings = [
        createTrashFxRing(0.0, 0.98, 0x225c9e, 0.3, 0.0),
        createTrashFxRing(0.82, 1.0, 0xcfeaff, 0.95, 0.6),
        createTrashFxRing(1.02, 1.1, 0x7fd0ff, 0.6, -0.42),
        createTrashFxRing(1.12, 1.19, 0x4fa8ff, 0.4, 0.28),
      ];
      const _trashFxLight = new THREE.PointLight(0x6cc4ff, 0, 22, 1.5);
      scene.add(_trashFxLight);
      const _trashFxGroup = new THREE.Group();
      _trashFxGroup.name = "trashFx";
      scene.add(_trashFxGroup);
      _trashFxGroup.add(_trashFxPoints);
      for (let _ri = 0; _ri < _trashFxRings.length; _ri++) {
        _trashFxGroup.add(_trashFxRings[_ri].mesh);
      }
      _trashFxGroup.add(_trashFxLight);
      _trashFxGroup.position.y = TRASH_FX_Y_OFFSET;

      function registerTrashPlane(mesh) {
        mesh.updateMatrixWorld(true);
        const _planeMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const _clonedMats = [];
        for (let _mi = 0; _mi < _planeMats.length; _mi++) {
          if (!_planeMats[_mi]) {
            _clonedMats.push(_planeMats[_mi]);
            continue;
          }
          const _cloned = _planeMats[_mi].clone();
          _cloned.depthWrite = false;
          _cloned.polygonOffset = true;
          _cloned.polygonOffsetFactor = 1;
          _cloned.polygonOffsetUnits = 1;
          _clonedMats.push(_cloned);
        }
        mesh.material = Array.isArray(mesh.material) ? _clonedMats : _clonedMats[0];
        mesh.renderOrder = 1;
        _trashFxBox.setFromObject(mesh);
        if (_trashFxBox.isEmpty()) return;
        const halfX = (_trashFxBox.max.x - _trashFxBox.min.x) * 0.5;
        const halfZ = (_trashFxBox.max.z - _trashFxBox.min.z) * 0.5;
        _trashFxPlanes.push({
          minX: _trashFxBox.min.x - TRASH_FX_EDGE_PAD,
          maxX: _trashFxBox.max.x + TRASH_FX_EDGE_PAD,
          minZ: _trashFxBox.min.z - TRASH_FX_EDGE_PAD,
          maxZ: _trashFxBox.max.z + TRASH_FX_EDGE_PAD,
          centerX: (_trashFxBox.min.x + _trashFxBox.max.x) * 0.5,
          centerZ: (_trashFxBox.min.z + _trashFxBox.max.z) * 0.5,
          topY: _trashFxBox.max.y,
          radius: Math.max(0.4, Math.min(halfX, halfZ) * TRASH_FX_RADIUS_SCALE),
        });
        // The glow was clipped to this disc, so the disc has to move with it.
        mesh.position.y += TRASH_FX_Y_OFFSET;
        mesh.updateMatrixWorld(true);
      }

      function findTrashPlaneUnderCar() {
        if (!car) return null;
        const cx = car.position.x;
        const cz = car.position.z;
        for (let i = 0; i < _trashFxPlanes.length; i++) {
          const p = _trashFxPlanes[i];
          if (cx >= p.minX && cx <= p.maxX && cz >= p.minZ && cz <= p.maxZ) {
            return p;
          }
        }
        return null;
      }

      function setTrashFxVisible(on) {
        _trashFxPoints.visible = on;
        for (let i = 0; i < _trashFxRings.length; i++) {
          _trashFxRings[i].mesh.visible = on;
        }
        if (!on) _trashFxLight.intensity = 0;
      }

      let _iceCoffeeTankMat = null;
      let _iceCoffeeSurfaceMat = null;
      function updateIceCoffeeTank(dt) {
        if (_iceCoffeeSurfaceMat) _iceCoffeeSurfaceMat.uniforms.uTime.value += dt;
      }
      function updateTrashPlaneEffect(dt) {
        if (!TRASH_FX_ENABLED) {
          if (_trashFxPoints.visible) setTrashFxVisible(false);
          return;
        }
        if (!_trashFxPlanes.length || !_kitchenWorldActive) {
          if (_trashFxPoints.visible) setTrashFxVisible(false);
          return;
        }
        const plane = findTrashPlaneUnderCar();
        if (plane) _trashFxActivePlane = plane;
        const fadeTarget = plane ? 1 : 0;
        _trashFxFade += (fadeTarget - _trashFxFade) * Math.min(1, dt * 6.5);
        const f = THREE.MathUtils.clamp(_trashFxFade, 0, 1);
        if (f <= 0.01 || !_trashFxActivePlane) {
          if (_trashFxPoints.visible) setTrashFxVisible(false);
          return;
        }
        setTrashFxVisible(true);
        _trashFxMat.uniforms.uFade.value = f;
        _trashFxTime += dt;

        const active = _trashFxActivePlane;
        const scale = active.radius;
        const baseY = active.topY + 0.02;
        _trashFxPoints.position.set(active.centerX, baseY, active.centerZ);
        _trashFxPoints.scale.setScalar(scale);

        for (let i = 0; i < _trashFxRings.length; i++) {
          const ring = _trashFxRings[i];
          ring.mesh.position.set(
            active.centerX,
            baseY + i * 0.03,
            active.centerZ,
          );
          ring.mesh.scale.setScalar(scale * (0.98 + 0.03 * Math.sin(_trashFxTime * 1.6 + i)));
          ring.mesh.rotation.y = _trashFxTime * ring.spin;
          ring.mat.opacity = ring.baseOpacity * f;
        }

        const posAttr = _trashFxGeo.attributes.position;
        const lifeAttr = _trashFxGeo.attributes.life;
        const arr = posAttr.array;
        const heightScale = (0.75 + f * 0.85) * TRASH_FX_HEIGHT_SCALE;
        for (let i = 0; i < TRASH_FX_PARTICLE_COUNT; i++) {
          _trashFxRise[i] += dt * _trashFxRiseSpeed[i];
          if (_trashFxRise[i] > 1) _trashFxRise[i] -= 1;
          const t = _trashFxRise[i];
          _trashFxLife[i] = t;
          const sx = _trashFxSpread[i * 2];
          const sz = _trashFxSpread[i * 2 + 1];
          if (_trashFxRole[i] === TRASH_FX_ROLE_SPARK) {
            const travel = t * _trashFxSparkReach[i] * heightScale;
            arr[i * 3] = sx + _trashFxSparkDir[i * 3] * travel;
            arr[i * 3 + 1] = 0.35 + _trashFxSparkDir[i * 3 + 1] * travel;
            arr[i * 3 + 2] = sz + _trashFxSparkDir[i * 3 + 2] * travel;
            continue;
          }
          const y = t * _trashFxMaxHeight[i] * heightScale;
          // Streaks lean outward as they climb, which gives the cone flare.
          const widen = 1 + t * _trashFxRadialDrift[i];
          arr[i * 3] = sx * widen;
          arr[i * 3 + 1] = y;
          arr[i * 3 + 2] = sz * widen;
        }
        posAttr.needsUpdate = true;
        lifeAttr.needsUpdate = true;

        _trashFxLight.position.set(
          active.centerX,
          baseY,
          active.centerZ,
        );
        _trashFxLight.intensity = f * 4;
      }

      const FLAME_EFFECT_PARTICLE_COUNT = 60;`,
);
source = source.replace(
  `              if (n.name === "mainTableBase") {`,
  `              if (/^trashPlane\\d+$/.test(n.name)) {
                if (n.name === "trashPlane1") registerTrashPlane(n);
                return;
              }
              if (n.name === "mainTableBase") {`,
);
source = source.replace(
  `          updateTableLightReflections();`,
  `          updateTrashPlaneEffect(dt);
          updateIceCoffeeTank(dt);
          updateMisterSpot(dt);
          updateTableLightReflections();`,
);
source = source.replace(
  `        if (_peselLightMeshes.length) _peselLightMeshes.length = 0;`,
  `        if (_peselLightMeshes.length) _peselLightMeshes.length = 0;
        if (_trashFxPlanes.length) _trashFxPlanes.length = 0;
        _trashFxFade = 0;
        _trashFxActivePlane = null;
        setTrashFxVisible(false);
        _misterSpot = null;`,
);

source = source.replace(
  `      const rgbeLoader = new RGBELoader();
      const HDRI_URL =
        "https://dl.polyhaven.org/file/ahjdyYv/HDRIHaven_HDRI_Hall_2k.hdr";
      rgbeLoader.load(
        HDRI_URL,
        (texture) => {
          if (!perfSettings.hdri) {
            texture.dispose();
            return;
          }
          const envMap = pmremGenerator.fromEquirectangular(texture).texture;
          scene.environment = envMap;
          applySceneEnvironmentToMaterial(waterTapChromeMat);
          applySceneEnvironmentToMaterial(_kitchenTableCoverLampMat);
          applySceneEnvironmentToMaterial(_kitchenTableCoverSideMat);
          texture.dispose();
          pmremGenerator.dispose();
        },
        undefined,
        (err) => console.warn("HDRI load failed (using lights only):", err),
      );`,
  `      function buildNeutralEnvironmentTexture() {
        const c = document.createElement("canvas");
        c.width = 16;
        c.height = 64;
        const ctx = c.getContext("2d");
        const grad = ctx.createLinearGradient(0, 0, 0, c.height);
        grad.addColorStop(0, "#9aa3ad");
        grad.addColorStop(0.5, "#5c636d");
        grad.addColorStop(1, "#23262b");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, c.width, c.height);
        const tex = new THREE.CanvasTexture(c);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.needsUpdate = true;
        return tex;
      }
      if (perfSettings.hdri) {
        try {
          const _neutralEnvSource = buildNeutralEnvironmentTexture();
          const envMap =
            pmremGenerator.fromEquirectangular(_neutralEnvSource).texture;
          scene.environment = envMap;
          applySceneEnvironmentToMaterial(waterTapChromeMat);
          applySceneEnvironmentToMaterial(_kitchenTableCoverLampMat);
          applySceneEnvironmentToMaterial(_kitchenTableCoverSideMat);
          _neutralEnvSource.dispose();
          pmremGenerator.dispose();
        } catch (e) {
          console.warn("Neutral environment build failed (lights only):", e);
        }
      }`,
);



source = source.replace(
  `      function setKitchenPerfMode(active) {`,
  `      // RectAreaLight is shaded with an LTC approximation whose tangent
      // basis comes from the view vector. The specular term needs that,
      // but the diffuse term is meant to be view independent, so a still
      // surface re-shades as the camera orbits. Rebuild the diffuse basis
      // from a fixed world axis instead.
      const RECT_AREA_DIFFUSE_SRC =
        "reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );";
      const RECT_AREA_DIFFUSE_FIX =
        "vec3 ltcRef = abs( normal.z ) < 0.99 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );\\n" +
        "\\t\\treflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, ltcRef, position, mat3( 1.0 ), rectCoords );";
      let _rectAreaStableChunk = null;
      function getRectAreaStableChunk() {
        if (_rectAreaStableChunk !== null) return _rectAreaStableChunk;
        const chunk =
          THREE.ShaderChunk && THREE.ShaderChunk.lights_physical_pars_fragment;
        _rectAreaStableChunk =
          chunk && chunk.indexOf(RECT_AREA_DIFFUSE_SRC) !== -1
            ? chunk.split(RECT_AREA_DIFFUSE_SRC).join(RECT_AREA_DIFFUSE_FIX)
            : "";
        if (!_rectAreaStableChunk) {
          console.warn("RectArea diffuse chunk not matched; fix skipped.");
        }
        return _rectAreaStableChunk;
      }
      function stabilizeRectAreaLighting(material) {
        const fixedChunk = getRectAreaStableChunk();
        if (!fixedChunk || !material) return false;
        if (
          !material.isMeshStandardMaterial &&
          !material.isMeshPhysicalMaterial
        ) {
          return false;
        }
        if (!material.userData) material.userData = {};
        if (material.userData._rectAreaStable) return false;
        material.userData._rectAreaStable = true;
        const prevCompile = material.onBeforeCompile;
        material.onBeforeCompile = function (shader, rndr) {
          if (prevCompile) prevCompile.call(this, shader, rndr);
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <lights_physical_pars_fragment>",
            fixedChunk,
          );
        };
        const prevKey = material.customProgramCacheKey;
        material.customProgramCacheKey = function () {
          return (prevKey ? prevKey.call(this) : "") + "|rectAreaStable";
        };
        material.needsUpdate = true;
        return true;
      }
      function stabilizeRectAreaLightingInScene() {
        if (!getRectAreaStableChunk()) return 0;
        let n = 0;
        scene.traverse((o) => {
          if (!o.isMesh && !o.isInstancedMesh && !o.isPoints) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (let i = 0; i < mats.length; i++) {
            if (stabilizeRectAreaLighting(mats[i])) n++;
          }
        });
        return n;
      }
      // Materials keep appearing after the scene reports ready (clones,
      // cover planes, effects), so sweep again on a few later ticks.
      function scheduleRectAreaLightingSweeps() {
        stabilizeRectAreaLightingInScene();
        const delays = [400, 1200, 3000, 6000];
        for (let i = 0; i < delays.length; i++) {
          setTimeout(stabilizeRectAreaLightingInScene, delays[i]);
        }
      }

      function setKitchenPerfMode(active) {`,
);

source = source.replace(
  `                _kitchenSceneReady = true;`,
  `                scheduleRectAreaLightingSweeps();
                _kitchenSceneReady = true;`,
);


source = source.replace(
  `              if (n.name === "binSign1") {`,
  `              if (/^binSign\\d+$/.test(n.name.replace(/_\\d+$/, ""))) {`,
);

source = source.replace(
  `            const _mainGreenWallMat = new THREE.MeshStandardMaterial({
              color: 0xecf8ea,
              roughness: 1.0,
              metalness: 0.0,
              side: THREE.DoubleSide,
            });`,
  `            const _mainGreenWallMat = new THREE.MeshStandardMaterial({
              color: 0xecf8ea,
              roughness: 1.0,
              metalness: 0.0,
              side: THREE.DoubleSide,
            });
            const _closetDoorsMat = new THREE.MeshStandardMaterial({
              color: 0xecf8ea,
              roughness: 1.0,
              metalness: 0.0,
            });
            const _closetDoorRects = [];
            for (let _ri = 0; _ri < 40; _ri++) {
              _closetDoorRects.push(new THREE.Vector4(0, -1, 0, -1));
            }
            const _closetDoorEdgeMat = _closetDoorsMat.clone();
            const _closetEdgeGlsl =
              "uniform vec4 uDoorRects[40];\\n" +
              "float closetEdgeDist(vec3 p){\\n" +
              "  float edge=8.0;\\n" +
              "  for(int i=0;i<40;i++){\\n" +
              "    vec4 r=uDoorRects[i];\\n" +
              "    float inside=step(r.x,p.x)*step(p.x,r.y)*step(r.z,p.y)*step(p.y,r.w)*step(r.x,r.y);\\n" +
              "    float d=min(min(p.x-r.x,r.y-p.x),min(p.y-r.z,r.w-p.y));\\n" +
              "    edge=mix(edge,min(edge,d),inside);\\n" +
              "  }\\n" +
              "  return edge;\\n" +
              "}\\n";
            _closetDoorEdgeMat.onBeforeCompile = (shader) => {
              shader.uniforms.uDoorRects = { value: _closetDoorRects };
              shader.vertexShader = shader.vertexShader
                .replace(
                  "#include <common>",
                  "#include <common>\\nvarying vec3 vClosetLocal;\\n" + _closetEdgeGlsl,
                )
                .replace(
                  "#include <begin_vertex>",
                  "#include <begin_vertex>\\nvClosetLocal=position;\\nfloat _bevel=1.0-smoothstep(0.0,0.12,closetEdgeDist(position));\\nif(normal.z>0.7) transformed.z-=_bevel*0.008;",
                );
              shader.fragmentShader = shader.fragmentShader
                .replace(
                  "#include <common>",
                  "#include <common>\\nvarying vec3 vClosetLocal;\\n" + _closetEdgeGlsl,
                )
                .replace(
                  "#include <color_fragment>",
                  "#include <color_fragment>\\nfloat _line=1.0-smoothstep(0.0,0.12,closetEdgeDist(vClosetLocal));\\ndiffuseColor.rgb*=mix(1.0,0.91,_line);",
                );
            };
            _closetDoorEdgeMat.customProgramCacheKey = () => "closetDoorEdges";
            const _dishwasherDoorRects = [];
            for (let _ri = 0; _ri < 40; _ri++) {
              _dishwasherDoorRects.push(new THREE.Vector4(0, -1, 0, -1));
            }
            const _dishwasherDoorEdgeMat = _closetDoorsMat.clone();
            _dishwasherDoorEdgeMat.onBeforeCompile = (shader) => {
              shader.uniforms.uDoorRects = { value: _dishwasherDoorRects };
              shader.vertexShader = shader.vertexShader
                .replace(
                  "#include <common>",
                  "#include <common>\\nvarying vec3 vClosetLocal;\\n" + _closetEdgeGlsl,
                )
                .replace(
                  "#include <begin_vertex>",
                  "#include <begin_vertex>\\nvClosetLocal=position;\\nfloat _bevel=1.0-smoothstep(0.0,0.12,closetEdgeDist(position));\\nif(normal.z>0.7) transformed.z-=_bevel*0.008;",
                );
              shader.fragmentShader = shader.fragmentShader
                .replace(
                  "#include <common>",
                  "#include <common>\\nvarying vec3 vClosetLocal;\\n" + _closetEdgeGlsl,
                )
                .replace(
                  "#include <color_fragment>",
                  "#include <color_fragment>\\nfloat _line=1.0-smoothstep(0.0,0.12,closetEdgeDist(vClosetLocal));\\ndiffuseColor.rgb*=mix(1.0,0.91,_line);",
                );
            };
            _dishwasherDoorEdgeMat.customProgramCacheKey = () => "dishwasherDoorEdges";`,
);

source = source.replace(
  `              if (
                n.name !== "mainGreenWall" &&
                n.name !== "closetDoors" &&
                n.name !== "dishwasherDoor"
              ) {
                return;
              }`,
  `              if (n.name === "closetDoors") {
                const _doorGeo = n.geometry.clone();
                const _doorIndex = _doorGeo.index;
                const _doorArr = _doorIndex.array;
                for (let _di = 0; _di < _doorArr.length; _di += 3) {
                  const _swap = _doorArr[_di + 1];
                  _doorArr[_di + 1] = _doorArr[_di + 2];
                  _doorArr[_di + 2] = _swap;
                }
                _doorIndex.needsUpdate = true;
                const _doorNor = _doorGeo.attributes.normal;
                const _doorPos = _doorGeo.attributes.position;
                const _doorRectsFound = [];
                for (let _ti0 = 0; _ti0 < _doorArr.length; _ti0 += 3) {
                  const _a = _doorArr[_ti0];
                  const _b = _doorArr[_ti0 + 1];
                  const _c = _doorArr[_ti0 + 2];
                  const _nz0 = (_doorNor.getZ(_a) + _doorNor.getZ(_b) + _doorNor.getZ(_c)) / 3;
                  if (_nz0 > -0.7) continue;
                  const _x0 = Math.min(_doorPos.getX(_a), _doorPos.getX(_b), _doorPos.getX(_c));
                  const _x1 = Math.max(_doorPos.getX(_a), _doorPos.getX(_b), _doorPos.getX(_c));
                  const _y0 = Math.min(_doorPos.getY(_a), _doorPos.getY(_b), _doorPos.getY(_c));
                  const _y1 = Math.max(_doorPos.getY(_a), _doorPos.getY(_b), _doorPos.getY(_c));
                  if (_y1 - _y0 < 0.5) continue;
                  let _matched = false;
                  for (let _ri = 0; _ri < _doorRectsFound.length; _ri++) {
                    const _r = _doorRectsFound[_ri];
                    if (
                      Math.abs(_r[0] - _x0) < 0.08 &&
                      Math.abs(_r[1] - _x1) < 0.08 &&
                      Math.abs(_r[2] - _y0) < 0.08 &&
                      Math.abs(_r[3] - _y1) < 0.08
                    ) {
                      _matched = true;
                      break;
                    }
                  }
                  if (!_matched && _doorRectsFound.length < 40) {
                    _doorRectsFound.push([_x0, _x1, _y0, _y1]);
                  }
                }
                for (let _ri = 0; _ri < 40; _ri++) {
                  const _r = _doorRectsFound[_ri];
                  if (_r) _closetDoorRects[_ri].set(_r[0], _r[1], _r[2], _r[3]);
                  else _closetDoorRects[_ri].set(0, -1, 0, -1);
                }
                for (let _ni = 0; _ni < _doorNor.count; _ni++) {
                  const _nx = -_doorNor.getX(_ni);
                  const _ny = -_doorNor.getY(_ni);
                  const _nz = -_doorNor.getZ(_ni);
                  if (Math.abs(_ny) > 0.7 || Math.abs(_nx) > 0.7) {
                    _doorNor.setXYZ(_ni, 0, 0, 1);
                  } else {
                    _doorNor.setXYZ(_ni, _nx, _ny, _nz);
                  }
                }
                _doorNor.needsUpdate = true;
                const _kept = [];
                for (let _ti = 0; _ti < _doorArr.length; _ti += 3) {
                  const _ia = _doorArr[_ti];
                  const _ib = _doorArr[_ti + 1];
                  const _ic = _doorArr[_ti + 2];
                  const _ySpan =
                    Math.max(_doorPos.getY(_ia), _doorPos.getY(_ib), _doorPos.getY(_ic)) -
                    Math.min(_doorPos.getY(_ia), _doorPos.getY(_ib), _doorPos.getY(_ic));
                  if (_ySpan < 0.5) continue;
                  _kept.push(_ia, _ib, _ic);
                }
                _doorGeo.setIndex(_kept);
                n.geometry = _doorGeo;
                n.material = _closetDoorEdgeMat;
                return;
              }
              if (
                n.name === "tzokelRight" ||
                n.name === "tzokelLeft" ||
                n.name === "iceCubePannel"
              ) {
                _stripHorizontalEdgeFaces(n);
                if (n.name === "iceCubePannel") {
                  _dropOverlappingShells(n);
                  const _iceSrc = Array.isArray(n.material) ? n.material[0] : n.material;
                  if (_iceSrc) {
                    const _iceMat = _iceSrc.clone();
                    _iceMat.polygonOffset = true;
                    _iceMat.polygonOffsetFactor = -2;
                    _iceMat.polygonOffsetUnits = -2;
                    _iceMat.needsUpdate = true;
                    n.material = _iceMat;
                  }
                }
                return;
              }
              if (n.name === "dishwasherDoor") {
                _stripHorizontalEdgeFaces(n);
                const _dwGeo = n.geometry;
                const _dwPos = _dwGeo.attributes.position;
                const _dwNor = _dwGeo.attributes.normal;
                const _dwIdx = _dwGeo.index.array;
                let _dx0 = Infinity;
                let _dx1 = -Infinity;
                let _dy0 = Infinity;
                let _dy1 = -Infinity;
                let _dwFound = false;
                for (let _ti = 0; _ti < _dwIdx.length; _ti += 3) {
                  const _a = _dwIdx[_ti];
                  const _b = _dwIdx[_ti + 1];
                  const _c = _dwIdx[_ti + 2];
                  const _nz = (_dwNor.getZ(_a) + _dwNor.getZ(_b) + _dwNor.getZ(_c)) / 3;
                  if (_nz < 0.7) continue;
                  _dwFound = true;
                  _dx0 = Math.min(_dx0, _dwPos.getX(_a), _dwPos.getX(_b), _dwPos.getX(_c));
                  _dx1 = Math.max(_dx1, _dwPos.getX(_a), _dwPos.getX(_b), _dwPos.getX(_c));
                  _dy0 = Math.min(_dy0, _dwPos.getY(_a), _dwPos.getY(_b), _dwPos.getY(_c));
                  _dy1 = Math.max(_dy1, _dwPos.getY(_a), _dwPos.getY(_b), _dwPos.getY(_c));
                }
                if (_dwFound) _dishwasherDoorRects[0].set(_dx0, _dx1, _dy0, _dy1);
                n.material = _dishwasherDoorEdgeMat;
                return;
              }
              if (n.name !== "mainGreenWall") {
                return;
              }`,
);

source = source.replace(
  `        darkenCarBloomLists();
        bloomComposer.render();
        restoreCarBloomLists();`,
  `        darkenCarBloomLists();
        bloomComposer.render();
        restoreCarBloomLists();`,
);

source = source.replace(
  `              return false;
            };
            kmodel.traverse((n) => {`,
  `              return false;
            };
            const _stripHorizontalEdgeFaces = (mesh) => {
              const geo = mesh.geometry;
              if (!geo || !geo.index || !geo.attributes.position || !geo.attributes.normal) return;
              const cloned = geo.clone();
              mesh.updateWorldMatrix(true, false);
              const world = mesh.matrixWorld;
              const normalMatrix = new THREE.Matrix3().getNormalMatrix(world);
              const pos = cloned.attributes.position;
              const nor = cloned.attributes.normal;
              const srcIndex = cloned.index.array;
              const worldPos = new Float32Array(pos.count * 3);
              const worldNor = new Float32Array(pos.count * 3);
              const v = new THREE.Vector3();
              const nrm = new THREE.Vector3();
              let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
              for (let i = 0; i < pos.count; i++) {
                v.fromBufferAttribute(pos, i).applyMatrix4(world);
                worldPos[i * 3] = v.x;
                worldPos[i * 3 + 1] = v.y;
                worldPos[i * 3 + 2] = v.z;
                if (v.x < minX) minX = v.x;
                if (v.x > maxX) maxX = v.x;
                if (v.y < minY) minY = v.y;
                if (v.y > maxY) maxY = v.y;
                if (v.z < minZ) minZ = v.z;
                if (v.z > maxZ) maxZ = v.z;
                nrm.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix);
                worldNor[i * 3] = nrm.x;
                worldNor[i * 3 + 1] = nrm.y;
                worldNor[i * 3 + 2] = nrm.z;
              }
              const height = maxY - minY;
              const width = Math.max(maxX - minX, 0.001);
              const depth = Math.max(maxZ - minZ, 0.001);
              const longest = Math.max(width, depth);
              const slab = height < longest * 0.45 && height < 4;
              const thinPanel = depth < Math.min(width, height) * 0.25 && depth < 2;
              let frontNz = 0;
              let frontN = 0;
              const zCut = maxZ - Math.max(depth * 0.15, 0.02);
              let outward = 0;
              let inward = 0;
              const cx = (minX + maxX) / 2;
              const cy = (minY + maxY) / 2;
              const cz = (minZ + maxZ) / 2;
              for (let i = 0; i < pos.count; i++) {
                if (worldPos[i * 3 + 2] >= zCut) {
                  frontNz += worldNor[i * 3 + 2];
                  frontN++;
                }
                const dx = worldPos[i * 3] - cx;
                const dy = worldPos[i * 3 + 1] - cy;
                const dz = worldPos[i * 3 + 2] - cz;
                const dot = dx * worldNor[i * 3] + dy * worldNor[i * 3 + 1] + dz * worldNor[i * 3 + 2];
                if (dot > 0) outward++;
                else if (dot < 0) inward++;
              }
              const flip = !slab && (thinPanel ? frontN > 0 && frontNz < 0 : inward > outward * 1.5);
              if (flip) {
                for (let i = 0; i < srcIndex.length; i += 3) {
                  const swap = srcIndex[i + 1];
                  srcIndex[i + 1] = srcIndex[i + 2];
                  srcIndex[i + 2] = swap;
                }
                for (let i = 0; i < nor.count; i++) {
                  nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i));
                  worldNor[i * 3] *= -1;
                  worldNor[i * 3 + 1] *= -1;
                  worldNor[i * 3 + 2] *= -1;
                }
                cloned.index.needsUpdate = true;
                nor.needsUpdate = true;
              }
              const margin = slab
                ? Math.min(0.55, Math.max(0.2, Math.min(width, depth) * 0.08))
                : Math.max(depth, width);
              const kept = [];
              for (let t = 0; t < srcIndex.length; t += 3) {
                const ia = srcIndex[t];
                const ib = srcIndex[t + 1];
                const ic = srcIndex[t + 2];
                const ySpan =
                  Math.max(worldPos[ia * 3 + 1], worldPos[ib * 3 + 1], worldPos[ic * 3 + 1]) -
                  Math.min(worldPos[ia * 3 + 1], worldPos[ib * 3 + 1], worldPos[ic * 3 + 1]);
                const ny = (worldNor[ia * 3 + 1] + worldNor[ib * 3 + 1] + worldNor[ic * 3 + 1]) / 3;
                const nx = (worldNor[ia * 3] + worldNor[ib * 3] + worldNor[ic * 3]) / 3;
                const nz = (worldNor[ia * 3 + 2] + worldNor[ib * 3 + 2] + worldNor[ic * 3 + 2]) / 3;
                const horizontal =
                  Math.abs(ny) > 0.7 && Math.abs(ny) >= Math.abs(nx) && Math.abs(ny) >= Math.abs(nz);
                const xs = [worldPos[ia * 3], worldPos[ib * 3], worldPos[ic * 3]];
                const zs = [worldPos[ia * 3 + 2], worldPos[ib * 3 + 2], worldPos[ic * 3 + 2]];
                const onX =
                  xs.every((val) => val <= minX + margin) || xs.every((val) => val >= maxX - margin);
                const onZ =
                  zs.every((val) => val <= minZ + margin) || zs.every((val) => val >= maxZ - margin);
                if (horizontal && ySpan < 0.5 && (onX || onZ)) continue;
                kept.push(ia, ib, ic);
              }
              if (kept.length >= 3) cloned.setIndex(kept);
              mesh.geometry = cloned;
            };
            const _useFrontSideMaterial = (mesh) => {
              const sourceMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
              if (!sourceMat) return;
              const mat = sourceMat.clone();
              mat.side = THREE.FrontSide;
              mat.needsUpdate = true;
              mesh.material = mat;
            };
            const _dropOverlappingShells = (mesh) => {
              const geo = mesh.geometry;
              if (!geo || !geo.index || !geo.attributes.position || !geo.attributes.normal) return;
              const pos = geo.attributes.position;
              const nor = geo.attributes.normal;
              const idx = geo.index.array;
              const clusters = [];
              const triCluster = [];
              for (let t = 0; t < idx.length; t += 3) {
                const ids = [idx[t], idx[t + 1], idx[t + 2]];
                const c = [0, 0, 0];
                const n = [0, 0, 0];
                const min = [Infinity, Infinity, Infinity];
                const max = [-Infinity, -Infinity, -Infinity];
                for (let k = 0; k < 3; k++) {
                  const i = ids[k];
                  const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
                  for (let a = 0; a < 3; a++) {
                    c[a] += p[a];
                    if (p[a] < min[a]) min[a] = p[a];
                    if (p[a] > max[a]) max[a] = p[a];
                  }
                  n[0] += nor.getX(i);
                  n[1] += nor.getY(i);
                  n[2] += nor.getZ(i);
                }
                c[0] /= 3;
                c[1] /= 3;
                c[2] /= 3;
                const len = Math.hypot(n[0], n[1], n[2]) || 1;
                n[0] /= len;
                n[1] /= len;
                n[2] /= len;
                const ax = Math.abs(n[0]);
                const ay = Math.abs(n[1]);
                const az = Math.abs(n[2]);
                const planeAxis = ay >= ax && ay >= az ? 1 : az >= ax ? 2 : 0;
                const sign = n[planeAxis] >= 0 ? 1 : -1;
                const plane = c[planeAxis];
                let found = -1;
                for (let ci = 0; ci < clusters.length; ci++) {
                  const cl = clusters[ci];
                  if (
                    cl.planeAxis === planeAxis &&
                    cl.sign === sign &&
                    Math.abs(cl.plane - plane) < 0.003
                  ) {
                    found = ci;
                    break;
                  }
                }
                if (found < 0) {
                  clusters.push({
                    planeAxis,
                    sign,
                    plane,
                    min: min.slice(),
                    max: max.slice(),
                    tris: 1,
                  });
                  triCluster.push(clusters.length - 1);
                } else {
                  const cl = clusters[found];
                  cl.plane = (cl.plane * cl.tris + plane) / (cl.tris + 1);
                  cl.tris++;
                  for (let a = 0; a < 3; a++) {
                    if (min[a] < cl.min[a]) cl.min[a] = min[a];
                    if (max[a] > cl.max[a]) cl.max[a] = max[a];
                  }
                  triCluster.push(found);
                }
              }
              for (const cl of clusters) {
                const u = (cl.planeAxis + 1) % 3;
                const v = (cl.planeAxis + 2) % 3;
                cl.area =
                  Math.max(0, cl.max[u] - cl.min[u]) * Math.max(0, cl.max[v] - cl.min[v]);
              }
              const dropCluster = new Set();
              for (let i = 0; i < clusters.length; i++) {
                for (let j = 0; j < clusters.length; j++) {
                  if (i === j) continue;
                  const a = clusters[i];
                  const b = clusters[j];
                  if (a.planeAxis !== b.planeAxis || a.sign !== b.sign) continue;
                  const d = Math.abs(a.plane - b.plane);
                  if (d < 0.003 || d > 0.02) continue;
                  if (b.area < a.area * 3) continue;
                  const u = (a.planeAxis + 1) % 3;
                  const v = (a.planeAxis + 2) % 3;
                  const pad = 0.08;
                  if (
                    a.min[u] >= b.min[u] - pad &&
                    a.max[u] <= b.max[u] + pad &&
                    a.min[v] >= b.min[v] - pad &&
                    a.max[v] <= b.max[v] + pad
                  ) {
                    dropCluster.add(i);
                  }
                }
              }
              if (!dropCluster.size) return;
              const kept = [];
              for (let t = 0; t < triCluster.length; t++) {
                if (dropCluster.has(triCluster[t])) continue;
                kept.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
              }
              if (kept.length >= 3) geo.setIndex(kept);
            };
            kmodel.traverse((n) => {`,
);

source = source.replace(
  `              if (n.name === "kitchenMainPlate") {
                if (Array.isArray(n.material)) {`,
  `              if (n.name === "kitchenMainPlate") {
                _stripHorizontalEdgeFaces(n);
                if (Array.isArray(n.material)) {`,
);

source = source.replace(
  `              if (_matteWhiteMeshNames.has(n.name)) {
                _applyMatteWhite(n);
                return;
              }`,
  `              if (_matteWhiteMeshNames.has(n.name)) {
                if (
                  n.name === "topPlantBaseLeft" ||
                  n.name === "topPlantBaseRight"
                ) {
                  _stripHorizontalEdgeFaces(n);
                }
                _applyMatteWhite(n);
                return;
              }`,
);

const requiredOutput = [
  "vec3 hot = vec3(0.95, 0.0, 0.38);",
  "iceCoffeeGlassFresnel",
  "const TRASH_FX_RADIUS_SCALE = 0.62;",
  "const TRASH_FX_Y_OFFSET = -0.45;",
  "mesh.position.y += TRASH_FX_Y_OFFSET;",
  "const baseY = active.topY + 0.02;",
  "const TRASH_FX_ENABLED = true;",
  "const TRASH_FX_HEIGHT_SCALE = 0.22;",
  "uSize: { value: 560 }",
  "gl_PointSize = min(uSize * att * sizeScale, 110.0);",
  "_trashFxLight.intensity = f * 4;",
  "(0.75 + f * 0.85) * TRASH_FX_HEIGHT_SCALE",
  "Math.min(halfX, halfZ) * TRASH_FX_RADIUS_SCALE",
  "topY: _trashFxBox.max.y,",
  "_trashFxGroup.position.y = TRASH_FX_Y_OFFSET",
  "_cloned.depthWrite = false;",
  "/^binSign\\d+$/.test(n.name.replace(",
  "function stabilizeRectAreaLightingInScene()",
  "scheduleRectAreaLightingSweeps();",
  "RECT_AREA_DIFFUSE_FIX",
  "_mainTableTopAreaLight = new THREE.DirectionalLight(",
  "scene.add(_mainTableTopAreaLight.target);",
  "buildNeutralEnvironmentTexture",
  "EquirectangularReflectionMapping",
  "updateTrashPlaneEffect(dt);",
  "if (n.name === \"trashPlane1\") registerTrashPlane(n);",
  "TRASH_FX_PARTICLE_COUNT = 900",
  "createTrashFxRing(0.82, 1.0, 0xcfeaff, 0.95, 0.6)",
  "stabilizeChairMaterial",
  "_barChairWoodMatBackup",
  "barChairWoodMaterialBackup",
  "diffuseColor.rgb *= 1.35;",
  "barChairWoodDimmer",
  "roughnessFactor = mix(roughnessFactor, 1.0, 0.6);",
  "emissiveIntensity: 0.04,",
  "emissiveIntensity: 1.25,",
  "_barChairWoodMat.emissiveMap = map;",
  "Poliigon_WoodVeneerOak_7760_BaseColor.jpg",
  "_mainTablePlateMat.envMap = null;",
  "envMapIntensity: 0,",
  "_peselColorPanelNames",
  "_applyPeselColorPanel(n);",
  "mainTableSideAreaLight",
  'kitchenAsset("ul-kitchen19.gltf")',
  'kitchenAsset("Mister-spot.gltf")',
  'loadMisterSpot(kmodel, loadToken)',
  'mister.name = "MisterSpot"',
  'const MISTER_SPOT_SPEED = 3.6',
  'const MISTER_SPOT_SCALE = 9',
  'mister.scale.setScalar(MISTER_SPOT_SCALE)',
  '_applyMisterSpotMaterials(mister)',
  'buttonBaseMain: mattPlastic(0xf0c000)',
  'color: 0xff79a8',
  'emissiveIntensity: 3.2',
  'color: 0xff3a00',
  'toneMapped: false',
  'const ROBOT_RAIL_SCALE_Y = 2.4',
  'const ROBOT_RAIL_SCALE_X = 1.12',
  'minX = cx - hx',
  'const ROBOT_RAIL_OFFSET_Y = 8',
  'minZ += ROBOT_RAIL_OFFSET_Y',
  'minZ = cz - hz',
  '_misterSpotClosestDist(path, chair.position.x, chair.position.z)',
  '_buildRobotRailPath(rail, kmodel)',
  'updateMisterSpot(dt);',
  'const MISTER_SPOT_TURN_DURATION = 0.72',
  '_misterSpotStartDrive',
  '_misterSpotArriveCorner',
  'm.mode === "hold"',
  '_misterSpot = null',
  '"iceCoffeeHandle",',
  'const _matteMetalMeshNames = new Set(["iceCoffeePlate"]);',
  'const _clearPlasticMeshNames = new Set(["iceCoffeeGlass"]);',
  'iceCoffeeWater',
  '_buildIceCoffeeWaterGeometry',
  'iceCoffeeSurface',
  'updateIceCoffeeTank(dt);',
  'const _closetDoorsMat',
  'closetDoorEdges',
  'dishwasherDoorEdges',
  'const _stripHorizontalEdgeFaces',
  'const _useFrontSideMaterial',
  'const _dropOverlappingShells',
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
  'n.name === "dishwasherScreen"',
  "kitchenPlate.visible = true",
  "polygonOffsetFactor: -2",
  "car.position.y + 20",
  'name = "lamp" + li + "TableFill"',
  "_KITCHEN_MAX_PIXEL_RATIO = 0.95",
  "mi += 2",
  "lampLightColor",
  "lightBlendDelta",
  "_kitchenIdlePhysicsAccumulator",
  "_cachedTablePlaySurfaceY",
  "const reflectionSurface = _kitchenCoverTopMesh || tablePlateMesh;",
  "_tableLightGlowGeo",
  "_carLightFwd",
  "entry._worldLampSpan",
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
