import assert from 'node:assert/strict';
import test from 'node:test';
import { BILLS, CHESTS } from '../src/data/items.ts';
import { SWARM_CAPS, SWARM_EVENT, SWARM_EVENTS, swarmWindowAt } from '../src/data/phases.ts';
import { advanceEnemies, makeEnemy, spawnEscortGnats } from '../src/stage-enemies.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { advanceSwarmEvent } from '../src/swarm-events.ts';
import { decodeCheckpoint, encodeCheckpoint } from '../src/checkpoint.ts';
import { rngStream } from '../src/stage-random.ts';

const flat = () => 35;
const start = (mode = 'survivors') => {
  const state = createStage(parseStageOptions(`?mode=${mode}&seed=42&t=0`), flat);
  state.bills.next = BILLS.length;
  state.chests.next = CHESTS.length;
  if (state.run) state.run.weaponLevels = {};
  return state;
};
const fleet = state => state.enemies.filter(e => e.hp > 0 && e.eventFlight);
const orb = (state, alt, xp = 1) => ({ id: ++state.nextId, x: 20000, z: -30000, born: state.tick, alt, xp });

test('fixed swarm/rest windows avoid live Bills and leave five seconds before the next offer', () => {
  assert.deepEqual(SWARM_EVENTS.map(e => [e.start, e.kind, e.duration]), [
    [110, 'ring', 15], [315, 'ring', 10],
  ]);
  for (const e of SWARM_EVENTS) {
    const end = e.start + e.duration + 15;
    assert.equal(swarmWindowAt(e.start - 1 / 60), undefined);
    assert.equal(swarmWindowAt(end - 1 / 60), e);
    assert.equal(swarmWindowAt(end), undefined);
    for (const bill of BILLS) assert.ok(e.start > bill.second + bill.duration || end + 5 <= bill.second);
    for (const chest of CHESTS) assert.ok(e.start > chest.second || end + 5 <= chest.second);
  }
});

test('rings surround the pilot, open an adjacent band and contract without filling the escape route', () => {
  for (const altitude of [75, 125, 180]) {
    const state = start(), p = state.player;
    Object.assign(p, { x: 95, z: -110, yaw: 0.7, altitude, vx: 0, vz: 0 });
    for (let i = 0; i < SWARM_CAPS.desktop; i++) state.enemies.push(makeEnemy(state, 0, i, i % 3, 'gnat'));
    const regular = makeEnemy(state, 200, 300, 2, 'patrol');
    state.enemies.push(regular);
    state.tick = 110 * 60;
    advanceSwarmEvent(state, flat);
    const open = state.swarmNotice.band, ring = fleet(state);
    assert.equal(ring.length, SWARM_EVENT.ringSize);
    assert.equal(new Set(ring.map(e => e.band)).size, 2);
    assert.ok(state.enemies.every(e => e.kind !== 'gnat' || e.band !== open));
    assert.ok(state.enemies.includes(regular));
    assert.deepEqual([state.kills, state.xp, state.pickups.length], [0, 0, 0]);
    assert.ok(ring.every(e => Math.abs(Math.hypot(e.x - p.x, e.z - p.z) - SWARM_EVENT.ringRadius) < 1e-6));
    assert.ok(new Set(ring.map(e => Math.floor((Math.atan2(e.x - p.x, e.z - p.z) + Math.PI) * 4 / Math.PI))).size >= 8);
    advanceEnemies(state, flat);
    assert.ok(ring.every(e => Math.hypot(e.x - p.x, e.z - p.z) < SWARM_EVENT.ringRadius));
  }
});

test('minute swarm events remain rings and do not mutate spawn streams', () => {
  for (const event of SWARM_EVENTS) {
    const state = start();
    state.tick = event.start * 60;
    const before = structuredClone(state.streams);
    advanceSwarmEvent(state, flat);
    assert.deepEqual(state.streams, before);
    assert.equal(fleet(state).length, SWARM_EVENT.ringSize);
    assert.equal(state.swarmNotice.kind, 'ring');
  }
});

test('Survivors rest never pulls or collects pickups and leaves chest drops untouched', () => {
  for (const event of SWARM_EVENTS) {
    const state = start();
    state.tick = (event.start + event.duration) * 60 - 1;
    const high = orb(state, 180, 2), low = orb(state, 75);
    state.pickups.push(high, low);
    const drop = { ...orb(state, 180), id: 'first-evolution' };
    state.chests.drops.push(drop);
    stepStage(state, {}, flat);
    assert.equal(state.swarmNotice.kind, 'rest');
    assert.deepEqual(state.pickups, [high, low]);
    assert.equal(Boolean(high.pulling), false);
    assert.equal(Boolean(low.pulling), false);
    assert.deepEqual([state.metrics.orbs, state.salvage, state.xp], [0, 0, 0]);
    const late = orb(state, 180);
    state.pickups.push(late);
    const rng = state.streams.spawn.rng;
    for (let tick = 1; tick < 15 * 60; tick++) stepStage(state, { climb: 0.3 }, flat);
    assert.equal(state.streams.spawn.rng, rng);
    spawnEscortGnats(state, { x: 0, z: 0, alt: 125, band: 1 }, flat, 10);
    assert.deepEqual(state.enemies, []);
    assert.deepEqual(state.pickups, [high, low, late]);
    assert.equal(late.recovery, undefined);
    assert.deepEqual(state.chests.drops, [drop]);
    assert.deepEqual([state.metrics.orbs, state.salvage, state.xp], [0, 0, 0]);
    stepStage(state, {}, flat);
    assert.equal(state.swarmNotice, undefined);
  }
});

test('legacy recovery still couples its notice to recent pickup recovery', () => {
  const state = start('legacy');
  const event = SWARM_EVENTS[0];
  state.tick = (event.start + event.duration) * 60;
  const pickup = orb(state, 180);
  state.pickups.push(pickup);
  assert.equal(advanceSwarmEvent(state, flat), true);
  assert.equal(state.swarmNotice?.kind, 'recovery');
  assert.equal(pickup.pulling, true);
  assert.ok(pickup.recovery);
});

test('full pickup pool remains ordinary salvage at a wave end', () => {
  const state = start();
  state.tick = 125 * 60 - 1;
  for (let i = 0; i < 150; i++) state.pickups.push(orb(state, 180));
  stepStage(state, {}, flat);
  assert.equal(state.pickups.length, 150);
  assert.ok(state.pickups.every(p => !p.recovery && !p.capture));
  assert.equal(state.salvage, 0);
});

test('legacy checkpoints seed the isolated magnet-drop stream deterministically', () => {
  const state = start();
  state.tick = 120 * 60;
  const encoded = encodeCheckpoint(state);
  const legacy = JSON.parse(encoded);
  delete legacy.state.streams.magnetDrop;
  const restored = decodeCheckpoint(JSON.stringify(legacy), flat);
  assert.equal(restored.streams.magnetDrop.rng, rngStream(state.seed, 'magnet-drop').rng);
});

test('pausing, leaving a chest uncollected, or resuming a phase checkpoint does not reschedule events', () => {
  const state = start();
  state.tick = 110 * 60 - 1;
  state.chests.drops.push({ ...orb(state, 180), id: 'coast-supply' });
  stepStage(state, { pause: true }, flat);
  stepStage(state, {}, flat);
  assert.equal(state.swarmNotice, undefined);
  stepStage(state, { pause: true }, flat);
  stepStage(state, {}, flat);
  assert.equal(state.swarmNotice.kind, 'ring');
  while (state.tick < 120 * 60) stepStage(state, {}, flat);
  const restored = decodeCheckpoint(encodeCheckpoint(state), flat);
  for (let tick = 0; tick < 6 * 60; tick++) {
    stepStage(state, {}, flat);
    stepStage(restored, {}, flat);
  }
  const { phaseDirector: restoredDirector, ...restoredState } = restored;
  const { phaseDirector: originalDirector, ...originalState } = state;
  assert.deepEqual(JSON.stringify(restoredState), JSON.stringify(originalState));
  assert.equal(restoredDirector.intro, originalDirector?.intro ?? 1);
  assert.equal(state.swarmNotice.kind, 'rest');
  const legacy = start('legacy');
  legacy.tick = 110 * 60 - 1;
  stepStage(legacy, {}, flat);
  assert.equal(legacy.swarmNotice, undefined);
  assert.deepEqual(fleet(legacy), []);
});
