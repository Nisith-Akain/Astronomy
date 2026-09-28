# TASKS.md -- Astronomy 3D site

Project root: `C:\Users\Me\astronomy-site`
Stack: Vite + TypeScript (strict) + three.js, vitest for unit tests, static
hosting only (no runtime backend). Contracts live in `TEAM/INTERFACES.md`
(C1-C6); tickets reference them by id.

Status values: `todo` | `in progress` | `ready for QA` | `done` (QA passed)
| `COO-approved` | `needs rework`.
Owner tags: `[backend]` `[frontend]` `[embedded-cpp/math]` `[qa]`.

## Product scope (v1)

One long scrolling page over a single fixed WebGL canvas:
1. **Hero** -- procedural spiral galaxy / nebula with title overlay.
2. **Solar system** -- Sun + 8 planets, textured, placed by a real Kepler
   solver from JPL elements, time controls, click-to-focus info panel.
3. **Probe** -- custom Blender-modelled space probe (.glb) the camera flies
   alongside.
4. **Outro** -- pull back to the starfield, credits.
Scroll drives the camera between sections.

Out of scope for v1: moons, dwarf planets/Pluto, asteroid belt, sound,
backend API, CMS, i18n.

## Open questions for CTO (spec ambiguities -- not decided silently)

- **Q1 Scale.** True scale makes planets invisible. Default proposed:
  `sqrt` distance compression + exaggerated radii, with a UI toggle to
  "true distance" (radii still exaggerated). Needs CTO confirmation; affects
  MATH-02 and FE-03.
- **Q2 Time.** Proposed: simulation starts at the visitor's current date
  (real positions), with speed control. Alternative: start at J2000. Affects
  FE-03 only.
- **Q3 Textures.** Proposed source: Solar System Scope textures (CC BY 4.0,
  attribution required). If CTO prefers zero-attribution assets, BE-03 must
  generate procedural textures instead.
- **Q4 Language.** Brief said "plain JS/TS"; tickets assume TypeScript strict.
- **Q5 Browser/perf targets.** Proposed: latest Chrome/Firefox/Safari/Edge,
  60 fps on a mid-range desktop GPU, >= 30 fps on a recent mid-range phone.

**Resolution (COO, 2026-09-29, at CTO request "confirm or override"):**
- Q1 **Confirmed** (the CTO had already answered). Sqrt compression plus
  exaggerated radii, with a "True distance" toggle (linear, radii still
  exaggerated). Built as `DEFAULT_SCALE` / `TRUE_DISTANCE_SCALE` (C3).
- Q2 **Confirmed** (the CTO had already answered). The sim starts at the
  visitor's current date, with "Reset to now".
- Q3 **Confirmed:** Solar System Scope 2k textures, CC BY 4.0. This comes with
  a licence obligation: the attribution line in `public/textures/CREDITS.md`
  and the outro `p.credit-line` must ship, and a test enforces that they match.
  If the CTO wants zero-attribution assets, that is a new ticket, not a v1
  blocker.
- Q4 **Confirmed:** TypeScript strict (+ `noUncheckedIndexedAccess`).
- Q5 **Confirmed as the target**, but it is **not yet verified**. Desktop 60
  fps was only measured headless on an Intel UHD iGPU. Mobile fps, real touch
  hardware, Firefox and Safari were not measured. These remain QA-01
  obligations, and I am not treating them as met.

---

## Dependency graph

```
BE-01 ──┬─> FE-01 ──┬─> FE-02 ──────────────┐
        │           ├─> FE-03 <── BE-02      │
        │           │     ^  ^── BE-03       ├─> FE-04 ──> FE-05 ──> QA-01
        │           │     └──── MATH-02      │     ^
        ├─> MATH-01 ──> MATH-02              │     └── BE-04
        └─> (BE-02 types file)               │
BE-02, BE-03, BE-04, MATH-01 (pure logic) can start in parallel with BE-01.
```

Wave 1 (unblocked now): BE-01, BE-02, BE-03, BE-04, MATH-01
Wave 2: FE-01 (after BE-01), MATH-02 (after MATH-01)
Wave 3: FE-02, FE-03
Wave 4: FE-04 -> FE-05 -> QA-01

---

## BE-01 [backend] Project scaffold, build & dev config
**Status:** COO-approved (2026-09-29)

> **Backend summary (2026-09-24):** Vite 8.3.0 + TypeScript 7.0.2 (`strict`
> plus `noUncheckedIndexedAccess`) + three/@types/three pinned at 0.186.0,
> vitest 5.0.1. Layout per C1 with `.gitkeep` in empty dirs; `index.html` has
> `<canvas id="stage">` (fixed, full-viewport via `src/styles/main.css`) and
> the four C6 sections; `src/main.ts` only asserts the canvas exists (no scene
> logic). `vite.config.ts` has `base: './'` (built `dist/index.html` references
> `./assets/...`). `npm run build` = `tsc --noEmit && vite build`. Git repo
> initialised on `main`, initial commit `9607bb7` (BE-01 + BE-02 files only;
> `TEAM/` and other tickets' files left untracked for their owners). Details
> added to INTERFACES.md C1 "As built". Verified on a fresh `git clone`:
> `npm ci && npm run typecheck && npm test && npm run build` all green; dev
> server served the page, `/src/main.ts` and `/data/planets.json` (HTTP 200).
> **How to exercise:** `npm install && npm run dev`, open
> http://localhost:5173 (black page, canvas + 4 sections in DOM);
> `npm test` runs `tests/scaffold.test.ts`, which checks the canvas and the
> section order.
**Depends on:** none
**Publishes:** C1 (project layout)

Create the Vite + TypeScript project at `C:\Users\Me\astronomy-site`.

Acceptance criteria:
- [ ] `npm install && npm run dev` serves a page with a full-viewport
      `<canvas id="stage">` and four empty `<section data-section>` blocks
      (`hero`, `solar-system`, `probe`, `outro`) per C6.
- [ ] Scripts: `dev`, `build`, `preview`, `test` (vitest run), `typecheck`
      (`tsc --noEmit`). All succeed on a clean checkout.
- [ ] `tsconfig.json` has `"strict": true`; `three` and `@types/three` pinned.
- [ ] Folder layout exactly as C1; empty dirs kept with `.gitkeep`.
- [ ] `vite.config.ts` uses a relative `base` (`'./'`) so `dist/` works from
      any static host / subpath.
- [ ] `.gitignore` (node_modules, dist), `README.md` with run instructions.
- [ ] `git init` with an initial commit.
- [ ] No feature code (no scene logic) in this ticket.

## BE-02 [backend] Planet data JSON + TS types
**Status:** COO-approved (2026-09-29)

> **Backend summary (2026-09-24):** `public/data/planets.json`
> (`schemaVersion: 1`, `epoch: "J2000"`) holds the Sun and 8 planets. Elements
> and rates come from JPL Table 1 (1800-2050), with Earth taken from the EM Bary
> row. Radius, obliquity, sidereal rotation period and sidereal orbital period
> come from the NASA fact sheets, and Venus and Uranus have negative rotation
> periods. Only Saturn has a `ring` (74,658-136,775 km, `saturn_ring.png`).
> `source` cites both URLs. `src/types/planets.ts` copies C2 exactly.
> `tests/planets-data.test.ts` (11 tests) checks the C2 key set (no extra
> keys), 8 ids in order, every number finite, `0 <= e < 1` at T = -2, 0 and
> +0.5 centuries, texture paths matching C5, ring only on Saturn, and retrograde
> signs. It also cross-checks for transcription typos: the period derived from
> `LDot` must match the fact-sheet period within 1%, and Kepler's third law must
> hold within 2% (Table 1 is a fitted solution, so Neptune is off by 1.4%).
> Pass. **Note for FE-03:** tilt > 90 deg and a negative period both encode
> retrograde spin, so applying both cancels out. See the C2 "Data notes" in
> INTERFACES.md.
> **How to exercise:** `npx vitest run tests/planets-data.test.ts`; in the
> app, `fetch(import.meta.env.BASE_URL + 'data/planets.json')`.
**Depends on:** none to author the data; lands in the repo after BE-01.
**Publishes:** C2

Acceptance criteria:
- [ ] `public/data/planets.json` matches C2 exactly; `schemaVersion: 1`.
- [ ] Orbital elements + rates copied from JPL "Keplerian Elements for
      Approximate Positions of the Major Planets", Table 1 (1800-2050 AD);
      Earth uses the "EM Bary" row. `source` field cites the URL.
- [ ] Physical data (radius, tilt, rotation period, orbital period) from NASA
      planetary fact sheets; retrograde rotation encoded as negative.
- [ ] Saturn has a `ring` object; no other planet does (Uranus rings out of scope).
- [ ] `src/types/planets.ts` exports the C2 interfaces verbatim.
- [ ] A vitest test loads the JSON and asserts: 8 planets in order
      Mercury..Neptune, every numeric field finite, `0 <= e < 1`, every
      `texture` path listed matches the C5 naming.

## BE-03 [backend] Planet texture assets + credits
**Status:** COO-approved (2026-09-29). The saturn_ring.png 2048x125 radial strip is accepted as a C5 exception (see C5). QA notes follow: Q3 resolved: Solar System Scope 2k textures (CC BY 4.0), credited in `public/textures/CREDITS.md`. 9 JPGs at 2048x1024 + `saturn_ring.png` (2048x125 RGBA radial strip, the standard ring format, so not 2:1; QA confirms this exception, sign-off pending COO). Total 3.52 MiB, largest 733 KB (mars). sun/mercury re-encoded at q92 to fit under 800 KB; venus uses the atmosphere map. QA verified all 10 files with Pillow (sizes/dimensions) and confirmed every planets.json texture path resolves to a file on disk with no orphans.
**Depends on:** Q3
**Publishes:** C5 (textures part)

Acceptance criteria:
- [ ] `public/textures/planets/{sun,mercury,venus,earth,mars,jupiter,saturn,uranus,neptune}.jpg`
      + `saturn_ring.png` (with alpha) exist, 2:1 equirectangular,
      <= 2048x1024, each <= 800 KB.
- [ ] `public/textures/CREDITS.md` lists source, author, license, URL for
      every file.
- [ ] Filenames match the `texture` fields in planets.json (BE-02).
- [ ] Total texture payload <= 5 MB.

## BE-04 [backend] Blender probe model -> `public/models/probe.glb`
**Status:** COO-approved (2026-09-29). QA notes follow: (built by main session; subagents lacked Blender MCP access. 756 tris, 38 KB, `dish` node, source in assets-src/probe.blend). QA parsed the glTF directly: glTF 2.0, Y-up, forward -Z confirmed via world-space vertices, no cameras/lights, `dish` is a separate node, loads with 0 warnings/0 errors in three.js GLTFLoader (0.186). Screenshot evidence: `C:\Users\Me\AppData\Local\Temp\fe04-smoke\normal-6-probe-b.png` (D4: no screenshot path was recorded on this ticket originally; now added). Origin is at the bus centre, not the bounding-box centre -- consistent with C5 if the bus dominates the model's mass.
**Depends on:** none (use mcp__blender__* tools)
**Publishes:** C5 (model part)

Model an original deep-space probe (Voyager-style: bus, high-gain dish,
magnetometer boom, RTG boom). Original work only, no downloaded meshes
unless CC0 and credited.

Acceptance criteria:
- [ ] glTF 2.0 binary at `public/models/probe.glb`, <= 3 MB, <= 50k tris.
- [ ] Y-up, 1 unit = 1 m, origin at centre, forward = -Z, per C5.
- [ ] PBR metal/rough materials (gold foil bus, white dish, grey booms);
      no embedded lights/cameras.
- [ ] Dish is a separate node named `dish`.
- [ ] Loads without errors/warnings in https://gltf-viewer.donmccurdy.com
      or three.js `GLTFLoader` (attach a screenshot path in the ticket).
- [ ] Source `.blend` saved to `assets-src/probe.blend` (not in `public/`).

## MATH-01 [embedded-cpp/math] Time utilities + Kepler solver
**Status:** COO-approved (2026-09-29). The C3 "<=10 iterations" wording is corrected to "<= maxIter guaranteed; measured worst case 12". The Mars AC is corrected to 1.667 below. QA notes follow: D1: C3/ticket claim of "<=10 iterations" for all e<=0.99 is false (a 991x4001 grid found 70 cases up to 12 iterations); the actual AC (<= maxIter=50) still passes. COO should correct the "<=10" wording in INTERFACES.md C3 to "<=12", or accept as-is since the AC itself is unaffected. Mars bound corrected to [1.381,1.667] verified across 4 epochs (1800/2000/today/2050).
**Depends on:** C2 types (can inline the interface until BE-02 lands);
vitest from BE-01 (soft -- logic can be written first).
**Publishes:** C3 (`time.ts`, `kepler.ts`)

Implement in pure TypeScript (no three.js, no DOM) under `src/lib/orbit/`.

Acceptance criteria:
- [ ] `solveKepler`: Newton-Raphson with a robust starting guess
      (`E0 = M` for e < 0.8, `E0 = pi` otherwise); normalises M to
      [-pi, pi]; returns within `tol` in <= `maxIter` iterations for all
      `0 <= e <= 0.99`. Throws `RangeError` for e < 0, e >= 1, NaN/Infinity.
- [ ] `e = 0` returns `M` (normalised) exactly.
- [ ] Property test: for 10,000 random (M, e in [0, 0.99]) pairs,
      `|E - e sin E - M| < 1e-10`.
- [ ] `heliocentricPosition` follows the JPL Standish procedure (element
      propagation by T centuries, omega = varpi - Omega, M = L - varpi,
      solve Kepler, rotate to ecliptic). Degrees converted inside.
- [ ] Reference test: Earth (EM Bary elements) at JD 2451545.0 ->
      x ~= -0.1771, y ~= 0.9672, z ~= 0 AU, each within 0.005 AU.
- [ ] Reference test: Mars heliocentric distance stays within
      [1.381, 1.667] AU across one full orbit sampled daily.
      *(COO 2026-09-29: the bound was 1.666 in the original spec, but the true
      aphelion a(1+e) = 1.666016 AU, so the spec value was a rounding error.)*
- [ ] `dateToJulian(new Date(Date.UTC(2000,0,1,12)))` === 2451545.0;
      round-trips with `julianToDate` within 1 ms.
- [ ] 100% of exported functions covered by tests; `npm test` green.

**MATH-01 notes for QA:** Files: `src/lib/orbit/time.ts`,
`src/lib/orbit/kepler.ts`, `tests/orbit/time.test.ts`,
`tests/orbit/kepler.test.ts`. Test with `npx vitest run tests/orbit` (21 tests
green) and `npm run typecheck` (clean). Measured: Earth @ J2000 = (-0.17717,
0.96721, -2.6e-7) AU; Mars r over 687 daily samples in [1.38140, 1.66602]
AU; solver takes at most 10 iterations over a 100 x 801 (e, M) grid and the
worst residual is < 1e-12. Additive exports `solveKeplerDetailed` and
`elementsAt` are in C3; they need COO sign-off. **Spec
note:** the Mars aphelion is a(1+e) = 1.666016 AU, which is just above the
literal 1.666 bound. The test compares at the quoted 3-decimal precision
(+-5e-4) and also checks the extremes against a(1-+e) to 1e-3. Solver bug found
and fixed during testing: after convergence, a rounding-level Newton step could
fall onto the bracket edge and set off a bisection step that moved away from
the root. The converged check now runs before the bracket guard. No
toolchain assumptions beyond BE-01's vitest/tsc.

## MATH-02 [embedded-cpp/math] Orbit path sampling + scene scale mapping
**Status:** COO-approved (2026-09-29). The AC is corrected to reference the float64 `orbitPointAtE` core. D3 (displayRadius config validation) goes to follow-up MATH-03, and C3 now documents the current behaviour. QA notes follow: D2 (accepted): Float32Array orbitPath output is off from analytic radius by up to 1.3e-6 AU (Neptune); the 1e-9 AU criterion is met by the 64-bit orbitPointAtE core (1.8e-14 AU), not the stored Float32 array. COO should update the AC text to reference the 64-bit core. D3 (minor contract mismatch): C3 says displayRadius throws RangeError on auToUnits<=0 etc.; it does not validate and silently ignores bad scale config. COO should correct the doc or have this fixed in a follow-up.
**Depends on:** MATH-01; CTO answer to Q1 for `DEFAULT_SCALE` (answered:
sqrt + exaggerated radii, toggle to true distance with radii still exaggerated).
**Publishes:** C3 (`path.ts`, `scale.ts`)

Acceptance criteria:
- [ ] `orbitPath` samples by **eccentric anomaly** (uniform in E, not time)
      so perihelion is not under-sampled; returns `segments*3` floats. The
      float64 core `orbitPointAtE` (from which `orbitPath` is built) lies within
      1e-9 AU of the analytic ellipse radius. The stored Float32Array values equal
      `Math.fround` of those core points (relative error < 2e-7).
      *(COO 2026-09-29: the original text required 1e-9 AU of the Float32Array
      itself, which float32 cannot represent at 30 AU. The intent, an exact
      ellipse sampler, is met by the core.)*
- [ ] `toScene` applies distance mapping (`linear`/`log`/`sqrt`) to the
      radial distance only (direction preserved), then the Y-up swap
      `(x, z, -y)` from C3. Origin maps to origin. Monotonic in distance.
- [ ] `displayRadius` clamps to `minRadius`; Sun and Jupiter never visually
      overlap Mercury/inner orbits under `DEFAULT_SCALE` (test asserts
      `displayRadius(sun) < toScene(Mercury perihelion) distance * 0.5`).
- [ ] Planets keep correct ordering by distance under all three modes (test).
- [ ] No three.js import in `src/lib/orbit/**` (enforced by a test or lint rule).

**MATH-02 notes for QA:** Files: `src/lib/orbit/path.ts`,
`src/lib/orbit/scale.ts`, `tests/orbit/path.test.ts`,
`tests/orbit/scale.test.ts`. Test with `npx vitest run tests/orbit` (42
tests green, 4 files) and `npm run typecheck` (clean). Full `npm test` is 54/54
green. No toolchain assumptions beyond BE-01's vitest/tsc. The tests read
`public/data/planets.json` (BE-02) for real radii/elements.
- Q1 presets: `DEFAULT_SCALE` = sqrt, 50 u/sqrt(AU), and `TRUE_DISTANCE_SCALE`
  (additive) = linear, 9 u/AU, so Neptune sits at ~274 / ~271 u in both. Radii use
  `max(minRadius, radiusScale*sqrt(km/6371))`, so the Sun is ~10.4x Earth, not 109x.
  Sun/Mercury-perihelion ratio: 0.38 (default) and 0.45 (true distance), both
  under the 0.5 limit. Extra test: in both presets no sphere (Sun, Jupiter, all
  planets) reaches a neighbouring orbit band across 1800-2050.
- Ordering: tested on actual `heliocentricPosition`s every 100 days from 1900 to 2100
  under linear, log, and sqrt.
- **Spec note (1e-9 AU criterion):** a Float32Array cannot hold 1e-9 AU
  (float32 spacing at Neptune's 30 AU is ~2e-6 AU). The float64 core
  `orbitPointAtE` (additive export; `orbitPath` is built from it) is tested to
  1e-9 against a(1 - e cos E) and against the focal-sum property r + r' = 2a,
  for all 8 planets plus a synthetic e = 0.9 orbit at 3 epochs. The Float32
  output is tested to equal `Math.fround` of those points exactly, with
  |r - r_analytic| < 2e-7 * r. The public contract signature is unchanged.
- Sampling: uniform in E; point 0 is perihelion; no duplicated end point
  (use `LineLoop`). Tests check that the max/min chord ratio is <= 1/sqrt(1-e^2)
  and that uniform-time sampling at e = 0.9 would leave chords >3x longer at
  perihelion.
- Purity: a test scans `src/lib/orbit/**` for any `three` / `three/*`
  import or require. Packages such as `three-stdlib` are not matched.
- Additive C3 exports (need COO sign-off): `orbitPointAtE`, `EARTH_RADIUS_KM`,
  `TRUE_DISTANCE_SCALE`, `mapDistance`. The FE-03 usage notes (ring scaling,
  animating radius on toggle) are in INTERFACES.md C3.
- Mars bound fix: `tests/orbit/kepler.test.ts` now asserts the corrected
  criterion [1.381, 1.667] AU strictly (the old +-5e-4 tolerance is gone). The
  MATH-01 criterion text above still says 1.666; COO to update.

## FE-01 [frontend] Scene core, render loop, starfield
**Status:** COO-approved (2026-09-29). The THREE.Clock warning is accepted for v1; removing `clock` from C4 goes to follow-up FE-07.

> **Frontend summary (2026-09-24):** Added `src/scene/core.ts`, which
> implements C4 verbatim: `createSceneCore`, `SceneContext` and
> `SectionModule`. It creates one `WebGLRenderer` with sRGB output and ACES
> filmic tone mapping. DPR is capped at 2, and the drawing buffer is sized from
> the canvas CSS box on `resize` and via a `ResizeObserver`, so the image is
> never stretched. `dispose()` frees scene geometries, materials, textures and
> the renderer. The RAF loop lives in `src/scene/loop.ts`, which has no DOM
> code: one chain, `onTick` with unsubscribe, `dt` clamped to 0.1 s, and a
> pause while `document.hidden` that resumes without a time jump.
> `src/scene/starfield.ts` renders 8,000 points on a 5,000-unit sphere that
> follows the camera. Each star gets its own size (power law) and a colour from
> a 2,800-14,800 K black-body curve. Twinkle runs in the vertex shader and is
> off while `reducedMotion`. `src/main.ts` wires core + starfield and handles
> HMR dispose. Tests: `tests/scene/loop.test.ts` (6) and
> `tests/scene/starfield.test.ts` (4). Verified with `npm run typecheck`,
> `npm test` (64/64) and `npm run build`, all green. Headless Chrome
> (SwiftShader) against the dev server at 1280x800 and 900x600 rendered the
> starfield with no console errors. **Known:** the only console output is
> three's `THREE.Clock: This module has been deprecated` warning, because C4
> mandates `clock: THREE.Clock`. A switch to `THREE.Timer` is proposed in
> INTERFACES.md C4 "As built" and needs COO approval. The build also prints
> Vite's >500 kB chunk notice (three is 133 kB gzipped, within the FE-05
> budget).
> **How to exercise:** `npm run dev` and open the page: you should see a
> twinkling starfield. Resize the window or zoom: no stretching. Turn on OS
> "reduce motion": the twinkle stops. Switch tabs: the loop pauses (in the
> DevTools Performance panel there are no frames while hidden).
> `npx vitest run tests/scene`.
**Depends on:** BE-01
**Publishes:** C4

Acceptance criteria:
- [ ] `createSceneCore` implements C4 exactly: one renderer, one RAF loop,
      `onTick` subscription with unsubscribe, `dispose` frees GPU resources.
- [ ] DPR capped at 2; canvas resizes correctly (no stretch) on window resize.
- [ ] sRGB output colour space and ACES filmic tone mapping configured once here.
- [ ] Background starfield: >= 5,000 points on a large sphere, per-star size
      and colour temperature variation, subtle twinkle in a shader;
      twinkle disabled when `reducedMotion`.
- [ ] `SectionModule` interface exported for other sections to implement.
- [ ] Loop pauses when `document.hidden`.
- [ ] No console errors; `npm run typecheck` green.

## FE-02 [frontend] Galaxy / nebula hero
**Status:** COO-approved (2026-09-29). The 60 fps AC is accepted on iGPU evidence, since an iGPU is below the Q5 target hardware, so the discrete-GPU case should only be easier. QA-01 still owns real-browser fps. QA notes follow: 60fps confirmed only on an Intel UHD iGPU (accepted known item, not re-measured on discrete GPU); text-contrast numbers not re-measured this pass (previously measured 13.9-16 vs required 3-4.5).

> **Frontend summary (2026-09-24):** New `src/scene/hero.ts`
> (`createHero()` -> `SectionModule` id `hero`, contract in INTERFACES.md C4
> "As built by FE-02"), `src/styles/hero.css`, and `tests/scene/hero.test.ts`
> (11 tests). Also the hero markup in `index.html` (`section#hero` only) and 2
> lines in `src/main.ts` (import plus `void createHero().init(ctx);`). The
> galaxy has 60,000 particles laid out once on the CPU: 4 arms by default,
> configurable via `arms`, a warm core fading to a blue edge, sparse HII knots,
> and additive blending. Rotation (rigid pattern plus a bounded wobble) runs in
> the vertex shader from one time uniform; the unit test checks that buffer
> versions never change across ticks. Behind the galaxy is an fbm
> domain-warped nebula quad with a radial fade. The galaxy sits at z = -3000,
> clear of the solar system. `setActive(false)` unsubscribes the tick and hides
> the group. Time accumulates only from onTick `dt` while active and not
> `reducedMotion`, so motion freezes under reduced motion and nothing jumps on
> resume. `ctx.clock` is never used. **Evidence:** typecheck green;
> `npm test` 83/83 (whole suite, including FE-03's); `npm run build` green
> (only Vite's existing >500 kB chunk notice, 141 kB gzip). Headless Edge ran
> on a real GPU (ANGLE D3D11, **Intel UHD integrated**, below the Q5
> mid-range target) against the dev server with FE-03 also loaded. rAF held
> 60.0-60.3 fps at 1280x800, 1440x900, 1920x1080 and 390x844. Frames animate
> normally and are pixel-identical under emulated `prefers-reduced-motion`.
> Contrast was measured on screenshots with the glyphs hidden, using the
> **brightest single background pixel** under each text content box. Worst
> ratios across all runs after the final CSS (4 sizes, 7 runs): h1 >= 14.7, subtitle >= 13.9,
> scroll cue >= 16.0 (AA needs 3 / 4.5 / 4.5). An earlier elliptical scrim
> dipped to 4.35 on the subtitle, so it was replaced by a uniform panel. Console: only FE-01's known
> `THREE.Clock` deprecation warning, plus a 404 for `/favicon.ico` (not an
> FE-02 asset; BE-01 may want a favicon). **Caveats:** the ">= 60 fps on target
> desktop" reading comes from an iGPU in headless mode, not a mid-range
> discrete GPU. About 1 in 4 headless runs stalled at the rAF sampling step
> (headless frame throttling, with no page errors); retries passed. With the
> interim wiring nothing deactivates the hero when you scroll away. That is
> FE-04's job (see C4 notes), which should also pass `claimCamera: false`.
> **How to exercise:** `npm run dev` and open the page. You should see the
> title and subtitle over a slowly rotating spiral galaxy with a purple/blue
> nebula behind it. Turn on OS "reduce motion": everything freezes.
> `npx vitest run tests/scene/hero.test.ts` covers `setActive`, reduced
> motion, the no-buffer-update rule, arm count and the colour gradient.
**Depends on:** FE-01 (C4)

Acceptance criteria:
- [ ] `SectionModule` with id `hero`.
- [ ] Procedural spiral galaxy: >= 50,000 particles, configurable arm count,
      core-to-edge colour gradient, additive blending, slow rotation in a
      vertex shader (no per-frame CPU buffer updates).
- [ ] Soft nebula layer (noise shader or sprite billboards) behind the galaxy.
- [ ] Title + subtitle HTML overlay in the `hero` section, readable
      (WCAG AA contrast) over the animation.
- [ ] `setActive(false)` stops its per-frame work.
- [ ] Holds 60 fps on target desktop (Q5) with this section alone.

## FE-03 [frontend] Interactive solar system
**Status:** COO-approved (2026-09-29). Dead `mountSolarSystem` and the overview-constant export go to follow-up FE-07.

> **Frontend summary (2026-09-24):** New files: `src/scene/solarSystem.ts`
> (SectionModule `solar-system`, plus the extra API in INTERFACES.md C4 "As
> built by FE-03"), `src/scene/solarSystemMath.ts` (pure helpers),
> `src/ui/solarSystemUi.ts`, `src/styles/solar-system.css` and
> `tests/scene/solarSystem.test.ts` (9 tests). `src/main.ts` got one line:
> a dynamic import of `mountSolarSystem(ctx)`.
> - **Data and orbits.** C2 is fetched at runtime. Each body's position is
>   `toScene(heliocentricPosition(el, jd))`. Orbits are `orbitPath` ->
>   `toScene` -> `LineLoop`, rebuilt every 2 simulated years.
> - **Bodies.** The Sun is an unlit textured sphere with an additive sprite
>   halo and a PointLight. The 8 planets are MeshStandard spheres with C5
>   textures. If a texture fails to load, the planet falls back to its C2
>   `color` and logs a warning; nothing crashes. Each planet is tilted by
>   `axialTiltDeg` and spins by `|rotationPeriodHours|`.
> - **Saturn's ring.** The ring UVs are remapped by radius, u = (r - inner) /
>   (outer - inner), and the ring is sized with the C3 ring rule.
> - **Scale toggle.** Sqrt is the default, with a "True distance" option.
>   Switching animates each position (lerping along the same ray) and each
>   radius, orbit lines included, over 1.6 s.
> - **Time.** The clock starts at `dateToJulian(new Date())` and advances only
>   from the `onTick` dt. Controls: play/pause, a log speed slider
>   (1 day/s .. 1 year/s), a UTC date display and "Reset to now".
> - **Interaction.** Hovering highlights the planet's emissive glow, marker and
>   orbit, and shows a floating label. Clicking or picking from the list flies
>   the camera to the body and locks onto it, even while it moves, and opens an
>   info panel with `name`, `facts` and the live distance. Esc or Close returns
>   to the overview and gives focus back to the list button. Dragging orbits
>   the view.
> - **Reduced motion.** With `reducedMotion`, the sim starts paused, and camera
>   moves and scale changes are instant cuts.
> - **Verified.** `npm run typecheck`, `npm test` (83/83) and `npm run build`
>   all pass. Headless Edge (SwiftShader, 1280x800) passed three runs with no
>   console errors: normal, all textures failing (fallback colours), and
>   `prefers-reduced-motion`. The normal run covered hover label, pointer
>   cursor, real mouse click-to-focus, list focus, Esc, the scale toggle
>   mid-animation and at the end, the speed slider and reset to now. The only
>   warning is the known THREE.Clock deprecation from FE-01.
>
> **Deviations and notes for QA/COO:**
> 1. Displayed spin is capped at 2 rev/s real time so fast sim speeds don't
>    alias. Below the cap, spin is exact.
> 2. The sim date is clamped to 1000-3000 AD, and the UI flags dates outside
>    1800-2050 as approximate.
> 3. Poles are tilted about a fixed scene axis, because C2 has no pole
>    direction data. The Sun has no tilt field, so it is untilted.
> 4. In the overview, planets are only a few pixels wide under the Q1 radii. A
>    5 px screen-space marker plus a 10 px pick tolerance keeps them visible
>    and clickable.
> 5. Until FE-04, an IntersectionObserver activates the section when at least
>    50% of it is visible. Once taken, the camera is not handed back to the
>    hero; FE-04 owns that.
> 6. The 60 fps target was not measured (headless SwiftShader only).
>
> **How to exercise:** `npm run dev`, then scroll to the second section. The
> camera flies in and planets move at 10 days/s. Hover a planet to see its
> label, click it to focus, and press Esc to return. Tab through the body list:
> each item previews its planet, and Enter focuses it. Try the speed slider,
> Pause, "Reset to now" (the date returns to today) and "True distance"
> (animates). To test fallbacks, block `textures/planets/*` in DevTools (flat
> colours, no crash), or turn on OS reduce-motion (starts paused, cuts instead
> of flights). Unit tests: `npx vitest run tests/scene/solarSystem.test.ts`.
**Depends on:** FE-01 (C4), BE-02 (C2), BE-03 (C5 textures; may use
`color` fallback until then), MATH-01 + MATH-02 (C3). Q1 and Q2 answers.

Acceptance criteria:
- [ ] `SectionModule` with id `solar-system`; loads data via C2 fetch path.
- [ ] Sun (emissive, glow/bloom or sprite halo) + 8 textured planets;
      Saturn ring with alpha texture; axial tilt and self-rotation applied
      (retrograde honoured).
- [ ] Positions come **only** from `heliocentricPosition` + `toScene`; no
      hand-placed coordinates. Orbit lines from `orbitPath`.
- [ ] Time controls: play/pause, speed (1 day/s .. 1 year/s, log slider),
      current simulated date display, "reset to now".
- [ ] Hover highlights planet + label; click focuses camera smoothly on the
      planet and opens an info panel with `name` + `facts`; Esc / close
      button returns to overview.
- [ ] Scale toggle per Q1 animates between modes without popping.
- [ ] Texture load failure falls back to `color`, no crash.
- [ ] Keyboard accessible: planets focusable via a list in the info UI.

## FE-04 [frontend] Scroll-driven camera fly-through + probe section
**Status:** COO-approved (2026-09-29). Ships as-is. D1 (whip-pan) and D2 (first-activation hitch) go to follow-up FE-06. QA notes follow: D1 (low): fast scroll through the probe close-ups whip-pans the view direction (up to ~18.7deg/frame, ~1100deg/s) around p 2.1-2.9 even though position stays continuous; may break the spirit of "no jump on fast scroll". Repro in QA scratch `my\b_flow.json` (`recHome.bigTurns`). D2 (low, perf): one-off 266ms frame hitch on first hero->solar activation (likely first-use shader/texture upload), which moves the camera 500u in that one frame due to the dt clamp. Repro: fresh load, wheel down 8x100px (`recHeroToSolar.maxFrameDt`). Neither blocks; COO to decide if a follow-up ticket is warranted.

> **Frontend summary (2026-09-24):**
> - **New files:** `src/scene/scroll.ts` (C6 `onSectionProgress`, plus
>   `getScrollSnapshot`) and the pure `src/scene/scrollMath.ts`. `src/scene/flightPath.ts`
>   holds the keyframes and CatmullRom path. `src/scene/flight.ts` is the
>   orchestrator. `src/scene/probe.ts` and `src/scene/outro.ts` are the new
>   SectionModules. Styles are in `src/styles/{flight,probe,outro}.css`, and the
>   tests (22) are in `tests/scene/flight.test.ts`.
> - **Changed files:** the probe and outro markup in `index.html` (hero and
>   solar-system markup untouched), and `src/main.ts`. The two ad-hoc
>   registrations in `main.ts` are replaced by a single `createFlight(ctx)`.
>   It builds the hero with `claimCamera: false` and the solar system with
>   `createSolarSystem()` plus `setCameraControl(false)`, and it activates only
>   the sections near the camera. The hero is hidden and unsubscribed once
>   scrolled past (p >= 1.3).
> - **Camera flight:** the camera pulls back from the galaxy, passes over the
>   Sun into FE-03's exact overview pose, then flies out past Neptune alongside
>   the drifting `probe.glb`. The GLB is loaded via `GLTFLoader` and the shared
>   `loadingManager`, and its `dish` node slews and spins. Three captions fade by
>   section progress. The outro pulls back until the probe is a speck on the
>   starfield, with credits that include the CREDITS.md line verbatim.
> - **Damping:** exponential, capped at 1.5 path units/s. A reload mid-page
>   snaps to the restored position.
> - **Camera ownership:** FE-03 gets the camera only once the camera has settled
>   at the overview, or while a planet is focused and the solar section is on
>   screen. Scrolling out of that range unfocuses the planet and blends the
>   camera back.
> - **Reduced motion:** cuts between 6 shots behind a short black fade.
> - **Evidence:**
>   - `npm run typecheck` is clean. `npm test` passes 105/105. `npm run build`
>     is green, with 172.7 kB gzip JS and only Vite's existing >500 kB chunk
>     notice.
>   - I ran a headless Chrome smoke test (ANGLE D3D11, 1280x800) against the dev
>     server, in normal and `prefers-reduced-motion` modes. It scrolled hero ->
>     mid-flight -> solar overview (camera handed to FE-03) -> Mars focused from
>     the list -> scrolled within the section (focus and camera held) -> 3 probe
>     positions (each caption at opacity 1, the others 0) -> pull-back -> outro.
>     It then jumped to the top (the camera was still at p = 3.75 150 ms later,
>     so no teleport) and reloaded mid-probe (camera snapped: pCam == pTarget).
>   - Screenshots: `C:\Users\Me\AppData\Local\Temp\fe04-smoke\{normal,reduced}-*.png`.
>     Per-step state: `...\fe04-smoke\results.json`.
>   - Console showed only the known `THREE.Clock` deprecation and a
>     `/favicon.ico` 404.
> - **Not verified / caveats:**
>   - fps was not measured.
>   - Real trackpad inertia and touch scrolling were not tested. The smoke test
>     used stepped `scrollTo`; unit tests cover jitter damping.
>   - The overview pose duplicates FE-03's private constants (see C6 notes).
>   - The probe is lit only by FE-03's Sun light plus a local envMap. If the
>     solar-system fails to load, the probe renders darker.
> **How to exercise:** `npm run dev` and scroll slowly from top to bottom:
> galaxy, pull-back, Sun overview (stop here: drag, hover, click a planet, press
> Esc; all FE-03 interaction works), probe fly-by with 3 captions, pull-back,
> credits. Click a planet and then scroll: the camera stays on the planet while
> the section is on screen, then unfocuses and flies on. Press End or Home: the
> camera flies (no jump). Reload mid-page: no fly-in. Turn on OS "reduce
> motion": the camera cuts with black fades and the probe is static.
> `npx vitest run tests/scene/flight.test.ts`.
**Depends on:** FE-01, FE-02, FE-03, BE-04 (C5 model)
**Publishes:** C6

Acceptance criteria:
- [ ] C6 implemented: `onSectionProgress` emits (id, 0..1) per section.
- [ ] Camera path: CatmullRom spline(s) through keyframes per section;
      scroll position maps to spline parameter with damping (no jitter on
      trackpads, no jump on fast scroll or on reload mid-page).
- [ ] `probe` section: loads `probe.glb` via `GLTFLoader` through the shared
      `loadingManager`; probe drifts on a path, `dish` node slowly rotates;
      camera flies alongside it; 2-3 text captions fade in by progress.
- [ ] `outro`: camera pulls back to the starfield; credits (incl.
      CREDITS.md content) shown in HTML.
- [ ] Only the active section(s) have `setActive(true)`.
- [ ] Solar-system interaction (FE-03) still works when the user stops
      scrolling in that section; scroll does not fight a focused planet.
- [ ] `prefers-reduced-motion`: camera cuts/fades between keyframes instead
      of continuous flight.

## FE-05 [frontend] Loading screen, responsiveness, performance pass
**Status:** COO-approved (2026-09-29). D3 (track invisible on first paint) is dev-server only. The production build links the CSS render-blocking in `<head>`, so it does not reproduce there. It goes to follow-up FE-07. QA notes follow: D3 (cosmetic): the progress-bar track is invisible on first paint because the inline critical CSS in index.html doesn't style it before loading.css arrives (only the label text and "0%" show). Heap growth re-measured at +8.8% over a longer 5.1min/37-cycle soak (limit 10%, thinner margin than FE-05's own +4.7% figure) -- still passes but worth watching if content grows. Not verified: real touch hardware, mobile fps, Firefox/Safari.

> **Frontend summary (2026-09-29):** New files are `src/ui/loadingScreen.ts`,
> `src/styles/loading.css`, `src/scene/quality.ts`, `src/styles/responsive.css`,
> `public/favicon.svg` and `tests/scene/fe05.test.ts` (7 tests). Surgical edits:
> `index.html` (favicon link, inline critical loading CSS, `#loading` markup,
> noscript note), `src/main.ts`, `core.ts` (DPR cap via `pixelRatioFor`, one
> line), `flight.ts` (optional `FlightOptions.hero`), and `solarSystem.ts` (24 px
> touch pick radius, 3 lines). **Loading screen:** static markup paints before JS.
> It is bound to the shared `loadingManager` (wrapping its callbacks), with a
> monotonic bar held to 20 % until every section's init has queued its assets,
> and it fades out once `flight.ready` has settled and the manager is idle (20 s
> cap). **No WebGL2:** an error panel (`role=alert`, focused "Continue to the text
> version" button) replaces the loader, and the page text stays readable.
> **Mobile (<= 768 px):** DPR cap 1.5, 5,000 stars (FE-01 minimum kept) and 24,000
> galaxy particles (desktop is unchanged at 60,000). Taps get a 24 px pick radius,
> the solar section uses `touch-action: pan-y`, and the solar info panel now docks
> under the body list, because at 390 px FE-03's `bottom: 150px` covered the
> Pause button. **Evidence** (headless Edge, ANGLE D3D11 on Intel UHD; screenshots,
> JSON and scripts in `C:\Users\Me\AppData\Local\Temp\fe05-smoke\`):
> typecheck clean, `npm test` 112/112, `npm run build` green.
> - JS: 174 kB gzip (limit 900 kB).
> - First-load transfer: 3.91 MB (limit 10 MB), all 16 requests 200, favicon
>   included.
> - Desktop 1280x800 and 390x844 (DPR 3 emulated -> renderer DPR 1.5, buffer
>   585x1266): scrollWidth == clientWidth in every section and with a planet
>   focused. No off-screen elements.
> - A touch tap 14 px from Jupiter's centre focused Jupiter and opened the info
>   panel.
> - The `--disable-3d-apis` run showed the error panel with no console output.
> - 5-minute soak on the `vite preview` build (15 top-bottom-top scroll cycles):
>   JS heap after forced GC went from 6.14 to 6.43 MB (+4.7 %, limit 10 %). DOM
>   nodes (246) and listeners (74) did not change.
> - Lighthouse 12.8 desktop preset: Accessibility 100, Best Practices 100
>   (Performance 75, TBT 610 ms, not an AC).
>
> The only console output is warnings that were already there: `THREE.Clock`
> deprecation (C4) and a D3D-only `THREE.WebGLProgram` X4122 shader-precision
> warning.
> **Not verified / caveats:** no real phone or real touch hardware. Touch was
> emulated with CDP, and mobile fps was not measured. The heap figure comes from
> `Runtime.getHeapUsage` after forced GC in headless Edge, not a Chrome DevTools
> heap-snapshot file, and GPU memory was not tracked. Lighthouse ran on headless
> Edge. Vite's ">500 kB chunk" notice remains (it is in `vite.config.ts`, BE-01's
> file, and was left alone). In no-WebGL mode the solar-system section is an empty
> 100vh block. Harness note for QA: headless Edge marks the page `hidden` after
> about 5 s, so the loop pauses by design. Use `Emulation.setFocusEmulationEnabled`
> plus `Page.bringToFront`, which likely explains FE-02's "1 in 4 stalls".
> **How to exercise:** run `npm run dev`. With DevTools throttling set to "Slow
> 4G", the loader fills up and then fades. Emulate an iPhone 12 (390x844): no
> horizontal scroll; `__ctx.renderer.getPixelRatio()` returns 1.5; tap a planet
> to focus it and swipe sideways to orbit. Start Chrome with
> `--disable-3d-apis` to see the error panel. Unit tests:
> `npx vitest run tests/scene/fe05.test.ts`.
**Depends on:** FE-04

Acceptance criteria:
- [ ] Loading screen bound to `loadingManager` progress; fades out on load;
      shows an error message (not a blank page) if WebGL is unavailable.
- [ ] Mobile (<= 768 px): reduced particle counts, DPR cap 1.5, touch
      works for planet selection; layout has no horizontal scroll.
- [ ] Production build: JS bundle <= 900 KB gzipped (three included),
      total first-load transfer <= 10 MB.
- [ ] No memory growth across 5 minutes of scrolling up/down (Chrome heap
      snapshot before/after within 10%).
- [ ] Lighthouse (desktop) Accessibility >= 90, Best Practices >= 90.

## QA-01 [qa] End-to-end verification
**Status:** todo
**Depends on:** all tickets above reaching `ready for QA`. QA may verify
tickets individually as each hits `ready for QA`; this ticket is the final
full-site pass.

Acceptance criteria:
- [ ] `npm ci && npm run typecheck && npm test && npm run build` green on a
      clean clone.
- [ ] Every acceptance checkbox above verified and ticked with evidence
      (command output, screenshot path, or fps reading).
- [ ] Browser matrix from Q5 smoke-tested; results table appended here.
- [ ] Spot-check planet positions for today's date against JPL Horizons
      (heliocentric ecliptic) for Earth, Mars, Jupiter: angular error < 1 deg.
- [ ] Defects filed as new tickets `BUG-nn` in this file with repro steps.

---

## Follow-up tickets (post-v1, filed by COO 2026-09-29; none block v1)

## MATH-03 [embedded-cpp/math] `displayRadius` config validation (QA MATH-02 D3)
**Status:** todo
**Depends on:** none. **Changes:** C3 (behaviour note only; no signature change).
No caller is affected today: FE-03 only passes the frozen presets.

Acceptance criteria:
- [ ] `displayRadius` throws `RangeError` if `cfg.radiusScale` or
      `cfg.minRadius` is non-finite or negative. It must NOT reject configs on
      `auToUnits`/`distance`, which it does not use. Do not reuse
      `assertConfig` as-is.
- [ ] Tests cover each rejected field plus both presets still passing.
- [ ] Update the C3 behaviour note (remove the **[follow-up: MATH-03]** caveat).

## FE-06 [frontend] Flight polish: fast-scroll look-direction, first-activation hitch (QA FE-04 D1, D2)
**Status:** todo
**Depends on:** none (C6 unchanged). Touches `src/scene/flight.ts`,
`flightPath.ts`, and possibly `solarSystem.ts` (FE-03 area: coordinate).

Acceptance criteria:
- [ ] **D1:** in the probe close-ups (p 2.1-2.9), fast scroll/End key must
      not turn the view direction faster than a named constant cap (suggested
      <= 180 deg/s, i.e. ~3 deg/frame at 60 fps). Damp or rate-limit the look
      target separately from the position. Re-run QA's `recHome.bigTurns`
      repro: max per-frame turn <= the cap. Slow-scroll framing and keyframe
      poses (`poseAt` exact at each station) must be unchanged.
- [ ] **D2:** pre-warm the solar-system section before it first becomes visible.
      After `init` resolves and textures load, call
      `renderer.compileAsync(scene, camera)` (or `initTexture` per texture),
      or make the group visible off-screen for one frame. Repro (fresh load,
      8 x 100 px wheel): no frame > 50 ms on the QA harness.
- [ ] A single long frame must not move the camera more than the damping cap
      permits for a normal frame. Consider clamping the flight's own `dt`
      tighter than the core's 0.1 s.
- [ ] Reduced-motion behaviour unchanged; `npm test` green.

## FE-07 [frontend] Cleanup / contract tidy (COO code review findings)
**Status:** todo
**Depends on:** none. **Changes:** C4 v1.1 (drops `clock`, removes
`mountSolarSystem`); C6 note on overview constants.

Acceptance criteria:
- [ ] Remove `clock` from `SceneContext`. `core.ts` drives the loop from a
      private `THREE.Timer` or `performance.now()`. No `THREE.Clock` warning
      in the console. Update C4.
- [ ] Delete dead `mountSolarSystem` (plus its IntersectionObserver
      monkey-patch of `dispose`) from `solarSystem.ts` and C4.
- [ ] FE-03 exports its overview pose (`OVERVIEW_TARGET/DISTANCE/ELEVATION`),
      and `flightPath.ts` imports it instead of duplicating literals. The test
      compares against the import, not against literals.
- [ ] `loadingScreen.ts`: the `idle()` 100 ms poll keeps running forever after
      the 20 s timeout wins if an item never finishes. Stop polling once
      `track()` has settled. Clear the timeout timer when `settled` wins.
- [ ] Loading bar track visible on first paint in dev too (QA FE-05 D3). Add
      the `.loading-bar` track rule to the inline critical CSS in `index.html`.
- [ ] Minor per-frame allocations: `flight.ts` `applyPose` allocates a
      `Vector3` per frame while blending (use a scratch vector).
      `getScrollSnapshot()` clones `progress` every frame; the flight only
      needs `global`.
- [ ] `probe.ts`: guard `data-show` parsing against NaN (fall back to 0/1
      and warn).

## BE-05 [backend] Build hygiene
**Status:** todo
**Depends on:** none.

Acceptance criteria:
- [ ] `vite.config.ts` `build.sourcemap`: switch to `'hidden'` (or off) so
      `dist/` does not advertise a 3.2 MB source map with full sources to the
      public. **CTO to confirm the preference** (debuggability vs. exposure);
      this is not decided here.
- [ ] Silence or address Vite's >500 kB chunk notice: either set
      `chunkSizeWarningLimit` with a comment citing the FE-05 900 kB-gzip
      budget, or split `three` into its own chunk.
- [ ] Remove the stale `.gitkeep` files from directories that now have content
      (`public/models`, `public/textures/planets`, `src/lib/orbit`,
      `src/scene`, `src/ui`).

---

## Review log
(COO notes per ticket go here after QA returns them.)

### 2026-09-29 -- COO final v1 review

**Verification I ran myself (not taken from QA):** `npm run typecheck`
clean. `npm test` 112/112 (12 files). `npm run build` green: JS 174.0 kB gzip,
CSS 2.35 kB gzip. The only notice is Vite's >500 kB chunk warning. Inspected
`dist/index.html`: the CSS `<link>` is in `<head>`, so it blocks render.

**Files I read line by line:** `src/main.ts`, `src/lib/orbit/{kepler,path,scale}.ts`,
`src/scene/{core,flight,probe,scroll,solarSystem}.ts`, `src/scene/hero.ts`
(lifecycle half), `src/ui/loadingScreen.ts`, `src/ui/solarSystemUi.ts`
(state/DOM half), `index.html` diff, `vite.config.ts`.

**Overall code quality: good.** Patterns are consistent across sections:
idempotent `setActive`/`dispose`, `onTick` subscribe/unsubscribe, time taken
only from `dt`, `reducedMotion` read per frame, a `disposed` guard after every
`await`, and texture/model failures logged with a fallback rather than thrown.
Every section keeps the C4 rule (one renderer, one RAF loop). No `three`
import appears in `src/lib/orbit/**`. DOM writes in hot paths are diffed
(`setDate`, `setLabel`, `setInfoDetail`).

Findings QA's functional testing would not catch. None are correctness
bugs visible to users, so all go to follow-ups:
1. `mountSolarSystem` is dead code since FE-04, and it monkey-patches
   `dispose`. -> FE-07.
2. The FE-03 overview pose is duplicated as literals in `flightPath.ts`. The
   test checks the literals, so drift would pass CI. -> FE-07.
3. `loadingScreen.track`: the `idle()` poll never stops if the timeout wins
   with a hung item (10 Hz timer for the page lifetime). -> FE-07.
4. Small per-frame allocations (`flight.applyPose` blend, `getScrollSnapshot`
   clone). They are negligible today, and QA's +8.8 % heap soak measures
   retained memory, not churn. -> FE-07.
5. `displayRadius` has no config validation (QA D3). -> MATH-03.
6. `build.sourcemap: true` ships full sources in the map to any static host.
   It is not a first-load cost, but it is an exposure decision. -> BE-05
   (needs CTO preference).

**Per-ticket decisions:**
- **BE-01, BE-02:** COO-approved. Committed previously (9607bb7).
- **BE-03:** COO-approved. The ring strip is accepted as a C5 exception. CC BY
  attribution is present both in CREDITS.md and in the outro (test-enforced).
- **BE-04:** COO-approved. The origin at the bus centre is consistent with C5
  "centre of mass" (the bus dominates the mass).
- **MATH-01:** COO-approved. The "<=10 iterations" claim was false (worst case
  is 12). C3 now states the actual guarantee (<= maxIter) and the measured
  worst case. The Mars AC is corrected to 1.667.
- **MATH-02:** COO-approved. The AC is rewritten to reference the float64
  `orbitPointAtE` core. D3 is fixed in a follow-up rather than now, because no
  current caller can pass an invalid config (only frozen presets are used). C3
  now documents what the code actually does. The additive exports
  (`solveKeplerDetailed`, `elementsAt`, `orbitPointAtE`, `EARTH_RADIUS_KM`,
  `TRUE_DISTANCE_SCALE`, `mapDistance`) are approved into C3.
- **FE-01:** COO-approved. The THREE.Clock warning is accepted for v1. The
  proposal is approved in the "drop the field" form, not the "rename to timer"
  form, because no section needs it (FE-07).
- **FE-02:** COO-approved (see the fps caveat in the status line).
- **FE-03:** COO-approved. The additive API (`createSolarSystem`,
  `setCameraControl`, `onFocusChange`, etc.) is approved into C4. The spin
  cap, date clamp, fixed pole axis and pixel markers are sensible,
  documented deviations.
- **FE-04:** COO-approved. The C6 additions are approved. Whip-pan (D1, low)
  and the one-off 266 ms hitch (D2, low) go to FE-06. Neither is severe
  enough to block v1. Position stays continuous, the pan only occurs on
  deliberately fast scroll, and the hitch happens once per page load.
- **FE-05:** COO-approved. The additions are approved into C4. D3 is dev-only
  (it does not reproduce in the production build) and goes to FE-07. Heap
  growth of +8.8 % against the 10 % limit passes, but the margin is thin. If
  content grows, QA should re-soak.

**Release gate:** QA-01 (end-to-end pass) is still `todo`. Its browser
matrix (Firefox/Safari), real-device mobile fps and touch testing, and the JPL
Horizons < 1 deg spot-check have not been done by anyone. Per-ticket approval
does NOT waive QA-01. Shipping before QA-01 completes is a CTO call.
