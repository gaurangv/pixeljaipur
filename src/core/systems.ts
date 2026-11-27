import type { DirectionalLight, Scene, WebGLRenderer } from 'three';
import type { BuiltChunk } from '../world/chunks';
import type { ScreenView } from '../render/camera';
import type { Place } from '../ui/places';
import type { FootprintCollection } from '../world/footprints';
import type { ShopHouseSpec } from '../world/shopHouse';
import type { Clock, WorldTime } from './clock';
import type { EventBus } from './events';

/**
 * Phase 2 plug-in point. Each living part of the city (day cycle, traffic, sound, ...)
 * is a System registered in src/core/register.ts. main.ts owns the loop and calls
 * every system each frame; systems never edit main.ts.
 */
export interface WorldContext {
  scene: Scene;
  renderer: WebGLRenderer;
  /** The sun (src/sky/light.ts). The day-cycle system moves it. */
  sun: DirectionalLight;
  slice: FootprintCollection;
  /** Generated shop-house specs (fronts, heights, ...) for placing lamps, shoppers, etc. */
  specs: ShopHouseSpec[];
  places: Place[];
  clock: Clock;
  events: EventBus;
  /** Current camera mapping (worldToScreen / screenToRay). */
  screenView(): ScreenView;
  /** Ask for one more rendered frame. */
  invalidate(): void;
  /** Re-render the (static) shadow map on the next frame, e.g. after the sun steps. */
  refreshShadows(): void;
  /** Recolour the backdrop gradient around the diorama (palette hex values). */
  setBackdrop(top: number, bottom: number): void;
  /** HTML layer over the canvas for UI (pointer-events: none on the layer itself). */
  overlay: HTMLElement;
  params: URLSearchParams;
  seed: number;
  /** Screenshot mode: everything must be deterministic, no network, no audio. */
  shot: boolean;
}

export interface System {
  id: string;
  /** Build meshes / UI. Called once after the city is built. */
  init(ctx: WorldContext): void | Promise<void>;
  /** Called every frame (and once with dt = 0 in shot mode). dt in real seconds. */
  update(dt: number, now: WorldTime, ctx: WorldContext): void;
  /** True while this system needs continuous frames (moving traffic, fading lamps). */
  animating(): boolean;
  /** City streaming: a chunk was built (load) or removed (unload). Specs/data are that chunk's. */
  onChunk?(id: string, type: 'load' | 'unload', chunk: BuiltChunk, ctx: WorldContext): void;
  dispose?(): void;
}

export class Systems {
  private readonly list: System[] = [];

  constructor(systems: System[] = []) {
    for (const s of systems) this.add(s);
  }

  add(s: System): void {
    if (this.list.some((o) => o.id === s.id)) throw new Error(`System '${s.id}' registered twice`);
    this.list.push(s);
  }

  get ids(): string[] {
    return this.list.map((s) => s.id);
  }

  private ctx: WorldContext | null = null;

  chunk(id: string, type: 'load' | 'unload', chunk: BuiltChunk): void {
    if (!this.ctx) return;
    for (const s of this.list) {
      try {
        s.onChunk?.(id, type, chunk, this.ctx);
      } catch (err) {
        console.error(`[pixeljaipur] system '${s.id}' chunk ${type} failed`, err);
      }
    }
  }

  async init(ctx: WorldContext): Promise<void> {
    this.ctx = ctx;
    for (const s of this.list) {
      try {
        await s.init(ctx);
      } catch (err) {
        console.error(`[pixeljaipur] system '${s.id}' failed to init`, err);
      }
    }
  }

  update(dt: number, now: WorldTime, ctx: WorldContext): void {
    for (const s of this.list) {
      try {
        s.update(dt, now, ctx);
      } catch (err) {
        console.error(`[pixeljaipur] system '${s.id}' update failed`, err);
      }
    }
  }

  animating(): boolean {
    return this.list.some((s) => s.animating());
  }
}
