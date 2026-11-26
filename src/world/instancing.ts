import { BoxGeometry, BufferGeometry, Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { toon, toonInstanced } from '../render/materials';
import { palette, type PaletteKey } from '../render/palette';

/** Shared unit cube for box-shaped modules (scale it per instance). */
export const unitBox = new BoxGeometry(1, 1, 1);

/** Collects transforms for one module (geometry + palette colour) and builds a single InstancedMesh. */
export class Batch {
  readonly matrices: Matrix4[] = [];
  constructor(
    readonly name: string,
    readonly geometry: BufferGeometry,
    readonly colour: PaletteKey,
    /** Small details (windows, sills, doors) skip the shadow pass: invisible there, and halves their cost. */
    readonly castShadow = true,
  ) {}

  add(m: Matrix4): void {
    this.matrices.push(m);
  }

  build(): InstancedMesh | null {
    if (!this.matrices.length) return null;
    const mesh = new InstancedMesh(this.geometry, toon(this.colour), this.matrices.length);
    this.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = true;
    mesh.name = this.name;
    return mesh;
  }
}

/**
 * Draw-call saver: merge batches that share a geometry and shadow setting into ONE
 * InstancedMesh, with each instance keeping its palette colour (per-instance colour).
 * e.g. awnings in 5 colours + signboards + carts (all unit boxes) -> 1 draw call.
 */
export function buildPooled(batches: Batch[], name = 'pooled'): InstancedMesh[] {
  const groups = new Map<string, Batch[]>();
  for (const b of batches) {
    if (!b.matrices.length) continue;
    const key = `${b.geometry.uuid}:${b.castShadow}`;
    const list = groups.get(key) ?? [];
    list.push(b);
    groups.set(key, list);
  }
  const out: InstancedMesh[] = [];
  const c = new Color();
  for (const list of groups.values()) {
    if (list.length === 1) {
      out.push(list[0].build()!);
      continue;
    }
    const count = list.reduce((n, b) => n + b.matrices.length, 0);
    const mesh = new InstancedMesh(list[0].geometry, toonInstanced(), count);
    let i = 0;
    for (const b of list) {
      c.setHex(palette[b.colour]);
      for (const m of b.matrices) {
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c);
        i++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = list[0].castShadow;
    mesh.receiveShadow = true;
    mesh.name = `${name}:${list.map((b) => b.name).join('+')}`;
    out.push(mesh);
  }
  return out;
}

/** Axis-aligned transform: centre (x, y, z), size (sx, sy, sz). */
export function at(x: number, y: number, z: number, sx: number, sy: number, sz: number): Matrix4 {
  return new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(sx, sy, sz));
}
