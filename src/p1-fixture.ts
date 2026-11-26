import { BANDS } from './stage-combat.ts';
import { makeEnemy } from './stage-enemies.ts';
import type { StageState } from './stage-types.ts';

export function primeP1Fixture(state: StageState, query: URLSearchParams): void {
  const run = state.run;
  if (!run) return;
  if (query.get('fixture') === 'p1-cache') {
    const cache = query.get('cache');
    state.phase = 'chest';
    state.chests.offer = cache === 'evolution' || cache === 'fallback' ? 'first-evolution' : 'coast-supply';
    if (cache === 'evolution') {
      run.weaponLevels.seeker = 7;
      run.buffLevels['fire-control'] = 1;
    }
    return;
  }

  const highRank = query.get('build') !== 'starter';
  if (highRank) {
    run.weaponLevels = { twin: 7, seeker: 7 };
    run.evolutions.seeker = 'swarm-rack';
  }
  state.paused = true;
  const p = state.player;
  p.altitude = BANDS[2];
  for (let i = 0; i < 12; i++) {
    const enemy = makeEnemy(state, p.x + (i % 4 - 1.5) * 23, p.z + 84 + Math.floor(i / 4) * 15, 2, 'gnat', 0);
    state.enemies.push(enemy);
  }
  const danger = makeEnemy(state, p.x + 28, p.z + 124, 1, 'spotter', 0);
  danger.shotAt = 15;
  state.enemies.push(danger);
}
