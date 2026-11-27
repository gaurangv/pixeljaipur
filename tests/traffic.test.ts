import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import landmarks from '../data/build/slice1.landmarks.json';
import lanesJson from '../data/build/slice1.lanes.json';
import slice from '../data/build/slice1.geojson?raw';
import { crowdDensity, Crowd } from '../src/actors/crowd';
import { LaneGraph, type LanesJson } from '../src/actors/lanes';
import { Flock } from '../src/actors/pigeons';
import { createTraffic } from '../src/actors/traffic';
import { TrafficSim, trafficDensity } from '../src/actors/sim';
import { Clock, parseIST } from '../src/core/clock';
import { EventBus } from '../src/core/events';
import type { WorldContext } from '../src/core/systems';
import type { HawaMahalPlacement } from '../src/landmarks/hawaMahal';
import type { FootprintCollection } from '../src/world/footprints';
import { pointInRing, type Pt } from '../src/world/geometry';

const data = lanesJson as unknown as LanesJson;
const graph = new LaneGraph(data);
const geo = JSON.parse(slice) as FootprintCollection;
const polys = (k: string) =>
  geo.features
    .filter((f) => f.properties.kind === k)
    .flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [])) as Pt[][][];
const inside = (x: number, y: number, rings: Pt[][]) => pointInRing(x, y, rings[0]) && !rings.slice(1).some((h) => pointInRing(x, y, h));
/** Polygons with bounding boxes, so point tests skip far-away shapes. */
const boxed = (k: string) =>
  polys(k).map((rings) => {
    const xs = rings[0].map((p) => p[0]), ys = rings[0].map((p) => p[1]);
    return { rings, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  });
const roads = boxed('road');
const buildings = boxed('building');
const near = (b: { x0: number; x1: number; y0: number; y1: number }, x: number, y: number, pad: number) =>
  x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad;

/** Distance from (x, y) to the nearest road polygon edge (within `tol`). */
function nearRoadEdge(x: number, y: number, tol: number): boolean {
  for (const b of roads) {
    if (!near(b, x, y, tol)) continue;
    for (const r of b.rings)
      for (let i = 0; i < r.length - 1; i++) {
        const [ax, ay] = r[i];
        const vx = r[i + 1][0] - ax, vy = r[i + 1][1] - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)));
        if (Math.hypot(ax + vx * t - x, ay + vy * t - y) < tol) return true;
      }
  }
  return false;
}
const onRoad = (x: number, y: number, tol = 0.6) => roads.some((b) => near(b, x, y, 0) && inside(x, y, b.rings)) || nearRoadEdge(x, y, tol);
const inBuilding = (x: number, y: number) => buildings.some((b) => near(b, x, y, 0) && inside(x, y, b.rings));
const hawa = landmarks.landmarks[0] as unknown as HawaMahalPlacement;

describe('lane graph', () => {
  it('loads, is small, and has a sane shape', () => {
    expect(graph.count).toBeGreaterThan(200);
    expect(JSON.stringify(lanesJson).length).toBeLessThan(200_000);
    expect(graph.sources.length).toBeGreaterThan(8);
    for (let i = 0; i < graph.count; i++) expect(graph.length[i]).toBeGreaterThan(0.1);
    // every connector leads to exactly one road lane
    for (let i = 0; i < graph.count; i++) if (graph.connector[i]) expect(graph.next[i].length).toBe(1);
  });

  it('is connected: almost every lane is reachable from the slice edge', () => {
    const seen = new Uint8Array(graph.count);
    const stack = [...graph.sources];
    for (const s of stack) seen[s] = 1;
    while (stack.length) {
      const l = stack.pop()!;
      for (const n of graph.next[l]) if (!seen[n]) (seen[n] = 1), stack.push(n);
    }
    const reached = seen.reduce((a, b) => a + b, 0);
    expect(reached / graph.count).toBeGreaterThan(0.9);
  });

  it('circulates clockwise round Badi Chaupar (left-hand traffic) with give-way entries', () => {
    const [cx, cy] = graph.ringCentre;
    let cw = 0, ccw = 0, yields = 0;
    for (let i = 0; i < graph.count; i++) {
      if (graph.giveWay[i]) yields++;
      if (!graph.ring[i] || graph.connector[i]) continue;
      const a = graph.start[i];
      const x = graph.xy[2 * a] - cx, y = graph.xy[2 * a + 1] - cy;
      const cross = x * graph.dir[2 * a + 1] - y * graph.dir[2 * a];
      if (cross < 0) cw++;
      else ccw++;
    }
    expect(cw).toBeGreaterThan(4);
    expect(ccw).toBe(0);
    expect(yields).toBeGreaterThanOrEqual(4);
  });

  it('keeps every lane on the road surface and out of buildings', () => {
    let n = 0, off = 0;
    for (let i = 0; i < graph.count; i++) {
      const out = { x: 0, y: 0, dx: 0, dy: 0 };
      for (let s = 0; s <= graph.length[i]; s += 1.5) {
        graph.locate(i, s, 0, out);
        n++;
        if (!onRoad(out.x, out.y)) off++;
        expect(inBuilding(out.x, out.y)).toBe(false);
      }
    }
    expect(off / n).toBeLessThan(0.002);
  }, 30_000);

  it('finds the nearest lane through its grid', () => {
    const out = { x: 0, y: 0, dx: 0, dy: 0 };
    graph.locate(10, graph.length[10] / 2, 0, out);
    const hit = graph.nearest(out.x + 0.2, out.y);
    expect(hit.lane).toBeGreaterThanOrEqual(0);
    expect(hit.d).toBeLessThan(0.25);
    expect(graph.nearest(5000, 5000).lane).toBe(-1);
  });
});

describe('traffic sim', () => {
  it('keeps vehicles on lanes, on the road, never overlapping in a lane', () => {
    const sim = new TrafficSim(graph, { seed: 3, hours: 18 });
    expect(sim.vehicles.length).toBeLessThanOrEqual(160);
    let checked = 0;
    for (let step = 0; step < 2400; step++) {
      sim.step(1 / 20);
      expect(sim.overlaps()).toBe(0);
      if (step % 40 === 0) {
        for (const v of sim.vehicles) {
          if (!v.active) continue;
          checked++;
          expect(onRoad(v.x, v.y), `${v.kind} at ${v.x.toFixed(1)},${v.y.toFixed(1)}`).toBe(true);
          expect(inBuilding(v.x, v.y)).toBe(false);
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    // traffic actually flows: vehicles leave at the edges and come back in
    expect(sim.stats.sinks).toBeGreaterThan(10);
  }, 30_000);

  it('gives way to ring traffic when entering Badi Chaupar', () => {
    // a give-way connector whose priority includes a ring road lane
    let entry = -1, ringLane = -1;
    for (let c = 0; c < graph.count && entry < 0; c++) {
      if (!graph.giveWay[c]) continue;
      const pr = (graph.priority.get(c) ?? []).find((l) => !graph.connector[l] && graph.length[l] > 14);
      if (pr !== undefined && graph.prev[c].length) (entry = c), (ringLane = pr);
    }
    expect(entry).toBeGreaterThanOrEqual(0);
    const approach = graph.prev[entry][0];

    const run = (withRing: boolean) => {
      const sim = new TrafficSim(graph, { seed: 1, fleet: [['auto', 2]], scatter: false });
      const a = sim.put(0, approach, graph.length[approach] - 2, 0, entry);
      if (withRing) sim.put(1, ringLane, graph.length[ringLane] - 12, 5);
      let enteredAt = -1;
      let enteredWhileRingNear = false;
      for (let i = 0; i < 200 && enteredAt < 0; i++) {
        sim.step(0.05);
        const b = sim.vehicles[1];
        const ringNear = withRing && b.active && b.lane === ringLane && graph.length[ringLane] - b.s < 12;
        if (a.lane === entry) {
          enteredAt = i;
          enteredWhileRingNear = ringNear;
        }
      }
      return { enteredAt, enteredWhileRingNear };
    };
    const free = run(false);
    const busy = run(true);
    expect(free.enteredAt).toBeGreaterThanOrEqual(0);
    expect(busy.enteredAt).toBeGreaterThan(free.enteredAt); // waited for the ring vehicle
    expect(busy.enteredWhileRingNear).toBe(false);
  });

  it('is deterministic for a seed', () => {
    const a = new TrafficSim(graph, { seed: 7, hours: 12 });
    const b = new TrafficSim(graph, { seed: 7, hours: 12 });
    for (let i = 0; i < 600; i++) {
      a.step(1 / 30);
      b.step(1 / 30);
    }
    expect(a.snapshot()).toEqual(b.snapshot());
    const c = new TrafficSim(graph, { seed: 8, hours: 12 });
    expect(c.snapshot()).not.toEqual(a.snapshot());
  });

  it('honks when braking hard or stuck behind a cow', () => {
    const sim = new TrafficSim(graph, { seed: 2, hours: 19 });
    let horns = 0;
    for (let i = 0; i < 6000; i++) sim.step(1 / 20, () => horns++);
    expect(horns).toBeGreaterThan(0);
  });

  it('thins out at night', () => {
    expect(trafficDensity(3)).toBeLessThan(trafficDensity(12));
    const night = new TrafficSim(graph, { seed: 1, hours: 3 }).vehicles.filter((v) => v.active).length;
    const eve = new TrafficSim(graph, { seed: 1, hours: 18 }).vehicles.filter((v) => v.active).length;
    expect(night).toBeLessThan(eve / 2);
  });
});

describe('crowd', () => {
  it('peaks around 19:00, quiet early morning, thin at night', () => {
    const hours = Array.from({ length: 48 }, (_, i) => i / 2);
    const peak = hours.reduce((a, h) => (crowdDensity(h) > crowdDensity(a) ? h : a), 0);
    expect(peak).toBeGreaterThanOrEqual(18.5);
    expect(peak).toBeLessThanOrEqual(19.5);
    expect(crowdDensity(5)).toBeLessThan(0.1);
    expect(crowdDensity(2)).toBeLessThan(0.1);
    expect(crowdDensity(12)).toBeGreaterThan(crowdDensity(7));
    const c = new Crowd(data.walks, { seed: 1, hours: 5 });
    const quiet = c.activeCount();
    c.setHours(19);
    expect(c.activeCount()).toBeGreaterThan(quiet * 5);
    expect(c.walkers.length).toBeLessThanOrEqual(400);
  });

  it('walks in front of buildings, never inside them', () => {
    const c = new Crowd(data.walks, { seed: 4, hours: 19 });
    for (let i = 0; i < 400; i++) {
      c.step(1 / 10);
      if (i % 50) continue;
      for (const p of c.walkers) expect(inBuilding(p.x, p.y), `walker at ${p.x.toFixed(1)},${p.y.toFixed(1)}`).toBe(false);
    }
    const d = new Crowd(data.walks, { seed: 4, hours: 19 });
    for (let i = 0; i < 400; i++) d.step(1 / 10);
    expect(d.snapshot()).toEqual(c.snapshot());
  });
});

describe('pigeons', () => {
  it('sit on the Hawa Mahal and burst on a nearby click only', () => {
    const f = new Flock(hawa, { seed: 1 });
    expect(f.birds.length).toBeLessThanOrEqual(40);
    expect(f.flying).toBe(0);
    for (const b of f.birds) expect(Math.hypot(b.x - hawa.anchor[0], b.y - hawa.anchor[1])).toBeLessThan(30);
    expect(f.near(hawa.anchor[0] + 20, hawa.anchor[1] + 10)).toBe(true);
    expect(f.near(hawa.anchor[0] + 120, hawa.anchor[1])).toBe(false);
    expect(f.burst()).toBe(true);
    for (let i = 0; i < 30; i++) f.step(0.1);
    expect(f.flying).toBe(f.birds.length);
    expect(Math.max(...f.birds.map((b) => b.z))).toBeGreaterThan(12);
    for (let i = 0; i < 300; i++) f.step(0.1); // circle, then settle back
    expect(f.flying).toBe(0);
    for (const b of f.birds) expect([b.x, b.y, b.z]).toEqual([b.px, b.py, b.pz]);
  });

  it('the traffic system emits pigeonsBurst for a groundClick near Hawa Mahal, not far away', async () => {
    const events = new EventBus();
    const bursts: { x: number; y: number }[] = [];
    events.on('pigeonsBurst', (p) => bursts.push(p));
    const sys = createTraffic();
    const ctx = {
      scene: new Scene(), clock: new Clock(parseIST('2026-01-14T18:00')!), events, seed: 1, shot: false, params: new URLSearchParams('slice=slice1'),
    } as unknown as WorldContext;
    await sys.init(ctx);
    expect(sys.animating()).toBe(true);
    events.emit('groundClick', { x: hawa.anchor[0] + 150, y: hawa.anchor[1] });
    expect(bursts.length).toBe(0);
    events.emit('groundClick', { x: hawa.anchor[0] + 15, y: hawa.anchor[1] - 10 });
    expect(bursts.length).toBe(1);
    sys.update(0.1, ctx.clock.now(), ctx);
  });

  it('shot mode is still and deterministic', async () => {
    const make = async () => {
      const sys = createTraffic();
      const scene = new Scene();
      const ctx = { scene, clock: new Clock(parseIST('2026-01-14T07:00')!), events: new EventBus(), seed: 1, shot: true, params: new URLSearchParams('slice=slice1') } as unknown as WorldContext;
      await sys.init(ctx);
      sys.update(0, ctx.clock.now(), ctx);
      expect(sys.animating()).toBe(false);
      const g = scene.getObjectByName('actors')!;
      return g.children.map((m) => Array.from((m as unknown as { instanceMatrix: { array: Float32Array } }).instanceMatrix.array));
    };
    expect(await make()).toEqual(await make());
  });
});

describe('performance', () => {
  it('updates all agents in well under 2 ms per frame', () => {
    const sim = new TrafficSim(graph, { seed: 1, hours: 19 });
    const crowd = new Crowd(data.walks, { seed: 1, hours: 19 });
    const flock = new Flock(hawa, { seed: 1 });
    flock.burst();
    for (let i = 0; i < 120; i++) sim.step(1 / 60), crowd.step(1 / 60), flock.step(1 / 60); // warm up
    const n = 600;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      sim.step(1 / 60);
      crowd.step(1 / 60);
      flock.step(1 / 60);
    }
    const ms = (performance.now() - t0) / n;
    console.log(`[traffic] update: ${ms.toFixed(3)} ms/frame, ${sim.vehicles.filter((v) => v.active).length} vehicles, ${crowd.activeCount()} people, ${flock.birds.length} pigeons`);
    expect(ms).toBeLessThan(2);
  });
});
