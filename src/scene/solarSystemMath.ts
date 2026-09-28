// FE-03: pure helpers for the solar-system section (no three.js, no DOM) so
// they can be unit-tested under vitest's node environment.
import type { Vec3 } from '../lib/orbit/kepler';

/** Speed slider range (Q2 / FE-03 AC): 1 day/s .. 1 year/s, log scale. */
export const MIN_SPEED_DAYS_PER_S = 1;
export const MAX_SPEED_DAYS_PER_S = 365.25;
export const DEFAULT_SPEED_DAYS_PER_S = 10;

/** Upper bound on displayed spin (revolutions per real second) to avoid
 *  wagon-wheel aliasing at high sim speeds. Rates below this are exact. */
export const MAX_VISUAL_SPIN_REV_PER_S = 2;

const LOG_MIN = Math.log(MIN_SPEED_DAYS_PER_S);
const LOG_MAX = Math.log(MAX_SPEED_DAYS_PER_S);

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Slider position 0..1 -> sim speed in days per real second (log mapping). */
export function sliderToSpeed(t: number): number {
  return Math.exp(LOG_MIN + clamp01(t) * (LOG_MAX - LOG_MIN));
}

/** Inverse of `sliderToSpeed`. */
export function speedToSlider(daysPerSecond: number): number {
  const s = Math.min(MAX_SPEED_DAYS_PER_S, Math.max(MIN_SPEED_DAYS_PER_S, daysPerSecond));
  return (Math.log(s) - LOG_MIN) / (LOG_MAX - LOG_MIN);
}

/** Human label for a speed, e.g. "1 day/s", "3.2 days/s", "1 year/s". */
export function formatSpeed(daysPerSecond: number): string {
  if (daysPerSecond >= MAX_SPEED_DAYS_PER_S - 1e-6) return '1 year/s';
  if (daysPerSecond >= 30) return `${(daysPerSecond / 30.4375).toFixed(1)} months/s`;
  const v = daysPerSecond < 10 ? daysPerSecond.toFixed(1) : daysPerSecond.toFixed(0);
  return v === '1.0' ? '1 day/s' : `${v} days/s`;
}

/** "YYYY-MM-DD HH:MM UTC" for the simulated date display. */
export function formatSimDate(date: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const y = date.getUTCFullYear();
  const ys = y < 0 ? `-${String(-y).padStart(4, '0')}` : String(y).padStart(4, '0');
  return `${ys}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())} ${p(date.getUTCHours())}:${p(date.getUTCMinutes())} UTC`;
}

/**
 * Spin increment in radians for one frame. Uses the ABSOLUTE rotation period:
 * the retrograde sense of Venus/Uranus is already encoded by their axial tilt
 * > 90 deg (C2 data notes), so the sign must not be applied a second time.
 * The rate is capped at MAX_VISUAL_SPIN_REV_PER_S real revolutions per second.
 */
export function spinDelta(rotationPeriodHours: number, simDtDays: number, realDtSeconds: number): number {
  const period = Math.abs(rotationPeriodHours);
  if (!(period > 0) || !Number.isFinite(period)) return 0;
  const exact = (2 * Math.PI * simDtDays * 24) / period;
  const cap = 2 * Math.PI * MAX_VISUAL_SPIN_REV_PER_S * Math.max(0, realDtSeconds);
  return Math.min(exact, cap);
}

/**
 * Saturn ring UVs by radius: u = (r - inner) / (outer - inner), v = 0.5.
 * `positions` are xyz triples of a ring lying in any plane through the origin
 * (three's RingGeometry is in XY). The ring texture is a radial strip whose
 * x axis runs inner -> outer edge.
 */
export function ringRadialUVs(positions: ArrayLike<number>, inner: number, outer: number): Float32Array {
  const n = Math.floor(positions.length / 3);
  const uv = new Float32Array(n * 2);
  const span = outer - inner;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3] ?? 0;
    const y = positions[i * 3 + 1] ?? 0;
    const z = positions[i * 3 + 2] ?? 0;
    const r = Math.hypot(x, y, z);
    uv[i * 2] = span > 0 ? clamp01((r - inner) / span) : 0;
    uv[i * 2 + 1] = 0.5;
  }
  return uv;
}

/** Smooth 0..1 easing used for the scale-toggle and camera transitions. */
export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Component-wise lerp of two scene positions. When both come from `toScene`
 *  of the same heliocentric point they share a direction, so the blend stays
 *  on that ray (no sideways popping). */
export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

/** Frame-rate independent damping factor for exponential smoothing. */
export function dampFactor(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * Math.max(0, dt));
}
