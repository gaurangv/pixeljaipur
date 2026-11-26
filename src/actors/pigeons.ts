import { HAWA, type HawaMahalPlacement } from '../landmarks/hawaMahal';
import { hashString, mulberry32, type Rng } from '../world/rng';

/*
 * Pigeons on the Hawa Mahal: they sit on the exposed roof ledges of each tier and on the top
 * terrace. A click near the palace makes them burst off, circle over the street, and settle back.
 * Pure logic; positions are data coords (x east, y north) plus height z.
 */

export const PIGEON_CLICK_RADIUS = 40; // m from the facade centre

export interface Pigeon {
  /** perch, data coords + height */
  px: number;
  py: number;
  pz: number;
  /** current position */
  x: number;
  y: number;
  z: number;
  /** heading (data coords) */
  hx: number;
  hy: number;
  /** 0 perched, 1 flying */
  mode: 0 | 1;
  /** seconds since take-off (negative while waiting for its turn) */
  t: number;
  /** time spent circling before coming back */
  dur: number;
  radius: number;
  height: number;
  omega: number;
  phase: number;
  /** wing beat phase */
  flap: number;
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const TAKE_OFF = 1.6; // s from ledge to circle
const LAND = 3.0; // s from circle back to ledge

export class Flock {
  readonly birds: Pigeon[] = [];
  readonly rng: Rng;
  /** centre of the circling (over the street in front of the facade) */
  readonly cx: number;
  readonly cy: number;

  constructor(readonly at: HawaMahalPlacement, opts: { seed?: number; count?: number } = {}) {
    this.rng = mulberry32(hashString(`pigeons:${opts.seed ?? 1}`));
    const th = (at.facingDeg * Math.PI) / 180;
    const fx = Math.cos(th), fy = Math.sin(th); // local +z (out of the facade)
    const tx = -fy, ty = fx; // local +x (along the facade)
    this.cx = at.anchor[0] + fx * 14;
    this.cy = at.anchor[1] + fy * 14;
    const toData = (lx: number, lz: number): [number, number] => [at.anchor[0] + tx * lx + fx * lz, at.anchor[1] + ty * lx + fy * lz];

    // Perches: the exposed "shoulders" of each tier's roof, and the top terrace.
    const spots: { x0: number; x1: number; y: number; z0: number; z1: number }[] = [];
    const W = HAWA.tierWidths;
    for (let t = 0; t < W.length; t++) {
      const y = HAWA.plinthH + (t + 1) * HAWA.storeyH;
      const zf = -t * HAWA.stepBack;
      if (t === W.length - 1) spots.push({ x0: -W[t] / 2 + 0.4, x1: W[t] / 2 - 0.4, y, z0: zf - 2.5, z1: zf + 0.3 });
      else {
        const inner = W[t + 1] / 2 + 0.4, outer = W[t] / 2 - 0.3;
        if (outer > inner) {
          spots.push({ x0: inner, x1: outer, y, z0: zf - 1.6, z1: zf + 0.4 });
          spots.push({ x0: -outer, x1: -inner, y, z0: zf - 1.6, z1: zf + 0.4 });
        }
      }
    }
    const n = opts.count ?? 36;
    for (let i = 0; i < n; i++) {
      const sp = spots[i % spots.length];
      const lx = sp.x0 + (sp.x1 - sp.x0) * this.rng();
      const lz = sp.z0 + (sp.z1 - sp.z0) * this.rng();
      const [px, py] = toData(lx, lz);
      const face = this.rng() * Math.PI * 2;
      this.birds.push({
        px, py, pz: sp.y, x: px, y: py, z: sp.y, hx: Math.cos(face), hy: Math.sin(face), mode: 0, t: 0, dur: 0,
        radius: 6 + 9 * this.rng(), height: 15 + 9 * this.rng(), omega: 0.7 + 0.5 * this.rng(), phase: this.rng() * Math.PI * 2,
        flap: this.rng() * 10,
      });
    }
  }

  /** Is a ground click at (x, y) close enough to scare the flock? */
  near(x: number, y: number): boolean {
    return Math.hypot(x - this.at.anchor[0], y - this.at.anchor[1]) <= PIGEON_CLICK_RADIUS;
  }

  get flying(): number {
    let n = 0;
    for (const b of this.birds) n += b.mode;
    return n;
  }

  /** Scare the flock off its ledges. Returns false if they are all in the air already. */
  burst(): boolean {
    let any = false;
    for (const b of this.birds) {
      if (b.mode === 1 && b.t < b.dur) continue; // already circling
      any = true;
      if (b.mode === 0) b.t = -this.rng() * 0.6;
      else b.t = Math.min(b.t, TAKE_OFF);
      b.mode = 1;
      b.dur = 7 + 5 * this.rng();
    }
    return any;
  }

  step(dt: number): void {
    if (dt <= 0) return;
    for (const b of this.birds) {
      if (b.mode === 0) {
        // the odd shuffle on the ledge
        if (this.rng() < dt * 0.05) {
          const a = this.rng() * Math.PI * 2;
          b.hx = Math.cos(a);
          b.hy = Math.sin(a);
        }
        continue;
      }
      b.t += dt;
      b.flap += dt;
      if (b.t < 0) continue;
      const ang = b.phase - b.omega * b.t; // clockwise, like the traffic below
      const ox = this.cx + Math.cos(ang) * b.radius;
      const oy = this.cy + Math.sin(ang) * b.radius;
      const oz = b.height + Math.sin(b.t * 0.9 + b.phase) * 1.5;
      let k = smooth(b.t / TAKE_OFF);
      if (b.t > b.dur) k = 1 - smooth((b.t - b.dur) / LAND);
      const nx = b.px + (ox - b.px) * k;
      const ny = b.py + (oy - b.py) * k;
      const nz = b.pz + (oz - b.pz) * k + Math.sin(Math.PI * k) * 2 * (b.t > b.dur ? 1 : 0);
      const dx = nx - b.x, dy = ny - b.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-3) {
        b.hx = dx / d;
        b.hy = dy / d;
      }
      b.x = nx;
      b.y = ny;
      b.z = nz;
      if (b.t > b.dur + LAND) {
        b.mode = 0;
        b.x = b.px;
        b.y = b.py;
        b.z = b.pz;
      }
    }
  }
}
