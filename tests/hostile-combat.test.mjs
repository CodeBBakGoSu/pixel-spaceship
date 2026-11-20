import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { autopilotInput } from '../src/autoplay.ts';
import { HOSTILE_GRAZE_RADIUS, HOSTILE_IFRAME_TICKS, hostileShape } from '../src/data/hostile-fire.ts';
import { scaleTravel } from '../src/data/speed.ts';
import { ENEMY_KINDS } from '../src/enemy-kinds.ts';
import { createStage, parseStageOptions, RUN_END_TICK, stepStage } from '../src/stage.ts';
import { advanceShots, fireHostile, HIT_WINDOW, HOSTILE_HIT_RADIUS, TICKS_PER_SECOND } from '../src/stage-combat.ts';
import { World } from '../src/world.ts';

const sea = () => 0;
const sortie = (seed = 1, ground = sea) => createStage(parseStageOptions(`?mode=survivors&autoplay=1&seed=${seed}`), ground);
const nearRadius = (HOSTILE_HIT_RADIUS + HOSTILE_GRAZE_RADIUS) / 2;
const bolt = (stage, x, z, alt = stage.player.altitude) => ({
  kind: 'hostile', x: stage.player.x + x, z: stage.player.z + z, alt,
  vx: 0, vz: 120, life: 1, damage: 2, volley: 0, nearMiss: false, lockId: null,
});

test('graze fires once on the outgoing same-band near miss without editing the shot or scoring', () => {
  const stage = sortie(), shot = bolt(stage, nearRadius, -4);
  stage.shots.push(shot);
  const grazes = [];
  const events = { graze: (...args) => grazes.push(args) };
  advanceShots(stage, sea, events);
  assert.equal(grazes.length, 0, 'wait until the closest part of the pass');
  advanceShots(stage, sea, events);
  advanceShots(stage, sea, events);
  assert.equal(grazes.length, 1);
  assert.equal(grazes[0][0], shot);
  assert.equal(grazes[0][2], stage.player.z);
  assert.equal(shot.nearMiss, false);
  assert.equal(stage.score, 0);
  assert.equal(stage.hull, stage.maxHull);
});

test('off-band and terrain-stopped bullets produce no graze while ground and expiry emit impacts', () => {
  const stage = sortie(), { altitude } = stage.player;
  const offBand = bolt(stage, nearRadius, -1, altitude + HIT_WINDOW + 0.01);
  const stopped = bolt(stage, -nearRadius, -1);
  const expired = { ...bolt(stage, 80, 0), life: 0.001 };
  stage.shots.push(offBand, stopped, expired);
  const impacts = [];
  advanceShots(stage, (x, z) => x < stage.player.x && z >= stage.player.z - 0.5 ? altitude + 1 : 0, {
    graze: () => assert.fail('only an unobstructed same-band pass can graze'),
    impact: shot => impacts.push(shot),
  });
  assert.deepEqual(impacts, [stopped, expired]);
  assert.deepEqual(stage.shots, [offBand]);
});

test('a real hit reports actual damage and direction, then opens 60 deterministic ticks of protection', () => {
  const stage = sortie();
  stage.shots.push(bolt(stage, 0, -6, stage.player.altitude + HIT_WINDOW));
  const hits = [], impacts = [];
  const events = {
    hit: (...args) => hits.push(args),
    impact: (...args) => impacts.push(args),
    graze: () => assert.fail('hits and shielded bullets cannot graze'),
  };
  advanceShots(stage, sea, events);
  assert.equal(stage.hull, stage.maxHull - 3);
  assert.equal(hits[0][0], 3);
  assert.ok(hits[0][2] < stage.player.z);
  assert.equal(impacts.length, 1);
  const second = bolt(stage, 0, -6);
  stage.shots.push(second);
  advanceShots(stage, sea, events);
  assert.deepEqual(stage.shots, [second]);
  assert.equal(hits.length, 1);
  stage.shots.length = 0;
  for (let i = 1; i < HOSTILE_IFRAME_TICKS; i++) {
    stepStage(stage, {}, sea);
    assert.ok(stage.invulnerability > 0, `tick ${i} is protected`);
  }
  stepStage(stage, {}, sea);
  assert.equal(stage.invulnerability, 0);
  stage.hull = 2;
  stage.shots.push(bolt(stage, 0, -6));
  advanceShots(stage, sea, events);
  assert.equal(stage.hull, 0);
  assert.equal(hits[1][0], 2);
});

test('muzzle reports the emitter shape and original shot without adding presentation data to saves', () => {
  const stage = sortie(), muzzle = [];
  const events = { muzzle: (...args) => muzzle.push(args) };
  for (const [i, kind] of ['patrol', 'spotter', 'aegis'].entries()) {
    fireHostile(stage, { x: i * 10, z: 40, alt: 110, kind }, 60, 0, events);
    assert.equal(muzzle[i][0], stage.shots[i]);
    assert.equal(muzzle[i][1], hostileShape(kind));
    assert.equal(Object.hasOwn(stage.shots[i], 'shape'), false);
  }
  assert.deepEqual(muzzle.map(([, shape]) => shape), ['orb', 'needle', 'diamond']);
});

test('tail bolts catch a player at cruise and in band, while boost or another band evades them', () => {
  const cases = [
    { offset: HIT_WINDOW, boost: false, hits: 1 },
    { offset: HIT_WINDOW + 0.01, boost: false, hits: 0 },
    { offset: HIT_WINDOW, boost: true, hits: 0 },
  ];
  for (const [kind, side, aft] of [['hound', 6, 29], ['harrier', 15, 62]]) {
    for (const { offset, boost, hits } of cases) {
      const stage = createStage(parseStageOptions('?t=0'), sea);
      stepStage(stage, {}, sea);
      const { x, z, altitude } = stage.player;
      const source = { kind, x: x + scaleTravel(side), z: z - scaleTravel(aft), alt: altitude + offset };
      fireHostile(stage, source, ENEMY_KINDS[kind].boltSpeed);
      const shot = stage.shots[0];
      const expires = stage.tick + Math.ceil(shot.life * TICKS_PER_SECOND) + 1;
      while (stage.tick < expires && stage.shots.includes(shot)) stepStage(stage, { boost }, sea);
      assert.ok(!stage.shots.includes(shot), `${kind} bolt hit or expired`);
      assert.ok(stage.player.z > z + scaleTravel(15), `${kind} fired into a moving target`);
      assert.equal(stage.hitsTaken, hits, `${kind} at altitude offset ${offset}, boost=${boost}`);
    }
  }
});

test('full seeded replay hashes match with combat events enabled, disabled and repeated', () => {
  const world = new World(), ground = (x, z) => world.height(x, z);
  const hash = (seed, observe) => {
    const stage = sortie(seed, ground);
    let emitted = 0;
    const record = () => emitted++;
    const events = observe ? { muzzle: record, impact: record, graze: record, hit: record } : undefined;
    for (let i = 0; i < RUN_END_TICK * 2 && ['playing', 'draft', 'chest'].includes(stage.phase); i++) {
      stepStage(stage, autopilotInput(stage, 'full', ground), ground, undefined, events);
    }
    if (observe) assert.ok(emitted > 0);
    assert.ok(['clear', 'timeout', 'lost'].includes(stage.phase));
    return createHash('sha256').update(JSON.stringify(stage)).digest('hex');
  };
  for (const seed of [1, 27]) {
    const plain = hash(seed, false);
    assert.equal(hash(seed, true), plain);
    assert.equal(hash(seed, true), plain);
  }
});
