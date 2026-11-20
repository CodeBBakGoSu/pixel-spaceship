import { CRUISE_SPEED } from './flight.ts';
import { ENEMY_KINDS, type EnemyKind } from './enemy-kinds.ts';
import { nearestBand } from './maneuvers.ts';
import { makeEnemy } from './stage-enemies.ts';
import type { StageState } from './stage-types.ts';

/** Frozen comparison pose for the same framing in TOP, CHASE and the rear mirror. */
export function primeFidelityFixture(state: StageState, query: URLSearchParams): void {
  const { player } = state;
  Object.assign(player, { x: -128, z: -320, altitude: 110, yaw: 0,
    bank: state.view === 'chase' ? 0.19 : 0, vx: 0, vz: CRUISE_SPEED });
  state.tick = 317 * 60;
  state.speed = CRUISE_SPEED;
  state.boost = 0.82;
  state.hull = 7;
  state.level = 14;
  state.xp = 15;
  if (state.run) state.run.weaponLevels = { twin: 2, seeker: 1, pods: 2 };

  const requested = query.get('kind');
  const featured = requested && Object.prototype.hasOwnProperty.call(ENEMY_KINDS, requested)
    ? requested as EnemyKind : 'interceptor';
  const overlap = query.get('overlap');
  const band = nearestBand(player.altitude);
  for (const direction of [1, -1]) {
    // Keep the trailing group beyond the external chase camera and the cockpit group just inside the glass.
    const clearance = direction < 0 && state.view === 'chase' ? 48 : direction > 0 && state.view === 'cockpit' ? 22 : 0;
    const worldZ = (z: number): number => player.z + (z + clearance) * direction;
    const add = (kind: EnemyKind, x: number, z: number, offset: number, bank: number): void => {
      const enemy = makeEnemy(state, player.x + x, worldZ(z), band, kind, offset);
      enemy.bank = bank;
      state.enemies.push(enemy);
    };
    add(featured, 0, 38, 9, 0.32);
    add('bomber', -21, 62, 5, -0.15);
    add('skimmer', 24, 73, -5, 0.15);
    add('gnat', 13, 50, 2, 0.2);
    add('gnat', 19, 56, 3, -0.2);
    if (overlap === 'near-first' || overlap === 'far-first') {
      const x = player.x - 8, alt = player.altitude + 1;
      const coin = { x, z: worldZ(34), alt, id: ++state.nextId, xp: 4, born: state.tick };
      const orb = { x, z: worldZ(37), alt, id: ++state.nextId, xp: 1, born: state.tick };
      if (overlap === 'near-first') state.pickups.push(coin, orb);
      else state.pickups.push(orb, coin);
      continue;
    }
    for (const [x, z, xp, alt] of [[-14, 23, 1, 110], [-6, 28, 3, 109], [8, 29, 1, 108], [15, 21, 4, 110]]) {
      state.pickups.push({ x: player.x + x, z: worldZ(z), alt,
        id: ++state.nextId, xp, born: state.tick });
    }
  }
  state.rearGlimpse = { kind: 'flare', since: state.tick - 18, until: state.tick + 60 };
}
