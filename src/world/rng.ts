/** Deterministic randomness. Never use Math.random in world generation. */

export type Rng = () => number;

/** mulberry32: small, fast, good enough for procedural decoration. Returns [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit hash of a string, for seeding from ids like "way/123". */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Rng seeded by a world seed and an id, so each building is stable across loads. */
export function rngFor(id: string, worldSeed = 1): Rng {
  return mulberry32(hashString(`${worldSeed}:${id}`));
}

export const range = (r: Rng, min: number, max: number) => min + (max - min) * r();
export const int = (r: Rng, min: number, maxInclusive: number) => Math.floor(range(r, min, maxInclusive + 1));
export const chance = (r: Rng, p: number) => r() < p;
export const pick = <T>(r: Rng, items: readonly T[]): T => items[Math.floor(r() * items.length)];
