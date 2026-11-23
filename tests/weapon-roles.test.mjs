import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAce } from '../src/ace.ts';
import { BANDS, acquireAndFire, advanceShots } from '../src/stage-combat.ts';
import { makeGnat } from '../src/stage-enemies.ts';
import { advanceRangedWeapons } from '../src/ranged-weapons.ts';
import { scaleTravel } from '../src/data/speed.ts';
import { createStage, parseStageOptions } from '../src/stage.ts';
import { createComparisonState, runComparison } from '../tools/weapon-roles.mjs';

const ground = () => 35;

function addGnat(state, x, z, band = 1, variant) {
  const target = makeGnat(state, x, z, band, variant);
  state.enemies.push(target);
  return target;
}

function addAce(state, z = 120) {
  const ace = makeAce(state, 0, z, ground);
  state.boss = ace;
  state.lock = { id: ace.id, progress: 1, ready: true };
  return ace;
}

function seekerState() {
  return createComparisonState('seeker');
}

test('the fixed-seed comparison is deterministic and exposes bounded, isolated scenes', () => {
  const first = runComparison();
  assert.deepEqual(runComparison(), first);
  assert.equal(first.fixedSetup.seed, 23);
  assert.equal(first.fixedSetup.ticks, 900);
  assert.equal(first.fixedSetup.weaponLevel, 4);
  assert.equal(first.fixedSetup.altitude.value, BANDS[1]);
  assert.deepEqual(first.fixedSetup.buffs, []);
  assert.deepEqual(first.fixedSetup.evolutions, []);
  assert.equal(first.fixedSetup.damageUpgrades, 0);
  assert.equal(first.fixedSetup.overdrive, false);
  assert.equal(first.fixedSetup.manualWeapons, false);
  assert.deepEqual(first.fixedSetup.pilot, { x: 0, z: 0, yaw: 0, userInput: false });
  assert.equal(first.scenarios.forwardGnatColumn.scene.count, 30);
  assert.equal(first.scenarios.forwardGnatColumn.scene.firstZ, 120);
  assert.equal(first.scenarios.forwardGnatColumn.scene.spacing, 20);
  assert.equal(first.scenarios.forwardGnatColumn.scene.lastZ, 700);
  assert.equal(first.scenarios.sideStingApproach.scene.count, 30);
  assert.equal(first.scenarios.sideStingApproach.scene.perSide, 15);
  assert.equal(first.scenarios.sideStingApproach.scene.firstAbsX, 120);
  assert.equal(first.scenarios.sideStingApproach.scene.lastAbsX, 400);
  assert.equal(first.scenarios.sideStingApproach.scene.removeAfterCenterCrossing, true);
  for (const scenario of Object.values(first.scenarios)) {
    for (const [weapon, result] of Object.entries(scenario.results)) {
      assert.equal(result.setup.seed, 23);
      assert.equal(result.setup.selectedWeapon, weapon);
      assert.equal(result.setup.weaponLevel, 4);
      assert.deepEqual(result.setup.activeWeapons, [weapon]);
      assert.deepEqual(result.setup.activeBuffLevels, []);
      assert.deepEqual(result.setup.evolutions, []);
      assert.equal(result.setup.damageUpgrades, 0);
      assert.equal(result.setup.overdrive, false);
      assert.equal(result.setup.manualWeapons, false);
      assert.equal(result.setup.playerLockReady, scenario === first.scenarios.lockedAce);
      assert.ok(result.firedProjectiles >= 0);
      assert.ok(result.targetAvailability.scheduled >= 1);
      assert.ok(Array.isArray(result.acquisition.selectedTargetIds));
      if (result.firedProjectiles > 0) assert.ok(result.acquisition.selectedTargetIds.length > 0);
    }
  }
  for (const verdict of Object.values(first.scenarios).map(scenario => scenario.verdict)) {
    assert.equal(typeof verdict.meetsCriterion, 'boolean');
    assert.equal(verdict.status, verdict.meetsCriterion ? 'MET' : 'NOT MET');
  }
  for (const result of Object.values(first.scenarios.lockedAce.results)) {
    const { initialHp, remainingHp, hpDamage, actualHitCount, damagePerFiredShot, damagePerAceHit } = result.outcome;
    assert.equal(hpDamage, initialHp - remainingHp);
    assert.ok(actualHitCount <= result.firedProjectiles);
    assert.equal(damagePerFiredShot, result.firedProjectiles ? hpDamage / result.firedProjectiles : 0);
    assert.equal(damagePerAceHit, actualHitCount ? hpDamage / actualHitCount : null);
  }
});

test('Twin fires forward at an eligible target and fires after turning toward the same target', () => {
  const state = createComparisonState('twin');
  addGnat(state, 60, 0);
  acquireAndFire(state);
  assert.equal(state.shots.filter(shot => shot.kind === 'twin').length, 0);
  state.player.yaw = Math.PI / 2;
  acquireAndFire(state);
  assert.ok(state.shots.some(shot => shot.kind === 'twin'));
});

test('Pods acquire left and right same-band targets independently, not a forward target', () => {
  for (const side of [-1, 1]) {
    const state = createComparisonState('pods');
    addGnat(state, side * 60, 0);
    acquireAndFire(state);
    assert.ok(state.shots.some(shot => shot.kind === 'pods'));
  }

  const bothSides = createComparisonState('pods');
  addGnat(bothSides, -60, 0);
  addGnat(bothSides, 60, 0);
  const acquisitionTick = bothSides.tick;
  acquireAndFire(bothSides);
  const bilateralShots = bothSides.shots.filter(shot => shot.kind === 'pods');
  assert.equal(bothSides.tick, acquisitionTick);
  assert.ok(bilateralShots.some(shot => shot.vx < 0));
  assert.ok(bilateralShots.some(shot => shot.vx > 0));

  const front = createComparisonState('pods');
  addGnat(front, 0, 60);
  acquireAndFire(front);
  assert.equal(front.shots.filter(shot => shot.kind === 'pods').length, 0);

  const otherBand = createComparisonState('pods');
  addGnat(otherBand, -60, 0, 2);
  acquireAndFire(otherBand);
  assert.ok(otherBand.shots.every(shot => shot.kind !== 'pods'));
});

test('Seeker assigns a ready Ace priority over an available regular target', () => {
  const state = seekerState();
  const ace = addAce(state);
  addGnat(state, 0, 80);
  advanceRangedWeapons(state, ground);
  assert.ok(state.shots.length > 0);
  assert.ok(state.shots.every(shot => shot.kind === 'seeker' && shot.targetId === ace.id && shot.lockId === ace.id));
});

test('Seeker does not select an Ace without ready lock or beyond range', () => {
  const unlocked = seekerState();
  const unlockedAce = addAce(unlocked);
  unlocked.lock = null;
  const regular = addGnat(unlocked, 0, 80);
  advanceRangedWeapons(unlocked, ground);
  assert.ok(unlocked.shots.length > 0);
  assert.ok(unlocked.shots.every(shot => shot.targetId === regular.id && shot.targetId !== unlockedAce.id));

  const outOfRange = seekerState();
  const distantAce = addAce(outOfRange, scaleTravel(200));
  const nearby = addGnat(outOfRange, 0, 80);
  advanceRangedWeapons(outOfRange, ground);
  assert.ok(outOfRange.shots.length > 0);
  assert.ok(outOfRange.shots.every(shot => shot.targetId === nearby.id && shot.targetId !== distantAce.id));

  const onlyDistantAce = seekerState();
  addAce(onlyDistantAce, scaleTravel(200));
  advanceRangedWeapons(onlyDistantAce, ground);
  assert.equal(onlyDistantAce.shots.length, 0);
});

test('Seeker launches no new Ace volley after lock loss while an in-flight missile continues', () => {
  const state = seekerState();
  const ace = addAce(state);
  advanceRangedWeapons(state, ground);
  const launched = [...state.shots];
  assert.ok(launched.length > 0);
  assert.ok(launched.every(shot => shot.targetId === ace.id));
  const firstZ = launched[0].z;

  state.lock = null;
  state.tick = state.weaponFireAt.seeker;
  advanceRangedWeapons(state, ground);
  assert.equal(state.shots.length, launched.length);
  advanceShots(state, ground);
  assert.ok(launched[0].z > firstZ);
  assert.equal(launched[0].targetId, ace.id);
});

test('the Ace comparison uses the real max-HP vulnerable Ace fixture', () => {
  const state = createStage(parseStageOptions('?mode=survivors&t=0&seed=23&heat=0'), ground);
  state.player.altitude = BANDS[1];
  assert.equal(state.enemies.length, 0);
  const ace = addAce(state);
  assert.equal(state.enemies.length, 0);
  assert.equal(ace.hp, ace.maxHp);
  assert.ok(ace.maxHp > 0);
  assert.equal(ace.entry, undefined);
  assert.equal(ace.roll, null);
  assert.equal(state.lock?.ready, true);
});

test('the comparison state rejects an unsupported weapon', () => {
  assert.throws(() => createComparisonState('rail'), RangeError);
});
