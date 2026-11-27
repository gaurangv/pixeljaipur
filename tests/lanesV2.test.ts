import { describe, expect, it } from 'vitest';
import city from '../data/build/walled/lanes.json';
import { Crowd } from '../src/actors/crowd';
import { expandLanes, LaneGraph, type LanesJsonV2 } from '../src/actors/lanes';

const v2 = city as unknown as LanesJsonV2;

describe('compact city lanes (v2)', () => {
  const full = expandLanes(v2);

  it('rebuilds every junction connector', () => {
    expect(v2.v).toBe(2);
    const conns = full.lanes.filter((l) => l.j);
    expect(full.lanes.length - conns.length).toBe(v2.lanes.length);
    expect(conns.length).toBe(v2.lanes.reduce((n, l) => n + l.n.length, 0));
  });

  it('connectors join the end of one road lane to the start of the next', () => {
    for (const L of full.lanes) {
      if (L.j) continue;
      for (const c of L.n) {
        const C = full.lanes[c];
        const M = full.lanes[C.n[0]];
        expect(Math.hypot(C.p[0] - L.p[L.p.length - 2], C.p[1] - L.p[L.p.length - 1])).toBeLessThan(0.11);
        const k = C.p.length;
        expect(Math.hypot(C.p[k - 2] - M.p[0], C.p[k - 1] - M.p[1])).toBeLessThan(0.11);
        expect(M.j).toBeUndefined();
      }
    }
  });

  it('decodes points to plausible city coordinates', () => {
    const g = new LaneGraph(v2);
    expect(g.count).toBe(full.lanes.length);
    for (let i = 0; i < g.xy.length; i++) expect(Math.abs(g.xy[i])).toBeLessThan(3000);
  });
});

describe('streamed walks', () => {
  const a = [0, 0, 10, 0];
  const b = [10, 0, 20, 0];
  const c = [100, 100, 110, 100];

  it('waits unplaced until walks arrive, then places everyone', () => {
    const crowd = new Crowd([], { seed: 1, hours: 19, cap: 20 });
    expect(crowd.walkers.length).toBe(20);
    expect(crowd.activeCount()).toBe(0);
    crowd.step(0.5); // nothing to walk on: no crash
    crowd.setWalks([a, b], [0, 1], ['k:0', 'k:1']);
    expect(crowd.walkers.every((p) => p.walk >= 0)).toBe(true);
    expect(crowd.activeCount()).toBeGreaterThan(0);
  });

  it('keeps walkers on their walk when other chunks load or unload', () => {
    const crowd = new Crowd([], { seed: 2, hours: 19, cap: 30 });
    crowd.setWalks([a, b], [0, 0], ['k:0', 'k:1']);
    for (let i = 0; i < 30; i++) crowd.step(0.1);
    const before = crowd.walkers.map((p) => [p.x, p.y]);
    crowd.setWalks([c, a, b], [0, 0, 0], ['m:0', 'k:0', 'k:1']);
    crowd.walkers.forEach((p, i) => {
      expect(p.x).toBeCloseTo(before[i][0], 5);
      expect(p.y).toBeCloseTo(before[i][1], 5);
    });
    crowd.setWalks([c], [0], ['m:0']); // their chunk unloaded: moved onto what is left
    expect(crowd.walkers.every((p) => p.y > 99)).toBe(true);
  });
});
