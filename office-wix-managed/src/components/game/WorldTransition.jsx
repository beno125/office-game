import { useEffect, useRef } from "react";
import { Label, Panel, Snap } from "./ui/ui.jsx";
import "./ui/loaders.css";
import { createCameraDrag } from "./cameraDrag.js";
import { startTransitionStrips } from "./transitionStrips.js";

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

export default function WorldTransition({ onComplete, description }) {
  const stageRef = useRef(null);
  const stripsRef = useRef(null);
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
  useEffect(() => startTransitionStrips(stripsRef.current, TRANSITION_STRIPS), []);

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

    Promise.all([
      import("three"),
      import("three/addons/loaders/GLTFLoader.js"),
    ]).then(([THREE, { GLTFLoader }]) => {
      if (disposed) return;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
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

          const box = new THREE.Box3().setFromObject(car);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const scale = 4.8 / Math.max(size.x, size.y, size.z, 0.001);
          car.position.sub(center);
          car.scale.setScalar(scale);

          carPivot = new THREE.Group();
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

      const startedAt = performance.now();
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
          const driveProgress = Math.min(elapsed / 6.2, 1);
          const acceleratedProgress = Math.pow(driveProgress, 2.4);
          carPivot.position.z = THREE.MathUtils.lerp(
            -90,
            14,
            acceleratedProgress,
          );
          carPivot.position.x = 0;
          carPivot.position.y = Math.sin(elapsed * 2.8) * 0.035;
          carPivot.rotation.y = 0;
          carPivot.rotation.z = Math.sin(elapsed * 2.1) * 0.008;
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
        cameraDrag.update(delta);
        cameraDrag.apply(camera, cameraDragTarget);
        renderer.render(scene, camera);
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
