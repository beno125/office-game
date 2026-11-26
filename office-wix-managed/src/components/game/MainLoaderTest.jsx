/**
 * Test: the game's main loading screen (route /loading-test, not wired into the game yet).
 *
 * A dark screen with the general menu's icon (the hood air intake, GameMenu.jsx) in the middle while the
 * game's assets load. Then the car comes out of the dark behind it, facing the viewer, framed so that its
 * airInBase (the real air intake on the hood, with the three airIn caps) sits exactly behind the icon at the
 * same size: the camera is straight in front of the intake, at the distance where its width on screen equals
 * the icon's. The two swap: the icon's caps open as the car's caps do, and the icon fades out, leaving the
 * real intake; then the camera pulls back to show the whole car, still facing the viewer.
 */
import { useEffect, useRef, useState } from "react";
import { AirIntakeIcon } from "./ui/GameMenu.jsx";
import "./ui/tokens.css";
import "./ui/mainLoader.css";

/** The sequence (seconds). */
const MAIN_LOADER = {
  iconIn: 0.6, // the icon fades in
  minLoad: 1.4, // shown at least this long before the reveal, even if the assets are ready sooner
  reveal: 1.6, // the car comes out of the dark behind the icon (its lights up from 0)
  hold: 0.35, // both together
  swap: 0.9, // the caps open (icon and car together) while the icon fades out
  capsCloseAt: 0.55, // (share of the pull-back) the car's caps close again
  pullBack: 2.4, // the camera pulls back to the whole car
  /** The car's caps open: edge-on (as the icon's open caps); stagger from the icon's (gameMenu.css). */
  capOpenDeg: 84,
  capDelays: [0, 0.11, 0.06],
  capSec: 0.28,
};
/** The car: its size (length, world units) and the end framing (the whole car facing the viewer). */
const MAIN_LOADER_CAR = {
  length: 4.8,
  fov: 30, // vertical
  endHeight: 0.55, // the end camera's height above the car's centre (× its height)
  endFill: 0.62, // the car's height on screen at the end (× the view's height)
};
/** The icon's housing (its outer rounded rect) in the SVG's 44 × 24 viewBox: its width share. */
const ICON_HOUSING_SHARE = 42 / 44;

const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const easeInOut = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

export default function MainLoaderTest() {
  const stageRef = useRef(null);
  const iconRef = useRef(null);
  const [run, setRun] = useState(0); // "Replay"
  const [phase, setPhase] = useState("loading"); // loading → reveal → swap → done
  const [progress, setProgress] = useState(0);
  const [iconOpen, setIconOpen] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let disposed = false;
    let frame = 0;
    let renderer = null;
    let resizeObserver = null;
    let gltfScene = null;
    setPhase("loading");
    setProgress(0);
    setIconOpen(false);

    Promise.all([import("three"), import("three/addons/loaders/GLTFLoader.js")]).then(([THREE, { GLTFLoader }]) => {
      if (disposed) return;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(MAIN_LOADER_CAR.fov, 1, 0.01, 200);
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.9;
      renderer.setClearColor(0x000000, 0);
      stage.appendChild(renderer.domElement);

      // Lights (faded in by the reveal): a soft key from the front and above, cool and pink rims (the game's).
      const lights = [
        [new THREE.HemisphereLight(0xbce8ff, 0x1a0c33, 0.7), null],
        [new THREE.DirectionalLight(0xffffff, 2.2), [1.5, 4, 6]],
        [new THREE.DirectionalLight(0x4d8dff, 2.4), [-5, 2.5, -3]],
        [new THREE.DirectionalLight(0xff3d9a, 1.8), [5, 1.5, -2]],
        [new THREE.PointLight(0xffffff, 6, 6, 1.6), [0, 2, 3]], // on the intake for the close-up
      ];
      for (const [l, p] of lights) {
        if (p) l.position.set(...p);
        l.userData.full = l.intensity;
        l.intensity = 0;
        scene.add(l);
      }

      const resize = () => {
        const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(stage);
      resize();

      const t0 = performance.now();
      let loadedAt = 0;
      let car = null;
      const caps = []; // the airIn caps: { node, base quaternion }
      const intake = { centre: new THREE.Vector3(), width: 1 }; // the intake's front (the caps' plane), world
      const end = { pos: new THREE.Vector3(), look: new THREE.Vector3() };

      new GLTFLoader().load(
        `${import.meta.env.BASE_URL}office-scene-optimized/car-game14.glb`,
        (gltf) => {
          if (disposed) return;
          gltfScene = gltf.scene;
          car = gltf.scene;
          const chrome = new THREE.MeshPhysicalMaterial({ color: 0xc8ccd0, metalness: 0.9, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.06 });
          const capPaint = new THREE.MeshPhysicalMaterial({ color: 0xc8102e, metalness: 0.4, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.06 });
          const glow = (color, intensity) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.25 });
          car.traverse((n) => {
            const name = n.name || "";
            if (/^canon(?:-|$)/i.test(name) || /physic/i.test(name)) {
              n.visible = false;
              return;
            }
            if (!n.isMesh) return;
            if (name === "airInBase") n.material = chrome;
            else if (/^airIn[123]$/.test(name)) n.material = capPaint;
            else if (name === "frontLights") n.material = glow(0xffffff, 6.5);
            else if (name === "lightBar1") n.material = glow(0xff0000, 12);
            else if (name === "rearLights") n.material = glow(0xff0000, 2);
          });
          // Centred, scaled to its length, facing +z (the viewer).
          const box = new THREE.Box3().setFromObject(car);
          const size = box.getSize(new THREE.Vector3());
          car.scale.setScalar(MAIN_LOADER_CAR.length / Math.max(size.x, size.y, size.z));
          car.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(car.scale.x));
          scene.add(car);
          car.updateMatrixWorld(true);
          for (const name of ["airIn1", "airIn2", "airIn3"]) {
            const n = car.getObjectByName(name);
            if (n) caps.push({ node: n, base: n.quaternion.clone() });
          }
          // The intake: its width (airInBase), centred on the caps, in their plane.
          const base = car.getObjectByName("airInBase");
          const bb = new THREE.Box3().setFromObject(base);
          intake.width = bb.max.x - bb.min.x;
          const c = new THREE.Vector3();
          for (const k of caps) c.add(k.node.getWorldPosition(new THREE.Vector3()));
          intake.centre.copy(caps.length ? c.divideScalar(caps.length) : bb.getCenter(c));
          // The end framing: the whole car, from in front and a little above.
          const cb = new THREE.Box3().setFromObject(car);
          const cs = cb.getSize(new THREE.Vector3());
          const cc = cb.getCenter(new THREE.Vector3());
          const d = cs.y / MAIN_LOADER_CAR.endFill / 2 / Math.tan(THREE.MathUtils.degToRad(MAIN_LOADER_CAR.fov / 2));
          end.look.copy(cc);
          end.pos.set(cc.x, cc.y + cs.y * MAIN_LOADER_CAR.endHeight, cb.max.z + d);
          loadedAt = performance.now();
          setProgress(1);
        },
        (e) => {
          if (e.lengthComputable && e.total) setProgress(Math.min(0.99, e.loaded / e.total));
        },
      );

      const S = MAIN_LOADER;
      let shown = "loading";
      const show = (p) => {
        if (p !== shown) {
          shown = p;
          setPhase(p);
        }
      };
      const close = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
      const tick = () => {
        frame = requestAnimationFrame(tick);
        const now = (performance.now() - t0) / 1000;
        if (!car || !loadedAt) {
          renderer.domElement.style.opacity = "0";
          return;
        }
        // The reveal starts once loaded and shown long enough.
        const r0 = Math.max(S.iconIn + S.minLoad, (loadedAt - t0) / 1000);
        const t = now - r0; // since the reveal
        const swapAt = S.reveal + S.hold;
        const pullAt = swapAt + S.swap;
        show(t < 0 ? "loading" : t < swapAt ? "reveal" : t < pullAt ? "swap" : "done");
        setIconOpen(t >= swapAt);
        // Lights: up from the dark during the reveal.
        const k = ease(t / S.reveal);
        for (const [l] of lights) l.intensity = l.userData.full * k;
        renderer.domElement.style.opacity = String(k); // out of the dark (no silhouette before the reveal)
        // The close-up: straight in front of the intake, at the distance where its width matches the icon's.
        const rect = iconRef.current?.getBoundingClientRect();
        const iconW = rect ? rect.width * ICON_HOUSING_SHARE : 200;
        const viewH = Math.max(1, stage.clientHeight);
        const dist = (intake.width * viewH) / (iconW * 2 * Math.tan(THREE.MathUtils.degToRad(MAIN_LOADER_CAR.fov / 2)));
        close.look.copy(intake.centre);
        close.pos.copy(intake.centre).setZ(intake.centre.z + dist);
        // Pull back to the whole car.
        const p = easeInOut((t - pullAt) / S.pullBack);
        camera.position.lerpVectors(close.pos, end.pos, p);
        const look = new THREE.Vector3().lerpVectors(close.look, end.look, p);
        camera.lookAt(look);
        // The caps: open with the icon's (same stagger), closed again during the pull-back.
        const closeT = t - (pullAt + S.capsCloseAt * S.pullBack);
        caps.forEach((cap, i) => {
          const open = ease((t - swapAt - S.capDelays[i]) / S.capSec);
          const shut = ease((closeT - S.capDelays[i]) / S.capSec);
          const a = THREE.MathUtils.degToRad(S.capOpenDeg) * open * (1 - shut);
          cap.node.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), a).multiply(cap.base);
        });
        renderer.render(scene, camera);
      };
      tick();
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      if (gltfScene) {
        gltfScene.traverse((n) => {
          n.geometry?.dispose?.();
          for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
            if (!m) continue;
            for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
            m.dispose?.();
          }
        });
      }
      renderer?.dispose();
      renderer?.domElement.remove();
    };
  }, [run]);

  return (
    <main className={`wx-main-loader is-${phase}`} aria-busy={phase !== "done"}>
      <div className="wx-main-loader-stage" ref={stageRef} />
      <div className="wx-main-loader-icon" ref={iconRef}>
        <AirIntakeIcon open={iconOpen} />
      </div>
      <div
        className="wx-main-loader-progress"
        role="progressbar"
        aria-label="Loading the game"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
      {phase === "done" && (
        <button type="button" className="wx-main-loader-replay" onClick={() => setRun((n) => n + 1)}>
          Replay
        </button>
      )}
    </main>
  );
}
