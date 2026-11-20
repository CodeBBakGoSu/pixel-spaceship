import type { Enemy } from '../stage-types.ts';

export const ROSTER = {
  bands: { low: 0, mid: 1, high: 2 },
  patrol: { warningTicks: 22 },
  interceptor: { warningTicks: 27, tailRange: 82, tailHalfAngle: Math.PI / 4, tailSlot: 42, tailSpeedScale: 1.33 },
  hound: { bandFollowRange: 85, bandLagTicks: 60, bandSpeed: 29, warningTicks: 27 },
  skimmer: { waterCeiling: 39, skimClearance: 30, lookAhead: 18, warningTicks: 27, range: 176,
    spread: [-0.14, 0.14], cooldownTicks: 240 },
  spotter: { warningTicks: 48, range: 195, cooldownTicks: 150, recoveryTicks: 42 },
  flanker: { warningTicks: 27, range: 106, cooldownTicks: 240 },
  harrier: { warningTicks: 33, bandHopWarningTicks: 75 },
  diver: { warningTicks: 72, range: 180, plungeSpeed: 55, climbSpeed: 30, spread: [-0.26, 0, 0.26] },
  bomber: { warningTicks: 32, range: 165, mineOffset: 12, cooldownTicks: 250,
    tailRange: 86, tailHalfAngle: Math.PI / 4 },
  flak: { warningTicks: 84, range: 175, leadDistance: 52, cooldownTicks: 270 },
  aegis: { hp: 5, xp: 2, cap: 3, firstShot: 110, speed: 27, boltSpeed: 67,
    shieldHalfAngle: Math.PI / 3, warningTicks: 32, range: 145, orbitRange: 70, orbitMargin: 8,
    orbitAngle: 1.55, cooldownTicks: 270 },
  carrier: { warningTicks: 52, range: 175, waveSize: 4, cooldownTicks: 390 },
  gnat: { warningTicks: 42, driftResponse: 0.12, escortHalfFan: Math.PI / 4, escortSpacing: 0.7 },
} as const;

export function aegisBlocks(enemy: Pick<Enemy, 'x' | 'z' | 'kind' | 'yaw'>, sourceX: number, sourceZ: number): boolean {
  if (enemy.kind !== 'aegis') return false;
  const dx = sourceX - enemy.x, dz = sourceZ - enemy.z;
  const distance = Math.hypot(dx, dz);
  const nose = dx * Math.sin(enemy.yaw) + dz * Math.cos(enemy.yaw);
  return distance > 0 && nose >= distance * Math.cos(ROSTER.aegis.shieldHalfAngle);
}
