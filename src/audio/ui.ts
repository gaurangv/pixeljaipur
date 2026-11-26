/**
 * Sound button + "listen" toggle (pixel-styled HTML in ctx.overlay, no draw calls).
 * Listen mode puts `pj-listen` on <body>; audio.css hides pins, card, panels and credits.
 * Escape leaves listen mode.
 */

export const LISTEN_CLASS = 'pj-listen';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Pixel icons on a 12x12 grid: [x, y, w, h] rects. */
const SPEAKER: number[][] = [
  [1, 4, 2, 4],
  [3, 3, 1, 6],
  [4, 2, 1, 8],
  [5, 1, 1, 10],
];
const WAVES: number[][] = [
  [7, 5, 1, 2],
  [8, 4, 1, 1],
  [8, 7, 1, 1],
  [9, 2, 1, 2],
  [10, 4, 1, 4],
  [9, 8, 1, 2],
];
const CROSS: number[][] = [
  [7, 4, 1, 1],
  [8, 5, 1, 1],
  [9, 6, 1, 1],
  [10, 7, 1, 1],
  [10, 4, 1, 1],
  [9, 5, 1, 1],
  [8, 6, 1, 1],
  [7, 7, 1, 1],
];
/** Headphones. */
const EARS: number[][] = [
  [3, 2, 6, 1],
  [2, 3, 1, 2],
  [9, 3, 1, 2],
  [1, 5, 1, 4],
  [10, 5, 1, 4],
  [2, 6, 2, 4],
  [8, 6, 2, 4],
];

function icon(groups: Array<{ cls: string; rects: number[][] }>): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('shape-rendering', 'crispEdges');
  for (const g of groups) {
    const el = document.createElementNS(SVG_NS, 'g');
    el.setAttribute('class', g.cls);
    for (const [x, y, w, h] of g.rects) {
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', String(x));
      r.setAttribute('y', String(y));
      r.setAttribute('width', String(w));
      r.setAttribute('height', String(h));
      el.appendChild(r);
    }
    svg.appendChild(el);
  }
  return svg;
}

export interface SoundUiHandlers {
  /** User toggled sound (inside the click gesture). */
  onSound(on: boolean): void;
  /** Listen mode changed. */
  onListen?(on: boolean): void;
}

export class SoundUi {
  readonly root: HTMLDivElement;
  private readonly soundBtn: HTMLButtonElement;
  private readonly listenBtn: HTMLButtonElement;
  private soundOn = false;
  private listening = false;
  private readonly onKey: (e: KeyboardEvent) => void;

  constructor(
    parent: HTMLElement,
    private readonly h: SoundUiHandlers,
    initialOn: boolean,
  ) {
    const root = (this.root = document.createElement('div'));
    root.className = 'pj-sound';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Sound');

    const sound = (this.soundBtn = document.createElement('button'));
    sound.type = 'button';
    sound.className = 'pj-sound__btn pj-sound__toggle';
    sound.appendChild(
      icon([
        { cls: 'pj-sound__spk', rects: SPEAKER },
        { cls: 'pj-sound__waves', rects: WAVES },
        { cls: 'pj-sound__cross', rects: CROSS },
      ]),
    );
    sound.addEventListener('click', () => this.setSound(!this.soundOn, true));

    const listen = (this.listenBtn = document.createElement('button'));
    listen.type = 'button';
    listen.className = 'pj-sound__btn pj-sound__listen';
    listen.appendChild(icon([{ cls: 'pj-sound__ears', rects: EARS }]));
    const label = document.createElement('span');
    label.className = 'pj-sound__label';
    label.textContent = 'Listen';
    listen.appendChild(label);
    listen.addEventListener('click', () => this.setListen(!this.listening));

    root.append(sound, listen);
    parent.appendChild(root);

    this.onKey = (e) => {
      if (e.key === 'Escape' && this.listening) {
        this.setListen(false);
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', this.onKey);
    this.setSound(initialOn, false);
    this.setListen(false);
  }

  get isOn(): boolean {
    return this.soundOn;
  }

  setSound(on: boolean, fromUser: boolean): void {
    this.soundOn = on;
    const b = this.soundBtn;
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Sound on (click to mute)' : 'Sound off (click to play city sounds)');
    b.title = on ? 'Mute' : 'Play city sounds';
    b.classList.toggle('is-on', on);
    if (fromUser) this.h.onSound(on);
  }

  setListen(on: boolean): void {
    this.listening = on;
    document.body.classList.toggle(LISTEN_CLASS, on);
    const b = this.listenBtn;
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Listen mode on: interface hidden (Esc to show it)' : 'Listen mode: hide the interface');
    b.title = on ? 'Show interface (Esc)' : 'Listen: hide the interface';
    // Listening without sound makes no sense: turn it on (this click is the user gesture).
    if (on && !this.soundOn) this.setSound(true, true);
    this.h.onListen?.(on);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    document.body.classList.remove(LISTEN_CLASS);
    this.root.remove();
  }
}
