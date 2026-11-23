import { gnatBursts } from './combat-feedback.ts';
import { makeEnemy } from './stage-enemies.ts';
import { hurtEnemy } from './stage-combat.ts';
import type { StageState } from './stage-types.ts';

export function advanceDamageFixture(state: StageState): void {
  state.phase = 'playing';
  state.tick++;
  state.swarmCap = 200;
  state.reversal = { startTick: 0, until: state.tick + 60, pursuers: [], kills: 6,
    killTicks: [], streak: 6, nextShotAt: state.tick + 60, shownUntil: state.tick + 60 };
  if (state.enemies.length !== 200) {
    state.enemies = Array.from({ length: 200 }, (_, i) => {
      const enemy = makeEnemy(state, state.player.x + (i % 20 - 9.5) * 8,
        state.player.z + 50 + Math.floor(i / 20) * 13, 1, 'gnat');
      enemy.alt = state.player.altitude;
      return enemy;
    });
  }
  for (const effect of state.effects) effect.life -= 1 / 60;
  state.effects = state.effects.filter(effect => effect.life > 0);
  if (state.tick % 45 === 0) {
    for (let i = 0; i < 12; i++) {
      const enemy = state.enemies[84 + i];
      enemy.hp = 1;
      hurtEnemy(state, enemy, i === 5 ? 12 : 1);
      const effect = { kind: 'burst' as const, x: enemy.x, z: enemy.z, alt: enemy.alt, life: 0.42 };
      state.effects.push(effect); gnatBursts.add(effect);
      state.kills++;
    }
  }
}
