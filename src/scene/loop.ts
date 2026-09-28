// FE-01: DOM-free render-loop scheduler used by core.ts (C4).
// Kept free of three.js/WebGL so it can be unit tested under node.

export type TickCallback = (dt: number, elapsed: number) => void;

export interface LoopDeps {
  requestFrame(cb: (time: number) => void): number;
  cancelFrame(id: number): void;
  /** true while the page is hidden (document.hidden). */
  isHidden(): boolean;
  /** Seconds since the previous call (e.g. THREE.Clock#getDelta). */
  getDelta(): number;
  /** Called once per frame after all tick callbacks. */
  render(): void;
}

export interface Loop {
  onTick(cb: TickCallback): () => void;
  start(): void;
  stop(): void;
  /** Call on `visibilitychange`: pauses when hidden, resumes when visible. */
  handleVisibilityChange(): void;
  readonly running: boolean;
  readonly elapsed: number;
}

/** Upper bound for a single frame's dt (s), so a stalled tab does not make
 *  animations jump. */
export const MAX_DT = 0.1;

export function createLoop(deps: LoopDeps): Loop {
  const subscribers = new Set<TickCallback>();
  let frameId: number | null = null;
  let started = false;
  let elapsed = 0;

  const schedule = (): void => {
    if (frameId === null && started && !deps.isHidden()) {
      frameId = deps.requestFrame(frame);
    }
  };

  const frame = (): void => {
    frameId = null;
    if (!started || deps.isHidden()) return; // paused; resumed by visibility
    // Schedule first so an exception in a subscriber does not kill the loop.
    schedule();
    const dt = Math.min(Math.max(deps.getDelta(), 0), MAX_DT);
    elapsed += dt;
    // Copy so subscribers may (un)subscribe during a tick.
    for (const cb of [...subscribers]) cb(dt, elapsed);
    deps.render();
  };

  const cancel = (): void => {
    if (frameId !== null) {
      deps.cancelFrame(frameId);
      frameId = null;
    }
  };

  return {
    onTick(cb) {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    start() {
      if (started) return;
      started = true;
      deps.getDelta(); // discard time spent before start
      schedule();
    },
    stop() {
      started = false;
      cancel();
      subscribers.clear();
    },
    handleVisibilityChange() {
      if (deps.isHidden()) {
        cancel();
      } else if (started && frameId === null) {
        deps.getDelta(); // discard the hidden interval
        schedule();
      }
    },
    get running() {
      return started && frameId !== null;
    },
    get elapsed() {
      return elapsed;
    },
  };
}
