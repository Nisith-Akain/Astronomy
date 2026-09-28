// FE-04: camera keyframes and the CatmullRom flight path. Pure three.js maths
// (no DOM, no renderer) so it can be unit-tested in node.
//
// The path parameter p runs 0..4 (see scrollMath.scrollToPath):
//   0    hero view (FE-02 heroCameraView)
//   1.5  solar-system overview (the pose FE-03 flies to when it has control)
//   2..3 alongside the drifting probe
//   4    outro: pulled far back, the probe a speck against the starfield
import * as THREE from 'three';
import { heroCameraView } from './hero';

// --- probe placement (world units; the probe model is 1 u = 1 m, ~7 m wide) ---
/** Probe position at probe progress 0: beyond Neptune (~274 u), "down-screen" from the overview. */
export const PROBE_START: Readonly<THREE.Vector3> = new THREE.Vector3(120, 20, -480);
/** Unit travel direction (the probe's -Z / forward), pointing away from the Sun. */
export const PROBE_DIRECTION: Readonly<THREE.Vector3> = new THREE.Vector3(0.24, 0.02, -0.97).normalize();
/** Distance drifted over the probe section (progress 0 -> 1). */
export const PROBE_DRIFT = 30;

/** Probe position for probe-section progress 0..1 (clamped). */
export function probePosition(progress01: number, out = new THREE.Vector3()): THREE.Vector3 {
  const t = Math.min(1, Math.max(0, progress01));
  return out.copy(PROBE_START).addScaledVector(PROBE_DIRECTION, PROBE_DRIFT * t);
}

/** Orientation that points the model's -Z (C5 forward) along PROBE_DIRECTION, +Y up. */
export function probeQuaternion(out = new THREE.Quaternion()): THREE.Quaternion {
  // Matrix4.lookAt makes +Z = eye - target, so eye=0, target=dir gives -Z = dir.
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), PROBE_DIRECTION, new THREE.Vector3(0, 1, 0));
  return out.setFromRotationMatrix(m);
}

/** World point for an offset given in the probe's frame (+X right, +Y up, -Z forward). */
function alongside(progress01: number, offset: [number, number, number]): THREE.Vector3 {
  const q = probeQuaternion();
  return probePosition(progress01).add(new THREE.Vector3(...offset).applyQuaternion(q));
}

// --- solar-system overview: mirrors FE-03's OVERVIEW_* constants (not exported
// by solarSystem.ts). A mismatch is harmless: FE-03 blends from our pose.
export const SOLAR_OVERVIEW_TARGET: Readonly<THREE.Vector3> = new THREE.Vector3(0, 0, 30);
const OVERVIEW_DISTANCE = 640;
const OVERVIEW_ELEVATION = 0.63;
export const SOLAR_OVERVIEW_POSITION: Readonly<THREE.Vector3> = SOLAR_OVERVIEW_TARGET.clone().add(
  new THREE.Vector3(0, OVERVIEW_DISTANCE * Math.sin(OVERVIEW_ELEVATION), OVERVIEW_DISTANCE * Math.cos(OVERVIEW_ELEVATION)),
);

export type Ease = 'linear' | 'in' | 'out' | 'inOut';

export interface Keyframe {
  /** Path parameter at which the camera is exactly at this pose. */
  p: number;
  position: THREE.Vector3;
  target: THREE.Vector3;
  /** Easing of the segment that ENDS at this keyframe. */
  ease?: Ease;
}

/** Path parameters of the stations (camera rests; used as reduced-motion shots). */
export const STATIONS = { hero: 0, solar: 1.5, outro: 4 } as const;
/** Reduced-motion cuts: the stations plus three probe shots. */
export const SHOTS: readonly number[] = [0, 1.5, 2.08, 2.4, 2.7, 4];

/** Probe progress (0..1) shown when the camera is at path parameter p. */
export const probeProgressForPath = (p: number): number => Math.min(1, Math.max(0, p - 2));

export function buildKeyframes(): Keyframe[] {
  const hero = heroCameraView();
  const probeAt = (p: number): THREE.Vector3 => probePosition(probeProgressForPath(p));
  return [
    { p: 0, position: hero.position, target: hero.target },
    // Pull back and up from the galaxy, still looking at it.
    { p: 0.5, position: new THREE.Vector3(0, 380, -1500), target: new THREE.Vector3(0, 0, -3000), ease: 'in' },
    // Keep backing away over the Sun; the solar system slides in below.
    { p: 1.05, position: new THREE.Vector3(0, 700, 1100), target: new THREE.Vector3(0, 0, -600) },
    { p: 1.5, position: SOLAR_OVERVIEW_POSITION.clone(), target: SOLAR_OVERVIEW_TARGET.clone(), ease: 'out' },
    // Out past Neptune to the probe (ease into the close-up).
    { p: 2.08, position: alongside(0.08, [-10, 5, 22]), target: probeAt(2.08), ease: 'inOut' },
    { p: 2.4, position: alongside(0.4, [18, 3, 2]), target: probeAt(2.4) },
    { p: 2.7, position: alongside(0.7, [-12, -2, -18]), target: probeAt(2.7) },
    // Swing round the left side (not over the top: keeps lookAt well away from vertical).
    { p: 2.95, position: alongside(0.95, [-16, 10, 8]), target: probeAt(2.95) },
    // Pull back until the probe is a speck and the starfield takes over.
    // Camera stays outward of the Sun (probe is ~495 u out), looking away from
    // it, so the frame ends on open starfield with the probe a few px wide.
    { p: 3.4, position: alongside(1, [25, 30, 110]), target: probeAt(3.4), ease: 'in' },
    { p: 4, position: alongside(1, [40, 90, 320]), target: alongside(1, [0, 70, -40]), ease: 'out' },
  ];
}

function applyEase(u: number, e: Ease | undefined): number {
  switch (e) {
    case 'in':
      return u * u;
    case 'out':
      return 1 - (1 - u) * (1 - u);
    case 'inOut':
      return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    default:
      return u;
  }
}

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

export interface FlightPath {
  readonly keyframes: readonly Keyframe[];
  readonly min: number;
  readonly max: number;
  /** Camera pose at path parameter p (clamped to [min, max]). */
  poseAt(p: number, out?: CameraPose): CameraPose;
}

/**
 * CatmullRom (centripetal) splines through keyframe positions and targets.
 * Keyframe k sits at spline t = k / (n - 1); p maps to t piecewise-linearly
 * (with the per-segment easing), so every keyframe is hit exactly at its p.
 */
export function createFlightPath(keyframes: Keyframe[] = buildKeyframes()): FlightPath {
  if (keyframes.length < 2) throw new RangeError('flight path needs >= 2 keyframes');
  for (let i = 1; i < keyframes.length; i++) {
    if (!(keyframes[i]!.p > keyframes[i - 1]!.p)) throw new RangeError('keyframe p must increase');
  }
  const posCurve = new THREE.CatmullRomCurve3(keyframes.map((k) => k.position.clone()), false, 'centripetal');
  const tgtCurve = new THREE.CatmullRomCurve3(keyframes.map((k) => k.target.clone()), false, 'centripetal');
  const n = keyframes.length;
  const min = keyframes[0]!.p;
  const max = keyframes[n - 1]!.p;

  const toT = (p: number): number => {
    const q = Math.min(max, Math.max(min, p));
    for (let i = 1; i < n; i++) {
      const b = keyframes[i]!;
      if (q <= b.p) {
        const a = keyframes[i - 1]!;
        const u = applyEase((q - a.p) / (b.p - a.p), b.ease);
        return (i - 1 + u) / (n - 1);
      }
    }
    return 1;
  };

  return {
    keyframes,
    min,
    max,
    poseAt(p, out = { position: new THREE.Vector3(), target: new THREE.Vector3() }) {
      const t = toT(p);
      posCurve.getPoint(t, out.position);
      tgtCurve.getPoint(t, out.target);
      return out;
    },
  };
}
