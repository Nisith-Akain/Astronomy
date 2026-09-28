// FE-01: scene core (C4). One renderer, one RAF loop for the whole page.
import * as THREE from 'three';
import { createLoop } from './loop';
import { pixelRatioFor } from './quality';

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  clock: THREE.Clock;
  loadingManager: THREE.LoadingManager;
  reducedMotion: boolean; // from prefers-reduced-motion
  onTick(cb: (dt: number, elapsed: number) => void): () => void; // returns unsubscribe
  dispose(): void;
}

/** Implemented by every page section (hero, solar-system, probe, outro). */
export interface SectionModule {
  id: 'hero' | 'solar-system' | 'probe' | 'outro';
  group: THREE.Group; // everything the section adds to the scene
  init(ctx: SceneContext): Promise<void>;
  setActive(active: boolean): void; // pause per-frame work when off-screen
  dispose(): void;
}

export const MAX_PIXEL_RATIO = 2;
export const CAMERA_FOV = 55;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 20000;

export function createSceneCore(canvas: HTMLCanvasElement): SceneContext {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  // Colour pipeline is configured here once for the whole site.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
  camera.position.set(0, 0, 10);
  scene.add(camera);

  const clock = new THREE.Clock(false);
  const loadingManager = new THREE.LoadingManager();

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  // --- sizing -------------------------------------------------------------
  const resize = (): void => {
    // CSS owns the canvas size; the drawing buffer follows it (no stretch).
    const width = Math.max(1, canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, canvas.clientHeight || window.innerHeight);
    // FE-05: cap is MAX_PIXEL_RATIO (2) on desktop, 1.5 at <= 768 px wide.
    const dpr = Math.min(pixelRatioFor(window.devicePixelRatio, window.innerWidth), MAX_PIXEL_RATIO);
    if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x !== width || size.y !== height) {
      renderer.setSize(width, height, false);
    }
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();

  // window resize also fires on browser zoom (DPR change).
  window.addEventListener('resize', resize);
  const resizeObserver =
    typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(canvas);

  // --- loop ----------------------------------------------------------------
  const loop = createLoop({
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
    isHidden: () => document.hidden,
    getDelta: () => clock.getDelta(),
    render: () => renderer.render(scene, camera),
  });
  const onVisibility = (): void => loop.handleVisibilityChange();
  document.addEventListener('visibilitychange', onVisibility);

  let disposed = false;

  const ctx: SceneContext = {
    renderer,
    scene,
    camera,
    clock,
    loadingManager,
    reducedMotion: motionQuery.matches,
    onTick: (cb) => loop.onTick(cb),
    dispose() {
      if (disposed) return;
      disposed = true;
      loop.stop();
      clock.stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', resize);
      resizeObserver?.disconnect();
      motionQuery.removeEventListener('change', onMotionChange);
      disposeObjectTree(scene);
      scene.clear();
      renderer.renderLists.dispose();
      renderer.dispose();
    },
  };

  // Kept live so modules that read ctx.reducedMotion per frame follow changes.
  function onMotionChange(e: MediaQueryListEvent): void {
    ctx.reducedMotion = e.matches;
  }
  motionQuery.addEventListener('change', onMotionChange);

  clock.start();
  loop.start();
  return ctx;
}

/** Dispose geometries, materials and their textures under `root`. */
export function disposeObjectTree(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse((obj) => {
    const withGeo = obj as Partial<THREE.Mesh>;
    if (withGeo.geometry instanceof THREE.BufferGeometry) geometries.add(withGeo.geometry);
    const mat = withGeo.material;
    if (Array.isArray(mat)) mat.forEach((m) => materials.add(m));
    else if (mat instanceof THREE.Material) materials.add(mat);
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => {
    for (const value of Object.values(m)) {
      if (value instanceof THREE.Texture) value.dispose();
    }
    const uniforms = (m as Partial<THREE.ShaderMaterial>).uniforms;
    if (uniforms) {
      for (const u of Object.values(uniforms)) {
        if (u.value instanceof THREE.Texture) u.value.dispose();
      }
    }
    m.dispose();
  });
}
