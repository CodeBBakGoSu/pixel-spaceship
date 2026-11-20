import { DRAFT_RULES, EVOLUTIONS, FAMILIES, WEAPON_IDS, WEAPONS, type BuffId, type DraftChoiceId, type EvolutionId,
  type FamilyId, type GearId, type WeaponId } from './data/items.ts';
import { createTranslator, type Language } from './i18n.ts';
import { isBuffId, isWeaponId, type DraftCard, type RunProgression } from './progression.ts';

type Translator = ReturnType<typeof createTranslator>;
type FamilyTier = (typeof FAMILIES)[FamilyId][number];
type Category = FamilyId | 'buff' | 'supply';
export type LevelPip = 'owned' | 'gain' | 'empty';

export type DraftCardModel = {
  icon: DraftChoiceId;
  name: string;
  effect: string;
  description: string;
  family: Category;
  familyLabel: string;
  pips: LevelPip[];
  levelLabel: string;
  variant: DraftCard['variant'];
  variantLabel: string;
  cost: string;
  pairHint?: string;
  evolution?: { badge: string; hint: string };
  setPreview?: { count: number; tier: number; bonus: string; text: string };
};

export type SlotModel = { kind: 'empty' } | { kind: 'locked'; hint: string } | {
  kind: 'equipped'; id: GearId; icon: GearId | EvolutionId; name: string;
  level: number; maxLevel: number; evolved: boolean; family?: FamilyId;
};

export type FamilyModel = {
  id: FamilyId;
  icon: `set-${FamilyId}`;
  name: string;
  count: number;
  tier: number;
  nextThreshold?: number;
  active: boolean;
  bonus: string;
};

const families = Object.keys(FAMILIES) as FamilyId[];
const pairedWeapon = Object.fromEntries(WEAPON_IDS.map(weapon => [EVOLUTIONS[weapon].buff, weapon])) as Record<BuffId, WeaponId>;

function describeBonus(tier: FamilyTier, t: Translator): string {
  const effects = [t('loadout.bonus.damage', { percent: Math.round((tier.damageScale - 1) * 100) })];
  if ('pierce' in tier) effects.push(t('loadout.bonus.pierce', { count: tier.pierce }));
  if ('radiusScale' in tier) effects.push(t('loadout.bonus.radius', { percent: Math.round((tier.radiusScale - 1) * 100) }));
  if ('cooldownScale' in tier) effects.push(t('loadout.bonus.cooldown', { percent: Math.round((1 - tier.cooldownScale) * 100) }));
  return effects.join(' · ');
}

function familyModel(id: FamilyId, count: number, t: Translator): FamilyModel {
  const tiers: readonly FamilyTier[] = FAMILIES[id];
  const nextIndex = tiers.findIndex(tier => tier.count > count);
  const tier = tiers[nextIndex < 0 ? tiers.length - 1 : nextIndex - 1];
  return { id, icon: `set-${id}`, name: t(`loadout.family.${id}`), count, tier: tier?.count ?? 0,
    nextThreshold: tiers[nextIndex]?.count, active: !!tier, bonus: tier ? describeBonus(tier, t) : '' };
}

function equippedCount(levels: RunProgression['weaponLevels'], family: FamilyId): number {
  return WEAPON_IDS.filter(weapon => levels[weapon] && WEAPONS[weapon].family === family).length;
}

function evolutionHint(card: DraftCard, run: RunProgression, t: Translator): DraftCardModel['evolution'] {
  const weapon = isWeaponId(card.id) ? card.id : isBuffId(card.id) ? pairedWeapon[card.id] : undefined;
  if (!weapon || run.evolutions[weapon]) return;
  const recipe = EVOLUTIONS[weapon];
  const weaponLevel = run.weaponLevels[weapon] ?? 0, buffLevel = run.buffLevels[recipe.buff] ?? 0;
  const nextWeaponLevel = card.id === weapon ? card.nextLevel : weaponLevel;
  const nextBuffLevel = card.id === recipe.buff ? card.nextLevel : buffLevel;
  if (weaponLevel >= DRAFT_RULES.maxWeaponLevel && buffLevel > 0) return;
  if (nextWeaponLevel >= DRAFT_RULES.maxWeaponLevel && nextBuffLevel > 0) {
    return { badge: t('draft.evolves'), hint: t('draft.evolutionHint', { name: t(`item.${recipe.id}.title`) }) };
  }
}

export function levelPips(level: number, nextLevel: number, maxLevel: number): LevelPip[] {
  return Array.from({ length: maxLevel }, (_, i) => i < level ? 'owned' : i < nextLevel ? 'gain' : 'empty');
}

export function buildDraftCardModel(card: DraftCard, run: RunProgression, language: Language): DraftCardModel {
  const t = createTranslator(language);
  const { id, currentLevel, nextLevel, variant } = card;
  const weapon = isWeaponId(id), buff = isBuffId(id);
  const family = weapon ? WEAPONS[id].family : buff ? 'buff' : 'supply';
  const capped = id === 'damage' && currentLevel === card.maxLevel;
  const copyKey = capped ? 'draft.damageCap' : `item.${id}` as const;
  const maxLevel = capped ? 0 : card.maxLevel;
  let setPreview: DraftCardModel['setPreview'];
  if (family !== 'buff' && family !== 'supply') {
    const count = equippedCount(run.weaponLevels, family) + Number(currentLevel === 0);
    const { tier, bonus, nextThreshold } = familyModel(family, count, t);
    const label = tier ? t('draft.setPreview', { tier, bonus }) : t('draft.setProgress', { count, threshold: nextThreshold ?? 2 });
    setPreview = { count, tier, bonus, text: label };
  }

  return {
    icon: capped ? 'credits' : id, name: t(`${copyKey}.title`),
    effect: weapon || buff ? t(`draft.effect.${id}`) : t(`${copyKey}.copy`),
    description: t(`${copyKey}.copy`), family,
    familyLabel: family === 'buff' ? t('loadout.buffs') : family === 'supply' ? t('loadout.supply') : t(`loadout.family.${family}`),
    pips: levelPips(currentLevel, nextLevel, maxLevel),
    levelLabel: !maxLevel ? '' : currentLevel === 0 ? t('draft.new') : t('draft.levels', { from: currentLevel, to: nextLevel }),
    variant, variantLabel: variant === 'normal' ? '' : t(`draft.${variant}`),
    cost: variant === 'risky' ? t('draft.riskCost', { hull: DRAFT_RULES.riskHull }) : '',
    pairHint: card.pairHint ? t('draft.pair') : undefined,
    evolution: evolutionHint(card, run, t), setPreview,
  };
}

function fillSlots(equipped: SlotModel[], capacity: number, hint: string): SlotModel[] {
  return Array.from({ length: DRAFT_RULES.maxSlots }, (_, i) => i >= capacity ? { kind: 'locked', hint }
    : equipped[i] ?? { kind: 'empty' });
}

export function buildSlotHudModel(run: RunProgression, language: Language) {
  const t = createTranslator(language);
  const weapons = (Object.entries(run.weaponLevels) as [WeaponId, number][]).filter(([, level]) => level > 0).map(([id, level]): SlotModel => {
    const evolution = run.evolutions[id];
    const icon = evolution ?? id;
    return { kind: 'equipped', id, icon, name: t(`item.${icon}.title`), level, maxLevel: DRAFT_RULES.maxWeaponLevel,
      evolved: !!evolution, family: WEAPONS[id].family };
  });
  const buffs = (Object.entries(run.buffLevels) as [BuffId, number][]).filter(([, level]) => level > 0).map(([id, level]): SlotModel => (
    { kind: 'equipped', id, icon: id, name: t(`item.${id}.title`), level, maxLevel: DRAFT_RULES.maxBuffLevel, evolved: false }
  ));
  const unlockSeconds = DRAFT_RULES.weaponUnlockTick / 60;
  const weaponUnlock = `${Math.floor(unlockSeconds / 60)}:${String(unlockSeconds % 60).padStart(2, '0')}`;
  return {
    weapons: fillSlots(weapons, run.weaponSlots, weaponUnlock),
    buffs: fillSlots(buffs, run.buffSlots, t('loadout.buffUnlock', { rank: DRAFT_RULES.buffUnlockRank })),
    families: families.map(family => familyModel(family, equippedCount(run.weaponLevels, family), t)),
  };
}
