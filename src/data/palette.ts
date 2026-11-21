// Reference palette (Forge "fighter"): saturated cobalt sea, bright layered greens, light-blue haze.
export const SKY = {
  horizon: 0xc6e8fa,
  middle: 0x7abef0,
  zenith: 0x3e8ede,
  bands: 8,
  /** Elevation, rad, at which the sky reaches its zenith colour. */
  span: 0.75,
} as const;

export const HAZE = 0xbce0f6;

export const GROUND_COLORS = {
  deep: 0x2468b4,
  shallow: 0x3f97d2,
  sand: 0xeedca4,
  meadow: 0x86ce4c,
  grass: [0x60b234, 0x4f9e2e],
  hill: 0x7f9a5a,
  rock: 0x928c86,
} as const;

/** Daylight swatches for the pixel terrain, shared with its near-field voxel trees and rocks. */
export const FORGE_GROUND = {
  deepPatch: 0x20589f,
  deep: GROUND_COLORS.deep,
  mid: 0x2c7cc6,
  shallow: 0x42a0d8,
  lagoon: 0x68ccd6,
  foam: 0xf0fcff,
  glint: [0x78beec, 0xecfaff],
  sand: GROUND_COLORS.sand,
  sandSpeck: 0xdec88c,
  meadow: GROUND_COLORS.meadow,
  grass: GROUND_COLORS.grass[0],
  grassDark: 0x46942c,
  contour: 0x38782c,
  hill: [0x839c58, 0x6b874a],
  stone: [0xb2aca2, 0x928c86],
  canopy: [0x1c5c2e, 0x2a7a36],
  crown: [0x469e40, 0x388b38],
} as const;

/** Ground shadows: a cool, two-tone shade cast away from a high sun in the north-west. */
export const SHADOW = {
  sunX: 0.26,
  sunZ: -0.17,
  cloudGround: 38,
  shade: [0.62, 0.67, 0.80],
  textureSize: 32,
  color: 0x1b3557,
  enemyOpacity: 0.42,
} as const;

export const FORGE_CLOUDS = {
  rim: 0xd4e0f2,
  top: 0xfeffff,
  sideLow: 0x9eb6de,
  sideHigh: 0xcadaf0,
  underside: 0x8aa0c8,
} as const;
