import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage, parseStageOptions } from '../src/stage.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { STEP } from '../src/stage-combat.ts';
import { advanceRangedShot, advanceRangedWeapons } from '../src/ranged-weapons.ts';

const ground = () => 35;

test('Survivors seeker maintains 3D pursuit of a laterally receding elevated target', () => {
  const state = createStage(parseStageOptions('?mode=survivors&t=0&seed=23'), ground);
  state.player.altitude = 120;
  state.run.weaponLevels = { seeker: 1 };
  const target = makeEnemy(state, state.player.x, state.player.z + 80, 1, 'patrol', 0);
  target.alt = state.player.altitude + 30;
  target.vx = 40;
  target.hp = 100;
  state.enemies = [target];
  advanceRangedWeapons(state, ground);
  const shot = state.shots.find(candidate => candidate.kind === 'seeker');
  assert.ok(shot);

  for (let tick = 0; tick < 120 && target.hp === 100 && shot.life > 0; tick++) {
    target.x += target.vx * STEP;
    advanceRangedShot(state, shot, ground);
    state.tick++;
  }
  assert.ok(target.hp < 100);
});
