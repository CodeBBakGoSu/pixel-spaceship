import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCheckpoint, encodeCheckpoint } from '../src/checkpoint.ts';
import { SKIM_BAND } from '../src/bands.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { advanceSupportWeapons } from '../src/support-weapons.ts';
import { trySpendThreat } from '../src/threat-budget.ts';

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

test('old checkpoints carry manual bomb progress forward for the pilot and the current flight', () => {
  const old = JSON.parse(encodeCheckpoint(stateAt(7200)));
  for (const [metrics, drops] of [[old.state.metrics, 4], [old.state.profile.metrics, 5]]) {
    delete metrics.bombsDropped;
    metrics.manualBombs = drops;
  }
  const restored = decodeCheckpoint(JSON.stringify(old), ground);
  assert.equal(restored.metrics.bombsDropped, 4);
  assert.equal(restored.profile.metrics.bombsDropped, 5);
  restored.run.weaponLevels['bomb-bay'] = 1;
  stepStage(restored, {}, ground);
  assert.equal(restored.metrics.bombsDropped, 5);
});
test('v1 checkpoints migrate altitude-task progress and retain partial Bill completion', () => {
  const envelope = JSON.parse(encodeCheckpoint(stateAt(7200)));
  envelope.version = 1;
  delete envelope.state.killAltitudeTicks;
  envelope.state.killBandTicks = [7200, 7200, -1];
  envelope.state.metrics.multibandWithinFive = 2;
  envelope.state.metrics.bandsKilled = 0b011;
  delete envelope.state.metrics.heightSpreadWithinFive;
  delete envelope.state.metrics.verticalKills;
  envelope.state.profile.metrics.multibandWithinFive = 2;
  envelope.state.profile.metrics.bandsKilled = 0b011;
  delete envelope.state.profile.metrics.heightSpreadWithinFive;
  delete envelope.state.profile.metrics.verticalKills;
  envelope.state.bills.active = { id: 'first-levy', startedAt: 7200, deadline: 9600, progress: 2,
    unharmedTicks: 0, bandKills: [1, 1, 0] };

  const restored = decodeCheckpoint(JSON.stringify(envelope), () => 35);
  assert.equal(restored.metrics.heightSpreadWithinFive, 2);
  assert.equal(restored.profile.metrics.verticalKills, 2);
  assert.equal(restored.bills.active.progress, 2);
  assert.deepEqual(restored.killAltitudeTicks, [{ tick: 7200, alt: 75 }, { tick: 7200, alt: 125 }]);
  assert.equal(restored.bills.paid, 0);
});

test('a legacy checkpoint migrates combat runtime without replaying elapsed introductions', () => {
  const envelope = JSON.parse(encodeCheckpoint(stateAt(240 * 60)));
  delete envelope.state.threatBudget;
  delete envelope.state.midbossSchedule;
  delete envelope.state.phaseDirector;
  delete envelope.state.phaseRepairMask;
  const restored = decodeCheckpoint(JSON.stringify(envelope), ground);
  assert.ok(restored.threatBudget);
  assert.equal(restored.midbossSchedule.next, 1);
  assert.equal(restored.phaseDirector.intro, 2);
  assert.deepEqual(restored.phaseRepairMask, 3);

  const spend = offset => trySpendThreat(restored, {
    tick: restored.tick + offset, source: `resumed:${offset}`, points: 2, bearing: 0,
  });
  assert.equal(spend(60), true);
  assert.equal(spend(120), true);
  assert.equal(spend(180), true);
  assert.equal(spend(240), false);

  const nextId = restored.nextId;
  stepStage(restored, {}, ground);
  assert.equal(restored.phaseDirector.intro, 2);
  assert.equal(restored.enemies.some(enemy => enemy.id > nextId && enemy.directorIntro), false);
});
