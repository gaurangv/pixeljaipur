import type { WorldTime } from './clock';

/**
 * Typed event bus so Phase 2 systems can talk without importing each other
 * (e.g. traffic emits `horn`, sound plays it). Add new events here; keep payloads small.
 * Positions are data coords: x east, y north, metres.
 */
export interface WorldEvents {
  /** A vehicle sounded its horn (traffic -> sound). */
  horn: { x: number; y: number; kind: string };
  /** Pigeons took off from a ledge (traffic/birds -> sound). */
  pigeonsBurst: { x: number; y: number };
  /** Fraction of street lamps now lit, 0..1 (day-cycle -> anyone). */
  lampsOn: { fraction: number };
  /** Temple aarti started (day-cycle schedule -> sound). */
  aarti: { x: number; y: number };
  /** The sun moved to a new step; shadows were refreshed (day-cycle -> anyone). */
  sunStep: { time: WorldTime; altitudeDeg: number };
  /** The user clicked the ground at a world point (main -> anyone, e.g. pigeons). */
  groundClick: { x: number; y: number };
}

type Handler<K extends keyof WorldEvents> = (payload: WorldEvents[K]) => void;

export class EventBus {
  private readonly handlers = new Map<keyof WorldEvents, Set<Handler<any>>>();

  on<K extends keyof WorldEvents>(type: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof WorldEvents>(type: K, payload: WorldEvents[K]): void {
    for (const fn of this.handlers.get(type) ?? []) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[pixeljaipur] handler for '${String(type)}' failed`, err);
      }
    }
  }
}
