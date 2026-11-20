export const WIND = {
  capacity: 48,
  idleCount: 12,
  boostCount: { desktop: 36, phone: 23 },
  minimumSpeedRatio: 0.7,
  repeatDistance: 156,
  nearDistance: 16,
  baseLength: 2.2,
  boostLength: 16,
} as const;

export const CLOUDS = {
  patchesPerBand: 24,
  opacity: 0.55,
  extraRadius: 55,
  colors: [0xc5e0e0, 0xd3e5e5, 0xecf4e9],
  // x, height, z, width, height, depth in the patch's local coordinates.
  blocks: [
    [-13, 0, 0, 19, 2.8, 9],
    [-5, 0, 4, 22, 3.5, 16],
    [8, 1, -2, 24, 5, 16],
    [16, 0.8, 5, 17, 3, 11],
    [-2, 2.8, 2, 18, 2.4, 10],
    [9, -0.8, -8, 16, 2, 8],
  ],
  flashTicks: 18,
  reentryTicks: 42,
  fixtureIndex: 9,
} as const;

export const WING_TRAIL = {
  capacity: 96,
  phoneCapacity: 64,
  intervalTicks: { desktop: 2, phone: 3 },
  lifeTicks: 175,
  thresholdRatio: 1.1,
  // Match the swept outer edge of the current ship mesh.
  tip: { x: 9.8, y: -0.62, z: 7.15 },
  width: 0.54,
  bankWidth: 0.45,
  boostWidth: 0.30,
  rollWidth: 0.68,
  opacity: 0.78,
  colors: [0xeffff4, 0x8ed3e6, 0x4b93ad],
  fixtureTurnRate: 1.95,
} as const;

export const FLIGHT_SURFACE = {
  clearance: 45,
  wakeMinSpeedRatio: 0.75,
  wakeLifeTicks: 118,
  wakeInterval: { desktop: 5, phone: 7 },
  wakeCapacity: 25,
  wakeOpacity: 0.84,
  foamWidth: 1.35,
  dustWidth: 2.7,
  sprayLifeTicks: 16,
  foamColors: [0xe9fff3, 0xa4e4e5, 0x6eb3c3],
  dustColors: [0xe6d3a6, 0xc3a97d, 0x8e886c],
  fixture: { turnRate: 2.65, waterClearance: 25, landClearance: 31 },
  shadow: {
    textureSize: 16, segments: 4, bias: 0.42, color: 0x112134,
    nearOpacity: 0.62, farOpacity: 0.21, fullSpreadClearance: 150,
    width: 16, extraWidth: 15, length: 19, extraLength: 14,
  },
} as const;
