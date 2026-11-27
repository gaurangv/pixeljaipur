/**
 * Detail zoom: zooming changes how much WORLD detail one texel holds (mpp), while each
 * texel stays the same size on screen. Like map tiles: closer = finer, never blockier.
 * The render target stays ~ screen / cssPerTexel, so GPU cost doesn't change with zoom.
 */

/** Metres per texel for each zoom level. Level 3 is the default look. */
export const LEVELS = [1.0, 0.66, 0.5, 0.33, 0.25, 0.165, 0.11] as const;
export const DEFAULT_LEVEL = 3;
export const MAX_LEVEL = LEVELS.length - 1;

export const clampLevel = (l: number) => Math.min(MAX_LEVEL, Math.max(0, Math.round(l)));

export const mppForLevel = (level: number) => LEVELS[clampLevel(level)];

/** CSS px per texel: 3 on desktop, 1.5 on phones (more city fits), 2 in "crisp" mode. */
export function cssPerTexel(viewportWidth: number, crisp = false): number {
  if (viewportWidth < 700) return crisp ? 1 : 1.5;
  return crisp ? 2 : 3;
}

/** Integer upscale (device px per texel) for a CSS size and device pixel ratio. */
export const upscaleFor = (cssPx: number, dpr: number) => Math.max(1, Math.round(cssPx * dpr));

/**
 * Links made before detail zoom stored an integer upscale (1..16) in the hash. Level numbers
 * overlap 0..6, so only values above MAX_LEVEL are unambiguous old links: clamp those to the
 * closest level.
 */
export const levelFromHashZoom = (z: number) => clampLevel(z);
