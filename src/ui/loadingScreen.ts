// FE-05: loading screen. The static markup lives in index.html (#loading) so it
// paints before the JS bundle has run; this module drives it from the shared
// THREE.LoadingManager (C4) and turns it into an error panel when WebGL is
// unavailable.
import type * as THREE from 'three';
import '../styles/loading.css';

/** Hide anyway after this long, so a stalled asset never locks the page. */
export const LOADING_TIMEOUT_MS = 20000;
/** Must match the opacity transition in loading.css. */
export const LOADING_FADE_MS = 600;

/**
 * Displayed progress (0..1). The manager's item total grows while sections
 * discover assets (the solar system only queues its textures after fetching
 * planets.json), so the raw ratio can jump to 1 and then drop. Until every
 * section's init() has settled (`allQueued`) the bar is held to the first 20 %;
 * after that the manager ratio fills 20..95 %. It never moves backwards and only
 * reaches 100 % when `done` (pure).
 */
export function nextProgress(
  previous: number,
  loaded: number,
  total: number,
  done: boolean,
  allQueued = true,
): number {
  if (done) return 1;
  const raw = total > 0 ? Math.min(1, Math.max(0, loaded / total)) : 0;
  const mapped = allQueued ? 0.2 + 0.75 * raw : 0.2 * raw;
  return Math.max(previous, Math.min(0.95, mapped));
}

export interface LoadingScreen {
  readonly element: HTMLElement | null;
  /**
   * Follow `manager` and fade out once `ready` has settled and the manager has
   * no pending items (or after LOADING_TIMEOUT_MS). Wraps (does not replace)
   * any callbacks already set on the manager.
   */
  track(manager: THREE.LoadingManager, ready: Promise<unknown>): Promise<void>;
  /** Replace the progress UI with an error message (e.g. no WebGL). Stays until dismissed. */
  showError(title: string, message: string): void;
  /** Fade out and remove from the accessibility tree. Idempotent. */
  hide(): Promise<void>;
  /** Current displayed progress, 0..1. */
  progress(): number;
}

export function createLoadingScreen(
  root: HTMLElement | null = document.getElementById('loading'),
): LoadingScreen {
  const bar = root?.querySelector<HTMLElement>('[role="progressbar"]') ?? null;
  const fill = root?.querySelector<HTMLElement>('.loading-bar-fill') ?? null;
  const detail = root?.querySelector<HTMLElement>('.loading-detail') ?? null;
  let shown = 0;
  let hiding: Promise<void> | null = null;
  let errored = false;

  const render = (): void => {
    const pct = Math.round(shown * 100);
    if (fill) fill.style.transform = `scaleX(${shown.toFixed(3)})`;
    bar?.setAttribute('aria-valuenow', String(pct));
    if (detail) detail.textContent = `${pct}%`;
  };

  const screen: LoadingScreen = {
    element: root,

    track(manager, ready) {
      let loaded = 0;
      let total = 0;
      let allQueued = false;
      const update = (done = false): void => {
        if (errored || hiding) return;
        shown = nextProgress(shown, loaded, total, done, allQueued);
        render();
      };
      // three r186 leaves these undefined at runtime although the typings say
      // otherwise, so every previous callback is called optionally. A throw here
      // would surface inside the loaders and turn a successful load into an error.
      const prev: Partial<Pick<THREE.LoadingManager, 'onStart' | 'onProgress' | 'onLoad'>> = {
        onStart: manager.onStart,
        onProgress: manager.onProgress,
        onLoad: manager.onLoad,
      };
      manager.onStart = (url, l, t) => {
        loaded = l;
        total = t;
        update();
        prev.onStart?.(url, l, t);
      };
      manager.onProgress = (url, l, t) => {
        loaded = l;
        total = t;
        update();
        prev.onProgress?.(url, l, t);
      };
      manager.onLoad = () => {
        loaded = total;
        update();
        prev.onLoad?.();
      };
      // Failed items still count as finished for the manager (itemEnd); sections
      // log and fall back themselves (FE-03 colours, FE-04 probe), so we don't block.

      const idle = (): Promise<void> =>
        new Promise((resolve) => {
          const check = (): void => {
            if (loaded >= total) resolve();
            else setTimeout(check, 100);
          };
          check();
        });
      const queued = (): Promise<void> => {
        allQueued = true;
        update();
        return idle();
      };
      const settled = ready.then(queued, queued);
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, LOADING_TIMEOUT_MS));
      return Promise.race([settled, timeout]).then(() => {
        if (errored) return;
        update(true);
        return screen.hide();
      });
    },

    showError(title, message) {
      errored = true;
      if (!root) return;
      root.classList.add('is-error');
      root.hidden = false;
      const panel = root.querySelector<HTMLElement>('.loading-panel');
      if (!panel) return;
      panel.replaceChildren();
      panel.setAttribute('role', 'alert');
      const h = document.createElement('h2');
      h.className = 'loading-title';
      h.textContent = title;
      const p = document.createElement('p');
      p.className = 'loading-message';
      p.textContent = message;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'loading-dismiss';
      btn.textContent = 'Continue to the text version';
      btn.addEventListener('click', () => void screen.hide());
      panel.append(h, p, btn);
      btn.focus();
    },

    hide() {
      if (hiding) return hiding;
      if (!root) return (hiding = Promise.resolve());
      root.classList.add('is-done');
      root.setAttribute('aria-hidden', 'true');
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      hiding = new Promise<void>((resolve) => {
        setTimeout(
          () => {
            root.hidden = true;
            resolve();
          },
          reduced ? 0 : LOADING_FADE_MS,
        );
      });
      return hiding;
    },

    progress: () => shown,
  };
  render();
  return screen;
}

/** True if this browser can create a WebGL2 context (three r163+ needs WebGL2). */
export function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
