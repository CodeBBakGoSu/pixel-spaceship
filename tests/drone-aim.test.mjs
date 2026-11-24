import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage, parseStageOptions } from '../src/stage.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { advanceShots } from '../src/stage-combat.ts';
import { advanceSupportWeapons } from '../src/support-weapons.ts';

const ground = () => 35;

test('level-five drone bolts aim through a Survivors altitude difference', () => {
  const state = createStage(parseStageOptions('?mode=survivors&t=0&seed=23'), ground);
  state.player.altitude = 120;
  state.run.weaponLevels = { drones: 5 };
  const target = makeEnemy(state, state.player.x, state.player.z + 15, 1, 'patrol', 0);
  target.alt = state.player.altitude + 45;
  target.hp = 100;
  state.enemies = [target];

  advanceSupportWeapons(state);
  const bolts = state.shots.filter(shot => shot.kind === 'drone-bolt');
  assert.ok(bolts.length > 0);
  assert.ok(bolts.every(shot => shot.vy > 0));
  for (let tick = 0; tick < 30; tick++) {
    advanceShots(state, ground);
    state.tick++;
  }
  assert.ok(target.hp < 100);
});
