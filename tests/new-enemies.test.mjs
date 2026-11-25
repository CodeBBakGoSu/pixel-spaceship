import assert from 'node:assert/strict';
import test from 'node:test';
import { autopilotInput } from '../src/autoplay.ts';
import { TICKS_PER_SECOND } from '../src/simulation-time.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { advanceEnemies, makeEnemy } from '../src/stage-enemies.ts';
import { trySpendThreat } from '../src/threat-budget.ts';
import { World } from '../src/world.ts';

const flat = () => 35;
const stage = () => createStage(parseStageOptions('?mode=survivors&t=0'), flat);

test('Twin Chaser locks its warned charge line instead of following a turning pilot', () => {
  const state = stage();
  const chaser = makeEnemy(state, 0, 80, 1, 'twin-chaser');
  chaser.maneuverAt = state.tick;
  state.enemies.push(chaser);
  advanceEnemies(state, flat);
  assert.equal(chaser.tell?.kind, 'charge');
  const target = { ...chaser.charge.target };
  state.player.yaw = Math.PI / 2;
  for (let tick = 1; tick <= 42; tick++) {
    state.tick = tick;
    advanceEnemies(state, flat);
  }
  assert.equal(chaser.charge.phase, 'charging');
  assert.deepEqual(chaser.charge.target, target);
});

test('Crosswing cancels its joint attack if either fighter is destroyed during warning', () => {
  const state = stage();
  const left = makeEnemy(state, -8, 80, 1, 'crosswing');
  const right = makeEnemy(state, 8, 80, 1, 'crosswing');
  left.maneuverAt = right.maneuverAt = state.tick;
  left.crosswing = { mate: right.id, side: -1 };
  right.crosswing = { mate: left.id, side: 1 };
  state.enemies.push(left, right);
  advanceEnemies(state, flat);
  assert.equal(left.tell?.kind, 'crossing');
  assert.equal(right.tell?.kind, 'crossing');
  right.hp = 0;
  state.tick++;
  advanceEnemies(state, flat);
  assert.equal(left.crosswing.phase, 'cancelled');
  assert.notEqual(left.tell?.kind, 'crossing');
});

test('minute-six Crosswing and Twin Chaser tells serialize when the first reservation is delayed', () => {
  const state = stage();
  state.tick = 360 * 60;
  const crosswing = makeEnemy(state, 0, 45, 1, 'crosswing');
  const mate = makeEnemy(state, -8, 45, 1, 'crosswing');
  const twin = makeEnemy(state, 80, -85, 0, 'twin-chaser');
  crosswing.crosswing = { mate: mate.id, side: -1 };
  mate.crosswing = { mate: crosswing.id, side: 1 };
  crosswing.maneuverAt = mate.maneuverAt = twin.maneuverAt = state.tick;
  state.enemies.push(crosswing, mate, twin);
  state.phaseDirector = { intro: 4, six: true, seven: false, manta: false, isolationUntil: 0,
    introIds: [], sixTellUntil: 0, sixCrosswingStarted: false, sixTwinStarted: false };
  state.threatBudget.spends.push(
    { tick: state.tick - 60, source: 'ace:one', points: 2, activeFromTick: state.tick - 60,
      activeUntilTick: state.tick + 300, bearing: Math.PI / 2 },
    { tick: state.tick - 120, source: 'ace:two', points: 2, activeFromTick: state.tick - 120,
      activeUntilTick: state.tick + 300, bearing: Math.PI },
  );

  advanceEnemies(state, flat);
  assert.equal(crosswing.tell, undefined);
  assert.equal(twin.tell?.kind, 'charge');
  const twinWarningEnd = twin.tell.until;
  state.tick = twinWarningEnd - 1;
  advanceEnemies(state, flat);
  assert.equal(crosswing.tell, undefined);
  assert.equal(twin.tell?.kind, 'charge');

  state.tick = twinWarningEnd;
  state.threatBudget.spends = state.threatBudget.spends.filter(spend => spend.source === `regular:${twin.id}`);
  advanceEnemies(state, flat);
  assert.equal(crosswing.tell?.kind, 'crossing');
  assert.equal(twin.tell, undefined);
});

test('Manta dives from above captured player height and follows its frozen 3D pass at high and low altitude', () => {
  for (const [playerHeight, startAltitude] of [[35, 110], [110, 35]]) {
    const state = stage();
    const ground = () => 0;
    state.player.altitude = playerHeight;
    const manta = makeEnemy(state, 0, 150, 2, 'manta');
    manta.alt = startAltitude;
    manta.maneuverAt = state.tick;
    state.enemies.push(manta);
    advanceEnemies(state, ground);

    assert.equal(manta.manta.phase, 'approach');
    assert.equal(manta.manta.playerHeight, playerHeight);
    const approach = { ...manta.manta.approach };
    state.player.yaw = Math.PI / 2;
    for (let tick = 1; tick <= 600 && manta.manta.phase === 'approach'; tick++) {
      state.tick = tick;
      advanceEnemies(state, ground);
    }
    assert.deepEqual(manta.manta.approach, approach);
    const climbDeadline = state.tick + 600;
    for (let tick = state.tick + 1; tick <= climbDeadline && manta.manta.phase !== 'warning'; tick++) {
      state.tick = tick;
      advanceEnemies(state, ground);
    }
    assert.equal(manta.manta.phase, 'warning');
    assert.equal(manta.alt, manta.manta.passAltitude);
    assert.ok(manta.manta.passStart.alt > playerHeight);
    assert.equal(manta.manta.passEnd.alt, playerHeight);
    assert.ok(manta.manta.passStart.alt > manta.manta.passEnd.alt);
    const passStart = { ...manta.manta.passStart };
    const passEnd = { ...manta.manta.passEnd };
    state.player.x += 250;
    state.player.z -= 180;
    state.player.yaw = -Math.PI / 2;
    assert.deepEqual(manta.tell.target, passEnd);

    const warningEnd = manta.manta.until;
    for (let tick = state.tick + 1; tick <= warningEnd; tick++) {
      state.tick = tick;
      advanceEnemies(state, ground);
    }
    const passDeadline = state.tick + 600;
    let descended = false;
    for (let tick = state.tick + 1; tick <= passDeadline && manta.manta.phase === 'pass'; tick++) {
      state.tick = tick;
      advanceEnemies(state, ground);
      descended ||= manta.alt < passStart.alt;
    }
    assert.equal(manta.manta.phase, 'exit');
    assert.ok(descended);
    assert.deepEqual({ x: manta.x, z: manta.z, alt: manta.alt }, passEnd);
    assert.deepEqual(manta.manta.passStart, passStart);
    assert.deepEqual(manta.manta.passEnd, passEnd);

    const exitDeadline = state.tick + 600;
    for (let tick = state.tick + 1; tick <= exitDeadline && manta.manta; tick++) {
      state.tick = tick;
      advanceEnemies(state, ground);
    }
    assert.equal(manta.manta, undefined);
    assert.equal(manta.alt, playerHeight);
    assert.equal(Math.hypot(manta.x - passEnd.x, manta.z - passEnd.z) > 0, true);
  }
});

test('seed 3 assisted stepStage Manta descends to its captured height and exits horizontally', () => {
  const world = new World();
  const ground = (x, z) => world.height(x, z);
  const state = createStage(parseStageOptions('?autoplay=1&mode=survivors&seed=3'), ground);
  const scheduledTick = 260 * TICKS_PER_SECOND;
  let actualSpawnTick, firstAttackTick, warning, exitStarted, exited, descended = false;
  for (let frame = 0; frame < 275 * TICKS_PER_SECOND && !exited; frame++) {
    if (state.tick >= scheduledTick) state.enemies = state.enemies.filter(enemy => enemy.kind === 'manta');
    state.shots.length = 0;
    const input = autopilotInput(state, 'full', ground);
    input.fire = false;
    stepStage(state, input, ground);
    const manta = state.enemies.find(enemy => enemy.kind === 'manta');
    if (!manta) continue;
    actualSpawnTick ??= state.tick;
    const flight = manta.manta;
    if (flight?.phase === 'warning' && !warning) {
      firstAttackTick ??= state.tick;
      warning = {
        tick: state.tick, start: { ...flight.passStart }, end: { ...flight.passEnd }, playerHeight: flight.playerHeight,
        exitTarget: { ...flight.exitTarget },
      };
    }
    if (warning && flight) {
      assert.deepEqual(flight.passStart, warning.start);
      assert.deepEqual(flight.passEnd, warning.end);
    }
    if (flight?.phase === 'pass' && warning && manta.alt < warning.start.alt) descended = true;
    if (flight?.phase === 'exit' && !exitStarted) {
      exitStarted = { x: manta.x, z: manta.z, alt: manta.alt, target: flight.exitTarget, height: flight.playerHeight };
    }
    if (warning && exitStarted && !flight) exited = { x: manta.x, z: manta.z, alt: manta.alt };
  }
  const trace = `scheduled=${scheduledTick} spawned=${actualSpawnTick} firstAttack=${firstAttackTick}`;
  assert.ok(actualSpawnTick >= scheduledTick, trace);
  assert.ok(firstAttackTick >= actualSpawnTick, trace);
  assert.ok(warning, trace);
  assert.ok(warning.start.alt > warning.playerHeight);
  assert.equal(warning.end.alt, warning.playerHeight);
  assert.ok(descended);
  assert.ok(exitStarted);
  assert.equal(exitStarted.alt, warning.playerHeight);
  assert.equal(exitStarted.height, warning.playerHeight);
  assert.ok(exited);
  assert.equal(exited.x, warning.exitTarget.x);
  assert.equal(exited.z, warning.exitTarget.z);
  assert.equal(exited.alt, warning.playerHeight);
  assert.ok(Math.hypot(exited.x - warning.end.x, exited.z - warning.end.z) > 0);
});

test('low-altitude Manta climbs above a ridge before continuing its approach', () => {
  const state = stage();
  const ridge = (x, z) => x > -500 && x < 500 && z > -190 && z < -120 ? 100 : 35;
  Object.assign(state.player, { x: 0, z: -85, yaw: 0, altitude: 80 });
  const manta = makeEnemy(state, 0, 50, 2, 'manta');
  manta.alt = 70;
  manta.maneuverAt = state.tick;
  state.enemies.push(manta);
  advanceEnemies(state, ridge);

  for (let tick = 1; tick <= 1200 && manta.manta.phase === 'approach'; tick++) {
    state.tick = tick;
    advanceEnemies(state, ridge);
  }
  assert.notEqual(manta.manta.phase, 'approach');
  assert.ok(manta.z < -120);
  assert.ok(manta.alt >= 100 + 22);
});

test('Mender repairs damaged Aegis after a short uninterrupted 3D tether', () => {
  const state = stage();
  const escort = makeEnemy(state, 0, 15, 1, 'aegis');
  escort.hp = escort.maxHp - 1;
  const mender = makeEnemy(state, 0, 25, 1, 'mender');
  mender.shotAt = state.tick;
  state.enemies.push(escort, mender);
  advanceEnemies(state, flat);
  assert.equal(escort.hp, escort.maxHp - 1);
  assert.equal(mender.tell?.kind, 'repair');
  state.tick = mender.tell.until - 1;
  advanceEnemies(state, flat);
  assert.equal(escort.hp, escort.maxHp - 1);
  state.tick++;
  advanceEnemies(state, flat);
  assert.equal(escort.hp, escort.maxHp);
});

test('player crossing the 3D repair tether interrupts healing', () => {
  const state = stage();
  const escort = makeEnemy(state, 0, 20, 1, 'aegis');
  escort.hp--;
  const mender = makeEnemy(state, 0, 30, 1, 'mender');
  mender.shotAt = state.tick;
  state.enemies.push(escort, mender);
  advanceEnemies(state, flat);
  state.player.x = 0;
  state.player.z = 25;
  state.player.altitude = mender.alt;
  state.tick = mender.tell.until - 1;
  advanceEnemies(state, flat);
  assert.equal(escort.hp, escort.maxHp - 1);
  assert.equal(mender.tell, undefined);
});

test('Diver does not commit a dive maneuver when its threat reservation is denied', () => {
  const state = stage();
  const diver = makeEnemy(state, 0, 80, 1, 'diver');
  diver.maneuverAt = state.tick;
  state.enemies.push(diver);
  state.threatBudget.spends.push({ tick: 72, source: 'ace', points: 4, bearing: 0 });
  advanceEnemies(state, flat);
  assert.equal(diver.maneuver, null);
  assert.equal(diver.tell, undefined);
});

test('elite Aegis reuses its warning for a spaced second shot', () => {
  const state = stage();
  const aegis = makeEnemy(state, 0, 40, 1, 'aegis');
  aegis.elite = true;
  aegis.shotAt = state.tick;
  state.enemies.push(aegis);
  advanceEnemies(state, flat);
  assert.equal(aegis.tell?.kind, 'aegis');
  const warningStart = aegis.tell.started;
  state.tick = aegis.tell.until;
  advanceEnemies(state, flat);
  assert.equal(aegis.eliteVolley.started, warningStart);
  assert.equal(aegis.tell?.until, aegis.eliteVolley.secondAt);
  state.tick = aegis.eliteVolley.secondAt - 1;
  advanceEnemies(state, flat);
  assert.ok(aegis.eliteVolley);
  state.tick++;
  advanceEnemies(state, flat);
  assert.equal(aegis.eliteVolley, undefined);
  assert.equal(aegis.tell, undefined);
});
