/**
 * The portal ring of the Kitchen intro (the ring the car drives out of), shared
 * by the Kitchen intro's portal shot (kitchenSceneModule.js, _kIntroPortalBegin /
 * _kIntroPortalTick) and the Office drawer (officeSceneModule.js,
 * setupDrawerPortalEffect): one source for both.
 *
 * Built (createPortalRing) at `centre`, facing `fwd` (its local +z = out of the
 * opening): its opening is a stencil mask (bit `stencilBit`), the depth reset to
 * "far" inside it, so the tunnel behind it (a deep glowing cylinder: dark at
 * the opening, blue-violet deeper in, soft bands, a bright core far away) can
 * be far deeper than whatever is behind the opening; the transition's coloured
 * streaks fly along it at every depth, a share carrying on through the opening
 * (unmasked past its plane); a burst wave of streaks on the opening; sparks;
 * its rim, a ring of coloured smoke (soft sprites with animated fbm noise,
 * glowing from the inner edge) with glowing particles orbiting in it; a
 * flash / gathering point, a soft haze, its light; electric arcs (jagged
 * camera-facing bolts) with their own light.
 *
 * Its sequence (tick(t), t in seconds since it started, on the settings' times):
 * the air charges (wisps swirling round a point, arcs crackling), gathers into a
 * point, a flash, the ring bursts open (ease-out-back), the tunnel forms, the
 * ring stays open, then collapses into the centre (spinning faster) and a small
 * closing flash. tick returns the phase values for the caller's own extras.
 *
 * `flow`: 1 (the Kitchen) the lines fly out of the ring; −1 the exact opposite,
 * sucked in: the streaks run from out past the opening into the tunnel's depth
 * (their heads leading inward), the burst wave converges into the opening, the
 * sparks and the drifting rim particles run their paths backwards (from out
 * there into the ring). In the shaders it only multiplies or branches on 1.0,
 * so with flow 1 every value is exactly the Kitchen's.
 */
import { TRANSITION_STRIP_COLORS } from "./transitionStrips.js";

/** The Kitchen intro portal's ring settings (kitchenSceneModule.js KITCHEN_INTRO_PORTAL's, the ring's part). */
export const PORTAL_RING_DEFAULTS = {
  buildUp: 1.0,
  gatherEnd: 1.6,
  flashSec: 0.28,
  burstEnd: 2.0,
  tunnelIn: [1.75, 2.35],
  carFrom: 2.2,
  carTo: 4.45,
  closeFrom: 4.6,
  closeTo: 5.2,
  radius: 1.55,
  tunnelDepth: 14,
  tunnelStreaks: 170,
  tunnelRadius: [0.25, 0.93],
  tunnelLen: [0.6, 1.8],
  tunnelWidth: [0.018, 0.04],
  tunnelSpeed: [7, 13],
  rimSpin: 0.55,
  gatherFrom: 2.4,
  smoke: { count: 150, size: [0.55, 0.95], thickness: 0.24, depth: 0.42, billow: 0.12, billowSpeed: [0.6, 1.4], alpha: 0.5, noiseScale: 2.6, noiseSpeed: 0.35, glow: 1.15, innerGlow: 0.9 },
  rimParticles: { count: 120, driftShare: 0.35, size: [2.5, 6], life: [0.9, 1.8], driftOut: 0.9, driftForward: 0.5 },
  glow: 2.2,
  tunnelColors: { near: 0x020310, deep: 0x3a30c8, core: 0xd7dcff },
  tunnelGlowCurve: 2.4,
  light: { color: 0x7d74ff, intensity: 6, flash: 26, closeFlash: 10, distance: 12 },
  arcs: { max: 18, segments: 12, regen: 0.045, life: [0.07, 0.2], width: [0.025, 0.05], buildRate: [3, 22], burst: 12, openRate: 1.6, closeRate: 16, tableShare: 0.2, jag: 0.22, glow: 2.6, light: 3.5 },
  escape: { distance: 5, spreadDeg: [1.5, 9], decel: 0.06, fadeStart: 0.45, floorFade: 0.35, steady: 0.3, burst: 1, burstWidth: 0.2, car: 0.85 },
  wave: { count: 70, speed: [6, 11] },
  sparks: { count: 70, life: [0.7, 1.4], speedOut: [1.2, 2.8], speedSide: [0.2, 1.0], size: [3, 7] },
};

// ---- Shaders (the Kitchen ring's; uFlow: 1 out, −1 in) ----

const STREAK_VS = `
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
        uniform float uFlow; // 1: out of the ring, -1: sucked into it
        uniform vec4 uEscLevels; // steady, burst, car, -
        uniform vec4 uEscTimes; // open from, burst at, burst width, close from
        uniform vec2 uEscCar; // car from, to
        varying vec3 vColor;
        varying float vSide;
        varying float vFade;
        varying float vLocalZ;
        varying float vFloor;
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
              // Its run: from deep in the tunnel, through the opening, out into the room (uEsc beyond it); flow -1: the reverse.
              float Lt = uDepth + uEsc;
              float q = aA.z - uTime * aA.w / Lt * uFlow;
              float k = floor(q);
              dHead = Lt * (q - k) - uEsc; // distance behind the opening (negative: out in the room)
              float tCross = uFlow * (aA.z - k - uEsc / Lt) * Lt / aA.w; // when its head crosses the opening
              float h = fract(sin(aE.z * 91.7 + k * 37.3) * 43758.5453);
              escapes = h < escapeAt(tCross);
            } else {
              float age = uTime - uWaveAt;
              // Out from the opening (flow 1), or in from uEsc out to it (flow -1).
              dHead = age < 0.0 ? 1e4 : (uFlow > 0.0 ? -age * aA.w : age * aA.w - uEsc);
              escapes = true;
            }
            // The head leads the way it moves (out: toward the opening; in: deeper).
            float dist = dHead + (1.0 - along) * len * uFlow;
            if (dist >= 0.0) {
              p = vec3(cos(aA.y) * aA.x, sin(aA.y) * aA.x, -dist);
              tangent = vec3(0.0, 0.0, 1.0);
              float nearFade = escapes ? 1.0 : smoothstep(0.0, 0.6, dist);
              vFade = nearFade * (1.0 - smoothstep(uDepth * 0.7, uDepth, dist)) * (0.55 + 0.45 * smoothstep(uDepth, 0.0, dist));
              if (uMode > 1.5) vFade = 0.0;
            } else {
              // Out in the room: straight on (a tight cone), barely slowing; pulled back along it when closing.
              float x = -dist;
              float xr = x * (1.0 - uSuck * uSuck);
              float xs = xr * (1.0 - uDecel * min(xr, uEsc) / (2.0 * uEsc));
              vec2 dir2 = vec2(cos(aA.y), sin(aA.y));
              p = vec3(dir2 * (aA.x + xs * aE.x), xs);
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
const STREAK_FS = `
        uniform float uGlow;
        uniform float uAlpha;
        uniform float uKeep; // 1: only inside the tunnel (z < 0), -1: only out in the room (z > 0), 0: all
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
const WALLS_VS = "varying float vD; varying float vA; void main() { vD = -position.z; vA = atan(position.y, position.x); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
const WALLS_FS = `
                uniform vec3 uNear; uniform vec3 uDeep; uniform float uTime; uniform float uCurve;
                varying float vD; varying float vA;
                void main() {
                  float k = pow(clamp(vD, 0.0, 1.0), uCurve);
                  float bands = 0.85 + 0.15 * sin(vA * 7.0 + vD * 18.0 - uTime * 6.0);
                  gl_FragColor = vec4(mix(uNear, uDeep, k) * bands, 1.0);
                }`;
const SPARKS_VS = `
                attribute vec4 aS; attribute vec4 aV; attribute vec3 aColor;
                uniform float uTime; uniform float uRing; uniform float uSuck; uniform float uFloorY; uniform float uFloorFade; uniform float uFlow;
                varying vec3 vColor; varying float vA;
                void main() {
                  float life = aS.w;
                  float age = fract(uTime / life + aS.z) * life;
                  if (uFlow < 0.0) age = life - age; // flow -1: its path run backwards (from out there into the ring)
                  float u = age / life;
                  vec2 dir = normalize(aS.xy + 1e-4);
                  vec3 p = vec3(aS.xy * uRing + dir * aV.y * age, aV.x * age * (1.0 - 0.3 * u));
                  p = mix(p, vec3(0.0), uSuck * uSuck);
                  vec4 wp = modelMatrix * vec4(p, 1.0);
                  vA = sin(3.14159 * u) * smoothstep(0.0, uFloorFade, wp.y - uFloorY) * (1.0 - smoothstep(0.55, 1.0, uSuck));
                  vec4 mv = viewMatrix * wp;
                  gl_Position = projectionMatrix * mv;
                  gl_PointSize = aV.z * 30.0 / max(0.2, -mv.z);
                  vColor = aColor;
                }`;
const SPARKS_FS = `
                uniform float uGlow; uniform float uLevel;
                varying vec3 vColor; varying float vA;
                void main() {
                  vec2 c = gl_PointCoord - 0.5;
                  float a = exp(-dot(c, c) * 14.0) * vA * uLevel;
                  gl_FragColor = vec4((vColor + 0.3) * uGlow * a, a);
                }`;
const SMOKE_VS = `
              attribute vec4 aS; attribute vec4 aT; attribute vec3 aColor;
              uniform float uTime; uniform float uRing; uniform float uSpin; uniform float uThick; uniform float uFloorY;
              uniform float uDepthS; uniform float uBillow; uniform float uSizeK;
              varying vec2 vUv; varying vec3 vColor; varying float vInner; varying float vSeed; varying float vFloor;
              void main() {
                float a = aS.x + uTime * uSpin * aT.y;
                float billow = 0.5 + 0.5 * sin(uTime * aT.z + aS.w * 6.2832);
                float r = uRing + aS.y * uThick + billow * uBillow;
                vec3 c = vec3(cos(a) * r, sin(a) * r, aS.z * uDepthS * 0.5);
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
const SMOKE_FS = `
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
const RIM_VS = `
                attribute vec4 aP; attribute vec4 aQ; attribute vec3 aColor;
                uniform float uTime; uniform float uRing; uniform float uSpin; uniform float uThick; uniform float uFloorY;
                uniform vec2 uDrift; uniform float uDepthS; uniform float uFlow;
                varying vec3 vColor; varying float vA;
                void main() {
                  float a = aP.x + uTime * uSpin * aQ.x * 1.3;
                  float out_ = 0.0, fwd = 0.0;
                  float alpha = 0.65 + 0.35 * sin(uTime * 4.0 + aP.w * 6.2832); // twinkle
                  if (aQ.y > 0.5) {
                    float u = fract(uTime / aQ.z + aP.w);
                    if (uFlow < 0.0) u = 1.0 - u; // flow -1: drifting in from out there, into the ring
                    out_ = u * uDrift.x;
                    fwd = u * uDrift.y;
                    alpha = sin(3.14159 * u);
                  }
                  float r = uRing + aP.y * uThick * 0.9 + out_;
                  vec3 c = vec3(cos(a) * r, sin(a) * r, aP.z * uDepthS * 0.5 + fwd);
                  vec4 wp = modelMatrix * vec4(c, 1.0);
                  vec4 mv = viewMatrix * wp;
                  gl_Position = projectionMatrix * mv;
                  gl_PointSize = aQ.w * 30.0 / max(0.2, -mv.z);
                  vA = alpha * smoothstep(0.0, 0.2, wp.y - uFloorY);
                  vColor = aColor;
                }`;
const RIM_FS = `
                uniform float uGlow; uniform float uAlpha;
                varying vec3 vColor; varying float vA;
                void main() {
                  vec2 c = gl_PointCoord - 0.5;
                  float a = exp(-dot(c, c) * 16.0) * vA * uAlpha;
                  gl_FragColor = vec4((vColor + 0.35) * uGlow * a, a);
                }`;
const ARC_VS = `
              attribute float aEdge; attribute float aAlpha; attribute vec3 aColor;
              varying float vEdge; varying float vAlpha; varying vec3 vColor;
              void main() { vEdge = aEdge; vAlpha = aAlpha; vColor = aColor; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ARC_FS = `
              uniform float uGlow;
              varying float vEdge; varying float vAlpha; varying vec3 vColor;
              void main() {
                float core = exp(-vEdge * vEdge * 14.0); // white-hot core
                float halo = exp(-vEdge * vEdge * 2.5);
                vec3 c = mix(vColor, vec3(1.0), core * 0.85) * uGlow;
                float a = (core + halo * 0.45) * vAlpha;
                gl_FragColor = vec4(c * a, a);
              }`;

/** A soft round glow texture (flash / haze / table glow). */
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

/** Stencil test "inside the opening" (bit `bit`) on a material. */
export function maskToOpening(THREE, m, bit) {
  m.stencilWrite = true;
  m.stencilRef = bit;
  m.stencilFunc = THREE.EqualStencilFunc;
  m.stencilFuncMask = bit;
  m.stencilWriteMask = 0;
  m.stencilFail = m.stencilZFail = m.stencilZPass = THREE.KeepStencilOp;
  return m;
}

const smoothRange = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The ring, built at o.centre facing o.fwd.
 * @param {object} o { P (settings: PORTAL_RING_DEFAULTS' shape), scene (arcs / lights / the ring itself unless `parent`),
 *   parent? (the ring's group and light go here instead, positioned with `localCentre`), centre (Vector3, world), fwd (unit),
 *   floorY (nothing below it), stencilBit, flow (1 out, -1 in), getCamera (for the arcs), bloomLayer? (layer to enable) }
 */
export function createPortalRing(THREE, o) {
  const P = o.P;
  const flow = o.flow ?? 1;
  const K = { centre: o.centre, fwd: o.fwd, top: o.floorY };
  K.uniforms = {
    uTime: { value: 0 },
    uDepth: { value: P.tunnelDepth },
    uRing: { value: P.radius },
    uSpin: { value: P.rimSpin },
    uThick: { value: P.smoke.thickness },
    uGlow: { value: P.glow },
    uEsc: { value: P.escape.distance },
    uDecel: { value: P.escape.decel },
    uFadeStart: { value: P.escape.fadeStart },
    uSuck: { value: 0 },
    uWaveAt: { value: P.burstEnd - 0.25 },
    uFloorY: { value: o.floorY },
    uFloorFade: { value: P.escape.floorFade },
    uFlow: { value: flow },
    uEscLevels: { value: new THREE.Vector4(P.escape.steady, P.escape.burst, P.escape.car, 0) },
    uEscTimes: { value: new THREE.Vector4(P.burstEnd, P.burstEnd, P.escape.burstWidth, P.closeFrom) },
    uEscCar: { value: new THREE.Vector2(P.carFrom + 0.5, P.carTo - 0.6) },
  };
  const layer = (m) => {
    if (o.bloomLayer != null) m.layers.enable(o.bloomLayer);
    return m;
  };
  const G = new THREE.Group();
  G.name = "introPortal";
  if (o.parent) {
    G.position.copy(o.localCentre);
    G.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), o.localFwd);
  } else {
    G.position.copy(o.centre);
    G.rotation.y = Math.atan2(o.fwd.x, o.fwd.z);
  }
  const M = new THREE.Group(); // the tunnel (scaled: x / y with the ring, z with its depth)
  G.add(M);
  const bit = o.stencilBit;
  // 1. The opening marks the stencil (only where it's visible: what's in front of it still hides it).
  const disc = new THREE.CircleGeometry(1, 64);
  const writer = new THREE.Mesh(
    disc,
    new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      transparent: true,
      side: THREE.FrontSide, // only from in front: from behind it's just the ring
      stencilWrite: true,
      stencilRef: bit,
      stencilWriteMask: bit,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
    }),
  );
  writer.renderOrder = 100;
  // 2. …and resets the depth there to "far", so the tunnel is drawn at its own depth (deeper than what's behind it).
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
  // 3. The tunnel's walls: dark at the opening, glowing brighter deeper in; a bright core far away.
  const walls = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 64, 24, true).rotateX(Math.PI / 2).translate(0, 0, -0.5),
    maskToOpening(
      THREE,
      new THREE.ShaderMaterial({
        uniforms: {
          uNear: { value: new THREE.Color(P.tunnelColors.near) },
          uDeep: { value: new THREE.Color(P.tunnelColors.deep) },
          uTime: K.uniforms.uTime,
          uCurve: { value: P.tunnelGlowCurve },
        },
        vertexShader: WALLS_VS,
        fragmentShader: WALLS_FS,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: true,
        toneMapped: false,
      }),
      bit,
    ),
  );
  walls.renderOrder = 102;
  const core = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48).translate(0, 0, -1),
    maskToOpening(
      THREE,
      new THREE.MeshBasicMaterial({
        map: portalGlowTexture(THREE),
        color: new THREE.Color(P.tunnelColors.core).multiplyScalar(1.4),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      bit,
    ),
  );
  core.renderOrder = 103;
  const unit = new THREE.Group(); // walls and core in unit size: x / y = radius, z = depth
  unit.add(walls, core);
  M.add(writer, resetter, unit);
  K.unit = unit;
  K.discs = [writer, resetter];
  // Instanced streaks (a ribbon per instance: x along 0..1, y across −1..1).
  const streaks = (count, mode, fill) => {
    const seg = 6; // its run bends where it leaves the tunnel (the cone)
    const g = new THREE.PlaneGeometry(1, 2, seg, 1);
    g.translate(0.5, 0, 0);
    const ig = new THREE.InstancedBufferGeometry().copy(g);
    ig.instanceCount = count;
    const A = new Float32Array(count * 4), B = new Float32Array(count * 4), E = new Float32Array(count * 4), C = new Float32Array(count * 3);
    const col = new THREE.Color();
    const X = P.escape;
    const D = Math.PI / 180;
    for (let i = 0; i < count; i++) {
      fill(i, A, B);
      // Out of the opening: straight on, in a tight cone.
      E[i * 4] = Math.tan((X.spreadDeg[0] + Math.random() * (X.spreadDeg[1] - X.spreadDeg[0])) * D);
      E[i * 4 + 2] = Math.random() * 100;
      col.set(TRANSITION_STRIP_COLORS[i % TRANSITION_STRIP_COLORS.length]);
      C[i * 3] = col.r;
      C[i * 3 + 1] = col.g;
      C[i * 3 + 2] = col.b;
    }
    ig.setAttribute("aA", new THREE.InstancedBufferAttribute(A, 4));
    ig.setAttribute("aB", new THREE.InstancedBufferAttribute(B, 4));
    ig.setAttribute("aE", new THREE.InstancedBufferAttribute(E, 4));
    ig.setAttribute("aColor", new THREE.InstancedBufferAttribute(C, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...K.uniforms, uMode: { value: mode }, uAlpha: { value: 1 }, uKeep: { value: 0 } },
      vertexShader: STREAK_VS,
      fragmentShader: STREAK_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(ig, mat);
    mesh.frustumCulled = false; // placed in the shader
    return mesh;
  };
  // 4. The streaks in the tunnel (at every depth).
  const tunnel = streaks(P.tunnelStreaks, 0, (i, A, B) => {
    A[i * 4] = P.radius * (P.tunnelRadius[0] + Math.sqrt(Math.random()) * (P.tunnelRadius[1] - P.tunnelRadius[0]));
    A[i * 4 + 1] = Math.random() * Math.PI * 2;
    A[i * 4 + 2] = Math.random();
    A[i * 4 + 3] = P.tunnelSpeed[0] + Math.random() * (P.tunnelSpeed[1] - P.tunnelSpeed[0]);
    B[i * 4] = P.tunnelLen[0] + Math.random() * (P.tunnelLen[1] - P.tunnelLen[0]);
    B[i * 4 + 1] = P.tunnelWidth[0] + Math.random() * (P.tunnelWidth[1] - P.tunnelWidth[0]);
  });
  maskToOpening(THREE, tunnel.material, bit);
  tunnel.material.uniforms.uKeep.value = 1; // its part inside the tunnel
  tunnel.renderOrder = 105;
  M.add(tunnel);
  K.tunnel = tunnel;
  // …and the same lines past the opening, out in the room (not masked): no cut at the opening.
  const tunnelOut = new THREE.Mesh(tunnel.geometry, tunnel.material.clone());
  tunnelOut.material.uniforms = { ...tunnel.material.uniforms, uKeep: { value: -1 }, uAlpha: { value: 1 } };
  for (const k of ["stencilWrite"]) tunnelOut.material[k] = false;
  tunnelOut.frustumCulled = false;
  tunnelOut.renderOrder = 106;
  layer(tunnelOut);
  G.add(tunnelOut);
  K.tunnelOut = tunnelOut;
  // The opening's single burst wave.
  const wave = streaks(P.wave.count, 2, (i, A, B) => {
    A[i * 4] = P.radius * (0.2 + 0.8 * Math.sqrt(Math.random()));
    A[i * 4 + 1] = Math.random() * Math.PI * 2;
    A[i * 4 + 3] = P.wave.speed[0] + Math.random() * (P.wave.speed[1] - P.wave.speed[0]);
    B[i * 4] = P.tunnelLen[0] + Math.random() * (P.tunnelLen[1] - P.tunnelLen[0]);
    B[i * 4 + 1] = P.tunnelWidth[0] + Math.random() * (P.tunnelWidth[1] - P.tunnelWidth[0]);
  });
  wave.material.uniforms.uKeep.value = -1;
  wave.renderOrder = 106;
  layer(wave);
  G.add(wave);
  K.wave = wave;
  // Sparks drifting along the opening's axis and fading in the air.
  {
    const S = P.sparks;
    const n = S.count;
    const aS = new Float32Array(n * 4), aV = new Float32Array(n * 4), aC = new Float32Array(n * 3);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.9;
      aS[i * 4] = Math.cos(a) * r;
      aS[i * 4 + 1] = Math.sin(a) * r;
      aS[i * 4 + 2] = Math.random();
      aS[i * 4 + 3] = S.life[0] + Math.random() * (S.life[1] - S.life[0]);
      aV[i * 4] = S.speedOut[0] + Math.random() * (S.speedOut[1] - S.speedOut[0]);
      aV[i * 4 + 1] = S.speedSide[0] + Math.random() * (S.speedSide[1] - S.speedSide[0]);
      aV[i * 4 + 2] = S.size[0] + Math.random() * (S.size[1] - S.size[0]);
      col.set(TRANSITION_STRIP_COLORS[i % TRANSITION_STRIP_COLORS.length]);
      aC[i * 3] = col.r;
      aC[i * 3 + 1] = col.g;
      aC[i * 3 + 2] = col.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aS", new THREE.BufferAttribute(aS, 4));
    g.setAttribute("aV", new THREE.BufferAttribute(aV, 4));
    g.setAttribute("aColor", new THREE.BufferAttribute(aC, 3));
    const sparks = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: K.uniforms.uTime,
          uRing: K.uniforms.uRing,
          uSuck: K.uniforms.uSuck,
          uFloorY: K.uniforms.uFloorY,
          uFloorFade: K.uniforms.uFloorFade,
          uGlow: K.uniforms.uGlow,
          uFlow: K.uniforms.uFlow,
          uLevel: { value: 0 },
        },
        vertexShader: SPARKS_VS,
        fragmentShader: SPARKS_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    sparks.frustumCulled = false;
    sparks.renderOrder = 106;
    layer(sparks);
    G.add(sparks);
    K.sparks = sparks;
  }
  // 5. The rim: a ring of coloured smoke (soft noise sprites at different radii and depths) and glowing particles.
  {
    const S = P.smoke;
    const n = S.count;
    const quad = new THREE.PlaneGeometry(1, 1);
    const ig = new THREE.InstancedBufferGeometry().copy(quad);
    ig.instanceCount = n;
    const aS = new Float32Array(n * 4), aT = new Float32Array(n * 4), aC = new Float32Array(n * 3);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      aS[i * 4] = (i / n) * Math.PI * 2 + Math.random() * 0.2; // angle round the ring
      aS[i * 4 + 1] = Math.random() * 2 - 1; // across it (−1 inner edge … 1 outer)
      aS[i * 4 + 2] = Math.random() * 2 - 1; // depth
      aS[i * 4 + 3] = Math.random(); // seed
      aT[i * 4] = S.size[0] + Math.random() * (S.size[1] - S.size[0]);
      aT[i * 4 + 1] = 0.75 + Math.random() * 0.5; // its share of the spin
      aT[i * 4 + 2] = S.billowSpeed[0] + Math.random() * (S.billowSpeed[1] - S.billowSpeed[0]);
      col.set(TRANSITION_STRIP_COLORS[i % TRANSITION_STRIP_COLORS.length]);
      aC[i * 3] = col.r;
      aC[i * 3 + 1] = col.g;
      aC[i * 3 + 2] = col.b;
    }
    ig.setAttribute("aS", new THREE.InstancedBufferAttribute(aS, 4));
    ig.setAttribute("aT", new THREE.InstancedBufferAttribute(aT, 4));
    ig.setAttribute("aColor", new THREE.InstancedBufferAttribute(aC, 3));
    const smokeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: K.uniforms.uTime,
        uRing: K.uniforms.uRing,
        uSpin: K.uniforms.uSpin,
        uThick: K.uniforms.uThick,
        uFloorY: K.uniforms.uFloorY,
        uDepthS: { value: S.depth },
        uBillow: { value: S.billow },
        uSizeK: { value: 1 },
        uAlpha: { value: 0 },
        uGlowS: { value: S.glow },
        uInner: { value: S.innerGlow },
        uNoise: { value: new THREE.Vector2(S.noiseScale, S.noiseSpeed) },
      },
      vertexShader: SMOKE_VS,
      fragmentShader: SMOKE_FS,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const smoke = new THREE.Mesh(ig, smokeMat);
    smoke.frustumCulled = false; // placed in the shader
    smoke.renderOrder = 106;
    smoke.userData.skipBloomDarken = true; // its own glow in the bloom mask
    G.add(smoke);
    K.smoke = smoke;
    // Particles orbiting with the smoke, a share drifting off into the air and fading.
    const Q = P.rimParticles;
    const m = Q.count;
    const pA = new Float32Array(m * 4), pB = new Float32Array(m * 4), pC = new Float32Array(m * 3);
    for (let i = 0; i < m; i++) {
      pA[i * 4] = Math.random() * Math.PI * 2;
      pA[i * 4 + 1] = Math.random() * 2 - 1;
      pA[i * 4 + 2] = Math.random() * 2 - 1;
      pA[i * 4 + 3] = Math.random();
      pB[i * 4] = 0.8 + Math.random() * 0.8;
      pB[i * 4 + 1] = Math.random() < Q.driftShare ? 1 : 0;
      pB[i * 4 + 2] = Q.life[0] + Math.random() * (Q.life[1] - Q.life[0]);
      pB[i * 4 + 3] = Q.size[0] + Math.random() * (Q.size[1] - Q.size[0]);
      col.set(TRANSITION_STRIP_COLORS[i % TRANSITION_STRIP_COLORS.length]);
      pC[i * 3] = col.r;
      pC[i * 3 + 1] = col.g;
      pC[i * 3 + 2] = col.b;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(m * 3), 3));
    pg.setAttribute("aP", new THREE.BufferAttribute(pA, 4));
    pg.setAttribute("aQ", new THREE.BufferAttribute(pB, 4));
    pg.setAttribute("aColor", new THREE.BufferAttribute(pC, 3));
    const particles = new THREE.Points(
      pg,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: K.uniforms.uTime,
          uRing: K.uniforms.uRing,
          uSpin: K.uniforms.uSpin,
          uThick: K.uniforms.uThick,
          uFloorY: K.uniforms.uFloorY,
          uGlow: K.uniforms.uGlow,
          uFlow: K.uniforms.uFlow,
          uAlpha: { value: 0 },
          uDrift: { value: new THREE.Vector2(Q.driftOut, Q.driftForward) },
          uDepthS: { value: S.depth },
        },
        vertexShader: RIM_VS,
        fragmentShader: RIM_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    particles.frustumCulled = false;
    particles.renderOrder = 107;
    layer(particles);
    G.add(particles);
    K.rimParticles = particles;
  }
  // 6. The flash / gathering point and a soft haze at the opening.
  const flash = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: portalGlowTexture(THREE), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  flash.renderOrder = 107;
  layer(flash);
  G.add(flash);
  K.flash = flash;
  const haze = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    new THREE.MeshBasicMaterial({ map: portalGlowTexture(THREE), color: new THREE.Color(P.light.color).multiplyScalar(0.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }),
  );
  haze.position.z = 0.05;
  haze.renderOrder = 107;
  haze.userData.skipBloomDarken = true; // its own glow in the bloom mask (not a black disc)
  G.add(haze);
  K.haze = haze;
  (o.parent || o.scene).add(G);
  K.group = G;
  K.masked = M;
  K.light = new THREE.PointLight(P.light.color, 0, P.light.distance, 1.6);
  if (o.parent) {
    K.light.position.copy(o.localCentre).addScaledVector(o.localFwd, 0.8);
    o.parent.add(K.light);
  } else {
    K.light.position.copy(o.centre).addScaledVector(o.fwd, 0.8);
    o.scene.add(K.light);
  }
  // The electric arcs and their light.
  K.arcs = buildArcs(THREE, P, layer);
  o.scene.add(K.arcs.mesh);
  K.arcs.light = new THREE.PointLight(0xc9d2ff, 0, 6, 1.8);
  o.scene.add(K.arcs.light);

  // ---- The electric arcs (world space, round the ring's current centre / axes) ----
  const _arcV = new THREE.Vector3();
  const _arcV2 = new THREE.Vector3();
  const _arcSide = new THREE.Vector3();
  const _u = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _f = new THREE.Vector3();
  const _c = new THREE.Vector3();
  /** The ring's centre, its out axis and its in-plane axes (u = its local x, v = its local y), in world space. */
  function frame() {
    if (o.getFrame) return o.getFrame(_c, _f, _u, _v);
    const f = o.fwd;
    _c.copy(o.centre);
    _f.copy(f);
    _u.set(f.z, 0, -f.x);
    _v.set(0, 1, 0);
  }
  function arcRingPoint(r, theta, out) {
    out.copy(_c).addScaledVector(_u, Math.cos(theta) * r);
    if (o.getFrame) out.addScaledVector(_v, Math.sin(theta) * r);
    else out.y += Math.sin(theta) * r;
    out.addScaledVector(_f, (Math.random() - 0.5) * 0.25);
    return out;
  }
  function jag(arc) {
    const A = P.arcs;
    const n = arc.pts.length - 1;
    const len = arc.a.distanceTo(arc.b);
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const p = arc.pts[i].lerpVectors(arc.a, arc.b, u);
      if (i > 0 && i < n) {
        const amp = A.jag * len * Math.sin(Math.PI * u);
        p.x += (Math.random() - 0.5) * 2 * amp;
        p.y += (Math.random() - 0.5) * 2 * amp;
        p.z += (Math.random() - 0.5) * 2 * amp;
      }
      if (p.y < K.top) p.y = K.top;
    }
  }
  /** Starts an arc: `kind` "build" (round the forming ring, some down to the floor), "burst" (shooting out), "rim", "close" (into the centre). */
  function spawnArc(kind, strength, ringR) {
    const A = P.arcs, X = K.arcs;
    const arc = X.pool.find((x) => !x.alive);
    if (!arc) return;
    const th = Math.random() * Math.PI * 2;
    const r = Math.max(0.15, ringR);
    if (kind === "burst") {
      arcRingPoint(r * 0.2, th, arc.a);
      arcRingPoint(r * (1.5 + Math.random() * 0.6), th + (Math.random() - 0.5) * 0.6, arc.b);
    } else if (kind === "close") {
      arcRingPoint(r, th, arc.a);
      arc.b.copy(_c);
    } else {
      arcRingPoint(r * (0.85 + Math.random() * 0.3), th, arc.a);
      if (kind === "build" && Math.random() < A.tableShare) {
        // Down to the floor: ending exactly on its surface.
        arc.b.set(arc.a.x + (Math.random() - 0.5) * 1.2, K.top, arc.a.z + (Math.random() - 0.5) * 1.2);
      } else {
        const span = (kind === "rim" ? 0.5 : 0.35 + 1.1 * strength) * (0.6 + Math.random() * 0.8);
        arcRingPoint(r * (0.85 + Math.random() * 0.3), th + span * (Math.random() < 0.5 ? -1 : 1), arc.b);
      }
    }
    arc.alive = true;
    arc.age = 0;
    arc.life = A.life[0] + Math.random() * (A.life[1] - A.life[0]) * (0.6 + 0.4 * strength);
    arc.regen = 0;
    arc.width = (A.width[0] + Math.random() * (A.width[1] - A.width[0])) * (0.6 + 0.5 * strength);
    arc.bright = 0.5 + 0.5 * strength;
    arc.color.set(TRANSITION_STRIP_COLORS[Math.floor(Math.random() * TRANSITION_STRIP_COLORS.length)]);
    jag(arc);
    // A brief flash of light where it lands.
    X.light.position.copy(arc.b);
    X.lightK = Math.max(X.lightK || 0, arc.bright);
  }
  /** t: the sequence's time (its phases), animT: the running clock (ageing; the same as t in the Kitchen). */
  function arcsTick(t, animT, ph) {
    const A = P.arcs, X = K.arcs;
    const dt = Math.max(0, Math.min(0.1, animT - (X.lastT ?? animT)));
    X.lastT = animT;
    frame();
    // Spawning by phase.
    let rate = 0, kind = "rim", strength = 0.5;
    const ringR = K.uniforms.uRing.value;
    if (t < P.gatherEnd) {
      strength = ph.build * 0.7 + ph.gather * 0.3;
      rate = A.buildRate[0] + (A.buildRate[1] - A.buildRate[0]) * strength * strength;
      kind = "build";
    } else if (t >= P.closeFrom && t < P.closeTo) {
      rate = A.closeRate;
      kind = "close";
      strength = 0.8;
    } else if (t >= P.burstEnd && t < P.closeFrom) {
      rate = A.openRate;
      kind = "rim";
      strength = 0.6;
    }
    if (!X.burstDone && t >= P.gatherEnd) {
      X.burstDone = true;
      for (let i = 0; i < A.burst; i++) spawnArc("burst", 1, P.radius);
    }
    X.spawnAcc += rate * dt;
    while (X.spawnAcc >= 1) {
      X.spawnAcc -= 1;
      spawnArc(kind, strength, kind === "close" ? ringR : t < P.gatherEnd ? Math.max(ringR, P.radius * 0.5) : P.radius);
    }
    // Age, redraw every few frames, write the ribbons (facing the camera).
    const geo = X.mesh.geometry;
    const pos = geo.attributes.position.array, al = geo.attributes.aAlpha.array, col = geo.attributes.aColor.array;
    const cam = o.getCamera().position;
    const pts = A.segments + 1;
    X.pool.forEach((arc, ai) => {
      const base = ai * pts * 2;
      if (arc.alive) {
        arc.age += dt;
        arc.regen += dt;
        if (arc.age >= arc.life) arc.alive = false;
        else if (arc.regen >= A.regen) {
          arc.regen = 0;
          jag(arc);
        }
      }
      const k = arc.alive ? arc.bright * Math.sin(Math.PI * Math.min(1, arc.age / arc.life)) ** 0.5 * (0.7 + 0.3 * Math.random()) : 0;
      for (let i = 0; i < pts; i++) {
        const p = arc.pts[i];
        const q = arc.pts[Math.min(pts - 1, i + 1)], oo = arc.pts[Math.max(0, i - 1)];
        _arcV.subVectors(q, oo);
        _arcV2.subVectors(cam, p);
        _arcSide.crossVectors(_arcV, _arcV2).normalize().multiplyScalar(arc.width);
        const v = (base + i * 2) * 3;
        pos[v] = p.x - _arcSide.x; pos[v + 1] = Math.max(K.top, p.y - _arcSide.y); pos[v + 2] = p.z - _arcSide.z;
        pos[v + 3] = p.x + _arcSide.x; pos[v + 4] = Math.max(K.top, p.y + _arcSide.y); pos[v + 5] = p.z + _arcSide.z;
        al[base + i * 2] = al[base + i * 2 + 1] = k;
        col[v] = col[v + 3] = arc.color.r;
        col[v + 1] = col[v + 4] = arc.color.g;
        col[v + 2] = col[v + 5] = arc.color.b;
      }
    });
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    // Their light flash, fading quickly.
    X.lightK = Math.max(0, (X.lightK || 0) - dt * 9);
    X.light.intensity = A.light * X.lightK * (0.6 + 0.4 * Math.random());
  }

  /**
   * The ring's sequence at time t (s since it started; `animT`: its animation clock, t by default). Returns the
   * phases { build, gather, ring, close, flashOpen, flashClose } for the caller's own extras.
   */
  K.tick = function tick(t, animT = t) {
    K.uniforms.uTime.value = animT;
    // Phases.
    const build = smoothRange(0, P.buildUp, t); // the air charging
    const gather = smoothRange(P.buildUp, P.gatherEnd, t);
    const bu = Math.min(1, Math.max(0, (t - P.gatherEnd) / (P.burstEnd - P.gatherEnd)));
    const burst = bu <= 0 ? 0 : 1 + 2.2 * Math.pow(bu - 1, 3) + 1.2 * Math.pow(bu - 1, 2); // ease-out-back
    const close = smoothRange(P.closeFrom, P.closeTo, t);
    const ring = burst * (1 - close * close);
    const depth = smoothRange(P.tunnelIn[0], P.tunnelIn[1], t) * (1 - smoothRange(P.closeFrom, P.closeTo, t));
    const flashOpen = t >= P.gatherEnd ? Math.max(0, 1 - (t - P.gatherEnd) / P.flashSec) : 0;
    const flashClose = t >= P.closeTo ? Math.max(0, 1 - (t - P.closeTo) / P.flashSec) : 0;
    // The rim: wisps swirling round a point while the air charges, gathering in, then the ring (spinning faster as it collapses).
    const swirlR = P.radius * 0.45; // the build-up's swirl
    const rimR =
      t < P.buildUp ? P.radius * (1.1 - 0.65 * build) :
      t < P.gatherEnd ? swirlR * (1 - gather * gather) :
      P.radius * ring;
    K.uniforms.uRing.value = Math.max(0.001, rimR);
    K.uniforms.uSpin.value = P.rimSpin * (1 + 3 * close + (t < P.gatherEnd ? 2.5 * build : 0));
    K.uniforms.uThick.value = P.smoke.thickness * (t < P.gatherEnd ? 0.6 + 1.2 * (1 - gather) : Math.max(0.2, ring));
    // Smoke: faint wisps in the build-up, gathering in, bursting into the ring, its last wisps fading after the closing flash.
    const smokeIn = t < P.buildUp ? 0.12 + 0.3 * build : t < P.gatherEnd ? Math.min(1, 0.42 + gather * 0.8) : Math.min(1, 0.35 + ring);
    const wisps = t >= P.closeTo ? Math.max(0, 1 - (t - P.closeTo) / (P.flashSec * 1.6)) : 1;
    K.smoke.material.uniforms.uAlpha.value = P.smoke.alpha * smokeIn * wisps;
    K.smoke.material.uniforms.uSizeK.value = t < P.gatherEnd ? 0.45 + 0.3 * build + 0.25 * gather : Math.max(0.35, Math.min(1.1, ring));
    K.rimParticles.material.uniforms.uAlpha.value = smokeIn * wisps;
    // The tunnel: its opening grows with the ring, its depth forms after the burst (and collapses when closing).
    const open = ring > 0.01 && depth > 0.001;
    K.masked.visible = open;
    if (open) {
      const r = P.radius * ring * 0.97;
      for (const d of K.discs) d.scale.setScalar(r);
      K.unit.scale.set(r, r, P.tunnelDepth * depth);
      K.tunnel.scale.set(ring, ring, depth);
      K.uniforms.uDepth.value = P.tunnelDepth;
      K.tunnel.material.uniforms.uAlpha.value = depth;
    }
    // Out in the room: the escaping lines (same scale), the burst wave and the sparks; pulled back when closing.
    K.tunnelOut.visible = open || close > 0;
    K.tunnelOut.scale.set(Math.max(0.001, ring), Math.max(0.001, ring), Math.max(0.001, depth));
    K.tunnelOut.material.uniforms.uAlpha.value = Math.min(1, depth * 1.5);
    K.uniforms.uSuck.value = close;
    K.wave.visible = t >= P.burstEnd - 0.3;
    const escNow = Math.max(P.escape.steady * (t > P.burstEnd && t < P.closeFrom ? 1 : 0), P.escape.burst * Math.exp(-Math.pow((t - P.burstEnd) / P.escape.burstWidth, 2)), t > P.carFrom + 0.5 && t < P.carTo - 0.4 ? P.escape.car : 0);
    K.sparks.material.uniforms.uLevel.value = Math.min(1, escNow * 1.5 + close * 0.5) * Math.min(1, ring * 1.2);
    // Flash / gathering point and the haze.
    const point = Math.max(t < P.gatherEnd ? 0.15 * build + gather * 0.7 : 0, flashOpen, flashClose * 0.8);
    K.flash.visible = point > 0.003;
    K.flash.material.opacity = point;
    K.flash.scale.setScalar(P.radius * (0.35 + 1.4 * Math.max(flashOpen, flashClose * 0.6)));
    K.haze.scale.setScalar(Math.max(0.001, P.radius * 1.25 * ring));
    K.haze.material.opacity = 0.55 * ring;
    K.light.intensity =
      P.light.intensity * Math.max(ring, 0.25 * build * (1 - gather)) * (0.85 + 0.15 * Math.sin(animT * 9)) +
      P.light.flash * flashOpen + P.light.closeFlash * flashClose;
    const ph = { build, gather, ring, close, flashOpen, flashClose };
    // Electric arcs.
    arcsTick(t, animT, ph);
    return ph;
  };
  /** Back to its start (all arcs gone) for another run. */
  K.reset = function reset() {
    const X = K.arcs;
    for (const arc of X.pool) arc.alive = false;
    X.spawnAcc = 0;
    X.burstDone = false;
    X.lastT = undefined;
    X.lightK = 0;
    X.light.intensity = 0;
    K.light.intensity = 0;
  };
  /** Removed completely. */
  K.dispose = function dispose() {
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
    if (K.group) {
      if (K.group.parent) K.group.parent.remove(K.group);
      disposeTree(K.group);
    }
    if (K.light) {
      if (K.light.parent) K.light.parent.remove(K.light);
      K.light.dispose();
    }
    if (K.arcs) {
      o.scene.remove(K.arcs.mesh);
      disposeTree(K.arcs.mesh);
      o.scene.remove(K.arcs.light);
      K.arcs.light.dispose();
    }
    K.group = K.masked = K.smoke = K.rimParticles = K.flash = K.haze = K.tunnel = K.unit = null;
    K.tunnelOut = K.wave = K.sparks = K.light = K.arcs = null;
  };
  return K;
}

/** The electric arcs' ribbons (one per arc, camera-facing), redrawn every few frames. */
function buildArcs(THREE, P, layer) {
  const A = P.arcs;
  const n = A.max, pts = A.segments + 1;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * pts * 2 * 3);
  const edge = new Float32Array(n * pts * 2);
  const alpha = new Float32Array(n * pts * 2);
  const color = new Float32Array(n * pts * 2 * 3);
  const index = [];
  for (let a = 0; a < n; a++) {
    for (let i = 0; i < pts; i++) {
      const v = (a * pts + i) * 2;
      edge[v] = -1;
      edge[v + 1] = 1;
      if (i < pts - 1) index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute("aEdge", new THREE.BufferAttribute(edge, 1));
  g.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute("aColor", new THREE.BufferAttribute(color, 3).setUsage(THREE.DynamicDrawUsage));
  g.setIndex(index);
  const mesh = new THREE.Mesh(
    g,
    new THREE.ShaderMaterial({
      uniforms: { uGlow: { value: A.glow } },
      vertexShader: ARC_VS,
      fragmentShader: ARC_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 108;
  layer(mesh);
  mesh.userData.skipBloomDarken = true;
  const pool = Array.from({ length: n }, () => ({
    alive: false, age: 0, life: 0, regen: 0, a: new THREE.Vector3(), b: new THREE.Vector3(), width: 0.03, bright: 1,
    color: new THREE.Color(), pts: Array.from({ length: pts }, () => new THREE.Vector3()),
  }));
  return { mesh, pool, spawnAcc: 0, burstDone: false, light: null };
}
