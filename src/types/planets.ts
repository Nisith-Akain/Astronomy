// C2 types (TEAM/INTERFACES.md), published by BE-02. Keep verbatim with C2.
export interface OrbitalElements {
  // Values at J2000.0 (JD 2451545.0), JPL "Approximate Positions of the
  // Major Planets" (Standish), Table 1 (valid 1800-2050 AD).
  a: number;      // semi-major axis, AU
  e: number;      // eccentricity, dimensionless
  I: number;      // inclination, degrees
  L: number;      // mean longitude, degrees
  varpi: number;  // longitude of perihelion, degrees
  Omega: number;  // longitude of ascending node, degrees
  // Rates per Julian century, same units per century.
  aDot: number; eDot: number; IDot: number;
  LDot: number; varpiDot: number; OmegaDot: number;
}

export interface Planet {
  id: string;                 // lowercase, e.g. "earth"  (stable key)
  name: string;               // display name, e.g. "Earth"
  radiusKm: number;           // mean radius
  axialTiltDeg: number;
  rotationPeriodHours: number; // negative = retrograde (Venus, Uranus)
  orbitalPeriodDays: number;   // informational only; motion comes from elements
  color: string;              // "#rrggbb" fallback if texture fails
  texture: string;            // path relative to public/, e.g. "textures/planets/earth.jpg"
  ring?: { innerKm: number; outerKm: number; texture: string };
  facts: string[];            // 2-4 short strings for the info panel
  elements: OrbitalElements;
}

export interface Star {
  id: "sun"; name: string; radiusKm: number;
  rotationPeriodHours: number; color: string; texture: string; facts: string[];
}

export interface SolarSystemData {
  schemaVersion: 1;
  epoch: "J2000";
  source: string;             // citation string
  sun: Star;
  planets: Planet[];          // exactly 8, ordered Mercury..Neptune
}
