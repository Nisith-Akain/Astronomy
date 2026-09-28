// FE-04: scroll-driven orchestration. Owns the camera except while the
// solar-system section has explicitly been given control (user resting at the
// overview, or a planet focused). Creates and initialises all four sections,
// activates only the ones in view, and drives the probe + captions.
//
// Camera ownership is exclusive: FE-03's setCameraControl(true) is only called
// while the flight does NOT write the camera, and on hand-back the flight
// blends from wherever FE-03 left the camera, so nothing ever jumps or fights.
import * as THREE from 'three';
import type { SceneContext } from './core';
import { createHero, type HeroOptions, type HeroSection } from './hero';
import { createSolarSystem, type SolarSystemSection } from './solarSystem';
import { createProbe, type ProbeSection } from './probe';
import { createOutro, type OutroSection } from './outro';
import { SHOTS, STATIONS, createFlightPath, probeProgressForPath, type CameraPose } from './flightPath';
import { dampStep, nearestShot, scrollToPath, type SectionId } from './scrollMath';
import { getScrollSnapshot, onSectionProgress } from './scroll';
import '../styles/flight.css';

// --- policy (pure; unit-tested) ------------------------------------------------

/** Which sections are active for camera path parameter `pCam`. */
export function sectionActivity(pCam: number, focused: boolean): Record<SectionId, boolean> {
  return {
    hero: pCam < 1.3,
    'solar-system': focused || (pCam >= 0.6 && pCam <= 2.3),
    probe: pCam >= 1.6,
    outro: pCam >= 3.2,
  };
}

/** Solar-system group visibility (its Sun light also lights the probe, so it stays on after). */
export const solarGroupVisible = (pCam: number, focused: boolean): boolean => focused || pCam >= 0.4;

/** Global scroll range in which a focused planet keeps the camera (the solar section's own range). */
export const FOCUS_SCROLL_RANGE: readonly [number, number] = [1, 2];

export interface ControlInput {
  solarReady: boolean;
  solarActive: boolean;
  focused: boolean;
  /** Global scroll parameter (0..4). */
  global: number;
  /** Path parameter the scroll asks for. */
  pTarget: number;
  /** Path parameter the camera is at. */
  pCam: number;
  /** A reduced-motion fade is in progress. */
  fading: boolean;
}

/** Should FE-03 own the camera this frame? */
export function solarShouldControl(i: ControlInput): boolean {
  if (!i.solarReady || !i.solarActive || i.fading) return false;
  if (i.focused) return i.global >= FOCUS_SCROLL_RANGE[0] && i.global <= FOCUS_SCROLL_RANGE[1];
  return i.pTarget === STATIONS.solar && Math.abs(i.pCam - STATIONS.solar) < 0.004;
}

// --- orchestrator ---------------------------------------------------------------

export interface FlightSections {
  hero: HeroSection;
  solar: SolarSystemSection;
  probe: ProbeSection;
  outro: OutroSection;
}

export interface FlightState {
  global: number;
  pTarget: number;
  pCam: number;
  cameraOwner: 'flight' | 'solar-system';
  active: Record<SectionId, boolean>;
  focused: string | null;
  fade: number;
}

export interface Flight {
  readonly sections: FlightSections;
  /** Resolves when every section's init() has settled (success or logged failure). */
  readonly ready: Promise<void>;
  state(): FlightState;
  dispose(): void;
}

const HANDBACK_BLEND_S = 0.9;
const FADE_OUT_S = 0.18;
const FADE_IN_S = 0.3;
/** Scroll restoration on reload is snapped (no fly-in) until the user interacts or this passes. */
const RESTORE_SNAP_S = 1.5;

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** FE-05: optional tuning (e.g. fewer galaxy particles on mobile). */
export interface FlightOptions {
  hero?: Omit<HeroOptions, 'claimCamera'>;
}

export function createFlight(ctx: SceneContext, opts: FlightOptions = {}): Flight {
  const sections: FlightSections = {
    hero: createHero({ ...opts.hero, claimCamera: false }),
    solar: createSolarSystem(),
    probe: createProbe(),
    outro: createOutro(),
  };
  const { hero, solar, probe, outro } = sections;
  solar.setCameraControl(false); // the flight owns the camera until it hands it over

  const ready: Record<SectionId, boolean> = { hero: false, 'solar-system': false, probe: false, outro: false };
  const active: Record<SectionId, boolean> = { hero: false, 'solar-system': false, probe: false, outro: false };
  const byId = { hero, 'solar-system': solar, probe, outro } as const;
  let disposed = false;

  const initOne = (id: SectionId): Promise<void> =>
    byId[id]
      .init(ctx)
      .then(() => {
        if (disposed) return;
        ready[id] = true;
        // Hero activates itself in init(); bring it in line with the policy.
        byId[id].setActive(active[id]);
      })
      .catch((err: unknown) => console.error(`[flight] ${id} init failed`, err));
  const readyAll = Promise.all([initOne('hero'), initOne('solar-system'), initOne('probe'), initOne('outro')]).then(
    () => undefined,
  );

  const path = createFlightPath();
  const pose: CameraPose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  let pCam = 0;
  let first = true;
  let snapping = true;
  let sinceStart = 0;
  let solarHasControl = false;
  let blend: { pos: THREE.Vector3; target: THREE.Vector3; t: number } | null = null;
  let focusedId: string | null = null;
  let lastGlobal = 0;
  let lastPTarget = 0;

  // Reduced-motion cuts
  let shot: number | null = null;
  let fade: { phase: 'out' | 'in'; next: number } | null = null;
  let fadeAlpha = 0;

  const fadeEl = document.createElement('div');
  fadeEl.className = 'flight-fade';
  fadeEl.setAttribute('aria-hidden', 'true');
  ctx.renderer.domElement.after(fadeEl);

  const unFocus = solar.onFocusChange((id) => {
    focusedId = id;
  });

  const stopSnapping = (): void => {
    snapping = false;
  };
  const inputEvents = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
  for (const ev of inputEvents) window.addEventListener(ev, stopSnapping, { passive: true, capture: true });

  const unCaptions = onSectionProgress((id, p) => {
    if (id === 'probe') probe.setCaptionProgress(p);
  });

  const setActive = (id: SectionId, on: boolean): void => {
    if (active[id] === on) return;
    active[id] = on;
    if (ready[id]) byId[id].setActive(on);
  };

  const applyPose = (dt: number): void => {
    path.poseAt(pCam, pose);
    const cam = ctx.camera;
    if (blend) {
      blend.t = Math.min(1, blend.t + dt / HANDBACK_BLEND_S);
      const e = easeInOut(blend.t);
      cam.position.lerpVectors(blend.pos, pose.position, e);
      cam.lookAt(new THREE.Vector3().lerpVectors(blend.target, pose.target, e));
      if (blend.t >= 1) blend = null;
    } else {
      cam.position.copy(pose.position);
      cam.lookAt(pose.target);
    }
  };

  const startBlendFromCurrent = (): void => {
    if (ctx.reducedMotion) {
      blend = null;
      return;
    }
    path.poseAt(pCam, pose);
    const cam = ctx.camera;
    const dist = Math.max(1, cam.position.distanceTo(pose.target));
    const target = cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(dist).add(cam.position);
    blend = { pos: cam.position.clone(), target, t: 0 };
  };

  const tick = (dt: number): void => {
    if (disposed) return;
    sinceStart += dt;
    if (sinceStart > RESTORE_SNAP_S) snapping = false;

    const global = getScrollSnapshot().global;
    const pTarget = scrollToPath(global);
    lastGlobal = global;
    lastPTarget = pTarget;

    // A focused planet keeps the camera only while its section is on screen.
    if (focusedId && (global < FOCUS_SCROLL_RANGE[0] || global > FOCUS_SCROLL_RANGE[1])) {
      solar.focus(null); // closes the info panel; onFocusChange clears focusedId
      focusedId = null;
    }

    // --- advance the camera path parameter ------------------------------------
    if (ctx.reducedMotion) {
      const want = nearestShot(SHOTS, pTarget);
      if (first || snapping || shot === null) {
        shot = want;
        fade = null;
        fadeAlpha = 0;
      } else if (fade) {
        if (fade.phase === 'out') {
          fade.next = want;
          fadeAlpha = Math.min(1, fadeAlpha + dt / FADE_OUT_S);
          if (fadeAlpha >= 1) {
            shot = fade.next; // the cut happens behind the black frame
            fade.phase = 'in';
            blend = null;
          }
        } else {
          fadeAlpha = Math.max(0, fadeAlpha - dt / FADE_IN_S);
          if (fadeAlpha <= 0) fade = null;
        }
      } else if (want !== shot) {
        fade = { phase: 'out', next: want };
      }
      pCam = shot;
    } else {
      shot = null;
      fade = null;
      fadeAlpha = Math.max(0, fadeAlpha - dt / FADE_IN_S);
      pCam = first || snapping ? pTarget : dampStep(pCam, pTarget, dt);
    }
    fadeEl.style.opacity = fadeAlpha.toFixed(3);

    // --- sections ------------------------------------------------------------------
    const focused = focusedId !== null;
    const act = sectionActivity(pCam, focused);
    (Object.keys(act) as SectionId[]).forEach((id) => setActive(id, act[id]));
    solar.group.visible = solarGroupVisible(pCam, focused);
    probe.setProgress(probeProgressForPath(pCam));

    // --- camera ----------------------------------------------------------------------
    if (!solarHasControl) applyPose(dt); // pose first, so a hand-over starts from it
    const wantSolar = solarShouldControl({
      solarReady: ready['solar-system'],
      solarActive: active['solar-system'],
      focused,
      global,
      // Reduced motion: resting on the solar shot counts as being at the station.
      pTarget: ctx.reducedMotion ? pCam : pTarget,
      pCam,
      fading: fade !== null,
    });
    if (wantSolar !== solarHasControl) {
      solarHasControl = wantSolar;
      if (wantSolar) {
        blend = null;
        solar.setCameraControl(true); // FE-03 blends from the current view
      } else {
        solar.setCameraControl(false);
        startBlendFromCurrent();
        applyPose(dt);
      }
    }
    first = false;
  };

  const unTick = ctx.onTick(tick);

  const flight: Flight = {
    sections,
    ready: readyAll,
    state: () => ({
      global: lastGlobal,
      pTarget: lastPTarget,
      pCam,
      cameraOwner: solarHasControl ? 'solar-system' : 'flight',
      active: { ...active },
      focused: focusedId,
      fade: fadeAlpha,
    }),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unTick();
      unFocus();
      unCaptions();
      for (const ev of inputEvents) window.removeEventListener(ev, stopSnapping, { capture: true });
      fadeEl.remove();
      hero.dispose();
      solar.dispose();
      probe.dispose();
      outro.dispose();
    },
  };
  return flight;
}
