import { hashString, mulberry32, type Rng } from '../world/rng';
import type { LaneGraph } from './lanes';

/*
 * Traffic simulation: pure logic, no three.js. Vehicles follow lanes of the LaneGraph
 * (left-hand traffic), keep a gap to the vehicle ahead (IDM car-following with a hard
 * no-overlap clamp), give way when entering Badi Chaupar, take seeded random turns, and
 * leave / re-enter the diorama at the slice edge. Cows are slow "vehicles" that stop in
 * the road now and then. Everything random comes from one seeded RNG, so the same seed and
 * the same steps give the same state.
 */

export type VehicleKind = 'auto' | 'eRickshaw' | 'cycleRickshaw' | 'scooter' | 'bus' | 'camelCart' | 'cow';

export interface KindSpec {
  /** length / width in metres (bounding box used for gaps) */
  len: number;
  width: number;
  /** top speed, m/s */
  vmax: number;
  /** comfortable acceleration, m/s^2 */
  accel: number;
  /** highest lane class it uses (0 main roads only, 1 + residential, 2 + galis) */
  maxClass: number;
}

export const KINDS: Record<VehicleKind, KindSpec> = {
  auto: { len: 2.6, width: 1.35, vmax: 7, accel: 1.6, maxClass: 2 },
  eRickshaw: { len: 2.8, width: 1.3, vmax: 5, accel: 1.0, maxClass: 2 },
  cycleRickshaw: { len: 2.4, width: 1.15, vmax: 2.6, accel: 0.6, maxClass: 2 },
  scooter: { len: 1.7, width: 0.6, vmax: 9, accel: 2.5, maxClass: 2 },
  bus: { len: 10, width: 2.5, vmax: 7, accel: 0.8, maxClass: 0 },
  camelCart: { len: 6, width: 1.7, vmax: 1.6, accel: 0.4, maxClass: 1 },
  cow: { len: 1.9, width: 0.6, vmax: 0.6, accel: 0.3, maxClass: 1 },
};

/** The default fleet: 160 vehicles at most (a Jaipur bazaar is busy). */
export const FLEET: readonly [VehicleKind, number][] = [
  ['bus', 2],
  ['camelCart', 1],
  ['cow', 6],
  ['auto', 50],
  ['eRickshaw', 28],
  ['cycleRickshaw', 14],
  ['scooter', 59],
];

/** Speed limit by lane class (main, residential, gali), connectors and the ring. */
const LANE_SPEED = [9, 4.5, 3];
const TURN_SPEED = 4;
const RING_SPEED = 6;
const GAP_MIN = 0.4; // m, bumper to bumper, never less
const S0 = 1.2; // m, IDM jam gap
const HEADWAY = 0.9; // s
const BRAKE = 3; // m/s^2 comfortable
const MAX_BRAKE = 9;
const YIELD_LOOK = 14; // m: ring traffic this close to the entry has priority
/** Relative pull of main bazaars / residential streets / galis (placement, entries, turns). */
const CLASS_PULL = [1, 0.2, 0.08];
const WAIT_GIVE_UP = 20; // s stuck at a junction -> the driver turns off into a gali (respawn)

/** Share of the fleet on the road by hour (IST): quiet at night, busy late afternoon/evening. */
const TRAFFIC_CURVE: [number, number][] = [
  [0, 0.15], [5, 0.15], [7, 0.7], [10, 0.85], [13, 0.8], [18, 1], [20, 0.9], [22, 0.5], [24, 0.15],
];

export function piecewise(curve: readonly [number, number][], h: number): number {
  const x = ((h % 24) + 24) % 24;
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    const [x0, y0] = curve[i - 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
  }
  return curve[curve.length - 1][1];
}

export const trafficDensity = (h: number) => piecewise(TRAFFIC_CURVE, h);

export interface Vehicle {
  readonly id: number;
  readonly kind: VehicleKind;
  readonly spec: KindSpec;
  /** 0..1; on the road while rank < density (bus and camel cart: always) */
  readonly rank: number;
  /** personal speed factor */
  readonly pace: number;
  /** render-only sideways offset within the lane, metres (left +) */
  readonly lat: number;
  active: boolean;
  lane: number;
  s: number;
  v: number;
  /** last acceleration, m/s^2 */
  acc: number;
  /** chosen next lane (-1: the lane ends at the slice edge) */
  next: number;
  /** target lane this vehicle has claimed while on a junction connector, or -1 */
  claim: number;
  seg: number;
  /** seconds blocked at a junction */
  wait: number;
  /** cows: seconds left standing still (> 0) or walking (< 0) */
  pause: number;
  hornCd: number;
  spawnCd: number;
  // output (data coords) — centre and heading
  x: number;
  y: number;
  hx: number;
  hy: number;
}

export interface SimOptions {
  seed?: number;
  hours?: number;
  fleet?: readonly [VehicleKind, number][];
  /** scatter the active fleet over the lanes at start (default true) */
  scatter?: boolean;
}

export type HornFn = (x: number, y: number, kind: VehicleKind) => void;

export class TrafficSim {
  readonly vehicles: Vehicle[] = [];
  readonly rng: Rng;
  density = 1;
  /** vehicles per lane (unordered) */
  private readonly occ: number[][];
  private readonly claimCount: Int32Array;
  private readonly claimBy: Int32Array;
  private readonly roadLanes: number[];
  private readonly tmp = { x: 0, y: 0, dx: 0, dy: 0 };
  // leader search result (no allocation)
  private gap = 0;
  private leadV = 0;
  private leadCow = false;
  /** set by findLeader when the vehicle waits at a stop line */
  private blocked = false;
  /** stats for tests / tuning */
  stats = { respawns: 0, horns: 0, sinks: 0 };

  constructor(readonly g: LaneGraph, opts: SimOptions = {}) {
    this.rng = mulberry32(hashString(`traffic:${opts.seed ?? 1}`));
    this.occ = Array.from({ length: g.count }, () => []);
    this.claimCount = new Int32Array(g.count);
    this.claimBy = new Int32Array(g.count).fill(-1);
    this.roadLanes = [];
    for (let i = 0; i < g.count; i++) if (!g.connector[i] && g.length[i] > 3) this.roadLanes.push(i);
    this.density = trafficDensity(opts.hours ?? 12);
    let id = 0;
    for (const [kind, n] of opts.fleet ?? FLEET) {
      for (let k = 0; k < n; k++) {
        const always = kind === 'bus' || kind === 'camelCart';
        this.vehicles.push({
          id: id++, kind, spec: KINDS[kind], rank: always ? 0 : this.rng(), pace: 0.85 + 0.25 * this.rng(),
          lat: kind === 'scooter' ? (this.rng() - 0.5) * 0.7 : kind === 'cow' ? 0.3 + 0.3 * this.rng() : 0,
          active: false, lane: -1, s: 0, v: 0, acc: 0, next: -1, claim: -1, seg: 0, wait: 0,
          pause: kind === 'cow' ? -5 - 20 * this.rng() : 0, hornCd: 0, spawnCd: this.rng() * 3,
          x: 0, y: 0, hx: 1, hy: 0,
        });
      }
    }
    // Scatter the active part of the fleet over the lanes.
    if (opts.scatter !== false) for (const v of this.vehicles) if (v.rank < this.density) this.place(v);
  }

  /** Put vehicle `id` on `lane` at `s` (tests / scripted scenes). Optionally force its next lane. */
  put(id: number, lane: number, s: number, speed: number, next?: number): Vehicle {
    const v = this.vehicles[id];
    if (v.active) this.leave(v);
    this.enter(v, lane, s, speed);
    if (next !== undefined) v.next = next;
    return v;
  }

  setHours(h: number): void {
    this.density = trafficDensity(h);
  }

  /** Lanes a vehicle kind may use. */
  private allowed(v: Vehicle, lane: number): boolean {
    return this.g.cls[lane] <= v.spec.maxClass;
  }

  /** Put a vehicle somewhere free on a random road lane (initial scatter). */
  private place(v: Vehicle): boolean {
    const g = this.g;
    for (let t = 0; t < 40; t++) {
      const lane = this.roadLanes[Math.floor(this.rng() * this.roadLanes.length)];
      if (!this.allowed(v, lane) || g.length[lane] < v.spec.len + 2) continue;
      // longer lanes and the bazaars are likelier
      if (this.rng() * 60 > g.length[lane] * CLASS_PULL[g.cls[lane]]) continue;
      const s = v.spec.len / 2 + 0.5 + this.rng() * (g.length[lane] - v.spec.len - 1);
      if (!this.clear(lane, s, v.spec.len, 2)) continue;
      this.enter(v, lane, s, v.spec.vmax * 0.4);
      return true;
    }
    return false;
  }

  /** Is [s - len/2 - margin, s + len/2 + margin] on `lane` free? */
  private clear(lane: number, s: number, len: number, margin: number): boolean {
    for (const j of this.occ[lane]) {
      const o = this.vehicles[j];
      if (Math.abs(o.s - s) < (o.spec.len + len) / 2 + margin) return false;
    }
    return true;
  }

  private enter(v: Vehicle, lane: number, s: number, speed: number): void {
    v.active = true;
    v.lane = lane;
    v.s = s;
    v.v = speed;
    v.seg = 0;
    v.wait = 0;
    v.claim = -1;
    this.occ[lane].push(v.id);
    v.next = this.chooseNext(v, lane);
    this.locate(v);
  }

  private leave(v: Vehicle): void {
    this.unoccupy(v.lane, v.id);
    if (v.claim >= 0) this.release(v);
    v.active = false;
    v.lane = -1;
    v.spawnCd = 0.5 + this.rng() * 3;
  }

  private unoccupy(lane: number, id: number): void {
    const a = this.occ[lane];
    const i = a.indexOf(id);
    if (i >= 0) {
      a[i] = a[a.length - 1];
      a.pop();
    }
  }

  private release(v: Vehicle): void {
    if (--this.claimCount[v.claim] <= 0) {
      this.claimCount[v.claim] = 0;
      this.claimBy[v.claim] = -1;
    }
    v.claim = -1;
  }

  /** Random turn at the end of a road lane (connectors have exactly one way on). */
  private chooseNext(v: Vehicle, lane: number): number {
    const g = this.g;
    const nx = g.next[lane];
    if (!nx.length) return -1;
    if (g.connector[lane]) return nx[0];
    let total = 0;
    for (const c of nx) total += this.weight(v, c);
    if (total <= 0) return nx[Math.floor(this.rng() * nx.length)];
    let r = this.rng() * total;
    for (const c of nx) {
      r -= this.weight(v, c);
      if (r <= 0) return c;
    }
    return nx[nx.length - 1];
  }

  private weight(v: Vehicle, conn: number): number {
    const target = this.g.next[conn][0];
    if (!this.allowed(v, target)) return 0;
    // Stay on the bazaars more often than turning into galis; avoid dead-end U-turns.
    const w = CLASS_PULL[this.g.cls[target]];
    return this.g.next[target].length || this.g.nodeEdge[this.g.to[target]] ? w : 0.1;
  }

  /** May vehicle v drive onto junction connector c now? (claims + give-way at the ring) */
  private mayEnter(v: Vehicle, c: number): boolean {
    const g = this.g;
    const target = g.next[c][0];
    if (this.claimCount[target] > 0 && this.claimBy[target] !== c) return false;
    if (g.giveWay[c]) {
      for (const pl of g.priority.get(c) ?? []) {
        for (const j of this.occ[pl]) {
          if (j === v.id) continue;
          const o = this.vehicles[j];
          if (g.connector[pl]) return false;
          const toGo = g.length[pl] - o.s;
          if (toGo < 4 || (toGo < YIELD_LOOK && o.v > 0.3)) return false;
        }
      }
    }
    return true;
  }

  /** Nearest obstacle ahead along the planned route: sets this.gap / leadV / leadCow. */
  private findLeader(v: Vehicle): void {
    const g = this.g;
    const half = v.spec.len / 2;
    let gap = Infinity;
    let lv = 0;
    let cow = false;
    for (const j of this.occ[v.lane]) {
      if (j === v.id) continue;
      const o = this.vehicles[j];
      if (o.s > v.s || (o.s === v.s && j < v.id)) {
        const d = o.s - v.s - half - o.spec.len / 2;
        if (d < gap) {
          gap = d;
          lv = o.v;
          cow = o.kind === 'cow';
        }
      }
    }
    const toEnd = g.length[v.lane] - v.s;
    if (gap === Infinity && toEnd < 60) {
      // Look into the next lane(s) on the route.
      let lane = v.next;
      let dist = toEnd;
      for (let depth = 0; depth < 3 && lane >= 0 && dist < 60; depth++) {
        let best = Infinity;
        for (const j of this.occ[lane]) {
          const o = this.vehicles[j];
          const d = dist + o.s - half - o.spec.len / 2;
          if (d < best) {
            best = d;
            lv = o.v;
            cow = o.kind === 'cow';
          }
        }
        if (best < Infinity) {
          gap = best;
          break;
        }
        dist += g.length[lane];
        lane = g.connector[lane] ? g.next[lane][0] : -1;
      }
    }
    if (toEnd < 12 && !g.connector[v.lane]) {
      // Vehicles that just turned off this lane onto another connector still have their tail here.
      for (const c of g.next[v.lane]) {
        if (c === v.next) continue;
        for (const j of this.occ[c]) {
          const o = this.vehicles[j];
          const d = toEnd + o.s - half - o.spec.len / 2;
          if (o.s < o.spec.len && d < gap) {
            gap = d;
            lv = o.v;
            cow = false;
          }
        }
      }
    }
    // Stop line: junction not free (claimed by another approach, or ring traffic has priority).
    if (!g.connector[v.lane] && v.next >= 0 && toEnd < 25) {
      if (!this.mayEnter(v, v.next)) {
        const d = toEnd - half - 0.3;
        if (d < gap) {
          gap = d;
          lv = 0;
          cow = false;
        }
        this.blocked = true;
      }
    }
    this.gap = gap;
    this.leadV = lv;
    this.leadCow = cow;
  }

  private laneSpeed(lane: number): number {
    const g = this.g;
    if (g.ring[lane]) return RING_SPEED;
    if (g.connector[lane]) return TURN_SPEED;
    return LANE_SPEED[g.cls[lane]] ?? 3;
  }

  private locate(v: Vehicle): void {
    const t = this.tmp;
    v.seg = this.g.locate(v.lane, v.s, v.seg, t);
    v.hx = t.dx;
    v.hy = t.dy;
    v.x = t.x - t.dy * v.lat;
    v.y = t.y + t.dx * v.lat;
  }

  /** Advance the simulation by dt seconds (real time). */
  step(dt: number, horn?: HornFn): void {
    if (dt <= 0) return;
    const n = Math.ceil(dt / 0.05);
    const h = dt / n;
    for (let k = 0; k < n; k++) this.substep(h, horn);
  }

  private substep(dt: number, horn?: HornFn): void {
    const g = this.g;
    for (const v of this.vehicles) {
      if (!v.active) {
        v.spawnCd -= dt;
        if (v.spawnCd <= 0 && v.rank < this.density) this.spawn(v);
        continue;
      }
      v.hornCd -= dt;
      // cows: stroll, then stand in the road for a while
      if (v.kind === 'cow') {
        if (v.pause > 0) {
          v.pause -= dt;
          if (v.pause <= 0) v.pause = -(8 + 20 * this.rng());
        } else {
          v.pause += dt;
          if (v.pause >= 0) v.pause = 6 + 12 * this.rng();
        }
      }
      this.blocked = false;
      this.findLeader(v);
      const gap = this.gap;
      if (this.blocked) v.wait += dt;
      else v.wait = 0;

      let v0 = Math.min(v.spec.vmax * v.pace, this.laneSpeed(v.lane));
      if (v.kind === 'cow' && v.pause > 0) v0 = 0.001;
      // slow down for the turn ahead
      if (!g.connector[v.lane] && v.next >= 0) {
        const toEnd = g.length[v.lane] - v.s;
        const vt = this.laneSpeed(v.next);
        v0 = Math.min(v0, Math.sqrt(vt * vt + 2 * BRAKE * Math.max(0, toEnd)));
      }
      const a = v.spec.accel;
      const sStar = S0 + v.v * HEADWAY + (v.v * (v.v - this.leadV)) / (2 * Math.sqrt(a * BRAKE));
      const free = 1 - (v.v / v0) ** 4;
      const inter = gap === Infinity ? 0 : (Math.max(0, sStar) / Math.max(gap, 0.05)) ** 2;
      let acc = a * (free - inter);
      if (acc < -MAX_BRAKE) acc = -MAX_BRAKE;
      let nv = v.v + acc * dt;
      if (nv < 0) nv = 0;
      let ds = nv * dt;
      const room = gap - GAP_MIN;
      if (ds > room) {
        ds = Math.max(0, room);
        nv = Math.min(nv, ds / dt);
        acc = (nv - v.v) / dt;
      }
      v.acc = acc;
      // Horn: hard braking, or stuck behind a cow standing in the road.
      if (horn && v.kind !== 'cow' && v.hornCd <= 0) {
        const hard = acc < -4 && v.v > 2;
        const cowBlock = this.leadCow && nv < 0.2 && gap < 4;
        if ((hard && this.rng() < 0.4) || (cowBlock && this.rng() < dt * 0.3)) {
          horn(v.x, v.y, v.kind);
          this.stats.horns++;
          v.hornCd = 4 + 4 * this.rng();
        }
      }
      v.v = nv;
      v.s += ds;
      if (v.wait > WAIT_GIVE_UP) {
        // Gridlock breaker: this driver turns off into a side street.
        this.stats.respawns++;
        this.leave(v);
        continue;
      }
      this.advanceLanes(v);
      if (v.active) this.locate(v);
    }
  }

  private advanceLanes(v: Vehicle): void {
    const g = this.g;
    while (v.s >= g.length[v.lane]) {
      if (v.next < 0) {
        // left the diorama at the slice edge
        this.stats.sinks++;
        this.leave(v);
        return;
      }
      v.s -= g.length[v.lane];
      this.unoccupy(v.lane, v.id);
      const lane = v.next;
      v.lane = lane;
      v.seg = 0;
      this.occ[lane].push(v.id);
      if (g.connector[lane]) {
        const target = g.next[lane][0];
        if (v.claim >= 0) this.release(v);
        this.claimCount[target]++;
        this.claimBy[target] = lane;
        v.claim = target;
        v.next = target;
      } else {
        if (v.claim === lane) this.release(v);
        v.next = this.chooseNext(v, lane);
      }
    }
  }

  private spawn(v: Vehicle): void {
    const src = this.g.sources;
    if (!src.length) return;
    for (let t = 0; t < 4; t++) {
      const lane = src[Math.floor(this.rng() * src.length)];
      if (!this.allowed(v, lane) || this.g.length[lane] < v.spec.len + 1) continue;
      if (this.rng() > CLASS_PULL[this.g.cls[lane]]) continue; // most traffic comes in on the bazaars
      const s = v.spec.len / 2 + 0.2;
      if (!this.clear(lane, s, v.spec.len, 3)) continue;
      this.enter(v, lane, s, Math.min(v.spec.vmax, 3));
      return;
    }
    v.spawnCd = 0.5 + this.rng();
  }

  /** Same-lane overlaps (bumper to bumper < 0), for tests. */
  overlaps(): number {
    let n = 0;
    for (const lane of this.occ) {
      for (let i = 0; i < lane.length; i++) {
        for (let j = i + 1; j < lane.length; j++) {
          const a = this.vehicles[lane[i]];
          const b = this.vehicles[lane[j]];
          if (Math.abs(a.s - b.s) < (a.spec.len + b.spec.len) / 2 - 1e-6) n++;
        }
      }
    }
    return n;
  }

  /** Vehicles currently on lane i (for tests). */
  on(lane: number): readonly number[] {
    return this.occ[lane];
  }

  /** Compact state for determinism checks. */
  snapshot(): number[] {
    const out: number[] = [];
    for (const v of this.vehicles) out.push(v.active ? 1 : 0, v.lane, Math.round(v.s * 1000), Math.round(v.v * 1000));
    return out;
  }
}
