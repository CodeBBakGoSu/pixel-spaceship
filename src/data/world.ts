import { scaleTravel } from './speed.ts';

export const WORLD_TERRAIN = {
  period: 16_384,
  step: 16,
  seaLevel: 35,
  shallows: 39,
  maxHeight: 112,
  reachCore: 480,
  reachBlend: 768,
} as const;

export const WORLD_AIRSPACE = { x: 0, z: 0, radius: 1792 } as const;

export const REACH_LANDMARKS = {
  ridge: { x: -240, z: 96, alt: 125 },
  strait: { x: -128, z: -320, alt: 75 },
  stacks: { x: 288, z: 240, alt: 180 },
  atoll: { x: 160, z: -128, alt: 125 },
} as const;

export const REACH_STACKS = [
  { x: 224, z: 224, top: 104 }, { x: 288, z: 240, top: 112 },
  { x: 352, z: 208, top: 96 }, { x: 256, z: 304, top: 108 }, { x: 336, z: 288, top: 101 },
] as const;

export const WORLD_SITES = {
  spacing: scaleTravel(768),
  claimRadius: scaleTravel(25),
  claimWindow: 12,
  wellXp: 4,
  boost: 0.6,
  rallyNear: scaleTravel(380),
  rallyDistance: scaleTravel(230),
  fixtureExtent: 1_048_576,
} as const;

export const FLY_IN_WORLD = {
  minApproachDistance: scaleTravel(640),
  transitAltitude: 195,
  clearance: 22,
} as const;

export const SPAWN_WORLD = { recycleDistance: scaleTravel(465), turretSeparation: scaleTravel(38), bomberFormationSize: 3 } as const;
