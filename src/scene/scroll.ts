// FE-04: C6 scroll tracking. One passive scroll listener for the whole page;
// no requestAnimationFrame of its own (C4: one RAF loop). Section geometry is
// cached and re-measured only on resize / layout changes.
import {
  SECTION_IDS,
  computeRanges,
  globalParam,
  rangeProgress,
  type SectionBox,
  type SectionId,
  type SectionRange,
} from './scrollMath';

export type { SectionId } from './scrollMath';

export interface ScrollSnapshot {
  /** Global parameter in [0, 4]: section index + that section's progress. */
  global: number;
  /** Per-section progress, 0..1 (see scrollMath.ts for the definition). */
  progress: Record<SectionId, number>;
}

type ProgressCb = (id: string, progress01: number) => void;

interface Tracker {
  snapshot(): ScrollSnapshot;
  subscribe(cb: ProgressCb): () => void;
  dispose(): void;
}

let tracker: Tracker | null = null;

function createTracker(): Tracker {
  const listeners = new Set<ProgressCb>();
  const progress = Object.fromEntries(SECTION_IDS.map((id) => [id, 0])) as Record<SectionId, number>;
  let global = 0;
  let ranges: SectionRange[] = [];
  let layoutDirty = true;

  const measure = (): void => {
    const vh = window.innerHeight || 1;
    const docH = document.documentElement.scrollHeight;
    const boxes: SectionBox[] = [];
    for (const id of SECTION_IDS) {
      const el = document.querySelector<HTMLElement>(`section[data-section="${id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      boxes.push({ id, top: r.top + window.scrollY, height: r.height });
    }
    ranges = computeRanges(boxes, vh, docH);
    layoutDirty = false;
  };

  const update = (): void => {
    if (layoutDirty) measure();
    const c = window.scrollY + (window.innerHeight || 1) / 2;
    global = globalParam(ranges, c);
    for (const r of ranges) {
      const p = rangeProgress(r, c);
      if (p !== progress[r.id]) {
        progress[r.id] = p;
        for (const cb of listeners) cb(r.id, p);
      }
    }
  };

  const onScroll = (): void => update();
  const onLayout = (): void => {
    layoutDirty = true;
    update();
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onLayout);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onLayout) : null;
  ro?.observe(document.documentElement);
  const content = document.getElementById('content');
  if (content) ro?.observe(content);
  // Late layout shifts (web fonts) and scroll restoration on reload.
  window.addEventListener('load', onLayout);
  update();

  return {
    snapshot: () => {
      if (layoutDirty) update();
      return { global, progress: { ...progress } };
    },
    subscribe(cb) {
      listeners.add(cb);
      for (const id of SECTION_IDS) cb(id, progress[id]); // current state first
      return () => listeners.delete(cb);
    },
    dispose() {
      listeners.clear();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('load', onLayout);
      ro?.disconnect();
    },
  };
}

function getTracker(): Tracker {
  tracker ??= createTracker();
  return tracker;
}

/**
 * C6: subscribe to per-section scroll progress. The callback is called once
 * per section immediately with the current value, then whenever a section's
 * progress changes. Returns an unsubscribe function.
 */
export function onSectionProgress(cb: (id: string, progress01: number) => void): () => void {
  return getTracker().subscribe(cb);
}

/** Current scroll state (additive to C6; read per frame by the flight orchestrator). */
export function getScrollSnapshot(): ScrollSnapshot {
  return getTracker().snapshot();
}

/** Remove listeners (HMR / teardown). A later call to the API re-creates the tracker. */
export function disposeScrollTracker(): void {
  tracker?.dispose();
  tracker = null;
}
