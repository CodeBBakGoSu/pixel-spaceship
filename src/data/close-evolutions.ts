import { scaleTravel } from './speed.ts';

export const CLOSE_EVOLUTIONS = {
  aurora: { fan: 0.011, adjacentCadence: 23 },
  aegis: { radius: scaleTravel(19), halfWidth: scaleTravel(4), damage: 2, hitCooldownTicks: 22 },
  plasma: { lifeTicks: 480, sampleTicks: 6, widthScale: 1.28, hitCooldownTicks: 18 },
  collector: { count: 4, magnetRange: scaleTravel(24), pickupRange: scaleTravel(5), pullSpeed: scaleTravel(105) },
  phoenix: { lifeTicks: 200, range: scaleTravel(86), turnRate: 4.8, speed: scaleTravel(46), verticalSpeed: 28, burnScale: 1.3 },
  carpet: { count: 5, spacing: scaleTravel(12) },
} as const;
