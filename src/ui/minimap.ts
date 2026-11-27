import { palette } from '../render/palette';

/**
 * Minimap (Phase 3): the whole walled city from a tiny run-length-encoded raster written by
 * scripts/build_slice.py (12 m cells: outside / open ground / road / building), north up.
 * Shows the current view as a quadrilateral; click or tap to fly there.
 */

export interface MinimapData {
  x0: number;
  y1: number;
  cell: number;
  w: number;
  h: number;
  rle: string;
}

/** Decode "<count><char>..." into one char per cell. */
export function decodeRle(rle: string, n: number): string {
  let out = '';
  const re = /(\d+)([A-Z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rle))) out += m[2].repeat(Number(m[1]));
  if (out.length !== n) throw new Error(`minimap: decoded ${out.length} cells, expected ${n}`);
  return out;
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export class Minimap {
  readonly el: HTMLElement;
  private readonly base: HTMLCanvasElement;
  private readonly over: HTMLCanvasElement;
  private readonly scale: number;

  constructor(
    parent: HTMLElement,
    private readonly d: MinimapData,
    private readonly onJump: (x: number, y: number) => void,
    size = 180,
  ) {
    this.scale = size / Math.max(d.w, d.h);
    this.el = document.createElement('div');
    this.el.className = 'pj-minimap';
    this.el.setAttribute('role', 'button');
    this.el.setAttribute('aria-label', 'Minimap: click to jump there');
    this.el.tabIndex = 0;
    const w = Math.round(d.w * this.scale);
    const h = Math.round(d.h * this.scale);
    this.base = document.createElement('canvas');
    this.over = document.createElement('canvas');
    for (const c of [this.base, this.over]) {
      c.width = d.w; // one canvas pixel per cell; CSS scales it up crisply
      c.height = d.h;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    this.over.width = w * 2;
    this.over.height = h * 2;
    this.el.append(this.base, this.over);
    parent.appendChild(this.el);
    this.paint();
    this.el.addEventListener('click', (e) => {
      const r = this.base.getBoundingClientRect();
      const cx = ((e.clientX - r.left) / r.width) * d.w;
      const cy = ((e.clientY - r.top) / r.height) * d.h;
      this.onJump(d.x0 + cx * d.cell, d.y1 - cy * d.cell);
    });
  }

  private paint(): void {
    const { w, h } = this.d;
    const cells = decodeRle(this.d.rle, w * h);
    const ctx = this.base.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    const col: Record<string, number[]> = {};
    const rgb = (n: number) => [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
    col.O = [0, 0, 0, 0];
    col.R = rgb(palette.sandstone);
    col.B = rgb(palette.asphalt);
    col.X = rgb(palette.terracotta);
    for (let i = 0; i < cells.length; i++) img.data.set(col[cells[i]] ?? col.O, i * 4);
    ctx.putImageData(img, 0, 0);
  }

  /** Draw the view footprint (4 ground points, data coords) and optional place dots. */
  update(corners: [number, number][], dots: [number, number][] = []): void {
    const c = this.over.getContext('2d')!;
    const k = this.over.width / this.d.w;
    const px = ([x, y]: [number, number]): [number, number] => [((x - this.d.x0) / this.d.cell) * k, ((this.d.y1 - y) / this.d.cell) * k];
    c.clearRect(0, 0, this.over.width, this.over.height);
    c.fillStyle = hex(palette.limeWhite);
    for (const d of dots) {
      const [x, y] = px(d);
      c.fillRect(x - 2, y - 2, 4, 4);
    }
    c.strokeStyle = hex(palette.outline);
    c.lineWidth = 3;
    c.beginPath();
    corners.forEach((p, i) => (i ? c.lineTo(...px(p)) : c.moveTo(...px(p))));
    c.closePath();
    c.stroke();
    c.strokeStyle = hex(palette.marigold);
    c.lineWidth = 1.5;
    c.stroke();
  }
}
