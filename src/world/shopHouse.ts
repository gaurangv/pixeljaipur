import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  ConeGeometry,
  ExtrudeGeometry,
  Group,
  Matrix4,
  Mesh,
  Path,
  Quaternion,
  Shape,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonVertex } from '../render/materials';
import { palette, type PaletteKey } from '../render/palette';
import type { FootprintCollection, FootprintFeature } from './footprints';
import { at, Batch, buildPooled, unitBox } from './instancing';
import { chance, int, pick, rngFor, type Rng } from './rng';

/*
 * Seeded shop-house generator.
 * describeShopHouse() is pure (footprint + seed -> spec) and unit-tested.
 * buildShopHouses() turns all specs into a handful of merged / instanced meshes.
 *
 * Data coords: x east, y north (metres). three.js: x east, y up, z = -north.
 */

export const GROUND_FLOOR_H = 3.8;
export const FLOOR_H = 3.4;
/** Neighbouring buildings vary within their colour family so streets don't look flat. */
const SHADES: Partial<Record<PaletteKey, readonly PaletteKey[]>> = {
  terracotta: ['terracotta', 'terracotta', 'terracottaLight', 'terracottaDusty'],
  terracottaShade: ['terracottaShade', 'terracottaDusty'],
  sandstone: ['sandstone', 'ochre'],
  limeWhite: ['limeWhite', 'limeWhiteShade'],
};
/** Wall base darkening (fake ambient occlusion): vertex colour factor at ground level. */
const AO_BASE = 0.82;
const BAY_TARGET = 3.2;
const SIDE_MIN = 4; // side walls shorter than this stay blank
const SIDE_BAY = 3.6; // metres per arcade bay / window bay
const KIOSK_AREA = 20;

type Pt = [number, number];

export interface FrontSpec {
  edge: number;
  a: Pt;
  b: Pt;
  bays: number;
  /** For each upper floor (index 0 = first floor), which bays get a jharokha (others get a plain window). */
  jharokhas: boolean[][];
  arcade: boolean;
}

/** A plain side/back wall: small windows on the upper floors, maybe a drainpipe. */
export interface SideSpec {
  edge: number;
  a: Pt;
  b: Pt;
  /** windows per upper floor */
  windows: number;
  pipe: boolean;
}

export interface ShopHouseSpec {
  id: string;
  rings: Pt[][]; // [outer CCW, ...holes]
  levels: number;
  height: number;
  /** Colour family of the walls (tests and rules use this). */
  wall: PaletteKey;
  /** The exact palette shade used for this building's walls (seeded variation within the family). */
  shade: PaletteKey;
  fronts: FrontSpec[];
  sides: SideSpec[];
  chhatri: Pt | null;
}

function ringArea(r: Pt[]): number {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return a / 2;
}

function pickLevels(f: FootprintFeature, area: number, rng: Rng): number {
  if (f.properties.levels) return Math.max(1, Math.min(6, Math.round(f.properties.levels)));
  if (area < KIOSK_AREA) return 1;
  if (f.properties.bazaar) return 3; // the bazaars have a uniform 3-storey frontage
  const r = rng();
  return r < 0.35 ? 2 : r < 0.85 ? 3 : 4;
}

function pickWall(f: FootprintFeature, rng: Rng): PaletteKey {
  if (f.properties.bazaar) return 'terracotta';
  return pick(rng, [
    'terracotta', 'terracotta', 'terracotta', 'terracotta', 'terracotta', 'terracotta', 'terracotta',
    'terracottaShade', 'sandstone', 'limeWhite',
  ] as const);
}

/** Shared geometry (one instance pool per geometry when streaming chunks). */
const dome = new ConeGeometry(0.5, 1, 8, 1);

export function describeShopHouse(f: FootprintFeature, worldSeed = 1): ShopHouseSpec | null {
  if (f.geometry.type !== 'Polygon') return null;
  const rings = f.geometry.coordinates as Pt[][];
  const outer = rings[0];
  if (!outer || outer.length < 4) return null;
  const area = Math.abs(ringArea(outer));
  const rng = rngFor(f.properties.id, worldSeed);

  const levels = pickLevels(f, area, rng);
  const height = GROUND_FLOOR_H + FLOOR_H * (levels - 1);
  const wall = pickWall(f, rng);

  const fronts: FrontSpec[] = [];
  for (const edge of f.properties.front ?? []) {
    const a = outer[edge];
    const b = outer[edge + 1];
    if (!a || !b) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 2) continue;
    const bays = Math.max(1, Math.round(len / BAY_TARGET));
    const jharokhas: boolean[][] = [];
    const pattern = int(rng, 0, 2); // 0: alternate, 1: all, 2: centre only
    for (let fl = 1; fl < levels; fl++) {
      jharokhas.push(
        Array.from({ length: bays }, (_, i) =>
          pattern === 0 ? i % 2 === fl % 2 : pattern === 1 ? true : i === Math.floor(bays / 2),
        ),
      );
    }
    fronts.push({ edge, a, b, bays, jharokhas, arcade: levels > 1 && len >= 3 });
  }

  let chhatri: Pt | null = null;
  if (area > 40 && levels >= 2 && chance(rng, 0.15)) {
    // near a front corner if there is one, else the first vertex, pulled 2.5 m inwards
    const corner = fronts[0]?.a ?? outer[0];
    let cx = 0;
    let cy = 0;
    for (const p of outer.slice(0, -1)) {
      cx += p[0];
      cy += p[1];
    }
    cx /= outer.length - 1;
    cy /= outer.length - 1;
    const dx = cx - corner[0];
    const dy = cy - corner[1];
    const d = Math.hypot(dx, dy) || 1;
    const pull = Math.min(2.5, d * 0.5);
    chhatri = [corner[0] + (dx / d) * pull, corner[1] + (dy / d) * pull];
  }

  // Drawn last so adding it didn't change any earlier choices.
  const shade = pick(rng, SHADES[wall] ?? [wall]);

  const sides: SideSpec[] = [];
  if (levels >= 2) {
    const frontSet = new Set(fronts.map((fr) => fr.edge));
    for (let edge = 0; edge < outer.length - 1; edge++) {
      if (frontSet.has(edge)) continue;
      const a = outer[edge];
      const b = outer[edge + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < SIDE_MIN) continue;
      sides.push({ edge, a, b, windows: Math.max(1, Math.floor(len / SIDE_BAY)), pipe: chance(rng, 0.25) });
    }
  }
  return { id: f.properties.id, rings, levels, height, wall, shade, fronts, sides, chhatri };
}

// ---------------------------------------------------------------------------
// Mesh building
// ---------------------------------------------------------------------------

const _q = new Quaternion();
const _up = new Vector3(0, 1, 0);

/**
 * Transform for a box that sits on a wall face.
 * `along` metres along the edge from `a`, `y` = bottom height, sizes in metres,
 * `out` = how far it protrudes from the wall (its depth).
 */
export function onFace(a: Pt, b: Pt, along: number, y: number, width: number, height: number, out: number): Matrix4 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  // outward normal of a CCW ring, in data coords
  const nx = uy;
  const ny = -ux;
  const px = a[0] + ux * along + nx * (out / 2 - 0.02);
  const py = a[1] + uy * along + ny * (out / 2 - 0.02);
  _q.setFromAxisAngle(_up, Math.atan2(dy, dx));
  return new Matrix4().compose(new Vector3(px, y + height / 2, -py), _q.clone(), new Vector3(width, height, out));
}

function wallGeometry(spec: ShopHouseSpec): BufferGeometry | null {
  const g = extrude(spec);
  if (!g) return null;
  // Bake the palette shade per vertex, darker at the foot of the wall.
  const base = new Color(palette[spec.shade]);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = pos.getY(i) < 0.01 ? AO_BASE : 1;
    col[i * 3] = base.r * k;
    col[i * 3 + 1] = base.g * k;
    col[i * 3 + 2] = base.b * k;
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return g;
}

function extrude(spec: ShopHouseSpec): BufferGeometry | null {
  const toV = ([x, y]: Pt) => new Vector2(x, y);
  const shape = new Shape(spec.rings[0].map(toV));
  for (const h of spec.rings.slice(1)) if (h.length >= 4) shape.holes.push(new Path(h.map(toV)));
  try {
    const g = new ExtrudeGeometry(shape, { depth: spec.height, bevelEnabled: false });
    g.rotateX(-Math.PI / 2); // extrude +z -> up; shape y (north) -> -z
    return g;
  } catch {
    return null;
  }
}

export interface ShopHouseStats {
  buildings: number;
  instances: number;
}

export function buildShopHouses(
  data: FootprintCollection,
  worldSeed = 1,
): { group: Group; specs: ShopHouseSpec[]; stats: ShopHouseStats } {
  const specs = data.features
    .filter((f) => f.properties.kind === 'building')
    .map((f) => describeShopHouse(f, worldSeed))
    .filter((s): s is ShopHouseSpec => s !== null);

  const walls: BufferGeometry[] = [];

  const batches = {
    arch: new Batch('arch', unitBox, 'terracottaDeep', false),
    pillar: new Batch('pillar', unitBox, 'terracottaShade'),
    archTrim: new Batch('archTrim', unitBox, 'limeWhite', false),
    chhajja: new Batch('chhajja', unitBox, 'sandstone'),
    window: new Batch('window', unitBox, 'terracottaDeep', false),
    jharokha: new Batch('jharokha', unitBox, 'limeWhite'),
    jharokhaCap: new Batch('jharokhaCap', unitBox, 'sandstoneShade'),
    chhatriPillar: new Batch('chhatriPillar', unitBox, 'limeWhite'),
    chhatriDome: new Batch('chhatriDome', dome, 'limeWhiteShade'),
    sill: new Batch('sill', unitBox, 'limeWhiteShade', false),
    pipe: new Batch('pipe', unitBox, 'dishGrey', false),
  };

  for (const s of specs) {
    const g = wallGeometry(s);
    if (g) walls.push(g);

    for (const f of s.fronts) {
      const len = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
      const bayW = len / f.bays;

      // Ground floor: arcade of dark arch openings between pillars, lime-white band above.
      if (f.arcade) {
        for (let i = 0; i < f.bays; i++) {
          const c = (i + 0.5) * bayW;
          batches.arch.add(onFace(f.a, f.b, c, 0, bayW * 0.72, GROUND_FLOOR_H * 0.72, 0.08));
          batches.archTrim.add(onFace(f.a, f.b, c, GROUND_FLOOR_H * 0.72, bayW * 0.72, 0.25, 0.1));
        }
        for (let i = 0; i <= f.bays; i++) {
          batches.pillar.add(onFace(f.a, f.b, i * bayW, 0, 0.45, GROUND_FLOOR_H - 0.3, 0.3));
        }
      }

      // Chhajja ledge at every floor line and the roof line.
      for (let fl = 1; fl <= s.levels; fl++) {
        const y = fl === s.levels ? s.height - 0.2 : GROUND_FLOOR_H + FLOOR_H * (fl - 1) - 0.2;
        if (s.levels === 1 && fl === 1) break;
        batches.chhajja.add(onFace(f.a, f.b, len / 2, y, len + 0.4, 0.2, 0.7));
      }

      // Upper floors: jharokhas or plain windows per bay.
      f.jharokhas.forEach((row, k) => {
        const y0 = GROUND_FLOOR_H + FLOOR_H * k + 0.6;
        row.forEach((isJ, i) => {
          const c = (i + 0.5) * bayW;
          if (isJ && bayW >= 2) {
            batches.jharokha.add(onFace(f.a, f.b, c, y0 - 0.2, Math.min(1.6, bayW * 0.6), 1.9, 0.7));
            batches.jharokhaCap.add(onFace(f.a, f.b, c, y0 + 1.7, Math.min(1.9, bayW * 0.7), 0.25, 0.85));
          } else {
            batches.window.add(onFace(f.a, f.b, c, y0, Math.min(1.0, bayW * 0.45), 1.5, 0.06));
          }
        });
      });

    }

    // Side and back walls: modest window rows with sills, the odd drainpipe.
    for (const sd of s.sides) {
      const len = Math.hypot(sd.b[0] - sd.a[0], sd.b[1] - sd.a[1]);
      const step = len / sd.windows;
      for (let fl = 1; fl < s.levels; fl++) {
        const y0 = GROUND_FLOOR_H + FLOOR_H * (fl - 1) + 1.0;
        for (let i = 0; i < sd.windows; i++) {
          const c = (i + 0.5) * step;
          batches.window.add(onFace(sd.a, sd.b, c, y0, 0.8, 1.2, 0.05));
          batches.sill.add(onFace(sd.a, sd.b, c, y0 - 0.12, 1.0, 0.12, 0.18));
        }
      }
      if (sd.pipe) batches.pipe.add(onFace(sd.a, sd.b, 0.4, 0, 0.14, s.height, 0.18));
    }

    if (s.chhatri) {
      const [x, y] = s.chhatri;
      const z = -y;
      const base = s.height + 0.9; // on top of the parapet line
      const h = 1.8;
      for (const [ox, oz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
        batches.chhatriPillar.add(at(x + ox, base + h / 2, z + oz, 0.25, h, 0.25));
      }
      batches.chhatriPillar.add(at(x, base + h + 0.1, z, 2.4, 0.2, 2.4)); // slab
      batches.chhatriDome.add(at(x, base + h + 0.2 + 0.7, z, 2.2, 1.4, 2.2));
    }
  }

  const group = new Group();
  group.name = 'shopHouses';
  // All walls in ONE draw call: colour comes from the baked vertex colours.
  const merged = walls.length ? mergeGeometries(walls) : null;
  walls.forEach((g) => g.dispose());
  if (merged) {
    const mesh = new Mesh(merged, toonVertex());
    mesh.name = 'walls';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const all = Object.values(batches);
  const instances = all.reduce((n, b) => n + b.matrices.length, 0);
  for (const m of buildPooled(all, 'shopHouses')) group.add(m);
  return { group, specs, stats: { buildings: specs.length, instances } };
}
