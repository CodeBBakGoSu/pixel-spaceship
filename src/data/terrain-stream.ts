import { scaleTravel } from './speed.ts';

export const TERRAIN_STREAM = {
  chunkSize: scaleTravel(256),
  lodStrides: [1, scaleTravel(2), scaleTravel(4)],
  generationBudget: 6,
  fogNear: scaleTravel(245),
  fogMargin: scaleTravel(110),
  chaseEyeClearance: 12,
  desktop: { radius: 6, detailRadius: 1, middleRadius: 3, fogFar: scaleTravel(1020) },
  phone: { radius: 4, detailRadius: 1, middleRadius: 2, fogFar: scaleTravel(740) },
} as const;

export const TERRAIN_DECOR = {
  spacing: scaleTravel(32),
  seedSalt: 0x4a11cb59,
  treeMinAltitude: 42,
  rockMinAltitude: 74,
  canopy: [0x2a7a36, 0x1c5c2e],
  crown: [0x469e40, 0x56ae44],
  rock: [0x76706e, 0x928c86],
  water: [0x68ccd6, 0x8fdbe8],
} as const;

export const SITE_MARKERS = {
  capacity: 9,
  pedestal: 0x314756,
  colors: { beacon: 0x90f4ff, supply: 0xffb1da, xp: 0xa5ef8e },
} as const;
