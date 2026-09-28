import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OrbitalElements, SolarSystemData } from '../../src/types/planets';
import { elementsAt, heliocentricPosition, solveKepler } from '../../src/lib/orbit/kepler';
import { orbitPath, orbitPointAtE } from '../../src/lib/orbit/path';
import { J2000_JD } from '../../src/lib/orbit/time';

const data = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', 'public', 'data', 'planets.json'), 'utf8'),
) as SolarSystemData;

// Mercury (most eccentric planet) and a synthetic highly eccentric, inclined orbit.
const MERCURY = data.planets.find((p) => p.id === 'mercury')!.elements;
const ECCENTRIC: OrbitalElements = {
  a: 3, e: 0.9, I: 40, L: 10, varpi: 70, Omega: 120,
  aDot: 0, eDot: 0, IDot: 0, LDot: 1000, varpiDot: 0, OmegaDot: 0,
};
const CASES: [string, OrbitalElements][] = [
  ...data.planets.map((p) => [p.id, p.elements] as [string, OrbitalElements]),
  ['synthetic e=0.9', ECCENTRIC],
];
const JDS = [J2000_JD - 50 * 365.25, J2000_JD, J2000_JD + 9131.5];
const TWO_PI = 2 * Math.PI;

describe('orbitPointAtE (float64 core of orbitPath)', () => {
  it('every sample lies within 1e-9 AU of the analytic ellipse radius', () => {
    const N = 256;
    for (const [, el] of CASES) {
      for (const jd of JDS) {
        const at = elementsAt(el, jd);
        for (let k = 0; k < N; k++) {
          const E = (TWO_PI * k) / N;
          const p = orbitPointAtE(at, E);
          const r = Math.hypot(p.x, p.y, p.z);
          // Radius vs a(1 - e cos E).
          expect(Math.abs(r - at.a * (1 - at.e * Math.cos(E)))).toBeLessThan(1e-9);
          // Independent check: focal-sum property r + r' = 2a, second focus at
          // -2ae along the perihelion direction (point k = 0 direction).
          const peri = orbitPointAtE(at, 0);
          const rp = Math.hypot(peri.x, peri.y, peri.z);
          const f2 = { x: (-2 * at.a * at.e * peri.x) / rp, y: (-2 * at.a * at.e * peri.y) / rp, z: (-2 * at.a * at.e * peri.z) / rp };
          const r2 = Math.hypot(p.x - f2.x, p.y - f2.y, p.z - f2.z);
          expect(Math.abs(r + r2 - 2 * at.a)).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('matches heliocentricPosition when E is the Kepler solution', () => {
    for (const [, el] of CASES) {
      for (const jd of JDS) {
        const at = elementsAt(el, jd);
        const p = orbitPointAtE(at, solveKepler(at.M, at.e));
        const q = heliocentricPosition(el, jd);
        expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeLessThan(1e-12);
      }
    }
  });
});

describe('orbitPath', () => {
  it('returns segments*3 floats (default 256 segments)', () => {
    expect(orbitPath(MERCURY, J2000_JD)).toBeInstanceOf(Float32Array);
    expect(orbitPath(MERCURY, J2000_JD).length).toBe(256 * 3);
    expect(orbitPath(MERCURY, J2000_JD, 3).length).toBe(9);
    expect(orbitPath(MERCURY, J2000_JD, 1000).length).toBe(3000);
  });

  it('is uniform in eccentric anomaly; Float32 output equals the float64 points to float32 rounding', () => {
    const N = 128;
    for (const [, el] of CASES) {
      for (const jd of JDS) {
        const at = elementsAt(el, jd);
        const path = orbitPath(el, jd, N);
        for (let k = 0; k < N; k++) {
          const p = orbitPointAtE(at, (TWO_PI * k) / N);
          expect(path[3 * k]).toBe(Math.fround(p.x));
          expect(path[3 * k + 1]).toBe(Math.fround(p.y));
          expect(path[3 * k + 2]).toBe(Math.fround(p.z));
          // Radius from the stored floats vs analytic: bounded by float32
          // precision (rel. 2^-24 per component), not 1e-9 -- see ticket note.
          const r = Math.hypot(path[3 * k]!, path[3 * k + 1]!, path[3 * k + 2]!);
          const rA = at.a * (1 - at.e * Math.cos((TWO_PI * k) / N));
          expect(Math.abs(r - rA)).toBeLessThan(rA * 2e-7);
        }
      }
    }
  });

  it('starts at perihelion and is not under-sampled there (chord ratio <= 1/sqrt(1-e^2))', () => {
    for (const [, el] of CASES) {
      const at = elementsAt(el, J2000_JD);
      const N = 256;
      const path = orbitPath(el, J2000_JD, N);
      const r0 = Math.hypot(path[0]!, path[1]!, path[2]!);
      expect(Math.abs(r0 - at.a * (1 - at.e))).toBeLessThan(at.a * 1e-6);
      const chords: number[] = [];
      for (let k = 0; k < N; k++) {
        const j = (k + 1) % N; // closed loop
        chords.push(Math.hypot(
          path[3 * j]! - path[3 * k]!, path[3 * j + 1]! - path[3 * k + 1]!, path[3 * j + 2]! - path[3 * k + 2]!,
        ));
      }
      const ratio = Math.max(...chords) / Math.min(...chords);
      expect(ratio).toBeLessThanOrEqual((1 / Math.sqrt(1 - at.e * at.e)) * 1.001);
      // Perihelion chords are the *shortest* (densest sampling in space per
      // unit of orbit where the planet moves fastest), never the longest.
      expect(chords[0]).toBeLessThanOrEqual(chords[N / 2]! * 1.0001);
    }
  });

  it('for e = 0.9 a uniform-time sampling would be far sparser at perihelion than ours', () => {
    const at = elementsAt(ECCENTRIC, J2000_JD);
    const N = 256;
    // Uniform-in-M chord at perihelion vs our uniform-in-E chord at perihelion.
    const M1 = TWO_PI / N;
    const pTime = orbitPointAtE(at, solveKepler(M1, at.e));
    const p0 = orbitPointAtE(at, 0);
    const pE = orbitPointAtE(at, TWO_PI / N);
    const chordTime = Math.hypot(pTime.x - p0.x, pTime.y - p0.y, pTime.z - p0.z);
    const chordE = Math.hypot(pE.x - p0.x, pE.y - p0.y, pE.z - p0.z);
    expect(chordTime / chordE).toBeGreaterThan(3);
  });

  it('throws RangeError on bad segments / jd / eccentricity', () => {
    expect(() => orbitPath(MERCURY, J2000_JD, 2)).toThrow(RangeError);
    expect(() => orbitPath(MERCURY, J2000_JD, 10.5)).toThrow(RangeError);
    expect(() => orbitPath(MERCURY, NaN)).toThrow(RangeError);
    expect(() => orbitPath({ ...MERCURY, e: 1.2 }, J2000_JD)).toThrow(RangeError);
  });
});
