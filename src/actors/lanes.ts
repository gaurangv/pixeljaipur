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

  constructor(data: LanesJson) {
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
