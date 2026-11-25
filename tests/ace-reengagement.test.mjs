import assert from 'node:assert/strict';
import test from 'node:test';
import { ACE } from '../src/data/ace.ts';
import { TWIN_VOLLEYS, WEAPONS } from '../src/data/items.ts';
import { CRUISE_SPEED } from '../src/flight.ts';
import { flightCeiling } from '../src/maneuvers.ts';
import { aceReengagementCadence, advanceAce, makeAce } from '../src/ace.ts';
import { acquireAndFire, advanceShots, angleTo, BOLT_SPEED, HIT_WINDOW, hurtAce, MAX_ALTITUDE, TICKS_PER_SECOND, TWIN_CONE } from '../src/stage-combat.ts';
import { segmentSphereIntersection3d } from '../src/spatial.ts';
import { createStage, parseStageOptions, RUN_BOSS_TICK, RUN_END_TICK, stepStage } from '../src/stage.ts';
import { trySpendThreat } from '../src/threat-budget.ts';

const ground = () => 0;
const stage = (query = '?mode=survivors&fixture=ace') => createStage(parseStageOptions(query), ground);

function launchNaturalAce(groundFn = ground, courseRadius = null) {
  const state = createStage(parseStageOptions('?mode=survivors&autoplay=1&seed=13'), groundFn);
  state.tick = RUN_BOSS_TICK - 1;
  state.speed = CRUISE_SPEED;
  const course = courseRadius === null
    ? { x: 0, z: 0, yaw: 0, vx: 0, vz: CRUISE_SPEED }
    : { x: state.arena.x, z: state.arena.z + courseRadius, yaw: Math.PI / 2, vx: CRUISE_SPEED, vz: 0 };
  Object.assign(state.player, { ...course, altitude: 125 });
  stepStage(state, { boost: true }, groundFn);
  return { state, ace: state.boss, spawnTick: state.tick, groundFn };
}

function advanceAceOnCourse(state, ticks, groundFn = ground, radius = 800) {
  for (let i = 0; i < ticks; i++) {
    state.tick++;
    const player = state.player;
    player.yaw += CRUISE_SPEED / radius / TICKS_PER_SECOND;
    player.vx = Math.sin(player.yaw) * CRUISE_SPEED;
    player.vz = Math.cos(player.yaw) * CRUISE_SPEED;
    player.x += player.vx / TICKS_PER_SECOND;
    player.z += player.vz / TICKS_PER_SECOND;
    advanceAce(state, groundFn);
  }
}

function launchUnarmedAceNaturally() {
  const state = createStage(parseStageOptions('?mode=survivors&autoplay=1&seed=13'), ground);
  state.tick = RUN_BOSS_TICK - 1;
  state.speed = CRUISE_SPEED;
  state.twinAt = Number.MAX_SAFE_INTEGER;
  state.strafeAt = Number.MAX_SAFE_INTEGER;
  stepStage(state, {}, ground);
  return { state, ace: state.boss, spawnTick: state.tick };
}

function twinCollisionOpportunityTime(state, spawnTick, groundFn = ground) {
  const ace = state.boss, player = state.player;
  if (!ace || ace.entry) return null;
  const dx = ace.x - player.x, dz = ace.z - player.z;
  const range = Math.hypot(dx, dz);
  if (range > WEAPONS.twin.tuning.range || Math.abs(angleTo(player.yaw, dx, dz)) > TWIN_CONE
    || Math.abs(ace.alt - player.altitude) > HIT_WINDOW) return null;

  const lead = range / BOLT_SPEED;
  const forwardX = Math.sin(player.yaw), forwardZ = Math.cos(player.yaw);
  let earliest = Infinity;
  for (const offset of TWIN_VOLLEYS[2]) {
    const muzzleX = player.x + forwardX * 6 + forwardZ * offset;
    const muzzleZ = player.z + forwardZ * 6 - forwardX * offset;
    const yaw = Math.atan2(ace.x + ace.vx * lead - muzzleX, ace.z + ace.vz * lead - muzzleZ);
    const velocityX = Math.sin(yaw) * BOLT_SPEED, velocityZ = Math.cos(yaw) * BOLT_SPEED;
    const forecast = structuredClone(state);
    const forecastShot = { kind: 'twin', x: muzzleX, z: muzzleZ, alt: player.altitude,
      vx: velocityX, vz: velocityZ, life: 0.68 };
    forecast.shots = [forecastShot];
    let shotX = muzzleX, shotZ = muzzleZ;
    let previous = { x: shotX - ace.x, z: shotZ - ace.z, alt: player.altitude - ace.alt };
    for (let tick = 1; tick <= Math.ceil(0.68 * TICKS_PER_SECOND); tick++) {
      advanceNaturalPlayer(forecast, spawnTick);
      forecast.tick++;
      advanceAce(forecast, groundFn);
      shotX += velocityX / TICKS_PER_SECOND;
      shotZ += velocityZ / TICKS_PER_SECOND;
      forecastShot.x = shotX;
      forecastShot.z = shotZ;
      forecastShot.life -= 1 / TICKS_PER_SECOND;
      const futureAce = forecast.boss;
      const current = { x: shotX - futureAce.x, z: shotZ - futureAce.z, alt: player.altitude - futureAce.alt };
      const contact = segmentSphereIntersection3d(previous, current, { x: 0, z: 0, alt: 0 }, ACE.hitRadius);
      if (contact !== null) {
        const time = (tick - 1 + contact) / TICKS_PER_SECOND;
        if (time <= 0.68) earliest = Math.min(earliest, time);
        break;
      }
      previous = current;
      if (tick / TICKS_PER_SECOND >= earliest) break;
    }
  }
  return earliest < Infinity ? earliest : null;
}

function advanceNaturalPlayer(state, spawnTick) {
  const player = state.player;
  const speed = Math.hypot(player.vx ?? 0, player.vz ?? 0) || state.speed || CRUISE_SPEED;
  if (state.tick - spawnTick >= 5 * TICKS_PER_SECOND) player.yaw += speed / 700 / TICKS_PER_SECOND;
  const vx = Math.sin(player.yaw) * speed;
  const vz = Math.cos(player.yaw) * speed;
  player.vx = vx;
  player.vz = vz;
  player.x += vx / TICKS_PER_SECOND;
  player.z += vz / TICKS_PER_SECOND;
}

function advanceNaturalEncounter(state, ticks, spawnTick, groundFn = ground) {
  for (let i = 0; i < ticks; i++) {
    advanceNaturalPlayer(state, spawnTick);
    state.tick++;
    advanceAce(state, groundFn);
  }
}

test('natural Ace flight provides predicted Twin collision geometry within five seconds and repeats through 9:00+', () => {
  assert.equal(aceReengagementCadence(9 * 60 * TICKS_PER_SECOND - 1), 12 * TICKS_PER_SECOND);
  assert.equal(aceReengagementCadence(9 * 60 * TICKS_PER_SECOND), 10 * TICKS_PER_SECOND);
  const { state, ace, spawnTick } = launchUnarmedAceNaturally();
  const firstMinuteEnd = spawnTick + 60 * TICKS_PER_SECOND;
  const sampleEnd = spawnTick + 90 * TICKS_PER_SECOND;
  const windows = new Map();
  let firstOpportunity = null;
  const sampleWindow = () => {
    const plan = ace.reengagement;
    if (plan?.phase !== 'line') return;
    const opportunity = twinCollisionOpportunityTime(state, spawnTick);
    if (opportunity !== null && firstOpportunity === null) firstOpportunity = { tick: state.tick, flightSeconds: opportunity };
    const window = windows.get(plan.lineStartedAt) ?? { streak: 0, longest: 0 };
    if (opportunity === null) window.streak = 0;
    else {
      window.streak++;
      window.longest = Math.max(window.longest, window.streak);
    }
    windows.set(plan.lineStartedAt, window);
  };
  sampleWindow();
  while (state.tick < sampleEnd) {
    advanceNaturalEncounter(state, 1, spawnTick);
    sampleWindow();
  }

  assert.ok(firstOpportunity !== null, 'a predicted Twin segment intersects the Ace hull on the natural trajectory');
  assert.ok(firstOpportunity.tick - spawnTick + Math.ceil(firstOpportunity.flightSeconds * TICKS_PER_SECOND) <= 5 * TICKS_PER_SECOND,
    `time from natural spawn to predicted Twin contact is at most five seconds: ${JSON.stringify(firstOpportunity)}`);
  assert.equal(ace.hits, 0, 'predicted geometry is not counted as an actual Twin hit');
  assert.equal(ace.hp, ace.maxHp);

  const firstMinute = [...windows].filter(([startedAt, window]) =>
    startedAt < firstMinuteEnd && window.longest >= 3 * TICKS_PER_SECOND).map(([startedAt]) => startedAt).sort((a, b) => a - b);
  assert.ok(firstMinute.length >= 4, `expected four geometric Twin windows in the first minute, got ${firstMinute.length}: ${JSON.stringify([...windows].map(([tick, window]) => [tick, window.longest]))}`);
  for (let i = 0; i < firstMinute.length; i++) {
    assert.ok(windows.get(firstMinute[i]).longest >= 3 * TICKS_PER_SECOND);
    if (i + 1 < firstMinute.length) {
      const startedAt = firstMinute[i];
      const cadence = aceReengagementCadence(startedAt + ACE.reengagement.lineSeconds * TICKS_PER_SECOND);
      assert.equal(firstMinute[i + 1] - startedAt, cadence);
    }
  }

  const afterNine = [...windows].filter(([startedAt, window]) =>
    startedAt >= firstMinuteEnd && window.longest >= 3 * TICKS_PER_SECOND).map(([startedAt]) => startedAt).sort((a, b) => a - b);
  assert.ok(afterNine.length >= 2, `expected geometric Twin windows after 9:00, got ${afterNine.length}`);
  for (let i = 0; i + 1 < afterNine.length; i++) {
    const startedAt = afterNine[i];
    const cadence = aceReengagementCadence(startedAt + ACE.reengagement.lineSeconds * TICKS_PER_SECOND);
    assert.equal(afterNine[i + 1] - startedAt, cadence);
  }
});

test('natural Twin fire ticks, projectiles and Ace hits are measured separately', () => {
  const { state, ace, spawnTick } = launchUnarmedAceNaturally();
  state.shots = [];
  state.twinAt = state.tick;
  state.podsAt = Number.MAX_SAFE_INTEGER;
  state.strafeAt = Number.MAX_SAFE_INTEGER;
  const actualFireTicks = new Set();
  let twinProjectiles = 0, aceHits = 0;

  while (state.tick < spawnTick + 60 * TICKS_PER_SECOND) {
    advanceNaturalPlayer(state, spawnTick);
    state.tick++;
    advanceAce(state, ground);
    const existing = new Set(state.shots);
    const hitsBefore = ace.hits;
    acquireAndFire(state);
    for (const shot of state.shots) {
      if (!existing.has(shot) && shot.kind === 'twin') {
        actualFireTicks.add(state.tick);
        twinProjectiles++;
      }
    }
    advanceShots(state, ground);
    aceHits += ace.hits - hitsBefore;
  }

  assert.ok(actualFireTicks.size > 0, 'the live Twin path emitted actual firing ticks');
  assert.ok(twinProjectiles >= actualFireTicks.size, 'projectiles are counted separately from firing ticks');
  assert.ok(aceHits > 0, 'at least one live Twin projectile damaged the Ace');
  assert.ok(aceHits <= twinProjectiles, 'actual Ace hits cannot exceed launched Twin projectiles');
});

test('phase changes and incoming roll threats preserve the window without exempting hostile tells from cancellation', () => {
  const { state, ace } = launchNaturalAce();
  for (let i = 0; i < 10 * TICKS_PER_SECOND && ace.reengagement?.phase !== 'line'; i++) {
    advanceAceOnCourse(state, 1);
  }
  assert.equal(ace.reengagement?.phase, 'line', 'natural entry and flight reach a real firing line');
  const lineUntil = ace.reengagement.lineUntil;
  ace.hp = ace.maxHp * 0.65;
  ace.tell = {
    kind: 'gun', x: state.player.x, z: state.player.z, alt: state.player.altitude,
    since: state.tick, until: state.tick + 1,
  };
  ace.rollReadyAt = state.tick;
  state.shots.push({
    kind: 'twin', x: ace.x, z: ace.z - 20, alt: ace.alt,
    vx: 0, vz: 600, life: 1, damage: 1, volley: 1, nearMiss: false, lockId: null,
  });
  const range = Math.hypot(ace.x - state.player.x, ace.z - state.player.z);
  state.player.z += ACE.attack.range + range + 20;
  advanceAce(state, ground);
  assert.equal(ace.phase, 2);
  assert.equal(ace.tell, null, 'the hostile gun tell is still canceled when range is lost');
  assert.equal(ace.roll, null);
  assert.equal(ace.reengagement.lineUntil, lineUntil);

  state.tick++;
  advanceAce(state, ground);
  assert.equal(ace.roll, null);
  assert.equal(ace.reengagement.lineUntil, lineUntil);
});

test('natural reengagement stays inside the arena, above terrain and below the ceiling', () => {
  const edgeGround = () => 112;
  const state = createStage(parseStageOptions('?mode=survivors&autoplay=1&seed=13'), edgeGround);
  state.tick = RUN_BOSS_TICK - 1;
  state.speed = CRUISE_SPEED;
  Object.assign(state.player, {
    x: state.arena.x + state.arena.radius - 24, z: state.arena.z, yaw: 0,
    altitude: MAX_ALTITUDE, vx: 0, vz: CRUISE_SPEED,
  });
  stepStage(state, { boost: true }, edgeGround);
  const ace = state.boss;
  state.speed = 0;
  state.player.vx = state.player.vz = 0;
  let sampled = 0;
  for (let i = 0; i < 15 * TICKS_PER_SECOND; i++) {
    state.tick++;
    advanceAce(state, edgeGround);
    if (!ace.reengagement) continue;
    sampled++;
    const distance = Math.hypot(ace.x - state.arena.x, ace.z - state.arena.z);
    assert.ok(distance <= state.arena.radius - ACE.hitRadius + 1e-6);
    assert.ok(ace.alt >= edgeGround(ace.x, ace.z) + ACE.flight.clearance - 1e-6);
    assert.ok(ace.alt <= MAX_ALTITUDE);
  }
  assert.ok(sampled > 3 * TICKS_PER_SECOND);
});


test('expanded-altitude reengagement climbs into a real frontal firing line', () => {
  const state = stage();
  const ace = state.boss, player = state.player;
  Object.assign(player, { x: 0, z: 0, yaw: 0, vx: 0, vz: CRUISE_SPEED, altitude: 320 });
  delete ace.entry;
  Object.assign(ace, {
    x: 0, z: 180, alt: 125, yaw: Math.PI, vx: 0, vz: 0, tell: null, roll: null,
    attackAt: Number.MAX_SAFE_INTEGER, rollReadyAt: Number.MAX_SAFE_INTEGER,
    bandAt: Number.MAX_SAFE_INTEGER,
    reengagement: { phase: 'approach', startedAt: state.tick, side: 1 },
  });
  state.speed = CRUISE_SPEED;
  for (let i = 0; i < 12 * TICKS_PER_SECOND && ace.reengagement?.phase !== 'line'; i++) {
    state.tick++;
    advanceAce(state, ground);
  }
  assert.equal(ace.reengagement?.phase, 'line');
  assert.ok(ace.alt > MAX_ALTITUDE, `Ace follows the expanded Survivors ceiling: ${ace.alt}`);
  assert.ok(Math.abs(ace.alt - player.altitude) <= HIT_WINDOW);
  assert.ok(ace.alt <= flightCeiling(ground(ace.x, ace.z), true));
});

test('Ace approach follows an outside-arena pilot without extending the in-arena boundary', () => {
  const state = stage();
  const ace = state.boss, player = state.player;
  const edge = state.arena.x + state.arena.radius;
  Object.assign(player, {
    x: edge + 600, z: state.arena.z, yaw: Math.PI / 2,
    vx: 0, vz: 0, altitude: 125,
  });
  state.speed = 0;
  delete ace.entry;
  Object.assign(ace, {
    x: edge - 100, z: state.arena.z, yaw: Math.PI / 2,
    vx: 0, vz: 0, alt: 125, tell: null, roll: null,
    attackAt: Number.MAX_SAFE_INTEGER, rollReadyAt: Number.MAX_SAFE_INTEGER,
    bandAt: Number.MAX_SAFE_INTEGER,
    reengagement: { phase: 'approach', startedAt: state.tick, side: 1 },
  });
  for (let i = 0; i < 10 * TICKS_PER_SECOND; i++) {
    state.tick++;
    advanceAce(state, ground);
  }
  assert.ok(ace.x > edge + 100, `outside pilot is reachable: Ace x=${ace.x}, arena edge=${edge}`);
});

test('Ace reengagement moves continuously as an outside pilot re-enters the arena', () => {
  const state = stage();
  const ace = state.boss, player = state.player;
  const edge = state.arena.x + state.arena.radius;
  Object.assign(player, {
    x: edge + 1, z: state.arena.z, yaw: Math.PI / 2,
    vx: 0, vz: 0, altitude: 125,
  });
  state.speed = 0;
  delete ace.entry;
  Object.assign(ace, {
    x: edge + 100, z: state.arena.z, yaw: Math.PI / 2,
    vx: 0, vz: 0, alt: 125, tell: null, roll: null,
    attackAt: Number.MAX_SAFE_INTEGER, rollReadyAt: Number.MAX_SAFE_INTEGER,
    bandAt: Number.MAX_SAFE_INTEGER,
    reengagement: { phase: 'approach', startedAt: state.tick, side: 1 },
  });
  const previous = { x: ace.x, z: ace.z };

  player.x -= 2;
  player.vx = -120;
  state.tick++;
  advanceAce(state, ground);

  const displacement = Math.hypot(ace.x - previous.x, ace.z - previous.z);
  assert.ok(displacement < 10, `Ace approach remains continuous across the boundary: ${displacement}`);
});

test('Ace damage remains available outside reengagement windows', () => {
  const state = stage();
  const ace = state.boss;
  const hp = ace.hp;
  hurtAce(state, ace, 1);
  assert.ok(ace.hp < hp);
});

test('Ace attacks spend one shared threat slot and denial does not advance the attack pattern', () => {
  const readyAce = () => {
    const state = createStage(parseStageOptions('?mode=survivors&autoplay=1'), ground);
    const player = state.player;
    const ace = state.boss = makeAce(state, player.x, player.z + 100, ground);
    state.tick = 8 * 60 * TICKS_PER_SECOND;
    Object.assign(ace, {
      x: player.x, z: player.z + 100, alt: player.altitude, yaw: Math.PI,
      tell: null, roll: null, attackAt: state.tick, rollReadyAt: Number.MAX_SAFE_INTEGER,
      bandAt: Number.MAX_SAFE_INTEGER, reengagement: undefined,
    });
    return state;
  };

  const denied = readyAce();
  const deniedAce = denied.boss;
  const deniedAttacks = deniedAce.attacks;
  const requestTick = denied.tick + ACE.gun.warningTicks;
  assert.equal(trySpendThreat(denied, {
    tick: requestTick, source: 'regular:fixture', points: 2, bearing: 0,
  }), true);
  const existingSpends = denied.threatBudget.spends.length;
  advanceAce(denied, ground);
  assert.equal(denied.threatBudget.spends.length, existingSpends);
  assert.equal(deniedAce.tell, null);
  assert.equal(deniedAce.attacks, deniedAttacks);

  const admitted = readyAce();
  const admittedAce = admitted.boss;
  const admittedAttacks = admittedAce.attacks;
  advanceAce(admitted, ground);
  assert.deepEqual(admitted.threatBudget.spends.map(({ source, points }) => ({ source, points })),
    [{ source: 'ace', points: 2 }]);
  assert.equal(admitted.threatBudget.spends[0].tick, admitted.tick + ACE.gun.warningTicks);
  assert.equal(admittedAce.tell?.kind, 'gun');
  assert.equal(admittedAce.attacks, admittedAttacks + 1);
});

test('a lethal Ace hit on the 10:00 deadline tick still clears the sortie', () => {
  const state = stage();
  const ace = state.boss;
  const player = state.player;
  state.tick = RUN_END_TICK - 1;
  state.enemies = [];
  state.sortieLullUntil = RUN_END_TICK + 1;
  state.twinAt = state.podsAt = state.strafeAt = Number.MAX_SAFE_INTEGER;
  state.shots = [{
    kind: 'twin', x: player.x, z: player.z + 5, alt: MAX_ALTITUDE,
    vx: 0, vz: 1800, life: 1, damage: 10, volley: 1, nearMiss: false, lockId: null,
  }];
  Object.assign(ace, {
    x: player.x, z: player.z + 20, alt: MAX_ALTITUDE, band: 2, phase: 3,
    vx: 0, vz: 0, yaw: 0, hp: 1, tell: null, roll: null,
    attackAt: Number.MAX_SAFE_INTEGER, rollReadyAt: Number.MAX_SAFE_INTEGER,
    bandAt: Number.MAX_SAFE_INTEGER, reengageAt: undefined, reengagement: undefined,
  });
  stepStage(state, {}, ground);
  assert.equal(state.tick, RUN_END_TICK);
  assert.ok(ace.alt <= MAX_ALTITUDE);
  assert.equal(ace.hp, 0);
  assert.equal(state.phase, 'clear');
  assert.equal(state.summary.aceCache, true);
});
