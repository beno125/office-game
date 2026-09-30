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
const animateIdx = lines.findIndex((l) => /^\s*animate\(\);\s*$/.test(l));
if (animateIdx < 0) {
  throw new Error(`animate() not found in ${htmlPath}`);
}
const moduleImportIdx = lines.findIndex((l) =>
  /import \* as THREE from "three"/.test(l),
);
if (moduleImportIdx < 0) {
  throw new Error(`THREE import not found in ${htmlPath}`);
}
const inner = lines.slice(moduleImportIdx, animateIdx + 1).join("\n");

const marker = `import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";`;

const header = `${marker}
import { getOfficeSceneMount } from "./officeSceneMount.js";
import { emitOfficeSceneEvent } from "../game/officeSceneEvents.js";

const _OFFICE_BASE = \`\${import.meta.env.BASE_URL}office-scene-optimized/\`;
function officeAsset(relativePath) {
  let p = String(relativePath);
  if (p.startsWith("./")) p = p.slice(2);
  return _OFFICE_BASE + p.split("/").map(encodeURIComponent).join("/");
}

let _officeSceneRendering = false;
let _officeSceneAnimationFrame = 0;
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
  /new THREE\.TextureLoader\(\)\.load\("(keyboard(?:-| )image\.jpg)", \(tex\) => \{/,
  `new THREE.TextureLoader().load(officeAsset("$1"), (tex) => {`,
);

s = s.replace(
  `        new THREE.TextureLoader().load(
          "bookLeftPage.jpg",`,
  `        new THREE.TextureLoader().load(
          officeAsset("bookLeftPage.jpg"),`,
);

s = s.replace(
  `        new THREE.TextureLoader().load(
          textureUrl,`,
  `        new THREE.TextureLoader().load(
          officeAsset(textureUrl),`,
);

s = s.replace(
  `        new THREE.TextureLoader().load(
          "techDesignerMagnet.jpg",`,
  `        new THREE.TextureLoader().load(
          officeAsset("techDesignerMagnet.jpg"),`,
);

s = s.replace(
  `        new THREE.TextureLoader().load(
          "plant-ground-texture.jpg",`,
  `        new THREE.TextureLoader().load(
          officeAsset("plant-ground-texture.jpg"),`,
);

s = s.replace(
  `        new THREE.TextureLoader().load(
          "leaf.png",`,
  `        new THREE.TextureLoader().load(
          officeAsset("leaf.png"),`,
);

s = s.replace(
  `        new THREE.TextureLoader().load(
          "wixNoteBook.jpg",`,
  `        new THREE.TextureLoader().load(
          officeAsset("wixNoteBook.jpg"),`,
);

s = s.replace(
  /loader\.load\(\s*\n\s*"(office-table-embed\d+\.gltf)",/,
  `loader.load(
        officeAsset("$1"),`,
);

s = s.replace(
  /const OFFICE_PARTS_SUPPLEMENT_GLTF = "(office-table-embed\d+\.gltf)";/,
  `const OFFICE_PARTS_SUPPLEMENT_GLTF = officeAsset("$1");`,
);

s = s.replace(
  `        new THREE.TextureLoader().load(
          "starText.png",`,
  `        new THREE.TextureLoader().load(
          officeAsset("starText.png"),`,
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
  /loader\.load\(\s*\n\s*carGltfPath,/,
  `loader.load(
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
          else if (camera === freeCamera) nextCam = carCamera;
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

s = s.replace(
  `      let gumsPostFillElapsed = 0;`,
  `      let gumsPostFillElapsed = 0;
      let _gumsInitialSettleEmitted = false;
      function maybeEmitGumsTankInitialSettled() {
        if (_gumsInitialSettleEmitted || gumsReadyToDrop || gumReleased.size > 0) return;
        if (!gumBodies.length || gumsAddedCount < gumBodies.length) return;
        for (let gi = 0; gi < gumsAddedCount; gi++) {
          if (gumReleased.has(gi)) continue;
          if (!isGumInsideTank(gi)) continue;
          if (gumBodies[gi].type !== CANNON.Body.STATIC) return;
        }
        _gumsInitialSettleEmitted = true;
        emitOfficeSceneEvent("gums-tank-initial-settled");
      }`,
);

s = s.replace(
  /(\n[ \t]*)(const _dispenserStillMoving =)/,
  (_, whitespace, declaration) =>
    `${whitespace}maybeEmitGumsTankInitialSettled();${whitespace}${declaration}`,
);

const gumFallSpeedMarker = `      const GUM_FALL_SPEED_CAP = 10;`;
if (!s.includes(gumFallSpeedMarker)) {
  throw new Error(`Gum fall speed marker not found in ${htmlPath}.`);
}
s = s.replace(
  gumFallSpeedMarker,
  `${gumFallSpeedMarker}
      const GUM_RELEASED_FALL_SPEED_CAP = 30;
      const GUM_RELEASED_SPEED_CAP = 34;
      const GUM_RELEASED_LINEAR_DAMPING = 0.12;`,
);

const gumReleaseLoopMarker = `              const gb = gumBodies[gi];
              if (gb.type === CANNON.Body.STATIC) continue;
              const rideTank =`;
if (!s.includes(gumReleaseLoopMarker)) {
  throw new Error(`Gum release loop marker not found in ${htmlPath}.`);
}
s = s.replace(
  gumReleaseLoopMarker,
  `              const gb = gumBodies[gi];
              if (gb.type === CANNON.Body.STATIC) continue;
              const releasedGum = Boolean(gb._exitedGumTank);
              const rideTank =`,
);

const gumRideTankMarker =
  `_gumDispenserBecameDynamic && !gumReleased.has(gi);`;
if (!s.includes(gumRideTankMarker)) {
  throw new Error(`Gum tank ride marker not found in ${htmlPath}.`);
}
s = s.replace(
  gumRideTankMarker,
  `_gumDispenserBecameDynamic && !gb._exitedGumTank;`,
);

const gumDampingMarker =
  `gb.linearDamping = rideTank ? 0.02 : gumDampingWhileFilling;`;
if (!s.includes(gumDampingMarker)) {
  throw new Error(`Gum damping marker not found in ${htmlPath}.`);
}
s = s.replace(
  gumDampingMarker,
  `gb.linearDamping = rideTank
                  ? 0.02
                  : releasedGum
                    ? GUM_RELEASED_LINEAR_DAMPING
                    : gumDampingWhileFilling;`,
);

const gumVelocityCapMarker = `              } else {
                if (v.y < -maxFallSpd) v.y = -maxFallSpd;
                const spd = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
                if (spd > maxGumSpd) {
                  const sc = maxGumSpd / spd;`;
if (!s.includes(gumVelocityCapMarker)) {
  throw new Error(`Gum velocity cap marker not found in ${htmlPath}.`);
}
s = s.replace(
  gumVelocityCapMarker,
  `              } else {
                const fallSpeedCap = releasedGum
                  ? GUM_RELEASED_FALL_SPEED_CAP
                  : maxFallSpd;
                const speedCap = releasedGum
                  ? GUM_RELEASED_SPEED_CAP
                  : maxGumSpd;
                if (v.y < -fallSpeedCap) v.y = -fallSpeedCap;
                const spd = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
                if (spd > speedCap) {
                  const sc = speedCap / spd;`,
);

const releasedGumDampingMarker = `                    b.linearDamping = 0.92;`;
if (!s.includes(releasedGumDampingMarker)) {
  throw new Error(`Released gum damping marker not found in ${htmlPath}.`);
}
s = s.replace(
  releasedGumDampingMarker,
  `                    b.linearDamping = GUM_RELEASED_LINEAR_DAMPING;`,
);

const gumSpawnResetMarker = `          b.force.set(0, 0, 0);
          b.torque.set(0, 0, 0);`;
if (!s.includes(gumSpawnResetMarker)) {
  throw new Error(`Gum spawn reset marker not found in ${htmlPath}.`);
}
s = s.replace(
  gumSpawnResetMarker,
  `${gumSpawnResetMarker}
          b._exitedGumTank = false;`,
);

const gumClampLoopMarker = `        for (let i = 0; i < gumsAddedCount; i++) {
          if (_gumDispenserBecameDynamic && gumReleased.has(i)) continue;
          const body = gumBodies[i];`;
if (!s.includes(gumClampLoopMarker)) {
  throw new Error(`Gum tank clamp loop marker not found in ${htmlPath}.`);
}
s = s.replace(
  gumClampLoopMarker,
  `        for (let i = 0; i < gumsAddedCount; i++) {
          const body = gumBodies[i];
          if (body._exitedGumTank) continue;`,
);

const gumCarryMarker = `        for (let i = 0; i < gumsAddedCount; i++) {
          if (gumReleased.has(i)) continue;
          const body = gumBodies[i];`;
if (!s.includes(gumCarryMarker)) {
  throw new Error(`Gum tank carry marker not found in ${htmlPath}.`);
}
s = s.replace(
  gumCarryMarker,
  `        for (let i = 0; i < gumsAddedCount; i++) {
          const body = gumBodies[i];
          if (body._exitedGumTank) continue;`,
);

const gumBottomExitMarker = `          const inBottomHole = horiz <= holeR;
          const canLeaveBottom =
            gumReleased.has(i) || (_gumHitCupOpen && inBottomHole);
          if (canLeaveBottom && py < exitY) {
            if (_gumHitCupOpen && inBottomHole) gumReleased.add(i);
            continue;
          }`;
if (!s.includes(gumBottomExitMarker)) {
  throw new Error(`Gum bottom exit marker not found in ${htmlPath}.`);
}
s = s.replace(
  gumBottomExitMarker,
  `          const inBottomHole = horiz <= holeR;
          const canLeaveBottom =
            inBottomHole && (gumReleased.has(i) || _gumHitCupOpen);
          if (canLeaveBottom && py < exitY) {
            body._exitedGumTank = true;
            if (_gumHitCupOpen) gumReleased.add(i);
            continue;
          }`,
);

const releasedGumEjectMarker = `        for (const gi of gumReleased) {
          const body = gumBodies[gi];
          if (!body) continue;`;
const releasedGumEjectCount =
  s.split(releasedGumEjectMarker).length - 1;
if (releasedGumEjectCount !== 2) {
  throw new Error(
    `Expected two released gum eject loops in ${htmlPath}, found ${releasedGumEjectCount}.`,
  );
}
s = s.split(releasedGumEjectMarker).join(
  `        for (const gi of gumReleased) {
          const body = gumBodies[gi];
          if (!body || !body._exitedGumTank) continue;`,
);

const gumTankRebuildSidedMarker = `          GUM_TANK_TRIMESH_SCALE,
          false,
        );`;
if (!s.includes(gumTankRebuildSidedMarker)) {
  throw new Error(`Gum tank rebuild sidedness marker not found in ${htmlPath}.`);
}
s = s.replace(
  gumTankRebuildSidedMarker,
  `          GUM_TANK_TRIMESH_SCALE,
          false,
        );`,
);

const gumTankBuilderMarker =
  `            function addGumsTankPhysicsTrimesh(obj, wireColor, physScale) {`;
if (!s.includes(gumTankBuilderMarker)) {
  throw new Error(`Gum tank builder marker not found in ${htmlPath}.`);
}
s = s.replace(
  gumTankBuilderMarker,
  `            function addGumsTankPhysicsTrimesh(obj, wireColor, physScale, doubleSided = false) {`,
);

const gumTankInitialTrimeshMarker =
  `              const tri = new CANNON.Trimesh(verts, inds);`;
if (!s.includes(gumTankInitialTrimeshMarker)) {
  throw new Error(`Initial gum tank trimesh marker not found in ${htmlPath}.`);
}
s = s.replace(
  gumTankInitialTrimeshMarker,
  `              let triInds = inds;
              if (doubleSided) {
                triInds = [];
                for (let i = 0; i < inds.length; i += 3) {
                  triInds.push(inds[i], inds[i + 1], inds[i + 2]);
                  triInds.push(inds[i + 2], inds[i + 1], inds[i]);
                }
              }
              const tri = new CANNON.Trimesh(verts, triInds);`,
);

const gumTankInitialCallMarker = `              GUM_TANK_TRIMESH_SCALE,
            );`;
if (!s.includes(gumTankInitialCallMarker)) {
  throw new Error(`Initial gum tank call marker not found in ${htmlPath}.`);
}
s = s.replace(
  gumTankInitialCallMarker,
  `              GUM_TANK_TRIMESH_SCALE,
            );`,
);

const gumCcdMarker = `                      body.ccdIterations = 1;`;
if (!s.includes(gumCcdMarker)) {
  throw new Error(`Gum CCD marker not found in ${htmlPath}.`);
}
s = s.replace(gumCcdMarker, `                      body.ccdIterations = 2;`);

const gumTopOpeningMarker =
  `          if (py > c.maxY + r * 4) continue;`;
if (!s.includes(gumTopOpeningMarker)) {
  throw new Error(`Gum tank top opening marker not found in ${htmlPath}.`);
}
s = s.replace(
  gumTopOpeningMarker,
  `          if (gumsReadyToDrop && py > c.maxY + r * 4) continue;`,
);

const dynamicGumStepMarker = `              if (_gumDispenserBecameDynamic) {
                syncGumDispenserFromPhysics();
                if (gumsTankPhysicObject) {
                  gumDispenserGroup.updateMatrixWorld(true);
                  gumsTankPhysicObject.updateMatrixWorld(true);
                  _gumTankMwCached.copy(gumsTankPhysicObject.matrixWorld);
                  _invTankMwGumClamp.copy(_gumTankMwCached).invert();
                }
                clampGumsInsideTankLocalAabb(true);
                physicsWorld.step(1 / 60, physicsStepDt, 2);
                separateOverlappingGumSpheres(gumSepUseImpulse);
                syncGumDispenserFromPhysics();
                ejectReleasedGumsFromUnderStand();
                ejectReleasedGumsFromUnderDispenser();
              } else {`;
if (!s.includes(dynamicGumStepMarker)) {
  throw new Error(`Dynamic gum physics step marker not found in ${htmlPath}.`);
}

const gumSeparationImpulseMarker = `            const gumSepUseImpulse =
              gumsReadyToDrop || gumReleased.size > 0;`;
if (!s.includes(gumSeparationImpulseMarker)) {
  throw new Error(`Gum separation impulse marker not found in ${htmlPath}.`);
}
s = s.replace(
  gumSeparationImpulseMarker,
  `            const gumSepUseImpulse = gumsReadyToDrop;`,
);

s = s.replace(
  dynamicGumStepMarker,
  `              if (_gumDispenserBecameDynamic) {
                syncGumDispenserFromPhysics();
                clampGumsInsideTankLocalAabb(false);
                physicsWorld.step(1 / 60, physicsStepDt, 2);
                syncGumDispenserFromPhysics();
                clampGumsInsideTankLocalAabb(false);
                separateOverlappingGumSpheres(gumSepUseImpulse);
                clampGumsInsideTankLocalAabb(false);
                ejectReleasedGumsFromUnderStand();
                ejectReleasedGumsFromUnderDispenser();
              } else {`,
);

const drawerTransitionStateMarker =
  `      let _drawerPortalFadeOutStartMs = 0;`;
if (!s.includes(drawerTransitionStateMarker)) {
  throw new Error(`Drawer portal state marker not found in ${htmlPath}.`);
}
s = s.replace(
  drawerTransitionStateMarker,
  `${drawerTransitionStateMarker}
      const DRAWER_CAR_ENTRY_RADIUS = 3.1;
      const DRAWER_CAR_ABSORB_DURATION = 700;
      let _drawerCarAbsorbing = false;
      let _drawerCarTransitionEmitted = false;
      let _drawerCarAbsorbStartMs = 0;
      let _drawerCarAbsorbStartRotationY = 0;
      const _drawerCarAbsorbStartPosition = new THREE.Vector3();
      const _drawerCarAbsorbStartScale = new THREE.Vector3();
      const _drawerCarAbsorbTarget = new THREE.Vector3();
      const _drawerPortalWorldPosition = new THREE.Vector3();

      function updateDrawerCarTransition() {
        if (!_drawerCarAbsorbing) {
          if (
            _drawerState !== "open" ||
            !_drawerEffectMesh ||
            !_drawerEffectMesh.visible ||
            !carFalling ||
            !car ||
            !car.visible
          ) {
            return false;
          }

          _drawerEffectMesh.updateWorldMatrix(true, false);
          _drawerEffectMesh.getWorldPosition(_drawerPortalWorldPosition);
          const dx = car.position.x - _drawerPortalWorldPosition.x;
          const dz = car.position.z - _drawerPortalWorldPosition.z;
          const isInsidePortal =
            dx * dx + dz * dz <=
              DRAWER_CAR_ENTRY_RADIUS * DRAWER_CAR_ENTRY_RADIUS &&
            car.position.y <=
              _drawerPortalWorldPosition.y + DRAWER_PORTAL_HEIGHT;
          if (!isInsidePortal) return false;

          _drawerCarAbsorbing = true;
          _drawerCarAbsorbStartMs = performance.now();
          _drawerCarAbsorbStartRotationY = car.rotation.y;
          _drawerCarAbsorbStartPosition.copy(car.position);
          _drawerCarAbsorbStartScale.copy(car.scale);
          _drawerCarAbsorbTarget.copy(_drawerPortalWorldPosition);
          _drawerCarAbsorbTarget.y = Math.min(
            car.position.y - 1.5,
            _drawerPortalWorldPosition.y - 0.8,
          );
          carState.speed = 0;
          carState.velY = 0;
        }

        const progress = Math.min(
          (performance.now() - _drawerCarAbsorbStartMs) /
            DRAWER_CAR_ABSORB_DURATION,
          1,
        );
        const eased = 1 - Math.pow(1 - progress, 3);
        car.position.lerpVectors(
          _drawerCarAbsorbStartPosition,
          _drawerCarAbsorbTarget,
          eased,
        );
        car.scale
          .copy(_drawerCarAbsorbStartScale)
          .multiplyScalar(Math.max(0, 1 - eased));
        car.rotation.y =
          _drawerCarAbsorbStartRotationY + eased * Math.PI * 2;
        car.updateMatrixWorld(true);

        if (progress >= 1 && !_drawerCarTransitionEmitted) {
          _drawerCarTransitionEmitted = true;
          car.visible = false;
          emitOfficeSceneEvent("transition-to-kitchen");
        }
        return true;
      }`,
);

const updateCarMarker = `      function updateCar(dt) {
        const inAir = carState.velY !== 0;`;
if (!s.includes(updateCarMarker)) {
  throw new Error(`Car update marker not found in ${htmlPath}.`);
}
s = s.replace(
  updateCarMarker,
  `      function updateCar(dt) {
        if (updateDrawerCarTransition()) return;
        const inAir = carState.velY !== 0;`,
);

const officeAnimateMarker = `      function animate() {
        requestAnimationFrame(animate);`;
if (!s.includes(officeAnimateMarker)) {
  throw new Error(`Office animation marker not found in ${htmlPath}.`);
}
s = s.replace(
  officeAnimateMarker,
  `      function animate() {
        if (!_officeSceneRendering) {
          _officeSceneAnimationFrame = 0;
          return;
        }
        _officeSceneAnimationFrame = requestAnimationFrame(animate);`,
);

const officeStartMarker = `      animate();`;
if (!s.endsWith(officeStartMarker)) {
  throw new Error(`Office animation start marker not found in ${htmlPath}.`);
}
s = s.slice(0, -officeStartMarker.length) + `      export function setOfficeSceneRendering(active) {
        const shouldRender = Boolean(active);
        if (!shouldRender) {
          _officeSceneRendering = false;
          if (_officeSceneAnimationFrame) {
            cancelAnimationFrame(_officeSceneAnimationFrame);
            _officeSceneAnimationFrame = 0;
          }
          return;
        }

        const mount = getOfficeSceneMount();
        if (renderer.domElement.parentElement !== mount) {
          mount.appendChild(renderer.domElement);
        }
        resize();
        if (_officeSceneRendering) return;
        _officeSceneRendering = true;
        clock.getDelta();
        animate();
      }
      setOfficeSceneRendering(true);`;

// Do not create the hand FX XYZ debug gizmo in the shipped scene.
s = s.replace(
  `_handWalkFxPivotGizmo = createHandWalkFxPivotGizmo();`,
  `_handWalkFxPivotGizmo = null;`,
);

// Legacy Poly Haven dl link is dead (redirects to 404 + CORS errors in browser).
s = s.replace(
  `https://dl.polyhaven.org/file/ahjdyYv/HDRIHaven_HDRI_Hall_2k.hdr`,
  `https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr`,
);

// Selective bloom temporarily swaps scene materials. Preserve the first backup
// and always restore it, even when a bloom render throws.
s = s.replace(
  /^(\s*)carBloomMaterialRestore\[obj\.uuid\] = obj\.material;$/gm,
  (_, indent) =>
    `${indent}if (!(obj.uuid in carBloomMaterialRestore))\n${indent}  carBloomMaterialRestore[obj.uuid] = obj.material;`,
);
const bloomRenderMarker = `        darkenCarBloomLists();
        bloomComposer.render();
        restoreCarBloomLists();

        scene.background = prevBg;
        renderer.toneMapping = prevTm;
        renderer.toneMappingExposure = prevExp;`;
if (!s.includes(bloomRenderMarker)) {
  throw new Error(`Bloom material restore marker not found in ${htmlPath}.`);
}
s = s.replace(
  bloomRenderMarker,
  `        try {
          darkenCarBloomLists();
          bloomComposer.render();
        } finally {
          restoreCarBloomLists();
          scene.background = prevBg;
          renderer.toneMapping = prevTm;
          renderer.toneMappingExposure = prevExp;
        }`,
);
s = s.replace(
  `      sceneBloomEnabled = perfSettings.bloom;`,
  `      sceneBloomEnabled = false;`,
);
s = s.replace(
  `        sceneBloomEnabled = s.bloom;`,
  `        sceneBloomEnabled = false;`,
);
const portalSceneDimmingMarker = `          const portalDarknessTarget =
            _drawerState === "open" && _drawerEffectMesh?.visible ? 1 : 0;
          const portalDarknessDuration =
            portalDarknessTarget > _portalSceneDarkness ? 0.65 : 0.45;
          _portalSceneDarkness +=
            (portalDarknessTarget - _portalSceneDarkness) *
            Math.min(1, dt / portalDarknessDuration);
          renderer.toneMappingExposure = THREE.MathUtils.lerp(
            1,
            0.38,
            _portalSceneDarkness,
          );
          if (scene.background?.isColor) {
            scene.background.multiplyScalar(
              THREE.MathUtils.lerp(1, 0.48, _portalSceneDarkness),
            );
          }`;
if (!s.includes(portalSceneDimmingMarker)) {
  throw new Error(`Portal scene dimming marker not found in ${htmlPath}.`);
}
s = s.replace(
  portalSceneDimmingMarker,
  `          _portalSceneDarkness = 0;
          renderer.toneMappingExposure = 1;`,
);

// The office scene already uses SMAA. The extra sharpening pass exaggerates
// sub-pixel edges on the blinds and floor into visible horizontal noise.
s = s.replace(
  `      sharpenPass.enabled = perfSettings.sharpen && !perfSettings.bloom;`,
  `      sharpenPass.enabled = false;`,
);
s = s.replace(
  `          sharpenPass.enabled = s.sharpen && !s.bloom;`,
  `          sharpenPass.enabled = false;`,
);

const airPlaneMaterialMarker = `      const airPlaneMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 1.0,
        metalness: 0.0,
        side: THREE.DoubleSide,
        emissive: 0xffffff,
        emissiveIntensity: 0.15,
      });`;
if (!s.includes(airPlaneMaterialMarker)) {
  throw new Error(`Airplane material marker not found in ${htmlPath}.`);
}
s = s.replace(
  airPlaneMaterialMarker,
  `      const airPlaneMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        toneMapped: true,
      });`,
);

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, s, "utf8");
console.log("Wrote", outFile, "from", htmlPath, `(${s.split("\n").length} lines)`);
