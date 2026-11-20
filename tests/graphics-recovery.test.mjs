import test from 'node:test';
import assert from 'node:assert/strict';
import { autopilotInput } from '../src/autoplay.ts';
import { GraphicsRecovery } from '../src/graphics-recovery.ts';
import { createStage, parseStageOptions, RUN_END_TICK, stepStage } from '../src/stage.ts';
import { World } from '../src/world.ts';
import { createHash } from 'node:crypto';

const hash = state => createHash('sha256').update(JSON.stringify(state)).digest('hex');

test('restoration owns only the pause it set and holds all steps until a rebuilt frame', () => {
  const recovery = new GraphicsRecovery();
  const flight = { phase: 'playing', paused: false, boosting: true, tick: 120 };
  assert.equal(recovery.lose(), true);
  assert.equal(recovery.lose(), false);
  assert.equal(recovery.canAdvance, false);
  assert.equal(recovery.pauseFlight(flight), true);
  assert.deepEqual(flight, { phase: 'playing', paused: true, boosting: true, tick: 120 });
  assert.equal(recovery.resumeFlight(flight), false);
  assert.equal(recovery.restore(), true);
  assert.equal(recovery.canAdvance, false);
  assert.equal(recovery.resumeFlight(flight), false);
  assert.equal(recovery.frameReady(), true);
  assert.equal(recovery.canAdvance, false);
  assert.equal(recovery.resumeFlight(flight), true);
  assert.equal(recovery.canAdvance, true);
  assert.deepEqual(flight, { phase: 'playing', paused: false, boosting: true, tick: 120 });
});

test('recovery preserves private menu state and an existing manual pause', () => {
  for (const phase of ['title', 'playing', 'draft', 'chest']) {
    const recovery = new GraphicsRecovery();
    const flight = { phase, paused: phase === 'playing', tick: 444 };
    const before = structuredClone(flight);
    recovery.lose();
    assert.equal(recovery.pauseFlight(flight), false);
    assert.equal(recovery.canAdvance, false);
    recovery.restore();
    recovery.lose();
    assert.equal(recovery.frameReady(), false);
    recovery.restore();
    recovery.frameReady();
    assert.equal(recovery.resumeFlight(flight), false);
    assert.equal(recovery.canAdvance, true);
    assert.deepEqual(flight, before);
  }
});

test('a boosted full-view replay has the same terminal hash across graphics loss and restore', () => {
  const options = parseStageOptions('?autoplay=1&mode=legacy&seed=11');
  const world = new World(11), ground = (x, z) => world.height(x, z);
  const reference = createStage(options, ground), inputs = [];
  const running = stage => ['playing', 'draft', 'chest'].includes(stage.phase);
  while (running(reference) && inputs.length < RUN_END_TICK) {
    const input = autopilotInput(reference, 'full', ground);
    inputs.push(input);
    stepStage(reference, input, ground);
  }

  const recovery = new GraphicsRecovery();
  const flight = createStage(options, ground);
  let forced = false;
  for (const input of inputs) {
    if (!forced && flight.tick > 600 && flight.phase === 'playing' && flight.boosting) {
      forced = true;
      const snapshot = hash(flight);
      recovery.lose();
      recovery.pauseFlight(flight);
      const frozen = hash(flight);
      for (let frame = 0; frame < 100; frame++) {
        if (recovery.canAdvance) stepStage(flight, input, ground);
        assert.equal(hash(flight), frozen);
      }
      recovery.restore();
      recovery.frameReady();
      recovery.resumeFlight(flight);
      assert.equal(hash(flight), snapshot);
    }
    if (recovery.canAdvance) stepStage(flight, input, ground);
  }
  assert.equal(reference.phase, 'clear');
  assert.ok(forced);
  assert.equal(hash(flight), hash(reference));
});
