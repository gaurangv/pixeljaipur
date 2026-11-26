import { BufferGeometry, Group, Mesh, Path, Shape, ShapeGeometry, Vector2 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon } from '../render/materials';
import type { PaletteKey } from '../render/palette';

/** Feature kinds written by scripts/fetch_osm.py. */
export type FootprintKind = 'open' | 'green' | 'water' | 'road' | 'footway' | 'building';

type Ring = [number, number][];
type Geometry = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };

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
const LAYERS: Record<FootprintKind, { colour: PaletteKey; y: number }> = {
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
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polygons.map(polygonToShape).filter((s): s is Shape => s !== null);
}

/** Build one merged mesh per kind, so the whole slice costs about six draw calls. */
export function buildFootprints(data: FootprintCollection, { skip = [] as FootprintKind[] } = {}): Group {
  const byKind = new Map<FootprintKind, BufferGeometry[]>();
  for (const f of data.features) {
    const kind = f.properties.kind;
    if (!(kind in LAYERS) || skip.includes(kind)) continue;
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
    const mesh = new Mesh(merged, toon(LAYERS[kind].colour));
    mesh.receiveShadow = true;
    mesh.name = kind;
    mesh.rotation.x = -Math.PI / 2; // shape XY plane -> ground XZ plane
    mesh.position.y = LAYERS[kind].y;
    group.add(mesh);
  }
  return group;
}

export async function loadSlice(url: string): Promise<FootprintCollection> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return (await res.json()) as FootprintCollection;
}
