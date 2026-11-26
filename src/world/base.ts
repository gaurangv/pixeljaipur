import { ExtrudeGeometry, Group, Mesh, Shape, Vector2, type Material } from 'three';
import { toon } from '../render/materials';
import type { Pt } from './geometry';
import { Batch, buildPooled, unitBox } from './instancing';
import { onFace } from './shopHouse';

/*
 * The diorama base: the slice cut out along its boundary and sitting on a sandstone
 * plinth, like a model city on a table. Top face = the ground; sides = plinth.
 */

export const BASE_DEPTH = 6;

/** Signed area > 0 means counter-clockwise (data coords). */
export function ringSignedArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
}

export function bounds(ring: Pt[]): { x0: number; y0: number; x1: number; y1: number } {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

export function buildBase(boundary: Pt[], groundMaterial: Material): Group {
  const ring = ringSignedArea(boundary) < 0 ? [...boundary].reverse() : boundary;
  const shape = new Shape(ring.map(([x, y]) => new Vector2(x, y)));
  const geo = new ExtrudeGeometry(shape, { depth: BASE_DEPTH, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); // extrude +z -> up
  geo.translate(0, -BASE_DEPTH, 0); // top face at y = 0
  // ExtrudeGeometry groups: 0 = caps (top/bottom), 1 = sides.
  const mesh = new Mesh(geo, [groundMaterial, toon('plinthSide')]);
  mesh.name = 'base';
  mesh.receiveShadow = true;
  mesh.castShadow = false;

  // Lime-white coping along the top edge and a darker band lower down, slightly proud of the sides.
  const coping = new Batch('base:coping', unitBox, 'limeWhite', false);
  const band = new Batch('base:band', unitBox, 'plinthBand', false);
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    coping.add(onFace(a, b, len / 2, -0.35, len + 0.6, 0.35, 0.3));
    band.add(onFace(a, b, len / 2, -BASE_DEPTH + 0.8, len + 0.2, 0.9, 0.12));
  }

  const group = new Group();
  group.name = 'diorama';
  group.add(mesh);
  for (const m of buildPooled([coping, band], 'base')) group.add(m);
  return group;
}
