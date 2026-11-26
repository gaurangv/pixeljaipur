import type { Clock, WorldTime } from '../core/clock';
import { formatIST } from '../core/clock';
import { atHourIST, morningGoldenHour } from '../sky/sunModel';
import '../sky/daycycle.css';

/** Play speed: one game hour per 10 real seconds. */
export const PLAY_SPEED = 360;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "18:45" and "14 Jan" from a WorldTime. */
export function timeLabel(now: WorldTime): { time: string; day: string } {
  const s = formatIST(now.date); // YYYY-MM-DDTHH:MM
  return { time: s.slice(11, 16), day: `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]}` };
}

/**
 * Small pixel panel (bottom-left; top-left on phones): time-of-day scrubber, the IST time,
 * and Golden hour / Play / Live buttons. Lives in the overlay; never built in shot mode.
 */
export class TimeControl {
  readonly el: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly timeEl: HTMLElement;
  private readonly dayEl: HTMLElement;
  private readonly buttons: Record<'golden' | 'play' | 'live', HTMLButtonElement>;
  private shown = '';

  constructor(
    parent: HTMLElement,
    private readonly clock: Clock,
    private readonly changed: () => void,
  ) {
    const el = (this.el = document.createElement('div'));
    el.className = 'pj-time';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Time of day');

    const head = document.createElement('div');
    head.className = 'pj-time__head';
    this.timeEl = document.createElement('span');
    this.timeEl.className = 'pj-time__clock';
    this.timeEl.setAttribute('aria-live', 'off');
    this.dayEl = document.createElement('span');
    this.dayEl.className = 'pj-time__day';
    const ist = document.createElement('span');
    ist.className = 'pj-time__ist';
    ist.textContent = 'IST';
    head.append(this.timeEl, ist, this.dayEl);

    const slider = (this.slider = document.createElement('input'));
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1439';
    slider.step = '1';
    slider.className = 'pj-time__slider';
    slider.setAttribute('aria-label', 'Time of day (IST)');
    slider.addEventListener('input', () => {
      this.clock.setMode('fixed');
      this.clock.set(atHourIST(this.clock.now().date, Number(slider.value) / 60));
      this.refresh();
    });

    const row = document.createElement('div');
    row.className = 'pj-time__buttons';
    const mk = (label: string, title: string, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pj-time__btn';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', () => {
        fn();
        this.refresh();
      });
      row.append(b);
      return b;
    };
    this.buttons = {
      golden: mk('Golden hour', 'Morning golden hour (sun about 7 degrees up)', () => {
        this.clock.setMode('fixed');
        this.clock.set(morningGoldenHour(this.clock.now().date));
      }),
      play: mk('Play', 'Run the day: 1 hour per 10 seconds', () => {
        if (this.clock.mode === 'running') {
          this.clock.setMode('fixed');
        } else {
          this.clock.speed = PLAY_SPEED;
          this.clock.setMode('running');
        }
      }),
      live: mk('Live', 'Real Jaipur time', () => {
        this.clock.setMode(this.clock.mode === 'live' ? 'fixed' : 'live');
      }),
    };

    el.append(head, slider, row);
    // Don't let drags on the panel pan the city underneath.
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    parent.append(el);
    this.update(clock.now());
  }

  private refresh(): void {
    this.update(this.clock.now());
    this.changed();
  }

  /** Sync the panel with the clock (cheap: only touches the DOM when the minute or mode changes). */
  update(now: WorldTime): void {
    const { time, day } = timeLabel(now);
    const mode = this.clock.mode;
    const key = `${time}|${day}|${mode}`;
    if (key === this.shown) return;
    this.shown = key;
    this.timeEl.textContent = time;
    this.dayEl.textContent = day;
    if (document.activeElement !== this.slider) this.slider.value = String(Math.floor(now.hoursIST * 60) % 1440);
    this.slider.setAttribute('aria-valuetext', `${time} IST`);
    this.buttons.play.textContent = mode === 'running' ? 'Pause' : 'Play';
    this.buttons.play.setAttribute('aria-pressed', String(mode === 'running'));
    this.buttons.live.setAttribute('aria-pressed', String(mode === 'live'));
  }

  dispose(): void {
    this.el.remove();
  }
}
