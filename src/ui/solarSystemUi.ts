// FE-03: DOM overlay for the solar-system section: time controls, scale
// toggle, keyboard-accessible body list, hover label and info panel.
// Pure DOM; no three.js. The scene module drives it via the returned API.
import '../styles/solar-system.css';

export interface UiBody {
  id: string;
  name: string;
}

export interface SolarSystemUiCallbacks {
  onPlayToggle(): void;
  onSpeedSlider(t01: number): void;
  onResetNow(): void;
  onScaleToggle(): void;
  onSelect(id: string): void;
  onHover(id: string | null): void;
  onClose(): void;
}

export interface SolarSystemUi {
  root: HTMLElement;
  setPlaying(playing: boolean): void;
  setSpeed(slider01: number, label: string): void;
  setDate(text: string, outsideValidRange: boolean): void;
  setTrueScale(on: boolean): void;
  setHovered(id: string | null): void;
  /** Screen-space label (viewport CSS px); pass null to hide. */
  setLabel(text: string | null, x?: number, y?: number): void;
  showInfo(id: string, name: string, facts: readonly string[]): void;
  setInfoDetail(text: string): void;
  hideInfo(): void;
  setVisible(visible: boolean): void;
  setStatus(text: string): void;
  dispose(): void;
}

const SLIDER_STEPS = 1000;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v !== undefined) node.setAttribute(k, v);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createSolarSystemUi(
  section: HTMLElement,
  bodies: readonly UiBody[],
  cb: SolarSystemUiCallbacks,
): SolarSystemUi {
  const root = el('div', { class: 'ss-ui' });

  // --- heading (for screen readers / section context) ----------------------
  const heading = el('h2', { class: 'ss-title' }, 'The Solar System');
  const hint = el(
    'p',
    { class: 'ss-hint' },
    'Hover a planet to identify it, click it (or use the list) to focus. Esc returns to the overview.',
  );

  // --- body list ------------------------------------------------------------
  const nav = el('nav', { class: 'ss-block ss-list', 'aria-label': 'Solar system bodies' });
  const ul = el('ul');
  const buttons = new Map<string, HTMLButtonElement>();
  for (const b of bodies) {
    const li = el('li');
    const btn = el('button', { type: 'button', 'data-body': b.id }, b.name);
    btn.addEventListener('click', () => cb.onSelect(b.id));
    btn.addEventListener('mouseenter', () => cb.onHover(b.id));
    btn.addEventListener('mouseleave', () => cb.onHover(null));
    // Keyboard focus previews the body (label + highlight); focus restored
    // after a mouse interaction (not :focus-visible) does not.
    btn.addEventListener('focus', () => {
      if (btn.matches(':focus-visible')) cb.onHover(b.id);
    });
    btn.addEventListener('blur', () => cb.onHover(null));
    buttons.set(b.id, btn);
    li.append(btn);
    ul.append(li);
  }
  nav.append(ul);

  // --- time + scale controls -------------------------------------------------
  const controls = el('div', { class: 'ss-block ss-controls', role: 'group', 'aria-label': 'Simulation controls' });
  const playBtn = el('button', { type: 'button', class: 'ss-play', 'aria-pressed': 'true' }, 'Pause');
  playBtn.addEventListener('click', () => cb.onPlayToggle());

  const speedId = 'ss-speed';
  const speedLabel = el('label', { for: speedId }, 'Speed');
  const speed = el('input', {
    id: speedId,
    type: 'range',
    min: '0',
    max: String(SLIDER_STEPS),
    step: '1',
  });
  const speedOut = el('output', { for: speedId, class: 'ss-speed-out' });
  speed.addEventListener('input', () => cb.onSpeedSlider(Number(speed.value) / SLIDER_STEPS));

  const dateWrap = el('div', { class: 'ss-date' });
  const dateLabel = el('span', { class: 'ss-date-label' }, 'Simulated date');
  const dateOut = el('output', { class: 'ss-date-out' });
  const dateWarn = el('span', { class: 'ss-date-warn', hidden: '' }, 'approximate (elements valid 1800-2050)');
  dateWrap.append(dateLabel, dateOut, dateWarn);

  const nowBtn = el('button', { type: 'button' }, 'Reset to now');
  nowBtn.addEventListener('click', () => cb.onResetNow());

  const scaleBtn = el('button', { type: 'button', class: 'ss-scale', 'aria-pressed': 'false' }, 'True distance');
  scaleBtn.addEventListener('click', () => cb.onScaleToggle());

  const speedWrap = el('div', { class: 'ss-speed' });
  speedWrap.append(speedLabel, speed, speedOut);
  controls.append(playBtn, speedWrap, dateWrap, nowBtn, scaleBtn);

  // --- info panel -------------------------------------------------------------
  const info = el('aside', {
    class: 'ss-block ss-info',
    'aria-labelledby': 'ss-info-title',
    hidden: '',
  });
  const infoTitle = el('h3', { id: 'ss-info-title', tabindex: '-1' });
  const infoDetail = el('p', { class: 'ss-info-detail' });
  const infoFacts = el('ul', { class: 'ss-info-facts' });
  const closeBtn = el('button', { type: 'button', class: 'ss-close', 'aria-label': 'Close and return to overview' }, 'Close');
  closeBtn.addEventListener('click', () => cb.onClose());
  info.append(closeBtn, infoTitle, infoDetail, infoFacts);

  const status = el('p', { class: 'ss-status', role: 'status' });

  // Label follows the hovered body in viewport coordinates.
  const label = el('div', { class: 'ss-label', 'aria-hidden': 'true', hidden: '' });

  root.append(heading, hint, nav, controls, info, status, label);
  section.append(root);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !info.hidden) {
      e.preventDefault();
      cb.onClose();
    }
  };
  document.addEventListener('keydown', onKey);

  let lastDate = '';
  let lastWarn: boolean | null = null;
  let lastLabel = '';
  let returnFocusTo: HTMLElement | null = null;

  return {
    root,
    setPlaying(playing) {
      playBtn.textContent = playing ? 'Pause' : 'Play';
      playBtn.setAttribute('aria-pressed', String(playing));
    },
    setSpeed(slider01, text) {
      speed.value = String(Math.round(slider01 * SLIDER_STEPS));
      speed.setAttribute('aria-valuetext', text);
      speedOut.textContent = text;
    },
    setDate(text, outside) {
      if (text !== lastDate) {
        dateOut.textContent = text;
        lastDate = text;
      }
      if (outside !== lastWarn) {
        dateWarn.hidden = !outside;
        lastWarn = outside;
      }
    },
    setTrueScale(on) {
      scaleBtn.setAttribute('aria-pressed', String(on));
    },
    setHovered(id) {
      for (const [bid, btn] of buttons) btn.classList.toggle('is-hovered', bid === id);
    },
    setLabel(text, x = 0, y = 0) {
      if (text === null) {
        if (!label.hidden) label.hidden = true;
        return;
      }
      if (text !== lastLabel) {
        label.textContent = text;
        lastLabel = text;
      }
      label.hidden = false;
      // (x, y) is the anchor point; the label sits centred above it.
      label.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    },
    showInfo(id, name, facts) {
      const active = document.activeElement;
      if (info.hidden && active instanceof HTMLElement && root.contains(active)) returnFocusTo = active;
      else if (info.hidden) returnFocusTo = buttons.get(id) ?? null;
      infoTitle.textContent = name;
      infoFacts.replaceChildren(...facts.map((f) => el('li', {}, f)));
      infoDetail.textContent = '';
      info.hidden = false;
      info.dataset.body = id;
      for (const [bid, btn] of buttons) {
        if (bid === id) btn.setAttribute('aria-current', 'true');
        else btn.removeAttribute('aria-current');
      }
      infoTitle.focus({ preventScroll: true });
    },
    setInfoDetail(text) {
      if (infoDetail.textContent !== text) infoDetail.textContent = text;
    },
    hideInfo() {
      if (info.hidden) return;
      const hadFocus = info.contains(document.activeElement);
      info.hidden = true;
      delete info.dataset.body;
      for (const btn of buttons.values()) btn.removeAttribute('aria-current');
      if (hadFocus && returnFocusTo?.isConnected) returnFocusTo.focus({ preventScroll: true });
      returnFocusTo = null;
    },
    setVisible(visible) {
      root.classList.toggle('is-inactive', !visible);
      if (!visible) label.hidden = true;
    },
    setStatus(text) {
      status.textContent = text;
    },
    dispose() {
      document.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
