import test from 'node:test';
import assert from 'node:assert/strict';
import { HANGAR, HEAT_TIERS, UNLOCK_QUESTS } from '../src/data/meta.ts';
import {
  aceRank, createProfile, createRunMetrics, dailySeed, draftPool, hangarLoadout, hangarOffer, isHeat,
  normalizeHeat, normalizeProfile, purchaseUpgrade, questProgress, settleRun,
} from '../src/meta.ts';

const lost = { outcome: 'lost', heat: 0, score: 0, credits: 0 };

test('a new profile has only the five starting weapons and five starting buffs', () => {
  const profile = createProfile();
  assert.deepEqual(draftPool(profile), {
    weapons: ['twin', 'pods', 'seeker', 'phoenix', 'bomb-bay'],
    buffs: ['overdrive-coil', 'hull-plating', 'magnet-core', 'capacitor', 'salvage-beacon'],
  });
  assert.equal(questProgress(profile).length, 10);
  assert.ok(questProgress(profile).every(quest => !quest.unlocked && quest.progress === 0));
  assert.deepEqual(draftPool(profile, { ...createRunMetrics(), orbs: 99 }).weapons, draftPool(profile).weapons);
});

test('a live quest unlocks on the exact threshold and persists after settlement', () => {
  const profile = createProfile();
  profile.metrics.maneuvers = 29;
  const attempt = { ...createRunMetrics(), maneuvers: 1, weakPointHits: 5, orbs: 100 };
  const before = structuredClone(profile);
  assert.ok(!draftPool(profile).weapons.includes('ion'));
  for (const id of ['ion', 'rail', 'drones']) assert.ok(draftPool(profile, attempt).weapons.includes(id));
  const settled = settleRun(profile, attempt, lost);
  assert.deepEqual(settled.unlocked, ['rail', 'ion', 'drones']);
  assert.deepEqual(profile, before);
  assert.deepEqual(draftPool(settled.profile), draftPool(profile, attempt));
  assert.deepEqual(settleRun(settled.profile, createRunMetrics(), lost).unlocked, []);
});

test('single-sortie records never add across attempts while lifetime counters do', () => {
  const first = { ...createRunMetrics(), weakPointHits: 4, multibandWithinFive: 2, bandsKilled: 0b011, boostTicks: 3000 };
  const second = { ...createRunMetrics(), weakPointHits: 3, multibandWithinFive: 1, bandsKilled: 0b100, boostTicks: 600 };
  const { profile } = settleRun(createProfile(), first, lost);
  const byGear = Object.fromEntries(questProgress(profile, second).map(quest => [quest.id, quest]));
  assert.equal(byGear.rail.progress, 4);
  assert.equal(byGear.flak.progress, 2);
  assert.equal(byGear['band-lens'].progress, 2);
  assert.equal(byGear['band-lens'].unlocked, false);
  assert.equal(byGear['vector-thrusters'].unlocked, true);
  assert.equal(byGear['vector-thrusters'].progress, 3600);
});

test('each of the ten locked pieces is awarded only by its documented demand', () => {
  for (const quest of UNLOCK_QUESTS) {
    const progress = createRunMetrics();
    progress[quest.metric] = quest.metric === 'bandsKilled' ? 0b111 : quest.target;
    assert.deepEqual(questProgress(createProfile(), progress).filter(item => item.unlocked).map(item => item.id), [quest.id]);
  }
});

test('purchases validate rank, credit, and the eight bounded hangar upgrades', () => {
  assert.equal(Object.keys(HANGAR).length, 8);
  assert.equal(purchaseUpgrade(createProfile(), 'hull'), null);
  const profile = { ...createProfile(), credits: 50_000 };
  assert.equal(purchaseUpgrade(profile, 'banish'), null);
  assert.equal(hangarOffer(profile, 'banish').canPurchase, false);
  const advanced = { ...profile, aceScore: 160_000 };
  assert.equal(aceRank(advanced), 3);
  assert.ok(purchaseUpgrade(advanced, 'banish'));
  let upgraded = advanced;
  for (const id of Object.keys(HANGAR)) {
    for (const cost of HANGAR[id].costs) {
      const next = purchaseUpgrade({ ...upgraded, credits: 50_000 }, id);
      assert.equal(next.credits, 50_000 - cost);
      upgraded = next;
    }
    assert.equal(hangarOffer(upgraded, id).cost, null);
    assert.equal(purchaseUpgrade({ ...upgraded, credits: 50_000 }, id), null);
  }
  assert.deepEqual(advanced.upgrades, {});
  assert.deepEqual(hangarLoadout(upgraded), {
    hull: 3, rerolls: 3, banishes: 2, skips: 2, magnetScale: 1.2, xpScale: 1.15, creditScale: 1.5, ejector: true,
  });
  assert.deepEqual(hangarLoadout(upgraded, true), hangarLoadout(createProfile()));
});

test('profile normalization bounds saved values and discards malformed input', () => {
  assert.deepEqual(normalizeProfile(null), createProfile());
  assert.deepEqual(normalizeProfile([]), createProfile());
  const profile = normalizeProfile({
    credits: Infinity, aceScore: 24_350.9, maxHeat: 20, upgrades: { hull: 8, growth: 3.9, credit: '5', invalid: 12 },
    metrics: { maneuvers: -1, boostTicks: 87.4, bandsKilled: 12, multibandWithinFive: 30, orbs: '80' },
  });
  assert.equal(profile.credits, 0);
  assert.equal(profile.aceScore, 24_350);
  assert.equal(profile.maxHeat, 5);
  assert.deepEqual(profile.upgrades, { hull: 3, growth: 3 });
  assert.deepEqual(profile.metrics, { ...createRunMetrics(), boostTicks: 87, bandsKilled: 0b100, multibandWithinFive: 3 });
  assert.deepEqual(normalizeProfile(JSON.parse(JSON.stringify(profile))), profile);
});

test('Heat tiers stack their pressure, and boss clears unlock the next tier up to five', () => {
  assert.equal(isHeat(0), true);
  assert.equal(isHeat(5), true);
  for (const value of [-1, 6, 2.5, NaN, '2']) assert.equal(isHeat(value), false);
  assert.equal(normalizeHeat(5, 2), 2);
  assert.equal(normalizeHeat('3'), 0);
  assert.equal(HEAT_TIERS[0].armorScale, 1);
  assert.equal(HEAT_TIERS[1].armorScale, 1.15);
  assert.ok(HEAT_TIERS[2].shotIntervalScale < 1);
  assert.equal(HEAT_TIERS[3].magnetScale, 0.8);
  assert.equal(HEAT_TIERS[4].extraWeakPoint, true);
  assert.equal(HEAT_TIERS[5].carrierEscort, true);
  assert.equal(HEAT_TIERS[5].rewardScale, 1.75);

  const profile = { ...createProfile(), maxHeat: 4 };
  const clear = { outcome: 'clear', heat: 4, score: 50_000, credits: 101 };
  const timeout = settleRun(profile, createRunMetrics(), { ...clear, outcome: 'timeout' });
  assert.equal(timeout.profile.maxHeat, 4);
  const won = settleRun(profile, createRunMetrics(), clear);
  assert.equal(won.profile.maxHeat, 5);
  assert.ok(won.credits > timeout.credits);
  assert.equal(won.profile.aceScore, 80_000);
  assert.equal(settleRun(won.profile, createRunMetrics(), { ...clear, heat: 5 }).profile.maxHeat, 5);
});

test('retreat halves credits but preserves earned quest progress', () => {
  const profile = createProfile();
  const run = { ...createRunMetrics(), manualBombs: 10 };
  const loss = settleRun(profile, run, { ...lost, score: 20_000, credits: 100 });
  const retreat = settleRun(profile, run, { ...lost, outcome: 'retreated', score: 20_000, credits: 100 });
  assert.equal(retreat.credits, Math.floor(loss.credits / 2));
  assert.deepEqual(retreat.unlocked, ['ordnance-rack']);
  assert.equal(retreat.profile.aceScore, loss.profile.aceScore);
});

test('the supplied KST date produces a stable unsigned daily seed', () => {
  const seed = dailySeed('2026-11-20');
  assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff);
  assert.equal(seed, dailySeed('2026-11-20'));
  assert.notEqual(seed, dailySeed('2026-11-21'));
  assert.ok(Number.isInteger(dailySeed('2024-02-29')));
  for (const invalid of ['2023-02-29', '2026-11-31', '2026-1-01', '0000-05-23', '2026-13-01']) {
    assert.equal(dailySeed(invalid), null);
  }
});
