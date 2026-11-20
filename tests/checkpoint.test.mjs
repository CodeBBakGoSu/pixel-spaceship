import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCheckpoint, encodeCheckpoint } from '../src/checkpoint.ts';
import { SKIM_BAND } from '../src/bands.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { makeEnemy } from '../src/stage-enemies.ts';

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
  const player = envelope.state.player;
  Object.assign(player, { x: -4200, z: 2850, altitude: 77, skim: 'land' });
  const terrain = (x, z) => x < -3200 && z > 2200 ? 47 : 35;
  delete envelope.state.worldRegion;
  delete envelope.state.worldSites;
  envelope.state.arena.radius = 560;
  envelope.state.boss = { weakPoints: [{ hp: 47 }], index: 0, exposeTick: original.tick + 180 };
  envelope.state.phaseNotice.phase = 'warden';
  const restored = decodeCheckpoint(JSON.stringify(envelope), terrain);
  assert.equal(restored.tick, original.tick);
  assert.deepEqual(restored.run, original.run);
  assert.equal(restored.boss.kind, 'ace');
  const { target } = restored.boss.entry;
  assert.ok(Math.hypot(target.x - player.x, target.z - player.z) <= 380);
  assert.equal(restored.boss.band, SKIM_BAND);
  assert.equal(target.alt, 77);
  assert.equal(restored.boss.x, restored.boss.entry.origin.x);
  assert.equal(restored.phaseNotice.phase, 'ace');
  stepStage(restored, {}, terrain);
  assert.ok(Number.isFinite(restored.boss.x));
});

test('checkpoint decoder ignores stale, incomplete, and corrupt storage', () => {
  const envelope = JSON.parse(encodeCheckpoint(stateAt(7200)));
  assert.equal(decodeCheckpoint(JSON.stringify({ ...envelope, version: 99 })), null);
  delete envelope.state.run.draftRng;
  assert.equal(decodeCheckpoint(JSON.stringify(envelope)), null);
  for (const raw of [null, '{}', 'null', 'bad JSON', '[]']) assert.equal(decodeCheckpoint(raw), null);
});

test('a v1 checkpoint upgrades skimmer volleys, turret flak and the world when resumed', () => {
  const before = stateAt(7200);
  const { x, z } = before.player;
  const skimmer = makeEnemy(before, x, z + 70, 0, 'skimmer');
  skimmer.shotAt = before.tick + 1;
  skimmer.tell = { kind: 'strafe', started: before.tick - 26, until: before.tick + 1 };
  const turret = makeEnemy(before, x + 15, z + 70, 1, 'turret');
  turret.alt = 40;
  turret.tell = { kind: 'flak', x, z: z + 52, alt: 110, until: before.tick + 1 };
  before.enemies = [skimmer, turret];
  delete before.worldRegion;
  delete before.worldSites;
  before.arena.radius = 560;
  const restored = decodeCheckpoint(encodeCheckpoint(before), ground);
  assert.ok(restored.worldSites.length > 0);
  assert.ok(restored.arena.radius > 1770);
  assert.equal(restored.enemies[0].skim, true);
  assert.equal(restored.enemies[1].alt, 40);
  assert.equal(restored.enemies[1].skim, true);
  assert.equal(restored.enemies[1].tell.alt, 65);
  stepStage(restored, {}, ground);
  assert.equal(restored.enemies[0].alt, 65);
  assert.deepEqual(restored.shots.filter(shot => shot.kind === 'hostile').map(shot => shot.alt), [65, 65]);
  assert.equal(restored.effects.find(effect => effect.kind === 'flak').alt, 65);
});
