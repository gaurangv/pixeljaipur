import { CylinderGeometry, Group, Matrix4, Quaternion, Vector3 } from 'three';
import type { PaletteKey } from '../render/palette';
import { pointInRing, type Pt } from './geometry';
import { Batch, unitBox } from './instancing';
import { chance, int, pick, range, rngFor } from './rng';
import { onFace, type ShopHouseSpec } from './shopHouse';

/*
 * Jaipur roofscape: flat terraces with a parapet on every edge, a stair-head room
 * ("mumty"), black water tanks, satellite dishes and the odd line of washing.
 * describeRoof() is pure and tested; buildRoofs() instances everything.
 */

export const PARAPET_H = 0.9;
const MUMTY = { w: 2.6, d: 2.4, h: 2.4 };
const LAUNDRY: PaletteKey[] = ['awningRed', 'awningBlue', 'marigold', 'limeWhite', 'awningGreen'];

export interface RoofSpec {
  /** Unit vector along the building's longest edge (data coords); roof items align to it. */
  axis: Pt;
  mumty: { at: Pt; w: number; d: number; h: number } | null;
  tanks: { at: Pt; onMumty: boolean }[];
  dish: Pt | null;
  laundry: { a: Pt; b: Pt; colours: PaletteKey[] } | null;
}

function centroid(ring: Pt[]): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const c = x0 * y1 - x1 * y0;
    a += c;
    cx += (x0 + x1) * c;
    cy += (y0 + y1) * c;
  }
  if (Math.abs(a) < 1e-9) return ring[0];
  return [cx / (3 * a), cy / (3 * a)];
}

/** True if the point is on the roof (inside the outer ring, not in a courtyard), with `margin` metres to spare. */
function onRoof(spec: ShopHouseSpec, [x, y]: Pt, margin = 0): boolean {
  const pts: Pt[] = margin ? [[x, y], [x + margin, y], [x - margin, y], [x, y + margin], [x, y - margin]] : [[x, y]];
  return pts.every(([px, py]) => pointInRing(px, py, spec.rings[0]) && !spec.rings.slice(1).some((h) => pointInRing(px, py, h)));
}

export function describeRoof(spec: ShopHouseSpec, worldSeed = 1): RoofSpec {
  const rng = rngFor(`roof:${spec.id}`, worldSeed);
  const ring = spec.rings[0];
  let best = 0;
  let axis: Pt = [1, 0];
  for (let i = 0; i < ring.length - 1; i++) {
    const dx = ring[i + 1][0] - ring[i][0];
    const dy = ring[i + 1][1] - ring[i][1];
    const l = Math.hypot(dx, dy);
    if (l > best) {
      best = l;
      axis = [dx / l, dy / l];
    }
  }
  const across: Pt = [-axis[1], axis[0]];
  const c = centroid(ring);
  const along = (p: Pt, t: number, s = 0): Pt => [p[0] + axis[0] * t + across[0] * s, p[1] + axis[1] * t + across[1] * s];

  const roof: RoofSpec = { axis, mumty: null, tanks: [], dish: null, laundry: null };
  if (spec.levels < 2) {
    // Kiosks: maybe one tank, nothing else.
    if (onRoof(spec, c, 0.8) && chance(rng, 0.3)) roof.tanks.push({ at: c, onMumty: false });
    return roof;
  }

  if (chance(rng, 0.75)) {
    // Irregular (L-shaped, notched) roofs: try a few spots, then also the vertices' neighbourhood.
    const tries: Pt[] = [c];
    for (let i = 0; i < 6; i++) tries.push(along(c, range(rng, -0.4, 0.4) * best, range(rng, -3, 3)));
    for (const v of ring.slice(0, -1)) tries.push([v[0] * 0.6 + c[0] * 0.4, v[1] * 0.6 + c[1] * 0.4]);
    const at = tries.find((p) => onRoof(spec, p, 2.2));
    if (at) roof.mumty = { at, ...MUMTY };
  }
  const nTanks = int(rng, 0, 3);
  for (let i = 0; i < nTanks; i++) {
    if (roof.mumty && i === 0) {
      roof.tanks.push({ at: along(roof.mumty.at, range(rng, -0.6, 0.6)), onMumty: true });
      continue;
    }
    const at = along(c, range(rng, -0.4, 0.4) * best, range(rng, -2, 2));
    if (onRoof(spec, at, 0.9)) roof.tanks.push({ at, onMumty: false });
  }
  if (chance(rng, 0.3)) {
    const at = along(c, range(rng, -0.35, 0.35) * best, range(rng, -1.5, 1.5));
    if (onRoof(spec, at, 0.8)) roof.dish = at;
  }
  if (best > 6 && chance(rng, 0.18)) {
    const mid = along(c, 0, range(rng, -1.5, 1.5));
    const a = along(mid, -Math.min(3, best * 0.3));
    const b = along(mid, Math.min(3, best * 0.3));
    if (onRoof(spec, a, 0.5) && onRoof(spec, b, 0.5)) {
      roof.laundry = { a, b, colours: Array.from({ length: int(rng, 3, 6) }, () => pick(rng, LAUNDRY)) };
    }
  }
  return roof;
}

const _q = new Quaternion();
const _up = new Vector3(0, 1, 0);
function oriented(at: Pt, y: number, axis: Pt, sx: number, sy: number, sz: number, tiltX = 0): Matrix4 {
  const q = _q.setFromAxisAngle(_up, Math.atan2(axis[1], axis[0])).clone();
  if (tiltX) q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tiltX));
  return new Matrix4().compose(new Vector3(at[0], y + sy / 2, -at[1]), q, new Vector3(sx, sy, sz));
}

export function buildRoofs(specs: ShopHouseSpec[], worldSeed = 1): Group {
  const tankGeo = new CylinderGeometry(0.5, 0.5, 1, 8);
  const dishGeo = new CylinderGeometry(0.5, 0.12, 0.18, 8);
  const shade = new Map<PaletteKey, Batch>(); // parapets + mumtys match their building
  const byShade = (k: PaletteKey) => {
    let b = shade.get(k);
    if (!b) shade.set(k, (b = new Batch(`roof:${k}`, unitBox, k)));
    return b;
  };
  const cap = new Batch('roof:cap', unitBox, 'limeWhite');
  const capMuted = new Batch('roof:capMuted', unitBox, 'limeWhiteShade');
  const door = new Batch('roof:door', unitBox, 'terracottaDeep');
  const tank = new Batch('roof:tank', tankGeo, 'tankBlack');
  const dish = new Batch('roof:dish', dishGeo, 'dishGrey');
  const post = new Batch('roof:post', unitBox, 'trunk');
  const cloth = Object.fromEntries(LAUNDRY.map((k) => [k, new Batch(`roof:cloth:${k}`, unitBox, k)])) as Record<PaletteKey, Batch>;

  for (const s of specs) {
    const ring = s.rings[0];
    const fronts = new Set(s.fronts.map((f) => f.edge));
    // Parapet on every edge; fronts also get a lime-white coping.
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i];
      const b = ring[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.6) continue;
      byShade(s.shade).add(onFace(a, b, len / 2, s.height, len + 0.1, PARAPET_H, 0.22));
      if (fronts.has(i)) cap.add(onFace(a, b, len / 2, s.height + PARAPET_H, len + 0.2, 0.14, 0.32));
    }

    const r = describeRoof(s, worldSeed);
    if (r.mumty) {
      const m = r.mumty;
      byShade(s.shade).add(oriented(m.at, s.height, r.axis, m.w, m.h, m.d));
      capMuted.add(oriented(m.at, s.height + m.h, r.axis, m.w + 0.2, 0.15, m.d + 0.2));
      // a dark door on the mumty's long side
      const doorAt: Pt = [m.at[0] - r.axis[1] * (m.d / 2), m.at[1] + r.axis[0] * (m.d / 2)];
      door.add(oriented(doorAt, s.height, r.axis, 0.9, 1.9, 0.08));
    }
    for (const t of r.tanks) {
      const base = s.height + (t.onMumty && r.mumty ? r.mumty.h + 0.15 : 0);
      tank.add(oriented(t.at, base, r.axis, 1.1, 1.1, 1.1));
    }
    if (r.dish) dish.add(oriented(r.dish, s.height + 0.6, r.axis, 1, 1, 1, 0.6));
    if (r.laundry) {
      const { a, b, colours } = r.laundry;
      post.add(oriented(a, s.height, r.axis, 0.08, 1.8, 0.08));
      post.add(oriented(b, s.height, r.axis, 0.08, 1.8, 0.08));
      colours.forEach((k, i) => {
        const t = (i + 0.5) / colours.length;
        const at: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        cloth[k].add(oriented(at, s.height + 1.0, r.axis, 0.55, 0.7, 0.04));
      });
    }
  }

  const group = new Group();
  group.name = 'roofs';
  for (const b of [...shade.values(), cap, capMuted, door, tank, dish, post, ...Object.values(cloth)]) {
    const m = b.build();
    if (m) group.add(m);
  }
  return group;
}
