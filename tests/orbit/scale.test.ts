import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SolarSystemData } from '../../src/types/planets';
import { elementsAt, heliocentricPosition, type Vec3 } from '../../src/lib/orbit/kepler';
import {
  DEFAULT_SCALE,
  EARTH_RADIUS_KM,
  TRUE_DISTANCE_SCALE,
  displayRadius,
  mapDistance,
  toScene,
  type ScaleConfig,
} from '../../src/lib/orbit/scale';
import { J2000_JD } from '../../src/lib/orbit/time';

const root = resolve(__dirname, '..', '..');
const data = JSON.parse(
  readFileSync(join(root, 'public', 'data', 'planets.json'), 'utf8'),
) as SolarSystemData;

const LOG_SCALE: ScaleConfig = { ...DEFAULT_SCALE, distance: 'log', auToUnits: 80 };
const MODES: [string, ScaleConfig][] = [
  ['sqrt (DEFAULT_SCALE)', DEFAULT_SCALE],
  ['linear (TRUE_DISTANCE_SCALE)', TRUE_DISTANCE_SCALE],
  ['log', LOG_SCALE],
];
const len = (v: Vec3) => Math.hypot(v.x, v.y, v.z);

describe('presets (Q1 decision)', () => {
  it('DEFAULT_SCALE is sqrt compression; TRUE_DISTANCE_SCALE is linear with exaggerated radii', () => {
    expect(DEFAULT_SCALE.distance).toBe('sqrt');
    expect(TRUE_DISTANCE_SCALE.distance).toBe('linear');
    // "Radii still exaggerated": Earth's display radius vs its true size in scene units.
    const trueEarth = (EARTH_RADIUS_KM / 1.495978707e8) * TRUE_DISTANCE_SCALE.auToUnits;
    expect(displayRadius(EARTH_RADIUS_KM, TRUE_DISTANCE_SCALE) / trueEarth).toBeGreaterThan(100);
    // Both presets frame Neptune at a similar extent (toggle keeps camera framing).
    const n = data.planets[7]!.elements.a;
    const ratio = mapDistance(n, DEFAULT_SCALE) / mapDistance(n, TRUE_DISTANCE_SCALE);
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
  });
});

describe('toScene', () => {
  it('maps the origin to the origin in every mode', () => {
    for (const [, cfg] of MODES) expect(toScene({ x: 0, y: 0, z: 0 }, cfg)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('applies the Y-up swap (x, z, -y)', () => {
    const cfg: ScaleConfig = { ...DEFAULT_SCALE, distance: 'linear', auToUnits: 1 };
    expect(toScene({ x: 1, y: 2, z: 3 }, cfg)).toEqual({ x: 1, y: 3, z: -2 });
    // Ecliptic +z (north) -> scene +Y; ecliptic +y -> scene -Z.
    const n = toScene({ x: 0, y: 0, z: 1 });
    expect(n.x).toBe(0);
    expect(n.y).toBeCloseTo(DEFAULT_SCALE.auToUnits, 12);
    expect(n.z === 0).toBe(true);
    const y = toScene({ x: 0, y: 1, z: 0 });
    expect(y.z).toBeCloseTo(-DEFAULT_SCALE.auToUnits, 12);
  });

  it('maps radial distance only (direction preserved) using the configured formula', () => {
    const dirs: Vec3[] = [{ x: 1, y: 0, z: 0 }, { x: -0.3, y: 0.8, z: 0.1 }, { x: 0.2, y: -0.4, z: -0.9 }];
    for (const [, cfg] of MODES) {
      for (const d of dirs) {
        for (const s of [0.01, 0.39, 1, 5.2, 30.07, 100]) {
          const u = len(d);
          const p = { x: (d.x / u) * s, y: (d.y / u) * s, z: (d.z / u) * s };
          const q = toScene(p, cfg);
          const expected = cfg.distance === 'linear' ? s : cfg.distance === 'sqrt' ? Math.sqrt(s) : Math.log1p(s);
          expect(len(q)).toBeCloseTo(expected * cfg.auToUnits, 9);
          expect(len(q)).toBeCloseTo(mapDistance(s, cfg), 12);
          // Direction: scene vector swapped back equals the input direction.
          const back = { x: q.x / len(q), y: -q.z / len(q), z: q.y / len(q) };
          expect(back.x).toBeCloseTo(p.x / s, 12);
          expect(back.y).toBeCloseTo(p.y / s, 12);
          expect(back.z).toBeCloseTo(p.z / s, 12);
        }
      }
    }
  });

  it('is strictly monotonic in distance in every mode', () => {
    for (const [, cfg] of MODES) {
      let prev = -1;
      for (let i = 0; i <= 4000; i++) {
        const r = i * 0.01; // 0 .. 40 AU
        const d = len(toScene({ x: r * 0.6, y: r * 0.8, z: 0 }, cfg));
        expect(d).toBeGreaterThan(prev);
        prev = d;
      }
    }
  });

  it('throws RangeError on non-finite input or bad config', () => {
    expect(() => toScene({ x: NaN, y: 0, z: 0 })).toThrow(RangeError);
    expect(() => toScene({ x: 1, y: Infinity, z: 0 })).toThrow(RangeError);
    expect(() => toScene({ x: 1, y: 0, z: 0 }, { ...DEFAULT_SCALE, auToUnits: 0 })).toThrow(RangeError);
    expect(() => mapDistance(-1)).toThrow(RangeError);
  });
});

describe('displayRadius', () => {
  it('Earth = radiusScale, sqrt-compressed, clamps to minRadius', () => {
    expect(displayRadius(EARTH_RADIUS_KM)).toBeCloseTo(DEFAULT_SCALE.radiusScale, 12);
    expect(displayRadius(4 * EARTH_RADIUS_KM)).toBeCloseTo(2 * DEFAULT_SCALE.radiusScale, 12);
    expect(displayRadius(0)).toBe(DEFAULT_SCALE.minRadius);
    expect(displayRadius(1)).toBe(DEFAULT_SCALE.minRadius);
    expect(displayRadius(1, TRUE_DISTANCE_SCALE)).toBe(TRUE_DISTANCE_SCALE.minRadius);
    expect(() => displayRadius(-1)).toThrow(RangeError);
    expect(() => displayRadius(NaN)).toThrow(RangeError);
  });

  it('bigger bodies are never drawn smaller', () => {
    const bodies = [data.sun.radiusKm, ...data.planets.map((p) => p.radiusKm)].sort((a, b) => a - b);
    for (let i = 1; i < bodies.length; i++) {
      expect(displayRadius(bodies[i]!)).toBeGreaterThanOrEqual(displayRadius(bodies[i - 1]!));
    }
  });

  for (const [name, cfg] of [['DEFAULT_SCALE', DEFAULT_SCALE], ['TRUE_DISTANCE_SCALE', TRUE_DISTANCE_SCALE]] as const) {
    it(`${name}: Sun radius < 0.5 x Mercury perihelion scene distance`, () => {
      const m = data.planets[0]!;
      expect(m.id).toBe('mercury');
      for (const jd of [J2000_JD - 73050, J2000_JD, J2000_JD + 18262]) {
        const at = elementsAt(m.elements, jd);
        const peri = len(toScene({ x: at.a * (1 - at.e), y: 0, z: 0 }, cfg));
        expect(displayRadius(data.sun.radiusKm, cfg)).toBeLessThan(peri * 0.5);
      }
    });

    it(`${name}: no planet sphere (incl. Sun, Jupiter) overlaps a neighbouring orbit`, () => {
      // Radial gap between inner body's aphelion and outer body's perihelion
      // (scene units) must exceed the sum of their display radii. The Sun is
      // treated as an "orbit" of radius 0.
      for (const jd of [J2000_JD - 73050, J2000_JD, J2000_JD + 18262]) {
        const bands = [
          { id: 'sun', rIn: 0, rOut: 0, R: displayRadius(data.sun.radiusKm, cfg) },
          ...data.planets.map((p) => {
            const at = elementsAt(p.elements, jd);
            return { id: p.id, rIn: mapDistance(at.a * (1 - at.e), cfg), rOut: mapDistance(at.a * (1 + at.e), cfg), R: displayRadius(p.radiusKm, cfg) };
          }),
        ];
        for (let i = 1; i < bands.length; i++) {
          const inner = bands[i - 1]!;
          const outer = bands[i]!;
          expect(outer.rIn - inner.rOut, `${inner.id}/${outer.id}`).toBeGreaterThan(inner.R + outer.R);
        }
      }
    });
  }
});

describe('planet ordering', () => {
  it('scene distance keeps Mercury..Neptune order under linear, log and sqrt', () => {
    // Every 100 days over 1900-2100: actual positions, not just semi-major axes.
    for (let jd = J2000_JD - 36525; jd <= J2000_JD + 36525; jd += 100) {
      const helio = data.planets.map((p) => heliocentricPosition(p.elements, jd));
      for (const [name, cfg] of MODES) {
        const d = helio.map((p) => len(toScene(p, cfg)));
        for (let i = 1; i < d.length; i++) {
          expect(d[i]!, `${name} jd=${jd} ${data.planets[i]!.id}`).toBeGreaterThan(d[i - 1]!);
        }
      }
    }
  });
});

describe('purity: no three.js / DOM in src/lib/orbit/**', () => {
  it('no module under src/lib/orbit imports three', () => {
    const dir = join(root, 'src', 'lib', 'orbit');
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.[cm]?[jt]sx?$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(4);
    const threeImport = /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"]three(?:\/[^'"]*)?['"]/;
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(threeImport.test(src), f).toBe(false);
    }
  });
});
