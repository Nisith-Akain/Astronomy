// FE-03: interactive solar system section (SectionModule id "solar-system").
//
// - Data: C2 fetched at runtime. Positions come only from
//   heliocentricPosition + toScene (C3); orbit lines from orbitPath (LineLoop).
// - Scale (Q1): DEFAULT_SCALE (sqrt) <-> TRUE_DISTANCE_SCALE (linear). The
//   toggle animates BOTH positions (lerp of the two toScene results, which
//   share a direction) and radii (lerp of the two displayRadius values).
// - Time (Q2): sim clock starts at dateToJulian(new Date()); advanced only
//   from the onTick dt argument (never ctx.clock).
// - Spin: tilt by axialTiltDeg, spin by |rotationPeriodHours| (C2 data notes).
import * as THREE from 'three';
import { disposeObjectTree, type SceneContext, type SectionModule } from './core';
import type { Planet, SolarSystemData } from '../types/planets';
import { dateToJulian, julianToDate } from '../lib/orbit/time';
import { heliocentricPosition, type Vec3 } from '../lib/orbit/kepler';
import { orbitPath } from '../lib/orbit/path';
import {
  DEFAULT_SCALE,
  TRUE_DISTANCE_SCALE,
  displayRadius,
  toScene,
  type ScaleConfig,
} from '../lib/orbit/scale';
import {
  DEFAULT_SPEED_DAYS_PER_S,
  easeInOutCubic,
  formatSimDate,
  formatSpeed,
  lerp,
  lerpVec3,
  ringRadialUVs,
  sliderToSpeed,
  speedToSlider,
  spinDelta,
} from './solarSystemMath';
import { createSolarSystemUi, type SolarSystemUi } from '../ui/solarSystemUi';

export type ScaleMode = 'default' | 'true-distance';

/** Extra API beyond C4's SectionModule (documented in INTERFACES.md C4 "As built FE-03"). */
export interface SolarSystemSection extends SectionModule {
  id: 'solar-system';
  /** When false the section never moves ctx.camera (FE-04 scroll flight). Default true. */
  setCameraControl(enabled: boolean): void;
  /** Focus a body by id ("sun" | planet id) or return to overview (null). */
  focus(id: string | null): void;
  getFocused(): string | null;
  /** Subscribe to focus changes; returns unsubscribe. */
  onFocusChange(cb: (id: string | null) => void): () => void;
  setScaleMode(mode: ScaleMode): void;
  getScaleMode(): ScaleMode;
  /** Current simulated Julian Date (UTC scale). */
  getJulianDate(): number;
}

export interface SolarSystemOptions {
  /** Host element for the overlay; default `section[data-section="solar-system"]`. */
  section?: HTMLElement;
  /** Default `import.meta.env.BASE_URL + 'data/planets.json'` (C2). */
  dataUrl?: string;
}

// --- tunables -----------------------------------------------------------------
const SCALE_TRANSITION_S = 1.6;
const CAMERA_TRANSITION_S = 1.8;
const ORBIT_REFRESH_DAYS = 365.25 * 2; // rebuild orbit polylines as elements drift
const ORBIT_SEGMENTS = 256;
const OVERVIEW_DISTANCE = 640;
const OVERVIEW_ELEVATION = 0.63; // rad (~36 deg)
const OVERVIEW_TARGET = new THREE.Vector3(0, 0, 30);
const FOCUS_ELEVATION = 0.28;
const FOCUS_AZIMUTH_OFFSET = Math.PI + 0.7; // sunward 3/4 view: lit side visible
const PICK_MIN_PX = 10;
/** FE-05: fingertips are imprecise, so taps get a larger pick radius. */
const PICK_TOUCH_PX = 24;
const MARKER_PX = 5;
const JD_MIN = dateToJulian(new Date(Date.UTC(1000, 0, 1)));
const JD_MAX = dateToJulian(new Date(Date.UTC(3000, 0, 1)));
const JD_VALID_MIN = dateToJulian(new Date(Date.UTC(1800, 0, 1)));
const JD_VALID_MAX = dateToJulian(new Date(Date.UTC(2051, 0, 1)));

interface Body {
  id: string;
  name: string;
  facts: readonly string[];
  radiusKm: number;
  rotationPeriodHours: number;
  planet: Planet | null; // null for the Sun
  color: THREE.Color;
  pivot: THREE.Object3D; // position + uniform scale (= display radius)
  spin: THREE.Mesh;
  material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
  marker: THREE.Points;
  markerMaterial: THREE.PointsMaterial;
  helio: Vec3; // AU, ecliptic
  radiusDefault: number;
  radiusTrue: number;
  focusDistance: number; // in body radii
  focusElevation: number; // rad
  orbit: { line: THREE.LineLoop; material: THREE.LineBasicMaterial; au: Float32Array; jd: number } | null;
}

interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

function makeGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function sphericalOffset(r: number, elevation: number, azimuth: number): THREE.Vector3 {
  const c = Math.cos(elevation);
  return new THREE.Vector3(r * c * Math.sin(azimuth), r * Math.sin(elevation), r * c * Math.cos(azimuth));
}

export function createSolarSystem(options: SolarSystemOptions = {}): SolarSystemSection {
  const group = new THREE.Group();
  group.name = 'solar-system';

  let ctx: SceneContext | null = null;
  let ui: SolarSystemUi | null = null;
  let section: HTMLElement | null = null;
  let unsubscribeTick: (() => void) | null = null;
  let active = false;
  let disposed = false;
  let cameraControl = true;
  const bodies: Body[] = [];
  const byId = new Map<string, Body>();
  const focusListeners = new Set<(id: string | null) => void>();
  const cleanups: Array<() => void> = [];

  // Simulation state
  let jd = dateToJulian(new Date());
  let playing = true;
  let speed = DEFAULT_SPEED_DAYS_PER_S;

  // Scale blend: 0 = DEFAULT_SCALE, 1 = TRUE_DISTANCE_SCALE
  let scaleMode: ScaleMode = 'default';
  let scaleFrom = 0;
  let scaleTo = 0;
  let scaleAnim = 1;
  let scaleBlend = 0;
  let orbitsDirty = true;

  // Focus / camera state
  let focusedId: string | null = null;
  let camFromPos = new THREE.Vector3();
  let camFromTarget = new THREE.Vector3();
  let camAnim = 1;
  const camTarget = new THREE.Vector3().copy(OVERVIEW_TARGET);
  let userYaw = 0;
  let userPitch = 0;

  // Hover / pointer state
  let hoverPointer: string | null = null;
  let hoverList: string | null = null;
  let pointer: { x: number; y: number } | null = null;
  let drag: { id: number; x: number; y: number; moved: boolean } | null = null;
  let infoTimer = 0;

  const tmpV = new THREE.Vector3();
  const tmpW = new THREE.Vector3();
  const tmpS = new THREE.Vector3(); // world-scale scratch (never aliased with tmpV/tmpW)

  // ---------------------------------------------------------------------------
  const blendPosition = (p: Vec3, out: THREE.Vector3): THREE.Vector3 => {
    const a = toScene(p, DEFAULT_SCALE);
    if (scaleBlend <= 0) return out.set(a.x, a.y, a.z);
    const b = toScene(p, TRUE_DISTANCE_SCALE);
    const v = lerpVec3(a, b, scaleBlend);
    return out.set(v.x, v.y, v.z);
  };

  const bodyRadius = (b: Body): number => lerp(b.radiusDefault, b.radiusTrue, scaleBlend);

  const worldPosOf = (b: Body, out: THREE.Vector3): THREE.Vector3 => b.pivot.getWorldPosition(out);
  const worldRadiusOf = (b: Body): number => bodyRadius(b) * group.getWorldScale(tmpS).x;

  function effectiveHover(): string | null {
    return hoverList ?? hoverPointer;
  }

  function applyHighlight(): void {
    const h = effectiveHover();
    for (const b of bodies) {
      const on = b.id === h || b.id === focusedId;
      if (b.material instanceof THREE.MeshStandardMaterial) {
        b.material.emissive.copy(b.color).multiplyScalar(b.id === h ? 0.35 : 0);
      }
      b.markerMaterial.size = b.id === h ? MARKER_PX * 1.8 : MARKER_PX;
      if (b.orbit) b.orbit.material.opacity = on ? 0.85 : 0.3;
    }
    ui?.setHovered(h);
  }

  function setHoverPointer(id: string | null): void {
    if (id === hoverPointer) return;
    hoverPointer = id;
    applyHighlight();
    if (section) section.style.cursor = id ? 'pointer' : '';
  }

  // --- building ----------------------------------------------------------------
  function loadTexture(
    loader: THREE.TextureLoader,
    path: string,
    onLoad: (t: THREE.Texture) => void,
    what: string,
  ): void {
    loader.load(
      import.meta.env.BASE_URL + path,
      (tex) => {
        if (disposed) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        if (ctx) tex.anisotropy = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy());
        onLoad(tex);
      },
      undefined,
      () => {
        // AC: texture failure falls back to the C2 `color`; no crash.
        console.warn(`[solar-system] texture failed for ${what} (${path}); using fallback colour`);
      },
    );
  }

  function build(data: SolarSystemData, c: SceneContext): void {
    const loader = new THREE.TextureLoader(c.loadingManager);
    const sphere = new THREE.SphereGeometry(1, 64, 32);
    const markerGeo = new THREE.BufferGeometry();
    markerGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    const glow = makeGlowTexture();

    // Lights live in the section group (Sun is the light source).
    const sunLight = new THREE.PointLight(0xffffff, 3.2, 0, 0);
    sunLight.name = 'sun-light';
    group.add(sunLight, new THREE.AmbientLight(0xffffff, 0.07));

    const makeBody = (
      id: string,
      name: string,
      facts: readonly string[],
      radiusKm: number,
      rotationPeriodHours: number,
      colorHex: string,
      texture: string,
      planet: Planet | null,
    ): Body => {
      const color = new THREE.Color(colorHex);
      const pivot = new THREE.Object3D();
      pivot.name = id;
      const tilt = new THREE.Object3D();
      pivot.add(tilt);

      const material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial = planet
        ? new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 })
        : new THREE.MeshBasicMaterial({ color, toneMapped: false });
      const spin = new THREE.Mesh(sphere, material);
      spin.name = `${id}-surface`;
      tilt.add(spin);
      loadTexture(
        loader,
        texture,
        (tex) => {
          material.map = tex;
          material.color.set(0xffffff);
          material.needsUpdate = true;
        },
        name,
      );

      // Screen-space marker so tiny bodies stay visible from the overview;
      // it sits at the body centre, so a large sphere depth-occludes it.
      const markerMaterial = new THREE.PointsMaterial({
        color,
        size: MARKER_PX,
        sizeAttenuation: false,
        map: glow,
        transparent: true,
        depthWrite: false,
      });
      const marker = new THREE.Points(markerGeo, markerMaterial);
      marker.name = `${id}-marker`;
      if (planet) pivot.add(marker);

      if (planet) {
        // Tilt by the fact-sheet obliquity (> 90 deg for Venus/Uranus flips
        // the spin sense); spin uses |period| in the tick (C2 data notes).
        tilt.rotation.z = -THREE.MathUtils.degToRad(planet.axialTiltDeg);
      }

      const radiusDefault = displayRadius(radiusKm, DEFAULT_SCALE);
      const radiusTrue = displayRadius(radiusKm, TRUE_DISTANCE_SCALE);
      const body: Body = {
        id,
        name,
        facts,
        radiusKm,
        rotationPeriodHours,
        planet,
        color,
        pivot,
        spin,
        material,
        marker,
        markerMaterial,
        helio: { x: 0, y: 0, z: 0 },
        radiusDefault,
        radiusTrue,
        focusDistance: planet ? (planet.ring ? 7 : 4.5) : 3.6,
        // Higher view for ringed planets so the ring is not seen edge-on.
        focusElevation: planet ? (planet.ring ? 0.55 : FOCUS_ELEVATION) : 0.35,
        orbit: null,
      };

      if (planet?.ring) {
        const ring = planet.ring;
        const inner = ring.innerKm / radiusKm; // in planet radii (pivot is scaled)
        const outer = ring.outerKm / radiusKm;
        const geo = new THREE.RingGeometry(inner, outer, 160, 6);
        // Radial strip texture: u runs inner -> outer edge (not RingGeometry's default planar UVs).
        const pos = geo.getAttribute('position');
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(ringRadialUVs(pos.array, inner, outer), 2));
        geo.rotateX(-Math.PI / 2); // into the equatorial (XZ) plane of the tilt node
        const ringMat = new THREE.MeshBasicMaterial({
          color: color.clone().multiplyScalar(0.9),
          transparent: true,
          opacity: 0.6,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const ringMesh = new THREE.Mesh(geo, ringMat);
        ringMesh.name = `${id}-ring`;
        tilt.add(ringMesh);
        loadTexture(
          loader,
          ring.texture,
          (tex) => {
            ringMat.map = tex;
            ringMat.color.set(0xe6e6e6);
            ringMat.opacity = 1;
            ringMat.needsUpdate = true;
          },
          `${name} ring`,
        );
      }

      if (planet) {
        const au = orbitPath(planet.elements, jd, ORBIT_SEGMENTS);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(au.length), 3));
        const lineMat = new THREE.LineBasicMaterial({
          color: color.clone().lerp(new THREE.Color(0xffffff), 0.35),
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
        });
        const line = new THREE.LineLoop(geo, lineMat);
        line.name = `${id}-orbit`;
        line.frustumCulled = false; // bounds change with the scale blend
        group.add(line);
        body.orbit = { line, material: lineMat, au, jd };
      } else {
        // Sun halo (sprite), additive; size in sun radii.
        const halo = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: glow,
            color: new THREE.Color(colorHex),
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
          }),
        );
        halo.name = 'sun-halo';
        halo.scale.setScalar(4);
        pivot.add(halo);
      }

      group.add(pivot);
      bodies.push(body);
      byId.set(id, body);
      return body;
    };

    const s = data.sun;
    makeBody(s.id, s.name, s.facts, s.radiusKm, s.rotationPeriodHours, s.color, s.texture, null);
    for (const p of data.planets) {
      makeBody(p.id, p.name, p.facts, p.radiusKm, p.rotationPeriodHours, p.color, p.texture, p);
    }
  }

  // --- per-frame update ----------------------------------------------------------
  function updateOrbits(force: boolean): void {
    for (const b of bodies) {
      const o = b.orbit;
      if (!o || !b.planet) continue;
      let changed = force;
      if (Math.abs(jd - o.jd) > ORBIT_REFRESH_DAYS) {
        try {
          o.au = orbitPath(b.planet.elements, jd, ORBIT_SEGMENTS);
          o.jd = jd;
          changed = true;
        } catch (err) {
          console.warn(`[solar-system] orbitPath failed for ${b.id}`, err);
        }
      }
      if (!changed) continue;
      const attr = o.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const n = o.au.length / 3;
      for (let i = 0; i < n; i++) {
        blendPosition({ x: o.au[i * 3] ?? 0, y: o.au[i * 3 + 1] ?? 0, z: o.au[i * 3 + 2] ?? 0 }, tmpV);
        arr[i * 3] = tmpV.x;
        arr[i * 3 + 1] = tmpV.y;
        arr[i * 3 + 2] = tmpV.z;
      }
      attr.needsUpdate = true;
    }
  }

  function updateBodies(simDtDays: number, dt: number): void {
    for (const b of bodies) {
      if (b.planet) {
        b.helio = heliocentricPosition(b.planet.elements, jd);
        blendPosition(b.helio, b.pivot.position);
      }
      b.pivot.scale.setScalar(bodyRadius(b));
      b.spin.rotation.y = (b.spin.rotation.y + spinDelta(b.rotationPeriodHours, simDtDays, dt)) % (Math.PI * 2);
    }
  }

  function desiredPose(): CameraPose {
    group.updateMatrixWorld();
    const b = focusedId ? byId.get(focusedId) : undefined;
    if (!b) {
      const target = group.localToWorld(OVERVIEW_TARGET.clone());
      const off = sphericalOffset(
        OVERVIEW_DISTANCE * group.getWorldScale(tmpS).x,
        THREE.MathUtils.clamp(OVERVIEW_ELEVATION + userPitch, 0.05, 1.5),
        userYaw,
      );
      return { position: target.clone().add(off), target };
    }
    const target = worldPosOf(b, new THREE.Vector3());
    const r = worldRadiusOf(b);
    const baseAz = b.planet ? Math.atan2(b.pivot.position.x, b.pivot.position.z) + FOCUS_AZIMUTH_OFFSET : 0;
    const off = sphericalOffset(
      r * b.focusDistance,
      THREE.MathUtils.clamp(b.focusElevation + userPitch, -1.4, 1.4),
      baseAz + userYaw,
    );
    return { position: target.clone().add(off), target };
  }

  function beginCameraTransition(fromCurrentView = false): void {
    if (!ctx) return;
    camFromPos = ctx.camera.position.clone();
    if (fromCurrentView) {
      // Start from wherever the camera currently looks (e.g. the hero view).
      const dist = Math.max(1, ctx.camera.position.distanceTo(desiredPose().target));
      camFromTarget = ctx.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(dist).add(ctx.camera.position);
    } else {
      camFromTarget = camTarget.clone();
    }
    camAnim = ctx.reducedMotion ? 1 : 0;
  }

  function updateCamera(dt: number): void {
    if (!ctx || !cameraControl) return;
    const pose = desiredPose();
    if (camAnim < 1) {
      camAnim = Math.min(1, camAnim + dt / CAMERA_TRANSITION_S);
      const e = easeInOutCubic(camAnim);
      // Lerp from the snapshot to the LIVE pose, so a moving planet is
      // tracked without lag and the camera is locked on when e = 1.
      ctx.camera.position.lerpVectors(camFromPos, pose.position, e);
      camTarget.lerpVectors(camFromTarget, pose.target, e);
    } else {
      ctx.camera.position.copy(pose.position);
      camTarget.copy(pose.target);
    }
    ctx.camera.lookAt(camTarget);
  }

  function pick(clientX: number, clientY: number, minPx = PICK_MIN_PX): string | null {
    if (!ctx) return null;
    const rect = ctx.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const cam = ctx.camera;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    let best: string | null = null;
    let bestDepth = Infinity;
    for (const b of bodies) {
      worldPosOf(b, tmpV);
      const depth = tmpV.distanceTo(cam.position);
      tmpW.copy(tmpV).project(cam);
      if (tmpW.z < -1 || tmpW.z > 1) continue;
      const sx = rect.left + ((tmpW.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - tmpW.y) / 2) * rect.height;
      const rPx = (worldRadiusOf(b) / (depth * tanHalf)) * (rect.height / 2);
      const hit = Math.hypot(sx - clientX, sy - clientY) <= Math.max(rPx, minPx);
      if (hit && depth < bestDepth) {
        best = b.id;
        bestDepth = depth;
      }
    }
    return best;
  }

  function updateLabel(): void {
    if (!ctx || !ui) return;
    const id = effectiveHover();
    const b = id ? byId.get(id) : undefined;
    if (!b) {
      ui.setLabel(null);
      return;
    }
    const rect = ctx.renderer.domElement.getBoundingClientRect();
    worldPosOf(b, tmpV);
    const depth = tmpV.distanceTo(ctx.camera.position);
    tmpW.copy(tmpV).project(ctx.camera);
    if (tmpW.z < -1 || tmpW.z > 1) {
      ui.setLabel(null);
      return;
    }
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) / 2);
    const rPx = (worldRadiusOf(b) / (depth * tanHalf)) * (rect.height / 2);
    const x = rect.left + ((tmpW.x + 1) / 2) * rect.width;
    const y = rect.top + ((1 - tmpW.y) / 2) * rect.height - Math.max(rPx, 4) - 6;
    ui.setLabel(b.name, x, y);
  }

  function updateInfo(dt: number): void {
    if (!ui || !focusedId) return;
    infoTimer -= dt;
    if (infoTimer > 0) return;
    infoTimer = 0.25;
    const b = byId.get(focusedId);
    if (!b) return;
    const km = Math.round(b.radiusKm).toLocaleString('en-US');
    if (!b.planet) {
      ui.setInfoDetail(`Radius ${km} km`);
      return;
    }
    const r = Math.hypot(b.helio.x, b.helio.y, b.helio.z);
    ui.setInfoDetail(`${r.toFixed(3)} AU from the Sun · radius ${km} km`);
  }

  function syncDate(): void {
    ui?.setDate(formatSimDate(julianToDate(jd)), jd < JD_VALID_MIN || jd > JD_VALID_MAX);
  }

  function tick(dt: number): void {
    if (!ctx || !active) return;
    let simDtDays = 0;
    if (playing) {
      const next = Math.min(JD_MAX, Math.max(JD_MIN, jd + speed * dt));
      simDtDays = next - jd;
      jd = next;
      if (jd >= JD_MAX) setPlaying(false);
    }

    // Scale-mode transition (position AND radius).
    let scaleChanged = false;
    if (scaleAnim < 1) {
      scaleAnim = ctx.reducedMotion ? 1 : Math.min(1, scaleAnim + dt / SCALE_TRANSITION_S);
      scaleBlend = lerp(scaleFrom, scaleTo, easeInOutCubic(scaleAnim));
      scaleChanged = true;
    }
    if (ctx.reducedMotion && camAnim < 1) camAnim = 1;

    updateBodies(simDtDays, dt);
    updateOrbits(orbitsDirty || scaleChanged);
    orbitsDirty = false;
    updateCamera(dt);

    if (pointer && !drag) setHoverPointer(pick(pointer.x, pointer.y));
    updateLabel();
    updateInfo(dt);
    syncDate();
  }

  // --- controls ------------------------------------------------------------------
  function setPlaying(p: boolean): void {
    playing = p;
    ui?.setPlaying(p);
  }

  function setScaleMode(mode: ScaleMode): void {
    if (mode === scaleMode) return;
    scaleMode = mode;
    scaleFrom = scaleBlend;
    scaleTo = mode === 'true-distance' ? 1 : 0;
    scaleAnim = ctx?.reducedMotion ? 1 : 0;
    if (scaleAnim === 1) {
      scaleBlend = scaleTo;
      orbitsDirty = true;
    }
    ui?.setTrueScale(mode === 'true-distance');
  }

  function focus(id: string | null): void {
    const next = id && byId.has(id) ? id : null;
    if (next === focusedId) {
      if (next) ui?.showInfo(next, byId.get(next)?.name ?? next, byId.get(next)?.facts ?? []);
      return;
    }
    beginCameraTransition();
    focusedId = next;
    userYaw = 0;
    userPitch = 0;
    if (next) {
      const b = byId.get(next);
      if (b) ui?.showInfo(b.id, b.name, b.facts);
      infoTimer = 0;
    } else {
      ui?.hideInfo();
    }
    applyHighlight();
    for (const cb of focusListeners) cb(focusedId);
  }

  function attachPointer(sec: HTMLElement): void {
    const isUi = (e: Event): boolean =>
      e.target instanceof Element && e.target !== sec && e.target.closest('.ss-block, button, input') !== null;

    const onMove = (e: PointerEvent): void => {
      if (drag && e.pointerId === drag.id) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 5) drag.moved = true;
        if (drag.moved) {
          userYaw -= dx * 0.005;
          userPitch += dy * 0.004;
          userPitch = THREE.MathUtils.clamp(userPitch, -0.6, 0.9);
          drag.x = e.clientX;
          drag.y = e.clientY;
        }
        return;
      }
      if (isUi(e)) {
        pointer = null;
        setHoverPointer(null);
        return;
      }
      pointer = { x: e.clientX, y: e.clientY };
    };
    const onLeave = (): void => {
      pointer = null;
      setHoverPointer(null);
    };
    const onDown = (e: PointerEvent): void => {
      if (isUi(e) || e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    };
    const onUp = (e: PointerEvent): void => {
      if (!drag || e.pointerId !== drag.id) return;
      const wasClick = !drag.moved;
      drag = null;
      if (!wasClick || !active) return;
      const id = pick(e.clientX, e.clientY, e.pointerType === 'touch' ? PICK_TOUCH_PX : PICK_MIN_PX);
      if (id) focus(id);
    };
    const onCancel = (): void => {
      drag = null;
    };
    sec.addEventListener('pointermove', onMove);
    sec.addEventListener('pointerleave', onLeave);
    sec.addEventListener('pointerdown', onDown);
    sec.addEventListener('pointerup', onUp);
    sec.addEventListener('pointercancel', onCancel);
    cleanups.push(() => {
      sec.removeEventListener('pointermove', onMove);
      sec.removeEventListener('pointerleave', onLeave);
      sec.removeEventListener('pointerdown', onDown);
      sec.removeEventListener('pointerup', onUp);
      sec.removeEventListener('pointercancel', onCancel);
      sec.style.cursor = '';
    });
  }

  // --- SectionModule ---------------------------------------------------------------
  const module: SolarSystemSection = {
    id: 'solar-system',
    group,

    async init(c: SceneContext): Promise<void> {
      if (ctx) return;
      ctx = c;
      section =
        options.section ?? document.querySelector<HTMLElement>('section[data-section="solar-system"]');
      const url = options.dataUrl ?? import.meta.env.BASE_URL + 'data/planets.json';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`[solar-system] failed to load ${url}: HTTP ${res.status}`);
      const data = (await res.json()) as SolarSystemData;
      if (disposed) return;

      jd = dateToJulian(new Date()); // Q2: start at the visitor's current date
      playing = !c.reducedMotion; // honour reduced motion: start paused
      build(data, c);
      if (!group.parent) c.scene.add(group);

      if (section) {
        ui = createSolarSystemUi(
          section,
          bodies.map((b) => ({ id: b.id, name: b.name })),
          {
            onPlayToggle: () => setPlaying(!playing),
            onSpeedSlider: (t) => {
              speed = sliderToSpeed(t);
              ui?.setSpeed(t, formatSpeed(speed));
            },
            onResetNow: () => {
              jd = dateToJulian(new Date());
              syncDate();
            },
            onScaleToggle: () => setScaleMode(scaleMode === 'default' ? 'true-distance' : 'default'),
            onSelect: (id) => focus(id),
            onHover: (id) => {
              hoverList = id;
              applyHighlight();
            },
            onClose: () => focus(null),
          },
        );
        ui.setPlaying(playing);
        ui.setSpeed(speedToSlider(speed), formatSpeed(speed));
        ui.setTrueScale(scaleMode === 'true-distance');
        ui.setVisible(active);
        attachPointer(section);
      }

      updateBodies(0, 0);
      updateOrbits(true);
      orbitsDirty = false;
      syncDate();
      applyHighlight();
      // The camera is not touched here: it is taken over (with a smooth
      // transition) only once the section is activated.
    },

    setActive(on: boolean): void {
      if (disposed || on === active) return;
      active = on;
      if (on && ctx && !unsubscribeTick) {
        if (cameraControl) beginCameraTransition(true);
        unsubscribeTick = ctx.onTick((dt) => tick(dt));
      } else if (!on && unsubscribeTick) {
        unsubscribeTick();
        unsubscribeTick = null;
        pointer = null;
        drag = null;
        setHoverPointer(null);
      }
      ui?.setVisible(on);
    },

    setCameraControl(enabled: boolean): void {
      if (enabled && !cameraControl) beginCameraTransition(true);
      cameraControl = enabled;
    },

    focus,
    getFocused: () => focusedId,
    onFocusChange(cb) {
      focusListeners.add(cb);
      return () => focusListeners.delete(cb);
    },
    setScaleMode,
    getScaleMode: () => scaleMode,
    getJulianDate: () => jd,

    dispose(): void {
      if (disposed) return;
      disposed = true;
      active = false;
      unsubscribeTick?.();
      unsubscribeTick = null;
      cleanups.forEach((fn) => fn());
      cleanups.length = 0;
      ui?.dispose();
      ui = null;
      focusListeners.clear();
      // Shared glow texture is referenced by several materials; disposeObjectTree dedupes materials,
      // and Texture.dispose() is idempotent.
      disposeObjectTree(group);
      group.removeFromParent();
      group.clear();
      bodies.length = 0;
      byId.clear();
    },
  };

  return module;
}

/**
 * Standalone wiring used by main.ts until FE-04's scroll orchestration takes
 * over: init (adds the group to the scene), then setActive(true/false) from an
 * IntersectionObserver on the section. Errors are logged, not thrown.
 */
export function mountSolarSystem(ctx: SceneContext, options?: SolarSystemOptions): SolarSystemSection {
  const section = createSolarSystem(options);
  const host =
    options?.section ?? document.querySelector<HTMLElement>('section[data-section="solar-system"]');
  section
    .init(ctx)
    .then(() => {
      // Interim activation until FE-04 (C6) drives setActive from scroll:
      // active while at least half of the section is on screen.
      if (!host || typeof IntersectionObserver === 'undefined') {
        section.setActive(true);
        return;
      }
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) section.setActive(e.intersectionRatio >= 0.5);
        },
        { threshold: [0, 0.5, 1] },
      );
      io.observe(host);
      const dispose = section.dispose.bind(section);
      section.dispose = () => {
        io.disconnect();
        dispose();
      };
    })
    .catch((err: unknown) => console.error('[solar-system] init failed', err));
  return section;
}

/** Scale presets used by the toggle (re-exported for FE-04 / tests). */
export const SOLAR_SCALES: Readonly<Record<ScaleMode, ScaleConfig>> = Object.freeze({
  default: DEFAULT_SCALE,
  'true-distance': TRUE_DISTANCE_SCALE,
});
