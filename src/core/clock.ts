/**
 * World time for PixelJaipur, in Indian Standard Time (UTC+05:30, no DST).
 *
 *   mode 'fixed'   time stands still (screenshots, `?t=`)
 *   mode 'running' time advances at `speed` game-seconds per real second (from a start time)
 *   mode 'live'    follows the real clock (Jaipur "now")
 *
 * Pure: inject `nowMs` in tests. Systems read `clock.now()` every frame.
 */

export const JAIPUR = { lat: 26.9239, lon: 75.8267 } as const;
const IST_OFFSET_MIN = 330;

export type ClockMode = 'fixed' | 'running' | 'live';

export interface WorldTime {
  /** The instant (a real Date; use for suncalc). */
  date: Date;
  /** Hours since local midnight in Jaipur, 0..24 (e.g. 18.75 = 18:45 IST). */
  hoursIST: number;
  /** Day of the year in IST, 1..366 (for festivals like Makar Sankranti on 14 Jan). */
  dayOfYearIST: number;
}

/** Parse "2026-01-14T17:30" (or "...T17:30:15") as IST. Returns null if malformed. */
export function parseIST(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  const utc = Date.UTC(y, mo - 1, d, h, mi, se || 0) - IST_OFFSET_MIN * 60_000;
  const date = new Date(utc);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Format a Date as "YYYY-MM-DDTHH:MM" in IST (inverse of parseIST, minute precision). */
export function formatIST(date: Date): string {
  const t = new Date(date.getTime() + IST_OFFSET_MIN * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

export function worldTime(date: Date): WorldTime {
  const t = new Date(date.getTime() + IST_OFFSET_MIN * 60_000);
  const hoursIST = t.getUTCHours() + t.getUTCMinutes() / 60 + t.getUTCSeconds() / 3600 + t.getUTCMilliseconds() / 3_600_000;
  const start = Date.UTC(t.getUTCFullYear(), 0, 1);
  const dayOfYearIST = Math.floor((Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - start) / 86_400_000) + 1;
  return { date, hoursIST, dayOfYearIST };
}

/** Today's date in IST at the given hour (default: 07:00, morning golden hour on the Hawa Mahal facade). */
export function todayAtIST(hour = 7, nowMs = Date.now()): Date {
  const t = new Date(nowMs + IST_OFFSET_MIN * 60_000);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), hour, 0, 0) - IST_OFFSET_MIN * 60_000);
}

/** Deterministic default for screenshots: a clear winter morning (also Makar Sankranti). */
export const SHOT_DEFAULT = '2026-01-14T07:00';

export class Clock {
  private ms: number;

  constructor(
    start: Date,
    public mode: ClockMode = 'fixed',
    /** game seconds per real second when running */
    public speed = 60,
    private readonly nowMs: () => number = () => Date.now(),
  ) {
    this.ms = start.getTime();
  }

  /** Advance by a real-time delta (seconds). Returns true if world time changed. */
  tick(realDtSec: number): boolean {
    if (this.mode === 'live') {
      const before = this.ms;
      this.ms = this.nowMs();
      return this.ms !== before;
    }
    if (this.mode === 'running' && realDtSec > 0) {
      this.ms += realDtSec * this.speed * 1000;
      return true;
    }
    return false;
  }

  set(date: Date): void {
    this.ms = date.getTime();
  }

  setMode(mode: ClockMode): void {
    this.mode = mode;
    if (mode === 'live') this.ms = this.nowMs();
  }

  now(): WorldTime {
    return worldTime(new Date(this.ms));
  }

  /** True while time flows (systems that depend only on time need continuous frames). */
  get running(): boolean {
    return this.mode !== 'fixed';
  }
}
