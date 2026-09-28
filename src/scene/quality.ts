// FE-05: device quality tiers. Phones / narrow viewports (<= 768 px CSS width)
// get fewer particles and a lower pixel-ratio cap. Pure helpers are exported
// for tests; the DOM readers are thin wrappers.

/** Viewports at or below this CSS width use the mobile tier (FE-05 AC). */
export const MOBILE_MAX_WIDTH = 768;
/** Pixel-ratio cap on the mobile tier (desktop keeps core's MAX_PIXEL_RATIO = 2). */
export const MOBILE_MAX_PIXEL_RATIO = 1.5;
export const DESKTOP_MAX_PIXEL_RATIO = 2;

export type QualityTier = 'desktop' | 'mobile';

export interface QualityProfile {
  tier: QualityTier;
  /** Upper bound applied to devicePixelRatio. */
  maxPixelRatio: number;
  /** Background starfield points (FE-01 AC keeps >= 5,000). */
  starCount: number;
  /** Hero galaxy particles (FE-02 desktop AC is >= 50,000). */
  galaxyCount: number;
}

export const DESKTOP_QUALITY: Readonly<QualityProfile> = Object.freeze({
  tier: 'desktop',
  maxPixelRatio: DESKTOP_MAX_PIXEL_RATIO,
  starCount: 8000,
  galaxyCount: 60000,
});

export const MOBILE_QUALITY: Readonly<QualityProfile> = Object.freeze({
  tier: 'mobile',
  maxPixelRatio: MOBILE_MAX_PIXEL_RATIO,
  starCount: 5000,
  galaxyCount: 24000,
});

/** Quality tier for a viewport CSS width (pure). */
export function qualityForWidth(cssWidth: number): Readonly<QualityProfile> {
  return Number.isFinite(cssWidth) && cssWidth > 0 && cssWidth <= MOBILE_MAX_WIDTH
    ? MOBILE_QUALITY
    : DESKTOP_QUALITY;
}

/** Effective renderer pixel ratio: device DPR (1 if unknown) clamped to the tier cap (pure). */
export function pixelRatioFor(devicePixelRatio: number, cssWidth: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(dpr, qualityForWidth(cssWidth).maxPixelRatio);
}

/** Quality profile for the current window (read once at start-up for buffer sizes). */
export function currentQuality(): Readonly<QualityProfile> {
  return qualityForWidth(typeof window === 'undefined' ? Infinity : window.innerWidth);
}
