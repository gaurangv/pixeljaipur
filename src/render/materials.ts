import { Color, DataTexture, MeshToonMaterial, NearestFilter, RedFormat, UnsignedByteType } from 'three';
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

let vertexToon: MeshToonMaterial | null = null;

/** Toon material whose colour comes from the geometry's `color` attribute (palette colours baked per vertex). */
export function toonVertex(): MeshToonMaterial {
  if (!vertexToon) {
    vertexToon = new MeshToonMaterial({ color: new Color(1, 1, 1), gradientMap, vertexColors: true });
    vertexToon.name = 'toon:vertex';
  }
  return vertexToon;
}

export type DitherPattern = 'soil' | 'speckle' | 'paving';

/**
 * Toon material with a procedural, world-space pixel texture: each world cell of
 * `cell` metres (= one texel at the current pixel scale) picks one of three palette
 * shades by a hash, so the ground gets crisp pixel-art grain with no texture files.
 */
export function toonDither(pattern: DitherPattern, shades: [PaletteKey, PaletteKey, PaletteKey], cell: number): MeshToonMaterial {
  const m = new MeshToonMaterial({ color: new Color(1, 1, 1), gradientMap });
  m.name = `toon:dither:${pattern}`;
  const uniforms = {
    uA: { value: new Color(palette[shades[0]]) },
    uB: { value: new Color(palette[shades[1]]) },
    uC: { value: new Color(palette[shades[2]]) },
    uCell: { value: cell },
  };
  const mode = { soil: 0, speckle: 1, paving: 2 }[pattern];
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPjWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvPjWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vPjWorld;
uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform float uCell;
float pjHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 w = vPjWorld.xz;
  vec2 c = floor(w / uCell);
  float h = pjHash(c);
  vec3 col = uA;
  #if ${mode} == 0
    float blob = pjHash(floor(w / 1.4));
    if (blob < 0.28) col = uB;
    if (h < 0.07) col = uC; else if (h > 0.94) col = uB;
  #elif ${mode} == 1
    if (h < 0.10) col = uB; else if (h > 0.965) col = uC;
  #else
    vec2 f = fract(w / vec2(1.2, 0.9));
    vec2 flag = floor(w / vec2(1.2, 0.9));
    if (pjHash(flag) < 0.3) col = uC;
    if (min(f.x * 1.2, f.y * 0.9) < uCell * 0.9) col = uB;
    if (h < 0.04) col = uB;
  #endif
  diffuseColor.rgb = col;
}`,
      );
  };
  m.customProgramCacheKey = () => `pj-dither-${pattern}`;
  return m;
}
