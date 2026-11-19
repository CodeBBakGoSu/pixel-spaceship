import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { autopilotInput } from '../src/autoplay.ts';
import * as moves from '../src/maneuvers.ts';

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
  assert.equal(state.player.altitude, 110);
  assert.equal(state.enemies.length, 4);
  assert.ok(state.enemies.every(enemy => enemy.z < state.player.z - 50));
  assert.deepEqual([...new Set(state.enemies.map(enemy => enemy.alt))].sort((a, b) => a - b), [75, 110, 145]);
});

test('full autoplay uses a charged J-turn against a distant level pursuer', () => {
  const state = pursuit();
  assert.equal(autopilotInput(state).maneuver, 'j-turn');
});

for (const [kind, ticks, altitude, yaw, cooldown] of [
  ['immelmann', 90, 145, Math.PI, 240],
  ['split-s', 90, 75, Math.PI, 240],
  ['cobra', 60, 110, 0, 180],
  ['j-turn', 20, 110, Math.PI, 420],
]) {
  test(`${kind} hands back on tick ${ticks} at the specified altitude and heading`, () => {
    const state = empty();
    const { x, z } = state.player;
    const startTick = state.tick;
    const first = { maneuver: kind, turn: 1, climb: 1, boost: true, bomb: true };
    run(state, 1, first);
    if (kind === 'j-turn') {
      assert.ok(Math.abs(state.player.yaw) > 3.1);
      assert.equal(state.boost, 0.6);
    }
    assert.equal(state.maneuver?.kind, kind);
    run(state, ticks - 2, { turn: 1, climb: 1, boost: true });
    assert.equal(state.maneuver?.kind, kind);
    run(state, 1);
    assert.equal(state.tick - startTick, ticks);
    assert.equal(state.maneuver, null);
    assert.equal(state.player.altitude, altitude);
    assert.ok(Math.abs(Math.abs(state.player.yaw) - yaw) < 1e-9);
    assert.equal(state.bombs, 3);
    assert.equal(state.maneuverReadyAt, state.tick + cooldown);
    assert.equal(state.invulnerability, 0);
    if (kind !== 'cobra') assert.ok(Math.hypot(state.player.x - x, state.player.z - z) >= 10);
    run(state, cooldown - 1, { maneuver: 'cobra' });
    assert.equal(state.maneuver, null);
    run(state, 1, { maneuver: 'cobra' });
    assert.equal(state.maneuver?.kind, 'cobra');
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

test('C alone queues Cobra, and Space respects the climb and dive selectors', () => {
  assert.equal(moves.maneuverForKey?.('Space', 0, 1, false), 'immelmann');
  assert.equal(moves.maneuverForKey?.('Space', 0, -1, false), 'split-s');
  assert.equal(moves.maneuverForKey?.('KeyC', 0, 0, false), 'cobra');
  const state = empty();
  run(state, 1, { maneuver: moves.maneuverForKey('KeyC', 0, 0, false) });
  assert.equal(state.maneuver?.kind, 'cobra');
});

test('J-turn snaps its flight heading, traces a displaced U and lets the view catch up', () => {
  const state = empty();
  const { x, z } = state.player;
  run(state, 1, { maneuver: 'j-turn', turn: -1 });
  assert.ok(Math.abs(state.player.yaw) > 3.1);
  const wrapped = yaw => Math.atan2(Math.sin(yaw), Math.cos(yaw));
  assert.ok(Math.abs(wrapped(moves.maneuverViewYaw?.(state))) < 0.001);
  run(state, 10);
  assert.ok(state.player.x < x - 3 && state.player.z > z + 3);
  assert.ok(Math.abs(wrapped(moves.maneuverViewYaw(state))) > 0.1);
  run(state, 9);
  assert.ok(state.player.x < x - 14 && state.player.z < z - 4);
  assert.equal(state.maneuverTrail.points.at(-1).x, state.player.x);
  run(state, 1);
  assert.ok(state.speed > moves.CRUISE_SPEED);
  run(state, 18);
  assert.ok(Math.abs(wrapped(moves.maneuverViewYaw(state) - state.player.yaw)) < 1e-6);
});

test('a loop at the extreme band returns to its launch height and marks the limit', () => {
  for (const [maneuver, altitude] of [['immelmann', 151], ['split-s', 72]]) {
    const state = empty();
    state.player.altitude = altitude;
    run(state, 1, { maneuver });
    assert.equal(state.maneuverTrail?.limited, true);
    run(state, 89);
    assert.equal(state.player.altitude, altitude);
  }
});

test('Split-S at the low band guards terrain clearance throughout the dive', () => {
  const state = empty();
  state.player.altitude = 75;
  run(state, 1, { maneuver: 'split-s' }, () => 49);
  for (let tick = 2; tick <= 90; tick++) {
    run(state, 1, {}, () => 49);
    assert.ok(state.player.altitude >= 71);
  }
  assert.equal(state.player.altitude, 75);
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
  run(state, 88);
  run(baseline, 1, { maneuver: 'immelmann' });
  run(baseline, 89);
  assert.deepEqual(state.player, baseline.player);
  assert.equal(state.maneuverReadyAt, baseline.maneuverReadyAt);
});

test('after boost the Immelmann brings the high-band rear contact into Twin range', () => {
  const state = pursuit();
  const high = state.enemies.find(enemy => enemy.alt === 145);
  run(state, 30, { boost: true });
  run(state, 1, { maneuver: 'immelmann' });
  run(state, 89);
  assert.equal(state.player.altitude, 145);
  assert.equal(high.hp, 2);
  run(state, 36);
  assert.equal(high.hp, 0);
});

test('Cobra lets a close same-band pursuer pass safely into a forward volley', () => {
  const state = pursuit();
  const near = state.enemies.find(enemy => enemy.alt === 110);
  near.x = state.player.x;
  near.z = state.player.z - 20;
  state.enemies = [near];
  run(state, 1, { maneuver: 'cobra' });
  run(state, 8);
  assert.equal(state.speed, 2);
  run(state, 51);
  assert.ok(near.z > state.player.z);
  assert.ok(moves.formerPursuer(state, moves.activeTrail(state), near));
  assert.equal(state.hull, 8);
  run(state, 16);
  assert.equal(near.hp, 0);
});

test('the Cobra fixture keeps the close pass available after the pilot waits', () => {
  const state = createStage(parseStageOptions('?fixture=cobra'));
  const before = state.enemies.map(enemy => [enemy.x, enemy.z]);
  run(state, 300);
  assert.deepEqual(state.enemies.map(enemy => [enemy.x, enemy.z]), before);
  run(state, 1, { maneuver: moves.maneuverForKey('KeyC', 0, 0, false) });
  run(state, 40);
  assert.ok(state.enemies.some(enemy => moves.formerPursuer(state, moves.activeTrail(state), enemy)));
  assert.equal(state.hull, 8);
});

test('rear bomb coasts at its release altitude and falls after 27 ticks', () => {
  const state = empty();
  run(state, 1, { bomb: true });
  assert.equal(state.bombs, 2);
  const bomb = state.rearBombs[0];
  assert.ok(bomb.z < state.player.z - 8);
  assert.equal(bomb.alt, 110);
  const z = bomb.z;
  run(state, 1, { maneuver: 'j-turn' });
  run(state, 26);
  assert.equal(bomb.alt, 110);
  assert.ok(bomb.z < z);
  run(state, 1);
  assert.ok(Math.abs(bomb.alt - 109.6) < 1e-9);
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
  const hostile = { x: bomb.x, z: bomb.z, alt: 145, vx: 0, vz: 0, kind: 'hostile', life: 2, damage: 2 };
  const outside = { ...hostile, x: bomb.x + 41 };
  state.shots.push(hostile, outside);
  run(state, 1);
  assert.equal(state.rearBombs.length, 0);
  assert.deepEqual(state.enemies.map(enemy => enemy.alt), [110, 145]);
  assert.deepEqual(state.shots.filter(shot => shot.kind === 'hostile'), [outside]);
});

test('a bomb falling toward an exposed core waits for its tighter damage window', () => {
  const state = createStage(parseStageOptions('?fixture=boss'));
  state.boss.index = 2;
  const point = state.boss.weakPoints[2];
  const bomb = { x: point.x, z: point.z, alt: point.alt + 7.9, vx: 0, vz: 0, born: state.tick - 27 };
  state.rearBombs.push(bomb);
  run(state, 1);
  assert.equal(state.rearBombs.length, 1);
  assert.equal(point.hp, 8);
  run(state, 15);
  assert.equal(state.rearBombs.length, 0);
  assert.equal(point.hp, 4);
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

test('the wider Reach rim warns at 60 m and contains all four maneuvers', () => {
  for (const kind of ['immelmann', 'split-s', 'cobra', 'j-turn']) {
    const state = pursuit();
    const { player, arena } = state;
    assert.equal(arena.radius, 560);
    state.enemies.length = 0;
    Object.assign(player, { x: arena.x + 505, z: arena.z, yaw: Math.PI / 2 });
    stepStage(state);
    assert.equal(state.boundaryWarning, true);
    Object.assign(player, { x: arena.x + arena.radius - 0.2, z: arena.z });
    for (let n = 0; n < 90; n++) {
      stepStage(state, n === 0 ? { maneuver: kind } : {});
      assert.ok(Math.hypot(player.x - arena.x, player.z - arena.z) <= arena.radius + 1e-9);
    }
    assert.ok(state.maneuverReadyAt > state.tick);
  }
});
