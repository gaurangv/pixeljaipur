/**
 * Shareable view state in the URL hash, like isometricmumbai.com: #z/x/y/rot
 *   z    integer zoom (upscale factor)
 *   x,y  camera target in local metres (east, north), 1 decimal
 *   rot  snap rotation 0..3
 */
export interface ViewState {
  zoom: number;
  x: number;
  y: number;
  rot: number;
}

export function formatHash(v: ViewState): string {
  const r1 = (n: number) => (Math.round(n * 10) / 10).toString();
  return `#${Math.round(v.zoom)}/${r1(v.x)}/${r1(v.y)}/${(((Math.round(v.rot) % 4) + 4) % 4).toString()}`;
}

export function parseHash(hash: string): Partial<ViewState> | null {
  const m = /^#?(\d+)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)(?:\/(\d))?$/.exec(hash.trim());
  if (!m) return null;
  const zoom = Number(m[1]);
  if (zoom < 1 || zoom > 16) return null;
  const out: Partial<ViewState> = { zoom, x: Number(m[2]), y: Number(m[3]) };
  if (m[4] !== undefined) out.rot = Number(m[4]) % 4;
  return out;
}

/** Debounced writer, so dragging doesn't spam history (replaceState, no new entries). */
export function hashWriter(delayMs = 250): (v: ViewState) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (v) => {
    clearTimeout(t);
    t = setTimeout(() => history.replaceState(null, '', formatHash(v)), delayMs);
  };
}
