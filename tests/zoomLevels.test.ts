import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { screenToRay, worldToScreen, type ScreenView } from '../src/render/camera';
import { clampLevel, cssPerTexel, DEFAULT_LEVEL, LEVELS, levelFromHashZoom, mppForLevel, upscaleFor } from '../src/render/zoomLevels';

describe('detail zoom ladder', () => {
  it('gets finer as the level goes up, with 0.33 m as the default', () => {
    for (let i = 1; i < LEVELS.length; i++) expect(LEVELS[i]).toBeLessThan(LEVELS[i - 1]);
    expect(mppForLevel(DEFAULT_LEVEL)).toBe(0.33);
  });

  it('keeps the on-screen texel size constant per device', () => {
    expect(upscaleFor(cssPerTexel(1280), 1)).toBe(3);
    expect(upscaleFor(cssPerTexel(1280, true), 1)).toBe(2);
    expect(upscaleFor(cssPerTexel(390), 3)).toBe(5); // 1.5 css px x dpr 3 -> 4.5 -> 5
    expect(upscaleFor(0.1, 1)).toBe(1);
  });

  it('clamps levels and old upscale-style links', () => {
    expect(clampLevel(-3)).toBe(0);
    expect(clampLevel(99)).toBe(LEVELS.length - 1);
    expect(levelFromHashZoom(9)).toBe(LEVELS.length - 1); // pre-detail-zoom link with upscale 9
    expect(levelFromHashZoom(3)).toBe(3);
  });

  it('cursor-anchored zoom: re-centring keeps the ground point under the cursor', () => {
    const groundAt = (x: number, y: number, v: ScreenView) => {
      const r = screenToRay(x, y, v);
      return r.origin.clone().addScaledVector(r.dir, -r.origin.y / r.dir.y);
    };
    const v: ScreenView = { target: new Vector3(20, 0, -100), rot: 1, mpp: mppForLevel(3), size: { x: 427, y: 267 }, zoom: 3, dpr: 1 };
    const cursor = { x: 900, y: 200 };
    const before = groundAt(cursor.x, cursor.y, v);
    const v2: ScreenView = { ...v, target: v.target.clone(), mpp: mppForLevel(5) };
    const after = groundAt(cursor.x, cursor.y, v2);
    v2.target.add(before.clone().sub(after));
    v2.target.y = 0;
    const s = worldToScreen(before, v2);
    expect(Math.hypot(s.x - cursor.x, s.y - cursor.y)).toBeLessThan(1);
  });
});
