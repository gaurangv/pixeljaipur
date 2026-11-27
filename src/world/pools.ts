import { Color, Group, InstancedMesh, Matrix4, type BufferGeometry } from 'three';
import { toonInstanced } from '../render/materials';
import { palette } from '../render/palette';
import type { Batch } from './instancing';

/*
 * Global instance pools for streamed chunks: ONE InstancedMesh per (geometry, shadow flag)
 * for the whole city, no matter how many chunks are loaded. Each chunk owns a slot range;
 * unloading a chunk compacts the pool. Draw calls stay constant as you travel.
 */

interface Range {
  start: number;
  count: number;
}

class Pool {
  mesh: InstancedMesh;
  used = 0;
  readonly owners = new Map<string, Range>();
  private readonly c = new Color();

  constructor(
    readonly key: string,
    readonly geometry: BufferGeometry,
    readonly castShadow: boolean,
    capacity: number,
    private readonly root: Group,
  ) {
    this.mesh = this.make(capacity);
    root.add(this.mesh);
  }

  private make(capacity: number): InstancedMesh {
    const m = new InstancedMesh(this.geometry, toonInstanced(), capacity);
    m.name = `pool:${this.key}`;
    m.castShadow = this.castShadow;
    m.receiveShadow = true;
    m.frustumCulled = false; // spans the loaded area; the camera always sees part of it
    m.count = 0;
    m.setColorAt(0, this.c.setRGB(1, 1, 1)); // allocate instanceColor
    return m;
  }

  private grow(need: number): void {
    let cap = this.mesh.instanceMatrix.count;
    if (need <= cap) return;
    while (cap < need) cap *= 2;
    const next = this.make(cap);
    next.instanceMatrix.array.set(this.mesh.instanceMatrix.array.subarray(0, this.used * 16));
    next.instanceColor!.array.set(this.mesh.instanceColor!.array.subarray(0, this.used * 3));
    next.count = this.used;
    this.root.remove(this.mesh);
    this.mesh.dispose();
    this.mesh = next;
    this.root.add(next);
  }

  add(owner: string, batches: Batch[]): void {
    const n = batches.reduce((s, b) => s + b.matrices.length, 0);
    if (!n) return;
    this.grow(this.used + n);
    const start = this.used;
    let i = start;
    for (const b of batches) {
      this.c.setHex(palette[b.colour]);
      for (const m of b.matrices) {
        this.mesh.setMatrixAt(i, m);
        this.mesh.setColorAt(i, this.c);
        i++;
      }
    }
    this.used = i;
    this.mesh.count = this.used;
    this.owners.set(owner, { start, count: n });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  remove(owner: string): void {
    const r = this.owners.get(owner);
    if (!r) return;
    this.owners.delete(owner);
    const mat = this.mesh.instanceMatrix.array as Float32Array;
    const col = this.mesh.instanceColor!.array as Float32Array;
    const end = r.start + r.count;
    // Shift everything after the hole down (copyWithin is a fast memmove).
    mat.copyWithin(r.start * 16, end * 16, this.used * 16);
    col.copyWithin(r.start * 3, end * 3, this.used * 3);
    for (const other of this.owners.values()) if (other.start > r.start) other.start -= r.count;
    this.used -= r.count;
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}

export class InstancePools {
  readonly group = new Group();
  private readonly pools = new Map<string, Pool>();

  constructor() {
    this.group.name = 'instancePools';
  }

  /** Put a chunk's batches into the shared pools (grouped by geometry + shadow flag). */
  add(owner: string, batches: Batch[]): void {
    const by = new Map<string, Batch[]>();
    for (const b of batches) {
      if (!b.matrices.length) continue;
      const key = `${b.geometry.uuid}:${b.castShadow}`;
      const list = by.get(key) ?? [];
      list.push(b);
      by.set(key, list);
    }
    for (const [key, list] of by) {
      let pool = this.pools.get(key);
      if (!pool) {
        pool = new Pool(key, list[0].geometry, list[0].castShadow, 4096, this.group);
        this.pools.set(key, pool);
      }
      pool.add(owner, list);
    }
  }

  remove(owner: string): void {
    for (const p of this.pools.values()) p.remove(owner);
  }

  get stats(): { pools: number; instances: number } {
    let instances = 0;
    for (const p of this.pools.values()) instances += p.used;
    return { pools: this.pools.size, instances };
  }
}

/** Identity matrix helper for tests. */
export const IDENTITY = new Matrix4();
