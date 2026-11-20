import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCheckpoint, encodeCheckpoint } from '../src/checkpoint.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';

const ground = () => 35;
const stateAt = (tick, mode = 'survivors') => {
  const stage = createStage(parseStageOptions(`?autoplay=1&mode=${mode}&seed=11`), ground);
  stage.tick = tick - 1;
  stepStage(stage, {}, ground);
  return stage;
};

test('checkpoints exist only at nonterminal survivor phase transitions', () => {
  for (const seconds of [120, 240, 360, 480]) {
    const stage = stateAt(seconds * 60);
    assert.equal(decodeCheckpoint(encodeCheckpoint(stage)).tick, seconds * 60);
  }
  for (const tick of [1, 7199, 7201, 36000]) assert.equal(encodeCheckpoint(stateAt(tick)), null);
  assert.equal(encodeCheckpoint(stateAt(7200, 'legacy')), null);
});

test('restoring a phase boundary preserves the deterministic state and the next inputs', () => {
  const original = stateAt(480 * 60);
  const snapshot = encodeCheckpoint(original);
  const restored = decodeCheckpoint(snapshot);
  assert.equal(JSON.stringify(restored), JSON.stringify(original));
  for (let frame = 0; frame < 90; frame++) {
    const input = { turn: 0.1, climb: 0.3, boost: frame < 30 };
    stepStage(original, input, ground);
    stepStage(restored, input, ground);
  }
  assert.equal(JSON.stringify(restored), JSON.stringify(original));
});

test('a pre-Ace 8:00 checkpoint deploys the new fighter while preserving the sortie', () => {
  const original = stateAt(480 * 60);
  const envelope = JSON.parse(encodeCheckpoint(original));
  envelope.state.boss = { weakPoints: [{ hp: 47 }], index: 0, exposeTick: original.tick + 180 };
  envelope.state.phaseNotice.phase = 'warden';
  const restored = decodeCheckpoint(JSON.stringify(envelope));
  assert.equal(restored.tick, original.tick);
  assert.deepEqual(restored.run, original.run);
  assert.equal(restored.boss.kind, 'ace');
  assert.ok(restored.boss.entry);
  assert.equal(restored.phaseNotice.phase, 'ace');
  stepStage(restored, {}, ground);
  assert.ok(Number.isFinite(restored.boss.x));
});

test('checkpoint decoder ignores stale, incomplete, and corrupt storage', () => {
  const envelope = JSON.parse(encodeCheckpoint(stateAt(7200)));
  assert.equal(decodeCheckpoint(JSON.stringify({ ...envelope, version: 99 })), null);
  delete envelope.state.run.draftRng;
  assert.equal(decodeCheckpoint(JSON.stringify(envelope)), null);
  for (const raw of [null, '{}', 'null', 'bad JSON', '[]']) assert.equal(decodeCheckpoint(raw), null);
});
