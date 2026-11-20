import test from 'node:test';
import assert from 'node:assert/strict';
import { bossTick, createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { makeEnemy } from '../src/stage-enemies.ts';

test('audio observers get the live Ace arrival and enemy destruction without changing the sortie', () => {
  const ground = () => 35;
  const stage = createStage(parseStageOptions('?autoplay=1&mode=survivors&seed=1'), ground);
  stage.tick = bossTick(stage) - 1;
  const pendingKills = [
    makeEnemy(stage, 160, 120, 1, 'gnat'),
    makeEnemy(stage, 200, 120, 1, 'bomber'),
  ];
  pendingKills[1].carrier = 'first-evolution';
  stage.enemies.push(...pendingKills.map(enemy => Object.assign(enemy, { hp: 0, shotDown: true })));
  const silent = structuredClone(stage);
  const cues = [];
  const events = {
    aceArrival: () => cues.push('ace'),
    destroyed: (kind, elite) => cues.push([kind, elite]),
  };
  for (let tick = 0; tick < 2; tick++) {
    stepStage(stage, {}, ground, undefined, events);
    stepStage(silent, {}, ground);
    assert.deepEqual(stage, silent);
  }
  assert.deepEqual(cues, ['ace', ['gnat', false], ['bomber', true]]);
});
