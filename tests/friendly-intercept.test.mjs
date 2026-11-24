import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage, parseStageOptions } from '../src/stage.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { acquireAndFire, advanceShots, STEP } from '../src/stage-combat.ts';
import { scaleTravel } from '../src/data/speed.ts';

const ground = () => 35;

function fireAgainstMovingTarget(weapon, offset, speed) {
  const state = createStage(parseStageOptions('?mode=survivors&t=0&seed=23'), ground);
  state.strafeAt = Infinity;
  state.run.weaponLevels = { [weapon]: 1 };
  const target = makeEnemy(state, state.player.x + offset.x, state.player.z + offset.z, 1, 'patrol', 0);
  target.alt = state.player.altitude + offset.alt;
  const distance = Math.hypot(offset.x, offset.z);
  target.vx = offset.x / distance * speed;
  target.vz = offset.z / distance * speed;
  target.hp = 100;
  state.enemies = [target];
  acquireAndFire(state);
  const shots = state.shots.filter(shot => shot.kind === weapon);
  assert.ok(shots.length > 0);
  for (let tick = 0; tick < 60 && target.hp === 100; tick++) {
    target.x += target.vx * STEP;
    target.z += target.vz * STEP;
    advanceShots(state, ground);
    state.tick++;
  }
  return target.hp;
}

test('Twin Cannon solves the 3D intercept for a receding elevated target', () => {
  assert.ok(fireAgainstMovingTarget('twin', { x: 0, z: 90, alt: 35 }, 240) < 100);
});

test('Wing Pods solve the 3D intercept for a receding elevated target', () => {
  assert.ok(fireAgainstMovingTarget('pods', { x: -scaleTravel(35), z: scaleTravel(20), alt: 35 }, 180) < 100);
});
