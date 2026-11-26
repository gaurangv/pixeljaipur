import type { ScreenView } from '../render/camera';
import { mulberry32, type Rng } from '../world/rng';
import type { Cue, OneShotKind } from './cues';
import { SILENT, spatialMix, zoneMix, type SoundZone, type VoiceKind } from './mix';
import { ONE_SHOTS, SYNTH_VOICES, type OneShot, type Voice, type VoiceFactory } from './voices';

/**
 * The Web Audio side: one AudioContext (created lazily, inside a user gesture), a master gain
 * into a gentle compressor, and one voice -> gain -> panner chain per sound zone.
 * Runs on the audio clock; nothing here asks for rendered frames.
 */

/** Overall output level (before the compressor). Modest: this is ambience, not a game. */
export const MASTER_LEVEL = 0.55;
/** Smoothing time constant (s) for zone gain/pan changes while panning and zooming. */
export const SMOOTH = 0.12;
const FADE = 0.4;

export interface EngineOptions {
  /** Inject for tests. Default: `new AudioContext()`. */
  createContext?: () => AudioContext;
  voices?: Partial<Record<VoiceKind, VoiceFactory>>;
  oneShots?: Partial<Record<OneShotKind, OneShot>>;
  seed?: number;
}

interface ZoneChain {
  zone: SoundZone;
  voice: Voice;
  gain: GainNode;
  pan: StereoPannerNode;
  lastGain: number;
  lastPan: number;
}

export class AudioEngine {
  ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private chains: ZoneChain[] = [];
  private readonly voices: Record<VoiceKind, VoiceFactory>;
  private readonly oneShots: Record<OneShotKind, OneShot>;
  private readonly rng: Rng;
  private on = false;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: EngineOptions = {}) {
    this.voices = { ...SYNTH_VOICES, ...opts.voices };
    this.oneShots = { ...ONE_SHOTS, ...opts.oneShots };
    this.rng = mulberry32(opts.seed ?? 1);
  }

  /** True while sound is on and the context is running. */
  get running(): boolean {
    return this.on && this.ac !== null && this.ac.state === 'running';
  }

  /**
   * Turn sound on. Call from a user gesture the first time (browsers block audio until then).
   * Creates the context and zone voices once.
   */
  start(zones: SoundZone[]): Promise<void> {
    this.on = true;
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    if (!this.ac) this.build(zones);
    const ac = this.ac!;
    const t = ac.currentTime;
    this.master!.gain.cancelScheduledValues(t);
    this.master!.gain.setTargetAtTime(MASTER_LEVEL, t, FADE / 3);
    return ac.state === 'running' ? Promise.resolve() : ac.resume();
  }

  /** Fade out, then suspend the context (saves CPU; keeps voices for a quick restart). */
  stop(): void {
    this.on = false;
    const ac = this.ac;
    if (!ac || !this.master) return;
    this.master.gain.cancelScheduledValues(ac.currentTime);
    this.master.gain.setTargetAtTime(0, ac.currentTime, FADE / 4);
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(() => {
      if (!this.on) ac.suspend().catch(() => {});
    }, FADE * 1000 + 100);
  }

  /** Pause/resume with the page (hidden tabs stay quiet). */
  setPageVisible(visible: boolean): void {
    const ac = this.ac;
    if (!ac || !this.on) return;
    (visible ? ac.resume() : ac.suspend()).catch(() => {});
  }

  private build(zones: SoundZone[]): void {
    const ac = (this.ac = this.opts.createContext ? this.opts.createContext() : new AudioContext());
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.02;
    comp.release.value = 0.3;
    comp.connect(ac.destination);
    this.master = ac.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp);
    this.chains = zones.map((zone) => {
      const voice = this.voices[zone.voice](ac, mulberry32(Math.floor(this.rng() * 2 ** 32)));
      const gain = ac.createGain();
      gain.gain.value = 0;
      const pan = ac.createStereoPanner();
      voice.output.connect(gain).connect(pan).connect(this.master!);
      return { zone, voice, gain, pan, lastGain: 0, lastPan: 0 };
    });
  }

  /** Re-mix every zone for the current camera and time. Cheap; call every frame. */
  update(view: ScreenView, hoursIST: number): void {
    const ac = this.ac;
    if (!ac || !this.running) return;
    const t = ac.currentTime;
    for (const c of this.chains) {
      const m = zoneMix(c.zone, view, hoursIST);
      if (Math.abs(m.gain - c.lastGain) > 0.0015 || (m.gain === 0) !== (c.lastGain === 0)) {
        c.gain.gain.setTargetAtTime(m.gain, t, SMOOTH);
        c.lastGain = m.gain;
      }
      if (Math.abs(m.pan - c.lastPan) > 0.01) {
        c.pan.pan.setTargetAtTime(m.pan, t, SMOOTH);
        c.lastPan = m.pan;
      }
      c.voice.tick?.(t, m.gain);
    }
  }

  /** Play a one-off sound at a world position. Returns false if it was too far away / sound is off. */
  play(cue: Cue, view: ScreenView): boolean {
    const ac = this.ac;
    if (!ac || !this.master || !this.running) return false;
    const m = spatialMix([[cue.x, cue.y]], cue.radius, cue.level, view);
    if (m.gain < SILENT) return false;
    const g = ac.createGain();
    g.gain.value = m.gain;
    const p = ac.createStereoPanner();
    p.pan.value = m.pan;
    g.connect(p).connect(this.master);
    this.oneShots[cue.kind](ac, g, ac.currentTime + 0.02, this.rng);
    // Let the graph be collected once the sound has rung out.
    setTimeout(() => p.disconnect(), 8000);
    return true;
  }

  dispose(): void {
    for (const c of this.chains) c.voice.stop();
    this.chains = [];
    this.ac?.close().catch(() => {});
    this.ac = null;
    this.master = null;
  }
}
