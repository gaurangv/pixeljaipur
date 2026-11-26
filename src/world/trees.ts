import { Group, IcosahedronGeometry } from 'three';
import type { PaletteKey } from '../render/palette';
import type { FootprintCollection, FootprintFeature } from './footprints';
import { pointInRing, type Pt } from './geometry';
import { at, Batch, unitBox } from './instancing';
import { chance, int, range, rngFor, type Rng } from './rng';

/*
 * Neem and peepal trees: in gardens, in courtyards, and scattered over open ground.
 * placeTrees() is pure and tested (never on roads, footpaths or buildings);
 * buildTrees() draws low-poly canopies with three greens, all instanced.
 */

export interface TreeSpot {
  x: number;
  y: number;
  /** canopy radius, metres */
  r: number;
  variant: number;
}

type Rings = Pt[][];
interface Area {
  rings: Rings;
  box: [number, number, number, number];
}

function polygonsOf(f: FootprintFeature): Rings[] {
  const g = f.geometry;
  if (g.type === 'Polygon') return [g.coordinates as Rings];
  if (g.type === 'MultiPolygon') return g.coordinates as Rings[];
  return [];
}

function toArea(rings: Rings): Area {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of rings[0]) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { rings, box: [x0, y0, x1, y1] };
}

function inArea(a: Area, x: number, y: number, pad = 0): boolean {
  const [x0, y0, x1, y1] = a.box;
  if (x < x0 - pad || x > x1 + pad || y < y0 - pad || y > y1 + pad) return false;
  return pointInRing(x, y, a.rings[0]) && !a.rings.slice(1).some((h) => pointInRing(x, y, h));
}

/** Is a canopy of radius r at (x, y) clear of all blockers (centre + 4 rim points)? */
function clear(blockers: Area[], x: number, y: number, r: number): boolean {
  const pts: Pt[] = [[x, y], [x + r, y], [x - r, y], [x, y + r], [x, y - r]];
  return !blockers.some((b) => pts.some(([px, py]) => inArea(b, px, py, r)));
}

function ringArea(r: Pt[]): number {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return Math.abs(a / 2);
}

function ringCentroid(r: Pt[]): Pt {
  let x = 0;
  let y = 0;
  const n = r.length - 1;
  for (let i = 0; i < n; i++) {
    x += r[i][0];
    y += r[i][1];
  }
  return [x / n, y / n];
}

export function placeTrees(data: FootprintCollection, worldSeed = 1): TreeSpot[] {
  const rng: Rng = rngFor('trees', worldSeed);
  const kind = (k: string) => data.features.filter((f) => f.properties.kind === k);
  const blockers = ['building', 'road', 'footway'].flatMap(kind).flatMap(polygonsOf).map(toArea);
  const buildingsOnly = kind('building').flatMap(polygonsOf).map(toArea);
  const green = kind('green').flatMap(polygonsOf).map(toArea);
  const open = kind('open').flatMap(polygonsOf).map(toArea);
  const trees: TreeSpot[] = [];
  const add = (x: number, y: number, r: number) => {
    if (trees.some((t) => Math.hypot(t.x - x, t.y - y) < t.r + r)) return;
    trees.push({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, r, variant: int(rng, 0, 2) });
  };

  // 1. Gardens: a loose grid with jitter.
  for (const g of green) {
    const [x0, y0, x1, y1] = g.box;
    for (let x = x0 + 3; x < x1; x += 7) {
      for (let y = y0 + 3; y < y1; y += 7) {
        const px = x + range(rng, -2, 2);
        const py = y + range(rng, -2, 2);
        const r = range(rng, 2.2, 3.4);
        if (inArea(g, px, py) && chance(rng, 0.7) && clear(blockers, px, py, r)) add(px, py, r);
      }
    }
  }

  // 2. Courtyards: the hole in a haveli gets one big tree.
  for (const b of buildingsOnly) {
    for (const hole of b.rings.slice(1)) {
      if (ringArea(hole) < 40) continue;
      const [cx, cy] = ringCentroid(hole);
      const r = Math.min(3.2, Math.sqrt(ringArea(hole)) * 0.35);
      if (pointInRing(cx, cy, hole) && clear(buildingsOnly.filter((o) => o !== b), cx, cy, r)) add(cx, cy, r);
    }
  }

  // 3. Open ground between buildings: sparse, never on squares/paving.
  const all = [...blockers, ...open, ...green];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const a of all) {
    x0 = Math.min(x0, a.box[0]);
    y0 = Math.min(y0, a.box[1]);
    x1 = Math.max(x1, a.box[2]);
    y1 = Math.max(y1, a.box[3]);
  }
  const target = Math.round(((x1 - x0) * (y1 - y0)) / 2500);
  for (let i = 0, placed = 0; i < target * 12 && placed < target; i++) {
    const px = range(rng, x0, x1);
    const py = range(rng, y0, y1);
    const r = range(rng, 1.8, 3.0);
    if (clear([...blockers, ...open], px, py, r + 0.5)) {
      add(px, py, r);
      placed++;
    }
  }
  return trees;
}

const GREENS: PaletteKey[] = ['treeDark', 'treeMid', 'treeLight'];

export function buildTrees(trees: TreeSpot[], worldSeed = 1): Group {
  const blob = new IcosahedronGeometry(1, 0);
  const trunk = new Batch('tree:trunk', unitBox, 'trunk');
  const canopy = Object.fromEntries(GREENS.map((k) => [k, new Batch(`tree:${k}`, blob, k)])) as Record<PaletteKey, Batch>;
  for (const t of trees) {
    const rng = rngFor(`tree:${t.x},${t.y}`, worldSeed);
    // Neem/peepal: short trunk, broad low canopy (canopy centre at h).
    const R = t.r * 1.25;
    const h = R * 0.9 + range(rng, 1.6, 2.4);
    const z = -t.y;
    trunk.add(at(t.x, (h - R * 0.4) / 2, z, 0.4, h - R * 0.4, 0.4));
    // 3 blobs: a big dark one, lighter ones on top/side catching the sun.
    canopy[GREENS[t.variant === 2 ? 1 : 0]].add(at(t.x, h, z, R, R * 0.7, R));
    canopy[GREENS[1]].add(at(t.x + R * 0.3, h + R * 0.3, z - R * 0.2, R * 0.75, R * 0.55, R * 0.75));
    canopy[GREENS[2]].add(at(t.x - R * 0.2, h + R * 0.5, z + R * 0.25, R * 0.5, R * 0.38, R * 0.5));
  }
  const group = new Group();
  group.name = 'trees';
  for (const b of [trunk, ...Object.values(canopy)]) {
    const m = b.build();
    if (m) group.add(m);
  }
  return group;
}
