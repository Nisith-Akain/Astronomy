/**
 * Ecliptic AU -> three.js scene-unit mapping (contract C3, MATH-02).
 * Pure TypeScript: no three.js, no DOM.
 *
 * Q1 (CTO decision): default view uses sqrt distance compression with
 * exaggerated radii (`DEFAULT_SCALE`); the UI toggle switches to "true
 * distance" (`TRUE_DISTANCE_SCALE`: linear distances, radii still
 * exaggerated). Both presets put Neptune's orbit at roughly the same scene
 * extent (~270-275 units), so the camera framing stays valid across the toggle.
 */
import type { Vec3 } from './kepler';

export interface ScaleConfig {
  /** Radial distance mapping applied to |p| in AU. */
  distance: 'linear' | 'log' | 'sqrt';
  /** Scene units per mapped AU: linear r*k, sqrt sqrt(r)*k, log ln(1+r)*k. */
  auToUnits: number;
  /** Scene radius of an Earth-sized body before clamping (see displayRadius). */
  radiusScale: number;
  /** Lower clamp on displayRadius, scene units. */
  minRadius: number;
}

/** Mean Earth radius, km (NASA fact sheet); the unit for displayRadius. */
export const EARTH_RADIUS_KM = 6371.0;

/**
 * Q1 default: sqrt distance compression, exaggerated radii.
 * Mercury perihelion ~27.7 u, Earth ~50 u, Jupiter ~114 u, Neptune ~274 u.
 * Sun radius ~10.4 u, Jupiter ~3.3 u, Earth 1.0 u, Mercury ~0.62 u.
 */
export const DEFAULT_SCALE: ScaleConfig = Object.freeze({
  distance: 'sqrt',
  auToUnits: 50,
  radiusScale: 1.0,
  minRadius: 0.5,
});

/**
 * Q1 "true distance" toggle: linear distances (same outer extent as the
 * default), radii still exaggerated (~300x for Earth) but shrunk so the Sun
 * stays inside Mercury's orbit. Mercury perihelion ~2.8 u, Earth 9 u,
 * Neptune ~271 u; Sun radius ~1.25 u, Earth 0.12 u. Additive export beyond C3.
 */
export const TRUE_DISTANCE_SCALE: ScaleConfig = Object.freeze({
  distance: 'linear',
  auToUnits: 9,
  radiusScale: 0.12,
  minRadius: 0.08,
});

function assertConfig(cfg: ScaleConfig, fn: string): void {
  if (!(Number.isFinite(cfg.auToUnits) && cfg.auToUnits > 0)) {
    throw new RangeError(`${fn}: auToUnits must be finite and > 0`);
  }
  if (cfg.distance !== 'linear' && cfg.distance !== 'log' && cfg.distance !== 'sqrt') {
    throw new RangeError(`${fn}: unknown distance mode ${String(cfg.distance)}`);
  }
}

/**
 * Radial distance mapping only: heliocentric distance in AU -> scene units.
 * Strictly increasing, mapDistance(0) = 0. Additive export beyond C3 (handy
 * for placing labels/rings or for FE-03's animated mode toggle).
 * @throws RangeError for negative / non-finite distance or invalid config.
 */
export function mapDistance(rAU: number, cfg: ScaleConfig = DEFAULT_SCALE): number {
  assertConfig(cfg, 'mapDistance');
  if (!(Number.isFinite(rAU) && rAU >= 0)) {
    throw new RangeError(`mapDistance: distance must be finite and >= 0, got ${rAU}`);
  }
  switch (cfg.distance) {
    case 'linear':
      return rAU * cfg.auToUnits;
    case 'sqrt':
      return Math.sqrt(rAU) * cfg.auToUnits;
    case 'log':
      return Math.log1p(rAU) * cfg.auToUnits;
  }
}

/**
 * Ecliptic AU -> three.js scene units, Y-up. The distance mapping scales the
 * radial distance only (direction preserved), then axes are swapped to
 * scene = (x, z, -y): ecliptic plane -> XZ plane, +Y = ecliptic north.
 * The origin (Sun) maps to the origin.
 * @throws RangeError for non-finite coordinates or invalid config.
 */
export function toScene(p: Vec3, cfg: ScaleConfig = DEFAULT_SCALE): Vec3 {
  if (!(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))) {
    throw new RangeError('toScene: coordinates must be finite');
  }
  const r = Math.hypot(p.x, p.y, p.z);
  const d = mapDistance(r, cfg);
  if (r === 0) return { x: 0, y: 0, z: 0 };
  const k = d / r;
  return { x: p.x * k, y: p.z * k, z: -p.y * k };
}

/**
 * Display radius in scene units for a body of mean radius `radiusKm`:
 *   max(minRadius, radiusScale * sqrt(radiusKm / EARTH_RADIUS_KM))
 * i.e. Earth = radiusScale; sqrt compression keeps the Sun (109 R_earth) at
 * ~10.4x Earth instead of 109x, so it never swallows the inner orbits.
 * Independent of `distance` / `auToUnits`.
 *
 * Rings: scale from the planet's display radius, preserving true
 * proportions, e.g. `displayRadius(p.radiusKm) * ring.outerKm / p.radiusKm`
 * (do NOT pass ring radii through displayRadius; the sqrt would distort them).
 * @throws RangeError for negative / non-finite radius.
 */
export function displayRadius(radiusKm: number, cfg: ScaleConfig = DEFAULT_SCALE): number {
  if (!(Number.isFinite(radiusKm) && radiusKm >= 0)) {
    throw new RangeError(`displayRadius: radiusKm must be finite and >= 0, got ${radiusKm}`);
  }
  return Math.max(cfg.minRadius, cfg.radiusScale * Math.sqrt(radiusKm / EARTH_RADIUS_KM));
}
