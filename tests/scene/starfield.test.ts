import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STAR_COUNT,
  generateStars,
  kelvinToSrgb,
} from '../../src/scene/starfield';

describe('FE-01 starfield data', () => {
  const radius = 5000;
  const data = generateStars(DEFAULT_STAR_COUNT, radius, 42);

  it('has >= 5000 stars, all on the sphere', () => {
    expect(DEFAULT_STAR_COUNT).toBeGreaterThanOrEqual(5000);
    expect(data.positions.length).toBe(DEFAULT_STAR_COUNT * 3);
    for (let i = 0; i < DEFAULT_STAR_COUNT; i++) {
      const x = data.positions[i * 3]!;
      const y = data.positions[i * 3 + 1]!;
      const z = data.positions[i * 3 + 2]!;
      expect(Math.abs(Math.hypot(x, y, z) - radius)).toBeLessThan(0.01);
    }
  });

  it('varies size and colour temperature', () => {
    const sizes = [...data.sizes];
    expect(Math.min(...sizes)).toBeGreaterThan(0);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeGreaterThan(2);
    // Blue-to-red ratio spans warm and hot stars.
    let warm = 0;
    let hot = 0;
    for (let i = 0; i < DEFAULT_STAR_COUNT; i++) {
      const r = data.colors[i * 3]!;
      const b = data.colors[i * 3 + 2]!;
      if (b < r * 0.6) warm++;
      if (b > r) hot++;
    }
    expect(warm).toBeGreaterThan(100);
    expect(hot).toBeGreaterThan(100);
    expect([...data.colors].every((c) => Number.isFinite(c) && c >= 0 && c <= 1)).toBe(true);
  });

  it('is deterministic for a seed', () => {
    const again = generateStars(100, radius, 42);
    expect([...again.positions]).toEqual([...data.positions.subarray(0, 300)]);
  });

  it('kelvinToSrgb: ~6600K is white, cool is red, hot is blue', () => {
    const [r1, g1, b1] = kelvinToSrgb(6600);
    expect(Math.min(r1, g1, b1)).toBeGreaterThan(0.95);
    const [r2, , b2] = kelvinToSrgb(3000);
    expect(r2).toBeGreaterThan(b2);
    const [r3, , b3] = kelvinToSrgb(12000);
    expect(b3).toBeGreaterThan(r3);
  });
});
