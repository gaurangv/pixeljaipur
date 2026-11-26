import { range, int, type Rng } from '../world/rng';
import { SILENT, type VoiceKind } from './mix';
import type { OneShotKind } from './cues';

/**
 * Placeholder voices synthesised from Web Audio primitives (no downloads).
 * Each ambient voice is a small graph ending in `output`; scheduled voices (bells, coos,
 * chirps...) place their notes ahead of the audio clock in `tick`. A real recording replaces
 * a synth voice by registering a `bufferVoice(url)` for the same kind (see manifest.ts).
 */
export interface Voice {
  readonly output: AudioNode;
  /** Schedule upcoming notes. `t` = audio clock, `gain` = current zone gain (skip work when silent). */
  tick?(t: number, gain: number): void;
  stop(): void;
}

export type VoiceFactory = (ac: BaseAudioContext, rng: Rng) => Voice;
/** One-off sound: plays into `dest` starting at audio time `t`. */
export type OneShot = (ac: BaseAudioContext, dest: AudioNode, t: number, rng: Rng) => void;

// ---------------------------------------------------------------------------------------------
// Shared helpers

type NoiseColour = 'white' | 'pink' | 'brown';
const noiseCache = new WeakMap<BaseAudioContext, Map<NoiseColour, AudioBuffer>>();

/** A few seconds of looping noise per colour, built once per context. */
export function noiseBuffer(ac: BaseAudioContext, colour: NoiseColour, seconds = 5): AudioBuffer {
  let byColour = noiseCache.get(ac);
  if (!byColour) noiseCache.set(ac, (byColour = new Map()));
  const hit = byColour.get(colour);
  if (hit) return hit;
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  let seed = colour === 'white' ? 11 : colour === 'pink' ? 23 : 37;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = rnd();
    if (colour === 'white') d[i] = w * 0.5;
    else if (colour === 'pink') {
      // Paul Kellet's refined pink filter
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  // Crossfade the ends so the loop point doesn't click.
  const fade = Math.min(2048, len >> 2);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] = d[i] * k + d[len - fade + i] * (1 - k);
  }
  byColour.set(colour, buf);
  return buf;
}

function noiseSource(ac: BaseAudioContext, colour: NoiseColour, rng: Rng): AudioBufferSourceNode {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, colour);
  src.loop = true;
  src.start(ac.currentTime, rng() * src.buffer.duration); // random offset: layers don't phase
  return src;
}

function filter(ac: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function gainNode(ac: BaseAudioContext, value: number): GainNode {
  const g = ac.createGain();
  g.gain.value = value;
  return g;
}

/** Slow sine LFO added onto `param` (param keeps its base value). */
function lfo(ac: BaseAudioContext, param: AudioParam, hz: number, depth: number): OscillatorNode {
  const o = ac.createOscillator();
  o.frequency.value = hz;
  const d = gainNode(ac, depth);
  o.connect(d).connect(param);
  o.start();
  return o;
}

/** Percussive envelope on a gain param: quick attack, exponential decay. */
function pluck(p: AudioParam, t: number, peak: number, attack: number, decay: number): void {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.setTargetAtTime(0, t + attack, decay / 4);
}

const stopAll = (nodes: Array<AudioScheduledSourceNode>) => () => {
  for (const n of nodes) {
    try {
      n.stop();
    } catch {
      // already stopped
    }
  }
};

/**
 * A voice that fires notes at random intervals. `fire(t)` plays one note/phrase into `out`.
 * Notes are scheduled ~0.3 s ahead of the audio clock, so a dropped frame never makes a gap.
 */
function scheduled(
  ac: BaseAudioContext,
  rng: Rng,
  interval: () => number,
  fire: (t: number, out: AudioNode) => void,
): Voice {
  const output = gainNode(ac, 1);
  let next = ac.currentTime + interval() * rng();
  return {
    output,
    tick(t, gain) {
      if (next < t) next = t + 0.05;
      if (gain < SILENT) {
        // Silent: let time pass without stacking notes up.
        while (next < t + 0.3) next += interval();
        return;
      }
      let guard = 0;
      while (next < t + 0.3 && guard++ < 8) {
        fire(next, output);
        next += interval();
      }
    },
    stop() {
      output.disconnect();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Instruments (shared by ambient voices and one-shots)

/** FM bell: inharmonic modulator, bright attack that mellows as the index decays. */
export function fmBell(ac: BaseAudioContext, dest: AudioNode, t: number, freq: number, peak: number, dur: number): void {
  const car = ac.createOscillator();
  const mod = ac.createOscillator();
  const modGain = ac.createGain();
  const amp = ac.createGain();
  car.frequency.value = freq;
  mod.frequency.value = freq * 1.41;
  modGain.gain.setValueAtTime(freq * 2.2, t);
  modGain.gain.setTargetAtTime(freq * 0.25, t, dur / 6);
  mod.connect(modGain).connect(car.frequency);
  // a quieter, faster-decaying upper partial for shimmer
  const hi = ac.createOscillator();
  const hiAmp = ac.createGain();
  hi.frequency.value = freq * 2.76;
  pluck(hiAmp.gain, t, peak * 0.25, 0.004, dur * 0.35);
  hi.connect(hiAmp).connect(dest);
  pluck(amp.gain, t, peak, 0.004, dur);
  car.connect(amp).connect(dest);
  const end = t + dur * 1.6;
  for (const o of [car, mod, hi]) {
    o.start(t);
    o.stop(end);
  }
}

/** Pigeon coo: a soft rolling "croo-oo" with a rise then fall. */
function coo(ac: BaseAudioContext, dest: AudioNode, t: number, base: number, peak: number): void {
  const o = ac.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(base * 0.9, t);
  o.frequency.linearRampToValueAtTime(base * 1.22, t + 0.16);
  o.frequency.linearRampToValueAtTime(base * 0.82, t + 0.62);
  const roll = ac.createGain();
  roll.gain.value = 0.65;
  const rollLfo = ac.createOscillator();
  rollLfo.frequency.value = 22;
  const rollDepth = gainNode(ac, 0.35);
  rollLfo.connect(rollDepth).connect(roll.gain);
  const amp = ac.createGain();
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.08);
  amp.gain.setValueAtTime(peak, t + 0.4);
  amp.gain.linearRampToValueAtTime(0, t + 0.7);
  const lp = filter(ac, 'lowpass', 750, 0.5);
  o.connect(roll).connect(amp).connect(lp).connect(dest);
  o.start(t);
  rollLfo.start(t);
  o.stop(t + 0.75);
  rollLfo.stop(t + 0.75);
}

/** Bird chirp: a quick sine sweep. */
function chirp(ac: BaseAudioContext, dest: AudioNode, t: number, f0: number, f1: number, dur: number, peak: number): void {
  const o = ac.createOscillator();
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const a = ac.createGain();
  a.gain.setValueAtTime(0, t);
  a.gain.linearRampToValueAtTime(peak, t + 0.006);
  a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(a).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Short band-passed noise burst (wing beats, bark breath). */
function noiseBurst(ac: BaseAudioContext, dest: AudioNode, t: number, freq: number, q: number, dur: number, peak: number, rng: Rng): void {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, 'white');
  const bp = filter(ac, 'bandpass', freq, q);
  const a = ac.createGain();
  pluck(a.gain, t, peak, 0.003, dur);
  src.connect(bp).connect(a).connect(dest);
  src.start(t, rng() * 4);
  src.stop(t + dur * 1.5 + 0.02);
}

// ---------------------------------------------------------------------------------------------
// Ambient voices

/** Bazaar murmur: two pink-noise bands with slow swells and a syllable-rate flutter. */
const crowd: VoiceFactory = (ac, rng) => {
  const output = gainNode(ac, 0.9);
  const lp = filter(ac, 'lowpass', 2400, 0.5);
  lp.connect(output);
  const lowBand = filter(ac, 'bandpass', 480, 0.6);
  const highBand = filter(ac, 'bandpass', 1150, 1.1);
  const g1 = gainNode(ac, 0.8);
  const g2 = gainNode(ac, 0.35);
  const n1 = noiseSource(ac, 'pink', rng);
  const n2 = noiseSource(ac, 'pink', rng);
  n1.connect(lowBand).connect(g1).connect(lp);
  n2.connect(highBand).connect(g2).connect(lp);
  const oscs = [
    lfo(ac, g1.gain, range(rng, 0.07, 0.13), 0.22),
    lfo(ac, g2.gain, range(rng, 0.15, 0.3), 0.12),
    lfo(ac, g2.gain, range(rng, 3.2, 4.1), 0.08), // babble: syllable-rate wobble
    lfo(ac, g2.gain, range(rng, 4.6, 5.8), 0.06),
  ];
  return { output, stop: stopAll([n1, n2, ...oscs]) };
};

/** Traffic hum: low brown-noise rumble plus a soft tyre hiss, with slow swells. */
const traffic: VoiceFactory = (ac, rng) => {
  const output = gainNode(ac, 1);
  const rumble = noiseSource(ac, 'brown', rng);
  const hiss = noiseSource(ac, 'pink', rng);
  const lp = filter(ac, 'lowpass', 320, 0.5);
  const bp = filter(ac, 'bandpass', 850, 0.5);
  const g1 = gainNode(ac, 0.9);
  const g2 = gainNode(ac, 0.12);
  rumble.connect(lp).connect(g1).connect(output);
  hiss.connect(bp).connect(g2).connect(output);
  const oscs = [lfo(ac, g1.gain, range(rng, 0.05, 0.09), 0.3), lfo(ac, g2.gain, range(rng, 0.1, 0.2), 0.06)];
  return { output, stop: stopAll([rumble, hiss, ...oscs]) };
};

/** Pigeons on the Hawa Mahal ledges: phrases of 2-3 coos, several birds at different pitches. */
const pigeons: VoiceFactory = (ac, rng) => {
  const birds = [range(rng, 280, 330), range(rng, 330, 380), range(rng, 250, 290)];
  return scheduled(
    ac,
    rng,
    () => range(rng, 1.6, 4.5),
    (t, out) => {
      const base = birds[int(rng, 0, birds.length - 1)];
      const n = int(rng, 1, 3);
      for (let i = 0; i < n; i++) coo(ac, out, t + i * 0.85, base * range(rng, 0.97, 1.03), 0.5);
      if (rng() < 0.12) for (let i = 0; i < 6; i++) noiseBurst(ac, out, t + 2.6 + i * 0.07, 1300, 0.9, 0.05, 0.25, rng);
    },
  );
};

/** Temple bells: occasional clusters of struck bells. */
const bells: VoiceFactory = (ac, rng) =>
  scheduled(
    ac,
    rng,
    () => range(rng, 5, 14),
    (t, out) => {
      const f = [660, 740, 880][int(rng, 0, 2)];
      const n = int(rng, 1, 4);
      for (let i = 0; i < n; i++) fmBell(ac, out, t + i * range(rng, 0.45, 0.8), f * range(rng, 0.995, 1.005), 0.32, 3.2);
    },
  );

/**
 * Chai seller: a sung "chaaai" -- a sawtooth with a pitch glide through two formant
 * band-passes that slide from "aa" to "ee". Called every 10-25 s.
 */
const chai: VoiceFactory = (ac, rng) => {
  const call = (t: number, out: AudioNode, f: number, len: number) => {
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * 1.25, t + len * 0.3);
    o.frequency.linearRampToValueAtTime(f * 0.92, t + len);
    const vib = ac.createOscillator();
    vib.frequency.value = 5.2;
    const vibD = gainNode(ac, f * 0.015);
    vib.connect(vibD).connect(o.frequency);
    const f1 = filter(ac, 'bandpass', 760, 5);
    const f2 = filter(ac, 'bandpass', 1180, 7);
    f1.frequency.setValueAtTime(760, t + len * 0.45);
    f1.frequency.linearRampToValueAtTime(330, t + len);
    f2.frequency.setValueAtTime(1180, t + len * 0.45);
    f2.frequency.linearRampToValueAtTime(2100, t + len);
    const a = ac.createGain();
    a.gain.setValueAtTime(0, t);
    a.gain.linearRampToValueAtTime(0.5, t + 0.07);
    a.gain.setValueAtTime(0.5, t + len * 0.75);
    a.gain.linearRampToValueAtTime(0, t + len);
    const lp = filter(ac, 'lowpass', 2400, 0.5);
    o.connect(f1).connect(a);
    o.connect(f2).connect(a);
    a.connect(lp).connect(out);
    o.start(t);
    vib.start(t);
    o.stop(t + len + 0.05);
    vib.stop(t + len + 0.05);
  };
  return scheduled(
    ac,
    rng,
    () => range(rng, 10, 25),
    (t, out) => {
      const f = range(rng, 170, 210);
      call(t, out, f, 0.85);
      if (rng() < 0.6) call(t + 1.1, out, f * 1.06, 0.6);
    },
  );
};

/** Morning birds: little groups of chirps (sparrows / mynas, loosely). */
const birds: VoiceFactory = (ac, rng) =>
  scheduled(
    ac,
    rng,
    () => range(rng, 0.4, 2.2),
    (t, out) => {
      const base = range(rng, 2300, 3600);
      const down = rng() < 0.4;
      const n = int(rng, 2, 5);
      for (let i = 0; i < n; i++) {
        const f = base * range(rng, 0.92, 1.08);
        chirp(ac, out, t + i * range(rng, 0.07, 0.12), down ? f * 1.4 : f, down ? f : f * 1.4, range(rng, 0.04, 0.08), 0.22);
      }
    },
  );

/** Night crickets: two steady sine carriers gated into 3-pulse chirps. */
const crickets: VoiceFactory = (ac, rng) => {
  const output = gainNode(ac, 1);
  const crs = [range(rng, 3900, 4300), range(rng, 4500, 4900)].map((f) => {
    const o = ac.createOscillator();
    o.frequency.value = f;
    const gate = gainNode(ac, 0);
    o.connect(gate).connect(output);
    o.start();
    return { o, gate, period: range(rng, 0.5, 0.75), next: ac.currentTime + rng() };
  });
  return {
    output,
    tick(t, gain) {
      for (const c of crs) {
        if (c.next < t) c.next = t + 0.05;
        while (c.next < t + 0.3) {
          if (gain >= SILENT) {
            for (let i = 0; i < 3; i++) {
              const s = c.next + i * 0.045;
              c.gate.gain.setValueAtTime(0, s);
              c.gate.gain.linearRampToValueAtTime(0.15, s + 0.006);
              c.gate.gain.linearRampToValueAtTime(0, s + 0.026);
            }
          }
          c.next += c.period * range(rng, 0.95, 1.05);
        }
      }
    },
    stop: stopAll(crs.map((c) => c.o)),
  };
};

/** A distant dog: 2-3 muffled barks now and then. */
const dog: VoiceFactory = (ac, rng) => {
  const muffle = filter(ac, 'lowpass', 750, 0.5);
  const v = scheduled(
    ac,
    rng,
    () => range(rng, 12, 35),
    (t, out) => {
      const n = int(rng, 2, 3);
      const f = range(rng, 330, 420);
      for (let i = 0; i < n; i++) {
        const s = t + i * range(rng, 0.3, 0.45);
        const o = ac.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f, s);
        o.frequency.exponentialRampToValueAtTime(f * 0.65, s + 0.14);
        const a = ac.createGain();
        pluck(a.gain, s, 0.35, 0.01, 0.16);
        o.connect(a).connect(out);
        o.start(s);
        o.stop(s + 0.25);
        noiseBurst(ac, out, s, 600, 1.2, 0.12, 0.3, rng);
      }
    },
  );
  v.output.connect(muffle);
  return { output: muffle, tick: v.tick, stop: () => (v.stop(), muffle.disconnect()) };
};

export const SYNTH_VOICES: Record<VoiceKind, VoiceFactory> = { crowd, traffic, pigeons, bells, chai, birds, crickets, dog };

// ---------------------------------------------------------------------------------------------
// One-shots

/** Auto-rickshaw horn: a two-tone square dyad, softened, in one or two short beeps. */
const horn: OneShot = (ac, dest, t, rng) => {
  const lp = filter(ac, 'lowpass', 1700, 0.6);
  const hp = filter(ac, 'highpass', 250, 0.5);
  lp.connect(hp).connect(dest);
  const f = range(rng, 400, 470);
  const beeps = rng() < 0.6 ? 2 : 1;
  for (let b = 0; b < beeps; b++) {
    const s = t + b * 0.2;
    const len = b === beeps - 1 ? range(rng, 0.16, 0.3) : 0.12;
    const a = ac.createGain();
    a.gain.setValueAtTime(0, s);
    a.gain.linearRampToValueAtTime(0.22, s + 0.012);
    a.gain.setValueAtTime(0.22, s + len);
    a.gain.linearRampToValueAtTime(0, s + len + 0.03);
    a.connect(lp);
    for (const ratio of [1, 1.26]) {
      const o = ac.createOscillator();
      o.type = 'square';
      o.frequency.value = f * ratio;
      o.connect(a);
      o.start(s);
      o.stop(s + len + 0.05);
    }
  }
};

/** Wing flutter: a burst of band-passed noise claps that speeds up, then thins out. */
const flutter: OneShot = (ac, dest, t, rng) => {
  let s = t;
  const n = int(rng, 14, 20);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    noiseBurst(ac, dest, s, range(rng, 1000, 1700), 0.9, 0.035, 0.5 * (1 - k * 0.7), rng);
    s += 0.05 + k * 0.05 + rng() * 0.02;
  }
};

/** Aarti: a little hand bell rung fast for a few seconds, over slow deep temple-bell strikes. */
const aarti: OneShot = (ac, dest, t, rng) => {
  let s = t;
  const end = t + range(rng, 4, 6);
  while (s < end) {
    fmBell(ac, dest, s, range(rng, 1240, 1290), 0.12, 0.7);
    s += range(rng, 0.13, 0.2);
  }
  for (let i = 0; i < 3; i++) fmBell(ac, dest, t + i * 1.8, 330, 0.3, 4);
};

export const ONE_SHOTS: Record<OneShotKind, OneShot> = { horn, flutter, aarti };

// ---------------------------------------------------------------------------------------------
// Recordings

/** A looping recording (decoded once, faded in when ready). Swap a synth voice for this. */
export function bufferVoice(url: string, gain = 1): VoiceFactory {
  return (ac) => {
    const output = gainNode(ac, 0);
    let src: AudioBufferSourceNode | null = null;
    let stopped = false;
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => ac.decodeAudioData(b))
      .then((buf) => {
        if (stopped) return;
        src = ac.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.connect(output);
        src.start(ac.currentTime, Math.random() * buf.duration);
        output.gain.setTargetAtTime(gain, ac.currentTime, 0.5);
      })
      .catch((err) => console.warn('[pixeljaipur] sound', url, 'failed', err));
    return {
      output,
      stop() {
        stopped = true;
        src?.stop();
        output.disconnect();
      },
    };
  };
}
