      import * as THREE from "three";
      import * as CANNON from "cannon-es";
      import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
      import { OrbitControls } from "three/addons/controls/OrbitControls.js";
      import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
      import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
      import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
      import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
      import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
      import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
      import { Reflector } from "three/addons/objects/Reflector.js";
      import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
      import { DecalGeometry } from "three/addons/geometries/DecalGeometry.js";
      import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { getKitchenSceneMount } from "./kitchenSceneMount.js";
import { emitKitchenSceneEvent } from "../game/kitchenSceneEvents.js";

const _KITCHEN_BASE = `${import.meta.env.BASE_URL}kitchen-scene-optimized/`;
const _OFFICE_BASE = `${import.meta.env.BASE_URL}office-scene-optimized/`;
const kitchenAsset = (path) => _KITCHEN_BASE + String(path).replace(/^\.\//, "");
const officeAsset = (path) => _OFFICE_BASE + String(path).replace(/^\.\//, "");

let _kitchenSceneRendering = false;
let _kitchenSceneAnimationFrame = 0;
let _kitchenSceneReady = false;

export function isKitchenSceneReady() {
  return _kitchenSceneReady;
}

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a1a1a);
      let physicsWorld = null;

      const carCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
      carCamera.position.set(2, 2, 2);
      const carCameraFollow = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
      carCameraFollow.position.set(2, 2, 2);
      const testCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
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
      const _carCamOrbitRight = new THREE.Vector3();
      const _carCam1ChaseOffset = new THREE.Vector3();
      const _carCam1ReturnTargetOffset = new THREE.Vector3();
      const _carCam1PreMatrixOffset = new THREE.Vector3();
      const _rampJumpCamDriftOffset = new THREE.Vector3();
      const _carMatrixLookAt = new THREE.Vector3();
      let _carCam1PreserveView = false;
      let _carCam1MatrixReturnActive = false;
      let _carCam1MatrixReturnT = 0;
      let _carMatrixOrbitDist = 0;
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

      function snapshotCarOrbitCamRestPose() {
        if (!isCarCameraOrbitDefault() || !car) return;
        syncCarOrbitCamAnglesFromPosition(carCamera);
        _carOrbitCamDistance = Math.max(
          _carOrbitCamDistance,
          getCarCameraMinDistance(),
        );
        _carCam1OrbitDistSnapshot = _carOrbitCamDistance;
        _carCam1OrbitElevSnapshot = _carOrbitCamElev;
        _carCam1OrbitYawSnapshot = _carOrbitCamWorldYaw;
        _carCam1RestDistance = _carOrbitCamDistance;
        getCarCameraOffsetFromPosition(carCamera, _carCam1ChaseOffset);
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

      function rollRampJumpMatrixCameraStyle() {
        _rampJumpMatrixPitchBias = THREE.MathUtils.lerp(
          0.06,
          0.28,
          Math.random(),
        );
        _rampJumpMatrixAzimuthBias = (Math.random() - 0.5) * 0.85;
        _rampJumpMatrixSideBias = (Math.random() - 0.5) * 0.48;
        _rampJumpMatrixOrbitSign = Math.random() < 0.5 ? -1 : 1;
      }

      function applyRampJumpMatrixCameraDrift(orbitProgress, dist) {
        const arc = Math.sin(Math.PI * orbitProgress);
        const spin = Math.sin(orbitProgress * Math.PI * 4);
        const k = dist * RAMP_JUMP_MATRIX_DRIFT_SCALE;
        const maxDown = dist * RAMP_JUMP_CAM_MAX_DOWN_DRIFT_FRAC;
        _rampJumpCamDriftOffset.set(
          (_rampJumpMatrixSideBias * arc + spin * 0.55) * k,
          Math.max(_rampJumpMatrixPitchBias * arc * k * 1.15, -maxDown),
          Math.cos(orbitProgress * Math.PI * 3) *
            _rampJumpMatrixAzimuthBias *
            k *
            0.65,
        );
        return _rampJumpCamDriftOffset;
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

      function getCarMatrixOrbitMinDistance() {
        return getCarCameraMinDistance();
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

      function getCarMatrixLookAtPoint(out) {
        return getCarCameraLookAtPoint(out);
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

      function captureRampJumpMatrixCameraBasis() {
        const minOrbit = getCarMatrixOrbitMinDistance();
        _carMatrixOrbitDist = Math.max(
          _rampJumpCamRestOffset.length(),
          minOrbit,
        );
        _carCamOffset.copy(_rampJumpCamRestOffset);
        const horizLen = Math.hypot(_carCamOffset.x, _carCamOffset.z);
        _rampJumpMatrixHorizDist = Math.max(horizLen, minOrbit * 0.85);
        _rampJumpMatrixHeightOff = _carCamOffset.y;
        _rampJumpMatrixStartAzimuth = Math.atan2(
          _carCamOffset.x,
          _carCamOffset.z,
        );
        _rampJumpMatrixStartAzimuth += _rampJumpMatrixAzimuthBias * 0.35;
        const pitchBase = Math.atan2(
          Math.max(_carCamOffset.y, minOrbit * 0.22),
          _rampJumpMatrixHorizDist,
        );
        _rampJumpMatrixPitch = THREE.MathUtils.clamp(
          pitchBase + _rampJumpMatrixPitchBias,
          0.18,
          0.68,
        );
      }

      function buildMatrixOrbitCameraOffset(orbitAngle, orbitDist) {
        const minDist = getCarMatrixOrbitMinDistance();
        const dist = Math.max(orbitDist, minDist);
        const horiz = dist * Math.cos(_rampJumpMatrixPitch);
        const yOff = dist * Math.sin(_rampJumpMatrixPitch);
        const azimuth = _rampJumpMatrixStartAzimuth + orbitAngle;
        _carCamOffset.set(
          Math.sin(azimuth) * horiz,
          yOff,
          Math.cos(azimuth) * horiz,
        );
      }

      function getRampJumpAirProgress() {
        if (jumpInitialVelY <= 0.02) return 0;
        const totalAirTime =
          (2 * jumpInitialVelY) / Math.max(0.01, CAR_GRAVITY);
        return THREE.MathUtils.clamp(_rampJumpSimAirTime / totalAirTime, 0, 1);
      }

      function getRampJumpMatrixOrbitProgress() {
        const span = Math.max(
          1e-3,
          RAMP_JUMP_MATRIX_ORBIT_AIR_END - RAMP_JUMP_MATRIX_ORBIT_AIR_START,
        );
        return THREE.MathUtils.clamp(
          (getRampJumpAirProgress() - RAMP_JUMP_MATRIX_ORBIT_AIR_START) / span,
          0,
          1,
        );
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

      function switchToFreeCamera() {
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
        const s = perfSettings;
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
        if (_kitchenWorldActive) {
          renderer.shadowMap.enabled = false;
          renderer.toneMappingExposure = 0.86;
          sceneBloomEnabled = false;
          carBloomMixPass.enabled = false;
          if (typeof carShadowLight !== "undefined") {
            carShadowLight.castShadow = false;
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
        bloomComposer.render();
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
      const rgbeLoader = new RGBELoader();
      const HDRI_URL =
        "https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr";
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
      );

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

      const AXES_SIZE = 12.5;
      const axesHelper = new THREE.AxesHelper(AXES_SIZE);
      scene.add(axesHelper);

      function makeAxisLabel(text, hexColor) {
        const c = document.createElement("canvas");
        c.width = 64;
        c.height = 64;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, 64, 64);
        ctx.font = "bold 52px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#" + ("000000" + hexColor.toString(16)).slice(-6);
        ctx.fillText(text, 32, 32);
        const tex = new THREE.CanvasTexture(c);
        tex.needsUpdate = true;
        const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(2, 2, 1);
        return sprite;
      }
      const axisLabelX = makeAxisLabel("X", 0xff0000);
      axisLabelX.position.set(AXES_SIZE, 0, 0);
      scene.add(axisLabelX);
      const axisLabelY = makeAxisLabel("Y", 0x00ff00);
      axisLabelY.position.set(0, AXES_SIZE, 0);
      scene.add(axisLabelY);
      const axisLabelZ = makeAxisLabel("Z", 0x0000ff);
      axisLabelZ.position.set(0, 0, AXES_SIZE);
      scene.add(axisLabelZ);

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
      let lightBlend = 0;
      let lightBlendTarget = 0;
      const LIGHT_FADE_DURATION = 0.2;
      /** Tris spacing / compact mode only once blend crosses this (bright side). */
      const LIGHT_BLEND_TRIS_BRIGHT_THRESHOLD = 0.5;
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
        if (_kitchenWorldActive && _kitchenFloorMat) {
          _kitchenFloorMat.color.lerpColors(
            _kitchenFloorColorDark,
            _kitchenFloorColorBright,
            b,
          );
          _kitchenFloorMat.emissive.setHex(0x16235a);
          _kitchenFloorMat.emissiveIntensity = (1 - b) * 0.16;
        }
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
          switchCarView(carCamera);
        }
        if (e.code === "Digit2") {
          e.preventDefault();
          switchToFreeCamera();
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
      const TABLE_WHEEL_CLEARANCE = 0;
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
      const _axisSteerLocal = new THREE.Vector3();
      const _quatBaseInv = new THREE.Quaternion();
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
      let carWheelBox = null;
      let carWheelBoxPhys = null;
      const _canonWorldPos = new THREE.Vector3();
      const _canonWorldQuat = new THREE.Quaternion();
      const _canonBodyLocalCenter = new THREE.Vector3();
      const _airTiltUp = new THREE.Vector3();
      const _wheelSyncWorldPos = [
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
      ];
      const _wheelsList = [null, null, null, null];
      const _wheelHadBottom = [false, false, false, false];
      const car = new THREE.Group();
      car.rotation.order = "YXZ";
      scene.add(car);
      const carKeyLight = new THREE.PointLight(0xc7eaff, 7.5, 16, 1.8);
      carKeyLight.position.set(-1.2, 3.8, 1.8);
      carKeyLight.name = "kitchenCarKeyLight";
      car.add(carKeyLight);
      const carRimLight = new THREE.PointLight(0xff4fc8, 3.5, 11, 1.8);
      carRimLight.position.set(1.5, 2.4, -2.2);
      carRimLight.name = "kitchenCarRimLight";
      car.add(carRimLight);

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
      };
      const CAR_GRAVITY = 75;
      const CAR_AIR_RESISTANCE = 0.08;
      const CAR_RAMP_JUMP_MULTIPLIER = 2;
      const CAR_RAMP_JUMP_MIN_SPEED = 5;
      const RAMP_JUMP_MATRIX_CHANCE = 0.4;
      const RAMP_JUMP_CAM_ZOOM = 0.88;
      const RAMP_JUMP_CAM_ZOOM_PEAK = 0.58;
      const RAMP_JUMP_CAM_ZOOM_MATRIX_PEAK = 1;
      const RAMP_JUMP_CAM_ZOOM_MATRIX_ORBIT_END = 0.38;
      const RAMP_JUMP_MATRIX_ZOOM_MIN_FRAC = 0.65;
      const RAMP_JUMP_MATRIX_DRIFT_SCALE = 0.14;
      const RAMP_JUMP_CAM_TABLE_CLEARANCE = 0.28;
      const RAMP_JUMP_CAM_MAX_DOWN_DRIFT_FRAC = 0.12;
      const RAMP_JUMP_MATRIX_ORBIT = Math.PI * 2;
      const RAMP_JUMP_MATRIX_ORBIT_AIR_START = 0.04;
      const RAMP_JUMP_MATRIX_ORBIT_AIR_END = 0.94;
      const RAMP_JUMP_MATRIX_GRAVITY_SCALE = 0.11;
      const RAMP_JUMP_MATRIX_TILT = 0.24;
      const RAMP_JUMP_EFFECT_LERP = 7;
      const RAMP_JUMP_LAND_CLEARANCE = 0.55;
      const RAMP_JUMP_EASE_IN_SEC = 0.32;
      const RAMP_JUMP_EASE_OUT_START = 1.35;
      const LAND_CAM_SHAKE_DURATION = 0.42;
      const LAND_CAM_SHAKE_LOOK = 1.05;
      const CAR_DRIVEABLE_PROP_MAX_STEP = 0.65;
      const CAR_STEP_SURF_DELTA_MIN = 0.004;
      const CAR_STEP_HEIGHT_LERP = 18;
      const CAR_STEP_TILT_LERP = 14;
      const keys = {
        forward: false,
        reverse: false,
        left: false,
        right: false,
        brake: false,
      };

      const maxCarDistance = 80;
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
      const _DEFAULT_SHADOW_MAP = 512;
      const _KITCHEN_FLOOR_STRIPE_MIN = 45;
      const _KITCHEN_FLOOR_STRIPE_MAX = 90;
      let _kitchenNishInstanced = null;
      const _kitchenShadowCamOffice = {
        far: 50,
        left: -6,
        right: 6,
        top: 6,
        bottom: -6,
      };
      const _kitchenShadowCamKitchen = {
        far: 95,
        left: -55,
        right: 55,
        top: 55,
        bottom: -55,
      };

      function setKitchenPerfMode(active) {
        _kitchenWorldActive = !!active;
        applyPerformanceSettings();
        renderer.toneMappingExposure = active ? 0.86 : 1;
        sceneBloomEnabled = false;
        carBloomMixPass.enabled = false;
        if (active) {
          renderer.shadowMap.enabled = false;
          carShadowLight.castShadow = false;
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

      function disposeKitchenNishInstanced() {
        if (!_kitchenNishInstanced) return;
        try {
          if (_kitchenNishInstanced.parent) {
            _kitchenNishInstanced.parent.remove(_kitchenNishInstanced);
          }
        } catch (e) {}
        try { _kitchenNishInstanced.dispose(); } catch (e) {}
        _kitchenNishInstanced = null;
      }

      function buildKitchenNishPlateInstances(mesh, parent, stepX, cloneCount, material) {
        disposeKitchenNishInstanced();
        if (!mesh || !mesh.geometry || stepX == null || cloneCount < 0) return;
        const total = cloneCount + 1;
        _kitchenNishInstanced = new THREE.InstancedMesh(
          mesh.geometry,
          material,
          total,
        );
        _kitchenNishInstanced.name = "MainNishBackWallPlate_instanced";
        _kitchenNishInstanced.castShadow = false;
        _kitchenNishInstanced.receiveShadow = false;
        _kitchenNishInstanced.frustumCulled = true;
        const base = mesh.position.clone();
        const quat = mesh.quaternion.clone();
        const scale = mesh.scale.clone();
        const m = new THREE.Matrix4();
        for (let i = 0; i < total; i++) {
          const pos = base.clone();
          pos.x += stepX * i;
          m.compose(pos, quat, scale);
          _kitchenNishInstanced.setMatrixAt(i, m);
        }
        _kitchenNishInstanced.instanceMatrix.needsUpdate = true;
        mesh.visible = false;
        parent.add(_kitchenNishInstanced);
      }
      let carFalling = false;
      let carFloorTimer = 0;
      let tablePlateMesh = null;
      let storedCarScale = 0.5;
      let carBottomOffsetY = 0;
      let carPhysicsHalfY = 0; // kept for compatibility

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

      const TILT_SPEED_MIN_LERP = 0.4;
      const TILT_SPEED_MAX_LERP = 1.2;
      const _flatUp = new THREE.Vector3(0, 1, 0);
      const _stepTiltUp = new THREE.Vector3(0, 1, 0);
      let _carFrontAxleSurfY = 0;
      let _carRearAxleSurfY = 0;
      let _carGroundSurfY = 0;
      let _carSurfRange = 0;
      const _carWheelSurfY = [0, 0, 0, 0];
      const _quatY = new THREE.Quaternion();
      const _quatTilt = new THREE.Quaternion();
      const _tiltAxis = new THREE.Vector3();
      const carUpLerp = new THREE.Vector3(0, 1, 0);
      const jumpLaunchUp = new THREE.Vector3(0, 1, 0);
      let jumpStartTime = 0;
      let jumpLaunchSpeed = 0;
      let jumpInitialVelY = 0;
      let _rampJumpSimAirTime = 0;
      const LANDING_TILT_LERP = 120;
      const LANDING_RECOVERY_DURATION = 0.3;
      let wasInAir = false;
      let _carLandShakePending = false;
      let _rampLeftJumpActive = false;
      let _rampJumpMatrixActive = false;
      let _rampJumpFxBlend = 0;
      let _rampJumpFxIn = 0;
      let _carCam1JumpEffect = 0;
      let _rampJumpMatrixOrbitSign = 1;
      let _rampJumpMatrixOrbitProgress = 0;
      let _rampJumpMatrixHorizDist = 0;
      let _rampJumpMatrixHeightOff = 0;
      let _rampJumpMatrixStartAzimuth = 0;
      let _rampJumpMatrixPitch = 0.35;
      let _rampJumpMatrixPitchBias = 0;
      let _rampJumpMatrixAzimuthBias = 0;
      let _rampJumpMatrixSideBias = 0;
      let landingRecoveryUntil = 0;
      const _v0 = new THREE.Vector3();
      const _v1 = new THREE.Vector3();
      const _v2 = new THREE.Vector3();
      const _v3 = new THREE.Vector3();
      const _surfEdgeA = new THREE.Vector3();
      const _surfEdgeB = new THREE.Vector3();
      const _surfNormalB = new THREE.Vector3();
      let tablePlateBody = null;
      let floorPhysBody = null;
      const PHYS_GROUP_DEFAULT = 1;
      const PHYS_GROUP_CAR = 512;

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

      const _reflectionBox = new THREE.Box3();
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
      }

      const FLAME_EFFECT_PARTICLE_COUNT = 60;
      const FLAME_EFFECT_SPREAD = 0.06;
      const FLAME_EFFECT_SIZE = 320;
      const FLAME_EFFECT_ABOVE = 0.38;
      const FLAME_EFFECT_RISE_SPEED = 2.5;
      const FLAME_EFFECT_RISE_DISTANCE = 7.0;
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

      function createTableLightGlowSprite(tint, baseSize) {
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
      }

      function getLocalReflectionBounds(mesh) {
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

      function setupTableLightReflections(carRoot) {
        tableLightGlows = [];
        const specs = [
          { name: "frontLights", color: 0xffffff, size: 0.44, kind: "front" },
          { name: "rearLights", color: 0xff3333, size: 0.36, kind: "rear" },
          {
            name: "mainRearBrakeLights",
            color: 0xff0000,
            size: 0.4,
            kind: "brake",
          },
        ];
        for (let si = 0; si < specs.length; si++) {
          const spec = specs[si];
          const mesh = carRoot.getObjectByName(spec.name);
          if (!mesh) continue;
          tableLightGlows.push({
            mesh,
            sprite: createTableLightGlowSprite(spec.color, spec.size),
            kind: spec.kind,
            baseSize: spec.size,
            ...getLocalReflectionBounds(mesh),
          });
        }
        carRoot.traverse((node) => {
          if (!node.isMesh || node.name !== "lightBar1") return;
          tableLightGlows.push({
            mesh: node,
            sprite: createTableLightGlowSprite(0xff2222, 0.24),
            kind: "bar",
            baseSize: 0.24,
            ...getLocalReflectionBounds(node),
          });
        });
      }

      function updateTableLightReflections() {
        if (!tableLightGlows.length || !car || !perfSettings.reflection) {
          for (let gi = 0; gi < tableLightGlows.length; gi++) {
            tableLightGlows[gi].sprite.visible = false;
          }
          return;
        }
        const tableY = getTablePlaySurfaceY();
        if (tableY == null) return;
        for (let gi = 0; gi < tableLightGlows.length; gi++) {
          const entry = tableLightGlows[gi];
          let alpha = 0;
          if (entry.kind === "front") alpha = 0.82;
          else if (entry.kind === "rear") alpha = 0.52;
          else if (entry.kind === "brake") alpha = keys.brake ? 0.92 : 0.18;
          else if (entry.kind === "bar") alpha = 0.38;
          if (alpha < 0.02) {
            entry.sprite.visible = false;
            continue;
          }
          getMeshTableReflectionPoint(entry, tableY, _v0);
          entry.sprite.position.copy(_v0);
          const heightAbove = entry.localHalfHeight;
          const sc = entry.baseSize * (0.88 + heightAbove * 0.06);
          entry.sprite.scale.set(sc, sc * 0.72, 1);
          entry.sprite.material.opacity = alpha;
          entry.sprite.visible = true;
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
      function remapMeshUVsToFullQuad(mesh) {
        if (!mesh?.geometry?.attributes?.uv) return;
        const uv = mesh.geometry.attributes.uv;
        let uMin = Infinity,
          uMax = -Infinity,
          vMin = Infinity,
          vMax = -Infinity;
        for (let i = 0; i < uv.count; i++) {
          const u = uv.getX(i);
          const v = uv.getY(i);
          if (u < uMin) uMin = u;
          if (u > uMax) uMax = u;
          if (v < vMin) vMin = v;
          if (v > vMax) vMax = v;
        }
        const du = uMax - uMin || 1;
        const dv = vMax - vMin || 1;
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(
            i,
            (uv.getX(i) - uMin) / du,
            (uv.getY(i) - vMin) / dv,
          );
        }
        uv.needsUpdate = true;
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
        _safeRemoveBody(tablePlateBody); tablePlateBody = null;
        _safeRemoveBody(floorPhysBody); floorPhysBody = null;
        if (_peselLightMeshes.length) _peselLightMeshes.length = 0;
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
      let _kitchenTableTopLampOverlay = null;
      let _kitchenTableTopStencilWriter = null;

      function _kitchenMeshReceivesLampLight(name) {
        return name === "mainTableTopPlane";
      }

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

      function _kitchenCoverMatFromTextures(map, normalMap, roughnessMap, aoMap) {
        return new THREE.MeshStandardMaterial({
          map,
          normalMap,
          roughnessMap,
          aoMap,
          roughness: 1,
          metalness: 0,
          envMapIntensity: 0.35,
          side: THREE.DoubleSide,
        });
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
        sideMat.color.set(0x9aaee0);
        sideMat.emissive.setHex(0x1a2f70);
        sideMat.emissiveMap = sideMat.aoMap;
        sideMat.emissiveIntensity = 0.58;
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
            "ul-kitchen13.gltf: mainTableTopPlane / mainTableSidePlane not found",
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

      function loadKitchenWorld() {
        const loadToken = ++_kitchenLoadToken;
        const kLoader = new GLTFLoader();
        kLoader.load(
          kitchenAsset("ul-kitchen13.gltf"),
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
              console.warn("ul-kitchen13.gltf: no mainTablePlate/mainTablePlatePhysic mesh found");
              _worldSwitched = false;
              return;
            }

            scene.add(kmodel);
            _currentWorldModel = kmodel;

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
            const _applyCeramic = (root, material) => {
              root.traverse((n) => {
                if (n.isMesh) n.material = material;
              });
            };

            let _coverCloneStepX = null;
            let _tableCoverLampMat = null;
            const _finishKitchenWorldSetup = () => {
            const _mainGreenWallMat = new THREE.MeshStandardMaterial({
              color: 0xecf8ea,
              roughness: 1.0,
              metalness: 0.0,
              side: THREE.DoubleSide,
            });
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
              envMapIntensity: 0.08,
              side: THREE.DoubleSide,
            });
            if (scene.environment) {
              _kitchenMainPlateMat.envMap = scene.environment;
              _mainTablePlateMat.envMap = scene.environment;
            }
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
            const _blackPlasticMeshNames = new Set([
              "coffeeMuchineBody",
              "coffeeTankCup",
              "coffeeStrokEdge",
              "waterTapPlastic",
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
              side: THREE.DoubleSide,
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
            kmodel.traverse((n) => {
              if (!n.isMesh) return;
              if (_isKitchenTableCoverPlane(n.name)) return;
              if (n.name === "kitchenMainPlate") {
                if (Array.isArray(n.material)) {
                  n.material = n.material.map(() => _kitchenMainPlateMat);
                } else {
                  n.material = _kitchenMainPlateMat;
                }
                return;
              }
              if (n.name === "mainTableBase") {
                n.renderOrder = 0;
                return;
              }
              if (n.name === "mainTablePlate") {
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
              if (n.name === "binSign1") {
                if (Array.isArray(n.material)) {
                  n.material = n.material.map(() => _binSign1PlasticMat);
                } else {
                  n.material = _binSign1PlasticMat;
                }
                n.renderOrder = 2;
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
              if (_chromeMetalMeshNames.has(n.name)) {
                if (Array.isArray(n.material)) {
                  n.material = n.material.map(() => _chromeMetalMat);
                } else {
                  n.material = _chromeMetalMat;
                }
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
                n.material = _matteWhiteDoubleSideMat;
                return;
              }
              if (_matteWhiteMeshNames.has(n.name)) {
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
              if (
                n.name !== "mainGreenWall" &&
                n.name !== "closetDoors" &&
                n.name !== "dishwasherDoor"
              ) {
                return;
              }
              if (Array.isArray(n.material)) {
                n.material = n.material.map(() => _mainGreenWallMat);
              } else {
                n.material = _mainGreenWallMat;
              }
            });

            try {
              const _fridgeGlassMat = new THREE.MeshStandardMaterial({
                color: 0x6a9ab0,
                roughness: 0.05,
                metalness: 0.0,
                transparent: true,
                opacity: 0.65,
                envMapIntensity: 1.5,
                side: THREE.DoubleSide,
              });
              if (scene.environment) _fridgeGlassMat.envMap = scene.environment;
              const _fridgeGlassNames = new Set(["fridgeGlassLeft", "fridgeGlassRight"]);
              const _fridgeLightNames = new Set(["fridgeLightLeft", "fridgeLightRight"]);
              kmodel.traverse((n) => {
                if (!n.isMesh) return;
                if (_fridgeGlassNames.has(n.name)) {
                  n.material = _fridgeGlassMat;
                  n.frustumCulled = false;
                  n.translateZ(0.05);
                  return;
                }
                if (_fridgeLightNames.has(n.name)) {
                  const mat = new THREE.MeshStandardMaterial({
                    color: 0x0a1a66,
                    emissive: 0x0a1a66,
                    emissiveIntensity: 30,
                    roughness: 0.5,
                    metalness: 0.0,
                  });
                  n.material = mat;
                  _peselLightMeshes.push({
                    mesh: n,
                    darkIntensity: 30,
                    brightIntensity: 10,
                  });
                  n.updateMatrixWorld(true);
                  const lightBox = new THREE.Box3().setFromObject(n);
                  const lightCenter = lightBox.getCenter(new THREE.Vector3());
                  const lightSize = lightBox.getSize(new THREE.Vector3());
                  const stripAlongX = lightSize.x >= lightSize.z;
                  const stripLen = Math.max(stripAlongX ? lightSize.x : lightSize.z, 0.2) + 0.06;
                  const stripThick = Math.max(stripAlongX ? lightSize.z : lightSize.x, 0.05) + 0.03;
                  const fridgeRect = new THREE.RectAreaLight(0x0a1a66, 0, stripLen, stripThick);
                  fridgeRect.position.set(lightCenter.x, lightBox.min.y - 0.02, lightCenter.z);
                  fridgeRect.rotation.set(-Math.PI / 2, stripAlongX ? 0 : Math.PI / 2, 0);
                  fridgeRect.name = n.name + "_rect";
                  scene.add(fridgeRect);
                  _shelfDownLights.push({
                    light: fridgeRect,
                    darkIntensity: 400,
                    brightIntensity: 150,
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

            const shadowPlaneGeo = new THREE.PlaneGeometry(tSize.x * 1.5, tSize.z * 1.5);
            const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.35 });
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
            tableSpawn.set(tCenter.x, tTopY + _carBottomOff, tCenter.z);
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
                  if (idx >= 1 && idx <= 34) _applyPeselStyleLight(n);
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
                }
                ensureKitchenCoverPlanesVisible(planeInfo);
                attachKitchenTableTopLampOverlay(planeInfo.topPlane);
                updateKitchenLampCoverShader(1 - lightBlend);
                try { applyLightBlend(lightBlend); } catch (e) {}
                _kitchenSceneReady = true;
                emitKitchenSceneEvent("ready");
              }
            })();
          },
          undefined,
          (err) => {
            console.error("Failed to load ul-kitchen13.gltf:", err);
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
          officeAsset("car-game14.gltf"),
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
              node.position.z += 0.08;
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

      function computeCarGroundNormalFromWheels(out) {
        _v0.set(
          _wheelSyncWorldPos[0].x,
          _carWheelSurfY[0],
          _wheelSyncWorldPos[0].z,
        );
        _v1.set(
          _wheelSyncWorldPos[1].x,
          _carWheelSurfY[1],
          _wheelSyncWorldPos[1].z,
        );
        _v2.set(
          _wheelSyncWorldPos[2].x,
          _carWheelSurfY[2],
          _wheelSyncWorldPos[2].z,
        );
        _v3.set(
          _wheelSyncWorldPos[3].x,
          _carWheelSurfY[3],
          _wheelSyncWorldPos[3].z,
        );
        _surfEdgeA.subVectors(_v1, _v0);
        _surfEdgeB.subVectors(_v2, _v0);
        out.crossVectors(_surfEdgeA, _surfEdgeB);
        _surfEdgeA.subVectors(_v3, _v1);
        _surfEdgeB.subVectors(_v2, _v1);
        _surfNormalB.crossVectors(_surfEdgeA, _surfEdgeB);
        out.add(_surfNormalB);
        if (out.lengthSq() < 1e-10) {
          out.set(0, 1, 0);
          return;
        }
        out.normalize();
        if (out.y < 0) out.negate();
      }

      function updateCar(dt) {
        const inAir = carState.velY !== 0;
        let targetSpeed = 0;
        if (!inAir) {
          if (keys.forward) targetSpeed = carState.maxSpeed;
          if (keys.reverse) {
            if (carState.speed > 0.3) targetSpeed = 0;
            else targetSpeed = -carState.maxSpeed * 0.5;
          }
          if (keys.forward && keys.reverse) targetSpeed = 0;
          if (keys.brake) targetSpeed = 0;
        }
        if (inAir) {
          const airDecay = 1 - Math.exp(-CAR_AIR_RESISTANCE * dt);
          carState.speed -= carState.speed * airDecay;
          if (Math.abs(carState.speed) < 0.04) carState.speed = 0;
        } else {
          if (keys.brake && Math.abs(carState.speed) > 0.04) {
            if (!carState._brakeTime) carState._brakeTime = 0;
            carState._brakeTime += dt;
            const brakeRamp = Math.min(carState._brakeTime / 1.2, 1);
            const brakePower = 8 + brakeRamp * 30;
            carState.speed -= Math.sign(carState.speed) * Math.min(Math.abs(carState.speed), brakePower * dt);
          } else {
            carState._brakeTime = 0;
          }
          if (!keys.brake && keys.reverse && carState.speed > 0.3) {
            carState.speed = Math.max(
              0,
              carState.speed -
                (carState.brakeDecelReverseKey || carState.brakeDecel) * dt,
            );
          } else if (
            Math.abs(carState.speed) > 0.3 &&
            !keys.forward &&
            !keys.reverse
          ) {
            carState.speed *= carState.friction;
          } else {
            carState.speed +=
              (targetSpeed - carState.speed) *
              (1 - Math.exp(-carState.accel * 0.04 * dt));
          }
          if (Math.abs(carState.speed) < 0.04) carState.speed = 0;
        }

        if (car.userData.brakeLightMesh) {
          const bl = car.userData.brakeLightMesh;
          bl.material = keys.brake ? bl._brakeMat : bl._offMat;
        }

        let steerTarget = 0;
        if (!inAir) {
          if (keys.left) steerTarget = -MAX_STEER_RAD;
          if (keys.right) steerTarget = MAX_STEER_RAD;
        }
        carState.steerAngle +=
          (steerTarget - carState.steerAngle) *
          (1 - Math.exp(-carState.steerSpeed * dt));
        carState.steerAngle = Math.max(
          -MAX_STEER_RAD,
          Math.min(MAX_STEER_RAD, carState.steerAngle),
        );

        const forwardX = Math.sin(carState.angle);
        const forwardZ = Math.cos(carState.angle);
        const rightX = Math.cos(carState.angle);
        const rightZ = -Math.sin(carState.angle);
        const moving = Math.abs(carState.speed) > 0.65;
        const steering = !inAir && Math.abs(carState.steerAngle) > 0.008;

        if (!carFalling) {
          if (moving && steering) {
            const speed = carState.speed;
            const sign = speed > 0 ? 1 : -1;
            const steer = sign > 0 ? carState.steerAngle : -carState.steerAngle;
            const speedFactor = Math.min(1, Math.abs(speed) / carState.maxSpeed);
            const effectiveTurnRate = carState.turnRate * speedFactor;
            const centerX =
              car.position.x + rightX * (speed / (effectiveTurnRate * steer));
            const centerZ =
              car.position.z + rightZ * (speed / (effectiveTurnRate * steer));
            const dTheta = -effectiveTurnRate * steer * dt;
            const ddx = car.position.x - centerX;
            const ddz = car.position.z - centerZ;
            const c = Math.cos(dTheta);
            const s = Math.sin(dTheta);
            car.position.x = centerX + ddx * c - ddz * s;
            car.position.z = centerZ + ddx * s + ddz * c;
            carState.angle += dTheta;
          } else {
            car.position.x += forwardX * carState.speed * dt;
            car.position.z += forwardZ * carState.speed * dt;
          }
        }
        carState.driftAngle = 0;
        if (!carFalling) {
          _carFrontAxleSurfY = tableSurfaceY;
          _carRearAxleSurfY = tableSurfaceY;
          _carGroundSurfY = tableSurfaceY;
          for (let wi = 0; wi < 4; wi++) _carWheelSurfY[wi] = tableSurfaceY;
          _carSurfRange = 0;
        }
        const edgeX = Math.abs(car.position.x - tablePlateCenter.x) > tablePlateHalfX;
        const edgeZ = Math.abs(car.position.z - tablePlateCenter.z) > tablePlateHalfZ;
        const offTable = edgeX || edgeZ;
        if (offTable && !carFalling) {
          carFalling = true;
          carFloorTimer = 0;
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
        if (carFalling) {
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
          carState.velY -= CAR_GRAVITY * dt * gravScale;
          const _landOnY = tableSpawn.y;
          if (car.position.y < _landOnY) {
            car.position.y = _landOnY;
            carState.velY = 0;
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
          const stepClimbing = unevenSurface;
          if (stepClimbing && car.position.y < _restOnY) {
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
          const airInTarget = keys.forward ? 1 : 0;
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

      function animate() {
        if (!_kitchenSceneRendering) {
          _kitchenSceneAnimationFrame = 0;
          return;
        }
        _kitchenSceneAnimationFrame = requestAnimationFrame(animate);
        if (!_tabVisible) return;
        try {
          const rawDt = clock.getDelta();
          const dt = Math.min(rawDt, 0.05);
          const nowSec = performance.now() / 1000;
          const carDt = 1 / 60;
          const maxCarSteps = perfMaxCarSteps;
          trackPerformanceFrame(rawDt);
          const physicsStepDt = dt;
          let carTimeLeft = dt;
          for (let s = 0; s < maxCarSteps && carTimeLeft > 0; s++) {
            const step = Math.min(carDt, carTimeLeft);
            updateCar(step);
            if (
              carState.velY !== 0 &&
              jumpInitialVelY > 0.02
            ) {
              _rampJumpSimAirTime += step;
            }
            carTimeLeft -= step;
          }
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
            const _wheelBodies = [
              canonFLBody, canonFRBody, canonRLBody, canonRRBody,
            ];
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
          if (carOnTable && carState.velY <= 0) carState.velY = 0;
          const speedFactor = Math.min(
            1,
            Math.abs(carState.speed) / Math.max(0.01, carState.maxSpeed),
          );
          const tiltLerpFactor =
            TILT_SPEED_MIN_LERP +
            (TILT_SPEED_MAX_LERP - TILT_SPEED_MIN_LERP) * speedFactor;
          let targetUp = _flatUp;
          if (
            carState.velY === 0 &&
            _carSurfRange > CAR_STEP_SURF_DELTA_MIN
          ) {
            computeCarGroundNormalFromWheels(_stepTiltUp);
            targetUp = _stepTiltUp;
          }
          if (carState.velY !== 0) {
            const fx = Math.sin(carState.angle + carState.driftAngle);
            const fz = Math.cos(carState.angle + carState.driftAngle);
            const hSpeed = Math.max(1, Math.abs(carState.speed));
            const pitchAngle = Math.atan2(carState.velY, hSpeed * 8);
            const sinP = Math.sin(pitchAngle);
            const cosP = Math.cos(pitchAngle);
            targetUp = _airTiltUp
              .set(-sinP * fx, cosP, -sinP * fz)
              .normalize();
          }
          if (carState.velY !== 0) wasInAir = true;
          const onGround = carState.velY === 0 && carOnTable;
          const justLanded = onGround && wasInAir;
          if (justLanded) {
            wasInAir = false;
            _rampLeftJumpActive = false;
            _rampJumpFxBlend = 0;
            _rampJumpFxIn = 0;
            landingRecoveryUntil = nowSec + LANDING_RECOVERY_DURATION;
            carUpLerp.set(0, 1, 0);
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
          const inLandingRecovery = onGround && nowSec < landingRecoveryUntil;
          const stepTiltLerp = CAR_STEP_TILT_LERP * tiltLerpFactor;
          const onStepTransition = carState.velY === 0 &&
            _carSurfRange > CAR_STEP_SURF_DELTA_MIN;
          const airTiltLerp = 5 + 5 * Math.min(1, jumpLaunchSpeed / Math.max(0.01, carState.maxSpeed));
          const groundTiltLerp = inLandingRecovery
            ? LANDING_TILT_LERP
            : stepTiltLerp;
          if (!justLanded)
            carUpLerp.lerp(
              targetUp,
              Math.min(
                1,
                dt * (carState.velY !== 0 ? airTiltLerp : groundTiltLerp),
              ),
            );
          _quatY.setFromAxisAngle(
            _flatUp,
            carState.angle + carState.driftAngle,
          );
          const ux = carUpLerp.x,
            uy = carUpLerp.y,
            uz = carUpLerp.z;
          const uyClamp = Math.max(-1, Math.min(1, uy));
          const tiltAngle = Math.acos(uyClamp);
          if (tiltAngle < 1e-6) {
            _quatTilt.identity();
          } else {
            _tiltAxis.set(uz, 0, -ux);
            if (_tiltAxis.lengthSq() < 1e-12) _tiltAxis.set(1, 0, 0);
            else _tiltAxis.normalize();
            _quatTilt.setFromAxisAngle(_tiltAxis, tiltAngle);
          }
          car.quaternion.copy(_quatTilt).multiply(_quatY);
          if (carOnTable && carState.velY <= 0) {
            if (_carGroundSurfY <= tableSurfaceY + 0.01) {
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


          carShadowLight.position.set(car.position.x + 3, car.position.y + 20, car.position.z + 2);
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
          if (sceneBloomEnabled) {
            renderCarLightsBloomComposer();
            carBloomMixPass.material.uniforms.bloomTexture.value =
              bloomComposer.readBuffer.texture;
            carBloomMixPass.material.uniforms.bloomIntensity.value =
              SCENE_BLOOM_MIX_INTENSITY;
          } else {
            carBloomMixPass.material.uniforms.bloomIntensity.value = 0;
          }
          updateTableLightReflections();
          finalComposer.render();
        } catch (e) {
          console.error("Animate error:", e);
        }
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