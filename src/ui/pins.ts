import { Vector3 } from 'three';
import { worldToScreen, type ScreenView } from '../render/camera';
import type { Place } from './places';

/**
 * HTML map pins above each place. They are real buttons (Tab + Enter work) and add
 * no draw calls. Positions come from worldToScreen() after every rendered frame.
 */
export class Pins {
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly world = new Map<string, Vector3>();

  constructor(
    private readonly container: HTMLElement,
    places: Place[],
    onSelect: (id: string, opener: HTMLElement) => void,
  ) {
    for (const p of places) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pj-pin';
      b.dataset.place = p.id;
      b.textContent = p.name;
      b.setAttribute('aria-label', `${p.name}: open info card`);
      b.setAttribute('aria-controls', 'pj-card');
      b.addEventListener('click', () => onSelect(p.id, b));
      container.appendChild(b);
      this.buttons.set(p.id, b);
      this.world.set(p.id, new Vector3(p.anchor[0], p.height + 1.5, -p.anchor[1]));
    }
  }

  update(view: ScreenView): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    for (const [id, b] of this.buttons) {
      const s = worldToScreen(this.world.get(id)!, view);
      const visible = s.x > -40 && s.x < w + 40 && s.y > 0 && s.y < h + 40;
      b.hidden = !visible;
      if (visible) b.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%, -100%)`;
    }
  }

  setActive(id: string | null): void {
    for (const [pid, b] of this.buttons) {
      const on = pid === id;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-expanded', String(on));
    }
  }

  button(id: string): HTMLButtonElement | undefined {
    return this.buttons.get(id);
  }
}
