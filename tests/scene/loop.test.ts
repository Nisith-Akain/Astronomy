import { describe, expect, it } from 'vitest';
import { createLoop, MAX_DT, type LoopDeps } from '../../src/scene/loop';

function harness() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  const state = { hidden: false, delta: 0.016, renders: 0 };
  const deps: LoopDeps = {
    requestFrame: (cb) => {
      const id = nextId++;
      pending.set(id, () => cb(0));
      return id;
    },
    cancelFrame: (id) => {
      pending.delete(id);
    },
    isHidden: () => state.hidden,
    getDelta: () => state.delta,
    render: () => {
      state.renders++;
    },
  };
  const step = (): void => {
    const frames = [...pending.entries()];
    pending.clear();
    for (const [, fn] of frames) fn();
  };
  return { deps, state, step, pending };
}

describe('FE-01 render loop', () => {
  it('runs a single RAF chain, calls subscribers with dt/elapsed and renders', () => {
    const h = harness();
    const loop = createLoop(h.deps);
    const calls: [number, number][] = [];
    loop.onTick((dt, el) => calls.push([dt, el]));
    loop.start();
    loop.start(); // idempotent: still one chain
    expect(h.pending.size).toBe(1);
    h.step();
    h.step();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[0]).toBeCloseTo(0.016);
    expect(calls[1]?.[1]).toBeCloseTo(0.032);
    expect(h.state.renders).toBe(2);
    expect(h.pending.size).toBe(1);
  });

  it('unsubscribe stops callbacks (also when called during a tick)', () => {
    const h = harness();
    const loop = createLoop(h.deps);
    let a = 0;
    let b = 0;
    const offA = loop.onTick(() => {
      a++;
      offA();
    });
    const offB = loop.onTick(() => b++);
    loop.start();
    h.step();
    h.step();
    offB();
    h.step();
    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  it('clamps dt', () => {
    const h = harness();
    const loop = createLoop(h.deps);
    let seen = 0;
    loop.onTick((dt) => (seen = dt));
    loop.start();
    h.state.delta = 5;
    h.step();
    expect(seen).toBe(MAX_DT);
  });

  it('pauses while document is hidden and resumes without a time jump', () => {
    const h = harness();
    const loop = createLoop(h.deps);
    let ticks = 0;
    loop.onTick(() => ticks++);
    loop.start();
    h.step();
    h.state.hidden = true;
    loop.handleVisibilityChange();
    expect(h.pending.size).toBe(0);
    expect(loop.running).toBe(false);
    h.step();
    expect(ticks).toBe(1);
    const elapsedBefore = loop.elapsed;
    h.state.hidden = false;
    loop.handleVisibilityChange();
    loop.handleVisibilityChange(); // no duplicate chain
    expect(h.pending.size).toBe(1);
    h.step();
    expect(ticks).toBe(2);
    expect(loop.elapsed - elapsedBefore).toBeLessThanOrEqual(MAX_DT);
  });

  it('keeps running if a subscriber throws', () => {
    const h = harness();
    const loop = createLoop(h.deps);
    loop.onTick(() => {
      throw new Error('boom');
    });
    loop.start();
    expect(() => h.step()).toThrow('boom');
    expect(h.pending.size).toBe(1);
  });

  it('stop cancels the frame and clears subscribers', () => {
    const h = harness();
    const loop = createLoop(h.deps);
    let ticks = 0;
    loop.onTick(() => ticks++);
    loop.start();
    loop.stop();
    expect(h.pending.size).toBe(0);
    h.step();
    expect(ticks).toBe(0);
  });
});
