// Entry point. Sections are wired together here by FE tickets (FE-01..FE-05).
import './styles/main.css';
import './styles/responsive.css';
import { createSceneCore, type SceneContext } from './scene/core';
import { createStarfield } from './scene/starfield';
import { createFlight } from './scene/flight';
import { disposeScrollTracker } from './scene/scroll';
import { currentQuality } from './scene/quality';
import { createLoadingScreen, hasWebGL2 } from './ui/loadingScreen';

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
if (!canvas) {
  throw new Error('Missing <canvas id="stage"> in index.html');
}

// FE-05: the loading screen is static markup (paints before this bundle runs);
// from here on it follows the shared loadingManager.
const loading = createLoadingScreen();

const NO_WEBGL_TITLE = '3D graphics are unavailable';
const NO_WEBGL_MESSAGE =
  'This site draws its galaxy, planets and probe with WebGL 2, which your browser or device ' +
  'could not start. It may be turned off in the browser settings, or hardware acceleration may ' +
  'be disabled. You can still read the text version of the page.';

function noWebGL(err?: unknown): void {
  if (err) console.warn('[main] WebGL renderer could not be created', err);
  document.documentElement.classList.add('no-webgl');
  canvas?.setAttribute('hidden', '');
  loading.showError(NO_WEBGL_TITLE, NO_WEBGL_MESSAGE);
}

let ctx: SceneContext | null = null;
if (hasWebGL2()) {
  try {
    ctx = createSceneCore(canvas);
  } catch (err) {
    noWebGL(err);
  }
} else {
  noWebGL();
}

if (ctx) {
  const core = ctx;
  // FE-05: fewer particles on phones (<= 768 px); the DPR cap is handled in core.
  const quality = currentQuality();
  const starfield = createStarfield(core, { count: quality.starCount });
  // Bind to the manager before any section starts loading, so no item is missed.
  let sectionsReady: (p: Promise<void>) => void = () => undefined;
  void loading.track(core.loadingManager, new Promise<void>((resolve) => (sectionsReady = resolve)));
  // FE-04: creates hero / solar-system / probe / outro, drives the camera from
  // scroll (C6) and activates only the sections in view.
  const flight = createFlight(core, { hero: { count: quality.galaxyCount } });
  sectionsReady(flight.ready);

  if (import.meta.env.DEV) {
    // Debug/smoke-test hooks only; not part of any contract.
    const w = window as unknown as { __flight?: typeof flight; __ctx?: SceneContext; __quality?: typeof quality };
    w.__flight = flight;
    w.__ctx = core;
    w.__quality = quality;
  }

  // Dev only: avoid stacking renderers/loops across hot reloads.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      flight.dispose();
      disposeScrollTracker();
      starfield.dispose();
      core.dispose();
    });
  }
}
