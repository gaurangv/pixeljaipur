import { describe, expect, it } from 'vitest';
import { decodeRle } from '../src/ui/minimap';

describe('minimap RLE', () => {
  it('decodes run-length pairs', () => {
    expect(decodeRle('3O2X1B', 6)).toBe('OOOXXB');
  });
  it('throws when the size is wrong (corrupt data)', () => {
    expect(() => decodeRle('3O', 4)).toThrow();
  });
});
