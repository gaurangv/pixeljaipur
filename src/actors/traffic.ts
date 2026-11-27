import { Group } from 'three';
import landmarks from '../../data/build/slice1.landmarks.json';
import lanesData from '../../data/build/slice1.lanes.json';
import { viewGroundRect } from '../world/chunks';

// Whole-city mode (Phase 3): the city lane graph is fetched (it is too big to bundle).
const cityLanesUrl = Object.values(import.meta.glob('../../data/build/walled/lanes.json', { query: '?url', import: 'default', eager: true }))[0] as
  | string
  | undefined;
import type { System, WorldContext } from '../core/systems';
import type { HawaMahalPlacement } from '../landmarks/hawaMahal';
import { Crowd } from './crowd';
import { LaneGraph, type LanesJson } from './lanes';
import { Flock } from './pigeons';
import { ActorMeshes, OUTFITS } from './render';
import { TrafficSim } from './sim';
import { effectiveAltitude, sunPosition } from '../sky/sunModel';

/** Headlights on when the sun is below this altitude (dusk to dawn). */
export const HEADLIGHT_ALT_DEG = 4;
const headlightsAt = (date: Date) => effectiveAltitude(sunPosition(date)) < HEADLIGHT_ALT_DEG;

/*
 * The `traffic` System (Phase 2, stream B): moving vehicles, cows, pedestrians and the
 * Hawa Mahal pigeons. Logic lives in sim.ts / crowd.ts / pigeons.ts; this file wires it to
 * the world: clock (density by hour), events (horn, groundClick -> pigeonsBurst), the scene.
 *
 * Shot mode: everything is placed from the seed and pre-simulated for a fixed number of
 * steps at the frozen clock time; nothing reads the real clock; animating() stays false.
 */

/** Fixed pre-simulation for screenshots: 30 s at 30 Hz. */
export const SHOT_STEPS = 900;
export const SHOT_DT = 1 / 30;

export function createTraffic(): System {
  let sim: TrafficSim | null = null;
  let crowd: Crowd | null = null;
  let flock: Flock | null = null;
  let meshes: ActorMeshes | null = null;
  let shot = false;
  let lastHour = -1;
  const group = new Group();
  group.name = 'actors';
  let city = false;
  let lastRect: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** Keep traffic and people around the view (city mode). */
  const followView = (ctx: WorldContext, force = false) => {
    const r = viewGroundRect(ctx.screenView(), 60);
    if (!force && lastRect && Math.abs(r.x0 - lastRect.x0) + Math.abs(r.y0 - lastRect.y0) + Math.abs(r.x1 - lastRect.x1) < 20) return;
    lastRect = r;
    sim?.setRegion(r);
    crowd?.setRegion(r);
  };

  return {
    id: 'traffic',
    async init(ctx: WorldContext) {
      shot = ctx.shot;
      const hours = ctx.clock.now().hoursIST;
      city = !!cityLanesUrl && ctx.params.get('slice') !== 'slice1';
      const data = (city ? await fetch(cityLanesUrl!).then((r) => r.json()) : lanesData) as unknown as LanesJson;
      const graph = new LaneGraph(data);
      sim = new TrafficSim(graph, { seed: ctx.seed, hours, scatter: !city });
      crowd = new Crowd(data.walks, { seed: ctx.seed, hours, looks: OUTFITS.length, busy: data.busy });
      const hawa = landmarks.landmarks.find((l) => l.id === 'hawaMahal') as unknown as HawaMahalPlacement | undefined;
      flock = hawa ? new Flock(hawa, { seed: ctx.seed }) : null;
      if (city) {
        followView(ctx, true);
        sim.scatter();
      }
      meshes = new ActorMeshes(sim, crowd, flock);
      meshes.setLights(headlightsAt(ctx.clock.now().date));
      for (const m of meshes.meshes) group.add(m);
      ctx.scene.add(group);

      if (shot) {
        for (let i = 0; i < SHOT_STEPS; i++) {
          sim.step(SHOT_DT);
          crowd.step(SHOT_DT);
        }
      } else {
        ctx.events.on('groundClick', ({ x, y }) => {
          if (flock && flock.near(x, y) && flock.burst()) {
            ctx.events.emit('pigeonsBurst', { x: flock.at.anchor[0], y: flock.at.anchor[1] });
          }
        });
      }
      meshes.update();
    },
    update(dt, now, ctx) {
      if (!sim || !crowd || !meshes) return;
      if (shot) return; // placed once in init, deterministic
      const h = now.hoursIST;
      if (Math.abs(h - lastHour) > 1 / 60) {
        sim.setHours(h);
        crowd.setHours(h);
        meshes.setLights(headlightsAt(now.date));
        lastHour = h;
      }
      if (city) followView(ctx);
      sim.step(dt, (x, y, kind) => ctx.events.emit('horn', { x, y, kind }));
      crowd.step(dt);
      flock?.step(dt);
      meshes.update();
    },
    animating() {
      return !shot && sim !== null;
    },
  };
}
