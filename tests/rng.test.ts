import { describe, expect, it } from 'vitest';
import { hashString, int, mulberry32, rngFor } from '../src/world/rng';

describe('rng', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect(Array.from({ length: 5 }, a)).toEqual(Array.from({ length: 5 }, b));
  });

  it('differs between ids and stays in [0, 1)', () => {
    const a = rngFor('way/1');
    const b = rngFor('way/2');
    const xs = Array.from({ length: 1000 }, a);
    expect(xs[0]).not.toBe(b());
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
  });

  it('hashes strings stably', () => {
    expect(hashString('way/123')).toBe(hashString('way/123'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });

  it('int covers its inclusive range', () => {
    const r = mulberry32(7);
    const seen = new Set(Array.from({ length: 500 }, () => int(r, 2, 4)));
    expect([...seen].sort()).toEqual([2, 3, 4]);
  });
});
