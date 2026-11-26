import zoneFile from '../../data/sound_zones.json';
import type { System, WorldContext } from '../core/systems';
import { CUE_EVENTS, cueFor } from './cues';
import { AudioEngine, type EngineOptions } from './engine';
import { recordedLoops } from './manifest';
import { parseZones, type SoundZone, type VoiceKind, type ZoneFile } from './mix';
import { browserStore, loadSoundOn, saveSoundOn, type PrefStore } from './prefs';
import { SoundUi } from './ui';
import { bufferVoice, type VoiceFactory } from './voices';
import './audio.css';

export interface SoundDeps extends EngineOptions {
  /** Inject a fake for tests. Default: localStorage. */
  store?: PrefStore | null;
  zones?: ZoneFile;
  /** Build the button UI (default true; tests run without a DOM). */
  ui?: boolean;
}

/**
 * Phase 2 "Sound": ambient zones mixed by camera position, zoom and time of day, plus
 * one-off cues on world events. Off until the user clicks the sound button.
 * Never animates (audio runs on its own clock) and does nothing at all in shot mode.
 */
export class SoundSystem implements System {
  readonly id = 'sound';
  engine: AudioEngine | null = null;
  ui: SoundUi | null = null;
  zones: SoundZone[] = [];
  private wantOn = false;
  private store: PrefStore | null = null;
  private ctx: WorldContext | null = null;
  private readonly offs: Array<() => void> = [];

  constructor(private readonly deps: SoundDeps = {}) {}

  init(ctx: WorldContext): void {
    // Screenshots: no AudioContext, no storage, no UI.
    if (ctx.shot) return;
    this.ctx = ctx;
    this.zones = parseZones(this.deps.zones ?? (zoneFile as unknown as ZoneFile));
    this.store = this.deps.store !== undefined ? this.deps.store : browserStore();
    this.wantOn = loadSoundOn(this.store);

    const voices: Partial<Record<VoiceKind, VoiceFactory>> = {};
    for (const [kind, rec] of recordedLoops()) voices[kind as VoiceKind] = bufferVoice(rec.file!);
    this.engine = new AudioEngine({ ...this.deps, voices: { ...voices, ...this.deps.voices }, seed: ctx.seed });

    for (const type of CUE_EVENTS) {
      this.offs.push(ctx.events.on(type, (p) => this.engine?.play(cueFor(type, p), ctx.screenView())));
    }

    if (this.deps.ui !== false && typeof document !== 'undefined') {
      this.ui = new SoundUi(ctx.overlay, { onSound: (on) => this.onButton(on) }, this.wantOn);
      // Remembered "on": browsers still need a gesture, so start on the first interaction.
      if (this.wantOn) this.armFirstGesture();
      const onVis = () => this.engine?.setPageVisible(document.visibilityState === 'visible');
      document.addEventListener('visibilitychange', onVis);
      this.offs.push(() => document.removeEventListener('visibilitychange', onVis));
    }
  }

  /** Turn sound on/off (call from a user gesture) and remember the choice. */
  setOn(on: boolean): void {
    if (!this.engine) return;
    this.wantOn = on;
    saveSoundOn(this.store, on);
    if (on) {
      this.engine.start(this.zones).catch((err) => console.warn('[pixeljaipur] audio could not start', err));
      if (this.ctx) this.engine.update(this.ctx.screenView(), this.ctx.clock.now().hoursIST);
    } else this.engine.stop();
  }

  private onButton(on: boolean): void {
    // Remembered "on" but not started yet (no gesture so far): this first click starts it.
    if (!on && this.wantOn && this.engine && !this.engine.running) {
      this.ui?.setSound(true, false);
      this.setOn(true);
      return;
    }
    this.setOn(on);
  }

  private armFirstGesture(): void {
    const go = (e: Event) => {
      off();
      // A click on the sound button itself toggles; don't double-handle it.
      if (e.target instanceof Element && e.target.closest('.pj-sound')) return;
      if (this.wantOn && this.engine && !this.engine.running) this.setOn(true);
    };
    const opts = { capture: true } as const;
    const off = () => {
      window.removeEventListener('pointerdown', go, opts);
      window.removeEventListener('keydown', go, opts);
    };
    window.addEventListener('pointerdown', go, opts);
    window.addEventListener('keydown', go, opts);
    this.offs.push(off);
  }

  update(_dt: number, now: { hoursIST: number }, ctx: WorldContext): void {
    if (!this.engine?.running) return;
    this.engine.update(ctx.screenView(), now.hoursIST);
  }

  /** Sound never forces continuous rendering. */
  animating(): boolean {
    return false;
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.ui?.dispose();
    this.engine?.dispose();
  }
}

export function soundSystem(deps?: SoundDeps): System {
  return new SoundSystem(deps);
}
