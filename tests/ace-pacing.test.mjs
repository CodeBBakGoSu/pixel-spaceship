import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ACE, ACE_PHASES } from '../src/data/ace.ts';
import { ROLLS } from '../src/data/roll.ts';
import { advanceAce, makeAce } from '../src/ace.ts';
import { aceVulnerable, advanceShots, BANDS, hurtAce } from '../src/stage-combat.ts';
import { activeAce, createStage, parseStageOptions, RUN_BOSS_TICK, RUN_END_TICK, stepStage } from '../src/stage.ts';

const ground = () => 0;
const stage = (query = '?mode=survivors&fixture=ace') => createStage(parseStageOptions(query), ground);
const hash = state => createHash('sha256').update(JSON.stringify(state)).digest('hex');

test('the survivor Ace enters at 8:00 and the deadline is still 10:00', () => {
  const state = stage('?mode=survivors&autoplay=1');
  state.tick = RUN_BOSS_TICK - 2;
  stepStage(state, {}, ground);
  assert.equal(state.boss, null);
  stepStage(state, {}, ground);
  const ace = activeAce(state);
  assert.equal(state.tick, 8 * 60 * 60);
  assert.equal(ace.phase, 1);
  assert.ok(ace.entry);
  assert.equal(aceVulnerable(ace), false);
  assert.equal(RUN_END_TICK, 10 * 60 * 60);
});

test('Ace health crosses both phase thresholds and only calls cover once', () => {
  const state = stage(), ace = state.boss;
  ace.tell = null;
  const cues = [];
  const events = { tell(kind) { cues.push(kind); } };
  hurtAce(state, ace, ace.maxHp * 0.36);
  state.tick++;
  advanceAce(state, ground, events);
  assert.equal(ace.phase, 2);
  assert.ok(state.enemies.some(enemy => enemy.kind === 'interceptor'));
  assert.ok(state.enemies.some(enemy => enemy.kind === 'gnat'));
  hurtAce(state, ace, ace.maxHp * 0.35);
  state.tick++;
  advanceAce(state, ground, events);
  assert.equal(ace.phase, 3);
  assert.equal(cues.filter(kind => kind === 'carrier').length, 1);
});

test('Ace rolls are telegraphed and followed by a punish window', () => {
  const state = stage('?fixture=ace&phase=1&cue=roll'), ace = state.boss;
  assert.equal(ace.tell.kind, 'roll');
  assert.equal(ace.roll, null);
  assert.ok(aceVulnerable(ace));
  state.tick = ace.tell.until - 1;
  advanceAce(state, ground);
  assert.equal(ace.roll, null);
  state.tick++;
  advanceAce(state, ground);
  assert.equal(ace.roll.elapsed, 0);
  assert.equal(aceVulnerable(ace), false);
  const hp = ace.hp;
  hurtAce(state, ace, 10);
  assert.equal(ace.hp, hp);
  for (let i = 0; i < ROLLS.barrel.ticks; i++) {
    state.tick++;
    advanceAce(state, ground);
  }
  assert.equal(ace.roll, null);
  assert.ok(aceVulnerable(ace));
  assert.ok(ace.rollReadyAt > state.tick);
  hurtAce(state, ace, 10);
  assert.ok(ace.hp < hp);
});

test('threatening a tailing Ace starts its roll and rear cues through live flight logic', () => {
  const state = stage('?fixture=ace&cue=tail'), ace = state.boss;
  ace.tail = false;
  ace.rollReadyAt = state.tick;
  state.shots.push({
    kind: 'twin', x: ace.x, z: ace.z + 45, alt: ace.alt, vx: 0, vz: -200, damage: 1,
    life: 1, volley: 1, nearMiss: false, lockId: null,
  });
  const cues = [];
  advanceAce(state, ground, { tell(kind) { cues.push(kind); } });
  assert.deepEqual(cues, ['roll', 'tail']);
  assert.equal(ace.tail, true);
  assert.equal(ace.tell.kind, 'roll');
  assert.equal(ace.roll, null);
});

for (const kind of ['gun', 'missile']) {
  test(`the Ace ${kind} warning precedes its shots by the data interval`, () => {
    const state = stage(`?fixture=ace&phase=2&cue=${kind}`), ace = state.boss;
    assert.equal(ace.tell.until - ace.tell.since, ACE[kind].warningTicks);
    state.tick = ace.tell.until - 1;
    advanceAce(state, ground);
    assert.equal(state.shots.length, 0);
    state.tick++;
    advanceAce(state, ground);
    assert.equal(state.shots.length, ACE_PHASES[2][kind].length);
    assert.ok(state.shots.every(shot => shot.kind === 'hostile' &&
      (kind === 'missile') === (shot.hostileKind === 'ace-missile')));
  });
}

test('a guided Ace missile travels through the existing same-band parry path', () => {
  const state = stage('?fixture=ace&cue=missile'), ace = state.boss, p = state.player;
  state.tick = ace.tell.until;
  advanceAce(state, ground);
  assert.ok(state.shots[0].hostileKind === 'ace-missile');
  state.shots.length = 1;
  Object.assign(state.shots[0], { x: p.x, z: p.z - 5, vx: 0, vz: 180, alt: p.altitude });
  state.roll = { kind: 'aileron', side: 1, elapsed: 4, altitude: p.altitude };
  const parries = [];
  advanceShots(state, ground, { parry(shot) { parries.push(shot.hostileKind); } });
  assert.deepEqual(parries, ['ace-missile']);
  assert.equal(state.hull, state.maxHull);
  assert.equal(state.shots.length, 0);
});

test('Ace flight accepts a fourth terrain-relative band and uses bank-to-turn', () => {
  const state = stage('?fixture=ace'), ace = state.boss;
  const bands = (x, z) => [ground(x, z) + 30, ...BANDS];
  const open = makeAce(state, ace.x, ace.z, bands);
  state.boss = open;
  open.band = 1;
  open.alt = BANDS[0];
  open.bandAt = state.tick;
  open.tell = null;
  state.player.altitude = 30;
  state.player.x += 110;
  const heading = open.yaw;
  for (let i = 0; i < 120; i++) {
    state.tick++;
    advanceAce(state, ground, undefined, undefined, bands);
  }
  assert.equal(open.band, 0);
  assert.ok(Math.abs(open.alt - 30) < 8);
  assert.notEqual(open.yaw, heading);
  assert.ok(Math.abs(open.bank) > 0);
});

test('Ace defeat spins the craft down before paying the victory cache', () => {
  const state = stage(), ace = state.boss;
  ace.tell = null;
  hurtAce(state, ace, ace.maxHp);
  stepStage(state, {}, ground);
  assert.equal(ace.defeatedAt, state.tick);
  assert.equal(state.phase, 'playing');
  const altitude = ace.alt, yaw = ace.yaw;
  stepStage(state, { retreat: true }, ground);
  while (state.phase === 'playing') stepStage(state, {}, ground);
  assert.equal(state.phase, 'clear');
  assert.equal(state.summary.aceCache, true);
  assert.ok(state.summary.credits >= 250);
  assert.ok(ace.alt < altitude);
  assert.notEqual(ace.yaw, yaw);
});

test('Ace state hashes repeat with effects observed, with no observers, and across views', () => {
  function replay(view, events) {
    const state = stage(`?mode=survivors&fixture=ace&phase=2&cue=missile&view=${view}`);
    for (let i = 0; i < 640; i++) stepStage(state, { turn: Math.sin(i / 100) / 2, roll: i % 80 === 0 }, ground, undefined, events);
    state.view = state.initialView = 'overhead';
    return state;
  }
  const cues = [], observer = { tell(kind) { cues.push(kind); }, muzzle() {}, impact() {}, graze() {}, roll() {}, parry() {} };
  const observed = replay('cockpit', observer);
  assert.ok(observed.boss.hits || cues.length || observed.hitsTaken);
  assert.equal(hash(observed), hash(replay('overhead')));
  assert.equal(hash(observed), hash(replay('cockpit', observer)));
});
