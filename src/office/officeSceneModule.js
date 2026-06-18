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
import { getOfficeSceneMount } from "./officeSceneMount.js";

const _OFFICE_BASE = `${import.meta.env.BASE_URL}office-scene-optimized/`;
function officeAsset(relativePath) {
  let p = String(relativePath);
  if (p.startsWith("./")) p = p.slice(2);
  return _OFFICE_BASE + p.split("/").map(encodeURIComponent).join("/");
}


      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a1a1a);
      let car = null;
      let physicsWorld = null;
      let flameEffects = [];
      let flameEffectsVisible = false;

      const carCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
      carCamera.position.set(2, 2, 2);
      const carCameraFollow = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
      carCameraFollow.position.set(2, 2, 2);
      const testCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
      const gumsTankCamera = new THREE.PerspectiveCamera(42, 1, 0.08, 1000);
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
      let _carCam1PreserveView = false;
      let _carCam1MatrixReturnActive = false;
      const _carMatrixLookAt = new THREE.Vector3();
      let _carMatrixOrbitDist = 0;
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
          (_rampJumpMatrixActive ||
            (_rampJumpDidSlowMo && carState.velY !== 0))
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
        if (!isCarCameraOrbitDefault() || !car || _carOrbitCamDistance < 1e-6) return;
        getCarCameraOffsetFromPosition(carCamera, _carCamOffset);
        const horizDist = Math.hypot(_carCamOffset.x, _carCamOffset.z);
        if (horizDist < 1e-6) return;
        _carOrbitCamWorldYaw = clampCarFollowCamWorldYaw(
          Math.atan2(_carCamOffset.x, _carCamOffset.z),
        );
      }

      function applyCarOrbitCameraFromAngles() {
        if (!isCarCameraOrbitDefault() || !car || _carOrbitCamDistance < 1e-6) return;
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
        if (!_carCam1MatrixReturnActive || camera !== carCamera || !car) return false;
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
        if (updateCarCam1MatrixReturn(rawDt)) return;

        const matrixOrbit =
          _rampJumpMatrixActive &&
          carState.velY !== 0 &&
          _rampJumpCamRestOffset.lengthSq() > 1e-6 &&
          !_carCam1MatrixReturnActive;

        if (matrixOrbit) {
          _carCam1JumpEffect = 1;
          _rampJumpMatrixOrbitProgress = getRampJumpMatrixOrbitProgress();
          const minOrbit = getCarCameraMinDistance();
          const matrixZoomMin = minOrbit * RAMP_JUMP_MATRIX_ZOOM_MIN_FRAC;
          const orbitStart = Math.max(_carMatrixOrbitDist, minOrbit);
          const zoomWave =
            1 -
            Math.sin(Math.PI * _rampJumpMatrixOrbitProgress) *
              (1 - RAMP_JUMP_CAM_ZOOM_MATRIX_ORBIT_END);
          const orbitDist = Math.max(orbitStart * zoomWave, matrixZoomMin);
          const rotEase =
            _rampJumpMatrixOrbitProgress *
            _rampJumpMatrixOrbitProgress *
            (3 - 2 * _rampJumpMatrixOrbitProgress);
          const orbitAngle =
            _rampJumpMatrixOrbitSign *
            RAMP_JUMP_MATRIX_ORBIT *
            rotEase;
          buildMatrixOrbitCameraOffset(orbitAngle, orbitDist);
          _carCamOffset.add(
            applyRampJumpMatrixCameraDrift(
              _rampJumpMatrixOrbitProgress,
              orbitDist,
            ),
          );
          clampCarCameraOffsetInPlace(_carCamOffset);
          setCarCameraFromLookAtOffset(_carCamOffset);
          captureCarCam1ChaseOffset();
          if (
            _rampJumpMatrixOrbitProgress >= 1 &&
            !_carCam1MatrixReturnActive
          ) {
            _rampJumpMatrixActive = false;
            beginCarCam1ReturnToRest();
            updateCarCam1MatrixReturn(rawDt);
          }
          return;
        }

        const target =
          _rampJumpFxBlend > 0 && !_carCam1MatrixOrbitSettled
            ? _rampJumpFxBlend
            : 0;

        if (_carCam1MatrixOrbitSettled && carState.velY !== 0) {
          restoreCarOrbitCamRestPose(null);
          return;
        }

        if (target === 0) {
          if (
            _rampJumpCamRestOffset.lengthSq() > 1e-6 &&
            _carCam1JumpEffect > 0.002
          ) {
            beginCarCam1ReturnToRest();
            updateCarCam1MatrixReturn(rawDt);
          } else {
            _carCam1JumpEffect = 0;
          }
          return;
        }

        _carCam1JumpEffect +=
          (target - _carCam1JumpEffect) *
          (1 - Math.exp(-RAMP_JUMP_EFFECT_LERP * rawDt));
        if (_carCam1JumpEffect < 0.002) {
          _carCam1JumpEffect = 0;
          return;
        }

        getCarCameraOffsetFromPosition(carCamera, _carCamOffset);

        const dist = _carCamOffset.length();
        if (dist < 1e-6) return;
        const restDist =
          _carCam1RestDistance > 1e-6
            ? _carCam1RestDistance
            : _carCam1OrbitDistSnapshot > 1e-6
              ? _carCam1OrbitDistSnapshot
              : dist;
        const airProgress = getRampJumpAirProgress();
        const peakCurve = Math.sin(Math.PI * airProgress);
        let zoomPeak = RAMP_JUMP_CAM_ZOOM_PEAK;
        const zoomCurve = peakCurve;
        const zoomT = THREE.MathUtils.lerp(
          RAMP_JUMP_CAM_ZOOM,
          zoomPeak,
          _rampJumpDidSlowMo ? zoomCurve : 0,
        );
        const minDist = getCarCameraMinDistance();
        const targetDist = Math.max(
          THREE.MathUtils.lerp(
            restDist,
            restDist * zoomT,
            _carCam1JumpEffect,
          ),
          minDist,
        );
        _carCamOffset.multiplyScalar(targetDist / dist);
        _carCamOffset.add(
          applyRampJumpSlowMoCameraDrift(airProgress, restDist),
        );

        clampCarCameraOffsetInPlace(_carCamOffset);
        setCarCameraFromLookAtOffset(_carCamOffset);
        captureCarCam1ChaseOffset();
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

      function rollRampJumpSlowMoCameraDrift() {
        _rampJumpSlowMoDriftYaw = (Math.random() - 0.5) * 0.42;
        _rampJumpSlowMoDriftPitch = (Math.random() - 0.5) * 0.26;
        _rampJumpSlowMoDriftSide = (Math.random() - 0.5) * 0.34;
        _rampJumpSlowMoDriftPhase = Math.random() * Math.PI * 2;
      }

      function rollRampJumpMatrixCameraStyle() {
        _rampJumpMatrixPitchBias = THREE.MathUtils.lerp(0.06, 0.28, Math.random());
        _rampJumpMatrixAzimuthBias = (Math.random() - 0.5) * 0.85;
        _rampJumpMatrixSideBias = (Math.random() - 0.5) * 0.48;
        _rampJumpMatrixOrbitSign = Math.random() < 0.5 ? -1 : 1;
      }

      function applyRampJumpSlowMoCameraDrift(airProgress, baseDist) {
        const hang = Math.sin(Math.PI * airProgress);
        const t = _rampJumpSimAirTime * 1.65 + _rampJumpSlowMoDriftPhase;
        const driftScale = baseDist * hang * RAMP_JUMP_SLOW_MO_DRIFT_SCALE;
        const maxDown = baseDist * RAMP_JUMP_CAM_MAX_DOWN_DRIFT_FRAC;
        _rampJumpCamDriftOffset.set(
          (Math.sin(t * 1.15) * _rampJumpSlowMoDriftSide +
            Math.cos(t * 0.72) * _rampJumpSlowMoDriftYaw * 0.4) *
            driftScale,
          Math.max(
            Math.sin(t * 0.88 + 1.1) * _rampJumpSlowMoDriftPitch * driftScale,
            -maxDown,
          ),
          (Math.cos(t * 1.28) * _rampJumpSlowMoDriftYaw +
            Math.sin(t * 0.58) * _rampJumpSlowMoDriftSide * 0.45) *
            driftScale,
        );
        return _rampJumpCamDriftOffset;
      }

      function applyRampJumpMatrixCameraDrift(orbitProgress, dist) {
        const arc = Math.sin(Math.PI * orbitProgress);
        const spin = Math.sin(orbitProgress * Math.PI * 4 + _rampJumpSlowMoDriftPhase);
        const k = dist * RAMP_JUMP_MATRIX_DRIFT_SCALE;
        const maxDown = dist * RAMP_JUMP_CAM_MAX_DOWN_DRIFT_FRAC;
        _rampJumpCamDriftOffset.set(
          (_rampJumpMatrixSideBias * arc + spin * 0.55) * k,
          Math.max(_rampJumpMatrixPitchBias * arc * k * 1.15, -maxDown),
          Math.cos(orbitProgress * Math.PI * 3 + _rampJumpSlowMoDriftPhase) *
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
          (isCarCameraMatrixOrbitActive() ||
            _carCam1MatrixReturnActive ||
            (_rampJumpDidSlowMo &&
              _rampJumpFxBlend > 0.02 &&
              carState.velY !== 0 &&
              !_carCam1MatrixOrbitSettled))
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
        _carMatrixOrbitDist = Math.max(_rampJumpCamRestOffset.length(), minOrbit);
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
        const totalAirTime = (2 * jumpInitialVelY) / Math.max(0.01, CAR_GRAVITY);
        return THREE.MathUtils.clamp(
          _rampJumpSimAirTime / totalAirTime,
          0,
          1,
        );
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

      function getRampJumpSlowMoScale() {
        if (!_rampJumpDidSlowMo || !isCarCameraOrbitDefault()) return 1;
        const matrixHang =
          _rampJumpMatrixActive && carState.velY !== 0;
        const effectiveBlend = matrixHang
          ? Math.max(_rampJumpFxBlend, 0.85)
          : _rampJumpFxBlend;
        if (!matrixHang && _rampJumpFxBlend <= 0) return 1;
        const airProgress = getRampJumpAirProgress();
        const peakCurve = _rampJumpMatrixActive
          ? Math.pow(Math.sin(Math.PI * airProgress), 0.82)
          : Math.sin(Math.PI * airProgress);
        const edgeSlow = _rampJumpMatrixActive
          ? RAMP_JUMP_SLOW_MO_MATRIX_EDGE
          : RAMP_JUMP_SLOW_MO_EDGE;
        const peakSlow = _rampJumpMatrixActive
          ? RAMP_JUMP_SLOW_MO_MATRIX_PEAK
          : RAMP_JUMP_SLOW_MO_PEAK;
        const slowTarget = THREE.MathUtils.lerp(edgeSlow, peakSlow, peakCurve);
        return THREE.MathUtils.lerp(1, slowTarget, effectiveBlend);
      }

      function getMatrixJumpGravityScale() {
        return 1;
      }

      function updateRampJumpFxBlend(rawDt) {
        if (!_rampJumpDidSlowMo) {
          _rampJumpFxBlend = 0;
          _rampJumpFxIn = 0;
          return;
        }
        if (carState.velY === 0) {
          _rampJumpFxBlend = 0;
          _rampJumpFxIn = 0;
          return;
        }

        _rampJumpFxIn = Math.min(
          1,
          _rampJumpFxIn + rawDt / RAMP_JUMP_EASE_IN_SEC,
        );
        const easeIn = rampJumpEaseInOut(_rampJumpFxIn);

        let easeOut = 1;
        if (!_rampJumpMatrixActive && carState.velY < 0) {
          const clearance = RAMP_JUMP_LAND_CLEARANCE * storedCarScale;
          const easeOutStart = RAMP_JUMP_EASE_OUT_START * storedCarScale;
          const heightAbove = car.position.y - tableSpawn.y;
          const predictY =
            car.position.y +
            carState.velY * rawDt -
            0.5 * CAR_GRAVITY * rawDt * rawDt;
          const predictHeightAbove = predictY - tableSpawn.y;
          const h = Math.min(heightAbove, predictHeightAbove);
          if (h <= easeOutStart) {
            easeOut = THREE.MathUtils.smoothstep(h, clearance, easeOutStart);
          }
        }

        _rampJumpFxBlend = easeIn * easeOut;
        if (_rampJumpMatrixActive && carState.velY !== 0) {
          _rampJumpFxBlend = 1;
        }
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
        const zoom = 0.09;
        const followZoom = CAR_CAM_FOLLOW_ZOOM;
        const rotLeft = 1.15;
        const c = Math.cos(rotLeft);
        const s = Math.sin(rotLeft);

        const camOffsetX = maxDim * zoom;
        const camOffsetY = maxDim * 0.72 * zoom;
        const camOffsetZ = maxDim * zoom;
        carCamera.position.set(
          lookAt.x + camOffsetX * c - camOffsetZ * s,
          lookAt.y + camOffsetY,
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
      const DESK_FLAME_LAYER = 12;
      carCamera.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
      carCamera.layers.enable(DESK_FLAME_LAYER);
      carCameraFollow.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
      testCamera.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
      gumsTankCamera.layers.enable(CAR_LIGHTS_BLOOM_LAYER);

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
        return Math.round(
          window.innerWidth * window.innerHeight * dpr * dpr,
        );
      }

      function useVisualParity() {
        return perfTierIndex >= VISUAL_PARITY_TIER;
      }

      function getRenderPixelRatio() {
        const dpr = window.devicePixelRatio || 1;
        if (useVisualParity()) {
          return Math.min(MAX_DEVICE_PIXEL_RATIO, Math.max(1, dpr));
        }
        return (
          Math.min(maxDevicePixelRatio, Math.max(1, dpr)) * perfResolutionScale
        );
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
          gumMaxSubFill: 2,
          gumMaxSubMixed: 2,
          gumMaxSubDynamic: 1,
          maxCarSteps: 1,
          macScreenScale: 0.5,
          anisotropyCap: 2,
          eyeTrackingEvery: 3,
          macFeedEvery: 2,
          screenVideoEvery: 3,
          airPlaneEvery: 2,
          chargerEvery: 2,
          shadowEvery: 2,
          physicsIdleCoalesce: true,
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
          gumMaxSubFill: 3,
          gumMaxSubMixed: 3,
          gumMaxSubDynamic: 2,
          maxCarSteps: 1,
          macScreenScale: 0.72,
          anisotropyCap: 4,
          eyeTrackingEvery: 2,
          macFeedEvery: 2,
          screenVideoEvery: 2,
          airPlaneEvery: 2,
          chargerEvery: 2,
          shadowEvery: 1,
          physicsIdleCoalesce: true,
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
          gumMaxSubFill: 5,
          gumMaxSubMixed: 5,
          gumMaxSubDynamic: 2,
          maxCarSteps: 2,
          macScreenScale: 1,
          anisotropyCap: 8,
          eyeTrackingEvery: 1,
          macFeedEvery: 1,
          screenVideoEvery: 1,
          airPlaneEvery: 1,
          chargerEvery: 1,
          shadowEvery: 1,
          physicsIdleCoalesce: false,
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
          gumMaxSubFill: 5,
          gumMaxSubMixed: 5,
          gumMaxSubDynamic: 2,
          maxCarSteps: 2,
          macScreenScale: 1,
          anisotropyCap: 16,
          eyeTrackingEvery: 1,
          macFeedEvery: 1,
          screenVideoEvery: 1,
          airPlaneEvery: 1,
          chargerEvery: 1,
          shadowEvery: 1,
          physicsIdleCoalesce: true,
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
        const isDiscreteGpu = /NVIDIA|GeForce|RTX|GTX|Radeon RX|AMD Radeon/i.test(
          gpu,
        );

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

        const storedTier = localStorage.getItem("officeScenePerfTier");
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
      let perfGumMaxSubstepsFill = perfSettings.gumMaxSubFill;
      let perfGumMaxSubstepsMixed = perfSettings.gumMaxSubMixed;
      let perfGumMaxSubstepsDynamic = perfSettings.gumMaxSubDynamic;
      let perfAnisotropyCap = perfSettings.anisotropyCap;
      let perfEyeTrackingEvery = perfSettings.eyeTrackingEvery;
      let perfMacFeedEvery = perfSettings.macFeedEvery;
      let perfScreenVideoEvery = perfSettings.screenVideoEvery;
      let perfAirPlaneEvery = perfSettings.airPlaneEvery;
      let perfChargerEvery = perfSettings.chargerEvery;
      let perfPhysicsIdleCoalesce = perfSettings.physicsIdleCoalesce;
      let perfBloomScale = perfSettings.bloomScale;
      let perfFpsEma = 60;
      let perfBadFpsFrames = 0;
      let perfBadgeHideTimer = 0;
      let _perfEyeFrame = 0;
      let _perfMacFeedFrame = 0;
      let _perfScreenVideoFrame = 0;
      let _perfAirPlaneFrame = 0;
      let _perfChargerFrame = 0;
      let _physCoalesceDt = 0;
      let _tabVisible = !document.hidden;
      let _deskFlamesWereHidden = true;
      const perfBadgeEl = document.getElementById("perfBadge");

      function getBloomRenderScale() {
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
        perfGumMaxSubstepsFill = perfSettings.gumMaxSubFill;
        perfGumMaxSubstepsMixed = perfSettings.gumMaxSubMixed;
        perfGumMaxSubstepsDynamic = perfSettings.gumMaxSubDynamic;
        perfAnisotropyCap = perfSettings.anisotropyCap;
        perfEyeTrackingEvery = perfSettings.eyeTrackingEvery;
        perfMacFeedEvery = perfSettings.macFeedEvery;
        perfScreenVideoEvery = perfSettings.screenVideoEvery;
        perfAirPlaneEvery = perfSettings.airPlaneEvery;
        perfChargerEvery = perfSettings.chargerEvery;
        perfPhysicsIdleCoalesce = perfSettings.physicsIdleCoalesce;
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

      function applyPerformanceSettings() {
        const s = perfSettings;
        if (useVisualParity()) {
          renderer.shadowMap.enabled = true;
          if (typeof carShadowLight !== "undefined") {
            carShadowLight.castShadow = true;
            carShadowLight.shadow.mapSize.set(512, 512);
            carShadowLight.shadow.radius = 4;
          }
          if (typeof smaaPass !== "undefined") smaaPass.enabled = true;
          if (typeof sharpenPass !== "undefined") sharpenPass.enabled = true;
          sceneBloomEnabled = false;
        } else {
          renderer.shadowMap.enabled = s.shadows;
          if (typeof carShadowLight !== "undefined") {
            carShadowLight.castShadow = s.shadows;
            if (s.shadows && s.shadowMapSize > 0) {
              carShadowLight.shadow.mapSize.set(s.shadowMapSize, s.shadowMapSize);
              carShadowLight.shadow.radius = s.shadowMapSize >= 512 ? 4 : 2;
            }
          }
          if (typeof smaaPass !== "undefined") smaaPass.enabled = s.smaa;
          if (typeof sharpenPass !== "undefined") sharpenPass.enabled = s.sharpen;
          sceneBloomEnabled = s.bloom;
        }
        if (physicsWorld) {
          physicsWorld.solver.iterations = s.physicsIterations;
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

      function getMacScreenRtDimensions() {
        const scale = perfSettings.macScreenScale;
        return {
          w: Math.max(160, Math.round(640 * scale)),
          h: Math.max(90, Math.round(360 * scale)),
        };
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
      getOfficeSceneMount().appendChild(canvas);
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
        3.0,
        1.6,
        0.12,
      );
      carLightsBloomPass.highPassUniforms.smoothWidth.value = 0.4;
      carLightsBloomPass.threshold = 0.006;

      const bloomComposer = new EffectComposer(renderer);
      bloomComposer.renderToScreen = false;
      bloomComposer.addPass(renderScenePass);
      bloomComposer.addPass(carLightsBloomPass);

      const carBloomMixPass = new ShaderPass(
        new THREE.ShaderMaterial({
          uniforms: {
            baseTexture: { value: null },
            bloomTexture: { value: bloomComposer.renderTarget2.texture },
            bloomIntensity: { value: 2.35 },
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
      sharpenPass.enabled = perfSettings.sharpen;
      sceneBloomEnabled = perfSettings.bloom;

      /** Composer RT uses stencil where needed; optional MSAA on WebGL2. */
      function syncFinalComposerMsaaTargets() {
        const buf = new THREE.Vector2();
        renderer.getDrawingBufferSize(buf);
        const effW = Math.max(2, Math.floor(buf.x));
        const effH = Math.max(2, Math.floor(buf.y));
        let samples = 0;
        if (renderer.capabilities.isWebGL2) {
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
          console.warn("Final composer render target unavailable:", err);
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

      function applySceneEnvironmentToMaterial(mat) {
        if (mat && scene.environment) mat.envMap = scene.environment;
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
          gumsTankGlassMaterial.envMap = envMap;
          certifiedBodyMaterial.envMap = envMap;
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

      // Lights + windowTris: one blend (lightBlend, 0→1) drives both.
      // Dark / “blinds closed”: lightBlend → 0 (Key O) — tilted tris, darker scene.
      // Bright / “blinds open”: lightBlend → 1 (Key P) — flat tris, lighter scene.
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
      // Office preset is captured at startup.
      const _darkModeOffice = JSON.parse(JSON.stringify(darkMode));
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
      let outdoorBackdropMaterial = null;
      let outdoorBackdropMesh = null;
      const _cDark = new THREE.Color();
      const _cBright = new THREE.Color();
      function applyLightBlend(b) {
        const _blendBright = (darkV, brightV) => darkV + (brightV - darkV) * b;
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
        if (outdoorBackdropMesh) {
          if (outdoorBackdropMaterial) {
            const opacity = THREE.MathUtils.clamp(
              OUTDOOR_BACKGROUND_OPACITY *
                b *
                THREE.MathUtils.lerp(0.9, 1.12, b),
              0,
              1,
            );
            outdoorBackdropMaterial.opacity = opacity;
            outdoorBackdropMesh.visible = opacity > 1e-3;
          } else {
            outdoorBackdropMesh.visible = b > 1e-3;
          }
        }
      }
      document.addEventListener("keydown", (e) => {
        if (e.code === "KeyO") {
          e.preventDefault();
          if (!compactSpacingActive) lightBlendTarget = 0; // dark + windowTris closed
        }
        if (e.code === "KeyP") {
          e.preventDefault();
          lightBlendTarget = 1; // bright + windowTris open
        }
        if (e.code === "KeyI" && lightBlendTarget === 1) {
          e.preventDefault();
          compactSpacingActive = !compactSpacingActive;
          compactSpacingAnimFrom = compactSpacingBlend;
          compactSpacingAnimStart = performance.now() / 1000;
        }
        if (e.code === "KeyQ") {
          e.preventDefault();
        }
        if (e.code === "KeyM") {
          e.preventDefault();
          if (drawerGroup && _drawerState === "closed") {
            _drawerState = "opening";
            _drawerAnimStart = performance.now();
            _drawerOrigZ = drawerGroup.position.z;
          }
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
          switchCarView(carCameraFollow);
        }
      });

      // --- Car from car-game12.gltf (loaded when table is ready) ---
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
      let bottleGroup = null;
      let bottleBodyMesh = null, bottleBaseMesh = null, bottleCupMesh = null;
      let bottlePhisicMesh = null;
      let bottlePhysBody = null;
      let certifiedGroup = null;
      let certifiedPhysicMesh = null;
      let certifiedPhysBody = null;
      let gumDispenserGroup = null;
      let gumDispenserPhysicMesh = null;
      let gumDispenserPhysBody = null;
      let conusGroup = null;
      let conusPhysBody = null;
      let drawerGroup = null;
      let _drawerOrigZ = 0;
      let _drawerState = "closed";
      let _drawerAnimStart = 0;
      const DRAWER_SLIDE_DISTANCE = 4.7;
      const DRAWER_SLIDE_DURATION = 500;
      const DRAWER_OPEN_HOLD = 7000;
      let _portalGroup = null;
      let _portalParticles = null;
      let _portalRim = null;
      let _portalOpacity = 0;
      let _drawerEffectMesh = null;
      const PORTAL_FADE_DURATION = 800;
      let _gumDispenserInternalBodies = [];
      let _gumDispenserInitPos = null;
      let _gumDispenserInitQuat = null;
      let _bottleInitPos = null;
      let _bottleInitQuat = null;
      let _certifiedInitPos = null;
      let _certifiedInitQuat = null;
      const _bottleWorldPos = new THREE.Vector3();
      const _bottleWorldQuat = new THREE.Quaternion();
      const _canonWorldPos = new THREE.Vector3();
      const _canonWorldQuat = new THREE.Quaternion();
      const _wheelSyncWorldPos = [
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
      ];
      const _wheelsList = [null, null, null, null];
      const _wheelHadBottom = [false, false, false, false];
      const _gumClampTmp = new THREE.Vector3();
      const _gumTankMwCached = new THREE.Matrix4();
      const _invTankMwGumClamp = new THREE.Matrix4();
      const GUM_CELL_STRIDE = 2048;
      const GUM_CELL_OFF = 1024;
      const _gumCellMap = new Map();
      const _gumCellTouched = [];
      car = new THREE.Group();
      car.rotation.order = "YXZ";
      scene.add(car);

      const MAX_STEER_DEG = 28;
      const MAX_STEER_RAD = (MAX_STEER_DEG * Math.PI) / 180;
      const CAR_SCALE_MULTIPLIER = 0.72;
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
      const RAMP_JUMP_SLOW_MO_EDGE = 0.26;
      const RAMP_JUMP_SLOW_MO_PEAK = 0.08;
      const RAMP_JUMP_SLOW_MO_MATRIX_EDGE = 0.2;
      const RAMP_JUMP_SLOW_MO_MATRIX_PEAK = 0.055;
      const RAMP_JUMP_SLOW_MO_CHANCE = 0.68;
      const RAMP_JUMP_SLOW_MO_CHANCE_MAX = 0.94;
      const RAMP_JUMP_MATRIX_CHANCE = 0.4;
      const RAMP_JUMP_CAM_ZOOM = 0.88;
      const RAMP_JUMP_CAM_ZOOM_PEAK = 0.58;
      const RAMP_JUMP_CAM_ZOOM_MATRIX_PEAK = 1;
      const RAMP_JUMP_CAM_ZOOM_MATRIX_ORBIT_END = 0.38;
      const RAMP_JUMP_MATRIX_ZOOM_MIN_FRAC = 0.65;
      const RAMP_JUMP_SLOW_MO_DRIFT_SCALE = 0.18;
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
      let _officeWorldRoot = null;
      let _officeAnimMixer = null;
      let _officeAnimClips = [];
      let _officeArmatureAction = null;

      function initOfficeAnimations(gltf) {
        if (!gltf?.animations?.length) return;
        _officeAnimMixer = new THREE.AnimationMixer(gltf.scene);
        _officeAnimClips = gltf.animations.filter(
          (clip) => clip.name === "ArmatureAction",
        );
        if (!_officeAnimClips.length) {
          console.warn("Office ArmatureAction clip not found in GLTF");
          return;
        }
        _officeArmatureAction = _officeAnimMixer.clipAction(_officeAnimClips[0]);
      }

      function resetOfficeArmatureBindPose() {
        if (!_officeWorldRoot) return;
        _officeWorldRoot.traverse((node) => {
          if (node.isSkinnedMesh?.skeleton) node.skeleton.pose();
        });
      }

      function startHandWalkArmatureLoop() {
        if (!_officeArmatureAction) return;
        resetOfficeArmatureBindPose();
        const action = _officeArmatureAction;
        action.stop();
        action.reset();
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
        action.timeScale = 1;
        action.enabled = true;
        action.paused = false;
        action.play();
      }

      function playHandWalkWarningAnimation() {
        if (!_officeArmatureAction || _handWalkZPhase !== 0) return;
        resetOfficeArmatureBindPose();
        const action = _officeArmatureAction;
        action.stop();
        action.reset();
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.timeScale = 1;
        action.enabled = true;
        action.paused = false;
        action.play();
      }

      function maintainHandWalkArmatureLoop() {
        if (_handWalkZPhase === 0 || !_officeArmatureAction) return;
        const action = _officeArmatureAction;
        if (action.loop !== THREE.LoopRepeat || action.clampWhenFinished) {
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.clampWhenFinished = false;
        }
        if (!action.isRunning()) {
          action.enabled = true;
          action.paused = false;
          action.play();
        }
      }

      function stopOfficeArmatureAnimation() {
        if (_officeArmatureAction) {
          _officeArmatureAction.stop();
        } else if (_officeAnimMixer) {
          _officeAnimMixer.stopAllAction();
        }
        resetOfficeArmatureBindPose();
      }

      let _handWalkRestPos = new THREE.Vector3();
      let _handTriggerOutsideTime = 0;
      const HAND_TRIGGER_LEAVE_RESET_SEC = 0.4;

      function resetHandWalkTriggerCycle() {
        _handTriggerInsideTime = 0;
        _handTriggerOutsideTime = 0;
        _handWalkZTriggeredThisVisit = false;
        _handWalkTriggerWasInside = false;
      }

      function updateHandWalkZMove(dt) {
        maintainHandWalkArmatureLoop();
        if (!handWalkPart || _handWalkZPhase === 0) return;
        _handWalkZMoveT += dt;
        const t = Math.min(_handWalkZMoveT / HAND_WALK_Z_MOVE_SEC, 1);
        const ease = t * t * (3 - 2 * t);
        const zOut = _handWalkRestPos.z + HAND_WALK_Z_OFFSET;
        if (_handWalkZPhase === 1) {
          handWalkPart.position.z = THREE.MathUtils.lerp(_handWalkRestPos.z, zOut, ease);
          if (t >= 1) {
            _handWalkZPhase = 2;
            _handWalkZMoveT = 0;
          }
        } else if (_handWalkZPhase === 2) {
          handWalkPart.position.z = THREE.MathUtils.lerp(zOut, _handWalkRestPos.z, ease);
          if (t >= 1) {
            handWalkPart.position.z = _handWalkRestPos.z;
            _handWalkZPhase = 0;
            _handWalkZMoveT = 0;
            stopOfficeArmatureAnimation();
          }
        }
        handWalkPart.updateMatrixWorld(true);
      }

      function resetHandWalkZMove() {
        const wasMoving = _handWalkZPhase !== 0;
        _handWalkZPhase = 0;
        _handWalkZMoveT = 0;
        if (handWalkPart) {
          handWalkPart.position.copy(_handWalkRestPos);
          handWalkPart.updateMatrixWorld(true);
        }
        if (wasMoving) stopOfficeArmatureAnimation();
      }

      function updateHandWalkTrigger(dt) {
        if (_handWalkZPhase !== 0) {
          updateHandWalkZMove(dt);
          if (_handWalkZPhase !== 0) return;
        }

        if (!handWalkTriggerMesh || !car || carFalling) {
          resetHandWalkTriggerCycle();
          resetHandWalkZMove();
          return;
        }
        handWalkTriggerMesh.updateMatrixWorld(true);
        _handWalkTriggerBox.setFromObject(handWalkTriggerMesh);
        if (_handWalkTriggerBox.isEmpty()) return;

        const inside = _handWalkTriggerBox.containsPoint(car.position);
        if (!inside) {
          _handWalkTriggerWasInside = false;
          if (_handWalkZPhase === 0) stopOfficeArmatureAnimation();
          if (_handWalkZTriggeredThisVisit && _handWalkZPhase === 0) {
            resetHandWalkTriggerCycle();
          } else if (!_handWalkZTriggeredThisVisit) {
            _handTriggerOutsideTime += dt;
            if (_handTriggerOutsideTime >= HAND_TRIGGER_LEAVE_RESET_SEC) {
              _handTriggerInsideTime = 0;
              _handTriggerOutsideTime = 0;
            }
          }
          return;
        }

        _handTriggerOutsideTime = 0;

        if (!_handWalkTriggerWasInside) {
          _handWalkTriggerWasInside = true;
          if (_handTriggerInsideTime === 0 && !_handWalkZTriggeredThisVisit) {
            playHandWalkWarningAnimation();
          }
        }

        if (!_handWalkZTriggeredThisVisit && _handWalkZPhase === 0) {
          _handTriggerInsideTime += dt;
        }

        if (
          !_handWalkZTriggeredThisVisit &&
          _handTriggerInsideTime >= HAND_TRIGGER_HOLD_SEC &&
          _handWalkZPhase === 0 &&
          handWalkPart
        ) {
          _handWalkZTriggeredThisVisit = true;
          _handWalkRestPos.copy(handWalkPart.position);
          _handWalkZPhase = 1;
          _handWalkZMoveT = 0;
          startHandWalkArmatureLoop();
        }

        updateHandWalkZMove(dt);
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
        if (e.code === "KeyQ") releaseGumsCup();
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

      const GUM_RELEASE_BATCH = 15;
      let _gumReleaseIdx = -1;
      let _gumReleasedTimer = 0;

      const CUP_SLIDE_DISTANCE = 4;
      const CUP_SLIDE_DURATION = 500;
      let _cupSlideActive = false;
      let _cupSlideStart = 0;
      let _cupOrigX = 0;

      function releaseGumsCup() {
        if (!gumsTankCupBody || gumsCupRemovedUntil > performance.now()) return;
        if (_cupSlideActive) return;
        _cupOrigX = gumsTankCupBody.position.x;
        _cupSlideActive = true;
        _cupSlideStart = performance.now();
        _gumReleaseIdx = 0;
        _gumReleasedTimer = 0;
        _releaseGumBatch();
        gumsCupRemovedUntil = performance.now() + CUP_SLIDE_DURATION;
      }

      function updateCupSlide() {
        if (!_cupSlideActive || !gumsTankCupBody) return;
        const elapsed = performance.now() - _cupSlideStart;
        const t = Math.min(elapsed / CUP_SLIDE_DURATION, 1);
        const ease = t < 0.5
          ? 2 * t * t
          : 1 - 2 * (1 - t) * (1 - t);
        const offset = ease < 0.5
          ? CUP_SLIDE_DISTANCE * (ease * 2)
          : CUP_SLIDE_DISTANCE * (2 - ease * 2);
        gumsTankCupBody.position.x = _cupOrigX + offset;
        if (t >= 1) {
          gumsTankCupBody.position.x = _cupOrigX;
          _cupSlideActive = false;
        }
      }

      function _releaseGumBatch() {
        if (_gumReleaseIdx < 0) return;
        const end = Math.min(_gumReleaseIdx + GUM_RELEASE_BATCH, gumsAddedCount);
        for (let i = _gumReleaseIdx; i < end; i++) {
          const b = gumBodies[i];
          gumReleased.add(i);
          if (b.type === CANNON.Body.STATIC && b.mass > 0) {
            b.type = CANNON.Body.DYNAMIC;
            b.updateMassProperties();
          }
          b.wakeUp();
        }
        _gumReleaseIdx = end;
        if (_gumReleaseIdx < gumsAddedCount) {
          requestAnimationFrame(_releaseGumBatch);
        } else {
          _gumReleaseIdx = -1;
        }
      }

      // Screen video state (same config as car-game.html)
      let leftScreenMesh = null;
      let rightScreenMesh = null;
      const rightScreenVideoSrc = officeAsset("./Build_a_website_you_love_1080P.mp4");
      let leftScreenVideoTexture = null;
      let leftScreenVideo = null;
      let leftScreenCanvas = null;
      const leftScreenVideoScale = 1.7;
      const leftScreenVideoWidth = 1920;
      const leftScreenVideoHeight = 300;
      const leftScreenVideoOffsetX = 0;
      const leftScreenVideoOffsetY = 770;
      const leftScreenVideoHeightStretch = 1.75;
      const leftScreenVideoLeft = 0;
      const leftScreenVideoRight = 0;
      const leftScreenVideoTop = 0;
      const leftScreenVideoBottom = 0;
      let rightScreenVideo = null;
      let rightScreenCanvas = null;
      let rightScreenVideoTexture = null;
      let macScreenMesh = null;
      let macFrontCamera = null;
      let macScreenRenderTarget = null;
      let _macFrontCamDist = 2;
      let _macFrontNoseOffset = 0.35;
      let _macFrontGrilleHeight = 0.4;
      const _macFrontLookAt = new THREE.Vector3();
      const _macCarFaceDir = new THREE.Vector3();
      const _macWheelL = new THREE.Vector3();
      const _macWheelR = new THREE.Vector3();
      const _macHeadlight = new THREE.Vector3();
      const _macFrontCarBox = new THREE.Box3();
      const _macCarSize = new THREE.Vector3();
      const _macSpawnLocal = new THREE.Vector3();
      const _macSpawnWorld = new THREE.Vector3();
      const _macKbQuat = new THREE.Quaternion();
      const _macKbRight = new THREE.Vector3();
      const MAC_CAR_START_LOCAL_X = 0;
      const MAC_CAR_START_LOCAL_Z = -0.32;
      const MAC_CAR_START_YAW_OFFSET = Math.PI * 1.5;
      const MAC_SCREEN_RT_W = 640;
      const MAC_SCREEN_RT_H = 360;
      const MAC_FRONT_CAM_DIST_FACTOR = 2.05;
      const MAC_FRONT_CAM_FOV = 48;
      const rightScreenVideoScale = 1.7;
      const rightScreenVideoWidth = 1920;
      const rightScreenVideoHeight = 300;
      const rightScreenVideoOffsetX = 0;
      const rightScreenVideoOffsetY = 770;
      const rightScreenVideoHeightStretch = 1.75;
      const rightScreenVideoLeft = 0;
      const rightScreenVideoRight = 0;
      const rightScreenVideoTop = 0;
      const rightScreenVideoBottom = 0;

      const OUTDOOR_FALLBACK_GLTF = officeAsset("office-table-embed34.gltf");
      const OUTDOOR_BACKGROUND_Y_SCALE = 1.35;
      const OUTDOOR_BACKGROUND_OPACITY = 0.65;

      function setOutdoorBackdropInteriorNormals(geometry) {
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        const cx = (box.min.x + box.max.x) * 0.5;
        const cy = (box.min.y + box.max.y) * 0.5;
        const cz = (box.min.z + box.max.z) * 0.5;
        const pos = geometry.attributes.position;
        let norm = geometry.attributes.normal;
        if (!norm || norm.count !== pos.count) {
          norm = new THREE.Float32BufferAttribute(
            new Float32Array(pos.count * 3),
            3,
          );
          geometry.setAttribute("normal", norm);
        }
        for (let i = 0; i < pos.count; i++) {
          let nx = cx - pos.getX(i);
          let ny = cy - pos.getY(i);
          let nz = cz - pos.getZ(i);
          const len = Math.hypot(nx, ny, nz);
          if (len < 1e-10) {
            nx = 0;
            ny = 1;
            nz = 0;
          } else {
            nx /= len;
            ny /= len;
            nz /= len;
          }
          norm.setXYZ(i, nx, ny, nz);
        }
        norm.needsUpdate = true;
      }

      function applyOutdoorPanoramaTexture(outdoorBgMesh) {
        outdoorBackdropMesh = outdoorBgMesh;
        new THREE.TextureLoader().load(
          officeAsset("panoramicView.jpg"),
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.flipY = false;
            tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = false;
            tex.anisotropy = Math.min(
              8,
              renderer.capabilities.getMaxAnisotropy(),
            );
            const srcGeo = outdoorBgMesh.geometry;
            const uvAttr = srcGeo.attributes.uv;
            tex.center.set(0.5, 0.5);
            let didBakeOutdoorUv = false;
            if (uvAttr) {
              let uMin = Infinity,
                uMax = -Infinity,
                vMin = Infinity,
                vMax = -Infinity;
              for (let i = 0; i < uvAttr.count; i++) {
                uMin = Math.min(uMin, uvAttr.getX(i));
                uMax = Math.max(uMax, uvAttr.getX(i));
                vMin = Math.min(vMin, uvAttr.getY(i));
                vMax = Math.max(vMax, uvAttr.getY(i));
              }
              const du = uMax - uMin;
              const dv = vMax - vMin;
              if (du > 1e-8 && dv > 1e-8) {
                const bakedGeo = srcGeo.clone();
                const uvB = bakedGeo.attributes.uv;
                const posB = bakedGeo.attributes.position;
                let angMin = Infinity,
                  angMax = -Infinity;
                for (let i = 0; i < posB.count; i++) {
                  const a = Math.atan2(posB.getZ(i), posB.getX(i));
                  angMin = Math.min(angMin, a);
                  angMax = Math.max(angMax, a);
                }
                const angSpan = angMax - angMin;
                const useArcU =
                  angSpan > 0.5 && angSpan <= Math.PI * 2.05;
                const iw = tex.image.width;
                const ih = tex.image.height;
                const imgAspect = iw > 0 && ih > 0 ? iw / ih : 1;
                const uvAspect = useArcU ? 1 : du / dv;
                for (let i = 0; i < uvB.count; i++) {
                  let un;
                  if (useArcU) {
                    const a = Math.atan2(posB.getZ(i), posB.getX(i));
                    un = (a - angMin) / angSpan;
                  } else {
                    un = (uvAttr.getX(i) - uMin) / du;
                  }
                  un = THREE.MathUtils.clamp(un, 0, 1);
                  const vn = (uvAttr.getY(i) - vMin) / dv;
                  let su = un;
                  let sv = vn;
                  if (iw > 0 && ih > 0) {
                    if (imgAspect > uvAspect) {
                      su = 0.5 + (un - 0.5) * (uvAspect / imgAspect);
                      sv = vn;
                    } else if (imgAspect < uvAspect) {
                      su = un;
                      sv = 0.5 + (vn - 0.5) * (imgAspect / uvAspect);
                    }
                  }
                  uvB.setXY(i, su, sv);
                }
                const idx = bakedGeo.index;
                if (idx) {
                  for (let ti = 0; ti < idx.count; ti += 3) {
                    const ia = idx.getX(ti),
                      ib = idx.getX(ti + 1),
                      ic = idx.getX(ti + 2);
                    const ua = uvB.getX(ia),
                      va = uvB.getY(ia);
                    const ub = uvB.getX(ib),
                      vb = uvB.getY(ib);
                    const uc = uvB.getX(ic),
                      vc = uvB.getY(ic);
                    const uvCross =
                      (ub - ua) * (vc - va) - (vb - va) * (uc - ua);
                    if (uvCross < 0) {
                      idx.setX(ti + 1, ic);
                      idx.setX(ti + 2, ib);
                    }
                  }
                  idx.needsUpdate = true;
                }
                setOutdoorBackdropInteriorNormals(bakedGeo);
                tex.repeat.set(1, 1);
                tex.offset.set(0, 0);
                uvB.needsUpdate = true;
                outdoorBgMesh.geometry = bakedGeo;
                didBakeOutdoorUv = true;
              }
            }
            if (!didBakeOutdoorUv) {
              tex.repeat.set(1, 1);
              tex.offset.set(0, 0);
            }
            const mat = new THREE.MeshStandardMaterial({
              map: tex,
              emissiveMap: tex,
              emissive: new THREE.Color(0xffffff),
              emissiveIntensity: 0.32,
              roughness: 0.55,
              metalness: 0,
              side: THREE.DoubleSide,
              transparent: true,
              opacity: OUTDOOR_BACKGROUND_OPACITY,
            });
            if (scene.environment) {
              mat.envMap = scene.environment;
              mat.envMapIntensity = 1.35;
            }
            if (Array.isArray(outdoorBgMesh.material)) {
              for (let i = 0; i < outdoorBgMesh.material.length; i++)
                outdoorBgMesh.material[i] = mat;
              outdoorBackdropMaterial = outdoorBgMesh.material[0];
            } else {
              outdoorBgMesh.material = mat;
              outdoorBackdropMaterial = mat;
            }
            applyLightBlend(lightBlend);
          },
          undefined,
          (err) => console.warn("panoramicView.jpg load failed:", err),
        );
      }

      function findScreenMeshes(model) {
        model.traverse((node) => {
          if (!node.isMesh) return;
          if (node.name === "floor") {
            const fSize = 512;
            const fCanvas = document.createElement("canvas");
            fCanvas.width = fSize;
            fCanvas.height = fSize;
            const fCtx = fCanvas.getContext("2d");
            fCtx.fillStyle = "#5a544d";
            fCtx.fillRect(0, 0, fSize, fSize);
            for (let i = 0; i < 1200; i++) {
              const x = Math.random() * fSize;
              const y = Math.random() * fSize;
              const r = 0.3 + Math.random() * 1;
              const bright = 40 + Math.floor(Math.random() * 80);
              fCtx.fillStyle = `rgba(${bright},${bright - 5},${bright - 10},${0.4 + Math.random() * 0.5})`;
              fCtx.beginPath();
              fCtx.ellipse(x, y, r, r * (0.6 + Math.random() * 0.8), Math.random() * Math.PI, 0, Math.PI * 2);
              fCtx.fill();
            }
            for (let i = 0; i < 400; i++) {
              const x = Math.random() * fSize;
              const y = Math.random() * fSize;
              const r = 0.2 + Math.random() * 0.6;
              const bright = 150 + Math.floor(Math.random() * 60);
              fCtx.fillStyle = `rgba(${bright},${bright - 3},${bright - 8},${0.3 + Math.random() * 0.4})`;
              fCtx.beginPath();
              fCtx.arc(x, y, r, 0, Math.PI * 2);
              fCtx.fill();
            }
            const floorTex = new THREE.CanvasTexture(fCanvas);
            floorTex.wrapS = THREE.RepeatWrapping;
            floorTex.wrapT = THREE.RepeatWrapping;
            floorTex.repeat.set(4, 4);
            node.material = new THREE.MeshStandardMaterial({
              map: floorTex,
              roughness: 0.7,
              metalness: 0,
            });
          }
          if (node.name === "smallChair") {
            node.material = new THREE.MeshStandardMaterial({
              color: new THREE.Color(0.85, 0.12, 0.02),
              metalness: 0,
              roughness: 0.85,
              emissive: new THREE.Color(0.12, 0.03, 0.003),
            });
          }
          if (node.name === "smallChairCover") {
            node.material = new THREE.MeshStandardMaterial({
              color: 0x3a3a3a,
              metalness: 0,
              roughness: 0.95,
            });
          }
          if (node.name === "windowGlass") {
            node.material = new THREE.MeshPhysicalMaterial({
              color: 0xddeeff,
              transparent: true,
              opacity: 0.15,
              metalness: 0,
              roughness: 0.02,
              transmission: 0.92,
              thickness: 0.3,
              ior: 1.52,
              reflectivity: 0.5,
              envMapIntensity: 1.5,
              side: THREE.DoubleSide,
              depthWrite: false,
            });
            if (scene.environment) node.material.envMap = scene.environment;
          }
          if (node.name === "drawerCover" || node.name === "drawerHang") {
            node.material = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              roughness: 0.5,
              metalness: 0.08,
              transparent: false,
              opacity: 1.0,
              depthWrite: true,
            });
            node.renderOrder = 0;
          }
          if (node.name === "drawerPannel") {
            node.material = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              roughness: 0.5,
              metalness: 0.08,
              side: THREE.DoubleSide,
              transparent: false,
              opacity: 1.0,
              depthWrite: true,
            });
            node.renderOrder = 0;
          }
          if (node.name === "leftScreen") leftScreenMesh = node;
          if (node.name === "rightScreen") rightScreenMesh = node;
          if (node.name === "poster1") {
            const posterMesh = node;
            new THREE.TextureLoader().load(
              officeAsset("poster1.jpg"),
              (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.flipY = false;
                tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
                tex.anisotropy = Math.min(
                  8,
                  renderer.capabilities.getMaxAnisotropy(),
                );
                const mat = new THREE.MeshStandardMaterial({
                  map: tex,
                  emissiveMap: tex,
                  emissive: new THREE.Color(0xffffff),
                  emissiveIntensity: 0.32,
                  roughness: 0.55,
                  metalness: 0,
                  side: THREE.DoubleSide,
                });
                if (scene.environment) {
                  mat.envMap = scene.environment;
                  mat.envMapIntensity = 1.35;
                }
                if (Array.isArray(posterMesh.material)) {
                  for (let i = 0; i < posterMesh.material.length; i++)
                    posterMesh.material[i] = mat;
                } else {
                  posterMesh.material = mat;
                }
                const posterDup = posterMesh.clone();
                posterDup.name = "poster2";
                const geo = posterMesh.geometry;
                if (!geo.boundingBox) geo.computeBoundingBox();
                const bb = geo.boundingBox;
                const widthX =
                  (bb.max.x - bb.min.x) * Math.abs(posterMesh.scale.x);
                const gap = Math.max(0.02, widthX * 0.06);
                posterDup.position.x += widthX * 2.05 + gap;
                if (posterMesh.parent) posterMesh.parent.add(posterDup);
                new THREE.TextureLoader().load(
                  officeAsset("poster2.png"),
                  (tex2) => {
                    tex2.colorSpace = THREE.SRGBColorSpace;
                    tex2.flipY = false;
                    tex2.wrapS = tex2.wrapT = THREE.ClampToEdgeWrapping;
                    tex2.anisotropy = Math.min(
                      8,
                      renderer.capabilities.getMaxAnisotropy(),
                    );
                    const mat2 = new THREE.MeshStandardMaterial({
                      map: tex2,
                      emissiveMap: tex2,
                      emissive: new THREE.Color(0xffffff),
                      emissiveIntensity: 0.32,
                      roughness: 0.55,
                      metalness: 0,
                      side: THREE.DoubleSide,
                    });
                    if (scene.environment) {
                      mat2.envMap = scene.environment;
                      mat2.envMapIntensity = 1.35;
                    }
                    if (Array.isArray(posterDup.material)) {
                      for (let i = 0; i < posterDup.material.length; i++)
                        posterDup.material[i] = mat2;
                    } else {
                      posterDup.material = mat2;
                    }
                  },
                  undefined,
                  (err) => console.warn("poster2.png load failed:", err),
                );
              },
              undefined,
              (err) => console.warn("poster1.jpg load failed:", err),
            );
          }
          if (node.name === "outdoorBackground") {
            node.scale.y *= OUTDOOR_BACKGROUND_Y_SCALE;
            applyOutdoorPanoramaTexture(node);
          }
          if (node.name === "macScreenFrame") {
            node.material = new THREE.MeshStandardMaterial({
              color: 0x6e6e78,
              metalness: 0.85,
              roughness: 0.45,
              envMapIntensity: 1.8,
              emissive: 0x0e0e10,
            });
            if (scene.environment) node.material.envMap = scene.environment;
          }
          if (node.name === "macBodyBase") {
            node.material = new THREE.MeshStandardMaterial({
              color: 0x6e6e78,
              metalness: 0.85,
              roughness: 0.45,
              envMapIntensity: 1.8,
              emissive: 0x0e0e10,
            });
            if (scene.environment) node.material.envMap = scene.environment;
          }
          if (node.name === "macKeyboard") {
            const kbMat = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              metalness: 0.3,
              roughness: 0.6,
            });
            new THREE.TextureLoader().load(officeAsset("keyboard image.jpg"), (tex) => {
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.wrapS = THREE.ClampToEdgeWrapping;
              tex.wrapT = THREE.ClampToEdgeWrapping;
              tex.center.set(0.5, 0.5);
              tex.repeat.set(4.0, 4.0);
              tex.offset.set(1.0, 0.5);
              tex.rotation = 0;
              kbMat.map = tex;
              kbMat.needsUpdate = true;
            });
            node.material = kbMat;
          }
          if (node.name === "techGuide") {
            node.position.x += 1.2;
            node.position.z += 3.5;
          }
          if (node.name === "macScreen" && node.isMesh) {
            setupMacScreenFeed(node);
          }
          if (node.name === "panHolder") {
            node.material = new THREE.MeshStandardMaterial({
              color: new THREE.Color(0.85, 0.7, 0.18),
              metalness: 0.1,
              roughness: 0.35,
              emissive: new THREE.Color(0.1, 0.08, 0.02),
            });
          }
          if (node.name === "bottleBody") {
            node.material = new THREE.MeshStandardMaterial({
              color: new THREE.Color(1.0, 0.25, 0.08),
              metalness: 0.15,
              roughness: 0.25,
              emissive: new THREE.Color(0.12, 0.015, 0.005),
            });
          }
          if (node.name === "bottleBase") {
            node.material = new THREE.MeshStandardMaterial({
              color: new THREE.Color(0.95, 0.8, 0.25),
              metalness: 0.15,
              roughness: 0.25,
              emissive: new THREE.Color(0.12, 0.1, 0.03),
            });
          }
          if (node.name === "bottleCup") {
            node.material = new THREE.MeshPhysicalMaterial({
              color: 0xe0e0e4,
              metalness: 0.75,
              roughness: 0.2,
              reflectivity: 0.9,
              clearcoat: 0.3,
              clearcoatRoughness: 0.1,
              envMapIntensity: 2.5,
              emissive: 0x2a2a2e,
            });
            if (scene.environment) node.material.envMap = scene.environment;
          }
        });
        // If screens are parent nodes, use first mesh under them
        if (!leftScreenMesh || !rightScreenMesh) {
          model.traverse((node) => {
            if (node.isMesh) return;
            if (node.name === "leftScreen") {
              node.traverse((n) => {
                if (n.isMesh && !leftScreenMesh) leftScreenMesh = n;
              });
            }
            if (node.name === "rightScreen") {
              node.traverse((n) => {
                if (n.isMesh && !rightScreenMesh) rightScreenMesh = n;
              });
            }
            if (node.name === "macScreen") {
              node.traverse((n) => {
                if (n.isMesh && !macScreenMesh) setupMacScreenFeed(n);
              });
            }
          });
        }
      }

      const tablePlateMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.5,
        metalness: 0.08,
      });

      function applyTablePlateMaterial(mesh) {
        if (!mesh) return;
        if (Array.isArray(mesh.material)) {
          for (let i = 0; i < mesh.material.length; i++)
            mesh.material[i] = tablePlateMaterial;
        } else {
          mesh.material = tablePlateMaterial;
        }
      }

      function findTablePlateMesh(model) {
        model.traverse((node) => {
          if (!node.isMesh) return;
          if (
            node.name === "tablePlate" ||
            (node.parent && node.parent.name === "tablePlate")
          ) {
            if (!tablePlateMesh) tablePlateMesh = node;
          }
        });
        if (!tablePlateMesh) {
          model.traverse((node) => {
            if (node.name === "tablePlate" && !node.isMesh) {
              node.traverse((n) => {
                if (n.isMesh && !tablePlateMesh) tablePlateMesh = n;
              });
            }
          });
        }
      }

      const tableSideWallMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.7,
        metalness: 0.02,
      });

      function applyTableSideWall(model) {
        model.traverse((node) => {
          if (!node.isMesh) return;
          const name = node.name || "";
          const parentName = (node.parent && node.parent.name) || "";
          if (name === "tableSideWall" || parentName === "tableSideWall") {
            if (Array.isArray(node.material)) {
              for (let i = 0; i < node.material.length; i++) node.material[i] = tableSideWallMaterial;
            } else {
              node.material = tableSideWallMaterial;
            }
          }
        });
      }

      function applyTablePlate(model) {
        model.traverse((node) => {
          if (
            node.isMesh &&
            (node.name === "tablePlate" ||
              (node.parent && node.parent.name === "tablePlate"))
          ) {
            applyTablePlateMaterial(node);
          }
        });
        model.traverse((node) => {
          if (node.name === "tablePlate" && !node.isMesh) {
            node.traverse((n) => {
              if (n.isMesh) applyTablePlateMaterial(n);
            });
          }
        });
      }

      const roomRoofPlaneMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 1,
        metalness: 0,
      });

      function applyRoomRoofPlaneMaterial(model) {
        model.traverse((node) => {
          if (!node.isMesh) return;
          if (
            node.name === "roomRoofPlane" ||
            (node.parent && node.parent.name === "roomRoofPlane")
          ) {
            if (Array.isArray(node.material)) {
              for (let i = 0; i < node.material.length; i++)
                node.material[i] = roomRoofPlaneMaterial;
            } else {
              node.material = roomRoofPlaneMaterial;
            }
          }
        });
      }

      const roomLightMaterial = new THREE.MeshStandardMaterial({
        color: 0xfff8f0,
        emissive: 0xffeedd,
        emissiveIntensity: 0.85,
        roughness: 0.7,
        metalness: 0,
      });

      function applyRoomLightMaterial(model) {
        let roomLightObject = null;
        model.traverse((node) => {
          if (
            node.isMesh &&
            (node.name === "roomLight" ||
              (node.parent && node.parent.name === "roomLight"))
          ) {
            if (Array.isArray(node.material)) {
              for (let i = 0; i < node.material.length; i++)
                node.material[i] = roomLightMaterial;
            } else {
              node.material = roomLightMaterial;
            }
            if (!roomLightObject)
              roomLightObject =
                node.parent && node.parent.name === "roomLight"
                  ? node.parent
                  : node;
          }
        });
        if (roomLightObject) {
          const roomLightPoint = new THREE.PointLight(0xffeedd, 0.9, 80, 1.5);
          roomLightPoint.position.set(0, 0, 0);
          roomLightObject.add(roomLightPoint);
        }
      }

      function duplicateRoomRoofPlane(model) {
        const roomRoofMeshes = [];
        let windowUnitParent = null;
        model.traverse((node) => {
          if (
            node.isMesh &&
            (node.name === "roomRoofPlane" ||
              (node.parent && node.parent.name === "roomRoofPlane"))
          ) {
            roomRoofMeshes.push(node);
          }
          if (node.name === "windowUnit" && node.parent)
            windowUnitParent = node.parent;
        });
        if (roomRoofMeshes.length === 0 || !windowUnitParent) return;
        model.updateMatrixWorld(true);
        const worldPos = new THREE.Vector3();
        const basePos = new THREE.Vector3();
        const xOffsets = [
          -WINDOW_GROUP_X_SPACING,
          -2 * WINDOW_GROUP_X_SPACING,
          WINDOW_GROUP_X_SPACING,
          2 * WINDOW_GROUP_X_SPACING,
        ];
        for (let m = 0; m < roomRoofMeshes.length; m++) {
          const mesh = roomRoofMeshes[m];
          mesh.getWorldPosition(worldPos);
          basePos.copy(worldPos);
          windowUnitParent.worldToLocal(basePos);
          for (let i = 0; i < xOffsets.length; i++) {
            const clone = mesh.clone();
            clone.position.set(xOffsets[i], basePos.y, basePos.z);
            clone.material = roomRoofPlaneMaterial;
            windowUnitParent.add(clone);
          }
        }
      }

      function duplicateRoomLight(model) {
        let roomLightObject = null;
        let windowUnitParent = null;
        model.traverse((node) => {
          if (node.name === "roomLight") roomLightObject = node;
          if (node.name === "windowUnit" && node.parent)
            windowUnitParent = node.parent;
        });
        if (!roomLightObject || !windowUnitParent) return;
        model.updateMatrixWorld(true);
        const basePos = new THREE.Vector3();
        roomLightObject.getWorldPosition(basePos);
        windowUnitParent.worldToLocal(basePos);
        const xOffsets = [
          -WINDOW_GROUP_X_SPACING,
          -2 * WINDOW_GROUP_X_SPACING,
          WINDOW_GROUP_X_SPACING,
          2 * WINDOW_GROUP_X_SPACING,
        ];
        for (let i = 0; i < xOffsets.length; i++) {
          const clone = roomLightObject.clone(true);
          clone.position.set(xOffsets[i], basePos.y, basePos.z);
          windowUnitParent.add(clone);
        }
      }

      function applyPlantVaseAndBaseMaterials(model) {
        const plantVaseMeshes = [];
        const plantBaseMeshes = [];
        model.traverse((node) => {
          if (!node.isMesh) return;
          if (
            node.name === "plantVase" ||
            (node.parent && node.parent.name === "plantVase")
          )
            plantVaseMeshes.push(node);
          if (
            node.name === "plantBase" ||
            (node.parent && node.parent.name === "plantBase")
          )
            plantBaseMeshes.push(node);
        });
        const size = 512;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#0f2218";
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = "#ffffff";
        for (let i = 0; i < 1800; i++) {
          const x = Math.random() * size;
          const y = Math.random() * size;
          const r = 0.15 + Math.random() * 0.55;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        const terrazzoTex = new THREE.CanvasTexture(canvas);
        terrazzoTex.wrapS = terrazzoTex.wrapT = THREE.RepeatWrapping;
        terrazzoTex.repeat.set(2, 2);
        const greenTerrazzoMat = new THREE.MeshStandardMaterial({
          map: terrazzoTex,
          roughness: 0.65,
          metalness: 0.05,
        });
        function applyTerrazzo(meshes) {
          for (let i = 0; i < meshes.length; i++) {
            const m = meshes[i];
            if (m && m.material) {
              if (Array.isArray(m.material)) {
                for (let j = 0; j < m.material.length; j++)
                  m.material[j] = greenTerrazzoMat.clone();
              } else {
                m.material = greenTerrazzoMat.clone();
              }
            }
          }
        }
        applyTerrazzo(plantVaseMeshes);
        applyTerrazzo(plantBaseMeshes);
      }

      const phoneChargerMaterial = new THREE.MeshStandardMaterial({
        color: 0xe8e8e8,
        roughness: 0.55,
        metalness: 0.05,
      });

      function applyPhoneChargerMaterial(model) {
        model.traverse((node) => {
          if (!node.isMesh) return;
          if (
            node.name === "phoneCharger" ||
            (node.parent && node.parent.name === "phoneCharger")
          ) {
            if (Array.isArray(node.material)) {
              for (let i = 0; i < node.material.length; i++)
                node.material[i] = phoneChargerMaterial;
            } else {
              node.material = phoneChargerMaterial;
            }
          }
        });
      }

      const phoneChargerCupMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.88,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
      });

      let phoneChargerCupMesh = null;
      let rampLeftObject = null;
      let rampLeftBody = null;
      let rampLeftEntryDir = null;
      const carRampRaycaster = new THREE.Raycaster();
      const carRampRayOrigin = new THREE.Vector3();
      const carRampRayFrontOrigin = new THREE.Vector3();
      const carRampRayRearOrigin = new THREE.Vector3();
      const carRampRayDir = new THREE.Vector3(0, -1, 0);
      const carRampWallRaycaster = new THREE.Raycaster();
      const _wallRayDir = new THREE.Vector3();
      function isDescendantOf(obj, ancestor) {
        let o = obj;
        while (o) {
          if (o === ancestor) return true;
          o = o.parent;
        }
        return false;
      }
      const _rampNormal = new THREE.Vector3();
      function getRampHitWorldNormal(hit) {
        const obj = hit.object;
        const geo = obj.geometry;
        if (hit.face && hit.face.normal) {
          _rampNormal.copy(hit.face.normal).transformDirection(obj.matrixWorld);
          return _rampNormal.normalize();
        }
        const fi = (hit.faceIndex ?? 0) * 3;
        const pos = geo.attributes.position;
        const norm = geo.attributes.normal;
        const idx = geo.index;
        let i0, i1, i2;
        if (idx) {
          i0 = idx.getX(fi);
          i1 = idx.getX(fi + 1);
          i2 = idx.getX(fi + 2);
        } else {
          i0 = fi;
          i1 = fi + 1;
          i2 = fi + 2;
        }
        _rampNormal.set(0, 0, 0);
        if (norm) {
          _rampNormal.fromBufferAttribute(norm, i0);
          _rampNormal.add(_v0.fromBufferAttribute(norm, i1));
          _rampNormal.add(_v1.fromBufferAttribute(norm, i2));
          _rampNormal.divideScalar(3);
        } else if (pos) {
          _v0.fromBufferAttribute(pos, i0);
          _v1.fromBufferAttribute(pos, i1);
          _v2.fromBufferAttribute(pos, i2);
          _rampNormal.crossVectors(_v1.clone().sub(_v0), _v2.clone().sub(_v0));
        }
        _rampNormal.transformDirection(obj.matrixWorld).normalize();
        return _rampNormal;
      }
      const _rampFaceV0 = new THREE.Vector3();
      const _rampFaceV1 = new THREE.Vector3();
      const _rampFaceV2 = new THREE.Vector3();
      function getRampHitFaceTopY(hit) {
        const obj = hit.object;
        const geo = obj.geometry;
        const pos = geo.attributes.position;
        const face = hit.face;
        const i0 = face.a;
        const i1 = face.b;
        const i2 = face.c;
        _rampFaceV0.fromBufferAttribute(pos, i0).applyMatrix4(obj.matrixWorld);
        _rampFaceV1.fromBufferAttribute(pos, i1).applyMatrix4(obj.matrixWorld);
        _rampFaceV2.fromBufferAttribute(pos, i2).applyMatrix4(obj.matrixWorld);
        return Math.max(_rampFaceV0.y, _rampFaceV1.y, _rampFaceV2.y);
      }
      const RAMP_DRIVE_UP_NY_THRESHOLD = 0.5;
      const MAX_STEP_CLIMB_RATIO = 0.4;
      const RAMP_SIDE_PUSH_BACK = 0.6;
      const RAMP_SURFACE_CLEARANCE = 0.025;
      const RAMP_EXIT_LEAN_AMOUNT = 0.32;
      const RAMP_ENTRY_DOT_THRESHOLD = 0.25;
      const RAMP_BLOCKING_FACE_Z_THRESHOLD = 0.5;
      const _v0 = new THREE.Vector3();
      const _v1 = new THREE.Vector3();
      const _v2 = new THREE.Vector3();
      const _v3 = new THREE.Vector3();
      const _surfEdgeA = new THREE.Vector3();
      const _surfEdgeB = new THREE.Vector3();
      const _surfNormalB = new THREE.Vector3();
      const carRampNormalStored = new THREE.Vector3(0, 1, 0);
      const carUpLerp = new THREE.Vector3(0, 1, 0);
      const CAR_RAMP_TILT_LERP = 12;
      const jumpLaunchUp = new THREE.Vector3(0, 1, 0);
      const jumpForwardLeanUp = new THREE.Vector3();
      let jumpStartTime = 0;
      let jumpLaunchSpeed = 0;
      let jumpInitialVelY = 0;
      let _rampJumpSimAirTime = 0;
      const JUMP_TILT_DURATION = 0.45;
      const JUMP_FORWARD_LEAN_AMOUNT = 0.38;
      const LANDING_TILT_LERP = 120;
      const LANDING_RECOVERY_DURATION = 0.3;
      let wasInAir = false;
      let _carLandShakePending = false;
      let wasOnRamp = false;
      let _rampLeftJumpActive = false;
      let _rampJumpDidSlowMo = false;
      let _rampJumpMatrixActive = false;
      let _rampJumpFxBlend = 0;
      let _rampJumpFxIn = 0;
      let _carCam1JumpEffect = 0;
      let _carCam1RestDistance = 0;
      let _rampJumpMatrixOrbitSign = 1;
      let _rampJumpMatrixOrbitProgress = 0;
      let _rampJumpMatrixHorizDist = 0;
      let _rampJumpMatrixHeightOff = 0;
      let _rampJumpMatrixStartAzimuth = 0;
      let _rampJumpMatrixPitch = 0.35;
      let _rampJumpMatrixPitchBias = 0;
      let _rampJumpMatrixAzimuthBias = 0;
      let _rampJumpMatrixSideBias = 0;
      let _rampJumpSlowMoDriftYaw = 0;
      let _rampJumpSlowMoDriftPitch = 0;
      let _rampJumpSlowMoDriftSide = 0;
      let _rampJumpSlowMoDriftPhase = 0;
      let landingRecoveryUntil = 0;
      const TILT_SPEED_MIN_LERP = 0.4;
      const TILT_SPEED_MAX_LERP = 1.2;
      const _flatUp = new THREE.Vector3(0, 1, 0);
      const _stepTiltUp = new THREE.Vector3(0, 1, 0);
      let _carFrontAxleSurfY = 0;
      let _carRearAxleSurfY = 0;
      let _carLeftAxleSurfY = 0;
      let _carRightAxleSurfY = 0;
      let _carGroundSurfY = 0;
      let _carSurfRange = 0;
      const _carWheelSurfY = [0, 0, 0, 0];
      const _carWorldBox = new THREE.Box3();
      const _carForward = new THREE.Vector3();
      const _carRight = new THREE.Vector3();
      const _carRotMat = new THREE.Matrix4();
      const _quatY = new THREE.Quaternion();
      const _quatTilt = new THREE.Quaternion();
      const _tiltAxis = new THREE.Vector3();
      let tablePlateBody = null;
      let floorPhysBody = null;
      let tableSideWallBody = null;
      let gumsTankObject = null;
      let gumsTankPhysicObject = null;
      let gumsTankPhysicCupObject = null;
      let gumsTankPhysBody = null;
      let gumsTankCupBody = null;
      let gumsBodyPhysBody = null;
      let gumsStandPhysBody = null;
      let gumsStandObject = null;
      let gumsRampPhysBody = null;
      let gumsRampObject = null;
      let handPhysBody = null;
      let handPhisicsMesh = null;
      let handNode0Mesh = null;
      let handWalkPart = null;
      let handWalkTriggerMesh = null;
      let _handWalkTriggerWasInside = false;
      let _handTriggerInsideTime = 0;
      let _handWalkZPhase = 0;
      let _handWalkZMoveT = 0;
      let _handWalkZTriggeredThisVisit = false;
      const HAND_TRIGGER_HOLD_SEC = 3;
      const HAND_WALK_Z_OFFSET = 14;
      const HAND_WALK_Z_MOVE_SEC = 1.25;
      const _handBlockBox = new THREE.Box3();
      const _handWalkTriggerBox = new THREE.Box3();
      let gumsCupRemovedUntil = 0;
      /** Inner AABB in **gumsTankPhysic** local space (matches Cannon trimesh), not visual gumsTank. */
      let _gumTankClampLocal = null;
      const PHYS_GROUP_DEFAULT = 1;
      const PHYS_GROUP_GUMS_TRIMESH = 2;
      const PHYS_GROUP_GUMS_INNER = 4;
      const PHYS_GROUP_GUM_SPHERE = 8;
      const PHYS_GROUP_GUMS_STOPPER = 16;
      const PHYS_GROUP_GUMS_BODY = 32;
      const PHYS_GROUP_GUMS_STAND = 64;
      const PHYS_GROUP_GUMS_RAMP = 128;
      const PHYS_GROUP_HAND = 256;
      const PHYS_GROUP_CAR = 512;
      const PHYS_MASK_GUM_SPHERE =
        PHYS_GROUP_DEFAULT |
        PHYS_GROUP_GUM_SPHERE |
        PHYS_GROUP_GUMS_TRIMESH |
        PHYS_GROUP_GUMS_STOPPER |
        PHYS_GROUP_GUMS_BODY |
        PHYS_GROUP_GUMS_STAND |
        PHYS_GROUP_GUMS_RAMP |
        PHYS_GROUP_CAR;
      let gumsBodyObject = null;
      let gumsStoperObject = null;
      let gumsStoperBody = null;
      const _debugGumSet = new Set();
      // Gravity: real-world (0, -9.81); moderate for visible but not too fast motion
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
      const tankMaterial = new CANNON.Material("gumsTank");
      const stoperMaterial = new CANNON.Material("gumsStoper");
      const gumMaterial = new CANNON.Material("gum");
      const bottleMaterial = new CANNON.Material("bottle");
      const certifiedMaterial = new CANNON.Material("certified");
      const floorPhysMaterial = new CANNON.Material("floor");
      const gumDispenserMaterial = new CANNON.Material("gumDispenser");
      const propMaterial = new CANNON.Material("prop");
      const handPhysMaterial = new CANNON.Material("hand");

      let dockingStationPhysBody = null;
      let plantVasePhysBody = null;
      let macScreenFramePhysBody = null;
      let macBodyBasePhysBody = null;
      let mainScreensPinPhysBody = null;
      let mainScreensBasePhysBody = null;

      const GUM_COUNT = 80;
      const GUM_PHYS_FIXED_STEP = 1 / 120;
      const GUM_PHYS_FIXED_STEP_DYNAMIC = 1 / 60;
      const GUM_PHYS_MAX_SUBSTEPS_FILL = 5;
      const GUM_PHYS_MAX_SUBSTEPS_MIXED = 5;
      const GUM_PHYS_MAX_SUBSTEPS_DYNAMIC = 2;
      /** Cannon sphere radius = visualRadius * scale (same for every gum). Slightly larger than the mesh reduces trimesh tunneling; all bodies still share identical physics. */
      const GUM_PHYS_RADIUS_SCALE = 1.15;
      const gumBodies = [];
      let gumInstancedMesh = null;
      const _gumSyncM = new THREE.Matrix4();
      const _gumSyncQ = new THREE.Quaternion();
      const _gumSyncP = new THREE.Vector3();
      const _gumSyncS = new THREE.Vector3(1, 1, 1);
      const _gumHideP = new THREE.Vector3(0, -400, 0);
      const _gumHideS = new THREE.Vector3(1e-6, 1e-6, 1e-6);
      const _gumIdQ = new THREE.Quaternion();
      const gumReleased = new Set();
      let _gumRepulsionFrame = 0;
      let _gumPrevFrameTankAllStatic = false;
      let gumRadiusGlobal = 0.02;
      let gumsAddedCount = 0;
      let gumsReadyToDrop = false;
      let _gumFillDoneTime = 0;
      let nextGumDropTime = 0;
      /** Ms between spawning each gum into the tank (lower = faster fill). */
      const GUM_DROP_INTERVAL = 80;
      const GUM_DROP_COLUMN_COUNT = 2;
      let gumsDropCenterX = 0;
      let gumsDropCenterZ = 0;
      let gumsDropTopY = 0;
      /** World-space (x,z) spawn columns; length `GUM_DROP_COLUMN_COUNT`; round-robin index. */
      let gumsDropColumnXZ = [];
      /** Seconds all tank gums stay slow before forcing STATIC (Cannon sleep is often delayed by clamp/separation passes). */
      let gumsTankSettleAccum = 0;
      /** Real time after last gum spawned; backs up velocity-based settle (angular vel from contacts often never drops). */
      let gumsPostFillElapsed = 0;
      const gumColors = [
        0xe74c3c, 0x2ecc71, 0x3498db, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c,
      ];
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(carMaterial, tablePlatePhysicsMaterial, {
          friction: 0.5,
          restitution: 0,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 2,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(gumMaterial, gumMaterial, {
          friction: 0.8,
          restitution: 0.0,
          contactEquationStiffness: 2e6,
          contactEquationRelaxation: 6,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(gumMaterial, tankMaterial, {
          friction: 0.5,
          restitution: 0.0,
          contactEquationStiffness: 5e7,
          contactEquationRelaxation: 2,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(gumMaterial, tablePlatePhysicsMaterial, {
          friction: 0.6,
          restitution: 0.05,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 3,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(gumMaterial, carMaterial, {
          friction: 0.7,
          restitution: 0.0,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 3,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(gumMaterial, stoperMaterial, {
          friction: 0.45,
          restitution: 0.0,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 3,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(bottleMaterial, tablePlatePhysicsMaterial, {
          friction: 0.8,
          restitution: 0.02,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 3,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(bottleMaterial, carMaterial, {
          friction: 0.8,
          restitution: 0.02,
          contactEquationStiffness: 5e6,
          contactEquationRelaxation: 4,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(certifiedMaterial, tablePlatePhysicsMaterial, {
          friction: 0.8,
          restitution: 0.02,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 3,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(certifiedMaterial, carMaterial, {
          friction: 0.8,
          restitution: 0.02,
          contactEquationStiffness: 5e6,
          contactEquationRelaxation: 4,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(certifiedMaterial, floorPhysMaterial, {
          friction: 0.5,
          restitution: 0.0,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 4,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(bottleMaterial, floorPhysMaterial, {
          friction: 0.5,
          restitution: 0.0,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 4,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(gumDispenserMaterial, tablePlatePhysicsMaterial, {
          friction: 0.6,
          restitution: 0.02,
          contactEquationStiffness: 1e9,
          contactEquationRelaxation: 3,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(gumDispenserMaterial, carMaterial, {
          friction: 0.3,
          restitution: 0.0,
          contactEquationStiffness: 5e6,
          contactEquationRelaxation: 6,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(gumDispenserMaterial, floorPhysMaterial, {
          friction: 0.5,
          restitution: 0.0,
          contactEquationStiffness: 1e9,
          contactEquationRelaxation: 3,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(propMaterial, tablePlatePhysicsMaterial, {
          friction: 0.8,
          restitution: 0.02,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 3,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(propMaterial, carMaterial, {
          friction: 0.8,
          restitution: 0.02,
          contactEquationStiffness: 5e6,
          contactEquationRelaxation: 4,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(handPhysMaterial, carMaterial, {
          friction: 0.5,
          restitution: 0.05,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 3,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(propMaterial, floorPhysMaterial, {
          friction: 0.5,
          restitution: 0.1,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 3,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(gumMaterial, floorPhysMaterial, {
          friction: 0.5,
          restitution: 0.15,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 3,
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
      const chargerCupWorldPos = new THREE.Vector3();
      const CHARGER_EFFECT_ABOVE_CUP = 1.0;
      const CHARGER_TOUCH_RADIUS = 1.8;
      const CHARGER_FADE_SPEED = 2.2;
      let chargerFlameFade = 0;

      const pen1Material = new THREE.MeshStandardMaterial({ color: 0xe6cc2e });
      const pen2Material = new THREE.MeshStandardMaterial({ color: 0x1ab9e8 });

      const duckBodyMaterial = new THREE.MeshStandardMaterial({
        color: 0xf7d308,
        roughness: 0.95,
        metalness: 0,
      });
      const duckMakorMaterial = new THREE.MeshStandardMaterial({
        color: 0xff8c00,
        roughness: 0.95,
        metalness: 0,
      });
      const duckEyesMaterial = new THREE.MeshStandardMaterial({
        color: 0xfafafa,
        roughness: 0.95,
        metalness: 0,
      });
      const eyeBallMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.45,
        metalness: 0,
      });
      const eyePupleMaterial = new THREE.MeshStandardMaterial({
        color: 0x000000,
        roughness: 0.35,
        metalness: 0,
      });
      let eyeBallLeftPart = null;
      let eyePupleLeftPart = null;
      let eyeBallRightPart = null;
      let eyePupleRightPart = null;
      const _eyeLookTarget = new THREE.Vector3();

      function attachEyePupil(eyeBallPart, eyePuplePart) {
        if (!eyeBallPart || !eyePuplePart) return;
        eyeBallPart.updateMatrixWorld(true);
        eyePuplePart.updateMatrixWorld(true);
        if (eyePuplePart.parent !== eyeBallPart) {
          eyeBallPart.attach(eyePuplePart);
        }
      }

      function setupEyeTracking(model) {
        eyeBallLeftPart = null;
        eyePupleLeftPart = null;
        eyeBallRightPart = null;
        eyePupleRightPart = null;
        model.traverse((node) => {
          if (!node.isMesh) return;
          if (node.name === "eyeBallLeft") {
            eyeBallLeftPart = node;
            node.material = eyeBallMaterial;
          } else if (node.name === "eyePupleLeft") {
            eyePupleLeftPart = node;
            node.material = eyePupleMaterial;
          } else if (node.name === "eyeBallRight") {
            eyeBallRightPart = node;
            node.material = eyeBallMaterial;
          } else if (node.name === "eyePupleRight") {
            eyePupleRightPart = node;
            node.material = eyePupleMaterial;
          }
        });
        model.updateMatrixWorld(true);
        attachEyePupil(eyeBallLeftPart, eyePupleLeftPart);
        attachEyePupil(eyeBallRightPart, eyePupleRightPart);
      }

      function updateEyeTracking() {
        if (!car) return;
        if (perfEyeTrackingEvery > 1) {
          _perfEyeFrame++;
          if (_perfEyeFrame % perfEyeTrackingEvery !== 0) return;
        }
        _eyeLookTarget.copy(car.position);
        if (eyeBallLeftPart && eyePupleLeftPart) {
          eyeBallLeftPart.lookAt(_eyeLookTarget);
          eyePupleLeftPart.lookAt(_eyeLookTarget);
        }
        if (eyeBallRightPart && eyePupleRightPart) {
          eyeBallRightPart.lookAt(_eyeLookTarget);
          eyePupleRightPart.lookAt(_eyeLookTarget);
        }
      }

      const gumsTankGlassMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.92,
        transmission: 0.98,
        thickness: 0.15,
        roughness: 0.08,
        metalness: 0,
        side: THREE.DoubleSide,
        depthWrite: true,
      });

      function applyGumsTankMaterial(model) {
        model.traverse((node) => {
          if (!node.isMesh) return;
          if (
            node.name === "gumsTank" ||
            (node.parent && node.parent.name === "gumsTank")
          ) {
            if (Array.isArray(node.material)) {
              for (let i = 0; i < node.material.length; i++)
                node.material[i] = gumsTankGlassMaterial;
            } else {
              node.material = gumsTankGlassMaterial;
            }
          }
        });
        if (scene.environment) gumsTankGlassMaterial.envMap = scene.environment;
      }

      const gumsWhitePlasticMaterial = new THREE.MeshStandardMaterial({
        color: 0xf0f0f0,
        roughness: 0.5,
        metalness: 0.05,
      });

      const GUMS_PLASTIC_NAMES = [
        "gumsBody",
        "gumsCup",
        "gumsStand",
        "gumsStoper",
      ];

      function applyGumsPlasticMaterials(model) {
        model.traverse((node) => {
          if (!node.isMesh) return;
          if (
            GUMS_PLASTIC_NAMES.includes(node.name) ||
            GUMS_PLASTIC_NAMES.includes(node.parent && node.parent.name)
          ) {
            if (Array.isArray(node.material)) {
              for (let i = 0; i < node.material.length; i++)
                node.material[i] = gumsWhitePlasticMaterial;
            } else {
              node.material = gumsWhitePlasticMaterial;
            }
          }
        });
      }

      function findGumsTank(model) {
        model.traverse((node) => {
          const raw = node.name || "";
          const name = raw.toLowerCase();
          if (!gumsTankObject && (raw === "gumsTank" || name === "gumstank"))
            gumsTankObject = node;
          if (!gumsTankPhysicObject && raw === "gumsTankPhysic")
            gumsTankPhysicObject = node;
          if (!gumsTankPhysicCupObject && raw === "gumsTankPhysicCup")
            gumsTankPhysicCupObject = node;
          if (!gumsBodyObject && raw === "gumsBodyPhysic")
            gumsBodyObject = node;
          if (!gumsStandObject && raw === "gumsStand")
            gumsStandObject = node;
          if (!gumsRampObject && raw === "gumsRamp")
            gumsRampObject = node;
        });
      }

      function findGumsStoper(model) {
        model.traverse((node) => {
          if (gumsStoperObject) return;
          const name = (node.name || "").toLowerCase().replace(/\s/g, "");
          const isStoper =
            name === "gumsstoper" ||
            name === "gumsstopper" ||
            name.includes("stoper") ||
            name.includes("stopper");
          if (isStoper) gumsStoperObject = node;
        });
      }

      function findRampLeft(model) {
        model.traverse((node) => {
          if (node.name === "rampRight") {
            node.visible = false;
            node.traverse((child) => {
              child.visible = false;
            });
          }
          if (node.name === "rampLeft" && !rampLeftObject) {
            rampLeftObject = node;
            node.traverse((child) => {
              if (child.isMesh && child.material) {
                if (Array.isArray(child.material)) {
                  child.material = child.material.map((m) => {
                    const cloned = m.clone();
                    cloned.transparent = true;
                    cloned.opacity = 0;
                    cloned.depthWrite = false;
                    return cloned;
                  });
                } else {
                  const cloned = child.material.clone();
                  cloned.transparent = true;
                  cloned.opacity = 0;
                  cloned.depthWrite = false;
                  child.material = cloned;
                }
              }
            });
          }
        });
      }

      function setupBottlePhysics(model) {
        model.traverse((node) => {
          if (!node.isMesh) return;
          if (node.name === "bottleBody") bottleBodyMesh = node;
          if (node.name === "bottleBase") bottleBaseMesh = node;
          if (node.name === "bottleCup") bottleCupMesh = node;
          if (node.name === "bottlePhisic") bottlePhisicMesh = node;
        });
        if (!bottlePhisicMesh) return;

        model.updateMatrixWorld(true);

        const phBB = new THREE.Box3().setFromObject(bottlePhisicMesh);
        const phCenter = phBB.getCenter(new THREE.Vector3());
        const phSize = phBB.getSize(new THREE.Vector3());

        bottlePhisicMesh.visible = false;

        bottleGroup = new THREE.Group();
        bottleGroup.position.copy(phCenter);
        const phQuat = new THREE.Quaternion();
        bottlePhisicMesh.getWorldQuaternion(phQuat);
        bottleGroup.quaternion.copy(phQuat);
        scene.add(bottleGroup);
        bottleGroup.updateMatrixWorld(true);

        const parts = [bottleBodyMesh, bottleBaseMesh, bottleCupMesh, bottlePhisicMesh].filter(Boolean);
        for (const mesh of parts) {
          bottleGroup.attach(mesh);
        }

        const hx = phSize.x / 2;
        const hy = phSize.y / 2;
        const hz = phSize.z / 2;
        const shape = new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
        bottlePhysBody = new CANNON.Body({
          mass: 15,
          type: CANNON.Body.DYNAMIC,
          material: bottleMaterial,
          linearDamping: 0.95,
          angularDamping: 0.95,
          allowSleep: true,
          sleepSpeedLimit: 0.3,
          sleepTimeLimit: 0.2,
          collisionFilterGroup: 1,
          collisionFilterMask: -1,
          ccdSpeedThreshold: 1,
          ccdIterations: 10,
        });
        bottlePhysBody.addShape(shape);
        bottlePhysBody.position.set(phCenter.x, phCenter.y, phCenter.z);
        bottlePhysBody.quaternion.set(phQuat.x, phQuat.y, phQuat.z, phQuat.w);
        bottlePhysBody._frozen = true;
        physicsWorld.addBody(bottlePhysBody);

        _bottleInitPos = new CANNON.Vec3(phCenter.x, phCenter.y, phCenter.z);
        _bottleInitQuat = new CANNON.Quaternion(phQuat.x, phQuat.y, phQuat.z, phQuat.w);
      }

      function showTablePlateWireframe() {
      }

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

      function setupTableSideWallPhysics(model) {
        let wallNode = null;
        model.traverse((node) => {
          if (node.name === "tableSideWall") wallNode = node;
        });
        if (!wallNode) return;
        model.updateMatrixWorld(true);
        wallNode.updateMatrixWorld(true);
        tableSideWallBody = new CANNON.Body({
          type: CANNON.Body.STATIC,
          position: new CANNON.Vec3(0, 0, 0),
          material: tablePlatePhysicsMaterial,
          collisionFilterGroup: 1,
          collisionFilterMask: -1,
        });
        let shapeCount = 0;
        wallNode.traverse((node) => {
          if (!node.isMesh || !node.geometry) return;
          const bb = new THREE.Box3().setFromObject(node);
          const center = bb.getCenter(new THREE.Vector3());
          const size = bb.getSize(new THREE.Vector3());
          if (size.x < 0.001 || size.y < 0.001 || size.z < 0.001) return;
          const halfExtents = new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2);
          const offset = new CANNON.Vec3(center.x, center.y, center.z);
          tableSideWallBody.addShape(new CANNON.Box(halfExtents), offset);
          shapeCount++;
        });
        if (shapeCount === 0) return;
        physicsWorld.addBody(tableSideWallBody);
      }

      function setupHandPhysics(model) {
        handPhisicsMesh = null;
        handNode0Mesh = null;
        handWalkPart = model.getObjectByName("handWalk") || null;
        model.traverse((node) => {
          if (node.isMesh && node.name === "handPhisics") handPhisicsMesh = node;
          if (node.isMesh && node.name === "node_0") handNode0Mesh = node;
          if (node.isMesh && node.name === "handWalkTrigger") {
            handWalkTriggerMesh = node;
            node.visible = false;
          }
        });
        if (!handPhisicsMesh) {
          console.warn("handPhisics mesh not found");
          return;
        }
        if (handWalkPart) _handWalkRestPos.copy(handWalkPart.position);

        handPhisicsMesh.visible = false;

        if (handNode0Mesh?.skeleton) {
          const attachBone =
            handNode0Mesh.skeleton.bones.find((b) => b.name === "Bone.014") ||
            handNode0Mesh.skeleton.bones.find((b) => b.name === "Bone.012") ||
            handNode0Mesh.skeleton.bones[handNode0Mesh.skeleton.bones.length - 1];
          if (attachBone) attachBone.attach(handPhisicsMesh);
        }

        model.updateMatrixWorld(true);
        handPhisicsMesh.updateMatrixWorld(true);

        const geo = handPhisicsMesh.geometry;
        if (!geo?.attributes?.position) return;
        const posAttr = geo.attributes.position;
        const idx = geo.index;
        const verts = [];
        for (let i = 0; i < posAttr.count; i++) {
          verts.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
        }
        const nV = verts.length / 3;
        if (nV < 3) return;
        const cx =
          verts.reduce((s, v, i) => (i % 3 === 0 ? s + v : s), 0) / nV;
        const cy =
          verts.reduce((s, v, i) => (i % 3 === 1 ? s + v : s), 0) / nV;
        const cz =
          verts.reduce((s, v, i) => (i % 3 === 2 ? s + v : s), 0) / nV;
        for (let i = 0; i < verts.length; i += 3) {
          verts[i] -= cx;
          verts[i + 1] -= cy;
          verts[i + 2] -= cz;
        }
        const inds = [];
        if (idx) {
          for (let i = 0; i < idx.count; i++) inds.push(idx.getX(i));
        } else {
          for (let i = 0; i < nV; i++) inds.push(i);
        }
        const doubleInds = [];
        for (let i = 0; i < inds.length; i += 3) {
          doubleInds.push(inds[i], inds[i + 1], inds[i + 2]);
          doubleInds.push(inds[i + 2], inds[i + 1], inds[i]);
        }

        const tri = new CANNON.Trimesh(verts, doubleInds);
        tri.updateTree();
        tri.updateNormals();

        const wp = new THREE.Vector3();
        const wq = new THREE.Quaternion();
        handPhisicsMesh.getWorldPosition(wp);
        handPhisicsMesh.getWorldQuaternion(wq);

        handPhysBody = new CANNON.Body({
          type: CANNON.Body.STATIC,
          mass: 0,
          material: handPhysMaterial,
          collisionFilterGroup: PHYS_GROUP_HAND,
          collisionFilterMask: PHYS_GROUP_CAR,
        });
        handPhysBody.addShape(tri, new CANNON.Vec3(cx, cy, cz));
        handPhysBody.position.set(wp.x, wp.y, wp.z);
        handPhysBody.quaternion.set(wq.x, wq.y, wq.z, wq.w);
        physicsWorld.addBody(handPhysBody);
      }

      function syncHandPhysics() {
        if (!handPhysBody || !handPhisicsMesh) return;
        handPhisicsMesh.updateMatrixWorld(true);
        handPhisicsMesh.getWorldPosition(_canonWorldPos);
        handPhisicsMesh.getWorldQuaternion(_canonWorldQuat);
        handPhysBody.position.set(
          _canonWorldPos.x,
          _canonWorldPos.y,
          _canonWorldPos.z,
        );
        handPhysBody.quaternion.set(
          _canonWorldQuat.x,
          _canonWorldQuat.y,
          _canonWorldQuat.z,
          _canonWorldQuat.w,
        );
        handPhysBody.velocity.set(0, 0, 0);
        handPhysBody.angularVelocity.set(0, 0, 0);
        handPhysBody.aabbNeedsUpdate = true;
      }

      function resolveCarHandPhysicsBlock(carR) {
        if (!handPhisicsMesh || carFalling) return false;
        handPhisicsMesh.updateMatrixWorld(true);
        _handBlockBox.setFromObject(handPhisicsMesh);
        if (_handBlockBox.isEmpty()) return false;

        _handBlockBox.getCenter(_v0);
        _handBlockBox.getSize(_v1);
        const heX = _v1.x * 0.5;
        const heY = _v1.y * 0.5;
        const heZ = _v1.z * 0.5;
        const dx = car.position.x - _v0.x;
        const dy = car.position.y - _v0.y;
        const dz = car.position.z - _v0.z;

        if (Math.abs(dy) >= heY + carR) return false;
        if (Math.abs(dx) >= heX + carR || Math.abs(dz) >= heZ + carR) return false;

        const overlapX = heX + carR - Math.abs(dx);
        const overlapZ = heZ + carR - Math.abs(dz);
        if (overlapX <= 0 || overlapZ <= 0) return false;

        if (overlapX < overlapZ) {
          car.position.x += Math.sign(dx || 1) * overlapX;
        } else {
          car.position.z += Math.sign(dz || 1) * overlapZ;
        }
        carState.speed = 0;
        return true;
      }

      function syncBottleFromPhysics() {
        if (!bottleGroup || !bottlePhysBody) return;

        if (bottlePhysBody._frozen && _bottleInitPos) {
          bottlePhysBody.position.copy(_bottleInitPos);
          bottlePhysBody.quaternion.copy(_bottleInitQuat);
          bottlePhysBody.velocity.set(0, 0, 0);
          bottlePhysBody.angularVelocity.set(0, 0, 0);
        }

        bottleGroup.position.set(
          bottlePhysBody.position.x,
          bottlePhysBody.position.y,
          bottlePhysBody.position.z,
        );
        bottleGroup.quaternion.set(
          bottlePhysBody.quaternion.x,
          bottlePhysBody.quaternion.y,
          bottlePhysBody.quaternion.z,
          bottlePhysBody.quaternion.w,
        );
      }

      const CERTIFIED_PART_NAMES = [
        "certifiedBody", "certifiedDesignText", "certifiedTitle",
        "cetifiedCircle", "cetifiedBackground", "wixLogo",
      ];

      function setupCertifiedPhysics(model) {
        let physicMesh = null;
        const visualParts = [];
        model.traverse((node) => {
          if (!node.isMesh) return;
          if (node.name === "certifiedBodyPhysic") physicMesh = node;
          if (CERTIFIED_PART_NAMES.includes(node.name)) visualParts.push(node);
        });
        if (!physicMesh) return;
        certifiedPhysicMesh = physicMesh;

        model.updateMatrixWorld(true);

        const phBB = new THREE.Box3().setFromObject(physicMesh);
        const phCenter = phBB.getCenter(new THREE.Vector3());
        const phSize = phBB.getSize(new THREE.Vector3());

        certifiedGroup = new THREE.Group();
        certifiedGroup.position.copy(phCenter);
        const phQuat = new THREE.Quaternion();
        physicMesh.getWorldQuaternion(phQuat);
        certifiedGroup.quaternion.copy(phQuat);
        scene.add(certifiedGroup);
        certifiedGroup.updateMatrixWorld(true);

        for (const mesh of visualParts) {
          certifiedGroup.attach(mesh);
        }
        certifiedGroup.attach(physicMesh);
        physicMesh.visible = false;

        const hx = phSize.x / 2;
        const hy = phSize.y / 2;
        const hz = phSize.z / 2;
        const shape = new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
        certifiedPhysBody = new CANNON.Body({
          mass: 5,
          type: CANNON.Body.DYNAMIC,
          material: certifiedMaterial,
          linearDamping: 0.4,
          angularDamping: 0.4,
          allowSleep: false,
          collisionFilterGroup: 1,
          collisionFilterMask: -1,
          ccdSpeedThreshold: 1,
          ccdIterations: 10,
        });
        certifiedPhysBody.addShape(shape);
        certifiedPhysBody.position.set(phCenter.x, phCenter.y, phCenter.z);
        certifiedPhysBody.quaternion.set(phQuat.x, phQuat.y, phQuat.z, phQuat.w);
        certifiedPhysBody._frozen = true;
        physicsWorld.addBody(certifiedPhysBody);

        _certifiedInitPos = new CANNON.Vec3(phCenter.x, phCenter.y, phCenter.z);
        _certifiedInitQuat = new CANNON.Quaternion(phQuat.x, phQuat.y, phQuat.z, phQuat.w);

        certifiedPhysBody.addEventListener("collide", (e) => {
          if (!certifiedPhysBody._frozen) return;
          if (e.body.material === carMaterial) {
            certifiedPhysBody._frozen = false;
            certifiedPhysBody.allowSleep = false;
          }
        });
      }

      function syncCertifiedFromPhysics() {
        if (!certifiedGroup || !certifiedPhysBody) return;

        if (certifiedPhysBody._frozen && _certifiedInitPos) {
          certifiedPhysBody.position.copy(_certifiedInitPos);
          certifiedPhysBody.quaternion.copy(_certifiedInitQuat);
          certifiedPhysBody.velocity.set(0, 0, 0);
          certifiedPhysBody.angularVelocity.set(0, 0, 0);
        }

        certifiedGroup.position.set(
          certifiedPhysBody.position.x,
          certifiedPhysBody.position.y,
          certifiedPhysBody.position.z,
        );
        certifiedGroup.quaternion.set(
          certifiedPhysBody.quaternion.x,
          certifiedPhysBody.quaternion.y,
          certifiedPhysBody.quaternion.z,
          certifiedPhysBody.quaternion.w,
        );
      }

      const CONUS_PART_NAMES = ["conus", "conusStrips"];

      function setupConusPhysics(model) {
        let physicMesh = null;
        const visualParts = [];
        model.traverse((node) => {
          if (!node.isMesh) return;
          if (node.name === "conusPhysic") physicMesh = node;
          if (CONUS_PART_NAMES.includes(node.name)) visualParts.push(node);
        });
        if (!physicMesh) return;

        model.updateMatrixWorld(true);

        const phBB = new THREE.Box3().setFromObject(physicMesh);
        const phCenter = phBB.getCenter(new THREE.Vector3());
        const phSize = phBB.getSize(new THREE.Vector3());

        conusGroup = new THREE.Group();
        conusGroup.position.copy(phCenter);
        const phQuat = new THREE.Quaternion();
        physicMesh.getWorldQuaternion(phQuat);
        conusGroup.quaternion.copy(phQuat);
        scene.add(conusGroup);
        conusGroup.updateMatrixWorld(true);

        for (const mesh of visualParts) {
          conusGroup.attach(mesh);
        }
        conusGroup.attach(physicMesh);
        physicMesh.visible = false;

        const hx = phSize.x / 2;
        const hy = phSize.y / 2;
        const hz = phSize.z / 2;
        const shape = new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
        conusPhysBody = new CANNON.Body({
          mass: 0.15,
          material: propMaterial,
          linearDamping: 0.6,
          angularDamping: 0.6,
          allowSleep: false,
          collisionFilterGroup: 1,
          collisionFilterMask: -1,
          ccdSpeedThreshold: 1,
          ccdIterations: 10,
        });
        conusPhysBody.addShape(shape);
        conusPhysBody.position.set(phCenter.x, phCenter.y, phCenter.z);
        conusPhysBody.quaternion.set(phQuat.x, phQuat.y, phQuat.z, phQuat.w);
        physicsWorld.addBody(conusPhysBody);
      }

      function syncConusFromPhysics() {
        if (!conusGroup || !conusPhysBody) return;
        conusGroup.position.set(
          conusPhysBody.position.x,
          conusPhysBody.position.y,
          conusPhysBody.position.z,
        );
        conusGroup.quaternion.set(
          conusPhysBody.quaternion.x,
          conusPhysBody.quaternion.y,
          conusPhysBody.quaternion.z,
          conusPhysBody.quaternion.w,
        );
      }

      const DRAWER_PART_NAMES = ["drawerPannel", "drawerEffect", "drawer"];

      function setupDrawerGroup(model) {
        const parts = [];
        model.traverse((node) => {
          if (node.isMesh && DRAWER_PART_NAMES.includes(node.name)) parts.push(node);
          if (node.isMesh && node.name === "drawerEffect") _drawerEffectMesh = node;
        });
        if (parts.length === 0) return;

        model.updateMatrixWorld(true);
        const bb = new THREE.Box3();
        for (const p of parts) bb.expandByObject(p);
        const center = bb.getCenter(new THREE.Vector3());

        drawerGroup = new THREE.Group();
        drawerGroup.position.copy(center);
        scene.add(drawerGroup);
        drawerGroup.updateMatrixWorld(true);

        for (const mesh of parts) {
          drawerGroup.attach(mesh);
        }
        _drawerOrigZ = drawerGroup.position.z;
        createPortalEffect();
      }

      function updateDrawerAnimation() {
        if (!drawerGroup || _drawerState === "closed") return;
        const elapsed = performance.now() - _drawerAnimStart;

        if (_drawerState === "opening") {
          const t = Math.min(elapsed / DRAWER_SLIDE_DURATION, 1);
          const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          drawerGroup.position.z = _drawerOrigZ + DRAWER_SLIDE_DISTANCE * ease;
          if (t >= 1) {
            _drawerState = "open";
            _drawerAnimStart = performance.now();
          }
        } else if (_drawerState === "open") {
          if (elapsed >= DRAWER_OPEN_HOLD) {
            _drawerState = "closing";
            _drawerAnimStart = performance.now();
          }
        } else if (_drawerState === "closing") {
          const t = Math.min(elapsed / DRAWER_SLIDE_DURATION, 1);
          const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          drawerGroup.position.z = _drawerOrigZ + DRAWER_SLIDE_DISTANCE * (1 - ease);
          if (t >= 1) {
            drawerGroup.position.z = _drawerOrigZ;
            _drawerState = "closed";
          }
        }
      }

      const _particleVertexShader = `
        attribute float aSize;
        attribute float aPhase;
        attribute float aRadius;
        attribute float aType;
        attribute float aBottom;
        attribute float aSpeed;
        uniform float uTime;
        uniform float uOpacity;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          float speed = 0.12 + aType * 0.10;
          float life = fract(aPhase + uTime * speed);

          float bottomLife = life * (0.3 + aBottom * 0.25);
          float usedLife = mix(life, bottomLife, aBottom);

          float dir = aPhase > 0.5 ? 1.0 : -1.0;
          float angSpeed = 1.8 + aType * 2.2;
          float spiralWinds = 4.0 + aType * 3.0;
          float ang = aPhase * 6.2832 * spiralWinds + uTime * angSpeed * dir + usedLife * 6.2832 * 2.0;
          float rad = aRadius;

          float wobble = sin(usedLife * 12.5664 + aPhase * 30.0) * 0.1;
          rad += wobble;

          float rise = (usedLife - 0.5) * (0.6 + aType * 0.8);
          float bottomClamp = -0.6 - aBottom * 0.3;
          rise = mix(rise, max(rise, bottomClamp), aBottom);
          vec3 pos = vec3(cos(ang) * rad, sin(ang) * rad, rise);

          float fade = sin(usedLife * 3.14159);
          fade *= smoothstep(0.0, 0.12, usedLife) * smoothstep(1.0, 0.75, usedLife);
          fade = mix(fade, max(fade, 0.7), aBottom);

          float hue = fract(aPhase * 5.13);
          if (aType > 1.5) {
            float rLife = fract(aPhase + uTime * aSpeed);
            float maxH = 2.0 + fract(aPhase * 3.71) * 5.0;
            float riseH = rLife * maxH;
            float startX = (fract(aPhase * 7.13) - 0.5) * 2.2;
            float startY = (fract(aPhase * 11.37) - 0.5) * 2.2;
            float driftX = sin(uTime * (0.2 + aPhase * 0.5) + aPhase * 50.0) * 0.2;
            float driftY = cos(uTime * (0.15 + aPhase * 0.4) + aPhase * 40.0) * 0.2;
            pos = vec3(startX + driftX, startY + driftY, riseH);
            float rFade = smoothstep(0.0, 0.15, rLife) * smoothstep(1.0, 0.5, rLife);
            vColor = mix(vec3(0.5, 0.0, 1.0), vec3(0.0, 1.0, 0.6), hue);
            vAlpha = rFade * uOpacity * 0.6;
            gl_PointSize = aSize * (1.5 - rLife * 0.8) * uOpacity;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
            return;
          }
          if (aType < 0.33) {
            vColor = mix(vec3(0.6, 0.0, 1.0), vec3(0.2, 0.5, 1.0), hue);
            vAlpha = fade * uOpacity * 0.5;
          } else if (aType < 0.66) {
            vColor = mix(vec3(0.0, 0.8, 0.5), vec3(0.3, 0.2, 1.0), hue);
            vAlpha = fade * uOpacity * 0.45;
          } else {
            vColor = mix(vec3(0.4, 0.0, 0.9), vec3(0.0, 1.0, 0.7), hue);
            vAlpha = fade * uOpacity * 0.4;
          }
          if (hue > 0.9) {
            vColor = vec3(0.2, 0.6, 1.0);
            vAlpha = fade * uOpacity * 0.5;
          }
          float sizeBoost = mix(1.0, 1.8, aBottom);
          gl_PointSize = aSize * sizeBoost * (1.3 - usedLife * 0.4) * uOpacity;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `;
      const _particleFragmentShader = `
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float soft = pow(smoothstep(0.5, 0.0, d), 1.2);
          gl_FragColor = vec4(vColor * 1.3, soft * vAlpha);
        }
      `;

      function createPortalEffect() {
        _portalGroup = new THREE.Group();
        _portalGroup.visible = false;
        _portalGroup.scale.setScalar(0.9);
        scene.add(_portalGroup);

        const spiralCount = 1500;
        const bottomCount = 1000;
        const risingCount = 200;
        const pCount = spiralCount + bottomCount + risingCount;
        const positions = new Float32Array(pCount * 3);
        const sizes = new Float32Array(pCount);
        const phases = new Float32Array(pCount);
        const radii = new Float32Array(pCount);
        const types = new Float32Array(pCount);
        const bottoms = new Float32Array(pCount);
        for (let i = 0; i < spiralCount; i++) {
          positions[i * 3] = 0;
          positions[i * 3 + 1] = 0;
          positions[i * 3 + 2] = 0;
          phases[i] = Math.random();
          bottoms[i] = 0.0;
          const t = i / spiralCount;
          if (t < 0.5) {
            radii[i] = 0.8 + Math.random() * 0.5;
            sizes[i] = 6 + Math.random() * 12;
            types[i] = 0.0;
          } else if (t < 0.8) {
            radii[i] = 0.5 + Math.random() * 1.0;
            sizes[i] = 4 + Math.random() * 8;
            types[i] = 0.5;
          } else {
            radii[i] = 0.3 + Math.random() * 1.4;
            sizes[i] = 2 + Math.random() * 5;
            types[i] = 1.0;
          }
        }
        for (let i = spiralCount; i < spiralCount + bottomCount; i++) {
          positions[i * 3] = 0;
          positions[i * 3 + 1] = 0;
          positions[i * 3 + 2] = 0;
          phases[i] = Math.random();
          bottoms[i] = 0.6 + Math.random() * 0.4;
          radii[i] = 0.2 + Math.random() * 1.2;
          sizes[i] = 8 + Math.random() * 16;
          types[i] = Math.random() < 0.7 ? 0.0 : 0.5;
        }
        const speeds = new Float32Array(pCount);
        for (let i = 0; i < spiralCount + bottomCount; i++) {
          speeds[i] = 0.0;
        }
        for (let i = spiralCount + bottomCount; i < pCount; i++) {
          positions[i * 3] = 0;
          positions[i * 3 + 1] = 0;
          positions[i * 3 + 2] = 0;
          phases[i] = Math.random();
          bottoms[i] = 0.0;
          radii[i] = Math.random() * 1.8;
          sizes[i] = 1 + Math.random() * 10;
          types[i] = 2.0;
          speeds[i] = 0.03 + Math.random() * 0.18;
        }
        const pGeo = new THREE.BufferGeometry();
        pGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        pGeo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
        pGeo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
        pGeo.setAttribute("aRadius", new THREE.BufferAttribute(radii, 1));
        pGeo.setAttribute("aType", new THREE.BufferAttribute(types, 1));
        pGeo.setAttribute("aBottom", new THREE.BufferAttribute(bottoms, 1));
        pGeo.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
        const pMat = new THREE.ShaderMaterial({
          vertexShader: _particleVertexShader,
          fragmentShader: _particleFragmentShader,
          uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
          transparent: true, depthWrite: false, blending: THREE.NormalBlending,
        });
        _portalParticles = new THREE.Points(pGeo, pMat);
        _portalParticles.renderOrder = 1010;
        _portalParticles.visible = false;

        const rimGeo = new THREE.TorusGeometry(1.3, 0.06, 32, 128);
        const rimMat = new THREE.ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uOpacity: { value: 0 },
          },
          vertexShader: `
            varying vec3 vNorm;
            varying vec3 vPos;
            varying vec2 vUv;
            void main() {
              vNorm = normalize(normalMatrix * normal);
              vPos = (modelViewMatrix * vec4(position, 1.0)).xyz;
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform float uTime;
            uniform float uOpacity;
            varying vec3 vNorm;
            varying vec3 vPos;
            varying vec2 vUv;
            void main() {
              vec3 viewDir = normalize(-vPos);
              float fresnel = pow(1.0 - abs(dot(vNorm, viewDir)), 2.0);
              float pulse = 0.7 + 0.3 * sin(uTime * 3.0 + vUv.x * 25.0);
              vec3 purple1 = vec3(0.6, 0.0, 1.0);
              vec3 purple2 = vec3(0.9, 0.2, 1.0);
              vec3 col = mix(purple1, purple2, fresnel) * pulse;
              float alpha = (0.6 + fresnel * 0.8) * uOpacity;
              gl_FragColor = vec4(col * 2.5, alpha);
            }
          `,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        });
        _portalRim = new THREE.Mesh(rimGeo, rimMat);
        _portalRim.renderOrder = 1011;
        _portalGroup.add(_portalRim);
      }

      function updatePortalEffect() {
        if (!_portalGroup) return;

        let targetOpacity = 0;
        if (_drawerState === "open") {
          const elapsed = performance.now() - _drawerAnimStart;
          const fadeIn = Math.min(elapsed / PORTAL_FADE_DURATION, 1.0);
          const timeLeft = DRAWER_OPEN_HOLD - elapsed;
          const fadeOut = Math.min(timeLeft / PORTAL_FADE_DURATION, 1.0);
          targetOpacity = Math.min(fadeIn, Math.max(fadeOut, 0));
        }

        _portalOpacity += (targetOpacity - _portalOpacity) * 0.08;
        if (_portalOpacity < 0.005) _portalOpacity = 0;

        const visible = _portalOpacity > 0.001;
        _portalGroup.visible = visible;
        if (!visible) return;

        if (_drawerEffectMesh && drawerGroup) {
          _drawerEffectMesh.getWorldPosition(_portalGroup.position);
          _portalGroup.position.y += 0.8;
          _portalGroup.position.z += 0.8;
          _portalGroup.rotation.x = -Math.PI / 2;
        }

        const t = performance.now() / 1000;
        _portalParticles.material.uniforms.uTime.value = t;
        _portalParticles.material.uniforms.uOpacity.value = _portalOpacity;
        if (_portalRim) {
          _portalRim.material.uniforms.uTime.value = t;
          _portalRim.material.uniforms.uOpacity.value = _portalOpacity;
        }
      }

      function setupSimplePropPhysics(model, meshName, mass, shapeType) {
        let physicMesh = null;
        model.traverse((node) => {
          if (node.isMesh && node.name === meshName) physicMesh = node;
        });
        if (!physicMesh) return null;

        model.updateMatrixWorld(true);
        physicMesh.updateMatrixWorld(true);

        const bb = new THREE.Box3().setFromObject(physicMesh);
        const center = bb.getCenter(new THREE.Vector3());
        const size = bb.getSize(new THREE.Vector3());

        physicMesh.visible = false;

        let shape;
        if (shapeType === "cylinder") {
          physicMesh.geometry.computeBoundingBox();
          const geoBB = physicMesh.geometry.boundingBox;
          const localSize = new THREE.Vector3().subVectors(geoBB.max, geoBB.min);
          const worldScale = new THREE.Vector3();
          physicMesh.getWorldScale(worldScale);
          const localRadiusX = (localSize.x / 2) * Math.abs(worldScale.x);
          const localRadiusZ = (localSize.z / 2) * Math.abs(worldScale.z);
          const radius = Math.min(localRadiusX, localRadiusZ);
          const height = localSize.y * Math.abs(worldScale.y);
          shape = new CANNON.Cylinder(radius, radius, height, 16);
        } else {
          shape = new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2));
        }
        const body = new CANNON.Body({
          mass: 0,
          type: CANNON.Body.STATIC,
          material: propMaterial,
          allowSleep: false,
          collisionFilterGroup: 1,
          collisionFilterMask: -1,
        });
        body.addShape(shape);
        body.position.set(center.x, center.y, center.z);
        const q = new THREE.Quaternion();
        physicMesh.getWorldQuaternion(q);
        body.quaternion.set(q.x, q.y, q.z, q.w);
        physicsWorld.addBody(body);
        return { mesh: physicMesh, body: body };
      }

      const _tmpHE = new CANNON.Vec3();
      function getShapeHalfExtents(sh) {
        if (sh.halfExtents) return sh.halfExtents;
        if (sh.radiusTop !== undefined) {
          const r = Math.max(sh.radiusTop, sh.radiusBottom);
          _tmpHE.set(r, sh.height / 2, r);
          return _tmpHE;
        }
        return null;
      }

      const PROP_PHYS_NAMES = [
        "dockingStationPhysic", "plantVasePhysic", "macScreenFramePhysic",
        "macBodyBasePhysic", "mainScreensPin", "mainScreensBase",
      ];
      const _propBodies = {};
      const _propMeshes = {};

      function setupAllPropPhysics(model) {
        const propMasses = {
          dockingStationPhysic: 15,
          plantVasePhysic: 20,
          macScreenFramePhysic: 25,
          macBodyBasePhysic: 20,
          mainScreensPin: 10,
          mainScreensBase: 25,
        };
        const propShapes = {
          plantVasePhysic: "cylinder",
        };
        for (const name of PROP_PHYS_NAMES) {
          try {
            const result = setupSimplePropPhysics(model, name, propMasses[name] || 15, propShapes[name]);
            if (result) {
              _propBodies[name] = result.body;
              _propMeshes[name] = result.mesh;
            }
          } catch (e) {
            console.warn("Prop physics setup failed for " + name + ":", e);
          }
        }
        dockingStationPhysBody = _propBodies["dockingStationPhysic"] || null;
        plantVasePhysBody = _propBodies["plantVasePhysic"] || null;
        if (plantVasePhysBody) plantVasePhysBody._noClimb = true;
        macScreenFramePhysBody = _propBodies["macScreenFramePhysic"] || null;
        macBodyBasePhysBody = _propBodies["macBodyBasePhysic"] || null;
        if (macBodyBasePhysBody) macBodyBasePhysBody._driveableStep = CAR_DRIVEABLE_PROP_MAX_STEP;
        mainScreensPinPhysBody = _propBodies["mainScreensPin"] || null;
        mainScreensBasePhysBody = _propBodies["mainScreensBase"] || null;

      }

      let _macCarStartYaw = 0;

      function getMacCarStartPose(model, outPos) {
        let macKeyboard = null;
        model.traverse((node) => {
          if (node.isMesh && node.name === "macKeyboard") macKeyboard = node;
        });
        if (!macKeyboard) return false;
        macKeyboard.updateMatrixWorld(true);
        const kbBox = new THREE.Box3().setFromObject(macKeyboard);
        if (kbBox.isEmpty()) return false;
        const kbSize = kbBox.getSize(new THREE.Vector3());
        const kbCenter = kbBox.getCenter(_macSpawnWorld);
        macKeyboard.getWorldQuaternion(_macKbQuat);
        _macSpawnLocal.set(
          kbSize.x * MAC_CAR_START_LOCAL_X,
          0,
          kbSize.z * MAC_CAR_START_LOCAL_Z,
        );
        outPos
          .copy(_macSpawnLocal)
          .applyQuaternion(_macKbQuat)
          .add(kbCenter);
        outPos.y = kbBox.max.y;
        _macKbRight.set(1, 0, 0).applyQuaternion(_macKbQuat);
        _macCarStartYaw =
          Math.atan2(_macKbRight.x, _macKbRight.z) + MAC_CAR_START_YAW_OFFSET;
        return true;
      }

      function syncAllPropsFromPhysics() {
        for (const name of PROP_PHYS_NAMES) {
          const body = _propBodies[name];
          const mesh = _propMeshes[name];
          if (!body || !mesh) continue;
          mesh.position.set(body.position.x, body.position.y, body.position.z);
          mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
        }
      }

      const GUM_DISPENSER_PART_NAMES = [
        "gumsCup", "gumsTank", "gumsBody", "gumsStand", "gumsRamp", "gumsStoper",
        "gumsBodyPhysic", "gumsTankPhysic", "gumsTankPhysicCup",
      ];

      function setupGumDispenserPhysics(model) {
        let physicMesh = null;
        const groupParts = [];
        model.traverse((node) => {
          if (node.name === "GumDispenserAllPhysic") physicMesh = node;
          if (GUM_DISPENSER_PART_NAMES.includes(node.name)) groupParts.push(node);
        });
        if (!physicMesh) return;
        gumDispenserPhysicMesh = physicMesh;

        model.updateMatrixWorld(true);

        const phBB = new THREE.Box3().setFromObject(physicMesh);
        const phCenter = phBB.getCenter(new THREE.Vector3());
        const phSize = phBB.getSize(new THREE.Vector3());

        gumDispenserGroup = new THREE.Group();
        gumDispenserGroup.position.copy(phCenter);
        const phQuat = new THREE.Quaternion();
        physicMesh.getWorldQuaternion(phQuat);
        gumDispenserGroup.quaternion.copy(phQuat);
        scene.add(gumDispenserGroup);
        gumDispenserGroup.updateMatrixWorld(true);

        for (const part of groupParts) {
          gumDispenserGroup.attach(part);
        }
        const extraParts = [
          gumsTankPhysicObject, gumsTankPhysicCupObject, gumsBodyObject,
        ].filter(Boolean);
        for (const ep of extraParts) {
          if (!groupParts.includes(ep)) {
            gumDispenserGroup.attach(ep);
          }
        }
        gumDispenserGroup.attach(physicMesh);
        physicMesh.visible = false;

        const hx = phSize.x / 2;
        const hy = phSize.y / 2;
        const hz = phSize.z / 2;
        const shape = new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
        const GD_MASK = ~(PHYS_GROUP_GUM_SPHERE | PHYS_GROUP_GUMS_TRIMESH |
          PHYS_GROUP_GUMS_BODY | PHYS_GROUP_GUMS_STAND | PHYS_GROUP_GUMS_RAMP |
          PHYS_GROUP_GUMS_STOPPER | PHYS_GROUP_GUMS_INNER);
        gumDispenserPhysBody = new CANNON.Body({
          mass: 10000.0,
          type: CANNON.Body.DYNAMIC,
          material: gumDispenserMaterial,
          linearDamping: 0.7,
          angularDamping: 0.8,
          allowSleep: true,
          sleepSpeedLimit: 0.3,
          sleepTimeLimit: 0.5,
          collisionFilterGroup: 1,
          collisionFilterMask: GD_MASK,
          ccdSpeedThreshold: 1,
          ccdIterations: 10,
        });
        gumDispenserPhysBody.addShape(shape);
        gumDispenserPhysBody.position.set(phCenter.x, phCenter.y, phCenter.z);
        gumDispenserPhysBody.quaternion.set(phQuat.x, phQuat.y, phQuat.z, phQuat.w);
        gumDispenserPhysBody._frozen = true;
        physicsWorld.addBody(gumDispenserPhysBody);

        gumDispenserPhysBody.addEventListener("collide", (e) => {
          if (!gumDispenserPhysBody._frozen) return;
          if (e.body.material === carMaterial) {
            gumDispenserPhysBody._frozen = false;
          }
        });

        _gumDispenserInitPos = new CANNON.Vec3(phCenter.x, phCenter.y, phCenter.z);
        _gumDispenserInitQuat = new CANNON.Quaternion(phQuat.x, phQuat.y, phQuat.z, phQuat.w);
        _gumDispenserInternalBodies = [
          gumsTankPhysBody, gumsTankCupBody,
          gumsBodyPhysBody, gumsStandPhysBody, gumsRampPhysBody,
        ].filter(Boolean);
        for (const b of _gumDispenserInternalBodies) {
          b._gdOrigPos = new CANNON.Vec3(b.position.x, b.position.y, b.position.z);
          b._gdOrigQuat = new CANNON.Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
        }
      }

      const _gdDelta = new CANNON.Vec3();
      const _gdRotatedOffset = new CANNON.Vec3();
      const _gdInvInitQuat = new CANNON.Quaternion();
      const _gdRelQuat = new CANNON.Quaternion();

      let _gumDispenserBecameDynamic = false;

      function syncGumDispenserFromPhysics() {
        if (!gumDispenserGroup || !gumDispenserPhysBody) return;

        if (gumDispenserPhysBody._frozen && _gumDispenserInitPos) {
          gumDispenserPhysBody.position.copy(_gumDispenserInitPos);
          gumDispenserPhysBody.quaternion.copy(_gumDispenserInitQuat);
          gumDispenserPhysBody.velocity.set(0, 0, 0);
          gumDispenserPhysBody.angularVelocity.set(0, 0, 0);
        }

        const p = gumDispenserPhysBody.position;
        const q = gumDispenserPhysBody.quaternion;
        gumDispenserGroup.position.set(p.x, p.y, p.z);
        gumDispenserGroup.quaternion.set(q.x, q.y, q.z, q.w);

        if (!_gumDispenserInitPos) return;

        if (!gumDispenserPhysBody._frozen && !_gumDispenserBecameDynamic) {
          _gumDispenserBecameDynamic = true;
          gumDispenserPhysBody.allowSleep = false;
          if (gumsStoperBody && physicsWorld.bodies.includes(gumsStoperBody)) {
            physicsWorld.removeBody(gumsStoperBody);
            if (gumsStoperObject) gumsStoperObject.visible = false;
          }
          for (let i = 0; i < gumsAddedCount; i++) {
            const gb = gumBodies[i];
            if (gb.type === CANNON.Body.STATIC) {
              gb.type = CANNON.Body.DYNAMIC;
              gb.mass = 0.5;
              gb.updateMassProperties();
            }
            gb.wakeUp();
          }
        }

        if (_gumDispenserInternalBodies.length === 0 || gumDispenserPhysBody._frozen) return;

        _gumDispenserInitQuat.conjugate(_gdInvInitQuat);
        _gdRelQuat.copy(_gdInvInitQuat);
        q.mult(_gdRelQuat, _gdRelQuat);

        for (const b of _gumDispenserInternalBodies) {
          if (_cupSlideActive && b === gumsTankCupBody) continue;
          b._gdOrigPos.vsub(_gumDispenserInitPos, _gdDelta);
          _gdRelQuat.vmult(_gdDelta, _gdRotatedOffset);
          b.position.copy(p);
          b.position.vadd(_gdRotatedOffset, b.position);
          _gdRelQuat.mult(b._gdOrigQuat, b.quaternion);
          b.aabbNeedsUpdate = true;
        }
      }

      function createCertifiedGradientTexture() {
        const w = 64;
        const h = 512;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        const grd = ctx.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, "#0a0f5c");
        grd.addColorStop(0.15, "#1e3a8a");
        grd.addColorStop(0.28, "#5b21b6");
        grd.addColorStop(0.42, "#9d174d");
        grd.addColorStop(0.55, "#ea580c");
        grd.addColorStop(0.68, "#fb923c");
        grd.addColorStop(0.82, "#fed7aa");
        grd.addColorStop(1, "#f0f4ff");
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, w, h);
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.flipY = true;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        return tex;
      }

      function createCertifiedCircleTexture() {
        const size = 512;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        const cx = size / 2;
        const cy = size / 2;
        const r = size / 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        const grd = ctx.createLinearGradient(0, 0, 0, size);
        grd.addColorStop(0, "#0a0f5c");
        grd.addColorStop(0.15, "#1e3a8a");
        grd.addColorStop(0.28, "#5b21b6");
        grd.addColorStop(0.42, "#9d174d");
        grd.addColorStop(0.55, "#ea580c");
        grd.addColorStop(0.68, "#fb923c");
        grd.addColorStop(0.82, "#fed7aa");
        grd.addColorStop(1, "#f0f4ff");
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, size, size);
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        const alphaGrd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        alphaGrd.addColorStop(0, "rgba(255,255,255,1)");
        alphaGrd.addColorStop(0.6, "rgba(255,255,255,0.9)");
        alphaGrd.addColorStop(0.85, "rgba(255,255,255,0.4)");
        alphaGrd.addColorStop(1, "rgba(255,255,255,0)");
        ctx.globalCompositeOperation = "destination-in";
        ctx.fillStyle = alphaGrd;
        ctx.fillRect(0, 0, size, size);
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.flipY = true;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        return tex;
      }

      const certifiedBackgroundTexture = createCertifiedGradientTexture();
      const certifiedCircleTexture = createCertifiedCircleTexture();

      const certifiedBackgroundMaterial = new THREE.MeshStandardMaterial({
        color: 0x000000,
        roughness: 1,
        metalness: 0,
        emissiveMap: certifiedBackgroundTexture,
        emissive: 0xffffff,
        emissiveIntensity: 1,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        toneMapped: false,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });

      const certifiedCircleMaterial = new THREE.MeshStandardMaterial({
        color: 0x000000,
        roughness: 1,
        metalness: 0,
        emissiveMap: certifiedCircleTexture,
        emissive: 0xffffff,
        emissiveIntensity: 1,
        transparent: true,
        opacity: 1,
        alphaMap: certifiedCircleTexture,
        side: THREE.DoubleSide,
        toneMapped: false,
        depthWrite: true,
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: 4,
        polygonOffsetUnits: 4,
      });
      const certifiedTextMaterial = new THREE.MeshStandardMaterial({
        color: 0xf8f8f8,
        roughness: 0.9,
        metalness: 0,
        emissive: 0xe8e8e8,
        emissiveIntensity: 0.45,
      });
      const certifiedBodyMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.5,
        roughness: 0.3,
        metalness: 0,
        transmission: 0.1,
        thickness: 0.5,
        ior: 10.0,
        reflectivity: 1.0,
        envMapIntensity: 2.0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      certifiedBodyMaterial.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <output_fragment>',
          `
          vec3 viewDir = normalize(vViewPosition);
          float fresnelTerm = pow(1.0 - abs(dot(normal, viewDir)), 2.0);
          vec3 edgeGlow = vec3(1.0, 1.0, 1.0) * fresnelTerm * 1.8;
          outgoingLight += edgeGlow;
          #include <output_fragment>
          `
        );
      };

      const CERTIFIED_MESH_NAMES = [
        "cetifiedBackground",
        "cetifiedCircle",
        "certifiedDesignText",
        "certifiedTitle",
        "wixLogo",
        "certifiedBody",
      ];

      function applyCertifiedMaterials(model) {
        const _box = new THREE.Box3();
        const _pos = new THREE.Vector3();
        model.traverse((node) => {
          if (!node.isMesh || !node.geometry) return;
          const name = node.name || "";
          let mat = null;
          if (name === "cetifiedBackground") {
            mat = certifiedBackgroundMaterial;
            node.geometry = node.geometry.clone();
            const pos = node.geometry.attributes.position;
            const count = pos.count;
            const uvs = new Float32Array(count * 2);
            _box.setFromBufferAttribute(pos);
            const sx = _box.max.x - _box.min.x || 1,
              sy = _box.max.y - _box.min.y || 1,
              sz = _box.max.z - _box.min.z || 1;
            const vertAxis = sy >= sx && sy >= sz ? "y" : sz >= sx ? "z" : "x";
            const horzAxis =
              vertAxis === "y" ? "x" : vertAxis === "z" ? "x" : "y";
            const minV = _box.min[vertAxis],
              sizeV = _box.max[vertAxis] - minV || 1;
            const minH = _box.min[horzAxis],
              sizeH = _box.max[horzAxis] - minH || 1;
            const zStretch = 0.65;
            const vScale = vertAxis === "z" ? zStretch : 1;
            const vBias = vertAxis === "z" ? (1 - vScale) * 0.5 : 0;
            const zOffsetLeft = vertAxis === "z" ? 0.24 : 0;
            for (let i = 0; i < count; i++) {
              _pos.fromBufferAttribute(pos, i);
              uvs[i * 2] = (_pos[horzAxis] - minH) / sizeH;
              uvs[i * 2 + 1] =
                ((_pos[vertAxis] - minV) / sizeV) * vScale +
                vBias +
                zOffsetLeft;
            }
            node.geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
          } else if (name === "cetifiedCircle") {
            mat = certifiedCircleMaterial;
            node.geometry = node.geometry.clone();
            const pos = node.geometry.attributes.position;
            const count = pos.count;
            const uvs = new Float32Array(count * 2);
            _box.setFromBufferAttribute(pos);
            const sx = _box.max.x - _box.min.x || 1e-6,
              sy = _box.max.y - _box.min.y || 1e-6,
              sz = _box.max.z - _box.min.z || 1e-6;
            const thinAxis = sx <= sy && sx <= sz ? "x" : sy <= sz ? "y" : "z";
            const ax1 = thinAxis === "x" ? "y" : thinAxis === "y" ? "x" : "x";
            const ax2 = thinAxis === "x" ? "z" : thinAxis === "y" ? "z" : "y";
            const c1 = (_box.min[ax1] + _box.max[ax1]) * 0.5,
              c2 = (_box.min[ax2] + _box.max[ax2]) * 0.5;
            const r1 = (_box.max[ax1] - _box.min[ax1]) * 0.5 || 1,
              r2 = (_box.max[ax2] - _box.min[ax2]) * 0.5 || 1;
            const zStretch = 1.55;
            const r1u = ax1 === "z" ? r1 * zStretch : r1;
            const r2u = ax2 === "z" ? r2 * zStretch : r2;
            const r = Math.max(r1, r2);
            for (let i = 0; i < count; i++) {
              _pos.fromBufferAttribute(pos, i);
              const d1 = (_pos[ax1] - c1) / (ax1 === "z" ? r1u : r),
                d2 = (_pos[ax2] - c2) / (ax2 === "z" ? r2u : r);
              uvs[i * 2] = d1 * 0.5 + 0.5;
              uvs[i * 2 + 1] = d2 * 0.5 + 0.5;
            }
            node.geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
          } else if (
            name === "certifiedDesignText" ||
            name === "certifiedTitle" ||
            name === "wixLogo"
          )
            mat = certifiedTextMaterial;
          else if (name === "certifiedBody") mat = certifiedBodyMaterial;
          else if (name === "certifiedBodyPhysic") node.visible = false;
          else if (name === "GumDispenserAllPhysic") node.visible = false;
          if (mat) {
            node.material = mat;
          }
        });
      }

      function applyPenMaterials(model) {
        model.traverse((node) => {
          if (!node.isMesh) return;
          if (
            node.name === "pen1" ||
            (node.parent && node.parent.name === "pen1")
          ) {
            if (Array.isArray(node.material)) {
              for (let i = 0; i < node.material.length; i++)
                node.material[i] = pen1Material;
            } else node.material = pen1Material;
          }
          if (
            node.name === "pen2" ||
            (node.parent && node.parent.name === "pen2")
          ) {
            if (Array.isArray(node.material)) {
              for (let i = 0; i < node.material.length; i++)
                node.material[i] = pen2Material;
            } else node.material = pen2Material;
          }
        });
      }

      function applyDuckMaterials(model) {
        model.traverse((node) => {
          if (!node.isMesh) return;
          const name = node.name || "";
          const parentName = node.parent ? node.parent.name || "" : "";
          let mat = null;
          if (name === "duckBody" || parentName === "duckBody")
            mat = duckBodyMaterial;
          else if (name === "duckMakor" || parentName === "duckMakor")
            mat = duckMakorMaterial;
          else if (name === "duckEyes" || parentName === "duckEyes")
            mat = duckEyesMaterial;
          if (mat) {
            if (Array.isArray(node.material)) {
              for (let i = 0; i < node.material.length; i++)
                node.material[i] = mat;
            } else node.material = mat;
          }
        });
      }

      function applyPhoneChargerCupMaterial(model) {
        model.traverse((node) => {
          if (!node.isMesh) return;
          if (
            node.name === "phoneChargerCup" ||
            (node.parent && node.parent.name === "phoneChargerCup")
          ) {
            if (!phoneChargerCupMesh) phoneChargerCupMesh = node;
            if (Array.isArray(node.material)) {
              for (let i = 0; i < node.material.length; i++)
                node.material[i] = phoneChargerCupMaterial;
            } else {
              node.material = phoneChargerCupMaterial;
            }
          }
        });
      }

      const phoneChargerLightMaterial = new THREE.MeshStandardMaterial({
        color: 0xcc3333,
        emissive: 0xff0000,
        emissiveIntensity: 2.2,
        roughness: 0.1,
        metalness: 0,
      });

      let phoneChargerLightMesh = null;
      const chargerCupBox = new THREE.Box3();
      const chargerCupBoxExpand = 0.22;

      function applyPhoneChargerLightMaterial(model) {
        model.traverse((node) => {
          if (!node.isMesh) return;
          if (
            node.name === "phoneChargerLight" ||
            (node.parent && node.parent.name === "phoneChargerLight")
          ) {
            if (!phoneChargerLightMesh) phoneChargerLightMesh = node;
            if (Array.isArray(node.material)) {
              for (let i = 0; i < node.material.length; i++)
                node.material[i] = phoneChargerLightMaterial;
            } else {
              node.material = phoneChargerLightMaterial;
            }
            node.position.y += 0.08;
          }
        });
      }

      const screenLightMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 3,
        roughness: 0.1,
        metalness: 0,
      });

      function applyScreenLightsMaterial(model) {
        model.traverse((node) => {
          if (!node.isMesh) return;
          if (
            node.name === "leftScreenLight" ||
            (node.parent && node.parent.name === "leftScreenLight") ||
            node.name === "rightScreenLight" ||
            (node.parent && node.parent.name === "rightScreenLight")
          ) {
            if (Array.isArray(node.material)) {
              for (let i = 0; i < node.material.length; i++)
                node.material[i] = screenLightMaterial;
            } else {
              node.material = screenLightMaterial;
            }
            node.frustumCulled = false;
          }
        });
      }

      let reflectionPlaneMesh = null;
      let tableReflector = null;
      let reflectionPlaneWorldPosition = null;
      let reflectionPlaneSurfaceY = null;
      const _reflectionBox = new THREE.Box3();
      const _reflectionPos = new THREE.Vector3();
      const _reflectionQuat = new THREE.Quaternion();

      function getTablePlaySurfaceY() {
        if (tablePlateMesh) {
          tablePlateMesh.updateMatrixWorld(true);
          _reflectionBox.setFromObject(tablePlateMesh);
          if (!_reflectionBox.isEmpty()) return _reflectionBox.max.y;
        }
        return reflectionPlaneSurfaceY ?? tableSurfaceY;
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
      }

      function getTablePlateShadowPose(outCenter) {
        if (!tablePlateMesh) return false;
        tablePlateMesh.updateMatrixWorld(true);
        _reflectionBox.setFromObject(tablePlateMesh);
        if (_reflectionBox.isEmpty()) return false;
        outCenter.set(
          (_reflectionBox.min.x + _reflectionBox.max.x) * 0.5,
          _reflectionBox.max.y,
          (_reflectionBox.min.z + _reflectionBox.max.z) * 0.5,
        );
        return true;
      }

      function setupReflectionPlane(model) {
        model.traverse((node) => {
          if (!node.isMesh) return;
          if (
            node.name === "reflectionPlane" ||
            (node.parent && node.parent.name === "reflectionPlane")
          ) {
            if (!reflectionPlaneMesh) reflectionPlaneMesh = node;
          }
        });
        if (!reflectionPlaneMesh) return;
        model.updateMatrixWorld(true);
        reflectionPlaneMesh.updateMatrixWorld(true);
        _reflectionBox.setFromObject(reflectionPlaneMesh);
        reflectionPlaneMesh.getWorldQuaternion(_reflectionQuat);
        if (tablePlateMesh) {
          tablePlateMesh.updateMatrixWorld(true);
          const tableBox = new THREE.Box3().setFromObject(tablePlateMesh);
          if (!tableBox.isEmpty()) {
            const tableCenter = tableBox.getCenter(new THREE.Vector3());
            const tableTopY = tableBox.max.y;
            const tableTopWorld = new THREE.Vector3(
              tableCenter.x,
              tableTopY,
              tableCenter.z,
            );
            tableTopWorld.applyMatrix4(model.matrixWorld.clone().invert());
            _reflectionPos.copy(tableTopWorld);
            _reflectionPos.y += 0.002;
          }
        } else {
          reflectionPlaneMesh.getWorldPosition(_reflectionPos);
          model.worldToLocal(_reflectionPos);
        }
        if (!reflectionPlaneWorldPosition)
          reflectionPlaneWorldPosition = new THREE.Vector3();
        model.localToWorld(reflectionPlaneWorldPosition.copy(_reflectionPos));
        reflectionPlaneSurfaceY = _reflectionBox.max.y;
        reflectionPlaneMesh.visible = false;
        if (!perfSettings.reflection) return;

        const size = _reflectionBox.getSize(new THREE.Vector3());
        const planeW = Math.max(size.x, 0.01);
        const planeH = Math.max(size.z, 0.01);
        const reflectorGeo = new THREE.PlaneGeometry(planeW, planeH);
        const reflTex = useVisualParity()
          ? perfSettings.reflectionTex || 128
          : perfSettings.reflectionTex || 128;
        const reflector = new Reflector(reflectorGeo, {
          color: 0x777777,
          textureWidth: reflTex,
          textureHeight: reflTex,
          clipBias: 0.003,
        });
        tableReflector = reflector;
        reflector.material.uniforms.opacity = { value: 0.2 };
        reflector.material.transparent = true;
        reflector.material.depthWrite = false;
        reflector.material.fragmentShader = reflector.material.fragmentShader
          .replace(
            "uniform vec3 color;",
            "uniform vec3 color;\nuniform float opacity;",
          )
          .replace(
            "gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );",
            "gl_FragColor = vec4( base.rgb * color, opacity );",
          );
        _reflectionQuat.premultiply(
          model.getWorldQuaternion(new THREE.Quaternion()).invert(),
        );
        reflector.position.copy(_reflectionPos);
        reflector.quaternion.copy(_reflectionQuat);
        reflector.rotateX(Math.PI / 2 + Math.PI);
        reflector.scale.set(1, 1, 1);
        model.add(reflector);
      }

      const WINDOW_TRIS_DUPLICATE_COUNT = 60;
      const WINDOW_TRIS_SPACING = 1.0;
      const WINDOW_TRIS_COMPACT_SPACING = 0.3; // spacing when I is pressed in bright mode
      const WINDOW_TRIS_DARK_ROTATION_X = Math.PI / 4; // 45° on X when lightBlend→0 (closed / dark)
      const WINDOW_GROUP_X_COPIES_PER_SIDE = 2; // duplicate this many times to left and right of center
      const WINDOW_GROUP_X_SPACING = 25; // spacing between window groups on X axis
      let windowTrisMeshes = [];
      let windowTrisSlotIndices = []; // 0..59 per mesh, for spacing update
      let windowTrisBaseYs = [];
      let compactSpacingActive = false; // target state when I is pressed
      let compactSpacingBlend = 0; // 0 = normal, 1 = compact, animates over 1s
      let compactSpacingAnimStart = 0; // time when current spacing anim started
      let compactSpacingAnimFrom = 0; // blend value at anim start
      const COMPACT_SPACING_ANIM_DURATION = 1;

      function duplicateWindowTris(model) {
        windowTrisMeshes = [];
        windowTrisSlotIndices = [];
        windowTrisBaseYs = [];
        let windowTrisMesh = null;
        let windowFrameMesh = null;
        let windowGlassMesh = null;
        model.traverse((node) => {
          if (node.name === "windowTris" && node.isMesh) windowTrisMesh = node;
          if (node.name === "windowFrame" && node.isMesh)
            windowFrameMesh = node;
          if (node.name === "windowGlass" && node.isMesh)
            windowGlassMesh = node;
          if (
            !windowTrisMesh &&
            node.parent &&
            node.parent.name === "windowTris" &&
            node.isMesh
          )
            windowTrisMesh = node;
        });
        if (!windowTrisMesh) return;

        const parent = windowTrisMesh.parent;
        const windowUnitGroup = new THREE.Group();
        windowUnitGroup.name = "windowUnit";

        if (windowFrameMesh && windowFrameMesh.parent) {
          windowFrameMesh.parent.remove(windowFrameMesh);
          windowUnitGroup.add(windowFrameMesh);
        }
        if (windowGlassMesh && windowGlassMesh.parent) {
          windowGlassMesh.parent.remove(windowGlassMesh);
          windowUnitGroup.add(windowGlassMesh);
        }
        parent.remove(windowTrisMesh);
        windowUnitGroup.add(windowTrisMesh);
        const basePos = new THREE.Vector3().copy(windowTrisMesh.position);
        windowTrisMeshes.push(windowTrisMesh);
        windowTrisSlotIndices.push(0);
        windowTrisBaseYs.push(basePos.y);

        for (let i = 1; i < WINDOW_TRIS_DUPLICATE_COUNT; i++) {
          const clone = windowTrisMesh.clone();
          clone.position.set(
            basePos.x,
            basePos.y - i * WINDOW_TRIS_SPACING,
            basePos.z,
          );
          windowUnitGroup.add(clone);
          windowTrisMeshes.push(clone);
          windowTrisSlotIndices.push(i);
          windowTrisBaseYs.push(basePos.y);
        }

        parent.add(windowUnitGroup);

        function setMaterialDoubleSide(mat) {
          if (mat) mat.side = THREE.DoubleSide;
        }
        function setMeshDoubleSide(mesh) {
          if (!mesh || !mesh.material) return;
          if (Array.isArray(mesh.material))
            mesh.material.forEach(setMaterialDoubleSide);
          else setMaterialDoubleSide(mesh.material);
        }
        if (windowFrameMesh) setMeshDoubleSide(windowFrameMesh);

        for (let i = 1; i <= WINDOW_GROUP_X_COPIES_PER_SIDE; i++) {
          const groupCloneLeft = windowUnitGroup.clone(true);
          groupCloneLeft.position.x = -i * WINDOW_GROUP_X_SPACING;
          parent.add(groupCloneLeft);
          const leftTris = [];
          groupCloneLeft.traverse((node) => {
            if (node.isMesh && node.name === "windowTris") leftTris.push(node);
            if (node.isMesh && node.name === "windowFrame")
              setMeshDoubleSide(node);
          });
          leftTris.sort((a, b) => b.position.y - a.position.y);
          leftTris.forEach((mesh, slot) => {
            windowTrisMeshes.push(mesh);
            windowTrisSlotIndices.push(slot);
            windowTrisBaseYs.push(basePos.y);
          });
          const groupCloneRight = windowUnitGroup.clone(true);
          groupCloneRight.position.x = i * WINDOW_GROUP_X_SPACING;
          parent.add(groupCloneRight);
          const rightTris = [];
          groupCloneRight.traverse((node) => {
            if (node.isMesh && node.name === "windowTris") rightTris.push(node);
            if (node.isMesh && node.name === "windowFrame")
              setMeshDoubleSide(node);
          });
          rightTris.sort((a, b) => b.position.y - a.position.y);
          rightTris.forEach((mesh, slot) => {
            windowTrisMeshes.push(mesh);
            windowTrisSlotIndices.push(slot);
            windowTrisBaseYs.push(basePos.y);
          });
        }
        const groupCloneLeftExtra = windowUnitGroup.clone(true);
        groupCloneLeftExtra.position.x =
          -(WINDOW_GROUP_X_COPIES_PER_SIDE + 1) * WINDOW_GROUP_X_SPACING +
          WINDOW_GROUP_X_SPACING +
          2.5;
        groupCloneLeftExtra.position.z = -1.7;
        groupCloneLeftExtra.rotation.y = Math.PI / 2;
        parent.add(groupCloneLeftExtra);
        const leftTrisExtra = [];
        groupCloneLeftExtra.traverse((node) => {
          if (node.isMesh && node.name === "windowTris")
            leftTrisExtra.push(node);
          if (node.isMesh && node.name === "windowFrame")
            setMeshDoubleSide(node);
        });
        leftTrisExtra.sort((a, b) => b.position.y - a.position.y);
        leftTrisExtra.forEach((mesh, slot) => {
          windowTrisMeshes.push(mesh);
          windowTrisSlotIndices.push(slot);
          windowTrisBaseYs.push(basePos.y);
        });
        const groupCloneLeftExtraZ = groupCloneLeftExtra.clone(true);
        groupCloneLeftExtraZ.position.z = -1.7 + WINDOW_GROUP_X_SPACING;
        parent.add(groupCloneLeftExtraZ);
        const leftTrisExtraZ = [];
        groupCloneLeftExtraZ.traverse((node) => {
          if (node.isMesh && node.name === "windowTris")
            leftTrisExtraZ.push(node);
          if (node.isMesh && node.name === "windowFrame")
            setMeshDoubleSide(node);
        });
        leftTrisExtraZ.sort((a, b) => b.position.y - a.position.y);
        leftTrisExtraZ.forEach((mesh, slot) => {
          windowTrisMeshes.push(mesh);
          windowTrisSlotIndices.push(slot);
          windowTrisBaseYs.push(basePos.y);
        });
        const extraRightX =
          (WINDOW_GROUP_X_COPIES_PER_SIDE + 1) * WINDOW_GROUP_X_SPACING -
          WINDOW_GROUP_X_SPACING -
          2.5;
        const groupCloneRightExtra = windowUnitGroup.clone(true);
        groupCloneRightExtra.position.x = extraRightX;
        groupCloneRightExtra.position.z = -1.7;
        groupCloneRightExtra.rotation.y = -Math.PI / 2;
        parent.add(groupCloneRightExtra);
        const rightTrisExtra = [];
        groupCloneRightExtra.traverse((node) => {
          if (node.isMesh && node.name === "windowTris")
            rightTrisExtra.push(node);
          if (node.isMesh && node.name === "windowFrame")
            setMeshDoubleSide(node);
        });
        rightTrisExtra.sort((a, b) => b.position.y - a.position.y);
        rightTrisExtra.forEach((mesh, slot) => {
          windowTrisMeshes.push(mesh);
          windowTrisSlotIndices.push(slot);
          windowTrisBaseYs.push(basePos.y);
        });
        const groupCloneRightExtraZ = groupCloneRightExtra.clone(true);
        groupCloneRightExtraZ.position.z = -1.7 + WINDOW_GROUP_X_SPACING;
        parent.add(groupCloneRightExtraZ);
        const rightTrisExtraZ = [];
        groupCloneRightExtraZ.traverse((node) => {
          if (node.isMesh && node.name === "windowTris")
            rightTrisExtraZ.push(node);
          if (node.isMesh && node.name === "windowFrame")
            setMeshDoubleSide(node);
        });
        rightTrisExtraZ.sort((a, b) => b.position.y - a.position.y);
        rightTrisExtraZ.forEach((mesh, slot) => {
          windowTrisMeshes.push(mesh);
          windowTrisSlotIndices.push(slot);
          windowTrisBaseYs.push(basePos.y);
        });
      }

      const CHARGER_PARTICLE_COUNT = 720;
      /** Keeps additive brightness similar to ~480 particles as count changes. */
      const CHARGER_PARTICLE_STACK_SCALE = 480 / CHARGER_PARTICLE_COUNT;
      const chargerParticleRise = new Float32Array(CHARGER_PARTICLE_COUNT);
      const chargerParticleSpread = new Float32Array(
        CHARGER_PARTICLE_COUNT * 2,
      );
      const chargerParticleRiseSpeed = new Float32Array(CHARGER_PARTICLE_COUNT);
      const chargerParticleMaxHeight = new Float32Array(CHARGER_PARTICLE_COUNT);
      const chargerParticleDriftX = new Float32Array(CHARGER_PARTICLE_COUNT);
      const chargerParticleDriftZ = new Float32Array(CHARGER_PARTICLE_COUNT);
      for (let i = 0; i < CHARGER_PARTICLE_COUNT; i++) {
        chargerParticleRise[i] = Math.random() * 2;
        const r = Math.sqrt(Math.random()) * 0.56;
        const angle = Math.random() * Math.PI * 2;
        chargerParticleSpread[i * 2] = Math.cos(angle) * r;
        chargerParticleSpread[i * 2 + 1] = Math.sin(angle) * r;
        chargerParticleRiseSpeed[i] = 0.55 + Math.random() * 0.9;
        chargerParticleMaxHeight[i] = 0.82 + Math.random() * 0.36;
        const driftAngle = Math.random() * Math.PI * 2;
        const driftMag = 0.22 + Math.random() * 0.38;
        chargerParticleDriftX[i] = Math.cos(driftAngle) * driftMag;
        chargerParticleDriftZ[i] = Math.sin(driftAngle) * driftMag;
      }
      const chargerParticlePositions = new Float32Array(
        CHARGER_PARTICLE_COUNT * 3,
      );
      const chargerParticleColors = new Float32Array(
        CHARGER_PARTICLE_COUNT * 3,
      );
      const chargerParticleSizeScale = new Float32Array(CHARGER_PARTICLE_COUNT);
      for (let i = 0; i < CHARGER_PARTICLE_COUNT; i++) {
        chargerParticleSizeScale[i] = 0.62 + Math.random() * 1.45;
      }
      const CHARGER_SIZE_MIN = 0.62;
      const CHARGER_SIZE_SPAN = 1.45;
      const chargerParticleHeightTail = new Float32Array(CHARGER_PARTICLE_COUNT);
      for (let i = 0; i < CHARGER_PARTICLE_COUNT; i++) {
        const smallness = THREE.MathUtils.clamp(
          1 -
            (chargerParticleSizeScale[i] - CHARGER_SIZE_MIN) / CHARGER_SIZE_SPAN,
          0,
          1,
        );
        const r1 = Math.random(),
          r2 = Math.random(),
          r3 = Math.random();
        const scatter = r1 * r2 * 0.62;
        chargerParticleHeightTail[i] =
          1 +
          smallness * (0.3 + r3 * 1.05 + scatter) +
          (1 - smallness) * (Math.random() * 0.1);
      }
      const chargerEffectColors = [
        new THREE.Color(0x1155ee),
        new THREE.Color(0x2266ff),
        new THREE.Color(0x3388ff),
        new THREE.Color(0x4488ff),
        new THREE.Color(0x4488ee),
        new THREE.Color(0x3388dd),
        new THREE.Color(0x2288cc),
        new THREE.Color(0x3399dd),
        new THREE.Color(0xff2244),
        new THREE.Color(0xff3355),
        new THREE.Color(0xff4466),
        new THREE.Color(0xff5566),
        new THREE.Color(0xff3366),
        new THREE.Color(0x7722ff),
        new THREE.Color(0x8833ee),
        new THREE.Color(0x9944ff),
        new THREE.Color(0xaa55ff),
        new THREE.Color(0xaa55ee),
        new THREE.Color(0x5533cc),
        new THREE.Color(0x9966dd),
      ];
      for (let i = 0; i < CHARGER_PARTICLE_COUNT; i++) {
        const c = chargerEffectColors[i % chargerEffectColors.length].clone();
        const t = 0.76 + Math.random() * 0.22;
        c.multiplyScalar(t);
        chargerParticleColors[i * 3] = c.r;
        chargerParticleColors[i * 3 + 1] = c.g;
        chargerParticleColors[i * 3 + 2] = c.b;
      }
      const chargerParticleGeo = new THREE.BufferGeometry();
      chargerParticleGeo.setAttribute(
        "position",
        new THREE.BufferAttribute(chargerParticlePositions, 3),
      );
      chargerParticleGeo.setAttribute(
        "color",
        new THREE.BufferAttribute(chargerParticleColors, 3),
      );
      chargerParticleGeo.setAttribute(
        "sizeScale",
        new THREE.BufferAttribute(chargerParticleSizeScale, 1),
      );
      const chargerParticleMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uSize: { value: 755 },
          uTime: { value: 0 },
          uFade: { value: 0 },
          uStack: { value: CHARGER_PARTICLE_STACK_SCALE },
        },
        vertexShader: `
        attribute vec3 color;
        attribute float sizeScale;
        varying vec3 vColor;
        varying float vHeight;
        uniform float uSize;
        void main() {
          vColor = color;
          vHeight = position.y;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float att = 1.0 / max(0.1, -mv.z);
          float ps = uSize * att * sizeScale;
          gl_PointSize = min(ps, 102.0);
        }
      `,
        fragmentShader: `
        varying vec3 vColor;
        varying float vHeight;
        uniform float uFade;
        uniform float uStack;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          float core = 1.0 - smoothstep(0.0, 0.76, d);
          core *= core;
          float halo = 1.0 - smoothstep(0.35, 1.12, d);
          halo *= halo * 0.38;
          float a = (core + halo) * 0.4;
          float startFade = smoothstep(0.0, 0.32, vHeight);
          a *= startFade;
          a *= uFade;
          a *= uStack;
          vec3 fireColor = vColor * 0.72;
          float tip = smoothstep(0.0, 3.35, vHeight);
          float bodyGlow = 1.0 - smoothstep(0.15, 2.1, vHeight);
          vec3 purpleCore = vec3(0.03, 0.0, 0.72);
          vec3 redLift = vec3(0.72, 0.0, 0.42);
          fireColor = mix(fireColor, purpleCore, bodyGlow * 0.3);
          fireColor = mix(fireColor, redLift, bodyGlow * 0.08 * (1.0 - tip * 0.55));
          vec3 tipGlow = vec3(0.0, 0.16, 0.92);
          fireColor = mix(fireColor, tipGlow, tip * 0.48);
          float blueEdge = halo * 0.88 + core * 0.12;
          vec3 blueTint = vec3(0.0, 0.18, 0.75);
          fireColor = mix(fireColor, blueTint, blueEdge * 0.34);
          float lum = dot(fireColor, vec3(0.299, 0.587, 0.114));
          fireColor = mix(vec3(lum), fireColor, 1.72);
          fireColor = max(fireColor, vec3(0.0));
          lum = dot(fireColor, vec3(0.299, 0.587, 0.114));
          fireColor = mix(vec3(lum), fireColor, 1.15);
          fireColor = max(fireColor, vec3(0.0));
          fireColor *= vec3(1.0, 0.96, 1.08);
          gl_FragColor = vec4(fireColor, a * 0.68);
        }
      `,
      });
      const chargerParticles = new THREE.Points(
        chargerParticleGeo,
        chargerParticleMat,
      );
      chargerParticles.visible = false;
      chargerParticles.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
      scene.add(chargerParticles);

      const chargerPointLight = new THREE.PointLight(0x6688ff, 0, 18, 1.5);
      scene.add(chargerPointLight);

      const EXHAUST_FLAME_PARTICLE_COUNT = 60;
      const EXHAUST_FLAME_SPREAD = 0.06;
      const EXHAUST_FLAME_SIZE = 320;
      const EXHAUST_FLAME_RISE_SPEED = 2.5;
      const exhaustFlameVertexShader = `
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
      const exhaustFlameFragmentShader = `
      varying vec3 vColor;
      varying float vHeight;
      uniform float uFade;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        c.y *= 0.45;
        float d = length(c) * 1.6;
        float a = 1.0 - smoothstep(0.0, 1.0, d);
        a *= uFade;
        float topFade = 1.0 - smoothstep(0.25, 0.85, vHeight);
        a *= topFade;
        vec3 fireColor = vColor;
        float tip = smoothstep(0.0, 1.1, vHeight);
        fireColor = mix(fireColor, vec3(1.0, 0.95, 0.6), tip * 0.8);
        gl_FragColor = vec4(fireColor, a);
      }
    `;
      const exhaustFlameColors = [
        new THREE.Color(0xff6600),
        new THREE.Color(0xffaa00),
        new THREE.Color(0xff3300),
      ];

      const JUMP_FLAME_PARTICLE_COUNT = 100;
      const JUMP_FLAME_SPREAD = 0.088;
      const JUMP_FLAME_SIZE = 340;
      const JUMP_FLAME_DESK_SIZE_SCALE = 0.78;
      const JUMP_FLAME_ABOVE = 0.48;
      const JUMP_FLAME_RISE_SPEED = 3.2;
      const JUMP_FLAME_RISE_DISTANCE = 10.5;
      const JUMP_FLAME_FADE_BOOST = 1.45;
      const _deskFlamePos = new THREE.Vector3();
      const jumpFlameVertexShader = `
      attribute vec3 color;
      varying vec3 vColor;
      varying float vHeight;
      uniform float uSize;
      void main() {
        vColor = color;
        vHeight = position.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float att = 1.0 / max(0.18, -mv.z);
        gl_PointSize = clamp(uSize * att, 18.0, 112.0);
      }
    `;
      const jumpFlameFragmentShader = `
      varying vec3 vColor;
      varying float vHeight;
      uniform float uFade;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        p.y *= 0.62;
        float r2 = dot(p, p);
        if (r2 > 1.02) discard;
        float r = sqrt(r2);
        float core = exp(-r2 * 6.2);
        float halo = exp(-r2 * 1.65);
        float a = mix(halo * 0.5, core, 0.7);
        float edge = smoothstep(0.88, 1.02, r);
        a = pow(a, 0.9) * uFade * (1.0 - edge);
        float topFade = 1.0 - smoothstep(0.18, 0.9, vHeight);
        a *= topFade;
        vec3 fireColor = vColor;
        float tip = smoothstep(0.0, 1.05, vHeight);
        fireColor = mix(fireColor, vec3(1.0, 0.98, 0.8), tip * 0.9);
        fireColor *= 1.06 + core * 0.14;
        gl_FragColor = vec4(fireColor, a);
      }
    `;
      const jumpFlameColors = [
        new THREE.Color(0xff7700),
        new THREE.Color(0xffcc22),
        new THREE.Color(0xff4400),
      ];
      let flameWaveStartTime = 0;
      let _jumpFlameWaveLoopActive = false;
      const _deskFlameAnchorBox = new THREE.Box3();

      function getDeskFlameAnchorPosition(flameMesh, out) {
        if (_officeWorldRoot) _officeWorldRoot.updateMatrixWorld(true);
        flameMesh.updateWorldMatrix(true, false);
        _deskFlameAnchorBox.setFromObject(flameMesh);
        out.set(
          (_deskFlameAnchorBox.min.x + _deskFlameAnchorBox.max.x) * 0.5,
          _deskFlameAnchorBox.max.y,
          (_deskFlameAnchorBox.min.z + _deskFlameAnchorBox.max.z) * 0.5,
        );
      }

      function hideDeskFlameMarkerMesh(mesh) {
        mesh.visible = false;
        mesh.material = new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: false,
        });
      }

      function tagDeskJumpFlameLayer(effect) {
        effect.points.layers.set(DESK_FLAME_LAYER);
        effect.trailPoints.layers.set(DESK_FLAME_LAYER);
        effect.trailPoints2.layers.set(DESK_FLAME_LAYER);
        effect.trailPoints3.layers.set(DESK_FLAME_LAYER);
      }

      function resetFlameEffectWave(ef) {
        for (let i = 0; i < ef.count; i++) {
          ef.rise[i] = Math.random() * 2;
        }
      }

      function restartFlameWave(nowSec) {
        flameWaveStartTime = nowSec;
        for (let f = 0; f < flameEffects.length; f++) {
          resetFlameEffectWave(flameEffects[f]);
        }
      }

      function startFlameWaveEffect(nowSec, loopUntilLanding = false) {
        flameEffectsVisible = true;
        _deskFlamesWereHidden = false;
        flameWaveStartTime = nowSec;
        _jumpFlameWaveLoopActive = loopUntilLanding;
        for (let f = 0; f < flameEffects.length; f++) {
          resetFlameEffectWave(flameEffects[f]);
        }
      }
      const FLAME_WAVE_DELAY_MS = 200;
      const FLAME_EFFECT_DURATION_MS = 220;

      const EXHAUST_DURATION = 1.5;
      let exhaustEffects = [];
      let exhaustActive = false;
      let exhaustStartTime = 0;
      let _carWasStopped = true;
      const _exhFlickerTimers = [0, 0];
      const _exhFlickerTargets = [1, 1];
      const _exhFlickerValues = [1, 1];
      const _exhFlickerNextChange = [0, 0];

      function createExhaustFireEffect() {
        const count = EXHAUST_FLAME_PARTICLE_COUNT;
        const rise = new Float32Array(count);
        const spread = new Float32Array(count * 2);
        for (let i = 0; i < count; i++) {
          rise[i] = Math.random() * 2;
          const r = Math.sqrt(Math.random()) * EXHAUST_FLAME_SPREAD;
          const angle = Math.random() * Math.PI * 2;
          spread[i * 2] = Math.cos(angle) * r;
          spread[i * 2 + 1] = Math.sin(angle) * r;
        }
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          const c = exhaustFlameColors[i % 3].clone();
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
            uSize: { value: EXHAUST_FLAME_SIZE },
            uTime: { value: 0 },
            uFade: { value: 1 },
          },
          vertexShader: exhaustFlameVertexShader,
          fragmentShader: exhaustFlameFragmentShader,
        });
        const matTrail = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uSize: { value: EXHAUST_FLAME_SIZE * 0.75 },
            uTime: { value: 0 },
            uFade: { value: 0.35 },
          },
          vertexShader: exhaustFlameVertexShader,
          fragmentShader: exhaustFlameFragmentShader,
        });
        const matTrail2 = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uSize: { value: EXHAUST_FLAME_SIZE * 0.55 },
            uTime: { value: 0 },
            uFade: { value: 0.18 },
          },
          vertexShader: exhaustFlameVertexShader,
          fragmentShader: exhaustFlameFragmentShader,
        });
        const matTrail3 = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uSize: { value: EXHAUST_FLAME_SIZE * 0.4 },
            uTime: { value: 0 },
            uFade: { value: 0.12 },
          },
          vertexShader: exhaustFlameVertexShader,
          fragmentShader: exhaustFlameFragmentShader,
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

      function createJumpFireEffect() {
        const count = JUMP_FLAME_PARTICLE_COUNT;
        const rise = new Float32Array(count);
        const spread = new Float32Array(count * 2);
        for (let i = 0; i < count; i++) {
          rise[i] = Math.random() * 2;
          const r = Math.sqrt(Math.random()) * JUMP_FLAME_SPREAD;
          const angle = Math.random() * Math.PI * 2;
          spread[i * 2] = Math.cos(angle) * r;
          spread[i * 2 + 1] = Math.sin(angle) * r;
        }
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          const c = jumpFlameColors[i % 3].clone();
          c.multiplyScalar(1.05 + Math.random() * 0.35);
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
          depthTest: true,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uSize: { value: JUMP_FLAME_SIZE },
            uTime: { value: 0 },
            uFade: { value: 1 },
          },
          vertexShader: jumpFlameVertexShader,
          fragmentShader: jumpFlameFragmentShader,
        });
        const matTrail = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          depthTest: true,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uSize: { value: JUMP_FLAME_SIZE * 0.75 },
            uTime: { value: 0 },
            uFade: { value: 0.48 },
          },
          vertexShader: jumpFlameVertexShader,
          fragmentShader: jumpFlameFragmentShader,
        });
        const matTrail2 = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          depthTest: true,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uSize: { value: JUMP_FLAME_SIZE * 0.55 },
            uTime: { value: 0 },
            uFade: { value: 0.28 },
          },
          vertexShader: jumpFlameVertexShader,
          fragmentShader: jumpFlameFragmentShader,
        });
        const matTrail3 = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          depthTest: true,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uSize: { value: JUMP_FLAME_SIZE * 0.4 },
            uTime: { value: 0 },
            uFade: { value: 0.18 },
          },
          vertexShader: jumpFlameVertexShader,
          fragmentShader: jumpFlameFragmentShader,
        });
        const points = new THREE.Points(geo, mat);
        const trailPoints = new THREE.Points(geo, matTrail);
        const trailPoints2 = new THREE.Points(geo, matTrail2);
        const trailPoints3 = new THREE.Points(geo, matTrail3);
        points.userData.skipBloomDarken = true;
        trailPoints.userData.skipBloomDarken = true;
        trailPoints2.userData.skipBloomDarken = true;
        trailPoints3.userData.skipBloomDarken = true;
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

      function setupFlameEffects(model) {
        flameEffects = [];
        const flameMeshes = [];
        model.traverse((node) => {
          if (node.isMesh && /^flame\d+$/.test(node.name))
            flameMeshes.push(node);
        });
        flameMeshes.sort((a, b) => {
          const numA = parseInt(a.name.replace(/^flame/, ""), 10) || 0;
          const numB = parseInt(b.name.replace(/^flame/, ""), 10) || 0;
          return numA - numB;
        });
        const _pos = new THREE.Vector3();
        model.updateMatrixWorld(true);
        for (let i = 0; i < flameMeshes.length; i++) {
          const flameMesh = flameMeshes[i];
          hideDeskFlameMarkerMesh(flameMesh);
          const effect = createJumpFireEffect();
          effect.flameMesh = flameMesh;
          flameMesh.updateWorldMatrix(true, false);
          _deskFlameAnchorBox.setFromObject(flameMesh);
          effect.flameAnchorHalfHeight =
            (_deskFlameAnchorBox.max.y - _deskFlameAnchorBox.min.y) * 0.5;
          effect.points.visible = false;
          effect.trailPoints.visible = false;
          effect.trailPoints2.visible = false;
          effect.trailPoints3.visible = false;
          tagDeskJumpFlameLayer(effect);
          const deskSize = JUMP_FLAME_SIZE * JUMP_FLAME_DESK_SIZE_SCALE;
          effect.points.material.uniforms.uSize.value = deskSize;
          effect.trailPoints.material.uniforms.uSize.value = deskSize * 0.76;
          effect.trailPoints2.material.uniforms.uSize.value = deskSize * 0.58;
          effect.trailPoints3.material.uniforms.uSize.value = deskSize * 0.44;
          flameEffects.push(effect);
        }
      }

      function setupExhaustEffects(carScene) {
        exhaustEffects = [];
        const names = ["egzozLightLeft", "egzozLightRight"];
        const EXHAUST_SPREAD_SCALE = 0.22;
        for (const name of names) {
          const mesh = carScene.getObjectByName(name);
          if (!mesh || !mesh.parent) continue;
          const effect = createExhaustFireEffect();
          effect.anchorMesh = mesh;
          effect.points.material.uniforms.uSize.value = EXHAUST_FLAME_SIZE * 0.14;
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
          });
        }
        carRoot.traverse((node) => {
          if (!node.isMesh || node.name !== "lightBar1") return;
          tableLightGlows.push({
            mesh: node,
            sprite: createTableLightGlowSprite(0xff2222, 0.24),
            kind: "bar",
            baseSize: 0.24,
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
          getMeshTableReflectionPoint(entry.mesh, tableY, _v0);
          entry.sprite.position.copy(_v0);
          const heightAbove = Math.max(0.12, _reflectionBox.max.y - tableY);
          const sc = entry.baseSize * (0.88 + heightAbove * 0.06);
          entry.sprite.scale.set(sc, sc * 0.72, 1);
          entry.sprite.material.opacity = alpha;
          entry.sprite.visible = true;
        }
      }

      function setupScreenVideo(mesh, video, canvas, videoSrc) {
        if (!mesh) return null;
        video.src = videoSrc;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute("playsinline", "");
        video.play().catch(() => {});
        canvas.width = 2048;
        canvas.height = 2048;
        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.repeat.set(1, 1);
        tex.offset.set(0, 0);
        tex.colorSpace = THREE.SRGBColorSpace;
        mesh.material = new THREE.MeshBasicMaterial({
          map: tex,
          color: 0xd8d8d8,
          side: THREE.DoubleSide,
        });
        return tex;
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

      function setupMacScreenFeed(mesh) {
        if (!mesh || !mesh.isMesh) return;
        macScreenMesh = mesh;
        remapMeshUVsToFullQuad(mesh);
        if (macScreenRenderTarget) macScreenRenderTarget.dispose();
        const macRt = getMacScreenRtDimensions();
        macScreenRenderTarget = new THREE.WebGLRenderTarget(
          macRt.w,
          macRt.h,
          {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: true,
          },
        );
        macScreenRenderTarget.texture.colorSpace = THREE.SRGBColorSpace;
        macScreenRenderTarget.texture.flipY = false;
        macFrontCamera = new THREE.PerspectiveCamera(
          MAC_FRONT_CAM_FOV,
          macRt.w / macRt.h,
          0.08,
          500,
        );
        macFrontCamera.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
        mesh.material = new THREE.MeshBasicMaterial({
          map: macScreenRenderTarget.texture,
          color: 0xffffff,
          side: THREE.DoubleSide,
        });
      }

      function updateMacFrontCamera() {
        if (!macFrontCamera || !car) return;
        car.updateMatrixWorld(true);

        const yaw = carState.angle + carState.driftAngle;
        _macCarFaceDir.set(Math.sin(yaw), 0, Math.cos(yaw));

        _macFrontLookAt.copy(car.position);
        _macFrontLookAt.addScaledVector(_macCarFaceDir, _macFrontNoseOffset);
        _macFrontLookAt.y = car.position.y + _macFrontGrilleHeight;

        macFrontCamera.position.copy(_macFrontLookAt);
        macFrontCamera.position.addScaledVector(_macCarFaceDir, _macFrontCamDist);
        macFrontCamera.position.y = _macFrontLookAt.y + _macCarSize.y * 0.04;
        macFrontCamera.lookAt(_macFrontLookAt);
        macFrontCamera.up.set(0, 1, 0);
      }

      function renderMacFrontCameraFeed() {
        if (!macScreenMesh || !macFrontCamera || !macScreenRenderTarget) return;
        if (perfMacFeedEvery > 1) {
          _perfMacFeedFrame++;
          if (_perfMacFeedFrame % perfMacFeedEvery !== 0) return;
        }
        updateMacFrontCamera();
        const prevTarget = renderer.getRenderTarget();
        const prevAutoClear = renderer.autoClear;
        const prevTm = renderer.toneMapping;
        const prevExp = renderer.toneMappingExposure;
        macScreenMesh.visible = false;
        renderer.setRenderTarget(macScreenRenderTarget);
        renderer.autoClear = true;
        renderer.clear();
        renderer.render(scene, macFrontCamera);
        macScreenMesh.visible = true;
        renderer.setRenderTarget(prevTarget);
        renderer.autoClear = prevAutoClear;
        renderer.toneMapping = prevTm;
        renderer.toneMappingExposure = prevExp;
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

      function applyBookCoverMaterial(mesh, tex) {
        const uvAttr = mesh.geometry.getAttribute("uv");
        if (uvAttr) {
          let uMin = Infinity,
            uMax = -Infinity,
            vMin = Infinity,
            vMax = -Infinity;
          for (let i = 0; i < uvAttr.count; i++) {
            const u = uvAttr.getX(i);
            const v = uvAttr.getY(i);
            if (u < uMin) uMin = u;
            if (u > uMax) uMax = u;
            if (v < vMin) vMin = v;
            if (v > vMax) vMax = v;
          }
          const uRange = Math.max(uMax - uMin, 0.0001);
          const vRange = Math.max(vMax - vMin, 0.0001);
          const newUv = new Float32Array(uvAttr.count * 2);
          for (let i = 0; i < uvAttr.count; i++) {
            newUv[i * 2] = (uvAttr.getX(i) - uMin) / uRange;
            newUv[i * 2 + 1] = (uvAttr.getY(i) - vMin) / vRange;
          }
          mesh.geometry = mesh.geometry.clone();
          mesh.geometry.setAttribute(
            "uv",
            new THREE.BufferAttribute(newUv, 2),
          );
        }
        const coverTex = tex.clone();
        coverTex.center.set(0.5, 0.5);
        coverTex.rotation = -Math.PI / 2;
        coverTex.needsUpdate = true;
        mesh.material = new THREE.MeshBasicMaterial({
          map: coverTex,
          color: 0xffffff,
          side: THREE.DoubleSide,
          depthWrite: true,
          depthTest: true,
        });
        mesh.renderOrder = 6;
        mesh.castShadow = false;
        mesh.visible = true;
      }

      function createBookCoverMeshFromFrame(frame, imageName, tex) {
        frame.geometry.computeBoundingBox();
        const bb = frame.geometry.boundingBox;
        const y = bb.max.y + 0.003;
        const xMin = bb.min.x;
        const xMax = bb.max.x;
        const zMin = bb.min.z;
        const zMax = bb.max.z;
        const positions = new Float32Array([
          xMin, y, zMin,
          xMax, y, zMin,
          xMin, y, zMax,
          xMax, y, zMax,
        ]);
        const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
        geo.setIndex([0, 1, 2, 2, 1, 3]);
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({ color: 0xffffff }),
        );
        mesh.name = imageName;
        frame.add(mesh);
        applyBookCoverMaterial(mesh, tex);
        return mesh;
      }

      function setupBookCoverImages(model) {
        model.traverse((node) => {
          if (!node.isMesh) return;
          if (
            node.name === "bookFrame1" ||
            node.name === "bookFrame2" ||
            node.name === "bookFrame3"
          ) {
            node.castShadow = true;
            node.material = node.material.clone();
            node.material.map = null;
            node.material.color.setHex(0x5d7565);
            if (node.name === "bookFrame2" || node.name === "bookFrame3") {
              node.material.depthWrite = false;
              node.renderOrder = 4;
            }
            node.material.needsUpdate = true;
          }
          if (node.name === "bookFrame2Image" || node.name === "bookFrame3Image") {
            node.geometry = node.geometry.clone();
            node.material = node.material.clone();
          }
        });

        new THREE.TextureLoader().load(
          officeAsset("wixNoteBook.jpg"),
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.flipY = false;
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;

            for (const [frameName, imageName] of [
              ["bookFrame2", "bookFrame2Image"],
              ["bookFrame3", "bookFrame3Image"],
            ]) {
              const frame = model.getObjectByName(frameName);
              if (!frame) continue;
              let imageMesh = model.getObjectByName(imageName);
              if (imageMesh?.isMesh) {
                applyBookCoverMaterial(imageMesh, tex);
              } else {
                createBookCoverMeshFromFrame(frame, imageName, tex);
              }
            }
          },
          undefined,
          (err) => console.warn("wixNoteBook.jpg failed to load:", err),
        );
      }

      function logOfficeMeshParts(gltf) {
        const clipByNode = new Map();
        for (const clip of gltf.animations || []) {
          for (const track of clip.tracks) {
            const nodeName = track.name.split(".")[0];
            if (!clipByNode.has(nodeName)) clipByNode.set(nodeName, new Set());
            clipByNode.get(nodeName).add(clip.name);
          }
        }

        const parts = [];
        gltf.scene.traverse((node) => {
          if (!node.isMesh) return;
          const clips = new Set();
          if (clipByNode.has(node.name)) {
            clipByNode.get(node.name).forEach((c) => clips.add(c));
          }
          let viaSkeleton = false;
          if (node.isSkinnedMesh && node.skeleton?.bones) {
            for (const bone of node.skeleton.bones) {
              if (!clipByNode.has(bone.name)) continue;
              viaSkeleton = true;
              clipByNode.get(bone.name).forEach((c) => clips.add(c));
            }
          }
          parts.push({
            name: node.name || "(unnamed)",
            inAnimations: clips.size > 0,
            viaSkeleton,
            animationClips: [...clips],
          });
        });

        window.officeMeshParts = parts;
        return parts;
      }

      const loader = new GLTFLoader();
      loader.load(
        officeAsset("office-table-embed65.gltf"),
        (gltf) => {
          logOfficeMeshParts(gltf);
          const model = gltf.scene;
          scene.add(model);
          _officeWorldRoot = model;
          _currentWorldModel = model;
          applyPerformanceShadowPolicy(model);
          initOfficeAnimations(gltf);
          findScreenMeshes(model);
          let outdoorBgInMainFile = false;
          model.traverse((node) => {
            if (node.name === "outdoorBackground" && node.isMesh)
              outdoorBgInMainFile = true;
          });
          if (!outdoorBgInMainFile) {
            loader.load(
              OUTDOOR_FALLBACK_GLTF,
              (g2) => {
                let src = null;
                g2.scene.traverse((n) => {
                  if (n.name === "outdoorBackground" && n.isMesh) src = n;
                });
                if (!src) {
                  console.warn(
                    "No outdoorBackground in office-table-embed65.gltf or fallback " +
                      OUTDOOR_FALLBACK_GLTF +
                      ". Re-export embed36 with an object named outdoorBackground.",
                  );
                  return;
                }
                const om = src.clone(true);
                om.name = "outdoorBackground";
                om.scale.y *= OUTDOOR_BACKGROUND_Y_SCALE;
                scene.add(om);
                applyOutdoorPanoramaTexture(om);
                applyTextureAnisotropyToRoot(om);
                scheduleRebuildBloomDarkenLists();
              },
              undefined,
              (err) =>
                console.warn("Outdoor background fallback GLTF failed:", err),
            );
          }
          findTablePlateMesh(model);
          applyTablePlate(model);
          findRampLeft(model);
          findGumsTank(model);
          findGumsStoper(model);
          setupBookCoverImages(model);
          try {
            model.updateMatrixWorld(true);
            if (tablePlateMesh && !tablePlateBody) {
              tablePlateMesh.updateMatrixWorld(true);
              const _tbEarly = new THREE.Box3().setFromObject(tablePlateMesh);
              if (!_tbEarly.isEmpty()) {
                const _tcEarly = _tbEarly.getCenter(new THREE.Vector3());
                const _szEarly = _tbEarly.getSize(new THREE.Vector3());
                const _topEarly = _tbEarly.max.y;
                const plateThickness = 0.5;
                tablePlateBody = new CANNON.Body({
                  type: CANNON.Body.STATIC,
                  position: new CANNON.Vec3(
                    _tcEarly.x,
                    _topEarly - plateThickness / 2,
                    _tcEarly.z,
                  ),
                  material: tablePlatePhysicsMaterial,
                  collisionFilterGroup: 1,
                  collisionFilterMask: -1,
                });
                tablePlateBody.addShape(
                  new CANNON.Box(new CANNON.Vec3(_szEarly.x / 2, plateThickness / 2, _szEarly.z / 2))
                );
                physicsWorld.addBody(tablePlateBody);
                tablePlateHalfX = _szEarly.x / 2;
                tablePlateHalfZ = _szEarly.z / 2;
                tablePlateCenter.set(_tcEarly.x, _topEarly, _tcEarly.z);
              }
            }
            function addRampPhysicsFromGLTF(rampObj) {
              if (!rampObj) return;
              model.updateMatrixWorld(true);
              rampObj.updateMatrixWorld(true);
              rampObj.visible = true;
              const rampVerts = [];
              const rampTriInds = [];
              const _v = new THREE.Vector3();
              rampObj.traverse((child) => {
                if (!child.isMesh || !child.geometry) return;
                child.updateMatrixWorld(true);
                const geo = child.geometry;
                const pos = geo.attributes.position;
                const idx = geo.index;
                const baseVert = rampVerts.length / 3;
                for (let i = 0; i < pos.count; i++) {
                  _v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(
                    child.matrixWorld,
                  );
                  rampVerts.push(_v.x, _v.y, _v.z);
                }
                if (idx) {
                  for (let i = 0; i < idx.count; i += 3) {
                    const a = baseVert + idx.getX(i),
                      b = baseVert + idx.getX(i + 1),
                      c = baseVert + idx.getX(i + 2);
                    rampTriInds.push(a, b, c);
                    rampTriInds.push(c, b, a);
                  }
                } else {
                  for (let i = 0; i < pos.count; i += 3) {
                    const a = baseVert + i,
                      b = baseVert + i + 1,
                      c = baseVert + i + 2;
                    rampTriInds.push(a, b, c);
                    rampTriInds.push(c, b, a);
                  }
                }
              });
              if (rampVerts.length === 0) return;
              const vertCount = rampVerts.length / 3;
              const rcx =
                rampVerts.reduce((s, v, i) => (i % 3 === 0 ? s + v : s), 0) /
                vertCount;
              const rcy =
                rampVerts.reduce((s, v, i) => (i % 3 === 1 ? s + v : s), 0) /
                vertCount;
              const rcz =
                rampVerts.reduce((s, v, i) => (i % 3 === 2 ? s + v : s), 0) /
                vertCount;
              for (let i = 0; i < rampVerts.length; i += 3) {
                rampVerts[i] -= rcx;
                rampVerts[i + 1] -= rcy;
                rampVerts[i + 2] -= rcz;
              }
              const tri = new CANNON.Trimesh(rampVerts, rampTriInds);
              tri.updateTree();
              tri.updateNormals();
              const body = new CANNON.Body({
                type: CANNON.Body.STATIC,
                position: new CANNON.Vec3(rcx, rcy, rcz),
                material: tablePlatePhysicsMaterial,
                collisionFilterGroup: 1,
                collisionFilterMask: -1,
              });
              body.addShape(tri);
              physicsWorld.addBody(body);
              rampLeftBody = body;
              const _q = new THREE.Quaternion();
              rampObj.getWorldQuaternion(_q);
              const entryDir = new THREE.Vector3(1, 0, 0)
                .applyQuaternion(_q)
                .setY(0);
              if (entryDir.lengthSq() > 1e-6) entryDir.normalize();
              else entryDir.set(0, 0, 1);
              rampLeftEntryDir = entryDir.clone();
            }
            addRampPhysicsFromGLTF(rampLeftObject);

            function addGumsTankPhysicsTrimesh(obj, wireColor, physScale) {
              if (!obj) return null;
              const sc = physScale || 1.0;
              model.updateMatrixWorld(true);
              obj.updateMatrixWorld(true);
              const _pv = new THREE.Vector3();
              const verts = [];
              const inds = [];
              let vo = 0;
              obj.traverse((node) => {
                if (!node.isMesh || !node.geometry) return;
                const g = node.geometry;
                const pos = g.attributes.position;
                const idx = g.index;
                const m = node.matrixWorld;
                const n = pos.count;
                for (let i = 0; i < n; i++) {
                  _pv.fromBufferAttribute(pos, i).applyMatrix4(m);
                  verts.push(_pv.x, _pv.y, _pv.z);
                }
                if (idx)
                  for (let i = 0; i < idx.count; i++) inds.push(vo + idx.getX(i));
                else for (let i = 0; i < n; i++) inds.push(vo + i);
                vo += n;
              });
              if (verts.length < 9 || inds.length < 3) return null;
              const nV = verts.length / 3;
              const cx = verts.reduce((s, v, i) => (i % 3 === 0 ? s + v : s), 0) / nV;
              const cy = verts.reduce((s, v, i) => (i % 3 === 1 ? s + v : s), 0) / nV;
              const cz = verts.reduce((s, v, i) => (i % 3 === 2 ? s + v : s), 0) / nV;
              for (let i = 0; i < verts.length; i += 3) {
                verts[i] = (verts[i] - cx) * sc;
                verts[i + 1] = (verts[i + 1] - cy) * sc;
                verts[i + 2] = (verts[i + 2] - cz) * sc;
              }
              const doubleInds = [];
              for (let i = 0; i < inds.length; i += 3) {
                doubleInds.push(inds[i], inds[i + 1], inds[i + 2]);
                doubleInds.push(inds[i + 2], inds[i + 1], inds[i]);
              }
              const tri = new CANNON.Trimesh(verts, doubleInds);
              tri.updateTree();
              tri.updateNormals();
              const body = new CANNON.Body({
                type: CANNON.Body.STATIC,
                position: new CANNON.Vec3(cx, cy, cz),
                material: tankMaterial,
                collisionFilterGroup: PHYS_GROUP_GUMS_TRIMESH,
                collisionFilterMask: PHYS_GROUP_GUM_SPHERE,
              });
              body.addShape(tri);
              physicsWorld.addBody(body);
              _debugGumSet.add(body);

              obj.traverse((node) => {
                if (!node.isMesh) return;
                node.visible = false;
              });
              scheduleRebuildBloomDarkenLists();
              return { body };
            }
            const tankResult = addGumsTankPhysicsTrimesh(gumsTankPhysicObject, 0x00ff88, 1.0);
            if (tankResult) {
              gumsTankPhysBody = tankResult.body;
            }
            const cupResult = addGumsTankPhysicsTrimesh(gumsTankPhysicCupObject, 0x00ff88, 1.0);
            if (cupResult) {
              gumsTankCupBody = cupResult.body;
              gumsTankCupBody.collisionFilterMask = 0;
            }

            if (gumsBodyObject) {
              gumsBodyObject.traverse((node) => {
                if (node.isMesh) node.visible = false;
              });
              model.updateMatrixWorld(true);
              gumsBodyObject.updateMatrixWorld(true);
              const bv = new THREE.Vector3();
              const bVerts = [];
              const bInds = [];
              let bVo = 0;
              gumsBodyObject.traverse((node) => {
                if (!node.isMesh || !node.geometry) return;
                const g = node.geometry;
                const pos = g.attributes.position;
                const idx = g.index;
                const m = node.matrixWorld;
                const n = pos.count;
                for (let i = 0; i < n; i++) {
                  bv.fromBufferAttribute(pos, i).applyMatrix4(m);
                  bVerts.push(bv.x, bv.y, bv.z);
                }
                if (idx)
                  for (let i = 0; i < idx.count; i++) bInds.push(bVo + idx.getX(i));
                else for (let i = 0; i < n; i++) bInds.push(bVo + i);
                bVo += n;
              });
              if (bVerts.length >= 9 && bInds.length >= 3) {
                const nV = bVerts.length / 3;
                const cx = bVerts.reduce((s, v, i) => (i % 3 === 0 ? s + v : s), 0) / nV;
                const cy = bVerts.reduce((s, v, i) => (i % 3 === 1 ? s + v : s), 0) / nV;
                const cz = bVerts.reduce((s, v, i) => (i % 3 === 2 ? s + v : s), 0) / nV;
                for (let i = 0; i < bVerts.length; i += 3) {
                  bVerts[i] -= cx;
                  bVerts[i + 1] -= cy;
                  bVerts[i + 2] -= cz;
                }
                const dblInds = [];
                for (let i = 0; i < bInds.length; i += 3) {
                  dblInds.push(bInds[i], bInds[i + 1], bInds[i + 2]);
                  dblInds.push(bInds[i + 2], bInds[i + 1], bInds[i]);
                }
                const bodyTri = new CANNON.Trimesh(bVerts, dblInds);
                bodyTri.updateTree();
                bodyTri.updateNormals();
                gumsBodyPhysBody = new CANNON.Body({
                  type: CANNON.Body.STATIC,
                  position: new CANNON.Vec3(cx, cy, cz),
                  material: tankMaterial,
                  collisionFilterGroup: PHYS_GROUP_GUMS_BODY,
                  collisionFilterMask: PHYS_GROUP_GUM_SPHERE,
                });
                gumsBodyPhysBody.addShape(bodyTri);
                physicsWorld.addBody(gumsBodyPhysBody);
                _debugGumSet.add(gumsBodyPhysBody);
              }
            }

            if (gumsStandObject) {
              model.updateMatrixWorld(true);
              gumsStandObject.updateMatrixWorld(true);
              const sv = new THREE.Vector3();
              const sVerts = [];
              const sInds = [];
              let sVo = 0;
              gumsStandObject.traverse((node) => {
                if (!node.isMesh || !node.geometry) return;
                const g = node.geometry;
                const pos = g.attributes.position;
                const idx = g.index;
                const m = node.matrixWorld;
                const n = pos.count;
                for (let i = 0; i < n; i++) {
                  sv.fromBufferAttribute(pos, i).applyMatrix4(m);
                  sVerts.push(sv.x, sv.y, sv.z);
                }
                if (idx)
                  for (let i = 0; i < idx.count; i++) sInds.push(sVo + idx.getX(i));
                else for (let i = 0; i < n; i++) sInds.push(sVo + i);
                sVo += n;
              });
              if (sVerts.length >= 9 && sInds.length >= 3) {
                const nV = sVerts.length / 3;
                const cx = sVerts.reduce((s, v, i) => (i % 3 === 0 ? s + v : s), 0) / nV;
                const cy = sVerts.reduce((s, v, i) => (i % 3 === 1 ? s + v : s), 0) / nV;
                const cz = sVerts.reduce((s, v, i) => (i % 3 === 2 ? s + v : s), 0) / nV;
                const standPhysScale = 1.1;
                for (let i = 0; i < sVerts.length; i += 3) {
                  sVerts[i] = (sVerts[i] - cx) * standPhysScale;
                  sVerts[i + 1] = (sVerts[i + 1] - cy) * standPhysScale;
                  sVerts[i + 2] = (sVerts[i + 2] - cz) * standPhysScale;
                }
                const sDblInds = [];
                for (let i = 0; i < sInds.length; i += 3) {
                  sDblInds.push(sInds[i], sInds[i + 1], sInds[i + 2]);
                  sDblInds.push(sInds[i + 2], sInds[i + 1], sInds[i]);
                }
                const standTri = new CANNON.Trimesh(sVerts, sDblInds);
                standTri.updateTree();
                standTri.updateNormals();
                gumsStandPhysBody = new CANNON.Body({
                  type: CANNON.Body.STATIC,
                  position: new CANNON.Vec3(cx, cy, cz),
                  material: tankMaterial,
                  collisionFilterGroup: PHYS_GROUP_GUMS_STAND,
                  collisionFilterMask: PHYS_GROUP_GUM_SPHERE,
                });
                gumsStandPhysBody.addShape(standTri);
                physicsWorld.addBody(gumsStandPhysBody);
                _debugGumSet.add(gumsStandPhysBody);
              }
            }

            if (gumsRampObject) {
              model.updateMatrixWorld(true);
              gumsRampObject.updateMatrixWorld(true);
              const rv = new THREE.Vector3();
              const rVerts = [];
              const rInds = [];
              let rVo = 0;
              gumsRampObject.traverse((node) => {
                if (!node.isMesh || !node.geometry) return;
                const g = node.geometry;
                const pos = g.attributes.position;
                const idx = g.index;
                const m = node.matrixWorld;
                const n = pos.count;
                for (let i = 0; i < n; i++) {
                  rv.fromBufferAttribute(pos, i).applyMatrix4(m);
                  rVerts.push(rv.x, rv.y, rv.z);
                }
                if (idx)
                  for (let i = 0; i < idx.count; i++) rInds.push(rVo + idx.getX(i));
                else for (let i = 0; i < n; i++) rInds.push(rVo + i);
                rVo += n;
              });
              if (rVerts.length >= 9 && rInds.length >= 3) {
                const nV = rVerts.length / 3;
                const cx = rVerts.reduce((s, v, i) => (i % 3 === 0 ? s + v : s), 0) / nV;
                const cy = rVerts.reduce((s, v, i) => (i % 3 === 1 ? s + v : s), 0) / nV;
                const cz = rVerts.reduce((s, v, i) => (i % 3 === 2 ? s + v : s), 0) / nV;
                for (let i = 0; i < rVerts.length; i += 3) {
                  rVerts[i] -= cx;
                  rVerts[i + 1] -= cy;
                  rVerts[i + 2] -= cz;
                }
                const rDblInds = [];
                for (let i = 0; i < rInds.length; i += 3) {
                  rDblInds.push(rInds[i], rInds[i + 1], rInds[i + 2]);
                  rDblInds.push(rInds[i + 2], rInds[i + 1], rInds[i]);
                }
                const rampTri = new CANNON.Trimesh(rVerts, rDblInds);
                rampTri.updateTree();
                rampTri.updateNormals();
                gumsRampPhysBody = new CANNON.Body({
                  type: CANNON.Body.STATIC,
                  position: new CANNON.Vec3(cx, cy, cz),
                  material: tankMaterial,
                  collisionFilterGroup: PHYS_GROUP_GUMS_RAMP,
                  collisionFilterMask: PHYS_GROUP_GUM_SPHERE,
                });
                gumsRampPhysBody.addShape(rampTri);
                physicsWorld.addBody(gumsRampPhysBody);
                _debugGumSet.add(gumsRampPhysBody);
              }
            }

            if (gumsTankPhysicObject) {
              model.updateMatrixWorld(true);
              gumsTankPhysicObject.updateMatrixWorld(true);
              const _gv = new THREE.Vector3();
              const _lb = new THREE.Box3();
              _lb.makeEmpty();
              const _invPhys = new THREE.Matrix4()
                .copy(gumsTankPhysicObject.matrixWorld)
                .invert();
              gumsTankPhysicObject.traverse((node) => {
                if (!node.isMesh || !node.geometry) return;
                const geo = node.geometry;
                geo.computeBoundingBox();
                const bb = geo.boundingBox;
                if (!bb || bb.isEmpty()) return;
                for (let b = 0; b < 8; b++) {
                  _gv.set(
                    b & 1 ? bb.max.x : bb.min.x,
                    b & 2 ? bb.max.y : bb.min.y,
                    b & 4 ? bb.max.z : bb.min.z,
                  );
                  _gv.applyMatrix4(node.matrixWorld).applyMatrix4(_invPhys);
                  _lb.expandByPoint(_gv);
                }
              });

              if (!_lb.isEmpty()) {
                /** Inset from physic hull AABB (same collider as Cannon trimesh). */
                const padXZ = 0.022;
                const padBottom = 0.012;
                const padTopOpen = 0.085;
                const lx0 = _lb.min.x + padXZ;
                const lx1 = _lb.max.x - padXZ;
                const lz0 = _lb.min.z + padXZ;
                const lz1 = _lb.max.z - padXZ;
                const tankH = _lb.max.y - _lb.min.y;
                /** Physic mesh floor is the collider floor — do not extend below AABB like the glass mesh. */
                let lyBottom = _lb.min.y + padBottom;
                const lyTop = _lb.max.y - padTopOpen;

                if (
                  lx1 - lx0 > 0.04 &&
                  lyTop - lyBottom > 0.04 &&
                  lz1 - lz0 > 0.04
                ) {
                  const innerMinDim = Math.min(
                    lx1 - lx0,
                    lyTop - lyBottom,
                    lz1 - lz0,
                  );
                  const tWall = THREE.MathUtils.clamp(
                    innerMinDim * 0.145,
                    0.068,
                    0.19,
                  );
                  const cornerPad = tWall * 0.48;

                  gumsTankPhysicObject.updateMatrixWorld(true);
                  const invPhysWM = new THREE.Matrix4()
                    .copy(gumsTankPhysicObject.matrixWorld)
                    .invert();
                  if (gumsStoperObject) {
                    gumsStoperObject.updateMatrixWorld(true);
                    const stB = new THREE.Box3().setFromObject(
                      gumsStoperObject,
                    );
                    const stMid = stB.getCenter(new THREE.Vector3());
                    _gv.set(stMid.x, stB.max.y, stMid.z);
                    _gv.applyMatrix4(invPhysWM);
                    const stTopLocalY = _gv.y;
                    const minInnerFloorTop = stTopLocalY + 0.05;
                    if (lyBottom + tWall < minInnerFloorTop) {
                      lyBottom = minInnerFloorTop - tWall;
                    }
                    const stSize = stB.getSize(new THREE.Vector3());
                    const tankW = lx1 - lx0;
                    const tankD = lz1 - lz0;
                    const sx = Math.max(tankW * 0.5, stSize.x * 0.5, 0.05);
                    const sy = Math.max(stSize.y * 0.5, 0.03);
                    const sz = Math.max(tankD * 0.5, stSize.z * 0.5, 0.05);
                    gumsStoperBody = new CANNON.Body({
                      type: CANNON.Body.STATIC,
                      position: new CANNON.Vec3(stMid.x, stMid.y, stMid.z),
                      material: stoperMaterial,
                      collisionFilterGroup: PHYS_GROUP_GUMS_STOPPER,
                      collisionFilterMask: PHYS_GROUP_GUM_SPHERE,
                    });
                    gumsStoperBody.addShape(new CANNON.Box(new CANNON.Vec3(sx, sy, sz)));
                    physicsWorld.addBody(gumsStoperBody);
                  }
                  const maxLyBottom = lyTop - tWall - 0.04;
                  if (lyBottom > maxLyBottom) lyBottom = maxLyBottom;

                  const gtw = new THREE.Vector3();
                  const gtq = new THREE.Quaternion();
                  const gte = new THREE.Vector3();
                  gumsTankPhysicObject.matrixWorld.decompose(gtw, gtq, gte);

                  const mw = gumsTankPhysicObject.matrixWorld;
                  const wSpawn = new THREE.Box3();
                  wSpawn.makeEmpty();
                  for (let b = 0; b < 8; b++) {
                    _gv.set(
                      b & 1 ? lx1 : lx0,
                      b & 2 ? lyTop : lyBottom,
                      b & 4 ? lz1 : lz0,
                    );
                    _gv.applyMatrix4(mw);
                    wSpawn.expandByPoint(_gv);
                  }

                  const spawnPad = 0.02;
                  const gwMinX = wSpawn.min.x + spawnPad;
                  const gwMaxX = wSpawn.max.x - spawnPad;
                  const gwMinZ = wSpawn.min.z + spawnPad;
                  const gwMaxZ = wSpawn.max.z - spawnPad;
                  const gwMinY = wSpawn.min.y + spawnPad;
                  const gwMaxY = wSpawn.max.y - spawnPad;
                  const gW = gwMaxX - gwMinX;
                  const gD = gwMaxZ - gwMinZ;
                  const gH = gwMaxY - gwMinY;
                  if (gW > 0.02 && gD > 0.02 && gH > 0.02) {
                    const gumRad = THREE.MathUtils.clamp(
                      Math.min(gW, gD, gH) * 0.1,
                      0.014,
                      0.14,
                    );
                    const gumRadPhys = gumRad * GUM_PHYS_RADIUS_SCALE;
                    gumRadiusGlobal = gumRadPhys;
                    const cin = tWall + gumRadiusGlobal * 1.1;
                    /** Floor only needs sphere radius above inner bottom — do not add tWall (wall thickness is horizontal). */
                    const minYClamp =
                      lyBottom + gumRadiusGlobal * 1.05;
                    let topAllow = Math.min(
                      _lb.max.y - Math.max(0.012, gumRadiusGlobal * 0.42),
                      lyTop - gumRadiusGlobal * 0.12,
                    );
                    const minTopForClamp =
                      minYClamp + gumRadiusGlobal * 0.12;
                    if (topAllow < minTopForClamp) topAllow = minTopForClamp;
                    _gumTankClampLocal =
                      lx0 + cin < lx1 - cin &&
                      minYClamp < topAllow &&
                      lz0 + cin < lz1 - cin
                        ? {
                            minX: lx0 + cin,
                            maxX: lx1 - cin,
                            minY: minYClamp,
                            maxY: topAllow,
                            minZ: lz0 + cin,
                            maxZ: lz1 - cin,
                          }
                        : null;
                    gumsDropCenterX = (wSpawn.min.x + wSpawn.max.x) * 0.5;
                    gumsDropCenterZ = (wSpawn.min.z + wSpawn.max.z) * 0.5;
                    gumsDropTopY = wSpawn.max.y + gH * 0.6;
                    const ix0 = lx0 + cin;
                    const ix1 = lx1 - cin;
                    const iz0 = lz0 + cin;
                    const iz1 = lz1 - cin;
                    const yColRef = (minYClamp + topAllow) * 0.5;
                    gumsTankPhysicObject.updateMatrixWorld(true);
                    const colMw = gumsTankPhysicObject.matrixWorld;
                    const xMid = (ix0 + ix1) * 0.5;
                    const zMid = (iz0 + iz1) * 0.5;
                    gumsDropColumnXZ = [];
                    const colSpread = gumRadiusGlobal * 1.5;
                    const colPositions = [
                      { lx: xMid - colSpread, lz: zMid },
                      { lx: xMid + colSpread, lz: zMid },
                    ];
                    for (const cp of colPositions) {
                      _gumClampTmp.set(cp.lx, yColRef, cp.lz);
                      _gumClampTmp.applyMatrix4(colMw);
                      gumsDropColumnXZ.push({
                        x: _gumClampTmp.x,
                        z: _gumClampTmp.z,
                      });
                    }
                    const toSpawn = GUM_COUNT;
                    const gumGeo = new THREE.SphereGeometry(gumRad, 16, 12);
                    gumGeo.computeVertexNormals();
                    const gumLambert = new THREE.MeshStandardMaterial({
                      color: 0xffffff,
                      roughness: 0.35,
                      metalness: 0.05,
                    });
                    gumInstancedMesh = new THREE.InstancedMesh(
                      gumGeo,
                      gumLambert,
                      toSpawn,
                    );
                    gumInstancedMesh.castShadow = false;
                    gumInstancedMesh.receiveShadow = false;
                    gumInstancedMesh.frustumCulled = false;
                    gumInstancedMesh.instanceMatrix.setUsage(
                      THREE.DynamicDrawUsage,
                    );
                    const _gumColTmp = new THREE.Color();
                    for (let gi = 0; gi < toSpawn; gi++) {
                      _gumColTmp.setHex(gumColors[gi % gumColors.length]);
                      gumInstancedMesh.setColorAt(gi, _gumColTmp);
                      const body = new CANNON.Body({
                        mass: 0.5,
                        shape: new CANNON.Sphere(gumRadPhys),
                        material: gumMaterial,
                        position: new CANNON.Vec3(0, -100, 0),
                        linearDamping: 0.92,
                        angularDamping: 0.85,
                        collisionFilterGroup: PHYS_GROUP_GUM_SPHERE,
                        collisionFilterMask: PHYS_MASK_GUM_SPHERE,
                        allowSleep: true,
                      });
                      body.sleepSpeedLimit = 0.5;
                      body.sleepTimeLimit = 0.2;
                      bindGumCarCollide(body);
                      gumBodies.push(body);
                    }
                    gumInstancedMesh.instanceColor.setUsage(
                      THREE.DynamicDrawUsage,
                    );
                    gumInstancedMesh.instanceColor.needsUpdate = true;
                    scene.add(gumInstancedMesh);
                    scheduleRebuildBloomDarkenLists();
                    syncGumInstancedTransforms();
                    if (gumBodies.length > 0) {
                      for (let w = 0; w < 10; w++) physicsWorld.step(1 / 120);
                      gumsAddedCount = 0;
                      gumsTankSettleAccum = 0;
                      gumsPostFillElapsed = 0;
                      gumsReadyToDrop = true;
                      nextGumDropTime = performance.now() + 180;
                    }
                  }
                }
              } else {
                console.warn("gumsTankPhysic: empty bounds for gum volume");
              }
            }

          } catch (e) {
            console.warn("Physics setup failed:", e);
          }

          applyTableSideWall(model);
          applyRoomRoofPlaneMaterial(model);
          applyRoomLightMaterial(model);
          applyPlantVaseAndBaseMaterials(model);
          model.traverse((node) => {
            if (!node.isMesh) return;
            if (node.name === "musa" || node.name === "musa.001") {
              const origMat = node.material;
              const newMat = new THREE.MeshStandardMaterial();
              if (origMat) {
                newMat.map = origMat.map;
                newMat.normalMap = origMat.normalMap;
                newMat.alphaMap = origMat.alphaMap;
                newMat.transparent = origMat.transparent;
                newMat.alphaTest = origMat.alphaTest || 0.5;
                newMat.side = origMat.side || THREE.DoubleSide;
              }
              newMat.color.set(0xffffff);
              newMat.emissive.set(0x2a2a1a);
              newMat.emissiveIntensity = 0.6;
              newMat.roughness = 0.8;
              newMat.metalness = 0.0;
              newMat.envMapIntensity = 1.5;
              newMat.needsUpdate = true;
              node.material = newMat;
            }
          });
          applyPhoneChargerMaterial(model);
          applyPhoneChargerCupMaterial(model);
          applyPhoneChargerLightMaterial(model);
          applyScreenLightsMaterial(model);
          applyPenMaterials(model);
          applyDuckMaterials(model);
          setupEyeTracking(model);
          applyGumsTankMaterial(model);
          applyGumsPlasticMaterials(model);
          applyCertifiedMaterials(model);

          try {
            setupBottlePhysics(model);
          } catch (e) {
            console.warn("Bottle physics setup failed:", e);
          }
          try {
            setupFloorPhysics(model);
          } catch (e) {
            console.warn("Floor physics setup failed:", e);
          }
          try {
            setupTableSideWallPhysics(model);
          } catch (e) {
            console.warn("tableSideWall physics setup failed:", e);
          }
          try {
            setupHandPhysics(model);
          } catch (e) {
            console.warn("handPhisics setup failed:", e);
          }
          try {
            setupCertifiedPhysics(model);
          } catch (e) {
            console.warn("Certified physics setup failed:", e);
          }
          try {
            setupGumDispenserPhysics(model);
          } catch (e) {
            console.warn("GumDispenser physics setup failed:", e);
          }
          setupAllPropPhysics(model);
          if (_propMeshes["mainScreensPin"]) _propMeshes["mainScreensPin"].visible = true;
          if (_propMeshes["mainScreensBase"]) _propMeshes["mainScreensBase"].visible = true;
          try {
            setupConusPhysics(model);
          } catch (e) {
            console.warn("Conus physics setup failed:", e);
          }
          try {
            setupDrawerGroup(model);
          } catch (e) {
            console.warn("Drawer group setup failed:", e);
          }

          const _hideNames = [
            "certifiedBodyPhysic", "GumDispenserAllPhysic", "bottlePhisic",
            "dockingStationPhysic", "plantVasePhysic", "macScreenFramePhysic",
            "macBodyBasePhysic", "conusPhysic",
          ];
          [model, scene].forEach((root) => {
            root.traverse((node) => {
              if (_hideNames.includes(node.name)) {
                node.visible = false;
                node.traverse((child) => { child.visible = false; });
              }
            });
          });
          model.traverse((node) => {
            if (!node.isMesh) return;
            if (node.name === "cabblesTunnel") {
              node.material = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                roughness: 0.5,
                metalness: 0.08,
                side: THREE.DoubleSide,
              });
            }
            if (node.name === "cabblesTunnelInner" || node.name === "cabblesTunnelInnerFaces") {
              node.material = new THREE.MeshStandardMaterial({
                color: 0x555555,
                roughness: 0.9,
                metalness: 0,
              });
            }
            if (node.name === "displayCable1" || node.name === "displayCable2" ||
                node.name === "displayCableUsb" ||
                node.name === "displayPowerCable1" || node.name === "displayPowerCable2") {
              node.material = new THREE.MeshStandardMaterial({
                color: 0x1a1a1a,
                roughness: 0.85,
                metalness: 0,
              });
            }
          });
          setupReflectionPlane(model);

          duplicateWindowTris(model);
          duplicateRoomRoofPlane(model);
          duplicateRoomLight(model);
          setupFlameEffects(model);

          // Position car on reflection plane (or tablePlate if no reflection plane)
          // Prefer mesh world position when origin is set to geometry in Blender
          let tableBox = new THREE.Box3().setFromObject(model);
          if (tablePlateMesh) {
            tablePlateMesh.updateMatrixWorld(true);
            tableBox = new THREE.Box3().setFromObject(tablePlateMesh);
          }
          let tableCenter = new THREE.Vector3();
          let tableTopY = 0;
          let tableMinSize = 0.1;
          if (tablePlateMesh) {
            tablePlateMesh.getWorldPosition(tableCenter);
            tableTopY = tableCenter.y;
            if (!tableBox.isEmpty()) {
              const size = tableBox.getSize(new THREE.Vector3());
              tableMinSize = Math.min(size.x, size.z);
            }
          }
          if (reflectionPlaneWorldPosition) {
            tableCenter.copy(reflectionPlaneWorldPosition);
            tableTopY =
              reflectionPlaneSurfaceY != null
                ? reflectionPlaneSurfaceY
                : reflectionPlaneWorldPosition.y;
            if (tableMinSize === 0.1 && !tableBox.isEmpty()) {
              const size = tableBox.getSize(new THREE.Vector3());
              tableMinSize = Math.min(size.x, size.z);
            }
          }
          if (
            !tablePlateMesh &&
            !reflectionPlaneWorldPosition &&
            !tableBox.isEmpty()
          ) {
            tableCenter = tableBox.getCenter(new THREE.Vector3());
            tableTopY = tableBox.max.y;
            const size = tableBox.getSize(new THREE.Vector3());
            tableMinSize = Math.min(size.x, size.z);
          }
          if (
            reflectionPlaneWorldPosition ||
            tablePlateMesh ||
            !tableBox.isEmpty()
          ) {
            tableSurfaceY = tableTopY;
            const carScale =
              Math.max(0.05, Math.min(1, (tableMinSize * 0.2) / 2)) *
              CAR_SCALE_MULTIPLIER;
            const size = tableBox.isEmpty()
              ? new THREE.Vector3(tableMinSize * 2, 0.01, tableMinSize * 2)
              : tableBox.getSize(new THREE.Vector3());
            if (!tablePlateBody && (tablePlateMesh || reflectionPlaneMesh)) {
              const plateThickness = 0.5;
              tablePlateBody = new CANNON.Body({
                type: CANNON.Body.STATIC,
                position: new CANNON.Vec3(
                  tableCenter.x,
                  tableTopY - plateThickness / 2,
                  tableCenter.z,
                ),
                material: tablePlatePhysicsMaterial,
                collisionFilterGroup: 1,
                collisionFilterMask: -1,
              });
              tablePlateBody.addShape(
                new CANNON.Box(new CANNON.Vec3(size.x / 2, plateThickness / 2, size.z / 2))
              );
              physicsWorld.addBody(tablePlateBody);
              tablePlateHalfX = size.x / 2;
              tablePlateHalfZ = size.z / 2;
              tablePlateCenter.set(tableCenter.x, tableTopY, tableCenter.z);
            }
            if (tablePlateMesh) tablePlateMesh.receiveShadow = false;
            if (!carShadowPlane) {
              const shadowPlaneGeo = new THREE.PlaneGeometry(
                size.x * 1.5,
                size.z * 1.5,
              );
              const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.35 });
              carShadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
              carShadowPlane.rotation.x = -Math.PI / 2;
              const _shadowCenter = new THREE.Vector3(
                tableCenter.x,
                tableTopY,
                tableCenter.z,
              );
              if (getTablePlateShadowPose(_shadowCenter)) {
                carShadowPlane.position.set(
                  _shadowCenter.x,
                  _shadowCenter.y + 0.05,
                  _shadowCenter.z,
                );
              } else {
                carShadowPlane.position.set(
                  tableCenter.x,
                  tableTopY + 0.05,
                  tableCenter.z,
                );
              }
              carShadowPlane.receiveShadow = true;
              carShadowPlane.renderOrder = 2;
              scene.add(carShadowPlane);
            }
            if (tablePlateBody && reflectionPlaneSurfaceY == null)
              tableSurfaceY = tablePlateBody.position.y + 0.25;
            else if (reflectionPlaneSurfaceY != null)
              tableSurfaceY = reflectionPlaneSurfaceY;
            else if (reflectionPlaneWorldPosition)
              tableSurfaceY = reflectionPlaneWorldPosition.y;
            if (tablePlateBody && (tablePlateBody.position.y + 0.25) !== tableSurfaceY) {
              tablePlateBody.position.y = tableSurfaceY - 0.25;
            }
            showTablePlateWireframe();
            const carGltfPath = "./car-game12.gltf";
            loader.setResourcePath(`${import.meta.env.BASE_URL}office-scene-optimized/`);
            loader.load(
              officeAsset(carGltfPath),
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
                      node.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
                    }
                    if (node.name === "lightBar1") {
                      node.material = new THREE.MeshStandardMaterial({
                        color: 0xff0000,
                        emissive: 0xff0000,
                        emissiveIntensity: 18.0,
                        metalness: 0,
                        roughness: 0.15,
                      });
                      node.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
                    }
                    if (node.name === "frontLights") {
                      node.material = new THREE.MeshStandardMaterial({
                        color: 0xffffff,
                        emissive: 0xffffff,
                        emissiveIntensity: 6.5,
                        metalness: 0,
                        roughness: 0.3,
                      });
                      node.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
                    }
                    if (node.name === "rearLights") {
                      node.material = new THREE.MeshStandardMaterial({
                        color: 0xff0000,
                        emissive: 0xff0000,
                        emissiveIntensity: 2.0,
                        metalness: 0,
                        roughness: 0.3,
                      });
                      node.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
                    }
                    if (node.name === "frontLightCase" || node.name === "rearLightCase") {
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
                  const _origLightPos = _lbLight.position.clone().sub(_lbCenter);
                  _lbParent.remove(_lbBody);
                  _lbParent.remove(_lbLight);
                  _lbBody.position.copy(_origBodyPos);
                  _lbLight.position.copy(_origLightPos);
                  _lbGroup.add(_lbBody);
                  _lbGroup.add(_lbLight);

                  const _lbSize = _lbBox.getSize(new THREE.Vector3());
                  const _lbSpacing = _lbSize.x > _lbSize.z ? _lbSize.x : _lbSize.z;
                  for (let side = -1; side <= 1; side += 2) {
                    for (let i = 1; i <= 2; i++) {
                      const clone = _lbGroup.clone(true);
                      clone.name = "lightBarGroup_" + side + "_" + i;
                      clone.position.copy(_lbGroup.position);
                      clone.position.x += side * i * _lbSpacing * 1.6;
                      clone.traverse((n) => {
                        if (n.isMesh && n.name === "lightBar1") {
                          n.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
                        }
                      });
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

                _quatAirInDrive.setFromAxisAngle(_axisAirInDrive, -Math.PI / 2);
                airInParts = ["airIn1", "airIn2", "airIn3"]
                  .map((name) => car.getObjectByName(name))
                  .filter(Boolean);
                for (const part of airInParts) {
                  part.baseQuat = part.quaternion.clone();
                  part.openQuat = part.baseQuat.clone().multiply(_quatAirInDrive);
                  const stagger = AIR_IN_STAGGER[part.name] || { open: 0, close: 0 };
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
                const onMac = getMacCarStartPose(model, _macSpawnWorld);
                if (onMac) {
                  spawnX = _macSpawnWorld.x;
                  spawnZ = _macSpawnWorld.z;
                  spawnSurfaceY = _macSpawnWorld.y;
                }

                car.position.set(spawnX, spawnSurfaceY, spawnZ);
                if (onMac) {
                  carState.angle = _macCarStartYaw;
                  carState.driftAngle = 0;
                  _quatY.setFromAxisAngle(_flatUp, _macCarStartYaw);
                  car.quaternion.copy(_quatY);
                } else {
                  car.quaternion.identity();
                }
                car.updateMatrixWorld(true);
                const _carBox = new THREE.Box3().setFromObject(car);
                carBottomOffsetY = Math.max(0, spawnSurfaceY - _carBox.min.y);
                carWheelBottomOffsetY = carBottomOffsetY;
                tableMinY = tableTopY + Math.max(0.05, carBottomOffsetY * 0.5);
                tableSpawn.set(
                  spawnX,
                  spawnSurfaceY + carBottomOffsetY,
                  spawnZ,
                );
                car.position.copy(tableSpawn);
                storedCarScale = carScale;

                car.updateMatrixWorld(true);
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

                canonBodyMesh = car.getObjectByName("canon-body") || null;
                if (canonBodyMesh) {
                  canonBodyMesh.visible = false;
                  car.updateMatrixWorld(true);
                  const cbBox = new THREE.Box3().setFromObject(canonBodyMesh);
                  const cbSize = cbBox.getSize(new THREE.Vector3());
                  const cbCenter = cbBox.getCenter(new THREE.Vector3());
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
                const minWheelFloorY = onMac ? spawnSurfaceY : tableSurfaceY;
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
                const carBox = new THREE.Box3().setFromObject(car);
                const carSize = carBox.getSize(new THREE.Vector3());
                _macCarSize.copy(carSize);
                _macFrontCamDist = carSize.x * MAC_FRONT_CAM_DIST_FACTOR;
                _macFrontNoseOffset = halfL * storedCarScale * 0.92;
                _macFrontGrilleHeight = carSize.y * 0.28;
                const _hl =
                  car.getObjectByName("frontLightCase") ||
                  car.getObjectByName("frontLights");
                if (_hl) {
                  _hl.getWorldPosition(_macHeadlight);
                  _macFrontGrilleHeight = _macHeadlight.y - car.position.y;
                  if (wheelFL && wheelFR) {
                    wheelFL.getWorldPosition(_macWheelL);
                    wheelFR.getWorldPosition(_macWheelR);
                    _macWheelL.add(_macWheelR).multiplyScalar(0.5);
                    _macFrontNoseOffset = Math.max(
                      halfL * storedCarScale * 0.75,
                      _macHeadlight.distanceTo(_macWheelL),
                    );
                  }
                }
                scheduleRebuildBloomDarkenLists();
                applyPerformanceShadowPolicy(car);

                const _sceneBox = new THREE.Box3().setFromObject(model);
                const _sceneSize = _sceneBox.getSize(new THREE.Vector3());
                const _sceneMaxDim = Math.max(_sceneSize.x, _sceneSize.y, _sceneSize.z);
                getCarCameraLookAtPoint(_macSpawnWorld);
                placeCarViewCameras(_macSpawnWorld, _sceneMaxDim);
                syncCarCameraYawTracking();
                if (camera === carCamera) {
                  getCarCameraLookAtPoint(_carMatrixLookAt);
                  controls.target.copy(_carMatrixLookAt);
                  syncCarOrbitCamAnglesFromPosition(carCamera);
                  configureOrbitControlsForCarView(carCamera);
                } else if (camera === carCameraFollow) {
                  controls.target.copy(_macSpawnWorld);
                  syncCarFollowCamAnglesFromPosition(carCameraFollow);
                  configureOrbitControlsForCarView(carCameraFollow);
                }
              },
              undefined,
              (err) => {
                console.error("Car GLTF load failed.", err);
              },
            );
          }

          if (leftScreenMesh) {
            leftScreenVideo = document.createElement("video");
            leftScreenCanvas = document.createElement("canvas");
            leftScreenVideoTexture = setupScreenVideo(
              leftScreenMesh,
              leftScreenVideo,
              leftScreenCanvas,
              officeAsset("./Wix_Harmony_The_new_way_to_create_1080P.mp4"),
            );
          }
          if (rightScreenMesh) {
            rightScreenVideo = document.createElement("video");
            rightScreenCanvas = document.createElement("canvas");
            rightScreenVideoTexture = setupScreenVideo(
              rightScreenMesh,
              rightScreenVideo,
              rightScreenCanvas,
              rightScreenVideoSrc,
            );
          }

          const box = new THREE.Box3().setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const lookAt = car.position.clone();
          placeCarViewCameras(lookAt, maxDim);
          const testCamDistXZ = 2.6 * Math.SQRT2;
          const testCamY = 1.8;
          const testCamAngleLeft = Math.PI / 4 + 0.7;
          const testCamX = testCamDistXZ * Math.cos(testCamAngleLeft);
          const testCamZ = testCamDistXZ * Math.sin(testCamAngleLeft);
          testCamera.position.set(
            center.x + testCamX,
            center.y + testCamY,
            center.z + testCamZ,
          );
          testCamera.lookAt(center);
          if (camera === carCamera || camera === carCameraFollow) {
            controls.target.copy(lookAt);
            if (camera === carCamera) {
              syncCarOrbitCamAnglesFromPosition(carCamera);
              configureOrbitControlsForCarView(carCamera);
            }
            syncCarCameraYawTracking();
          } else controls.target.copy(center);
          applyTextureAnisotropyToRoot(model);
          scheduleRebuildBloomDarkenLists();
        },
        undefined,
        (err) => {
          console.error("[office] office-table-embed65.gltf failed to load:", err);
        },
      );

      function tryPlayScreenVideos() {
        if (leftScreenVideo && leftScreenVideo.paused)
          leftScreenVideo.play().catch(() => {});
        if (rightScreenVideo && rightScreenVideo.paused)
          rightScreenVideo.play().catch(() => {});
      }
      renderer.domElement.addEventListener("click", tryPlayScreenVideos, {
        once: true,
      });

      function drawLeftScreenVideo() {
        if (!leftScreenCanvas || !leftScreenVideo || !leftScreenVideoTexture)
          return;
        if (perfScreenVideoEvery > 1) {
          _perfScreenVideoFrame++;
          if (_perfScreenVideoFrame % perfScreenVideoEvery !== 0) return;
        }
        const vw = leftScreenVideo.videoWidth;
        const vh = leftScreenVideo.videoHeight;
        const cw = leftScreenCanvas.width;
        const ch = leftScreenCanvas.height;
        const ctx = leftScreenCanvas.getContext("2d");
        if (vw <= 0 || vh <= 0) {
          ctx.fillStyle = "#2a2a2e";
          ctx.fillRect(0, 0, cw, ch);
          leftScreenVideoTexture.needsUpdate = true;
          return;
        }
        if (leftScreenVideo.paused) return;
        const drawWidth = cw - leftScreenVideoLeft - leftScreenVideoRight;
        const drawHeight = ch - leftScreenVideoTop - leftScreenVideoBottom;
        let scale;
        const scaleCap = Math.min(
          drawWidth / (vh * leftScreenVideoHeightStretch),
          drawHeight / vw,
        );
        if (leftScreenVideoWidth > 0 || leftScreenVideoHeight > 0) {
          const scaleW =
            leftScreenVideoWidth > 0 ? leftScreenVideoWidth / vh : Infinity;
          const scaleH =
            leftScreenVideoHeight > 0 ? leftScreenVideoHeight / vw : Infinity;
          scale = Math.min(scaleW, scaleH, scaleCap);
        } else {
          scale = scaleCap;
        }
        scale = scale * leftScreenVideoScale;
        const w = vw * scale;
        const h = vh * scale * leftScreenVideoHeightStretch;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, cw, ch);
        ctx.save();
        ctx.translate(
          cw * 0.5 + leftScreenVideoOffsetX,
          ch * 0.5 + leftScreenVideoOffsetY,
        );
        ctx.rotate(Math.PI / 2);
        ctx.translate(-w * 0.5, -h * 0.5);
        ctx.drawImage(leftScreenVideo, 0, 0, vw, vh, 0, 0, w, h);
        ctx.restore();
        leftScreenVideoTexture.needsUpdate = true;
      }

      function drawRightScreenVideo() {
        if (!rightScreenCanvas || !rightScreenVideo || !rightScreenVideoTexture)
          return;
        if (
          perfScreenVideoEvery > 1 &&
          _perfScreenVideoFrame % perfScreenVideoEvery !== 0
        ) {
          return;
        }
        const rvw = rightScreenVideo.videoWidth;
        const rvh = rightScreenVideo.videoHeight;
        const rcw = rightScreenCanvas.width;
        const rch = rightScreenCanvas.height;
        const rctx = rightScreenCanvas.getContext("2d");
        if (rvw <= 0 || rvh <= 0) {
          rctx.fillStyle = "#2a2a2e";
          rctx.fillRect(0, 0, rcw, rch);
          rightScreenVideoTexture.needsUpdate = true;
          return;
        }
        if (rightScreenVideo.paused) return;
        const rdrawWidth = rcw - rightScreenVideoLeft - rightScreenVideoRight;
        const rdrawHeight = rch - rightScreenVideoTop - rightScreenVideoBottom;
        let rscale;
        const rscaleCap = Math.min(
          rdrawWidth / (rvh * rightScreenVideoHeightStretch),
          rdrawHeight / rvw,
        );
        if (rightScreenVideoWidth > 0 || rightScreenVideoHeight > 0) {
          const rscaleW =
            rightScreenVideoWidth > 0 ? rightScreenVideoWidth / rvh : Infinity;
          const rscaleH =
            rightScreenVideoHeight > 0
              ? rightScreenVideoHeight / rvw
              : Infinity;
          rscale = Math.min(rscaleW, rscaleH, rscaleCap);
        } else {
          rscale = rscaleCap;
        }
        rscale = rscale * rightScreenVideoScale;
        const rw = rvw * rscale;
        const rh = rvh * rscale * rightScreenVideoHeightStretch;
        rctx.imageSmoothingEnabled = true;
        rctx.imageSmoothingQuality = "high";
        rctx.fillStyle = "#000";
        rctx.fillRect(0, 0, rcw, rch);
        rctx.save();
        rctx.translate(
          rcw * 0.5 + rightScreenVideoOffsetX,
          rch * 0.5 + rightScreenVideoOffsetY,
        );
        rctx.rotate(Math.PI / 2);
        rctx.translate(-rw * 0.5, -rh * 0.5);
        rctx.drawImage(rightScreenVideo, 0, 0, rvw, rvh, 0, 0, rw, rh);
        rctx.restore();
        rightScreenVideoTexture.needsUpdate = true;
      }

      function resize() {
        const mount = getOfficeSceneMount();
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
      const _mountForResize = getOfficeSceneMount();
      if (_mountForResize && _mountForResize !== document.body) {
        const _officeResizeObserver = new ResizeObserver(() => resize());
        _officeResizeObserver.observe(_mountForResize);
      }

      const clock = new THREE.Clock();
      document.addEventListener("visibilitychange", () => {
        _tabVisible = !document.hidden;
        if (_tabVisible) clock.getDelta();
      });

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
        if (tableSideWallBody && !carFalling) {
          const carR = Math.max(halfW, halfL) * storedCarScale;
          for (let si = 0; si < tableSideWallBody.shapes.length; si++) {
            const sh = tableSideWallBody.shapes[si];
            const off = tableSideWallBody.shapeOffsets[si];
            const he = sh.halfExtents;
            const dx = car.position.x - off.x;
            const dy = car.position.y - off.y;
            const dz = car.position.z - off.z;
            if (Math.abs(dx) >= he.x + carR || Math.abs(dy) >= he.y + carR || Math.abs(dz) >= he.z + carR) continue;
            const overlapX = (he.x + carR) - Math.abs(dx);
            const overlapZ = (he.z + carR) - Math.abs(dz);
            if (overlapX <= 0 || overlapZ <= 0) continue;
            if (overlapX < overlapZ) {
              car.position.x += Math.sign(dx) * overlapX;
            } else {
              car.position.z += Math.sign(dz) * overlapZ;
            }
            carState.speed *= 0.1;
          }
        }
        if (!carFalling && handPhisicsMesh) {
          const carR = Math.max(halfW, halfL) * storedCarScale;
          for (let _handPass = 0; _handPass < 4; _handPass++) {
            if (!resolveCarHandPhysicsBlock(carR)) break;
          }
        }
        if (!carFalling) {
          const carR = Math.max(halfW, halfL) * storedCarScale;
          const wRadius = (wheelFL && wheelFL._physRadius) ? wheelFL._physRadius * storedCarScale : WHEEL_RADIUS * storedCarScale;
          const propBodiesToBlock = [
            dockingStationPhysBody, plantVasePhysBody, macScreenFramePhysBody,
            macBodyBasePhysBody, mainScreensPinPhysBody, mainScreensBasePhysBody,
          ];
          for (let _pass = 0; _pass < 4; _pass++) {
            let anyOverlap = false;
            for (const pb of propBodiesToBlock) {
              if (!pb) continue;
              for (let si = 0; si < pb.shapes.length; si++) {
                const sh = pb.shapes[si];
                const he = getShapeHalfExtents(sh);
                if (!he) continue;
                const isCyl = sh.radiusTop !== undefined;
                const off = pb.shapeOffsets[si];
                const bx = pb.position.x + (off ? off.x : 0);
                const by = pb.position.y + (off ? off.y : 0);
                const bz = pb.position.z + (off ? off.z : 0);
                const dx = car.position.x - bx;
                const dy = car.position.y - by;
                const dz = car.position.z - bz;

                if (Math.abs(dy) >= he.y + carR) continue;

                const propTop = by + he.y;
                const carBottom = car.position.y - carBottomOffsetY;
                if (carBottom >= propTop - 0.01) continue;

                if (isCyl) {
                  const distXZ = Math.sqrt(dx * dx + dz * dz);
                  const combinedR = he.x + carR;
                  if (distXZ >= combinedR) continue;
                  const overlap = combinedR - distXZ;
                  if (overlap <= 0) continue;

                  const stepHeight = propTop - carBottom;
                  const climbMax = pb._driveableStep ?? wRadius;
                  if (!pb._noClimb && stepHeight > 0 && stepHeight <= climbMax) {
                    continue;
                  }

                  anyOverlap = true;
                  if (distXZ > 0.001) {
                    car.position.x += (dx / distXZ) * overlap;
                    car.position.z += (dz / distXZ) * overlap;
                  }
                  carState.speed = 0;
                } else {
                  if (Math.abs(dx) >= he.x + carR || Math.abs(dz) >= he.z + carR) continue;
                  const overlapX = (he.x + carR) - Math.abs(dx);
                  const overlapZ = (he.z + carR) - Math.abs(dz);
                  if (overlapX <= 0 || overlapZ <= 0) continue;

                  const stepHeight = propTop - carBottom;
                  const climbMax = pb._driveableStep ?? wRadius;
                  if (!pb._noClimb && stepHeight > 0 && stepHeight <= climbMax) {
                    continue;
                  }

                  anyOverlap = true;
                  if (overlapX < overlapZ) {
                    car.position.x += Math.sign(dx) * overlapX;
                  } else {
                    car.position.z += Math.sign(dz) * overlapZ;
                  }
                  carState.speed = 0;
                }
              }
            }
            if (!anyOverlap) break;
          }
        }
        if (!carFalling) {
          _carFrontAxleSurfY = tableSurfaceY;
          _carRearAxleSurfY = tableSurfaceY;
          _carGroundSurfY = tableSurfaceY;
          const _propSurf = [
            dockingStationPhysBody, plantVasePhysBody, macScreenFramePhysBody,
            macBodyBasePhysBody, mainScreensPinPhysBody, mainScreensBasePhysBody,
          ];
          const _wheels = [wheelFL, wheelFR, wheelRL, wheelRR];
          const _wSurfY = [tableSurfaceY, tableSurfaceY, tableSurfaceY, tableSurfaceY];
          for (let wi = 0; wi < 4; wi++) {
            const w = _wheels[wi];
            if (!w || !w._canonMesh) continue;
            w._canonMesh.getWorldPosition(_wheelSyncWorldPos[wi]);
            const wx = _wheelSyncWorldPos[wi].x;
            const wz = _wheelSyncWorldPos[wi].z;
            const wr = (w._physRadius || WHEEL_RADIUS) * storedCarScale;
            for (const pb of _propSurf) {
              if (!pb) continue;
              if (pb._noClimb) continue;
              for (let si = 0; si < pb.shapes.length; si++) {
                const sh = pb.shapes[si];
                const he = getShapeHalfExtents(sh);
                if (!he) continue;
                const off = pb.shapeOffsets[si];
                const bx = pb.position.x + (off ? off.x : 0);
                const by = pb.position.y + (off ? off.y : 0);
                const bz = pb.position.z + (off ? off.z : 0);
                if (Math.abs(wx - bx) >= he.x + wr) continue;
                if (Math.abs(wz - bz) >= he.z + wr) continue;
                const propTop = by + he.y;
                if (propTop > _wSurfY[wi]) _wSurfY[wi] = propTop;
              }
            }
          }
          _carFrontAxleSurfY = Math.max(_wSurfY[0], _wSurfY[1]);
          _carRearAxleSurfY = Math.max(_wSurfY[2], _wSurfY[3]);
          _carLeftAxleSurfY = Math.max(_wSurfY[0], _wSurfY[2]);
          _carRightAxleSurfY = Math.max(_wSurfY[1], _wSurfY[3]);
          for (let wi = 0; wi < 4; wi++) _carWheelSurfY[wi] = _wSurfY[wi];
          _carGroundSurfY = Math.max(_carFrontAxleSurfY, _carRearAxleSurfY);
          let _minWheelSurf = _wSurfY[0];
          let _maxWheelSurf = _wSurfY[0];
          for (let wi = 1; wi < 4; wi++) {
            if (_wSurfY[wi] < _minWheelSurf) _minWheelSurf = _wSurfY[wi];
            if (_wSurfY[wi] > _maxWheelSurf) _maxWheelSurf = _wSurfY[wi];
          }
          _carSurfRange = _maxWheelSurf - _minWheelSurf;
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
          _rampJumpDidSlowMo = false;
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
          let _landOnY = tableSpawn.y;
          if (carState.velY <= 0) {
            const _carRLand = Math.max(halfW, halfL) * storedCarScale;
            const _propLandBodies = [
              dockingStationPhysBody, plantVasePhysBody, macScreenFramePhysBody,
              macBodyBasePhysBody, mainScreensPinPhysBody, mainScreensBasePhysBody,
            ];
            for (const pb of _propLandBodies) {
              if (!pb) continue;
              if (pb._noClimb) continue;
              for (let si = 0; si < pb.shapes.length; si++) {
                const sh = pb.shapes[si];
                const he = getShapeHalfExtents(sh);
                if (!he) continue;
                const off = pb.shapeOffsets[si];
                const bx = pb.position.x + (off ? off.x : 0);
                const by = pb.position.y + (off ? off.y : 0);
                const bz = pb.position.z + (off ? off.z : 0);
                if (Math.abs(car.position.x - bx) >= he.x + _carRLand) continue;
                if (Math.abs(car.position.z - bz) >= he.z + _carRLand) continue;
                const propTop = by + he.y;
                if (propTop > _landOnY && car.position.y - carBottomOffsetY <= propTop + 0.1) {
                  _landOnY = propTop + carBottomOffsetY;
                }
              }
            }
          }
          if (car.position.y < _landOnY) {
            car.position.y = _landOnY;
            if (carState.velY !== 0 && (wasInAir || jumpInitialVelY > 0.02)) {
              _carLandShakePending = true;
            }
            carState.velY = 0;
          }
        } else if (wasOnRamp && car.position.y > tableSpawn.y + 0.2 * storedCarScale) {
          carState.velY = -0.5;
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
          } else {
            const _carRRest = Math.max(halfW, halfL) * storedCarScale;
            const _propRestBodies = [
              dockingStationPhysBody, plantVasePhysBody, macScreenFramePhysBody,
              macBodyBasePhysBody, mainScreensPinPhysBody, mainScreensBasePhysBody,
            ];
            for (const pb of _propRestBodies) {
              if (!pb) continue;
              if (pb._noClimb) continue;
              for (let si = 0; si < pb.shapes.length; si++) {
                const sh = pb.shapes[si];
                const he = getShapeHalfExtents(sh);
                if (!he) continue;
                const off = pb.shapeOffsets[si];
                const bx = pb.position.x + (off ? off.x : 0);
                const by = pb.position.y + (off ? off.y : 0);
                const bz = pb.position.z + (off ? off.z : 0);
                if (Math.abs(car.position.x - bx) >= he.x + _carRRest) continue;
                if (Math.abs(car.position.z - bz) >= he.z + _carRRest) continue;
                const propTop = by + he.y;
                const carBottom = car.position.y - carBottomOffsetY;
                if (carBottom >= propTop - 0.05) {
                  const surfY = propTop + carBottomOffsetY;
                  if (surfY > _restOnY) _restOnY = surfY;
                }
              }
            }
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

      let airPlaneModel = null;
      const airPlaneMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 1.0,
        metalness: 0.0,
        side: THREE.DoubleSide,
        emissive: 0xffffff,
        emissiveIntensity: 0.15,
      });
      const airPlaneFlight = {
        speed: 10.0,
        t: 0,
        baseY: 0,
        yOffset: 0,
        yTarget: 2.0,
        yTimer: 0,
        yDuration: 3,
        segments: [],
        totalLen: 0,
        bankAngle: 0,
      };
      loader.load(officeAsset("airPlane2.gltf"), (gltf) => {
        const rawScene = gltf.scene;
        rawScene.traverse((node) => {
          if (node.isMesh) {
            if (Array.isArray(node.material)) {
              for (let i = 0; i < node.material.length; i++) node.material[i] = airPlaneMaterial;
            } else {
              node.material = airPlaneMaterial;
            }
          }
        });
        const box = new THREE.Box3().setFromObject(rawScene);
        const meshCenter = box.getCenter(new THREE.Vector3());
        airPlaneFlight.baseY = meshCenter.y - 4;

        airPlaneModel = new THREE.Group();
        rawScene.position.sub(meshCenter);
        airPlaneModel.add(rawScene);
        airPlaneModel.position.copy(meshCenter);
        scene.add(airPlaneModel);
        applyTextureAnisotropyToRoot(airPlaneModel);
        scheduleRebuildBloomDarkenLists();

        airPlaneFlight.pathBuilt = false;
      });

      function buildAirPlanePath() {
        if (airPlaneFlight.pathBuilt) return;
        if (!tablePlateMesh) return;
        airPlaneFlight.pathBuilt = true;

        tablePlateMesh.updateMatrixWorld(true);
        const tb = new THREE.Box3().setFromObject(tablePlateMesh);
        const tc = tb.getCenter(new THREE.Vector3());
        const halfX = (tb.max.x - tb.min.x) * 0.5;
        const halfZ = (tb.max.z - tb.min.z) * 0.5;
        const scaleX = 1.5;
        const scaleZ = 0.6;
        const corners = [
          [tc.x - halfX * scaleX, tc.z - halfZ * scaleZ],
          [tc.x + halfX * scaleX, tc.z - halfZ * scaleZ],
          [tc.x + halfX * scaleX, tc.z + halfZ * scaleZ],
          [tc.x - halfX * scaleX, tc.z + halfZ * scaleZ],
        ];

        const R = 8.0;
        const segs = [];
        const n = corners.length;
        const edgeDirs = [];
        for (let i = 0; i < n; i++) {
          const curr = corners[i];
          const next = corners[(i + 1) % n];
          const dx = next[0] - curr[0], dz = next[1] - curr[1];
          const len = Math.sqrt(dx * dx + dz * dz);
          edgeDirs.push({ ux: dx / len, uz: dz / len, len });
        }
        for (let i = 0; i < n; i++) {
          const ed = edgeDirs[i];
          const straightLen = ed.len - 2 * R;
          const curr = corners[i];
          segs.push({
            type: "straight",
            sx: curr[0] + ed.ux * R, sz: curr[1] + ed.uz * R,
            ex: corners[(i + 1) % n][0] - ed.ux * R,
            ez: corners[(i + 1) % n][1] - ed.uz * R,
            dx: ed.ux, dz: ed.uz,
            len: Math.max(straightLen, 0),
          });
          const edNext = edgeDirs[(i + 1) % n];
          const cornerPt = corners[(i + 1) % n];
          const arcStart = [cornerPt[0] - ed.ux * R, cornerPt[1] - ed.uz * R];
          const arcEnd = [cornerPt[0] + edNext.ux * R, cornerPt[1] + edNext.uz * R];
          const inNx = -ed.uz, inNz = ed.ux;
          const cross = ed.ux * edNext.uz - ed.uz * edNext.ux;
          const sign = cross > 0 ? 1 : -1;
          const cx = arcStart[0] + inNx * R * sign;
          const cz = arcStart[1] + inNz * R * sign;
          const startAngle = Math.atan2(arcStart[1] - cz, arcStart[0] - cx);
          const endAngle = Math.atan2(arcEnd[1] - cz, arcEnd[0] - cx);
          let sweep = endAngle - startAngle;
          while (sweep > Math.PI) sweep -= 2 * Math.PI;
          while (sweep < -Math.PI) sweep += 2 * Math.PI;
          segs.push({
            type: "arc",
            cx, cz, r: R,
            startAngle, sweep,
            len: Math.abs(sweep) * R,
            turnSign: sign,
          });
        }

        airPlaneFlight.segments = segs;
        airPlaneFlight.totalLen = 0;
        for (const s of segs) airPlaneFlight.totalLen += s.len;

        const pathPoints = [];
        const pathY = airPlaneFlight.baseY;
        for (const s of segs) {
          if (s.type === "straight") {
            pathPoints.push(new THREE.Vector3(s.sx, pathY, s.sz));
            pathPoints.push(new THREE.Vector3(s.ex, pathY, s.ez));
          } else {
            const steps = 24;
            for (let j = 0; j <= steps; j++) {
              const frac = j / steps;
              const angle = s.startAngle + s.sweep * frac;
              pathPoints.push(new THREE.Vector3(
                s.cx + Math.cos(angle) * s.r,
                pathY,
                s.cz + Math.sin(angle) * s.r,
              ));
            }
          }
        }
        pathPoints.push(pathPoints[0].clone());

      }

      const GUM_CAR_DISTURB_MS = 900;

      function wakeGumFromCarHit(body) {
        if (!body) return;
        if (body.type === CANNON.Body.STATIC) {
          body.type = CANNON.Body.DYNAMIC;
          body.mass = 0.5;
          body.updateMassProperties();
        }
        body.wakeUp();
        body._carDisturbedUntil = performance.now() + GUM_CAR_DISTURB_MS;
      }

      function bindGumCarCollide(body) {
        body.addEventListener("collide", (e) => {
          if (e.body && e.body.material === carMaterial) wakeGumFromCarHit(body);
        });
      }

      function isGumCarDisturbed(body) {
        return body && body._carDisturbedUntil && performance.now() < body._carDisturbedUntil;
      }

      function syncGumInstancedTransforms() {
        if (!gumInstancedMesh) return;
        const mesh = gumInstancedMesh;
        const n = gumsAddedCount;
        mesh.count = n;
        if (n < 1) {
          mesh.instanceMatrix.needsUpdate = true;
          return;
        }
        for (let gi = 0; gi < n; gi++) {
          const gb = gumBodies[gi];
          _gumSyncP.set(gb.position.x, gb.position.y, gb.position.z);
          _gumSyncQ.set(
            gb.quaternion.x,
            gb.quaternion.y,
            gb.quaternion.z,
            gb.quaternion.w,
          );
          _gumSyncM.compose(_gumSyncP, _gumSyncQ, _gumSyncS);
          mesh.setMatrixAt(gi, _gumSyncM);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }

      function _gumGridClear() {
        const t = _gumCellTouched;
        for (let ti = 0; ti < t.length; ti++) {
          _gumCellMap.get(t[ti]).length = 0;
        }
        t.length = 0;
      }

      function _gumGridPush(key, idx) {
        let arr = _gumCellMap.get(key);
        if (!arr) {
          arr = [];
          _gumCellMap.set(key, arr);
        }
        if (arr.length === 0) _gumCellTouched.push(key);
        arr.push(idx);
      }

      function _gumCellKey(x, y, z, invCs) {
        const max = GUM_CELL_STRIDE - 1;
        let ix = (Math.floor(x * invCs) + GUM_CELL_OFF) | 0;
        let iy = (Math.floor(y * invCs) + GUM_CELL_OFF) | 0;
        let iz = (Math.floor(z * invCs) + GUM_CELL_OFF) | 0;
        if (ix < 0) ix = 0;
        else if (ix > max) ix = max;
        if (iy < 0) iy = 0;
        else if (iy > max) iy = max;
        if (iz < 0) iz = 0;
        else if (iz > max) iz = max;
        const s = GUM_CELL_STRIDE;
        return ix + iy * s + iz * s * s;
      }

      function _gumBuildRepulsionGrid(n, invCell) {
        _gumGridClear();
        for (let i = 0; i < n; i++) {
          const b = gumBodies[i];
          if (b.type === CANNON.Body.STATIC) continue;
          _gumGridPush(
            _gumCellKey(b.position.x, b.position.y, b.position.z, invCell),
            i,
          );
        }
      }

      function _gumBuildSeparationGrid(n, invCell) {
        _gumGridClear();
        for (let i = 0; i < n; i++) {
          const b = gumBodies[i];
          _gumGridPush(
            _gumCellKey(b.position.x, b.position.y, b.position.z, invCell),
            i,
          );
        }
      }

      /** Soft repulsion before physics so gums steer apart instead of slamming together. */
      function applyGumMutualRepulsion(dt) {
        const n = gumsAddedCount;
        if (n < 2) return;
        const r = gumRadiusGlobal;
        const rest = 2.05 * r;
        const rest2 = rest * rest;
        const k = 30;
        const invCell = 1 / rest;
        const stride = GUM_CELL_STRIDE;
        _gumBuildRepulsionGrid(n, invCell);
        for (let i = 0; i < n; i++) {
          const bi = gumBodies[i];
          if (bi.type === CANNON.Body.STATIC) continue;
          const pxi = bi.position.x,
            pyi = bi.position.y,
            pzi = bi.position.z;
          const maxC = stride - 1;
          let ix = (Math.floor(pxi * invCell) + GUM_CELL_OFF) | 0;
          let iy = (Math.floor(pyi * invCell) + GUM_CELL_OFF) | 0;
          let iz = (Math.floor(pzi * invCell) + GUM_CELL_OFF) | 0;
          if (ix < 0) ix = 0;
          else if (ix > maxC) ix = maxC;
          if (iy < 0) iy = 0;
          else if (iy > maxC) iy = maxC;
          if (iz < 0) iz = 0;
          else if (iz > maxC) iz = maxC;
          for (let ox = -1; ox <= 1; ox++) {
            const cx = ix + ox;
            if (cx < 0 || cx > maxC) continue;
            for (let oy = -1; oy <= 1; oy++) {
              const cy = iy + oy;
              if (cy < 0 || cy > maxC) continue;
              for (let oz = -1; oz <= 1; oz++) {
                const cz = iz + oz;
                if (cz < 0 || cz > maxC) continue;
                const key = cx + cy * stride + cz * stride * stride;
                const list = _gumCellMap.get(key);
                if (!list) continue;
                for (let li = 0; li < list.length; li++) {
                  const j = list[li];
                  if (j <= i) continue;
                  const bj = gumBodies[j];
                  if (bj.type === CANNON.Body.STATIC) continue;
                  const dx = bj.position.x - pxi;
                  const dy = bj.position.y - pyi;
                  const dz = bj.position.z - pzi;
                  const d2 = dx * dx + dy * dy + dz * dz;
                  if (d2 >= rest2 || d2 < 1e-16) continue;
                  const d = Math.sqrt(d2);
                  const s = ((rest - d) / d) * k * dt;
                  const fx = dx * s;
                  const fy = dy * s;
                  const fz = dz * s;
                  bi.velocity.x -= fx;
                  bi.velocity.y -= fy;
                  bi.velocity.z -= fz;
                  bj.velocity.x += fx;
                  bj.velocity.y += fy;
                  bj.velocity.z += fz;
                }
              }
            }
          }
        }
      }

      /** Uses `_gumTankMwCached` / `_invTankMwGumClamp`; refresh once per frame before gum substeps.
       *  @param gentle If true (fill phase): skip Y-top clamp so gums fall in naturally; only clamp walls+bottom. */
      function clampGumsInsideTankLocalAabb(gentle) {
        const c = _gumTankClampLocal;
        if (!c || !gumsTankPhysicObject || gumsAddedCount < 1) return;
        const tankMw = _gumTankMwCached;
        for (let i = 0; i < gumsAddedCount; i++) {
          const body = gumBodies[i];
          if (body.type === CANNON.Body.STATIC) continue;
          _gumClampTmp.set(body.position.x, body.position.y, body.position.z);
          _gumClampTmp.applyMatrix4(_invTankMwGumClamp);
          const px = _gumClampTmp.x;
          const py = _gumClampTmp.y;
          const pz = _gumClampTmp.z;
          if (py > c.maxY + gumRadiusGlobal * 4) continue;
          const skipY = gumReleased.has(i) || _gumDispenserBecameDynamic;
          if (skipY && py < c.minY - gumRadiusGlobal * 2) continue;
          _gumClampTmp.x = THREE.MathUtils.clamp(px, c.minX, c.maxX);
          if (gentle) {
            if (py < c.minY) _gumClampTmp.y = c.minY;
          } else {
            if (!skipY) _gumClampTmp.y = THREE.MathUtils.clamp(py, c.minY, c.maxY);
          }
          _gumClampTmp.z = THREE.MathUtils.clamp(pz, c.minZ, c.maxZ);
          const clampedX = _gumClampTmp.x !== px;
          const clampedY = _gumClampTmp.y !== py;
          const clampedZ = _gumClampTmp.z !== pz;
          if (clampedX || clampedY || clampedZ) {
            if (clampedX) body.velocity.x *= 0.2;
            if (clampedY) body.velocity.y *= 0.3;
            if (clampedZ) body.velocity.z *= 0.2;
            if (body.sleepState === 2) body.wakeUp();
          }
          _gumClampTmp.applyMatrix4(tankMw);
          body.position.x = _gumClampTmp.x;
          body.position.y = _gumClampTmp.y;
          body.position.z = _gumClampTmp.z;
        }
      }

      /** Check if gum `gi` is inside (or near) the tank physics AABB. */
      function isGumInsideTank(gi) {
        const c = _gumTankClampLocal;
        if (!c || !gumsTankPhysicObject) return false;
        const body = gumBodies[gi];
        _gumClampTmp.set(body.position.x, body.position.y, body.position.z);
        _gumClampTmp.applyMatrix4(_invTankMwGumClamp);
        const pad = gumRadiusGlobal * 2;
        return (
          _gumClampTmp.x >= c.minX - pad && _gumClampTmp.x <= c.maxX + pad &&
          _gumClampTmp.y >= c.minY - pad && _gumClampTmp.y <= c.maxY + pad &&
          _gumClampTmp.z >= c.minZ - pad && _gumClampTmp.z <= c.maxZ + pad
        );
      }

      /**
       * Positional correction so gum spheres never stay interpenetrating.
       * @param applyApproachImpulse If false (settled pile), only nudge positions — avoids pumping energy forever.
       */
      function separateOverlappingGumSpheres(applyApproachImpulse) {
        const n = gumsAddedCount;
        if (n < 2) return;
        const r = gumRadiusGlobal;
        const minCenterDist = 2 * r;
        let passes = applyApproachImpulse ? 3 : 2;
        const invCell = 1 / (minCenterDist * 1.15);
        const stride = GUM_CELL_STRIDE;
        const min2 = minCenterDist * minCenterDist * 0.9999;
        for (let pass = 0; pass < passes; pass++) {
          _gumBuildSeparationGrid(n, invCell);
          for (let i = 0; i < n; i++) {
            const bi = gumBodies[i];
            const biStatic = bi.type === CANNON.Body.STATIC;
            const pxi = bi.position.x,
              pyi = bi.position.y,
              pzi = bi.position.z;
            const maxC = stride - 1;
            let ix = (Math.floor(pxi * invCell) + GUM_CELL_OFF) | 0;
            let iy = (Math.floor(pyi * invCell) + GUM_CELL_OFF) | 0;
            let iz = (Math.floor(pzi * invCell) + GUM_CELL_OFF) | 0;
            if (ix < 0) ix = 0;
            else if (ix > maxC) ix = maxC;
            if (iy < 0) iy = 0;
            else if (iy > maxC) iy = maxC;
            if (iz < 0) iz = 0;
            else if (iz > maxC) iz = maxC;
            for (let ox = -1; ox <= 1; ox++) {
              const cx = ix + ox;
              if (cx < 0 || cx > maxC) continue;
              for (let oy = -1; oy <= 1; oy++) {
                const cy = iy + oy;
                if (cy < 0 || cy > maxC) continue;
                for (let oz = -1; oz <= 1; oz++) {
                  const cz = iz + oz;
                  if (cz < 0 || cz > maxC) continue;
                  const key = cx + cy * stride + cz * stride * stride;
                  const list = _gumCellMap.get(key);
                  if (!list) continue;
                  for (let li = 0; li < list.length; li++) {
                    const j = list[li];
                    if (j <= i) continue;
                    const bj = gumBodies[j];
                    if (biStatic && bj.type === CANNON.Body.STATIC) continue;
                    const dx = bj.position.x - pxi;
                    const dy = bj.position.y - pyi;
                    const dz = bj.position.z - pzi;
                    const dist2 = dx * dx + dy * dy + dz * dz;
                    if (dist2 >= min2) continue;
                    const dist = Math.sqrt(dist2) || 1e-9;
                    const overlap = minCenterDist - dist;
                    const nx = dx / dist;
                    const ny = dy / dist;
                    const nz = dz / dist;
                    const corr = Math.min(overlap * 0.5, r * 0.32);
                    bi.position.x -= nx * corr;
                    bi.position.y -= ny * corr;
                    bi.position.z -= nz * corr;
                    bj.position.x += nx * corr;
                    bj.position.y += ny * corr;
                    bj.position.z += nz * corr;
                    if (!applyApproachImpulse) continue;
                    const rvx = bj.velocity.x - bi.velocity.x;
                    const rvy = bj.velocity.y - bi.velocity.y;
                    const rvz = bj.velocity.z - bi.velocity.z;
                    const vn = rvx * nx + rvy * ny + rvz * nz;
                    if (vn < 0) {
                      const d = vn * 0.48;
                      bi.velocity.x += d * nx;
                      bi.velocity.y += d * ny;
                      bi.velocity.z += d * nz;
                      bj.velocity.x -= d * nx;
                      bj.velocity.y -= d * ny;
                      bj.velocity.z -= d * nz;
                    }
                  }
                }
              }
            }
          }
        }
      }

      window.officeScenePerf = {
        getSettings: () => perfSettings,
        setTier: (tier) => setPerformanceTier(tier, "manual"),
      };

      function animate() {
        requestAnimationFrame(animate);
        if (!_tabVisible) return;
        try {
          const rawDt = clock.getDelta();
          let simTimeScale = getRampJumpSlowMoScale();
          const dt = Math.min(rawDt, 0.05) * simTimeScale;
          const nowSec = performance.now() / 1000;
          let gumTankAllStaticThisFrame = false;
          const carDt = 1 / 60;
          const maxCarSteps = perfMaxCarSteps;
          trackPerformanceFrame(rawDt);
          let physicsStepDt = dt;
          if (perfPhysicsIdleCoalesce) {
            const carIdle =
              car &&
              carState.velY === 0 &&
              Math.abs(carState.speed) < 0.04 &&
              !keys.forward &&
              !keys.reverse;
            const animBusy =
              _handWalkZPhase !== 0 ||
              (_officeArmatureAction && _officeArmatureAction.isRunning());
            if (
              carIdle &&
              _gumPrevFrameTankAllStatic &&
              !gumsReadyToDrop &&
              !animBusy
            ) {
              _physCoalesceDt += dt;
              if (_physCoalesceDt < 1 / 28) physicsStepDt = 0;
              else {
                physicsStepDt = _physCoalesceDt;
                _physCoalesceDt = 0;
              }
            } else {
              _physCoalesceDt = 0;
            }
          }
          let carTimeLeft = dt;
          for (let s = 0; s < maxCarSteps && carTimeLeft > 0; s++) {
            const step = Math.min(carDt, carTimeLeft);
            updateCar(step);
            if (carState.velY !== 0 && jumpInitialVelY > 0.02) {
              _rampJumpSimAirTime += step;
            }
            carTimeLeft -= step;
          }
          updateRampJumpFxBlend(rawDt);
          if (_carLandShakePending && camera === carCamera) {
            triggerCarCam1LandingShake(
              jumpLaunchSpeed / Math.max(0.01, carState.maxSpeed),
            );
            _carLandShakePending = false;
          }
          updateHandWalkTrigger(dt);
          if (camera !== gumsTankCamera) updateEyeTracking();
          if (
            _officeAnimMixer &&
            _officeArmatureAction &&
            (_officeArmatureAction.isRunning() || _handWalkZPhase !== 0)
          ) {
            _officeAnimMixer.update(dt);
          }
          syncHandPhysics();
          updateCupSlide();
          updateDrawerAnimation();
          updatePortalEffect();
          if (gumsReadyToDrop && gumsAddedCount < gumBodies.length) {
            const now = performance.now();
            if (now >= nextGumDropTime) {
              const batch = Math.min(
                GUM_DROP_COLUMN_COUNT,
                gumBodies.length - gumsAddedCount,
              );
              for (let k = 0; k < batch; k++) {
                const gi = gumsAddedCount;
                const b = gumBodies[gi];
                const col =
                  gumsDropColumnXZ.length >= GUM_DROP_COLUMN_COUNT
                    ? gumsDropColumnXZ[gi % GUM_DROP_COLUMN_COUNT]
                    : { x: gumsDropCenterX, z: gumsDropCenterZ };
                b.position.set(col.x, gumsDropTopY, col.z);
                b.velocity.set(0, 0, 0);
                b.angularVelocity.set(0, 0, 0);
                b.force.set(0, 0, 0);
                b.torque.set(0, 0, 0);
                b.wakeUp();
                physicsWorld.addBody(b);
                _debugGumSet.add(b);
                gumsAddedCount++;
              }
              nextGumDropTime = now + GUM_DROP_INTERVAL;
            }
          }
          if (gumsAddedCount >= gumBodies.length && gumsReadyToDrop) {
            gumsReadyToDrop = false;
          }
          // Sync car kinematic bodies BEFORE physics step so collisions are detected
          if (car) {
            _wheelsList[0] = wheelFL;
            _wheelsList[1] = wheelFR;
            _wheelsList[2] = wheelRL;
            _wheelsList[3] = wheelRR;
            car.updateMatrixWorld(true);
            const _syncInvDt = dt > 0 ? 1 / dt : 0;
            const _wheelBodies = [canonFLBody, canonFRBody, canonRLBody, canonRRBody];
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
                cvx *= cvScale; cvy *= cvScale; cvz *= cvScale;
              }
              wb.velocity.set(cvx, cvy, cvz);
              wb.position.set(_canonWorldPos.x, _canonWorldPos.y, _canonWorldPos.z);
              wb.quaternion.set(_canonWorldQuat.x, _canonWorldQuat.y, _canonWorldQuat.z, _canonWorldQuat.w);
              wb.aabbNeedsUpdate = true;
            }
            if (canonBodyPhys && canonBodyMesh) {
              const cbBox = new THREE.Box3().setFromObject(canonBodyMesh);
              const cbCenter = cbBox.getCenter(_canonWorldPos);
              canonBodyMesh.getWorldQuaternion(_canonWorldQuat);
              canonBodyPhys.position.set(cbCenter.x, cbCenter.y, cbCenter.z);
              canonBodyPhys.quaternion.set(_canonWorldQuat.x, _canonWorldQuat.y, _canonWorldQuat.z, _canonWorldQuat.w);
            }
            if (car.userData._carPhysWires) {
              for (const { wire, body } of car.userData._carPhysWires) {
                wire.position.set(body.position.x, body.position.y, body.position.z);
                wire.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
              }
            }
            if (gumsAddedCount > 0 && gumBodies.length > 0) {
              const wakeMargin = gumRadiusGlobal * 2;
              const _gumLimit = Math.min(gumsAddedCount, gumBodies.length);
              const _carWakeBodies = [
                canonFLBody, canonFRBody, canonRLBody, canonRRBody, canonBodyPhys,
              ].filter(Boolean);
              for (let cbi = 0; cbi < _carWakeBodies.length; cbi++) {
                const wb = _carWakeBodies[cbi];
                if (!wb || !wb.shapes[0]) continue;
                const cs = wb.shapes[0];
                let wxH, wyH, wzH;
                if (cs.halfExtents) {
                  wxH = cs.halfExtents.x + wakeMargin;
                  wyH = cs.halfExtents.y + wakeMargin;
                  wzH = cs.halfExtents.z + wakeMargin;
                } else if (cs.radiusTop !== undefined) {
                  wxH = cs.radiusTop + wakeMargin;
                  wyH = cs.height / 2 + wakeMargin;
                  wzH = cs.radiusTop + wakeMargin;
                } else {
                  wxH = wyH = wzH = wakeMargin + 0.5;
                }
                const cpx = wb.position.x, cpy = wb.position.y, cpz = wb.position.z;
                for (let gi = 0; gi < _gumLimit; gi++) {
                  const gb = gumBodies[gi];
                  if (!gb) continue;
                  if (gb.type === CANNON.Body.DYNAMIC && gb.sleepState !== CANNON.Body.SLEEPING) continue;
                  const dx = Math.abs(gb.position.x - cpx);
                  const dy = Math.abs(gb.position.y - cpy);
                  const dz = Math.abs(gb.position.z - cpz);
                  if (dx < wxH && dy < wyH && dz < wzH) {
                    wakeGumFromCarHit(gb);
                  }
                }
              }
            }
          }

          if (gumsReadyToDrop) {
            if ((_gumRepulsionFrame++ & 1) === 0)
              applyGumMutualRepulsion(dt * 2);
          } else {
            _gumRepulsionFrame = 0;
          }
          if (gumsAddedCount > 0) {
            if (gumsReadyToDrop) {
              gumsTankSettleAccum = 0;
              gumsPostFillElapsed = 0;
            } else if (gumReleased.size === 0) {
              gumsPostFillElapsed += dt;
            }
            const gumDampAfterFill =
              !gumsReadyToDrop && gumReleased.size === 0 ? 0.86 : 0.82;
            const gumDampingWhileFilling = gumsReadyToDrop
              ? 0.28
              : (_gumDispenserBecameDynamic ? 0.4 : gumDampAfterFill);
            const maxGumSpd = _gumDispenserBecameDynamic ? 30 : 4;
            const maxFallSpd = _gumDispenserBecameDynamic ? 30 : 3;
            for (let gi = 0; gi < gumsAddedCount; gi++) {
              const gb = gumBodies[gi];
              if (gb.type === CANNON.Body.STATIC) continue;
              if (gb.type === CANNON.Body.DYNAMIC && (!gumReleased.has(gi) || _gumDispenserBecameDynamic))
                gb.linearDamping = gumDampingWhileFilling;
              const v = gb.velocity;
              if (v.y < -maxFallSpd) v.y = -maxFallSpd;
              const spd = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
              if (spd > maxGumSpd) {
                const sc = maxGumSpd / spd;
                v.x *= sc;
                v.y *= sc;
                v.z *= sc;
              }
            }
            if (physicsStepDt > 0) {
            if (_gumDispenserBecameDynamic) syncGumDispenserFromPhysics();
            const fixedStep = _gumDispenserBecameDynamic ? GUM_PHYS_FIXED_STEP_DYNAMIC : GUM_PHYS_FIXED_STEP;
            const maxSub = gumsReadyToDrop
              ? perfGumMaxSubstepsFill
              : _gumDispenserBecameDynamic
                ? perfGumMaxSubstepsDynamic
                : perfGumMaxSubstepsMixed;
            const subSteps = Math.min(Math.ceil(physicsStepDt / fixedStep), maxSub);
            const gumSepUseImpulse =
              gumsReadyToDrop || gumReleased.size > 0;
            let allTankGumsStatic =
              !gumsReadyToDrop && gumReleased.size === 0;
            if (allTankGumsStatic) {
              for (let gi = 0; gi < gumsAddedCount; gi++) {
                if (gumBodies[gi].type !== CANNON.Body.STATIC) {
                  allTankGumsStatic = false;
                  break;
                }
              }
            } else {
              allTankGumsStatic = false;
            }
            if (allTankGumsStatic) {
              physicsWorld.step(1 / 60, physicsStepDt, 3);
              gumTankAllStaticThisFrame = true;
            } else {
              gumTankAllStaticThisFrame = false;
              if (gumsTankPhysicObject) {
                gumsTankPhysicObject.updateMatrixWorld(true);
                _gumTankMwCached.copy(gumsTankPhysicObject.matrixWorld);
                _invTankMwGumClamp.copy(_gumTankMwCached).invert();
              }
              if (_gumDispenserBecameDynamic) {
                syncGumDispenserFromPhysics();
                if (gumsTankPhysicObject) {
                  gumDispenserGroup.updateMatrixWorld(true);
                  gumsTankPhysicObject.updateMatrixWorld(true);
                  _gumTankMwCached.copy(gumsTankPhysicObject.matrixWorld);
                  _invTankMwGumClamp.copy(_gumTankMwCached).invert();
                }
                physicsWorld.step(1 / 60, physicsStepDt, 2);
              } else {
                for (let si = 0; si < subSteps; si++) {
                  clampGumsInsideTankLocalAabb();
                  physicsWorld.step(fixedStep);
                  clampGumsInsideTankLocalAabb();
                  if (gumsReadyToDrop) separateOverlappingGumSpheres(gumSepUseImpulse);
                }
                clampGumsInsideTankLocalAabb();
              }
            }
            } else if (
              physicsStepDt <= 0 &&
              _gumPrevFrameTankAllStatic &&
              !gumsReadyToDrop
            ) {
              gumTankAllStaticThisFrame = true;
            }
            if (!gumsReadyToDrop) {
              if (!_gumDispenserBecameDynamic) {
              for (let gi = 0; gi < gumsAddedCount; gi++) {
                if (gumReleased.has(gi)) continue;
                if (!isGumInsideTank(gi)) continue;
                const b = gumBodies[gi];
                if (isGumCarDisturbed(b)) continue;
                if (b.type === CANNON.Body.DYNAMIC && b.sleepState === 2) {
                  b.type = CANNON.Body.STATIC;
                  b.velocity.set(0, 0, 0);
                  b.angularVelocity.set(0, 0, 0);
                  b.updateMassProperties();
                }
              }
              }
              /** COM speed only — wait until motion is actually small before counting “settled”. */
              const settleLinMax = 0.45;
              const settleHoldSec = 0.15;
              const postFillForceStaticSec = 0.5;
              let anyDynamicTank = false;
              let allSlowLin = true;
              for (let gi = 0; gi < gumsAddedCount; gi++) {
                if (gumReleased.has(gi)) continue;
                if (!isGumInsideTank(gi)) continue;
                const b = gumBodies[gi];
                if (b.type === CANNON.Body.STATIC) continue;
                anyDynamicTank = true;
                const v = b.velocity;
                const lin = Math.sqrt(
                  v.x * v.x + v.y * v.y + v.z * v.z,
                );
                if (lin > settleLinMax) {
                  allSlowLin = false;
                  break;
                }
              }
              if (anyDynamicTank && allSlowLin)
                gumsTankSettleAccum += dt;
              else gumsTankSettleAccum = 0;
              const timeFuse =
                gumReleased.size === 0 &&
                gumsPostFillElapsed >= postFillForceStaticSec;
              if (
                !_gumDispenserBecameDynamic &&
                ((anyDynamicTank && gumsTankSettleAccum >= settleHoldSec) ||
                (anyDynamicTank && timeFuse))
              ) {
                for (let gi = 0; gi < gumsAddedCount; gi++) {
                  if (gumReleased.has(gi)) continue;
                  if (!isGumInsideTank(gi)) continue;
                  const b = gumBodies[gi];
                  if (isGumCarDisturbed(b)) continue;
                  if (b.type === CANNON.Body.DYNAMIC) {
                    b.type = CANNON.Body.STATIC;
                    b.velocity.set(0, 0, 0);
                    b.angularVelocity.set(0, 0, 0);
                    b.updateMassProperties();
                  }
                }
                gumsTankSettleAccum = 0;
              }
              const _dispenserStillMoving = _gumDispenserBecameDynamic && gumDispenserPhysBody &&
                (Math.abs(gumDispenserPhysBody.velocity.x) > 0.5 ||
                 Math.abs(gumDispenserPhysBody.velocity.y) > 0.5 ||
                 Math.abs(gumDispenserPhysBody.velocity.z) > 0.5);
              if (_gumDispenserBecameDynamic && !_dispenserStillMoving) {
                const dynSettleSpd2 = 0.3 * 0.3;
                const dynSettleAng2 = 1.0 * 1.0;
                for (let gi = 0; gi < gumsAddedCount; gi++) {
                  const b = gumBodies[gi];
                  if (b.type !== CANNON.Body.DYNAMIC) continue;
                  if (b.sleepState === 2) continue;
                  const v = b.velocity;
                  const av = b.angularVelocity;
                  const linSpd2 = v.x * v.x + v.y * v.y + v.z * v.z;
                  const angSpd2 = av.x * av.x + av.y * av.y + av.z * av.z;
                  if (linSpd2 < dynSettleSpd2 && angSpd2 < dynSettleAng2) {
                    if (!b._dynSlowAccum) b._dynSlowAccum = 0;
                    b._dynSlowAccum += dt;
                    if (b._dynSlowAccum >= 0.5) {
                      b.velocity.set(0, 0, 0);
                      b.angularVelocity.set(0, 0, 0);
                      b.sleep();
                    }
                  } else {
                    b._dynSlowAccum = 0;
                  }
                }
              }
              if (gumReleased.size > 0) {
                _gumReleasedTimer += dt;
                const relSettleSpd2 = 0.6 * 0.6;
                const relSettleAng2 = 2.0 * 2.0;
                const relSettleHold = 0.3;
                const REL_FORCE_FREEZE_SEC = 3.0;
                const forceFreeze = _gumReleasedTimer >= REL_FORCE_FREEZE_SEC;
                for (const gi of gumReleased) {
                  const b = gumBodies[gi];
                  if (b.type === CANNON.Body.DYNAMIC) {
                    b.linearDamping = 0.92;
                    b.angularDamping = 0.90;
                  }
                }
                const toFreeze = [];
                for (const gi of gumReleased) {
                  const b = gumBodies[gi];
                  if (forceFreeze) {
                    toFreeze.push(gi);
                    continue;
                  }
                  if (b.sleepState === 2) {
                    toFreeze.push(gi);
                    continue;
                  }
                  if (b.type !== CANNON.Body.DYNAMIC) {
                    toFreeze.push(gi);
                    continue;
                  }
                  const v = b.velocity;
                  const av = b.angularVelocity;
                  const linSpd2 = v.x * v.x + v.y * v.y + v.z * v.z;
                  const angSpd2 = av.x * av.x + av.y * av.y + av.z * av.z;
                  if (linSpd2 < relSettleSpd2 && angSpd2 < relSettleAng2) {
                    if (!b._relSlowAccum) b._relSlowAccum = 0;
                    b._relSlowAccum += dt;
                    if (b._relSlowAccum >= relSettleHold) {
                      toFreeze.push(gi);
                    }
                  } else {
                    b._relSlowAccum = 0;
                  }
                }
                for (let fi = 0; fi < toFreeze.length; fi++) {
                  const gi = toFreeze[fi];
                  const b = gumBodies[gi];
                  if (b.type === CANNON.Body.DYNAMIC) {
                    b.velocity.set(0, 0, 0);
                    b.angularVelocity.set(0, 0, 0);
                    b.sleep();
                  }
                  b._relSlowAccum = 0;
                  gumReleased.delete(gi);
                }
                if (gumReleased.size === 0) {
                  _gumReleasedTimer = 0;
                }
              }
            }
          } else if (physicsStepDt > 0) {
            physicsWorld.step(1 / 60, physicsStepDt, 3);
          }

          let carOnTable = false;
          let carOnRampY = null;
          let carOnRampShouldJump = false;
          let frontWheelsOffRamp = false;
          const _allCarBodies = [
            canonFLBody, canonFRBody, canonRLBody, canonRRBody,
          ].filter(Boolean);
          for (let ci = 0; ci < physicsWorld.contacts.length; ci++) {
            const c = physicsWorld.contacts[ci];
            const bi = c.bi,
              bj = c.bj;
            if (
              tablePlateBody &&
              (bi === tablePlateBody || bj === tablePlateBody)
            ) {
              const other = bi === tablePlateBody ? bj : bi;
              if (_allCarBodies.includes(other)) {
                carOnTable = true;
              }
            }
            if (bottlePhysBody && (bi === bottlePhysBody || bj === bottlePhysBody)) {
              const other = bi === bottlePhysBody ? bj : bi;
              if (_allCarBodies.includes(other)) {
                if (bottlePhysBody._frozen) {
                  bottlePhysBody._frozen = false;
                  bottlePhysBody.allowSleep = false;
                }
              }
            }
            if (certifiedPhysBody && (bi === certifiedPhysBody || bj === certifiedPhysBody)) {
              const other = bi === certifiedPhysBody ? bj : bi;
              if (_allCarBodies.includes(other)) {
                if (certifiedPhysBody._frozen) {
                  certifiedPhysBody._frozen = false;
                  certifiedPhysBody.allowSleep = false;
                }
              }
            }
          }
          if (
            rampLeftObject &&
            car &&
            carState.velY <= 0
          ) {
            rampLeftObject.updateMatrixWorld(true);
            carRampRayOrigin.set(
              car.position.x,
              car.position.y + 1,
              car.position.z,
            );
            carRampRaycaster.set(carRampRayOrigin, carRampRayDir);
            const rampTargets = [rampLeftObject];
            const rampHits = carRampRaycaster.intersectObjects(
              rampTargets,
              true,
            );
            for (let h = 0; h < rampHits.length; h++) {
              const hit = rampHits[h];
              if (hit.distance > 2.5) continue;
              const onRamp =
                rampLeftObject && isDescendantOf(hit.object, rampLeftObject);
              if (!onRamp) continue;
              getRampHitWorldNormal(hit);
              const isDriveUpFace = _rampNormal.y >= RAMP_DRIVE_UP_NY_THRESHOLD;
              const rampEntryDir = rampLeftEntryDir;
              const carFwdX = Math.sin(carState.angle + carState.driftAngle);
              const carFwdZ = Math.cos(carState.angle + carState.driftAngle);
              const movingReverse = carState.speed < 0;
              const moveDirX = movingReverse ? -carFwdX : carFwdX;
              const moveDirZ = movingReverse ? -carFwdZ : carFwdZ;
              const entryDot = rampEntryDir
                ? moveDirX * rampEntryDir.x + moveDirZ * rampEntryDir.z
                : 0;
              const drivingUpRamp =
                rampEntryDir && entryDot >= RAMP_ENTRY_DOT_THRESHOLD;
              const oppositeSide =
                rampEntryDir && entryDot < RAMP_ENTRY_DOT_THRESHOLD;
              const faceIsBlockingSide =
                Math.abs(_rampNormal.z) >= RAMP_BLOCKING_FACE_Z_THRESHOLD;
              const shouldGetStuck =
                !isDriveUpFace || !drivingUpRamp || faceIsBlockingSide;
              if (shouldGetStuck) {
                carOnRampY = null;
                const faceTopY = getRampHitFaceTopY(hit);
                const carBottomY = car.position.y - carBottomOffsetY;
                const stepHeight = faceTopY - carBottomY;
                const maxStepClimb = MAX_STEP_CLIMB_RATIO * carBottomOffsetY;
                if (stepHeight > 0 && stepHeight <= maxStepClimb) {
                  car.position.y = faceTopY + carBottomOffsetY;
                  carState.velY = 0;
                } else {
                  carState.speed = 0;
                  const nx = _rampNormal.x,
                    nz = _rampNormal.z;
                  const len = Math.sqrt(nx * nx + nz * nz) || 1;
                  const pushBackMult =
                    oppositeSide || faceIsBlockingSide ? 1.6 : 1;
                  const push =
                    RAMP_SIDE_PUSH_BACK * storedCarScale * pushBackMult;
                  car.position.x += (nx / len) * push;
                  car.position.z += (nz / len) * push;
                }
                break;
              }
              if (_rampNormal.y < 0) _rampNormal.negate();
              carRampNormalStored.copy(_rampNormal);
              if (carOnRampY === null) carOnRampY = hit.point.y;
              if (Math.abs(carState.speed) >= CAR_RAMP_JUMP_MIN_SPEED) carOnRampShouldJump = true;
              break;
            }
            if (carOnRampY !== null && rampTargets.length > 0) {
              _carForward.set(
                Math.sin(carState.angle + carState.driftAngle),
                0,
                Math.cos(carState.angle + carState.driftAngle),
              );
              const halfLScale = halfL * storedCarScale;
              carRampRayFrontOrigin.set(
                car.position.x + _carForward.x * halfLScale,
                car.position.y + 1,
                car.position.z + _carForward.z * halfLScale,
              );
              carRampRayRearOrigin.set(
                car.position.x - _carForward.x * halfLScale,
                car.position.y + 1,
                car.position.z - _carForward.z * halfLScale,
              );
              carRampRaycaster.set(carRampRayFrontOrigin, carRampRayDir);
              const frontHits = carRampRaycaster.intersectObjects(
                rampTargets,
                true,
              );
              carRampRaycaster.set(carRampRayRearOrigin, carRampRayDir);
              const rearHits = carRampRaycaster.intersectObjects(
                rampTargets,
                true,
              );
              const frontOnRamp =
                frontHits.length > 0 &&
                frontHits[0].distance < 2.5 &&
                rampLeftObject &&
                isDescendantOf(frontHits[0].object, rampLeftObject);
              const rearOnRamp =
                rearHits.length > 0 &&
                rearHits[0].distance < 2.5 &&
                rampLeftObject &&
                isDescendantOf(rearHits[0].object, rampLeftObject);
              frontWheelsOffRamp = !frontOnRamp && rearOnRamp;
            }
          }
          if (
            rampLeftObject &&
            car &&
            carState.speed !== 0 &&
            carState.velY <= 0
          ) {
            const fwdX = Math.sin(carState.angle + carState.driftAngle);
            const fwdZ = Math.cos(carState.angle + carState.driftAngle);
            const moveSign = carState.speed > 0 ? 1 : -1;
            _wallRayDir.set(fwdX * moveSign, 0, fwdZ * moveSign).normalize();
            const wallProbeHeight = car.position.y;
            carRampWallRaycaster.set(
              new THREE.Vector3(
                car.position.x,
                wallProbeHeight,
                car.position.z,
              ),
              _wallRayDir,
            );
            carRampWallRaycaster.far = halfL * storedCarScale + 0.15;
            const wallHits = carRampWallRaycaster.intersectObject(
              rampLeftObject,
              true,
            );
            if (wallHits.length > 0) {
              const wh = wallHits[0];
              const wn = wh.face
                ? wh.face.normal
                    .clone()
                    .transformDirection(wh.object.matrixWorld)
                    .normalize()
                : null;
              if (wn) {
                const isVerticalWall = Math.abs(wn.y) < 0.3;
                const wallEntryDot = rampLeftEntryDir
                  ? wn.x * rampLeftEntryDir.x + wn.z * rampLeftEntryDir.z
                  : 0;
                const isEntryFace = wallEntryDot > 0.5;
                if (isVerticalWall && !isEntryFace) {
                  carState.speed = 0;
                  const pushDist = RAMP_SIDE_PUSH_BACK * storedCarScale;
                  car.position.x += wn.x * pushDist;
                  car.position.z += wn.z * pushDist;
                }
              }
            }
          }
          _carForward.set(
            Math.sin(carState.angle + carState.driftAngle),
            0,
            Math.cos(carState.angle + carState.driftAngle),
          );
          const nowOnRamp = carOnRampY !== null;
          if (wasOnRamp && !nowOnRamp && carState.velY <= 0) {
            const leaveSpeed = Math.abs(carState.speed);
            if (leaveSpeed >= CAR_RAMP_JUMP_MIN_SPEED) {
              carState.velY = leaveSpeed * CAR_RAMP_JUMP_MULTIPLIER;
              _rampLeftJumpActive = true;
              const jumpSpeedT = THREE.MathUtils.clamp(
                (leaveSpeed - CAR_RAMP_JUMP_MIN_SPEED) /
                  Math.max(
                    0.01,
                    carState.maxSpeed - CAR_RAMP_JUMP_MIN_SPEED,
                  ),
                0,
                1,
              );
              const slowMoRoll =
                RAMP_JUMP_SLOW_MO_CHANCE +
                (RAMP_JUMP_SLOW_MO_CHANCE_MAX - RAMP_JUMP_SLOW_MO_CHANCE) *
                  jumpSpeedT;
              if (
                Math.random() < slowMoRoll &&
                isCarCameraOrbitDefault()
              ) {
                snapshotCarOrbitCamRestPose();
                rollRampJumpSlowMoCameraDrift();
                _rampJumpDidSlowMo = true;
                _rampJumpMatrixActive = false;
                _rampJumpFxBlend = 0;
                _rampJumpFxIn = 0;
                _rampJumpCamRestOffset.set(0, 0, 0);
                startFlameWaveEffect(nowSec, true);
                if (Math.random() < RAMP_JUMP_MATRIX_CHANCE) {
                  getCarCameraOffsetFromPosition(carCamera, _carCamOffset);
                  clampCarCameraOffsetInPlace(_carCamOffset);
                  _carCam1PreMatrixOffset.copy(_carCamOffset);
                  _carCam1ReturnTargetOffset.copy(_carCam1PreMatrixOffset);
                  _carCam1RestDistance = _carCam1OrbitDistSnapshot;
                  _rampJumpMatrixActive = true;
                  _rampJumpMatrixOrbitProgress = 0;
                  _carCam1MatrixOrbitSettled = false;
                  _rampJumpCamRestOffset.copy(_carCam1PreMatrixOffset);
                  rollRampJumpMatrixCameraStyle();
                  captureRampJumpMatrixCameraBasis();
                  _carCam1MatrixReturnActive = false;
                  _carCam1MatrixReturnT = 0;
                  _carCam1PreserveView = true;
                  _carCam1JumpEffect = 1;
                  _rampJumpFxIn = 1;
                  _rampJumpFxBlend = 1;
                }
              }
            } else {
              if (carState.velY === 0) carState.velY = -0.5;
            }
            jumpStartTime = nowSec;
            jumpInitialVelY = Math.max(0, carState.velY);
            _rampJumpSimAirTime = 0;
            jumpLaunchUp.copy(carUpLerp);
            jumpLaunchSpeed = leaveSpeed;
          }
          wasOnRamp = nowOnRamp;
          if (
            (carOnTable || nowOnRamp) &&
            carState.velY <= 0 &&
            !_rampLeftJumpActive
          ) {
            carState.velY = 0;
          }
          const speedFactor = Math.min(
            1,
            Math.abs(carState.speed) / Math.max(0.01, carState.maxSpeed),
          );
          const tiltLerpFactor =
            TILT_SPEED_MIN_LERP +
            (TILT_SPEED_MAX_LERP - TILT_SPEED_MIN_LERP) * speedFactor;
          let targetUp = carOnRampY !== null ? carRampNormalStored : _flatUp;
          if (
            carOnRampY === null &&
            carState.velY === 0 &&
            _carSurfRange > CAR_STEP_SURF_DELTA_MIN
          ) {
            computeCarGroundNormalFromWheels(_stepTiltUp);
            targetUp = _stepTiltUp;
          }
          if (carOnRampY !== null && frontWheelsOffRamp) {
            targetUp = carRampNormalStored
              .clone()
              .addScaledVector(_carForward, -RAMP_EXIT_LEAN_AMOUNT)
              .normalize();
          }
          if (carState.velY !== 0) {
            const fx = Math.sin(carState.angle + carState.driftAngle);
            const fz = Math.cos(carState.angle + carState.driftAngle);
            const hSpeed = Math.max(1, Math.abs(carState.speed));
            const pitchAngle = Math.atan2(carState.velY, hSpeed * 8);
            const sinP = Math.sin(pitchAngle);
            const cosP = Math.cos(pitchAngle);
            targetUp = new THREE.Vector3(-sinP * fx, cosP, -sinP * fz).normalize();
          }
          if (carState.velY !== 0) wasInAir = true;
          const onGround =
            carState.velY === 0 &&
            (carOnTable || carOnRampY !== null || _rampLeftJumpActive);
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
              _rampJumpDidSlowMo ||
              _rampJumpMatrixActive ||
              _carCam1MatrixReturnActive ||
              _rampJumpCamRestOffset.lengthSq() > 1e-6;
            if (hadJumpCamFx) {
              beginCarCam1ReturnToRest();
            }
            _rampJumpMatrixActive = false;
            _rampJumpMatrixOrbitProgress = 0;
            _carCam1MatrixOrbitSettled = false;
            _rampJumpDidSlowMo = false;
            _rampJumpSimAirTime = 0;
            _jumpFlameWaveLoopActive = false;
            flameEffectsVisible = false;
          }
          const inLandingRecovery = onGround && nowSec < landingRecoveryUntil;
          const rampTiltLerp = CAR_RAMP_TILT_LERP * tiltLerpFactor;
          const stepTiltLerp = CAR_STEP_TILT_LERP * tiltLerpFactor;
          const onStepTransition =
            carOnRampY === null &&
            carState.velY === 0 &&
            _carSurfRange > CAR_STEP_SURF_DELTA_MIN;
          const airTiltLerp = 5 + 5 * Math.min(1, jumpLaunchSpeed / Math.max(0.01, carState.maxSpeed));
          const groundTiltLerp = inLandingRecovery
            ? LANDING_TILT_LERP
            : onStepTransition
              ? stepTiltLerp
              : rampTiltLerp;
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
          _carForward.set(
            Math.sin(carState.angle + carState.driftAngle),
            0,
            Math.cos(carState.angle + carState.driftAngle),
          );
          if (carOnTable && carState.velY <= 0) {
            if (_carGroundSurfY <= tableSurfaceY + 0.01) {
              car.position.y = tableSpawn.y;
            }
            carState.velY = 0;
          }
          if (carOnRampY !== null && carState.velY <= 0) {
            car.position.y = Math.max(
              tableSpawn.y,
              carOnRampY +
                carWheelBottomOffsetY * storedCarScale +
                RAMP_SURFACE_CLEARANCE,
            );
            carState.velY = 0;
          }
          lightBlend +=
            (lightBlendTarget - lightBlend) *
            Math.min(1, dt / LIGHT_FADE_DURATION);
          applyLightBlend(lightBlend);
          if (lightBlend > LIGHT_BLEND_TRIS_BRIGHT_THRESHOLD) {
            const targetBlend = compactSpacingActive ? 1 : 0;
            const elapsed = nowSec - compactSpacingAnimStart;
            const t = Math.min(1, elapsed / COMPACT_SPACING_ANIM_DURATION);
            compactSpacingBlend =
              compactSpacingAnimFrom +
              (targetBlend - compactSpacingAnimFrom) * t;
          }
          for (let i = 0; i < windowTrisMeshes.length; i++) {
            windowTrisMeshes[i].rotation.x =
              (1 - lightBlend) * WINDOW_TRIS_DARK_ROTATION_X;
            if (
              lightBlend > LIGHT_BLEND_TRIS_BRIGHT_THRESHOLD &&
              windowTrisSlotIndices.length === windowTrisMeshes.length
            ) {
              const spacing =
                WINDOW_TRIS_SPACING +
                (WINDOW_TRIS_COMPACT_SPACING - WINDOW_TRIS_SPACING) *
                  compactSpacingBlend;
              windowTrisMeshes[i].position.y =
                windowTrisBaseYs[i] - windowTrisSlotIndices[i] * spacing;
            }
          }
          if (phoneChargerCupMesh) {
            phoneChargerCupMesh.getWorldPosition(chargerCupWorldPos);
            const cupX = chargerCupWorldPos.x,
              cupZ = chargerCupWorldPos.z;
            const dx = car.position.x - cupX,
              dz = car.position.z - cupZ;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const touching = dist < CHARGER_TOUCH_RADIUS;
            chargerFlameFade += (touching ? 1 : -1) * CHARGER_FADE_SPEED * dt;
            chargerFlameFade = Math.max(0, Math.min(1, chargerFlameFade));
            chargerParticles.visible = chargerFlameFade > 0.01;
            chargerParticleMat.uniforms.uFade.value = chargerFlameFade;
            const chargerFxActive = touching || chargerFlameFade > 0.01;
            let updateChargerParticles = chargerFxActive;
            if (updateChargerParticles && perfChargerEvery > 1) {
              _perfChargerFrame++;
              if (_perfChargerFrame % perfChargerEvery !== 0) {
                updateChargerParticles = false;
              }
            }
            if (updateChargerParticles) {
              chargerCupWorldPos.y += CHARGER_EFFECT_ABOVE_CUP;
              chargerParticles.position.copy(chargerCupWorldPos);
              chargerParticleMat.uniforms.uTime.value = clock.getElapsedTime();
              const posAttr = chargerParticleGeo.attributes.position;
              const RISE_SPEED = 2.2;
              for (let i = 0; i < CHARGER_PARTICLE_COUNT; i++) {
                const speed = RISE_SPEED * chargerParticleRiseSpeed[i];
                chargerParticleRise[i] += dt * speed;
                if (chargerParticleRise[i] > 1)
                  chargerParticleRise[i] -= 0.002 * (Math.random() - 0.5);
                if (chargerParticleRise[i] > 1) chargerParticleRise[i] -= 1;
                if (chargerParticleRise[i] < 0) chargerParticleRise[i] += 1;
                const sizeScale = chargerParticleSizeScale[i];
                const heightBoost = (2.05 - sizeScale) * 0.85;
                const maxH =
                  (2.4 + heightBoost) *
                  chargerParticleMaxHeight[i] *
                  chargerParticleHeightTail[i];
                const y = chargerParticleRise[i] * maxH;
                const yNorm = maxH > 0.001 ? y / maxH : 0.0;
                const flameShape = 0.62 + 1.45 * 4 * yNorm * (1 - yNorm);
                const drift = yNorm * (1.55 - yNorm * 0.42);
                posAttr.array[i * 3] =
                  chargerParticleSpread[i * 2] * flameShape +
                  chargerParticleDriftX[i] * drift;
                posAttr.array[i * 3 + 1] = y;
                posAttr.array[i * 3 + 2] =
                  chargerParticleSpread[i * 2 + 1] * flameShape +
                  chargerParticleDriftZ[i] * drift;
              }
              posAttr.needsUpdate = true;
            }
            chargerPointLight.intensity = chargerFlameFade * 25;
            chargerPointLight.position.copy(chargerCupWorldPos);
            chargerPointLight.position.y += 1.2;
          }

          const flameDelayS = FLAME_WAVE_DELAY_MS / 1000;
          const flameDurationS = FLAME_EFFECT_DURATION_MS / 1000;
          const slowMoJumpExhaust =
            _rampJumpDidSlowMo &&
            isCarCameraOrbitDefault() &&
            (Math.abs(carState.velY) > 0.02 || _rampJumpFxBlend > 0.05);
          if (flameEffectsVisible) {
            const flameElapsed = nowSec - flameWaveStartTime;
            const deskWaveEnd =
              Math.max(0, flameEffects.length - 1) * flameDelayS + flameDurationS;
            if (_jumpFlameWaveLoopActive) {
              if (carState.velY === 0) {
                _jumpFlameWaveLoopActive = false;
                flameEffectsVisible = false;
              } else if (flameElapsed >= deskWaveEnd) {
                restartFlameWave(nowSec);
              }
            } else if (flameElapsed >= deskWaveEnd) {
              flameEffectsVisible = false;
            }
            const waveElapsed = nowSec - flameWaveStartTime;
            if (camera === carCamera) {
              const flameAnimTime = clock.getElapsedTime();
              for (let f = 0; f < flameEffects.length; f++) {
                const ef = flameEffects[f];
                const startAt = f * flameDelayS;
                const endAt = startAt + flameDurationS;
                const showThis =
                  waveElapsed >= startAt && waveElapsed < endAt;
                ef.points.visible = showThis;
                ef.trailPoints.visible = showThis;
                ef.trailPoints2.visible = showThis;
                ef.trailPoints3.visible = showThis;
                if (showThis) {
                  getDeskFlameAnchorPosition(ef.flameMesh, _deskFlamePos);
                  const pegHalfH = ef.flameAnchorHalfHeight || 0;
                  const localProgress = (waveElapsed - startAt) / flameDurationS;
                  const risePhase = 0.25;
                  const easeIn = Math.min(
                    1,
                    (localProgress / risePhase) * (localProgress / risePhase),
                  );
                  const stretchY = 1 + (1 - easeIn) * 2.1;
                  const fadeStart = 0.18;
                  const fadeOut = Math.min(
                    1,
                    Math.max(
                      0,
                      1 - (localProgress - fadeStart) / (1 - fadeStart),
                    ) * JUMP_FLAME_FADE_BOOST,
                  );
                  ef.points.material.uniforms.uFade.value = fadeOut;
                  _deskFlamePos.y +=
                    JUMP_FLAME_ABOVE -
                    pegHalfH +
                    easeIn * JUMP_FLAME_RISE_DISTANCE;
                  ef.points.position.copy(_deskFlamePos);
                  ef.trailPoints.position.copy(_deskFlamePos);
                  ef.trailPoints.position.y -= 0.7;
                  ef.trailPoints.material.uniforms.uFade.value = fadeOut * 0.58;
                  ef.trailPoints2.position.copy(_deskFlamePos);
                  ef.trailPoints2.position.y -= 1.5;
                  ef.trailPoints2.material.uniforms.uFade.value = fadeOut * 0.34;
                  ef.trailPoints3.position.copy(_deskFlamePos);
                  ef.trailPoints3.position.y -= 2.3;
                  ef.trailPoints3.material.uniforms.uFade.value = fadeOut * 0.22;
                  ef.points.material.uniforms.uTime.value = flameAnimTime;
                  ef.trailPoints.material.uniforms.uTime.value = flameAnimTime;
                  ef.trailPoints2.material.uniforms.uTime.value = flameAnimTime;
                  ef.trailPoints3.material.uniforms.uTime.value = flameAnimTime;
                  for (let i = 0; i < ef.count; i++) {
                    ef.rise[i] += dt * JUMP_FLAME_RISE_SPEED;
                    if (ef.rise[i] > 1) ef.rise[i] -= 1;
                    const y = ef.rise[i] * 1.35 * stretchY;
                    ef.posAttr.array[i * 3] = ef.spread[i * 2];
                    ef.posAttr.array[i * 3 + 1] = y;
                    ef.posAttr.array[i * 3 + 2] = ef.spread[i * 2 + 1];
                  }
                  ef.posAttr.needsUpdate = true;
                }
              }
            }
          } else if (!_deskFlamesWereHidden) {
            for (let f = 0; f < flameEffects.length; f++) {
              const ef = flameEffects[f];
              ef.points.visible = false;
              ef.trailPoints.visible = false;
              ef.trailPoints2.visible = false;
              ef.trailPoints3.visible = false;
            }
            _deskFlamesWereHidden = true;
          }

          const carMoving = Math.abs(carState.speed) > 0.3;
          if (carMoving && _carWasStopped) {
            exhaustActive = true;
            exhaustStartTime = nowSec;
          }
          if (slowMoJumpExhaust) {
            exhaustActive = true;
            exhaustStartTime = nowSec - 0.06;
          }
          _carWasStopped = !carMoving;

          if (exhaustEffects.length > 0) {
            const exhaustElapsed = nowSec - exhaustStartTime;
            const exhaustShow =
              (exhaustActive && exhaustElapsed < EXHAUST_DURATION) ||
              slowMoJumpExhaust;
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
                  ef.rise[i] += dt * EXHAUST_FLAME_RISE_SPEED;
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

          drawLeftScreenVideo();
          drawRightScreenVideo();
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

          if (floorPhysBody) {
            const floorBottom = floorPhysBody.position.y - floorPhysBody.shapes[0].halfExtents.y;
            const clampBodies = [
              bottlePhysBody, certifiedPhysBody, gumDispenserPhysBody,
              dockingStationPhysBody, plantVasePhysBody, macScreenFramePhysBody,
              macBodyBasePhysBody, mainScreensPinPhysBody, mainScreensBasePhysBody,
              conusPhysBody,
            ].filter(Boolean);
            for (const b of clampBodies) {
              if (b.type !== CANNON.Body.DYNAMIC && b.type !== CANNON.Body.KINEMATIC) continue;
              if (b.position.y < floorBottom) {
                const floorTop = floorPhysBody.position.y + floorPhysBody.shapes[0].halfExtents.y;
                const he = b.shapes[0] ? getShapeHalfExtents(b.shapes[0]) : null;
                b.position.y = floorTop + (he ? Math.min(he.x, he.y, he.z) : 0.1);
                b.velocity.set(0, 0, 0);
                b.angularVelocity.set(0, 0, 0);
              }
            }
            for (let gi = 0; gi < gumsAddedCount; gi++) {
              const gb = gumBodies[gi];
              if (gb.type !== CANNON.Body.DYNAMIC) continue;
              if (gb.position.y < floorBottom) {
                const floorTop = floorPhysBody.position.y + floorPhysBody.shapes[0].halfExtents.y;
                gb.position.y = floorTop + gumRadiusGlobal;
                gb.velocity.set(0, 0, 0);
              }
            }
          }
          if (tablePlateBody) {
            const tpHe = tablePlateBody.shapes[0].halfExtents;
            const tableTop = tablePlateBody.position.y + tpHe.y;
            const tableClampBodies = [
              bottlePhysBody, certifiedPhysBody, gumDispenserPhysBody,
              dockingStationPhysBody, plantVasePhysBody, macScreenFramePhysBody,
              macBodyBasePhysBody, mainScreensPinPhysBody, mainScreensBasePhysBody,
              conusPhysBody,
            ].filter(Boolean);
            for (const b of tableClampBodies) {
              if (b.type !== CANNON.Body.DYNAMIC) continue;
              if (b._frozen) continue;
              if (b.sleepState === CANNON.Body.SLEEPING) continue;
              const overTableX = Math.abs(b.position.x - tablePlateBody.position.x) < tpHe.x;
              const overTableZ = Math.abs(b.position.z - tablePlateBody.position.z) < tpHe.z;
              if (!overTableX || !overTableZ) continue;
              const he = b.shapes[0] ? getShapeHalfExtents(b.shapes[0]) : null;
              if (!he) continue;
              const minHalf = Math.min(he.x, he.y, he.z);
              const sinkThreshold = tableTop + minHalf * 0.3;
              if (b.position.y < sinkThreshold) {
                b.position.y = sinkThreshold;
                b.velocity.set(0, 0, 0);
                b.angularVelocity.set(0, 0, 0);
              }
            }
          }

          if (physicsStepDt > 0) {
            syncBottleFromPhysics();
            syncCertifiedFromPhysics();
            syncGumDispenserFromPhysics();
            syncAllPropsFromPhysics();
            syncConusFromPhysics();
          }
          const _dispenserMoving = _gumDispenserBecameDynamic && gumDispenserPhysBody && !gumDispenserPhysBody._frozen;
          const _skipGumInstSync =
            gumsAddedCount > 0 &&
            gumTankAllStaticThisFrame &&
            _gumPrevFrameTankAllStatic &&
            !_dispenserMoving;
          if (!_skipGumInstSync) syncGumInstancedTransforms();
          _gumPrevFrameTankAllStatic = gumTankAllStaticThisFrame;

          if (car) {
            carShadowLight.position.set(
              car.position.x + 3,
              car.position.y + 20,
              car.position.z + 2,
            );
            carShadowLight.target.position.copy(car.position);
            carShadowLight.target.updateMatrixWorld();
            carShadowLight.shadow.camera.updateProjectionMatrix();
          }

          if (airPlaneModel && !airPlaneFlight.pathBuilt) buildAirPlanePath();
          let updateAirPlane = airPlaneModel && airPlaneFlight.totalLen > 0;
          if (updateAirPlane && perfAirPlaneEvery > 1) {
            _perfAirPlaneFrame++;
            if (_perfAirPlaneFrame % perfAirPlaneEvery !== 0) {
              updateAirPlane = false;
            }
          }
          if (updateAirPlane) {
            const fl = airPlaneFlight;
            const ySpd = fl.climbPitch !== undefined ? Math.abs((fl.yOffset - (fl._prevYOffset || fl.yOffset))) / Math.max(dt, 0.001) : 0;
            fl._prevYOffset = fl.yOffset;
            if (fl.speedVar === undefined) { fl.speedVar = 0; fl.speedTarget = 0; fl.speedTimer = 0; }
            fl.speedTimer += dt;
            if (fl.speedTimer > 2 + Math.random() * 3) {
              fl.speedTarget = (Math.random() - 0.5) * 3;
              fl.speedTimer = 0;
            }
            fl.speedVar += (fl.speedTarget - fl.speedVar) * dt * 1.5;
            const curSpeed = fl.speed + fl.speedVar;
            const hSpd = Math.sqrt(Math.max(curSpeed * curSpeed - ySpd * ySpd, 1));
            fl.t += hSpd * dt;
            if (fl.t >= fl.totalLen) fl.t -= fl.totalLen;
            if (fl.t < 0) fl.t += fl.totalLen;

            let rem = fl.t;
            let seg = fl.segments[0];
            let segIdx = 0;
            for (let i = 0; i < fl.segments.length; i++) {
              if (rem <= fl.segments[i].len) { seg = fl.segments[i]; segIdx = i; break; }
              rem -= fl.segments[i].len;
            }

            fl.yTimer += dt;
            if (fl.yTimer >= fl.yDuration) {
              fl.yTarget = 0.5 + Math.random() * 3;
              fl.yDuration = 1.5 + Math.random() * 2.5;
              fl.yTimer = 0;
              fl.yStart = fl.yOffset;
            }
            if (fl.yStart === undefined) fl.yStart = fl.yOffset;
            const prevY = fl.yOffset;
            if (seg.type === "straight") {
              const yProgress = Math.min(fl.yTimer / fl.yDuration, 1);
              const yEase = yProgress < 0.5
                ? 4 * yProgress * yProgress * yProgress
                : 1 - Math.pow(-2 * yProgress + 2, 3) / 2;
              fl.yOffset = fl.yStart + (fl.yTarget - fl.yStart) * yEase;
            }
            const yVel = (fl.yOffset - prevY) / Math.max(dt, 0.001);

            let px, pz, dirX, dirZ, turnAmount;
            const TURN_PITCH = 40 * Math.PI / 180;
            const TURN_BANK = 0.2;
            const BLEND_ZONE = 3.0;
            if (seg.type === "straight") {
              const frac = rem / seg.len;
              const drift = Math.sin(fl.t * 0.7) * 0.4 + Math.sin(fl.t * 1.3) * 0.2;
              const driftFade = Math.sin(frac * Math.PI);
              const perpX = -seg.dz;
              const perpZ = seg.dx;
              px = seg.sx + (seg.ex - seg.sx) * frac + perpX * drift * driftFade;
              pz = seg.sz + (seg.ez - seg.sz) * frac + perpZ * drift * driftFade;
              dirX = seg.dx;
              dirZ = seg.dz;
              const distFromEnd = seg.len - rem;
              const distFromStart = rem;
              const nextArc = fl.segments[(segIdx + 1) % fl.segments.length];
              const prevArc = fl.segments[(segIdx - 1 + fl.segments.length) % fl.segments.length];
              if (distFromEnd < BLEND_ZONE && nextArc.type === "arc") {
                const t = 1 - distFromEnd / BLEND_ZONE;
                const e = t * t * (3 - 2 * t);
                const sign = nextArc.turnSign || (nextArc.sweep > 0 ? -1 : 1);
                turnAmount = e * 0.3 * sign;
              } else if (distFromStart < BLEND_ZONE && prevArc.type === "arc") {
                const t = 1 - distFromStart / BLEND_ZONE;
                const e = t * t * (3 - 2 * t);
                const sign = prevArc.turnSign || (prevArc.sweep > 0 ? -1 : 1);
                turnAmount = e * 0.3 * sign;
              } else {
                turnAmount = 0;
              }
            } else {
              const frac = rem / seg.len;
              const angle = seg.startAngle + seg.sweep * frac;
              px = seg.cx + Math.cos(angle) * seg.r;
              pz = seg.cz + Math.sin(angle) * seg.r;
              const tangentSign = seg.sweep > 0 ? 1 : -1;
              dirX = -Math.sin(angle) * tangentSign;
              dirZ = Math.cos(angle) * tangentSign;
              const sign = seg.turnSign || (seg.sweep > 0 ? -1 : 1);
              const peak = 0.3 + 0.7 * Math.sin(frac * Math.PI);
              turnAmount = peak * sign;
            }

            const heading = Math.atan2(dirX, dirZ) + Math.PI / 2;
            if (fl.climbPitch === undefined) fl.climbPitch = 0;
            const climbTarget = -Math.atan2(yVel, fl.speed) * 0.8;
            fl.climbPitch += (climbTarget - fl.climbPitch) * dt * 2.0;

            const py = Math.max(fl.baseY + fl.yOffset, fl.baseY);
            airPlaneModel.position.set(px, py, pz);
            airPlaneModel.rotation.set(0, 0, 0);
            airPlaneModel.rotateY(heading);
            airPlaneModel.rotateX(turnAmount * -TURN_PITCH);
            airPlaneModel.rotateZ(turnAmount * TURN_BANK + fl.climbPitch);
          }

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
            if (_carCam1Shake) carCamera.position.addScaledVector(_carCam1Shake, 0.78);
            if (
              _carCam1LandShakeTime <= 0 &&
              !isCarCameraMatrixOrbitActive()
            ) {
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
          renderMacFrontCameraFeed();
          finalComposer.render();
        } catch (e) {
          console.error("Animate error:", e);
        }
      }
      animate();