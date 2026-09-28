import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DESKTOP_QUALITY,
  MOBILE_MAX_PIXEL_RATIO,
  MOBILE_MAX_WIDTH,
  MOBILE_QUALITY,
  pixelRatioFor,
  qualityForWidth,
} from '../../src/scene/quality';
import { nextProgress } from '../../src/ui/loadingScreen';

const root = resolve(__dirname, '../..');

describe('FE-05 quality tiers', () => {
  it('uses the mobile tier at <= 768 px and desktop above', () => {
    expect(qualityForWidth(390)).toBe(MOBILE_QUALITY);
    expect(qualityForWidth(MOBILE_MAX_WIDTH)).toBe(MOBILE_QUALITY);
    expect(qualityForWidth(MOBILE_MAX_WIDTH + 1)).toBe(DESKTOP_QUALITY);
    expect(qualityForWidth(1920)).toBe(DESKTOP_QUALITY);
    expect(qualityForWidth(Number.NaN)).toBe(DESKTOP_QUALITY);
  });

  it('mobile has fewer particles, but keeps FE-01 >= 5,000 stars; desktop keeps FE-02 >= 50,000', () => {
    expect(MOBILE_QUALITY.galaxyCount).toBeLessThan(DESKTOP_QUALITY.galaxyCount);
    expect(MOBILE_QUALITY.starCount).toBeLessThan(DESKTOP_QUALITY.starCount);
    expect(MOBILE_QUALITY.starCount).toBeGreaterThanOrEqual(5000);
    expect(DESKTOP_QUALITY.galaxyCount).toBeGreaterThanOrEqual(50000);
  });

  it('caps DPR at 1.5 on mobile and 2 on desktop', () => {
    expect(MOBILE_MAX_PIXEL_RATIO).toBe(1.5);
    expect(pixelRatioFor(3, 390)).toBe(1.5);
    expect(pixelRatioFor(1, 390)).toBe(1);
    expect(pixelRatioFor(3, 1280)).toBe(2);
    expect(pixelRatioFor(1.25, 1280)).toBe(1.25);
    expect(pixelRatioFor(0, 1280)).toBe(1);
    expect(pixelRatioFor(Number.NaN, 390)).toBe(1);
  });
});

describe('FE-05 loading progress', () => {
  it('never moves backwards while the item total grows, and holds below 100% until done', () => {
    let p = 0;
    p = nextProgress(p, 1, 1, false, false); // probe done, textures not yet queued
    expect(p).toBeCloseTo(0.2);
    p = nextProgress(p, 1, 11, false, true); // textures queued: raw ratio drops
    expect(p).toBeCloseTo(0.2 + 0.75 / 11);
    const mid = p;
    p = nextProgress(p, 1, 20, false, true); // total grows again
    expect(p).toBe(mid);
    p = nextProgress(p, 11, 11, false, true);
    expect(p).toBeCloseTo(0.95);
    expect(nextProgress(p, 11, 11, true)).toBe(1);
  });

  it('is 0 with nothing queued and clamps odd inputs', () => {
    expect(nextProgress(0, 0, 0, false, false)).toBe(0);
    expect(nextProgress(0, 5, 2, false, true)).toBeCloseTo(0.95);
    expect(nextProgress(0.3, -1, 4, false, true)).toBe(0.3);
  });
});

describe('FE-05 markup', () => {
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  it('has a static loading screen with a progressbar before the content', () => {
    expect(html).toMatch(/<div id="loading" class="loading">/);
    expect(html).toMatch(/role="progressbar"/);
    expect(html.indexOf('id="loading"')).toBeLessThan(html.indexOf('<main id="content">'));
  });
  it('declares a favicon that exists in public/', () => {
    const m = html.match(/<link rel="icon" href="\.\/([^"]+)"/);
    expect(m).not.toBeNull();
    expect(() => readFileSync(resolve(root, 'public', m?.[1] ?? ''))).not.toThrow();
  });
});
