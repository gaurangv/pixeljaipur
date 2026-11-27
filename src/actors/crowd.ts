import { hashString, mulberry32, type Rng } from '../world/rng';
import { piecewise } from './sim';

/*
 * Pedestrians: tiny people strolling along the "walks" from the lane file (in front of
 * shop fronts, along footways, past the Hawa Mahal). Pure logic; seeded; no allocation per step.
 */

/** Share of the crowd out by hour (IST): quiet early morning, peak bazaar around 19:00, thin at night. */
const CROWD_CURVE: [number, number][] = [
  [0, 0.06], [4, 0.03], [5.5, 0.08], [7, 0.4], [9, 0.5], [12, 0.55], [15, 0.55], [17, 0.75], [19, 1], [21, 0.7], [22.5, 0.32], [24, 0.06],
];

export const crowdDensity = (h: number) => piecewise(CROWD_CURVE, h);

export interface Walker {
  readonly id: number;
  readonly rank: number;
  readonly speed: number;
  /** sideways offset from the walk line, metres (left +) */
  readonly lat: number;
  /** look: index into the render's outfit table */
  readonly look: number;
  active: boolean;
  walk: number;
  s: number;
  dir: 1 | -1;
  seg: number;
  pause: number;
  x: number;
  y: number;
  hx: number;
  hy: number;
}

const LINK = 2.5; // m: walk ends this close are joined
const BAZAAR_PULL = 10; // shoppers per metre on a bazaar front vs. a quiet lane

export class Crowd {
  readonly walkers: Walker[] = [];
  readonly rng: Rng;
  density = 1;
  count = 0;
  private xy = new Float32Array(0);
  private cum = new Float32Array(0);
  private start = new Int32Array(1);
  length = new Float32Array(0);
  /** links[2*w + end] = flat list of (walk, end) pairs reachable from that end */
  private links: Int32Array[] = [];
  /** weight of each walk when scattering people (bazaar fronts draw the crowds) */
  private weight = new Float32Array(0);
  /** stable key of each walk (city mode: "<chunk>:<i>"), to keep walkers on their walk across reloads */
  private keys: string[] = [];

  constructor(
    walks: number[][],
    opts: { seed?: number; hours?: number; cap?: number; looks?: number; busy?: number[] } = {},
  ) {
    this.rng = mulberry32(hashString(`crowd:${opts.seed ?? 1}`));
    this.load(walks, opts.busy);
    this.density = crowdDensity(opts.hours ?? 12);
    const cap = opts.cap ?? 400;
    const looks = opts.looks ?? 1;
    // City mode starts with no walks (they stream in with the chunks); walkers wait unplaced.
    for (let id = 0; id < cap && (this.count || !walks.length); id++) {
      const p: Walker = {
        id, rank: this.rng(), speed: 0.9 + 0.6 * this.rng(), lat: (this.rng() - 0.5) * 0.6,
        look: Math.floor(this.rng() * looks), active: false, walk: -1, s: 0,
        dir: this.rng() < 0.5 ? 1 : -1, seg: 0, pause: this.rng() < 0.3 ? this.rng() * 6 : 0, x: 0, y: 0, hx: 1, hy: 0,
      };
      this.walkers.push(p);
      if (this.count) this.place(p, this.pickWeighted());
      p.active = p.walk >= 0 && p.rank < this.density;
    }
  }

  private pickWeighted(): number {
    let total = 0;
    for (let w = 0; w < this.count; w++) total += this.length[w] * this.weight[w];
    // pick a walk weighted by length (bazaar fronts count more)
    let r = this.rng() * total;
    let w = 0;
    while (w < this.count - 1 && r > this.length[w] * this.weight[w]) r -= this.length[w] * this.weight[w++];
    return w;
  }

  private place(p: Walker, w: number): void {
    p.walk = w;
    p.s = this.rng() * this.length[w];
    p.seg = 0;
    this.locate(p);
  }

  /**
   * City streaming: replace the walk set (the walks of the loaded chunks). Walkers on a walk
   * that is still there (same key) carry on; the rest are placed again near the view.
   */
  setWalks(walks: number[][], busy: number[], keys: string[]): void {
    const old = this.walkers.map((p) => (p.walk >= 0 ? this.keys[p.walk] : undefined));
    this.load(walks, busy, keys);
    const idx = new Map(this.keys.map((k, i) => [k, i]));
    if (this.region) this.setRegion(this.region, false);
    this.walkers.forEach((p, i) => {
      const w = old[i] !== undefined ? idx.get(old[i]!) : undefined;
      if (w !== undefined) {
        p.walk = w;
        p.s = Math.min(p.s, this.length[w]);
        p.seg = 0;
        this.locate(p);
      } else if (!this.count) {
        p.walk = -1;
      } else if (this.region && this.regionWalks.length) {
        this.relocate(p);
      } else {
        this.place(p, this.pickWeighted());
      }
      p.active = p.walk >= 0 && p.rank < this.density;
    });
  }

  private load(walks: number[][], busy?: number[], keys?: string[]): void {
    const keep = walks.map((_, i) => i).filter((i) => walks[i].length >= 4);
    const ws = keep.map((i) => walks[i]);
    this.keys = keep.map((i) => keys?.[i] ?? String(i));
    this.weight = Float32Array.from(keep.map((i) => (busy?.[i] ? BAZAAR_PULL : 1)));
    this.count = ws.length;
    const nPts = ws.reduce((n, w) => n + w.length / 2, 0);
    this.xy = new Float32Array(nPts * 2);
    this.cum = new Float32Array(nPts);
    this.start = new Int32Array(ws.length + 1);
    this.length = new Float32Array(ws.length);
    let k = 0;
    ws.forEach((w, i) => {
      this.start[i] = k;
      let acc = 0;
      for (let j = 0; j < w.length / 2; j++) {
        if (j) acc += Math.hypot(w[2 * j] - w[2 * j - 2], w[2 * j + 1] - w[2 * j - 1]);
        this.xy[2 * (k + j)] = w[2 * j];
        this.xy[2 * (k + j) + 1] = w[2 * j + 1];
        this.cum[k + j] = acc;
      }
      this.length[i] = acc;
      k += w.length / 2;
    });
    this.start[ws.length] = k;

    // Link walk ends through a hash grid of end points.
    const ends = new Map<string, number[]>();
    const key = (x: number, y: number) => `${Math.floor(x / LINK)},${Math.floor(y / LINK)}`;
    const endPt = (w: number, e: number) => {
      const p = e ? this.start[w + 1] - 1 : this.start[w];
      return [this.xy[2 * p], this.xy[2 * p + 1]];
    };
    for (let w = 0; w < ws.length; w++) {
      for (const e of [0, 1]) {
        const [x, y] = endPt(w, e);
        const kk = key(x, y);
        const list = ends.get(kk) ?? [];
        list.push(w * 2 + e);
        ends.set(kk, list);
      }
    }
    this.links = [];
    for (let w = 0; w < ws.length; w++) {
      for (const e of [0, 1]) {
        const [x, y] = endPt(w, e);
        const out: number[] = [];
        const cx = Math.floor(x / LINK);
        const cy = Math.floor(y / LINK);
        for (let j = cy - 1; j <= cy + 1; j++) {
          for (let i = cx - 1; i <= cx + 1; i++) {
            for (const we of ends.get(`${i},${j}`) ?? []) {
              const w2 = we >> 1;
              if (w2 === w) continue;
              const [x2, y2] = endPt(w2, we & 1);
              if (Math.hypot(x2 - x, y2 - y) <= LINK) out.push(w2, we & 1);
            }
          }
        }
        this.links.push(Int32Array.from(out));
      }
    }
  }

  private region: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private regionWalks: number[] = [];

  /** City streaming: people walk only near the view; anyone far outside is moved back in. */
  setRegion(r: { x0: number; y0: number; x1: number; y1: number } | null, move = true): void {
    this.region = r;
    if (!r) return;
    const inside = (x: number, y: number) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
    this.regionWalks = [];
    for (let w = 0; w < this.count; w++) {
      const a = this.start[w];
      const b = this.start[w + 1] - 1;
      if (inside((this.xy[2 * a] + this.xy[2 * b]) / 2, (this.xy[2 * a + 1] + this.xy[2 * b + 1]) / 2)) this.regionWalks.push(w);
    }
    if (move) for (const p of this.walkers) if (p.walk >= 0 && !this.near(p)) this.relocate(p);
  }

  private near(p: Walker, pad = 30): boolean {
    const r = this.region;
    return !r || (p.x >= r.x0 - pad && p.x <= r.x1 + pad && p.y >= r.y0 - pad && p.y <= r.y1 + pad);
  }

  private relocate(p: Walker): void {
    if (!this.regionWalks.length) return;
    p.walk = this.regionWalks[Math.floor(this.rng() * this.regionWalks.length)];
    p.s = this.rng() * this.length[p.walk];
    p.seg = 0;
    this.locate(p);
  }

  setHours(h: number): void {
    this.density = crowdDensity(h);
    for (const p of this.walkers) p.active = p.walk >= 0 && p.rank < this.density;
  }

  step(dt: number): void {
    if (dt <= 0) return;
    for (const p of this.walkers) {
      if (!p.active || p.walk < 0) continue;
      if (p.pause > 0) {
        p.pause -= dt;
        continue;
      }
      // now and then stop to look at a shop
      if (this.rng() < dt * 0.04) p.pause = 1.5 + this.rng() * 5;
      p.s += p.dir * p.speed * dt;
      const len = this.length[p.walk];
      if (p.s > len || p.s < 0) {
        const over = p.s > len ? p.s - len : -p.s;
        const end = p.s > len ? 1 : 0;
        const l = this.links[2 * p.walk + end];
        if (l.length && this.rng() < 0.85) {
          const k = Math.floor(this.rng() * (l.length / 2));
          const w2 = l[2 * k];
          const e2 = l[2 * k + 1];
          p.walk = w2;
          p.seg = 0;
          if (e2 === 0) {
            p.s = Math.min(over, this.length[w2]);
            p.dir = 1;
          } else {
            p.s = Math.max(0, this.length[w2] - over);
            p.dir = -1;
          }
        } else {
          p.dir = end ? -1 : 1;
          p.s = end ? Math.max(0, len - over) : Math.min(len, over);
        }
      }
      this.locate(p);
      if (this.region && !this.near(p)) this.relocate(p);
    }
  }

  private locate(p: Walker): void {
    const a = this.start[p.walk];
    const last = this.start[p.walk + 1] - 1;
    let i = Math.max(a, Math.min(a + p.seg, last - 1));
    while (i > a && this.cum[i] > p.s) i--;
    while (i < last - 1 && this.cum[i + 1] < p.s) i++;
    p.seg = i - a;
    const x0 = this.xy[2 * i], y0 = this.xy[2 * i + 1];
    const dx = this.xy[2 * i + 2] - x0, dy = this.xy[2 * i + 3] - y0;
    const l = Math.hypot(dx, dy) || 1;
    const t = Math.min(1, Math.max(0, (p.s - this.cum[i]) / l));
    const ux = dx / l, uy = dy / l;
    p.x = x0 + dx * t - uy * p.lat;
    p.y = y0 + dy * t + ux * p.lat;
    p.hx = ux * p.dir;
    p.hy = uy * p.dir;
  }

  activeCount(): number {
    let n = 0;
    for (const p of this.walkers) n += p.active ? 1 : 0;
    return n;
  }

  snapshot(): number[] {
    return this.walkers.flatMap((p) => [p.walk, Math.round(p.s * 1000), p.dir]);
  }
}
