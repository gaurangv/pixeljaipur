import { describe, expect, it } from 'vitest';
import { pointInRing } from '../src/world/geometry';
import { describeRoof } from '../src/world/roofs';
import { describeShopHouse } from '../src/world/shopHouse';
import type { FootprintFeature } from '../src/world/footprints';

const L: FootprintFeature = {
  type: 'Feature',
  // an L-shaped 3-storey block with a courtyard-free notch, CCW
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [20, 0], [20, 8], [8, 8], [8, 16], [0, 16], [0, 0]]] },
  properties: { kind: 'building', id: 'L', front: [0], levels: 3 },
};
const kiosk: FootprintFeature = {
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]]] },
  properties: { kind: 'building', id: 'k', front: [0] },
};

describe('describeRoof', () => {
  it('is deterministic', () => {
    const s = describeShopHouse(L)!;
    expect(describeRoof(s)).toEqual(describeRoof(s));
  });

  it('keeps every roof item on the roof, never in the notch, across many seeds', () => {
    const ring = L.geometry.coordinates[0] as [number, number][];
    for (let seed = 1; seed <= 60; seed++) {
      const s = describeShopHouse(L, seed)!;
      const r = describeRoof(s, seed);
      const pts = [r.mumty?.at, r.dish, r.laundry?.a, r.laundry?.b, ...r.tanks.map((t) => t.at)].filter(Boolean) as [number, number][];
      for (const [x, y] of pts) expect(pointInRing(x, y, ring)).toBe(true);
    }
  });

  it('gives kiosks no stair room, dish or laundry', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = describeRoof(describeShopHouse(kiosk, seed)!, seed);
      expect(r.mumty).toBeNull();
      expect(r.dish).toBeNull();
      expect(r.laundry).toBeNull();
    }
  });

  it('puts a stair room on most multi-storey roofs', () => {
    let n = 0;
    for (let seed = 1; seed <= 100; seed++) if (describeRoof(describeShopHouse(L, seed)!, seed).mumty) n++;
    expect(n).toBeGreaterThan(50);
  });
});
