import type { Object3D } from 'three';
import { screenToRay, type ScreenView } from '../render/camera';
import type { FootprintCollection } from './footprints';
import type { ShopHouseSpec } from './shopHouse';

/*
 * Chunk streaming for the whole walled city. The data build writes a 256 m grid of chunks
 * (data/build/walled/chunks/<cx>_<cy>.json, scripts/build_slice.py). We load and build only
 * the chunks around the view, one build per frame, and unload ones far away.
 */

export interface ChunkEntry {
  id: string;
  cx: number;
  cy: number;
  buildings: number;
  bytes: number;
}

export interface CityIndex {
  chunkSize: number;
  chunks: ChunkEntry[];
  boundary: [number, number][];
  names?: { name: string; at: [number, number] }[];
  [k: string]: unknown;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Ground rectangle (data coords) covering the four screen corners, grown by `pad` metres. */
export function viewGroundRect(v: ScreenView, pad = 0): Rect {
  const w = (v.size.x * v.zoom) / v.dpr;
  const h = (v.size.y * v.zoom) / v.dpr;
  const r: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [sx, sy] of [[0, 0], [w, 0], [0, h], [w, h]]) {
    const ray = screenToRay(sx, sy, v);
    const k = -ray.origin.y / ray.dir.y;
    const x = ray.origin.x + ray.dir.x * k;
    const y = -(ray.origin.z + ray.dir.z * k);
    r.x0 = Math.min(r.x0, x);
    r.y0 = Math.min(r.y0, y);
    r.x1 = Math.max(r.x1, x);
    r.y1 = Math.max(r.y1, y);
  }
  return { x0: r.x0 - pad, y0: r.y0 - pad, x1: r.x1 + pad, y1: r.y1 + pad };
}

/** Chunk ids ("cx_cy") whose squares intersect the rectangle, nearest to its centre first. */
export function chunksInRect(rect: Rect, size: number): string[] {
  const out: { id: string; d: number }[] = [];
  const cx0 = Math.floor(rect.x0 / size);
  const cx1 = Math.floor(rect.x1 / size);
  const cy0 = Math.floor(rect.y0 / size);
  const cy1 = Math.floor(rect.y1 / size);
  const mx = (rect.x0 + rect.x1) / 2;
  const my = (rect.y0 + rect.y1) / 2;
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      out.push({ id: `${cx}_${cy}`, d: Math.hypot((cx + 0.5) * size - mx, (cy + 0.5) * size - my) });
    }
  }
  return out.sort((a, b) => a.d - b.d).map((o) => o.id);
}

export interface BuiltChunk {
  group: Object3D;
  specs: ShopHouseSpec[];
  data: FootprintCollection;
}

export interface ChunkManagerOptions {
  index: CityIndex;
  /** URL of a chunk's JSON (undefined: the chunk has no data, e.g. outside the walls). */
  urlFor(id: string): string | undefined;
  /** Build meshes for a chunk (and add them to the scene). */
  build(id: string, data: FootprintCollection): BuiltChunk;
  /** Remove a chunk from the scene and free its memory. */
  dispose(id: string, built: BuiltChunk): void;
  onLoad?(id: string, built: BuiltChunk): void;
  onUnload?(id: string, built: BuiltChunk): void;
  fetchJson?(url: string): Promise<FootprintCollection>;
  /** Chunks loaded around the view: build pad and keep pad, in metres. */
  padBuild?: number;
  padKeep?: number;
}

export class ChunkManager {
  private readonly known: Set<string>;
  private readonly loaded = new Map<string, BuiltChunk>();
  private readonly ready = new Map<string, FootprintCollection>();
  private readonly fetching = new Set<string>();
  private wanted: string[] = [];
  private keep = new Set<string>();

  constructor(private readonly o: ChunkManagerOptions) {
    this.known = new Set(o.index.chunks.map((c) => c.id));
  }

  get size(): number {
    return this.o.index.chunkSize;
  }

  get loadedIds(): string[] {
    return [...this.loaded.keys()];
  }

  forEachLoaded(fn: (id: string, built: BuiltChunk) => void): void {
    for (const [id, b] of this.loaded) fn(id, b);
  }

  /** Still fetching or building chunks the view needs. */
  get busy(): boolean {
    return this.wanted.some((id) => !this.loaded.has(id));
  }

  setView(v: ScreenView): void {
    const s = this.size;
    this.wanted = chunksInRect(viewGroundRect(v, this.o.padBuild ?? s * 0.5), s).filter((id) => this.known.has(id));
    this.keep = new Set(chunksInRect(viewGroundRect(v, this.o.padKeep ?? s * 2), s));
    for (const [id, built] of this.loaded) {
      if (!this.keep.has(id)) {
        this.loaded.delete(id);
        this.o.onUnload?.(id, built);
        this.o.dispose(id, built);
      }
    }
    for (const id of [...this.ready.keys()]) if (!this.keep.has(id)) this.ready.delete(id);
  }

  private fetchOne(id: string): void {
    const url = this.o.urlFor(id);
    if (!url || this.fetching.has(id)) return;
    this.fetching.add(id);
    const get = this.o.fetchJson ?? ((u: string) => fetch(u).then((r) => r.json() as Promise<FootprintCollection>));
    get(url)
      .then((data) => this.ready.set(id, data))
      .catch((err) => console.error(`[pixeljaipur] chunk ${id} failed`, err))
      .finally(() => this.fetching.delete(id));
  }

  /** Start fetches (up to 6 at once) and build at most `maxBuilds` chunks. Returns true if anything was built. */
  tick(maxBuilds = 1): boolean {
    for (const id of this.wanted) {
      if (this.fetching.size >= 6) break;
      if (!this.loaded.has(id) && !this.ready.has(id)) this.fetchOne(id);
    }
    let built = 0;
    for (const id of this.wanted) {
      if (built >= maxBuilds) break;
      const data = this.ready.get(id);
      if (!data || this.loaded.has(id)) continue;
      this.ready.delete(id);
      const b = this.o.build(id, data);
      this.loaded.set(id, b);
      this.o.onLoad?.(id, b);
      built++;
    }
    return built > 0;
  }

  /** Screenshot mode: fetch and build everything the view needs, then resolve. */
  async loadAll(v: ScreenView): Promise<void> {
    this.setView(v);
    const get = this.o.fetchJson ?? ((u: string) => fetch(u).then((r) => r.json() as Promise<FootprintCollection>));
    await Promise.all(
      this.wanted.map(async (id) => {
        const url = this.o.urlFor(id);
        if (url && !this.loaded.has(id) && !this.ready.has(id)) this.ready.set(id, await get(url));
      }),
    );
    while (this.tick(1000)) {
      /* build all */
    }
  }
}
