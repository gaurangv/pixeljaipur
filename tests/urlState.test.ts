import { describe, expect, it } from 'vitest';
import { formatHash, parseHash } from '../src/ui/urlState';

describe('url hash state', () => {
  it('round-trips a view', () => {
    const v = { zoom: 4, x: 25.26, y: -147.04, rot: 3 };
    expect(parseHash(formatHash(v))).toEqual({ zoom: 4, x: 25.3, y: -147, rot: 3 });
  });

  it('wraps rotation and rounds zoom', () => {
    expect(formatHash({ zoom: 3.4, x: 0, y: 0, rot: -1 })).toBe('#3/0/0/3');
  });

  it('accepts a hash without rotation', () => {
    expect(parseHash('#2/10/20')).toEqual({ zoom: 2, x: 10, y: 20 });
  });

  it('rejects junk and out-of-range zoom', () => {
    expect(parseHash('#hello')).toBeNull();
    expect(parseHash('#0/1/2/0')).toBeNull();
    expect(parseHash('#99/1/2/0')).toBeNull();
    expect(parseHash('')).toBeNull();
  });
});
