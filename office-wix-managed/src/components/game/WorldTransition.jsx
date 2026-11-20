import { useEffect, useRef } from "react";
import { Label, Panel, Snap } from "./ui/ui.jsx";
import "./ui/loaders.css";
import { createCameraDrag } from "./cameraDrag.js";
import { startTransitionStrips, stripSequenceAt, STRIP_SEQUENCE } from "./transitionStrips.js";

const TRANSITION_DURATION = 8600;
const TRANSITION_STRIP_COLORS = [
  "#0c6efc", // Wix Blue
  "#2a82ff", // lighter blue
  "#674fe6", // purple
  "#ff7055", // peach
  "#faad4d", // amber
];
const TRANSITION_STRIPS = Array.from({ length: 120 }, (_, index) => {
  const seed = (index * 47) % 131;
  return {
    angle: (index * 137.508) % 360,
    color: TRANSITION_STRIP_COLORS[index % TRANSITION_STRIP_COLORS.length],
    delay: -((index * 0.113) % 3.6),
    duration: 1.25 + (seed % 19) * 0.045,
    length: 12 + (seed % 25),
    start: 1 + (seed % 12),
    width: 2 + (seed % 3),
  };
});

/** Caption eyebrow (the kitchen is the game's second level / "page"). */
const CAPTION_EYEBROW = "Page 02 · Kitchen";
/** Caption entrance delay (ms). */
const CAPTION_DELAY_MS = 200;
/**
 * The mouse camera drag (cameraDrag.js, "kitchenTransition") is off this long
 * before the transition ends (ms): it springs back to the fixed angle in time.
 */
const CAMERA_DRAG_END_MS = 1200; // the spring is exactly back at zero in ~1 s
/**
 * The car's pass, after the lines' release (transitionStrips.js STRIP_SEQUENCE):
 * hidden until the lines reach full speed, then it rushes in from deep in the
 * tunnel (a few px at the vanishing point) and flies through the camera with
 * the punch: a fast entrance easing to a short hover, then accelerating through
 * (see `entrance`). Its distance runs on a log scale (even growth on screen),
 * crossing zero and going behind.
 */
const CAR_PASS = {
  startAt: STRIP_SEQUENCE.fullAt, // s after the scene starts: as the lines hit full speed (the punch)
  duration: 3.2, // s, from deep in the tunnel to just behind the camera (was 0.95, 1.6, then 2.6: +0.6 s seen clearly)
  from: 1200, // distance in front of the camera at the start (world units: the car is 4.8 long → ~6 px; was 2500)
  to: -12, // distance at the end (behind the camera, out of view)
  curveOffset: 20, // shapes the approach: distance = (from + c)·((to + c)/(from + c))^g − c
  /**
   * The entrance's easing (g above, over time u): it rushes in from deep in the tunnel and eases out to a
   * hover at `hangDistance` (world units, ~130 px wide) at `hangAt` of the pass, keeping `keep` of its speed
   * there, then eases in and accelerates through the camera.
   */
  entrance: { hangAt: 0.6, hangDistance: 22, keep: 0.15 }, // hangAt was 0.55
  /**
   * Motion blur while the car is on screen: each frame is the average of renders of the car spread over the
   * last `shutter` seconds of its motion (a film camera's open shutter; was 1/30 s). Enough renders that the
   * car's edge moves at most `stepPx` screen px between two of them, within min/max; where even `maxSamples`
   * aren't enough (right at the camera) the shutter is shortened instead (down to `minShutter`), so the smear stays smooth.
   */
  motionBlur: { shutter: 1 / 12, minShutter: 1 / 40, stepPx: 4, minSamples: 8, maxSamples: 32, edge: 2.4 }, // edge: world units off-axis
  /**
   * The car is seen sharp first: no blur during its rush in and its hover, then `sharpExtra` s more; then the
   * shutter grows from 0 to full over `easeIn` s as it accelerates (sharp → blurred, never switched on).
   */
  blurIn: { sharpExtra: 0.3, easeIn: 0.4 },
  /**
   * The moment it passes the camera: field of view +6° and the lines' glow +70%, as a smooth bump this wide
   * (s, the bump's half width), then exactly back to normal.
   */
  impact: { fov: 6, glow: 0.7, width: 0.28 },
};
/** The car's distance in front of the camera at pass progress u (0 → 1). */
function carPassDistance(u) {
  const { from, to, curveOffset: c, entrance: E } = CAR_PASS;
  const ratio = (to + c) / (from + c);
  const gHang = Math.log((E.hangDistance + c) / (from + c)) / Math.log(ratio);
  const x = Math.min(Math.max(u, 0), 1);
  let g;
  if (x < E.hangAt) {
    const s = x / E.hangAt; // fast in, easing out to the hover
    g = gHang * (E.keep * s + (1 - E.keep) * (1 - (1 - s) ** 3));
  } else {
    const s = (x - E.hangAt) / (1 - E.hangAt); // easing in from the hover, accelerating through the camera
    g = gHang + (1 - gHang) * (E.keep * s + (1 - E.keep) * s ** 3);
  }
  return (from + c) * Math.pow(ratio, g) - c;
}
{
  let lo = 0, hi = 1; // the moment it passes the camera (distance 0)
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (carPassDistance(mid) > 0) lo = mid; else hi = mid;
  }
  CAR_PASS.passAt = CAR_PASS.startAt + lo * CAR_PASS.duration;
}
/** 0 → 1: how much of the motion blur's shutter is open at scene time t (eased in after the hover). */
const carBlurAt = (t) => {
  const start = CAR_PASS.startAt + CAR_PASS.entrance.hangAt * CAR_PASS.duration + CAR_PASS.blurIn.sharpExtra;
  const u = Math.min(1, Math.max(0, (t - start) / CAR_PASS.blurIn.easeIn));
  return u * u * (3 - 2 * u);
};
/** 0 → 1 → 0 around the moment the car passes the camera. */
const carImpactAt = (t) => Math.exp(-(((t - CAR_PASS.passAt) / CAR_PASS.impact.width) ** 2));
/** The light bar copies on the car's roof, as in the other scenes (lightBarBody1 + lightBar1, 2 on each side). */
const CAR_LIGHT_BAR_COPIES = { perSide: 2, spacing: 1.6 };

export default function WorldTransition({ onComplete, description }) {
  const stageRef = useRef(null);
  const stripsRef = useRef(null);
  const sceneStartRef = useRef(0); // the lines' sequence and the car share this clock
  if (!sceneStartRef.current) sceneStartRef.current = performance.now();
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const timer = window.setTimeout(
      () => onCompleteRef.current?.(),
      TRANSITION_DURATION,
    );
    return () => window.clearTimeout(timer);
  }, []);

  // The flying coloured lines (drawn on a canvas: always complete on screen).
  useEffect(
    () =>
      startTransitionStrips(stripsRef.current, TRANSITION_STRIPS, sceneStartRef.current, {
        glowAt: (t) => 1 + CAR_PASS.impact.glow * carImpactAt(t), // the lines flare as the car passes
      }),
    [],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let disposed = false;
    let animationFrame = 0;
    const mountedAt = performance.now();
    let cameraDrag = null;
    let resizeObserver = null;
    let renderer = null;
    let carPivot = null;
    let lightPipe = null;
    let updateLightPipe = () => {};
    let disposeObject = () => {};
    let disposeBlur = () => {};

    Promise.all([
      import("three"),
      import("three/addons/loaders/GLTFLoader.js"),
    ]).then(([THREE, { GLTFLoader }]) => {
      if (disposed) return;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, CAR_PASS.from + 100); // far: the car's start is in view (was 100)
      camera.position.set(0, 0, 7.5);

      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.72;
      renderer.setClearColor(0x000000, 0);
      stage.appendChild(renderer.domElement);
      // Drag to orbit round the scene's centre; never changes the transition's timing.
      const cameraDragTarget = new THREE.Vector3(0, 0, 0);
      cameraDrag = createCameraDrag({
        THREE,
        element: renderer.domElement,
        scene: "kitchenTransition",
        isEnabled: () => performance.now() - mountedAt < TRANSITION_DURATION - CAMERA_DRAG_END_MS,
      });

      scene.add(new THREE.HemisphereLight(0xbce8ff, 0x33125c, 0.8));
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
      keyLight.position.set(4, 6, 5);
      scene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0x7c4dff, 3);
      rimLight.position.set(-5, 2, -4);
      scene.add(rimLight);

      const resize = () => {
        const width = Math.max(1, stage.clientWidth);
        const height = Math.max(1, stage.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(stage);
      resize();

      disposeObject = (object) => {
        object.traverse((node) => {
          node.geometry?.dispose?.();
          const materials = Array.isArray(node.material)
            ? node.material
            : [node.material];
          materials.forEach((material) => {
            if (!material) return;
            Object.values(material).forEach((value) => {
              if (value?.isTexture) value.dispose();
            });
            material.dispose?.();
          });
        });
      };

      const stripCount = 220;
      const drawerPortalColors = [
        0x165dff,
        0x2090ff,
        0x715cff,
        0xff319d,
        0xd52cff,
      ];
      const stripStates = [];
      const corePositions = new Float32Array(stripCount * 4 * 3);
      const glowPositions = new Float32Array(stripCount * 4 * 3);
      const stripColors = new Float32Array(stripCount * 4 * 3);
      const stripIndices = new Uint16Array(stripCount * 6);
      const drawerPortalColorObjects = drawerPortalColors.map(
        (color) => new THREE.Color(color),
      );
      const stripCarLights = [];

      for (let i = 0; i < stripCount; i++) {
        const vertex = i * 4;
        const offset = i * 6;
        stripIndices.set(
          [vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3],
          offset,
        );
      }

      const createStripGeometry = (positions) => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(positions, 3).setUsage(
            THREE.DynamicDrawUsage,
          ),
        );
        geometry.setAttribute(
          "color",
          new THREE.BufferAttribute(stripColors, 3),
        );
        geometry.setIndex(new THREE.BufferAttribute(stripIndices, 1));
        return geometry;
      };
      const coreGeometry = createStripGeometry(corePositions);
      const glowGeometry = createStripGeometry(glowPositions);
      const coreStrips = new THREE.Mesh(
        coreGeometry,
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 1,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      const glowStrips = new THREE.Mesh(
        glowGeometry,
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.3,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      coreStrips.frustumCulled = false;
      glowStrips.frustumCulled = false;
      coreStrips.renderOrder = 2;
      glowStrips.renderOrder = 1;
      lightPipe = new THREE.Group();
      lightPipe.add(glowStrips, coreStrips);

      const writeStripQuad = (
        positions,
        index,
        x,
        y,
        z,
        length,
        angle,
        halfWidth,
      ) => {
        const offset = index * 12;
        const widthX = -Math.sin(angle) * halfWidth;
        const widthY = Math.cos(angle) * halfWidth;
        const farZ = z - length * 0.5;
        const nearZ = z + length * 0.5;
        positions.set(
          [
            x - widthX,
            y - widthY,
            farZ,
            x + widthX,
            y + widthY,
            farZ,
            x + widthX,
            y + widthY,
            nearZ,
            x - widthX,
            y - widthY,
            nearZ,
          ],
          offset,
        );
      };

      const resetStrip = (index, initial) => {
        const state = stripStates[index] || {};
        state.angle = Math.random() * Math.PI * 2;
        state.radius = 1.1 + Math.random() * 3.8;
        state.z = initial ? -36 + Math.random() * 42 : -42 - Math.random() * 12;
        state.speed = 8 + Math.random() * 26;
        state.length = 6 + Math.random() * 14;
        state.wobble = 0.25 + Math.random() * 1.1;
        state.phase = Math.random() * Math.PI * 2;
        state.colorIndex = Math.floor(
          Math.random() * drawerPortalColorObjects.length,
        );
        stripStates[index] = state;

        const color = drawerPortalColorObjects[state.colorIndex];
        for (let vertex = 0; vertex < 4; vertex++) {
          const colorOffset = (index * 4 + vertex) * 3;
          stripColors[colorOffset] = color.r;
          stripColors[colorOffset + 1] = color.g;
          stripColors[colorOffset + 2] = color.b;
        }
      };
      for (let i = 0; i < stripCount; i++) resetStrip(i, true);
      coreGeometry.attributes.color.needsUpdate = true;
      glowGeometry.attributes.color.needsUpdate = true;

      updateLightPipe = (delta, elapsed, speedEase = 0) => {
        for (let i = 0; i < stripCount; i++) {
          const state = stripStates[i];
          state.z += state.speed * delta;
          if (state.z > 6.5) {
            resetStrip(i, false);
          }
          const angle =
            state.angle + Math.sin(elapsed * state.wobble + state.phase) * 0.08;
          const x = Math.cos(angle) * state.radius;
          const y = Math.sin(angle) * state.radius * 0.62;
          const length = state.length * (1 + speedEase * 1.2);
          writeStripQuad(
            corePositions,
            i,
            x,
            y,
            state.z,
            length,
            angle,
            0.045,
          );
          writeStripQuad(
            glowPositions,
            i,
            x,
            y,
            state.z,
            length,
            angle,
            0.13,
          );
        }
        coreGeometry.attributes.position.needsUpdate = true;
        glowGeometry.attributes.position.needsUpdate = true;
        coreGeometry.attributes.color.needsUpdate = true;
        glowGeometry.attributes.color.needsUpdate = true;
      };

      const loader = new GLTFLoader();
      loader.load(
        `${import.meta.env.BASE_URL}office-scene-optimized/car-game14.glb`,
        (gltf) => {
          if (disposed) {
            disposeObject(gltf.scene);
            return;
          }
          const car = gltf.scene;
          const chromeMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xc8ccd0,
            metalness: 0.9,
            roughness: 0.14,
            clearcoat: 1,
            clearcoatRoughness: 0.06,
            emissive: 0x707478,
            emissiveIntensity: 0.08,
          });
          const redPaintMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xc8102e,
            metalness: 0.4,
            roughness: 0.22,
            clearcoat: 1,
            clearcoatRoughness: 0.06,
          });
          const lightMaterial = (color, intensity, roughness = 0.25) =>
            new THREE.MeshStandardMaterial({
              color,
              emissive: color,
              emissiveIntensity: intensity,
              roughness,
              toneMapped: true,
            });

          car.traverse((node) => {
            const name = node.name || "";
            if (/^canon(?:-|$)/i.test(name) || /physic/i.test(name)) {
              node.visible = false;
              return;
            }
            if (!node.isMesh) return;
            node.visible = true;
            node.castShadow = true;
            if (name === "mainRearBrakeLights") {
              node.material = lightMaterial(0x440000, 1.1, 0.2);
            } else if (name === "lightBar1") {
              node.material = lightMaterial(0xff0000, 18, 0.15);
            } else if (name === "frontLights") {
              node.material = lightMaterial(0xffffff, 6.5, 0.3);
            } else if (name === "rearLights") {
              node.material = lightMaterial(0xff0000, 2, 0.3);
            } else if (
              name === "frontLightCase" ||
              name === "rearLightCase"
            ) {
              node.material = new THREE.MeshStandardMaterial({
                color: 0x111111,
                metalness: 0,
                roughness: 0.7,
              });
            } else if (name === "egzoz") {
              node.material = new THREE.MeshStandardMaterial({
                color: 0xcccccc,
                metalness: 1,
                roughness: 0.05,
              });
            } else if (name === "airInBase") {
              node.material = chromeMaterial;
            } else if (/^airIn[123]$/.test(name)) {
              node.material = redPaintMaterial;
            }
          });

          // The light bar and its copies, as in the other scenes (same glowing material on each copy).
          car.updateMatrixWorld(true);
          const lbBody = car.getObjectByName("lightBarBody1");
          const lbLight = car.getObjectByName("lightBar1");
          if (lbBody && lbLight) {
            const parent = lbBody.parent;
            const group = new THREE.Group();
            const lbBox = new THREE.Box3().setFromObject(lbBody).expandByObject(lbLight);
            const center = parent.worldToLocal(lbBox.getCenter(new THREE.Vector3()));
            group.position.copy(center);
            parent.add(group);
            for (const part of [lbBody, lbLight]) {
              part.position.sub(center);
              parent.remove(part);
              group.add(part);
            }
            const lbSize = lbBox.getSize(new THREE.Vector3());
            const spacing = Math.max(lbSize.x, lbSize.z);
            for (let side = -1; side <= 1; side += 2) {
              for (let i = 1; i <= CAR_LIGHT_BAR_COPIES.perSide; i++) {
                const copy = group.clone(true);
                copy.position.x += side * i * spacing * CAR_LIGHT_BAR_COPIES.spacing;
                parent.add(copy);
              }
            }
          }

          const box = new THREE.Box3().setFromObject(car);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const scale = 4.8 / Math.max(size.x, size.y, size.z, 0.001);
          car.position.sub(center);
          car.scale.setScalar(scale);

          carPivot = new THREE.Group();
          carPivot.visible = false; // until its pass
          carPivot.rotation.set(0.08, -0.62, -0.03);
          carPivot.add(car);
          [
            { color: 0x2090ff, position: [-3.2, 1.4, 1.5] },
            { color: 0xff319d, position: [3.2, 1.1, 0.5] },
            { color: 0x715cff, position: [0, -1.8, 1.8] },
            { color: 0xd52cff, position: [0, 2.6, -1.5] },
            { color: 0x165dff, position: [-1.4, 0.2, 3.2] },
            { color: 0xff319d, position: [1.6, 0.4, -3] },
          ].forEach(({ color, position }) => {
            const light = new THREE.PointLight(color, 8, 20, 1.45);
            light.position.set(...position);
            carPivot.add(light);
            stripCarLights.push(light);
          });
          scene.add(carPivot);
        },
      );

      /** The car's place on its pass at scene time `time` (s). */
      const placeCar = (time) => {
        const passU = (time - CAR_PASS.startAt) / CAR_PASS.duration;
        carPivot.visible = passU >= 0 && passU <= 1;
        carPivot.position.z = camera.position.z - carPassDistance(passU);
        carPivot.position.x = 0;
        carPivot.position.y = Math.sin(time * 2.8) * 0.035;
        carPivot.rotation.y = 0;
        carPivot.rotation.z = Math.sin(time * 2.1) * 0.008;
      };
      // Motion blur: the car rendered at several moments of the shutter into a render target, averaged
      // (premultiplied, so its edges blend into the transparent canvas), then tone mapped to the screen.
      const blurSize = renderer.getDrawingBufferSize(new THREE.Vector2());
      const blurOptions = { type: THREE.HalfFloatType, depthBuffer: true };
      const blurSample = new THREE.WebGLRenderTarget(blurSize.x, blurSize.y, { ...blurOptions, samples: 4 });
      const blurSum = new THREE.WebGLRenderTarget(blurSize.x, blurSize.y, { ...blurOptions, depthBuffer: false });
      const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const quadVertex = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
      const addMaterial = new THREE.ShaderMaterial({
        uniforms: { map: { value: null }, weight: { value: 1 } },
        vertexShader: quadVertex,
        fragmentShader: "uniform sampler2D map; uniform float weight; varying vec2 vUv; void main() { gl_FragColor = texture2D(map, vUv) * weight; }",
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      const outputMaterial = new THREE.ShaderMaterial({
        uniforms: { map: { value: blurSum.texture } },
        vertexShader: quadVertex,
        fragmentShader: [
          "uniform sampler2D map; varying vec2 vUv;",
          "void main() {",
          "  vec4 c = texture2D(map, vUv);",
          "  gl_FragColor = vec4(c.a > 0.0 ? c.rgb / c.a : vec3(0.0), c.a);", // straight colour for tone mapping
          "  #include <tonemapping_fragment>",
          "  #include <colorspace_fragment>",
          "  gl_FragColor.rgb *= gl_FragColor.a;", // back to premultiplied for the canvas
          "}",
        ].join("\n"),
        blending: THREE.NoBlending,
        depthTest: false,
        depthWrite: false,
      });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), addMaterial);
      const quadScene = new THREE.Scene();
      quadScene.add(quad);
      const renderMotionBlurred = (time) => {
        const size = renderer.getDrawingBufferSize(blurSize);
        if (blurSample.width !== size.x || blurSample.height !== size.y) {
          blurSample.setSize(size.x, size.y);
          blurSum.setSize(size.x, size.y);
        }
        const { stepPx, minSamples, maxSamples, edge } = CAR_PASS.motionBlur;
        // How far (screen px) the car's edge moves over the shutter.
        const pxAt = (x) => {
          const d = Math.max(0.6, carPassDistance((x - CAR_PASS.startAt) / CAR_PASS.duration));
          return (edge * stage.clientHeight) / (2 * Math.tan((camera.fov * Math.PI) / 360) * d);
        };
        let shutter = CAR_PASS.motionBlur.shutter * carBlurAt(time);
        let samples = Math.ceil(Math.abs(pxAt(time) - pxAt(time - shutter)) / stepPx);
        if (samples > maxSamples) {
          const floor = Math.min(shutter, CAR_PASS.motionBlur.minShutter);
          for (let k = 0; k < 20 && samples > maxSamples && shutter > floor; k++) {
            shutter = Math.max(floor, shutter * 0.8);
            samples = Math.ceil(Math.abs(pxAt(time) - pxAt(time - shutter)) / stepPx);
          }
        }
        samples = shutter > 0 ? Math.min(maxSamples, Math.max(minSamples, samples)) : 1; // sharp: one render
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.setRenderTarget(blurSum);
        renderer.clear();
        quad.material = addMaterial;
        addMaterial.uniforms.map.value = blurSample.texture;
        addMaterial.uniforms.weight.value = 1 / samples;
        for (let i = 0; i < samples; i++) {
          placeCar(time - (shutter * i) / Math.max(1, samples - 1));
          renderer.setRenderTarget(blurSample);
          renderer.clear();
          renderer.render(scene, camera);
          renderer.setRenderTarget(blurSum);
          renderer.render(quadScene, quadCamera);
        }
        placeCar(time);
        renderer.setRenderTarget(null);
        renderer.clear();
        quad.material = outputMaterial;
        renderer.render(quadScene, quadCamera);
        renderer.autoClear = autoClear;
      };
      disposeBlur = () => {
        blurSample.dispose();
        blurSum.dispose();
        addMaterial.dispose();
        outputMaterial.dispose();
        quad.geometry.dispose();
      };

      const startedAt = sceneStartRef.current;
      const baseFov = camera.fov;
      let previousFrame = startedAt;
      const animate = (now) => {
        if (disposed) return;
        const elapsed = (now - startedAt) / 1000;
        const delta = Math.min((now - previousFrame) / 1000, 0.05);
        previousFrame = now;
        const stripEase = Math.pow(Math.min(elapsed / 6.2, 1), 2.2);
        updateLightPipe(
          delta * (0.35 + stripEase * 2.65),
          elapsed,
          stripEase,
        );
        if (carPivot) {
          placeCar(elapsed);
          stripCarLights.forEach((light, index) => {
            const colorPhase = elapsed * 0.75 + index * 1.35;
            const colorIndex =
              Math.floor(colorPhase) % drawerPortalColorObjects.length;
            const nextColorIndex =
              (colorIndex + 1) % drawerPortalColorObjects.length;
            light.color.lerpColors(
              drawerPortalColorObjects[colorIndex],
              drawerPortalColorObjects[nextColorIndex],
              colorPhase % 1,
            );
            light.intensity =
              7 + stripEase * 4.2 + Math.sin(elapsed * 4 + index) * 0.65;
          });
        }
        // The sequence's field of view (exactly the normal value once it's over).
        const fov = baseFov + stripSequenceAt(elapsed).fov + CAR_PASS.impact.fov * carImpactAt(elapsed);
        if (camera.fov !== fov) {
          camera.fov = fov;
          camera.updateProjectionMatrix();
        }
        cameraDrag.update(delta);
        cameraDrag.apply(camera, cameraDragTarget);
        if (carPivot && carPivot.visible) renderMotionBlurred(elapsed);
        else renderer.render(scene, camera);
        cameraDrag.restore(camera);
        animationFrame = requestAnimationFrame(animate);
      };
      animationFrame = requestAnimationFrame(animate);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      if (cameraDrag) {
        cameraDrag.reset();
        cameraDrag.dispose();
      }
      resizeObserver?.disconnect();
      if (carPivot) disposeObject(carPivot);
      if (lightPipe) disposeObject(lightPipe);
      disposeBlur();
      renderer?.dispose();
      renderer?.domElement.remove();
    };
  }, []);

  return (
    <section className="world-transition" aria-label="Travelling to the kitchen">
      <div className="world-transition-strips" aria-hidden="true">
        <canvas ref={stripsRef} />
      </div>
      <div ref={stageRef} className="world-transition-car" />
      {description && (
        <div className="wx-level-caption">
          <Snap delay={CAPTION_DELAY_MS} frame={false}>
            <Panel>
              <Label marker="var(--wx-amber)">{CAPTION_EYEBROW}</Label>
              <p className="wx-text">{description}</p>
            </Panel>
          </Snap>
        </div>
      )}
    </section>
  );
}
