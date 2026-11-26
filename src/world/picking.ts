import type { Vector3 } from 'three';
import { pointInRing, type Pt } from './geometry';

/** A clickable place: vertical prism of `zone` polygons from the ground up to `height`. */
export interface PickablePlace {
  id: string;
  height: number;
  priority: number;
  zone: Pt[][];
}

/**
 * First place whose prism the ray enters, walking from the camera into the scene.
 * Cheap and exact enough for UI: no triangle raycast over the ~400k-triangle city.
 */
export function pickPlace(ray: { origin: Vector3; dir: Vector3 }, places: PickablePlace[], step = 0.25): string | null {
  const { origin: o, dir: f } = ray;
  if (f.y >= 0) return null;
  const horiz = Math.hypot(f.x, f.z) || 1e-9;
  const dt = step / horiz; // advance `step` metres horizontally per sample
  let best: { id: string; t: number; priority: number } | null = null;
  for (const p of places) {
    const tTop = (p.height - o.y) / f.y;
    const tGround = (0 - o.y) / f.y;
    for (let t = tTop; t <= tGround; t += dt) {
      const x = o.x + f.x * t;
      const north = -(o.z + f.z * t);
      if (p.zone.some((ring) => pointInRing(x, north, ring))) {
        if (!best || t < best.t - 1e-6 || (Math.abs(t - best.t) < 1e-6 && p.priority > best.priority)) {
          best = { id: p.id, t, priority: p.priority };
        }
        break;
      }
    }
  }
  return best?.id ?? null;
}
