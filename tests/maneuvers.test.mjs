import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { autopilotInput } from '../src/autoplay.ts';
import { scaleTravel } from '../src/data/speed.ts';
import * as moves from '../src/maneuvers.ts';
import { advanceRearBombs, HIT_WINDOW } from '../src/stage-combat.ts';

const pursuit = (view = 'chase') => createStage(parseStageOptions('?fixture=pursuit&view=' + view));
const run = (state, ticks, input = {}, ground) => {
  for (let i = 0; i < ticks; i++) stepStage(state, input, ground);
};
const empty = () => {
  const state = pursuit();
  state.enemies = [];
  return state;
};

test('pursuit fixture starts with a three-band group aft', () => {
  const state = createStage(parseStageOptions('?fixture=pursuit'));
  assert.equal(state.phase, 'playing');
  assert.equal(state.view, 'chase');
  assert.equal(state.player.altitude, 125);
  assert.equal(state.enemies.length, 4);
  assert.ok(state.enemies.every(enemy => enemy.z < state.player.z - 50));
  assert.deepEqual([...new Set(state.enemies.map(enemy => enemy.alt))].sort((a, b) => a - b), [75, 125, 180]);
});

test('full autoplay uses a charged J-turn against a distant level pursuer', () => {
  const state = pursuit();
  assert.equal(autopilotInput(state).maneuver, 'j-turn');
});

for (const [kind, flipTick, ticks, altitude, yaw, cooldown] of [
  ['immelmann', 78, 252, 180, Math.PI, 240],
  ['split-s', 98, 272, 75, Math.PI, 240],
  ['j-turn', 1, 52, 125, Math.PI, 420],
]) {
  test(`${kind} finishes on tick ${ticks} and starts its cooldown at the flip`, () => {
    const state = empty();
    const { x, z } = state.player;
    const startTick = state.tick;
    const first = { maneuver: kind, turn: 1, climb: 1, boost: true, bomb: true };
    run(state, 1, first);
    if (kind === 'j-turn') {
      assert.ok(Math.abs(state.player.yaw) > 3.1);
      assert.equal(state.boost, 0.6);
    } else {
      run(state, flipTick - 2, { boost: true });
      assert.equal(state.maneuverReadyAt, 0);
      run(state, 1, { boost: true });
    }
    const readyAt = startTick + flipTick + cooldown;
    assert.equal(state.maneuverReadyAt, readyAt);
    assert.equal(state.maneuver?.kind, kind);
    run(state, ticks - flipTick - 1, { boost: true });
    assert.equal(state.maneuver?.kind, kind);
    run(state, 1);
    assert.equal(state.tick - startTick, ticks);
    assert.equal(state.maneuver, null);
    assert.equal(state.player.altitude, altitude);
    assert.ok(Math.abs(Math.abs(state.player.yaw) - yaw) < 1e-9);
    assert.equal(state.bombs, 3);
    assert.equal(state.maneuverReadyAt, readyAt);
    assert.equal(state.invulnerability, 0);
    assert.ok(Math.hypot(state.player.x - x, state.player.z - z) >= 10);
    run(state, readyAt - state.tick - 1, { maneuver: 'immelmann' });
    assert.equal(state.tick, readyAt - 1);
    assert.equal(state.maneuver, null);
    assert.equal(moves.canManeuver(state, 'immelmann'), false);
    run(state, 1, { maneuver: 'immelmann' });
    assert.equal(state.maneuver?.kind, 'immelmann');
  });
}

test('J-turn requires charge and keeps precise launch altitude', () => {
  const state = empty();
  state.player.altitude = 112.5;
  state.boost = 0.39;
  run(state, 1, { maneuver: 'j-turn' });
  assert.equal(state.player.yaw, 0);
  assert.equal(state.maneuverReadyAt, 0);
  state.boost = 0.4;
  run(state, 1, { maneuver: 'j-turn' });
  assert.equal(state.boost, 0);
  assert.equal(state.player.altitude, 112.5);
  assert.ok(Math.abs(state.player.yaw) > 3.1);
});

test('C no longer selects a maneuver and Space respects the direction selectors', () => {
  assert.equal(moves.maneuverForKey('Space', 0, 0), 'immelmann');
  assert.equal(moves.maneuverForKey('Space', 0, 1), 'immelmann');
  assert.equal(moves.maneuverForKey('Space', 0, -1), 'split-s');
  assert.equal(moves.maneuverForKey('Space', 1, 0), 'j-turn');
  assert.equal(moves.maneuverForKey('KeyC', 0, 0), undefined);
  const state = createStage(parseStageOptions('?fixture=cobra'));
  assert.equal(state.phase, 'title');
  run(state, 1, { start: true });
  run(state, 1, { maneuver: 'cobra' });
  assert.equal(state.maneuver, null);
});

test('J-turn snaps its flight heading, traces a displaced U and lets the view catch up', () => {
  const state = empty();
  const { x, z } = state.player;
  run(state, 1, { maneuver: 'j-turn', turn: -1 });
  assert.ok(Math.abs(state.player.yaw) > 3.1);
  const wrapped = yaw => Math.atan2(Math.sin(yaw), Math.cos(yaw));
  assert.ok(Math.abs(wrapped(moves.maneuverViewYaw?.(state))) < 0.001);
  run(state, 10);
  assert.ok(state.player.x < x - 6 && state.player.z > z + 6);
  assert.ok(Math.abs(wrapped(moves.maneuverViewYaw(state))) > 0.1);
  run(state, 15);
  assert.ok(state.player.z > z + 100);
  assert.ok(state.player.x < x - 80);
  run(state, 26);
  assert.ok(Math.abs(state.player.x - x + 44) < 1e-8);
  assert.ok(Math.abs(state.player.z - z - 136) < 1e-8);
  assert.equal(state.maneuverTrail.points.at(-1).x, state.player.x);
  run(state, 1);
  assert.ok(state.speed > moves.CRUISE_SPEED);
  assert.ok(Math.abs(wrapped(moves.maneuverViewYaw(state) - state.player.yaw)) < 1e-6);
});

for (const [kind, flipTick, expectedAltitude] of [['immelmann', 78, 180], ['split-s', 98, 75]]) {
  test(`${kind} carries flight forward before spending 2.5 seconds level and inverted`, () => {
    const state = empty();
    const start = { ...state.player };
    run(state, 1, { maneuver: kind });
    let maxForward = 0;
    for (let tick = 1; tick < flipTick; tick++) {
      run(state, 1);
      maxForward = Math.max(maxForward, state.player.z - start.z);
    }
    assert.ok(maxForward > 210, `maximum forward travel was ${maxForward} m`);
    assert.ok(state.player.z > start.z + 180);
    assert.ok(Math.abs(state.player.x - start.x) >= 36);
    assert.ok(Math.abs(state.player.yaw) > 3.1);
    const turnZ = state.player.z;
    for (let tick = 0; tick < 150; tick++) {
      run(state, 1);
      const attitude = moves.maneuverAttitude(state.maneuver);
      assert.equal(state.player.altitude, expectedAltitude);
      assert.equal(attitude.inverted, true);
      assert.equal(attitude.roll, Math.PI);
    }
    assert.ok(state.player.z < turnZ - 160);
    run(state, 12);
    assert.ok(moves.maneuverAttitude(state.maneuver).roll < Math.PI);
    run(state, 12);
    assert.equal(state.maneuver, null);
    assert.equal(moves.activeTrail(state).points.length, Math.ceil((flipTick + 150 + 24) / moves.TRAIL_SAMPLE_TICKS) + 1);
    run(state, 120);
    assert.ok(moves.activeTrail(state));
  });
}

test('a loop at the extreme band returns to its launch height and marks the limit', () => {
  for (const [maneuver, altitude] of [['immelmann', 186], ['split-s', 49]]) {
    const state = empty();
    state.player.altitude = altitude;
    if (maneuver === 'split-s') state.player.skim = 'water';
    run(state, 1, { maneuver });
    assert.equal(state.maneuverTrail?.limited, true);
    run(state, moves.MANEUVERS[maneuver].ticks - 1);
    assert.equal(state.player.altitude, altitude);
  }
});

test('Split-S from LOW clears raised terrain and settles into SKIM', () => {
  const state = empty();
  state.player.altitude = 75;
  run(state, 1, { maneuver: 'split-s' }, () => 49);
  for (let tick = 2; tick <= moves.MANEUVERS['split-s'].ticks; tick++) {
    run(state, 1, {}, () => 49);
    assert.ok(state.player.altitude >= 63);
  }
  assert.equal(state.player.altitude, 63);
  assert.equal(state.player.skim, 'land');
});

test('pause freezes maneuvers and preserves view-independent flight on resume', () => {
  const state = empty(), baseline = empty();
  run(state, 1, { maneuver: 'immelmann' });
  run(state, 1, { pause: true });
  run(state, 120, { maneuver: 'j-turn' });
  assert.equal(state.maneuver?.elapsed, 1);
  run(state, 1, { pause: true });
  run(state, 1, { toggleView: true });
  assert.equal(state.view, 'cockpit');
  run(state, moves.MANEUVERS.immelmann.ticks - 2);
  run(baseline, 1, { maneuver: 'immelmann' });
  run(baseline, moves.MANEUVERS.immelmann.ticks - 1);
  assert.deepEqual(state.player, baseline.player);
  assert.equal(state.maneuverReadyAt, baseline.maneuverReadyAt);
});

test('after boost the Immelmann brings the high-band rear contact into a forward volley while inverted', () => {
  const state = pursuit();
  const high = state.enemies.find(enemy => enemy.alt === 180);
  run(state, 30, { boost: true });
  run(state, 1, { maneuver: 'immelmann' });
  run(state, moves.MANEUVERS.immelmann.flipTick - 1);
  assert.equal(state.player.altitude, 180);
  assert.ok(moves.formerPursuer(state, moves.activeTrail(state), high));
  run(state, 135);
  assert.equal(moves.maneuverAttitude(state.maneuver).inverted, true);
  assert.equal(high.hp, 0);
});

test('the inverted flight accepts live steering and climb commands', () => {
  const state = empty();
  const baseline = empty();
  for (const flight of [state, baseline]) {
    run(flight, 1, { maneuver: 'split-s' });
    run(flight, 120);
  }
  run(state, 18, { turn: 0.65, climb: 0.45 });
  run(baseline, 18);
  assert.ok(Math.abs(state.player.yaw - baseline.player.yaw) > 0.2);
  assert.ok(Math.abs(state.player.x - baseline.player.x) > 1);
  assert.ok(state.player.altitude > baseline.player.altitude + 4);
  assert.equal(moves.maneuverAttitude(state.maneuver, state.player.bank).inverted, true);
  const releaseAltitude = state.player.altitude;
  run(state, 90);
  assert.ok(state.player.altitude > releaseAltitude && Math.abs(state.climbRate) < 0.001);
  const beforeRollAltitude = state.player.altitude;
  run(state, moves.MANEUVERS['split-s'].ticks - state.maneuver.elapsed);
  assert.ok(Math.abs(state.player.altitude - beforeRollAltitude) < 0.001);
});

function placeContact(state) {
  const contact = pursuit().enemies.find(enemy => enemy.alt === 125);
  const { x, z, altitude: alt } = state.player;
  Object.assign(contact, { x, z, alt, shotAt: Infinity, maneuverAt: Infinity, hp: 50,
    course: { target: { x, z }, speed: 0, until: state.tick + 2 } });
  state.enemies = [contact];
  return contact;
}

test('post-maneuver contact grace protects both aircraft through the next 36 ticks', () => {
  const state = empty();
  run(state, 1, { maneuver: 'j-turn' });
  run(state, 50);
  const finishing = placeContact(state);
  run(state, 1);
  assert.equal(state.hull, state.maxHull);
  assert.ok(finishing.hp > 0);
  assert.equal(state.maneuver, null);
  for (let tick = 1; tick <= 36; tick++) {
    const contact = placeContact(state);
    run(state, 1);
    assert.ok(contact.hp > 0, `contact was destroyed at grace tick ${tick}`);
    assert.equal(state.hull, state.maxHull);
  }
  placeContact(state);
  run(state, 1);
  assert.equal(state.hull, state.maxHull - 2);
});

test('hostile shots still damage the player during body grace', () => {
  const state = empty();
  run(state, 1, { maneuver: 'j-turn' });
  run(state, 51);
  assert.equal(state.maneuver, null);
  const { x, z, altitude: alt } = state.player;
  state.shots.push({ x, z, alt, kind: 'hostile', life: 2, damage: 2, vx: 0, vz: 0, volley: 0,
    nearMiss: false, lockId: null });
  run(state, 1);
  assert.equal(state.hull, state.maxHull - 2);
});

test('rear bomb coasts at its release altitude and falls after 27 ticks', () => {
  const state = empty();
  run(state, 1, { bomb: true });
  assert.equal(state.bombs, 2);
  const bomb = state.rearBombs[0];
  assert.ok(bomb.z < state.player.z - scaleTravel(8));
  assert.equal(bomb.alt, 125);
  const z = bomb.z;
  run(state, 1, { maneuver: 'j-turn' });
  run(state, 26);
  assert.equal(bomb.alt, 125);
  assert.ok(bomb.z < z);
  run(state, 1);
  assert.ok(Math.abs(bomb.alt - 124.4) < 1e-9);
  run(state, 200);
  assert.equal(state.rearBombs.length, 0);
});

test('falling bomb damage is altitude gated and clears only nearby hostile shots at any height', () => {
  const state = empty();
  const targets = createStage(parseStageOptions('?fixture=stack')).enemies;
  run(state, 1, { bomb: true });
  const bomb = state.rearBombs[0];
  run(state, 100);
  assert.ok(bomb.alt > 75 && bomb.alt < 83);
  for (const target of targets) {
    Object.assign(target, { x: bomb.x, z: bomb.z, shotAt: state.tick + 200 });
  }
  state.enemies = targets;
  const hostile = { x: bomb.x, z: bomb.z, alt: 180, vx: 0, vz: 0, kind: 'hostile', life: 2, damage: 2 };
  const outside = { ...hostile, x: bomb.x + scaleTravel(41) };
  state.shots.push(hostile, outside);
  run(state, 1);
  assert.equal(state.rearBombs.length, 0);
  assert.deepEqual(state.enemies.map(enemy => enemy.alt), [125, 180]);
  assert.deepEqual(state.shots.filter(shot => shot.kind === 'hostile'), [outside]);
});

test('a falling bomb detonates when it reaches the Ace’s altitude damage window', () => {
  const state = createStage(parseStageOptions('?fixture=boss'));
  const ace = state.boss;
  const bomb = { x: ace.x, z: ace.z, alt: ace.alt + HIT_WINDOW + 1.5, vx: 0, vz: 0, born: state.tick - 27 };
  state.rearBombs.push(bomb);
  for (let tick = 0; tick < 2; tick++) {
    state.tick++;
    advanceRearBombs(state, () => 35);
    assert.equal(state.rearBombs.length, 1);
    assert.equal(ace.hp, ace.maxHp);
  }
  state.tick++;
  advanceRearBombs(state, () => 35);
  assert.equal(state.rearBombs.length, 0);
  assert.equal(ace.hp, ace.maxHp - 4);
});

test('rear stores enforce 24 ticks between drops and refill one charge every 450 active ticks', () => {
  const state = empty();
  const initialTick = state.tick;
  run(state, 1, { bomb: true });
  run(state, 23, { bomb: true });
  assert.equal(state.bombs, 2);
  run(state, 1, { bomb: true });
  assert.equal(state.bombs, 1);
  run(state, 1, { pause: true });
  run(state, 500);
  assert.equal(state.bombs, 1);
  run(state, 1, { pause: true });
  run(state, initialTick + 450 - state.tick);
  assert.equal(state.bombs, 1);
  run(state, 1);
  assert.equal(state.bombs, 2);
  run(state, 450);
  assert.equal(state.bombs, 3);
  assert.equal(state.bombReloadAt, null);
});

test('all three maneuvers cross the old rim and stay available in streamed airspace', () => {
  for (const kind of ['immelmann', 'split-s', 'j-turn']) {
    const state = pursuit();
    const { player, arena } = state;
    assert.ok(arena.radius >= Math.sqrt(10) * 560);
    state.enemies.length = 0;
    Object.assign(player, { x: arena.x + arena.radius - 0.2, z: arena.z, yaw: Math.PI / 2 });
    let passed = false;
    for (let n = 0; n < moves.MANEUVERS[kind].ticks; n++) {
      stepStage(state, n === 0 ? { maneuver: kind } : {});
      passed ||= player.x > arena.x + arena.radius;
      assert.equal(state.boundaryWarning, false);
    }
    assert.ok(passed);
    assert.ok(state.maneuverReadyAt > state.tick);
  }
});
