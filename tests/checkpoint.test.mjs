import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCheckpoint, encodeCheckpoint } from '../src/checkpoint.ts';
import { SKIM_BAND } from '../src/bands.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { advanceSupportWeapons } from '../src/support-weapons.ts';

const ground = () => 35;
const stateAt = (tick, mode = 'survivors', input = {}) => {
  const stage = createStage(parseStageOptions(`?autoplay=1&mode=${mode}&seed=11`), ground);
  stage.tick = tick - 1;
  stepStage(stage, input, ground);
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
  const original = stateAt(480 * 60, 'survivors', { climb: -1 });
  assert.ok(original.player.pitch < 0);
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

test('a checkpoint saved before flight-path pitch resumes level', () => {
  const envelope = JSON.parse(encodeCheckpoint(stateAt(7200)));
  delete envelope.state.player.pitch;
  envelope.state.climbRate = 40;
  const restored = decodeCheckpoint(JSON.stringify(envelope), ground);
  assert.equal(restored.player.pitch, 0);
  stepStage(restored, { climb: 1 }, ground);
  assert.ok(restored.player.pitch > 0 && Number.isFinite(restored.player.altitude));
  envelope.state.player.pitch = 'invalid';
  assert.equal(decodeCheckpoint(JSON.stringify(envelope), ground), null);
});

test('a v1 checkpoint with scalar Ion cooldowns preserves immunity and resumes hitting both targets', () => {
  const before = stateAt(480 * 60);
  before.run.weaponLevels = { ion: 1 };
  const { x, z, altitude: alt } = before.player;
  const readyAt = before.tick + 2;
  const contact = { x, z: z - 18, alt };
  const enemy = makeEnemy(before, contact.x, contact.z, 1, 'patrol');
  Object.assign(enemy, contact, { ionReadyAt: readyAt });
  before.enemies = [enemy];
  delete before.boss.entry;
  Object.assign(before.boss, contact, { ionReadyAt: readyAt });
  before.ionWake = [{ ...contact, until: readyAt + 200 }];
  const restored = decodeCheckpoint(encodeCheckpoint(before), ground);
  advanceSupportWeapons(restored, ground);
  assert.equal(restored.enemies[0].hp, enemy.hp);
  assert.equal(restored.boss.hp, before.boss.hp);
  restored.tick = readyAt;
  advanceSupportWeapons(restored, ground);
  assert.ok(restored.enemies[0].hp < enemy.hp);
  assert.ok(restored.boss.hp < before.boss.hp);
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
  assert.ok(Math.hypot(target.x - player.x, target.z - player.z) <= 760);
  assert.equal(restored.boss.band, SKIM_BAND);
  assert.equal(target.alt, 61);
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

test('an old world checkpoint refreshes POI coordinates even in the same logical cell', () => {
  const before = stateAt(7200);
  assert.deepEqual([before.worldRegion.x, before.worldRegion.z], [0, -1]);
  const currentSites = structuredClone(before.worldSites);
  const first = before.worldSites[0];
  before.claimedSites = { [first.id]: true };
  delete before.worldRegion.spacing;
  first.claimed = true;
  first.x /= 2;
  first.z /= 2;

  const restored = decodeCheckpoint(encodeCheckpoint(before), ground);
  assert.equal(restored.worldRegion.spacing, 1536);
  assert.deepEqual(restored.worldSites[0], { ...currentSites[0], claimed: true });
  assert.deepEqual(restored.claimedSites, { [first.id]: true });
});

test('a v1 checkpoint upgrades skimmer volleys, turret flak and the world when resumed', () => {
  const before = stateAt(7200);
  const { x, z } = before.player;
  const skimmer = makeEnemy(before, x, z + 70, 0, 'skimmer');
  skimmer.shotAt = before.tick + 1;
  skimmer.tell = { kind: 'strafe', started: before.tick - 26, until: before.tick + 1 };
  const turret = makeEnemy(before, x + 15, z + 70, 1, 'turret');
  turret.alt = 40;
  turret.tell = { kind: 'flak', x, z: z + 52, alt: 125, until: before.tick + 1 };
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
  assert.equal(restored.enemies[1].tell.alt, 49);
  stepStage(restored, {}, ground);
  assert.equal(restored.enemies[0].alt, 49);
  assert.deepEqual(restored.shots.filter(shot => shot.kind === 'hostile').map(shot => shot.alt), [49, 49]);
  assert.equal(restored.effects.find(effect => effect.kind === 'flak').alt, 49);
});
