import test from 'node:test';
import assert from 'node:assert/strict';
import { GNAT, PHASES, SWARM_CAPS, gnatVariantAt } from '../src/data/phases.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { advanceEnemies, makeGnat, spawnEscortGnats } from '../src/stage-enemies.ts';
import { hurtEnemy, hurtPlayer } from '../src/stage-combat.ts';
import { spawnSwarm } from '../src/swarm.ts';

const ground = () => 35;
const start = (mode = 'survivors') => createStage(parseStageOptions(`?mode=${mode}&t=0`), ground);

test('each phase replaces the designated shares of standard Gnats', () => {
  const shares = [[0, 0], [0, 10], [15, 10], [25, 15], [25, 20]];
  for (const [index, phase] of PHASES.entries()) {
    const rolls = Array.from({ length: 100 }, (_, i) => gnatVariantAt(phase, (i + 0.5) / 100));
    assert.deepEqual(['armored', 'sting'].map(v => rolls.filter(r => r === v).length), shares[index]);
    for (const cap of Object.values(SWARM_CAPS)) {
      const state = start();
      state.swarmCap = cap;
      const rng = { rng: 19 };
      for (let i = 0; i < cap; i += 10) spawnSwarm(state, phase, 12, ground, rng);
      assert.equal(state.enemies.length, cap);
      const seen = new Set(state.enemies.map(e => e.gnatVariant));
      assert.equal(seen.has('armored'), index >= 2);
      assert.equal(seen.has('sting'), index >= 1);
      assert.ok(state.enemies.every(e => e.kind === 'gnat' && e.hp === (e.gnatVariant === 'armored' ? 3 : 1)));
    }
  }
});

test('escort variants use the same gates without changing the Legacy escorts', () => {
  for (const mode of ['survivors', 'legacy']) {
    const state = start(mode);
    state.tick = PHASES.at(-1).starts * 60;
    spawnEscortGnats(state, { x: 0, z: 0, alt: 125, band: 1 }, ground, 40);
    const variants = new Set(state.enemies.map(e => e.gnatVariant));
    assert.equal(variants.size, mode === 'survivors' ? 3 : 1);
    assert.ok(variants.has(undefined));
    assert.ok(state.enemies.every(e => e.leaveAt === state.tick + GNAT.lifeSeconds * 60));
  }
});

test('only in-window Stings turn directly toward the pilot, without changing altitude', () => {
  for (const [variant, height, direct] of [['sting', 8, true], ['sting', -8, true], ['sting', 8.01, false],
    ['sting', -8.01, false], ['armored', 0, false], [undefined, 0, false]]) {
    const state = start(), p = state.player;
    const e = makeGnat(state, p.x - 100, p.z, 1, variant);
    p.altitude = e.alt + height;
    e.vz = GNAT.speed;
    state.enemies.push(e);
    advanceEnemies(state, ground);
    assert.equal(e.vz === 0 && e.vx === GNAT.speed, direct);
    assert.equal(e.alt, 125);
    assert.deepEqual(state.shots, []);
  }
});

test('Armored absorbs three base hits and drops 3 XP; Sting and standard drop 1', () => {
  for (const [variant, hp] of [['armored', 3], ['sting', 1], [undefined, 1]]) {
    const state = start();
    const e = makeGnat(state, state.player.x + 200, state.player.z, 1, variant);
    state.enemies.push(e);
    for (let remaining = hp; remaining > 0; remaining--) {
      assert.equal(e.hp, remaining);
      hurtEnemy(state, e, 1);
    }
    stepStage(state, {}, ground);
    assert.equal(state.kills, 1);
    assert.deepEqual(state.pickups.map(p => p.xp), [hp]);
  }
});

test('only same-altitude Sting contact costs hull, sharing the regular one-second hit window', () => {
  const state = start();
  state.run.weaponLevels = {};
  const add = (variant, delta = 0) => {
    const p = state.player, e = makeGnat(state, p.x, p.z, 1, variant);
    e.alt = p.altitude + delta;
    state.enemies.push(e);
  };
  const initial = state.hull;
  add('armored'); add(undefined); add('sting', -8.01); add('sting', 8.01);
  stepStage(state, {}, ground);
  assert.equal(state.hull, initial);
  add('sting', 8); add('sting', -8);
  stepStage(state, {}, ground);
  assert.deepEqual([state.hull, state.hitsTaken, state.invulnerability, state.kills], [initial - 1, 1, 1, 0]);
  for (let i = 0; i < 59; i++) stepStage(state, {}, ground);
  hurtPlayer(state);
  assert.equal(state.hull, initial - 1);
  stepStage(state, {}, ground);
  hurtPlayer(state);
  assert.equal(state.hull, initial - 4);
  add('sting');
  stepStage(state, {}, ground);
  assert.equal(state.hull, initial - 4);
});
