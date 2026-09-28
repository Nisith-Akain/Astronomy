// FE-04: pure scroll -> progress -> camera-path maths (no DOM, no three.js).
//
// Coordinates: everything is measured at the VIEWPORT CENTRE line in document
// pixels, c = scrollY + viewportHeight / 2. Section i "owns" the scroll range
// [start_i, end_i) where start_i = top_i and end_i = top_{i+1}; the first range
// starts at the smallest reachable c (vh/2) and the last ends at the largest
// (docHeight - vh/2). Ranges are contiguous, so exactly one section is current.
//
//   progress_i = clamp01((c - start_i) / (end_i - start_i))
//   global     = i + progress_i  for the current section, in [0, sectionCount]
//
// With 100vh hero/solar/outro sections this puts the natural "rest" views at
// hero progress 0 (page top), solar-system progress 0.5 (section filling the
// viewport) and outro progress 1 (page bottom).

export const SECTION_IDS = ['hero', 'solar-system', 'probe', 'outro'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export interface SectionBox {
  id: SectionId;
  /** Document-space top in CSS px. */
  top: number;
  /** CSS px. */
  height: number;
}

export interface SectionRange {
  id: SectionId;
  start: number;
  end: number;
}

export const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** Contiguous per-section ranges on the viewport-centre axis (see file header). */
export function computeRanges(boxes: readonly SectionBox[], viewportH: number, docH: number): SectionRange[] {
  const minC = viewportH / 2;
  const maxC = Math.max(minC, docH - viewportH / 2);
  const out: SectionRange[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    const next = boxes[i + 1];
    let start = i === 0 ? minC : Math.min(Math.max(b.top, minC), maxC);
    let end = next ? Math.min(Math.max(next.top, minC), maxC) : maxC;
    const prev = out[i - 1];
    if (prev) start = prev.end; // keep contiguous even if the DOM overlaps
    if (end < start) end = start;
    out.push({ id: b.id, start, end });
  }
  return out;
}

/** 0..1 progress of `range` for viewport-centre `c`. Empty ranges step 0 -> 1. */
export function rangeProgress(range: SectionRange, c: number): number {
  const len = range.end - range.start;
  if (len <= 1e-6) return c >= range.start ? 1 : 0;
  return clamp01((c - range.start) / len);
}

/** Global scroll parameter in [0, ranges.length]: index of the current section + its progress. */
export function globalParam(ranges: readonly SectionRange[], c: number): number {
  if (ranges.length === 0) return 0;
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]!;
    if (c < r.end || i === ranges.length - 1) return i + rangeProgress(r, c);
  }
  return ranges.length;
}

/** Piecewise-linear map through sorted (x, y) breakpoints, clamped at the ends. */
export function piecewiseLinear(points: ReadonlyArray<readonly [number, number]>, x: number): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return x;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (x <= b[0]) {
      const span = b[0] - a[0];
      return span <= 0 ? b[1] : a[1] + ((x - a[0]) / span) * (b[1] - a[1]);
    }
  }
  return last[1];
}

/**
 * Global scroll parameter -> camera path parameter. Flat segments are "holds":
 * the camera rests at a station while the user scrolls a little around it
 * (solar-system overview, outro). Monotonic non-decreasing.
 */
export const PATH_REMAP: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1.35, 1.5],
  [1.65, 1.5], // solar-system overview hold
  [2, 2],
  [3.8, 4],
  [4, 4], // outro hold
];

export function scrollToPath(global: number): number {
  return piecewiseLinear(PATH_REMAP, global);
}

export interface DampOptions {
  /** Exponential approach rate, 1/s. */
  rate: number;
  /** Speed cap in path units per second (no teleport on fast scroll / End key). */
  maxSpeed: number;
  /** Snap when closer than this. */
  epsilon: number;
}

export const DEFAULT_DAMP: Readonly<DampOptions> = Object.freeze({ rate: 4, maxSpeed: 1.5, epsilon: 5e-4 });

/**
 * One damping step from `current` toward `target`. Frame-rate independent,
 * never overshoots, speed-capped. Smooths trackpad jitter and fast scrolls.
 */
export function dampStep(current: number, target: number, dt: number, o: DampOptions = DEFAULT_DAMP): number {
  const d = target - current;
  if (Math.abs(d) <= o.epsilon || dt <= 0) return Math.abs(d) <= o.epsilon ? target : current;
  let step = d * (1 - Math.exp(-o.rate * dt));
  const cap = o.maxSpeed * dt;
  if (step > cap) step = cap;
  else if (step < -cap) step = -cap;
  return current + step;
}

/** Reduced motion: the nearest "shot" (camera cut) for a path parameter. */
export function nearestShot(shots: readonly number[], p: number): number {
  let best = shots[0] ?? 0;
  for (const s of shots) if (Math.abs(s - p) < Math.abs(best - p)) best = s;
  return best;
}

/** Opacity of a caption shown over [from, to] of progress with `fade` long ramps. */
export function windowOpacity(p: number, from: number, to: number, fade = 0.06): number {
  if (p <= from || p >= to) return 0;
  const f = Math.max(1e-6, Math.min(fade, (to - from) / 2));
  return clamp01(Math.min((p - from) / f, (to - p) / f));
}
