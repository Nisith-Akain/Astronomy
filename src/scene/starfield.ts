// FE-01: background starfield. Points on a large sphere that follows the
// camera (so stars behave as if infinitely far away), with per-star size,
// colour temperature and a shader-driven twinkle.
import * as THREE from 'three';
import type { SceneContext } from './core';

export interface StarfieldOptions {
  count?: number; // default 8000 (AC: >= 5000)
  radius?: number; // default 5000 scene units; must stay < camera.far
  twinkle?: number; // twinkle amplitude 0..1, default 0.35
  seed?: number; // deterministic layout
}

export interface Starfield {
  points: THREE.Points;
  material: THREE.ShaderMaterial;
  dispose(): void;
}

export interface StarData {
  positions: Float32Array; // xyz
  colors: Float32Array; // linear RGB
  sizes: Float32Array; // px at DPR 1
  twinkle: Float32Array; // (phase rad, speed rad/s)
}

export const DEFAULT_STAR_COUNT = 8000;
export const DEFAULT_STAR_RADIUS = 5000;
export const DEFAULT_TWINKLE = 0.35;

/** Small deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Black-body colour temperature (K) -> sRGB in 0..1 (Tanner Helland fit). */
export function kelvinToSrgb(kelvin: number): [number, number, number] {
  const t = Math.min(Math.max(kelvin, 1000), 40000) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number): number => Math.min(Math.max(v, 0), 255) / 255;
  return [c(r), c(g), c(b)];
}

export function generateStars(count: number, radius: number, seed = 1): StarData {
  const rand = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const twinkle = new Float32Array(count * 2);
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    // Uniform on the sphere.
    const z = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    positions[i * 3] = radius * r * Math.cos(phi);
    positions[i * 3 + 1] = radius * z;
    positions[i * 3 + 2] = radius * r * Math.sin(phi);

    // Mostly warm/white stars, a minority of hot blue ones.
    const kelvin = 2800 + 12000 * Math.pow(rand(), 2.2);
    const [sr, sg, sb] = kelvinToSrgb(kelvin);
    // Power-law brightness: many faint stars, few bright ones.
    const bright = 0.45 + 0.55 * Math.pow(rand(), 3);
    color.setRGB(sr, sg, sb, THREE.SRGBColorSpace); // stored linear
    colors[i * 3] = color.r * bright;
    colors[i * 3 + 1] = color.g * bright;
    colors[i * 3 + 2] = color.b * bright;

    sizes[i] = 1.5 + 3.5 * Math.pow(rand(), 4);

    twinkle[i * 2] = rand() * Math.PI * 2;
    twinkle[i * 2 + 1] = 0.6 + rand() * 2.4;
  }
  return { positions, colors, sizes, twinkle };
}

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uTwinkle;
  uniform float uPixelRatio;
  attribute vec3 aColor;
  attribute float aSize;
  attribute vec2 aTwinkle;
  varying vec3 vColor;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float phase = aTwinkle.x;
    float speed = aTwinkle.y;
    // Two incommensurate sines give an irregular flicker in 0..1.
    float f = (0.5 + 0.5 * sin(uTime * speed + phase))
            * (0.5 + 0.5 * sin(uTime * speed * 1.73 + phase * 2.31));
    float tw = 1.0 - uTwinkle * f;
    vColor = aColor * tw;
    gl_PointSize = aSize * uPixelRatio * (0.8 + 0.2 * tw);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float a = 1.0 - smoothstep(0.0, 1.0, d);
    a *= a;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createStarfield(ctx: SceneContext, opts: StarfieldOptions = {}): Starfield {
  const count = opts.count ?? DEFAULT_STAR_COUNT;
  const radius = opts.radius ?? DEFAULT_STAR_RADIUS;
  const amplitude = opts.twinkle ?? DEFAULT_TWINKLE;
  const data = generateStars(count, radius, opts.seed ?? 1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(data.colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(data.sizes, 1));
  geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(data.twinkle, 2));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uTwinkle: { value: ctx.reducedMotion ? 0 : amplitude },
      uPixelRatio: { value: ctx.renderer.getPixelRatio() },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false, // keep point stars crisp; ACES would dim them
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'starfield';
  points.frustumCulled = false;
  points.renderOrder = -1000;
  ctx.scene.add(points);

  const uniforms = material.uniforms as {
    uTime: THREE.IUniform<number>;
    uTwinkle: THREE.IUniform<number>;
    uPixelRatio: THREE.IUniform<number>;
  };

  const unsubscribe = ctx.onTick((_dt, elapsed) => {
    // Follow the camera so the sky never parallaxes.
    points.position.copy(ctx.camera.position);
    uniforms.uPixelRatio.value = ctx.renderer.getPixelRatio();
    if (ctx.reducedMotion) {
      uniforms.uTwinkle.value = 0;
    } else {
      uniforms.uTwinkle.value = amplitude;
      uniforms.uTime.value = elapsed;
    }
  });

  return {
    points,
    material,
    dispose() {
      unsubscribe();
      ctx.scene.remove(points);
      geometry.dispose();
      material.dispose();
    },
  };
}
