import test from 'node:test';
import assert from 'node:assert/strict';
import { activeAce, createStage, dropMagnet, endTick, parseStageOptions, stepStage } from '../src/stage.ts';
import { autopilotInput, seekStage } from '../src/autoplay.ts';
import { skimAltitude, SKIM_BAND } from '../src/bands.ts';
import { ROSTER } from '../src/data/roster.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { relativeMark } from '../src/instruments.ts';
import { World } from '../src/world.ts';

const world = new World();
const ground = (x, z) => world.height(x, z);
const stage = query => createStage(parseStageOptions(query), ground);
const run = (state, ticks, input = {}) => {
  for (let i = 0; i < ticks; i++) stepStage(state, input, ground);
  return state;
};

function atPlayer(state, alt, friendly = false) {
  return {
    x: state.player.x, z: state.player.z + 0.7, alt,
    vx: 0, vz: 0, life: 1, damage: 2, kind: friendly ? 'twin' : 'hostile',
    volley: 42, nearMiss: false, lockId: null,
  };
}

test('recovered salvage uses band midpoints and SKIM overrides altitude', () => {
  for (const [alt, skim, band] of [
    [99.99, false, 0], [100, false, 0], [100.01, false, 1],
    [152.49, false, 1], [152.5, false, 1], [152.51, false, 2],
    [180, true, 0],
  ]) {
    const state = stage('?autoplay=1');
    state.pickups = [{ id: 999, x: state.player.x, z: state.player.z, alt, skim, xp: 1, born: state.tick, collected: true }];
    run(state, 1);
    assert.deepEqual(state.salvageBands, [0, 1, 2].map(index => Number(index === band)));
    assert.equal(state.pickups.length, 0);
    run(state, 1);
    assert.equal(state.salvageBands.reduce((sum, value) => sum + value, 0), 1);
  }
});

test('the title launches a one-life sortie in cruise with both weapons', () => {
  const state = stage('?seed=22');
  assert.equal(state.phase, 'title');
  run(state, 1, { start: true });
  assert.equal(state.phase, 'playing');
  assert.equal(state.view, 'overhead');
  assert.equal(state.player.altitude, 125);
  assert.equal(state.hull, 8);
  assert.equal(state.boost, 1);
  assert.equal(state.rearBombs.length, 0);
  assert.equal(state.twinRank, 1);
  assert.equal(state.podRank, 1);
});

test('the stack fixture has the same planar contact at 75, 125 and 180 m in every view', () => {
  for (const view of ['overhead', 'chase', 'cockpit']) {
    const state = stage('?fixture=stack&view=' + view);
    assert.equal(state.tick, 30 * 60);
    assert.deepEqual(state.enemies.map(e => e.alt), [75, 125, 180]);
    assert.ok(state.enemies.every(e => e.x === state.enemies[0].x && e.z === state.enemies[0].z));
    for (let i = 0; i < 44 && !state.pickups.length; i++) run(state, 1);
    assert.deepEqual(state.enemies.map(e => e.alt), [75, 180]);
    assert.equal(state.pickups[0].alt, 125);
  }
});

test('a real-terrain Immelmann earns ACE WIPE from all six fixture pursuers', () => {
  const state = stage('?fixture=reversal');
  const original = state.enemies.filter(enemy => enemy.alt === 180).map(enemy => enemy.id);
  const lower = state.enemies.find(enemy => enemy.alt === 75);
  assert.equal(original.length, 6);
  run(state, 1, { maneuver: 'immelmann' });
  for (let i = 0; i < 120 && state.reversal?.streak !== 6; i++) run(state, 1);
  const pass = state.reversal;
  assert.ok(pass.burstAt >= pass.startTick);
  assert.equal(pass.streak, 6);
  assert.equal(pass.killTicks.length, 6);
  assert.ok(pass.killTicks.at(-1) - pass.killTicks[0] <= 21);
  assert.equal(pass.burstAt, pass.killTicks[2]);
  assert.deepEqual(pass.pursuers, [...original, lower.id]);
  assert.ok(state.tick - pass.startTick <= 60);
  assert.deepEqual(state.enemies.map(enemy => enemy.id), [lower.id]);
});

test('hit and miss feedback use the bolt launch height and emit one miss for a paired volley', () => {
  const state = stage('?fixture=stack');
  state.enemies = state.enemies.filter(enemy => enemy.alt === 180);
  run(state, 18);
  assert.equal(state.shots.filter(shot => shot.kind === 'twin').length, 0);
  assert.equal(state.altitudeHint.delta, 55);
  run(state, 1, { fire: true });
  assert.equal(state.shots.length, 0, 'legacy manual fire cannot bypass acquisition');
  state.enemies[0].alt = 125;
  run(state, 1);
  const bolts = state.shots.filter(shot => shot.kind === 'twin');
  assert.equal(bolts.length, 2);
  assert.ok(bolts.every(shot => shot.alt === 125));
  state.enemies[0].alt = 180;
  run(state, 25, { climb: 1 });
  assert.equal(state.enemies[0].hp, 2);
  assert.equal(state.effects.filter(effect => effect.kind === 'miss').length, 1);
  assert.equal(state.effects.find(effect => effect.kind === 'miss').delta, 55);
});

test('shot and body overlap only damage the player through the inclusive eight-metre window', () => {
  for (const offset of [8, 8.01, -8, -8.01]) {
    const state = stage('?fixture=stack');
    state.enemies = [];
    state.shots.push(atPlayer(state, 125 + offset));
    run(state, 1);
    assert.equal(state.hull, Math.abs(offset) <= 8 ? 6 : 8);
  }
  const state = stage('?fixture=stack');
  const enemy = state.enemies[0];
  enemy.x = state.player.x;
  enemy.z = state.player.z + 1;
  state.enemies = [enemy];
  run(state, 1);
  assert.equal(state.hull, 8);
  state.player.altitude = 75;
  run(state, 1);
  assert.equal(state.hull, 6);
});

test('salvage captures within the planar radius and arrives on its fixed deadline across altitude changes', () => {
  const state = stage('?mode=survivors&t=0');
  state.enemies = [];
  const { x, z } = state.player;
  state.pickups = [
    { id: 10, x, z: z + 60, alt: 75, xp: 2, born: state.tick },
    { id: 11, x: x + 100, z, alt: 180, xp: 3, born: state.tick },
  ];
  run(state, 1);
  const [captured, outside] = state.pickups;
  assert.equal(captured.pulling, false, 'the trail is hidden until the final capture segment');
  assert.ok(captured.capture);
  assert.ok(captured.capture.curve.amount > 0);
  assert.ok(captured.capture.arriveAtTick - captured.capture.capturedAtTick <= 36);
  assert.ok(captured.capture.arriveAtTick > state.tick);
  assert.equal(outside.capture, undefined);
  const deadline = captured.capture.arriveAtTick;
  state.player.altitude = 180;
  run(state, 3, { boost: true, turn: 1, climb: 1 });
  run(state, 3, { boost: true, turn: -1, climb: -1 });
  assert.equal(captured.capture.arriveAtTick, deadline);
  assert.ok(captured.alt > 75, 'the captured target follows current player altitude');
  const progress = (state.tick - captured.capture.capturedAtTick) / (deadline - captured.capture.capturedAtTick);
  const straightX = captured.capture.origin.x + (state.player.x - captured.capture.origin.x) * progress;
  const straightZ = captured.capture.origin.z + (state.player.z - captured.capture.origin.z) * progress;
  assert.ok(Math.hypot(captured.x - straightX, captured.z - straightZ) > 0.1, 'the path bends to a wing side');
  assert.equal(state.salvage, 0);
  while (state.tick < deadline) run(state, 1);
  assert.equal(state.xp, 2);
  assert.equal(state.salvage, 2);
  assert.equal(state.run.credits, 2);
  assert.equal(state.pickups.includes(captured), false);
  assert.equal(state.pickups.includes(outside), true);
});

test('global magnet captures only existing salvage and credits each orb at its hull-arrival deadline', () => {
  const state = stage('?mode=survivors&t=0');
  state.enemies = [];
  const p = state.player;
  const magnet = { id: 50, kind: 'magnet', x: p.x, z: p.z + 1, alt: p.altitude + 16, xp: 0, born: state.tick };
  const otherMagnet = { id: 54, kind: 'magnet', x: p.x + 800, z: p.z + 800, alt: p.altitude, xp: 0, born: state.tick };
  const captured = { id: 51, x: p.x + 260, z: p.z + 260, alt: 75, xp: 7, born: state.tick, pulling: true,
    capture: { capturedAtTick: state.tick, arriveAtTick: state.tick + 5, origin: { x: p.x + 260, z: p.z + 260, alt: 75 },
      curve: { x: 1, z: 0, amount: 2 } } };
  const events = [];
  state.pickups = [magnet, otherMagnet,
    { id: 52, x: p.x + 280, z: p.z + 270, alt: 75, xp: 2, born: state.tick },
    { id: 53, x: p.x - 280, z: p.z + 270, alt: 180, xp: 3, born: state.tick },
    captured];
  state.chests.drops.push({ id: 'coast-supply', x: p.x + 3000, z: p.z + 3000, alt: p.altitude });
  const observe = {
    pickupContacted: event => events.push({ type: 'contact', ...event }),
    pickupCollected: event => events.push({ type: 'collected', ...event }),
  };
  stepStage(state, {}, ground, undefined, observe);
  assert.equal(state.run.credits, 0, 'wrong-altitude direct contact does not activate the magnet');
  assert.equal(state.pickups.includes(magnet), true);
  magnet.alt = state.player.altitude;
  magnet.x = state.player.x;
  magnet.z = state.player.z;
  const deadline = captured.capture.arriveAtTick;
  stepStage(state, {}, ground, undefined, observe);
  assert.equal(state.run.credits, 0, 'global activation does not pay salvage immediately');
  assert.equal(captured.capture.arriveAtTick, deadline);
  assert.equal(state.pickups.includes(captured), true);
  assert.equal(state.pickups.includes(otherMagnet), true, 'the global magnet does not collect other magnet items');
  assert.equal(state.chests.drops.length, 1, 'the global magnet excludes chests');
  assert.ok(events.some(event => event.type === 'collected' && event.kind === 'magnet'));
  assert.equal(events.filter(event => event.type === 'collected' && event.kind === 'salvage').length, 0);
  const future = { id: 55, x: p.x + 2000, z: p.z + 2000, alt: 75, xp: 11, born: state.tick };
  state.pickups.push(future);
  const globalDeadline = Math.max(state.pickups.find(pickup => pickup.id === 52).capture.arriveAtTick,
    state.pickups.find(pickup => pickup.id === 53).capture.arriveAtTick);
  const pausedPositions = [captured.x, captured.z, captured.alt];
  state.paused = true;
  stepStage(state, {}, ground, undefined, observe);
  assert.equal(state.tick, 2);
  assert.deepEqual([captured.x, captured.z, captured.alt], pausedPositions);
  assert.equal(captured.capture.arriveAtTick, deadline);
  state.paused = false;
  while (state.tick < deadline) stepStage(state, {}, ground, undefined, observe);
  assert.equal(state.run.credits, 7, 'previously captured salvage retains its original deadline');
  const originalEvent = events.find(event => event.type === 'collected' && event.pickupId === captured.id);
  assert.deepEqual(originalEvent.position, originalEvent.playerPosition, 'arrival event position is on the hull');
  while (state.tick < globalDeadline) stepStage(state, {}, ground, undefined, observe);
  assert.equal(state.run.credits, 12);
  assert.equal(future.capture, undefined, 'drops after global activation remain ordinary pickups');
  const arrivalEvents = events.filter(event => event.type === 'collected' && [52, 53].includes(event.pickupId));
  assert.equal(arrivalEvents.length, 2);
  for (const event of arrivalEvents) assert.deepEqual(event.position, event.playerPosition);
  stepStage(state, {}, ground);
  assert.equal(state.run.credits, 12, 'global captures are credited exactly once');
});

test('captured salvage continues to arrive during Ace defeat ticks', () => {
  const state = stage('?mode=survivors&t=0&fixture=ace');
  state.enemies = [];
  const p = state.player, ace = state.boss;
  assert.ok(ace);
  ace.defeatedAt = state.tick;
  ace.alt = ground(ace.x, ace.z) + 100;
  const pickup = { id: 910, kind: 'salvage', x: p.x + 50, z: p.z + 80, alt: 180, xp: 2, born: state.tick,
    capture: { capturedAtTick: state.tick, arriveAtTick: state.tick + 2, origin: { x: p.x + 50, z: p.z + 80, alt: 180 },
      curve: { x: 1, z: 0, amount: 2 } } };
  const untouched = { id: 911, x: p.x + 900, z: p.z + 900, alt: 180, xp: 5, born: state.tick };
  state.pickups = [pickup, untouched];
  const events = [];
  const observe = { pickupCollected: event => events.push(event) };

  stepStage(state, {}, ground, undefined, observe);
  assert.equal(state.salvage, 0);
  stepStage(state, {}, ground, undefined, observe);

  assert.equal(state.salvage, 2);
  assert.equal(state.run.credits, 2);
  assert.equal(state.phase, 'playing');
  assert.equal(ace.crashed, false);
  assert.equal(state.pickups.includes(pickup), false);
  assert.equal(state.pickups.includes(untouched), true);
  assert.equal(events.length, 1);
  assert.equal(events[0].tick, pickup.capture.arriveAtTick);
  assert.deepEqual(events[0].position, events[0].playerPosition);
});

test('Ace clear waits for an already-captured orb to reach the hull', () => {
  const state = stage('?mode=survivors&t=0&fixture=ace');
  state.enemies = [];
  const p = state.player, ace = state.boss;
  assert.ok(ace);
  ace.defeatedAt = state.tick;
  ace.alt = -1000;
  const pickup = { id: 912, kind: 'salvage', x: p.x + 50, z: p.z + 80, alt: 180, xp: 2, born: state.tick,
    capture: { capturedAtTick: state.tick, arriveAtTick: state.tick + 3, origin: { x: p.x + 50, z: p.z + 80, alt: 180 },
      curve: { x: 1, z: 0, amount: 2 } } };
  state.pickups = [pickup];
  const events = [];
  const observe = { pickupCollected: event => events.push(event) };

  stepStage(state, {}, ground, undefined, observe);
  const terminalTick = state.tick;
  assert.equal(ace.crashed, true);
  assert.equal(state.pendingFinish?.outcome, 'clear');
  assert.equal(state.phase, 'playing');
  assert.equal(state.salvage, 0);

  while (state.pendingFinish) stepStage(state, {}, ground, undefined, observe);

  assert.equal(state.phase, 'clear');
  assert.equal(state.summary.seconds, terminalTick / 60);
  assert.equal(state.salvage, 2);
  assert.equal(state.run.credits, 2);
  assert.equal(events.length, 1);
  assert.equal(events[0].tick, pickup.capture.arriveAtTick);
  assert.deepEqual(events[0].position, events[0].playerPosition);
});

test('timeout settles only captured salvage without delaying the recorded outcome time', () => {
  const state = stage('?mode=survivors&t=0');
  state.enemies = [];
  state.boss = null;
  state.chests.drops = [];
  state.hull = state.maxHull;
  state.invulnerability = 1000;
  const p = state.player;
  const terminalTick = endTick(state);
  const captured = { id: 920, kind: 'salvage', x: p.x + 300, z: p.z + 300, alt: 180, xp: 3, born: terminalTick - 10,
    capture: { capturedAtTick: terminalTick - 5, arriveAtTick: terminalTick + 3, origin: { x: p.x + 300, z: p.z + 300, alt: 180 },
      curve: { x: 1, z: 0, amount: 2 } } };
  const uncaptured = { id: 921, x: p.x + 1000, z: p.z + 1000, alt: 180, xp: 7, born: terminalTick - 10 };
  state.pickups = [captured, uncaptured];
  state.xp = 1_000_000;
  state.tick = terminalTick - 1;
  const events = [];
  const observe = { pickupCollected: event => events.push(event) };

  stepStage(state, {}, ground, undefined, observe);
  assert.equal(state.tick, terminalTick);
  assert.equal(state.pendingFinish?.outcome, 'timeout');
  assert.equal(state.phase, 'playing', 'a terminal level-up draft does not block capture settlement');
  assert.equal(state.summary, null);
  assert.equal(state.run.credits, 0);
  const enemiesAtOutcome = JSON.stringify(state.enemies);
  const nextIdAtOutcome = state.nextId;

  while (state.pendingFinish) stepStage(state, {}, ground, undefined, observe);

  assert.equal(state.phase, 'timeout');
  assert.equal(state.tick, terminalTick);
  assert.equal(state.summary.seconds, terminalTick / 60);
  assert.equal(state.salvage, 3);
  assert.equal(state.run.credits, 3);
  assert.equal(state.pickups.includes(uncaptured), true);
  assert.equal(uncaptured.capture, undefined);
  assert.equal(JSON.stringify(state.enemies), enemiesAtOutcome, 'terminal settlement performs no enemy combat or spawns');
  assert.equal(state.nextId, nextIdAtOutcome);
  assert.equal(events.length, 1);
  assert.equal(events[0].tick, terminalTick + 3);
  assert.deepEqual(events[0].position, events[0].playerPosition);
});

test('blur pause does not advance or finish a terminal capture settlement', () => {
  const state = stage('?mode=survivors&t=0');
  const terminalTick = endTick(state);
  const p = state.player;
  const pickup = { id: 922, kind: 'salvage', x: p.x + 300, z: p.z + 300, alt: 180, xp: 3, born: terminalTick - 5,
    capture: { capturedAtTick: terminalTick - 5, arriveAtTick: terminalTick + 1, origin: { x: p.x + 300, z: p.z + 300, alt: 180 },
      curve: { x: 1, z: 0, amount: 2 } } };
  state.tick = terminalTick;
  state.pickups = [pickup];
  state.pendingFinish = { outcome: 'timeout', terminalTick, settlementTick: terminalTick };
  state.phase = 'playing';
  const initialProfile = state.profile;
  const events = [];
  const observe = { pickupCollected: event => events.push(event) };

  stepStage(state, { pause: true }, ground, undefined, observe);
  assert.equal(state.paused, true);
  assert.equal(state.pendingFinish.settlementTick, terminalTick);
  assert.equal(state.summary, null);
  assert.equal(state.profile, initialProfile);
  assert.equal(state.salvage, 0);
  assert.equal(events.length, 0);

  stepStage(state, {}, ground, undefined, observe);
  assert.equal(state.pendingFinish.settlementTick, terminalTick);
  stepStage(state, { pause: true }, ground, undefined, observe);
  assert.equal(state.paused, false);
  assert.equal(state.pendingFinish.settlementTick, terminalTick);

  stepStage(state, {}, ground, undefined, observe);
  assert.equal(state.phase, 'timeout');
  assert.equal(state.tick, terminalTick);
  assert.equal(state.summary.seconds, terminalTick / 60);
  assert.notEqual(state.profile, initialProfile);
  assert.equal(state.run.credits, 3);
  assert.equal(events.length, 1);
  assert.equal(events[0].tick, terminalTick + 1);
  assert.deepEqual(events[0].position, events[0].playerPosition);
});

test('close planar salvage at a different altitude still follows a capture deadline to the ship', () => {
  const state = stage('?mode=survivors&t=0');
  state.enemies = [];
  const { x, z, altitude } = state.player;
  const pickup = { id: 80, x, z: z + 4, alt: altitude + 90, xp: 2, born: state.tick };
  const events = [];
  state.pickups = [pickup];
  stepStage(state, {}, ground, undefined, { pickupCollected: event => events.push(event) });
  assert.equal(state.salvage, 0);
  assert.ok(pickup.capture);
  const deadline = pickup.capture.arriveAtTick;
  while (state.tick < deadline) stepStage(state, {}, ground, undefined, { pickupCollected: event => events.push(event) });
  assert.equal(state.salvage, 2);
  assert.deepEqual(events[0].position, events[0].playerPosition);
});

test('magnet drops use only the dedicated seeded stream and ordinary kills do not roll', () => {
  const ordinary = stage('?mode=survivors&seed=19&t=0');
  const before = ordinary.streams.magnetDrop.rng;
  const enemy = makeEnemy(ordinary, ordinary.player.x + 250, ordinary.player.z + 250, 1, 'patrol');
  enemy.hp = 0;
  enemy.shotDown = true;
  ordinary.enemies = [enemy];
  run(ordinary, 1);
  assert.equal(ordinary.streams.magnetDrop.rng, before);
  assert.equal(ordinary.pickups.some(pickup => pickup.kind === 'magnet'), false);

  const state = stage('?mode=survivors&seed=19&t=0');
  const spawnRng = state.streams.spawn.rng, combatRng = state.streams.combat.rng;
  const drops = [];
  const magnet = dropMagnet(state, { sourceEventId: 77, sourceKind: 'midboss',
    position: { x: state.player.x + 300, z: state.player.z + 300, alt: 75 } },
  { pickupDropped: event => drops.push(event) });
  assert.equal(magnet.kind, 'magnet');
  assert.deepEqual(magnet.source, { eventId: 77, kind: 'midboss' });
  assert.deepEqual(drops[0], { pickupId: magnet.id, kind: 'magnet', position: { x: magnet.x, z: magnet.z, alt: magnet.alt },
    tick: state.tick, sourceEventId: 77 });
  assert.equal(state.streams.spawn.rng, spawnRng);
  assert.equal(state.streams.combat.rng, combatRng);

  const eliteAegisState = stage('?mode=survivors&seed=19&t=0');
  const eliteAegis = makeEnemy(eliteAegisState, eliteAegisState.player.x + 300, eliteAegisState.player.z + 300, 1, 'aegis');
  eliteAegis.elite = true;
  eliteAegis.hp = 0;
  eliteAegis.shotDown = true;
  eliteAegisState.enemies = [eliteAegis];
  run(eliteAegisState, 1);
  assert.ok(eliteAegisState.pickups.some(pickup => pickup.kind === 'magnet' && pickup.source.kind === 'elite'));

  const eliteState = stage('?mode=survivors&seed=19&t=0');
  const elite = makeEnemy(eliteState, eliteState.player.x + 300, eliteState.player.z + 300, 1, 'bomber');
  elite.carrier = 'coast-supply';
  elite.hp = 0;
  elite.shotDown = true;
  eliteState.enemies = [elite];
  run(eliteState, 1);
  assert.ok(eliteState.pickups.some(pickup => pickup.kind === 'magnet' && pickup.source.kind === 'elite'));

  const miss = stage('?mode=survivors&seed=1&t=0');
  assert.equal(dropMagnet(miss, { sourceEventId: 78, sourceKind: 'elite',
    position: { x: miss.player.x, z: miss.player.z, alt: miss.player.altitude } }), null);
});

test('the three draft cards pause active time, apply once and keep three legal choices on round two', () => {
  for (let pick = 0; pick < 3; pick++) {
    const state = stage('?fixture=draft');
    assert.equal(state.tick, 45 * 60);
    assert.equal(state.phase, 'draft');
    assert.deepEqual(state.draft, ['twin-2', 'pods-2', 'twin-damage']);
    const { x, z } = state.player;
    run(state, 120, { boost: true, toggleView: true, climb: 1 });
    assert.equal(state.tick, 45 * 60);
    assert.deepEqual([state.player.x, state.player.z, state.boost], [x, z, 1]);
    run(state, 1, { pick: 'twin-3' });
    assert.equal(state.phase, 'draft');
    run(state, 1, { pick: state.draft[pick], boost: true, toggleView: true });
    assert.equal(state.phase, 'playing');
    assert.equal(state.level, 2);
    assert.equal(state.xp, 0);
    assert.equal(state.twinRank, pick === 0 ? 2 : 1);
    assert.equal(state.podRank, pick === 1 ? 2 : 1);
    assert.equal(state.twinDamage, pick === 2 ? 2 : 1);
    run(state, 18, { boost: true, toggleView: true });
    assert.equal(state.boost, 1);
    assert.equal(state.rearBombs.length, 0);
    assert.equal(state.view, 'overhead');
    run(state, 1, { boost: true });
    assert.equal(state.boost, 1);
    run(state, 1);
    run(state, 1, { boost: true });
    assert.ok(state.boost < 1);
    state.pickups.push({ id: 20, ...atPlayer(state, state.player.altitude), xp: 12, born: state.tick });
    run(state, 1);
    assert.equal(state.draft.length, 3);
    assert.equal(new Set(state.draft).size, 3);
    run(state, 1, { pick: state.draft[0] });
    assert.equal(state.level, 3);
    assert.equal(state.xp, 2);
    assert.equal(state.salvage, 18);
  }
});

test('the old Warden fixture opens on the same fighter as the Legacy boss fixture', () => {
  assert.deepEqual(stage('?fixture=warden'), stage('?fixture=boss'));
});

test('the legacy Ace fixture rejects cruise bolts, then tracks same-band aim across views', () => {
  const state = stage('?fixture=boss&view=cockpit');
  assert.equal(state.tick, 108 * 60);
  assert.equal(state.player.altitude, 125);
  const ace = activeAce(state);
  assert.ok(ace.alt >= 139);
  run(state, 24);
  assert.equal(ace.hits, 0);
  assert.ok(state.altitudeHint.delta > 0);

  state.player.altitude = ace.alt;
  Object.assign(state.player, { yaw: Math.atan2(ace.x - state.player.x, ace.z - state.player.z) });
  run(state, 12);
  assert.ok(state.lock.progress > 0 && state.lock.progress < 1);
  run(state, 1, { toggleView: true });
  assert.ok(state.lock.progress > 0);
  assert.equal(state.view, 'overhead');
  for (let i = 0; i < 120 && !ace.hits; i++) stepStage(state, autopilotInput(state), ground);
  assert.ok(ace.hits > 0);
});

test('the legacy Ace drops into a crash spiral and its destruction ends the sortie', () => {
  const state = stage('?fixture=boss');
  for (let i = 0; i < 72 * 60 && state.phase !== 'clear'; i++) {
    stepStage(state, autopilotInput(state), ground);
  }
  assert.equal(state.phase, 'clear');
  assert.ok(state.tick < 180 * 60);
  assert.equal(state.boss.hp, 0);
  assert.ok(state.boss.hits > 0 && state.boss.crashed);
  assert.ok('SABC'.includes(state.rank));
});

test('time expiry shows a ranked timeout with a live boss and does not advance past 03:00', () => {
  const state = stage('?fixture=boss');
  state.tick = 180 * 60 - 1;
  run(state, 1);
  assert.equal(state.phase, 'timeout');
  assert.equal(state.tick, 180 * 60);
  assert.equal(state.rank, 'S');
  run(state, 60);
  assert.equal(state.tick, 180 * 60);
  run(state, 1, { start: true });
  assert.equal(state.tick, 0);
  assert.equal(state.phase, 'playing');
});

test('last-tick damage, Ace hits and an earned draft resolve before the result', () => {
  function finalTick(hull) {
    const state = stage('?fixture=boss');
    state.tick = 180 * 60 - 1;
    state.boss.bandAt = state.boss.attackAt = state.tick + 100;
    state.hull = hull;
    state.xp = 5;
    const ace = state.boss;
    ace.hp = 1;
    state.shots.push({ ...atPlayer(state, ace.alt, true), x: ace.x, z: ace.z, lockId: ace.id });
    state.shots.push(atPlayer(state, state.player.altitude));
    state.pickups.push({ id: 70, ...atPlayer(state, state.player.altitude), xp: 1, born: state.tick });
    return run(state, 1);
  }
  const alive = finalTick(8);
  assert.equal(alive.phase, 'draft');
  assert.equal(alive.hull, 6);
  assert.equal(alive.boss.hits, 1);
  run(alive, 1, { pick: alive.draft[0] });
  assert.equal(alive.phase, 'clear');
  assert.equal(alive.rank, 'A');
  const dead = finalTick(2);
  assert.equal(dead.phase, 'lost');
  assert.equal(dead.boss.hits, 1);
});

test('an explicit view sets the camera after a deterministic absolute seek', () => {
  const options = parseStageOptions('?t=47&seed=11&view=cockpit&touch=1');
  const first = seekStage(options, ground);
  const second = seekStage(options, ground);
  assert.equal(first.tick, 47 * 60);
  assert.equal(first.view, 'cockpit');
  assert.equal(options.touch, true);
  assert.deepEqual(first, second);
  assert.equal(seekStage(parseStageOptions('?fixture=stack&t=31'), ground).tick, 31 * 60);
  assert.equal(seekStage(parseStageOptions('?fixture=stack&t=10'), ground).tick, 10 * 60);
});

test('seeded waves respect phase caps and warn before interceptor altitude changes', () => {
  const state = stage('?autoplay=1&seed=11');
  let warned = 0;
  const warnings = new Map();
  for (let i = 0; i < 180 * 60 + 30 && ['playing', 'draft'].includes(state.phase); i++) {
    stepStage(state, autopilotInput(state), ground);
    assert.ok(state.enemies.length <= (state.tick < 2400 ? 8 : state.tick < 4200 ? 16 : state.tick < 6300 ? 24 : 14));
    for (const enemy of state.enemies.filter(enemy => enemy.kind === 'interceptor')) {
      if (enemy.maneuver?.phase === 'warning') {
        if (!warnings.has(enemy.id)) warnings.set(enemy.id, [state.tick, enemy.alt]);
        assert.equal(enemy.alt, warnings.get(enemy.id)[1]);
        warned++;
      } else if (enemy.maneuver?.phase === 'diving' && warnings.has(enemy.id)) {
        assert.ok(state.tick - warnings.get(enemy.id)[0] >= ROSTER.hound.bandLagTicks);
      } else {
        warnings.delete(enemy.id);
      }
    }
  }
  assert.ok(warned > 75);
  assert.ok(['clear', 'timeout', 'lost'].includes(state.phase));
});

test('a successful stacked volley does not also report a wrong-height miss', () => {
  const state = stage('?fixture=stack');
  state.twinDamage = 2;
  run(state, 25);
  assert.equal(state.enemies.length, 2);
  assert.equal(state.effects.filter(effect => effect.kind === 'miss').length, 0);
});

test('Wing Pods cover a side contact at launch height and upgrades improve both weapons independently', () => {
  const state = stage('?fixture=draft');
  run(state, 1, { pick: 'pods-2' });
  const target = stage('?fixture=stack').enemies[1];
  target.x = state.player.x - 38;
  target.z = state.player.z;
  target.hp = 12;
  target.shotAt = state.tick + 120;
  state.enemies = [target];
  run(state, 1);
  assert.equal(state.shots[0].kind, 'pods');
  assert.equal(state.shots[0].alt, 125);
  assert.equal(state.podsAt - state.tick, 25);
  assert.equal(state.twinRank, 1);
});

// The TOP pilot may use learned band centers, the health bar and the timing of
// the coarse radar glyph. It avoids bolts from their visible planar paths.
function radarOnlyPilot() {
  let contactId, entryDirection = 0, wantAltitude = null;
  let radar = null, dodgeUntil = 0, dodgeDirection = 0, nextDodge = 0;
  const clampStick = value => Math.max(-1, Math.min(1, value));
  const nearest = (items, p) => items.reduce((best, item) =>
    best && Math.hypot(best.x - p.x, best.z - p.z) <= Math.hypot(item.x - p.x, item.z - p.z) ? best : item, null);

  return state => {
    const pilot = autopilotInput(state, 'top');
    if (state.phase !== 'playing') return pilot;
    const p = state.player, alt = Math.round(p.altitude);
    let climb = 0;
    const salvage = nearest(state.pickups, p);
    const track = activeAce(state) ?? (salvage && Math.hypot(salvage.x - p.x, salvage.z - p.z) <= 150
      ? salvage : nearest(state.enemies, p));
    if (state.tick % 3 === 0) {
      radar = track && Math.hypot(track.x - p.x, track.z - p.z) <= 160
        ? { id: track.id, mark: relativeMark(track.alt - p.altitude, true) } : null;
    }
    if (radar) {
      if (radar.id !== contactId) {
        contactId = radar.id;
        entryDirection = 0;
        wantAltitude = null;
      }
      if (radar.mark !== '■') {
        entryDirection = radar.mark === '△' ? 1 : -1;
        climb = entryDirection;
        wantAltitude = null;
      } else {
        wantAltitude ??= alt + 7.2 * entryDirection;
        climb = clampStick((wantAltitude - alt) / 4);
      }
    }

    if (state.tick >= nextDodge && state.invulnerability === 0) {
      for (const shot of state.shots) {
        if (shot.kind !== 'hostile') continue;
        const x = shot.x - p.x, z = shot.z - p.z;
        if (Math.hypot(x, z) > 55) continue;
        const vx = shot.vx - Math.sin(p.yaw) * state.speed, vz = shot.vz - Math.cos(p.yaw) * state.speed;
        const time = -(x * vx + z * vz) / (vx * vx + vz * vz);
        if (time < 0.18 || time > 0.55 || Math.hypot(x + vx * time, z + vz * time) > 9) continue;
        dodgeUntil = state.tick + Math.ceil((time + 0.06) * 60);
        nextDodge = dodgeUntil + 25;
        dodgeDirection = alt > 142 ? -1 : alt < 80 || climb >= 0 ? 1 : -1;
        break;
      }
    }
    pilot.climb = state.tick < dodgeUntil ? dodgeDirection : climb;
    return pilot;
  };
}

test('all six full-view legacy replays clear and outperform the radar-only pilot', () => {
  let clearWithAllViews = 0, topOnlyClears = 0;
  for (const seed of [1, 11, 27, 42, 128, 2026]) {
    for (const mode of ['full', 'top']) {
      const state = stage('?autoplay=1&seed=' + seed);
      const views = new Set([state.view]);
      const pilot = mode === 'full' ? state => autopilotInput(state, 'full', ground) : radarOnlyPilot();
      for (let i = 0; i < 10810 && ['playing', 'draft'].includes(state.phase); i++) {
        stepStage(state, pilot(state), ground);
        views.add(state.view);
      }
      assert.ok(['clear', 'timeout', 'lost'].includes(state.phase));
      const good = state.phase === 'clear' && state.level === 3 && state.salvageBands.filter(Boolean).length >= 2;
      if (mode === 'full' && good && views.size === 3) clearWithAllViews++;
      if (mode === 'top' && state.phase === 'clear') topOnlyClears++;
    }
  }
  assert.equal(clearWithAllViews, 6);
  assert.ok(topOnlyClears < clearWithAllViews);
});

test('a late seek reaches its absolute active tick and returns a live sortie for manual controls', () => {
  const state = seekStage(parseStageOptions('?seed=1&t=179&view=chase'), ground);
  assert.equal(state.tick, 10740);
  assert.equal(state.phase, 'playing');
  assert.equal(state.view, 'chase');
  const yaw = state.player.yaw;
  run(state, 1, { turn: 1 });
  assert.notEqual(state.player.yaw, yaw);
  const end = seekStage(parseStageOptions('?fixture=boss&t=180&seed=11'), ground);
  assert.equal(end.tick, 10800);
  assert.equal(end.phase, 'timeout');
});

test('fresh boost is ignored during the draft input grace', () => {
  const state = stage('?fixture=draft');
  run(state, 1, { pick: state.draft[0] });
  run(state, 1);
  run(state, 17, { boost: true });
  assert.equal(state.tick, 2718);
  assert.equal(state.boost, 1);
  run(state, 1, { boost: true });
  assert.ok(state.boost < 1);
});

test('four damaging hits exhaust the one life and earn Rank C', () => {
  const state = stage('?fixture=boss');
  state.enemies = [];
  for (let i = 0; i < 4; i++) {
    state.invulnerability = 0;
    state.shots = [atPlayer(state, state.player.altitude)];
    run(state, 1);
  }
  assert.equal(state.phase, 'lost');
  assert.equal(state.hull, 0);
  assert.equal(state.hitsTaken, 4);
  assert.equal(state.rank, 'C');
});

test('the full pilot can pursue off-radar salvage and intercept the advance Ace signal', () => {
  const salvage = stage('?autoplay=1');
  salvage.pickups.push({ id: 91, x: -200, z: salvage.player.z, alt: 75, xp: 2, born: 0 });
  const pickup = autopilotInput(salvage, 'full', ground);
  assert.ok(pickup.turn < 0 && pickup.climb < 0);

  const beacon = stage('?autoplay=1');
  beacon.tick = 92 * 60;
  beacon.level = 3;
  Object.assign(beacon.player, { x: -350, z: -100, yaw: 1.6 });
  assert.ok(autopilotInput(beacon, 'full', ground).turn > 0);
  assert.ok(autopilotInput(beacon, 'top', ground).turn < 0);
  beacon.rally = { x: beacon.player.x, z: beacon.player.z + 220, alt: beacon.player.altitude };
  assert.ok(autopilotInput(beacon, 'full', ground).turn < 0, 'follow the local intercept instead of Beacon Atoll');
});

test('the full pilot follows a skimming Ace and climbs out of its missile warning', () => {
  const state = stage('?fixture=ace');
  const floor = () => 35;
  const altitude = skimAltitude(floor());
  const ace = activeAce(state);
  Object.assign(state.player, { x: 0, z: 0, altitude, yaw: 0 });
  Object.assign(ace, { x: 0, z: 90, alt: altitude, band: SKIM_BAND, vx: 0, vz: 0 });
  assert.equal(autopilotInput(state, 'full', floor).climb, -1, 'enter SKIM even at the target altitude');

  state.player.skim = 'water';
  assert.equal(autopilotInput(state, 'full', floor).climb, 0, 'stay in SKIM during the chase');
  ace.tail = true;
  ace.tell = { kind: 'missile', x: 0, z: 0, alt: altitude, since: state.tick, until: state.tick + 12 };
  assert.ok(autopilotInput(state, 'full', floor).climb > 0, 'leave SKIM upward before the salvo');
});

test('seeded placement, hazards and combat stay identical across view choices', () => {
  const top = stage('?autoplay=1&seed=1&view=top');
  const cockpit = stage('?autoplay=1&seed=1&view=cockpit');
  const seen = new Set();
  for (let i = 0; i < 10810 && ['playing', 'draft'].includes(top.phase); i++) {
    const input = autopilotInput(top, 'full', ground);
    delete input.toggleView;
    stepStage(top, input, ground);
    stepStage(cockpit, input, ground);
    for (const enemy of top.enemies) seen.add(enemy.kind);
  }
  const simulation = ({ view, initialView, wipe, viewTag, ...state }) => state;
  assert.deepEqual(simulation(top), simulation(cockpit));
  assert.ok(['skimmer', 'spotter', 'hound', 'flanker', 'harrier', 'diver', 'bomber', 'turret'].every(kind => seen.has(kind)));
});
