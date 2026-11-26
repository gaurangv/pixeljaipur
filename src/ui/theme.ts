import { palette } from '../render/palette';

/** Expose every palette colour as a CSS variable (--pj-terracotta-deep etc.), so UI CSS never uses raw hex. */
export function applyTheme(root: HTMLElement = document.documentElement): void {
  for (const [key, value] of Object.entries(palette)) {
    const name = key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    root.style.setProperty(`--pj-${name}`, '#' + value.toString(16).padStart(6, '0'));
  }
}
