import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import {
  PATH_REMAP,
  SECTION_IDS,
  computeRanges,
  dampStep,
  globalParam,
  nearestShot,
  rangeProgress,
  scrollToPath,
  windowOpacity,
  type SectionBox,
} from '../../src/scene/scrollMath';
import {
  PROBE_DIRECTION,
  PROBE_DRIFT,
  PROBE_START,
  SHOTS,
  SOLAR_OVERVIEW_POSITION,
  SOLAR_OVERVIEW_TARGET,
  STATIONS,
  buildKeyframes,
  createFlightPath,
  probePosition,
  probeQuaternion,
} from '../../src/scene/flightPath';
import { heroCameraView } from '../../src/scene/hero';
import { sectionActivity, solarShouldControl, type ControlInput } from '../../src/scene/flight';

const root = resolve(__dirname, '../..');
const VH = 800;
// Page as built: hero 100vh, solar 100vh, probe 300vh, outro 100vh.
const boxes: SectionBox[] = [
  { id: 'hero', top: 0, height: VH },
  { id: 'solar-system', top: VH, height: VH },
  { id: 'probe', top: 2 * VH, height: 3 * VH },
  { id: 'outro', top: 5 * VH, height: VH },
];
const DOC_H = 6 * VH;
const ranges = computeRanges(boxes, VH, DOC_H);
const centre = (scrollY: number): number => scrollY + VH / 2;

describe('FE-04 C6 scroll progress', () => {
  it('ranges are contiguous and cover the reachable scroll', () => {
    expect(ranges.map((r) => r.id)).toEqual([...SECTION_IDS]);
    expect(ranges[0]!.start).toBe(VH / 2);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]!.start).toBe(ranges[i - 1]!.end);
    expect(ranges[3]!.end).toBe(DOC_H - VH / 2);
  });

  it('rest views: hero 0 at top, solar 0.5 when filling the viewport, outro 1 at bottom', () => {
    expect(rangeProgress(ranges[0]!, centre(0))).toBe(0);
    expect(globalParam(ranges, centre(0))).toBe(0);
    expect(rangeProgress(ranges[1]!, centre(VH))).toBeCloseTo(0.5, 12);
    expect(globalParam(ranges, centre(VH))).toBeCloseTo(1.5, 12);
    expect(rangeProgress(ranges[3]!, centre(DOC_H - VH))).toBe(1);
    expect(globalParam(ranges, centre(DOC_H - VH))).toBe(4);
  });

  it('global parameter is continuous and monotonic over the whole page', () => {
    let prev = -1;
    for (let y = 0; y <= DOC_H - VH; y += 1) {
      const g = globalParam(ranges, centre(y));
      expect(g).toBeGreaterThanOrEqual(prev);
      if (prev >= 0) expect(g - prev).toBeLessThan(0.01); // no jumps at section borders
      prev = g;
    }
  });

  it('degenerate layouts do not produce NaN', () => {
    const r = computeRanges(boxes.map((b) => ({ ...b, height: 0, top: 0 })), VH, VH);
    for (const range of r) expect(Number.isFinite(rangeProgress(range, 400))).toBe(true);
    expect(Number.isFinite(globalParam(r, 400))).toBe(true);
    expect(globalParam([], 0)).toBe(0);
  });
});

describe('FE-04 scroll -> path remap, damping, shots', () => {
  it('remap is monotonic, hits stations and holds around them', () => {
    let prev = -Infinity;
    for (let g = 0; g <= 4; g += 0.001) {
      const p = scrollToPath(g);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
    expect(scrollToPath(0)).toBe(STATIONS.hero);
    expect(scrollToPath(1.4)).toBe(STATIONS.solar);
    expect(scrollToPath(1.5)).toBe(STATIONS.solar);
    expect(scrollToPath(1.6)).toBe(STATIONS.solar);
    expect(scrollToPath(3.9)).toBe(STATIONS.outro);
    expect(PATH_REMAP[PATH_REMAP.length - 1]).toEqual([4, 4]);
  });

  it('damping converges, never overshoots and is speed-capped (fast scroll / End key)', () => {
    let p = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 600; i++) {
      const next = dampStep(p, 4, dt);
      expect(next).toBeGreaterThanOrEqual(p);
      expect(next).toBeLessThanOrEqual(4);
      expect(next - p).toBeLessThanOrEqual(1.5 * dt + 1e-12);
      p = next;
    }
    expect(p).toBe(4);
    expect(dampStep(1, 1.0001, dt)).toBe(1.0001); // snaps inside epsilon
    expect(dampStep(1, 2, 0)).toBe(1);
  });

  it('damping is frame-rate independent for small moves', () => {
    const run = (dt: number): number => {
      let p = 0;
      for (let t = 0; t < 0.25 - 1e-9; t += dt) p = dampStep(p, 0.2, dt);
      return p;
    };
    expect(Math.abs(run(1 / 30) - run(1 / 144))).toBeLessThan(0.01);
  });

  it('trackpad jitter around a target is attenuated', () => {
    let p = 1.5;
    let maxDev = 0;
    for (let i = 0; i < 240; i++) {
      p = dampStep(p, 1.5 + (i % 2 ? 0.02 : -0.02), 1 / 120);
      maxDev = Math.max(maxDev, Math.abs(p - 1.5));
    }
    expect(maxDev).toBeLessThan(0.005);
  });

  it('reduced motion picks the nearest shot; stations are shots', () => {
    expect(SHOTS).toContain(STATIONS.hero);
    expect(SHOTS).toContain(STATIONS.solar);
    expect(SHOTS).toContain(STATIONS.outro);
    expect(nearestShot(SHOTS, 0.2)).toBe(0);
    expect(nearestShot(SHOTS, 1.2)).toBe(1.5);
    expect(nearestShot(SHOTS, 3.9)).toBe(4);
  });

  it('caption windows fade in and out', () => {
    expect(windowOpacity(0.0, 0.04, 0.32)).toBe(0);
    expect(windowOpacity(0.2, 0.04, 0.32)).toBe(1);
    expect(windowOpacity(0.07, 0.04, 0.32)).toBeCloseTo(0.5, 6);
    expect(windowOpacity(0.5, 0.04, 0.32)).toBe(0);
  });
});

describe('FE-04 camera path', () => {
  const path = createFlightPath();

  it('hits the hero and solar-overview keyframes exactly', () => {
    const hero = heroCameraView();
    const a = path.poseAt(STATIONS.hero);
    expect(a.position.distanceTo(hero.position)).toBeLessThan(1e-6);
    expect(a.target.distanceTo(hero.target)).toBeLessThan(1e-6);
    const s = path.poseAt(STATIONS.solar);
    expect(s.position.distanceTo(SOLAR_OVERVIEW_POSITION)).toBeLessThan(1e-6);
    expect(s.target.distanceTo(SOLAR_OVERVIEW_TARGET)).toBeLessThan(1e-6);
  });

  it('solar overview matches FE-03 (target (0,0,30), 640 u, 0.63 rad up)', () => {
    const off = SOLAR_OVERVIEW_POSITION.clone().sub(SOLAR_OVERVIEW_TARGET);
    expect(off.length()).toBeCloseTo(640, 6);
    expect(Math.asin(off.y / off.length())).toBeCloseTo(0.63, 6);
  });

  it('is continuous, finite and never looks straight up/down (no lookAt flip)', () => {
    const prev = path.poseAt(0);
    const cur = { position: new THREE.Vector3(), target: new THREE.Vector3() };
    const step = 0.0005;
    let maxJump = 0;
    for (let p = step; p <= 4 + 1e-9; p += step) {
      path.poseAt(p, cur);
      for (const v of [cur.position, cur.target]) {
        expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
      }
      const dir = cur.target.clone().sub(cur.position);
      expect(dir.length()).toBeGreaterThan(1);
      const vertical = Math.abs(dir.normalize().y);
      expect(vertical).toBeLessThan(Math.cos(THREE.MathUtils.degToRad(10)));
      maxJump = Math.max(maxJump, cur.position.distanceTo(prev.position));
      prev.position.copy(cur.position);
      prev.target.copy(cur.target);
    }
    // Worst per-step move is the long galaxy -> Sun leg; must still be smooth.
    expect(maxJump).toBeLessThan(15);
  });

  it('stays clear of the Sun and of the probe', () => {
    for (let p = 0; p <= 4; p += 0.001) {
      const pose = path.poseAt(p);
      expect(pose.position.length()).toBeGreaterThan(40); // Sun display radius ~10 u
      const probe = probePosition(Math.min(1, Math.max(0, p - 2)));
      expect(pose.position.distanceTo(probe)).toBeGreaterThan(10); // model spans ~7.2 m
    }
  });

  it('flies alongside the probe during the probe section', () => {
    for (let p = 2.08; p <= 2.95; p += 0.01) {
      const pose = path.poseAt(p);
      const probe = probePosition(p - 2);
      expect(pose.position.distanceTo(probe)).toBeLessThan(40);
      expect(pose.target.distanceTo(probe)).toBeLessThan(3);
    }
  });

  it('outro pulls far back from the probe and looks away from the Sun', () => {
    const pose = path.poseAt(STATIONS.outro);
    expect(pose.position.distanceTo(probePosition(1))).toBeGreaterThan(250);
    const look = pose.target.clone().sub(pose.position).normalize();
    const toSun = pose.position.clone().negate().normalize();
    expect(look.dot(toSun)).toBeLessThan(-0.8);
  });

  it('rejects bad keyframes', () => {
    const k = buildKeyframes();
    expect(() => createFlightPath([k[0]!])).toThrow(RangeError);
    expect(() => createFlightPath([k[1]!, k[0]!])).toThrow(RangeError);
  });

  it('probe drifts forward along -Z of its model frame, beyond Neptune', () => {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(probeQuaternion());
    expect(fwd.distanceTo(PROBE_DIRECTION)).toBeLessThan(1e-6);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(probeQuaternion());
    expect(up.y).toBeGreaterThan(0.99); // no roll
    expect(probePosition(1).distanceTo(probePosition(0))).toBeCloseTo(PROBE_DRIFT, 6);
    expect(probePosition(-1).equals(PROBE_START)).toBe(true);
    expect(PROBE_START.length()).toBeGreaterThan(300);
    // Moving away from the Sun.
    expect(probePosition(1).length()).toBeGreaterThan(probePosition(0).length());
  });
});

describe('FE-04 section activation and camera ownership', () => {
  it('only the sections near the camera are active', () => {
    expect(sectionActivity(0, false)).toEqual({ hero: true, 'solar-system': false, probe: false, outro: false });
    expect(sectionActivity(1.5, false)).toEqual({ hero: false, 'solar-system': true, probe: false, outro: false });
    expect(sectionActivity(2.5, false)).toEqual({ hero: false, 'solar-system': false, probe: true, outro: false });
    expect(sectionActivity(4, false)).toEqual({ hero: false, 'solar-system': false, probe: true, outro: true });
    expect(sectionActivity(3, true)['solar-system']).toBe(true);
  });

  const base: ControlInput = {
    solarReady: true,
    solarActive: true,
    focused: false,
    global: 1.5,
    pTarget: 1.5,
    pCam: 1.5,
    fading: false,
  };

  it('FE-03 gets the camera only when resting at the overview, or while a planet is focused', () => {
    expect(solarShouldControl(base)).toBe(true);
    expect(solarShouldControl({ ...base, pCam: 1.45 })).toBe(false); // still flying in
    expect(solarShouldControl({ ...base, pTarget: 1.7, global: 1.8 })).toBe(false); // scrolled on
    expect(solarShouldControl({ ...base, solarReady: false })).toBe(false);
    expect(solarShouldControl({ ...base, fading: true })).toBe(false);
    // Focused: keeps control across the whole solar section, even mid-scroll.
    expect(solarShouldControl({ ...base, focused: true, global: 1.9, pTarget: 1.8, pCam: 1.7 })).toBe(true);
    expect(solarShouldControl({ ...base, focused: true, global: 2.2, pTarget: 2.2 })).toBe(false);
  });
});

describe('FE-04 page content', () => {
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');

  it('outro shows the CREDITS.md credit line verbatim', () => {
    const md = readFileSync(resolve(root, 'public/textures/CREDITS.md'), 'utf8');
    const m = /Suggested on-page credit line[^\n]*\n"([^"]+)"/.exec(md);
    expect(m).not.toBeNull();
    const line = m![1]!;
    const credit = /<p class="credit-line"[^>]*>([\s\S]*?)<\/p>/.exec(html);
    expect(credit).not.toBeNull();
    const text = credit![1]!.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    expect(text).toBe(line);
  });

  it('probe section has 2-3 captions with valid progress windows', () => {
    const shows = [...html.matchAll(/class="probe-caption" data-show="([\d.]+) ([\d.]+)"/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    expect(shows.length).toBeGreaterThanOrEqual(2);
    expect(shows.length).toBeLessThanOrEqual(3);
    let prevEnd = 0;
    for (const [from, to] of shows) {
      expect(from).toBeGreaterThanOrEqual(prevEnd);
      expect(to).toBeGreaterThan(from!);
      expect(to).toBeLessThanOrEqual(1);
      prevEnd = to!;
    }
  });
});
