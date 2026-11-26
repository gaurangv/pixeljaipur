import type { OneShotKind } from './cues';
import type { VoiceKind } from './mix';

/**
 * Real recordings to source later (freesound.org, CC0 or CC-BY only). Until a `file` is set,
 * the synth placeholder in voices.ts plays. To swap one in: drop the file in public/assets/audio/,
 * set `file` (and `author` + `sourceUrl`), add the line to public/assets/LICENSES.md, and
 * soundSystem() will load it through bufferVoice() instead of the synth.
 */
export type Licence = 'CC0-1.0' | 'CC-BY-4.0' | 'CC-BY-3.0';

export interface RecordingSpec {
  /** Short, unique name (also the suggested file stem). */
  name: string;
  /** Which voice it replaces: an ambient zone voice or a one-shot. */
  voice: VoiceKind | OneShotKind;
  /** Where it plays (zone ids in data/sound_zones.json, or the event name). */
  zone: string;
  /** Suggested freesound.org search. */
  query: string;
  /** Licences we accept for this sound (CC-BY needs an attribution line). */
  licence: readonly Licence[];
  /** Loop seamlessly (ambient beds) or play once (one-shots / scheduled notes). */
  loop: boolean;
  /** Priority to source: 1 = first. */
  priority: 1 | 2 | 3;
  notes?: string;
  /** Filled in once sourced. */
  file?: string;
  author?: string;
  sourceUrl?: string;
}

const ANY: readonly Licence[] = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-3.0'];

export const RECORDINGS: readonly RecordingSpec[] = [
  {
    name: 'bazaar-crowd-evening',
    voice: 'crowd',
    zone: 'crowd-*',
    query: 'indian market crowd ambience evening',
    licence: ANY,
    loop: true,
    priority: 1,
    notes: 'Hindi/Rajasthani voices, no music; 60 s+ loop. Jaipur or Delhi bazaar ideal.',
  },
  {
    name: 'traffic-hum-india',
    voice: 'traffic',
    zone: 'traffic-*',
    query: 'india street traffic ambience distant horns',
    licence: ANY,
    loop: true,
    priority: 1,
    notes: 'Mixed autos and scooters; prefer a bed with few close horns (horns are one-shots).',
  },
  {
    name: 'auto-rickshaw-horn',
    voice: 'horn',
    zone: 'event:horn',
    query: 'auto rickshaw horn',
    licence: ANY,
    loop: false,
    priority: 1,
    notes: 'Several takes (single and double beeps) so repeats vary.',
  },
  {
    name: 'temple-bells-aarti',
    voice: 'aarti',
    zone: 'event:aarti',
    query: 'hindu temple aarti bell',
    licence: ANY,
    loop: false,
    priority: 1,
    notes: 'Hand bell (ghanti) ringing; 5-10 s; no chanting if possible.',
  },
  {
    name: 'pigeons-cooing',
    voice: 'pigeons',
    zone: 'pigeons-hawa-mahal',
    query: 'rock pigeons cooing',
    licence: ANY,
    loop: true,
    priority: 1,
  },
  {
    name: 'pigeons-takeoff',
    voice: 'flutter',
    zone: 'event:pigeonsBurst',
    query: 'pigeons flock take off wings',
    licence: ANY,
    loop: false,
    priority: 2,
  },
  {
    name: 'temple-bell-single',
    voice: 'bells',
    zone: 'bells-bazaar-temple',
    query: 'temple bell single strike india',
    licence: ANY,
    loop: false,
    priority: 2,
    notes: 'Large hanging bell (ghanta), clean decay.',
  },
  {
    name: 'chai-seller-call',
    voice: 'chai',
    zone: 'chai-*',
    query: 'chai wala call india',
    licence: ANY,
    loop: false,
    priority: 2,
    notes: 'Or record one: "chai, garam chai". Several takes.',
  },
  {
    name: 'morning-birds-india',
    voice: 'birds',
    zone: 'birds-*',
    query: 'india morning birds mynas sparrows',
    licence: ANY,
    loop: true,
    priority: 3,
  },
  {
    name: 'crickets-night',
    voice: 'crickets',
    zone: 'crickets-everywhere',
    query: 'crickets night ambience',
    licence: ANY,
    loop: true,
    priority: 3,
  },
  {
    name: 'dog-barking-distant',
    voice: 'dog',
    zone: 'dog-distant',
    query: 'dog barking distant night',
    licence: ANY,
    loop: false,
    priority: 3,
  },
];

/** Ambient voices with a sourced looping file (used instead of the synth). */
export function recordedLoops(list: readonly RecordingSpec[] = RECORDINGS): Map<string, RecordingSpec> {
  const m = new Map<string, RecordingSpec>();
  for (const r of list) if (r.file && r.loop) m.set(r.voice, r);
  return m;
}
