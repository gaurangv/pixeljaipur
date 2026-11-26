import { BoxGeometry, BufferGeometry, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { toon } from '../render/materials';
import type { PaletteKey } from '../render/palette';

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

/** Axis-aligned transform: centre (x, y, z), size (sx, sy, sz). */
export function at(x: number, y: number, z: number, sx: number, sy: number, sz: number): Matrix4 {
  return new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(sx, sy, sz));
}
