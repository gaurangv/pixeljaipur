import { describe, expect, it } from 'vitest';
import { searchEntries, type SearchEntry } from '../src/ui/search';

const E: SearchEntry[] = [
  { label: 'Hawa Mahal', hint: 'हवा महल', x: 0, y: 0, placeId: 'hawa-mahal' },
  { label: 'Hawa Mahal Road', hint: 'Street', x: 0, y: 0 },
  { label: 'Johari Bazar', hint: 'Street', x: 0, y: 0 },
  { label: 'Badi Chaupar', x: 0, y: 0, placeId: 'badi-chaupar' },
  { label: 'Chandpol Bazaar', hint: 'Street', x: 0, y: 0 },
];

describe('searchEntries', () => {
  it('ranks places and prefix matches first, case-insensitively', () => {
    expect(searchEntries(E, 'hawa').map((e) => e.label)).toEqual(['Hawa Mahal', 'Hawa Mahal Road']);
    expect(searchEntries(E, 'BAZ').map((e) => e.label)).toEqual(['Johari Bazar', 'Chandpol Bazaar']);
  });
  it('matches word starts, substrings and Hindi hints', () => {
    expect(searchEntries(E, 'chaup')[0].label).toBe('Badi Chaupar');
    expect(searchEntries(E, 'महल')[0].label).toBe('Hawa Mahal');
  });
  it('returns nothing for an empty query', () => {
    expect(searchEntries(E, '   ')).toEqual([]);
  });
});
