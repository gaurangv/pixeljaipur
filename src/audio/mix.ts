import { Vector3 } from 'three';
import { worldToScreen, type ScreenView } from '../render/camera';

/**
 * Pure spatial + time-of-day mixing for sound zones. No Web Audio here, so it is unit-tested.
 * Positions are data coords: x east, y north, metres (three.js z = -y).
 */

export type VoiceKind = 'crowd' | 'traffic' | 'pigeons' | 'bells' | 'chai' | 'birds' | 'crickets' | 'dog';
export const VOICE_KINDS: readonly VoiceKind[] = ['crowd', 'traffic', 'pigeons', 'bells', 'chai', 'birds', 'crickets', 'dog'];

export type Pt2 = [number, number];
/** [hourIST, value 0..1] keys, linear between keys, wrapping at midnight. */
export type Curve = Pt2[];

export interface SoundZone {
  id: string;
  voice: VoiceKind;
  /** One point or a polyline. */
  points: Pt2[];
  /** Ground distance (m) at which the zone is at half level. */
  radius: number;
  /** 0..1 */
  level: number;
  curve: Curve;
  placeholder?: boolean;
}

export interface ZoneFile {
  zones: Array<Omit<SoundZone, 'curve'> & { curve: string | Curve }>;
  curves: Record<string, Curve>;
}

/** Resolve named curves and validate a zone file. Throws on bad data (caught by the system). */
export function parseZones(file: ZoneFile): SoundZone[] {
  return file.zones.map((z) => {
    const curve = typeof z.curve === 'string' ? file.curves[z.curve] : z.curve;
    if (!curve || curve.length === 0) throw new Error(`sound zone ${z.id}: unknown curve ${String(z.curve)}`);
    if (!VOICE_KINDS.includes(z.voice)) throw new Error(`sound zone ${z.id}: unknown voice ${z.voice}`);
    if (!z.points.length || !(z.radius > 0)) throw new Error(`sound zone ${z.id}: needs points and a radius`);
    const sorted = [...curve].sort((a, b) => a[0] - b[0]);
    return { ...z, curve: sorted };
  });
}

/** Sample a time-of-day curve at `hours` (0..24), wrapping across midnight. */
export function curveAt(curve: Curve, hours: number): number {
  const n = curve.length;
  if (n === 1) return curve[0][1];
  const h = ((hours % 24) + 24) % 24;
  for (let i = 0; i + 1 < n; i++) {
    const [h0, v0] = curve[i];
    const [h1, v1] = curve[i + 1];
    if (h >= h0 && h < h1) return v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
  }
  // Between the last key and the first key, across midnight.
  const [hl, vl] = curve[n - 1];
  const [hf, vf] = curve[0];
  const span = hf + 24 - hl;
  if (span <= 0) return vf;
  const t = (h >= hl ? h - hl : h + 24 - hl) / span;
  return vl + (vf - vl) * t;
}

/** Nearest point on a point/polyline to p. */
export function nearestOnPath(points: Pt2[], p: Pt2): Pt2 {
  if (points.length === 1) return points[0];
  let best: Pt2 = points[0];
  let bestD = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2)) : 0;
    const q: Pt2 = [ax + dx * t, ay + dy * t];
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

/** The listener stands at the camera target (data coords). */
export function listenerOf(view: ScreenView): Pt2 {
  return [view.target.x, -view.target.z];
}

/** Half the visible ground width, metres. Larger when zoomed out. */
export function viewHalfWidth(view: ScreenView): number {
  return (view.size.x * view.mpp) / 2;
}

/**
 * The listener "hovers" above the target at a height proportional to the view size.
 * Zoomed out: everything is further away, so quieter and more evenly blended.
 * Zoomed in: the height shrinks and nearby zones dominate.
 */
export function hearingHeight(view: ScreenView): number {
  return 0.5 * viewHalfWidth(view);
}

/** Smooth inverse-square-ish rolloff: 1 at the source, 0.5 at `radius`. */
export function rolloff(dist: number, radius: number): number {
  return 1 / (1 + (dist / radius) ** 2);
}

/** Stereo pan -1..1 of a world point: its screen x relative to the screen centre (respects rotation). */
export function screenPan(p: Pt2, view: ScreenView): number {
  const s = worldToScreen(new Vector3(p[0], 0, -p[1]), view);
  const k = view.zoom / view.dpr;
  const cx = (view.size.x / 2) * k;
  if (cx <= 0) return 0;
  return Math.max(-1, Math.min(1, (s.x - cx) / cx));
}

export const MAX_PAN = 0.85;
/** Below this a zone is treated as silent (scheduled voices skip their events). */
export const SILENT = 0.002;

export interface Mix {
  gain: number;
  pan: number;
}

/** Gain and pan for a source at `points` (spatial only, no time of day). */
export function spatialMix(points: Pt2[], radius: number, level: number, view: ScreenView): Mix {
  const L = listenerOf(view);
  const q = nearestOnPath(points, L);
  const ground = Math.hypot(q[0] - L[0], q[1] - L[1]);
  const h = hearingHeight(view);
  const dist = Math.hypot(ground, h);
  const gain = level * rolloff(dist, radius);
  // Pan fades towards the centre as the listener rises (zoomed out = more blended).
  const blend = dist > 0 ? ground / dist : 0;
  const pan = screenPan(q, view) * MAX_PAN * blend;
  return { gain, pan };
}

/** Full zone mix: spatial x time-of-day. */
export function zoneMix(zone: SoundZone, view: ScreenView, hoursIST: number): Mix {
  const m = spatialMix(zone.points, zone.radius, zone.level, view);
  const g = m.gain * curveAt(zone.curve, hoursIST);
  return { gain: g < SILENT ? 0 : g, pan: m.pan };
}
