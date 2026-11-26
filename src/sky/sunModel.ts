import { getPosition } from 'suncalc';
import { JAIPUR, formatIST, parseIST } from '../core/clock';
import { palette, type PaletteKey } from '../render/palette';
import { mulberry32, hashString } from '../world/rng';

/*
 * Pure day-cycle model (no three.js scene objects): sun position, step quantisation,
 * key-light choice, preset weights and the lamp stagger. Unit-tested in tests/daycycle.test.ts.
 */

/** Sun direction only changes every STEP_MIN game minutes, so low-res shadows don't swim. */
export const STEP_MIN = 10;
const STEP_MS = STEP_MIN * 60_000;

export interface SunPos {
  /** degrees clockwise from north */
  azimuthDeg: number;
  /** degrees above the horizon (negative = below) */
  altitudeDeg: number;
}

/** Sun over Jaipur at an instant (suncalc v2: degrees, azimuth clockwise from north). */
export function sunPosition(date: Date): SunPos {
  const p = getPosition(date, JAIPUR.lat, JAIPUR.lon);
  return { azimuthDeg: ((p.azimuth % 360) + 360) % 360, altitudeDeg: p.altitude };
}

/** Index of the 10-minute step containing `date` (IST is UTC+5:30, so steps align with IST :00, :10, ...). */
export function stepIndex(date: Date): number {
  return Math.floor(date.getTime() / STEP_MS);
}

/** Start instant of a step. */
export function stepStart(index: number): Date {
  return new Date(index * STEP_MS);
}

/** Remembers the last step; `check()` is true only when game time crossed into a new step. */
export class SunStepper {
  private last: number | null = null;
  check(date: Date): boolean {
    const i = stepIndex(date);
    if (i === this.last) return false;
    this.last = i;
    return true;
  }
  get index(): number | null {
    return this.last;
  }
}

// ---------------------------------------------------------------------------
// Key light: one DirectionalLight plays sun, twilight sky glow and moon.
// ---------------------------------------------------------------------------

/** Lowest elevation the key light uses, so a low sun still gives readable (not endless) shadows. */
export const KEY_MIN_ELEV = 15;
/** Below this sun altitude the key light switches from the sun's side of the sky to the moon. */
export const KEY_SWITCH_ALT = -8;
/** Night key ("moon") direction: high in the south-west, fixed so shadows stay put all night. */
export const MOON = { azimuthDeg: 215, elevationDeg: 55 };

export type KeySource = 'sun' | 'twilight' | 'moon';

export interface KeyLight {
  azimuthDeg: number;
  elevationDeg: number;
  /** 0..1 multiplier on the preset's key intensity */
  scale: number;
  source: KeySource;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/**
 * Where the key light comes from and how strong it is, for a sun position.
 * Above the horizon it is the sun. Just below (civil twilight) the sun lights nothing; the key
 * becomes the bright sky on the sun's side: same azimuth, fixed elevation, fading to 0 at the
 * switch altitude. Below that the moon fades in. Both are 0 at the switch, so the jump is invisible.
 */
export function keyLight(sun: SunPos): KeyLight {
  const alt = sun.altitudeDeg;
  if (alt >= 0) {
    return { azimuthDeg: sun.azimuthDeg, elevationDeg: Math.max(KEY_MIN_ELEV, alt), scale: keyScale('sun', alt), source: 'sun' };
  }
  if (alt > KEY_SWITCH_ALT) {
    return { azimuthDeg: sun.azimuthDeg, elevationDeg: KEY_MIN_ELEV, scale: keyScale('twilight', alt), source: 'twilight' };
  }
  return { azimuthDeg: MOON.azimuthDeg, elevationDeg: MOON.elevationDeg, scale: keyScale('moon', alt), source: 'moon' };
}

/**
 * Key-light strength for a source at a (continuous) sun altitude. The direction only moves
 * in steps, but the strength can follow the clock smoothly; both sources are 0 at the switch.
 */
export function keyScale(source: KeySource, altDeg: number): number {
  if (source === 'moon') return smooth(KEY_SWITCH_ALT, KEY_SWITCH_ALT - 6, altDeg);
  return smooth(KEY_SWITCH_ALT, -3, altDeg);
}

/** Dawn/dusk asymmetry in degrees (see effectiveAltitude). */
export const TWILIGHT_BIAS = 1.5;

/**
 * The altitude the look is computed from. A stylisation: near the horizon, mornings read
 * as if the sun were TWILIGHT_BIAS degrees higher (pink dawn) and evenings as if it were lower
 * (the blue hour comes sooner). Faded out by 14 degrees, so the day itself is untouched.
 */
export function effectiveAltitude(sun: SunPos): number {
  const rising = sun.azimuthDeg < 180;
  const k = 1 - smooth(6, 14, sun.altitudeDeg);
  return sun.altitudeDeg + (rising ? TWILIGHT_BIAS : -TWILIGHT_BIAS) * k;
}

// ---------------------------------------------------------------------------
// Lighting presets blended by sun altitude
// ---------------------------------------------------------------------------

export type PresetKey = 'noon' | 'golden' | 'dusk' | 'night';
export const PRESET_KEYS: readonly PresetKey[] = ['noon', 'golden', 'dusk', 'night'];

export interface Preset {
  key: PaletteKey;
  keyIntensity: number;
  hemiSky: PaletteKey;
  hemiGround: PaletteKey;
  hemiIntensity: number;
  shadow: number; // shadow darkness 0..1
  bgTop: PaletteKey;
  bgBottom: PaletteKey;
}

export const PRESETS: Record<PresetKey, Preset> = {
  noon: { key: 'keyNoon', keyIntensity: 2.6, hemiSky: 'hemiSkyNoon', hemiGround: 'hemiGroundNoon', hemiIntensity: 2.0, shadow: 1, bgTop: 'bgTopNoon', bgBottom: 'bgBottomNoon' },
  golden: { key: 'keyGolden', keyIntensity: 2.4, hemiSky: 'hemiSkyGolden', hemiGround: 'hemiGroundGolden', hemiIntensity: 1.9, shadow: 0.95, bgTop: 'bgTopGolden', bgBottom: 'bgBottomGolden' },
  dusk: { key: 'keyDusk', keyIntensity: 1.7, hemiSky: 'hemiSkyDusk', hemiGround: 'hemiGroundDusk', hemiIntensity: 1.55, shadow: 0.6, bgTop: 'bgTopDusk', bgBottom: 'bgBottomDusk' },
  night: { key: 'keyNight', keyIntensity: 1.25, hemiSky: 'hemiSkyNight', hemiGround: 'hemiGroundNight', hemiIntensity: 1.0, shadow: 0.6, bgTop: 'bgTopNight', bgBottom: 'bgBottomNight' },
};

/**
 * Anchor altitudes (degrees) of the piecewise-linear blend. Golden is a plateau from just
 * before sunrise (the pink pre-dawn glow) to 9 degrees; noon is reached at 32 degrees.
 */
const ANCHORS: readonly [number, PresetKey][] = [
  [-13, 'night'],
  [-7, 'dusk'],
  [-2.5, 'golden'],
  [9, 'golden'],
  [32, 'noon'],
];

/** Weights of the four presets at a sun altitude (non-negative, sum 1). */
export function presetWeights(altDeg: number): Record<PresetKey, number> {
  const w: Record<PresetKey, number> = { noon: 0, golden: 0, dusk: 0, night: 0 };
  if (altDeg <= ANCHORS[0][0]) {
    w[ANCHORS[0][1]] = 1;
    return w;
  }
  const last = ANCHORS[ANCHORS.length - 1];
  if (altDeg >= last[0]) {
    w[last[1]] = 1;
    return w;
  }
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const [a0, k0] = ANCHORS[i];
    const [a1, k1] = ANCHORS[i + 1];
    if (altDeg >= a0 && altDeg <= a1) {
      const t = (altDeg - a0) / (a1 - a0);
      w[k0] += 1 - t;
      w[k1] += t;
      break;
    }
  }
  return w;
}

/** Linear-ish hex blend of palette colours by weights (sRGB space; fine for these gentle mixes). */
export function blendHex(weights: Record<PresetKey, number>, pickKey: (p: Preset) => PaletteKey): number {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const k of PRESET_KEYS) {
    const wt = weights[k];
    if (!wt) continue;
    const hex = palette[pickKey(PRESETS[k])];
    r += ((hex >> 16) & 255) * wt;
    g += ((hex >> 8) & 255) * wt;
    b += (hex & 255) * wt;
  }
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

export function blendNumber(weights: Record<PresetKey, number>, pickNum: (p: Preset) => number): number {
  let v = 0;
  for (const k of PRESET_KEYS) v += weights[k] * pickNum(PRESETS[k]);
  return v;
}

// ---------------------------------------------------------------------------
// City lights: staggered by a seeded per-light threshold on sun altitude
// ---------------------------------------------------------------------------

export type LightKind = 'lamp' | 'bulb' | 'window';

/** Sun-altitude window (degrees) in which each kind switches on: street lamps first, homes last. */
export const LIGHT_RANGES: Record<LightKind, [number, number]> = {
  lamp: [1.5, -4.5],
  bulb: [0.5, -6.5],
  window: [-1, -10],
};

/** Deterministic thresholds: light i is on while the sun is below thresholds[i]. */
export function lightThresholds(kind: LightKind, count: number, seed: number): Float32Array {
  const rng = mulberry32(hashString(`${seed}:lights:${kind}`));
  const [hi, lo] = LIGHT_RANGES[kind];
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = hi + (lo - hi) * rng();
  return out;
}

export function isLit(threshold: number, altDeg: number): boolean {
  return altDeg < threshold;
}

export function litFraction(thresholds: ArrayLike<number>, altDeg: number): number {
  if (!thresholds.length) return 0;
  let n = 0;
  for (let i = 0; i < thresholds.length; i++) if (altDeg < thresholds[i]) n++;
  return n / thresholds.length;
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

/** The IST calendar day of `date` at hours h (0..24, fractional ok). */
export function atHourIST(date: Date, hours: number): Date {
  const day = formatIST(date).slice(0, 10);
  const base = parseIST(`${day}T00:00`)!;
  return new Date(base.getTime() + Math.round(hours * 60) * 60_000);
}

/** Golden-hour target altitude for the "Golden hour" button. */
export const GOLDEN_ALT = 7;

/**
 * Morning golden hour on the IST day of `date`: the minute the sun reaches GOLDEN_ALT
 * (about 07:50 in January, 06:15 in June). Plain 07:00 is still before sunrise in winter.
 */
export function morningGoldenHour(date: Date): Date {
  let lo = atHourIST(date, 4).getTime();
  let hi = atHourIST(date, 11).getTime();
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (sunPosition(new Date(mid)).altitudeDeg < GOLDEN_ALT) lo = mid;
    else hi = mid;
  }
  return new Date(Math.round(hi / 60_000) * 60_000);
}
