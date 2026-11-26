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
import { emitOfficeSceneEvent } from "../game/officeSceneEvents.js";
import {
  createCinematicIntro,
  introEase,
  introEaseSine,
  introLerp,
} from "../game/cinematicIntro.js";
import { createCameraDrag } from "../game/cameraDrag.js";
import { createCarLighting } from "../game/carLighting.js";
import { createTouchDrive } from "../game/touch/touchDrive.js";
import { addThresholdBloom, BLOOM_EMISSIVE, BLOOM_WEIGHT_ALPHA_BASE, setBloomWeight } from "../game/thresholdBloom.js";
import { createPortalRing, PORTAL_RING_DEFAULTS } from "../game/portalRing.js";

const _OFFICE_BASE = `${import.meta.env.BASE_URL}office-scene-optimized/`;
function officeAsset(relativePath) {
  let p = String(relativePath);
  if (p.startsWith("./")) p = p.slice(2);
  return _OFFICE_BASE + p.split("/").map(encodeURIComponent).join("/");
}

let _officeSceneRendering = false;
let _officeSceneAnimationFrame = 0;


      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a1a1a);
      let _currentWorldModel = null;
      let _officeWorldRoot = null;
      let physicsWorld = null;
      let car = null;

      const carCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
      carCamera.position.set(2, 2, 2);
      let camera = carCamera;
      const CAR_CAM_AZIMUTH_LIMIT = THREE.MathUtils.degToRad(70);
      let _carOrbitCamDistance = 0;
      let _carOrbitCamWorldYaw = 0;
      let _carOrbitCamElev = 0;
      let _carCam1OrbitDistSnapshot = 0;
      let _carCam1OrbitElevSnapshot = 0;
      let _carCam1OrbitYawSnapshot = 0;
      const _carCamOffset = new THREE.Vector3();
      const _rampJumpCamRestOffset = new THREE.Vector3();
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

      function configureOrbitControlsForCarView(forCamera) {
        if (forCamera === carCamera && _carOrbitCamDistance > 1e-6) {
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
        const clampJumpCamera = shouldClampJumpCameraAboveTable();
        if (clampJumpCamera) {
          clampJumpCameraOffsetAboveTable(offset);
        }
        carCamera.position.copy(_carMatrixLookAt).add(offset);
        if (clampJumpCamera && carCamera.position.z < 0) {
          carCamera.position.z = 0;
        }
        applyCarCameraLookAtCar();
      }

      function shouldClampJumpCameraAboveTable() {
        return (
          car &&
          isCarCameraOrbitDefault() &&
          (_rampJumpMatrixActive || (_rampJumpDidSlowMo && carState.velY !== 0))
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
            _rampJumpMatrixOrbitSign * RAMP_JUMP_MATRIX_ORBIT * rotEase;
          buildMatrixOrbitCameraOffset(orbitAngle, orbitDist);
          _carCamOffset.add(
            applyRampJumpMatrixCameraDrift(
              _rampJumpMatrixOrbitProgress,
              orbitDist,
            ),
          );
          if (_carCamOffset.z < 0) _carCamOffset.z = 0;
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
          THREE.MathUtils.lerp(restDist, restDist * zoomT, _carCam1JumpEffect),
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
        _rampJumpMatrixPitchBias = THREE.MathUtils.lerp(
          0.06,
          0.28,
          Math.random(),
        );
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
        const spin = Math.sin(
          orbitProgress * Math.PI * 4 + _rampJumpSlowMoDriftPhase,
        );
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
        _carMatrixOrbitDist = Math.max(
          _rampJumpCamRestOffset.length(),
          minOrbit,
        );
        _carCamOffset.copy(_rampJumpCamRestOffset);
        const horizLen = Math.hypot(_carCamOffset.x, _carCamOffset.z);
        _rampJumpMatrixHorizDist = Math.max(horizLen, minOrbit * 0.85);
        _rampJumpMatrixHeightOff = _carCamOffset.y;
        _rampJumpMatrixStartAzimuth =
          -_rampJumpMatrixOrbitSign * RAMP_JUMP_MATRIX_FRONT_AZIMUTH;
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
        const azimuth = THREE.MathUtils.clamp(
          _rampJumpMatrixStartAzimuth + orbitAngle,
          -RAMP_JUMP_MATRIX_FRONT_AZIMUTH,
          RAMP_JUMP_MATRIX_FRONT_AZIMUTH,
        );
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

      function getRampJumpSlowMoScale() {
        if (!_rampJumpDidSlowMo || !isCarCameraOrbitDefault()) return 1;
        const matrixHang = _rampJumpMatrixActive && carState.velY !== 0;
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

      function placeCarViewCameras(lookAt, maxDim) {
        const zoom = 0.09;
        const rotLeft = 1.15;
        const c = Math.cos(rotLeft);
        const s = Math.sin(rotLeft);

        const camOffsetX = maxDim * zoom;
        const camOffsetYOrbit = maxDim * 0.6 * zoom;
        const camOffsetZ = maxDim * zoom;
        carCamera.position.set(
          lookAt.x + camOffsetX * c - camOffsetZ * s,
          lookAt.y + camOffsetYOrbit,
          lookAt.z + camOffsetX * s + camOffsetZ * c,
        );
        carCamera.lookAt(lookAt);
        syncCarOrbitCamAnglesFromPosition(carCamera);
      }
      const CAR_LIGHTS_BLOOM_LAYER = 11;
      const CAR_LIGHT_MESH_NAMES = new Set([
        "lightBar1",
        "frontLights",
        "rearLights",
        "mainRearBrakeLights",
      ]);
      const DESK_FLAME_LAYER = 12;
      const TABLE_WALL_SHADOW_LAYER = 13;
      const TABLE_TOP_SHADOW_LAYER = 14;
      carCamera.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
      carCamera.layers.enable(DESK_FLAME_LAYER);
      carCamera.layers.enable(TABLE_WALL_SHADOW_LAYER);
      carCamera.layers.enable(TABLE_TOP_SHADOW_LAYER);

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

      const VISUAL_PARITY_TIER = 2;

      function getScreenPixelCount() {
        const dpr = window.devicePixelRatio || 1;
        return Math.round(window.innerWidth * window.innerHeight * dpr * dpr);
      }

      function getRenderPixelRatio() {
        const dpr = window.devicePixelRatio || 1;
        return (
          Math.min(maxDevicePixelRatio, Math.max(1, dpr)) * perfResolutionScale
        );
      }

      const PERF_TIER_PRESETS = [
        {
          name: "low",
          maxDpr: 1.25,
          resolutionScale: 0.88,
          smaa: true,
          sharpen: false,
          bloom: false,
          shadows: true,
          shadowMapSize: 384,
          reflection: false,
          composerMsaa: 0,
          physicsIterations: 10,
          gumMaxSubFill: 2,
          gumMaxSubMixed: 2,
          gumMaxSubDynamic: 2,
          maxCarSteps: 1,
          macScreenScale: 0.65,
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
          name: "medium",
          maxDpr: 1.5,
          resolutionScale: 0.95,
          smaa: true,
          sharpen: false,
          bloom: false,
          shadows: true,
          shadowMapSize: 512,
          reflection: true,
          reflectionTex: 96,
          composerMsaa: 0,
          physicsIterations: 14,
          gumMaxSubFill: 3,
          gumMaxSubMixed: 3,
          gumMaxSubDynamic: 3,
          maxCarSteps: 1,
          macScreenScale: 0.8,
          anisotropyCap: 6,
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
          composerMsaa: 0,
          physicsIterations: 16,
          gumMaxSubFill: 4,
          gumMaxSubMixed: 4,
          gumMaxSubDynamic: 3,
          maxCarSteps: 1,
          macScreenScale: 0.9,
          anisotropyCap: 8,
          eyeTrackingEvery: 1,
          macFeedEvery: 1,
          screenVideoEvery: 2,
          airPlaneEvery: 2,
          chargerEvery: 2,
          shadowEvery: 1,
          physicsIdleCoalesce: true,
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
          gumMaxSubDynamic: 3,
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
          bloomScale: 1,
          carBloomStrength: 0.35,
          carBloomThreshold: 0.11,
          carBloomMixIntensity: 0.38,
          carBloomRadius: 0.85,
          carBloomSmoothWidth: 0.22,
          carLightEmissiveScale: 0.32,
          carLightMainEmissiveScale: 0.06,
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
        if (isIntegratedGpu && /Mac/i.test(ua)) score -= 8;
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
        if (!isMobile && !isTablet) {
          tier = Math.max(tier, VISUAL_PARITY_TIER);
          const canUseHighDefaults =
            isDiscreteGpu ||
            isAppleSilicon ||
            (!isIntegratedGpu && score >= 50);
          if (canUseHighDefaults && score >= 58) tier = Math.max(tier, 3);
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
      let perfShadowEvery = perfSettings.shadowEvery;
      let perfBloomScale = perfSettings.bloomScale;
      let perfFpsEma = 60;
      let perfBadFpsFrames = 0;
      let perfBadgeHideTimer = 0;
      let _perfEyeFrame = 0;
      let _perfMacFeedFrame = 0;
      let _perfScreenVideoFrame = 0;
      let _perfAirPlaneFrame = 0;
      let _perfShadowFrame = 0;
      let _perfStarPlaceFrame = 0;
      let _wallShadowLightReady = false;
      let _physCoalesceDt = 0;
      let _tabVisible = !document.hidden;
      const perfBadgeEl = document.getElementById("perfBadge");

      function getBloomRenderScale() {
        return sceneBloomEnabled && perfBloomScale > 0 && perfBloomScale < 1
          ? perfBloomScale
          : 1;
      }

      function makeCarLightMaterial(params) {
        const mat = new THREE.MeshStandardMaterial({
          color: params.color,
          emissive: params.emissive ?? params.color,
          emissiveIntensity: params.emissiveIntensity,
          metalness: params.metalness ?? 0,
          roughness: params.roughness ?? 0.2,
          envMapIntensity: 0,
          toneMapped: true,
        });
        mat._isCarLightMaterial = true;
        mat._baseEmissiveIntensity = params.emissiveIntensity;
        return mat;
      }

      function applyCarLightMaterialTierSettings(mat) {
        if (!mat || !mat._isCarLightMaterial) return;
        const bloomScale = perfSettings.carLightEmissiveScale ?? 1;
        if (mat._baseEmissiveIntensity === undefined) {
          mat._baseEmissiveIntensity = mat.emissiveIntensity;
        }
        const mainMul = sceneBloomEnabled
          ? (perfSettings.carLightMainEmissiveScale ?? 0.06)
          : 1;
        mat._bloomEmissiveIntensity = mat._baseEmissiveIntensity * bloomScale;
        mat._mainEmissiveIntensity = mat._bloomEmissiveIntensity * mainMul;
        // The light bar keeps its glow above the shared bloom threshold in every tier.
        mat.emissiveIntensity = mat._bloomGlow ?? mat._bloomEmissiveIntensity;
        mat.envMapIntensity = 0;
        mat.toneMapped = true;
      }

      function setCarLightsEmissiveForMainPass(useMainPass) {
        if (!car) return;
        car.traverse((node) => {
          if (!node.isMesh || !CAR_LIGHT_MESH_NAMES.has(node.name)) return;
          const apply = (mat) => {
            if (!mat || !mat._isCarLightMaterial) return;
            mat.emissiveIntensity = useMainPass
              ? (mat._mainEmissiveIntensity ?? mat.emissiveIntensity)
              : (mat._bloomEmissiveIntensity ?? mat.emissiveIntensity);
          };
          if (node._brakeMat) apply(node._brakeMat);
          if (node._offMat) apply(node._offMat);
          const mats = Array.isArray(node.material)
            ? node.material
            : [node.material];
          for (let mi = 0; mi < mats.length; mi++) apply(mats[mi]);
        });
      }

      function getCarBloomMixIntensity() {
        return perfSettings.carBloomMixIntensity ?? SCENE_BLOOM_MIX_INTENSITY;
      }

      function applyCarLightsBloomTierSettings() {
        const strength = perfSettings.carBloomStrength ?? 3.0;
        const threshold = perfSettings.carBloomThreshold ?? 0.006;
        carLightsBloomPass.strength = strength;
        carLightsBloomPass.threshold = threshold;
        if (perfSettings.carBloomRadius != null) {
          carLightsBloomPass.radius = perfSettings.carBloomRadius;
        }
        if (perfSettings.carBloomSmoothWidth != null) {
          carLightsBloomPass.highPassUniforms.smoothWidth.value =
            perfSettings.carBloomSmoothWidth;
        }
      }

      function applyCarLightEmissiveForTier() {
        if (!car) return;
        car.traverse((node) => {
          if (!node.isMesh || !CAR_LIGHT_MESH_NAMES.has(node.name)) return;
          if (node._brakeMat) applyCarLightMaterialTierSettings(node._brakeMat);
          if (node._offMat) applyCarLightMaterialTierSettings(node._offMat);
          const mats = Array.isArray(node.material)
            ? node.material
            : [node.material];
          for (let mi = 0; mi < mats.length; mi++) {
            applyCarLightMaterialTierSettings(mats[mi]);
          }
        });
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
          `quality: ${perfSettings.name} ([ ] to change)\n` +
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
        perfShadowEvery = perfSettings.shadowEvery;
        perfBloomScale = perfSettings.bloomScale;
        applyShadowMapUpdatePolicy();
        const persistTier =
          reason === "keyboard" || reason === "manual" || reason === "";
        if (persistTier) {
          try {
            localStorage.setItem("officeScenePerfTier", String(perfTierIndex));
          } catch (_e) {}
        }
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
        if (perfTierIndex <= 0) return;
        setPerformanceTier(perfTierIndex - 1, reason);
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

      function applyShadowMapTypeForTier() {
        renderer.shadowMap.type =
          perfTierIndex >= 1 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      }

      /**
       * Never auto-update: autoUpdate redraws both shadow maps inside every renderer.render() (bloom, mac feed,
       * reflector ×2, main). syncSceneShadows() marks them dirty and the render section refreshes them once.
       */
      function applyShadowMapUpdatePolicy() {
        renderer.shadowMap.autoUpdate = false;
      }

      function markShadowMapsDirty() {
        if (!perfSettings.shadows) return;
        renderer.shadowMap.needsUpdate = true;
      }

      function isShadowSceneActive() {
        const carActive =
          car &&
          (Math.abs(carState.speed) > 0.12 ||
            carState.velY !== 0 ||
            keys.forward ||
            keys.reverse);
        const animActive =
          _handWalkZPhase !== 0 ||
          (_officeArmatureAction && _officeArmatureAction.isRunning());
        const dispenserActive =
          gumDispenserPhysBody && !gumDispenserPhysBody._frozen;
        return (
          carActive ||
          animActive ||
          dispenserActive ||
          !_gumPrevFrameTankAllStatic ||
          gumsReadyToDrop
        );
      }

      function shouldRefreshShadowMapsThisFrame() {
        if (!perfSettings.shadows) return false;
        _perfShadowFrame++;
        if (perfShadowEvery <= 1) return true;
        if (isShadowSceneActive()) return true;
        return _perfShadowFrame % perfShadowEvery === 0;
      }

      function syncSceneShadows() {
        if (!perfSettings.shadows) return;
        if (!_wallShadowLightReady) updateTableWallShadowLight();
        if (!shouldRefreshShadowMapsThisFrame()) return;
        updateTableShadowLight();
        markShadowMapsDirty();
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
        if (perfFpsEma < 24 && perfTierIndex > 1) {
          perfBadFpsFrames++;
          if (perfBadFpsFrames > 120) {
            downgradePerformanceTier(`~${Math.round(perfFpsEma)} fps`);
            perfBadFpsFrames = 0;
            perfFpsEma = 42;
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
        if (camera === carCamera) {
          _carCam1PreserveView = false;
          _carCam1MatrixReturnActive = false;
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
          if (!(obj.uuid in carBloomMaterialRestore))
            carBloomMaterialRestore[obj.uuid] = obj.material;
          obj.material = Array.isArray(obj.material)
            ? obj.material.map(() => darkBloomMaterial)
            : darkBloomMaterial;
        }
        for (i = 0; i < _bloomDarkenPoints.length; i++) {
          const obj = _bloomDarkenPoints[i];
          if (!(obj.uuid in carBloomMaterialRestore))
            carBloomMaterialRestore[obj.uuid] = obj.material;
          obj.material = darkBloomPointsMaterial;
        }
        for (i = 0; i < _bloomDarkenSprites.length; i++) {
          const obj = _bloomDarkenSprites[i];
          if (!(obj.uuid in carBloomMaterialRestore))
            carBloomMaterialRestore[obj.uuid] = obj.material;
          obj.material = darkBloomSpriteMaterial;
        }
        for (i = 0; i < _bloomDarkenLines.length; i++) {
          const obj = _bloomDarkenLines[i];
          if (!(obj.uuid in carBloomMaterialRestore))
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
      let _carBloomReady = false;

      /** Bloom mask: no ACES (emissive survives threshold). Black background so brightMode sky is not bloomed. */
      function renderCarLightsBloomComposer() {
        if (_bloomDarkenListsDirty) rebuildBloomDarkenObjectLists();
        const prevTm = renderer.toneMapping;
        const prevExp = renderer.toneMappingExposure;
        const prevBg = scene.background;
        scene.background = carBloomPassBackground;

        renderer.toneMapping = THREE.NoToneMapping;
        renderer.toneMappingExposure = 1;
        try {
          darkenCarBloomLists();
          bloomComposer.render();
        } finally {
          restoreCarBloomLists();
          scene.background = prevBg;
          renderer.toneMapping = prevTm;
          renderer.toneMappingExposure = prevExp;
        }
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
      // Selective bloom by threshold (shared with the kitchen): the light bar, the
      // monitors' LEDs and the screens' edges glow; nothing else crosses it.
      const officeBloom = addThresholdBloom({ THREE, composer: finalComposer, afterPass: renderScenePass });

      smaaPass.enabled = perfSettings.smaa;
      sharpenPass.enabled = false;
      sceneBloomEnabled = false;

      /** Composer RT needs stencil; optional MSAA on WebGL2. */
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

      // HDRI environment (image-based lighting + reflections; background stays dark/bright mode)
      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      pmremGenerator.compileEquirectangularShader();
      const rgbeLoader = new RGBELoader();
      function applySceneEnvironmentToMaterial(mat) {
        if (mat && scene.environment) mat.envMap = scene.environment;
      }

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
          if (car) {
            car.traverse((node) => {
              if (!node.isMesh || !node.material) return;
              const mats = Array.isArray(node.material)
                ? node.material
                : [node.material];
              for (let i = 0; i < mats.length; i++) {
                const mat = mats[i];
                if (mat && "envMap" in mat) mat.envMap = envMap;
              }
            });
          }
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

      // Drag the camera with the mouse (shared, cameraDrag.js): an offset round the car,
      // springing back on release; not during the intro or the ramp jump's camera.
      const _officeDragTarget = new THREE.Vector3();
      const officeCameraDrag = createCameraDrag({
        THREE,
        element: renderer.domElement,
        scene: "office",
        isEnabled: () =>
          _officeSceneRendering && officeIntro.state === "done" && !isCarCameraJumpEffectActive() && getRampJumpSlowMoScale() >= 1,
        collisionObjects: () => (_officeWorldRoot ? [_officeWorldRoot] : []),
        ignore: (obj) => {
          for (let x = obj; x; x = x.parent) if (x === car) return true;
          return false;
        },
      });
      controls.target.set(0, 0, 0);

      // ---- Gameplay camera (camera 1) ------------------------------------
      /** Camera 1's gameplay pose (orbit distance / elevation / yaw / fov), captured once the car is placed. */
      let _officeGameplayCam = null;
      /**
       * Puts camera 1 at its gameplay pose behind the car with fresh orbit
       * controls (no damping or follow smoothing left over). Used when the car
       * is placed, when the intro starts and when it hands over to gameplay.
       */
      function setupOfficeGameplayCamera() {
        if (!car) return;
        if (!_officeGameplayCam) {
          // Same as the first follow frame: yaw from where the load placed the camera.
          syncCarOrbitCamYawFromPosition();
          applyCarOrbitCameraFromAngles();
          _officeGameplayCam = {
            dist: _carOrbitCamDistance,
            elev: _carOrbitCamElev,
            yaw: _carOrbitCamWorldYaw,
            fov: carCamera.fov,
          };
        }
        _carOrbitCamDistance = _officeGameplayCam.dist;
        _carOrbitCamElev = _officeGameplayCam.elev;
        _carOrbitCamWorldYaw = _officeGameplayCam.yaw;
        if (carCamera.fov !== _officeGameplayCam.fov) {
          carCamera.fov = _officeGameplayCam.fov;
          carCamera.updateProjectionMatrix();
        }
        _carCam1LandShakeTime = 0;
        applyCarOrbitCameraFromAngles();
        const pos = _gameplayCamPos.copy(carCamera.position);
        controls.dispose();
        controls = createOrbitControls(carCamera);
        getCarCameraLookAtPoint(_carMatrixLookAt);
        controls.target.copy(_carMatrixLookAt);
        // Update first so the polar lock below reads this pose (a new control's angle is 0 until then).
        controls.update();
        configureOrbitControlsForCarView(carCamera);
        carCamera.position.copy(pos);
        applyCarCameraLookAtCar();
      }
      const _gameplayCamPos = new THREE.Vector3();

      // ---- Level intro (shared cinematicIntro module) ---------------------
      // Bright: a slow low dolly with a crane rise along the desk. Then a push-in
      // on the car with the window blinds behind it: the blinds close and the
      // room goes dark. Then (all in dark mode) musa, a move onto the green hand
      // (its flame lights up), the gum machine, and a low dramatic orbit around
      // the car that rises onto camera 1.
      /**
       * The last shot: one continuous move that orbits low around the car and,
       * without stopping, pulls back and up onto camera 1 (s). It replaces the
       * orbit (1.5 s) and the arrival (1.3 s), which were two moves with a stop
       * between them.
       */
      const OFFICE_INTRO_ORBIT_PULLBACK_SEC = 2.8;
            const OFFICE_INTRO_SHOTS = [
        { name: "opening", sec: 4.8 },
        { name: "blinds", sec: 2.8, fade: true },
        { name: "musaHand", sec: 4.5, fade: true },
        { name: "gums", sec: 1.4, fade: true },
        { name: "carOrbit", sec: OFFICE_INTRO_ORBIT_PULLBACK_SEC, fade: true },
      ];
      /**
       * Opening (bright): starts low just past the desk's left end, with the cone
       * at that corner passing close in front, and glides right while craning up
       * to reveal the desk. Positions along the desk's width (0..1; was 0.15 →
       * 0.6 over 3.4 s), height above its top (was 4.5 → 4.0), distance in front
       * of its front edge (was 7.6 → 6.5), the look point's track, and an FOV
       * and roll that settle as the shot ends.
       */
      const OFFICE_INTRO_OPENING = {
        fromX: -0.06, toX: 0.55,
        height: 1.3, heightEnd: 4.2,
        front: 5.2, frontEnd: 6.8,
        lookFromX: 0.14, lookToX: 0.75, lookY: 1.0, lookYEnd: 0.8,
        fov: 40, fovEnd: 48, roll: 0.045,
      };
      /** Space around an object framed from its bounding box (share of its size). */
      const OFFICE_INTRO_FRAME_MARGIN = 0.3;
      /**
       * musa → hand is one continuous camera move (4.5 s, was 4.2 s in two
       * moves): a Catmull-Rom path through musa's framing (farther back, with
       * OFFICE_INTRO_MUSA_START_MARGIN), the hand's framing, and a wider view
       * of the hand and its green flame, with one ease over the whole shot. The
       * look point follows a matching path from musa to the hand.
       */
      const OFFICE_INTRO_MUSA_START_MARGIN = 0.55;
      /** The green flame ends this long before the shot does, so it's off by the cut (s). */
      const OFFICE_INTRO_HAND_FX_END_SEC = 0.15;
      /** Area the hand's green flame covers around the hand's box (world units: to the sides, above). */
      const OFFICE_INTRO_HAND_FX_EXTENT = { side: 0.9, up: 1.8 };
      /** Framings seen from the desk's front side (`yaw`, radians), the camera a little above the centre (`rise` × distance). */
      const OFFICE_INTRO_MUSA_HAND = { yaw: 0.32, rise: 0.22, fov: 42 };
      /** Lights-out starts this long into the blinds shot (s). */
      const OFFICE_INTRO_DARK_SWITCH_DELAY = 0.35;
      /**
       * The whole switch to dark mode, as one transition (s): one shared
       * progress 0 → 1 (smootherstep) drives the blinds closing, the daylight
       * fading, the room's lights going down and the dark mode's accents and
       * glowing parts coming up, all together. (Was in steps: close 1.3 s, a
       * 0.15 s dim hold, then the accents over 0.5 s.)
       */
      const OFFICE_INTRO_DARK_SWITCH_SEC = 1.7;
      /** The exposure dips by this much at the middle of the switch (follows the same progress). */
      const OFFICE_INTRO_DARK_SWITCH_DIP = 0.25;
      /**
       * Blinds shot: the camera sits on the far side of the car from the
       * nearest window and pushes in from `dist` to `distEnd` (world units),
       * `height` / `heightEnd` above the car's centre and `side` / `sideEnd` to
       * its side (+ = to the right looking at the window). It always looks at
       * the centre of the real car's bounding box, so the car stays in the
       * middle of the frame with the blinds behind it. (It used to look at a
       * point 18% of the way to the window and 1.45 higher: the frame's centre
       * then fell on the Mac's screen, which shows the car's live feed.)
       */
      const OFFICE_INTRO_BLINDS = {
        dist: 4.6, distEnd: 3.7, height: 0.6, heightEnd: 0.45, side: 2.4, sideEnd: 2.0, fov: 58,
      };
      /**
       * Space around the whole car in the car shots (share of its size). The
       * camera never gets closer than the distance that fits the car's bounding
       * box at that shot's FOV, so the car is never cut off.
       */
      const OFFICE_INTRO_CAR_MARGIN = 0.22;
      /**
       * Gum machine: the same slow orbit and push-in as before (yaw / sweep,
       * radians), now at the distance that fits the whole machine in frame
       * (its bounding box + OFFICE_INTRO_FRAME_MARGIN); `push` is how much
       * closer it ends, `low` how far below the machine's centre the camera sits
       * (× its height). Was a fixed 5.6 → 5.0 radius, too close to read.
       */
      const OFFICE_INTRO_GUMS = { yaw: -0.85, sweep: -0.35, push: 0.07, low: 0.08, fov: 44 };
      /**
       * Orbit → pull-back (OFFICE_INTRO_ORBIT_PULLBACK_SEC), one ease over the
       * whole move: the camera starts low (`height` vs. the car's centre) at
       * `yawFrom` (radians, relative to camera 1's yaw) and `fit` × the
       * distance that frames the whole car, and turns steadily round to camera
       * 1's yaw. Its distance, height and fov move to camera 1's on a curve
       * that starts slowly (`pullCurve`: higher = the pull-back comes later),
       * so it mostly orbits first and then backs away, without stopping. It
       * looks at the car the whole time and ends exactly on camera 1.
       */
      const OFFICE_INTRO_CAR_ORBIT = { fit: 1.08, height: -0.1, yawFrom: 2.2, fov: 40, pullCurve: 1.8 };
      /** Longest step the intro clock takes per frame (s): a hitch slows it instead of skipping. */
      const OFFICE_INTRO_MAX_STEP = 1 / 20;
      /**
       * Warm-up behind the loader, each step held for OFFICE_READY_WARMUP_STEP_FRAMES
       * frames: the light sets of dark, the lights-out in-between and bright, and
       * the drawer portal on (dark and bright: the portal's own shaders). The
       * portal's light used to be added to the scene only when the drawer opened,
       * which recompiled every lit material at that moment (the freeze); it now
       * stays on the drawer at 0 while closed. The last step is bright, for the
       * intro's opening.
       */
      const OFFICE_READY_WARMUP = [
        { blend: 0 },
        { blend: 0.5 },
        { blend: 0, portal: true },
        { blend: 1, portal: true },
        { blend: 1 },
      ];
      const OFFICE_READY_WARMUP_STEP_FRAMES = 2;
      /** Frames rendered behind the loader before the scene reports ready. */
      const OFFICE_READY_WARMUP_FRAMES = OFFICE_READY_WARMUP.length * OFFICE_READY_WARMUP_STEP_FRAMES + 1;
      /** Seconds after the car loads to stop waiting for the gums to settle. */
      const OFFICE_READY_MAX_WAIT_SEC = 12;

      let _officeIntroRig = null;
      let _officeIntroDarkened = false;
      let _officeSceneReady = false;
      let _officeReadyFrames = 0;
      let _officeCarLoadedAt = 0;
      const _introBlindsLook = new THREE.Vector3();
      const _introBlindsAway = new THREE.Vector3();
      const _introArrivalTo = new THREE.Vector3();

      function buildOfficeIntroRig() {
        const box = (name) => {
          const o = scene.getObjectByName(name);
          return o ? new THREE.Box3().setFromObject(o) : null;
        };
        const table = box("tablePlate");
        const musa = box("musa001");
        const hand = box("handWalk");
        const gumsTank = box("gumsTank");
        const gumsStand = box("gumsStand");
        const gumsMachine = ["gumsTank", "gumsStand", "gumsBody", "gumsCup", "gumsRamp"]
          .map(box)
          .filter(Boolean)
          .reduce((acc, b) => (acc ? acc.union(b) : b.clone()), null);
        const top = table ? table.max.y : tableSurfaceY;
        const look = getCarCameraLookAtPoint(new THREE.Vector3());
        const gums = gumsTank && gumsStand ? gumsTank.clone().union(gumsStand) : null;
        // The window (with its blinds) nearest the car, horizontally.
        let blinds = null;
        let bestD = Infinity;
        scene.traverse((o) => {
          if (o.name !== "windowUnit") return;
          const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
          const d = Math.hypot(c.x - look.x, c.z - look.z);
          if (d < bestD) {
            bestD = d;
            blinds = c;
          }
        });
        return {
          blinds: blinds || look.clone().add(new THREE.Vector3(0, 4, -16)),
          top,
          minX: table ? table.min.x : look.x - 20,
          width: table ? table.max.x - table.min.x : 40,
          frontZ: table ? table.max.z : look.z + 5,
          midZ: table ? (table.min.z + table.max.z) / 2 : look.z - 3,
          musa: musa || new THREE.Box3().setFromCenterAndSize(look, new THREE.Vector3(2, 2, 2)),
          hand: hand || musa || new THREE.Box3().setFromCenterAndSize(look, new THREE.Vector3(2, 2, 2)),
          // The hand plus the space its green flame spreads into (sides and above).
          handWithFx: (() => {
            const b = (hand || musa || new THREE.Box3().setFromCenterAndSize(look, new THREE.Vector3(2, 2, 2))).clone();
            const x = OFFICE_INTRO_HAND_FX_EXTENT;
            b.min.x -= x.side;
            b.max.x += x.side;
            b.min.z -= x.side;
            b.max.z += x.side;
            b.max.y += x.up;
            return b;
          })(),
          gumsMachine,
          gumsBase: gums
            ? gums.getCenter(new THREE.Vector3()).setY(gums.min.y)
            : look.clone(),
          gumsHeight: gums ? gums.max.y - gums.min.y : 4,
        };
      }

      function officeIntroShotPose(i, u, out) {
        const rig = _officeIntroRig;
        const name = OFFICE_INTRO_SHOTS[i].name;
        if (name === "opening") {
          // A slow low dolly with a crane rise; FOV and roll settle at the end.
          const o = OFFICE_INTRO_OPENING;
          const e = introSmoother(u);
          out.pos.set(
            rig.minX + rig.width * introLerp(o.fromX, o.toX, e),
            rig.top + introLerp(o.height, o.heightEnd, e),
            rig.frontZ + introLerp(o.front, o.frontEnd, e),
          );
          out.look.set(
            rig.minX + rig.width * introLerp(o.lookFromX, o.lookToX, e),
            rig.top + introLerp(o.lookY, o.lookYEnd, e),
            rig.midZ,
          );
          out.fov = introLerp(o.fov, o.fovEnd, e);
          out.roll = o.roll * (1 - e);
          return out;
        }
        if (name === "blinds") {
          // The real car (the object the gameplay camera follows), kept in the centre
          // of the frame: the camera aims at its bounding box's centre every frame.
          const s = OFFICE_INTRO_BLINDS;
          const e = introEaseSine(u);
          const carBox = getCarBox(_introCarBox);
          const center = carBox.getCenter(_introBlindsLook);
          const away = _introBlindsAway.set(center.x - rig.blinds.x, 0, center.z - rig.blinds.z).normalize();
          // Right-hand side when facing the window from the camera.
          const sideX = away.z;
          const sideZ = -away.x;
          const dist = introLerp(s.dist, s.distEnd, e);
          const side = introLerp(s.side, s.sideEnd, e);
          out.pos.set(
            center.x + away.x * dist + sideX * side,
            center.y + introLerp(s.height, s.heightEnd, e),
            center.z + away.z * dist + sideZ * side,
          );
          // Never closer than the distance that fits the whole car.
          const fit = introFitDistance(carBox, s.fov, OFFICE_INTRO_CAR_MARGIN);
          const off = _introCarOff.subVectors(out.pos, center);
          if (off.length() < fit) {
            off.setLength(fit);
            out.pos.addVectors(center, off);
          }
          out.look.copy(center);
          out.fov = s.fov;
          out.roll = 0;
          return out;
        }
        if (name === "musaHand") {
          // One continuous move: musa → the hand → back out over the hand and its flame.
          const s = OFFICE_INTRO_MUSA_HAND;
          const path = getMusaHandPath();
          const sPos = introSmoother(u); // share of the path's length travelled
          path.pos.getPointAt(sPos, out.pos);
          path.look.getPoint(path.lookParam(sPos), out.look);
          out.fov = s.fov;
          out.roll = 0;
          return out;
        }
        if (name === "gums") {
          const s = OFFICE_INTRO_GUMS;
          const e = introEaseSine(u);
          const box = rig.gumsMachine;
          const c = box.getCenter(_introBlindsAway);
          const h = box.max.y - box.min.y;
          const d = introFitDistance(box, s.fov, OFFICE_INTRO_FRAME_MARGIN) * (1 - s.push * e);
          const yaw = s.yaw + s.sweep * e;
          out.pos.set(c.x + Math.sin(yaw) * d, c.y - h * s.low, c.z + Math.cos(yaw) * d);
          out.look.copy(c);
          out.fov = s.fov;
          out.roll = 0;
          return out;
        }
        // carOrbit: low around the car, then back and up onto camera 1, in one move.
        const s = OFFICE_INTRO_CAR_ORBIT;
        const e = introEase(u);
        const pull = Math.pow(e, s.pullCurve);
        const carBox = getCarBox(_introCarBox);
        const carC = carBox.getCenter(_introOrbitCarC);
        const endLook = getCarCameraLookAtPoint(_introOrbitEndLook);
        const toOff = _introArrivalTo.copy(carCamera.position).sub(endLook);
        const toDist = toOff.length();
        const toYaw = Math.atan2(toOff.x, toOff.z);
        const toElev = Math.asin(THREE.MathUtils.clamp(toOff.y / Math.max(toDist, 1e-6), -1, 1));
        const r0 = introFitDistance(carBox, s.fov, OFFICE_INTRO_CAR_MARGIN) * s.fit;
        const elev0 = Math.asin(THREE.MathUtils.clamp(s.height / r0, -1, 1));
        // Both the start and camera 1 are measured around the car; the look point slides onto camera 1's.
        const look = out.look.lerpVectors(carC, endLook, pull);
        const yaw = toYaw + s.yawFrom * (1 - e);
        const elev = introLerp(elev0, toElev, pull);
        const dist = introLerp(r0, toDist, pull);
        out.pos.set(
          look.x + Math.sin(yaw) * Math.cos(elev) * dist,
          look.y + Math.sin(elev) * dist,
          look.z + Math.cos(yaw) * Math.cos(elev) * dist,
        );
        if (u >= 1) out.pos.copy(carCamera.position);
        out.fov = introLerp(s.fov, carCamera.fov, pull);
        out.roll = 0;
        return out;
      }
      const _introOrbitCarC = new THREE.Vector3();
      const _introOrbitEndLook = new THREE.Vector3();

      /** Strong ease in and out (smootherstep). */
      function introSmoother(t) {
        const x = Math.min(1, Math.max(0, t));
        return x * x * x * (x * (x * 6 - 15) + 10);
      }
      const _fitSize = new THREE.Vector3();
      /** Distance from a box's centre that fits it in frame with the margin. */
      function introFitDistance(box, fovDeg, margin) {
        box.getSize(_fitSize);
        const halfV = THREE.MathUtils.degToRad(fovDeg) / 2;
        const halfH = Math.atan(Math.tan(halfV) * Math.max(0.3, carCamera.aspect || 1));
        const w = Math.max(_fitSize.x, _fitSize.z);
        const fitV = ((_fitSize.y / 2) * (1 + margin)) / Math.tan(halfV);
        const fitH = ((w / 2) * (1 + margin)) / Math.tan(halfH);
        return Math.max(fitV, fitH) + w / 2;
      }
      const _carMeshBox = new THREE.Box3();
      /** Bounding box of the real player's car (its meshes; the object the gameplay camera follows). */
      function getCarBox(out) {
        out.makeEmpty();
        car.updateMatrixWorld(true);
        car.traverse((o) => {
          if (!o.isMesh || !o.visible || !o.geometry) return;
          _carMeshBox.setFromObject(o);
          out.union(_carMeshBox);
        });
        if (out.isEmpty()) {
          getCarCameraLookAtPoint(_fitSize);
          out.setFromCenterAndSize(_fitSize, _carMeshBox.min.set(3, 2, 3));
        }
        return out;
      }
      const _introCarBox = new THREE.Box3();
      const _introCarOff = new THREE.Vector3();
      /** A pose looking at a box's centre from `yaw` (0 = from the desk's front), fitted with the margin. */
      function introFramePose(box, yaw, rise, fov, out, distScale = 1, margin = OFFICE_INTRO_FRAME_MARGIN) {
        const c = box.getCenter(_fitSize.clone());
        const d = introFitDistance(box, fov, margin) * distScale;
        out.pos.set(c.x + Math.sin(yaw) * d, c.y + d * rise, c.z + Math.cos(yaw) * d);
        out.look.copy(c);
        out.fov = fov;
        out.roll = 0;
        return out;
      }
      const _introPoseA = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50, roll: 0 };
      let _musaHandPath = null;
      /**
       * The musa → hand camera path (built once from their bounding boxes):
       * positions through the three framings, look points through musa, the
       * hand and the hand-with-flame centres, and when (share of the shot) the
       * camera passes the hand.
       */
      function getMusaHandPath() {
        if (_musaHandPath) return _musaHandPath;
        const rig = _officeIntroRig;
        const s = OFFICE_INTRO_MUSA_HAND;
        const a = introFramePose(rig.musa, s.yaw, s.rise, s.fov, { pos: new THREE.Vector3(), look: new THREE.Vector3() }, 1, OFFICE_INTRO_MUSA_START_MARGIN);
        const b = introFramePose(rig.hand, s.yaw, s.rise, s.fov, { pos: new THREE.Vector3(), look: new THREE.Vector3() });
        const c = introFramePose(rig.handWithFx, s.yaw, s.rise, s.fov, { pos: new THREE.Vector3(), look: new THREE.Vector3() });
        const pos = new THREE.CatmullRomCurve3([a.pos, b.pos, c.pos], false, "centripetal");
        const look = new THREE.CatmullRomCurve3([a.look, b.look, c.look], false, "centripetal");
        // Where the camera passes the hand along the path's length.
        const lengths = pos.getLengths(200);
        const total = lengths[lengths.length - 1] || 1;
        let s1 = 0.5;
        let best = Infinity;
        const tmp = new THREE.Vector3();
        for (let i = 0; i <= 200; i++) {
          pos.getPoint(i / 200, tmp);
          const d = tmp.distanceToSquared(b.pos);
          if (d < best) {
            best = d;
            s1 = lengths[i] / total;
          }
        }
        // A smooth map from path length to the look path, reaching the hand's centre at s1.
        const q = THREE.MathUtils.clamp((0.5 - s1) / (s1 * s1 - s1 || -1), -0.9, 0.9);
        const lookParam = (x) => THREE.MathUtils.clamp(q * x * x + (1 - q) * x, 0, 1);
        // The shot time (share) when the eased progress reaches s1.
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 30; i++) {
          const mid = (lo + hi) / 2;
          if (introSmoother(mid) < s1) lo = mid;
          else hi = mid;
        }
        _musaHandPath = { pos, look, lookParam, arriveU: (lo + hi) / 2 };
        return _musaHandPath;
      }

      const officeIntro = createCinematicIntro({
        THREE,
        getCamera: () => carCamera,
        getMount: () => getOfficeSceneMount(),
        shots: OFFICE_INTRO_SHOTS,
        shotPose: officeIntroShotPose,
        arrivalPose: null, // no "arrival" shot: the last shot itself ends on camera 1
        blocksInput: () => _officeSceneRendering,
      });

      /**
       * Objects drawn with frustum culling off for one warm-up frame (restored right after it).
       * compile() doesn't make every variant a real frame draws (the glass's back-face
       * transmission pass, for one): objects outside the first shot compiled those when
       * the intro first showed them (the gum tank, the air-in parts, the certificate:
       * 10–75 ms each). One frame behind the loader drawing everything makes them.
       */
      const _officeWarmupUnculled = [];
      function beginOfficeWarmupUncull() {
        scene.traverse((o) => {
          if (o.frustumCulled && (o.isMesh || o.isPoints || o.isLine || o.isSprite)) {
            o.frustumCulled = false;
            _officeWarmupUnculled.push(o);
          }
        });
      }
      function endOfficeWarmupUncull() {
        for (let i = 0; i < _officeWarmupUnculled.length; i++) _officeWarmupUnculled[i].frustumCulled = true;
        _officeWarmupUnculled.length = 0;
      }

      /** Behind the loader: car placed and gums settled, a few frames already drawn at the first shot. */
      function updateOfficeSceneReady() {
        if (_officeSceneReady || !_officeGameplayCam) return;
        if (!_officeCarLoadedAt) _officeCarLoadedAt = performance.now();
        const waitedSec = (performance.now() - _officeCarLoadedAt) / 1000;
        if (!_gumsInitialSettleEmitted && waitedSec < OFFICE_READY_MAX_WAIT_SEC) return;
        if (!_officeIntroRig) _officeIntroRig = buildOfficeIntroRig();
        // Behind the loader: compile every light set that can show up later (see OFFICE_READY_WARMUP).
        const step = OFFICE_READY_WARMUP[
          Math.min(Math.floor(_officeReadyFrames / OFFICE_READY_WARMUP_STEP_FRAMES), OFFICE_READY_WARMUP.length - 1)
        ];
        lightBlendTarget = lightBlend = step.blend;
        setDrawerPortalWarmup(!!step.portal);
        // Compile every object in the scene for this light set, not just what this
        // shot's camera draws (objects seen later from camera 1 compiled their
        // "portal on" variant when the drawer opened, a 110 ms hitch).
        if (_officeReadyFrames % OFFICE_READY_WARMUP_STEP_FRAMES === 0) {
          applyLightBlend(step.blend);
          // Into the frames' own target: the scene is drawn into the composer's buffer
          // (linear output, no tone mapping), so compiling for the screen (sRGB + ACES)
          // made programs no frame uses, and the real ones compiled during the intro.
          const prevTarget = renderer.getRenderTarget();
          try {
            renderer.setRenderTarget(finalComposer.readBuffer);
            renderer.compile(scene, camera);
          } catch (err) {
            console.warn("[office] shader warm-up failed:", err);
          } finally {
            renderer.setRenderTarget(prevTarget);
          }
          beginOfficeWarmupUncull();
        }
        _officeReadyFrames++;
        if (_officeReadyFrames < OFFICE_READY_WARMUP_FRAMES) return;
        _officeSceneReady = true;
        emitOfficeSceneEvent("office-scene-ready");
        startScreenVideos(); // only now: they don't compete with the level's own loading
      }

      /**
       * Lights-out in the opening: the bright room fades down to a short dim
       * moment, then the dark mode's accents and glows come up.
       */
      function updateOfficeIntroLightSwitch(t) {
        const t0 = officeIntro.shotStart("blinds") + OFFICE_INTRO_DARK_SWITCH_DELAY;
        const dt = t - t0;
        if (dt <= 0 || _officeIntroDarkened) return;
        if (dt >= OFFICE_INTRO_DARK_SWITCH_SEC) {
          endOfficeIntroLightSwitch();
          return;
        }
        // One shared progress for everything: the blinds and the daylight (lightBlend),
        // the room's lights, and the dark mode's accents and glows (which follow 1 − lightBlend).
        const p = introSmoother(dt / OFFICE_INTRO_DARK_SWITCH_SEC);
        lightBlend = lightBlendTarget = 1 - p;
        _gamingAccentLevel = 1;
        _sceneExposure = 1 - OFFICE_INTRO_DARK_SWITCH_DIP * Math.sin(Math.PI * p);
      }
      /** The hand's green flame: from the moment the camera passes the hand until just before the cut. */
      let _introHandFxStarted = false;
      function updateOfficeIntroHandFx(t) {
        if (!_officeIntroRig) return;
        const start = officeIntro.shotStart("musaHand");
        const sec = OFFICE_INTRO_SHOTS.find((sh) => sh.name === "musaHand").sec;
        const on = start + getMusaHandPath().arriveU * sec;
        const active = t >= on && t < start + sec - OFFICE_INTRO_HAND_FX_END_SEC;
        if (active && !_introHandFxStarted) {
          _introHandFxStarted = true;
          initHandWalkSmallFxFlameOn();
        }
        _introHandFxDemo = active ? 1 : 0;
      }

      /** Dark mode fully on: gameplay continues in it. */
      function endOfficeIntroLightSwitch() {
        _officeIntroDarkened = true;
        lightBlend = lightBlendTarget = 0;
        _sceneExposure = 1;
        _gamingAccentLevel = 1;
      }

      /** Advances the intro; returns this frame's camera pose (null once it's done or before the rig exists). */
      function updateOfficeIntro(rawDt) {
        const realDt = Math.min(rawDt, OFFICE_INTRO_MAX_STEP);
        if (officeIntro.state === "done") {
          officeIntro.updateLetterbox(realDt);
          return null;
        }
        if (!_officeIntroRig) return null;
        if (officeIntro.state === "playing") {
          officeIntro.t += realDt;
          updateOfficeIntroLightSwitch(officeIntro.t);
          updateOfficeIntroHandFx(officeIntro.t);
          if (officeIntro.t >= officeIntro.totalSec) {
            officeIntro.state = "done";
            officeIntro.t = officeIntro.totalSec;
            endOfficeIntroLightSwitch();
            _introHandFxDemo = 0;
            emitOfficeSceneEvent("office-intro-done"); // the player has control (the page shows the controls guide)
            setupOfficeGameplayCamera();
            officeIntro.updateFade();
            officeIntro.updateLetterbox(realDt);
            return null;
          }
        }
        officeIntro.updateFade();
        officeIntro.updateLetterbox(realDt);
        return officeIntro.poseAt(officeIntro.t);
      }

      // Lights + windowTris: one blend (lightBlend, 0→1) drives both.
      // Dark / “blinds closed”: lightBlend → 0 (Key O) — tilted tris, darker scene.
      // Bright / “blinds open”: lightBlend → 1 (Key P) — flat tris, lighter scene.
      const ambient = new THREE.AmbientLight(0x445566, 0.65);
      scene.add(ambient);
      const hemisphere = new THREE.HemisphereLight(0x88aaff, 0xcc88aa, 0.5);
      scene.add(hemisphere);
      let carShadowPlane = null;
      let tableSideWallShadowMeshes = [];
      const tableSideWallShadowMaterial = new THREE.ShadowMaterial({
        opacity: 0.5,
        side: THREE.DoubleSide,
      });
      const _wallShadowInward = new THREE.Vector3();
      const _wallInnerFace = new THREE.Vector3();
      const _wallTableRef = new THREE.Vector3();
      const _wallShadowBasisX = new THREE.Vector3();
      const _wallShadowBasisY = new THREE.Vector3(0, 1, 0);

      const dirPink = new THREE.DirectionalLight(0xee99bb, 0.5);
      dirPink.position.set(35, 45, 25);
      scene.add(dirPink);
      const dirBlue = new THREE.DirectionalLight(0x5588dd, 0.9);
      dirBlue.position.set(-35, 40, -25);
      scene.add(dirBlue);

      /** Shadow-casting lights' strength in bright mode (dark mode: GAMING_DARK.shadowLights). */
      const SHADOW_LIGHT_BRIGHT_INTENSITY = 0.22;
      const carShadowLight = new THREE.DirectionalLight(0xffffff, SHADOW_LIGHT_BRIGHT_INTENSITY);
      carShadowLight.layers.set(TABLE_TOP_SHADOW_LAYER);
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

      const wallShadowLight = new THREE.DirectionalLight(0xffffff, SHADOW_LIGHT_BRIGHT_INTENSITY);
      wallShadowLight.layers.set(TABLE_WALL_SHADOW_LAYER);
      wallShadowLight.castShadow = true;
      wallShadowLight.shadow.mapSize.width = 512;
      wallShadowLight.shadow.mapSize.height = 512;
      wallShadowLight.shadow.camera.near = 0.5;
      wallShadowLight.shadow.camera.far = 40;
      wallShadowLight.shadow.camera.left = -8;
      wallShadowLight.shadow.camera.right = 8;
      wallShadowLight.shadow.camera.top = 8;
      wallShadowLight.shadow.camera.bottom = -8;
      wallShadowLight.shadow.bias = -0.001;
      wallShadowLight.shadow.normalBias = 0.02;
      wallShadowLight.shadow.radius = 16;
      scene.add(wallShadowLight);
      scene.add(wallShadowLight.target);

      function refreshAllSceneShadows() {
        if (!perfSettings.shadows) return;
        const model = _officeWorldRoot || _currentWorldModel;
        if (!model) return;
        applyWallShadowCasters(model);
        forceWallCasterShadowState(model);
        applyTableKnockableShadows(model);
        refreshTableSideWallShadows(model);
        enforceTableSideWallShadowPolicy(model);
        if (car) applyCastShadowsToObject3D(car, "both");
        applyHandShadows();
        if (carShadowPlane) carShadowPlane.receiveShadow = true;
      }

      function applyWallShadowSettings(mapSize, enabled) {
        if (typeof wallShadowLight === "undefined") return;
        wallShadowLight.castShadow = !!enabled;
        if (!enabled) return;
        const baseSize = mapSize > 0 ? mapSize : 512;
        const wallMapSize = Math.min(Math.max(baseSize, 256), 768);
        wallShadowLight.shadow.mapSize.set(wallMapSize, wallMapSize);
        wallShadowLight.shadow.radius =
          wallMapSize >= 768 ? 18 : wallMapSize >= 512 ? 14 : 10;
        wallShadowLight.shadow.bias = -0.001;
        wallShadowLight.shadow.normalBias = 0.02;
      }

      function applyPerformanceSettings() {
        const s = perfSettings;
        renderer.shadowMap.enabled = s.shadows;
        applyShadowMapUpdatePolicy();
        if (typeof carShadowLight !== "undefined") {
          carShadowLight.castShadow = s.shadows;
          if (s.shadows && s.shadowMapSize > 0) {
            carShadowLight.shadow.mapSize.set(
              s.shadowMapSize,
              s.shadowMapSize,
            );
            carShadowLight.shadow.radius = s.shadowMapSize >= 512 ? 4 : 3;
          }
        }
        if (typeof wallShadowLight !== "undefined") {
          applyWallShadowSettings(s.shadowMapSize, s.shadows);
        }
        if (typeof smaaPass !== "undefined") smaaPass.enabled = s.smaa;
        if (typeof sharpenPass !== "undefined")
          sharpenPass.enabled = false;
        sceneBloomEnabled = false;
        if (physicsWorld) {
          physicsWorld.solver.iterations = s.physicsIterations;
        }
        applyShadowMapTypeForTier();
        if (s.shadows) {
          refreshAllSceneShadows();
          markShadowMapsDirty();
        }
        if (typeof resize === "function") resize();
        if (typeof syncFinalComposerMsaaTargets === "function") {
          syncFinalComposerMsaaTargets();
        }
        applyCarLightsBloomTierSettings();
        applyCarLightEmissiveForTier();
      }


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

      // ---- Dark mode: a dramatic gaming setup at night --------------------
      // Built from the scene's own colours: the portal / kitchen-transition
      // blues and magentas (#165dff #2090ff #715cff #ff319d #d52cff), the car's
      // pink-red and the charger's blue cue. Very little ambient light; the
      // room is lit by a few coloured accents that pick out the desk, the car
      // and the key objects, and the emissive parts glow against the dark.
      // It's the dark end of lightBlend (O / P keys); bright mode is unchanged.
      const GAMING_DARK = {
        /** Room background (was 0x1a1a1a). */
        background: 0x07060d,
        /** General light, kept very low so most of the room falls into darkness (was 0x4a4460 @ 0.65, then 0x241c3a: less purple now). */
        ambient: { color: 0x1f1f33, intensity: 0.08 },
        /** Was sky 0x88aaff / ground 0xdd88aa @ 0.5; ground was 0x3d0f33 (less purple now). */
        hemisphere: { sky: 0x2b3f9e, ground: 0x2b1a33, intensity: 0.12 },
        /** Two coloured rim lights from behind the desk (were 0xee77aa @ 0.7 and 0x5588dd @ 0.9). */
        dirPink: { color: 0xff319d, intensity: 0.15 }, // was 0.3 (pink + blue read as too much purple)
        dirBlue: { color: 0x165dff, intensity: 0.38 },
        /** Soft fills (were 0xdd88aa @ 0.4 and 0x77aaff @ 0.45). */
        dirFillPink: { color: 0xd52cff, intensity: 0.03 }, // was 0.06
        dirFillBlue: { color: 0x2090ff, intensity: 0.06 },
        /** Were 0xee66aa / 0x5588dd @ 0.5. */
        pointPink: { color: 0xff319d, intensity: 0.08 }, // was 0.15
        pointBlue: { color: 0x2090ff, intensity: 0.15 },
        warmKey: { color: 0xfff0dd, intensity: 0 },
        warmFill: { color: 0xffe8cc, intensity: 0 },
        /**
         * The scene's four older dark-only lights, reused (no extra lights) as
         * the under-desk glow, the wall glow and the desk objects' rim lights.
         * They were: blue point 0x3366cc @ 2.5 at [0, 20, 0], blue fill dir
         * 0x4488ee @ 1.4, pink point 0xff44aa @ 1.5 at [15, 18, -10], purple fill
         * dir 0x8844cc @ 1.2.
         */
        // Soft blue-violet under-desk glow on the floor and the legs (point; was 0x715cff @ 16).
        underDeskGlow: { color: 0x7a86ff, intensity: 10, pos: [0, 3.5, 3], distance: 30, decay: 1.5 },
        // Soft violet glow on the wall / blinds behind the desk (point; was purple 0xd52cff @ 18).
        wallGlow: { color: 0x9b7cff, intensity: 11, pos: [2, 12, -15.5], distance: 34, decay: 1.4 },
        // Rim lights for the desk objects, low from behind (directional, from `pos` toward the desk).
        rimMagenta: { color: 0xff319d, intensity: 0.3, pos: [-24, 13, -17], target: [-6, 7.2, -6] }, // was 0.55
        rimBlue: { color: 0x2090ff, intensity: 0.55, pos: [26, 13, -17], target: [14, 7.2, -6] },
        /**
         * Accent lights (dark only, no shadows). spot: a light pool aimed at
         * `target`; point: a glow around `pos`. Intensities are physical
         * (they fall off with distance^decay).
         */
        accents: [
          // Purple-magenta wash: now only a subtle tint, aimed at the back of the
          // desk and the wall so the centre stays white (was intensity 26, target
          // [-1, 6.25, -4]; before that 28 at [-8, 19, 2] → [-5, 6.25, -3], angle 0.62).
          // (intensity was 8)
          { type: "spot", color: 0xff319d, intensity: 6, pos: [-4, 30, 7], target: [-1, 6.25, -11], angle: 1.05, penumbra: 1, distance: 60, decay: 1.4 },
          // Blue pool over the right of the desk (charger, gum machine, drawer side).
          { type: "spot", color: 0x2090ff, intensity: 28, pos: [15, 19, 2], target: [16, 6.25, -4], angle: 0.6, penumbra: 0.85, distance: 40, decay: 1.4 },
        ],
        /**
         * The objects on the desk keep the backup's (src/office) dark-mode
         * lighting: these are its values. Only their materials get the
         * difference between these and the live lights (in their shaders), so
         * the room keeps the new dark mode. Directional lights shine from `pos`
         * toward the origin, as in the backup.
         */
        deskRestore: {
          ambient: { color: 0x4a4460, intensity: 0.65 },
          hemisphere: { sky: 0x88aaff, ground: 0xdd88aa, intensity: 0.5 },
          directional: {
            dirPink: { color: 0xee77aa, intensity: 0.7, pos: [35, 45, 25] },
            dirBlue: { color: 0x5588dd, intensity: 0.9, pos: [-35, 40, -25] },
            dirFillPink: { color: 0xdd88aa, intensity: 0.4, pos: [-15, 25, 30] },
            dirFillBlue: { color: 0x77aaff, intensity: 0.45, pos: [20, 30, -20] },
            darkBlueFill: { color: 0x4488ee, intensity: 1.4, pos: [-10, 30, 15] },
            darkPurpleFill: { color: 0x8844cc, intensity: 1.2, pos: [10, 25, -20] },
          },
          /** The two shadow-casting lights (backup: white @ 0.22, same direction as now). */
          shadowLights: { color: 0xffffff, intensity: 0.22 },
        },
        /**
         * The desk's surface reads white in dark mode: a soft neutral fill on
         * the desk-top material only (added in its shader, no extra light):
         * mostly from above (`top`), a little everywhere (`ambient`).
         */
        deskSurfaceFill: { color: 0xf2f4ff, top: 0.55, ambient: 0.12 },
        /**
         * The window glass is almost a mirror (roughness 0.02), so the spot
         * lights' highlights showed on it as bright dots (the purple wash's
         * from the blinds shot). The glass ignores the spot lights' direct light;
         * everything else about it is unchanged.
         */
        windowGlassIgnoresSpots: true,
        /**
         * Lighting for single objects in dark mode, added in their materials'
         * shaders (no real lights, so nothing else gets brighter; the scene has
         * no environment map, so envMapIntensity can't help). Diffuse only, so
         * colours stay true. key: white light from above and in front (for the
         * car: its own front, so it follows the car); rim: from behind, in an
         * accent colour; ambient: a little everywhere.
         */
        carFill: {
          key: { color: 0xffffff, intensity: 1.15, forward: 0.55 },
          rim: { color: 0x2090ff, intensity: 0.55, up: 0.5 },
          ambient: 0.18,
        },
        coneFill: {
          key: { color: 0xffffff, intensity: 1.0, dir: [0.2, 1, 0.7] },
          ambient: 0.2,
          /** The cones' white stripes catch the light like reflective tape (emissive, dark mode). */
          stripeEmissive: { color: 0xffffff, intensity: 0.32 },
        },
        /** The duck's eyeballs: a soft white glow so they read white (bright mode / dark mode). */
        eyeWhite: { bright: 0.18, dark: 0.42 },
        /**
         * A soft glow in the part's own colour (emissive = its colour), so only
         * it gets brighter and its colour stays true (bright mode / dark mode):
         * the duck's beak (duckMakor) and the star (the visible part of starPhysic).
         */
        selfGlow: {
          duckMakor: { bright: 0.12, dark: 0.32 }, // was 0.22 / 0.5: the beak read too light
          star: { bright: 0.04, dark: 0.17 }, // was 0.2 / 0.45, 0.08 / 0.28, then 0.04 / 0.2: the star looked too light
        },
        /** The star's own colour × this (its glow follows its colour), so it reads a little less bright in both modes. */
        starColorScale: 0.88,
        /** The two shadow-casting lights (car on the desk, desk side wall): bright mode keeps white @ 0.22. */
        shadowLights: { color: 0xdfe3f5, intensity: 0.12 }, // colour was lavender 0x9a8cff
        /** Emissive strength in dark mode (bright mode keeps its own values). */
        /** (phoneChargerLight and headphonesLight are on the desk: back to the backup's 2.2 and 3.4; were 4.5 and 6.5.) */
        emissive: { phoneChargerLight: 2.2, headphonesLight: 3.4, roomLight: 0.12 },
      };
      const darkMode = {
        background: GAMING_DARK.background,
        ambient: GAMING_DARK.ambient,
        hemisphere: GAMING_DARK.hemisphere,
        dirPink: GAMING_DARK.dirPink,
        dirBlue: GAMING_DARK.dirBlue,
        dirFillPink: GAMING_DARK.dirFillPink,
        dirFillBlue: GAMING_DARK.dirFillBlue,
        pointPink: GAMING_DARK.pointPink,
        pointBlue: GAMING_DARK.pointBlue,
        warmKey: GAMING_DARK.warmKey,
        warmFill: GAMING_DARK.warmFill,
      };
      const _gamingAccentLights = [];
      /** 0..1 on top of the dark blend: the intro brings the accents up after its dim moment. */
      let _gamingAccentLevel = 1;
      /** Tone-mapping exposure (the intro dips it for the lights-out moment). */
      let _sceneExposure = 1;
      for (const a of GAMING_DARK.accents) {
        const light =
          a.type === "spot"
            ? new THREE.SpotLight(a.color, 0, a.distance, a.angle, a.penumbra, a.decay)
            : new THREE.PointLight(a.color, 0, a.distance, a.decay);
        light.position.set(a.pos[0], a.pos[1], a.pos[2]);
        light.castShadow = false;
        if (a.type === "spot") {
          light.target.position.set(a.target[0], a.target[1], a.target[2]);
          scene.add(light.target);
        }
        light.userData.darkIntensity = a.intensity;
        scene.add(light);
        _gamingAccentLights.push(light);
      }
      // Reused dark-only lights: colour, place and reach from the config.
      const _gamingReused = [
        [darkBlueLight, GAMING_DARK.underDeskGlow],
        [darkPinkLight, GAMING_DARK.wallGlow],
        [darkPurpleFill, GAMING_DARK.rimMagenta],
        [darkBlueFill, GAMING_DARK.rimBlue],
      ];
      for (const [light, cfg] of _gamingReused) {
        light.color.setHex(cfg.color);
        light.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
        if (cfg.distance != null) light.distance = cfg.distance;
        if (cfg.decay != null) light.decay = cfg.decay;
        if (cfg.target && light.target) {
          light.target.position.set(cfg.target[0], cfg.target[1], cfg.target[2]);
          scene.add(light.target);
        }
      }
      /** Emissive materials brightened in dark mode: { material, bright, dark }. */
      const _gamingEmissives = [];
      function registerGamingEmissive(material, key) {
        if (!material || _gamingEmissives.some((e) => e.material === material)) return;
        _gamingEmissives.push({
          material,
          bright: material.emissiveIntensity,
          dark: GAMING_DARK.emissive[key],
        });
        applyLightBlend(lightBlend);
      }
      /** Names of the objects found sitting on the desk (for the dark mode's desk lighting). */
      let gamingDeskObjects = [];
      /** Light blend the desk restore was last given (set by applyLightBlend). */
      let _deskRestoreBlend = 0;
      const _deskRestoreMaterials = [];
      /**
       * Materials whose shader we've patched (by instance: a clone copies
       * userData but not the shader hook, so a flag in userData isn't enough).
       */
      const _shaderPatched = new WeakSet();
      const DESK_RESTORE_DIRS = 10;
      const _deskRestoreUniforms = {
        uDeskAmbient: { value: new THREE.Vector3() },
        uDeskHemiSky: { value: new THREE.Vector3() },
        uDeskHemiGround: { value: new THREE.Vector3() },
        uDeskUp: { value: new THREE.Vector3(0, 1, 0) },
        uDeskDirColor: { value: Array.from({ length: DESK_RESTORE_DIRS }, () => new THREE.Vector3()) },
        uDeskDirView: { value: Array.from({ length: DESK_RESTORE_DIRS }, () => new THREE.Vector3(0, 1, 0)) },
      };

      /** Adds the restore term to a desk material's lighting (diffuse, after the scene's own lights). */
      function patchDeskRestoreMaterial(m) {
        if (!m || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) || _shaderPatched.has(m)) return;
        _shaderPatched.add(m);
        m.userData.deskRestore = true;
        const prevCompile = m.onBeforeCompile;
        m.onBeforeCompile = (shader, renderer) => {
          if (prevCompile) prevCompile(shader, renderer);
          Object.assign(shader.uniforms, _deskRestoreUniforms);
          shader.fragmentShader = shader.fragmentShader
            .replace(
              "#include <common>",
              `#include <common>
              uniform vec3 uDeskAmbient;
              uniform vec3 uDeskHemiSky;
              uniform vec3 uDeskHemiGround;
              uniform vec3 uDeskUp;
              uniform vec3 uDeskDirColor[${DESK_RESTORE_DIRS}];
              uniform vec3 uDeskDirView[${DESK_RESTORE_DIRS}];`,
            )
            .replace(
              "#include <lights_fragment_end>",
              `#include <lights_fragment_end>
              {
                vec3 deskIrr = uDeskAmbient + mix(uDeskHemiGround, uDeskHemiSky, 0.5 * dot(normal, uDeskUp) + 0.5);
                for (int i = 0; i < ${DESK_RESTORE_DIRS}; i++) {
                  deskIrr += uDeskDirColor[i] * max(dot(normal, uDeskDirView[i]), 0.0);
                }
                reflectedLight.directDiffuse = max(reflectedLight.directDiffuse + deskIrr * BRDF_Lambert(material.diffuseColor), vec3(0.0));
              }`,
            );
        };
        const prevKey = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : null;
        m.customProgramCacheKey = () => (prevKey ? prevKey() : "") + "|deskRestore";
        m.needsUpdate = true;
        _deskRestoreMaterials.push(m);
      }

      const _deskSurfaceUniforms = {
        uDeskSurfTop: { value: new THREE.Vector3() },
        uDeskSurfAmb: { value: new THREE.Vector3() },
        uDeskSurfUp: { value: new THREE.Vector3(0, 1, 0) },
      };
      /** The desk top's white fill in dark mode (diffuse, in its shader). */
      function patchDeskSurfaceMaterial(m) {
        if (!m || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) || _shaderPatched.has(m)) return;
        _shaderPatched.add(m);
        m.userData.deskSurfaceFill = true;
        const prevCompile = m.onBeforeCompile;
        m.onBeforeCompile = (shader, renderer) => {
          if (prevCompile) prevCompile(shader, renderer);
          Object.assign(shader.uniforms, _deskSurfaceUniforms);
          shader.fragmentShader = shader.fragmentShader
            .replace(
              "#include <common>",
              `#include <common>
              uniform vec3 uDeskSurfTop;
              uniform vec3 uDeskSurfAmb;
              uniform vec3 uDeskSurfUp;`,
            )
            .replace(
              "#include <lights_fragment_end>",
              `#include <lights_fragment_end>
              reflectedLight.directDiffuse += (uDeskSurfAmb + uDeskSurfTop * max(dot(normal, uDeskSurfUp), 0.0)) * BRDF_Lambert(material.diffuseColor);`,
            );
        };
        const prevKey = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : null;
        m.customProgramCacheKey = () => (prevKey ? prevKey() : "") + "|deskSurface";
        m.needsUpdate = true;
      }
      const _deskSurfC = new THREE.Color();
      function updateDeskSurfaceFill(cam) {
        const f = GAMING_DARK.deskSurfaceFill;
        const k = (1 - _deskRestoreBlend) * _gamingAccentLevel;
        _deskSurfC.setHex(f.color);
        _deskSurfaceUniforms.uDeskSurfTop.value.set(_deskSurfC.r, _deskSurfC.g, _deskSurfC.b).multiplyScalar(f.top * k);
        _deskSurfaceUniforms.uDeskSurfAmb.value.set(_deskSurfC.r, _deskSurfC.g, _deskSurfC.b).multiplyScalar(f.ambient * k);
        _deskSurfaceUniforms.uDeskSurfUp.value.set(0, 1, 0).transformDirection(cam.matrixWorldInverse);
      }

      // Dark-mode fill for single objects (car, cones), in their shaders.
      function makeDarkFillUniforms() {
        return {
          uDarkFillAmb: { value: new THREE.Vector3() },
          uDarkFillKey: { value: new THREE.Vector3() },
          uDarkFillKeyDir: { value: new THREE.Vector3(0, 1, 0) },
          uDarkFillRim: { value: new THREE.Vector3() },
          uDarkFillRimDir: { value: new THREE.Vector3(0, 1, 0) },
        };
      }
      const _carFillUniforms = makeDarkFillUniforms();
      const _coneFillUniforms = makeDarkFillUniforms();
      function patchDarkFillMaterial(m, uniforms, key) {
        if (!m || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) || _shaderPatched.has(m)) return;
        _shaderPatched.add(m);
        m.userData.darkFill = key;
        const prevCompile = m.onBeforeCompile;
        m.onBeforeCompile = (shader, renderer) => {
          if (prevCompile) prevCompile(shader, renderer);
          Object.assign(shader.uniforms, uniforms);
          shader.fragmentShader = shader.fragmentShader
            .replace(
              "#include <common>",
              `#include <common>
              uniform vec3 uDarkFillAmb;
              uniform vec3 uDarkFillKey;
              uniform vec3 uDarkFillKeyDir;
              uniform vec3 uDarkFillRim;
              uniform vec3 uDarkFillRimDir;`,
            )
            .replace(
              "#include <lights_fragment_end>",
              `#include <lights_fragment_end>
              reflectedLight.directDiffuse += (uDarkFillAmb
                + uDarkFillKey * max(dot(normal, uDarkFillKeyDir), 0.0)
                + uDarkFillRim * max(dot(normal, uDarkFillRimDir), 0.0)) * BRDF_Lambert(material.diffuseColor);`,
            );
        };
        const prevKey = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : null;
        m.customProgramCacheKey = () => (prevKey ? prevKey() : "") + "|darkFill";
        m.needsUpdate = true;
      }
      const _fillC = new THREE.Color();
      const _fillV = new THREE.Vector3();
      function _setFillColor(out, hex, intensity) {
        _fillC.setHex(hex);
        return out.set(_fillC.r, _fillC.g, _fillC.b).multiplyScalar(intensity);
      }
      /** The car's body, wheels and frame (not its lamps, which glow on their own). */
      let _carFillPatched = false;
      function patchCarDarkFill() {
        if (_carFillPatched || !car || !_carBloomReady) return; // the car's meshes have loaded
        _carFillPatched = true;
        car.traverse((o) => {
          if (!o.isMesh) return;
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) {
            if (!m || m._isCarLightMaterial || (m.emissive && m.emissive.getHex() !== 0)) continue;
            patchDarkFillMaterial(m, _carFillUniforms, "car");
          }
        });
      }
      /** The cones (moved into their own groups, outside the model) and their stripes. */
      const _coneStripeMats = [];
      let _conesPatched = false;
      function patchConesDarkFill() {
        if (_conesPatched || !_officeIntroRig) return; // after the scene's setup (cones get their own cloned materials)
        let found = 0;
        scene.traverse((o) => {
          if (!o.isMesh || !/^conus(Strips)?\d*$/.test(o.name)) return;
          found++;
          patchDarkFillMaterial(o.material, _coneFillUniforms, "cone");
          if (/Strips/.test(o.name) && !_coneStripeMats.includes(o.material)) {
            o.material.emissive.setHex(GAMING_DARK.coneFill.stripeEmissive.color);
            o.material.emissiveIntensity = 0;
            _coneStripeMats.push(o.material);
          }
        });
        if (found) _conesPatched = true;
      }
      const _eyeWhiteMats = [];
      /** The eyeballs' material (set by setupEyeTracking): white, with a soft white glow. */
      function setupEyeWhite() {
        eyeBallMaterial.color.setHex(0xffffff);
        eyeBallMaterial.emissive.setHex(0xffffff);
        _eyeWhiteMats.push(eyeBallMaterial);
      }
      /** Per frame, with the render camera: the fills follow the car / mode. */
      function updateDarkFills(cam) {
        patchCarDarkFill();
        patchConesDarkFill();
        const k = (1 - _deskRestoreBlend) * _gamingAccentLevel;
        const view = cam.matrixWorldInverse;
        const cf = GAMING_DARK.carFill;
        if (car) {
          const yaw = carState.angle + (carState.driftAngle || 0);
          const fx = Math.sin(yaw);
          const fz = Math.cos(yaw);
          _setFillColor(_carFillUniforms.uDarkFillAmb.value, 0xffffff, cf.ambient * k);
          _setFillColor(_carFillUniforms.uDarkFillKey.value, cf.key.color, cf.key.intensity * k);
          _carFillUniforms.uDarkFillKeyDir.value.set(fx * cf.key.forward, 1, fz * cf.key.forward).normalize().transformDirection(view);
          _setFillColor(_carFillUniforms.uDarkFillRim.value, cf.rim.color, cf.rim.intensity * k);
          _carFillUniforms.uDarkFillRimDir.value.set(-fx, cf.rim.up, -fz).normalize().transformDirection(view);
        }
        const co = GAMING_DARK.coneFill;
        _setFillColor(_coneFillUniforms.uDarkFillAmb.value, 0xffffff, co.ambient * k);
        _setFillColor(_coneFillUniforms.uDarkFillKey.value, co.key.color, co.key.intensity * k);
        _fillV.set(co.key.dir[0], co.key.dir[1], co.key.dir[2]);
        _coneFillUniforms.uDarkFillKeyDir.value.copy(_fillV).normalize().transformDirection(view);
        _coneFillUniforms.uDarkFillRim.value.set(0, 0, 0);
        for (const m of _coneStripeMats) m.emissiveIntensity = co.stripeEmissive.intensity * k;
        if (!_eyeWhiteMats.length) setupEyeWhite();
        const ew = GAMING_DARK.eyeWhite;
        const eyeGlow = ew.bright + (ew.dark - ew.bright) * k;
        for (const m of _eyeWhiteMats) m.emissiveIntensity = eyeGlow;
        updateSelfGlow(k);
      }

      /** duckMakor / star: emissive in their own colour, strength by mode (k: 0 bright → 1 dark). */
      const _selfGlowMats = { duckMakor: null, star: null };
      function updateSelfGlow(k) {
        const G = GAMING_DARK.selfGlow;
        if (!_selfGlowMats.duckMakor) {
          duckMakorMaterial.emissive.copy(duckMakorMaterial.color);
          _selfGlowMats.duckMakor = duckMakorMaterial;
        }
        if (!_selfGlowMats.star) {
          const star = findStarMesh();
          if (star && star.material && star.material.emissive) {
            star.material = star.material.clone(); // its own copy: the model's material may be shared
            star.material.color.multiplyScalar(GAMING_DARK.starColorScale);
            star.material.emissive.copy(star.material.color);
            _selfGlowMats.star = star.material;
          }
        }
        for (const key of ["duckMakor", "star"]) {
          const m = _selfGlowMats[key];
          if (m) m.emissiveIntensity = G[key].bright + (G[key].dark - G[key].bright) * k;
        }
      }

      /** Window glass: no direct light from spot lights (their highlights showed as dots on it). */
      function patchGlassIgnoreSpots(m) {
        if (!m || _shaderPatched.has(m)) return;
        const chunk = THREE.ShaderChunk.lights_fragment_begin;
        const spotInfo = /(getSpotLightInfo\([^;]*\);)/;
        if (!spotInfo.test(chunk)) return;
        _shaderPatched.add(m);
        m.userData.ignoresSpots = true;
        const prevCompile = m.onBeforeCompile;
        m.onBeforeCompile = (shader, renderer) => {
          if (prevCompile) prevCompile(shader, renderer);
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <lights_fragment_begin>",
            chunk.replace(spotInfo, "$1\n\t\tdirectLight.color = vec3( 0.0 );"),
          );
        };
        const prevKey = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : null;
        m.customProgramCacheKey = () => (prevKey ? prevKey() : "") + "|noSpots";
        m.needsUpdate = true;
      }

      /**
       * Dark mode desk lighting: finds what sits on the desk (from positions
       * relative to its top, not a list) and gives their materials the
       * backup's dark-mode lighting.
       */
      function setupGamingDeskLighting(model) {
        const plate = model.getObjectByName("tablePlate");
        if (!plate) return;
        model.updateMatrixWorld(true);
        const desk = new THREE.Box3().setFromObject(plate);
        const top = desk.max.y;
        const box = new THREE.Box3();
        const found = new Set();
        model.traverse((node) => {
          if (!node.isMesh || !node.visible || node === plate) return;
          if (/physic|phisic|trigger/i.test(node.name)) return; // physics / trigger helpers, not visible objects
          box.setFromObject(node);
          if (box.isEmpty()) return;
          const cx = (box.min.x + box.max.x) / 2;
          const cz = (box.min.z + box.max.z) / 2;
          const onTop = box.min.y >= top - 0.15 && box.min.y <= top + 1.2 && box.max.y > top + 0.05;
          const overDesk = cx >= desk.min.x && cx <= desk.max.x && cz >= desk.min.z && cz <= desk.max.z;
          if (!onTop || !overDesk) return;
          // Report the object (its top-level part under the model).
          let part = node;
          while (part.parent && part.parent !== model) part = part.parent;
          found.add(part.name || node.name);
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          for (const m of mats) patchDeskRestoreMaterial(m);
        });
        // The desk top: a white fill; the window glass: no spot highlights.
        const plateMats = Array.isArray(plate.material) ? plate.material : [plate.material];
        for (const m of plateMats) patchDeskSurfaceMaterial(m);
        if (GAMING_DARK.windowGlassIgnoresSpots) {
          scene.traverse((o) => {
            if (o.name === "windowGlass" && o.material) patchGlassIgnoreSpots(o.material);
          });
        }
        // The gums are one instanced mesh outside the model.
        if (gumInstancedMesh) {
          patchDeskRestoreMaterial(gumInstancedMesh.material);
          found.add("gums");
        }
        gamingDeskObjects = [...found];
      }

      const _drC = new THREE.Color();
      const _drC2 = new THREE.Color();
      const _drV = new THREE.Vector3();
      const _drDir = new THREE.Vector3();
      /** color (linear) × intensity into a vector */
      function _lightVec(color, intensity, out) {
        return out.set(color.r * intensity, color.g * intensity, color.b * intensity);
      }
      /** The backup's value at blend b (its dark preset ↔ the shared bright preset), as color × intensity. */
      function _backupVec(darkHex, darkI, brightHex, brightI, b, out) {
        _drC.setHex(darkHex);
        _drC2.setHex(brightHex);
        _drC.lerp(_drC2, b);
        return _lightVec(_drC, darkI + (brightI - darkI) * b, out);
      }
      let _deskDirSlot = 0;
      function _pushDeskDir(worldDir, vec, viewMat) {
        if (_deskDirSlot >= DESK_RESTORE_DIRS) return;
        _deskRestoreUniforms.uDeskDirView.value[_deskDirSlot].copy(worldDir).transformDirection(viewMat);
        _deskRestoreUniforms.uDeskDirColor.value[_deskDirSlot].copy(vec);
        _deskDirSlot++;
      }
      function _lightWorldDir(light, out) {
        light.updateMatrixWorld();
        light.target.updateMatrixWorld();
        out.setFromMatrixPosition(light.matrixWorld);
        _drV.setFromMatrixPosition(light.target.matrixWorld);
        return out.sub(_drV).normalize();
      }

      /**
       * Per frame (with the camera used for this render): the backup's light on
       * the desk objects minus what the live lights give them.
       */
      function updateDeskRestore(cam) {
        if (!_deskRestoreMaterials.length) return;
        const R = GAMING_DARK.deskRestore;
        const b = _deskRestoreBlend;
        cam.updateMatrixWorld();
        const view = cam.matrixWorldInverse;
        const U = _deskRestoreUniforms;
        // Ambient and hemisphere.
        _backupVec(R.ambient.color, R.ambient.intensity, brightMode.ambient.color, brightMode.ambient.intensity, b, U.uDeskAmbient.value)
          .sub(_lightVec(ambient.color, ambient.intensity, _drV));
        _backupVec(R.hemisphere.sky, R.hemisphere.intensity, brightMode.hemisphere.sky, brightMode.hemisphere.intensity, b, U.uDeskHemiSky.value)
          .sub(_lightVec(hemisphere.color, hemisphere.intensity, _drV));
        _backupVec(R.hemisphere.ground, R.hemisphere.intensity, brightMode.hemisphere.ground, brightMode.hemisphere.intensity, b, U.uDeskHemiGround.value)
          .sub(_lightVec(hemisphere.groundColor, hemisphere.intensity, _drV));
        U.uDeskUp.value.set(0, 1, 0).transformDirection(view);
        // Directional lights: + the backup's (its direction), − the live one (its direction).
        _deskDirSlot = 0;
        const dirs = [
          ["dirPink", dirPink],
          ["dirBlue", dirBlue],
          ["dirFillPink", dirFillPink],
          ["dirFillBlue", dirFillBlue],
        ];
        const tmp = new THREE.Vector3();
        for (const [key, light] of dirs) {
          const o = R.directional[key];
          const live = _lightVec(light.color, light.intensity, tmp.clone());
          const back = _backupVec(o.color, o.intensity, brightMode[key].color, brightMode[key].intensity, b, tmp.clone());
          _pushDeskDir(_lightWorldDir(light, _drDir), back.sub(live), view);
        }
        // The two old dark-only fills (now reused as rims, other directions; dark only in both).
        for (const [key, light] of [["darkBlueFill", darkBlueFill], ["darkPurpleFill", darkPurpleFill]]) {
          const o = R.directional[key];
          _drC.setHex(o.color);
          _drDir.set(o.pos[0], o.pos[1], o.pos[2]).normalize();
          _pushDeskDir(_drDir, _lightVec(_drC, o.intensity * (1 - b), tmp.clone()), view);
          _pushDeskDir(_lightWorldDir(light, _drDir), _lightVec(light.color, light.intensity, tmp.clone()).multiplyScalar(-1), view);
        }
        // Shadow lights: the backup kept them white @ 0.22 in both modes.
        _drC.setHex(R.shadowLights.color);
        for (const light of [carShadowLight, wallShadowLight]) {
          const back = _lightVec(_drC, R.shadowLights.intensity, tmp.clone());
          _pushDeskDir(_lightWorldDir(light, _drDir), back.sub(_lightVec(light.color, light.intensity, _drV)), view);
        }
        for (; _deskDirSlot < DESK_RESTORE_DIRS; _deskDirSlot++) U.uDeskDirColor.value[_deskDirSlot].set(0, 0, 0);
      }

      // Lights that should ONLY appear in dark mode (intensity = baseIntensity * (1-lightBlend)).
      const _darkModeOnlyLights = [];
      // Meshes whose emissiveIntensity is lerped between strong (dark) and gentle (bright).
      // Each entry: { mesh, darkIntensity, brightIntensity }.
      const _peselLightMeshes = [];
      const _techDesignerMagnetDecals = [];
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
       * A gentle warm tone on bright mode (seen in the intro's opening, before the
       * lights go out): every bright-mode light colour is mixed this much toward a
       * warm amber. Intensities, the background and dark mode are unchanged.
       */
      const OFFICE_BRIGHT_WARMTH = { color: 0xffd9a8, amount: 0.3 }; // amount was 0.12, then 0.2
      {
        const warm = new THREE.Color(OFFICE_BRIGHT_WARMTH.color);
        const c = new THREE.Color();
        const tint = (hex) => c.setHex(hex).lerp(warm, OFFICE_BRIGHT_WARMTH.amount).getHex();
        for (const v of Object.values(brightMode)) {
          if (!v || typeof v !== "object") continue;
          for (const k of ["color", "sky", "ground"]) if (typeof v[k] === "number") v[k] = tint(v[k]);
        }
      }
      let lightBlend = 0;
      let lightBlendTarget = 0;
      let _portalSceneDarkness = 0;
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
        const reusedK = darkBlueStr * _gamingAccentLevel;
        darkBlueLight.intensity = reusedK * GAMING_DARK.underDeskGlow.intensity;
        darkPinkLight.intensity = reusedK * GAMING_DARK.wallGlow.intensity;
        darkPurpleFill.intensity = reusedK * GAMING_DARK.rimMagenta.intensity;
        darkBlueFill.intensity = reusedK * GAMING_DARK.rimBlue.intensity;
        _cDark.setHex(GAMING_DARK.shadowLights.color);
        _cBright.setHex(0xffffff);
        carShadowLight.color.lerpColors(_cDark, _cBright, b);
        wallShadowLight.color.lerpColors(_cDark, _cBright, b);
        carShadowLight.intensity = wallShadowLight.intensity = _blendBright(
          GAMING_DARK.shadowLights.intensity,
          SHADOW_LIGHT_BRIGHT_INTENSITY,
        );
        const accentK = darkBlueStr * _gamingAccentLevel;
        for (let i = 0; i < _gamingAccentLights.length; i++) {
          const l = _gamingAccentLights[i];
          l.intensity = l.userData.darkIntensity * accentK;
        }
        _deskRestoreBlend = b;
        // Lights at zero still cost per pixel: hide dark-only lights in bright mode and
        // bright-only lights in dark mode (the three sets are compiled behind the loader).
        const darkOn = b < 1 - 1e-4;
        const brightOn = b > 1e-4;
        for (let i = 0; i < _gamingAccentLights.length; i++) _gamingAccentLights[i].visible = darkOn;
        for (let i = 0; i < _gamingReused.length; i++) _gamingReused[i][0].visible = darkOn;
        warmKeyLight.visible = brightOn;
        warmFillLight.visible = brightOn;
        for (let i = 0; i < _gamingEmissives.length; i++) {
          const e = _gamingEmissives[i];
          e.material.emissiveIntensity = e.bright + (e.dark - e.bright) * accentK;
        }
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
        for (let i = 0; i < _techDesignerMagnetDecals.length; i++) {
          const entry = _techDesignerMagnetDecals[i];
          if (!entry?.material) continue;
          entry.material.emissiveIntensity =
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
        if (e.code === "BracketLeft") {
          e.preventDefault();
          if (perfTierIndex > 0) {
            setPerformanceTier(perfTierIndex - 1, "keyboard");
          }
        }
        if (e.code === "BracketRight") {
          e.preventDefault();
          if (perfTierIndex < PERF_TIER_PRESETS.length - 1) {
            setPerformanceTier(perfTierIndex + 1, "keyboard");
          }
        }
        if (e.code === "KeyQ") {
          e.preventDefault();
        }
        if (e.code === "KeyG") {
          e.preventDefault();
        }
      });

      // --- Car from car-game14.glb (loaded when table is ready) ---
      // GLTF wheel names: wheelFl=front left, wheelFr=front right, wheelRl=rear left, wheelRr=rear right
      // Wheel covers (wheelCoverFl etc.) are parented to their wheel so they follow steer + roll.
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
      const _conusInstances = [];
      const _starInstances = [];
      let drawerGroup = null;
      let _drawerOrigZ = 0;
      let _drawerState = "closed";
      let _drawerAnimStart = 0;
      const DRAWER_SLIDE_DISTANCE = 4.7;
      const DRAWER_SLIDE_DURATION = 500;
      const DRAWER_OPEN_HOLD = 7000;
      const DRAWER_PART_NAMES = ["drawerPannel", "drawerEffect", "drawer"];
      let _drawerEffectMesh = null;
      const DRAWER_PORTAL_HEIGHT = 3;
      /**
       * The drawer's ring: the Kitchen intro's portal ring (portalRing.js, the same source and settings as that
       * shot), lying in the drawer facing up, with its lines flowing the other way (flow −1: sucked into the ring
       * instead of flying out of it). Its sequence starts when the drawer is open (the Kitchen's times: the air
       * charges, gathers, the flash, the burst, the tunnel); while the drawer stays open it holds at `openHold`
       * (open, after the burst); its collapse and closing flash (`closeTime`) play just before the drawer slides
       * back, so none of it goes into the drawer's housing.
       */
      const DRAWER_RING = {
        ...PORTAL_RING_DEFAULTS,
        flow: -1,
        /**
         * Inside the drawer: the whole effect scaled uniformly (never stretched) so its smoke ring's outer edge (its
         * furthest reach, found by `drawerRingReach`) meets the inner walls of the part of the drawer out of its
         * housing when open (its back stays in there; its shorter span decides: the ring is
         * round), against its inner front (the end it opens toward), its lowest part on the bottom. Its sparks,
         * drifting rim particles and arcs (reaching further) stop at that edge.
         * `padding`: world units kept clear of the walls, bottom and front (0: touching them).
         * `fillScale`: × the size that fills it (1: fills it; under 1 smaller; over 1 would go through the walls).
         */
        padding: 0,
        fillScale: 1,
        openHold: 2.6,
        closeTime: 0.5,
      };
      /** The ring's settings × s: every length, size and speed (its times unchanged, so its sequence is the same). */
      function scaleDrawerRing(P, s) {
        const mul = (v) => (Array.isArray(v) ? v.map((x) => x * s) : v * s);
        return {
          ...P,
          radius: P.radius * s,
          tunnelDepth: P.tunnelDepth * s,
          tunnelLen: mul(P.tunnelLen),
          tunnelWidth: mul(P.tunnelWidth),
          tunnelSpeed: mul(P.tunnelSpeed),
          smoke: { ...P.smoke, size: mul(P.smoke.size), thickness: P.smoke.thickness * s, depth: P.smoke.depth * s, billow: P.smoke.billow * s },
          rimParticles: { ...P.rimParticles, size: mul(P.rimParticles.size), driftOut: P.rimParticles.driftOut * s, driftForward: P.rimParticles.driftForward * s },
          arcs: { ...P.arcs, width: mul(P.arcs.width) },
          escape: { ...P.escape, distance: P.escape.distance * s, floorFade: P.escape.floorFade * s },
          wave: { ...P.wave, speed: mul(P.wave.speed) },
          sparks: { ...P.sparks, speedOut: mul(P.sparks.speedOut), speedSide: mul(P.sparks.speedSide), size: mul(P.sparks.size) },
        };
      }
      /**
       * How far the ring's parts reach from its centre (it lies flat, facing up): `side` across (the furthest of the
       * smoke, the rim particles' orbit, the lines, haze and flash; the sparks, drifting rim particles and arcs stop
       * there: the ring's `maxReach`), `body` above and below its plane (the smoke and rim particles; the arcs never go
       * below its floor). From the ring's shaders and arc code.
       */
      function drawerRingReach(P) {
        const R = P.radius;
        const S = P.smoke, Q = P.rimParticles, E = P.escape;
        // Its rim over its whole sequence (the ring's own phases: the build-up's swirl, the burst's overshoot, the close):
        // the smoke's and the rim particles' furthest at any moment, the largest smoke sprite, the opening's largest.
        const ease = (a, b, x) => {
          const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
          return k * k * (3 - 2 * k);
        };
        let smoke = 0, orbit = 0, half = 0, ringMax = 0;
        for (let t = 0; t <= P.closeTo + P.flashSec * 1.6; t += DRAWER_RING_REACH_STEP) {
          const build = ease(0, P.buildUp, t), gather = ease(P.buildUp, P.gatherEnd, t);
          const bu = Math.min(1, Math.max(0, (t - P.gatherEnd) / (P.burstEnd - P.gatherEnd)));
          const burst = bu <= 0 ? 0 : 1 + 2.2 * Math.pow(bu - 1, 3) + 1.2 * Math.pow(bu - 1, 2);
          const close = ease(P.closeFrom, P.closeTo, t);
          const ring = burst * (1 - close * close);
          const rimR = t < P.buildUp ? R * (1.1 - 0.65 * build) : t < P.gatherEnd ? R * 0.45 * (1 - gather * gather) : R * ring;
          const thick = S.thickness * (t < P.gatherEnd ? 0.6 + 1.2 * (1 - gather) : Math.max(0.2, ring));
          const sizeK = t < P.gatherEnd ? 0.45 + 0.3 * build + 0.25 * gather : Math.max(0.35, Math.min(1.1, ring));
          const h = 0.5 * S.size[1] * sizeK * 1.15; // a smoke sprite's half (its largest, fully billowed)
          smoke = Math.max(smoke, rimR + thick + S.billow + h);
          orbit = Math.max(orbit, rimR + thick * 0.9);
          half = Math.max(half, h);
          ringMax = Math.max(ringMax, ring);
        }
        const spread = E.distance * Math.tan((E.spreadDeg[1] * Math.PI) / 180); // the lines' cone, out there
        const side = Math.max(
          smoke, // smoke
          orbit + DRAWER_RING_GLOW, // rim particles' orbit (+ a point's glow)
          ringMax * (P.tunnelRadius[1] * R + spread) + DRAWER_RING_GLOW, // lines out there
          R + spread + DRAWER_RING_GLOW, // the burst wave's lines
          1.25 * R * ringMax, // haze
          0.5 * 1.75 * R, // flash
        );
        const body = 0.5 * S.depth + Math.max(half, Q.driftForward);
        return { side, body };
      }
      /** drawerRingReach's time step through the sequence (s). */
      const DRAWER_RING_REACH_STEP = 0.002;
      /** The glow round a spark / rim particle / an arc's half width (world units): kept inside its `maxReach` too. */
      const DRAWER_RING_GLOW = 0.05;
      let _drawerRing = null;
      let _drawerPortalPointLight = null;
      let _drawerPortalArrow = null;
      const _drawerPortalArrowMaterials = [];
      let _drawerPortalStartMs = 0;
      let _drawerPortalFadeOutStartMs = 0;
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
      }
      let _gumDispenserInternalBodies = [];
      let _gumDispenserInitPos = null;
      let _gumDispenserInitQuat = null;
      let _bottleInitPos = null;
      let _bottleInitQuat = null;
      let _certifiedInitPos = null;
      let _certifiedInitQuat = null;
      const _canonWorldPos = new THREE.Vector3();
      const _canonWorldQuat = new THREE.Quaternion();
      const _wheelSyncWorldPos = [
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
      ];
      const _wheelsList = [null, null, null, null];
      const _gumClampTmp = new THREE.Vector3();
      const _gumTankMwCached = new THREE.Matrix4();
      const _invTankMwGumClamp = new THREE.Matrix4();
      const _gumTankQuat = new THREE.Quaternion();
      const _gumTankInvQuat = new THREE.Quaternion();
      const _gumVelLocal = new THREE.Vector3();
      const _gumTankPrevMw = new THREE.Matrix4();
      const _gumTankPrevInvMw = new THREE.Matrix4();
      const _gumTankPrevQuat = new THREE.Quaternion();
      const _gumTankDeltaQuat = new THREE.Quaternion();
      const _gumCarryPos = new THREE.Vector3();
      const _gumCarryVel = new THREE.Vector3();
      const _gumCarryAngVel = new THREE.Vector3();
      const _gumCarryPointVelOld = new THREE.Vector3();
      const _gumCarryPointVelNew = new THREE.Vector3();
      const _gumStandQuat = new THREE.Quaternion();
      const _gumStandInvQuat = new THREE.Quaternion();
      const _gumStandLocalPos = new THREE.Vector3();
      const _gumStandLocalVel = new THREE.Vector3();
      const _gdCarryPrevLin = new THREE.Vector3();
      const _gdCarryPrevAng = new THREE.Vector3();
      const _gdCarryPrevCenter = new THREE.Vector3();
      let _gumTankPrevMwValid = false;
      let _gdCarryPrevMotionValid = false;
      const GUM_CELL_STRIDE = 2048;
      const GUM_CELL_OFF = 1024;
      const _gumCellMap = new Map();
      const _gumCellTouched = [];
      car = new THREE.Group();
      car.rotation.order = "YXZ";
      scene.add(car);

      const MAX_STEER_DEG = 28;
      const MAX_STEER_RAD = (MAX_STEER_DEG * Math.PI) / 180;
      const CAR_SCALE_MULTIPLIER = 1.24;
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
      const RAMP_JUMP_CAM_ZOOM_MATRIX_ORBIT_END = 0.38;
      const RAMP_JUMP_MATRIX_ZOOM_MIN_FRAC = 0.65;
      const RAMP_JUMP_SLOW_MO_DRIFT_SCALE = 0.18;
      const RAMP_JUMP_MATRIX_DRIFT_SCALE = 0.14;
      const RAMP_JUMP_CAM_TABLE_CLEARANCE = 0.28;
      const RAMP_JUMP_CAM_MAX_DOWN_DRIFT_FRAC = 0.12;
      const RAMP_JUMP_MATRIX_ORBIT = THREE.MathUtils.degToRad(160);
      const RAMP_JUMP_MATRIX_FRONT_AZIMUTH = RAMP_JUMP_MATRIX_ORBIT * 0.5;
      const RAMP_JUMP_MATRIX_ORBIT_AIR_START = 0.04;
      const RAMP_JUMP_MATRIX_ORBIT_AIR_END = 0.94;
      const RAMP_JUMP_EFFECT_LERP = 7;
      const RAMP_JUMP_LAND_CLEARANCE = 0.55;
      const RAMP_JUMP_EASE_IN_SEC = 0.32;
      const RAMP_JUMP_EASE_OUT_START = 1.35;
      const LAND_CAM_SHAKE_DURATION = 0.35;
      const LAND_CAM_SHAKE_LOOK = 0.55;
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

      let tableSpawn = new THREE.Vector3(0, 0, 0);
      let tableMinY = 0;
      let tableSurfaceY = 0;
      let tablePlateHalfX = Infinity, tablePlateHalfZ = Infinity;
      let tablePlateCenter = new THREE.Vector3();
      const _tableShadowFocus = new THREE.Vector3();
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
        _handWalkSmallFxIgniteT = -1;
      }

      function updateHandWalkZMove(dt) {
        maintainHandWalkArmatureLoop();
        if (!handWalkPart || _handWalkZPhase === 0) return;
        _handWalkZMoveT += dt;
        const t = Math.min(_handWalkZMoveT / HAND_WALK_Z_MOVE_SEC, 1);
        const ease = t * t * (3 - 2 * t);
        const zOut = _handWalkRestPos.z + HAND_WALK_Z_OFFSET;
        if (_handWalkZPhase === 1) {
          handWalkPart.position.z = THREE.MathUtils.lerp(
            _handWalkRestPos.z,
            zOut,
            ease,
          );
          if (t >= 1) {
            _handWalkZPhase = 2;
            _handWalkZMoveT = 0;
            clearHandWalkBigFxTrails();
            _handWalkBigFxWindSign = 1;
          }
        } else if (_handWalkZPhase === 2) {
          handWalkPart.position.z = THREE.MathUtils.lerp(
            zOut,
            _handWalkRestPos.z,
            ease,
          );
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
        _handWalkBigFxWind = 0;
        _handWalkBigFxWindSign = -1;
        _handWalkPrevZValid = false;
        clearHandWalkBigFxTrails();
        if (handWalkPart) {
          handWalkPart.position.copy(_handWalkRestPos);
          handWalkPart.updateMatrixWorld(true);
        }
        if (wasMoving) stopOfficeArmatureAnimation();
      }

      function getHandWalkFxWorldPosition(target) {
        const anchor = handPhisicsMesh || handNode0Mesh || handWalkPart;
        if (!anchor) return false;
        anchor.updateMatrixWorld(true);
        anchor.getWorldPosition(target);
        return true;
      }

      /** The first mode on a hit: the car touching the hand now, and not the frame before. */
      function updateHandHitFx(dt) {
        const touching = _handCarTouchedThisFrame;
        _handCarTouchedThisFrame = false;
        _handHitCooldown = Math.max(0, _handHitCooldown - dt);
        if (touching && !_handCarWasTouching && _handHitCooldown === 0 && _handWalkZPhase === 0) {
          _handHitT = 0;
          _handHitCooldown = HAND_HIT_FX.cooldownSec;
          playHandWalkWarningAnimation();
          initHandWalkSmallFxFlameOn();
        }
        _handCarWasTouching = touching;
        _handHitFx = 0;
        if (_handHitT >= 0) {
          _handHitT += dt;
          if (_handHitT < HAND_HIT_FX.holdSec) _handHitFx = 1;
          else _handHitT = -1;
        }
      }

      function updateHandWalkTrigger(dt) {
        updateHandHitFx(dt);
        let smallFxTarget = 0;
        let bigFxTarget = 0;
        let smallFxPos = null;
        let bigFxPos = null;

        if (_handWalkZPhase !== 0) {
          updateHandWalkZMove(dt);
          if (
            _handWalkZPhase !== 0 &&
            getHandWalkFxWorldPosition(_handWalkPartFxWorldPos)
          ) {
            smallFxPos = _handWalkPartFxWorldPos;
            bigFxPos = _handWalkPartFxWorldPos;
            smallFxTarget = 1;
            bigFxTarget = 1;
          }
          if (_handWalkZPhase !== 0) {
            updateHandWalkTriggerEffects(
              dt,
              smallFxTarget,
              smallFxPos,
              bigFxTarget,
              bigFxPos,
            );
            return;
          }
        }

        if (!handWalkTriggerMesh || !car || carFalling) {
          resetHandWalkTriggerCycle();
          resetHandWalkZMove();
          updateHandWalkTriggerEffects(
            dt,
            smallFxTarget,
            smallFxPos,
            bigFxTarget,
            bigFxPos,
          );
          return;
        }
        handWalkTriggerMesh.updateMatrixWorld(true);
        _handWalkTriggerBox.setFromObject(handWalkTriggerMesh);
        if (_handWalkTriggerBox.isEmpty()) {
          updateHandWalkTriggerEffects(
            dt,
            smallFxTarget,
            smallFxPos,
            bigFxTarget,
            bigFxPos,
          );
          return;
        }

        if (getHandWalkFxWorldPosition(_handWalkPartFxWorldPos)) {
          smallFxPos = _handWalkPartFxWorldPos;
        } else {
          handWalkTriggerMesh.getWorldPosition(_handWalkTriggerFxWorldPos);
          smallFxPos = _handWalkTriggerFxWorldPos;
        }

        const inside = _handWalkTriggerBox.containsPoint(car.position);
        if (!inside) {
          _handWalkTriggerWasInside = false;
          if (_handWalkZPhase === 0 && _handHitT < 0) stopOfficeArmatureAnimation(); // not while a hit's move plays
          if (_handWalkZTriggeredThisVisit && _handWalkZPhase === 0) {
            resetHandWalkTriggerCycle();
          } else if (!_handWalkZTriggeredThisVisit) {
            _handTriggerOutsideTime += dt;
            if (_handTriggerOutsideTime >= HAND_TRIGGER_LEAVE_RESET_SEC) {
              _handTriggerInsideTime = 0;
              _handTriggerOutsideTime = 0;
            }
          }
          if (
            _handWalkZPhase !== 0 &&
            getHandWalkFxWorldPosition(_handWalkPartFxWorldPos)
          ) {
            bigFxPos = _handWalkPartFxWorldPos;
            bigFxTarget = 1;
          }
          updateHandWalkTriggerEffects(
            dt,
            smallFxTarget,
            smallFxPos,
            bigFxTarget,
            bigFxPos,
          );
          return;
        }

        _handTriggerOutsideTime = 0;

        // Entering the zone no longer plays the first mode (a hit on the hand does: updateHandHitFx).
        _handWalkTriggerWasInside = true;

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
          _handWalkBigFxWindSign = -1;
          clearHandWalkBigFxTrails();
          startHandWalkArmatureLoop();
        }

        if (
          _handWalkZPhase !== 0 &&
          getHandWalkFxWorldPosition(_handWalkPartFxWorldPos)
        ) {
          smallFxPos = _handWalkPartFxWorldPos;
          bigFxPos = _handWalkPartFxWorldPos;
          smallFxTarget = 1;
          bigFxTarget = 1;
        }
        updateHandWalkZMove(dt);
        updateHandWalkTriggerEffects(
          dt,
          smallFxTarget,
          smallFxPos,
          bigFxTarget,
          bigFxPos,
        );
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
      // Touch driving (phones / tablets): writes the same `keys` as the keyboard.
      createTouchDrive({
        THREE,
        mount: getOfficeSceneMount(),
        getCamera: () => camera,
        getCar: () => car,
        getAngle: () => carState.angle,
        getCarLength: () => 2 * halfL * storedCarScale,
        getKeys: () => keys,
        enabled: () => _officeSceneRendering && isOfficeIntroDone() && !!car,
      });

      const GUM_RELEASE_BATCH = 15;
      let _gumReleaseIdx = -1;
      let _gumReleasedTimer = 0;

      const CUP_SLIDE_DISTANCE = 4;
      const CUP_SLIDE_DURATION = 500;
      const GUM_HIT_CUP_HIDE_MS = 1000;
      let _cupSlideActive = false;
      let _cupSlideStart = 0;
      let _cupOrigX = 0;
      let _gumHitCupHiddenUntil = 0;
      let _gumHitCupHidden = false;
      let _gumHitCupOpen = false;
      const _gumCupHidePrevVis = [];

      function _setGumCupNodesVisible(visible, recordPrev) {
        const roots = [gumsTankPhysicCupObject, gumsCupObject];
        for (let ri = 0; ri < roots.length; ri++) {
          const root = roots[ri];
          if (!root) continue;
          root.traverse((n) => {
            if (recordPrev) _gumCupHidePrevVis.push([n, n.visible]);
            n.visible = visible;
          });
        }
      }

      function hideGumTankPhysicCupForHit() {
        if (_gumHitCupHidden) {
          _gumHitCupHiddenUntil = performance.now() + GUM_HIT_CUP_HIDE_MS;
          _gumHitCupOpen = true;
          return;
        }
        _gumCupHidePrevVis.length = 0;
        _setGumCupNodesVisible(false, true);
        if (gumsTankCupBody && physicsWorld.bodies.includes(gumsTankCupBody)) {
          physicsWorld.removeBody(gumsTankCupBody);
        }
        _gumHitCupHidden = true;
        _gumHitCupOpen = true;
        _gumHitCupHiddenUntil = performance.now() + GUM_HIT_CUP_HIDE_MS;
      }

      function restoreGumTankPhysicCupAfterHit() {
        if (!_gumHitCupHidden) return;
        for (let i = 0; i < _gumCupHidePrevVis.length; i++) {
          const pair = _gumCupHidePrevVis[i];
          if (pair[0]) pair[0].visible = pair[1];
        }
        _gumCupHidePrevVis.length = 0;
        if (gumsTankCupBody && !physicsWorld.bodies.includes(gumsTankCupBody)) {
          physicsWorld.addBody(gumsTankCupBody);
        }
        _gumHitCupHidden = false;
        _gumHitCupOpen = _gumDispenserBecameDynamic; // after a hit the bottom exit stays open
        _gumHitCupHiddenUntil = 0;
      }

      function updateGumHitCupHide() {
        if (!_gumHitCupHidden) {
          _gumHitCupOpen = _gumDispenserBecameDynamic;
          return;
        }
        if (performance.now() >= _gumHitCupHiddenUntil) {
          restoreGumTankPhysicCupAfterHit();
          return;
        }
        _gumHitCupOpen = true;
      }

      function releaseGumsCup() {
        if (!gumsTankCupBody || gumsCupRemovedUntil > performance.now()) return;
        if (_cupSlideActive) return;
        _cupOrigX = gumsTankCupBody.position.x;
        _cupSlideActive = true;
        _cupSlideStart = performance.now();
        _gumReleaseIdx = 0;
        _gumReleasedTimer = 0;
        enableGumTankThickWalls();
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
      const _macCarSize = new THREE.Vector3();
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

      /**
       * The window glass refracts what's behind it (three's transmission). That
       * draws the whole room a second time each frame into a full-size buffer
       * (~37 ms of a 40 ms frame). false: plain transparent glass (same colour,
       * opacity and reflections, no refraction). true restores the refraction.
       */
      const OFFICE_WINDOW_GLASS_REFRACTION = false;
      /** The office model (it replaced office-table-embed94.gltf). */
      const OFFICE_SCENE_GLTF = "office-scene1.glb"; // binary office-scene1.gltf, original 4096² hand textures kept (57.2 MB -> 42.9 MB)
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
          officeAsset("panoramicView-4k.jpg"),
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
              transmission: OFFICE_WINDOW_GLASS_REFRACTION ? 0.92 : 0,
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
              officeAsset("poster1-2k.jpg"),
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
                  officeAsset("poster2-2k.jpg"),
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
            new THREE.TextureLoader().load(officeAsset("keyboard-image-2k.jpg"), (tex) => {
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
            if (perfSettings.shadows) enableMeshCastShadow(node, "wall");
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
        side: THREE.DoubleSide,
        shadowSide: THREE.DoubleSide,
      });

      function isTablePlateShadowReady() {
        if (getTablePlateShadowPose(_wallTableRef)) return true;
        return (
          Number.isFinite(tablePlateCenter.x) &&
          Number.isFinite(tablePlateCenter.z) &&
          (Math.abs(tablePlateCenter.x) > 0.05 ||
            Math.abs(tablePlateCenter.z) > 0.05)
        );
      }

      function getTableSideWallTableRef(out) {
        if (getTablePlateShadowPose(out)) return out;
        if (
          Number.isFinite(tablePlateCenter.x) &&
          Number.isFinite(tablePlateCenter.z)
        ) {
          out.copy(tablePlateCenter);
          return out;
        }
        out.set(0, 0, 0);
        return out;
      }

      function computeTableSideWallShadowFrame(wallNode) {
        if (!wallNode || !isTablePlateShadowReady()) return false;
        wallNode.updateMatrixWorld(true);
        _reflectionBox.setFromObject(wallNode);
        if (_reflectionBox.isEmpty()) return false;

        const center = _reflectionBox.getCenter(new THREE.Vector3());
        getTableSideWallTableRef(_wallTableRef);
        _wallTableRef.y = center.y;

        const faceCandidates = [
          new THREE.Vector3(_reflectionBox.min.x, center.y, center.z),
          new THREE.Vector3(_reflectionBox.max.x, center.y, center.z),
          new THREE.Vector3(center.x, center.y, _reflectionBox.min.z),
          new THREE.Vector3(center.x, center.y, _reflectionBox.max.z),
        ];
        let bestDist = Infinity;
        _wallInnerFace.copy(faceCandidates[0]);
        for (let i = 0; i < faceCandidates.length; i++) {
          const d = faceCandidates[i].distanceToSquared(_wallTableRef);
          if (d < bestDist) {
            bestDist = d;
            _wallInnerFace.copy(faceCandidates[i]);
          }
        }

        _wallShadowInward.subVectors(_wallTableRef, _wallInnerFace);
        _wallShadowInward.y = 0;
        if (_wallShadowInward.lengthSq() < 1e-6) _wallShadowInward.set(-1, 0, 0);
        else _wallShadowInward.normalize();
        return true;
      }

      function fixTableSideWallNormals(wallMesh, tableRef) {
        const geo = wallMesh?.geometry;
        if (!geo?.attributes?.position) return;
        if (!geo.attributes.normal) geo.computeVertexNormals();
        const normAttr = geo.attributes.normal;
        wallMesh.updateMatrixWorld(true);
        const wallCenter = new THREE.Box3()
          .setFromObject(wallMesh)
          .getCenter(new THREE.Vector3());
        const toTable = tableRef.clone().sub(wallCenter);
        toTable.y = 0;
        if (toTable.lengthSq() < 1e-6) return;
        toTable.normalize();
        const localNormal = new THREE.Vector3();
        const worldNormal = new THREE.Vector3();
        let facingTable = 0;
        let facingAway = 0;
        const step = Math.max(1, Math.floor(normAttr.count / 80));
        for (let i = 0; i < normAttr.count; i += step) {
          localNormal.fromBufferAttribute(normAttr, i);
          worldNormal.copy(localNormal).transformDirection(wallMesh.matrixWorld);
          if (worldNormal.dot(toTable) > 0) facingTable++;
          else facingAway++;
        }
        if (facingAway <= facingTable) return;
        for (let i = 0; i < normAttr.count; i++) {
          normAttr.setXYZ(
            i,
            -normAttr.getX(i),
            -normAttr.getY(i),
            -normAttr.getZ(i),
          );
        }
        normAttr.needsUpdate = true;
      }

      function getOrCreateTableSideWallShadowReceiver(wallMesh) {
        let receiver = wallMesh.getObjectByName("tableSideWallShadowReceiver");
        if (receiver) return receiver;
        if (!wallMesh.geometry) return null;
        receiver = new THREE.Mesh(
          wallMesh.geometry.clone(),
          tableSideWallShadowMaterial,
        );
        receiver.name = "tableSideWallShadowReceiver";
        receiver.castShadow = false;
        receiver.receiveShadow = true;
        receiver.frustumCulled = false;
        receiver.renderOrder = (wallMesh.renderOrder || 0) + 2;
        receiver.layers.set(TABLE_WALL_SHADOW_LAYER);
        const mat = receiver.material;
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -4;
        mat.polygonOffsetUnits = -4;
        wallMesh.add(receiver);
        tableSideWallShadowMeshes.push(receiver);
        return receiver;
      }

      function clearTableSideWallShadowMeshes() {
        for (let i = 0; i < tableSideWallShadowMeshes.length; i++) {
          const mesh = tableSideWallShadowMeshes[i];
          mesh.removeFromParent();
          mesh.geometry?.dispose();
          if (
            mesh.material?.dispose &&
            mesh.material !== tableSideWallShadowMaterial
          ) {
            mesh.material.dispose();
          }
        }
        tableSideWallShadowMeshes = [];
      }

      function applyWallShadowCasters(model) {
        if (!model || !perfSettings.shadows) return;
        const wallCasterNames = [
          "panHolder",
          "headphonesBase",
          "headphonesEars",
          "headphonesButtons",
          "headphonesLight",
          "techDesignerMagnet",
        ];
        model.traverse((node) => {
          if (!node.isMesh) return;
          const name = node.name || "";
          let isWallCaster = wallCasterNames.includes(name);
          if (!isWallCaster) isWallCaster = meshMatchesWallOnlyShadowRoot(node);
          if (isWallCaster) enableMeshCastShadow(node, "wall");
        });
        if (car) applyCastShadowsToObject3D(car, "both");
        applyHandShadows();
      }

      function refreshTableSideWallShadows(model) {
        if (!model) {
          clearTableSideWallShadowMeshes();
          return;
        }
        setupTableSideWallShadowReceivers(model);
        if (!perfSettings.shadows) return;
        applyWallShadowCasters(model);
        forceWallCasterShadowState(model);
        enforceTableSideWallShadowPolicy(model);
      }

      function applyTableSideWallReceiveShadow(model) {
        if (!model) return;
        model.traverse((node) => {
          if (!isTableSideWallMesh(node)) return;
          node.castShadow = false;
          node.receiveShadow = false;
          node.layers.disable(TABLE_WALL_SHADOW_LAYER);
        });
      }

      function setupTableSideWallShadowReceivers(model) {
        clearTableSideWallShadowMeshes();
        _wallShadowLightReady = false;
        if (!model) return;
        applyTableSideWallReceiveShadow(model);
        if (!perfSettings.shadows) return;
        const wallMesh = model.getObjectByName("tableSideWall");
        if (!wallMesh?.isMesh) return;
        model.updateMatrixWorld(true);
        if (!computeTableSideWallShadowFrame(wallMesh)) return;
        getTableSideWallTableRef(_wallTableRef);
        fixTableSideWallNormals(wallMesh, _wallTableRef);
        if (!getOrCreateTableSideWallShadowReceiver(wallMesh)) return;
        configureWallShadowCamera(wallMesh);
        updateTableWallShadowLight();
        applyWallShadowSettings(
          perfSettings.shadowMapSize > 0 ? perfSettings.shadowMapSize : 512,
          true,
        );
      }

      function isTableSideWallMesh(node) {
        if (!node?.isMesh) return false;
        const name = node.name || "";
        const parentName = (node.parent && node.parent.name) || "";
        return name === "tableSideWall" || parentName === "tableSideWall";
      }

      function enforceTableSideWallShadowPolicy(model) {
        if (!model) return;
        applyTableSideWallReceiveShadow(model);
      }

      function forceWallCasterShadowState(model) {
        if (!model || !perfSettings.shadows) return;
        const roots = [
          "panHolder",
          "headphonesBase",
          "headphonesEars",
          "headphonesButtons",
          "headphonesLight",
          "techDesignerMagnet",
        ];
        model.traverse((node) => {
          if (!node.isMesh) return;
          const name = node.name || "";
          let match = roots.includes(name);
          if (!match) match = nodeMatchesShadowRootList(node, roots);
          if (!match) return;
          node.castShadow = true;
          node.receiveShadow = false;
          node.layers.enable(TABLE_WALL_SHADOW_LAYER);
          node.layers.disable(TABLE_TOP_SHADOW_LAYER);
          prepareMaterialForWallShadow(node.material);
        });
      }

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
        applyTableSideWallReceiveShadow(model);
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

      const PLANT_VASE_STENCIL_REF = 1;

      function applyPlantVaseStencilWrite(material) {
        material.stencilWrite = true;
        material.stencilRef = PLANT_VASE_STENCIL_REF;
        material.stencilFunc = THREE.AlwaysStencilFunc;
        material.stencilFail = THREE.KeepStencilOp;
        material.stencilZFail = THREE.KeepStencilOp;
        material.stencilZPass = THREE.ReplaceStencilOp;
        material.depthWrite = true;
      }

      function applyPlantGroundStencilMask(material) {
        material.stencilWrite = false;
        material.stencilRef = PLANT_VASE_STENCIL_REF;
        material.stencilFunc = THREE.NotEqualStencilFunc;
        material.stencilFail = THREE.KeepStencilOp;
        material.stencilZFail = THREE.KeepStencilOp;
        material.stencilZPass = THREE.KeepStencilOp;
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
        function applyTerrazzo(meshes, stencilMask = false) {
          for (let i = 0; i < meshes.length; i++) {
            const m = meshes[i];
            if (m && m.material) {
              if (Array.isArray(m.material)) {
                for (let j = 0; j < m.material.length; j++) {
                  const mat = greenTerrazzoMat.clone();
                  if (stencilMask) applyPlantVaseStencilWrite(mat);
                  m.material[j] = mat;
                }
              } else {
                const mat = greenTerrazzoMat.clone();
                if (stencilMask) applyPlantVaseStencilWrite(mat);
                m.material = mat;
              }
            }
            if (stencilMask) m.renderOrder = 5;
          }
        }
        applyTerrazzo(plantVaseMeshes, true);
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

      /**
       * The charger cup (phoneChargerCup, the drawer's trigger): a light grey
       * instead of pure white (was 0xffffff), so it sits at the desk's
       * brightness in both modes: a white, fully rough disc on top of the dark
       * mode's desk fill read brighter than everything around it.
       */
      const PHONE_CHARGER_CUP = { color: 0xc0c0c8 };
      const phoneChargerCupMaterial = new THREE.MeshStandardMaterial({
        color: PHONE_CHARGER_CUP.color,
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
      let rampBackObject = null;
      let rampBackBody = null;
      let rampBackEntryDir = null;
      let rampLeftBlockingAxis = "z";
      let rampBackBlockingAxis = "x";
      const carRampRaycaster = new THREE.Raycaster();
      const carRampRayOrigin = new THREE.Vector3();
      const carRampRayFrontOrigin = new THREE.Vector3();
      const carRampRayRearOrigin = new THREE.Vector3();
      const carRampRayDir = new THREE.Vector3(0, -1, 0);
      const carRampWallRaycaster = new THREE.Raycaster();
      const _wallRayDir = new THREE.Vector3();
      const _wallRayOrigin = new THREE.Vector3();
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
      const VERTICAL_WALL_NY_MAX = 0.18;
      const MAX_STEP_CLIMB_RATIO = 0.4;
      const RAMP_SIDE_PUSH_BACK = 0.6;
      function isVerticalWallNormalY(ny) {
        return Math.abs(ny) <= VERTICAL_WALL_NY_MAX;
      }
      function stopCarAgainstWallNormal(nx, nz, pushMult = 1) {
        carState.speed = 0;
        const len = Math.sqrt(nx * nx + nz * nz) || 1;
        const push = RAMP_SIDE_PUSH_BACK * storedCarScale * pushMult;
        car.position.x += (nx / len) * push;
        car.position.z += (nz / len) * push;
      }
      function canClimbDriveablePropStep(pb, propTop, supportY) {
        const climbMax = pb?._driveableStep;
        if (climbMax == null) return false;
        const stepHeight = propTop - supportY;
        return stepHeight <= climbMax + 0.12;
      }
      const _propLocalOff = new THREE.Vector3();
      const _propInvQuat = new THREE.Quaternion();
      function propXZOverlap(pb, he, bx, bz, px, pz, radius) {
        _propLocalOff.set(px - bx, 0, pz - bz);
        const q = pb?.quaternion;
        if (q) {
          _propInvQuat.set(q.x, q.y, q.z, q.w);
          if (_propInvQuat.lengthSq() > 0.25) {
            _propInvQuat.invert();
            _propLocalOff.applyQuaternion(_propInvQuat);
          }
        }
        return (
          Math.abs(_propLocalOff.x) < he.x + radius &&
          Math.abs(_propLocalOff.z) < he.z + radius
        );
      }
      function resolveCarMacScreenFrame(he, bx, by, bz, carR) {
        const dx = car.position.x - bx;
        const dy = car.position.y - by;
        const dz = car.position.z - bz;
        const carHeY = Math.max(carBottomOffsetY, carR * 0.45);
        if (Math.abs(dx) >= he.x + carR) return false;
        if (Math.abs(dz) >= he.z + carR) return false;
        if (Math.abs(dy) >= he.y + carHeY) return false;
        const overlapX = he.x + carR - Math.abs(dx);
        const overlapY = he.y + carHeY - Math.abs(dy);
        const overlapZ = he.z + carR - Math.abs(dz);
        if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) return false;
        if (overlapX < overlapZ) {
          car.position.x += (dx >= 0 ? 1 : -1) * overlapX;
        } else {
          car.position.z += (dz >= 0 ? 1 : -1) * overlapZ;
        }
        carState.speed = 0;
        return true;
      }
      const _gdCarPush = new THREE.Vector3();
      const _gdCarQuat = new THREE.Quaternion();
      /** Push the car out of the gum dispenser box, in the box's own rotated frame. */
      function resolveCarGumDispenserBox(he, bx, by, bz, carR) {
        const pb = gumDispenserPhysBody;
        if (!pb) return false;
        const q = pb.quaternion;
        _gdCarPush.set(car.position.x - bx, 0, car.position.z - bz);
        _gdCarQuat.set(q.x, q.y, q.z, q.w);
        if (_gdCarQuat.lengthSq() > 0.25) {
          _propInvQuat.copy(_gdCarQuat).invert();
          _gdCarPush.applyQuaternion(_propInvQuat);
        }
        const dx = _gdCarPush.x;
        const dz = _gdCarPush.z;
        const dy = car.position.y - by;
        const carHeY = Math.max(carBottomOffsetY, carR * 0.45);
        if (Math.abs(dx) >= he.x + carR) return false;
        if (Math.abs(dz) >= he.z + carR) return false;
        if (Math.abs(dy) >= he.y + carHeY) return false;
        const overlapX = he.x + carR - Math.abs(dx);
        const overlapZ = he.z + carR - Math.abs(dz);
        if (overlapX <= 0 || overlapZ <= 0) return false;
        if (overlapX < overlapZ) {
          _gdCarPush.set(Math.sign(dx || 1) * overlapX, 0, 0);
        } else {
          _gdCarPush.set(0, 0, Math.sign(dz || 1) * overlapZ);
        }
        _gdCarPush.applyQuaternion(_gdCarQuat);
        car.position.x += _gdCarPush.x;
        car.position.z += _gdCarPush.z;
        carState.speed = 0;
        return true;
      }
      let _gdLastKnockMs = 0;
      let _gdKnockedThisCarStep = false;
      /** The block stops the car before Cannon can shove, so pass the knock on from pre-block speed. */
      function knockGumDispenserFromCar(hitSpeed, force) {
        const pb = gumDispenserPhysBody;
        if (!pb || pb._frozen) return;
        const abs = Math.abs(hitSpeed);
        if (!force && abs < 1.0) return;
        const now = performance.now();
        if (!force && now - _gdLastKnockMs < 90) return;
        _gdLastKnockMs = now;
        const fx = Math.sin(carState.angle);
        const fz = Math.cos(carState.angle);
        const sign = hitSpeed >= 0 ? 1 : -1;
        const knock = Math.min(8.5, Math.max(3.5, abs * 0.55));
        pb.wakeUp();
        pb.velocity.x += fx * sign * knock;
        pb.velocity.z += fz * sign * knock;
        if (pb.velocity.y > 0.35) pb.velocity.y = 0.35;
        const ox = car.position.x - pb.position.x;
        const oz = car.position.z - pb.position.z;
        pb.angularVelocity.y += (ox * fz - oz * fx) * sign * 0.1;
        const hs = Math.hypot(pb.velocity.x, pb.velocity.z);
        if (hs > 10) {
          const s = 10 / hs;
          pb.velocity.x *= s;
          pb.velocity.z *= s;
        }
      }
      function syncCarWheelWorldPositions() {
        const wheels = [wheelFL, wheelFR, wheelRL, wheelRR];
        for (let wi = 0; wi < 4; wi++) {
          const w = wheels[wi];
          if (!w?._canonMesh) continue;
          w._canonMesh.getWorldPosition(_wheelSyncWorldPos[wi]);
        }
      }
      function anyWheelOverlapsPropXZ(he, bx, bz) {
        const wheels = [wheelFL, wheelFR, wheelRL, wheelRR];
        for (let wi = 0; wi < 4; wi++) {
          const w = wheels[wi];
          if (!w) continue;
          const wr = (w._physRadius || WHEEL_RADIUS) * storedCarScale;
          const wx = _wheelSyncWorldPos[wi].x;
          const wz = _wheelSyncWorldPos[wi].z;
          if (
            Math.abs(wx - bx) < he.x + wr &&
            Math.abs(wz - bz) < he.z + wr
          ) {
            return true;
          }
        }
        return false;
      }
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
      let jumpStartTime = 0;
      let jumpLaunchSpeed = 0;
      let jumpInitialVelY = 0;
      let _rampJumpSimAirTime = 0;
      let _carLandShakePending = false;
      const LANDING_TILT_LERP = 120;
      const LANDING_RECOVERY_DURATION = 0.3;
      let wasInAir = false;
      let wasOnRamp = false;
      let wasOnLeftRamp = false;
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
      let _carAnyWheelOnRamp = false;
      const _carWheelSurfY = [0, 0, 0, 0];
      const _carForward = new THREE.Vector3();
      const _quatY = new THREE.Quaternion();
      const _quatTilt = new THREE.Quaternion();
      const _tiltAxis = new THREE.Vector3();
      let tablePlateBody = null;
      let floorPhysBody = null;
      let tableSideWallBody = null;
      let gumsTankObject = null;
      let gumsTankPhysicObject = null;
      let gumsTankInnerObject = null;
      let gumsTankPhysicCupObject = null;
      let gumsCupObject = null;
      let gumsTankPhysBody = null;
      let gumsTankTrimesh = null;
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
      /** 0..1: the intro shows the hand's green flame (set by the intro only). */
      let _introHandFxDemo = 0;
      /**
       * The hand's first mode (its small warning move and the green flame) plays when
       * the car drives into the hand (its collision box), not when the car enters the
       * trigger zone. The walk (the second mode) keeps its trigger: the car held in the
       * zone for HAND_TRIGGER_HOLD_SEC.
       */
      const HAND_HIT_FX = {
        holdSec: 1.4, // the green flame stays on this long after a hit, then fades
        cooldownSec: 2, // a new hit plays it again only after this
      };
      let _handCarTouchedThisFrame = false; // set by the car's hand collision (resolveCarHandPhysicsBlock)
      let _handCarWasTouching = false;
      let _handHitT = -1; // seconds since the last hit (-1: none showing)
      let _handHitCooldown = 0;
      let _handHitFx = 0; // 0..1: the first mode's flame (read by updateHandWalkTriggerEffects)
      let _handWalkZMoveT = 0;
      let _handWalkZTriggeredThisVisit = false;
      const HAND_TRIGGER_HOLD_SEC = 3;
      const HAND_WALK_Z_OFFSET = 14;
      const HAND_WALK_Z_MOVE_SEC = 1.25;
      const _handBlockBox = new THREE.Box3();
      const _handWalkTriggerBox = new THREE.Box3();
      const _handWalkTriggerFxWorldPos = new THREE.Vector3();
      const _handWalkPartFxWorldPos = new THREE.Vector3();
      let _handWalkFxTime = 0;
      let _handWalkSmallFxFade = 0;
      let _handWalkBigFxFade = 0;
      const HAND_WALK_SMALL_IGNITE_SEC = 0.38;
      let _handWalkSmallFxIgniteT = -1;
      let _handWalkPrevZ = 0;
      let _handWalkPrevZValid = false;
      let _handWalkBigFxWind = 0;
      let _handWalkBigFxWindSign = -1;
      const HAND_WALK_BIG_FX_WIND_MAX = 0.95;
      let _handWalkFxPivotGizmo = null;
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
      const PHYS_GROUP_DESK_STATIC = 1024;
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
      /**
       * A trimesh's AABB query keeps only the triangles whose own box overlaps the query box.
       * cannon's octree returns every triangle stored at a node the box touches, and long
       * triangles (the gum tank's walls) sit near its root: ~540 of the tank's 1,320 came back
       * for each gum, ~66 ms of narrowphase per physics step while the 230 gums settle.
       * A triangle outside the box can't touch the shape, so contacts are unchanged.
       */
      function tightenTrimeshAabbQuery(trimesh) {
        const v = trimesh.vertices;
        const ix = trimesh.indices;
        const triCount = ix.length / 3;
        const box = new Float32Array(triCount * 6); // per triangle: min x y z, max x y z (unscaled)
        for (let t = 0; t < triCount; t++) {
          const o = t * 6;
          box[o] = box[o + 1] = box[o + 2] = Infinity;
          box[o + 3] = box[o + 4] = box[o + 5] = -Infinity;
          for (let k = 0; k < 3; k++) {
            const vi = ix[t * 3 + k] * 3;
            for (let a = 0; a < 3; a++) {
              const c = v[vi + a];
              if (c < box[o + a]) box[o + a] = c;
              if (c > box[o + 3 + a]) box[o + 3 + a] = c;
            }
          }
        }
        const treeQuery = trimesh.getTrianglesInAABB.bind(trimesh);
        trimesh.getTrianglesInAABB = (aabb, result) => {
          const start = result.length;
          treeQuery(aabb, result);
          const s = trimesh.scale;
          const l = aabb.lowerBound;
          const u = aabb.upperBound;
          const lx = Math.min(l.x / s.x, u.x / s.x), ux = Math.max(l.x / s.x, u.x / s.x);
          const ly = Math.min(l.y / s.y, u.y / s.y), uy = Math.max(l.y / s.y, u.y / s.y);
          const lz = Math.min(l.z / s.z, u.z / s.z), uz = Math.max(l.z / s.z, u.z / s.z);
          let w = start;
          for (let i = start; i < result.length; i++) {
            const o = result[i] * 6;
            if (box[o] > ux || box[o + 3] < lx || box[o + 1] > uy || box[o + 4] < ly || box[o + 2] > uz || box[o + 5] < lz) continue;
            result[w++] = result[i];
          }
          result.length = w;
          return result;
        };
        return trimesh;
      }
      // Pair bodies by their boxes, not bounding spheres: a flat desk box's sphere covers every gum.
      physicsWorld.broadphase.useBoundingBoxes = true;
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
      let musaPhysBody = null;
      let duckBodyPhysBody = null;
      let panHolderPhysBody = null;

      /** Gums in the machine (80 filled about a third of the tank, 380 about 78%; 230 fills it to ~55%). */
      const GUM_COUNT = 230;
      /**
       * Gums out of the machine, on the table: spread out more, roll farther,
       * bounce a little, and never sink into the table.
       * - exitKick: random sideways speed added as a gum leaves the bottom hole
       *   (world units / s; gravity here is 480), in a random direction around
       *   the way it was already moving (± spreadDeg).
       * - friction / restitution: gum on the table (were 0.6 / 0.05).
       * - exitedAngularDamping: spin damping once out (was 0.9): rolls farther.
       * - edgeBounce: near the table's edge, a gum rolling outward is turned back
       *   with this share of its speed (stays on the table, like a soft lip).
       * - sinkTolerance: a gum's centre may dip this share of its radius below
       *   the top before it is lifted back (the car can press it down).
       */
      const GUM_TABLE = {
        exitKick: { min: 4, max: 10 },
        spreadDeg: 75,
        friction: 0.42,
        restitution: 0.18,
        exitedAngularDamping: 0.6,
        edgeBounce: 0.35,
        edgeMargin: 1.5, // in radii from the edge
        sinkTolerance: 0.05,
        plateThickness: 0.5, // the table body's thickness (below this it's off the table)
      };
      /**
       * Bottle and certified card physics (both were one box with heavy damping
       * 0.95 / 0.4 and never slept):
       * - bottle: three cylinders matching its parts (base, body, cap); its
       *   origin is the centre of mass from their volumes (the base heavier), so
       *   it tips, falls and rolls like a bottle;
       * - certified card: one box matching the slab (its real shape);
       * - realistic mass, light damping, table friction / low bounce, sleep once
       *   settled; after each step pushed out of the car and kept above the table.
       */
      const KNOCKABLE_PHYS = {
        bottle: { mass: 6, linearDamping: 0.12, angularDamping: 0.55, segments: 14, density: { base: 2, body: 1, cup: 1 } },
        certified: { mass: 2.5, linearDamping: 0.15, angularDamping: 0.35 },
        sleep: { speed: 0.3, time: 0.5 },
        table: { friction: 0.5, restitution: 0.05 },
        car: { friction: 0.45, restitution: 0.05 },
        overlapTolerance: 0.01, // overlaps shallower than this are left to the solver
        sinkTolerance: 0.06, // lowest point allowed below the table top (above normal contact depth, so resting objects aren't nudged and can sleep)
      };

      const GUM_PHYS_FIXED_STEP = 1 / 120;
      const GUM_PHYS_FIXED_STEP_DYNAMIC = 1 / 60;
      const GUM_PHYS_MAX_SUBSTEPS_FILL = 5;
      const GUM_PHYS_MAX_SUBSTEPS_MIXED = 5;
      /** Match the gumsTankPhysic mesh exactly — inflation opened holes vs the wireframe. */
      const GUM_TANK_TRIMESH_SCALE = 1;
      /** Physics sphere matches visual radius so spheres do not sit inside the wall and pop through. */
      const GUM_PHYS_RADIUS_SCALE = 1;
      const gumBodies = [];
      let gumInstancedMesh = null;
      const _gumSyncM = new THREE.Matrix4();
      const _gumSyncQ = new THREE.Quaternion();
      const _gumSyncP = new THREE.Vector3();
      const _gumSyncS = new THREE.Vector3(1, 1, 1);
      const gumReleased = new Set();
      let _gumRepulsionFrame = 0;
      let _gumPrevFrameTankAllStatic = false;
      let gumRadiusGlobal = 0.02;
      let gumsAddedCount = 0;
      let gumsReadyToDrop = false;
      let nextGumDropTime = 0;
      /** Ms between spawning each gum batch (only used if staggered drop is re-enabled). */
      const GUM_DROP_INTERVAL = 16;
      const GUM_DROP_COLUMN_COUNT = 2;
      const GUM_FALL_SPEED_CAP = 10;
      const GUM_RELEASED_FALL_SPEED_CAP = 30;
      const GUM_RELEASED_SPEED_CAP = 34;
      const GUM_RELEASED_LINEAR_DAMPING = 0.12;
      const GUM_SPAWN_PHYS_WARMUP_STEPS = 56;
      function spawnAllGumsIntoTank() {
        if (
          !gumBodies.length ||
          !physicsWorld ||
          !_gumTankClampLocal ||
          !gumsTankPhysBody
        )
          return;
        gumsTankPhysicObject.updateMatrixWorld(true);
        const c = _gumTankClampLocal;
        _gumTankMwCached.copy(gumsTankPhysicObject.matrixWorld);
        _invTankMwGumClamp.copy(_gumTankMwCached).invert();

        const colCount = Math.max(
          1,
          gumsDropColumnXZ.length || GUM_DROP_COLUMN_COUNT,
        );
        const layerSpacing = gumRadiusGlobal * 2.05;
        const tankInnerHeight = c.maxY - c.minY;
        const maxLayers = Math.max(
          1,
          Math.floor(tankInnerHeight / layerSpacing),
        );

        for (let gi = 0; gi < gumBodies.length; gi++) {
          const b = gumBodies[gi];
          const colIdx = gi % colCount;
          const stackLayer = Math.floor(gi / colCount) % maxLayers;
          const col =
            gumsDropColumnXZ.length >= colCount
              ? gumsDropColumnXZ[colIdx]
              : { x: gumsDropCenterX, z: gumsDropCenterZ };
          const jitter = gumRadiusGlobal * 0.55;
          _gumClampTmp.set(col.x, c.minY, col.z);
          _gumClampTmp.applyMatrix4(_invTankMwGumClamp);
          let lx = THREE.MathUtils.clamp(
            _gumClampTmp.x + (Math.random() - 0.5) * jitter,
            c.minX,
            c.maxX,
          );
          let lz = THREE.MathUtils.clamp(
            _gumClampTmp.z + (Math.random() - 0.5) * jitter,
            c.minZ,
            c.maxZ,
          );
          const ly = Math.max(
            c.minY + gumRadiusGlobal * 1.05,
            c.maxY - gumRadiusGlobal * 1.1 - stackLayer * layerSpacing,
          );
          _gumClampTmp.set(lx, ly, lz);
          _gumClampTmp.applyMatrix4(_gumTankMwCached);
          b.position.set(_gumClampTmp.x, _gumClampTmp.y, _gumClampTmp.z);
          b.velocity.set(0, 0, 0);
          b.angularVelocity.set(0, 0, 0);
          b.force.set(0, 0, 0);
          b.torque.set(0, 0, 0);
          b._exitedGumTank = false;
          b._inGumChute = false;
          if (b.type === CANNON.Body.STATIC) {
            b.type = CANNON.Body.DYNAMIC;
            b.mass = 0.5;
            b.updateMassProperties();
          }
          b.wakeUp();
          if (!physicsWorld.bodies.includes(b)) physicsWorld.addBody(b);
          _debugGumSet.add(b);
        }
        gumsAddedCount = gumBodies.length;
        gumsReadyToDrop = false;
        gumsTankSettleAccum = 0;
        gumsPostFillElapsed = 0;

        const fixedStep = GUM_PHYS_FIXED_STEP;
        const gentleWarmupSteps = Math.max(
          0,
          GUM_SPAWN_PHYS_WARMUP_STEPS - 20,
        );
        for (let w = 0; w < GUM_SPAWN_PHYS_WARMUP_STEPS; w++) {
          const gentle = w < gentleWarmupSteps;
          for (let gi = 0; gi < gumsAddedCount; gi++) {
            const gb = gumBodies[gi];
            if (gb.type === CANNON.Body.STATIC) continue;
            const v = gb.velocity;
            if (v.y < -GUM_FALL_SPEED_CAP) v.y = -GUM_FALL_SPEED_CAP;
            const spd = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
            if (spd > GUM_FALL_SPEED_CAP) {
              const sc = GUM_FALL_SPEED_CAP / spd;
              v.x *= sc;
              v.y *= sc;
              v.z *= sc;
            }
          }
          clampGumsInsideTankLocalAabb(gentle);
          physicsWorld.step(fixedStep);
          separateOverlappingGumSpheres(true);
          clampGumsInsideTankLocalAabb(gentle);
        }
        clampGumsInsideTankLocalAabb(false);
        syncGumInstancedTransforms();
      }

      let gumsDropCenterX = 0;
      let gumsDropCenterZ = 0;
      let gumsDropTopY = 0;
      /** World-space (x,z) spawn columns; length `GUM_DROP_COLUMN_COUNT`; round-robin index. */
      let gumsDropColumnXZ = [];
      /** Seconds all tank gums stay slow before forcing STATIC (Cannon sleep is often delayed by clamp/separation passes). */
      let gumsTankSettleAccum = 0;
      /** Real time after last gum spawned; backs up velocity-based settle (angular vel from contacts often never drops). */
      let gumsPostFillElapsed = 0;
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
      }
      let _gumsSpawnPending = false;
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
          friction: 0.55,
          restitution: 0.0,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 4,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(gumMaterial, tablePlatePhysicsMaterial, {
          friction: GUM_TABLE.friction,
          restitution: GUM_TABLE.restitution,
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
          friction: KNOCKABLE_PHYS.table.friction,
          restitution: KNOCKABLE_PHYS.table.restitution,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 3,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(bottleMaterial, carMaterial, {
          friction: KNOCKABLE_PHYS.car.friction,
          restitution: KNOCKABLE_PHYS.car.restitution,
          contactEquationStiffness: 5e6,
          contactEquationRelaxation: 4,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(certifiedMaterial, tablePlatePhysicsMaterial, {
          friction: KNOCKABLE_PHYS.table.friction,
          restitution: KNOCKABLE_PHYS.table.restitution,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 3,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(certifiedMaterial, carMaterial, {
          friction: KNOCKABLE_PHYS.car.friction,
          restitution: KNOCKABLE_PHYS.car.restitution,
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
        new CANNON.ContactMaterial(bottleMaterial, propMaterial, {
          friction: 0.75,
          restitution: 0.02,
          contactEquationStiffness: 1e8,
          contactEquationRelaxation: 3,
        }),
      );
      physicsWorld.addContactMaterial(
        new CANNON.ContactMaterial(gumDispenserMaterial, tablePlatePhysicsMaterial, {
          friction: 0.22,
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
      let _chargerFxTime = 0;
      let _chargerFxFade = 0;
      const _chargerFxWorldPos = new THREE.Vector3();

      const pen1Material = new THREE.MeshStandardMaterial({ color: 0xe6cc2e });
      const pen2Material = new THREE.MeshStandardMaterial({ color: 0x1ab9e8 });

      const duckBodyMaterial = new THREE.MeshStandardMaterial({
        color: 0xf7d308,
        roughness: 0.95,
        metalness: 0,
      });
      const duckMakorMaterial = new THREE.MeshStandardMaterial({
        color: 0xe0600f, // deeper, darker orange (was 0xff8c00)
        roughness: 0.95,
        metalness: 0,
      });
      const duckEyesMaterial = new THREE.MeshStandardMaterial({
        color: 0xfafafa,
        roughness: 0.95,
        metalness: 0,
      });
      const headphonesPlasticMaterial = new THREE.MeshStandardMaterial({
        color: 0x525252,
        roughness: 0.86,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      const headphonesEarsMaterial = new THREE.MeshStandardMaterial({
        color: 0x686868,
        roughness: 0.96,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      const headphonesLightMaterial = new THREE.MeshStandardMaterial({
        color: 0x33ee55,
        emissive: 0x22ff66,
        emissiveIntensity: 3.4,
        roughness: 0.08,
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

      function applyGumsTankMaterial(root) {
        if (!root) return;
        root.traverse((node) => {
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

      function applyAllGumDispenserMaterials() {
        if (_currentWorldModel) {
          applyGumsTankMaterial(_currentWorldModel);
          applyGumsPlasticMaterials(_currentWorldModel);
        }
        if (gumDispenserGroup) {
          applyGumsTankMaterial(gumDispenserGroup);
          applyGumsPlasticMaterials(gumDispenserGroup);
        }
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
        "gumsRamp",
      ];

      function applyGumsPlasticMaterials(root) {
        if (!root) return;
        root.traverse((node) => {
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

      /**
       * Outer + inner AABB in gumsTankPhysic local space.
       * Inner bounds come from gumsTankInner (if present) or inner-facing shell triangles
       * after Blender solidify / wall thickness.
       */
      function computeGumTankBoundsFromPhysicMesh(physicObj) {
        if (!physicObj) return null;
        physicObj.updateMatrixWorld(true);
        const invPhys = new THREE.Matrix4()
          .copy(physicObj.matrixWorld)
          .invert();

        if (gumsTankInnerObject) {
          gumsTankInnerObject.updateMatrixWorld(true);
          const innerBox = new THREE.Box3();
          innerBox.makeEmpty();
          const pt = new THREE.Vector3();
          gumsTankInnerObject.traverse((node) => {
            if (!node.isMesh || !node.geometry) return;
            node.geometry.computeBoundingBox();
            const bb = node.geometry.boundingBox;
            if (!bb || bb.isEmpty()) return;
            for (let b = 0; b < 8; b++) {
              pt.set(
                b & 1 ? bb.max.x : bb.min.x,
                b & 2 ? bb.max.y : bb.min.y,
                b & 4 ? bb.max.z : bb.min.z,
              );
              pt.applyMatrix4(node.matrixWorld).applyMatrix4(invPhys);
              innerBox.expandByPoint(pt);
            }
          });
          const outer = new THREE.Box3();
          outer.makeEmpty();
          physicObj.traverse((node) => {
            if (!node.isMesh || !node.geometry) return;
            node.geometry.computeBoundingBox();
            const bb = node.geometry.boundingBox;
            if (!bb || bb.isEmpty()) return;
            for (let b = 0; b < 8; b++) {
              pt.set(
                b & 1 ? bb.max.x : bb.min.x,
                b & 2 ? bb.max.y : bb.min.y,
                b & 4 ? bb.max.z : bb.min.z,
              );
              pt.applyMatrix4(node.matrixWorld).applyMatrix4(invPhys);
              outer.expandByPoint(pt);
            }
          });
          if (outer.isEmpty()) return null;
          return {
            outer,
            inner: innerBox.isEmpty() ? null : innerBox,
          };
        }

        const outer = new THREE.Box3();
        outer.makeEmpty();
        const v0 = new THREE.Vector3();
        const v1 = new THREE.Vector3();
        const v2 = new THREE.Vector3();
        const e1 = new THREE.Vector3();
        const e2 = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const centroid = new THREE.Vector3();
        const toCenter = new THREE.Vector3();

        const expandOuter = (node) => {
          if (!node.isMesh || !node.geometry) return;
          const pos = node.geometry.attributes.position;
          if (!pos) return;
          const mw = node.matrixWorld;
          for (let i = 0; i < pos.count; i++) {
            v0.fromBufferAttribute(pos, i).applyMatrix4(mw).applyMatrix4(invPhys);
            outer.expandByPoint(v0);
          }
        };

        physicObj.traverse(expandOuter);
        if (outer.isEmpty()) return null;

        const center = outer.getCenter(new THREE.Vector3());
        const inner = new THREE.Box3();
        inner.makeEmpty();
        let innerTriCount = 0;

        const visitTriangle = (a, b, c) => {
          v0.copy(a);
          v1.copy(b);
          v2.copy(c);
          e1.subVectors(v1, v0);
          e2.subVectors(v2, v0);
          normal.crossVectors(e1, e2);
          const nl = normal.length();
          if (nl < 1e-8) return;
          normal.multiplyScalar(1 / nl);
          centroid.copy(v0).add(v1).add(v2).multiplyScalar(1 / 3);

          let isInner = false;
          if (normal.y > 0.55) {
            isInner = true;
          } else if (normal.y < -0.55) {
            isInner = false;
          } else {
            const horiz = Math.hypot(normal.x, normal.z);
            if (horiz > 0.35) {
              toCenter.set(center.x - centroid.x, 0, center.z - centroid.z);
              if (toCenter.lengthSq() > 1e-8) {
                toCenter.normalize();
                if (normal.dot(toCenter) > 0.2) isInner = true;
              }
            }
          }
          if (!isInner) return;
          innerTriCount++;
          inner.expandByPoint(v0);
          inner.expandByPoint(v1);
          inner.expandByPoint(v2);
        };

        const scanInner = (node) => {
          if (!node.isMesh || !node.geometry) return;
          const geo = node.geometry;
          const pos = geo.attributes.position;
          if (!pos) return;
          const idx = geo.index;
          const mw = node.matrixWorld;
          const toLocal = (i, out) => {
            out.fromBufferAttribute(pos, i).applyMatrix4(mw).applyMatrix4(invPhys);
          };
          if (idx) {
            for (let i = 0; i < idx.count; i += 3) {
              toLocal(idx.getX(i), v0);
              toLocal(idx.getX(i + 1), v1);
              toLocal(idx.getX(i + 2), v2);
              visitTriangle(v0, v1, v2);
            }
          } else {
            for (let i = 0; i + 2 < pos.count; i += 3) {
              toLocal(i, v0);
              toLocal(i + 1, v1);
              toLocal(i + 2, v2);
              visitTriangle(v0, v1, v2);
            }
          }
        };

        physicObj.traverse(scanInner);
        return {
          outer,
          inner: innerTriCount >= 4 && !inner.isEmpty() ? inner : null,
        };
      }

      /** Inner pipe radius vs local Y from gumsTankPhysic verts (globe is wide; chute is narrow). */
      function buildGumTankPipeProfile(physicObj) {
        if (!physicObj) return null;
        physicObj.updateMatrixWorld(true);
        const invPhys = new THREE.Matrix4()
          .copy(physicObj.matrixWorld)
          .invert();
        const v = new THREE.Vector3();
        const ys = [];
        const xs = [];
        const zs = [];
        physicObj.traverse((node) => {
          if (!node.isMesh || !node.geometry) return;
          const pos = node.geometry.attributes.position;
          if (!pos) return;
          const mw = node.matrixWorld;
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(mw).applyMatrix4(invPhys);
            ys.push(v.y);
            xs.push(v.x);
            zs.push(v.z);
          }
        });
        const n = ys.length;
        if (n < 8) return null;
        let ax = 0;
        let az = 0;
        let y0 = Infinity;
        let y1 = -Infinity;
        for (let i = 0; i < n; i++) {
          ax += xs[i];
          az += zs[i];
          if (ys[i] < y0) y0 = ys[i];
          if (ys[i] > y1) y1 = ys[i];
        }
        ax /= n;
        az /= n;
        const nb = 32;
        const binMin = new Array(nb).fill(Infinity);
        const binN = new Array(nb).fill(0);
        const span = Math.max(1e-6, y1 - y0);
        for (let i = 0; i < n; i++) {
          const r = Math.hypot(xs[i] - ax, zs[i] - az);
          if (r < 0.04) continue;
          const b = Math.min(nb - 1, Math.floor(((ys[i] - y0) / span) * nb));
          binN[b]++;
          if (r < binMin[b]) binMin[b] = r;
        }
        const radii = new Float32Array(nb);
        const known = [];
        for (let b = 0; b < nb; b++) {
          if (binN[b] > 0) known.push(b);
        }
        if (known.length < 2) return null;
        for (let k = 0; k < known.length; k++) {
          const b = known[k];
          radii[b] = binMin[b];
          if (k + 1 < known.length) {
            const b1 = known[k + 1];
            const r0 = binMin[b];
            const r1 = binMin[b1];
            for (let m = b + 1; m < b1; m++) {
              const t = (m - b) / (b1 - b);
              radii[m] = r0 + (r1 - r0) * t;
            }
          }
        }
        return { axisX: ax, axisZ: az, y0, y1, radii };
      }

      function gumTankMaxHorizAtLocalY(c, ly, gumR) {
        const radii = c.radii;
        if (!radii || !radii.length) {
          const inner =
            c.innerR != null
              ? c.innerR
              : Math.min(c.maxX - c.minX, c.maxZ - c.minZ) * 0.5;
          return Math.max(gumR * 0.2, inner - gumR * 1.05);
        }
        const t = (ly - c.profY0) / Math.max(1e-6, c.profY1 - c.profY0);
        const u = THREE.MathUtils.clamp(t, 0, 1) * (radii.length - 1);
        const i = Math.min(radii.length - 2, Math.max(0, Math.floor(u)));
        const f = u - i;
        const inner = radii[i] * (1 - f) + radii[i + 1] * f;
        return Math.max(gumR * 0.2, inner - gumR * 1.08);
      }

      function findGumsTank(model) {
        model.traverse((node) => {
          const raw = node.name || "";
          const name = raw.toLowerCase();
          if (!gumsTankObject && (raw === "gumsTank" || name === "gumstank"))
            gumsTankObject = node;
          if (!gumsTankPhysicObject && raw === "gumsTankPhysic")
            gumsTankPhysicObject = node;
          if (!gumsTankInnerObject && raw === "gumsTankInner")
            gumsTankInnerObject = node;
          if (!gumsTankPhysicCupObject && raw === "gumsTankPhysicCup")
            gumsTankPhysicCupObject = node;
          if (!gumsCupObject && (raw === "gumsCup" || name === "gumscup"))
            gumsCupObject = node;
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

      function makeRampRaycastable(node) {
        const ensureMat = (mesh) => {
          if (!mesh.isMesh) return;
          if (!mesh.material) {
            mesh.material = new THREE.MeshBasicMaterial({
              transparent: true,
              opacity: 0,
              depthWrite: false,
            });
            return;
          }
          if (Array.isArray(mesh.material)) {
            mesh.material = mesh.material.map((m) => {
              const cloned = m.clone();
              cloned.transparent = true;
              cloned.opacity = 0;
              cloned.depthWrite = false;
              return cloned;
            });
          } else {
            const cloned = mesh.material.clone();
            cloned.transparent = true;
            cloned.opacity = 0;
            cloned.depthWrite = false;
            mesh.material = cloned;
          }
        };
        if (node.isMesh) ensureMat(node);
        node.traverse((child) => ensureMat(child));
      }

      /** Uphill drive direction + which horizontal normal axis marks a blocking side wall. */
      function computeRampDriveParamsFromGeometry(rampObj) {
        if (!rampObj) return null;
        rampObj.updateMatrixWorld(true);
        const _va = new THREE.Vector3();
        const _vb = new THREE.Vector3();
        const _vc = new THREE.Vector3();
        const _e1 = new THREE.Vector3();
        const _e2 = new THREE.Vector3();
        const _fn = new THREE.Vector3();
        let uphillX = 0;
        let uphillZ = 0;
        let totalW = 0;
        rampObj.traverse((child) => {
          if (!child.isMesh || !child.geometry) return;
          child.updateMatrixWorld(true);
          const geo = child.geometry;
          const pos = geo.attributes.position;
          const idx = geo.index;
          const mw = child.matrixWorld;
          const triCount = idx ? idx.count / 3 : pos.count / 3;
          for (let t = 0; t < triCount; t++) {
            let i0, i1, i2;
            if (idx) {
              i0 = idx.getX(t * 3);
              i1 = idx.getX(t * 3 + 1);
              i2 = idx.getX(t * 3 + 2);
            } else {
              i0 = t * 3;
              i1 = t * 3 + 1;
              i2 = t * 3 + 2;
            }
            _va.fromBufferAttribute(pos, i0).applyMatrix4(mw);
            _vb.fromBufferAttribute(pos, i1).applyMatrix4(mw);
            _vc.fromBufferAttribute(pos, i2).applyMatrix4(mw);
            _e1.subVectors(_vb, _va);
            _e2.subVectors(_vc, _va);
            _fn.crossVectors(_e1, _e2);
            const area2 = _fn.length();
            if (area2 < 1e-8) continue;
            _fn.divideScalar(area2);
            if (_fn.y < RAMP_DRIVE_UP_NY_THRESHOLD) continue;
            const w = area2 * 0.5;
            uphillX += _fn.x * w;
            uphillZ += _fn.z * w;
            totalW += w;
          }
        });
        const entryDir = new THREE.Vector3();
        if (totalW > 1e-8) {
          entryDir.set(uphillX / totalW, 0, uphillZ / totalW);
        }
        if (entryDir.lengthSq() < 1e-8) entryDir.set(1, 0, 0);
        else entryDir.normalize();
        const blockingAxis =
          Math.abs(entryDir.x) >= Math.abs(entryDir.z) ? "z" : "x";
        return { entryDir, blockingAxis };
      }


      function updateFrontWheelsOffRampForRamp(rampObject) {
        if (!rampObject) return false;
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
        const frontHits = carRampRaycaster.intersectObjects([rampObject], true);
        carRampRaycaster.set(carRampRayRearOrigin, carRampRayDir);
        const rearHits = carRampRaycaster.intersectObjects([rampObject], true);
        const frontOnRamp =
          frontHits.length > 0 &&
          frontHits[0].distance < 2.5 &&
          isDescendantOf(frontHits[0].object, rampObject);
        const rearOnRamp =
          rearHits.length > 0 &&
          rearHits[0].distance < 2.5 &&
          isDescendantOf(rearHits[0].object, rampObject);
        return !frontOnRamp && rearOnRamp;
      }

      function sampleRampDriveHitAt(wx, wy, wz, rampObject) {
        if (!rampObject || !car) return null;
        rampObject.updateMatrixWorld(true);
        carRampRayOrigin.set(wx, wy + 1, wz);
        carRampRaycaster.set(carRampRayOrigin, carRampRayDir);
        const rampHits = carRampRaycaster.intersectObjects([rampObject], true);
        for (let h = 0; h < rampHits.length; h++) {
          const hit = rampHits[h];
          if (hit.distance > 2.5) continue;
          if (!isDescendantOf(hit.object, rampObject)) continue;
          getRampHitWorldNormal(hit);
          if (_rampNormal.y < RAMP_DRIVE_UP_NY_THRESHOLD) continue;
          return { y: hit.point.y, normal: _rampNormal.clone() };
        }
        return null;
      }

      /** rampLeft — matches office-scene/office-scene.html (local +X entry, Z blocking). */
      function sampleCarOnRampLeft() {
        if (!rampLeftObject || !car || carState.velY > 0) return null;
        rampLeftObject.updateMatrixWorld(true);
        carRampRayOrigin.set(
          car.position.x,
          car.position.y + 1,
          car.position.z,
        );
        carRampRaycaster.set(carRampRayOrigin, carRampRayDir);
        const rampHits = carRampRaycaster.intersectObjects(
          [rampLeftObject],
          true,
        );
        for (let h = 0; h < rampHits.length; h++) {
          const hit = rampHits[h];
          if (hit.distance > 2.5) continue;
          if (!isDescendantOf(hit.object, rampLeftObject)) continue;
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
          const isVerticalWall = isVerticalWallNormalY(_rampNormal.y);
          const shouldGetStuck =
            isVerticalWall ||
            !isDriveUpFace ||
            !drivingUpRamp ||
            faceIsBlockingSide;
          if (shouldGetStuck) {
            const faceTopY = getRampHitFaceTopY(hit);
            const carBottomY = car.position.y - carBottomOffsetY;
            const stepHeight = faceTopY - carBottomY;
            const maxStepClimb = MAX_STEP_CLIMB_RATIO * carBottomOffsetY;
            if (
              !isVerticalWall &&
              stepHeight > 0 &&
              stepHeight <= maxStepClimb
            ) {
              car.position.y = faceTopY + carBottomOffsetY;
              carState.velY = 0;
            } else {
              const pushBackMult =
                oppositeSide || faceIsBlockingSide || isVerticalWall
                  ? 1.6
                  : 1;
              stopCarAgainstWallNormal(_rampNormal.x, _rampNormal.z, pushBackMult);
            }
            return null;
          }
          if (_rampNormal.y < 0) _rampNormal.negate();
          return {
            rampObject: rampLeftObject,
            rampY: hit.point.y,
            normal: _rampNormal.clone(),
            shouldJump: Math.abs(carState.speed) >= CAR_RAMP_JUMP_MIN_SPEED,
          };
        }
        return null;
      }

      function sampleRampSurfaceAt(wx, wy, wz, rampObject, options) {
        if (!rampObject || !car) return null;
        const relaxDirection = options && options.relaxDirection;
        const allowJump = !options || options.allowJump !== false;
        rampObject.updateMatrixWorld(true);
        carRampRayOrigin.set(wx, wy + 1, wz);
        carRampRaycaster.set(carRampRayOrigin, carRampRayDir);
        const rampHits = carRampRaycaster.intersectObjects([rampObject], true);
        for (let h = 0; h < rampHits.length; h++) {
          const hit = rampHits[h];
          if (hit.distance > 2.5) continue;
          const rampInfo = getCarRampFromHit(hit.object);
          if (!rampInfo) continue;
          getRampHitWorldNormal(hit);
          const isDriveUpFace = _rampNormal.y >= RAMP_DRIVE_UP_NY_THRESHOLD;
          const rampEntryDir = rampInfo.entryDir;
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
          const blockN =
            rampInfo.blockingAxis === "x"
              ? Math.abs(_rampNormal.x)
              : Math.abs(_rampNormal.z);
          const faceIsBlockingSide =
            blockN >= RAMP_BLOCKING_FACE_Z_THRESHOLD;
          const isVerticalWall = isVerticalWallNormalY(_rampNormal.y);
          const shouldGetStuck =
            isVerticalWall ||
            !isDriveUpFace ||
            faceIsBlockingSide ||
            (!relaxDirection && !drivingUpRamp);
          if (shouldGetStuck) {
            const faceTopY = getRampHitFaceTopY(hit);
            const carBottomY = car.position.y - carBottomOffsetY;
            const stepHeight = faceTopY - carBottomY;
            const maxStepClimb = MAX_STEP_CLIMB_RATIO * carBottomOffsetY;
            if (
              !isVerticalWall &&
              stepHeight > 0 &&
              stepHeight <= maxStepClimb
            ) {
              car.position.y = faceTopY + carBottomOffsetY;
              carState.velY = 0;
            } else if (isVerticalWall || !isDriveUpFace) {
              const pushBackMult =
                oppositeSide || faceIsBlockingSide || isVerticalWall
                  ? 1.6
                  : 1;
              stopCarAgainstWallNormal(_rampNormal.x, _rampNormal.z, pushBackMult);
            }
            break;
          }
          if (_rampNormal.y < 0) _rampNormal.negate();
          return {
            rampObject,
            rampY: hit.point.y,
            normal: _rampNormal.clone(),
            shouldJump:
              allowJump &&
              Math.abs(carState.speed) >= CAR_RAMP_JUMP_MIN_SPEED,
          };
        }
        return null;
      }

      function sampleCarOnRampFromObject(rampObject, options) {
        if (!rampObject || !car) return null;
        return sampleRampSurfaceAt(
          car.position.x,
          car.position.y,
          car.position.z,
          rampObject,
          options,
        );
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
            makeRampRaycastable(node);
          }
          if (node.name === "rampBackPhysic" && !rampBackObject) {
            rampBackObject = node;
            makeRampRaycastable(node);
          }
        });
      }

      function getCarRampFromHit(hitObject) {
        if (rampLeftObject && isDescendantOf(hitObject, rampLeftObject)) {
          return {
            object: rampLeftObject,
            entryDir: rampLeftEntryDir,
            blockingAxis: "z",
          };
        }
        if (rampBackObject && isDescendantOf(hitObject, rampBackObject)) {
          return {
            object: rampBackObject,
            entryDir: rampBackEntryDir,
            blockingAxis: rampBackBlockingAxis,
          };
        }
        return null;
      }

      function getCarRampRaycastTargets() {
        return [rampLeftObject, rampBackObject].filter(Boolean);
      }

      /**
       * After each step, for the bottle and the certified card once they're
       * loose: never below the table top, and never inside the car's footprint
       * (the car's colliders are kinematic, so a deep overlap isn't always
       * pushed out by the solver): pushed out the short way, inward speed removed.
       */
      function protectKnockables() {
        const K = KNOCKABLE_PHYS;
        const top = getTableTopY();
        for (const pb of [bottlePhysBody, certifiedPhysBody]) {
          if (!pb || pb._frozen) continue;
          pb.updateAABB();
          const low = pb.aabb.lowerBound.y;
          const onTable =
            Number.isFinite(tablePlateHalfX) &&
            Math.abs(pb.position.x - tablePlateCenter.x) <= tablePlateHalfX &&
            Math.abs(pb.position.z - tablePlateCenter.z) <= tablePlateHalfZ;
          // "Fell off" is judged by its centre (a hard landing can dip its lowest point deep for a step).
          if (onTable && low < top - K.sinkTolerance && pb.position.y > top - GUM_TABLE.plateThickness) {
            pb.position.y += top - low;
            if (pb.velocity.y < 0) pb.velocity.y = 0;
            pb.aabbNeedsUpdate = true;
          }
          if (!car || carFalling) continue;
          // Vertical: only while the object reaches below the car's roof.
          const carTop = canonBodyPhys ? canonBodyPhys.aabb.upperBound.y : car.position.y + 1;
          if (pb.aabb.lowerBound.y > carTop) continue;
          // The object as a circle (its smaller half-width) against the car's rotated footprint.
          const ex = (pb.aabb.upperBound.x - pb.aabb.lowerBound.x) / 2;
          const ez = (pb.aabb.upperBound.z - pb.aabb.lowerBound.z) / 2;
          const rin = Math.min(ex, ez);
          const hx = halfW * storedCarScale;
          const hz = halfL * storedCarScale;
          const ca = Math.cos(carState.angle);
          const sa = Math.sin(carState.angle);
          const dx = pb.position.x - car.position.x;
          const dz = pb.position.z - car.position.z;
          const lx = dx * ca - dz * sa; // car right
          const lz = dx * sa + dz * ca; // car forward
          const qx = Math.max(-hx, Math.min(hx, lx));
          const qz = Math.max(-hz, Math.min(hz, lz));
          let nx = lx - qx;
          let nz = lz - qz;
          let dist = Math.hypot(nx, nz);
          let push;
          if (dist > 1e-6) {
            if (dist >= rin - K.overlapTolerance) continue;
            push = rin - dist;
            nx /= dist;
            nz /= dist;
          } else {
            // Centre inside the footprint: out through the nearest side.
            const outX = hx - Math.abs(lx);
            const outZ = hz - Math.abs(lz);
            if (outX < outZ) {
              nx = Math.sign(lx) || 1;
              nz = 0;
              push = outX + rin;
            } else {
              nx = 0;
              nz = Math.sign(lz) || 1;
              push = outZ + rin;
            }
          }
          // Back to world (right = (cos, -sin), forward = (sin, cos)).
          const wx = nx * ca + nz * sa;
          const wz = -nx * sa + nz * ca;
          pb.position.x += wx * push;
          pb.position.z += wz * push;
          const vIn = pb.velocity.x * wx + pb.velocity.z * wz;
          if (vIn < 0) {
            pb.velocity.x -= wx * vIn;
            pb.velocity.z -= wz * vIn;
          }
          pb.aabbNeedsUpdate = true;
          if (pb.sleepState !== CANNON.Body.AWAKE) pb.wakeUp();
        }
      }

      /** Parts as cylinders (world box: radius, height, centre y) for the bottle's compound collider. */
      function cylinderFromMesh(mesh) {
        const b = new THREE.Box3().setFromObject(mesh);
        const size = b.getSize(new THREE.Vector3());
        const c = b.getCenter(new THREE.Vector3());
        return { r: Math.max(size.x, size.z) / 2, h: size.y, c };
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
        const K = KNOCKABLE_PHYS.bottle;

        // Compound collider from the parts (or the physic box's size if a part is missing).
        const parts3 = [
          [bottleBaseMesh, K.density.base],
          [bottleBodyMesh, K.density.body],
          [bottleCupMesh, K.density.cup],
        ].filter(([m]) => m);
        const cyls = parts3.map(([m, d]) => ({ ...cylinderFromMesh(m), d }));
        if (!cyls.length) cyls.push({ r: Math.max(phSize.x, phSize.z) / 2, h: phSize.y, c: phCenter.clone(), d: 1 });
        // Centre of mass: volume × density weighted.
        let wSum = 0;
        const com = new THREE.Vector3();
        for (const cy of cyls) {
          const w = Math.PI * cy.r * cy.r * cy.h * cy.d;
          com.addScaledVector(cy.c, w);
          wSum += w;
        }
        com.multiplyScalar(1 / wSum);

        bottlePhisicMesh.visible = false;

        bottleGroup = new THREE.Group();
        bottleGroup.position.copy(com);
        const phQuat = new THREE.Quaternion();
        bottlePhisicMesh.getWorldQuaternion(phQuat);
        bottleGroup.quaternion.copy(phQuat);
        scene.add(bottleGroup);
        bottleGroup.updateMatrixWorld(true);

        const parts = [bottleBodyMesh, bottleBaseMesh, bottleCupMesh, bottlePhisicMesh].filter(Boolean);
        for (const mesh of parts) {
          bottleGroup.attach(mesh);
        }

        bottlePhysBody = new CANNON.Body({
          mass: K.mass,
          type: CANNON.Body.DYNAMIC,
          material: bottleMaterial,
          linearDamping: K.linearDamping,
          angularDamping: K.angularDamping,
          allowSleep: true,
          sleepSpeedLimit: KNOCKABLE_PHYS.sleep.speed,
          sleepTimeLimit: KNOCKABLE_PHYS.sleep.time,
          collisionFilterGroup: PHYS_GROUP_DEFAULT,
          collisionFilterMask: -1,
          ccdSpeedThreshold: 1,
          ccdIterations: 10,
        });
        // Cylinders are along Y (as the bottle stands); offsets from the centre of mass.
        const invQ = phQuat.clone().invert();
        for (const cy of cyls) {
          const off = cy.c.clone().sub(com).applyQuaternion(invQ);
          bottlePhysBody.addShape(
            new CANNON.Cylinder(cy.r, cy.r, cy.h, K.segments),
            new CANNON.Vec3(off.x, off.y, off.z),
          );
        }
        bottlePhysBody._sleepWhenSettled = true;
        bottlePhysBody.position.set(com.x, com.y, com.z);
        bottlePhysBody.quaternion.set(phQuat.x, phQuat.y, phQuat.z, phQuat.w);
        bottlePhysBody._frozen = true;
        physicsWorld.addBody(bottlePhysBody);

        bottlePhysBody.addEventListener("collide", (e) => {
          if (!bottlePhysBody._frozen) return;
          if (e.body.material === carMaterial) {
            unfreezeKnockableBody(bottlePhysBody);
          }
        });

        _bottleInitPos = new CANNON.Vec3(com.x, com.y, com.z);
        _bottleInitQuat = new CANNON.Quaternion(phQuat.x, phQuat.y, phQuat.z, phQuat.w);
        applyKnockableGroupShadow(bottleGroup);
        console.log("Bottle physics body created:", {
          pos: [com.x.toFixed(2), com.y.toFixed(2), com.z.toFixed(2)],
          shapes: cyls.map((cy) => [cy.r.toFixed(2), cy.h.toFixed(2)]),
          mass: bottlePhysBody.mass,
          type: bottlePhysBody.type,
          inWorld: physicsWorld.bodies.includes(bottlePhysBody),
        });
      }

      function showTablePlateWireframe() {
      }

      /**
       * musa (the yellow figure on the desk) comes alive now and then: it waves hello with the hand it already
       * holds up, and it wiggles its hips. One mesh with no bones, so it's done in its vertex shader (and its
       * shadow's): the raised arm turns about the shoulder and the forearm about the elbow; the hips sway side
       * to side and twist a little, the feet staying planted and the chest still. Soft weights keep the surface
       * smooth. Mesh-local units (its local up is -z: from the feet at 4.29 up to the hand at -2.6; x across).
       * Each move starts after a random pause (`every`, s), runs `cycles` at `hz`, easing in and out.
       */
      const MUSA_ANIM = {
        shoulder: [-2.1, 0.3], // pivot (x, z)
        elbow: [-3.1, -1.0],
        /** Arm: x below armX[0] → armX[1] fully the arm, above the shoulder height (armZ, z: down is +). */
        armX: [-2.0, -2.45],
        armZ: [0.7, 0.2],
        forearmX: [-2.3, -2.6],
        forearmZ: [-0.9, -1.4],
        wave: { every: [4, 10], cycles: 3, hz: 2.2, arm: 0.12, forearm: 0.42, ease: 0.25 },
        /** Hips: a bell from the feet (planted) up to the chest (still). */
        hipZ: [4.1, 3.0, 1.6, 0.6],
        centre: [-0.66, 3.84], // the body's middle (x, y): the twist's axis
        hips: { every: [5, 12], cycles: 4, hz: 2.4, sway: 0.28, twist: 0.12, ease: 0.3 },
      };
      const _musaAnim = {
        uniforms: { uMusaArm: { value: 0 }, uMusaForearm: { value: 0 }, uMusaSway: { value: 0 }, uMusaTwist: { value: 0 } },
        wave: { start: 0, next: 0 },
        hips: { start: 0, next: 0 },
        t: 0,
        on: false,
      };
      /** The deformation (GLSL): a point or a direction (w = 0), in musa's local space. */
      function musaDeformGLSL() {
        const A = MUSA_ANIM;
        const f = (v) => v.toFixed(3);
        return `
          uniform float uMusaArm, uMusaForearm, uMusaSway, uMusaTwist;
          vec2 musaRot(vec2 p, vec2 c, float a) { float s = sin(a), k = cos(a); p -= c; return c + vec2(k * p.x - s * p.y, s * p.x + k * p.y); }
          vec3 musaDeform(vec3 p, vec3 rest, float isPoint) {
            float wArm = smoothstep(${f(A.armX[0])}, ${f(A.armX[1])}, rest.x) * smoothstep(${f(A.armZ[0])}, ${f(A.armZ[1])}, rest.z);
            float wFore = smoothstep(${f(A.forearmX[0])}, ${f(A.forearmX[1])}, rest.x) * smoothstep(${f(A.forearmZ[0])}, ${f(A.forearmZ[1])}, rest.z);
            vec2 sh = vec2(${f(A.shoulder[0])}, ${f(A.shoulder[1])}) * isPoint;
            vec2 el = vec2(${f(A.elbow[0])}, ${f(A.elbow[1])}) * isPoint;
            p.xz = musaRot(p.xz, el, uMusaForearm * wFore);
            p.xz = musaRot(p.xz, sh, uMusaArm * wArm);
            float wHip = smoothstep(${f(A.hipZ[0])}, ${f(A.hipZ[1])}, rest.z) * (1.0 - smoothstep(${f(A.hipZ[2])}, ${f(A.hipZ[3])}, rest.z));
            p.x += uMusaSway * wHip * isPoint;
            p.xy = musaRot(p.xy, vec2(${f(A.centre[0])}, ${f(A.centre[1])}) * isPoint, uMusaTwist * wHip); // a twist about its up axis
            return p;
          }`;
      }
      function musaPatchShader(sh) {
        Object.assign(sh.uniforms, _musaAnim.uniforms);
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", "#include <common>\n" + musaDeformGLSL())
          .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed = musaDeform(transformed, position, 1.0);");
        if (sh.vertexShader.includes("#include <beginnormal_vertex>")) {
          sh.vertexShader = sh.vertexShader.replace(
            "#include <beginnormal_vertex>",
            "#include <beginnormal_vertex>\nobjectNormal = normalize(musaDeform(objectNormal, position, 0.0));",
          );
        }
      }
      function setupMusaAnimation(model) {
        let mesh = null;
        model.traverse((n) => {
          if (n.isMesh && n.name === "musa") mesh = n;
        });
        if (!mesh || Array.isArray(mesh.material)) return;
        const mat = mesh.material;
        if (!mat.userData.musaAnim) {
          mat.userData.musaAnim = true;
          const prev = mat.onBeforeCompile;
          mat.onBeforeCompile = (sh, r) => {
            if (prev) prev(sh, r);
            musaPatchShader(sh);
          };
          const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => "";
          mat.customProgramCacheKey = () => prevKey() + "|musaAnim";
          mat.needsUpdate = true;
        }
        // Its shadow moves with it.
        const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
        depth.onBeforeCompile = musaPatchShader;
        depth.customProgramCacheKey = () => "musaAnimDepth";
        const dist = new THREE.MeshDistanceMaterial();
        dist.onBeforeCompile = musaPatchShader;
        dist.customProgramCacheKey = () => "musaAnimDistance";
        mesh.customDepthMaterial = depth;
        mesh.customDistanceMaterial = dist;
        const r = (a) => a[0] + Math.random() * (a[1] - a[0]);
        _musaAnim.wave.next = r(MUSA_ANIM.wave.every);
        _musaAnim.hips.next = r(MUSA_ANIM.hips.every);
        _musaAnim.on = true;
      }
      /** Per frame: the wave and the hip wiggle (each now and then, easing in and out). */
      function updateMusaAnimation(dt) {
        if (!_musaAnim.on) return;
        const A = _musaAnim;
        A.t += dt;
        const r = (a) => a[0] + Math.random() * (a[1] - a[0]);
        const run = (state, cfg) => {
          const dur = cfg.cycles / cfg.hz;
          if (!state.start && A.t >= state.next) state.start = A.t;
          if (!state.start) return 0;
          const u = A.t - state.start;
          if (u >= dur) {
            state.start = 0;
            state.next = A.t + r(cfg.every);
            return 0;
          }
          const env = Math.min(1, u / cfg.ease, (dur - u) / cfg.ease);
          const e = env * env * (3 - 2 * env);
          return Math.sin(u * cfg.hz * Math.PI * 2) * e;
        };
        const W = MUSA_ANIM.wave, H = MUSA_ANIM.hips;
        const w = run(A.wave, W);
        A.uniforms.uMusaArm.value = w * W.arm;
        A.uniforms.uMusaForearm.value = w * W.forearm;
        // No hip wiggle during the intro (or under the loader): the first comes a random pause after it.
        if (officeIntro.state !== "done") {
          A.hips.start = 0;
          A.hips.next = A.t + r(H.every);
        }
        const h = run(A.hips, H);
        A.uniforms.uMusaSway.value = h * H.sway;
        A.uniforms.uMusaTwist.value = h * H.twist;
      }

      function setupFloorPhysics(model) {
        let floorMesh = null;
        model.traverse((node) => {
          if (node.isMesh && node.name === "floor") floorMesh = node;
        });
        if (!floorMesh) return;
        floorMesh.castShadow = false;
        floorMesh.receiveShadow = false;
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
        console.log("tableSideWall physics added,", shapeCount, "box shapes");
      }

      function shouldSkipShadowMesh(name) {
        if (!name) return true;
        if (name === "starDecal" || name === "handWalkTrigger" || name === "techDesignerMagnetDecal") return true;
        if (name === "tableSideWall") return true;
        return /physic/i.test(name);
      }

      function prepareMaterialForTableShadow(mat) {
        if (!mat) return;
        const mats = Array.isArray(mat) ? mat : [mat];
        for (let i = 0; i < mats.length; i++) {
          const m = mats[i];
          if (!m) continue;
          m.shadowSide = THREE.DoubleSide;
          attachShadowDepthMaterial(m);
        }
      }

      function prepareMaterialForWallShadow(mat) {
        if (!mat) return;
        const mats = Array.isArray(mat) ? mat : [mat];
        for (let i = 0; i < mats.length; i++) {
          const m = mats[i];
          if (!m) continue;
          m.shadowSide = THREE.DoubleSide;
          attachShadowDepthMaterial(m);
        }
      }

      function attachShadowDepthMaterial(material) {
        if (!material || material.customDepthMaterial) return;
        if (!material.transparent && !material.alphaMap && !material.alphaTest) return;
        const depthMat = new THREE.MeshDepthMaterial({
          depthPacking: THREE.RGBADepthPacking,
          alphaTest: material.alphaTest > 0 ? material.alphaTest : 0.05,
          side: material.side || THREE.DoubleSide,
        });
        if (material.map) depthMat.map = material.map;
        if (material.alphaMap) depthMat.alphaMap = material.alphaMap;
        material.customDepthMaterial = depthMat;
      }

      function isConusVisualMeshName(name) {
        return /^conus\d*$/.test(name || "") || /^conusStrips\d*$/.test(name || "");
      }

      function applyConusVisualShadows(visualParts) {
        if (!perfSettings.shadows) return;
        for (let i = 0; i < visualParts.length; i++) {
          const mesh = visualParts[i];
          if (!mesh?.isMesh || !isConusVisualMeshName(mesh.name)) continue;
          mesh.castShadow = true;
          mesh.receiveShadow = false;
          enableTableTopShadowCasterLayer(mesh);
          if (Array.isArray(mesh.material)) {
            for (let j = 0; j < mesh.material.length; j++) {
              const m = mesh.material[j];
              if (!m) continue;
              m.side = THREE.DoubleSide;
              m.shadowSide = THREE.DoubleSide;
            }
          } else if (mesh.material) {
            mesh.material.side = THREE.DoubleSide;
            mesh.material.shadowSide = THREE.DoubleSide;
          }
        }
      }

      function enableWallShadowCasterLayer(node) {
        if (!node?.layers) return;
        node.layers.enable(TABLE_WALL_SHADOW_LAYER);
        node.layers.disable(TABLE_TOP_SHADOW_LAYER);
      }

      function enableTableTopShadowCasterLayer(node) {
        if (node?.layers) node.layers.enable(TABLE_TOP_SHADOW_LAYER);
      }

      function enableBothShadowCasterLayers(node) {
        if (!node?.layers) return;
        node.layers.enable(TABLE_WALL_SHADOW_LAYER);
        node.layers.enable(TABLE_TOP_SHADOW_LAYER);
      }

      function enableMeshCastShadow(node, shadowMode = "table") {
        if (!node?.isMesh || shouldSkipShadowMesh(node.name)) return;
        if (isTableSideWallMesh(node)) return;
        node.castShadow = true;
        node.receiveShadow = false;
        if (shadowMode === "wall") {
          enableWallShadowCasterLayer(node);
          prepareMaterialForWallShadow(node.material);
        } else if (shadowMode === "table") {
          enableTableTopShadowCasterLayer(node);
          prepareMaterialForTableShadow(node.material);
        } else if (shadowMode === "both") {
          enableBothShadowCasterLayers(node);
          prepareMaterialForTableShadow(node.material);
          prepareMaterialForWallShadow(node.material);
        }
      }

      function applyCastShadowsToObject3D(root, shadowMode = "table") {
        if (!root || !perfSettings.shadows) return;
        root.traverse((node) => enableMeshCastShadow(node, shadowMode));
      }

      function applyHandShadows() {
        if (!perfSettings.shadows) return;
        if (handWalkPart) applyCastShadowsToObject3D(handWalkPart, "both");
        if (handNode0Mesh) enableMeshCastShadow(handNode0Mesh, "both");
        const model = _officeWorldRoot || _currentWorldModel;
        if (!model) return;
        model.traverse((node) => {
          if (!node.isMesh) return;
          const name = node.name || "";
          const parentName = node.parent ? node.parent.name || "" : "";
          if (
            name === "node_0" ||
            name === "handWalk" ||
            parentName === "handWalk" ||
            /^hand/i.test(name) ||
            /^eyeBall/i.test(name) ||
            /^eyePuple/i.test(name)
          ) {
            enableMeshCastShadow(node, "both");
          }
        });
      }

      const WALL_ONLY_SHADOW_ROOTS = [
        "panHolder",
        "headphonesBase",
        "headphonesEars",
        "headphonesButtons",
        "headphonesLight",
        "techDesignerMagnet",
      ];

      function nodeMatchesShadowRootList(node, roots) {
        if (!node?.isMesh) return false;
        let p = node;
        while (p) {
          const name = p.name || "";
          for (let i = 0; i < roots.length; i++) {
            if (name === roots[i]) return true;
          }
          p = p.parent;
        }
        return false;
      }

      function meshMatchesWallOnlyShadowRoot(node) {
        return nodeMatchesShadowRootList(node, WALL_ONLY_SHADOW_ROOTS);
      }

      const TABLE_TOP_SHADOW_MESH_ROOTS = [
        "musa",
        "musa.001",
        "plantVase",
        "plantBase",
        "plant1",
        "dockingStation",
        "displayCableUsb",
        "bottleBody",
        "bottleBase",
        "bottleCup",
        "certifiedBody",
        "certifiedDesignText",
        "certifiedTitle",
        "cetifiedCircle",
        "cetifiedBackground",
        "wixLogo",
        "gumsCup",
        "gumsTank",
        "gumsBody",
        "gumsStand",
        "gumsRamp",
        "gumsStoper",
        "star",
        "conus",
        "conusStrips",
        "conus1",
        "conus2",
        "conus3",
        "conusStrips1",
        "conusStrips2",
        "conusStrips3",
        "conusGroup1",
        "conusGroup2",
        "conusGroup3",
      ];

      const TABLE_SHADOW_MESH_ROOTS = TABLE_TOP_SHADOW_MESH_ROOTS;

      function meshMatchesTableShadowRoot(node) {
        return nodeMatchesShadowRootList(node, TABLE_SHADOW_MESH_ROOTS);
      }

      function applyConusShadows() {
        if (!perfSettings.shadows) return;
        for (let i = 0; i < _conusInstances.length; i++) {
          const inst = _conusInstances[i];
          if (inst?.visualParts) applyConusVisualShadows(inst.visualParts);
          else if (inst?.group) applyCastShadowsToObject3D(inst.group);
        }
      }

      function applyKnockableGroupShadow(group, shadowMode = "table") {
        if (!group) return;
        applyCastShadowsToObject3D(group, shadowMode);
      }

      function applyTableKnockableShadows(model) {
        if (!perfSettings.shadows) return;
        if (bottleGroup) applyCastShadowsToObject3D(bottleGroup);
        if (certifiedGroup) applyCastShadowsToObject3D(certifiedGroup);
        if (gumDispenserGroup) applyCastShadowsToObject3D(gumDispenserGroup);
        for (let i = 0; i < _starInstances.length; i++) {
          const group = _starInstances[i]?.group;
          if (group) applyCastShadowsToObject3D(group);
        }
        applyConusShadows();
        if (model) {
          enforceTableSideWallShadowPolicy(model);
          model.traverse((node) => {
            if (meshMatchesTableShadowRoot(node)) {
              enableMeshCastShadow(node, "table");
            }
          });
        }
      }

      function setupHandPhysics(model) {
        handPhisicsMesh = null;
        handNode0Mesh = null;
        handWalkPart = model.getObjectByName("handWalk") || null;
        model.traverse((node) => {
          if (node.isMesh && node.name === "handPhisics")
            handPhisicsMesh = node;
          if (node.isMesh && node.name === "node_0") handNode0Mesh = node;
          if (node.isMesh && node.name === "handWalkTrigger") {
            handWalkTriggerMesh = node;
            node.visible = false;
          }
        });
        applyHandShadows();
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
            handNode0Mesh.skeleton.bones[
              handNode0Mesh.skeleton.bones.length - 1
            ];
          if (attachBone) attachBone.attach(handPhisicsMesh);
        }

        model.updateMatrixWorld(true);
        handPhisicsMesh.updateMatrixWorld(true);

        const geo = handPhisicsMesh.geometry;
        if (!geo?.attributes?.position) return;
        geo.computeBoundingBox();
        const geoBB = geo.boundingBox;
        const localSize = new THREE.Vector3().subVectors(geoBB.max, geoBB.min);
        const localCenter = geoBB.getCenter(new THREE.Vector3());
        const worldScale = new THREE.Vector3();
        handPhisicsMesh.getWorldScale(worldScale);
        const hx = (localSize.x * Math.abs(worldScale.x)) / 2;
        const hy = (localSize.y * Math.abs(worldScale.y)) / 2;
        const hz = (localSize.z * Math.abs(worldScale.z)) / 2;
        const shape = new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
        const shapeOffset = new CANNON.Vec3(
          localCenter.x * worldScale.x,
          localCenter.y * worldScale.y,
          localCenter.z * worldScale.z,
        );

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
        handPhysBody.addShape(shape, shapeOffset);
        handPhysBody.position.set(wp.x, wp.y, wp.z);
        handPhysBody.quaternion.set(wq.x, wq.y, wq.z, wq.w);
        physicsWorld.addBody(handPhysBody);
        applyHandShadows();
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
          mass: KNOCKABLE_PHYS.certified.mass,
          type: CANNON.Body.DYNAMIC,
          material: certifiedMaterial,
          linearDamping: KNOCKABLE_PHYS.certified.linearDamping,
          angularDamping: KNOCKABLE_PHYS.certified.angularDamping,
          allowSleep: true,
          sleepSpeedLimit: KNOCKABLE_PHYS.sleep.speed,
          sleepTimeLimit: KNOCKABLE_PHYS.sleep.time,
          collisionFilterGroup: 1,
          collisionFilterMask: -1,
          ccdSpeedThreshold: 1,
          ccdIterations: 10,
        });
        certifiedPhysBody.addShape(shape);
        certifiedPhysBody._sleepWhenSettled = true;
        certifiedPhysBody.position.set(phCenter.x, phCenter.y, phCenter.z);
        certifiedPhysBody.quaternion.set(phQuat.x, phQuat.y, phQuat.z, phQuat.w);
        certifiedPhysBody._frozen = true;
        physicsWorld.addBody(certifiedPhysBody);

        _certifiedInitPos = new CANNON.Vec3(phCenter.x, phCenter.y, phCenter.z);
        _certifiedInitQuat = new CANNON.Quaternion(phQuat.x, phQuat.y, phQuat.z, phQuat.w);

        certifiedPhysBody.addEventListener("collide", (e) => {
          if (!certifiedPhysBody._frozen) return;
          if (e.body.material === carMaterial) {
            unfreezeKnockableBody(certifiedPhysBody);
          }
        });
        applyKnockableGroupShadow(certifiedGroup);
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

      function getConusGroupConfigs(model) {
        const configs = [];
        for (let i = 1; i <= 3; i++) {
          const physicName = `conusPhysic${i}`;
          const partNames = [`conus${i}`, `conusStrips${i}`];
          if (model.getObjectByName(physicName)) {
            configs.push({ suffix: i, physicName, partNames, groupName: `conusGroup${i}` });
          }
        }
        if (!configs.length && model.getObjectByName("conusPhysic")) {
          configs.push({
            suffix: 1,
            physicName: "conusPhysic",
            partNames: ["conus", "conusStrips"],
            groupName: "conusGroup1",
          });
        }
        return configs;
      }

      function applyConusMaterials(model) {
        const conusRef = model.getObjectByName("conus1") || model.getObjectByName("conus");
        const stripsRef = model.getObjectByName("conusStrips1") || model.getObjectByName("conusStrips");
        if (!conusRef?.isMesh || !stripsRef?.isMesh) return;
        const conusMat = conusRef.material?.clone ? conusRef.material.clone() : conusRef.material;
        const stripsMat = stripsRef.material?.clone ? stripsRef.material.clone() : stripsRef.material;
        conusRef.material = conusMat;
        stripsRef.material = stripsMat;
        for (let i = 2; i <= 3; i++) {
          const conus = model.getObjectByName(`conus${i}`);
          const strips = model.getObjectByName(`conusStrips${i}`);
          if (conus?.isMesh) conus.material = conusMat;
          if (strips?.isMesh) strips.material = stripsMat;
        }
      }

      function setupConusPhysics(model) {
        _conusInstances.length = 0;
        const configs = getConusGroupConfigs(model);
        for (const cfg of configs) {
          let physicMesh = null;
          const visualParts = [];
          model.traverse((node) => {
            if (!node.isMesh) return;
            if (node.name === cfg.physicName) physicMesh = node;
            if (cfg.partNames.includes(node.name)) visualParts.push(node);
          });
          if (!physicMesh) continue;

          model.updateMatrixWorld(true);
          const phBB = new THREE.Box3().setFromObject(physicMesh);
          const phCenter = phBB.getCenter(new THREE.Vector3());
          const phSize = phBB.getSize(new THREE.Vector3());

          const conusGroup = new THREE.Group();
          conusGroup.name = cfg.groupName;
          conusGroup.position.copy(phCenter);
          const phQuat = new THREE.Quaternion();
          physicMesh.getWorldQuaternion(phQuat);
          conusGroup.quaternion.copy(phQuat);
          scene.add(conusGroup);
          conusGroup.updateMatrixWorld(true);

          for (const mesh of visualParts) conusGroup.attach(mesh);
          conusGroup.attach(physicMesh);
          physicMesh.visible = false;
          conusGroup.updateMatrixWorld(true);
          applyConusVisualShadows(visualParts);

          const hx = phSize.x / 2;
          const hy = phSize.y / 2;
          const hz = phSize.z / 2;
          const shape = new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
          const conusPhysBody = new CANNON.Body({
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
          _conusInstances.push({ group: conusGroup, physBody: conusPhysBody, visualParts });
          applyConusVisualShadows(visualParts);
        }
      }

      function syncConusFromPhysics() {
        for (let i = 0; i < _conusInstances.length; i++) {
          const inst = _conusInstances[i];
          if (!inst?.group || !inst?.physBody) continue;
          inst.group.position.set(
            inst.physBody.position.x,
            inst.physBody.position.y,
            inst.physBody.position.z,
          );
          inst.group.quaternion.set(
            inst.physBody.quaternion.x,
            inst.physBody.quaternion.y,
            inst.physBody.quaternion.z,
            inst.physBody.quaternion.w,
          );
        }
      }

      const STAR_VISUAL_PART_NAMES = ["star"];

      function setupStarPhysics(model) {
        _starInstances.length = 0;
        let physicMesh = null;
        const visualParts = [];
        model.traverse((node) => {
          if (!node.isMesh) return;
          if (node.name === "starPhysic") physicMesh = node;
          if (STAR_VISUAL_PART_NAMES.includes(node.name)) visualParts.push(node);
        });
        if (!physicMesh?.geometry) return;

        model.updateMatrixWorld(true);
        physicMesh.updateMatrixWorld(true);

        const phBB = new THREE.Box3().setFromObject(physicMesh);
        const phCenter = phBB.getCenter(new THREE.Vector3());
        const phSize = phBB.getSize(new THREE.Vector3());
        const phQuat = new THREE.Quaternion();
        physicMesh.getWorldQuaternion(phQuat);

        const starGroup = new THREE.Group();
        starGroup.name = "starGroup";
        starGroup.position.copy(phCenter);
        starGroup.quaternion.copy(phQuat);
        scene.add(starGroup);
        starGroup.updateMatrixWorld(true);

        for (const mesh of visualParts) starGroup.attach(mesh);
        starGroup.attach(physicMesh);
        physicMesh.visible = false;

        const hx = phSize.x / 2;
        const hy = phSize.y / 2;
        const hz = phSize.z / 2;
        const shape = new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
        const starPhysBody = new CANNON.Body({
          mass: 0.15,
          material: propMaterial,
          linearDamping: 0.6,
          angularDamping: 0.6,
          allowSleep: false,
          collisionFilterGroup: 1,
          collisionFilterMask: -1,
          ccdSpeedThreshold: 0.5,
          ccdIterations: 10,
        });
        starPhysBody.addShape(shape);
        starPhysBody.position.set(phCenter.x, phCenter.y, phCenter.z);
        starPhysBody.quaternion.set(phQuat.x, phQuat.y, phQuat.z, phQuat.w);
        physicsWorld.addBody(starPhysBody);
        _starInstances.push({ group: starGroup, physBody: starPhysBody });
        applyKnockableGroupShadow(starGroup);
      }

      function syncStarFromPhysics() {
        for (let i = 0; i < _starInstances.length; i++) {
          const inst = _starInstances[i];
          if (!inst?.group || !inst?.physBody) continue;
          const body = inst.physBody;
          inst.group.position.set(body.position.x, body.position.y, body.position.z);
          inst.group.quaternion.set(
            body.quaternion.x,
            body.quaternion.y,
            body.quaternion.z,
            body.quaternion.w,
          );
        }
      }

      function getTableTopY() {
        return tableSurfaceY;
      }

      function getStarGroupBottomY(inst) {
        const group = inst?.group;
        if (!group) return null;
        group.updateMatrixWorld(true);
        const groupBB = new THREE.Box3();
        let hasVisual = false;
        group.traverse((node) => {
          if (!node.isMesh || !node.visible) return;
          if (node.name === "starPhysic") return;
          groupBB.expandByObject(node);
          hasVisual = true;
        });
        if (!hasVisual || groupBB.isEmpty()) return null;
        return groupBB.min.y;
      }

      function placeStarOnTableVisual(clearance = 0.006) {
        const tableTop = getTableTopY();
        if (tableTop == null) return;
        const floorY = tableTop + clearance;
        for (let i = 0; i < _starInstances.length; i++) {
          const inst = _starInstances[i];
          const body = inst?.physBody;
          const group = inst?.group;
          if (!body || !group) continue;
          if (!Number.isFinite(tablePlateHalfX) || !Number.isFinite(tablePlateHalfZ)) continue;
          if (Math.abs(body.position.x - tablePlateCenter.x) >= tablePlateHalfX) continue;
          if (Math.abs(body.position.z - tablePlateCenter.z) >= tablePlateHalfZ) continue;

          group.position.set(body.position.x, body.position.y, body.position.z);
          group.quaternion.set(
            body.quaternion.x,
            body.quaternion.y,
            body.quaternion.z,
            body.quaternion.w,
          );

          const bottomY = getStarGroupBottomY(inst);
          if (bottomY == null) continue;
          const gap = bottomY - floorY;
          const vy = body.velocity.y;
          const linSpd = Math.hypot(body.velocity.x, body.velocity.z);
          const thrown = vy > 0.7 || linSpd > 0.75;

          if (gap < 0) {
            body.position.y -= gap;
            if (vy < 0) body.velocity.y = 0;
          } else if (!thrown && gap > 0.0005) {
            body.position.y -= gap;
            if (vy <= 0.15) body.velocity.y = 0;
          }
        }
      }

      function finalizeStarOnTable(clearance = 0.012) {
        placeStarOnTableVisual(clearance);
        syncStarFromPhysics();
      }

      function setupDrawerPortalEffect() {
        if (!_drawerEffectMesh || _drawerRing) return;
        _drawerEffectMesh.position.z += 0.6;


        _drawerPortalArrow = new THREE.Group();
        _drawerPortalArrow.name = "drawerPortalDownArrow";
        const arrowMaterial = new THREE.MeshStandardMaterial({
          color: 0xd32cff,
          emissive: 0x8d00d8,
          emissiveIntensity: 3.2,
          roughness: 0.18,
          metalness: 0.12,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: true,
        });
        const arrowGlowMaterial = new THREE.MeshBasicMaterial({
          color: 0xff35ce,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: true,
          side: THREE.BackSide,
          toneMapped: false,
        });
        arrowMaterial.userData.maxOpacity = 0.92;
        arrowGlowMaterial.userData.maxOpacity = 0.24;
        _drawerPortalArrowMaterials.push(
          arrowMaterial,
          arrowGlowMaterial,
        );

        const arrowShape = new THREE.Shape();
        arrowShape.moveTo(-0.16, 0.72);
        arrowShape.lineTo(0.16, 0.72);
        arrowShape.lineTo(0.16, -0.08);
        arrowShape.lineTo(0.5, -0.08);
        arrowShape.lineTo(0, -0.72);
        arrowShape.lineTo(-0.5, -0.08);
        arrowShape.lineTo(-0.16, -0.08);
        arrowShape.closePath();
        const arrowGeometry = new THREE.ExtrudeGeometry(arrowShape, {
          depth: 0.14,
          bevelEnabled: true,
          bevelSegments: 3,
          bevelSize: 0.035,
          bevelThickness: 0.035,
          curveSegments: 2,
        });
        arrowGeometry.center();
        const classicArrow = new THREE.Mesh(
          arrowGeometry,
          arrowMaterial,
        );
        const classicArrowGlow = new THREE.Mesh(
          arrowGeometry,
          arrowGlowMaterial,
        );
        classicArrowGlow.scale.set(1.28, 1.28, 1.5);
        _drawerPortalArrow.add(classicArrow, classicArrowGlow);

        const arrowTextCanvas = document.createElement("canvas");
        arrowTextCanvas.width = 512;
        arrowTextCanvas.height = 128;
        const arrowTextContext = arrowTextCanvas.getContext("2d");
        arrowTextContext.clearRect(
          0,
          0,
          arrowTextCanvas.width,
          arrowTextCanvas.height,
        );
        arrowTextContext.font = "700 88px Arial, sans-serif";
        arrowTextContext.textAlign = "center";
        arrowTextContext.textBaseline = "middle";
        arrowTextContext.shadowColor = "#b000ff";
        arrowTextContext.shadowBlur = 24;
        arrowTextContext.fillStyle = "#e23cff";
        arrowTextContext.fillText("Next Level", 256, 64);
        arrowTextContext.shadowBlur = 8;
        arrowTextContext.fillStyle = "#ffd2fa";
        arrowTextContext.fillText("Next Level", 256, 64);
        const arrowTextTexture = new THREE.CanvasTexture(arrowTextCanvas);
        arrowTextTexture.colorSpace = THREE.SRGBColorSpace;
        const arrowTextMaterial = new THREE.SpriteMaterial({
          map: arrowTextTexture,
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: true,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        });
        arrowTextMaterial.userData.maxOpacity = 0.9;
        _drawerPortalArrowMaterials.push(arrowTextMaterial);
        const arrowText = new THREE.Sprite(arrowTextMaterial);
        arrowText.name = "drawerPortalNextLevelText";
        arrowText.position.y = 1.18;
        arrowText.scale.set(3.4, 0.85, 1);
        _drawerPortalArrow.add(arrowText);
        _drawerPortalArrow.position.y = 5;
        _drawerPortalArrow.renderOrder = 110;
        _drawerPortalArrow.traverse((node) => {
          node.frustumCulled = false;
          node.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
        });
        _drawerEffectMesh.add(_drawerPortalArrow);

        // The ring: lying in the drawer facing up, fitted to its inside (found from the drawer's own mesh).
        {
          const R = DRAWER_RING;
          const drawer = drawerGroup && drawerGroup.getObjectByName("drawer");
          const box = new THREE.Box3().setFromObject(drawer || _drawerEffectMesh);
          const c = box.getCenter(new THREE.Vector3());
          const ray = new THREE.Raycaster();
          const cast = (o, d, fb) => {
            if (!drawer) return fb;
            ray.set(o, d);
            const h = ray.intersectObject(drawer, false)[0];
            return h ? h.distance : fb;
          };
          const floorY = box.max.y + 1 - cast(new THREE.Vector3(c.x, box.max.y + 1, c.z), new THREE.Vector3(0, -1, 0), box.max.y + 1 - box.min.y);
          const mid = new THREE.Vector3(c.x, floorY + 0.3, c.z);
          const xl = cast(mid, new THREE.Vector3(-1, 0, 0), (box.max.x - box.min.x) / 2);
          const xr = cast(mid, new THREE.Vector3(1, 0, 0), (box.max.x - box.min.x) / 2);
          const zb = cast(mid, new THREE.Vector3(0, 0, -1), (box.max.z - box.min.z) / 2);
          const zf = cast(mid, new THREE.Vector3(0, 0, 1), (box.max.z - box.min.z) / 2);
          // The drawer's inside (its inner walls, bottom and front; its walls' top), from the drawer's own mesh: only
          // the part out of its housing when open (its back stays in there, under the housing's top, which would cut it).
          const cover = scene.getObjectByName("drawerCover");
          const coverFront = cover ? new THREE.Box3().setFromObject(cover).max.z : -Infinity;
          const inside = {
            minX: mid.x - xl, maxX: mid.x + xr,
            minZ: Math.max(mid.z - zb, coverFront - DRAWER_SLIDE_DISTANCE), // the housing's front, the drawer open
            maxZ: mid.z + zf, // its inner front (the end it opens toward)
            minY: floorY, maxY: box.max.y,
          };
          // Scaled to fill it: its reach across up to the walls (the shorter of the two spans), never larger than the Kitchen's.
          const m = R.padding;
          const r1 = drawerRingReach(R);
          const s =
            R.fillScale *
            Math.min(1, (inside.maxX - inside.minX - 2 * m) / (2 * r1.side), (inside.maxZ - inside.minZ - 2 * m) / (2 * r1.side));
          const P = scaleDrawerRing(R, s);
          const reach = drawerRingReach(P);
          // Against the inner front, centred between the walls, just over the bottom (it moves with the drawer: a child of its effect plane).
          const centre = new THREE.Vector3((inside.minX + inside.maxX) / 2, inside.minY + reach.body + m, inside.maxZ - reach.side - m);
          _drawerEffectMesh.updateMatrixWorld(true);
          const local = _drawerEffectMesh.worldToLocal(centre.clone());
          const ringGroupWorld = new THREE.Vector3();
          const ringQuat = new THREE.Quaternion();
          _drawerRing = createPortalRing(THREE, {
            P,
            scene,
            parent: _drawerEffectMesh, // it moves with the drawer
            localCentre: local,
            localFwd: new THREE.Vector3(0, 1, 0), // facing up
            centre,
            fwd: new THREE.Vector3(0, 1, 0),
            floorY: inside.minY, // the drawer's bottom: nothing goes under it
            arcScale: s,
            flashMax: 2 * reach.body, // its flash (a camera-facing glow) no taller than its body: never under the bottom
            maxReach: reach.side - DRAWER_RING_GLOW, // sparks, drifting rim particles and arcs stop at the walls
            stencilBit: 2,
            flow: R.flow,
            getCamera: () => camera,
            // Its arcs follow the ring as the drawer slides: centre, out axis and in-plane axes in world space.
            getFrame: (cOut, fOut, uOut, vOut) => {
              const g = _drawerRing.group;
              g.updateWorldMatrix(true, false);
              g.getWorldPosition(ringGroupWorld);
              g.getWorldQuaternion(ringQuat);
              cOut.copy(ringGroupWorld);
              fOut.set(0, 0, 1).applyQuaternion(ringQuat);
              uOut.set(1, 0, 0).applyQuaternion(ringQuat);
              vOut.set(0, 1, 0).applyQuaternion(ringQuat);
            },
          });
          // Its light is the drawer's portal light (kept on the drawer: the scene's light count never changes).
          _drawerPortalPointLight = _drawerRing.light;
          _drawerPortalPointLight.name = "drawerPortalPointLight";
          _drawerRing.arcs.mesh.visible = false;
        }
        // The drawer's own effect plane only carries the effect now (not drawn itself).
        _drawerEffectMesh.material = new THREE.MeshBasicMaterial({ visible: false });
        _drawerEffectMesh.frustumCulled = false;
        _drawerEffectMesh.visible = false;
      }

      /**
       * Shows the closed drawer's portal (fully transparent, its light at 0) so
       * its shaders compile behind the loader instead of when the drawer opens.
       */
      function setDrawerPortalWarmup(on) {
        if (!_drawerEffectMesh || _drawerState !== "closed") return;
        _drawerEffectMesh.visible = on;
        if (_drawerPortalPointLight) _drawerPortalPointLight.intensity = 0;
      }

      function setDrawerPortalActive(active) {
        if (!_drawerEffectMesh) return;
        if (!active) {
          _drawerPortalFadeOutStartMs = performance.now();
          return;
        }
        _drawerEffectMesh.visible = true;
        _drawerPortalStartMs = performance.now();
        if (_drawerRing) {
          _drawerRing.reset();
          _drawerRing.arcs.mesh.visible = true;
          _drawerRing.tick(0);
        }
        for (let i = 0; i < _drawerPortalArrowMaterials.length; i++) {
          _drawerPortalArrowMaterials[i].opacity = 0;
        }
      }

      /**
       * How long before the drawer slides back its ring starts closing (s): its collapse and closing flash
       * (`closeTime`) and its last smoke wisps fading after that flash (the ring's own 1.6 × flashSec), at the same pace.
       */
      function drawerRingCloseLead() {
        const R = DRAWER_RING;
        return (R.closeTime * (R.closeTo - R.closeFrom + R.flashSec * 1.6)) / (R.closeTo - R.closeFrom + R.flashSec);
      }

      /** The effect's closing has started (after it was last started). */
      function drawerRingClosing() {
        return _drawerPortalFadeOutStartMs > _drawerPortalStartMs;
      }

      function updateDrawerPortalEffect() {
        if (
          !_drawerEffectMesh ||
          !_drawerEffectMesh.visible ||
          (_drawerState !== "open" && _drawerState !== "closing")
        )
          return;
        const portalTime = (performance.now() - _drawerPortalStartMs) / 1000;
        const fadeOutTime =
          (performance.now() - _drawerPortalFadeOutStartMs) / 1000;
        const isFadingOut = drawerRingClosing();
        // The ring: its sequence from when the drawer is open, held open at openHold while the drawer stays open;
        // its collapse and closing flash (closeTime) just before the drawer slides back.
        if (_drawerRing) {
          const R = DRAWER_RING;
          const closeSpan = R.closeTo - R.closeFrom + R.flashSec;
          const phaseT = isFadingOut
            ? R.closeFrom + Math.min(drawerRingCloseLead() / R.closeTime, fadeOutTime / R.closeTime) * closeSpan
            : Math.min(portalTime, R.openHold);
          _drawerRing.tick(phaseT, portalTime);
        }
        if (_drawerPortalArrow) {
          const arrowReveal = isFadingOut
            ? 1 - THREE.MathUtils.smoothstep(fadeOutTime, 0, 0.2)
            : THREE.MathUtils.smoothstep(portalTime, 0.15, 0.9);
          for (let i = 0; i < _drawerPortalArrowMaterials.length; i++) {
            const material = _drawerPortalArrowMaterials[i];
            material.opacity = arrowReveal * material.userData.maxOpacity;
          }
          _drawerPortalArrow.position.y =
            5 + Math.sin(portalTime * 2.8) * 0.14;
          _drawerPortalArrow.rotation.y = portalTime * 0.65;
          const arrowPulse = 1 + Math.sin(portalTime * 4.5) * 0.045;
          _drawerPortalArrow.scale.setScalar(arrowPulse);
        }
      }

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
        setupDrawerPortalEffect();
        // The portal's light lives on the drawer (always shown, dark while closed)
        // instead of the hidden portal mesh: the scene's light count then never
        // changes when the drawer opens, so nothing has to recompile at that moment.
        if (_drawerPortalPointLight) drawerGroup.attach(_drawerPortalPointLight);
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
            setDrawerPortalActive(true);
          }
        } else if (_drawerState === "open") {
          // The ring collapses just before the drawer slides back (gone before any of it goes into the housing).
          if (elapsed >= DRAWER_OPEN_HOLD - drawerRingCloseLead() * 1000 && !drawerRingClosing()) setDrawerPortalActive(false);
          updateDrawerPortalEffect();
          if (elapsed >= DRAWER_OPEN_HOLD) {
            if (!drawerRingClosing()) setDrawerPortalActive(false);
            _drawerState = "closing";
            _drawerAnimStart = performance.now();
          }
        } else if (_drawerState === "closing") {
          updateDrawerPortalEffect();
          const t = Math.min(elapsed / DRAWER_SLIDE_DURATION, 1);
          const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          drawerGroup.position.z = _drawerOrigZ + DRAWER_SLIDE_DISTANCE * (1 - ease);
          if (t >= 1) {
            drawerGroup.position.z = _drawerOrigZ;
            _drawerState = "closed";
            if (_drawerEffectMesh) _drawerEffectMesh.visible = false;
            if (_drawerPortalPointLight) _drawerPortalPointLight.intensity = 0;
            if (_drawerRing) {
              _drawerRing.arcs.mesh.visible = false;
              _drawerRing.arcs.light.intensity = 0;
            }
          }
        }
      }

      // The drawer opens when the car stands on phoneChargerCup (it used to be the M key).
      /** Extra radius around the cup's top (world units) the car's centre may be within. */
      const DRAWER_CUP_MARGIN = 0.35;
      /** Seconds the car must stay on the cup before the drawer opens. */
      const DRAWER_CUP_HOLD_SEC = 0.4;
      /** Max gap between the car's wheels and the cup's top to count as touching it (not flying over). */
      const DRAWER_CUP_CONTACT_TOLERANCE = 0.3;
      /** Glow colour on the charger while the car is on it (the kitchen transition's blue). */
      const DRAWER_CUP_CUE_COLOR = 0x2090ff;
      /** Cup glow strength at full charge (emissive intensity; was 0.55, far below the bloom threshold). */
      const DRAWER_CUP_CUE_CUP_EMISSIVE = 0.3;
      /** Seconds for the glow to fade after the car leaves. */
      const DRAWER_CUP_CUE_FADE_SEC = 0.35;
      let _drawerCupHold = 0;
      /** false after the cup opened the drawer, until the car has left the cup and the drawer has closed. */
      let _drawerCupArmed = true;
      let _drawerCupCue = 0;
      let _drawerCupBoundsReady = false;
      let _drawerCupRadius = 0;
      let _drawerCupTopY = 0;
      const _drawerCupCenter = new THREE.Vector3();
      const _drawerCupBox = new THREE.Box3();
      const _drawerCupLightBaseColor = new THREE.Color();
      const _drawerCupLightBaseEmissive = new THREE.Color();
      const _drawerCupCueColor = new THREE.Color(DRAWER_CUP_CUE_COLOR);

      /** Same as the old M key: starts the drawer's opening animation (and everything after it). */
      const _drawerErrorsLogged = new Set();
      /** A problem in the drawer's trigger or animation is logged once, and the scene keeps running. */
      function logDrawerErrorOnce(where, err) {
        if (_drawerErrorsLogged.has(where)) return;
        _drawerErrorsLogged.add(where);
        console.error(`[office] drawer ${where} failed:`, err);
      }

      function openDrawerFromCharger() {
        if (!drawerGroup || _drawerState !== "closed") return false;
        _drawerState = "opening";
        _drawerAnimStart = performance.now();
        _drawerOrigZ = drawerGroup.position.z;
        return true;
      }

      function isCarStandingOnChargerCup() {
        if (!car || !phoneChargerCupMesh || carFalling) return false;
        if (!_drawerCupBoundsReady) {
          _drawerCupBox.setFromObject(phoneChargerCupMesh);
          _drawerCupBox.getCenter(_drawerCupCenter);
          _drawerCupRadius =
            Math.max(
              _drawerCupBox.max.x - _drawerCupBox.min.x,
              _drawerCupBox.max.z - _drawerCupBox.min.z,
            ) / 2;
          _drawerCupTopY = _drawerCupBox.max.y;
          _drawerCupLightBaseColor.copy(phoneChargerLightMaterial.color);
          _drawerCupLightBaseEmissive.copy(phoneChargerLightMaterial.emissive);
          _drawerCupBoundsReady = true;
        }
        const dx = car.position.x - _drawerCupCenter.x;
        const dz = car.position.z - _drawerCupCenter.z;
        if (dx * dx + dz * dz > (_drawerCupRadius + DRAWER_CUP_MARGIN) ** 2)
          return false;
        // Touching: on the ground (not in the air) with its wheels at the cup's top.
        if (carState.velY !== 0) return false;
        const wheelsY = car.position.y - carBottomOffsetY;
        return Math.abs(wheelsY - _drawerCupTopY) <= DRAWER_CUP_CONTACT_TOLERANCE;
      }

      /** Per frame: hold timer, one opening per visit, and the glow cue on the charger. */
      function updateDrawerCupTrigger(realDt) {
        const onCup = officeIntro.state === "done" && isCarStandingOnChargerCup();
        if (onCup) {
          if (_drawerCupArmed && _drawerState === "closed") {
            _drawerCupHold += realDt;
            if (_drawerCupHold >= DRAWER_CUP_HOLD_SEC && openDrawerFromCharger()) {
              _drawerCupArmed = false;
            }
          }
        } else {
          _drawerCupHold = 0;
          if (!_drawerCupArmed && _drawerState === "closed") _drawerCupArmed = true;
        }
        // Cue: fills while holding, full while the drawer it opened is out.
        const cueTarget = onCup
          ? _drawerCupArmed
            ? Math.min(1, _drawerCupHold / DRAWER_CUP_HOLD_SEC)
            : 1
          : 0;
        _drawerCupCue =
          cueTarget > _drawerCupCue
            ? cueTarget
            : Math.max(cueTarget, _drawerCupCue - realDt / DRAWER_CUP_CUE_FADE_SEC);
        updatePhoneChargerGlow(_drawerCupCue);
        if (!_drawerCupBoundsReady) return;
        const k = _drawerCupCue;
        if (k === 0 && phoneChargerCupMaterial.emissiveIntensity === 0) return;
        phoneChargerLightMaterial.color.lerpColors(_drawerCupLightBaseColor, _drawerCupCueColor, k);
        phoneChargerLightMaterial.emissive.lerpColors(_drawerCupLightBaseEmissive, _drawerCupCueColor, k);
        phoneChargerCupMaterial.emissive.copy(_drawerCupCueColor);
        phoneChargerCupMaterial.emissiveIntensity = k * DRAWER_CUP_CUE_CUP_EMISSIVE;
      }

      function setupSimplePropPhysics(model, meshName, mass, shapeType) {
        const meshAliases = {
          musaPhysic: ["musaPhysic", "musaPhysics"],
          duckBodyPhysic: ["duckBodyPhysic", "duckPhysic"],
        };
        const lookupNames = meshAliases[meshName] || [meshName];
        let physicMesh = null;
        model.traverse((node) => {
          if (!node.isMesh || physicMesh) return;
          if (lookupNames.includes(node.name)) physicMesh = node;
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
          collisionFilterGroup: STATIC_OBSTACLE_PHYS_NAMES.has(meshName)
            ? PHYS_GROUP_DESK_STATIC
            : 1,
          collisionFilterMask: STATIC_OBSTACLE_PHYS_NAMES.has(meshName) ? 0 : -1,
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

      function unfreezeKnockableBody(pb) {
        if (!pb || !pb._frozen) return false;
        pb._frozen = false;
        pb.allowSleep = pb === gumDispenserPhysBody || !!pb._sleepWhenSettled;
        pb.wakeUp();
        return true;
      }

      function knockableOverlapsCar(pb, carR) {
        if (!pb || !car || carFalling) return false;
        for (let si = 0; si < pb.shapes.length; si++) {
          const sh = pb.shapes[si];
          const he = getShapeHalfExtents(sh);
          if (!he) continue;
          const off = pb.shapeOffsets[si];
          const bx = pb.position.x + (off ? off.x : 0);
          const by = pb.position.y + (off ? off.y : 0);
          const bz = pb.position.z + (off ? off.z : 0);
          const dx = car.position.x - bx;
          const dy = car.position.y - by;
          const dz = car.position.z - bz;
          if (Math.abs(dy) >= he.y + carR) continue;
          if (Math.abs(dx) >= he.x + carR || Math.abs(dz) >= he.z + carR) continue;
          return true;
        }
        return false;
      }

      const PROP_PHYS_NAMES = [
        "dockingStationPhysic", "plantVasePhysic", "macScreenFramePhysic",
        "macBodyBasePhysic", "mainScreensPin", "mainScreensBase",
        "musaPhysic", "duckBodyPhysic", "panHolderPhysic",
      ];
      const STATIC_OBSTACLE_PHYS_NAMES = new Set([
        "musaPhysic",
        "duckBodyPhysic",
        "panHolderPhysic",
      ]);
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
        if (dockingStationPhysBody) dockingStationPhysBody._driveableStep = CAR_DRIVEABLE_PROP_MAX_STEP;
        plantVasePhysBody = _propBodies["plantVasePhysic"] || null;
        if (plantVasePhysBody) plantVasePhysBody._noClimb = true;
        macScreenFramePhysBody = _propBodies["macScreenFramePhysic"] || null;
        if (macScreenFramePhysBody) macScreenFramePhysBody._noClimb = true;
        macBodyBasePhysBody = _propBodies["macBodyBasePhysic"] || null;
        if (macBodyBasePhysBody) macBodyBasePhysBody._driveableStep = CAR_DRIVEABLE_PROP_MAX_STEP;
        mainScreensPinPhysBody = _propBodies["mainScreensPin"] || null;
        mainScreensBasePhysBody = _propBodies["mainScreensBase"] || null;
        musaPhysBody = _propBodies["musaPhysic"] || null;
        duckBodyPhysBody = _propBodies["duckBodyPhysic"] || null;
        panHolderPhysBody = _propBodies["panHolderPhysic"] || null;
        if (musaPhysBody) musaPhysBody._noClimb = true;
        if (duckBodyPhysBody) duckBodyPhysBody._noClimb = true;
        if (panHolderPhysBody) panHolderPhysBody._noClimb = true;

      }

      function getKnockableResolveBounds(body, outCenter, outHalf) {
        const bodyHe = body.shapes[0] ? getShapeHalfExtents(body.shapes[0]) : null;
        if (!bodyHe) return false;
        outCenter.set(body.position.x, body.position.y, body.position.z);
        outHalf.set(bodyHe.x, bodyHe.y, bodyHe.z);
        return true;
      }

      function resolveKnockableBoxOverlap(body, cx, cy, cz, hx, hy, hz, ox, oy, oz, ohx, ohy, ohz) {
        const dx = cx - ox;
        const dy = cy - oy;
        const dz = cz - oz;
        const overlapX = ohx + hx - Math.abs(dx);
        const overlapY = ohy + hy - Math.abs(dy);
        const overlapZ = ohz + hz - Math.abs(dz);
        if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) return false;

        const minOverlap = Math.min(overlapX, overlapY, overlapZ);
        if (minOverlap === overlapX) {
          body.position.x += Math.sign(dx || 1) * overlapX;
          body.velocity.x = 0;
        } else if (minOverlap === overlapY) {
          body.position.y += Math.sign(dy || 1) * overlapY;
          body.velocity.y = 0;
        } else {
          body.position.z += Math.sign(dz || 1) * overlapZ;
          body.velocity.z = 0;
        }
        return true;
      }

      function resolveKnockableAgainstPhysicMesh(body, mesh) {
        if (!body || !mesh) return false;
        if (!getKnockableResolveBounds(body, _v0, _v1)) return false;
        const bx = _v0.x;
        const by = _v0.y;
        const bz = _v0.z;
        const bhx = _v1.x;
        const bhy = _v1.y;
        const bhz = _v1.z;

        mesh.updateMatrixWorld(true);
        _handBlockBox.setFromObject(mesh);
        if (_handBlockBox.isEmpty()) return false;

        _handBlockBox.getCenter(_v2);
        _handBlockBox.getSize(_v3);
        const heX = _v3.x * 0.5;
        const heY = _v3.y * 0.5;
        const heZ = _v3.z * 0.5;
        return resolveKnockableBoxOverlap(
          body,
          bx,
          by,
          bz,
          bhx,
          bhy,
          bhz,
          _v2.x,
          _v2.y,
          _v2.z,
          heX,
          heY,
          heZ,
        );
      }

      function resolveKnockableAgainstStaticObstacleBody(body, obstacleBody) {
        if (!body || !obstacleBody) return false;
        if (!getKnockableResolveBounds(body, _v0, _v1)) return false;
        const bx = _v0.x;
        const by = _v0.y;
        const bz = _v0.z;
        const bhx = _v1.x;
        const bhy = _v1.y;
        const bhz = _v1.z;
        let moved = false;
        for (let si = 0; si < obstacleBody.shapes.length; si++) {
          const he = getShapeHalfExtents(obstacleBody.shapes[si]);
          if (!he) continue;
          const off = obstacleBody.shapeOffsets[si];
          const ox = obstacleBody.position.x + (off ? off.x : 0);
          const oy = obstacleBody.position.y + (off ? off.y : 0);
          const oz = obstacleBody.position.z + (off ? off.z : 0);
          if (
            resolveKnockableBoxOverlap(
              body,
              bx,
              by,
              bz,
              bhx,
              bhy,
              bhz,
              ox,
              oy,
              oz,
              he.x,
              he.y,
              he.z,
            )
          ) {
            moved = true;
          }
        }
        return moved;
      }

      function resolveKnockableAgainstStaticObstacles(body) {
        if (!body || body._frozen) return false;
        let moved = false;
        for (const meshName of STATIC_OBSTACLE_PHYS_NAMES) {
          const mesh = _propMeshes[meshName];
          const obstacleBody = _propBodies[meshName];
          if (resolveKnockableAgainstPhysicMesh(body, mesh)) moved = true;
          if (resolveKnockableAgainstStaticObstacleBody(body, obstacleBody))
            moved = true;
        }
        return moved;
      }

      function syncAllPropsFromPhysics() {
        for (const name of PROP_PHYS_NAMES) {
          if (STATIC_OBSTACLE_PHYS_NAMES.has(name)) continue;
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

      /** Cannon trimesh from a Blender physic mesh (world-space verts at build time). */
      function buildGumsPhysicsTrimeshFromObject(obj, physScale = 1.0, doubleSided = false) {
        if (!obj) return null;
        const sc = physScale || 1.0;
        if (gumDispenserGroup) gumDispenserGroup.updateMatrixWorld(true);
        if (_currentWorldModel) _currentWorldModel.updateMatrixWorld(true);
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
        let triInds = inds;
        if (doubleSided) {
          const doubleInds = [];
          for (let i = 0; i < inds.length; i += 3) {
            doubleInds.push(inds[i], inds[i + 1], inds[i + 2]);
            doubleInds.push(inds[i + 2], inds[i + 1], inds[i]);
          }
          triInds = doubleInds;
        }
        const tri = new CANNON.Trimesh(verts, triInds);
        tri.updateTree();
        tightenTrimeshAabbQuery(tri);
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
        return { body, trimesh: tri };
      }

      function getGumDispenserBottomY() {
        if (!gumDispenserGroup) return null;
        gumDispenserGroup.updateMatrixWorld(true);
        if (gumsStandObject) {
          const standBB = new THREE.Box3().setFromObject(gumsStandObject);
          if (!standBB.isEmpty()) return standBB.min.y;
        }
        const visBB = new THREE.Box3().setFromObject(gumDispenserGroup);
        if (!visBB.isEmpty()) return visBB.min.y;
        return null;
      }

      function liftGumDispenserAssembly(liftY) {
        if (!liftY || Math.abs(liftY) < 0.0005) return;
        if (gumDispenserPhysBody) gumDispenserPhysBody.position.y += liftY;
        if (gumDispenserGroup) gumDispenserGroup.position.y += liftY;
        for (const b of _gumDispenserInternalBodies) {
          if (!b) continue;
          b.position.y += liftY;
          if (b._gdOrigPos) b._gdOrigPos.y += liftY;
        }
        if (gumsStoperBody) gumsStoperBody.position.y += liftY;
      }

      function placeGumDispenserOnTable(clearance = 0.012) {
        if (!gumDispenserPhysBody || !gumDispenserGroup) return;
        const tableTop = getTableTopY();
        if (tableTop == null) return;
        const floorY = tableTop + clearance;
        gumDispenserGroup.position.set(
          gumDispenserPhysBody.position.x,
          gumDispenserPhysBody.position.y,
          gumDispenserPhysBody.position.z,
        );
        gumDispenserGroup.quaternion.set(
          gumDispenserPhysBody.quaternion.x,
          gumDispenserPhysBody.quaternion.y,
          gumDispenserPhysBody.quaternion.z,
          gumDispenserPhysBody.quaternion.w,
        );
        const bottomY = getGumDispenserBottomY();
        if (bottomY == null) return;
        liftGumDispenserAssembly(floorY - bottomY);
      }

      function refreshGumDispenserInternalAnchors() {
        _gumDispenserInternalBodies = [
          gumsTankPhysBody,
          gumsTankCupBody,
          gumsBodyPhysBody,
          gumsStandPhysBody,
          gumsRampPhysBody,
        ].filter(Boolean);
        for (const b of _gumDispenserInternalBodies) {
          b._gdOrigPos = new CANNON.Vec3(b.position.x, b.position.y, b.position.z);
          b._gdOrigQuat = new CANNON.Quaternion(
            b.quaternion.x,
            b.quaternion.y,
            b.quaternion.z,
            b.quaternion.w,
          );
        }
      }

      function rebuildGumsTankPhysicsFromMesh() {
        if (!gumsTankPhysicObject) return;
        if (gumsTankPhysBody && physicsWorld.bodies.includes(gumsTankPhysBody)) {
          physicsWorld.removeBody(gumsTankPhysBody);
          _debugGumSet.delete(gumsTankPhysBody);
        }
        gumsTankPhysBody = null;
        gumsTankTrimesh = null;
        const result = buildGumsPhysicsTrimeshFromObject(
          gumsTankPhysicObject,
          GUM_TANK_TRIMESH_SCALE,
          false,
        );
        if (result) {
          gumsTankPhysBody = result.body;
          gumsTankTrimesh = result.trimesh;
        }
      }

      /** Thick box walls that follow gumsTankPhysic's inner surface (the trimesh is only 0.03 thick vs gum r 0.14). */
      const GUM_TANK_WALL_THICKNESS = 0.12;
      /** Vertical spacing of wall rings sampled from the trimesh (sets how closely the openings are matched). */
      const GUM_TANK_WALL_BAND_STEP = 0.08;
      /** Wall pieces around each ring (11.25° each). */
      const GUM_TANK_WALL_SEGMENTS = 32;
      /** Neighbouring pieces overlap by this factor so gums can't slip through the seams. */
      const GUM_TANK_WALL_OVERLAP = 1.15;
      /** Wall pieces per physics body (8 = 90° arcs): balances broadphase bodies vs shapes tested per pair. */
      const GUM_TANK_WALL_CELLS_PER_BODY = 2;
      /** After a hit the world steps at this fixed rate (was one 1/60 step, max 2) so gums can't jump a wall in one step. */
      const GUM_HIT_PHYS_FIXED_STEP = 1 / 120;
      /** Same per-frame physics budget as before the fix (2 × 1/60 s), so slow frames can't snowball. */
      const GUM_HIT_PHYS_MAX_SUBSTEPS = 4;
      /** After a hit, push for gums at the chute bottom toward the bottom hole (flat floor; > friction 0.5 × g 480). */
      const GUM_EXIT_NUDGE_ACCEL = 320;
      /** After a hit, push for slow gums in the globe toward the chute, so none rest in corners. */
      const GUM_FUNNEL_NUDGE_ACCEL = 60;
      /** Globe gums moving slower than this (relative to the tank) get the funnel push. */
      const GUM_FUNNEL_NUDGE_SPEED = 3;
      /** Extra push toward the chute bottom, scaled by how far the tank is tipped (0 upright → 1 on its side). */
      const GUM_TIPPED_NUDGE_ACCEL = 320;
      let _gumTankWallData = null;
      let _gumTankWallBodies = null;
      let _gumTankWallsRetired = false;
      let _gumHitPhysAccum = 0;

      /** Ray-cast the tank trimesh (body frame) into rings of inner-wall distances; NaN = opening (top hole, bottom hole). */
      function ensureGumTankWallData() {
        if (_gumTankWallData || !gumsTankTrimesh) return _gumTankWallData;
        const V = gumsTankTrimesh.vertices;
        const I = gumsTankTrimesh.indices;
        const nTri = I.length / 3;
        const triMinY = new Float32Array(nTri);
        const triMaxY = new Float32Array(nTri);
        let y0 = Infinity;
        let y1 = -Infinity;
        for (let t = 0; t < nTri; t++) {
          const a = V[I[3 * t] * 3 + 1], b = V[I[3 * t + 1] * 3 + 1], c = V[I[3 * t + 2] * 3 + 1];
          triMinY[t] = Math.min(a, b, c);
          triMaxY[t] = Math.max(a, b, c);
          if (triMinY[t] < y0) y0 = triMinY[t];
          if (triMaxY[t] > y1) y1 = triMaxY[t];
        }
        const rayHit = (ox, oy, oz, dx, dy, dz, tris) => {
          let best = Infinity;
          for (let k = 0; k < tris.length; k++) {
            const t = tris[k];
            const a = I[3 * t] * 3, b = I[3 * t + 1] * 3, c = I[3 * t + 2] * 3;
            const e1x = V[b] - V[a], e1y = V[b + 1] - V[a + 1], e1z = V[b + 2] - V[a + 2];
            const e2x = V[c] - V[a], e2y = V[c + 1] - V[a + 1], e2z = V[c + 2] - V[a + 2];
            const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
            const det = e1x * px + e1y * py + e1z * pz;
            if (Math.abs(det) < 1e-12) continue;
            const inv = 1 / det;
            const sx = ox - V[a], sy = oy - V[a + 1], sz = oz - V[a + 2];
            const u = (sx * px + sy * py + sz * pz) * inv;
            if (u < 0 || u > 1) continue;
            const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
            const v = (dx * qx + dy * qy + dz * qz) * inv;
            if (v < 0 || u + v > 1) continue;
            const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
            if (tt > 1e-6 && tt < best) best = tt;
          }
          return best;
        };
        const M = GUM_TANK_WALL_SEGMENTS;
        const step = GUM_TANK_WALL_BAND_STEP;
        const all = Array.from({ length: nTri }, (_, t) => t);
        const castRing = (cx, cz, y, tris, d) => {
          for (let j = 0; j < M; j++) {
            const ang = (j / M) * Math.PI * 2;
            const h = rayHit(cx, y, cz, Math.cos(ang), 0, Math.sin(ang), tris);
            d[j] = Number.isFinite(h) ? h : NaN;
          }
        };
        // Ring centre = mean midpoint of opposite wall hits, so openings don't skew it.
        const recenter = (cx, cz, d) => {
          let sx = 0, sz = 0, n = 0;
          for (let j = 0; j < M / 2; j++) {
            const a = d[j], b = d[j + M / 2];
            if (Number.isNaN(a) || Number.isNaN(b)) continue;
            const ang = (j / M) * Math.PI * 2;
            sx += cx + Math.cos(ang) * (a - b) * 0.5;
            sz += cz + Math.sin(ang) * (a - b) * 0.5;
            n++;
          }
          return n >= M / 8 ? [sx / n, sz / n] : null;
        };
        let cx = 0, cz = 0;
        for (let i = 0; i < V.length; i += 3) { cx += V[i]; cz += V[i + 2]; }
        cx /= V.length / 3;
        cz /= V.length / 3;
        const floorHit = rayHit(cx, y0 + 0.5, cz, 0, -1, 0, all);
        const floorTop = Number.isFinite(floorHit) ? y0 + 0.5 - floorHit : null;
        const bandY0 = (floorTop != null ? floorTop : y0) + step * 0.25;
        const bands = [];
        for (let y = bandY0; y < y1; y += step) {
          const tris = [];
          for (let t = 0; t < nTri; t++) if (triMinY[t] <= y && triMaxY[t] >= y) tris.push(t);
          const d = new Float32Array(M);
          for (let pass = 0; pass < 2; pass++) {
            castRing(cx, cz, y, tris, d);
            const c = recenter(cx, cz, d);
            if (!c) break;
            cx = c[0];
            cz = c[1];
          }
          castRing(cx, cz, y, tris, d);
          bands.push({ y, cx, cz, d }); // contiguous: index = (y - y0) / step
        }
        if (bands.length < 2) return null;
        // Bottom hole direction/height (openings in the lower half) and the neck (top of the chute) for the release pushes.
        const yMid = (bands[0].y + bands[bands.length - 1].y) * 0.5;
        let ex = 0, ez = 0, exYMin = Infinity, exYMax = -Infinity;
        for (const b of bands) {
          if (b.y > yMid) continue;
          for (let j = 0; j < M; j++) {
            if (!Number.isNaN(b.d[j])) continue;
            const ang = (j / M) * Math.PI * 2;
            ex += Math.cos(ang);
            ez += Math.sin(ang);
            exYMin = Math.min(exYMin, b.y);
            exYMax = Math.max(exYMax, b.y);
          }
        }
        const exLen = Math.hypot(ex, ez);
        const exit = exLen > 0 ? { dirX: ex / exLen, dirZ: ez / exLen, yMin: exYMin, yMax: exYMax } : null;
        const medD = (b) => {
          const xs = Array.from(b.d).filter((x) => !Number.isNaN(x)).sort((a, c) => a - c);
          return xs.length ? xs[xs.length >> 1] : Infinity;
        };
        const chuteD = medD(bands[0]);
        let neck = bands[0];
        for (const b of bands) {
          if (medD(b) > chuteD * 1.25) break;
          neck = b;
        }
        _gumTankWallData = {
          bands, floorTop, floorCx: bands[0].cx, floorCz: bands[0].cz, y0: bands[0].y, step, M,
          exit, neck: { x: neck.cx, y: neck.y, z: neck.cz },
        };
        return _gumTankWallData;
      }

      /** Kinematic box walls posed with gumsTankPhysBody; added only once gums can leave the globe (hit or cup release). */
      function enableGumTankThickWalls() {
        if (_gumTankWallBodies || _gumTankWallsRetired || !gumsTankPhysBody) return;
        const data = ensureGumTankWallData();
        if (!data) return;
        const { bands, M } = data;
        const T = GUM_TANK_WALL_THICKNESS;
        const halfSeg = Math.tan(Math.PI / M) * GUM_TANK_WALL_OVERLAP;
        const tx = new THREE.Vector3(), sy = new THREE.Vector3(), nz = new THREE.Vector3();
        const basis = new THREE.Matrix4();
        const q3 = new THREE.Quaternion();
        _gumTankWallBodies = [];
        const makeBody = () =>
          new CANNON.Body({
            type: CANNON.Body.KINEMATIC,
            material: tankMaterial,
            collisionFilterGroup: PHYS_GROUP_GUMS_TRIMESH,
            collisionFilterMask: PHYS_GROUP_GUM_SPHERE,
          });
        // Small bodies (a few boxes each, origin at their own centre): cannon's SAP pairs by bounding sphere.
        const addCellsBody = (cells) => {
          if (!cells.length) return;
          let ox = 0, oy = 0, oz = 0;
          for (const c of cells) { ox += c.p.x; oy += c.p.y; oz += c.p.z; }
          const o = new CANNON.Vec3(ox / cells.length, oy / cells.length, oz / cells.length);
          const body = makeBody();
          for (const c of cells) body.addShape(c.shape, c.p.vsub(o), c.q);
          body._wallOffset = o;
          _gumTankWallBodies.push(body);
        };
        for (let k = 0; k + 1 < bands.length; k++) {
          const A = bands[k];
          const B = bands[k + 1];
          let cells = [];
          for (let j = 0; j < M; j++) {
            if (j % GUM_TANK_WALL_CELLS_PER_BODY === 0) {
              addCellsBody(cells);
              cells = [];
            }
            const da = A.d[j];
            const db = B.d[j];
            if (Number.isNaN(da) || Number.isNaN(db)) continue; // keep openings open
            const ang = (j / M) * Math.PI * 2;
            const ux = Math.cos(ang), uz = Math.sin(ang);
            const ax = A.cx + ux * da, az = A.cz + uz * da;
            const bx = B.cx + ux * db, bz = B.cz + uz * db;
            const dr = db - da;
            const dyy = B.y - A.y;
            const len = Math.hypot(dr, dyy);
            const nr = dyy / len, ny = -dr / len; // outward normal in the radial plane
            tx.set(-uz, 0, ux);
            sy.set(ux * dr, dyy, uz * dr).normalize();
            nz.crossVectors(tx, sy);
            basis.makeBasis(tx, sy, nz);
            q3.setFromRotationMatrix(basis);
            const rMax = Math.max(da, db) + T;
            cells.push({
              shape: new CANNON.Box(
                new CANNON.Vec3(rMax * halfSeg, len * 0.5 * GUM_TANK_WALL_OVERLAP, T * 0.5),
              ),
              p: new CANNON.Vec3(
                (ax + bx) * 0.5 + ux * nr * T * 0.5,
                (A.y + B.y) * 0.5 + ny * T * 0.5,
                (az + bz) * 0.5 + uz * nr * T * 0.5,
              ),
              q: new CANNON.Quaternion(q3.x, q3.y, q3.z, q3.w),
            });
          }
          addCellsBody(cells);
        }
        if (data.floorTop != null) {
          // Square floor sized to the chute's inner radius, one edge facing the bottom hole: no ledge outside the hole.
          let rFloor = Infinity;
          for (let j = 0; j < M; j++) if (!Number.isNaN(bands[0].d[j])) rFloor = Math.min(rFloor, bands[0].d[j]);
          const floorQ = new CANNON.Quaternion();
          if (data.exit) floorQ.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -Math.atan2(data.exit.dirZ, data.exit.dirX));
          addCellsBody([
            {
              shape: new CANNON.Box(new CANNON.Vec3(rFloor, T * 0.5, rFloor)),
              p: new CANNON.Vec3(data.floorCx, data.floorTop - T * 0.5, data.floorCz),
              q: floorQ,
            },
          ]);
        }
        for (const b of _gumTankWallBodies) physicsWorld.addBody(b);
        // The walls replace the trimesh for gums: sphere-vs-trimesh costs ~0.25 ms per gum (long chute triangles).
        gumsTankPhysBody.collisionFilterMask = 0;
        syncGumTankThickWalls();
      }

      const _gumWallOffW = new CANNON.Vec3();
      function syncGumTankThickWalls() {
        if (!_gumTankWallBodies || !gumsTankPhysBody) return;
        const src = gumsTankPhysBody;
        const w = src.angularVelocity;
        for (const b of _gumTankWallBodies) {
          src.quaternion.vmult(b._wallOffset, _gumWallOffW);
          src.position.vadd(_gumWallOffW, b.position);
          b.quaternion.copy(src.quaternion);
          w.cross(_gumWallOffW, b.velocity);
          b.velocity.vadd(src.velocity, b.velocity);
          b.angularVelocity.copy(w);
          b.aabbNeedsUpdate = true;
        }
      }

      /**
       * During a release every gum still in the tank stays fully dynamic and
       * awake (no sleeping, no freezing) until it leaves through the bottom
       * hole, so the whole pile sinks as the bottom drains.
       */
      function keepTankGumsAwakeForRelease() {
        if (!_gumDispenserBecameDynamic && gumReleased.size === 0) return;
        for (let i = 0; i < gumsAddedCount; i++) {
          const b = gumBodies[i];
          if (b._exitedGumTank) continue;
          if (!_gumDispenserBecameDynamic && !gumReleased.has(i)) continue;
          if (b.type === CANNON.Body.STATIC) {
            b.type = CANNON.Body.DYNAMIC;
            b.mass = 0.5;
            b.updateMassProperties();
          }
          b.allowSleep = false;
          if (b.sleepState !== CANNON.Body.AWAKE) b.wakeUp();
        }
      }

      /** Gums out of the tank come to rest (STATIC) below this speed and spin (a gum rolling at 0.3 spins ~2 rad/s; was 0.3 and 1.0 and only slept, so slow rollers never stopped)... */
      const GUM_EXITED_SLEEP_SPEED = 0.3;
      const GUM_EXITED_SLEEP_SPIN = 3.0;
      /** ...for this long in a row (s; was 0.5). */
      const GUM_EXITED_SLEEP_SEC = 0.35;
      /** Spin damping once a gum leaves the machine (was 0.55 after a hit; the cup release already used 0.90). */
      const GUM_EXITED_ANGULAR_DAMPING = GUM_TABLE.exitedAngularDamping;
      function anyGumLeftInTank() {
        for (let i = 0; i < gumsAddedCount; i++) if (!gumBodies[i]._exitedGumTank) return true;
        return false;
      }

      /** Tank empty: drop the walls (and the fine physics step) and give the trimesh back its exterior collisions. */
      function retireGumTankThickWalls() {
        if (!_gumTankWallBodies) return;
        for (const b of _gumTankWallBodies) physicsWorld.removeBody(b);
        _gumTankWallBodies = null;
        _gumTankWallsRetired = true;
        if (gumsTankPhysBody) gumsTankPhysBody.collisionFilterMask = PHYS_GROUP_GUM_SPHERE;
      }

      const _gumNudgeLocal = new CANNON.Vec3();
      const _gumNudgeDir = new CANNON.Vec3();
      const _gumNudgeInvQ = new CANNON.Quaternion();
      /** Keep every gum still in the tank moving toward the bottom hole (tank frame, so it works when tipped). */
      function nudgeGumsTowardExit(dt) {
        const data = ensureGumTankWallData();
        if (!data || !gumsTankPhysBody) return;
        const tp = gumsTankPhysBody.position;
        const tq = gumsTankPhysBody.quaternion;
        const tv = gumsTankPhysBody.velocity;
        tq.conjugate(_gumNudgeInvQ);
        const { exit, neck } = data;
        const r = gumRadiusGlobal;
        _gumNudgeDir.set(0, -1, 0);
        _gumNudgeInvQ.vmult(_gumNudgeDir, _gumNudgeDir);
        const tip = 1 - Math.max(0, -_gumNudgeDir.y); // gravity's share across the tank axis
        const sinkY = data.floorTop != null ? data.floorTop : neck.y; // aim down the chute, not at its top
        for (let i = 0; i < gumsAddedCount; i++) {
          const b = gumBodies[i];
          if (b._exitedGumTank || b.type !== CANNON.Body.DYNAMIC) continue;
          b.position.vsub(tp, _gumNudgeLocal);
          _gumNudgeInvQ.vmult(_gumNudgeLocal, _gumNudgeLocal);
          let accel = 0;
          if (b._inGumChute) {
            if (exit && _gumNudgeLocal.y <= exit.yMax + r) {
              _gumNudgeDir.set(exit.dirX, 0, exit.dirZ);
              accel = GUM_EXIT_NUDGE_ACCEL;
            } else {
              if (tip < 0.05) continue; // upright: gravity already carries it down the chute
              _gumNudgeDir.set(0, -1, 0);
              accel = GUM_TIPPED_NUDGE_ACCEL * tip;
            }
          } else {
            const rvx = b.velocity.x - tv.x, rvy = b.velocity.y - tv.y, rvz = b.velocity.z - tv.z;
            if (rvx * rvx + rvy * rvy + rvz * rvz > GUM_FUNNEL_NUDGE_SPEED * GUM_FUNNEL_NUDGE_SPEED) continue;
            _gumNudgeDir.set(neck.x - _gumNudgeLocal.x, sinkY - _gumNudgeLocal.y, neck.z - _gumNudgeLocal.z);
            const len = _gumNudgeDir.length();
            if (len < 1e-6) continue;
            _gumNudgeDir.scale(1 / len, _gumNudgeDir);
            accel = GUM_FUNNEL_NUDGE_ACCEL + GUM_TIPPED_NUDGE_ACCEL * tip;
          }
          tq.vmult(_gumNudgeDir, _gumNudgeDir);
          b.velocity.addScaledVector(accel * dt, _gumNudgeDir, b.velocity);
          if (b.sleepState !== 0) b.wakeUp();
        }
      }

      const _gumChuteInvQ = new CANNON.Quaternion();
      const _gumChuteLocal = new CANNON.Vec3();
      const _gumChuteWorld = new CANNON.Vec3();
      /**
       * Safety net for a gum below the globe (in the chute): keep it inside the walls; it may only leave
       * through an opening (the bottom hole). Returns true once it is fully outside through that hole.
       */
      function clampGumInsideTankChute(body) {
        const data = ensureGumTankWallData();
        if (!data || !gumsTankPhysBody) return false;
        const r = gumRadiusGlobal;
        const tp = gumsTankPhysBody.position;
        const tq = gumsTankPhysBody.quaternion;
        tq.conjugate(_gumChuteInvQ);
        body.position.vsub(tp, _gumChuteWorld);
        _gumChuteInvQ.vmult(_gumChuteWorld, _gumChuteLocal);
        const L = _gumChuteLocal;
        const { bands, M } = data;
        const k = Math.round((L.y - data.y0) / data.step);
        if (k < 0 && data.floorTop == null) return false;
        const band = bands[Math.min(bands.length - 1, Math.max(0, k))];
        const dx = L.x - band.cx;
        const dz = L.z - band.cz;
        const horiz = Math.hypot(dx, dz);
        const ang = (Math.atan2(dz, dx) + Math.PI * 2) % (Math.PI * 2);
        const j = Math.round((ang / (Math.PI * 2)) * M) % M;
        const dWall = band.d[j];
        const inOpening = Number.isNaN(dWall);
        let outer = 0;
        let inner = Infinity;
        for (let jj = 0; jj < M; jj++) {
          if (Number.isNaN(band.d[jj])) continue;
          outer = Math.max(outer, band.d[jj]);
          inner = Math.min(inner, band.d[jj]);
        }
        // The ramp's long triangles cut inside the round chute (to r ≈ 0.52); the real ramp starts outside the hole.
        if (horiz < inner) body.collisionFilterMask &= ~PHYS_GROUP_GUMS_RAMP;
        else body.collisionFilterMask |= PHYS_GROUP_GUMS_RAMP;
        if (inOpening && horiz > outer + GUM_TANK_WALL_THICKNESS + r) {
          body.collisionFilterMask |= PHYS_GROUP_GUMS_RAMP;
          return true;
        }
        let moved = false;
        _gumVelLocal.set(body.velocity.x, body.velocity.y, body.velocity.z);
        _gumTankQuat.set(tq.x, tq.y, tq.z, tq.w);
        _gumTankInvQuat.copy(_gumTankQuat).invert();
        _gumVelLocal.applyQuaternion(_gumTankInvQuat);
        const maxH = dWall - r;
        if (!inOpening && horiz > maxH && horiz > 1e-8) {
          const s = maxH / horiz;
          const hl = horiz;
          L.x = band.cx + dx * s;
          L.z = band.cz + dz * s;
          const radialVel = (_gumVelLocal.x * dx + _gumVelLocal.z * dz) / hl;
          if (radialVel > 0) {
            _gumVelLocal.x -= (dx / hl) * radialVel;
            _gumVelLocal.z -= (dz / hl) * radialVel;
          }
          moved = true;
        }
        if (data.floorTop != null && L.y < data.floorTop + r && horiz <= outer) {
          L.y = data.floorTop + r;
          if (_gumVelLocal.y < 0) _gumVelLocal.y = 0;
          moved = true;
        }
        if (!moved) return false;
        _gumVelLocal.applyQuaternion(_gumTankQuat);
        body.velocity.set(_gumVelLocal.x, _gumVelLocal.y, _gumVelLocal.z);
        tq.vmult(L, _gumChuteWorld);
        _gumChuteWorld.vadd(tp, body.position);
        body.aabbNeedsUpdate = true;
        if (body.sleepState === 2) body.wakeUp();
        return false;
      }

      function finalizeGumDispenserOnTable() {
        if (!gumDispenserPhysBody) return;
        placeGumDispenserOnTable();
        syncGumDispenserFromPhysics();
        rebuildGumsTankPhysicsFromMesh();
        gumDispenserPhysBody.velocity.set(0, 0, 0);
        gumDispenserPhysBody.angularVelocity.set(0, 0, 0);
        _gumDispenserInitPos = new CANNON.Vec3(
          gumDispenserPhysBody.position.x,
          gumDispenserPhysBody.position.y,
          gumDispenserPhysBody.position.z,
        );
        _gumDispenserInitQuat = new CANNON.Quaternion(
          gumDispenserPhysBody.quaternion.x,
          gumDispenserPhysBody.quaternion.y,
          gumDispenserPhysBody.quaternion.z,
          gumDispenserPhysBody.quaternion.w,
        );
        refreshGumDispenserInternalAnchors();
        syncGumDispenserFromPhysics();
        if (gumsTankPhysicObject) {
          gumsTankPhysicObject.updateMatrixWorld(true);
          _gumTankMwCached.copy(gumsTankPhysicObject.matrixWorld);
          _invTankMwGumClamp.copy(_gumTankMwCached).invert();
          snapshotGumTankPrevTransform();
        }
      }

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
          mass: 1500.0,
          type: CANNON.Body.DYNAMIC,
          material: gumDispenserMaterial,
          linearDamping: 0.3,
          angularDamping: 0.55,
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
        gumDispenserPhysBody._noClimb = true;
        physicsWorld.addBody(gumDispenserPhysBody);

        gumDispenserPhysBody.addEventListener("collide", (e) => {
          if (!gumDispenserPhysBody._frozen) return;
          if (e.body.material === carMaterial) {
            unfreezeKnockableBody(gumDispenserPhysBody);
          }
        });

        _gumDispenserInitPos = new CANNON.Vec3(phCenter.x, phCenter.y, phCenter.z);
        _gumDispenserInitQuat = new CANNON.Quaternion(phQuat.x, phQuat.y, phQuat.z, phQuat.w);
        refreshGumDispenserInternalAnchors();
        applyKnockableGroupShadow(gumDispenserGroup);
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
          hideGumTankPhysicCupForHit();
          // Kinematic + velocity: the solver moves the walls each substep instead of teleporting them through gums.
          if (gumsTankPhysBody) gumsTankPhysBody.type = CANNON.Body.KINEMATIC;
          enableGumTankThickWalls();
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

        if (_gumDispenserInternalBodies.length && !gumDispenserPhysBody._frozen) {
          _gumDispenserInitQuat.conjugate(_gdInvInitQuat);
          _gdRelQuat.copy(_gdInvInitQuat);
          q.mult(_gdRelQuat, _gdRelQuat);

          const dv = gumDispenserPhysBody.velocity;
          const dw = gumDispenserPhysBody.angularVelocity;
          for (const b of _gumDispenserInternalBodies) {
            if ((_cupSlideActive || _gumHitCupHidden) && b === gumsTankCupBody)
              continue;
            b._gdOrigPos.vsub(_gumDispenserInitPos, _gdDelta);
            _gdRelQuat.vmult(_gdDelta, _gdRotatedOffset);
            b.position.copy(p);
            b.position.vadd(_gdRotatedOffset, b.position);
            _gdRelQuat.mult(b._gdOrigQuat, b.quaternion);
            const rx = b.position.x - p.x;
            const ry = b.position.y - p.y;
            const rz = b.position.z - p.z;
            b.velocity.set(
              dv.x + dw.y * rz - dw.z * ry,
              dv.y + dw.z * rx - dw.x * rz,
              dv.z + dw.x * ry - dw.y * rx,
            );
            b.angularVelocity.copy(dw);
            b.aabbNeedsUpdate = true;
          }
          syncGumTankThickWalls();
        }

        refreshGumTankWorldMatrix();
        if (_gumDispenserBecameDynamic) {
          carryGumsWithTankMotion();
          clampGumsInsideTankLocalAabb(true);
        } else {
          snapshotGumTankPrevTransform();
        }
      }

      function refreshGumTankWorldMatrix() {
        if (!gumsTankPhysicObject) return;
        if (gumDispenserGroup) gumDispenserGroup.updateMatrixWorld(true);
        gumsTankPhysicObject.updateMatrixWorld(true);
        _gumTankMwCached.copy(gumsTankPhysicObject.matrixWorld);
        _invTankMwGumClamp.copy(_gumTankMwCached).invert();
      }

      function snapshotGumTankPrevTransform() {
        if (!gumsTankPhysicObject) return;
        _gumTankPrevMw.copy(_gumTankMwCached);
        _gumTankPrevMwValid = true;
        if (gumDispenserPhysBody) {
          const v = gumDispenserPhysBody.velocity;
          const w = gumDispenserPhysBody.angularVelocity;
          const c = gumDispenserPhysBody.position;
          _gdCarryPrevLin.set(v.x, v.y, v.z);
          _gdCarryPrevAng.set(w.x, w.y, w.z);
          _gdCarryPrevCenter.set(c.x, c.y, c.z);
          _gdCarryPrevMotionValid = !gumDispenserPhysBody._frozen;
        } else {
          _gdCarryPrevMotionValid = false;
        }
      }

      function _gumRigidPointVelocity(lin, ang, cx, cy, cz, px, py, pz, out) {
        const rx = px - cx;
        const ry = py - cy;
        const rz = pz - cz;
        out.set(
          lin.x + ang.y * rz - ang.z * ry,
          lin.y + ang.z * rx - ang.x * rz,
          lin.z + ang.x * ry - ang.y * rx,
        );
      }

      /** Keep gums in the same local pose relative to gumsTankPhysic as the tank moves. */
      function carryGumsWithTankMotion() {
        if (!gumsTankPhysicObject || gumsAddedCount < 1) {
          snapshotGumTankPrevTransform();
          return;
        }
        if (!_gumTankPrevMwValid) {
          snapshotGumTankPrevTransform();
          return;
        }
        const e = _gumTankMwCached.elements;
        const pe = _gumTankPrevMw.elements;
        const dpx = e[12] - pe[12];
        const dpy = e[13] - pe[13];
        const dpz = e[14] - pe[14];
        _gumTankPrevQuat.setFromRotationMatrix(_gumTankPrevMw);
        _gumTankQuat.setFromRotationMatrix(_gumTankMwCached);
        _gumTankDeltaQuat.copy(_gumTankPrevQuat).invert().premultiply(_gumTankQuat);
        const moved = dpx * dpx + dpy * dpy + dpz * dpz > 1e-14;
        const rotated = Math.abs(_gumTankDeltaQuat.w) < 0.9999995;
        if (!moved && !rotated) {
          snapshotGumTankPrevTransform();
          return;
        }
        _gumTankPrevInvMw.copy(_gumTankPrevMw).invert();
        const c = _gumTankClampLocal;
        const gumR = gumRadiusGlobal;
        const pad = gumR * 2.5;
        const axisX = c
          ? c.axisX != null
            ? c.axisX
            : (c.minX + c.maxX) * 0.5
          : 0;
        const axisZ = c
          ? c.axisZ != null
            ? c.axisZ
            : (c.minZ + c.maxZ) * 0.5
          : 0;
        const dv = gumDispenserPhysBody ? gumDispenserPhysBody.velocity : null;
        const dw = gumDispenserPhysBody
          ? gumDispenserPhysBody.angularVelocity
          : null;
        const dc = gumDispenserPhysBody ? gumDispenserPhysBody.position : null;
        for (let i = 0; i < gumsAddedCount; i++) {
          const body = gumBodies[i];
          if (body._exitedGumTank) continue;
          if (!body) continue;
          const oldx = body.position.x;
          const oldy = body.position.y;
          const oldz = body.position.z;
          _gumCarryPos.set(oldx, oldy, oldz).applyMatrix4(_gumTankPrevInvMw);
          if (c && !body._inGumChute) {
            const lx = _gumCarryPos.x;
            const ly = _gumCarryPos.y;
            const lz = _gumCarryPos.z;
            const horiz = Math.hypot(lx - axisX, lz - axisZ);
            const maxH = gumTankMaxHorizAtLocalY(c, ly, gumR) + pad;
            if (horiz > maxH) continue;
            if (ly < c.minY - pad || ly > c.maxY + pad * 2) continue;
          }
          _gumCarryPos.applyMatrix4(_gumTankMwCached);
          const nx = _gumCarryPos.x;
          const ny = _gumCarryPos.y;
          const nz = _gumCarryPos.z;
          _gumCarryVel.set(body.velocity.x, body.velocity.y, body.velocity.z);
          _gumCarryAngVel.set(
            body.angularVelocity.x,
            body.angularVelocity.y,
            body.angularVelocity.z,
          );
          if (_gdCarryPrevMotionValid) {
            _gumRigidPointVelocity(
              _gdCarryPrevLin,
              _gdCarryPrevAng,
              _gdCarryPrevCenter.x,
              _gdCarryPrevCenter.y,
              _gdCarryPrevCenter.z,
              oldx,
              oldy,
              oldz,
              _gumCarryPointVelOld,
            );
            _gumCarryVel.sub(_gumCarryPointVelOld);
            _gumCarryAngVel.sub(_gdCarryPrevAng);
          }
          _gumCarryVel.applyQuaternion(_gumTankDeltaQuat);
          _gumCarryAngVel.applyQuaternion(_gumTankDeltaQuat);
          if (dv && dw && dc) {
            _gumRigidPointVelocity(
              dv,
              dw,
              dc.x,
              dc.y,
              dc.z,
              nx,
              ny,
              nz,
              _gumCarryPointVelNew,
            );
            _gumCarryVel.add(_gumCarryPointVelNew);
            _gumCarryAngVel.x += dw.x;
            _gumCarryAngVel.y += dw.y;
            _gumCarryAngVel.z += dw.z;
          }
          body.position.x = nx;
          body.position.y = ny;
          body.position.z = nz;
          body.velocity.x = _gumCarryVel.x;
          body.velocity.y = _gumCarryVel.y;
          body.velocity.z = _gumCarryVel.z;
          body.angularVelocity.x = _gumCarryAngVel.x;
          body.angularVelocity.y = _gumCarryAngVel.y;
          body.angularVelocity.z = _gumCarryAngVel.z;
          body.aabbNeedsUpdate = true;
          if (body.sleepState === 2) body.wakeUp();
        }
        snapshotGumTankPrevTransform();
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
      /**
       * Depth bias for the certified card's text and logo: wixLogo and
       * certifiedDesignText sit exactly on the glass body's front face
       * (certifiedTitle is 1 mm in front), so the 50% white glass, drawn after
       * them, painted over them where it was level with them.
       */
      const CERTIFIED_TEXT_DEPTH_BIAS = { factor: -2, units: -4 };
      const certifiedTextMaterial = new THREE.MeshStandardMaterial({
        color: 0xf8f8f8,
        roughness: 0.9,
        metalness: 0,
        emissive: 0xe8e8e8,
        emissiveIntensity: 0.45,
        polygonOffset: true,
        polygonOffsetFactor: CERTIFIED_TEXT_DEPTH_BIAS.factor,
        polygonOffsetUnits: CERTIFIED_TEXT_DEPTH_BIAS.units,
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

      function applyHeadphonesMaterials(model) {
        model.traverse((node) => {
          if (!node.isMesh) return;
          const name = node.name || "";
          const parentName = node.parent ? node.parent.name || "" : "";
          let mat = null;
          if (
            name === "headphonesBase" ||
            parentName === "headphonesBase" ||
            name === "headphonesButtons" ||
            parentName === "headphonesButtons"
          ) {
            mat = headphonesPlasticMaterial;
          } else if (
            name === "headphonesEars" ||
            parentName === "headphonesEars"
          ) {
            mat = headphonesEarsMaterial;
          } else if (
            name === "headphonesLight" ||
            parentName === "headphonesLight"
          ) {
            mat = headphonesLightMaterial;
          }
          if (mat) {
            if (Array.isArray(node.material)) {
              for (let i = 0; i < node.material.length; i++)
                node.material[i] = mat;
            } else node.material = mat;
            if (perfSettings.shadows) {
              enableMeshCastShadow(node, "wall");
            }
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
        patchPhoneChargerLightGlow(phoneChargerLightMaterial);
        patchPhoneChargerCupGlow(phoneChargerCupMaterial);
      }

      /**
       * The charger's light hints "drive onto me": a slow breathing pulse, a little
       * bloom, and soft edges (its glow fades toward the disc's rim instead of
       * stopping at a hard edge). While the car is on the cup (the cue), the pulse
       * holds at full.
       * The light sits inside the charger, under the frosted cup (88% opaque), so
       * on its own it barely shows: the cup above it glows too, like a diffuser,
       * in the light's own colour (blue with the cue), round its centre and
       * fading out softly, with the same pulse and its own bloom.
       */
      const PHONE_CHARGER_GLOW = {
        periodSec: 2.6, // one slow breath
        low: 0.2, // the glow at the pulse's low (× full)
        bloomWeight: 0.9, // bloom at full glow (0..1, thresholdBloom.js weight)
        edgeInner: 0.35, // the glow is full inside this share of the disc's radius…
        edgeOuter: 1.0, // …and fades out to here (the rim)
        edgeFloor: 0.15, // what's left of the glow at the rim
        cup: {
          strength: 2.6, // the cup's glow at its centre (emissive, × the light's colour)
          innerShare: 0.2, // full inside this × the light's radius…
          outerShare: 2.5, // …fading out to zero here (soft, past the light's own rim)
          bloomWeight: 1.0, // bloom of the cup's glow at full (× the glow's falloff)
        },
      };
      const _phoneChargerGlowUniform = { value: 1 };
      function patchPhoneChargerLightGlow(mat) {
        if (mat.userData.chargerGlow) return;
        mat.userData.chargerGlow = _phoneChargerGlowUniform;
        const G = PHONE_CHARGER_GLOW;
        const prev = mat.onBeforeCompile;
        const prevKey = mat.customProgramCacheKey;
        mat.onBeforeCompile = function (shader, r) {
          if (prev) prev.call(this, shader, r);
          shader.uniforms.uChargerGlow = _phoneChargerGlowUniform;
          shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nvarying float vChargerR;")
            .replace("#include <begin_vertex>", "#include <begin_vertex>\nvChargerR = length(position.xz); // 0 centre .. 1 rim (the disc's local units)");
          shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", "#include <common>\nvarying float vChargerR;\nuniform float uChargerGlow;")
            .replace(
              "#include <emissivemap_fragment>",
              `#include <emissivemap_fragment>
              float chargerEdge = mix(1.0, ${G.edgeFloor.toFixed(3)}, smoothstep(${G.edgeInner.toFixed(3)}, ${G.edgeOuter.toFixed(3)}, vChargerR));
              totalEmissiveRadiance *= uChargerGlow * chargerEdge;`,
            );
        };
        mat.customProgramCacheKey = function () {
          return (prevKey ? prevKey.call(this) : "") + "|chargerGlow";
        };
        setBloomWeight(mat, G.bloomWeight);
        mat.needsUpdate = true;
      }
      /** The cup's glow: the light's centre and radius (world), its colour, and the patch. */
      const _cupGlowUniforms = {
        uCupGlowCenter: { value: new THREE.Vector3() },
        uCupGlowRadius: { value: 1 },
        uCupGlowColor: { value: phoneChargerLightMaterial.emissive }, // the light's own (lerped to blue with the cue)
        uCupGlow: _phoneChargerGlowUniform,
      };
      let _cupGlowPlaced = false;
      function patchPhoneChargerCupGlow(mat) {
        if (mat.userData.cupGlow) return;
        mat.userData.cupGlow = true;
        const C = PHONE_CHARGER_GLOW.cup;
        const prev = mat.onBeforeCompile;
        const prevKey = mat.customProgramCacheKey;
        mat.onBeforeCompile = function (shader, r) {
          if (prev) prev.call(this, shader, r);
          Object.assign(shader.uniforms, _cupGlowUniforms);
          shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vCupGlowWorld;")
            .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCupGlowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
          shader.fragmentShader = shader.fragmentShader
            .replace(
              "#include <common>",
              "#include <common>\nvarying vec3 vCupGlowWorld;\nuniform vec3 uCupGlowCenter, uCupGlowColor;\nuniform float uCupGlowRadius, uCupGlow;\nfloat cupGlowFall = 0.0;",
            )
            .replace(
              "#include <emissivemap_fragment>",
              `#include <emissivemap_fragment>
              float cupGlowD = length(vCupGlowWorld.xz - uCupGlowCenter.xz) / uCupGlowRadius;
              cupGlowFall = 1.0 - smoothstep(${C.innerShare.toFixed(3)}, ${C.outerShare.toFixed(3)}, cupGlowD);
              cupGlowFall *= cupGlowFall; // softer toward the edge
              totalEmissiveRadiance += uCupGlowColor * (${C.strength.toFixed(3)} * uCupGlow * cupGlowFall);`,
            )
            // Bloom marker (thresholdBloom.js): BASE + weight in alpha, the glow's share only.
            .replace(/}\s*$/, `gl_FragColor.a = ${BLOOM_WEIGHT_ALPHA_BASE.toFixed(1)} + clamp(${C.bloomWeight.toFixed(3)} * uCupGlow * cupGlowFall, 0.0, 1.0);\n}`);
        };
        mat.customProgramCacheKey = function () {
          return (prevKey ? prevKey.call(this) : "") + "|cupGlow";
        };
        // The alpha now carries the bloom marker, so the cup's see-through blend uses
        // its opacity as a constant instead (the same colour as before: 0.88 cup + 0.12 behind).
        mat.blending = THREE.CustomBlending;
        mat.blendEquation = THREE.AddEquation;
        mat.blendSrc = THREE.ConstantAlphaFactor;
        mat.blendDst = THREE.OneMinusConstantAlphaFactor;
        mat.blendAlpha = mat.opacity;
        mat.blendSrcAlpha = THREE.OneFactor;
        mat.blendDstAlpha = THREE.ZeroFactor;
        mat.needsUpdate = true;
      }
      /** Per frame: the pulse (held full while the cue is on). */
      function updatePhoneChargerGlow(cue) {
        const G = PHONE_CHARGER_GLOW;
        const wave = 0.5 - 0.5 * Math.cos((performance.now() / 1000) * ((2 * Math.PI) / G.periodSec)); // 0..1
        const pulse = G.low + (1 - G.low) * wave;
        const k = pulse + (1 - pulse) * cue;
        _phoneChargerGlowUniform.value = k;
        setBloomWeight(phoneChargerLightMaterial, G.bloomWeight * k);
        if (!_cupGlowPlaced && phoneChargerLightMesh) {
          const b = new THREE.Box3().setFromObject(phoneChargerLightMesh);
          b.getCenter(_cupGlowUniforms.uCupGlowCenter.value);
          _cupGlowUniforms.uCupGlowRadius.value = Math.max(1e-4, (b.max.x - b.min.x + b.max.z - b.min.z) / 4);
          _cupGlowPlaced = true;
        }
      }

      const screenLightMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 3,
        roughness: 0.1,
        metalness: 0,
      });

      /**
       * The monitors' power LEDs (leftScreenLight / rightScreenLight): clean,
       * slightly cool white, the same in bright and dark mode, bright enough to
       * glow (bloom) above the bloom threshold. (They were missing from the
       * model; the shared material below they used before is white @ 3.)
       */
      const SCREEN_LED = {
        color: 0xf2f6ff,
        emissiveIntensity: 14, // at the centre (was 15 everywhere)
        /**
         * Feathered glow: the brightness falls off from the centre toward the
         * edges (an oval over the LED's two long sides), so only a soft core is
         * above the bloom threshold and the bloom is round and smooth (the
         * uniformly bright box bloomed as a hard, blocky rectangle).
         */
        featherFrom: 0.25, // full brightness inside this share of the half-size
        featherTo: 1.0, // …fading to `edgeLevel` at the edge
        edgeLevel: 0.12, // share of the brightness left at the edges (below the threshold)
      };
      const screenLedMaterial = new THREE.MeshStandardMaterial({
        color: SCREEN_LED.color,
        emissive: SCREEN_LED.color,
        emissiveIntensity: SCREEN_LED.emissiveIntensity,
        roughness: 0.2,
        metalness: 0,
      });
      /** One copy per LED (its own box: local centre, half-size, the two long axes) with the feathered glow. */
      function makeScreenLedMaterial(mesh) {
        const m = screenLedMaterial.clone();
        const g = mesh.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        const b = g.boundingBox;
        const center = b.getCenter(new THREE.Vector3());
        const half = new THREE.Vector3().subVectors(b.max, b.min).multiplyScalar(0.5);
        // The thinnest axis is the LED's depth: left out of the oval. Judged by the
        // real (scaled) size: the LEDs are unit cubes shaped by their node's scale.
        const ws = mesh.getWorldScale(new THREE.Vector3());
        const sx = Math.abs(half.x * ws.x);
        const sy = Math.abs(half.y * ws.y);
        const sz = Math.abs(half.z * ws.z);
        const thin = sx <= sy && sx <= sz ? 0 : sy <= sz ? 1 : 2;
        const axes = new THREE.Vector3(thin === 0 ? 0 : 1, thin === 1 ? 0 : 1, thin === 2 ? 0 : 1);
        m.onBeforeCompile = (shader) => {
          shader.uniforms.uLedCenter = { value: center };
          shader.uniforms.uLedHalf = { value: half };
          shader.uniforms.uLedAxes = { value: axes };
          shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vLedLocal;")
            .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLedLocal = position;");
          shader.fragmentShader = shader.fragmentShader
            .replace(
              "#include <common>",
              "#include <common>\nvarying vec3 vLedLocal;\nuniform vec3 uLedCenter;\nuniform vec3 uLedHalf;\nuniform vec3 uLedAxes;",
            )
            .replace(
              "#include <emissivemap_fragment>",
              `#include <emissivemap_fragment>
              {
                vec3 q = (vLedLocal - uLedCenter) / max(uLedHalf, vec3(1e-5)) * uLedAxes;
                float core = 1.0 - smoothstep(${SCREEN_LED.featherFrom.toFixed(3)}, ${SCREEN_LED.featherTo.toFixed(3)}, length(q));
                totalEmissiveRadiance *= mix(${SCREEN_LED.edgeLevel.toFixed(3)}, 1.0, core);
              }`,
            );
        };
        // Own program per LED: its own uniforms (a shared program would reuse the first one's).
        const key = "screenLedFeather" + m.id;
        m.customProgramCacheKey = () => key;
        return m;
      }
      /**
       * The desk's control panel: the button strip (tableControlButtonLights)
       * glows white, and its screen (tableControlScreen, in the strip's centre)
       * shows "065" as a blue seven-segment LED display (DSEG7, OFL; a drawn
       * seven-segment fallback until / unless the font loads).
       */
      const TABLE_CONTROL = {
        buttonLights: { color: 0xffffff, emissiveIntensity: 12.6 }, // just over the bloom threshold (12): a subtle glow
        display: {
          text: "065",
          unlit: "888", // the unlit segments behind, faintly
          fontFamily: "DSEG7ClassicBold",
          fontUrl: "https://cdn.jsdelivr.net/npm/dseg@0.46.0/fonts/DSEG7-Classic/DSEG7Classic-Bold.woff2",
          canvas: { w: 512, h: 192 },
          background: "#03060c",
          lit: "#3d9bff", // LED blue
          glow: "rgba(40, 140, 255, 0.85)",
          glowBlur: 18, // canvas px
          unlitAlpha: 0.08,
          textHeight: 0.6, // share of the canvas height
          gain: 1.6, // brightness of the plane (unlit, tone mapping off)
          bloomWeight: 0.7, // soft bloom from its own colours
          size: { w: 0.78, h: 0.62 }, // share of the screen face
          offset: 0.003, // in front of the face (no z-fighting)
        },
      };

      /** Seven-segment fallback: segments a–g per digit, drawn with rounded bars. */
      const SEVEN_SEG = { 0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc", 8: "abcdefg", 9: "abcdfg" };
      function drawSevenSegText(c, text, x0, y0, digitW, digitH, gap) {
        const t = digitW * 0.16;
        const seg = {
          a: [t * 0.6, 0, digitW - t * 1.2, t],
          d: [t * 0.6, digitH - t, digitW - t * 1.2, t],
          g: [t * 0.6, digitH / 2 - t / 2, digitW - t * 1.2, t],
          f: [0, t * 0.6, t, digitH / 2 - t * 0.9],
          b: [digitW - t, t * 0.6, t, digitH / 2 - t * 0.9],
          e: [0, digitH / 2 + t * 0.3, t, digitH / 2 - t * 0.9],
          c: [digitW - t, digitH / 2 + t * 0.3, t, digitH / 2 - t * 0.9],
        };
        [...text].forEach((ch, i) => {
          const on = SEVEN_SEG[ch] || "";
          const ox = x0 + i * (digitW + gap);
          for (const k of on) {
            const [sx, sy, sw, sh] = seg[k];
            c.beginPath();
            c.roundRect ? c.roundRect(ox + sx, y0 + sy, sw, sh, t / 2) : c.rect(ox + sx, y0 + sy, sw, sh);
            c.fill();
          }
        });
      }

      function drawTableControlDisplay(c, fontReady) {
        const D = TABLE_CONTROL.display;
        const { w, h } = D.canvas;
        c.clearRect(0, 0, w, h);
        c.fillStyle = D.background;
        c.fillRect(0, 0, w, h);
        const th = h * D.textHeight;
        if (fontReady) {
          c.font = `${th}px "${D.fontFamily}"`;
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.fillStyle = D.lit;
          c.globalAlpha = D.unlitAlpha;
          c.fillText(D.unlit, w / 2, h / 2);
          c.globalAlpha = 1;
          c.shadowColor = D.glow;
          c.shadowBlur = D.glowBlur;
          c.fillText(D.text, w / 2, h / 2);
          c.shadowBlur = 0;
          c.fillText(D.text, w / 2, h / 2);
        } else {
          const digitH = th;
          const digitW = digitH * 0.52;
          const gap = digitW * 0.35;
          const total = D.text.length * digitW + (D.text.length - 1) * gap;
          const x0 = (w - total) / 2;
          const y0 = (h - digitH) / 2;
          c.fillStyle = D.lit;
          c.globalAlpha = D.unlitAlpha;
          drawSevenSegText(c, D.unlit, x0, y0, digitW, digitH, gap);
          c.globalAlpha = 1;
          c.shadowColor = D.glow;
          c.shadowBlur = D.glowBlur;
          drawSevenSegText(c, D.text, x0, y0, digitW, digitH, gap);
          c.shadowBlur = 0;
          drawSevenSegText(c, D.text, x0, y0, digitW, digitH, gap);
        }
      }

      let _tableControlDisplayFontLoad = null;
      function loadTableControlDisplayFont() {
        const D = TABLE_CONTROL.display;
        if (_tableControlDisplayFontLoad) return _tableControlDisplayFontLoad;
        _tableControlDisplayFontLoad =
          typeof FontFace === "undefined"
            ? Promise.reject(new Error("no FontFace"))
            : new FontFace(D.fontFamily, `url(${D.fontUrl})`).load().then((f) => {
                document.fonts.add(f);
                return f;
              });
        return _tableControlDisplayFontLoad;
      }

      /** The white button strip and the "065" display on the control panel's screen. */
      function applyTableControlParts(model) {
        const lights = model.getObjectByName("tableControlButtonLights");
        if (lights && lights.isMesh) {
          const B = TABLE_CONTROL.buttonLights;
          lights.material = new THREE.MeshStandardMaterial({
            color: B.color,
            emissive: B.color,
            emissiveIntensity: B.emissiveIntensity,
            roughness: 0.3,
            metalness: 0,
          });
        }
        const screen = model.getObjectByName("tableControlScreen");
        if (!screen || !screen.isMesh) return;
        const D = TABLE_CONTROL.display;
        // The screen's front face: the biggest face direction toward the front (+z), and its plane.
        model.updateMatrixWorld(true);
        const g = screen.geometry;
        const pos = g.getAttribute("position");
        const index = g.index;
        const A = new THREE.Vector3();
        const Bv = new THREE.Vector3();
        const C = new THREE.Vector3();
        const e1 = new THREE.Vector3();
        const e2 = new THREE.Vector3();
        const nrm = new THREE.Vector3();
        const best = new THREE.Vector3();
        const sums = new Map();
        const tris = index ? index.count / 3 : pos.count / 3;
        for (let t = 0; t < tris; t++) {
          const ia = index ? index.getX(t * 3) : t * 3;
          const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
          const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
          A.fromBufferAttribute(pos, ia).applyMatrix4(screen.matrixWorld);
          Bv.fromBufferAttribute(pos, ib).applyMatrix4(screen.matrixWorld);
          C.fromBufferAttribute(pos, ic).applyMatrix4(screen.matrixWorld);
          nrm.crossVectors(e1.subVectors(Bv, A), e2.subVectors(C, A));
          const area = nrm.length() / 2;
          if (area <= 0) continue;
          nrm.normalize();
          if (nrm.z <= 0) continue;
          const key = `${nrm.x.toFixed(1)},${nrm.y.toFixed(1)},${nrm.z.toFixed(1)}`;
          const e = sums.get(key) || { area: 0, n: new THREE.Vector3() };
          e.area += area;
          e.n.addScaledVector(nrm, area);
          sums.set(key, e);
        }
        let bestArea = 0;
        for (const e of sums.values()) {
          if (e.area > bestArea) {
            bestArea = e.area;
            best.copy(e.n).normalize();
          }
        }
        if (bestArea <= 0) return;
        // Face plane: the furthest vertices along the normal; face size from the box across it.
        let front = -Infinity;
        const box = new THREE.Box3();
        for (let i = 0; i < pos.count; i++) {
          A.fromBufferAttribute(pos, i).applyMatrix4(screen.matrixWorld);
          front = Math.max(front, A.dot(best));
          box.expandByPoint(A);
        }
        const center = box.getCenter(new THREE.Vector3());
        center.addScaledVector(best, front - center.dot(best) + D.offset);
        const right = new THREE.Vector3(1, 0, 0);
        const up = new THREE.Vector3().crossVectors(best, right).normalize();
        right.crossVectors(up, best).normalize();
        const faceW = box.max.x - box.min.x;
        const faceH = bestArea / Math.max(1e-4, faceW);
        const planeW = faceW * D.size.w;
        const planeH = Math.min(faceH * D.size.h, planeW * (D.canvas.h / D.canvas.w));
        const canvas = document.createElement("canvas");
        canvas.width = D.canvas.w;
        canvas.height = D.canvas.h;
        const ctx = canvas.getContext("2d");
        drawTableControlDisplay(ctx, false);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
        mat.color.setScalar(D.gain);
        setBloomWeight(mat, D.bloomWeight);
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), mat);
        plane.name = "tableControlDisplay";
        plane.position.copy(center);
        plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, best));
        plane.castShadow = false;
        plane.receiveShadow = false;
        scene.add(plane);
        // Follows the screen if its part of the model moves (world placement kept).
        if (screen.parent && screen.parent !== scene) screen.parent.attach(plane);
        loadTableControlDisplayFont()
          .then(() => {
            drawTableControlDisplay(ctx, true);
            tex.needsUpdate = true;
          })
          .catch(() => {
            /* the drawn seven-segment fallback stays */
          });
      }

      function applyScreenLightsMaterial(model) {
        model.traverse((node) => {
          if (!node.isMesh) return;
          if (
            node.name === "leftScreenLight" ||
            (node.parent && node.parent.name === "leftScreenLight") ||
            node.name === "rightScreenLight" ||
            (node.parent && node.parent.name === "rightScreenLight")
          ) {
            const ledMat = makeScreenLedMaterial(node);
            if (Array.isArray(node.material)) {
              for (let i = 0; i < node.material.length; i++) node.material[i] = ledMat;
            } else {
              node.material = ledMat;
            }
            node.frustumCulled = false;
            return;
          }
          if (
            node.name === "tableButtonsLight" ||
            (node.parent && node.parent.name === "tableButtonsLight")
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

      const tableControlScreenMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x010203,
        metalness: 0.35,
        roughness: 0.06,
        clearcoat: 1,
        clearcoatRoughness: 0.025,
        reflectivity: 0.9,
        envMapIntensity: 2.2,
        side: THREE.DoubleSide,
      });

      function applyTableControlScreenMaterial(model) {
        model.traverse((node) => {
          if (!node.isMesh) return;
          if (
            node.name !== "tableControllScreen" &&
            (!node.parent || node.parent.name !== "tableControllScreen")
          )
            return;
          if (Array.isArray(node.material)) {
            for (let i = 0; i < node.material.length; i++) {
              node.material[i] = tableControlScreenMaterial;
            }
          } else {
            node.material = tableControlScreenMaterial;
          }
          node.frustumCulled = false;
        });
      }

      let reflectionPlaneMesh = null;
      let tableReflector = null;
      /** The car's light bars (lightBar1 and its copies), found once the car is in the scene. */
      const _reflectionLightBars = [];
      const _hiddenForReflection = [];
      function _hideLightBarsForReflection() {
        if (!_reflectionLightBars.length && car) {
          car.traverse((n) => {
            if (n.isMesh && n.name === "lightBar1") _reflectionLightBars.push(n);
          });
        }
        _hiddenForReflection.length = 0;
        for (let i = 0; i < _reflectionLightBars.length; i++) {
          const m = _reflectionLightBars[i];
          if (!m.visible) continue;
          m.visible = false;
          _hiddenForReflection.push(m);
        }
        return _hiddenForReflection;
      }
      let reflectionPlaneWorldPosition = null;
      let reflectionPlaneSurfaceY = null;
      const _reflectionBox = new THREE.Box3();
      const _reflectionPos = new THREE.Vector3();
      const _reflectionQuat = new THREE.Quaternion();

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

      function getTablePlaySurfaceY() {
        if (tablePlateMesh) {
          tablePlateMesh.updateMatrixWorld(true);
          _reflectionBox.setFromObject(tablePlateMesh);
          if (!_reflectionBox.isEmpty()) return _reflectionBox.max.y;
        }
        return reflectionPlaneSurfaceY ?? tableSurfaceY;
      }

      function setupCarShadowPlane(fallbackSize, fallbackCenter, fallbackTopY) {
        if (!perfSettings.shadows) return;
        let planeW = fallbackSize.x;
        let planeD = fallbackSize.z;
        let centerX = fallbackCenter.x;
        let topY = fallbackTopY;
        let centerZ = fallbackCenter.z;
        if (tablePlateMesh) {
          tablePlateMesh.updateMatrixWorld(true);
          _reflectionBox.setFromObject(tablePlateMesh);
          if (!_reflectionBox.isEmpty()) {
            planeW = _reflectionBox.max.x - _reflectionBox.min.x;
            planeD = _reflectionBox.max.z - _reflectionBox.min.z;
            centerX = (_reflectionBox.min.x + _reflectionBox.max.x) * 0.5;
            topY = _reflectionBox.max.y;
            centerZ = (_reflectionBox.min.z + _reflectionBox.max.z) * 0.5;
          }
        }
        const shadowPlaneGeo = new THREE.PlaneGeometry(planeW, planeD);
        if (carShadowPlane) {
          carShadowPlane.geometry.dispose();
          carShadowPlane.geometry = shadowPlaneGeo;
        } else {
          carShadowPlane = new THREE.Mesh(
            shadowPlaneGeo,
            // No depth: it reaches past the desk's edge (planeMargin), invisible there, and would hide what's behind it
            // (the drawer's ring, cut along its edge, seen from above).
            new THREE.ShadowMaterial({ opacity: 0.45, depthWrite: false }),
          );
          carShadowPlane.name = "carShadowPlane";
          carShadowPlane.rotation.x = -Math.PI / 2;
          carShadowPlane.receiveShadow = true;
          carShadowPlane.renderOrder = 2;
          carShadowPlane.layers.set(TABLE_TOP_SHADOW_LAYER);
          scene.add(carShadowPlane);
        }
        const planeMargin = 1.12;
        carShadowPlane.scale.set(planeMargin, planeMargin, 1);
        carShadowPlane.position.set(centerX, topY + 0.05, centerZ);
      }

      function configureTableShadowCamera(extraHalf = 0) {
        if (!carShadowLight) return;
        const halfX = Number.isFinite(tablePlateHalfX)
          ? tablePlateHalfX * 1.15
          : 6;
        const halfZ = Number.isFinite(tablePlateHalfZ)
          ? tablePlateHalfZ * 1.15
          : 6;
        let half = Math.max(halfX, halfZ, 6) + extraHalf;
        if (car) {
          car.updateMatrixWorld(true);
          const carBox = new THREE.Box3().setFromObject(car);
          if (!carBox.isEmpty()) {
            const carSize = carBox.getSize(new THREE.Vector3());
            half = Math.max(half, Math.max(carSize.x, carSize.z) * 0.85 + 1.5);
          }
        }
        const cam = carShadowLight.shadow.camera;
        cam.left = -half;
        cam.right = half;
        cam.top = half;
        cam.bottom = -half;
        cam.near = 0.5;
        cam.far = 50;
        cam.updateProjectionMatrix();
      }

      function configureWallShadowCamera(wallNode) {
        if (!wallShadowLight || !wallNode) return;
        if (!computeTableSideWallShadowFrame(wallNode)) return;
        _wallShadowBasisX
          .crossVectors(_wallShadowBasisY, _wallShadowInward)
          .normalize();
        const size = _reflectionBox.getSize(new THREE.Vector3());
        const halfH = Math.max(size.y, 3) * 0.85;
        const planeW =
          Math.abs(size.x * _wallShadowBasisX.x) +
          Math.abs(size.z * _wallShadowBasisX.z);
        const halfW = Math.max(planeW, size.x, size.z, 3) * 0.85;
        const cam = wallShadowLight.shadow.camera;
        cam.left = -halfW;
        cam.right = halfW;
        cam.top = halfH;
        cam.bottom = -halfH;
        cam.near = 0.5;
        cam.far = 60;
        cam.updateProjectionMatrix();
      }

      function updateTableWallShadowLight() {
        if (!wallShadowLight || !perfSettings.shadows) return;
        if (_wallShadowLightReady) return;
        const model = _currentWorldModel;
        if (!model) return;
        const wallMesh = model.getObjectByName("tableSideWall");
        if (!wallMesh || !computeTableSideWallShadowFrame(wallMesh)) return;

        if (tableSideWallShadowMeshes.length === 0) {
          setupTableSideWallShadowReceivers(model);
          if (tableSideWallShadowMeshes.length === 0) return;
        }

        const wallCenter = _reflectionBox.getCenter(new THREE.Vector3());
        wallShadowLight.target.position.copy(wallCenter);
        wallShadowLight.position.set(
          wallCenter.x + 3,
          wallCenter.y + 20,
          wallCenter.z + 2,
        );
        wallShadowLight.target.updateMatrixWorld();
        wallShadowLight.updateMatrixWorld();
        configureWallShadowCamera(wallMesh);
        if (wallShadowLight.shadow?.updateMatrices) {
          wallShadowLight.shadow.updateMatrices(wallShadowLight);
        }
        _wallShadowLightReady = true;
        markShadowMapsDirty();
      }

      function updateTableShadowLight() {
        if (!carShadowLight || !perfSettings.shadows) return;
        if (getTablePlateShadowPose(_tableShadowFocus)) {
          // table-top center
        } else if (
          Number.isFinite(tablePlateCenter.x) &&
          Number.isFinite(tablePlateCenter.y) &&
          Number.isFinite(tablePlateCenter.z)
        ) {
          _tableShadowFocus.copy(tablePlateCenter);
        } else if (car) {
          _tableShadowFocus.copy(car.position);
        } else {
          return;
        }
        if (car) {
          const tableY = _tableShadowFocus.y;
          _tableShadowFocus.lerp(car.position, 0.72);
          _tableShadowFocus.y = tableY;
        }
        carShadowLight.target.position.set(
          _tableShadowFocus.x,
          _tableShadowFocus.y,
          _tableShadowFocus.z,
        );
        carShadowLight.position.set(
          _tableShadowFocus.x + 3,
          _tableShadowFocus.y + 20,
          _tableShadowFocus.z + 2,
        );
        carShadowLight.target.updateMatrixWorld();
        carShadowLight.updateMatrixWorld();
        configureTableShadowCamera();
        if (carShadowLight.shadow?.updateMatrices) {
          carShadowLight.shadow.updateMatrices(carShadowLight);
        }
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
        const size = _reflectionBox.getSize(new THREE.Vector3());
        const planeW = Math.max(size.x, 0.01);
        const planeH = Math.max(size.z, 0.01);
        const reflTex = perfSettings.reflectionTex || 128;
        const reflectorGeo = new THREE.PlaneGeometry(planeW, planeH);
        const reflector = new Reflector(reflectorGeo, {
          color: 0x777777,
          textureWidth: reflTex,
          textureHeight: reflTex,
          clipBias: 0.003,
        });
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
        _reflectionQuat.premultiply(
          model.getWorldQuaternion(new THREE.Quaternion()).invert(),
        );
        reflector.position.copy(_reflectionPos);
        reflector.quaternion.copy(_reflectionQuat);
        reflector.rotateX(Math.PI / 2 + Math.PI);
        reflector.scale.set(1, 1, 1);
        reflectionPlaneMesh.visible = false;
        model.add(reflector);
        tableReflector = reflector;
        // The desk's mirror doesn't show the light bars (their glow stays on the car only).
        const _reflectorRender = reflector.onBeforeRender;
        reflector.onBeforeRender = function (...args) {
          const hidden = _hideLightBarsForReflection();
          try {
            _reflectorRender.apply(this, args);
          } finally {
            for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
          }
        };
        if (!reflectionPlaneWorldPosition)
          reflectionPlaneWorldPosition = new THREE.Vector3();
        model.localToWorld(reflectionPlaneWorldPosition.copy(_reflectionPos));
        reflectionPlaneSurfaceY = _reflectionBox.max.y;
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

      /**
       * The 540 blind slats (1620 draw calls/frame across main, mac feed and reflector) render as one InstancedMesh.
       * The slat objects stay as off-scene transform proxies, so the blend/spacing code keeps writing to them.
       * Built on the first frame, after every setup pass has set the slats' flags.
       */
      let windowTrisInstanced = null;
      const _windowTrisGroupMatrices = [];
      const _windowTrisM = new THREE.Matrix4();
      function buildWindowTrisInstanced() {
        const n = windowTrisMeshes.length;
        if (windowTrisInstanced || !n) return;
        const first = windowTrisMeshes[0];
        const host = first.parent && first.parent.parent;
        if (!host || Array.isArray(first.material)) return;
        for (const m of windowTrisMeshes) {
          if (m.geometry !== first.geometry || m.material !== first.material) return;
          if (!m.parent || m.parent.parent !== host || !m.visible || !m.parent.visible) return;
          if (m.castShadow !== first.castShadow || m.receiveShadow !== first.receiveShadow) return;
        }
        const inst = new THREE.InstancedMesh(first.geometry, first.material, n);
        inst.name = "windowTrisInstanced";
        inst.castShadow = first.castShadow;
        inst.receiveShadow = first.receiveShadow;
        inst.layers.mask = first.layers.mask;
        inst.renderOrder = first.renderOrder;
        inst.frustumCulled = first.frustumCulled;
        _windowTrisGroupMatrices.length = 0;
        for (const m of windowTrisMeshes) {
          m.parent.updateMatrix();
          _windowTrisGroupMatrices.push(m.parent.matrix.clone());
          m.parent.remove(m);
        }
        host.add(inst);
        windowTrisInstanced = inst;
        syncWindowTrisInstances();
        scheduleRebuildBloomDarkenLists();
      }

      function syncWindowTrisInstances() {
        const inst = windowTrisInstanced;
        if (!inst) return;
        for (let i = 0; i < windowTrisMeshes.length; i++) {
          const m = windowTrisMeshes[i];
          m.updateMatrix();
          _windowTrisM.multiplyMatrices(_windowTrisGroupMatrices[i], m.matrix);
          inst.setMatrixAt(i, _windowTrisM);
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
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
          float aa = max(fwidth(d) * 2.35, 0.02);
          float core = exp(-(d * d) / (0.24 + aa * 0.45));
          float halo = exp(-(d * d) * (1.05 + aa * 0.35)) * 0.42;
          float a = core * 0.34 + halo * 0.14;
          float bottomFade = smoothstep(0.0, 0.92, vHeight);
          bottomFade = bottomFade * bottomFade * bottomFade * bottomFade;
          a *= bottomFade * uFade * uStack;
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

      function updateChargerEffect(dt, cupWorldPos, touching) {
        const fadeTarget = touching ? 1 : 0;
        _chargerFxFade +=
          (fadeTarget - _chargerFxFade) * Math.min(1, dt * 6.5);
        const f = THREE.MathUtils.clamp(_chargerFxFade, 0, 1);
        chargerParticles.visible = f > 0.01;
        chargerParticleMat.uniforms.uFade.value = f;
        if (!chargerParticles.visible || !cupWorldPos) {
          chargerPointLight.intensity = 0;
          return;
        }
        _chargerFxTime += dt;
        chargerParticleMat.uniforms.uTime.value = _chargerFxTime;
        _chargerFxWorldPos.copy(cupWorldPos);
        _chargerFxWorldPos.y += CHARGER_EFFECT_ABOVE_CUP;
        chargerParticles.position.copy(_chargerFxWorldPos);

        const posAttr = chargerParticleGeo.attributes.position;
        const arr = posAttr.array;
        const heightScale = 0.7 + f * 0.9;
        for (let i = 0; i < CHARGER_PARTICLE_COUNT; i++) {
          chargerParticleRise[i] += dt * chargerParticleRiseSpeed[i];
          if (chargerParticleRise[i] > 1) chargerParticleRise[i] -= 1;
          const maxH =
            chargerParticleMaxHeight[i] *
            chargerParticleHeightTail[i] *
            heightScale;
          const y = chargerParticleRise[i] * maxH;
          const drift = y * 0.25;
          arr[i * 3] =
            chargerParticleSpread[i * 2] + chargerParticleDriftX[i] * drift;
          arr[i * 3 + 1] = y;
          arr[i * 3 + 2] =
            chargerParticleSpread[i * 2 + 1] + chargerParticleDriftZ[i] * drift;
        }
        posAttr.needsUpdate = true;
        chargerPointLight.position.copy(_chargerFxWorldPos);
        chargerPointLight.position.y += 1.2;
        chargerPointLight.intensity = f * 25;
      }

      function createHandWalkFxTableSpill(radius, hexColor) {
        const geo = new THREE.CircleGeometry(radius, 40);
        const mat = new THREE.MeshBasicMaterial({
          color: hexColor,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: true,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.renderOrder = 2;
        mesh.visible = false;
        scene.add(mesh);
        return mesh;
      }

      function setupHandWalkFxSceneLights(config) {
        const pointLight = new THREE.PointLight(
          config.lightColor,
          0,
          (config.lightDistance || 12) * 1.45,
          1.45,
        );
        pointLight.layers.enable(TABLE_TOP_SHADOW_LAYER);
        pointLight.layers.enable(TABLE_WALL_SHADOW_LAYER);
        scene.add(pointLight);

        const spotLight = new THREE.SpotLight(
          config.lightColor,
          0,
          (config.lightDistance || 12) * 2.0,
          Math.PI / 3.4,
          0.8,
          1.2,
        );
        spotLight.castShadow = false;
        spotLight.layers.enable(TABLE_TOP_SHADOW_LAYER);
        spotLight.layers.enable(TABLE_WALL_SHADOW_LAYER);
        const spotTarget = new THREE.Object3D();
        scene.add(spotTarget);
        spotLight.target = spotTarget;
        scene.add(spotLight);

        const tableSpill = config.tableSpillRadius
          ? createHandWalkFxTableSpill(
              config.tableSpillRadius,
              config.lightColor,
            )
          : null;

        return { pointLight, spotLight, spotTarget, tableSpill };
      }

      function clearHandWalkFxSceneLighting(fx) {
        if (fx.light) fx.light.intensity = 0;
        if (fx.spotLight) fx.spotLight.intensity = 0;
        if (fx.tableSpill) {
          fx.tableSpill.visible = false;
          fx.tableSpill.material.opacity = 0;
        }
      }

      function updateHandWalkFxSceneLighting(
        fx,
        fade,
        worldPos,
        xOff,
        yOff,
        zOff,
        options = {},
      ) {
        const f = THREE.MathUtils.clamp(fade, 0, 1);
        if (f <= 0.01 || !worldPos) {
          clearHandWalkFxSceneLighting(fx);
          return;
        }
        const wind = options.wind || 0;
        const sign = options.sign < 0 ? -1 : 1;
        const ignite = options.ignite || 0;
        const pointMult = options.pointMult ?? 1;
        const spillMult = options.spillMult ?? 1;

        const lx = worldPos.x + xOff;
        const ly = worldPos.y + yOff;
        const lz = worldPos.z + zOff;
        const lightY = ly + (fx.config.lightYOffset || 0.5);

        const pointBoost = 1 + ignite * 0.34 + wind * 0.14;
        const spotBoost = 1 + ignite * 0.24 + wind * 0.1;
        const spillBoost = 1 + ignite * 0.5 + wind * 0.12;

        fx.light.position.set(lx, lightY, lz);
        fx.light.intensity =
          f *
          (fx.config.lightIntensity || 12) *
          pointBoost *
          pointMult *
          1.75;

        if (fx.spotLight) {
          fx.spotLight.position.set(lx, lightY, lz);
          fx.spotLight.intensity =
            f * (fx.config.spotIntensity || 14) * spotBoost * pointMult;
          if (fx.spotTarget) {
            fx.spotTarget.position.set(lx, lightY - 4.5, lz + sign * 1.5);
            fx.spotTarget.updateMatrixWorld();
          }
        }

        if (fx.tableSpill) {
          fx.tableSpill.visible = true;
          fx.tableSpill.position.set(lx, tableSurfaceY + 0.07, lz);
          const spillFade = f * spillBoost * spillMult;
          fx.tableSpill.material.opacity = Math.min(
            0.44,
            spillFade * (fx.config.tableSpillStrength || 0.3),
          );
          const s =
            (fx.config.tableSpillRadius || 1.5) * (0.82 + spillFade * 0.28);
          fx.tableSpill.scale.set(s, s, 1);
        }
      }

      function createHandWalkTriggerEffect(config) {
        const count = config.count;
        const igniteBurst = !!config.igniteBurst;
        const windEffect = !!config.windEffect;
        const rise = new Float32Array(count);
        const spread = new Float32Array(count * 2);
        const riseSpeed = new Float32Array(count);
        const maxHeight = new Float32Array(count);
        const driftX = new Float32Array(count);
        const driftZ = new Float32Array(count);
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizeScale = new Float32Array(count);
        const burstImpulse = igniteBurst ? new Float32Array(count * 3) : null;
        const trailZ = windEffect ? new Float32Array(count) : null;
        for (let i = 0; i < count; i++) {
          rise[i] = igniteBurst ? Math.random() * 0.04 : Math.random() * 2;
          const r = Math.sqrt(Math.random()) * config.radius;
          const angle = Math.random() * Math.PI * 2;
          spread[i * 2] = Math.cos(angle) * r;
          spread[i * 2 + 1] = Math.sin(angle) * r;
          if (burstImpulse) {
            const burstAngle = Math.random() * Math.PI * 2;
            const burstOut = 0.03 + Math.random() * 0.14;
            const burstUp = 0.06 + Math.random() * 0.22;
            burstImpulse[i * 3] = Math.cos(burstAngle) * burstOut;
            burstImpulse[i * 3 + 1] = burstUp;
            burstImpulse[i * 3 + 2] = Math.sin(burstAngle) * burstOut;
          }
          riseSpeed[i] = config.riseSpeedMin + Math.random() * config.riseSpeedRange;
          maxHeight[i] = config.maxHeightMin + Math.random() * config.maxHeightRange;
          const driftAngle = Math.random() * Math.PI * 2;
          const driftMag = config.driftMin + Math.random() * config.driftRange;
          driftX[i] = Math.cos(driftAngle) * driftMag;
          driftZ[i] = Math.sin(driftAngle) * driftMag;
          sizeScale[i] = config.sizeMin + Math.random() * config.sizeRange;
          const c = config.colors[i % config.colors.length].clone();
          c.multiplyScalar(0.76 + Math.random() * 0.24);
          colors[i * 3] = c.r;
          colors[i * 3 + 1] = c.g;
          colors[i * 3 + 2] = c.b;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        geo.setAttribute("sizeScale", new THREE.BufferAttribute(sizeScale, 1));
        const uniforms = {
          uSize: { value: config.pointSize },
          uTime: { value: 0 },
          uFade: { value: 0 },
          uTint: { value: config.tint.clone() },
        };
        if (igniteBurst) uniforms.uIgnite = { value: 0 };
        if (windEffect) {
          uniforms.uWind = { value: 0 };
          uniforms.uWindDir = { value: -1 };
          uniforms.uOpacity = { value: config.opacity ?? 1 };
        }
        const windVertexExtras = windEffect
          ? `
            varying float vWindStretch;
            varying float vSizeScale;
            uniform float uWind;
            uniform float uWindDir;
          `
          : "";
        const igniteVertexExtras = igniteBurst
          ? `
            varying float vIgniteGlow;
            uniform float uIgnite;
          `
          : "";
        const windVertexBody = windEffect
          ? "vSizeScale = sizeScale; vWindStretch = uWind * (0.5 + sizeScale * 0.2) * (0.45 + smoothstep(0.0, 2.1, vHeight));"
          : "";
        const igniteVertexBody = igniteBurst
          ? "vIgniteGlow = uIgnite * (1.0 - smoothstep(0.0, 0.42, length(position.xz)));"
          : "";
        const windSizeBoost = windEffect ? " * (1.0 + vWindStretch * 0.14)" : "";
        const igniteSizeBoost = igniteBurst ? " * (1.0 + vIgniteGlow * 0.18)" : "";
        const pointSizeCap = windEffect ? "96.0" : igniteBurst ? "145.0" : "120.0";
        const windFragmentExtras = windEffect
          ? "varying float vWindStretch; varying float vSizeScale; uniform float uWindDir; uniform float uOpacity;"
          : "";
        const igniteFragmentExtras = igniteBurst ? "varying float vIgniteGlow;" : "";
        const windFragmentHelper = windEffect
          ? `
            float hwWindSoftGlow(vec2 p, float sizeS, float trailAmt, float windDir) {
              vec2 q = p;
              q.y = (q.y + windDir * trailAmt * 0.2) / (1.0 + trailAmt * 1.28);
              float across = q.x * (1.08 + trailAmt * 0.05);
              float along = q.y;
              float aaA = max(fwidth(across) * 2.35, 0.02);
              float aaB = max(fwidth(along) * 2.35, 0.02);
              float cross = exp(-(across * across) / (0.24 + aaA * 0.45));
              float alongGlow = exp(-(along * along) / (0.32 + trailAmt * 0.5 + aaB * 0.38));
              float outer = exp(-dot(q, q) * (1.45 + aaA * 0.5)) * 0.38;
              return cross * alongGlow * 0.3 + outer * 0.11;
            }
          `
          : "";
        const windFragmentBody = windEffect
          ? `
              float trail = vWindStretch;
              vec2 c0 = c;
              float d = length(c0) * 2.0;
              float core = exp(-d * d * 3.4);
              float halo = exp(-d * d * 1.05) * 0.48;
              float a = hwWindSoftGlow(c0, vSizeScale, trail, uWindDir);
              float ty = gl_PointCoord.y - 0.5 + uWindDir * trail * 0.09;
              float tailGlow =
                exp(-ty * ty / (0.1 + trail * 0.28)) *
                exp(-max(0.0, uWindDir * ty) * 2.0) * trail * 0.2;
              a += tailGlow * 0.48;
              a = min(a, 0.55);
            `
          : `
              float d = length(c) * 2.0;
              float core = 1.0 - smoothstep(0.0, 0.74, d);
              core *= core;
              float halo = 1.0 - smoothstep(0.32, 1.14, d);
              halo *= halo * 0.45;
              float a = (core + halo) * 0.48;
            `;
        const igniteFragmentBody = igniteBurst
          ? `
              float puffFlash = vIgniteGlow * (core + halo * 0.35);
              a += puffFlash * 0.2;
              fireColor = mix(fireColor, vec3(0.52, 1.0, 0.44), puffFlash * 0.28);
              fireColor *= 1.0 + puffFlash * 0.38;
            `
          : "";
        const windColorBody = windEffect
          ? `
              float lum = dot(fireColor, vec3(0.299, 0.587, 0.114));
              fireColor = mix(vec3(lum), fireColor, 1.42);
              fireColor = mix(fireColor, glow, halo * 0.22 + core * 0.08);
              fireColor = max(fireColor, vec3(0.0));
            `
          : "";
        const startFadeEdge = windEffect ? "0.92" : igniteBurst ? "0.96" : "0.34";
        const bottomFadeBody =
          windEffect || igniteBurst
            ? `
              float bottomFade = smoothstep(0.0, ${startFadeEdge}, vHeight);
              bottomFade = bottomFade * bottomFade * bottomFade * bottomFade;
              a *= bottomFade * uFade${windEffect ? " * uOpacity" : ""};
            `
            : `
              float startFade = smoothstep(0.0, ${startFadeEdge}, vHeight);
              a *= startFade * uFade;
            `;
        const mat = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          uniforms,
          vertexShader: `
            attribute vec3 color;
            attribute float sizeScale;
            varying vec3 vColor;
            varying float vHeight;
            ${igniteVertexExtras}
            ${windVertexExtras}
            uniform float uSize;
            void main() {
              vColor = color;
              vHeight = position.y;
              ${igniteVertexBody}
              ${windVertexBody}
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              gl_Position = projectionMatrix * mv;
              float att = 1.0 / max(0.1, -mv.z);
              gl_PointSize = min(uSize * att * sizeScale${igniteSizeBoost}${windSizeBoost}, ${pointSizeCap});
            }
          `,
          fragmentShader: `
            varying vec3 vColor;
            varying float vHeight;
            uniform float uFade;
            uniform vec3 uTint;
            ${igniteFragmentExtras}
            ${windFragmentExtras}
            ${windFragmentHelper}
            void main() {
              vec2 c = gl_PointCoord - 0.5;
              ${windFragmentBody}
              ${bottomFadeBody}
              vec3 fireColor = vColor * 0.72;
              float tip = smoothstep(0.0, 2.7, vHeight);
              vec3 emerald = vec3(0.02, 0.80, 0.26);
              vec3 lime = vec3(0.45, 1.00, 0.28);
              vec3 glow = vec3(0.18, 1.00, 0.52);
              fireColor = mix(fireColor, emerald, (1.0 - tip) * 0.34);
              fireColor = mix(fireColor, lime, tip * 0.45);
              fireColor = mix(fireColor, glow, halo * 0.30);
              ${windColorBody}
              ${igniteFragmentBody}
              fireColor *= uTint;
              gl_FragColor = vec4(max(fireColor, vec3(0.0)), a);
            }
          `,
        });
        const points = new THREE.Points(geo, mat);
        points.visible = false;
        points.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
        scene.add(points);
        const sceneLights = setupHandWalkFxSceneLights(config);
        const light = sceneLights.pointLight;
        const spotLight = sceneLights.spotLight;
        const spotTarget = sceneLights.spotTarget;
        const tableSpill = sceneLights.tableSpill;
        return {
          count,
          rise,
          spread,
          riseSpeed,
          maxHeight,
          driftX,
          driftZ,
          positions,
          geo,
          mat,
          points,
          light,
          spotLight,
          spotTarget,
          tableSpill,
          config,
          igniteBurst,
          burstImpulse,
          windEffect,
          trailZ,
        };
      }


      function clearHandWalkBigFxTrails() {
        if (handWalkBigFx && handWalkBigFx.trailZ) handWalkBigFx.trailZ.fill(0);
      }

      function updateHandWalkBigFxInstance(
        dt,
        fade,
        worldPos,
        xOffset,
        yOffset,
        zOffset,
        windTilt,
        windSign,
      ) {
        const fx = handWalkBigFx;
        if (!fx) return;
        const f = THREE.MathUtils.clamp(fade, 0, 1);
        const wind = THREE.MathUtils.clamp(windTilt, 0, 1);
        const sign = windSign < 0 ? -1 : 1;
        fx.points.visible = f > 0.01;
        fx.mat.uniforms.uFade.value = f;
        if (fx.mat.uniforms.uWind) fx.mat.uniforms.uWind.value = wind;
        if (fx.mat.uniforms.uWindDir) fx.mat.uniforms.uWindDir.value = sign;
        if (!fx.points.visible || !worldPos) {
          fx.light.intensity = 0;
          fx.points.rotation.x = 0;
          clearHandWalkFxSceneLighting(fx);
          clearHandWalkBigFxTrails();
          if (handWalkBigFxHalo) {
            handWalkBigFxHalo.points.visible = false;
            handWalkBigFxHalo.mat.uniforms.uFade.value = 0;
          }
          if (handWalkBigFxMist) {
            handWalkBigFxMist.points.visible = false;
            handWalkBigFxMist.mat.uniforms.uFade.value = 0;
          }
          return;
        }
        fx.points.position.copy(worldPos);
        fx.points.position.x += xOffset;
        fx.points.position.y += yOffset;
        fx.points.position.z += zOffset;
        fx.points.rotation.x = sign * wind * 0.22;
        fx.mat.uniforms.uTime.value = _handWalkFxTime;
        const posAttr = fx.geo.attributes.position;
        const arr = posAttr.array;
        const heightScale = 0.7 + f * 0.9;
        const trailDecay = 1 - Math.min(1, dt * 2.8);
        for (let i = 0; i < fx.count; i++) {
          fx.rise[i] += dt * fx.riseSpeed[i] * (1 + wind * 0.18);
          if (fx.rise[i] > 1) fx.rise[i] -= 1;
          const y = fx.rise[i] * fx.maxHeight[i] * heightScale;
          const drift = y * (0.25 + wind * 0.12);
          const windShear = wind * (y * 0.68 + 0.14);
          let trail = 0;
          if (fx.trailZ) {
            fx.trailZ[i] += dt * wind * (0.42 + fx.riseSpeed[i] * 0.55);
            fx.trailZ[i] *= trailDecay;
            trail = fx.trailZ[i];
          }
          arr[i * 3] = fx.spread[i * 2] + fx.driftX[i] * drift;
          arr[i * 3 + 1] = y;
          arr[i * 3 + 2] =
            fx.spread[i * 2 + 1] +
            fx.driftZ[i] * drift +
            sign * (windShear + trail);
        }
        posAttr.needsUpdate = true;
        updateHandWalkFxSceneLighting(fx, f, worldPos, xOffset, yOffset, zOffset, {
          wind,
          sign,
          pointMult: 0.86,
          spillMult: 0.92,
        });

        const halo = handWalkBigFxHalo;
        if (!halo) return;
        halo.points.visible = f > 0.01;
        halo.mat.uniforms.uFade.value = f * 0.78;
        if (!halo.points.visible) return;
        halo.points.position.copy(fx.points.position);
        halo.points.rotation.x = fx.points.rotation.x;
        const haloPos = halo.geo.attributes.position;
        const haloArr = haloPos.array;
        const haloHeightScale = 0.78 + f * 0.95;
        for (let i = 0; i < halo.count; i++) {
          halo.rise[i] += dt * halo.riseSpeed[i] * (1 + wind * 0.12);
          if (halo.rise[i] > 1) halo.rise[i] -= 1;
          const y = halo.rise[i] * halo.maxHeight[i] * haloHeightScale;
          const drift = y * (0.22 + wind * 0.1);
          const windShear = wind * (y * 0.52 + 0.1);
          haloArr[i * 3] = halo.spread[i * 2] + halo.driftX[i] * drift;
          haloArr[i * 3 + 1] = y;
          haloArr[i * 3 + 2] =
            halo.spread[i * 2 + 1] + halo.driftZ[i] * drift + sign * windShear;
        }
        haloPos.needsUpdate = true;

        const mist = handWalkBigFxMist;
        if (!mist) return;
        mist.points.visible = f > 0.01;
        mist.mat.uniforms.uFade.value = f * 0.74;
        if (!mist.points.visible) return;
        mist.points.position.copy(fx.points.position);
        mist.points.rotation.x = fx.points.rotation.x;
        const mistPos = mist.geo.attributes.position;
        const mistArr = mistPos.array;
        const mistHeightScale = 0.82 + f * 0.92;
        for (let i = 0; i < mist.count; i++) {
          mist.rise[i] += dt * mist.riseSpeed[i] * (1 + wind * 0.08);
          if (mist.rise[i] > 1) mist.rise[i] -= 1;
          const y = mist.rise[i] * mist.maxHeight[i] * mistHeightScale;
          const drift = y * (0.18 + wind * 0.08);
          const windShear = wind * (y * 0.38 + 0.08);
          mistArr[i * 3] = mist.spread[i * 2] + mist.driftX[i] * drift;
          mistArr[i * 3 + 1] = y;
          mistArr[i * 3 + 2] =
            mist.spread[i * 2 + 1] + mist.driftZ[i] * drift + sign * windShear;
        }
        mistPos.needsUpdate = true;
      }

      function initHandWalkSmallFxFlameOn() {
        const fx = handWalkSmallFx;
        if (!fx) return;
        _handWalkSmallFxIgniteT = 0;
        for (let i = 0; i < fx.count; i++) {
          fx.rise[i] = Math.random() * 0.05;
          if (fx.burstImpulse) {
            const burstAngle = Math.random() * Math.PI * 2;
            const burstOut = 0.03 + Math.random() * 0.15;
            const burstUp = 0.07 + Math.random() * 0.24;
            fx.burstImpulse[i * 3] = Math.cos(burstAngle) * burstOut;
            fx.burstImpulse[i * 3 + 1] = burstUp;
            fx.burstImpulse[i * 3 + 2] = Math.sin(burstAngle) * burstOut;
          }
        }
      }

      function updateHandWalkSmallFxInstance(
        dt,
        fade,
        worldPos,
        xOffset,
        yOffset,
        zOffset,
      ) {
        const fx = handWalkSmallFx;
        if (!fx) return;
        const f = THREE.MathUtils.clamp(fade, 0, 1);
        fx.points.visible = f > 0.01;
        if (!fx.points.visible || !worldPos) {
          fx.mat.uniforms.uFade.value = 0;
          if (fx.mat.uniforms.uIgnite) fx.mat.uniforms.uIgnite.value = 0;
          clearHandWalkFxSceneLighting(fx);
          return;
        }

        let ignite = 0;
        if (_handWalkSmallFxIgniteT >= 0) {
          _handWalkSmallFxIgniteT += dt;
          const p = Math.min(
            1,
            _handWalkSmallFxIgniteT / HAND_WALK_SMALL_IGNITE_SEC,
          );
          ignite = 1 - p * p * (3 - 2 * p);
          if (_handWalkSmallFxIgniteT >= HAND_WALK_SMALL_IGNITE_SEC) {
            _handWalkSmallFxIgniteT = -1;
            ignite = 0;
          }
        }
        if (fx.mat.uniforms.uIgnite) fx.mat.uniforms.uIgnite.value = ignite;

        const fadeBoost = Math.max(f, ignite * 0.55) * (1 + ignite * 0.18);
        fx.mat.uniforms.uFade.value = Math.min(1.1, fadeBoost);

        fx.points.position.copy(worldPos);
        fx.points.position.x += xOffset;
        fx.points.position.y += yOffset;
        fx.points.position.z += zOffset;
        fx.mat.uniforms.uTime.value = _handWalkFxTime;

        const posAttr = fx.geo.attributes.position;
        const arr = posAttr.array;
        const puffOpen = 1 - ignite;
        const spreadScale = THREE.MathUtils.lerp(0.62, 1.0, puffOpen * puffOpen);
        const riseMult = 1 + ignite * 2.1;
        const heightScale = (0.68 + puffOpen * 0.1) + f * 0.9;
        const burstStrength = ignite * ignite * 0.65;

        for (let i = 0; i < fx.count; i++) {
          fx.rise[i] += dt * fx.riseSpeed[i] * riseMult;
          if (fx.rise[i] > 1) fx.rise[i] -= 1;
          const y = fx.rise[i] * fx.maxHeight[i] * heightScale;
          const drift = y * (0.14 + puffOpen * 0.11);
          let bx = 0;
          let by = 0;
          let bz = 0;
          if (fx.burstImpulse && burstStrength > 0) {
            bx = fx.burstImpulse[i * 3] * burstStrength;
            by = fx.burstImpulse[i * 3 + 1] * burstStrength;
            bz = fx.burstImpulse[i * 3 + 2] * burstStrength;
          }
          arr[i * 3] =
            fx.spread[i * 2] * spreadScale + fx.driftX[i] * drift + bx;
          arr[i * 3 + 1] = y + by;
          arr[i * 3 + 2] =
            fx.spread[i * 2 + 1] * spreadScale + fx.driftZ[i] * drift + bz;
        }
        posAttr.needsUpdate = true;
        updateHandWalkFxSceneLighting(
          fx,
          Math.min(1, fadeBoost),
          worldPos,
          xOffset,
          yOffset,
          zOffset,
          { ignite },
        );
      }

      const _handWalkFxPaletteSmall = [
        new THREE.Color(0x13d95d),
        new THREE.Color(0x28ff72),
        new THREE.Color(0x22e28f),
        new THREE.Color(0x8cff4d),
      ];
      const _handWalkFxPaletteBig = [
        new THREE.Color(0x11d85f),
        new THREE.Color(0x39ff70),
        new THREE.Color(0x7cff43),
        new THREE.Color(0x2cf2aa),
      ];
      const handWalkSmallFx = createHandWalkTriggerEffect({
        count: 295,
        radius: 0.61,
        riseSpeedMin: 0.6,
        riseSpeedRange: 0.9,
        maxHeightMin: 0.76,
        maxHeightRange: 0.71,
        driftMin: 0.06,
        driftRange: 0.24,
        sizeMin: 0.86,
        sizeRange: 1.4,
        pointSize: 770,
        colors: _handWalkFxPaletteSmall,
        tint: new THREE.Color(0.62, 1.0, 0.65),
        lightColor: 0x3cff66,
        lightIntensity: 18,
        lightDistance: 13,
        lightYOffset: 0.55,
        spotIntensity: 16,
        tableSpillRadius: 1.35,
        tableSpillStrength: 0.32,
        igniteBurst: true,
      });
      const handWalkBigFx = createHandWalkTriggerEffect({
        count: 1080,
        radius: 0.44,
        riseSpeedMin: 0.62,
        riseSpeedRange: 0.95,
        maxHeightMin: 0.68,
        maxHeightRange: 0.63,
        driftMin: 0.1,
        driftRange: 0.24,
        sizeMin: 0.21,
        sizeRange: 0.4,
        pointSize: 300,
        colors: _handWalkFxPaletteBig,
        tint: new THREE.Color(0.68, 0.98, 0.7),
        lightColor: 0x59ff5f,
        lightIntensity: 22,
        lightDistance: 14,
        lightYOffset: 0.54,
        spotIntensity: 22,
        tableSpillRadius: 1.85,
        tableSpillStrength: 0.34,
        windEffect: true,
        opacity: 0.8,
      });

      function createHandWalkBigFxSoftHalo() {
        const count = 520;
        const rise = new Float32Array(count);
        const spread = new Float32Array(count * 2);
        const riseSpeed = new Float32Array(count);
        const maxHeight = new Float32Array(count);
        const driftX = new Float32Array(count);
        const driftZ = new Float32Array(count);
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizeScale = new Float32Array(count);
        const radius = 0.53;
        for (let i = 0; i < count; i++) {
          rise[i] = Math.random() * 2;
          const r = Math.sqrt(Math.random()) * radius;
          const angle = Math.random() * Math.PI * 2;
          spread[i * 2] = Math.cos(angle) * r;
          spread[i * 2 + 1] = Math.sin(angle) * r;
          riseSpeed[i] = 0.48 + Math.random() * 0.72;
          maxHeight[i] = 0.72 + Math.random() * 0.66;
          const driftAngle = Math.random() * Math.PI * 2;
          const driftMag = 0.1 + Math.random() * 0.28;
          driftX[i] = Math.cos(driftAngle) * driftMag;
          driftZ[i] = Math.sin(driftAngle) * driftMag;
          sizeScale[i] = 0.86 + Math.random() * 1.2;
          const c = _handWalkFxPaletteBig[i % _handWalkFxPaletteBig.length].clone();
          c.multiplyScalar(0.7 + Math.random() * 0.22);
          colors[i * 3] = c.r;
          colors[i * 3 + 1] = c.g;
          colors[i * 3 + 2] = c.b;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        geo.setAttribute("sizeScale", new THREE.BufferAttribute(sizeScale, 1));
        const mat = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uSize: { value: 580 },
            uFade: { value: 0 },
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
              gl_PointSize = min(uSize * att * sizeScale, 96.0);
            }
          `,
          fragmentShader: `
            varying vec3 vColor;
            varying float vHeight;
            uniform float uFade;
            void main() {
              vec2 c = gl_PointCoord - 0.5;
              float d = length(c) * 2.0;
              float aa = max(fwidth(d) * 2.6, 0.024);
              float g1 = exp(-d * d / (0.42 + aa * 0.55));
              float g2 = exp(-d * d / (1.05 + aa * 0.7)) * 0.42;
              float g3 = exp(-d * d / (2.2 + aa)) * 0.16;
              float a = (g1 * 0.52 + g2 * 0.33 + g3 * 0.15) * 0.12;
              float bottomFade = smoothstep(0.0, 0.78, vHeight);
              bottomFade = bottomFade * bottomFade * bottomFade * bottomFade;
              a *= bottomFade * uFade;
              vec3 col = vColor * 0.64;
              col = mix(col, vec3(0.16, 1.0, 0.38), g2 * 0.28);
              gl_FragColor = vec4(col, a);
            }
          `,
        });
        const points = new THREE.Points(geo, mat);
        points.visible = false;
        points.renderOrder = -1;
        points.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
        scene.add(points);
        return { count, rise, spread, riseSpeed, maxHeight, driftX, driftZ, geo, mat, points };
      }

      function createHandWalkBigFxMist() {
        const count = 260;
        const rise = new Float32Array(count);
        const spread = new Float32Array(count * 2);
        const riseSpeed = new Float32Array(count);
        const maxHeight = new Float32Array(count);
        const driftX = new Float32Array(count);
        const driftZ = new Float32Array(count);
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizeScale = new Float32Array(count);
        const radius = 0.56;
        for (let i = 0; i < count; i++) {
          rise[i] = Math.random() * 2;
          const r = Math.sqrt(Math.random()) * radius;
          const angle = Math.random() * Math.PI * 2;
          spread[i * 2] = Math.cos(angle) * r;
          spread[i * 2 + 1] = Math.sin(angle) * r;
          riseSpeed[i] = 0.38 + Math.random() * 0.58;
          maxHeight[i] = 0.76 + Math.random() * 0.74;
          const driftAngle = Math.random() * Math.PI * 2;
          const driftMag = 0.08 + Math.random() * 0.22;
          driftX[i] = Math.cos(driftAngle) * driftMag;
          driftZ[i] = Math.sin(driftAngle) * driftMag;
          sizeScale[i] = 1.18 + Math.random() * 1.52;
          const c = _handWalkFxPaletteBig[i % _handWalkFxPaletteBig.length].clone();
          c.multiplyScalar(0.62 + Math.random() * 0.2);
          colors[i * 3] = c.r;
          colors[i * 3 + 1] = c.g;
          colors[i * 3 + 2] = c.b;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        geo.setAttribute("sizeScale", new THREE.BufferAttribute(sizeScale, 1));
        const mat = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uSize: { value: 710 },
            uFade: { value: 0 },
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
              gl_PointSize = min(uSize * att * sizeScale, 104.0);
            }
          `,
          fragmentShader: `
            varying vec3 vColor;
            varying float vHeight;
            uniform float uFade;
            void main() {
              vec2 c = gl_PointCoord - 0.5;
              float r2 = dot(c, c) * 4.0;
              float aa = max(fwidth(r2) * 1.4, 0.03);
              float a = exp(-r2 / (0.55 + aa)) * 0.085 + exp(-r2 / (1.8 + aa * 1.2)) * 0.045;
              float bottomFade = smoothstep(0.0, 0.72, vHeight);
              bottomFade = bottomFade * bottomFade * bottomFade * bottomFade;
              a *= bottomFade * uFade;
              gl_FragColor = vec4(vColor * 0.58, a);
            }
          `,
        });
        const points = new THREE.Points(geo, mat);
        points.visible = false;
        points.renderOrder = -2;
        points.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
        scene.add(points);
        return { count, rise, spread, riseSpeed, maxHeight, driftX, driftZ, geo, mat, points };
      }

      const handWalkBigFxHalo = createHandWalkBigFxSoftHalo();
      const handWalkBigFxMist = createHandWalkBigFxMist();



      _handWalkFxPivotGizmo = null;

      function updateHandWalkFxPivotGizmo(worldPos, visible) {
        if (!_handWalkFxPivotGizmo) return;
        _handWalkFxPivotGizmo.visible = !!visible && !!worldPos;
        if (!_handWalkFxPivotGizmo.visible) return;
        _handWalkFxPivotGizmo.position.copy(worldPos);
      }

      function updateHandWalkBigFxWind(dt) {
        if (!handWalkPart || _handWalkZPhase === 0) {
          _handWalkBigFxWind +=
            (0 - _handWalkBigFxWind) * Math.min(1, dt * 7);
          _handWalkPrevZValid = false;
          return;
        }
        const targetSign = _handWalkZPhase === 2 ? 1 : -1;
        if (targetSign !== _handWalkBigFxWindSign) {
          _handWalkBigFxWindSign = targetSign;
          clearHandWalkBigFxTrails();
        }
        const z = handWalkPart.position.z;
        if (!_handWalkPrevZValid) {
          _handWalkPrevZ = z;
          _handWalkPrevZValid = true;
          return;
        }
        const zVel = (z - _handWalkPrevZ) / Math.max(dt, 1e-5);
        _handWalkPrevZ = z;
        const targetWind = THREE.MathUtils.clamp(
          Math.abs(zVel) * 0.062,
          0,
          HAND_WALK_BIG_FX_WIND_MAX,
        );
        _handWalkBigFxWind +=
          (targetWind - _handWalkBigFxWind) * Math.min(1, dt * 11);
      }

      function updateHandWalkTriggerEffects(
        dt,
        smallTarget,
        smallPos,
        bigTarget,
        bigPos,
      ) {
        _handWalkFxTime += dt;
        // The intro's demonstration of the hand's green flame (no trigger, no walk).
        if (_introHandFxDemo > 0) smallTarget = Math.max(smallTarget, _introHandFxDemo);
        if (_handHitFx > 0) smallTarget = Math.max(smallTarget, _handHitFx); // the first mode, from a hit
        _handWalkSmallFxFade +=
          (THREE.MathUtils.clamp(smallTarget, 0, 1) - _handWalkSmallFxFade) *
          Math.min(1, dt * 10);
        _handWalkBigFxFade +=
          (THREE.MathUtils.clamp(bigTarget, 0, 1) - _handWalkBigFxFade) *
          Math.min(1, dt * 6.5);
        const hasHandPivot = getHandWalkFxWorldPosition(
          _handWalkPartFxWorldPos,
        );
        const pivotPos = hasHandPivot
          ? _handWalkPartFxWorldPos
          : smallPos || bigPos;
        updateHandWalkBigFxWind(dt);
        updateHandWalkSmallFxInstance(
          dt,
          _handWalkSmallFxFade,
          pivotPos,
          0.12,
          0.75,
          -1.0,
        );
        updateHandWalkBigFxInstance(
          dt,
          _handWalkBigFxFade,
          pivotPos,
          0,
          0.88,
          -0.78,
          _handWalkBigFxWind,
          _handWalkBigFxWindSign,
        );
        const showPivot =
          (_handWalkSmallFxFade > 0.02 || _handWalkBigFxFade > 0.02) && pivotPos;
        updateHandWalkFxPivotGizmo(pivotPos, showPivot);
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
      let flameEffects = [];
      let flameEffectsVisible = false;
      let flameWaveStartTime = 0;

      function startFlameWaveEffect(nowSec) {
        flameEffectsVisible = true;
        flameWaveStartTime = nowSec;
      }
      const FLAME_WAVE_DELAY_MS = 200;
      const FLAME_EFFECT_DURATION_MS = 220;

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
        for (let i = 0; i < flameMeshes.length; i++) {
          const flameMesh = flameMeshes[i];
          const effect = createSmallFireEffect();
          effect.flameMesh = flameMesh;
          effect.points.visible = false;
          effect.trailPoints.visible = false;
          effect.trailPoints2.visible = false;
          effect.trailPoints3.visible = false;
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
          effect.points.material.uniforms.uSize.value =
            EXHAUST_FLAME_SIZE * 0.14;
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
        scheduleRebuildBloomDarkenLists();
      }

      // The car's head / tail lamp spot lights and table glows, shared with the
      // kitchen (game/carLighting.js). The office desk writes no stencil, so the
      // glows aren't masked to it.
      const carLighting = createCarLighting({
        THREE,
        scene,
        beamTextureUrl: officeAsset("textures/headlight-beam.png") + "?v=dim3",
        stencilRef: null,
      });
      let tableLightGlows = [];
      const _carLampSpots = [];
      /** One centred spot per lamp (2 car spots instead of the kitchen's 4, same total light) to keep the office fast. */
      const OFFICE_CAR_SPOTS_PER_LAMP = 1;

      function setupTableLightReflections(carRoot) {
        tableLightGlows = [];
        carLighting.setupTableLightReflections(carRoot, tableLightGlows);
        scheduleRebuildBloomDarkenLists();
      }

      /** Head / tail lamp spots, once the car is scaled and on the desk. */
      function attachCarHeadTailSpotLights() {
        if (!car || _carLampSpots.length) return;
        carLighting.attachCarHeadTailSpotLights(car, car, _carLampSpots, {
          halfL,
          carScale: storedCarScale,
          tableY: getTablePlaySurfaceY(),
          spotsPerLamp: OFFICE_CAR_SPOTS_PER_LAMP,
        });
      }

      function updateTableLightReflections() {
        if (!car) return;
        const tableY = getTablePlaySurfaceY();
        if (tableY == null) return;
        carLighting.aimCarLampSpots(_carLampSpots, car, tableY);
        if (!tableLightGlows.length || !perfSettings.reflection) {
          carLighting.hideGlows(tableLightGlows);
          return;
        }
        carLighting.drawCarTableGlows(
          tableLightGlows,
          carState.angle + (carState.driftAngle || 0),
          keys.brake,
          tableY,
          Math.max(0.08, halfW * storedCarScale),
        );
      }

      /**
       * Video screens (leftScreen / rightScreen): share of the video's own
       * colour that goes into the bloom (0..1), a subtle soft glow around the
       * screen; the video's colours and sharpness aren't changed.
       */
      const SCREEN_BLOOM = { weight: 0.5 };
            function setupScreenVideo(mesh, video, canvas, videoSrc) {
        if (!mesh) return null;
        // The source is set once the level is ready (startScreenVideos): nothing downloads before that.
        video.preload = "none";
        video.dataset.src = videoSrc;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute("playsinline", "");
        if (_officeSceneReady) queueMicrotask(startScreenVideos); // the level was ready first
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
        // A soft glow from the video's own light (the video itself is unchanged).
        setBloomWeight(mesh.material, SCREEN_BLOOM.weight);
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
        macScreenRenderTarget = new THREE.WebGLRenderTarget(macRt.w, macRt.h, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: true,
        });
        macScreenRenderTarget.texture.colorSpace = THREE.SRGBColorSpace;
        macScreenRenderTarget.texture.flipY = false;
        macFrontCamera = new THREE.PerspectiveCamera(
          MAC_FRONT_CAM_FOV,
          macRt.w / macRt.h,
          0.08,
          500,
        );
        macFrontCamera.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
        macFrontCamera.layers.enable(TABLE_WALL_SHADOW_LAYER);
        macFrontCamera.layers.enable(TABLE_TOP_SHADOW_LAYER);
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
            enableTableTopShadowCasterLayer(node);
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
          officeAsset("wixNoteBook-2k.jpg"),
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

      /**
       * bookLeftPage's printed graphics: a very faint light from its own
       * texture (emissive × the page image; was none) so its paper reads as
       * light as the right page's, without glowing.
       */
      const BOOK_LEFT_PAGE = { emissiveIntensity: 0.12 };
      function setupBookLeftPageDecal(model) {
        const page = model.getObjectByName("bookLeftPage");
        if (!page?.isMesh || !page.geometry) return;
        if (page.getObjectByName("bookLeftPageDecal")) return;

        new THREE.TextureLoader().load(
          officeAsset("bookLeftPage-2k.jpg"),
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.flipY = true;
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
            tex.center.set(0.5, 0.5);
            tex.needsUpdate = true;

            model.updateMatrixWorld(true);
            page.updateMatrixWorld(true);

            const box = new THREE.Box3().setFromObject(page);
            if (box.isEmpty()) return;
            const boxSize = box.getSize(new THREE.Vector3());

            let nrm = page.geometry.attributes.normal;
            if (!nrm) {
              page.geometry.computeVertexNormals();
              nrm = page.geometry.attributes.normal;
            }
            const nLocal = new THREE.Vector3();
            const nTmp = new THREE.Vector3();
            for (let i = 0; i < nrm.count; i++) {
              nTmp.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
              nLocal.add(nTmp);
            }
            if (nLocal.lengthSq() < 1e-12) return;
            nLocal.normalize();
            const nWorld = nLocal
              .clone()
              .transformDirection(page.matrixWorld)
              .normalize();

            const up = new THREE.Vector3(0, 1, 0);
            const uAxis = new THREE.Vector3().crossVectors(up, nWorld);
            if (uAxis.lengthSq() < 1e-10) {
              uAxis.crossVectors(new THREE.Vector3(1, 0, 0), nWorld);
            }
            uAxis.normalize();
            const vAxis = new THREE.Vector3()
              .crossVectors(nWorld, uAxis)
              .normalize();

            const rotY = new THREE.Matrix4().makeRotationY(Math.PI / 2);
            uAxis.applyMatrix4(rotY);
            vAxis.applyMatrix4(rotY);
            nWorld.applyMatrix4(rotY);

            let uMin = Infinity,
              uMax = -Infinity,
              vMin = Infinity,
              vMax = -Infinity;
            const rel = new THREE.Vector3();
            const vW = new THREE.Vector3();
            const refW = box.getCenter(new THREE.Vector3());
            const pos = page.geometry.attributes.position;
            for (let i = 0; i < pos.count; i++) {
              vW.fromBufferAttribute(pos, i).applyMatrix4(page.matrixWorld);
              rel.subVectors(vW, refW);
              const u = rel.dot(uAxis);
              const v = rel.dot(vAxis);
              uMin = Math.min(uMin, u);
              uMax = Math.max(uMax, u);
              vMin = Math.min(vMin, v);
              vMax = Math.max(vMax, v);
            }
            const uMid = (uMin + uMax) * 0.5;
            const vMid = (vMin + vMax) * 0.5;
            const centerW = refW
              .clone()
              .addScaledVector(uAxis, uMid)
              .addScaledVector(vAxis, vMid);

            uMin = Infinity;
            uMax = -Infinity;
            vMin = Infinity;
            vMax = -Infinity;
            for (let i = 0; i < pos.count; i++) {
              vW.fromBufferAttribute(pos, i).applyMatrix4(page.matrixWorld);
              rel.subVectors(vW, centerW);
              const u = rel.dot(uAxis);
              const v = rel.dot(vAxis);
              uMin = Math.min(uMin, u);
              uMax = Math.max(uMax, u);
              vMin = Math.min(vMin, v);
              vMax = Math.max(vMax, v);
            }

            const sortedBox = [boxSize.x, boxSize.y, boxSize.z].sort(
              (a, b) => b - a,
            );
            const depth = Math.max(sortedBox[2] * 5, 0.18);
            const orientation = new THREE.Euler();
            orientation.setFromRotationMatrix(
              new THREE.Matrix4().makeBasis(uAxis, vAxis, nWorld),
            );
            const edgePad = 1.06;
            const pageW = Math.max(uMax - uMin, 0.02) * edgePad;
            const pageH = Math.max(vMax - vMin, 0.02) * edgePad;
            const decalSize = new THREE.Vector3(pageW, pageH, depth);

            const decalGeo = new DecalGeometry(
              page,
              centerW,
              orientation,
              decalSize,
            );
            const posAttr = decalGeo.getAttribute("position");
            if (!posAttr || posAttr.count === 0) {
              console.warn(
                "[office] bookLeftPage decal geometry empty — check projector size/orientation.",
              );
              decalGeo.dispose();
              return;
            }
            decalGeo.applyMatrix4(page.matrixWorld.clone().invert());

            const decal = new THREE.Mesh(
              decalGeo,
              new THREE.MeshStandardMaterial({
                map: tex,
                color: 0xffffff,
                roughness: 0.85,
                metalness: 0,
                polygonOffset: true,
                polygonOffsetFactor: -6,
                polygonOffsetUnits: -1,
                depthWrite: true,
                side: THREE.DoubleSide,
              }),
            );
            decal.name = "bookLeftPageDecal";
            decal.renderOrder = 6;
            // Same dark-mode desk light as the right page (it loads after that was set up, so it missed it).
            patchDeskRestoreMaterial(decal.material);
            decal.material.emissiveMap = tex;
            decal.material.emissive.setHex(0xffffff);
            decal.material.emissiveIntensity = BOOK_LEFT_PAGE.emissiveIntensity;
            page.add(decal);
            applyTextureAnisotropyToRoot(decal);
            scheduleRebuildBloomDarkenLists();
          },
          undefined,
          (err) => console.warn("bookLeftPage.jpg decal failed:", err),
        );
      }

      const _bookDecalTexCache = new Map();
      let _bookDecalBuildGen = 0;

      function removeBookPageDecal(page, decalChildName) {
        const existing = page.getObjectByName(decalChildName);
        if (!existing) return;
        existing.geometry?.dispose();
        existing.material?.dispose();
        page.remove(existing);
      }

      function buildBookPageDecalMesh(
        model,
        page,
        tex,
        meshName,
        decalChildName,
        rotYRadians,
        fineRotateRadians,
        rotationMode = "worldY",
        sizeScale = 1,
        worldOffset = null,
      ) {
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.center.set(0.5, 0.5);
        tex.rotation = 0;
        tex.needsUpdate = true;

        model.updateMatrixWorld(true);
        page.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(page);
        if (box.isEmpty()) return;
        const boxSize = box.getSize(new THREE.Vector3());

        let nrm = page.geometry.attributes.normal;
        if (!nrm) {
          page.geometry.computeVertexNormals();
          nrm = page.geometry.attributes.normal;
        }
        const nLocal = new THREE.Vector3();
        const nTmp = new THREE.Vector3();
        for (let i = 0; i < nrm.count; i++) {
          nTmp.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
          nLocal.add(nTmp);
        }
        if (nLocal.lengthSq() < 1e-12) return;
        nLocal.normalize();
        const nWorld = nLocal
          .clone()
          .transformDirection(page.matrixWorld)
          .normalize();

        const up = new THREE.Vector3(0, 1, 0);
        const uAxis = new THREE.Vector3().crossVectors(up, nWorld);
        if (uAxis.lengthSq() < 1e-10) {
          uAxis.crossVectors(new THREE.Vector3(1, 0, 0), nWorld);
        }
        uAxis.normalize();
        const vAxis = new THREE.Vector3()
          .crossVectors(nWorld, uAxis)
          .normalize();

        if (rotationMode === "surfaceNormal") {
          const rotN = new THREE.Matrix4().makeRotationAxis(
            nWorld,
            rotYRadians,
          );
          uAxis.applyMatrix4(rotN);
          vAxis.applyMatrix4(rotN);
          if (fineRotateRadians !== 0) {
            const rotFine = new THREE.Matrix4().makeRotationAxis(
              nWorld,
              fineRotateRadians,
            );
            uAxis.applyMatrix4(rotFine);
            vAxis.applyMatrix4(rotFine);
          }
        } else {
          const rotY = new THREE.Matrix4().makeRotationY(rotYRadians);
          uAxis.applyMatrix4(rotY);
          vAxis.applyMatrix4(rotY);
          nWorld.applyMatrix4(rotY);
          if (fineRotateRadians !== 0) {
            const rotN = new THREE.Matrix4().makeRotationAxis(
              nWorld,
              fineRotateRadians,
            );
            uAxis.applyMatrix4(rotN);
            vAxis.applyMatrix4(rotN);
          }
        }

        let uMin = Infinity,
          uMax = -Infinity,
          vMin = Infinity,
          vMax = -Infinity;
        const rel = new THREE.Vector3();
        const vW = new THREE.Vector3();
        const refW = box.getCenter(new THREE.Vector3());
        const pos = page.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          vW.fromBufferAttribute(pos, i).applyMatrix4(page.matrixWorld);
          rel.subVectors(vW, refW);
          const u = rel.dot(uAxis);
          const v = rel.dot(vAxis);
          uMin = Math.min(uMin, u);
          uMax = Math.max(uMax, u);
          vMin = Math.min(vMin, v);
          vMax = Math.max(vMax, v);
        }
        const uMid = (uMin + uMax) * 0.5;
        const vMid = (vMin + vMax) * 0.5;
        const centerW = refW
          .clone()
          .addScaledVector(uAxis, uMid)
          .addScaledVector(vAxis, vMid);
        if (worldOffset) centerW.add(worldOffset);

        uMin = Infinity;
        uMax = -Infinity;
        vMin = Infinity;
        vMax = -Infinity;
        for (let i = 0; i < pos.count; i++) {
          vW.fromBufferAttribute(pos, i).applyMatrix4(page.matrixWorld);
          rel.subVectors(vW, centerW);
          const u = rel.dot(uAxis);
          const v = rel.dot(vAxis);
          uMin = Math.min(uMin, u);
          uMax = Math.max(uMax, u);
          vMin = Math.min(vMin, v);
          vMax = Math.max(vMax, v);
        }

        const sortedBox = [boxSize.x, boxSize.y, boxSize.z].sort(
          (a, b) => b - a,
        );
        const depth = Math.max(sortedBox[2] * 5, 0.18);
        const orientation = new THREE.Euler();
        orientation.setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(uAxis, vAxis, nWorld),
        );
        const edgePad = 1.06;
        const pageW = Math.max(uMax - uMin, 0.02) * edgePad * sizeScale;
        const pageH = Math.max(vMax - vMin, 0.02) * edgePad * sizeScale;
        const decalSize = new THREE.Vector3(pageW, pageH, depth);

        const decalGeo = new DecalGeometry(
          page,
          centerW,
          orientation,
          decalSize,
        );
        const posAttr = decalGeo.getAttribute("position");
        if (!posAttr || posAttr.count === 0) {
          console.warn(
            `[office] ${meshName} decal geometry empty — check projector size/orientation.`,
          );
          decalGeo.dispose();
          return;
        }
        decalGeo.applyMatrix4(page.matrixWorld.clone().invert());

        const decal = new THREE.Mesh(
          decalGeo,
          new THREE.MeshStandardMaterial({
            map: tex,
            color: 0xffffff,
            roughness: 0.85,
            metalness: 0,
            polygonOffset: true,
            polygonOffsetFactor: -6,
            polygonOffsetUnits: -1,
            depthWrite: true,
            side: THREE.DoubleSide,
          }),
        );
        decal.name = decalChildName;
        decal.renderOrder = 6;
        page.add(decal);
        applyTextureAnisotropyToRoot(decal);
        scheduleRebuildBloomDarkenLists();
      }

      function setupBookPageDecal(
        model,
        meshName,
        textureUrl,
        decalChildName,
        rotYRadians = Math.PI / 2,
        fineRotateRadians = 0,
        rotationMode = "worldY",
        sizeScale = 1,
        worldOffset = null,
      ) {
        const page = model.getObjectByName(meshName);
        if (!page?.isMesh || !page.geometry) return;
        removeBookPageDecal(page, decalChildName);
        const buildGen = ++_bookDecalBuildGen;

        const finish = (sourceTex) => {
          if (buildGen !== _bookDecalBuildGen) return;
          const tex = sourceTex.clone();
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.flipY = true;
          buildBookPageDecalMesh(
            model,
            page,
            tex,
            meshName,
            decalChildName,
            rotYRadians,
            fineRotateRadians,
            rotationMode,
            sizeScale,
            worldOffset,
          );
        };

        const cached = _bookDecalTexCache.get(textureUrl);
        if (cached) {
          finish(cached);
          return;
        }

        new THREE.TextureLoader().load(
          officeAsset(textureUrl),
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.flipY = true;
            _bookDecalTexCache.set(textureUrl, tex);
            finish(tex);
          },
          undefined,
          (err) =>
            console.warn(`${textureUrl} decal failed for ${meshName}:`, err),
        );
      }

      function setupBookRightPageDecal(model) {
        setupBookPageDecal(
          model,
          "bookRightPage",
          "bookRightPage-2k.jpg",
          "bookRightPageDecal",
          Math.PI / 2,
          0,
          "surfaceNormal",
          0.9801,
          new THREE.Vector3(0, 0, -0.03),
        );
      }

      /** Rebuild right-page decal after editing rotation in code. Left page is left unchanged. */
      window.refreshBookPageDecals = () => {
        if (!_officeWorldRoot) return;
        setupBookRightPageDecal(_officeWorldRoot);
      };

      function setupTechDesignerMagnetDecal(model) {
        const mesh = model.getObjectByName("techDesignerMagnet");
        if (!mesh?.isMesh || !mesh.geometry) {
          console.warn("[office] techDesignerMagnet not found; decal skipped.");
          return;
        }
        const existingDecal = mesh.getObjectByName("techDesignerMagnetDecal");
        if (existingDecal) {
          existingDecal.geometry?.dispose();
          if (existingDecal.material) {
            const idx = _techDesignerMagnetDecals.findIndex(
              (e) => e.material === existingDecal.material,
            );
            if (idx >= 0) _techDesignerMagnetDecals.splice(idx, 1);
            existingDecal.material.dispose();
          }
          mesh.remove(existingDecal);
        }

        new THREE.TextureLoader().load(
          officeAsset("techDesignerMagnet-2k.jpg"),
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.flipY = true;
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
            tex.center.set(0.5, 0.5);
            tex.needsUpdate = true;

            model.updateMatrixWorld(true);
            mesh.updateMatrixWorld(true);

            const box = new THREE.Box3().setFromObject(mesh);
            if (box.isEmpty()) return;
            const boxSize = box.getSize(new THREE.Vector3());

            const nWorld = new THREE.Vector3(0, 1, 0)
              .transformDirection(mesh.matrixWorld)
              .normalize();

            const refUp = new THREE.Vector3(0, 0, 1);
            let uAxis = new THREE.Vector3().crossVectors(refUp, nWorld);
            if (uAxis.lengthSq() < 1e-10) {
              refUp.set(0, 1, 0);
              uAxis.crossVectors(refUp, nWorld);
            }
            uAxis.normalize();
            const vAxis = new THREE.Vector3()
              .crossVectors(nWorld, uAxis)
              .normalize();

            const rotFaceX = new THREE.Matrix4().makeRotationAxis(
              nWorld,
              (Math.PI * 3) / 2,
            );
            uAxis.applyMatrix4(rotFaceX);
            vAxis.applyMatrix4(rotFaceX);

            let nrm = mesh.geometry.attributes.normal;
            if (!nrm) {
              mesh.geometry.computeVertexNormals();
              nrm = mesh.geometry.attributes.normal;
            }

            let uMin = Infinity,
              uMax = -Infinity,
              vMin = Infinity,
              vMax = -Infinity;
            const rel = new THREE.Vector3();
            const vW = new THREE.Vector3();
            const nTmp = new THREE.Vector3();
            const refW = box.getCenter(new THREE.Vector3());
            const pos = mesh.geometry.attributes.position;
            for (let i = 0; i < pos.count; i++) {
              nTmp.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
              if (nTmp.y < 0.55) continue;
              vW.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
              rel.subVectors(vW, refW);
              const u = rel.dot(uAxis);
              const v = rel.dot(vAxis);
              uMin = Math.min(uMin, u);
              uMax = Math.max(uMax, u);
              vMin = Math.min(vMin, v);
              vMax = Math.max(vMax, v);
            }
            if (!Number.isFinite(uMin) || !Number.isFinite(vMin)) return;

            const uMid = (uMin + uMax) * 0.5;
            const vMid = (vMin + vMax) * 0.5;
            const centerW = refW
              .clone()
              .addScaledVector(uAxis, uMid)
              .addScaledVector(vAxis, vMid);

            uMin = Infinity;
            uMax = -Infinity;
            vMin = Infinity;
            vMax = -Infinity;
            for (let i = 0; i < pos.count; i++) {
              nTmp.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
              if (nTmp.y < 0.55) continue;
              vW.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
              rel.subVectors(vW, centerW);
              const u = rel.dot(uAxis);
              const v = rel.dot(vAxis);
              uMin = Math.min(uMin, u);
              uMax = Math.max(uMax, u);
              vMin = Math.min(vMin, v);
              vMax = Math.max(vMax, v);
            }

            const sortedBox = [boxSize.x, boxSize.y, boxSize.z].sort(
              (a, b) => b - a,
            );
            const depth = Math.max(sortedBox[2] * 5, 0.12);
            const orientation = new THREE.Euler();
            orientation.setFromRotationMatrix(
              new THREE.Matrix4().makeBasis(uAxis, vAxis, nWorld),
            );
            const edgePad = 1.04;
            const sizeScale = 1.14;
            const pageW = Math.max(uMax - uMin, 0.02) * edgePad * sizeScale;
            const pageH = Math.max(vMax - vMin, 0.02) * edgePad * sizeScale;
            const decalSize = new THREE.Vector3(pageW, pageH, depth);

            const decalGeo = new DecalGeometry(
              mesh,
              centerW,
              orientation,
              decalSize,
            );
            const posAttr = decalGeo.getAttribute("position");
            if (!posAttr || posAttr.count === 0) {
              console.warn(
                "[office] techDesignerMagnet decal geometry empty — check projector size/orientation.",
              );
              decalGeo.dispose();
              return;
            }
            const uvAttr = decalGeo.getAttribute("uv");
            if (uvAttr) {
              for (let i = 0; i < uvAttr.count; i++) {
                uvAttr.setX(i, 1 - uvAttr.getX(i));
              }
            }
            decalGeo.applyMatrix4(mesh.matrixWorld.clone().invert());

            const decalMat = new THREE.MeshStandardMaterial({
              map: tex,
              color: 0xffffff,
              emissive: 0xffffff,
              emissiveMap: tex,
              emissiveIntensity: 0,
              roughness: 0.85,
              metalness: 0,
              polygonOffset: true,
              polygonOffsetFactor: -6,
              polygonOffsetUnits: -1,
              depthWrite: true,
              side: THREE.DoubleSide,
            });
            const decal = new THREE.Mesh(decalGeo, decalMat);
            decal.name = "techDesignerMagnetDecal";
            decal.renderOrder = 6;
            mesh.add(decal);
            _techDesignerMagnetDecals.push({
              material: decalMat,
              darkIntensity: 0.62,
              brightIntensity: 0,
            });
            applyTextureAnisotropyToRoot(decal);
            scheduleRebuildBloomDarkenLists();
          },
          undefined,
          (err) =>
            console.warn("[office] techDesignerMagnet.jpg decal failed:", err),
        );
      }

      function setupPlantGroundTexture(model) {
        let ground = model.getObjectByName("plantGround.001");
        if (!ground?.isMesh) {
          model.traverse((node) => {
            if (ground?.isMesh) return;
            if (node.isMesh && node.name && node.name.includes("plantGround")) {
              ground = node;
            }
          });
        }
        if (!ground?.isMesh) {
          console.warn(
            "[office] plantGround.001 not found; ground texture skipped.",
          );
          return;
        }

        ground.visible = true;
        ground.frustumCulled = false;
        ground.userData.skipBloomDarken = true;
        ground.renderOrder = 10;

        const geo = ground.geometry.clone();
        if (!geo.boundingBox) geo.computeBoundingBox();
        const bb = geo.boundingBox;
        const spanX = Math.max(bb.max.x - bb.min.x, 1e-6);
        const spanZ = Math.max(bb.max.z - bb.min.z, 1e-6);
        const pos = geo.attributes.position;
        const uvs = new Float32Array(pos.count * 2);
        const uvScale = 1.65;
        for (let i = 0; i < pos.count; i++) {
          let u = (pos.getX(i) - bb.min.x) / spanX;
          let v = 1 - (pos.getZ(i) - bb.min.z) / spanZ;
          u = 0.5 + (u - 0.5) * uvScale;
          v = 0.5 + (v - 0.5) * uvScale;
          uvs[i * 2] = u;
          uvs[i * 2 + 1] = v;
        }
        geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
        ground.geometry = geo;

        const mat = new THREE.MeshBasicMaterial({
          color: 0x5c5c5c,
          side: THREE.DoubleSide,
          depthWrite: true,
          depthTest: true,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -2,
        });
        applyPlantGroundStencilMask(mat);
        ground.material = mat;

        new THREE.TextureLoader().load(
          officeAsset("plant-ground-texture.jpg"),
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.flipY = false;
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(uvScale, uvScale);
            tex.center.set(0.5, 0.5);
            tex.needsUpdate = true;
            mat.map = tex;
            mat.color.setHex(0x5c5c5c);
            mat.side = THREE.DoubleSide;
            mat.needsUpdate = true;
            applyTextureAnisotropyToRoot(ground);
          },
          undefined,
          (err) =>
            console.warn("[office] plant-ground-texture.jpg failed:", err),
        );
        scheduleRebuildBloomDarkenLists();
      }

      function applyPlant1GreenMaterial(model) {
        const part = model.getObjectByName("plant1");
        if (!part) return;
        const greenHex = 0x4a9d5c;
        part.traverse((node) => {
          if (node.name === "plant1LeafSprites") return;
          if (!node.isMesh) return;
          const opts = {
            color: greenHex,
            roughness: 0.72,
            metalness: 0.02,
          };
          if (Array.isArray(node.material)) {
            node.material = node.material.map(
              () => new THREE.MeshStandardMaterial(opts),
            );
          } else {
            node.material = new THREE.MeshStandardMaterial(opts);
          }
        });
      }

      function createSeededRng(seed) {
        let state = seed >>> 0;
        return () => {
          state = (state + 0x6d2b79f5) >>> 0;
          let t = Math.imul(state ^ (state >>> 15), 1 | state);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }

      function setupPlant1LeafSprites(model) {
        const plant1 = model.getObjectByName("plant1");
        if (!plant1) {
          console.warn("[office] plant1 not found; leaf sprites skipped.");
          return;
        }
        if (plant1.getObjectByName("plant1LeafSprites")) return;
        model.updateMatrixWorld(true);
        plant1.updateMatrixWorld(true);
        const bbox = new THREE.Box3().setFromObject(plant1);
        if (bbox.isEmpty()) return;

        const leafGroup = new THREE.Group();
        leafGroup.name = "plant1LeafSprites";
        plant1.add(leafGroup);

        const centerW = bbox.getCenter(new THREE.Vector3());
        const sizeW = bbox.getSize(new THREE.Vector3());
        const baseSpan = Math.max(sizeW.x, sizeW.z, sizeW.y * 0.55);
        const boxMin = bbox.min.clone();
        const boxMax = bbox.max.clone();

        new THREE.TextureLoader().load(
          officeAsset("leaf.png"),
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.flipY = true;
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;

            const mat = new THREE.MeshBasicMaterial({
              map: tex,
              transparent: false,
              opacity: 1,
              side: THREE.DoubleSide,
              depthWrite: true,
            });
            mat.customProgramCacheKey = () => "plant1LeafMat";
            mat.onBeforeCompile = (shader) => {
              shader.fragmentShader = shader.fragmentShader.replace(
                "#include <map_fragment>",
                `
#include <map_fragment>
float _leafLum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
if ( _leafLum < 0.06 ) discard;
diffuseColor.a = 1.0;
`,
              );
            };
            const geo = new THREE.PlaneGeometry(1, 1);
            const nLeaves = 90;
            const rand = createSeededRng(1337);
            const _anchorW = new THREE.Vector3();
            const _up = new THREE.Vector3(0, 1, 0);
            const _qBase = new THREE.Quaternion();
            const _qTwist = new THREE.Quaternion();
            const _topOffPlantLocal = new THREE.Vector3();
            const _stemUp = new THREE.Vector3();
            const _wv = new THREE.Vector3();
            const _blendIn = new THREE.Vector3();
            const _jitterW = new THREE.Vector3();

            const randomUnitSphere = (target) => {
              const u = rand();
              const v = rand();
              const theta = 2 * Math.PI * u;
              const cosPhi = 2 * v - 1;
              const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
              target.set(
                sinPhi * Math.cos(theta),
                sinPhi * Math.sin(theta),
                cosPhi,
              );
              return target;
            };

            const randomPointInBox = (target) => {
              target.set(
                boxMin.x + rand() * (boxMax.x - boxMin.x),
                boxMin.y + rand() * (boxMax.y - boxMin.y),
                boxMin.z + rand() * (boxMax.z - boxMin.z),
              );
              return target;
            };

            plant1.updateMatrixWorld(true);
            const plantVertWorld = [];
            plant1.traverse((node) => {
              if (!node.isMesh || !node.geometry?.attributes?.position) return;
              const pos = node.geometry.attributes.position;
              const mw = node.matrixWorld;
              const step = pos.count > 30000 ? 3 : pos.count > 15000 ? 2 : 1;
              for (let i = 0; i < pos.count; i += step) {
                _wv.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mw);
                plantVertWorld.push(_wv.x, _wv.y, _wv.z);
              }
            });

            let nv = (plantVertWorld.length / 3) | 0;
            const sortAxis = 1;
            const tNorm = new Float32Array(nv > 0 ? nv : 0);
            let coordMin = 0;
            let coordMax = 1;
            if (nv > 0) {
              coordMin = Infinity;
              coordMax = -Infinity;
              for (let k = 0; k < nv; k++) {
                const c = plantVertWorld[k * 3 + sortAxis];
                coordMin = Math.min(coordMin, c);
                coordMax = Math.max(coordMax, c);
              }
              const cSpan = coordMax - coordMin + 1e-8;
              for (let k = 0; k < nv; k++) {
                tNorm[k] =
                  (plantVertWorld[k * 3 + sortAxis] - coordMin) / cSpan;
              }
            }
            const leafAnchorVerts = [];
            const centroidW = new THREE.Vector3();
            if (nv > 0) {
              let cx = 0,
                cy = 0,
                cz = 0;
              for (let j = 0; j < plantVertWorld.length; j += 3) {
                cx += plantVertWorld[j];
                cy += plantVertWorld[j + 1];
                cz += plantVertWorld[j + 2];
              }
              centroidW.set(cx / nv, cy / nv, cz / nv);
            } else {
              centroidW.copy(centerW);
            }

            const buildPlantLeafAnchors = () => {
              leafAnchorVerts.length = 0;
              if (nv <= 0) return;
              const used = new Uint8Array(nv);
              const minDistSq = new Float32Array(nv);
              minDistSq.fill(Infinity);

              let seedK = 0;
              for (let k = 1; k < nv; k++) {
                const ky = plantVertWorld[k * 3 + 1];
                const sy = plantVertWorld[seedK * 3 + 1];
                if (ky < sy) seedK = k;
              }
              leafAnchorVerts.push(seedK);
              used[seedK] = 1;
              minDistSq[seedK] = 0;

              const updateMinDist = (fromK) => {
                const fi = fromK * 3;
                const fx = plantVertWorld[fi];
                const fy = plantVertWorld[fi + 1];
                const fz = plantVertWorld[fi + 2];
                for (let k = 0; k < nv; k++) {
                  if (used[k]) continue;
                  const vi = k * 3;
                  const dx = plantVertWorld[vi] - fx;
                  const dy = plantVertWorld[vi + 1] - fy;
                  const dz = plantVertWorld[vi + 2] - fz;
                  const d2 = dx * dx + dy * dy + dz * dz;
                  if (d2 < minDistSq[k]) minDistSq[k] = d2;
                }
              };
              updateMinDist(seedK);

              while (leafAnchorVerts.length < nLeaves) {
                let bestK = -1;
                let bestD2 = -1;
                for (let k = 0; k < nv; k++) {
                  if (used[k]) continue;
                  if (minDistSq[k] > bestD2) {
                    bestD2 = minDistSq[k];
                    bestK = k;
                  }
                }
                if (bestK < 0) break;
                leafAnchorVerts.push(bestK);
                used[bestK] = 1;
                minDistSq[bestK] = 0;
                updateMinDist(bestK);
              }

              while (leafAnchorVerts.length < nLeaves) {
                leafAnchorVerts.push(
                  leafAnchorVerts[
                    (leafAnchorVerts.length * 17 + 3) % leafAnchorVerts.length
                  ],
                );
              }
            };

            const computeLeafOutward = (vertK, target) => {
              const vi = vertK * 3;
              target.set(
                plantVertWorld[vi] - centroidW.x,
                plantVertWorld[vi + 1] - centroidW.y,
                plantVertWorld[vi + 2] - centroidW.z,
              );
              if (target.lengthSq() < 1e-10) target.set(0, 1, 0);
              else target.normalize();
              const t = tNorm[vertK] ?? 0.5;
              target.lerp(_up, Math.max(0, t - 0.42) * 0.35).normalize();
              return target;
            };

            buildPlantLeafAnchors();

            // All leaves render as one InstancedMesh (was 90 meshes → 90 draw calls per pass); `mesh` is a transform proxy.
            const leafInstances = new THREE.InstancedMesh(geo, mat, nLeaves);
            const mesh = new THREE.Object3D();
            for (let i = 0; i < nLeaves; i++) {
              let vertK = -1;
              if (nv > 0) {
                vertK = leafAnchorVerts[i];
                const vi = vertK * 3;
                _anchorW.set(
                  plantVertWorld[vi],
                  plantVertWorld[vi + 1],
                  plantVertWorld[vi + 2],
                );
              } else {
                randomPointInBox(_anchorW);
              }

              if (nv > 0 && vertK >= 0) {
                _blendIn.copy(centroidW).sub(_anchorW);
                if (_blendIn.lengthSq() < 1e-10) randomUnitSphere(_blendIn);
                else _blendIn.normalize();
                randomUnitSphere(_stemUp);
                const mixR = 0.68 + rand() * 0.32;
                _stemUp
                  .multiplyScalar(mixR)
                  .addScaledVector(_blendIn, 1 - mixR)
                  .normalize();
                computeLeafOutward(vertK, _jitterW);
                _stemUp.lerp(_jitterW, 0.12 + rand() * 0.18).normalize();
              } else {
                _stemUp.set(0, 1, 0);
              }

              const s = 0.3 + rand() * 0.75;
              const w = baseSpan * 0.102 * s;
              const aspect = 1.32 + rand() * 0.34;
              const h = w * aspect;
              mesh.scale.set(w, h, 1);

              _qBase.setFromUnitVectors(_up, _stemUp);
              _qTwist.setFromAxisAngle(_stemUp, rand() * Math.PI * 2);
              mesh.quaternion.copy(_qBase).premultiply(_qTwist);

              plant1.worldToLocal(mesh.position.copy(_anchorW));
              _topOffPlantLocal
                .set(0, h * 0.5, 0)
                .applyQuaternion(mesh.quaternion);
              mesh.position.sub(_topOffPlantLocal);

              mesh.updateMatrix();
              leafInstances.setMatrixAt(i, mesh.matrix);
            }
            leafInstances.instanceMatrix.needsUpdate = true;
            leafInstances.computeBoundingSphere();
            leafGroup.add(leafInstances);
            applyTextureAnisotropyToRoot(leafGroup);
            scheduleRebuildBloomDarkenLists();
          },
          undefined,
          (err) => console.warn("[office] leaf.png failed to load:", err),
        );
      }


      /**
       * office-scene1.gltf export fixes (the file lost these compared with embed94):
       * - the figure (musa, material all_Low_Alon_001) lost its colour texture
       *   (TEX_color): the same image, saved from embed94, is put back;
       * - SVGMat / SVGMat.001 (cone stripes, wixLogo, certifiedTitle) lost their
       *   PBR values, so glTF's defaults made them fully metallic: back to the
       *   embed94 values (not metallic, roughness 0.4).
       */
      const OFFICE_EXPORT_FIX = {
        musaColorMap: { material: "all_Low_Alon_001", file: "musa-color-2k.jpg" },
        svgMaterials: { names: ["SVGMat", "SVGMat.001"], metalness: 0, roughness: 0.4 },
      };
      function fixOfficeSceneExport(model) {
        const F = OFFICE_EXPORT_FIX;
        const seen = new Set();
        model.traverse((node) => {
          if (!node.isMesh) return;
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          for (const m of mats) {
            if (!m || seen.has(m)) continue;
            seen.add(m);
            if (F.svgMaterials.names.includes(m.name) && m.isMeshStandardMaterial) {
              m.metalness = F.svgMaterials.metalness;
              m.roughness = F.svgMaterials.roughness;
              m.needsUpdate = true;
            }
            if (m.name === F.musaColorMap.material && !m.map) {
              // Attached right away (the image fills in when it arrives): the office
              // later swaps the figure's material and copies this map across.
              const tex = new THREE.TextureLoader().load(officeAsset(F.musaColorMap.file));
              tex.flipY = false; // as the GLTFLoader sets up its own textures
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
              m.map = tex;
              m.needsUpdate = true;
            }
          }
        });
      }

      function modelHasNamedPart(model, name) {
        let found = false;
        model.traverse((node) => {
          if (node.name === name) found = true;
        });
        return found;
      }

      /**
       * Small parts missing from the embed94 export, taken from embed93 (same
       * placement): the duck's pupils (eyePupleLeft / eyePupleRight, for the eye
       * tracking) and the monitors' power LEDs (leftScreenLight / rightScreenLight).
       */
      const OFFICE_EXTRA_PARTS = [
        { file: officeAsset("office-duck-pupils.glb"), names: ["eyePupleLeft", "eyePupleRight"] },
        { file: officeAsset("office-screen-lights.glb"), names: ["leftScreenLight", "rightScreenLight"] },
      ];

      function withDuckPupils(model, done, index = 0) {
        if (index >= OFFICE_EXTRA_PARTS.length) {
          done();
          return;
        }
        const next = () => withDuckPupils(model, done, index + 1);
        const part = OFFICE_EXTRA_PARTS[index];
        const missing = part.names.filter((name) => !modelHasNamedPart(model, name));
        if (!missing.length) {
          next();
          return;
        }
        loader.load(
          part.file,
          (gltf) => {
            gltf.scene.updateMatrixWorld(true);
            model.updateMatrixWorld(true);
            for (const partName of missing) {
              const src = gltf.scene.getObjectByName(partName);
              if (src) model.attach(src);
            }
            model.updateMatrixWorld(true);
            next();
          },
          undefined,
          (err) => {
            console.warn("[office] extra parts GLTF failed:", part.file, err);
            next();
          },
        );
      }

      function applyTextureAlphaFromLuminance(tex, threshold = 20) {
        const image = tex.image;
        if (!image?.width || !image?.height) return;
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = imgData.data;
        for (let i = 0; i < px.length; i += 4) {
          const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
          px[i + 3] = lum < threshold ? 0 : 255;
        }
        ctx.putImageData(imgData, 0, 0);
        tex.image = canvas;
        tex.needsUpdate = true;
      }

      function getStarDecalViewFrom() {
        const viewFrom = new THREE.Vector3();
        if (car && car.position.lengthSq() > 0.01) {
          viewFrom.copy(car.position);
        } else if (
          Number.isFinite(tablePlateCenter.x) &&
          (tablePlateCenter.x !== 0 ||
            tablePlateCenter.y !== 0 ||
            tablePlateCenter.z !== 0)
        ) {
          viewFrom.set(
            tablePlateCenter.x,
            tablePlateCenter.y + 2.5,
            tablePlateCenter.z + 6,
          );
        } else {
          viewFrom.copy(carCamera.position);
        }
        return viewFrom;
      }

      function findStarMesh() {
        for (let i = 0; i < _starInstances.length; i++) {
          const found = _starInstances[i]?.group?.getObjectByName("star");
          if (found?.isMesh) return found;
        }
        let mesh = null;
        scene.traverse((node) => {
          if (!mesh && node.name === "star" && node.isMesh) mesh = node;
        });
        return mesh;
      }


      function buildStarFaceDecalGeometry(mesh, viewFrom) {
        const geo = mesh.geometry;
        const posAttr = geo.attributes.position;
        const nrmAttr = geo.attributes.normal;
        if (!posAttr || !nrmAttr) return null;

        mesh.updateMatrixWorld(true);
        const meshWorldPos = mesh.getWorldPosition(new THREE.Vector3());
        const viewDir = viewFrom.clone().sub(meshWorldPos).normalize();
        const nZWorld = new THREE.Vector3(0, 0, 1).transformDirection(
          mesh.matrixWorld,
        );
        const faceSign = nZWorld.dot(viewDir) >= 0 ? 1 : -1;
        const faceThreshold = 0.85;
        const index = geo.index;
        const triIndices = [];

        function collectTri(ia, ib, ic) {
          if (
            nrmAttr.getZ(ia) * faceSign < faceThreshold ||
            nrmAttr.getZ(ib) * faceSign < faceThreshold ||
            nrmAttr.getZ(ic) * faceSign < faceThreshold
          ) {
            return;
          }
          triIndices.push(ia, ib, ic);
        }

        if (index) {
          for (let i = 0; i < index.count; i += 3) {
            collectTri(index.getX(i), index.getX(i + 1), index.getX(i + 2));
          }
        } else {
          for (let i = 0; i < posAttr.count; i += 3) {
            collectTri(i, i + 1, i + 2);
          }
        }
        if (triIndices.length < 9) return null;

        let uMin = Infinity,
          uMax = -Infinity,
          vMin = Infinity,
          vMax = -Infinity,
          zSum = 0;
        for (let i = 0; i < triIndices.length; i++) {
          const vi = triIndices[i];
          const x = posAttr.getX(vi);
          const y = posAttr.getY(vi);
          const z = posAttr.getZ(vi);
          uMin = Math.min(uMin, x);
          uMax = Math.max(uMax, x);
          vMin = Math.min(vMin, y);
          vMax = Math.max(vMax, y);
          zSum += z;
        }

        const faceW = Math.max(uMax - uMin, 1e-4);
        const faceH = Math.max(vMax - vMin, 1e-4);
        const labelCover = 0.65;
        const faceShiftX = -faceW * 0.11;
        const faceShiftY = -faceH * 0.08;
        const centerLocal = new THREE.Vector3(
          (uMin + uMax) * 0.5 - faceShiftX,
          (vMin + vMax) * 0.5 - faceShiftY,
          zSum / triIndices.length,
        );
        const centerW = centerLocal.clone().applyMatrix4(mesh.matrixWorld);

        let uAxis = new THREE.Vector3(1, 0, 0)
          .transformDirection(mesh.matrixWorld)
          .normalize();
        let vAxis = new THREE.Vector3(0, 1, 0)
          .transformDirection(mesh.matrixWorld)
          .normalize();
        const nWorld = new THREE.Vector3(0, 0, faceSign)
          .transformDirection(mesh.matrixWorld)
          .normalize();

        const rotAxis = new THREE.Vector3(0, 0, -1)
          .transformDirection(mesh.matrixWorld)
          .normalize();
        const rotFace = new THREE.Matrix4().makeRotationAxis(
          rotAxis,
          (2 * Math.PI) / 180,
        );
        uAxis.applyMatrix4(rotFace);
        vAxis.applyMatrix4(rotFace);

        const orientation = new THREE.Euler();
        orientation.setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(uAxis, vAxis, nWorld),
        );

        const pageSize = Math.max(faceW, faceH) * labelCover;
        const depth = Math.max(faceW, faceH) * 0.22;
        const decalGeo = new DecalGeometry(
          mesh,
          centerW,
          orientation,
          new THREE.Vector3(pageSize, pageSize, depth),
        );
        const posAttrDecal = decalGeo.getAttribute("position");
        if (!posAttrDecal || posAttrDecal.count === 0) {
          decalGeo.dispose();
          return null;
        }
        decalGeo.applyMatrix4(mesh.matrixWorld.clone().invert());
        return decalGeo;
      }

      function setupStarDecal(model) {
        const mesh = findStarMesh();
        if (!mesh?.geometry) {
          console.warn("[office] star not found; decal skipped.");
          return;
        }
        const existingDecal = mesh.getObjectByName("starDecal");
        if (existingDecal) {
          existingDecal.geometry?.dispose();
          if (existingDecal.material) {
            const idx = _starDecals.findIndex(
              (e) => e.material === existingDecal.material,
            );
            if (idx >= 0) _starDecals.splice(idx, 1);
            existingDecal.material.dispose();
          }
          mesh.remove(existingDecal);
        }

        new THREE.TextureLoader().load(
          officeAsset("starText.png"),
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.flipY = true;
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
            tex.center.set(0.5, 0.5);
            applyTextureAlphaFromLuminance(tex);

            model.updateMatrixWorld(true);
            mesh.updateMatrixWorld(true);

            const overlayGeo = buildStarFaceDecalGeometry(
              mesh,
              getStarDecalViewFrom(),
            );
            if (!overlayGeo) {
              console.warn(
                "[office] star decal: no front-face triangles found.",
              );
              return;
            }

            const decalMat = new THREE.MeshBasicMaterial({
              map: tex,
              transparent: true,
              alphaTest: 0.5,
              depthWrite: false,
              depthTest: true,
              polygonOffset: true,
              polygonOffsetFactor: -4,
              polygonOffsetUnits: -4,
              side: THREE.FrontSide,
              toneMapped: false,
            });
            const decal = new THREE.Mesh(overlayGeo, decalMat);
            decal.name = "starDecal";
            decal.renderOrder = 20;
            decal.frustumCulled = false;
            decal.userData.skipBloomDarken = true;
            mesh.add(decal);
            applyTextureAnisotropyToRoot(decal);
            scheduleRebuildBloomDarkenLists();
          },
          undefined,
          (err) => console.warn("[office] starText.png decal failed:", err),
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
        console.log("office-scene1.gltf parts:", parts);
        return parts;
      }

      const loader = new GLTFLoader();
      loader.setResourcePath("./");
      loader.load(officeAsset("airPlane2.glb"), (gltf) => {
        const rawScene = gltf.scene;
        rawScene.traverse((node) => {
          if (node.isMesh) {
            if (Array.isArray(node.material)) {
              for (let i = 0; i < node.material.length; i++)
                node.material[i] = airPlaneMaterial;
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
      loader.load(
        officeAsset(OFFICE_SCENE_GLTF),
        (gltf) => {
          logOfficeMeshParts(gltf);
          const model = gltf.scene;
          fixOfficeSceneExport(model);
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
                    "No outdoorBackground in office-scene1.gltf or fallback " +
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
          applyAllGumDispenserMaterials();
          setupBookCoverImages(model);
          setupBookLeftPageDecal(model);
          setupBookRightPageDecal(model);
          setupTechDesignerMagnetDecal(model);
          applyPlant1GreenMaterial(model);
          setupPlant1LeafSprites(model);
          withDuckPupils(model, () => {
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
            function addRampPhysicsFromGLTF(rampObj, entryMode) {
              if (!rampObj) return null;
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
              if (rampVerts.length === 0) return null;
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
              tightenTrimeshAabbQuery(tri);
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
              let entryDir;
              let blockingAxis;
              if (entryMode === "localX") {
                const _q = new THREE.Quaternion();
                rampObj.getWorldQuaternion(_q);
                entryDir = new THREE.Vector3(1, 0, 0)
                  .applyQuaternion(_q)
                  .setY(0);
                if (entryDir.lengthSq() > 1e-6) entryDir.normalize();
                else entryDir.set(0, 0, 1);
                blockingAxis = "z";
              } else {
                const driveParams = computeRampDriveParamsFromGeometry(rampObj);
                entryDir = driveParams
                  ? driveParams.entryDir
                  : new THREE.Vector3(0, 0, 1);
                blockingAxis = driveParams ? driveParams.blockingAxis : "z";
              }
              return { body, entryDir, blockingAxis };
            }
            const leftRamp = addRampPhysicsFromGLTF(rampLeftObject, "localX");
            if (leftRamp) {
              rampLeftBody = leftRamp.body;
              rampLeftEntryDir = leftRamp.entryDir;
              rampLeftBlockingAxis = leftRamp.blockingAxis;
            }
            const backRamp = addRampPhysicsFromGLTF(rampBackObject, "geometry");
            if (backRamp) {
              rampBackBody = backRamp.body;
              rampBackEntryDir = backRamp.entryDir;
              rampBackBlockingAxis = backRamp.blockingAxis;
            }

            function addGumsTankPhysicsTrimesh(obj, wireColor, physScale, doubleSided = false) {
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
              let triInds = inds;
              if (doubleSided) {
                triInds = [];
                for (let i = 0; i < inds.length; i += 3) {
                  triInds.push(inds[i], inds[i + 1], inds[i + 2]);
                  triInds.push(inds[i + 2], inds[i + 1], inds[i]);
                }
              }
              const tri = new CANNON.Trimesh(verts, triInds);
              tri.updateTree();
              tightenTrimeshAabbQuery(tri);
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
              return { body, trimesh: tri };
            }
            const tankResult = addGumsTankPhysicsTrimesh(
              gumsTankPhysicObject,
              0x00ff88,
              GUM_TANK_TRIMESH_SCALE,
            );
            if (tankResult) {
              gumsTankPhysBody = tankResult.body;
              gumsTankTrimesh = tankResult.trimesh;
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
                tightenTrimeshAabbQuery(bodyTri);
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
                console.log("gumsBody physics trimesh added, verts:", nV, "tris:", dblInds.length / 3);
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
                let standRadius = 0;
                let standMinY = Infinity;
                let standMaxY = -Infinity;
                for (let i = 0; i < sVerts.length; i += 3) {
                  standRadius = Math.max(
                    standRadius,
                    Math.hypot(sVerts[i], sVerts[i + 2]),
                  );
                  standMinY = Math.min(standMinY, sVerts[i + 1]);
                  standMaxY = Math.max(standMaxY, sVerts[i + 1]);
                }
                const standHeight = Math.max(0.04, standMaxY - standMinY);
                const standCenterY = cy + (standMinY + standMaxY) * 0.5;
                gumsStandPhysBody = new CANNON.Body({
                  type: CANNON.Body.STATIC,
                  position: new CANNON.Vec3(cx, standCenterY, cz),
                  material: tankMaterial,
                  collisionFilterGroup: PHYS_GROUP_GUMS_STAND,
                  collisionFilterMask: PHYS_GROUP_GUM_SPHERE,
                });
                gumsStandPhysBody.addShape(
                  new CANNON.Cylinder(
                    standRadius,
                    standRadius,
                    standHeight,
                    24,
                  ),
                );
                physicsWorld.addBody(gumsStandPhysBody);
                _debugGumSet.add(gumsStandPhysBody);
                console.log(
                  "gumsStand solid cylinder physics added, verts:",
                  nV,
                  "radius:",
                  standRadius,
                  "height:",
                  standHeight,
                );
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
                tightenTrimeshAabbQuery(rampTri);
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
                console.log("gumsRamp physics trimesh added, verts:", nV, "tris:", rDblInds.length / 3);
              }
            }

            if (gumsTankPhysicObject) {
              model.updateMatrixWorld(true);
              gumsTankPhysicObject.updateMatrixWorld(true);
              const _gv = new THREE.Vector3();
              const tankBounds = computeGumTankBoundsFromPhysicMesh(
                gumsTankPhysicObject,
              );
              const _lb = tankBounds?.outer || null;
              if (tankBounds?.inner && !tankBounds.inner.isEmpty()) {
                console.info(
                  "[gums] inner tank volume from gumsTankPhysic shell thickness",
                );
              } else if (gumsTankInnerObject) {
                console.info("[gums] inner tank volume from gumsTankInner");
              } else {
                console.warn(
                  "[gums] inner tank volume estimated — add wall thickness to gumsTankPhysic or a gumsTankInner mesh",
                );
              }
              if (gumsTankInnerObject) {
                gumsTankInnerObject.traverse((node) => {
                  if (node.isMesh) node.visible = false;
                });
              }

              if (_lb && !_lb.isEmpty()) {
                /** Inset from physic hull AABB (same collider as Cannon trimesh). */
                const padXZ = 0.022;
                const padBottom = 0.012;
                const padTopOpen = 0.085;
                let lx0;
                let lx1;
                let lz0;
                let lz1;
                let lyBottom;
                let lyTop;
                let tWall = 0;
                const innerLb = tankBounds.inner;

                if (innerLb && !innerLb.isEmpty()) {
                  const innerPad = 0.008;
                  lx0 = innerLb.min.x + innerPad;
                  lx1 = innerLb.max.x - innerPad;
                  lz0 = innerLb.min.z + innerPad;
                  lz1 = innerLb.max.z - innerPad;
                  lyBottom = innerLb.min.y + innerPad;
                  lyTop = Math.min(
                    innerLb.max.y - innerPad,
                    _lb.max.y - padTopOpen,
                  );
                } else {
                  lx0 = _lb.min.x + padXZ;
                  lx1 = _lb.max.x - padXZ;
                  lz0 = _lb.min.z + padXZ;
                  lz1 = _lb.max.z - padXZ;
                  lyBottom = _lb.min.y + padBottom;
                  lyTop = _lb.max.y - padTopOpen;
                }

                if (
                  lx1 - lx0 > 0.04 &&
                  lyTop - lyBottom > 0.04 &&
                  lz1 - lz0 > 0.04
                ) {
                  if (!innerLb || innerLb.isEmpty()) {
                    const innerMinDim = Math.min(
                      lx1 - lx0,
                      lyTop - lyBottom,
                      lz1 - lz0,
                    );
                    tWall = THREE.MathUtils.clamp(
                      innerMinDim * 0.145,
                      0.068,
                      0.19,
                    );
                  }

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
                    const floorInset = innerLb ? 0 : tWall;
                    if (lyBottom + floorInset < minInnerFloorTop) {
                      lyBottom = minInnerFloorTop - floorInset;
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
                  if (!innerLb || innerLb.isEmpty()) {
                    const maxLyBottom = lyTop - tWall - 0.04;
                    if (lyBottom > maxLyBottom) lyBottom = maxLyBottom;
                    const innerMinDim = Math.min(
                      lx1 - lx0,
                      lyTop - lyBottom,
                      lz1 - lz0,
                    );
                    lx0 += tWall;
                    lx1 -= tWall;
                    lz0 += tWall;
                    lz1 -= tWall;
                  }

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
                    const wallInset =
                      innerLb && !innerLb.isEmpty() ? 0 : tWall;
                    const cin = wallInset + gumRadiusGlobal * 1.1;
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
                            axisX: (lx0 + cin + (lx1 - cin)) * 0.5,
                            axisZ: (lz0 + cin + (lz1 - cin)) * 0.5,
                            innerR:
                              Math.min(
                                lx1 - cin - (lx0 + cin),
                                lz1 - cin - (lz0 + cin),
                              ) * 0.5,
                          }
                        : null;
                    const pipeProfile = buildGumTankPipeProfile(
                      gumsTankPhysicObject,
                    );
                    if (_gumTankClampLocal && pipeProfile) {
                      _gumTankClampLocal.axisX = pipeProfile.axisX;
                      _gumTankClampLocal.axisZ = pipeProfile.axisZ;
                      _gumTankClampLocal.profY0 = pipeProfile.y0;
                      _gumTankClampLocal.profY1 = pipeProfile.y1;
                      _gumTankClampLocal.radii = pipeProfile.radii;
                      let minInner = Infinity;
                      for (let ri = 0; ri < pipeProfile.radii.length; ri++) {
                        const rr = pipeProfile.radii[ri];
                        if (rr > 0 && rr < minInner) minInner = rr;
                      }
                      if (Number.isFinite(minInner)) {
                        const maxPhysR = minInner * 0.4;
                        if (gumRadiusGlobal > maxPhysR) gumRadiusGlobal = maxPhysR;
                      }
                    }
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
                        shape: new CANNON.Sphere(gumRadiusGlobal),
                        material: gumMaterial,
                        position: new CANNON.Vec3(0, -100, 0),
                        linearDamping: 0.42,
                        angularDamping: 0.55,
                        collisionFilterGroup: PHYS_GROUP_GUM_SPHERE,
                        collisionFilterMask: PHYS_MASK_GUM_SPHERE,
                        allowSleep: true,
                      });
                      body.sleepSpeedLimit = 0.5;
                      body.sleepTimeLimit = 0.2;
                      // Keep every gum visible and physical, but use a lighter
                      // continuous-collision sweep for this dense sphere pile.
                      body.ccdSpeedThreshold = 1.2;
                      body.ccdIterations = 2;
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
                    _gumsSpawnPending = gumBodies.length > 0;
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
          setupPlantGroundTexture(model);
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
              if (perfSettings.shadows) enableMeshCastShadow(node, "table");
            }
          });
          applyPhoneChargerMaterial(model);
          applyPhoneChargerCupMaterial(model);
          applyPhoneChargerLightMaterial(model);
          // Dark mode: these glow brighter against the dark room.
          registerGamingEmissive(phoneChargerLightMaterial, "phoneChargerLight");
          registerGamingEmissive(headphonesLightMaterial, "headphonesLight");
          registerGamingEmissive(roomLightMaterial, "roomLight");
          applyScreenLightsMaterial(model);
          applyTableControlParts(model);
          applyTableControlScreenMaterial(model);
          applyPenMaterials(model);
          applyDuckMaterials(model);
          applyHeadphonesMaterials(model);
          applyWallShadowCasters(model);
          setupEyeTracking(model);
          applyAllGumDispenserMaterials();
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
            setupMusaAnimation(model);
          } catch (e) {
            console.warn("musa animation setup failed:", e);
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
            applyAllGumDispenserMaterials();
          } catch (e) {
            console.warn("GumDispenser physics setup failed:", e);
          }
          setupAllPropPhysics(model);
          if (_propMeshes["mainScreensPin"]) _propMeshes["mainScreensPin"].visible = true;
          if (_propMeshes["mainScreensBase"]) _propMeshes["mainScreensBase"].visible = true;
          try {
            applyConusMaterials(model);
            setupConusPhysics(model);
          } catch (e) {
            console.warn("Conus physics setup failed:", e);
          }
          try {
            setupStarPhysics(model);
          } catch (e) {
            console.warn("Star physics setup failed:", e);
          }
          try {
            setupStarDecal(model);
          } catch (e) {
            console.warn("Star decal setup failed:", e);
          }
          try {
            applyTableKnockableShadows(model);
            refreshTableSideWallShadows(model);
          } catch (e) {
            console.warn("Table knockable shadows failed:", e);
          }
          try {
            setupDrawerGroup(model);
          } catch (e) {
            console.warn("Drawer group setup failed:", e);
          }

          const _hideNames = [
            "certifiedBodyPhysic", "GumDispenserAllPhysic", "bottlePhisic",
            "dockingStationPhysic", "plantVasePhysic", "macScreenFramePhysic",
            "macBodyBasePhysic", "conusPhysic", "conusPhysic1", "conusPhysic2", "conusPhysic3", "starPhysic",
            "musaPhysic", "duckBodyPhysic", "panHolderPhysic",
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
              configureTableShadowCamera();
            }
            if (tablePlateMesh) tablePlateMesh.receiveShadow = false;
            setupCarShadowPlane(size, tableCenter, tableTopY);
            try {
              refreshAllSceneShadows();
            } catch (e) {
              console.warn("Scene shadow setup failed:", e);
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
            try {
              finalizeStarOnTable();
              finalizeGumDispenserOnTable();
              if (_gumsSpawnPending) spawnAllGumsIntoTank();
              applyTableKnockableShadows(model);
            } catch (e) {
              console.warn("Prop table placement failed:", e);
            }
            const carGltfPath = "./car-game14.glb";
            const installCarFromGltf = (carGltf) => {
                car.visible = false;
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
                      node._brakeMat = makeCarLightMaterial({
                        color: 0xff0000,
                        emissive: 0xff0000,
                        emissiveIntensity: 8.0,
                        roughness: 0.2,
                      });
                      node._offMat = node.material.clone();
                      node._offMat.emissive = new THREE.Color(0x440000);
                      node._offMat.emissiveIntensity = 1.1;
                      node._offMat._isCarLightMaterial = true;
                      node._offMat._baseEmissiveIntensity = 1.1;
                      node._offMat.envMapIntensity = 0;
                      node._offMat.toneMapped = true;
                      node.material = node._offMat;
                      car.userData.brakeLightMesh = node;
                      node.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
                    }
                    if (node.name === "lightBar1") {
                      node.material = makeCarLightMaterial({
                        color: 0xff0000,
                        emissive: 0xff0000,
                        emissiveIntensity: 18.0,
                        roughness: 0.15,
                      });
                      node.material._bloomGlow = BLOOM_EMISSIVE.lightBar; // above the bloom threshold
                      node.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
                    }
                    if (node.name === "frontLights") {
                      node.material = makeCarLightMaterial({
                        color: 0xffffff,
                        emissive: 0xffffff,
                        emissiveIntensity: 6.5,
                        roughness: 0.3,
                      });
                      node.layers.enable(CAR_LIGHTS_BLOOM_LAYER);
                    }
                    if (node.name === "rearLights") {
                      node.material = makeCarLightMaterial({
                        color: 0xff0000,
                        emissive: 0xff0000,
                        emissiveIntensity: 2.0,
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
                          if (n.material) {
                            n.material._isCarLightMaterial = true;
                            if (n.material._baseEmissiveIntensity === undefined) {
                              n.material._baseEmissiveIntensity =
                                n.material.emissiveIntensity;
                            }
                            n.material.envMapIntensity = 0;
                            n.material.toneMapped = true;
                          }
                        }
                      });
                      _lbParent.add(clone);
                    }
                  }
                }

                car.add(carScene);
                scheduleRebuildBloomDarkenLists();
                setupExhaustEffects(carScene);
                setupTableLightReflections(car);
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
                car.position.set(tableCenter.x, tableTopY, tableCenter.z);
                car.quaternion.identity();
                car.updateMatrixWorld(true);
                const _carBox = new THREE.Box3().setFromObject(car);
                carBottomOffsetY = Math.max(0, tableTopY - _carBox.min.y);
                carWheelBottomOffsetY = carBottomOffsetY;
                tableMinY = tableTopY + Math.max(0.05, carBottomOffsetY * 0.5);
                tableSpawn.set(
                  tableCenter.x,
                  tableTopY + carBottomOffsetY,
                  tableCenter.z + 5,
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
                if (
                  Number.isFinite(lowestWheelBottom) &&
                  lowestWheelBottom < tableSurfaceY
                ) {
                  const lift = tableSurfaceY - lowestWheelBottom;
                  car.position.y += lift;
                  tableSpawn.y = car.position.y;
                  carBottomOffsetY = car.position.y - tableTopY;
                  carWheelBottomOffsetY = carBottomOffsetY;
                  tableMinY =
                    tableTopY + Math.max(0.05, carBottomOffsetY * 0.5);
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
                rebuildBloomDarkenObjectLists();
                applyCarLightEmissiveForTier();
                if (sceneBloomEnabled) renderCarLightsBloomComposer();
                _carBloomReady = true;
                car.visible = true;
                attachCarHeadTailSpotLights();
                setupOfficeGameplayCamera();
                applyPerformanceShadowPolicy(car);
                applyCastShadowsToObject3D(car, "both");
                try {
                  refreshAllSceneShadows();
                } catch (e) {
                  console.warn("Scene shadow refresh after car load failed:", e);
                }
                if (_currentWorldModel) {
                  try {
                    refreshTableSideWallShadows(_currentWorldModel);
                  } catch (e) {
                    console.warn("Table side wall shadows refresh failed:", e);
                  }
                }
            };
            loader.load(
              officeAsset(carGltfPath),
              installCarFromGltf,
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
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const lookAt = car.position.clone();
          placeCarViewCameras(lookAt, maxDim);
          getCarCameraLookAtPoint(_carMatrixLookAt);
          controls.target.copy(_carMatrixLookAt);
          syncCarOrbitCamAnglesFromPosition(carCamera);
          configureOrbitControlsForCarView(carCamera);
          // After every material is assigned: the desk objects keep the backup's dark-mode light.
          setupGamingDeskLighting(model);
          applyTextureAnisotropyToRoot(model);
          scheduleRebuildBloomDarkenLists();
          });
        },
        undefined,
        (err) => {
          console.error("[office] office-scene1.gltf failed to load:", err);
        },
      );

      /** The monitors' videos start once the level is ready (until then they show their dark placeholder). */
      function startScreenVideos() {
        for (const v of [leftScreenVideo, rightScreenVideo]) {
          if (!v || !v.dataset.src || v.src) continue;
          v.preload = "auto";
          v.src = v.dataset.src;
          v.play().catch(() => {});
        }
      }

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
        if (perfScreenVideoEvery > 1) {
          _perfScreenVideoFrame++;
          if (_perfScreenVideoFrame % perfScreenVideoEvery !== 0) return;
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
        let pr = getRenderPixelRatio();
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
        if (updateDrawerCarTransition()) return;
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
        const _speedBeforeBlocks = carState.speed;
        _gdKnockedThisCarStep = false;
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
            carState.speed = 0;
          }
        }
        if (!carFalling && handPhisicsMesh) {
          const carR = Math.max(halfW, halfL) * storedCarScale;
          for (let _handPass = 0; _handPass < 4; _handPass++) {
            if (!resolveCarHandPhysicsBlock(carR)) break;
            _handCarTouchedThisFrame = true;
          }
        }
        if (!carFalling) {
          const carR = Math.max(halfW, halfL) * storedCarScale;
          syncCarWheelWorldPositions();
          const propBodiesToBlock = [
            dockingStationPhysBody, plantVasePhysBody, macScreenFramePhysBody,
            macBodyBasePhysBody, mainScreensPinPhysBody, mainScreensBasePhysBody,
            musaPhysBody, duckBodyPhysBody, panHolderPhysBody,
            gumDispenserPhysBody,
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

                if (pb === macScreenFramePhysBody) {
                  if (resolveCarMacScreenFrame(he, bx, by, bz, carR)) {
                    anyOverlap = true;
                  }
                  continue;
                }
                if (pb === gumDispenserPhysBody) {
                  if (resolveCarGumDispenserBox(he, bx, by, bz, carR)) {
                    anyOverlap = true;
                    const justOpened = unfreezeKnockableBody(gumDispenserPhysBody);
                    if (!_gdKnockedThisCarStep) {
                      _gdKnockedThisCarStep = true;
                      knockGumDispenserFromCar(_speedBeforeBlocks, justOpened);
                    }
                  }
                  continue;
                }

                if (Math.abs(dy) >= he.y + carR) continue;

                const propTop = by + he.y;
                const carBottom = car.position.y - carBottomOffsetY;
                if (carBottom >= propTop - 0.05) continue;
                const stepHeight = propTop - carBottom;
                const allowDriveOnto =
                  pb._driveableStep != null &&
                  stepHeight > 0 &&
                  stepHeight <= pb._driveableStep &&
                  (pb === macBodyBasePhysBody ||
                    anyWheelOverlapsPropXZ(he, bx, bz));

                if (isCyl) {
                  const distXZ = Math.sqrt(dx * dx + dz * dz);
                  const combinedR = he.x + carR;
                  if (distXZ >= combinedR) continue;
                  const overlap = combinedR - distXZ;
                  if (overlap <= 0) continue;
                  if (allowDriveOnto) continue;

                  anyOverlap = true;
                  if (distXZ > 0.001) {
                    car.position.x += (dx / distXZ) * overlap;
                    car.position.z += (dz / distXZ) * overlap;
                  }
                  carState.speed = 0;
                } else {
                  const overlapsXZ =
                    pb === macBodyBasePhysBody
                      ? propXZOverlap(
                          pb,
                          he,
                          bx,
                          bz,
                          car.position.x,
                          car.position.z,
                          carR,
                        )
                      : Math.abs(dx) < he.x + carR &&
                        Math.abs(dz) < he.z + carR;
                  if (!overlapsXZ) continue;
                  const overlapX = he.x + carR - Math.abs(dx);
                  const overlapZ = he.z + carR - Math.abs(dz);
                  if (overlapX <= 0 && pb !== macBodyBasePhysBody) continue;
                  if (overlapZ <= 0 && pb !== macBodyBasePhysBody) continue;
                  if (allowDriveOnto) continue;

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
          if (Math.abs(carState.speed) > 0.04) {
            const _knockR = Math.max(halfW, halfL) * storedCarScale;
            if (bottlePhysBody && knockableOverlapsCar(bottlePhysBody, _knockR)) {
              unfreezeKnockableBody(bottlePhysBody);
            }
            if (certifiedPhysBody && knockableOverlapsCar(certifiedPhysBody, _knockR)) {
              unfreezeKnockableBody(certifiedPhysBody);
            }
            if (gumDispenserPhysBody && knockableOverlapsCar(gumDispenserPhysBody, _knockR)) {
              unfreezeKnockableBody(gumDispenserPhysBody);
            }
          }
        }
        if (!carFalling) {
          _carFrontAxleSurfY = tableSurfaceY;
          _carRearAxleSurfY = tableSurfaceY;
          _carGroundSurfY = tableSurfaceY;
          const _propSurf = [
            dockingStationPhysBody, plantVasePhysBody, macBodyBasePhysBody,
            mainScreensPinPhysBody, mainScreensBasePhysBody,
          ];
          const _wheels = [wheelFL, wheelFR, wheelRL, wheelRR];
          const _wSurfY = [tableSurfaceY, tableSurfaceY, tableSurfaceY, tableSurfaceY];
          _carAnyWheelOnRamp = false;
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
                const onMac = pb === macBodyBasePhysBody;
                const wheelR = onMac ? wr + 0.22 * storedCarScale : wr;
                if (onMac) {
                  if (!propXZOverlap(pb, he, bx, bz, wx, wz, wheelR)) continue;
                } else {
                  if (Math.abs(wx - bx) >= he.x + wr) continue;
                  if (Math.abs(wz - bz) >= he.z + wr) continue;
                }
                const propTop = by + he.y;
                if (pb._driveableStep != null) {
                  if (propTop > _wSurfY[wi]) _wSurfY[wi] = propTop;
                  continue;
                }
                const wheelBottom = _wheelSyncWorldPos[wi].y - wr;
                if (wheelBottom < propTop - 0.08) continue;
                if (propTop > _wSurfY[wi]) _wSurfY[wi] = propTop;
              }
            }
            if (rampLeftObject) {
              const rampHit = sampleRampDriveHitAt(
                wx,
                car.position.y,
                wz,
                rampLeftObject,
              );
              if (rampHit) {
                _carAnyWheelOnRamp = true;
                if (rampHit.y > _wSurfY[wi]) _wSurfY[wi] = rampHit.y;
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
          _rampJumpCamRestOffset.set(0, 0, 0);
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
                const onMacLand = pb === macBodyBasePhysBody;
                if (onMacLand) {
                  if (
                    !propXZOverlap(
                      pb,
                      he,
                      bx,
                      bz,
                      car.position.x,
                      car.position.z,
                      _carRLand,
                    )
                  ) {
                    continue;
                  }
                } else {
                  if (Math.abs(car.position.x - bx) >= he.x + _carRLand) continue;
                  if (Math.abs(car.position.z - bz) >= he.z + _carRLand) continue;
                }
                const propTop = by + he.y;
                const carBottom = car.position.y - carBottomOffsetY;
                const onMacStep = canClimbDriveablePropStep(pb, propTop, carBottom);
                if (
                  !onMacStep &&
                  (carBottom < propTop - 0.12 || carBottom > propTop + 0.12)
                ) {
                  continue;
                }
                if (onMacStep && carBottom > propTop + 0.1) continue;
                if (propTop + carBottomOffsetY > _landOnY) {
                  _landOnY = propTop + carBottomOffsetY;
                }
              }
            }
          }
          if (car.position.y < _landOnY) {
            car.position.y = _landOnY;
            carState.velY = 0;
          }
        } else if (wasOnRamp && car.position.y > tableSpawn.y + 0.2 * storedCarScale) {
          carState.velY = -0.5;
        } else {
          const surfDelta = _carFrontAxleSurfY - _carRearAxleSurfY;
          const maxAxleY = Math.max(_carFrontAxleSurfY, _carRearAxleSurfY);
          const unevenSurface = _carSurfRange > CAR_STEP_SURF_DELTA_MIN;
          let _restOnY = tableSpawn.y;
          if (unevenSurface || _carAnyWheelOnRamp) {
            _restOnY =
              (_carWheelSurfY[0] +
                _carWheelSurfY[1] +
                _carWheelSurfY[2] +
                _carWheelSurfY[3]) *
                0.25 +
              carBottomOffsetY;
            if (_carAnyWheelOnRamp) _restOnY += RAMP_SURFACE_CLEARANCE;
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
                const onMacRest = pb === macBodyBasePhysBody;
                if (onMacRest) {
                  if (
                    !propXZOverlap(
                      pb,
                      he,
                      bx,
                      bz,
                      car.position.x,
                      car.position.z,
                      _carRRest,
                    )
                  ) {
                    continue;
                  }
                } else {
                  if (Math.abs(car.position.x - bx) >= he.x + _carRRest) continue;
                  if (Math.abs(car.position.z - bz) >= he.z + _carRRest) continue;
                }
                const propTop = by + he.y;
                const carBottom = car.position.y - carBottomOffsetY;
                if (carBottom >= propTop - 0.05) {
                  const surfY = propTop + carBottomOffsetY;
                  if (surfY > _restOnY) _restOnY = surfY;
                }
              }
            }
          }
          const stepClimbing = unevenSurface || _carAnyWheelOnRamp;
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
      }

      let airPlaneModel = null;
      const airPlaneMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        toneMapped: true,
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

        console.log("airPlane path built from tablePlate:", corners, "totalLen:", airPlaneFlight.totalLen);
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

      /** A gum leaving the bottom hole: a random sideways push, so they spread out over the table. */
      function kickExitedGum(body) {
        const G = GUM_TABLE;
        const vx = body.velocity.x;
        const vz = body.velocity.z;
        const base = vx * vx + vz * vz > 0.25 ? Math.atan2(vz, vx) : Math.random() * Math.PI * 2;
        const a = base + (Math.random() - 0.5) * 2 * THREE.MathUtils.degToRad(G.spreadDeg);
        const speed = G.exitKick.min + Math.random() * (G.exitKick.max - G.exitKick.min);
        body.velocity.x += Math.cos(a) * speed;
        body.velocity.z += Math.sin(a) * speed;
      }

      /**
       * After each physics step: gums on the table never below its top (the car
       * is kinematic, so a gum pressed between it and the static table was
       * pushed through the top; lifted back, the solver pushes it out sideways),
       * and turned back softly at the table's edge.
       */
      function protectGumsOnTable() {
        if (!Number.isFinite(tablePlateHalfX) || !gumsAddedCount) return false;
        let lifted = false;
        const G = GUM_TABLE;
        const top = getTableTopY();
        const r = gumRadiusGlobal;
        const cx = tablePlateCenter.x;
        const cz = tablePlateCenter.z;
        const edgeX = tablePlateHalfX - r * G.edgeMargin;
        const edgeZ = tablePlateHalfZ - r * G.edgeMargin;
        const minY = top + r * (1 - G.sinkTolerance);
        for (let i = 0; i < gumsAddedCount; i++) {
          const b = gumBodies[i];
          if (!b._exitedGumTank) continue;
          const dx = b.position.x - cx;
          const dz = b.position.z - cz;
          if (Math.abs(dx) > tablePlateHalfX || Math.abs(dz) > tablePlateHalfZ) continue; // off the table
          const y = b.position.y;
          if (y < top - G.plateThickness) continue; // already fell past the table
          if (y < minY) {
            b.position.y = top + r;
            if (b.velocity.y < 0) b.velocity.y = 0;
            if (b.type === CANNON.Body.STATIC) b.aabbNeedsUpdate = true;
            lifted = true;
          }
          if (b.type !== CANNON.Body.DYNAMIC || y > top + r * 3) continue;
          if (Math.abs(dx) > edgeX && dx * b.velocity.x > 0) b.velocity.x *= -G.edgeBounce;
          if (Math.abs(dz) > edgeZ && dz * b.velocity.z > 0) b.velocity.z *= -G.edgeBounce;
        }
        return lifted;
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

      /** Keep gums inside the gumsTankPhysic pipe. Top hole stays open; only the bottom hole is an exit. */
      function clampGumsInsideTankLocalAabb(gentle) {
        const c = _gumTankClampLocal;
        if (!c || !gumsTankPhysicObject || gumsAddedCount < 1) return;
        const tankMw = _gumTankMwCached;
        const r = gumRadiusGlobal;
        const axisX = c.axisX != null ? c.axisX : (c.minX + c.maxX) * 0.5;
        const axisZ = c.axisZ != null ? c.axisZ : (c.minZ + c.maxZ) * 0.5;
        const exitY = c.minY + r * 0.35;
        _gumTankQuat.setFromRotationMatrix(tankMw);
        _gumTankInvQuat.copy(_gumTankQuat).invert();
        for (let i = 0; i < gumsAddedCount; i++) {
          const body = gumBodies[i];
          if (body._exitedGumTank) continue;
          _gumClampTmp.set(body.position.x, body.position.y, body.position.z);
          _gumClampTmp.applyMatrix4(_invTankMwGumClamp);
          const px = _gumClampTmp.x;
          const py = _gumClampTmp.y;
          const pz = _gumClampTmp.z;
          const dx = px - axisX;
          const dz = pz - axisZ;
          const horiz = Math.hypot(dx, dz);
          const maxHoriz = gumTankMaxHorizAtLocalY(c, py, r);
          const holeR = gumTankMaxHorizAtLocalY(c, exitY, r);
          // After a hit any gum that fits the chute may drop in (the chute's own net keeps it off the walls).
          const inBottomHole = horiz <= holeR || (_gumDispenserBecameDynamic && horiz <= maxHoriz);
          const canLeaveBottom =
            inBottomHole && (gumReleased.has(i) || _gumHitCupOpen);
          // Below the globe the gum is in the chute, still inside the tank; it exits only via the bottom hole.
          if (body._inGumChute && py > exitY + r) {
            body._inGumChute = false;
            body.collisionFilterMask |= PHYS_GROUP_GUMS_RAMP;
          }
          if (!body._inGumChute && canLeaveBottom && py < exitY) {
            body._inGumChute = true;
            if (_gumHitCupOpen) gumReleased.add(i);
          }
          if (body._inGumChute) {
            if (clampGumInsideTankChute(body)) {
              body._inGumChute = false;
              body._exitedGumTank = true;
              body.allowSleep = true; // out of the tank: may rest again
              // Out of the machine: spin dies down like the cup release's gums, so they come to rest.
              body.angularDamping = Math.max(body.angularDamping, GUM_EXITED_ANGULAR_DAMPING);
              kickExitedGum(body);
            }
            continue;
          }
          if (gumsReadyToDrop && py > c.maxY + r * 4) continue;
          if (body.type === CANNON.Body.STATIC && horiz <= maxHoriz) continue;
          let nx = px;
          let ny = py;
          let nz = pz;
          let radialHit = false;
          if (horiz > maxHoriz && horiz > 1e-8) {
            const s = maxHoriz / horiz;
            nx = axisX + dx * s;
            nz = axisZ + dz * s;
            radialHit = true;
          }
          const skipY = canLeaveBottom;
          if (gentle && !skipY) {
            if (ny < c.minY) ny = c.minY;
          } else if (!skipY) {
            ny = THREE.MathUtils.clamp(ny, c.minY, c.maxY);
          } else if (ny < c.minY && py >= exitY) {
            ny = c.minY;
          }
          const clampedY = ny !== py;
          if (!radialHit && !clampedY) continue;
          if (radialHit) {
            _gumVelLocal
              .set(body.velocity.x, body.velocity.y, body.velocity.z)
              .applyQuaternion(_gumTankInvQuat);
            const hl = horiz || 1;
            const radialVel = (_gumVelLocal.x * dx + _gumVelLocal.z * dz) / hl;
            if (radialVel > 0) {
              _gumVelLocal.x -= (dx / hl) * radialVel;
              _gumVelLocal.z -= (dz / hl) * radialVel;
            }
            _gumVelLocal.applyQuaternion(_gumTankQuat);
            body.velocity.x = _gumVelLocal.x;
            body.velocity.y = _gumVelLocal.y;
            body.velocity.z = _gumVelLocal.z;
          }
          if (clampedY) body.velocity.y *= 0.3;
          if (body.type === CANNON.Body.STATIC) {
            body.type = CANNON.Body.DYNAMIC;
            body.mass = 0.5;
            body.updateMassProperties();
          }
          if (body.sleepState === 2) body.wakeUp();
          _gumClampTmp.set(nx, ny, nz);
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
        const axisX = c.axisX != null ? c.axisX : (c.minX + c.maxX) * 0.5;
        const axisZ = c.axisZ != null ? c.axisZ : (c.minZ + c.maxZ) * 0.5;
        const maxHoriz =
          gumTankMaxHorizAtLocalY(c, _gumClampTmp.y, gumRadiusGlobal) + pad;
        const horiz = Math.hypot(_gumClampTmp.x - axisX, _gumClampTmp.z - axisZ);
        return (
          horiz <= maxHoriz &&
          _gumClampTmp.y >= c.minY - pad &&
          _gumClampTmp.y <= c.maxY + pad
        );
      }

      /**
       * A moving static stand can sweep over a table gum between Cannon steps.
       * Eject released gums from the stand footprint so they cannot become
       * rollers underneath the dispenser.
       */
      function ejectReleasedGumsFromUnderStand() {
        if (
          !gumsStandPhysBody ||
          !gumsStandPhysBody.shapes.length ||
          gumReleased.size === 0
        )
          return;
        const standShape = gumsStandPhysBody.shapes[0];
        const standRadius = standShape.radiusTop;
        const standHeight = standShape.height;
        if (!(standRadius > 0) || !(standHeight > 0)) return;

        const sp = gumsStandPhysBody.position;
        const sq = gumsStandPhysBody.quaternion;
        _gumStandQuat.set(sq.x, sq.y, sq.z, sq.w);
        _gumStandInvQuat.copy(_gumStandQuat).invert();
        const safeRadius = standRadius + gumRadiusGlobal * 1.15;
        const halfHeight = standHeight * 0.5;

        for (const gi of gumReleased) {
          const body = gumBodies[gi];
          if (!body || !body._exitedGumTank) continue;
          _gumStandLocalPos
            .set(
              body.position.x - sp.x,
              body.position.y - sp.y,
              body.position.z - sp.z,
            )
            .applyQuaternion(_gumStandInvQuat);
          const lx = _gumStandLocalPos.x;
          const lz = _gumStandLocalPos.z;
          let radial = Math.hypot(lx, lz);
          if (radial >= safeRadius) continue;
          if (
            _gumStandLocalPos.y > halfHeight + gumRadiusGlobal * 0.6 ||
            _gumStandLocalPos.y < -halfHeight - gumRadiusGlobal * 3
          )
            continue;

          let nx;
          let nz;
          if (radial > 1e-6) {
            nx = lx / radial;
            nz = lz / radial;
          } else {
            const angle = gi * 2.399963229728653;
            nx = Math.cos(angle);
            nz = Math.sin(angle);
            radial = 0;
          }
          _gumStandLocalPos.x = nx * safeRadius;
          _gumStandLocalPos.z = nz * safeRadius;
          _gumStandLocalPos.applyQuaternion(_gumStandQuat);
          body.position.x = sp.x + _gumStandLocalPos.x;
          body.position.y = sp.y + _gumStandLocalPos.y;
          body.position.z = sp.z + _gumStandLocalPos.z;

          _gumStandLocalVel
            .set(body.velocity.x, body.velocity.y, body.velocity.z)
            .applyQuaternion(_gumStandInvQuat);
          const inward =
            _gumStandLocalVel.x * nx + _gumStandLocalVel.z * nz;
          if (inward < 0) {
            _gumStandLocalVel.x -= nx * inward;
            _gumStandLocalVel.z -= nz * inward;
          }
          _gumStandLocalVel.applyQuaternion(_gumStandQuat);
          body.velocity.x = _gumStandLocalVel.x;
          body.velocity.y = _gumStandLocalVel.y;
          body.velocity.z = _gumStandLocalVel.z;
          body.aabbNeedsUpdate = true;
          body.wakeUp();
        }
      }

      /**
       * Keep table gums out of the complete dispenser footprint. The outer
       * dispenser box intentionally does not collide with gums, so this cheap
       * correction prevents released gums from becoming wheels underneath it.
       */
      function ejectReleasedGumsFromUnderDispenser() {
        if (
          !gumDispenserPhysBody ||
          !gumDispenserPhysBody.shapes.length ||
          gumReleased.size === 0
        )
          return;
        const shape = gumDispenserPhysBody.shapes[0];
        const he = shape.halfExtents;
        if (!he) return;

        const dp = gumDispenserPhysBody.position;
        const dq = gumDispenserPhysBody.quaternion;
        _gumStandQuat.set(dq.x, dq.y, dq.z, dq.w);
        _gumStandInvQuat.copy(_gumStandQuat).invert();
        const safeX = he.x + gumRadiusGlobal * 1.2;
        const safeZ = he.z + gumRadiusGlobal * 1.2;
        const bottomBandTop = -he.y + gumRadiusGlobal * 3.5;

        for (const gi of gumReleased) {
          const body = gumBodies[gi];
          if (!body || !body._exitedGumTank) continue;
          _gumStandLocalPos
            .set(
              body.position.x - dp.x,
              body.position.y - dp.y,
              body.position.z - dp.z,
            )
            .applyQuaternion(_gumStandInvQuat);
          if (_gumStandLocalPos.y > bottomBandTop) continue;
          if (
            Math.abs(_gumStandLocalPos.x) >= safeX ||
            Math.abs(_gumStandLocalPos.z) >= safeZ
          )
            continue;

          const overlapX = safeX - Math.abs(_gumStandLocalPos.x);
          const overlapZ = safeZ - Math.abs(_gumStandLocalPos.z);
          let nx = 0;
          let nz = 0;
          if (overlapX < overlapZ) {
            nx = Math.sign(_gumStandLocalPos.x || 1);
            _gumStandLocalPos.x = nx * safeX;
          } else {
            nz = Math.sign(_gumStandLocalPos.z || 1);
            _gumStandLocalPos.z = nz * safeZ;
          }

          _gumStandLocalPos.applyQuaternion(_gumStandQuat);
          body.position.x = dp.x + _gumStandLocalPos.x;
          body.position.y = dp.y + _gumStandLocalPos.y;
          body.position.z = dp.z + _gumStandLocalPos.z;

          _gumStandLocalVel
            .set(body.velocity.x, body.velocity.y, body.velocity.z)
            .applyQuaternion(_gumStandInvQuat);
          const inward =
            _gumStandLocalVel.x * nx + _gumStandLocalVel.z * nz;
          if (inward < 0) {
            _gumStandLocalVel.x -= nx * inward;
            _gumStandLocalVel.z -= nz * inward;
          }
          _gumStandLocalVel.applyQuaternion(_gumStandQuat);
          body.velocity.x = _gumStandLocalVel.x;
          body.velocity.y = _gumStandLocalVel.y;
          body.velocity.z = _gumStandLocalVel.z;
          body.aabbNeedsUpdate = true;
          body.wakeUp();
        }
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
        if (_gumDispenserBecameDynamic) passes = Math.min(passes, 2);
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

      /** Per-frame temporaries reused by animate() instead of allocating each frame. */
      const _canonBodyBoxTmp = new THREE.Box3();
      const _flamePosTmp = new THREE.Vector3();
      function animate() {
        if (!_officeSceneRendering) {
          _officeSceneAnimationFrame = 0;
          return;
        }
        _officeSceneAnimationFrame = requestAnimationFrame(animate);
        if (!_tabVisible) return;
        try {
          const rawDt = clock.getDelta();
          let simTimeScale = getRampJumpSlowMoScale();
          const dt = Math.min(rawDt, 0.05) * simTimeScale;
          const nowSec = performance.now() / 1000;
          let gumTankAllStaticThisFrame = false;
          const carDt = 1 / 60;
          let gumsActuallyMoving = gumsReadyToDrop;
          if (!gumsActuallyMoving) {
            for (let gi = 0; gi < gumsAddedCount; gi++) {
              const gb = gumBodies[gi];
              if (
                gb &&
                gb.type === CANNON.Body.DYNAMIC &&
                gb.sleepState !== CANNON.Body.SLEEPING
              ) {
                const gv = gb.velocity;
                const ga = gb.angularVelocity;
                if (
                  gv.x * gv.x + gv.y * gv.y + gv.z * gv.z > 0.01 ||
                  ga.x * ga.x + ga.y * ga.y + ga.z * ga.z > 0.25
                ) {
                  gumsActuallyMoving = true;
                  break;
                }
              }
            }
          }
          const gumsMotionHeavy = gumsActuallyMoving;
          const carStepsNeeded = gumsMotionHeavy
            ? 1
            : Math.min(
                6,
                Math.max(perfMaxCarSteps, Math.ceil(dt / carDt)),
              );
          trackPerformanceFrame(rawDt);
          updateMusaAnimation(Math.min(rawDt, 0.1)); // musa's wave and hip wiggle
          let physicsStepDt = dt;
          const gumsTankBusy =
            gumsReadyToDrop ||
            (gumsAddedCount > 0 &&
              gumReleased.size === 0 &&
              !_gumPrevFrameTankAllStatic);
          if (gumsTankBusy) {
            physicsStepDt = dt;
            _physCoalesceDt = 0;
          } else if (perfPhysicsIdleCoalesce) {
            const carIdle =
              car &&
              carState.velY === 0 &&
              Math.abs(carState.speed) < 0.04 &&
              !keys.forward &&
              !keys.reverse;
            const dispenserActive =
              gumDispenserPhysBody && !gumDispenserPhysBody._frozen;
            const animBusy =
              _handWalkZPhase !== 0 ||
              (_officeArmatureAction && _officeArmatureAction.isRunning());
            if (
              carIdle &&
              _gumPrevFrameTankAllStatic &&
              !gumsReadyToDrop &&
              !dispenserActive &&
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
          // Keep the car at real-time speed during the short, CPU-heavy gum
          // spill. Gum physics retains the conservative 50 ms safety cap.
          const carFrameDt = gumsMotionHeavy
            ? Math.min(rawDt, 0.1) * simTimeScale
            : dt;
          let carTimeLeft = carFrameDt;
          for (let s = 0; s < carStepsNeeded && carTimeLeft > 1e-6; s++) {
            const step = gumsMotionHeavy
              ? carTimeLeft
              : Math.min(carDt, carTimeLeft);
            updateCar(step);
            if (
              carState.velY !== 0 &&
              (jumpInitialVelY > 0.02 || _rampLeftJumpActive)
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
          updateHandWalkTrigger(dt);
          updateEyeTracking();
          if (
            _officeAnimMixer &&
            _officeArmatureAction &&
            (_officeArmatureAction.isRunning() || _handWalkZPhase !== 0)
          ) {
            _officeAnimMixer.update(dt);
          }
          syncHandPhysics();
          updateCupSlide();
          updateGumHitCupHide();
          try {
            updateDrawerAnimation();
          } catch (err) {
            logDrawerErrorOnce("drawer animation", err);
          }
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
                const jitter = gumRadiusGlobal * 0.75;
                b.position.set(
                  col.x + (Math.random() - 0.5) * jitter,
                  gumsDropTopY,
                  col.z + (Math.random() - 0.5) * jitter,
                );
                b.velocity.set(0, 0, 0);
                b.angularVelocity.set(0, 0, 0);
                b.force.set(0, 0, 0);
                b.torque.set(0, 0, 0);
                if (b.type === CANNON.Body.STATIC) {
                  b.type = CANNON.Body.DYNAMIC;
                  b.mass = 0.5;
                  b.updateMassProperties();
                }
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
              const cbCenter = _canonBodyBoxTmp.setFromObject(canonBodyMesh).getCenter(_canonWorldPos);
              canonBodyMesh.getWorldQuaternion(_canonWorldQuat);
              const MAX_CAR_PHYS_VEL = 12;
              let cvx = (_canonWorldPos.x - canonBodyPhys.position.x) * _syncInvDt;
              let cvy = (_canonWorldPos.y - canonBodyPhys.position.y) * _syncInvDt;
              let cvz = (_canonWorldPos.z - canonBodyPhys.position.z) * _syncInvDt;
              const cvSpd = Math.sqrt(cvx * cvx + cvy * cvy + cvz * cvz);
              if (cvSpd > MAX_CAR_PHYS_VEL) {
                const cvScale = MAX_CAR_PHYS_VEL / cvSpd;
                cvx *= cvScale; cvy *= cvScale; cvz *= cvScale;
              }
              canonBodyPhys.velocity.set(cvx, cvy, cvz);
              canonBodyPhys.position.set(cbCenter.x, cbCenter.y, cbCenter.z);
              canonBodyPhys.quaternion.set(_canonWorldQuat.x, _canonWorldQuat.y, _canonWorldQuat.z, _canonWorldQuat.w);
              canonBodyPhys.aabbNeedsUpdate = true;
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
              ];
              let minX = Infinity, minY = Infinity, minZ = Infinity;
              let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
              let anyCarWakeBody = false;
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
                anyCarWakeBody = true;
                if (cpx - wxH < minX) minX = cpx - wxH;
                if (cpy - wyH < minY) minY = cpy - wyH;
                if (cpz - wzH < minZ) minZ = cpz - wzH;
                if (cpx + wxH > maxX) maxX = cpx + wxH;
                if (cpy + wyH > maxY) maxY = cpy + wyH;
                if (cpz + wzH > maxZ) maxZ = cpz + wzH;
              }
              if (anyCarWakeBody) {
                for (let gi = 0; gi < _gumLimit; gi++) {
                  const gb = gumBodies[gi];
                  if (!gb) continue;
                  if (gb.type === CANNON.Body.DYNAMIC && gb.sleepState !== CANNON.Body.SLEEPING) continue;
                  const px = gb.position.x;
                  const py = gb.position.y;
                  const pz = gb.position.z;
                  if (
                    px >= minX && px <= maxX &&
                    py >= minY && py <= maxY &&
                    pz >= minZ && pz <= maxZ
                  ) {
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
              !gumsReadyToDrop && gumReleased.size === 0 ? 0.45 : 0.82;
            const gumDampingWhileFilling = gumsReadyToDrop
              ? 0.08
              : (_gumDispenserBecameDynamic ? 0.02 : gumDampAfterFill);
            const maxGumSpd = 12;
            const maxFallSpd = GUM_FALL_SPEED_CAP;
            const dispenserLive =
              _gumDispenserBecameDynamic &&
              gumDispenserPhysBody &&
              !gumDispenserPhysBody._frozen;
            const gdVel = dispenserLive ? gumDispenserPhysBody.velocity : null;
            const gdAng = dispenserLive
              ? gumDispenserPhysBody.angularVelocity
              : null;
            const gdPos = dispenserLive ? gumDispenserPhysBody.position : null;
            for (let gi = 0; gi < gumsAddedCount; gi++) {
              const gb = gumBodies[gi];
              if (gb.type === CANNON.Body.STATIC) continue;
              const releasedGum = Boolean(gb._exitedGumTank || gb._inGumChute);
              const rideTank =
                _gumDispenserBecameDynamic && !gb._exitedGumTank;
              if (gb.type === CANNON.Body.DYNAMIC)
                gb.linearDamping = rideTank
                  ? 0.02
                  : releasedGum
                    ? GUM_RELEASED_LINEAR_DAMPING
                    : gumDampingWhileFilling;
              const v = gb.velocity;
              if (rideTank && gdVel && gdAng && gdPos) {
                const rx = gb.position.x - gdPos.x;
                const ry = gb.position.y - gdPos.y;
                const rz = gb.position.z - gdPos.z;
                const cvx = gdVel.x + gdAng.y * rz - gdAng.z * ry;
                const cvy = gdVel.y + gdAng.z * rx - gdAng.x * rz;
                const cvz = gdVel.z + gdAng.x * ry - gdAng.y * rx;
                let relx = v.x - cvx;
                let rely = v.y - cvy;
                let relz = v.z - cvz;
                const relSpd = Math.sqrt(relx * relx + rely * rely + relz * relz);
                // Chute gums keep the released-gum speed so they still tumble out of the bottom hole.
                const rideCap = gb._inGumChute ? GUM_RELEASED_SPEED_CAP : maxGumSpd;
                if (relSpd > rideCap) {
                  const sc = rideCap / relSpd;
                  relx *= sc;
                  rely *= sc;
                  relz *= sc;
                }
                v.x = cvx + relx;
                v.y = cvy + rely;
                v.z = cvz + relz;
              } else {
                const fallSpeedCap = releasedGum
                  ? GUM_RELEASED_FALL_SPEED_CAP
                  : maxFallSpd;
                const speedCap = releasedGum
                  ? GUM_RELEASED_SPEED_CAP
                  : maxGumSpd;
                if (v.y < -fallSpeedCap) v.y = -fallSpeedCap;
                const spd = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
                if (spd > speedCap) {
                  const sc = speedCap / spd;
                  v.x *= sc;
                  v.y *= sc;
                  v.z *= sc;
                }
              }
            }
            if (_gumDispenserBecameDynamic) syncGumDispenserFromPhysics();
            const fixedStep = _gumDispenserBecameDynamic ? GUM_PHYS_FIXED_STEP_DYNAMIC : GUM_PHYS_FIXED_STEP;
            const maxSub = gumsReadyToDrop
              ? GUM_PHYS_MAX_SUBSTEPS_FILL
              : gumsTankBusy
                ? GUM_PHYS_MAX_SUBSTEPS_MIXED
                : (_gumDispenserBecameDynamic ? perfGumMaxSubstepsDynamic : perfGumMaxSubstepsMixed);
            if (physicsStepDt > 0) {
            const subSteps = Math.min(Math.ceil(physicsStepDt / fixedStep), maxSub);
            const gentleTankClamp = gumsReadyToDrop || gumsTankBusy;
            const gumSepUseImpulse = gumsReadyToDrop;
            let allTankGumsStatic =
              !gumsReadyToDrop &&
              gumReleased.size === 0 &&
              !_gumDispenserBecameDynamic;
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
              if (gumsTankPhysicObject) {
                gumsTankPhysicObject.updateMatrixWorld(true);
                _gumTankMwCached.copy(gumsTankPhysicObject.matrixWorld);
                _invTankMwGumClamp.copy(_gumTankMwCached).invert();
              }
              clampGumsInsideTankLocalAabb(true);
              gumTankAllStaticThisFrame = true;
            } else {
              gumTankAllStaticThisFrame = false;
              if (gumsTankPhysicObject) {
                gumsTankPhysicObject.updateMatrixWorld(true);
                _gumTankMwCached.copy(gumsTankPhysicObject.matrixWorld);
                _invTankMwGumClamp.copy(_gumTankMwCached).invert();
              }
              keepTankGumsAwakeForRelease();
              if (_gumDispenserBecameDynamic) {
                if (_gumTankWallBodies && !anyGumLeftInTank()) retireGumTankThickWalls();
                if (_gumTankWallBodies) {
                  nudgeGumsTowardExit(physicsStepDt);
                  _gumHitPhysAccum = Math.min(
                    _gumHitPhysAccum + physicsStepDt,
                    GUM_HIT_PHYS_FIXED_STEP * GUM_HIT_PHYS_MAX_SUBSTEPS,
                  );
                  while (_gumHitPhysAccum >= GUM_HIT_PHYS_FIXED_STEP) {
                    syncGumDispenserFromPhysics();
                    clampGumsInsideTankLocalAabb(false);
                    physicsWorld.step(GUM_HIT_PHYS_FIXED_STEP);
                    _gumHitPhysAccum -= GUM_HIT_PHYS_FIXED_STEP;
                  }
                } else {
                  // Tank empty: the original step (fine substeps are only needed while gums are inside).
                  syncGumDispenserFromPhysics();
                  clampGumsInsideTankLocalAabb(false);
                  physicsWorld.step(1 / 60, physicsStepDt, 2);
                }
                syncGumDispenserFromPhysics();
                clampGumsInsideTankLocalAabb(false);
                separateOverlappingGumSpheres(gumSepUseImpulse);
                clampGumsInsideTankLocalAabb(false);
                ejectReleasedGumsFromUnderStand();
                ejectReleasedGumsFromUnderDispenser();
              } else {
                for (let si = 0; si < subSteps; si++) {
                  clampGumsInsideTankLocalAabb(gentleTankClamp);
                  physicsWorld.step(fixedStep);
                  if (gumsReadyToDrop) separateOverlappingGumSpheres(gumSepUseImpulse);
                  clampGumsInsideTankLocalAabb(gentleTankClamp);
                }
                clampGumsInsideTankLocalAabb(gentleTankClamp);
              }
            }
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
              maybeEmitGumsTankInitialSettled();
              const _dispenserStillMoving = _gumDispenserBecameDynamic && gumDispenserPhysBody &&
                (Math.abs(gumDispenserPhysBody.velocity.x) > 0.5 ||
                 Math.abs(gumDispenserPhysBody.velocity.y) > 0.5 ||
                 Math.abs(gumDispenserPhysBody.velocity.z) > 0.5);
              if (_gumDispenserBecameDynamic && !_dispenserStillMoving) {
                const dynSettleSpd2 = GUM_EXITED_SLEEP_SPEED * GUM_EXITED_SLEEP_SPEED;
                const dynSettleAng2 = GUM_EXITED_SLEEP_SPIN * GUM_EXITED_SLEEP_SPIN;
                for (let gi = 0; gi < gumsAddedCount; gi++) {
                  const b = gumBodies[gi];
                  if (b.type !== CANNON.Body.DYNAMIC) continue;
                  if (b.sleepState === 2) continue;
                  if (!b._exitedGumTank) continue; // still in the tank: keep flowing to the exit
                  const v = b.velocity;
                  const av = b.angularVelocity;
                  const linSpd2 = v.x * v.x + v.y * v.y + v.z * v.z;
                  const angSpd2 = av.x * av.x + av.y * av.y + av.z * av.z;
                  if (linSpd2 < dynSettleSpd2 && angSpd2 < dynSettleAng2) {
                    if (!b._dynSlowAccum) b._dynSlowAccum = 0;
                    b._dynSlowAccum += dt;
                    if (b._dynSlowAccum >= GUM_EXITED_SLEEP_SEC) {
                      b.velocity.set(0, 0, 0);
                      b.angularVelocity.set(0, 0, 0);
                      // Rest as STATIC (like settled tank gums): a sleeping gum in a pile the
                      // ramp keeps feeding is woken every step. The car still wakes it on contact.
                      b.type = CANNON.Body.STATIC;
                      b.updateMassProperties();
                      b._dynSlowAccum = 0;
                    }
                  } else {
                    b._dynSlowAccum = 0;
                  }
                }
              }
              if (gumReleased.size > 0 && !_gumDispenserBecameDynamic) {
                _gumReleasedTimer += dt;
                const relSettleSpd2 = 0.6 * 0.6;
                const relSettleAng2 = 2.0 * 2.0;
                const relSettleHold = 0.3;
                const REL_FORCE_FREEZE_SEC = 3.0;
                const forceFreeze = _gumReleasedTimer >= REL_FORCE_FREEZE_SEC;
                for (const gi of gumReleased) {
                  const b = gumBodies[gi];
                  if (b.type === CANNON.Body.DYNAMIC) {
                    b.linearDamping = GUM_RELEASED_LINEAR_DAMPING;
                    b.angularDamping = 0.90;
                  }
                }
                const toFreeze = [];
                for (const gi of gumReleased) {
                  const b = gumBodies[gi];
                  if (!b._exitedGumTank) continue; // still in the tank: keeps falling toward the hole
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
          } else {
            physicsWorld.step(1 / 60, physicsStepDt, 3);
          }

          let carOnTable = false;
          let carOnRampY = null;
          let carOnRampObject = null;
          let carOnRampShouldJump = false;
          let frontWheelsOffRamp = false;
          let onRampLeftThisFrame = false;
          const _allCarBodies = [
            canonFLBody, canonFRBody, canonRLBody, canonRRBody, canonBodyPhys,
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
                unfreezeKnockableBody(bottlePhysBody);
              }
            }
            if (certifiedPhysBody && (bi === certifiedPhysBody || bj === certifiedPhysBody)) {
              const other = bi === certifiedPhysBody ? bj : bi;
              if (_allCarBodies.includes(other)) {
                unfreezeKnockableBody(certifiedPhysBody);
              }
            }
          }
          if (car && carState.velY <= 0) {
            const leftRampSample = sampleCarOnRampLeft();
            onRampLeftThisFrame = !!leftRampSample;
            const backRampSample =
              !leftRampSample &&
              sampleCarOnRampFromObject(rampBackObject, {
                relaxDirection: true,
                allowJump: false,
              });
            const rampSample = leftRampSample || backRampSample;
            if (rampSample) {
              carOnRampObject = rampSample.rampObject;
              carOnRampY = rampSample.rampY;
              carRampNormalStored.copy(rampSample.normal);
              if (rampSample.shouldJump) carOnRampShouldJump = true;
              frontWheelsOffRamp = updateFrontWheelsOffRampForRamp(
                carOnRampObject,
              );
            }
          }
          if (
            (rampLeftObject || rampBackObject) &&
            car &&
            carState.speed !== 0 &&
            carState.velY <= 0
          ) {
            const fwdX = Math.sin(carState.angle + carState.driftAngle);
            const fwdZ = Math.cos(carState.angle + carState.driftAngle);
            const moveSign = carState.speed > 0 ? 1 : -1;
            _wallRayDir.set(fwdX * moveSign, 0, fwdZ * moveSign).normalize();
            const wallProbeHeight = car.position.y;
            _wallRayOrigin.set(
              car.position.x,
              wallProbeHeight,
              car.position.z,
            );
            carRampWallRaycaster.set(_wallRayOrigin, _wallRayDir);
            carRampWallRaycaster.far = halfL * storedCarScale + 0.15;
            const wallTargets = carOnRampObject
              ? [carOnRampObject]
              : rampLeftObject
                ? [rampLeftObject]
                : getCarRampRaycastTargets();
            const wallHits = carRampWallRaycaster.intersectObjects(
              wallTargets,
              true,
            );
            if (wallHits.length > 0) {
              const wh = wallHits[0];
              const rampInfo = getCarRampFromHit(wh.object);
              const wn = wh.face
                ? wh.face.normal
                    .clone()
                    .transformDirection(wh.object.matrixWorld)
                    .normalize()
                : null;
              if (wn && isVerticalWallNormalY(wn.y)) {
                const wallEntryDot = rampInfo?.entryDir
                  ? wn.x * rampInfo.entryDir.x + wn.z * rampInfo.entryDir.z
                  : 0;
                const isEntryFace = rampInfo && wallEntryDot > 0.5;
                if (!isEntryFace) {
                  stopCarAgainstWallNormal(wn.x, wn.z);
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
          const leavingLeftRamp = wasOnLeftRamp && !onRampLeftThisFrame;
          if (leavingLeftRamp && carState.velY <= 0) {
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
              if (Math.random() < slowMoRoll && isCarCameraOrbitDefault()) {
                snapshotCarOrbitCamRestPose();
                rollRampJumpSlowMoCameraDrift();
                _rampJumpDidSlowMo = true;
                _rampJumpMatrixActive = false;
                _rampJumpFxBlend = 0;
                _rampJumpFxIn = 0;
                _rampJumpCamRestOffset.set(0, 0, 0);
                startFlameWaveEffect(nowSec);
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
          wasOnLeftRamp = onRampLeftThisFrame;
          if (
            (carOnTable || nowOnRamp) &&
            carState.velY <= 0 &&
            !_rampLeftJumpActive
          ) {
            carState.velY = 0;
          }
          updateRampJumpFxBlend(rawDt);
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
            (_carAnyWheelOnRamp || _carSurfRange > CAR_STEP_SURF_DELTA_MIN)
          ) {
            computeCarGroundNormalFromWheels(_stepTiltUp);
            targetUp = _stepTiltUp;
          } else if (carOnRampY !== null) {
            targetUp = carRampNormalStored;
          }
          if (
            carOnRampY !== null &&
            frontWheelsOffRamp &&
            carOnRampObject === rampLeftObject
          ) {
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
            _rampJumpCamRestOffset.set(0, 0, 0);
            flameEffectsVisible = false;
          }
          const inLandingRecovery = onGround && nowSec < landingRecoveryUntil;
          const rampTiltLerp = CAR_RAMP_TILT_LERP * tiltLerpFactor;
          const stepTiltLerp = CAR_STEP_TILT_LERP * tiltLerpFactor;
          const onStepTransition =
            carState.velY === 0 &&
            (_carSurfRange > CAR_STEP_SURF_DELTA_MIN || _carAnyWheelOnRamp);
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
            const rampRestY =
              (_carWheelSurfY[0] +
                _carWheelSurfY[1] +
                _carWheelSurfY[2] +
                _carWheelSurfY[3]) *
                0.25 +
              carBottomOffsetY +
              RAMP_SURFACE_CLEARANCE;
            car.position.y = Math.max(tableSpawn.y, rampRestY);
            carState.velY = 0;
          }
          lightBlend +=
            (lightBlendTarget - lightBlend) *
            Math.min(1, dt / LIGHT_FADE_DURATION);
          applyLightBlend(lightBlend);
          _portalSceneDarkness = 0;
          renderer.toneMappingExposure = _sceneExposure;
          if (lightBlend > LIGHT_BLEND_TRIS_BRIGHT_THRESHOLD) {
            const targetBlend = compactSpacingActive ? 1 : 0;
            const elapsed = nowSec - compactSpacingAnimStart;
            const t = Math.min(1, elapsed / COMPACT_SPACING_ANIM_DURATION);
            compactSpacingBlend =
              compactSpacingAnimFrom +
              (targetBlend - compactSpacingAnimFrom) * t;
          }
          if (!windowTrisInstanced) buildWindowTrisInstanced();
          let windowTrisChanged = false;
          const windowTrisRotX = (1 - lightBlend) * WINDOW_TRIS_DARK_ROTATION_X;
          for (let i = 0; i < windowTrisMeshes.length; i++) {
            const slat = windowTrisMeshes[i];
            if (slat.rotation.x !== windowTrisRotX) {
              slat.rotation.x = windowTrisRotX;
              windowTrisChanged = true;
            }
            if (
              lightBlend > LIGHT_BLEND_TRIS_BRIGHT_THRESHOLD &&
              windowTrisSlotIndices.length === windowTrisMeshes.length
            ) {
              const spacing =
                WINDOW_TRIS_SPACING +
                (WINDOW_TRIS_COMPACT_SPACING - WINDOW_TRIS_SPACING) *
                  compactSpacingBlend;
              const y = windowTrisBaseYs[i] - windowTrisSlotIndices[i] * spacing;
              if (slat.position.y !== y) {
                slat.position.y = y;
                windowTrisChanged = true;
              }
            }
          }
          if (windowTrisChanged) syncWindowTrisInstances(); // only when the blend/spacing actually moved
          if (phoneChargerCupMesh) {
            phoneChargerCupMesh.getWorldPosition(chargerCupWorldPos);
            const dx = car.position.x - chargerCupWorldPos.x;
            const dz = car.position.z - chargerCupWorldPos.z;
            const touching =
              Math.sqrt(dx * dx + dz * dz) < CHARGER_TOUCH_RADIUS;
            updateChargerEffect(dt, chargerCupWorldPos, touching);
          }
          try {
            updateDrawerCupTrigger(Math.min(rawDt, 0.1));
          } catch (err) {
            logDrawerErrorOnce("charger trigger", err);
          }

          const flameDelayS = FLAME_WAVE_DELAY_MS / 1000;
          const flameDurationS = FLAME_EFFECT_DURATION_MS / 1000;
          const slowMoJumpExhaust =
            _rampJumpDidSlowMo &&
            (Math.abs(carState.velY) > 0.02 || _rampJumpFxBlend > 0.05);
          const _flamePos = _flamePosTmp;
          if (flameEffectsVisible) {
            const flameElapsed = nowSec - flameWaveStartTime;
            const deskWaveEnd =
              Math.max(0, flameEffects.length - 1) * flameDelayS + flameDurationS;
            if (flameElapsed >= deskWaveEnd) {
              flameEffectsVisible = false;
            }
            for (let f = 0; f < flameEffects.length; f++) {
              const ef = flameEffects[f];
              const startAt = f * flameDelayS;
              const endAt = startAt + flameDurationS;
              const showThis =
                flameElapsed >= startAt && flameElapsed < endAt;
              ef.points.visible = showThis;
              ef.trailPoints.visible = showThis;
              ef.trailPoints2.visible = showThis;
              ef.trailPoints3.visible = showThis;
              if (showThis) {
                ef.flameMesh.getWorldPosition(_flamePos);
                const localProgress = (flameElapsed - startAt) / flameDurationS;
                const risePhase = 0.25;
                const easeIn = Math.min(
                  1,
                  (localProgress / risePhase) * (localProgress / risePhase),
                );
                const stretchY = 1 + (1 - easeIn) * 1.4;
                const fadeStart = 0.12;
                const fadeOut = Math.max(
                  0,
                  1 - (localProgress - fadeStart) / (1 - fadeStart),
                );
                ef.points.material.uniforms.uFade.value = fadeOut;
                _flamePos.y +=
                  FLAME_EFFECT_ABOVE + easeIn * FLAME_EFFECT_RISE_DISTANCE;
                ef.points.position.copy(_flamePos);
                ef.trailPoints.position.copy(_flamePos);
                ef.trailPoints.position.y -= 0.7;
                ef.trailPoints.material.uniforms.uFade.value = fadeOut * 0.38;
                ef.trailPoints2.position.copy(_flamePos);
                ef.trailPoints2.position.y -= 1.5;
                ef.trailPoints2.material.uniforms.uFade.value = fadeOut * 0.2;
                ef.trailPoints3.position.copy(_flamePos);
                ef.trailPoints3.position.y -= 2.3;
                ef.trailPoints3.material.uniforms.uFade.value = fadeOut * 0.12;
                ef.points.material.uniforms.uTime.value =
                  clock.getElapsedTime();
                ef.trailPoints.material.uniforms.uTime.value =
                  clock.getElapsedTime();
                ef.trailPoints2.material.uniforms.uTime.value =
                  clock.getElapsedTime();
                ef.trailPoints3.material.uniforms.uTime.value =
                  clock.getElapsedTime();
                for (let i = 0; i < ef.count; i++) {
                  ef.rise[i] += dt * FLAME_EFFECT_RISE_SPEED;
                  if (ef.rise[i] > 1) ef.rise[i] -= 1;
                  const y = ef.rise[i] * 1.1 * stretchY;
                  ef.posAttr.array[i * 3] = ef.spread[i * 2];
                  ef.posAttr.array[i * 3 + 1] = y;
                  ef.posAttr.array[i * 3 + 2] = ef.spread[i * 2 + 1];
                }
                ef.posAttr.needsUpdate = true;
              }
            }
          } else {
            for (let f = 0; f < flameEffects.length; f++) {
              const ef = flameEffects[f];
              ef.points.visible = false;
              ef.trailPoints.visible = false;
              ef.trailPoints2.visible = false;
              ef.trailPoints3.visible = false;
            }
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
          const _carCam1Shake = advanceCarCam1LandingShake(rawDt);
          if (car) {
            getCarCameraLookAtPoint(_carMatrixLookAt);
            controls.target.copy(_carMatrixLookAt);
            if (_carCam1Shake) controls.target.add(_carCam1Shake);
          }

          if (floorPhysBody) {
            const floorBottom = floorPhysBody.position.y - floorPhysBody.shapes[0].halfExtents.y;
            const clampBodies = [
              bottlePhysBody, certifiedPhysBody, gumDispenserPhysBody,
              dockingStationPhysBody, plantVasePhysBody, macScreenFramePhysBody,
              macBodyBasePhysBody, mainScreensPinPhysBody, mainScreensBasePhysBody,
              ..._conusInstances.map((inst) => inst.physBody),
              ..._starInstances.map((inst) => inst.physBody),
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
              if (!gumReleased.has(gi) && isGumInsideTank(gi)) continue;
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
              ..._conusInstances.map((inst) => inst.physBody),
              ..._starInstances.map((inst) => inst.physBody),
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
            for (let pass = 0; pass < 4; pass++) {
              let anyBlock = false;
              if (bottlePhysBody && !bottlePhysBody._frozen) {
                if (resolveKnockableAgainstStaticObstacles(bottlePhysBody)) {
                  anyBlock = true;
                }
                if (
                  resolveKnockableAgainstPhysicMesh(
                    bottlePhysBody,
                    _propMeshes["macScreenFramePhysic"],
                  )
                ) {
                  anyBlock = true;
                }
                if (
                  resolveKnockableAgainstStaticObstacleBody(
                    bottlePhysBody,
                    macScreenFramePhysBody,
                  )
                ) {
                  anyBlock = true;
                }
                if (
                  resolveKnockableAgainstPhysicMesh(
                    bottlePhysBody,
                    _propMeshes["panHolderPhysic"],
                  )
                ) {
                  anyBlock = true;
                }
                if (
                  resolveKnockableAgainstStaticObstacleBody(
                    bottlePhysBody,
                    panHolderPhysBody,
                  )
                ) {
                  anyBlock = true;
                }
              }
              if (gumDispenserPhysBody && !gumDispenserPhysBody._frozen) {
                if (resolveKnockableAgainstStaticObstacles(gumDispenserPhysBody)) {
                  anyBlock = true;
                }
              }
              if (certifiedPhysBody && !certifiedPhysBody._frozen) {
                if (resolveKnockableAgainstStaticObstacles(certifiedPhysBody)) {
                  anyBlock = true;
                }
              }
              for (let si = 0; si < _starInstances.length; si++) {
                const starBody = _starInstances[si]?.physBody;
                if (!starBody || starBody._frozen) continue;
                if (resolveKnockableAgainstStaticObstacles(starBody)) {
                  anyBlock = true;
                }
              }
              for (let ci = 0; ci < _conusInstances.length; ci++) {
                const conusBody = _conusInstances[ci]?.physBody;
                if (!conusBody || conusBody._frozen) continue;
                if (resolveKnockableAgainstStaticObstacles(conusBody)) {
                  anyBlock = true;
                }
              }
              if (!anyBlock) break;
            }
          }

          protectKnockables();
          syncBottleFromPhysics();
          syncCertifiedFromPhysics();
          syncGumDispenserFromPhysics();
          syncAllPropsFromPhysics();
          syncConusFromPhysics();
          if (_starInstances.length) {
            _perfStarPlaceFrame++;
            const starBusy =
              Math.abs(carState.speed) > 0.35 ||
              (car && carState.velY !== 0) ||
              perfTierIndex <= 1;
            if (starBusy || _perfStarPlaceFrame % 2 === 0) placeStarOnTableVisual();
            syncStarFromPhysics();
          }
          const _dispenserMoving = _gumDispenserBecameDynamic && gumDispenserPhysBody && !gumDispenserPhysBody._frozen;
          const _skipGumInstSync =
            gumsAddedCount > 0 &&
            gumTankAllStaticThisFrame &&
            _gumPrevFrameTankAllStatic &&
            !_dispenserMoving;
          const _gumsLifted = protectGumsOnTable();
          if (!_skipGumInstSync || gumsTankBusy || _gumsLifted) syncGumInstancedTransforms();
          _gumPrevFrameTankAllStatic = gumTankAllStaticThisFrame;

          syncSceneShadows();

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
            if (_carCam1Shake)
              carCamera.position.addScaledVector(_carCam1Shake, 0.78);
            if (_carCam1LandShakeTime <= 0 && !isCarCameraMatrixOrbitActive()) {
              enforceCarCameraMinDistance();
            }
            if (isCarCameraJumpEffectActive()) {
              applyCarCameraLookAtCar();
            }
          }
          // The mouse drag's offset (its own orbit controls' mouse rotate / pan are replaced by it on desktop).
          if (officeCameraDrag.desktop && controls) {
            controls.enableRotate = false;
            controls.enablePan = false;
          }
          officeCameraDrag.update(Math.min(rawDt, 0.1));
          if (car) officeCameraDrag.apply(camera, getCarCameraLookAtPoint(_officeDragTarget));
          // Intro: its camera only for this frame's render (camera 1 is restored right after).
          updateOfficeSceneReady();
          const introPose = updateOfficeIntro(rawDt);
          if (introPose) officeIntro.applyCamera(introPose);
          updateDeskRestore(camera);
          updateDeskSurfaceFill(camera);
          updateDarkFills(camera);
          // Shadow refresh due this frame; each pass below that changes materials/visibility gets its own refresh.
          const shadowRefresh = renderer.shadowMap.needsUpdate;
          if (sceneBloomEnabled) {
            setCarLightsEmissiveForMainPass(false);
            renderCarLightsBloomComposer();
            renderer.shadowMap.needsUpdate = shadowRefresh; // bloom pass swapped in dark materials
            setCarLightsEmissiveForMainPass(true);
            carBloomMixPass.material.uniforms.bloomTexture.value =
              bloomComposer.readBuffer.texture;
            carBloomMixPass.material.uniforms.bloomIntensity.value =
              _carBloomReady ? getCarBloomMixIntensity() : 0;
          } else {
            carBloomMixPass.material.uniforms.bloomIntensity.value = 0;
          }
          updateTableLightReflections();
          renderMacFrontCameraFeed();
          if (shadowRefresh && macScreenMesh && macScreenMesh.castShadow)
            renderer.shadowMap.needsUpdate = true; // mac pass hid the screen
          finalComposer.render();
          if (_officeWarmupUnculled.length) endOfficeWarmupUncull();
          if (sceneBloomEnabled) setCarLightsEmissiveForMainPass(false);
          officeIntro.restoreCamera();
          officeCameraDrag.restore(camera);
        } catch (e) {
          if (_officeWarmupUnculled.length) endOfficeWarmupUncull();
          officeIntro.restoreCamera();
          officeCameraDrag.restore(camera);
          console.error("Animate error:", e);
        }
      }
      /** The page calls this once its loader is gone: the intro plays, then gameplay on camera 1. */
      export function startOfficeIntro() {
        if (!_officeSceneReady || officeIntro.state !== "pending") return;
        setupOfficeGameplayCamera();
        officeIntro.state = "playing";
        officeIntro.t = 0;
      }
      export function isOfficeIntroDone() {
        return officeIntro.state === "done";
      }
      export function isOfficeSceneReady() {
        return _officeSceneReady;
      }
      export function setOfficeSceneRendering(active) {
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
      setOfficeSceneRendering(true);