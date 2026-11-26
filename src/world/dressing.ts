import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { palette, type PaletteKey } from '../render/palette';
import type { FootprintCollection } from './footprints';
import { pointInRing } from './geometry';
import { Batch, unitBox } from './instancing';
import { chance, int, pick, range, rngFor, type Rng } from './rng';
import { GROUND_FLOOR_H, type FrontSpec, type ShopHouseSpec } from './shopHouse';

/*
 * Bazaar dressing: awnings, signboards, fruit carts, electric wires and cows.
 * Everything is seeded (same street every load) and instanced (few draw calls).
 * Data coords: x east, y north. three.js: (x, y_up, -y).
 */

type Pt = [number, number];

const AWNINGS: PaletteKey[] = ['awningRed', 'awningBlue', 'awningGreen', 'awningYellow', 'awningCanvas'];
const SIGNS: PaletteKey[] = ['marigold', 'awningBlue', 'awningGreen', 'limeWhite', 'awningRed'];
const FRUIT: PaletteKey[] = ['marigold', 'awningGreen', 'awningRed'];
const SCOOTERS: PaletteKey[] = ['awningRed', 'awningBlue', 'limeWhite', 'tankBlack'];

interface Frame {
  /** unit vector along the edge (data coords) */
  u: Pt;
  /** outward unit normal (data coords) */
  n: Pt;
  len: number;
}

function frame(f: FrontSpec): Frame {
  const dx = f.b[0] - f.a[0];
  const dy = f.b[1] - f.a[1];
  const len = Math.hypot(dx, dy);
  return { u: [dx / len, dy / len], n: [dy / len, -dx / len], len };
}

/** Box on a front: `along` the edge, `out` metres in front of the wall (centre), bottom at `y`, tilted down by `tiltDeg`. */
function faceBox(
  f: FrontSpec,
  fr: Frame,
  along: number,
  out: number,
  y: number,
  size: [number, number, number],
  tiltDeg = 0,
): Matrix4 {
  const px = f.a[0] + fr.u[0] * along + fr.n[0] * out;
  const py = f.a[1] + fr.u[1] * along + fr.n[1] * out;
  const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(fr.u[1], fr.u[0]));
  const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (tiltDeg * Math.PI) / 180);
  return new Matrix4().compose(new Vector3(px, y + size[1] / 2, -py), yaw.multiply(tilt), new Vector3(...size));
}

function onRoad(x: number, y: number, roads: Pt[][][]): boolean {
  return roads.some((rings) => pointInRing(x, y, rings[0]) && !rings.slice(1).some((h) => pointInRing(x, y, h)));
}

/** Pairs of facing fronts across a street, for electric wires. */
function crossStreetPairs(fronts: { f: FrontSpec; fr: Frame; s: ShopHouseSpec }[], rng: Rng) {
  const pairs: [Pt, Pt, number][] = [];
  for (const A of fronts) {
    if (A.fr.len < 4 || !chance(rng, 0.18)) continue;
    const ma: Pt = [(A.f.a[0] + A.f.b[0]) / 2, (A.f.a[1] + A.f.b[1]) / 2];
    let best: { m: Pt; d: number; h: number } | null = null;
    for (const B of fronts) {
      if (B === A) continue;
      if (A.fr.n[0] * B.fr.n[0] + A.fr.n[1] * B.fr.n[1] > -0.8) continue; // must face each other
      const mb: Pt = [(B.f.a[0] + B.f.b[0]) / 2, (B.f.a[1] + B.f.b[1]) / 2];
      const vx = mb[0] - ma[0];
      const vy = mb[1] - ma[1];
      const d = Math.hypot(vx, vy);
      if (d < 6 || d > 30) continue;
      if ((vx * A.fr.n[0] + vy * A.fr.n[1]) / d < 0.9) continue; // straight across
      if (!best || d < best.d) best = { m: mb, d, h: B.s.height };
    }
    if (best) pairs.push([ma, best.m, Math.min(A.s.height, best.h) - 1.2]);
  }
  return pairs;
}

export function buildDressing(specs: ShopHouseSpec[], data: FootprintCollection, worldSeed = 1): Group {
  const rng = rngFor('dressing', worldSeed);
  const awning = Object.fromEntries(AWNINGS.map((c) => [c, new Batch(`awning:${c}`, unitBox, c)])) as Record<PaletteKey, Batch>;
  const sign = Object.fromEntries(SIGNS.map((c) => [c, new Batch(`sign:${c}`, unitBox, c)])) as Record<PaletteKey, Batch>;
  const fruit = Object.fromEntries(FRUIT.map((c) => [c, new Batch(`fruit:${c}`, unitBox, c)])) as Record<PaletteKey, Batch>;
  const cart = new Batch('cart', unitBox, 'sandstoneShade');
  const cow = new Batch('cow', unitBox, 'limeWhite');
  const cowDark = new Batch('cowDark', unitBox, 'limeWhiteShade');

  const fronts: { f: FrontSpec; fr: Frame; s: ShopHouseSpec }[] = [];
  for (const s of specs) {
    const r = rngFor(`dress:${s.id}`, worldSeed);
    for (const f of s.fronts) {
      const fr = frame(f);
      fronts.push({ f, fr, s });
      if (!f.arcade) continue;
      const bayW = fr.len / f.bays;
      const awningColour = pick(r, AWNINGS); // one shop, one colour
      for (let i = 0; i < f.bays; i++) {
        const c = (i + 0.5) * bayW;
        if (chance(r, 0.45)) {
          awning[awningColour].add(faceBox(f, fr, c, 0.75, GROUND_FLOOR_H * 0.72 - 0.15, [bayW * 0.92, 0.08, 1.5], 22));
        } else if (chance(r, 0.5)) {
          sign[pick(r, SIGNS)].add(faceBox(f, fr, c, 0.1, GROUND_FLOOR_H * 0.72 + 0.28, [bayW * 0.75, 0.5, 0.08]));
        }
      }
      // Fruit / vegetable carts parked at the kerb in front of bazaar shops.
      if (chance(r, 0.22) && fr.len > 4) {
        const along = range(r, 1.5, fr.len - 1.5);
        cart.add(faceBox(f, fr, along, 2.6, 0.35, [1.9, 0.45, 1.0]));
        fruit[pick(r, FRUIT)].add(faceBox(f, fr, along, 2.6, 0.8, [1.7, 0.3, 0.85]));
      }
    }
  }

  // Parked street life: autos, scooters, a few handcarts, just inside the kerb.
  const roads = data.features
    .filter((f) => f.properties.kind === 'road')
    .flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [])) as Pt[][][];
  const autoBody = new Batch('auto:body', unitBox, 'autoGreen');
  const autoTop = new Batch('auto:top', unitBox, 'autoYellow');
  const tyre = new Batch('tyre', unitBox, 'tyre', false);
  const scooter = Object.fromEntries(SCOOTERS.map((c) => [c, new Batch(`scooter:${c}`, unitBox, c)])) as Record<PaletteKey, Batch>;
  const seat = new Batch('scooter:seat', unitBox, 'tankBlack', false);
  for (const { f, fr, s } of fronts) {
    if (!f.arcade || fr.len < 4) continue;
    const r = rngFor(`park:${s.id}:${f.edge}`, worldSeed);
    // the first point straight out from the shop front that is on the road = the kerb
    const kerbOut = (along: number) => {
      for (let out = 1.5; out <= 9; out += 0.5) {
        const x = f.a[0] + fr.u[0] * along + fr.n[0] * out;
        const y = f.a[1] + fr.u[1] * along + fr.n[1] * out;
        if (onRoad(x, y, roads)) return out;
      }
      return null;
    };
    if (chance(r, 0.16)) {
      const along = range(r, 1.6, fr.len - 1.6);
      const k = kerbOut(along);
      if (k !== null) {
        const out = k + 0.9;
        autoBody.add(faceBox(f, fr, along, out, 0.35, [2.6, 0.95, 1.3]));
        autoTop.add(faceBox(f, fr, along, out, 1.55, [2.3, 0.14, 1.4]));
        autoTop.add(faceBox(f, fr, along - 0.2, out, 1.3, [1.6, 0.25, 1.35]));
        for (const dx of [-0.9, 0.9]) tyre.add(faceBox(f, fr, along + dx, out, 0, [0.5, 0.45, 1.35]));
      }
    }
    if (chance(r, 0.4)) {
      const n = int(r, 1, 4);
      const start = range(r, 1, Math.max(1.1, fr.len - n * 0.9 - 1));
      const k = kerbOut(start);
      if (k !== null) {
        for (let i = 0; i < n; i++) {
          // scooters park nose-in, perpendicular to the kerb
          const along = start + i * 0.85;
          scooter[pick(r, SCOOTERS)].add(faceBox(f, fr, along, k + 0.8, 0.25, [0.45, 0.65, 1.6]));
          seat.add(faceBox(f, fr, along, k + 0.6, 0.9, [0.4, 0.15, 0.7]));
        }
      }
    }
  }

  // Electric wires across streets: sagging polylines, 1 px in the pixel pass.
  const verts: number[] = [];
  for (const [p, q, h] of crossStreetPairs(fronts, rng)) {
    const segs = 10;
    const sag = 0.06 * Math.hypot(q[0] - p[0], q[1] - p[1]);
    for (let k = 0; k < segs; k++) {
      for (const t of [k / segs, (k + 1) / segs]) {
        const x = p[0] + (q[0] - p[0]) * t;
        const y = p[1] + (q[1] - p[1]) * t;
        verts.push(x, h - sag * 4 * t * (1 - t), -y);
      }
    }
  }

  // A few cows standing in the road, as they do.
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < 3; tries++) {
    const x = range(rng, -60, 60);
    const y = range(rng, -40, 120);
    if (!onRoad(x, y, roads)) continue;
    const yaw = range(rng, 0, Math.PI * 2);
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    const part = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number) => {
      const off = new Vector3(lx, ly, lz).applyQuaternion(q);
      return new Matrix4().compose(new Vector3(x + off.x, off.y, -y + off.z), q, new Vector3(sx, sy, sz));
    };
    cow.add(part(0, 1.0, 0, 1.7, 0.75, 0.6)); // body
    cow.add(part(1.0, 1.25, 0, 0.5, 0.45, 0.4)); // head
    cowDark.add(part(0.25, 1.45, 0, 0.5, 0.25, 0.5)); // hump
    for (const [lx, lz] of [[0.6, 0.2], [0.6, -0.2], [-0.6, 0.2], [-0.6, -0.2]]) cowDark.add(part(lx, 0.32, lz, 0.15, 0.64, 0.15));
    placed++;
  }

  const group = new Group();
  group.name = 'dressing';
  for (const b of [...Object.values(awning), ...Object.values(sign), ...Object.values(fruit), cart, cow, cowDark, autoBody, autoTop, tyre, ...Object.values(scooter), seat]) {
    const m = b.build();
    if (m) group.add(m);
  }
  if (verts.length) {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(verts, 3));
    const wires = new LineSegments(g, new LineBasicMaterial({ color: palette.outline }));
    wires.name = 'wires';
    group.add(wires);
  }
  return group;
}

