# INTERFACES.md -- Shared contracts

Owner of this file: COO. Any change to a contract below must be proposed in
TASKS.md under the relevant ticket and approved before code depends on it.
Status of every contract here: **v1.0 -- COO-approved 2026-09-29** (DRAFT v0.1
published with the initial ticket breakdown, 2026-09-24). All "As built" /
"Additive exports ... (proposed)" items below were reviewed and approved into
their contract on 2026-09-29 unless marked otherwise; see the TASKS.md Review
log. Items marked **[deprecated]** or **[follow-up: TICKET]** are known gaps
with an assigned follow-up ticket.

---

## C1. Project layout (published by BE-01)

```
astronomy-site/
  index.html
  package.json            # scripts: dev, build, preview, test, typecheck
  vite.config.ts
  tsconfig.json
  public/
    data/planets.json     # C2
    textures/planets/     # C5
    textures/CREDITS.md
    models/               # C5 (.glb)
  src/
    main.ts               # entry; wires sections together
    types/planets.ts      # TS types for C2
    lib/orbit/            # MATH-owned, pure TS, NO three.js imports (C3)
    scene/                # FE-owned three.js code (C4)
    ui/                   # FE-owned DOM overlays
    styles/
  tests/                  # vitest
```

Language: TypeScript (strict). Test runner: vitest. 3D: three (npm), no CDN.

As built by BE-01 (2026-09-24):
- Pinned: `three@0.186.0`, `@types/three@0.186.0`, `typescript@7.0.2`,
  `vite@8.3.0`, `vitest@5.0.1`, `@types/node@24.13.6`. Node >= 20.19.
- `tsconfig.json`: `strict`, plus `noUncheckedIndexedAccess`,
  `noUnusedLocals/Parameters`, `verbatimModuleSyntax` (use `import type` for
  type-only imports), `moduleResolution: bundler`, `types: [vite/client, node]`.
  Covers `src/`, `tests/`, `vite.config.ts`.
- `vite.config.ts`: `base: './'`; vitest picks up `tests/**/*.test.ts`
  (subfolders fine, e.g. `tests/orbit/`), environment `node`.
- `npm run build` runs `tsc --noEmit` first, so a type error anywhere fails
  the build.
- `index.html`: `<canvas id="stage" aria-hidden="true">` then
  `<main id="content">` containing the four `<section data-section>` blocks
  (each also has a matching `id`). `src/styles/main.css` fixes the canvas
  full-viewport behind content; sections are `min-height: 100vh`.
- Target browsers (Q5, decided): current evergreen Chrome/Firefox/Safari/Edge;
  build target `es2022`.

---

## C2. Planet data -- `public/data/planets.json` (published by BE-02)

Fetched at runtime via `fetch(import.meta.env.BASE_URL + 'data/planets.json')`.

```ts
// src/types/planets.ts
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
```

Data notes (BE-02, 2026-09-24; clarifications only, no schema change):
- `src/types/planets.ts` exists with the interfaces above verbatim. Consumers
  should `import type { ... } from '../types/planets'` (path relative to caller).
- The JSON is not imported by the bundle; FE fetches it at runtime and may cast
  to `SolarSystemData` (validated by `tests/planets-data.test.ts`).
- Units as commented above. `orbitalPeriodDays` is sidereal. `L` and `varpi`
  may be negative (Mars, Neptune) exactly as in JPL Table 1; normalise angles
  in code, not in data.
- **Tilt vs. retrograde (FE-03 must read this):** `axialTiltDeg` is the NASA
  fact-sheet obliquity to orbit, so Venus = 177.4 and Uranus = 97.77 are
  already > 90 deg, which on its own flips the spin direction. The negative
  `rotationPeriodHours` for those two is the same fact encoded a second way.
  Renderers must NOT apply both: either tilt by `axialTiltDeg` and spin by
  `abs(rotationPeriodHours)` (recommended), or tilt by
  `min(tilt, 180 - tilt)` and spin with the signed period.
- Saturn `ring`: innerKm 74,658 (C ring inner edge) to outerKm 136,775 (A ring
  outer edge), measured from Saturn's centre.
- Sun `rotationPeriodHours` = 609.12 (equatorial sidereal).

---

## C3. Orbital math -- `src/lib/orbit/` (published by MATH-01, MATH-02)

Pure functions, no three.js, no DOM. All angles in the public API are
**radians** except where they are read directly from C2 (degrees); the
conversion happens inside `elementsAt`.

```ts
// src/lib/orbit/time.ts
export const J2000_JD = 2451545.0;
export function dateToJulian(date: Date): number;
export function julianToDate(jd: number): Date;
export function centuriesSinceJ2000(jd: number): number;

// src/lib/orbit/kepler.ts
/** Solve M = E - e sin E for E. M in radians (any value; normalised internally).
 *  Throws RangeError if e < 0 or e >= 1 or inputs are non-finite. */
export function solveKepler(M: number, e: number, tol?: number /*1e-12*/, maxIter?: number /*50*/): number;

export interface Vec3 { x: number; y: number; z: number; }

/** Heliocentric ecliptic J2000 position in AU. */
export function heliocentricPosition(el: OrbitalElements, jd: number): Vec3;

// --- Additive exports from MATH-01 (APPROVED into C3, COO 2026-09-29) ---
/** Same as solveKepler, plus diagnostics. Same validation / RangeErrors. */
export interface KeplerSolution { E: number; iterations: number; converged: boolean; }
export function solveKeplerDetailed(M: number, e: number, tol?: number, maxIter?: number): KeplerSolution;
/** C2 elements propagated to `jd` (T = centuriesSinceJ2000(jd)), angles in RADIANS.
 *  omega = varpi - Omega; M = L - varpi wrapped to [-pi, pi]. Intended for MATH-02 orbitPath. */
export interface ElementsAt { a: number; e: number; I: number; L: number; varpi: number;
  Omega: number; omega: number; M: number; }
export function elementsAt(el: OrbitalElements, jd: number): ElementsAt;

// src/lib/orbit/path.ts
/** Closed orbit polyline at the elements valid at `jd`; returns
 *  Float32Array of length segments*3 (xyz, AU, ecliptic). */
export function orbitPath(el: OrbitalElements, jd: number, segments?: number /*256*/): Float32Array;

// src/lib/orbit/scale.ts
export interface ScaleConfig { distance: "linear" | "log" | "sqrt"; auToUnits: number; radiusScale: number; minRadius: number; }
export const DEFAULT_SCALE: ScaleConfig;
/** Ecliptic AU -> three.js scene units, Y-up: scene = (x, z, -y) after distance mapping. */
export function toScene(p: Vec3, cfg?: ScaleConfig): Vec3;
/** Planet display radius in scene units. */
export function displayRadius(radiusKm: number, cfg?: ScaleConfig): number;

// --- Additive exports from MATH-02 (APPROVED into C3, COO 2026-09-29) ---
// path.ts: float64 point on the ellipse at eccentric anomaly E (AU, ecliptic);
// orbitPath is built from it; orbitPointAtE(elementsAt(el,jd), solveKepler(M,e)) == heliocentricPosition.
export function orbitPointAtE(el: ElementsAt, E: number): Vec3;
// scale.ts
export const EARTH_RADIUS_KM = 6371.0;
/** Q1 "true distance" toggle preset: linear, radii still exaggerated. */
export const TRUE_DISTANCE_SCALE: ScaleConfig;
/** Radial mapping only: AU -> scene units (linear r*k | sqrt(r)*k | ln(1+r)*k). */
export function mapDistance(rAU: number, cfg?: ScaleConfig): number;
```

Behaviour notes (MATH-02; Q1 decided by CTO: sqrt + exaggerated radii,
toggle to true distance):
- `orbitPath` samples uniformly in eccentric anomaly, E_k = 2*pi*k/segments,
  k = 0..segments-1; point 0 is perihelion; the end point is NOT repeated,
  so draw with `THREE.LineLoop`. Output is ecliptic AU: run each point
  through `toScene` (same `cfg` as the planets) before building geometry.
  Throws `RangeError` for segments not an integer >= 3, non-finite jd, or
  propagated e outside [0, 1).
- `DEFAULT_SCALE = { distance: "sqrt", auToUnits: 50, radiusScale: 1.0, minRadius: 0.5 }`
  (Mercury perihelion ~27.7 u, Earth ~50 u, Jupiter ~114 u, Neptune ~274 u;
  Sun radius ~10.4 u, Earth 1.0 u).
  `TRUE_DISTANCE_SCALE = { distance: "linear", auToUnits: 9, radiusScale: 0.12, minRadius: 0.08 }`
  (Mercury perihelion ~2.8 u, Earth 9 u, Neptune ~271 u; Sun ~1.25 u, Earth 0.12 u).
  Both presets place Neptune at about the same extent, so camera framing
  survives the toggle. Presets are frozen objects; spread them to customise.
- `displayRadius(km, cfg) = max(minRadius, radiusScale * sqrt(km / 6371))`;
  it ignores `distance`/`auToUnits`. Radii differ between the two presets, so
  FE-03 should animate the radius as well as the position when toggling (lerp
  between the two `toScene` results and the two `displayRadius` values, or
  between two `mapDistance` values along the same direction).
- Saturn ring: scale from the planet, keeping true proportions:
  `displayRadius(p.radiusKm, cfg) * ring.innerKm|outerKm / p.radiusKm`.
  Do not pass ring radii through `displayRadius`.
- In both presets no body's sphere (Sun included) reaches a neighbouring
  planet's orbit band (checked 1800-2050).
- `toScene`/`mapDistance` throw `RangeError` on non-finite input, negative
  distance, `auToUnits <= 0`, or an unknown `distance` mode. `displayRadius`
  throws `RangeError` on non-finite/negative `radiusKm` only; it does **not**
  yet validate `cfg` (a bad `radiusScale`/`minRadius` passes through silently).
  **[follow-up: MATH-03]** will add config validation to `displayRadius`
  (non-finite or negative `radiusScale`/`minRadius` -> `RangeError`; it will
  NOT check `auToUnits`, which `displayRadius` does not use). Until then, only
  pass the frozen presets or configs derived from them by spreading.
- **Accuracy (clarified by COO 2026-09-29):** the 1e-9 AU accuracy guarantee
  applies to the float64 core `orbitPointAtE`. `orbitPath` stores its points
  in a `Float32Array`, so each stored coordinate equals `Math.fround` of the
  float64 core point (relative error < 2e-7, about 1.3e-6 AU at Neptune). That
  is far below one scene unit under either preset.

Coordinate convention: ecliptic (x toward vernal equinox, z = ecliptic north)
maps to three.js as `(x, z, -y)` so the ecliptic plane is the XZ plane and
+Y is ecliptic north. Only `toScene` performs this swap.

Behaviour/timing notes (MATH-01):
- Julian Dates are on the UTC scale (`Date.getTime()` based); TT-UTC (~69 s)
  is ignored as negligible vs. the approximate-elements accuracy.
- `julianToDate` rounds to the nearest ms; round-trip error <= 1 ms.
- `dateToJulian` / `julianToDate` / `elementsAt` throw `RangeError` on
  invalid Date / non-finite jd.
- `solveKepler` returns E in [-pi, pi]; if `maxIter` is exhausted it returns
  the best estimate (bracketed, never diverges) rather than throwing. The
  contract guarantee is convergence within `maxIter` (default 50) for all
  0 <= e <= 0.99. Measured worst case with default settings: **12 iterations**
  (QA, 991 x 4001 (e, M) grid; typical is <= 10). (Corrected by COO 2026-09-29;
  this line previously said "<= 10", which is false near e -> 0.99.)
- JPL Table 1 elements are valid 1800-2050 AD; outside that range positions
  degrade (no clamping is done).
- Q2 (CTO: start at the visitor's current date): FE-03 should seed its sim
  clock with `dateToJulian(new Date())`; "reset to now" does the same.

---

## C4. Scene core -- `src/scene/` (published by FE-01)

```ts
// src/scene/core.ts
export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  clock: THREE.Clock;
  loadingManager: THREE.LoadingManager;
  reducedMotion: boolean;               // from prefers-reduced-motion
  onTick(cb: (dt: number, elapsed: number) => void): () => void; // returns unsubscribe
  dispose(): void;
}
export function createSceneCore(canvas: HTMLCanvasElement): SceneContext;
```

Every section module exports:
```ts
export interface SectionModule {
  id: "hero" | "solar-system" | "probe" | "outro";
  group: THREE.Group;                   // everything the section adds to the scene
  init(ctx: SceneContext): Promise<void>;
  setActive(active: boolean): void;     // pause per-frame work when off-screen
  dispose(): void;
}
```

Single `<canvas id="stage">` fixed behind the page; one renderer, one
render loop. No section creates its own renderer or its own RAF loop.

As built by FE-01 (2026-09-24), with the C4 signatures above unchanged:
- `src/scene/core.ts` exports `SceneContext`, `SectionModule` (both verbatim),
  `createSceneCore`, and the helpers `disposeObjectTree(root)` (disposes
  geometries, materials and textures under a node) and the constants
  `MAX_PIXEL_RATIO = 2`, `CAMERA_FOV = 55`, `CAMERA_NEAR = 0.1`,
  `CAMERA_FAR = 20000`. The camera starts at (0, 0, 10) looking down -Z and is
  added to the scene, so children of the camera render.
- Renderer: `outputColorSpace = SRGBColorSpace`,
  `toneMapping = ACESFilmicToneMapping`, exposure 1, opaque black clear. Only
  core.ts sets these; sections must not change them. Custom `ShaderMaterial`s
  should end the fragment shader with `#include <tonemapping_fragment>` and
  `#include <colorspace_fragment>` and should write linear colours.
- Sizing: the drawing buffer follows the canvas CSS size (`clientWidth` and
  `clientHeight`), and DPR = `min(devicePixelRatio, 2)`. It updates on window
  `resize` and through a `ResizeObserver`. Read the current DPR with
  `renderer.getPixelRatio()`. FE-05 may lower the 2 cap on mobile.
- `onTick(cb)`: the loop calls subscribers in subscription order, then
  renders once. `dt` is in seconds, clamped to <= 0.1. `elapsed` is the sum
  of the `dt` values: it counts only running time and excludes hidden-tab
  time. Unsubscribing during a tick is safe. The loop pauses while
  `document.hidden` and resumes without a time jump.
- `reducedMotion` is kept live: a `matchMedia` change listener updates it.
  Read it per frame if the behaviour should follow the setting.
- `dispose()` stops the loop and clears subscribers. It removes the listeners
  and disposes everything still in `scene` (via `disposeObjectTree`), then
  disposes the renderer. It is idempotent.
- `THREE.Clock` has been deprecated since r183: it logs a single
  `console.warn` when constructed. It is kept because C4 requires it. The
  loop owns `clock.getDelta()`, so sections must NOT call
  `getDelta()`/`getElapsedTime()` on it, because that would steal time from
  the loop. Use the `onTick` arguments instead.
  **Proposal (needs COO approval):** change `clock: THREE.Clock` to
  `timer: THREE.Timer`, or drop the field, to remove the warning.
  **COO decision (2026-09-29):** accepted as-is for v1; the warning is harmless.
  **[follow-up: FE-07]** C4 v1.1 will **drop** `clock` from `SceneContext`
  (no section reads it; grep confirms only `core.ts` uses it). `core.ts` will
  drive the loop from a private `THREE.Timer` or `performance.now()`. Sections
  must keep using `onTick`'s `dt`/`elapsed` only.
- Starfield (`src/scene/starfield.ts`): `createStarfield(ctx, opts?)` ->
  `{ points, material, dispose() }`, where `opts` is
  `{ count = 8000, radius = 5000, twinkle = 0.35, seed = 1 }`. It is a
  background layer, not a `SectionModule`. The `THREE.Points` object is
  named `"starfield"`, uses `renderOrder -1000`, is additive, uses
  `depthWrite: false`, and has `toneMapped: false`. It re-centres on
  `camera.position` every tick, so the sky never parallaxes. `radius` must stay
  below `CAMERA_FAR` (FE-04: keep this in mind if you change `camera.far`).
  Twinkle amplitude is 0 while `ctx.reducedMotion`.

As built by FE-03 (2026-09-24), solar-system section; C4 unchanged, the items
below are additive. **APPROVED into C4 (COO 2026-09-29)**: `createSolarSystem`,
`SolarSystemSection` (incl. `setCameraControl`, `focus`, `getFocused`,
`onFocusChange`, `setScaleMode`, `getScaleMode`, `getJulianDate`), `ScaleMode`,
`SolarSystemOptions`, `SOLAR_SCALES`. **[deprecated]** `mountSolarSystem`:
interim wiring, no longer called since FE-04. It is removed in
**[follow-up: FE-07]**, so do not add new callers.
- `src/scene/solarSystem.ts`:
  ```ts
  export type ScaleMode = 'default' | 'true-distance';
  export interface SolarSystemSection extends SectionModule {
    id: 'solar-system';
    setCameraControl(enabled: boolean): void; // default true; false = never touches ctx.camera
    focus(id: string | null): void;           // "sun" | planet id | null = overview
    getFocused(): string | null;
    onFocusChange(cb: (id: string | null) => void): () => void;
    setScaleMode(mode: ScaleMode): void;       // animated (instant if reducedMotion)
    getScaleMode(): ScaleMode;
    getJulianDate(): number;                   // current sim JD (UTC)
  }
  export interface SolarSystemOptions { section?: HTMLElement; dataUrl?: string }
  export function createSolarSystem(opts?: SolarSystemOptions): SolarSystemSection;
  export function mountSolarSystem(ctx: SceneContext, opts?: SolarSystemOptions): SolarSystemSection;
  export const SOLAR_SCALES: Readonly<Record<ScaleMode, ScaleConfig>>;
  ```
- `init(ctx)` fetches C2, builds everything and adds `group` (name
  `"solar-system"`, at the world origin, 1 unit = scene units from C3) to
  `ctx.scene`. It does NOT move the camera. `setActive(true)` subscribes to
  `onTick` and, if camera control is on, flies the camera (1.8 s ease,
  or an instant cut if `reducedMotion`) from its current view into the overview
  (target (0,0,30), ~640 u away, ~36 deg up; drag orbits it).
  `setActive(false)` unsubscribes, which stops the sim clock, spin, picking and
  camera updates, and hides the hover label. The group stays visible either way,
  so FE-04 decides visibility. All pose maths runs in group-local space, so
  FE-04 may move the group.
- The group contains a `PointLight` (the Sun, decay 0) and a weak
  `AmbientLight`. They light any lit material in the scene (FE-04: the probe
  section, if it is lit). Hero (FE-02) sits at z = -3000, well clear.
- **FE-04 integration:** call `setCameraControl(false)` while you fly the
  camera, and `true` once the user stops in the section. Re-enabling blends
  smoothly from the current view. Use `onFocusChange` to avoid fighting a
  focused planet. `mountSolarSystem` (wired in main.ts by a single dynamic-import
  line) is interim wiring only: it activates the section through an
  IntersectionObserver (at least 50% of the section visible). Replace it with
  `createSolarSystem()` plus your C6 orchestration.
- DOM: the overlay is appended inside `section[data-section="solar-system"]`
  (`.ss-ui`, styles in `src/styles/solar-system.css`, which sets the section to
  `position: relative`). The UI in `src/ui/solarSystemUi.ts` is internal.
  Pointer picking listens on the section element (not the canvas, which sits
  behind `#content`). Empty areas of the overlay have `pointer-events: none`.
- Pure helpers for tests: `src/scene/solarSystemMath.ts` (`sliderToSpeed`,
  `spinDelta`, `ringRadialUVs`, ...). Speed range is 1 to 365.25 days/s, log
  scale, default 10 days/s. The sim date is clamped to 1000-3000 AD and the UI
  flags dates outside 1800-2050 as approximate. Displayed spin is capped at
  2 rev/s real time (anti-aliasing); below the cap it is exact.

As built by FE-02 (2026-09-24), hero section. C4 is unchanged; the items
below are additive. **APPROVED into C4 (COO 2026-09-29)**, including
`HeroOptions.claimCamera` and `HeroSection.setActive`/`isActive` semantics.
- `src/scene/hero.ts`:
  ```ts
  export interface GalaxyOptions { count?: number /*60000*/; arms?: number /*4*/; radius?: number /*100*/;
    spin?: number /*5 rad*/; scatter?: number /*0.4*/; thickness?: number /*0.06*/;
    bulgeFraction?: number /*0.16*/; coreColor?: THREE.ColorRepresentation /*#ffd49a*/;
    edgeColor?: THREE.ColorRepresentation /*#5d8cff*/; seed?: number }
  export interface HeroOptions extends GalaxyOptions {
    anchor?: THREE.Vector3;   // default HERO_ANCHOR
    rotationSpeed?: number;   // rad/s, default 0.025
    claimCamera?: boolean;    // default true: init() puts the camera at heroCameraView()
  }
  export interface HeroSection extends SectionModule {
    id: 'hero'; readonly points: THREE.Points; readonly nebula: THREE.Mesh;
    readonly galaxyMaterial: THREE.ShaderMaterial; readonly nebulaMaterial: THREE.ShaderMaterial;
    isActive(): boolean;
  }
  export function createHero(opts?: HeroOptions): HeroSection;
  export const HERO_ANCHOR: Readonly<THREE.Vector3>; // (0, 0, -3000)
  export function heroCameraView(anchor?, radius?): { position: THREE.Vector3; target: THREE.Vector3 };
  export function generateGalaxy(opts?: GalaxyOptions): GalaxyData; // pure, for tests
  export const DEFAULT_GALAXY_COUNT = 60000, DEFAULT_ARMS = 4, DEFAULT_GALAXY_RADIUS = 100;
  ```
- The group is named `"hero"` and sits at `HERO_ANCHOR`, 3000 u from the solar
  system at the origin. The galaxy disc lies in the group's XZ plane. Children:
  `"hero-galaxy"` (Points, additive, `depthWrite: false`, renderOrder 0) and
  `"hero-nebula"` (fbm-noise quad, additive, renderOrder -10). The nebula sits
  3 radii behind the galaxy centre and faces the `heroCameraView` position, so
  it looks best from near that view.
- `heroCameraView()` is the suggested hero camera keyframe (FE-04): camera at
  anchor + (0, 115, 175), looking at anchor + (0, 42, 0). The galaxy fills the
  lower ~60% of the frame and the title sits above it.
- `init(ctx)` adds the group and, unless `claimCamera: false`, moves the camera
  once to `heroCameraView()`. It then calls `setActive(true)`: the hero is the
  landing section, so it starts active. **FE-04:** pass `claimCamera: false` and
  drive activation yourself.
- `setActive(false)` unsubscribes from `onTick` and sets `group.visible = false`,
  so there are no draw calls and no per-frame work. `setActive(true)` reverses
  both. It is idempotent. Animation time is local: it is the sum of `dt` while
  active and not `ctx.reducedMotion`, and `reducedMotion` is read every frame.
  So a re-activation never jumps, and with reduced motion on the frame is
  static. `ctx.clock` is never touched.
- All motion runs in the vertex shader (rigid pattern rotation plus a bounded
  per-particle wobble, so the arms never wind up) and the nebula's fragment
  shader. Buffers are uploaded once. Shaders write linear colour and end with
  the tonemapping/colorspace includes.
- DOM: static markup in `index.html` inside `section#hero` (`.hero-overlay`
  containing `h1#hero-title` and `p.hero-subtitle`, plus `p.hero-scroll-cue`),
  styled by `src/styles/hero.css`, which hero.ts imports. The section is
  `aria-labelledby="hero-title"`.
- Interim wiring: one line in `src/main.ts`, `void createHero().init(ctx);`.
  Nothing deactivates the hero yet. FE-04 should replace this line with C6
  orchestration. **(Done by FE-04: see C6 "As built". The hero is now created
  with `claimCamera: false` and activated by `createFlight`.)**

As built by FE-05 (2026-09-29). C4 signatures are unchanged; the items below are
additive. **APPROVED into C4 (COO 2026-09-29).**
- `src/scene/quality.ts` (pure, no three): `MOBILE_MAX_WIDTH = 768`,
  `MOBILE_MAX_PIXEL_RATIO = 1.5`, `DESKTOP_MAX_PIXEL_RATIO = 2`,
  `interface QualityProfile { tier: 'desktop'|'mobile'; maxPixelRatio; starCount; galaxyCount }`,
  `DESKTOP_QUALITY` (2 / 8000 / 60000), `MOBILE_QUALITY` (1.5 / 5000 / 24000),
  `qualityForWidth(cssWidth)`, `pixelRatioFor(dpr, cssWidth)`, `currentQuality()`.
  Particle counts are chosen once at start-up from `window.innerWidth`; the DPR cap
  is re-evaluated on every resize (`core.ts` now uses `pixelRatioFor`, still also
  clamped by `MAX_PIXEL_RATIO`).
- `createFlight(ctx, opts?: FlightOptions)` where
  `FlightOptions = { hero?: Omit<HeroOptions, 'claimCamera'> }` (used for the mobile
  galaxy count). Existing one-argument calls are unchanged.
- FE-03 picking: taps (`pointerType === 'touch'`) use a 24 px minimum pick radius
  (mouse stays 10 px). `section[data-section="solar-system"]` has
  `touch-action: pan-y` (vertical swipe scrolls, horizontal swipe orbits).
- Loading screen (`src/ui/loadingScreen.ts`, `src/styles/loading.css`): static
  markup `#loading.loading > .loading-panel` (with a `[role=progressbar]`) sits
  right after `#stage` in `index.html`, with critical inline styles in `<head>` so
  it paints before JS. `createLoadingScreen(el?)` -> `{ element, track(manager,
  ready), showError(title, message), hide(), progress() }`; `nextProgress(...)`
  and `hasWebGL2()` are exported. `track` **wraps** (does not replace)
  `loadingManager.onStart/onProgress/onLoad`; if you also set these, assign before
  `main.ts` runs or chain the previous value (note: in three r186 they are
  `undefined` at runtime despite the typings, so call previous handlers
  optionally). The screen hides once `flight.ready` has settled AND the manager has
  no pending items, or after 20 s at most (`LOADING_TIMEOUT_MS`). Failed items do
  not block it.
- No WebGL2 (or `WebGLRenderer` throws): `main.ts` adds `html.no-webgl`, hides
  `#stage`, does not create any section, and `#loading` becomes
  `.is-error` with a `role="alert"` message and a "Continue to the text version"
  button. Sections must not assume a `SceneContext` exists in that case.
- Dev-only hooks (not a contract): `window.__ctx` (SceneContext) and
  `window.__quality`, next to FE-04's `window.__flight`.
- `public/favicon.svg`, linked from `index.html` (fixes the `/favicon.ico` 404).

---

## C5. Assets (published by BE-03, BE-04)

- Planet textures: `public/textures/planets/{id}.jpg` (+ `saturn_ring.png`,
  `sun.jpg`), equirectangular 2:1, max 2048x1024, each <= 800 KB.
- **Exception (COO-approved 2026-09-29):** `saturn_ring.png` is a radial strip
  (2048x125 RGBA, u = inner -> outer edge), the standard ring-texture format,
  not a 2:1 equirectangular map. It must stay <= 2048 px wide and <= 800 KB and
  keep its alpha channel. FE-03 remaps the `RingGeometry` UVs radially to match
  (`ringRadialUVs`).
- License/credits for every file in `public/textures/CREDITS.md`.
- Model: `public/models/probe.glb`, glTF 2.0 binary, <= 3 MB, Y-up,
  1 unit = 1 m, origin at the craft's centre of mass, facing -Z (three.js
  forward), PBR metal/rough materials, <= 50k triangles, no embedded cameras
  or lights. Optional named node `"dish"` (antenna) for animation.

---

## C6. Page sections / scroll anchors (published by FE-04)

DOM sections in order, each `<section data-section="...">`:
`hero`, `solar-system`, `probe`, `outro`. Camera keyframes are keyed by these
ids. Scroll progress is exposed as:
```ts
// src/scene/scroll.ts
export function onSectionProgress(cb: (id: string, progress01: number) => void): () => void;
```

As built by FE-04 (2026-09-24). The C6 signature above is unchanged; the items
below are additive. **APPROVED into C6 (COO 2026-09-29).** Known coupling:
`SOLAR_OVERVIEW_*` duplicates FE-03's private constants, and the test only
checks literals. **[follow-up: FE-07]** FE-03 will export the overview pose,
and `flightPath.ts` will import it.
- **Progress definition** (`src/scene/scrollMath.ts`, pure): progress is measured
  on the viewport-centre line `c = scrollY + innerHeight/2`. Section i owns
  `[top_i, top_{i+1})`. The first range starts at the smallest reachable c
  (`vh/2`) and the last range ends at the largest (`docHeight - vh/2`). The
  ranges are contiguous, so at most one section is mid-progress at a time:
  earlier sections read 1 and later ones read 0. With the current layout
  (hero 100vh, solar-system 100vh, probe 300vh, outro 100vh) the hero is at 0 at
  the page top, the solar-system is at 0.5 when it fills the viewport, and the
  outro is at 1 at the page bottom.
- `onSectionProgress(cb)` calls `cb` once for each of the 4 ids straight away with
  the current value, then on every change. It is driven by one passive `scroll`
  listener. There is **no rAF** (C4). Layout is re-measured on `resize`, on
  `load` and through a `ResizeObserver` on `<html>`/`#content`.
- Additive exports: `getScrollSnapshot(): { global: number /*0..4 = index +
  progress*/; progress: Record<SectionId, number> }`, `disposeScrollTracker()`
  (for HMR), and the `SectionId` type. `scrollMath.ts` exports `SECTION_IDS`,
  `computeRanges`, `rangeProgress`, `globalParam`, `scrollToPath`, `PATH_REMAP`,
  `dampStep`, `DEFAULT_DAMP`, `nearestShot` and `windowOpacity` (all pure).
- **Camera path** (`src/scene/flightPath.ts`): the path parameter p runs 0..4,
  with `p = scrollToPath(global)`. Stations are hero at p = 0, the
  solar-system overview at 1.5 (held for global 1.35-1.65) and the outro at 4
  (held for global 3.8-4). Keyframes run through centripetal `CatmullRomCurve3`s,
  one for positions and one for look-at targets. Each keyframe is hit exactly
  at its p, with per-segment easing. `poseAt(p)` is pure.
  `SOLAR_OVERVIEW_POSITION/TARGET` copy FE-03's private OVERVIEW_* constants
  (target (0,0,30), 640 u, 0.63 rad). **FE-03:** if you change those constants,
  tell FE-04. A mismatch only shows up as a short blend. Exports also
  include `PROBE_START` (120,20,-480), `PROBE_DIRECTION`, `PROBE_DRIFT` (30 u),
  `probePosition(progress)`, `probeQuaternion()`, `STATIONS` and `SHOTS`.
- **Orchestrator** (`src/scene/flight.ts`): `createFlight(ctx): Flight`, which
  exposes `{ sections, ready, state(), dispose() }`. It creates and `init`s all four
  sections: `createHero({ claimCamera: false })`, `createSolarSystem()` (followed
  immediately by `setCameraControl(false)`), `createProbe()` and
  `createOutro()`. `src/main.ts` now only calls `createFlight(ctx)`.
  `mountSolarSystem` and the hero's self-activation are no longer used.
  - Damping: the camera's p follows the target p exponentially (rate 4/s),
    capped at 1.5 p/s, so there is no teleport on fast scroll or on the End key.
    On load it snaps, so a reload mid-page does not fly in. Snapping stops at
    the first wheel, touch, key or pointer input, or after 1.5 s.
  - Activation, by the camera's p: hero while p < 1.3. Solar-system while
    0.6 <= p <= 2.3, or while a planet is focused. Probe while p >= 1.6. Outro
    while p >= 3.2. The solar-system `group.visible` is on from p >= 0.4 onward,
    because its Sun `PointLight` lights the probe. Hidden groups drop their
    lights.
  - Camera ownership is exclusive. FE-03 gets `setCameraControl(true)` only when
    (a) the scroll is in the overview hold and the camera has settled at p = 1.5,
    or (b) a planet is focused and global is in [1, 2] (the solar section's own
    range). If the user scrolls out of [1, 2] while focused, the flight calls
    `focus(null)` and takes the camera back. On every hand-back it blends over
    0.9 s from wherever FE-03 left the camera, including after a drag.
  - Reduced motion (read every frame): there is no continuous flight. The camera
    cuts to the nearest of `SHOTS` [0, 1.5, 2.08, 2.4, 2.7, 4] behind a black
    frame (`.flight-fade`, a fixed div placed after `#stage` and below
    `#content`): 0.18 s fade out, cut, then 0.3 s fade in. The probe's roll, bob
    and dish animation are frozen.
- **Probe section** (`src/scene/probe.ts`): `createProbe(opts?: { url?, section? }):
  ProbeSection`, which extends SectionModule with id `'probe'`, `setProgress(p01)`
  (drift along the path), `setCaptionProgress(p01)`, `loaded: Promise<boolean>`
  and `isActive()`. The GLB is loaded with `GLTFLoader(ctx.loadingManager)`. The
  group is named `"probe"`, holding `"probe-craft"`, whose -Z is aligned to
  `PROBE_DIRECTION`. The `dish` node slews and spins slowly. Metals get a
  per-material PMREM `RoomEnvironment` envMap. `scene.environment` is NOT set, so
  planets are unaffected. If the load fails, the error is logged and the page
  keeps working. Captions are `.probe-caption[data-show="from to"]` in
  `index.html`, faded by the probe section's C6 progress. They use opacity only,
  so screen readers still read them.
- **Outro** (`src/scene/outro.ts`): `createOutro()` with id `'outro'`, an empty
  group, and `setActive` toggling `#outro.is-active`. The credits are static HTML in
  `index.html`. `p.credit-line` must stay verbatim equal to the line suggested in
  `public/textures/CREDITS.md`, and a test enforces this.
- Dev only: `window.__flight` exposes the `Flight` (debug and smoke tests). It
  is not a contract.
