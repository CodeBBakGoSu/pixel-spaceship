import { scaleTravel } from './speed.ts';

export const WEAPON_IDS = ['twin', 'pods', 'seeker', 'rail', 'flak', 'ion', 'drones', 'phoenix', 'bomb-bay', 'arc'] as const;
export const BUFF_IDS = ['overdrive-coil', 'hull-plating', 'magnet-core', 'band-lens', 'vector-thrusters',
  'flare-bay', 'ordnance-rack', 'fire-control', 'capacitor', 'salvage-beacon'] as const;
export const OVERFLOW_IDS = ['repair', 'damage', 'credits'] as const;

export type WeaponId = typeof WEAPON_IDS[number];
export type BuffId = typeof BUFF_IDS[number];
export type GearId = WeaponId | BuffId;
export type DraftChoiceId = GearId | typeof OVERFLOW_IDS[number];
export type FamilyId = 'ballistic' | 'ordnance' | 'energy';

type Coverage = 'forward-and-below' | 'same-band' | 'adjacent-homing' | 'vertical-blast'
  | 'climb-curtain' | 'tilted-orbit' | 'falling' | 'adjacent-chain';
type RankScale = readonly [number, number, number, number, number, number, number];
type WeaponDefinition = {
  family: FamilyId;
  coverage: Coverage;
  tuning: Record<string, number | readonly number[]> & { damageScale: RankScale; cooldownScale: RankScale };
};

export const TWIN_VOLLEYS = {
  2: [-2.2, 2.2],
  3: [-3.4, 0, 3.4],
  4: [-4.2, -1.6, 1.6, 4.2],
  5: [-5.4, -2.7, 0, 2.7, 5.4],
  6: [-6, -0.6, -0.2, 0.2, 0.6, 6],
} as const;

export const WEAPONS = {
  twin: {
    family: 'ballistic', coverage: 'forward-and-below',
    tuning: { cooldownTicks: 21, barrels: [2, 3, 3, 4, 4, 5, 6], damage: 1, range: scaleTravel(175),
      damageScale: [1, 2, 2, 2, 2, 2, 2], cooldownScale: [1, 1, 0.86, 0.76, 0.67, 0.76, 0.86],
      pierce: [0, 0, 1, 1, 1, 1, 2], tracerScale: [1, 1, 1, 1, 1.3, 1.3, 1.3], fanDegrees: [0, 0, 0, 0, 0, 6, 6] },
  },
  pods: {
    family: 'ballistic', coverage: 'same-band',
    tuning: { cooldownTicks: 43, range: [62, 62, 77.5, 77.5, 77.5, 77.5, 95].map(scaleTravel), damage: 1,
      damageScale: [1, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5], cooldownScale: [1, 1, 1, 1.1, 1.5, 1.5, 1.68],
      flank: [1, 2, 2, 2, 3, 3, 3], rear: [0, 0, 0, 1, 1, 1, 2], pierce: [0, 0, 0, 0, 0, 1, 1] },
  },
  seeker: {
    family: 'ordnance', coverage: 'adjacent-homing',
    tuning: { cooldownTicks: 180, count: [3, 4, 4, 5, 6, 6, 8],
      damageScale: [1, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5], cooldownScale: [1, 1, 1, 1, 1, 1, 1.28],
      damage: 0.7, lockedAceDamageScale: 18, range: scaleTravel(165), speed: scaleTravel(86), verticalSpeed: 34, turnRate: 4.6,
      radius: [12, 12, 15.6, 15.6, 15.6, 19.2, 19.2].map(scaleTravel),
      lifeSeconds: 3.2, spread: 0.14 },
  },
  rail: {
    family: 'energy', coverage: 'same-band',
    tuning: { chargeTicks: 54, cooldownTicks: 144, range: [225, 225, 225, 281.25, 281.25, 281.25, 281.25].map(scaleTravel),
      damageScale: [1, 1.25, 1.42, 1.6, 1.7, 1.35, 1.27], cooldownScale: [1, 1, 0.9, 0.9, 0.9, 1, 1],
      damage: 3, window: 3, width: [3, 4.5, 4.5, 4.5, 4.5, 4.5, 6].map(scaleTravel),
      lowerBandAt: 3, upperBandAt: 5, repeatAt: 6, repeatTicks: 18,
      lingerAt: 7, lingerTicks: 30, lingerDamageScale: 0.25 },
  },
  flak: {
    family: 'ballistic', coverage: 'vertical-blast',
    tuning: { cooldownTicks: 144, radius: [22, 25.3, 25.3, 25.3, 28.6, 28.6, 28.6].map(scaleTravel),
      damageScale: [1, 1.5, 1.5, 1.5, 1.5, 1, 1], cooldownScale: [1, 0.85, 1, 1, 1, 1.25, 1.25],
      range: scaleTravel(90), speed: scaleTravel(150), damage: 2, halfHeight: 28,
      count: [1, 1, 2, 2, 2, 3, 3], fragments: [0, 0, 0, 6, 6, 6, 12], spread: 0.16,
      fragmentDamage: 1, fragmentSpeed: scaleTravel(110), fragmentLifeSeconds: 0.33 },
  },
  ion: {
    family: 'energy', coverage: 'climb-curtain',
    tuning: { lifeTicks: [240, 300, 300, 300, 300, 300, 300], width: [5.5, 5.5, 7.15, 7.15, 7.15, 8.8, 8.8].map(scaleTravel),
      damageScale: [1, 1, 1, 1, 1, 1, 1], cooldownScale: [1, 0.9, 0.85, 1.1, 1.05, 1, 1.5],
      count: [1, 1, 1, 2, 2, 2, 3], laneOffset: scaleTravel(6), sampleTicks: 8,
      trailOffset: scaleTravel(9), hitCooldownTicks: 30, damage: 1, salvageAt: 5 },
  },
  drones: {
    family: 'energy', coverage: 'tilted-orbit',
    tuning: { count: [2, 3, 3, 4, 4, 5, 6], radius: [18, 18, 22.5, 22.5, 22.5, 22.5, 22.5].map(scaleTravel),
      damageScale: [1, 1.1, 1.2, 1.25, 1.3, 1.325, 1.325], cooldownScale: [1, 1, 1, 1, 1, 1, 1],
      doubleOrbitAt: 7, innerScale: 0.72,
      tilt: 10, periodTicks: 145, damage: 1, hitRadius: 5, hitCooldownTicks: 24, fireAt: 5, fireCooldownTicks: 72,
      fireRange: scaleTravel(66), fireSpeed: scaleTravel(220), fireDamage: 1 },
  },
  phoenix: {
    family: 'ordnance', coverage: 'falling',
    tuning: { cooldownTicks: 240, lifeBonusTicks: [0, 60, 60, 60, 60, 60, 60],
      damageScale: [1, 2, 2, 2, 1.5, 1.5, 1], cooldownScale: [1, 0.85, 1.2, 1.2, 1.5, 1.5, 1.71],
      count: [1, 1, 2, 2, 3, 3, 4], burnRadius: [0, 0, 0, 13, 13, 19.5, 19.5].map(scaleTravel) },
  },
  'bomb-bay': {
    family: 'ordnance', coverage: 'falling',
    tuning: { cooldownTicks: 360, damage: 4, radius: [34, 39.1, 39.1, 44.2, 44.2, 44.2, 44.2].map(scaleTravel),
      damageScale: [1, 1.5, 1.5, 1.5, 1.4, 1.3, 1.24], cooldownScale: [1, 0.85, 1, 1, 1.1, 1.1, 1],
      volley: [1, 1, 2, 2, 3, 3, 4], followUpTicks: 12, fireAt: 6, fireTicks: 90, fireDamageScale: 0.25 },
  },
  arc: {
    family: 'energy', coverage: 'adjacent-chain',
    tuning: { cooldownTicks: 132, damage: 1.8, range: scaleTravel(55), jumpRange: scaleTravel(42),
      damageScale: [1, 1.1, 1.2, 1.25, 1.3, 1.1, 1.1], cooldownScale: [1, 1, 1, 1, 1, 1.1, 1.23],
      jumps: [2, 3, 4, 4, 5, 5, 7], branchesAt: 6, adjacentScale: 0.6,
      explosionAt: 4, explosionRadius: scaleTravel(16), explosionScale: 0.6 },
  },
} as const satisfies Record<WeaponId, WeaponDefinition>;

type BuffDefinition = { levels: readonly [Record<string, number>, Record<string, number>, Record<string, number>] };

export const BUFFS = {
  'overdrive-coil': { levels: [
    { bonusTicks: 30, echoBonus: 0.15 }, { bonusTicks: 60, echoBonus: 0.25 }, { bonusTicks: 90, echoBonus: 0.35 },
  ] },
  'hull-plating': { levels: [{ maxHull: 1 }, { maxHull: 2 }, { maxHull: 3 }] },
  'magnet-core': { levels: [
    { radiusScale: 1.2, extraWindow: 2 }, { radiusScale: 1.4, extraWindow: 4 }, { radiusScale: 1.6, extraWindow: 6 },
  ] },
  'band-lens': { levels: [
    { extraWindow: 1, railExtraWindow: 0.7 }, { extraWindow: 2, railExtraWindow: 1.4 }, { extraWindow: 3, railExtraWindow: 2.1 },
  ] },
  'vector-thrusters': { levels: [{ agilityScale: 1.08 }, { agilityScale: 1.16 }, { agilityScale: 1.25 }] },
  'flare-bay': { levels: [
    { stock: 1, reloadScale: 0.85, burnBonusTicks: 18 }, { stock: 2, reloadScale: 0.75, burnBonusTicks: 36 },
    { stock: 3, reloadScale: 0.65, burnBonusTicks: 54 },
  ] },
  'ordnance-rack': { levels: [
    { stock: 1, reloadScale: 0.85, radiusScale: 1.1 }, { stock: 2, reloadScale: 0.75, radiusScale: 1.2 },
    { stock: 3, reloadScale: 0.65, radiusScale: 1.3 },
  ] },
  'fire-control': { levels: [
    { lockScale: 0.85, criticalChance: 0.05 }, { lockScale: 0.7, criticalChance: 0.10 }, { lockScale: 0.55, criticalChance: 0.15 },
  ] },
  capacitor: { levels: [{ cooldownScale: 0.94 }, { cooldownScale: 0.88 }, { cooldownScale: 0.82 }] },
  'salvage-beacon': { levels: [
    { xpScale: 1.1, creditScale: 1.1, luck: 0.04 }, { xpScale: 1.2, creditScale: 1.2, luck: 0.08 },
    { xpScale: 1.3, creditScale: 1.3, luck: 0.12 },
  ] },
} as const satisfies Record<BuffId, BuffDefinition>;

export const EVOLUTIONS = {
  twin: { id: 'aurora-gatling', buff: 'overdrive-coil' },
  pods: { id: 'aegis-halo', buff: 'hull-plating' },
  seeker: { id: 'swarm-rack', buff: 'fire-control' },
  rail: { id: 'prism-lance', buff: 'band-lens' },
  flak: { id: 'skybreaker', buff: 'capacitor' },
  ion: { id: 'plasma-ribbon', buff: 'vector-thrusters' },
  drones: { id: 'collector-swarm', buff: 'magnet-core' },
  phoenix: { id: 'phoenix-rising', buff: 'flare-bay' },
  'bomb-bay': { id: 'carpet-annihilator', buff: 'ordnance-rack' },
  arc: { id: 'storm-crown', buff: 'salvage-beacon' },
} as const satisfies Record<WeaponId, { id: string; buff: BuffId }>;
export type EvolutionId = typeof EVOLUTIONS[WeaponId]['id'];

type FamilyTier = {
  count: 2 | 3 | 4;
  damageScale: number;
  pierce?: number;
  radiusScale?: number;
  cooldownScale?: number;
};
export const FAMILIES = {
  ballistic: [{ count: 2, damageScale: 1.15 }, { count: 3, damageScale: 1.3, pierce: 1 }],
  ordnance: [{ count: 2, damageScale: 1.15 }, { count: 3, damageScale: 1.3, radiusScale: 1.2 }],
  energy: [{ count: 2, damageScale: 1.15 }, { count: 3, damageScale: 1.3, cooldownScale: 0.9 },
    { count: 4, damageScale: 1.45, cooldownScale: 0.9 }],
} as const satisfies Record<FamilyId, readonly FamilyTier[]>;

export type ChestDefinition = { id: string; second: number; carrierXp: number } & (
  { kind: 'supply'; rewards: readonly { count: 1 | 3 | 5; weight: number }[] } |
  { kind: 'evolution'; bonus: readonly [number, number]; fallback: number; escort: boolean }
);
export const CHESTS = [
  { id: 'coast-supply', second: 100, carrierXp: 30, kind: 'supply',
    rewards: [{ count: 1, weight: 70 }, { count: 3, weight: 25 }, { count: 5, weight: 5 }] },
  { id: 'first-evolution', second: 205, carrierXp: 30, kind: 'evolution', bonus: [1, 2], fallback: 3, escort: false },
  { id: 'siege-supply', second: 310, carrierXp: 30, kind: 'supply',
    rewards: [{ count: 1, weight: 40 }, { count: 3, weight: 45 }, { count: 5, weight: 15 }] },
  { id: 'second-evolution', second: 400, carrierXp: 30, kind: 'evolution', bonus: [1, 2], fallback: 3, escort: true },
] as const satisfies readonly ChestDefinition[];
export type ChestId = typeof CHESTS[number]['id'];

export type BillDefinition = { id: string; second: number; duration: number; demand: BillDemand; reward: BillReward };
type BillDemand =
  | { kind: 'same-band-kills' | 'ace-wipe' | 'pursuer-kills' | 'high-salvage'; count: number }
  | { kind: 'full-repayment'; kills: number; unharmedSeconds: number };
type BillReward = { upgrades?: number; rerolls?: number; chestPicks?: number; repair?: number | 'full' };
export const BILL_UNPAID_XP_SCALE = 0.75;
export const BILLS = [
  { id: 'first-levy', second: 60, duration: 40, demand: { kind: 'same-band-kills', count: 3 }, reward: { upgrades: 1 } },
  { id: 'ace-duty', second: 150, duration: 30, demand: { kind: 'ace-wipe', count: 3 }, reward: { rerolls: 1 } },
  { id: 'rear-guard', second: 255, duration: 30, demand: { kind: 'pursuer-kills', count: 3 }, reward: { chestPicks: 3 } },
  { id: 'high-recovery', second: 345, duration: 30, demand: { kind: 'high-salvage', count: 10 }, reward: { repair: 2, upgrades: 1 } },
  { id: 'full-repayment', second: 435, duration: 30, demand: { kind: 'full-repayment', kills: 25, unharmedSeconds: 20 },
    reward: { repair: 'full', upgrades: 2 } },
] as const satisfies readonly BillDefinition[];

export const STARTER_SHIP = { id: 'hawk', weapon: 'twin' } as const satisfies { id: string; weapon: WeaponId };
export const DRAFT_RULES = {
  cardCount: 3, baseSlots: 3, maxSlots: 4, weaponUnlockTick: 4 * 60 * 60, buffUnlockRank: 3,
  maxWeaponLevel: 7, maxBuffLevel: 3, rerolls: 1, maxRerolls: 3, maxBanishes: 2, maxSkips: 2,
  overchargedChance: 0.08, riskyChance: 0.15, riskHull: 1, repairHull: 2,
  damagePerUpgrade: 0.05, maxDamageUpgrades: 3, creditReward: 25, cappedDamageCredit: 15,
  xpBase: 14, xpPerLevel: 2.4,
} as const;
