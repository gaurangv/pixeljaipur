import { describe, expect, it } from 'vitest';
import { describeShopHouse, FLOOR_H, GROUND_FLOOR_H } from '../src/world/shopHouse';
import type { FootprintFeature } from '../src/world/footprints';

// 12 x 8 m rectangle, CCW, front on edge 0 (the south side, y = 0)
const rect = (id: string, extra: Partial<FootprintFeature['properties']> = {}, w = 12, d = 8): FootprintFeature => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [w, 0], [w, d], [0, d], [0, 0]]] },
  properties: { kind: 'building', id, front: [0], ...extra },
});

describe('describeShopHouse', () => {
  it('is deterministic for the same id and seed', () => {
    expect(describeShopHouse(rect('way/1'))).toEqual(describeShopHouse(rect('way/1')));
  });

  it('changes with the world seed', () => {
    const specs = [1, 2, 3, 4, 5, 6].map((s) => JSON.stringify(describeShopHouse(rect('way/9'), s)));
    expect(new Set(specs).size).toBeGreaterThan(1);
  });

  it('gives bazaar frontages a uniform 3 storeys', () => {
    for (let i = 0; i < 20; i++) {
      const s = describeShopHouse(rect(`gen/${i}`, { bazaar: true }))!;
      expect(s.levels).toBe(3);
      expect(s.height).toBeCloseTo(GROUND_FLOOR_H + 2 * FLOOR_H);
      expect(s.wall).toBe('terracotta');
    }
  });

  it('makes tiny plots single-storey kiosks without an arcade', () => {
    const s = describeShopHouse(rect('k', {}, 4, 4))!;
    expect(s.levels).toBe(1);
    expect(s.fronts[0].arcade).toBe(false);
    expect(s.fronts[0].jharokhas).toEqual([]);
  });

  it('respects mapped floor counts', () => {
    expect(describeShopHouse(rect('m', { levels: 5 }))!.levels).toBe(5);
  });

  it('splits a 12 m front into ~3.2 m bays with one jharokha row per upper floor', () => {
    const s = describeShopHouse(rect('b', { bazaar: true }))!;
    expect(s.fronts).toHaveLength(1);
    expect(s.fronts[0].bays).toBe(4);
    expect(s.fronts[0].jharokhas).toHaveLength(2);
    expect(s.fronts[0].jharokhas[0]).toHaveLength(4);
  });

  it('only decorates listed front edges', () => {
    expect(describeShopHouse(rect('n', { front: [] }))!.fronts).toEqual([]);
  });
});
