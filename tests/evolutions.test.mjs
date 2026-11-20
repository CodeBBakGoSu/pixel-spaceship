import test from 'node:test';
import assert from 'node:assert/strict';
import { EVOLUTIONS, WEAPON_IDS } from '../src/data/items.ts';
import { availableEvolutions, createProgression, evolveWeapon, rollBonusUpgrade } from '../src/progression.ts';
import { familyBonus, weaponCooldown, weaponDamage } from '../src/loadout.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';

const start = () => createStage(parseStageOptions('?t=0&mode=survivors&seed=9'));

test('each recipe requires its own max-level weapon and paired buff and evolves once in its existing slot', () => {
  for (const weapon of WEAPON_IDS) {
    const run = createProgression(9);
    const { buff, id } = EVOLUTIONS[weapon];
    run.weaponLevels = { [weapon]: 4 };
    run.buffLevels[buff] = 3;
    assert.equal(evolveWeapon(run, weapon), null);
    run.weaponLevels[weapon] = 5;
    run.buffLevels = {};
    assert.deepEqual(availableEvolutions(run), []);
    run.buffLevels[buff] = 1;
    assert.deepEqual(availableEvolutions(run), [weapon]);
    assert.equal(evolveWeapon(run, weapon), id);
    assert.deepEqual(run.weaponLevels, { [weapon]: 5 });
    assert.equal(run.buffLevels[buff], 1);
    assert.equal(evolveWeapon(run, weapon), null);
  }
});

test('family bonuses use the strongest tier independently and apply in any view', () => {
  const state = start();
  state.run.weaponLevels = { twin: 1, pods: 1, rail: 1, ion: 1 };
  assert.equal(weaponDamage(state, 'twin', 1), 1.15);
  assert.equal(weaponDamage(state, 'rail', 1), 1.15);
  assert.equal(weaponDamage(state, 'seeker', 1), 1);
  state.run.weaponLevels = { twin: 1, pods: 1, flak: 1 };
  assert.deepEqual(familyBonus(state, 'twin'), { count: 3, damageScale: 1.3, pierce: 1 });
  state.run.weaponLevels = { rail: 1, ion: 1, drones: 1, arc: 1 };
  const results = ['overhead', 'chase', 'cockpit'].map(view => {
    state.view = view;
    return [weaponDamage(state, 'arc', 1), weaponCooldown(state, 'arc', 100)];
  });
  assert.deepEqual(results, [[1.45, 90], [1.45, 90], [1.45, 90]]);
});

test('bonus upgrades consume only their named RNG and do not spend XP or a draft', () => {
  const first = start(), second = start();
  const priorDraft = first.run.draftRng.rng, priorSpawn = first.streams.spawn.rng;
  const a = rollBonusUpgrade(first.run, first.streams.chest);
  const b = rollBonusUpgrade(second.run, second.streams.chest);
  assert.deepEqual(a, b);
  assert.equal(first.run.draftRng.rng, priorDraft);
  assert.equal(first.streams.spawn.rng, priorSpawn);
  assert.equal(first.level, 1);
  assert.equal(first.run.draftsResolved, 0);
  assert.equal(first.run.weaponLevels.twin, 2);
});

test('only the two evolution crates evolve a valid recipe and the modal freezes active ticks', () => {
  const state = start();
  state.tick = 60 * 205;
  state.run.weaponLevels.twin = 5;
  state.run.buffLevels['overdrive-coil'] = 1;
  state.phase = 'chest';
  state.chests.offer = 'coast-supply';
  const tick = state.tick;
  stepStage(state, { chestPick: 'twin', climb: 1 });
  assert.equal(state.chestReveal, null);
  stepStage(state, { chestPick: 'open' });
  assert.ok([1, 3, 5].includes(state.chestReveal.length));
  assert.equal(state.run.evolutions.twin, undefined);
  stepStage(state, { chestPick: 'continue' });
  state.phase = 'chest';
  state.chests.offer = 'first-evolution';
  stepStage(state, { chestPick: 'twin' });
  assert.equal(state.run.evolutions.twin, 'aurora-gatling');
  assert.equal(state.chestReveal[0].id, 'aurora-gatling');
  assert.ok([2, 3].includes(state.chestReveal.length));
  stepStage(state, { chestPick: 'continue' });
  assert.equal(state.chests.opened, 2);
  assert.equal(state.tick, tick);
  assert.equal(state.phase, 'playing');
});
