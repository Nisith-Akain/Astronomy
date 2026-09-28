import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { SceneContext } from '../../src/scene/core';
import {
  DEFAULT_GALAXY_COUNT,
  DEFAULT_GALAXY_RADIUS,
  HERO_ANCHOR,
  createHero,
  generateGalaxy,
  heroCameraView,
} from '../../src/scene/hero';

/** Minimal SceneContext stub: a real Scene/Camera, a fake loop. */
function stubCtx(): SceneContext & { tick(dt: number): void; subs: number } {
  const cbs = new Set<(dt: number, elapsed: number) => void>();
  let elapsed = 0;
  const ctx = {
    renderer: { getPixelRatio: () => 1.5 } as unknown as THREE.WebGLRenderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(55, 1.6, 0.1, 20000),
    clock: {} as THREE.Clock,
    loadingManager: new THREE.LoadingManager(),
    reducedMotion: false,
    onTick(cb: (dt: number, elapsed: number) => void) {
      cbs.add(cb);
      return () => cbs.delete(cb);
    },
    dispose() {},
    tick(dt: number) {
      elapsed += dt;
      [...cbs].forEach((cb) => cb(dt, elapsed));
    },
    get subs() {
      return cbs.size;
    },
  };
  return ctx;
}

describe('FE-02 galaxy data', () => {
  const data = generateGalaxy({ seed: 3 });

  it('has >= 50,000 finite particles', () => {
    expect(DEFAULT_GALAXY_COUNT).toBeGreaterThanOrEqual(50_000);
    expect(data.positions.length).toBe(DEFAULT_GALAXY_COUNT * 3);
    expect(data.colors.length).toBe(DEFAULT_GALAXY_COUNT * 3);
    expect(data.sizes.length).toBe(DEFAULT_GALAXY_COUNT);
    expect(data.positions.every(Number.isFinite)).toBe(true);
    expect(data.colors.every((c) => Number.isFinite(c) && c >= 0 && c <= 1)).toBe(true);
    expect(data.sizes.every((s) => s > 0)).toBe(true);
  });

  it('is a thin disc of the requested radius', () => {
    let maxAbsY = 0;
    let inside = 0;
    for (let i = 0; i < DEFAULT_GALAXY_COUNT; i++) {
      const x = data.positions[i * 3]!;
      const y = data.positions[i * 3 + 1]!;
      const z = data.positions[i * 3 + 2]!;
      maxAbsY = Math.max(maxAbsY, Math.abs(y));
      if (Math.hypot(x, z) <= DEFAULT_GALAXY_RADIUS * 1.3) inside++;
    }
    expect(inside / DEFAULT_GALAXY_COUNT).toBeGreaterThan(0.999);
    expect(maxAbsY).toBeLessThan(DEFAULT_GALAXY_RADIUS * 0.4);
  });

  it('has a warm core and a blue edge', () => {
    const avg = (lo: number, hi: number): [number, number] => {
      let r = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < DEFAULT_GALAXY_COUNT; i++) {
        const d = Math.hypot(data.positions[i * 3]!, data.positions[i * 3 + 2]!) / DEFAULT_GALAXY_RADIUS;
        if (d < lo || d >= hi) continue;
        r += data.colors[i * 3]!;
        b += data.colors[i * 3 + 2]!;
        n++;
      }
      return [r / n, b / n];
    };
    const [coreR, coreB] = avg(0, 0.1);
    const [edgeR, edgeB] = avg(0.7, 1.0);
    expect(coreR).toBeGreaterThan(coreB * 1.5);
    expect(edgeB).toBeGreaterThan(edgeR);
  });

  it('arm count is configurable: particles cluster around N spiral arms', () => {
    // Compare angular structure with the spiral winding removed.
    const armPower = (arms: number, probe: number): number => {
      const g = generateGalaxy({ count: 20_000, arms, bulgeFraction: 0, seed: 5 });
      let re = 0;
      let im = 0;
      for (let i = 0; i < 20_000; i++) {
        const x = g.positions[i * 3]!;
        const z = g.positions[i * 3 + 2]!;
        const t = Math.hypot(x, z) / DEFAULT_GALAXY_RADIUS;
        const unwound = Math.atan2(z, x) - t * 5;
        re += Math.cos(probe * unwound);
        im += Math.sin(probe * unwound);
      }
      return Math.hypot(re, im) / 20_000;
    };
    expect(armPower(2, 2)).toBeGreaterThan(0.3);
    expect(armPower(3, 3)).toBeGreaterThan(0.3);
    expect(armPower(3, 2)).toBeLessThan(0.1);
    expect(armPower(5, 5)).toBeGreaterThan(0.3);
  });

  it('is deterministic and validates input', () => {
    const a = generateGalaxy({ count: 500, seed: 9 });
    const b = generateGalaxy({ count: 500, seed: 9 });
    expect([...a.positions]).toEqual([...b.positions]);
    expect(() => generateGalaxy({ arms: 0 })).toThrow(RangeError);
    expect(() => generateGalaxy({ count: 1.5 })).toThrow(RangeError);
  });
});

describe('FE-02 hero SectionModule', () => {
  it('has id "hero", adds its group on init and claims the camera', async () => {
    const ctx = stubCtx();
    const hero = createHero({ count: 1000 });
    expect(hero.id).toBe('hero');
    await hero.init(ctx);
    expect(ctx.scene.children).toContain(hero.group);
    expect(hero.group.position.equals(HERO_ANCHOR)).toBe(true);
    expect(ctx.camera.position.equals(heroCameraView().position)).toBe(true);
    expect(hero.isActive()).toBe(true);
    expect(ctx.subs).toBe(1);
    hero.dispose();
  });

  it('animates via uniforms only (no per-frame buffer updates)', async () => {
    const ctx = stubCtx();
    const hero = createHero({ count: 1000, claimCamera: false });
    await hero.init(ctx);
    const geo = hero.points.geometry;
    const versions = Object.values(geo.attributes).map((a) => (a as THREE.BufferAttribute).version);
    for (let i = 0; i < 10; i++) ctx.tick(0.016);
    expect(Object.values(geo.attributes).map((a) => (a as THREE.BufferAttribute).version)).toEqual(versions);
    expect(hero.galaxyMaterial.uniforms.uTime!.value).toBeCloseTo(0.16, 6);
    expect(hero.nebulaMaterial.uniforms.uTime!.value).toBeCloseTo(0.16, 6);
    expect(hero.galaxyMaterial.uniforms.uPixelRatio!.value).toBe(1.5);
    expect(ctx.camera.position.equals(new THREE.Vector3())).toBe(true);
    hero.dispose();
  });

  it('setActive(false) stops per-frame work and hides the group; resumes without a jump', async () => {
    const ctx = stubCtx();
    const hero = createHero({ count: 1000 });
    await hero.init(ctx);
    ctx.tick(0.05);
    hero.setActive(false);
    expect(ctx.subs).toBe(0);
    expect(hero.group.visible).toBe(false);
    for (let i = 0; i < 100; i++) ctx.tick(0.1);
    expect(hero.galaxyMaterial.uniforms.uTime!.value).toBeCloseTo(0.05, 6);
    hero.setActive(true);
    hero.setActive(true); // idempotent: no double subscription
    expect(ctx.subs).toBe(1);
    expect(hero.group.visible).toBe(true);
    ctx.tick(0.05);
    expect(hero.galaxyMaterial.uniforms.uTime!.value).toBeCloseTo(0.1, 6);
    hero.dispose();
    expect(ctx.subs).toBe(0);
    expect(ctx.scene.children).not.toContain(hero.group);
  });

  it('freezes animation while reducedMotion (read live per frame)', async () => {
    const ctx = stubCtx();
    const hero = createHero({ count: 1000 });
    await hero.init(ctx);
    ctx.tick(0.1);
    ctx.reducedMotion = true;
    ctx.tick(0.1);
    ctx.tick(0.1);
    expect(hero.galaxyMaterial.uniforms.uTime!.value).toBeCloseTo(0.1, 6);
    ctx.reducedMotion = false;
    ctx.tick(0.1);
    expect(hero.galaxyMaterial.uniforms.uTime!.value).toBeCloseTo(0.2, 6);
    hero.dispose();
  });

  it('nebula sits behind the galaxy and faces the hero camera', async () => {
    const ctx = stubCtx();
    const hero = createHero({ count: 10 });
    await hero.init(ctx);
    ctx.scene.updateMatrixWorld(true);
    const cam = heroCameraView().position;
    const nebulaPos = hero.nebula.getWorldPosition(new THREE.Vector3());
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(hero.nebula.getWorldQuaternion(new THREE.Quaternion()));
    const toCam = cam.clone().sub(nebulaPos).normalize();
    expect(normal.dot(toCam)).toBeGreaterThan(0.99); // front face towards the camera
    expect(cam.distanceTo(nebulaPos)).toBeGreaterThan(cam.distanceTo(HERO_ANCHOR));
    hero.dispose();
  });

  it('uses additive blending, no depth writes, nebula drawn before the galaxy', () => {
    const hero = createHero({ count: 10 });
    expect(hero.galaxyMaterial.blending).toBe(THREE.AdditiveBlending);
    expect(hero.galaxyMaterial.depthWrite).toBe(false);
    expect(hero.nebulaMaterial.blending).toBe(THREE.AdditiveBlending);
    expect(hero.nebula.renderOrder).toBeLessThan(hero.points.renderOrder);
    expect(hero.galaxyMaterial.fragmentShader).toContain('#include <colorspace_fragment>');
    hero.dispose();
  });
});
