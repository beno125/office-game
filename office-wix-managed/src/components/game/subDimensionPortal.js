/**
 * The sub-dimensional portal look of the Kitchen intro's portal shot
 * (kitchenSceneModule.js, KITCHEN_INTRO_PORTAL / _kIntroPortalBegin), for the
 * Office drawer's gateway to the Kitchen (officeSceneModule.js,
 * setupDrawerPortalEffect). The shader sources here are that shot's own
 * (copied as they are; the Kitchen shot keeps its own code untouched), so the
 * player recognises the same look.
 *
 * The look: a deep tunnel seen only through the portal's opening (a stencil
 * mask, the depth reset to "far" inside it so the tunnel can be deeper than
 * whatever is behind the opening): its walls dark at the opening and glowing
 * blue-violet deeper in (soft bands turning along them), a bright core far
 * away; the transition's coloured streaks (TRANSITION_STRIP_COLORS) flying
 * out of it at every depth, a share carrying on out of the opening; a ring of
 * coloured smoke (soft sprites with animated fbm noise, glowing from its inner
 * edge) with glowing particles orbiting in it, sparks drifting out, a burst
 * wave of streaks on the opening, a soft haze and a violet light.
 *
 * `shaped` variants follow a superellipse (half sizes uShape.xy, squareness
 * uShape.z; 2 is an ellipse) instead of a circle, to fit an opening's shape
 * (the drawer's rounded rectangle); the unshaped ones are exactly the
 * Kitchen shot's.
 */
import { TRANSITION_STRIP_COLORS } from "./transitionStrips.js";

/** The look's colours and glow (the Kitchen intro portal's). */
export const SUB_DIMENSION_LOOK = {
  /** The tunnel's inner glow: near the opening → deep inside, and the bright core far away. */
  tunnelColors: { near: 0x020310, deep: 0x3a30c8, core: 0xd7dcff },
  /** How the walls' glow grows with depth (higher: dark for longer, bright only deep in). */
  tunnelGlowCurve: 2.4,
  /** Brightness of the streaks / sparks / particles (× colour). */
  glow: 2.2,
  /** The portal's light, and the electric arcs' light. */
  lightColor: 0x7d74ff,
  arcLightColor: 0xc9d2ff,
  /** The streaks', smoke's and particles' colours. */
  palette: TRANSITION_STRIP_COLORS,
};

/** GLSL: a point on the opening's outline at angle a (superellipse; uShape: half sizes, squareness). */
const RING_DIR = `
        uniform vec3 uShape;
        vec2 ringDir(float a) {
          float c = cos(a), s = sin(a);
          float k = pow(pow(abs(c), uShape.z) + pow(abs(s), uShape.z), -1.0 / uShape.z);
          return vec2(c * k * uShape.x, s * k * uShape.y);
        }`;

/** Streaks: a thin glowing line between two local points, widened across the view (the Kitchen portal's shader). */
export function streakVertexShader(shaped = false) {
  return `
        attribute vec4 aA; // radius, angle, phase, speed
        attribute vec4 aB; // length, width, -, -
        attribute vec4 aE; // out of the opening: spread (tan), -, id, -
        attribute vec3 aColor;
        uniform float uTime;
        uniform float uMode; // 0 tunnel line (continuing out if it escapes), 2 burst wave (out only)
        uniform float uDepth; // tunnel depth (world units)
        uniform float uEsc; // escape distance
        uniform float uDecel;
        uniform float uFadeStart;
        uniform float uSuck; // closing: escaped lines pulled back to the centre
        uniform float uWaveAt;
        uniform float uFloorY;
        uniform float uFloorFade;
        uniform vec4 uEscLevels; // steady, burst, car, -
        uniform vec4 uEscTimes; // open from, burst at, burst width, close from
        uniform vec2 uEscCar; // car from, to
        varying vec3 vColor;
        varying float vSide;
        varying float vFade;
        varying float vLocalZ;
        varying float vFloor;${shaped ? RING_DIR : ""}
        // Share of lines escaping when crossing the opening at time t (the shot's sequence).
        float escapeAt(float t) {
          float open = step(uEscTimes.x, t) * (1.0 - step(uEscTimes.w, t));
          float burst = uEscLevels.y * exp(-pow((t - uEscTimes.y) / uEscTimes.z, 2.0));
          float car = uEscLevels.z * smoothstep(uEscCar.x, uEscCar.x + 0.2, t) * (1.0 - smoothstep(uEscCar.y - 0.4, uEscCar.y, t));
          return max(uEscLevels.x * open, max(burst, car)) * (1.0 - step(uEscTimes.w, t));
        }
        void main() {
          vec3 p;
          vec3 tangent;
          float along = position.x; // 0 tail → 1 head
          vFloor = 1.0;
          {
            float len = aB.x * (0.6 + 0.4 * aA.w / 10.0);
            float dHead;
            bool escapes;
            if (uMode < 0.5) {
              // Its run: from deep in the tunnel, through the opening, out into the kitchen (uEsc beyond it).
              float Lt = uDepth + uEsc;
              float q = aA.z - uTime * aA.w / Lt;
              float k = floor(q);
              dHead = Lt * (q - k) - uEsc; // distance behind the opening (negative: out in the kitchen)
              float tCross = (aA.z - k - uEsc / Lt) * Lt / aA.w; // when its head crosses the opening
              float h = fract(sin(aE.z * 91.7 + k * 37.3) * 43758.5453);
              escapes = h < escapeAt(tCross);
            } else {
              float age = uTime - uWaveAt;
              dHead = age < 0.0 ? 1e4 : -age * aA.w;
              escapes = true;
            }
            float dist = dHead + (1.0 - along) * len;
            if (dist >= 0.0) {
              p = ${shaped ? "vec3(ringDir(aA.y) * aA.x, -dist)" : "vec3(cos(aA.y) * aA.x, sin(aA.y) * aA.x, -dist)"};
              tangent = vec3(0.0, 0.0, 1.0);
              float nearFade = escapes ? 1.0 : smoothstep(0.0, 0.6, dist);
              vFade = nearFade * (1.0 - smoothstep(uDepth * 0.7, uDepth, dist)) * (0.55 + 0.45 * smoothstep(uDepth, 0.0, dist));
              if (uMode > 1.5) vFade = 0.0;
            } else {
              // Out in the kitchen: straight on (a tight cone), barely slowing; pulled back along it when closing.
              float x = -dist;
              float xr = x * (1.0 - uSuck * uSuck);
              float xs = xr * (1.0 - uDecel * min(xr, uEsc) / (2.0 * uEsc));
              ${
                shaped
                  ? "vec2 rd = ringDir(aA.y);\n              vec2 dir2 = normalize(rd);\n              p = vec3(rd * aA.x + dir2 * xs * aE.x, xs);"
                  : "vec2 dir2 = vec2(cos(aA.y), sin(aA.y));\n              p = vec3(dir2 * (aA.x + xs * aE.x), xs);"
              }
              tangent = normalize(vec3(dir2 * aE.x, 1.0));
              float grow = uMode > 1.5 ? smoothstep(0.0, 0.3, x) : 1.0;
              vFade = escapes ? (1.0 - smoothstep(uEsc * uFadeStart, uEsc, x)) * grow * (1.0 - smoothstep(0.55, 1.0, uSuck)) : 0.0;
              vec4 wp = modelMatrix * vec4(p, 1.0);
              vFloor = smoothstep(0.0, uFloorFade, wp.y - uFloorY);
            }
          }
          vLocalZ = p.z;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vec3 tv = normalize((modelViewMatrix * vec4(tangent, 0.0)).xyz);
          vec3 side = normalize(cross(tv, normalize(-mv.xyz)));
          mv.xyz += side * position.y * aB.y;
          gl_Position = projectionMatrix * mv;
          vColor = aColor;
          vSide = position.y;
        }
      `;
}
export const STREAK_FS = `
        uniform float uGlow;
        uniform float uAlpha;
        uniform float uKeep; // 1: only inside the tunnel (z < 0), -1: only out in the kitchen (z > 0), 0: all
        varying vec3 vColor;
        varying float vSide;
        varying float vFade;
        varying float vLocalZ;
        varying float vFloor;
        void main() {
          if (uKeep * vLocalZ > 0.0) discard;
          float core = exp(-vSide * vSide * 9.0);
          float halo = exp(-vSide * vSide * 2.0) * 0.35;
          float a = (core + halo) * vFade * vFloor * uAlpha;
          gl_FragColor = vec4((vColor + core * 0.12) * uGlow * a, a);
        }
      `;

/** The tunnel's walls: dark at the opening, glowing brighter deeper in, soft bands turning along them. */
export const WALLS_VS = "varying float vD; varying float vA; void main() { vD = -position.z; vA = atan(position.y, position.x); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
export function wallsFragmentShader(bandsUniform = false) {
  return `
                uniform vec3 uNear; uniform vec3 uDeep; uniform float uTime; uniform float uCurve;${bandsUniform ? " uniform float uBands;" : ""}
                varying float vD; varying float vA;
                void main() {
                  float k = pow(clamp(vD, 0.0, 1.0), uCurve);
                  float bands = ${bandsUniform ? "1.0 - uBands + uBands" : "0.85 + 0.15"} * sin(vA * 7.0 + vD * 18.0 - uTime * 6.0);
                  gl_FragColor = vec4(mix(uNear, uDeep, k) * bands, 1.0);
                }`;
}

/** Sparks drifting out of the opening and fading in the air. */
export function sparksVertexShader(shaped = false) {
  return `
                attribute vec4 aS; attribute vec4 aV; attribute vec3 aColor;
                uniform float uTime; uniform float uRing; uniform float uSuck; uniform float uFloorY; uniform float uFloorFade;
                varying vec3 vColor; varying float vA;${shaped ? RING_DIR : ""}
                void main() {
                  float life = aS.w;
                  float age = fract(uTime / life + aS.z) * life;
                  float u = age / life;
                  vec2 dir = normalize(aS.xy + 1e-4);
                  vec3 p = vec3(aS.xy * ${shaped ? "uShape.xy * " : ""}uRing + dir * aV.y * age, aV.x * age * (1.0 - 0.3 * u));
                  p = mix(p, vec3(0.0), uSuck * uSuck);
                  vec4 wp = modelMatrix * vec4(p, 1.0);
                  vA = sin(3.14159 * u) * smoothstep(0.0, uFloorFade, wp.y - uFloorY) * (1.0 - smoothstep(0.55, 1.0, uSuck));
                  vec4 mv = viewMatrix * wp;
                  gl_Position = projectionMatrix * mv;
                  gl_PointSize = aV.z * 30.0 / max(0.2, -mv.z);
                  vColor = aColor;
                }`;
}
export const SPARKS_FS = `
                uniform float uGlow; uniform float uLevel;
                varying vec3 vColor; varying float vA;
                void main() {
                  vec2 c = gl_PointCoord - 0.5;
                  float a = exp(-dot(c, c) * 14.0) * vA * uLevel;
                  gl_FragColor = vec4((vColor + 0.3) * uGlow * a, a);
                }`;

/** The rim: a ring of coloured smoke (soft noise sprites at different radii and depths). */
export function smokeVertexShader(shaped = false) {
  return `
              attribute vec4 aS; attribute vec4 aT; attribute vec3 aColor;
              uniform float uTime; uniform float uRing; uniform float uSpin; uniform float uThick; uniform float uFloorY;
              uniform float uDepthS; uniform float uBillow; uniform float uSizeK;
              varying vec2 vUv; varying vec3 vColor; varying float vInner; varying float vSeed; varying float vFloor;${shaped ? RING_DIR : ""}
              void main() {
                float a = aS.x + uTime * uSpin * aT.y;
                float billow = 0.5 + 0.5 * sin(uTime * aT.z + aS.w * 6.2832);
                ${
                  shaped
                    ? "vec2 rd = ringDir(a);\n                vec3 c = vec3(rd * uRing + normalize(rd) * (aS.y * uThick + billow * uBillow), aS.z * uDepthS * 0.5);"
                    : "float r = uRing + aS.y * uThick + billow * uBillow;\n                vec3 c = vec3(cos(a) * r, sin(a) * r, aS.z * uDepthS * 0.5);"
                }
                float size = aT.x * uSizeK * (0.85 + 0.3 * billow);
                vec4 wp = modelMatrix * vec4(c, 1.0);
                vec4 mv = viewMatrix * wp;
                mv.xy += position.xy * size;
                gl_Position = projectionMatrix * mv;
                vUv = position.xy + 0.5;
                vColor = aColor;
                vInner = clamp(0.5 - aS.y * 0.5, 0.0, 1.0);
                vSeed = aS.w;
                vFloor = smoothstep(0.0, size * 0.5, wp.y - uFloorY - size * 0.15); // never below the table
              }`;
}
export const SMOKE_FS = `
              uniform float uTime; uniform float uAlpha; uniform float uGlowS; uniform float uInner; uniform vec2 uNoise;
              varying vec2 vUv; varying vec3 vColor; varying float vInner; varying float vSeed; varying float vFloor;
              float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
              float noise(vec2 p) {
                vec2 i = floor(p), f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
              }
              float fbm(vec2 p) {
                float v = 0.0, a = 0.5;
                for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
                return v;
              }
              void main() {
                vec2 q = vUv - 0.5;
                float soft = 1.0 - smoothstep(0.15, 0.5, length(q));
                float n = fbm(vUv * uNoise.x + vec2(vSeed * 17.0, uTime * uNoise.y) + fbm(vUv * 1.7 - uTime * uNoise.y * 0.5));
                float dens = soft * smoothstep(0.25, 0.85, n);
                float a = dens * uAlpha * vFloor;
                vec3 col = vColor * uGlowS * (0.65 + uInner * vInner) + vec3(0.15) * dens * vInner;
                gl_FragColor = vec4(col, a);
              }`;

/** Glowing particles orbiting with the smoke, a share drifting off into the air and fading. */
export function rimParticlesVertexShader(shaped = false) {
  return `
                attribute vec4 aP; attribute vec4 aQ; attribute vec3 aColor;
                uniform float uTime; uniform float uRing; uniform float uSpin; uniform float uThick; uniform float uFloorY;
                uniform vec2 uDrift; uniform float uDepthS;
                varying vec3 vColor; varying float vA;${shaped ? RING_DIR : ""}
                void main() {
                  float a = aP.x + uTime * uSpin * aQ.x * 1.3;
                  float out_ = 0.0, fwd = 0.0;
                  float alpha = 0.65 + 0.35 * sin(uTime * 4.0 + aP.w * 6.2832); // twinkle
                  if (aQ.y > 0.5) {
                    float u = fract(uTime / aQ.z + aP.w);
                    out_ = u * uDrift.x;
                    fwd = u * uDrift.y;
                    alpha = sin(3.14159 * u);
                  }
                  ${
                    shaped
                      ? "vec2 rd = ringDir(a);\n                  vec3 c = vec3(rd * uRing + normalize(rd) * (aP.y * uThick * 0.9 + out_), aP.z * uDepthS * 0.5 + fwd);"
                      : "float r = uRing + aP.y * uThick * 0.9 + out_;\n                  vec3 c = vec3(cos(a) * r, sin(a) * r, aP.z * uDepthS * 0.5 + fwd);"
                  }
                  vec4 wp = modelMatrix * vec4(c, 1.0);
                  vec4 mv = viewMatrix * wp;
                  gl_Position = projectionMatrix * mv;
                  gl_PointSize = aQ.w * 30.0 / max(0.2, -mv.z);
                  vA = alpha * smoothstep(0.0, 0.2, wp.y - uFloorY);
                  vColor = aColor;
                }`;
}
export const RIM_PARTICLES_FS = `
                uniform float uGlow; uniform float uAlpha;
                varying vec3 vColor; varying float vA;
                void main() {
                  vec2 c = gl_PointCoord - 0.5;
                  float a = exp(-dot(c, c) * 16.0) * vA * uAlpha;
                  gl_FragColor = vec4((vColor + 0.35) * uGlow * a, a);
                }`;

/** A soft round glow texture (flash / haze / core). */
export function portalGlowTexture(THREE) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(190,200,255,0.75)");
  g.addColorStop(0.6, "rgba(120,100,255,0.25)");
  g.addColorStop(1, "rgba(90,70,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Stencil test "inside the opening" on a material (bit `bit`). */
export function maskToOpening(THREE, m, bit) {
  m.stencilWrite = true;
  m.stencilRef = bit;
  m.stencilFunc = THREE.EqualStencilFunc;
  m.stencilFuncMask = bit;
  m.stencilWriteMask = 0;
  m.stencilFail = m.stencilZFail = m.stencilZPass = THREE.KeepStencilOp;
  return m;
}

/** A point on a superellipse outline (half sizes hx, hy, squareness n) at angle a. */
function superPoint(a, hx, hy, n) {
  const c = Math.cos(a), s = Math.sin(a);
  const k = Math.pow(Math.pow(Math.abs(c), n) + Math.pow(Math.abs(s), n), -1 / n);
  return [c * k * hx, s * k * hy];
}

/**
 * A sub-dimensional portal (the Kitchen intro portal's look) for a fixed opening: a superellipse (half sizes hx, hy,
 * squareness n) facing local +z, at the group's origin. Its own sequence (`open` 0 → 1, `close` 0 → 1, `time`) is
 * driven by the caller through update(). Settings: see DRAWER_GATEWAY in officeSceneModule.js.
 * @returns {{ group: THREE.Group, light: THREE.PointLight, update(o: {time:number, open:number, close:number}): void, setLook(): void }}
 */
export function createSubDimensionPortal(THREE, P) {
  const look = P.look;
  const pal = look.palette || SUB_DIMENSION_LOOK.palette;
  const bit = P.stencilBit;
  const shape = new THREE.Vector3(P.halfX, P.halfY, P.squareness);
  const minHalf = Math.min(P.halfX, P.halfY);
  const uniforms = {
    uTime: { value: 0 },
    uDepth: { value: P.tunnelDepth },
    uRing: { value: 1 },
    uShape: { value: shape },
    uSpin: { value: P.rimSpin },
    uThick: { value: P.smoke.thickness },
    uGlow: { value: look.glow },
    uEsc: { value: P.escape.distance },
    uDecel: { value: P.escape.decel },
    uFadeStart: { value: P.escape.fadeStart },
    uSuck: { value: 0 },
    uWaveAt: { value: P.waveAt },
    uFloorY: { value: -1e4 }, // no floor to fade at (it opens upward)
    uFloorFade: { value: 0.35 },
    uEscLevels: { value: new THREE.Vector4(P.escape.steady, P.escape.burst, 0, 0) },
    uEscTimes: { value: new THREE.Vector4(P.escape.from, P.waveAt, P.escape.burstWidth, 1e6) },
    uEscCar: { value: new THREE.Vector2(1e6, 1e6) },
  };
  const G = new THREE.Group();
  G.name = "subDimensionPortal";
  // 1. The opening marks the stencil (only where visible) …
  const outline = new THREE.Shape();
  const SEG = 96;
  for (let i = 0; i <= SEG; i++) {
    const [x, y] = superPoint((i / SEG) * Math.PI * 2, P.halfX, P.halfY, P.squareness);
    if (i === 0) outline.moveTo(x, y);
    else outline.lineTo(x, y);
  }
  const disc = new THREE.ShapeGeometry(outline, 1);
  const writer = new THREE.Mesh(
    disc,
    new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      transparent: true,
      side: THREE.FrontSide,
      stencilWrite: true,
      stencilRef: bit,
      stencilWriteMask: bit,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
    }),
  );
  writer.renderOrder = 100;
  // 2. … and resets the depth there to "far" (the tunnel at its own depth, deeper than what is behind the opening).
  const resetter = new THREE.Mesh(
    disc,
    maskToOpening(
      THREE,
      new THREE.ShaderMaterial({
        vertexShader: "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }",
        fragmentShader: "void main() { gl_FragColor = vec4(0.0); }",
        colorWrite: false,
        depthWrite: true,
        depthFunc: THREE.AlwaysDepth,
        transparent: true,
        side: THREE.DoubleSide,
      }),
      bit,
    ),
  );
  resetter.renderOrder = 101;
  // 3. The tunnel's walls (the opening's outline, unit depth along −z) and its core.
  const wallsGeo = (() => {
    const around = 96, deep = 24;
    const pos = [], idx = [];
    for (let j = 0; j <= deep; j++) {
      for (let i = 0; i <= around; i++) {
        const [x, y] = superPoint((i / around) * Math.PI * 2, P.halfX, P.halfY, P.squareness);
        pos.push(x, y, -j / deep);
      }
    }
    for (let j = 0; j < deep; j++) {
      for (let i = 0; i < around; i++) {
        const a = j * (around + 1) + i, b = a + 1, c = a + around + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  })();
  const wallsMat = maskToOpening(
    THREE,
    new THREE.ShaderMaterial({
      uniforms: {
        uNear: { value: new THREE.Color(look.tunnelColors.near) },
        uDeep: { value: new THREE.Color(look.tunnelColors.deep) },
        uTime: uniforms.uTime,
        uCurve: { value: look.tunnelGlowCurve },
        uBands: { value: P.wallBands },
      },
      vertexShader: WALLS_VS,
      fragmentShader: wallsFragmentShader(true),
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
      toneMapped: false,
    }),
    bit,
  );
  const walls = new THREE.Mesh(wallsGeo, wallsMat);
  walls.renderOrder = 102;
  const glowTex = portalGlowTexture(THREE);
  const coreMat = maskToOpening(
    THREE,
    new THREE.MeshBasicMaterial({
      map: glowTex,
      color: new THREE.Color(look.tunnelColors.core).multiplyScalar(1.4),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
    bit,
  );
  const core = new THREE.Mesh(new THREE.PlaneGeometry(2 * P.halfX, 2 * P.halfY).translate(0, 0, -1), coreMat);
  core.renderOrder = 103;
  const unit = new THREE.Group(); // depth: z scaled with the tunnel's depth
  unit.add(walls, core);
  G.add(writer, resetter, unit);
  // 4. The streaks (the Kitchen's shader, following the outline).
  const streaks = (count, mode, fill) => {
    const g = new THREE.PlaneGeometry(1, 2, 6, 1);
    g.translate(0.5, 0, 0);
    const ig = new THREE.InstancedBufferGeometry().copy(g);
    ig.instanceCount = count;
    const A = new Float32Array(count * 4), B = new Float32Array(count * 4), E = new Float32Array(count * 4), C = new Float32Array(count * 3);
    const col = new THREE.Color();
    const D = Math.PI / 180;
    for (let i = 0; i < count; i++) {
      fill(i, A, B);
      E[i * 4] = Math.tan((P.escape.spreadDeg[0] + Math.random() * (P.escape.spreadDeg[1] - P.escape.spreadDeg[0])) * D);
      E[i * 4 + 2] = Math.random() * 100;
      col.set(pal[i % pal.length]);
      C.set([col.r, col.g, col.b], i * 3);
    }
    ig.setAttribute("aA", new THREE.InstancedBufferAttribute(A, 4));
    ig.setAttribute("aB", new THREE.InstancedBufferAttribute(B, 4));
    ig.setAttribute("aE", new THREE.InstancedBufferAttribute(E, 4));
    ig.setAttribute("aColor", new THREE.InstancedBufferAttribute(C, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uMode: { value: mode }, uAlpha: { value: 1 }, uKeep: { value: 0 } },
      vertexShader: streakVertexShader(true),
      fragmentShader: STREAK_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(ig, mat);
    mesh.frustumCulled = false;
    return mesh;
  };
  const rnd = (r) => r[0] + Math.random() * (r[1] - r[0]);
  const tunnel = streaks(P.tunnelStreaks, 0, (i, A, B) => {
    A[i * 4] = P.tunnelRadius[0] + Math.sqrt(Math.random()) * (P.tunnelRadius[1] - P.tunnelRadius[0]); // share of the outline
    A[i * 4 + 1] = Math.random() * Math.PI * 2;
    A[i * 4 + 2] = Math.random();
    A[i * 4 + 3] = rnd(P.tunnelSpeed);
    B[i * 4] = rnd(P.tunnelLen);
    B[i * 4 + 1] = rnd(P.tunnelWidth);
  });
  maskToOpening(THREE, tunnel.material, bit);
  tunnel.material.uniforms.uKeep.value = 1; // inside the tunnel
  tunnel.renderOrder = 105;
  G.add(tunnel);
  const tunnelOut = new THREE.Mesh(tunnel.geometry, tunnel.material.clone());
  tunnelOut.material.uniforms = { ...tunnel.material.uniforms, uKeep: { value: -1 }, uAlpha: { value: 1 } };
  tunnelOut.material.stencilWrite = false;
  tunnelOut.frustumCulled = false;
  tunnelOut.renderOrder = 106;
  G.add(tunnelOut);
  const wave = streaks(P.wave.count, 2, (i, A, B) => {
    A[i * 4] = 0.2 + 0.8 * Math.sqrt(Math.random());
    A[i * 4 + 1] = Math.random() * Math.PI * 2;
    A[i * 4 + 3] = rnd(P.wave.speed);
    B[i * 4] = rnd(P.tunnelLen);
    B[i * 4 + 1] = rnd(P.tunnelWidth);
  });
  wave.material.uniforms.uKeep.value = -1;
  wave.renderOrder = 106;
  G.add(wave);
  // 5. Sparks drifting out of the opening.
  const sparks = (() => {
    const S = P.sparks;
    const n = S.count;
    const aS = new Float32Array(n * 4), aV = new Float32Array(n * 4), aC = new Float32Array(n * 3);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.9;
      aS.set([Math.cos(a) * r, Math.sin(a) * r, Math.random(), rnd(S.life)], i * 4);
      aV.set([rnd(S.speedOut), rnd(S.speedSide), rnd(S.size), 0], i * 4);
      col.set(pal[i % pal.length]);
      aC.set([col.r, col.g, col.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aS", new THREE.BufferAttribute(aS, 4));
    g.setAttribute("aV", new THREE.BufferAttribute(aV, 4));
    g.setAttribute("aColor", new THREE.BufferAttribute(aC, 3));
    const m = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: uniforms.uTime,
          uRing: uniforms.uRing,
          uShape: uniforms.uShape,
          uSuck: uniforms.uSuck,
          uFloorY: uniforms.uFloorY,
          uFloorFade: uniforms.uFloorFade,
          uGlow: uniforms.uGlow,
          uLevel: { value: 0 },
        },
        vertexShader: sparksVertexShader(true),
        fragmentShader: SPARKS_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    m.frustumCulled = false;
    m.renderOrder = 106;
    return m;
  })();
  G.add(sparks);
  // 6. The rim: coloured smoke along the outline, and particles orbiting in it.
  const S = P.smoke;
  const smoke = (() => {
    const n = S.count;
    const ig = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
    ig.instanceCount = n;
    const aS = new Float32Array(n * 4), aT = new Float32Array(n * 4), aC = new Float32Array(n * 3);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      aS.set([(i / n) * Math.PI * 2 + Math.random() * 0.2, Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random()], i * 4);
      aT.set([rnd(S.size), 0.75 + Math.random() * 0.5, rnd(S.billowSpeed), 0], i * 4);
      col.set(pal[i % pal.length]);
      aC.set([col.r, col.g, col.b], i * 3);
    }
    ig.setAttribute("aS", new THREE.InstancedBufferAttribute(aS, 4));
    ig.setAttribute("aT", new THREE.InstancedBufferAttribute(aT, 4));
    ig.setAttribute("aColor", new THREE.InstancedBufferAttribute(aC, 3));
    const m = new THREE.Mesh(
      ig,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: uniforms.uTime,
          uRing: uniforms.uRing,
          uShape: uniforms.uShape,
          uSpin: uniforms.uSpin,
          uThick: uniforms.uThick,
          uFloorY: uniforms.uFloorY,
          uDepthS: { value: S.depth },
          uBillow: { value: S.billow },
          uSizeK: { value: 1 },
          uAlpha: { value: 0 },
          uGlowS: { value: S.glow },
          uInner: { value: S.innerGlow },
          uNoise: { value: new THREE.Vector2(S.noiseScale, S.noiseSpeed) },
        },
        vertexShader: smokeVertexShader(true),
        fragmentShader: SMOKE_FS,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    m.frustumCulled = false;
    m.renderOrder = 106;
    return m;
  })();
  G.add(smoke);
  const rimParticles = (() => {
    const Q = P.rimParticles;
    const m = Q.count;
    const pA = new Float32Array(m * 4), pB = new Float32Array(m * 4), pC = new Float32Array(m * 3);
    const col = new THREE.Color();
    for (let i = 0; i < m; i++) {
      pA.set([Math.random() * Math.PI * 2, Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random()], i * 4);
      pB.set([0.8 + Math.random() * 0.8, Math.random() < Q.driftShare ? 1 : 0, rnd(Q.life), rnd(Q.size)], i * 4);
      col.set(pal[i % pal.length]);
      pC.set([col.r, col.g, col.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(m * 3), 3));
    g.setAttribute("aP", new THREE.BufferAttribute(pA, 4));
    g.setAttribute("aQ", new THREE.BufferAttribute(pB, 4));
    g.setAttribute("aColor", new THREE.BufferAttribute(pC, 3));
    const pts = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: uniforms.uTime,
          uRing: uniforms.uRing,
          uShape: uniforms.uShape,
          uSpin: uniforms.uSpin,
          uThick: uniforms.uThick,
          uFloorY: uniforms.uFloorY,
          uGlow: uniforms.uGlow,
          uAlpha: { value: 0 },
          uDrift: { value: new THREE.Vector2(Q.driftOut, Q.driftForward) },
          uDepthS: { value: S.depth },
        },
        vertexShader: rimParticlesVertexShader(true),
        fragmentShader: RIM_PARTICLES_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    pts.frustumCulled = false;
    pts.renderOrder = 107;
    return pts;
  })();
  G.add(rimParticles);
  // 7. The opening's flash and a soft haze over it.
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * minHalf, 2 * minHalf),
    new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  flash.position.z = 0.06;
  flash.renderOrder = 107;
  G.add(flash);
  const haze = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * P.halfX * 1.15, 2 * P.halfY * 1.15),
    new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(look.lightColor).multiplyScalar(0.5), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }),
  );
  haze.position.z = 0.05;
  haze.renderOrder = 107;
  G.add(haze);

  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  /**
   * Drive it: `time` (s since it started opening), `open` (0 → 1 as it opens), `close` (0 → 1 as it closes).
   * Everything scales with open × (1 − close); the tunnel deepens with `open`; closing pulls the escaped lines back.
   */
  function update({ time, open, close }) {
    const live = open * (1 - close);
    uniforms.uTime.value = time * P.speed;
    uniforms.uGlow.value = look.glow * P.intensity;
    uniforms.uSuck.value = close;
    unit.scale.set(1, 1, Math.max(0.05, P.tunnelDepth * smooth(0, 0.8, open) * (1 - close)));
    uniforms.uDepth.value = Math.max(0.05, P.tunnelDepth * smooth(0, 0.8, open));
    uniforms.uSpin.value = P.rimSpin * (1 + 2.5 * close);
    smoke.material.uniforms.uAlpha.value = S.alpha * live * P.intensity;
    smoke.material.uniforms.uSizeK.value = 0.55 + 0.45 * open;
    rimParticles.material.uniforms.uAlpha.value = live;
    sparks.material.uniforms.uLevel.value = smooth(0.3, 1, open) * (1 - close);
    tunnel.material.uniforms.uAlpha.value = live;
    tunnelOut.material.uniforms.uAlpha.value = live;
    // The opening's flash: up as it opens, gone soon after; a small one as it closes.
    const fOpen = Math.max(0, 1 - Math.abs(open - 0.25) / 0.25);
    flash.material.opacity = Math.min(1, fOpen * P.flash + Math.sin(Math.PI * close) * P.flash * 0.5) * P.intensity;
    haze.material.opacity = 0.5 * live * P.intensity;
  }
  update({ time: 0, open: 0, close: 0 });
  return { group: G, update, uniforms };
}
