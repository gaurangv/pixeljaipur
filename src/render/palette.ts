/**
 * The single source of scene colours for PixelJaipur.
 * Every colour in the 3D scene must come from here — no inline hex elsewhere.
 * Values are a first pass; tune them against docs/refs/ and log changes in docs/DECISIONS.md.
 */

export const palette = {
  // Walls and stone
  terracotta: 0xd98a6c, // the "pink" of the Pink City (really a terracotta wash)
  terracottaShade: 0xb5684f,
  terracottaDeep: 0x8f4c3c,
  terracottaLight: 0xe49d7f, // per-building variation
  terracottaDusty: 0xc98a72,
  ochre: 0xcca878,
  sandstone: 0xd9b98c, // paving, kerbs, Hawa Mahal base
  sandstoneShade: 0xb39468,
  limeWhite: 0xf2eadb, // lime-wash borders and motifs on facades
  limeWhiteShade: 0xd6cbb6,

  // Accents
  turquoise: 0x5fa8a0, // faded doors and shutters
  turquoiseShade: 0x417d78,
  marigold: 0xf0a020,
  marigoldShade: 0xc77d12,

  // Bazaar awnings
  awningRed: 0xc0392b,
  awningBlue: 0x2e5e9e,
  awningGreen: 0x4f8a3c,
  awningYellow: 0xe8c547,
  awningCanvas: 0xe6dcc4,

  // Ground
  asphalt: 0x6e6660,
  asphaltLine: 0xcfc6b8,
  asphaltDark: 0x5c5550,
  asphaltLight: 0x7d746c,
  footpath: 0xc7ab84,
  open: 0xb9a578, // squares, chowks, open land
  green: 0x7a8f4a, // gardens
  ground: 0xa89270, // unmapped ground under everything
  groundDark: 0x957f5e,
  groundLight: 0xb8a37f,
  kerb: 0xcbb58e,

  // Trees
  treeDark: 0x4a6533,
  treeMid: 0x67873d,
  treeLight: 0x8ea852,
  trunk: 0x6b4a32,

  // Roof clutter and street props
  tankBlack: 0x2f2b2b, // the ubiquitous black plastic water tank
  dishGrey: 0xbcb6ad,
  autoGreen: 0x4f8a2e, // Jaipur auto-rickshaw body
  autoYellow: 0xf2c230, // auto-rickshaw canopy
  tyre: 0x262222,

  // Diorama base
  plinthSide: 0xb08c62,
  plinthBand: 0x8c6b4a,
  backdropTop: 0xe9dcc6,
  backdropBottom: 0xcdb89a,

  // Lines
  outline: 0x3a2622, // 1 px depth-edge outline (warm dark brown, never pure black)

  // Sky
  skyDay: 0xbfd8e6,
  skyDusk: 0xe8a37a,
  skyNight: 0x1c2240,
} as const;

export type PaletteKey = keyof typeof palette;

/** Multiplicative tint (r, g, b in 0..1) applied to lit colours at a time of day. */
export interface Tint {
  r: number;
  g: number;
  b: number;
}

export const tints = {
  noon: { r: 1.0, g: 1.0, b: 1.0 },
  golden: { r: 1.08, g: 0.92, b: 0.78 }, // the pink glows
  dusk: { r: 0.72, g: 0.66, b: 0.9 }, // blue hour
  night: { r: 0.32, g: 0.36, b: 0.6 },
} as const satisfies Record<string, Tint>;

export type TintKey = keyof typeof tints;

/** Background colour per time of day. */
export const skyFor: Record<TintKey, number> = {
  noon: palette.skyDay,
  golden: palette.skyDusk,
  dusk: palette.skyDusk,
  night: palette.skyNight,
};
