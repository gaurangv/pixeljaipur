import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { cameraBasis, normalizeRot, projectToScreen, snapToTexel } from '../src/render/camera';

describe('2:1 dimetric camera', () => {
  it('projects ground axes with a 2:1 slope at every rotation', () => {
    for (let rot = 0; rot < 4; rot++) {
      for (const axis of [new Vector3(1, 0, 0), new Vector3(0, 0, 1)]) {
        const s = projectToScreen(axis, rot);
        expect(Math.abs(s.x) / Math.abs(s.y)).toBeCloseTo(2, 6);
      }
    }
  });

  it('puts north towards the upper right at rot 0', () => {
    const north = projectToScreen(new Vector3(0, 0, -1), 0);
    expect(north.x).toBeGreaterThan(0);
    expect(north.y).toBeGreaterThan(0);
  });

  it('keeps an orthonormal basis', () => {
    const { forward, right, up } = cameraBasis(1);
    expect(forward.dot(right)).toBeCloseTo(0, 9);
    expect(forward.dot(up)).toBeCloseTo(0, 9);
    expect(right.dot(up)).toBeCloseTo(0, 9);
    expect(right.y).toBeCloseTo(0, 9);
  });

  it('wraps rotations into 0..3', () => {
    expect([-1, 0, 4, 5, 7].map(normalizeRot)).toEqual([3, 0, 0, 1, 3]);
  });
});

describe('snapToTexel', () => {
  it('lands the target on whole texels and reports the sub-texel remainder', () => {
    const mpp = 0.5;
    for (const t of [new Vector3(12.34, 0, -56.78), new Vector3(-0.26, 0, 3.1)]) {
      for (let rot = 0; rot < 4; rot++) {
        const { snapped, remainderPx } = snapToTexel(t, rot, mpp);
        const s = projectToScreen(snapped, rot);
        expect(Math.abs(s.x / mpp - Math.round(s.x / mpp))).toBeLessThan(1e-9);
        expect(Math.abs(s.y / mpp - Math.round(s.y / mpp))).toBeLessThan(1e-9);
        expect(Math.abs(remainderPx.x)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(remainderPx.y)).toBeLessThanOrEqual(0.5);
        const orig = projectToScreen(t, rot);
        expect(s.x / mpp + remainderPx.x).toBeCloseTo(orig.x / mpp, 9);
        expect(s.y / mpp + remainderPx.y).toBeCloseTo(orig.y / mpp, 9);
      }
    }
  });
});
