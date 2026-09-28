import { describe, it, expect } from 'vitest';
import type { OrbitalElements } from '../../src/types/planets';
import {
  solveKepler,
  solveKeplerDetailed,
  elementsAt,
  heliocentricPosition,
} from '../../src/lib/orbit/kepler';
import { J2000_JD } from '../../src/lib/orbit/time';

// JPL "Keplerian Elements for Approximate Positions of the Major Planets",
// Table 1 (1800-2050 AD). Inlined so these tests don't depend on BE-02's JSON.
const EM_BARY: OrbitalElements = {
  a: 1.00000261, aDot: 0.00000562,
  e: 0.01671123, eDot: -0.00004392,
  I: -0.00001531, IDot: -0.01294668,
  L: 100.46457166, LDot: 35999.37244981,
  varpi: 102.93768193, varpiDot: 0.32327364,
  Omega: 0.0, OmegaDot: 0.0,
};
const MARS: OrbitalElements = {
  a: 1.52371034, aDot: 0.00001847,
  e: 0.0933941, eDot: 0.00007882,
  I: 1.84969142, IDot: -0.00813131,
  L: -4.55343205, LDot: 19140.30268499,
  varpi: -23.94362959, varpiDot: 0.44441088,
  Omega: 49.55953891, OmegaDot: -0.29257343,
};

/** Deterministic PRNG (mulberry32) so the property test is reproducible. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Residual of Kepler's equation, compared modulo 2*pi. */
function residual(E: number, e: number, M: number): number {
  const r = E - e * Math.sin(E) - M;
  return Math.abs(r - 2 * Math.PI * Math.round(r / (2 * Math.PI)));
}

describe('solveKepler', () => {
  it('property: 10,000 random (M, e in [0, 0.99]) pairs satisfy |E - e sin E - M| < 1e-10', () => {
    const rand = mulberry32(0xc0ffee);
    let worst = 0;
    for (let i = 0; i < 10_000; i++) {
      const M = (rand() * 2 - 1) * Math.PI;
      const e = rand() * 0.99;
      const E = solveKepler(M, e);
      worst = Math.max(worst, residual(E, e, M));
    }
    expect(worst).toBeLessThan(1e-10);
  });

  it('converges within tol in <= maxIter for all e in [0, 0.99] (dense grid incl. hard corners)', () => {
    let maxIters = 0;
    for (let ie = 0; ie <= 99; ie++) {
      const e = ie / 100;
      for (let iM = -400; iM <= 400; iM++) {
        const M = (iM / 400) * Math.PI;
        const s = solveKeplerDetailed(M, e);
        expect(s.converged).toBe(true);
        expect(s.iterations).toBeLessThanOrEqual(50);
        expect(residual(s.E, e, M)).toBeLessThan(1e-12);
        maxIters = Math.max(maxIters, s.iterations);
      }
    }
    // Hard corner: e -> 0.99, M -> 0+
    for (const M of [1e-12, 1e-8, 1e-4, -1e-6]) {
      const s = solveKeplerDetailed(M, 0.99);
      expect(s.converged).toBe(true);
      expect(residual(s.E, 0.99, M)).toBeLessThan(1e-12);
    }
    expect(maxIters).toBeLessThanOrEqual(50);
  });

  it('e = 0 returns normalised M exactly', () => {
    expect(solveKepler(1.234, 0)).toBe(1.234);
    expect(solveKepler(-3, 0)).toBe(-3);
    expect(solveKepler(0, 0)).toBe(0);
    const M = 1 + 4 * Math.PI;
    const wrapped = M - 2 * Math.PI * Math.round(M / (2 * Math.PI));
    expect(solveKepler(M, 0)).toBe(wrapped);
  });

  it('normalises M to [-pi, pi] and handles large |M|', () => {
    for (const M of [7, -7, 100, -1000.5, 3 * Math.PI, 1e6]) {
      const E = solveKepler(M, 0.5);
      expect(E).toBeGreaterThanOrEqual(-Math.PI);
      expect(E).toBeLessThanOrEqual(Math.PI);
      expect(residual(E, 0.5, M)).toBeLessThan(1e-9); // 1e6 loses a few digits in the wrap
    }
  });

  it('is odd-symmetric and fixes 0 and pi', () => {
    expect(solveKepler(0, 0.7)).toBe(0);
    expect(Math.abs(solveKepler(Math.PI, 0.7))).toBeCloseTo(Math.PI, 14);
    expect(solveKepler(-1.1, 0.95)).toBeCloseTo(-solveKepler(1.1, 0.95), 14);
  });

  it('honours custom tol / maxIter', () => {
    const s = solveKeplerDetailed(0.3, 0.9, 1e-3, 50);
    expect(s.converged).toBe(true);
    const capped = solveKeplerDetailed(0.3, 0.9, 1e-15, 1);
    expect(capped.iterations).toBe(1);
    expect(capped.converged).toBe(false);
    expect(Number.isFinite(capped.E)).toBe(true);
  });

  it('throws RangeError for invalid inputs', () => {
    expect(() => solveKepler(1, -0.01)).toThrow(RangeError);
    expect(() => solveKepler(1, 1)).toThrow(RangeError);
    expect(() => solveKepler(1, 1.5)).toThrow(RangeError);
    expect(() => solveKepler(1, NaN)).toThrow(RangeError);
    expect(() => solveKepler(NaN, 0.5)).toThrow(RangeError);
    expect(() => solveKepler(Infinity, 0.5)).toThrow(RangeError);
    expect(() => solveKepler(1, Infinity)).toThrow(RangeError);
    expect(() => solveKepler(1, 0.5, 0)).toThrow(RangeError);
    expect(() => solveKepler(1, 0.5, 1e-12, 0)).toThrow(RangeError);
    expect(() => solveKeplerDetailed(1, 0.5, 1e-12, 2.5)).toThrow(RangeError);
  });
});

describe('elementsAt', () => {
  it('at J2000 converts degrees to radians, omega = varpi - Omega, M = L - varpi (wrapped)', () => {
    const el = elementsAt(MARS, J2000_JD);
    const d = Math.PI / 180;
    expect(el.a).toBe(MARS.a);
    expect(el.e).toBe(MARS.e);
    expect(el.I).toBeCloseTo(MARS.I * d, 15);
    expect(el.Omega).toBeCloseTo(MARS.Omega * d, 15);
    expect(el.omega).toBeCloseTo((MARS.varpi - MARS.Omega) * d, 15);
    expect(el.M).toBeCloseTo((MARS.L - MARS.varpi) * d, 15);
  });

  it('propagates rates by T centuries', () => {
    const el = elementsAt(MARS, J2000_JD + 36525); // T = 1
    expect(el.a).toBeCloseTo(MARS.a + MARS.aDot, 12);
    expect(el.e).toBeCloseTo(MARS.e + MARS.eDot, 12);
    expect(el.M).toBeGreaterThanOrEqual(-Math.PI);
    expect(el.M).toBeLessThanOrEqual(Math.PI);
  });

  it('rejects non-finite jd', () => {
    expect(() => elementsAt(MARS, NaN)).toThrow(RangeError);
  });
});

describe('heliocentricPosition', () => {
  it('Earth (EM Bary) at JD 2451545.0 ~= (-0.1771, 0.9672, 0) AU within 0.005', () => {
    const p = heliocentricPosition(EM_BARY, 2451545.0);
    expect(Math.abs(p.x - -0.1771)).toBeLessThan(0.005);
    expect(Math.abs(p.y - 0.9672)).toBeLessThan(0.005);
    expect(Math.abs(p.z)).toBeLessThan(0.005);
  });

  it('Mars heliocentric distance over one full orbit (687 days, daily) stays within [1.381, 1.667] AU', () => {
    let rMin = Infinity;
    let rMax = -Infinity;
    for (let d = 0; d <= 687; d++) {
      const p = heliocentricPosition(MARS, J2000_JD + d);
      const r = Math.hypot(p.x, p.y, p.z);
      rMin = Math.min(rMin, r);
      rMax = Math.max(rMax, r);
    }
    // Corrected criterion (analytic aphelion a(1+e) at J2000 is 1.666016 AU,
    // above the originally quoted 1.666): strict bounds, no tolerance.
    expect(rMin).toBeGreaterThanOrEqual(1.381);
    expect(rMax).toBeLessThanOrEqual(1.667);
    // And tight check against the analytic extremes a(1 -+ e).
    expect(rMin).toBeCloseTo(MARS.a * (1 - MARS.e), 3);
    expect(rMax).toBeCloseTo(MARS.a * (1 + MARS.e), 3);
  });

  it('distance equals a(1 - e cos E) and z is small for low-inclination orbits', () => {
    for (const jd of [J2000_JD - 20000, J2000_JD, J2000_JD + 9000]) {
      const el = elementsAt(MARS, jd);
      const E = solveKepler(el.M, el.e);
      const p = heliocentricPosition(MARS, jd);
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(el.a * (1 - el.e * Math.cos(E)), 12);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(Math.hypot(p.x, p.y, p.z) * Math.sin(el.I) + 1e-12);
    }
  });

  it('Earth completes ~one revolution per 365.25 days', () => {
    const a = heliocentricPosition(EM_BARY, J2000_JD);
    const b = heliocentricPosition(EM_BARY, J2000_JD + 365.25);
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(0.001);
  });
});
