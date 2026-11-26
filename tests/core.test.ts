import { describe, expect, it, vi } from 'vitest';
import { Clock, formatIST, parseIST, todayAtIST, worldTime } from '../src/core/clock';
import { EventBus } from '../src/core/events';
import { Systems, type System } from '../src/core/systems';

describe('clock (IST)', () => {
  it('parses and formats IST round-trip', () => {
    const d = parseIST('2026-01-14T17:30')!;
    expect(d.toISOString()).toBe('2026-01-14T12:00:00.000Z');
    expect(formatIST(d)).toBe('2026-01-14T17:30');
    expect(parseIST('14/01/2026')).toBeNull();
  });

  it('reports local hours and day of year in IST, across UTC midnight', () => {
    const late = worldTime(parseIST('2026-01-14T23:45')!); // 18:15 UTC same day
    expect(late.hoursIST).toBeCloseTo(23.75);
    expect(late.dayOfYearIST).toBe(14);
    const early = worldTime(parseIST('2026-01-15T02:00')!); // 20:30 UTC on the 14th
    expect(early.hoursIST).toBeCloseTo(2);
    expect(early.dayOfYearIST).toBe(15);
  });

  it('todayAtIST gives the IST calendar day even late in UTC', () => {
    const now = Date.UTC(2026, 0, 14, 20, 0); // 01:30 IST on the 15th
    expect(formatIST(todayAtIST(7, now))).toBe('2026-01-15T07:00');
  });

  it('fixed does not move, running advances at speed, live follows the real clock', () => {
    let real = 1_000_000;
    const start = parseIST('2026-01-14T07:00')!;
    const fixed = new Clock(start, 'fixed', 60, () => real);
    expect(fixed.tick(10)).toBe(false);
    expect(formatIST(fixed.now().date)).toBe('2026-01-14T07:00');

    const run = new Clock(start, 'running', 60, () => real);
    run.tick(10); // 10 real s * 60 = 10 game minutes
    expect(formatIST(run.now().date)).toBe('2026-01-14T07:10');

    const live = new Clock(start, 'live', 60, () => real);
    real = parseIST('2026-03-01T12:00')!.getTime();
    live.tick(0.016);
    expect(formatIST(live.now().date)).toBe('2026-03-01T12:00');
  });
});

describe('event bus', () => {
  it('delivers to subscribers and unsubscribes', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const off = bus.on('horn', fn);
    bus.emit('horn', { x: 1, y: 2, kind: 'auto' });
    off();
    bus.emit('horn', { x: 3, y: 4, kind: 'auto' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ x: 1, y: 2, kind: 'auto' });
  });

  it('keeps going when one handler throws', () => {
    const bus = new EventBus();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = vi.fn();
    bus.on('pigeonsBurst', () => {
      throw new Error('boom');
    });
    bus.on('pigeonsBurst', ok);
    bus.emit('pigeonsBurst', { x: 0, y: 0 });
    expect(ok).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('systems registry', () => {
  const sys = (id: string, anim = false): System => ({ id, init: vi.fn(), update: vi.fn(), animating: () => anim });

  it('rejects duplicate ids', () => {
    expect(() => new Systems([sys('a'), sys('a')])).toThrow();
  });

  it('isolates failures and reports animating if any system animates', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad: System = { id: 'bad', init: () => { throw new Error('x'); }, update: () => { throw new Error('y'); }, animating: () => false };
    const good = sys('good', true);
    const s = new Systems([bad, good]);
    await s.init({} as never);
    s.update(0.016, worldTime(new Date()), {} as never);
    expect(good.init).toHaveBeenCalled();
    expect(good.update).toHaveBeenCalled();
    expect(s.animating()).toBe(true);
    err.mockRestore();
  });
});
