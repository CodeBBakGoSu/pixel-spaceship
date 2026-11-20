export const RANGED_EVOLUTION_TUNING = {
  'swarm-rack': { rockets: 12 },
  skybreaker: {
    secondary: { headings: [-Math.PI / 3, 0, Math.PI / 3], speed: 74, travelTicks: 17, radius: 19, damageScale: 0.55 },
  },
  'storm-crown': { range: 138, radius: 24, strikes: 3, strikeHeight: 47, damageScale: 1.35 },
} as const;
