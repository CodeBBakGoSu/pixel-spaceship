import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, stepGame, parseGameOptions, restartGame, nextLoop } from '../src/game.ts';

const ground = () => 30;
const idle = { moveX: 0, moveY: 0, fire: false };
function advance(state, seconds, input = idle) {
  for (let i = 0; i < Math.round(seconds * 60); i++) state = stepGame(state, input, 1 / 60, ground);
  return state;
}

test('URL options validate segments, seed, loop and autoplay', () => {
  assert.deepEqual(parseGameOptions('?segment=boss&seed=42&autoplay=1&loop=3&t=8'), { segment: 'boss', seed: 42, autoplay: true, loop: 3, time: 8 });
  assert.deepEqual(parseGameOptions('?segment=invalid&seed=no&loop=-2&t=-1'), { segment: null, seed: 1, autoplay: false, loop: 1, time: 0 });
});

test('segments progress through both transitions to the boss and win', () => {
  let s = createGame(parseGameOptions('?segment=overhead&seed=1'), ground);
  s.invulnTimer = 999;
  s = advance(s, 30.05);
  assert.equal(s.phase, 'transition'); assert.equal(s.segment, 'overhead');
  s = advance(s, 0.7);
  assert.ok(s.transitionT > 0 && s.transitionT < 1);
  assert.ok(s.camera.crossFade >= 0 && s.camera.crossFade <= 1);
  s = advance(s, 0.9);
  assert.equal(s.phase, 'playing'); assert.equal(s.segment, 'chase');
  s = advance(s, 35.05);
  assert.equal(s.phase, 'transition'); assert.equal(s.segment, 'chase');
  s = advance(s, 1.6);
  assert.equal(s.phase, 'playing'); assert.equal(s.segment, 'cockpit');
  s = advance(s, 12.1);
  assert.equal(s.boss.active, true); assert.equal(s.boss.hp, 24);
  s.boss.hp = 1; s.boss.hitCooldown = 0;
  s.bullets = [{ x: s.boss.x, y: 0, z: s.boss.z, alt: s.boss.alt, vx: 0, vy: 0, vz: 0, friendly: true, life: 1 }];
  s = stepGame(s, idle, 1 / 60, ground);
  assert.equal(s.phase, 'win'); assert.ok(s.score >= 2000);
});

test('damage costs hull, then a life, and eventually ends the game', () => {
  let s = createGame(parseGameOptions('?segment=overhead'), ground);
  function hit(state) {
    state.invulnTimer = 0;
    state.bullets = [{ x: state.player.x, y: 0, z: state.player.z, alt: state.player.altitude, vx: 0, vy: 0, vz: 0, friendly: false, life: 1 }];
    return stepGame(state, idle, 1 / 60, ground);
  }
  s = hit(s); assert.equal(s.hull, 6); assert.equal(s.lives, 3);
  s.hull = 2; s = hit(s); assert.equal(s.lives, 2); assert.equal(s.hull, 8); assert.ok(s.invulnTimer > 1);
  s.lives = 1; s.hull = 2; s = hit(s); assert.equal(s.lives, 0); assert.equal(s.phase, 'game_over');
  s = restartGame(s, ground); assert.equal(s.phase, 'playing'); assert.equal(s.segment, 'overhead'); assert.equal(s.lives, 3); assert.equal(s.score, 0);
});

test('next loop retains score and increases speed with a cap', () => {
  let s = createGame(parseGameOptions('?segment=boss&seed=7'), ground);
  s.phase = 'win'; s.score = 1234;
  s = nextLoop(s, ground);
  assert.equal(s.loop, 2); assert.equal(s.score, 1234); assert.equal(s.loopSpeed, 1.2);
  s.phase = 'win'; s.loop = 8;
  assert.equal(nextLoop(s, ground).loopSpeed, 1.8);
});

test('seeded simulations are deterministic and the input state is not mutated', () => {
  const options = parseGameOptions('?segment=overhead&seed=123&autoplay=1');
  const original = createGame(options, ground);
  const snapshot = structuredClone(original);
  const one = stepGame(original, idle, 1 / 60, ground);
  assert.deepEqual(original, snapshot); assert.notEqual(one, original);
  const a = advance(original, 8); const b = advance(createGame(options, ground), 8);
  assert.deepEqual(a, b);
  const c = advance(createGame({ ...options, seed: 124 }, ground), 8);
  assert.notDeepEqual(a.entities, c.entities);
});

test('rings repair hull and pillars inflict collision damage', () => {
  let s = createGame(parseGameOptions('?segment=chase'), ground);
  s.hull = 5; s.invulnTimer = 0;
  s.entities = [{ kind: 'ring', x: s.player.x, z: s.player.z + 0.1, alt: s.player.altitude, vx: 0, vz: 0, hp: 1, waveId: 0, bank: 0, hitFlash: 0, fireTimer: 0, valt: 0 }];
  s = stepGame(s, idle, 1 / 60, ground);
  assert.equal(s.hull, 6); assert.equal(s.score, 250);
  s.entities = [{ kind: 'pillar', x: s.player.x, z: s.player.z + 0.1, alt: s.player.altitude - 30, vx: 0, vz: 0, hp: 1, waveId: 0, bank: 0, hitFlash: 0, fireTimer: 0, valt: 0 }];
  s = stepGame(s, idle, 1 / 60, ground);
  assert.equal(s.hull, 4);
});

test('a drone collision damages the player without awarding a kill or wave bonus', () => {
  let s = createGame(parseGameOptions('?segment=overhead'), ground);
  s.entities = [{ kind: 'drone', x: s.player.x, z: s.player.z, alt: s.player.altitude, vx: 0, vz: 0, hp: 2, waveId: 1, bank: 0, hitFlash: 0, fireTimer: 3, valt: 0 }];
  s.waves = [{ id: 1, remaining: 1, perfect: true }];
  s = stepGame(s, idle, 1 / 60, ground);
  assert.equal(s.hull, 6); assert.equal(s.score, 0);
});

test('autoplay can complete a seeded loop without forced damage or victory', () => {
  let s = createGame(parseGameOptions('?segment=overhead&seed=1&autoplay=1'), ground);
  for (let i = 0; i < 120 * 60 && s.phase !== 'win' && s.phase !== 'game_over'; i++) s = stepGame(s, idle, 1 / 60, ground);
  assert.equal(s.phase, 'win'); assert.ok(s.elapsed >= 90 && s.elapsed <= 120);
});

test('pause freezes simulation until toggled again', () => {
  let s = createGame(parseGameOptions('?segment=chase'), ground);
  s = stepGame(s, { ...idle, pause: true }, 1 / 60, ground);
  const time = s.phaseTime, z = s.player.z;
  s = advance(s, 2);
  assert.equal(s.phaseTime, time); assert.equal(s.player.z, z);
  s = stepGame(s, { ...idle, pause: true }, 1 / 60, ground);
  assert.equal(s.paused, false); assert.ok(s.player.z > z);
});
