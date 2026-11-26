import { DataTexture, MeshToonMaterial, NearestFilter, RedFormat, UnsignedByteType } from 'three';
import { palette, type PaletteKey } from './palette';

/**
 * Three hard light bands (shadow, mid, lit) give crisp pixel-art shading.
 * Shared by every lit material so the whole city reads as one style.
 */
const gradientMap = (() => {
  const tex = new DataTexture(new Uint8Array([120, 185, 255]), 3, 1, RedFormat, UnsignedByteType);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
})();

const cache = new Map<PaletteKey, MeshToonMaterial>();

/** One shared toon material per palette colour. */
export function toon(colour: PaletteKey): MeshToonMaterial {
  let m = cache.get(colour);
  if (!m) {
    m = new MeshToonMaterial({ color: palette[colour], gradientMap });
    m.name = `toon:${colour}`;
    cache.set(colour, m);
  }
  return m;
}
