import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { chestPresentation } from '../src/chest-display.ts';
import { observeDamage } from '../src/combat-feedback.ts';
import { ImpactBatch } from '../src/impact-audio.ts';
import { primeP1Fixture } from '../src/p1-fixture.ts';
import { PROJECTILE_TRAIL_CAP, ProjectileTrails, TRAIL_LIFETIME, trailBudget } from '../src/projectile-trails.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { advanceShots, hurtPlayer } from '../src/stage-combat.ts';
import { makeEnemy } from '../src/stage-enemies.ts';

const ground = () => 0;
const hash = state => createHash('sha256').update(JSON.stringify(state)).digest('hex');

test('impact layers bucket positive damage, criticals and six Gnat kills in 80 ms', () => {
  const batch = new ImpactBatch();
  batch.hit(0, 0, true);
  batch.hit(0, Infinity, true);
  assert.equal(batch.drain(100), 0);
  batch.hit(100, 1, false);
  assert.equal(batch.drain(179.999), 0);
  assert.equal(batch.drain(180), 0b001);
  for (let i = 0; i < 3; i++) batch.hit(200 + i, 1, false);
  for (let i = 0; i < 5; i++) batch.destroyedGnat(250 + i);
  assert.equal(batch.drain(280), 0b011);
  batch.hit(300, 1, false);
  for (let i = 0; i < 6; i++) batch.destroyedGnat(310 + i);
  assert.equal(batch.drain(380), 0b101);
  batch.hit(400, 1, true);
  assert.equal(batch.drain(480), 0b101);
  assert.equal(batch.drain(560), 0);
});

test('only an actual friendly hit feeds the impact batch, not a miss or hull damage', () => {
  const state = createStage(parseStageOptions('?mode=survivors&t=0'), ground);
  const batch = new ImpactBatch();
  observeDamage(state, (_id, damage, critical) => batch.hit(state.tick, damage, critical));
  const { x, z, altitude: alt } = state.player;
  const target = makeEnemy(state, x, z + 62, 1, 'patrol', 0);
  target.alt = alt;
  state.enemies.push(target);
  hurtPlayer(state);
  const shot = (side, rise) => ({ kind: 'twin', x: x + side, z: z + 53, alt: alt + rise,
    vx: 0, vz: 700, life: 1, damage: 1, volley: 1, nearMiss: false, lockId: null });
  state.shots.push(shot(50, 0), shot(0, 35));
  advanceShots(state, ground);
  assert.equal(batch.drain(80), 0);
  state.tick = 81;
  state.shots.push(shot(0, 0));
  const hp = target.hp;
  advanceShots(state, ground);
  assert.ok(target.hp < hp);
  assert.equal(batch.drain(161), 0b001);
});

test('cache presentation reads actual rewards, not the cache type alone, and never changes the replay', () => {
  const cases = [
    [1, '', 'single', 1], [6, '', 'triple', 3], [18, '', 'jackpot', 5],
    [6, 'fallback', 'triple', 3], [1, 'evolution', 'evolution', 3],
  ];
  for (const [seed, cache, outcome, count] of cases) {
    const stages = [];
    for (const mode of ['off', 'normal', 'skip']) {
      const state = createStage(parseStageOptions(`?mode=survivors&t=0&seed=${seed}`), ground);
      primeP1Fixture(state, new URLSearchParams(`fixture=p1-cache&cache=${cache}`));
      stepStage(state, { chestPick: cache === 'evolution' ? 'seeker' : 'open' }, ground);
      assert.equal(state.chestReveal.length, count, outcome);
      const opened = hash(state);
      if (mode !== 'off') assert.equal(chestPresentation(state.chestReveal, true), outcome);
      for (let i = 0; i < (mode === 'normal' ? 90 : mode === 'skip' ? 3 : 0); i++) {
        stepStage(state, i % 2 ? { chestPick: 'open' } : {}, ground);
      }
      assert.equal(hash(state), opened, outcome);
      stepStage(state, { chestPick: 'continue' }, ground);
      for (let i = 0; i < 120; i++) stepStage(state, {}, ground);
      stages.push(hash(state));
    }
    assert.equal(new Set(stages).size, 1, outcome);
  }
  assert.equal(chestPresentation(Array(3).fill({ kind: 'upgrade', id: 'twin' }), false), 'summary');
  assert.equal(chestPresentation([], true), 'summary');
});

test('trail history is actual flight samples, capped newest first, and disappears without mutating shots', () => {
  const trails = new ProjectileTrails();
  const shots = [
    { kind: 'hostile', x: 0, z: 0, alt: 0 }, { kind: 'seeker', x: 0, z: 0, alt: 0 },
    { kind: 'twin', x: 0, z: 0, alt: 0 }, { kind: 'seeker', rack: true, x: 0, z: 0, alt: 0 },
  ];
  trails.advance(shots, 0, 1, true);
  for (const shot of shots) shot.z = 2;
  trails.advance(shots, 3, 1, true);
  assert.equal(trails.newest(0, 3).style, 'rocket');
  assert.equal(trails.newest(1, 3), undefined);
  shots[3].x = 2;
  shots[3].alt = 1;
  trails.advance(shots, 6, 1, true);
  assert.deepEqual(trails.newest(0, 6).from, { x: 0, z: 2, alt: 0 });
  assert.deepEqual(trails.newest(0, 6).to, { x: 2, z: 2, alt: 1 });
  assert.equal(trails.newest(0, 6 + TRAIL_LIFETIME), undefined);

  const volley = Array.from({ length: 55 }, (_, x) => ({ kind: 'twin', x, z: 0, alt: 145 }));
  trails.advance(volley, 9, 7, true);
  volley.forEach(shot => { shot.z = 4; Object.freeze(shot); });
  trails.advance(volley, 12, 7, true);
  assert.equal(trails.newest(0, 12).to.x, 54);
  assert.equal(trails.newest(PROJECTILE_TRAIL_CAP - 1, 12).to.x, 7);
  assert.equal(trails.newest(PROJECTILE_TRAIL_CAP, 12), undefined);
  assert.deepEqual([trailBudget(false, false, false), trailBudget(true, false, false),
    trailBudget(false, true, false), trailBudget(true, true, false), trailBudget(false, false, true)], [48, 24, 24, 12, 0]);
  trails.advance(volley, 0, 7, true);
  assert.equal(trails.newest(0, 0), undefined);
});
