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

  // Light
  shadowWarm: 0x8f6f78, // hemisphere ground colour: warm purple-brown shade instead of grey
  sunWarm: 0xfff0d8,

  // --- Sky (p2-daycycle): add day-cycle colours below this line only ---
  // Key light (sun by day, sky glow at twilight, moon at night)
  keyNoon: 0xfff6e6,
  keyGolden: 0xffc79a, // low sun: the pink glows on terracotta
  keyDusk: 0xf08aa8, // after sunset: rose glow from the western sky
  keyNight: 0x8aa2f0, // moonlight
  // Hemisphere sky / ground fill per preset
  hemiSkyNoon: 0xcfe2ee,
  hemiSkyGolden: 0xf0c0aa,
  hemiSkyDusk: 0x7c80dc,
  hemiSkyNight: 0x3048a0,
  hemiGroundNoon: 0x8f6f78,
  hemiGroundGolden: 0x9a6470,
  hemiGroundDusk: 0x6a3f70,
  hemiGroundNight: 0x1c1f40,
  // Backdrop gradient (top / bottom) per preset
  bgTopNoon: 0xe2eef2,
  bgBottomNoon: 0xcdbfa4,
  bgTopGolden: 0xf2d6be,
  bgBottomGolden: 0xdca592,
  bgTopDusk: 0x5e66b0,
  bgBottomDusk: 0xd08aa0,
  bgTopNight: 0x10163a,
  bgBottomNight: 0x2a2c5e,
  // City lights (unlit, per-instance colour)
  glowWindow: 0xffc767,
  glowWindowWarm: 0xff9f4a,
  glowWindowCool: 0xfff0c8, // the odd tube light
  glowShop: 0xf08a3a, // lit shop interior inside an arch
  glowBulb: 0xfff4c0,
  glowLamp: 0xfff0b8,
  lampOff: 0x8f8a80, // unlit lamp glass
  lampPost: 0x3b3434,
  poolLamp: 0x6a4416, // additive ground pool under a street lamp
  poolShop: 0x4a280c, // additive spill in front of a lit shop
  // --- end Sky (p2-daycycle) ---

  // --- Actors (p2-traffic): add traffic/people/bird colours below this line only ---
  eRickshawBlue: 0x3f7fb0, // battery e-rickshaw bodies
  eRickshawTeal: 0x3a9a86,
  eRickshawRoof: 0xe4ddc8,
  rickshawMaroon: 0x7d2e33, // cycle-rickshaw seat
  rickshawHood: 0x2f3a52,
  busOrange: 0xd9742c, // city bus
  busCream: 0xece0c4,
  busWindow: 0x3b4352,
  camel: 0xc39a64,
  camelShade: 0x9c7648,
  cartWood: 0x8a5a36,
  sacks: 0xd8c8a0,
  cowBrown: 0xa77c5c,
  clothSaffron: 0xe8862a,
  clothRani: 0xd0417e, // "rani pink"
  clothIndigo: 0x34407a,
  clothWhite: 0xeee6d8,
  clothCream: 0xd9c9a3,
  clothMaroon: 0x7d2b35,
  clothGreen: 0x4c8a52,
  clothTurquoise: 0x3a9e9a,
  clothMustard: 0xd8a93a,
  clothRed: 0xc23b30,
  clothKhaki: 0x9c8a62,
  clothGrey: 0x7f7c78,
  skin: 0xb07a58,
  skinDark: 0x8a5a3e,
  hair: 0x2a2220,
  pigeon: 0x8d93a0,
  pigeonDark: 0x5d6270,
  headlight: 0xfff1c2, // warm headlamp (unlit material: always this bright)
  tailLight: 0xe0372c,
  headBeam: 0x5c4a24, // ADDED to the road (additive), so keep it dim: a warm brightening, not a solid colour

  // --- end Actors (p2-traffic) ---

  // --- Audio UI (p2-sound): add sound-UI colours below this line only ---
  audioIdle: 0xe6dcc4, // sound / listen button face when off (awning canvas)
  audioOn: 0x8fc49a, // button face while sound plays: a soft "live" green

  // --- end Audio UI (p2-sound) ---

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
