import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OrbitalElements, Planet, SolarSystemData } from '../src/types/planets';

const jsonPath = resolve(__dirname, '..', 'public', 'data', 'planets.json');
const raw: unknown = JSON.parse(readFileSync(jsonPath, 'utf8'));
const data = raw as SolarSystemData;

const PLANET_IDS = [
  'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune',
] as const;

const ELEMENT_KEYS: (keyof OrbitalElements)[] = [
  'a', 'e', 'I', 'L', 'varpi', 'Omega',
  'aDot', 'eDot', 'IDot', 'LDot', 'varpiDot', 'OmegaDot',
];
const PLANET_KEYS = [
  'id', 'name', 'radiusKm', 'axialTiltDeg', 'rotationPeriodHours', 'orbitalPeriodDays',
  'color', 'texture', 'ring', 'facts', 'elements',
];
const STAR_KEYS = ['id', 'name', 'radiusKm', 'rotationPeriodHours', 'color', 'texture', 'facts'];
const ROOT_KEYS = ['schemaVersion', 'epoch', 'source', 'sun', 'planets'];

// C5 naming: textures/planets/{id}.jpg, plus textures/planets/saturn_ring.png.
const C5_TEXTURE = /^textures\/planets\/(sun|mercury|venus|earth|mars|jupiter|saturn|uranus|neptune)\.jpg$/;
const C5_RING = 'textures/planets/saturn_ring.png';
const HEX = /^#[0-9a-f]{6}$/i;

/** Recursively collect every number in a value, with its JSON path. */
function numbers(value: unknown, path: string, out: [string, number][] = []): [string, number][] {
  if (typeof value === 'number') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => numbers(v, `${path}[${i}]`, out));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) numbers(v, `${path}.${k}`, out);
  }
  return out;
}

function expectOnlyKeys(obj: object, allowed: string[], where: string): void {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  expect(extra, `unexpected keys in ${where}`).toEqual([]);
}

describe('public/data/planets.json (C2)', () => {
  it('has the C2 root shape', () => {
    expectOnlyKeys(data, ROOT_KEYS, 'root');
    expect(data.schemaVersion).toBe(1);
    expect(data.epoch).toBe('J2000');
    expect(data.source).toContain('https://ssd.jpl.nasa.gov/');
    expect(data.source).toContain('https://nssdc.gsfc.nasa.gov/planetary/factsheet/');
  });

  it('has exactly 8 planets in order Mercury..Neptune', () => {
    expect(data.planets.map((p) => p.id)).toEqual([...PLANET_IDS]);
    for (const p of data.planets) {
      expect(p.name.toLowerCase()).toBe(p.id);
    }
  });

  it('every numeric field is finite', () => {
    const nums = numbers(data, '$');
    expect(nums.length).toBeGreaterThan(8 * 16);
    for (const [path, n] of nums) {
      expect(Number.isFinite(n), `${path} = ${n}`).toBe(true);
    }
  });

  it('every planet has all C2 fields with correct types', () => {
    for (const p of data.planets) {
      expectOnlyKeys(p, PLANET_KEYS, p.id);
      expectOnlyKeys(p.elements, ELEMENT_KEYS, `${p.id}.elements`);
      for (const k of ELEMENT_KEYS) {
        expect(typeof p.elements[k], `${p.id}.elements.${k}`).toBe('number');
      }
      expect(p.radiusKm).toBeGreaterThan(0);
      expect(p.orbitalPeriodDays).toBeGreaterThan(0);
      expect(p.rotationPeriodHours).not.toBe(0);
      expect(p.color).toMatch(HEX);
      expect(p.facts.length).toBeGreaterThanOrEqual(2);
      expect(p.facts.length).toBeLessThanOrEqual(4);
      for (const f of p.facts) expect(f.trim().length).toBeGreaterThan(0);
    }
    expectOnlyKeys(data.sun, STAR_KEYS, 'sun');
    expect(data.sun.id).toBe('sun');
    expect(data.sun.color).toMatch(HEX);
    expect(data.sun.facts.length).toBeGreaterThanOrEqual(2);
    expect(data.sun.facts.length).toBeLessThanOrEqual(4);
  });

  it('0 <= e < 1 for every planet, at J2000 and across 1800-2050', () => {
    for (const p of data.planets) {
      const { e, eDot } = p.elements;
      for (const T of [-2, 0, 0.5]) {
        const eT = e + eDot * T;
        expect(eT, p.id).toBeGreaterThanOrEqual(0);
        expect(eT, p.id).toBeLessThan(1);
      }
      expect(p.elements.a).toBeGreaterThan(0);
    }
  });

  it('texture paths match C5 naming', () => {
    expect(data.sun.texture).toBe('textures/planets/sun.jpg');
    for (const p of data.planets) {
      expect(p.texture).toMatch(C5_TEXTURE);
      expect(p.texture).toBe(`textures/planets/${p.id}.jpg`);
    }
    const saturn = data.planets.find((p) => p.id === 'saturn') as Planet;
    expect(saturn.ring?.texture).toBe(C5_RING);
  });

  it('only Saturn has a ring, and it is sane', () => {
    const ringed = data.planets.filter((p) => p.ring !== undefined).map((p) => p.id);
    expect(ringed).toEqual(['saturn']);
    const saturn = data.planets.find((p) => p.id === 'saturn') as Planet;
    const ring = saturn.ring!;
    expect(ring.innerKm).toBeGreaterThan(saturn.radiusKm);
    expect(ring.outerKm).toBeGreaterThan(ring.innerKm);
  });

  it('retrograde rotators (Venus, Uranus) are negative, others positive', () => {
    for (const p of data.planets) {
      const retro = p.id === 'venus' || p.id === 'uranus';
      expect(p.rotationPeriodHours < 0, p.id).toBe(retro);
    }
  });

  // Cross-check between two independent sources (JPL LDot vs NASA fact sheet
  // orbital period) to catch transcription typos in the elements.
  it('mean-motion rate LDot agrees with orbitalPeriodDays within 1%', () => {
    for (const p of data.planets) {
      const periodFromRate = (360 / p.elements.LDot) * 36525;
      expect(Math.abs(periodFromRate / p.orbitalPeriodDays - 1), p.id).toBeLessThan(0.01);
    }
  });

  // Loose bound: Table 1 is a 1800-2050 best fit that absorbs perturbations,
  // so outer planets deviate from the two-body law by up to ~1.5% (Neptune).
  it('Kepler third law: period^2 / a^3 ~= 1 (years, AU) within 2%', () => {
    for (const p of data.planets) {
      const years = p.orbitalPeriodDays / 365.25;
      expect(Math.abs(years ** 2 / p.elements.a ** 3 - 1), p.id).toBeLessThan(0.02);
    }
  });

  it('Earth uses the JPL EM Bary row', () => {
    const earth = data.planets.find((p) => p.id === 'earth')!;
    expect(earth.elements).toMatchObject({
      a: 1.00000261, e: 0.01671123, I: -0.00001531,
      L: 100.46457166, varpi: 102.93768193, Omega: 0,
    });
  });
});
