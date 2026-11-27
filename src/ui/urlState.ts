/**
 * Shareable view state in the URL hash, like isometricmumbai.com: #z/x/y/rot
 *   z    integer zoom (upscale factor)
 *   x,y  camera target in local metres (east, north), 1 decimal
 *   rot  snap rotation 0..3
 *   place optional open info card id, e.g. #3/37/144/0/hawa-mahal
 */
export interface ViewState {
  zoom: number;
  x: number;
  y: number;
  rot: number;
  place?: string;
}

export function formatHash(v: ViewState): string {
  const r1 = (n: number) => (Math.round(n * 10) / 10).toString();
  const base = `#${Math.round(v.zoom)}/${r1(v.x)}/${r1(v.y)}/${(((Math.round(v.rot) % 4) + 4) % 4).toString()}`;
  return v.place ? `${base}/${v.place}` : base;
}

export function parseHash(hash: string): Partial<ViewState> | null {
  const m = /^#?(\d+)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)(?:\/(\d)(?:\/([a-z0-9-]{1,64}))?)?$/.exec(hash.trim());
  if (!m) return null;
  const zoom = Number(m[1]);
  if (zoom < 0 || zoom > 16) return null;
  const out: Partial<ViewState> = { zoom, x: Number(m[2]), y: Number(m[3]) };
  if (m[4] !== undefined) out.rot = Number(m[4]) % 4;
  if (m[5] !== undefined) out.place = m[5];
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
