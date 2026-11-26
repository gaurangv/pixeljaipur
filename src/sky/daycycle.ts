import { Color, type HemisphereLight, type IUniform, type Mesh, type Object3D, type Scene, type WebGLRenderer } from 'three';
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

type BgUniforms = { uBgTop: IUniform<Color>; uBgBottom: IUniform<Color> };

/**
 * The backdrop gradient lives in PixelPass's private upscale material. Find it once by
 * watching the renderer draw a scene other than the city (the upscale quad), then stop watching.
 */
function watchBackdrop(renderer: WebGLRenderer, city: Scene, found: (u: BgUniforms) => void): void {
  const original = renderer.render;
  let tries = 0;
  renderer.render = function (this: WebGLRenderer, scene: Object3D, camera) {
    if (scene !== city) {
      let u: BgUniforms | null = null;
      scene.traverse((o) => {
        const m = (o as Mesh).material as { uniforms?: Partial<BgUniforms> } | undefined;
        if (!u && m && !Array.isArray(m) && m.uniforms?.uBgTop && m.uniforms.uBgBottom) u = m.uniforms as BgUniforms;
      });
      if (u || ++tries > 10) renderer.render = original;
      if (u) found(u);
    }
    return original.call(this, scene, camera);
  } as WebGLRenderer['render'];
}

export function createDayCycle(): System {
  const stepper = new SunStepper();
  let sky: HemisphereLight | null = null;
  let lights: CityLights | null = null;
  let levels = new Float32Array(0);
  let bg: BgUniforms | null = null;
  let bgTop: number = palette.backdropTop;
  let bgBottom: number = palette.backdropBottom;
  let keySource: KeySource = 'sun';
  let fading = false;
  let lastFraction = -1;
  let ui: TimeControl | null = null;
  let running = false;

  const applyBackdrop = () => {
    if (!bg) return;
    bg.uBgTop.value.setHex(bgTop);
    bg.uBgBottom.value.setHex(bgBottom);
  };

  return {
    id: 'daycycle',

    init(ctx: WorldContext) {
      sky = findSkyLight(ctx.scene);
      lights = buildCityLights(ctx.specs, ctx.slice, ctx.seed);
      levels = new Float32Array(lights.count);
      ctx.scene.add(lights.group);
      watchBackdrop(ctx.renderer, ctx.scene, (u) => {
        bg = u;
        applyBackdrop();
      });
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
      applyBackdrop();

      // 3. City lights, staggered by per-light thresholds; fade unless frozen.
      if (lights) {
        const immediate = ctx.shot || dt <= 0;
        const stepAmt = immediate ? 1 : dt / FADE_SEC;
        let lit = 0;
        fading = false;
        for (let i = 0; i < levels.length; i++) {
          const target = alt < lights.thresholds[i] ? 1 : 0;
          lit += target;
          const v = levels[i];
          if (v !== target) {
            levels[i] = target > v ? Math.min(target, v + stepAmt) : Math.max(target, v - stepAmt);
            if (levels[i] !== target) fading = true;
          }
        }
        lights.apply(levels);
        const fraction = levels.length ? lit / levels.length : 0;
        if (fraction !== lastFraction) {
          lastFraction = fraction;
          ctx.events.emit('lampsOn', { fraction });
        }
      }

      running = ctx.clock.running;
      ui?.update(now);
    },

    animating() {
      return fading || running;
    },

    dispose() {
      ui?.dispose();
    },
  };
}
