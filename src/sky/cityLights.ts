import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { palette, type PaletteKey } from '../render/palette';
import type { FootprintCollection } from '../world/footprints';
import { pointInRing } from '../world/geometry';
import { Batch, unitBox } from '../world/instancing';
import { chance, pick, range, rngFor } from '../world/rng';
import { FLOOR_H, GROUND_FLOOR_H, onFace, type ShopHouseSpec } from '../world/shopHouse';
import { lightThresholds, type LightKind } from './sunModel';

/*
 * Evening city lights: window glows, shop interiors + bulbs under the arcades, and
 * street lamps along the bazaars. Every glow is ONE unlit InstancedMesh with per-instance
 * colour; ground light pools are one additive InstancedMesh; lamp posts one toon mesh.
 * Each logical light has a seeded threshold on sun altitude (see sunModel.lightThresholds)
 * and a level 0..1 that the day cycle fades.
 * Data coords: x east, y north. three.js: (x, y_up, -y).
 */

type Pt = [number, number];

const WINDOW_GLOWS: PaletteKey[] = ['glowWindow', 'glowWindow', 'glowWindow', 'glowWindow', 'glowWindow', 'glowWindowWarm', 'glowWindowWarm', 'glowWindowCool'];
/** Share of windows that ever light up (front, side). */
const FRONT_GLOW_P = 0.42;
const SIDE_GLOW_P = 0.22;
const SHOP_LIT_P = 0.8;
const LAMP_SPACING = 26;
const LAMP_H = 5.2;

interface Inst {
  matrix: Matrix4;
  on: Color;
  off: Color;
  /** stay visible (in the off colour) when the light is off: lamp glass */
  keepOff: boolean;
}

interface PoolInst {
  matrix: Matrix4;
  on: Color;
}

interface Logical {
  kind: LightKind;
  glow: number[]; // indices into the glow mesh
  pools: number[];
}

export interface CityLights {
  group: Group;
  /** Logical lights, each with a threshold altitude (on while the sun is below it). */
  count: number;
  thresholds: Float32Array;
  /** Apply levels (0..1 per logical light) to the meshes. Only changed lights are rewritten. */
  apply(levels: Float32Array): void;
  stats: { windows: number; shops: number; lamps: number; drawMeshes: number };
}

const _zero = new Matrix4().makeScale(0, 0, 0);
const _c = new Color();
const _q = new Quaternion();
const _flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

const col = (k: PaletteKey) => new Color(palette[k]);

function poolMatrix(x: number, y: number, r: number, lift: number): Matrix4 {
  return new Matrix4().compose(new Vector3(x, lift, -y), _flat, new Vector3(r, r, 1));
}

export function buildCityLights(specs: ShopHouseSpec[], data: FootprintCollection, worldSeed = 1): CityLights {
  const glows: Inst[] = [];
  const pools: PoolInst[] = [];
  const logical: Logical[] = [];
  const posts = new Batch('lampPost', unitBox, 'lampPost');
  const stats = { windows: 0, shops: 0, lamps: 0, drawMeshes: 0 };

  const offWindow = col('terracottaDeep');
  const offLamp = col('lampOff');
  const addGlow = (l: Logical, matrix: Matrix4, on: PaletteKey, off: Color, keepOff = false) => {
    l.glow.push(glows.length);
    glows.push({ matrix, on: col(on), off, keepOff });
  };
  const addPool = (l: Logical, x: number, y: number, r: number, on: PaletteKey, lift: number) => {
    l.pools.push(pools.length);
    pools.push({ matrix: poolMatrix(x, y, r, lift), on: col(on) });
  };

  const bazaar = new Set(data.features.filter((f) => f.properties.bazaar).map((f) => f.properties.id));
  const roads = data.features
    .filter((f) => f.properties.kind === 'road')
    .flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [])) as Pt[][][];
  const onRoad = (x: number, y: number) => roads.some((poly) => pointInRing(x, y, poly[0]) && !poly.slice(1).some((h) => pointInRing(x, y, h)));

  const windowLights: Logical[] = [];
  const shopLights: Logical[] = [];
  const lampLights: Logical[] = [];

  for (const s of specs) {
    const r = rngFor(`glow:${s.id}`, worldSeed);
    for (const f of s.fronts) {
      const len = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
      const bayW = len / f.bays;
      const ux = (f.b[0] - f.a[0]) / len;
      const uy = (f.b[1] - f.a[1]) / len;
      const nx = uy;
      const ny = -ux;

      // Upper-floor windows and jharokhas (same layout as src/world/shopHouse.ts).
      f.jharokhas.forEach((row, k) => {
        const y0 = GROUND_FLOOR_H + FLOOR_H * k + 0.6;
        row.forEach((isJ, i) => {
          if (!chance(r, FRONT_GLOW_P)) return;
          const c = (i + 0.5) * bayW;
          const l: Logical = { kind: 'window', glow: [], pools: [] };
          const tone = pick(r, WINDOW_GLOWS);
          if (isJ && bayW >= 2) {
            const w = Math.min(1.6, bayW * 0.6);
            addGlow(l, onFace(f.a, f.b, c, y0 + 0.25, w * 0.55, 1.05, 0.75), tone, col('limeWhite'));
          } else {
            const w = Math.min(1.0, bayW * 0.45);
            addGlow(l, onFace(f.a, f.b, c, y0 + 0.2, w * 0.66, 1.1, 0.09), tone, offWindow);
          }
          windowLights.push(l);
        });
      });

      // Shops: lit interior inside the arch, a bare bulb, a warm spill on the pavement.
      if (f.arcade) {
        const archW = bayW * 0.72;
        const archH = GROUND_FLOOR_H * 0.72;
        for (let i = 0; i < f.bays; i++) {
          if (!chance(r, SHOP_LIT_P)) continue;
          const c = (i + 0.5) * bayW;
          const l: Logical = { kind: 'bulb', glow: [], pools: [] };
          addGlow(l, onFace(f.a, f.b, c, 0.02, archW * 0.82, archH * 0.82, 0.11), 'glowShop', offWindow);
          addGlow(l, onFace(f.a, f.b, c + range(r, -0.2, 0.2) * archW, archH * 0.62, 0.24, 0.24, 0.5), 'glowBulb', offLamp);
          addPool(l, f.a[0] + ux * c + nx * 1.4, f.a[1] + uy * c + ny * 1.4, Math.min(1.6, bayW * 0.55), 'poolShop', 0.18);
          shopLights.push(l);
          stats.shops++;
        }
      }

      // Street lamps at the kerb along the bazaar fronts.
      if (bazaar.has(s.id) && len >= 8) {
        for (let along = range(r, 3, Math.min(len - 3, 14)); along < len - 2; along += LAMP_SPACING) {
          let out: number | null = null;
          for (let o = 1.5; o <= 9; o += 0.5) {
            if (onRoad(f.a[0] + ux * along + nx * o, f.a[1] + uy * along + ny * o)) {
              out = o - 0.35;
              break;
            }
          }
          if (out === null) continue;
          const x = f.a[0] + ux * along + nx * out;
          const y = f.a[1] + uy * along + ny * out;
          _q.setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(uy, ux));
          posts.add(new Matrix4().compose(new Vector3(x, LAMP_H / 2, -y), _q, new Vector3(0.3, LAMP_H, 0.3)));
          // a short arm out over the street, the lamp hanging at its end
          const ax = x + nx * 0.45;
          const ay = y + ny * 0.45;
          posts.add(new Matrix4().compose(new Vector3(ax, LAMP_H - 0.05, -ay), _q.clone(), new Vector3(0.2, 0.2, 1.0)));
          const l: Logical = { kind: 'lamp', glow: [], pools: [] };
          const hx = x + nx * 0.85;
          const hy = y + ny * 0.85;
          addGlow(l, new Matrix4().compose(new Vector3(hx, LAMP_H - 0.35, -hy), _q.clone(), new Vector3(0.6, 0.5, 0.6)), 'glowLamp', offLamp, true);
          addPool(l, hx, hy, 3.4, 'poolLamp', 0.19);
          addPool(l, hx, hy, 1.8, 'poolLamp', 0.2);
          lampLights.push(l);
          stats.lamps++;
        }
      }
    }

    // Side and back walls: a few small windows lit.
    for (const sd of s.sides) {
      const len = Math.hypot(sd.b[0] - sd.a[0], sd.b[1] - sd.a[1]);
      const step = len / sd.windows;
      for (let fl = 1; fl < s.levels; fl++) {
        const y0 = GROUND_FLOOR_H + FLOOR_H * (fl - 1) + 1.0;
        for (let i = 0; i < sd.windows; i++) {
          if (!chance(r, SIDE_GLOW_P)) continue;
          const l: Logical = { kind: 'window', glow: [], pools: [] };
          addGlow(l, onFace(sd.a, sd.b, (i + 0.5) * step, y0 + 0.17, 0.52, 0.86, 0.08), pick(r, WINDOW_GLOWS), offWindow);
          windowLights.push(l);
        }
      }
    }
  }
  stats.windows = windowLights.length;

  // Thresholds per kind (seeded), concatenated in the order lamps, shops, windows.
  logical.push(...lampLights, ...shopLights, ...windowLights);
  const thresholds = new Float32Array(logical.length);
  let o = 0;
  for (const [kind, list] of [['lamp', lampLights], ['bulb', shopLights], ['window', windowLights]] as const) {
    thresholds.set(lightThresholds(kind, list.length, worldSeed), o);
    o += list.length;
  }

  const group = new Group();
  group.name = 'cityLights';

  const glowMat = new MeshBasicMaterial({ color: 0xffffff });
  glowMat.name = 'sky:glow';
  const glowMesh = new InstancedMesh(unitBox, glowMat, Math.max(1, glows.length));
  glowMesh.name = 'cityLights:glow';
  glowMesh.castShadow = false;
  glowMesh.receiveShadow = false;
  glowMesh.count = glows.length;

  const poolMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false });
  poolMat.name = 'sky:pool';
  const poolMesh = new InstancedMesh(new CircleGeometry(1, 8), poolMat, Math.max(1, pools.length));
  poolMesh.name = 'cityLights:pools';
  poolMesh.castShadow = false;
  poolMesh.receiveShadow = false;
  poolMesh.count = pools.length;

  if (glows.length) group.add(glowMesh);
  if (pools.length) group.add(poolMesh);
  const postMesh = posts.build();
  if (postMesh) group.add(postMesh);
  stats.drawMeshes = group.children.length;

  // Start with everything off.
  const last = new Float32Array(logical.length).fill(-1);
  const black = new Color(0, 0, 0);
  const write = (levels: Float32Array, force: boolean) => {
    let g = false;
    let p = false;
    for (let i = 0; i < logical.length; i++) {
      const v = levels[i];
      if (!force && v === last[i]) continue;
      last[i] = v;
      for (const gi of logical[i].glow) {
        const inst = glows[gi];
        glowMesh.setMatrixAt(gi, v > 0 || inst.keepOff ? inst.matrix : _zero);
        glowMesh.setColorAt(gi, _c.copy(inst.off).lerp(inst.on, v));
        g = true;
      }
      for (const pi of logical[i].pools) {
        const inst = pools[pi];
        poolMesh.setMatrixAt(pi, v > 0 ? inst.matrix : _zero);
        poolMesh.setColorAt(pi, _c.copy(black).lerp(inst.on, v));
        p = true;
      }
    }
    if (g) {
      glowMesh.instanceMatrix.needsUpdate = true;
      if (glowMesh.instanceColor) glowMesh.instanceColor.needsUpdate = true;
    }
    if (p) {
      poolMesh.instanceMatrix.needsUpdate = true;
      if (poolMesh.instanceColor) poolMesh.instanceColor.needsUpdate = true;
    }
  };
  write(new Float32Array(logical.length), true);
  // Bounds from the full (lit) layout, so frustum culling never drops lights.
  const tmp = new Float32Array(logical.length).fill(1);
  write(tmp, true);
  glowMesh.computeBoundingSphere();
  poolMesh.computeBoundingSphere();
  write(new Float32Array(logical.length), true);

  return { group, count: logical.length, thresholds, apply: (levels) => write(levels, false), stats };
}
