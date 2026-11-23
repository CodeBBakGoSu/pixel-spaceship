import { BUFFS, DRAFT_RULES, FAMILIES, WEAPON_IDS, WEAPONS, weaponRankDamage, type BuffId, type WeaponId } from './data/items.ts';
import { ECHO_RATE_BONUS } from './data/run-balance.ts';
import { HIT_WINDOW } from './stage-combat.ts';
import { random } from './stage-random.ts';
import type { StageState } from './stage-types.ts';

export function buffTuning<K extends BuffId>(state: StageState, id: K): typeof BUFFS[K]['levels'][number] | undefined {
  const level = state.run?.buffLevels[id] ?? 0;
  const levels = BUFFS[id].levels as readonly (typeof BUFFS[K]['levels'][number])[];
  return levels[level - 1];
}

export function weaponDamage(state: StageState, weapon: WeaponId, base: number): number {
  if (!state.run) return base;
  const level = state.run.weaponLevels[weapon] ?? 1;
  return base * weaponRankDamage(level) * (1 + state.run.damageUpgrades * DRAFT_RULES.damagePerUpgrade)
    * (familyBonus(state, weapon)?.damageScale ?? 1);
}

type FamilyBonus = { count: number; damageScale: number; pierce?: number; radiusScale?: number; cooldownScale?: number };

export function familyBonus(state: StageState, weapon: WeaponId): FamilyBonus | undefined {
  const levels = state.run?.weaponLevels;
  if (!levels?.[weapon]) return;
  const family = WEAPONS[weapon].family, tiers = FAMILIES[family];
  let count = 0;
  for (const id of WEAPON_IDS) if (levels[id] && WEAPONS[id].family === family) count++;
  for (let i = tiers.length - 1; i >= 0; i--) if (count >= tiers[i].count) return tiers[i];
}

export function criticalDamage(state: StageState, damage: number): number {
  const chance = buffTuning(state, 'fire-control')?.criticalChance ?? 0;
  return chance && random(state.streams.combat) < chance ? damage * 2 : damage;
}

export function hitWindow(state: StageState, base = HIT_WINDOW, rail = false): number {
  const lens = buffTuning(state, 'band-lens');
  return base + (rail ? lens?.railExtraWindow ?? 0 : lens?.extraWindow ?? 0);
}

function echoInterval(state: StageState, ticks: number): number {
  const reversal = state.reversal;
  if (!state.run || !reversal || state.tick >= reversal.until) return ticks;
  const rate = ECHO_RATE_BONUS + (buffTuning(state, 'overdrive-coil')?.echoBonus ?? 0);
  const overlap = Math.min(reversal.until - state.tick, ticks / (1 + rate));
  return ticks - overlap * rate;
}

export function weaponCooldown(state: StageState, weapon: WeaponId, base: number): number {
  const ticks = base * (buffTuning(state, 'capacitor')?.cooldownScale ?? 1) * (familyBonus(state, weapon)?.cooldownScale ?? 1);
  return Math.max(1, Math.round(weapon === 'twin' ? ticks : echoInterval(state, ticks)));
}

export function advanceEchoDeadlines(state: StageState): void {
  if (!state.run) return;
  const accelerate = (deadline: number) => state.tick + Math.round(echoInterval(state, deadline - state.tick));
  if (state.podsAt > state.tick) state.podsAt = accelerate(state.podsAt);
  for (const weapon of WEAPON_IDS) {
    const deadline = state.weaponFireAt[weapon];
    if (weapon !== 'twin' && deadline !== undefined && deadline > state.tick) {
      state.weaponFireAt[weapon] = accelerate(deadline);
    }
  }
}
