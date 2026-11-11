import * as THREE from "three";
import * as CANNON from "cannon-es";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import { getMeetingRoomSceneMount } from "./meetingRoomSceneMount.js";
import { emitMeetingRoomSceneEvent } from "../game/meetingRoomSceneEvents.js";

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

const AXES_SIZE = 1.6;
const axesGroup = new THREE.Group();
axesGroup.name = "MeetingRoomAxes";
const axesHelper = new THREE.AxesHelper(AXES_SIZE);
axesHelper.renderOrder = 9998;
axesGroup.add(axesHelper);

function makeAxisLabel(text, hexColor) {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, 64, 64);
  ctx.font = "bold 52px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#000000";
  ctx.strokeText(text, 32, 32);
  ctx.fillStyle = "#" + ("000000" + hexColor.toString(16)).slice(-6);
  ctx.fillText(text, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    depthTest: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.32, 0.32, 1);
  sprite.renderOrder = 9999;
  return sprite;
}

const axisLabelX = makeAxisLabel("X", 0xff0000);
axisLabelX.position.set(AXES_SIZE, 0, 0);
axesGroup.add(axisLabelX);
const axisLabelY = makeAxisLabel("Y", 0x00ff00);
axisLabelY.position.set(0, AXES_SIZE, 0);
axesGroup.add(axisLabelY);
const axisLabelZ = makeAxisLabel("Z", 0x0000ff);
axisLabelZ.position.set(0, 0, AXES_SIZE);
axesGroup.add(axisLabelZ);
scene.add(axesGroup);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 1, 0);
controls.keys = { LEFT: "", UP: "", RIGHT: "", BOTTOM: "" };
controls.listenToKeyEvents = () => {};

let _model = null;
let _freeCable = null;
const clock = new THREE.Clock();

const darkMode = {
  background: 0x03040c,
  ambient: { color: 0xe8e2d8, intensity: 0.012 },
  hemisphere: { sky: 0xd8dce0, ground: 0x9a9084, intensity: 0.045 },
  dirPink: { color: 0x9b3dff, intensity: 0.1 },
  dirBlue: { color: 0x3ec8ff, intensity: 0.16 },
  dirFillPink: { color: 0xb026ff, intensity: 0.08 },
  dirFillBlue: { color: 0x4d8cff, intensity: 0.06 },
  pointPink: { color: 0x9b3dff, intensity: 0.06 },
  pointBlue: { color: 0x3ec8ff, intensity: 0.08 },
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
const EXPOSURE_BRIGHT = 0.86;
const LIGHT_FADE_DURATION = 0.2;
const _legacyDarkLightsScale = 1;
let lightBlend = 0;
let lightBlendTarget = 0;
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
  if (carKeyLight) {
    _cDark.setHex(0x66e8ff);
    _cBright.setHex(0xfff4e8);
    carKeyLight.color.lerpColors(_cDark, _cBright, b);
    carKeyLight.intensity = blendChannel(0.85, 1.85, b);
    _cDark.setHex(0x9b3dff);
    _cBright.setHex(0xffe8d0);
    carRimLight.color.lerpColors(_cDark, _cBright, b);
    carRimLight.intensity = blendChannel(0.5, 0.7, b);
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
    creamWall.color.copy(_themeMats.creamWallBright);
    creamWall.envMapIntensity = blendChannel(0.08, 0.22, b);
  }
  if (_themeMats.glossyBoard && _themeMats.glossyBoardBright) {
    _themeMats.glossyBoard.color.copy(_themeMats.glossyBoardBright);
    _themeMats.glossyBoard.roughness = blendChannel(0.18, 0.1, b);
    _themeMats.glossyBoard.envMapIntensity = blendChannel(0.22, 1.45, b);
    _themeMats.glossyBoard.clearcoat = blendChannel(0.4, 0.72, b);
  }
  if (_themeMats.whitePaintMetal && _themeMats.whitePaintMetalBright) {
    _themeMats.whitePaintMetal.color.copy(_themeMats.whitePaintMetalBright);
    _themeMats.whitePaintMetal.envMapIntensity = blendChannel(0.35, 1.15, b);
  }
  if (_themeMats.whiteMattPlastic && _themeMats.whiteMattPlasticBright) {
    _themeMats.whiteMattPlastic.color.copy(_themeMats.whiteMattPlasticBright);
  }
  if (_themeMats.creamCeiling && _themeMats.creamCeilingBright) {
    _themeMats.creamCeiling.color.copy(_themeMats.creamCeilingBright);
    if (_themeMats.creamCeilingEmissiveBright) {
      _themeMats.creamCeiling.emissive.copy(_themeMats.creamCeilingEmissiveBright);
    }
    _themeMats.creamCeiling.emissiveIntensity = blendChannel(0.02, 0.18, b);
  }
  if (_themeMats.whiteMattPaint && _themeMats.whiteMattBright) {
    _themeMats.whiteMattPaint.color.copy(_themeMats.whiteMattBright);
    if (_themeMats.whiteMattEmissiveBright) {
      _themeMats.whiteMattPaint.emissive.copy(_themeMats.whiteMattEmissiveBright);
    }
    _themeMats.whiteMattPaint.emissiveIntensity = blendChannel(0.04, 0.2, b);
  }
  if (_themeMats.whiteVisibleLight && _themeMats.whiteLightEmissiveBright) {
    _themeMats.whiteVisibleLight.emissive.copy(_themeMats.whiteLightEmissiveBright);
    _themeMats.whiteVisibleLight.emissiveIntensity = blendChannel(0.7, 3.3, b);
  }
  if (_themeMats.floor && _themeMats.floorColorBright) {
    _themeMats.floor.color.copy(_themeMats.floorColorBright);
    _themeMats.floor.emissive.setHex(0x000000);
    _themeMats.floor.emissiveIntensity = 0;
    _themeMats.floor.envMapIntensity = blendChannel(0.08, 0.18, b);
  }
  if (_themeMats.wallWood && _themeMats.wallWoodBright) {
    _themeMats.wallWood.color.copy(_themeMats.wallWoodBright);
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
  BUMP: "BUMP",
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
const PHYS_GROUP_TABLE = 1;
const PHYS_GROUP_FLOOR = 2;
const PHYS_GROUP_CAR = 4;
const CAR_BUMP_RESTITUTION = 0.58;
const CAR_BUMP_SEPARATE = 0.012;
const ARENA_AI_COLORS = [0x1ec8ff, 0xffc43a];
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
const car = new THREE.Group();
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
const carState = {
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
const keys = {
  forward: false,
  reverse: false,
  left: false,
  right: false,
  brake: false,
};
let halfW = 0.6;
let halfL = 1.0;
let storedCarScale = 0.5;
let carBottomOffsetY = 0;
let tableSurfaceY = 0;
let tablePlateHalfX = Infinity;
let tablePlateHalfZ = Infinity;
const tablePlateCenter = new THREE.Vector3();
const tableSpawn = new THREE.Vector3();
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
const _impactKickDir = new THREE.Vector3();
const _carSparkA = new THREE.Vector3();
const _carSparkB = new THREE.Vector3();
let _cableHitLatched = false;
let _cableHitCool = 0;
let _cableTipPrevValid = false;
let floorTopY = 0;
let _physAcc = 0;
const carPhysLocalCenter = new THREE.Vector3();
const carPhysHalf = new THREE.Vector3();
const _physOffset = new THREE.Vector3();
const _cableTipWorld = new THREE.Vector3();
const _cableTipPrev = new THREE.Vector3();
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
const arenaCars = [];
const _bumpDelta = new THREE.Vector3();
const _bumpVelA = new THREE.Vector3();
const _bumpVelB = new THREE.Vector3();
const _bumpN = new THREE.Vector3();
let _playerCarVisual = null;
let _playerCarInst = null;
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
  if (e.code === "KeyW" || e.code === "ArrowUp") keys.forward = true;
  if (e.code === "KeyS" || e.code === "ArrowDown") keys.reverse = true;
  if (e.code === "KeyA" || e.code === "ArrowLeft") keys.left = true;
  if (e.code === "KeyD" || e.code === "ArrowRight") keys.right = true;
  if (e.code === "Space") keys.brake = true;
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
    if (_model) frameMeetingRoomInterior(_model);
  }
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
    physicsWorld.addContactMaterial(
      new CANNON.ContactMaterial(_carPhysMaterial, _carPhysMaterial, {
        friction: 0.12,
        restitution: CAR_BUMP_RESTITUTION,
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
  const vx = Math.sin(carState.angle) * carState.speed;
  const vz = Math.cos(carState.angle) * carState.speed;
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
  carState.angle = 0;
  carState._brakeTime = 0;
  car.position.copy(tableSpawn);
  car.quaternion.identity();
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

function stepCarPhysics(dt) {
  if (!physicsWorld || !carPhysBody) return;
  if (
    carPhysState !== CAR_PHYS.FALLING &&
    carPhysState !== CAR_PHYS.LANDED &&
    carPhysState !== CAR_PHYS.IMPACT
  ) {
    _physAcc = 0;
    return;
  }
  if (carPhysState === CAR_PHYS.IMPACT) applyImpactCoastDamping();
  _physAcc += dt;
  _physAcc = Math.min(_physAcc, 0.08);
  while (_physAcc >= PHYS_FIXED_DT) {
    if (carPhysState === CAR_PHYS.IMPACT) applyImpactCoastDamping();
    physicsWorld.step(PHYS_FIXED_DT);
    if (carPhysState === CAR_PHYS.IMPACT) applyImpactYawHeading(PHYS_FIXED_DT);
    _physAcc -= PHYS_FIXED_DT;
  }
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
    if (carFloorTimer >= CAR_FLOOR_RESPAWN_SEC) respawnCarOnTable();
  }
  if (car.position.y < floorTopY - 4) respawnCarOnTable();
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
      fitCarShadowCamera();
      for (const ef of exhaustEffects) {
        ef.points.scale.setScalar(kitchenMatchedFlameVisualScale());
        ef.points.material.uniforms.uSize.value = kitchenMatchedFlameSize();
      }
      carState.maxSpeed = Math.max(1.8, Math.min(4.8, tableMinSize * 0.85));
      const spawnX = tablePlateCenter.x;
      const spawnZ = tablePlateCenter.z;
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
      attachCarHeadTailSpotLights(car);
      setupTableLightReflections(car);
      setupCarHitSparks();
      _carFollowCam = false;
      controls.enabled = true;
      controls.minDistance = 0.4;
      controls.maxDistance = 12;
      if (_model) frameMeetingRoomInterior(_model);
      _carReady = true;
      applyLightBlend(lightBlend);
    },
    undefined,
    (err) => console.error("[MeetingRoom] Car GLTF load failed.", err),
  );
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

function placeAxesOnTable(root) {
  const table = root.getObjectByName("tablePlate");
  if (!table) return;
  table.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(table);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  axesGroup.position.set(center.x, box.max.y + 0.02, center.z);
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
    light.position.set(center.x + 0.08, center.y, center.z);
    light.lookAt(tableAim.x, tableAim.y, tableAim.z);
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
  const restoreReflectorHelpers = (axesWas) => {
    axesGroup.visible = axesWas;
    table.visible = true;
    if (tableBase) tableBase.visible = true;
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
    const axesWas = axesGroup.visible;
    axesGroup.visible = false;
    table.visible = false;
    if (tableBase) tableBase.visible = false;
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
      restoreReflectorHelpers(axesWas);
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
    restoreReflectorHelpers(axesWas);
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
  const snap = _sparkPts.slice(0, snapN * 3);
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
    radius: extent * 0.58,
    jagMax: extent * 0.09,
    minLen: extent * 0.035,
    width: 7.2,
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
      _carSparkA.sub(center).multiplyScalar(1.12).add(center);
      _carSparkB.sub(center).multiplyScalar(1.1).add(center);
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
  spark.boltMat.uniforms.uIntensity.value = live;
  spark.boltMat.uniforms.uFlash.value = spark.flash * crackle;
  spark.boltMat.uniforms.uWidth.value = spark.width * (0.9 + 0.28 * crackle);
  spark.boltMat.uniforms.uOpacity.value = Math.min(
    1,
    fade * (0.55 + live * 0.6 + spark.flash * 0.25),
  );
  spark.boltMat.uniforms.uGlow.value =
    fade * (0.55 + live * 0.5 + spark.flash * 0.4);
  const worldScale = Math.max(0.02, car.scale.x);
  spark.light.intensity =
    fade *
    (live * 0.32 + spark.flash * 0.65) *
    crackle *
    (1.15 - lightBlend * 0.35);
  spark.light.distance = Math.max(0.45, spark.radius * worldScale * 16);
  spark.quadCount = 0;
  const minY = tableSurfaceY + 0.003;
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
  if (dt > 0) updateCableCarImpact(dt);
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
  axesGroup.visible = false;
  if (tableReflector) tableReflector.visible = false;
  const sparkGroup = _freeCable && _freeCable.spark && _freeCable.spark.group;
  const carSparkGroup = _carHitSpark && _carHitSpark.group;
  const carSparkWas = carSparkGroup ? carSparkGroup.visible : false;
  if (sparkGroup) sparkGroup.visible = false;
  if (carSparkGroup) carSparkGroup.visible = false;
  cubeCam.update(renderer, scene);
  if (sparkGroup) sparkGroup.visible = true;
  if (carSparkGroup) carSparkGroup.visible = carSparkWas;
  if (tableReflector) tableReflector.visible = true;
  axesGroup.visible = true;
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
  camera.position.set(target.x + 3.8, target.y + 0.9, target.z);
  controls.target.copy(target);
  controls.minDistance = 0.4;
  controls.maxDistance = 12;
  controls.update();
}

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
        scene.add(_model);
        captureTableDriveSurface(_model);
        setupFreeCableAssembly(_model);
        attachMainPanelLights(_model);
        attachScreenLights(_model);
        attachTablePlateKeyLight(_model);
        attachTabletSideLight(_model);
        repeatWallPatternAlongX(_model, "wallRightPattern", "wallRight");
        repeatWallPatternAlongX(_model, "wallLeftPattern", "wallLeft");
        repeatWallPatternAlongZ(_model, "wallFrontPattern", "wallFront");
        repeatWallLeftPatternAlongNegZ(_model);
        frameMeetingRoomInterior(_model);
        placeAxesOnTable(_model);
        setupTablePlateReflector(_model);
        applyLightBlend(lightBlend);
        loadKitchenCarOnTable();
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

function animate() {
  _meetingRoomSceneAnimationFrame = 0;
  if (!_meetingRoomSceneRendering) return;
  _meetingRoomSceneAnimationFrame = requestAnimationFrame(animate);
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
  for (let s = 0; s < 3 && carTimeLeft > 0; s++) {
    const step = Math.min(carDt, carTimeLeft);
    updateCar(step);
    carTimeLeft -= step;
  }
  stepCarPhysics(dt);
  syncCarCamera();
  updateExhaustEffects(dt);
  updateTableLightReflections();
  updateCarShadowLight();
  updateFreeCableAssembly(dt);
  updateCarHitSparks(dt);
  if (_fireSensorLightMat) {
    const pulse =
      0.16 + 0.84 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 1.65));
    _fireSensorLightMat.color.setRGB(0.04 * pulse, pulse, 0.12 * pulse);
  }
  controls.update();
  renderer.render(scene, camera);
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
