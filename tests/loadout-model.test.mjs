import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAFT_RULES, WEAPON_IDS } from '../src/data/items.ts';
import { buildDraftCardModel, buildSlotHudModel } from '../src/loadout-model.ts';
import { createProgression, updateRunSlots } from '../src/progression.ts';

const card = (id, currentLevel, nextLevel, options = {}) => ({
  id, currentLevel, nextLevel, maxLevel: DRAFT_RULES.maxWeaponLevel, variant: 'normal', pairHint: false, ...options,
});

test('acquiring a second weapon in a family previews the first bonus without changing the run', () => {
  const run = createProgression(1);
  const before = structuredClone(run);
  const model = buildDraftCardModel(card('pods', 0, 1), run, 'en');
  assert.equal(model.name, 'Wing Pods');
  assert.equal(model.family, 'ballistic');
  assert.equal(model.levelLabel, 'NEW');
  assert.deepEqual(model.pips, ['gain', ...Array(6).fill('empty')]);
  assert.deepEqual(model.setPreview, { count: 2, tier: 2, bonus: '+15% damage', text: 'Set 2: +15% damage' });
  assert.deepEqual(run, before);
});

test('an existing weapon upgrade opens its chest evolution without adding to the family count', () => {
  const run = createProgression(2);
  run.weaponLevels.twin = 6;
  run.buffLevels['overdrive-coil'] = 1;
  const model = buildDraftCardModel(card('twin', 6, 7), run, 'en');
  assert.equal(model.levelLabel, 'Lv 6 → 7');
  assert.equal(model.growth, '6 shots per volley · +1 pierce');
  assert.deepEqual(model.pips, [...Array(6).fill('owned'), 'gain']);
  assert.deepEqual(model.evolution, { badge: 'EVOLVES', hint: 'Chest evolves Aurora Gatling' });
  assert.deepEqual(model.setPreview, { count: 1, tier: 0, bonus: '', text: 'Set 1/2' });
});

test('weapon previews aggregate a two-rank pick and display concrete effects', () => {
  const run = createProgression(2);
  const twin = buildDraftCardModel(card('twin', 1, 3, { variant: 'overcharged' }), run, 'ko');
  assert.equal(twin.growth, '한 번에 3발 · 관통 +1');
  const rail = buildDraftCardModel(card('rail', 0, 2, { variant: 'overcharged' }), run, 'en');
  assert.equal(rail.levelLabel, 'NEW · Lv 2');
  assert.equal(rail.growth, '150% of base width');
  assert.equal(buildDraftCardModel(card('rail', 0, 1), run, 'en').growth, '');
});

test('a paired buff at weapon level seven is marked as ready to evolve in Korean', () => {
  const run = createProgression(3);
  run.weaponLevels.twin = 7;
  const model = buildDraftCardModel(card('overdrive-coil', 0, 1, { maxLevel: 3, pairHint: true }), run, 'ko');
  assert.equal(model.family, 'buff');
  assert.equal(model.levelLabel, '신규');
  assert.deepEqual(model.evolution, { badge: '진화 가능', hint: '상자에서 오로라 개틀링 진화' });
  assert.deepEqual(model.pips, ['gain', 'empty', 'empty']);
  run.weaponLevels.twin = 6;
  const pairOnly = buildDraftCardModel(card('overdrive-coil', 0, 1, { maxLevel: 3, pairHint: true }), run, 'ko');
  assert.equal(pairOnly.evolution, undefined);
  assert.equal(pairOnly.pairHint, '진화 짝');
});

test('two-level risky cards distinguish both new pips and the hull cost', () => {
  const run = createProgression(4);
  const model = buildDraftCardModel(card('twin', 2, 4, { variant: 'risky' }), run, 'en');
  assert.deepEqual(model.pips, ['owned', 'owned', 'gain', 'gain', 'empty', 'empty', 'empty']);
  assert.equal(model.variantLabel, 'HIGH RISK');
  assert.equal(model.cost, 'Costs 1 hull');
});

test('a capped power card shows its actual credits reward without promising another level', () => {
  const model = buildDraftCardModel(card('damage', 3, 3, { maxLevel: 3 }), createProgression(5), 'en');
  assert.equal(model.icon, 'credits');
  assert.equal(model.name, 'Spare Parts');
  assert.equal(model.effect, 'Awards 15 credits.');
  assert.equal(model.levelLabel, '');
  assert.deepEqual(model.pips, []);
});

test('fourth weapon and buff slots use the actual phase and rank unlock gates', () => {
  const run = createProgression(1);
  const start = buildSlotHudModel(run, 'en');
  assert.deepEqual(start.weapons.map(slot => slot.kind), ['equipped', 'empty', 'empty', 'locked']);
  assert.equal(start.weapons[3].hint, '4:00');
  assert.equal(start.buffs[3].hint, 'Boss or Rank 3');
  updateRunSlots(run, 14_400);
  const mid = buildSlotHudModel(run, 'ko');
  assert.equal(mid.weapons[3].kind, 'empty');
  assert.equal(mid.buffs[3].hint, '보스 또는 랭크 3');
  updateRunSlots(run, 28_800, true);
  assert.equal(buildSlotHudModel(run, 'ko').buffs[3].kind, 'empty');
  const ranked = buildSlotHudModel(createProgression(1, { rank: 3 }), 'en');
  assert.equal(ranked.buffs[3].kind, 'empty');
});

test('equipped slots preserve acquisition order, show evolved weapons, and light shared family bonuses', () => {
  const run = createProgression(1, { rank: 3 });
  updateRunSlots(run, 14_400);
  run.weaponLevels = { twin: 7, rail: 4, pods: 1, ion: 2 };
  run.buffLevels['overdrive-coil'] = 2;
  run.evolutions.twin = 'aurora-gatling';
  const model = buildSlotHudModel(run, 'en');
  assert.deepEqual(model.weapons.map(slot => slot.id), ['twin', 'rail', 'pods', 'ion']);
  assert.deepEqual(model.weapons[0], { kind: 'equipped', id: 'twin', icon: 'aurora-gatling', name: 'Aurora Gatling',
    level: 7, maxLevel: 7, evolved: true, family: 'ballistic' });
  assert.equal(model.buffs[0].maxLevel, 3);
  assert.deepEqual(model.families.filter(family => family.active).map(family => [family.id, family.bonus]),
    [['ballistic', '+15% damage'], ['energy', '+15% damage']]);
  run.weaponLevels = { rail: 1, ion: 1, drones: 1, arc: 1 };
  const energy = buildSlotHudModel(run, 'en').families.find(family => family.id === 'energy');
  assert.equal(energy.nextThreshold, undefined);
  assert.equal(energy.bonus, '+45% damage · −10% cooldown');
});

test('all sixty single-rank gains are visible in English and Korean without damage or cooldown text', () => {
  for (const language of ['en', 'ko']) for (const id of WEAPON_IDS) {
    for (let next = 2; next <= DRAFT_RULES.maxWeaponLevel; next++) {
      const model = buildDraftCardModel(card(id, next - 1, next), createProgression(1), language);
      assert.ok(model.growth, `${language} ${id} ${next}`);
      assert.doesNotMatch(model.growth, /[+−]\d+% (damage|cooldown)|(?:피해|대기 시간) [+−]\d+%/);
    }
  }
});
