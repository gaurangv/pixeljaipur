import { describe, expect, it, vi } from 'vitest';
import { Group, Matrix4, Vector3 } from 'three';
import type { ScreenView } from '../src/render/camera';
import { ChunkManager, chunksInRect, viewGroundRect, type CityIndex } from '../src/world/chunks';
import { Batch, unitBox, withPoolSink, buildPooled } from '../src/world/instancing';
import { InstancePools } from '../src/world/pools';
import type { FootprintCollection } from '../src/world/footprints';

const view = (x: number, y: number, mpp = 0.33): ScreenView => ({
  target: new Vector3(x, 0, -y),
  rot: 0,
  mpp,
  size: { x: 427, y: 267 },
  zoom: 3,
  dpr: 1,
});

describe('chunk selection', () => {
  it('lists chunks intersecting a rect, nearest first', () => {
    const ids = chunksInRect({ x0: -10, y0: -10, x1: 300, y1: 10 }, 256);
    expect(ids).toEqual(['0_-1', '0_0', '-1_-1', '-1_0', '1_-1', '1_0'].sort((a, b) => ids.indexOf(a) - ids.indexOf(b)));
    expect(ids.slice(0, 2).sort()).toEqual(['0_-1', '0_0']);
    expect(ids).toHaveLength(6);
  });

  it('the ground rect of a view contains the view target and grows with zoom-out', () => {
    const near = viewGroundRect(view(100, 200, 0.11));
    const far = viewGroundRect(view(100, 200, 1.0));
    for (const r of [near, far]) {
      expect(r.x0).toBeLessThan(100);
      expect(r.x1).toBeGreaterThan(100);
      expect(r.y0).toBeLessThan(200);
      expect(r.y1).toBeGreaterThan(200);
    }
    expect(far.x1 - far.x0).toBeGreaterThan((near.x1 - near.x0) * 5);
  });
});

describe('ChunkManager', () => {
  const ids = ['0_0', '1_0', '5_5'];
  const index: CityIndex = { chunkSize: 256, boundary: [], chunks: ids.map((id) => ({ id, cx: +id[0], cy: +id[2], buildings: 1, bytes: 1 })) };
  const data: FootprintCollection = { type: 'FeatureCollection', features: [] };

  it('loads the chunks around the view, one build per tick, and unloads far ones', async () => {
    const built: string[] = [];
    const disposed: string[] = [];
    const m = new ChunkManager({
      index,
      urlFor: (id) => `/c/${id}.json`,
      fetchJson: async () => data,
      build: (id, d) => {
        built.push(id);
        return { group: new Group(), specs: [], data: d };
      },
      dispose: (id) => disposed.push(id),
    });
    m.setView(view(128, 128));
    m.tick();
    await new Promise((r) => setTimeout(r, 0));
    m.tick(1);
    expect(built).toHaveLength(1);
    while (m.tick(1));
    expect(built.sort()).toEqual(['0_0', '1_0']); // 5_5 is far away
    expect(m.busy).toBe(false);
    m.setView(view(5 * 256 + 128, 5 * 256 + 128));
    expect(disposed.sort()).toEqual(['0_0', '1_0']);
  });

  it('loadAll builds everything the view needs (screenshot mode)', async () => {
    const fetchJson = vi.fn(async () => data);
    const m = new ChunkManager({
      index,
      urlFor: (id) => `/c/${id}.json`,
      fetchJson,
      build: (_id, d) => ({ group: new Group(), specs: [], data: d }),
      dispose: () => {},
    });
    await m.loadAll(view(128, 128));
    expect(m.loadedIds.sort()).toEqual(['0_0', '1_0']);
    expect(m.busy).toBe(false);
  });
});

describe('InstancePools', () => {
  const batch = (n: number, x: number) => {
    const b = new Batch('t', unitBox, 'terracotta');
    for (let i = 0; i < n; i++) b.add(new Matrix4().makeTranslation(x, i, 0));
    return b;
  };

  it('keeps one mesh per geometry and compacts when a chunk unloads', () => {
    const pools = new InstancePools();
    withPoolSink((b) => pools.add('a', b), () => buildPooled([batch(3, 1)]));
    withPoolSink((b) => pools.add('b', b), () => buildPooled([batch(2, 2)]));
    withPoolSink((b) => pools.add('c', b), () => buildPooled([batch(4, 3)]));
    expect(pools.stats).toEqual({ pools: 1, instances: 9 });
    pools.remove('b');
    expect(pools.stats.instances).toBe(7);
    const mesh = pools.group.children[0] as unknown as { instanceMatrix: { array: Float32Array }; count: number };
    expect(mesh.count).toBe(7);
    // chunk c's first instance moved into the hole left by b (index 3), x = 3
    expect(mesh.instanceMatrix.array[3 * 16 + 12]).toBe(3);
    pools.remove('a');
    expect(mesh.instanceMatrix.array[0 * 16 + 12]).toBe(3);
  });

  it('grows past its initial capacity', () => {
    const pools = new InstancePools();
    pools.add('big', [batch(5000, 1)]);
    expect(pools.stats.instances).toBe(5000);
  });
});
