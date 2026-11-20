import type { Enemy } from '../stage-types.ts';
import { scaleTravel, SPEED_SCALE } from './speed.ts';

export const ROSTER = {
  bands: { low: 0, mid: 1, high: 2 },
  patrol: { warningTicks: 22, closeRange: scaleTravel(14) },
  interceptor: { warningTicks: 27, tailRange: scaleTravel(82), tailHalfAngle: Math.PI / 4,
    tailSlot: scaleTravel(42), tailSpeedScale: 1.33, closeRange: scaleTravel(32) },
  hound: { bandFollowRange: scaleTravel(85), bandLagTicks: 60, bandSpeed: 29, warningTicks: 27,
    tailSlot: scaleTravel(29), lateralSlot: scaleTravel(6), attackWidth: scaleTravel(23) },
  skimmer: { lookAhead: scaleTravel(18), closeRange: scaleTravel(60), closeMargin: scaleTravel(6), warningTicks: 27,
    range: scaleTravel(176),
    spread: [-0.14, 0.14], cooldownTicks: 240 },
  spotter: { warningTicks: 48, range: scaleTravel(195), closeRange: scaleTravel(105), longRange: scaleTravel(165),
    rangeMargin: scaleTravel(8), buffRange: scaleTravel(125), cooldownTicks: 150, recoveryTicks: 42 },
  flanker: { warningTicks: 27, range: scaleTravel(106), lateralSlot: scaleTravel(40), cooldownTicks: 240 },
  harrier: { warningTicks: 33, bandHopWarningTicks: 75, bandHopRange: scaleTravel(115), tailSlot: scaleTravel(62),
    lateralSlot: scaleTravel(15), attackWidth: scaleTravel(33) },
  diver: { warningTicks: 72, range: scaleTravel(180), closeRange: scaleTravel(75), closeMargin: scaleTravel(6),
    plungeSpeed: 55, climbSpeed: 30, spread: [-0.26, 0, 0.26] },
  bomber: { warningTicks: 32, range: scaleTravel(165), mineOffset: scaleTravel(12), cooldownTicks: 250,
    closeRange: scaleTravel(96), closeMargin: scaleTravel(8), tailRange: scaleTravel(86), tailHalfAngle: Math.PI / 4 },
  flak: { warningTicks: 84, range: scaleTravel(175), leadDistance: scaleTravel(52), cooldownTicks: 270 },
  aegis: { hp: 5, xp: 2, cap: 3, firstShot: 110, speed: scaleTravel(27), boltSpeed: scaleTravel(67),
    shieldHalfAngle: Math.PI / 3, warningTicks: 32, range: scaleTravel(145), orbitRange: scaleTravel(70), orbitMargin: scaleTravel(8),
    orbitAngle: 1.55, cooldownTicks: 270 },
  carrier: { warningTicks: 52, range: scaleTravel(175), waveSize: 4, cooldownTicks: 390 },
  gnat: { warningTicks: 42, driftResponse: 0.12, escortHalfFan: Math.PI / 4, escortSpacing: 0.7 },
  escort: { span: scaleTravel(19), aft: scaleTravel(13), speedLimit: scaleTravel(36) },
  pursuit: { longRange: scaleTravel(55), longMargin: scaleTravel(6), closeMargin: scaleTravel(4),
    fireRange: scaleTravel(185), tailNear: scaleTravel(11), tailFar: scaleTravel(26), lookAheadMin: scaleTravel(6) },
  flyby: { speed: scaleTravel(76), lane: scaleTravel(31), laneLeeway: scaleTravel(32), crossAhead: scaleTravel(62),
    crossTravel: scaleTravel(92), crossExit: scaleTravel(43), startSpeedSlack: scaleTravel(12), passSpeedSlack: scaleTravel(6),
    aftMin: scaleTravel(42), aftMax: scaleTravel(105), wingMin: scaleTravel(14), wingMax: scaleTravel(68),
    driftSlack: scaleTravel(16), aheadMin: scaleTravel(52), crossWing: scaleTravel(22),
    correction: 0.032 / SPEED_SCALE, finishAhead: scaleTravel(32), finishRadius: scaleTravel(8),
    lookAhead: scaleTravel(15), overtakeAhead: scaleTravel(16), overtakeWing: scaleTravel(17), entrySpeed: scaleTravel(34) },
} as const;

export function aegisBlocks(enemy: Pick<Enemy, 'x' | 'z' | 'kind' | 'yaw'>, sourceX: number, sourceZ: number): boolean {
  if (enemy.kind !== 'aegis') return false;
  const dx = sourceX - enemy.x, dz = sourceZ - enemy.z;
  const distance = Math.hypot(dx, dz);
  const nose = dx * Math.sin(enemy.yaw) + dz * Math.cos(enemy.yaw);
  return distance > 0 && nose >= distance * Math.cos(ROSTER.aegis.shieldHalfAngle);
}
