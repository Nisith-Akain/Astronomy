/**
 * Time utilities for orbital calculations (contract C3).
 * Pure TypeScript: no three.js, no DOM.
 *
 * Julian Dates here are on the UTC time scale (JS Date is UTC-based). The
 * ~69 s TT-UTC offset is ignored: it moves a planet by far less than the
 * accuracy of the JPL approximate elements (arcminutes).
 */

/** Julian Date of the J2000.0 epoch (2000-01-01T12:00:00Z). */
export const J2000_JD = 2451545.0;

/** Julian Date of the Unix epoch (1970-01-01T00:00:00Z). */
const UNIX_EPOCH_JD = 2440587.5;
const MS_PER_DAY = 86_400_000;
const DAYS_PER_JULIAN_CENTURY = 36525;

/** Convert a JS Date to a Julian Date (days, fractional). */
export function dateToJulian(date: Date): number {
  const ms = date.getTime();
  if (!Number.isFinite(ms)) {
    throw new RangeError('dateToJulian: invalid Date');
  }
  return ms / MS_PER_DAY + UNIX_EPOCH_JD;
}

/** Convert a Julian Date back to a JS Date (rounded to the nearest ms). */
export function julianToDate(jd: number): Date {
  if (!Number.isFinite(jd)) {
    throw new RangeError('julianToDate: jd must be finite');
  }
  return new Date(Math.round((jd - UNIX_EPOCH_JD) * MS_PER_DAY));
}

/** Julian centuries (36525 days) elapsed since J2000.0; the `T` in JPL's formulas. */
export function centuriesSinceJ2000(jd: number): number {
  return (jd - J2000_JD) / DAYS_PER_JULIAN_CENTURY;
}
