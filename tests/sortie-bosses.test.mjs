import assert from 'node:assert/strict';
import test from 'node:test';
import { autopilotInput } from '../src/autoplay.ts';
import { CARRIER_TUNING } from '../src/data/chest-tuning.ts';
import { WEAPONS } from '../src/data/items.ts';
import { HEAT_TIERS } from '../src/data/meta.ts';
import { MAX_ALTITUDE, HIT_WINDOW, TICKS_PER_SECOND, TWIN_CONE, advanceShots, angleTo, hurtEnemy } from '../src/stage-combat.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { advanceEnemies } from '../src/stage-enemies.ts';
import { relocateStragglers } from '../src/spawn-director.ts';
import { advanceSortieMiniboss, SORTIE_BOSS_HIT_RADIUS, SORTIE_MINIBOSS_CUES, SORTIE_REST_TICKS, STANDALONE_SORTIE_BOSS_HOOKS } from '../src/sortie-bosses.ts';
import { World } from '../src/world.ts';

const ground = () => 0;

function startEncounter(index, hooks = STANDALONE_SORTIE_BOSS_HOOKS) {
  const cue = SORTIE_MINIBOSS_CUES[index];
  const state = createStage(parseStageOptions('?mode=survivors&autoplay=1&seed=27'), ground);
  state.tick = cue.startTick - 1;
  state.chests.next = index === 0 ? 1 : 3;
  state.twinAt = state.podsAt = state.strafeAt = Number.MAX_SAFE_INTEGER;
  stepStage(state, {}, ground, undefined, undefined, hooks);
  return state;
}

function run(state, ticks, hooks, events) {
  for (let i = 0; i < ticks; i++) stepStage(state, {}, ground, undefined, events, hooks);
}

test('miniboss cues use 60 Hz ticks, 30-second limits, and the approved start times', () => {
  assert.deepEqual(SORTIE_MINIBOSS_CUES.map(({ id, kind, startTick, maxDurationTicks, threatSource }) =>
    [id, kind, startTick, maxDurationTicks, threatSource]), [
    ['armored-transport', 'midboss', 205 * TICKS_PER_SECOND, 30 * TICKS_PER_SECOND, 'midboss:armored-transport'],
    ['escort-commander', 'midboss', 400 * TICKS_PER_SECOND, 30 * TICKS_PER_SECOND, 'midboss:escort-commander'],
  ]);
  assert.equal(SORTIE_REST_TICKS, 15 * TICKS_PER_SECOND);
  assert.equal(TICKS_PER_SECOND, 60);
  assert.deepEqual(Object.keys(SORTIE_MINIBOSS_CUES[0]).sort(),
    ['id', 'kind', 'maxDurationTicks', 'startTick', 'threatSource']);
});

test('the miniboss consumer starts only from the shared producer cue', () => {
  const cue = SORTIE_MINIBOSS_CUES[1];
  const state = createStage(parseStageOptions('?mode=survivors&autoplay=1&seed=27'), ground);
  state.tick = cue.startTick - 1;
  const consumed = [];
  const hooks = {
    ...STANDALONE_SORTIE_BOSS_HOOKS,
    consumeMidbossCue(candidate) { consumed.push(candidate); return cue; },
  };
  stepStage(state, {}, ground, undefined, undefined, hooks);
  assert.equal(consumed.length, 1);
  assert.equal(consumed[0], state);
  assert.deepEqual(state.sortieBoss.cue, {
    id: 'escort-commander', kind: 'midboss', startTick: 400 * TICKS_PER_SECOND,
    maxDurationTicks: 30 * TICKS_PER_SECOND, threatSource: 'midboss:escort-commander',
  });
});

test('miniboss spawn stays player-local when an external pilot is outside the arena', () => {
  const state = createStage(parseStageOptions('?mode=survivors&autoplay=1&seed=1'), ground);
  state.tick = SORTIE_MINIBOSS_CUES[0].startTick - 1;
  state.chests.next = 1;
  state.speed = 120;
  Object.assign(state.player, {
    x: state.arena.x + state.arena.radius + 600, z: state.arena.z,
    yaw: Math.PI / 2, vx: 120, vz: 0, altitude: 125,
  });
  stepStage(state, {}, ground);
  const actor = state.enemies.find(enemy => enemy.id === state.sortieBoss.actorId);
  assert.ok(actor.x > state.arena.x + state.arena.radius + 200,
    `the boss remains near the external pilot instead of clipping to the arena edge: ${actor.x}`);
  assert.ok(Math.hypot(actor.x - state.player.x, actor.z - state.player.z) < 400);
});

test('miniboss and escorts move continuously as an outside pilot re-enters the arena', () => {
  const state = createStage(parseStageOptions('?mode=survivors&autoplay=1&seed=1'), ground);
  const cue = SORTIE_MINIBOSS_CUES[0];
  state.tick = cue.startTick - 1;
  state.chests.next = 1;
  const edge = state.arena.x + state.arena.radius;
  state.speed = 0;
  Object.assign(state.player, {
    x: edge + 1, z: state.arena.z, yaw: Math.PI / 2,
    vx: 0, vz: 0, altitude: 125,
  });
  stepStage(state, {}, ground);

  const boss = state.sortieBoss;
  const actors = [boss.actorId, ...boss.escortIds].map(id => state.enemies.find(enemy => enemy.id === id));
  assert.ok(actors.every(actor => Math.hypot(actor.x - state.arena.x, actor.z - state.arena.z) > state.arena.radius));
  const previous = actors.map(actor => ({ x: actor.x, z: actor.z }));

  state.player.x = edge + 1;
  state.player.z = state.arena.z;
  state.player.vx = 0;
  state.player.vz = 0;
  state.player.x -= 2;
  state.player.vx = -120;
  state.tick++;
  advanceSortieMiniboss(state, ground, STANDALONE_SORTIE_BOSS_HOOKS);

  for (let index = 0; index < actors.length; index++) {
    const displacement = Math.hypot(actors[index].x - previous[index].x, actors[index].z - previous[index].z);
    assert.ok(displacement < 10, `actor ${actors[index].id} moves continuously across the boundary: ${displacement}`);
  }
});

test('generic straggler recycling cannot strand a sortie boss in a skipped fly-in entry', () => {
  const state = startEncounter(0);
  const actor = state.enemies.find(enemy => enemy.id === state.sortieBoss.actorId);
  const hp = actor.hp;
  actor.x = state.player.x + 100000;
  actor.z = state.player.z;
  actor.farTicks = 155;

  relocateStragglers(state, ground);
  assert.equal(actor.entry, undefined);
  for (let i = 0; i < 240; i++) {
    state.tick++;
    advanceEnemies(state, ground);
  }
  hurtEnemy(state, actor, 1);
  assert.equal(actor.hp, hp - 1, 'the dedicated boss remains damageable after generic enemy advancement');
});

test('the armored transport crosses into a real four-second, in-range firing line inside the arena', () => {
  const state = startEncounter(0);
  const boss = state.sortieBoss;
  const actor = state.enemies.find(enemy => enemy.id === boss.actorId);
  assert.equal(boss.cue.id, SORTIE_MINIBOSS_CUES[0].id);
  assert.equal(state.chests.next, 2, 'the replaced carrier schedule is consumed');
  assert.equal(state.enemies.filter(enemy => enemy.carrier === 'first-evolution').length, 1);
  assert.equal(actor.hp, Math.round(CARRIER_TUNING['first-evolution'].hp * HEAT_TIERS[state.heat].armorScale),
    'the existing evolution-carrier hull is retained');

  const initialX = actor.x;
  run(state, TICKS_PER_SECOND);
  assert.ok(actor.x > initialX, 'the transport crosses toward the player rather than flying away');

  const edgeOffset = SORTIE_BOSS_HIT_RADIUS - 4;
  assert.ok(edgeOffset > 6 && edgeOffset < SORTIE_BOSS_HIT_RADIUS);
  const shot = {
    kind: 'twin', x: actor.x - 30, z: actor.z + edgeOffset, alt: actor.alt,
    vx: 1800, vz: 0, life: 1, damage: 1, volley: 1, nearMiss: false, lockId: null,
  };
  state.shots.push(shot);
  const hp = actor.hp;
  advanceShots(state, ground);
  assert.ok(actor.hp < hp, 'the 3D spatial collision path accepts a real crossing shot');

  for (let i = 0; i < 15 * TICKS_PER_SECOND && boss.phase !== 'line'; i++) stepStage(state, {}, ground);
  assert.equal(boss.phase, 'line');
  const lineStart = state.tick;
  let activeTicks = 0;
  while (boss.phase === 'line') {
    const distance = Math.hypot(actor.x - state.player.x, actor.z - state.player.z, actor.alt - state.player.altitude);
    assert.ok(distance <= 350, `line range ${distance} is within the existing twin-weapon range`);
    assert.ok(actor.alt >= ground(actor.x, actor.z) + 22 && actor.alt <= MAX_ALTITUDE);
    activeTicks++;
    stepStage(state, {}, ground);
  }
  assert.equal(activeTicks, 4 * TICKS_PER_SECOND);
  assert.equal(state.tick - lineStart, 4 * TICKS_PER_SECOND);
  assert.ok(Math.hypot(actor.x - state.arena.x, actor.z - state.arena.z) <= state.arena.radius - 128 + 1e-6);
});

test('piercing Twin edge hits use the same 3D miniboss hull as ordinary shots', () => {
  const state = startEncounter(0);
  const actor = state.enemies.find(enemy => enemy.id === state.sortieBoss.actorId);
  for (const enemy of state.enemies) if (enemy.id !== actor.id) enemy.hp = 0;
  const edgeOffset = SORTIE_BOSS_HIT_RADIUS - 4;
  const hp = actor.hp;
  const bolt = { remaining: 1, hits: [] };
  state.shots = [{
    kind: 'twin', x: actor.x - 30, z: actor.z + edgeOffset, alt: actor.alt,
    vx: 1800, vz: 0, life: 1, damage: 1, volley: 77, nearMiss: false, lockId: null, pierce: bolt,
  }];

  advanceShots(state, ground);

  assert.equal(actor.hp, hp - 1, 'a piercing shot grazing the 3D hull edge still damages the boss');
  assert.deepEqual(bolt.hits, [actor.id]);
});

test('seed-1 autoplay transport rejoin sustains a real twin firing arc without actor relocation', () => {
  const options = parseStageOptions('?mode=survivors&autoplay=1&seed=1');
  const world = new World(options.seed);
  const terrain = (x, z) => world.height(x, z);
  const hooks = { ...STANDALONE_SORTIE_BOSS_HOOKS, trySpendThreat: () => false };
  const state = createStage(options, terrain);
  const cue = SORTIE_MINIBOSS_CUES[0];
  let weaponsDisabled = false;
  while (state.tick < cue.startTick) {
    if (!weaponsDisabled && state.tick === cue.startTick - TICKS_PER_SECOND) {
      state.twinAt = state.podsAt = state.strafeAt = Number.MAX_SAFE_INTEGER;
      for (const key of Object.keys(state.weaponFireAt ?? {})) state.weaponFireAt[key] = Number.MAX_SAFE_INTEGER;
      state.shots = [];
      weaponsDisabled = true;
    }
    stepStage(state, autopilotInput(state, 'full', terrain), terrain, undefined, undefined, hooks);
  }

  const boss = state.sortieBoss;
  const actor = state.enemies.find(enemy => enemy.id === boss.actorId);
  const initial = { x: actor.x, z: actor.z, alt: actor.alt };
  let streak = 0, longest = 0;
  for (let i = 0; i < cue.maxDurationTicks && !boss.outcome; i++) {
    stepStage(state, {}, terrain, undefined, undefined, hooks);
    const dx = actor.x - state.player.x, dz = actor.z - state.player.z;
    const inTwinArc = Math.hypot(dx, dz) <= WEAPONS.twin.tuning.range
      && Math.abs(angleTo(state.player.yaw, dx, dz)) <= TWIN_CONE
      && Math.abs(actor.alt - state.player.altitude) <= HIT_WINDOW;
    streak = boss.phase === 'line' && inTwinArc ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }

  assert.notDeepEqual({ x: actor.x, z: actor.z, alt: actor.alt }, initial, 'the seeded flight advances the actor naturally');
  assert.ok(longest >= 3 * TICKS_PER_SECOND,
    `expected a sustained line with actual Twin range, cone and altitude geometry; got ${longest} ticks`);
});

test('transport escorts are damageable enemies and only living escort hulls source volleys', () => {
  const state = startEncounter(0);
  const boss = state.sortieBoss;
  const escorts = boss.escortIds.map(id => state.enemies.find(enemy => enemy.id === id));
  assert.equal(escorts.length, 2);
  for (const escort of escorts) {
    assert.equal(escort.kind, 'interceptor');
    assert.equal(escort.sortieBoss.role, 'escort');
    assert.ok(escort.hp > 0);
  }
  const deadEscort = escorts[0];
  hurtEnemy(state, deadEscort, deadEscort.hp);
  assert.equal(deadEscort.hp, 0);
  assert.equal(deadEscort.shotDown, true);

  const origins = [];
  const events = { muzzle(shot, _shape, x, z, alt) {
    if (shot.kind !== 'hostile') return;
    const living = boss.escortIds.map(id => state.enemies.find(enemy => enemy.id === id && enemy.hp > 0)).filter(Boolean);
    origins.push({ position: { x, z, alt }, living: living.map(escort => ({ x: escort.x, z: escort.z, alt: escort.alt })) });
  } };
  run(state, 6 * TICKS_PER_SECOND, STANDALONE_SORTIE_BOSS_HOOKS, events);
  assert.ok(origins.length > 0, 'the surviving escort produces a volley');
  for (const origin of origins) {
    assert.ok(origin.living.some(escort => escort.x === origin.position.x
      && escort.z === origin.position.z && escort.alt === origin.position.alt));
  }
  assert.equal(state.enemies.filter(enemy => enemy.sortieBoss?.role === 'escort').length, 1,
    'the destroyed escort is removed and the survivor remains the only escort render source');
});

test('the commander repeatedly crosses, makes a forward three-second recovery, and re-enters the line', () => {
  const hooks = { ...STANDALONE_SORTIE_BOSS_HOOKS, trySpendThreat: () => false };
  const state = startEncounter(1, hooks);
  state.speed = 160;
  Object.assign(state.player, { yaw: 0, vx: 0, vz: 160 });
  const boss = state.sortieBoss;
  const actor = state.enemies.find(enemy => enemy.id === boss.actorId);
  const spans = [{ phase: boss.phase, startTick: boss.phaseStartedAt, samples: [] }];
  const radius = 800, speed = state.speed || 104;
  for (let i = 0; i < 30 * TICKS_PER_SECOND && spans.filter(span => span.phase === 'line').length < 2; i++) {
    state.tick++;
    state.player.yaw += speed / radius / TICKS_PER_SECOND;
    state.player.vx = Math.sin(state.player.yaw) * speed;
    state.player.vz = Math.cos(state.player.yaw) * speed;
    state.player.x += state.player.vx / TICKS_PER_SECOND;
    state.player.z += state.player.vz / TICKS_PER_SECOND;
    advanceSortieMiniboss(state, ground, hooks);
    if (spans.at(-1).phase !== boss.phase) spans.push({ phase: boss.phase, startTick: boss.phaseStartedAt, samples: [] });
    const right = { x: Math.cos(state.player.yaw), z: -Math.sin(state.player.yaw) };
    const dx = actor.x - state.player.x, dz = actor.z - state.player.z;
    spans.at(-1).samples.push({ x: actor.x, z: actor.z, vx: actor.vx, vz: actor.vz,
      cross: dx * right.x + dz * right.z, distance: Math.hypot(dx, dz) });
  }
  assert.deepEqual(spans.slice(0, 6).map(span => span.phase), ['charge', 'recover', 'line', 'charge', 'recover', 'line']);
  assert.equal(spans[1].startTick - spans[0].startTick, 3 * TICKS_PER_SECOND);
  assert.equal(spans[2].startTick - spans[1].startTick, 3 * TICKS_PER_SECOND);
  assert.ok(spans[0].samples.some(sample => sample.cross < 0), 'first charge crosses the player forward path');
  assert.ok(spans[3].samples.some(sample => sample.cross > 0), 'returning charge crosses back across the path');
  const recover = spans[4].samples;
  assert.ok(recover.at(-1).distance < recover[0].distance - 100,
    'recovery physically returns toward the player flight path instead of leaving the charge trajectory unchanged');
  assert.ok(Math.hypot(recover.at(-1).vx, recover.at(-1).vz)
    < Math.hypot(spans[3].samples.at(-1).vx, spans[3].samples.at(-1).vz),
  'recovery speed is reduced from the charge trajectory');
});

test('boss and escort altitude follows a rising terrain floor without crossing the ceiling', () => {
  const ridge = (_x, z) => z > 180 && z < 900 ? 112 : 0;
  const cue = SORTIE_MINIBOSS_CUES[1];
  const state = createStage(parseStageOptions('?mode=survivors&autoplay=1&seed=27'), ridge);
  state.tick = cue.startTick - 1;
  state.speed = 160;
  Object.assign(state.player, { x: 0, z: 0, yaw: 0, altitude: 100, vx: 0, vz: 160 });
  state.chests.next = 3;
  stepStage(state, {}, ridge);
  const boss = state.sortieBoss;
  const actor = state.enemies.find(enemy => enemy.id === boss.actorId);
  let samplesOnRidge = 0;
  for (let i = 0; i < 8 * TICKS_PER_SECOND; i++) {
    stepStage(state, {}, ridge);
    const escorts = boss.escortIds.map(id => state.enemies.find(candidate => candidate.id === id)).filter(Boolean);
    for (const enemy of [actor, ...escorts]) {
      const floor = ridge(enemy.x, enemy.z) + 22;
      assert.ok(enemy.alt >= floor - 1e-6);
      assert.ok(enemy.alt <= MAX_ALTITUDE);
      if (ridge(enemy.x, enemy.z) > 0) samplesOnRidge++;
    }
  }
  assert.ok(samplesOnRidge > 0, 'the actual actor/escort trajectories crossed the rising ridge');
});

test('miniboss attacks spend the threat hook and denial emits no volley', () => {
  for (const [index, points] of [[0, 2], [1, 1]]) {
    const requests = [];
    const hooks = {
      ...STANDALONE_SORTIE_BOSS_HOOKS,
      trySpendThreat(state, request) { requests.push({ state, request }); return false; },
    };
    const state = startEncounter(index, hooks);
    run(state, 7 * TICKS_PER_SECOND, hooks);
    assert.ok(requests.length > 0);
    assert.equal(requests[0].state, state);
    assert.deepEqual(Object.keys(requests[0].request).sort(), ['bearing', 'points', 'source', 'tick']);
    assert.equal(requests[0].request.source, SORTIE_MINIBOSS_CUES[index].threatSource);
    assert.equal(requests[0].request.points, points);
    assert.ok(Number.isFinite(requests[0].request.bearing));
    assert.equal(state.shots.filter(shot => shot.kind === 'hostile').length, 0);
  }
});

test('either miniboss kill pays one existing evolution chest and one midboss hook, then rests from completion', () => {
  for (const [index, chestId] of [[0, 'first-evolution'], [1, 'second-evolution']]) {
    const magnetCalls = [];
    const finishCalls = [];
    const dropEvents = { pickupDropped() {} };
    const hooks = {
      ...STANDALONE_SORTIE_BOSS_HOOKS,
      trySpendThreat: () => false,
      finishMidbossEncounter(state, result) { finishCalls.push({ state, result }); },
      dropMagnet(state, request, events) { magnetCalls.push({ state, request, events }); },
    };
    const state = startEncounter(index, hooks);
    const boss = state.sortieBoss;
    const actor = state.enemies.find(enemy => enemy.id === boss.actorId);
    actor.hp = 1;
    hurtEnemy(state, actor, 2);
    stepStage(state, {}, ground, undefined, dropEvents, hooks);

    assert.equal(boss.outcome, 'defeated');
    assert.equal(boss.endTick, state.tick);
    assert.equal(state.sortieLullUntil, boss.endTick + SORTIE_REST_TICKS);
    assert.deepEqual(state.chests.dropped, [chestId]);
    assert.equal(state.chests.drops.filter(drop => drop.id === chestId).length, 1);
    assert.equal(state.kills, 1);
    assert.equal(magnetCalls.length, 1);
    assert.equal(magnetCalls[0].request.sourceEventId, actor.id);
    assert.equal(magnetCalls[0].request.sourceKind, 'midboss');
    assert.equal(magnetCalls[0].events, dropEvents);
    assert.deepEqual(Object.keys(magnetCalls[0].request.position).sort(), ['alt', 'x', 'z']);
    assert.equal(finishCalls.length, 1);
    assert.equal(finishCalls[0].state, state);
    assert.deepEqual(finishCalls[0].result, { id: boss.cue.id, endedAt: boss.endTick, outcome: 'defeated' });
    stepStage(state, {}, ground, undefined, undefined, hooks);
    assert.equal(magnetCalls.length, 1);
    assert.equal(finishCalls.length, 1);
    assert.equal(state.chests.dropped.length, 1);
    assert.equal(state.chests.next, index === 0 ? 2 : 4);
  }
});

test('a 30-second miniboss retreat returns its actual tick and pays no rewards', () => {
  const magnetCalls = [];
  const finishCalls = [];
  const hooks = {
    ...STANDALONE_SORTIE_BOSS_HOOKS,
    trySpendThreat: () => false,
    finishMidbossEncounter(state, result) { finishCalls.push({ state, result }); },
    dropMagnet: (...args) => magnetCalls.push(args),
  };
  const state = startEncounter(1, hooks);
  const boss = state.sortieBoss;
  state.tick = boss.cue.startTick + boss.cue.maxDurationTicks - 1;
  stepStage(state, {}, ground, undefined, undefined, hooks);
  assert.equal(boss.outcome, 'retreated');
  assert.equal(boss.endTick, boss.cue.startTick + boss.cue.maxDurationTicks);
  assert.equal(state.sortieLullUntil, boss.endTick + SORTIE_REST_TICKS);
  assert.deepEqual(state.chests.dropped, []);
  assert.equal(state.kills, 0);
  assert.equal(magnetCalls.length, 0);
  assert.equal(finishCalls.length, 1);
  assert.equal(finishCalls[0].state, state);
  assert.deepEqual(finishCalls[0].result, { id: boss.cue.id, endedAt: boss.endTick, outcome: 'escaped' });
  assert.equal(state.pickups.length, 0);
});

test('the 3:35 and 6:45 swarm events are consumed during boss/rest and never launch afterward', () => {
  for (const [index, eventStart] of [[0, 215], [1, 405]]) {
    const state = startEncounter(index);
    const hooks = STANDALONE_SORTIE_BOSS_HOOKS;
    run(state, 45 * TICKS_PER_SECOND, hooks);
    assert.ok(state.suppressedSwarmEvents.includes(eventStart));
    assert.equal(state.enemies.filter(enemy => enemy.eventFlight).length, 0);
    assert.ok(state.tick >= (eventStart === 215 ? 250 : 445) * TICKS_PER_SECOND);
    run(state, 15 * TICKS_PER_SECOND, hooks);
    assert.equal(state.enemies.filter(enemy => enemy.eventFlight).length, 0,
      `suppressed ${eventStart}s event did not appear as a deferred crossing after rest`);
    assert.equal(state.swarmNotice?.kind, undefined);
  }
});
