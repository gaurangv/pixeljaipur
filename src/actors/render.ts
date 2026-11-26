import { Color, InstancedMesh } from 'three';
import { toonInstanced } from '../render/materials';
import { palette, type PaletteKey } from '../render/palette';
import { unitBox } from '../world/instancing';
import type { Crowd } from './crowd';
import type { Flock } from './pigeons';
import type { TrafficSim, VehicleKind } from './sim';

/*
 * Rendering for the actors: three InstancedMeshes of unit boxes (vehicles + cows, people,
 * pigeons), per-instance palette colours set once, matrices written straight into the
 * instance buffer every frame (no allocation). 3 draw calls in all.
 */

/** One box of a model: along (forward +), lat (left +), bottom height, then size: length, height, width. */
type Part = [along: number, lat: number, y0: number, len: number, h: number, w: number, colour: PaletteKey | 'paint' | 'cloth'];

const PAINT: Record<VehicleKind, PaletteKey[]> = {
  auto: ['autoGreen'],
  eRickshaw: ['eRickshawBlue', 'eRickshawTeal', 'autoGreen'],
  cycleRickshaw: ['rickshawMaroon'],
  scooter: ['awningRed', 'awningBlue', 'limeWhite', 'tankBlack', 'clothGrey'],
  bus: ['busOrange'],
  camelCart: ['cartWood'],
  cow: ['limeWhite', 'limeWhite', 'cowBrown'],
};

const CLOTH: PaletteKey[] = [
  'clothSaffron', 'clothRani', 'clothIndigo', 'clothWhite', 'clothCream', 'clothMaroon',
  'clothGreen', 'clothTurquoise', 'clothMustard', 'clothRed', 'clothKhaki', 'clothGrey',
];

export const MODELS: Record<VehicleKind, Part[]> = {
  // the green-and-yellow Jaipur auto (same proportions as the parked ones in world/dressing.ts)
  auto: [
    [0, 0, 0.35, 2.6, 0.95, 1.3, 'paint'],
    [0, 0, 1.55, 2.3, 0.14, 1.4, 'autoYellow'],
    [-0.2, 0, 1.3, 1.6, 0.25, 1.35, 'autoYellow'],
    [0.9, 0, 0, 0.5, 0.45, 1.35, 'tyre'],
    [-0.9, 0, 0, 0.5, 0.45, 1.35, 'tyre'],
  ],
  eRickshaw: [
    [0, 0, 0.3, 2.8, 0.6, 1.2, 'paint'],
    [-0.3, 0, 0.9, 1.0, 0.55, 1.0, 'cloth'], // passengers
    [0.8, 0, 0.9, 0.35, 0.65, 0.45, 'cloth'], // driver
    [0, 0, 1.7, 2.7, 0.12, 1.3, 'eRickshawRoof'],
    [1.25, 0, 0.9, 0.12, 0.8, 1.1, 'tankBlack'], // windscreen frame
    [0.9, 0, 0, 0.5, 0.42, 1.25, 'tyre'],
    [-0.9, 0, 0, 0.5, 0.42, 1.25, 'tyre'],
  ],
  cycleRickshaw: [
    [0.85, 0, 0, 0.65, 0.6, 0.15, 'tyre'],
    [0.6, 0, 0.6, 0.35, 0.85, 0.4, 'cloth'], // the rickshaw-wallah
    [-0.4, 0, 0.45, 0.9, 0.5, 1.1, 'paint'],
    [-0.55, 0, 0.95, 0.75, 0.75, 1.1, 'rickshawHood'],
    [-0.4, 0, 0, 0.6, 0.55, 1.15, 'tyre'],
  ],
  scooter: [
    [0, 0, 0.22, 1.6, 0.5, 0.45, 'paint'],
    [-0.1, 0, 0.72, 0.45, 0.7, 0.42, 'cloth'], // rider
    [-0.1, 0, 1.42, 0.26, 0.26, 0.26, 'hair'],
    [0.75, 0, 0, 0.4, 0.35, 0.18, 'tyre'],
    [-0.65, 0, 0, 0.4, 0.35, 0.18, 'tyre'],
  ],
  bus: [
    [0, 0, 0.4, 10, 1.3, 2.5, 'paint'],
    [0, 0, 1.7, 9.7, 0.75, 2.52, 'busWindow'],
    [0, 0, 2.45, 10, 0.45, 2.5, 'busCream'],
    [3.3, 0, 0, 1.0, 0.6, 2.4, 'tyre'],
    [-3.3, 0, 0, 1.0, 0.6, 2.4, 'tyre'],
  ],
  camelCart: [
    [1.9, 0, 1.1, 1.7, 0.8, 0.65, 'camel'], // body
    [1.75, 0, 1.9, 0.6, 0.4, 0.5, 'camel'], // hump
    [2.85, 0, 1.6, 0.35, 1.0, 0.32, 'camel'], // neck
    [3.15, 0, 2.4, 0.65, 0.32, 0.32, 'camel'], // head
    [1.9, 0, 0, 1.3, 1.1, 0.5, 'camelShade'], // legs
    [-1.0, 0, 0.7, 3.2, 0.25, 1.6, 'paint'], // the flat cart
    [-1.1, 0, 0.95, 2.4, 0.6, 1.4, 'sacks'],
    [-0.9, 0, 0, 0.9, 0.9, 1.75, 'tyre'],
  ],
  cow: [
    [0, 0, 0.62, 1.7, 0.75, 0.6, 'paint'],
    [1.0, 0, 0.8, 0.5, 0.45, 0.4, 'paint'],
    [0.25, 0, 1.32, 0.5, 0.25, 0.5, 'limeWhiteShade'],
    [0.6, 0, 0, 0.15, 0.64, 0.5, 'limeWhiteShade'],
    [-0.6, 0, 0, 0.15, 0.64, 0.5, 'limeWhiteShade'],
  ],
};
const MAX_PARTS = Math.max(...Object.values(MODELS).map((m) => m.length));

/** Outfits: [legs, torso, head-top] — saris, kurta-pyjama, shirts and trousers, turbans. */
export const OUTFITS: [PaletteKey, PaletteKey, PaletteKey][] = (() => {
  const out: [PaletteKey, PaletteKey, PaletteKey][] = [];
  const bright: PaletteKey[] = ['clothSaffron', 'clothRani', 'clothTurquoise', 'clothMustard', 'clothRed', 'clothGreen', 'clothMaroon', 'clothIndigo'];
  for (const c of bright) out.push([c, c, c]); // sari / salwar with the odhni over the head: one colour head to toe
  for (const c of ['clothWhite', 'clothCream'] as PaletteKey[]) out.push([c, c, 'hair']); // kurta-pyjama
  for (const c of CLOTH) out.push(['clothIndigo', c, 'hair'], ['clothKhaki', c, 'hair'], ['clothGrey', c, 'hair']);
  for (const t of ['clothSaffron', 'clothRed', 'clothRani', 'clothMustard'] as PaletteKey[]) out.push(['clothWhite', 'clothWhite', t]); // safa turbans
  return out;
})();

/** Writes yaw-rotated, scaled boxes straight into an InstancedMesh's matrix buffer. */
class Boxes {
  readonly mesh: InstancedMesh;
  private readonly m: Float32Array;
  private readonly c = new Color();

  constructor(name: string, readonly capacity: number) {
    this.mesh = new InstancedMesh(unitBox, toonInstanced(), capacity);
    this.mesh.name = name;
    this.mesh.castShadow = false; // the shadow map is static; moving things would smear it
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.m = this.mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < capacity; i++) {
      this.hide(i);
      this.colour(i, 'tyre');
    }
  }

  colour(i: number, key: PaletteKey): void {
    this.mesh.setColorAt(i, this.c.setHex(palette[key]));
  }

  hide(i: number): void {
    this.m.fill(0, i * 16, i * 16 + 16);
  }

  /** Box centred at data (x, y), bottom at height y0, heading (hx, hy) unit, size len x h x w. */
  set(i: number, x: number, y: number, y0: number, hx: number, hy: number, len: number, h: number, w: number): void {
    const m = this.m;
    const o = i * 16;
    m[o] = hx * len;
    m[o + 1] = 0;
    m[o + 2] = -hy * len;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = h;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = hy * w;
    m[o + 9] = 0;
    m[o + 10] = hx * w;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = y0 + h / 2;
    m[o + 14] = -y;
    m[o + 15] = 1;
  }

  commit(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  commitColours(): void {
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

const PERSON_PARTS = 3;

export class ActorMeshes {
  readonly vehicles: Boxes;
  readonly people: Boxes;
  readonly birds: Boxes;

  constructor(readonly sim: TrafficSim, readonly crowd: Crowd, readonly flock: Flock | null) {
    this.vehicles = new Boxes('actors:vehicles', sim.vehicles.length * MAX_PARTS);
    this.people = new Boxes('actors:people', crowd.walkers.length * PERSON_PARTS);
    this.birds = new Boxes('actors:pigeons', Math.max(1, (flock?.birds.length ?? 0) * 2));
    // Colours are fixed per slot: vehicles keep their kind and paint for life.
    const r = sim.rng;
    for (const v of sim.vehicles) {
      const paint = PAINT[v.kind][Math.floor(r() * PAINT[v.kind].length)];
      const cloth = CLOTH[Math.floor(r() * CLOTH.length)];
      MODELS[v.kind].forEach((p, k) => {
        const c = p[6] === 'paint' ? paint : p[6] === 'cloth' ? cloth : p[6];
        this.vehicles.colour(v.id * MAX_PARTS + k, c);
      });
    }
    for (const p of crowd.walkers) {
      const o = OUTFITS[p.look % OUTFITS.length];
      this.people.colour(p.id * PERSON_PARTS, o[0]);
      this.people.colour(p.id * PERSON_PARTS + 1, o[1]);
      this.people.colour(p.id * PERSON_PARTS + 2, o[2]);
    }
    for (let i = 0; i < (flock?.birds.length ?? 0); i++) {
      this.birds.colour(2 * i, 'pigeon');
      this.birds.colour(2 * i + 1, 'pigeonDark');
    }
    this.vehicles.commitColours();
    this.people.commitColours();
    this.birds.commitColours();
  }

  get meshes(): InstancedMesh[] {
    return [this.vehicles.mesh, this.people.mesh, this.birds.mesh];
  }

  update(): void {
    const V = this.vehicles;
    for (const v of this.sim.vehicles) {
      const base = v.id * MAX_PARTS;
      const model = MODELS[v.kind];
      if (!v.active) {
        for (let k = 0; k < model.length; k++) V.hide(base + k);
        continue;
      }
      const { hx, hy } = v;
      for (let k = 0; k < model.length; k++) {
        const p = model[k];
        V.set(base + k, v.x + hx * p[0] - hy * p[1], v.y + hy * p[0] + hx * p[1], p[2], hx, hy, p[3], p[4], p[5]);
      }
    }
    V.commit();

    const P = this.people;
    for (const p of this.crowd.walkers) {
      const b = p.id * PERSON_PARTS;
      if (!p.active) {
        P.hide(b);
        P.hide(b + 1);
        P.hide(b + 2);
        continue;
      }
      P.set(b, p.x, p.y, 0, p.hx, p.hy, 0.28, 0.85, 0.4); // legs / lower garment
      P.set(b + 1, p.x, p.y, 0.85, p.hx, p.hy, 0.3, 0.6, 0.46); // torso
      P.set(b + 2, p.x, p.y, 1.45, p.hx, p.hy, 0.26, 0.28, 0.26); // head (hair or turban)
    }
    P.commit();

    if (this.flock) {
      const B = this.birds;
      this.flock.birds.forEach((b, i) => {
        B.set(2 * i, b.x, b.y, b.z, b.hx, b.hy, 0.5, 0.3, 0.3);
        if (b.mode === 1 && b.t >= 0) {
          const up = Math.sin(b.flap * 22) > 0;
          B.set(2 * i + 1, b.x, b.y, b.z + (up ? 0.2 : 0.05), b.hx, b.hy, 0.22, 0.06, up ? 0.5 : 0.85);
        } else {
          B.set(2 * i + 1, b.x - b.hx * 0.06, b.y - b.hy * 0.06, b.z + 0.18, b.hx, b.hy, 0.3, 0.07, 0.26); // folded wings
        }
      });
      B.commit();
    }
  }
}
