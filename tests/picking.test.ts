import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import places from '../data/build/slice1.places.json';
import { createCamera, screenToRay, updateCamera, worldToScreen, type ScreenView } from '../src/render/camera';
import { pickPlace, type PickablePlace } from '../src/world/picking';

const MARGIN = 1; // must match PixelPass
const view = (over: Partial<ScreenView> = {}): ScreenView => ({
  target: new Vector3(12.34, 0, -56.78),
  rot: 0,
  mpp: 0.5,
  size: { x: 427, y: 267 },
  zoom: 3,
  dpr: 1,
  ...over,
});

describe('worldToScreen / screenToRay', () => {
  it('matches the three.js camera + pixel pass mapping at every rotation', () => {
    for (let rot = 0; rot < 4; rot++) {
      const v = view({ rot });
      const cam = createCamera();
      const rtW = v.size.x + 2 * MARGIN;
      const rtH = v.size.y + 2 * MARGIN;
      const snap = updateCamera(cam, v.target, rot, v.mpp, rtW, rtH);
      cam.updateMatrixWorld();
      for (const p of [new Vector3(20, 0, -60), new Vector3(0, 15, -40), new Vector3(30, 5, -80)]) {
        const ndc = p.clone().project(cam);
        const texX = ((ndc.x + 1) / 2) * rtW;
        const texY = ((ndc.y + 1) / 2) * rtH;
        const css = { x: (texX - MARGIN - snap.remainderPx.x) * v.zoom, y: v.size.y * v.zoom - (texY - MARGIN - snap.remainderPx.y) * v.zoom };
        const mine = worldToScreen(p, v);
        expect(mine.x).toBeCloseTo(css.x, 3);
        expect(mine.y).toBeCloseTo(css.y, 3);
      }
    }
  });

  it('round-trips: a ray cast through a projected point passes through it', () => {
    const v = view({ rot: 2, dpr: 3, zoom: 9 });
    const p = new Vector3(25, 8, -147);
    const s = worldToScreen(p, v);
    const { origin, dir } = screenToRay(s.x, s.y, v);
    const closest = origin.clone().addScaledVector(dir, p.clone().sub(origin).dot(dir));
    expect(closest.distanceTo(p)).toBeLessThan(1e-6);
  });
});

describe('pickPlace on the real slice', () => {
  const ps = places.places as unknown as (PickablePlace & { anchor: [number, number] })[];
  const at = (id: string) => ps.find((p) => p.id === id)!;
  const v = (target: Vector3) => view({ target });

  it('clicking Hawa Mahal at mid-height picks it', () => {
    const hm = at('hawa-mahal');
    const target = new Vector3(hm.anchor[0], 0, -hm.anchor[1]);
    const s = worldToScreen(new Vector3(hm.anchor[0], 10, -hm.anchor[1]), v(target));
    expect(pickPlace(screenToRay(s.x, s.y, v(target)), ps)).toBe('hawa-mahal');
  });

  it('clicking the middle of Badi Chaupar picks it, not a bazaar', () => {
    const bc = at('badi-chaupar');
    const target = new Vector3(bc.anchor[0], 0, -bc.anchor[1]);
    const s = worldToScreen(target, v(target));
    expect(pickPlace(screenToRay(s.x, s.y, v(target)), ps)).toBe('badi-chaupar');
  });

  it('clicking empty ground far from every place picks nothing', () => {
    const target = new Vector3(400, 0, -400);
    const s = worldToScreen(target, v(target));
    expect(pickPlace(screenToRay(s.x, s.y, v(target)), ps)).toBeNull();
  });
});
