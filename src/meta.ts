import { DRAFT_RULES, WEAPON_IDS, type BuffId, type WeaponId } from './data/items.ts';
import {
  ACE_SCORE_THRESHOLDS, HANGAR, HANGAR_IDS, HEAT_TIERS, MAX_HEAT, METRIC_RULES, RUN_PAYOUT, STARTER_BUFFS,
  STARTER_WEAPONS, UNLOCK_QUESTS, type HangarUpgradeId, type Heat, type QuestId, type RunMetric,
} from './data/meta.ts';
import { rngStream } from './stage-random.ts';

export type RunMetrics = Record<RunMetric, number>;
export type Profile = {
  credits: number;
  aceScore: number;
  maxHeat: Heat;
  upgrades: Partial<Record<HangarUpgradeId, number>>;
  metrics: RunMetrics;
};

export type QuestProgress = { id: QuestId; progress: number; target: number; unlocked: boolean };
export type RunSettlement = {
  outcome: 'clear' | 'timeout' | 'lost' | 'retreated';
  score: number;
  credits: number;
  heat: number;
  daily?: boolean;
};

const METRICS = Object.keys(METRIC_RULES) as RunMetric[];

const whole = (input: unknown, cap = Number.MAX_SAFE_INTEGER): number =>
  typeof input === 'number' && Number.isFinite(input) ? Math.min(cap, Math.max(0, Math.floor(input))) : 0;

const fields = (input: unknown): Readonly<Record<string, unknown>> =>
  input !== null && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};

function bandCount(mask: number): number {
  return (mask & 1) + (mask >> 1 & 1) + (mask >> 2 & 1);
}

export function createRunMetrics(): RunMetrics {
  return {
    weakPointHits: 0, multibandWithinFive: 0, maneuvers: 0, orbs: 0, peakAceWipe: 0, bandsKilled: 0,
    boostTicks: 0, lockedKills: 0, rearFlareKills: 0, manualBombs: 0,
  };
}

export function createProfile(): Profile {
  return { credits: 0, aceScore: 0, maxHeat: 0, upgrades: {}, metrics: createRunMetrics() };
}

export function isHeat(input: unknown): input is Heat {
  return typeof input === 'number' && Number.isInteger(input) && input >= 0 && input <= MAX_HEAT;
}

export function normalizeHeat(input: unknown, maximum: Heat = MAX_HEAT): Heat {
  return whole(input, maximum) as Heat;
}

export function normalizeProfile(input: unknown): Profile {
  const saved = fields(input);
  const savedUpgrades = fields(saved.upgrades);
  const savedMetrics = fields(saved.metrics);
  const profile = createProfile();
  profile.credits = whole(saved.credits);
  profile.aceScore = whole(saved.aceScore);
  profile.maxHeat = normalizeHeat(saved.maxHeat);
  for (const id of HANGAR_IDS) {
    const level = whole(savedUpgrades[id], HANGAR[id].costs.length);
    if (level) profile.upgrades[id] = level;
  }
  for (const metric of METRICS) {
    const value = whole(savedMetrics[metric], metric === 'multibandWithinFive' ? 3 : undefined);
    profile.metrics[metric] = metric === 'bandsKilled' ? value & 0b111 : value;
  }
  return profile;
}

export function aceRank(profile: Profile): number {
  return ACE_SCORE_THRESHOLDS.filter(threshold => profile.aceScore >= threshold).length;
}

function combine(metric: RunMetric, saved: number, live: number): number {
  switch (METRIC_RULES[metric]) {
    case 'best': return Math.max(saved, live);
    case 'bands': return bandCount(live) > bandCount(saved) ? live : saved;
    case 'total': return whole(saved + live);
  }
}

export function questProgress(profile: Profile, current?: RunMetrics): QuestProgress[] {
  return UNLOCK_QUESTS.map(({ id, metric, target }) => {
    const recorded = combine(metric, profile.metrics[metric], current?.[metric] ?? 0);
    const progress = Math.min(target, metric === 'bandsKilled' ? bandCount(recorded) : recorded);
    return { id, progress, target, unlocked: progress >= target };
  });
}

export function draftPool(profile: Profile, current?: RunMetrics): { weapons: WeaponId[]; buffs: BuffId[] } {
  const weapons: WeaponId[] = [...STARTER_WEAPONS], buffs: BuffId[] = [...STARTER_BUFFS];
  const isWeapon = (id: QuestId): id is WeaponId & QuestId => (WEAPON_IDS as readonly string[]).includes(id);
  for (const quest of questProgress(profile, current)) {
    if (!quest.unlocked) continue;
    if (isWeapon(quest.id)) weapons.push(quest.id);
    else buffs.push(quest.id);
  }
  return { weapons, buffs };
}

export function hangarOffer(profile: Profile, id: HangarUpgradeId) {
  const definition = HANGAR[id];
  const level = profile.upgrades[id] ?? 0;
  const { requiredRank, costs } = definition;
  const cost = costs[level] ?? null;
  return { level, maxLevel: costs.length, cost, requiredRank,
    canPurchase: cost !== null && profile.credits >= cost && aceRank(profile) >= requiredRank };
}

export function purchaseUpgrade(profile: Profile, id: HangarUpgradeId): Profile | null {
  if (!HANGAR_IDS.includes(id)) return null;
  const { canPurchase, cost, level } = hangarOffer(profile, id);
  if (!canPurchase || cost === null) return null;
  return { ...profile, credits: profile.credits - cost, upgrades: { ...profile.upgrades, [id]: level + 1 } };
}

export function hangarLoadout(profile: Profile, daily = false) {
  const amount = (id: HangarUpgradeId): number => (daily ? 0 : profile.upgrades[id] ?? 0) * HANGAR[id].perLevel;
  return {
    hull: amount('hull'), rerolls: DRAFT_RULES.rerolls + amount('reroll'),
    banishes: amount('banish'), skips: amount('skip'),
    magnetScale: 1 + amount('magnet'), xpScale: 1 + amount('growth'), creditScale: 1 + amount('credit'),
    ejector: amount('ejector') > 0,
  };
}

export function settleRun(profile: Profile, metrics: RunMetrics, result: RunSettlement) {
  const heat = normalizeHeat(result.heat);
  const victory = result.outcome === 'clear';
  const score = whole(result.score);
  const runCredits = whole(result.credits);
  const reward = runCredits + score * RUN_PAYOUT.creditsPerScore + (victory ? RUN_PAYOUT.wardenCache : 0);
  const payoutScale = HEAT_TIERS[heat].rewardScale * hangarLoadout(profile, result.daily).creditScale;
  const credits = whole(reward * payoutScale * (result.outcome === 'retreated' ? RUN_PAYOUT.retreatScale : 1));
  const nextMetrics = createRunMetrics();
  for (const metric of METRICS) nextMetrics[metric] = combine(metric, profile.metrics[metric], metrics[metric]);
  const next = {
    ...profile, credits: whole(profile.credits + credits),
    aceScore: whole(profile.aceScore + score * HEAT_TIERS[heat].rewardScale),
    maxHeat: victory ? normalizeHeat(Math.max(profile.maxHeat, heat + 1)) : profile.maxHeat,
    metrics: nextMetrics,
  };
  const priorUnlocks = new Set(questProgress(profile).filter(quest => quest.unlocked).map(quest => quest.id));
  const unlocked = questProgress(next).filter(quest => quest.unlocked && !priorUnlocks.has(quest.id)).map(quest => quest.id);
  return { profile: next, credits, unlocked };
}

/** The caller supplies the calendar day in Korea Standard Time. */
export function dailySeed(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [year, month, date] = day.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!year || month < 1 || month > 12 || date < 1 || date > days[month - 1]) return null;
  return rngStream(0, `daily:${day}`).rng;
}
