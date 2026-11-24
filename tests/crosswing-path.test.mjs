import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceEnemies } from '../src/stage-enemies.ts';
import { createStage, parseStageOptions } from '../src/stage.ts';
import { spawnWave } from '../src/spawn-director.ts';

test('front-facing Crosswing fighters cross their actual paths in an X', () => {
  const ground = () => 35;
  const state = createStage(parseStageOptions('?mode=survivors&t=0'), ground);
  Object.assign(state.player, { x: 0, z: 0, yaw: 0 });
  spawnWave(state, { time: 0, members: [{ kind: 'crosswing', band: 1, bearing: 0, range: 134 }] }, ground);
  const fighters = state.enemies.filter(enemy => enemy.kind === 'crosswing');
  assert.equal(fighters.length, 2);
  const yaw = fighters[0].crosswing.sideYaw;
  const sideX = Math.cos(yaw), sideZ = -Math.sin(yaw);
  const forwardX = Math.sin(yaw), forwardZ = Math.cos(yaw);
  const spawnCenter = { x: (fighters[0].x + fighters[1].x) / 2, z: (fighters[0].z + fighters[1].z) / 2 };
  Object.assign(state.player, { x: spawnCenter.x, z: spawnCenter.z - forwardZ * 100 });
  const center = { x: state.player.x + forwardX * 24, z: state.player.z + forwardZ * 24 };
  for (const fighter of fighters) {
    delete fighter.entry;
    fighter.maneuverAt = state.tick;
  }
  const lateral = fighter => (fighter.x - center.x) * sideX + (fighter.z - center.z) * sideZ;
  const startSides = new Map(fighters.map(fighter => [fighter.id, Math.sign(lateral(fighter))]));
  assert.ok(fighters.every(fighter => startSides.get(fighter.id) === fighter.crosswing.side));

  for (let tick = 1; tick <= 360 && fighters.some(fighter => fighter.crosswing.phase !== 'recovery'); tick++) {
    state.tick = tick;
    advanceEnemies(state, ground);
  }
  assert.ok(fighters.every(fighter => fighter.crosswing.phase === 'recovery'));
  for (const fighter of fighters) assert.equal(Math.sign(lateral(fighter)), -startSides.get(fighter.id));
});
