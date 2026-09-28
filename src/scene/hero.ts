// FE-02: galaxy / nebula hero section (SectionModule id "hero").
//
// - Procedural spiral galaxy: >= 50k particles, generated once on the CPU.
//   All animation (slow rotation + small epicyclic wobble) happens in the
//   vertex shader from a single time uniform; buffers are never re-uploaded.
// - Soft nebula: one large camera-facing quad behind the galaxy with an fbm
//   noise fragment shader and a radial fade (no visible edges).
// - The title overlay is static HTML in index.html (`#hero .hero-overlay`),
//   styled by src/styles/hero.css.
//
// Timing follows C4: time comes only from onTick's `dt` (never ctx.clock), and
// it is accumulated locally only while active and not reduced-motion, so there
// is no jump when the section is re-activated or motion is re-enabled.
import * as THREE from 'three';
import type { SceneContext, SectionModule } from './core';
import { mulberry32 } from './starfield';
import '../styles/hero.css';

export interface GalaxyOptions {
  count?: number; // particles, default 60,000 (AC: >= 50,000)
  arms?: number; // spiral arm count, default 4
  radius?: number; // galaxy radius in scene units, default 100
  spin?: number; // arm winding in radians from centre to edge, default 5
  scatter?: number; // arm scatter 0..1, default 0.4
  thickness?: number; // disc half-thickness relative to radius, default 0.06
  bulgeFraction?: number; // fraction of particles in the central bulge, default 0.16
  coreColor?: THREE.ColorRepresentation; // sRGB, default warm #ffd49a
  edgeColor?: THREE.ColorRepresentation; // sRGB, default blue #5d8cff
  seed?: number;
}

export interface HeroOptions extends GalaxyOptions {
  /** World-space centre of the galaxy. Default HERO_ANCHOR. */
  anchor?: THREE.Vector3;
  /** Rotation speed of the pattern in rad/s. Default 0.025 (~4 min/turn). */
  rotationSpeed?: number;
  /** If true (default), init() moves the camera to heroCameraView(). */
  claimCamera?: boolean;
}

export interface GalaxyData {
  positions: Float32Array; // xyz, galaxy-local, disc in the XZ plane
  colors: Float32Array; // linear RGB, pre-scaled by brightness
  sizes: Float32Array; // world-ish size factor (attenuated in the shader)
  phases: Float32Array; // random phase for the wobble
}

export const DEFAULT_GALAXY_COUNT = 60_000;
export const DEFAULT_ARMS = 4;
export const DEFAULT_GALAXY_RADIUS = 100;
/** Far from the solar system (origin, Neptune ~274 u) so the two never overlap. */
export const HERO_ANCHOR: Readonly<THREE.Vector3> = new THREE.Vector3(0, 0, -3000);

/** Suggested camera keyframe for the hero (FE-04). Galaxy sits in the lower part of the frame. */
export function heroCameraView(
  anchor: THREE.Vector3 = HERO_ANCHOR.clone(),
  radius = DEFAULT_GALAXY_RADIUS,
): { position: THREE.Vector3; target: THREE.Vector3 } {
  return {
    position: anchor.clone().add(new THREE.Vector3(0, 1.15 * radius, 1.75 * radius)),
    target: anchor.clone().add(new THREE.Vector3(0, 0.42 * radius, 0)),
  };
}

function gauss(rand: () => number): number {
  // Box-Muller, one sample.
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Pure, deterministic particle layout. No GPU / DOM access (unit-testable). */
export function generateGalaxy(opts: GalaxyOptions = {}): GalaxyData {
  const count = opts.count ?? DEFAULT_GALAXY_COUNT;
  const arms = opts.arms ?? DEFAULT_ARMS;
  const R = opts.radius ?? DEFAULT_GALAXY_RADIUS;
  const spin = opts.spin ?? 5;
  const scatter = opts.scatter ?? 0.4;
  const thickness = opts.thickness ?? 0.06;
  const bulgeFraction = opts.bulgeFraction ?? 0.16;
  if (!Number.isInteger(arms) || arms < 1) throw new RangeError('arms must be an integer >= 1');
  if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be an integer >= 1');

  const rand = mulberry32(opts.seed ?? 7);
  const core = new THREE.Color(opts.coreColor ?? 0xffd49a); // sRGB in, stored linear
  const edge = new THREE.Color(opts.edgeColor ?? 0x5d8cff);
  const hii = new THREE.Color(0xff6fae);
  const c = new THREE.Color();

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    let x: number;
    let y: number;
    let z: number;
    let bright: number;
    let pink = false;
    if (rand() < bulgeFraction) {
      // Flattened gaussian bulge.
      x = gauss(rand) * 0.11 * R;
      y = gauss(rand) * 0.055 * R;
      z = gauss(rand) * 0.11 * R;
      bright = 0.35 + 0.35 * rand();
    } else {
      const arm = Math.floor(rand() * arms);
      const t = 0.04 + 0.96 * Math.pow(rand(), 0.85); // radial fraction
      const r = t * R;
      const angle = (arm / arms) * Math.PI * 2 + t * spin;
      // Power-law scatter: dense arm spines, soft falloff between arms.
      const s = scatter * r * 0.5;
      const off = (): number => Math.pow(rand(), 2.6) * (rand() < 0.5 ? -1 : 1) * s;
      x = Math.cos(angle) * r + off();
      z = Math.sin(angle) * r + off();
      y = gauss(rand) * thickness * R * (1 - 0.6 * t);
      bright = 0.3 + 0.5 * Math.pow(rand(), 2);
      pink = t > 0.25 && rand() < 0.012; // HII regions along the arms
    }
    const rr = Math.min(1, Math.hypot(x, z) / R);
    // Core-to-edge gradient (eased so the warm core stays compact).
    c.copy(core).lerp(edge, Math.pow(rr, 0.55));
    if (pink) {
      c.copy(hii);
      bright = 0.6;
    }
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    colors[i * 3] = c.r * bright;
    colors[i * 3 + 1] = c.g * bright;
    colors[i * 3 + 2] = c.b * bright;
    sizes[i] = (pink ? 1.8 : 0.9) + 1.6 * Math.pow(rand(), 5);
    phases[i] = rand() * Math.PI * 2;
  }
  return { positions, colors, sizes, phases };
}

const galaxyVertex = /* glsl */ `
  uniform float uTime;       // local section time (s), frozen when inactive/reduced motion
  uniform float uSpeed;      // pattern rotation, rad/s
  uniform float uRadius;
  uniform float uPixelRatio;
  uniform float uAtten;      // px at distance 1 per size unit
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aPhase;
  varying vec3 vColor;

  void main() {
    vec3 p = position;
    float r = length(p.xz) / uRadius;
    // Rigid pattern rotation (arms never wind up) ...
    float a = uTime * uSpeed;
    float ca = cos(a), sa = sin(a);
    p.xz = mat2(ca, sa, -sa, ca) * p.xz;
    // ... plus a small, bounded epicyclic wobble so the disc feels alive.
    float w = uTime * (0.35 + 0.4 * (1.0 - r)) + aPhase;
    p.xz += vec2(cos(w), sin(w)) * (0.25 + 0.6 * r);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * uPixelRatio * uAtten / max(-mv.z, 0.001), 1.0, 48.0);
    vColor = aColor;
  }
`;

const galaxyFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float a = 1.0 - d;
    if (a <= 0.0) discard;
    a = a * a;
    gl_FragColor = vec4(vColor * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const nebulaVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const nebulaFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uIntensity;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, amp = 0.5;
    for (int i = 0; i < 4; i++) { v += amp * noise(p); p = p * 2.03 + 17.1; amp *= 0.5; }
    return v;
  }

  void main() {
    vec2 p = (vUv - 0.5) * vec2(3.2, 2.0);
    float t = uTime * 0.012;
    // Domain warp for wispy filaments.
    vec2 q = vec2(fbm(p * 1.4 + t), fbm(p * 1.4 - t + 5.2));
    float n = fbm(p * 1.8 + 2.2 * q);
    float cloud = smoothstep(0.42, 0.95, n);
    // Radial fade so the quad's edges are never visible.
    float mask = 1.0 - smoothstep(0.25, 0.5, length(vUv - 0.5));
    vec3 col = mix(uColorA, uColorB, clamp(q.x * 1.3 - 0.15, 0.0, 1.0));
    gl_FragColor = vec4(col * cloud * mask * uIntensity, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface HeroSection extends SectionModule {
  readonly points: THREE.Points;
  readonly nebula: THREE.Mesh;
  readonly galaxyMaterial: THREE.ShaderMaterial;
  readonly nebulaMaterial: THREE.ShaderMaterial;
  isActive(): boolean;
}

export function createHero(opts: HeroOptions = {}): HeroSection {
  const radius = opts.radius ?? DEFAULT_GALAXY_RADIUS;
  const anchor = (opts.anchor ?? HERO_ANCHOR).clone();
  const speed = opts.rotationSpeed ?? 0.025;
  const view = heroCameraView(anchor, radius);

  const group = new THREE.Group();
  group.name = 'hero';
  group.position.copy(anchor);

  // --- galaxy ---------------------------------------------------------------
  const data = generateGalaxy({ ...opts, radius });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(data.colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(data.sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(data.phases, 1));
  // Rotation/wobble happen on the GPU; give culling a sphere that covers them.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.3);

  const galaxyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: speed },
      uRadius: { value: radius },
      uPixelRatio: { value: 1 },
      uAtten: { value: 260 },
    },
    vertexShader: galaxyVertex,
    fragmentShader: galaxyFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, galaxyMaterial);
  points.name = 'hero-galaxy';
  points.rotation.z = 0.12; // slight tilt so the disc is not perfectly level
  group.add(points);

  // --- nebula (behind the galaxy, facing the hero camera) --------------------
  const nebulaMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(0x7a2d8f) }, // linear after conversion
      uColorB: { value: new THREE.Color(0x1d5c8a) },
      uIntensity: { value: 1.8 },
    },
    vertexShader: nebulaVertex,
    fragmentShader: nebulaFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const nebulaGeometry = new THREE.PlaneGeometry(radius * 12, radius * 7.5);
  const nebula = new THREE.Mesh(nebulaGeometry, nebulaMaterial);
  nebula.name = 'hero-nebula';
  nebula.renderOrder = -10; // after the starfield (-1000), before the galaxy
  {
    // Place it 3 radii behind the galaxy centre along the hero view direction.
    const dir = view.target.clone().sub(view.position).normalize();
    const local = view.target.clone().sub(anchor).addScaledVector(dir, radius * 3);
    nebula.position.copy(local);
    // Not parented yet, so lookAt works in group-local space: face the camera's local position.
    nebula.lookAt(view.position.clone().sub(anchor));
  }
  group.add(nebula);

  const gU = galaxyMaterial.uniforms as { uTime: THREE.IUniform<number>; uPixelRatio: THREE.IUniform<number> };
  const nU = nebulaMaterial.uniforms as { uTime: THREE.IUniform<number> };

  let ctx: SceneContext | null = null;
  let unsubscribe: (() => void) | null = null;
  let active = false;
  let time = 0;

  const tick = (dt: number): void => {
    if (!ctx) return;
    gU.uPixelRatio.value = ctx.renderer.getPixelRatio();
    if (ctx.reducedMotion) return; // freeze animation (C4: read per frame)
    time += dt;
    gU.uTime.value = time;
    nU.uTime.value = time;
  };

  const section: HeroSection = {
    id: 'hero',
    group,
    points,
    nebula,
    galaxyMaterial,
    nebulaMaterial,
    async init(c: SceneContext): Promise<void> {
      if (ctx) return;
      ctx = c;
      gU.uPixelRatio.value = c.renderer.getPixelRatio();
      c.scene.add(group);
      if (opts.claimCamera ?? true) {
        c.camera.position.copy(view.position);
        c.camera.lookAt(view.target);
      }
      // Hero is the landing section: active by default until FE-04 drives it.
      section.setActive(true);
    },
    setActive(on: boolean): void {
      if (!ctx) {
        active = false;
        return;
      }
      if (on === active) return;
      active = on;
      group.visible = on; // inactive = no draw calls either
      if (on) unsubscribe = ctx.onTick(tick);
      else {
        unsubscribe?.();
        unsubscribe = null;
      }
    },
    isActive: () => active,
    dispose(): void {
      unsubscribe?.();
      unsubscribe = null;
      active = false;
      ctx?.scene.remove(group);
      ctx = null;
      geometry.dispose();
      galaxyMaterial.dispose();
      nebulaGeometry.dispose();
      nebulaMaterial.dispose();
    },
  };
  return section;
}
