import type { WorldEvents } from '../core/events';

/** One-off synth sounds. */
export type OneShotKind = 'horn' | 'flutter' | 'aarti';

export interface Cue {
  kind: OneShotKind;
  x: number;
  y: number;
  /** Ground distance (m) at which the cue is at half level. */
  radius: number;
  /** 0..1 before distance attenuation. */
  level: number;
}

/** Which world events make a sound, and how loud / far it carries. */
export const EVENT_CUES = {
  horn: { kind: 'horn', radius: 40, level: 0.45 },
  pigeonsBurst: { kind: 'flutter', radius: 30, level: 0.6 },
  aarti: { kind: 'aarti', radius: 60, level: 0.55 },
} as const satisfies Partial<Record<keyof WorldEvents, Omit<Cue, 'x' | 'y'>>>;

export type CueEvent = keyof typeof EVENT_CUES;
export const CUE_EVENTS = Object.keys(EVENT_CUES) as CueEvent[];

/** Map an event payload to a positioned cue. */
export function cueFor<K extends CueEvent>(type: K, payload: WorldEvents[K]): Cue {
  const c = EVENT_CUES[type];
  return { kind: c.kind, radius: c.radius, level: c.level, x: payload.x, y: payload.y };
}
