export const TERRAIN_STREAM = {
  chunkSize: 256,
  generationBudget: 6,
  fogNear: 245,
  chaseEyeClearance: 12,
  desktop: { radius: 6, detailRadius: 1, middleRadius: 3, fogFar: 1020 },
  phone: { radius: 4, detailRadius: 1, middleRadius: 2, fogFar: 740 },
} as const;

export const TERRAIN_DECOR = {
  seedSalt: 0x4a11cb59,
  treeMinAltitude: 42,
  rockMinAltitude: 74,
  canopy: [0x295f42, 0x396d47],
  crown: [0x498052, 0x5d9055],
  rock: [0x656f71, 0x808878],
  water: [0x468d9b, 0x529da5],
} as const;

export const SITE_MARKERS = {
  capacity: 9,
  pedestal: 0x314756,
  colors: { beacon: 0x90f4ff, supply: 0xffb1da, xp: 0xa5ef8e },
} as const;
