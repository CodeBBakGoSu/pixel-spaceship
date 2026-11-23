import {
  BUFFS, BUFF_IDS, DRAFT_RULES, EVOLUTIONS, OVERFLOW_IDS, STARTER_SHIP, WEAPON_IDS,
  type BuffId, type DraftChoiceId, type EvolutionId, type GearId, type WeaponId,
} from './data/items.ts';
import { random, rngStream } from './stage-random.ts';

export type DraftCard = {
  id: DraftChoiceId;
  currentLevel: number;
  nextLevel: number;
  maxLevel: number;
  variant: 'normal' | 'overcharged' | 'risky';
  pairHint: boolean;
};

export type ProgressionOptions = {
  weapons?: readonly WeaponId[];
  buffs?: readonly BuffId[];
  rank?: number;
  rerolls?: number;
  banishes?: number;
  skips?: number;
};

export type RunProgression = {
  weaponLevels: Partial<Record<WeaponId, number>>;
  buffLevels: Partial<Record<BuffId, number>>;
  evolutions: Partial<Record<WeaponId, EvolutionId>>;
  weaponSlots: number;
  buffSlots: number;
  weapons: readonly WeaponId[];
  buffs: readonly BuffId[];
  draftRng: { rng: number };
  canTradeHull: boolean;
  cards: DraftCard[];
  draftsResolved: number;
  rerolls: number;
  banishes: number;
  skips: number;
  banished: GearId[];
  credits: number;
  damageUpgrades: number;
};

const buffPairs = Object.fromEntries(
  WEAPON_IDS.map(id => [EVOLUTIONS[id].buff, id]),
) as Record<BuffId, WeaponId>;

function draftCharges(value: number | undefined, fallback: number, cap: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, Math.min(cap, Math.floor(value))) : fallback;
}

export function createProgression(seed: number, options: ProgressionOptions = {}): RunProgression {
  return {
    weaponLevels: { [STARTER_SHIP.weapon]: 1 }, buffLevels: {}, evolutions: {},
    weaponSlots: DRAFT_RULES.baseSlots,
    buffSlots: (options.rank ?? 0) >= DRAFT_RULES.buffUnlockRank ? DRAFT_RULES.maxSlots : DRAFT_RULES.baseSlots,
    weapons: [...new Set<WeaponId>(options.weapons ?? ['twin', 'pods'])], buffs: [...new Set(options.buffs ?? [])],
    draftRng: rngStream(seed, 'draft'), canTradeHull: false, cards: [], draftsResolved: 0,
    rerolls: draftCharges(options.rerolls, DRAFT_RULES.rerolls, DRAFT_RULES.maxRerolls),
    banishes: draftCharges(options.banishes, 0, DRAFT_RULES.maxBanishes),
    skips: draftCharges(options.skips, 0, DRAFT_RULES.maxSkips),
    banished: [], credits: 0, damageUpgrades: 0,
  };
}

export function updateRunSlots(run: RunProgression, tick: number, bossReady = false, rank = 0): void {
  if (tick >= DRAFT_RULES.weaponUnlockTick) run.weaponSlots = DRAFT_RULES.maxSlots;
  if (bossReady || rank >= DRAFT_RULES.buffUnlockRank) run.buffSlots = DRAFT_RULES.maxSlots;
}

export function runXpCost(level: number): number {
  const baseCost = DRAFT_RULES.xpEarlyCosts[level - 1] ?? DRAFT_RULES.xpBase + Math.round(DRAFT_RULES.xpPerLevel * level);
  const lateCost = Math.round(DRAFT_RULES.xpLateGrowth * Math.max(0, level - DRAFT_RULES.xpLateStartLevel));
  const endRunCost = Math.round(DRAFT_RULES.xpEndRunGrowth * Math.max(0, level - DRAFT_RULES.xpEndRunStartLevel));
  return baseCost + lateCost + endRunCost;
}

export function isWeaponId(id: DraftChoiceId): id is WeaponId {
  return (WEAPON_IDS as readonly string[]).includes(id);
}

export function isBuffId(id: DraftChoiceId): id is BuffId {
  return (BUFF_IDS as readonly string[]).includes(id);
}

function maximumLevel(id: GearId): number {
  return isWeaponId(id) ? DRAFT_RULES.maxWeaponLevel : DRAFT_RULES.maxBuffLevel;
}

function gearLevel(run: RunProgression, id: GearId): number {
  return (isWeaponId(id) ? run.weaponLevels[id] : run.buffLevels[id]) ?? 0;
}

function pickRandom<T>(run: RunProgression, pool: T[]): T {
  return pool.splice(Math.floor(random(run.draftRng) * pool.length), 1)[0];
}

function gearCard(run: RunProgression, id: GearId): DraftCard {
  const currentLevel = gearLevel(run, id);
  const maxLevel = maximumLevel(id);
  const luck = BUFFS['salvage-beacon'].levels[(run.buffLevels['salvage-beacon'] ?? 0) - 1]?.luck ?? 0;
  const roll = random(run.draftRng);
  const overchargedChance = DRAFT_RULES.overchargedChance + luck;
  let variant: DraftCard['variant'] = 'normal';
  if (currentLevel <= maxLevel - 2) {
    if (roll < overchargedChance) variant = 'overcharged';
    else if (roll < overchargedChance + DRAFT_RULES.riskyChance && run.canTradeHull) variant = 'risky';
  }
  const pair = isWeaponId(id) ? EVOLUTIONS[id].buff : buffPairs[id];
  return { id, currentLevel, nextLevel: currentLevel + (variant === 'normal' ? 1 : 2), maxLevel, variant,
    pairHint: currentLevel === 0 && gearLevel(run, pair) > 0 };
}

function overflowCard(run: RunProgression, id: typeof OVERFLOW_IDS[number]): DraftCard {
  const maxLevel = id === 'damage' ? DRAFT_RULES.maxDamageUpgrades : 0;
  const currentLevel = id === 'damage' ? run.damageUpgrades : 0;
  return { id, currentLevel, maxLevel, nextLevel: Math.min(currentLevel + 1, maxLevel), variant: 'normal', pairHint: false };
}

function eligibleGear(run: RunProgression, held: DraftChoiceId[] = []) {
  const canAddWeapon = Object.keys(run.weaponLevels).length < run.weaponSlots;
  const canAddBuff = Object.keys(run.buffLevels).length < run.buffSlots;
  const eligible = (id: GearId, canAdd: boolean): boolean => {
    const level = gearLevel(run, id);
    return !held.includes(id) && !run.banished.includes(id) && level < maximumLevel(id) && (level > 0 || canAdd);
  };
  return { weapons: run.weapons.filter(id => eligible(id, canAddWeapon)), buffs: run.buffs.filter(id => eligible(id, canAddBuff)) };
}

function deal(run: RunProgression, keep: DraftCard[] = []): DraftCard[] {
  const remaining = DRAFT_RULES.cardCount - keep.length;
  const held = keep.map(card => card.id);
  const { weapons, buffs } = eligibleGear(run, held);
  const cards = [...keep];
  if (remaining > 0 && run.draftsResolved === 0 && weapons.length && !held.some(isWeaponId)) {
    cards.push(gearCard(run, pickRandom(run, weapons)));
  }
  const pool: GearId[] = [...weapons, ...buffs];
  while (cards.length < DRAFT_RULES.cardCount && pool.length) cards.push(gearCard(run, pickRandom(run, pool)));
  const overflow: readonly (typeof OVERFLOW_IDS[number])[] = run.damageUpgrades < DRAFT_RULES.maxDamageUpgrades
    ? OVERFLOW_IDS : ['repair', 'credits', 'damage'];
  for (const id of overflow) {
    if (cards.length >= DRAFT_RULES.cardCount) break;
    if (!held.includes(id)) cards.push(overflowCard(run, id));
  }
  return cards;
}

export function openRunDraft(run: RunProgression, canTradeHull = true): DraftCard[] {
  if (!run.cards.length) {
    run.canTradeHull = canTradeHull;
    run.cards = deal(run);
  }
  return run.cards;
}

function closeDraft(run: RunProgression): void {
  run.cards = [];
  run.draftsResolved++;
}

function applyCard(run: RunProgression, card: DraftCard): void {
  const { id } = card;
  if (isWeaponId(id)) run.weaponLevels[id] = card.nextLevel;
  if (isBuffId(id)) run.buffLevels[id] = card.nextLevel;
  if (id === 'credits') run.credits += DRAFT_RULES.creditReward;
  if (id === 'damage') {
    if (run.damageUpgrades < DRAFT_RULES.maxDamageUpgrades) run.damageUpgrades = card.nextLevel;
    else run.credits += DRAFT_RULES.cappedDamageCredit;
  }
}

export function applyRunPick(run: RunProgression, id: DraftChoiceId): DraftCard | null {
  const card = run.cards.find(choice => choice.id === id);
  if (!card) return null;
  applyCard(run, card);
  closeDraft(run);
  return card;
}

export function availableEvolutions(run: RunProgression): WeaponId[] {
  return WEAPON_IDS.filter(id => !run.evolutions[id] && run.weaponLevels[id] === DRAFT_RULES.maxWeaponLevel
    && (run.buffLevels[EVOLUTIONS[id].buff] ?? 0) >= 1);
}

export function evolveWeapon(run: RunProgression, weapon: WeaponId): EvolutionId | null {
  if (!availableEvolutions(run).includes(weapon)) return null;
  return run.evolutions[weapon] = EVOLUTIONS[weapon].id;
}

export function rollBonusUpgrade(run: RunProgression, rng: { rng: number }): DraftCard {
  const { weapons, buffs } = eligibleGear(run);
  const legal: GearId[] = [...weapons, ...buffs];
  const owned = legal.filter(id => gearLevel(run, id) > 0);
  const pool = owned.length ? owned : legal;
  let card: DraftCard;
  if (pool.length) {
    const id = pool[Math.floor(random(rng) * pool.length)];
    const currentLevel = gearLevel(run, id);
    card = { id, currentLevel, nextLevel: currentLevel + 1, maxLevel: maximumLevel(id), variant: 'normal', pairHint: false };
  } else {
    card = overflowCard(run, OVERFLOW_IDS[Math.floor(random(rng) * OVERFLOW_IDS.length)]);
  }
  applyCard(run, card);
  return card;
}

export function rerollRunDraft(run: RunProgression): boolean {
  if (!run.cards.length || !run.rerolls) return false;
  run.rerolls--;
  run.cards = deal(run);
  return true;
}

export function banishRunCard(run: RunProgression, id: DraftChoiceId): boolean {
  if (!run.banishes || !(isWeaponId(id) || isBuffId(id)) || !run.cards.some(card => card.id === id)) return false;
  run.banishes--;
  run.banished.push(id);
  run.cards = deal(run, run.cards.filter(card => card.id !== id));
  return true;
}

export function skipRunDraft(run: RunProgression): boolean {
  if (!run.cards.length || !run.skips) return false;
  run.skips--;
  closeDraft(run);
  return true;
}
