/**
 * The lane graph (data/build/<slice>.lanes.json, written by scripts/build_slice.py), packed
 * into flat typed arrays for a cheap per-frame update, plus a uniform grid for spatial lookups.
 * Data coords: x east, y north, metres. Traffic drives on the LEFT.
 */

export interface LanesJson {
  ring: { c: [number, number]; r: number };
  nodes: [number, number, number][];
  lanes: { p: number[]; n: number[]; a: number; b: number; c: number; w: number; j?: number; r?: number; y?: number }[];
  walks: number[][];
  /** 1 for walks along bazaar shop fronts */
  busy?: number[];
}

/**
 * Compact city format (v2, build_slice.py for chunked slices): road lanes only, points as
 * decimetre deltas; `n` lists the road lanes reachable through each junction, `u` which of
 * those are U-turns. The connector curves are rebuilt here with the build script's Bezier.
 */
export interface LanesJsonV2 {
  v: 2;
  ring: { c: [number, number]; r: number };
  nodes: [number, number, number][];
  lanes: { p: number[]; n: number[]; u?: number[]; a: number; b: number; c: number; w: number; r?: number }[];
}

/** Same curve as `_bezier` in scripts/build_slice.py. Returns flat [x, y, ...]. */
export function connectorCurve(
  p0: [number, number], d0: [number, number], p2: [number, number], d2: [number, number], uturn: boolean,
): number[] {
  const dist = Math.hypot(p2[0] - p0[0], p2[1] - p0[1]);
  const k = (uturn ? 1.3 : 0.4) * Math.max(dist, 0.5);
  const c1 = [p0[0] + d0[0] * k, p0[1] + d0[1] * k];
  const c2 = [p2[0] - d2[0] * k, p2[1] - d2[1] * k];
  const n = Math.max(2, Math.min(10, Math.ceil((dist * (uturn ? 2 : 1)) / 1.5)));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    for (const a of [0, 1]) {
      out.push(Math.round((u ** 3 * p0[a] + 3 * u * u * t * c1[a] + 3 * u * t * t * c2[a] + t ** 3 * p2[a]) * 10) / 10);
    }
  }
  return out;
}

const unit = (ax: number, ay: number, bx: number, by: number): [number, number] => {
  const d = Math.hypot(bx - ax, by - ay) || 1;
  return [(bx - ax) / d, (by - ay) / d];
};

/** Expand the compact v2 file into the full lane list (road lanes keep their ids; connectors follow). */
export function expandLanes(d: LanesJsonV2): LanesJson {
  const lanes: LanesJson['lanes'] = d.lanes.map((l) => {
    const p: number[] = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i < l.p.length; i += 2) {
      x += l.p[i];
      y += l.p[i + 1];
      p.push(x / 10, y / 10);
    }
    return { p, n: [], a: l.a, b: l.b, c: l.c, w: l.w, ...(l.r ? { r: 1 } : {}) };
  });
  const nRoad = lanes.length;
  for (let li = 0; li < nRoad; li++) {
    const L = lanes[li];
    const src = d.lanes[li];
    const k = L.p.length;
    const p0: [number, number] = [L.p[k - 2], L.p[k - 1]];
    const d0 = unit(L.p[k - 4], L.p[k - 3], p0[0], p0[1]);
    src.n.forEach((mi, i) => {
      const M = lanes[mi];
      const p2: [number, number] = [M.p[0], M.p[1]];
      const d2 = unit(p2[0], p2[1], M.p[2], M.p[3]);
      const ring = !!L.r && !!M.r;
      L.n.push(lanes.length);
      lanes.push({
        p: connectorCurve(p0, d0, p2, d2, !!src.u?.includes(i)), n: [mi], a: L.b, b: L.b, c: M.c, w: Math.min(L.w, M.w), j: 1,
        ...(ring ? { r: 1 } : {}), ...(!L.r && M.r ? { y: 1 } : {}),
      });
    });
  }
  return { ring: d.ring, nodes: d.nodes, lanes, walks: [] };
}

/** Lane class: 0 main bazaar road, 1 residential, 2 service lane / gali. */
export type LaneClass = 0 | 1 | 2;

export class LaneGraph {
  readonly count: number;
  /** Polyline points of every lane, packed: x, y, x, y, ... */
  readonly xy: Float32Array;
  /** Cumulative length at each point (same indexing as points). */
  readonly cum: Float32Array;
  /** Unit direction of the segment starting at each point (last point repeats the previous). */
  readonly dir: Float32Array;
  /** First point index of each lane (lane i spans start[i] .. start[i+1]-1). */
  readonly start: Int32Array;
  readonly length: Float32Array;
  readonly next: Int32Array[];
  /** Lanes that lead INTO each lane (reverse of next). */
  readonly prev: Int32Array[];
  readonly from: Int32Array;
  readonly to: Int32Array;
  readonly cls: Uint8Array;
  readonly width: Float32Array;
  readonly connector: Uint8Array;
  readonly ring: Uint8Array;
  readonly giveWay: Uint8Array;
  readonly nodeXY: Float32Array;
  readonly nodeEdge: Uint8Array;
  /** Road lanes (not connectors) that start at the slice edge: traffic enters here. */
  readonly sources: number[];
  /** For each give-way connector, the ring lanes whose traffic has priority over it. */
  readonly priority: Map<number, number[]>;
  readonly ringCentre: [number, number];
  readonly ringRadius: number;

  // spatial grid of lane segments
  private readonly cell = 10;
  private readonly gx0: number;
  private readonly gy0: number;
  private readonly gw: number;
  private readonly gh: number;
  private readonly grid: Int32Array[];

  constructor(input: LanesJson | LanesJsonV2) {
    const data = 'v' in input && input.v === 2 ? expandLanes(input) : (input as LanesJson);
    const L = data.lanes;
    this.count = L.length;
    const nPts = L.reduce((n, l) => n + l.p.length / 2, 0);
    this.xy = new Float32Array(nPts * 2);
    this.cum = new Float32Array(nPts);
    this.dir = new Float32Array(nPts * 2);
    this.start = new Int32Array(L.length + 1);
    this.length = new Float32Array(L.length);
    this.from = new Int32Array(L.length);
    this.to = new Int32Array(L.length);
    this.cls = new Uint8Array(L.length);
    this.width = new Float32Array(L.length);
    this.connector = new Uint8Array(L.length);
    this.ring = new Uint8Array(L.length);
    this.giveWay = new Uint8Array(L.length);
    this.next = L.map((l) => Int32Array.from(l.n));
    const prev: number[][] = L.map(() => []);
    let k = 0;
    L.forEach((l, i) => {
      this.start[i] = k;
      let acc = 0;
      const n = l.p.length / 2;
      for (let j = 0; j < n; j++) {
        const x = l.p[2 * j];
        const y = l.p[2 * j + 1];
        if (j > 0) acc += Math.hypot(x - l.p[2 * j - 2], y - l.p[2 * j - 1]);
        this.xy[2 * (k + j)] = x;
        this.xy[2 * (k + j) + 1] = y;
        this.cum[k + j] = acc;
      }
      for (let j = 0; j < n; j++) {
        const a = Math.min(j, n - 2);
        const dx = l.p[2 * a + 2] - l.p[2 * a];
        const dy = l.p[2 * a + 3] - l.p[2 * a + 1];
        const d = Math.hypot(dx, dy) || 1;
        this.dir[2 * (k + j)] = dx / d;
        this.dir[2 * (k + j) + 1] = dy / d;
      }
      this.length[i] = acc;
      this.from[i] = l.a;
      this.to[i] = l.b;
      this.cls[i] = l.c;
      this.width[i] = l.w;
      this.connector[i] = l.j ? 1 : 0;
      this.ring[i] = l.r ? 1 : 0;
      this.giveWay[i] = l.y ? 1 : 0;
      for (const m of l.n) prev[m].push(i);
      k += n;
    });
    this.start[L.length] = k;
    this.prev = prev.map((p) => Int32Array.from(p));
    this.nodeXY = Float32Array.from(data.nodes.flatMap((n) => [n[0], n[1]]));
    this.nodeEdge = Uint8Array.from(data.nodes.map((n) => n[2]));
    this.sources = [];
    for (let i = 0; i < L.length; i++) if (!this.connector[i] && this.nodeEdge[this.from[i]]) this.sources.push(i);
    this.ringCentre = data.ring.c;
    this.ringRadius = data.ring.r;

    // Priority for a give-way entry at node n: ring lanes arriving at n, and ring connectors at n.
    this.priority = new Map();
    for (let i = 0; i < L.length; i++) {
      if (!this.giveWay[i]) continue;
      const n = this.from[i];
      const pr: number[] = [];
      for (let j = 0; j < L.length; j++) {
        if (!this.ring[j]) continue;
        if ((!this.connector[j] && this.to[j] === n) || (this.connector[j] && this.from[j] === n)) pr.push(j);
      }
      this.priority.set(i, pr);
    }

    // Grid
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < nPts; i++) {
      x0 = Math.min(x0, this.xy[2 * i]);
      x1 = Math.max(x1, this.xy[2 * i]);
      y0 = Math.min(y0, this.xy[2 * i + 1]);
      y1 = Math.max(y1, this.xy[2 * i + 1]);
    }
    this.gx0 = x0 - this.cell;
    this.gy0 = y0 - this.cell;
    this.gw = Math.ceil((x1 - x0) / this.cell) + 3;
    this.gh = Math.ceil((y1 - y0) / this.cell) + 3;
    const cells: Set<number>[] = Array.from({ length: this.gw * this.gh }, () => new Set());
    for (let i = 0; i < L.length; i++) {
      for (let p = this.start[i]; p < this.start[i + 1] - 1; p++) {
        const ax = this.xy[2 * p], ay = this.xy[2 * p + 1], bx = this.xy[2 * p + 2], by = this.xy[2 * p + 3];
        const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / (this.cell / 2)) + 1;
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          cells[this.cellOf(ax + (bx - ax) * t, ay + (by - ay) * t)].add(i);
        }
      }
    }
    this.grid = cells.map((s) => Int32Array.from(s));
  }

  private cellOf(x: number, y: number): number {
    const cx = Math.min(this.gw - 1, Math.max(0, Math.floor((x - this.gx0) / this.cell)));
    const cy = Math.min(this.gh - 1, Math.max(0, Math.floor((y - this.gy0) / this.cell)));
    return cy * this.gw + cx;
  }

  /** Position on lane `lane` at distance `s`. `seg` is a cursor hint (point index within the lane); returns the updated cursor. */
  locate(lane: number, s: number, seg: number, out: { x: number; y: number; dx: number; dy: number }): number {
    const a = this.start[lane];
    const last = this.start[lane + 1] - 1;
    let p = Math.max(a, Math.min(a + seg, last - 1));
    while (p > a && this.cum[p] > s) p--;
    while (p < last - 1 && this.cum[p + 1] < s) p++;
    const segLen = this.cum[p + 1] - this.cum[p] || 1;
    const t = Math.min(1, Math.max(0, (s - this.cum[p]) / segLen));
    out.x = this.xy[2 * p] + (this.xy[2 * p + 2] - this.xy[2 * p]) * t;
    out.y = this.xy[2 * p + 1] + (this.xy[2 * p + 3] - this.xy[2 * p + 1]) * t;
    out.dx = this.dir[2 * p];
    out.dy = this.dir[2 * p + 1];
    return p - a;
  }

  /** Nearest lane to (x, y) within `maxDist` metres, or -1. Uses the grid (3x3 cells). */
  nearest(x: number, y: number, maxDist = this.cell): { lane: number; s: number; d: number } {
    let best = { lane: -1, s: 0, d: maxDist };
    const cx = Math.floor((x - this.gx0) / this.cell);
    const cy = Math.floor((y - this.gy0) / this.cell);
    for (let j = cy - 1; j <= cy + 1; j++) {
      for (let i = cx - 1; i <= cx + 1; i++) {
        if (i < 0 || j < 0 || i >= this.gw || j >= this.gh) continue;
        for (const lane of this.grid[j * this.gw + i]) {
          for (let p = this.start[lane]; p < this.start[lane + 1] - 1; p++) {
            const ax = this.xy[2 * p], ay = this.xy[2 * p + 1];
            const vx = this.xy[2 * p + 2] - ax, vy = this.xy[2 * p + 3] - ay;
            const l2 = vx * vx + vy * vy || 1;
            const t = Math.min(1, Math.max(0, ((x - ax) * vx + (y - ay) * vy) / l2));
            const d = Math.hypot(ax + vx * t - x, ay + vy * t - y);
            if (d < best.d) best = { lane, s: this.cum[p] + t * Math.sqrt(l2), d };
          }
        }
      }
    }
    return best;
  }
}
