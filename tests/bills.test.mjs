import assert from 'node:assert/strict';
import test from 'node:test';
import { billXpScale, createBillState, finishBillTick, noteBillKill, noteBillPickup, startBillTick } from '../src/bills.ts';
import { BILLS, BILL_UNPAID_XP_SCALE } from '../src/data/items.ts';
import { advanceFlares, advanceShots, hurtPlayer, TICKS_PER_SECOND } from '../src/stage-combat.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';

function game() {
  const state = createStage(parseStageOptions('?mode=survivors&t=0'));
  state.bills = createBillState();
  state.lastHitTick = -1;
  return state;
}

function beat(state, second) {
  state.tick = second * TICKS_PER_SECOND;
  startBillTick(state);
}

function kill(state, band = 1, kind = 'patrol', killCredit = { weapon: 'twin' }) {
  const enemy = makeEnemy(state, 50, 10, band, kind);
  noteBillKill(state, { ...enemy, hp: 0, shotDown: true, killCredit });
}

test('the five Bills are offered on the design beats and expire at their exact deadlines', () => {
  const state = game();
  const streams = structuredClone(state.streams);
  for (const bill of BILLS) {
    const arrives = bill.second * TICKS_PER_SECOND, deadline = arrives + bill.duration * TICKS_PER_SECOND;
    state.tick = arrives - 1;
    startBillTick(state);
    assert.equal(state.bills.active, null);
    state.tick++;
    startBillTick(state);
    assert.equal(state.bills.active?.id, bill.id);
    assert.equal(state.bills.active.startedAt, arrives);
    assert.equal(state.bills.active.deadline, deadline);
    assert.equal(billXpScale(state), 1);
    state.tick = deadline - 1;
    assert.equal(finishBillTick(state), null);
    state.tick++;
    assert.deepEqual(finishBillTick(state), { definition: bill, paid: false });
    assert.equal(billXpScale(state), BILL_UNPAID_XP_SCALE);
    assert.equal(finishBillTick(state), null);
  }
  assert.equal(state.bills.offered, 5);
  assert.equal(state.bills.paid, 0);
  assert.deepEqual(state.streams, streams);
});

test('first levy uses the inclusive altitude window and requires three kills in one band', () => {
  const state = game();
  beat(state, 60);
  kill(state);
  kill(state);
  state.player.altitude = 180;
  kill(state, 2);
  kill(state, 1);
  assert.equal(state.bills.active.progress, 2);
  state.player.altitude = 118;
  // Combat on the last tick is eligible for settlement.
  state.tick = state.bills.active.deadline;
  kill(state);
  assert.deepEqual(finishBillTick(state), { definition: BILLS[0], paid: true });
  assert.equal(state.bills.paid, 1);
  assert.deepEqual(state.bills.last, { id: BILLS[0].id, paid: true, tick: state.tick });
  assert.equal(billXpScale(state), 1);
});

test('Ace Duty counts three reversal kills during the live Bill', () => {
  const state = game();
  beat(state, 150);
  const start = state.tick;
  state.tick += 2;
  state.reversal = { killTicks: [start - 1, start, start + 1], streak: 3 };
  assert.equal(finishBillTick(state), null);
  assert.equal(state.bills.active.progress, 2);
  state.reversal.killTicks.push(state.tick);
  assert.deepEqual(finishBillTick(state), { definition: BILLS[1], paid: true });
});

test('Rear Guard counts engaged rear-threat kills credited to rear equipment', () => {
  const state = game();
  beat(state, 255);
  kill(state, 1, 'hound', { weapon: 'phoenix', rear: false });
  kill(state, 1, 'gnat', { weapon: 'phoenix', rear: true });
  kill(state, 1, 'patrol', { weapon: 'twin', rear: true });
  assert.equal(state.bills.active.progress, 0);
  kill(state, 1, 'harrier', { weapon: 'pods', rear: true });
  kill(state, 1, 'hound', { weapon: 'phoenix', rear: true });
  kill(state, 0, 'patrol', { weapon: 'phoenix', rear: true });
  assert.deepEqual(finishBillTick(state), { definition: BILLS[2], paid: true });
});

test('Rear Guard skips a full non-rear loadout and advances to the next scheduled Bill', () => {
  const state = game();
  state.bills.next = 2;
  state.bills.offered = 2;
  state.run.weaponSlots = 4;
  state.run.weaponLevels = { twin: 1, seeker: 1, rail: 1, arc: 1 };
  state.tick = 255 * TICKS_PER_SECOND;
  startBillTick(state);
  assert.equal(state.bills.active, null);
  assert.equal(state.bills.next, 3);
  assert.equal(state.bills.offered, 2);
  assert.equal(state.bills.interest, false);
  assert.equal(billXpScale(state), 1);
  startBillTick(state);
  assert.equal(state.bills.next, 3);
  assert.equal(state.bills.offered, 2);

  state.tick = 345 * TICKS_PER_SECOND;
  startBillTick(state);
  assert.equal(state.bills.active?.id, BILLS[3].id);
  assert.equal(state.bills.next, 4);
  assert.equal(state.bills.offered, 3);

  const withOpenSlot = game();
  withOpenSlot.bills.next = 2;
  withOpenSlot.bills.offered = 2;
  withOpenSlot.run.weaponSlots = 4;
  withOpenSlot.run.weaponLevels = { twin: 1, seeker: 1, rail: 1 };
  withOpenSlot.run.weapons = ['pods'];
  beat(withOpenSlot, 255);
  assert.equal(withOpenSlot.bills.active?.id, BILLS[2].id);
});

test('High Recovery counts physical high-band orb collections', () => {
  const state = game();
  beat(state, 345);
  const pickup = { id: 60, x: 0, z: 0, alt: 125, xp: 50, born: 0 };
  noteBillPickup(state, pickup);
  assert.equal(state.bills.active.progress, 0);
  for (let id = 1; id <= 9; id++) noteBillPickup(state, { ...pickup, id, alt: 180 });
  assert.equal(state.bills.active.progress, 9);
  assert.equal(finishBillTick(state), null);
  noteBillPickup(state, { ...pickup, id: 10, alt: 180 });
  assert.deepEqual(finishBillTick(state), { definition: BILLS[3], paid: true });
});

test('Full Repayment requires both 25 kills and 20 seconds since the latest hit in the Bill', () => {
  const state = game();
  beat(state, 435);
  for (let i = 0; i < 25; i++) kill(state);
  state.lastHitTick = state.tick + 5 * TICKS_PER_SECOND;
  state.tick = state.lastHitTick + 20 * TICKS_PER_SECOND - 1;
  assert.equal(finishBillTick(state), null);
  assert.equal(state.bills.active.progress, 25);
  assert.equal(state.bills.active.unharmedTicks, 20 * TICKS_PER_SECOND - 1);
  state.tick++;
  assert.deepEqual(finishBillTick(state), { definition: BILLS[4], paid: true });
});

test('legacy sorties have no Bills or salvage interest', () => {
  const state = createStage(parseStageOptions('?t=0'));
  state.bills = createBillState();
  beat(state, 60);
  assert.equal(state.bills.active, null);
  assert.equal(state.bills.offered, 0);
  assert.equal(billXpScale(state), 1);
});

test('Bill interest reduces collected XP until the next live offer', () => {
  const state = game();
  beat(state, 60);
  const ground = () => 35;
  state.tick = state.bills.active.deadline - 1;
  stepStage(state, {}, ground);
  assert.equal(state.bills.interest, true);
  const collect = () => {
    const { x, z, altitude: alt } = state.player;
    state.pickups.push({ id: ++state.nextId, x, z, alt, xp: 4, born: state.tick });
    stepStage(state, {}, ground);
  };
  collect();
  assert.equal(state.xp, 3);
  assert.equal(state.salvage, 4);
  state.tick = BILLS[1].second * TICKS_PER_SECOND - 1;
  collect();
  assert.equal(state.bills.interest, false);
  assert.equal(state.xp, 8);
  assert.equal(state.salvage, 8);
});

test('a successful damage tick marks Full Repayment and Ejector revives once', () => {
  const state = game();
  state.hangar = { ...state.hangar, ejector: true };
  state.maxHull = 11;
  state.hull = 1;
  beat(state, 435);
  hurtPlayer(state);
  assert.equal(state.lastHitTick, state.tick);
  assert.equal(state.hull, 6);
  assert.equal(state.ejectorUsed, true);
  state.tick++;
  hurtPlayer(state);
  assert.equal(state.lastHitTick, state.tick - 1);
  state.hull = 1;
  state.invulnerability = 0;
  state.tick += 100;
  hurtPlayer(state);
  assert.equal(state.lastHitTick, state.tick);
  assert.equal(state.hull, 0);
});

test('rear collateral and delayed flare damage retain the source of a genuine pursuing kill', () => {
  const state = game();
  const p = state.player;
  beat(state, 255);
  const tail = makeEnemy(state, p.x, p.z - 30, 1, 'hound');
  tail.vz = 16;
  const flare = { x: tail.x, z: tail.z, alt: tail.alt, vx: 0, vz: 0, vy: 0, born: state.tick };
  state.flares.push(flare);
  state.enemies.push(tail);
  advanceFlares(state, () => 35);
  assert.equal(tail.hp, 2);
  assert.deepEqual(tail.burnCredit, { weapon: 'phoenix', rear: true });
  p.yaw = Math.PI;
  for (let i = 0; i < 2; i++) {
    state.tick = tail.burnNextAt;
    advanceFlares(state, () => 35);
  }
  assert.deepEqual(tail.killCredit, { weapon: 'phoenix', rear: true });
  noteBillKill(state, tail);
  assert.equal(state.bills.active.progress, 1);
});

test('Seeker credits a homing lock on its target and leaves splash kills uncredited', () => {
  const state = game();
  const { x, z } = state.player;
  const target = makeEnemy(state, x, z + 25, 1);
  const splash = makeEnemy(state, x + 8, z + 25, 1);
  state.enemies.push(target, splash);
  state.shots.push({ kind: 'seeker', weapon: 'seeker', targetId: target.id, sourceBand: 1,
    x, z: z + 23, alt: 125, vx: 0, vy: 0, vz: 86, damage: 3, radius: 12,
    life: 1, volley: 1, nearMiss: false, lockId: null });
  advanceShots(state, () => 35);
  assert.equal(target.hp, 0);
  assert.equal(splash.hp, 0);
  assert.deepEqual(target.killCredit, { weapon: 'seeker', locked: true });
  assert.deepEqual(splash.killCredit, { weapon: 'seeker' });
});
