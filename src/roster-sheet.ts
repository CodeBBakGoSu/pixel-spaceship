import { makeAce } from './ace.ts';
import { CRUISE_SPEED } from './flight.ts';
import { ENEMY_KINDS, type EnemyKind } from './enemy-kinds.ts';
import { LANDMARKS } from './reach.ts';
import { makeEnemy, placeSkimEnemy } from './stage-enemies.ts';
import type { Ground, StageState } from './stage-types.ts';

type RosterSubject = EnemyKind | 'ace' | 'carrier';

export const ROSTER_SHEET_CAMERA = { distance: 88, rise: 21, fov: 58 } as const;

export function rosterSubject(kind: string | null): RosterSubject {
  if (kind === 'ace' || kind === 'carrier') return kind;
  return kind && Object.prototype.hasOwnProperty.call(ENEMY_KINDS, kind) ? kind as EnemyKind : 'hound';
}

/** The review camera sees one aircraft at the same range and angle on either layout. */
export function primeRosterSheet(state: StageState, kind: RosterSubject, ground: Ground): void {
  const { player } = state;
  const x = LANDMARKS.strait.x, z = LANDMARKS.strait.z + ROSTER_SHEET_CAMERA.distance;
  Object.assign(player, { x, z: LANDMARKS.strait.z, yaw: 0, bank: 0, altitude: 110 });
  state.tick = 45 * 60;
  state.speed = CRUISE_SPEED;
  state.enemies.length = 0;
  state.worldSites = [];
  const yaw = -2.42;
  if (kind === 'ace') {
    state.boss = makeAce(state, x, z, ground);
    state.boss.yaw = yaw;
    return;
  }
  const enemy = makeEnemy(state, x, z, 1, kind === 'carrier' ? 'bomber' : kind);
  placeSkimEnemy(enemy, ground);
  enemy.yaw = yaw;
  enemy.bank = kind === 'turret' ? 0 : 0.15;
  if (kind === 'carrier') enemy.carrier = 'first-evolution';
  state.enemies.push(enemy);
}
