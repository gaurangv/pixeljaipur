import { Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import zoneFile from '../data/sound_zones.json';
import { parseIST } from '../src/core/clock';
import { EventBus } from '../src/core/events';
import type { WorldContext } from '../src/core/systems';
import type { ScreenView } from '../src/render/camera';
import { SoundSystem } from '../src/audio';
import { CUE_EVENTS, cueFor, EVENT_CUES } from '../src/audio/cues';
import { AudioEngine } from '../src/audio/engine';
import { RECORDINGS } from '../src/audio/manifest';
import { curveAt, parseZones, screenPan, spatialMix, zoneMix, type SoundZone, type ZoneFile } from '../src/audio/mix';
import { loadSoundOn, saveSoundOn, SOUND_PREF_KEY, type PrefStore } from '../src/audio/prefs';
import { Clock } from '../src/core/clock';

/** A view centred on data point (x, y). size is in texels; zoom = device px per texel. */
function view(x: number, y: number, rot = 0, zoom = 3, cssWidth = 1280): ScreenView {
  return {
    target: new Vector3(x, 0, -y),
    rot,
    mpp: 0.33,
    size: { x: Math.round(cssWidth / zoom), y: Math.round(800 / zoom) },
    zoom,
    dpr: 1,
  };
}

const zones = parseZones(zoneFile as unknown as ZoneFile);
const zone = (id: string) => zones.find((z) => z.id === id)!;

describe('sound zones data', () => {
  it('parses, with every curve resolved and the temple marked as a placeholder', () => {
    expect(zones.length).toBeGreaterThan(10);
    for (const z of zones) expect(z.curve.length).toBeGreaterThan(1);
    expect(zone('bells-bazaar-temple').placeholder).toBe(true);
    for (const v of ['crowd', 'traffic', 'pigeons', 'bells', 'chai', 'crickets']) {
      expect(zones.some((z) => z.voice === v)).toBe(true);
    }
  });
});

describe('spatial mix', () => {
  const pt: SoundZone = { id: 'p', voice: 'crowd', points: [[0, 0]], radius: 30, level: 1, curve: [[0, 1]] };

  it('gain falls off with distance', () => {
    const g = [0, 20, 60, 150].map((d) => zoneMix(pt, view(d, 0), 12).gain);
    for (let i = 1; i < g.length; i++) expect(g[i]).toBeLessThan(g[i - 1]);
    expect(g[3]).toBeLessThan(g[0] * 0.2);
  });

  it('zooming out makes a nearby zone quieter and the mix more even', () => {
    const near = (zoom: number) => zoneMix(pt, view(0, 0, 0, zoom), 12).gain;
    expect(near(1)).toBeLessThan(near(3));
    expect(near(3)).toBeLessThan(near(8));
    // Ratio between a near and a far zone shrinks when zoomed out (more blended).
    const ratio = (zoom: number) => zoneMix(pt, view(0, 0, 0, zoom), 12).gain / zoneMix(pt, view(80, 0, 0, zoom), 12).gain;
    expect(ratio(1)).toBeLessThan(ratio(6));
  });

  it('uses the nearest point of a polyline', () => {
    const road: SoundZone = { ...pt, points: [[-100, 0], [100, 0]] };
    expect(zoneMix(road, view(60, 0), 12).gain).toBeCloseTo(zoneMix(pt, view(0, 0), 12).gain, 5);
  });

  it('a zone east of the listener pans right at rot 0 and to the correct side at rot 1-3', () => {
    const east = (rot: number) => screenPan([20, 0], view(0, 0, rot));
    const north = (rot: number) => screenPan([0, 20], view(0, 0, rot));
    // Camera looks NW at rot 0 (screen-right = east+north); each step turns the view 90°.
    expect(east(0)).toBeGreaterThan(0);
    expect(east(1)).toBeLessThan(0);
    expect(east(2)).toBeLessThan(0);
    expect(east(3)).toBeGreaterThan(0);
    expect(north(0)).toBeGreaterThan(0);
    expect(north(1)).toBeGreaterThan(0);
    expect(north(2)).toBeLessThan(0);
    expect(north(3)).toBeLessThan(0);
    // Opposite rotations mirror each other.
    expect(east(2)).toBeCloseTo(-east(0), 6);
    expect(Math.abs(screenPan([0, 0], view(0, 0, 1)))).toBeLessThan(1e-9);
  });

  it('pan is clamped and blended towards centre when zoomed out', () => {
    const m3 = spatialMix([[30, 0]], 30, 1, view(0, 0, 0, 3));
    const m1 = spatialMix([[30, 0]], 30, 1, view(0, 0, 0, 1));
    expect(Math.abs(m3.pan)).toBeLessThanOrEqual(1);
    expect(Math.abs(m1.pan)).toBeLessThan(Math.abs(m3.pan));
  });
});

describe('time-of-day curves', () => {
  const at = (id: string, h: number) => curveAt(zone(id).curve, h);
  const hours = Array.from({ length: 96 }, (_, i) => i / 4);

  it('the bazaar peaks near 19:00 and is quiet early morning', () => {
    const peak = hours.reduce((best, h) => (at('crowd-johari-bazaar', h) > at('crowd-johari-bazaar', best) ? h : best), 0);
    expect(Math.abs(peak - 19)).toBeLessThanOrEqual(0.5);
    expect(at('crowd-johari-bazaar', 5.5)).toBeLessThan(0.1);
  });

  it('crickets and the dog at night only; birds and bells in the early morning', () => {
    expect(at('crickets-everywhere', 23)).toBeGreaterThan(0.8);
    expect(at('crickets-everywhere', 2)).toBeGreaterThan(0.7);
    expect(at('crickets-everywhere', 12)).toBe(0);
    expect(at('dog-distant', 1)).toBeGreaterThan(0.5);
    expect(at('dog-distant', 14)).toBe(0);
    expect(at('birds-hawa-mahal-trees', 6.5)).toBeGreaterThan(0.8);
    expect(at('bells-bazaar-temple', 6.5)).toBeGreaterThan(at('crowd-johari-bazaar', 6.5));
  });

  it('interpolates and wraps across midnight', () => {
    const c: [number, number][] = [
      [6, 0],
      [18, 1],
    ];
    expect(curveAt(c, 12)).toBeCloseTo(0.5);
    expect(curveAt(c, 0)).toBeCloseTo(0.5); // 18 -> 30 (=6): midnight is halfway
    expect(curveAt(c, 24 + 12)).toBeCloseTo(0.5);
  });
});

describe('event cues', () => {
  it('map events to the right voices at the event position', () => {
    expect(cueFor('horn', { x: 3, y: 4, kind: 'auto' })).toMatchObject({ kind: 'horn', x: 3, y: 4 });
    expect(cueFor('pigeonsBurst', { x: 1, y: 2 }).kind).toBe('flutter');
    expect(cueFor('aarti', { x: 0, y: 0 }).kind).toBe('aarti');
    expect(CUE_EVENTS.sort()).toEqual(Object.keys(EVENT_CUES).sort());
  });
});

describe('manifest', () => {
  it('lists a recording with a query and licence for every synth voice', () => {
    const voices = new Set(RECORDINGS.map((r) => r.voice));
    for (const v of ['crowd', 'traffic', 'pigeons', 'bells', 'chai', 'birds', 'crickets', 'dog', 'horn', 'flutter', 'aarti']) {
      expect(voices.has(v as never)).toBe(true);
    }
    for (const r of RECORDINGS) {
      expect(r.query.length).toBeGreaterThan(3);
      expect(r.licence.length).toBeGreaterThan(0);
    }
  });
});

describe('mute preference', () => {
  const memStore = (): PrefStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };

  it('is off by default and persists the choice', () => {
    const s = memStore();
    expect(loadSoundOn(s)).toBe(false);
    saveSoundOn(s, true);
    expect(s.data.get(SOUND_PREF_KEY)).toBe('on');
    expect(loadSoundOn(s)).toBe(true);
    saveSoundOn(s, false);
    expect(loadSoundOn(s)).toBe(false);
  });

  it('survives a throwing storage', () => {
    const bad: PrefStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadSoundOn(bad)).toBe(false);
    expect(() => saveSoundOn(bad, true)).not.toThrow();
  });
});

// ---- A minimal fake Web Audio graph: every create*() returns a node whose params accept automation.
function fakeParam() {
  const p = { value: 0 } as Record<string, unknown>;
  for (const m of ['setValueAtTime', 'setTargetAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues']) p[m] = vi.fn();
  return p;
}
function fakeNode(): Record<string, unknown> {
  const n: Record<string | symbol, unknown> = { start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
  n.connect = vi.fn((dest: unknown) => dest);
  return new Proxy(n, {
    get(t, k) {
      if (!(k in t) && typeof k === 'string') t[k] = fakeParam();
      return t[k];
    },
  }) as Record<string, unknown>;
}
class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = fakeNode();
  constructor() {
    return new Proxy(this, {
      get(t, k) {
        if (k in t) return (t as unknown as Record<string | symbol, unknown>)[k];
        if (typeof k === 'string' && k.startsWith('create')) return () => fakeNode();
        return undefined;
      },
    });
  }
  createBuffer(_c: number, len: number) {
    const d = new Float32Array(len);
    return { duration: len / this.sampleRate, getChannelData: () => d };
  }
  resume = vi.fn(() => Promise.resolve());
  suspend = vi.fn(() => Promise.resolve());
  close = vi.fn(() => Promise.resolve());
}

function fakeCtx(shot: boolean): WorldContext {
  return {
    shot,
    events: new EventBus(),
    clock: new Clock(parseIST('2026-01-14T19:00')!),
    screenView: () => view(15, 43),
    seed: 1,
    overlay: {} as HTMLElement,
    params: new URLSearchParams(),
    invalidate: vi.fn(),
    refreshShadows: vi.fn(),
  } as unknown as WorldContext;
}

describe('sound system', () => {
  it('shot mode never constructs an AudioContext or touches storage, and never animates', () => {
    const createContext = vi.fn(() => new FakeAudioContext() as unknown as AudioContext);
    const store = { getItem: vi.fn(), setItem: vi.fn() };
    const sys = new SoundSystem({ createContext, store, ui: false });
    const ctx = fakeCtx(true);
    sys.init(ctx);
    sys.update(0, ctx.clock.now(), ctx);
    ctx.events.emit('horn', { x: 15, y: 43, kind: 'auto' });
    expect(createContext).not.toHaveBeenCalled();
    expect(store.getItem).not.toHaveBeenCalled();
    expect(store.setItem).not.toHaveBeenCalled();
    expect(sys.engine).toBeNull();
    expect(sys.animating()).toBe(false);
  });

  it('creates one context only when turned on, persists it, and routes events to one-shots', async () => {
    const createContext = vi.fn(() => new FakeAudioContext() as unknown as AudioContext);
    const horn = vi.fn();
    const flutter = vi.fn();
    const aarti = vi.fn();
    const data = new Map<string, string>();
    const store: PrefStore = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
    const sys = new SoundSystem({ createContext, store, ui: false, oneShots: { horn, flutter, aarti } });
    const ctx = fakeCtx(false);
    sys.init(ctx);
    sys.update(0.016, ctx.clock.now(), ctx);
    ctx.events.emit('horn', { x: 15, y: 43, kind: 'auto' });
    expect(createContext).not.toHaveBeenCalled(); // off until the user clicks
    expect(horn).not.toHaveBeenCalled();

    sys.setOn(true);
    await Promise.resolve();
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(data.get('pj-sound')).toBe('on');
    sys.update(0.016, ctx.clock.now(), ctx);
    ctx.events.emit('horn', { x: 15, y: 43, kind: 'auto' });
    ctx.events.emit('pigeonsBurst', { x: 20, y: 50 });
    ctx.events.emit('aarti', { x: 10, y: 40 });
    expect(horn).toHaveBeenCalledTimes(1);
    expect(flutter).toHaveBeenCalledTimes(1);
    expect(aarti).toHaveBeenCalledTimes(1);
    // A horn far across the city is dropped.
    ctx.events.emit('horn', { x: 5000, y: 5000, kind: 'auto' });
    expect(horn).toHaveBeenCalledTimes(1);

    sys.setOn(false);
    sys.setOn(true);
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(sys.animating()).toBe(false);

    // A fresh load remembers "on" (but still waits for a gesture before creating audio).
    const again = new SoundSystem({ createContext, store, ui: false });
    again.init(fakeCtx(false));
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(loadSoundOn(store)).toBe(true);
    sys.dispose();
  });

  it('engine builds every synth voice against the fake graph', () => {
    const engine = new AudioEngine({ createContext: () => new FakeAudioContext() as unknown as AudioContext });
    void engine.start(zones);
    expect(engine.running).toBe(true);
    expect(() => {
      for (let i = 0; i < 5; i++) engine.update(view(15, 43), 6.5 + i * 4);
    }).not.toThrow();
    engine.dispose();
  });
});
