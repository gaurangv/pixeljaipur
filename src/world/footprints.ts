import { BufferGeometry, Group, Material, Matrix4, Mesh, Path, Quaternion, Shape, ShapeGeometry, Vector2, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, toonDither } from '../render/materials';
import { Batch, unitBox } from './instancing';
import type { PaletteKey } from '../render/palette';

/** Feature kinds written by scripts/fetch_osm.py. */
export type FootprintKind = 'open' | 'green' | 'water' | 'road' | 'footway' | 'building' | 'kerb';
type AreaKind = Exclude<FootprintKind, 'kerb'>;

type Ring = [number, number][];
type Geometry =
  | { type: 'Polygon'; coordinates: Ring[] }
  | { type: 'MultiPolygon'; coordinates: Ring[][] }
  | { type: 'MultiLineString'; coordinates: Ring[] }
  | { type: 'LineString'; coordinates: Ring };

export interface FootprintFeature {
  type: 'Feature';
  geometry: Geometry;
  properties: {
    kind: FootprintKind;
    id: string;
    source?: string;
    name?: string;
    levels?: number;
    /** Exterior-ring edge indices that face a street (ring is CCW). */
    front?: number[];
    bazaar?: boolean;
  };
}

export interface FootprintCollection {
  type: 'FeatureCollection';
  features: FootprintFeature[];
}

/** Draw order and colour per kind. Lower layers sit slightly lower so nothing z-fights. */
const LAYERS: Record<AreaKind, { colour: PaletteKey; y: number }> = {
  open: { colour: 'open', y: 0.02 },
  green: { colour: 'green', y: 0.03 },
  water: { colour: 'turquoiseShade', y: 0.04 },
  footway: { colour: 'footpath', y: 0.05 },
  road: { colour: 'asphalt', y: 0.06 },
  building: { colour: 'terracotta', y: 0.08 },
};

/** Local metres (x east, y north) to a 2D shape point. After rotating -90° about X, shape y becomes -z (north). */
const toVec = ([x, y]: [number, number]) => new Vector2(x, y);

function polygonToShape(rings: Ring[]): Shape | null {
  const [outer, ...holes] = rings;
  if (!outer || outer.length < 4) return null;
  const shape = new Shape(outer.map(toVec));
  for (const hole of holes) {
    if (hole.length >= 4) shape.holes.push(new Path(hole.map(toVec)));
  }
  return shape;
}

export function featureShapes(feature: FootprintFeature): Shape[] {
  const g = feature.geometry;
  if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') return [];
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polygons.map(polygonToShape).filter((s): s is Shape => s !== null);
}

/** Build one merged mesh per kind, so the whole slice costs about six draw calls. */
/** Ground materials: procedural pixel grain per kind (one texel = `mpp` metres). */
function groundMaterial(kind: AreaKind, mpp: number): Material {
  switch (kind) {
    case 'road':
      return toonDither('speckle', ['asphalt', 'asphaltDark', 'asphaltLight'], mpp);
    case 'footway':
      return toonDither('paving', ['footpath', 'sandstoneShade', 'sandstone'], mpp);
    case 'open':
      return toonDither('paving', ['open', 'sandstoneShade', 'footpath'], mpp);
    default:
      return toon(LAYERS[kind].colour);
  }
}

/** Raised 15 cm kerbs along the outline of the road network. */
function buildKerbs(data: FootprintCollection): Mesh | null {
  const batch = new Batch('kerbs', unitBox, 'kerb', false);
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  for (const f of data.features) {
    if (f.properties.kind !== 'kerb') continue;
    const g = f.geometry;
    const lines = g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const [x0, y0] = line[i];
        const [x1, y1] = line[i + 1];
        const len = Math.hypot(x1 - x0, y1 - y0);
        if (len < 0.05) continue;
        q.setFromAxisAngle(up, Math.atan2(y1 - y0, x1 - x0));
        batch.add(new Matrix4().compose(new Vector3((x0 + x1) / 2, 0.08, -(y0 + y1) / 2), q.clone(), new Vector3(len + 0.2, 0.16, 0.25)));
      }
    }
  }
  return batch.build();
}

export function buildFootprints(data: FootprintCollection, { skip = [] as FootprintKind[], mpp = 0.33 } = {}): Group {
  const byKind = new Map<AreaKind, BufferGeometry[]>();
  for (const f of data.features) {
    const kind = f.properties.kind;
    if (kind === 'kerb' || !(kind in LAYERS) || skip.includes(kind)) continue;
    const list = byKind.get(kind) ?? [];
    for (const shape of featureShapes(f)) list.push(new ShapeGeometry(shape));
    byKind.set(kind, list);
  }

  const group = new Group();
  group.name = 'footprints';
  for (const [kind, geoms] of byKind) {
    if (geoms.length === 0) continue;
    const merged = mergeGeometries(geoms);
    geoms.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new Mesh(merged, groundMaterial(kind, mpp));
    mesh.receiveShadow = true;
    mesh.name = kind;
    mesh.rotation.x = -Math.PI / 2; // shape XY plane -> ground XZ plane
    mesh.position.y = LAYERS[kind].y;
    group.add(mesh);
  }
  if (!skip.includes('kerb')) {
    const kerbs = buildKerbs(data);
    if (kerbs) group.add(kerbs);
  }
  return group;
}

export async function loadSlice(url: string): Promise<FootprintCollection> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return (await res.json()) as FootprintCollection;
}
