// FE-04: outro section (SectionModule id "outro"). The "pull back to the
// starfield" is pure camera work (flightPath.ts), so the 3D group is empty;
// the module only toggles the credits panel's reveal class. Credits markup is
// static HTML in index.html (`#outro`), styled by src/styles/outro.css.
import * as THREE from 'three';
import type { SceneContext, SectionModule } from './core';
import '../styles/outro.css';

export interface OutroSection extends SectionModule {
  id: 'outro';
  isActive(): boolean;
}

export function createOutro(opts: { section?: HTMLElement } = {}): OutroSection {
  const group = new THREE.Group();
  group.name = 'outro';
  let host: HTMLElement | null = null;
  let active = false;
  let ready = false;

  return {
    id: 'outro',
    group,
    async init(c: SceneContext): Promise<void> {
      if (ready) return;
      ready = true;
      c.scene.add(group);
      host = opts.section ?? document.querySelector<HTMLElement>('section[data-section="outro"]');
    },
    setActive(on: boolean): void {
      if (!ready || on === active) return;
      active = on;
      host?.classList.toggle('is-active', on);
    },
    isActive: () => active,
    dispose(): void {
      active = false;
      host?.classList.remove('is-active');
      group.removeFromParent();
    },
  };
}
