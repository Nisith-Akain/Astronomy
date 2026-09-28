/**
 * Kepler equation solver + heliocentric positions (contract C3).
 * Pure TypeScript: no three.js, no DOM.
 *
 * Reference: E. M. Standish, "Keplerian Elements for Approximate Positions of
 * the Major Planets", JPL/SSD, https://ssd.jpl.nasa.gov/planets/approx_pos.html
 */
import type { OrbitalElements } from '../../types/planets';
import { centuriesSinceJ2000 } from './time';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const TWO_PI = 2 * Math.PI;
const DEG = Math.PI / 180;

/** Wrap an angle in radians to [-pi, pi]. */
function wrapPi(angle: number): number {
  const w = angle - TWO_PI * Math.round(angle / TWO_PI);
  // Floating-point guard; keeps the result inside the closed interval.
  if (w > Math.PI) return w - TWO_PI;
  if (w < -Math.PI) return w + TWO_PI;
  return w;
}

export interface KeplerSolution {
  /** Eccentric anomaly in radians, in [-pi, pi]. */
  E: number;
  /** Newton/bisection iterations performed. */
  iterations: number;
  /** True if the last step was smaller than `tol`. */
  converged: boolean;
}

function validate(M: number, e: number, tol: number, maxIter: number): void {
  if (!Number.isFinite(M)) throw new RangeError('solveKepler: M must be finite');
  if (!Number.isFinite(e)) throw new RangeError('solveKepler: e must be finite');
  if (e < 0 || e >= 1) throw new RangeError(`solveKepler: e must be in [0, 1), got ${e}`);
  if (!Number.isFinite(tol) || tol <= 0) throw new RangeError('solveKepler: tol must be > 0');
  if (!Number.isInteger(maxIter) || maxIter < 1) {
    throw new RangeError('solveKepler: maxIter must be a positive integer');
  }
}

/**
 * Same as `solveKepler` but also reports iteration count / convergence.
 * (Additive export beyond C3; used by tests and available for diagnostics.)
 *
 * Algorithm: M is wrapped to [-pi, pi]; by odd symmetry of
 * f(E) = E - e sin E - M we solve for |M| in [0, pi], where the root is
 * bracketed by [0, pi]. Newton-Raphson from E0 = M (e < 0.8) or E0 = pi
 * (e >= 0.8), safeguarded by bisection if a step leaves the bracket, so it
 * can never diverge.
 */
export function solveKeplerDetailed(
  M: number,
  e: number,
  tol = 1e-12,
  maxIter = 50,
): KeplerSolution {
  validate(M, e, tol, maxIter);
  const Mw = wrapPi(M);
  if (e === 0) return { E: Mw, iterations: 0, converged: true };

  const sign = Mw < 0 ? -1 : 1;
  const m = Math.abs(Mw); // in [0, pi]
  if (m === 0 || m === Math.PI) return { E: Mw, iterations: 0, converged: true };

  let lo = 0;
  let hi = Math.PI;
  let E = e < 0.8 ? m : Math.PI;

  for (let i = 1; i <= maxIter; i++) {
    const f = E - e * Math.sin(E) - m;
    if (f > 0) hi = E;
    else if (f < 0) lo = E;
    else return { E: sign * E, iterations: i, converged: true };

    const fp = 1 - e * Math.cos(E); // >= 1 - e > 0
    const dE = f / fp;
    // Converged: take the (tiny) Newton step unconditionally. Must precede the
    // bracket guard, otherwise a rounding-level step landing on lo/hi would
    // trigger a bisection step that moves *away* from the root.
    if (Math.abs(dE) < tol) return { E: sign * (E - dE), iterations: i, converged: true };
    let next = E - dE;
    if (!(next >= lo && next <= hi)) next = 0.5 * (lo + hi); // bisection fallback
    E = next;
  }
  return { E: sign * E, iterations: maxIter, converged: false };
}

/**
 * Solve Kepler's equation M = E - e sin E for the eccentric anomaly E.
 * @param M mean anomaly, radians (any value; normalised to [-pi, pi]).
 * @param e eccentricity, 0 <= e < 1.
 * @param tol convergence tolerance on the Newton step, radians (default 1e-12).
 * @param maxIter iteration cap (default 50). If hit, the best estimate is returned.
 * @returns E in [-pi, pi], radians.
 * @throws RangeError if e < 0, e >= 1, or any input is non-finite / invalid.
 */
export function solveKepler(M: number, e: number, tol = 1e-12, maxIter = 50): number {
  return solveKeplerDetailed(M, e, tol, maxIter).E;
}

/** Orbital elements propagated to a date, angles in radians. */
export interface ElementsAt {
  a: number; // AU
  e: number;
  I: number; // inclination, rad
  L: number; // mean longitude, rad
  varpi: number; // longitude of perihelion, rad
  Omega: number; // longitude of ascending node, rad
  omega: number; // argument of perihelion = varpi - Omega, rad
  M: number; // mean anomaly = L - varpi, rad, wrapped to [-pi, pi]
}

/**
 * Propagate C2 elements (degrees, per-century rates) to Julian Date `jd` and
 * convert to radians (JPL Standish step 1-3). Additive export beyond C3;
 * intended for MATH-02 `orbitPath`.
 */
export function elementsAt(el: OrbitalElements, jd: number): ElementsAt {
  if (!Number.isFinite(jd)) throw new RangeError('elementsAt: jd must be finite');
  const T = centuriesSinceJ2000(jd);
  const a = el.a + el.aDot * T;
  const e = el.e + el.eDot * T;
  const I = (el.I + el.IDot * T) * DEG;
  const L = (el.L + el.LDot * T) * DEG;
  const varpi = (el.varpi + el.varpiDot * T) * DEG;
  const Omega = (el.Omega + el.OmegaDot * T) * DEG;
  return {
    a,
    e,
    I,
    L,
    varpi,
    Omega,
    omega: varpi - Omega,
    M: wrapPi(L - varpi),
  };
}

/**
 * Heliocentric ecliptic (J2000 ecliptic & equinox) position in AU, following
 * the JPL Standish procedure: propagate elements, omega = varpi - Omega,
 * M = L - varpi, solve Kepler, orbital-plane coords, rotate to ecliptic.
 * Axes: x toward vernal equinox, z toward ecliptic north (NOT three.js axes;
 * use MATH-02 `toScene`).
 */
export function heliocentricPosition(el: OrbitalElements, jd: number): Vec3 {
  const { a, e, I, Omega, omega, M } = elementsAt(el, jd);
  const E = solveKepler(M, e);

  // Position in the orbital plane, x' toward perihelion.
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
