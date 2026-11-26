import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseIST } from '../src/core/clock';
import { buildCityLights } from '../src/sky/cityLights';
import { sunDirection } from '../src/sky/light';
import {
  KEY_SWITCH_ALT,
  PRESET_KEYS,
  SunStepper,
  blendHex,
  effectiveAltitude,
  keyLight,
  lightThresholds,
  litFraction,
  morningGoldenHour,
  presetWeights,
  stepIndex,
  sunPosition,
} from '../src/sky/sunModel';
import type { FootprintCollection } from '../src/world/footprints';
import { describeShopHouse, type ShopHouseSpec } from '../src/world/shopHouse';

const at = (s: string) => parseIST(s)!;

describe('sun over Jaipur', () => {
  it('rises in the east-south-east on a January morning', () => {
    const p = sunPosition(at('2026-01-14T07:45'));
    expect(p.azimuthDeg).toBeGreaterThan(100);
    expect(p.azimuthDeg).toBeLessThan(125);
    expect(p.altitudeDeg).toBeGreaterThan(0);
    expect(p.altitudeDeg).toBeLessThan(12);
  });

  it('is just below the horizon at 07:00 in mid-January (sunrise is ~07:20 IST)', () => {
    const p = sunPosition(at('2026-01-14T07:00'));
    expect(p.azimuthDeg).toBeGreaterThan(100);
    expect(p.azimuthDeg).toBeLessThan(125);
    expect(p.altitudeDeg).toBeLessThan(0);
    expect(p.altitudeDeg).toBeGreaterThan(-6);
  });

  it('stands high in the south at noon', () => {
    const p = sunPosition(at('2026-01-14T12:30'));
    expect(p.azimuthDeg).toBeGreaterThan(165);
    expect(p.azimuthDeg).toBeLessThan(195);
    expect(p.altitudeDeg).toBeGreaterThan(38);
    const june = sunPosition(at('2026-06-21T12:30'));
    expect(june.altitudeDeg).toBeGreaterThan(80);
  });

  it('is far below the horizon at midnight', () => {
    expect(sunPosition(at('2026-01-14T00:00')).altitudeDeg).toBeLessThan(-60);
  });

  it('points the light east-south-east and up in the morning (world +x east, -z north)', () => {
    const p = sunPosition(at('2026-01-14T08:30'));
    const d = sunDirection(p.azimuthDeg, p.altitudeDeg);
    expect(d.x).toBeGreaterThan(0.8); // east
    expect(d.z).toBeGreaterThan(0); // a little south (+z)
    expect(d.y).toBeGreaterThan(0);
  });

  it('finds a real golden hour in the morning, later in winter than in summer', () => {
    const jan = morningGoldenHour(at('2026-01-14T15:00'));
    const jun = morningGoldenHour(at('2026-06-21T15:00'));
    expect(sunPosition(jan).altitudeDeg).toBeCloseTo(7, 0);
    expect(jan.getTime()).toBeGreaterThan(at('2026-01-14T07:30').getTime());
    expect(jan.getTime()).toBeLessThan(at('2026-01-14T08:30').getTime());
    expect(jun.getTime()).toBeLessThan(at('2026-06-21T06:45').getTime());
  });
});

describe('sun steps', () => {
  it('only reports a new step when game time crosses a 10-minute boundary', () => {
    const s = new SunStepper();
    expect(s.check(at('2026-01-14T18:00'))).toBe(true); // first call
    expect(s.check(at('2026-01-14T18:04'))).toBe(false);
    expect(s.check(new Date(at('2026-01-14T18:09').getTime() + 59_000))).toBe(false);
    expect(s.check(at('2026-01-14T18:10'))).toBe(true);
    expect(s.check(at('2026-01-14T18:10'))).toBe(false);
    expect(s.check(at('2026-01-14T17:55'))).toBe(true); // scrubbing back also steps
  });

  it('aligns steps with IST :00/:10/:20', () => {
    expect(stepIndex(at('2026-01-14T18:10'))).toBe(stepIndex(at('2026-01-14T18:19')));
    expect(stepIndex(at('2026-01-14T18:20'))).toBe(stepIndex(at('2026-01-14T18:19')) + 1);
  });
});

describe('key light', () => {
  it('is the sun by day, a twilight glow just after sunset, the moon at night', () => {
    expect(keyLight({ azimuthDeg: 180, altitudeDeg: 40 }).source).toBe('sun');
    expect(keyLight({ azimuthDeg: 180, altitudeDeg: 40 }).scale).toBe(1);
    const tw = keyLight({ azimuthDeg: 250, altitudeDeg: -3 });
    expect(tw.source).toBe('twilight');
    expect(tw.elevationDeg).toBeGreaterThan(0);
    const night = keyLight({ azimuthDeg: 300, altitudeDeg: -40 });
    expect(night.source).toBe('moon');
    expect(night.scale).toBe(1);
  });

  it('is dark at the switch from twilight to moon, so the direction jump is invisible', () => {
    expect(keyLight({ azimuthDeg: 250, altitudeDeg: KEY_SWITCH_ALT + 1e-6 }).scale).toBeLessThan(1e-3);
    expect(keyLight({ azimuthDeg: 250, altitudeDeg: KEY_SWITCH_ALT - 1e-6 }).scale).toBeLessThan(1e-3);
  });
});

describe('presets', () => {
  const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);

  it('is pure noon high up and pure night deep down', () => {
    expect(presetWeights(60).noon).toBe(1);
    expect(presetWeights(-40).night).toBe(1);
  });

  it('is golden for a low sun and blends golden->dusk->night through twilight', () => {
    expect(presetWeights(5).golden).toBe(1);
    const w = presetWeights(-5);
    expect(w.golden).toBeGreaterThan(0);
    expect(w.dusk).toBeGreaterThan(0);
    expect(w.noon + w.night).toBe(0);
    expect(presetWeights(-10).night).toBeGreaterThan(0);
    expect(presetWeights(-10).dusk).toBeGreaterThan(0);
  });

  it('weights always sum to 1', () => {
    for (let a = -90; a <= 90; a += 0.7) expect(sum(presetWeights(a))).toBeCloseTo(1, 9);
  });

  it('blends palette colours channel by channel', () => {
    const only = (k: (typeof PRESET_KEYS)[number]) => ({ noon: 0, golden: 0, dusk: 0, night: 0, [k]: 1 });
    const a = blendHex(only('noon'), (p) => p.bgTop);
    const b = blendHex(only('night'), (p) => p.bgTop);
    const mid = blendHex({ noon: 0.5, golden: 0, dusk: 0, night: 0.5 }, (p) => p.bgTop);
    expect((mid >> 16) & 255).toBe(Math.round((((a >> 16) & 255) + ((b >> 16) & 255)) / 2));
  });

  it('reads dawn pinker and dusk bluer at the same depth below the horizon', () => {
    const dawn = effectiveAltitude({ azimuthDeg: 112, altitudeDeg: -4 });
    const dusk = effectiveAltitude({ azimuthDeg: 248, altitudeDeg: -4 });
    expect(dawn).toBeGreaterThan(dusk);
    expect(presetWeights(dawn).golden).toBeGreaterThan(presetWeights(dusk).golden);
    expect(effectiveAltitude({ azimuthDeg: 170, altitudeDeg: 40 })).toBe(40);
  });
});

describe('lamp stagger', () => {
  it('is deterministic per seed', () => {
    expect(Array.from(lightThresholds('lamp', 50, 1))).toEqual(Array.from(lightThresholds('lamp', 50, 1)));
    expect(Array.from(lightThresholds('lamp', 50, 1))).not.toEqual(Array.from(lightThresholds('lamp', 50, 2)));
  });

  it('lights more lamps as the sun goes lower, none by day, all by night', () => {
    for (const kind of ['lamp', 'bulb', 'window'] as const) {
      const th = lightThresholds(kind, 400, 7);
      let prev = -1;
      for (let a = 10; a >= -20; a -= 0.25) {
        const f = litFraction(th, a);
        expect(f).toBeGreaterThanOrEqual(prev);
        prev = f;
      }
      expect(litFraction(th, 10)).toBe(0);
      expect(litFraction(th, -20)).toBe(1);
    }
  });

  it('switches on one by one, not all at once', () => {
    const th = lightThresholds('window', 400, 1);
    const f = litFraction(th, -5);
    expect(f).toBeGreaterThan(0.2);
    expect(f).toBeLessThan(0.8);
  });
});

describe('city lights from the slice', () => {
  const data = JSON.parse(readFileSync('data/build/slice1.geojson', 'utf8')) as FootprintCollection;
  const specs = data.features
    .filter((f) => f.properties.kind === 'building')
    .map((f) => describeShopHouse(f, 1))
    .filter((s): s is ShopHouseSpec => s !== null);

  it('places windows, shops and street lamps in at most three meshes', () => {
    const l = buildCityLights(specs, data, 1);
    expect(l.stats.windows).toBeGreaterThan(500);
    expect(l.stats.shops).toBeGreaterThan(200);
    expect(l.stats.lamps).toBeGreaterThan(20);
    expect(l.stats.drawMeshes).toBeLessThanOrEqual(3);
    expect(l.count).toBe(l.stats.windows + l.stats.shops + l.stats.lamps);
  });

  it('is the same city every load', () => {
    const a = buildCityLights(specs, data, 1);
    const b = buildCityLights(specs, data, 1);
    expect(a.count).toBe(b.count);
    expect(Array.from(a.thresholds)).toEqual(Array.from(b.thresholds));
  });
});
