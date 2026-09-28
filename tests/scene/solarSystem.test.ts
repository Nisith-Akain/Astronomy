import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MAX_SPEED_DAYS_PER_S,
  MAX_VISUAL_SPIN_REV_PER_S,
  MIN_SPEED_DAYS_PER_S,
  easeInOutCubic,
  formatSimDate,
  formatSpeed,
  lerpVec3,
  ringRadialUVs,
  sliderToSpeed,
  speedToSlider,
  spinDelta,
} from '../../src/scene/solarSystemMath';
import { DEFAULT_SCALE, TRUE_DISTANCE_SCALE, toScene } from '../../src/lib/orbit/scale';
import { heliocentricPosition } from '../../src/lib/orbit/kepler';
import { dateToJulian } from '../../src/lib/orbit/time';
import type { SolarSystemData } from '../../src/types/planets';

const data = JSON.parse(
  readFileSync(resolve(__dirname, '../../public/data/planets.json'), 'utf8'),
) as SolarSystemData;

describe('FE-03 speed slider (log, 1 day/s .. 1 year/s)', () => {
  it('maps endpoints and is monotonic / invertible', () => {
    expect(sliderToSpeed(0)).toBeCloseTo(MIN_SPEED_DAYS_PER_S, 10);
    expect(sliderToSpeed(1)).toBeCloseTo(MAX_SPEED_DAYS_PER_S, 8);
    expect(sliderToSpeed(0.5)).toBeCloseTo(Math.sqrt(MIN_SPEED_DAYS_PER_S * MAX_SPEED_DAYS_PER_S), 8);
    let prev = 0;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const s = sliderToSpeed(t);
      expect(s).toBeGreaterThan(prev);
      expect(speedToSlider(s)).toBeCloseTo(Math.min(1, t), 9);
      prev = s;
    }
    expect(sliderToSpeed(-1)).toBeCloseTo(MIN_SPEED_DAYS_PER_S);
    expect(sliderToSpeed(2)).toBeCloseTo(MAX_SPEED_DAYS_PER_S);
  });
  it('formats labels', () => {
    expect(formatSpeed(1)).toBe('1 day/s');
    expect(formatSpeed(365.25)).toBe('1 year/s');
    expect(formatSpeed(10)).toBe('10 days/s');
  });
});

describe('FE-03 spin', () => {
  it('uses |period|: Venus/Uranus spin the same sense as prograde planets (tilt flips it)', () => {
    for (const p of data.planets) {
      const d = spinDelta(p.rotationPeriodHours, 0.001, 1);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeCloseTo((2 * Math.PI * 0.001 * 24) / Math.abs(p.rotationPeriodHours), 12);
    }
    const venus = data.planets.find((p) => p.id === 'venus');
    expect(venus && venus.rotationPeriodHours < 0 && venus.axialTiltDeg > 90).toBe(true);
  });
  it('Earth turns once per sim day and is capped for display at high speed', () => {
    expect(spinDelta(23.9345, 23.9345 / 24, 10)).toBeCloseTo(2 * Math.PI, 10);
    expect(spinDelta(10, 365, 1 / 60)).toBeCloseTo((2 * Math.PI * MAX_VISUAL_SPIN_REV_PER_S) / 60, 12);
    expect(spinDelta(10, 0, 1 / 60)).toBe(0);
    expect(spinDelta(0, 1, 1)).toBe(0);
  });
});

describe('FE-03 Saturn ring UVs', () => {
  it('u runs 0 at the inner edge to 1 at the outer edge, independent of angle', () => {
    const inner = 74658 / 58232;
    const outer = 136775 / 58232;
    const pts: number[] = [];
    const expected: number[] = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const f = (k % 5) / 4;
      const r = inner + f * (outer - inner);
      pts.push(Math.cos(a) * r, Math.sin(a) * r, 0);
      expected.push(f);
    }
    const uv = ringRadialUVs(pts, inner, outer);
    expect(uv.length).toBe(32);
    expected.forEach((f, i) => {
      expect(uv[i * 2]).toBeCloseTo(f, 5);
      expect(uv[i * 2 + 1]).toBe(0.5);
    });
  });
});

describe('FE-03 scale toggle blend', () => {
  it('lerp of the two toScene results stays on the same ray and hits both endpoints', () => {
    const jd = dateToJulian(new Date(Date.UTC(2026, 8, 24)));
    for (const p of data.planets) {
      const h = heliocentricPosition(p.elements, jd);
      const a = toScene(h, DEFAULT_SCALE);
      const b = toScene(h, TRUE_DISTANCE_SCALE);
      expect(lerpVec3(a, b, 0)).toEqual(a);
      const end = lerpVec3(a, b, 1);
      expect(end.x).toBeCloseTo(b.x, 9);
      for (const t of [0.25, 0.5, 0.75]) {
        const m = lerpVec3(a, b, t);
        const la = Math.hypot(a.x, a.y, a.z);
        const lm = Math.hypot(m.x, m.y, m.z);
        const dot = (m.x * a.x + m.y * a.y + m.z * a.z) / (la * lm);
        expect(dot).toBeCloseTo(1, 12);
      }
    }
  });
  it('easing is 0..1, monotonic', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    let prev = -1;
    for (let t = 0; t <= 1; t += 0.01) {
      const v = easeInOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('FE-03 date display', () => {
  it('formats UTC', () => {
    expect(formatSimDate(new Date(Date.UTC(2000, 0, 1, 12, 5)))).toBe('2000-01-01 12:05 UTC');
  });
});
