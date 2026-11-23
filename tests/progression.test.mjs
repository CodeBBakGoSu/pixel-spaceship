import test from 'node:test';
import assert from 'node:assert/strict';
import { BUFFS, BUFF_IDS, CHESTS, DRAFT_RULES, EVOLUTIONS, FAMILIES, BILLS, WEAPONS, WEAPON_IDS } from '../src/data/items.ts';
import { applyRunPick, banishRunCard, createProgression, openRunDraft, rerollRunDraft, runXpCost, skipRunDraft, updateRunSlots } from '../src/progression.ts';
import { random, rngStream } from '../src/stage-random.ts';
import { strings } from '../src/i18n.ts';

const fullPool = { weapons: WEAPON_IDS, buffs: BUFF_IDS };
const modal = (cards, predicate) => cards.find(predicate);

test('all ten weapons have one distinct buff recipe and a family, with localized cards', () => {
  assert.equal(WEAPON_IDS.length, 10);
  assert.equal(BUFF_IDS.length, 10);
  assert.equal(new Set(Object.values(EVOLUTIONS).map(recipe => recipe.buff)).size, 10);
  assert.equal(new Set(Object.values(EVOLUTIONS).map(recipe => recipe.id)).size, 10);
  for (const id of WEAPON_IDS) {
    assert.ok(FAMILIES[WEAPONS[id].family]);
    assert.ok(BUFFS[EVOLUTIONS[id].buff]);
  }
  for (const id of [...WEAPON_IDS, ...BUFF_IDS, 'repair', 'damage', 'credits', ...Object.values(EVOLUTIONS).map(recipe => recipe.id)]) {
    for (const lang of ['en', 'ko']) {
      assert.ok(strings[lang][`item.${id}.title`], id);
      assert.ok(strings[lang][`item.${id}.copy`], id);
    }
  }
  assert.deepEqual(CHESTS.map(chest => [chest.second, chest.kind]), [[100, 'supply'], [205, 'evolution'], [310, 'supply'], [400, 'evolution']]);
  assert.deepEqual(BILLS.map(bill => [bill.second, bill.duration]), [[60, 40], [150, 30], [255, 30], [345, 30], [435, 30]]);
});

test('run starts with one weapon and 3+3 slots; time and rank gates unlock separately', () => {
  const run = createProgression(55);
  assert.deepEqual(run.weaponLevels, { twin: 1 });
  assert.deepEqual(run.buffLevels, {});
  assert.deepEqual([run.weaponSlots, run.buffSlots], [3, 3]);
  updateRunSlots(run, 4 * 60 * 60 - 1, false, 2);
  assert.deepEqual([run.weaponSlots, run.buffSlots], [3, 3]);
  updateRunSlots(run, 4 * 60 * 60);
  assert.deepEqual([run.weaponSlots, run.buffSlots], [4, 3]);
  updateRunSlots(run, 8 * 60 * 60, true);
  assert.deepEqual([run.weaponSlots, run.buffSlots], [4, 4]);
  assert.equal(createProgression(55, { rank: 3 }).buffSlots, 4);
  updateRunSlots(run, 1);
  assert.deepEqual([run.weaponSlots, run.buffSlots], [4, 4], 'unlocked slots stay unlocked');
});

test('the XP curve has no short-sortie cap and places 26 to 28 upgrades near the design XP budget', () => {
  const xpFor = n => Array.from({ length: n }, (_, i) => runXpCost(i + 1)).reduce((sum, cost) => sum + cost, 0);
  assert.deepEqual([1, 10, 20, 27].map(runXpCost), [16, 38, 62, 79]);
  assert.ok(xpFor(26) <= 1233 && xpFor(27) > 1233);
  assert.ok(xpFor(28) <= 1233 * 1.15 && xpFor(29) > 1233 * 1.15);
});

test('three unique cards, at least one weapon on the first deal, and one legal pick per deal', () => {
  const run = createProgression(9);
  const cards = openRunDraft(run);
  assert.equal(cards.length, 3);
  assert.equal(new Set(cards.map(card => card.id)).size, 3);
  assert.ok(cards.some(card => card.id === 'twin' || card.id === 'pods'));
  assert.strictEqual(openRunDraft(run), cards);
  assert.equal(applyRunPick(run, 'rail'), null);
  const twin = modal(cards, card => card.id === 'twin');
  assert.equal(twin.currentLevel, 1);
  assert.equal(twin.maxLevel, 7);
  assert.deepEqual(applyRunPick(run, twin.id), twin);
  assert.equal(run.weaponLevels.twin, twin.nextLevel);
  assert.equal(applyRunPick(run, twin.id), null);
});

test('full slots offer upgrades only for owned gear and flag the missing half of a recipe', () => {
  const run = createProgression(116, fullPool);
  run.weaponLevels = { twin: 1, pods: 7, seeker: 7 };
  run.buffLevels = { 'hull-plating': 3, 'magnet-core': 3, 'fire-control': 3 };
  const cards = openRunDraft(run);
  assert.deepEqual(cards.map(card => card.id).sort(), ['damage', 'repair', 'twin']);
  const pairing = createProgression(1, { weapons: ['twin', 'pods'], buffs: ['overdrive-coil'] });
  const pairCards = openRunDraft(pairing);
  assert.equal(modal(pairCards, card => card.id === 'overdrive-coil').pairHint, true);
  assert.equal(modal(pairCards, card => card.id === 'pods').pairHint, false);
});

test('weapon-specific buffs are offered only when their weapon is owned or can still be added', () => {
  for (const [weapon, buff] of [['phoenix', 'flare-bay'], ['bomb-bay', 'ordnance-rack']]) {
    const full = createProgression(116, { weapons: [weapon], buffs: [buff] });
    full.weaponLevels = { twin: 7, pods: 7, seeker: 7 };
    assert.ok(!openRunDraft(full).some(card => card.id === buff));

    const available = createProgression(116, { weapons: [weapon], buffs: [buff] });
    available.weaponLevels = { twin: 7, pods: 7 };
    const cards = openRunDraft(available);
    assert.ok(cards.some(card => card.id === weapon));
    assert.ok(cards.some(card => card.id === buff));
  }
});

test('sealed pool falls back to all three legal overflow choices at max damage', () => {
  const run = createProgression(22, { weapons: ['twin'], buffs: [] });
  run.weaponLevels.twin = 7;
  for (let i = 0; i < DRAFT_RULES.maxDamageUpgrades; i++) {
    assert.deepEqual(openRunDraft(run).map(card => card.id), ['repair', 'damage', 'credits']);
    assert.ok(applyRunPick(run, 'damage'));
  }
  assert.equal(run.damageUpgrades, 3);
  assert.deepEqual(openRunDraft(run).map(card => card.id).sort(), ['credits', 'damage', 'repair']);
  assert.ok(applyRunPick(run, 'damage'));
  assert.equal(run.damageUpgrades, 3);
  assert.ok(run.credits > 0, 'the capped option remains useful');
});

test('rarity is seeded, changes the upgrade, never exceeds cap and hides risk at one hull', () => {
  const variants = new Set();
  for (let seed = 0; seed < 60; seed++) {
    const run = createProgression(seed, fullPool);
    for (const card of openRunDraft(run)) {
      variants.add(card.variant);
      assert.ok(card.nextLevel <= card.maxLevel);
      if (card.variant !== 'normal') assert.equal(card.nextLevel, card.currentLevel + 2);
    }
    assert.ok(openRunDraft(createProgression(seed, fullPool), false).every(card => card.variant !== 'risky'));
  }
  assert.deepEqual(variants, new Set(['normal', 'overcharged', 'risky']));
});

test('reroll and unlocked banish/skip consume only their own capped charges', () => {
  const run = createProgression(25, { ...fullPool, banishes: 1, skips: 1 });
  openRunDraft(run);
  assert.equal(rerollRunDraft(run), true);
  assert.equal(rerollRunDraft(run), false);
  const id = modal(run.cards, card => WEAPON_IDS.includes(card.id) && card.id !== 'twin').id;
  assert.equal(banishRunCard(run, id), true);
  assert.ok(run.banished.includes(id));
  assert.ok(!run.cards.some(card => card.id === id));
  assert.equal(banishRunCard(run, run.cards[0].id), false);
  assert.equal(skipRunDraft(run), true);
  assert.deepEqual(run.cards, []);
  openRunDraft(run);
  assert.equal(skipRunDraft(run), false);
  assert.ok(!run.cards.some(card => card.id === id));
});

test('changing draft actions does not consume the separate spawn, chest or bills RNG', () => {
  const snapshot = pick => {
    const run = createProgression(9001, fullPool);
    const streams = ['spawn', 'chest', 'bills'].map(label => rngStream(9001, label));
    const before = streams.map(random);
    openRunDraft(run);
    rerollRunDraft(run);
    applyRunPick(run, run.cards[pick].id);
    openRunDraft(run);
    return { before, after: streams.map(random), run };
  };
  assert.deepEqual(snapshot(0), snapshot(0));
  assert.notDeepEqual(snapshot(0).run.weaponLevels, snapshot(1).run.weaponLevels);
  assert.deepEqual(snapshot(0).after, snapshot(1).after);
});
