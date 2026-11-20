import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceChestSpawns, collectChest, createChestState, dropCarrierChest, rollChestRewards } from '../src/chests.ts';
import { CHESTS } from '../src/data/items.ts';
import { WAVE_FLY_IN_TICKS } from '../src/fly-in.ts';
import { buildRadar } from '../src/instruments.ts';
import { createStage, parseStageOptions } from '../src/stage.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { BANDS, TICKS_PER_SECOND } from '../src/stage-combat.ts';
import { enemyLimit, trimEscorts } from '../src/spawn-director.ts';
import { random } from '../src/stage-random.ts';

const ground = () => 35;
const game = (seed = 19) => {
  const state = createStage({ ...parseStageOptions('?mode=survivors&t=0'), seed }, ground);
  state.chests = createChestState();
  return state;
};

test('the four differently seeded carriers arrive at their scheduled beats', () => {
  function sortie(seed) {
    const state = game(seed);
    const arrivals = [];
    for (let index = 0; index < CHESTS.length; index++) {
      const chest = CHESTS[index], arrival = chest.second * TICKS_PER_SECOND;
      state.tick = arrival - WAVE_FLY_IN_TICKS - 1;
      advanceChestSpawns(state, ground);
      assert.equal(state.enemies.length, 0);
      state.tick++;
      const streams = structuredClone(state.streams);
      advanceChestSpawns(state, ground);
      assert.deepEqual(state.streams, streams);
      assert.equal(state.enemies.length, chest.escort ? 3 : 1);
      const carrier = state.enemies.find(enemy => enemy.carrier === chest.id);
      assert.equal(carrier.entry.arriveAt, arrival);
      assert.equal(carrier.entry.target.alt, BANDS[2]);
      assert.ok(state.enemies.every(enemy => enemy.entry));
      arrivals.push(carrier.entry.target);
      advanceChestSpawns(state, ground);
      assert.equal(state.enemies.filter(enemy => enemy.carrier === chest.id).length, 1);
      assert.equal(state.chests.next, index + 1);
      state.enemies.length = 0;
    }
    return arrivals;
  }
  assert.deepEqual(sortie(19), sortie(19));
  assert.notDeepEqual(sortie(19), sortie(20));
});

test('a full regular cap defers a carrier rather than discarding its event', () => {
  const state = game();
  state.tick = CHESTS[0].second * TICKS_PER_SECOND - WAVE_FLY_IN_TICKS;
  const limit = enemyLimit(state);
  state.enemies = Array.from({ length: limit }, (_, index) => makeEnemy(state, 0, 60 + index, 1));
  advanceChestSpawns(state, ground);
  assert.equal(state.chests.next, 0);
  assert.equal(state.enemies.length, limit);
  state.enemies.pop();
  state.tick++;
  advanceChestSpawns(state, ground);
  assert.equal(state.chests.next, 1);
  assert.equal(state.enemies.length, limit);
  assert.ok(state.enemies.some(enemy => enemy.carrier === CHESTS[0].id));
});

test('Ace escort trimming preserves living carriers for their scheduled loot', () => {
  const state = game();
  const { x, z } = state.player;
  state.tick = 480 * TICKS_PER_SECOND;
  const regular = Array.from({ length: enemyLimit(state) }, (_, index) => makeEnemy(state, x + index, z, 1));
  const carrier = { ...makeEnemy(state, x - 250, z, 1, 'bomber'), carrier: CHESTS[3].id };
  state.enemies = [...regular, carrier];
  trimEscorts(state);
  assert.equal(state.enemies.length, enemyLimit(state));
  assert.ok(state.enemies.includes(carrier));
});

test('Heat 5 adds wingmen to the first carrier and carries through the tier armor', () => {
  const state = game();
  state.heat = 5;
  state.tick = CHESTS[0].second * TICKS_PER_SECOND - WAVE_FLY_IN_TICKS;
  advanceChestSpawns(state, ground);
  assert.deepEqual(state.enemies.map(enemy => enemy.carrier), [CHESTS[0].id, undefined, undefined]);
  assert.equal(state.enemies[0].hp, 8);
  assert.ok(state.enemies.slice(1).every(enemy => enemy.formation.leader === state.enemies[0].id));
});

test('only an engaged carrier kill drops one crate and collection requires its altitude', () => {
  const state = game();
  state.tick = CHESTS[0].second * TICKS_PER_SECOND - WAVE_FLY_IN_TICKS;
  advanceChestSpawns(state, ground);
  const [carrier] = state.enemies;
  assert.equal(dropCarrierChest(state, carrier, ground), null);
  carrier.hp = 0;
  carrier.shotDown = true;
  assert.equal(dropCarrierChest(state, carrier, ground), null);
  Object.assign(carrier, { x: 20, z: 30, alt: 75 });
  delete carrier.entry;
  assert.deepEqual(dropCarrierChest(state, carrier, ground), { x: 20, z: 30, alt: 75, id: CHESTS[0].id });
  assert.equal(dropCarrierChest(state, carrier, ground), null);
  Object.assign(state.player, { x: 20, z: 30, altitude: 83.01 });
  assert.equal(collectChest(state), false);
  state.player.altitude = 83;
  assert.equal(collectChest(state), true);
  assert.equal(state.chests.offer, CHESTS[0].id);
  assert.deepEqual(state.chests.drops, []);
  assert.equal(collectChest(state), false);
});

test('supply and evolution quality roll reproducibly on the chest stream only', () => {
  const state = game();
  const streams = structuredClone(state.streams);
  const draft = state.run.draftRng.rng;
  for (const chest of CHESTS) {
    if (chest.kind === 'evolution') {
      assert.equal(rollChestRewards(state, chest.id, false), 3);
      assert.ok([1, 2].includes(rollChestRewards(state, chest.id, true)));
    } else {
      const counts = new Set(Array.from({ length: 128 }, () => rollChestRewards(state, chest.id, false)));
      assert.deepEqual([...counts].sort(), [1, 3, 5]);
    }
  }
  assert.equal(state.run.draftRng.rng, draft);
  assert.notEqual(state.streams.chest.rng, streams.chest.rng);
  delete streams.chest;
  const { chest: _, ...other } = state.streams;
  assert.deepEqual(other, streams);
  // Read the known first roll independently of the unrelated spawn stream.
  const replay = game();
  const first = random({ rng: replay.streams.chest.rng });
  assert.equal(rollChestRewards(replay, CHESTS[0].id, false), first < 0.70 ? 1 : first < 0.95 ? 3 : 5);
});

test('radar shows a crate at its altitude as a neutral contact', () => {
  const state = game();
  state.view = 'chase';
  const { x, z } = state.player;
  state.chests.drops = [
    { id: CHESTS[0].id, x, z: z + 70, alt: 145 },
    { id: CHESTS[1].id, x, z: z - 40, alt: 110 },
  ];
  const radar = buildRadar(state);
  assert.equal(radar.priority, null);
  assert.equal(radar.rear, false);
  assert.deepEqual(radar.contacts.map(({ kind, mark }) => [kind, mark]), [['chest', '^']]);
  assert.ok(radar.rim.some(contact => contact.kind === 'chest'));
});
