import test from 'node:test';
import assert from 'node:assert/strict';
import { GNAT, PHASES, RUN_BOSS_SECONDS, RUN_END_SECONDS, SWARM_CAPS, phaseAt } from '../src/data/phases.ts';
import { spawnSwarm } from '../src/swarm.ts';
import { SPAWN_WORLD } from '../src/data/world.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { makeEnemy, advanceEnemies, spawnEscortGnats } from '../src/stage-enemies.ts';
import { advancePhaseSpawns, trimEscorts } from '../src/spawn-director.ts';

const ground = () => 35;
const ticks = seconds => seconds * 60;
const waveState = (seed = 27, swarmCap = SWARM_CAPS.desktop) =>
  createStage(parseStageOptions(`?mode=survivors&t=0&seed=${seed}&touch=${swarmCap === SWARM_CAPS.mobile ? 1 : 0}`), ground);
const gnats = state => state.enemies.filter(enemy => enemy.kind === 'gnat');
const spawnAt = (state, seconds, terrain = ground) => {
  state.tick = ticks(seconds);
  advancePhaseSpawns(state, terrain);
};

test('phase boundaries keep the Ace arrival at 8:00 and timeout at 10:00', () => {
  assert.equal(RUN_BOSS_SECONDS, 480);
  assert.equal(RUN_END_SECONDS, 600);
  for (const [index, second] of [0, 120, 240, 360, 480].entries()) {
    assert.equal(phaseAt(second), PHASES[index]);
    if (index) assert.equal(phaseAt(second - 1 / 60), PHASES[index - 1]);
  }
});

test('scheduled air traffic increases in every phase through the Ace fight', () => {
  const state = waveState();
  let previousRegular = 0, previousGnats = 0, previousPack = 0, previousCap = 0;
  for (const phase of PHASES) {
    let regular = 0, swarm = 0, largestPack = 0;
    for (state.tick = ticks(phase.starts); state.tick < ticks(phase.ends); state.tick++) {
      advancePhaseSpawns(state, ground);
      const pack = gnats(state).length;
      swarm += pack;
      regular += state.enemies.length - pack;
      largestPack = Math.max(largestPack, pack);
      state.enemies.length = 0;
    }
    assert.ok(swarm >= phase.gnatsPerMinute * 2, `${phase.id} scheduled traffic plus floor top-ups`);
    assert.ok(regular > 0, `${phase.id} regular traffic`);
    assert.ok(phase.regularPerMinute > previousRegular, `${phase.id} regular spawn budget`);
    assert.ok(swarm > previousGnats, `${phase.id} swarm traffic`);
    assert.ok(largestPack > previousPack, `${phase.id} pack size`);
    assert.ok(phase.regularCap > previousCap, `${phase.id} regular cap`);
    previousRegular = phase.regularPerMinute;
    previousGnats = swarm;
    previousPack = largestPack;
    previousCap = phase.regularCap;
  }
});

test('the first Gnat formation approaches at the coast start beat', () => {
  const state = waveState();
  spawnAt(state, PHASES[0].gnatStart - 1 / 60);
  assert.equal(gnats(state).length, 0);
  spawnAt(state, PHASES[0].gnatStart);
  assert.ok(gnats(state).length >= 4);
  assert.ok(gnats(state).every(enemy => enemy.hp === 1 && enemy.entry));
  for (let i = 0; i < gnats(state).length; i += PHASES[0].packSize) {
    assert.equal(new Set(gnats(state).slice(i, i + PHASES[0].packSize).map(enemy => enemy.band)).size, 1);
  }
  assert.equal(new Set(gnats(state).map(enemy => JSON.stringify(enemy.entry.target))).size, gnats(state).length);
});

test('swarm caps are independent of the regular enemy cap', () => {
  for (const cap of Object.values(SWARM_CAPS)) {
    const state = waveState(27, cap);
    for (let i = 0; i < cap - 1; i++) state.enemies.push(makeEnemy(state, 0, -200, 1, 'gnat'));
    state.tick = ticks(PHASES[0].gnatStart);
    const samples = [];
    advancePhaseSpawns(state, ground, (...sample) => samples.push(sample));
    assert.deepEqual(samples, [[cap, cap, true]]);
    assert.equal(gnats(state).length, cap);
    spawnAt(state, 0.5);
    assert.equal(state.enemies.filter(enemy => enemy.kind === 'patrol').length, 2);
  }
});

test('regular placements, the cap and draft randomness cannot desynchronize future spawn beats', () => {
  const first = waveState();
  const second = waveState(27, SWARM_CAPS.mobile);
  second.run.draftRng.rng = 12345;
  second.rng = 99;
  second.streams.combat.rng = 17;
  for (let i = 0; i < SWARM_CAPS.mobile; i++) second.enemies.push(makeEnemy(second, 0, -200, 1, 'gnat'));
  for (const seconds of [0.5, 1.5, 7.5, 45, 120, 240, 360, 480]) {
    spawnAt(first, seconds);
    spawnAt(second, seconds, () => 130);
    assert.equal(first.streams.spawn.rng, second.streams.spawn.rng, `spawn RNG at ${seconds}s`);
  }
  assert.equal(first.rng, 27);
  assert.equal(second.rng, 99);
});

test('phases reserve their final fifteen seconds for the lull', () => {
  for (const seconds of [105, 225, 345, 465]) {
    const state = waveState();
    const before = state.streams.spawn.rng;
    for (let tick = ticks(seconds); tick < ticks(seconds + 15); tick++) {
      state.tick = tick;
      advancePhaseSpawns(state, ground);
    }
    assert.deepEqual(state.enemies, []);
    assert.equal(state.streams.spawn.rng, before);
  }
});

test('the Ace escort limit trims regulars without removing Gnats', () => {
  const state = waveState();
  const limit = phaseAt(RUN_BOSS_SECONDS).regularCap;
  for (let i = 0; i < limit + 4; i++) state.enemies.push(makeEnemy(state, i, 100, 1, 'patrol'));
  for (let i = 0; i < state.swarmCap; i++) state.enemies.push(makeEnemy(state, i, 140, 1, 'gnat'));
  state.tick = ticks(RUN_BOSS_SECONDS);
  trimEscorts(state);
  assert.equal(gnats(state).length, state.swarmCap);
  assert.equal(state.enemies.length, state.swarmCap + limit);
});

test('engaged wave Gnats pursue indefinitely without attacks', () => {
  const state = waveState();
  spawnAt(state, PHASES[0].gnatStart);
  const [gnat] = gnats(state);
  const { target, arriveAt } = gnat.entry;
  state.tick = arriveAt;
  advanceEnemies(state, ground);
  assert.ok(!gnat.entry);
  assert.equal(gnat.alt, target.alt);
  state.tick++;
  advanceEnemies(state, ground);
  assert.notDeepEqual([gnat.x, gnat.z], [target.x, target.z]);
  assert.equal(gnat.alt, target.alt);
  state.tick += ticks(30);
  advanceEnemies(state, ground);
  assert.equal(gnat.leaveAt, undefined);
  assert.equal(gnat.hp, 1);
  assert.equal(gnat.shotDown, false);
  assert.deepEqual(state.shots, []);
  assert.deepEqual(state.pickups, []);
});

test('horde capacity and floors preserve the original regular traffic', () => {
  assert.deepEqual(SWARM_CAPS, { desktop: 200, mobile: 120 });
  assert.deepEqual(PHASES.map(phase => phase.regularCap), [8, 16, 26, 30, 34]);
  assert.deepEqual(PHASES.map(phase => phase.regularPerMinute), [14, 16, 19, 23, 28]);
  assert.deepEqual(PHASES.map(phase => phase.gnatFloor), [22, 44, 84, 130, 166]);
});

test('distant wave Gnats recycle ahead of travel, terrain-safe in the same band without RNG', () => {
  const state = waveState();
  Object.assign(state.player, { x: 0, z: 0, yaw: 0, vx: 100, vz: 0 });
  const enemy = makeEnemy(state, -SPAWN_WORLD.recycleDistance * 2, 0, 1, 'gnat');
  state.enemies.push(enemy);
  const copy = structuredClone(state);
  const rng = JSON.stringify(state.streams);
  const terrain = (x, z) => z < 0 ? 1000 : 35;
  advanceEnemies(state, terrain);
  advanceEnemies(copy, terrain);
  assert.deepEqual(state, copy);
  assert.equal(JSON.stringify(state.streams), rng);
  assert.ok(enemy.x > 0, 'ahead of velocity, not the ship heading');
  assert.ok(enemy.z >= 0, 'unsafe sites skipped');
  assert.ok(Math.hypot(enemy.x, enemy.z) < SPAWN_WORLD.recycleDistance);
  assert.equal(enemy.band, 1);
  assert.ok(terrain(enemy.x, enemy.z) + GNAT.clearance <= enemy.alt);
  assert.equal(enemy.hp, 1);
  assert.equal(enemy.leaveAt, undefined);
});

test('failed recycling retains a living Gnat and retries rather than placing it in terrain', () => {
  const state = waveState();
  const enemy = makeEnemy(state, -SPAWN_WORLD.recycleDistance * 2, 0, 1, 'gnat');
  state.enemies.push(enemy);
  const start = { x: enemy.x, z: enemy.z };
  advanceEnemies(state, x => x < -1000 ? 35 : 1000);
  assert.equal(enemy.hp, 1);
  assert.deepEqual({ x: enemy.x, z: enemy.z }, start);
  state.tick += ticks(1);
  for (let i = 0; i < 60; i++) advanceEnemies(state, ground);
  assert.ok(Math.hypot(enemy.x, enemy.z) < SPAWN_WORLD.recycleDistance);
  const empty = waveState();
  advanceEnemies(empty, ground);
  assert.deepEqual(empty.enemies, []);
});

test('over-cap cleanup removes distant and behind Gnats first without kills or XP', () => {
  const state = waveState();
  state.tick = 601;
  state.swarmCap = 2;
  state.run.weaponLevels = {};
  const near = makeEnemy(state, 0, 50, 1, 'gnat');
  const ahead = makeEnemy(state, 0, SPAWN_WORLD.recycleDistance * 2, 1, 'gnat');
  const behind = makeEnemy(state, 0, -SPAWN_WORLD.recycleDistance * 2, 1, 'gnat');
  const middle = makeEnemy(state, 0, 200, 1, 'gnat');
  state.enemies.push(near, ahead, behind, middle);
  stepStage(state, {}, ground);
  assert.deepEqual(gnats(state).map(enemy => enemy.id), [near.id, middle.id]);
  assert.equal(state.kills, 0);
  assert.equal(state.xp, 0);
  assert.deepEqual(state.pickups, []);
});

test('bomber escort Gnats retain their expiry instead of recycling', () => {
  const state = waveState();
  spawnEscortGnats(state, { x: 0, z: 0, alt: 125, band: 1 }, ground, 3);
  const [enemy] = gnats(state);
  assert.ok(enemy.leaveAt > state.tick);
  state.tick = enemy.leaveAt;
  enemy.x = SPAWN_WORLD.recycleDistance * 2;
  advanceEnemies(state, ground);
  assert.equal(enemy.hp, 0);
  assert.equal(enemy.shotDown, false);
});

test('encirclement spreads one pack around the projected pilot and skips unsafe bearings', () => {
  const phase = { ...PHASES[2], formations: ['encircle'], bands: [1] };
  const spawn = terrain => {
    const state = waveState();
    spawnSwarm(state, phase, 28, terrain, { rng: 27 });
    return state;
  };
  const state = spawn(ground);
  const sites = gnats(state).map(enemy => enemy.entry.target);
  assert.equal(sites.length, 28);
  const center = sites.reduce((p, site) => ({ x: p.x + site.x / sites.length, z: p.z + site.z / sites.length }), { x: 0, z: 0 });
  assert.ok(Math.abs(center.x - state.player.x) < 1e-6);
  for (const site of sites) assert.ok(Math.abs(Math.hypot(site.x - center.x, site.z - center.z) - GNAT.range) < 1e-6);
  const blocked = spawn((x, z) => x > center.x ? 1000 : ground(x, z));
  assert.equal(gnats(blocked).length, 14);
  assert.ok(gnats(blocked).every(enemy => enemy.entry.target.x <= center.x));
  assert.deepEqual(gnats(spawn(() => 1000)), []);
  const empty = waveState();
  spawnSwarm(empty, phase, 0, ground, { rng: 27 });
  assert.deepEqual(empty.enemies, []);
});

test('wave Gnats leave fly-in aimed at the current pilot and steer when the pilot moves', () => {
  const state = waveState();
  spawnAt(state, PHASES[0].gnatStart);
  const [enemy] = gnats(state);
  state.tick = enemy.entry.arriveAt;
  state.player.x = enemy.entry.target.x + 200;
  state.player.z = enemy.entry.target.z;
  advanceEnemies(state, ground);
  assert.ok(enemy.vx > 0);
  assert.ok(Math.abs(enemy.vz) < 1e-6);
  assert.ok(Math.abs(Math.hypot(enemy.vx, enemy.vz) - GNAT.speed) < 1e-6);
  state.player.z += 300;
  state.tick++;
  advanceEnemies(state, ground);
  assert.ok(enemy.vz > 0);
});

test('floor top-ups are pack-limited, count only live Gnats, and wait for the next second', () => {
  const state = waveState();
  state.enemies.push(makeEnemy(state, 0, 200, 1, 'patrol'));
  const dead = makeEnemy(state, 0, 200, 1, 'gnat');
  dead.hp = 0;
  state.enemies.push(dead);
  spawnAt(state, 21);
  assert.equal(gnats(state).filter(enemy => enemy.hp > 0).length, PHASES[0].packSize);
  spawnAt(state, 21 + 1 / 60);
  assert.equal(gnats(state).filter(enemy => enemy.hp > 0).length, PHASES[0].packSize);
  spawnAt(state, 22);
  assert.equal(gnats(state).filter(enemy => enemy.hp > 0).length, PHASES[0].packSize * 2);
});

test('floor top-ups scale by swarm capacity and stop at the deficit', () => {
  for (const cap of Object.values(SWARM_CAPS)) {
    const state = waveState(27, cap);
    const floor = Math.floor(PHASES[0].gnatFloor * cap / SWARM_CAPS.desktop);
    for (let i = 0; i < floor - 3; i++) state.enemies.push(makeEnemy(state, 0, 200, 1, 'gnat'));
    spawnAt(state, 21);
    assert.equal(gnats(state).length, floor);
    spawnAt(state, 22);
    assert.equal(gnats(state).length, floor);
    state.enemies.length = 0;
    spawnAt(state, 23, () => 1000);
    assert.equal(gnats(state).length, 0);
  }
});
