      import * as THREE from "three";
      import * as CANNON from "cannon-es";
      import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
      import { ConvexHull } from "three/addons/math/ConvexHull.js";
      import { OrbitControls } from "three/addons/controls/OrbitControls.js";
      import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
      import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
      import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
      import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
      import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
      import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
      import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
      import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
      import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { getKitchenSceneMount } from "./kitchenSceneMount.js";
import { emitKitchenSceneEvent } from "../game/kitchenSceneEvents.js";
import {
  StadiumTrack,
  LapTracker,
  RaceAIDriver,
  RaceHud,
  RaceResultsPopup,
  RACE_LAPS,
  RACE_COUNTDOWN_SEC,
  RACE_RESULTS_DELAY_SEC,
  RACE_RESULTS_MAX_WAIT_SEC,
  formatRaceTime,
  raceAiMaxOutward,
} from "./kitchenRace.js";
import { SCENE_ROUTES, nextLevelPath } from "../game/sceneRoutes.js";
import { createCinematicIntro, introEase, introEaseSine, introLerp } from "../game/cinematicIntro.js";
import { createPortalRing, portalGlowTexture } from "../game/portalRing.js";
import { createCarLighting } from "../game/carLighting.js";
import { addBloomGroup, addThresholdBloom, keepBelowBloomThreshold, setBloomWeight } from "../game/thresholdBloom.js";
import { createTouchDrive } from "../game/touch/touchDrive.js";
import { createKitchenFood, trayFromMesh, addTrayShapes, KITCHEN_FOOD } from "./kitchenFood.js";
import { createMilkCartons } from "./kitchenMilkCartons.js";
import { createShelfJars } from "./kitchenShelfJars.js";
import { createStartLights } from "./kitchenStartLights.js";
import { createCounterScreen } from "./kitchenCounterScreen.js";
import { createTrailingPlants } from "./kitchenTrailingPlants.js";
import { createCupStacks } from "./kitchenCupStacks.js";
import { createKitchenNapkins } from "./kitchenNapkins.js";
import { createCameraDrag } from "../game/cameraDrag.js";
import {
  CAR_MASS,
  CAR_BUMP_SLIDE_DECAY,
  CAR_BUMP_SPIN_DECAY,
  CAR_BUMP_YAW_CAP,
  carBoxInertia,
  solveCarBump,
} from "../game/carBumpPhysics.js";

const _KITCHEN_BASE = `${import.meta.env.BASE_URL}kitchen-scene-optimized/`;
const _OFFICE_BASE = `${import.meta.env.BASE_URL}office-scene-optimized/`;
const kitchenAsset = (path) => _KITCHEN_BASE + String(path).replace(/^\.\//, "");
const officeAsset = (path) => _OFFICE_BASE + String(path).replace(/^\.\//, "");

let _kitchenSceneRendering = false;
let _kitchenSceneAnimationFrame = 0;
let _kitchenSceneReady = false;
/** Set (and "ready" emitted) once the loaded kitchen has been drawn a few times. */
let _kitchenSceneShown = false;
let _kitchenSceneShownFrames = 0;
/** Frames drawn before "ready": shaders compiled, textures uploaded (no hitch on reveal). */
const KITCHEN_READY_FRAMES = 4;

export function isKitchenSceneReady() {
  return _kitchenSceneShown;
}

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a1a1a);
      let physicsWorld = null;

      const carCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
      carCamera.position.set(2, 2, 2);
      const carCameraFollow = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
      carCameraFollow.position.set(2, 2, 2);
      const testCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
      /** The chase camera (key 2, once the race runs): behind the player's car (KITCHEN_CHASE_CAM). */
      const chaseCamera = new THREE.PerspectiveCamera(56, 1, 0.05, 1000);
      let camera = carCamera;
      const CAR_CAM_YAW_FOLLOW = 0.42;
      const CAR_CAM_AZIMUTH_LIMIT = THREE.MathUtils.degToRad(70);
      const CAR_CAM_FOLLOW_ZOOM = 0.075;
      let _carCamPrevCarYaw = 0;
      let _carFollowCamDistance = 0;
      let _carFollowCamWorldYaw = 0;
      let _carFollowCamElev = 0;
      let _carOrbitCamDistance = 0;
      let _carOrbitCamWorldYaw = 0;
      let _carOrbitCamElev = 0;
      let _carCam1OrbitDistSnapshot = 0;
      let _carCam1OrbitElevSnapshot = 0;
      let _carCam1OrbitYawSnapshot = 0;
      const _carCamYAxis = new THREE.Vector3(0, 1, 0);
      const _carCamOffset = new THREE.Vector3();
      const _rampJumpCamRestOffset = new THREE.Vector3();
      const _carCam1ChaseOffset = new THREE.Vector3();
      const _carCam1ReturnTargetOffset = new THREE.Vector3();
      const _carCam1PreMatrixOffset = new THREE.Vector3();
      const _carMatrixLookAt = new THREE.Vector3();
      let _carCam1PreserveView = false;
      let _carCam1MatrixReturnActive = false;
      let _carCam1MatrixReturnT = 0;
      let _carCam1MatrixOrbitSettled = false;
      const CAR_CAM_MATRIX_RETURN_SPEED = 7;

      function clampCarFollowCamWorldYaw(yaw) {
        return THREE.MathUtils.clamp(
          yaw,
          -CAR_CAM_AZIMUTH_LIMIT,
          CAR_CAM_AZIMUTH_LIMIT,
        );
      }

      function syncCarFollowCamAnglesFromPosition(fromCam) {
        if (!car || !fromCam) return;
        _carCamOffset.copy(fromCam.position).sub(car.position);
        _carFollowCamDistance = _carCamOffset.length();
        const horizDist = Math.hypot(_carCamOffset.x, _carCamOffset.z);
        _carFollowCamElev =
          horizDist > 1e-6
            ? Math.atan2(_carCamOffset.y, horizDist)
            : _carFollowCamElev;
        _carFollowCamWorldYaw = clampCarFollowCamWorldYaw(
          Math.atan2(_carCamOffset.x, _carCamOffset.z),
        );
      }

      function applyCarFollowCameraFromAngles() {
        if (camera !== carCameraFollow || !car || _carFollowCamDistance < 1e-6) return;
        const worldYaw = clampCarFollowCamWorldYaw(_carFollowCamWorldYaw);
        _carFollowCamWorldYaw = worldYaw;
        const horizDist = _carFollowCamDistance * Math.cos(_carFollowCamElev);
        const yOff = _carFollowCamDistance * Math.sin(_carFollowCamElev);
        _carCamOffset.set(
          Math.sin(worldYaw) * horizDist,
          yOff,
          Math.cos(worldYaw) * horizDist,
        );
        carCameraFollow.position.copy(car.position).add(_carCamOffset);
      }

      function configureOrbitControlsForCarView(forCamera) {
        if (forCamera === carCameraFollow && _carFollowCamDistance > 1e-6) {
          controls.minDistance = _carFollowCamDistance;
          controls.maxDistance = _carFollowCamDistance;
          controls.enableZoom = false;
          applyCarFollowCameraFromAngles();
          const polar = controls.getPolarAngle();
          controls.minPolarAngle = polar;
          controls.maxPolarAngle = polar;
        } else if (forCamera === carCamera && _carOrbitCamDistance > 1e-6) {
          controls.minDistance = _carOrbitCamDistance;
          controls.maxDistance = _carOrbitCamDistance;
          controls.enableZoom = false;
          applyCarOrbitCameraFromAngles();
          const polar = controls.getPolarAngle();
          controls.minPolarAngle = polar;
          controls.maxPolarAngle = polar;
        } else {
          controls.minDistance = car ? getCarCameraMinDistance() : 0.72;
          controls.maxDistance = Infinity;
          controls.enableZoom = true;
          controls.minPolarAngle = 0;
          controls.maxPolarAngle = Math.PI;
        }
      }

      function getCarCameraOffsetFromPosition(fromCam, out) {
        getCarCameraLookAtPoint(_carMatrixLookAt);
        return out.copy(fromCam.position).sub(_carMatrixLookAt);
      }

      function setCarCameraFromLookAtOffset(offset) {
        getCarCameraLookAtPoint(_carMatrixLookAt);
        if (shouldClampJumpCameraAboveTable()) {
          clampJumpCameraOffsetAboveTable(offset);
        }
        carCamera.position.copy(_carMatrixLookAt).add(offset);
        applyCarCameraLookAtCar();
      }

      function shouldClampJumpCameraAboveTable() {
        return (
          car &&
          isCarCameraOrbitDefault() &&
          _rampJumpMatrixActive &&
          carState.velY !== 0
        );
      }

      function clampJumpCameraOffsetAboveTable(offset) {
        if (!car) return offset;
        getCarCameraLookAtPoint(_carMatrixLookAt);
        const minCamY =
          tableSpawn.y + RAMP_JUMP_CAM_TABLE_CLEARANCE * storedCarScale;
        const deficit = minCamY - (_carMatrixLookAt.y + offset.y);
        if (deficit > 0) offset.y += deficit;
        return offset;
      }

      function syncCarOrbitCamAnglesFromPosition(fromCam) {
        if (!car || !fromCam) return;
        getCarCameraOffsetFromPosition(fromCam, _carCamOffset);
        _carOrbitCamDistance = _carCamOffset.length();
        _carOrbitCamDistance = Math.max(
          _carOrbitCamDistance,
          getCarCameraMinDistance(),
        );
        const horizDist = Math.hypot(_carCamOffset.x, _carCamOffset.z);
        _carOrbitCamElev =
          horizDist > 1e-6
            ? Math.atan2(_carCamOffset.y, horizDist)
            : _carOrbitCamElev;
        _carOrbitCamWorldYaw = clampCarFollowCamWorldYaw(
          Math.atan2(_carCamOffset.x, _carCamOffset.z),
        );
      }

      function syncCarOrbitCamYawFromPosition() {
        if (!isCarCameraOrbitDefault() || !car || _carOrbitCamDistance < 1e-6)
          return;
        getCarCameraOffsetFromPosition(carCamera, _carCamOffset);
        const horizDist = Math.hypot(_carCamOffset.x, _carCamOffset.z);
        if (horizDist < 1e-6) return;
        _carOrbitCamWorldYaw = clampCarFollowCamWorldYaw(
          Math.atan2(_carCamOffset.x, _carCamOffset.z),
        );
      }

      function applyCarOrbitCameraFromAngles() {
        if (!isCarCameraOrbitDefault() || !car || _carOrbitCamDistance < 1e-6)
          return;
        if (isCarCameraJumpEffectActive()) return;
        const worldYaw = clampCarFollowCamWorldYaw(_carOrbitCamWorldYaw);
        _carOrbitCamWorldYaw = worldYaw;
        const horizDist = _carOrbitCamDistance * Math.cos(_carOrbitCamElev);
        const yOff = _carOrbitCamDistance * Math.sin(_carOrbitCamElev);
        _carCamOffset.set(
          Math.sin(worldYaw) * horizDist,
          yOff,
          Math.cos(worldYaw) * horizDist,
        );
        setCarCameraFromLookAtOffset(_carCamOffset);
      }


      function restoreCarOrbitCamRestPose(yawFromOffset) {
        if (!isCarCameraOrbitDefault() || !car) return;
        if (_carCam1OrbitDistSnapshot > 1e-6) {
          _carOrbitCamDistance = _carCam1OrbitDistSnapshot;
          _carOrbitCamElev = _carCam1OrbitElevSnapshot;
          _carOrbitCamWorldYaw = clampCarFollowCamWorldYaw(
            _carCam1OrbitYawSnapshot,
          );
        } else if (yawFromOffset) {
          const horizDist = Math.hypot(yawFromOffset.x, yawFromOffset.z);
          if (horizDist > 1e-6) {
            _carOrbitCamWorldYaw = clampCarFollowCamWorldYaw(
              Math.atan2(yawFromOffset.x, yawFromOffset.z),
            );
          }
        }
        const worldYaw = clampCarFollowCamWorldYaw(_carOrbitCamWorldYaw);
        _carOrbitCamWorldYaw = worldYaw;
        const horizDist = _carOrbitCamDistance * Math.cos(_carOrbitCamElev);
        const yOff = _carOrbitCamDistance * Math.sin(_carOrbitCamElev);
        _carCamOffset.set(
          Math.sin(worldYaw) * horizDist,
          yOff,
          Math.cos(worldYaw) * horizDist,
        );
        setCarCameraFromLookAtOffset(_carCamOffset);
        configureOrbitControlsForCarView(carCamera);
      }

      function isCarCameraOrbitDefault() {
        return camera === carCamera;
      }

      function syncCarCameraYawTracking() {
        _carCamPrevCarYaw = carState.angle + carState.driftAngle;
      }

      function captureCarCam1ChaseOffset() {
        if (!car || camera !== carCamera) return;
        getCarCameraOffsetFromPosition(carCamera, _carCam1ChaseOffset);
      }

      function syncCarCam1OrbitControlsFromCamera() {
        if (camera !== carCamera || !car) return;
        applyCarOrbitCameraFromAngles();
        captureCarCam1ChaseOffset();
        const pos = carCamera.position.clone();
        controls.dispose();
        controls = createOrbitControls(carCamera);
        getCarCameraLookAtPoint(_carMatrixLookAt);
        controls.target.copy(_carMatrixLookAt);
        carCamera.position.copy(pos);
        applyCarCameraLookAtCar();
        configureOrbitControlsForCarView(carCamera);
        controls.update();
      }

      function beginCarCam1ReturnToRest() {
        if (camera !== carCamera || !car) return;
        _carCam1JumpEffect = 0;
        if (
          _carCam1ReturnTargetOffset.lengthSq() > 1e-6 ||
          _rampJumpCamRestOffset.lengthSq() > 1e-6
        ) {
          if (_carCam1ReturnTargetOffset.lengthSq() < 1e-6) {
            _carCam1ReturnTargetOffset.copy(
              _carCam1PreMatrixOffset.lengthSq() > 1e-6
                ? _carCam1PreMatrixOffset
                : _rampJumpCamRestOffset,
            );
          }
          if (!_carCam1MatrixReturnActive) {
            _carCam1MatrixReturnT = 0;
          }
          _carCam1MatrixReturnActive = true;
          _carCam1PreserveView = true;
        } else {
          restoreCarOrbitCamRestPose(null);
          _carCam1PreserveView = false;
        }
      }

      function updateCarCam1MatrixReturn(rawDt) {
        if (!_carCam1MatrixReturnActive || camera !== carCamera || !car)
          return false;
        _carCam1MatrixReturnT = Math.min(
          1,
          _carCam1MatrixReturnT + rawDt * CAR_CAM_MATRIX_RETURN_SPEED,
        );
        const t = rampJumpEaseInOut(_carCam1MatrixReturnT);
        getCarCameraOffsetFromPosition(carCamera, _carCamOffset);
        _carCamOffset.lerp(_carCam1ReturnTargetOffset, t);
        clampCarCameraOffsetInPlace(_carCamOffset);
        setCarCameraFromLookAtOffset(_carCamOffset);
        if (_carCam1MatrixReturnT >= 1) {
          _carCam1MatrixReturnActive = false;
          _rampJumpMatrixActive = false;
          _rampJumpMatrixOrbitProgress = 0;
          restoreCarOrbitCamRestPose(null);
          syncCarCam1OrbitControlsFromCamera();
          _carCam1MatrixOrbitSettled = true;
          _carCam1PreserveView = false;
          _carCam1ReturnTargetOffset.set(0, 0, 0);
          _carCam1PreMatrixOffset.set(0, 0, 0);
          _rampJumpCamRestOffset.set(0, 0, 0);
        }
        return true;
      }

      function updateCarCam1RampJumpEffect(rawDt) {
        if (!isCarCameraOrbitDefault() || !car) return;
        updateCarCam1MatrixReturn(rawDt);
      }

      let _carCam1LandShakeTime = 0;
      let _carCam1LandShakeIntensity = 1;
      const _landShakeOffset = new THREE.Vector3();

      function triggerCarCam1LandingShake(intensity = 1) {
        _carCam1LandShakeTime = 1e-6;
        _carCam1LandShakeIntensity = THREE.MathUtils.clamp(
          Math.max(intensity, 0.85),
          0.85,
          1.6,
        );
      }

      function advanceCarCam1LandingShake(rawDt) {
        if (_carCam1LandShakeTime <= 0) return null;
        _carCam1LandShakeTime += rawDt;
        if (_carCam1LandShakeTime >= LAND_CAM_SHAKE_DURATION) {
          _carCam1LandShakeTime = 0;
          return null;
        }
        const life = _carCam1LandShakeTime / LAND_CAM_SHAKE_DURATION;
        const decay = (1 - life) * (1 - life);
        const t = _carCam1LandShakeTime;
        const k = LAND_CAM_SHAKE_LOOK * decay * _carCam1LandShakeIntensity;
        _landShakeOffset.set(
          (Math.sin(t * 52) + Math.sin(t * 97) * 0.55) * k,
          Math.sin(t * 58) * k * 1.05,
          Math.cos(t * 44) * k * 0.8,
        );
        return _landShakeOffset;
      }

      function rampJumpEaseInOut(t) {
        const x = THREE.MathUtils.clamp(t, 0, 1);
        return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
      }



      function getCarCameraMinDistance() {
        if (!car) return 1.1;
        const sx = halfW * storedCarScale;
        const sy = carBodyHalfY * storedCarScale * 2;
        const sz = halfL * storedCarScale;
        const boundR = Math.sqrt(sx * sx + sy * sy + sz * sz);
        const carSpan = Math.max(sx, sy, sz, 0.2);
        const vFov = THREE.MathUtils.degToRad(carCamera.fov);
        const fitDist = (carSpan * 2.5) / Math.tan(vFov * 0.5);
        const hullDist = boundR * 2.25;
        return Math.max(fitDist, hullDist, 0.75);
      }


      function clampCarCameraOffsetInPlace(offset) {
        const minDist = getCarCameraMinDistance();
        const len = offset.length();
        if (len >= minDist) return offset;
        if (len > 1e-6) {
          offset.multiplyScalar(minDist / len);
        } else if (_carCam1ChaseOffset.lengthSq() > 1e-6) {
          offset.copy(_carCam1ChaseOffset).setLength(minDist);
        } else {
          offset.set(minDist * 0.35, minDist * 0.38, minDist * 0.88);
        }
        return offset;
      }

      function getCarCameraLookAtPoint(out) {
        out.copy(car.position);
        out.y += carBodyHalfY * storedCarScale * 0.42;
        return out;
      }


      function applyCarCameraLookAtCar() {
        if (!car || camera !== carCamera) return;
        getCarCameraLookAtPoint(_carMatrixLookAt);
        carCamera.up.set(0, 1, 0);
        carCamera.lookAt(_carMatrixLookAt);
        if (controls) controls.target.copy(_carMatrixLookAt);
      }

      function isCarCameraMatrixOrbitActive() {
        return (
          isCarCameraOrbitDefault() &&
          _rampJumpMatrixActive &&
          carState.velY !== 0 &&
          !_carCam1MatrixReturnActive
        );
      }

      function isCarCameraJumpEffectActive() {
        return (
          isCarCameraOrbitDefault() &&
          (isCarCameraMatrixOrbitActive() || _carCam1MatrixReturnActive)
        );
      }

      function enforceCarCameraMinDistance() {
        if (!car || camera !== carCamera) return;
        getCarCameraLookAtPoint(_carMatrixLookAt);
        _carCamOffset.copy(carCamera.position).sub(_carMatrixLookAt);
        const len = _carCamOffset.length();
        const minDist = getCarCameraMinDistance();
        if (len >= minDist) return;
        if (len > 1e-6) {
          _carCamOffset.multiplyScalar(minDist / len);
        } else {
          _carCamOffset.set(minDist * 0.35, minDist * 0.12, minDist * 0.88);
        }
        carCamera.position.copy(_carMatrixLookAt).add(_carCamOffset);
        applyCarCameraLookAtCar();
      }





      function getMatrixJumpGravityScale() {
        return 1;
      }

      function updateCarCameraFollow() {
        if (camera !== carCameraFollow || !car) return;
        const carYaw = carState.angle + carState.driftAngle;
        let dAngle = carYaw - _carCamPrevCarYaw;
        while (dAngle > Math.PI) dAngle -= Math.PI * 2;
        while (dAngle < -Math.PI) dAngle += Math.PI * 2;
        _carCamPrevCarYaw = carYaw;
        const step = dAngle * CAR_CAM_YAW_FOLLOW;
        if (Math.abs(step) < 1e-6) return;
        _carCamOffset.copy(carCameraFollow.position).sub(car.position);
        _carCamOffset.applyAxisAngle(_carCamYAxis, step);
        carCameraFollow.position.copy(car.position).add(_carCamOffset);
        syncCarFollowCamAnglesFromPosition(carCameraFollow);
        applyCarFollowCameraFromAngles();
      }

      function switchCarView(nextCam) {
        if (!car || nextCam === camera) return;
        const prevCam = camera;
        camera = nextCam;
        renderScenePass.camera = camera;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        controls.dispose();
        controls = createOrbitControls(camera);
        if (nextCam === carCamera) {
          getCarCameraLookAtPoint(_carMatrixLookAt);
          controls.target.copy(_carMatrixLookAt);
          syncCarOrbitCamAnglesFromPosition(nextCam);
          applyCarOrbitCameraFromAngles();
        } else {
          controls.target.copy(car.position);
        }
        if (nextCam === carCameraFollow) {
          syncCarFollowCamAnglesFromPosition(nextCam);
          if (prevCam === carCamera) {
            _carFollowCamDistance *= CAR_CAM_FOLLOW_ZOOM / 0.09;
            applyCarFollowCameraFromAngles();
          }
        }
        configureOrbitControlsForCarView(nextCam);
        syncCarCameraYawTracking();
        controls.update();
      }


      function placeCarViewCameras(lookAt, maxDim) {
        const zoom = 0.18;
        const followZoom = CAR_CAM_FOLLOW_ZOOM;
        const rotLeft = 1.15;
        const c = Math.cos(rotLeft);
        const s = Math.sin(rotLeft);

        const camOffsetX = maxDim * zoom;
        const camOffsetYOrbit = maxDim * 0.42 * zoom;
        const camOffsetZ = maxDim * zoom;
        carCamera.position.set(
          lookAt.x + camOffsetX * c - camOffsetZ * s,
          lookAt.y + camOffsetYOrbit,
          lookAt.z + camOffsetX * s + camOffsetZ * c,
        );
        carCamera.lookAt(lookAt);
        syncCarOrbitCamAnglesFromPosition(carCamera);

        const fOffsetX = maxDim * followZoom;
        const fOffsetY = maxDim * 0.72 * followZoom;
        const fOffsetZ = maxDim * followZoom;
        carCameraFollow.position.set(
          lookAt.x + fOffsetX * c - fOffsetZ * s,
          lookAt.y + fOffsetY,
          lookAt.z + fOffsetX * s + fOffsetZ * c,
        );
        carCameraFollow.lookAt(lookAt);
        syncCarFollowCamAnglesFromPosition(carCameraFollow);
      }
      const CAR_LIGHTS_BLOOM_LAYER = 11;
      const KITCHEN_LAMP_MAX = 6;
      carCamera.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
      carCameraFollow.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
      testCamera.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
      chaseCamera.layers.enable(CAR_LIGHTS_BLOOM_LAYER);

      /** SMAA + composer MSAA handle edges; skipping canvas MSAA saves a full multisampled resolve per pass. */
      const renderer = new THREE.WebGLRenderer({
        antialias: false,
        powerPreference: "high-performance",
        stencil: true,
      });
      renderer.setClearColor(0x1a1a1a, 1);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      /** Matches original office-scene rendering (high tier and above). */
      const MAX_DEVICE_PIXEL_RATIO = 2;
      const VISUAL_PARITY_TIER = 2;
      let _shelfJars = null; // kitchenShelfJars.js (declared early: applyPerformanceSettings reads it)
      let _startLights = null; // kitchenStartLights.js
      let _counterScreen = null; // kitchenCounterScreen.js
      let _trailingPlants = null; // kitchenTrailingPlants.js
      let _cupStacks = null; // kitchenCupStacks.js

      function getScreenPixelCount() {
        const dpr = window.devicePixelRatio || 1;
        return Math.round(window.innerWidth * window.innerHeight * dpr * dpr);
      }

      function useVisualParity() {
        return perfTierIndex >= VISUAL_PARITY_TIER;
      }

      let _kitchenWorldActive = false;
      const _KITCHEN_MAX_PIXEL_RATIO = 0.95;
      let _kitchenIdlePhysicsAccumulator = 0;

      function getRenderPixelRatio() {
        const dpr = window.devicePixelRatio || 1;
        let pr;
        if (useVisualParity()) {
          pr = Math.min(MAX_DEVICE_PIXEL_RATIO, Math.max(1, dpr));
        } else {
          pr =
            Math.min(maxDevicePixelRatio, Math.max(1, dpr)) * perfResolutionScale;
        }
        if (_kitchenWorldActive) {
          pr = Math.min(pr, _KITCHEN_MAX_PIXEL_RATIO);
        }
        return pr;
      }

      const PERF_TIER_PRESETS = [
        {
          name: "low",
          maxDpr: 1,
          resolutionScale: 0.72,
          smaa: false,
          sharpen: false,
          bloom: false,
          shadows: false,
          shadowMapSize: 0,
          reflection: false,
          composerMsaa: 0,
          physicsIterations: 10,
          maxCarSteps: 1,
          anisotropyCap: 2,
          bloomScale: 1,
          hdri: false,
        },
        {
          name: "medium",
          maxDpr: 1.25,
          resolutionScale: 0.85,
          smaa: true,
          sharpen: false,
          bloom: false,
          shadows: true,
          shadowMapSize: 256,
          reflection: true,
          reflectionTex: 96,
          composerMsaa: 0,
          physicsIterations: 14,
          maxCarSteps: 1,
          anisotropyCap: 4,
          bloomScale: 1,
          hdri: false,
        },
        {
          name: "high",
          maxDpr: 2,
          resolutionScale: 1,
          smaa: true,
          sharpen: true,
          bloom: false,
          shadows: true,
          shadowMapSize: 512,
          reflection: true,
          reflectionTex: 128,
          composerMsaa: 2,
          physicsIterations: 20,
          maxCarSteps: 2,
          anisotropyCap: 8,
          bloomScale: 1,
          hdri: false,
        },
        {
          name: "ultra",
          maxDpr: 2,
          resolutionScale: 1,
          smaa: true,
          sharpen: true,
          bloom: true,
          shadows: true,
          shadowMapSize: 512,
          reflection: true,
          reflectionTex: 256,
          composerMsaa: 2,
          physicsIterations: 20,
          maxCarSteps: 2,
          anisotropyCap: 16,
          bloomScale: 0.5,
          hdri: false,
        },
      ];

      function detectPerformanceProfile(renderer) {
        const ua = navigator.userAgent || "";
        const isMobile = /Android|iPhone|iPod|Mobile/i.test(ua);
        const isTablet = /iPad|Tablet/i.test(ua);
        const dpr = window.devicePixelRatio || 1;
        const screenPixels = Math.round(
          window.innerWidth * window.innerHeight * dpr * dpr,
        );
        const cores = navigator.hardwareConcurrency || 4;
        const memoryGb = navigator.deviceMemory || 4;
        const gl = renderer.getContext();
        const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
        let gpu = "unknown";
        if (debugInfo) {
          gpu = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || gpu;
        }
        const isIntegratedGpu =
          /Intel|UHD|Iris|Mali|Adreno 5|Adreno 6[0-3]|Powervr/i.test(gpu);
        const isAppleSilicon =
          /Apple M/i.test(gpu) || (/Mac/i.test(ua) && /Apple/i.test(gpu));
        const isDiscreteGpu =
          /NVIDIA|GeForce|RTX|GTX|Radeon RX|AMD Radeon/i.test(gpu);

        let score = 52;
        if (isMobile && !isTablet) score -= 28;
        if (isTablet) score -= 14;
        if (cores >= 8) score += 8;
        else if (cores <= 2) score -= 14;
        if (memoryGb >= 8) score += 10;
        else if (memoryGb <= 2) score -= 18;
        if (screenPixels > 4_500_000) score -= 18;
        else if (screenPixels > 2_800_000) score -= 10;
        else if (screenPixels < 1_000_000) score += 4;
        if (isIntegratedGpu) score -= 14;
        if (isAppleSilicon) score += 12;
        if (isDiscreteGpu) score += 16;
        if (renderer.capabilities.isWebGL2) score += 4;
        if (renderer.capabilities.maxTextureSize < 4096) score -= 12;

        let tier = 2;
        if (score < 24) tier = 0;
        else if (score < 42) tier = 1;
        else if (score < 62) tier = 2;
        else tier = 3;

        const storedTier = localStorage.getItem("kitchenScenePerfTier");
        if (storedTier != null) {
          const forced = parseInt(storedTier, 10);
          if (forced >= 0 && forced < PERF_TIER_PRESETS.length) tier = forced;
        }
        if (!isMobile && !isTablet && tier < VISUAL_PARITY_TIER) {
          tier = VISUAL_PARITY_TIER;
        }

        return {
          tier,
          score,
          gpu,
          isMobile,
          isTablet,
          screenPixels,
          cores,
          memoryGb,
          dpr,
          ...PERF_TIER_PRESETS[tier],
        };
      }

      let perfSettings = detectPerformanceProfile(renderer);
      let perfTierIndex = perfSettings.tier;
      let maxDevicePixelRatio = perfSettings.maxDpr;
      let perfResolutionScale = perfSettings.resolutionScale;
      let perfComposerMsaaSamples = perfSettings.composerMsaa;
      let perfMaxCarSteps = perfSettings.maxCarSteps;
      let perfAnisotropyCap = perfSettings.anisotropyCap;
      let perfBloomScale = perfSettings.bloomScale;
      let perfFpsEma = 60;
      let perfBadFpsFrames = 0;
      let perfBadgeHideTimer = 0;
      let _tabVisible = !document.hidden;
      const perfBadgeEl = document.getElementById("perfBadge");

      function getBloomRenderScale() {
        if (_kitchenWorldActive && sceneBloomEnabled) return 0.42;
        return sceneBloomEnabled && perfBloomScale > 0 && perfBloomScale < 1
          ? perfBloomScale
          : 1;
      }

      function updatePerfBadge(extraLine = "") {
        if (!perfBadgeEl) return;
        const pr = getRenderPixelRatio();
        const renderMp = (
          (window.innerWidth * window.innerHeight * pr * pr) /
          1_000_000
        ).toFixed(1);
        const mp = (getScreenPixelCount() / 1_000_000).toFixed(1);
        perfBadgeEl.textContent =
          `quality: ${perfSettings.name}\n` +
          `${Math.round(window.innerWidth)}×${Math.round(window.innerHeight)} @ ${(window.devicePixelRatio || 1).toFixed(1)}x (${mp}M px)\n` +
          `render: ${Math.round(window.innerWidth * pr)}×${Math.round(window.innerHeight * pr)} (${renderMp}M px)\n` +
          `cpu: ${perfSettings.cores}c · ram: ~${perfSettings.memoryGb}GB\n` +
          `gpu: ${perfSettings.gpu.slice(0, 42)}` +
          (extraLine ? `\n${extraLine}` : "");
        perfBadgeEl.classList.add("visible");
        perfBadgeHideTimer = 4;
      }

      function setPerformanceTier(tierIndex, reason = "") {
        perfTierIndex = THREE.MathUtils.clamp(
          tierIndex,
          0,
          PERF_TIER_PRESETS.length - 1,
        );
        perfSettings = {
          ...perfSettings,
          tier: perfTierIndex,
          ...PERF_TIER_PRESETS[perfTierIndex],
        };
        maxDevicePixelRatio = perfSettings.maxDpr;
        perfResolutionScale = perfSettings.resolutionScale;
        perfComposerMsaaSamples = perfSettings.composerMsaa;
        perfMaxCarSteps = perfSettings.maxCarSteps;
        perfAnisotropyCap = perfSettings.anisotropyCap;
        perfBloomScale = perfSettings.bloomScale;
        applyPerformanceSettings();
        console.info(
          "[perf] Quality tier:",
          perfSettings.name,
          reason ? `(${reason})` : "",
          perfSettings,
        );
        updatePerfBadge(reason);
      }

      function downgradePerformanceTier(reason = "low fps") {
        if (perfTierIndex <= VISUAL_PARITY_TIER) {
          if (
            perfTierIndex === VISUAL_PARITY_TIER &&
            perfSettings.isMobile &&
            perfFpsEma < 22
          ) {
            setPerformanceTier(VISUAL_PARITY_TIER - 1, reason);
          }
          return;
        }
        setPerformanceTier(perfTierIndex - 1, reason);
      }

      function applyWallShadowSettings(mapSize, enabled) {
        if (typeof wallShadowLight === "undefined") return;
        wallShadowLight.castShadow = !!enabled;
        if (!enabled) return;
        const baseSize = mapSize > 0 ? mapSize : 512;
        const wallMapSize = Math.min(Math.max(baseSize, 512), 1024);
        wallShadowLight.shadow.mapSize.set(wallMapSize, wallMapSize);
        wallShadowLight.shadow.radius =
          wallMapSize >= 1024 ? 22 : wallMapSize >= 512 ? 16 : 12;
        wallShadowLight.shadow.bias = -0.001;
        wallShadowLight.shadow.normalBias = 0.02;
      }

      function applyPerformanceSettings() {
        const kitchenUltraUsesHighSettings =
          _kitchenWorldActive && perfTierIndex > VISUAL_PARITY_TIER;
        const s = kitchenUltraUsesHighSettings
          ? {
              ...perfSettings,
              ...PERF_TIER_PRESETS[VISUAL_PARITY_TIER],
              name: perfSettings.name,
              tier: perfTierIndex,
            }
          : perfSettings;
        if (useVisualParity()) {
          renderer.shadowMap.enabled = true;
          if (typeof carShadowLight !== "undefined") {
            carShadowLight.castShadow = true;
            carShadowLight.shadow.mapSize.set(512, 512);
            carShadowLight.shadow.radius = 4;
          }
          if (typeof wallShadowLight !== "undefined") {
            applyWallShadowSettings(512, true);
          }
          if (typeof smaaPass !== "undefined") smaaPass.enabled = true;
          if (typeof sharpenPass !== "undefined") sharpenPass.enabled = false;
          sceneBloomEnabled = false;
        } else {
          renderer.shadowMap.enabled = s.shadows;
          if (typeof carShadowLight !== "undefined") {
            carShadowLight.castShadow = s.shadows;
            if (s.shadows && s.shadowMapSize > 0) {
              carShadowLight.shadow.mapSize.set(
                s.shadowMapSize,
                s.shadowMapSize,
              );
              carShadowLight.shadow.radius = s.shadowMapSize >= 512 ? 4 : 2;
            }
          }
          if (typeof wallShadowLight !== "undefined") {
            applyWallShadowSettings(s.shadowMapSize, s.shadows);
          }
          if (typeof smaaPass !== "undefined") smaaPass.enabled = s.smaa;
          if (typeof sharpenPass !== "undefined")
            sharpenPass.enabled = false;
          sceneBloomEnabled = false;
        }
        if (physicsWorld) {
          physicsWorld.solver.iterations = s.physicsIterations;
        }
        // The shelf jars' glass: transmission on high / ultra, cheap alpha glass below (kitchenShelfJars.js).
        if (_shelfJars) _shelfJars.setHighQuality(useVisualParity());
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
        if (typeof resize === "function") resize();
        if (typeof syncFinalComposerMsaaTargets === "function") {
          syncFinalComposerMsaaTargets();
        }
      }

      function applyPerformanceShadowPolicy(root) {
        if (!root || perfSettings.shadows) return;
        root.traverse((obj) => {
          if (obj.isMesh) {
            obj.castShadow = false;
            obj.receiveShadow = false;
          }
        });
      }

      function trackPerformanceFrame(rawDt) {
        if (!(rawDt > 0)) return;
        const fps = 1 / rawDt;
        perfFpsEma = perfFpsEma * 0.94 + fps * 0.06;
        if (perfBadgeHideTimer > 0) {
          perfBadgeHideTimer -= rawDt;
          if (perfBadgeHideTimer <= 0 && perfBadgeEl) {
            perfBadgeEl.classList.remove("visible");
          }
        }
        if (perfFpsEma < 28 && perfTierIndex > VISUAL_PARITY_TIER) {
          perfBadFpsFrames++;
          if (perfBadFpsFrames > 60) {
            downgradePerformanceTier(`~${Math.round(perfFpsEma)} fps`);
            perfBadFpsFrames = 0;
            perfFpsEma = 45;
          }
        } else if (
          perfFpsEma < 22 &&
          perfTierIndex === VISUAL_PARITY_TIER &&
          perfSettings.isMobile
        ) {
          perfBadFpsFrames++;
          if (perfBadFpsFrames > 120) {
            downgradePerformanceTier(`~${Math.round(perfFpsEma)} fps mobile`);
            perfBadFpsFrames = 0;
            perfFpsEma = 40;
          }
        } else {
          perfBadFpsFrames = Math.max(0, perfBadFpsFrames - 1);
        }
      }

      const canvas = renderer.domElement;
      canvas.tabIndex = 0;
      canvas.style.outline = "none";
      canvas.style.display = "block";
      getKitchenSceneMount().appendChild(canvas);
      canvas.addEventListener("pointerdown", () => {
        canvas.focus();
        if (camera === carCamera && car) {
          _carCam1PreserveView = false;
          _carCam1MatrixReturnActive = false;
          restoreCarOrbitCamRestPose(null);
        }
      });
      RectAreaLightUniformsLib.init();

      const carLightsBloomLayer = new THREE.Layers();
      carLightsBloomLayer.set(CAR_LIGHTS_BLOOM_LAYER);
      const darkBloomMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const darkBloomPointsMaterial = new THREE.PointsMaterial({
        color: 0x000000,
        size: 0.001,
      });
      const darkBloomSpriteMaterial = new THREE.SpriteMaterial({
        color: 0x000000,
        opacity: 0,
        transparent: true,
      });
      const darkBloomLineMaterial = new THREE.LineBasicMaterial({
        color: 0x000000,
      });
      const carBloomMaterialRestore = {};
      const _bloomDarkenMeshes = [];
      const _bloomDarkenPoints = [];
      const _bloomDarkenSprites = [];
      const _bloomDarkenLines = [];
      let _bloomDarkenListsDirty = true;

      function scheduleRebuildBloomDarkenLists() {
        _bloomDarkenListsDirty = true;
      }

      function rebuildBloomDarkenObjectLists() {
        _bloomDarkenListsDirty = false;
        const m = _bloomDarkenMeshes,
          p = _bloomDarkenPoints,
          sp = _bloomDarkenSprites,
          ln = _bloomDarkenLines;
        m.length = 0;
        p.length = 0;
        sp.length = 0;
        ln.length = 0;
        scene.traverse((obj) => {
          if (carLightsBloomLayer.test(obj.layers)) return;
          if (obj.userData && obj.userData.skipBloomDarken) return;
          if (obj.isMesh) m.push(obj);
          else if (obj.isPoints) p.push(obj);
          else if (obj.isSprite) sp.push(obj);
          else if (obj.isLine) ln.push(obj);
        });
      }

      function darkenCarBloomLists() {
        let i;
        for (i = 0; i < _bloomDarkenMeshes.length; i++) {
          const obj = _bloomDarkenMeshes[i];
          carBloomMaterialRestore[obj.uuid] = obj.material;
          obj.material = Array.isArray(obj.material)
            ? obj.material.map(() => darkBloomMaterial)
            : darkBloomMaterial;
        }
        for (i = 0; i < _bloomDarkenPoints.length; i++) {
          const obj = _bloomDarkenPoints[i];
          carBloomMaterialRestore[obj.uuid] = obj.material;
          obj.material = darkBloomPointsMaterial;
        }
        for (i = 0; i < _bloomDarkenSprites.length; i++) {
          const obj = _bloomDarkenSprites[i];
          carBloomMaterialRestore[obj.uuid] = obj.material;
          obj.material = darkBloomSpriteMaterial;
        }
        for (i = 0; i < _bloomDarkenLines.length; i++) {
          const obj = _bloomDarkenLines[i];
          carBloomMaterialRestore[obj.uuid] = obj.material;
          obj.material = Array.isArray(obj.material)
            ? obj.material.map(() => darkBloomLineMaterial)
            : darkBloomLineMaterial;
        }
      }

      function restoreCarBloomLists() {
        let i;
        for (i = 0; i < _bloomDarkenMeshes.length; i++) {
          const obj = _bloomDarkenMeshes[i];
          const id = obj.uuid;
          if (carBloomMaterialRestore[id]) {
            obj.material = carBloomMaterialRestore[id];
            delete carBloomMaterialRestore[id];
          }
        }
        for (i = 0; i < _bloomDarkenPoints.length; i++) {
          const obj = _bloomDarkenPoints[i];
          const id = obj.uuid;
          if (carBloomMaterialRestore[id]) {
            obj.material = carBloomMaterialRestore[id];
            delete carBloomMaterialRestore[id];
          }
        }
        for (i = 0; i < _bloomDarkenSprites.length; i++) {
          const obj = _bloomDarkenSprites[i];
          const id = obj.uuid;
          if (carBloomMaterialRestore[id]) {
            obj.material = carBloomMaterialRestore[id];
            delete carBloomMaterialRestore[id];
          }
        }
        for (i = 0; i < _bloomDarkenLines.length; i++) {
          const obj = _bloomDarkenLines[i];
          const id = obj.uuid;
          if (carBloomMaterialRestore[id]) {
            obj.material = carBloomMaterialRestore[id];
            delete carBloomMaterialRestore[id];
          }
        }
      }

      const carBloomPassBackground = new THREE.Color(0x000000);

      /** Bloom mask: no ACES (emissive survives threshold). Black background so brightMode sky is not bloomed. */
      function renderCarLightsBloomComposer() {
        if (_bloomDarkenListsDirty) rebuildBloomDarkenObjectLists();
        const prevTm = renderer.toneMapping;
        const prevExp = renderer.toneMappingExposure;
        const prevBg = scene.background;
        scene.background = carBloomPassBackground;

        renderer.toneMapping = THREE.NoToneMapping;
        renderer.toneMappingExposure = 1;
        darkenCarBloomLists();
        // The intro portal's tunnel and the car inside it are stencil-masked: not in this pass (no stencil here).
        const portalMasked = _kPortal.masked && _kPortal.masked.visible;
        const portalCopy = _kPortal.carCopy && _kPortal.carCopy.visible;
        if (portalMasked) _kPortal.masked.visible = false;
        if (portalCopy) _kPortal.carCopy.visible = false;
        bloomComposer.render();
        if (portalMasked) _kPortal.masked.visible = true;
        if (portalCopy) _kPortal.carCopy.visible = true;
        restoreCarBloomLists();

        scene.background = prevBg;
        renderer.toneMapping = prevTm;
        renderer.toneMappingExposure = prevExp;
      }

      const renderScenePass = new RenderPass(scene, camera);
      const carLightsBloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.35,
        0.08,
        0.72,
      );
      carLightsBloomPass.highPassUniforms.smoothWidth.value = 0.03;
      carLightsBloomPass.threshold = 0.72;

      const bloomComposer = new EffectComposer(renderer);
      bloomComposer.renderToScreen = false;
      bloomComposer.addPass(renderScenePass);
      bloomComposer.addPass(carLightsBloomPass);

      const carBloomMixPass = new ShaderPass(
        new THREE.ShaderMaterial({
          uniforms: {
            baseTexture: { value: null },
            bloomTexture: { value: bloomComposer.renderTarget2.texture },
            bloomIntensity: { value: 0.16 },
          },
          vertexShader: `
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform sampler2D baseTexture;
            uniform sampler2D bloomTexture;
            uniform float bloomIntensity;
            varying vec2 vUv;
            void main() {
              vec4 base = texture2D(baseTexture, vUv);
              vec4 b = texture2D(bloomTexture, vUv);
              gl_FragColor = vec4(base.rgb + b.rgb * bloomIntensity, base.a);
            }
          `,
        }),
        "baseTexture",
      );
      carBloomMixPass.needsSwap = true;
      const SCENE_BLOOM_MIX_INTENSITY =
        carBloomMixPass.material.uniforms.bloomIntensity.value;
      let sceneBloomEnabled = false;
      carBloomMixPass.material.uniforms.bloomIntensity.value = 0;

      const _smaaPr = getRenderPixelRatio();
      const smaaPass = new SMAAPass(
        Math.max(2, Math.round(window.innerWidth * _smaaPr)),
        Math.max(2, Math.round(window.innerHeight * _smaaPr)),
      );

      const sharpenPixelSize = new THREE.Vector2(1, 1);
      const sharpenPass = new ShaderPass(
        new THREE.ShaderMaterial({
          uniforms: {
            tDiffuse: { value: null },
            amount: { value: 0.168 },
            pixelSize: { value: sharpenPixelSize },
          },
          vertexShader: `
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform float amount;
            uniform vec2 pixelSize;
            varying vec2 vUv;
            void main() {
              vec4 c = texture2D(tDiffuse, vUv);
              vec3 rgb = c.rgb;
              vec3 blur = (
                texture2D(tDiffuse, vUv + vec2(-pixelSize.x, 0.0)).rgb +
                texture2D(tDiffuse, vUv + vec2(pixelSize.x, 0.0)).rgb +
                texture2D(tDiffuse, vUv + vec2(0.0, -pixelSize.y)).rgb +
                texture2D(tDiffuse, vUv + vec2(0.0, pixelSize.y)).rgb
              ) * 0.25;
              vec3 detail = rgb - blur;
              gl_FragColor = vec4(rgb + detail * amount, c.a);
            }
          `,
        }),
        "tDiffuse",
      );
      sharpenPass.needsSwap = true;

      const finalComposer = new EffectComposer(renderer);
      const outputPass = new OutputPass();
      finalComposer.addPass(renderScenePass);
      finalComposer.addPass(carBloomMixPass);
      finalComposer.addPass(smaaPass);
      finalComposer.addPass(sharpenPass);
      finalComposer.addPass(outputPass);
      // Selective bloom by threshold (shared with the office): the cars' light bars
      // (lightBar1 and its copies, emissive 18) are the only parts above it.
      const kitchenBloom = addThresholdBloom({ THREE, composer: finalComposer, afterPass: renderScenePass });
      /**
       * A soft glow around the strip lights peselLight1..34 only: a bloom of their own (thresholdBloom.js addBloomGroup),
       * after the main one, so nothing else glows more.
       */
      const PESEL_BLOOM = {
        /** How strong the glow is (dark mode). (On the coverage source: about 2.2× the energy of the old pixel source, so 0.14 ≈ 60% of the earlier 0.5.) */
        strength: 0.14,
        /** How far it spreads (0 tight → 1 wide; mixes the blur's mip levels). Near 1 the wide, soft levels lead,
         *  so the glow fades out round instead of hugging the strip's rectangle. */
        radius: 0.85,
        /** Brightness (brightest colour channel, HDR) where the glow starts, and the soft knee above it (full glow at threshold + knee). */
        threshold: 0.6,
        knee: 0.9,
        /** Bloom resolution vs. the drawing buffer (the pass halves it once more inside: 1 = the glow starts at half the screen;
         *  lower gets blocky on the thin strips). */
        resolutionScale: 1,
        /** Bright mode: the glow × this (the room is lit, the strips are plain white). */
        brightModeScale: 0.35,
      };
      // getCamera: the strips are also drawn into a multisampled coverage image with the scene's camera, so their thin
      // shapes don't make the glow crawl and pulse as the camera moves (see addBloomGroup).
      const peselBloom = addBloomGroup({
        THREE,
        composer: finalComposer,
        afterPass: kitchenBloom.pass,
        settings: PESEL_BLOOM,
        getCamera: () => renderScenePass.camera,
      });
      // Slow-motion vignette (edge darkening): last, off unless a jump is slowed.
      const jumpVignettePass = new ShaderPass({
        uniforms: { tDiffuse: { value: null }, uStrength: { value: 0 } },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float uStrength;
          varying vec2 vUv;
          void main() {
            vec4 c = texture2D(tDiffuse, vUv);
            float d = length((vUv - 0.5) * vec2(1.0, 0.85)) * 1.45;
            float v = 1.0 - uStrength * smoothstep(0.45, 1.05, d);
            gl_FragColor = vec4(c.rgb * v, c.a);
          }`,
      });
      jumpVignettePass.enabled = false;
      finalComposer.addPass(jumpVignettePass);
      // Dev-only (?perf in `npm run dev`): handles for profiling. Compiled out of production.
      if (
        import.meta.env.DEV &&
        typeof location !== "undefined" &&
        new URLSearchParams(location.search).has("perf")
      ) {
        window.__kitchenPerf = {
          renderer, scene, finalComposer, bloomComposer, smaaPass, sharpenPass,
          get world() { return physicsWorld; },
          get props() { return _kitchenProps; },
        };
      }

      smaaPass.enabled = perfSettings.smaa;
      sharpenPass.enabled = false;
      sceneBloomEnabled = false;
      carBloomMixPass.enabled = false;

      /** Composer RT needs stencil for kitchen lamp pools; optional MSAA on WebGL2. */
      function syncFinalComposerMsaaTargets() {
        const buf = new THREE.Vector2();
        renderer.getDrawingBufferSize(buf);
        const effW = Math.max(2, Math.floor(buf.x));
        const effH = Math.max(2, Math.floor(buf.y));
        let samples = 0;
        if (renderer.capabilities.isWebGL2 && !_kitchenWorldActive) {
          samples = Math.min(
            perfComposerMsaaSamples,
            Math.max(0, renderer.capabilities.maxSamples || 0),
          );
          if (samples < 2) samples = 0;
        }
        const cur = finalComposer.renderTarget1;
        if (
          cur &&
          cur.width === effW &&
          cur.height === effH &&
          cur.samples === samples
        ) {
          return;
        }
        try {
          const rtOpts = {
            type: THREE.HalfFloatType,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: true,
            stencilBuffer: true,
          };
          if (samples >= 2) rtOpts.samples = samples;
          const rt1 = new THREE.WebGLRenderTarget(effW, effH, rtOpts);
          rt1.texture.name = "EffectComposer.rt1";
          finalComposer.reset(rt1);
        } catch (err) {
          console.warn("Final composer HalfFloat RT unavailable:", err);
          try {
            const rt1 = new THREE.WebGLRenderTarget(effW, effH, {
              minFilter: THREE.LinearFilter,
              magFilter: THREE.LinearFilter,
              depthBuffer: true,
              stencilBuffer: true,
            });
            rt1.texture.name = "EffectComposer.rt1";
            finalComposer.reset(rt1);
          } catch (err2) {
            console.warn("Final composer render target unavailable:", err2);
          }
        }
      }

      const TEXTURE_MAP_KEYS_FOR_ANISOTROPY = [
        "map",
        "normalMap",
        "roughnessMap",
        "metalnessMap",
        "emissiveMap",
        "aoMap",
        "alphaMap",
        "bumpMap",
        "displacementMap",
        "lightMap",
        "clearcoatNormalMap",
        "transmissionMap",
        "thicknessMap",
      ];
      function applyTextureAnisotropyToRoot(root) {
        const maxA = Math.min(
          perfAnisotropyCap,
          renderer.capabilities.getMaxAnisotropy(),
        );
        if (maxA <= 1) return;
        root.traverse((obj) => {
          if (!obj.isMesh) return;
          const mats = Array.isArray(obj.material)
            ? obj.material
            : [obj.material];
          for (let mi = 0; mi < mats.length; mi++) {
            const m = mats[mi];
            if (!m) continue;
            for (let ki = 0; ki < TEXTURE_MAP_KEYS_FOR_ANISOTROPY.length; ki++) {
              const t = m[TEXTURE_MAP_KEYS_FOR_ANISOTROPY[ki]];
              if (t && t.isTexture) t.anisotropy = maxA;
            }
          }
        });
      }

      // HDRI environment (image-based lighting + reflections; background stays dark/bright mode)
      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      pmremGenerator.compileEquirectangularShader();
      function buildNeutralEnvironmentTexture() {
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
      }

      function createOrbitControls(forCamera) {
        const c = new OrbitControls(forCamera, renderer.domElement);
        c.enableDamping = true;
        c.dampingFactor = 0.05;
        c.enablePan = true;
        c.panSpeed = 1.2;
        c.screenSpacePanning = true;
        return c;
      }
      let controls = createOrbitControls(camera);
      controls.target.set(0, 0, 0);

      // Drag the camera with the mouse (shared, cameraDrag.js): an offset round the car,
      // springing back on release; only while racing, on the gameplay cameras.
      let _kitchenDragRoot = null;
      const _kitchenDragTarget = new THREE.Vector3();
      const kitchenCameraDrag = createCameraDrag({
        THREE,
        element: renderer.domElement,
        scene: "kitchen",
        isEnabled: () =>
          _kitchenSceneRendering &&
          _kIntro.state === "done" &&
          _racePhase === "racing" &&
          (camera === carCamera || camera === carCameraFollow) &&
          !(_jumpFx.active || _jumpFx.w > 0),
        collisionObjects: () => (_kitchenDragRoot ? [_kitchenDragRoot] : []),
        ignore: (obj) => {
          for (let x = obj; x; x = x.parent) if (x === car) return true;
          return false;
        },
      });

      // Lights: lightBlend (0→1) drives dark/bright mode (Key O / Key P).
      const ambient = new THREE.AmbientLight(0x445566, 0.65);
      scene.add(ambient);
      const hemisphere = new THREE.HemisphereLight(0x88aaff, 0xcc88aa, 0.5);
      scene.add(hemisphere);
      let carShadowPlane = null;

      const dirPink = new THREE.DirectionalLight(0xee99bb, 0.5);
      dirPink.position.set(35, 45, 25);
      scene.add(dirPink);
      const dirBlue = new THREE.DirectionalLight(0x5588dd, 0.9);
      dirBlue.position.set(-35, 40, -25);
      scene.add(dirBlue);

      const carShadowLight = new THREE.DirectionalLight(0xffffff, 0.05);
      carShadowLight.position.set(3, 20, 2);
      carShadowLight.castShadow = true;
      carShadowLight.shadow.mapSize.width = 512;
      carShadowLight.shadow.mapSize.height = 512;
      carShadowLight.shadow.camera.near = 0.5;
      carShadowLight.shadow.camera.far = 50;
      carShadowLight.shadow.camera.left = -6;
      carShadowLight.shadow.camera.right = 6;
      carShadowLight.shadow.camera.top = 6;
      carShadowLight.shadow.camera.bottom = -6;
      carShadowLight.shadow.bias = -0.002;
      carShadowLight.shadow.normalBias = 0.04;
      carShadowLight.shadow.radius = 4;
      scene.add(carShadowLight);
      scene.add(carShadowLight.target);
      applyPerformanceSettings();
      updatePerfBadge("auto-detected");
      const dirFillPink = new THREE.DirectionalLight(0xdd88aa, 0.25);
      dirFillPink.position.set(-15, 25, 30);
      scene.add(dirFillPink);
      const dirFillBlue = new THREE.DirectionalLight(0x77aaff, 0.45);
      dirFillBlue.position.set(20, 30, -20);
      scene.add(dirFillBlue);
      const pointPink = new THREE.PointLight(0xdd88aa, 0.3, 120);
      pointPink.position.set(15, 12, 10);
      scene.add(pointPink);
      const pointBlue = new THREE.PointLight(0x5588dd, 0.5, 120);
      pointBlue.position.set(-15, 12, -10);
      scene.add(pointBlue);

      const warmKeyLight = new THREE.DirectionalLight(0xfff0dd, 0);
      warmKeyLight.position.set(10, 50, 20);
      scene.add(warmKeyLight);
      const warmFillLight = new THREE.PointLight(0xffe8cc, 0, 200);
      warmFillLight.position.set(-10, 30, 15);
      scene.add(warmFillLight);

      const darkBlueLight = new THREE.PointLight(0x3366cc, 0, 150);
      darkBlueLight.position.set(0, 20, 0);
      scene.add(darkBlueLight);
      const darkBlueFill = new THREE.DirectionalLight(0x4488ee, 0);
      darkBlueFill.position.set(-10, 30, 15);
      scene.add(darkBlueFill);
      const darkPinkLight = new THREE.PointLight(0xff44aa, 0, 150);
      darkPinkLight.position.set(15, 18, -10);
      scene.add(darkPinkLight);
      const darkPurpleFill = new THREE.DirectionalLight(0x8844cc, 0);
      darkPurpleFill.position.set(10, 25, -20);
      scene.add(darkPurpleFill);
      /** Lights only one of the light modes uses (hidden at intensity 0: see the light blend). */
      const _modeOnlyLights = [warmKeyLight, warmFillLight, darkBlueLight, darkPinkLight];
      // Performance: the six coloured directional fills are drawn as two lights, grouped by where they come from (the
      // three from the room's front, +z, and the three from the back). The originals keep their colours / intensities
      // from the light blend (dark / bright mode) but are hidden; after every blend each merged light takes its group's
      // summed colour × intensity, along the group's intensity-weighted mean direction (updateMergedDirectionalFills).
      // Grouped by direction (not hue) so front-facing surfaces (cabinet doors, the counter front, the table's side)
      // keep their light: by hue the mean directions came out nearly straight down and those went darker. Measured:
      // countdown 27.0 → 22.4 ms, race camera 33.4 → 29.1 ms, chase camera 14.8 → 11.8 ms (4 lights fewer).
      const KITCHEN_MERGED_FILLS = [
        { name: "kitchenMergedFillFront", lights: [dirPink, dirFillPink, darkBlueFill] },
        { name: "kitchenMergedFillBack", lights: [dirBlue, dirFillBlue, darkPurpleFill] },
      ];
      for (const G of KITCHEN_MERGED_FILLS) {
        G.light = new THREE.DirectionalLight(0xffffff, 0);
        G.light.name = G.name;
        scene.add(G.light);
        for (const l of G.lights) l.visible = false;
      }
      const _mfDir = new THREE.Vector3();
      const _mfSum = new THREE.Vector3();
      const _mfCol = new THREE.Color();
      function updateMergedDirectionalFills() {
        for (const G of KITCHEN_MERGED_FILLS) {
          _mfSum.set(0, 0, 0);
          _mfCol.setRGB(0, 0, 0);
          for (const l of G.lights) {
            const I = l.intensity;
            if (!(I > 0)) continue;
            _mfCol.r += l.color.r * I;
            _mfCol.g += l.color.g * I;
            _mfCol.b += l.color.b * I;
            const w = I * (0.2126 * l.color.r + 0.7152 * l.color.g + 0.0722 * l.color.b);
            _mfDir.subVectors(l.position, l.target.position).normalize();
            _mfSum.addScaledVector(_mfDir, w);
          }
          const m = Math.max(_mfCol.r, _mfCol.g, _mfCol.b);
          G.light.intensity = m;
          if (m > 0) G.light.color.setRGB(_mfCol.r / m, _mfCol.g / m, _mfCol.b / m);
          if (_mfSum.lengthSq() > 1e-12) G.light.position.copy(_mfSum.normalize().multiplyScalar(50));
        }
      }

      const darkMode = {
        background: 0x1a1a1a,
        ambient: { color: 0x4a4460, intensity: 0.65 },
        hemisphere: { sky: 0x88aaff, ground: 0xdd88aa, intensity: 0.5 },
        dirPink: { color: 0xee77aa, intensity: 0.7 },
        dirBlue: { color: 0x5588dd, intensity: 0.9 },
        dirFillPink: { color: 0xdd88aa, intensity: 0.4 },
        dirFillBlue: { color: 0x77aaff, intensity: 0.45 },
        pointPink: { color: 0xee66aa, intensity: 0.5 },
        pointBlue: { color: 0x5588dd, intensity: 0.5 },
        warmKey: { color: 0xfff0dd, intensity: 0 },
        warmFill: { color: 0xffe8cc, intensity: 0 },
      };
      // Office preset is captured at startup so we can switch worlds back and forth.
      // Kitchen has a warmer, cozier evening vibe.
      const _darkModeKitchen = {
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
      };
      // When > 0, the legacy dark-only fill lights (darkBlue/darkPink/darkPurple) are scaled by this.
      // Kitchen world sets this to 0 to mute them in dark mode.
      let _legacyDarkLightsScale = 1;
      function applyDarkModePreset(src) {
        for (const k of Object.keys(src)) {
          const v = src[k];
          if (v && typeof v === "object") {
            if (!darkMode[k]) darkMode[k] = {};
            Object.assign(darkMode[k], v);
          } else {
            darkMode[k] = v;
          }
        }
        try { applyLightBlend(lightBlend); } catch (e) {}
      }
      // Lights that should ONLY appear in dark mode (intensity = baseIntensity * (1-lightBlend)).
      const _darkModeOnlyLights = [];
      // Meshes whose emissiveIntensity is lerped between strong (dark) and gentle (bright).
      // Each entry: { mesh, darkIntensity, brightIntensity }.
      const _peselLightMeshes = [];
      /**
       * soab1 / soab2 (new in ul-kitchen25): matte pastel plastic, no shine or
       * reflections. In dark mode the kitchen's lights are very dim and blue,
       * so they light themselves a little in their own colour (emissive, far
       * below the bloom threshold) to stay pastel instead of turning grey (and a
       * little in bright mode, whose warm dimmed lights made them look dusty).
       */
      const KITCHEN_SOAP_PASTEL = {
        soab1: 0xa9d4f2, // pastel light blue
        soab2: 0xf5bfd2, // pastel pink
        roughness: 0.9,
        metalness: 0,
        envMapIntensity: 0.12,
        selfLight: { dark: 0.32, bright: 0.22 },
      };
      const _kitchenPastelMats = [];
      /**
       * coffeeGrill (the coffee machine's drip-tray grill, a flat plate): shiny metal (the machine's chrome:
       * coffeeStrok / coffeeHandle / coffeeLegs) perforated with small round holes in a staggered (hex) grid, drawn
       * dark (with a little depth from a bump), mapped by the plate's own size so they stay round, inside a solid
       * border (`edgeMargin`: only whole holes, the pattern centred on the plate).
       */
      const KITCHEN_COFFEE_GRILL = {
        pitch: 0.24, // distance between neighbouring holes (the grill's units; it's 5.64 × 4.01)
        holeRadius: 0.075, // a hole's radius (same units)
        edgeMargin: 0.35, // solid metal between the outermost holes and the plate's edges (same units)
        holeColor: 0x080808, // inside a hole (dark: the tray under it)
        metalness: 1.0,
        roughness: 0.22, // shiny, its reflection a little soft
        envMapIntensity: 1.0, // its own reflection (the kitchen's neutral grey gradient; the scene has none to reflect)
        bumpScale: 0.8, // the holes' depth (bump strength)
        pxPerUnit: 360, // texture pixels per unit of the plate
      };
      /** The grill's perforation over the whole plate (w × d units): white metal, dark round holes inside the border. */
      function makeCoffeeGrillTexture(w, d) {
        const G = KITCHEN_COFFEE_GRILL;
        const cw = Math.min(4096, Math.round(w * G.pxPerUnit));
        const k = cw / w; // pixels per unit
        const ch = Math.round(d * k);
        const c = document.createElement("canvas");
        c.width = cw;
        c.height = ch;
        const x = c.getContext("2d");
        x.fillStyle = "#ffffff";
        x.fillRect(0, 0, cw, ch);
        x.fillStyle = "#" + new THREE.Color(G.holeColor).getHexString();
        // Hex grid: rows `rowStep` apart, every other row one hole shorter (centred: shifted half a pitch); only holes
        // fully inside the border.
        const rowStep = (G.pitch * Math.sqrt(3)) / 2;
        const inner = G.edgeMargin + G.holeRadius; // a hole's centre at least this far from an edge
        const rows = Math.floor((d - 2 * inner) / rowStep) + 1;
        const cols = Math.floor((w - 2 * inner) / G.pitch) + 1;
        const y0 = (d - (rows - 1) * rowStep) / 2; // the pattern centred
        for (let r = 0; r < rows; r++) {
          const n = r % 2 ? cols - 1 : cols;
          const x0 = (w - (n - 1) * G.pitch) / 2;
          for (let q = 0; q < n; q++) {
            x.beginPath();
            x.arc((x0 + q * G.pitch) * k, (y0 + r * rowStep) * k, G.holeRadius * k, 0, Math.PI * 2);
            x.fill();
          }
        }
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = Math.min(perfAnisotropyCap, renderer.capabilities.getMaxAnisotropy());
        return t;
      }
      const _shelfDownLights = [];
      const _mainLightDownPoints = [];
      const brightMode = {
        background: 0xe8e4de,
        ambient: { color: 0xfff4e8, intensity: 0.55 },
        hemisphere: { sky: 0xd8d0c0, ground: 0xf5e0c0, intensity: 0.35 },
        dirPink: { color: 0xffe8d0, intensity: 0.22 },
        dirBlue: { color: 0xccddee, intensity: 0.2 },
        dirFillPink: { color: 0xfff0e0, intensity: 0.15 },
        dirFillBlue: { color: 0xdde8f0, intensity: 0.12 },
        pointPink: { color: 0xffe8d0, intensity: 0.08 },
        pointBlue: { color: 0xccddee, intensity: 0.06 },
        warmKey: { color: 0xfff0dd, intensity: 0.6 },
        warmFill: { color: 0xffe8cc, intensity: 0.35 },
      };
      /**
       * Bright mode's HDRI environment (lighting and reflections): Poly Haven's "Lebombo" (CC0, an indoor room
       * with daylight windows), 1k Radiance .hdr (1.48 MB), prefiltered once (PMREM, 256 px cube faces, half
       * float). Bright mode only: dark mode has no environment, as before (none loaded or rendered: it's freed
       * when the room goes dark). It's the scene's environment for every material without its own, and it
       * replaces the own environment of those that have one of the same size (the glass jars and their kin: no
       * shader rebuild). `intensity` × each material's own reflection strength (envMapIntensity, capped at
       * `maxStrength`), faded with the light blend. Switching it on or off rebuilds most shaders: in the intro that happens under the loader
       * (on) and in the black of the cut after the first shot (off).
       */
      const KITCHEN_BRIGHT_HDRI = {
        url: kitchenAsset("textures/hdri/lebombo_1k.hdr"),
        intensity: 0.35,
        /** Reflection strengths above this (materials tuned for the old neutral gradient, e.g. the metallic table top
         *  at 2.8) are capped here before the intensity: the bright room's reflection turned them white. */
        maxStrength: 1,
      };
      const _kHdri = { tex: null, rt: null, loading: null, on: false, hold: false, mats: new Map(), loadMs: 0 };
      /** Loads and prefilters the HDRI (once; again after it was freed). */
      function _kHdriLoad() {
        if (_kHdri.tex) return Promise.resolve(_kHdri.tex);
        if (_kHdri.loading) return _kHdri.loading;
        const t0 = performance.now();
        _kHdri.loading = new RGBELoader()
          .setDataType(THREE.HalfFloatType)
          .loadAsync(KITCHEN_BRIGHT_HDRI.url)
          .then((eq) => {
            eq.mapping = THREE.EquirectangularReflectionMapping;
            const gen = new THREE.PMREMGenerator(renderer);
            const rt = gen.fromEquirectangular(eq);
            eq.dispose();
            gen.dispose();
            _kHdri.rt = rt;
            _kHdri.tex = rt.texture;
            _kHdri.loadMs = performance.now() - t0;
            _kHdri.loading = null;
            try { applyLightBlend(lightBlend); } catch (e) {} // bright already: on now
            return rt.texture;
          })
          .catch((e) => {
            console.warn("[kitchen] bright-mode HDRI failed (lights only):", e);
            _kHdri.loading = null;
            return null;
          });
        return _kHdri.loading;
      }
      /** The HDRI at strength k (the light blend: 0 dark → 1 bright); on while k > 0 (or held), off and freed at 0. */
      function _kHdriSet(k) {
        const want = k > 0 || _kHdri.hold;
        if (want && !_kHdri.tex) {
          if (k > 0) _kHdriLoad(); // applied when it's ready
          return;
        }
        if (want && !_kHdri.on) {
          const tex = _kHdri.tex;
          const h = tex.image && tex.image.height;
          scene.environment = tex;
          scene.traverse((o) => {
            if (!o.material) return;
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
              if (!m || !m.isMeshStandardMaterial || _kHdri.mats.has(m)) continue;
              const own = m.envMap;
              const swap = !!own && own.mapping === THREE.CubeUVReflectionMapping && own.image && own.image.height === h;
              if (own && !swap) continue; // its own environment of another kind / size: kept
              _kHdri.mats.set(m, { base: m.envMapIntensity, own, swap });
              if (swap) m.envMap = tex;
            }
          });
          _kHdri.on = true;
        }
        if (_kHdri.on && !want) {
          for (const [m, r] of _kHdri.mats) {
            m.envMapIntensity = r.base;
            if (r.swap) m.envMap = r.own;
          }
          _kHdri.mats.clear();
          scene.environment = null;
          _kHdri.on = false;
          _kHdri.rt.dispose(); // not kept in dark mode
          _kHdri.rt = _kHdri.tex = null;
          return;
        }
        if (_kHdri.on) {
          for (const [m, r] of _kHdri.mats) {
            m.envMapIntensity = r.swap
              ? r.base // the room it reflected, swapped for the HDRI, at its own strength
              : Math.min(r.base, KITCHEN_BRIGHT_HDRI.maxStrength) * KITCHEN_BRIGHT_HDRI.intensity * k;
          }
        }
      }
      /**
       * mainTableSidePlane in bright mode: white. Not metallic (metal only tinted its reflections: it read grey),
       * and a little white self-light, as the end panel faces away from the bright mode's lights (it read grey
       * too). Dark mode keeps its own colour / glow / metalness (set where its material is made); the light blend
       * goes between the two.
       */
      const KITCHEN_TABLE_SIDE_BRIGHT = { color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.32, metalness: 0 };
      const _tableSideBrightColor = new THREE.Color(KITCHEN_TABLE_SIDE_BRIGHT.color);
      const _tableSideBrightEmissive = new THREE.Color(KITCHEN_TABLE_SIDE_BRIGHT.emissive);
      /**
       * mainTablePlate in bright mode: the same material (it has no image texture: a flat colour with the
       * kitchen's lighting patches) in white. Dark mode keeps its own colour (set where its material is made).
       */
      const KITCHEN_TABLE_PLATE_BRIGHT = { color: 0xffffff };
      const _tablePlateBrightColor = new THREE.Color(KITCHEN_TABLE_PLATE_BRIGHT.color);
      let lightBlend = 0;
      let lightBlendTarget = 0;
      const LIGHT_FADE_DURATION = 0.2;
      const _cDark = new THREE.Color();
      const _cBright = new THREE.Color();
      function applyLightBlend(b) {
        const _kitchenBrightScale = _kitchenWorldActive ? 0.62 : 1;
        const _blendBright = (darkV, brightV) =>
          darkV + (brightV * _kitchenBrightScale - darkV) * b;
        _cDark.setHex(darkMode.background);
        _cBright.setHex(brightMode.background);
        scene.background.lerpColors(_cDark, _cBright, b);
        _cDark.setHex(darkMode.ambient.color);
        _cBright.setHex(brightMode.ambient.color);
        ambient.color.lerpColors(_cDark, _cBright, b);
        ambient.intensity = _blendBright(
          darkMode.ambient.intensity,
          brightMode.ambient.intensity,
        );
        _cDark.setHex(darkMode.hemisphere.sky);
        _cBright.setHex(brightMode.hemisphere.sky);
        hemisphere.color.lerpColors(_cDark, _cBright, b);
        _cDark.setHex(darkMode.hemisphere.ground);
        _cBright.setHex(brightMode.hemisphere.ground);
        hemisphere.groundColor.lerpColors(_cDark, _cBright, b);
        hemisphere.intensity = _blendBright(
          darkMode.hemisphere.intensity,
          brightMode.hemisphere.intensity,
        );
        _cDark.setHex(darkMode.dirPink.color);
        _cBright.setHex(brightMode.dirPink.color);
        dirPink.color.lerpColors(_cDark, _cBright, b);
        dirPink.intensity = _blendBright(
          darkMode.dirPink.intensity,
          brightMode.dirPink.intensity,
        );
        _cDark.setHex(darkMode.dirBlue.color);
        _cBright.setHex(brightMode.dirBlue.color);
        dirBlue.color.lerpColors(_cDark, _cBright, b);
        dirBlue.intensity = _blendBright(
          darkMode.dirBlue.intensity,
          brightMode.dirBlue.intensity,
        );
        _cDark.setHex(darkMode.dirFillPink.color);
        _cBright.setHex(brightMode.dirFillPink.color);
        dirFillPink.color.lerpColors(_cDark, _cBright, b);
        dirFillPink.intensity = _blendBright(
          darkMode.dirFillPink.intensity,
          brightMode.dirFillPink.intensity,
        );
        _cDark.setHex(darkMode.dirFillBlue.color);
        _cBright.setHex(brightMode.dirFillBlue.color);
        dirFillBlue.color.lerpColors(_cDark, _cBright, b);
        dirFillBlue.intensity = _blendBright(
          darkMode.dirFillBlue.intensity,
          brightMode.dirFillBlue.intensity,
        );
        _cDark.setHex(darkMode.pointPink.color);
        _cBright.setHex(brightMode.pointPink.color);
        pointPink.color.lerpColors(_cDark, _cBright, b);
        pointPink.intensity = _blendBright(
          darkMode.pointPink.intensity,
          brightMode.pointPink.intensity,
        );
        _cDark.setHex(darkMode.pointBlue.color);
        _cBright.setHex(brightMode.pointBlue.color);
        pointBlue.color.lerpColors(_cDark, _cBright, b);
        pointBlue.intensity = _blendBright(
          darkMode.pointBlue.intensity,
          brightMode.pointBlue.intensity,
        );
        _cDark.setHex(darkMode.warmKey.color);
        _cBright.setHex(brightMode.warmKey.color);
        warmKeyLight.color.lerpColors(_cDark, _cBright, b);
        warmKeyLight.intensity = _blendBright(
          darkMode.warmKey.intensity,
          brightMode.warmKey.intensity,
        );
        _cDark.setHex(darkMode.warmFill.color);
        _cBright.setHex(brightMode.warmFill.color);
        warmFillLight.color.lerpColors(_cDark, _cBright, b);
        warmFillLight.intensity = _blendBright(
          darkMode.warmFill.intensity,
          brightMode.warmFill.intensity,
        );
        const darkBlueStr = 1 - b;
        const _ldls = _legacyDarkLightsScale;
        darkBlueLight.intensity = darkBlueStr * 2.5 * _ldls;
        darkBlueFill.intensity = darkBlueStr * 1.4 * _ldls;
        darkPinkLight.intensity = darkBlueStr * 1.5 * _ldls;
        darkPurpleFill.intensity = darkBlueStr * 1.2 * _ldls;
        // Performance: a light at intensity 0 still costs every lit pixel (three's shaders loop over all visible
        // lights), so the lights only one mode uses are hidden while they're at 0 (like _darkModeOnlyLights below):
        // the bright-mode warm key / fill in dark mode, the dark-mode fills in bright mode. Shaders rebuild only when
        // the mode changes (O / P).
        for (const l of _modeOnlyLights) l.visible = l.intensity > 0;
        updateMergedDirectionalFills();
        for (let i = 0; i < _darkModeOnlyLights.length; i++) {
          const dl = _darkModeOnlyLights[i];
          if (!dl) continue;
          const base = (dl.userData && dl.userData.baseIntensity) || 0;
          dl.intensity = base * darkBlueStr;
          dl.visible = dl.intensity > 0.5;
        }
        updateKitchenLampCoverShader(darkBlueStr);
        for (let i = 0; i < _peselLightMeshes.length; i++) {
          const entry = _peselLightMeshes[i];
          if (!entry || !entry.mesh || !entry.mesh.material) continue;
          entry.mesh.material.emissiveIntensity =
            entry.darkIntensity +
            (entry.brightIntensity - entry.darkIntensity) * b;
        }
        peselBloom.pass.strength = PESEL_BLOOM.strength * (1 + (PESEL_BLOOM.brightModeScale - 1) * b);
        for (let i = 0; i < _shelfDownLights.length; i++) {
          const entry = _shelfDownLights[i];
          if (!entry || !entry.light) continue;
          entry.light.intensity =
            entry.darkIntensity +
            (entry.brightIntensity - entry.darkIntensity) * b;
          if (_kitchenWorldActive) {
            entry.light.visible = entry.light.intensity > 0.75;
          }
        }
        for (let i = 0; i < _mainLightDownPoints.length; i++) {
          const entry = _mainLightDownPoints[i];
          if (!entry || !entry.light) continue;
          const ml = entry.light;
          ml.intensity =
            entry.darkIntensity +
            (entry.brightIntensity - entry.darkIntensity) * b;
          ml.visible = ml.intensity > 0.001;
          if (entry.darkAngle != null && entry.brightAngle != null) {
            ml.angle =
              entry.darkAngle +
              (entry.brightAngle - entry.darkAngle) * b;
          }
          if (entry.darkPenumbra != null && entry.brightPenumbra != null) {
            ml.penumbra =
              entry.darkPenumbra +
              (entry.brightPenumbra - entry.darkPenumbra) * b;
          }
        }
        if (_iceCoffeeTankMat) _iceCoffeeTankMat.uniforms.uBright.value = b; // shared with its surface
        const plateMat = _mainTablePlateMatRef;
        if (plateMat && plateMat.userData.darkColor) {
          plateMat.color.lerpColors(plateMat.userData.darkColor, _tablePlateBrightColor, b);
        }
        const sideMat = _kitchenTableCoverSideMat;
        if (sideMat && sideMat.userData.darkColor) {
          sideMat.color.lerpColors(sideMat.userData.darkColor, _tableSideBrightColor, b);
          sideMat.emissive.lerpColors(sideMat.userData.darkEmissive, _tableSideBrightEmissive, b);
          sideMat.emissiveIntensity =
            sideMat.userData.darkEmissiveIntensity +
            (KITCHEN_TABLE_SIDE_BRIGHT.emissiveIntensity - sideMat.userData.darkEmissiveIntensity) * b;
          sideMat.metalness =
            sideMat.userData.darkMetalness + (KITCHEN_TABLE_SIDE_BRIGHT.metalness - sideMat.userData.darkMetalness) * b;
        }
        for (const m of _kitchenPastelMats) {
          m.emissiveIntensity =
            KITCHEN_SOAP_PASTEL.selfLight.dark +
            (KITCHEN_SOAP_PASTEL.selfLight.bright - KITCHEN_SOAP_PASTEL.selfLight.dark) * b;
        }
        if (_kitchenWorldActive && _kitchenFloorMat) {
          _kitchenFloorMat.color.lerpColors(
            _kitchenFloorColorDark,
            _kitchenFloorColorBright,
            b,
          );
          _kitchenFloorMat.emissive.setHex(0x16235a);
          _kitchenFloorMat.emissiveIntensity = (1 - b) * 0.16;
        }
        if (_kitchenWorldActive) _kHdriSet(b); // bright mode's HDRI
      }
      document.addEventListener("keydown", (e) => {
        if (e.code === "KeyO") {
          e.preventDefault();
          lightBlendTarget = 0; // dark mode
        }
        if (e.code === "KeyP") {
          e.preventDefault();
          lightBlendTarget = 1; // bright mode
        }
        if (e.code === "KeyQ") {
          e.preventDefault();
        }
        if (e.code === "KeyG") {
          e.preventDefault();
        }
        if (e.code === "Digit1") {
          e.preventDefault();
          if (camera === chaseCamera) leaveKitchenChaseCamera();
          else switchCarView(carCamera);
        }
        if (e.code === "Digit2") {
          e.preventDefault();
          enterKitchenChaseCamera(); // the chase camera (was the free camera, still on C)
        }
        if (e.code === "KeyC") {
          e.preventDefault();
          let nextCam;
          if (camera === carCamera || camera === carCameraFollow) nextCam = testCamera;
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
            } else {
              controls.target.copy(car.position);
            }
            if (camera === carCameraFollow)
              syncCarFollowCamAnglesFromPosition(camera);
            configureOrbitControlsForCarView(camera);
            syncCarCameraYawTracking();
          } else controls.target.set(0, 0, 0);
          controls.update();
        }
      });

      // --- Car from car-game13.gltf (loaded when table is ready) ---
      // GLTF wheel names: wheelFl=front left, wheelFr=front right, wheelRl=rear left, wheelRr=rear right
      const WHEEL_RADIUS = 0.28;
      let halfW = 0.6,
        halfL = 1.0,
        carBodyHalfY = 0.25,
        wheelY = -0.3;
      let carWheelBottomOffsetY = 0.58;
      let wheelFL = null,
        wheelFR = null,
        wheelRL = null,
        wheelRR = null;
      const _quatWheelSteer = new THREE.Quaternion();
      const _quatWheelRoll = new THREE.Quaternion();
      const _quatWheelRollOpposite = new THREE.Quaternion();
      const _axisWheelY = new THREE.Vector3(0, 1, 0);
      const _axisWheelRoll = new THREE.Vector3(1, 0, 0);
      let airInParts = [];
      const _quatAirInDrive = new THREE.Quaternion();
      const _axisAirInDrive = new THREE.Vector3(1, 0, 0);
      const AIR_IN_ROT_SPEED = 12;
      const AIR_IN_STAGGER = {
        airIn1: { open: 0.0, close: 0.14 },
        airIn2: { open: 0.11, close: 0.03 },
        airIn3: { open: 0.06, close: 0.1 },
      };
      let canonFL = null,
        canonFR = null,
        canonRL = null,
        canonRR = null;
      let canonFLBody = null,
        canonFRBody = null,
        canonRLBody = null,
        canonRRBody = null;
      let canonBodyMesh = null,
        canonBodyPhys = null;
      const _canonWorldPos = new THREE.Vector3();
      const _canonWorldQuat = new THREE.Quaternion();
      const _canonBodyLocalCenter = new THREE.Vector3();
      const _wheelSyncWorldPos = [
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
      ];
      const _wheelsList = [null, null, null, null];
      const car = new THREE.Group();
      car.rotation.order = "YXZ";
      scene.add(car);
      // The car's key / rim lights live in the scene (not under the car), following anchors on the car, at
      // intensity 0 while the car is hidden (the intro hides it in the portal tunnel): a light under a hidden group
      // drops out of the shaders' light set, and the set changing rebuilt every visible material when the car drove
      // out of the portal (a ~340 ms freeze). Same light, same place, same look (updateKitchenCarLights, per frame).
      const carKeyLight = new THREE.PointLight(0xc7eaff, 7.5, 16, 1.8);
      carKeyLight.name = "kitchenCarKeyLight";
      scene.add(carKeyLight);
      const carRimLight = new THREE.PointLight(0xff4fc8, 3.5, 11, 1.8);
      carRimLight.name = "kitchenCarRimLight";
      scene.add(carRimLight);
      const _carLightRigs = [carKeyLight, carRimLight].map((light, i) => {
        const anchor = new THREE.Object3D();
        anchor.position.set(i === 0 ? -1.2 : 1.5, i === 0 ? 3.8 : 2.4, i === 0 ? 1.8 : -2.2);
        car.add(anchor);
        return { light, anchor, intensity: light.intensity };
      });
      /** The car's lights onto their anchors (world space), lit only while the car (and its parents) are shown. */
      function updateKitchenCarLights() {
        let shown = true;
        for (let o = car; o; o = o.parent) if (!o.visible) shown = false;
        for (const R of _carLightRigs) {
          R.anchor.updateWorldMatrix(true, false);
          R.anchor.getWorldPosition(R.light.position);
          R.light.intensity = shown ? R.intensity : 0;
        }
      }

      const MAX_STEER_DEG = 28;
      const MAX_STEER_RAD = (MAX_STEER_DEG * Math.PI) / 180;
      const CAR_SCALE_MULTIPLIER = 1.52;
      const carState = {
        speed: 0,
        angle: 0,
        steerAngle: 0,
        wheelAngle: 0,
        driftAngle: 0,
        turnHoldTime: 0,
        maxSpeed: 17,
        accel: 14,
        brakeDecel: 92,
        brakeDecelReverseKey: 620,
        friction: 0.945,
        steerSpeed: 3.4,
        turnRate: 14,
        velY: 0,
        // Collision push from other cars (race): rides on top of driving, decays.
        bumpVX: 0,
        bumpVZ: 0,
        bumpYaw: 0,
      };
      const CAR_GRAVITY = 75;
      const CAR_AIR_RESISTANCE = 0.08;
      const RAMP_JUMP_CAM_TABLE_CLEARANCE = 0.28;
      const RAMP_JUMP_MATRIX_ORBIT = Math.PI * 2;
      const LAND_CAM_SHAKE_DURATION = 0.42;
      const LAND_CAM_SHAKE_LOOK = 1.05;
      const CAR_STEP_SURF_DELTA_MIN = 0.004;
      const CAR_STEP_HEIGHT_LERP = 18;
      const keys = {
        forward: false,
        reverse: false,
        left: false,
        right: false,
        brake: false,
      };

      let tableSpawn = new THREE.Vector3(0, 0, 0);
      let tableMinY = 0;
      let tableSurfaceY = 0;
      let tablePlateHalfX = Infinity, tablePlateHalfZ = Infinity;
      let tablePlateCenter = new THREE.Vector3();
      let _currentWorldModel = null;
let _worldSwitched = false;
      let _kitchenLoadToken = 0;
      let _kitchenFloorStripesGroup = null;
      let _kitchenFloorMat = null;
      const _kitchenLampSources = [];
      const _kitchenLampUniforms = {
        lampPositions: {
          value: Array.from({ length: KITCHEN_LAMP_MAX }, () => new THREE.Vector3()),
        },
        lampCount: { value: 0 },
        lampStrength: { value: 0 },
        lampColor: { value: new THREE.Color(0x9933cc) },
        lampCoreR: { value: 7.5 },
        lampSoftR: { value: 14.0 },
      };
      let _kitchenTableCoverLampMat = null;
      let _kitchenTableCoverSideMat = null;
      let _mainTablePlateMatRef = null; // mainTablePlate's material (its bright-mode colour, from the light blend)
      let _barChairWoodMat = null;
      let _barChairWoodMatBackup = null;
      const waterTapChromeMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 1.0,
        roughness: 0.06,
        clearcoat: 1.0,
        clearcoatRoughness: 0.02,
        envMapIntensity: 5.5,
      });
      function applySceneEnvironmentToMaterial(mat) {
        if (mat && scene.environment) mat.envMap = scene.environment;
      }
      const _kitchenFloorColorDark = new THREE.Color(0x171b2f);
      const _kitchenFloorColorBright = new THREE.Color(0xffffff);
      const _KITCHEN_SHADOW_MAP = 256;
      const _KITCHEN_FLOOR_STRIPE_MIN = 45;
      const _KITCHEN_FLOOR_STRIPE_MAX = 90;
      let _kitchenNishInstanced = null;
      const _kitchenShadowCamKitchen = {
        far: 40,
        left: -9,
        right: 9,
        top: 9,
        bottom: -9,
      };

      // RectAreaLight is shaded with an LTC approximation whose tangent
      // basis comes from the view vector. The specular term needs that,
      // but the diffuse term is meant to be view independent, so a still
      // surface re-shades as the camera orbits. Rebuild the diffuse basis
      // from a fixed world axis instead.
      const RECT_AREA_DIFFUSE_SRC =
        "reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );";
      const RECT_AREA_DIFFUSE_FIX =
        "vec3 ltcRef = abs( normal.z ) < 0.99 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );\n" +
        "\t\treflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, ltcRef, position, mat3( 1.0 ), rectCoords );";
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

      function setKitchenPerfMode(active) {
        _kitchenWorldActive = !!active;
        applyPerformanceSettings();
        renderer.toneMappingExposure = active ? 0.86 : 1;
        sceneBloomEnabled = false;
        carBloomMixPass.enabled = false;
        if (active) {
          renderer.shadowMap.enabled = true;
          carShadowLight.castShadow = true;
          sharpenPass.enabled = false;
          const sz = _KITCHEN_SHADOW_MAP;
          if (carShadowLight.shadow.mapSize.width !== sz) {
            carShadowLight.shadow.mapSize.set(sz, sz);
            carShadowLight.shadow.needsUpdate = true;
          }
          const cam = _kitchenShadowCamKitchen;
          carShadowLight.shadow.camera.far = cam.far;
          carShadowLight.shadow.camera.left = cam.left;
          carShadowLight.shadow.camera.right = cam.right;
          carShadowLight.shadow.camera.top = cam.top;
          carShadowLight.shadow.camera.bottom = cam.bottom;
          carShadowLight.shadow.camera.updateProjectionMatrix();
        }
        try { resize(); } catch (e) {}
      }

      /**
       * The back-wall plates are one row of identical tiles (65 x ~6.8k tris).
       * As a single InstancedMesh the whole row is drawn whenever any tile is
       * in view. Split into chunks of neighbouring tiles, each with its own
       * bounds, so off-screen chunks are frustum-culled. Same tiles, same
       * transforms, same material and name: an identical picture.
       */
      const KITCHEN_NISH_CHUNK = 8;
      const _kitchenNishChunks = [];
      /**
       * Wall plates are masked behind these parts: each part's silhouette, seen
       * straight on along the wall normal, is rendered once into a mask texture,
       * and the plate shader discards fragments that fall inside it.
       */
      const KITCHEN_NISH_MASK_PARTS = ["paperDispencer"];
      /** Mask texture size in pixels (square). */
      const KITCHEN_NISH_MASK_RES = 1024;
      /** MSAA samples for the mask render, for a clean anti-aliased outline. */
      const KITCHEN_NISH_MASK_MSAA = 4;
      /** Mask grown by this many pixels, to clean up sub-pixel slivers at the edge. */
      const KITCHEN_NISH_MASK_DILATE_PX = 1;
      /** Empty border around the silhouette inside the mask texture (fraction of size). */
      const KITCHEN_NISH_MASK_PAD = 0.04;
      let _kitchenNishMaskRT = null;

      function disposeKitchenNishInstanced() {
        for (const inst of _kitchenNishChunks) {
          try {
            if (inst.parent) inst.parent.remove(inst);
          } catch (e) {}
          try { inst.dispose(); } catch (e) {}
        }
        _kitchenNishChunks.length = 0;
        _kitchenNishInstanced = null;
      }

      /**
       * Renders the silhouettes of `parts` (world-space meshes) as white on black,
       * from an orthographic camera looking at them along -wallNormal. Returns
       * { texture, matrix } where matrix maps world space to the mask's NDC.
       */
      function renderKitchenNishMask(parts, wallNormal) {
        if (_kitchenNishMaskRT) {
          _kitchenNishMaskRT.dispose();
          _kitchenNishMaskRT = null;
        }
        if (!parts.length) return null;
        const box = new THREE.Box3();
        for (const p of parts) {
          p.updateWorldMatrix(true, false);
          box.expandByObject(p);
        }
        const center = box.getCenter(new THREE.Vector3());
        const radius = box.getSize(new THREE.Vector3()).length();
        const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, radius * 4);
        cam.position.copy(center).addScaledVector(wallNormal, radius * 2);
        cam.up.set(0, 1, 0);
        if (Math.abs(wallNormal.y) > 0.9) cam.up.set(0, 0, -1);
        cam.lookAt(center);
        cam.updateMatrixWorld(true);
        // Fit a square frustum around the silhouette, with a small border.
        const inv = cam.matrixWorldInverse;
        const c = new THREE.Vector3();
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < 8; i++) {
          c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
          c.applyMatrix4(inv);
          minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
          minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
        }
        const half = Math.max(maxX - minX, maxY - minY) * (0.5 + KITCHEN_NISH_MASK_PAD);
        const cx = (minX + maxX) * 0.5;
        const cy = (minY + maxY) * 0.5;
        cam.left = cx - half; cam.right = cx + half;
        cam.bottom = cy - half; cam.top = cy + half;
        cam.updateProjectionMatrix();

        const maskScene = new THREE.Scene();
        const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
        for (const p of parts) {
          if (!p.geometry) continue;
          const m = new THREE.Mesh(p.geometry, white);
          m.matrixAutoUpdate = false;
          m.matrix.copy(p.matrixWorld);
          m.matrixWorld.copy(p.matrixWorld);
          m.frustumCulled = false;
          maskScene.add(m);
        }
        const rt = new THREE.WebGLRenderTarget(KITCHEN_NISH_MASK_RES, KITCHEN_NISH_MASK_RES, {
          samples: KITCHEN_NISH_MASK_MSAA,
          depthBuffer: false,
          generateMipmaps: false,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
        });
        const prevRT = renderer.getRenderTarget();
        const prevClear = renderer.getClearColor(new THREE.Color());
        const prevAlpha = renderer.getClearAlpha();
        const prevAutoClear = renderer.autoClear;
        const prevShadowAuto = renderer.shadowMap.autoUpdate;
        renderer.shadowMap.autoUpdate = false;
        renderer.setRenderTarget(rt);
        renderer.setClearColor(0x000000, 1);
        renderer.autoClear = true;
        renderer.clear(true, true, true);
        renderer.render(maskScene, cam);
        renderer.setRenderTarget(prevRT);
        renderer.setClearColor(prevClear, prevAlpha);
        renderer.autoClear = prevAutoClear;
        renderer.shadowMap.autoUpdate = prevShadowAuto;
        white.dispose();
        _kitchenNishMaskRT = rt;
        const matrix = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        return { texture: rt.texture, matrix };
      }

      /** Patches a plate material to discard fragments inside the silhouette mask. */
      function applyKitchenNishMask(material, mask) {
        if (!material || !mask) return;
        const uniforms = {
          uNishMask: { value: mask.texture },
          uNishMaskMat: { value: mask.matrix },
          uNishMaskTexel: { value: KITCHEN_NISH_MASK_DILATE_PX / KITCHEN_NISH_MASK_RES },
        };
        material.userData.nishMaskUniforms = uniforms;
        material.onBeforeCompile = (shader) => {
          Object.assign(shader.uniforms, uniforms);
          shader.vertexShader = shader.vertexShader
            .replace(
              "#include <common>",
              "#include <common>\nuniform mat4 uNishMaskMat;\nvarying vec2 vNishMaskPos;",
            )
            .replace(
              "#include <project_vertex>",
              `#include <project_vertex>
              {
                vec4 nishWp = vec4(transformed, 1.0);
                #ifdef USE_INSTANCING
                nishWp = instanceMatrix * nishWp;
                #endif
                vNishMaskPos = (uNishMaskMat * (modelMatrix * nishWp)).xy;
              }`,
            );
          shader.fragmentShader = shader.fragmentShader
            .replace(
              "#include <common>",
              "#include <common>\nuniform sampler2D uNishMask;\nuniform float uNishMaskTexel;\nvarying vec2 vNishMaskPos;",
            )
            .replace(
              "#include <clipping_planes_fragment>",
              `#include <clipping_planes_fragment>
              {
                vec2 nuv = vNishMaskPos * 0.5 + 0.5;
                if (nuv.x > 0.0 && nuv.x < 1.0 && nuv.y > 0.0 && nuv.y < 1.0) {
                  float t = uNishMaskTexel;
                  float mk = texture2D(uNishMask, nuv).r;
                  mk = max(mk, texture2D(uNishMask, nuv + vec2(t, 0.0)).r);
                  mk = max(mk, texture2D(uNishMask, nuv - vec2(t, 0.0)).r);
                  mk = max(mk, texture2D(uNishMask, nuv + vec2(0.0, t)).r);
                  mk = max(mk, texture2D(uNishMask, nuv - vec2(0.0, t)).r);
                  if (mk > 0.5) discard;
                }
              }`,
            );
        };
        material.customProgramCacheKey = () => "kitchenNishMask";
        material.needsUpdate = true;
      }

      function buildKitchenNishPlateInstances(mesh, parent, stepX, cloneCount, material) {
        disposeKitchenNishInstanced();
        if (!mesh || !mesh.geometry || stepX == null || cloneCount < 0) return;
        const total = cloneCount + 1;
        const base = mesh.position.clone();
        const quat = mesh.quaternion.clone();
        const scale = mesh.scale.clone();
        const m = new THREE.Matrix4();
        const pos = new THREE.Vector3();
        for (let start = 0; start < total; start += KITCHEN_NISH_CHUNK) {
          const count = Math.min(KITCHEN_NISH_CHUNK, total - start);
          const inst = new THREE.InstancedMesh(mesh.geometry, material, count);
          inst.name = "MainNishBackWallPlate_instanced";
          inst.castShadow = false;
          inst.receiveShadow = false;
          inst.frustumCulled = true;
          for (let k = 0; k < count; k++) {
            pos.copy(base);
            pos.x += stepX * (start + k);
            m.compose(pos, quat, scale);
            inst.setMatrixAt(k, m);
          }
          inst.instanceMatrix.needsUpdate = true;
          inst.computeBoundingBox();
          inst.computeBoundingSphere();
          parent.add(inst);
          _kitchenNishChunks.push(inst);
        }
        _kitchenNishInstanced = _kitchenNishChunks[0] || null;
        mesh.visible = false;
      }
      let carFalling = false;
      let carFloorTimer = 0;
      let tablePlateMesh = null;
      let storedCarScale = 0.5;
      let carBottomOffsetY = 0; // kept for compatibility

      function isControlKey(code) {
        return [
          "KeyW",
          "KeyS",
          "KeyA",
          "KeyD",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
        ].includes(code);
      }
      function onKeyDown(e) {
        if (isControlKey(e.code)) e.preventDefault();
        if (e.code === "KeyW" || e.code === "ArrowUp") keys.forward = true;
        if (e.code === "KeyS" || e.code === "ArrowDown") keys.reverse = true;
        if (e.code === "KeyA" || e.code === "ArrowLeft") keys.left = true;
        if (e.code === "KeyD" || e.code === "ArrowRight") keys.right = true;
        if (e.code === "Space") keys.brake = true;
      }
      function onKeyUp(e) {
        if (isControlKey(e.code)) e.preventDefault();
        if (e.code === "KeyW" || e.code === "ArrowUp") keys.forward = false;
        if (e.code === "KeyS" || e.code === "ArrowDown") keys.reverse = false;
        if (e.code === "KeyA" || e.code === "ArrowLeft") keys.left = false;
        if (e.code === "KeyD" || e.code === "ArrowRight") keys.right = false;
        if (e.code === "Space") keys.brake = false;
      }
      window.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("keyup", onKeyUp, true);
      // Touch driving (phones / tablets): writes the same `keys` as the keyboard.
      createTouchDrive({
        THREE,
        mount: getKitchenSceneMount(),
        getCamera: () => camera,
        getCar: () => car,
        getAngle: () => carState.angle,
        getCarLength: () => 2 * halfL * storedCarScale,
        getKeys: () => keys,
        enabled: () => _kitchenSceneRendering && _kIntro.state === "done",
      });

      const _flatUp = new THREE.Vector3(0, 1, 0);
      let _carFrontAxleSurfY = 0;
      let _carRearAxleSurfY = 0;
      let _carGroundSurfY = 0;
      let _carSurfRange = 0;
      const _carWheelSurfY = [0, 0, 0, 0];
      const _quatY = new THREE.Quaternion();
      const _quatTilt = new THREE.Quaternion();
      const carUpLerp = new THREE.Vector3(0, 1, 0);
      let jumpLaunchSpeed = 0;
      let jumpInitialVelY = 0;
      let _rampJumpSimAirTime = 0;
      const LANDING_RECOVERY_DURATION = 0.3;
      let wasInAir = false;
      let _carLandShakePending = false;
      let _rampLeftJumpActive = false;
      let _rampJumpMatrixActive = false;
      let _rampJumpFxBlend = 0;
      let _rampJumpFxIn = 0;
      let _carCam1JumpEffect = 0;
      let _rampJumpMatrixOrbitProgress = 0;
      let landingRecoveryUntil = 0;
      let tablePlateBody = null;
      let floorPhysBody = null;
      const PHYS_GROUP_DEFAULT = 1;
      const PHYS_GROUP_CAR = 512;
      /** Low car "bumper" that only touches knockable props (never table/floor). */
      const PHYS_GROUP_PROP_BUMPER = 1024;
      const PHYS_GROUP_PROP = 2048;
      const PHYS_GROUP_CUP = 8192;
      /** Food scattered from the plates (kitchenFood.js): table / floor / plates and each other. */
      const PHYS_GROUP_FOOD = 16384;
      let _kitchenFood = null;
      let _milkCartons = null; // kitchenMilkCartons.js
      let _kitchenNapkins = null; // kitchenNapkins.js

      physicsWorld = new CANNON.World({
        gravity: new CANNON.Vec3(0, -480, 0),
        allowSleep: true,
      });
      physicsWorld.broadphase = new CANNON.SAPBroadphase(physicsWorld);
      physicsWorld.solver.iterations = perfSettings.physicsIterations;
      physicsWorld.defaultContactMaterial.friction = 0.5;
      physicsWorld.defaultContactMaterial.restitution = 0.1;
      physicsWorld.defaultContactMaterial.contactEquationStiffness = 1e7;
      physicsWorld.defaultContactMaterial.contactEquationRelaxation = 3;
      const tablePlatePhysicsMaterial = new CANNON.Material("tablePlate");
      const carMaterial = new CANNON.Material("car");
      const floorPhysMaterial = new CANNON.Material("floor");
      const propPhysMaterial = new CANNON.Material("prop");
      // Pyramid cups keep their original physics (own material, mass, damping).
      const cupPhysMaterial = new CANNON.Material("cup");
      const KITCHEN_PROP_FRICTION = 0.4; // props on the table / floor (was 0.25)
      const KITCHEN_CUP_FRICTION = 0.25;
      // Props (and cups) on the table / floor: bounce and contact stiffness (named so the food can share them).
      const KITCHEN_CUP_RESTITUTION = 0.05;
      const KITCHEN_CUP_CONTACT_STIFFNESS = 1e8;
      const KITCHEN_CUP_CONTACT_RELAXATION = 2;
      // Props on the table / floor: they slide when pushed rather than dig in.
      for (const surface of [tablePlatePhysicsMaterial, floorPhysMaterial]) {
        for (const [mat, friction] of [[propPhysMaterial, KITCHEN_PROP_FRICTION], [cupPhysMaterial, KITCHEN_CUP_FRICTION]]) {
          physicsWorld.addContactMaterial(
            new CANNON.ContactMaterial(mat, surface, {
              friction,
              restitution: KITCHEN_CUP_RESTITUTION,
              contactEquationStiffness: KITCHEN_CUP_CONTACT_STIFFNESS,
              contactEquationRelaxation: KITCHEN_CUP_CONTACT_RELAXATION,
            }),
          );
        }
      }
      // Car tumbling off the table: the meeting room's car contact values.
      const carFallMaterial = new CANNON.Material("carFall");
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(carFallMaterial, tablePlatePhysicsMaterial, {
          friction: 0.35,
          restitution: 0.04,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 3,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(carFallMaterial, floorPhysMaterial, {
          friction: 0.62,
          restitution: 0.16,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 3,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(carMaterial, tablePlatePhysicsMaterial, {
          friction: 0.5,
          restitution: 0,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 2,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(carMaterial, floorPhysMaterial, {
          friction: 0.6,
          restitution: 0.05,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 3,
        }),
      );

      function setupFloorPhysics(model) {
        let floorMesh = null;
        model.traverse((node) => {
          if (node.isMesh && node.name === "floor") floorMesh = node;
        });
        if (!floorMesh) return;
        model.updateMatrixWorld(true);
        floorMesh.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(floorMesh);
        const center = bb.getCenter(new THREE.Vector3());
        const size = bb.getSize(new THREE.Vector3());
        const floorTop = bb.max.y;
        const hy = Math.max(size.y, 0.5) / 2;
        floorPhysBody = new CANNON.Body({
          type: CANNON.Body.STATIC,
          position: new CANNON.Vec3(center.x, floorTop - hy, center.z),
          material: floorPhysMaterial,
          collisionFilterGroup: 1,
          collisionFilterMask: -1,
        });
        floorPhysBody.addShape(
          new CANNON.Box(new CANNON.Vec3(size.x / 2, hy, size.z / 2))
        );
        physicsWorld.addBody(floorPhysBody);
      }

      // --- knockable kitchen props ----------------------------------------
      // [visual mesh(es), invisible physics proxy, collider shape]. The proxy's
      // bounds become a dynamic body the car can push; every visual in the
      // group follows it every frame.
      const KITCHEN_PROP_PAIRS = [
        // The fruit plates: their ...Physic meshes are open trays (floor, walls,
        // rim), used as compound colliders so the food sits inside them.
        ["fruitPlate1", "fruitPlate1Physic", "tray"],
        ["fruitPlate2", "fruitPlate2Physic", "tray"],
        ["fruitPlate3", "fruitPlate3Physic", "tray"],
        [["greyBox", "greyBoxCup"], "greyBoxPhysic", "box"],
        ["binSign1", "binSign1Physic", "box"],
        ["binSign2", "binSign2Physic", "box"],
        ["binSign3", "binSign3Physic", "box"],
        // salBase group (new in ul-kitchen25): the stand and its top bar move as
        // one, on the stand's base collider (same setup as the bin signs).
        [["salBase1", "salHange1"], "salBase1Physic", "box", { salBase: true }],
        // The cup is not listed here: buildCupPyramid() stacks it with its
        // copies into a pyramid and adds them to _cupPyramidPairs.
      ];
      // Prop masses by type (the car counts as CAR_MASS = 1.8, shared bump physics).
      const KITCHEN_PLATE_MASS = 7; // smallest fruit plate; bigger plates scale with radius
      const KITCHEN_PLATE_REF_RADIUS = 1.55;
      const KITCHEN_GREY_BOX_MASS = 10;
      const KITCHEN_BIN_SIGN_MASS = 8;
      /**
       * The salBase group (salBase1 + salHange1 on salBase1Physic): a bit
       * heavier than a bin sign (larger base); damping as the other props.
       * Friction and bounce come from the props' shared material
       * (KITCHEN_PROP_FRICTION 0.4, restitution 0.05 on the table / floor).
       */
      const KITCHEN_SAL_BASE = {
        mass: 10,
        linearDamping: 0.8,
        angularDamping: 0.85,
        /** Its model stands 0.175 above the table: seated on it at load (within this gap), so it doesn't drop at the start or on "Race again". */
        seatGap: 0.3,
      };
      const KITCHEN_CUP_MASS = 2; // pyramid cups: original physics, unchanged
      const KITCHEN_CUP_LINEAR_DAMPING = 0.35;
      const KITCHEN_CUP_ANGULAR_DAMPING = 0.5;
      /** Props' and cups' sleep (the food shares it). */
      const KITCHEN_PROP_SLEEP_SPEED = 0.6;
      const KITCHEN_PROP_SLEEP_TIME = 0.5;
      /** Cup speed after a shove, relative to the car's speed toward it (original). */
      const KITCHEN_CUP_PUSH_RESTITUTION = 1.1;
      // Car ↔ prop response (momentum based):
      const KITCHEN_PROP_CAR_RESTITUTION = 0.15; // bounce on a hit
      const KITCHEN_PROP_IMPACT_MIN_SPEED = 2; // closing speed that counts as a hit
      const KITCHEN_PROP_CAR_MIN_KEEP = 0.35; // a hit never takes more than 65% of the speed
      const KITCHEN_PROP_PUSH_DRAG = 0.9; // pushing drag, × (prop mass / car mass), speed / s

      /** Mass of a prop by type, bigger plates heavier. */
      function kitchenPropMass(physName, isCup, radius) {
        if (isCup) return KITCHEN_CUP_MASS;
        if (/^greyBox/.test(physName)) return KITCHEN_GREY_BOX_MASS;
        if (/^binSign/.test(physName)) return KITCHEN_BIN_SIGN_MASS;
        if (/^salBase/.test(physName)) return KITCHEN_SAL_BASE.mass;
        if (/^fruitPlate/.test(physName)) return KITCHEN_PLATE_MASS * Math.max(1, radius / KITCHEN_PLATE_REF_RADIUS);
        return KITCHEN_PLATE_MASS;
      }
      /** Car spawn offset from the table centre: clear of greyBox and binSign3. */
      const KITCHEN_CAR_SPAWN_OFFSET_X = 4.3;
      const KITCHEN_PROP_LINEAR_DAMPING = 0.8;
      const KITCHEN_PROP_ANGULAR_DAMPING = 0.85;
      /**
       * Gap between a prop's lowest visible point and its physics body's
       * bottom. The body rests on the surface (with cannon's tiny resting
       * overlap), so the visual always sits just above it: never sunk into the
       * table / floor, and never coplanar with it (no z-fighting).
       */
      const KITCHEN_PROP_VISUAL_LIFT = 0.012;
      /** Overlap with the table top allowed before a prop is lifted back out. */
      const KITCHEN_PROP_TABLE_TOLERANCE = 0.01;
      /**
       * The same for the fruit plates once their food is loose in them (was
       * 0.01 like the other props): a plate carrying a pile rests deeper in the
       * table, and lifting it every frame bounced the plate and threw the food
       * through its floor.
       */
      const KITCHEN_PLATE_TABLE_TOLERANCE = 0.06;
      /** Inradius / radius of the props' 12-segment cylinder colliders. */
      const KITCHEN_PROP_CYL_INRADIUS = Math.cos(Math.PI / 12);
      /** Gap between the car's prop bumper and the table (it never touches the table). */
      const KITCHEN_PROP_BUMPER_CLEARANCE = 0.02;
      const KITCHEN_PROP_BUMPER_MAX_SPEED = 40;
      const _kitchenProps = [];
      const _propBodyMat = new THREE.Matrix4();
      const _propWorldMat = new THREE.Matrix4();
      const _propParentInv = new THREE.Matrix4();
      const _propPos = new THREE.Vector3();
      const _propQuat = new THREE.Quaternion();
      const _propScale = new THREE.Vector3(1, 1, 1);

      /**
       * greyBox: matte grey plastic. greyBoxCup (its lid): the bar chairs' oak
       * wood material (shared, so it follows any chair-material changes).
       */
      let _greyBoxPlasticMat = null;
      function applyGreyBoxMaterials(model) {
        const box = model.getObjectByName("greyBox");
        if (box && box.isMesh) {
          if (!_greyBoxPlasticMat) {
            _greyBoxPlasticMat = new THREE.MeshStandardMaterial({
              color: 0x8a8d92,
              roughness: 0.9,
              metalness: 0,
            });
          }
          box.material = _greyBoxPlasticMat;
        }
        const lid = model.getObjectByName("greyBoxCup");
        if (lid && lid.isMesh && _barChairWoodMat) {
          lid.material = _barChairWoodMat;
        }
      }

      /**
       * Cup: cupBase is white plastic; cupGraphic is the printed sleeve
       * (redrawn from the Wix Cafe sleeve layout). cupGraphic's UVs wrap once
       * around the cup (u 0→1, left→right seen from outside) and run v 0.25
       * (top) → 0.5 (bottom), so the canvas is stretched over that band.
       */
      let _cupPlasticMat = null;
      let _cupSleeveMat = null;
      /** How strongly the cup print lights itself (0 = lit by the scene only). */
      const KITCHEN_CUP_SLEEVE_GLOW = 0.45;
      function drawCupSleeveCanvas() {
        const W = 2048;
        const H = 896;
        const cv = document.createElement("canvas");
        cv.width = W;
        cv.height = H;
        const ctx = cv.getContext("2d");
        const BEIGE = "#cdbf9f";
        const BLUE = "#2b4a96";
        const RED = "#e3304e";
        const PINK = "#ef8aa6";
        const INK = "#2a1a20";
        // Top band: beige with a row of 8 blue half-discs (round side left,
        // flat side right), each spanning the band's full height.
        const yb = Math.round(H * 0.47);
        ctx.fillStyle = BEIGE;
        ctx.fillRect(0, 0, W, yb);
        ctx.fillStyle = BLUE;
        const cell = W / 8;
        const ry = (yb / 2) * 0.96;
        for (let i = 0; i < 8; i++) {
          const xr = (i + 1) * cell;
          ctx.beginPath();
          ctx.ellipse(xr, yb / 2, cell * 0.985, ry, 0, Math.PI / 2, Math.PI * 1.5);
          ctx.closePath();
          ctx.fill();
        }
        // Bottom band: red, with a pink triangle rising from the base.
        ctx.fillStyle = RED;
        ctx.fillRect(0, yb, W, H - yb);
        const ax = W * 0.5;
        ctx.fillStyle = PINK;
        ctx.beginPath();
        ctx.moveTo(ax, yb);
        ctx.lineTo(ax + W * 0.31, H);
        ctx.lineTo(ax - W * 0.31, H);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = INK;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // WiXCAFE logo in the triangle.
        const logoY = yb + (H - yb) * 0.6;
        const logoSize = Math.round((H - yb) * 0.2);
        ctx.font = `900 ${logoSize}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
        const wix = "WiX";
        ctx.font = `900 ${logoSize}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
        const wWix = ctx.measureText(wix).width;
        ctx.font = `500 ${logoSize}px "Helvetica Neue", Arial, sans-serif`;
        const wCafe = ctx.measureText("CAFE").width;
        const x0 = ax - (wWix + wCafe) / 2;
        ctx.textAlign = "left";
        ctx.font = `900 ${logoSize}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
        ctx.fillText(wix, x0, logoY);
        ctx.font = `500 ${logoSize}px "Helvetica Neue", Arial, sans-serif`;
        ctx.fillText("CAFE", x0 + wWix, logoY);
        // "Freshly roasted coffee" on the red, just below the blue band.
        ctx.textAlign = "center";
        ctx.font = `400 ${Math.round((H - yb) * 0.1)}px "Helvetica Neue", Arial, sans-serif`;
        const tagY = yb + (H - yb) * 0.22;
        ctx.fillText("Freshly roasted coffee", W * 0.19, tagY);
        ctx.fillText("Freshly roasted coffee", W * 0.81, tagY);
        return cv;
      }
      function applyCupMaterials(model) {
        const base = model.getObjectByName("cupBase");
        if (base && base.isMesh) {
          if (!_cupPlasticMat) {
            _cupPlasticMat = new THREE.MeshStandardMaterial({
              color: 0xf4f4f2,
              roughness: 0.4,
              metalness: 0,
            });
          }
          base.material = _cupPlasticMat;
        }
        const sleeve = model.getObjectByName("cupGraphic");
        if (sleeve && sleeve.isMesh && typeof document !== "undefined") {
          if (!_cupSleeveMat) {
            const tex = new THREE.CanvasTexture(drawCupSleeveCanvas());
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.flipY = false;
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
            // UV v 0.25..0.5 -> canvas top..bottom.
            tex.repeat.set(1, 4);
            tex.offset.set(0, -1);
            tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
            // The print also lights itself a little (emissive = its own
            // colours) so it stays bright in the dim kitchen.
            _cupSleeveMat = new THREE.MeshStandardMaterial({
              map: tex,
              emissive: 0xffffff,
              emissiveMap: tex,
              emissiveIntensity: KITCHEN_CUP_SLEEVE_GLOW,
              roughness: 0.55,
              metalness: 0,
            });
          }
          sleeve.material = _cupSleeveMat;
        }
      }

      // --- cup pyramid ------------------------------------------------------
      // The cup group (cupBase + cupGraphic, body cupPhysic) is copied into a
      // square-based 3D pyramid standing where the cup was: each layer is an
      // n×n grid, every cup resting on the four below it (centred over their
      // gap). Cups stack with real solver contacts (unlike the other props),
      // start asleep so the pyramid stands perfectly still, and all wake
      // together once the car knocks any of them.
      const KITCHEN_CUP_PYRAMID_LAYERS = 5; // 5×5 + 4×4 + 3×3 + 2×2 + 1 = 55 cups
      /** Gravity for the cups once falling: the falling car's (scaled meeting room). */
      const KITCHEN_CUP_GRAVITY = 70;
      const KITCHEN_CUP_GAP = 0.004;
      let _cupPyramidPairs = [];
      const _cupBodies = [];
      /** Set by pushKitchenPropsOutOfCar when the car shoves a cup this frame. */
      let _cupHitByCar = false;

      function buildCupPyramid(model) {
        _cupPyramidPairs = [];
        const base = model.getObjectByName("cupBase");
        const graphic = model.getObjectByName("cupGraphic");
        const phys = model.getObjectByName("cupPhysic");
        if (!base || !graphic || !phys || !phys.isMesh) return;
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(phys);
        const size = box.getSize(new THREE.Vector3());
        const radius = (size.x + size.z) / 4;
        const step = 2 * radius + KITCHEN_CUP_GAP;
        const rise = size.y + KITCHEN_CUP_GAP;
        const parts = [base, graphic, phys];
        const worldPos = parts.map((o) => o.getWorldPosition(new THREE.Vector3()));
        const delta = new THREE.Vector3();
        let idx = 0;
        for (let layer = 0; layer < KITCHEN_CUP_PYRAMID_LAYERS; layer++) {
          const count = KITCHEN_CUP_PYRAMID_LAYERS - layer;
          for (let i = 0; i < count * count; i++) {
            const ix = i % count;
            const iz = Math.floor(i / count);
            delta.set((ix - (count - 1) / 2) * step, layer * rise, (iz - (count - 1) / 2) * step);
            const names = idx === 0
              ? ["cupBase", "cupGraphic", "cupPhysic"]
              : [`cupBase_p${idx}`, `cupGraphic_p${idx}`, `cupPhysic_p${idx}`];
            parts.forEach((src, k) => {
              const o = idx === 0 ? src : src.clone();
              if (idx !== 0) {
                o.name = names[k];
                src.parent.add(o);
              }
              const wp = worldPos[k].clone().add(delta);
              o.position.copy(o.parent.worldToLocal(wp));
              o.updateMatrixWorld(true);
            });
            _cupPyramidPairs.push([[names[0], names[1]], names[2], "cylinder", { cup: true }]);
            idx++;
          }
        }
      }

      // Falling cups get the car's fall gravity instead of the props' -480.
      // Added in postStep (forces were just cleared) so it is part of the next
      // step's forces *before* the contact solve: added after the solve, a
      // resting cup would get an upward kick every step and keep bouncing.
      physicsWorld.addEventListener("postStep", () => {
        for (let i = 0; i < _cupBodies.length; i++) {
          const b = _cupBodies[i];
          if (b.sleepState === CANNON.Body.SLEEPING) continue;
          b.force.y += b.mass * (480 - KITCHEN_CUP_GRAVITY);
        }
      });

      /**
       * When the car hits a cup, every cup still asleep wakes so the stack
       * reacts as a whole. Only a car hit does this: a cup twitching on its
       * own must not keep re-waking the others (they would never settle).
       */
      function wakeCupPyramidIfHit() {
        if (!_cupHitByCar) return;
        _cupHitByCar = false;
        for (let i = 0; i < _cupBodies.length; i++) {
          if (_cupBodies[i].sleepState === CANNON.Body.SLEEPING) _cupBodies[i].wakeUp();
        }
      }

      /** greyBox group (greyBox, greyBoxCup) and greyBoxPhysic: turned 90° about Y around the proxy's centre. */
      const KITCHEN_GREY_BOX_YAW = Math.PI / 2;
      function rotateKitchenGreyBox(model) {
        const phys = model.getObjectByName("greyBoxPhysic");
        if (!phys) return;
        model.updateMatrixWorld(true);
        const pivot = new THREE.Box3().setFromObject(phys).getCenter(new THREE.Vector3());
        const turn = new THREE.Matrix4()
          .makeTranslation(pivot.x, pivot.y, pivot.z)
          .multiply(new THREE.Matrix4().makeRotationY(KITCHEN_GREY_BOX_YAW))
          .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
        for (const name of ["greyBox", "greyBoxCup", "greyBoxPhysic"]) {
          const o = model.getObjectByName(name);
          if (!o) continue;
          const world = turn.clone().multiply(o.matrixWorld);
          const local = o.parent
            ? new THREE.Matrix4().copy(o.parent.matrixWorld).invert().multiply(world)
            : world;
          local.decompose(o.position, o.quaternion, o.scale);
        }
        model.updateMatrixWorld(true);
      }

      /** Food on the fruit plates (kitchenFood.js): built once, put back on "Race again". */
      function setupKitchenFood() {
        if (_kitchenFood) return;
        _kitchenFood = createKitchenFood({
          THREE,
          CANNON,
          scene,
          world: physicsWorld,
          groups: { DEFAULT: PHYS_GROUP_DEFAULT, PROP: PHYS_GROUP_PROP, FOOD: PHYS_GROUP_FOOD },
          materials: { table: tablePlatePhysicsMaterial, floor: floorPhysMaterial, prop: propPhysMaterial, ramp: _rampPhysMaterial() },
          getTable: () => {
            if (!tablePlateBody) return null;
            const he = tablePlateBody.shapes[0].halfExtents;
            const tp = tablePlateBody.position;
            return { top: tp.y + he.y, cx: tp.x, cz: tp.z, hx: he.x, hz: he.z };
          },
          getFloor: () => {
            if (!floorPhysBody) return null;
            const he = floorPhysBody.shapes[0].halfExtents;
            const fp = floorPhysBody.position;
            return { top: fp.y + he.y, cx: fp.x, cz: fp.z, hx: he.x, hz: he.z };
          },
          carMass: CAR_MASS,
          guardMaterial: keepBelowBloomThreshold,
          // The food's physics: the cup pyramid's settings, shared (not copied).
          cup: {
            friction: KITCHEN_CUP_FRICTION,
            restitution: KITCHEN_CUP_RESTITUTION,
            stiffness: KITCHEN_CUP_CONTACT_STIFFNESS,
            relaxation: KITCHEN_CUP_CONTACT_RELAXATION,
            linearDamping: KITCHEN_CUP_LINEAR_DAMPING,
            angularDamping: KITCHEN_CUP_ANGULAR_DAMPING,
            sleepSpeed: KITCHEN_PROP_SLEEP_SPEED,
            sleepTime: KITCHEN_PROP_SLEEP_TIME,
          },
        });
        _kitchenFood.setup(
          _kitchenProps
            .filter((p) => p.vis && /^fruitPlate\d$/.test(p.vis.name))
            .map((p) => ({ name: p.vis.name, body: p.body, radius: p.body._propRadius, tray: p.body._propTray })),
        );
      }

      function setupKitchenPropPhysics(model) {
        model.updateMatrixWorld(true);
        // Physics proxies (…Physic) are never drawn, paired with a prop or not.
        model.traverse((o) => {
          if (o.isMesh && /Physic$/.test(o.name)) o.visible = false;
        });
        const tableTop = tablePlateBody
          ? tablePlateBody.position.y + tablePlateBody.shapes[0].halfExtents.y
          : -Infinity;
        for (const [visNames, physName, shapeKind, opts] of KITCHEN_PROP_PAIRS.concat(_cupPyramidPairs)) {
          const isCup = !!(opts && opts.cup);
          const visList = (Array.isArray(visNames) ? visNames : [visNames])
            .map((n) => model.getObjectByName(n))
            .filter(Boolean);
          const phys = model.getObjectByName(physName);
          if (!visList.length || !phys || !phys.isMesh) continue;
          const box = new THREE.Box3().setFromObject(phys);
          if (box.isEmpty()) continue;
          const center = box.getCenter(new THREE.Vector3());
          const meshCenter = center.clone(); // the body's frame for a tray profile
          const size = box.getSize(new THREE.Vector3());
          const radius = (size.x + size.z) / 4;
          const height = Math.max(size.y, 0.05);
          // Rest exactly on the table top (no start-up pop if the proxy dips into it).
          if (box.min.y < tableTop && box.max.y > tableTop) center.y = tableTop + height / 2 + 0.002;
          else if (opts && opts.salBase && box.min.y >= tableTop && box.min.y - tableTop < KITCHEN_SAL_BASE.seatGap) center.y = tableTop + height / 2 + 0.002;
          // Upper pyramid rows: exactly on the row below (bottom row is snapped above).
          if (isCup && box.min.y > tableTop + 0.1) {
            const row = Math.round((box.min.y - tableTop) / (height + KITCHEN_CUP_GAP));
            center.y = tableTop + 0.002 + row * (height + KITCHEN_CUP_GAP) + height / 2;
          }
          const body = new CANNON.Body({
            mass: kitchenPropMass(physName, isCup, radius),
            linearDamping: isCup ? KITCHEN_CUP_LINEAR_DAMPING : opts && opts.salBase ? KITCHEN_SAL_BASE.linearDamping : KITCHEN_PROP_LINEAR_DAMPING,
            angularDamping: isCup ? KITCHEN_CUP_ANGULAR_DAMPING : opts && opts.salBase ? KITCHEN_SAL_BASE.angularDamping : KITCHEN_PROP_ANGULAR_DAMPING,
            allowSleep: true,
            sleepSpeedLimit: KITCHEN_PROP_SLEEP_SPEED,
            sleepTimeLimit: KITCHEN_PROP_SLEEP_TIME,
            collisionFilterGroup: isCup ? PHYS_GROUP_CUP : PHYS_GROUP_PROP,
            // Solver contacts only with the table / floor (and, for pyramid
            // cups, with each other so they stack and topple). The car and the
            // other props move a prop through horizontal push-outs
            // (pushKitchenPropsOutOfCar / separateKitchenProps): solver contacts
            // let props pop up, ride onto each other and jitter in a pile.
            collisionFilterMask: isCup
              ? ~(PHYS_GROUP_CAR | PHYS_GROUP_PROP)
              : ~(PHYS_GROUP_CAR | PHYS_GROUP_PROP | PHYS_GROUP_CUP),
            material: isCup ? cupPhysMaterial : propPhysMaterial,
          });
          const tray = shapeKind === "tray" ? trayFromMesh(THREE, phys, meshCenter, visList[0].isMesh ? visList[0] : null) : null;
          if (shapeKind === "box") {
            const he = new CANNON.Vec3(size.x / 2, height / 2, size.z / 2);
            body.addShape(new CANNON.Box(he));
            body._propBox = he;
            body._propRadius = Math.hypot(he.x, he.z);
          } else if (tray) {
            addTrayShapes(CANNON, body, tray, KITCHEN_FOOD.trayMinWall, PHYS_GROUP_FOOD);
            body._propTray = tray;
            body.sleepSpeedLimit = KITCHEN_FOOD.plateSleep.speed;
            body.sleepTimeLimit = KITCHEN_FOOD.plateSleep.time;
            body._propRadius = radius;
          } else {
            body.addShape(new CANNON.Cylinder(radius, radius, height, 12));
            body._propRadius = radius;
          }
          body._propHalfHeight = height / 2;
          body.position.set(center.x, center.y, center.z);
          body._home = { pos: body.position.clone(), quat: body.quaternion.clone() };
          physicsWorld.addBody(body);
          if (isCup) {
            body._propCup = true;
            body.sleep();
            _cupBodies.push(body);
          }
          // Each visual's pose relative to the body, kept while it moves, but
          // the group seated on the body's bottom: the model's visuals sit
          // ~0.02 below the proxy's base, i.e. inside the surface once resting.
          const groupBox = new THREE.Box3();
          for (const v of visList) groupBox.expandByObject(v);
          const bodyBottom = center.y - height / 2;
          const seat = bodyBottom + KITCHEN_PROP_VISUAL_LIFT - groupBox.min.y;
          const toBody = new THREE.Matrix4().makeTranslation(center.x, center.y, center.z).invert();
          const seatMat = new THREE.Matrix4().makeTranslation(0, seat, 0);
          const parts = visList.map((v) => ({
            vis: v,
            offset: toBody.clone().multiply(v.matrixWorld).premultiply(seatMat),
          }));
          phys.visible = false;
          _kitchenProps.push({ vis: visList[0], body, parts });
        }
      }

      /**
       * A prop over the table is never allowed below the table top. A hit from
       * the car (infinite-mass kinematic bodies) can otherwise shove it down
       * into the table for a few frames before the solver recovers.
       */
      function keepKitchenPropsAboveTable() {
        if (!tablePlateBody) return;
        const tShape = tablePlateBody.shapes[0];
        const tp = tablePlateBody.position;
        const top = tp.y + tShape.halfExtents.y;
        for (let i = 0; i < _kitchenProps.length; i++) {
          const b = _kitchenProps[i].body;
          if (b.sleepState === CANNON.Body.SLEEPING) continue;
          if (
            Math.abs(b.position.x - tp.x) > tShape.halfExtents.x ||
            Math.abs(b.position.z - tp.z) > tShape.halfExtents.z
          ) {
            continue;
          }
          // Lowest point of the (possibly tilted) cylinder / box.
          const q = b.quaternion;
          let lowest;
          if (b._propBox) {
            const he = b._propBox;
            const r10 = 2 * (q.x * q.y + q.w * q.z);
            const r11 = 1 - 2 * (q.x * q.x + q.z * q.z);
            const r12 = 2 * (q.y * q.z - q.w * q.x);
            lowest = b.position.y - (he.x * Math.abs(r10) + he.y * Math.abs(r11) + he.z * Math.abs(r12));
          } else {
            const upY = Math.min(1, Math.abs(1 - 2 * (q.x * q.x + q.z * q.z)));
            const sinT = Math.sqrt(Math.max(0, 1 - upY * upY));
            // The collider is a 12-sided prism: lying on its side it rests on a
            // flat face (inradius), not the round radius. Using the round one
            // here made every tipped-over cup look sunk, so it was lifted each
            // frame and could never settle / sleep.
            const sideR = b._propRadius * KITCHEN_PROP_CYL_INRADIUS;
            lowest = b.position.y - (b._propHalfHeight * upY + sideR * sinT);
          }
          // Only real sinking: a resting contact keeps a tiny overlap the
          // solver needs; removing it every step makes the prop jitter.
          const tol = b._propTray ? KITCHEN_PLATE_TABLE_TOLERANCE : KITCHEN_PROP_TABLE_TOLERANCE;
          if (lowest < top - tol) {
            b.position.y += top - tol - lowest;
            if (b.velocity.y < 0) b.velocity.y = 0;
          }
        }
      }

      // ── Ramp ("ramp" in the kitchen model): its top surface is part of every
      // race car's ground (sampled per wheel), so cars drive up the slope and
      // launch off its edge; a static convex collider (its hull) for the
      // physics props. Cars are moved by code (same rules for all of them):
      // the ground's rise rate under a car is its speed along the slope's
      // vertical (speed × slope), and when the ground drops away (the edge) the
      // car leaves it with exactly that (capped): height and distance follow
      // from the car's speed and the ramp's angle.
      const RAMP_MESH_NAME = "ramp";
      /** Takeoff: vertical speed off the edge = climb speed (speed × slope) × this (was 1.8: +17%, a bit bigger jump)… */
      const RAMP_TAKEOFF_SCALE = 2.1;
      /** …capped here (top speed: ≈ 4.4 natural → ≈ 9.2; was 10, +17%; never reached at top speed). */
      const RAMP_TAKEOFF_MAX_VY = 11.7;
      /** Below this climb speed a car just drops off the edge (no launch). */
      const RAMP_LAUNCH_MIN_VY = 1;
      /** The ground under a car fell away by more than this → airborne. */
      const RAMP_LEAVE_DROP = 0.2;
      /** Gravity while airborne off the ramp (the cars' normal 75 is a hop, not a jump). */
      const RAMP_AIR_GRAVITY = 26;
      /** Extra gravity while falling (after the apex): a firm, not floaty, landing. */
      const RAMP_AIR_EXTRA_GRAVITY_DOWN = 6;
      /** How fast a car's measured climb speed fades on flat ground (1/s). */
      const RAMP_CLIMB_DECAY = 3;
      let _rampMesh = null;
      let _rampBody = null;
      const _rampBox = new THREE.Box3();
      const _rampRay = new THREE.Raycaster();
      const _rampRayFrom = new THREE.Vector3();
      const _rampDown = new THREE.Vector3(0, -1, 0);
      const _rampHits = [];

      function setupKitchenRamp(model, material) {
        _rampMesh = null;
        if (_rampBody) {
          try { physicsWorld.removeBody(_rampBody); } catch (e) {}
          _rampBody = null;
        }
        const mesh = model.getObjectByName(RAMP_MESH_NAME);
        if (!mesh || !mesh.isMesh || !mesh.geometry) return;
        mesh.updateMatrixWorld(true);
        _rampMesh = mesh;
        _rampBox.setFromObject(mesh);
        // Static convex collider: the hull of the ramp's own vertices.
        const pa = mesh.geometry.attributes.position;
        const pts = [];
        for (let i = 0; i < pa.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(pa, i).applyMatrix4(mesh.matrixWorld));
        const centre = _rampBox.getCenter(new THREE.Vector3());
        const hull = new ConvexHull().setFromPoints(pts);
        const verts = [];
        const index = new Map();
        const faces = [];
        for (const face of hull.faces) {
          const f = [];
          let e = face.edge;
          do {
            const pt = e.head().point;
            let id = index.get(pt);
            if (id === undefined) {
              id = verts.length;
              index.set(pt, id);
              verts.push(new CANNON.Vec3(pt.x - centre.x, pt.y - centre.y, pt.z - centre.z));
            }
            f.push(id);
            e = e.next;
          } while (e !== face.edge);
          faces.push(f);
        }
        if (verts.length >= 4 && faces.length >= 4) {
          _rampBody = new CANNON.Body({
            type: CANNON.Body.STATIC,
            material: _rampPhysMaterial(material),
            collisionFilterGroup: 1,
            collisionFilterMask: -1,
          });
          _rampBody.addShape(new CANNON.ConvexPolyhedron({ vertices: verts, faces }));
          _rampBody.position.set(centre.x, centre.y, centre.z);
          physicsWorld.addBody(_rampBody);
        }
        brandKitchenRamp(mesh);
      }

      // --- ramp look: a racing ramp in the cup's colour palette (colours only) ---
      /** The cup print's palette (sampled from its colours, nothing else of it). */
      const RAMP_COLORS = {
        deck: "#141b33", // deep navy: a very dark shade of the cup's blue (the neon arrows read on it)
        red: "#e3304e", // the cup's red
      };
      /** A subtle self-glow (the print's own colours) so it reads in dark mode too. */
      const RAMP_BRAND_GLOW = 0.3;
      /** Atlas: the ramp's top uses v 0..RAMP_BRAND_TOP_V, its sides / ends the strip below. */
      const RAMP_BRAND_TOP_V = 0.75;
      /** The ramp's frame (set when it's dressed): up-slope / across directions and extents. */
      let _rampFrameInfo = null;

      /** Road border width on the ramp's deck, as a share of its width (each side). */
      const RAMP_BORDER_WIDTH = 0.07;

      /** The ramp's design: one clean road — a dark deck with narrow red borders, foot to edge; red sides. */
      function drawRampBrandCanvas() {
        const W = 2048;
        const H = 1024;
        const cv = document.createElement("canvas");
        cv.width = W;
        cv.height = H;
        const ctx = cv.getContext("2d");
        const C = RAMP_COLORS;
        const top = Math.round(H * RAMP_BRAND_TOP_V);
        // Top: x = along the slope (0 = foot, W = edge), y = across.
        ctx.fillStyle = C.deck;
        ctx.fillRect(0, 0, W, top);
        const border = top * RAMP_BORDER_WIDTH;
        ctx.fillStyle = C.red;
        ctx.fillRect(0, 0, W, border);
        ctx.fillRect(0, top - border, W, border);
        // Sides and the drop face: red.
        ctx.fillRect(0, top, W, H - top);
        return cv;
      }

      /**
       * Re-dress the ramp (look only: same shape, same collider): its geometry
       * copied with UVs per face — the top mapped along the slope / across, the
       * sides and ends to the strip — and a material with the cup's print.
       */
      function brandKitchenRamp(mesh) {
        if (typeof document === "undefined" || !mesh.geometry) return;
        const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        const pos = geo.attributes.position;
        const m = mesh.matrixWorld;
        const nm = new THREE.Matrix3().getNormalMatrix(m);
        const w = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
        // Up-slope direction: where the top faces get higher (opposite their normals' tilt).
        const up = new THREE.Vector3();
        const nrm = new THREE.Vector3();
        const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
        for (let i = 0; i < pos.count; i += 3) {
          for (let k = 0; k < 3; k++) w[k].fromBufferAttribute(pos, i + k).applyMatrix4(m);
          nrm.crossVectors(e1.subVectors(w[1], w[0]), e2.subVectors(w[2], w[0])).normalize();
          if (nrm.y > 0.3 && nrm.y < 0.999) up.add(new THREE.Vector3(-nrm.x, 0, -nrm.z));
        }
        if (up.lengthSq() < 1e-8) up.set(1, 0, 0);
        up.normalize();
        const across = new THREE.Vector3(-up.z, 0, up.x);
        // Extents along / across / height.
        let sMin = Infinity, sMax = -Infinity, tMin = Infinity, tMax = -Infinity, yMin = Infinity, yMax = -Infinity;
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          const s_ = v.x * up.x + v.z * up.z;
          const t_ = v.x * across.x + v.z * across.z;
          sMin = Math.min(sMin, s_); sMax = Math.max(sMax, s_);
          tMin = Math.min(tMin, t_); tMax = Math.max(tMax, t_);
          yMin = Math.min(yMin, v.y); yMax = Math.max(yMax, v.y);
        }
        const uv = new Float32Array(pos.count * 2);
        for (let i = 0; i < pos.count; i += 3) {
          for (let k = 0; k < 3; k++) w[k].fromBufferAttribute(pos, i + k).applyMatrix4(m);
          nrm.crossVectors(e1.subVectors(w[1], w[0]), e2.subVectors(w[2], w[0])).normalize();
          const onTop = nrm.y > 0.3;
          const endFace = Math.abs(nrm.x * up.x + nrm.z * up.z) > 0.7;
          // Seen from outside (looking along −n), a side's "right" is (−n) × up: text reads left → right.
          const rx = nrm.z, rz = -nrm.x;
          const flip = endFace ? rx * across.x + rz * across.z < 0 : rx * up.x + rz * up.z < 0;
          for (let k = 0; k < 3; k++) {
            const s_ = (w[k].x * up.x + w[k].z * up.z - sMin) / Math.max(1e-6, sMax - sMin);
            const t_ = (w[k].x * across.x + w[k].z * across.z - tMin) / Math.max(1e-6, tMax - tMin);
            const h = (w[k].y - yMin) / Math.max(1e-6, yMax - yMin);
            let U, V;
            if (onTop) {
              U = s_;
              V = t_ * RAMP_BRAND_TOP_V;
            } else {
              U = endFace ? t_ : s_;
              if (flip) U = 1 - U;
              V = RAMP_BRAND_TOP_V + (1 - h) * (1 - RAMP_BRAND_TOP_V);
            }
            uv[(i + k) * 2] = U;
            uv[(i + k) * 2 + 1] = V;
          }
        }
        geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        _rampFrameInfo = { up: up.clone(), across: across.clone(), sMin, sMax, tMin, tMax };
        geo.computeVertexNormals();
        const tex = new THREE.CanvasTexture(drawRampBrandCanvas());
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        mesh.geometry = geo;
        mesh.material = new THREE.MeshStandardMaterial({
          map: tex,
          emissive: 0xffffff,
          emissiveMap: tex,
          emissiveIntensity: RAMP_BRAND_GLOW,
          roughness: 0.5,
          metalness: 0,
        });
      }

      /** The ramp's own physics material: no bounce for props landing on it. */
      let _rampMat = null;
      function _rampPhysMaterial() {
        if (_rampMat) return _rampMat;
        _rampMat = new CANNON.Material("ramp");
        for (const [mat, friction] of [[propPhysMaterial, KITCHEN_PROP_FRICTION], [cupPhysMaterial, KITCHEN_CUP_FRICTION]]) {
          physicsWorld.addContactMaterial(
            new CANNON.ContactMaterial(mat, _rampMat, {
              friction,
              restitution: 0,
              contactEquationStiffness: 1e8,
              contactEquationRelaxation: 2,
            }),
          );
        }
        return _rampMat;
      }

      /** The surface under (x, z): its height (table or ramp top) and its normal into `outNormal`. */
      function _rampSurfaceAt(x, z, outNormal) {
        outNormal.set(0, 1, 0);
        if (
          !_rampMesh ||
          x < _rampBox.min.x || x > _rampBox.max.x ||
          z < _rampBox.min.z || z > _rampBox.max.z
        ) {
          return tableSurfaceY;
        }
        _rampRayFrom.set(x, _rampBox.max.y + 1, z);
        _rampRay.set(_rampRayFrom, _rampDown);
        _rampRay.far = _rampBox.max.y - _rampBox.min.y + 2;
        _rampHits.length = 0;
        _rampMesh.raycast(_rampRay, _rampHits);
        let best = null;
        for (const h of _rampHits) if (!best || h.point.y > best.point.y) best = h;
        if (!best || best.point.y <= tableSurfaceY || !best.face) return tableSurfaceY;
        outNormal.copy(best.face.normal).transformDirection(_rampMesh.matrixWorld);
        if (outNormal.y < 0) outNormal.negate();
        return best.point.y;
      }

      /** Ground height under (x, z): the table top, or the ramp's top surface. */
      function kitchenGroundY(x, z) {
        if (
          !_rampMesh ||
          x < _rampBox.min.x || x > _rampBox.max.x ||
          z < _rampBox.min.z || z > _rampBox.max.z
        ) {
          return tableSurfaceY;
        }
        _rampRayFrom.set(x, _rampBox.max.y + 1, z);
        _rampRay.set(_rampRayFrom, _rampDown);
        _rampRay.far = _rampBox.max.y - _rampBox.min.y + 2;
        _rampHits.length = 0;
        _rampMesh.raycast(_rampRay, _rampHits);
        let y = tableSurfaceY;
        for (const h of _rampHits) if (h.point.y > y) y = h.point.y;
        return y;
      }

      /**
       * Ground-follow for any race car (same rules for all): tracks how fast the
       * ground under it rises; when the ground drops away under it (the ramp's
       * edge), returns the vertical speed it leaves the ground with, else null.
       */
      function rampGroundStep(state, curY, restY, dt) {
        state._rampAir = false; // on the ground
        curY -= state._groundOffset || 0; // the car's own settle lift / dip isn't the ground dropping
        if (state._lastRestY === undefined) state._lastRestY = restY;
        if (curY - restY > RAMP_LEAVE_DROP && Math.abs(state.speed) > 0.3) {
          const climb = state._climbVy || 0;
          state._climbVy = 0;
          state._lastRestY = undefined;
          state._rampAir = true;
          // Leaves with the slope's pitch (nose up), not the short flat top's.
          if (climb > RAMP_LAUNCH_MIN_VY) {
            const slope = Math.atan2(climb, Math.max(1, Math.abs(state.speed)));
            state.tiltPitch = Math.max(state.tiltPitch || 0, Math.min(slope, AIR_PITCH_MAX_UP_DEG * _TILT_DEG));
            state.pitchVel = 0;
          }
          return climb > RAMP_LAUNCH_MIN_VY ? Math.min(RAMP_TAKEOFF_MAX_VY, climb * RAMP_TAKEOFF_SCALE) : -0.01;
        }
        const vy = dt > 0 ? (restY - state._lastRestY) / dt : 0;
        state._lastRestY = restY;
        // Keep the peak climb speed over the ramp's short flat top.
        state._climbVy = Math.max(vy, (state._climbVy || 0) * Math.exp(-RAMP_CLIMB_DECAY * dt));
        return null;
      }

      /** Gravity for a car in the air (off the ramp: a clean arc, firmer on the way down). */
      function carAirGravity(state) {
        if (!state._rampAir) return CAR_GRAVITY;
        return RAMP_AIR_GRAVITY + (state.velY < 0 ? RAMP_AIR_EXTRA_GRAVITY_DOWN : 0);
      }

      // ── Car tilt (every car): pitch / roll follow the ground under the wheels
      // (table: level; ramp: its slope), blended smoothly; in the air the pitch
      // arcs with the flight (nose up at takeoff, level at the top, a little
      // nose down falling), lightly damped and clamped; on landing the low end
      // touches first, the car settles onto the ground's angle and dips briefly.
      const CAR_SURFACE_ALIGN_RATE = 12; // 1/s: toward the surface's pitch / roll
      const CAR_SURFACE_MAX_TILT_DEG = 35; // ground pitch / roll clamp
      const AIR_PITCH_FOLLOW = 0.6; // the nose follows this share of the flight path's angle
      const AIR_PITCH_STIFFNESS = 32; // pull toward that angle (1/s²)
      const AIR_PITCH_DAMPING = 9; // airborne angular damping (1/s): light, the arc shows
      const AIR_PITCH_MAX_UP_DEG = 28;
      const AIR_PITCH_MAX_DOWN_DEG = 10;
      const AIR_ROLL_DAMPING = 2; // roll fades in the air (1/s)
      const AIR_ROLL_MAX_DEG = 10;
      const LANDING_SETTLE_RATE = 16; // 1/s: landing pitch → the ground's
      const LANDING_SETTLE_SEC = 0.3;
      const LANDING_COMPRESS = 0.09; // suspension dip at full impact (world units)
      const LANDING_COMPRESS_SEC = 0.22;
      const LANDING_COMPRESS_REF_VY = 14; // landing speed (down) for the full dip
      const _TILT_DEG = Math.PI / 180;
      const _carGround = { pitch: 0, roll: 0 };

      /** Wheel sample offsets (forward / right half distances) from the car's footprint. */
      function carWheelOffsets() {
        const F = _carRailFoot;
        return F.ok ? { lf: F.hf * 0.7, lr: F.hr * 0.75 } : { lf: 1, lr: 0.8 };
      }

      /** Pitch (nose up +) and roll (right side up +) of the ground under the four wheels [FL, FR, RL, RR]. */
      function carGroundAngles(s, lf, lr, out) {
        const m = CAR_SURFACE_MAX_TILT_DEG * _TILT_DEG;
        const front = (s[0] + s[1]) * 0.5, rear = (s[2] + s[3]) * 0.5;
        const left = (s[0] + s[2]) * 0.5, right = (s[1] + s[3]) * 0.5;
        out.pitch = Math.max(-m, Math.min(m, Math.atan2(front - rear, 2 * lf)));
        out.roll = Math.max(-m, Math.min(m, Math.atan2(right - left, 2 * lr)));
        return out;
      }

      /** A car's tilt for this frame (grounded: follow the ground; airborne: the pitch arc). */
      function updateCarTilt(st, grounded, g, dt) {
        if (st.tiltPitch === undefined) {
          st.tiltPitch = 0;
          st.tiltRoll = 0;
          st.pitchVel = 0;
        }
        if (grounded) {
          const rate = st._settleT > 0 ? LANDING_SETTLE_RATE : CAR_SURFACE_ALIGN_RATE;
          if (st._settleT > 0) st._settleT -= dt;
          const k = 1 - Math.exp(-rate * dt);
          const p0 = st.tiltPitch;
          st.tiltPitch += (g.pitch - st.tiltPitch) * k;
          st.tiltRoll += (g.roll - st.tiltRoll) * k;
          st.pitchVel = dt > 0 ? (st.tiltPitch - p0) / dt : 0; // carried into a takeoff
        } else {
          const path = Math.atan2(st.velY, Math.max(1, Math.abs(st.speed))) * AIR_PITCH_FOLLOW;
          const up = AIR_PITCH_MAX_UP_DEG * _TILT_DEG, down = AIR_PITCH_MAX_DOWN_DEG * _TILT_DEG;
          const target = Math.max(-down, Math.min(up, path));
          st.pitchVel += (AIR_PITCH_STIFFNESS * (target - st.tiltPitch) - AIR_PITCH_DAMPING * st.pitchVel) * dt;
          st.tiltPitch = Math.max(-down, Math.min(up, st.tiltPitch + st.pitchVel * dt));
          const rm = AIR_ROLL_MAX_DEG * _TILT_DEG;
          st.tiltRoll = Math.max(-rm, Math.min(rm, st.tiltRoll * Math.exp(-AIR_ROLL_DAMPING * dt)));
        }
      }

      /** Height a tilted car needs so its low end rests on the ground (it settles about it). */
      function carTiltLift(st, g, lf) {
        return Math.abs(Math.sin((st.tiltPitch || 0) - g.pitch)) * lf;
      }

      /**
       * In the air: how far the car's lowest wheel (its own pitch / roll) is
       * below the surface under that wheel ([FL, FR, RL, RR]); > 0 = touching down.
       */
      function carWheelPenetration(y, st, surf, lf, lr) {
        const sp = Math.sin(st.tiltPitch || 0), sr = Math.sin(st.tiltRoll || 0);
        let pen = -Infinity;
        let i = 0;
        for (const f of [1, -1]) {
          for (const r of [-1, 1]) {
            const wheelY = y - carBottomOffsetY + f * lf * sp + r * lr * sr;
            pen = Math.max(pen, surf[i++] - wheelY);
          }
        }
        return pen;
      }

      function onCarLanded(st, impactVy) {
        st._settleT = LANDING_SETTLE_SEC;
        st._compressT = 0;
        st._compressAmp = Math.max(0, Math.min(1, -impactVy / LANDING_COMPRESS_REF_VY));
      }

      /** The landing's suspension dip (down, world units) this step. */
      function carCompressDip(st, dt) {
        if (st._compressT === undefined || st._compressT >= LANDING_COMPRESS_SEC) return 0;
        st._compressT += dt;
        return LANDING_COMPRESS * st._compressAmp * Math.sin(Math.PI * Math.min(1, st._compressT / LANDING_COMPRESS_SEC));
      }

      /** The player's ground under each wheel (footprint corners): table or ramp; and its angles. */
      function sampleCarWheelGround() {
        const { lf, lr } = carWheelOffsets();
        const a = carState.angle + (carState.driftAngle || 0);
        const fx = Math.sin(a), fz = Math.cos(a);
        const rx = Math.cos(a), rz = -Math.sin(a);
        let lo = Infinity;
        let hi = -Infinity;
        let i = 0;
        for (const sf of [1, -1]) {
          for (const sr of [-1, 1]) {
            const w = _wheelSyncWorldPos[i];
            w.set(car.position.x + fx * lf * sf + rx * lr * sr, 0, car.position.z + fz * lf * sf + rz * lr * sr);
            const y = kitchenGroundY(w.x, w.z);
            w.y = y;
            _carWheelSurfY[i] = y;
            if (y < lo) lo = y;
            if (y > hi) hi = y;
            i++;
          }
        }
        _carFrontAxleSurfY = (_carWheelSurfY[0] + _carWheelSurfY[1]) * 0.5;
        _carRearAxleSurfY = (_carWheelSurfY[2] + _carWheelSurfY[3]) * 0.5;
        _carGroundSurfY = hi;
        _carSurfRange = hi - lo;
        carGroundAngles(_carWheelSurfY, lf, lr, _carGround);
      }

      /**
       * An AI race car's height and tilt on the table / ramp: ground-follow,
       * launch off the edge, fall with gravity, land (same rules as the player).
       */
      const _raceWheelSurf = [0, 0, 0, 0];
      const _raceGround = { pitch: 0, roll: 0 };
      function raceCarVerticalStep(rc, dt) {
        const st = rc.state;
        if (!_carRailFoot.ok) return;
        const { lf, lr } = carWheelOffsets();
        const a = st.angle;
        const fx = Math.sin(a), fz = Math.cos(a);
        const rx = Math.cos(a), rz = -Math.sin(a);
        let k = 0;
        let hi = -Infinity;
        for (const sf of [1, -1]) {
          for (const sr of [-1, 1]) {
            const y = kitchenGroundY(rc.pos.x + fx * lf * sf + rx * lr * sr, rc.pos.z + fz * lf * sf + rz * lr * sr);
            _raceWheelSurf[k++] = y;
            if (y > hi) hi = y;
          }
        }
        carGroundAngles(_raceWheelSurf, lf, lr, _raceGround);
        const avg = (_raceWheelSurf[0] + _raceWheelSurf[1] + _raceWheelSurf[2] + _raceWheelSurf[3]) * 0.25;
        const rest = avg + carBottomOffsetY;
        if (st.velY !== 0) {
          rc.pos.y += st.velY * dt;
          st.velY -= carAirGravity(st) * dt;
          const pen = carWheelPenetration(rc.pos.y, st, _raceWheelSurf, lf, lr);
          if (pen >= 0 && st.velY <= 0) {
            // The low wheel touches first; the car settles about it from here.
            rc.pos.y += pen;
            st._groundOffset = rc.pos.y - rest;
            onCarLanded(st, st.velY);
            st.velY = 0;
            st._rampAir = false;
            st._lastRestY = undefined;
          }
        } else {
          const launch = rampGroundStep(st, rc.pos.y, rest, dt);
          if (launch !== null) {
            st.velY = launch;
            st._groundOffset = 0;
          } else {
            st._groundOffset = carTiltLift(st, _raceGround, lf) - carCompressDip(st, dt);
            rc.pos.y = rest + st._groundOffset;
          }
        }
        updateCarTilt(st, st.velY === 0, _raceGround, dt);
      }

      // ── Race boundaries: the car is stopped by the rails (raceBoundariesPhysic).
      // The car is moved by code, not the solver, so the rails are a list of
      // vertical wall segments in xz and the car's footprint rectangle is pushed
      // out of them each car step.
      // Sliding along the rails: the car keeps the part of its motion along the
      // wall; how much speed it keeps depends on how directly it hit (impact =
      // |heading · wall normal|: 0 glancing … 1 head-on), and its heading turns
      // toward the wall's direction (the one closest to its travel).
      const RAIL_KEEP_GLANCING = 0.98; // speed kept on a glancing contact (no grip)
      const RAIL_KEEP_HEAD_ON = 0.4; // speed kept on a head-on hit (never a full stop)
      const RAIL_IMPACT_CURVE = 1.6; // > 1: shallow angles stay close to the glancing value
      const RAIL_ALIGN_RATE = 7; // heading turn toward the wall's direction (1/s, × impact)
      const RAIL_DEFLECT = 0.55; // immediate slide along the wall on a hit (× kept speed × impact)
      const RAIL_RESTITUTION = 0.08; // small push-back off the wall (× speed into it)
      /** Off the wall this long (seconds) before the next contact counts as a new hit. */
      const RAIL_RECONTACT_SEC = 0.15;
      const _railSegs = []; // [ax, az, bx, bz, ...]
      let _railTopY = -Infinity;
      let _railBottomY = Infinity;
      // Car footprint in the car's own frame (right / forward), from the bumper box.
      const _carRailFoot = { ok: false, lr: 0, lf: 0, hr: 0, hf: 0 };
      /**
       * The rails for everything the physics engine moves (props, cups, fruit plates, food, a falling car):
       * raceBoundariesPhysic has no thickness (one wall face per rail piece), so each piece gets a static
       * box whose inner face lies on the rail line and which is thickened outward (away from the track),
       * from just under the rail's bottom to its top. Collides with every physics group except the
       * drive-controlled cars' own proxies (they use collideCarWithRails).
       */
      const RAIL_COLLIDER = {
        /** Box thickness, added outward from the rail line (world units). */
        thickness: 0.45,
        /** How far the boxes reach below the rail's bottom (into the table top: no gap under them). */
        sink: 0.05,
        /** Extra length at each end of a piece (closes the hairline gaps between a piece's triangles). */
        endOverlap: 0.02,
      };
      /**
       * Crossing guard (every physics step, for every moving body): a body whose centre crossed a rail
       * piece's line since the last step (too fast for the solver, or moved by a push-out) is put back on
       * its side, `backOff` inside (at most its radius), and its speed into the wall is bounced back by
       * `restitution` (0 = stops against it).
       */
      const RAIL_GUARD = { backOff: 0.3, restitution: 0.1 };
      let _railBody = null;
      let _railGuardOn = false;

      function buildKitchenRaceBoundaries(model) {
        _railSegs.length = 0;
        const mesh = model.getObjectByName("raceBoundariesPhysic");
        if (!mesh || !mesh.isMesh) return;
        mesh.updateMatrixWorld(true);
        const geo = mesh.geometry;
        const pos = geo.attributes.position;
        const idx = geo.index;
        const triCount = idx ? idx.count / 3 : pos.count / 3;
        const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
        const seen = new Set();
        for (let t = 0; t < triCount; t++) {
          for (let k = 0; k < 3; k++) {
            const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k;
            v[k].fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld);
            if (v[k].y > _railTopY) _railTopY = v[k].y;
            if (v[k].y < _railBottomY) _railBottomY = v[k].y;
          }
          // A vertical wall triangle projects onto a line: keep its two extreme points.
          let best = -1;
          let ia = 0;
          let ib = 1;
          for (const [a, b] of [[0, 1], [1, 2], [0, 2]]) {
            const d = (v[a].x - v[b].x) ** 2 + (v[a].z - v[b].z) ** 2;
            if (d > best) { best = d; ia = a; ib = b; }
          }
          if (best < 1e-6) continue;
          const r = (n) => Math.round(n * 1000);
          const ka = r(v[ia].x) + "," + r(v[ia].z);
          const kb = r(v[ib].x) + "," + r(v[ib].z);
          const key = ka < kb ? ka + "|" + kb : kb + "|" + ka;
          if (seen.has(key)) continue;
          seen.add(key);
          _railSegs.push(v[ia].x, v[ia].z, v[ib].x, v[ib].z);
        }
        buildKitchenRailCollider();
      }

      /** One static body: a box per rail piece (RAIL_COLLIDER), plus the crossing guard (RAIL_GUARD). */
      function buildKitchenRailCollider() {
        if (_railBody) {
          _safeRemoveBody(_railBody);
          _railBody = null;
        }
        if (!physicsWorld || _railSegs.length === 0) return;
        // The track's middle: the rails' own centre (the outward side of a piece faces away from it).
        let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
        for (let i = 0; i < _railSegs.length; i += 2) {
          mnx = Math.min(mnx, _railSegs[i]);
          mxx = Math.max(mxx, _railSegs[i]);
          mnz = Math.min(mnz, _railSegs[i + 1]);
          mxz = Math.max(mxz, _railSegs[i + 1]);
        }
        const midX = (mnx + mxx) / 2;
        const midZ = (mnz + mxz) / 2;
        const RC = RAIL_COLLIDER;
        const bottom = _railBottomY - RC.sink;
        const height = _railTopY - bottom;
        const body = new CANNON.Body({
          mass: 0,
          type: CANNON.Body.STATIC,
          material: tablePlatePhysicsMaterial, // the same contact as the table (props, cups, food, falling car)
          collisionFilterGroup: PHYS_GROUP_DEFAULT,
          collisionFilterMask: ~(PHYS_GROUP_CAR | PHYS_GROUP_PROP_BUMPER),
        });
        const yAxis = new CANNON.Vec3(0, 1, 0);
        for (let i = 0; i < _railSegs.length; i += 4) {
          const ax = _railSegs[i], az = _railSegs[i + 1], bx = _railSegs[i + 2], bz = _railSegs[i + 3];
          const len = Math.hypot(bx - ax, bz - az);
          if (len < 1e-4) continue;
          const tx = (bx - ax) / len, tz = (bz - az) / len;
          // Outward normal: away from the track's middle.
          let nx = -tz, nz = tx;
          const cx = (ax + bx) / 2, cz = (az + bz) / 2;
          if ((cx - midX) * nx + (cz - midZ) * nz < 0) {
            nx = -nx;
            nz = -nz;
          }
          const q = new CANNON.Quaternion();
          q.setFromAxisAngle(yAxis, Math.atan2(-tz, tx)); // the box's x axis along the piece
          body.addShape(
            new CANNON.Box(new CANNON.Vec3(len / 2 + RC.endOverlap, height / 2, RC.thickness / 2)),
            new CANNON.Vec3(cx + nx * RC.thickness / 2, bottom + height / 2, cz + nz * RC.thickness / 2),
            q,
          );
        }
        physicsWorld.addBody(body);
        _railBody = body;
        if (!_railGuardOn) {
          physicsWorld.addEventListener("postStep", guardBodiesAtRails);
          _railGuardOn = true;
        }
      }

      /** Did the centre path p → c (xz) cross a rail piece (between its ends)? Returns the piece's index, or -1. */
      function railCrossing(px, pz, qx, qz, out) {
        let hit = -1;
        let bestT = Infinity;
        const dx = qx - px, dz = qz - pz;
        for (let i = 0; i < _railSegs.length; i += 4) {
          const ax = _railSegs[i], az = _railSegs[i + 1];
          const sx = _railSegs[i + 2] - ax, sz = _railSegs[i + 3] - az;
          const den = dx * sz - dz * sx;
          if (Math.abs(den) < 1e-12) continue;
          const t = ((ax - px) * sz - (az - pz) * sx) / den; // along the path
          const u = ((ax - px) * dz - (az - pz) * dx) / den; // along the piece
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          if (t < bestT) {
            bestT = t;
            hit = i;
          }
        }
        if (hit >= 0 && out) out.t = bestT;
        return hit;
      }

      const _railHit = { t: 0 };
      /**
       * After every physics step: no moving body's centre may have crossed a rail piece since the last
       * step (its last position is kept on the body). Crossed: back on its own side, speed into the wall
       * bounced back softly.
       */
      function guardBodiesAtRails() {
        if (!physicsWorld || _railSegs.length === 0) return;
        const bodies = physicsWorld.bodies;
        for (let k = 0; k < bodies.length; k++) {
          const b = bodies[k];
          if (b.type !== CANNON.Body.DYNAMIC) continue;
          // The drive-controlled cars' proxies (and a falling car) are not physics-driven across the table.
          if (b.collisionFilterGroup & (PHYS_GROUP_CAR | PHYS_GROUP_CAR_FALL | PHYS_GROUP_PROP_BUMPER)) continue;
          const p = b.position;
          const last = b._railLast;
          if (last) {
            const r = Math.min(b.boundingRadius || 0.3, 1);
            const y = Math.min(p.y, last.y);
            if (y - r < _railTopY && Math.max(p.y, last.y) + r > _railBottomY) {
              const i = railCrossing(last.x, last.z, p.x, p.z, _railHit);
              if (i >= 0) {
                const ax = _railSegs[i], az = _railSegs[i + 1];
                const sx = _railSegs[i + 2] - ax, sz = _railSegs[i + 3] - az;
                const sl = Math.hypot(sx, sz) || 1;
                // Normal toward the side it came from.
                let nx = -sz / sl, nz = sx / sl;
                if ((last.x - ax) * nx + (last.z - az) * nz < 0) {
                  nx = -nx;
                  nz = -nz;
                }
                // Back to where it met the line, then inside by backOff (at most its radius).
                const hx = last.x + (p.x - last.x) * _railHit.t;
                const hz = last.z + (p.z - last.z) * _railHit.t;
                const back = Math.min(RAIL_GUARD.backOff, r);
                p.x = hx + nx * back;
                p.z = hz + nz * back;
                const vn = b.velocity.x * nx + b.velocity.z * nz;
                if (vn < 0) {
                  b.velocity.x -= (1 + RAIL_GUARD.restitution) * vn * nx;
                  b.velocity.z -= (1 + RAIL_GUARD.restitution) * vn * nz;
                }
                b.aabbNeedsUpdate = true;
              }
            }
          } else {
            b._railLast = new CANNON.Vec3();
          }
          b._railLast.copy(p);
        }
      }

      function captureCarRailFootprint(bodyPos, ex, ez) {
        if (!canonBodyPhys) return;
        const a = carState.angle;
        const fx = Math.sin(a), fz = Math.cos(a);
        const rx = Math.cos(a), rz = -Math.sin(a);
        const ax = new CANNON.Vec3(1, 0, 0);
        canonBodyPhys.quaternion.vmult(ax, ax);
        const xIsRight = Math.abs(ax.x * rx + ax.z * rz) >= Math.abs(ax.x * fx + ax.z * fz);
        const dx = bodyPos.x - car.position.x;
        const dz = bodyPos.z - car.position.z;
        _carRailFoot.lr = dx * rx + dz * rz;
        _carRailFoot.lf = dx * fx + dz * fz;
        _carRailFoot.hr = xIsRight ? ex : ez;
        _carRailFoot.hf = xIsRight ? ez : ex;
        _carRailFoot.ok = true;
      }

      /**
       * Rails: push the car's footprint out of the wall segments and let it slide
       * along them. Overlap is tested with SAT (car axes + segment normal), but
       * the push-out is always along the wall's normal (or from a rail piece's
       * end point at its tips), never along the car's own axes, so it never
       * catches on seams / piece ends. Moving into the wall: the speed kept
       * depends on the impact angle, the heading turns toward the wall's
       * direction, and a slide along the wall starts right away.
       */
      /** The car footprint's centre (xz) for a drive state at `pos`. */
      function carRailCentre(pos, angle, out) {
        const F = _carRailFoot;
        const fx = Math.sin(angle), fz = Math.cos(angle);
        const rx = Math.cos(angle), rz = -Math.sin(angle);
        out.x = pos.x + rx * F.lr + fx * F.lf;
        out.z = pos.z + rz * F.lr + fz * F.lf;
        return out;
      }
      /** A centre jump longer than this between car steps is a teleport (reset / respawn), not a move. */
      const RAIL_CAR_TELEPORT = 3;
      const _railCentre = { x: 0, z: 0 };

      function collideCarWithRails(pos, state, dt = 1 / 60) {
        if (!_carRailFoot.ok || _railSegs.length === 0) return;
        const carBottom = pos.y - carBottomOffsetY;
        if (carBottom > _railTopY || pos.y < _railBottomY - 1) {
          state._railPrev = null; // above / below the rails: no side to keep
          return;
        }
        const F = _carRailFoot;
        // The side of each rail the car was on at its last step: a car whose centre was carried across a
        // thin rail line (a hard shove, a big bump) is pushed back to that side, never out the far one.
        const prev = state._railPrev;
        carRailCentre(pos, state.angle, _railCentre);
        const prevOk = !!prev && Math.hypot(_railCentre.x - prev.x, _railCentre.z - prev.z) < RAIL_CAR_TELEPORT;
        const crossed = prevOk ? railCrossing(prev.x, prev.z, _railCentre.x, _railCentre.z, null) : -1;
        let slideNx = 0, slideNz = 0, slideHit = false;
        for (let iter = 0; iter < 3; iter++) {
          let any = false;
          for (let i = 0; i < _railSegs.length; i += 4) {
            const a = state.angle;
            const fx = Math.sin(a), fz = Math.cos(a);
            const rx = Math.cos(a), rz = -Math.sin(a);
            const cx = pos.x + rx * F.lr + fx * F.lf;
            const cz = pos.z + rz * F.lr + fz * F.lf;
            const ax = _railSegs[i], az = _railSegs[i + 1];
            const bx = _railSegs[i + 2], bz = _railSegs[i + 3];
            const sx = bx - ax, sz = bz - az;
            const sl = Math.hypot(sx, sz);
            if (sl < 1e-6) continue;
            const tx = sx / sl, tz = sz / sl;
            // Overlap (SAT on car right / forward / segment normal); a piece the centre crossed always counts.
            const axes = [rx, rz, fx, fz, -tz, tx];
            let separated = false;
            for (let k = 0; k < 6 && i !== crossed; k += 2) {
              const ux = axes[k], uz = axes[k + 1];
              const rad = F.hr * Math.abs(ux * rx + uz * rz) + F.hf * Math.abs(ux * fx + uz * fz);
              const c = cx * ux + cz * uz;
              const p0 = ax * ux + az * uz, p1 = bx * ux + bz * uz;
              if (c + rad <= Math.min(p0, p1) || c - rad >= Math.max(p0, p1)) {
                separated = true;
                break;
              }
            }
            if (separated) continue;
            // Push-out direction: the wall normal toward the car while the car's
            // centre is alongside the segment; past its ends, away from the end point.
            const along = (cx - ax) * tx + (cz - az) * tz;
            let nx, nz;
            if (along >= 0 && along <= sl) {
              nx = -tz;
              nz = tx;
              // Toward the side the car came from (its last step's centre), else its centre's side.
              const sideX = prevOk ? prev.x : cx;
              const sideZ = prevOk ? prev.z : cz;
              if ((sideX - ax) * nx + (sideZ - az) * nz < 0) {
                nx = -nx;
                nz = -nz;
              }
            } else {
              const ex = along < 0 ? ax : bx, ez = along < 0 ? az : bz;
              nx = cx - ex;
              nz = cz - ez;
              const nl = Math.hypot(nx, nz);
              if (nl < 1e-6) continue;
              nx /= nl;
              nz /= nl;
            }
            // Depth along that direction: the car's extent toward the wall vs the wall.
            const rad = F.hr * Math.abs(nx * rx + nz * rz) + F.hf * Math.abs(nx * fx + nz * fz);
            const wall = Math.max(ax * nx + az * nz, bx * nx + bz * nz);
            const depth = wall - (cx * nx + cz * nz - rad);
            if (!(depth > 0)) continue;
            pos.x += nx * depth;
            pos.z += nz * depth;
            any = true;
            slideHit = true;
            slideNx += nx;
            slideNz += nz;
            // A collision push (from another car) never carries on into the rail.
            if (state.bumpVX || state.bumpVZ) {
              const bn = state.bumpVX * nx + state.bumpVZ * nz;
              if (bn < 0) {
                state.bumpVX -= bn * nx;
                state.bumpVZ -= bn * nz;
              }
            }
          }
          if (!any) break;
        }
        // This step's (pushed-out) centre: the side to keep next step.
        carRailCentre(pos, state.angle, _railCentre);
        if (!state._railPrev) state._railPrev = { x: 0, z: 0 };
        state._railPrev.x = _railCentre.x;
        state._railPrev.z = _railCentre.z;
        if (!slideHit) {
          state._railFree = (state._railFree ?? 1) + dt;
          return;
        }
        // Sliding response (against the combined wall normal). The angle-based
        // speed loss and the slide start once per contact; while the car stays
        // against the wall only its heading keeps straightening along it.
        const firstStep = (state._railFree ?? 1) > RAIL_RECONTACT_SEC;
        state._railFree = 0;
        const nl = Math.hypot(slideNx, slideNz);
        if (nl < 1e-6) return;
        const nx = slideNx / nl, nz = slideNz / nl;
        railSparksAtContact(pos, state, nx, nz, firstStep, dt); // visual only (RAIL_SPARKS)
        const a = state.angle;
        const fx = Math.sin(a), fz = Math.cos(a);
        const sgn = state.speed >= 0 ? 1 : -1;
        const vxDir = fx * sgn, vzDir = fz * sgn; // travel direction
        const into = vxDir * nx + vzDir * nz; // < 0: moving into the wall
        if (into >= 0 || Math.abs(state.speed) < 0.05) return;
        const impact = Math.min(1, -into);
        const keep = RAIL_KEEP_GLANCING + (RAIL_KEEP_HEAD_ON - RAIL_KEEP_GLANCING) * Math.pow(impact, RAIL_IMPACT_CURVE);
        const speedIn = Math.abs(state.speed);
        if (firstStep) state.speed *= keep;
        // The wall's direction closest to the travel direction.
        let txs = -nz, tzs = nx;
        if (txs * vxDir + tzs * vzDir < 0) {
          txs = -txs;
          tzs = -tzs;
        }
        // Slide along it right away; a small push-back off the wall.
        if (firstStep) {
          const slide = speedIn * keep * impact * RAIL_DEFLECT;
          state.bumpVX = (state.bumpVX || 0) + txs * slide + nx * speedIn * impact * RAIL_RESTITUTION;
          state.bumpVZ = (state.bumpVZ || 0) + tzs * slide + nz * speedIn * impact * RAIL_RESTITUTION;
        }
        // Heading turns toward that direction (reversing: the car's back leads).
        const target = Math.atan2(txs * sgn, tzs * sgn);
        let dA = target - a;
        dA = Math.atan2(Math.sin(dA), Math.cos(dA));
        state.angle += dA * Math.min(1, RAIL_ALIGN_RATE * impact * dt);
      }

      // ── Sparks where a car hits or scrapes the rails (raceBoundariesPhysic) ──
      // Visual only, fed by collideCarWithRails (each car on its own): a burst at
      // the contact point on a hit (more and faster sparks the harder it is), a
      // steady stream while it slides along the wall (rate and speed with the
      // slide speed), none for soft touches. Sparks fly off the wall and back
      // against the car's travel, fall, bounce once on the table and fade (white
      // / yellow core → orange) with a short streak behind them. One pooled set
      // of points + streak lines for every car (capped), and one shared flash
      // light for strong hits.
      const RAIL_SPARKS = {
        /** Pool size: the most sparks alive at once (the oldest is reused beyond it). */
        max: 420,
        /** Hit: speed into the wall (units/s) below which nothing sparks, and the speed that gives the full burst. */
        impactThreshold: 1.5,
        impactFull: 12,
        /** Burst size: sparks at the threshold / at full. */
        burstMin: 4,
        burstMax: 36,
        /** Scrape: speed along the wall (units/s) below which nothing sparks, the speed for the full rate, and that rate (sparks/s). */
        scrapeThreshold: 2,
        scrapeFull: 14,
        scrapeRate: 124,
        /** Spark speed (units/s): soft / full contact (× a random 0.55–1). */
        speedMin: 1.7,
        speedMax: 6.6,
        /** Direction mix: off the wall, back against the car's travel, upward; plus a random spread. */
        dirWall: 0.7,
        dirBack: 0.9,
        dirUp: 0.55,
        spread: 0.57,
        /** Life (s): random within this range. */
        life: [0.19, 0.44],
        /** Far sparks: this share of them is launched faster (speed × farSpeed, random within) and lives longer
         *  (life × farLife), so they arc much farther; the rest stay close to the contact. */
        farShare: 0.3,
        farSpeed: [1.5, 2.4],
        farLife: [1.8, 2.8],
        /** Upward sparks: this share flies up instead, tilted from straight up by upAngle (degrees, random within),
         *  leaning off the wall and back against the travel, at speed × upSpeed (random within). */
        upShare: 0.35,
        upAngle: [8, 40],
        upSpeed: [0.9, 1.4],
        /** Gravity (units/s²), and the bounce on the table (share of vertical speed kept; sideways × 0.6). */
        gravity: 16,
        bounce: 0.3,
        /** Head size (world units at 1 unit away, perspective) and the streak's length (× velocity, seconds). */
        size: 0.125,
        streak: 0.035,
        /** Colours (start → end of life) and brightness (HDR × colour; above the kitchen bloom's threshold, 12, the young sparks glow; the streak at a share of it). */
        colorHot: 0xfff6d8,
        colorMid: 0xffc24a,
        colorEnd: 0xff6a1a,
        brightness: 12.2,
        streakBrightness: 0.3,
        /** Contact height: this far below the rails' top (where a bumper meets them). */
        below: 0.2,
        /** Flash on strong hits: hit strength (0–1) it starts from, peak intensity, range (units), fade time (s), colour. */
        flashFrom: 0.45,
        flashIntensity: 25,
        flashRange: 5.5,
        flashTime: 0.12,
        flashColor: 0xffb35a,
      };
      const _rsN = RAIL_SPARKS.max;
      const _rsPos = new Float32Array(_rsN * 3);
      const _rsVel = new Float32Array(_rsN * 3);
      const _rsAge = new Float32Array(_rsN).fill(1);
      const _rsLife = new Float32Array(_rsN).fill(1);
      let _rsNext = 0; // next pool slot (round robin: the oldest goes first)
      let _rsAlive = 0;
      let _railStepId = 0; // car step counter: one scrape emission per car per step
      const _rsHeadGeo = new THREE.BufferGeometry();
      const _rsHeadPos = new Float32Array(_rsN * 3);
      const _rsHeadCol = new Float32Array(_rsN * 3);
      _rsHeadGeo.setAttribute("position", new THREE.BufferAttribute(_rsHeadPos, 3).setUsage(THREE.DynamicDrawUsage));
      _rsHeadGeo.setAttribute("color", new THREE.BufferAttribute(_rsHeadCol, 3).setUsage(THREE.DynamicDrawUsage));
      const _rsLineGeo = new THREE.BufferGeometry();
      const _rsLinePos = new Float32Array(_rsN * 6);
      const _rsLineCol = new Float32Array(_rsN * 6);
      _rsLineGeo.setAttribute("position", new THREE.BufferAttribute(_rsLinePos, 3).setUsage(THREE.DynamicDrawUsage));
      _rsLineGeo.setAttribute("color", new THREE.BufferAttribute(_rsLineCol, 3).setUsage(THREE.DynamicDrawUsage));
      let _rsHeads = null;
      let _rsLines = null;
      let _rsFlash = null;
      const _rsColHot = new THREE.Color(RAIL_SPARKS.colorHot);
      const _rsColMid = new THREE.Color(RAIL_SPARKS.colorMid);
      const _rsColEnd = new THREE.Color(RAIL_SPARKS.colorEnd);
      const _rsCol = new THREE.Color();

      /** Made on first use (the glow texture is ready by then). */
      function ensureRailSparks() {
        if (_rsHeads) return;
        _rsHeads = new THREE.Points(
          _rsHeadGeo,
          new THREE.PointsMaterial({
            size: RAIL_SPARKS.size,
            sizeAttenuation: true,
            map: getTableLightGlowTexture(), // round, soft sparks
            vertexColors: true,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
        );
        _rsLines = new THREE.LineSegments(
          _rsLineGeo,
          new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
        );
        for (const o of [_rsHeads, _rsLines]) {
          o.frustumCulled = false; // the pool spans the whole table
          o.renderOrder = 7;
          o.visible = false;
          scene.add(o);
        }
        // Always in the scene (intensity 0 when idle): the light count never changes.
        _rsFlash = new THREE.PointLight(RAIL_SPARKS.flashColor, 0, RAIL_SPARKS.flashRange, 2);
        scene.add(_rsFlash);
      }

      /** `count` sparks at (x, y, z): off the wall (nx, nz), back against the travel (bx, bz), at strength 0–1. */
      function emitRailSparks(x, y, z, nx, nz, bx, bz, count, strength) {
        ensureRailSparks();
        const S = RAIL_SPARKS;
        const speed = S.speedMin + (S.speedMax - S.speedMin) * strength;
        const rr = (r) => r[0] + (r[1] - r[0]) * Math.random();
        for (let k = 0; k < count; k++) {
          const i = _rsNext;
          _rsNext = (_rsNext + 1) % _rsN;
          let dx, dy, dz;
          let speedMul = 1, lifeMul = 1;
          const kind = Math.random();
          if (kind < S.upShare) {
            // Upward: tilted from straight up, toward off the wall / back against the travel (and a little sideways).
            const tilt = THREE.MathUtils.degToRad(rr(S.upAngle));
            let hx = nx * S.dirWall + bx * S.dirBack + (Math.random() * 2 - 1) * S.spread;
            let hz = nz * S.dirWall + bz * S.dirBack + (Math.random() * 2 - 1) * S.spread;
            const hl = Math.hypot(hx, hz) || 1;
            dx = (hx / hl) * Math.sin(tilt);
            dy = Math.cos(tilt);
            dz = (hz / hl) * Math.sin(tilt);
            speedMul = rr(S.upSpeed);
          } else {
            dx = nx * S.dirWall + bx * S.dirBack + (Math.random() * 2 - 1) * S.spread;
            dy = S.dirUp + (Math.random() * 2 - 1) * S.spread * 0.8;
            dz = nz * S.dirWall + bz * S.dirBack + (Math.random() * 2 - 1) * S.spread;
          }
          if (Math.random() < S.farShare) {
            // A far one: faster and longer lived (it arcs much farther).
            speedMul *= rr(S.farSpeed);
            lifeMul = rr(S.farLife);
          }
          const l = Math.hypot(dx, dy, dz) || 1;
          const v = speed * speedMul * (0.55 + 0.45 * Math.random()) / l;
          _rsPos[i * 3] = x;
          _rsPos[i * 3 + 1] = y;
          _rsPos[i * 3 + 2] = z;
          _rsVel[i * 3] = dx * v;
          _rsVel[i * 3 + 1] = dy * v;
          _rsVel[i * 3 + 2] = dz * v;
          _rsAge[i] = 0;
          _rsLife[i] = (S.life[0] + (S.life[1] - S.life[0]) * Math.random()) * lifeMul;
        }
      }

      /**
       * From collideCarWithRails while a car touches a rail (combined wall normal nx, nz toward the car):
       * a burst on the first step of a contact, a stream while it slides.
       */
      function railSparksAtContact(pos, state, nx, nz, firstStep, dt) {
        const S = RAIL_SPARKS;
        const a = state.angle;
        const fx = Math.sin(a), fz = Math.cos(a);
        const rx = Math.cos(a), rz = -Math.sin(a);
        // The car's velocity (drive + any push it's carrying).
        const vx = fx * state.speed + (state.bumpVX || 0);
        const vz = fz * state.speed + (state.bumpVZ || 0);
        const vInto = -(vx * nx + vz * nz);
        const tx = -nz, tz = nx;
        const vAlong = vx * tx + vz * tz;
        // Contact point: the footprint's extreme point toward the wall (on the wall line after the push-out).
        const F = _carRailFoot;
        carRailCentre(pos, a, _railCentre);
        const rad = F.hr * Math.abs(nx * rx + nz * rz) + F.hf * Math.abs(nx * fx + nz * fz);
        const cx = _railCentre.x - nx * rad;
        const cz = _railCentre.z - nz * rad;
        const cy = _railTopY - S.below;
        // Back against the car's travel along the wall.
        const sb = vAlong >= 0 ? -1 : 1;
        const bx = tx * sb, bz = tz * sb;
        if (firstStep && vInto > S.impactThreshold) {
          const strength = Math.min(1, (vInto - S.impactThreshold) / Math.max(0.01, S.impactFull - S.impactThreshold));
          const count = Math.round(S.burstMin + (S.burstMax - S.burstMin) * strength);
          emitRailSparks(cx, cy, cz, nx, nz, bx, bz, count, strength);
          if (strength >= S.flashFrom && _rsFlash) {
            _rsFlash.position.set(cx + nx * 0.3, cy + 0.2, cz + nz * 0.3);
            _rsFlash.intensity = Math.max(_rsFlash.intensity, S.flashIntensity * strength);
          }
        }
        // Scrape: once per car per car step (the rails are checked twice for the AI cars).
        if (state._sparkStep === _railStepId) return;
        state._sparkStep = _railStepId;
        const slide = Math.abs(vAlong);
        if (slide <= S.scrapeThreshold) {
          state._sparkAcc = 0;
          return;
        }
        const strength = Math.min(1, (slide - S.scrapeThreshold) / Math.max(0.01, S.scrapeFull - S.scrapeThreshold));
        state._sparkAcc = (state._sparkAcc || 0) + S.scrapeRate * strength * dt;
        const n = Math.floor(state._sparkAcc);
        if (n > 0) {
          state._sparkAcc -= n;
          emitRailSparks(cx, cy, cz, nx, nz, bx, bz, n, strength);
        }
      }

      /** Every frame: move, fade and draw the sparks; the flash fades. */
      function updateRailSparks(dt) {
        if (!_rsHeads) return;
        const S = RAIL_SPARKS;
        if (_rsFlash.intensity > 0.01) _rsFlash.intensity *= Math.exp(-dt / S.flashTime);
        else _rsFlash.intensity = 0;
        const floorY = _railBottomY; // the table top under the rails
        _rsAlive = 0;
        for (let i = 0; i < _rsN; i++) {
          const k = i * 3;
          const k6 = i * 6;
          if (_rsAge[i] >= _rsLife[i]) {
            _rsHeadCol[k] = _rsHeadCol[k + 1] = _rsHeadCol[k + 2] = 0;
            for (let j = 0; j < 6; j++) _rsLineCol[k6 + j] = 0;
            continue;
          }
          _rsAge[i] += dt;
          _rsVel[k + 1] -= S.gravity * dt;
          _rsPos[k] += _rsVel[k] * dt;
          _rsPos[k + 1] += _rsVel[k + 1] * dt;
          _rsPos[k + 2] += _rsVel[k + 2] * dt;
          if (_rsPos[k + 1] < floorY && _rsVel[k + 1] < 0) {
            _rsPos[k + 1] = floorY;
            _rsVel[k + 1] *= -S.bounce;
            _rsVel[k] *= 0.6;
            _rsVel[k + 2] *= 0.6;
          }
          const t = Math.min(1, _rsAge[i] / _rsLife[i]);
          // White / yellow core → orange, fading fast at the end.
          if (t < 0.35) _rsCol.copy(_rsColHot).lerp(_rsColMid, t / 0.35);
          else _rsCol.copy(_rsColMid).lerp(_rsColEnd, (t - 0.35) / 0.65);
          const fade = (1 - t) * (1 - t) * S.brightness;
          _rsHeadPos[k] = _rsPos[k];
          _rsHeadPos[k + 1] = _rsPos[k + 1];
          _rsHeadPos[k + 2] = _rsPos[k + 2];
          _rsHeadCol[k] = _rsCol.r * fade;
          _rsHeadCol[k + 1] = _rsCol.g * fade;
          _rsHeadCol[k + 2] = _rsCol.b * fade;
          // Streak: from the head back along the velocity.
          _rsLinePos[k6] = _rsPos[k];
          _rsLinePos[k6 + 1] = _rsPos[k + 1];
          _rsLinePos[k6 + 2] = _rsPos[k + 2];
          _rsLinePos[k6 + 3] = _rsPos[k] - _rsVel[k] * S.streak;
          _rsLinePos[k6 + 4] = _rsPos[k + 1] - _rsVel[k + 1] * S.streak;
          _rsLinePos[k6 + 5] = _rsPos[k + 2] - _rsVel[k + 2] * S.streak;
          const sf = fade * S.streakBrightness;
          _rsLineCol[k6] = _rsCol.r * sf;
          _rsLineCol[k6 + 1] = _rsCol.g * sf;
          _rsLineCol[k6 + 2] = _rsCol.b * sf;
          _rsLineCol[k6 + 3] = _rsLineCol[k6 + 4] = _rsLineCol[k6 + 5] = 0; // its tail fades out
          _rsAlive++;
        }
        const on = _rsAlive > 0;
        _rsHeads.visible = _rsLines.visible = on;
        if (on) {
          _rsHeadGeo.attributes.position.needsUpdate = true;
          _rsHeadGeo.attributes.color.needsUpdate = true;
          _rsLineGeo.attributes.position.needsUpdate = true;
          _rsLineGeo.attributes.color.needsUpdate = true;
        }
      }

      // ── Kitchen race ─────────────────────────────────────────────────────
      // A 4-lap race around the table: the player against 2 AI cars. The AI
      // cars are copies of the player's car model, driven by the same
      // stepCarDrive() / collideCarWithRails() code with AI inputs.
      const RACE_GRID_GAP = 4; // progress units between grid slots
      const RACE_ISLAND_MARGIN = 0.55;
      /** Gap kept between the AI's widest turn line and raceBoundaries, beyond half the car's width. */
      const RACE_TRACK_X_BUFFER = 0.6;
      const RACE_START_DELAY_SEC = 1.4;
      const RACE_GO_SHOW_SEC = 0.9;
      const RACE_AI_CARS = [
        {
          name: "Blue",
          color: 0x1f6fff,
          lateral: -0.45,
          speedFactor: 1,
          turnSpeedFactor: 0.9,
          lookahead: 4,
          turnWiden: 1.1,
          wobble: 0.35,
          wobbleRate: 0.13,
          phase: 0,
        },
        {
          name: "Green",
          color: 0x22c35e,
          lateral: 0.55,
          speedFactor: 0.97,
          turnSpeedFactor: 0.85,
          lookahead: 4.6,
          turnWiden: 0.8,
          wobble: 0.5,
          wobbleRate: 0.09,
          phase: 1.7,
        },
      ];
      // Grid order (front to back): AI 0, player, AI 1.
      const RACE_GRID_ORDER = ["ai0", "player", "ai1"];
      const _raceNoInput = { forward: false, reverse: false, left: false, right: false, brake: false };
      let _raceTrack = null;
      // finishing: a car has finished, the race goes on until the player
      // finishes (or RACE_RESULTS_MAX_WAIT_SEC); finished: results popup open.
      let _racePhase = "off"; // off | intro | waiting | countdown | racing | finishing | finished
      let _raceTimer = 0;
      /** Race clock (world seconds since GO), stopped once the results open. */
      let _raceElapsed = 0;
      /** Time since the winner finished (finishing phase). */
      let _raceEndWait = 0;
      /** Countdown to opening the results popup (< 0: not scheduled). */
      let _raceResultsIn = -1;
      let _raceResults = null;
      /** The player's car colour in the results list. */
      const RACE_PLAYER_COLOR = 0xff2d55;
      let _raceGoTimer = 0;
      let _raceModel = null;
      let _raceAiTemplate = null;
      let _raceHud = null;
      let _raceWinner = null;
      const _raceCars = [];
      // The car body collider's pose in the car's local frame (for AI bumpers).
      const _raceBodyLocalPos = new THREE.Vector3();
      const _raceBodyLocalQuat = new THREE.Quaternion();
      let _raceBodyLocalOk = false;
      const _racePt = { x: 0, z: 0, heading: 0 };
      const _raceTmpV = new THREE.Vector3();
      const _raceTmpQ = new THREE.Quaternion();
      const _raceSteerQ = new THREE.Quaternion();
      const _axisRacePitch = new THREE.Vector3(1, 0, 0);
      const _axisRaceRoll = new THREE.Vector3(0, 0, 1);
      const _raceRollQ = new THREE.Quaternion();

      function kitchenRaceInputsLocked() {
        return (
          _racePhase === "intro" ||
          _racePhase === "waiting" ||
          _racePhase === "countdown" ||
          _racePhase === "finished"
        );
      }

      /** Copy of the player's car model (lights / particles stripped later) for the AI cars. */
      function prepareKitchenRaceCarTemplate(carModel) {
        _raceAiTemplate = carModel.clone(true);
        if (canonBodyPhys) {
          car.updateMatrixWorld(true);
          const p = canonBodyPhys.position;
          const q = canonBodyPhys.quaternion;
          _raceBodyLocalPos.set(p.x, p.y, p.z);
          car.worldToLocal(_raceBodyLocalPos);
          _raceBodyLocalQuat.copy(car.quaternion).invert().multiply(_raceTmpQ.set(q.x, q.y, q.z, q.w));
          _raceBodyLocalOk = true;
        }
      }

      function createRaceDriveState() {
        return {
          speed: 0,
          angle: 0,
          steerAngle: 0,
          wheelAngle: 0,
          driftAngle: 0,
          turnHoldTime: 0,
          maxSpeed: carState.maxSpeed,
          accel: carState.accel,
          brakeDecel: carState.brakeDecel,
          brakeDecelReverseKey: carState.brakeDecelReverseKey,
          friction: carState.friction,
          steerSpeed: carState.steerSpeed,
          turnRate: carState.turnRate,
          velY: 0,
          bumpVX: 0,
          bumpVZ: 0,
          bumpYaw: 0,
        };
      }

      /**
       * Real head / tail lamp spot lights on the AI cars? Off (was on): their 8
       * spot lights cost about a third of the frame rate (68.4 → 42.9 fps); the
       * table glows and glowing lamps stay, as on the meeting room's opponents.
       */
      const RACE_AI_LAMP_SPOTS = false;
      function createRaceAiCar(cfg) {
        const root = new THREE.Group();
        root.name = "raceCar" + cfg.name;
        root.scale.copy(car.scale);
        const model = _raceAiTemplate.clone(true);
        const strip = [];
        model.traverse((o) => {
          if (o.isLight || o.isPoints || o.isSprite) strip.push(o);
        });
        for (const o of strip) o.parent && o.parent.remove(o);
        let paint = null;
        model.traverse((o) => {
          if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
          const isBody = /^carBody/.test(o.material.name || "") || o.name === "body";
          const isAirIn = o.name === "airIn1" || o.name === "airIn2" || o.name === "airIn3";
          if (!isBody && !isAirIn) return;
          if (!paint) {
            paint = o.material.clone();
            paint.color.setHex(cfg.color);
          }
          o.material = paint;
        });
        root.add(model);
        // Same head / tail lamps as the player's car: glowing lamps and their table
        // glows (headlight beam, tail and brake glows); real spot lights only if
        // RACE_AI_LAMP_SPOTS.
        const spots = [];
        if (RACE_AI_LAMP_SPOTS) for (const e of _carLampSpots) {
          const src = e.spot;
          const spot = new THREE.SpotLight(src.color, src.intensity, src.distance, src.angle, src.penumbra, src.decay);
          spot.name = src.name;
          spot.castShadow = false;
          spot.position.copy(src.position);
          const target = new THREE.Object3D();
          target.name = src.target.name;
          target.position.copy(src.target.position);
          spot.target = target;
          root.add(spot);
          root.add(target);
          spots.push({ spot, kind: e.kind, zSign: e.zSign, aimAlong: e.aimAlong });
        }
        const glows = [];
        setupTableLightReflections(model, glows);
        const wheels = ["wheelFL", "wheelFR", "wheelRL", "wheelRR"].map((n) => model.getObjectByName(n));
        const playerWheels = [wheelFL, wheelFR, wheelRL, wheelRR];
        wheels.forEach((w, i) => {
          if (w && playerWheels[i] && playerWheels[i].baseQuat) w.baseQuat = playerWheels[i].baseQuat.clone();
        });
        scene.add(root);
        applyTextureAnisotropyToRoot(root);
        applyPerformanceShadowPolicy(root);
        let bumper = null;
        if (_carPropBumper) {
          const he = _carPropBumper.shapes[0].halfExtents;
          const off = _carPropBumper.shapeOffsets[0];
          bumper = new CANNON.Body({
            type: CANNON.Body.KINEMATIC,
            collisionFilterGroup: PHYS_GROUP_PROP_BUMPER,
            collisionFilterMask: 0,
          });
          bumper.addShape(new CANNON.Box(new CANNON.Vec3(he.x, he.y, he.z)), new CANNON.Vec3(off.x, off.y, off.z));
          physicsWorld.addBody(bumper);
        }
        return {
          id: "",
          name: cfg.name,
          color: cfg.color,
          isPlayer: false,
          root,
          pos: root.position,
          state: createRaceDriveState(),
          input: { forward: false, reverse: false, left: false, right: false, brake: false },
          ai: new RaceAIDriver(_raceTrack, cfg),
          tracker: new LapTracker(_raceTrack),
          wheels,
          // Its own brake lights (the player's lit / unlit materials), on while it slows down.
          brakeMesh: model.getObjectByName("mainRearBrakeLights") || null,
          braking: false,
          brakeDecel: 0,
          prevSpeed: 0,
          spots,
          glows,
          bumper,
          bumperPrev: new CANNON.Vec3(),
          bumperPrevValid: false,
          finishOrder: 0,
        };
      }

      function makeRaceStartLineMesh(x, z0, z1) {
        const width = 0.9;
        const length = Math.abs(z1 - z0);
        const cols = 2;
        const rows = Math.max(4, Math.round((length / width) * cols));
        const cv = document.createElement("canvas");
        cv.width = cols * 32;
        cv.height = rows * 32;
        const ctx = cv.getContext("2d");
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            ctx.fillStyle = (r + c) % 2 ? "#111111" : "#f4f4f4";
            ctx.fillRect(c * 32, r * 32, 32, 32);
          }
        }
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        const mat = new THREE.MeshStandardMaterial({
          map: tex,
          roughness: 0.55,
          metalness: 0,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length), mat);
        mesh.name = "raceStartLine";
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, tableSurfaceY + 0.006, (z0 + z1) / 2);
        mesh.receiveShadow = true;
        mesh.renderOrder = 2;
        return mesh;
      }

      /** Track, rails, start line, AI cars and HUD (once the kitchen is loaded). */
      function setupKitchenRace() {
        if (_raceTrack || !_raceModel || !_raceAiTemplate || _railSegs.length === 0) return;
        const bounds = { xMin: Infinity, xMax: -Infinity, zNear: Infinity, zFar: -Infinity };
        for (let i = 0; i < _railSegs.length; i += 2) {
          bounds.xMin = Math.min(bounds.xMin, _railSegs[i]);
          bounds.xMax = Math.max(bounds.xMax, _railSegs[i]);
          bounds.zNear = Math.min(bounds.zNear, _railSegs[i + 1]);
          bounds.zFar = Math.max(bounds.zFar, _railSegs[i + 1]);
        }

        // The loop runs around the props on the table's middle line (no rail of its
        // own: the model's rails are the only boundary).
        const z0 = (bounds.zNear + bounds.zFar) / 2;
        let xL = Infinity;
        let xR = -Infinity;
        for (const p of _kitchenProps) {
          if (p.body._propCup) continue;
          xL = Math.min(xL, p.body.position.x);
          xR = Math.max(xR, p.body.position.x);
        }
        if (!(xR > xL)) {
          xL = bounds.xMin + (bounds.xMax - bounds.xMin) * 0.25;
          xR = bounds.xMax - (bounds.xMax - bounds.xMin) * 0.25;
        }
        let islandR = 2;
        for (const p of _kitchenProps) {
          if (p.body._propCup) continue;
          const b = p.body;
          const dx = Math.max(0, xL - b.position.x, b.position.x - xR);
          islandR = Math.max(islandR, Math.hypot(dx, b.position.z - z0) + b._propRadius);
        }
        islandR += RACE_ISLAND_MARGIN;
        const centreR = (islandR + (bounds.zFar - z0)) / 2;
        const laneHalf = (bounds.zFar - z0 - islandR) / 2;
        const startX = (bounds.xMin + bounds.xMax) / 2;
        // Widen the loop on X only: the half-circle ends move out toward
        // raceBoundaries, so the widest AI line in a turn stays half a car width
        // plus RACE_TRACK_X_BUFFER inside them. (Z, the turn radius and the lanes
        // are unchanged.)
        const carHalfWidth = _carRailFoot.ok ? _carRailFoot.hr : 1.2;
        let maxOut = 0;
        for (const cfg of RACE_AI_CARS) maxOut = Math.max(maxOut, raceAiMaxOutward(laneHalf, cfg.turnWiden ?? 1));
        const xMargin = carHalfWidth + RACE_TRACK_X_BUFFER + maxOut + centreR;
        const xLWide = bounds.xMin + xMargin;
        const xRWide = bounds.xMax - xMargin;
        if (xRWide - xLWide > xR - xL) {
          xL = Math.min(xL, xLWide);
          xR = Math.max(xR, xRWide);
        }
        _raceTrack = new StadiumTrack({ xL, xR, z0, radius: centreR, startX, laneHalf });

        scene.add(makeRaceStartLineMesh(startX, z0 + islandR + 0.08, bounds.zFar - 0.08));

        // Cars: the player plus the AI cars, each with a lap tracker.
        _raceCars.length = 0;
        _raceCars.push({
          id: "player",
          name: "Red",
          color: RACE_PLAYER_COLOR,
          isPlayer: true,
          finishTime: 0,
          pos: car.position,
          state: carState,
          tracker: new LapTracker(_raceTrack),
          finishOrder: 0,
        });
        RACE_AI_CARS.forEach((cfg, i) => {
          const rc = createRaceAiCar(cfg);
          rc.id = "ai" + i;
          _raceCars.push(rc);
        });
        scheduleRebuildBloomDarkenLists();

        _raceHud = new RaceHud();
        _raceHud.attach(getKitchenSceneMount());
        _raceResults = new RaceResultsPopup({
          onRetry: () => retryKitchenRace(),
          onNext: () => goToNextKitchenLevel(),
        });
        _raceResults.attach(getKitchenSceneMount());
        resetKitchenRace();
        buildKitchenRaceArrows();
      }

      function placeRaceCar(rc, x, z, heading) {
        rc.pos.set(x, tableSpawn.y, z);
        rc.state._rampAir = false;
        rc.state._lastRestY = undefined;
        rc.state._climbVy = 0;
        rc.state.tiltPitch = 0;
        rc.state.tiltRoll = 0;
        rc.state.pitchVel = 0;
        rc.state._settleT = 0;
        rc.state._compressT = undefined;
        rc.state._groundOffset = 0;
        rc.state.angle = heading;
        rc.state.speed = 0;
        rc.state.steerAngle = 0;
        rc.state.velY = 0;
        rc.state._brakeTime = 0;
        rc.state.bumpVX = 0;
        rc.state.bumpVZ = 0;
        rc.state.bumpYaw = 0;
      }

      /** Cars back on the grid behind the start line, then a countdown. */
      function resetKitchenRace() {
        if (!_raceTrack) return;
        const side = Math.max(0.6, Math.min(1.35, (_raceLaneHalfWidth() - _carRailFoot.hr) - 0.25));
        RACE_GRID_ORDER.forEach((id, slot) => {
          const rc = _raceCars.find((c) => c.id === id);
          if (!rc) return;
          const pt = _raceTrack.pointAt(-(slot + 0.8) * RACE_GRID_GAP, slot % 2 ? -side : side, _racePt);
          if (rc.isPlayer) {
            stopKitchenCarTumble();
            carFalling = false;
            carFloorTimer = 0;
            placeRaceCar(rc, pt.x, pt.z, pt.heading);
            car.quaternion.setFromAxisAngle(_flatUp, pt.heading);
            carUpLerp.set(0, 1, 0);
            _bumperPrevValid = false;
            tableSpawn.x = pt.x;
            tableSpawn.z = pt.z;
            car.updateMatrixWorld(true);
          } else {
            placeRaceCar(rc, pt.x, pt.z, pt.heading);
            rc.ai.reset();
            rc.bumperPrevValid = false;
            syncRaceAiCar(rc, 0);
          }
          rc.finishOrder = 0;
          rc.finishTime = 0;
          rc.tracker.reset(rc.pos.x, rc.pos.z);
        });
        _raceWinner = null;
        _racePhase = "waiting";
        _raceTimer = RACE_START_DELAY_SEC;
        _raceGoTimer = 0;
        _raceElapsed = 0;
        _raceEndWait = 0;
        _raceResultsIn = -1;
        if (_raceResults) _raceResults.hide(true);
        // Held (no timer, no laps) until the cinematic intro hands over.
        if (_kIntro.state !== "done") _racePhase = "intro";
        if (_raceHud) {
          _raceHud.hideResult();
          _raceHud.setBig("");
        }
      }

      function _raceLaneHalfWidth() {
        // Centre line sits in the middle of the lane between island and outer rail.
        let zFar = -Infinity;
        for (let i = 1; i < _railSegs.length; i += 2) zFar = Math.max(zFar, _railSegs[i]);
        return Math.max(0.5, zFar - (_raceTrack.z0 + _raceTrack.r));
      }

      /** Where the player goes back on the track after a fall during the race. */
      function kitchenRaceRespawnPoint() {
        if (!_raceTrack || _racePhase === "off") return null;
        const p = _raceTrack.progress(car.position.x, car.position.z);
        return _raceTrack.pointAt(p, 0, { x: 0, z: 0, heading: 0 });
      }

      /** AI car visuals (pose + wheels) and its prop bumper follow its drive state. */
      function syncRaceAiCar(rc, dt) {
        const st = rc.state;
        // Height from raceCarVerticalStep (table / ramp / air); nose up = −x rotation.
        rc.root.quaternion.setFromAxisAngle(_flatUp, st.angle);
        if (st.tiltPitch) rc.root.quaternion.multiply(_raceTmpQ.setFromAxisAngle(_axisRacePitch, -st.tiltPitch));
        if (st.tiltRoll) rc.root.quaternion.multiply(_raceTmpQ.setFromAxisAngle(_axisRaceRoll, st.tiltRoll));
        rc.root.updateMatrixWorld(true);
        st.wheelAngle = (st.wheelAngle + (st.speed * dt) / WHEEL_RADIUS) % (Math.PI * 2);
        _raceRollQ.setFromAxisAngle(_axisWheelRoll, st.wheelAngle);
        _raceSteerQ.setFromAxisAngle(_axisWheelY, -st.steerAngle);
        rc.wheels.forEach((w, i) => {
          if (!w || !w.baseQuat) return;
          w.quaternion.copy(w.baseQuat);
          if (i < 2) w.quaternion.multiply(_raceSteerQ);
          w.quaternion.multiply(_raceRollQ);
        });
        const b = rc.bumper;
        if (!b || !_raceBodyLocalOk) return;
        _raceTmpV.copy(_raceBodyLocalPos);
        rc.root.localToWorld(_raceTmpV);
        _raceTmpQ.copy(rc.root.quaternion).multiply(_raceBodyLocalQuat);
        if (rc.bumperPrevValid && dt > 0) {
          const inv = 1 / dt;
          b.velocity.set((_raceTmpV.x - rc.bumperPrev.x) * inv, (_raceTmpV.y - rc.bumperPrev.y) * inv, (_raceTmpV.z - rc.bumperPrev.z) * inv);
          const sp = b.velocity.length();
          if (sp > KITCHEN_PROP_BUMPER_MAX_SPEED) b.velocity.scale(KITCHEN_PROP_BUMPER_MAX_SPEED / sp, b.velocity);
        } else {
          b.velocity.set(0, 0, 0);
        }
        rc.bumperPrev.set(_raceTmpV.x, _raceTmpV.y, _raceTmpV.z);
        rc.bumperPrevValid = true;
        b.position.set(_raceTmpV.x, _raceTmpV.y, _raceTmpV.z);
        b.quaternion.set(_raceTmpQ.x, _raceTmpQ.y, _raceTmpQ.z, _raceTmpQ.w);
        b.aabbNeedsUpdate = true;
      }

      // ── Car-to-car pushing: the meeting room's bumper-car physics, shared via
      // ../game/carBumpPhysics.js. Every race car is an oriented box (its
      // collision footprint) with the same mass; a hit's along-heading part goes
      // into the car's speed, the rest is a decaying sideways push / spin on top
      // of its driving (the meeting room's "driving" path).
      const _raceKin = [];
      const _raceBumpRes = {};
      const _raceOthers = []; // other cars' positions, for the AI to steer around

      /** Planar kinematics of a race car as an oriented box (for solveCarBump). */
      function readRaceCarKinematics(rc, out) {
        const st = rc.state;
        const a = st.angle;
        out.a = a;
        out.ux = Math.cos(a);
        out.uz = -Math.sin(a);
        out.fx = Math.sin(a);
        out.fz = Math.cos(a);
        out.x = rc.pos.x + out.ux * _carRailFoot.lr + out.fx * _carRailFoot.lf;
        out.z = rc.pos.z + out.uz * _carRailFoot.lr + out.fz * _carRailFoot.lf;
        out.hx = _carRailFoot.hr;
        out.hz = _carRailFoot.hf;
        out.vx = out.fx * st.speed + st.bumpVX;
        out.vz = out.fz * st.speed + st.bumpVZ;
        out.w = st.bumpYaw;
        out.inertia = carBoxInertia(out.hx, out.hz);
        out.resAlong = 1;
        out.resSide = 1;
        return out;
      }

      /** Result of a hit on a driving car (as _applyCarBumpResult in the meeting room). */
      function applyRaceCarBump(rc, K, impulsed, dx, dz) {
        const st = rc.state;
        rc.pos.x += dx;
        rc.pos.z += dz;
        if (!impulsed) return;
        const along = K.vx * K.fx + K.vz * K.fz;
        const cap = st.maxSpeed * 1.25;
        st.speed = Math.max(-cap, Math.min(cap, along));
        st.bumpVX = K.vx - K.fx * along;
        st.bumpVZ = K.vz - K.fz * along;
        st.bumpYaw = Math.max(-CAR_BUMP_YAW_CAP, Math.min(CAR_BUMP_YAW_CAP, K.w));
      }

      /** Per car step: the collision push slides / spins the car, then decays. */
      function integrateRaceCarBump(pos, st, dt) {
        if (st.bumpVX === 0 && st.bumpVZ === 0 && st.bumpYaw === 0) return;
        pos.x += st.bumpVX * dt;
        pos.z += st.bumpVZ * dt;
        st.angle += st.bumpYaw * dt;
        const kv = Math.exp(-CAR_BUMP_SLIDE_DECAY * dt);
        const kw = Math.exp(-CAR_BUMP_SPIN_DECAY * dt);
        st.bumpVX *= kv;
        st.bumpVZ *= kv;
        st.bumpYaw *= kw;
        if (Math.hypot(st.bumpVX, st.bumpVZ) < 0.01) {
          st.bumpVX = 0;
          st.bumpVZ = 0;
        }
        if (Math.abs(st.bumpYaw) < 0.02) st.bumpYaw = 0;
      }

      function raceCarCanBump(rc) {
        return !rc.isPlayer || (!carFalling && carState.velY === 0);
      }

      /** Car-to-car contacts, every pair (two passes, as in the meeting room). */
      function collideRaceCars() {
        if (!_carRailFoot.ok) return;
        for (let pass = 0; pass < 2; pass++) {
          for (let i = 0; i < _raceCars.length; i++) {
            const cA = _raceCars[i];
            if (!raceCarCanBump(cA)) continue;
            for (let j = i + 1; j < _raceCars.length; j++) {
              const cB = _raceCars[j];
              if (!raceCarCanBump(cB)) continue;
              const A = readRaceCarKinematics(cA, _raceKin[0] || (_raceKin[0] = {}));
              const B = readRaceCarKinematics(cB, _raceKin[1] || (_raceKin[1] = {}));
              if (!solveCarBump(A, B, _raceBumpRes)) continue;
              const r = _raceBumpRes;
              applyRaceCarBump(cA, A, r.impulsed, -r.nx * r.pushA, -r.nz * r.pushA);
              applyRaceCarBump(cB, B, r.impulsed, r.nx * r.pushB, r.nz * r.pushB);
            }
          }
        }
      }

      /**
       * The AI cars never press "brake": they slow down by letting off (and
       * reverse when stuck). Their brake lights come on while they slow down
       * this hard (speed units per second², smoothed), and go off below `off`.
       */
      const RACE_AI_BRAKE_LIGHT = { on: 6, off: 3, smooth: 10 };
      function updateRaceCarBrakeLights(rc, input, dt) {
        if (dt <= 0) return;
        const speed = rc.state.speed;
        const decel = speed > 0.3 ? (rc.prevSpeed - speed) / dt : 0;
        rc.prevSpeed = speed;
        rc.brakeDecel += (decel - rc.brakeDecel) * (1 - Math.exp(-dt * RACE_AI_BRAKE_LIGHT.smooth));
        const hard = input.brake || (input.reverse && speed > 0.3);
        if (hard || rc.brakeDecel > RACE_AI_BRAKE_LIGHT.on) rc.braking = true;
        else if (rc.brakeDecel < RACE_AI_BRAKE_LIGHT.off) rc.braking = false;
        const src = car && car.userData.brakeLightMesh;
        if (rc.brakeMesh && src && src._brakeMat && src._offMat) {
          rc.brakeMesh.material = rc.braking ? src._brakeMat : src._offMat;
        }
      }

      /** Per car step (after the player's updateCar): AI driving and car contacts. */
      function stepKitchenRaceCars(dt) {
        if (!_raceTrack) return;
        const locked = kitchenRaceInputsLocked();
        for (const rc of _raceCars) {
          if (rc.isPlayer) continue;
          let input = _raceNoInput;
          if (!locked) {
            _raceOthers.length = 0;
            for (const o of _raceCars) if (o !== rc) _raceOthers.push(o.pos);
            input = rc.ai.computeInput(rc.pos, rc.state, dt, rc.input, _raceOthers);
          }
          stepCarDrive(rc.state, input, rc.pos, false, dt);
          updateRaceCarBrakeLights(rc, input, dt);
          integrateRaceCarBump(rc.pos, rc.state, dt);
          raceCarVerticalStep(rc, dt);
          collideCarWithRails(rc.pos, rc.state, dt);
        }
        // No pushing while the cars are held (waiting / countdown / finished).
        if (!locked) collideRaceCars();
        // A car pushed by another one must still not end up inside a rail.
        for (const rc of _raceCars) {
          if (rc.isPlayer && (carFalling || carState.velY !== 0)) continue;
          collideCarWithRails(rc.pos, rc.state, dt);
        }
        // An AI car pushed through a gap in the outer rails is put back on the track.
        for (const rc of _raceCars) {
          if (rc.isPlayer) continue;
          const offX = Math.abs(rc.pos.x - tablePlateCenter.x) > tablePlateHalfX;
          const offZ = Math.abs(rc.pos.z - tablePlateCenter.z) > tablePlateHalfZ;
          if (!offX && !offZ) continue;
          const pt = _raceTrack.pointAt(_raceTrack.progress(rc.pos.x, rc.pos.z), 0, _racePt);
          placeRaceCar(rc, pt.x, pt.z, pt.heading);
          rc.bumperPrevValid = false;
        }
      }

      const _hex = (c) => "#" + (c >>> 0).toString(16).padStart(6, "0");

      /** Race over: lock the cars, stop the clock and show the results popup. */
      function openKitchenRaceResults() {
        _racePhase = "finished";
        _raceResultsIn = -1;
        _raceHud.setBig("");
        const standings = raceStandings();
        const player = _raceCars.find((c) => c.isPlayer);
        const place = standings.indexOf(player) + 1;
        const ord = ["1st", "2nd", "3rd", "4th"][place - 1] || place + "th";
        let title;
        let color;
        if (place === 1) {
          title = "You win!";
          color = "#4dff88";
        } else {
          title = player.finishOrder ? `${ord} place` : `${_raceWinner.name} car wins`;
          color = player.finishOrder ? "#ffd23f" : _hex(_raceWinner.color);
        }
        const sub = player.finishOrder
          ? `Your time ${formatRaceTime(player.finishTime)}`
          : `You: ${ord} — lap ${Math.min(RACE_LAPS, player.tracker.lapsDone + 1)}/${RACE_LAPS}`;
        _raceResults.attach(getKitchenSceneMount());
        _raceResults.show({
          title,
          color,
          sub,
          nextEnabled: !!nextLevelPath(SCENE_ROUTES.kitchen),
          rows: standings.map((rc, i) => ({
            place: i + 1,
            name: rc.name,
            color: _hex(rc.color),
            isPlayer: !!rc.isPlayer,
            time: rc.finishOrder
              ? formatRaceTime(rc.finishTime)
              : `Lap ${Math.min(RACE_LAPS, rc.tracker.lapsDone + 1)}/${RACE_LAPS}`,
          })),
        });
      }

      /** Ramp jump slow motion, jump camera and landing shakes off; normal camera. */
      function cancelKitchenCameraFx() {
        restoreKitchenJumpCamera();
        const F = _jumpFx;
        F.active = false;
        F.tReal = 0;
        F.w = 0;
        F.orbit = 0;
        F.wasAir = false;
        F.airVy = 0;
        F.airWorld = 0;
        F.launchVy = 0;
        F.shakeT = Infinity;
        _kitchenTimeScale = 1;
        updateKitchenJumpVignette();
        _carCam1LandShakeTime = 0;
        _carLandShakePending = false;
      }

      /** Physics props (plates, cups, boxes, signs) back where they started, at rest. */
      function resetKitchenProps() {
        for (const p of _kitchenProps) {
          const b = p.body;
          const h = b._home;
          if (!h) continue;
          b.position.copy(h.pos);
          b.previousPosition.copy(h.pos);
          b.interpolatedPosition.copy(h.pos);
          b.quaternion.copy(h.quat);
          b.previousQuaternion.copy(h.quat);
          b.interpolatedQuaternion.copy(h.quat);
          b.velocity.set(0, 0, 0);
          b.angularVelocity.set(0, 0, 0);
          b.force.set(0, 0, 0);
          b.torque.set(0, 0, 0);
          if (b._propCup) b.sleep();
          else b.wakeUp();
          p.synced = false;
        }
        _cupHitByCar = false;
        if (_kitchenFood) _kitchenFood.reset();
      }

      /** Turn arrows back to their default: no wave playing, all hidden. */
      function resetKitchenRaceArrows() {
        const R = _raceArrows;
        if (!R) return;
        for (const U of R.turns) {
          U.waveT = -1;
          U.cooldown = 0;
          U.fired = -1;
          U.carsIn.clear();
        }
        for (const A of R.arrows) A.age = 1e6;
        R.nextWave = RACE_ARROW_WAVE_MIN_SEC + Math.random() * (RACE_ARROW_WAVE_MAX_SEC - RACE_ARROW_WAVE_MIN_SEC);
      }

      /** "Race again": everything back to the start, straight into the countdown (no intro). */
      function retryKitchenRace() {
        if (!_raceTrack) return;
        if (camera === chaseCamera) leaveKitchenChaseCamera(); // the countdown needs the race camera
        if (_kIntro.state !== "done") finishKitchenIntro();
        cancelKitchenCameraFx();
        resetKitchenProps();
        resetKitchenRaceArrows();
        for (const k in keys) if (typeof keys[k] === "boolean") keys[k] = false;
        resetKitchenRace();
        _racePhase = "countdown";
        _raceTimer = RACE_COUNTDOWN_SEC;
        _ccam.enterFull = false; // no intro: the countdown camera eases in
        setupKitchenGameplayCamera();
      }

      /**
       * The gameplay camera as the first race starts (the pose the intro lands
       * on), captured once, unchanged. Used at the intro's hand-off and on
       * "Race again", so every race starts from exactly the same frame.
       */
      let _gameplayCamPose = null;
      function setupKitchenGameplayCamera() {
        if (!car) return;
        // Leftovers from the last race: the ramp-jump camera, the slow-motion
        // camera move, zoom / orbit / FOV, the landing shakes.
        _rampLeftJumpActive = false;
        _rampJumpMatrixActive = false;
        _rampJumpMatrixOrbitProgress = 0;
        _rampJumpFxBlend = 0;
        _rampJumpFxIn = 0;
        _carCam1JumpEffect = 0;
        _carCam1MatrixReturnActive = false;
        _carCam1MatrixReturnT = 0;
        _rampJumpCamRestOffset.set(0, 0, 0);
        cancelKitchenCameraFx();
        if (camera !== carCamera) return;
        if (!_gameplayCamPose) {
          // The first race: just remember it.
          _gameplayCamPose = {
            distance: _carOrbitCamDistance,
            elev: _carOrbitCamElev,
            yaw: _carOrbitCamWorldYaw,
            fov: carCamera.fov,
          };
          return;
        }
        // A new race: the same orbit around the car (now on the grid), the same
        // lens, no roll, the follow state starting right there.
        const P = _gameplayCamPose;
        _carOrbitCamDistance = P.distance;
        _carOrbitCamElev = P.elev;
        _carOrbitCamWorldYaw = P.yaw;
        if (carCamera.fov !== P.fov) {
          carCamera.fov = P.fov;
          carCamera.updateProjectionMatrix();
        }
        carCamera.up.set(0, 1, 0);
        car.updateMatrixWorld(true);
        getCarCameraLookAtPoint(_carMatrixLookAt);
        controls.target.copy(_carMatrixLookAt);
        applyCarOrbitCameraFromAngles();
        carCamera.updateMatrixWorld();
      }

      /** "Next level": hand over to the page, which plays the transition and changes level. */
      function goToNextKitchenLevel() {
        const next = nextLevelPath(SCENE_ROUTES.kitchen);
        if (!next) return;
        if (_raceResults) _raceResults.hide();
        emitKitchenSceneEvent("next-level", { path: next });
      }

      function kitchenRaceCarsMoving() {
        if (_racePhase === "racing") return true;
        for (const rc of _raceCars) {
          if (!rc.isPlayer && Math.abs(rc.state.speed) > 0.05) return true;
        }
        return false;
      }

      function raceStandings() {
        return _raceCars.slice().sort((a, b) => {
          if (a.finishOrder || b.finishOrder) {
            if (!a.finishOrder) return 1;
            if (!b.finishOrder) return -1;
            return a.finishOrder - b.finishOrder;
          }
          return b.tracker.progressValue - a.tracker.progressValue;
        });
      }

      /**
       * Seconds relative to GO from the race's own countdown timer (the one the HUD's 3-2-1-GO reads): -time left during
       * the countdown, time since GO while racing; null otherwise (the start lights are dark).
       */
      function raceTimeFromGo() {
        if (_racePhase === "countdown") return -_raceTimer;
        if (_racePhase === "racing" || _racePhase === "finishing") return _raceElapsed;
        return null;
      }

      /**
       * The race time for the LED board: 0 until GO, then the race clock (_raceElapsed, the clock raceTimeFromGo and
       * the finish times use), stopped at the player's own finish time once they finish, and where the clock stops
       * when the results open.
       */
      function raceClockSec() {
        if (_racePhase !== "racing" && _racePhase !== "finishing" && _racePhase !== "finished") return 0;
        const player = _raceCars.find((c) => c.isPlayer);
        if (player && player.finishOrder) return player.finishTime;
        return _raceElapsed;
      }

      /** Per frame: race phases, laps, HUD, AI car visuals. */
      function updateKitchenRace(dt) {
        if (!_raceTrack) {
          if (_kitchenSceneReady) setupKitchenRace();
          if (!_raceTrack) return;
        }
        _raceHud.attach(getKitchenSceneMount());
        _raceHud.setVisible(_racePhase !== "intro");
        for (const rc of _raceCars) if (!rc.isPlayer) syncRaceAiCar(rc, dt);

        if (_racePhase === "waiting") {
          _raceTimer -= dt;
          if (_raceTimer <= 0) {
            _racePhase = "countdown";
            _raceTimer = RACE_COUNTDOWN_SEC;
            _ccam.enterFull = false;
          }
        } else if (_racePhase === "countdown") {
          _raceTimer -= dt;
          if (_raceTimer <= 0) {
            _racePhase = "racing";
            _raceGoTimer = RACE_GO_SHOW_SEC;
            _raceHud.setGo();
          } else {
            _raceHud.setCountdown(Math.ceil(_raceTimer));
          }
        } else if (_racePhase === "racing" || _racePhase === "finishing") {
          _raceElapsed += dt;
          if (_raceGoTimer > 0) {
            _raceGoTimer -= dt;
            if (_raceGoTimer <= 0) _raceHud.setBig("");
          }
          let order = 0;
          for (const rc of _raceCars) order = Math.max(order, rc.finishOrder);
          for (const rc of _raceCars) {
            if (rc.finishOrder) continue; // finished cars keep driving; their result is fixed
            rc.tracker.update(rc.pos.x, rc.pos.z);
            if (rc.tracker.lapsDone >= RACE_LAPS) {
              rc.finishOrder = ++order;
              rc.finishTime = _raceElapsed;
              if (!_raceWinner) _raceWinner = rc;
              if (rc.isPlayer) {
                // The finish moment first, then the results.
                _raceHud.setBig(rc.finishOrder === 1 ? "FINISH!" : "FINISH", rc.finishOrder === 1 ? "#4dff88" : "#ffd23f");
                _raceResultsIn = RACE_RESULTS_DELAY_SEC;
              }
            }
          }
          if (_raceWinner && _racePhase === "racing") {
            _racePhase = "finishing";
            _raceEndWait = 0;
          }
          if (_racePhase === "finishing") {
            _raceEndWait += dt;
            // The player is far behind: don't keep everyone waiting.
            if (_raceResultsIn < 0 && _raceEndWait >= RACE_RESULTS_MAX_WAIT_SEC) _raceResultsIn = 0;
            if (_raceResultsIn >= 0) {
              _raceResultsIn -= dt;
              if (_raceResultsIn <= 0) openKitchenRaceResults();
            }
          }
        }

        const standings = raceStandings();
        const player = _raceCars.find((c) => c.isPlayer);
        if (player) {
          const lap = Math.min(RACE_LAPS, (player.finishOrder ? RACE_LAPS : player.tracker.lapsDone + 1));
          _raceHud.setStatus(lap, RACE_LAPS, standings.indexOf(player) + 1, _raceCars.length);
        }
      }


      // ---------------------------------------------------------------------------
      // Turn arrows: hollow neon chevrons floating just above the raceBoundaries
      // rail along each turn, following the rail's own path. Each stands upright
      // along the rail, facing the track, its tip along the rail's tangent in the
      // direction of travel, so the row bends with the curve. Their only
      // animation is a one-shot wave (a pulse in the direction of travel, then
      // fading out), started by a car entering a turn's range or now and then at
      // random. Between waves they're hidden and draw nothing. Visual only: no
      // physics, no raycasts.
      // One InstancedMesh (shared quad + glow shader), per-arrow brightness.
      // ---------------------------------------------------------------------------
      /** The rail mesh the arrows sit on (the visible raceBoundaries rail, not its legs / collider). */
      const RACE_ARROW_RAIL_MESH = "raceBoundaries";
      /** Overall arrow size (1 = the first version: 2.6 tall). Shape and spacing scale with it. */
      const RACE_ARROW_SIZE = 0.36;
      /** The neon line keeps its weight better than the shape: it scales with √size. */
      const RACE_ARROW_LINE_SCALE = Math.sqrt(RACE_ARROW_SIZE);
      const RACE_ARROW_HEIGHT = 2.6 * RACE_ARROW_SIZE; // chevron outline
      const RACE_ARROW_WIDTH = 1.9 * RACE_ARROW_SIZE; // along its pointing direction (the rail's tangent)
      const RACE_ARROW_ARM = 0.55 * RACE_ARROW_SIZE; // thickness of the chevron's arms (the hollow outline's shape)
      const RACE_ARROW_GLOW_MARGIN = 0.4 * RACE_ARROW_LINE_SCALE; // halo reach beyond the outline line
      /** Clear space between the rail's top and the arrow's lowest point (its glow included). */
      const RACE_ARROW_RAIL_GAP = 0.22;
      const RACE_ARROW_SPACING = 4.6 * RACE_ARROW_SIZE; // distance between arrows along the rail
      /** Rail path: vertices this close in direction (rad, from the turn centre) form one ring. */
      const RACE_ARROW_RING_ANGLE = 0.01;
      /** A gap between rings this many times the usual spacing is an opening in the rail. */
      const RACE_ARROW_OPENING_FACTOR = 2.5;
      // The wave: the arrows' only animation. One pulse runs along a turn's row
      // in the direction of travel, then every arrow fades out (hidden again).
      const RACE_ARROW_FLASH_SEC = 0.04; // rise of each arrow's flash
      const RACE_ARROW_WAVE_SEC = 1.3; // one wave, first arrow's flash to the last arrow fading out
      const RACE_ARROW_WAVE_STEP_SEC = 0.06; // delay from one arrow to the next
      /** After a wave ends, its turn can't start another for this long (cars arriving together / in-out). */
      const RACE_ARROW_WAVE_COOLDOWN_SEC = 1.8;
      /**
       * A car entering this distance of a turn's row (world units from the row's
       * reach) triggers a wave there: ~1 s ahead at top speed (17 / s), well
       * beyond the ~1.6 a car needs to brake, so it plays before the turn.
       */
      const RACE_ARROW_ACTIVATE_DIST = 18;
      // Random waves on an idle turn, even with no car near.
      const RACE_ARROW_WAVE_MIN_SEC = 6; // random interval between waves…
      const RACE_ARROW_WAVE_MAX_SEC = 12; // …(seconds)
      // Arrows to the ramp: one row lying flat along the centre of the approach,
      // on the table and on up the ramp's slope (neon road markings).
      const RAMP_ARROW_TABLE_LEN = 7; // the row starts this far before the ramp's foot (along the approach)
      const RAMP_ARROW_TOP_MARGIN = 0.9; // and ends this far before the ramp's top edge
      const RAMP_ARROW_SCALE = 1.8; // × the turn arrows' size (fits the ramp's width)
      const RAMP_ARROW_SPACING = 2.1; // along the surface
      const RAMP_ARROW_SURFACE_OFFSET = 0.02; // above the surface, along its normal (plus polygon offset)
      const RACE_ARROW_INTENSITY = 2.4; // overall brightness (HDR, additive)
      const RACE_ARROW_BRIGHT_MODE_SCALE = 1.5; // brightness in bright mode (more, so waves aren't washed out)
      // Reflection on the table top (a mirrored copy, drawn on the table's surface).
      const RACE_ARROW_REFLECT_STRENGTH = 0.32; // × the arrow's brightness
      const RACE_ARROW_REFLECT_FADE = 0.9; // fades with depth below the surface (world units, e-folding)
      const RACE_ARROW_REFLECT_SOFTNESS = 1.8; // wider, softer line than the arrow
      const RACE_ARROW_REFLECT_LIFT = 0.01; // drawn just above the table surface (no z-fighting)
      /** The table's visible top meshes (the reflecting surface: its height and extent). */
      const RACE_ARROW_TABLE_TOP_MESHES = ["mainTableTopPlane", "mainTablePlate"];
      // Line look (chevron units).
      const RACE_ARROW_CORE_WIDTH = 0.04 * RACE_ARROW_LINE_SCALE; // white-hot core half width
      const RACE_ARROW_LINE_WIDTH = 0.1 * RACE_ARROW_LINE_SCALE; // red neon line half width

      let _raceArrows = null;

      /** Chevron outline (closed), pointing +x, centred, in arrow units. */
      function _raceArrowOutline() {
        const w = RACE_ARROW_WIDTH / 2;
        const h = RACE_ARROW_HEIGHT / 2;
        const a = RACE_ARROW_ARM;
        return [
          [-w, h],
          [-w + a, h],
          [w, 0],
          [-w + a, -h],
          [-w, -h],
          [w - a, 0],
          [-w, h],
        ];
      }

      /**
       * The arrows' glow material. With `reflect`, the mirrored copy under the
       * table top: each vertex is drawn where the camera's ray to its mirrored
       * position meets the table surface (same screen spot, the table's depth, so
       * cars in front still hide it), interpolated as if at its mirrored depth,
       * fading with depth, softer, and clipped to the table top.
       */
      /** The table's top surface, measured from its meshes: { y, min (xz), max (xz) }. */
      function _raceArrowTableTop() {
        const box = new THREE.Box3();
        for (const n of RACE_ARROW_TABLE_TOP_MESHES) {
          const o = scene.getObjectByName(n);
          if (o) box.union(new THREE.Box3().setFromObject(o));
        }
        if (box.isEmpty()) {
          return {
            y: tableSurfaceY,
            min: new THREE.Vector2(tablePlateCenter.x - tablePlateHalfX, tablePlateCenter.z - tablePlateHalfZ),
            max: new THREE.Vector2(tablePlateCenter.x + tablePlateHalfX, tablePlateCenter.z + tablePlateHalfZ),
          };
        }
        return { y: box.max.y, min: new THREE.Vector2(box.min.x, box.min.z), max: new THREE.Vector2(box.max.x, box.max.z) };
      }

      function _raceArrowMaterial(reflect = false, top = null) {
        const pts = _raceArrowOutline().map(([x, y]) => new THREE.Vector2(x, y));
        const soft = reflect ? RACE_ARROW_REFLECT_SOFTNESS : 1;
        return new THREE.ShaderMaterial({
          defines: reflect ? { REFLECT: 1 } : {},
          uniforms: {
            uPts: { value: pts },
            uCore: { value: RACE_ARROW_CORE_WIDTH * (reflect ? 0.6 : 1) },
            uLine: { value: RACE_ARROW_LINE_WIDTH * soft },
            uGlow: { value: RACE_ARROW_GLOW_MARGIN },
            uRed: { value: new THREE.Color(1.0, 0.04, 0.07) },
            uHot: { value: new THREE.Color(1.0, 0.86, 0.86) },
            uIntensity: { value: RACE_ARROW_INTENSITY * (reflect ? RACE_ARROW_REFLECT_STRENGTH : 1) },
            uSurfY: { value: top ? top.y : tableSurfaceY },
            uLift: { value: RACE_ARROW_REFLECT_LIFT },
            uFade: { value: RACE_ARROW_REFLECT_FADE },
            uTableMin: { value: top ? top.min : new THREE.Vector2() },
            uTableMax: { value: top ? top.max : new THREE.Vector2() },
          },
          vertexShader: `
            attribute float aBright;
            uniform float uSurfY;
            uniform float uLift;
            varying vec4 vPw; // (local xy, depth below the surface, 1) × w ratio (reflection)
            varying vec2 vQ; // where it's drawn on the table (reflection)
            varying float vB;
            void main() {
              vB = aBright;
              vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
            #ifdef REFLECT
              vec3 C = cameraPosition;
              float surf = uSurfY + uLift;
              if (C.y <= surf + 1e-3 || wp.y >= surf) {
                // Camera at / below the table top: no reflection.
                gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                vPw = vec4(0.0);
                vQ = vec2(1e6);
                return;
              }
              vec3 Q = C + (wp.xyz - C) * ((surf - C.y) / (wp.y - C.y));
              vec4 clipM = projectionMatrix * viewMatrix * wp;
              gl_Position = projectionMatrix * viewMatrix * vec4(Q, 1.0);
              vPw = vec4(position.xy, uSurfY - wp.y, 1.0) * (gl_Position.w / clipM.w);
              vQ = Q.xz;
            #else
              vPw = vec4(position.xy, 0.0, 1.0);
              vQ = vec2(0.0);
              gl_Position = projectionMatrix * viewMatrix * wp;
            #endif
            }`,
          fragmentShader: `
            uniform vec2 uPts[7];
            uniform float uCore;
            uniform float uLine;
            uniform float uGlow;
            uniform vec3 uRed;
            uniform vec3 uHot;
            uniform float uIntensity;
            uniform float uFade;
            uniform vec2 uTableMin;
            uniform vec2 uTableMax;
            varying vec4 vPw;
            varying vec2 vQ;
            varying float vB;
            void main() {
              vec2 vP = vPw.xy / vPw.w;
              float fade = 1.0;
            #ifdef REFLECT
              if (vQ.x < uTableMin.x || vQ.x > uTableMax.x || vQ.y < uTableMin.y || vQ.y > uTableMax.y) discard;
              fade = exp(-max(0.0, vPw.z / vPw.w) / uFade);
            #endif
              float d = 1e3;
              for (int i = 0; i < 6; i++) {
                vec2 a = uPts[i];
                vec2 ab = uPts[i + 1] - a;
                float t = clamp(dot(vP - a, ab) / dot(ab, ab), 0.0, 1.0);
                d = min(d, length(vP - a - ab * t));
              }
              float core = 1.0 - smoothstep(uCore * 0.4, uCore, d);
              float line = 1.0 - smoothstep(uLine * 0.5, uLine, d);
              float halo = exp(-d / (uGlow * 0.35)) * (1.0 - smoothstep(uGlow * 0.6, uGlow, d));
              vec3 col = uHot * core * 1.6 + uRed * (line * 1.4 + halo * 0.55);
              col *= vB * uIntensity * fade;
              if (max(col.r, max(col.g, col.b)) < 0.002) discard;
              gl_FragColor = vec4(col, 1.0);
            }`,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: true,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
      }

      /** World vertices of the rail mesh (x, y, z). */
      function _raceArrowRailVertices() {
        const o = scene.getObjectByName(RACE_ARROW_RAIL_MESH);
        if (!o || !o.isMesh || !o.geometry) return null;
        o.updateMatrixWorld(true);
        const pa = o.geometry.attributes.position;
        const out = new Float32Array(pa.count * 3);
        const v = new THREE.Vector3();
        for (let i = 0; i < pa.count; i++) {
          v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
          out[i * 3] = v.x;
          out[i * 3 + 1] = v.y;
          out[i * 3 + 2] = v.z;
        }
        return out;
      }

      /**
       * The rail's path around one turn, in the direction of travel. The rail is
       * a tube along a polyline: its vertices sit in rings at the polyline's
       * corners. Each ring gives a path point (its centre) and the rail's top
       * there; rings are ordered by race progress, and the path is split where
       * the rail has an opening (a gap far longer than the usual ring spacing).
       */
      function _raceArrowRailPath(rail, T, pa) {
        const p0 = {}, p1 = {};
        T.pointAt(pa + T.halfTurn / 2, 0, p0);
        T.pointAt(pa + T.halfTurn / 2, 1, p1);
        const cx = p0.x - (p1.x - p0.x) * T.r;
        const cz = p0.z - (p1.z - p0.z) * T.r;
        const verts = [];
        for (let k = 0; k < rail.length; k += 3) {
          const x = rail[k], z = rail[k + 2];
          let q = T.progress(x, z) - pa;
          q = ((q % T.length) + T.length) % T.length;
          if (q > T.halfTurn) continue; // not this turn
          verts.push({ x, y: rail[k + 1], z, q, a: Math.atan2(x - cx, z - cz) });
        }
        verts.sort((u, v) => u.q - v.q);
        // Rings: vertices at (almost) the same direction from the turn's centre.
        const rings = [];
        let ring = null;
        for (const v of verts) {
          if (!ring || Math.abs(Math.atan2(Math.sin(v.a - ring.a), Math.cos(v.a - ring.a))) > RACE_ARROW_RING_ANGLE) {
            rings.push((ring = { a: v.a, q: v.q, xs: 0, zs: 0, n: 0, top: -Infinity }));
          }
          ring.xs += v.x;
          ring.zs += v.z;
          ring.n++;
          ring.top = Math.max(ring.top, v.y);
        }
        const pts = rings.map((r) => ({ x: r.xs / r.n, z: r.zs / r.n, top: r.top, q: r.q }));
        // Split at openings.
        const gaps = [];
        for (let i = 1; i < pts.length; i++) gaps.push(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
        const median = gaps.length ? gaps.slice().sort((u, v) => u - v)[Math.floor(gaps.length / 2)] : 0;
        const runs = [];
        let run = pts.length ? [pts[0]] : null;
        if (run) runs.push(run);
        for (let i = 1; i < pts.length; i++) {
          if (gaps[i - 1] > median * RACE_ARROW_OPENING_FACTOR) runs.push((run = []));
          run.push(pts[i]);
        }
        return runs.filter((r) => r.length > 1);
      }

      function buildKitchenRaceArrows() {
        if (_raceArrows || !_raceTrack) return;
        const T = _raceTrack;
        const rail = _raceArrowRailVertices();
        if (!rail) return;
        const halfBelow = RACE_ARROW_HEIGHT / 2 + RACE_ARROW_GLOW_MARGIN; // centre to the glow's lowest point
        // Obstacles for the placement check: visible kitchen meshes, not the
        // rails (the arrows sit on them), cars or flat effect planes.
        const blockers = [];
        const skipRoots = new Set(_raceCars.map((rc) => (rc.isPlayer ? car : rc.root)).filter(Boolean));
        scene.traverse((o) => {
          if (!o.isMesh || o.isInstancedMesh) return;
          for (let q = o; q; q = q.parent) {
            if (!q.visible || skipRoots.has(q)) return;
          }
          if (/^raceBoundaries/.test(o.name)) return;
          const m = o.material;
          if (m && m.transparent && m.depthWrite === false) return;
          blockers.push(o);
        });
        const rc = new THREE.Raycaster();
        const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
        const outline = _raceArrowOutline();
        const placed = []; // { matrix, turn, k, n, fire, age, x, z }
        const turns = [];
        const basis = new THREE.Matrix4();
        const X = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3();
        const pos = new THREE.Vector3();
        const turnStarts = [T.straight - T.startS, 2 * T.straight + T.halfTurn - T.startS];
        turnStarts.forEach((pa, turn) => {
          const runs = _raceArrowRailPath(rail, T, pa);
          const row = [];
          for (const runPts of runs) {
            // Walk the run by arc length, an arrow every RACE_ARROW_SPACING
            // (centred in the run), tangent from the path itself.
            const cum = [0];
            for (let i = 1; i < runPts.length; i++) {
              cum.push(cum[i - 1] + Math.hypot(runPts[i].x - runPts[i - 1].x, runPts[i].z - runPts[i - 1].z));
            }
            const len = cum[cum.length - 1];
            const n = Math.floor(len / RACE_ARROW_SPACING) + 1;
            const start = (len - (n - 1) * RACE_ARROW_SPACING) / 2;
            let j = 1;
            for (let k = 0; k < n; k++) {
              const sAt = start + k * RACE_ARROW_SPACING;
              while (j < cum.length - 1 && cum[j] < sAt) j++;
              const A0 = runPts[j - 1], A1 = runPts[j];
              const f = (sAt - cum[j - 1]) / Math.max(1e-6, cum[j] - cum[j - 1]);
              const x = A0.x + (A1.x - A0.x) * f;
              const z = A0.z + (A1.z - A0.z) * f;
              // Tangent: the rail's straight section under the arrow, in travel order.
              X.set(A1.x - A0.x, 0, A1.z - A0.z).normalize();
              // The rail's top under the arrow: the higher of the section's ends.
              const top = Math.max(A0.top, A1.top);
              pos.set(x, top + RACE_ARROW_RAIL_GAP + halfBelow, z);
              Z.crossVectors(X, Y);
              basis.makeBasis(X, Y, Z).setPosition(pos);
              // Skip an arrow that would cut through a kitchen object.
              let clear = true;
              for (let i = 0; i < outline.length - 1 && clear; i++) {
                _a.set(outline[i][0], outline[i][1], 0).applyMatrix4(basis);
                _b.set(outline[i + 1][0], outline[i + 1][1], 0).applyMatrix4(basis);
                _d.subVectors(_b, _a);
                const l = _d.length();
                rc.set(_a, _d.normalize());
                rc.far = l;
                if (rc.intersectObjects(blockers, false).length) clear = false;
              }
              if (clear) row.push({ matrix: basis.clone(), turn, x, z, railTop: top, age: Infinity, shown: true });
            }
          }
          row.forEach((A, k) => {
            A.k = k;
            A.n = row.length;
            A.fire = k * RACE_ARROW_WAVE_STEP_SEC; // in travel order
            placed.push(A);
          });
          // Activation: the row's centre and reach.
          let cx = 0, cz = 0;
          for (const A of row) {
            cx += A.x;
            cz += A.z;
          }
          cx /= Math.max(1, row.length);
          cz /= Math.max(1, row.length);
          let reach = 0;
          for (const A of row) reach = Math.max(reach, Math.hypot(A.x - cx, A.z - cz));
          turns.push({
            cx,
            cz,
            reach,
            n: row.length,
            waveT: -1, // time into a playing wave (−1 = none)
            cooldown: 0, // after a wave: no new wave until this runs out
            carsIn: new Set(), // cars within the activation distance (enter = trigger)
          });
        });
        // Ramp approach: one row lying flat along the centre of the approach,
        // from a short way before the ramp's foot on the table, up its slope to
        // near its top edge. Heights / normals come from the table and the ramp's
        // own surface (raycast); arrows are spaced evenly along the surface and
        // lie in it, tip along the path. One group; no reflection for these.
        if (_rampFrameInfo && _rampMesh) {
          const Rf = _rampFrameInfo;
          const tMid = (Rf.tMin + Rf.tMax) / 2;
          const s0 = Rf.sMin - RAMP_ARROW_TABLE_LEN;
          const s1 = Rf.sMax - RAMP_ARROW_TOP_MARGIN;
          // The surface path, sampled finely: points and normals.
          const path = [];
          const N = 240;
          const nTmp = new THREE.Vector3();
          for (let i = 0; i <= N; i++) {
            const sAt = s0 + ((s1 - s0) * i) / N;
            const x = Rf.up.x * sAt + Rf.across.x * tMid;
            const z = Rf.up.z * sAt + Rf.across.z * tMid;
            const y = _rampSurfaceAt(x, z, nTmp);
            path.push({ p: new THREE.Vector3(x, y, z), n: nTmp.clone() });
          }
          const cum = [0];
          for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + path[i].p.distanceTo(path[i - 1].p));
          const len = cum[cum.length - 1];
          // The ramp's foot falls midway between two arrows (none straddles the bend).
          let footI = path.findIndex((q) => q.p.y > tableSurfaceY + 1e-3);
          if (footI < 0) footI = path.length - 1;
          const footAt = cum[Math.max(0, footI - 1)];
          const start = Math.max(0, footAt - (Math.floor(footAt / RAMP_ARROW_SPACING - 0.5) + 0.5) * RAMP_ARROW_SPACING);
          const count = Math.floor((len - start) / RAMP_ARROW_SPACING) + 1;
          const group = turns.length;
          const row = [];
          const T3 = new THREE.Vector3(), B3 = new THREE.Vector3(), N3 = new THREE.Vector3();
          const scl = new THREE.Vector3(RAMP_ARROW_SCALE, RAMP_ARROW_SCALE, RAMP_ARROW_SCALE);
          const noReflection = new THREE.Matrix4().makeScale(0, 0, 0);
          let j = 1;
          for (let k = 0; k < count; k++) {
            const at = start + k * RAMP_ARROW_SPACING;
            while (j < cum.length - 1 && cum[j] < at) j++;
            const P0 = path[j - 1], P1 = path[j];
            const f = (at - cum[j - 1]) / Math.max(1e-6, cum[j] - cum[j - 1]);
            pos.lerpVectors(P0.p, P1.p, f);
            // The surface under the arrow's centre (normal), the path's direction in it.
            const y = _rampSurfaceAt(pos.x, pos.z, N3);
            pos.y = y;
            T3.copy(Rf.up).addScaledVector(N3, -Rf.up.dot(N3)).normalize(); // tip: up the path, in the surface
            B3.crossVectors(N3, T3).normalize();
            pos.addScaledVector(N3, RAMP_ARROW_SURFACE_OFFSET);
            basis.makeBasis(T3, B3, N3).scale(scl).setPosition(pos);
            row.push({
              matrix: basis.clone(),
              reflMatrix: noReflection,
              turn: group,
              k,
              n: count,
              x: pos.x,
              z: pos.z,
              age: Infinity,
              shown: true,
              ramp: true,
              onRamp: y > tableSurfaceY + 1e-3,
            });
          }
          if (row.length) {
            let cx = 0, cz = 0;
            for (const A of row) {
              A.fire = A.k * RACE_ARROW_WAVE_STEP_SEC;
              placed.push(A);
              cx += A.x;
              cz += A.z;
            }
            cx /= row.length;
            cz /= row.length;
            let reach = 0;
            for (const A of row) reach = Math.max(reach, Math.hypot(A.x - cx, A.z - cz));
            turns.push({ cx, cz, reach, n: row.length, waveT: -1, cooldown: 0, carsIn: new Set(), ramp: true });
          }
        }
        if (!placed.length) return;

        const geo = new THREE.PlaneGeometry(
          RACE_ARROW_WIDTH + 2 * RACE_ARROW_GLOW_MARGIN,
          RACE_ARROW_HEIGHT + 2 * RACE_ARROW_GLOW_MARGIN,
        );
        const bright = new Float32Array(placed.length);
        geo.setAttribute("aBright", new THREE.InstancedBufferAttribute(bright, 1).setUsage(THREE.DynamicDrawUsage));
        const arrowMat = _raceArrowMaterial(false);
        // The flat ramp-path arrows sit on surfaces: pull them toward the camera in depth.
        arrowMat.polygonOffset = true;
        arrowMat.polygonOffsetFactor = -2;
        arrowMat.polygonOffsetUnits = -2;
        const mesh = new THREE.InstancedMesh(geo, arrowMat, placed.length);
        mesh.name = "raceTurnArrows";
        placed.forEach((A, i) => mesh.setMatrixAt(i, A.matrix));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.renderOrder = 6;
        mesh.raycast = () => {}; // never a raycast / collision target
        mesh.userData.noCollision = true;
        scene.add(mesh);
        // Reflection: each arrow mirrored across the table top, sharing the
        // arrows' brightness attribute (always in sync with its arrow).
        const top = _raceArrowTableTop();
        const mirror = new THREE.Matrix4()
          .makeTranslation(0, top.y, 0)
          .multiply(new THREE.Matrix4().makeScale(1, -1, 1))
          .multiply(new THREE.Matrix4().makeTranslation(0, -top.y, 0));
        const reflGeo = new THREE.BufferGeometry();
        reflGeo.setIndex(geo.index);
        reflGeo.setAttribute("position", geo.attributes.position);
        reflGeo.setAttribute("aBright", geo.attributes.aBright);
        const refl = new THREE.InstancedMesh(reflGeo, _raceArrowMaterial(true, top), placed.length);
        refl.name = "raceTurnArrowsReflection";
        placed.forEach((A, i) => {
          if (!A.reflMatrix) A.reflMatrix = mirror.clone().multiply(A.matrix); // flat ramp arrows: none
          refl.setMatrixAt(i, A.reflMatrix);
        });
        refl.instanceMatrix.needsUpdate = true;
        refl.frustumCulled = false;
        refl.castShadow = false;
        refl.receiveShadow = false;
        refl.renderOrder = 5; // just before the arrows
        refl.raycast = () => {};
        refl.userData.noCollision = true;
        scene.add(refl);
        _raceArrows = {
          mesh,
          refl,
          arrows: placed,
          bright,
          turns,
          nextWave: RACE_ARROW_WAVE_MIN_SEC + Math.random() * (RACE_ARROW_WAVE_MAX_SEC - RACE_ARROW_WAVE_MIN_SEC),
          zero: new THREE.Matrix4().makeScale(0, 0, 0),
        };
      }

      /** Each arrow's fade, so a whole wave (all its arrows) lasts RACE_ARROW_WAVE_SEC. */
      function _raceArrowFadeSec(n) {
        return Math.max(0.25, RACE_ARROW_WAVE_SEC - RACE_ARROW_FLASH_SEC - (n - 1) * RACE_ARROW_WAVE_STEP_SEC);
      }

      /** Flash shape of one arrow in a wave: quick rise, then a fade to nothing. */
      function _raceArrowFlash(A, fadeSec) {
        if (A.age < RACE_ARROW_FLASH_SEC) return A.age / RACE_ARROW_FLASH_SEC;
        if (A.age < RACE_ARROW_FLASH_SEC + fadeSec) {
          const u = 1 - (A.age - RACE_ARROW_FLASH_SEC) / fadeSec;
          return u * u;
        }
        return 0;
      }

      /**
       * The one wave, for every trigger: starts on turn U unless one is playing
       * there (that one counts) or the turn is cooling down after its last wave.
       */
      function _raceArrowStartWave(U) {
        if (U.waveT >= 0 || U.cooldown > 0) return false;
        U.waveT = 0;
        U.fired = -1; // index of the last arrow fired in this wave
        return true;
      }

      /**
       * Waves start when a car enters a turn's range, and now and then on a
       * random idle turn. Between waves the arrows are off and not drawn.
       */
      function updateKitchenRaceArrows(dt) {
        const R = _raceArrows;
        if (!R) return;
        const modeScale = 1 + (RACE_ARROW_BRIGHT_MODE_SCALE - 1) * lightBlend;
        // Random wave on an idle turn (not during the cinematic intro).
        if (_kIntro.state === "done") {
          R.nextWave -= dt;
          if (R.nextWave <= 0) {
            R.nextWave = RACE_ARROW_WAVE_MIN_SEC + Math.random() * (RACE_ARROW_WAVE_MAX_SEC - RACE_ARROW_WAVE_MIN_SEC);
            const idle = R.turns.filter((U) => U.waveT < 0 && U.cooldown <= 0);
            if (idle.length) _raceArrowStartWave(idle[Math.floor(Math.random() * idle.length)]);
          }
        }
        for (let ti = 0; ti < R.turns.length; ti++) {
          const U = R.turns[ti];
          if (U.cooldown > 0) U.cooldown -= dt;
          // A car entering the range triggers a wave (once per entry).
          for (const rc of _raceCars) {
            const inside = Math.hypot(rc.pos.x - U.cx, rc.pos.z - U.cz) - U.reach < RACE_ARROW_ACTIVATE_DIST;
            if (inside && !U.carsIn.has(rc)) {
              U.carsIn.add(rc);
              _raceArrowStartWave(U);
            } else if (!inside) U.carsIn.delete(rc);
          }
          if (U.waveT < 0) continue;
          U.waveT += dt;
          // Fire the arrows the pulse has reached, in the direction of travel.
          const reached = Math.min(U.n - 1, Math.floor(U.waveT / RACE_ARROW_WAVE_STEP_SEC));
          if (reached > U.fired) {
            for (const A of R.arrows) {
              if (A.turn === ti && A.k > U.fired && A.k <= reached) A.age = 0;
            }
            U.fired = reached;
          }
          if (U.waveT >= RACE_ARROW_WAVE_SEC) {
            U.waveT = -1; // done: every arrow has faded out
            U.cooldown = RACE_ARROW_WAVE_COOLDOWN_SEC;
          }
        }
        let anyShown = false;
        let matricesDirty = false;
        for (let i = 0; i < R.arrows.length; i++) {
          const A = R.arrows[i];
          A.age += dt;
          const b = _raceArrowFlash(A, _raceArrowFadeSec(A.n)) * modeScale;
          R.bright[i] = b;
          // Off: collapsed to nothing (not drawn); back just as it lights up.
          const show = b > 1e-3;
          if (show !== A.shown) {
            R.mesh.setMatrixAt(i, show ? A.matrix : R.zero);
            R.refl.setMatrixAt(i, show ? A.reflMatrix : R.zero);
            A.shown = show;
            matricesDirty = true;
          }
          if (show) anyShown = true;
        }
        if (matricesDirty) {
          R.mesh.instanceMatrix.needsUpdate = true;
          R.refl.instanceMatrix.needsUpdate = true;
        }
        R.mesh.visible = anyShown;
        R.refl.visible = anyShown;
        if (anyShown) R.mesh.geometry.attributes.aBright.needsUpdate = true;
      }

      // ---------------------------------------------------------------------------
      // Cinematic intro, letterboxed:
      //   0. room reveal — a low glide across the kitchen, from the pesel wall to the iced coffee machine, in
      //      bright mode, switching to dark mode near its end (dark mode from the portal on); a fade cut
      //   1. table overview — a slow glide along the table, descending toward the track
      //   2. car beauty shot — (cut) a slow, low front-three-quarter orbit of the player's car
      //   3. Mister Spot — (cut) a low three-quarter push-in on the robot firing
      //      its lasers, the kitchen behind it
      //   4. track run — fast and low along the track's centre line through a turn
      //   5. arrival — back over the infield onto the gameplay camera
      // The race is held meanwhile (phase "intro": no input, AI paused, no timer /
      // laps, HUD hidden). It can't be skipped, and input does nothing while it
      // plays. Every shot is built from the race track and the cars' positions.
      // ---------------------------------------------------------------------------
      /**
       * Shots, in order (seconds). `blendIn` > 0 glides in from the previous shot;
       * 0 = a cut. `fade`: the cut is hidden by a short fade to black (out at the
       * end of the previous shot, the camera moves while the screen is black, in
       * at the start of this one). The arrival is one continuous move.
       */
      /**
       * 0. Room reveal (the intro's first shot): a glide across the kitchen in bright mode, a little above the
       * table's height and tilted slightly down onto it (the track, the cars and what's on the table in view).
       * It starts on the room's right side by the pesel wall (its coloured panels and light bars), turns into
       * the aisle between the table and the back counter and travels the length of the room to the far side,
       * ending on the iced coffee machine. As it gets there (`switch.atShare` of the shot) the lights go to dark
       * mode: a short flicker, then down (the existing light blend, Key P / Key O: lights, colours, emissive,
       * bloom, background, together). A fade-to-black cut to the portal shot (the intro's other cuts' style).
       * The path keeps clear of the table, the robot (above its height), the lamps, the fridges and the counter.
       */
      const KITCHEN_INTRO_REVEAL = {
        sec: 8.0, // the shot's length
        /** Lights: bright → dark starting at this share of the shot, over `sec`; `flicker`: the blend's level
         *  (× the fall) at even steps over the first `flickerShare` of it (a power-down stutter). */
        switch: { atShare: 2 / 3, sec: 1.1, flicker: [1, 0.3, 0.95, 0.2, 0.75, 0.45], flickerShare: 0.45 },
        /** Camera height (world y; the table's top is 14.3, the lamps' bottoms 26) and its tilt down (degrees
         *  below level) the whole shot (was 6 → 10.5 high, looking up 8–24°). */
        height: 22,
        tiltDeg: 15,
        /** Camera path (world x, z), smooth through these, at a near-steady pace. */
        path: [
          [38, 48], // right side, front: the pesel wall on the right, the table's end on the left
          [58, 30], // past the pesel wall
          [63, 8],
          [50, -4.5], // round the table's end into the back aisle, beside the table
          [20, -5],
          [-12, -5],
          [-28, -4], // the iced coffee machine side
        ],
        /** Which way it faces along the way (points it heads toward, world x, z; same count, matched in order):
         *  between the pesel wall and the table, then across the table diagonally, settling on the iced coffee
         *  machine. */
        look: [
          [66, 4],
          [70, 0],
          [30, 12],
          [-10, 14],
          [-35, 12],
          [-44, -12],
          [-44.5, -22],
        ],
        ease: 0.55, // 0 = steady pace, 1 = fully eased in and out
        fovFrom: 58, // wide…
        fovTo: 48, // …tighter on the coffee machine
      };
      const KITCHEN_INTRO_SHOTS = [
        { name: "roomReveal", sec: KITCHEN_INTRO_REVEAL.sec, blendIn: 0 },
        { name: "portal", sec: 5.6, blendIn: 0, fade: true }, // fade cut from the reveal (its own sequence unchanged) // a build-up, the portal opens, the car drives out of it, it closes (was 4.6)
        { name: "overview", sec: 3.6, blendIn: 0, fade: true },
        { name: "carBeauty", sec: 3.6, blendIn: 0, fade: true },
        { name: "misterSpot", sec: 3.6, blendIn: 0, fade: true }, // Mister Spot firing its lasers
        { name: "trackRun", sec: 3.4, blendIn: 0, fade: true },
        { name: "arrival", sec: 3.2, blendIn: 0 }, // continues from the run's last pose
      ];
      // Fades to black and letterbox bars: the shared intro defaults (cinematicIntro.js).
      /** Track run start: 0 = fast out of the cut (as before), 1 = fully eased in. */
      const KITCHEN_INTRO_RUN_EASE_IN = 0.6;
      /** 1. Overview: along the table (from its left half toward the grid), descending. */
      const KITCHEN_INTRO_OVERVIEW = {
        alongFrom: -28, // along the start straight from the track centre
        alongTo: -6,
        outFrom: 14, // toward the table's front (the start straight's outside)
        outTo: 9,
        heightFrom: 13, // above the table
        heightTo: 6,
        lookAlongFrom: -4, // look point: along the track from its centre…
        fovFrom: 58, // …turning onto the player's car by the end (where the next shot looks)
        fovTo: 48,
      };
      /**
       * 2. Car beauty shot: a slow orbit around the player's car, front three-
       * quarter from the table's front side, so the kitchen (counter, shelves)
       * is the background; just above the rail and the car beside it.
       */
      const KITCHEN_INTRO_CAR = {
        radiusFrom: 7.0,
        radiusTo: 6.0,
        angleFromDeg: 45, // 0 = straight ahead of the car, 90 = its outer (table-front) side
        angleToDeg: 78,
        heightFrom: 2.6, // camera above the table (car height ≈ 1.65)
        heightTo: 1.9,
        lookHeight: 0.75,
        fovFrom: 36, // tight
        fovTo: 32,
      };
      /**
       * 3. Track run: low and fast along the track into the next turn, slowing
       * through it (fast straight, controlled turn, at rest for the arrival).
       */
      const KITCHEN_INTRO_RUN = {
        beforeTurn: 14, // progress before the turn where the run starts
        endAfterTurn: 2, // progress past the end of the turn
        lateral: 2.0, // toward the outside of the loop (a wider line through the turn)
        height: 1.3,
        lookAhead: 8, // world units along the curve
        lookHeight: 0.6,
        fovFrom: 62, // wide
        fovTo: 66,
        maxRollDeg: 7, // leaning into the turn
      };
      /**
       * 3. Mister Spot: wherever it is when the shot comes, it stops and fires
       * its laser sequence (the normal effect) while the camera pushes in from
       * a low front three-quarter, slightly to the side (below its eyes, so the
       * beams pass above the camera and sweep across the frame). Sizes are
       * shares of the robot's height (its bounds); the angle is the first of
       * `azCandidatesDeg` (either side) with a clear view and the kitchen behind
       * it (the jump camera's background check), else the one with the most.
       */
      const KITCHEN_INTRO_SPOT = {
        azCandidatesDeg: [50, 38, 64, 78, 28, 95], // from the robot's facing, preferred first
        orbitDeg: 12, // the camera's slow orbit over the shot (toward the front)
        distFrom: 1.9, // × robot height
        distTo: 1.6, // push-in
        height: 0.36, // camera above the robot's base, × its height
        lookHeight: 0.6, // look point above its base, × its height
        lookAhead: 0.3, // look point ahead of it (where the beams go), × its height
        fovFrom: 56,
        fovTo: 50,
        bgSpread: 0.45, // the background rays pass this far around it, × its height
        openSpread: 2.0, // nothing in front of it across the frame: rays out to this far either side of it, × its height…
        openNear: 0.6, // …with nothing in their nearer share (a foreground blocker; the boxes are too coarse near the robot)
        laserLead: 0.3, // seconds: the lasers start this long before the shot (firing when it fades in)…
        laserTail: 0.3, // …and fade out this long after it
        /**
         * The robot's place for the shot: where it is on its path this long into the intro (s): the
         * shot's own start before the portal shot was added (3.6 + 3.6 − laserLead), so the framing is
         * the same as then, whatever comes before the shot. It carries on along its path from there.
         */
        poseAtSec: 6.9,
        /** Occlusion: camera positions checked along its path, and points along the beams (× height ahead of it). */
        pathSamples: 6,
        beamAheadH: [0.6, 1.2, 1.8],
      };
      const KITCHEN_INTRO_TOTAL_SEC = KITCHEN_INTRO_SHOTS.reduce((t, s) => t + s.sec, 0);
      /** Arrow wave before the ramp during the overview (the ramp is in its view). */
      const KITCHEN_INTRO_RAMP_WAVE_AT_SEC = (() => {
        let start = 0;
        for (const sh of KITCHEN_INTRO_SHOTS) {
          if (sh.name === "overview") return start + sh.sec * 0.45;
          start += sh.sec;
        }
        return 0;
      })();
      /** Arrow wave on the run's turn: starts this long before the camera reaches the turn. */
      const KITCHEN_INTRO_RUN_WAVE_LEAD = 0.3;
      /** One arrow wave along both turns as the camera arrives on the gameplay view. */
      const KITCHEN_INTRO_WAVE_AT_SEC =
        KITCHEN_INTRO_TOTAL_SEC - KITCHEN_INTRO_SHOTS[KITCHEN_INTRO_SHOTS.length - 1].sec * 0.375;

      // Shared intro (timeline, fades, letterbox, camera override, input
      // blocking) with the kitchen's shots; kitchen state on top.
      const _kIntro = Object.assign(
        createCinematicIntro({
          THREE,
          getCamera: () => camera,
          getMount: getKitchenSceneMount,
          shots: KITCHEN_INTRO_SHOTS,
          shotPose: (i, u, o) => _kIntroShotPose(i, u, o),
          arrivalPose: (u, from, o) => _kIntroArrivalPose(u, from, o),
          blocksInput: () => _kitchenSceneRendering,
        }),
        {
          rig: null, // track / car frame the shots are built from (at the start)
          controlsWereEnabled: true,
          waveDone: false,
          runWaveDone: false,
          rampWaveDone: false,
          spot: null, // Mister Spot shot frame (chosen when it starts)
          spotPose: null, // Mister Spot's place / path state for the shot (taken at KITCHEN_INTRO_SPOT.poseAtSec)
          spotStarted: false,
          spotEnded: false,
          revealDone: false, // the room reveal's lights handed over to dark mode
        },
      );
      const _kIntroPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50, roll: 0 };
      const _kIntroPt = { x: 0, z: 0, heading: 0 };
      const _kIntroPt2 = { x: 0, z: 0, heading: 0 };
      const _kIntroV = new THREE.Vector3();
      const _kIntroV2 = new THREE.Vector3();

      const _kIntroEaseSine = introEaseSine;
      const _kIntroLerp = introLerp;
      const _kIntroDeg = Math.PI / 180;

      /** Race progress in (-L/2, L/2]: the grid sits just behind the start line (negative). */
      function _kIntroProgress(T, x, z) {
        const p = T.progress(x, z);
        return p > T.length / 2 ? p - T.length : p;
      }

      /** The track / car frame the shots are built from (null until the race is set up). */
      function _kIntroBuildRig() {
        if (!_raceTrack || !_raceCars.length) return null;
        const T = _raceTrack;
        const surf = tableSurfaceY;
        const player = _raceCars.find((c) => c.isPlayer) || _raceCars[0];
        let pLead = -Infinity;
        for (const c of _raceCars) pLead = Math.max(pLead, _kIntroProgress(T, c.pos.x, c.pos.z));
        const pPlayer = _kIntroProgress(T, player.pos.x, player.pos.z);
        T.pointAt(pPlayer, 0, _kIntroPt);
        T.pointAt(pPlayer, 1, _kIntroPt2);
        const out = new THREE.Vector3(_kIntroPt2.x - _kIntroPt.x, 0, _kIntroPt2.z - _kIntroPt.z).normalize();
        const fwd = new THREE.Vector3(Math.sin(player.state.angle), 0, Math.cos(player.state.angle));
        // Track run: the centre line from ahead of the leading car, through the
        // next turn, as a smooth curve (world units along it).
        // The next turn ahead of the grid.
        const turnStarts = [T.straight - T.startS, 2 * T.straight + T.halfTurn - T.startS];
        let turnStart = Infinity;
        let runTurn = 0; // index, same order as the arrows' turns
        turnStarts.forEach((ts, ti) => {
          let d = ts - pLead;
          d = ((d % T.length) + T.length) % T.length;
          if (pLead + d < turnStart) {
            turnStart = pLead + d;
            runTurn = ti;
          }
        });
        const runFrom = turnStart - KITCHEN_INTRO_RUN.beforeTurn;
        const runTo = turnStart + T.halfTurn + KITCHEN_INTRO_RUN.endAfterTurn;
        // The curve runs on past the end, so the look-ahead always has track ahead.
        const curveTo = runTo + KITCHEN_INTRO_RUN.lookAhead * 1.5;
        const pts = [];
        const steps = Math.max(8, Math.ceil((curveTo - runFrom) / 2));
        for (let i = 0; i <= steps; i++) {
          T.pointAt(runFrom + ((curveTo - runFrom) * i) / steps, KITCHEN_INTRO_RUN.lateral, _kIntroPt);
          pts.push(new THREE.Vector3(_kIntroPt.x, surf, _kIntroPt.z));
        }
        const run = new THREE.CatmullRomCurve3(pts, false, "centripetal");
        const runFracEnd = (runTo - runFrom) / (curveTo - runFrom); // the camera stops here
        return {
          T,
          surf,
          centre: new THREE.Vector3((T.xL + T.xR) / 2, surf, T.z0),
          fwd,
          out,
          inward: out.clone().negate(),
          player: player.pos.clone(),
          run,
          runLen: run.getLength(),
          runFracEnd,
          runTurn,
          // Shot time (0..1) when the camera reaches the turn (the run's position easing inverted).
          runTurnU: (2 / Math.PI) * Math.asin(Math.min(1, KITCHEN_INTRO_RUN.beforeTurn / run.getLength() / runFracEnd)),
        };
      }

      /** Pose of shot i at local time u (0..1) into `o`. */
      function _kIntroShotPose(i, u, o) {
        const R = _kIntro.rig;
        const name = KITCHEN_INTRO_SHOTS[i].name;
        if (name === "roomReveal") {
          _kIntroRevealPose(u, o);
        } else if (name === "portal") {
          _kIntroPortalCamPose(u, o);
        } else if (name === "overview") {
          const V = KITCHEN_INTRO_OVERVIEW;
          const e = _kIntroEaseSine(u);
          o.pos.copy(R.centre)
            .addScaledVector(R.fwd, _kIntroLerp(V.alongFrom, V.alongTo, e))
            .addScaledVector(R.out, _kIntroLerp(V.outFrom, V.outTo, e));
          o.pos.y = R.surf + _kIntroLerp(V.heightFrom, V.heightTo, e);
          _kIntroV.copy(R.centre).addScaledVector(R.fwd, V.lookAlongFrom);
          _kIntroV2.copy(R.player);
          _kIntroV2.y = R.surf + KITCHEN_INTRO_CAR.lookHeight;
          o.look.lerpVectors(_kIntroV, _kIntroV2, e);
          o.fov = _kIntroLerp(V.fovFrom, V.fovTo, e);
          o.roll = 0;
        } else if (name === "carBeauty") {
          const C = KITCHEN_INTRO_CAR;
          const e = _kIntroEaseSine(u);
          const a = _kIntroLerp(C.angleFromDeg, C.angleToDeg, e) * _kIntroDeg;
          const rad = _kIntroLerp(C.radiusFrom, C.radiusTo, e);
          o.pos.copy(R.player)
            .addScaledVector(R.fwd, Math.cos(a) * rad)
            .addScaledVector(R.out, Math.sin(a) * rad);
          o.pos.y = R.surf + _kIntroLerp(C.heightFrom, C.heightTo, e);
          o.look.copy(R.player);
          o.look.y = R.surf + C.lookHeight;
          o.fov = _kIntroLerp(C.fovFrom, C.fovTo, e);
          o.roll = 0;
        } else if (name === "misterSpot") {
          const P = _kIntro.spot;
          if (!P) return _kIntroShotPose(KITCHEN_INTRO_SHOTS.findIndex((sh) => sh.name === "portal"), 1, o); // no robot: hold the portal shot's last pose (shot 0 before the reveal)
          const S = KITCHEN_INTRO_SPOT;
          const e = _kIntroEaseSine(u);
          _kIntroSpotCamPos(P, e, o.pos);
          o.look.copy(P.base).addScaledVector(P.fwd, S.lookAhead * P.h);
          o.look.y = P.base.y + S.lookHeight * P.h;
          o.fov = _kIntroLerp(S.fovFrom, S.fovTo, e);
          o.roll = 0;
        } else if (name === "trackRun") {
          const W = KITCHEN_INTRO_RUN;
          // Quick along the straight, slowing through the turn to rest; eased in
          // at the start (it comes out of a fade).
          const eFast = Math.sin((Math.PI / 2) * u);
          const e = _kIntroLerp(eFast, _kIntroEaseSine(u), KITCHEN_INTRO_RUN_EASE_IN * (1 - u)) * R.runFracEnd;
          const la = Math.min(1, e + W.lookAhead / R.runLen);
          R.run.getPointAt(e, _kIntroV);
          R.run.getPointAt(la, _kIntroV2);
          o.pos.copy(_kIntroV);
          o.pos.y = R.surf + W.height;
          o.look.copy(_kIntroV2);
          o.look.y = R.surf + W.lookHeight;
          // Lean into the curve: how much the path turns over the look-ahead.
          const t0 = R.run.getTangentAt(e);
          const t1 = R.run.getTangentAt(la);
          const turn = Math.atan2(t0.x * t1.z - t0.z * t1.x, t0.x * t1.x + t0.z * t1.z);
          const maxRoll = W.maxRollDeg * _kIntroDeg;
          o.roll = Math.max(-maxRoll, Math.min(maxRoll, turn * 0.5));
          o.fov = _kIntroLerp(W.fovFrom, W.fovTo, e);
        }
        return o;
      }

      /**
       * 4. Arrival: from the run's last pose up over the infield (height first,
       * clear of the props and cars) onto the live gameplay camera.
       */
      const _kIntroArrivePos = new THREE.Vector3();
      const _kIntroArriveLook = new THREE.Vector3();
      const _kIntroArriveQuat = new THREE.Quaternion();
      function _kIntroArrivalPose(u, from, o) {
        const e = _kIntroEaseSine(u);
        const eUp = Math.sin((Math.PI / 2) * Math.min(1, u * 1.4));
        // The end point: the countdown camera's framing (its own pose function, full weight, from the race camera now),
        // so the countdown carries on from here with no cut. The race camera's fov (the countdown keeps it).
        kitchenCountdownCamPose(camera.position, camera.quaternion, 1, _kIntroArrivePos, _kIntroArriveQuat, _kIntroArriveLook);
        o.pos.x = _kIntroLerp(from.pos.x, _kIntroArrivePos.x, e);
        o.pos.z = _kIntroLerp(from.pos.z, _kIntroArrivePos.z, e);
        o.pos.y = _kIntroLerp(from.pos.y, _kIntroArrivePos.y, eUp);
        o.look.lerpVectors(from.look, _kIntroArriveLook, e);
        o.fov = _kIntroLerp(from.fov, camera.fov, e);
        o.roll = _kIntroLerp(from.roll, 0, e);
        return o;
      }

      // ── Intro shot 3: Mister Spot firing its lasers ──────────────────────────
      const _kIntroSpotBox = new THREE.Box3();
      const _kIntroSpotA = new THREE.Vector3();
      const _kIntroSpotB = new THREE.Vector3();

      /** Camera position of the Mister Spot shot at eased progress e (angle P.az on side P.sign). */
      function _kIntroSpotCamPos(P, e, out, az = P.az, sign = P.sign) {
        const S = KITCHEN_INTRO_SPOT;
        const a = (az - S.orbitDeg * e) * _kIntroDeg;
        const d = _kIntroLerp(S.distFrom, S.distTo, e) * P.h;
        out.copy(P.base).addScaledVector(P.fwd, Math.cos(a) * d).addScaledVector(P.side, Math.sin(a) * d * sign);
        out.y = P.base.y + S.height * P.h;
        return out;
      }

      /** Nearest box hit along `_jfxBgRay` beyond `from`, not counting the robot's own parts (inside its bounds). */
      function _kIntroSpotNearest(P, from) {
        let best = Infinity;
        for (const b of _jfxBackgroundBoxes()) {
          if (P.bounds.containsBox(b)) continue;
          if (!_jfxBgRay.intersectBox(b, _jfxBgHit)) continue;
          const d = _jfxBgHit.distanceTo(_jfxBgRay.origin);
          if (d > from && d < best) best = d;
        }
        return best;
      }

      /** A clear line from the robot's centre to `cam`, and `cam` not inside anything. */
      function _kIntroSpotClear(P, cam) {
        for (const b of _jfxBackgroundBoxes()) if (b.containsPoint(cam) && !P.bounds.containsBox(b)) return false;
        const toCam = _jfxDir.subVectors(cam, P.centre);
        const dist = toCam.length();
        _jfxBgRay.set(P.centre, toCam.normalize());
        return _kIntroSpotNearest(P, 0) > dist;
      }

      /** Along the whole camera path: a clear line to the robot and to points along its beams (no wall in the way). */
      const _kIntroSpotPathCam = new THREE.Vector3();
      function _kIntroSpotPathClear(P, az, sign) {
        const S = KITCHEN_INTRO_SPOT;
        for (let i = 0; i <= S.pathSamples; i++) {
          _kIntroSpotCamPos(P, i / S.pathSamples, _kIntroSpotPathCam, az, sign);
          if (!_kIntroSpotClear(P, _kIntroSpotPathCam)) return false;
          for (const k of S.beamAheadH) {
            _jfxAim.copy(P.base).addScaledVector(P.fwd, k * P.h);
            _jfxAim.y = P.base.y + S.lookHeight * P.h;
            const d = _jfxAim.distanceTo(_kIntroSpotPathCam);
            _jfxBgRay.set(_kIntroSpotPathCam, _jfxDir.subVectors(_jfxAim, _kIntroSpotPathCam).normalize());
            if (_kIntroSpotNearest(P, 0.05) < d) return false;
          }
        }
        return true;
      }

      /** Nothing between the camera and the framed area (rays across the frame reach the robot's depth). */
      function _kIntroSpotOpen(P, cam) {
        const S = KITCHEN_INTRO_SPOT;
        _jfxDir.subVectors(P.centre, cam).normalize();
        _jfxRight.crossVectors(_jfxDir, _flatUp).normalize();
        for (const [r, up] of [[0, 0], [0.5, 0], [-0.5, 0], [1, 0], [-1, 0], [0.5, -0.3], [-0.5, -0.3], [0.5, 0.4], [-0.5, 0.4]]) {
          _jfxAim.copy(P.centre).addScaledVector(_jfxRight, r * S.openSpread * P.h);
          _jfxAim.y += up * P.h;
          const d = _jfxAim.distanceTo(cam);
          _jfxBgRay.set(cam, _jfxDir.subVectors(_jfxAim, cam).normalize());
          if (_kIntroSpotNearest(P, 0.05) < d * S.openNear) return false;
        }
        _jfxDir.subVectors(P.centre, cam).normalize();
        return true;
      }

      /** Share of rays from `cam` through and around the robot that meet the kitchen behind it. */
      function _kIntroSpotCover(P, cam) {
        const S = KITCHEN_INTRO_SPOT;
        _jfxDir.subVectors(P.centre, cam).normalize();
        _jfxRight.crossVectors(_jfxDir, _flatUp).normalize();
        const offs = [[0, 0], [1, 0], [-1, 0], [0, 0.6], [0, -0.6]];
        let hits = 0;
        for (const [r, up] of offs) {
          _jfxAim.copy(P.centre).addScaledVector(_jfxRight, r * S.bgSpread * P.h);
          _jfxAim.y += up * S.bgSpread * P.h;
          const d = _jfxAim.distanceTo(cam);
          _jfxBgRay.set(cam, _jfxDir.subVectors(_jfxAim, cam).normalize());
          if (_kIntroSpotNearest(P, d) < d + JUMP_CAM_BG_DIST) hits++;
        }
        return hits / offs.length;
      }

      /** The robot stops: its frame (from its bounds and facing) and the shot's angle. */
      function _kIntroSpotFrame(m) {
        m.object.updateMatrixWorld(true);
        _kIntroSpotBox.setFromObject(m.object);
        const h = _kIntroSpotBox.max.y - _kIntroSpotBox.min.y;
        const base = new THREE.Vector3(m.object.position.x, _kIntroSpotBox.min.y, m.object.position.z);
        const fwd = new THREE.Vector3(Math.sin(m.object.rotation.y), 0, Math.cos(m.object.rotation.y));
        const P = {
          h,
          bounds: _kIntroSpotBox.clone().expandByScalar(0.5),
          base,
          centre: _kIntroSpotBox.getCenter(new THREE.Vector3()),
          fwd,
          side: new THREE.Vector3(fwd.z, 0, -fwd.x),
          az: KITCHEN_INTRO_SPOT.azCandidatesDeg[0],
          sign: 1,
        };
        let best = null;
        for (const az of KITCHEN_INTRO_SPOT.azCandidatesDeg) {
          for (const sign of [1, -1]) {
            _kIntroSpotCamPos(P, 0, _kIntroSpotA, az, sign);
            _kIntroSpotCamPos(P, 1, _kIntroSpotB, az, sign);
            const clear =
              _kIntroSpotClear(P, _kIntroSpotA) &&
              _kIntroSpotClear(P, _kIntroSpotB) &&
              _kIntroSpotOpen(P, _kIntroSpotA) &&
              _kIntroSpotOpen(P, _kIntroSpotB) &&
              _kIntroSpotPathClear(P, az, sign);
            const cover = Math.min(_kIntroSpotCover(P, _kIntroSpotA), _kIntroSpotCover(P, _kIntroSpotB));
            const c = { az, sign, clear, cover };
            if (clear && cover >= JUMP_CAM_BG_MIN) {
              best = c;
              break;
            }
            if (!best || (c.clear && !best.clear) || (c.clear === best.clear && c.cover > best.cover)) best = c;
          }
          if (best && best.clear && best.cover >= JUMP_CAM_BG_MIN) break;
        }
        P.az = best.az;
        P.sign = best.sign;
        P.cover = best.cover;
        P.clear = best.clear;
        return P;
      }

      /** Field names of Mister Spot's path / corner state, saved for the shot and restored after it. */
      const MISTER_SPOT_STATE_KEYS = ["mode", "seg", "along", "drivePhase", "phaseT", "phaseDur", "easeLen", "easeFrom", "laserT", "laserLean", "holdT", "turnT", "yawFrom", "yawTo", "yawDelta"];

      /** The shot's laser sequence: the robot stops where it is and fires (the normal effect). */
      function _kIntroSpotBegin() {
        const m = _misterSpot;
        if (!m || !m.object || !m.segs || !m.segs.length) return;
        // Its place for the shot: where it was at poseAtSec (as when the shot came then); it carries on from there after.
        const saved = _kIntro.spotPose || _kIntroSpotSnapshot(m);
        for (const k of MISTER_SPOT_STATE_KEYS) m[k] = saved[k];
        m.object.position.copy(saved.pos);
        m.object.rotation.y = saved.rotY;
        m.object.updateMatrixWorld(true);
        const S = KITCHEN_INTRO_SPOT;
        const sec = KITCHEN_INTRO_SHOTS.find((sh) => sh.name === "misterSpot").sec;
        // Laser time runs so its own fade-out ends with the shot's tail.
        m.introLaser = { t: 0, offset: MISTER_SPOT_LASER_DURATION - (S.laserLead + sec + S.laserTail), saved };
        // The angle first (the beams aren't part of the kitchen the checks look for), then the lasers.
        _kIntro.spot = _kIntroSpotFrame(m);
        m.laserLean = 0;
        startMisterSpotLaser(m);
      }

      /** Mister Spot's place and path state. */
      function _kIntroSpotSnapshot(m) {
        const snap = {};
        for (const k of MISTER_SPOT_STATE_KEYS) snap[k] = m[k];
        snap.pos = m.object.position.clone();
        snap.rotY = m.object.rotation.y;
        return snap;
      }

      /** After the shot: Mister Spot exactly as it was (same place on its path, same state). */
      function _kIntroSpotEnd() {
        const m = _misterSpot;
        if (!m || !m.introLaser) return;
        const { saved } = m.introLaser;
        m.introLaser = null;
        stopMisterSpotLaser(m);
        for (const k of MISTER_SPOT_STATE_KEYS) m[k] = saved[k];
        m.object.position.copy(saved.pos);
        m.object.rotation.y = saved.rotY;
        if (m.mode === MISTER_SPOT_MODE.LASER_1 || m.mode === MISTER_SPOT_MODE.LASER_2) {
          // It was firing at a corner: that sequence carries on from where it was.
          startMisterSpotLaser(m);
          updateMisterSpotLaser(m, m.laserT, 0);
        }
      }

      /** Start / end the shot's laser sequence on the intro's clock. */
      function _kIntroSpotTick(t) {
        let start = 0;
        for (const sh of KITCHEN_INTRO_SHOTS) {
          if (sh.name === "misterSpot") break;
          start += sh.sec;
        }
        const S = KITCHEN_INTRO_SPOT;
        const sec = KITCHEN_INTRO_SHOTS.find((sh) => sh.name === "misterSpot").sec;
        const m = _misterSpot;
        if (!_kIntro.spotPose && t >= Math.min(S.poseAtSec, start - S.laserLead) && m && m.object && m.segs && m.segs.length) {
          _kIntro.spotPose = _kIntroSpotSnapshot(m);
        }
        if (!_kIntro.spotStarted && t >= start - S.laserLead) {
          _kIntro.spotStarted = true;
          _kIntroSpotBegin();
        }
        if (_kIntro.spotStarted && !_kIntro.spotEnded && t >= start + sec + S.laserTail) {
          _kIntro.spotEnded = true;
          _kIntroSpotEnd();
        }
      }

      // ── Intro shot 1: the portal ─────────────────────────────────────────────
      // A real 3D portal standing on the table behind the grid, facing the way
      // the race starts: the end of the transition's tunnel. Its opening is a
      // stencil mask (stencil bit 2; bit 1 is the table's lamp pools): the
      // tunnel behind it (a deep glowing cylinder with the transition's coloured
      // streaks at every depth, flying toward the opening) is drawn only through
      // the opening, so it can be far deeper than the table behind it. Its rim:
      // the same streaks swirling round a torus, at different radii and depths.
      // The player's car starts deep in the tunnel (a stencil-masked copy
      // inside; the real car, clipped at the opening, as it crosses it) and
      // drives out onto its grid spot. It opens like the transition's vacuum
      // (gather into a point, a flash, a burst into the ring, the tunnel forms)
      // and collapses back into a small flash. No physics; removed after.
      const KITCHEN_INTRO_PORTAL = {
        /** Seconds into the shot (its length is the shot's `sec`, 5.6): a build-up, then the opening (as before, 1 s later). */
        buildUp: 1.0, // the air charges: a glow on the table, smoke / sparks swirling round a point, arcs crackling
        gatherEnd: 1.6, // the smoke has gathered into a point (the flash: it bursts open)
        flashSec: 0.28, // the opening / closing flash fades over this
        burstEnd: 2.0, // the ring has burst open
        tunnelIn: [1.75, 2.35], // the tunnel forms (its depth grows)
        carFrom: 2.2, // the car starts deep in the tunnel…
        carTo: 4.45, // …and stops on its grid spot
        carEase: 1.6, // ease-out power of its drive (higher: faster out of the tunnel)
        closeFrom: 4.6, // the ring collapses…
        closeTo: 5.2, // …into the closing flash
        /**
         * Size and place (world units): ring radius; the portal stands on the table from its bounds: the
         * bottom of its smoke ring sits `heightOffset` above the table's top (measured there at runtime).
         * How far behind the player's grid spot.
         */
        radius: 1.55,
        heightOffset: 0.08,
        behindGrid: 10,
        /** The car drives out at the opening's floor and lands on the table over this distance past the opening. */
        landDistance: 2.6,
        /** The tunnel: how deep it looks (world units), and where the car starts in it. */
        tunnelDepth: 14,
        carStartDepth: 8,
        /** Streaks in the tunnel: count, radius share (of the ring), length / width (world units), speed (units/s). */
        tunnelStreaks: 170,
        tunnelRadius: [0.25, 0.93],
        tunnelLen: [0.6, 1.8],
        tunnelWidth: [0.018, 0.04],
        tunnelSpeed: [7, 13],
        /** The rim's turning speed (rad/s; faster while closing). Gather: it comes in from this × the radius. */
        rimSpin: 0.55,
        gatherFrom: 2.4,
        /**
         * The rim: a ring of coloured smoke (soft sprites with animated noise): count, sprite size, how far it
         * spreads across the ring (radial / depth, world units), how far it billows out and back, its opacity,
         * noise scale / speed, and the glow from within (brightest at the inner edge).
         */
        smoke: { count: 150, size: [0.55, 0.95], thickness: 0.24, depth: 0.42, billow: 0.12, billowSpeed: [0.6, 1.4], alpha: 0.5, noiseScale: 2.6, noiseSpeed: 0.35, glow: 1.15, innerGlow: 0.9 },
        /** Small glowing particles orbiting with the smoke (a share drifting off and fading): count, size, life (s). */
        rimParticles: { count: 120, driftShare: 0.35, size: [2.5, 6], life: [0.9, 1.8], driftOut: 0.9, driftForward: 0.5 },
        /** Brightness (× colour; the scene's bloom picks it up). It's slightly stronger for this shot (bright mode too). */
        glow: 2.2,
        /** The tunnel's inner glow: colour, near the opening → deep inside. */
        tunnelColors: { near: 0x020310, deep: 0x3a30c8, core: 0xd7dcff },
        /** How the walls' glow grows with depth (higher: dark for longer, bright only deep in). */
        tunnelGlowCurve: 2.4,
        /** Light on the table and the car (no shadows): colour, intensity at full open / at the opening flash (lights up the table and around) / closing flash, reach. */
        light: { color: 0x7d74ff, intensity: 6, flash: 26, closeFlash: 10, distance: 12 },
        /** Build-up: the glow on the table at the portal's spot (opacity, × radius), how much the room dims meanwhile (share). */
        tableGlow: { opacity: 0.55, size: 1.3 },
        dim: 0.18,
        /**
         * Electric arcs: jagged glowing bolts (white-hot core, the palette's colours), redrawn every `regen` s,
         * each living `life` s, `segments` long, `width` wide. Per second: from `buildRate[0]` to `[1]` over the
         * build-up (longer and brighter as the opening nears), `burst` at once on the opening (shooting out),
         * `openRate` while open (occasional), `closeRate` while closing (pulled into the centre). A share of the
         * build-up's arcs jump down to the table (ending exactly on it). A small light flashes at their ends.
         */
        arcs: { max: 18, segments: 12, regen: 0.045, life: [0.07, 0.2], width: [0.025, 0.05], buildRate: [3, 22], burst: 12, openRate: 1.6, closeRate: 16, tableShare: 0.2, jag: 0.22, glow: 2.6, light: 3.5 },
        /** A short, subtle camera shake at the opening (world units, s, Hz). */
        shake: { amount: 0.06, duration: 0.4, freq: [47, 61] },
        /**
         * Lines breaking out into the kitchen: a tunnel line that escapes carries on through the opening
         * (the same line, unmasked past the opening's plane) for `distance` world units, straight on in a
         * tight cone (`spreadDeg`), slowing by `decel`, fading from `fadeStart` of the way, and before the
         * table (within `floorFade` above it). Which lines escape follows the shot: `steady` share while
         * open, a `burst` at the opening, `car` while the car comes out, none while closing.
         */
        escape: {
          distance: 5,
          spreadDeg: [1.5, 9], // straight out of the opening, in a tight cone (was 6–38°, some 45–70° / swirling)
          decel: 0.06, // a very slight slowdown along the straight path
          fadeStart: 0.45,
          floorFade: 0.35,
          steady: 0.3,
          burst: 1,
          burstWidth: 0.2,
          car: 0.85,
        },
        /** The opening's single burst wave: lines thrown out through the opening and past the rim (count, speed). */
        wave: { count: 70, speed: [6, 11] },
        /** Sparks drifting out of the opening: count, life (s), speed out / sideways (units/s), size. */
        sparks: { count: 70, life: [0.7, 1.4], speedOut: [1.2, 2.8], speedSide: [0.2, 1.0], size: [3, 7] },
        /** Camera: in front of the ring toward the table's front, low; a slow push-in following the car out. */
        /**
         * Camera: aimed at the portal's centre the whole shot (centred in the frame), at its height, a slow
         * push-in (distance, fov) that keeps the whole smoke ring in view with margin; its angle round the
         * portal (from straight in front) is the first of `azDeg` (either side) with nothing in the way (no
         * wall, no car) and the kitchen behind (the jump camera's background check).
         */
        cam: { distFrom: 8.4, distTo: 7.4, azDeg: [22, 30, 38, 46, 54, 15], heightOffset: -0.1, fovFrom: 46, fovTo: 42, carClear: 2.0 },
      };
      const KITCHEN_PORTAL_STENCIL = 2; // stencil bit of the opening
      const _kPortal = {
        active: false,
        done: false,
        group: null, // the portal, at its centre facing fwd (local +z = out of it)
        masked: null, // the tunnel: only through the opening
        rim: null,
        flash: null,
        light: null,
        carCopy: null, // the car inside the tunnel (stencil-masked)
        carPairs: [],
        carMats: [], // the real car's materials (clipped at the opening while it crosses it)
        carHalfLen: 1.5,
        clip: new THREE.Plane(),
        uniforms: null,
        centre: new THREE.Vector3(),
        fwd: new THREE.Vector3(),
        grid: new THREE.Vector3(),
        gridAngle: 0,
        start: new THREE.Vector3(),
        prevClipping: false,
      };
      const _kPortalV = new THREE.Vector3();

      function _kPortalSmooth(a, b, x) {
        const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
      }
      /** Car progress along its drive (0 → 1): out of the tunnel's depth, easing to a stop on its spot. */
      function _kPortalCarProgress(t) {
        const P = KITCHEN_INTRO_PORTAL;
        const u = Math.min(1, Math.max(0, (t - P.carFrom) / (P.carTo - P.carFrom)));
        return 1 - Math.pow(1 - u, P.carEase);
      }
      /** Stencil test "inside the opening" on a material. */
      function _kPortalMaskMaterial(m) {
        m.stencilWrite = true;
        m.stencilRef = KITCHEN_PORTAL_STENCIL;
        m.stencilFunc = THREE.EqualStencilFunc;
        m.stencilFuncMask = KITCHEN_PORTAL_STENCIL;
        m.stencilWriteMask = 0;
        m.stencilFail = m.stencilZFail = m.stencilZPass = THREE.KeepStencilOp;
        return m;
      }

      /** A soft round glow texture (flash / haze). */
      function _kPortalGlowTexture() {
        return portalGlowTexture(THREE);
      }

      // Shader warm-up across the intro's light changes: the portal ring brings two point lights of its own for its
      // shot. Two placeholder point lights (intensity 0) hold their places from loading (so the warm-up compiles the
      // shaders for the intro's light count) and leave the moment the ring adds its own: the count never changes. As
      // the ring starts, the shaders for the count after it (the race's) are compiled in the background, so its end
      // doesn't freeze either.
      const _kPortalLightSlots = [0, 1].map(() => {
        const l = new THREE.PointLight(0xffffff, 0, 1, 2);
        l.name = "kitchenPortalLightSlot";
        scene.add(l);
        return l;
      });
      function _kReleasePortalLightSlots() {
        for (const l of _kPortalLightSlots) if (l.parent) l.parent.remove(l);
      }
      /** Compiles (in the background, KHR_parallel_shader_compile) the shaders for the light set without `hide`. */
      function _kPrecompileWithout(hide) {
        if (!renderer.compileAsync) return;
        const was = hide.map((l) => l.visible);
        hide.forEach((l) => (l.visible = false));
        const prevTarget = renderer.getRenderTarget();
        try {
          renderer.setRenderTarget(finalComposer.readBuffer); // the frames' own target (see runKitchenWarmup)
          renderer.compileAsync(scene, camera).catch(() => {});
        } catch (e) {}
        renderer.setRenderTarget(prevTarget);
        hide.forEach((l, i) => (l.visible = was[i]));
      }

      /** Builds the portal (once, when its shot starts), from the player's grid spot. */
      function _kIntroPortalBegin() {
        const P = KITCHEN_INTRO_PORTAL;
        const R = _kIntro.rig;
        if (!R || !car) return;
        _kPortal.grid.copy(car.position);
        _kPortal.gridAngle = carState.angle;
        _kPortal.fwd.set(Math.sin(carState.angle), 0, Math.cos(carState.angle));
        _kPortal.centre.copy(_kPortal.grid).addScaledVector(_kPortal.fwd, -P.behindGrid);
        // Stands on the table from its bounds: the table's top measured here, the smoke ring's bottom just above it.
        const top = kitchenGroundY(_kPortal.centre.x, _kPortal.centre.z);
        _kPortal.top = Number.isFinite(top) ? top : R.surf;
        const S = P.smoke;
        const below = P.radius + S.thickness + S.billow + S.size[1] * 0.4; // centre → the smoke's lowest edge
        _kPortal.centre.y = _kPortal.top + below + P.heightOffset;
        // The car: at the opening's floor inside the tunnel, landing on the table past it.
        _kPortal.carLift = Math.max(0, _kPortal.centre.y - P.radius + 0.06 - _kPortal.top);
        _kPortal.start.copy(_kPortal.centre).addScaledVector(_kPortal.fwd, -P.carStartDepth);
        _kPortal.start.y = car.position.y;
        // The camera's angle: in front, either side, nothing in the way and the kitchen behind
        // (before any of the portal is in the scene: the background check's boxes are the kitchen's alone).
        _kPortalChooseCamera();
        // The opening's plane: the real car is kept only in front of it while it crosses it.
        _kPortal.clip.setFromNormalAndCoplanarPoint(_kPortal.fwd, _kPortal.centre);
        // The ring itself (the opening, the tunnel, the streaks, the smoke rim, sparks, flash, haze, its light, the
        // electric arcs): portalRing.js, shared with the Office drawer.
        const lightsBefore = new Set();
        scene.traverse((o) => o.isLight && lightsBefore.add(o));
        const ring = createPortalRing(THREE, {
          P,
          scene,
          centre: _kPortal.centre,
          fwd: _kPortal.fwd,
          floorY: _kPortal.top,
          stencilBit: KITCHEN_PORTAL_STENCIL,
          flow: 1, // the lines fly out of the ring
          getCamera: () => camera,
          bloomLayer: CAR_LIGHTS_BLOOM_LAYER,
        });
        _kPortal.ring = ring;
        // Its lights take the placeholders' places (the light count stays), and the race's shaders compile meanwhile.
        _kReleasePortalLightSlots();
        const ringLights = [];
        scene.traverse((o) => o.isLight && !lightsBefore.has(o) && ringLights.push(o));
        _kPrecompileWithout(ringLights);
        _kPortal.uniforms = ring.uniforms;
        _kPortal.group = ring.group;
        _kPortal.masked = ring.masked;
        _kPortal.unit = ring.unit;
        _kPortal.discs = ring.discs;
        _kPortal.tunnel = ring.tunnel;
        _kPortal.tunnelOut = ring.tunnelOut;
        _kPortal.wave = ring.wave;
        _kPortal.sparks = ring.sparks;
        _kPortal.smoke = ring.smoke;
        _kPortal.rimParticles = ring.rimParticles;
        _kPortal.flash = ring.flash;
        _kPortal.haze = ring.haze;
        _kPortal.light = ring.light;
        // The glow on the table at its spot (the build-up).
        const tableGlow = new THREE.Mesh(
          new THREE.CircleGeometry(P.radius * P.tableGlow.size, 48).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ map: _kPortalGlowTexture(), color: new THREE.Color(P.light.color), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, toneMapped: false }),
        );
        tableGlow.position.set(_kPortal.centre.x, _kPortal.top + 0.01, _kPortal.centre.z);
        tableGlow.renderOrder = 6;
        tableGlow.userData.skipBloomDarken = true;
        scene.add(tableGlow);
        _kPortal.tableGlow = tableGlow;
        _kPortal.arcs = ring.arcs;
        // The room dims a little while the air charges: its ambient lights, restored after.
        _kPortal.lightBase = [ambient.intensity, hemisphere.intensity];

        // The car inside the tunnel: a copy drawn only through the opening, at the tunnel's depth.
        car.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(car);
        const size = box.getSize(new THREE.Vector3());
        _kPortal.carHalfLen = Math.abs(_kPortal.fwd.x) > 0.5 ? size.x / 2 : size.z / 2;
        const copy = car.clone(true);
        const origNodes = [], copyNodes = [];
        car.traverse((n) => origNodes.push(n));
        copy.traverse((n) => copyNodes.push(n));
        _kPortal.carPairs = [];
        const drop = [];
        for (let i = 0; i < copyNodes.length; i++) {
          const n = copyNodes[i];
          if (n.isLight || n.isPoints || n.isSprite || n.isLine) {
            drop.push(n);
            continue;
          }
          _kPortal.carPairs.push([origNodes[i], n]);
          if (n.isMesh) {
            const mats = Array.isArray(n.material) ? n.material : [n.material];
            const copies = mats.map((m) => {
              const c = _kPortalMaskMaterial(m.clone());
              c.transparent = true;
              c.depthWrite = true;
              return c;
            });
            n.material = Array.isArray(n.material) ? copies : copies[0];
            n.renderOrder = 104;
            n.layers.disable(CAR_LIGHTS_BLOOM_LAYER);
          }
        }
        for (const n of drop) if (n.parent) n.parent.remove(n);
        copy.visible = false;
        scene.add(copy);
        _kPortal.carCopy = copy;
        const mats = new Set();
        car.traverse((n) => {
          if (!n.isMesh) return;
          for (const m of Array.isArray(n.material) ? n.material : [n.material]) if (m) mats.add(m);
        });
        _kPortal.carMats = [...mats];
        _kPortal.prevClipping = renderer.localClippingEnabled;
        renderer.localClippingEnabled = true;
        car.visible = false; // deep in the tunnel until it drives out
        _kPortal.active = true;
      }

      /** The car's place for shot time t, its copy inside the tunnel, and the real car clipped at the opening. */
      function _kPortalPlaceCar(t) {
        const P = KITCHEN_INTRO_PORTAL;
        const p = _kPortalCarProgress(t);
        const dist = _kPortal.start.distanceTo(_kPortalV.copy(_kPortal.grid).setY(_kPortal.start.y));
        car.position.x = _kPortal.start.x + (_kPortal.grid.x - _kPortal.start.x) * p;
        car.position.z = _kPortal.start.z + (_kPortal.grid.z - _kPortal.start.z) * p;
        // At the opening's floor in the tunnel, easing down onto the table past it.
        const past = _kPortalV.copy(car.position).sub(_kPortal.centre).dot(_kPortal.fwd);
        car.position.y = _kPortal.grid.y + _kPortal.carLift * (1 - _kPortalSmooth(0, P.landDistance, past));
        carState.angle = _kPortal.gridAngle;
        const h = 1 / 60;
        carState.speed = t > P.carFrom && t < P.carTo ? (dist * (_kPortalCarProgress(t + h) - p)) / h : 0; // wheels turn with it
        // How far its middle is in front of the opening (negative: inside the tunnel).
        const ahead = _kPortalV.copy(car.position).sub(_kPortal.centre).dot(_kPortal.fwd);
        const started = t >= P.carFrom;
        const inside = ahead < -_kPortal.carHalfLen; // all of it in the tunnel
        const crossing = !inside && ahead < _kPortal.carHalfLen;
        car.visible = started && !inside;
        for (const m of _kPortal.carMats) m.clippingPlanes = crossing ? [_kPortal.clip] : null;
        const copy = _kPortalPlaceCopy(started && (inside || crossing));
        return copy;
      }
      function _kPortalPlaceCopy(show) {
        const copy = _kPortal.carCopy;
        copy.visible = show;
        if (!show) return copy;
        car.updateMatrixWorld(true);
        for (const [o, c] of _kPortal.carPairs) {
          c.position.copy(o.position);
          c.quaternion.copy(o.quaternion);
          c.scale.copy(o.scale);
          c.visible = o === car ? true : o.visible;
        }
        copy.updateMatrixWorld(true);
        return copy;
      }

      /** Per frame of the intro: the portal's sequence (3D) and the car's drive out of it. */
      function _kIntroPortalTick(t) {
        const P = KITCHEN_INTRO_PORTAL;
        const sec = KITCHEN_INTRO_SHOTS.find((sh) => sh.name === "portal").sec;
        if (_kPortal.done) return;
        if (!_kPortal.active) _kIntroPortalBegin();
        if (!_kPortal.active) return;
        if (t >= sec) {
          _kIntroPortalEnd();
          return;
        }
        // The ring's sequence (portalRing.js), then this shot's own extras.
        const { build, gather, ring, close } = _kPortal.ring.tick(t);
        // The glow on the table at its spot: rises while the air charges, settles while open, gone with it.
        _kPortal.tableGlow.material.opacity = P.tableGlow.opacity * Math.max(build * (1 - 0.4 * ring), 0.6 * ring) * (1 - close) * (0.9 + 0.1 * Math.sin(t * 23));
        // The room dims a little while the air charges (back as it opens).
        const dimK = 1 - P.dim * build * (1 - _kPortalSmooth(P.gatherEnd, P.burstEnd + 0.4, t));
        if (_kPortal.lightBase) {
          ambient.intensity = _kPortal.lightBase[0] * dimK;
          hemisphere.intensity = _kPortal.lightBase[1] * dimK;
        }
        _kPortalPlaceCar(t);
      }

      /** The portal removed completely, and the car exactly on its grid spot (also if the intro ends early). */
      function _kIntroPortalEnd() {
        if (_kPortal.done) return;
        _kPortal.done = true;
        if (!_kPortal.active) return;
        _kPortal.active = false;
        for (const m of _kPortal.carMats) m.clippingPlanes = null;
        renderer.localClippingEnabled = _kPortal.prevClipping;
        const disposeTree = (root) => {
          root.traverse((n) => {
            if (n.geometry) n.geometry.dispose();
            const mats = n.material ? (Array.isArray(n.material) ? n.material : [n.material]) : [];
            for (const m of mats) {
              if (m.map) m.map.dispose();
              m.dispose();
            }
          });
        };
        if (_kPortal.ring) {
          _kPortal.ring.dispose(); // the ring, its light and its arcs
          _kPortal.ring = null;
        }
        if (_kPortal.carCopy) {
          scene.remove(_kPortal.carCopy);
          _kPortal.carCopy.traverse((n) => {
            const mats = n.isMesh ? (Array.isArray(n.material) ? n.material : [n.material]) : [];
            for (const m of mats) m.dispose(); // its own material copies (the geometry is the car's)
          });
        }
        if (_kPortal.tableGlow) {
          scene.remove(_kPortal.tableGlow);
          disposeTree(_kPortal.tableGlow);
          _kPortal.tableGlow = null;
        }
        _kPortal.arcs = null;
        if (_kPortal.lightBase) {
          ambient.intensity = _kPortal.lightBase[0];
          hemisphere.intensity = _kPortal.lightBase[1];
          _kPortal.lightBase = null;
        }
        _kPortal.group = _kPortal.masked = _kPortal.smoke = _kPortal.rimParticles = _kPortal.flash = _kPortal.haze = _kPortal.tunnel = _kPortal.unit = null;
        _kPortal.tunnelOut = _kPortal.wave = _kPortal.sparks = null;
        _kPortal.carCopy = _kPortal.light = null;
        _kPortal.carPairs = [];
        _kPortal.carMats = [];
        if (car) {
          car.position.x = _kPortal.grid.x;
          car.position.y = _kPortal.grid.y;
          car.position.z = _kPortal.grid.z;
          car.visible = true;
          carState.angle = _kPortal.gridAngle;
          carState.speed = 0;
        }
      }

      const _kArcSide = new THREE.Vector3(); // scratch (the camera's side axis)
      /** Camera position for the portal shot at push-in e (0 → 1), angle az (degrees) on side `sign`. */
      function _kPortalCamPos(e, az, sign, out) {
        const C = KITCHEN_INTRO_PORTAL.cam;
        const f = _kPortal.fwd;
        _kArcSide.set(f.z, 0, -f.x);
        const d = _kIntroLerp(C.distFrom, C.distTo, e);
        const a = az * _kIntroDeg;
        out.copy(_kPortal.centre).addScaledVector(f, Math.cos(a) * d).addScaledVector(_kArcSide, Math.sin(a) * d * sign);
        out.y = _kPortal.centre.y + C.heightOffset;
        return out;
      }
      /** Picks the shot's angle: nothing between the camera and the portal (no wall, no car), the kitchen behind it. */
      function _kPortalChooseCamera() {
        const P = KITCHEN_INTRO_PORTAL, C = P.cam;
        const c = _kPortal.centre;
        const cam = new THREE.Vector3(), seg = new THREE.Vector3(), toCar = new THREE.Vector3();
        const others = _raceCars.filter((rc) => !rc.isPlayer).map((rc) => rc.pos);
        const ringPts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
        const clearAt = (p) => {
          for (const b of _jfxBackgroundBoxes()) if (b.containsPoint(p)) return false;
          // The whole ring in view: lines to its bottom and both sides too (nothing in front of it, e.g. a bowl).
          _kArcSide.set(_kPortal.fwd.z, 0, -_kPortal.fwd.x);
          ringPts[0].copy(c).setY(c.y - P.radius * 0.95);
          ringPts[1].copy(c).addScaledVector(_kArcSide, P.radius * 0.95);
          ringPts[2].copy(c).addScaledVector(_kArcSide, -P.radius * 0.95);
          for (const q of ringPts) {
            const dq = p.distanceTo(q);
            _jfxBgRay.set(q, seg.subVectors(p, q).normalize());
            if (_jfxNearestBoxHit(0.05, q) < dq) return false;
          }
          const d = p.distanceTo(c);
          _jfxBgRay.set(c, seg.subVectors(p, c).normalize());
          if (_jfxNearestBoxHit(0.05, c) < d) return false;
          // The AI cars on the grid: not between it and the portal, nor right in front of it.
          for (const q of others) {
            toCar.set(q.x, q.y + 0.8, q.z).sub(c);
            const along = Math.max(0, Math.min(d, toCar.dot(seg)));
            const dist = toCar.addScaledVector(seg, -along).length();
            if (dist < C.carClear) return false;
          }
          return true;
        };
        const cover = (p) => {
          let hits = 0, n = 0;
          const fw = seg.subVectors(c, p).normalize();
          _jfxRight.crossVectors(fw, _flatUp).normalize();
          for (const [r, u] of [[0, 0], [1, 0], [-1, 0], [0, 0.7], [0, -0.5]]) {
            _jfxAim.copy(c).addScaledVector(_jfxRight, r * P.radius * 1.4);
            _jfxAim.y += u * P.radius * 1.4;
            const d = _jfxAim.distanceTo(p);
            _jfxBgRay.set(p, _jfxDir.subVectors(_jfxAim, p).normalize());
            if (_jfxNearestBoxHit(d) < d + JUMP_CAM_BG_DIST) hits++;
            n++;
          }
          return hits / n;
        };
        let best = null;
        for (const az of C.azDeg) {
          for (const sign of [1, -1]) {
            const ok = clearAt(_kPortalCamPos(0, az, sign, cam)) && clearAt(_kPortalCamPos(1, az, sign, cam));
            const cv = Math.min(cover(_kPortalCamPos(0, az, sign, cam)), cover(_kPortalCamPos(1, az, sign, cam)));
            const cand = { az, sign, ok, cv };
            if (ok && cv >= JUMP_CAM_BG_MIN) {
              _kPortal.cam = cand;
              return;
            }
            if (!best || (cand.ok && !best.ok) || (cand.ok === best.ok && cand.cv > best.cv)) best = cand;
          }
        }
        _kPortal.cam = best;
      }

      /** The portal shot's camera: aimed at the portal's centre the whole shot (centred), pushing in; a short shake at the opening. */
      function _kIntroPortalCamPose(u, o) {
        const P = KITCHEN_INTRO_PORTAL;
        const C = P.cam;
        if (!_kPortal.active && !_kPortal.done) _kIntroPortalBegin();
        const sec = KITCHEN_INTRO_SHOTS.find((sh) => sh.name === "portal").sec;
        const e = _kIntroEaseSine(u);
        const K = _kPortal.cam || { az: C.azDeg[0], sign: 1 };
        _kPortalCamPos(e, K.az, K.sign, o.pos);
        o.look.copy(_kPortal.centre);
        // Opening: a short, subtle shake (the position only: the portal stays centred).
        const t = u * sec;
        const sk = t >= P.gatherEnd ? Math.max(0, 1 - (t - P.gatherEnd) / P.shake.duration) : 0;
        if (sk > 0) {
          const a = P.shake.amount * sk * sk;
          o.pos.x += Math.sin(t * P.shake.freq[0]) * a;
          o.pos.y += Math.sin(t * P.shake.freq[1] + 1.3) * a;
          o.pos.z += Math.sin(t * (P.shake.freq[0] + P.shake.freq[1]) * 0.5 + 2.1) * a;
        }
        o.fov = _kIntroLerp(C.fovFrom, C.fovTo, e);
        o.roll = 0;
        return o;
      }

      // ── Intro shot 0: the room reveal (bright → dark) ────────────────────────
      let _kRevealCurves = null;
      /** The reveal's pose at u (0..1): along its path, looking along its look points. */
      function _kIntroRevealPose(u, o) {
        const V = KITCHEN_INTRO_REVEAL;
        // The portal is built here (under the loader) as when its shot came first; hidden until its shot.
        if (!_kPortal.active && !_kPortal.done) _kIntroPortalBegin();
        if (!_kRevealCurves) {
          const curve = (pts) => new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], 0, p[1])), false, "centripetal");
          _kRevealCurves = { pos: curve(V.path), look: curve(V.look) };
        }
        const e = _kIntroLerp(u, _kIntroEaseSine(u), V.ease);
        _kRevealCurves.pos.getPointAt(e, o.pos);
        o.pos.y = V.height;
        // Heading toward the look points (matched to the path points: same share along each, not by length),
        // pitched down by the tilt.
        _kRevealCurves.look.getPoint(_kRevealCurves.pos.getUtoTmapping(e), o.look);
        const dx = o.look.x - o.pos.x, dz = o.look.z - o.pos.z;
        const flat = Math.hypot(dx, dz) || 1;
        o.look.set(o.pos.x + dx / flat, V.height - Math.tan(V.tiltDeg * _kIntroDeg), o.pos.z + dz / flat);
        o.fov = _kIntroLerp(V.fovFrom, V.fovTo, _kIntroEaseSine(u));
        o.roll = 0;
        return o;
      }
      /** The reveal's light blend at shot time t: bright, then (from the switch) a flicker down to dark. */
      function _kRevealBlendAt(t) {
        const S = KITCHEN_INTRO_REVEAL.switch;
        const t0 = S.atShare * KITCHEN_INTRO_REVEAL.sec;
        const k = Math.min(1, Math.max(0, (t - t0) / S.sec));
        if (k <= 0) return 1;
        if (k >= 1) return 0;
        const fall = 1 - introEase(k);
        if (k >= S.flickerShare) return fall;
        const f = S.flicker;
        const step = Math.min(f.length - 1, Math.floor((k / S.flickerShare) * f.length));
        return fall * f[step];
      }

      /**
       * Lights only one of the modes uses (visible in one, hidden in the other). During the reveal they're all on
       * (the off ones at intensity 0), so the light set never changes mid-shot (a change rebuilds every visible
       * material's shader); its shaders are compiled in the warm-up (runKitchenWarmup).
       */
      let _kRevealLights = null;
      function _kRevealLightSet() {
        if (_kRevealLights) return _kRevealLights;
        const b0 = lightBlend;
        const vis = [new Set(), new Set()];
        for (const b of [0, 1]) {
          applyLightBlend(b);
          scene.traverse((o) => o.isLight && o.visible && vis[b].add(o));
        }
        applyLightBlend(b0);
        _kRevealLights = [...vis[0], ...vis[1]].filter((l) => !(vis[0].has(l) && vis[1].has(l)));
        return _kRevealLights;
      }
      /** The light blend for the reveal (b: 1 bright → 0 dark), every mode's lights kept on. */
      function _kRevealApplyLights(b) {
        lightBlend = lightBlendTarget = b;
        applyLightBlend(b);
        for (const l of _kRevealLightSet()) l.visible = true;
      }
      /** The portal's ring hidden during the reveal (it's built under the loader; it appears with its own shot). */
      function _kRevealShowPortal(show) {
        if (_kPortal.group) _kPortal.group.visible = show;
        if (_kPortal.arcs && _kPortal.arcs.mesh) _kPortal.arcs.mesh.visible = show;
      }
      /** Per frame of the intro: the reveal's lights (bright → dark) until the portal shot starts. */
      function _kIntroRevealTick(t) {
        if (_kIntro.revealDone) return;
        if (t >= _kIntro.shotStart("portal")) {
          _kIntroRevealEnd();
          return;
        }
        _kRevealApplyLights(_kRevealBlendAt(t));
        _kRevealShowPortal(false);
      }
      /** The reveal over (or skipped): dark mode exactly as before, the usual light set, the portal shown. */
      function _kIntroRevealEnd() {
        if (_kIntro.revealDone) return;
        _kIntro.revealDone = true;
        _kHdri.hold = false; // its HDRI goes with the light (in the cut's black)
        lightBlend = lightBlendTarget = 0;
        applyLightBlend(0);
        _kRevealShowPortal(true);
      }

      /** Called when the loader starts fading out: the intro begins. */
      function startKitchenIntroPlayback() {
        if (_kIntro.state !== "pending") return;
        if (!_kIntro.rig) _kIntro.rig = _kIntroBuildRig();
        if (!_kIntro.rig) {
          finishKitchenIntro();
          return;
        }
        _kIntro.state = "playing";
        _kIntro.t = 0;
        _kIntro.controlsWereEnabled = controls.enabled;
        controls.enabled = false;
      }

      /** Race camera, HUD and the countdown (end of the intro). */
      function finishKitchenIntro() {
        if (_kIntro.state === "done") return;
        _kReleasePortalLightSlots(); // skipped before the portal began: the placeholders go now
        const wasPlaying = _kIntro.state === "playing";
        _kIntro.state = "done";
        _kIntroRevealEnd(); // dark mode, the HDRI freed (if it ended mid-reveal, or never played)
        _kIntroPortalEnd(); // the portal gone, the car on its grid spot
        // Mister Spot back to its normal path if the intro ends mid-shot.
        if (_kIntro.spotStarted && !_kIntro.spotEnded) {
          _kIntro.spotEnded = true;
          _kIntroSpotEnd();
        }
        _kIntro.updateFade(); // no fade left over
        if (wasPlaying) controls.enabled = _kIntro.controlsWereEnabled;
        // Nothing pressed during the intro carries into the race.
        for (const k in keys) if (typeof keys[k] === "boolean") keys[k] = false;
        if (_racePhase === "intro") {
          _racePhase = "countdown";
          _raceTimer = RACE_COUNTDOWN_SEC;
          _ccam.enterFull = true; // the intro ended on the countdown framing
          if (_raceHud) _raceHud.setVisible(true);
        }
        setupKitchenGameplayCamera(); // first call: remembers this pose, changes nothing
      }

      // Input during the intro (and under the loader before it) is blocked by
      // the shared intro (cinematicIntro.js).

      /** The intro's arrow waves, timed with the shots. */
      function _kIntroWaves(t) {
        // A wave toward the ramp while the overview shows it.
        if (!_kIntro.rampWaveDone && t >= KITCHEN_INTRO_RAMP_WAVE_AT_SEC && _raceArrows) {
          _kIntro.rampWaveDone = true;
          const U = _raceArrows.turns.find((g) => g.ramp);
          if (U) _raceArrowStartWave(U);
        }
        // A wave on the turn the track run goes through, timed with the camera.
        if (!_kIntro.runWaveDone && _raceArrows && _kIntro.rig) {
          let runStart = 0;
          for (const sh of KITCHEN_INTRO_SHOTS) {
            if (sh.name === "trackRun") break;
            runStart += sh.sec;
          }
          const runSec = KITCHEN_INTRO_SHOTS.find((sh) => sh.name === "trackRun").sec;
          if (t >= runStart + _kIntro.rig.runTurnU * runSec - KITCHEN_INTRO_RUN_WAVE_LEAD) {
            _kIntro.runWaveDone = true;
            const U = _raceArrows.turns[_kIntro.rig.runTurn];
            if (U) _raceArrowStartWave(U);
          }
        }
        // One arrow wave along both turns as the camera arrives.
        if (!_kIntro.waveDone && t >= KITCHEN_INTRO_WAVE_AT_SEC && _raceArrows) {
          _kIntro.waveDone = true;
          for (const U of _raceArrows.turns) {
            if (U.waveT < 0) U.cooldown = 0;
            _raceArrowStartWave(U);
          }
        }
      }

      /**
       * Per frame, after the normal camera update: moves the active camera to the
       * intro pose for this frame's render (restored right after, so the race
       * camera keeps its own state and the last move can land on it exactly).
       */
      function applyKitchenIntroCamera(dt) {
        _kIntro.updateLetterbox(dt);
        if (_kIntro.state === "done") return false;
        if (!_kIntro.rig) {
          if (!_kitchenSceneReady) return false;
          _kIntro.rig = _kIntroBuildRig();
          if (!_kIntro.rig) return false; // race not set up yet: normal camera (under the loader)
        }
        if (_kIntro.state === "playing") {
          _kIntro.t += dt;
          _kIntroRevealTick(_kIntro.t);
          // The portal's sequence on its own shot's clock (it was the first shot).
          const tPortal = _kIntro.t - _kIntro.shotStart("portal");
          if (tPortal >= 0) _kIntroPortalTick(tPortal);
          _kIntroWaves(_kIntro.t);
          _kIntroSpotTick(_kIntro.t);
          if (_kIntro.t >= KITCHEN_INTRO_TOTAL_SEC) {
            finishKitchenIntro();
            return false;
          }
        }
        _kIntro.updateFade();
        _kIntro.applyCamera(_kIntro.poseAt(_kIntro.t, _kIntroPose));
        return true;
      }

      function restoreKitchenIntroCamera() {
        _kIntro.restoreCamera();
      }

      // ---------------------------------------------------------------------------
      // Player ramp jumps: slow motion, a cinematic camera arc and a landing shake.
      // Only the player's car, only off the ramp, never during the intro. The
      // world runs on scaled time (cars, AI, physics, particles, arrows); the
      // camera move and the shake run on real time. Both camera effects are drawn
      // on top of the gameplay camera at render time (it keeps its own state), so
      // it returns to the normal view with no jump.
      // ---------------------------------------------------------------------------
      const JUMP_FX_MIN_AIR_SEC = 0.05; // world seconds airborne before the effects start (no tiny bumps)
      const JUMP_FX_MIN_LAUNCH_VY = 2.4; // launch speed off the ramp needed for the effects (medium speed and up)
      const JUMP_SLOWMO_SCALE = 0.2; // world time scale in slow motion
      const JUMP_SLOWMO_EASE_IN_SEC = 0.08; // real seconds into slow motion (kicks in at takeoff)
      const JUMP_SLOWMO_EASE_OUT_SEC = 0.35; // real seconds back to 1× (from the landing)
      const JUMP_SLOWMO_MAX_REAL_SEC = 4.8; // a very long jump leaves slow motion after this (a top-speed flight fits: ~0.82 s × 5; was 4.2)
      const JUMP_CAM_ZOOM = 0.25; // camera distance × this (close to the car)
      const JUMP_CAM_MIN_DIST = 4.2; // never closer than this to the car (whole car in frame)
      /**
       * Slow-motion camera angles, picked at random per jump (never the same
       * twice in a row), each tried on both sides of the car. Relative to the
       * car's direction of travel at takeoff: az = degrees round the car (0 =
       * ahead, 90 = its side, 180 = behind), from → to through the slow motion;
       * dist = distance; height = above the car, or groundHeight = above the
       * ground under the camera (the low angle, looking up); fov = lens change.
       */
      const JUMP_CAM_ANGLES = [
        { name: "lowSide", azFrom: 100, azTo: 78, dist: 5.4, height: 0.5, fov: -4 }, // close, following it through the air
        { name: "frontThreeQuarter", azFrom: 40, azTo: 24, dist: 7, height: 1.6, fov: -6 }, // it flies toward the camera
        { name: "lowUnder", azFrom: 68, azTo: 50, dist: 5.6, groundHeight: 0.9, fov: 4 }, // below its path, looking up
        { name: "highThreeQuarter", azFrom: 145, azTo: 122, dist: 7.5, height: 5.5, fov: -2 }, // above, the car over the table
        { name: "wideOrbit", azFrom: 165, azTo: 55, dist: 8.8, height: 2.2, fov: 0 }, // a wide swing round the car
      ];
      /** Background check: rays from the camera through / around the car must hit the kitchen. */
      const JUMP_CAM_BG_DIST = 90; // how far past the car to look for kitchen geometry
      const JUMP_CAM_BG_MIN = 0.8; // share of those rays that must hit it (the kitchen fills the background)
      const JUMP_CAM_BG_SPREAD = 1.6; // the rays pass this far around the car
      const JUMP_CAM_BG_MAX_BOX = 150; // objects bigger than this (ground / sky) don't count as background
      const JUMP_CAM_FOV_DELTA = -6; // degrees: a slightly tighter lens in slow motion
      const JUMP_CAM_CLEARANCE = 0.5; // keep this far from the ramp / table / rails
      const JUMP_CAM_ORBIT_SEC = 1.8; // real seconds for the whole arc
      const JUMP_CAM_LIFT = 0.12; // extra camera height, × its distance
      const JUMP_CAM_IN_SEC = 0.35; // real seconds to blend into the jump camera
      const JUMP_CAM_OUT_SEC = 0.7; // real seconds back to the gameplay camera
      const LAND_SHAKE_MAX = 0.5; // world units, at full impact
      const LAND_SHAKE_ROLL_DEG = 2.4; // camera roll at full impact
      const LAND_KICK_DOWN = 0.22; // a quick downward camera kick at the impact (world units, full impact)
      const LAND_KICK_FOV = 3; // degrees wider at the impact, settling back
      const LAND_KICK_SEC = 0.18; // kick decay (real seconds)
      const LAND_SHAKE_SEC = 0.4;
      const LAND_SHAKE_FREQ = 15; // Hz (smooth noise)
      const LAND_SHAKE_REF_VY = 16; // landing speed (down) for full intensity
      const JUMP_VIGNETTE_STRENGTH = 0.45; // edge darkening in slow motion (0 = off)

      let _kitchenTimeScale = 1;
      const _jumpFx = {
        active: false,
        tReal: 0,
        w: 0, // jump camera blend (0 = gameplay camera)
        orbit: 0, // current arc (rad)
        orbitSign: 1,
        wasAir: false,
        airVy: 0,
        airWorld: 0,
        launchVy: 0,
        shakeT: Infinity,
        shakeAmp: 0,
        shakeSeed: [0, 0, 0, 0, 0, 0],
        overriding: false,
        savedPos: new THREE.Vector3(),
        savedQuat: new THREE.Quaternion(),
        savedFov: 50,
      };
      const _jfxTarget = new THREE.Vector3();
      const _jfxRay = new THREE.Raycaster();
      const _jfxDir = new THREE.Vector3();
      let _jfxObstacles = null;
      /** The few static surfaces the jump camera keeps clear of (cheap to raycast). */
      function _jfxCameraObstacles() {
        if (_jfxObstacles) return _jfxObstacles;
        _jfxObstacles = [];
        for (const n of ["ramp", "mainTablePlate", "mainTableTopPlane", "raceBoundaries", "raceBoundariesLegs"]) {
          const o = scene.getObjectByName(n);
          if (o && o.isMesh) _jfxObstacles.push(o);
        }
        return _jfxObstacles;
      }
      const _jfxOff = new THREE.Vector3();
      const _jfxPos = new THREE.Vector3();
      const _jfxLook = new THREE.Vector3();
      const _jfxRight = new THREE.Vector3();
      const _jfxUp = new THREE.Vector3();

      function _jfxCameraIsGameplay() {
        return camera === carCamera || camera === carCameraFollow;
      }

      /** Per frame (real time, before the world steps): jump detection, time scale, camera blend. */
      function updateKitchenTimeScale(realDt) {
        const F = _jumpFx;
        const air = !carFalling && carState.velY !== 0 && !!carState._rampAir;
        const allowed = _kIntro.state === "done" && _jfxCameraIsGameplay();
        // Start: the player's car has been off the ramp long enough.
        if (!F.active && air && allowed && F.airWorld >= JUMP_FX_MIN_AIR_SEC && F.launchVy >= JUMP_FX_MIN_LAUNCH_VY) {
          F.active = true;
          F.tReal = 0;
          F.orbit = 0;
          chooseJumpCameraAngle();
        }
        if (F.active) {
          F.tReal += realDt;
          if (!air || F.tReal > JUMP_SLOWMO_MAX_REAL_SEC || !allowed) F.active = false;
        }
        // Landing (after a ramp jump): a shake scaled by the landing speed.
        if (F.wasAir && !air && !carFalling && allowed) {
          const k = Math.min(1, Math.max(0, -F.airVy / LAND_SHAKE_REF_VY));
          if (k > 0.05) {
            F.shakeT = 0;
            F.shakeAmp = k;
            for (let i = 0; i < 6; i++) F.shakeSeed[i] = Math.random() * Math.PI * 2;
            _carLandShakePending = false; // this replaces the generic landing shake
          }
        }
        F.wasAir = air;
        if (!air) F.airWorld = 0;
        // Time scale toward its target (smooth, real time).
        const target = F.active ? JUMP_SLOWMO_SCALE : 1;
        const tau = (target < _kitchenTimeScale ? JUMP_SLOWMO_EASE_IN_SEC : JUMP_SLOWMO_EASE_OUT_SEC) / 3;
        _kitchenTimeScale += (target - _kitchenTimeScale) * (1 - Math.exp(-realDt / tau));
        if (Math.abs(_kitchenTimeScale - target) < 1e-3) _kitchenTimeScale = target;
        // Camera blend and arc (real time).
        const wTarget = F.active ? 1 : 0;
        const wSec = F.active ? JUMP_CAM_IN_SEC : JUMP_CAM_OUT_SEC;
        F.w = wTarget === 1 ? Math.min(1, F.w + realDt / wSec) : Math.max(0, F.w - realDt / wSec);
        if (F.active) F.orbit = _kIntroEaseSine(Math.min(1, F.tReal / JUMP_CAM_ORBIT_SEC)); // the angle's move, 0..1
        if (F.shakeT < LAND_SHAKE_SEC) F.shakeT += realDt;
      }

      // --- Jump camera angles: the kitchen always in the background ---------
      let _jfxBgBoxes = null;
      const _jfxBgRay = new THREE.Ray();
      const _jfxBgHit = new THREE.Vector3();
      const _jfxFwd = new THREE.Vector3();
      const _jfxSide = new THREE.Vector3();
      const _jfxCand = new THREE.Vector3();
      const _jfxAim = new THREE.Vector3();
      let _jfxLastAngle = null;

      /** World boxes of the kitchen's static geometry (not the cars, effects or ground), built once. */
      function _jfxBackgroundBoxes() {
        if (_jfxBgBoxes) return _jfxBgBoxes;
        const skip = new Set([car]);
        for (const rc of _raceCars) if (rc.root) skip.add(rc.root);
        if (_raceArrows) {
          skip.add(_raceArrows.mesh);
          skip.add(_raceArrows.refl);
        }
        const inSkipped = (o) => {
          for (let p = o; p; p = p.parent) if (skip.has(p)) return true;
          return false;
        };
        _jfxBgBoxes = [];
        scene.updateMatrixWorld(true);
        scene.traverse((o) => {
          if (!o.isMesh || !o.visible || o.userData.noCollision || inSkipped(o)) return;
          let box;
          if (o.isInstancedMesh) {
            if (!o.boundingBox) o.computeBoundingBox();
            box = o.boundingBox.clone().applyMatrix4(o.matrixWorld);
          } else {
            box = new THREE.Box3().setFromObject(o);
          }
          if (box.isEmpty()) return;
          const sz = box.getSize(_jfxCand);
          if (Math.max(sz.x, sz.y, sz.z) > JUMP_CAM_BG_MAX_BOX) return;
          _jfxBgBoxes.push(box);
        });
        return _jfxBgBoxes;
      }

      /** Nearest box hit along `_jfxBgRay` beyond `from` (and not containing `skipPt`), or Infinity. */
      function _jfxNearestBoxHit(from, skipPt) {
        let best = Infinity;
        for (const b of _jfxBackgroundBoxes()) {
          if (skipPt && b.containsPoint(skipPt)) continue;
          if (!_jfxBgRay.intersectBox(b, _jfxBgHit)) continue;
          const d = _jfxBgHit.distanceTo(_jfxBgRay.origin);
          if (d > from && d < best) best = d;
        }
        return best;
      }

      /** Camera position for `A` (side `sign`) at move progress `u`, around the car at `at`. */
      function _jfxAnglePos(A, sign, u, at, out) {
        const az = (A.azFrom + (A.azTo - A.azFrom) * u) * (Math.PI / 180);
        out.copy(at)
          .addScaledVector(_jfxFwd, Math.cos(az) * A.dist)
          .addScaledVector(_jfxSide, Math.sin(az) * A.dist * sign);
        out.y = A.groundHeight !== undefined ? kitchenGroundY(out.x, out.z) + A.groundHeight : at.y + A.height;
        return out;
      }

      /**
       * At takeoff: every angle (both sides) is checked for kitchen behind the
       * car and a clear view to it; a random valid one (not the last), else the
       * one with the most kitchen behind.
       */
      function chooseJumpCameraAngle() {
        const F = _jumpFx;
        _jfxFwd.set(Math.sin(carState.angle), 0, Math.cos(carState.angle));
        _jfxSide.set(_jfxFwd.z, 0, -_jfxFwd.x);
        const at = car.position;
        const cands = [];
        for (const A of JUMP_CAM_ANGLES) {
          for (const sign of [1, -1]) {
            _jfxAnglePos(A, sign, 0.5, at, _jfxCand);
            // A clear view: nothing between the camera and the car.
            const toCam = _jfxDir.subVectors(_jfxCand, at);
            const camDist = toCam.length();
            _jfxBgRay.set(at, toCam.normalize());
            const clear = _jfxNearestBoxHit(0.6, at) > camDist;
            // Background: rays from the camera through and around the car.
            _jfxRight.crossVectors(toCam, _flatUp).normalize();
            let hits = 0;
            const offs = [[0, 0], [1, 0], [-1, 0], [0, 0.6], [0, -0.6]];
            for (const [r, u] of offs) {
              _jfxAim.copy(at).addScaledVector(_jfxRight, r * JUMP_CAM_BG_SPREAD);
              _jfxAim.y += u * JUMP_CAM_BG_SPREAD;
              const d = _jfxAim.distanceTo(_jfxCand);
              _jfxBgRay.set(_jfxCand, _jfxDir.subVectors(_jfxAim, _jfxCand).normalize());
              if (_jfxNearestBoxHit(d + 0.5) < d + JUMP_CAM_BG_DIST) hits++;
            }
            cands.push({ A, sign, clear, cover: hits / offs.length });
          }
        }
        const fresh = cands.filter((c) => c.A.name !== _jfxLastAngle);
        const pool = fresh.length ? fresh : cands;
        const valid = pool.filter((c) => c.clear && c.cover >= JUMP_CAM_BG_MIN);
        let pick;
        if (valid.length) pick = valid[Math.floor(Math.random() * valid.length)];
        else pick = pool.slice().sort((a, b) => b.clear - a.clear || b.cover - a.cover)[0];
        F.angle = pick.A;
        F.angleSign = pick.sign;
        F.fwd = _jfxFwd.clone();
        F.side = _jfxSide.clone();
        _jfxLastAngle = pick.A.name;
      }

      /** Smooth noise in [-1, 1] (two detuned sines). */
      function _jfxNoise(t, seed) {
        const w = LAND_SHAKE_FREQ * Math.PI * 2;
        return (Math.sin(t * w + seed) + 0.5 * Math.sin(t * w * 2.13 + seed * 1.7)) / 1.5;
      }

      /** At render: the jump camera (blended) and the landing shake on top of the gameplay camera. */
      function applyKitchenJumpCamera() {
        const F = _jumpFx;
        const shaking = F.shakeT < LAND_SHAKE_SEC;
        updateKitchenJumpVignette();
        if ((F.w <= 0 && !shaking) || _kIntro.overriding || !_jfxCameraIsGameplay()) return false;
        F.savedPos.copy(camera.position);
        F.savedQuat.copy(camera.quaternion);
        F.savedFov = camera.fov;
        _jfxPos.copy(camera.position);
        _jfxLook.copy(controls.target);
        let fov = camera.fov;
        if (F.w > 0) {
          const e = _kIntroEaseSine(F.w);
          // The chosen angle round the car (its frame from takeoff), moving
          // from → to through the slow motion.
          _jfxTarget.copy(car.position);
          if (F.angle) {
            _jfxFwd.copy(F.fwd);
            _jfxSide.copy(F.side);
            _jfxAnglePos(F.angle, F.angleSign, F.orbit, _jfxTarget, _jfxCand);
            _jfxOff.subVectors(_jfxCand, _jfxTarget);
            if (_jfxOff.length() < JUMP_CAM_MIN_DIST) _jfxOff.setLength(JUMP_CAM_MIN_DIST);
          } else {
            _jfxOff.subVectors(camera.position, controls.target);
            const dist = Math.max(JUMP_CAM_MIN_DIST, _jfxOff.length() * JUMP_CAM_ZOOM);
            _jfxOff.setLength(dist);
            _jfxOff.y += dist * JUMP_CAM_LIFT;
          }
          // Keep clear of the ramp / table / rails: pull in along the line to the car.
          _jfxDir.copy(_jfxOff).normalize();
          _jfxRay.set(_jfxTarget, _jfxDir);
          _jfxRay.far = _jfxOff.length();
          const hit = _jfxRay.intersectObjects(_jfxCameraObstacles(), false)[0];
          if (hit) _jfxOff.setLength(Math.max(1.5, hit.distance - JUMP_CAM_CLEARANCE));
          _jfxOff.add(_jfxTarget);
          _jfxOff.y = Math.max(_jfxOff.y, kitchenGroundY(_jfxOff.x, _jfxOff.z) + JUMP_CAM_CLEARANCE + 0.3);
          _jfxPos.lerp(_jfxOff, e);
          _jfxLook.lerp(_jfxTarget, e);
          fov += (F.angle ? F.angle.fov : JUMP_CAM_FOV_DELTA) * e;
        }
        if (shaking) {
          // The impact's first hit: a quick downward kick and a wider lens, settling fast.
          const kick = F.shakeAmp * Math.exp(-F.shakeT / LAND_KICK_SEC);
          _jfxPos.y -= LAND_KICK_DOWN * kick;
          fov += LAND_KICK_FOV * kick;
        }
        camera.position.copy(_jfxPos);
        camera.up.set(0, 1, 0);
        camera.lookAt(_jfxLook);
        if (shaking) {
          const u = F.shakeT / LAND_SHAKE_SEC;
          const amp = F.shakeAmp * (1 - u) * (1 - u);
          const t = F.shakeT;
          camera.updateMatrix();
          _jfxRight.setFromMatrixColumn(camera.matrix, 0);
          _jfxUp.setFromMatrixColumn(camera.matrix, 1);
          camera.position
            .addScaledVector(_jfxRight, _jfxNoise(t, F.shakeSeed[0]) * amp * LAND_SHAKE_MAX)
            .addScaledVector(_jfxUp, _jfxNoise(t, F.shakeSeed[1]) * amp * LAND_SHAKE_MAX);
          camera.rotateZ(_jfxNoise(t, F.shakeSeed[2]) * amp * LAND_SHAKE_ROLL_DEG * (Math.PI / 180));
        }
        if (Math.abs(fov - camera.fov) > 1e-4) {
          camera.fov = fov;
          camera.updateProjectionMatrix();
        }
        camera.updateMatrixWorld();
        F.overriding = true;
        return true;
      }

      /** Edge darkening while the world is slowed (only enabled while it shows). */
      function updateKitchenJumpVignette() {
        const k = (1 - _kitchenTimeScale) / (1 - JUMP_SLOWMO_SCALE);
        const strength = JUMP_VIGNETTE_STRENGTH * Math.max(0, Math.min(1, k));
        jumpVignettePass.uniforms.uStrength.value = strength;
        jumpVignettePass.enabled = strength > 0.005;
      }

      function restoreKitchenJumpCamera() {
        const F = _jumpFx;
        if (!F.overriding) return;
        camera.position.copy(F.savedPos);
        camera.quaternion.copy(F.savedQuat);
        if (camera.fov !== F.savedFov) {
          camera.fov = F.savedFov;
          camera.updateProjectionMatrix();
        }
        camera.updateMatrixWorld();
        F.overriding = false;
      }

      // ---------------------------------------------------------------------------
      // Countdown camera: during the countdown the race camera swings left round the car so the start lights are in
      // frame with the cars, and eases back from GO. Drawn on top of the race camera at render time (applied before
      // the render, restored right after), so the camera's own state, follow and behaviour are never touched: once the
      // swing reaches 0 nothing is applied and the frame is exactly the normal one. Timed by raceTimeFromGo(), the
      // same clock as the countdown HUD and the start lights' green. The intro's arrival ends on this framing
      // (kitchenCountdownCamPose at full weight), so the first countdown starts already swung.
      // ---------------------------------------------------------------------------
      /** Smootherstep: ease in-out with no speed and no acceleration at either end. */
      const smootherstep = (t) => t * t * t * (t * (6 * t - 15) + 10);
      const KITCHEN_COUNTDOWN_CAM = {
        yawDeg: -60, // swing round the car about the vertical (degrees; negative = to the left, toward the start lights)
        lookShift: 0.68, // aim this share of the way from the car toward the start lights (both framed)
        distance: 0.5, // the camera's distance from the car × this (closer: the lights read larger)
        enterSec: 0.7, // easing in as a countdown starts without the intro ("Race again")
        enterEase: introEaseSine,
        returnSec: 1.25, // back to the normal camera from GO
        returnEase: smootherstep, // gentle in-out: no jolt as it leaves the countdown view or lands on the race camera
        clearance: 0.5, // kept between the camera and anything between it and the car
      };
      const _ccam = {
        overriding: false,
        enterFull: false, // this countdown came from the intro, which ended on the countdown framing: no ease in
        savedPos: new THREE.Vector3(),
        savedQuat: new THREE.Quaternion(),
        look: new THREE.Vector3(),
        aim0: new THREE.Vector3(),
        aim1: new THREE.Vector3(),
        aim: new THREE.Vector3(),
        off: new THREE.Vector3(),
        q: new THREE.Quaternion(),
        q0: new THREE.Quaternion(),
        dev: new THREE.Quaternion(),
        id: new THREE.Quaternion(),
        m: new THREE.Matrix4(),
        ray: new THREE.Raycaster(),
        dir: new THREE.Vector3(),
        pos: new THREE.Vector3(),
      };
      /** The swing's weight now (0..1): eased in from the countdown's start (full from the intro), out from GO; 0 outside. */
      function kitchenCountdownCamWeight() {
        const C = KITCHEN_COUNTDOWN_CAM;
        const t = raceTimeFromGo();
        if (t == null) return 0;
        if (t < 0) return _ccam.enterFull ? 1 : C.enterEase(Math.min(1, (t + RACE_COUNTDOWN_SEC) / C.enterSec));
        return t >= C.returnSec ? 0 : 1 - C.returnEase(t / C.returnSec);
      }
      /**
       * The countdown camera at weight w from the race camera's pose (basePos / baseQuat), into outPos / outQuat;
       * outAim: the point it looks at. Position: the race camera's offset from the car turned by yawDeg × w and scaled
       * toward `distance`, kept clear of anything between. Rotation: looking at a point moving from where the race
       * camera looks to the countdown's aim, so turning and travelling stay together (no wobble); at w = 0 exactly the
       * race camera's rotation, at w = 1 exactly the countdown framing.
       */
      function kitchenCountdownCamPose(basePos, baseQuat, w, outPos, outQuat, outAim) {
        const C = KITCHEN_COUNTDOWN_CAM;
        const K = _ccam;
        getCarCameraLookAtPoint(K.look);
        K.off.copy(basePos).sub(K.look);
        const baseDist = K.off.length();
        K.off.applyAxisAngle(THREE.Object3D.DEFAULT_UP, THREE.MathUtils.degToRad(C.yawDeg) * w).multiplyScalar(1 + (C.distance - 1) * w);
        outPos.copy(K.look).add(K.off);
        // Nothing between the car and the camera: pulled in front of the first hit.
        const dist = K.off.length();
        if (_kitchenDragRoot && dist > 1e-3) {
          K.ray.set(K.look, K.dir.copy(K.off).divideScalar(dist));
          K.ray.far = dist;
          let hits = [];
          try {
            hits = K.ray.intersectObject(_kitchenDragRoot, true);
          } catch (e) {
            hits = [];
          }
          for (const h of hits) {
            if (!h.object.visible || !h.object.isMesh) continue;
            let own = false;
            for (let x = h.object; x; x = x.parent) if (x === car) own = true;
            if (own) continue;
            outPos.copy(K.look).addScaledVector(K.dir, Math.max(0, h.distance - C.clearance));
            break;
          }
        }
        // Where the race camera looks (at the car's distance), and the countdown's aim (toward the start lights).
        K.aim0.set(0, 0, -1).applyQuaternion(baseQuat).multiplyScalar(baseDist).add(basePos);
        K.aim1.copy(K.look);
        if (_startLights && _startLights.center) K.aim1.lerp(_startLights.center, C.lookShift);
        K.aim.lerpVectors(K.aim0, K.aim1, w);
        if (outAim) outAim.copy(K.aim);
        K.m.lookAt(outPos, K.aim, THREE.Object3D.DEFAULT_UP);
        K.q.setFromRotationMatrix(K.m);
        // The race camera's own deviation from a plain look-at (a shake, a roll), faded out with the swing.
        K.m.lookAt(basePos, K.aim0, THREE.Object3D.DEFAULT_UP);
        K.q0.setFromRotationMatrix(K.m);
        K.dev.copy(baseQuat).multiply(K.q0.invert());
        outQuat.copy(K.id.identity().slerp(K.dev, 1 - w)).multiply(K.q);
      }
      function applyKitchenCountdownCamera() {
        const K = _ccam;
        if (!car || camera !== carCamera || _kIntro.state !== "done" || _kIntro.overriding || _jumpFx.overriding) return;
        const w = kitchenCountdownCamWeight();
        if (w <= 0) return;
        K.savedPos.copy(camera.position);
        K.savedQuat.copy(camera.quaternion);
        K.overriding = true;
        kitchenCountdownCamPose(K.savedPos, K.savedQuat, w, camera.position, camera.quaternion, null);
        camera.updateMatrixWorld();
      }
      function restoreKitchenCountdownCamera() {
        const K = _ccam;
        if (!K.overriding) return;
        camera.position.copy(K.savedPos);
        camera.quaternion.copy(K.savedQuat);
        camera.updateMatrixWorld();
        K.overriding = false;
      }

      // ---------------------------------------------------------------------------
      // Chase camera (key 2; key 1 back to the race camera): behind the player's car, along its direction of travel,
      // a little above it, tilted down, the track ahead in view (after the reference: a classic racing-game chase
      // view). Sizes are in the car's own length, so it frames the same whatever the car's scale. Follows with
      // damping (position and heading separately, exponential), and keeps a clear line to the car: a ray from the car
      // to where the camera wants to be; on a hit (walls, objects, raceBoundariesPhysic) it closes in quickly in front
      // of it, and eases back out once clear. Only once the race runs (the intro and the countdown drive the race
      // camera); "Race again" returns to the race camera for its countdown.
      // ---------------------------------------------------------------------------
      const KITCHEN_CHASE_CAM = {
        distance: 2.35, // behind the car (× its length)
        height: 0.85, // above the car's base (× its length)
        tiltDeg: 11, // looking down by this much
        fovDeg: 56, // vertical field of view
        lookAhead: 0.15, // aim height above the car's base for the clear-line check (× its length)
        posDamping: 7, // position follow (per second: higher = tighter)
        yawDamping: 5, // heading follow (per second)
        heightDamping: 6, // height follow (per second; softens bumps)
        driftFollow: 0.5, // how much of a drift's slide angle it follows (0 = the car's nose)
        clearance: 0.25, // kept in front of anything between it and the car
        closeIn: 14, // per second, closing in on a blocker (quick)
        easeOut: 2.5, // per second, easing back out once clear
        colliderNames: ["raceBoundariesPhysic"], // hidden physics meshes it must not pass through either
      };
      const _chase = {
        active: false,
        yaw: 0,
        pos: new THREE.Vector3(),
        y: 0,
        dist: 0, // the clear-line distance factor (1 = full distance)
        savedOrbit: null, // the race camera's state when it was left
        ray: new THREE.Raycaster(),
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        dir: new THREE.Vector3(),
        target: new THREE.Vector3(),
        q: new THREE.Quaternion(),
        e: new THREE.Euler(0, 0, 0, "YXZ"),
        carLen: 1,
      };
      function chaseCarLength() {
        if (!car) return 1;
        const b = new THREE.Box3().setFromObject(car);
        const s = b.getSize(new THREE.Vector3());
        return Math.max(0.5, Math.max(s.x, s.z));
      }
      const _chaseAngle = () => carState.angle + (carState.driftAngle || 0) * KITCHEN_CHASE_CAM.driftFollow;
      /** Where the chase camera wants to be for heading `yaw` (full distance × f). */
      function chaseDesired(yaw, f, out) {
        const C = KITCHEN_CHASE_CAM;
        const L = _chase.carLen;
        return out.set(car.position.x - Math.sin(yaw) * C.distance * L * f, car.position.y + C.height * L * f, car.position.z - Math.cos(yaw) * C.distance * L * f);
      }
      /** Share of the full distance with a clear line from the car (1 = clear). */
      function chaseClearShare(yaw) {
        const C = KITCHEN_CHASE_CAM;
        const L = _chase.carLen;
        _chase.from.copy(car.position);
        _chase.from.y += C.lookAhead * L;
        chaseDesired(yaw, 1, _chase.to);
        _chase.dir.subVectors(_chase.to, _chase.from);
        const full = _chase.dir.length();
        if (full < 1e-4 || !_kitchenDragRoot) return 1;
        _chase.dir.divideScalar(full);
        _chase.ray.set(_chase.from, _chase.dir);
        _chase.ray.far = full + C.clearance;
        let hits = [];
        try {
          hits = _chase.ray.intersectObject(_kitchenDragRoot, true);
        } catch (e) {
          hits = [];
        }
        for (const h of hits) {
          if (!h.object.isMesh) continue;
          if (!h.object.visible && !KITCHEN_CHASE_CAM.colliderNames.includes(h.object.name)) continue;
          let own = false;
          for (let x = h.object; x; x = x.parent) if (x === car) own = true;
          if (own) continue;
          return Math.max(0.15, (h.distance - C.clearance) / full);
        }
        return 1;
      }
      function placeChaseCamera() {
        const C = KITCHEN_CHASE_CAM;
        chaseDesired(_chase.yaw, _chase.dist, _chase.target);
        chaseCamera.position.set(_chase.pos.x, _chase.y, _chase.pos.z);
        // Facing the car's way (the camera looks down its -z: yaw + π), tilted down.
        _chase.e.set(-THREE.MathUtils.degToRad(C.tiltDeg), _chase.yaw + Math.PI, 0);
        chaseCamera.quaternion.setFromEuler(_chase.e);
        chaseCamera.updateMatrixWorld();
      }
      function enterKitchenChaseCamera() {
        if (!car || camera === chaseCamera) return;
        // Only while the race runs: the intro and the countdown camera drive the race camera.
        if (_kIntro.state !== "done" || !(_racePhase === "racing" || _racePhase === "finishing" || _racePhase === "finished")) return;
        if (camera !== carCamera) switchCarView(carCamera); // from the free / test cameras: via the race camera
        const C = KITCHEN_CHASE_CAM;
        cancelKitchenCameraFx(); // no jump camera left over on the race camera
        _chase.savedOrbit = { distance: _carOrbitCamDistance, elev: _carOrbitCamElev, yaw: _carOrbitCamWorldYaw, fov: carCamera.fov };
        _chase.carLen = chaseCarLength();
        _chase.yaw = _chaseAngle();
        _chase.dist = chaseClearShare(_chase.yaw);
        chaseDesired(_chase.yaw, _chase.dist, _chase.target);
        _chase.pos.copy(_chase.target);
        _chase.y = _chase.target.y;
        camera = chaseCamera;
        renderScenePass.camera = camera;
        const mount = getKitchenSceneMount();
        camera.fov = C.fovDeg;
        camera.aspect = Math.max(1, mount.clientWidth || window.innerWidth) / Math.max(1, mount.clientHeight || window.innerHeight);
        camera.updateProjectionMatrix();
        if (controls) controls.enabled = false; // the chase camera follows by itself
        _chase.active = true;
        placeChaseCamera();
      }
      function leaveKitchenChaseCamera() {
        if (camera !== chaseCamera) return;
        _chase.active = false;
        if (controls) controls.enabled = true;
        // The race camera back where it was left (its own orbit round the car, as it was), then the normal switch.
        const S = _chase.savedOrbit;
        camera = carCamera;
        if (S) {
          _carOrbitCamDistance = S.distance;
          _carOrbitCamElev = S.elev;
          _carOrbitCamWorldYaw = S.yaw;
          if (carCamera.fov !== S.fov) {
            carCamera.fov = S.fov;
            carCamera.updateProjectionMatrix();
          }
          applyCarOrbitCameraFromAngles();
        }
        camera = chaseCamera; // switchCarView switches from the current camera
        switchCarView(carCamera);
      }
      function updateKitchenChaseCamera(dt) {
        if (camera !== chaseCamera || !car) return;
        const C = KITCHEN_CHASE_CAM;
        const k = (rate) => 1 - Math.exp(-rate * dt);
        // Heading: toward the car's direction of travel, the short way round.
        let dy = _chaseAngle() - _chase.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        _chase.yaw += dy * k(C.yawDamping);
        // A clear line: close in fast on a blocker, ease back out slowly.
        const clear = chaseClearShare(_chase.yaw);
        _chase.dist += (clear - _chase.dist) * k(clear < _chase.dist ? C.closeIn : C.easeOut);
        chaseDesired(_chase.yaw, _chase.dist, _chase.target);
        _chase.pos.x += (_chase.target.x - _chase.pos.x) * k(C.posDamping);
        _chase.pos.z += (_chase.target.z - _chase.pos.z) * k(C.posDamping);
        _chase.y += (_chase.target.y - _chase.y) * k(C.heightDamping);
        // Never further out than the clear line allows (the damping must not carry it into what it just avoided).
        _chase.from.copy(car.position);
        _chase.from.y += C.lookAhead * _chase.carLen;
        const maxD = C.distance * _chase.carLen * Math.max(_chase.dist, clear) * 1.02 + 0.01;
        _chase.dir.set(_chase.pos.x - _chase.from.x, _chase.y - _chase.from.y, _chase.pos.z - _chase.from.z);
        const d = _chase.dir.length();
        if (d > Math.hypot(maxD, C.height * _chase.carLen) && clear < 1) {
          _chase.dir.multiplyScalar(Math.hypot(maxD, C.height * _chase.carLen) / d);
          _chase.pos.set(_chase.from.x + _chase.dir.x, 0, _chase.from.z + _chase.dir.z);
          _chase.y = _chase.from.y + _chase.dir.y;
        }
        placeChaseCamera();
      }

      // ---------------------------------------------------------------------------
      // Performance: the glass jars' transmission pass. For transmissive materials three renders every opaque object
      // a second time (into a full-size, 4× MSAA, mipmapped target, with all the scene's lights) so the glass can
      // refract what is behind it. The jars stand on the back-wall shelves and the camera is always in the room in
      // front of them, so objects entirely in front of the jars can never be seen through them: those are skipped in
      // that pass only (their draw range set to nothing around the draw, restored right after). The refraction keeps
      // everything behind the glass (wall, tiles, shelves, frames, closets, plants, cups) exactly as before.
      // Measured: ~10 ms a frame less with the jars in view (41.5 → 31.6 ms); the same frame with and without is
      // pixel-identical up close (0 px) and differs only in ~0.03% of pixels at the edges of far-away jars, where the
      // refraction blur used to pick up foreground objects nearby on screen.
      // ---------------------------------------------------------------------------
      const KITCHEN_TRANSMISSION_SKIP = {
        frontMargin: 1.5, // objects whose bounds start this far in front of the glass's front (+z) are skipped
      };
      const _txSkipped = [];
      /** In three's transmission pass (it renders with tone mapping off into its own 4× MSAA mipmapped target). */
      function inTransmissionPass() {
        const rt = renderer.getRenderTarget();
        return renderer.toneMapping === THREE.NoToneMapping && !!rt && rt.samples === 4 && !!rt.texture && rt.texture.generateMipmaps;
      }
      function skipFrontObjectsInTransmission() {
        if (renderer.toneMapping === THREE.NoToneMapping) return; // the pass can't be told apart then: leave it as is
        restoreFrontObjectsInTransmission();
        const glass = new THREE.Box3();
        const worldBox = (o) => {
          if (o.isInstancedMesh) {
            if (!o.boundingBox) o.computeBoundingBox();
            return o.boundingBox.clone().applyMatrix4(o.matrixWorld);
          }
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          return o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
        };
        scene.updateMatrixWorld(true);
        scene.traverse((o) => {
          if (!o.isMesh || !o.geometry) return;
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          if (ms.some((m) => m && m.transmission > 0)) glass.union(worldBox(o));
        });
        if (glass.isEmpty()) return;
        const cut = glass.max.z + KITCHEN_TRANSMISSION_SKIP.frontMargin;
        scene.traverse((o) => {
          if (!o.isMesh || !o.geometry) return;
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          if (ms.some((m) => !m || m.transparent || m.transmission > 0)) return; // only the opaque pass is affected
          if (worldBox(o).min.z <= cut) return;
          const g = o.geometry;
          const before = o.onBeforeRender, after = o.onAfterRender;
          let saved = null;
          o.onBeforeRender = function (...args) {
            if (inTransmissionPass()) {
              saved = [g.drawRange.start, g.drawRange.count];
              g.setDrawRange(0, 0);
            }
            return before.apply(this, args);
          };
          o.onAfterRender = function (...args) {
            if (saved) {
              g.setDrawRange(saved[0], saved[1]);
              saved = null;
            }
            return after.apply(this, args);
          };
          _txSkipped.push({ o, before, after });
        });
      }
      function restoreFrontObjectsInTransmission() {
        for (const e of _txSkipped) {
          e.o.onBeforeRender = e.before;
          e.o.onAfterRender = e.after;
        }
        _txSkipped.length = 0;
      }

      window.kitchenRace = {
        restart: () => retryKitchenRace(),
        getState: () => ({
          phase: _racePhase,
          winner: _raceWinner ? _raceWinner.name : null,
          cars: _raceCars.map((rc) => ({
            name: rc.name,
            laps: rc.tracker.lapsDone,
            progress: +rc.tracker.progressValue.toFixed(2),
            speed: +rc.state.speed.toFixed(2),
            x: +rc.pos.x.toFixed(2),
            z: +rc.pos.z.toFixed(2),
          })),
        }),
      };

      window.addEventListener("keydown", (e) => {
        if (e.code !== "KeyR" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
        if (!_kitchenSceneRendering || !_raceTrack) return;
        if (_kIntro.state !== "done") return;
        e.preventDefault();
        retryKitchenRace();
      });

      // Car bumper for props: the car's body collider starts above the plates
      // and only the 4 wheel cylinders reach their height, so a plate could
      // slip under / between them. This box covers the car's whole footprint
      // from just above the table to the body, and collides with props only.
      let _carPropBumper = null;
      const _bumperPrev = new CANNON.Vec3();
      let _bumperPrevValid = false;

      function createCarPropBumper() {
        if (_carPropBumper || !canonBodyPhys) return;
        const box = canonBodyPhys.shapes[0];
        if (!box || !box.halfExtents) return;
        const he = box.halfExtents;
        const bp = canonBodyPhys.position;
        const invQ = canonBodyPhys.quaternion.inverse();
        let ex = he.x;
        let ez = he.z;
        let wheelBottom = Infinity;
        const tmp = new CANNON.Vec3();
        for (const wb of [canonFLBody, canonFRBody, canonRLBody, canonRRBody]) {
          if (!wb) continue;
          wb.position.vsub(bp, tmp);
          invQ.vmult(tmp, tmp);
          const r = (wb.shapes[0] && wb.shapes[0].radiusTop) || 0;
          ex = Math.max(ex, Math.abs(tmp.x) + r);
          ez = Math.max(ez, Math.abs(tmp.z) + r);
          wb.updateAABB();
          wheelBottom = Math.min(wheelBottom, wb.aabb.lowerBound.y);
        }
        if (!Number.isFinite(wheelBottom)) return;
        // Body-local vertical range: just above the table up to the body's top
        // (tall / stacked props, e.g. the cup pyramid, are hit by the body too).
        const lowY = wheelBottom + KITCHEN_PROP_BUMPER_CLEARANCE - bp.y;
        const highY = he.y;
        if (!(highY > lowY)) return;
        _carPropBumper = new CANNON.Body({
          type: CANNON.Body.KINEMATIC,
          // No solver contacts: props are pushed by pushKitchenPropsOutOfCar,
          // horizontally only. A solver contact could resolve through the
          // bumper's top / bottom face and bounce props up and down.
          collisionFilterGroup: PHYS_GROUP_PROP_BUMPER,
          collisionFilterMask: 0,
        });
        _carPropBumper.addShape(
          new CANNON.Box(new CANNON.Vec3(ex, (highY - lowY) / 2, ez)),
          new CANNON.Vec3(0, (highY + lowY) / 2, 0),
        );
        _carPropBumper.position.copy(bp);
        _carPropBumper.quaternion.copy(canonBodyPhys.quaternion);
        physicsWorld.addBody(_carPropBumper);
        _bumperPrevValid = false;
        captureCarRailFootprint(bp, ex, ez);
      }

      /** Bumper follows the car body, with a real velocity so it pushes props. */
      function syncCarPropBumper(dt) {
        const b = _carPropBumper;
        if (!b || !canonBodyPhys) return;
        const p = canonBodyPhys.position;
        if (_bumperPrevValid && dt > 0) {
          const inv = 1 / dt;
          b.velocity.set((p.x - _bumperPrev.x) * inv, (p.y - _bumperPrev.y) * inv, (p.z - _bumperPrev.z) * inv);
          const sp = b.velocity.length();
          if (sp > KITCHEN_PROP_BUMPER_MAX_SPEED) b.velocity.scale(KITCHEN_PROP_BUMPER_MAX_SPEED / sp, b.velocity);
        } else {
          b.velocity.set(0, 0, 0);
        }
        _bumperPrev.copy(p);
        _bumperPrevValid = true;
        b.position.copy(p);
        b.quaternion.copy(canonBodyPhys.quaternion);
        b.aabbNeedsUpdate = true;
      }

      // --- car falling off the table: same behaviour as the meeting room -----
      // Past the table edge the car becomes one dynamic box (wheels + body
      // footprint) that keeps its driving velocity, tumbles over the edge,
      // hits the table edge / floor, and respawns 2 s after landing. The
      // meeting room's numbers are scaled by the kitchen's speed ratio so the
      // motion looks the same (time is unchanged, distances scale).
      const PHYS_GROUP_CAR_FALL = 4096;
      const MEETING_ROOM_CAR_MAX_SPEED = 4.2;
      const MEETING_ROOM_GRAVITY = 16;
      const CAR_FALL_TUMBLE = 0.55;
      const CAR_FALL_LANDED_VY = 1.2;
      const CAR_FALL_RESPAWN_SEC = 2;
      const KITCHEN_WORLD_GRAVITY = 480;
      let _carFallBody = null;
      let _carTumbling = false;
      let _carFallLandedAtMs = 0;
      let _carFallScale = 1;
      const _carFallRel = new THREE.Matrix4();
      const _carFallMat4 = new THREE.Matrix4();
      const _carFallParentInv = new THREE.Matrix4();
      const _carFallPos = new THREE.Vector3();
      const _carFallQuat = new THREE.Quaternion();
      const _carFallScaleV = new THREE.Vector3();
      const _carFallOne = new THREE.Vector3(1, 1, 1);

      // The kitchen world runs at -480 for props; the tumbling car gets the
      // meeting room's gravity (scaled) by cancelling the difference.
      // preStep runs after the contact solve and before integration, so this
      // is also where an upward push is cancelled: until the car first hits
      // the floor it only ever goes down (the table edge can slow / tip it,
      // never pop it up into a jump).
      physicsWorld.addEventListener("preStep", () => {
        const b = _carFallBody;
        if (!b || !_carTumbling) return;
        if (!_carFallLandedAtMs && b.velocity.y > 0) b.velocity.y = 0;
      });
      // Gravity difference goes in before the next step's contact solve
      // (added after the solve it would kick a resting car upward).
      function addCarFallGravityForce() {
        const b = _carFallBody;
        if (!b || !_carTumbling) return;
        const g = MEETING_ROOM_GRAVITY * _carFallScale;
        b.force.y += b.mass * (KITCHEN_WORLD_GRAVITY - g);
      }
      physicsWorld.addEventListener("postStep", addCarFallGravityForce);

      function beginKitchenCarTumble() {
        if (_carTumbling || !canonBodyPhys || !physicsWorld) return false;
        const box = canonBodyPhys.shapes[0];
        if (!box || !box.halfExtents) return false;
        const he = box.halfExtents;
        const bp = canonBodyPhys.position;
        const invQ = canonBodyPhys.quaternion.inverse();
        let ex = he.x;
        let ez = he.z;
        let lowY = -he.y;
        const tmp = new CANNON.Vec3();
        for (const wb of [canonFLBody, canonFRBody, canonRLBody, canonRRBody]) {
          if (!wb) continue;
          wb.position.vsub(bp, tmp);
          invQ.vmult(tmp, tmp);
          const r = (wb.shapes[0] && wb.shapes[0].radiusTop) || 0;
          ex = Math.max(ex, Math.abs(tmp.x) + r);
          ez = Math.max(ez, Math.abs(tmp.z) + r);
          lowY = Math.min(lowY, tmp.y - r);
        }
        const highY = he.y;
        // Box bottom exactly on the table top (the wheel colliders sit a bit
        // into it): any start-up overlap would make the solver pop it upward.
        if (tablePlateBody && tablePlateBody.shapes[0]) {
          const tableTop = tablePlateBody.position.y + tablePlateBody.shapes[0].halfExtents.y;
          lowY = Math.max(lowY, tableTop + 0.005 - bp.y);
        }
        if (!(highY - lowY > 0.05)) return false;
        _carFallScale = Math.max(1, carState.maxSpeed / MEETING_ROOM_CAR_MAX_SPEED);
        const body = new CANNON.Body({
          mass: 1.8,
          material: carFallMaterial,
          linearDamping: 0.08,
          angularDamping: 0.28,
          allowSleep: false,
          collisionFilterGroup: PHYS_GROUP_CAR_FALL,
          collisionFilterMask: PHYS_GROUP_DEFAULT,
        });
        body.addShape(
          new CANNON.Box(new CANNON.Vec3(ex, (highY - lowY) / 2, ez)),
          new CANNON.Vec3(0, (highY + lowY) / 2, 0),
        );
        body.position.copy(bp);
        body.quaternion.copy(canonBodyPhys.quaternion);
        // Car root pose relative to the body, kept while it tumbles.
        car.updateMatrixWorld(true);
        _carFallMat4.compose(
          _carFallPos.set(bp.x, bp.y, bp.z),
          _carFallQuat.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w),
          _carFallOne,
        );
        _carFallRel.copy(_carFallMat4).invert().multiply(car.matrixWorld);
        // Driving velocity carries over; tumble spin like the meeting room.
        const vx = Math.sin(carState.angle) * carState.speed;
        const vz = Math.cos(carState.angle) * carState.speed;
        body.velocity.set(vx, Math.min(0, carState.velY), vz);
        const k = CAR_FALL_TUMBLE / _carFallScale;
        body.angularVelocity.set(vz * k, 0, -vx * k);
        physicsWorld.addBody(body);
        _carFallBody = body;
        _carTumbling = true;
        _carFallLandedAtMs = 0;
        addCarFallGravityForce();
        return true;
      }

      /** Car mesh follows the tumbling body (after the frame's orientation code). */
      function syncCarFromFallBody() {
        const b = _carFallBody;
        if (!b || !_carTumbling) return;
        _carFallMat4.compose(
          _carFallPos.set(b.position.x, b.position.y, b.position.z),
          _carFallQuat.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w),
          _carFallOne,
        );
        _carFallMat4.multiply(_carFallRel);
        if (car.parent) {
          car.parent.updateMatrixWorld();
          _carFallParentInv.copy(car.parent.matrixWorld).invert();
          _carFallMat4.premultiply(_carFallParentInv);
        }
        _carFallMat4.decompose(car.position, car.quaternion, _carFallScaleV);
      }

      function stopKitchenCarTumble() {
        if (_carFallBody) {
          try { physicsWorld.removeBody(_carFallBody); } catch (e) {}
        }
        _carFallBody = null;
        _carTumbling = false;
        _carFallLandedAtMs = 0;
      }

      /** Respawn on the table after a fall (as the meeting room does). */
      function respawnKitchenCarAfterFall() {
        stopKitchenCarTumble();
        car.position.copy(tableSpawn);
        car.quaternion.identity();
        carState.angle = 0;
        carState.bumpVX = 0;
        carState.bumpVZ = 0;
        carState.bumpYaw = 0;
        // During the race: back on the track where the car left it.
        const racePt = kitchenRaceRespawnPoint();
        if (racePt) {
          car.position.x = racePt.x;
          car.position.z = racePt.z;
          carState.angle = racePt.heading;
        }
        carState.speed = 0;
        carState.steerAngle = 0;
        carState.velY = 0;
        carUpLerp.set(0, 1, 0);
        carFalling = false;
        carFloorTimer = 0;
        _bumperPrevValid = false;
        beginCarCam1ReturnToRest();
      }

      /** Per car step while tumbling: coast down, detect landing, respawn. */
      function updateKitchenCarTumble(dt) {
        const b = _carFallBody;
        if (!b) return;
        // Keep the car "airborne" for the rest of the car logic.
        carState.velY = Math.abs(b.velocity.y) > 1e-4 ? b.velocity.y : -1e-4;
        carState.speed *= Math.exp(-dt * 1.6);
        if (Math.abs(carState.speed) < 0.04) carState.speed = 0;
        carState.steerAngle *= Math.exp(-dt * 4);
        let floorTopY = null;
        if (floorPhysBody && floorPhysBody.shapes[0]) {
          floorTopY = floorPhysBody.position.y + floorPhysBody.shapes[0].halfExtents.y;
        }
        let onFloor = false;
        const cs = physicsWorld.contacts;
        for (let i = 0; i < cs.length; i++) {
          const c = cs[i];
          if ((c.bi === b && c.bj === floorPhysBody) || (c.bj === b && c.bi === floorPhysBody)) {
            onFloor = true;
            break;
          }
        }
        if (!_carFallLandedAtMs && onFloor && b.velocity.y <= CAR_FALL_LANDED_VY * _carFallScale) {
          _carFallLandedAtMs = performance.now();
        }
        if (_carFallLandedAtMs) {
          carFloorTimer = (performance.now() - _carFallLandedAtMs) / 1000;
          if (carFloorTimer >= CAR_FALL_RESPAWN_SEC) respawnKitchenCarAfterFall();
        }
        if (
          (floorTopY != null && b.position.y < floorTopY - 4 * _carFallScale) ||
          b.position.y < tableSurfaceY - 120
        ) {
          respawnKitchenCarAfterFall();
        }
      }

      /**
       * Hard guarantee that a prop never sits inside the car: after each step,
       * any prop overlapping the bumper box (in the car's horizontal plane) is
       * moved straight out to its surface and given at least the car's speed
       * along that direction. The solver alone lets a fast car overrun a plate
       * for a frame or two.
       */
      const _pushLocal = new CANNON.Vec3();
      const _pushN = new CANNON.Vec3();
      const _pushAx = new CANNON.Vec3();
      const _pushImpulse = new CANNON.Vec3();
      const _pushPoint = new CANNON.Vec3();
      /** Bounciness of prop-to-prop shoves (0 = they move off together). */
      const KITCHEN_PROP_PROP_RESTITUTION = 0.2;
      const _pushAz = new CANNON.Vec3();
      const _pushAxes = new Float64Array(8);
      /** Props are pushed by the player's bumper and by every race car's bumper. */
      function pushKitchenPropsOutOfCar() {
        _kitchenPropFrame++;
        pushKitchenPropsOutOfBumper(_carPropBumper, carFalling ? null : carState);
        if (_kitchenFood) _kitchenFood.pushOutOfBumper(_carPropBumper, carFalling ? null : carState, _kitchenPropDt);
        for (let i = 0; i < _raceCars.length; i++) {
          const rc = _raceCars[i];
          if (!rc.isPlayer && rc.bumper) {
            pushKitchenPropsOutOfBumper(rc.bumper, rc.state);
            if (_kitchenFood) _kitchenFood.pushOutOfBumper(rc.bumper, rc.state, _kitchenPropDt);
          }
        }
      }
      let _kitchenPropFrame = 0;
      let _kitchenPropDt = 1 / 60;

      /**
       * Momentum-based slow-down of the pushing car (its drive state `st`):
       * the first touch is a hit (car and prop share momentum by mass, a little
       * bounce, the car keeps at least KITCHEN_PROP_CAR_MIN_KEEP of its speed);
       * staying in contact is a steady drag ∝ prop mass / car mass, so heavy
       * props are pushed slower but the throttle always wins (never stuck).
       * Scaled by how head-on the contact is. Returns the prop's new normal speed.
       */
      function kitchenPropCarResponse(st, b, bbId, carVn, vn, nx, nz) {
        // Pyramid cups: original response (shoved ahead, the car is not slowed).
        if (b._propCup) return Math.max(0, carVn) * KITCHEN_CUP_PUSH_RESTITUTION;
        const touchedBefore = b._touchFrame && b._touchFrame[bbId] === _kitchenPropFrame - 1;
        (b._touchFrame || (b._touchFrame = {}))[bbId] = _kitchenPropFrame;
        if (!(carVn > 0)) return 0;
        const mC = CAR_MASS;
        const mP = b.mass;
        const fn = Math.abs(Math.sin(st ? st.angle : 0) * nx + Math.cos(st ? st.angle : 0) * nz);
        if (!touchedBefore && carVn - vn > KITCHEN_PROP_IMPACT_MIN_SPEED) {
          const e = KITCHEN_PROP_CAR_RESTITUTION;
          const v0 = Math.max(0, vn);
          const vStar = (mC * carVn + mP * v0) / (mC + mP);
          const carAfter = vStar + e * (vStar - carVn);
          if (st) {
            const keep = Math.max(KITCHEN_PROP_CAR_MIN_KEEP, Math.min(1, carAfter / carVn));
            st.speed *= 1 - (1 - keep) * fn;
          }
          return vStar + e * (vStar - v0);
        }
        if (st) {
          const drag = KITCHEN_PROP_PUSH_DRAG * (mP / mC) * _kitchenPropDt * fn;
          const sp = Math.abs(st.speed);
          st.speed = Math.sign(st.speed) * Math.max(0, sp - drag);
        }
        // Pushed along: just ahead of the car, so it stays in front of it.
        return carVn * 1.05;
      }

      function pushKitchenPropsOutOfBumper(bb, st) {
        if (!bb) return;
        const shape = bb.shapes[0];
        const he = shape.halfExtents;
        const off = bb.shapeOffsets[0];
        const invQ = bb.quaternion.inverse();
        for (let i = 0; i < _kitchenProps.length; i++) {
          const b = _kitchenProps[i].body;
          const r = b._propRadius;
          b.position.vsub(bb.position, _pushLocal);
          invQ.vmult(_pushLocal, _pushLocal);
          _pushLocal.vsub(off, _pushLocal);
          // Vertical overlap with the bumper slab?
          if (Math.abs(_pushLocal.y) > he.y + b._propHalfHeight) continue;
          const lx = _pushLocal.x;
          const lz = _pushLocal.z;
          let nx;
          let nz;
          let depth;
          if (b._propBox) {
            // Box prop: 2D separating-axis test of the two footprints.
            const pb = b._propBox;
            _pushAx.set(1, 0, 0);
            b.quaternion.vmult(_pushAx, _pushAx);
            invQ.vmult(_pushAx, _pushAx);
            _pushAz.set(0, 0, 1);
            b.quaternion.vmult(_pushAz, _pushAz);
            invQ.vmult(_pushAz, _pushAz);
            const axes = _pushAxes;
            axes[0] = 1; axes[1] = 0;
            axes[2] = 0; axes[3] = 1;
            const la = Math.hypot(_pushAx.x, _pushAx.z) || 1;
            axes[4] = _pushAx.x / la; axes[5] = _pushAx.z / la;
            const lb = Math.hypot(_pushAz.x, _pushAz.z) || 1;
            axes[6] = _pushAz.x / lb; axes[7] = _pushAz.z / lb;
            depth = Infinity;
            for (let k = 0; k < 8; k += 2) {
              const ux = axes[k];
              const uz = axes[k + 1];
              const rCar = he.x * Math.abs(ux) + he.z * Math.abs(uz);
              const rProp =
                pb.x * Math.abs(ux * _pushAx.x + uz * _pushAx.z) +
                pb.z * Math.abs(ux * _pushAz.x + uz * _pushAz.z);
              const dist = lx * ux + lz * uz;
              const ov = rCar + rProp - Math.abs(dist);
              if (ov <= 0) {
                depth = 0;
                break;
              }
              if (ov < depth) {
                depth = ov;
                const sgn = dist < 0 ? -1 : 1;
                nx = ux * sgn;
                nz = uz * sgn;
              }
            }
            if (!(depth > 0)) continue;
          } else {
          // Closest point of the rectangle to the plate centre.
          const cx = Math.max(-he.x, Math.min(he.x, lx));
          const cz = Math.max(-he.z, Math.min(he.z, lz));
          const dx = lx - cx;
          const dz = lz - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 > 1e-10) {
            if (d2 >= r * r) continue;
            const d = Math.sqrt(d2);
            nx = dx / d;
            nz = dz / d;
            depth = r - d;
          } else {
            // Centre is inside the rectangle: leave through the nearest side.
            const px = he.x - Math.abs(lx);
            const pz = he.z - Math.abs(lz);
            if (px < pz) {
              nx = lx < 0 ? -1 : 1;
              nz = 0;
              depth = px + r;
            } else {
              nx = 0;
              nz = lz < 0 ? -1 : 1;
              depth = pz + r;
            }
          }
          }
          _pushN.set(nx, 0, nz);
          bb.quaternion.vmult(_pushN, _pushN);
          _pushN.y = 0;
          const nl = Math.hypot(_pushN.x, _pushN.z) || 1;
          _pushN.x /= nl;
          _pushN.z /= nl;
          // A fruit plate rests static (kitchenFood.js holdPlate): dynamic again before the push.
          if (b._foodPlate && _kitchenFood) _kitchenFood.releasePlate(b);
          b.position.x += _pushN.x * depth;
          b.position.z += _pushN.z * depth;
          // Horizontal shove at the contact side, at the prop's centre height:
          // it slides / spins with the car's speed but is never tipped or lifted.
          const carVn = bb.velocity.x * _pushN.x + bb.velocity.z * _pushN.z;
          const vn = b.velocity.x * _pushN.x + b.velocity.z * _pushN.z;
          const want = kitchenPropCarResponse(st, b, bb.id, carVn, vn, _pushN.x, _pushN.z);
          if (vn < want) {
            const j = (want - vn) * b.mass;
            _pushImpulse.set(_pushN.x * j, 0, _pushN.z * j);
            const reach = b._propBox
              ? Math.abs(_pushN.x) * b._propBox.x + Math.abs(_pushN.z) * b._propBox.z
              : b._propRadius;
            // Contact point on the car-facing side, slid toward the car's centre
            // line so off-centre hits add a little yaw spin.
            if (b._propCup) {
              _cupHitByCar = true;
              // Cups are hit at the car's height, so they tip over and fly.
              const by = bb.position.y + bb.shapeOffsets[0].y;
              const hy = Math.max(-b._propHalfHeight, Math.min(b._propHalfHeight, by - b.position.y));
              _pushPoint.set(-_pushN.x * reach, hy, -_pushN.z * reach);
              b.applyImpulse(_pushImpulse, _pushPoint);
            } else {
              _pushPoint.set(-_pushN.x * reach, 0, -_pushN.z * reach);
              b.applyImpulse(_pushImpulse, _pushPoint);
              b.angularVelocity.x = 0;
              b.angularVelocity.z = 0;
            }
          }
          b.aabbNeedsUpdate = true;
          if (b.sleepState !== CANNON.Body.AWAKE) b.wakeUp();
          // A fruit plate hit by a car: its food wakes (as the cup pyramid on a hit).
          if (b._foodPlate && _kitchenFood) _kitchenFood.onPlateTouched(b);
        }
      }

      /** Prop footprint radius along a horizontal unit axis (ux, uz). */
      function propFootprintReach(b, ux, uz) {
        if (!b._propBox) return b._propRadius;
        const q = b.quaternion;
        // Body x / z axes (first / third rotation-matrix columns), horizontal part.
        const axX = 1 - 2 * (q.y * q.y + q.z * q.z);
        const axZ = 2 * (q.x * q.z - q.w * q.y);
        const azX = 2 * (q.x * q.z + q.w * q.y);
        const azZ = 1 - 2 * (q.x * q.x + q.y * q.y);
        return (
          b._propBox.x * Math.abs(ux * axX + uz * axZ) + b._propBox.z * Math.abs(ux * azX + uz * azZ)
        );
      }

      const _sepAxes = new Float64Array(10);
      /**
       * Props never stack: overlapping footprints are pushed apart sideways
       * (equal masses, slightly inelastic), like the car pushes them.
       */
      function separateKitchenProps() {
        const n = _kitchenProps.length;
        for (let i = 0; i < n; i++) {
          const a = _kitchenProps[i].body;
          for (let j = i + 1; j < n; j++) {
            const b = _kitchenProps[j].body;
            if (a.sleepState === CANNON.Body.SLEEPING && b.sleepState === CANNON.Body.SLEEPING) continue;
            if (a._propCup && b._propCup) continue;
            if (Math.abs(a.position.y - b.position.y) > a._propHalfHeight + b._propHalfHeight) continue;
            const dx = b.position.x - a.position.x;
            const dz = b.position.z - a.position.z;
            const dist = Math.hypot(dx, dz);
            if (dist > a._propRadius + b._propRadius) continue;
            // Candidate separating axes: centre line + each box's horizontal axes.
            let k = 0;
            if (dist > 1e-6) {
              _sepAxes[k++] = dx / dist;
              _sepAxes[k++] = dz / dist;
            }
            for (const body of [a, b]) {
              if (!body._propBox) continue;
              const q = body.quaternion;
              const axX = 1 - 2 * (q.y * q.y + q.z * q.z);
              const axZ = 2 * (q.x * q.z - q.w * q.y);
              const l = Math.hypot(axX, axZ) || 1;
              _sepAxes[k++] = axX / l;
              _sepAxes[k++] = axZ / l;
              _sepAxes[k++] = -axZ / l;
              _sepAxes[k++] = axX / l;
            }
            let depth = Infinity;
            let nx = 0;
            let nz = 0;
            for (let m = 0; m < k; m += 2) {
              const ux = _sepAxes[m];
              const uz = _sepAxes[m + 1];
              const d = dx * ux + dz * uz;
              const ov = propFootprintReach(a, ux, uz) + propFootprintReach(b, ux, uz) - Math.abs(d);
              if (ov <= 0) {
                depth = 0;
                break;
              }
              if (ov < depth) {
                depth = ov;
                const sgn = d < 0 ? -1 : 1;
                nx = ux * sgn;
                nz = uz * sgn;
              }
            }
            if (!(depth > 0) || depth === Infinity) continue;
            const h = depth / 2;
            if (_kitchenFood) {
              if (a._foodPlate) _kitchenFood.releasePlate(a);
              if (b._foodPlate) _kitchenFood.releasePlate(b);
            }
            a.position.x -= nx * h;
            a.position.z -= nz * h;
            b.position.x += nx * h;
            b.position.z += nz * h;
            const vRel = (b.velocity.x - a.velocity.x) * nx + (b.velocity.z - a.velocity.z) * nz;
            if (vRel < 0) {
              // Split by mass: a light prop gives way to a heavy one (cups keep
              // their original equal split).
              const dv = -vRel * (1 + KITCHEN_PROP_PROP_RESTITUTION);
              const wa = a._propCup || b._propCup ? 0.5 : b.mass / (a.mass + b.mass);
              const wb = 1 - wa;
              a.velocity.x -= nx * dv * wa;
              a.velocity.z -= nz * dv * wa;
              b.velocity.x += nx * dv * wb;
              b.velocity.z += nz * dv * wb;
            }
            a.aabbNeedsUpdate = true;
            b.aabbNeedsUpdate = true;
            if (a.sleepState !== CANNON.Body.AWAKE) a.wakeUp();
            if (b.sleepState !== CANNON.Body.AWAKE) b.wakeUp();
          }
        }
      }

      /** Visuals follow their bodies (called after each physics step). */
      function syncKitchenProps() {
        pushKitchenPropsOutOfCar();
        wakeCupPyramidIfHit();
        separateKitchenProps();
        keepKitchenPropsAboveTable();
        if (_kitchenFood) _kitchenFood.update();
        for (let i = 0; i < _kitchenProps.length; i++) {
          const p = _kitchenProps[i];
          const b = p.body;
          if (b.sleepState === CANNON.Body.SLEEPING && p.synced) continue;
          _propPos.set(b.position.x, b.position.y, b.position.z);
          _propQuat.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
          _propBodyMat.compose(_propPos, _propQuat, _propScale);
          for (let j = 0; j < p.parts.length; j++) {
            const part = p.parts[j];
            _propWorldMat.multiplyMatrices(_propBodyMat, part.offset);
            const parent = part.vis.parent;
            if (parent) {
              parent.updateMatrixWorld();
              _propParentInv.copy(parent.matrixWorld).invert();
              _propWorldMat.premultiply(_propParentInv);
            }
            _propWorldMat.decompose(part.vis.position, part.vis.quaternion, part.vis.scale);
          }
          p.synced = true;
        }
      }

      /**
       * The car's kinematic bodies are positioned by code and stay "asleep" in
       * cannon, and cannon skips collision checks between two sleeping bodies.
       * So wake a resting prop whenever the car comes near it; it is then
       * checked against the car, gets pushed, and goes back to sleep at rest.
       */
      const KITCHEN_PROP_WAKE_MARGIN = 6;
      function wakeKitchenPropsNearCar() {
        if (!car) return;
        for (let i = 0; i < _kitchenProps.length; i++) {
          const b = _kitchenProps[i].body;
          if (b.sleepState !== CANNON.Body.SLEEPING) continue;
          // Pyramid cups, and the fruit plates with their food, stay asleep
          // (perfectly still) until actually hit.
          if (b._propCup || b._foodPlate) continue;
          const r = b.boundingRadius + KITCHEN_PROP_WAKE_MARGIN;
          const dx = car.position.x - b.position.x;
          const dz = car.position.z - b.position.z;
          if (dx * dx + dz * dz < r * r) {
            b.wakeUp();
            continue;
          }
          for (let k = 0; k < _raceCars.length; k++) {
            const rc = _raceCars[k];
            if (rc.isPlayer) continue;
            const ex = rc.pos.x - b.position.x;
            const ez = rc.pos.z - b.position.z;
            if (ex * ex + ez * ez < r * r) {
              b.wakeUp();
              break;
            }
          }
        }
      }

      /** True while any prop is still moving (physics then runs in real time). */
      function kitchenPropsMoving() {
        for (let i = 0; i < _kitchenProps.length; i++) {
          const b = _kitchenProps[i].body;
          if (b.sleepState === CANNON.Body.SLEEPING) continue;
          if (b.velocity.lengthSquared() > 0.01 || b.angularVelocity.lengthSquared() > 0.01) {
            return true;
          }
        }
        return false;
      }

      const _reflectionBox = new THREE.Box3();
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

      function updateCarLightAxes() {
        const yaw = carState.angle + (carState.driftAngle || 0);
        _carLightFwd.set(Math.sin(yaw), 0, Math.cos(yaw));
        _carLightRight.set(_carLightFwd.z, 0, -_carLightFwd.x);
      }

      // ── Fire in the three trash holes (trashPlane1/2/3, the holes' dark floors):
      // flame particles rising from each floor, a glow on it and a light that
      // lights the hole's surroundings and the cars. One effect (createTrashFx),
      // three colours (TRASH_FX_COLORS). Idle (no car over the hole): a weaker
      // fire (fewer particles, lower, softer glow, dimmer light). A race car over
      // the hole: it ramps up to full strength and fades back once it's gone.
      // The particles are simulated on the CPU with a velocity each: they rise,
      // and steer after the nearest car (any race car), trailing behind it.
      // Visual only (no physics).
      const TRASH_FX_ENABLED = true;
      /** The planes that get the fire (model names). */
      const TRASH_FX_PLANE_NAMES = ["trashPlane1", "trashPlane2", "trashPlane3"];
      /** Each hole's fire colours (hot base → body → cooling tip; the glow and the light use `mid`). */
      const TRASH_FX_COLORS = {
        trashPlane1: { core: 0xfff0b8, mid: 0xff8a1e, tip: 0xd8300c }, // orange fire
        trashPlane2: { core: 0xe6fbff, mid: 0x2fc4ff, tip: 0x1546e0 }, // blue fire
        trashPlane3: { core: 0xffe6fb, mid: 0xe040ff, tip: 0x7a18d8 }, // violet fire
      };
      /** Padding around the plane's footprint that still counts as "over it" (world units). */
      const TRASH_FX_EDGE_PAD = 0.6;
      // Extra drop of the black hole floor (the plane itself) below where the model puts it. It's the fire's base too:
      // particles under the floor are hidden, so a lower fire needs a deeper floor. 0 since ul-kitchen27, whose
      // floors are already 1.1 lower; everything else (flames, floor glow, light) is placed from the plane's own bounds.
      const TRASH_FX_Y_OFFSET = 0;
      /** The glow sits this far above the plane's top surface (+ polygonOffset), so it never z-fights. */
      const TRASH_FX_SURFACE_LIFT = 0.004;
      /** Draw order for the fire parts that sit behind the bin signs (translucent, renderOrder 2, no depth writes):
       *  drawn before a sign, the sign tints them. The rest of the fire draws after the signs (TRASH_FX_FRONT_ORDER). */
      const TRASH_FX_BEHIND_ORDER = 1.5;
      const TRASH_FX_FRONT_ORDER = 6;
      const TRASH_FX = {
        /** Particles per hole (at full strength): flames + embers (a share of them), spawned over this part of the floor (× the smaller half size). */
        count: 520,
        emberShare: 0.18,
        spread: 0.92,
        /** Base offset: where the flames start, relative to the floor's surface (world units; negative = lower).
         *  To move the whole fire lower, deepen the floor (TRASH_FX_Y_OFFSET): flames under the floor are hidden. */
        originOffset: -0.1,
        /** Flame size (px at 1 unit away) and how long a flame lives (s). */
        flameSize: 1500,
        flameLife: 0.9,
        emberLife: 1.6,
        /** Random size per particle (× flameSize): flames and embers. Skewed so big ones are rarer. */
        flameSizeRange: [0.4, 1.5],
        emberSizeRange: [0.1, 0.34],
        /** Peak height above the base (world units): idle, and at full strength. Embers rise × emberRise of that.
         *  (The floor is ~1.7 below the table top: idle flames stay in the hole, full ones tower over it.) */
        idleHeight: 1.5,
        flareHeight: 7.5,
        emberRise: 1.5,
        /** Idle intensity level (0 → 1): with no car over the hole, the share of particles alive and the chase run at this level,
         *  and the particles' glow at halfway between it and full (so the idle fire stays visible, just softer). */
        idleLevel: 0.32,
        /** Transition speed: time (s) to ramp up to full strength once a car is over the hole, and to fade back to idle once it's gone. */
        rampUp: 0.25,
        rampDown: 0.9,
        /** How lively each particle looks (size, opacity): idle (full strength = 1). */
        idleHeat: 0.32,
        /** The floor glow's flare around each car: radius (world units, grows with speed) and its fade in / out (s). */
        flareRadius: 1.1,
        flareRadiusAtSpeed: 1.7,
        fadeIn: 0.1,
        fadeOut: 0.7,
        /** Particle glow: colour × this (over 1 = blooms), plus a white-hot centre of this strength (× idleLevel when idle). */
        glowStrength: 1.7,
        hotCore: 0.6,
        /** Chase: each particle steers its sideways velocity toward the nearest race car within chaseRange (world units),
         *  aiming for chaseSpeed (units/s) at chaseStrength (steering rate, 1/s: higher = snappier). It keeps rising meanwhile. */
        chaseStrength: 7,
        chaseSpeed: 11,
        chaseRange: 7,
        /** Sideways flicker of each particle (units/s): flames, embers. */
        swayFlame: 0.35,
        swayEmber: 1.1,
        /** The floor glow: idle strength, and under a car. */
        glowIdle: 0.12,
        glowCar: 0.35,
        /** The fire's light: idle and at full strength (flickers more as the fire flares), its range (world units) and height above the
         *  hole's floor (above the table top, ~1.7 up, so it lights the track and the cars from above). */
        lightIdle: 28,
        lightFlare: 220,
        lightRange: 11,
        lightDecay: 1.5,
        lightHeight: 3.4,
        /** The light follows the particles' centre by this share (at most lightChaseMax units sideways). */
        lightChase: 0.5,
        lightChaseMax: 2.5,
        /** Bright mode: the whole effect × this (dark mode: 1). */
        brightModeScale: 0.8,
      };
      const TRASH_FX_MAX_CARS = 6;
      const _trashFxBox = new THREE.Box3();
      let _trashFxTime = 0;
      /** One entry per hole (createTrashFx). */
      const _trashFxList = [];
      // Shared by every hole: the clock and the bright-mode scale.
      const _trashFxShared = {
        uTime: { value: 0 },
        uScale: { value: 1 },
        uIdleHeat: { value: TRASH_FX.idleHeat },
      };
      const _trashFxGlowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const _trashFxCarsGlsl = `
        #define MAX_CARS ${TRASH_FX_MAX_CARS}
        uniform vec4 uCars[MAX_CARS];
        uniform float uIdleHeat;
        float carHeat(vec2 p) {
          float h = 0.0;
          for (int i = 0; i < MAX_CARS; i++) {
            vec4 c = uCars[i];
            if (c.z <= 0.001) continue;
            vec2 d = p - c.xy;
            h += c.z * exp(-dot(d, d) / (c.w * c.w));
          }
          return h;
        }
      `;
      // The particles arrive placed (CPU simulation): the shader sizes and colours them.
      const _trashFxVertex = `
        attribute vec4 aInfo; // life (0 → 1, < 0 = not alive), ember, size, seed
        attribute float aBehind; // 1 = behind a bin sign from the camera
        uniform float uPass; // which particles this copy draws: 1 = behind a sign, 0 = the rest
        uniform float uSize;
        uniform float uHeat;
        varying float vLife;
        varying float vHeat;
        varying float vEmber;
        void main() {
          float life = abs(aBehind - uPass) < 0.5 ? aInfo.x : -1.0; // the other copy draws it
          float ember = aInfo.y;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float shrink = ember > 0.5 ? 1.0 : (1.0 - max(life, 0.0) * 0.75); // flames narrow to a tip as they rise
          gl_PointSize = life < 0.0 ? 0.0 : min(uSize * aInfo.z * shrink * (0.6 + 0.6 * uHeat) / max(0.1, -mv.z), 160.0);
          vLife = life;
          vHeat = uHeat;
          vEmber = ember;
        }
      `;
      const _trashFxFragment = `
        uniform float uScale;
        uniform vec3 uCore;
        uniform vec3 uMid;
        uniform vec3 uTip;
        uniform vec2 uGlowFx; // colour gain, white-hot centre
        varying float vLife;
        varying float vHeat;
        varying float vEmber;
        void main() {
          if (vLife < 0.0) discard;
          vec2 c = gl_PointCoord - 0.5;
          // A soft teardrop for flames (wider at the base), a round spark for embers.
          c.x *= mix(1.0 + (0.5 - gl_PointCoord.y) * 0.8, 1.0, vEmber);
          float d = length(c) * 2.0;
          float a = exp(-d * d * mix(2.2, 6.0, vEmber));
          // Hot base → body colour → tip colour, fading out.
          vec3 col = mix(uCore, uMid, smoothstep(0.0, 0.45, vLife));
          col = mix(col, uTip, smoothstep(0.45, 0.9, vLife));
          col = mix(col, uMid * 1.2, vEmber * 0.6);
          // Glow: brighter than 1 (it blooms) with a white-hot centre.
          float core = exp(-d * d * 14.0) * uGlowFx.y * (1.0 - vLife);
          col = col * uGlowFx.x + vec3(core);
          float fade = smoothstep(0.0, 0.08, vLife) * (1.0 - smoothstep(0.55, 1.0, vLife));
          a *= fade * (0.3 + 0.7 * vHeat) * mix(0.32, 1.0, vEmber);
          gl_FragColor = vec4(col * a * uScale, a);
        }
      `;
      const _trashFxGlowVertex = `
        varying vec2 vXZ;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vXZ = w.xz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `;
      const _trashFxGlowFragment = `
        uniform float uTime;
        uniform float uScale;
        uniform vec2 uCenter;
        uniform float uRadius;
        uniform vec2 uGlow;
        uniform vec3 uColor;
        ${_trashFxCarsGlsl}
        varying vec2 vXZ;
        void main() {
          float rn = length(vXZ - uCenter) / uRadius;
          float mask = 1.0 - smoothstep(0.55, 1.0, rn);
          float flicker = 0.85 + 0.15 * sin(uTime * 13.0) * sin(uTime * 7.3 + 1.0);
          float g = (uGlow.x * flicker + uGlow.y * carHeat(vXZ)) * mask;
          gl_FragColor = vec4(uColor * g * uScale, 1.0);
        }
      `;

      /** One hole's fire (particles, floor glow, light) in the given colours ({ core, mid, tip }). Hidden until placed. */
      function createTrashFx(colors) {
        const n = TRASH_FX.count;
        // Simulation state (per particle).
        const sim = {
          pos: new Float32Array(n * 3),
          vel: new Float32Array(n * 3),
          age: new Float32Array(n),
          life: new Float32Array(n),
          wait: new Float32Array(n), // time left before it (re)spawns
          alive: new Uint8Array(n),
          rank: new Float32Array(n), // alive only while rank < the current share (idle: idleLevel)
          ember: new Uint8Array(n),
          seed: new Float32Array(n),
        };
        const info = new Float32Array(n * 4); // life, ember, size, seed
        const behind = new Float32Array(n); // 1 = behind a bin sign from the camera
        for (let i = 0; i < n; i++) {
          const ember = Math.random() < TRASH_FX.emberShare;
          const [sMin, sMax] = ember ? TRASH_FX.emberSizeRange : TRASH_FX.flameSizeRange;
          sim.ember[i] = ember ? 1 : 0;
          sim.rank[i] = Math.random();
          sim.seed[i] = Math.random() * 6.2831853;
          info[i * 4] = -1;
          info[i * 4 + 1] = ember ? 1 : 0;
          info[i * 4 + 2] = sMin + (sMax - sMin) * Math.pow(Math.random(), 1.6);
          info[i * 4 + 3] = sim.seed[i];
        }
        const geo = new THREE.BufferGeometry();
        const posAttr = new THREE.BufferAttribute(sim.pos, 3).setUsage(THREE.DynamicDrawUsage);
        const infoAttr = new THREE.BufferAttribute(info, 4).setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute("position", posAttr);
        geo.setAttribute("aInfo", infoAttr);
        const behindAttr = new THREE.BufferAttribute(behind, 1).setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute("aBehind", behindAttr);
        const cars = Array.from({ length: TRASH_FX_MAX_CARS }, () => new THREE.Vector4()); // x, z, strength, radius (floor glow)
        const uCars = { value: cars };
        const uniforms = {
          uScale: _trashFxShared.uScale,
          uSize: { value: TRASH_FX.flameSize },
          uHeat: { value: TRASH_FX.idleHeat },
          uCore: { value: new THREE.Color(colors.core) },
          uMid: { value: new THREE.Color(colors.mid) },
          uTip: { value: new THREE.Color(colors.tip) },
          uGlowFx: { value: new THREE.Vector2(TRASH_FX.glowStrength, TRASH_FX.hotCore) },
        };
        // Two copies of the particles (one geometry, shared uniforms): the ones behind a bin sign draw before it, the rest after.
        const makePoints = (pass, order, name) => {
          const m = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
            uniforms: { ...uniforms, uPass: { value: pass } },
            vertexShader: _trashFxVertex,
            fragmentShader: _trashFxFragment,
          });
          const pts = new THREE.Points(geo, m);
          pts.name = name;
          pts.visible = false;
          pts.frustumCulled = false; // particles fly after the cars: no fixed bounds
          pts.renderOrder = order;
          pts.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
          scene.add(pts);
          return pts;
        };
        const points = makePoints(0, TRASH_FX_FRONT_ORDER, "trashFxFire");
        const pointsBehind = makePoints(1, TRASH_FX_BEHIND_ORDER, "trashFxFireBehind");
        const mat = points.material; // (uniforms shared with pointsBehind)

        // The glow on the floor (under the flames, soft edges).
        const glowMat = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          depthTest: true,
          blending: THREE.AdditiveBlending,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -4,
          toneMapped: false,
          uniforms: {
            uTime: _trashFxShared.uTime,
            uScale: _trashFxShared.uScale,
            uIdleHeat: _trashFxShared.uIdleHeat,
            uCars,
            uCenter: { value: new THREE.Vector2() },
            uRadius: { value: 1 },
            uGlow: { value: new THREE.Vector2(TRASH_FX.glowIdle, TRASH_FX.glowCar) },
            uColor: { value: new THREE.Color(colors.mid) },
          },
          vertexShader: _trashFxGlowVertex,
          fragmentShader: _trashFxGlowFragment,
        });
        const glow = new THREE.Mesh(_trashFxGlowGeo, glowMat);
        glow.name = "trashFxGlow";
        glow.visible = false;
        glow.renderOrder = TRASH_FX_BEHIND_ORDER; // in the hole, under the table top: always behind a sign, so before it
        glow.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
        scene.add(glow);
        // Always in the scene (intensity 0 when off), so the light count never changes (no shader recompiles).
        const light = new THREE.PointLight(colors.mid, 0, TRASH_FX.lightRange, TRASH_FX.lightDecay);
        scene.add(light);
        const fx = {
          points, pointsBehind, glow, light, mat, glowMat, cars, sim, info, posAttr, infoAttr, behind, behindAttr,
          carState: new Map(),
          plane: null,
          radius: 1,
          activity: 0, // 0 idle → 1 full strength
          lightBase: new THREE.Vector3(),
        };
        _trashFxList.push(fx);
        return fx;
      }
      for (const name of TRASH_FX_PLANE_NAMES) createTrashFx(TRASH_FX_COLORS[name]);

      /** Every particle back to "not alive", with a staggered first spawn. */
      function resetTrashFxParticles(fx) {
        const s = fx.sim;
        for (let i = 0; i < TRASH_FX.count; i++) {
          s.alive[i] = 0;
          s.wait[i] = Math.random() * (s.ember[i] ? TRASH_FX.emberLife : TRASH_FX.flameLife);
          fx.info[i * 4] = -1;
        }
        fx.activity = 0;
        fx.infoAttr.needsUpdate = true;
      }

      function registerTrashPlane(mesh) {
        const fx = _trashFxList[TRASH_FX_PLANE_NAMES.indexOf(mesh.name)];
        if (!fx) return;
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
        // The black hole floor sits below the opening's lip.
        mesh.position.y += TRASH_FX_Y_OFFSET;
        mesh.updateMatrixWorld(true);
        _trashFxBox.setFromObject(mesh); // its actual top surface (after the drop)
        if (_trashFxBox.isEmpty()) return;
        const halfX = (_trashFxBox.max.x - _trashFxBox.min.x) * 0.5;
        const halfZ = (_trashFxBox.max.z - _trashFxBox.min.z) * 0.5;
        const plane = {
          minX: _trashFxBox.min.x - TRASH_FX_EDGE_PAD,
          maxX: _trashFxBox.max.x + TRASH_FX_EDGE_PAD,
          minZ: _trashFxBox.min.z - TRASH_FX_EDGE_PAD,
          maxZ: _trashFxBox.max.z + TRASH_FX_EDGE_PAD,
          centerX: (_trashFxBox.min.x + _trashFxBox.max.x) * 0.5,
          centerZ: (_trashFxBox.min.z + _trashFxBox.max.z) * 0.5,
          topY: _trashFxBox.max.y,
        };
        fx.plane = plane;
        fx.carState.clear();
        const radius = Math.min(halfX, halfZ);
        fx.radius = radius * TRASH_FX.spread;
        resetTrashFxParticles(fx);
        fx.glow.position.set(plane.centerX, plane.topY + TRASH_FX_SURFACE_LIFT, plane.centerZ);
        fx.glow.scale.set(radius * 2, 1, radius * 2);
        fx.glow.updateMatrixWorld(true);
        fx.glowMat.uniforms.uCenter.value.set(plane.centerX, plane.centerZ);
        fx.glowMat.uniforms.uRadius.value = radius;
        fx.lightBase.set(plane.centerX, plane.topY + TRASH_FX.lightHeight, plane.centerZ);
        fx.light.position.copy(fx.lightBase);
      }

      function setTrashFxVisible(on) {
        for (const fx of _trashFxList) {
          const show = on && !!fx.plane;
          fx.points.visible = show;
          fx.pointsBehind.visible = show;
          fx.glow.visible = show;
          if (!show) fx.light.intensity = 0;
        }
      }

      // The bin signs: translucent and knockable (they move). Each frame the line from the camera to each particle is
      // tested against their triangles (in the sign's own space), to know which particles they hide.
      const _trashFxOccluders = []; // { mesh, tris (local, 9 floats each), box (local), inv, cam (local) }
      function addTrashFxOccluder(mesh) {
        const g = mesh.geometry;
        if (!g || !g.attributes.position || _trashFxOccluders.some((o) => o.mesh === mesh)) return;
        if (!g.boundingBox) g.computeBoundingBox();
        const pos = g.attributes.position;
        const idx = g.index;
        const triCount = idx ? idx.count / 3 : pos.count / 3;
        const tris = new Float32Array(triCount * 9);
        for (let t = 0; t < triCount; t++) {
          for (let v = 0; v < 3; v++) {
            const k = idx ? idx.getX(t * 3 + v) : t * 3 + v;
            tris[t * 9 + v * 3] = pos.getX(k);
            tris[t * 9 + v * 3 + 1] = pos.getY(k);
            tris[t * 9 + v * 3 + 2] = pos.getZ(k);
          }
        }
        _trashFxOccluders.push({ mesh, tris, box: g.boundingBox.clone(), inv: new THREE.Matrix4(), cam: new THREE.Vector3(), on: false });
      }
      /** Once a frame: each sign's inverse matrix and the camera in its space. */
      function prepareTrashFxOccluders() {
        const cx = camera.matrixWorld.elements[12];
        const cy = camera.matrixWorld.elements[13];
        const cz = camera.matrixWorld.elements[14];
        for (const o of _trashFxOccluders) {
          o.on = o.mesh.visible && !!o.mesh.parent;
          if (!o.on) continue;
          o.inv.copy(o.mesh.matrixWorld).invert();
          o.cam.set(cx, cy, cz).applyMatrix4(o.inv);
        }
      }
      const _trashFxSlab = new Float32Array(2); // the segment's [enter, exit] inside a box (0 → 1)
      /** Clips the segment's range to one axis of a box; false once it misses. */
      function trashFxSlab(orig, dir, mn, mx) {
        if (Math.abs(dir) < 1e-9) return orig >= mn && orig <= mx;
        let ta = (mn - orig) / dir;
        let tb = (mx - orig) / dir;
        if (ta > tb) {
          const tmp = ta;
          ta = tb;
          tb = tmp;
        }
        if (ta > _trashFxSlab[0]) _trashFxSlab[0] = ta;
        if (tb < _trashFxSlab[1]) _trashFxSlab[1] = tb;
        return _trashFxSlab[0] <= _trashFxSlab[1];
      }
      /** Is the world point (x, y, z) hidden from the camera by a bin sign? */
      function trashFxBehindSign(x, y, z) {
        for (let n = 0; n < _trashFxOccluders.length; n++) {
          const o = _trashFxOccluders[n];
          if (!o.on) continue;
          const e = o.inv.elements;
          // The point in the sign's space; the segment camera → point.
          const px = e[0] * x + e[4] * y + e[8] * z + e[12];
          const py = e[1] * x + e[5] * y + e[9] * z + e[13];
          const pz = e[2] * x + e[6] * y + e[10] * z + e[14];
          const ox = o.cam.x;
          const oy = o.cam.y;
          const oz = o.cam.z;
          const dx = px - ox;
          const dy = py - oy;
          const dz = pz - oz;
          // Quick reject: does the segment reach the sign's bounding box at all?
          const b = o.box;
          _trashFxSlab[0] = 0;
          _trashFxSlab[1] = 1;
          if (
            !trashFxSlab(ox, dx, b.min.x, b.max.x) ||
            !trashFxSlab(oy, dy, b.min.y, b.max.y) ||
            !trashFxSlab(oz, dz, b.min.z, b.max.z)
          )
            continue;
          // Segment vs each triangle (Möller–Trumbore), a hit strictly between the camera and the point.
          const tr = o.tris;
          for (let t = 0; t < tr.length; t += 9) {
            const ax = tr[t], ay = tr[t + 1], az = tr[t + 2];
            const e1x = tr[t + 3] - ax, e1y = tr[t + 4] - ay, e1z = tr[t + 5] - az;
            const e2x = tr[t + 6] - ax, e2y = tr[t + 7] - ay, e2z = tr[t + 8] - az;
            const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
            const det = e1x * hx + e1y * hy + e1z * hz;
            if (Math.abs(det) < 1e-12) continue;
            const inv = 1 / det;
            const sx = ox - ax, sy = oy - ay, sz = oz - az;
            const u = (sx * hx + sy * hy + sz * hz) * inv;
            if (u < 0 || u > 1) continue;
            const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
            const v = (dx * qx + dy * qy + dz * qz) * inv;
            if (v < 0 || u + v > 1) continue;
            const hit = (e2x * qx + e2y * qy + e2z * qz) * inv;
            if (hit > 0.001 && hit < 0.999) return true;
          }
        }
        return false;
      }

      /** Forget the placed holes and the signs (the level is being torn down). */
      function resetTrashFx() {
        for (const fx of _trashFxList) {
          fx.plane = null;
          fx.carState.clear();
        }
        _trashFxOccluders.length = 0;
        setTrashFxVisible(false);
      }

      // ── The coffee machine's screen (coffeeScreen): a lit drinks menu ────────────
      // A drawn canvas image (a warm brown backdrop, a 4 × 2 grid of soft
      // translucent tiles, each a glass drink and its name) used as the screen's
      // emissive map, so it glows on its own (bright mode and dark mode alike)
      // with a soft bloom of its own colour (no brighter, no white frame). The
      // model's quad (3.47 × 2.04, facing its local +Z) gets fresh UVs from its
      // own corners (its UVs were a rotated piece of another layout).
      const COFFEE_SCREEN = {
        /** How bright the screen glows (emissive intensity; under the bloom threshold, so it stays detailed). */
        emissiveIntensity: 1.15,
        /** Its soft bloom (share of its own colour added as glow; see thresholdBloom.js setBloomWeight). */
        bloom: 0.22,
        /** Texture width (px); the height follows the screen's aspect. */
        texWidth: 2048,
        drinks: ["Espresso", "Americano", "Cappuccino", "Latte", "Macchiato", "Hot water", "Hot milk", "Hot cream"],
      };

      /** Draws the menu image (canvas) for a screen of aspect `aspect` (width / height). */
      function drawCoffeeScreenImage(aspect) {
        const W = COFFEE_SCREEN.texWidth;
        const H = Math.round(W / aspect);
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const g = c.getContext("2d");
        // Warm brown backdrop, lighter in the middle; a thin dark strip on top.
        const bg = g.createRadialGradient(W * 0.5, H * 0.48, H * 0.05, W * 0.5, H * 0.5, W * 0.62);
        bg.addColorStop(0, "#4a3626");
        bg.addColorStop(0.55, "#2c1f16");
        bg.addColorStop(1, "#100b08");
        g.fillStyle = bg;
        g.fillRect(0, 0, W, H);
        g.fillStyle = "#070505";
        g.fillRect(0, 0, W, H * 0.025);
        // The grid.
        const cols = 4, rows = 2;
        const mx = W * 0.08, top = H * 0.17, bottom = H * 0.17, gap = W * 0.011;
        const tw = (W - 2 * mx - (cols - 1) * gap) / cols;
        const th = (H - top - bottom - (rows - 1) * gap) / rows;
        const round = (x, y, w, h, r) => {
          g.beginPath();
          g.moveTo(x + r, y);
          g.arcTo(x + w, y, x + w, y + h, r);
          g.arcTo(x + w, y + h, x, y + h, r);
          g.arcTo(x, y + h, x, y, r);
          g.arcTo(x, y, x + w, y, r);
          g.closePath();
        };
        COFFEE_SCREEN.drinks.forEach((name, i) => {
          const x = mx + (i % cols) * (tw + gap);
          const y = top + Math.floor(i / cols) * (th + gap);
          // Tile: soft translucent warm grey, lighter at the top; a warm glow along its bottom edge.
          const tg = g.createLinearGradient(0, y, 0, y + th);
          tg.addColorStop(0, "rgba(255, 238, 220, 0.2)");
          tg.addColorStop(1, "rgba(255, 238, 220, 0.12)");
          round(x, y, tw, th, tw * 0.025);
          g.fillStyle = tg;
          g.fill();
          g.strokeStyle = "rgba(255, 240, 225, 0.12)";
          g.lineWidth = 2;
          g.stroke();
          const lg = g.createLinearGradient(x, 0, x + tw, 0);
          lg.addColorStop(0, "rgba(255, 214, 170, 0)");
          lg.addColorStop(0.5, "rgba(255, 214, 170, 0.75)");
          lg.addColorStop(1, "rgba(255, 214, 170, 0)");
          g.fillStyle = lg;
          g.fillRect(x + tw * 0.08, y + th - 3, tw * 0.84, 3);
          // The drink.
          drawCoffeeScreenDrink(g, i, x + tw / 2, y + th * 0.43, th * 0.5);
          // Its name.
          g.fillStyle = "rgba(255, 255, 255, 0.94)";
          g.font = `500 ${Math.round(th * 0.085)}px "Helvetica Neue", Arial, sans-serif`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(name, x + tw / 2, y + th * 0.84);
        });
        return c;
      }

      /** One glass drink, centred at (cx, cy), `s` tall. */
      function drawCoffeeScreenDrink(g, i, cx, cy, s) {
        const glass = "rgba(255, 255, 255, 0.75)";
        const shine = (x, y, h) => {
          g.strokeStyle = "rgba(255, 255, 255, 0.55)";
          g.lineWidth = s * 0.018;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x, y + h);
          g.stroke();
        };
        const fillLayers = (x, y, w, h, layers) => {
          let yy = y + h;
          for (const [share, color] of layers) {
            const lh = h * share;
            g.fillStyle = color;
            g.fillRect(x, yy - lh, w, lh);
            yy -= lh;
          }
        };
        const handle = (x, y, w, h) => {
          g.strokeStyle = glass;
          g.lineWidth = s * 0.03;
          g.beginPath();
          g.ellipse(x, y, w, h, 0, -Math.PI / 2, Math.PI / 2);
          g.stroke();
        };
        // A straight glass (cup or tall glass): x centre, its width / height, the liquid layers (bottom first).
        const tumbler = (w, h, layers, opts = {}) => {
          const x = cx - w / 2, y = cy - h / 2 + (opts.dy || 0) * s;
          g.save();
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + w * 0.04, y + h);
          g.lineTo(x + w * 0.96, y + h);
          g.lineTo(x + w, y);
          g.closePath();
          g.clip();
          fillLayers(x, y + h * (1 - (opts.fill || 0.85)), w, h * (opts.fill || 0.85), layers);
          g.restore();
          g.strokeStyle = glass;
          g.lineWidth = s * 0.022;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + w * 0.04, y + h);
          g.lineTo(x + w * 0.96, y + h);
          g.lineTo(x + w, y);
          g.stroke();
          g.beginPath();
          g.ellipse(x + w / 2, y, w / 2, w * 0.06, 0, 0, Math.PI * 2);
          g.stroke();
          shine(x + w * 0.14, y + h * 0.12, h * 0.6);
          if (opts.handle) handle(x + w, y + h * 0.45, w * 0.28, h * 0.26);
          if (opts.base) {
            g.fillStyle = "rgba(255, 255, 255, 0.55)";
            g.fillRect(x + w * 0.04, y + h, w * 0.92, s * 0.03);
          }
        };
        switch (i) {
          case 0: // espresso: a small cup
            tumbler(s * 0.46, s * 0.4, [[0.15, "#5a3a24"], [0.85, "#1a0f08"]], { handle: true, fill: 0.7, dy: 0.08 });
            break;
          case 1: // americano: a taller cup
            tumbler(s * 0.5, s * 0.58, [[1, "#1d120b"]], { handle: true, fill: 0.78 });
            break;
          case 2: { // cappuccino: a wide cup, foam on top with a swirl
            tumbler(s * 0.72, s * 0.36, [[0.55, "#7a5236"], [0.45, "#e9d7c2"]], { handle: true, fill: 0.82, dy: 0.1 });
            g.strokeStyle = "rgba(160, 110, 70, 0.8)";
            g.lineWidth = s * 0.015;
            g.beginPath();
            g.ellipse(cx, cy - s * 0.04, s * 0.14, s * 0.03, 0, 0.3, Math.PI * 1.7);
            g.stroke();
            break;
          }
          case 3: // latte: a tall glass in layers
            tumbler(s * 0.36, s * 0.9, [[0.3, "#e8d8c4"], [0.35, "#b58457"], [0.35, "#f4ece2"]], { fill: 0.92, base: true });
            break;
          case 4: { // macchiato: a glass on a stem
            tumbler(s * 0.38, s * 0.5, [[0.45, "#a26f45"], [0.3, "#d9b48c"], [0.25, "#f2e6d6"]], { handle: true, fill: 0.95, dy: -0.12 });
            g.strokeStyle = glass;
            g.lineWidth = s * 0.03;
            g.beginPath();
            g.moveTo(cx, cy + s * 0.13);
            g.lineTo(cx, cy + s * 0.36);
            g.stroke();
            g.beginPath();
            g.ellipse(cx, cy + s * 0.38, s * 0.16, s * 0.035, 0, 0, Math.PI * 2);
            g.stroke();
            break;
          }
          case 5: // hot water: a tall glass, pale amber
            tumbler(s * 0.4, s * 0.78, [[1, "rgba(235, 220, 140, 0.75)"]], { fill: 0.72, base: true });
            break;
          case 6: // hot milk
            tumbler(s * 0.4, s * 0.78, [[1, "#f3f1ec"]], { fill: 0.82, base: true });
            break;
          default: // hot cream: a tall white glass
            tumbler(s * 0.4, s * 0.86, [[1, "#f7f5f0"]], { fill: 0.97, base: true });
            break;
        }
      }

      /** coffeeScreen: fresh UVs from its corners, and the lit menu image as its glowing surface. */
      function applyCoffeeScreen(mesh) {
        const geo = mesh.geometry;
        geo.computeBoundingBox();
        const b = geo.boundingBox;
        const w = b.max.x - b.min.x, h = b.max.y - b.min.y;
        const pos = geo.attributes.position;
        const uv = new Float32Array(pos.count * 2);
        for (let i = 0; i < pos.count; i++) {
          uv[i * 2] = (pos.getX(i) - b.min.x) / w; // left → right
          uv[i * 2 + 1] = (pos.getY(i) - b.min.y) / h; // bottom → top
        }
        geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        const tex = new THREE.CanvasTexture(drawCoffeeScreenImage(w / h));
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        const mat = new THREE.MeshStandardMaterial({
          color: 0x000000, // all its light is its own (it doesn't light anything, no reflections of it)
          emissive: 0xffffff,
          emissiveMap: tex,
          emissiveIntensity: COFFEE_SCREEN.emissiveIntensity,
          roughness: 0.6,
          metalness: 0,
        });
        setBloomWeight(mat, COFFEE_SCREEN.bloom);
        mesh.material = mat;
      }

      /**
       * iceCoffeeTank's liquid in bright mode (sRGB hex): iced coffee, creamy coffee with milk, light-to-medium
       * brown, no glow (dark mode keeps its glowing purple, in the shaders; the light blend goes between them).
       * Tank: the liquid's body (hot = its colour low in the middle, low → body → upper by height, edge = darker
       * toward the sides). Surface: its moving top (deep troughs → mid → lift on the crests).
       */
      const KITCHEN_ICE_COFFEE_COLORS = {
        tank: { hot: 0xc8915e, low: 0xb9844f, body: 0xa9784c, upper: 0xc9a27a, edge: 0x7a5234 },
        surface: { deep: 0x8c6440, mid: 0xc39b72, lift: 0xe2c7a6 },
      };
      /** A colour as a GLSL vec3 (linear, as the shader writes it). */
      function _iceCoffeeVec3(hex) {
        const c = new THREE.Color(hex);
        return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
      }
      let _iceCoffeeTankMat = null;
      let _iceCoffeeSurfaceMat = null;
      function updateIceCoffeeTank(dt) {
        if (_iceCoffeeSurfaceMat) _iceCoffeeSurfaceMat.uniforms.uTime.value += dt;
      }
      /** One hole's particles for this frame: spawn / rise / steer after the nearest car (carPts: x, y, z per car). */
      function stepTrashFxParticles(fx, dt, carPts, carCount) {
        const s = fx.sim;
        const plane = fx.plane;
        const a = fx.activity;
        const share = THREE.MathUtils.lerp(TRASH_FX.idleLevel, 1, a);
        const height = THREE.MathUtils.lerp(TRASH_FX.idleHeight, TRASH_FX.flareHeight, a);
        const steer = TRASH_FX.chaseStrength * share; // idle: weaker chase
        const range2 = TRASH_FX.chaseRange * TRASH_FX.chaseRange;
        const baseY = plane.topY + TRASH_FX.originOffset;
        const riseK = 1 - Math.exp(-dt * 8); // how fast a particle settles on its rise speed
        const t = _trashFxTime;
        let sumX = 0;
        let sumZ = 0;
        let alive = 0;
        for (let i = 0; i < TRASH_FX.count; i++) {
          const i3 = i * 3;
          const i4 = i * 4;
          const ember = s.ember[i];
          if (!s.alive[i]) {
            // Only the current share of particles respawns (fewer when idle; the others finish their life and stay out).
            s.wait[i] -= dt;
            if (s.wait[i] > 0 || s.rank[i] >= share) {
              fx.info[i4] = -1;
              continue;
            }
            const ang = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * fx.radius;
            s.pos[i3] = plane.centerX + Math.cos(ang) * r;
            s.pos[i3 + 1] = baseY;
            s.pos[i3 + 2] = plane.centerZ + Math.sin(ang) * r;
            s.vel[i3] = 0;
            s.vel[i3 + 1] = 0;
            s.vel[i3 + 2] = 0;
            s.age[i] = 0;
            s.life[i] = (ember ? TRASH_FX.emberLife : TRASH_FX.flameLife) * (0.8 + Math.random() * 0.4);
            s.alive[i] = 1;
          }
          s.age[i] += dt;
          const life01 = s.age[i] / s.life[i];
          if (life01 >= 1) {
            s.alive[i] = 0;
            s.wait[i] = 0;
            fx.info[i4] = -1;
            continue;
          }
          // Rise: a flame climbs steadily to the peak over its life; an ember speeds up as it climbs.
          const peak = height * (ember ? TRASH_FX.emberRise : 1);
          const vyTarget = (peak / s.life[i]) * (ember ? 2 * life01 : 1);
          s.vel[i3 + 1] += (vyTarget - s.vel[i3 + 1]) * riseK;
          // Chase: steer toward the nearest car in range (re-picked every frame, so it switches when another gets closer).
          const px = s.pos[i3];
          const py = s.pos[i3 + 1];
          const pz = s.pos[i3 + 2];
          let best = -1;
          let bestD2 = range2;
          for (let c = 0; c < carCount; c++) {
            const dx = carPts[c * 3] - px;
            const dz = carPts[c * 3 + 2] - pz;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestD2) {
              bestD2 = d2;
              best = c;
            }
          }
          if (best >= 0) {
            const dx = carPts[best * 3] - px;
            const dz = carPts[best * 3 + 2] - pz;
            const d = Math.sqrt(bestD2) || 1;
            const near = 1 - d / TRASH_FX.chaseRange; // stronger the closer the car
            const k = 1 - Math.exp(-dt * steer * (0.35 + 0.65 * near));
            // Slows as it reaches the car (no overshooting circles around it).
            const sp = Math.min(TRASH_FX.chaseSpeed, d * 6) / d;
            s.vel[i3] += (dx * sp - s.vel[i3]) * k;
            s.vel[i3 + 2] += (dz * sp - s.vel[i3 + 2]) * k;
          } else {
            // No car near: the sideways drift settles.
            const damp = Math.exp(-dt * 2.5);
            s.vel[i3] *= damp;
            s.vel[i3 + 2] *= damp;
          }
          // Flicker: flames lick sideways a little, embers drift further.
          const sway = ember ? TRASH_FX.swayEmber : TRASH_FX.swayFlame;
          const seed = s.seed[i];
          s.pos[i3] = px + (s.vel[i3] + Math.sin(t * (3 + seed) + seed * 5) * sway) * dt;
          s.pos[i3 + 1] = py + s.vel[i3 + 1] * dt;
          s.pos[i3 + 2] = pz + (s.vel[i3 + 2] + Math.cos(t * (2.3 + seed) + seed * 3) * sway) * dt;
          fx.info[i4] = life01;
          fx.behind[i] = trashFxBehindSign(s.pos[i3], s.pos[i3 + 1], s.pos[i3 + 2]) ? 1 : 0;
          sumX += s.pos[i3];
          sumZ += s.pos[i3 + 2];
          alive++;
        }
        fx.posAttr.needsUpdate = true;
        fx.infoAttr.needsUpdate = true;
        fx.behindAttr.needsUpdate = true;
        // The light follows the particles' centre (a share of its offset, clamped).
        let lx = 0;
        let lz = 0;
        if (alive) {
          lx = (sumX / alive - plane.centerX) * TRASH_FX.lightChase;
          lz = (sumZ / alive - plane.centerZ) * TRASH_FX.lightChase;
          const l = Math.hypot(lx, lz);
          if (l > TRASH_FX.lightChaseMax) {
            lx *= TRASH_FX.lightChaseMax / l;
            lz *= TRASH_FX.lightChaseMax / l;
          }
        }
        fx.light.position.set(fx.lightBase.x + lx, fx.lightBase.y, fx.lightBase.z + lz);
      }

      const _trashFxCarPts = new Float32Array(TRASH_FX_MAX_CARS * 3);
      function updateTrashPlaneEffect(dt) {
        const anyPlaced = _trashFxList.some((fx) => fx.plane);
        if (!TRASH_FX_ENABLED || !anyPlaced || !_kitchenWorldActive) {
          setTrashFxVisible(false);
          return;
        }
        setTrashFxVisible(true);
        dt = Math.min(dt, 0.05); // a long frame doesn't fling the particles
        _trashFxTime += dt;
        _trashFxShared.uTime.value = _trashFxTime;
        _trashFxShared.uScale.value = THREE.MathUtils.lerp(1, TRASH_FX.brightModeScale, THREE.MathUtils.clamp(lightBlend, 0, 1));
        // Every race car (the player alone before the race is set up).
        const cars = _raceCars.length ? _raceCars : car ? [{ pos: car.position, state: carState }] : [];
        let carCount = 0;
        for (let i = 0; i < cars.length && carCount < TRASH_FX_MAX_CARS; i++) {
          const p = cars[i].pos;
          if (!p) continue;
          _trashFxCarPts[carCount * 3] = p.x;
          _trashFxCarPts[carCount * 3 + 1] = p.y;
          _trashFxCarPts[carCount * 3 + 2] = p.z;
          carCount++;
        }
        prepareTrashFxOccluders();
        for (let f = 0; f < _trashFxList.length; f++) {
          const fx = _trashFxList[f];
          const plane = fx.plane;
          if (!plane) continue;
          let anyOver = false;
          let peak = 0;
          let slot = 0;
          for (let i = 0; i < cars.length; i++) {
            const rc = cars[i];
            const p = rc.pos;
            if (!p) continue;
            let cs = fx.carState.get(rc);
            if (!cs) {
              cs = { strength: 0 };
              fx.carState.set(rc, cs);
            }
            const over = p.x >= plane.minX && p.x <= plane.maxX && p.z >= plane.minZ && p.z <= plane.maxZ;
            if (over) anyOver = true;
            const maxSpeed = (rc.state && rc.state.maxSpeed) || carState.maxSpeed || 1;
            const speed01 = THREE.MathUtils.clamp(Math.abs((rc.state && rc.state.speed) || 0) / maxSpeed, 0, 1);
            // The floor glow's flare under it fades in quickly and out smoothly (delta-time based).
            const tau = over ? TRASH_FX.fadeIn : TRASH_FX.fadeOut;
            cs.strength += ((over ? 0.55 + 0.45 * speed01 : 0) - cs.strength) * (1 - Math.exp(-dt / tau));
            if (cs.strength > 0.002 && slot < TRASH_FX_MAX_CARS) {
              const radius = THREE.MathUtils.lerp(TRASH_FX.flareRadius, TRASH_FX.flareRadiusAtSpeed, speed01);
              fx.cars[slot++].set(p.x, p.z, cs.strength, radius);
              peak = Math.max(peak, cs.strength);
            }
          }
          for (; slot < TRASH_FX_MAX_CARS; slot++) fx.cars[slot].z = 0;
          // Idle ↔ full strength: ramps up while a car is over the hole, fades back once it's gone.
          const target = anyOver ? 1 : 0;
          const ramp = target > fx.activity ? TRASH_FX.rampUp : TRASH_FX.rampDown;
          fx.activity += (target - fx.activity) * (1 - Math.exp(-dt / ramp));
          const a = fx.activity;
          fx.mat.uniforms.uHeat.value = THREE.MathUtils.lerp(TRASH_FX.idleHeat, 1, a);
          const glowLevel = THREE.MathUtils.lerp(0.5 + 0.5 * TRASH_FX.idleLevel, 1, a);
          fx.mat.uniforms.uGlowFx.value.set(TRASH_FX.glowStrength * glowLevel, TRASH_FX.hotCore * glowLevel);
          stepTrashFxParticles(fx, dt, _trashFxCarPts, carCount);
          // Flicker deeper as the fire flares (each hole on its own beat).
          const t = _trashFxTime + f * 1.7;
          const flare = Math.max(a, peak);
          const flicker = 1 - (0.12 + 0.18 * flare) * (0.5 + 0.5 * Math.sin(t * 17) * Math.sin(t * 9.1 + 2));
          fx.light.intensity = THREE.MathUtils.lerp(TRASH_FX.lightIdle, TRASH_FX.lightFlare, a) * flicker * _trashFxShared.uScale.value;
        }
      }

      const FLAME_EFFECT_PARTICLE_COUNT = 60;
      const FLAME_EFFECT_SPREAD = 0.06;
      const FLAME_EFFECT_SIZE = 320;
      const FLAME_EFFECT_RISE_SPEED = 2.5;
      const flameEffectVertexShader = `
      attribute vec3 color;
      varying vec3 vColor;
      varying float vHeight;
      uniform float uSize;
      void main() {
        vColor = color;
        vHeight = position.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float att = 1.0 / max(0.1, -mv.z);
        gl_PointSize = uSize * att;
      }
    `;
      const flameEffectFragmentShader = `
      varying vec3 vColor;
      varying float vHeight;
      uniform float uFade;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        c.y *= 0.45;
        float d = length(c) * 1.6;
        float a = 1.0 - smoothstep(0.0, 1.0, d);
        a *= 1.0;
        a *= uFade;
        float topFade = 1.0 - smoothstep(0.25, 0.85, vHeight);
        a *= topFade;
        vec3 fireColor = vColor;
        float tip = smoothstep(0.0, 1.1, vHeight);
        fireColor = mix(fireColor, vec3(1.0, 0.95, 0.6), tip * 0.8);
        gl_FragColor = vec4(fireColor, a);
      }
    `;
      const flameEffectColors = [
        new THREE.Color(0xff6600),
        new THREE.Color(0xffaa00),
        new THREE.Color(0xff3300),
      ];

      const EXHAUST_DURATION = 1.5;
      let exhaustEffects = [];
      let exhaustActive = false;
      let exhaustStartTime = 0;
      let _carWasStopped = true;
      const _exhFlickerTimers = [0, 0];
      const _exhFlickerTargets = [1, 1];
      const _exhFlickerValues = [1, 1];
      const _exhFlickerNextChange = [0, 0];

      function createSmallFireEffect() {
        const count = FLAME_EFFECT_PARTICLE_COUNT;
        const rise = new Float32Array(count);
        const spread = new Float32Array(count * 2);
        for (let i = 0; i < count; i++) {
          rise[i] = Math.random() * 2;
          const r = Math.sqrt(Math.random()) * FLAME_EFFECT_SPREAD;
          const angle = Math.random() * Math.PI * 2;
          spread[i * 2] = Math.cos(angle) * r;
          spread[i * 2 + 1] = Math.sin(angle) * r;
        }
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          const c = flameEffectColors[i % 3].clone();
          c.multiplyScalar(0.9 + Math.random() * 0.25);
          colors[i * 3] = c.r;
          colors[i * 3 + 1] = c.g;
          colors[i * 3 + 2] = c.b;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        const mat = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uSize: { value: FLAME_EFFECT_SIZE },
            uTime: { value: 0 },
            uFade: { value: 1 },
          },
          vertexShader: flameEffectVertexShader,
          fragmentShader: flameEffectFragmentShader,
        });
        const matTrail = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uSize: { value: FLAME_EFFECT_SIZE * 0.75 },
            uTime: { value: 0 },
            uFade: { value: 0.35 },
          },
          vertexShader: flameEffectVertexShader,
          fragmentShader: flameEffectFragmentShader,
        });
        const matTrail2 = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uSize: { value: FLAME_EFFECT_SIZE * 0.55 },
            uTime: { value: 0 },
            uFade: { value: 0.18 },
          },
          vertexShader: flameEffectVertexShader,
          fragmentShader: flameEffectFragmentShader,
        });
        const matTrail3 = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uSize: { value: FLAME_EFFECT_SIZE * 0.4 },
            uTime: { value: 0 },
            uFade: { value: 0.12 },
          },
          vertexShader: flameEffectVertexShader,
          fragmentShader: flameEffectFragmentShader,
        });
        const points = new THREE.Points(geo, mat);
        const trailPoints = new THREE.Points(geo, matTrail);
        const trailPoints2 = new THREE.Points(geo, matTrail2);
        const trailPoints3 = new THREE.Points(geo, matTrail3);
        scene.add(points);
        scene.add(trailPoints);
        scene.add(trailPoints2);
        scene.add(trailPoints3);
        return {
          points,
          trailPoints,
          trailPoints2,
          trailPoints3,
          rise,
          spread,
          count,
          posAttr: geo.attributes.position,
        };
      }

      function enableMeshCastShadow(node) {
        if (!node?.isMesh || !perfSettings.shadows) return;
        node.castShadow = true;
        node.receiveShadow = false;
      }

      let tableLightGlows = [];
      let _tableLightGlowTex = null;

      function getTableLightGlowTexture() {
        if (_tableLightGlowTex) return _tableLightGlowTex;
        const c = document.createElement("canvas");
        c.width = 128;
        c.height = 128;
        const ctx = c.getContext("2d");
        const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0, "rgba(255,255,255,1)");
        g.addColorStop(0.28, "rgba(255,255,255,0.42)");
        g.addColorStop(0.62, "rgba(255,255,255,0.08)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
        _tableLightGlowTex = new THREE.CanvasTexture(c);
        _tableLightGlowTex.needsUpdate = true;
        return _tableLightGlowTex;
      }

      // Head / tail lamp spot lights and table glows: shared with the office (game/carLighting.js).
      const carLighting = createCarLighting({
        THREE,
        scene,
        beamTextureUrl: officeAsset("textures/headlight-beam.png") + "?v=dim3",
        stencilRef: 1,
      });
      const _carLampSpots = [];
      function attachCarHeadTailSpotLights(carRoot) {
        _carLampSpots.length = 0;
        carLighting.attachCarHeadTailSpotLights(car, carRoot, _carLampSpots, {
          halfL,
          carScale: storedCarScale,
          tableY: getTablePlaySurfaceY(),
        });
      }
      /** Table glows of a car's lamps (the player's by default, or into `list` for a race car). */
      function setupTableLightReflections(carRoot, list) {
        if (!list) {
          tableLightGlows = [];
          list = tableLightGlows;
        }
        carLighting.setupTableLightReflections(carRoot, list);
      }



      /**
       * The table top's sharp highlights (the cars' lamp spot lights, e.g. the
       * red rear lamps' streak behind each car) are far above the bloom
       * threshold; keep the table under it so they don't bloom into a glow on
       * the table (looks the same after tone mapping).
       */
      function keepTableTopBelowBloom() {
        for (const mesh of [_kitchenCoverTopMesh, tablePlateMesh]) {
          if (!mesh) continue;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) keepBelowBloomThreshold(m);
        }
      }

      function updateTableLightReflections() {
        keepTableTopBelowBloom();
        if (!tableLightGlows.length || !car || !_kitchenWorldActive) {
          for (let gi = 0; gi < tableLightGlows.length; gi++) {
            tableLightGlows[gi].sprite.visible = false;
          }
          for (const rc of _raceCars) {
            if (rc.glows) for (const g of rc.glows) g.sprite.visible = false;
          }
          return;
        }
        const tableY = getTablePlaySurfaceY();
        if (tableY == null) return;
        carLighting.aimCarLampSpots(_carLampSpots, car, tableY);
        updateCarLightAxes();
        carLighting.drawCarTableGlows(tableLightGlows, carState.angle + (carState.driftAngle || 0), keys.brake, tableY, Math.max(0.08, halfW * storedCarScale));
        for (let ri = 0; ri < _raceCars.length; ri++) {
          const rc = _raceCars[ri];
          if (rc.isPlayer || !rc.glows) continue;
          carLighting.aimCarLampSpots(rc.spots, rc.root, tableY);
          carLighting.drawCarTableGlows(rc.glows, rc.state.angle, rc.braking, tableY, Math.max(0.08, halfW * storedCarScale));
        }
      }

      function setupExhaustEffects(carScene) {
        exhaustEffects = [];
        const names = ["egzozLightLeft", "egzozLightRight"];
        const EXHAUST_SPREAD_SCALE = 0.22;
        for (const name of names) {
          const mesh = carScene.getObjectByName(name);
          if (!mesh || !mesh.parent) continue;
          const effect = createSmallFireEffect();
          effect.anchorMesh = mesh;
          effect.points.material.uniforms.uSize.value = FLAME_EFFECT_SIZE * 0.14;
          effect.points.rotation.x = -Math.PI / 2;
          effect.points.visible = false;
          for (let i = 0; i < effect.spread.length; i++) {
            effect.spread[i] *= EXHAUST_SPREAD_SCALE;
          }
          scene.remove(effect.points);
          scene.remove(effect.trailPoints);
          scene.remove(effect.trailPoints2);
          scene.remove(effect.trailPoints3);
          mesh.parent.add(effect.points);
          exhaustEffects.push(effect);
        }
      }
      function _safeRemoveBody(body) {
        if (!body) return;
        try { physicsWorld.removeBody(body); } catch (e) {}
      }
      function _disposeObject3D(obj) {
        if (!obj) return;
        obj.traverse((n) => {
          if (n.isMesh || n.isPoints || n.isLine) {
            try { if (n.geometry) n.geometry.dispose(); } catch (e) {}
            try {
              if (n.material) {
                if (Array.isArray(n.material)) n.material.forEach((m) => m && m.dispose && m.dispose());
                else if (n.material.dispose) n.material.dispose();
              }
            } catch (e) {}
          }
        });
      }
      function _removeFromScene(obj) {
        if (!obj) return;
        try { scene.remove(obj); } catch (e) {}
        _disposeObject3D(obj);
      }
      function disposeCurrentWorld() {
        if (_currentWorldModel) {
          _removeFromScene(_currentWorldModel);
          _currentWorldModel = null;
        }
        _kitchenFloorStripesGroup = null;
        _kitchenFloorMat = null;
        disposeKitchenNishInstanced();
        restoreFrontObjectsInTransmission();
        _safeRemoveBody(tablePlateBody); tablePlateBody = null;
        _safeRemoveBody(floorPhysBody); floorPhysBody = null;
        if (_peselLightMeshes.length) _peselLightMeshes.length = 0;
        peselBloom.clearMeshes();
        resetTrashFx();
        if (_milkCartons) {
          _milkCartons.dispose();
          _milkCartons = null;
        }
        if (_shelfJars) {
          _shelfJars.dispose();
          _shelfJars = null;
        }
        if (_startLights) {
          _startLights.dispose();
          _startLights = null;
        }
        if (_counterScreen) {
          _counterScreen.dispose();
          _counterScreen = null;
        }
        if (_trailingPlants) {
          _trailingPlants.dispose();
          _trailingPlants = null;
        }
        if (_cupStacks) {
          _cupStacks.dispose();
          _cupStacks = null;
        }
        if (_kitchenNapkins) {
          _kitchenNapkins.dispose();
          _kitchenNapkins = null;
        }
        stopMisterSpotLaser(_misterSpot);
        resetMisterSpotTrail();
        _misterSpot = null;
        if (_shelfDownLights.length) {
          for (const entry of _shelfDownLights) {
            const dl = entry && entry.light;
            if (!dl) continue;
            try { if (dl.target) scene.remove(dl.target); } catch (e) {}
            try { scene.remove(dl); } catch (e) {}
          }
          _shelfDownLights.length = 0;
        }
        if (_mainLightDownPoints.length) {
          for (const entry of _mainLightDownPoints) {
            const dl = entry && entry.light;
            if (!dl) continue;
            try { if (dl.target) scene.remove(dl.target); } catch (e) {}
            try { scene.remove(dl); } catch (e) {}
            try { if (entry.bulb) scene.remove(entry.bulb); } catch (e) {}
          }
          _mainLightDownPoints.length = 0;
        }
        if (_kitchenWorldActive) setKitchenPerfMode(false);
        if (_darkModeOnlyLights.length) {
          for (const dl of _darkModeOnlyLights) {
            if (!dl) continue;
            try { if (dl.target) scene.remove(dl.target); } catch (e) {}
            try { if (dl.userData && dl.userData.helper) scene.remove(dl.userData.helper); } catch (e) {}
            try { if (dl.userData && dl.userData.sourceMesh) _removeFromScene(dl.userData.sourceMesh); } catch (e) {}
            try { scene.remove(dl); } catch (e) {}
            try { dl.dispose && dl.dispose(); } catch (e) {}
          }
          _darkModeOnlyLights.length = 0;
        }
        _kitchenLampSources.length = 0;
        _kitchenTableCoverLampMat = null;
        _kitchenTableCoverSideMat = null;
        _kitchenCoverTopMesh = null;
        _mainTableTopAreaLight = null;
        _mainTableSideAreaLight = null;
        if (_kitchenTableTopStencilWriter) {
          try {
            if (_kitchenTableTopStencilWriter.parent) {
              _kitchenTableTopStencilWriter.parent.remove(_kitchenTableTopStencilWriter);
            }
          } catch (e) {}
          try { _kitchenTableTopStencilWriter.material.dispose(); } catch (e) {}
          _kitchenTableTopStencilWriter = null;
        }
        if (_kitchenTableTopLampOverlay) {
          try {
            if (_kitchenTableTopLampOverlay.parent) {
              _kitchenTableTopLampOverlay.parent.remove(_kitchenTableTopLampOverlay);
            }
          } catch (e) {}
          try { _kitchenTableTopLampOverlay.material.dispose(); } catch (e) {}
          _kitchenTableTopLampOverlay = null;
        }
        _kitchenLampUniforms.lampStrength.value = 0;
        _kitchenLampUniforms.lampCount.value = 0;
        tablePlateMesh = null;
        if (carShadowPlane) {
          _removeFromScene(carShadowPlane);
          carShadowPlane = null;
        }
      }

      function createKitchenFloorBaseTexture() {
        const size = 1024;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        ctx.fillStyle = "#E8E4DE";
        ctx.fillRect(0, 0, size, size);

        for (let i = 0; i < 5000; i++) {
          const x = Math.random() * size;
          const y = Math.random() * size;
          const g = 198 + Math.floor(Math.random() * 45);
          ctx.fillStyle = `rgba(${g},${g - 3},${g - 7},${0.06 + Math.random() * 0.22})`;
          ctx.fillRect(x, y, 1, 1);
        }
        for (let i = 0; i < 1100; i++) {
          const x = Math.random() * size;
          const y = Math.random() * size;
          const g = 155 + Math.floor(Math.random() * 35);
          ctx.fillStyle = `rgba(${g},${g - 2},${g - 6},${0.1 + Math.random() * 0.18})`;
          const r = 0.35 + Math.random() * 1.1;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
      }

      function scatterKitchenFloorStripes(floorMesh, parent) {
        if (_kitchenFloorStripesGroup) {
          _removeFromScene(_kitchenFloorStripesGroup);
          _kitchenFloorStripesGroup = null;
        }

        floorMesh.updateMatrixWorld(true);
        const _floorBox = new THREE.Box3().setFromObject(floorMesh);
        const _floorCenter = _floorBox.getCenter(new THREE.Vector3());
        const _floorSize = _floorBox.getSize(new THREE.Vector3());
        const _floorTopY = _floorBox.max.y + 0.012;

        const _stripeColors = [0xc48b86, 0xd09a94, 0xb87f7a, 0xcfa09a, 0xc99590];
        const _floorArea = _floorSize.x * _floorSize.z;
        const _stripeCount = Math.max(
          _KITCHEN_FLOOR_STRIPE_MIN,
          Math.min(_KITCHEN_FLOOR_STRIPE_MAX, Math.round(_floorArea / 8)),
        );
        const _placed = [];
        const _minDist = Math.min(_floorSize.x, _floorSize.z) * 0.035;

        for (
          let attempt = 0;
          attempt < _stripeCount * 80 && _placed.length < _stripeCount;
          attempt++
        ) {
          const wx =
            _floorCenter.x + (Math.random() - 0.5) * _floorSize.x * 0.93;
          const wz =
            _floorCenter.z + (Math.random() - 0.5) * _floorSize.z * 0.93;
          let ok = true;
          for (let j = 0; j < _placed.length; j++) {
            const dx = wx - _placed[j].x;
            const dz = wz - _placed[j].z;
            if (dx * dx + dz * dz < _minDist * _minDist) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          _placed.push({ x: wx, z: wz, rot: Math.random() * Math.PI * 2 });
        }

        const _len = 1.9;
        const _thick = 0.17;
        const _stripeGeo = new THREE.PlaneGeometry(1, 1);
        const _stripeMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.88,
          metalness: 0.0,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
        const _stripeMesh = new THREE.InstancedMesh(
          _stripeGeo,
          _stripeMat,
          _placed.length,
        );
        _stripeMesh.name = "kitchenFloorStripes";
        _stripeMesh.castShadow = false;
        _stripeMesh.receiveShadow = false;
        _stripeMesh.frustumCulled = true;
        const _m = new THREE.Matrix4();
        const _q = new THREE.Quaternion();
        const _p = new THREE.Vector3();
        const _s = new THREE.Vector3(_len, _thick, 1);
        const _e = new THREE.Euler(-Math.PI / 2, 0, 0);
        for (let i = 0; i < _placed.length; i++) {
          const sp = _placed[i];
          _e.z = sp.rot;
          _q.setFromEuler(_e);
          _p.set(sp.x, _floorTopY, sp.z);
          _m.compose(_p, _q, _s);
          _stripeMesh.setMatrixAt(i, _m);
          _stripeMesh.setColorAt(
            i,
            new THREE.Color(
              _stripeColors[Math.floor(Math.random() * _stripeColors.length)],
            ),
          );
        }
        _stripeMesh.instanceMatrix.needsUpdate = true;
        if (_stripeMesh.instanceColor) _stripeMesh.instanceColor.needsUpdate = true;
        _kitchenFloorStripesGroup = new THREE.Group();
        _kitchenFloorStripesGroup.name = "kitchenFloorStripes";
        _kitchenFloorStripesGroup.add(_stripeMesh);
        parent.add(_kitchenFloorStripesGroup);
      }

      const KITCHEN_COVER_TEX_DIR = kitchenAsset("textures/");
      /** More repeats keep the ceramic tile pattern at a smaller visual scale. */
      const KITCHEN_COVER_TILES_X = 10.75;
      /** Original counter clone spacing (59 covers + 5% gap); separate from visual tile scale. */
      const KITCHEN_COUNTER_CLONE_TILES = 60;
      const KITCHEN_TABLE_COVER_CLONES = 59;
      let _kitchenCoverTopMesh = null;
      let _mainTableTopAreaLight = null;
      let _mainTableSideAreaLight = null;
      let _kitchenTableTopLampOverlay = null;
      let _kitchenTableTopStencilWriter = null;


      function _isKitchenTableCoverPlane(name) {
        return name === "mainTableTopPlane" || name === "mainTableSidePlane";
      }

      function _configureKitchenCoverTexture(tex, isColor) {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = Math.min(
          8,
          renderer.capabilities.getMaxAnisotropy(),
        );
        if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
      }


      function _kitchenCoverMatLite(
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
      }

      function _cloneCoverTexture(tex, repX, repY) {
        const t = tex.clone();
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(repX, repY);
        t.anisotropy = tex.anisotropy;
        if (tex.colorSpace) t.colorSpace = tex.colorSpace;
        t.needsUpdate = true;
        return t;
      }

      async function createKitchenTableCoverMaterials(topRepX, topRepY, sideRepX, sideRepY) {
        const tl = new THREE.TextureLoader();
        const loadTex = (file) => tl.loadAsync(KITCHEN_COVER_TEX_DIR + file);
        const [map, normalMap, roughnessMap, aoMap, metalnessMap] = await Promise.all([
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
        );
        topMat.color.set(0x647bb8);
        topMat.emissive.setHex(0x0d1d50);
        topMat.emissiveIntensity = 0.2;
        sideMat.color.set(0x647bb8);
        sideMat.emissive.setHex(0x0d1d50);
        sideMat.emissiveIntensity = 0.2;
        // Its dark-mode look (bright mode: KITCHEN_TABLE_SIDE_BRIGHT, from the light blend).
        sideMat.userData.darkColor = sideMat.color.clone();
        sideMat.userData.darkEmissive = sideMat.emissive.clone();
        sideMat.userData.darkEmissiveIntensity = sideMat.emissiveIntensity;
        sideMat.userData.darkMetalness = sideMat.metalness;
        baseMat.color.set(0x302544);
        baseMat.emissive.setHex(0x160a2d);
        baseMat.emissiveIntensity = 0.12;
        topMat.customProgramCacheKey = () => "kitchen_table_top_plane";
        sideMat.customProgramCacheKey = () => "kitchen_table_side_plane";
        baseMat.customProgramCacheKey = () => "kitchen_table_base";
        if (scene.environment) {
          topMat.envMap = scene.environment;
          sideMat.envMap = scene.environment;
          baseMat.envMap = scene.environment;
        }
        return { topMat, sideMat, baseMat };
      }

      function _findKitchenMesh(root, name, meshByName) {
        const fromMap = meshByName && meshByName.get(name);
        if (fromMap) return fromMap;
        let found = null;
        root.traverse((n) => {
          if (!found && n.isMesh && n.name === name) found = n;
        });
        return found;
      }

      function _coverPlaneAxes(mesh) {
        const geo = mesh.geometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const bb = geo.boundingBox;
        const sx = bb.max.x - bb.min.x;
        const sy = bb.max.y - bb.min.y;
        const sz = bb.max.z - bb.min.z;
        if (sy <= sx * 0.02 && sy <= sz * 0.02) {
          return { axisU: 0, axisV: 2, lenU: sx, lenV: sz, minU: bb.min.x, minV: bb.min.z };
        }
        if (sx <= sy * 0.02 && sx <= sz * 0.02) {
          return { axisU: 2, axisV: 1, lenU: sz, lenV: sy, minU: bb.min.z, minV: bb.min.y };
        }
        if (sz <= sx * 0.02 && sz <= sy * 0.02) {
          return { axisU: 0, axisV: 1, lenU: sx, lenV: sy, minU: bb.min.x, minV: bb.min.y };
        }
        const dims = [
          { axisU: 0, axisV: 2, lenU: sx, lenV: sz, minU: bb.min.x, minV: bb.min.z },
          { axisU: 2, axisV: 1, lenU: sz, lenV: sy, minU: bb.min.z, minV: bb.min.y },
          { axisU: 0, axisV: 1, lenU: sx, lenV: sy, minU: bb.min.x, minV: bb.min.y },
        ];
        dims.sort((a, b) => b.lenU - a.lenU);
        return dims[0];
      }

      /**
       * Per-vertex triplanar UVs in world space: each vertex picks its
       * projection plane based on its dominant world-space normal axis, so a
       * 3D box gets a consistent tile pattern on all six faces.
       * Requires hard-edge-split normals (standard for box-like meshes).
       */
      function fitKitchenBaseUvsWorld(mesh, tileWorldSize) {
        const geo = mesh.geometry;
        const pos = geo.attributes.position;
        const nrm = geo.attributes.normal;
        if (!pos || !nrm) return null;
        mesh.updateWorldMatrix(true, false);
        const mw = mesh.matrixWorld;
        const nMat = new THREE.Matrix3().getNormalMatrix(mw);
        const p = new THREE.Vector3();
        const n = new THREE.Vector3();
        const ts = Math.max(tileWorldSize, 1e-4);
        const uvs = new Float32Array(pos.count * 2);
        for (let i = 0; i < pos.count; i++) {
          p.fromBufferAttribute(pos, i).applyMatrix4(mw);
          n.fromBufferAttribute(nrm, i).applyMatrix3(nMat);
          const ax = Math.abs(n.x);
          const ay = Math.abs(n.y);
          const az = Math.abs(n.z);
          let u, v;
          if (ay >= ax && ay >= az) { u = p.x; v = p.z; }
          else if (ax >= ay && ax >= az) { u = p.z; v = p.y; }
          else { u = p.x; v = p.y; }
          uvs[i * 2] = u / ts;
          uvs[i * 2 + 1] = v / ts;
        }
        geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
        geo.attributes.uv.needsUpdate = true;
        return uvs;
      }

      /** UVs 0…tilesX/Y so texture repeat stays 1 (avoids stretched Blender UV islands). */
      function fitKitchenCoverPlaneUvs(mesh, tilesU, tilesV) {
        const geo = mesh.geometry;
        const pos = geo.attributes.position;
        if (!pos) return;
        const axes = _coverPlaneAxes(mesh);
        const lenU = Math.max(axes.lenU, 1e-4);
        const lenV = Math.max(axes.lenV, 1e-4);
        const uvs = new Float32Array(pos.count * 2);
        for (let i = 0; i < pos.count; i++) {
          const uCoord = pos.getComponent(i, axes.axisU);
          const vCoord = pos.getComponent(i, axes.axisV);
          uvs[i * 2] = ((uCoord - axes.minU) / lenU) * tilesU;
          uvs[i * 2 + 1] = ((vCoord - axes.minV) / lenV) * tilesV;
        }
        geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
        geo.attributes.uv.needsUpdate = true;
        return axes;
      }

      function applyKitchenTableCoverPlanes(kmodel, meshByName) {
        const topPlane = _findKitchenMesh(kmodel, "mainTableTopPlane", meshByName);
        const sidePlane = _findKitchenMesh(kmodel, "mainTableSidePlane", meshByName);
        if (!topPlane && !sidePlane) {
          console.warn(
            "ul-kitchen28.glb: mainTableTopPlane / mainTableSidePlane not found",
          );
          return { coverCloneStepX: null, topMat: null, sideMat: null };
        }
        let coverCloneStepX = null;
        let topTilesU = KITCHEN_COVER_TILES_X;
        let topTilesV = 1;
        let sideTilesU = 1;
        let sideTilesV = 1;
        let visualTileWorldSize = null;
        if (topPlane) {
          const topAxes = _coverPlaneAxes(topPlane);
          topTilesU = KITCHEN_COVER_TILES_X;
          topTilesV = Math.max(1, (topAxes.lenV / topAxes.lenU) * topTilesU);
          visualTileWorldSize = topAxes.lenU / topTilesU;
          coverCloneStepX =
            (topAxes.lenU / KITCHEN_COUNTER_CLONE_TILES) * 1.05;
          fitKitchenCoverPlaneUvs(topPlane, topTilesU, topTilesV);
        }
        if (sidePlane) {
          const sideAxes = _coverPlaneAxes(sidePlane);
          if (visualTileWorldSize == null) {
            visualTileWorldSize = sideAxes.lenU / KITCHEN_COVER_TILES_X;
          }
          sideTilesU = Math.max(1, sideAxes.lenU / visualTileWorldSize);
          sideTilesV = Math.max(1, sideAxes.lenV / visualTileWorldSize);
          if (coverCloneStepX == null) {
            coverCloneStepX =
              (sideAxes.lenU / KITCHEN_COUNTER_CLONE_TILES) * 1.05;
          }
          fitKitchenCoverPlaneUvs(sidePlane, sideTilesU, sideTilesV);
        }
        return {
          topPlane,
          sidePlane,
          topRepX: 1,
          topRepY: 1,
          sideRepX: 1,
          sideRepY: 1,
          coverCloneStepX,
          visualTileWorldSize,
        };
      }

      function ensureKitchenCoverPlanesVisible(planeInfo) {
        if (planeInfo.topPlane) planeInfo.topPlane.visible = true;
        if (planeInfo.sidePlane) planeInfo.sidePlane.visible = true;
      }

      function _enableKitchenTopLampStencilWrite(mat) {
        mat.stencilWrite = true;
        mat.stencilRef = 1;
        mat.stencilFunc = THREE.AlwaysStencilFunc;
        mat.stencilFail = THREE.KeepStencilOp;
        mat.stencilZFail = THREE.KeepStencilOp;
        mat.stencilZPass = THREE.ReplaceStencilOp;
      }

      function bindKitchenTableCoverPlanes(planeInfo, topMat, sideMat) {
        const applyCover = (mesh, mat, order, opts) => {
          if (!mesh) return;
          const polyOffset = opts && opts.polyOffset;
          const depthWrite = !(opts && opts.depthWrite === false);
          if (mesh.geometry.attributes.uv && !mesh.geometry.attributes.uv1) {
            mesh.geometry.setAttribute("uv1", mesh.geometry.attributes.uv);
          }
          mesh.material = mat;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          mesh.frustumCulled = true;
          mesh.renderOrder = order;
          mesh.visible = true;
          mat.polygonOffset = !!polyOffset;
          if (polyOffset) {
            mat.polygonOffsetFactor = -1;
            mat.polygonOffsetUnits = -2;
          }
          mat.depthTest = true;
          mat.depthWrite = depthWrite;
          mat.needsUpdate = true;
        };
        // Top plane marks stencil=1 where it is visible (occluded by chairs/base in depth).
        applyCover(planeInfo.topPlane, topMat, 12, { polyOffset: false });
        _enableKitchenTopLampStencilWrite(topMat);
        // Side panel must not write depth — it was clipping purple pools diagonally.
        applyCover(planeInfo.sidePlane, sideMat, 11, {
          polyOffset: true,
          depthWrite: false,
        });
        _kitchenCoverTopMesh = planeInfo.topPlane || null;
        // The start lights' reflections are part of the table top's own surface (kitchenStartLights.js).
        if (_startLights && _kitchenCoverTopMesh) _startLights.attachTableReflection(_kitchenCoverTopMesh.material);
      }

      function removeKitchenTableTopLampOverlay() {
        if (_kitchenTableTopStencilWriter) {
          try {
            if (_kitchenTableTopStencilWriter.parent) {
              _kitchenTableTopStencilWriter.parent.remove(_kitchenTableTopStencilWriter);
            }
          } catch (e) {}
          try { _kitchenTableTopStencilWriter.material.dispose(); } catch (e) {}
          _kitchenTableTopStencilWriter = null;
        }
        if (!_kitchenTableTopLampOverlay) return;
        try {
          if (_kitchenTableTopLampOverlay.parent) {
            _kitchenTableTopLampOverlay.parent.remove(_kitchenTableTopLampOverlay);
          }
        } catch (e) {}
        try { _kitchenTableTopLampOverlay.material.dispose(); } catch (e) {}
        _kitchenTableTopLampOverlay = null;
      }

      function _syncKitchenLampShaderUniforms() {
        _kitchenLampUniforms.lampCount.value = Math.min(
          _kitchenLampSources.length,
          KITCHEN_LAMP_MAX,
        );
        for (let i = 0; i < KITCHEN_LAMP_MAX; i++) {
          const src = _kitchenLampSources[i];
          if (src) {
            _kitchenLampUniforms.lampPositions.value[i].set(src.x, src.y, src.z);
          }
        }
        if (_kitchenTableTopLampOverlay && _kitchenTableTopLampOverlay.material) {
          _kitchenTableTopLampOverlay.material.uniformsNeedUpdate = true;
        }
      }

      function attachKitchenTableTopLampOverlay(topPlane) {
        removeKitchenTableTopLampOverlay();
        // Lamp light is now provided by SpotLights added during lamp1..6 setup.
      }

      function updateKitchenLampCoverShader(darkBlueStr) {
        if (!_kitchenWorldActive) {
          _kitchenLampUniforms.lampStrength.value = 0;
          _kitchenLampUniforms.lampCount.value = 0;
          if (_kitchenTableTopLampOverlay) _kitchenTableTopLampOverlay.visible = false;
          return;
        }
        _kitchenLampUniforms.lampStrength.value = darkBlueStr * 0.85;
        _syncKitchenLampShaderUniforms();
        if (_kitchenTableTopLampOverlay) _kitchenTableTopLampOverlay.visible = darkBlueStr > 0.01;
      }

      function applyKitchenMeshPerf(root) {
        root.traverse((n) => {
          if (!n.isMesh) return;
          const nm = n.name;
          const isBarPlate = nm === "mainTablePlate" || nm === "kitchenMainPlate";
          n.castShadow = isBarPlate && perfSettings.shadows;
          n.receiveShadow =
            nm === "mainTablePlate" ||
            nm === "kitchenMainPlate" ||
            nm === "mainTablePlatePhysic" ||
            nm === "mainTableSidePannels";
          n.frustumCulled = true;
        });
      }

      const MISTER_SPOT_SPEED = 3.6;
      const MISTER_SPOT_SCALE = 9;
      const MISTER_SPOT_TURN_DURATION = 0.72;
      const MISTER_SPOT_HOLD_DURATION = 0.14;
      const MISTER_SPOT_EASE_DIST = 2.8;
      const ROBOT_RAIL_SCALE_Y = 2.4;
      const ROBOT_RAIL_SCALE_X = 1.12;
      const ROBOT_RAIL_OFFSET_Y = 8;
      let _misterSpot = null;

      // ── Mister Spot lasers: at each stop before a turn the eyes (eyeLeft /
      // eyeRight) fire red beams that scan the room for 2 s, ending on the
      // first wall / object they hit (raycast), with a flare + sparks there.
      const MISTER_SPOT_LASER_DURATION = 5; // per sequence (two per corner); the robot stays stopped for all of it
      // Sweep limits in the robot's own frame (radians from straight ahead):
      // each eye sweeps mostly outward, never back across / into the body.
      const MISTER_SPOT_LASER_YAW_OUT = 0.95;
      const MISTER_SPOT_LASER_YAW_IN = 0.1;
      const MISTER_SPOT_LASER_YAW_AMP = 0.5;
      const MISTER_SPOT_LASER_PITCH_MIN = -0.06;
      const MISTER_SPOT_LASER_PITCH_MAX = 0.28;
      const MISTER_SPOT_LASER_FADE_IN = 0.25;
      const MISTER_SPOT_LASER_FADE_OUT = 0.35;
      const MISTER_SPOT_LASER_MAX_DIST = 160;
      const MISTER_SPOT_LASER_SPARKS = 16;
      const MISTER_SPOT_LASER_SPARK_LIFE = 0.28;
      let _misterLaser = null;
      const _laserRaycaster = new THREE.Raycaster();
      const _laserOrigin = new THREE.Vector3();
      const _laserDir = new THREE.Vector3();
      const _laserEnd = new THREE.Vector3();
      const _laserQuat = new THREE.Quaternion();
      const _laserUp = new THREE.Vector3(0, 1, 0);

      function _laserBloom(obj) {
        obj.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
        obj.frustumCulled = false;
        obj.visible = false;
        obj.renderOrder = 6;
        scene.add(obj);
        return obj;
      }

      /** Beam / flare / spark objects, made once and reused (shown only while firing). */
      function createMisterSpotLasers() {
        const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
        beamGeo.translate(0, 0.5, 0); // base at the origin, length along +Y
        const beams = [];
        for (let i = 0; i < 2; i++) {
          const coreMat = new THREE.MeshBasicMaterial({
            color: 0xff6a55,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            toneMapped: false,
          });
          const glowMat = new THREE.MeshBasicMaterial({
            color: 0xff1208,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          });
          const core = _laserBloom(new THREE.Mesh(beamGeo, coreMat));
          const glow = _laserBloom(new THREE.Mesh(beamGeo, glowMat));
          const flareMat = new THREE.SpriteMaterial({
            map: getTableLightGlowTexture(),
            color: 0xff2a14,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          });
          const flare = _laserBloom(new THREE.Sprite(flareMat));
          const dotMat = flareMat.clone();
          dotMat.color.setHex(0xffd0c0);
          const dot = _laserBloom(new THREE.Sprite(dotMat));
          const sparkPos = new Float32Array(MISTER_SPOT_LASER_SPARKS * 3);
          const sparkGeo = new THREE.BufferGeometry();
          sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
          const sparkMat = new THREE.PointsMaterial({
            map: getTableLightGlowTexture(), // round sparks, not square points
            color: 0xffa070,
            size: 0.3,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          });
          const sparks = _laserBloom(new THREE.Points(sparkGeo, sparkMat));
          const sparkVel = new Float32Array(MISTER_SPOT_LASER_SPARKS * 3);
          const sparkAge = new Float32Array(MISTER_SPOT_LASER_SPARKS);
          for (let s = 0; s < MISTER_SPOT_LASER_SPARKS; s++) {
            sparkAge[s] = (s / MISTER_SPOT_LASER_SPARKS) * MISTER_SPOT_LASER_SPARK_LIFE;
          }
          beams.push({ core, glow, flare, dot, sparks, sparkPos, sparkVel, sparkAge, hit: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0) });
        }
        _misterLaser = { beams, targets: [], active: false };
        scheduleRebuildBloomDarkenLists();
      }

      function _laserSetVisible(on) {
        if (!_misterLaser) return;
        for (const b of _misterLaser.beams) {
          b.core.visible = b.glow.visible = b.flare.visible = b.dot.visible = b.sparks.visible = on;
        }
      }

      /** Room meshes the beams can hit: visible kitchen meshes, not the robot itself. */
      function _collectMisterSpotLaserTargets(m) {
        const targets = [];
        const root = m.object.parent;
        if (!root) return targets;
        root.traverseVisible((o) => {
          if (!o.isMesh || !o.geometry) return;
          let p = o;
          while (p) {
            if (p === m.object) return;
            p = p.parent;
          }
          targets.push(o);
        });
        return targets;
      }

      /** Front surface (robot-local z) of an eye mesh. */
      function _misterSpotEyeFrontZ(m, eye) {
        if (!eye.geometry.boundingBox) eye.geometry.computeBoundingBox();
        const bb = eye.geometry.boundingBox;
        const toLocal = new THREE.Matrix4().copy(m.object.matrixWorld).invert().multiply(eye.matrixWorld);
        let maxZ = -Infinity;
        for (let c = 0; c < 8; c++) {
          _laserEnd.set(c & 1 ? bb.max.x : bb.min.x, c & 2 ? bb.max.y : bb.min.y, c & 4 ? bb.max.z : bb.min.z).applyMatrix4(toLocal);
          if (_laserEnd.z > maxZ) maxZ = _laserEnd.z;
        }
        return maxZ + 0.002;
      }

      function startMisterSpotLaser(m) {
        if (!_misterLaser) createMisterSpotLasers();
        _misterLaser.targets = _collectMisterSpotLaserTargets(m);
        _misterLaser.active = true;
        m.object.updateMatrixWorld(true);
        // Each beam starts on the front surface of its eye (robot-local).
        _misterLaser.beams.forEach((b, i) => {
          b.hasHit = false;
          const eye = m.eyes && m.eyes[i];
          if (!eye) return;
          if (!eye.geometry.boundingBox) eye.geometry.computeBoundingBox();
          eye.geometry.boundingBox.getCenter(_laserOrigin);
          eye.localToWorld(_laserOrigin);
          m.object.worldToLocal(_laserOrigin);
          b.outSign = _laserOrigin.x >= 0 ? 1 : -1;
          _laserOrigin.z = _misterSpotEyeFrontZ(m, eye);
          b.localOrigin = (b.localOrigin || new THREE.Vector3()).copy(_laserOrigin);
        });
        _laserSetVisible(true);
        // Place the beams for this sequence right away (they still hold the last
        // sequence's pose, from before the turn, until the first update).
        updateMisterSpotLaser(m, 0, 0);
      }

      function stopMisterSpotLaser(m) {
        if (!_misterLaser) return;
        _misterLaser.active = false;
        _misterLaser.targets = [];
        _laserSetVisible(false);
        if (m && m.eyeMat) m.eyeMat.emissiveIntensity = 0;
      }

      /** One frame of the sequence; t = seconds since the robot stopped. */
      function updateMisterSpotLaser(m, t, dt) {
        const L = _misterLaser;
        if (!L || !L.active || !m.eyes) return;
        const fadeIn = Math.min(1, t / MISTER_SPOT_LASER_FADE_IN);
        const fadeOut = Math.min(1, Math.max(0, (MISTER_SPOT_LASER_DURATION - t) / MISTER_SPOT_LASER_FADE_OUT));
        const env = _misterSpotSmooth(Math.min(fadeIn, fadeOut));
        if (m.eyeMat) m.eyeMat.emissiveIntensity = 3 * env;
        m.object.updateMatrixWorld(true);
        m.object.getWorldQuaternion(_laserQuat);
        _laserRaycaster.far = MISTER_SPOT_LASER_MAX_DIST;
        for (let i = 0; i < 2; i++) {
          const eye = m.eyes[i];
          const b = L.beams[i];
          if (!eye) continue;
          // Start at the eye (its socket mouth), in world space, every frame.
          if (b.localOrigin) {
            _laserOrigin.copy(b.localOrigin);
            m.object.localToWorld(_laserOrigin);
          } else {
            if (!eye.geometry.boundingBox) eye.geometry.computeBoundingBox();
            eye.geometry.boundingBox.getCenter(_laserOrigin);
            eye.localToWorld(_laserOrigin);
          }
          // Scan: side to side with a slower up / down sweep, the eyes slightly
          // offset. The sweep leans toward the way the robot is about to turn
          // (into the room) but its centre is kept inside the eye's limits so the
          // sine swing never passes them: it eases back at the edges by itself.
          const ph = i * 0.55;
          const out = b.outSign || 1; // +1: this eye's outward side is local +x
          const lo = -MISTER_SPOT_LASER_YAW_IN + MISTER_SPOT_LASER_YAW_AMP;
          const hi = MISTER_SPOT_LASER_YAW_OUT - MISTER_SPOT_LASER_YAW_AMP;
          const centre = Math.max(lo, Math.min(hi, out * (m.laserLean || 0) * 0.6));
          const yaw = out * (centre + MISTER_SPOT_LASER_YAW_AMP * Math.sin(t * Math.PI * 1.1 + ph));
          const pMid = (MISTER_SPOT_LASER_PITCH_MIN + MISTER_SPOT_LASER_PITCH_MAX) / 2;
          const pHalf = (MISTER_SPOT_LASER_PITCH_MAX - MISTER_SPOT_LASER_PITCH_MIN) / 2;
          const pitch = pMid + pHalf * Math.sin(t * Math.PI * 1.7 + ph * 1.4);
          _laserDir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
          _laserDir.applyQuaternion(_laserQuat).normalize();
          _laserRaycaster.set(_laserOrigin, _laserDir);
          const hits = _laserRaycaster.intersectObjects(L.targets, false);
          let len = MISTER_SPOT_LASER_MAX_DIST;
          b.hasHit = false;
          for (const h of hits) {
            if (h.distance < 0.05) continue;
            len = h.distance;
            b.hit.copy(h.point);
            if (h.face) b.normal.copy(h.face.normal).transformDirection(h.object.matrixWorld);
            else b.normal.copy(_laserDir).negate();
            if (b.normal.dot(_laserDir) > 0) b.normal.negate();
            b.hasHit = true;
            break;
          }
          if (!b.hasHit) b.hit.copy(_laserOrigin).addScaledVector(_laserDir, len);
          // Beam: core + softer additive glow, from the eye to the hit point.
          for (const [mesh, r] of [[b.core, 0.035], [b.glow, 0.15]]) {
            mesh.position.copy(_laserOrigin);
            mesh.quaternion.setFromUnitVectors(_laserUp, _laserDir);
            mesh.scale.set(r, len, r);
          }
          b.core.material.opacity = env;
          b.glow.material.opacity = 0.42 * env;
          // Impact: flare + hot dot (pulsing), and sparks thrown off the surface.
          const pulse = 1 + 0.18 * Math.sin(t * 38 + i * 2);
          _laserEnd.copy(b.hit).addScaledVector(b.normal, 0.06);
          b.flare.position.copy(_laserEnd);
          b.flare.scale.setScalar(2.2 * pulse);
          b.flare.material.opacity = (b.hasHit ? 0.95 : 0) * env;
          b.dot.position.copy(_laserEnd);
          b.dot.scale.setScalar(0.55 * pulse);
          b.dot.material.opacity = (b.hasHit ? 1 : 0) * env;
          const pos = b.sparkPos;
          for (let s = 0; s < MISTER_SPOT_LASER_SPARKS; s++) {
            let age = b.sparkAge[s] + dt;
            const k = s * 3;
            if (age >= MISTER_SPOT_LASER_SPARK_LIFE || t <= dt) {
              age = t <= dt ? (s / MISTER_SPOT_LASER_SPARKS) * MISTER_SPOT_LASER_SPARK_LIFE : 0;
              // New spark: out of the surface, spread sideways.
              const vx = b.normal.x * 3 + (Math.random() - 0.5) * 6;
              const vy = b.normal.y * 3 + Math.random() * 3;
              const vz = b.normal.z * 3 + (Math.random() - 0.5) * 6;
              b.sparkVel[k] = vx;
              b.sparkVel[k + 1] = vy;
              b.sparkVel[k + 2] = vz;
              pos[k] = _laserEnd.x;
              pos[k + 1] = _laserEnd.y;
              pos[k + 2] = _laserEnd.z;
            } else {
              b.sparkVel[k + 1] -= 14 * dt;
              pos[k] += b.sparkVel[k] * dt;
              pos[k + 1] += b.sparkVel[k + 1] * dt;
              pos[k + 2] += b.sparkVel[k + 2] * dt;
            }
            b.sparkAge[s] = age;
          }
          b.sparks.geometry.attributes.position.needsUpdate = true;
          b.sparks.material.opacity = (b.hasHit ? 0.9 : 0) * env;
        }
      }

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

      // ── Mister Spot rubber trail: the squeegee ("rubber", a curved strip
      // around the back of the robot's base) leaves a glowing, smoky wiped streak
      // on the floor plus small glowing particles, in the rubber's own colour.
      // Each trail slice is the rubber's real (curved) floor footprint, so the
      // trail flows straight out of its rounded edge. Emitted by distance
      // travelled (none while the robot stands still, e.g. during the lasers);
      // everything fades by age on the GPU.
      const MISTER_TRAIL_LIFETIME = 5.2; // seconds a trail point stays visible
      const MISTER_TRAIL_STEP = 0.35; // world units of rubber travel per trail slice
      const MISTER_TRAIL_SEGMENTS = 256; // ring buffer (~80 slices alive at most over the lifetime)
      const MISTER_TRAIL_CURVE_POINTS = 11; // samples across the rubber's footprint
      const MISTER_TRAIL_LIFT = 0.025; // above the floor
      const MISTER_TRAIL_SPREAD = 0.18; // edge widening with age (fraction of width)
      const MISTER_RUBBER_GLOW = 0.6; // rubber emissive (its own colour)
      const MISTER_PARTICLE_MAX = 420;
      const MISTER_PARTICLE_STEP = 0.16; // world units of rubber travel per particle
      // Rise targets, as fractions of Mister Spot's measured height.
      const MISTER_PARTICLE_LOW_MIN = 0.3;
      const MISTER_PARTICLE_LOW_MAX = 0.7;
      const MISTER_PARTICLE_HIGH_MIN = 1.0;
      const MISTER_PARTICLE_HIGH_MAX = 1.2;
      const MISTER_PARTICLE_HIGH_SHARE = 0.25; // share of particles that rise to the top
      // Lifetime: base seconds + seconds per robot-height of rise.
      const MISTER_PARTICLE_LIFE_BASE = 1.4;
      const MISTER_PARTICLE_LIFE_PER_HEIGHT = 2.8;
      const MISTER_PARTICLE_RISE_EASE = 2.4; // >1: strong initial lift, slowing near the top
      const MISTER_PARTICLE_DRIFT_DRAG = 0.8; // damping of the sideways drift (per second)
      const MISTER_PARTICLE_SWIRL = 1.2; // sideways swirl strength (world units / s²)
      const MISTER_PARTICLE_SWIRL_RATE = 3; // swirl turning speed (radians / s)
      let _misterTrail = null;
      const _trailHsl = { h: 0, s: 0, l: 0 };

      const _MISTER_TRAIL_NOISE_GLSL = `
        float mtHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
        float mtNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(mtHash(i), mtHash(i + vec2(1.0, 0.0)), u.x),
                     mix(mtHash(i + vec2(0.0, 1.0)), mtHash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float mtFbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * mtNoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
          return v;
        }
      `;

      /**
       * The rubber's floor footprint as a curve in its local space: its bottom
       * vertices, averaged per x into a centre line, resampled to K points.
       */
      function _misterRubberFootprint(rubber) {
        const pos = rubber.geometry.attributes.position;
        let minY = Infinity;
        for (let i = 0; i < pos.count; i++) minY = Math.min(minY, pos.getY(i));
        let maxY = -Infinity;
        for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
        const eps = Math.max(1e-4, (maxY - minY) * 0.25);
        const groups = new Map();
        for (let i = 0; i < pos.count; i++) {
          if (pos.getY(i) > minY + eps) continue;
          const key = Math.round(pos.getX(i) * 1000);
          const g = groups.get(key) || { x: pos.getX(i), z: 0, n: 0 };
          g.z += pos.getZ(i);
          g.n++;
          groups.set(key, g);
        }
        const prof = [...groups.values()].map((g) => ({ x: g.x, z: g.z / g.n })).sort((a, b) => a.x - b.x);
        const K = MISTER_TRAIL_CURVE_POINTS;
        const out = [];
        if (prof.length < 2) {
          if (!rubber.geometry.boundingBox) rubber.geometry.computeBoundingBox();
          const bb = rubber.geometry.boundingBox;
          for (let k = 0; k < K; k++) {
            out.push(new THREE.Vector3(bb.min.x + ((bb.max.x - bb.min.x) * k) / (K - 1), minY, (bb.min.z + bb.max.z) / 2));
          }
          return out;
        }
        const x0 = prof[0].x;
        const x1 = prof[prof.length - 1].x;
        let j = 0;
        for (let k = 0; k < K; k++) {
          const x = x0 + ((x1 - x0) * k) / (K - 1);
          while (j < prof.length - 2 && prof[j + 1].x < x) j++;
          const a = prof[j];
          const b = prof[j + 1];
          const t = b.x > a.x ? (x - a.x) / (b.x - a.x) : 0;
          out.push(new THREE.Vector3(x, minY, a.z + (b.z - a.z) * Math.min(1, Math.max(0, t))));
        }
        return out;
      }

      /** Floor height under the robot (raycast once against the kitchen meshes). */
      function _misterFloorY(m) {
        const root = m.object.parent;
        const targets = [];
        if (root) {
          root.traverseVisible((o) => {
            if (!o.isMesh) return;
            let p = o;
            while (p) {
              if (p === m.object) return;
              p = p.parent;
            }
            targets.push(o);
          });
        }
        const o = m.object.position;
        _laserRaycaster.set(new THREE.Vector3(o.x, o.y + 4, o.z), new THREE.Vector3(0, -1, 0));
        _laserRaycaster.far = 30;
        const hit = _laserRaycaster.intersectObjects(targets, false)[0];
        return hit ? hit.point.y : o.y;
      }

      function createMisterSpotTrail() {
        // Trail ribbon: one independent strip per segment (ring buffer), each
        // joining two copies of the rubber's footprint curve, so the newest and
        // oldest slices are never joined.
        const N = MISTER_TRAIL_SEGMENTS;
        const K = MISTER_TRAIL_CURVE_POINTS;
        const V = K * 2; // vertices per segment: (previous, current) per curve point
        const pos = new Float32Array(N * V * 3);
        const birth = new Float32Array(N * V).fill(-1e6);
        const segBirth = new Float32Array(N * V).fill(-1e6);
        const side = new Float32Array(N * V);
        const along = new Float32Array(N * V);
        const right = new Float32Array(N * V * 2);
        const index = new Uint32Array(N * (K - 1) * 6);
        let ii = 0;
        for (let s = 0; s < N; s++) {
          const v = s * V;
          for (let k = 0; k < K; k++) {
            side[v + k * 2] = side[v + k * 2 + 1] = -1 + (2 * k) / (K - 1);
          }
          for (let k = 0; k < K - 1; k++) {
            const a = v + k * 2; // previous slice, point k
            const b = a + 1; // current slice, point k
            const c = a + 2; // previous slice, point k + 1
            const d = a + 3; // current slice, point k + 1
            index.set([a, c, b, c, d, b], ii);
            ii += 6;
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("aBirth", new THREE.BufferAttribute(birth, 1));
        geo.setAttribute("aSegBirth", new THREE.BufferAttribute(segBirth, 1));
        geo.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
        geo.setAttribute("aAlong", new THREE.BufferAttribute(along, 1));
        geo.setAttribute("aRight", new THREE.BufferAttribute(right, 2));
        geo.setIndex(new THREE.BufferAttribute(index, 1));
        for (const name of ["position", "aBirth", "aSegBirth", "aAlong", "aRight"]) geo.attributes[name].setUsage(THREE.DynamicDrawUsage);
        const mat = new THREE.ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uLife: { value: MISTER_TRAIL_LIFETIME },
            uSpread: { value: MISTER_TRAIL_SPREAD },
            uColor: { value: new THREE.Color(1, 1, 1) },
            uCore: { value: new THREE.Color(1, 1, 1) },
          },
          vertexShader: `
            attribute float aBirth;
            attribute float aSegBirth;
            attribute float aSide;
            attribute float aAlong;
            attribute vec2 aRight;
            uniform float uTime;
            uniform float uLife;
            uniform float uSpread;
            varying float vAge;
            varying float vSide;
            varying float vAlong;
            void main() {
              float age = (uTime - aBirth) / uLife;
              vAge = age;
              vSide = aSide;
              vAlong = aAlong;
              // Skip a segment only once all of it has expired (its newer slice):
              // moving single vertices away would stretch half-expired triangles.
              if ((uTime - aSegBirth) / uLife > 1.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
              age = clamp(age, 0.0, 1.0);
              vec3 p = position;
              // The mist drifts wider as it ages.
              p.xz += aRight * aSide * age * uSpread;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
            }
          `,
          fragmentShader: `
            uniform float uTime;
            uniform float uLife;
            uniform vec3 uColor;
            uniform vec3 uCore;
            varying float vAge;
            varying float vSide;
            varying float vAlong;
            ${_MISTER_TRAIL_NOISE_GLSL}
            void main() {
              if (vAge > 1.0) discard;
              // Noise in world distance along the trail (never stretched by its
              // length); the age shifts it so older mist keeps drifting / changing,
              // and a slow large-scale layer varies the density along the length.
              vec2 q = vec2(vAlong * 0.32, vSide * 1.6);
              float n = mtFbm(q + vec2(uTime * 0.18, uTime * 0.35) + vec2(0.0, vAge * 1.3));
              float n2 = mtFbm(q * 2.3 - vec2(uTime * 0.4, -uTime * 0.2) + n);
              float n3 = mtFbm(vec2(vAlong * 0.07, vSide * 0.6) + uTime * 0.05);
              // Edges broken up by noise: soft, ragged, more transparent.
              float edge = 1.0 - smoothstep(0.25, 1.0, abs(vSide) + (n2 - 0.5) * 0.7);
              float centre = 1.0 - smoothstep(0.0, 0.7, abs(vSide));
              float life = pow(1.0 - vAge, 1.6);
              float fresh = exp(-vAge * uLife * 2.7); // bright right behind the rubber (~0.4 s)
              float smoke = smoothstep(0.18, 0.85, n * 0.65 + n2 * 0.55) * (0.65 + 0.7 * n3);
              float a = edge * life * (0.16 + 0.42 * smoke + 0.35 * centre * fresh);
              if (a < 0.003) discard;
              vec3 col = mix(uColor, uCore, centre * fresh * 0.8);
              gl_FragColor = vec4(col * a, a);
            }
          `,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          toneMapped: false,
        });
        const ribbon = new THREE.Mesh(geo, mat);
        ribbon.name = "misterSpotTrail";
        ribbon.frustumCulled = false; // buffers change in place: no stale culling
        ribbon.renderOrder = 3; // after the floor
        // Drawn with its own (additive) material in the bloom pass too, instead of
        // as a black occluder that would cut the particles' glow behind it.
        ribbon.userData.skipBloomDarken = true;
        scene.add(ribbon);

        // Particles: fixed pool, round soft glow per point.
        const P = MISTER_PARTICLE_MAX;
        const ppos = new Float32Array(P * 3);
        const pbirth = new Float32Array(P).fill(-1e6);
        const plife = new Float32Array(P).fill(1);
        const psize = new Float32Array(P);
        const ptall = new Float32Array(P);
        const pgeo = new THREE.BufferGeometry();
        pgeo.setAttribute("position", new THREE.BufferAttribute(ppos, 3));
        pgeo.setAttribute("aBirth", new THREE.BufferAttribute(pbirth, 1));
        pgeo.setAttribute("aLife", new THREE.BufferAttribute(plife, 1));
        pgeo.setAttribute("aSize", new THREE.BufferAttribute(psize, 1));
        pgeo.setAttribute("aTall", new THREE.BufferAttribute(ptall, 1));
        for (const name of ["position", "aBirth", "aLife", "aSize", "aTall"]) pgeo.attributes[name].setUsage(THREE.DynamicDrawUsage);
        const pmat = new THREE.ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uPixelScale: { value: 400 },
            uColor: { value: new THREE.Color(1, 1, 1) },
            uCore: { value: new THREE.Color(1, 1, 1) },
          },
          vertexShader: `
            attribute float aBirth;
            attribute float aLife;
            attribute float aSize;
            attribute float aTall;
            uniform float uTime;
            uniform float uPixelScale;
            varying float vT;
            varying float vTall;
            void main() {
              float t = (uTime - aBirth) / aLife; // progress toward the target height
              vT = t;
              vTall = aTall;
              if (t < 0.0 || t > 1.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); gl_PointSize = 0.0; return; }
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              gl_Position = projectionMatrix * mv;
              // Low ones shrink as they fade; tall ones grow a little softer / wider.
              float grow = mix(1.0 - t * 0.6, 1.0 + t * 0.5, aTall);
              gl_PointSize = aSize * grow * uPixelScale / max(0.1, -mv.z);
            }
          `,
          fragmentShader: `
            uniform vec3 uColor;
            uniform vec3 uCore;
            varying float vT;
            varying float vTall;
            void main() {
              if (vT < 0.0 || vT > 1.0) discard;
              vec2 d = gl_PointCoord - 0.5;
              float r2 = dot(d, d) * 4.0;
              // Tall particles get a softer glow as they rise.
              float softness = mix(3.2, 2.0, vTall * vT);
              float glow = exp(-r2 * softness) * (1.0 - smoothstep(0.75, 1.0, r2));
              // Fade by progress toward the target height: full most of the way,
              // easing out near the top (tall ones a bit more transparent up there).
              float fade = smoothstep(0.0, 0.06, vT) * (1.0 - smoothstep(0.7, 1.0, vT)) * (1.0 - 0.3 * vTall * vT);
              float a = glow * fade;
              if (a < 0.004) discard;
              vec3 col = mix(uColor, uCore, exp(-r2 * 9.0) * 0.8);
              gl_FragColor = vec4(col * a, a);
            }
          `,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        });
        const points = new THREE.Points(pgeo, pmat);
        points.name = "misterSpotTrailParticles";
        points.frustumCulled = false; // positions change in place: no stale culling
        points.renderOrder = 4;
        points.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
        scene.add(points);
        scheduleRebuildBloomDarkenLists();

        _misterTrail = {
          ribbon,
          points,
          time: 0,
          seg: 0,
          along: 0,
          hasLast: false,
          last: [],
          cur: [],
          lastBirth: 0,
          distSinceSample: 0,
          distSinceParticle: 0,
          prevC: new THREE.Vector3(),
          prevL: new THREE.Vector3(),
          curC: new THREE.Vector3(),
          hasPrev: false,
          pNext: 0,
          pvel: new Float32Array(P * 3),
          pswirl: new Float32Array(P), // swirl phase per particle
          py0: new Float32Array(P), // start height
          prise: new Float32Array(P), // target rise (world units)
          robotHeight: 0,
          heightOf: null,
          footprint: null,
          footprintOf: null,
          floorY: null,
          floorOf: null,
        };
        for (let k = 0; k < MISTER_TRAIL_CURVE_POINTS; k++) {
          _misterTrail.last.push(new THREE.Vector3());
          _misterTrail.cur.push(new THREE.Vector3());
        }
      }

      /** The rubber's footprint curve in world space, on the floor (into T.cur). */
      function _misterRubberCurve(m, rubber) {
        const T = _misterTrail;
        if (T.footprintOf !== rubber) {
          T.footprint = _misterRubberFootprint(rubber);
          T.footprintOf = rubber;
        }
        if (T.floorOf !== m.object) {
          T.floorY = _misterFloorY(m);
          T.floorOf = m.object;
        }
        const y = T.floorY + MISTER_TRAIL_LIFT;
        T.curC.set(0, 0, 0);
        for (let k = 0; k < T.cur.length; k++) {
          const p = T.cur[k].copy(T.footprint[k]);
          rubber.localToWorld(p);
          p.y = y;
          T.curC.add(p);
        }
        T.curC.multiplyScalar(1 / T.cur.length);
      }

      /** Trail and particle colours follow the rubber's material colour. */
      function _misterTrailSyncColour(rubber) {
        const T = _misterTrail;
        const mat = rubber && rubber.material;
        if (!mat || !mat.color) return;
        const base = T.ribbon.material.uniforms.uColor.value;
        const core = T.ribbon.material.uniforms.uCore.value;
        base.copy(mat.color);
        // Glowing core: the same hue, more saturated and brighter.
        base.getHSL(_trailHsl);
        core.setHSL(_trailHsl.h, Math.min(1, _trailHsl.s * 1.15 + 0.05), Math.min(0.82, _trailHsl.l + 0.18));
        T.points.material.uniforms.uColor.value.copy(base);
        T.points.material.uniforms.uCore.value.copy(core);
      }

      function _misterTrailWriteSegment(T, birthNow) {
        const K = MISTER_TRAIL_CURVE_POINTS;
        const V = K * 2;
        const geo = T.ribbon.geometry;
        const pos = geo.attributes.position.array;
        const birth = geo.attributes.aBirth.array;
        const segBirth = geo.attributes.aSegBirth.array;
        const along = geo.attributes.aAlong.array;
        const right = geo.attributes.aRight.array;
        const s = T.seg;
        T.seg = (T.seg + 1) % MISTER_TRAIL_SEGMENTS;
        const step = T.lastC.distanceTo(T.curC);
        for (let k = 0; k < K; k++) {
          for (let w = 0; w < 2; w++) {
            const v = s * V + k * 2 + w; // w 0: previous slice, 1: current slice
            const curve = w ? T.cur : T.last;
            const p = curve[k];
            pos[v * 3] = p.x;
            pos[v * 3 + 1] = p.y;
            pos[v * 3 + 2] = p.z;
            birth[v] = w ? birthNow : T.lastBirth;
            segBirth[v] = birthNow;
            along[v] = w ? T.along + step : T.along;
            // Sideways direction of this slice (for the age spread), scaled by width.
            right[v * 2] = curve[K - 1].x - curve[0].x;
            right[v * 2 + 1] = curve[K - 1].z - curve[0].z;
          }
        }
        T.along += step;
        for (const name of ["position", "aBirth", "aSegBirth", "aAlong", "aRight"]) geo.attributes[name].needsUpdate = true;
      }

      function _misterTrailKeepSlice(T) {
        for (let k = 0; k < T.cur.length; k++) T.last[k].copy(T.cur[k]);
        T.lastC = (T.lastC || new THREE.Vector3()).copy(T.curC);
        T.lastBirth = T.time;
      }

      function _misterTrailEmitParticle(T) {
        const P = MISTER_PARTICLE_MAX;
        const K = T.cur.length;
        const i = T.pNext;
        T.pNext = (T.pNext + 1) % P;
        const g = T.points.geometry;
        const pos = g.attributes.position.array;
        // Random point along the rubber's (curved) edge.
        const u = Math.random() * (K - 1);
        const k = Math.min(K - 2, Math.floor(u));
        const f = u - k;
        const a = T.cur[k];
        const b = T.cur[k + 1];
        const x = a.x + (b.x - a.x) * f;
        const z = a.z + (b.z - a.z) * f;
        pos[i * 3] = x;
        pos[i * 3 + 1] = a.y + 0.05;
        pos[i * 3 + 2] = z;
        // Drift: up, and outward from the robot (away from its centre).
        let ox = x - T.robotX;
        let oz = z - T.robotZ;
        const ol = Math.hypot(ox, oz) || 1;
        ox /= ol;
        oz /= ol;
        const sp = 0.4 + Math.random() * 0.8;
        T.pvel[i * 3] = ox * 0.7 * sp + (Math.random() - 0.5) * 0.3;
        T.pvel[i * 3 + 1] = 0;
        T.pswirl[i] = Math.random() * Math.PI * 2;
        T.pvel[i * 3 + 2] = oz * 0.7 * sp + (Math.random() - 0.5) * 0.3;
        // Target height: most stay low, some rise to the robot's full height.
        const tall = Math.random() < MISTER_PARTICLE_HIGH_SHARE;
        const frac = tall
          ? MISTER_PARTICLE_HIGH_MIN + Math.random() * (MISTER_PARTICLE_HIGH_MAX - MISTER_PARTICLE_HIGH_MIN)
          : MISTER_PARTICLE_LOW_MIN + Math.random() * (MISTER_PARTICLE_LOW_MAX - MISTER_PARTICLE_LOW_MIN);
        T.py0[i] = pos[i * 3 + 1];
        T.prise[i] = frac * T.robotHeight;
        g.attributes.aBirth.array[i] = T.time;
        g.attributes.aLife.array[i] = MISTER_PARTICLE_LIFE_BASE + frac * MISTER_PARTICLE_LIFE_PER_HEIGHT * (0.85 + Math.random() * 0.3);
        g.attributes.aSize.array[i] = 0.25 + Math.random() * 0.45;
        g.attributes.aTall.array[i] = tall ? 1 : 0;
        g.attributes.aBirth.needsUpdate = true;
        g.attributes.aLife.needsUpdate = true;
        g.attributes.aSize.needsUpdate = true;
        g.attributes.aTall.needsUpdate = true;
      }

      /** Per frame: emit by rubber travel, move particles, advance the fade clock. */
      function updateMisterSpotTrail(dt) {
        const m = _misterSpot;
        if (!_misterTrail) {
          if (!m || !m.object) return;
          createMisterSpotTrail();
        }
        const T = _misterTrail;
        T.time += dt;
        T.ribbon.material.uniforms.uTime.value = T.time;
        T.points.material.uniforms.uTime.value = T.time;
        if (camera && camera.isPerspectiveCamera) {
          const h = renderer.domElement.height || 800;
          T.points.material.uniforms.uPixelScale.value = (h * 0.5) / Math.tan((camera.fov * Math.PI) / 360);
        }
        // Particles move every frame (CPU), fading / shrinking happens in the shader.
        const pg = T.points.geometry;
        const ppos = pg.attributes.position.array;
        const pb = pg.attributes.aBirth.array;
        const pl = pg.attributes.aLife.array;
        let anyAlive = false;
        for (let i = 0; i < MISTER_PARTICLE_MAX; i++) {
          if (T.time - pb[i] > pl[i]) continue;
          anyAlive = true;
          // Height follows an ease-out toward the particle's target: a strong
          // initial lift that slows near the top (frame-rate independent).
          const prog = Math.min(1, (T.time - pb[i]) / pl[i]);
          ppos[i * 3 + 1] = T.py0[i] + T.prise[i] * (1 - Math.pow(1 - prog, MISTER_PARTICLE_RISE_EASE));
          // Rising smoke: a slow sideways swirl, stronger as the particle climbs.
          const sw = T.pswirl[i] + (T.time - pb[i]) * MISTER_PARTICLE_SWIRL_RATE;
          const swirl = MISTER_PARTICLE_SWIRL * (0.3 + prog) * dt;
          const drag = 1 - Math.min(1, dt * MISTER_PARTICLE_DRIFT_DRAG);
          T.pvel[i * 3] = (T.pvel[i * 3] + Math.cos(sw) * swirl) * drag;
          T.pvel[i * 3 + 2] = (T.pvel[i * 3 + 2] + Math.sin(sw) * swirl) * drag;
          ppos[i * 3] += T.pvel[i * 3] * dt;
          ppos[i * 3 + 2] += T.pvel[i * 3 + 2] * dt;
        }
        if (anyAlive) pg.attributes.position.needsUpdate = true;

        const rubber = m && m.object && m.rubber;
        if (!rubber) {
          T.hasLast = false;
          T.hasPrev = false;
          return;
        }
        _misterTrailSyncColour(rubber);
        m.object.updateMatrixWorld(true);
        if (T.heightOf !== m.object) {
          // Mister Spot's real height (world units), for the particle rise.
          T.robotHeight = new THREE.Box3().setFromObject(m.object).getSize(new THREE.Vector3()).y;
          T.heightOf = m.object;
        }
        _misterRubberCurve(m, rubber);
        T.robotX = m.object.position.x;
        T.robotZ = m.object.position.z;
        // Distance the rubber travelled this frame (its end too, for turns in place).
        const end = T.cur[0];
        let moved = 0;
        if (T.hasPrev) {
          moved = Math.max(T.prevC.distanceTo(T.curC), T.prevL.distanceTo(end));
          if (moved > 20) {
            // Teleport (respawn / reload): start a fresh trail.
            moved = 0;
            T.hasLast = false;
          }
        }
        T.prevC.copy(T.curC);
        T.prevL.copy(end);
        T.hasPrev = true;
        if (moved < 1e-5) return; // standing still: nothing new, old trail fades
        if (!T.hasLast) {
          _misterTrailKeepSlice(T);
          T.hasLast = true;
          T.distSinceSample = 0;
          T.distSinceParticle = 0;
          return;
        }
        T.distSinceSample += moved;
        T.distSinceParticle += moved;
        while (T.distSinceParticle >= MISTER_PARTICLE_STEP) {
          T.distSinceParticle -= MISTER_PARTICLE_STEP;
          _misterTrailEmitParticle(T);
        }
        if (T.distSinceSample >= MISTER_TRAIL_STEP) {
          T.distSinceSample = 0;
          _misterTrailWriteSegment(T, T.time);
          _misterTrailKeepSlice(T);
        }
      }

      /** Clear the trail (world unload): every point dead, nothing visible. */
      function resetMisterSpotTrail() {
        const T = _misterTrail;
        if (!T) return;
        T.ribbon.geometry.attributes.aBirth.array.fill(-1e6);
        T.ribbon.geometry.attributes.aBirth.needsUpdate = true;
        T.ribbon.geometry.attributes.aSegBirth.array.fill(-1e6);
        T.ribbon.geometry.attributes.aSegBirth.needsUpdate = true;
        T.points.geometry.attributes.aBirth.array.fill(-1e6);
        T.points.geometry.attributes.aBirth.needsUpdate = true;
        T.hasLast = false;
        T.hasPrev = false;
        T.floorOf = null;
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
        // Stop before the turn: first laser sequence (see updateMisterSpot).
        _misterSpotStartLaser(m, MISTER_SPOT_MODE.LASER_1);
      }

      /**
       * Corner state machine (one state at a time, each must finish first):
       * DRIVE → LASER_1 (stopped, sweep leans toward the coming turn) → HOLD →
       * TURN → LASER_2 (stopped, sweep in the new facing) → DRIVE.
       */
      const MISTER_SPOT_MODE = {
        DRIVE: "drive",
        LASER_1: "laser1",
        HOLD: "hold",
        TURN: "turn",
        LASER_2: "laser2",
      };

      function _misterSpotStartLaser(m, mode) {
        m.mode = mode;
        m.laserT = 0;
        // Before the turn the sweep leans into it; after it, it is centred ahead.
        m.laserLean = mode === MISTER_SPOT_MODE.LASER_1 ? m.yawDelta : 0;
        startMisterSpotLaser(m);
      }

      function updateMisterSpot(dt) {
        const m = _misterSpot;
        if (!m || !m.object || !m.segs || !m.segs.length) return;
        if (dt < 0) dt = 0;
        // The intro's laser shot: stopped where it was, firing (its path state waits, see _kIntroSpotBegin).
        if (m.introLaser) {
          m.introLaser.t += dt;
          m.object.position.copy(m.introLaser.saved.pos);
          m.object.rotation.y = m.introLaser.saved.rotY;
          updateMisterSpotLaser(m, Math.max(0, m.introLaser.t + m.introLaser.offset), dt);
          return;
        }
        const segs = m.segs;
        if (m.mode === MISTER_SPOT_MODE.LASER_1 || m.mode === MISTER_SPOT_MODE.LASER_2) {
          const before = m.mode === MISTER_SPOT_MODE.LASER_1;
          m.laserT += dt;
          // Fully stationary at the corner, facing the old / new direction.
          m.object.position.set(segs[m.seg].to.x, m.y, segs[m.seg].to.z);
          m.object.rotation.y = before ? m.yawFrom : m.yawTo;
          if (m.laserT < MISTER_SPOT_LASER_DURATION) {
            updateMisterSpotLaser(m, m.laserT, dt);
            return;
          }
          // Faded out completely: next state.
          stopMisterSpotLaser(m);
          if (before) {
            m.mode = MISTER_SPOT_MODE.HOLD;
            m.holdT = 0;
          } else {
            _misterSpotStartDrive(m, (m.seg + 1) % segs.length, 0);
          }
          return;
        }
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
            // Turn complete: second laser sequence before driving on.
            _misterSpotStartLaser(m, MISTER_SPOT_MODE.LASER_2);
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
        // The rubber glows in its own colour (also through the bloom pass).
        rubberPink.emissive.copy(rubberPink.color);
        rubberPink.emissiveIntensity = MISTER_RUBBER_GLOW;
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
          eyesMiddle: glossyBlack,
          rubber: rubberPink,
          screen: screenBlack,
        };
        root.traverse((n) => {
          if (!n.isMesh) return;
          const mat = mats[n.name];
          if (n.name === "rubber") n.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
          if (mat) n.material = mat;
          else if (n.name === "eyeLeft" || n.name === "eyeRight") {
            // Own material: lights up red while the lasers fire.
            if (!root.userData.eyeMat) {
              const eyeMat = glossyBlack.clone();
              eyeMat.emissive.setHex(0xff1a0a);
              eyeMat.emissiveIntensity = 0;
              root.userData.eyeMat = eyeMat;
            }
            n.material = root.userData.eyeMat;
            n.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
          } else applySceneEnvironmentToMaterial(n.material);
        });
      }

      function loadMisterSpot(kmodel, loadToken) {
        const mLoader = new GLTFLoader();
        mLoader.load(
          kitchenAsset("Mister-spot2.glb"),
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
            // "Cylinder" (no material) is a pair of boxes covering both eye
            // sockets; hidden so the eyes / laser beams show cleanly.
            const eyeCovers = mister.getObjectByName("Cylinder");
            if (eyeCovers) eyeCovers.visible = false;
            // The "sensors" face bar is removed from the robot.
            const sensors = mister.getObjectByName("sensors");
            if (sensors && sensors.parent) sensors.parent.remove(sensors);
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
                eyes: [mister.getObjectByName("eyeLeft"), mister.getObjectByName("eyeRight")],
                eyeMat: mister.userData.eyeMat || null,
                rubber: mister.getObjectByName("rubber") || null,
              };
              scheduleRebuildBloomDarkenLists();
              _misterSpotStartDrive(_misterSpot, segI, along0);
            } else if (rail) {
              mister.position.copy(rail.position);
              _misterSpot = null;
            }
          },
          undefined,
          (err) => {
            console.error("Failed to load Mister-spot2.glb:", err);
          },
        );
      }

      function loadKitchenWorld() {
        const loadToken = ++_kitchenLoadToken;
        const kLoader = new GLTFLoader();
        kLoader.load(
          kitchenAsset("ul-kitchen28.glb"),
          (gltf) => {
            if (!_worldSwitched || loadToken !== _kitchenLoadToken) return;

            const kmodel = gltf.scene;
            applyKitchenMeshPerf(kmodel);
            applyTextureAnisotropyToRoot(kmodel);
            applyPerformanceShadowPolicy(kmodel);
            const _kitchenMeshByName = new Map();
            kmodel.traverse((n) => {
              if (n.isMesh && n.name) _kitchenMeshByName.set(n.name, n);
            });
            // Find kitchen "table" surface = mainTablePlate (the bar countertop the car drives on).
            // Prefer the visible mesh; hide any separate physic helper.
            let kitchenPlate = null;
            let kitchenPlatePhysic = null;
            kmodel.traverse((n) => {
              if (n.isMesh && n.name === "mainTablePlate") kitchenPlate = n;
              if (n.isMesh && n.name === "mainTablePlatePhysic") kitchenPlatePhysic = n;
            });
            const surfaceMesh = kitchenPlate || kitchenPlatePhysic;
            if (!surfaceMesh) {
              console.warn("ul-kitchen28.glb: no mainTablePlate/mainTablePlatePhysic mesh found");
              _worldSwitched = false;
              return;
            }

            scene.add(kmodel);
            _kitchenDragRoot = kmodel;
            _currentWorldModel = kmodel;
            loadMisterSpot(kmodel, loadToken);

            let mainTableBaseMesh = null;
            let mainNishBackWallPlateMesh = null;
            kmodel.traverse((n) => {
              if (n.isMesh && n.name === "mainTableBase") mainTableBaseMesh = n;
              if (n.isMesh && n.name === "MainNishBackWallPlate") {
                mainNishBackWallPlateMesh = n;
              }
            });
            const _ceramicSlateMaterial = new THREE.MeshStandardMaterial({
              color: 0x5a7f96,
              roughness: 0.2,
              metalness: 0.0,
              envMapIntensity: 1.0,
            });

            let _coverCloneStepX = null;
            let _tableCoverLampMat = null;
            const _finishKitchenWorldSetup = () => {
            const _mainGreenWallMat = new THREE.MeshStandardMaterial({
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
              "uniform vec4 uDoorRects[40];\n" +
              "float closetEdgeDist(vec3 p){\n" +
              "  float edge=8.0;\n" +
              "  for(int i=0;i<40;i++){\n" +
              "    vec4 r=uDoorRects[i];\n" +
              "    float inside=step(r.x,p.x)*step(p.x,r.y)*step(r.z,p.y)*step(p.y,r.w)*step(r.x,r.y);\n" +
              "    float d=min(min(p.x-r.x,r.y-p.x),min(p.y-r.z,r.w-p.y));\n" +
              "    edge=mix(edge,min(edge,d),inside);\n" +
              "  }\n" +
              "  return edge;\n" +
              "}\n";
            _closetDoorEdgeMat.onBeforeCompile = (shader) => {
              shader.uniforms.uDoorRects = { value: _closetDoorRects };
              shader.vertexShader = shader.vertexShader
                .replace(
                  "#include <common>",
                  "#include <common>\nvarying vec3 vClosetLocal;\n" + _closetEdgeGlsl,
                )
                .replace(
                  "#include <begin_vertex>",
                  "#include <begin_vertex>\nvClosetLocal=position;\nfloat _bevel=1.0-smoothstep(0.0,0.12,closetEdgeDist(position));\nif(normal.z>0.7) transformed.z-=_bevel*0.008;",
                );
              shader.fragmentShader = shader.fragmentShader
                .replace(
                  "#include <common>",
                  "#include <common>\nvarying vec3 vClosetLocal;\n" + _closetEdgeGlsl,
                )
                .replace(
                  "#include <color_fragment>",
                  "#include <color_fragment>\nfloat _line=1.0-smoothstep(0.0,0.12,closetEdgeDist(vClosetLocal));\ndiffuseColor.rgb*=mix(1.0,0.91,_line);",
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
                  "#include <common>\nvarying vec3 vClosetLocal;\n" + _closetEdgeGlsl,
                )
                .replace(
                  "#include <begin_vertex>",
                  "#include <begin_vertex>\nvClosetLocal=position;\nfloat _bevel=1.0-smoothstep(0.0,0.12,closetEdgeDist(position));\nif(normal.z>0.7) transformed.z-=_bevel*0.008;",
                );
              shader.fragmentShader = shader.fragmentShader
                .replace(
                  "#include <common>",
                  "#include <common>\nvarying vec3 vClosetLocal;\n" + _closetEdgeGlsl,
                )
                .replace(
                  "#include <color_fragment>",
                  "#include <color_fragment>\nfloat _line=1.0-smoothstep(0.0,0.12,closetEdgeDist(vClosetLocal));\ndiffuseColor.rgb*=mix(1.0,0.91,_line);",
                );
            };
            _dishwasherDoorEdgeMat.customProgramCacheKey = () => "dishwasherDoorEdges";
            const _mainNishBackWallMat = new THREE.MeshStandardMaterial({
              color: 0xf2eeea,
              roughness: 1.0,
              metalness: 0.0,
              side: THREE.DoubleSide,
            });
            const _kitchenMainPlateMat = new THREE.MeshStandardMaterial({
              color: 0xedd0b0,
              roughness: 0.94,
              metalness: 0.0,
              envMapIntensity: 0.2,
            });
            const _mainTablePlateMat = new THREE.MeshStandardMaterial({
              color: 0x4a3426,
              roughness: 1.0,
              metalness: 0.0,
              envMapIntensity: 0,
              side: THREE.DoubleSide,
              polygonOffset: true,
              polygonOffsetFactor: 1,
              polygonOffsetUnits: 1,
            });
            if (scene.environment) {
              _kitchenMainPlateMat.envMap = scene.environment;
              _mainTablePlateMat.envMap = null;
            }
            // Its dark-mode colour (bright mode: KITCHEN_TABLE_PLATE_BRIGHT, from the light blend).
            _mainTablePlateMat.userData.darkColor = _mainTablePlateMat.color.clone();
            _mainTablePlateMatRef = _mainTablePlateMat;
            if (lightBlend > 0) try { applyLightBlend(lightBlend); } catch (e) {}
            const _mainTableSidePannelsMat = new THREE.MeshStandardMaterial({
              color: 0xff837b,
              roughness: 1.0,
              metalness: 0.0,
            });
            const _mainTrashPaintMat = new THREE.MeshStandardMaterial({
              color: 0xa8f4fa,
              roughness: 0.88,
              metalness: 0.0,
            });
            const _binSign1PlasticMat = new THREE.MeshStandardMaterial({
              color: 0xff5500,
              roughness: 0.35,
              metalness: 0.0,
              transparent: true,
              opacity: 0.72,
              side: THREE.DoubleSide,
              depthWrite: false,
            });
            const _matteWhiteMat = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              roughness: 1.0,
              metalness: 0.0,
            });
            const _blackPlasticMat = new THREE.MeshStandardMaterial({
              color: 0x333333,
              roughness: 0.92,
              metalness: 0.0,
            });
            // "Cube" (new in ul-kitchen25) shares coffeeMuchineBody's material
            // instance (no textures, so its own UVs don't matter).
            const _blackPlasticMeshNames = new Set([
              "coffeeMuchineBody",
              "Cube",
              "coffeeTankCup",
              "coffeeStrokEdge",
              "waterTapPlastic",
              "iceCoffeeBody",
              "iceCoffeeCup",
              "iceCoffeeHandle",
            ]);
            const _chromeMetalMat = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              metalness: 1.0,
              roughness: 0.1,
              envMapIntensity: 2.5,
            });
            if (scene.environment) _chromeMetalMat.envMap = scene.environment;
            const _chromeMetalMeshNames = new Set([
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
              vertexShader: `
                varying vec3 vWorldPos;
                varying vec3 vWorldNormal;
                void main() {
                  vec4 worldPos = modelMatrix * vec4(position, 1.0);
                  vWorldPos = worldPos.xyz;
                  vWorldNormal = normalize(mat3(modelMatrix) * normal);
                  gl_Position = projectionMatrix * viewMatrix * worldPos;
                }
              `,
              fragmentShader: `
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
              `,
            });
            _clearPlasticMat.customProgramCacheKey = () => "iceCoffeeGlassFresnel";
            const _clearPlasticMeshNames = new Set(["iceCoffeeGlass"]);
            const _iceCoffeeUniforms = {
              uTime: { value: 0 },
              uFill: { value: 0.56 },
              uBright: { value: lightBlend }, // 0 dark mode (glowing purple) → 1 bright mode (iced coffee)
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
              vertexShader: `
                varying vec3 vLocal;
                void main() {
                  vLocal = position;
                  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
              `,
              fragmentShader: `
                varying vec3 vLocal;
                uniform float uFill;
                uniform float uBright;
                vec3 shade(vec3 hot, vec3 low, vec3 body, vec3 upper, vec3 edge, float h, float radial) {
                  vec3 col = mix(hot, low, smoothstep(0.0, 0.18, h));
                  col = mix(col, body, smoothstep(0.12, 0.5, h));
                  col = mix(col, upper, smoothstep(0.55, 1.0, h));
                  return mix(col, edge, smoothstep(0.45, 1.0, radial) * 0.65);
                }
                void main() {
                  float h = clamp((vLocal.y + 1.282) / (uFill + 1.282), 0.0, 1.0);
                  vec2 xz = vLocal.xz / vec2(0.793, 1.648);
                  float radial = clamp(length(xz), 0.0, 1.0);
                  float core = exp(-dot(xz, xz) * 2.2) * pow(1.0 - h, 1.2);
                  vec3 hot = vec3(0.95, 0.0, 0.38);
                  vec3 col = shade(hot, vec3(0.86, 0.0, 0.32), vec3(0.78, 0.0, 0.28), vec3(0.84, 0.0, 0.34), vec3(0.52, 0.0, 0.2), h, radial);
                  col += hot * core * 0.4; // dark mode's glow from within
                  vec3 coffee = shade(
                    ${_iceCoffeeVec3(KITCHEN_ICE_COFFEE_COLORS.tank.hot)},
                    ${_iceCoffeeVec3(KITCHEN_ICE_COFFEE_COLORS.tank.low)},
                    ${_iceCoffeeVec3(KITCHEN_ICE_COFFEE_COLORS.tank.body)},
                    ${_iceCoffeeVec3(KITCHEN_ICE_COFFEE_COLORS.tank.upper)},
                    ${_iceCoffeeVec3(KITCHEN_ICE_COFFEE_COLORS.tank.edge)},
                    h, radial); // no glow
                  gl_FragColor = vec4(mix(col, coffee, uBright), 1.0);
                }
              `,
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
              vertexShader: `
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
              `,
              fragmentShader: `
                varying float vWave;
                varying float vChop;
                uniform float uBright;
                void main() {
                  float crest = smoothstep(-0.35, 0.55, vWave);
                  vec3 deep = vec3(0.42, 0.0, 0.16);
                  vec3 mid = vec3(0.92, 0.0, 0.34);
                  vec3 lift = vec3(1.0, 0.0, 0.4);
                  vec3 col = mix(deep, mid, clamp(vChop, 0.0, 1.0));
                  col = mix(col, lift, crest * 0.85);
                  vec3 coffee = mix(
                    ${_iceCoffeeVec3(KITCHEN_ICE_COFFEE_COLORS.surface.deep)},
                    ${_iceCoffeeVec3(KITCHEN_ICE_COFFEE_COLORS.surface.mid)},
                    clamp(vChop, 0.0, 1.0));
                  coffee = mix(coffee, ${_iceCoffeeVec3(KITCHEN_ICE_COFFEE_COLORS.surface.lift)}, crest * 0.85);
                  gl_FragColor = vec4(mix(col, coffee, uBright), 1.0);
                }
              `,
            });
            applySceneEnvironmentToMaterial(waterTapChromeMat);
            const _matteWhiteMeshNames = new Set([
              "tap",
              "paperDispencer",
              "topPlantBaseLeft",
              "topPlantBaseRight",
              "closetMidDoor1",
              "closetMidDoor2",
              "closetMidDoor3",
              "closetMidDoor4",
              "fridgeBodyLeft",
              "fridgeBodyRight",
            ]);
            const _matteWhiteDoubleSideMat = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              roughness: 1.0,
              metalness: 0.0,
              envMapIntensity: 0,
              side: THREE.FrontSide,
              polygonOffset: true,
              polygonOffsetFactor: 1,
              polygonOffsetUnits: 1,
            });
            const _matteWhiteDoubleSideNames = new Set([
              "fridgeDoorLeft",
              "fridgeDoorRight",
            ]);
            const _applyMatteWhite = (mesh) => {
              if (Array.isArray(mesh.material)) {
                mesh.material = mesh.material.map(() => _matteWhiteMat);
              } else {
                mesh.material = _matteWhiteMat;
              }
            };
            const _isMainLightWhitePaint = (name) => {
              if (name === "lightRailTop") return true;
              const cb = /^lightCubeBase(\d+)$/.exec(name);
              if (cb) {
                const ci = parseInt(cb[1], 10);
                if (ci >= 1 && ci <= 14) return true;
              }
              const mt = /^mainLightTop(\d+)$/.exec(name);
              if (mt) {
                const ti = parseInt(mt[1], 10);
                if (ti >= 1 && ti <= 14) return true;
              }
              return false;
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
            kmodel.traverse((n) => {
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
              if (
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
                          "#include <map_fragment>\ndiffuseColor.rgb *= 1.35;",
                        )
                        .replace(
                          "#include <roughnessmap_fragment>",
                          "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 1.0, 0.6);",
                        );
                    };
                    _barChairWoodMat.customProgramCacheKey = () => "barChairWoodDimmer";
                    const _woodTexDir = KITCHEN_COVER_TEX_DIR + "wood-texture/2K/";
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
              if (_isKitchenTableCoverPlane(n.name)) return;
              if (n.name === "kitchenMainPlate") {
                _stripHorizontalEdgeFaces(n);
                if (Array.isArray(n.material)) {
                  n.material = n.material.map(() => _kitchenMainPlateMat);
                } else {
                  n.material = _kitchenMainPlateMat;
                }
                return;
              }
              if (/^trashPlane\d+$/.test(n.name)) {
                if (TRASH_FX_PLANE_NAMES.includes(n.name)) registerTrashPlane(n);
                return;
              }
              if (n.name === "mainTableBase") {
                n.renderOrder = 0;
                return;
              }
              if (n.name === "mainTablePlate") {
                n.renderOrder = 1;
                if (Array.isArray(n.material)) {
                  n.material = n.material.map(() => _mainTablePlateMat);
                } else {
                  n.material = _mainTablePlateMat;
                }
                n.visible = false;
                return;
              }
              if (n.name === "mainTableSidePannels") {
                if (Array.isArray(n.material)) {
                  n.material = n.material.map(() => _mainTableSidePannelsMat);
                } else {
                  n.material = _mainTableSidePannelsMat;
                }
                return;
              }
              if (n.name === "mainTrash") {
                if (Array.isArray(n.material)) {
                  n.material = n.material.map(() => _mainTrashPaintMat);
                } else {
                  n.material = _mainTrashPaintMat;
                }
                return;
              }
              if (/^binSign\d+$/.test(n.name.replace(/_\d+$/, ""))) {
                if (Array.isArray(n.material)) {
                  n.material = n.material.map(() => _binSign1PlasticMat);
                } else {
                  n.material = _binSign1PlasticMat;
                }
                n.renderOrder = 2;
                addTrashFxOccluder(n); // the trash fires draw the parts behind it before it
                return;
              }
              if (n.name === "coffeeScreen") {
                applyCoffeeScreen(n);
                return;
              }
              if (_blackPlasticMeshNames.has(n.name)) {
                if (Array.isArray(n.material)) {
                  n.material = n.material.map(() => _blackPlasticMat);
                } else {
                  n.material = _blackPlasticMat;
                }
                return;
              }
              if (n.name === "coffeeGrill") {
                const G = KITCHEN_COFFEE_GRILL;
                // Its UVs by its own extent (local x / z: it lies flat): one texture over the whole plate.
                n.geometry = n.geometry.clone();
                n.geometry.computeBoundingBox();
                const bb = n.geometry.boundingBox;
                const w = bb.max.x - bb.min.x, d = bb.max.z - bb.min.z;
                const pos = n.geometry.attributes.position;
                const uv = new Float32Array(pos.count * 2);
                for (let i = 0; i < pos.count; i++) {
                  uv[i * 2] = (pos.getX(i) - bb.min.x) / w;
                  uv[i * 2 + 1] = 1 - (pos.getZ(i) - bb.min.z) / d;
                }
                n.geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
                const tex = makeCoffeeGrillTexture(w, d);
                const bump = tex.clone();
                bump.colorSpace = THREE.NoColorSpace;
                n.material = new THREE.MeshStandardMaterial({
                  color: 0xffffff,
                  map: tex,
                  bumpMap: bump,
                  bumpScale: G.bumpScale,
                  metalness: G.metalness,
                  roughness: G.roughness,
                  envMapIntensity: G.envMapIntensity,
                });
                // Metal needs something to reflect: the scene's environment, or else (no quality tier builds
                // one) its own from the kitchen's neutral gradient.
                if (scene.environment) n.material.envMap = scene.environment;
                else {
                  const src = buildNeutralEnvironmentTexture();
                  n.material.envMap = pmremGenerator.fromEquirectangular(src).texture;
                  src.dispose();
                }
                return;
              }
              if (_chromeMetalMeshNames.has(n.name)) {
                if (Array.isArray(n.material)) {
                  n.material = n.material.map(() => _chromeMetalMat);
                } else {
                  n.material = _chromeMetalMat;
                }
                return;
              }
              if (n.name === "soab1" || n.name === "soab2") {
                const c = KITCHEN_SOAP_PASTEL[n.name];
                const m = new THREE.MeshStandardMaterial({
                  color: c,
                  roughness: KITCHEN_SOAP_PASTEL.roughness,
                  metalness: KITCHEN_SOAP_PASTEL.metalness,
                  envMapIntensity: KITCHEN_SOAP_PASTEL.envMapIntensity,
                  emissive: c,
                  emissiveIntensity: KITCHEN_SOAP_PASTEL.selfLight.dark,
                });
                _kitchenPastelMats.push(m);
                n.material = m;
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
              }
              if (n.name === "waterTapBody") {
                if (Array.isArray(n.material)) {
                  n.material = n.material.map(() => waterTapChromeMat);
                } else {
                  n.material = waterTapChromeMat;
                }
                return;
              }
              if (_matteWhiteDoubleSideNames.has(n.name)) {
                _stripHorizontalEdgeFaces(n);
                n.material = _matteWhiteDoubleSideMat;
                n.renderOrder = 1;
                return;
              }
              if (_matteWhiteMeshNames.has(n.name)) {
                if (
                  n.name === "topPlantBaseLeft" ||
                  n.name === "topPlantBaseRight"
                ) {
                  _stripHorizontalEdgeFaces(n);
                }
                _applyMatteWhite(n);
                return;
              }
              if (_isMainLightWhitePaint(n.name)) {
                _applyMatteWhite(n);
                return;
              }
              if (n.name === "MainNishBackWall") {
                if (Array.isArray(n.material)) {
                  n.material = n.material.map(() => _mainNishBackWallMat);
                } else {
                  n.material = _mainNishBackWallMat;
                }
                return;
              }
              if (n.name === "closetDoors") {
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
              }
              if (Array.isArray(n.material)) {
                n.material = n.material.map(() => _mainGreenWallMat);
              } else {
                n.material = _mainGreenWallMat;
              }
            });

            try {
              const _fridgeGlassMat = new THREE.MeshBasicMaterial({
                color: 0xe8edf2,
                transparent: true,
                opacity: 0.04,
                side: THREE.DoubleSide,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -4,
                polygonOffsetUnits: -4,
              });
              const _fridgeGlassNames = new Set(["fridgeGlassLeft", "fridgeGlassRight"]);
              const _fridgeLightNames = new Set(["fridgeLightLeft", "fridgeLightRight"]);
              kmodel.traverse((n) => {
                if (!n.isMesh) return;
                if (_fridgeGlassNames.has(n.name)) {
                  n.material = _fridgeGlassMat;
                  n.frustumCulled = false;
                  n.renderOrder = 3;
                  n.translateZ(0.05);
                  n.visible = false;
                  return;
                }
                if (_fridgeLightNames.has(n.name)) {
                  const mat = new THREE.MeshStandardMaterial({
                    color: 0xffffff,
                    emissive: 0xffffff,
                    emissiveIntensity: 10,
                    roughness: 0.5,
                    metalness: 0.0,
                  });
                  n.material = mat;
                  _peselLightMeshes.push({
                    mesh: n,
                    darkIntensity: 10,
                    brightIntensity: 4,
                  });
                  n.updateMatrixWorld(true);
                  const lightBox = new THREE.Box3().setFromObject(n);
                  const lightCenter = lightBox.getCenter(new THREE.Vector3());
                  const lightSize = lightBox.getSize(new THREE.Vector3());
                  const stripAlongX = lightSize.x >= lightSize.z;
                  const stripLen = Math.max(stripAlongX ? lightSize.x : lightSize.z, 0.2) + 0.06;
                  const stripThick = Math.max(stripAlongX ? lightSize.z : lightSize.x, 0.05) + 0.03;
                  const fridgeRect = new THREE.RectAreaLight(0xffffff, 0, stripLen, stripThick);
                  fridgeRect.position.set(lightCenter.x, lightBox.min.y - 0.02, lightCenter.z);
                  fridgeRect.rotation.set(-Math.PI / 2, stripAlongX ? 0 : Math.PI / 2, 0);
                  fridgeRect.name = n.name + "_rect";
                  scene.add(fridgeRect);
                  _shelfDownLights.push({
                    light: fridgeRect,
                    darkIntensity: 0,
                    brightIntensity: 0,
                  });
                }
              });
              try { applyLightBlend(lightBlend); } catch (e) {}
            } catch (e) {
              console.warn("Failed to set up fridge materials:", e);
            }

            let kitchenFloorMesh = null;
            kmodel.traverse((n) => {
              if (n.isMesh && n.name === "floor") kitchenFloorMesh = n;
            });
            if (kitchenFloorMesh) {
              kitchenFloorMesh.updateMatrixWorld(true);
              const _floorBox = new THREE.Box3().setFromObject(kitchenFloorMesh);
              const _floorSize = _floorBox.getSize(new THREE.Vector3());
              const _kitchenFloorTex = createKitchenFloorBaseTexture();
              _kitchenFloorTex.repeat.set(
                Math.max(1, _floorSize.x / 5),
                Math.max(1, _floorSize.z / 5),
              );
              _kitchenFloorTex.anisotropy = Math.min(
                8,
                renderer.capabilities.getMaxAnisotropy(),
              );
              _kitchenFloorMat = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                map: _kitchenFloorTex,
                roughness: 0.88,
                metalness: 0.0,
                emissive: 0xe8e4de,
                emissiveIntensity: 0,
              });
              kitchenFloorMesh.material = _kitchenFloorMat;
              try {
                applyLightBlend(lightBlend);
              } catch (e) {}
              scatterKitchenFloorStripes(kitchenFloorMesh, kmodel);
              setupFloorPhysics(kmodel);
            }

            // Group barChairPlastic + barChairWood, clone 4 times along X.
            let barChairPlastic = null;
            let barChairWood = null;
            kmodel.traverse((n) => {
              if (n.name === "barChairPlastic") barChairPlastic = n;
              if (n.name === "barChairWood") barChairWood = n;
            });
            if (barChairPlastic && barChairWood) {
              const _chairParent = barChairPlastic.parent || kmodel;
              const _barChairGroup = new THREE.Group();
              _barChairGroup.name = "barChairGroup0";
              barChairPlastic.updateMatrixWorld(true);
              barChairWood.updateMatrixWorld(true);
              const _chairCenter = new THREE.Vector3();
              const _chairBox = new THREE.Box3();
              _chairBox.setFromObject(barChairPlastic);
              _chairBox.expandByObject(barChairWood);
              const _chairSize = _chairBox.getSize(new THREE.Vector3());
              _chairBox.getCenter(_chairCenter);
              _chairParent.worldToLocal(_chairCenter);
              _barChairGroup.position.copy(_chairCenter);
              _chairParent.add(_barChairGroup);
              const _origPlasticPos = barChairPlastic.position.clone();
              const _origWoodPos = barChairWood.position.clone();
              _chairParent.remove(barChairPlastic);
              _chairParent.remove(barChairWood);
              barChairPlastic.position.copy(_origPlasticPos).sub(_chairCenter);
              barChairWood.position.copy(_origWoodPos).sub(_chairCenter);
              _barChairGroup.add(barChairPlastic);
              _barChairGroup.add(barChairWood);
              const _chairSpan =
                _chairSize.x > _chairSize.z ? _chairSize.x : _chairSize.z;
              const _chairGap = _chairSpan * 0.3;
              const _stepChairX = _chairSpan + _chairGap;
              const _chairClones = 6;
              for (let i = 1; i <= _chairClones; i++) {
                const _chairClone = _barChairGroup.clone(true);
                _chairClone.name = "barChairGroup_clone_" + i;
                _chairClone.position.copy(_barChairGroup.position);
                _chairClone.position.x += _stepChairX * i;
                _chairParent.add(_chairClone);
              }
            }

            if (kitchenPlatePhysic) kitchenPlatePhysic.visible = false;
            tablePlateMesh = surfaceMesh;
            _cachedTablePlaySurfaceY = null;
            surfaceMesh.updateMatrixWorld(true);
            const tBox = new THREE.Box3().setFromObject(surfaceMesh);
            const tSize = tBox.getSize(new THREE.Vector3());
            const tCenter = tBox.getCenter(new THREE.Vector3());
            const tTopY = tBox.max.y;
            console.log("Kitchen table:", { center: tCenter, size: tSize, topY: tTopY });
            tableSurfaceY = tTopY;
            tablePlateHalfX = tSize.x / 2;
            tablePlateHalfZ = tSize.z / 2;
            tablePlateCenter.set(tCenter.x, tTopY, tCenter.z);
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
            _darkModeOnlyLights.push(magentaGamingKey);
            const plateThickness = 0.5;
            tablePlateBody = new CANNON.Body({
              type: CANNON.Body.STATIC,
              position: new CANNON.Vec3(tCenter.x, tTopY - plateThickness / 2, tCenter.z),
              material: tablePlatePhysicsMaterial,
              collisionFilterGroup: 1,
              collisionFilterMask: -1,
            });
            tablePlateBody.addShape(
              new CANNON.Box(new CANNON.Vec3(tSize.x / 2, plateThickness / 2, tSize.z / 2)),
            );
            physicsWorld.addBody(tablePlateBody);
            applyGreyBoxMaterials(kmodel);
            applyCupMaterials(kmodel);
            buildCupPyramid(kmodel);
            rotateKitchenGreyBox(kmodel);
            setupKitchenPropPhysics(kmodel);
            buildKitchenRaceBoundaries(kmodel);
            setupKitchenFood();
            // Milk cartons on the fridges' shelves (static, behind the glass doors; see kitchenMilkCartons.js).
            if (!_milkCartons) {
              try {
                _milkCartons = createMilkCartons({
                  THREE,
                  scene,
                  renderer,
                  fridgeMeshes: [kmodel.getObjectByName("fridgeBodyLeft"), kmodel.getObjectByName("fridgeBodyRight")],
                });
                const report = _milkCartons.check();
                if (report.issues.length) console.warn("Milk cartons:", report.issues);
              } catch (e) {
                console.warn("Failed to set up the milk cartons:", e);
              }
            }
            // Glass jars in rows on the shelves under the top closets (see kitchenShelfJars.js).
            if (!_shelfJars) {
              try {
                let env = scene.environment;
                let ownEnv = false;
                if (!env) {
                  // No quality tier builds one: their own, a soft-boxed room (three's RoomEnvironment), so the glass
                  // has bright windows and panels to reflect (the neutral gradient left it nearly invisible).
                  const room = new RoomEnvironment();
                  env = pmremGenerator.fromScene(room, 0.04).texture;
                  room.traverse((o) => {
                    if (o.geometry) o.geometry.dispose();
                    if (o.material) o.material.dispose();
                  });
                  ownEnv = true;
                }
                // The lids keep their reflection from the kitchen's neutral gradient (as before the glass changed).
                let lidEnv = scene.environment;
                if (!lidEnv) {
                  const src = buildNeutralEnvironmentTexture();
                  lidEnv = pmremGenerator.fromEquirectangular(src).texture;
                  src.dispose();
                }
                _shelfJars = createShelfJars({
                  THREE,
                  root: kmodel,
                  envMap: env,
                  lidEnvMap: lidEnv,
                  ownsEnvMap: ownEnv,
                  highQuality: useVisualParity(),
                });
                const report = _shelfJars.check();
                if (report.issues.length) console.warn("Shelf jars:", report.issues);
              } catch (e) {
                console.warn("Failed to set up the shelf jars:", e);
              }
            }
            // Stacks of nested plastic cups on the left closet's lower shelf (see kitchenCupStacks.js); before the plants,
            // which must not enter them either.
            if (!_cupStacks) {
              try {
                _cupStacks = createCupStacks({ THREE, root: kmodel });
                _kitchenPastelMats.push(..._cupStacks.pastelMaterials); // the pastel self-light, with the dark / bright mode
                const report = _cupStacks.check();
                if (report.issues.length) console.warn("Cup stacks:", report.issues);
              } catch (e) {
                console.warn("Failed to set up the cup stacks:", e);
              }
            }
            // Trailing plants hanging from the top planters (see kitchenTrailingPlants.js); after the shelf jars, which
            // they must not enter.
            if (!_trailingPlants) {
              try {
                _trailingPlants = createTrailingPlants({ THREE, root: kmodel, leafUrl: officeAsset("leaf.png") });
                kmodel.add(_trailingPlants.group);
              } catch (e) {
                console.warn("Failed to set up the trailing plants:", e);
              }
            }
            // The start lights on the table (see kitchenStartLights.js): materials, lit by the countdown.
            if (!_startLights) {
              try {
                _startLights = createStartLights({ THREE, root: kmodel });
                // The lamps' reflections are part of the table top's own surface (its material's shader); attached
                // here, or when the table top is set up if that comes later.
                if (_kitchenCoverTopMesh) _startLights.attachTableReflection(_kitchenCoverTopMesh.material);
              } catch (e) {
                console.warn("Failed to set up the start lights:", e);
              }
            }
            // The race-time LED board on the start lights (see kitchenCounterScreen.js).
            if (!_counterScreen) {
              const screen = kmodel.getObjectByName("counterScreen");
              if (screen && screen.isMesh) {
                try {
                  _counterScreen = createCounterScreen({ THREE, mesh: screen });
                } catch (e) {
                  console.warn("Failed to set up the race-time screen:", e);
                }
              } else console.warn("Race-time screen: counterScreen not found");
            }
            // Paper napkins flying out of the paper dispenser (see kitchenNapkins.js).
            if (!_kitchenNapkins) {
              try {
                const dispenser = kmodel.getObjectByName("paperDispencer");
                if (dispenser && dispenser.isMesh) {
                  _kitchenNapkins = createKitchenNapkins({
                    THREE,
                    scene,
                    root: kmodel,
                    dispenser,
                    // Moving objects the napkins must not fly through and never land on.
                    getMovers: () => {
                      const list = [];
                      if (car) list.push(car);
                      for (const rc of _raceCars) if (rc.root) list.push(rc.root);
                      if (_misterSpot && _misterSpot.object) list.push(_misterSpot.object);
                      if (_milkCartons) list.push(..._milkCartons.meshes);
                      for (const o of scene.children) if (o.name === "kitchenFood") list.push(o);
                      return list;
                    },
                  });
                  if (!_kitchenNapkins) console.warn("Napkins: no recess found in paperDispencer");
                }
              } catch (e) {
                console.warn("Failed to set up the napkins:", e);
              }
            }
            setupKitchenRamp(kmodel, tablePlatePhysicsMaterial);
            _raceModel = kmodel;

            const shadowPlaneGeo = new THREE.PlaneGeometry(tSize.x * 1.5, tSize.z * 1.5);
            // No depth writes: this invisible plane sits at table height but
            // extends past the table; writing depth it hid floor-level effects
            // (e.g. Mister Spot's trail) seen through it from above.
            const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.35, depthWrite: false });
            carShadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
            carShadowPlane.rotation.x = -Math.PI / 2;
            carShadowPlane.position.set(tCenter.x, tTopY + 0.05, tCenter.z);
            carShadowPlane.receiveShadow = true;
            carShadowPlane.renderOrder = 2;
            scene.add(carShadowPlane);

            // Place car on the kitchen table, lifting it so its wheels rest on top.
            const _carBottomOff = (typeof carBottomOffsetY === "number" && carBottomOffsetY > 0)
              ? carBottomOffsetY
              : 0.05;
            // Shifted along the table so the car doesn't start inside greyBox
            // (it sits on the table centre); also used for respawns.
            tableSpawn.set(tCenter.x + KITCHEN_CAR_SPAWN_OFFSET_X, tTopY + _carBottomOff, tCenter.z);
            tableMinY = tTopY + Math.max(0.05, _carBottomOff * 0.5);
            car.position.copy(tableSpawn);
            car.rotation.set(0, 0, 0);
            car.updateMatrixWorld(true);

            // After spawn, lift further if wheels are still below the surface (safety).
            try {
              const wheels = [
                typeof wheelFL !== "undefined" ? wheelFL : null,
                typeof wheelFR !== "undefined" ? wheelFR : null,
                typeof wheelRL !== "undefined" ? wheelRL : null,
                typeof wheelRR !== "undefined" ? wheelRR : null,
              ];
              let lowestWheelBottom = Infinity;
              const _wp = new THREE.Vector3();
              for (const w of wheels) {
                if (!w || !w._physRadius || !w._canonMesh) continue;
                w._canonMesh.getWorldPosition(_wp);
                const bottom = _wp.y - w._physRadius;
                if (bottom < lowestWheelBottom) lowestWheelBottom = bottom;
              }
              if (Number.isFinite(lowestWheelBottom) && lowestWheelBottom < tTopY) {
                const lift = tTopY - lowestWheelBottom;
                car.position.y += lift;
                tableSpawn.y = car.position.y;
                tableMinY = tTopY + Math.max(0.05, (car.position.y - tTopY) * 0.5);
                car.updateMatrixWorld(true);
              }
            } catch (e) {}

            // Sync the kinematic wheel/body cannon bodies immediately to the new car pose.
            try {
              const _wp = new THREE.Vector3();
              const _wq = new THREE.Quaternion();
              const wheelBodies = [
                { mesh: typeof canonFL !== "undefined" ? canonFL : null, body: typeof canonFLBody !== "undefined" ? canonFLBody : null },
                { mesh: typeof canonFR !== "undefined" ? canonFR : null, body: typeof canonFRBody !== "undefined" ? canonFRBody : null },
                { mesh: typeof canonRL !== "undefined" ? canonRL : null, body: typeof canonRLBody !== "undefined" ? canonRLBody : null },
                { mesh: typeof canonRR !== "undefined" ? canonRR : null, body: typeof canonRRBody !== "undefined" ? canonRRBody : null },
              ];
              for (const wb of wheelBodies) {
                if (!wb.mesh || !wb.body) continue;
                wb.mesh.getWorldPosition(_wp);
                wb.mesh.getWorldQuaternion(_wq);
                wb.body.position.set(_wp.x, _wp.y, _wp.z);
                wb.body.quaternion.set(_wq.x, _wq.y, _wq.z, _wq.w);
                wb.body.velocity.set(0, 0, 0);
                wb.body.angularVelocity.set(0, 0, 0);
              }
              if (typeof canonBodyMesh !== "undefined" && canonBodyMesh && typeof canonBodyPhys !== "undefined" && canonBodyPhys) {
                const cbBox = new THREE.Box3().setFromObject(canonBodyMesh);
                const cbCenter = cbBox.getCenter(new THREE.Vector3());
                canonBodyMesh.getWorldQuaternion(_wq);
                canonBodyPhys.position.set(cbCenter.x, cbCenter.y, cbCenter.z);
                canonBodyPhys.quaternion.set(_wq.x, _wq.y, _wq.z, _wq.w);
                canonBodyPhys.velocity.set(0, 0, 0);
                canonBodyPhys.angularVelocity.set(0, 0, 0);
                _bumperPrevValid = false; // respawn teleport: no fake bumper speed
              }
            } catch (e) {}

            try {
              getCarCameraLookAtPoint(_carMatrixLookAt);
              placeCarViewCameras(
                _carMatrixLookAt,
                Math.max(tSize.x, tSize.y, tSize.z, 8),
              );
              syncCarCameraYawTracking();
              if (camera === carCamera) {
                getCarCameraLookAtPoint(_carMatrixLookAt);
                controls.target.copy(_carMatrixLookAt);
                syncCarOrbitCamAnglesFromPosition(carCamera);
                configureOrbitControlsForCarView(carCamera);
              } else if (camera === carCameraFollow) {
                controls.target.copy(_carMatrixLookAt);
                syncCarFollowCamAnglesFromPosition(carCameraFollow);
                configureOrbitControlsForCarView(carCameraFollow);
              }
            } catch (e) {}

            // peselLight1..34 + shelfLiight1..3 — emissive white pixels.
            // Strong + bloomed in dark mode, normal white in bright mode.
            try {
              // peselBlue/Green are nearly black in the model, so lift each
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
              const _applyPeselStyleLight = (mesh) => {
                const mat = new THREE.MeshStandardMaterial({
                  color: 0xffffff,
                  emissive: 0xffffff,
                  emissiveIntensity: 1.25,
                  roughness: 0.5,
                  metalness: 0.0,
                });
                mesh.material = mat;
                mesh.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
                _peselLightMeshes.push({
                  mesh: mesh,
                  darkIntensity: 1.25,
                  brightIntensity: 1,
                });
              };
              kmodel.traverse((n) => {
                if (!n.isMesh) return;
                const peselMatch = /^peselLight(\d+)$/.exec(n.name);
                if (peselMatch) {
                  const idx = parseInt(peselMatch[1], 10);
                  if (idx >= 1 && idx <= 34) {
                    _applyPeselStyleLight(n);
                    peselBloom.addMesh(n); // their own soft, stable glow (PESEL_BLOOM)
                  }
                  return;
                }
                // A multi-material panel arrives as suffixed meshes (peselPink_1).
                if (_peselColorPanelNames.has(n.name.replace(/_\d+$/, ""))) {
                  _applyPeselColorPanel(n);
                  return;
                }
                const shelfMatch = /^shelfLiight(\d+)$/.exec(n.name);
                if (shelfMatch) {
                  const idx = parseInt(shelfMatch[1], 10);
                  if (idx >= 1 && idx <= 3) _applyPeselStyleLight(n);
                }
              });
            } catch (e) {
              console.warn("Failed to set up pesel/shelf light emissive material:", e);
            }

            const _meshAcceptsShelfDownReflection = (name) => {
              return (
                name === "MainNishBackWallPlate" ||
                name === "MainNishBackWallPlate_instanced" ||
                name.startsWith("MainNishBackWallPlate_clone")
              );
            };
            const _shelfReflectWhite = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              roughness: 0.16,
              metalness: 0.12,
              envMapIntensity: 1.35,
            });
            const _shelfReflectRose = new THREE.MeshStandardMaterial({
              color: 0xb7797e,
              roughness: 0.16,
              metalness: 0.12,
              envMapIntensity: 1.35,
            });
            const _shelfReflectSlate = new THREE.MeshStandardMaterial({
              color: 0x5a7f96,
              roughness: 0.16,
              metalness: 0.12,
              envMapIntensity: 1.35,
            });
            const _shelfReflectTan = new THREE.MeshStandardMaterial({
              color: 0xedd0b0,
              roughness: 0.16,
              metalness: 0.12,
              envMapIntensity: 1.35,
            });
            if (scene.environment) {
              _shelfReflectWhite.envMap = scene.environment;
              _shelfReflectRose.envMap = scene.environment;
              _shelfReflectSlate.envMap = scene.environment;
              _shelfReflectTan.envMap = scene.environment;
            }
            const _shelfReflectMatForName = (name) => {
              if (
                name === "MainNishBackWallPlate" ||
                name === "MainNishBackWallPlate_instanced" ||
                name.startsWith("MainNishBackWallPlate_clone")
              ) {
                return _shelfReflectSlate;
              }
              return _shelfReflectWhite;
            };
            try {
              kmodel.traverse((n) => {
                if (
                  (!n.isMesh && !n.isInstancedMesh) ||
                  !_meshAcceptsShelfDownReflection(n.name)
                ) {
                  return;
                }
                if (Array.isArray(n.material)) return;
                n.material = _shelfReflectMatForName(n.name);
              });
            } catch (e) {
              console.warn("Failed to set up shelf reflection materials:", e);
            }

            if (mainNishBackWallPlateMesh && _coverCloneStepX != null) {
              const _basePlateXClones = KITCHEN_TABLE_COVER_CLONES - 17;
              const _nishBackWallPlateClones = _basePlateXClones + 22;
              buildKitchenNishPlateInstances(
                mainNishBackWallPlateMesh,
                mainNishBackWallPlateMesh.parent || kmodel,
                _coverCloneStepX,
                _nishBackWallPlateClones,
                _shelfReflectSlate,
              );
              try {
                // Mask the plates behind the listed parts, along the wall's normal
                // (the plate's thinnest axis, pointing into the room).
                const _maskParts = [];
                kmodel.traverse((n) => {
                  if (n.isMesh && KITCHEN_NISH_MASK_PARTS.includes(n.name)) _maskParts.push(n);
                });
                const g = mainNishBackWallPlateMesh.geometry;
                if (!g.boundingBox) g.computeBoundingBox();
                const gs = g.boundingBox.getSize(new THREE.Vector3());
                const wallNormal = new THREE.Vector3(
                  gs.x <= gs.y && gs.x <= gs.z ? 1 : 0,
                  gs.y < gs.x && gs.y <= gs.z ? 1 : 0,
                  gs.z < gs.x && gs.z < gs.y ? 1 : 0,
                ).transformDirection(mainNishBackWallPlateMesh.matrixWorld);
                if (_maskParts.length) {
                  const wallPos = mainNishBackWallPlateMesh.getWorldPosition(new THREE.Vector3());
                  const partPos = new THREE.Box3().setFromObject(_maskParts[0]).getCenter(new THREE.Vector3());
                  if (partPos.sub(wallPos).dot(wallNormal) < 0) wallNormal.negate();
                }
                applyKitchenNishMask(_shelfReflectSlate, renderKitchenNishMask(_maskParts, wallNormal));
              } catch (e) {
                console.warn("Failed to mask wall plates behind parts:", e);
              }
            }

            if (kitchenPlate) {
              kitchenPlate.visible = true;
              kitchenPlate.material = _mainTablePlateMat;
            }
            kmodel.traverse((n) => {
              if (n.isMesh && n.name === "kitchenMainPlate") {
                n.material = _kitchenMainPlateMat;
              }
            });

            // shelfLiight1..3 — strip RectAreaLights (-Y), sized to each emissive mesh.
            try {
              const _stripPad = 0.06;
              for (let si = 1; si <= 3; si++) {
                const shelfMesh = _kitchenMeshByName.get("shelfLiight" + si);
                if (!shelfMesh) continue;
                shelfMesh.updateMatrixWorld(true);
                const shelfBox = new THREE.Box3().setFromObject(shelfMesh);
                const shelfCenter = shelfBox.getCenter(new THREE.Vector3());
                const shelfSize = shelfBox.getSize(new THREE.Vector3());
                const stripAlongX = shelfSize.x >= shelfSize.z;
                const stripLen =
                  Math.max(stripAlongX ? shelfSize.x : shelfSize.z, 0.35) +
                  _stripPad;
                const stripThick =
                  Math.max(stripAlongX ? shelfSize.z : shelfSize.x, 0.05) +
                  _stripPad * 0.5;
                const rect = new THREE.RectAreaLight(
                  0xffffff,
                  0,
                  stripLen,
                  stripThick,
                );
                rect.position.set(
                  shelfCenter.x,
                  shelfBox.min.y - 0.02,
                  shelfCenter.z,
                );
                if (stripAlongX) {
                  rect.rotation.set(-Math.PI / 2, 0, 0);
                } else {
                  rect.rotation.set(-Math.PI / 2, Math.PI / 2, 0);
                }
                rect.name = "shelfLiight" + si + "DownRect";
                scene.add(rect);
                _shelfDownLights.push({
                  light: rect,
                  darkIntensity: 12,
                  brightIntensity: 2.5,
                });
              }
              try { applyLightBlend(lightBlend); } catch (e) {}
            } catch (e) {
              console.warn("Failed to set up shelfLiight strip area lights:", e);
            }

            // mainLightTop1..14 — downward spots (-Y) to floor (~45 units below fixtures).
            try {
              let kitchenFloorTopY = 0;
              const floorMeshForLights = _kitchenMeshByName.get("floor");
              if (floorMeshForLights) {
                floorMeshForLights.updateMatrixWorld(true);
                kitchenFloorTopY = new THREE.Box3()
                  .setFromObject(floorMeshForLights)
                  .max.y;
              }
              const _bulbGeo = new THREE.SphereGeometry(0.18, 8, 6);
              const _bulbMat = new THREE.MeshBasicMaterial({ color: 0x9eeaff });
              for (let mi = 1; mi <= 14; mi += 2) {
                const topMesh = _kitchenMeshByName.get("mainLightTop" + mi);
                if (!topMesh) continue;
                topMesh.updateMatrixWorld(true);
                const topBox = new THREE.Box3().setFromObject(topMesh);
                const topCenter = topBox.getCenter(new THREE.Vector3());
                const srcY = topBox.min.y - 0.06;
                const floorY = kitchenFloorTopY + 0.15;
                const sp = new THREE.SpotLight(
                  0xb8d8ff,
                  0,
                  0,
                  Math.PI / 2.4,
                  0.65,
                  1.6,
                );
                sp.castShadow = false;
                sp.position.set(topCenter.x, srcY, topCenter.z);
                sp.target.position.set(topCenter.x, floorY, topCenter.z);
                sp.name = "mainLightTop" + mi + "DownSpot";
                scene.add(sp);
                scene.add(sp.target);
                const bulb = new THREE.Mesh(_bulbGeo, _bulbMat);
                bulb.position.set(topCenter.x, srcY, topCenter.z);
                bulb.name = "mainLightTop" + mi + "Bulb";
                scene.add(bulb);
                _mainLightDownPoints.push({
                  light: sp,
                  bulb,
                  darkIntensity: 3,
                  brightIntensity: 14,
                  darkAngle: Math.PI / 2.1,
                  brightAngle: Math.PI / 3.4,
                  darkPenumbra: 0.78,
                  brightPenumbra: 0.42,
                });
              }
              try { applyLightBlend(lightBlend); } catch (e) {}
            } catch (e) {
              console.warn("Failed to set up mainLightTop downward spot lights:", e);
            }

            // Lamp1..6 — purple SpotLights pointing down at the table surface,
            // same mechanism as mainLightTop1..14.
            try {
              _kitchenLampSources.length = 0;
              const _kitchenLampMat = new THREE.MeshStandardMaterial({
                color: 0xe7684e,
                metalness: 0.82,
                roughness: 0.48,
                envMapIntensity: 1.15,
                emissive: 0xe7684e,
                emissiveIntensity: 0.2,
              });
              if (scene.environment) {
                _kitchenLampMat.envMap = scene.environment;
              }

              for (let li = 1; li <= 6; li++) {
                const lampMesh = _kitchenMeshByName.get("lamp" + li);
                if (!lampMesh) continue;
                lampMesh.traverse((n) => {
                  if (n.isMesh) n.material = _kitchenLampMat;
                });
                lampMesh.updateMatrixWorld(true);
                const lampBox = new THREE.Box3().setFromObject(lampMesh);
                const lampCenter = lampBox.getCenter(new THREE.Vector3());
                _kitchenLampSources.push({
                  x: lampCenter.x,
                  y: lampBox.min.y,
                  z: lampCenter.z,
                });
                const lampLightColor = li % 2 === 1 ? 0xff2bbd : 0x22dfff;
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
                }
              }
              _syncKitchenLampShaderUniforms();
            } catch (e) { console.warn("Failed to set up kitchen lamps:", e); }

            const _waterTapBodyMesh = _kitchenMeshByName.get("waterTapBody");
            if (_waterTapBodyMesh) {
              applySceneEnvironmentToMaterial(waterTapChromeMat);
              _waterTapBodyMesh.material = waterTapChromeMat;
            }

            carFalling = false;
            carFloorTimer = 0;
            stopKitchenCarTumble();
            try { _rampLeftJumpActive = false; _rampJumpMatrixActive = false; _rampJumpMatrixOrbitProgress = 0; _rampJumpFxBlend = 0; _rampJumpFxIn = 0; _carCam1JumpEffect = 0; _carCam1LandShakeTime = 0; _rampJumpCamRestOffset.set(0, 0, 0); jumpInitialVelY = 0; } catch (e) {}
            try { _legacyDarkLightsScale = 0.48; applyDarkModePreset(_darkModeKitchen); } catch (e) {}
            try { setKitchenPerfMode(true); } catch (e) {}
            try { applyLightBlend(lightBlend); } catch (e) {}
            try { scheduleRebuildBloomDarkenLists && scheduleRebuildBloomDarkenLists(); } catch (e) {}
            console.log("Switched to kitchen world. car at", car.position, "tableMinY:", tableMinY, "tablePlateHalfX:", tablePlateHalfX, "tablePlateHalfZ:", tablePlateHalfZ);
            };

            (async () => {
              const planeInfo = applyKitchenTableCoverPlanes(
                kmodel,
                _kitchenMeshByName,
              );
              let topMat = null;
              let sideMat = null;
              let baseMat = null;
              try {
                const mats = await createKitchenTableCoverMaterials(
                  planeInfo.topRepX,
                  planeInfo.topRepY,
                  planeInfo.sideRepX,
                  planeInfo.sideRepY,
                );
                topMat = mats.topMat;
                sideMat = mats.sideMat;
                baseMat = mats.baseMat;
                _coverCloneStepX = planeInfo.coverCloneStepX;
              } catch (e) {
                console.warn("Kitchen table cover PBR failed:", e);
                topMat = new THREE.MeshStandardMaterial({
                  color: 0xf2f2f2,
                  roughness: 0.62,
                  metalness: 0,
                  envMapIntensity: 0.35,
                  side: THREE.DoubleSide,
                });
                if (scene.environment) topMat.envMap = scene.environment;
                sideMat = topMat;
                baseMat = new THREE.MeshStandardMaterial({ color: 0xe6c3bd, roughness: 0.8, metalness: 0 });
                _coverCloneStepX = planeInfo.coverCloneStepX;
              }
              _tableCoverLampMat = topMat;
              _kitchenTableCoverLampMat = topMat;
              _kitchenTableCoverSideMat = sideMat;
              if (lightBlend > 0) applyLightBlend(lightBlend); // already (partly) bright: its bright colour now
              if (!_worldSwitched || loadToken !== _kitchenLoadToken) return;
              _finishKitchenWorldSetup();
              if (baseMat && mainTableBaseMesh) {
                const vts = planeInfo.visualTileWorldSize || 1;
                fitKitchenBaseUvsWorld(mainTableBaseMesh, vts);
                mainTableBaseMesh.material = baseMat;
                mainTableBaseMesh.visible = true;
              }
              if (topMat && sideMat) {
                bindKitchenTableCoverPlanes(planeInfo, topMat, sideMat);
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
                }
                ensureKitchenCoverPlanesVisible(planeInfo);
                attachKitchenTableTopLampOverlay(planeInfo.topPlane);
                updateKitchenLampCoverShader(1 - lightBlend);
                try { applyLightBlend(lightBlend); } catch (e) {}
                scheduleRectAreaLightingSweeps();
                skipFrontObjectsInTransmission(); // performance: the glass jars' refraction pass (see the function)
                _kitchenSceneReady = true;
              }
            })();
          },
          undefined,
          (err) => {
            console.error("Failed to load ul-kitchen28.glb:", err);
            _worldSwitched = false;
          },
        );
      }

      function switchToKitchenWorld() {
        _worldSwitched = true;
        try {
          disposeCurrentWorld();
        } catch (e) {
          console.warn("disposeCurrentWorld failed:", e);
        }
        loadKitchenWorld();
      }

      const loader = new GLTFLoader();

      function loadCarGameThenKitchen() {
        const tableCenter = new THREE.Vector3(0, 0, 0);
        let tableTopY = 0;
        const tableMinSize = 8;
        tableSurfaceY = 0;
        loader.setResourcePath(_OFFICE_BASE);
        loader.load(
          officeAsset("car-game14.glb"),
          (carGltf) => {

        const carScene = carGltf.scene;
        const carAirInChromeMat = new THREE.MeshPhysicalMaterial({
          color: 0xc8ccd0,
          metalness: 0.9,
          roughness: 0.14,
          clearcoat: 1.0,
          clearcoatRoughness: 0.06,
          envMapIntensity: 4.0,
          emissive: 0x707478,
          emissiveIntensity: 0.08,
        });
        applySceneEnvironmentToMaterial(carAirInChromeMat);
        const carAirInRedPaintMat = new THREE.MeshPhysicalMaterial({
          color: 0xc8102e,
          metalness: 0.4,
          roughness: 0.22,
          clearcoat: 1.0,
          clearcoatRoughness: 0.06,
          envMapIntensity: 1.0,
        });
        applySceneEnvironmentToMaterial(carAirInRedPaintMat);
        carScene.visible = true;
        carScene.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = false;
            enableMeshCastShadow(node, "both");
            node.visible = true;
            if (node.name === "mainRearBrakeLights") {
              node._brakeMat = new THREE.MeshStandardMaterial({
                color: 0xff0000,
                emissive: 0xff0000,
                emissiveIntensity: 8.0,
                metalness: 0,
                roughness: 0.2,
              });
              node._offMat = node.material.clone();
              node._offMat.emissive = new THREE.Color(0x440000);
              node._offMat.emissiveIntensity = 1.1;
              node.material = node._offMat;
              car.userData.brakeLightMesh = node;
            }
            if (node.name === "lightBar1") {
              node.material = new THREE.MeshStandardMaterial({
                color: 0xff0000,
                emissive: 0xff0000,
                emissiveIntensity: 18.0,
                metalness: 0,
                roughness: 0.15,
              });
            }
            if (node.name === "frontLights") {
              node.material = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                emissive: 0xffffff,
                emissiveIntensity: 6.5,
                metalness: 0,
                roughness: 0.3,
                side: THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: -2,
                polygonOffsetUnits: -2,
              });
              node.renderOrder = 3;
            }
            if (node.name === "rearLights") {
              node.material = new THREE.MeshStandardMaterial({
                color: 0xff0000,
                emissive: 0xff0000,
                emissiveIntensity: 2.0,
                metalness: 0,
                roughness: 0.3,
              });
            }
            if (
              node.name === "frontLightCase" ||
              node.name === "rearLightCase"
            ) {
              node.material = new THREE.MeshStandardMaterial({
                color: 0x111111,
                metalness: 0,
                roughness: 0.7,
              });
            }
            if (node.name === "egzoz") {
              node.material = new THREE.MeshStandardMaterial({
                color: 0xcccccc,
                metalness: 1.0,
                roughness: 0.05,
                envMapIntensity: 1.5,
              });
            }
            if (node.name === "airInBase") {
              node.material = carAirInChromeMat;
            }
            if (
              node.name === "airIn1" ||
              node.name === "airIn2" ||
              node.name === "airIn3"
            ) {
              node.material = carAirInRedPaintMat;
            }
          }
        });

        const _lbBody = carScene.getObjectByName("lightBarBody1");
        const _lbLight = carScene.getObjectByName("lightBar1");
        if (_lbBody && _lbLight) {
          const _lbParent = _lbBody.parent;
          const _lbGroup = new THREE.Group();
          _lbGroup.name = "lightBarGroup0";
          _lbBody.updateMatrixWorld(true);
          _lbLight.updateMatrixWorld(true);
          const _lbCenter = new THREE.Vector3();
          const _lbBox = new THREE.Box3();
          _lbBox.setFromObject(_lbBody);
          _lbBox.expandByObject(_lbLight);
          _lbBox.getCenter(_lbCenter);
          _lbParent.worldToLocal(_lbCenter);
          _lbGroup.position.copy(_lbCenter);
          _lbParent.add(_lbGroup);
          const _origBodyPos = _lbBody.position.clone().sub(_lbCenter);
          const _origLightPos = _lbLight.position
            .clone()
            .sub(_lbCenter);
          _lbParent.remove(_lbBody);
          _lbParent.remove(_lbLight);
          _lbBody.position.copy(_origBodyPos);
          _lbLight.position.copy(_origLightPos);
          _lbGroup.add(_lbBody);
          _lbGroup.add(_lbLight);

          const _lbSize = _lbBox.getSize(new THREE.Vector3());
          const _lbSpacing =
            _lbSize.x > _lbSize.z ? _lbSize.x : _lbSize.z;
          for (let side = -1; side <= 1; side += 2) {
            for (let i = 1; i <= 2; i++) {
              const clone = _lbGroup.clone(true);
              clone.name = "lightBarGroup_" + side + "_" + i;
              clone.position.copy(_lbGroup.position);
              clone.position.x += side * i * _lbSpacing * 1.6;
              _lbParent.add(clone);
            }
          }
        }

        car.add(carScene);
        setupExhaustEffects(carScene);
        setupTableLightReflections(car);
        car.visible = true;
        car.updateMatrixWorld(true);
        const _carBoxNorm = new THREE.Box3().setFromObject(car);
        const sizeNorm = _carBoxNorm.getSize(new THREE.Vector3());
        const targetLength = 2.4;
        const normScale = targetLength / Math.max(0.01, sizeNorm.z);
        carScene.scale.multiplyScalar(normScale);
        car.updateMatrixWorld(true);
        _carBoxNorm.setFromObject(car);
        const centerNorm = _carBoxNorm.getCenter(new THREE.Vector3());
        carScene.position.sub(centerNorm);
        car.updateMatrixWorld(true);
        _carBoxNorm.setFromObject(car);
        const sizeX = _carBoxNorm.max.x - _carBoxNorm.min.x;
        const sizeY = _carBoxNorm.max.y - _carBoxNorm.min.y;
        const sizeZ = _carBoxNorm.max.z - _carBoxNorm.min.z;
        halfW = sizeX * 0.5;
        halfL = sizeZ * 0.5;
        carBodyHalfY = sizeY * 0.5;
        wheelY = (_carBoxNorm.min.y + _carBoxNorm.max.y) * 0.5;
        wheelFL = car.getObjectByName("wheelFl") || null;
        wheelFR = car.getObjectByName("wheelFr") || null;
        wheelRL = car.getObjectByName("wheelRl") || null;
        wheelRR = car.getObjectByName("wheelRr") || null;
        if (wheelFL) {
          wheelFL.name = "wheelFL";
          wheelFL.baseQuat = wheelFL.quaternion.clone();
        }
        if (wheelFR) {
          wheelFR.name = "wheelFR";
          wheelFR.baseQuat = wheelFR.quaternion.clone();
        }
        if (wheelRL) {
          wheelRL.name = "wheelRL";
          wheelRL.baseQuat = wheelRL.quaternion.clone();
        }
        if (wheelRR) {
          wheelRR.name = "wheelRR";
          wheelRR.baseQuat = wheelRR.quaternion.clone();
        }

        const _wheelCoverPairs = [
          ["wheelCoverFl", wheelFL],
          ["wheelCoverFr", wheelFR],
          ["wheelCoverRl", wheelRL],
          ["wheelCoverRr", wheelRR],
        ];
        for (const [coverName, wheel] of _wheelCoverPairs) {
          const cover = car.getObjectByName(coverName);
          if (cover && wheel) {
            wheel.attach(cover);
          }
        }

        _quatAirInDrive.setFromAxisAngle(_axisAirInDrive, -Math.PI / 2);
        airInParts = ["airIn1", "airIn2", "airIn3"]
          .map((name) => car.getObjectByName(name))
          .filter(Boolean);
        for (const part of airInParts) {
          part.baseQuat = part.quaternion.clone();
          part.openQuat = part.baseQuat
            .clone()
            .multiply(_quatAirInDrive);
          const stagger = AIR_IN_STAGGER[part.name] || {
            open: 0,
            close: 0,
          };
          part.openDelay = stagger.open;
          part.closeDelay = stagger.close;
          part.openT = 0;
          part._airInTarget = 0;
          part._airInDelayLeft = 0;
        }

        canonFL = car.getObjectByName("canon-fl") || null;
        canonFR = car.getObjectByName("canon-fr") || null;
        canonRL = car.getObjectByName("canon-rl") || null;
        canonRR = car.getObjectByName("canon-rr") || null;
        const canonPairs = [
          [canonFL, wheelFL],
          [canonFR, wheelFR],
          [canonRL, wheelRL],
          [canonRR, wheelRR],
        ];
        for (const [canon, wheel] of canonPairs) {
          if (canon && wheel) {
            const p = canon.parent;
            if (p) p.remove(canon);
            wheel.add(canon);
            canon.position.set(0, 0, 0);
            canon.visible = false;
          }
        }

        const carScale =
          Math.max(0.05, Math.min(1, (tableMinSize * 0.2) / 2)) *
          CAR_SCALE_MULTIPLIER;
        car.scale.set(carScale, carScale, carScale);

        let spawnX = tableCenter.x;
        let spawnZ = tableCenter.z + 5;
        let spawnSurfaceY = tableTopY;
        car.position.set(spawnX, spawnSurfaceY, spawnZ);
        car.quaternion.identity();
        car.updateMatrixWorld(true);

        storedCarScale = carScale;
        attachCarHeadTailSpotLights(car);
        const _ws = new THREE.Vector3();
        const canonWheelPairs = [
          { canon: canonFL, wheel: wheelFL, ref: "FL" },
          { canon: canonFR, wheel: wheelFR, ref: "FR" },
          { canon: canonRL, wheel: wheelRL, ref: "RL" },
          { canon: canonRR, wheel: wheelRR, ref: "RR" },
        ];
        for (const entry of canonWheelPairs) {
          const m = entry.canon;
          const w = entry.wheel;
          if (!m || !m.geometry || !w) continue;
          m.getWorldScale(_ws);
          m.geometry.computeBoundingBox();
          const bb = m.geometry.boundingBox;
          const rawY = bb.max.y - bb.min.y;
          const rawXZ =
            (bb.max.x - bb.min.x + (bb.max.z - bb.min.z)) / 2;
          const cylHeight = rawY * _ws.y;
          const cylRadius = (rawXZ * _ws.x) / 2;
          m._physRadius = cylRadius;
          m._physHeight = cylHeight;
          w._physRadius = cylRadius;
          w._physHeight = cylHeight;
          w._canonMesh = m;
          const shape = new CANNON.Cylinder(
            cylRadius,
            cylRadius,
            cylHeight,
            16,
          );
          const body = new CANNON.Body({
            type: CANNON.Body.KINEMATIC,
            material: carMaterial,
            collisionFilterGroup: PHYS_GROUP_CAR,
            collisionFilterMask: -1,
          });
          body.addShape(shape);
          m.getWorldPosition(_canonWorldPos);
          m.getWorldQuaternion(_canonWorldQuat);
          body.position.set(
            _canonWorldPos.x,
            _canonWorldPos.y,
            _canonWorldPos.z,
          );
          body.quaternion.set(
            _canonWorldQuat.x,
            _canonWorldQuat.y,
            _canonWorldQuat.z,
            _canonWorldQuat.w,
          );
          physicsWorld.addBody(body);
          w.physBody = body;
          if (entry.ref === "FL") canonFLBody = body;
          else if (entry.ref === "FR") canonFRBody = body;
          else if (entry.ref === "RL") canonRLBody = body;
          else if (entry.ref === "RR") canonRRBody = body;
        }

        {
          car.updateMatrixWorld(true);
          const _carBoxGround = new THREE.Box3().setFromObject(car);
          let refGroundY = _carBoxGround.min.y;
          let _wheelTreadMinY = Infinity;
          for (const w of [wheelFL, wheelFR, wheelRL, wheelRR]) {
            if (!w || !w._canonMesh || !w._physRadius) continue;
            w._canonMesh.getWorldPosition(_canonWorldPos);
            const treadY = _canonWorldPos.y - w._physRadius;
            _wheelTreadMinY = Math.min(_wheelTreadMinY, treadY);
          }
          if (Number.isFinite(_wheelTreadMinY)) {
            refGroundY = _wheelTreadMinY;
          }
          carBottomOffsetY = Math.max(0, spawnSurfaceY - refGroundY);
          carWheelBottomOffsetY = carBottomOffsetY;
          tableMinY =
            tableTopY + Math.max(0.05, carBottomOffsetY * 0.5);
          tableSpawn.set(
            spawnX,
            spawnSurfaceY + carBottomOffsetY,
            spawnZ,
          );
          car.position.copy(tableSpawn);
          car.updateMatrixWorld(true);
          for (const w of [wheelFL, wheelFR, wheelRL, wheelRR]) {
            const b = w?.physBody;
            const m = w?._canonMesh;
            if (!b || !m) continue;
            m.getWorldPosition(_canonWorldPos);
            m.getWorldQuaternion(_canonWorldQuat);
            b.position.set(
              _canonWorldPos.x,
              _canonWorldPos.y,
              _canonWorldPos.z,
            );
            b.quaternion.set(
              _canonWorldQuat.x,
              _canonWorldQuat.y,
              _canonWorldQuat.z,
              _canonWorldQuat.w,
            );
            b.aabbNeedsUpdate = true;
          }
        }

        canonBodyMesh = car.getObjectByName("canon-body") || null;
        if (canonBodyMesh) {
          canonBodyMesh.visible = false;
          car.updateMatrixWorld(true);
          const cbBox = new THREE.Box3().setFromObject(canonBodyMesh);
          const cbSize = cbBox.getSize(new THREE.Vector3());
          const cbCenter = cbBox.getCenter(new THREE.Vector3());
          _canonBodyLocalCenter.copy(cbCenter);
          canonBodyMesh.worldToLocal(_canonBodyLocalCenter);
          const hx = cbSize.x / 2,
            hy = cbSize.y / 2,
            hz = cbSize.z / 2;
          canonBodyPhys = new CANNON.Body({
            type: CANNON.Body.KINEMATIC,
            material: carMaterial,
            collisionFilterGroup: PHYS_GROUP_CAR,
            collisionFilterMask: -1,
          });
          canonBodyPhys.addShape(
            new CANNON.Box(new CANNON.Vec3(hx, hy, hz)),
          );
          canonBodyPhys.position.set(
            cbCenter.x,
            cbCenter.y,
            cbCenter.z,
          );
          canonBodyMesh.getWorldQuaternion(_canonWorldQuat);
          canonBodyPhys.quaternion.set(
            _canonWorldQuat.x,
            _canonWorldQuat.y,
            _canonWorldQuat.z,
            _canonWorldQuat.w,
          );
          physicsWorld.addBody(canonBodyPhys);
          createCarPropBumper();
        }

        car.userData._carPhysWires = [];

        let lowestWheelBottom = Infinity;
        [wheelFL, wheelFR, wheelRL, wheelRR].forEach((w) => {
          if (!w || !w._physRadius || !w._canonMesh) return;
          w._canonMesh.getWorldPosition(_canonWorldPos);
          const bottom = _canonWorldPos.y - w._physRadius;
          if (bottom < lowestWheelBottom) lowestWheelBottom = bottom;
        });
        const minWheelFloorY = tableSurfaceY;
        if (
          Number.isFinite(lowestWheelBottom) &&
          lowestWheelBottom < minWheelFloorY
        ) {
          const lift = minWheelFloorY - lowestWheelBottom;
          car.position.y += lift;
          tableSpawn.y = car.position.y;
          carBottomOffsetY = car.position.y - spawnSurfaceY;
          carWheelBottomOffsetY = carBottomOffsetY;
          tableMinY =
            spawnSurfaceY + Math.max(0.05, carBottomOffsetY * 0.5);
        } else if (Number.isFinite(lowestWheelBottom)) {
          tableSpawn.y = car.position.y;
        }
        applyTextureAnisotropyToRoot(car);
        applyPerformanceShadowPolicy(car);
        scheduleRebuildBloomDarkenLists();
        prepareKitchenRaceCarTemplate(carScene);
        switchToKitchenWorld();
          },
          undefined,
          (err) => console.error("Car GLTF load failed.", err),
        );
      }

      loadCarGameThenKitchen();
      function resize() {
        const mount = getKitchenSceneMount();
        const w = Math.max(1, mount.clientWidth || window.innerWidth);
        const h = Math.max(1, mount.clientHeight || window.innerHeight);
        const pr = getRenderPixelRatio();
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(pr);
        renderer.setSize(w, h);
        const bloomScale = getBloomRenderScale();
        bloomComposer.setPixelRatio(pr);
        bloomComposer.setSize(
          Math.max(1, Math.round(w * bloomScale)),
          Math.max(1, Math.round(h * bloomScale)),
        );
        finalComposer.setPixelRatio(pr);
        finalComposer.setSize(w, h);
        syncFinalComposerMsaaTargets();
        sharpenPixelSize.set(1 / Math.max(1, w * pr), 1 / Math.max(1, h * pr));
      }
      window.addEventListener("resize", resize);
      resize();
      const _kitchenMountForResize = getKitchenSceneMount();
      if (_kitchenMountForResize && _kitchenMountForResize !== document.body) {
        const _kitchenResizeObserver = new ResizeObserver(() => resize());
        _kitchenResizeObserver.observe(_kitchenMountForResize);
      }

      const clock = new THREE.Clock();
      document.addEventListener("visibilitychange", () => {
        _tabVisible = !document.hidden;
        if (_tabVisible) clock.getDelta();
      });

      window.kitchenScenePerf = {
        getSettings: () => perfSettings,
        setTier: (tier) => setPerformanceTier(tier, "manual"),
      };


      /**
       * Driving physics shared by every car (player and AI): speed from the
       * inputs (throttle / reverse / brake / coasting), steering and the turn
       * integration of the position. Only the input source differs per car.
       */
      function stepCarDrive(state, input, pos, frozen, dt) {
        const inAir = state.velY !== 0;
        let targetSpeed = 0;
        if (!inAir) {
          if (input.forward) targetSpeed = state.maxSpeed;
          if (input.reverse) {
            if (state.speed > 0.3) targetSpeed = 0;
            else targetSpeed = -state.maxSpeed * 0.5;
          }
          if (input.forward && input.reverse) targetSpeed = 0;
          if (input.brake) targetSpeed = 0;
        }
        if (inAir) {
          const airDecay = 1 - Math.exp(-CAR_AIR_RESISTANCE * dt);
          state.speed -= state.speed * airDecay;
          if (Math.abs(state.speed) < 0.04) state.speed = 0;
        } else {
          if (input.brake && Math.abs(state.speed) > 0.04) {
            if (!state._brakeTime) state._brakeTime = 0;
            state._brakeTime += dt;
            const brakeRamp = Math.min(state._brakeTime / 1.2, 1);
            const brakePower = 8 + brakeRamp * 30;
            state.speed -= Math.sign(state.speed) * Math.min(Math.abs(state.speed), brakePower * dt);
          } else {
            state._brakeTime = 0;
          }
          if (!input.brake && input.reverse && state.speed > 0.3) {
            state.speed = Math.max(
              0,
              state.speed -
                (state.brakeDecelReverseKey || state.brakeDecel) * dt,
            );
          } else if (
            Math.abs(state.speed) > 0.3 &&
            !input.forward &&
            !input.reverse
          ) {
            state.speed *= state.friction;
          } else {
            state.speed +=
              (targetSpeed - state.speed) *
              (1 - Math.exp(-state.accel * 0.04 * dt));
          }
          if (Math.abs(state.speed) < 0.04) state.speed = 0;
        }

        let steerTarget = 0;
        if (!inAir) {
          if (input.left) steerTarget = -MAX_STEER_RAD;
          if (input.right) steerTarget = MAX_STEER_RAD;
        }
        state.steerAngle +=
          (steerTarget - state.steerAngle) *
          (1 - Math.exp(-state.steerSpeed * dt));
        state.steerAngle = Math.max(
          -MAX_STEER_RAD,
          Math.min(MAX_STEER_RAD, state.steerAngle),
        );

        const forwardX = Math.sin(state.angle);
        const forwardZ = Math.cos(state.angle);
        const rightX = Math.cos(state.angle);
        const rightZ = -Math.sin(state.angle);
        const moving = Math.abs(state.speed) > 0.65;
        const steering = !inAir && Math.abs(state.steerAngle) > 0.008;

        if (!frozen) {
          if (moving && steering) {
            const speed = state.speed;
            const sign = speed > 0 ? 1 : -1;
            const steer = sign > 0 ? state.steerAngle : -state.steerAngle;
            const speedFactor = Math.min(1, Math.abs(speed) / state.maxSpeed);
            const effectiveTurnRate = state.turnRate * speedFactor;
            const centerX =
              pos.x + rightX * (speed / (effectiveTurnRate * steer));
            const centerZ =
              pos.z + rightZ * (speed / (effectiveTurnRate * steer));
            const dTheta = -effectiveTurnRate * steer * dt;
            const ddx = pos.x - centerX;
            const ddz = pos.z - centerZ;
            const c = Math.cos(dTheta);
            const s = Math.sin(dTheta);
            pos.x = centerX + ddx * c - ddz * s;
            pos.z = centerZ + ddx * s + ddz * c;
            state.angle += dTheta;
          } else {
            pos.x += forwardX * state.speed * dt;
            pos.z += forwardZ * state.speed * dt;
          }
        }
      }

      /** Player inputs, or none while the race holds the cars (countdown / finish). */
      function getPlayerDriveInput() {
        return kitchenRaceInputsLocked() ? _raceNoInput : keys;
      }

      function updateCar(dt) {
        _railStepId++; // a new car step (rail sparks: one scrape emission per car per step)
        const input = getPlayerDriveInput();
        stepCarDrive(carState, input, car.position, carFalling, dt);
        if (!carFalling) integrateRaceCarBump(car.position, carState, dt);

        if (car.userData.brakeLightMesh) {
          const bl = car.userData.brakeLightMesh;
          bl.material = input.brake ? bl._brakeMat : bl._offMat;
        }

        if (!carFalling) collideCarWithRails(car.position, carState, dt);
        carState.driftAngle = 0;
        if (!carFalling) sampleCarWheelGround();
        const edgeX = Math.abs(car.position.x - tablePlateCenter.x) > tablePlateHalfX;
        const edgeZ = Math.abs(car.position.z - tablePlateCenter.z) > tablePlateHalfZ;
        const offTable = edgeX || edgeZ;
        if (offTable && !carFalling) {
          carFalling = true;
          carFloorTimer = 0;
          beginKitchenCarTumble();
          _rampJumpFxBlend = 0;
          _rampJumpFxIn = 0;
          beginCarCam1ReturnToRest();
          _rampJumpMatrixActive = false;
          _rampJumpMatrixOrbitProgress = 0;
          _carCam1MatrixOrbitSettled = false;
          _rampJumpSimAirTime = 0;
          _rampJumpCamRestOffset.set(0, 0, 0);
          _carLandShakePending = false;
        }
        if (carFalling && _carTumbling) {
          updateKitchenCarTumble(dt);
        } else if (carFalling) {
          car.position.y += carState.velY * dt;
          carState.velY -= CAR_GRAVITY * dt;
          let floorTopY = null;
          if (floorPhysBody) {
            const fShape = floorPhysBody.shapes[0];
            if (fShape) floorTopY = floorPhysBody.position.y + fShape.halfExtents.y;
          }
          if (floorTopY != null && car.position.y - carBottomOffsetY <= floorTopY) {
            car.position.y = floorTopY + carBottomOffsetY;
            carState.velY = 0;
            carState.speed = 0;
            carFloorTimer += dt;
            if (carFloorTimer > 2.0) {
              car.position.copy(tableSpawn);
              carState.velY = 0;
              carFalling = false;
              carFloorTimer = 0;
              beginCarCam1ReturnToRest();
            }
          } else if (car.position.y < tableSurfaceY - 120) {
            car.position.copy(tableSpawn);
            carState.velY = 0;
            carState.speed = 0;
            carFalling = false;
            beginCarCam1ReturnToRest();
          }
        } else if (carState.velY !== 0) {
          const gravScale = getMatrixJumpGravityScale();
          car.position.y += carState.velY * dt;
          carState.velY -= carAirGravity(carState) * dt * gravScale;
          _jumpFx.airVy = carState.velY;
          if (carState._rampAir) _jumpFx.airWorld += dt;
          // Land when the lowest wheel (the car's own pitch / roll) meets the
          // surface under it (table or ramp): that end touches first.
          const _wo = carWheelOffsets();
          const _pen = carWheelPenetration(car.position.y, carState, _carWheelSurfY, _wo.lf, _wo.lr);
          if (_pen >= 0 && carState.velY <= 0) {
            car.position.y += _pen;
            const _rest = (_carWheelSurfY[0] + _carWheelSurfY[1] + _carWheelSurfY[2] + _carWheelSurfY[3]) * 0.25 + carBottomOffsetY;
            carState._groundOffset = car.position.y - _rest;
            onCarLanded(carState, carState.velY);
            carState.velY = 0;
            carState._lastRestY = undefined;
          }
        } else {
          const surfDelta = _carFrontAxleSurfY - _carRearAxleSurfY;
          const maxAxleY = Math.max(_carFrontAxleSurfY, _carRearAxleSurfY);
          const unevenSurface = _carSurfRange > CAR_STEP_SURF_DELTA_MIN;
          let _restOnY = tableSpawn.y;
          if (unevenSurface) {
            _restOnY =
              (_carWheelSurfY[0] +
                _carWheelSurfY[1] +
                _carWheelSurfY[2] +
                _carWheelSurfY[3]) *
                0.25 +
              carBottomOffsetY;
          } else if (Math.abs(surfDelta) > CAR_STEP_SURF_DELTA_MIN) {
            _restOnY =
              (_carFrontAxleSurfY + _carRearAxleSurfY) * 0.5 + carBottomOffsetY;
          } else if (maxAxleY > tableSurfaceY + 0.003) {
            _restOnY = maxAxleY + carBottomOffsetY;
          }
          {
            const _wheelRestCap =
              _carGroundSurfY + carBottomOffsetY + 0.05 * storedCarScale;
            if (_restOnY > _wheelRestCap) _restOnY = _wheelRestCap;
          }
          // Ramp edge: the ground dropped away → airborne (launch or fall off).
          const _launchVy = rampGroundStep(carState, car.position.y, _restOnY, dt);
          if (_launchVy !== null) {
            carState.velY = _launchVy;
            jumpInitialVelY = Math.max(0, _launchVy);
            jumpLaunchSpeed = Math.abs(carState.speed);
            _jumpFx.launchVy = _launchVy;
            _jumpFx.airWorld = 0;
            _restOnY = car.position.y;
          }
          const onRamp = _rampMesh && _carGroundSurfY > tableSurfaceY + 1e-3;
          const stepClimbing = unevenSurface && !onRamp; // the ramp is a smooth slope: follow it exactly
          if (_launchVy !== null) {
            // keep the height this step; the air branch takes over next step
          } else if (stepClimbing && car.position.y < _restOnY) {
            car.position.y = THREE.MathUtils.lerp(
              car.position.y,
              _restOnY,
              Math.min(1, dt * CAR_STEP_HEIGHT_LERP),
            );
          } else {
            car.position.y = _restOnY;
          }
          car.updateMatrixWorld(true);
          let minWheelBottomY = Infinity;
          [wheelFL, wheelFR, wheelRL, wheelRR].forEach((w) => {
            if (!w || !w._physRadius || !w._canonMesh) return;
            w._canonMesh.getWorldPosition(_canonWorldPos);
            const bottomY = _canonWorldPos.y - w._physRadius;
            if (bottomY < minWheelBottomY) minWheelBottomY = bottomY;
          });
          if (
            Number.isFinite(minWheelBottomY) &&
            minWheelBottomY < tableSurfaceY
          ) {
            car.position.y += tableSurfaceY - minWheelBottomY;
          }
          // Settling from a tilted landing (low end on the ground) and the suspension dip.
          if (_launchVy === null) {
            carState._groundOffset = carTiltLift(carState, _carGround, carWheelOffsets().lf) - carCompressDip(carState, dt);
            car.position.y += carState._groundOffset;
          } else {
            carState._groundOffset = 0;
          }
        }
        if (!carFalling) {
          if (car.position.y < tableMinY) car.position.y = tableMinY;
        }
        
        if (
          !Number.isFinite(car.position.x) ||
          !Number.isFinite(car.position.y) ||
          !Number.isFinite(car.position.z)
        ) {
          car.position.copy(tableSpawn);
          carFalling = false;
          stopKitchenCarTumble();
        }

        carState.wheelAngle =
          (carState.wheelAngle + (carState.speed * dt) / WHEEL_RADIUS) %
          (Math.PI * 2);
        _quatWheelRoll.setFromAxisAngle(_axisWheelRoll, carState.wheelAngle);
        _quatWheelRollOpposite.setFromAxisAngle(
          _axisWheelRoll,
          -carState.wheelAngle,
        );
        if (wheelFL && wheelFL.baseQuat) {
          _quatWheelSteer.setFromAxisAngle(_axisWheelY, -carState.steerAngle);
          wheelFL.quaternion
            .copy(wheelFL.baseQuat)
            .multiply(_quatWheelSteer)
            .multiply(_quatWheelRoll);
        }
        if (wheelFR && wheelFR.baseQuat) {
          _quatWheelSteer.setFromAxisAngle(_axisWheelY, -carState.steerAngle);
          wheelFR.quaternion
            .copy(wheelFR.baseQuat)
            .multiply(_quatWheelSteer)
            .multiply(_quatWheelRoll);
        }
        if (wheelRL && wheelRL.baseQuat) {
          wheelRL.quaternion.copy(wheelRL.baseQuat).multiply(_quatWheelRoll);
        }
        if (wheelRR && wheelRR.baseQuat) {
          wheelRR.quaternion.copy(wheelRR.baseQuat).multiply(_quatWheelRoll);
        }

        if (airInParts.length) {
          const airInTarget = input.forward ? 1 : 0;
          for (const part of airInParts) {
            if (!part?.baseQuat || !part?.openQuat) continue;
            if (part._airInTarget !== airInTarget) {
              part._airInTarget = airInTarget;
              part._airInDelayLeft = airInTarget
                ? part.openDelay
                : part.closeDelay;
            }
            if (part._airInDelayLeft > 0) {
              part._airInDelayLeft = Math.max(0, part._airInDelayLeft - dt);
            } else {
              part.openT +=
                (airInTarget - part.openT) *
                (1 - Math.exp(-dt * AIR_IN_ROT_SPEED));
            }
            part.quaternion.slerpQuaternions(
              part.baseQuat,
              part.openQuat,
              part.openT,
            );
          }
        }
      }

      /** Reused each frame by the wheel physics sync (no per-frame array). */
      const _wheelBodiesList = [null, null, null, null];
      /**
       * Warm-up under the loader, once the kitchen is loaded and before its first
       * real frame (the first frames uploaded every texture and compiled every
       * shader at once: a ~290 ms and a ~120 ms main-thread stall during the
       * transition): textures uploaded within a time budget per frame, then the
       * shaders compiled with compileAsync (parallel where the GPU driver can).
       */
      const KITCHEN_WARMUP = { frameBudgetMs: 6, maxWaitMs: 4000 };
      const _kitchenWarmup = { state: "idle" }; // idle | running | done
      function _kitchenNextFrame() {
        return new Promise((resolve) => requestAnimationFrame(() => resolve()));
      }
      async function runKitchenWarmup() {
        _kitchenWarmup.state = "running";
        try {
          // The plates' food settles first (off-screen physics, a time budget per frame).
          if (_kitchenFood) await _kitchenFood.settle(_kitchenNextFrame);
          // The rail sparks (and their flash light) are made on the first spark: made now, so the light count is final
          // before the shaders compile (a light added later rebuilt every visible material at the first wall hit: a
          // ~370-460 ms freeze right after GO).
          ensureRailSparks();
          scene.updateMatrixWorld(true);
          const textures = new Set();
          scene.traverse((o) => {
            const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
            for (const m of mats) {
              for (const k in m) {
                const v = m[k];
                if (v && v.isTexture && !v.isRenderTargetTexture) textures.add(v);
              }
            }
          });
          const list = [...textures];
          await Promise.all(
            list.map((t) => {
              const img = t.image;
              return img && typeof img.decode === "function" && img.complete !== false ? img.decode().catch(() => {}) : null;
            }),
          );
          for (let i = 0; i < list.length; ) {
            const start = performance.now();
            while (i < list.length && performance.now() - start < KITCHEN_WARMUP.frameBudgetMs) {
              try {
                renderer.initTexture(list[i]);
              } catch (e) {}
              i++;
            }
            await _kitchenNextFrame();
          }
          if (renderer.compileAsync) {
            // For the target the frames are really drawn into (the composer's
            // buffer, not the screen): three.js builds different shader variants
            // for the two (tone mapping, output colour), so compiling for the
            // screen left the real ones to the first frame.
            const prevTarget = renderer.getRenderTarget();
            renderer.setRenderTarget(finalComposer.readBuffer);
            const compiling = renderer.compileAsync(scene, camera).catch(() => {});
            renderer.setRenderTarget(prevTarget);
            await Promise.race([compiling, new Promise((resolve) => setTimeout(resolve, KITCHEN_WARMUP.maxWaitMs))]);
            // The intro's room reveal (bright → dark): every mode's lights on at once (_kRevealLightSet), compiled
            // here too, so the reveal doesn't freeze as it starts or as it hands over to dark mode.
            // As it plays: the car hidden (in the portal's tunnel, with its own lights).
            // Its HDRI too (on from here to the cut after the first shot).
            if (_kIntro.state === "pending") {
              await _kHdriLoad();
              _kHdri.hold = true;
            }
            const b0 = lightBlend;
            const target0 = lightBlendTarget;
            const carWasVisible = car.visible;
            car.visible = false;
            _kRevealApplyLights(1);
            renderer.setRenderTarget(finalComposer.readBuffer);
            const compilingReveal = renderer.compileAsync(scene, camera).catch(() => {});
            renderer.setRenderTarget(prevTarget);
            car.visible = carWasVisible;
            lightBlend = b0;
            lightBlendTarget = target0;
            applyLightBlend(b0);
            await Promise.race([compilingReveal, new Promise((resolve) => setTimeout(resolve, KITCHEN_WARMUP.maxWaitMs))]);
          }

        } catch (e) {
          console.warn("[kitchen] warm-up failed:", e);
        }
        _kitchenWarmup.state = "done";
      }

      function animate() {
        if (!_kitchenSceneRendering) {
          _kitchenSceneAnimationFrame = 0;
          return;
        }
        _kitchenSceneAnimationFrame = requestAnimationFrame(animate);
        if (!_tabVisible) return;
        // Loaded but not warmed up yet: nothing is drawn (the loader covers it).
        if (_kitchenSceneReady && _kitchenWarmup.state !== "done") {
          if (_kitchenWarmup.state === "idle") runKitchenWarmup();
          clock.getDelta();
          return;
        }
        try {
          const rawDt = clock.getDelta();
          const realDt = Math.min(rawDt, 0.05);
          updateKitchenTimeScale(realDt);
          // The world runs on scaled time (slow motion on the player's ramp jumps).
          const dt = realDt * _kitchenTimeScale;
          const nowSec = performance.now() / 1000;
          const carDt = 1 / 60;
          const maxCarSteps = perfMaxCarSteps;
          trackPerformanceFrame(rawDt);
          const physicsStepDt = dt;
          let carTimeLeft = dt;
          for (let s = 0; s < maxCarSteps && carTimeLeft > 0; s++) {
            const step = Math.min(carDt, carTimeLeft);
            updateCar(step);
            stepKitchenRaceCars(step);
            if (
              carState.velY !== 0 &&
              jumpInitialVelY > 0.02
            ) {
              _rampJumpSimAirTime += step;
            }
            carTimeLeft -= step;
          }
          updateKitchenRace(dt);
          if (_startLights) _startLights.update(raceTimeFromGo());
          if (_counterScreen) _counterScreen.set(raceClockSec());
          updateKitchenRaceArrows(dt);
          if (_carLandShakePending && camera === carCamera) {
            triggerCarCam1LandingShake(
              jumpLaunchSpeed / Math.max(0.01, carState.maxSpeed),
            );
            _carLandShakePending = false;
          }
          if (car) {
            _wheelsList[0] = wheelFL;
            _wheelsList[1] = wheelFR;
            _wheelsList[2] = wheelRL;
            _wheelsList[3] = wheelRR;
            car.updateMatrixWorld(true);
            const _syncInvDt = dt > 0 ? 1 / dt : 0;
            const _wheelBodies = _wheelBodiesList;
            _wheelBodies[0] = canonFLBody;
            _wheelBodies[1] = canonFRBody;
            _wheelBodies[2] = canonRLBody;
            _wheelBodies[3] = canonRRBody;
            for (let wi = 0; wi < 4; wi++) {
              const w = _wheelsList[wi];
              const wb = _wheelBodies[wi];
              if (!w || !wb || !w._canonMesh) continue;
              w._canonMesh.getWorldPosition(_canonWorldPos);
              w._canonMesh.getWorldQuaternion(_canonWorldQuat);
              const MAX_CAR_PHYS_VEL = 12;
              let cvx = (_canonWorldPos.x - wb.position.x) * _syncInvDt;
              let cvy = (_canonWorldPos.y - wb.position.y) * _syncInvDt;
              let cvz = (_canonWorldPos.z - wb.position.z) * _syncInvDt;
              const cvSpd = Math.sqrt(cvx * cvx + cvy * cvy + cvz * cvz);
              if (cvSpd > MAX_CAR_PHYS_VEL) {
                const cvScale = MAX_CAR_PHYS_VEL / cvSpd;
                cvx *= cvScale;
                cvy *= cvScale;
                cvz *= cvScale;
              }
              wb.velocity.set(cvx, cvy, cvz);
              wb.position.set(_canonWorldPos.x, _canonWorldPos.y, _canonWorldPos.z);
              wb.quaternion.set(
                _canonWorldQuat.x,
                _canonWorldQuat.y,
                _canonWorldQuat.z,
                _canonWorldQuat.w,
              );
              wb.aabbNeedsUpdate = true;
            }
            if (canonBodyPhys && canonBodyMesh) {
              _canonWorldPos.copy(_canonBodyLocalCenter);
              canonBodyMesh.localToWorld(_canonWorldPos);
              canonBodyMesh.getWorldQuaternion(_canonWorldQuat);
              canonBodyPhys.position.set(
                _canonWorldPos.x,
                _canonWorldPos.y,
                _canonWorldPos.z,
              );
              canonBodyPhys.quaternion.set(
                _canonWorldQuat.x,
                _canonWorldQuat.y,
                _canonWorldQuat.z,
                _canonWorldQuat.w,
              );
              syncCarPropBumper(dt);
            }
            if (car.userData._carPhysWires) {
              for (const { wire, body } of car.userData._carPhysWires) {
                wire.position.set(body.position.x, body.position.y, body.position.z);
                wire.quaternion.set(
                  body.quaternion.x,
                  body.quaternion.y,
                  body.quaternion.z,
                  body.quaternion.w,
                );
              }
            }
          }
          if (physicsStepDt > 0) {
            wakeKitchenPropsNearCar();
            const realtimePhysics =
              Math.abs(carState.speed) > 0.05 ||
              carState.velY !== 0 ||
              carFalling ||
              keys.forward ||
              keys.reverse ||
              keys.left ||
              keys.right ||
              keys.brake ||
              kitchenRaceCarsMoving() ||
              kitchenPropsMoving() ||
              (_kitchenFood && _kitchenFood.moving());
            if (realtimePhysics) {
              _kitchenIdlePhysicsAccumulator = 0;
              // A pile of food settling in a plate: finer steps meanwhile (kitchenFood.js pile.substeps).
              const sub = _kitchenFood ? _kitchenFood.substeps() : 1;
              physicsWorld.step(1 / 60 / sub, physicsStepDt, 3 * sub);
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
            _kitchenPropDt = physicsStepDt;
            syncKitchenProps();
          }

          let carOnTable = false;

          for (let ci = 0; ci < physicsWorld.contacts.length; ci++) {
            const c = physicsWorld.contacts[ci];
            const bi = c.bi,
              bj = c.bj;
            if (
              tablePlateBody &&
              (bi === tablePlateBody || bj === tablePlateBody)
            ) {
              const other = bi === tablePlateBody ? bj : bi;
              if (
                other === canonFLBody ||
                other === canonFRBody ||
                other === canonRLBody ||
                other === canonRRBody
              ) {
                carOnTable = true;
              }
            }
          }
          if (_carTumbling) carOnTable = false;
          if (carOnTable && carState.velY < 0) onCarLanded(carState, carState.velY);
          if (carOnTable && carState.velY <= 0) carState.velY = 0;
          if (carState.velY !== 0) wasInAir = true;
          const onGround = carState.velY === 0 && carOnTable;
          const justLanded = onGround && wasInAir;
          if (justLanded) {
            wasInAir = false;
            _rampLeftJumpActive = false;
            _rampJumpFxBlend = 0;
            _rampJumpFxIn = 0;
            landingRecoveryUntil = nowSec + LANDING_RECOVERY_DURATION;
            _carLandShakePending = true;
            const hadJumpCamFx =
              _rampJumpMatrixActive ||
              _carCam1MatrixReturnActive ||
              _rampJumpCamRestOffset.lengthSq() > 1e-6;
            if (hadJumpCamFx) {
              beginCarCam1ReturnToRest();
            }
            _rampJumpMatrixActive = false;
            _rampJumpMatrixOrbitProgress = 0;
            _carCam1MatrixOrbitSettled = false;
            _rampJumpSimAirTime = 0;
            _rampJumpCamRestOffset.set(0, 0, 0);
          }
          // Tilt: the shared model (ground pitch / roll, the airborne arc, landing settle).
          updateCarTilt(carState, carState.velY === 0 && !carFalling, _carGround, dt);
          _quatY.setFromAxisAngle(_flatUp, carState.angle + carState.driftAngle);
          car.quaternion.copy(_quatY);
          if (carState.tiltPitch) car.quaternion.multiply(_quatTilt.setFromAxisAngle(_axisRacePitch, -carState.tiltPitch));
          if (carState.tiltRoll) car.quaternion.multiply(_quatTilt.setFromAxisAngle(_axisRaceRoll, carState.tiltRoll));
          carUpLerp.set(0, 1, 0).applyQuaternion(car.quaternion);
          syncCarFromFallBody();
          if (carOnTable && carState.velY <= 0) {
            const settling = carState._settleT > 0 || (carState._compressT ?? Infinity) < LANDING_COMPRESS_SEC;
            if (_carGroundSurfY <= tableSurfaceY + 0.01 && !settling) {
              car.position.y = tableSpawn.y;
            }
            carState.velY = 0;
          }
          const lightBlendDelta = lightBlendTarget - lightBlend;
          if (Math.abs(lightBlendDelta) > 0.0001) {
            lightBlend +=
              lightBlendDelta * Math.min(1, dt / LIGHT_FADE_DURATION);
            if (Math.abs(lightBlendTarget - lightBlend) <= 0.0001) {
              lightBlend = lightBlendTarget;
            }
            applyLightBlend(lightBlend);
          }

          const carMoving = Math.abs(carState.speed) > 0.3;
          if (carMoving && _carWasStopped) {
            exhaustActive = true;
            exhaustStartTime = nowSec;
          }
          _carWasStopped = !carMoving;

          if (exhaustEffects.length > 0) {
            const exhaustElapsed = nowSec - exhaustStartTime;
            const exhaustShow =
              exhaustActive && exhaustElapsed < EXHAUST_DURATION;
            if (!exhaustShow) {
              if (exhaustActive && exhaustElapsed >= EXHAUST_DURATION) {
                exhaustActive = false;
              }
              for (const ef of exhaustEffects) {
                ef.points.visible = false;
              }
            } else {
              const baseFade = 1 - Math.pow(exhaustElapsed / EXHAUST_DURATION, 0.5);
              const localProgress = exhaustElapsed / EXHAUST_DURATION;
              const risePhase = 0.25;
              const easeIn = Math.min(
                1,
                (localProgress / risePhase) * (localProgress / risePhase),
              );
              const stretchY = 1 + (1 - easeIn) * 1.4;
              for (let ei = 0; ei < exhaustEffects.length; ei++) {
                const ef = exhaustEffects[ei];
                _exhFlickerTimers[ei] += dt;
                if (_exhFlickerTimers[ei] >= _exhFlickerNextChange[ei]) {
                  _exhFlickerTimers[ei] = 0;
                  const startBoost = Math.pow(1 - localProgress, 1.8);
                  const burstProb = 0.22 + 0.45 * startBoost;
                  const offMin = 0.14 - 0.1 * startBoost;
                  const offRange = 0.32 - 0.22 * startBoost;
                  const burst = Math.random() < burstProb;
                  _exhFlickerTargets[ei] = burst
                    ? 0.85 + Math.random() * 0.15
                    : 0.0;
                  _exhFlickerNextChange[ei] = burst
                    ? 0.015 + Math.random() * 0.04
                    : offMin + Math.random() * offRange;
                }
                const snapSpeed = _exhFlickerTargets[ei] > 0.5 ? 80 : 65;
                _exhFlickerValues[ei] +=
                  (_exhFlickerTargets[ei] - _exhFlickerValues[ei]) *
                  Math.min(1, dt * snapSpeed);
                const flicker = _exhFlickerValues[ei];
                const fade = baseFade * flicker;
                ef.points.visible = fade > 0.05;
                ef.points.position.copy(ef.anchorMesh.position);
                ef.points.position.z -= 0.35;
                ef.points.material.uniforms.uFade.value = fade;
                ef.points.material.uniforms.uTime.value = clock.getElapsedTime();
                for (let i = 0; i < ef.count; i++) {
                  ef.rise[i] += dt * FLAME_EFFECT_RISE_SPEED;
                  if (ef.rise[i] > 1) ef.rise[i] -= 1;
                  const y = ef.rise[i] * 0.8 * stretchY;
                  ef.posAttr.array[i * 3] = ef.spread[i * 2];
                  ef.posAttr.array[i * 3 + 1] = y;
                  ef.posAttr.array[i * 3 + 2] = ef.spread[i * 2 + 1];
                }
                ef.posAttr.needsUpdate = true;
              }
            }
          }

          const _carCam1Shake =
            camera === carCamera ? advanceCarCam1LandingShake(rawDt) : null;
          if (camera === carCamera || camera === carCameraFollow) {
            if (camera === carCamera) {
              getCarCameraLookAtPoint(_carMatrixLookAt);
              controls.target.copy(_carMatrixLookAt);
              if (_carCam1Shake) controls.target.add(_carCam1Shake);
            } else {
              controls.target.copy(car.position);
            }
          }
          if (camera === carCameraFollow) updateCarCameraFollow();


          carShadowLight.position.set(
            car.position.x,
            car.position.y + 20,
            car.position.z,
          );
          carShadowLight.target.position.copy(car.position);
          carShadowLight.target.updateMatrixWorld();

          const matrixCamLock =
            isCarCameraOrbitDefault() && isCarCameraJumpEffectActive();
          if (!matrixCamLock) {
            controls.update();
          }
          if (isCarCameraOrbitDefault()) {
            updateCarCam1RampJumpEffect(rawDt);
            if (!isCarCameraJumpEffectActive()) {
              if (_carCam1LandShakeTime > 0) {
                applyCarOrbitCameraFromAngles();
              } else {
                syncCarOrbitCamYawFromPosition();
                applyCarOrbitCameraFromAngles();
              }
            }
            if (_carCam1Shake)
              carCamera.position.addScaledVector(_carCam1Shake, 0.78);
            if (_carCam1LandShakeTime <= 0 && !isCarCameraMatrixOrbitActive()) {
              enforceCarCameraMinDistance();
            }
            if (isCarCameraJumpEffectActive()) {
              applyCarCameraLookAtCar();
            }
          }
          if (camera === carCameraFollow) {
            syncCarFollowCamAnglesFromPosition(carCameraFollow);
            applyCarFollowCameraFromAngles();
          }
          // The mouse drag's offset (under the intro / jump cameras; the landing shake stays on top).
          {
            const gameplayCam = camera === carCamera || camera === carCameraFollow;
            if (kitchenCameraDrag.desktop && controls) {
              // On the gameplay cameras the drag replaces the orbit controls' mouse rotate / pan.
              controls.enableRotate = !gameplayCam;
              controls.enablePan = !gameplayCam;
            }
            kitchenCameraDrag.update(Math.min(rawDt, 0.1));
            if (car && gameplayCam) kitchenCameraDrag.apply(camera, getCarCameraLookAtPoint(_kitchenDragTarget));
          }
          updateKitchenChaseCamera(Math.min(rawDt, 0.1));
          applyKitchenIntroCamera(Math.min(rawDt, 0.1));
          applyKitchenJumpCamera();
          applyKitchenCountdownCamera();
          if (sceneBloomEnabled) {
            renderCarLightsBloomComposer();
            carBloomMixPass.material.uniforms.bloomTexture.value =
              bloomComposer.readBuffer.texture;
            carBloomMixPass.material.uniforms.bloomIntensity.value =
              SCENE_BLOOM_MIX_INTENSITY;
          } else {
            carBloomMixPass.material.uniforms.bloomIntensity.value = 0;
          }
          updateTrashPlaneEffect(dt);
          updateRailSparks(dt);
          if (_kitchenNapkins && _kitchenWorldActive) _kitchenNapkins.update(dt);
          updateIceCoffeeTank(dt);
          updateMisterSpot(dt);
          updateMisterSpotTrail(dt);
          updateTableLightReflections();
          if (_shelfJars) _shelfJars.update(camera); // the cheap glass's copies back to front
          updateKitchenCarLights();
          finalComposer.render();
          restoreKitchenCountdownCamera();
          restoreKitchenJumpCamera();
          restoreKitchenIntroCamera();
          kitchenCameraDrag.restore(camera);
          if (_kitchenSceneReady && !_kitchenSceneShown && ++_kitchenSceneShownFrames >= KITCHEN_READY_FRAMES) {
            _kitchenSceneShown = true;
            emitKitchenSceneEvent("ready");
          }
        } catch (e) {
          restoreKitchenCountdownCamera();
          restoreKitchenJumpCamera();
          kitchenCameraDrag.restore(camera);
          restoreKitchenIntroCamera();
          console.error("Animate error:", e);
        }
      }
      /**
       * For the game menu: the player has control (intro over, race set up), and
       * a race is under way (from the start delay until the finish).
       */
      export function getKitchenMenuState() {
        return {
          playerHasControl: _kIntro.state === "done" && _racePhase !== "off" && _racePhase !== "intro",
          inPlay: _racePhase === "waiting" || _racePhase === "countdown" || _racePhase === "racing" || _racePhase === "finishing",
        };
      }
      /** The loader is fading out: play the intro (then the race). */
      export function startKitchenIntro() {
        startKitchenIntroPlayback();
      }

      export function setKitchenSceneRendering(active) {
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
      setKitchenSceneRendering(true);