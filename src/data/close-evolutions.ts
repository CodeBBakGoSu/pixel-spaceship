export const CLOSE_EVOLUTIONS = {
  aurora: { fan: 0.011, adjacentCadence: 23 },
  aegis: { radius: 19, halfWidth: 4, damage: 2, hitCooldownTicks: 22 },
  plasma: { lifeTicks: 480, sampleTicks: 6, widthScale: 1.28, hitCooldownTicks: 18 },
  collector: { count: 4, magnetRange: 24, pickupRange: 5, pullSpeed: 105 },
  phoenix: { lifeTicks: 200, range: 86, turnRate: 4.8, speed: 46, verticalSpeed: 28, burnScale: 1.3 },
  carpet: { count: 5, spacing: 12 },
} as const;
