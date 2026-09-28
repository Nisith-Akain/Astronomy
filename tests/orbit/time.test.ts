import { describe, it, expect } from 'vitest';
import {
  J2000_JD,
  dateToJulian,
  julianToDate,
  centuriesSinceJ2000,
} from '../../src/lib/orbit/time';

describe('time utilities', () => {
  it('J2000_JD constant', () => {
    expect(J2000_JD).toBe(2451545.0);
  });

  it('dateToJulian at J2000.0 is exactly 2451545.0', () => {
    expect(dateToJulian(new Date(Date.UTC(2000, 0, 1, 12)))).toBe(2451545.0);
  });

  it('dateToJulian at Unix epoch is 2440587.5', () => {
    expect(dateToJulian(new Date(0))).toBe(2440587.5);
  });

  it('julianToDate at J2000.0', () => {
    expect(julianToDate(J2000_JD).toISOString()).toBe('2000-01-01T12:00:00.000Z');
  });

  it('round-trips Date -> JD -> Date within 1 ms (1800..2100, random ms)', () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const lo = Date.UTC(1800, 0, 1);
    const hi = Date.UTC(2100, 0, 1);
    for (let i = 0; i < 2000; i++) {
      const ms = Math.floor(lo + rand() * (hi - lo));
      const back = julianToDate(dateToJulian(new Date(ms)));
      expect(Math.abs(back.getTime() - ms)).toBeLessThanOrEqual(1);
    }
    const now = new Date();
    expect(Math.abs(julianToDate(dateToJulian(now)).getTime() - now.getTime())).toBeLessThanOrEqual(1);
  });

  it('centuriesSinceJ2000', () => {
    expect(centuriesSinceJ2000(J2000_JD)).toBe(0);
    expect(centuriesSinceJ2000(J2000_JD + 36525)).toBe(1);
    expect(centuriesSinceJ2000(J2000_JD - 36525 / 2)).toBe(-0.5);
  });

  it('rejects invalid input', () => {
    expect(() => dateToJulian(new Date(NaN))).toThrow(RangeError);
    expect(() => julianToDate(NaN)).toThrow(RangeError);
    expect(() => julianToDate(Infinity)).toThrow(RangeError);
  });
});
