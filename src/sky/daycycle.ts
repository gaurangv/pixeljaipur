import type { HemisphereLight } from 'three';
import { worldTime, type WorldTime } from '../core/clock';
import type { System, WorldContext } from '../core/systems';
import { palette } from '../render/palette';
import { TimeControl } from '../ui/timeControl';
import { buildCityLights, type CityLights } from './cityLights';
import { findSkyLight, sunDirection, SUN_DISTANCE } from './light';
import {
  blendHex,
  blendNumber,
  effectiveAltitude,
  keyLight,
  keyScale,
  presetWeights,
  stepStart,
  sunPosition,
  SunStepper,
  type KeySource,
} from './sunModel';

/*
 * Day cycle: moves the sun from suncalc in 10-game-minute steps (shadows refresh only then),
 * blends the noon / golden / dusk / night presets by sun altitude every frame, and switches
 * the city lights on one by one at dusk (off at dawn).
 */

/** Seconds a single light takes to fade on or off. */
const FADE_SEC = 0.45;

export function createDayCycle(): System {
  const stepper = new SunStepper();
  let sky: HemisphereLight | null = null;
  /** City lights per source: 'slice' (single-slice mode) or a streamed chunk id. */
  const sets = new Map<string, { lights: CityLights; levels: Float32Array }>();
  let lastAlt = 90;
  const addSet = (key: string, lights: CityLights, ctx: WorldContext) => {
    // Start at the current state (no fade-in when a chunk streams in after dusk).
    const levels = new Float32Array(lights.count);
    for (let i = 0; i < levels.length; i++) levels[i] = lastAlt < lights.thresholds[i] ? 1 : 0;
    lights.apply(levels);
    sets.set(key, { lights, levels });
    ctx.scene.add(lights.group);
  };
  let bgTop: number = palette.backdropTop;
  let bgBottom: number = palette.backdropBottom;
  let keySource: KeySource = 'sun';
  let fading = false;
  let lastFraction = -1;
  let ui: TimeControl | null = null;
  let running = false;

  return {
    id: 'daycycle',

    init(ctx: WorldContext) {
      sky = findSkyLight(ctx.scene);
      if (ctx.specs.length) addSet('slice', buildCityLights(ctx.specs, ctx.slice, ctx.seed), ctx);
      if (!ctx.shot) ui = new TimeControl(ctx.overlay, ctx.clock, () => ctx.invalidate());
    },

    update(dt: number, now: WorldTime, ctx: WorldContext) {
      const sun = sunPosition(now.date);
      const alt = effectiveAltitude(sun);

      // 1. Direction: only when game time enters a new 10-minute step.
      if (stepper.check(now.date)) {
        const t = stepStart(stepper.index!);
        const stepped = sunPosition(t);
        const key = keyLight({ azimuthDeg: stepped.azimuthDeg, altitudeDeg: effectiveAltitude(stepped) });
        keySource = key.source;
        ctx.sun.position.copy(sunDirection(key.azimuthDeg, key.elevationDeg)).multiplyScalar(SUN_DISTANCE);
        ctx.sun.target.position.set(0, 0, 0);
        ctx.sun.updateMatrixWorld();
        ctx.sun.target.updateMatrixWorld();
        ctx.refreshShadows();
        ctx.events.emit('sunStep', { time: worldTime(t), altitudeDeg: stepped.altitudeDeg });
      }

      // 2. Colours and strengths: blended continuously by the true altitude.
      const w = presetWeights(alt);
      ctx.sun.color.setHex(blendHex(w, (p) => p.key));
      ctx.sun.intensity = blendNumber(w, (p) => p.keyIntensity) * keyScale(keySource, alt);
      ctx.sun.shadow.intensity = blendNumber(w, (p) => p.shadow);
      if (sky) {
        sky.color.setHex(blendHex(w, (p) => p.hemiSky));
        sky.groundColor.setHex(blendHex(w, (p) => p.hemiGround));
        sky.intensity = blendNumber(w, (p) => p.hemiIntensity);
      }
      bgTop = blendHex(w, (p) => p.bgTop);
      bgBottom = blendHex(w, (p) => p.bgBottom);
      ctx.setBackdrop(bgTop, bgBottom);

      // 3. City lights, staggered by per-light thresholds; fade unless frozen.
      lastAlt = alt;
      const immediate = ctx.shot || dt <= 0;
      const stepAmt = immediate ? 1 : dt / FADE_SEC;
      let lit = 0;
      let total = 0;
      fading = false;
      for (const { lights, levels } of sets.values()) {
        for (let i = 0; i < levels.length; i++) {
          const target = alt < lights.thresholds[i] ? 1 : 0;
          lit += target;
          const v = levels[i];
          if (v !== target) {
            levels[i] = target > v ? Math.min(target, v + stepAmt) : Math.max(target, v - stepAmt);
            if (levels[i] !== target) fading = true;
          }
        }
        total += levels.length;
        lights.apply(levels);
      }
      const fraction = total ? lit / total : 0;
      if (fraction !== lastFraction) {
        lastFraction = fraction;
        ctx.events.emit('lampsOn', { fraction });
      }

      running = ctx.clock.running;
      ui?.update(now);
    },

    animating() {
      return fading || running;
    },

    onChunk(id, type, chunk, ctx) {
      if (type === 'load') {
        addSet(id, buildCityLights(chunk.specs, chunk.data, ctx.seed), ctx);
      } else {
        const set = sets.get(id);
        if (!set) return;
        sets.delete(id);
        ctx.scene.remove(set.lights.group);
        set.lights.group.traverse((o) => (o as { geometry?: { dispose(): void } }).geometry?.dispose());
      }
    },

    dispose() {
      ui?.dispose();
    },
  };
}
