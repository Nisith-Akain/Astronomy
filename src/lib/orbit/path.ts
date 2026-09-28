/**
 * Orbit polyline sampling (contract C3, MATH-02).
 * Pure TypeScript: no three.js, no DOM.
 */
import type { OrbitalElements } from '../../types/planets';
import { elementsAt, type ElementsAt, type Vec3 } from './kepler';

/**
 * Point on the osculating ellipse at eccentric anomaly `E` (radians), in
 * heliocentric ecliptic J2000 coordinates, AU, float64. Same orbital-plane ->
 * ecliptic rotation as `heliocentricPosition`, so
 * `orbitPointAtE(elementsAt(el, jd), solveKepler(M, e))` equals
 * `heliocentricPosition(el, jd)`. Additive export beyond C3.
 */
export function orbitPointAtE(el: ElementsAt, E: number): Vec3 {
  const { a, e, I, Omega, omega } = el;
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const cw = Math.cos(omega);
  const sw = Math.sin(omega);
  const cO = Math.cos(Omega);
  const sO = Math.sin(Omega);
  const cI = Math.cos(I);
  const sI = Math.sin(I);

  return {
    x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    z: sw * sI * xp + cw * sI * yp,
  };
}

/**
 * Closed orbit polyline for the elements valid at `jd`.
 *
 * Samples are uniform in **eccentric anomaly** E_k = 2*pi*k/segments,
 * k = 0..segments-1 (point 0 is perihelion). Uniform-E spacing keeps chord
 * lengths within a factor 1/sqrt(1-e^2) of each other, so perihelion is not
 * under-sampled the way uniform-time sampling would leave it.
 *
 * The end point is NOT repeated: draw with a closed primitive
 * (THREE.LineLoop) or append point 0 yourself.
 *
 * @returns Float32Array of length segments*3, (x, y, z) per point, AU,
 *          heliocentric ecliptic J2000 (NOT scene axes; pass each point
 *          through `toScene`).
 * @throws RangeError if `segments` is not an integer >= 3, `jd` is
 *         non-finite, or the propagated eccentricity is outside [0, 1).
 */
export function orbitPath(el: OrbitalElements, jd: number, segments = 256): Float32Array {
  if (!Number.isInteger(segments) || segments < 3) {
    throw new RangeError(`orbitPath: segments must be an integer >= 3, got ${segments}`);
  }
  const at = elementsAt(el, jd); // throws RangeError on non-finite jd
  if (!(at.e >= 0 && at.e < 1)) {
    throw new RangeError(`orbitPath: eccentricity must be in [0, 1), got ${at.e}`);
  }
  const out = new Float32Array(segments * 3);
  const step = (2 * Math.PI) / segments;
  for (let k = 0; k < segments; k++) {
    const p = orbitPointAtE(at, k * step);
    out[3 * k] = p.x;
    out[3 * k + 1] = p.y;
    out[3 * k + 2] = p.z;
  }
  return out;
}
