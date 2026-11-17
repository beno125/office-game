import * as THREE from "three";
import * as CANNON from "cannon-es";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import { getMeetingRoomSceneMount } from "./meetingRoomSceneMount.js";
import { emitMeetingRoomSceneEvent } from "../game/meetingRoomSceneEvents.js";
import {
  CAR_MASS,
  CAR_BUMP_RESET_SPEED,
  CAR_BUMP_SLIDE_DECAY,
  CAR_BUMP_SPIN_DECAY,
  solveCarBump,
} from "../game/carBumpPhysics.js";
import { KnockoutHud, RaceResultsPopup, formatRaceTime } from "../kitchen/kitchenRace.js";
import { SCENE_ROUTES, nextLevelPath, goToLevelWithTransition } from "../game/sceneRoutes.js";

/**
 * Dev-only perf tooling (both false in production builds):
 *   ?perf           -> on-screen metrics overlay
 *   ?perf=baseline  -> overlay with the render optimizations switched off (A/B)
 *   ?perf=noglow    -> overlay with the screen glow switched off (A/B)
 */
const MR_PERF =
  import.meta.env.DEV &&
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("perf");
const MR_PERF_BASELINE =
  MR_PERF && new URLSearchParams(location.search).get("perf") === "baseline";
/** ?perf=noglow -> overlay with the screen glow switched off (A/B for the glow). */
const MR_PERF_NOGLOW =
  MR_PERF && new URLSearchParams(location.search).get("perf") === "noglow";

const _MEETING_ROOM_BASE = `${import.meta.env.BASE_URL}meeting-room-optimized/`;
const _OFFICE_BASE = `${import.meta.env.BASE_URL}office-scene-optimized/`;
const meetingRoomAsset = (path) =>
  _MEETING_ROOM_BASE + String(path).replace(/^\.\//, "");
const officeAsset = (path) =>
  _OFFICE_BASE + String(path).replace(/^\.\//, "");

const MEETING_ROOM_GLTF = "meeting-room2.gltf";
const MEETING_ROOM_SCREEN_IMAGE = "textures/welcome-screen.jpg";
const MEETING_ROOM_WOOD_TILE_M = 2;
const MEETING_ROOM_WALL_WOOD = "Poliigon_WoodVeneerOak_7760";
const MEETING_ROOM_FLOOR_WOOD = "Poliigon_WoodFloorAsh_4186";
const MEETING_ROOM_TABLE_PLASTIC = "Poliigon_PlasticMoldWorn_7486";
const MEETING_ROOM_COLUMN_CONCRETE = "Poliigon_ConcreteFloorPoured_7656";
const MEETING_ROOM_PLANT = "PlantBanjoFig001";
const MEETING_ROOM_PLANT_GROUND = "textures/plant-ground-texture.jpg";

let _meetingRoomSceneRendering = false;
let _meetingRoomSceneAnimationFrame = 0;
let _meetingRoomSceneReady = false;
let _fireSensorLightMat = null;
let _reflectiveMats = [];
const _themeMats = {};
const _mainPanelLights = [];
const _screenAreaLights = [];
const _tabletSideAreaLights = [];
const _tablePlateAreaLights = [];
let tableReflector = null;
let tableReflectorBlur = null;
const TABLE_REFL_GRID = 5;
const _tableReflectorCorners = Array.from(
  { length: TABLE_REFL_GRID * TABLE_REFL_GRID },
  () => new THREE.Vector3(),
);
const _tableReflectorViewP = new THREE.Vector3();
const _tableReflectorLook = new THREE.Vector3();
const _reflWorldPos = new THREE.Vector3();
const _reflCamWorldPos = new THREE.Vector3();
const _reflView = new THREE.Vector3();
const _reflLookAt = new THREE.Vector3();
const _reflTarget = new THREE.Vector3();
const _reflNormal = new THREE.Vector3();
const _reflUp = new THREE.Vector3();
const _reflRotation = new THREE.Matrix4();
const _reflPlane = new THREE.Plane();
const _reflClipPlane = new THREE.Vector4();
const _reflQ = new THREE.Vector4();

export function isMeetingRoomSceneReady() {
  return _meetingRoomSceneReady;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03040c);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
camera.position.set(8, 6, 12);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.42;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;

const canvas = renderer.domElement;
canvas.style.display = "block";
canvas.style.width = "100%";
canvas.style.height = "100%";
getMeetingRoomSceneMount().appendChild(canvas);

RectAreaLightUniformsLib.init();

const _pmrem = new THREE.PMREMGenerator(renderer);
const _meetingRoomEnv = _pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
_pmrem.dispose();

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 1, 0);
controls.keys = { LEFT: "", UP: "", RIGHT: "", BOTTOM: "" };
controls.listenToKeyEvents = () => {};

let _model = null;
let _freeCable = null;
const clock = new THREE.Clock();

// Dark Mode = gaming arena: near-black room, little even fill, restrained
// purple / electric-blue rims; the tablePlate keeps its own key light.
const darkMode = {
  background: 0x010104,
  ambient: { color: 0x8a98c8, intensity: 0.012 },
  hemisphere: { sky: 0x9aa8cc, ground: 0x3a3048, intensity: 0.05 },
  dirPink: { color: 0x9b3dff, intensity: 0.11 },
  dirBlue: { color: 0x3ec8ff, intensity: 0.17 },
  dirFillPink: { color: 0xb026ff, intensity: 0.06 },
  dirFillBlue: { color: 0x4d8cff, intensity: 0.05 },
  pointPink: { color: 0x9b3dff, intensity: 0.05 },
  pointBlue: { color: 0x3ec8ff, intensity: 0.06 },
  warmKey: { color: 0x000000, intensity: 0 },
  warmFill: { color: 0x000000, intensity: 0 },
};
const brightMode = {
  background: 0x1a1a1a,
  ambient: { color: 0xfff4e8, intensity: 0 },
  hemisphere: { sky: 0xd8d0c0, ground: 0xf5e0c0, intensity: 0 },
  dirPink: { color: 0xffe8d0, intensity: 0 },
  dirBlue: { color: 0xccddee, intensity: 0 },
  dirFillPink: { color: 0xfff0e0, intensity: 0 },
  dirFillBlue: { color: 0xdde8f0, intensity: 0 },
  pointPink: { color: 0xffe8d0, intensity: 0 },
  pointBlue: { color: 0xccddee, intensity: 0 },
  warmKey: { color: 0xfff0dd, intensity: 0 },
  warmFill: { color: 0xffe8cc, intensity: 0 },
};
const MAIN_PANEL_INTENSITY_DARK = 0.38;
const MAIN_PANEL_INTENSITY_BRIGHT = 5.1;
const SCREEN_LIGHT_INTENSITY_DARK = 8.4;
const SCREEN_LIGHT_INTENSITY_BRIGHT = 4.4;
const TABLE_PLATE_LIGHT_INTENSITY_DARK = 3.4;
const TABLE_PLATE_LIGHT_INTENSITY_BRIGHT = 0;
const TABLE_PLATE_LIGHT_COLOR = 0xffffff;
const SCREEN_LIGHT_COLOR_DARK = 0x3ec8ff;
const SCREEN_LIGHT_COLOR_BRIGHT = 0x4a72e8;
const TABLET_SIDE_LIGHT_INTENSITY_DARK = 17.5;
const TABLET_SIDE_LIGHT_INTENSITY_BRIGHT = 6.2;
const TABLET_SIDE_LIGHT_COLOR = 0x2dff55;
const MAIN_PANEL_COLOR_DARK = 0xfff6ea;
const MAIN_PANEL_COLOR_BRIGHT = 0xfff6ea;
const EXPOSURE_DARK = 0.36;
/**
 * Dark Mode surfaces: each material's own Bright color, dimmed and cooled.
 * (Colors are linear in three.js, so a scale here is a true brightness ratio.)
 */
const ARENA_DARK_TINT = new THREE.Color(0.86, 0.93, 1.12);
const ARENA_DARK = {
  wall: 0.45,
  ceiling: 0.4,
  board: 0.4,
  paintMetal: 0.42,
  plastic: 0.45,
  paint: 0.42,
  floor: 0.45,
  wood: 0.45,
  chairNet: 0.5,
  ceilingGlow: new THREE.Color(0x1ad4ff),
  paintGlow: new THREE.Color(0x2a5cff),
};
const _arenaDarkTmp = new THREE.Color();
/** Bright color -> its Dark Mode counterpart. */
function _arenaDarkOf(bright, scale) {
  return _arenaDarkTmp.copy(bright).multiplyScalar(scale).multiply(ARENA_DARK_TINT);
}
const EXPOSURE_BRIGHT = 0.74;
const LIGHT_FADE_DURATION = 0.2;
const _legacyDarkLightsScale = 1;
let lightBlend = 1;
let lightBlendTarget = 1;
const _cDark = new THREE.Color();
const _cBright = new THREE.Color();

const ambient = new THREE.AmbientLight(0x081028, 0.018);
scene.add(ambient);
const hemisphere = new THREE.HemisphereLight(0x2ad4ff, 0x6b1aff, 0.12);
scene.add(hemisphere);
const dirPink = new THREE.DirectionalLight(0x9b3dff, 0.42);
dirPink.position.set(2.4, 3.4, 3.2);
scene.add(dirPink);
const dirBlue = new THREE.DirectionalLight(0x3ec8ff, 0.85);
dirBlue.position.set(-3.8, 3.6, 0);
scene.add(dirBlue);
const dirFillPink = new THREE.DirectionalLight(0xb026ff, 0.5);
dirFillPink.position.set(-3.6, 2.8, 0.4);
scene.add(dirFillPink);
const dirFillBlue = new THREE.DirectionalLight(0x4d8cff, 0.4);
dirFillBlue.position.set(3.6, 3.1, -0.4);
scene.add(dirFillBlue);
const pointPink = new THREE.PointLight(0x9b3dff, 0.35, 14, 1.4);
pointPink.position.set(0, 3.2, 0);
scene.add(pointPink);
const pointBlue = new THREE.PointLight(0x3ec8ff, 0.55, 12, 1.4);
pointBlue.position.set(-1.8, 3.1, 0);
scene.add(pointBlue);
const warmKeyLight = new THREE.DirectionalLight(0x000000, 0);
warmKeyLight.position.set(2.4, 6.2, 2.2);
scene.add(warmKeyLight);
const warmFillLight = new THREE.PointLight(0x000000, 0, 18, 1.8);
warmFillLight.position.set(-2.2, 4.2, 1.8);
scene.add(warmFillLight);
const darkBlueLight = new THREE.PointLight(0x3ec8ff, 0, 16, 1.35);
darkBlueLight.position.set(0, 3.6, 0);
scene.add(darkBlueLight);
const darkBlueFill = new THREE.DirectionalLight(0x4d8cff, 0);
darkBlueFill.position.set(-3.2, 3.8, 1.2);
scene.add(darkBlueFill);
const darkPinkLight = new THREE.PointLight(0x9b3dff, 0, 14, 1.4);
darkPinkLight.position.set(1.8, 3.2, 1.2);
scene.add(darkPinkLight);
const darkPurpleFill = new THREE.DirectionalLight(0xb026ff, 0);
darkPurpleFill.position.set(3.4, 2.8, -2.4);
scene.add(darkPurpleFill);

let carShadowPlane = null;
/**
 * One shared light that throws a car's electrical shock onto the room (walls,
 * floor, tablePlate, reflections). Always in the scene at intensity 0 so the
 * light count — and every material's shader — never changes; it follows
 * whichever car has the strongest active shock (see updateShockRoomLight).
 */
// Reaches the room walls with distance falloff (nearby surfaces get the most).
// Lifted well above the car so the electrified car itself receives about the
// same light as before — only the surroundings get brighter.
const SHOCK_ROOM_PEAK = 6.5;
const SHOCK_ROOM_BASE_DIST = 7;
const SHOCK_ROOM_FLASH_DIST = 10;
const SHOCK_ROOM_DECAY = 1.3;
const SHOCK_ROOM_LIFT = 1.6;
const SHOCK_ROOM_COLOR_LOW = new THREE.Color(0x2a7dff);
const SHOCK_ROOM_COLOR_HIGH = new THREE.Color(0xd9f3ff);
const shockRoomLight = new THREE.PointLight(
  SHOCK_ROOM_COLOR_LOW,
  0,
  SHOCK_ROOM_BASE_DIST,
  SHOCK_ROOM_DECAY,
);
shockRoomLight.name = "carShockRoomLight";
shockRoomLight.castShadow = false;
scene.add(shockRoomLight);
const carShadowLight = new THREE.DirectionalLight(0xffffff, 0.05);
carShadowLight.name = "meetingRoomCarShadowLight";
carShadowLight.position.set(3, 20, 2);
carShadowLight.castShadow = true;
carShadowLight.shadow.mapSize.set(512, 512);
carShadowLight.shadow.camera.near = 0.5;
carShadowLight.shadow.camera.far = 50;
carShadowLight.shadow.camera.left = -6;
carShadowLight.shadow.camera.right = 6;
carShadowLight.shadow.camera.top = 6;
carShadowLight.shadow.camera.bottom = -6;
carShadowLight.shadow.bias = -0.00025;
carShadowLight.shadow.normalBias = 0.003;
carShadowLight.shadow.radius = 12;
carShadowLight.shadow.blurSamples = 16;
scene.add(carShadowLight);
scene.add(carShadowLight.target);

/**
 * Cars only: how much direct light (table key light, room point/directional
 * lights) their surfaces take. Below 1 in Dark Mode so the paint keeps its
 * color instead of blowing out to white under the close table light; exactly
 * 1 in Bright Mode. Emissive parts, ambient fill and reflections are untouched.
 */
const CAR_DIRECT_LIGHT_GAIN_DARK = 0.55;
const _carDirectLightGain = { value: 1 };

function patchCarMaterialLighting(root) {
  root.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of mats) {
      if (!mat || mat.userData._carGainPatched) continue;
      if (!mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial) continue;
      mat.userData._carGainPatched = true;
      const prev = mat.onBeforeCompile;
      mat.onBeforeCompile = (shader, renderer) => {
        if (prev) prev(shader, renderer);
        shader.uniforms.uCarDirectLightGain = _carDirectLightGain;
        shader.fragmentShader = shader.fragmentShader
          .replace("void main() {", "uniform float uCarDirectLightGain;\nvoid main() {")
          .replace(
            "#include <lights_fragment_end>",
            "#include <lights_fragment_end>\n" +
              "reflectedLight.directDiffuse *= uCarDirectLightGain;\n" +
              "reflectedLight.directSpecular *= uCarDirectLightGain;",
          );
      };
      const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : null;
      mat.customProgramCacheKey = () => (prevKey ? prevKey() : "") + "|carDirectLightGain";
      mat.needsUpdate = true;
    }
  });
}

function blendChannel(darkV, brightV, b) {
  return darkV + (brightV - darkV) * b;
}

function applyLightBlend(b) {
  _cDark.setHex(darkMode.background);
  _cBright.setHex(brightMode.background);
  scene.background.lerpColors(_cDark, _cBright, b);
  _cDark.setHex(darkMode.ambient.color);
  _cBright.setHex(brightMode.ambient.color);
  ambient.color.lerpColors(_cDark, _cBright, b);
  ambient.intensity = blendChannel(
    darkMode.ambient.intensity,
    brightMode.ambient.intensity,
    b,
  );
  _cDark.setHex(darkMode.hemisphere.sky);
  _cBright.setHex(brightMode.hemisphere.sky);
  hemisphere.color.lerpColors(_cDark, _cBright, b);
  _cDark.setHex(darkMode.hemisphere.ground);
  _cBright.setHex(brightMode.hemisphere.ground);
  hemisphere.groundColor.lerpColors(_cDark, _cBright, b);
  hemisphere.intensity = blendChannel(
    darkMode.hemisphere.intensity,
    brightMode.hemisphere.intensity,
    b,
  );
  _cDark.setHex(darkMode.dirPink.color);
  _cBright.setHex(brightMode.dirPink.color);
  dirPink.color.lerpColors(_cDark, _cBright, b);
  dirPink.intensity = blendChannel(
    darkMode.dirPink.intensity,
    brightMode.dirPink.intensity,
    b,
  );
  _cDark.setHex(darkMode.dirBlue.color);
  _cBright.setHex(brightMode.dirBlue.color);
  dirBlue.color.lerpColors(_cDark, _cBright, b);
  dirBlue.intensity = blendChannel(
    darkMode.dirBlue.intensity,
    brightMode.dirBlue.intensity,
    b,
  );
  _cDark.setHex(darkMode.dirFillPink.color);
  _cBright.setHex(brightMode.dirFillPink.color);
  dirFillPink.color.lerpColors(_cDark, _cBright, b);
  dirFillPink.intensity = blendChannel(
    darkMode.dirFillPink.intensity,
    brightMode.dirFillPink.intensity,
    b,
  );
  _cDark.setHex(darkMode.dirFillBlue.color);
  _cBright.setHex(brightMode.dirFillBlue.color);
  dirFillBlue.color.lerpColors(_cDark, _cBright, b);
  dirFillBlue.intensity = blendChannel(
    darkMode.dirFillBlue.intensity,
    brightMode.dirFillBlue.intensity,
    b,
  );
  _cDark.setHex(darkMode.pointPink.color);
  _cBright.setHex(brightMode.pointPink.color);
  pointPink.color.lerpColors(_cDark, _cBright, b);
  pointPink.intensity = blendChannel(
    darkMode.pointPink.intensity,
    brightMode.pointPink.intensity,
    b,
  );
  _cDark.setHex(darkMode.pointBlue.color);
  _cBright.setHex(brightMode.pointBlue.color);
  pointBlue.color.lerpColors(_cDark, _cBright, b);
  pointBlue.intensity = blendChannel(
    darkMode.pointBlue.intensity,
    brightMode.pointBlue.intensity,
    b,
  );
  _cDark.setHex(darkMode.warmKey.color);
  _cBright.setHex(brightMode.warmKey.color);
  warmKeyLight.color.lerpColors(_cDark, _cBright, b);
  warmKeyLight.intensity = blendChannel(
    darkMode.warmKey.intensity,
    brightMode.warmKey.intensity,
    b,
  );
  _cDark.setHex(darkMode.warmFill.color);
  _cBright.setHex(brightMode.warmFill.color);
  warmFillLight.color.lerpColors(_cDark, _cBright, b);
  warmFillLight.intensity = blendChannel(
    darkMode.warmFill.intensity,
    brightMode.warmFill.intensity,
    b,
  );
  const darkStr = 1 - b;
  darkBlueLight.intensity = darkStr * 0.18 * _legacyDarkLightsScale;
  darkBlueFill.intensity = darkStr * 0.06 * _legacyDarkLightsScale;
  darkPinkLight.intensity = darkStr * 0.05 * _legacyDarkLightsScale;
  darkPurpleFill.intensity = darkStr * 0.1 * _legacyDarkLightsScale;
  renderer.toneMappingExposure = blendChannel(EXPOSURE_DARK, EXPOSURE_BRIGHT, b);
  _cDark.setHex(MAIN_PANEL_COLOR_DARK);
  _cBright.setHex(MAIN_PANEL_COLOR_BRIGHT);
  for (const light of _mainPanelLights) {
    light.color.lerpColors(_cDark, _cBright, b);
    light.intensity = blendChannel(
      MAIN_PANEL_INTENSITY_DARK,
      MAIN_PANEL_INTENSITY_BRIGHT,
      b,
    );
  }
  _cDark.setHex(SCREEN_LIGHT_COLOR_DARK);
  _cBright.setHex(SCREEN_LIGHT_COLOR_BRIGHT);
  for (const light of _screenAreaLights) {
    light.color.lerpColors(_cDark, _cBright, b);
    light.intensity = blendChannel(
      SCREEN_LIGHT_INTENSITY_DARK,
      SCREEN_LIGHT_INTENSITY_BRIGHT,
      b,
    );
  }
  for (const light of _tabletSideAreaLights) {
    light.color.setHex(TABLET_SIDE_LIGHT_COLOR);
    light.intensity = blendChannel(
      TABLET_SIDE_LIGHT_INTENSITY_DARK,
      TABLET_SIDE_LIGHT_INTENSITY_BRIGHT,
      b,
    );
  }
  for (const light of _tablePlateAreaLights) {
    light.color.setHex(TABLE_PLATE_LIGHT_COLOR);
    light.intensity = blendChannel(
      TABLE_PLATE_LIGHT_INTENSITY_DARK,
      TABLE_PLATE_LIGHT_INTENSITY_BRIGHT,
      b,
    );
  }
  if (_themeMats.tabletSideLight) {
    _themeMats.tabletSideLight.emissiveIntensity = blendChannel(22, 8.5, b);
  }
  _carDirectLightGain.value = blendChannel(CAR_DIRECT_LIGHT_GAIN_DARK, 1, b);
  if (carKeyLight) {
    _cDark.setHex(0x66e8ff);
    _cBright.setHex(0xfff4e8);
    carKeyLight.color.lerpColors(_cDark, _cBright, b);
    carKeyLight.intensity = blendChannel(0.45, 1.85, b);
    _cDark.setHex(0x9b3dff);
    _cBright.setHex(0xffe8d0);
    carRimLight.color.lerpColors(_cDark, _cBright, b);
    carRimLight.intensity = blendChannel(0.3, 0.7, b);
  }
  for (let i = 0; i < _carLampSpots.length; i++) {
    const entry = _carLampSpots[i];
    entry.spot.intensity = blendChannel(
      entry.kind === "front" ? 1.8 : 1.5,
      entry.kind === "front" ? 0.7 : 0.5,
      b,
    );
  }
  const creamWall = _themeMats.creamWall;
  if (creamWall && _themeMats.creamWallBright) {
    creamWall.color.lerpColors(_arenaDarkOf(_themeMats.creamWallBright, ARENA_DARK.wall), _themeMats.creamWallBright, b);
    creamWall.envMapIntensity = blendChannel(0.05, 0.22, b);
  }
  if (_themeMats.glossyBoard && _themeMats.glossyBoardBright) {
    _themeMats.glossyBoard.color.lerpColors(_arenaDarkOf(_themeMats.glossyBoardBright, ARENA_DARK.board), _themeMats.glossyBoardBright, b);
    _themeMats.glossyBoard.roughness = blendChannel(0.18, 0.1, b);
    _themeMats.glossyBoard.envMapIntensity = blendChannel(0.12, 1.45, b);
    _themeMats.glossyBoard.clearcoat = blendChannel(0.4, 0.72, b);
  }
  if (_themeMats.whitePaintMetal && _themeMats.whitePaintMetalBright) {
    _themeMats.whitePaintMetal.color.lerpColors(
      _arenaDarkOf(_themeMats.whitePaintMetalBright, ARENA_DARK.paintMetal),
      _themeMats.whitePaintMetalBright,
      b,
    );
    _themeMats.whitePaintMetal.envMapIntensity = blendChannel(0.2, 1.15, b);
  }
  if (_themeMats.whiteMattPlastic && _themeMats.whiteMattPlasticBright) {
    _themeMats.whiteMattPlastic.color.lerpColors(
      _arenaDarkOf(_themeMats.whiteMattPlasticBright, ARENA_DARK.plastic),
      _themeMats.whiteMattPlasticBright,
      b,
    );
  }
  if (_themeMats.chairNet && _themeMats.chairNetBright) {
    _themeMats.chairNet.color.lerpColors(_arenaDarkOf(_themeMats.chairNetBright, ARENA_DARK.chairNet), _themeMats.chairNetBright, b);
  }
  if (_themeMats.creamCeiling && _themeMats.creamCeilingBright) {
    _themeMats.creamCeiling.color.lerpColors(_arenaDarkOf(_themeMats.creamCeilingBright, ARENA_DARK.ceiling), _themeMats.creamCeilingBright, b);
    if (_themeMats.creamCeilingEmissiveBright) {
      // A faint cyan neon cast over the ceiling in the dark.
      _themeMats.creamCeiling.emissive.lerpColors(
        ARENA_DARK.ceilingGlow,
        _themeMats.creamCeilingEmissiveBright,
        b,
      );
    }
    _themeMats.creamCeiling.emissiveIntensity = blendChannel(0.012, 0.18, b);
  }
  if (_themeMats.whiteMattPaint && _themeMats.whiteMattBright) {
    _themeMats.whiteMattPaint.color.lerpColors(_arenaDarkOf(_themeMats.whiteMattBright, ARENA_DARK.paint), _themeMats.whiteMattBright, b);
    if (_themeMats.whiteMattEmissiveBright) {
      _themeMats.whiteMattPaint.emissive.lerpColors(
        ARENA_DARK.paintGlow,
        _themeMats.whiteMattEmissiveBright,
        b,
      );
    }
    _themeMats.whiteMattPaint.emissiveIntensity = blendChannel(0.02, 0.2, b);
  }
  if (_themeMats.whiteVisibleLight && _themeMats.whiteLightEmissiveBright) {
    _themeMats.whiteVisibleLight.emissive.copy(_themeMats.whiteLightEmissiveBright);
    _themeMats.whiteVisibleLight.emissiveIntensity = blendChannel(0.7, 3.3, b);
  }
  if (_themeMats.floor && _themeMats.floorColorBright) {
    _themeMats.floor.color.lerpColors(_arenaDarkOf(_themeMats.floorColorBright, ARENA_DARK.floor), _themeMats.floorColorBright, b);
    _themeMats.floor.emissive.setHex(0x000000);
    _themeMats.floor.emissiveIntensity = 0;
    _themeMats.floor.envMapIntensity = blendChannel(0.07, 0.18, b);
  }
  if (_themeMats.wallWood && _themeMats.wallWoodBright) {
    _themeMats.wallWood.color.lerpColors(_arenaDarkOf(_themeMats.wallWoodBright, ARENA_DARK.wood), _themeMats.wallWoodBright, b);
  }
  if (_themeMats.tablePlate) {
    if (_themeMats.tableEmissiveBright) {
      _themeMats.tablePlate.emissive.copy(_themeMats.tableEmissiveBright);
    }
    _themeMats.tablePlate.emissiveIntensity = blendChannel(0.1, 0.28, b);
    _themeMats.tablePlate.envMapIntensity = blendChannel(0.42, 0.12, b);
    _themeMats.tablePlate.roughness = blendChannel(0.88, 1, b);
  }
  if (_themeMats.screen) {
    _themeMats.screen.emissiveIntensity = blendChannel(4.4, 1.9, b);
  }
  if (_themeMats.sealingPlates && _themeMats.sealingEmissiveBright) {
    _themeMats.sealingPlates.emissive.copy(_themeMats.sealingEmissiveBright);
    _themeMats.sealingPlates.emissiveIntensity = blendChannel(0.28, 0.28, b);
  }
}

const WHEEL_RADIUS = 0.28;
const MAX_STEER_DEG = 28;
const MAX_STEER_RAD = (MAX_STEER_DEG * Math.PI) / 180;
const CAR_SCALE_MULTIPLIER = 0.48;
const CAR_PHYS = {
  DRIVING: "DRIVING",
  IMPACT: "IMPACT",
  FALLING: "FALLING",
  LANDED: "LANDED",
  RESPAWNING: "RESPAWNING",
};
const CABLE_TIP_HIT_RADIUS = 0.038;
const CABLE_HIT_COOLDOWN = 0.28;
const CABLE_HIT_LIN_MIN = 1.2;
const CABLE_HIT_LIN_MAX = 2.35;
const CABLE_HIT_YAW_MIN = 0.55;
const CABLE_HIT_YAW_MAX = 1.35;
const CABLE_HIT_YAW_CAP = 1.4;
const CABLE_HIT_BOUNCE_MIN = 0.16;
const CABLE_HIT_BOUNCE_MAX = 0.48;
const CABLE_HIT_BURST_TIME = 0.16;
const CABLE_HIT_DAMP_TIME = 0.62;
const CABLE_HIT_ANG_BURST_TIME = 0.2;
const CABLE_HIT_ANG_DAMP_TIME = 1.12;
const CAR_HIT_SPARK_DURATION = 3;
const CAR_HIT_SPARK_FADE = 0.85;
/** Car shock look: arcs hug the body (shorter, less jagged, thinner) and glow less. Timing unchanged. */
const CAR_SPARK_REACH = 0.34;
const CAR_SPARK_JAG = 0.06;
const CAR_SPARK_WIDTH = 5.6;
const CAR_SPARK_SURFACE_PUSH = 1.03;
const CAR_SPARK_BRIGHTNESS = 0.72;
const CAR_SPARK_GLOW = 0.6;
const CAR_SPARK_LIGHT = 0.55;
const PHYS_GROUP_TABLE = 1;
const PHYS_GROUP_FLOOR = 2;
const PHYS_GROUP_CAR = 4;
const CAR_FLOOR_RESPAWN_SEC = 2;
const PHYS_FIXED_DT = 1 / 60;
const PHYS_GRAVITY_Y = -16;
const KITCHEN_CAR_SCALE_MULTIPLIER = 1.52;
const KITCHEN_TABLE_MIN_SIZE = 8;
const KITCHEN_CAR_SCALE =
  Math.max(0.05, Math.min(1, (KITCHEN_TABLE_MIN_SIZE * 0.2) / 2)) *
  KITCHEN_CAR_SCALE_MULTIPLIER;
const _visBox = new THREE.Box3();
const _tmpVisBox = new THREE.Box3();
const _carCamOffset = new THREE.Vector3(3.8, 0.9, 0);

function isCarPhysicsPart(name) {
  const n = String(name || "").toLowerCase();
  return n.startsWith("canon-") || n.includes("physic") || n.includes("collider");
}

function boxFromVisibleMeshes(root, box) {
  box.makeEmpty();
  root.updateWorldMatrix(true, true);
  root.traverse((node) => {
    if (!node.isMesh || !node.visible || !node.geometry) return;
    if (node.userData && node.userData.skipBounds) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    _tmpVisBox.copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld);
    box.union(_tmpVisBox);
  });
  return box;
}
const AIR_IN_ROT_SPEED = 12;
const AIR_IN_STAGGER = {
  airIn1: { open: 0.0, close: 0.14 },
  airIn2: { open: 0.11, close: 0.03 },
  airIn3: { open: 0.06, close: 0.1 },
};
let car = new THREE.Group();
car.name = "KitchenCar";
car.rotation.order = "YXZ";
scene.add(car);
const carKeyLight = new THREE.PointLight(0x66e8ff, 0.85, 9, 2);
carKeyLight.position.set(-1.2, 3.8, 1.8);
carKeyLight.name = "meetingRoomCarKeyLight";
car.add(carKeyLight);
const carRimLight = new THREE.PointLight(0x9b3dff, 0.5, 8, 2);
carRimLight.position.set(1.5, 2.4, -2.2);
carRimLight.name = "meetingRoomCarRimLight";
car.add(carRimLight);
const _carLampSpots = [];
let carState = {
  speed: 0,
  angle: 0,
  steerAngle: 0,
  wheelAngle: 0,
  maxSpeed: 4.2,
  accel: 22,
  brakeDecel: 92,
  brakeDecelReverseKey: 620,
  friction: 0.92,
  steerSpeed: 5.2,
  turnRate: 18,
  _brakeTime: 0,
};
const playerKeys = {
  forward: false,
  reverse: false,
  left: false,
  right: false,
  brake: false,
};
let keys = playerKeys;
let halfW = 0.6;
let halfL = 1.0;
let storedCarScale = 0.5;
let carBottomOffsetY = 0;
let tableSurfaceY = 0;
let tablePlateHalfX = Infinity;
let tablePlateHalfZ = Infinity;
const tablePlateCenter = new THREE.Vector3();
let tableSpawn = new THREE.Vector3();
let carSpawnAngle = 0;
/** Collision push carried by a driving car on top of its own driving (decays). */
let carBumpVelX = 0;
let carBumpVelZ = 0;
let carBumpYaw = 0;
let physicsWorld = null;
let tablePlateBody = null;
let floorPhysBody = null;
let carPhysBody = null;
let _carPhysMaterial = null;
let _tablePhysMaterial = null;
let _floorPhysMaterial = null;
let carPhysState = CAR_PHYS.DRIVING;
let carFloorTimer = 0;
let carLandedAtMs = 0;
let carSpawnGrace = 0;
let carImpactSettle = 0;
let carImpactAge = 0;
let carImpactLin0 = 0;
let carImpactYaw0 = 0;
let carImpactSpinShare = 0.5;
let _carHitSpark = null;
let _impactKickDir = new THREE.Vector3();
const _carSparkA = new THREE.Vector3();
const _carSparkB = new THREE.Vector3();
let _cableHitLatched = false;
let _cableHitCool = 0;
let _cableTipPrevValid = false;
let floorTopY = 0;
let _physAcc = 0;
let carPhysLocalCenter = new THREE.Vector3();
let carPhysHalf = new THREE.Vector3();
const _physOffset = new THREE.Vector3();
const _cableTipWorld = new THREE.Vector3();
let _cableTipPrev = new THREE.Vector3();
const _cableTipVel = new THREE.Vector3();
const _hitClosest = new THREE.Vector3();
const _hitAway = new THREE.Vector3();
const _hitStrike = new THREE.Vector3();
const _hitDir = new THREE.Vector3();
const _hitEuler = new THREE.Euler();
const _carSurfPt = new THREE.Vector3();
const _carSurfN = new THREE.Vector3();
const _physQuat = new THREE.Quaternion();
const _physQuatInv = new THREE.Quaternion();
let wheelFL = null;
let wheelFR = null;
let wheelRL = null;
let wheelRR = null;
let airInParts = [];
let _carFollowCam = true;
let _carReady = false;
const _quatWheelSteer = new THREE.Quaternion();
const _quatWheelRoll = new THREE.Quaternion();
const _quatY = new THREE.Quaternion();
const _axisWheelY = new THREE.Vector3(0, 1, 0);
const _axisWheelRoll = new THREE.Vector3(1, 0, 0);
const _flatUp = new THREE.Vector3(0, 1, 0);
const _axisAirInDrive = new THREE.Vector3(1, 0, 0);
const _quatAirInDrive = new THREE.Quaternion();
const _carLook = new THREE.Vector3();

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
    "Space",
  ].includes(code);
}

function onKeyDown(e) {
  if (isControlKey(e.code)) e.preventDefault();
  if (e.code === "KeyW" || e.code === "ArrowUp") playerKeys.forward = true;
  if (e.code === "KeyS" || e.code === "ArrowDown") playerKeys.reverse = true;
  if (e.code === "KeyA" || e.code === "ArrowLeft") playerKeys.left = true;
  if (e.code === "KeyD" || e.code === "ArrowRight") playerKeys.right = true;
  if (e.code === "Space") playerKeys.brake = true;
  if (e.code === "KeyO") {
    e.preventDefault();
    lightBlendTarget = 0;
  }
  if (e.code === "KeyP") {
    e.preventDefault();
    lightBlendTarget = 1;
  }
  if (e.code === "Digit1") {
    e.preventDefault();
    _carFollowCam = true;
    controls.enabled = true;
    cancelCameraDirector();
    if (_carReady) {
      _carLook.copy(car.position);
      _carLook.y += 0.28 * Math.max(0.2, storedCarScale);
      camera.position.set(_carLook.x + 3.8, _carLook.y + 0.9, _carLook.z);
      controls.target.copy(_carLook);
      controls.update();
    }
  }
  if (e.code === "Digit2") {
    e.preventDefault();
    _carFollowCam = false;
    controls.enabled = true;
    cancelCameraDirector();
    if (_model) frameMeetingRoomInterior(_model);
  }
}

function onKeyUp(e) {
  if (isControlKey(e.code)) e.preventDefault();
  if (e.code === "KeyW" || e.code === "ArrowUp") playerKeys.forward = false;
  if (e.code === "KeyS" || e.code === "ArrowDown") playerKeys.reverse = false;
  if (e.code === "KeyA" || e.code === "ArrowLeft") playerKeys.left = false;
  if (e.code === "KeyD" || e.code === "ArrowRight") playerKeys.right = false;
  if (e.code === "Space") playerKeys.brake = false;
}

window.addEventListener("keydown", onKeyDown, true);
window.addEventListener("keyup", onKeyUp, true);

function captureTableDriveSurface(root) {
  const table = root.getObjectByName("tablePlate");
  if (!table) return false;
  table.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(table);
  if (box.isEmpty()) return false;
  box.getCenter(tablePlateCenter);
  tableSurfaceY = box.max.y;
  tablePlateHalfX = (box.max.x - box.min.x) * 0.5;
  tablePlateHalfZ = (box.max.z - box.min.z) * 0.5;
  placeGamingDarkLights();
  setupCarShadowPlane();
  setupDrivePhysics(root);
  return true;
}

function setupCarShadowPlane() {
  if (!Number.isFinite(tablePlateHalfX) || tablePlateHalfX > 100) return;
  const sx = Math.max(0.2, tablePlateHalfX * 2 * 1.5);
  const sz = Math.max(0.2, tablePlateHalfZ * 2 * 1.5);
  if (carShadowPlane) {
    carShadowPlane.geometry.dispose();
    carShadowPlane.geometry = new THREE.PlaneGeometry(sx, sz);
  } else {
    const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    shadowPlaneMat.depthWrite = false;
    carShadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(sx, sz),
      shadowPlaneMat,
    );
    carShadowPlane.name = "carShadowPlane";
    carShadowPlane.rotation.x = -Math.PI / 2;
    carShadowPlane.receiveShadow = true;
    carShadowPlane.castShadow = false;
    carShadowPlane.renderOrder = 1;
    scene.add(carShadowPlane);
  }
  carShadowPlane.position.set(
    tablePlateCenter.x,
    tableSurfaceY + 0.004,
    tablePlateCenter.z,
  );
}

function fitCarShadowCamera() {
  const worldHalfW = Math.max(0.04, halfW * storedCarScale);
  const worldHalfL = Math.max(0.04, halfL * storedCarScale);
  const extent = Math.max(0.85, Math.max(worldHalfW, worldHalfL) * 3.4);
  const cam = carShadowLight.shadow.camera;
  cam.left = -extent;
  cam.right = extent;
  cam.top = extent;
  cam.bottom = -extent;
  cam.near = 0.2;
  cam.far = 40;
  cam.updateProjectionMatrix();
  carShadowLight.shadow.needsUpdate = true;
}

function updateCarShadowLight() {
  if (!_carReady) return;
  carShadowLight.position.set(
    car.position.x,
    car.position.y + 20,
    car.position.z,
  );
  carShadowLight.target.position.copy(car.position);
  carShadowLight.target.updateMatrixWorld();
}

function placeGamingDarkLights() {
  pointPink.position.set(tablePlateCenter.x, tableSurfaceY + 2.4, tablePlateCenter.z);
  darkPinkLight.position.set(
    tablePlateCenter.x + 1.8,
    tableSurfaceY + 2.2,
    tablePlateCenter.z + 1.2,
  );
  darkBlueLight.position.set(tablePlateCenter.x, tableSurfaceY + 2.8, tablePlateCenter.z);
  pointBlue.position.set(tablePlateCenter.x - 1.6, tableSurfaceY + 2.1, tablePlateCenter.z);
}

function applySceneEnvironmentToMaterial(mat) {
  if (mat) mat.envMap = _meetingRoomEnv;
}

function _safeRemovePhysBody(body) {
  if (!physicsWorld || !body) return;
  try {
    physicsWorld.removeBody(body);
  } catch (e) {}
}

function setupDrivePhysics(root) {
  if (!root) return;
  if (!physicsWorld) {
    physicsWorld = new CANNON.World({
      gravity: new CANNON.Vec3(0, PHYS_GRAVITY_Y, 0),
      allowSleep: false,
    });
    physicsWorld.broadphase = new CANNON.SAPBroadphase(physicsWorld);
    physicsWorld.solver.iterations = 12;
    physicsWorld.defaultContactMaterial.friction = 0.45;
    physicsWorld.defaultContactMaterial.restitution = 0.08;
    physicsWorld.defaultContactMaterial.contactEquationStiffness = 1e7;
    physicsWorld.defaultContactMaterial.contactEquationRelaxation = 3;
    _tablePhysMaterial = new CANNON.Material("tablePlate");
    _floorPhysMaterial = new CANNON.Material("floor");
    _carPhysMaterial = new CANNON.Material("car");
    physicsWorld.addContactMaterial(
      new CANNON.ContactMaterial(_carPhysMaterial, _tablePhysMaterial, {
        friction: 0.35,
        restitution: 0.04,
        contactEquationStiffness: 1e7,
        contactEquationRelaxation: 3,
      }),
    );
    physicsWorld.addContactMaterial(
      new CANNON.ContactMaterial(_carPhysMaterial, _floorPhysMaterial, {
        friction: 0.62,
        restitution: 0.16,
        contactEquationStiffness: 1e7,
        contactEquationRelaxation: 3,
      }),
    );
  }
  _safeRemovePhysBody(tablePlateBody);
  tablePlateBody = null;
  const table = root.getObjectByName("tablePlate");
  if (table) {
    table.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(table);
    const size = box.getSize(new THREE.Vector3());
    const hx = Math.max(0.05, size.x * 0.5);
    const hz = Math.max(0.05, size.z * 0.5);
    const hy = Math.max(0.04, size.y * 0.5);
    tablePlateBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: _tablePhysMaterial,
      collisionFilterGroup: PHYS_GROUP_TABLE,
      collisionFilterMask: PHYS_GROUP_CAR,
    });
    tablePlateBody.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
    tablePlateBody.position.set(
      tablePlateCenter.x,
      tableSurfaceY - hy,
      tablePlateCenter.z,
    );
    physicsWorld.addBody(tablePlateBody);
  }
  _safeRemovePhysBody(floorPhysBody);
  floorPhysBody = null;
  const floor = root.getObjectByName("floor");
  if (floor) {
    floor.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(floor);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    floorTopY = box.max.y;
    const hy = Math.max(0.25, size.y * 0.5);
    floorPhysBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: _floorPhysMaterial,
      collisionFilterGroup: PHYS_GROUP_FLOOR,
      collisionFilterMask: PHYS_GROUP_CAR,
    });
    floorPhysBody.addShape(
      new CANNON.Box(
        new CANNON.Vec3(Math.max(1, size.x * 0.5), hy, Math.max(1, size.z * 0.5)),
      ),
    );
    floorPhysBody.position.set(center.x, floorTopY - hy, center.z);
    physicsWorld.addBody(floorPhysBody);
  }
}

function setupCarPhysicsBody() {
  if (!physicsWorld) return;
  _safeRemovePhysBody(carPhysBody);
  carPhysBody = null;
  car.updateMatrixWorld(true);
  boxFromVisibleMeshes(car, _visBox);
  if (_visBox.isEmpty()) return;
  const size = _visBox.getSize(new THREE.Vector3());
  const center = _visBox.getCenter(new THREE.Vector3());
  carPhysHalf.set(
    Math.max(0.012, size.x * 0.5),
    Math.max(0.01, size.y * 0.5),
    Math.max(0.012, size.z * 0.5),
  );
  carPhysLocalCenter.copy(center);
  car.worldToLocal(carPhysLocalCenter);
  carPhysBody = new CANNON.Body({
    mass: 1.8,
    type: CANNON.Body.KINEMATIC,
    material: _carPhysMaterial,
    linearDamping: 0.08,
    angularDamping: 0.28,
    allowSleep: false,
    collisionFilterGroup: PHYS_GROUP_CAR,
    collisionFilterMask: PHYS_GROUP_TABLE | PHYS_GROUP_FLOOR,
  });
  carPhysBody.addShape(
    new CANNON.Box(
      new CANNON.Vec3(carPhysHalf.x, carPhysHalf.y, carPhysHalf.z),
    ),
  );
  physicsWorld.addBody(carPhysBody);
  syncCarBodyFromMesh();
  carPhysState = CAR_PHYS.DRIVING;
  carFloorTimer = 0;
  carLandedAtMs = 0;
  carImpactSettle = 0;
  carImpactAge = 0;
  carImpactLin0 = 0;
  carImpactYaw0 = 0;
  carImpactSpinShare = 0.5;
  _cableHitLatched = false;
  _cableHitCool = 0;
  _cableTipPrevValid = false;
  carSpawnGrace = 0.35;
  _physAcc = 0;
}

function carWorldPhysOffset(out) {
  out.copy(carPhysLocalCenter).multiply(car.scale).applyQuaternion(car.quaternion);
  return out;
}

function syncCarBodyFromMesh() {
  if (!carPhysBody) return;
  carWorldPhysOffset(_physOffset);
  carPhysBody.position.set(
    car.position.x + _physOffset.x,
    car.position.y + _physOffset.y,
    car.position.z + _physOffset.z,
  );
  carPhysBody.quaternion.set(
    car.quaternion.x,
    car.quaternion.y,
    car.quaternion.z,
    car.quaternion.w,
  );
}

function syncCarMeshFromBody() {
  if (!carPhysBody) return;
  car.quaternion.set(
    carPhysBody.quaternion.x,
    carPhysBody.quaternion.y,
    carPhysBody.quaternion.z,
    carPhysBody.quaternion.w,
  );
  carWorldPhysOffset(_physOffset);
  car.position.set(
    carPhysBody.position.x - _physOffset.x,
    carPhysBody.position.y - _physOffset.y,
    carPhysBody.position.z - _physOffset.z,
  );
}

function isCarOffTablePlate() {
  return (
    Math.abs(car.position.x - tablePlateCenter.x) > tablePlateHalfX ||
    Math.abs(car.position.z - tablePlateCenter.z) > tablePlateHalfZ
  );
}

function physicsBodiesTouching(a, b) {
  if (!physicsWorld || !a || !b) return false;
  const cs = physicsWorld.contacts;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if ((c.bi === a && c.bj === b) || (c.bj === a && c.bi === b)) return true;
  }
  return false;
}

function makeCarDynamicFromDrive() {
  if (!carPhysBody) return;
  syncCarBodyFromMesh();
  const vx = Math.sin(carState.angle) * carState.speed + carBumpVelX;
  const vz = Math.cos(carState.angle) * carState.speed + carBumpVelZ;
  clearCarBump();
  carPhysBody.type = CANNON.Body.DYNAMIC;
  carPhysBody.mass = 1.8;
  carPhysBody.updateMassProperties();
  if (!(carPhysBody.invMass > 0)) carPhysBody.invMass = 1 / 1.8;
  if (carPhysBody.velocity.lengthSquared() < 1e-6) {
    carPhysBody.velocity.set(vx, 0, vz);
  }
  carPhysBody.wakeUp();
}

function applyImpactYawHeading(stepDt) {
  if (!carPhysBody) return;
  if (stepDt) carState.angle += carPhysBody.angularVelocity.y * stepDt;
  _quatY.setFromAxisAngle(_flatUp, carState.angle);
  car.quaternion.copy(_quatY);
  carPhysBody.quaternion.set(
    car.quaternion.x,
    car.quaternion.y,
    car.quaternion.z,
    car.quaternion.w,
  );
  carWorldPhysOffset(_physOffset);
  car.position.set(
    carPhysBody.position.x - _physOffset.x,
    carPhysBody.position.y - _physOffset.y,
    carPhysBody.position.z - _physOffset.z,
  );
  const restY = tableSurfaceY + carBottomOffsetY;
  if (car.position.y <= restY) {
    car.position.y = restY;
    if (carPhysBody.velocity.y < 0) carPhysBody.velocity.y = 0;
    carPhysBody.position.y = restY + _physOffset.y;
  }
  carPhysBody.angularVelocity.x = 0;
  carPhysBody.angularVelocity.z = 0;
}

function flattenCarYawOnTable(allowHop) {
  _hitEuler.setFromQuaternion(car.quaternion, "YXZ");
  _hitEuler.x = 0;
  _hitEuler.z = 0;
  car.quaternion.setFromEuler(_hitEuler);
  carState.angle = _hitEuler.y;
  const restY = tableSurfaceY + carBottomOffsetY;
  if (!allowHop || car.position.y <= restY) {
    car.position.y = restY;
    if (carPhysBody && carPhysBody.velocity.y < 0) carPhysBody.velocity.y = 0;
  }
  if (carPhysBody) {
    carPhysBody.angularVelocity.x = 0;
    carPhysBody.angularVelocity.z = 0;
  }
}

function beginCarFall() {
  if (!carPhysBody) return;
  if (
    carPhysState === CAR_PHYS.FALLING ||
    carPhysState === CAR_PHYS.LANDED ||
    carPhysState === CAR_PHYS.RESPAWNING
  ) {
    return;
  }
  const fromImpact = carPhysState === CAR_PHYS.IMPACT;
  carPhysState = CAR_PHYS.FALLING;
  carFloorTimer = 0;
  carLandedAtMs = 0;
  carImpactSettle = 0;
  if (fromImpact) {
    carPhysBody.linearDamping = 0.08;
    carPhysBody.angularDamping = 0.28;
    carPhysBody.linearFactor.set(1, 1, 1);
    carPhysBody.angularFactor.set(1, 1, 1);
    carPhysBody.collisionFilterMask = PHYS_GROUP_TABLE | PHYS_GROUP_FLOOR;
    carPhysBody.wakeUp();
    return;
  }
  makeCarDynamicFromDrive();
  const vx = carPhysBody.velocity.x;
  const vz = carPhysBody.velocity.z;
  carPhysBody.angularVelocity.set(vz * 0.55, 0, -vx * 0.55);
}

function impactDecay(age, burst, damp, exp) {
  if (age <= burst) return 1;
  if (damp <= 1e-6) return 0;
  const u = Math.min(1, (age - burst) / damp);
  return Math.pow(1 - u, exp);
}

function applyImpactCoastDamping() {
  if (!carPhysBody || carPhysState !== CAR_PHYS.IMPACT) return;
  carPhysBody.force.set(0, 0, 0);
  carPhysBody.torque.set(0, 0, 0);
  carPhysBody.linearDamping = 0;
  carPhysBody.angularDamping = 0;
  const spin = THREE.MathUtils.clamp(carImpactSpinShare, 0, 1);
  const linBurst = CABLE_HIT_BURST_TIME * (0.88 + (1 - spin) * 0.28);
  const linDamp = CABLE_HIT_DAMP_TIME * (0.78 + (1 - spin) * 0.36);
  const angBurst = CABLE_HIT_ANG_BURST_TIME * (0.88 + spin * 0.4);
  const angDamp = CABLE_HIT_ANG_DAMP_TIME * (0.84 + spin * 0.4);
  const linScale = impactDecay(carImpactAge, linBurst, linDamp, 2);
  const angScale = impactDecay(carImpactAge, angBurst, angDamp, 1.05);
  const spd = carImpactLin0 * linScale;
  carPhysBody.velocity.x = _impactKickDir.x * spd;
  carPhysBody.velocity.z = _impactKickDir.z * spd;
  carPhysBody.angularVelocity.x = 0;
  carPhysBody.angularVelocity.y = carImpactYaw0 * angScale;
  carPhysBody.angularVelocity.z = 0;
}

function restoreDrivingFromImpact() {
  if (!carPhysBody || carPhysState !== CAR_PHYS.IMPACT) return;
  flattenCarYawOnTable();
  const fwdX = Math.sin(carState.angle);
  const fwdZ = Math.cos(carState.angle);
  carState.speed = carPhysBody.velocity.x * fwdX + carPhysBody.velocity.z * fwdZ;
  if (Math.abs(carState.speed) < 0.05) carState.speed = 0;
  carPhysBody.velocity.set(0, 0, 0);
  carPhysBody.angularVelocity.set(0, 0, 0);
  carPhysBody.force.set(0, 0, 0);
  carPhysBody.torque.set(0, 0, 0);
  carPhysBody.linearDamping = 0.08;
  carPhysBody.angularDamping = 0.28;
  carPhysBody.linearFactor.set(1, 1, 1);
  carPhysBody.angularFactor.set(1, 1, 1);
  carPhysBody.collisionFilterMask = PHYS_GROUP_TABLE | PHYS_GROUP_FLOOR;
  carPhysBody.type = CANNON.Body.KINEMATIC;
  carPhysBody.updateMassProperties();
  syncCarBodyFromMesh();
  carImpactSettle = 0;
  carImpactAge = 0;
  carImpactLin0 = 0;
  carImpactYaw0 = 0;
  carImpactSpinShare = 0.5;
  carPhysState = CAR_PHYS.DRIVING;
}

function applyCableTipImpulse(contact, impulseDir, linMag, yawMag, bounceY, spinShare) {
  if (!carPhysBody) return;
  if (
    carPhysState === CAR_PHYS.LANDED ||
    carPhysState === CAR_PHYS.RESPAWNING
  ) {
    return;
  }
  if (carPhysState === CAR_PHYS.DRIVING) {
    makeCarDynamicFromDrive();
    carPhysState = CAR_PHYS.IMPACT;
    carImpactSettle = 0;
    carImpactAge = 0;
    carPhysBody.linearDamping = 0;
    carPhysBody.angularDamping = 0;
    carPhysBody.linearFactor.set(1, 1, 1);
    carPhysBody.angularFactor.set(0, 1, 0);
    carPhysBody.collisionFilterMask = PHYS_GROUP_FLOOR;
  } else if (carPhysState === CAR_PHYS.IMPACT) {
    carPhysBody.wakeUp();
  } else if (carPhysState === CAR_PHYS.FALLING) {
    carPhysBody.wakeUp();
  }
  const burstLin = THREE.MathUtils.clamp(
    linMag,
    CABLE_HIT_LIN_MIN,
    CABLE_HIT_LIN_MAX,
  );
  const yawSign = yawMag < 0 ? -1 : 1;
  const burstYaw =
    yawSign *
    THREE.MathUtils.clamp(Math.abs(yawMag), CABLE_HIT_YAW_MIN, CABLE_HIT_YAW_MAX);
  carPhysBody.force.set(0, 0, 0);
  carPhysBody.torque.set(0, 0, 0);
  _impactKickDir.set(impulseDir.x, 0, impulseDir.z);
  if (_impactKickDir.lengthSq() < 1e-8) _impactKickDir.set(0, 0, 1);
  else _impactKickDir.normalize();
  carImpactLin0 = burstLin;
  carImpactYaw0 = THREE.MathUtils.clamp(burstYaw, -CABLE_HIT_YAW_CAP, CABLE_HIT_YAW_CAP);
  carImpactSpinShare = THREE.MathUtils.clamp(
    spinShare == null ? 0.5 : spinShare,
    0,
    1,
  );
  carPhysBody.velocity.x = _impactKickDir.x * burstLin;
  carPhysBody.velocity.z = _impactKickDir.z * burstLin;
  _activeCarCtx.lastCableHitT = clock.elapsedTime;
  if (bounceY > 0 && carPhysState !== CAR_PHYS.FALLING) {
    const hop = THREE.MathUtils.clamp(
      bounceY,
      0,
      CABLE_HIT_BOUNCE_MAX,
    );
    carPhysBody.velocity.y = hop;
  } else if (carPhysState !== CAR_PHYS.FALLING) {
    carPhysBody.velocity.y = 0;
  }
  carPhysBody.angularVelocity.x = 0;
  carPhysBody.angularVelocity.y = carImpactYaw0;
  carPhysBody.angularVelocity.z = 0;
  if (carPhysState === CAR_PHYS.IMPACT && physicsWorld) {
    applyImpactCoastDamping();
    physicsWorld.step(PHYS_FIXED_DT);
    applyImpactYawHeading(PHYS_FIXED_DT);
  }
  triggerCarHitSparks();
}

const CABLE_EDGE_NAMES = ["freeCableEdge1", "freeCableEdge2", "freeCableEdge3"];

function getCableTipWorld(out) {
  const cable = _freeCable;
  if (!cable || !cable.head) {
    out.set(0, 0, 0);
    return out;
  }
  out.set(0, 0, 0);
  let n = 0;
  for (let i = 0; i < CABLE_EDGE_NAMES.length; i++) {
    const mesh = cable.head.getObjectByName(CABLE_EDGE_NAMES[i]);
    if (!mesh) continue;
    mesh.getWorldPosition(_carSurfN);
    out.add(_carSurfN);
    n += 1;
  }
  if (n > 0) out.multiplyScalar(1 / n);
  else cable.head.getWorldPosition(out);
  return out;
}

function cableEdgeHitCar(contactOut, tipOut) {
  const cable = _freeCable;
  if (!cable || !cable.head) return Infinity;
  getCableTipWorld(tipOut);
  closestPointOnCarObb(tipOut, contactOut);
  return tipOut.distanceTo(contactOut);
}

function updateCableCarImpact(dt) {
  if (!_carReady || !carPhysBody || !_freeCable || !_freeCable.head) return;
  if (carSpawnGrace > 0) return;
  if (_cableHitCool > 0) _cableHitCool = Math.max(0, _cableHitCool - dt);
  getCableTipWorld(_cableTipWorld);
  if (_cableTipPrevValid && dt > 1e-4) {
    _cableTipVel.copy(_cableTipWorld).sub(_cableTipPrev).multiplyScalar(1 / dt);
  } else {
    _cableTipVel.set(0, 0, 0);
  }
  _cableTipPrev.copy(_cableTipWorld);
  _cableTipPrevValid = true;
  const dist = cableEdgeHitCar(_hitClosest, _cableTipWorld);
  car.userData.cableGap = dist;
  const overlapping = dist <= CABLE_TIP_HIT_RADIUS;
  if (!overlapping) {
    _cableHitLatched = false;
    return;
  }
  if (_cableHitLatched || _cableHitCool > 0) return;
  _hitAway.copy(carPhysBody.position).sub(_cableTipWorld);
  _hitAway.y = 0;
  if (_hitAway.lengthSq() < 1e-8) {
    _hitAway.set(car.position.x - _cableTipWorld.x, 0, car.position.z - _cableTipWorld.z);
  }
  if (_hitAway.lengthSq() < 1e-8 && _freeCable.aimDir) {
    _hitAway.copy(_freeCable.aimDir);
  }
  if (_hitAway.lengthSq() < 1e-8) return;
  _hitAway.normalize();
  _hitStrike.copy(_cableTipVel);
  _hitStrike.y = 0;
  if (_hitStrike.lengthSq() > 0.08) _hitStrike.normalize();
  else _hitStrike.copy(_hitAway);
  _hitDir.copy(_hitAway).multiplyScalar(0.62).addScaledVector(_hitStrike, 0.38);
  _hitDir.y = 0;
  if (_hitDir.lengthSq() < 1e-8) _hitDir.copy(_hitAway);
  _hitDir.normalize();
  const heavy = Math.random() < 0.16;
  const linU = THREE.MathUtils.clamp(
    heavy ? 0.62 + Math.random() * 0.38 : 0.34 + Math.pow(Math.random(), 0.7) * 0.66,
    0,
    1,
  );
  const yawU = THREE.MathUtils.clamp(
    heavy ? 0.7 + Math.random() * 0.3 : 0.55 + Math.pow(Math.random(), 0.55) * 0.45,
    0,
    1,
  );
  const spinShare = Math.random();
  const linJitter = 0.9 + Math.random() * 0.2;
  const yawJitter = 0.9 + Math.random() * 0.2;
  const linMag = THREE.MathUtils.clamp(
    THREE.MathUtils.lerp(CABLE_HIT_LIN_MIN, CABLE_HIT_LIN_MAX, linU) *
      (1.02 - spinShare * 0.3) *
      linJitter,
    CABLE_HIT_LIN_MIN,
    CABLE_HIT_LIN_MAX,
  );
  const yawMag =
    (Math.random() < 0.5 ? -1 : 1) *
    THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(CABLE_HIT_YAW_MIN, CABLE_HIT_YAW_MAX, yawU) *
        (0.68 + spinShare * 0.32) *
        yawJitter,
      CABLE_HIT_YAW_MIN,
      CABLE_HIT_YAW_MAX,
    );
  const bounceY =
    heavy && Math.random() < 0.28
      ? THREE.MathUtils.clamp(
          THREE.MathUtils.lerp(CABLE_HIT_BOUNCE_MIN, CABLE_HIT_BOUNCE_MAX, Math.random()),
          CABLE_HIT_BOUNCE_MIN,
          CABLE_HIT_BOUNCE_MAX,
        )
      : Math.random() < 0.06
        ? THREE.MathUtils.clamp(
            THREE.MathUtils.lerp(CABLE_HIT_BOUNCE_MIN * 0.5, CABLE_HIT_BOUNCE_MIN, Math.random()),
            0,
            CABLE_HIT_BOUNCE_MAX,
          )
        : 0;
  applyCableTipImpulse(_hitClosest, _hitDir, linMag, yawMag, bounceY, spinShare);
  _cableHitLatched = true;
  _cableHitCool = CABLE_HIT_COOLDOWN;
}

function respawnCarOnTable() {
  carPhysState = CAR_PHYS.RESPAWNING;
  carFloorTimer = 0;
  carLandedAtMs = 0;
  carImpactSettle = 0;
  carImpactAge = 0;
  carImpactLin0 = 0;
  carImpactYaw0 = 0;
  carImpactSpinShare = 0.5;
  _cableHitLatched = false;
  carState.speed = 0;
  carState.steerAngle = 0;
  carState.angle = carSpawnAngle;
  carState._brakeTime = 0;
  clearCarBump();
  car.position.copy(tableSpawn);
  car.quaternion.setFromAxisAngle(_flatUp, carSpawnAngle);
  if (carPhysBody) {
    carPhysBody.velocity.set(0, 0, 0);
    carPhysBody.angularVelocity.set(0, 0, 0);
    carPhysBody.force.set(0, 0, 0);
    carPhysBody.torque.set(0, 0, 0);
    carPhysBody.linearDamping = 0.08;
    carPhysBody.angularDamping = 0.28;
    carPhysBody.linearFactor.set(1, 1, 1);
    carPhysBody.angularFactor.set(1, 1, 1);
    carPhysBody.collisionFilterMask = PHYS_GROUP_TABLE | PHYS_GROUP_FLOOR;
    carPhysBody.type = CANNON.Body.KINEMATIC;
    carPhysBody.updateMassProperties();
    syncCarBodyFromMesh();
  }
  carSpawnGrace = 0.4;
  _physAcc = 0;
  stopCarHitSparks();
  carPhysState = CAR_PHYS.DRIVING;
}

function _carUsesPhysicsWorld() {
  return (
    !!carPhysBody &&
    !_activeCarCtx.parked && // knocked off and lost below the floor: out of the world
    (carPhysState === CAR_PHYS.FALLING ||
      carPhysState === CAR_PHYS.LANDED ||
      carPhysState === CAR_PHYS.IMPACT)
  );
}

/**
 * Steps the shared physics world once for all cars (it used to be stepped from
 * the single car). Each car's IMPACT coast hooks still run around every fixed
 * step, exactly as before, and the post-step state logic runs per car.
 */
function stepCarPhysics(dt) {
  if (!physicsWorld) return;
  const active = [];
  for (let i = 0; i < arenaCars.length; i++) {
    const c = arenaCars[i];
    if (!c.ready) continue;
    if (withCar(c, _carUsesPhysicsWorld)) active.push(c);
  }
  if (!active.length) {
    _physAcc = 0;
    return;
  }
  const preStep = () => {
    if (carPhysState === CAR_PHYS.IMPACT) applyImpactCoastDamping();
  };
  const postStep = () => {
    if (carPhysState === CAR_PHYS.IMPACT) applyImpactYawHeading(PHYS_FIXED_DT);
  };
  for (let i = 0; i < active.length; i++) withCar(active[i], preStep);
  _physAcc += dt;
  _physAcc = Math.min(_physAcc, 0.08);
  while (_physAcc >= PHYS_FIXED_DT) {
    for (let i = 0; i < active.length; i++) withCar(active[i], preStep);
    physicsWorld.step(PHYS_FIXED_DT);
    for (let i = 0; i < active.length; i++) withCar(active[i], postStep);
    _physAcc -= PHYS_FIXED_DT;
  }
  for (let i = 0; i < active.length; i++) {
    withCar(active[i], () => stepCarPhysicsPost(dt));
  }
}

function stepCarPhysicsPost(dt) {
  if (!carPhysBody) return;
  if (carPhysState === CAR_PHYS.IMPACT) {
    applyImpactYawHeading(0);
    carImpactAge += dt;
    const spd = Math.hypot(carPhysBody.velocity.x, carPhysBody.velocity.z);
    const yaw = Math.abs(carPhysBody.angularVelocity.y);
    const restY = tableSurfaceY + carBottomOffsetY;
    const hopping =
      car.position.y > restY + 0.02 || Math.abs(carPhysBody.velocity.y) > 0.35;
    if (carImpactAge > 0.28 && spd < 0.16 && yaw < 0.18 && !hopping) {
      carImpactSettle += dt;
    } else if (spd >= 0.16 || yaw >= 0.18 || hopping) {
      carImpactSettle = 0;
    }
    if (carImpactSettle > 0.22 || carImpactAge > 1.85) {
      restoreDrivingFromImpact();
    } else if (carSpawnGrace <= 0 && isCarOffTablePlate()) {
      beginCarFall();
    }
    return;
  }
  syncCarMeshFromBody();
  const onFloor =
    physicsBodiesTouching(carPhysBody, floorPhysBody) ||
    carPhysBody.position.y - carPhysHalf.y <= floorTopY + 0.03;
  if (
    carPhysState === CAR_PHYS.FALLING &&
    onFloor &&
    carPhysBody.velocity.y <= 1.2
  ) {
    carPhysState = CAR_PHYS.LANDED;
    carFloorTimer = 0;
    carLandedAtMs = performance.now();
  }
  if (carPhysState === CAR_PHYS.LANDED) {
    carFloorTimer = (performance.now() - carLandedAtMs) / 1000;
    // A knocked-off car stays on the floor (out of the round); others respawn.
    if (carFloorTimer >= CAR_FLOOR_RESPAWN_SEC && !_activeCarCtx.out) respawnCarOnTable();
  }
  if (car.position.y < floorTopY - 4) {
    if (_activeCarCtx.out) parkKnockedOffCar();
    else respawnCarOnTable();
  }
}

function updateCar(dt) {
  if (!_carReady) return;
  if (carSpawnGrace > 0) carSpawnGrace = Math.max(0, carSpawnGrace - dt);
  if (car.userData.brakeLightMesh) {
    const bl = car.userData.brakeLightMesh;
    bl.material = keys.brake ? bl._brakeMat : bl._offMat;
  }
  const driven = carPhysState === CAR_PHYS.DRIVING;
  if (driven) {
    let targetSpeed = 0;
    if (keys.forward) targetSpeed = carState.maxSpeed;
    if (keys.reverse) {
      if (carState.speed > 0.3) targetSpeed = 0;
      else targetSpeed = -carState.maxSpeed * 0.85;
    }
    if (keys.forward && keys.reverse) targetSpeed = 0;
    if (keys.brake) targetSpeed = 0;
    if (keys.brake && Math.abs(carState.speed) > 0.04) {
      carState._brakeTime += dt;
      const brakeRamp = Math.min(carState._brakeTime / 1.2, 1);
      const brakePower = 8 + brakeRamp * 30;
      carState.speed -=
        Math.sign(carState.speed) *
        Math.min(Math.abs(carState.speed), brakePower * dt);
    } else {
      carState._brakeTime = 0;
    }
    if (!keys.brake && keys.reverse && carState.speed > 0.3) {
      carState.speed = Math.max(
        0,
        carState.speed - (carState.brakeDecelReverseKey || carState.brakeDecel) * dt,
      );
    } else if (
      Math.abs(carState.speed) > 0.3 &&
      !keys.forward &&
      !keys.reverse
    ) {
      carState.speed *= carState.friction;
    } else if (!keys.brake) {
      carState.speed +=
        (targetSpeed - carState.speed) *
        (1 - Math.exp(-carState.accel * 0.04 * dt));
    }
    if (
      Math.abs(carState.speed) < 0.04 &&
      !keys.forward &&
      !keys.reverse
    ) {
      carState.speed = 0;
    }
    let steerTarget = 0;
    if (keys.left) steerTarget = -MAX_STEER_RAD;
    if (keys.right) steerTarget = MAX_STEER_RAD;
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
    const moving = Math.abs(carState.speed) > 0.08;
    const steering = Math.abs(carState.steerAngle) > 0.006;
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
    integrateCarBump(dt);
    car.position.y = tableSurfaceY + carBottomOffsetY;
    _quatY.setFromAxisAngle(_flatUp, carState.angle);
    car.quaternion.copy(_quatY);
    syncCarBodyFromMesh();
    if (carSpawnGrace <= 0 && isCarOffTablePlate()) beginCarFall();
  } else if (
    carPhysState === CAR_PHYS.FALLING ||
    carPhysState === CAR_PHYS.LANDED ||
    carPhysState === CAR_PHYS.IMPACT
  ) {
    if (carPhysState === CAR_PHYS.IMPACT && carPhysBody) {
      const fwdX = Math.sin(carState.angle);
      const fwdZ = Math.cos(carState.angle);
      carState.speed =
        carPhysBody.velocity.x * fwdX + carPhysBody.velocity.z * fwdZ;
    } else {
      carState.speed *= Math.exp(-dt * 1.6);
      if (Math.abs(carState.speed) < 0.04) carState.speed = 0;
    }
    carState.steerAngle *= Math.exp(-dt * 4);
  }
  carState.wheelAngle =
    (carState.wheelAngle + (carState.speed * dt) / WHEEL_RADIUS) %
    (Math.PI * 2);
  _quatWheelRoll.setFromAxisAngle(_axisWheelRoll, carState.wheelAngle);
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
    const airInTarget = driven && keys.forward ? 1 : 0;
    for (const part of airInParts) {
      if (!part?.baseQuat || !part?.openQuat) continue;
      if (part._airInTarget !== airInTarget) {
        part._airInTarget = airInTarget;
        part._airInDelayLeft = airInTarget ? part.openDelay : part.closeDelay;
      }
      if (part._airInDelayLeft > 0) {
        part._airInDelayLeft = Math.max(0, part._airInDelayLeft - dt);
      } else {
        part.openT +=
          (airInTarget - part.openT) * (1 - Math.exp(-dt * AIR_IN_ROT_SPEED));
      }
      part.quaternion.slerpQuaternions(part.baseQuat, part.openQuat, part.openT);
    }
  }
  car.userData.physState = carPhysState;
  car.userData.floorTimer = carFloorTimer;
  car.userData.physSpd = carPhysBody
    ? Math.hypot(carPhysBody.velocity.x, carPhysBody.velocity.z)
    : 0;
  car.userData.physYaw = carPhysBody ? carPhysBody.angularVelocity.y : 0;
  car.userData.physHeading = carState.angle;
  car.userData.cablePhase = _freeCable ? _freeCable.phase : "";
  car.userData.cableLunge = _freeCable ? _freeCable.lunge : 0;
}

const FLAME_EFFECT_PARTICLE_COUNT = 60;
const FLAME_EFFECT_SPREAD = 0.06;
const FLAME_EFFECT_SIZE = 320;
const FLAME_EFFECT_RISE_SPEED = 2.5;
const EXHAUST_DURATION = 1.5;
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
let exhaustEffects = [];
let exhaustActive = false;
let exhaustStartTime = 0;
let _carWasStopped = true;
let _exhFlickerTimers = [0, 0];
let _exhFlickerTargets = [1, 1];
let _exhFlickerValues = [1, 1];
let _exhFlickerNextChange = [0, 0];

// ---------------------------------------------------------------------------
// Arena car contexts.
// Every car (player + AI) is a real instance of the same car: it owns a full
// copy of the per-car state below, and the existing drive / physics / fall /
// cable-hit functions run on whichever car is loaded into the module globals.
// withCar(ctx, fn) swaps a car in, runs fn, and swaps the previous car back.
// The player's car is the default loaded car, so all player-only code
// (camera, keyboard, spot lights, table glows) is unaffected.
// ---------------------------------------------------------------------------
function _makeDefaultCarState() {
  return {
    speed: 0,
    angle: 0,
    steerAngle: 0,
    wheelAngle: 0,
    maxSpeed: 4.2,
    accel: 22,
    brakeDecel: 92,
    brakeDecelReverseKey: 620,
    friction: 0.92,
    steerSpeed: 5.2,
    turnRate: 18,
    _brakeTime: 0,
  };
}

function _saveCarCtx(c) {
  c.car = car;
  c.carState = carState;
  c.keys = keys;
  c.halfW = halfW;
  c.halfL = halfL;
  c.storedCarScale = storedCarScale;
  c.carBottomOffsetY = carBottomOffsetY;
  c.tableSpawn = tableSpawn;
  c.carSpawnAngle = carSpawnAngle;
  c.carBumpVelX = carBumpVelX;
  c.carBumpVelZ = carBumpVelZ;
  c.carBumpYaw = carBumpYaw;
  c.carPhysBody = carPhysBody;
  c.carPhysState = carPhysState;
  c.carFloorTimer = carFloorTimer;
  c.carLandedAtMs = carLandedAtMs;
  c.carSpawnGrace = carSpawnGrace;
  c.carImpactSettle = carImpactSettle;
  c.carImpactAge = carImpactAge;
  c.carImpactLin0 = carImpactLin0;
  c.carImpactYaw0 = carImpactYaw0;
  c.carImpactSpinShare = carImpactSpinShare;
  c._carHitSpark = _carHitSpark;
  c._impactKickDir = _impactKickDir;
  c._cableHitLatched = _cableHitLatched;
  c._cableHitCool = _cableHitCool;
  c._cableTipPrevValid = _cableTipPrevValid;
  c._cableTipPrev = _cableTipPrev;
  c.carPhysLocalCenter = carPhysLocalCenter;
  c.carPhysHalf = carPhysHalf;
  c.wheelFL = wheelFL;
  c.wheelFR = wheelFR;
  c.wheelRL = wheelRL;
  c.wheelRR = wheelRR;
  c.airInParts = airInParts;
  c.exhaustEffects = exhaustEffects;
  c.exhaustActive = exhaustActive;
  c.exhaustStartTime = exhaustStartTime;
  c._carWasStopped = _carWasStopped;
  c._exhFlickerTimers = _exhFlickerTimers;
  c._exhFlickerTargets = _exhFlickerTargets;
  c._exhFlickerValues = _exhFlickerValues;
  c._exhFlickerNextChange = _exhFlickerNextChange;
}

function _loadCarCtx(c) {
  car = c.car;
  carState = c.carState;
  keys = c.keys;
  halfW = c.halfW;
  halfL = c.halfL;
  storedCarScale = c.storedCarScale;
  carBottomOffsetY = c.carBottomOffsetY;
  tableSpawn = c.tableSpawn;
  carSpawnAngle = c.carSpawnAngle;
  carBumpVelX = c.carBumpVelX;
  carBumpVelZ = c.carBumpVelZ;
  carBumpYaw = c.carBumpYaw;
  carPhysBody = c.carPhysBody;
  carPhysState = c.carPhysState;
  carFloorTimer = c.carFloorTimer;
  carLandedAtMs = c.carLandedAtMs;
  carSpawnGrace = c.carSpawnGrace;
  carImpactSettle = c.carImpactSettle;
  carImpactAge = c.carImpactAge;
  carImpactLin0 = c.carImpactLin0;
  carImpactYaw0 = c.carImpactYaw0;
  carImpactSpinShare = c.carImpactSpinShare;
  _carHitSpark = c._carHitSpark;
  _impactKickDir = c._impactKickDir;
  _cableHitLatched = c._cableHitLatched;
  _cableHitCool = c._cableHitCool;
  _cableTipPrevValid = c._cableTipPrevValid;
  _cableTipPrev = c._cableTipPrev;
  carPhysLocalCenter = c.carPhysLocalCenter;
  carPhysHalf = c.carPhysHalf;
  wheelFL = c.wheelFL;
  wheelFR = c.wheelFR;
  wheelRL = c.wheelRL;
  wheelRR = c.wheelRR;
  airInParts = c.airInParts;
  exhaustEffects = c.exhaustEffects;
  exhaustActive = c.exhaustActive;
  exhaustStartTime = c.exhaustStartTime;
  _carWasStopped = c._carWasStopped;
  _exhFlickerTimers = c._exhFlickerTimers;
  _exhFlickerTargets = c._exhFlickerTargets;
  _exhFlickerValues = c._exhFlickerValues;
  _exhFlickerNextChange = c._exhFlickerNextChange;
}

function _newCarCtx(group, keyState) {
  return {
    car: group,
    carState: _makeDefaultCarState(),
    keys: keyState,
    halfW: 0.6,
    halfL: 1.0,
    storedCarScale: 0.5,
    carBottomOffsetY: 0,
    tableSpawn: new THREE.Vector3(),
    carSpawnAngle: 0,
    carBumpVelX: 0,
    carBumpVelZ: 0,
    carBumpYaw: 0,
    carPhysBody: null,
    carPhysState: CAR_PHYS.DRIVING,
    carFloorTimer: 0,
    carLandedAtMs: 0,
    carSpawnGrace: 0,
    carImpactSettle: 0,
    carImpactAge: 0,
    carImpactLin0: 0,
    carImpactYaw0: 0,
    carImpactSpinShare: 0.5,
    _carHitSpark: null,
    _impactKickDir: new THREE.Vector3(),
    _cableHitLatched: false,
    _cableHitCool: 0,
    _cableTipPrevValid: false,
    _cableTipPrev: new THREE.Vector3(),
    carPhysLocalCenter: new THREE.Vector3(),
    carPhysHalf: new THREE.Vector3(),
    wheelFL: null,
    wheelFR: null,
    wheelRL: null,
    wheelRR: null,
    airInParts: [],
    exhaustEffects: [],
    exhaustActive: false,
    exhaustStartTime: 0,
    _carWasStopped: true,
    _exhFlickerTimers: [0, 0],
    _exhFlickerTargets: [1, 1],
    _exhFlickerValues: [1, 1],
    _exhFlickerNextChange: [0, 0],
    ready: false,
    isPlayer: false,
    ai: null,
  };
}

const _playerCarCtx = {};
_saveCarCtx(_playerCarCtx);
_playerCarCtx.ready = false;
_playerCarCtx.isPlayer = true;
_playerCarCtx.ai = null;
let _activeCarCtx = _playerCarCtx;
/** All arena cars, player first. AI cars are appended once loaded. */
const arenaCars = [_playerCarCtx];

function withCar(ctx, fn) {
  if (!ctx || ctx === _activeCarCtx) return fn();
  const prev = _activeCarCtx;
  _saveCarCtx(prev);
  _loadCarCtx(ctx);
  _activeCarCtx = ctx;
  try {
    return fn();
  } finally {
    _saveCarCtx(ctx);
    _loadCarCtx(prev);
    _activeCarCtx = prev;
  }
}

/** Make the ctx objects' scalar fields current for the loaded car. */
function _syncActiveCarCtx() {
  _saveCarCtx(_activeCarCtx);
}

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
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uSize: { value: FLAME_EFFECT_SIZE },
      uTime: { value: 0 },
      uFade: { value: 1 },
    },
    vertexShader: flameEffectVertexShader,
    fragmentShader: flameEffectFragmentShader,
  });
  const points = new THREE.Points(geo, mat);
  return {
    points,
    rise,
    spread,
    count,
    posAttr: geo.attributes.position,
  };
}

const KITCHEN_CAR_CAM_DIST = 0.78;
const MEETING_FLAME_SIZE_TUNE = 0.68;

function meetingKitchenFlameScale() {
  return storedCarScale / KITCHEN_CAR_SCALE;
}

function meetingFlameViewDist() {
  if (!camera || !car) return 3.8;
  return Math.max(KITCHEN_CAR_CAM_DIST, camera.position.distanceTo(car.position));
}

function kitchenMatchedFlameSize() {
  const flameScale = meetingKitchenFlameScale();
  const framing = meetingFlameViewDist() / KITCHEN_CAR_CAM_DIST;
  return (
    FLAME_EFFECT_SIZE * 0.14 * flameScale * framing * MEETING_FLAME_SIZE_TUNE
  );
}

function kitchenMatchedFlameVisualScale() {
  return (
    Math.sqrt(meetingFlameViewDist() / KITCHEN_CAR_CAM_DIST) *
    MEETING_FLAME_SIZE_TUNE
  );
}

function setupExhaustEffects(carScene) {
  exhaustEffects = [];
  const names = ["egzozLightLeft", "egzozLightRight"];
  const EXHAUST_SPREAD_SCALE = 0.22;
  const anchors = [];
  for (const name of names) {
    const mesh = carScene.getObjectByName(name);
    if (mesh?.parent) anchors.push(mesh);
  }
  if (!anchors.length) {
    const fallback = carScene.getObjectByName("egzoz");
    if (fallback?.parent) anchors.push(fallback);
  }
  for (const mesh of anchors) {
    const effect = createSmallFireEffect();
    effect.anchorMesh = mesh;
    effect.points.material.uniforms.uSize.value = kitchenMatchedFlameSize();
    effect.points.scale.setScalar(kitchenMatchedFlameVisualScale());
    effect.points.rotation.x = -Math.PI / 2;
    effect.points.renderOrder = 2;
    effect.points.frustumCulled = false;
    effect.points.visible = false;
    for (let i = 0; i < effect.spread.length; i++) {
      effect.spread[i] *= EXHAUST_SPREAD_SCALE;
    }
    mesh.parent.add(effect.points);
    exhaustEffects.push(effect);
  }
}

function updateExhaustEffects(dt) {
  if (exhaustEffects.length === 0) return;
  const nowSec = clock.elapsedTime;
  const carMoving = _carReady && Math.abs(carState.speed) > 0.3;
  if (carMoving && _carWasStopped) {
    exhaustActive = true;
    exhaustStartTime = nowSec;
  }
  _carWasStopped = !carMoving;
  const exhaustElapsed = nowSec - exhaustStartTime;
  const burstOn = exhaustActive && exhaustElapsed < EXHAUST_DURATION;
  if (exhaustActive && exhaustElapsed >= EXHAUST_DURATION) exhaustActive = false;
  const cruiseOn = carMoving;
  if (!burstOn && !cruiseOn) {
    for (const ef of exhaustEffects) ef.points.visible = false;
    return;
  }
  const localProgress = burstOn
    ? Math.max(0, Math.min(1, exhaustElapsed / EXHAUST_DURATION))
    : 1;
  const baseFade = burstOn ? 1 - Math.pow(localProgress, 0.5) : 0.7;
  const risePhase = 0.25;
  const easeIn = Math.min(
    1,
    (localProgress / risePhase) * (localProgress / risePhase),
  );
  const stretchY = 1 + (1 - easeIn) * 1.4;
  for (let ei = 0; ei < exhaustEffects.length; ei++) {
    const ef = exhaustEffects[ei];
    if (!Number.isFinite(_exhFlickerValues[ei])) _exhFlickerValues[ei] = 1;
    if (!Number.isFinite(_exhFlickerTargets[ei])) _exhFlickerTargets[ei] = 1;
    _exhFlickerTimers[ei] += dt;
    if (_exhFlickerTimers[ei] >= _exhFlickerNextChange[ei]) {
      _exhFlickerTimers[ei] = 0;
      const startBoost = Math.pow(1 - localProgress, 1.8);
      const burstProb = 0.22 + 0.45 * startBoost;
      const offMin = 0.14 - 0.1 * startBoost;
      const offRange = 0.32 - 0.22 * startBoost;
      const burst = Math.random() < burstProb;
      _exhFlickerTargets[ei] = burst ? 0.85 + Math.random() * 0.15 : 0.0;
      _exhFlickerNextChange[ei] = burst
        ? 0.015 + Math.random() * 0.04
        : offMin + Math.random() * offRange;
    }
    const snapSpeed = _exhFlickerTargets[ei] > 0.5 ? 80 : 65;
    _exhFlickerValues[ei] +=
      (_exhFlickerTargets[ei] - _exhFlickerValues[ei]) * Math.min(1, dt * snapSpeed);
    const fade = baseFade * _exhFlickerValues[ei];
    ef.points.visible = fade > 0.05;
    ef.points.position.copy(ef.anchorMesh.position);
    ef.points.position.z -= 0.35;
    ef.points.scale.setScalar(kitchenMatchedFlameVisualScale());
    ef.points.material.uniforms.uSize.value = kitchenMatchedFlameSize();
    ef.points.material.uniforms.uFade.value = fade;
    ef.points.material.uniforms.uTime.value = nowSec;
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

let tableLightGlows = [];
const _carLightBarMeshes = [];
let _tableLightGlowTex = null;
let _tableRearLightGlowTex = null;
let _tableHeadlightBeamTex = null;
let _tableLightGlowGeo = null;
let _tableHeadlightBeamGeo = null;
const HEADLIGHT_BEAM_ASPECT = 652 / 326;
const _lightGlowPoint = new THREE.Vector3();
const _beamFrontPoint = new THREE.Vector3();
const _beamRearPoint = new THREE.Vector3();
const _tabletFaceFlat = new THREE.Vector3();

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

function getTableRearLightGlowTexture() {
  if (_tableRearLightGlowTex) return _tableRearLightGlowTex;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(255,255,255,0.42)");
  g.addColorStop(0.22, "rgba(255,255,255,0.22)");
  g.addColorStop(0.5, "rgba(255,255,255,0.08)");
  g.addColorStop(0.78, "rgba(255,255,255,0.02)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  _tableRearLightGlowTex = new THREE.CanvasTexture(c);
  _tableRearLightGlowTex.needsUpdate = true;
  return _tableRearLightGlowTex;
}

function getMeshFlatFaceDir(mesh, out) {
  mesh.updateWorldMatrix(true, false);
  const e = mesh.matrixWorld.elements;
  out.set(e[8], 0, e[10]);
  if (out.lengthSq() < 1e-8) out.set(1, 0, 0);
  else out.normalize();
  return out;
}

function getTableHeadlightBeamGeometry() {
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

function createTableLightGlowSprite(tint, baseSize, kind = "") {
  if (!_tableLightGlowGeo) {
    _tableLightGlowGeo = new THREE.PlaneGeometry(1, 1);
    _tableLightGlowGeo.rotateX(-Math.PI / 2);
  }
  const mat = new THREE.MeshBasicMaterial({
    map:
      kind === "front"
        ? getTableHeadlightBeamTexture()
        : kind === "rear"
          ? getTableRearLightGlowTexture()
          : getTableLightGlowTexture(),
    color: kind === "front" ? 0xffffff : tint,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8,
    stencilWrite: false,
    stencilFunc: THREE.AlwaysStencilFunc,
  });
  const glowPlane = new THREE.Mesh(
    kind === "front" ? getTableHeadlightBeamGeometry() : _tableLightGlowGeo,
    mat,
  );
  glowPlane.name = kind ? `tableLightGlow_${kind}` : "tableLightGlow";
  glowPlane.scale.set(baseSize, 1, baseSize * 0.72);
  glowPlane.visible = false;
  glowPlane.frustumCulled = false;
  glowPlane.renderOrder = 2;
  scene.add(glowPlane);
  return glowPlane;
}

const _carLightFwd = new THREE.Vector3();
const _carLightRight = new THREE.Vector3();
const _lightGlowBox = new THREE.Box3();
const _lightGlowCenter = new THREE.Vector3();
const _lightGlowCorner = new THREE.Vector3();
const _lampCarBox = new THREE.Box3();

function updateCarLightAxes() {
  _carLightFwd.set(Math.sin(carState.angle), 0, Math.cos(carState.angle));
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
    entry._worldLampSpan = Math.max(0.02, span * Math.abs(axisScale));
  }
  out.y = tableY;
  return out;
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
    if (spec.kind === "front") {
      tableLightGlows.push({
        mesh,
        sprite: createTableLightGlowSprite(spec.color, spec.size, spec.kind),
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
    }
  }
  _carLightBarMeshes.length = 0;
  carRoot.traverse((node) => {
    if (!node.isMesh || node.name !== "lightBar1") return;
    _carLightBarMeshes.push(node);
  });
}

function getHeadlightBeamCarLength(tableY) {
  let front = null;
  let rear = null;
  for (let gi = 0; gi < tableLightGlows.length; gi++) {
    const e = tableLightGlows[gi];
    if (!front && e.kind === "front") front = e;
    if (!rear && (e.kind === "rear" || e.kind === "brake")) rear = e;
  }
  if (!front || !rear) return Math.max(0.12, 2.4 * car.scale.x);
  getMeshTableReflectionPoint(front, tableY, _beamFrontPoint);
  getMeshTableReflectionPoint(rear, tableY, _beamRearPoint);
  return Math.max(0.12, _beamFrontPoint.distanceTo(_beamRearPoint));
}

function updateTableLightReflections() {
  const tableY = tableSurfaceY;
  const dark = 1 - lightBlend;
  if (!tableLightGlows.length || !_carReady) {
    for (let gi = 0; gi < tableLightGlows.length; gi++) {
      tableLightGlows[gi].sprite.visible = false;
    }
  } else {
    updateCarLightAxes();
    updateCarLampSpotAim();
    const carYaw = carState.angle;
    const worldHalfW = Math.max(0.04, halfW * storedCarScale);
    const worldHalfL = Math.max(0.04, halfL * storedCarScale);
    for (let gi = 0; gi < tableLightGlows.length; gi++) {
      const entry = tableLightGlows[gi];
      let alpha = 0;
      if (entry.kind === "front") alpha = 0.045 + dark * 0.07;
      else if (entry.kind === "rear") alpha = 0.3;
      else if (entry.kind === "brake") alpha = keys.brake ? 0.92 : 0.18;
      else if (entry.kind === "bar") alpha = 0.38;
      if (alpha < 0.02) {
        entry.sprite.visible = false;
        continue;
      }
      getMeshTableReflectionPoint(entry, tableY, _lightGlowPoint);
      entry.sprite.rotation.set(0, carYaw, 0);
      const lampSpan = entry._worldLampSpan || worldHalfW * 0.5;
      if (entry.kind === "front") {
        const beamWidth = Math.max(0.36, lampSpan * 2.4);
        const beamLength = beamWidth * HEADLIGHT_BEAM_ASPECT;
        _lightGlowPoint.addScaledVector(_carLightFwd, beamLength * 0.58);
        entry.sprite.scale.set(beamWidth * 1.2, 1, beamLength);
      } else if (entry.kind === "rear") {
        const sc = Math.max(0.2, Math.min(lampSpan * 1.55, worldHalfW * 1.7));
        _lightGlowPoint.addScaledVector(
          _carLightFwd,
          -Math.max(0.09, worldHalfL * 0.42),
        );
        entry.sprite.scale.set(sc * 1.25, 1, sc * 1.75);
      } else {
        const sc = Math.max(0.05, Math.min(lampSpan * 0.45, worldHalfW * 0.5));
        entry.sprite.scale.set(sc, 1, sc * 0.85);
      }
      _lightGlowPoint.y = tableY;
      entry.sprite.position.copy(_lightGlowPoint);
      entry.sprite.material.opacity = alpha;
      entry.sprite.visible = true;
    }
  }
}

function syncCarCamera() {
  if (!_carFollowCam || !_carReady) return;
  _carLook.copy(car.position);
  _carLook.y += 0.28 * Math.max(0.2, storedCarScale);
  _carCamOffset.copy(camera.position).sub(controls.target);
  if (_carCamOffset.lengthSq() < 1e-6) _carCamOffset.set(3.8, 0.9, 0);
  controls.target.copy(_carLook);
  camera.position.copy(_carLook).add(_carCamOffset);
}

function getCarLocalTableY() {
  _lightGlowCorner.set(car.position.x, tableSurfaceY, car.position.z);
  car.worldToLocal(_lightGlowCorner);
  return _lightGlowCorner.y;
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
    1.8,
    distance,
    Math.PI / 3.15,
  );
  attachCarLampSpots(
    carRoot.getObjectByName("rearLights"),
    0xff2a2a,
    -1,
    "rear",
    1.5,
    distance * 0.72,
    Math.PI / 5.2,
  );
}

function getMeshBoxInCarLocal(mesh, outBox) {
  mesh.updateWorldMatrix(true, false);
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  outBox.makeEmpty();
  for (let ix = 0; ix < 2; ix++) {
    for (let iy = 0; iy < 2; iy++) {
      for (let iz = 0; iz < 2; iz++) {
        _lightGlowCorner.set(
          ix ? box.max.x : box.min.x,
          iy ? box.max.y : box.min.y,
          iz ? box.max.z : box.min.z,
        );
        mesh.localToWorld(_lightGlowCorner);
        car.worldToLocal(_lightGlowCorner);
        outBox.expandByPoint(_lightGlowCorner);
      }
    }
  }
  return outBox;
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

function loadKitchenCarOnTable() {
  if (!captureTableDriveSurface(_model)) {
    console.warn("[MeetingRoom] tablePlate missing, car not loaded");
    return;
  }
  const loader = new GLTFLoader();
  loader.setResourcePath(_OFFICE_BASE);
  loader.load(
    officeAsset("car-game14.gltf"),
    (carGltf) => {
      const pristineCarScene = carGltf.scene;
      // Clone before the player build mutates materials / hierarchy so every
      // AI car starts from the exact same source model.
      const aiCarScenes = ARENA_AI_CARS.map(() => pristineCarScene.clone(true));
      _playerCarCtx.isPlayer = true;
      const spawns = computeArenaSpawns();
      buildArenaCar(pristineCarScene, {
        player: true,
        spawnOffsetX: spawns.player.x,
        spawnOffsetZ: spawns.player.z,
        spawnAngle: spawns.player.angle,
      });
      spawnArenaAiCars(aiCarScenes, spawns.ai);
    },
    undefined,
    (err) => console.error("[MeetingRoom] Car GLTF load failed.", err),
  );
}

/**
 * Builds one car instance from a car GLTF scene into the currently loaded car
 * context. The player and the AI cars all go through this same function.
 */
function buildArenaCar(carScene, opts = {}) {
      const isPlayer = !!opts.player;
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
      if (opts.paintColor != null) carAirInRedPaintMat.color.setHex(opts.paintColor);
      const bodyPaintCache = new Map();
      carScene.visible = true;
      carScene.traverse((node) => {
        if (isCarPhysicsPart(node.name)) {
          node.visible = false;
          return;
        }
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = false;
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const mat of mats) {
          if (!mat || (!mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial)) continue;
          if (mat.metalness > 0.7) mat.metalness = 0.22;
        }
        if (opts.paintColor != null) {
          // AI cars: same body material, own color (materials are shared by clone()).
          const recolor = (mat) => {
            if (!mat || !/^carBody/i.test(mat.name || "")) return mat;
            let painted = bodyPaintCache.get(mat);
            if (!painted) {
              painted = mat.clone();
              painted.color.setHex(opts.paintColor);
              bodyPaintCache.set(mat, painted);
            }
            return painted;
          };
          node.material = Array.isArray(node.material)
            ? node.material.map(recolor)
            : recolor(node.material);
        }
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
          applySceneEnvironmentToMaterial(node.material);
        }
        if (node.name === "airInBase") node.material = carAirInChromeMat;
        if (
          node.name === "airIn1" ||
          node.name === "airIn2" ||
          node.name === "airIn3"
        ) {
          node.material = carAirInRedPaintMat;
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
            _lbParent.add(clone);
          }
        }
      }
      car.add(carScene);
      car.visible = true;
      setupExhaustEffects(carScene);
      ["canon-fl", "canon-fr", "canon-rl", "canon-rr", "canon-body"].forEach(
        (name) => {
          const mesh = car.getObjectByName(name);
          if (mesh) mesh.visible = false;
        },
      );
      car.updateMatrixWorld(true);
      boxFromVisibleMeshes(car, _visBox);
      const sizeNorm = _visBox.getSize(new THREE.Vector3());
      const targetLength = 2.4;
      const normScale = targetLength / Math.max(0.01, sizeNorm.z);
      carScene.scale.multiplyScalar(normScale);
      car.updateMatrixWorld(true);
      boxFromVisibleMeshes(car, _visBox);
      const centerNorm = _visBox.getCenter(new THREE.Vector3());
      carScene.position.sub(centerNorm);
      car.updateMatrixWorld(true);
      boxFromVisibleMeshes(car, _visBox);
      halfW = (_visBox.max.x - _visBox.min.x) * 0.5;
      halfL = (_visBox.max.z - _visBox.min.z) * 0.5;
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
        if (cover && wheel) wheel.attach(cover);
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
      const tableMinSize = Math.min(tablePlateHalfX, tablePlateHalfZ) * 2;
      const carScale =
        Math.max(0.05, Math.min(1, (tableMinSize * 0.2) / 2)) *
        CAR_SCALE_MULTIPLIER;
      car.scale.set(carScale, carScale, carScale);
      storedCarScale = carScale;
      if (isPlayer) fitCarShadowCamera();
      for (const ef of exhaustEffects) {
        ef.points.scale.setScalar(kitchenMatchedFlameVisualScale());
        ef.points.material.uniforms.uSize.value = kitchenMatchedFlameSize();
      }
      carState.maxSpeed = Math.max(1.8, Math.min(4.8, tableMinSize * 0.85));
      const spawnX = tablePlateCenter.x + (opts.spawnOffsetX || 0);
      const spawnZ = tablePlateCenter.z + (opts.spawnOffsetZ || 0);
      car.position.set(spawnX, tableSurfaceY, spawnZ);
      car.quaternion.identity();
      carState.angle = 0;
      car.updateMatrixWorld(true);
      const wheels = [wheelFL, wheelFR, wheelRL, wheelRR];
      let lowestWheelBottom = Infinity;
      for (const w of wheels) {
        if (!w) continue;
        const wBox = new THREE.Box3().setFromObject(w);
        if (!wBox.isEmpty()) {
          lowestWheelBottom = Math.min(lowestWheelBottom, wBox.min.y);
        }
      }
      if (!Number.isFinite(lowestWheelBottom)) {
        const bodyBox = new THREE.Box3().setFromObject(car);
        lowestWheelBottom = bodyBox.min.y;
      }
      carBottomOffsetY = Math.max(0, tableSurfaceY - lowestWheelBottom);
      tableSpawn.set(spawnX, tableSurfaceY + carBottomOffsetY, spawnZ);
      car.position.copy(tableSpawn);
      car.updateMatrixWorld(true);
      setupCarPhysicsBody();
      carSpawnAngle = opts.spawnAngle || 0;
      if (carSpawnAngle) {
        carState.angle = carSpawnAngle;
        car.quaternion.setFromAxisAngle(_flatUp, carSpawnAngle);
        car.updateMatrixWorld(true);
        syncCarBodyFromMesh();
      }
      if (isPlayer) {
        attachCarHeadTailSpotLights(car);
        setupTableLightReflections(car);
      }
      setupCarHitSparks();
      patchCarMaterialLighting(car);
      _activeCarCtx.ready = true;
      if (!isPlayer) return;
      _carFollowCam = false;
      controls.enabled = true;
      controls.minDistance = 0.4;
      controls.maxDistance = 12;
      if (_model) frameMeetingRoomInterior(_model);
      _carReady = true;
      applyLightBlend(lightBlend);
}

function resize() {
  const mount = getMeetingRoomSceneMount();
  const w = Math.max(1, mount.clientWidth || window.innerWidth);
  const h = Math.max(1, mount.clientHeight || window.innerHeight);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  _sparkSyncResolution();
}

window.addEventListener("resize", resize);
resize();
const _mountForResize = getMeetingRoomSceneMount();
if (_mountForResize && _mountForResize !== document.body) {
  const _meetingRoomResizeObserver = new ResizeObserver(() => resize());
  _meetingRoomResizeObserver.observe(_mountForResize);
}

function firstSourceColor(root, names) {
  const want = new Set(names);
  let color = null;
  root.traverse((node) => {
    if (color || !node.isMesh || !want.has(node.name)) return;
    const mat = Array.isArray(node.material) ? node.material[0] : node.material;
    if (mat?.color) color = mat.color.clone();
  });
  return color;
}

function nameKeys(name) {
  const n = String(name || "");
  return [n, n.replace(/\./g, "_"), n.replace(/_/g, ".")];
}

function assignMaterial(root, names, material, noShadow) {
  const want = new Set();
  for (const name of names) {
    for (const key of nameKeys(name)) want.add(key);
  }
  root.traverse((node) => {
    if (!node.isMesh) return;
    const parentName = node.parent ? node.parent.name : "";
    const hit =
      want.has(node.name) ||
      want.has(parentName) ||
      nameKeys(node.name).some((key) => want.has(key)) ||
      nameKeys(parentName).some((key) => want.has(key));
    if (!hit) return;
    node.material = material;
    if (noShadow) {
      node.castShadow = false;
      node.receiveShadow = false;
    }
  });
}

function loadMeetingRoomTexture(path, isColor, options = {}) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      meetingRoomAsset(path),
      (tex) => {
        tex.wrapS = options.wrapS ?? THREE.RepeatWrapping;
        tex.wrapT = options.wrapT ?? THREE.RepeatWrapping;
        tex.flipY = options.flipY ?? true;
        tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

function loadPoliigon2KMaps(setName) {
  const file = (suffix) =>
    `textures/${setName}/2K/${setName}_${suffix}`;
  return Promise.all([
    loadMeetingRoomTexture(file("BaseColor.jpg"), true),
    loadMeetingRoomTexture(file("Normal.png"), false),
    loadMeetingRoomTexture(file("Roughness.jpg"), false),
    loadMeetingRoomTexture(file("Metallic.jpg"), false),
    loadMeetingRoomTexture(file("AmbientOcclusion.jpg"), false),
    loadMeetingRoomTexture(file("Displacement.png"), false),
  ]).then(
    ([map, normalMap, roughnessMap, metalnessMap, aoMap, displacementMap]) => ({
      map,
      normalMap,
      roughnessMap,
      metalnessMap,
      aoMap,
      displacementMap,
    }),
  );
}

function loadBanjoFigMaps() {
  const file = (suffix, ext) =>
    `textures/${MEETING_ROOM_PLANT}/${MEETING_ROOM_PLANT}_${suffix}_2K_METALNESS.${ext}`;
  const uvMaps = {
    flipY: false,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  };
  return Promise.all([
    loadMeetingRoomTexture(file("COL", "jpg"), true, uvMaps),
    loadMeetingRoomTexture(file("NRM", "png"), false, uvMaps),
    loadMeetingRoomTexture(file("ROUGHNESS", "jpg"), false, uvMaps),
    loadMeetingRoomTexture(file("METALNESS", "png"), false, uvMaps),
  ]).then(([map, normalMap, roughnessMap, metalnessMap]) => ({
    map,
    normalMap,
    roughnessMap,
    metalnessMap,
  }));
}

function setWorldPlanarUVs(mesh, uAxis, vAxis, tileMeters) {
  mesh.updateWorldMatrix(true, true);
  const pos = mesh.geometry.getAttribute("position");
  if (!pos) return;
  const uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    uv.setXY(i, v[uAxis] / tileMeters, v[vAxis] / tileMeters);
  }
  mesh.geometry.setAttribute("uv", uv);
  mesh.geometry.setAttribute("uv2", uv.clone());
}

function setWorldBoxUVs(mesh, tileMeters) {
  mesh.updateWorldMatrix(true, true);
  let geo = mesh.geometry;
  if (geo.index) {
    geo = geo.toNonIndexed();
    mesh.geometry = geo;
  }
  const pos = geo.getAttribute("position");
  if (!pos) return;
  const uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const project = (p, ax, ay, az) => {
    if (ay >= ax && ay >= az) return [p.x / tileMeters, p.z / tileMeters];
    if (ax >= az) return [p.z / tileMeters, p.y / tileMeters];
    return [p.x / tileMeters, p.y / tileMeters];
  };
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos, i + 1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos, i + 2).applyMatrix4(mesh.matrixWorld);
    ab.subVectors(a, b);
    cb.subVectors(c, b);
    n.crossVectors(cb, ab);
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    const ua = project(a, ax, ay, az);
    const ub = project(b, ax, ay, az);
    const uc = project(c, ax, ay, az);
    uv.setXY(i, ua[0], ua[1]);
    uv.setXY(i + 1, ub[0], ub[1]);
    uv.setXY(i + 2, uc[0], uc[1]);
  }
  geo.setAttribute("uv", uv);
  geo.setAttribute("uv2", uv.clone());
}

function setWorldCylindricalUVs(mesh, tileMeters) {
  mesh.updateWorldMatrix(true, true);
  const pos = mesh.geometry.getAttribute("position");
  if (!pos) return;
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.z) * 0.5;
  const uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    const u = (Math.atan2(v.z - center.z, v.x - center.x) * radius) / tileMeters;
    uv.setXY(i, u, v.y / tileMeters);
  }
  mesh.geometry.setAttribute("uv", uv);
  mesh.geometry.setAttribute("uv2", uv.clone());
}

function applyPoliigonWoodMaterial(root, name, maps, uAxis, vAxis, options = {}) {
  const mesh = root.getObjectByName(name);
  if (!mesh || !mesh.isMesh || !maps) return;
  const tileMeters = options.tileMeters ?? MEETING_ROOM_WOOD_TILE_M;
  if (options.uvMode === "cylindricalY") {
    setWorldCylindricalUVs(mesh, tileMeters);
  } else if (options.uvMode === "box") {
    setWorldBoxUVs(mesh, tileMeters);
  } else {
    setWorldPlanarUVs(mesh, uAxis, vAxis, tileMeters);
  }
  const mat = new THREE.MeshStandardMaterial({
    color: options.color ?? 0xffffff,
    map: maps.map,
    normalMap: maps.normalMap,
    roughnessMap: maps.roughnessMap,
    roughness: 1,
    metalnessMap: maps.metalnessMap,
    metalness: options.metalness ?? 1,
    aoMap: maps.aoMap,
    aoMapIntensity: 1,
    displacementMap: maps.displacementMap,
    displacementScale: options.displacementScale ?? 0.008,
    displacementBias: options.displacementBias ?? -0.004,
    envMap: _meetingRoomEnv,
    envMapIntensity: options.envMapIntensity ?? 0.45,
    emissive: options.emissiveIntensity ? options.color ?? 0xffffff : 0x000000,
    emissiveMap: options.emissiveIntensity ? maps.map : null,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    side: THREE.DoubleSide,
  });
  mesh.material = mat;
  if (options.reflective !== false) _reflectiveMats.push(mat);
  return mat;
}

function canvasTextureFromImageData(imageData, isColor) {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext("2d").putImageData(imageData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function makeExpandedMetalDiamondMaps() {
  const size = 2048;
  const cells = 8;
  const periodX = size / cells;
  const periodY = size / cells;
  const rowH = periodY / 2;
  const mask = document.createElement("canvas");
  mask.width = size;
  mask.height = size;
  const ctx = mask.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(8, periodX * 0.18);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const strokeEdge = (x0, y0, x1, y1) => {
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        ctx.beginPath();
        ctx.moveTo(x0 + ox, y0 + oy);
        ctx.lineTo(x1 + ox, y1 + oy);
        ctx.stroke();
      }
    }
  };
  for (let j = -2; j <= cells * 2 + 2; j++) {
    const stagger = j % 2 === 0 ? 0 : periodX * 0.5;
    const y = j * rowH;
    for (let i = -1; i <= cells + 1; i++) {
      const x = i * periodX + stagger;
      strokeEdge(x, y, x + periodX * 0.5, y + rowH);
      strokeEdge(x, y, x - periodX * 0.5, y + rowH);
    }
  }
  const maskData = ctx.getImageData(0, 0, size, size).data;
  const col = ctx.createImageData(size, size);
  const nrm = ctx.createImageData(size, size);
  const alp = ctx.createImageData(size, size);
  const met = ctx.createImageData(size, size);
  const rgh = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) height[i] = maskData[i * 4] / 255;
  const sampleH = (x, y) => {
    x = ((x % size) + size) % size;
    y = ((y % size) + size) % size;
    return height[y * size + x];
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const m = height[y * size + x];
      const iron = 242 + m * 13;
      col.data[i] = iron;
      col.data[i + 1] = iron;
      col.data[i + 2] = iron + 1;
      col.data[i + 3] = 255;
      const a = m * 255;
      alp.data[i] = a;
      alp.data[i + 1] = a;
      alp.data[i + 2] = a;
      alp.data[i + 3] = 255;
      met.data[i] = a;
      met.data[i + 1] = a;
      met.data[i + 2] = a;
      met.data[i + 3] = 255;
      const rough = (0.22 + (1 - m) * 0.7) * 255;
      rgh.data[i] = rough;
      rgh.data[i + 1] = rough;
      rgh.data[i + 2] = rough;
      rgh.data[i + 3] = 255;
      const dx = sampleH(x + 1, y) - sampleH(x - 1, y);
      const dy = sampleH(x, y + 1) - sampleH(x, y - 1);
      const nx = -dx * 10;
      const ny = dy * 10;
      const inv = 1 / Math.hypot(nx, ny, 1);
      nrm.data[i] = (nx * inv * 0.5 + 0.5) * 255;
      nrm.data[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      nrm.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      nrm.data[i + 3] = 255;
    }
  }
  return {
    map: canvasTextureFromImageData(col, true),
    alphaMap: canvasTextureFromImageData(alp, false),
    normalMap: canvasTextureFromImageData(nrm, false),
    roughnessMap: canvasTextureFromImageData(rgh, false),
    metalnessMap: canvasTextureFromImageData(met, false),
  };
}

function applySealingPlatesDiamondMesh(root) {
  const mesh = root.getObjectByName("sealingPlates");
  if (!mesh || !mesh.isMesh) return;
  setWorldPlanarUVs(mesh, "x", "z", 0.26);
  const maps = makeExpandedMetalDiamondMaps();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: maps.map,
    alphaMap: maps.alphaMap,
    alphaTest: 0.45,
    normalMap: maps.normalMap,
    roughnessMap: maps.roughnessMap,
    roughness: 1,
    metalnessMap: maps.metalnessMap,
    metalness: 0.42,
    emissive: 0xffffff,
    emissiveMap: maps.alphaMap,
    emissiveIntensity: 0.28,
    envMap: _meetingRoomEnv,
    envMapIntensity: 0.28,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  _reflectiveMats.push(mat);
  mesh.material = mat;
  _themeMats.sealingPlates = mat;
  _themeMats.sealingEmissiveBright = new THREE.Color(0xffffff);
  _themeMats.sealingEmissiveDark = new THREE.Color(0x66e8ff);
}

function applyBanjoFigPlantMaterial(root, maps) {
  const mesh = root.getObjectByName("plant");
  if (!mesh || !mesh.isMesh || !maps) return;
  for (const attr of ["color", "color1", "color2"]) {
    if (mesh.geometry.getAttribute(attr)) mesh.geometry.deleteAttribute(attr);
  }
  mesh.material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: maps.map,
    normalMap: maps.normalMap,
    roughnessMap: maps.roughnessMap,
    roughness: 1,
    metalnessMap: maps.metalnessMap,
    metalness: 0,
    envMap: _meetingRoomEnv,
    envMapIntensity: 0.28,
    side: THREE.DoubleSide,
    vertexColors: false,
  });
}

function applyPlantGroundTexture(root, map) {
  const mesh = root.getObjectByName("plantGround");
  if (!mesh || !mesh.isMesh || !map) return;
  const geo = mesh.geometry;
  const pos = geo.getAttribute("position");
  if (!pos) return;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const spanX = Math.max(bb.max.x - bb.min.x, 1e-6);
  const spanZ = Math.max(bb.max.z - bb.min.z, 1e-6);
  const uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(
      i,
      (pos.getX(i) - bb.min.x) / spanX,
      (pos.getZ(i) - bb.min.z) / spanZ,
    );
  }
  geo.setAttribute("uv", uv);
  mesh.material = new THREE.MeshStandardMaterial({
    map,
    color: 0xb08a6a,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
    envMapIntensity: 0.08,
  });
}

function enableDoubleSidedFaces(root) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of mats) {
      if (!mat) continue;
      mat.side = THREE.DoubleSide;
      mat.needsUpdate = true;
    }
  });
}

/**
 * One of the camera's 90° orbit stops sits inside `concreteColumn`. Drawn
 * double-sided, its inner walls then fill the screen. The column is a closed,
 * outward-wound solid, so drawing only its front faces looks identical from
 * outside while letting the camera see straight through when it is inside.
 * Its own copy of the (shared) material keeps every map and colour; shadows
 * stay double-sided as before.
 */
function makeColumnCameraPassable(root) {
  const column = root.getObjectByName("concreteColumn");
  if (!column) return;
  column.traverse((node) => {
    if (!node.isMesh) return;
    const toFront = (mat) => {
      if (!mat) return mat;
      const own = mat.clone();
      own.side = THREE.FrontSide;
      own.shadowSide = THREE.DoubleSide;
      own.needsUpdate = true;
      // Keep receiving the captured room reflection like the original.
      if (_reflectiveMats.includes(mat)) _reflectiveMats.push(own);
      return own;
    };
    node.material = Array.isArray(node.material)
      ? node.material.map(toFront)
      : toFront(node.material);
  });
}

/** Sofa cushions (sofaSeat / sofaBackSeat) keep their hue at this share of the model's brightness. */
const SOFA_FABRIC_BRIGHTNESS = 0.22;
/** Matte fabric: the model's 0.5 roughness gave the seat a whitish sheen under the ceiling lights. */
const SOFA_FABRIC_ROUGHNESS = 0.85;

/** The model's sofa fabric reads too bright; dim just its color (same hue). */
function dimSofaFabric(root) {
  const done = new Set();
  for (const name of ["sofaSeat", "sofaBackSeat"]) {
    const mesh = root.getObjectByName(name);
    if (!mesh || !mesh.isMesh) continue;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat || !mat.color || done.has(mat)) continue;
      mat.color.multiplyScalar(SOFA_FABRIC_BRIGHTNESS);
      if (mat.roughness !== undefined) mat.roughness = SOFA_FABRIC_ROUGHNESS;
      done.add(mat);
    }
  }
}

// --- chairs around the tablePlate ------------------------------------------
const CHAIR_PARTS = ["chairSeat", "chairFrame", "chairAxis", "chairWheels"];
const CHAIRS_PER_SIDE = 3;
const CHAIR_YAW_JITTER = THREE.MathUtils.degToRad(5);

/**
 * Replaces the single modelled chair with 12 instanced chairs, 3 per table
 * side. Each part (seat / frame / axis / wheels) becomes one InstancedMesh that
 * reuses the original geometry and material, so all 12 chairs cost 4 draw
 * calls. Every chair is the original chair moved rigidly: its parts keep the
 * exact layout they have around the original chair's wheel-base centre.
 */
function arrangeChairsAroundTable(root) {
  const table = root.getObjectByName("tablePlate");
  const parts = CHAIR_PARTS.map((name) => root.getObjectByName(name));
  if (!table || parts.some((m) => !m || !m.isMesh)) return;
  root.updateMatrixWorld(true);
  const tableBox = new THREE.Box3().setFromObject(table);
  const center = tableBox.getCenter(new THREE.Vector3());
  const hx = (tableBox.max.x - tableBox.min.x) * 0.5;
  const hz = (tableBox.max.z - tableBox.min.z) * 0.5;
  // Chair pivot = centre of the wheel base (its footprint on the floor).
  const pivot = new THREE.Box3()
    .setFromObject(parts[3])
    .getCenter(new THREE.Vector3());
  // Which table side the reference chair sits at, and how far past that edge.
  const gapX = Math.abs(pivot.x - center.x) - hx;
  const gapZ = Math.abs(pivot.z - center.z) - hz;
  let n0x = 0;
  let n0z = 0;
  let edgeGap;
  if (gapZ >= gapX) {
    n0z = Math.sign(pivot.z - center.z) || 1;
    edgeGap = gapZ;
  } else {
    n0x = Math.sign(pivot.x - center.x) || 1;
    edgeGap = gapX;
  }
  // World -> reference-chair frame (pivot at origin, its side's normal on +Z).
  const toChair = new THREE.Matrix4()
    .makeRotationY(-Math.atan2(n0x, n0z))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, 0, -pivot.z));
  const frames = [];
  const sides = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
  ];
  const _r = new THREE.Matrix4();
  for (const [nx, nz] of sides) {
    const half = nx !== 0 ? hx : hz;
    const sideLen = (nx !== 0 ? hz : hx) * 2;
    const tx = -nz;
    const tz = nx;
    const facing = Math.atan2(nx, nz);
    for (let k = 0; k < CHAIRS_PER_SIDE; k++) {
      // Even spacing, symmetric about the side's midpoint (-L/3, 0, +L/3).
      const along = (k - (CHAIRS_PER_SIDE - 1) / 2) * (sideLen / CHAIRS_PER_SIDE);
      const x = center.x + nx * (half + edgeGap) + tx * along;
      const z = center.z + nz * (half + edgeGap) + tz * along;
      const yaw = facing + (Math.random() * 2 - 1) * CHAIR_YAW_JITTER;
      frames.push(
        new THREE.Matrix4()
          .makeTranslation(x, 0, z)
          .multiply(_r.makeRotationY(yaw))
          .multiply(toChair),
      );
    }
  }
  const rootInv = root.matrixWorld.clone().invert();
  const m = new THREE.Matrix4();
  for (const part of parts) {
    const inst = new THREE.InstancedMesh(part.geometry, part.material, frames.length);
    inst.name = part.name + "Instances";
    inst.castShadow = part.castShadow;
    inst.receiveShadow = part.receiveShadow;
    inst.renderOrder = part.renderOrder;
    for (let i = 0; i < frames.length; i++) {
      m.multiplyMatrices(frames[i], part.matrixWorld).premultiply(rootInv);
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingBox();
    inst.computeBoundingSphere();
    root.add(inst);
    part.removeFromParent();
  }
}

function attachMainPanelLights(root) {
  for (const name of ["mainLightLeft", "mainLightRight"]) {
    const mesh = root.getObjectByName(name);
    if (!mesh || !mesh.isMesh) continue;
    mesh.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) continue;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const light = new THREE.RectAreaLight(
      0xfff6ea,
      6.4,
      Math.max(size.x, 0.25),
      Math.max(size.z, 0.25),
    );
    light.name = `${name}AreaLight`;
    light.position.set(center.x, center.y - 0.05, center.z);
    light.lookAt(center.x, 0, center.z);
    scene.add(light);
    _mainPanelLights.push(light);
  }
}

function attachScreenLights(root) {
  const table = root.getObjectByName("tablePlate");
  const tableAim = new THREE.Vector3(0, 1.1, 0);
  if (table) {
    table.updateWorldMatrix(true, true);
    const tableBox = new THREE.Box3().setFromObject(table);
    if (!tableBox.isEmpty()) {
      tableBox.getCenter(tableAim);
      tableAim.y = tableBox.max.y;
    }
  }
  for (const name of ["screenLeft", "screenRight"]) {
    const mesh = root.getObjectByName(name);
    if (!mesh || !mesh.isMesh) continue;
    mesh.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) continue;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const light = new THREE.RectAreaLight(
      0x4a72e8,
      5.2,
      Math.max(size.z, 0.25),
      Math.max(size.y, 0.25),
    );
    light.name = `${name}AreaLight`;
    // Face straight out of the screen surface (not tilted toward the table):
    // a tilted area light this close to the wall lit the wall itself as a hard
    // triangle. Facing straight out, the wall is entirely behind the light.
    const outDir = new THREE.Vector3(1, 0, 0);
    const nAttr = mesh.geometry.getAttribute("normal");
    if (nAttr) {
      outDir.fromBufferAttribute(nAttr, 0).transformDirection(mesh.matrixWorld);
      if (outDir.dot(new THREE.Vector3().subVectors(tableAim, center)) < 0) outDir.negate();
    }
    outDir.y = 0;
    if (outDir.lengthSq() < 1e-6) outDir.set(1, 0, 0);
    outDir.normalize();
    light.position.copy(center).addScaledVector(outDir, 0.08);
    light.lookAt(light.position.x + outDir.x, light.position.y, light.position.z + outDir.z);
    scene.add(light);
    _screenAreaLights.push(light);
  }
}

function attachTablePlateKeyLight(root) {
  const table = root.getObjectByName("tablePlate");
  if (!table || !table.isMesh) return;
  table.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(table);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const topY = box.max.y;
  const light = new THREE.RectAreaLight(
    TABLE_PLATE_LIGHT_COLOR,
    TABLE_PLATE_LIGHT_INTENSITY_DARK,
    Math.max(size.x * 0.82, 0.8),
    Math.max(size.z * 0.82, 0.8),
  );
  light.name = "tablePlateKeyLight";
  light.position.set(center.x, topY + 0.52, center.z);
  light.lookAt(center.x, topY, center.z);
  scene.add(light);
  _tablePlateAreaLights.push(light);
}

function tableReflectorSamplesBehind(virtualCam) {
  virtualCam.updateMatrixWorld();
  const inv = virtualCam.matrixWorldInverse;
  for (let i = 0; i < _tableReflectorCorners.length; i++) {
    _tableReflectorViewP.copy(_tableReflectorCorners[i]).applyMatrix4(inv);
    if (_tableReflectorViewP.z >= -0.12) return true;
  }
  return false;
}

function fitReflectorProjectionToTable(virtualCam) {
  virtualCam.updateMatrixWorld();
  const inv = virtualCam.matrixWorldInverse;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let any = false;
  for (let i = 0; i < _tableReflectorCorners.length; i++) {
    _tableReflectorViewP.copy(_tableReflectorCorners[i]).applyMatrix4(inv);
    if (_tableReflectorViewP.z >= -1e-4) continue;
    const ih = -1 / _tableReflectorViewP.z;
    const x = _tableReflectorViewP.x * ih;
    const y = _tableReflectorViewP.y * ih;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    any = true;
  }
  if (!any) return;
  const near = Math.max(virtualCam.near, 0.05);
  const padX = Math.max((maxX - minX) * 0.16, 0.02);
  const padY = Math.max((maxY - minY) * 0.16, 0.02);
  virtualCam.projectionMatrix.makePerspective(
    (minX - padX) * near,
    (maxX + padX) * near,
    (maxY + padY) * near,
    (minY - padY) * near,
    near,
    virtualCam.far,
  );
}

function disposeTableReflectorBlur() {
  if (!tableReflectorBlur) return;
  tableReflectorBlur.dispose();
  tableReflectorBlur = null;
}

function createTableReflectorBlur(sourceTarget) {
  const type = sourceTarget.texture.type || THREE.HalfFloatType;
  const makeRT = (width, height) => {
    const rt = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    rt.texture.generateMipmaps = false;
    rt.texture.minFilter = THREE.LinearFilter;
    rt.texture.wrapS = THREE.ClampToEdgeWrapping;
    rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    rt.texture.anisotropy = 1;
    rt.texture.colorSpace = THREE.NoColorSpace;
    return rt;
  };
  const rt512 = makeRT(512, 512);
  const rt256 = makeRT(256, 256);
  const rt1024 = makeRT(1024, 1024);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      halfpixel: { value: new THREE.Vector2() },
      upsample: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform vec2 halfpixel;
      uniform float upsample;
      varying vec2 vUv;
      void main() {
        if (upsample < 0.5) {
          vec4 sum = texture2D(tDiffuse, vUv) * 4.0;
          sum += texture2D(tDiffuse, vUv - halfpixel);
          sum += texture2D(tDiffuse, vUv + halfpixel);
          sum += texture2D(tDiffuse, vUv + vec2(halfpixel.x, -halfpixel.y));
          sum += texture2D(tDiffuse, vUv - vec2(halfpixel.x, -halfpixel.y));
          gl_FragColor = sum / 8.0;
        } else {
          vec4 sum = texture2D(tDiffuse, vUv + vec2(-halfpixel.x * 2.0, 0.0));
          sum += texture2D(tDiffuse, vUv + vec2(-halfpixel.x, halfpixel.y)) * 2.0;
          sum += texture2D(tDiffuse, vUv + vec2(0.0, halfpixel.y * 2.0));
          sum += texture2D(tDiffuse, vUv + vec2(halfpixel.x, halfpixel.y)) * 2.0;
          sum += texture2D(tDiffuse, vUv + vec2(halfpixel.x * 2.0, 0.0));
          sum += texture2D(tDiffuse, vUv + vec2(halfpixel.x, -halfpixel.y)) * 2.0;
          sum += texture2D(tDiffuse, vUv + vec2(0.0, -halfpixel.y * 2.0));
          sum += texture2D(tDiffuse, vUv + vec2(-halfpixel.x, -halfpixel.y)) * 2.0;
          gl_FragColor = sum / 12.0;
        }
      }
    `,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(mesh);
  const blit = (renderer, from, to, destSize, srcSize, up) => {
    material.uniforms.tDiffuse.value = from;
    const px = (up ? 0.5 / srcSize : 0.5 / destSize) * 1.15;
    material.uniforms.halfpixel.value.set(px, px);
    material.uniforms.upsample.value = up ? 1 : 0;
    renderer.setRenderTarget(to);
    renderer.render(scene, camera);
  };
  return {
    texture: rt1024.texture,
    apply(renderer) {
      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = true;
      blit(renderer, sourceTarget.texture, rt512, 512, 1024, false);
      blit(renderer, rt512.texture, rt256, 256, 512, false);
      blit(renderer, rt256.texture, rt512, 512, 256, true);
      blit(renderer, rt512.texture, rt1024, 1024, 512, true);
      renderer.autoClear = prevAutoClear;
    },
    dispose() {
      rt512.dispose();
      rt256.dispose();
      rt1024.dispose();
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}

function applyTableReflectorObliqueClip(virtualCam, clipBias) {
  _reflPlane.setFromNormalAndCoplanarPoint(_reflNormal, _reflWorldPos);
  _reflPlane.applyMatrix4(virtualCam.matrixWorldInverse);
  _reflClipPlane.set(
    _reflPlane.normal.x,
    _reflPlane.normal.y,
    _reflPlane.normal.z,
    _reflPlane.constant,
  );
  const projectionMatrix = virtualCam.projectionMatrix;
  _reflQ.x =
    (Math.sign(_reflClipPlane.x) + projectionMatrix.elements[8]) /
    projectionMatrix.elements[0];
  _reflQ.y =
    (Math.sign(_reflClipPlane.y) + projectionMatrix.elements[9]) /
    projectionMatrix.elements[5];
  _reflQ.z = -1.0;
  _reflQ.w =
    (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];
  _reflClipPlane.multiplyScalar(2.0 / _reflClipPlane.dot(_reflQ));
  projectionMatrix.elements[2] = _reflClipPlane.x;
  projectionMatrix.elements[6] = _reflClipPlane.y;
  projectionMatrix.elements[10] = _reflClipPlane.z + 1.0 - clipBias;
  projectionMatrix.elements[14] = _reflClipPlane.w;
}

function setupTablePlateReflector(root) {
  const table = root.getObjectByName("tablePlate");
  if (!table || !table.isMesh) return;
  table.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(table);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const topY = box.max.y + 0.003;
  let sample = 0;
  for (let iz = 0; iz < TABLE_REFL_GRID; iz++) {
    for (let ix = 0; ix < TABLE_REFL_GRID; ix++) {
      _tableReflectorCorners[sample].set(
        box.min.x + (box.max.x - box.min.x) * (ix / (TABLE_REFL_GRID - 1)),
        topY,
        box.min.z + (box.max.z - box.min.z) * (iz / (TABLE_REFL_GRID - 1)),
      );
      sample += 1;
    }
  }
  if (tableReflector) {
    if (tableReflector.parent) tableReflector.parent.remove(tableReflector);
    if (typeof tableReflector.dispose === "function") tableReflector.dispose();
    else tableReflector.geometry.dispose();
    tableReflector = null;
  }
  disposeTableReflectorBlur();
  const reflector = new Reflector(
    new THREE.PlaneGeometry(Math.max(size.x, 0.01), Math.max(size.z, 0.01)),
    {
      color: 0xd4d4d4,
      textureWidth: 1024,
      textureHeight: 1024,
      clipBias: 0.003,
      multisample: 4,
    },
  );
  reflector.name = "tablePlateReflector";
  reflector.material.uniforms.opacity = { value: 0.18 };
  const reflectionTex = reflector.getRenderTarget()?.texture;
  if (reflectionTex) {
    reflectionTex.anisotropy = Math.min(
      8,
      renderer.capabilities.getMaxAnisotropy(),
    );
    reflectionTex.wrapS = THREE.ClampToEdgeWrapping;
    reflectionTex.wrapT = THREE.ClampToEdgeWrapping;
  }
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
  reflector.rotation.x = -Math.PI / 2;
  reflector.position.set(center.x, topY, center.z);
  reflector.renderOrder = 0;
  const virtualCam = reflector.camera;
  const renderTarget = reflector.getRenderTarget();
  const textureMatrix = reflector.material.uniforms.textureMatrix.value;
  tableReflectorBlur = createTableReflectorBlur(renderTarget);
  reflector.material.uniforms.tDiffuse.value = tableReflectorBlur.texture;
  const tableBase = root.getObjectByName("tableBaseBox");
  // The mirror's oblique clip plane discards everything below the tabletop, so
  // static room meshes that sit entirely below it can never show up in the
  // reflection: hide them for that pass only (identical image, fewer draws).
  const belowTable = [];
  if (!MR_PERF_BASELINE) {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    root.traverse((o) => {
      if (o === table || o === tableBase) return;
      if (!o.isMesh && !o.isPoints && !o.isLine) return;
      // Anything that can move up through the table (the power cable) stays.
      if (/cable/i.test(o.name || "") || o.frustumCulled === false) return;
      box.setFromObject(o);
      if (!box.isEmpty() && box.max.y < topY - 0.05) belowTable.push(o);
    });
  }
  const belowTableVisible = new Array(belowTable.length).fill(true);
  const restoreReflectorHelpers = () => {
    table.visible = true;
    if (tableBase) tableBase.visible = true;
    for (let i = 0; i < belowTable.length; i++) belowTable[i].visible = belowTableVisible[i];
    for (let i = 0; i < tableLightGlows.length; i++) {
      const sprite = tableLightGlows[i].sprite;
      if (sprite && sprite.userData._reflVis !== undefined) {
        sprite.visible = sprite.userData._reflVis;
      }
    }
    for (let i = 0; i < _carLightBarMeshes.length; i++) {
      const mesh = _carLightBarMeshes[i];
      if (mesh && mesh.userData._reflVis !== undefined) {
        mesh.visible = mesh.userData._reflVis;
      }
    }
    if (carShadowPlane && carShadowPlane.userData._reflVis !== undefined) {
      carShadowPlane.visible = carShadowPlane.userData._reflVis;
    }
    carShadowLight.castShadow = true;
  };
  reflector.onBeforeRender = function (renderer, scene, camera) {
    table.visible = false;
    if (tableBase) tableBase.visible = false;
    for (let i = 0; i < belowTable.length; i++) {
      belowTableVisible[i] = belowTable[i].visible;
      belowTable[i].visible = false;
    }
    for (let i = 0; i < tableLightGlows.length; i++) {
      const sprite = tableLightGlows[i].sprite;
      if (sprite) sprite.userData._reflVis = sprite.visible;
      if (sprite) sprite.visible = false;
    }
    for (let i = 0; i < _carLightBarMeshes.length; i++) {
      const mesh = _carLightBarMeshes[i];
      if (!mesh) continue;
      mesh.userData._reflVis = mesh.visible;
      mesh.visible = false;
    }
    if (carShadowPlane) {
      carShadowPlane.userData._reflVis = carShadowPlane.visible;
      carShadowPlane.visible = false;
    }
    carShadowLight.castShadow = false;

    _reflWorldPos.setFromMatrixPosition(reflector.matrixWorld);
    _reflCamWorldPos.setFromMatrixPosition(camera.matrixWorld);
    _reflRotation.extractRotation(reflector.matrixWorld);
    _reflNormal.set(0, 0, 1).applyMatrix4(_reflRotation);
    _reflView.subVectors(_reflWorldPos, _reflCamWorldPos);
    if (_reflView.dot(_reflNormal) > 0) {
      restoreReflectorHelpers();
      return;
    }

    _reflView.reflect(_reflNormal).negate().add(_reflWorldPos);
    _reflRotation.extractRotation(camera.matrixWorld);
    _reflLookAt.set(0, 0, -1).applyMatrix4(_reflRotation).add(_reflCamWorldPos);
    _reflTarget
      .subVectors(_reflWorldPos, _reflLookAt)
      .reflect(_reflNormal)
      .negate()
      .add(_reflWorldPos);
    virtualCam.position.copy(_reflView);
    _reflUp.set(0, 1, 0).applyMatrix4(_reflRotation).reflect(_reflNormal);
    virtualCam.up.copy(_reflUp);
    virtualCam.lookAt(_reflTarget);
    virtualCam.near = 0.08;
    virtualCam.far = camera.far;
    virtualCam.updateMatrixWorld();
    for (let pull = 0; pull < 20 && tableReflectorSamplesBehind(virtualCam); pull++) {
      _tableReflectorLook.set(
        virtualCam.position.x - tablePlateCenter.x,
        0,
        virtualCam.position.z - tablePlateCenter.z,
      );
      if (_tableReflectorLook.lengthSq() < 1e-6) _tableReflectorLook.set(1, 0, 0);
      _tableReflectorLook.normalize();
      virtualCam.position.addScaledVector(_tableReflectorLook, 0.45);
      virtualCam.lookAt(_reflTarget);
      virtualCam.updateMatrixWorld();
    }

    fitReflectorProjectionToTable(virtualCam);
    textureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0,
    );
    textureMatrix.multiply(virtualCam.projectionMatrix);
    textureMatrix.multiply(virtualCam.matrixWorldInverse);
    textureMatrix.multiply(reflector.matrixWorld);
    applyTableReflectorObliqueClip(virtualCam, 0.003);

    reflector.visible = false;
    const currentRenderTarget = renderer.getRenderTarget();
    const currentXrEnabled = renderer.xr.enabled;
    const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(renderTarget);
    renderer.state.buffers.depth.setMask(true);
    if (renderer.autoClear === false) renderer.clear();
    renderer.render(scene, virtualCam);
    if (tableReflectorBlur) tableReflectorBlur.apply(renderer);
    renderer.xr.enabled = currentXrEnabled;
    renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;
    renderer.setRenderTarget(currentRenderTarget);
    reflector.visible = true;
    restoreReflectorHelpers();
  };
  scene.add(reflector);
  tableReflector = reflector;
}

function attachTabletSideLight(root) {
  const mesh = root.getObjectByName("tabletsideLight");
  if (!mesh || !mesh.isMesh) return;
  mesh.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(mesh);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const tableY = Number.isFinite(tableSurfaceY) ? tableSurfaceY : center.y - 0.12;
  getMeshFlatFaceDir(mesh, _tabletFaceFlat);
  const aim = new THREE.Vector3(
    center.x + _tabletFaceFlat.x * 0.28,
    tableY,
    center.z + _tabletFaceFlat.z * 0.28,
  );
  const light = new THREE.RectAreaLight(
    TABLET_SIDE_LIGHT_COLOR,
    TABLET_SIDE_LIGHT_INTENSITY_DARK,
    Math.max(size.y * 0.85, 0.1),
    Math.max(size.y, 0.1),
  );
  light.name = "tabletsideLightAreaLight";
  light.position.set(
    center.x + _tabletFaceFlat.x * 0.04,
    Math.max(center.y, tableY + 0.05),
    center.z + _tabletFaceFlat.z * 0.04,
  );
  light.lookAt(aim.x, aim.y, aim.z);
  scene.add(light);
  _tabletSideAreaLights.push(light);
}

// ---------------------------------------------------------------------------
// Cabled physics objects: the tablet and the table microphone (same code).
// Each object's parts (separate nodes in the model) are grouped and driven by
// an invisible compound body (cannon-es, like the rest of the room) built from
// the parts' own geometry, with a low centre of mass and matching inertia. All
// objects share one small physics world with the table, the floor and one
// kinematic box per car (following that car), so cars knock them around (and
// lose a little speed by the mass ratio) and the objects collide with each
// other. Each object's cable is a heavy, stiff Verlet power cord: pinned at the
// table end, the other end rides with the object; it never stretches past its
// real length — a taut cord pulls the object back, so it hangs and swings off
// the table. Cords keep out of the table, the floor, the other objects and the
// other cord. The original cable mesh (a tube of rings) is bent along it.
// ---------------------------------------------------------------------------
const CABLED_PHYS_DT = 1 / 120;
/**
 * Rigid-body substeps per step (cannon has no continuous collision detection):
 * at the speed / spin caps no collider corner moves more than ~1.7 cm per
 * substep, under half the 4 cm tabletop, so nothing can tunnel through it.
 */
const CABLED_WORLD_SUBSTEPS = 2;
/** Penetration into the table / floor left to the solver (resting contact), m. */
const CABLED_PEN_SLOP = 0.002;

// --- tablet ----------------------------------------------------------------
const TABLET_PART_NAMES = [
  "tabletBody",
  "tabletScreen",
  "tabletsideLight",
  "tabletLegs",
  "tabletLegsTips",
  "tabletPowerLight", // small light on the tablet: moves with it
];
const TABLET_MASS = 2.4; // cars are 1.8
const TABLET_FRICTION = 0.7;
const TABLET_RESTITUTION = 0.02; // a heavy thud, no bounce
const TABLET_LINEAR_DAMPING = 0.6; // also settles the swinging when hanging
const TABLET_ANGULAR_DAMPING = 0.85;
const TABLET_MAX_SPEED = 2.5; // world units / s: even a strong hit can't launch it
const TABLET_MAX_SPIN = 6; // rad / s
// Compound collider: share of the mass in each part, and how far the centre
// of mass sits from the slab's centre toward the kickstand (0 = slab, 1 = legs).
const TABLET_MASS_SHARE = { tabletBody: 0.8, tabletLegs: 0.15, tabletLegsTips: 0.05 };
/** tabletBody = a thin front panel + a tapered back housing (split by depth). */
const TABLET_PANEL_THICKNESS = 0.012; // front panel depth, measured from the front face
const TABLET_PANEL_MASS_SHARE = 0.6; // of tabletBody's mass (rest: the back housing)
const TABLET_COM_TOWARD_LEGS = 0.45;
const TABLET_CAR_RESTITUTION = 0.2; // car slow-down on a hit (by mass ratio)
const TABLET_CABLE_SEGMENTS = 16; // fewer, longer segments: naturally stiffer (drawn smooth)
const TABLET_CABLE_ITERATIONS = 60; // constraint passes per step (stiffness holds under the weight)
// Heavy power cord: weight, sag, stiffness, heavy damping, no bounce.
const TABLET_CABLE_MASS = 0.18; // whole cable (the tablet is 2.4)
const TABLET_CABLE_GRAVITY_SCALE = 1.6; // × the room's gravity: clear sag under its own weight
const TABLET_CABLE_DAMPING = 0.94; // Verlet velocity kept per step (lower = heavier, settles sooner)
const TABLET_CABLE_STIFFNESS = 0.6; // bending resistance per pass (0 = string, 1 = stiff)
const TABLET_CABLE_MAX_BEND_DEG = 25; // largest bend per joint: wide, smooth curves only
const TABLET_CABLE_SELF_GAP = 0.75; // non-neighbour points ≥ this × a segment apart (no folds / coils)
const TABLET_CABLE_FRICTION = 0.6; // sliding damped when it lies on the table / floor
const TABLET_CABLE_LENGTH_SCALE = 1; // max length = the modelled cable's length × this
const TABLET_CABLE_PULL = 0.8; // share of a stretch corrected on the tablet per step

// --- table microphone (a flat three-armed puck, ~0.30 × 0.26 × 0.04) ---------
const MIC_PART_NAMES = ["tableMicBody", "tableMicNets"]; // the grille sits on the arms
const MIC_MASS = 2; // a little lighter than the tablet (2.4), same footprint, thinner
// cannon applies the full friction at every contact point: the flat puck rests
// on ~12–16 points (three arms + hub), so a per-point coefficient of 0.1 is
// an overall grip of roughly 1.2–1.6 (the tablet rests on a few edges).
const MIC_FRICTION = 0.1;
const MIC_RESTITUTION = 0.02;
const MIC_LINEAR_DAMPING = 0.6;
const MIC_ANGULAR_DAMPING = 0.85;
const MIC_MAX_SPEED = 2.5;
const MIC_MAX_SPIN = 6;
const MIC_HUB_MASS_SHARE = 0.4; // centre hub; the rest is split over the arms
const MIC_COM_HEIGHT = 0.35; // centre of mass height, as a share of the puck's height
const MIC_CAR_RESTITUTION = 0.2;
const MIC_CABLE_SEGMENTS = 16;
const MIC_CABLE_ITERATIONS = 60;
const MIC_CABLE_MASS = 0.15;
const MIC_CABLE_GRAVITY_SCALE = 1.6;
const MIC_CABLE_DAMPING = 0.94;
const MIC_CABLE_STIFFNESS = 0.6;
const MIC_CABLE_MAX_BEND_DEG = 25;
const MIC_CABLE_SELF_GAP = 0.75;
const MIC_CABLE_FRICTION = 0.6;
const MIC_CABLE_LENGTH_SCALE = 1;
const MIC_CABLE_PULL = 0.8;

/** Cords keep at least this far from each other (× the sum of their radii). */
const CABLED_CORD_GAP = 1.6;

const CABLED_OBJECT_CONFIGS = [
  {
    name: "tablet",
    parts: TABLET_PART_NAMES,
    coreName: "tabletBody",
    cableName: "tabletCable",
    mass: TABLET_MASS,
    friction: TABLET_FRICTION,
    restitution: TABLET_RESTITUTION,
    linearDamping: TABLET_LINEAR_DAMPING,
    angularDamping: TABLET_ANGULAR_DAMPING,
    maxSpeed: TABLET_MAX_SPEED,
    maxSpin: TABLET_MAX_SPIN,
    carRestitution: TABLET_CAR_RESTITUTION,
    buildPieces: _tabletPieces,
    centreOfMass: _tabletCentreOfMass,
    extraChildren: () => _tabletSideAreaLights,
    cable: {
      segments: TABLET_CABLE_SEGMENTS,
      iterations: TABLET_CABLE_ITERATIONS,
      mass: TABLET_CABLE_MASS,
      gravityScale: TABLET_CABLE_GRAVITY_SCALE,
      damping: TABLET_CABLE_DAMPING,
      stiffness: TABLET_CABLE_STIFFNESS,
      maxBendDeg: TABLET_CABLE_MAX_BEND_DEG,
      selfGap: TABLET_CABLE_SELF_GAP,
      friction: TABLET_CABLE_FRICTION,
      lengthScale: TABLET_CABLE_LENGTH_SCALE,
      pull: TABLET_CABLE_PULL,
    },
  },
  {
    name: "mic",
    parts: MIC_PART_NAMES,
    coreName: "tableMicBody",
    cableName: "micCable",
    mass: MIC_MASS,
    friction: MIC_FRICTION,
    restitution: MIC_RESTITUTION,
    linearDamping: MIC_LINEAR_DAMPING,
    angularDamping: MIC_ANGULAR_DAMPING,
    maxSpeed: MIC_MAX_SPEED,
    maxSpin: MIC_MAX_SPIN,
    carRestitution: MIC_CAR_RESTITUTION,
    buildPieces: _micPieces,
    centreOfMass: _micCentreOfMass,
    extraChildren: () => [],
    cable: {
      segments: MIC_CABLE_SEGMENTS,
      iterations: MIC_CABLE_ITERATIONS,
      mass: MIC_CABLE_MASS,
      gravityScale: MIC_CABLE_GRAVITY_SCALE,
      damping: MIC_CABLE_DAMPING,
      stiffness: MIC_CABLE_STIFFNESS,
      maxBendDeg: MIC_CABLE_MAX_BEND_DEG,
      selfGap: MIC_CABLE_SELF_GAP,
      friction: MIC_CABLE_FRICTION,
      lengthScale: MIC_CABLE_LENGTH_SCALE,
      pull: MIC_CABLE_PULL,
    },
  },
];

/** Shared world + all cabled objects (null until the room is set up). */
let _cabled = null;
const _cabledObjects = [];
const _tabV0 = new THREE.Vector3();
const _tabV1 = new THREE.Vector3();
const _tabQ = new THREE.Quaternion();
const _tabCV = new CANNON.Vec3();
const _tabCV2 = new CANNON.Vec3();
const _cabledShapeQ = new THREE.Quaternion();
const _cabledShapeP = new THREE.Vector3();

function _cableRingLayout(mesh) {
  const pos = mesh.geometry.attributes.position;
  // Tube of rings in order: the first big jump between consecutive vertices
  // ends the first ring.
  let ring = 0;
  for (let i = 0; i + 1 < pos.count; i++) {
    _tabV0.fromBufferAttribute(pos, i);
    _tabV1.fromBufferAttribute(pos, i + 1);
    if (_tabV0.distanceTo(_tabV1) > 0.012) {
      ring = i + 1;
      break;
    }
  }
  if (ring < 3 || pos.count % ring !== 0) return null;
  return { ring, rings: pos.count / ring };
}

function _cablePTFrames(points, tangents, normals, binormals, startNormal) {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    tangents[i].subVectors(b, a);
    if (tangents[i].lengthSq() < 1e-12) tangents[i].set(1, 0, 0);
    tangents[i].normalize();
  }
  normals[0].copy(startNormal).addScaledVector(tangents[0], -startNormal.dot(tangents[0]));
  if (normals[0].lengthSq() < 1e-10) normals[0].set(0, 1, 0).addScaledVector(tangents[0], -tangents[0].y);
  normals[0].normalize();
  for (let i = 1; i < n; i++) {
    // Parallel transport: rotate the previous normal by the tangent change.
    _tabQ.setFromUnitVectors(tangents[i - 1], tangents[i]);
    normals[i].copy(normals[i - 1]).applyQuaternion(_tabQ);
    normals[i].addScaledVector(tangents[i], -normals[i].dot(tangents[i])).normalize();
  }
  for (let i = 0; i < n; i++) binormals[i].crossVectors(tangents[i], normals[i]).normalize();
}

function _vecs(n) {
  return Array.from({ length: n }, () => new THREE.Vector3());
}

/** A collider piece from a box in a mesh's local space (world pose from the mesh). */
function _cabledBoxPiece(name, mesh, localBox, mass, fit = 1, localYaw = 0) {
  if (localBox.isEmpty()) return null;
  const wpos = new THREE.Vector3();
  const wq = new THREE.Quaternion();
  const ws = new THREE.Vector3();
  mesh.matrixWorld.decompose(wpos, wq, ws);
  const centre = localBox.getCenter(new THREE.Vector3());
  if (localYaw) centre.applyAxisAngle(new THREE.Vector3(0, 1, 0), localYaw);
  centre.applyMatrix4(mesh.matrixWorld);
  const half = localBox.getSize(new THREE.Vector3()).multiply(ws).multiplyScalar(0.5);
  half.set(Math.abs(half.x), Math.abs(half.y), Math.abs(half.z * fit));
  half.set(Math.max(0.004, half.x), Math.max(0.004, half.y), Math.max(0.004, half.z));
  const q = wq.clone();
  if (localYaw) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), localYaw));
  return { name, centre, q, half, mass, kind: "box" };
}

// --- tablet shape -------------------------------------------------------------
function _tabletPieces(group) {
  const pieces = [];
  const addPiece = (name, mesh, gb, mass, fit = 1) => {
    if (gb.isEmpty()) return;
    const wpos = new THREE.Vector3();
    const wq = new THREE.Quaternion();
    const ws = new THREE.Vector3();
    mesh.matrixWorld.decompose(wpos, wq, ws);
    const centre = gb.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
    const half = gb.getSize(new THREE.Vector3()).multiply(ws).multiplyScalar(0.5);
    half.set(Math.abs(half.x) * fit, Math.abs(half.y) * fit, Math.abs(half.z));
    half.set(Math.max(0.004, half.x), Math.max(0.004, half.y), Math.max(0.004, half.z));
    pieces.push({ name, centre, q: wq, half, mass, kind: "box" });
  };
  for (const name of Object.keys(TABLET_MASS_SHARE)) {
    const mesh = group.getObjectByName(name);
    if (!mesh || !mesh.isMesh) continue;
    mesh.updateWorldMatrix(true, false);
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const gb = mesh.geometry.boundingBox;
    const mass = TABLET_MASS * TABLET_MASS_SHARE[name];
    if (name !== "tabletBody") {
      addPiece(name, mesh, gb.clone(), mass);
      continue;
    }
    // Split the body by depth (local z: front face at max z): thin front panel
    // (with the screen / side light in it) + the back housing behind it.
    const front = new THREE.Box3();
    const back = new THREE.Box3();
    const posAttr = mesh.geometry.attributes.position;
    const zFront = gb.max.z;
    for (let i = 0; i < posAttr.count; i++) {
      _tabV0.fromBufferAttribute(posAttr, i);
      if (_tabV0.z >= zFront - TABLET_PANEL_THICKNESS) front.expandByPoint(_tabV0);
      else back.expandByPoint(_tabV0);
    }
    if (!back.isEmpty()) back.max.z = Math.min(back.max.z, zFront - TABLET_PANEL_THICKNESS);
    addPiece("tabletBody", mesh, front, mass * TABLET_PANEL_MASS_SHARE);
    addPiece("tabletBodyBack", mesh, back, mass * (1 - TABLET_PANEL_MASS_SHARE));
  }
  return pieces;
}

function _tabletCentreOfMass(pieces) {
  // Low, between the slab and the kickstand (where they meet).
  const slab = pieces.find((p) => p.name === "tabletBody");
  const legs = pieces.find((p) => p.name === "tabletLegs");
  const com = slab.centre.clone();
  if (legs) com.lerp(legs.centre, TABLET_COM_TOWARD_LEGS);
  return com;
}

// --- microphone shape -----------------------------------------------------------
/**
 * The mic body is a raised round hub with thin flat arms (measured from its
 * own vertices, in its local frame): an octagonal hub (two boxes) + one box per
 * arm (arm directions = clusters of the outermost vertices).
 */
function _micPieces(group) {
  const mesh = group.getObjectByName("tableMicBody");
  if (!mesh || !mesh.isMesh) return [];
  mesh.updateWorldMatrix(true, false);
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const gb = mesh.geometry.boundingBox;
  const pos = mesh.geometry.attributes.position;
  const cx = (gb.min.x + gb.max.x) / 2;
  const cz = (gb.min.z + gb.max.z) / 2;
  const yMin = gb.min.y;
  const yMax = gb.max.y;
  const verts = [];
  let rMax = 0;
  for (let i = 0; i < pos.count; i++) {
    _tabV0.fromBufferAttribute(pos, i);
    const dx = _tabV0.x - cx;
    const dz = _tabV0.z - cz;
    const r = Math.hypot(dx, dz);
    rMax = Math.max(rMax, r);
    verts.push({ x: dx, y: _tabV0.y, z: dz, r, a: Math.atan2(dz, dx) });
  }
  // The arms are thin flat plates (their top = the top of the outer vertices);
  // the hub is the raised round centre (everything taller than the arms).
  let armTop = yMin;
  for (const v of verts) if (v.r > 0.75 * rMax) armTop = Math.max(armTop, v.y);
  let hubR = 0;
  for (const v of verts) if (v.y > armTop + 0.1 * (yMax - yMin)) hubR = Math.max(hubR, v.r);
  if (hubR <= 0) hubR = 0.3 * rMax;
  // Arms: angle clusters of the outermost vertices.
  const outer = verts.filter((v) => v.r > 0.75 * rMax).map((v) => (v.a + Math.PI * 2) % (Math.PI * 2)).sort((p, q) => p - q);
  const clusters = [];
  for (const a of outer) {
    const last = clusters[clusters.length - 1];
    if (last && a - last[last.length - 1] < 1) last.push(a);
    else clusters.push([a]);
  }
  if (clusters.length > 1) {
    const first = clusters[0];
    const last = clusters[clusters.length - 1];
    if (first[0] + Math.PI * 2 - last[last.length - 1] < 1) {
      clusters[0] = last.concat(first.map((a) => a + Math.PI * 2));
      clusters.pop();
    }
  }
  const armDirs = clusters.map((c) => c.reduce((s, a) => s + a, 0) / c.length);
  const pieces = [];
  const ws = new THREE.Vector3();
  const wq = new THREE.Quaternion();
  mesh.matrixWorld.decompose(_tabV1, wq, ws);
  const armMass = (MIC_MASS * (1 - MIC_HUB_MASS_SHARE)) / Math.max(1, armDirs.length);
  for (const dir of armDirs) {
    // Arm frame: u along the arm, w across it.
    const ux = Math.cos(dir);
    const uz = Math.sin(dir);
    const box = new THREE.Box3();
    for (const v of verts) {
      let da = v.a - dir;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) > Math.PI / 3 || v.r < hubR * 0.5 || v.y > armTop + 1e-6) continue;
      const u = v.x * ux + v.z * uz;
      const w = -v.x * uz + v.z * ux;
      box.expandByPoint(_tabV0.set(u, v.y, w));
    }
    if (box.isEmpty()) continue;
    box.min.x = 0;
    // The arm's real thickness (same for every arm).
    box.min.y = yMin;
    box.max.y = armTop;
    // Box centre back in mesh space, then world.
    const cu = (box.min.x + box.max.x) / 2;
    const cw = (box.min.z + box.max.z) / 2;
    const cy = (box.min.y + box.max.y) / 2;
    const centre = new THREE.Vector3(cx + cu * ux - cw * uz, cy, cz + cu * uz + cw * ux).applyMatrix4(mesh.matrixWorld);
    // Box axes: x along the arm, z across it (a turn of -dir about local y).
    const q = wq.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dir));
    const half = new THREE.Vector3(
      ((box.max.x - box.min.x) / 2) * Math.abs(ws.x),
      ((box.max.y - box.min.y) / 2) * Math.abs(ws.y),
      ((box.max.z - box.min.z) / 2) * Math.abs(ws.z),
    );
    pieces.push({ name: "micArm", centre, q, half, mass: armMass, kind: "box" });
  }
  // Hub: two full-height square boxes, the second turned 45°: an octagon
  // around the round hub (a cannon cylinder resting on the table turned
  // sliding into upward kicks; box-box contacts are stable).
  const hubCentre = new THREE.Vector3(cx, (yMin + yMax) / 2, cz).applyMatrix4(mesh.matrixWorld);
  for (let k = 0; k < 2; k++) {
    pieces.push({
      name: "micHub",
      centre: hubCentre.clone(),
      q: wq.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (k * Math.PI) / 4)),
      half: new THREE.Vector3(hubR * Math.abs(ws.x), ((yMax - yMin) / 2) * Math.abs(ws.y), hubR * Math.abs(ws.z)),
      mass: (MIC_MASS * MIC_HUB_MASS_SHARE) / 2,
      kind: "box",
    });
  }
  return pieces;
}

function _micCentreOfMass(pieces) {
  // On the hub's axis, low in the puck.
  const hub = pieces.find((p) => p.name === "micHub");
  const com = hub.centre.clone();
  com.y = hub.centre.y - hub.half.y + 2 * hub.half.y * MIC_COM_HEIGHT;
  return com;
}

// --- shared setup ---------------------------------------------------------------
/**
 * Grows the collider pieces so they cover every visible vertex of the object
 * (each vertex outside all pieces extends the nearest one, in its own frame):
 * no visible part can sink into the table.
 */
function _cabledCoverVisual(group, pieces) {
  group.updateMatrixWorld(true);
  const inv = pieces.map((p) => p.q.clone().invert());
  const lo = pieces.map((p) => p.half.clone().negate());
  const hi = pieces.map((p) => p.half.clone());
  const v = new THREE.Vector3();
  const l = new THREE.Vector3();
  const outside = (k) => {
    l.copy(v).sub(pieces[k].centre).applyQuaternion(inv[k]);
    const ox = Math.max(0, lo[k].x - l.x, l.x - hi[k].x);
    const oy = Math.max(0, lo[k].y - l.y, l.y - hi[k].y);
    const oz = Math.max(0, lo[k].z - l.z, l.z - hi[k].z);
    return Math.hypot(ox, oy, oz);
  };
  group.traverse((m) => {
    if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      let best = Infinity;
      let bi = -1;
      for (let k = 0; k < pieces.length && best > 0; k++) {
        const d = outside(k);
        if (d < best) {
          best = d;
          bi = k;
        }
      }
      if (best <= 0 || bi < 0) continue;
      outside(bi);
      lo[bi].min(l);
      hi[bi].max(l);
    }
  });
  for (let k = 0; k < pieces.length; k++) {
    const p = pieces[k];
    p.centre.add(l.addVectors(lo[k], hi[k]).multiplyScalar(0.5).applyQuaternion(p.q));
    p.half.subVectors(hi[k], lo[k]).multiplyScalar(0.5);
  }
}

/** World box of the named objects (union), or null. */
function _cabledMeasure(root, names) {
  const box = new THREE.Box3();
  for (const n of names) {
    const o = root.getObjectByName(n);
    if (!o) continue;
    o.updateWorldMatrix(true, true);
    box.union(new THREE.Box3().setFromObject(o));
  }
  return box.isEmpty() ? null : box;
}

function _cabledBoxFrom(x0, x1, y0, y1, z0, z1) {
  return {
    c: new CANNON.Vec3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
    h: new CANNON.Vec3((x1 - x0) / 2, Math.max(0.005, (y1 - y0) / 2), (z1 - z0) / 2),
  };
}

function setupCabledObjects(root) {
  _cabled = null;
  _cabledObjects.length = 0;
  if (!root || !tablePlateBody) return;
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, PHYS_GRAVITY_Y, 0), allowSleep: true });
  world.solver.iterations = 12;
  world.defaultContactMaterial.contactEquationStiffness = 1e7;
  world.defaultContactMaterial.contactEquationRelaxation = 3;
  // Table / floor / car boxes get an explicit material, so each object's own
  // friction / restitution (its contact material) applies to them.
  const staticMaterial = new CANNON.Material("cabledStatic");
  const addStatic = (box) => {
    const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: staticMaterial });
    body.addShape(new CANNON.Box(box.h));
    body.position.copy(box.c);
    world.addBody(body);
    return box;
  };
  // The table, measured from its meshes: the tabletop slab at its real
  // thickness, and under it the wooden frame (walls from the floor up to the
  // top, with the base inside) as one solid block — nothing gets under the top.
  const tb = _cabledMeasure(root, ["tablePlate"]);
  if (!tb) return;
  const plate = addStatic(_cabledBoxFrom(tb.min.x, tb.max.x, tb.min.y, tb.max.y, tb.min.z, tb.max.z));
  const fb = _cabledMeasure(root, ["tableWoodFrame", "tableBaseBox"]);
  let frame = null;
  if (fb) {
    frame = addStatic(_cabledBoxFrom(fb.min.x, fb.max.x, fb.min.y, tb.min.y, fb.min.z, fb.max.z));
    frame.closedY = true; // the tabletop above, the floor below
    plate.solidBelow = frame; // the tabletop's underside is open only past the frame
  }
  const statics = frame ? [plate, frame] : [plate];
  let floorY = -Infinity;
  const solids = statics.slice();
  if (floorPhysBody) {
    const fh = floorPhysBody.shapes[0].halfExtents;
    const fp = floorPhysBody.position;
    solids.push(addStatic({ c: new CANNON.Vec3().copy(fp), h: new CANNON.Vec3().copy(fh) }));
    floorY = fp.y + fh.y;
  }
  _cabled = {
    world,
    staticMaterial,
    acc: 0,
    proxies: new Map(),
    tableTop: tb.max.y,
    tableHe: plate.h,
    tablePos: plate.c,
    statics, // what the cords collide with (the floor separately)
    solids, // what the objects are kept out of (+ the floor)
    floorY,
  };
  for (const cfg of CABLED_OBJECT_CONFIGS) {
    const O = _createCabledObject(root, cfg);
    if (O) _cabledObjects.push(O);
  }
  // Object ↔ object contacts (e.g. the mic against the tablet).
  for (let i = 0; i < _cabledObjects.length; i++) {
    for (let j = i + 1; j < _cabledObjects.length; j++) {
      const A = _cabledObjects[i];
      const B = _cabledObjects[j];
      world.addContactMaterial(
        new CANNON.ContactMaterial(A.material, B.material, {
          friction: (A.cfg.friction + B.cfg.friction) / 2,
          restitution: Math.min(A.cfg.restitution, B.cfg.restitution),
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 3,
        }),
      );
    }
  }
}

function _createCabledObject(root, cfg) {
  const S = _cabled;
  const parts = cfg.parts.map((n) => root.getObjectByName(n)).filter(Boolean);
  if (!parts.some((p) => p.name === cfg.coreName)) return null;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const p of parts) box.expandByObject(p);
  if (box.isEmpty()) return null;

  // Group the parts (world transforms kept), with any attached lights.
  const group = new THREE.Group();
  group.name = cfg.name + "Group";
  box.getCenter(group.position);
  root.add(group);
  group.updateMatrixWorld(true);
  for (const p of parts) group.attach(p);
  for (const l of cfg.extraChildren()) group.attach(l);

  const size = box.getSize(new THREE.Vector3());
  // Overall half size (only used for "a car is near" checks).
  const he = new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2);
  const pieces = cfg.buildPieces(group).filter(Boolean);
  if (!pieces.length) return null;
  const com = cfg.centreOfMass(pieces);
  _cabledCoverVisual(group, pieces);
  // Rest exactly on the table: the lowest collider corner just above the top.
  let lowest = Infinity;
  for (const p of pieces) {
    for (let c = 0; c < 8; c++) {
      _tabV0.set(c & 1 ? p.half.x : -p.half.x, c & 2 ? p.half.y : -p.half.y, c & 4 ? p.half.z : -p.half.z)
        .applyQuaternion(p.q).add(p.centre);
      lowest = Math.min(lowest, _tabV0.y);
    }
  }
  const lift = Number.isFinite(lowest) ? S.tableTop + 0.0005 - lowest : 0;
  if (lift > 0) {
    com.y += lift;
    for (const p of pieces) p.centre.y += lift;
    group.position.y += lift;
  }

  const material = new CANNON.Material(cfg.name);
  S.world.addContactMaterial(
    new CANNON.ContactMaterial(material, S.staticMaterial, {
      friction: cfg.friction,
      restitution: cfg.restitution,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 3,
    }),
  );
  const body = new CANNON.Body({
    mass: cfg.mass,
    material,
    linearDamping: cfg.linearDamping,
    angularDamping: cfg.angularDamping,
    allowSleep: true,
    sleepSpeedLimit: 0.05,
    sleepTimeLimit: 0.4,
  });
  body.position.set(com.x, com.y, com.z);
  for (const p of pieces) {
    const off = p.centre.clone().sub(com);
    const shape =
      p.kind === "cylinder"
        ? new CANNON.Cylinder(p.radius, p.radius, p.height, 12)
        : new CANNON.Box(new CANNON.Vec3(p.half.x, p.half.y, p.half.z));
    body.addShape(shape, new CANNON.Vec3(off.x, off.y, off.z), new CANNON.Quaternion(p.q.x, p.q.y, p.q.z, p.q.w));
  }
  // Inertia of the compound about the centre of mass (each piece as a box,
  // rotated into the body frame + parallel axis), not cannon's AABB estimate.
  const I = new THREE.Vector3();
  const rot = new THREE.Matrix3();
  for (const p of pieces) {
    const m = p.mass;
    const hx = p.half.x, hy = p.half.y, hz = p.half.z;
    const ix = (m / 3) * (hy * hy + hz * hz);
    const iy = (m / 3) * (hx * hx + hz * hz);
    const iz = (m / 3) * (hx * hx + hy * hy);
    rot.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(p.q));
    const e = rot.elements; // column-major
    const r = (row, col) => e[col * 3 + row];
    const d = (row) => r(row, 0) * r(row, 0) * ix + r(row, 1) * r(row, 1) * iy + r(row, 2) * r(row, 2) * iz;
    const off = p.centre.clone().sub(com);
    I.x += d(0) + m * (off.y * off.y + off.z * off.z);
    I.y += d(1) + m * (off.x * off.x + off.z * off.z);
    I.z += d(2) + m * (off.x * off.x + off.y * off.y);
  }
  body.inertia.set(I.x, I.y, I.z);
  body.invInertia.set(1 / I.x, 1 / I.y, 1 / I.z);
  body.updateInertiaWorld(true);
  S.world.addBody(body);
  body.sleep();

  const O = {
    cfg,
    group,
    body,
    material,
    he,
    radius: Math.hypot(he.x, he.y, he.z),
    // Group pose relative to the body (identity rotation at rest).
    offset: new THREE.Vector3().subVectors(group.position, com),
    contactPrev: new Set(),
    cable: null,
  };
  _setupCabledCable(root, O);
  return O;
}

function _setupCabledCable(root, O) {
  const cc = O.cfg.cable;
  const mesh = root.getObjectByName(O.cfg.cableName);
  if (!mesh || !mesh.isMesh) return;
  const layout = _cableRingLayout(mesh);
  if (!layout) return;
  mesh.updateMatrixWorld(true);
  const pos = mesh.geometry.attributes.position;
  const nrm = mesh.geometry.attributes.normal;
  const R = layout.ring;
  const N = layout.rings;
  // Ring centres (world) and the cable radius.
  let centres = _vecs(N);
  let radius = 0;
  for (let r = 0; r < N; r++) {
    for (let k = 0; k < R; k++) centres[r].add(_tabV0.fromBufferAttribute(pos, r * R + k).applyMatrix4(mesh.matrixWorld));
    centres[r].multiplyScalar(1 / R);
  }
  for (let k = 1; k < R; k++) radius += _tabV0.fromBufferAttribute(pos, R + k).applyMatrix4(mesh.matrixWorld).distanceTo(centres[1]);
  radius /= R - 1;
  // Order: index 0 = the table end (farther from the object).
  const objC = new THREE.Vector3(O.body.position.x, O.body.position.y, O.body.position.z);
  const reversed = centres[0].distanceTo(objC) < centres[N - 1].distanceTo(objC);
  const ringOf = (r) => (reversed ? N - 1 - r : r);
  if (reversed) centres = centres.slice().reverse();
  // Rest arc length per ring.
  const ringS = new Float32Array(N);
  for (let r = 1; r < N; r++) ringS[r] = ringS[r - 1] + centres[r].distanceTo(centres[r - 1]);
  const length = ringS[N - 1] * cc.lengthScale;
  for (let r = 0; r < N; r++) ringS[r] /= ringS[N - 1];
  // Rest frames at the ring centres and each vertex's offset in its ring's frame.
  const tg = _vecs(N), nm = _vecs(N), bn = _vecs(N);
  _cablePTFrames(centres, tg, nm, bn, new THREE.Vector3(0, 1, 0));
  const restNormal0 = nm[0].clone();
  const restTan0 = tg[0].clone();
  const offs = new Float32Array(pos.count * 3);
  const nOffs = new Float32Array(pos.count * 3);
  const ringOfVertex = new Uint16Array(pos.count);
  const normalMat = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  for (let r = 0; r < N; r++) {
    const src = ringOf(r);
    for (let k = 0; k < R; k++) {
      const vi = src * R + k;
      ringOfVertex[vi] = r;
      _tabV0.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld).sub(centres[r]);
      offs[vi * 3] = _tabV0.dot(nm[r]);
      offs[vi * 3 + 1] = _tabV0.dot(bn[r]);
      offs[vi * 3 + 2] = _tabV0.dot(tg[r]);
      _tabV1.fromBufferAttribute(nrm, vi).applyMatrix3(normalMat).normalize();
      nOffs[vi * 3] = _tabV1.dot(nm[r]);
      nOffs[vi * 3 + 1] = _tabV1.dot(bn[r]);
      nOffs[vi * 3 + 2] = _tabV1.dot(tg[r]);
    }
  }
  // Rope points: evenly along the rest path.
  const M = cc.segments + 1;
  const pts = _vecs(M);
  const prev = _vecs(M);
  const restCurve = new THREE.CatmullRomCurve3(centres, false, "centripetal");
  for (let i = 0; i < M; i++) {
    restCurve.getPointAt(i / (M - 1), pts[i]);
    prev[i].copy(pts[i]);
  }
  // Object end: the last two points ride with the object (body frame).
  const inv = new THREE.Matrix4().compose(
    new THREE.Vector3(O.body.position.x, O.body.position.y, O.body.position.z),
    new THREE.Quaternion(),
    new THREE.Vector3(1, 1, 1),
  ).invert();
  const attachLocal = [pts[M - 2].clone().applyMatrix4(inv), pts[M - 1].clone().applyMatrix4(inv)];
  mesh.frustumCulled = false;
  pos.setUsage(THREE.DynamicDrawUsage);
  nrm.setUsage(THREE.DynamicDrawUsage);
  O.cable = {
    mesh,
    pts,
    prev,
    M,
    seg: length / (M - 1),
    length,
    radius,
    anchors: [pts[0].clone(), pts[1].clone()],
    attachLocal,
    ringS,
    N,
    offs,
    nOffs,
    ringOfVertex,
    restNormal0,
    restTan0,
    curve: new THREE.CatmullRomCurve3(pts, false, "centripetal"),
    c: _vecs(N),
    tg: _vecs(N),
    nm: _vecs(N),
    bn: _vecs(N),
    meshInv: new THREE.Matrix4().copy(mesh.matrixWorld).invert(),
    normalInv: new THREE.Matrix3().getNormalMatrix(new THREE.Matrix4().copy(mesh.matrixWorld).invert()),
    active: false,
    hangForce: 0,
  };
}

function _cabledAttachWorld(O, i, out) {
  const b = O.body;
  out.copy(O.cable.attachLocal[i]);
  _tabQ.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
  return out.applyQuaternion(_tabQ).add(_tabV1.set(b.position.x, b.position.y, b.position.z));
}

const _CABLED_AXES = ["x", "y", "z"];

/**
 * Whether leaving static box B through face (axis, side) leads into another
 * solid: the frame block is closed at the top (tabletop) and bottom (floor);
 * the tabletop's underside is open only past the frame.
 */
function _cabledFaceBlocked(B, ax, side, px, pz, r) {
  if (ax !== "y") return false;
  if (B.closedY) return true;
  const F = B.solidBelow;
  return !!F && side < 0 && Math.abs(px - F.c.x) < F.h.x + r && Math.abs(pz - F.c.z) < F.h.z + r;
}

/**
 * Keeps a cord point out of the table (tabletop + frame) and above the floor.
 * A point inside leaves the way it came in (the face its previous position
 * was outside of), else through the nearest open face. Returns the contact
 * axis ("x" / "y" / "z") or "" when free.
 */
function _cabledCollideStatic(c, p, prev) {
  const S = _cabled;
  const r = c.radius;
  let hit = "";
  if (p.y < S.floorY + r) {
    p.y = S.floorY + r;
    hit = "y";
  }
  for (const B of S.statics) {
    const hx = B.h.x + r;
    const hy = B.h.y + r;
    const hz = B.h.z + r;
    const dx = p.x - B.c.x;
    const dy = p.y - B.c.y;
    const dz = p.z - B.c.z;
    if (Math.abs(dx) >= hx || Math.abs(dy) >= hy || Math.abs(dz) >= hz) {
      // Resting on the table top counts as contact too (for friction).
      if (!B.closedY && Math.abs(dx) < hx && Math.abs(dz) < hz && dy >= hy && dy < hy + 0.002) hit = "y";
      continue;
    }
    // Into the frame from above = through the tabletop: back on top of it.
    if (B.closedY && prev && prev.y >= B.c.y + B.h.y - 1e-4) {
      p.y = S.tableTop + r;
      hit = "y";
      continue;
    }
    let ax = "";
    let side = 0;
    let best = Infinity;
    let axPrev = "";
    let sidePrev = 0;
    let bestPrev = Infinity;
    for (let k = 0; k < 3; k++) {
      const a = _CABLED_AXES[k];
      const h = B.h[a] + r;
      const d = p[a] - B.c[a];
      for (let sd = -1; sd <= 1; sd += 2) {
        if (_cabledFaceBlocked(B, a, sd, p.x, p.z, r)) continue;
        const depth = h - sd * d;
        if (depth < best) {
          best = depth;
          ax = a;
          side = sd;
        }
        if (prev && sd * (prev[a] - B.c[a]) >= h - 1e-4 && depth < bestPrev) {
          bestPrev = depth;
          axPrev = a;
          sidePrev = sd;
        }
      }
    }
    if (axPrev) {
      ax = axPrev;
      side = sidePrev;
    }
    if (!ax) continue;
    p[ax] = B.c[ax] + side * (B.h[ax] + r);
    hit = ax;
  }
  return hit;
}

// --- objects vs the table / floor: separating-axis push-out -----------------------
const _satU = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _satN = new THREE.Vector3();
const _satBestN = new THREE.Vector3();
const _satAnyN = new THREE.Vector3();
const _satC = new THREE.Vector3();
const _satQ = new THREE.Quaternion();
const _sat = { dx: 0, dy: 0, dz: 0, h: null, B: null, best: 0, any: 0, depth: 0, anyDepth: 0, cx: 0, cz: 0 };

/** One separating axis (lx, ly, lz); false = separated along it. */
function _satAxis(lx, ly, lz, bias) {
  const len = Math.hypot(lx, ly, lz);
  if (len < 1e-6) return true;
  lx /= len;
  ly /= len;
  lz /= len;
  const h = _sat.h;
  const B = _sat.B;
  const rA =
    h.x * Math.abs(_satU[0].x * lx + _satU[0].y * ly + _satU[0].z * lz) +
    h.y * Math.abs(_satU[1].x * lx + _satU[1].y * ly + _satU[1].z * lz) +
    h.z * Math.abs(_satU[2].x * lx + _satU[2].y * ly + _satU[2].z * lz);
  const rB = B.h.x * Math.abs(lx) + B.h.y * Math.abs(ly) + B.h.z * Math.abs(lz);
  const d = _sat.dx * lx + _sat.dy * ly + _sat.dz * lz;
  const o = rA + rB - Math.abs(d);
  if (o <= 0) return false;
  const sg = d < 0 ? -1 : 1;
  const nx = lx * sg;
  const ny = ly * sg;
  const nz = lz * sg;
  const ob = o * bias;
  if (ob < _sat.any) {
    _sat.any = ob;
    _sat.anyDepth = o;
    _satAnyN.set(nx, ny, nz);
  }
  // Pushing out through a covered face (into the frame / floor) is not a way out.
  const blocked = Math.abs(ny) > 0.7 && _cabledFaceBlocked(B, "y", ny < 0 ? -1 : 1, _sat.cx, _sat.cz, 0);
  if (!blocked && ob < _sat.best) {
    _sat.best = ob;
    _sat.depth = o;
    _satBestN.set(nx, ny, nz);
  }
  return true;
}

/**
 * Penetration of an oriented box (centre c, axes _satU, half extents h) into
 * static box B: depth (0 when apart) and the push-out direction in _satN.
 */
function _cabledBoxPenetration(c, h, B) {
  _sat.dx = c.x - B.c.x;
  _sat.dy = c.y - B.c.y;
  _sat.dz = c.z - B.c.z;
  _sat.h = h;
  _sat.B = B;
  _sat.cx = c.x;
  _sat.cz = c.z;
  _sat.best = Infinity;
  _sat.any = Infinity;
  if (!_satAxis(1, 0, 0, 1) || !_satAxis(0, 1, 0, 1) || !_satAxis(0, 0, 1, 1)) return 0;
  for (let k = 0; k < 3; k++) if (!_satAxis(_satU[k].x, _satU[k].y, _satU[k].z, 1)) return 0;
  // Edge × edge axes (slightly less preferred than face axes).
  for (let k = 0; k < 3; k++) {
    const u = _satU[k];
    if (!_satAxis(0, -u.z, u.y, 1.05) || !_satAxis(u.z, 0, -u.x, 1.05) || !_satAxis(-u.y, u.x, 0, 1.05)) return 0;
  }
  if (_sat.best < Infinity) {
    _satN.copy(_satBestN);
    return _sat.depth;
  }
  _satN.copy(_satAnyN);
  return _sat.anyDepth;
}

/**
 * Collisions get the last word each step: after the cord's pull, any collider
 * piece still inside the table / floor (beyond the resting slop) moves the
 * object straight out along the contact normal. Position only (no impulse) and
 * its velocity into the surface is dropped, so it is never launched.
 */
function _cabledDepenetrate(O) {
  const S = _cabled;
  const b = O.body;
  for (let pass = 0; pass < 4; pass++) {
    _tabQ.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    let worst = 0;
    for (let s = 0; s < b.shapes.length; s++) {
      const sh = b.shapes[s];
      if (!sh.halfExtents) continue;
      const o = b.shapeOffsets[s];
      const so = b.shapeOrientations[s];
      _satQ.set(so.x, so.y, so.z, so.w).premultiply(_tabQ);
      _satU[0].set(1, 0, 0).applyQuaternion(_satQ);
      _satU[1].set(0, 1, 0).applyQuaternion(_satQ);
      _satU[2].set(0, 0, 1).applyQuaternion(_satQ);
      _satC.set(o.x, o.y, o.z).applyQuaternion(_tabQ);
      _satC.x += b.position.x;
      _satC.y += b.position.y;
      _satC.z += b.position.z;
      for (const B of S.solids) {
        const d = _cabledBoxPenetration(_satC, sh.halfExtents, B);
        if (d > worst) {
          worst = d;
          _tabV1.copy(_satN);
        }
      }
    }
    if (worst <= CABLED_PEN_SLOP) return;
    const push = worst - CABLED_PEN_SLOP;
    b.position.x += _tabV1.x * push;
    b.position.y += _tabV1.y * push;
    b.position.z += _tabV1.z * push;
    const v = b.velocity;
    const vn = v.x * _tabV1.x + v.y * _tabV1.y + v.z * _tabV1.z;
    if (vn < 0) {
      v.x -= _tabV1.x * vn;
      v.y -= _tabV1.y * vn;
      v.z -= _tabV1.z * vn;
    }
  }
}

/**
 * A cord segment may not pass through the thin tabletop between its two
 * points (both outside it, one above and one below). If it would, both free
 * ends move out past the nearest table edge, so the cord wraps around it.
 */
function _cabledSegmentStatic(c, i) {
  const S = _cabled;
  const M = c.M;
  const a = c.pts[i];
  const b = c.pts[i + 1];
  const r = c.radius;
  const top = S.tablePos.y + S.tableHe.y;
  const bot = S.tablePos.y - S.tableHe.y;
  if (!((a.y >= top && b.y <= bot) || (b.y >= top && a.y <= bot))) return;
  const t = (S.tablePos.y - a.y) / (b.y - a.y);
  const cx = a.x + (b.x - a.x) * t - S.tablePos.x;
  const cz = a.z + (b.z - a.z) * t - S.tablePos.z;
  const ox = S.tableHe.x + r - Math.abs(cx);
  const oz = S.tableHe.z + r - Math.abs(cz);
  if (ox <= 0 || oz <= 0) return;
  // Over the frame the lower end is inside it (handled per point).
  const F = _cabled.statics[1];
  if (F && Math.abs(cx + S.tablePos.x - F.c.x) < F.h.x && Math.abs(cz + S.tablePos.z - F.c.z) < F.h.z) return;
  const fixedA = i < 2 || i >= M - 2;
  const fixedB = i + 1 < 2 || i + 1 >= M - 2;
  if (ox <= oz) {
    const d = Math.sign(cx || 1) * ox;
    if (!fixedA) a.x += d;
    if (!fixedB) b.x += d;
  } else {
    const d = Math.sign(cz || 1) * oz;
    if (!fixedA) a.z += d;
    if (!fixedB) b.z += d;
  }
}

/** Keeps a cord point out of the other objects' collider pieces. */
function _cabledCollideObjects(own, c, p) {
  for (const O of _cabledObjects) {
    if (O === own) continue;
    const b = O.body;
    const dx = p.x - b.position.x;
    const dy = p.y - b.position.y;
    const dz = p.z - b.position.z;
    if (dx * dx + dy * dy + dz * dz > (O.radius + c.radius) * (O.radius + c.radius)) continue;
    for (let s = 0; s < b.shapes.length; s++) {
      const sh = b.shapes[s];
      const o = b.shapeOffsets[s];
      const so = b.shapeOrientations[s];
      _tabQ.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      _cabledShapeQ.set(so.x, so.y, so.z, so.w).premultiply(_tabQ);
      _cabledShapeP.set(o.x, o.y, o.z).applyQuaternion(_tabQ).add(_tabV1.set(b.position.x, b.position.y, b.position.z));
      const h = sh.halfExtents || new CANNON.Vec3(sh.radiusTop, sh.height / 2, sh.radiusTop);
      // Point in the piece's frame.
      _tabV0.copy(p).sub(_cabledShapeP).applyQuaternion(_tabQ.copy(_cabledShapeQ).invert());
      const ex = h.x + c.radius - Math.abs(_tabV0.x);
      const ey = h.y + c.radius - Math.abs(_tabV0.y);
      const ez = h.z + c.radius - Math.abs(_tabV0.z);
      if (ex <= 0 || ey <= 0 || ez <= 0) continue;
      if (ey <= ex && ey <= ez) _tabV0.y = Math.sign(_tabV0.y || 1) * (h.y + c.radius);
      else if (ex <= ez) _tabV0.x = Math.sign(_tabV0.x || 1) * (h.x + c.radius);
      else _tabV0.z = Math.sign(_tabV0.z || 1) * (h.z + c.radius);
      p.copy(_tabV0.applyQuaternion(_cabledShapeQ).add(_cabledShapeP));
    }
  }
}

/** Push points i and j apart (only) to at least `minDist`; pinned ends stay put. */
function _cabledSpreadPair(c, i, j, minDist, k) {
  const M = c.M;
  const a = c.pts[i];
  const b = c.pts[j];
  _tabV0.subVectors(b, a);
  const d = _tabV0.length();
  if (d >= minDist || d < 1e-9) return;
  const fixedA = i < 2 || i >= M - 2;
  const fixedB = j < 2 || j >= M - 2;
  if (fixedA && fixedB) return;
  const push = ((minDist - d) / d) * k;
  const wa = fixedA ? 0 : fixedB ? 1 : 0.5;
  const wb = fixedB ? 0 : fixedA ? 1 : 0.5;
  a.addScaledVector(_tabV0, -push * wa);
  b.addScaledVector(_tabV0, push * wb);
}

/**
 * Bending constraint over a span of `gap` segments for every point pair. Only
 * the two plug-in joints are left free (the cord may turn sharply right where
 * it plugs into the table / object); pairs reaching the inner pinned point
 * move just their free end.
 */
function _cabledSpread(c, gap, minDist, k) {
  for (let i = 1; i + gap <= c.M - 2; i++) _cabledSpreadPair(c, i, i + gap, minDist, k);
}

function _cabledCableStep(O, dt) {
  const S = _cabled;
  const cc = O.cfg.cable;
  const c = O.cable;
  const M = c.M;
  const g = PHYS_GRAVITY_Y * cc.gravityScale * dt * dt;
  const a0 = _cabledAttachWorld(O, 0, new THREE.Vector3());
  const a1 = _cabledAttachWorld(O, 1, new THREE.Vector3());
  for (let i = 2; i < M - 2; i++) {
    const p = c.pts[i];
    const q = c.prev[i];
    const vx = (p.x - q.x) * cc.damping;
    const vy = (p.y - q.y) * cc.damping;
    const vz = (p.z - q.z) * cc.damping;
    q.copy(p);
    p.x += vx;
    p.y += vy + g;
    p.z += vz;
  }
  const pin = () => {
    c.pts[0].copy(c.anchors[0]);
    c.pts[1].copy(c.anchors[1]);
    c.pts[M - 2].copy(a0);
    c.pts[M - 1].copy(a1);
  };
  const bend = (cc.maxBendDeg * Math.PI) / 180;
  for (let it = 0; it < cc.iterations; it++) {
    pin();
    // Bending resistance: points 2 and 3 apart are kept at least as far apart
    // as a curve bending MAX_BEND per joint allows (pushed apart only), so no
    // joint folds sharply and longer stretches keep wide curves.
    _cabledSpread(c, 2, 2 * c.seg * Math.cos(bend / 2), cc.stiffness);
    _cabledSpread(c, 3, c.seg * (1 + 2 * Math.cos(bend)), cc.stiffness);
    // No folding onto itself: every non-neighbour pair keeps a minimum gap.
    for (let i = 0; i < M; i++) {
      for (let j = i + 4; j < M; j++) _cabledSpreadPair(c, i, j, c.seg * cc.selfGap, 1);
    }
    // Length last in each pass, so the cord never stretches.
    for (let i = 0; i < M - 1; i++) {
      const a = c.pts[i];
      const b = c.pts[i + 1];
      _tabV0.subVectors(b, a);
      const d = _tabV0.length();
      if (d < 1e-9) continue;
      const diff = (d - c.seg) / d;
      const fixedA = i < 2 || i >= M - 2;
      const fixedB = i + 1 < 2 || i + 1 >= M - 2;
      if (fixedA && fixedB) continue;
      const wa = fixedA ? 0 : fixedB ? 1 : 0.5;
      const wb = fixedB ? 0 : fixedA ? 1 : 0.5;
      a.addScaledVector(_tabV0, diff * wa);
      b.addScaledVector(_tabV0, -diff * wb);
    }
    for (let i = 2; i < M - 2; i++) {
      _cabledCollideStatic(c, c.pts[i], c.prev[i]);
      _cabledCollideObjects(O, c, c.pts[i]);
    }
    for (let i = 1; i < M - 2; i++) _cabledSegmentStatic(c, i);
  }
  pin();
  // Contacts: no bounce (velocity into the surface dropped) and friction along
  // it, so the cord rests still on the table / floor instead of sliding.
  let hangingPts = 0;
  for (let i = 2; i < M - 2; i++) {
    const p = c.pts[i];
    const q = c.prev[i];
    const axis = _cabledCollideStatic(c, p, q);
    if (axis) {
      q[axis] = p[axis];
      for (const t of ["x", "y", "z"]) {
        if (t !== axis) q[t] += (p[t] - q[t]) * cc.friction;
      }
    }
    const overTable =
      Math.abs(p.x - S.tablePos.x) < S.tableHe.x && Math.abs(p.z - S.tablePos.z) < S.tableHe.z;
    if (!overTable && p.y < S.tableTop) hangingPts++;
  }
  // The cord's hanging part pulls down on the object (about half its weight;
  // the table edge carries the rest). Zero while it lies on the table.
  c.hangForce = hangingPts > 0 ? 0.5 * (cc.mass * hangingPts) / (M - 4) * -PHYS_GRAVITY_Y * cc.gravityScale : 0;
  // Taut cord: it cannot stretch, so the excess pulls the object back.
  let len = 0;
  for (let i = 0; i < M - 1; i++) len += c.pts[i].distanceTo(c.pts[i + 1]);
  const excess = len - c.length;
  // A slightly taut cord can't drag a resting (asleep) object against the
  // table's friction: only a clear stretch wakes it.
  const minExcess = O.body.sleepState === CANNON.Body.AWAKE ? 0.002 : 0.01;
  if (excess > c.length * minExcess) {
    const b = O.body;
    // On the table the cord lies on it and pulls along it (no lift). An object
    // that swung in under the table edge is still hanging, not on the table.
    const onTable =
      b.position.y > S.tableTop &&
      Math.abs(b.position.x - S.tablePos.x) < S.tableHe.x &&
      Math.abs(b.position.z - S.tablePos.z) < S.tableHe.z;
    let pullFrom = c.pts[M - 3];
    if (!onTable) {
      // Hanging: the cord pulls toward where it leaves the table (its last
      // point still resting on the table top), i.e. up over the edge.
      for (let i = M - 3; i >= 2; i--) {
        const p = c.pts[i];
        const over =
          Math.abs(p.x - S.tablePos.x) < S.tableHe.x + c.radius * 2 &&
          Math.abs(p.z - S.tablePos.z) < S.tableHe.z + c.radius * 2;
        if (over && p.y >= S.tableTop - c.radius * 2) {
          pullFrom = p;
          break;
        }
      }
    }
    const dir = _tabV0.subVectors(pullFrom, a0);
    if (onTable) dir.y = 0;
    if (dir.lengthSq() < 1e-10) return;
    dir.normalize();
    // Off the table the cord has to catch a falling object: a firmer correction.
    const corr = Math.min(excess * cc.pull, onTable ? 0.05 : 0.3);
    b.position.x += dir.x * corr;
    b.position.y += dir.y * corr;
    b.position.z += dir.z * corr;
    // Remove the velocity of the attach point away from the cord (impulse at
    // the attach point, so the object also swings / turns around it).
    const rx = a0.x - b.position.x;
    const ry = a0.y - b.position.y;
    const rz = a0.z - b.position.z;
    const w = b.angularVelocity;
    const vpx = b.velocity.x + (w.y * rz - w.z * ry);
    const vpy = b.velocity.y + (w.z * rx - w.x * rz);
    const vpz = b.velocity.z + (w.x * ry - w.y * rx);
    const vn = vpx * dir.x + vpy * dir.y + vpz * dir.z;
    if (vn < 0) {
      const j = -vn * O.cfg.mass * 0.7;
      _tabCV.set(dir.x * j, dir.y * j, dir.z * j);
      _tabCV2.set(rx, ry, rz);
      b.applyImpulse(_tabCV, _tabCV2);
    }
    if (b.sleepState !== CANNON.Body.AWAKE) b.wakeUp();
  }
}

/** Cords keep apart from each other (once per step, free points only). */
function _cabledCordsApart() {
  for (let a = 0; a < _cabledObjects.length; a++) {
    const A = _cabledObjects[a].cable;
    if (!A || !A.active) continue;
    for (let b = a + 1; b < _cabledObjects.length; b++) {
      const B = _cabledObjects[b].cable;
      if (!B || !B.active) continue;
      const minD = (A.radius + B.radius) * CABLED_CORD_GAP;
      for (let i = 2; i < A.M - 2; i++) {
        for (let j = 2; j < B.M - 2; j++) {
          _tabV0.subVectors(B.pts[j], A.pts[i]);
          const d = _tabV0.length();
          if (d >= minD || d < 1e-9) continue;
          const push = (minD - d) / d / 2;
          A.pts[i].addScaledVector(_tabV0, -push);
          B.pts[j].addScaledVector(_tabV0, push);
        }
      }
    }
  }
}

/** Bends the original cable mesh along the simulated cord, ring by ring. */
function _cabledCableDraw(O) {
  const c = O.cable;
  const curve = c.curve;
  curve.needsUpdate = true;
  for (let r = 0; r < c.N; r++) curve.getPointAt(c.ringS[r], c.c[r]);
  _tabQ.setFromUnitVectors(c.restTan0, _tabV0.subVectors(c.c[1], c.c[0]).normalize());
  const n0 = _tabV1.copy(c.restNormal0).applyQuaternion(_tabQ);
  _cablePTFrames(c.c, c.tg, c.nm, c.bn, n0);
  const pos = c.mesh.geometry.attributes.position;
  const nrm = c.mesh.geometry.attributes.normal;
  const pa = pos.array;
  const na = nrm.array;
  for (let vi = 0; vi < pos.count; vi++) {
    const r = c.ringOfVertex[vi];
    const o = vi * 3;
    const N_ = c.nm[r], B_ = c.bn[r], T_ = c.tg[r], C_ = c.c[r];
    _tabV0.set(
      C_.x + N_.x * c.offs[o] + B_.x * c.offs[o + 1] + T_.x * c.offs[o + 2],
      C_.y + N_.y * c.offs[o] + B_.y * c.offs[o + 1] + T_.y * c.offs[o + 2],
      C_.z + N_.z * c.offs[o] + B_.z * c.offs[o + 1] + T_.z * c.offs[o + 2],
    ).applyMatrix4(c.meshInv);
    pa[o] = _tabV0.x;
    pa[o + 1] = _tabV0.y;
    pa[o + 2] = _tabV0.z;
    _tabV0.set(
      N_.x * c.nOffs[o] + B_.x * c.nOffs[o + 1] + T_.x * c.nOffs[o + 2],
      N_.y * c.nOffs[o] + B_.y * c.nOffs[o + 1] + T_.y * c.nOffs[o + 2],
      N_.z * c.nOffs[o] + B_.z * c.nOffs[o + 1] + T_.z * c.nOffs[o + 2],
    ).applyMatrix3(c.normalInv).normalize();
    na[o] = _tabV0.x;
    na[o + 1] = _tabV0.y;
    na[o + 2] = _tabV0.z;
  }
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
}

/** Kinematic stand-ins for the cars (same boxes as their physics bodies). */
function _cabledSyncCarProxies(dt) {
  const S = _cabled;
  for (const ctx of arenaCars) {
    if (!ctx.ready) continue;
    const info = withCar(ctx, () =>
      carPhysBody
        ? {
            p: carPhysBody.position,
            q: carPhysBody.quaternion,
            hx: carPhysHalf.x,
            hy: carPhysHalf.y,
            hz: carPhysHalf.z,
          }
        : null,
    );
    if (!info) continue;
    let px = S.proxies.get(ctx);
    if (!px) {
      px = new CANNON.Body({ type: CANNON.Body.KINEMATIC, material: S.staticMaterial });
      px.addShape(new CANNON.Box(new CANNON.Vec3(info.hx, info.hy, info.hz)));
      px.position.copy(info.p);
      S.world.addBody(px);
      px._prev = new CANNON.Vec3().copy(info.p);
      S.proxies.set(ctx, px);
    }
    // Velocity from this frame's motion, so the kinematic box pushes properly.
    const inv = dt > 0 ? 1 / dt : 0;
    px.velocity.set((info.p.x - px._prev.x) * inv, (info.p.y - px._prev.y) * inv, (info.p.z - px._prev.z) * inv);
    if (px.velocity.length() > 30) px.velocity.scale(30 / px.velocity.length(), px.velocity);
    px.position.copy(px._prev);
    px._prev.copy(info.p);
    px.quaternion.copy(info.q);
    px.aabbNeedsUpdate = true;
    // Wake an object when a car comes close.
    for (const O of _cabledObjects) {
      if (O.body.sleepState === CANNON.Body.AWAKE) continue;
      const d = Math.hypot(info.p.x - O.body.position.x, info.p.z - O.body.position.z);
      if (d < Math.hypot(O.he.x, O.he.z) + Math.hypot(info.hx, info.hz) + 0.05) O.body.wakeUp();
    }
  }
}

/** A car hitting an object loses speed along the hit by the mass ratio. */
function _cabledCarResponse(O, hits) {
  for (const [ctx, hit] of hits) {
    if (O.contactPrev.has(ctx) || hit.closing < 0.15) continue;
    const dv = ((1 + O.cfg.carRestitution) * O.cfg.mass * hit.closing) / (O.cfg.mass + CAR_MASS);
    withCar(ctx, () => {
      if (carPhysState === CAR_PHYS.DRIVING) {
        const fx = Math.sin(carState.angle);
        const fz = Math.cos(carState.angle);
        const fn = fx * hit.nx + fz * hit.nz; // n: car → object
        if (carState.speed * fn > 0) {
          const s = Math.abs(carState.speed);
          carState.speed = Math.sign(carState.speed) * Math.max(0, s - dv * Math.abs(fn));
        }
      } else if (carPhysBody && carPhysState === CAR_PHYS.IMPACT) {
        carPhysBody.velocity.x -= hit.nx * dv;
        carPhysBody.velocity.z -= hit.nz * dv;
      }
    });
  }
  O.contactPrev = new Set(hits.keys());
}

/** Car ↔ object contacts of the last world step (closing speed along the normal). */
function _cabledCollectCarHits(hits) {
  const S = _cabled;
  for (const eq of S.world.contacts) {
    for (const O of _cabledObjects) {
      const isA = eq.bi === O.body;
      if (!isA && eq.bj !== O.body) continue;
      const other = isA ? eq.bj : eq.bi;
      for (const [ctx, px] of S.proxies) {
        if (px !== other) continue;
        // eq.ni points from bi to bj: make it car → object.
        const s = isA ? -1 : 1;
        const nx = eq.ni.x * s;
        const nz = eq.ni.z * s;
        const closing = (px.velocity.x - O.body.velocity.x) * nx + (px.velocity.z - O.body.velocity.z) * nz;
        const h = hits.get(O).get(ctx);
        if (!h || closing > h.closing) hits.get(O).set(ctx, { closing, nx, nz });
      }
    }
  }
}

function updateCabledObjects(dt) {
  const S = _cabled;
  if (!S || !_cabledObjects.length) return;
  const frameDt = Math.min(dt, 0.05);
  _cabledSyncCarProxies(frameDt);
  const hits = new Map(_cabledObjects.map((O) => [O, new Map()]));
  S.acc += frameDt;
  while (S.acc >= CABLED_PHYS_DT) {
    S.acc -= CABLED_PHYS_DT;
    for (let sub = 0; sub < CABLED_WORLD_SUBSTEPS; sub++) {
      for (const O of _cabledObjects) {
        if (O.cable && O.cable.hangForce > 0 && O.body.sleepState === CANNON.Body.AWAKE) {
          const a0 = _cabledAttachWorld(O, 0, new THREE.Vector3());
          _tabCV.set(0, -O.cable.hangForce, 0);
          _tabCV2.set(a0.x - O.body.position.x, a0.y - O.body.position.y, a0.z - O.body.position.z);
          O.body.applyForce(_tabCV, _tabCV2);
        }
      }
      S.world.step(CABLED_PHYS_DT / CABLED_WORLD_SUBSTEPS);
      _cabledCollectCarHits(hits);
    }
    // Cords apart first: each cord's own step ends with its collisions.
    _cabledCordsApart();
    for (const O of _cabledObjects) {
      if (O.body.sleepState === CANNON.Body.AWAKE && O.cable) O.cable.active = true;
      if (O.cable && O.cable.active) _cabledCableStep(O, CABLED_PHYS_DT);
      // Speed caps (after the cord's pull too): no unrealistic launches.
      const v = O.body.velocity;
      const sp = v.length();
      if (sp > O.cfg.maxSpeed) v.scale(O.cfg.maxSpeed / sp, v);
      const w = O.body.angularVelocity;
      const ws = w.length();
      if (ws > O.cfg.maxSpin) w.scale(O.cfg.maxSpin / ws, w);
      // The table / floor have the last word (after the cord's pull).
      if (O.body.sleepState === CANNON.Body.AWAKE) _cabledDepenetrate(O);
    }
  }
  for (const O of _cabledObjects) {
    _cabledCarResponse(O, hits.get(O));
    // Visual object follows the body (parts keep their offsets inside it).
    const b = O.body;
    _tabQ.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    O.group.position.copy(O.offset).applyQuaternion(_tabQ).add(_tabV0.set(b.position.x, b.position.y, b.position.z));
    O.group.quaternion.copy(_tabQ);
    if (O.cable && O.cable.active) _cabledCableDraw(O);
  }
}

const FREE_CABLE_HEAD_NAMES = [
  "freeCableYellow",
  "freeCableGreen",
  "freeCableBlue",
  "freeCableEdge1",
  "freeCableEdge2",
  "freeCableEdge3",
];
const FREE_CABLE_SAMPLES = 36;
const FREE_CABLE_ATTACK_INNER = 0.16;
const FREE_CABLE_ATTACK_OUTER = 0.52;

function _cableClamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function _cableRand(min, max) {
  return min + Math.random() * (max - min);
}

function _cableRollStrike(cable) {
  if (!cable) return;
  cable.strike = {
    coilWait: _cableRand(0.36, 0.72),
    lungeDur: _cableRand(0.1, 0.19),
    holdDur: _cableRand(0.09, 0.2),
    retractDur: _cableRand(0.32, 0.5),
    midRetract: _cableRand(0.3, 0.44),
    sideSign: Math.random() < 0.5 ? -1 : 1,
    sideAmp: _cableRand(0.01, 0.03),
    archMul: _cableRand(0.78, 1.24),
    slitherAmp: _cableRand(0.01, 0.022),
    slitherHz: _cableRand(1.12, 1.82),
    slitherPhase: _cableRand(0, Math.PI * 2),
    waveAmp: _cableRand(0.007, 0.016),
    waveHz: _cableRand(0.62, 0.98),
    hoodBase: _cableRand(0.03, 0.05),
    riseMul: _cableRand(0.82, 1.18),
    poseMul: _cableRand(0.9, 1.06),
    tipRateMul: _cableRand(0.82, 1.22),
    turnMul: _cableRand(0.84, 1.18),
    followMul: _cableRand(0.86, 1.16),
    whipYaw: _cableRand(-0.28, 0.28),
  };
}

function _cableSmoothstep(edge0, edge1, x) {
  const t = _cableClamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function _cableBuildCenterline(mesh) {
  const pos = mesh.geometry.attributes.position;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const binCount = 28;
  const sums = Array.from({ length: binCount }, () => [0, 0, 0, 0]);
  const span = Math.max(1e-6, yMax - yMin);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    let b = Math.floor(((y - yMin) / span) * (binCount - 1e-5));
    if (b < 0) b = 0;
    else if (b >= binCount) b = binCount - 1;
    sums[b][0] += pos.getX(i);
    sums[b][1] += y;
    sums[b][2] += pos.getZ(i);
    sums[b][3] += 1;
  }
  const pts = [];
  for (let i = 0; i < binCount; i++) {
    const s = sums[i];
    if (!s[3]) continue;
    pts.push(new THREE.Vector3(s[0] / s[3], s[1] / s[3], s[2] / s[3]));
  }
  return pts;
}

function _cableSegmentLengths(pts) {
  const lengths = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = pts[i].distanceTo(pts[i + 1]);
    lengths.push(len);
    total += len;
  }
  return { lengths, total };
}

const _cableTanCopy = Array.from(
  { length: FREE_CABLE_SAMPLES },
  () => new THREE.Vector3(),
);
const _cableTipO = new THREE.Vector3();
const _cableTipN = new THREE.Vector3();
const _cableTipT = new THREE.Vector3();
const _cableTipB = new THREE.Vector3();

function _cableBuildFrames(pts, frames) {
  const n = pts.length;
  const tans = frames.tan;
  for (let i = 0; i < n; i++) {
    if (i === 0) tans[i].subVectors(pts[1], pts[0]);
    else if (i === n - 1) {
      const back = Math.max(0, n - 4);
      tans[i].subVectors(pts[n - 1], pts[back]);
    } else tans[i].subVectors(pts[i + 1], pts[i - 1]);
    if (tans[i].lengthSq() < 1e-10) tans[i].set(0, 1, 0);
    else tans[i].normalize();
    frames.o[i].copy(pts[i]);
  }
  for (let i = 0; i < n; i++) _cableTanCopy[i].copy(tans[i]);
  for (let i = 1; i < n - 1; i++) {
    tans[i]
      .copy(_cableTanCopy[i - 1])
      .add(_cableTanCopy[i])
      .add(_cableTanCopy[i])
      .add(_cableTanCopy[i + 1]);
    if (tans[i].lengthSq() < 1e-10) tans[i].copy(_cableTanCopy[i]);
    else tans[i].normalize();
  }
  const nrm = frames.n;
  nrm[0].set(1, 0, 0);
  if (Math.abs(tans[0].dot(nrm[0])) > 0.85) nrm[0].set(0, 0, 1);
  nrm[0].crossVectors(tans[0], nrm[0]).cross(tans[0]);
  if (nrm[0].lengthSq() < 1e-10) nrm[0].set(0, 0, 1);
  else nrm[0].normalize();
  const axis = _freeCable.vA;
  for (let i = 1; i < n; i++) {
    axis.crossVectors(tans[i - 1], tans[i]);
    const axisLen = axis.length();
    if (axisLen > 1e-6) {
      const angle = Math.acos(Math.min(1, Math.max(-1, tans[i - 1].dot(tans[i]))));
      nrm[i].copy(nrm[i - 1]).applyAxisAngle(axis.multiplyScalar(1 / axisLen), angle);
    } else {
      nrm[i].copy(nrm[i - 1]);
    }
    nrm[i].addScaledVector(tans[i], -nrm[i].dot(tans[i]));
    if (nrm[i].lengthSq() < 1e-10) {
      nrm[i].set(1, 0, 0);
      nrm[i].crossVectors(tans[i], nrm[i]).cross(tans[i]);
    }
    nrm[i].normalize();
  }
  for (let i = 0; i < n; i++) {
    frames.b[i].crossVectors(tans[i], nrm[i]).normalize();
  }
}

function _cableSampleFrame(frames, t, outO, outN, outT, outB) {
  const last = frames.o.length - 1;
  const u = _cableClamp01(t) * last;
  const i = Math.min(last - 1, Math.floor(u));
  const f = u - i;
  outO.lerpVectors(frames.o[i], frames.o[i + 1], f);
  outT.lerpVectors(frames.tan[i], frames.tan[i + 1], f);
  if (outT.lengthSq() < 1e-10) outT.set(0, 1, 0);
  else outT.normalize();
  outN.lerpVectors(frames.n[i], frames.n[i + 1], f);
  outN.addScaledVector(outT, -outN.dot(outT));
  if (outN.lengthSq() < 1e-10) {
    outN.set(1, 0, 0);
    if (Math.abs(outT.dot(outN)) > 0.85) outN.set(0, 0, 1);
    outN.crossVectors(outT, outN).cross(outT);
  }
  outN.normalize();
  outB.crossVectors(outT, outN).normalize();
}

function _cableMakeFrames() {
  const o = [];
  const n = [];
  const tan = [];
  const b = [];
  for (let i = 0; i < FREE_CABLE_SAMPLES; i++) {
    o.push(new THREE.Vector3());
    n.push(new THREE.Vector3());
    tan.push(new THREE.Vector3());
    b.push(new THREE.Vector3());
  }
  return { o, n, tan, b };
}

function _cableResample(curve, outPts) {
  const spaced = curve.getSpacedPoints(FREE_CABLE_SAMPLES - 1);
  for (let i = 0; i < FREE_CABLE_SAMPLES; i++) outPts[i].copy(spaced[i]);
}

function _cableEaseOutCubic(t) {
  const u = 1 - _cableClamp01(t);
  return 1 - u * u * u;
}

function _cableEaseInOut(t) {
  t = _cableClamp01(t);
  return t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) * (2 - 2 * t) * 0.5;
}

function _cableRotateDir(dir, desired, maxRad) {
  const dx = desired.x;
  const dz = desired.z;
  const dLen = Math.hypot(dx, dz);
  if (dLen < 1e-8) return;
  const dxn = dx / dLen;
  const dzn = dz / dLen;
  dir.y = 0;
  let cLen = Math.hypot(dir.x, dir.z);
  if (cLen < 1e-8) {
    dir.set(dxn, 0, dzn);
    return;
  }
  dir.x /= cLen;
  dir.z /= cLen;
  const cross = dir.x * dzn - dir.z * dxn;
  const dot = Math.min(1, Math.max(-1, dir.x * dxn + dir.z * dzn));
  const ang = Math.atan2(cross, dot);
  const step = Math.max(-maxRad, Math.min(maxRad, ang));
  const cs = Math.cos(step);
  const sn = Math.sin(step);
  const nx = dir.x * cs - dir.z * sn;
  const nz = dir.x * sn + dir.z * cs;
  dir.set(nx, 0, nz);
}

function closestPointOnCarAabb(from, out) {
  boxFromVisibleMeshes(car, _visBox);
  if (_visBox.isEmpty()) {
    out.copy(from);
    return out;
  }
  out.copy(from).clamp(_visBox.min, _visBox.max);
  return out;
}

function closestPointOnCarObb(from, out) {
  if (!carPhysBody) return closestPointOnCarAabb(from, out);
  _physQuat.set(
    carPhysBody.quaternion.x,
    carPhysBody.quaternion.y,
    carPhysBody.quaternion.z,
    carPhysBody.quaternion.w,
  );
  _physQuatInv.copy(_physQuat).invert();
  out.copy(from).sub(carPhysBody.position).applyQuaternion(_physQuatInv);
  out.x = THREE.MathUtils.clamp(out.x, -carPhysHalf.x, carPhysHalf.x);
  out.y = THREE.MathUtils.clamp(out.y, -carPhysHalf.y, carPhysHalf.y);
  out.z = THREE.MathUtils.clamp(out.z, -carPhysHalf.z, carPhysHalf.z);
  out.applyQuaternion(_physQuat).add(carPhysBody.position);
  return out;
}

function _cableOrbitToward(current, desired, anchor, k) {
  const t = _cableClamp01(k);
  const fx = current.x - anchor.x;
  const fz = current.z - anchor.z;
  const tx = desired.x - anchor.x;
  const tz = desired.z - anchor.z;
  const fr = Math.hypot(fx, fz);
  const tr = Math.hypot(tx, tz);
  const fa = fr < 1e-6 ? Math.atan2(tz, tx) : Math.atan2(fz, fx);
  const ta = tr < 1e-6 ? fa : Math.atan2(tz, tx);
  let da = ta - fa;
  if (da > Math.PI) da -= Math.PI * 2;
  else if (da < -Math.PI) da += Math.PI * 2;
  const a = fa + da * t;
  const r = fr + (tr - fr) * t;
  current.set(
    anchor.x + Math.cos(a) * r,
    current.y + (desired.y - current.y) * t,
    anchor.z + Math.sin(a) * r,
  );
}

function _cableRespace(pts, length) {
  const n = pts.length;
  if (n < 2 || length <= 1e-8) return;
  const seg = length / (n - 1);
  const dirs = _freeCable.segDirs;
  for (let i = 0; i < n - 1; i++) {
    dirs[i].subVectors(pts[i + 1], pts[i]);
    if (dirs[i].lengthSq() < 1e-10) {
      if (i > 0) dirs[i].copy(dirs[i - 1]);
      else dirs[i].set(0, 1, 0);
    } else {
      dirs[i].normalize();
    }
  }
  for (let i = 1; i < n; i++) {
    pts[i].copy(pts[i - 1]).addScaledVector(dirs[i - 1], seg);
  }
}

function _cableFairTip(pts, tableY) {
  const n = pts.length;
  if (n < 10) return;
  const last = n - 1;
  const start = last - 5;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = start; i < last; i++) {
      const near = (i - start) / (last - start);
      const k = 0.22 + 0.45 * near * near;
      const mx = (pts[i - 1].x + pts[i + 1].x) * 0.5;
      const my = (pts[i - 1].y + pts[i + 1].y) * 0.5;
      const mz = (pts[i - 1].z + pts[i + 1].z) * 0.5;
      pts[i].x += (mx - pts[i].x) * k;
      pts[i].y += (my - pts[i].y) * k;
      pts[i].z += (mz - pts[i].z) * k;
      if (pts[i].y < tableY) pts[i].y = tableY;
    }
  }
}

const _sparkBox = new THREE.Box3();
const _sparkTmpBox = new THREE.Box3();
const _sparkInv = new THREE.Matrix4();
const _sparkTo = new THREE.Vector3();
const _sparkUp = new THREE.Vector3();
const _sparkPts = new Float32Array(192 * 3);
/** One reusable copy of the arc points per fork depth (no per-frame allocation). */
const _sparkSnapBufs = [0, 1, 2, 3].map(() => new Float32Array(192 * 3));
const _sparkMaxPts = 192;
let _sparkPtCount = 0;

const cableSparkBoltVert = `
attribute vec3 aStart;
attribute vec3 aEnd;
attribute float aSide;
attribute float aAlong;
attribute float aProg;
attribute float aFat;
attribute vec3 aColor;
uniform float uWidth;
uniform vec2 uResolution;
varying vec3 vColor;
varying float vSide;
varying float vProg;
varying float vFat;
void main() {
  vColor = aColor;
  vSide = aSide;
  vProg = aProg;
  vFat = aFat;
  vec3 world = mix(aStart, aEnd, aAlong);
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  mv.z += 0.012;
  vec4 clip = projectionMatrix * mv;
  vec3 dirV = (modelViewMatrix * vec4(aEnd - aStart, 0.0)).xyz;
  vec3 nrm = cross(dirV, vec3(0.0, 0.0, 1.0));
  float nlen = length(nrm);
  if (nlen < 1.0e-6) nrm = vec3(1.0, 0.0, 0.0);
  else nrm /= nlen;
  vec4 clipA = projectionMatrix * modelViewMatrix * vec4(aStart, 1.0);
  vec4 clipB = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);
  vec2 ndcA = clipA.xy / max(abs(clipA.w), 1.0e-4);
  vec2 ndcB = clipB.xy / max(abs(clipB.w), 1.0e-4);
  vec2 asp = vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
  vec2 dir = (ndcB - ndcA) * asp;
  float len = length(dir);
  vec2 n = len > 1.0e-6 ? vec2(-dir.y, dir.x) / len : vec2(nrm.x, nrm.y);
  n.x /= asp.x;
  clip.xy += n * aSide * uWidth * aFat * 2.0 / max(uResolution.y, 1.0) * clip.w;
  gl_Position = clip;
}
`;

const cableSparkBoltFrag = `
varying vec3 vColor;
varying float vSide;
varying float vProg;
varying float vFat;
uniform float uIntensity;
uniform float uFlash;
uniform float uOpacity;
uniform float uGlow;
void main() {
  float w = abs(vSide);
  float glowLayer = step(1.0, vFat);
  float edge = glowLayer > 0.5
    ? (1.0 - smoothstep(0.05, 1.0, w)) * 0.34 * uGlow
    : (1.0 - smoothstep(0.0, 0.48, w));
  float tip = 1.0 - smoothstep(0.88, 1.0, vProg);
  float a = edge * tip * uOpacity * (0.6 + uIntensity * 0.28 + uFlash * 0.42);
  if (a < 0.018) discard;
  vec3 col = glowLayer > 0.5
    ? vec3(0.12, 0.55, 1.0)
    : mix(vec3(0.55, 0.9, 1.0), vec3(1.0, 1.0, 1.0), 1.0 - w);
  col *= vColor;
  col *= 0.9 + uFlash * 0.55 + uIntensity * 0.3;
  gl_FragColor = vec4(col * a, a);
}
`;

function _sparkHash(i) {
  i |= 0;
  i = Math.imul(i ^ (i >>> 16), 2246822519);
  i = Math.imul(i ^ (i >>> 13), 3266489917);
  return ((i ^ (i >>> 16)) >>> 0) / 4294967296;
}

function _sparkPushPt(x, y, z) {
  if (_sparkPtCount >= _sparkMaxPts) return;
  const o = _sparkPtCount * 3;
  _sparkPts[o] = x;
  _sparkPts[o + 1] = y;
  _sparkPts[o + 2] = z;
  _sparkPtCount += 1;
}

function _sparkOrthonormal(dx, dy, dz) {
  let lx = 0;
  let ly = 1;
  let lz = 0;
  if (Math.abs(dy) > 0.92) {
    lx = 1;
    ly = 0;
  }
  let bx = dy * lz - dz * ly;
  let by = dz * lx - dx * lz;
  let bz = dx * ly - dy * lx;
  const bLen = Math.hypot(bx, by, bz) || 1;
  bx /= bLen;
  by /= bLen;
  bz /= bLen;
  lx = by * dz - bz * dy;
  ly = bz * dx - bx * dz;
  lz = bx * dy - by * dx;
  return [bx, by, bz, lx, ly, lz];
}

function _sparkSubdivide(x0, y0, z0, x1, y1, z1, depth, offset, seed) {
  if (
    depth <= 0 ||
    offset < 1e-5 ||
    _sparkPtCount >= _sparkMaxPts - 2
  ) {
    _sparkPushPt(x1, y1, z1);
    return;
  }
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const [bx, by, bz, lx, ly, lz] = _sparkOrthonormal(dx, dy, dz);
  const split = 0.28 + _sparkHash(seed + 1) * 0.44;
  const j = (_sparkHash(seed) - 0.5) * 2 * offset;
  const k = (_sparkHash(seed + 5) - 0.5) * 2 * offset * (0.45 + _sparkHash(seed + 8));
  const mx = x0 + dx * split + bx * j + lx * k;
  const my = y0 + dy * split + by * j + ly * k;
  const mz = z0 + dz * split + bz * j + lz * k;
  _sparkSubdivide(x0, y0, z0, mx, my, mz, depth - 1, offset * 0.52, seed + 11);
  _sparkSubdivide(mx, my, mz, x1, y1, z1, depth - 1, offset * 0.48, seed + 29);
}

function _sparkLiftPath(spark, minY) {
  if (!Number.isFinite(minY)) return;
  spark.group.updateMatrixWorld(true);
  for (let i = 0; i < _sparkPtCount; i++) {
    const o = i * 3;
    _sparkTo.set(_sparkPts[o], _sparkPts[o + 1], _sparkPts[o + 2]);
    spark.group.localToWorld(_sparkTo);
    if (_sparkTo.y < minY) _sparkTo.y = minY;
    spark.group.worldToLocal(_sparkTo);
    _sparkPts[o] = _sparkTo.x;
    _sparkPts[o + 1] = _sparkTo.y;
    _sparkPts[o + 2] = _sparkTo.z;
  }
}

function _sparkWriteQuad(spark, ax, ay, az, bx, by, bz, cr, cg, cb, p0, p1, fat) {
  if (spark.quadCount >= spark.maxQuad) return;
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  if (dx * dx + dy * dy + dz * dz < 1e-12) return;
  const base = spark.quadCount * 6;
  const start = spark.aStart;
  const end = spark.aEnd;
  const side = spark.aSide;
  const along = spark.aAlong;
  const prog = spark.aProg;
  const fats = spark.aFat;
  const col = spark.aColor;
  const pos = spark.aPos;
  const sides = [-1, 1, 1, -1, 1, -1];
  const alongs = [0, 0, 1, 0, 1, 1];
  for (let i = 0; i < 6; i++) {
    const v = base + i;
    const o3 = v * 3;
    start[o3] = ax;
    start[o3 + 1] = ay;
    start[o3 + 2] = az;
    end[o3] = bx;
    end[o3 + 1] = by;
    end[o3 + 2] = bz;
    side[v] = sides[i];
    along[v] = alongs[i];
    prog[v] = alongs[i] < 0.5 ? p0 : p1;
    fats[v] = fat;
    col[o3] = cr;
    col[o3 + 1] = cg;
    col[o3 + 2] = cb;
    const t = alongs[i];
    pos[o3] = ax + dx * t;
    pos[o3 + 1] = ay + dy * t;
    pos[o3 + 2] = az + dz * t;
  }
  spark.quadCount += 1;
}

function _sparkWritePath(spark, bright) {
  if (_sparkPtCount < 2) return;
  const n = _sparkPtCount;
  let total = 0;
  const seg = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 3;
    const b = (i + 1) * 3;
    const d = Math.hypot(
      _sparkPts[b] - _sparkPts[a],
      _sparkPts[b + 1] - _sparkPts[a + 1],
      _sparkPts[b + 2] - _sparkPts[a + 2],
    );
    seg.push(d);
    total += d;
  }
  if (total < 1e-6) return;
  let acc = 0;
  const hot = 0.7 + 0.3 * bright;
  for (let i = 0; i < n - 1; i++) {
    const a = i * 3;
    const b = (i + 1) * 3;
    const p0 = acc / total;
    acc += seg[i];
    const p1 = acc / total;
    const mid = (p0 + p1) * 0.5;
    const w = bright * (0.78 + 0.22 * (1 - mid));
    _sparkWriteQuad(
      spark,
      _sparkPts[a],
      _sparkPts[a + 1],
      _sparkPts[a + 2],
      _sparkPts[b],
      _sparkPts[b + 1],
      _sparkPts[b + 2],
      0.45 * w,
      0.7 * w,
      1,
      p0,
      p1,
      spark.glowFat || 3.05,
    );
    _sparkWriteQuad(
      spark,
      _sparkPts[a],
      _sparkPts[a + 1],
      _sparkPts[a + 2],
      _sparkPts[b],
      _sparkPts[b + 1],
      _sparkPts[b + 2],
      hot * w,
      hot * w,
      1,
      p0,
      p1,
      0.32,
    );
  }
}

function _sparkEmitTree(
  spark,
  minY,
  ox,
  oy,
  oz,
  dx,
  dy,
  dz,
  seed,
  live,
  gen,
  maxGen,
) {
  const len = Math.hypot(dx, dy, dz);
  const minLen = spark.minLen || 0.01;
  if (len < minLen || spark.quadCount >= spark.maxQuad - 8) return;
  const depth = len < (spark.jagMax || 0.04) * 2 ? 4 : 5;
  const jagCap = spark.jagMax
    ? spark.jagMax * (0.85 + live * 0.3)
    : 0.022 + live * 0.006;
  const jitter = Math.min(len * 0.38, jagCap);
  _sparkPtCount = 0;
  _sparkPushPt(ox, oy, oz);
  _sparkSubdivide(ox, oy, oz, ox + dx, oy + dy, oz + dz, depth, jitter, seed);
  _sparkLiftPath(spark, minY);
  const snapN = _sparkPtCount;
  let snap;
  if (gen < _sparkSnapBufs.length) {
    snap = _sparkSnapBufs[gen];
    snap.set(_sparkPts.subarray(0, snapN * 3));
  } else {
    snap = _sparkPts.slice(0, snapN * 3);
  }
  const bright = 0.55 + live * 0.45 + (1 - gen * 0.16);
  _sparkWritePath(spark, bright);
  if (gen >= maxGen || snapN < 4) return;
  const forks =
    gen === 0
      ? 1 + (_sparkHash(seed + 19) > 0.35 ? 1 : 0) + (live > 0.4 ? 1 : 0) + (live > 0.7 ? 1 : 0)
      : _sparkHash(seed + 21) > 0.4
        ? 1
        : 0;
  for (let f = 0; f < forks; f++) {
    const fs = seed + 40 + f * 17;
    const idx = 1 + ((_sparkHash(fs) * (snapN - 3)) | 0);
    const o = idx * 3;
    const bx = snap[o];
    const by = snap[o + 1];
    const bz = snap[o + 2];
    let px = 0;
    let py = 1;
    let pz = 0;
    if (idx + 1 < snapN) {
      px = snap[o + 3] - bx;
      py = snap[o + 4] - by;
      pz = snap[o + 5] - bz;
    }
    const [sx, sy, sz, tx, ty, tz] = _sparkOrthonormal(px, py, pz);
    const ang = (_sparkHash(fs + 4) - 0.5) * Math.PI * 1.7;
    const lift = (_sparkHash(fs + 9) - 0.5) * 0.7;
    const cs = Math.cos(ang);
    const sn = Math.sin(ang);
    const childLen = len * (0.18 + _sparkHash(fs + 6) * 0.28) * (1 - gen * 0.2);
    const cx = (sx * cs + tx * sn) * childLen;
    const cy = (sy * cs + ty * sn) * childLen + lift * childLen;
    const cz = (sz * cs + tz * sn) * childLen;
    _sparkEmitTree(spark, minY, bx, by, bz, cx, cy, cz, fs, live, gen + 1, maxGen);
  }
}

function _sparkClear(spark) {
  spark.quadCount = 0;
  spark.boltGeo.setDrawRange(0, 0);
  spark.bolts.visible = false;
  spark.boltMat.uniforms.uIntensity.value = 0;
  spark.boltMat.uniforms.uFlash.value = 0;
  spark.boltMat.uniforms.uOpacity.value = 0;
  spark.boltMat.uniforms.uGlow.value = 0;
  spark.light.intensity = 0;
}

function _sparkFlashEnvelope(t) {
  if (t <= 0 || t >= 1) return 0;
  if (t < 0.1) return t / 0.1;
  if (t < 0.38) return 1;
  return Math.max(0, 1 - (t - 0.38) / 0.62);
}

function _sparkSyncResolution() {
  const w = renderer.domElement.width;
  const h = renderer.domElement.height;
  const sparks = [_freeCable && _freeCable.spark, _carHitSpark];
  for (let i = 0; i < arenaCars.length; i++) sparks.push(arenaCars[i]._carHitSpark);
  for (let i = 0; i < sparks.length; i++) {
    const spark = sparks[i];
    if (!spark || !spark.boltMat) continue;
    spark.boltMat.uniforms.uResolution.value.set(w, h);
  }
}

function setupFreeCableSparks(cable) {
  const head = cable.head;
  head.updateMatrixWorld(true);
  _sparkInv.copy(head.matrixWorld).invert();
  _sparkBox.makeEmpty();
  const names = [
    "freeCableEdge1",
    "freeCableEdge2",
    "freeCableEdge3",
    "freeCableYellow",
    "freeCableGreen",
    "freeCableBlue",
  ];
  for (const name of names) {
    const mesh = head.getObjectByName(name);
    if (!mesh || !mesh.isMesh || !mesh.geometry) continue;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    _sparkTmpBox.copy(mesh.geometry.boundingBox);
    _sparkTmpBox.applyMatrix4(mesh.matrixWorld);
    _sparkTmpBox.applyMatrix4(_sparkInv);
    _sparkBox.union(_sparkTmpBox);
  }
  if (_sparkBox.isEmpty()) return;
  const center = _sparkBox.getCenter(new THREE.Vector3());
  const size = _sparkBox.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z, 0.008);
  const radius = Math.max(0.048, extent * 2.7);
  _sparkUp.set(0, 1, 0).transformDirection(_sparkInv);
  if (_sparkUp.lengthSq() < 1e-8) _sparkUp.set(0, 1, 0);
  else _sparkUp.normalize();
  center.addScaledVector(_sparkUp, radius * 0.18);

  const group = new THREE.Group();
  group.name = "freeCableSpark";
  group.position.copy(center);
  head.add(group);

  const maxQuad = 1200;
  const vertCount = maxQuad * 6;
  const aPos = new Float32Array(vertCount * 3);
  const aStart = new Float32Array(vertCount * 3);
  const aEnd = new Float32Array(vertCount * 3);
  const aSide = new Float32Array(vertCount);
  const aAlong = new Float32Array(vertCount);
  const aProg = new Float32Array(vertCount);
  const aFat = new Float32Array(vertCount);
  const aColor = new Float32Array(vertCount * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(aPos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aStart", new THREE.BufferAttribute(aStart, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aEnd", new THREE.BufferAttribute(aEnd, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aSide", new THREE.BufferAttribute(aSide, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aAlong", new THREE.BufferAttribute(aAlong, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aProg", new THREE.BufferAttribute(aProg, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aFat", new THREE.BufferAttribute(aFat, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aColor", new THREE.BufferAttribute(aColor, 3).setUsage(THREE.DynamicDrawUsage));
  const boltMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      uWidth: { value: 2.2 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uIntensity: { value: 0 },
      uFlash: { value: 0 },
      uOpacity: { value: 0 },
      uGlow: { value: 0 },
    },
    vertexShader: cableSparkBoltVert,
    fragmentShader: cableSparkBoltFrag,
  });
  const bolts = new THREE.Mesh(geo, boltMat);
  bolts.name = "freeCableSparkArcs";
  bolts.renderOrder = 7;
  bolts.frustumCulled = false;
  bolts.castShadow = false;
  bolts.receiveShadow = false;
  group.add(bolts);

  const light = new THREE.PointLight(0x4ec8ff, 0, radius * 16, 2);
  light.name = "freeCableSparkLight";
  light.castShadow = false;
  group.add(light);

  cable.spark = {
    group,
    bolts,
    boltMat,
    boltGeo: geo,
    aPos,
    aStart,
    aEnd,
    aSide,
    aAlong,
    aProg,
    aFat,
    aColor,
    maxQuad,
    quadCount: 0,
    light,
    radius,
    intensity: 0,
    reach: 0,
    width: 2.2,
    flash: 0,
    flashT: 0,
    flashDur: 0,
    flashPeak: 1,
    burst: 0,
    nextFlash: 0.22 + Math.random() * 0.7,
    flickT: 0,
    flickSeed: 1,
    topoT: 0,
    leaders: [],
    seed: (Math.random() * 2048) | 0,
    lastPhase: "rest",
    glowFat: 2.9,
  };
  _sparkSyncResolution();
}

function updateFreeCableSparks(cable, dt, alert) {
  const spark = cable.spark;
  if (!spark) return;
  const phase = cable.phase;
  const idle = alert < 0.18 && phase === "rest";
  const lungeStart = phase === "lunge" && spark.lastPhase !== "lunge";
  if (lungeStart) {
    spark.burst = 1;
    spark.nextFlash = 0;
  }
  spark.lastPhase = phase;

  let goal = 0.11;
  if (alert > 0.04) goal = 0.16 + alert * 0.52;
  if (phase === "coil") goal += 0.28;
  else if (phase === "lunge") goal += 0.95;
  else if (phase === "hold") goal += 0.78;
  else if (phase === "retract") goal += 0.2 + cable.lunge * 0.35;
  if (idle) goal = 0;
  const follow = dt <= 0 ? 1 : 1 - Math.exp(-dt * (phase === "lunge" ? 7.5 : 3.6));
  spark.intensity += (goal - spark.intensity) * follow;
  if (idle && spark.intensity < 0.02) spark.intensity = 0;

  if (dt > 0) {
    spark.nextFlash -= dt;
    spark.flickT -= dt;
    spark.burst *= Math.exp(-dt * 4.6);
    if (spark.flashDur > 0) spark.flashT += dt;
    if (spark.nextFlash <= 0) {
      if (idle && spark.flashDur > 0) {
        spark.nextFlash = 0.04;
      } else {
        spark.flashPeak = idle ? 0.75 + Math.random() * 0.25 : 0.5 + Math.random() * 0.5;
        spark.flashDur = idle ? 0.05 + Math.random() * 0.07 : 0.06 + Math.random() * 0.09;
        spark.flashT = 0;
        spark.seed += 17 + ((Math.random() * 11) | 0);
        spark.flickSeed += 23;
        spark.topoT = 0;
        if (idle) {
          const tight = Math.random() < 0.52;
          const gap = tight
            ? 0.16 + Math.pow(Math.random(), 1.2) * 0.52
            : 0.48 + (-Math.log(Math.max(0.08, Math.random()))) * 0.45;
          spark.nextFlash = spark.flashDur + gap;
        } else {
          let rate = 0.38 + alert * 2.6;
          if (phase === "coil") rate += 1.8;
          if (phase === "lunge" || phase === "hold") rate += 6.4;
          if (phase === "retract") rate += 0.9;
          spark.nextFlash =
            0.045 +
            (-Math.log(Math.max(0.02, Math.random())) / Math.max(0.12, rate));
        }
      }
    }
  }
  const env = _sparkFlashEnvelope(spark.flashDur > 0 ? spark.flashT / spark.flashDur : 1);
  spark.flash = env * spark.flashPeak;
  if (spark.flashT >= spark.flashDur) {
    spark.flash = 0;
    spark.flashDur = 0;
  }

  const flashU = Math.min(1, spark.flash * 0.9 + spark.burst * 0.4);
  const live = idle
    ? spark.flash
    : Math.min(1.85, spark.intensity + spark.flash * 0.9 + spark.burst * 0.45);
  if (live < 0.045) {
    _sparkClear(spark);
    spark.reach = idle ? 0 : spark.reach * (dt <= 0 ? 0 : Math.exp(-dt * 8));
    return;
  }

  const targetReach = idle
    ? spark.radius * (0.42 + spark.flashPeak * 0.22 + _sparkHash(spark.seed + 5) * 0.18)
    : spark.radius * (0.52 + spark.intensity * 0.28 + flashU * 0.12);
  if (idle) spark.reach = targetReach;
  else {
    const reachK = dt <= 0 ? 1 : 1 - Math.exp(-dt * 3.2);
    spark.reach += (targetReach - spark.reach) * reachK;
  }
  const targetWidth = 1.7 + spark.intensity * 0.4 + flashU * 0.34;
  spark.width += (targetWidth - spark.width) * (dt <= 0 ? 1 : 1 - Math.exp(-dt * 5));

  if (spark.flickT <= 0) {
    spark.flickT = idle ? 0.012 + Math.random() * 0.012 : 0.018 + Math.random() * 0.03;
    spark.flickSeed += 13 + ((Math.random() * 9) | 0);
  }

  if (spark.topoT <= 0 || spark.leaders.length === 0) {
    spark.topoT = idle ? 0 : flashU > 0.55 ? 0.08 + Math.random() * 0.07 : 0.28 + Math.random() * 0.36;
    if (!spark.leaders.length) {
      for (let i = 0; i < 6; i++) spark.leaders.push({ seed: 1, az: 0, el: 0, thick: 1 });
    }
    const nLead = idle ? 1 + ((Math.random() * 1.8) | 0) : 3 + (live > 0.55 ? 1 : 0);
    for (let i = 0; i < 6; i++) {
      const s = spark.seed + spark.flickSeed + i * 97;
      spark.leaders[i].seed = s;
      spark.leaders[i].az = _sparkHash(s) * Math.PI * 2;
      spark.leaders[i].el = (_sparkHash(s + 3) * 2 - 1) * 1.15;
      spark.leaders[i].thick = 0.65 + _sparkHash(s + 8) * 0.9;
      spark.leaders[i].on = i < nLead;
    }
  } else if (idle) {
    for (let i = 0; i < 6; i++) {
      if (!spark.leaders[i].on) continue;
      spark.leaders[i].seed = spark.seed + spark.flickSeed + i * 97;
      spark.leaders[i].az += (_sparkHash(spark.flickSeed + i) - 0.5) * 0.55;
      spark.leaders[i].el += (_sparkHash(spark.flickSeed + i + 4) - 0.5) * 0.4;
    }
  }

  const crackle = 0.72 + 0.28 * _sparkHash(spark.flickSeed);
  spark.boltMat.uniforms.uIntensity.value = live;
  spark.boltMat.uniforms.uFlash.value = flashU * crackle;
  spark.boltMat.uniforms.uWidth.value = spark.width * (0.85 + 0.3 * crackle);
  spark.boltMat.uniforms.uOpacity.value = idle
    ? spark.flash * crackle
    : Math.min(1, 0.45 + live * 0.68 + flashU * 0.18);
  spark.boltMat.uniforms.uGlow.value = idle
    ? 0.5 + spark.flash * 0.55
    : 0.4 + live * 0.36 + flashU * 0.24;
  spark.light.intensity =
    (live * 0.14 + flashU * 0.4) * crackle * (1.1 - lightBlend * 0.35);
  spark.light.distance = spark.radius * 6.5;

  spark.quadCount = 0;
  const maxGen = live > 0.72 ? 2 : live > 0.28 ? 1 : idle ? 1 : 0;
  for (let i = 0; i < 6; i++) {
    const L = spark.leaders[i];
    if (!L.on) continue;
    const appear = idle
      ? spark.flash
      : _cableSmoothstep(i * 0.16, i * 0.16 + 0.22, live);
    if (appear < 0.06) continue;
    const el = Math.max(-1, Math.min(1, L.el));
    const rr = Math.sqrt(Math.max(0, 1 - el * el));
    const len =
      spark.reach *
      appear *
      (0.72 + _sparkHash(L.seed + 5) * 0.38) *
      (0.9 + L.thick * 0.12);
    _sparkEmitTree(
      spark,
      cable.tableY + 0.003,
      0,
      0,
      0,
      Math.cos(L.az) * rr * len,
      el * len,
      Math.sin(L.az) * rr * len,
      L.seed + spark.flickSeed,
      live * appear,
      0,
      maxGen,
    );
  }
  if (
    !idle &&
    (phase === "lunge" || phase === "hold") &&
    cable.lunge > 0.82 &&
    flashU > 0.22
  ) {
    spark.group.updateMatrixWorld(true);
    _sparkTo.copy(cable.carAim);
    spark.group.worldToLocal(_sparkTo);
    const gap = _sparkTo.length();
    if (gap < 0.055 && gap > 0.004) {
      const reach = Math.min(gap * 0.92, spark.reach * 0.45);
      _sparkTo.normalize().multiplyScalar(reach);
      _sparkEmitTree(
        spark,
        cable.tableY + 0.003,
        0,
        0,
        0,
        _sparkTo.x,
        _sparkTo.y,
        _sparkTo.z,
        spark.seed + spark.flickSeed + 200,
        live,
        0,
        Math.max(1, maxGen),
      );
    }
  }
  if (spark.quadCount <= 0) {
    _sparkClear(spark);
    return;
  }
  spark.boltGeo.setDrawRange(0, spark.quadCount * 6);
  spark.boltGeo.attributes.position.needsUpdate = true;
  spark.boltGeo.attributes.aStart.needsUpdate = true;
  spark.boltGeo.attributes.aEnd.needsUpdate = true;
  spark.boltGeo.attributes.aSide.needsUpdate = true;
  spark.boltGeo.attributes.aAlong.needsUpdate = true;
  spark.boltGeo.attributes.aProg.needsUpdate = true;
  spark.boltGeo.attributes.aFat.needsUpdate = true;
  spark.boltGeo.attributes.aColor.needsUpdate = true;
  spark.bolts.visible = true;
}

function _carSparkFlush(spark) {
  spark.boltGeo.setDrawRange(0, spark.quadCount * 6);
  spark.boltGeo.attributes.position.needsUpdate = true;
  spark.boltGeo.attributes.aStart.needsUpdate = true;
  spark.boltGeo.attributes.aEnd.needsUpdate = true;
  spark.boltGeo.attributes.aSide.needsUpdate = true;
  spark.boltGeo.attributes.aAlong.needsUpdate = true;
  spark.boltGeo.attributes.aProg.needsUpdate = true;
  spark.boltGeo.attributes.aFat.needsUpdate = true;
  spark.boltGeo.attributes.aColor.needsUpdate = true;
  spark.bolts.visible = true;
}

function _carSparkPointOnBox(box, seed, out) {
  const sx = Math.max(1e-4, box.max.x - box.min.x);
  const sy = Math.max(1e-4, box.max.y - box.min.y);
  const sz = Math.max(1e-4, box.max.z - box.min.z);
  const ax = sy * sz;
  const ay = sx * sz;
  const az = sx * sy;
  let t = _sparkHash(seed) * (ax * 2 + ay * 2 + az * 2);
  const u = _sparkHash(seed + 1);
  const v = _sparkHash(seed + 2);
  if (t < ax) out.set(box.min.x, box.min.y + u * sy, box.min.z + v * sz);
  else if ((t -= ax) < ax) out.set(box.max.x, box.min.y + u * sy, box.min.z + v * sz);
  else if ((t -= ax) < ay) out.set(box.min.x + u * sx, box.min.y, box.min.z + v * sz);
  else if ((t -= ay) < ay) out.set(box.min.x + u * sx, box.max.y, box.min.z + v * sz);
  else if ((t -= ay) < az) out.set(box.min.x + u * sx, box.min.y + v * sy, box.min.z);
  else out.set(box.min.x + u * sx, box.min.y + v * sy, box.max.z);
  return out;
}

function setupCarHitSparks() {
  if (!car || _carHitSpark) return;
  car.updateMatrixWorld(true);
  _sparkInv.copy(car.matrixWorld).invert();
  _sparkBox.makeEmpty();
  car.traverse((node) => {
    if (!node.isMesh || !node.visible || !node.geometry) return;
    if (node.userData && node.userData.skipBounds) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    _sparkTmpBox.copy(node.geometry.boundingBox);
    _sparkTmpBox.applyMatrix4(node.matrixWorld);
    _sparkTmpBox.applyMatrix4(_sparkInv);
    _sparkBox.union(_sparkTmpBox);
  });
  if (_sparkBox.isEmpty()) return;
  const localBox = _sparkBox.clone();
  const localSize = localBox.getSize(new THREE.Vector3());
  const localCenter = localBox.getCenter(new THREE.Vector3());
  const extent = Math.max(localSize.x, localSize.y, localSize.z, 0.2);

  const group = new THREE.Group();
  group.name = "carHitSpark";
  group.userData.skipBounds = true;
  car.add(group);

  const maxQuad = 1200;
  const vertCount = maxQuad * 6;
  const aPos = new Float32Array(vertCount * 3);
  const aStart = new Float32Array(vertCount * 3);
  const aEnd = new Float32Array(vertCount * 3);
  const aSide = new Float32Array(vertCount);
  const aAlong = new Float32Array(vertCount);
  const aProg = new Float32Array(vertCount);
  const aFat = new Float32Array(vertCount);
  const aColor = new Float32Array(vertCount * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(aPos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aStart", new THREE.BufferAttribute(aStart, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aEnd", new THREE.BufferAttribute(aEnd, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aSide", new THREE.BufferAttribute(aSide, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aAlong", new THREE.BufferAttribute(aAlong, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aProg", new THREE.BufferAttribute(aProg, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aFat", new THREE.BufferAttribute(aFat, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aColor", new THREE.BufferAttribute(aColor, 3).setUsage(THREE.DynamicDrawUsage));
  const boltMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      uWidth: { value: 7.2 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uIntensity: { value: 0 },
      uFlash: { value: 0 },
      uOpacity: { value: 0 },
      uGlow: { value: 0 },
    },
    vertexShader: cableSparkBoltVert,
    fragmentShader: cableSparkBoltFrag,
  });
  const bolts = new THREE.Mesh(geo, boltMat);
  bolts.name = "carHitSparkArcs";
  bolts.renderOrder = 7;
  bolts.frustumCulled = false;
  bolts.castShadow = false;
  bolts.receiveShadow = false;
  bolts.userData.skipBounds = true;
  group.add(bolts);

  const light = new THREE.PointLight(0x4ec8ff, 0, 2, 2);
  light.name = "carHitSparkLight";
  light.castShadow = false;
  light.userData.skipBounds = true;
  light.position.copy(localCenter);
  group.add(light);

  _carHitSpark = {
    group,
    bolts,
    boltMat,
    boltGeo: geo,
    aPos,
    aStart,
    aEnd,
    aSide,
    aAlong,
    aProg,
    aFat,
    aColor,
    maxQuad,
    quadCount: 0,
    light,
    localBox,
    localCenter,
    localSize,
    radius: extent * CAR_SPARK_REACH,
    jagMax: extent * CAR_SPARK_JAG,
    minLen: extent * 0.035,
    width: CAR_SPARK_WIDTH,
    intensity: 0,
    flash: 0,
    flashT: 0,
    flashDur: 0,
    flashPeak: 1,
    nextFlash: 0,
    flickT: 0,
    flickSeed: 1,
    topoT: 0,
    leaders: [],
    seed: (Math.random() * 2048) | 0,
    active: false,
    age: -1,
  };
  group.visible = false;
  _sparkClear(_carHitSpark);
  _sparkSyncResolution();
}

function triggerCarHitSparks() {
  if (!_carHitSpark) setupCarHitSparks();
  const spark = _carHitSpark;
  if (!spark) return;
  spark.active = true;
  spark.age = 0;
  spark.seed = (spark.seed + 31 + ((Math.random() * 50) | 0)) | 0;
  spark.flickSeed += 19;
  spark.topoT = 0;
  spark.flickT = 0;
  spark.flashT = 0;
  spark.flashDur = 0.09;
  spark.flashPeak = 1;
  spark.nextFlash = 0.04;
  spark.leaders.length = 0;
  spark.group.visible = true;
  spark.group.userData.carSparkAge = 0;
  spark.group.userData.carSparkActive = true;
}

function stopCarHitSparks() {
  const spark = _carHitSpark;
  if (!spark) return;
  spark.active = false;
  spark.age = -1;
  spark.leaders.length = 0;
  _sparkClear(spark);
  spark.group.visible = false;
  spark.group.userData.carSparkAge = -1;
  spark.group.userData.carSparkActive = false;
}

function updateCarHitSparks(dt) {
  const spark = _carHitSpark;
  if (!spark || !spark.active) return;
  spark.roomDrive = 0;
  if (dt > 0) spark.age += dt;
  spark.group.userData.carSparkAge = spark.age;
  spark.group.userData.carSparkActive = spark.active;
  if (spark.age >= CAR_HIT_SPARK_DURATION) {
    stopCarHitSparks();
    return;
  }
  let fade = 1;
  if (spark.age < 0.1) fade = spark.age / 0.1;
  else if (spark.age > CAR_HIT_SPARK_DURATION - CAR_HIT_SPARK_FADE) {
    fade = (CAR_HIT_SPARK_DURATION - spark.age) / CAR_HIT_SPARK_FADE;
  }
  fade = Math.max(0, Math.min(1, fade));
  if (fade < 0.02) {
    stopCarHitSparks();
    return;
  }
  if (dt > 0) {
    spark.nextFlash -= dt;
    spark.flickT -= dt;
    spark.topoT -= dt;
    if (spark.flashDur > 0) spark.flashT += dt;
    if (spark.nextFlash <= 0) {
      spark.flashPeak = 0.62 + Math.random() * 0.38;
      spark.flashDur = 0.045 + Math.random() * 0.07;
      spark.flashT = 0;
      spark.seed += 13 + ((Math.random() * 9) | 0);
      spark.nextFlash = spark.flashDur + 0.035 + Math.random() * 0.09;
    }
    if (spark.flashT >= spark.flashDur) {
      spark.flashDur = 0;
      spark.flash = 0;
    }
  }
  const env = _sparkFlashEnvelope(
    spark.flashDur > 0 ? spark.flashT / spark.flashDur : 1,
  );
  spark.flash = env * spark.flashPeak;
  const live = Math.min(1.7, fade * (0.84 + spark.flash * 0.5));
  if (live < 0.04) {
    _sparkClear(spark);
    return;
  }
  if (spark.flickT <= 0) {
    spark.flickT = 0.014 + Math.random() * 0.02;
    spark.flickSeed += 11 + ((Math.random() * 7) | 0);
  }
  const box = spark.localBox;
  const center = spark.localCenter;
  if (spark.topoT <= 0 || spark.leaders.length === 0) {
    spark.topoT = 0.065 + Math.random() * 0.07;
    const nLead = 5 + ((Math.random() * 3) | 0);
    if (!spark.leaders.length) {
      for (let i = 0; i < 8; i++) spark.leaders.push({ seed: 1, on: false });
    }
    for (let i = 0; i < 8; i++) {
      const L = spark.leaders[i];
      L.on = i < nLead;
      if (!L.on) continue;
      const s = spark.seed + i * 47;
      _carSparkPointOnBox(box, s, _carSparkA);
      _carSparkPointOnBox(box, s + 9, _carSparkB);
      _carSparkA.sub(center).multiplyScalar(CAR_SPARK_SURFACE_PUSH).add(center);
      _carSparkB.sub(center).multiplyScalar(CAR_SPARK_SURFACE_PUSH).add(center);
      L.ox = _carSparkA.x;
      L.oy = _carSparkA.y;
      L.oz = _carSparkA.z;
      L.dx = _carSparkB.x - _carSparkA.x;
      L.dy = _carSparkB.y - _carSparkA.y;
      L.dz = _carSparkB.z - _carSparkA.z;
      const len = Math.hypot(L.dx, L.dy, L.dz) || 1;
      const want = spark.radius * (0.5 + _sparkHash(s + 3) * 0.75);
      const sc = want / len;
      L.dx *= sc;
      L.dy *= sc;
      L.dz *= sc;
      L.seed = s;
    }
  } else {
    for (let i = 0; i < spark.leaders.length; i++) {
      const L = spark.leaders[i];
      if (!L.on) continue;
      const wob = (_sparkHash(spark.flickSeed + i) - 0.5) * spark.radius * 0.05;
      L.ox += L.dx * 0.035;
      L.oy += L.dy * 0.03;
      L.oz += L.dz * 0.035;
      L.dx += (_sparkHash(spark.flickSeed + i + 2) - 0.5) * wob;
      L.dz += (_sparkHash(spark.flickSeed + i + 5) - 0.5) * wob;
    }
  }
  const crackle = 0.7 + 0.3 * _sparkHash(spark.flickSeed);
  spark.boltMat.uniforms.uIntensity.value = live * CAR_SPARK_BRIGHTNESS;
  spark.boltMat.uniforms.uFlash.value = spark.flash * crackle * CAR_SPARK_BRIGHTNESS;
  spark.boltMat.uniforms.uWidth.value = spark.width * (0.9 + 0.28 * crackle);
  spark.boltMat.uniforms.uOpacity.value = Math.min(
    1,
    fade * (0.55 + live * 0.6 + spark.flash * 0.25),
  );
  spark.boltMat.uniforms.uGlow.value =
    fade * (0.55 + live * 0.5 + spark.flash * 0.4) * CAR_SPARK_GLOW;
  const worldScale = Math.max(0.02, car.scale.x);
  spark.light.intensity =
    fade *
    (live * 0.32 + spark.flash * 0.65) *
    crackle *
    (1.15 - lightBlend * 0.35) *
    CAR_SPARK_LIGHT;
  spark.light.distance = Math.max(0.45, spark.radius * worldScale * 16);
  // Same envelope / flicker as the arcs: feeds the shared room shock light.
  spark.roomDrive = fade * (live * 0.3 + spark.flash * 1.0) * crackle;
  spark.roomFlash = spark.flash * crackle;
  spark.quadCount = 0;
  // Arcs may not dip through the surface the car is on: the tablePlate while
  // the car is on it, the floor once it has gone over the edge (so the whole
  // effect falls with the car instead of being flattened at table height).
  const onTable =
    (carPhysState === CAR_PHYS.DRIVING || carPhysState === CAR_PHYS.IMPACT) &&
    !isCarOffTablePlate();
  const minY = (onTable ? tableSurfaceY : floorTopY) + 0.003;
  const maxGen = live > 0.72 ? 2 : 1;
  for (let i = 0; i < spark.leaders.length; i++) {
    const L = spark.leaders[i];
    if (!L.on) continue;
    _sparkEmitTree(
      spark,
      minY,
      L.ox,
      L.oy,
      L.oz,
      L.dx,
      L.dy,
      L.dz,
      L.seed + spark.flickSeed,
      live,
      0,
      maxGen,
    );
  }
  if (spark.quadCount <= 0) {
    _sparkClear(spark);
    return;
  }
  _carSparkFlush(spark);
}

function setupFreeCableAssembly(root) {
  _freeCable = null;
  const main = root.getObjectByName("freeCableMain");
  const headMeshes = FREE_CABLE_HEAD_NAMES.map((name) =>
    root.getObjectByName(name),
  ).filter((node) => node && node.isMesh);
  if (!main || !main.isMesh || !main.geometry || headMeshes.length < 6) return;

  const assembly = new THREE.Group();
  assembly.name = "freeCableAssembly";
  root.add(assembly);
  const head = new THREE.Group();
  head.name = "freeCableHead";
  assembly.add(head);
  for (const mesh of headMeshes) {
    head.attach(mesh);
    mesh.frustumCulled = false;
  }
  assembly.attach(main);
  main.frustumCulled = false;
  head.frustumCulled = false;
  assembly.updateMatrixWorld(true);

  const geo = main.geometry;
  const pos = geo.attributes.position;
  pos.usage = THREE.DynamicDrawUsage;
  const restPos = new Float32Array(pos.array.length);
  restPos.set(pos.array);

  const restLocalPts = _cableBuildCenterline(main);
  if (restLocalPts.length < 4) return;
  const restLocalCurve = new THREE.CatmullRomCurve3(restLocalPts, false, "catmullrom", 0.15);
  const restLocalSamples = [];
  const restWorldSamples = [];
  const animWorldSamples = [];
  const animLocalSamples = [];
  for (let i = 0; i < FREE_CABLE_SAMPLES; i++) {
    restLocalSamples.push(new THREE.Vector3());
    restWorldSamples.push(new THREE.Vector3());
    animWorldSamples.push(new THREE.Vector3());
    animLocalSamples.push(new THREE.Vector3());
  }
  _cableResample(restLocalCurve, restLocalSamples);
  const { total: restLength } = _cableSegmentLengths(restLocalSamples);
  if (restLength < 0.05) return;

  for (let i = 0; i < FREE_CABLE_SAMPLES; i++) {
    restWorldSamples[i].copy(restLocalSamples[i]);
    main.localToWorld(restWorldSamples[i]);
  }

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const vD = new THREE.Vector3();
  const vE = new THREE.Vector3();
  const vF = new THREE.Vector3();
  _freeCable = {
    vA,
    vB,
    vC,
    vD,
    vE,
    vF,
  };
  const restFrames = _cableMakeFrames();
  const animFrames = _cableMakeFrames();
  _cableBuildFrames(restLocalSamples, restFrames);

  const binds = new Float32Array(pos.count * 4);
  const { lengths, total } = _cableSegmentLengths(restLocalSamples);
  for (let i = 0; i < pos.count; i++) {
    const px = restPos[i * 3];
    const py = restPos[i * 3 + 1];
    const pz = restPos[i * 3 + 2];
    let bestD = Infinity;
    let bestT = 0;
    let acc = 0;
    for (let s = 0; s < restLocalSamples.length - 1; s++) {
      const a = restLocalSamples[s];
      const b = restLocalSamples[s + 1];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const abz = b.z - a.z;
      const abLenSq = lengths[s] * lengths[s];
      let u = 0;
      if (abLenSq > 1e-12) {
        u = ((px - a.x) * abx + (py - a.y) * aby + (pz - a.z) * abz) / abLenSq;
        if (u < 0) u = 0;
        else if (u > 1) u = 1;
      }
      const qx = a.x + abx * u;
      const qy = a.y + aby * u;
      const qz = a.z + abz * u;
      const dx = px - qx;
      const dy = py - qy;
      const dz = pz - qz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        bestT = total > 1e-8 ? (acc + u * lengths[s]) / total : 0;
      }
      acc += lengths[s];
    }
    _cableSampleFrame(restFrames, bestT, vA, vB, vC, vD);
    binds[i * 4] = bestT;
    binds[i * 4 + 1] = (px - vA.x) * vB.x + (py - vA.y) * vB.y + (pz - vA.z) * vB.z;
    binds[i * 4 + 2] = (px - vA.x) * vC.x + (py - vA.y) * vC.y + (pz - vA.z) * vC.z;
    binds[i * 4 + 3] = (px - vA.x) * vD.x + (py - vA.y) * vD.y + (pz - vA.z) * vD.z;
  }

  const restTipWorld = new THREE.Matrix4();
  const restHeadWorld = new THREE.Matrix4();
  const restTipInv = new THREE.Matrix4();
  vA.copy(restWorldSamples[FREE_CABLE_SAMPLES - 1]);
  vC.subVectors(
    restWorldSamples[FREE_CABLE_SAMPLES - 1],
    restWorldSamples[FREE_CABLE_SAMPLES - 2],
  ).normalize();
  vB.set(1, 0, 0);
  if (Math.abs(vC.dot(vB)) > 0.85) vB.set(0, 0, 1);
  vB.crossVectors(vC, vB).cross(vC).normalize();
  vD.crossVectors(vC, vB).normalize();
  restTipWorld.makeBasis(vB, vC, vD);
  restTipWorld.setPosition(vA);
  restTipInv.copy(restTipWorld).invert();
  head.updateMatrixWorld(true);
  restHeadWorld.copy(head.matrixWorld);

  const anchorWorld = restWorldSamples[0].clone();
  const restHeadPos = restWorldSamples[FREE_CABLE_SAMPLES - 1].clone();
  const drapeDir = new THREE.Vector3(
    anchorWorld.x - tablePlateCenter.x,
    0,
    anchorWorld.z - tablePlateCenter.z,
  );
  if (drapeDir.lengthSq() < 1e-6) drapeDir.set(0, 0, 1);
  else drapeDir.normalize();

  const restPath = [];
  const attackPath = [];
  for (let i = 0; i < FREE_CABLE_SAMPLES; i++) {
    restPath.push(new THREE.Vector3());
    attackPath.push(new THREE.Vector3());
  }

  const cableRadius = 0.008;
  const tableY = (Number.isFinite(tableSurfaceY) ? tableSurfaceY : anchorWorld.y) + cableRadius;
  const restLen = restLength;
  const p0 = anchorWorld.clone();
  const p1 = anchorWorld.clone().addScaledVector(drapeDir, restLen * 0.08);
  p1.y = THREE.MathUtils.lerp(anchorWorld.y, tableY, 0.55);
  const p2 = anchorWorld.clone().addScaledVector(drapeDir, restLen * 0.52);
  p2.y = tableY + 0.01;
  const p3 = anchorWorld.clone().addScaledVector(drapeDir, restLen * 0.9);
  p3.y = tableY + 0.006;
  const restCurve = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
  _cableResample(restCurve, restPath);
  restHeadPos.copy(restPath[FREE_CABLE_SAMPLES - 1]);
  head.updateMatrixWorld(true);
  _carSurfPt.set(0, 0, 0);
  let edgeN = 0;
  for (const name of ["freeCableEdge1", "freeCableEdge2", "freeCableEdge3"]) {
    const mesh = head.getObjectByName(name);
    if (!mesh) continue;
    mesh.getWorldPosition(_carSurfN);
    _carSurfPt.add(_carSurfN);
    edgeN += 1;
  }
  if (edgeN > 0) _carSurfPt.multiplyScalar(1 / edgeN);
  const meshTip = restWorldSamples[FREE_CABLE_SAMPLES - 1];
  const headReach =
    edgeN > 0 ? Math.max(0.008, meshTip.distanceTo(_carSurfPt)) : 0.028;
  const edgeLocal = new THREE.Vector3();
  if (edgeN > 0) {
    edgeLocal.copy(_carSurfPt).sub(meshTip);
    edgeLocal.set(
      edgeLocal.dot(vB),
      edgeLocal.dot(vC),
      edgeLocal.dot(vD),
    );
  } else {
    edgeLocal.set(0, headReach, 0);
  }

  const p4 = p3.clone();
  const snakePts = [p0, p1, p2, p3, p4];
  const segDirs = [];
  for (let i = 0; i < FREE_CABLE_SAMPLES; i++) {
    segDirs.push(new THREE.Vector3());
  }
  const matA = new THREE.Matrix4();
  const matB = new THREE.Matrix4();
  const quatA = new THREE.Quaternion();

  _freeCable = {
    ready: true,
    posed: false,
    assembly,
    head,
    main,
    restPos,
    binds,
    restFrames,
    animFrames,
    restLocalSamples,
    restWorldSamples,
    animWorldSamples,
    animLocalSamples,
    restPath,
    attackPath,
    restTipInv,
    restHeadWorld,
    restHeadPos,
    anchorWorld,
    drapeDir,
    aimDir: drapeDir.clone(),
    smoothTip: restHeadPos.clone(),
    carAim: new THREE.Vector3(),
    restLength: restLen,
    headReach,
    edgeLocal,
    contactLocal: new THREE.Vector3(),
    contactHeld: false,
    strike: null,
    tableY,
    attack: 0,
    lunge: 0,
    phase: "rest",
    phaseT: 0,
    restCurve,
    snakePts,
    snakeCurve: new THREE.CatmullRomCurve3(snakePts, false, "centripetal", 0.25),
    p0,
    p1,
    p2,
    p3,
    p4,
    segDirs,
    matA,
    matB,
    quatA,
    vA,
    vB,
    vC,
    vD,
    vE,
    vF,
  };
  setupFreeCableSparks(_freeCable);
  _cableRollStrike(_freeCable);
  updateFreeCableAssembly(0);
}

function updateFreeCableAssembly(dt) {
  const cable = _freeCable;
  if (!cable || !cable.ready) return;
  const time = clock.elapsedTime;
  if (_carReady) {
    const holdContact =
      cable.phase === "lunge" || cable.phase === "hold";
    if (holdContact && cable.contactHeld && carPhysBody) {
      _physQuat.set(
        carPhysBody.quaternion.x,
        carPhysBody.quaternion.y,
        carPhysBody.quaternion.z,
        carPhysBody.quaternion.w,
      );
      cable.carAim
        .copy(cable.contactLocal)
        .applyQuaternion(_physQuat)
        .add(carPhysBody.position);
    } else {
      closestPointOnCarObb(cable.smoothTip, cable.carAim);
      if (holdContact && carPhysBody) {
        _physQuat.set(
          carPhysBody.quaternion.x,
          carPhysBody.quaternion.y,
          carPhysBody.quaternion.z,
          carPhysBody.quaternion.w,
        );
        _physQuatInv.copy(_physQuat).invert();
        cable.contactLocal
          .copy(cable.carAim)
          .sub(carPhysBody.position)
          .applyQuaternion(_physQuatInv);
        cable.contactHeld = true;
      } else {
        cable.contactHeld = false;
      }
    }
  } else {
    cable.contactHeld = false;
    cable.carAim.copy(cable.restHeadPos);
    cable.carAim.y = cable.tableY + 0.08;
  }
  const distAnchor = Math.hypot(
    cable.carAim.x - cable.anchorWorld.x,
    cable.carAim.z - cable.anchorWorld.z,
  );
  const distTip = Math.hypot(
    cable.carAim.x - cable.smoothTip.x,
    cable.carAim.z - cable.smoothTip.z,
  );
  const dist = _carReady
    ? Math.min(distAnchor, distTip)
    : FREE_CABLE_ATTACK_OUTER + 1;
  const target = _cableSmoothstep(
    FREE_CABLE_ATTACK_OUTER,
    FREE_CABLE_ATTACK_INNER,
    dist,
  );
  const st = cable.strike || {};
  const followMul = st.followMul || 1;
  const follow = (target > cable.attack ? 2.8 : 1.7) * followMul;
  const blend = dt <= 0 ? 1 : 1 - Math.exp(-dt * follow);
  cable.attack += (target - cable.attack) * blend;
  const alert = cable.attack;

  cable.vA.set(
    cable.carAim.x - cable.anchorWorld.x,
    0,
    cable.carAim.z - cable.anchorWorld.z,
  );
  if (cable.vA.lengthSq() < 1e-8) cable.vA.copy(cable.drapeDir);
  const whipFade = 1 - _cableClamp01(cable.lunge);
  const whipYaw = (st.whipYaw || 0) * whipFade * alert;
  if (Math.abs(whipYaw) > 1e-4) {
    const wcs = Math.cos(whipYaw);
    const wsn = Math.sin(whipYaw);
    const wx = cable.vA.x * wcs - cable.vA.z * wsn;
    const wz = cable.vA.x * wsn + cable.vA.z * wcs;
    cable.vA.set(wx, 0, wz);
  }
  const turnMul = st.turnMul || 1;
  const turnRate = (cable.phase === "lunge" ? 4.2 : 7.8) * turnMul;
  if (dt > 0 && _carReady && alert > 0.12) {
    _cableRotateDir(cable.aimDir, cable.vA, dt * turnRate);
  }
  const dir = cable.aimDir;
  const side = cable.vB.set(-dir.z, 0, dir.x);

  const coilWait = st.coilWait || 0.52;
  const lungeDur = st.lungeDur || 0.14;
  const holdDur = st.holdDur || 0.14;
  const retractDur = st.retractDur || 0.4;
  const midRetract = st.midRetract || 0.38;

  if (alert < 0.18) {
    cable.phase = "rest";
    cable.phaseT = 0;
    cable.lunge += (0 - cable.lunge) * (dt <= 0 ? 1 : 1 - Math.exp(-dt * 4));
  } else if (alert < 0.48) {
    if (cable.phase === "lunge" || cable.phase === "hold") {
      cable.phase = "retract";
      cable.phaseT = 0;
    } else if (cable.phase === "rest") {
      cable.phase = "coil";
      cable.phaseT = 0;
      _cableRollStrike(cable);
    }
    cable.phaseT += Math.max(0, dt);
    if (cable.phase === "retract") {
      cable.lunge = 1 - _cableEaseInOut(cable.phaseT / Math.max(0.12, midRetract));
      if (cable.phaseT >= midRetract) {
        cable.phase = "coil";
        cable.phaseT = 0;
        cable.lunge = 0;
        _cableRollStrike(cable);
      }
    } else {
      cable.lunge += (0 - cable.lunge) * (dt <= 0 ? 1 : 1 - Math.exp(-dt * 4));
    }
  } else {
    if (cable.phase === "rest") {
      cable.phase = "coil";
      cable.phaseT = 0;
      _cableRollStrike(cable);
    }
    cable.phaseT += Math.max(0, dt);
    if (cable.phase === "coil") {
      cable.lunge += (0 - cable.lunge) * (dt <= 0 ? 1 : 1 - Math.exp(-dt * 5));
      if (cable.phaseT > coilWait && alert > 0.58) {
        cable.phase = "lunge";
        cable.phaseT = 0;
      }
    } else if (cable.phase === "lunge") {
      cable.lunge = _cableEaseOutCubic(cable.phaseT / Math.max(0.08, lungeDur));
      if (cable.phaseT >= lungeDur) {
        cable.phase = "hold";
        cable.phaseT = 0;
        cable.lunge = 1;
      }
    } else if (cable.phase === "hold") {
      cable.lunge = 1;
      if (cable.phaseT > holdDur) {
        cable.phase = "retract";
        cable.phaseT = 0;
      }
    } else if (cable.phase === "retract") {
      cable.lunge = 1 - _cableEaseInOut(cable.phaseT / Math.max(0.16, retractDur));
      if (cable.phaseT >= retractDur) {
        cable.phase = "coil";
        cable.phaseT = 0;
        cable.lunge = 0;
        _cableRollStrike(cable);
      }
    }
  }
  const lunge = _cableClamp01(cable.lunge);
  if (_carReady && carPhysBody && lunge > 0.45) {
    if (!cable.contactHeld) {
      closestPointOnCarObb(cable.smoothTip, cable.carAim);
      _physQuat.set(
        carPhysBody.quaternion.x,
        carPhysBody.quaternion.y,
        carPhysBody.quaternion.z,
        carPhysBody.quaternion.w,
      );
      _physQuatInv.copy(_physQuat).invert();
      cable.contactLocal
        .copy(cable.carAim)
        .sub(carPhysBody.position)
        .applyQuaternion(_physQuatInv);
      cable.contactHeld = true;
    } else {
      _physQuat.set(
        carPhysBody.quaternion.x,
        carPhysBody.quaternion.y,
        carPhysBody.quaternion.z,
        carPhysBody.quaternion.w,
      );
      cable.carAim
        .copy(cable.contactLocal)
        .applyQuaternion(_physQuat)
        .add(carPhysBody.position);
    }
  } else if (lunge < 0.2) {
    cable.contactHeld = false;
  }

  const poseDist = cable.restLength * (0.9 - 0.5 * alert) * (st.poseMul || 1);
  cable.vC.copy(cable.anchorWorld).addScaledVector(dir, poseDist);
  cable.vC.y = cable.tableY + 0.3 * alert * (st.riseMul || 1);
  cable.vD.copy(cable.carAim).sub(cable.smoothTip);
  if (cable.vD.lengthSq() < 1e-10) {
    cable.vD.copy(cable.carAim).sub(cable.anchorWorld);
  }
  if (cable.vD.lengthSq() < 1e-10) cable.vD.set(dir.x, 0.08, dir.z);
  else cable.vD.normalize();
  const edgeLen = Math.max(0.008, cable.headReach || 0.028);
  cable.vF.copy(cable.carAim).addScaledVector(cable.vD, -edgeLen);
  if (cable.vF.y < cable.tableY) cable.vF.y = cable.tableY;
  const strikeSpan = cable.vF.distanceTo(cable.anchorWorld);
  if (strikeSpan > cable.restLength * 0.98) {
    cable.vD.copy(cable.vF).sub(cable.anchorWorld);
    if (cable.vD.lengthSq() > 1e-10) {
      cable.vD.normalize();
      cable.vF
        .copy(cable.anchorWorld)
        .addScaledVector(cable.vD, cable.restLength * 0.98);
    }
  }
  cable.vE.copy(cable.vC).lerp(cable.vF, lunge);

  const tipRate =
    ((alert < 0.2 ? 1.15 : 3.6) + alert * 2.6 + lunge * 12) *
    (st.tipRateMul || 1);
  const tipBlend = dt <= 0 ? 1 : 1 - Math.exp(-dt * tipRate);
  _cableOrbitToward(cable.smoothTip, cable.vE, cable.anchorWorld, tipBlend);
  if (lunge > 0.88) cable.smoothTip.copy(cable.vE);
  if (cable.smoothTip.y < cable.tableY) cable.smoothTip.y = cable.tableY;

  const tip = cable.smoothTip;
  const chord = Math.hypot(
    tip.x - cable.anchorWorld.x,
    tip.z - cable.anchorWorld.z,
  );
  cable.vA.set(
    tip.x - cable.anchorWorld.x,
    0,
    tip.z - cable.anchorWorld.z,
  );
  if (cable.vA.lengthSq() > 1e-8) cable.vA.normalize();
  else cable.vA.copy(dir);
  const bodyDir = cable.vA;
  const bodySide = cable.vB.set(-bodyDir.z, 0, bodyDir.x);
  const slack = Math.max(0, cable.restLength - Math.max(0.05, chord));
  const archMul = st.archMul || 1;
  const hood = (st.hoodBase || 0.04) + 0.26 * archMul * alert * (1 - lunge * 0.6);
  const arch = hood + slack * 0.35 * alert * archMul;
  const slither =
    Math.sin(time * (st.slitherHz || 1.45) + (st.slitherPhase || 0)) *
    (st.slitherAmp || 0.016) *
    alert *
    (1 - lunge * 0.8);
  const breath = Math.sin(time * 0.95) * 0.004 * (1 - alert);
  const coilLean =
    (st.sideSign || 1) *
    (st.sideAmp || 0) *
    alert *
    (1 - lunge * 0.75);

  cable.p0.copy(cable.anchorWorld);
  cable.p1
    .copy(cable.anchorWorld)
    .addScaledVector(bodyDir, chord * 0.2 + cable.restLength * 0.04)
    .addScaledVector(bodySide, slither * 0.25 + coilLean * 0.45);
  cable.p1.y =
    THREE.MathUtils.lerp(cable.anchorWorld.y, cable.tableY, 0.45) +
    arch * 0.35 +
    alert * 0.06;
  cable.p2
    .copy(cable.anchorWorld)
    .addScaledVector(bodyDir, chord * 0.48)
    .addScaledVector(bodySide, slither + coilLean);
  cable.p2.y = cable.tableY + arch + breath + alert * 0.04;
  cable.p3
    .copy(cable.anchorWorld)
    .addScaledVector(bodyDir, chord * 0.76)
    .addScaledVector(bodySide, slither * 0.4 + coilLean * 0.25);
  cable.p3.y = THREE.MathUtils.lerp(
    cable.tableY + 0.01,
    tip.y + arch * 0.15,
    alert,
  );
  cable.p4.copy(tip);

  const targetPts = cable.attackPath;
  cable.snakeCurve.needsUpdate = true;
  _cableResample(cable.snakeCurve, targetPts);
  for (let i = 1; i < FREE_CABLE_SAMPLES - 1; i++) {
    const t = i / (FREE_CABLE_SAMPLES - 1);
    const env = Math.sin(Math.PI * t);
    const amp = (st.waveAmp || 0.011) * alert * (1 - lunge * 0.82) * env;
    const wave = Math.sin(
      Math.PI * 2 * (t * (st.waveHz || 0.8) - time * 0.48) +
        (st.slitherPhase || 0),
    );
    targetPts[i].addScaledVector(side, wave * amp);
    if (targetPts[i].y < cable.tableY) targetPts[i].y = cable.tableY;
  }
  targetPts[0].copy(cable.anchorWorld);
  targetPts[FREE_CABLE_SAMPLES - 1].copy(tip);
  _cableRespace(targetPts, cable.restLength);
  targetPts[0].copy(cable.anchorWorld);
  targetPts[FREE_CABLE_SAMPLES - 1].copy(tip);
  _cableFairTip(targetPts, cable.tableY);
  targetPts[0].copy(cable.anchorWorld);
  targetPts[FREE_CABLE_SAMPLES - 1].copy(tip);

  const pts = cable.animWorldSamples;
  if (!cable.posed || dt <= 0) {
    for (let i = 0; i < FREE_CABLE_SAMPLES; i++) pts[i].copy(targetPts[i]);
    cable.posed = true;
  } else {
    for (let i = 1; i < FREE_CABLE_SAMPLES; i++) {
      const t = i / (FREE_CABLE_SAMPLES - 1);
      const rate =
        ((alert < 0.2 ? 1.45 : 3.4) + t * (alert < 0.2 ? 2.8 : 8.2) + lunge * 8) *
        (st.followMul || 1);
      _cableOrbitToward(
        pts[i],
        targetPts[i],
        cable.anchorWorld,
        1 - Math.exp(-dt * rate),
      );
    }
  }
  pts[0].copy(cable.anchorWorld);
  if (lunge > 0.55) pts[FREE_CABLE_SAMPLES - 1].copy(tip);
  for (let i = 1; i < FREE_CABLE_SAMPLES; i++) {
    if (pts[i].y < cable.tableY) pts[i].y = cable.tableY;
  }
  _cableFairTip(pts, cable.tableY);
  pts[0].copy(cable.anchorWorld);

  const liveTip = pts[FREE_CABLE_SAMPLES - 1];

  const main = cable.main;
  main.updateMatrixWorld(true);
  for (let i = 0; i < FREE_CABLE_SAMPLES; i++) {
    cable.animLocalSamples[i].copy(pts[i]);
    main.worldToLocal(cable.animLocalSamples[i]);
  }
  _cableBuildFrames(cable.animLocalSamples, cable.animFrames);

  const pos = main.geometry.attributes.position;
  const arr = pos.array;
  const binds = cable.binds;
  for (let i = 0; i < pos.count; i++) {
    const t = binds[i * 4];
    const ox = binds[i * 4 + 1];
    const oy = binds[i * 4 + 2];
    const oz = binds[i * 4 + 3];
    _cableSampleFrame(
      cable.animFrames,
      t,
      cable.vA,
      cable.vB,
      cable.vC,
      cable.vD,
    );
    if (t > 0.76) {
      _cableSampleFrame(
        cable.animFrames,
        1,
        _cableTipO,
        _cableTipN,
        _cableTipT,
        _cableTipB,
      );
      const k = _cableSmoothstep(0.76, 0.93, t);
      cable.vC.lerp(_cableTipT, k);
      if (cable.vC.lengthSq() < 1e-10) cable.vC.set(0, 1, 0);
      else cable.vC.normalize();
      cable.vB.lerp(_cableTipN, k);
      cable.vB.addScaledVector(cable.vC, -cable.vB.dot(cable.vC));
      if (cable.vB.lengthSq() < 1e-10) {
        cable.vB.set(1, 0, 0);
        if (Math.abs(cable.vC.dot(cable.vB)) > 0.85) cable.vB.set(0, 0, 1);
        cable.vB.crossVectors(cable.vC, cable.vB).cross(cable.vC);
      }
      cable.vB.normalize();
      cable.vD.crossVectors(cable.vC, cable.vB).normalize();
    }
    arr[i * 3] = cable.vA.x + cable.vB.x * ox + cable.vC.x * oy + cable.vD.x * oz;
    arr[i * 3 + 1] = cable.vA.y + cable.vB.y * ox + cable.vC.y * oy + cable.vD.y * oz;
    arr[i * 3 + 2] = cable.vA.z + cable.vB.z * ox + cable.vC.z * oy + cable.vD.z * oz;
  }
  pos.needsUpdate = true;
  main.geometry.computeVertexNormals();
  main.geometry.computeBoundingBox();
  main.geometry.computeBoundingSphere();

  poseCableHead(cable, liveTip, pts, alert);
  if (lunge > 0.75 && _carReady) {
    getCableTipWorld(_carSurfN);
    _carSurfPt.copy(cable.carAim).sub(_carSurfN);
    const snapLen = _carSurfPt.length();
    if (snapLen > 5e-4 && snapLen < 0.045) {
      liveTip.add(_carSurfPt);
      pts[FREE_CABLE_SAMPLES - 1].copy(liveTip);
      cable.smoothTip.copy(liveTip);
      poseCableHead(cable, liveTip, pts, alert);
    }
  }
  if (dt > 0) updateCableCarImpactAll(dt);
  updateFreeCableSparks(cable, dt, alert);
}

function poseCableHead(cable, liveTip, pts, alert) {
  cable.vC.subVectors(liveTip, pts[FREE_CABLE_SAMPLES - 4]);
  if (cable.vC.lengthSq() < 1e-10) {
    cable.vC.subVectors(liveTip, pts[FREE_CABLE_SAMPLES - 2]);
  }
  if (cable.vC.lengthSq() < 1e-10) cable.vC.set(0, 1, 0);
  else cable.vC.normalize();
  cable.vF.copy(cable.carAim).sub(liveTip);
  if (cable.vF.lengthSq() > 1e-8) {
    cable.vF.normalize();
    const aimK =
      0.16 * _cableClamp01(alert) + 0.78 * _cableClamp01(cable.lunge);
    cable.vC.lerp(cable.vF, aimK).normalize();
  }
  cable.vB.set(1, 0, 0);
  if (Math.abs(cable.vC.dot(cable.vB)) > 0.85) cable.vB.set(0, 0, 1);
  cable.vB.crossVectors(cable.vC, cable.vB).cross(cable.vC).normalize();
  cable.vD.crossVectors(cable.vC, cable.vB).normalize();
  cable.matA.makeBasis(cable.vB, cable.vC, cable.vD);
  cable.matA.setPosition(liveTip);
  cable.matB.copy(cable.assembly.matrixWorld).invert();
  cable.head.matrix
    .copy(cable.matB)
    .multiply(cable.matA)
    .multiply(cable.restTipInv)
    .multiply(cable.restHeadWorld);
  cable.head.matrixAutoUpdate = false;
  cable.head.updateMatrixWorld(true);
}

function repeatWallPatternAlongX(root, patternName, wallName) {
  const mesh = root.getObjectByName(patternName);
  const wall = root.getObjectByName(wallName);
  if (!mesh || !mesh.isMesh || !wall) return;
  root.updateWorldMatrix(true, true);
  const itemBox = new THREE.Box3().setFromObject(mesh);
  const wallBox = new THREE.Box3().setFromObject(wall);
  if (itemBox.isEmpty() || wallBox.isEmpty()) return;
  const itemWidth = Math.max(itemBox.max.x - itemBox.min.x, 0.01);
  const gap = Math.max(itemWidth * 0.4, 0.016);
  const step = itemWidth + gap;
  const minX = wallBox.min.x + itemWidth * 0.25;
  const parent = mesh.parent || root;
  const origin = mesh.position.clone();
  let index = 1;
  for (let worldMinX = itemBox.min.x - step; worldMinX >= minX; worldMinX -= step) {
    const clone = mesh.clone();
    clone.name = `${patternName}_${index}`;
    clone.position.copy(origin);
    clone.position.x += worldMinX - itemBox.min.x;
    parent.add(clone);
    index += 1;
  }
}

function repeatWallPatternAlongZ(root, patternName, wallName) {
  const mesh = root.getObjectByName(patternName);
  const wall = root.getObjectByName(wallName);
  if (!mesh || !mesh.isMesh || !wall) return;
  root.updateWorldMatrix(true, true);
  const itemBox = new THREE.Box3().setFromObject(mesh);
  const wallBox = new THREE.Box3().setFromObject(wall);
  if (itemBox.isEmpty() || wallBox.isEmpty()) return;
  const itemWidth = Math.max(itemBox.max.z - itemBox.min.z, 0.01);
  const gap = Math.max(itemWidth * 0.4, 0.016);
  const step = itemWidth + gap;
  const maxZ = wallBox.max.z - itemWidth * 0.25;
  const parent = mesh.parent || root;
  const origin = mesh.position.clone();
  let index = 1;
  for (let worldMinZ = itemBox.min.z + step; worldMinZ <= maxZ; worldMinZ += step) {
    const clone = mesh.clone();
    clone.name = `${patternName}_${index}`;
    clone.position.copy(origin);
    clone.position.z += worldMinZ - itemBox.min.z;
    parent.add(clone);
    index += 1;
  }
}

/**
 * The wall pattern repeats above create ~670 cloned meshes that share one
 * geometry and material (one draw call each, in the main view and again in the
 * table reflection). Collapse each geometry+material group into a single
 * InstancedMesh holding every clone's exact transform: same pixels, ~4 draws.
 */
const WALL_PATTERN_NAME = /^(wallLeftPattern|wallRightPattern|wallFrontPattern)(_z)?(_\d+)?$/;

function instanceRepeatedWallPatterns(root) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !WALL_PATTERN_NAME.test(o.name || "")) return;
    if (Array.isArray(o.material)) return;
    const key = o.geometry.uuid + "|" + o.material.uuid;
    let g = groups.get(key);
    if (!g) {
      g = [];
      groups.set(key, g);
    }
    g.push(o);
  });
  const rootInv = root.matrixWorld.clone().invert();
  const m = new THREE.Matrix4();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const first = list[0];
    const inst = new THREE.InstancedMesh(first.geometry, first.material, list.length);
    inst.name = first.name.replace(/(_z)?(_\d+)?$/, "") + "Instances";
    inst.castShadow = first.castShadow;
    inst.receiveShadow = first.receiveShadow;
    inst.renderOrder = first.renderOrder;
    for (let i = 0; i < list.length; i++) {
      m.multiplyMatrices(rootInv, list[i].matrixWorld);
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingBox();
    inst.computeBoundingSphere();
    root.add(inst);
    for (const o of list) o.removeFromParent();
  }
}

function repeatWallLeftPatternAlongNegZ(root) {
  const mesh = root.getObjectByName("wallLeftPattern");
  const wall = root.getObjectByName("wallBack");
  if (!mesh || !mesh.isMesh || !wall) return;
  root.updateWorldMatrix(true, true);
  const srcBox = new THREE.Box3().setFromObject(mesh);
  const wallBox = new THREE.Box3().setFromObject(wall);
  if (srcBox.isEmpty() || wallBox.isEmpty()) return;

  const parent = mesh.parent || root;
  const yaw = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    -Math.PI / 2,
  );
  const sample = mesh.clone();
  sample.name = "wallLeftPattern_z_1";
  sample.quaternion.premultiply(yaw);
  parent.add(sample);
  sample.updateWorldMatrix(true, true);
  const rotatedBox = new THREE.Box3().setFromObject(sample);
  if (rotatedBox.isEmpty()) {
    parent.remove(sample);
    return;
  }

  const itemWidth = Math.max(rotatedBox.max.z - rotatedBox.min.z, 0.01);
  const gap = Math.max(itemWidth * 0.4, 0.016);
  const step = itemWidth + gap;
  const minZ = wallBox.min.z + itemWidth * 0.25;
  const xShift =
    wallBox.getCenter(new THREE.Vector3()).x -
    rotatedBox.getCenter(new THREE.Vector3()).x;
  const firstMaxZ = srcBox.min.z;
  sample.position.x += xShift;
  sample.position.z += firstMaxZ - rotatedBox.max.z;

  const basePos = sample.position.clone();
  const baseQuat = sample.quaternion.clone();
  let index = 2;
  for (
    let dist = step;
    firstMaxZ - itemWidth - dist >= minZ;
    dist += step
  ) {
    const clone = mesh.clone();
    clone.name = `wallLeftPattern_z_${index}`;
    clone.quaternion.copy(baseQuat);
    clone.position.copy(basePos);
    clone.position.z -= dist;
    parent.add(clone);
    index += 1;
  }
}

function captureRoomReflections(root) {
  const table = root.getObjectByName("tablePlate");
  const pos = new THREE.Vector3(0, 1.7, 0);
  if (table) {
    table.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(table);
    if (!box.isEmpty()) {
      box.getCenter(pos);
      pos.y = box.max.y + 0.28;
    }
  }
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, {
    type: THREE.HalfFloatType,
  });
  const cubeCam = new THREE.CubeCamera(0.12, 40, cubeRT);
  cubeCam.position.copy(pos);
  if (tableReflector) tableReflector.visible = false;
  const sparkGroup = _freeCable && _freeCable.spark && _freeCable.spark.group;
  const carSparkGroup = _carHitSpark && _carHitSpark.group;
  const carSparkWas = carSparkGroup ? carSparkGroup.visible : false;
  if (sparkGroup) sparkGroup.visible = false;
  if (carSparkGroup) carSparkGroup.visible = false;
  const glowWas = _screenGlowMeshes.map((g) => g.visible);
  for (const g of _screenGlowMeshes) g.visible = false;
  cubeCam.update(renderer, scene);
  _screenGlowMeshes.forEach((g, i) => (g.visible = glowWas[i]));
  if (sparkGroup) sparkGroup.visible = true;
  if (carSparkGroup) carSparkGroup.visible = carSparkWas;
  if (tableReflector) tableReflector.visible = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const probe = pmrem.fromCubemap(cubeRT.texture).texture;
  pmrem.dispose();
  cubeRT.dispose();
  const applyProbe = (mat) => {
    if (!mat || (!mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial)) return;
    mat.envMap = probe;
    if (!(mat.envMapIntensity > 0)) mat.envMapIntensity = 0.18;
    mat.needsUpdate = true;
  };
  root.traverse((node) => {
    if (!node.isMesh) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of mats) applyProbe(mat);
  });
  for (const mat of _reflectiveMats) applyProbe(mat);
}

function applyMeetingRoomScreenMaterials(root, map) {
  const mat = new THREE.MeshStandardMaterial({
    map,
    emissiveMap: map,
    emissive: 0xffffff,
    emissiveIntensity: 4.4,
    roughness: 0.22,
    metalness: 0.08,
    toneMapped: false,
    side: THREE.DoubleSide,
    envMapIntensity: 0.55,
  });
  _reflectiveMats.push(mat);
  _themeMats.screen = mat;
  for (const name of ["screenLeft", "screenRight"]) {
    const mesh = root.getObjectByName(name);
    if (!mesh || !mesh.isMesh) continue;
    mesh.material = mat;
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    const uv = mesh.geometry.getAttribute("uv");
    if (!uv || uv.count < 4) continue;
    uv.setXY(0, 1, 0);
    uv.setXY(1, 0, 0);
    uv.setXY(2, 0, 1);
    uv.setXY(3, 1, 1);
    uv.needsUpdate = true;
  }
}

function applyMeetingRoomMaterials(root) {
  _reflectiveMats = [];
  const tablePlateColor =
    firstSourceColor(root, ["tablePlate"]) || new THREE.Color(0xcc5300);
  const yellowMetalColor =
    firstSourceColor(root, ["sofaLegs"]) || new THREE.Color(0xcc7200);
  const plantBaseColor =
    firstSourceColor(root, ["plantBase"]) || new THREE.Color(0x68cc7a);
  const wallCreamColor =
    firstSourceColor(root, ["wallLeft"]) || new THREE.Color(0xf1ead8);
  const greenCupColor =
    firstSourceColor(root, ["lordCupLeft"]) || new THREE.Color(0x149c22);
  const redCupColor =
    firstSourceColor(root, ["lordCupRight"]) || new THREE.Color(0xcc1a10);

  const creamWall = new THREE.MeshStandardMaterial({
    color: wallCreamColor,
    roughness: 0.94,
    metalness: 0,
    envMap: _meetingRoomEnv,
    envMapIntensity: 0.22,
  });
  const creamCeiling = new THREE.MeshStandardMaterial({
    color: wallCreamColor,
    roughness: 0.94,
    metalness: 0,
    envMap: _meetingRoomEnv,
    envMapIntensity: 0.14,
    side: THREE.DoubleSide,
    emissive: wallCreamColor.clone().multiplyScalar(0.16),
    emissiveIntensity: 0.18,
  });
  _themeMats.creamWall = creamWall;
  _themeMats.creamWallBright = wallCreamColor.clone();
  _themeMats.creamWallDark = new THREE.Color(0x060918);
  _themeMats.creamCeiling = creamCeiling;
  _themeMats.creamCeilingBright = wallCreamColor.clone();
  _themeMats.creamCeilingDark = new THREE.Color(0x060c1c);
  _themeMats.creamCeilingEmissiveBright = wallCreamColor.clone().multiplyScalar(0.16);
  _themeMats.creamCeilingEmissiveDark = new THREE.Color(0x1ad4ff);
  const whitePaintMetal = new THREE.MeshStandardMaterial({
    color: 0xf2f2ef,
    roughness: 0.7,
    metalness: 0.4,
    envMap: _meetingRoomEnv,
    envMapIntensity: 1.15,
  });
  const glossyWhiteBoard = new THREE.MeshPhysicalMaterial({
    color: 0xf7f7f4,
    roughness: 0.1,
    metalness: 0,
    clearcoat: 0.72,
    clearcoatRoughness: 0.08,
    envMap: _meetingRoomEnv,
    envMapIntensity: 1.45,
  });
  _themeMats.glossyBoard = glossyWhiteBoard;
  _themeMats.glossyBoardBright = new THREE.Color(0xf7f7f4);
  _themeMats.glossyBoardDark = new THREE.Color(0x0a1228);
  _themeMats.whitePaintMetal = whitePaintMetal;
  _themeMats.whitePaintMetalBright = new THREE.Color(0xf2f2ef);
  _themeMats.whitePaintMetalDark = new THREE.Color(0x1a2438);
  const blackMattPlastic = new THREE.MeshStandardMaterial({
    color: 0x0a0a0a,
    roughness: 0.55,
    metalness: 0.18,
    envMapIntensity: 0.7,
  });
  const tableBaseBlack = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.94,
    metalness: 0,
    envMap: _meetingRoomEnv,
    envMapIntensity: 0.12,
    side: THREE.DoubleSide,
  });
  const yellowMetalPaint = new THREE.MeshStandardMaterial({
    color: yellowMetalColor,
    roughness: 0.38,
    metalness: 0.68,
    envMap: _meetingRoomEnv,
    envMapIntensity: 1.45,
  });
  const whiteMattPlastic = new THREE.MeshStandardMaterial({
    color: 0xf3f3f3,
    roughness: 0.88,
    metalness: 0,
    envMap: _meetingRoomEnv,
    envMapIntensity: 0.28,
  });
  _themeMats.whiteMattPlastic = whiteMattPlastic;
  _themeMats.whiteMattPlasticBright = new THREE.Color(0xf3f3f3);
  _themeMats.whiteMattPlasticDark = new THREE.Color(0x1a2233);
  const whiteVisibleLight = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(1.8, 1.8, 1.72),
    emissiveIntensity: 3.3,
    roughness: 0.18,
    metalness: 0.12,
    toneMapped: false,
    side: THREE.DoubleSide,
    envMapIntensity: 0.7,
  });
  _themeMats.whiteVisibleLight = whiteVisibleLight;
  _themeMats.whiteLightEmissiveBright = new THREE.Color(1.8, 1.8, 1.72);
  _themeMats.whiteLightEmissiveDark = new THREE.Color(0x66e8ff);
  const yellowMattPaint = new THREE.MeshPhysicalMaterial({
    color: tablePlateColor,
    roughness: 1,
    metalness: 0,
    specularIntensity: 0,
    specularColor: 0x000000,
    clearcoat: 0,
    sheen: 0,
    envMap: _meetingRoomEnv,
    envMapIntensity: 0.16,
  });
  const chromeMetal = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.1,
    metalness: 1,
    envMap: _meetingRoomEnv,
    envMapIntensity: 2.4,
  });
  const darkGreyNet = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    roughness: 0.82,
    metalness: 0.08,
    envMapIntensity: 0.3,
  });
  const brightGreyNet = new THREE.MeshStandardMaterial({
    color: 0xa8aeb4,
    roughness: 0.8,
    metalness: 0.06,
    envMapIntensity: 0.28,
  });
  _themeMats.chairNet = brightGreyNet;
  _themeMats.chairNetBright = new THREE.Color(0xa8aeb4);
  const greyPlastic = new THREE.MeshStandardMaterial({
    color: 0x6e6e6e,
    roughness: 0.86,
    metalness: 0,
    envMapIntensity: 0.2,
  });
  const blackGlass = new THREE.MeshPhysicalMaterial({
    color: 0x050508,
    roughness: 0.06,
    metalness: 0.12,
    transparent: true,
    opacity: 0.62,
    envMap: _meetingRoomEnv,
    envMapIntensity: 1.55,
  });
  const blackPlastic = new THREE.MeshStandardMaterial({
    color: 0x0b0b0b,
    roughness: 0.88,
    metalness: 0,
    envMapIntensity: 0.16,
  });
  const greenLight = new THREE.MeshBasicMaterial({
    color: 0x2dff55,
    toneMapped: false,
  });
  const tabletSideLightMat = new THREE.MeshStandardMaterial({
    color: 0x2dff55,
    emissive: new THREE.Color(0x2dff55),
    emissiveIntensity: 22,
    roughness: 0.18,
    metalness: 0,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  _themeMats.tabletSideLight = tabletSideLightMat;
  const whiteMattPaint = new THREE.MeshStandardMaterial({
    color: 0xf8e2b8,
    roughness: 0.9,
    metalness: 0,
    envMap: _meetingRoomEnv,
    envMapIntensity: 0.2,
    emissive: 0xf3d19c,
    emissiveIntensity: 0.2,
  });
  _themeMats.whiteMattPaint = whiteMattPaint;
  _themeMats.whiteMattBright = new THREE.Color(0xf8e2b8);
  _themeMats.whiteMattDark = new THREE.Color(0x0e1a2e);
  _themeMats.whiteMattEmissiveBright = new THREE.Color(0xf3d19c);
  _themeMats.whiteMattEmissiveDark = new THREE.Color(0x4ae0ff);
  const frostedGlass = new THREE.MeshPhysicalMaterial({
    color: 0xdde4ea,
    roughness: 0.64,
    metalness: 0,
    transparent: true,
    opacity: 0.4,
    envMap: _meetingRoomEnv,
    envMapIntensity: 0.95,
    side: THREE.DoubleSide,
  });
  const whiteLight = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
  });
  const greyPaint = new THREE.MeshStandardMaterial({
    color: 0x6a6a6a,
    roughness: 0.86,
    metalness: 0.08,
    envMapIntensity: 0.28,
  });
  const blackCable = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.96,
    metalness: 0,
    envMapIntensity: 0.1,
  });
  _fireSensorLightMat = new THREE.MeshBasicMaterial({
    color: 0x2dff55,
    toneMapped: false,
  });
  const cableMetal = new THREE.MeshStandardMaterial({
    color: 0xc5c8cc,
    roughness: 0.28,
    metalness: 1,
    envMap: _meetingRoomEnv,
    envMapIntensity: 1.25,
  });
  const darkGrey = new THREE.MeshStandardMaterial({
    color: 0x2c2c2c,
    roughness: 0.72,
    metalness: 0,
    envMapIntensity: 0.2,
  });
  const greenPlastic = new THREE.MeshStandardMaterial({
    color: greenCupColor,
    roughness: 0.72,
    metalness: 0,
    envMapIntensity: 0.22,
  });
  const redPlastic = new THREE.MeshStandardMaterial({
    color: redCupColor,
    roughness: 0.72,
    metalness: 0,
    envMapIntensity: 0.22,
  });
  const greyRubber = new THREE.MeshStandardMaterial({
    color: 0x3d3d3d,
    roughness: 0.96,
    metalness: 0,
    envMapIntensity: 0.08,
  });
  const greySoftLight = new THREE.MeshBasicMaterial({
    color: 0xa8aeb4,
    toneMapped: false,
  });
  const plantBasePlastic = new THREE.MeshStandardMaterial({
    color: plantBaseColor,
    roughness: 0.9,
    metalness: 0,
    envMapIntensity: 0.16,
  });

  assignMaterial(root, [
    "wallFront",
    "wallLeft",
    "wallRight",
    "concreteColumnTzokel",
    "wallRight.001",
  ], creamWall);
  assignMaterial(root, ["wallBack"], tableBaseBlack);
  assignMaterial(root, ["sealing"], creamCeiling);
  assignMaterial(root, [
    "windowFrameSmall",
    "windowFrameSmall.001",
    "windowFrame",
    "doorFrame",
    "sealingFrames",
    "doorHandle",
  ], whitePaintMetal);
  assignMaterial(root, ["boardRight", "boardFront", "boardLeft"], glossyWhiteBoard);
  assignMaterial(root, [
    "screenFrameLeft",
    "screenFrameRight",
    "electricityDockLeft",
    "electricityDockRight",
    "tableMicBody",
    "tabletBody",
    "sofaLegsTips",
    "chairWheels",
  ], blackMattPlastic);
  assignMaterial(root, ["sofaLegs", "mainLightsFrame"], yellowMetalPaint);
  assignMaterial(root, [
    "router",
    "fireSensor",
    "lordBodyLeft",
    "lordBodyRight",
    "acRemoteBodyLeft",
    "lightController",
    "chairFrame",
    "boardToolsCase",
    "boardCleanerPleastic",
    "speakerFrame",
  ], whiteMattPlastic);
  assignMaterial(root, ["mainLightLeft", "mainLightRight"], whiteVisibleLight, true);
  assignMaterial(root, ["tableBaseBox"], tableBaseBlack);
  assignMaterial(root, ["tablePlate"], yellowMattPaint);
  assignMaterial(root, ["chairAxis"], chromeMetal);
  assignMaterial(root, ["tableMicNets", "speakerNet"], darkGreyNet);
  assignMaterial(root, ["cameraBody"], greyPlastic);
  assignMaterial(root, ["cameraGlass"], blackGlass, true);
  assignMaterial(root, ["cameraLansBig"], blackPlastic);
  assignMaterial(root, ["cameraLansSmall"], greenLight, true);
  assignMaterial(root, ["tabletsideLight"], tabletSideLightMat, true);
  assignMaterial(root, [
    "wallLeftPattern",
    "wallRightPattern",
    "wallFrontPattern",
    "pannelStrips",
    "tzokel",
  ], whiteMattPaint);
  assignMaterial(root, ["chairSeat"], brightGreyNet);
  assignMaterial(root, ["doorGlass", "wndowGlass"], frostedGlass, true);
  assignMaterial(root, ["tabletPowerLight"], whiteLight, true);
  assignMaterial(root, ["tabletLegs"], greyPaint);
  assignMaterial(root, ["tabletCable", "micCable", "freeCableMain"], blackCable);
  assignMaterial(root, ["fireSensoeLight"], _fireSensorLightMat, true);
  assignMaterial(root, [
    "freeCableEdge1",
    "freeCableEdge2",
    "freeCableEdge3",
  ], cableMetal);
  assignMaterial(root, ["boardCleaner"], darkGrey);
  assignMaterial(root, ["lordCupLeft"], greenPlastic);
  assignMaterial(root, ["lordCupRight"], redPlastic);
  assignMaterial(root, ["acRemoteButtonsLeft"], greyRubber);
  assignMaterial(root, ["acRemoteScreenLeft", "tabletScreen"], greySoftLight, true);
  assignMaterial(root, ["plantBase"], plantBasePlastic);
  _reflectiveMats.push(
    glossyWhiteBoard,
    chromeMetal,
    yellowMetalPaint,
    whitePaintMetal,
    blackGlass,
    frostedGlass,
    cableMetal,
    whiteVisibleLight,
    blackMattPlastic,
  );
}

function frameMeetingRoomInterior(root) {
  const table = root.getObjectByName("tablePlate");
  const target = new THREE.Vector3(0, 1.35, 0);
  if (table) {
    table.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(table);
    if (!box.isEmpty()) box.getCenter(target);
  }
  camera.near = 0.05;
  camera.far = 80;
  camera.updateProjectionMatrix();
  // Arena view (matches the reference framing): orbit radius 3.8 around the
  // tablePlate centre, camera a little higher, aimed above the table centre so
  // the table sits in the lower part of the frame with the back wall in view.
  camera.position.set(
    target.x + ARENA_CAM_RADIUS,
    target.y + ARENA_CAM_HEIGHT,
    target.z,
  );
  controls.target.set(target.x, target.y + ARENA_CAM_AIM_LIFT, target.z);
  controls.minDistance = 0.4;
  controls.maxDistance = 12;
  controls.update();
}
const ARENA_CAM_RADIUS = 3.8;
const ARENA_CAM_HEIGHT = 1.0;
const ARENA_CAM_AIM_LIFT = 0.55;

function loadMeetingRoom() {
  const screenMap = new THREE.TextureLoader().load(
    meetingRoomAsset(MEETING_ROOM_SCREEN_IMAGE),
  );
  screenMap.colorSpace = THREE.SRGBColorSpace;
  screenMap.anisotropy = 8;
  screenMap.wrapS = THREE.ClampToEdgeWrapping;
  screenMap.wrapT = THREE.ClampToEdgeWrapping;
  const woodMapsPromise = Promise.all([
    loadPoliigon2KMaps(MEETING_ROOM_WALL_WOOD).catch((error) => {
      console.warn("[MeetingRoom] wall wood maps failed", error);
      return null;
    }),
    loadPoliigon2KMaps(MEETING_ROOM_FLOOR_WOOD).catch((error) => {
      console.warn("[MeetingRoom] floor wood maps failed", error);
      return null;
    }),
    loadBanjoFigMaps().catch((error) => {
      console.warn("[MeetingRoom] plant maps failed", error);
      return null;
    }),
    loadMeetingRoomTexture(MEETING_ROOM_PLANT_GROUND, true).catch((error) => {
      console.warn("[MeetingRoom] plant ground map failed", error);
      return null;
    }),
    loadPoliigon2KMaps(MEETING_ROOM_TABLE_PLASTIC).catch((error) => {
      console.warn("[MeetingRoom] table plastic maps failed", error);
      return null;
    }),
    loadPoliigon2KMaps(MEETING_ROOM_COLUMN_CONCRETE).catch((error) => {
      console.warn("[MeetingRoom] column concrete maps failed", error);
      return null;
    }),
  ]);
  const loader = new GLTFLoader();
  loader.setResourcePath(_MEETING_ROOM_BASE);
  loader.load(
    meetingRoomAsset(MEETING_ROOM_GLTF),
    (gltf) => {
      woodMapsPromise.then(([wallWoodMaps, floorWoodMaps, plantMaps, plantGroundMap, tablePlasticMaps, columnConcreteMaps]) => {
      try {
        if (_model) scene.remove(_model);
        _model = gltf.scene;
        _model.name = "MeetingRoom";
        _model.traverse((node) => {
          if (!node.isMesh) return;
          node.castShadow = false;
          node.receiveShadow = false;
        });
        applyMeetingRoomMaterials(_model);
        applySealingPlatesDiamondMesh(_model);
        applyMeetingRoomScreenMaterials(_model, screenMap);
        _themeMats.wallWood = applyPoliigonWoodMaterial(_model, "backWallWood", wallWoodMaps, "z", "y", {
          color: new THREE.Color(1.2, 1.22, 1.16),
          envMapIntensity: 0.48,
        });
        _themeMats.wallWoodBright = new THREE.Color(1.2, 1.22, 1.16);
        _themeMats.wallWoodDark = new THREE.Color(0.22, 0.28, 0.42);
        _themeMats.floor = applyPoliigonWoodMaterial(_model, "floor", floorWoodMaps, "z", "x", {
          color: 0x7c7569,
          envMapIntensity: 0.18,
          tileMeters: 4.2,
        });
        _themeMats.floorColorBright = new THREE.Color(0x7c7569);
        _themeMats.floorColorDark = new THREE.Color(0x080a18);
        _themeMats.tablePlate = applyPoliigonWoodMaterial(_model, "tablePlate", tablePlasticMaps, "x", "z", {
          color:
            firstSourceColor(_model, ["tablePlate"]) || new THREE.Color(0xcc5300),
          envMapIntensity: 0.12,
          metalness: 0,
          tileMeters: 0.55,
          uvMode: "box",
          emissiveIntensity: 0.28,
          displacementScale: 0.002,
          displacementBias: -0.001,
          reflective: false,
        });
        _themeMats.tableEmissiveBright = (
          firstSourceColor(_model, ["tablePlate"]) || new THREE.Color(0xcc5300)
        ).clone();
        _themeMats.tableEmissiveDark = new THREE.Color(0xff3aa8);
        applyPoliigonWoodMaterial(_model, "concreteColumn", columnConcreteMaps, "x", "y", {
          uvMode: "cylindricalY",
          tileMeters: 2,
          envMapIntensity: 0.35,
        });
        applyBanjoFigPlantMaterial(_model, plantMaps);
        applyPlantGroundTexture(_model, plantGroundMap);
        enableDoubleSidedFaces(_model);
        makeColumnCameraPassable(_model);
        dimSofaFabric(_model);
        arrangeChairsAroundTable(_model);
        setupArenaScreens(_model);
        scene.add(_model);
        captureTableDriveSurface(_model);
        setupFreeCableAssembly(_model);
        attachMainPanelLights(_model);
        attachScreenLights(_model);
        attachTablePlateKeyLight(_model);
        attachTabletSideLight(_model);
        setupCabledObjects(_model);
        repeatWallPatternAlongX(_model, "wallRightPattern", "wallRight");
        repeatWallPatternAlongX(_model, "wallLeftPattern", "wallLeft");
        repeatWallPatternAlongZ(_model, "wallFrontPattern", "wallFront");
        repeatWallLeftPatternAlongNegZ(_model);
        if (!MR_PERF_BASELINE) instanceRepeatedWallPatterns(_model);
        frameMeetingRoomInterior(_model);
        setupTablePlateReflector(_model);
        applyLightBlend(lightBlend);
        loadKitchenCarOnTable();
        loadMeetingRoomAirPlane();
        _meetingRoomSceneReady = true;
        emitMeetingRoomSceneEvent("ready");
        requestAnimationFrame(() => {
          try {
            captureRoomReflections(_model);
            applyLightBlend(lightBlend);
          } catch (error) {
            console.warn("[MeetingRoom] reflection probe failed", error);
          }
        });
      } catch (error) {
        console.error("[MeetingRoom] setup failed", error);
        emitMeetingRoomSceneEvent("error", { error });
      }
      });
    },
    undefined,
    (error) => {
      console.error("[MeetingRoom] failed to load", MEETING_ROOM_GLTF, error);
      emitMeetingRoomSceneEvent("error", { error });
    },
  );
}

// ---------------------------------------------------------------------------
// 3-car battle arena: AI opponents, car-to-car bumps, multi-car cable targeting
// ---------------------------------------------------------------------------
/** side: -1 = far-left corner, +1 = far-right corner, as seen from the start camera. */
const ARENA_AI_CARS = [
  { name: "ArenaCarCyan", color: 0x1ec8ff, side: -1 },
  { name: "ArenaCarGold", color: 0xffc43a, side: 1 },
];
/** Start layout as fractions of the table's extent along the camera's view axes. */
const ARENA_SPAWN_PLAYER_DEPTH = 0.62;
const ARENA_SPAWN_CORNER_DEPTH = 0.72;
const ARENA_SPAWN_CORNER_WIDTH = 0.72;
const ARENA_SPAWN_EDGE_CLEAR = 0.16;
// Car mass, bump restitution / friction / decay and push resistance live in
// ../game/carBumpPhysics.js (shared with the kitchen race).

/**
 * Start positions from the camera's actual view: the player at the front edge
 * nearest the viewer (facing into the table), the AI cars in the far-left and
 * far-right corners (facing the table centre). Offsets are from the table centre.
 */
function computeArenaSpawns() {
  let fx = controls.target.x - camera.position.x;
  let fz = controls.target.z - camera.position.z;
  const fl = Math.hypot(fx, fz);
  if (fl > 1e-5) {
    fx /= fl;
    fz /= fl;
  } else {
    fx = -1;
    fz = 0;
  }
  // Screen-right on the table plane = forward x up.
  const rx = -fz;
  const rz = fx;
  const hx = tablePlateHalfX;
  const hz = tablePlateHalfZ;
  const depth = Math.abs(fx) * hx + Math.abs(fz) * hz;
  const width = Math.abs(rx) * hx + Math.abs(rz) * hz;
  const clear = ARENA_SPAWN_EDGE_CLEAR * Math.min(hx, hz);
  const fit = (ox, oz) => {
    const lx = Math.max(0.01, hx - clear);
    const lz = Math.max(0.01, hz - clear);
    const k = Math.min(1, lx / Math.max(1e-6, Math.abs(ox)), lz / Math.max(1e-6, Math.abs(oz)));
    return { x: ox * k, z: oz * k };
  };
  const pd = ARENA_SPAWN_PLAYER_DEPTH * depth;
  const player = fit(-fx * pd, -fz * pd);
  player.angle = Math.atan2(fx, fz);
  const cd = ARENA_SPAWN_CORNER_DEPTH * depth;
  const cw = ARENA_SPAWN_CORNER_WIDTH * width;
  const ai = ARENA_AI_CARS.map((cfg) => {
    const pos = fit(fx * cd + rx * cw * cfg.side, fz * cd + rz * cw * cfg.side);
    pos.angle = Math.atan2(-pos.x, -pos.z);
    return pos;
  });
  return { player, ai };
}

function spawnArenaAiCars(carScenes, spawns) {
  for (let i = 0; i < ARENA_AI_CARS.length; i++) {
    const cfg = ARENA_AI_CARS[i];
    const group = new THREE.Group();
    group.name = cfg.name;
    group.rotation.order = "YXZ";
    scene.add(group);
    const ctx = _newCarCtx(group, {
      forward: false,
      reverse: false,
      left: false,
      right: false,
      brake: false,
    });
    ctx.ai = createArenaAiBrain();
    const sp = spawns[i];
    withCar(ctx, () =>
      buildArenaCar(carScenes[i], {
        player: false,
        paintColor: cfg.color,
        spawnOffsetX: sp.x,
        spawnOffsetZ: sp.z,
        spawnAngle: sp.angle,
      }),
    );
    if (ctx.ready) arenaCars.push(ctx);
  }
}

// --- car-to-car collisions ---------------------------------------------------

function _carCanBump() {
  return (
    !!carPhysBody &&
    (carPhysState === CAR_PHYS.DRIVING || carPhysState === CAR_PHYS.IMPACT)
  );
}

/** Planar (XZ) kinematics of the loaded car as an oriented box. */
function _readCarKinematics(out) {
  const a = carState.angle;
  out.x = carPhysBody.position.x;
  out.z = carPhysBody.position.z;
  out.a = a;
  out.hx = carPhysHalf.x;
  out.hz = carPhysHalf.z;
  out.ux = Math.cos(a);
  out.uz = -Math.sin(a);
  out.fx = Math.sin(a);
  out.fz = Math.cos(a);
  out.driving = carPhysState === CAR_PHYS.DRIVING;
  if (out.driving) {
    out.vx = out.fx * carState.speed + carBumpVelX;
    out.vz = out.fz * carState.speed + carBumpVelZ;
    out.w = carBumpYaw;
  } else {
    out.vx = carPhysBody.velocity.x;
    out.vz = carPhysBody.velocity.z;
    out.w = carPhysBody.angularVelocity.y;
  }
  const w2 = out.hx * 2;
  const l2 = out.hz * 2;
  out.inertia = (CAR_MASS * (w2 * w2 + l2 * l2)) / 12;
  out.resAlong = 1;
  out.resSide = 1;
  return out;
}

/** Collision push on a driving car: rides on top of its own driving, then decays. */
function integrateCarBump(dt) {
  if (carBumpVelX === 0 && carBumpVelZ === 0 && carBumpYaw === 0) return;
  car.position.x += carBumpVelX * dt;
  car.position.z += carBumpVelZ * dt;
  carState.angle += carBumpYaw * dt;
  const kv = Math.exp(-CAR_BUMP_SLIDE_DECAY * dt);
  const kw = Math.exp(-CAR_BUMP_SPIN_DECAY * dt);
  carBumpVelX *= kv;
  carBumpVelZ *= kv;
  carBumpYaw *= kw;
  if (Math.hypot(carBumpVelX, carBumpVelZ) < 0.01) {
    carBumpVelX = 0;
    carBumpVelZ = 0;
  }
  if (Math.abs(carBumpYaw) < 0.02) carBumpYaw = 0;
}

function clearCarBump() {
  carBumpVelX = 0;
  carBumpVelZ = 0;
  carBumpYaw = 0;
}

/**
 * Puts the loaded car into the existing IMPACT slide state with the given
 * post-collision velocity — the same coast/decay/settle path a cable hit uses,
 * so a pushed car slides, can fall off the table, and recovers to driving.
 */
function beginCarBump(vx, vz, yawRate, hitSpeed) {
  if (!carPhysBody) return;
  if (carPhysState === CAR_PHYS.IMPACT && !(hitSpeed > CAR_BUMP_RESET_SPEED)) {
    // Light, continued contact while already sliding: update the slide but keep
    // its age, so the existing settle / recover-to-driving timing still runs.
    const spinShare = THREE.MathUtils.clamp(carImpactSpinShare, 0, 1);
    const linBurst = CABLE_HIT_BURST_TIME * (0.88 + (1 - spinShare) * 0.28);
    const linDamp = CABLE_HIT_DAMP_TIME * (0.78 + (1 - spinShare) * 0.36);
    const decay = Math.max(0.08, impactDecay(carImpactAge, linBurst, linDamp, 2));
    const spdNow = Math.hypot(vx, vz);
    if (spdNow > 1e-5) _impactKickDir.set(vx / spdNow, 0, vz / spdNow);
    carImpactLin0 = spdNow / decay;
    carPhysBody.velocity.x = vx;
    carPhysBody.velocity.z = vz;
    return;
  }
  if (carPhysState === CAR_PHYS.DRIVING) {
    makeCarDynamicFromDrive();
    carPhysState = CAR_PHYS.IMPACT;
    carPhysBody.linearDamping = 0;
    carPhysBody.angularDamping = 0;
    carPhysBody.linearFactor.set(1, 1, 1);
    carPhysBody.angularFactor.set(0, 1, 0);
    carPhysBody.collisionFilterMask = PHYS_GROUP_FLOOR;
    carPhysBody.velocity.y = 0;
  } else if (carPhysState !== CAR_PHYS.IMPACT) {
    return;
  }
  const spd = Math.hypot(vx, vz);
  if (spd > 1e-5) _impactKickDir.set(vx / spd, 0, vz / spd);
  carImpactLin0 = spd;
  carImpactYaw0 = THREE.MathUtils.clamp(yawRate, -CABLE_HIT_YAW_CAP, CABLE_HIT_YAW_CAP);
  carImpactSpinShare = 0.5;
  carImpactAge = 0;
  carImpactSettle = 0;
  carPhysBody.force.set(0, 0, 0);
  carPhysBody.torque.set(0, 0, 0);
  carPhysBody.velocity.x = vx;
  carPhysBody.velocity.z = vz;
  carPhysBody.angularVelocity.set(0, carImpactYaw0, 0);
  carPhysBody.wakeUp();
}

function _applyCarBumpResult(K, impulsed, dx, dz, hitSpeed) {
  if (carPhysState === CAR_PHYS.DRIVING) {
    // Stay in normal driving so keyboard / AI input keeps working through the
    // hit: the along-heading part goes into speed, the rest is a decaying push.
    car.position.x += dx;
    car.position.z += dz;
    if (impulsed) {
      const along = K.vx * K.fx + K.vz * K.fz;
      const cap = carState.maxSpeed * 1.25;
      carState.speed = THREE.MathUtils.clamp(along, -cap, cap);
      carBumpVelX = K.vx - K.fx * along;
      carBumpVelZ = K.vz - K.fz * along;
      carBumpYaw = THREE.MathUtils.clamp(K.w, -CABLE_HIT_YAW_CAP, CABLE_HIT_YAW_CAP);
    }
    syncCarBodyFromMesh();
  } else if (carPhysState === CAR_PHYS.IMPACT) {
    carPhysBody.position.x += dx;
    carPhysBody.position.z += dz;
    if (impulsed) beginCarBump(K.vx, K.vz, K.w, hitSpeed);
    applyImpactYawHeading(0);
  }
}

const _kinA = {};
const _kinB = {};
const _bumpRes = {};

/**
 * Bumper-car impulse between two cars, applied at the contact point (so
 * off-centre hits also spin the car). Each car's mass is direction-dependent:
 * the pushed car resists being shoved along its length and gives way sideways,
 * smoothly by the angle between the hit and its heading (see carInvMassAlong in ../game/carBumpPhysics.js).
 */
function _resolveCarPair(cA, cB) {
  const A = withCar(cA, () => (_carCanBump() ? _readCarKinematics(_kinA) : null));
  if (!A) return;
  const B = withCar(cB, () => (_carCanBump() ? _readCarKinematics(_kinB) : null));
  if (!B) return;
  if (!solveCarBump(A, B, _bumpRes)) return;
  const nx = _bumpRes.nx;
  const nz = _bumpRes.nz;
  const impulsed = _bumpRes.impulsed;
  const pushA = _bumpRes.pushA;
  const pushB = _bumpRes.pushB;
  const hitSpeed = _bumpRes.hitSpeed;
  if (impulsed) {
    noteCameraImpact(hitSpeed);
    noteCarContact(cA, cB, hitSpeed);
  }
  withCar(cA, () => _applyCarBumpResult(A, impulsed, -nx * pushA, -nz * pushA, hitSpeed));
  withCar(cB, () => _applyCarBumpResult(B, impulsed, nx * pushB, nz * pushB, hitSpeed));
}

function resolveArenaCarCollisions() {
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < arenaCars.length; i++) {
      if (!arenaCars[i].ready) continue;
      for (let j = i + 1; j < arenaCars.length; j++) {
        if (!arenaCars[j].ready) continue;
        _resolveCarPair(arenaCars[i], arenaCars[j]);
      }
    }
  }
}

// --- AI drivers ----------------------------------------------------------------

function createArenaAiBrain() {
  return {
    mode: "hunt",
    modeT: 0.8 + Math.random() * 1.4,
    target: null,
    wanderX: 0,
    wanderZ: 0,
    feintDir: 1,
    noisePhase: Math.random() * Math.PI * 2,
    noiseFreq: 0.55 + Math.random() * 0.9,
    noiseAmp: 0.1 + Math.random() * 0.18,
    aggression: 0.75 + Math.random() * 0.5,
    stuckT: 0,
    reverseT: 0,
    reverseSteer: 1,
    brakeT: 0,
    lastState: CAR_PHYS.DRIVING,
  };
}

function _arenaCarOnTable(c) {
  if (!c.ready || !c.carPhysBody) return false;
  if (c.carPhysState !== CAR_PHYS.DRIVING && c.carPhysState !== CAR_PHYS.IMPACT) {
    return false;
  }
  const p = c.car.position;
  return (
    Math.abs(p.x - tablePlateCenter.x) <= tablePlateHalfX &&
    Math.abs(p.z - tablePlateCenter.z) <= tablePlateHalfZ
  );
}

function _arenaCarVelocity(c, out) {
  if (c.carPhysState === CAR_PHYS.DRIVING) {
    out.x = Math.sin(c.carState.angle) * c.carState.speed;
    out.z = Math.cos(c.carState.angle) * c.carState.speed;
  } else if (c.carPhysBody) {
    out.x = c.carPhysBody.velocity.x;
    out.z = c.carPhysBody.velocity.z;
  } else {
    out.x = 0;
    out.z = 0;
  }
  return out;
}

function _aiPickTarget(self) {
  const me = self.car.position;
  const reach = Math.max(0.2, Math.min(tablePlateHalfX, tablePlateHalfZ));
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < arenaCars.length; i++) {
    const c = arenaCars[i];
    if (c === self || !_arenaCarOnTable(c)) continue;
    const p = c.car.position;
    const edge = Math.max(
      Math.abs(p.x - tablePlateCenter.x) / tablePlateHalfX,
      Math.abs(p.z - tablePlateCenter.z) / tablePlateHalfZ,
    );
    const d = Math.hypot(p.x - me.x, p.z - me.z) / reach;
    const score =
      edge * 1.1 + 0.8 / (0.6 + d) + Math.random() * 0.7 + (c.isPlayer ? 0.3 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function _aiPickWanderPoint(b) {
  b.wanderX = tablePlateCenter.x + (Math.random() * 2 - 1) * tablePlateHalfX * 0.55;
  b.wanderZ = tablePlateCenter.z + (Math.random() * 2 - 1) * tablePlateHalfZ * 0.55;
}

function _wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

const _aiTargetVel = { x: 0, z: 0 };

/** Runs inside withCar(self): sets this AI car's own key state, then updateCar drives it. */
function _arenaAiThink(self, dt) {
  const k = keys;
  const b = self.ai;
  k.forward = false;
  k.reverse = false;
  k.left = false;
  k.right = false;
  k.brake = false;
  if (!carPhysBody || carPhysState !== CAR_PHYS.DRIVING) {
    b.lastState = carPhysState;
    b.stuckT = 0;
    return;
  }
  if (b.lastState === CAR_PHYS.IMPACT) {
    // Just recovered from a hit: sometimes back off, sometimes pick a new victim.
    if (Math.random() < 0.5) {
      b.mode = "hunt";
      b.target = null;
      b.modeT = 1.4 + Math.random() * 2;
    }
    if (Math.random() < 0.35) {
      b.reverseT = 0.22 + Math.random() * 0.35;
      b.reverseSteer = Math.random() < 0.5 ? -1 : 1;
    }
  }
  b.lastState = carPhysState;

  const px = car.position.x;
  const pz = car.position.z;
  const a = carState.angle;
  const fx = Math.sin(a);
  const fz = Math.cos(a);
  const spd = carState.speed;
  const cx = tablePlateCenter.x;
  const cz = tablePlateCenter.z;
  const hxT = tablePlateHalfX;
  const hzT = tablePlateHalfZ;
  const carLen = Math.max(0.05, halfL * storedCarScale * 2);

  b.modeT -= dt;
  if (b.modeT <= 0) {
    const r = Math.random();
    if (r < 0.72) {
      b.mode = "hunt";
      b.target = _aiPickTarget(self);
      b.modeT = 1.6 + Math.random() * 3.2;
    } else if (r < 0.9) {
      b.mode = "wander";
      _aiPickWanderPoint(b);
      b.modeT = 0.9 + Math.random() * 1.8;
    } else {
      b.mode = "feint";
      b.feintDir = Math.random() < 0.5 ? -1 : 1;
      b.modeT = 0.35 + Math.random() * 0.5;
    }
  }
  if (b.mode === "hunt" && (!b.target || !_arenaCarOnTable(b.target))) {
    b.target = _aiPickTarget(self);
    if (!b.target) {
      b.mode = "wander";
      _aiPickWanderPoint(b);
    }
  }

  if (b.reverseT > 0) {
    b.reverseT -= dt;
    k.reverse = true;
    if (b.reverseSteer < 0) k.left = true;
    else k.right = true;
    return;
  }

  let tx = cx;
  let tz = cz;
  let charge = false;
  if (b.mode === "hunt" && b.target) {
    const tp = b.target.car.position;
    _arenaCarVelocity(b.target, _aiTargetVel);
    const tnx = (tp.x - cx) / hxT;
    const tnz = (tp.z - cz) / hzT;
    // Push the victim toward its nearest edge, blended with the radial direction.
    let ex = 0;
    let ez = 0;
    if ((1 - Math.abs(tnx)) * hxT < (1 - Math.abs(tnz)) * hzT) ex = Math.sign(tnx) || 1;
    else ez = Math.sign(tnz) || 1;
    let rx = tp.x - cx;
    let rz = tp.z - cz;
    const rl = Math.hypot(rx, rz);
    if (rl > 1e-4) {
      rx /= rl;
      rz /= rl;
    }
    let pdx = ex * 0.7 + rx * 0.3;
    let pdz = ez * 0.7 + rz * 0.3;
    const pl = Math.hypot(pdx, pdz) || 1;
    pdx /= pl;
    pdz /= pl;
    const toX = tp.x - px;
    const toZ = tp.z - pz;
    const dist = Math.hypot(toX, toZ);
    const align = dist > 1e-4 ? (toX * pdx + toZ * pdz) / dist : 1;
    if (align > 0.45 - b.aggression * 0.25 || dist < carLen * 1.8) {
      const lead = Math.min(0.5, dist / (Math.abs(spd) + 1.2));
      tx = tp.x + _aiTargetVel.x * lead;
      tz = tp.z + _aiTargetVel.z * lead;
      charge = true;
    } else {
      // Circle round to the centre side of the victim first.
      const back = carLen * 2.2;
      tx = tp.x - pdx * back;
      tz = tp.z - pdz * back;
    }
  } else if (b.mode === "wander") {
    tx = b.wanderX;
    tz = b.wanderZ;
    if (Math.hypot(tx - px, tz - pz) < carLen * 1.2) b.modeT = 0;
  }
  tx = THREE.MathUtils.clamp(tx, cx - hxT * 0.92, cx + hxT * 0.92);
  tz = THREE.MathUtils.clamp(tz, cz - hzT * 0.92, cz + hzT * 0.92);

  // Edge safety: look ahead along the current heading.
  const moveSign = spd < -0.05 ? -1 : 1;
  const lookDist = carLen * 0.7 + Math.abs(spd) * 0.32;
  const lnx = (px + fx * lookDist * moveSign - cx) / hxT;
  const lnz = (pz + fz * lookDist * moveSign - cz) / hzT;
  const lookEdge = Math.max(Math.abs(lnx), Math.abs(lnz));
  const nnx = (px - cx) / hxT;
  const nnz = (pz - cz) / hzT;
  const edge = Math.max(Math.abs(nnx), Math.abs(nnz));
  let danger = false;
  if (lookEdge > 0.8) {
    danger = true;
    charge = false;
    tx = cx;
    tz = cz;
    const noseOut = fx * nnx + fz * nnz;
    if (edge > 0.84 && noseOut > 0.25) {
      b.reverseT = 0.3 + Math.random() * 0.35;
      b.reverseSteer = Math.random() < 0.5 ? -1 : 1;
      k.reverse = true;
      return;
    }
    if (spd > carState.maxSpeed * 0.5) k.brake = true;
  }

  if (b.mode === "feint" && !danger) {
    if (b.feintDir < 0) k.left = true;
    else k.right = true;
    k.forward = true;
  } else {
    const want = Math.atan2(tx - px, tz - pz);
    let diff = _wrapAngle(want - a);
    diff +=
      Math.sin(clock.elapsedTime * b.noiseFreq * Math.PI * 2 + b.noisePhase) *
      b.noiseAmp *
      (charge ? 0.35 : 1);
    if (diff > 0.06) k.left = true;
    else if (diff < -0.06) k.right = true;
    if (!k.brake) k.forward = true;
    if (Math.abs(diff) > 2.3 && Math.abs(spd) < 0.6 && !danger && Math.random() < 0.04) {
      b.reverseT = 0.3 + Math.random() * 0.3;
      b.reverseSteer = diff > 0 ? 1 : -1;
    }
  }

  if (k.forward && Math.abs(spd) < 0.12) b.stuckT += dt;
  else b.stuckT = Math.max(0, b.stuckT - dt);
  if (b.stuckT > 0.7) {
    b.reverseT = 0.4 + Math.random() * 0.5;
    b.reverseSteer = Math.random() < 0.5 ? -1 : 1;
    b.stuckT = 0;
  }
  if (!charge && !danger && b.brakeT <= 0 && Math.random() < dt * 0.15) {
    b.brakeT = 0.12 + Math.random() * 0.2;
  }
  if (b.brakeT > 0) {
    b.brakeT -= dt;
    k.brake = true;
    k.forward = false;
  }
}

function updateArenaAi(dt) {
  _syncActiveCarCtx();
  for (let i = 0; i < arenaCars.length; i++) {
    const c = arenaCars[i];
    if (!c.ready || !c.ai || c.out) continue; // knocked-off cars are out of play
    withCar(c, () => _arenaAiThink(c, dt));
  }
}

// --- multi-car cable targeting ---------------------------------------------------

/** Cars inside the cable's activation radius, in the order they entered it. */
const _cableEntryOrder = [];
let _cableTargetCar = null;
const _cableAimProbe = new THREE.Vector3();

function _carCableDistance(cable) {
  closestPointOnCarObb(cable.smoothTip, _cableAimProbe);
  return Math.min(
    Math.hypot(_cableAimProbe.x - cable.anchorWorld.x, _cableAimProbe.z - cable.anchorWorld.z),
    Math.hypot(_cableAimProbe.x - cable.smoothTip.x, _cableAimProbe.z - cable.smoothTip.z),
  );
}

const _cableInsideCars = [];
const _cableInsideDist = [];

function selectCableTargetCar() {
  const cable = _freeCable;
  if (!cable || !cable.ready) return null;
  _syncActiveCarCtx();
  let nearest = null;
  let nearestDist = Infinity;
  const inside = _cableInsideCars;
  const insideD = _cableInsideDist;
  inside.length = 0;
  insideD.length = 0;
  for (let i = 0; i < arenaCars.length; i++) {
    const c = arenaCars[i];
    // Never target a car that has fallen off (or is falling / respawning).
    if (!_arenaCarOnTable(c)) continue;
    _cableDistProbeCable = cable;
    const d = withCar(c, _carCableDistanceActive);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = c;
    }
    if (d < FREE_CABLE_ATTACK_OUTER) {
      // Keep `inside` sorted by distance (nearest first), as before.
      let k = inside.length;
      while (k > 0 && insideD[k - 1] > d) k--;
      inside.splice(k, 0, c);
      insideD.splice(k, 0, d);
    }
  }
  for (let i = _cableEntryOrder.length - 1; i >= 0; i--) {
    if (inside.indexOf(_cableEntryOrder[i]) < 0) _cableEntryOrder.splice(i, 1);
  }
  for (let i = 0; i < inside.length; i++) {
    if (_cableEntryOrder.indexOf(inside[i]) < 0) _cableEntryOrder.push(inside[i]);
  }
  let target =
    _cableTargetCar && _cableEntryOrder.indexOf(_cableTargetCar) >= 0
      ? _cableTargetCar
      : _cableEntryOrder[0] || null;
  // Nobody in range: aim stays on the nearest car so the cable relaxes to idle
  // exactly like the single-car version did when its car was out of range.
  if (!target) target = nearest;
  if (target !== _cableTargetCar) {
    cable.contactHeld = false;
    _cableTargetCar = target;
  }
  return target;
}

let _cableDistProbeCable = null;
function _carCableDistanceActive() {
  return _carCableDistance(_cableDistProbeCable);
}

function updateArenaCable(dt) {
  const target = selectCableTargetCar();
  if (target) {
    withCar(target, () => updateFreeCableAssembly(dt));
    return;
  }
  const wasReady = _carReady;
  _carReady = false;
  try {
    updateFreeCableAssembly(dt);
  } finally {
    _carReady = wasReady;
  }
}

/** Cable tip contact is checked against every car (each keeps its own hit latch). */
function updateCableCarImpactAll(dt) {
  for (let i = 0; i < arenaCars.length; i++) {
    const c = arenaCars[i];
    if (!c.ready) continue;
    withCar(c, () => updateCableCarImpact(dt));
  }
}

function updateArenaCarEffects(dt) {
  for (let i = 0; i < arenaCars.length; i++) {
    const c = arenaCars[i];
    if (!c.ready) continue;
    withCar(c, () => {
      updateExhaustEffects(dt);
      updateCarHitSparks(dt);
    });
  }
  updateShockRoomLight(dt);
}

/** Moves the shared room light to the strongest active car shock and pulses it with the arcs. */
function updateShockRoomLight(dt) {
  _syncActiveCarCtx();
  let best = null;
  let bestCar = null;
  for (let i = 0; i < arenaCars.length; i++) {
    const c = arenaCars[i];
    const sp = c._carHitSpark;
    if (!c.ready || !sp || !sp.active || !(sp.roomDrive > 0)) continue;
    if (!best || sp.roomDrive > best.roomDrive) {
      best = sp;
      bestCar = c.car;
    }
  }
  let target = 0;
  if (best) {
    const themeMul = 1.15 - lightBlend * 0.35;
    target = best.roomDrive * SHOCK_ROOM_PEAK * themeMul;
    const flash = THREE.MathUtils.clamp(best.roomFlash || 0, 0, 1);
    shockRoomLight.color.copy(SHOCK_ROOM_COLOR_LOW).lerp(SHOCK_ROOM_COLOR_HIGH, flash);
    shockRoomLight.distance = THREE.MathUtils.lerp(
      SHOCK_ROOM_BASE_DIST,
      SHOCK_ROOM_FLASH_DIST,
      flash,
    );
    shockRoomLight.position.set(
      bestCar.position.x,
      bestCar.position.y + SHOCK_ROOM_LIFT,
      bestCar.position.z,
    );
  }
  // Rises instantly with a flash, dies off quickly but smoothly between flashes / at the end.
  const prev = shockRoomLight.intensity;
  const fall = dt > 0 ? prev * Math.exp(-dt * 16) : prev;
  shockRoomLight.intensity = target >= fall ? target : fall;
  if (shockRoomLight.intensity < 0.01) shockRoomLight.intensity = 0;
}

// ---------------------------------------------------------------------------
// Dynamic arena camera: 90° orbit steps around the tablePlate centre
// ---------------------------------------------------------------------------
const CAM_ORBIT_STEP = Math.PI / 2;
const CAM_ORBIT_DURATION = 0.85;
const CAM_ORBIT_WAIT_MIN = 6;
const CAM_ORBIT_WAIT_MAX = 12;
/** Seconds the director stays out of the way after the user drags / zooms. */
const CAM_ORBIT_USER_PAUSE = 6;
/** Random spread added to each candidate view's score (keeps it unpredictable). */
const CAM_ORBIT_SCORE_NOISE = 0.22;

const _camDirector = {
  active: false,
  t: 0,
  from: 0,
  to: 0,
  radius: 0,
  height: 0,
  centerY: 0,
  wait: CAM_ORBIT_WAIT_MIN + Math.random() * (CAM_ORBIT_WAIT_MAX - CAM_ORBIT_WAIT_MIN),
  userPause: 0,
  cameFrom: null,
  postponed: 0,
};

controls.addEventListener("start", () => {
  _camDirector.active = false;
  _camDirector.userPause = CAM_ORBIT_USER_PAUSE;
});

function cancelCameraDirector() {
  _camDirector.active = false;
  _camDirector.cameFrom = null;
  _camDirector.wait =
    CAM_ORBIT_WAIT_MIN + Math.random() * (CAM_ORBIT_WAIT_MAX - CAM_ORBIT_WAIT_MIN);
}

function _camEaseInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * How well the player's car can be seen from a camera at azimuth `theta`
 * (same orbit radius / height). Higher is better. Considers whether the player
 * is on the far side of the table, hidden behind another car from that angle,
 * and whether the player and the nearest opponent are spread across the view.
 */
function _scoreArenaView(theta, radius) {
  _syncActiveCarCtx();
  const p = _playerCarCtx;
  if (!_arenaCarOnTable(p)) return 0.5;
  const cx = tablePlateCenter.x;
  const cz = tablePlateCenter.z;
  const camX = cx + Math.sin(theta) * radius;
  const camZ = cz + Math.cos(theta) * radius;
  const fx = -Math.sin(theta);
  const fz = -Math.cos(theta);
  const rx = -fz;
  const rz = fx;
  const pp = p.car.position;
  const ext = Math.abs(fx) * tablePlateHalfX + Math.abs(fz) * tablePlateHalfZ;
  const depth = ((pp.x - cx) * fx + (pp.z - cz) * fz) / Math.max(1e-4, ext);
  let score = 1;
  score -= Math.max(0, depth - 0.15) * 0.9;
  score -= Math.max(0, -depth - 0.85) * 0.5;
  const occR = Math.max(0.05, p.halfW * p.storedCarScale * 2.4);
  const wx = pp.x - camX;
  const wz = pp.z - camZ;
  const w2 = wx * wx + wz * wz;
  let nearest = null;
  let nearestD = Infinity;
  for (let i = 0; i < arenaCars.length; i++) {
    const o = arenaCars[i];
    if (o === p || !_arenaCarOnTable(o)) continue;
    const op = o.car.position;
    const vx = op.x - camX;
    const vz = op.z - camZ;
    const along = w2 > 1e-8 ? (vx * wx + vz * wz) / w2 : 0;
    if (along > 0 && along < 1) {
      const perp = Math.hypot(vx - wx * along, vz - wz * along);
      if (perp < occR) score -= 0.45 * (1 - perp / occR);
    }
    const d = Math.hypot(op.x - pp.x, op.z - pp.z);
    if (d < nearestD) {
      nearestD = d;
      nearest = o;
    }
  }
  if (nearest && nearestD > 1e-4) {
    const lat =
      Math.abs((nearest.car.position.x - pp.x) * rx + (nearest.car.position.z - pp.z) * rz) /
      nearestD;
    score += 0.15 * lat;
  }
  return score;
}

function _startCameraOrbit(direction) {
  const d = _camDirector;
  if (d.active) return; // never overlap rotations
  const cx = tablePlateCenter.x;
  const cz = tablePlateCenter.z;
  const ox = camera.position.x - cx;
  const oz = camera.position.z - cz;
  d.radius = Math.hypot(ox, oz);
  d.centerY = controls.target.y;
  d.height = camera.position.y - d.centerY;
  d.from = Math.atan2(ox, oz);
  d.to = d.from + direction * CAM_ORBIT_STEP;
  d.t = 0;
  d.active = true;
  d.cameFrom = d.from;
}

function updateCameraDirector(dt) {
  const d = _camDirector;
  if (_carFollowCam || !_carReady || !Number.isFinite(tablePlateHalfX)) {
    d.active = false;
    return;
  }
  if (d.userPause > 0) {
    d.userPause -= dt;
    return;
  }
  // Hold the opening view (facing the screens) until the countdown is over.
  if (!_arenaGame.live && !d.active) return;
  const cx = tablePlateCenter.x;
  const cz = tablePlateCenter.z;
  if (d.active) {
    d.t = Math.min(1, d.t + dt / CAM_ORBIT_DURATION);
    const theta = THREE.MathUtils.lerp(d.from, d.to, _camEaseInOut(d.t));
    camera.position.set(
      cx + Math.sin(theta) * d.radius,
      d.centerY + d.height,
      cz + Math.cos(theta) * d.radius,
    );
    controls.target.set(cx, d.centerY, cz);
    if (d.t >= 1) {
      d.active = false;
      d.wait = CAM_ORBIT_WAIT_MIN + Math.random() * (CAM_ORBIT_WAIT_MAX - CAM_ORBIT_WAIT_MIN);
    }
    return;
  }
  const ox = camera.position.x - cx;
  const oz = camera.position.z - cz;
  const radius = Math.hypot(ox, oz);
  if (radius < 1e-3) return;
  const now = Math.atan2(ox, oz);
  // A poor view of the player makes the next rotation come sooner.
  const current = _scoreArenaView(now, radius);
  const urgency = 1 + 2 * THREE.MathUtils.clamp(0.75 - current, 0, 1);
  d.wait -= dt * urgency;
  if (d.wait > 0) return;
  const options = [1, -1].map((dir) => {
    const theta = now + dir * CAM_ORBIT_STEP;
    let s = _scoreArenaView(theta, radius) + (Math.random() * 2 - 1) * CAM_ORBIT_SCORE_NOISE;
    if (d.cameFrom != null && Math.abs(_wrapAngle(theta - d.cameFrom)) < 0.1) s -= 0.1;
    return { dir, s };
  });
  const best = Math.max(options[0].s, options[1].s);
  if (best < current - 0.35 && d.postponed < 1) {
    // Both 90° views would hide the player: hold this view a little longer.
    d.postponed += 1;
    d.wait = 2 + Math.random() * 2;
    return;
  }
  d.postponed = 0;
  const w0 = Math.exp(options[0].s * 3);
  const w1 = Math.exp(options[1].s * 3);
  const pick = Math.random() * (w0 + w1) < w0 ? options[0] : options[1];
  _startCameraOrbit(pick.dir);
}

// ---------------------------------------------------------------------------
// Screen content manager (screenLeft / screenRight)
// Each screen keeps an exact copy of its original material for its normal
// content, plus one reusable text material (canvas) and one replay material
// (shared render target). Switching content only swaps mesh.material, so the
// original screen texture is never touched.
// ---------------------------------------------------------------------------
const SCREEN_MESH_NAMES = { left: "screenLeft", right: "screenRight" };
const SCREEN_CANVAS_W = 1024;
const SCREEN_CANVAS_H = 576;
const SCREEN_TEXT_GAIN = 1.35;
const _screens = { left: null, right: null };
let _screensGlow = null;

// --- screen glow (bloom look for screenLeft / screenRight only) --------------
// A procedural halo: rounded-rectangle distance + smooth falloff. It never
// samples the screen texture, so no screen detail can leak into it; its color
// is ONE averaged color per piece of content (see _screenGlowTargetColor).
/** Overall glow intensity (0 = off). */
const SCREEN_GLOW_STRENGTH = 0.2;
/** How far the glow reaches past the screen edge, in meters (glow size). */
const SCREEN_GLOW_SPREAD = 0.34;
/** Falloff softness: higher = glow hugs the edge more, fades out sooner. */
const SCREEN_GLOW_SOFTNESS = 1.8;
/** Corner rounding of the halo, as a share of SCREEN_GLOW_SPREAD. */
const SCREEN_GLOW_CORNER = 0.6;
/** Noise dither on the faint outer fade (in 8-bit steps) to prevent banding. */
const SCREEN_GLOW_DITHER = 0.5;
/**
 * Color source per content type:
 * - WELCOME image: its average color (computed once from the image),
 * - countdown text: the word's color, at SCREEN_GLOW_TEXT_LEVEL,
 * - replay: a fixed soft color, at SCREEN_GLOW_REPLAY_LEVEL.
 */
const SCREEN_GLOW_TEXT_LEVEL = 0.3;
const SCREEN_GLOW_REPLAY_COLOR = new THREE.Color(0x8fb4ff);
const SCREEN_GLOW_REPLAY_LEVEL = 0.35;
/** How quickly the glow eases to a new color / level (1/s). */
const SCREEN_GLOW_EASE = 6;
/** Dark-Mode emissive intensity of the screen content (glow scales with it). */
const SCREEN_GLOW_REF_EMISSIVE = 4.4;

const _screenGlowMeshes = [];

const screenGlowVertex = `
attribute vec2 aRect;
varying vec2 vRect;
void main() {
  vRect = aRect;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const screenGlowFragment = `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uIntA;
uniform float uIntB;
uniform float uCenterA;
uniform float uCenterB;
uniform vec2 uHalf;
uniform float uSpread;
uniform float uSoftness;
uniform float uCorner;
uniform float uDither;
varying vec2 vRect;
float glowHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  // Rounded-rectangle distance (meters) outside the screen; 0 at/inside it.
  float r = uCorner;
  vec2 q = abs(vRect) - (uHalf - vec2(r));
  float d = max(length(max(q, 0.0)) - r, 0.0);
  // Inside the screens' outline (incl. the gap between them): no glow.
  if (d <= 0.0) discard;
  float t = clamp(d / uSpread, 0.0, 1.0);
  // smoothstep has zero slope at both ends: no visible inner or outer edge.
  float fall = pow(1.0 - smoothstep(0.0, 1.0, t), uSoftness);
  if (fall <= 0.0) discard;
  // Each side takes its own screen's color / level, blended across the seam.
  float side = smoothstep(0.0, 1.0, (vRect.x - uCenterA) / (uCenterB - uCenterA));
  vec3 col = mix(uColorA * uIntA, uColorB * uIntB, side) * fall;
  col += (glowHash(gl_FragCoord.xy) - 0.5) * (uDither / 255.0);
  gl_FragColor = vec4(max(col, 0.0), 1.0);
  #include <colorspace_fragment>
}
`;

/** Average color (linear) of an image/canvas, via a tiny downscaled copy. Run rarely. */
const _glowAvgCanvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
function _averageImageColor(img, out) {
  if (!_glowAvgCanvas || !img) return false;
  const w = img.naturalWidth || img.videoWidth || img.width;
  const h = img.naturalHeight || img.videoHeight || img.height;
  if (!(w > 0 && h > 0)) return false;
  const N = 8;
  _glowAvgCanvas.width = N;
  _glowAvgCanvas.height = N;
  const c = _glowAvgCanvas.getContext("2d", { willReadFrequently: true });
  c.clearRect(0, 0, N, N);
  c.drawImage(img, 0, 0, N, N);
  const px = c.getImageData(0, 0, N, N).data;
  const tmp = new THREE.Color();
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < px.length; i += 4) {
    tmp.setRGB(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255, THREE.SRGBColorSpace);
    r += tmp.r;
    g += tmp.g;
    b += tmp.b;
  }
  const n = px.length / 4;
  out.setRGB(r / n, g / n, b / n);
  return true;
}

/**
 * One soft additive halo around BOTH screens (they sit edge to edge as one
 * display). Two separate halos overlapped at the seam and added up into bright
 * wedges above / below it; a single halo cannot overlap itself. Built in the
 * screens' plane, SCREEN_GLOW_SPREAD past their combined outline, 3 mm toward
 * the wall, so both screens stay fully sharp in front of it.
 */
function createScreensGlow(meshA, meshB) {
  const meshes = [meshA, meshB].filter(Boolean);
  if (!meshes.length) return null;
  const quad = (m) => {
    const pos = m.geometry.getAttribute("position");
    if (!pos || pos.count !== 4) return null;
    m.updateWorldMatrix(true, false);
    const out = [];
    for (let i = 0; i < 4; i++) out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
    return out;
  };
  const quads = meshes.map(quad);
  if (quads.some((q) => !q)) return null;
  const q0 = quads[0];
  const axisA = new THREE.Vector3().subVectors(q0[1], q0[0]);
  const axisB = new THREE.Vector3().subVectors(q0[3], q0[0]);
  if (Math.abs(axisA.clone().normalize().dot(axisB.clone().normalize())) > 0.9) {
    axisB.subVectors(q0[2], q0[0]);
  }
  const normal = new THREE.Vector3().crossVectors(axisA, axisB).normalize();
  const n = meshes[0].geometry.getAttribute("normal");
  if (n) {
    const nw = new THREE.Vector3().fromBufferAttribute(n, 0).transformDirection(meshes[0].matrixWorld);
    if (nw.dot(normal) < 0) normal.negate();
  }
  const u = axisA.clone().normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  const origin = q0[0].clone();
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  const centersU = [];
  for (const q of quads) {
    let cu = 0;
    for (const p of q) {
      const d = p.clone().sub(origin);
      const pu = d.dot(u);
      const pv = d.dot(v);
      uMin = Math.min(uMin, pu);
      uMax = Math.max(uMax, pu);
      vMin = Math.min(vMin, pv);
      vMax = Math.max(vMax, pv);
      cu += pu;
    }
    centersU.push(cu / 4);
  }
  const cU = (uMin + uMax) * 0.5;
  const cV = (vMin + vMax) * 0.5;
  const halfU = (uMax - uMin) * 0.5;
  const halfV = (vMax - vMin) * 0.5;
  const center = origin.clone().addScaledVector(u, cU).addScaledVector(v, cV);
  const parent = meshes[0].parent;
  parent.updateWorldMatrix(true, false);
  const inv = parent.matrixWorld.clone().invert();
  const eu = halfU + SCREEN_GLOW_SPREAD;
  const ev = halfV + SCREEN_GLOW_SPREAD;
  const corners = [
    [-eu, -ev],
    [eu, -ev],
    [eu, ev],
    [-eu, ev],
  ];
  const outPos = new Float32Array(12);
  const outRect = new Float32Array(8);
  corners.forEach(([du, dv], i) => {
    const p = center
      .clone()
      .addScaledVector(u, du)
      .addScaledVector(v, dv)
      .addScaledVector(normal, -0.003)
      .applyMatrix4(inv);
    outPos.set([p.x, p.y, p.z], i * 3);
    outRect.set([du, dv], i * 2);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(outPos, 3));
  geo.setAttribute("aRect", new THREE.BufferAttribute(outRect, 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  // Screen centers along the halo's horizontal axis (A = first mesh, B = second).
  const centerA = centersU[0] - cU;
  const centerB = (centersU.length > 1 ? centersU[1] : centersU[0] + 1) - cU;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(0, 0, 0) },
      uColorB: { value: new THREE.Color(0, 0, 0) },
      uIntA: { value: 0 },
      uIntB: { value: 0 },
      uCenterA: { value: centerA },
      uCenterB: { value: centerB },
      uHalf: { value: new THREE.Vector2(halfU, halfV) },
      uSpread: { value: SCREEN_GLOW_SPREAD },
      uSoftness: { value: SCREEN_GLOW_SOFTNESS },
      uCorner: { value: Math.min(SCREEN_GLOW_SPREAD * SCREEN_GLOW_CORNER, Math.min(halfU, halfV)) },
      uDither: { value: SCREEN_GLOW_DITHER },
    },
    vertexShader: screenGlowVertex,
    fragmentShader: screenGlowFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const glow = new THREE.Mesh(geo, mat);
  glow.name = "screensGlow";
  glow.renderOrder = 1;
  glow.castShadow = false;
  glow.receiveShadow = false;
  glow.userData.skipBounds = true;
  glow.visible = false; // shown once both screens have a glow color
  parent.add(glow);
  _screenGlowMeshes.push(glow);
  return glow;
}

function setupArenaScreens(root) {
  for (const key of ["left", "right"]) {
    const mesh = root.getObjectByName(SCREEN_MESH_NAMES[key]);
    if (!mesh || !mesh.isMesh || !mesh.material) continue;
    const base = mesh.material;
    const contentMat = base.clone();
    if (_reflectiveMats.includes(base)) _reflectiveMats.push(contentMat);
    const canvas = document.createElement("canvas");
    canvas.width = SCREEN_CANVAS_W;
    canvas.height = SCREEN_CANVAS_H;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const textMat = new THREE.MeshBasicMaterial({
      map: tex,
      toneMapped: false,
      side: base.side,
    });
    textMat.color.setScalar(SCREEN_TEXT_GAIN);
    const replayMat = new THREE.MeshBasicMaterial({
      map: null,
      toneMapped: true,
      side: base.side,
    });
    mesh.material = contentMat;
    _screens[key] = {
      key,
      mesh,
      glowColor: new THREE.Color(0, 0, 0),
      glowInt: 0,
      glowReady: false,
      base,
      contentMat,
      textMat,
      replayMat,
      canvas,
      ctx2d: canvas.getContext("2d"),
      tex,
      mode: "content",
      text: "",
      color: "#ffffff",
      textAge: 0,
    };
  }
  if (SCREEN_GLOW_STRENGTH > 0 && !MR_PERF_NOGLOW && (_screens.left || _screens.right)) {
    _screensGlow = createScreensGlow(
      _screens.left && _screens.left.mesh,
      _screens.right && _screens.right.mesh,
    );
  }
}

// READY / SET / GO! use Wix Madefor Display (Google Fonts; heaviest weight is
// 800). Loaded once up front; the countdown falls back to Arial Black until it
// is ready, and any text already on a screen is redrawn when it arrives.
const COUNTDOWN_FONT_FAMILY = "Wix Madefor Display";
const COUNTDOWN_FONT_WEIGHT = 800;
const COUNTDOWN_FONT = `${COUNTDOWN_FONT_WEIGHT} 250px "${COUNTDOWN_FONT_FAMILY}", "Arial Black", Impact, sans-serif`;
(function loadCountdownFont() {
  if (typeof document === "undefined" || !document.fonts) return;
  const redraw = () => {
    for (const key of ["left", "right"]) {
      const scr = typeof _screens !== "undefined" ? _screens[key] : null;
      if (scr && scr.mode === "text") _drawScreenText(scr);
    }
  };
  const load = () =>
    document.fonts
      .load(`${COUNTDOWN_FONT_WEIGHT} 250px "${COUNTDOWN_FONT_FAMILY}"`, "READY SET GO!")
      .then(redraw)
      .catch(() => {});
  let link = document.querySelector("link[data-countdown-font]");
  if (!link) {
    link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Wix+Madefor+Display:wght@800&display=swap";
    link.dataset.countdownFont = "1";
    link.addEventListener("load", load);
    document.head.appendChild(link);
  } else {
    load();
  }
})();

function _drawScreenText(s) {
  const c = s.ctx2d;
  const w = SCREEN_CANVAS_W;
  const h = SCREEN_CANVAS_H;
  const bg = c.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#04050c");
  bg.addColorStop(1, "#0b0f26");
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = "rgba(120,140,255,0.07)";
  c.lineWidth = 2;
  for (let x = 0; x <= w; x += 64) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, h);
    c.stroke();
  }
  for (let y = 0; y <= h; y += 64) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(w, y);
    c.stroke();
  }
  // Pop-in: starts large and settles within ~0.25 s.
  const k = Math.min(1, s.textAge / 0.25);
  const ease = 1 - Math.pow(1 - k, 3);
  const scale = 1.35 - 0.35 * ease;
  c.save();
  c.globalAlpha = Math.min(1, 0.25 + ease);
  c.translate(w / 2, h / 2 + 8);
  c.scale(scale, scale);
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = COUNTDOWN_FONT;
  const label = String(s.text).toUpperCase();
  // 1) Coloured glow.
  c.shadowColor = s.color;
  c.shadowBlur = 70;
  c.fillStyle = s.color;
  c.fillText(label, 0, 0);
  c.shadowBlur = 0;
  // 2) White outline, then 3) the letters filled again on top: the font's
  // letters are built from overlapping shapes, so a stroke drawn over the fill
  // also traced the seams inside them. Filling last leaves only the outer edge.
  c.lineJoin = "round";
  c.lineWidth = 12;
  c.strokeStyle = "rgba(255,255,255,0.85)";
  c.strokeText(label, 0, 0);
  c.fillText(label, 0, 0);
  c.restore();
  s.tex.needsUpdate = true;
}

function showScreenText(key, text, color) {
  const s = _screens[key];
  if (!s) return;
  s.mode = "text";
  s.text = text;
  s.color = color;
  s.textAge = 0;
  _drawScreenText(s);
  s.mesh.material = s.textMat;
}

function showScreenReplay(key, texture) {
  const s = _screens[key];
  if (!s) return;
  s.mode = "replay";
  s.replayMat.map = texture;
  s.replayMat.needsUpdate = true;
  s.mesh.material = s.replayMat;
}

function restoreScreenContent(key) {
  const s = _screens[key];
  if (!s) return;
  s.mode = "content";
  s.mesh.material = s.contentMat;
}

const _glowTarget = new THREE.Color();

/** One averaged color for the screen's current content (no per-pixel sampling). */
function _screenGlowTargetColor(s, out) {
  if (s.mode === "text") return out.set(s.color);
  if (s.mode === "replay") return out.copy(SCREEN_GLOW_REPLAY_COLOR);
  if (!s.contentAvg) {
    const img = s.contentMat.map && s.contentMat.map.image;
    const avg = new THREE.Color();
    if (img && _averageImageColor(img, avg)) s.contentAvg = avg;
    else return null;
  }
  return out.copy(s.contentAvg);
}

/** Eases one screen's glow color / level toward its current content. */
function updateScreenGlow(s, dt) {
  if (!_screenGlowTargetColor(s, _glowTarget)) return false;
  const level =
    s.mode === "text"
      ? SCREEN_GLOW_TEXT_LEVEL
      : s.mode === "replay"
        ? SCREEN_GLOW_REPLAY_LEVEL
        : s.contentMat.emissiveIntensity / SCREEN_GLOW_REF_EMISSIVE;
  const targetI = SCREEN_GLOW_STRENGTH * level;
  if (!s.glowReady) {
    s.glowColor.copy(_glowTarget);
    s.glowInt = targetI;
    s.glowReady = true;
  } else {
    const k = 1 - Math.exp(-SCREEN_GLOW_EASE * Math.max(0, dt));
    s.glowColor.lerp(_glowTarget, k);
    s.glowInt += (targetI - s.glowInt) * k;
  }
  return true;
}

function updateScreensGlow(dt) {
  const g = _screensGlow;
  if (!g) return;
  const A = _screens.left || _screens.right;
  const B = _screens.right || _screens.left;
  const okA = updateScreenGlow(A, dt);
  const okB = B === A ? okA : updateScreenGlow(B, dt);
  if (!okA || !okB) {
    g.visible = false;
    return;
  }
  const u = g.material.uniforms;
  u.uColorA.value.copy(A.glowColor);
  u.uIntA.value = A.glowInt;
  u.uColorB.value.copy(B.glowColor);
  u.uIntB.value = B.glowInt;
  g.visible = true;
}

function updateArenaScreens(dt) {
  updateScreensGlow(dt);
  for (const key of ["left", "right"]) {
    const s = _screens[key];
    if (!s) continue;
    // Original content keeps following the light theme exactly as before.
    s.contentMat.emissiveIntensity = s.base.emissiveIntensity;

    if (s.mode === "text" && s.textAge < 0.3) {
      s.textAge += dt;
      _drawScreenText(s);
    }
  }
}

// ---------------------------------------------------------------------------
// Game start sequence: Bright → READY → SET → fade to Dark → GO! → live
// ---------------------------------------------------------------------------
const ARENA_INTRO_HOLD = 1.1;
// READY -> gameplay ≈ 2.4 s.
const ARENA_READY_TIME = 0.6;
const ARENA_SET_TIME = 0.6;
const ARENA_DUSK_TIME = 0.45;
const ARENA_GO_TIME = 0.75;
const ARENA_COLOR_READY = "#ff3b3b";
const ARENA_COLOR_SET = "#ffc43a";
const ARENA_COLOR_GO = "#3dff6e";

/** Keys the player car sees until GO! (nothing pressed). */
const _frozenPlayerKeys = {
  forward: false,
  reverse: false,
  left: false,
  right: false,
  brake: false,
};
keys = _frozenPlayerKeys;

const _arenaGame = { phase: "waiting", t: 0, live: false };

function _arenaSetPhase(phase) {
  _arenaGame.phase = phase;
  _arenaGame.t = 0;
}

function updateArenaGame(dt) {
  const g = _arenaGame;
  if (g.live || g.phase === "over") return;
  g.t += dt;
  if (g.phase !== "dusk" && g.phase !== "go") {
    // Hold Bright Mode until the fade.
    lightBlendTarget = 1;
  }
  switch (g.phase) {
    case "waiting": {
      const allReady =
        _meetingRoomSceneReady &&
        arenaCars.length === 1 + ARENA_AI_CARS.length &&
        arenaCars.every((c) => c.ready);
      if (allReady) _arenaSetPhase("intro");
      break;
    }
    case "intro":
      if (g.t > 0.2) warmUpArenaReplay();
      if (g.t >= ARENA_INTRO_HOLD) {
        showScreenText("left", "READY", ARENA_COLOR_READY);
        _arenaSetPhase("ready");
      }
      break;
    case "ready":
      if (g.t >= ARENA_READY_TIME) {
        restoreScreenContent("left");
        showScreenText("right", "SET", ARENA_COLOR_SET);
        _arenaSetPhase("set");
      }
      break;
    case "set":
      if (g.t >= ARENA_SET_TIME) _arenaSetPhase("dusk");
      break;
    case "dusk": {
      // Drive the existing light blend (1 = Bright, 0 = Dark) with an eased curve.
      const u = Math.min(1, g.t / ARENA_DUSK_TIME);
      const e = u * u * (3 - 2 * u);
      lightBlend = 1 - e;
      lightBlendTarget = lightBlend;
      applyLightBlend(lightBlend);
      if (u >= 1) {
        showScreenText("left", "GO!", ARENA_COLOR_GO);
        showScreenText("right", "GO!", ARENA_COLOR_GO);
        _arenaSetPhase("go");
      }
      break;
    }
    case "go":
      if (g.t >= ARENA_GO_TIME) {
        restoreScreenContent("left");
        restoreScreenContent("right");
        // Hand control to the player and the AI.
        if (_activeCarCtx === _playerCarCtx) keys = playerKeys;
        _playerCarCtx.keys = playerKeys;
        _arenaSetPhase("live");
        g.live = true;
      }
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Slow-motion replay of a car pushed off the tablePlate
// ---------------------------------------------------------------------------
const REPLAY_REC_HZ = 30;
const REPLAY_REC_SECONDS = 6;
const REPLAY_REC_N = REPLAY_REC_HZ * REPLAY_REC_SECONDS;
const REPLAY_PUSH_MIN_SPEED = 0.3;
/** A fall counts as a push-off if it starts this soon after the last car contact. */
const REPLAY_PUSH_WINDOW = 1.6;
const REPLAY_LEAD_IN = 0.5;
const REPLAY_TAIL = 1.0;
const REPLAY_SPEED = 0.35;
const REPLAY_RT_W = 640;
const REPLAY_RT_H = 360;

const _rec = {
  t: new Float64Array(REPLAY_REC_N),
  pose: null,
  head: 0,
  count: 0,
  acc: 0,
  cars: 0,
};
// ---------------------------------------------------------------------------
// Round: knock-offs, counter, last car standing, results popup, Play again
// ---------------------------------------------------------------------------
/** A car is knocked off once it is this far below the tabletop… */
const ARENA_KNOCKOFF_DROP = 0.18;
/** …or falling while this far outside the table's area (world units). */
const ARENA_KNOCKOFF_EDGE = 0.12;
/** Last knock-off → results popup (the fall can be seen first). */
const ARENA_ROUND_END_DELAY_SEC = 1.6;
/** The player is out → "You're out!" for this long, then the results. */
const ARENA_PLAYER_OUT_DELAY_SEC = 1.8;
/** Names / colours in the HUD and results (the player's car is the red one). */
const ARENA_PLAYER_NAME = "Red";
const ARENA_PLAYER_COLOR = 0xff2d55;

const _round = {
  hud: null,
  popup: null,
  time: 0, // round clock (live time)
  knocked: 0,
  endIn: -1, // countdown to the results (< 0: not scheduled)
  snapshot: null, // movable objects at the start (for Play again)
  openingView: null,
};

function _arenaCarName(c) {
  if (c.isPlayer) return ARENA_PLAYER_NAME;
  const cfg = ARENA_AI_CARS[arenaCars.indexOf(c) - 1];
  return cfg ? cfg.name.replace(/^ArenaCar/, "") : "Car";
}

function _arenaCarColor(c) {
  if (c.isPlayer) return ARENA_PLAYER_COLOR;
  const cfg = ARENA_AI_CARS[arenaCars.indexOf(c) - 1];
  return cfg ? cfg.color : 0xffffff;
}

function _hex(c) {
  return "#" + (c >>> 0).toString(16).padStart(6, "0");
}

/** Every AI car's inputs released (the AI leaves its last inputs held when it stops thinking). */
function _releaseArenaAiInputs() {
  for (const c of arenaCars) {
    if (!c.ai || !c.keys || c.keys === _frozenPlayerKeys) continue;
    for (const k of Object.keys(c.keys)) if (typeof c.keys[k] === "boolean") c.keys[k] = false;
  }
}

/** A knocked-off car that fell past the floor: parked out of the physics world. */
function parkKnockedOffCar() {
  const c = _activeCarCtx;
  if (c.parked) return;
  c.parked = true;
  if (carPhysBody) {
    carPhysBody.velocity.set(0, 0, 0);
    carPhysBody.angularVelocity.set(0, 0, 0);
  }
  car.visible = false;
}

/** The tablet / mic (and their cords), as they are at the start of a round. */
function _snapshotArenaObjects() {
  return _cabledObjects.map((O) => ({
    O,
    pos: O.body.position.clone(),
    quat: O.body.quaternion.clone(),
    cable: O.cable
      ? {
          pts: O.cable.pts.map((v) => v.clone()),
          prev: O.cable.prev.map((v) => v.clone()),
          anchors: O.cable.anchors.map((v) => v.clone()),
        }
      : null,
  }));
}

function _restoreArenaObjects(snap) {
  if (!snap) return;
  for (const it of snap) {
    const { O } = it;
    const b = O.body;
    b.position.copy(it.pos);
    b.previousPosition.copy(it.pos);
    b.interpolatedPosition.copy(it.pos);
    b.quaternion.copy(it.quat);
    b.previousQuaternion.copy(it.quat);
    b.interpolatedQuaternion.copy(it.quat);
    b.velocity.set(0, 0, 0);
    b.angularVelocity.set(0, 0, 0);
    b.force.set(0, 0, 0);
    b.torque.set(0, 0, 0);
    b.sleep();
    O.contactPrev.clear();
    _tabQ.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    O.group.position.copy(O.offset).applyQuaternion(_tabQ).add(_tabV0.set(b.position.x, b.position.y, b.position.z));
    O.group.quaternion.copy(_tabQ);
    if (O.cable && it.cable) {
      it.cable.pts.forEach((v, i) => O.cable.pts[i].copy(v));
      it.cable.prev.forEach((v, i) => O.cable.prev[i].copy(v));
      it.cable.anchors.forEach((v, i) => O.cable.anchors[i].copy(v));
      _cabledCableDraw(O);
      O.cable.active = false;
      O.cable.hangForce = 0;
    }
  }
  if (_cabled) _cabled.acc = 0;
}

function _ensureArenaUi() {
  const mount = getMeetingRoomSceneMount();
  if (!_round.hud) {
    _round.hud = new KnockoutHud();
    _round.popup = new RaceResultsPopup({
      retryLabel: "Play again",
      onRetry: () => playArenaAgain(),
      onNext: () => {
        const next = nextLevelPath(SCENE_ROUTES.meetingRoom);
        if (next) goToLevelWithTransition(next);
      },
    });
  }
  _round.hud.attach(mount);
  _round.popup.attach(mount);
}

/** Per frame: knock-offs (live), the counter, and the end of the round. */
function updateArenaRound(dt) {
  if (!_carReady || !Number.isFinite(tablePlateHalfX)) return;
  _ensureArenaUi();
  const g = _arenaGame;
  // Snapshot the start (objects at rest, the opening camera) once, before GO.
  if (!_round.snapshot && g.phase === "intro") {
    _round.snapshot = _snapshotArenaObjects();
    _round.openingView = { pos: camera.position.clone(), target: controls.target.clone() };
  }
  const ready = arenaCars.filter((c) => c.ready);
  _round.hud.setVisible(g.phase === "live" || g.phase === "over" || g.phase === "go");
  if (g.live) {
    _round.time += dt;
    _syncActiveCarCtx();
    for (const c of ready) {
      if (c.out) continue;
      const p = c.car.position;
      const st = c.carPhysState;
      const below = p.y < tableSurfaceY - ARENA_KNOCKOFF_DROP;
      const outside =
        Math.abs(p.x - tablePlateCenter.x) > tablePlateHalfX + ARENA_KNOCKOFF_EDGE ||
        Math.abs(p.z - tablePlateCenter.z) > tablePlateHalfZ + ARENA_KNOCKOFF_EDGE;
      const falling = st === CAR_PHYS.FALLING || st === CAR_PHYS.LANDED;
      if (!(below || (outside && falling))) continue;
      // Knocked off: counted once, out of play from now on.
      c.out = true;
      c.outT = _round.time;
      c.outOrder = ++_round.knocked;
      if (c.isPlayer) {
        _playerCarCtx.keys = _frozenPlayerKeys;
        if (_activeCarCtx === _playerCarCtx) keys = _frozenPlayerKeys;
        _round.hud.setBig("You're out!", "#ff3b6b");
        if (_round.endIn < 0) _round.endIn = ARENA_PLAYER_OUT_DELAY_SEC;
      }
    }
    const remaining = ready.filter((c) => !c.out).length;
    _round.hud.setCounts(_round.knocked, remaining);
    if (remaining <= 1 && _round.endIn < 0) _round.endIn = ARENA_ROUND_END_DELAY_SEC;
    if (_round.endIn >= 0) {
      _round.endIn -= dt;
      if (_round.endIn <= 0) endArenaRound();
    }
  } else if (g.phase !== "over") {
    _round.hud.setCounts(0, ready.length, true);
  }
}

/** Round over: stop the cars and the AI, and show the results. */
function endArenaRound() {
  const g = _arenaGame;
  g.live = false;
  _arenaSetPhase("over");
  _round.endIn = -1;
  _playerCarCtx.keys = _frozenPlayerKeys;
  if (_activeCarCtx === _playerCarCtx) keys = _frozenPlayerKeys;
  _releaseArenaAiInputs(); // the cars coast to a stop
  _round.hud.setBig("");
  const ready = arenaCars.filter((c) => c.ready);
  const standing = ready.filter((c) => !c.out);
  // Still on the table first, then the last knocked off before the earlier ones.
  const order = standing.concat(ready.filter((c) => c.out).sort((a, b) => b.outOrder - a.outOrder));
  const player = _playerCarCtx;
  const winner = standing.length === 1 ? standing[0] : null;
  let title;
  let color;
  let sub;
  if (winner && winner.isPlayer) {
    title = "You win!";
    color = "#4dff88";
    sub = `Last car standing · ${formatRaceTime(_round.time)}`;
  } else if (winner) {
    title = `${_arenaCarName(winner)} car wins`;
    color = _hex(_arenaCarColor(winner));
    sub = player.out ? `You were knocked off at ${formatRaceTime(player.outT)}` : "";
  } else if (player.out) {
    title = "You're out!";
    color = "#ff3b6b";
    sub = `Knocked off at ${formatRaceTime(player.outT)} · ${standing.length} cars still on the table`;
  } else {
    title = "No one left!";
    color = "#ffd23f";
    sub = "Every car went over the edge";
  }
  _round.popup.show({
    title,
    color,
    sub,
    nextEnabled: !!nextLevelPath(SCENE_ROUTES.meetingRoom),
    rows: order.map((c, i) => ({
      place: i + 1,
      name: _arenaCarName(c),
      color: _hex(_arenaCarColor(c)),
      isPlayer: !!c.isPlayer,
      time: c.out ? `Out ${formatRaceTime(c.outT)}` : c === winner ? "Winner" : "On the table",
    })),
  });
}

/** "Play again": every car back on its start, objects reset, the counter at 0, then READY / SET / GO. */
function playArenaAgain() {
  _round.popup.hide();
  _round.hud.setBig("");
  _round.time = 0;
  _round.knocked = 0;
  _round.endIn = -1;
  _syncActiveCarCtx();
  for (const c of arenaCars) {
    if (!c.ready) continue;
    c.out = false;
    c.outT = 0;
    c.outOrder = 0;
    c.parked = false;
    c.lastBumpT = -Infinity;
    c.lastCableHitT = -Infinity;
    c._prevPhysState = CAR_PHYS.DRIVING;
    withCar(c, () => {
      car.visible = true;
      respawnCarOnTable();
    });
    if (c.ai) c.ai = createArenaAiBrain();
  }
  _playerCarCtx.keys = _frozenPlayerKeys;
  if (_activeCarCtx === _playerCarCtx) keys = _frozenPlayerKeys;
  _releaseArenaAiInputs(); // held until GO, like the first round
  _restoreArenaObjects(_round.snapshot);
  // No replay carrying over; screens back to their content.
  _replay.pending = null;
  if (_replay.active) {
    _replay.active = false;
    restoreScreenContent(_replay.screen);
  }
  restoreScreenContent("left");
  restoreScreenContent("right");
  // The opening view, then the start sequence again (Bright → READY → SET → GO).
  _camDirector.active = false;
  if (_round.openingView) {
    camera.position.copy(_round.openingView.pos);
    controls.target.copy(_round.openingView.target);
    controls.update();
  }
  _round.hud.setCounts(0, arenaCars.filter((c) => c.ready).length, true);
  _arenaGame.live = false;
  _arenaSetPhase("intro");
}

const _replay = {
  pending: null,
  active: false,
  screen: null,
  nextScreen: Math.random() < 0.5 ? "left" : "right",
  t0: 0,
  t1: 0,
  playhead: 0,
  victim: 0,
  rt: null,
  camera: null,
  proxies: null,
  liveDrawables: null,
  hudScene: null,
  hudCamera: null,
  hudMat: null,
  look: new THREE.Vector3(),
  mid: new THREE.Vector3(),
  warmed: false,
};
const _repPos = new THREE.Vector3();
const _repQuatA = new THREE.Quaternion();
const _repQuatB = new THREE.Quaternion();

/** Called by the car-pair resolver: remember who last pushed whom (bookkeeping only). */
function noteCarContact(cA, cB, closingSpeed) {
  if (closingSpeed < REPLAY_PUSH_MIN_SPEED) return;
  const now = clock.elapsedTime;
  cA.lastBumpBy = cB;
  cA.lastBumpT = now;
  cB.lastBumpBy = cA;
  cB.lastBumpT = now;
}

function _recordArenaPoses(dt) {
  const n = arenaCars.length;
  if (!_rec.pose || _rec.cars !== n) {
    _rec.pose = new Float32Array(REPLAY_REC_N * n * 7);
    _rec.cars = n;
    _rec.head = 0;
    _rec.count = 0;
  }
  _rec.acc += dt;
  if (_rec.acc < 1 / REPLAY_REC_HZ) return;
  _rec.acc %= 1 / REPLAY_REC_HZ;
  const slot = _rec.head;
  _rec.t[slot] = clock.elapsedTime;
  for (let i = 0; i < n; i++) {
    const c = arenaCars[i].car;
    const o = (slot * n + i) * 7;
    _rec.pose[o] = c.position.x;
    _rec.pose[o + 1] = c.position.y;
    _rec.pose[o + 2] = c.position.z;
    _rec.pose[o + 3] = c.quaternion.x;
    _rec.pose[o + 4] = c.quaternion.y;
    _rec.pose[o + 5] = c.quaternion.z;
    _rec.pose[o + 6] = c.quaternion.w;
  }
  _rec.head = (slot + 1) % REPLAY_REC_N;
  _rec.count = Math.min(REPLAY_REC_N, _rec.count + 1);
}

function _recSlot(k) {
  // k = 0 is the oldest sample still in the buffer.
  return (_rec.head - _rec.count + k + REPLAY_REC_N) % REPLAY_REC_N;
}

function _recOldestTime() {
  return _rec.count ? _rec.t[_recSlot(0)] : Infinity;
}

/** Interpolated recorded pose of car i at time `time` (clamped to the buffer). */
function _sampleRecordedPose(i, time, outPos, outQuat) {
  const n = _rec.cars;
  if (!_rec.count) return false;
  let a = 0;
  let b = 0;
  for (let k = 0; k < _rec.count; k++) {
    const s = _recSlot(k);
    if (_rec.t[s] <= time) a = s;
    if (_rec.t[s] >= time) {
      b = s;
      break;
    }
    b = s;
  }
  const ta = _rec.t[a];
  const tb = _rec.t[b];
  const f = tb > ta ? THREE.MathUtils.clamp((time - ta) / (tb - ta), 0, 1) : 0;
  const oa = (a * n + i) * 7;
  const ob = (b * n + i) * 7;
  const P = _rec.pose;
  outPos.set(
    P[oa] + (P[ob] - P[oa]) * f,
    P[oa + 1] + (P[ob + 1] - P[oa + 1]) * f,
    P[oa + 2] + (P[ob + 2] - P[oa + 2]) * f,
  );
  _repQuatA.set(P[oa + 3], P[oa + 4], P[oa + 5], P[oa + 6]);
  _repQuatB.set(P[ob + 3], P[ob + 4], P[ob + 5], P[ob + 6]);
  outQuat.slerpQuaternions(_repQuatA, _repQuatB, f);
  return true;
}

function _ensureReplayResources() {
  const r = _replay;
  if (r.proxies) return true;
  if (!arenaCars.every((c) => c.ready)) return false;
  r.rt = new THREE.WebGLRenderTarget(REPLAY_RT_W, REPLAY_RT_H, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
  });
  r.camera = new THREE.PerspectiveCamera(42, REPLAY_RT_W / REPLAY_RT_H, 0.03, 60);
  // Stand-in copies of the cars for the replay: shared geometry/materials,
  // no lights / sparks / exhaust (so the scene's light count never changes).
  r.proxies = arenaCars.map((c) => {
    const p = c.car.clone(true);
    const drop = [];
    p.traverse((o) => {
      if (o === p) return;
      if (o.isLight || o.isPoints || o.isSprite || o.name === "carHitSpark") drop.push(o);
    });
    for (const o of drop) o.removeFromParent();
    p.visible = false;
    p.matrixAutoUpdate = true;
    scene.add(p);
    return p;
  });
  // Everything drawable on the live cars, hidden only while the replay frame renders.
  r.liveDrawables = arenaCars.map((c) => {
    const list = [];
    c.car.traverse((o) => {
      if (o.isMesh || o.isPoints || o.isSprite || o.isLine) list.push(o);
    });
    return list;
  });
  // HUD drawn into the replay frame: REPLAY tag, slow-motion label, letterbox.
  const hudCanvas = document.createElement("canvas");
  hudCanvas.width = REPLAY_RT_W;
  hudCanvas.height = REPLAY_RT_H;
  const hc = hudCanvas.getContext("2d");
  hc.clearRect(0, 0, REPLAY_RT_W, REPLAY_RT_H);
  hc.fillStyle = "rgba(0,0,0,0.85)";
  hc.fillRect(0, 0, REPLAY_RT_W, 26);
  hc.fillRect(0, REPLAY_RT_H - 26, REPLAY_RT_W, 26);
  hc.fillStyle = "#ff2a2a";
  hc.beginPath();
  hc.arc(30, 46, 8, 0, Math.PI * 2);
  hc.fill();
  hc.font = '900 22px "Arial Black", Impact, sans-serif';
  hc.textBaseline = "middle";
  hc.fillStyle = "#ffffff";
  hc.fillText("REPLAY", 46, 47);
  hc.font = '700 16px "Helvetica Neue", Arial, sans-serif';
  hc.textAlign = "right";
  hc.fillStyle = "rgba(255,255,255,0.9)";
  hc.fillText(`SLOW MOTION  ×${REPLAY_SPEED}`, REPLAY_RT_W - 18, REPLAY_RT_H - 13);
  const hudTex = new THREE.CanvasTexture(hudCanvas);
  hudTex.colorSpace = THREE.SRGBColorSpace;
  r.hudMat = new THREE.MeshBasicMaterial({
    map: hudTex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  r.hudScene = new THREE.Scene();
  r.hudScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), r.hudMat));
  r.hudCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return true;
}

function _renderReplayFrame(time) {
  const r = _replay;
  const n = arenaCars.length;
  const saved = [];
  for (let i = 0; i < n; i++) {
    for (const o of r.liveDrawables[i]) {
      saved.push(o.visible);
      o.visible = false;
    }
    const proxy = r.proxies[i];
    if (_sampleRecordedPose(i, time, proxy.position, proxy.quaternion)) proxy.visible = true;
  }
  const reflWas = tableReflector ? tableReflector.visible : false;
  if (tableReflector) tableReflector.visible = false;
  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  renderer.setRenderTarget(r.rt);
  renderer.autoClear = true;
  renderer.clear();
  renderer.render(scene, r.camera);
  // HUD stays readable through the screen's tone mapping at any exposure.
  r.hudMat.color.setScalar(1.25 / Math.max(0.2, renderer.toneMappingExposure));
  renderer.autoClear = false;
  renderer.render(r.hudScene, r.hudCamera);
  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAutoClear;
  if (tableReflector) tableReflector.visible = reflWas;
  let k = 0;
  for (let i = 0; i < n; i++) {
    for (const o of r.liveDrawables[i]) o.visible = saved[k++];
    r.proxies[i].visible = false;
  }
}

/** Compiles the replay render path once during the intro so the first replay has no hitch. */
function warmUpArenaReplay() {
  const r = _replay;
  if (r.warmed || !_ensureReplayResources()) return;
  r.warmed = true;
  _recordArenaPoses(1);
  r.camera.position.set(tablePlateCenter.x + 1.5, tableSurfaceY + 0.8, tablePlateCenter.z);
  r.camera.lookAt(tablePlateCenter.x, tableSurfaceY, tablePlateCenter.z);
  _renderReplayFrame(clock.elapsedTime);
}

function _detectPushOffFalls() {
  _syncActiveCarCtx();
  const now = clock.elapsedTime;
  for (let i = 0; i < arenaCars.length; i++) {
    const c = arenaCars[i];
    const st = c.carPhysState;
    const started = st === CAR_PHYS.FALLING && c._prevPhysState !== CAR_PHYS.FALLING;
    c._prevPhysState = st;
    if (!started || !_arenaGame.live || _replay.active || _replay.pending) continue;
    if (!(c.lastBumpT > -Infinity) || now - c.lastBumpT > REPLAY_PUSH_WINDOW) continue;
    // A cable strike after the last car contact means the cable caused it.
    if (c.lastCableHitT >= c.lastBumpT) continue;
    _replay.pending = {
      victim: i,
      t0: c.lastBumpT - REPLAY_LEAD_IN,
      fallT: now,
      t1: now + REPLAY_TAIL,
    };
  }
}

function _startReplay(p) {
  const r = _replay;
  if (!_ensureReplayResources()) return;
  r.victim = p.victim;
  r.t0 = Math.max(p.t0, _recOldestTime());
  r.t1 = p.t1;
  r.playhead = r.t0;
  // Frame the push and the fall from the side, slightly above the table.
  const impact = new THREE.Vector3();
  const fall = new THREE.Vector3();
  _sampleRecordedPose(r.victim, r.t0 + REPLAY_LEAD_IN, impact, _repQuatA);
  _sampleRecordedPose(r.victim, p.fallT, fall, _repQuatA);
  let dx = fall.x - impact.x;
  let dz = fall.z - impact.z;
  const dl = Math.hypot(dx, dz);
  if (dl < 1e-3) {
    dx = fall.x - tablePlateCenter.x;
    dz = fall.z - tablePlateCenter.z;
  }
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  let sx = -dz;
  let sz = dx;
  // Put the camera on the side facing the table centre (over the table).
  if (sx * (tablePlateCenter.x - fall.x) + sz * (tablePlateCenter.z - fall.z) < 0) {
    sx = -sx;
    sz = -sz;
  }
  r.mid.copy(impact).lerp(fall, 0.5);
  r.camera.position.set(
    r.mid.x + sx * 1.35 - dx * 0.35,
    tableSurfaceY + 0.62,
    r.mid.z + sz * 1.35 - dz * 0.35,
  );
  r.look.copy(r.mid);
  r.camera.lookAt(r.look);
  r.screen = r.nextScreen;
  r.nextScreen = r.screen === "left" ? "right" : "left";
  r.active = true;
  showScreenReplay(r.screen, r.rt.texture);
}

function updateArenaReplay(dt) {
  // After the round ends, a replay already under way still plays out.
  if (!_arenaGame.live && !(_arenaGame.phase === "over" && _replay.active)) return;
  _recordArenaPoses(dt);
  if (_arenaGame.live) _detectPushOffFalls();
  const r = _replay;
  if (!r.active && r.pending && clock.elapsedTime >= r.pending.t1 + 0.05) {
    const p = r.pending;
    r.pending = null;
    _startReplay(p);
  }
  if (!r.active) return;
  r.playhead += dt * REPLAY_SPEED;
  if (r.playhead >= r.t1) {
    r.active = false;
    restoreScreenContent(r.screen);
    return;
  }
  // Follow the pushed car (incl. its fall) with a gently lagging aim.
  _sampleRecordedPose(r.victim, r.playhead, _repPos, _repQuatA);
  _repPos.lerp(r.mid, 0.35);
  r.look.lerp(_repPos, Math.min(1, dt * 6));
  r.camera.lookAt(r.look);
  _renderReplayFrame(r.playhead);
}

// ---------------------------------------------------------------------------
// Paper airplane (ported from the office scene)
// Same model, material and flight logic as officeSceneModule.js. Every
// distance is scaled by k = this table / the office table, so the flight keeps
// its proportions, timing and banking; only the loop is fitted to this room.
// ---------------------------------------------------------------------------
/** Half-length of the office tablePlate the original flight was tuned for. */
const OFFICE_TABLE_HALF_X = 21.71;
/** Office plane cruised 11.1 units above its table top. */
const OFFICE_PLANE_CRUISE_ABOVE_TABLE = 11.11;
/** Loop size relative to the table (office used 1.5 × 0.6; 1.2 keeps clear of the orbit camera). */
const PLANE_LOOP_SCALE_X = 1.2;
const PLANE_LOOP_SCALE_Z = 0.6;
/** Model size relative to the office proportion (1 = same share of the table). */
const PLANE_MODEL_SCALE = 0.6;

let airPlaneModel = null;
/**
 * Lit paper material. The plane shares the room's own matte-white material
 * (same lights, Bright/Dark theme response and captured room reflection as the
 * other white objects); this fallback is only used if that is not available.
 */
const airPlaneFallbackMaterial = new THREE.MeshStandardMaterial({
  color: 0xf3f3f3,
  roughness: 0.88,
  metalness: 0,
  side: THREE.DoubleSide,
  envMap: _meetingRoomEnv,
  envMapIntensity: 0.28,
});
function _airPlaneMaterial() {
  return _themeMats.whiteMattPlastic || airPlaneFallbackMaterial;
}
const airPlaneFlight = {
  k: 1,
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
  pathBuilt: false,
};

function loadMeetingRoomAirPlane() {
  const loader = new GLTFLoader();
  loader.setResourcePath(_OFFICE_BASE);
  loader.load(
    officeAsset("airPlane2.gltf"),
    (gltf) => {
      const rawScene = gltf.scene;
      const paper = _airPlaneMaterial();
      if (paper === airPlaneFallbackMaterial && !_reflectiveMats.includes(paper)) {
        _reflectiveMats.push(paper);
      }
      rawScene.traverse((node) => {
        if (!node.isMesh) return;
        if (Array.isArray(node.material)) {
          for (let i = 0; i < node.material.length; i++) node.material[i] = paper;
        } else {
          node.material = paper;
        }
        node.castShadow = true;
        node.receiveShadow = true;
      });
      const box = new THREE.Box3().setFromObject(rawScene);
      const meshCenter = box.getCenter(new THREE.Vector3());
      airPlaneModel = new THREE.Group();
      airPlaneModel.name = "meetingRoomAirPlane";
      rawScene.position.sub(meshCenter);
      airPlaneModel.add(rawScene);
      scene.add(airPlaneModel);
      airPlaneFlight.pathBuilt = false;
    },
    undefined,
    (err) => console.warn("[MeetingRoom] airPlane2.gltf failed to load:", err),
  );
}

function buildAirPlanePath() {
  const fl = airPlaneFlight;
  if (fl.pathBuilt || !Number.isFinite(tablePlateHalfX) || tablePlateHalfX > 100) return;
  fl.pathBuilt = true;
  const k = tablePlateHalfX / OFFICE_TABLE_HALF_X;
  fl.k = k;
  airPlaneModel.scale.setScalar(k * PLANE_MODEL_SCALE);
  fl.speed = 10.0 * k;
  fl.yTarget = 2.0 * k;
  fl.baseY = tableSurfaceY + OFFICE_PLANE_CRUISE_ABOVE_TABLE * k;
  const tc = tablePlateCenter;
  const halfX = tablePlateHalfX;
  const halfZ = tablePlateHalfZ;
  const corners = [
    [tc.x - halfX * PLANE_LOOP_SCALE_X, tc.z - halfZ * PLANE_LOOP_SCALE_Z],
    [tc.x + halfX * PLANE_LOOP_SCALE_X, tc.z - halfZ * PLANE_LOOP_SCALE_Z],
    [tc.x + halfX * PLANE_LOOP_SCALE_X, tc.z + halfZ * PLANE_LOOP_SCALE_Z],
    [tc.x - halfX * PLANE_LOOP_SCALE_X, tc.z + halfZ * PLANE_LOOP_SCALE_Z],
  ];
  const R = 8.0 * k;
  const segs = [];
  const n = corners.length;
  const edgeDirs = [];
  for (let i = 0; i < n; i++) {
    const curr = corners[i];
    const next = corners[(i + 1) % n];
    const dx = next[0] - curr[0];
    const dz = next[1] - curr[1];
    const len = Math.sqrt(dx * dx + dz * dz);
    edgeDirs.push({ ux: dx / len, uz: dz / len, len });
  }
  for (let i = 0; i < n; i++) {
    const ed = edgeDirs[i];
    const straightLen = ed.len - 2 * R;
    const curr = corners[i];
    segs.push({
      type: "straight",
      sx: curr[0] + ed.ux * R,
      sz: curr[1] + ed.uz * R,
      ex: corners[(i + 1) % n][0] - ed.ux * R,
      ez: corners[(i + 1) % n][1] - ed.uz * R,
      dx: ed.ux,
      dz: ed.uz,
      len: Math.max(straightLen, 0),
    });
    const edNext = edgeDirs[(i + 1) % n];
    const cornerPt = corners[(i + 1) % n];
    const arcStart = [cornerPt[0] - ed.ux * R, cornerPt[1] - ed.uz * R];
    const arcEnd = [cornerPt[0] + edNext.ux * R, cornerPt[1] + edNext.uz * R];
    const inNx = -ed.uz;
    const inNz = ed.ux;
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
      cx,
      cz,
      r: R,
      startAngle,
      sweep,
      len: Math.abs(sweep) * R,
      turnSign: sign,
    });
  }
  fl.segments = segs;
  fl.totalLen = 0;
  for (const s of segs) fl.totalLen += s.len;
}

/** Office flight update, unchanged except that distances are multiplied by k. */
function updateMeetingRoomAirPlane(dt) {
  if (!airPlaneModel) return;
  if (!airPlaneFlight.pathBuilt) buildAirPlanePath();
  const fl = airPlaneFlight;
  if (!(fl.totalLen > 0)) return;
  const k = fl.k;
  const ySpd =
    fl.climbPitch !== undefined
      ? Math.abs(fl.yOffset - (fl._prevYOffset || fl.yOffset)) / Math.max(dt, 0.001)
      : 0;
  fl._prevYOffset = fl.yOffset;
  if (fl.speedVar === undefined) {
    fl.speedVar = 0;
    fl.speedTarget = 0;
    fl.speedTimer = 0;
  }
  fl.speedTimer += dt;
  if (fl.speedTimer > 2 + Math.random() * 3) {
    fl.speedTarget = (Math.random() - 0.5) * 3 * k;
    fl.speedTimer = 0;
  }
  fl.speedVar += (fl.speedTarget - fl.speedVar) * dt * 1.5;
  const curSpeed = fl.speed + fl.speedVar;
  const hSpd = Math.sqrt(Math.max(curSpeed * curSpeed - ySpd * ySpd, k * k));
  fl.t += hSpd * dt;
  if (fl.t >= fl.totalLen) fl.t -= fl.totalLen;
  if (fl.t < 0) fl.t += fl.totalLen;

  let rem = fl.t;
  let seg = fl.segments[0];
  let segIdx = 0;
  for (let i = 0; i < fl.segments.length; i++) {
    if (rem <= fl.segments[i].len) {
      seg = fl.segments[i];
      segIdx = i;
      break;
    }
    rem -= fl.segments[i].len;
  }

  fl.yTimer += dt;
  if (fl.yTimer >= fl.yDuration) {
    fl.yTarget = (0.5 + Math.random() * 3) * k;
    fl.yDuration = 1.5 + Math.random() * 2.5;
    fl.yTimer = 0;
    fl.yStart = fl.yOffset;
  }
  if (fl.yStart === undefined) fl.yStart = fl.yOffset;
  const prevY = fl.yOffset;
  if (seg.type === "straight") {
    const yProgress = Math.min(fl.yTimer / fl.yDuration, 1);
    const yEase =
      yProgress < 0.5
        ? 4 * yProgress * yProgress * yProgress
        : 1 - Math.pow(-2 * yProgress + 2, 3) / 2;
    fl.yOffset = fl.yStart + (fl.yTarget - fl.yStart) * yEase;
  }
  const yVel = (fl.yOffset - prevY) / Math.max(dt, 0.001);

  let px;
  let pz;
  let dirX;
  let dirZ;
  let turnAmount;
  const TURN_PITCH = (40 * Math.PI) / 180;
  const TURN_BANK = 0.2;
  const BLEND_ZONE = 3.0 * k;
  if (seg.type === "straight") {
    const frac = rem / seg.len;
    // Drift phase runs on office-scale distance so its rhythm is unchanged.
    const tu = fl.t / k;
    const drift = (Math.sin(tu * 0.7) * 0.4 + Math.sin(tu * 1.3) * 0.2) * k;
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

// ---------------------------------------------------------------------------
// Paper airplane tail trail: small glowing green dust that drops from the
// plane's tail in random bursts and floats down. The plane is one mesh with no
// tail part, so the tail point is the +X end of its bounding box (its local +X
// points backward: the wide trailing edge), on the centre line, taken to world
// space every frame. Particles live in world space: a small push backward from
// the tail, then soft gravity with air drag and a slow sideways drift. Most fade
// out in the air; some (the "landers") last until they reach the table top
// (measured from tablePlate at runtime), rest there a moment and fade out —
// over the floor instead they fade before getting low.
// ---------------------------------------------------------------------------
const PLANE_TRAIL_MAX = 600; // particle pool size
/** Random bursts: pause between bursts (seconds) and particles per burst. */
const PLANE_TRAIL_BURST_GAP_MIN = 0.3;
const PLANE_TRAIL_BURST_GAP_MAX = 2;
const PLANE_TRAIL_BURST_MIN = 8;
const PLANE_TRAIL_BURST_MAX = 30;
/** A burst streams out over this long (seconds, random per burst). */
const PLANE_TRAIL_BURST_DURATION_MIN = 0.5;
const PLANE_TRAIL_BURST_DURATION_MAX = 1.5;
const PLANE_TRAIL_BURST_RATE_WOBBLE = 0.4; // ± emission-rate variation within a burst
const PLANE_TRAIL_SINGLE_CHANCE = 0.07; // chance a "burst" is one lone particle
/** Particle size range, as fractions of the plane's length. */
const PLANE_TRAIL_SIZE_MIN = 0.035;
const PLANE_TRAIL_SIZE_MAX = 0.085;
/** Lifetime of particles that fade in the air (seconds). */
const PLANE_TRAIL_LIFE_MIN = 0.8;
const PLANE_TRAIL_LIFE_MAX = 2.8;
/** Initial push backward from the tail, in plane lengths per second (min..max). */
const PLANE_TRAIL_PUSH_MIN = 0.08;
const PLANE_TRAIL_PUSH_MAX = 0.4;
const PLANE_TRAIL_CONE = 0.5; // half-angle of the spread cone behind the tail (radians)
/** Soft fall: gravity (world units / s²), air drag (per second; terminal speed = g / drag). */
const PLANE_TRAIL_GRAVITY = 0.9;
const PLANE_TRAIL_DRAG = 1.6;
const PLANE_TRAIL_FALL_VARIATION = 0.4; // ± per-particle gravity variation
const PLANE_TRAIL_SIDE_DRIFT = 0.12; // slow sideways drift (world units / s²)
/** Share of particles that last until they reach the table. */
const PLANE_TRAIL_LAND_SHARE = 0.34; // about half fall past the table's edge: ~15–25% actually land
const PLANE_TRAIL_LAND_HOLD = 0.45; // seconds resting on the table before fading
const PLANE_TRAIL_LAND_FADE = 0.7; // seconds to fade out on the table
const PLANE_TRAIL_LAND_LIFT = 0.004; // rests this far above the table top
const PLANE_TRAIL_OFF_TABLE_FADE = 0.35; // landers past the table edge fade this fast
const PLANE_TRAIL_COLOR = 0x39ff6a; // glowing green
const PLANE_TRAIL_CORE_COLOR = 0xd8ffe4; // brighter, whiter centre
const PLANE_TRAIL_GLOW = 1.6; // overall glow intensity
const PLANE_TRAIL_BRIGHTNESS_MIN = 0.65; // per-particle random brightness (× glow)

let _planeTrail = null;
const _planeTailWorld = new THREE.Vector3();
const _planeBackWorld = new THREE.Vector3();
const _planeTrailVp = new THREE.Vector2();

function createAirPlaneTrail() {
  const P = PLANE_TRAIL_MAX;
  const geo = new THREE.BufferGeometry();
  const attr = (n, size, fill = 0) => {
    const a = new THREE.BufferAttribute(new Float32Array(P * size).fill(fill), size);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(n, a);
  };
  attr("position", 3);
  attr("aBirth", 1, -1e6);
  attr("aFadeStart", 1, -1e6); // fade-out runs from aFadeStart to aEnd (time)
  attr("aEnd", 1, -1e6);
  attr("aSize", 1);
  attr("aBright", 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uHalfHeight: { value: 400 },
      uColor: { value: new THREE.Color(PLANE_TRAIL_COLOR) },
      uCore: { value: new THREE.Color(PLANE_TRAIL_CORE_COLOR) },
      uGlow: { value: PLANE_TRAIL_GLOW },
    },
    vertexShader: `
      attribute float aBirth;
      attribute float aFadeStart;
      attribute float aEnd;
      attribute float aSize;
      attribute float aBright;
      uniform float uTime;
      uniform float uHalfHeight;
      varying float vAlpha;
      void main() {
        if (uTime < aBirth || uTime > aEnd) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); gl_PointSize = 0.0; vAlpha = 0.0; return; }
        float fadeIn = smoothstep(0.0, 0.12, uTime - aBirth);
        float out_ = clamp((uTime - aFadeStart) / max(0.001, aEnd - aFadeStart), 0.0, 1.0);
        float fadeOut = 1.0 - out_ * out_ * (3.0 - 2.0 * out_);
        vAlpha = fadeIn * fadeOut * aBright;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // Shrinks while it fades; world size → pixels with the rendering camera / target.
        float shrink = 1.0 - 0.6 * out_;
        gl_PointSize = aSize * shrink * projectionMatrix[1][1] * uHalfHeight / max(0.05, -mv.z);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uCore;
      uniform float uGlow;
      varying float vAlpha;
      void main() {
        // Soft round glow: gaussian falloff reaching zero at the edge (no rim, no square).
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d) * 4.0; // 0 at the centre, 1 at the edge
        float edge = 1.0 - smoothstep(0.35, 1.0, r2);
        float glow = exp(-r2 * 4.0) * edge;
        float centre = exp(-r2 * 14.0); // slightly brighter middle
        float a = (glow * 0.75 + centre * 0.5) * vAlpha * uGlow;
        if (a < 0.004) discard;
        vec3 col = mix(uColor, uCore, centre / max(0.001, glow + centre));
        gl_FragColor = vec4(col * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const points = new THREE.Points(geo, mat);
  points.name = "airPlaneTrailParticles";
  points.frustumCulled = false; // positions change in place: no stale culling
  points.renderOrder = 5;
  points.onBeforeRender = (r) => {
    const rt = r.getRenderTarget();
    const h = rt ? rt.height : r.getDrawingBufferSize(_planeTrailVp).y;
    mat.uniforms.uHalfHeight.value = h * 0.5;
  };
  scene.add(points);
  _planeTrail = {
    points,
    time: 0,
    next: 0,
    vel: new Float32Array(P * 3),
    drift: new Float32Array(P * 2), // sideways drift acceleration (x, z)
    grav: new Float32Array(P), // per-particle gravity
    lander: new Uint8Array(P), // 1: lasts until the table, 2: landed
    prevTail: new THREE.Vector3(),
    hasPrev: false,
    burstT: 0.4, // pause left before the next burst
    burstLeft: 0, // particles still to come in the current burst
    burstRate: 0,
    burstAcc: 0,
    burstAge: 0,
    burstPhase: 0,
    tailLocal: null,
    length: 1,
    table: null,
  };
}

/** The plane's tail point and backward direction in world space. */
function _airPlaneTail(T) {
  if (!T.tailLocal) {
    // Bounding box of the plane in its own (group) frame: +X end = tail.
    airPlaneModel.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(airPlaneModel.matrixWorld).invert();
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    airPlaneModel.traverse((o) => {
      if (!o.isMesh) return;
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
        box.expandByPoint(v);
      }
    });
    T.tailLocal = new THREE.Vector3(box.max.x, (box.min.y + box.max.y) * 0.5, (box.min.z + box.max.z) * 0.5);
    T.lengthLocal = box.max.x - box.min.x;
  }
  _planeTailWorld.copy(T.tailLocal);
  airPlaneModel.localToWorld(_planeTailWorld);
  _planeBackWorld.set(1, 0, 0).transformDirection(airPlaneModel.matrixWorld);
  T.length = T.lengthLocal * airPlaneModel.scale.x;
}

/** Table top height and area (from tablePlate's bounding box), measured once. */
function _airPlaneTrailTable(T) {
  if (T.table) return T.table;
  const mesh = _model && _model.getObjectByName("tablePlate");
  if (!mesh) return null;
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  T.table = { top: box.max.y, minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
  return T.table;
}

function _emitAirPlaneTrailParticle(T) {
  const i = T.next;
  T.next = (T.next + 1) % PLANE_TRAIL_MAX;
  const g = T.points.geometry;
  const L = T.length;
  const pos = g.attributes.position.array;
  pos[i * 3] = _planeTailWorld.x + (Math.random() - 0.5) * L * 0.06;
  pos[i * 3 + 1] = _planeTailWorld.y + (Math.random() - 0.5) * L * 0.06;
  pos[i * 3 + 2] = _planeTailWorld.z + (Math.random() - 0.5) * L * 0.06;
  // Initial push: backward, randomly tilted inside a small cone.
  const b = _planeBackWorld;
  let ax = -b.z;
  let az = b.x;
  const al = Math.hypot(ax, az) || 1;
  ax /= al;
  az /= al;
  const ux = b.y * az;
  const uy = b.z * ax - b.x * az;
  const uz = -b.y * ax;
  const ang = Math.random() * Math.PI * 2;
  const spread = Math.tan(PLANE_TRAIL_CONE) * Math.sqrt(Math.random());
  const sa = Math.cos(ang) * spread;
  const sb = Math.sin(ang) * spread;
  const dx = b.x + ax * sa + ux * sb;
  const dy = b.y + uy * sb;
  const dz = b.z + az * sa + uz * sb;
  const dl = Math.hypot(dx, dy, dz) || 1;
  const speed = L * (PLANE_TRAIL_PUSH_MIN + Math.random() * (PLANE_TRAIL_PUSH_MAX - PLANE_TRAIL_PUSH_MIN));
  T.vel[i * 3] = (dx / dl) * speed;
  T.vel[i * 3 + 1] = (dy / dl) * speed;
  T.vel[i * 3 + 2] = (dz / dl) * speed;
  const da = Math.random() * Math.PI * 2;
  T.drift[i * 2] = Math.cos(da) * PLANE_TRAIL_SIDE_DRIFT * (0.4 + Math.random() * 0.6);
  T.drift[i * 2 + 1] = Math.sin(da) * PLANE_TRAIL_SIDE_DRIFT * (0.4 + Math.random() * 0.6);
  // Landers are the ones that fall the fastest (they reach the lowest).
  const lander = Math.random() < PLANE_TRAIL_LAND_SHARE;
  const f = lander
    ? 1 + Math.random() * PLANE_TRAIL_FALL_VARIATION
    : 1 + (Math.random() * 2 - 1) * PLANE_TRAIL_FALL_VARIATION;
  T.grav[i] = PLANE_TRAIL_GRAVITY * f;
  T.lander[i] = lander ? 1 : 0;
  g.attributes.aBirth.array[i] = T.time;
  if (lander) {
    // No fade until it lands (or leaves the table's area low down).
    g.attributes.aFadeStart.array[i] = T.time + 1e5;
    g.attributes.aEnd.array[i] = T.time + 2e5;
  } else {
    const life = PLANE_TRAIL_LIFE_MIN + Math.random() * (PLANE_TRAIL_LIFE_MAX - PLANE_TRAIL_LIFE_MIN);
    g.attributes.aFadeStart.array[i] = T.time + life * 0.35;
    g.attributes.aEnd.array[i] = T.time + life;
  }
  g.attributes.aSize.array[i] = L * (PLANE_TRAIL_SIZE_MIN + Math.random() * (PLANE_TRAIL_SIZE_MAX - PLANE_TRAIL_SIZE_MIN));
  g.attributes.aBright.array[i] = PLANE_TRAIL_BRIGHTNESS_MIN + Math.random() * (1 - PLANE_TRAIL_BRIGHTNESS_MIN);
  for (const n of ["aBirth", "aFadeStart", "aEnd", "aSize", "aBright"]) g.attributes[n].needsUpdate = true;
}

/** Per frame (after the plane moved): random bursts from the tail, fall + land. */
function updateAirPlaneTrail(dt) {
  if (!airPlaneModel) return;
  if (!_planeTrail) createAirPlaneTrail();
  const T = _planeTrail;
  T.time += dt;
  T.points.material.uniforms.uTime.value = T.time;
  const table = _airPlaneTrailTable(T);
  const g = T.points.geometry;
  const pos = g.attributes.position.array;
  const birth = g.attributes.aBirth.array;
  const fadeStart = g.attributes.aFadeStart.array;
  const end = g.attributes.aEnd.array;
  const drag = Math.exp(-PLANE_TRAIL_DRAG * dt);
  let alive = false;
  let fadeChanged = false;
  for (let i = 0; i < PLANE_TRAIL_MAX; i++) {
    if (T.time > end[i] || T.time < birth[i]) continue;
    alive = true;
    if (T.lander[i] === 2) continue; // resting on the table
    const k3 = i * 3;
    // Soft fall: gravity + slow sideways drift, damped by air drag.
    T.vel[k3] = (T.vel[k3] + T.drift[i * 2] * dt) * drag;
    T.vel[k3 + 1] = (T.vel[k3 + 1] - T.grav[i] * dt) * drag;
    T.vel[k3 + 2] = (T.vel[k3 + 2] + T.drift[i * 2 + 1] * dt) * drag;
    pos[k3] += T.vel[k3] * dt;
    pos[k3 + 1] += T.vel[k3 + 1] * dt;
    pos[k3 + 2] += T.vel[k3 + 2] * dt;
    if (!table) continue;
    const overTable =
      pos[k3] >= table.minX && pos[k3] <= table.maxX && pos[k3 + 2] >= table.minZ && pos[k3 + 2] <= table.maxZ;
    const floorY = table.top + PLANE_TRAIL_LAND_LIFT;
    if (overTable && pos[k3 + 1] <= floorY) {
      // Reached the table: never through it. Landers rest, then fade.
      pos[k3 + 1] = floorY;
      T.vel[k3] = T.vel[k3 + 1] = T.vel[k3 + 2] = 0;
      if (T.lander[i] === 1) {
        T.lander[i] = 2;
        fadeStart[i] = T.time + PLANE_TRAIL_LAND_HOLD;
        end[i] = fadeStart[i] + PLANE_TRAIL_LAND_FADE;
      } else {
        end[i] = Math.min(end[i], T.time + 0.25);
        fadeStart[i] = Math.min(fadeStart[i], T.time);
      }
      fadeChanged = true;
    } else if (!overTable && pos[k3 + 1] < table.top + T.length * 0.5 && end[i] > T.time + PLANE_TRAIL_OFF_TABLE_FADE) {
      // Past the table's edge and getting low: fade out well above the floor.
      T.lander[i] = 0;
      fadeStart[i] = Math.min(fadeStart[i], T.time);
      end[i] = T.time + PLANE_TRAIL_OFF_TABLE_FADE;
      fadeChanged = true;
    }
  }
  if (alive) g.attributes.position.needsUpdate = true;
  if (fadeChanged) {
    g.attributes.aFadeStart.needsUpdate = true;
    g.attributes.aEnd.needsUpdate = true;
  }

  airPlaneModel.updateMatrixWorld(true);
  _airPlaneTail(T);
  const moving = T.hasPrev && T.prevTail.distanceTo(_planeTailWorld) > 1e-5;
  T.prevTail.copy(_planeTailWorld);
  T.hasPrev = true;
  if (!moving) return; // the plane stopped: no new particles
  // Random bursts (timers on dt): a pause, then a short stream of dust from the
  // tail (its particles spread over the burst's duration at a wobbling rate),
  // or now and then a single lone particle.
  if (T.burstLeft > 0) {
    T.burstAge += dt;
    const wobble = 1 + PLANE_TRAIL_BURST_RATE_WOBBLE * Math.sin(T.burstPhase + T.burstAge * 9.0) * Math.sin(T.burstPhase * 1.7 + T.burstAge * 4.3);
    T.burstAcc += T.burstRate * Math.max(0.2, wobble) * dt;
    while (T.burstAcc >= 1 && T.burstLeft > 0) {
      T.burstAcc -= 1;
      T.burstLeft--;
      _emitAirPlaneTrailParticle(T);
    }
    // Rate wobble can leave a remainder at the end: finish the burst on time.
    if (T.burstAge >= T.burstDuration && T.burstLeft > 0) {
      while (T.burstLeft > 0) {
        T.burstLeft--;
        _emitAirPlaneTrailParticle(T);
      }
    }
    if (T.burstLeft === 0) {
      T.burstT = PLANE_TRAIL_BURST_GAP_MIN + Math.random() * (PLANE_TRAIL_BURST_GAP_MAX - PLANE_TRAIL_BURST_GAP_MIN);
    }
    return;
  }
  T.burstT -= dt;
  if (T.burstT > 0) return;
  if (Math.random() < PLANE_TRAIL_SINGLE_CHANCE) {
    _emitAirPlaneTrailParticle(T);
    T.burstT = PLANE_TRAIL_BURST_GAP_MIN + Math.random() * (PLANE_TRAIL_BURST_GAP_MAX - PLANE_TRAIL_BURST_GAP_MIN);
    return;
  }
  const n = PLANE_TRAIL_BURST_MIN + Math.floor(Math.random() * (PLANE_TRAIL_BURST_MAX - PLANE_TRAIL_BURST_MIN + 1));
  T.burstDuration = PLANE_TRAIL_BURST_DURATION_MIN + Math.random() * (PLANE_TRAIL_BURST_DURATION_MAX - PLANE_TRAIL_BURST_DURATION_MIN);
  T.burstLeft = n;
  T.burstRate = n / T.burstDuration;
  T.burstAcc = 1; // the first particle comes out right away
  T.burstAge = 0;
  T.burstPhase = Math.random() * Math.PI * 2;
}

// ---------------------------------------------------------------------------
// Collision camera shake (render-only offset; never touches the orbit)
// ---------------------------------------------------------------------------
/** Closing speeds below this are resting contact / scraping: no shake. */
const SHAKE_MIN_IMPACT = 0.18;
/** Closing speed (m/s) that adds a full trauma kick. */
const SHAKE_FULL_IMPACT = 4.5;
const SHAKE_TRAUMA_MAX = 0.85;
const SHAKE_DECAY = 2.6;
/** Wobble speed multiplier (higher = faster shake). */
const SHAKE_FREQ = 1.7;
/** Immediate jolt on impact: share of max offset, and how fast it dies (1/s). */
const SHAKE_PUNCH = 0.7;
const SHAKE_PUNCH_DECAY = 26;
const SHAKE_MAX_POS = 0.03;
const SHAKE_MAX_YAW = THREE.MathUtils.degToRad(0.45);
const SHAKE_MAX_PITCH = THREE.MathUtils.degToRad(0.45);
const SHAKE_MAX_ROLL = THREE.MathUtils.degToRad(0.8);

const _camShake = {
  trauma: 0,
  punch: 0,
  punchSide: 1,
  punchRoll: 1,
  frameImpact: 0,
  time: 0,
  applied: false,
  savedPos: new THREE.Vector3(),
  savedQuat: new THREE.Quaternion(),
  // Random phases so every session's shake pattern differs.
  phase: Array.from({ length: 10 }, () => Math.random() * Math.PI * 2),
};
const _shakeRight = new THREE.Vector3();
const _shakeUp = new THREE.Vector3();
const _shakeEuler = new THREE.Euler(0, 0, 0, "YXZ");
const _shakeQuat = new THREE.Quaternion();

/** Called by the car-pair resolver with each contact's pre-impact closing speed. */
function noteCameraImpact(closingSpeed) {
  if (closingSpeed > _camShake.frameImpact) _camShake.frameImpact = closingSpeed;
}

/** Smooth, organic noise in [-1, 1]: two incommensurate sines per channel. */
function _shakeNoise(i, t) {
  const p = _camShake.phase;
  return (
    0.62 * Math.sin(t * SHAKE_FREQ * (11.3 + i * 1.7) + p[i]) +
    0.38 * Math.sin(t * SHAKE_FREQ * (17.9 + i * 2.3) + p[(i + 5) % 10])
  );
}

function applyCameraShake(dt) {
  const s = _camShake;
  // One kick per frame from the strongest impact (several resolver passes /
  // sub-steps and simultaneous collisions can't stack up), saturating add so
  // close-together hits blend instead of compounding.
  if (s.frameImpact > SHAKE_MIN_IMPACT) {
    const kick = THREE.MathUtils.clamp(
      (s.frameImpact - SHAKE_MIN_IMPACT) / (SHAKE_FULL_IMPACT - SHAKE_MIN_IMPACT),
      0,
      1,
    );
    s.trauma = Math.min(SHAKE_TRAUMA_MAX, s.trauma + kick * (1 - s.trauma));
    // Sharp onset: a one-off jolt sized like the shake itself (kick²).
    const jolt = Math.min(SHAKE_TRAUMA_MAX, kick) ** 2;
    if (jolt > s.punch) {
      s.punch = jolt;
      s.punchSide = Math.random() < 0.5 ? -1 : 1;
      s.punchRoll = Math.random() < 0.5 ? -1 : 1;
    }
  }
  s.frameImpact = 0;
  if (s.trauma <= 0 && s.punch <= 0) return;
  s.trauma = Math.max(0, s.trauma - SHAKE_DECAY * dt);
  s.time += dt;
  const amt = s.trauma * s.trauma;
  const punch = s.punch;
  s.punch = punch > 1e-4 ? punch * Math.exp(-SHAKE_PUNCH_DECAY * dt) : 0;
  if (amt < 1e-5 && punch < 1e-4) return;
  s.savedPos.copy(camera.position);
  s.savedQuat.copy(camera.quaternion);
  s.applied = true;
  const t = s.time;
  _shakeRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _shakeUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
  const jolt = SHAKE_PUNCH * punch;
  camera.position
    .addScaledVector(
      _shakeRight,
      SHAKE_MAX_POS * (amt * _shakeNoise(0, t) + jolt * 0.5 * s.punchSide),
    )
    .addScaledVector(_shakeUp, SHAKE_MAX_POS * (0.8 * amt * _shakeNoise(1, t) - jolt));
  _shakeEuler.set(
    SHAKE_MAX_PITCH * (amt * _shakeNoise(2, t) - jolt * 0.4),
    SHAKE_MAX_YAW * amt * _shakeNoise(3, t),
    SHAKE_MAX_ROLL * (amt * _shakeNoise(4, t) + jolt * 0.6 * s.punchRoll),
  );
  _shakeQuat.setFromEuler(_shakeEuler);
  camera.quaternion.multiply(_shakeQuat);
  camera.updateMatrixWorld();
}

/** Restores the exact pre-shake camera so controls / orbit never see the offset. */
function clearCameraShake() {
  const s = _camShake;
  if (!s.applied) return;
  camera.position.copy(s.savedPos);
  camera.quaternion.copy(s.savedQuat);
  camera.updateMatrixWorld();
  s.applied = false;
}

// ---------------------------------------------------------------------------
// Dev-only performance overlay: add ?perf to the URL in `npm run dev`.
// Compiled out of production builds (import.meta.env.DEV is false there).
// ---------------------------------------------------------------------------
const _mrPerf = MR_PERF
  ? {
      el: null,
      t0: performance.now(),
      loadMs: 0,
      frames: 0,
      cpuMs: 0,
      calls: 0,
      tris: 0,
      acc: 0,
      frameStart: 0,
      last: null,
    }
  : null;

/** Dev-only (?perf): lets a measurement hold the scene still for a fair A/B. */
if (MR_PERF) {
  window.__mrPerfCtl = {
    holdIntro() {
      _arenaGame.t = -1e9;
    },
    get phase() {
      return _arenaGame.phase;
    },
    scene,
    camera,
    controls,
    screenGlows: _screenGlowMeshes,
    screenLights: _screenAreaLights,
  };
}

function _perfBeginFrame() {
  const p = _mrPerf;
  if (!p.el) {
    renderer.info.autoReset = false;
    p.el = document.createElement("pre");
    p.el.style.cssText =
      "position:fixed;left:8px;top:8px;z-index:99999;margin:0;padding:6px 8px;" +
      "font:11px/1.35 ui-monospace,Menlo,monospace;color:#9fe;background:rgba(0,0,0,.7);" +
      "pointer-events:none;white-space:pre";
    document.body.appendChild(p.el);
  }
  renderer.info.reset();
  p.frameStart = performance.now();
}

function _perfEndFrame(dt) {
  const p = _mrPerf;
  p.frames += 1;
  p.cpuMs += performance.now() - p.frameStart;
  p.calls += renderer.info.render.calls;
  p.tris += renderer.info.render.triangles;
  p.acc += dt;
  if (!p.loadMs && _arenaGame.phase !== "waiting") p.loadMs = performance.now() - p.t0;
  if (p.acc < 0.5) return;
  const n = p.frames;
  const mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + " MB" : "n/a";
  p.last = {
    fps: n / p.acc,
    cpuMs: p.cpuMs / n,
    calls: p.calls / n,
    tris: p.tris / n,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs ? renderer.info.programs.length : 0,
    heap: mem,
    loadMs: p.loadMs,
  };
  window.__mrPerf = p.last;
  const L = p.last;
  p.el.textContent =
    `fps ${L.fps.toFixed(1)}  cpu ${L.cpuMs.toFixed(2)} ms/frame\n` +
    `draws ${L.calls.toFixed(0)}  tris ${(L.tris / 1000).toFixed(1)}k\n` +
    `geo ${L.geometries}  tex ${L.textures}  programs ${L.programs}\n` +
    `heap ${L.heap}  load ${(L.loadMs / 1000).toFixed(2)} s`;
  p.frames = 0;
  p.cpuMs = 0;
  p.calls = 0;
  p.tris = 0;
  p.acc = 0;
}

function animate() {
  _meetingRoomSceneAnimationFrame = 0;
  if (!_meetingRoomSceneRendering) return;
  _meetingRoomSceneAnimationFrame = requestAnimationFrame(animate);
  if (MR_PERF) _perfBeginFrame();
  const dt = Math.min(clock.getDelta(), 0.05);
  const lightBlendDelta = lightBlendTarget - lightBlend;
  if (Math.abs(lightBlendDelta) > 0.0001) {
    lightBlend += lightBlendDelta * Math.min(1, dt / LIGHT_FADE_DURATION);
    if (Math.abs(lightBlendTarget - lightBlend) <= 0.0001) {
      lightBlend = lightBlendTarget;
    }
    applyLightBlend(lightBlend);
  }
  const carDt = 1 / 60;
  let carTimeLeft = dt;
  updateArenaGame(dt);
  if (_arenaGame.live) updateArenaAi(dt);
  for (let s = 0; s < 3 && carTimeLeft > 0; s++) {
    const step = Math.min(carDt, carTimeLeft);
    for (let i = 0; i < arenaCars.length; i++) {
      const c = arenaCars[i];
      if (c.ready || c === _playerCarCtx) withCar(c, () => updateCar(step));
    }
    resolveArenaCarCollisions();
    carTimeLeft -= step;
  }
  stepCarPhysics(dt);
  resolveArenaCarCollisions();
  updateArenaRound(dt);
  syncCarCamera();
  updateCameraDirector(dt);
  updateTableLightReflections();
  updateCarShadowLight();
  updateArenaCable(dt);
  updateArenaCarEffects(dt);
  updateMeetingRoomAirPlane(dt);
  updateAirPlaneTrail(dt);
  updateCabledObjects(dt);
  if (_fireSensorLightMat) {
    const pulse =
      0.16 + 0.84 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 1.65));
    _fireSensorLightMat.color.setRGB(0.04 * pulse, pulse, 0.12 * pulse);
  }
  updateArenaScreens(dt);
  updateArenaReplay(dt);
  controls.update();
  applyCameraShake(dt);
  renderer.render(scene, camera);
  clearCameraShake();
  if (MR_PERF) _perfEndFrame(dt);
}

export function setMeetingRoomSceneRendering(active) {
  const shouldRender = Boolean(active);
  if (!shouldRender) {
    _meetingRoomSceneRendering = false;
    if (_meetingRoomSceneAnimationFrame) {
      cancelAnimationFrame(_meetingRoomSceneAnimationFrame);
      _meetingRoomSceneAnimationFrame = 0;
    }
    return;
  }
  if (_meetingRoomSceneRendering) return;
  _meetingRoomSceneRendering = true;
  clock.getDelta();
  animate();
}

loadMeetingRoom();
setMeetingRoomSceneRendering(true);
