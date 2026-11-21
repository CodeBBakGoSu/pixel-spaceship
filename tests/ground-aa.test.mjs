import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { acquireAndFire, advanceShots } from '../src/stage-combat.ts';
import { makeEnemy, placeSkimEnemy } from '../src/stage-enemies.ts';

const hash = state => createHash('sha256').update(JSON.stringify(state)).digest('hex');

function ridgeFlight(altitude, floor = 80) {
  const ground = () => floor;
  const state = createStage(parseStageOptions('?autoplay=1&mode=survivors'), ground);
  Object.assign(state.player, { x: 0, z: 0, yaw: 0, altitude, vx: 0, vz: 0 });
  delete state.player.skim;
  state.twinAt = 0;
  state.strafeAt = 0;
  state.podsAt = Infinity;
  state.shots = [];
  const turret = makeEnemy(state, 0, 90, 1, 'turret');
  placeSkimEnemy(turret, ground);
  state.enemies = [turret];
  return { state, turret, ground };
}

function fireThrough(state, ground, ticks = 60) {
  acquireAndFire(state);
  for (let i = 0; i < ticks; i++) advanceShots(state, ground);
}

test('twin cannons depress and destroy a ridge turret from mid-band cruise', () => {
  const { state, turret, ground } = ridgeFlight(110);
  assert.equal(turret.alt, 85);
  acquireAndFire(state);
  const bolts = state.shots.filter(shot => shot.kind === 'twin');
  assert.ok(bolts.length >= 2);
  assert.ok(bolts.every(shot => shot.vy < 0));
  assert.ok(state.shots.some(shot => shot.kind === 'strafe' && shot.vy < 0 && shot.targetAltitude === turret.alt));
  assert.equal(state.altitudeHint, null);
  for (let i = 0; i < 60; i++) advanceShots(state, ground);
  assert.ok(turret.hp < 4);
  assert.ok(turret.hp <= 2, `expected a kill-speed volley, hp=${turret.hp}`);
});

test('twin cannons still reach a turret from high-band cruise and from SKIM', () => {
  for (const { altitude, skim } of [{ altitude: 145, skim: false }, { altitude: 110, skim: false }, { altitude: 80 + 30, skim: true }]) {
    const { state, turret, ground } = ridgeFlight(altitude);
    if (skim) state.player.skim = 'land';
    fireThrough(state, ground);
    assert.ok(turret.hp < 4, `altitude ${altitude} skim=${skim} hp=${turret.hp}`);
  }
});

test('same-band fighters keep the level twin stream while a turret still takes a downward strafe', () => {
  const { state, turret, ground } = ridgeFlight(110);
  const patrol = makeEnemy(state, 0, 70, 1, 'patrol');
  patrol.alt = 110;
  delete patrol.skim;
  state.enemies = [patrol, turret];
  acquireAndFire(state);
  const bolts = state.shots.filter(shot => shot.kind === 'twin');
  assert.ok(bolts.length >= 2);
  assert.ok(bolts.every(shot => !shot.vy));
  const strafe = state.shots.find(shot => shot.kind === 'strafe');
  assert.equal(strafe?.targetAltitude, turret.alt);
  assert.ok(strafe.vy < 0);
  assert.equal(state.altitudeHint, null);
  for (let i = 0; i < 60; i++) advanceShots(state, ground);
  assert.equal(patrol.hp, 0);
  assert.ok(turret.hp < 4);
});

test('a turret in the forward cone does not raise a dive hint', () => {
  const { state, turret } = ridgeFlight(130);
  state.wrongLayer = { id: turret.id, since: state.tick - 20 };
  acquireAndFire(state);
  assert.equal(state.altitudeHint, null);
  assert.equal(state.wrongLayer, null);
  assert.ok(state.shots.some(shot => (shot.kind === 'twin' && shot.vy < 0) || shot.kind === 'strafe'));
});

test('ground-AA engagement is deterministic for a fixed seed', () => {
  const play = () => {
    const { state, ground } = ridgeFlight(110);
    for (let i = 0; i < 45; i++) stepStage(state, { climb: 0 }, ground);
    return hash(state);
  };
  assert.equal(play(), play());
});
