// FE-04: deep-space probe section (SectionModule id "probe").
//
// - Loads public/models/probe.glb (C5) with GLTFLoader through the shared
//   ctx.loadingManager. Model: 1 u = 1 m, forward = -Z, node "dish" animated.
// - The probe drifts along PROBE_DIRECTION as the flight orchestrator calls
//   setProgress(); a slow roll/bob and the dish slew run from onTick dt only
//   while active and not reducedMotion (read per frame).
// - Lighting: the Sun's PointLight lives in the solar-system group (FE-03), so
//   the probe is lit from the Sun's real direction. Metals also get a local
//   (per-material) PMREM room environment; nothing global is changed, so the
//   planets' night sides stay dark.
// - Captions: `.probe-caption[data-show="from to"]` elements inside the
//   section fade by the section's own scroll progress (C6).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { disposeObjectTree, type SceneContext, type SectionModule } from './core';
import { probePosition, probeQuaternion } from './flightPath';
import { windowOpacity } from './scrollMath';
import '../styles/probe.css';

export interface ProbeSection extends SectionModule {
  id: 'probe';
  /** Probe drift along its path, 0..1 (driven by the camera's path parameter). */
  setProgress(progress01: number): void;
  /** Section scroll progress 0..1 for the HTML captions. */
  setCaptionProgress(progress01: number): void;
  /** Resolves true once the model is in the scene, false if loading failed. */
  readonly loaded: Promise<boolean>;
  isActive(): boolean;
}

export interface ProbeOptions {
  /** Default `import.meta.env.BASE_URL + 'models/probe.glb'`. */
  url?: string;
  section?: HTMLElement;
}

const DISH_SLEW_RAD = 0.22;
const DISH_SLEW_SPEED = 0.18; // rad/s of phase
const DISH_SPIN_SPEED = 0.12; // rad/s about the boresight
const ROLL_RAD = 0.05;

export function createProbe(opts: ProbeOptions = {}): ProbeSection {
  const group = new THREE.Group();
  group.name = 'probe';
  group.visible = false;
  const craft = new THREE.Group(); // holds the glTF scene; group holds path position
  craft.name = 'probe-craft';
  craft.quaternion.copy(probeQuaternion());
  group.add(craft);

  let ctx: SceneContext | null = null;
  let active = false;
  let disposed = false;
  let unsubscribe: (() => void) | null = null;
  let dish: THREE.Object3D | null = null;
  let envRT: THREE.WebGLRenderTarget | null = null;
  let time = 0;
  let captions: Array<{ el: HTMLElement; from: number; to: number }> = [];
  let resolveLoaded: (ok: boolean) => void = () => {};
  const loaded = new Promise<boolean>((r) => (resolveLoaded = r));
  const baseQuat = probeQuaternion();
  const rollQuat = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);

  probePosition(0, group.position);

  const applyTime = (): void => {
    // Slow roll about the travel axis and a small bob; dish slews and spins.
    rollQuat.setFromAxisAngle(zAxis, Math.sin(time * 0.11) * ROLL_RAD);
    craft.quaternion.copy(baseQuat).multiply(rollQuat);
    craft.position.set(0, Math.sin(time * 0.23) * 0.15, 0);
    if (dish) {
      dish.rotation.set(Math.sin(time * DISH_SLEW_SPEED * 0.7) * DISH_SLEW_RAD * 0.5, Math.sin(time * DISH_SLEW_SPEED) * DISH_SLEW_RAD, time * DISH_SPIN_SPEED);
    }
  };

  const tick = (dt: number): void => {
    if (!ctx || ctx.reducedMotion) return; // frozen pose under reduced motion
    time += dt;
    applyTime();
  };

  const section: ProbeSection = {
    id: 'probe',
    group,
    loaded,
    async init(c: SceneContext): Promise<void> {
      if (ctx) return;
      ctx = c;
      c.scene.add(group);
      const host = opts.section ?? document.querySelector<HTMLElement>('section[data-section="probe"]');
      captions = host
        ? [...host.querySelectorAll<HTMLElement>('.probe-caption[data-show]')].map((el) => {
            const [from = 0, to = 1] = (el.dataset.show ?? '').split(/\s+/).map(Number);
            return { el, from, to };
          })
        : [];
      section.setCaptionProgress(0);

      const url = opts.url ?? import.meta.env.BASE_URL + 'models/probe.glb';
      try {
        const gltf = await new GLTFLoader(c.loadingManager).loadAsync(url);
        if (disposed) {
          disposeObjectTree(gltf.scene);
          resolveLoaded(false);
          return;
        }
        const pmrem = new THREE.PMREMGenerator(c.renderer);
        const room = new RoomEnvironment();
        envRT = pmrem.fromScene(room, 0.04);
        room.dispose();
        pmrem.dispose();
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            if (m instanceof THREE.MeshStandardMaterial && envRT) {
              m.envMap = envRT.texture;
              m.envMapIntensity = 0.45;
              m.needsUpdate = true;
            }
          }
        });
        dish = gltf.scene.getObjectByName('dish') ?? null;
        if (!dish) console.warn('[probe] model has no "dish" node; dish animation disabled');
        craft.add(gltf.scene);
        applyTime();
        resolveLoaded(true);
      } catch (err) {
        console.error(`[probe] failed to load ${url}`, err);
        resolveLoaded(false);
      }
    },
    setActive(on: boolean): void {
      if (!ctx || disposed || on === active) return;
      active = on;
      group.visible = on;
      if (on) unsubscribe = ctx.onTick(tick);
      else {
        unsubscribe?.();
        unsubscribe = null;
      }
    },
    setProgress(p: number): void {
      probePosition(p, group.position);
    },
    setCaptionProgress(p: number): void {
      for (const c of captions) {
        const o = windowOpacity(p, c.from, c.to);
        c.el.style.opacity = o.toFixed(3);
        c.el.classList.toggle('is-shown', o > 0.01);
      }
    },
    isActive: () => active,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribe?.();
      unsubscribe = null;
      active = false;
      disposeObjectTree(group);
      envRT?.dispose();
      envRT = null;
      group.removeFromParent();
      group.clear();
      ctx = null;
      resolveLoaded(false);
    },
  };
  return section;
}
