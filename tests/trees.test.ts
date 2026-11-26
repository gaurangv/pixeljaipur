import { describe, expect, it } from 'vitest';
import slice from '../data/build/slice1.geojson?raw';
import type { FootprintCollection } from '../src/world/footprints';
import { pointInRing, type Pt } from '../src/world/geometry';
import { placeTrees } from '../src/world/trees';

const data = JSON.parse(slice) as FootprintCollection;
const polys = (k: string) =>
  data.features
    .filter((f) => f.properties.kind === k)
    .flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [])) as Pt[][][];
const inside = (x: number, y: number, rings: Pt[][]) => pointInRing(x, y, rings[0]) && !rings.slice(1).some((h) => pointInRing(x, y, h));

describe('placeTrees on the real slice', () => {
  const trees = placeTrees(data, 1);

  it('places a reasonable number of trees, deterministically', () => {
    expect(trees.length).toBeGreaterThan(20);
    expect(trees.length).toBeLessThan(600);
    expect(placeTrees(data, 1)).toEqual(trees);
  });

  it('never puts a trunk on a road, footpath or building', () => {
    const blockers = [...polys('road'), ...polys('footway'), ...polys('building')];
    for (const t of trees) {
      const hit = blockers.some((p) => inside(t.x, t.y, p));
      // courtyard trees sit in a building's hole, which `inside` already treats as outside
      expect(hit, `tree at ${t.x},${t.y}`).toBe(false);
    }
  });

  it('keeps every tree on the diorama base', () => {
    const boundary = data.properties!.boundary as Pt[];
    for (const t of trees) expect(pointInRing(t.x, t.y, boundary), `tree at ${t.x},${t.y}`).toBe(true);
  });

  it('keeps canopies from overlapping', () => {
    for (let i = 0; i < trees.length; i++) {
      for (let j = i + 1; j < trees.length; j++) {
        const d = Math.hypot(trees[i].x - trees[j].x, trees[i].y - trees[j].y);
        expect(d).toBeGreaterThanOrEqual(Math.min(trees[i].r, trees[j].r));
      }
    }
  });
});
