import { autopilotInput } from './autoplay.ts';
import { BOT_DRAFT_VALUES, BOT_POLICY, BOT_PROFILES, type BotProfile, type BotProfileId } from './data/bot-profiles.ts';
import { DRAFT_RULES, EVOLUTIONS, WEAPONS, WEAPON_IDS } from './data/items.ts';
import { ROLL_PARRY_TICKS } from './data/roll.ts';
import { isWeaponId, type DraftCard } from './progression.ts';
import { canRoll } from './roll.ts';
import { BANDS, clamp, FLAK_RADIUS, HOSTILE_HIT_RADIUS, impactTime, inBand, MINE_RADIUS, TICKS_PER_SECOND } from './stage-combat.ts';
import { chestEvolutions } from './stage.ts';
import { random, rngStream } from './stage-random.ts';
import type { Band, Ground, Position, StageInput, StageState } from './stage-types.ts';

function nearestBand(alt: number): Band {
  return alt < (BANDS[0] + BANDS[1]) / 2 ? 0 : alt > (BANDS[1] + BANDS[2]) / 2 ? 2 : 1;
}

function scoutBand(state: StageState, profile: BotProfile): Band {
  const { x, z, altitude } = state.player;
  const current = nearestBand(altitude);
  const scores = BANDS.map((_, band) => -Math.abs(band - current) * BOT_POLICY.bandSwitchCost);
  for (const enemy of state.enemies) {
    const range = Math.hypot(enemy.x - x, enemy.z - z);
    if (enemy.hp > 0 && !enemy.entry && range < BOT_POLICY.sightRange) {
      scores[nearestBand(enemy.alt)] += 1 - range / BOT_POLICY.sightRange;
    }
  }
  const pickupRange = BOT_POLICY.salvageSightMinimum +
    (BOT_POLICY.salvageSightRange - BOT_POLICY.salvageSightMinimum) * profile.pickupGreed;
  for (const pickup of state.pickups) {
    const range = Math.hypot(pickup.x - x, pickup.z - z);
    if (range < pickupRange) scores[nearestBand(pickup.alt)] += Math.sqrt(pickup.xp) * BOT_POLICY.salvageValue * (1 - range / pickupRange);
  }
  for (const shot of state.shots) {
    if (shot.kind !== 'hostile') continue;
    const range = Math.hypot(shot.x - x, shot.z - z);
    if (range < BOT_POLICY.sightRange) scores[nearestBand(shot.alt)] -=
      BOT_POLICY.threatCost * profile.dodgeQuality * (1 - range / BOT_POLICY.sightRange);
  }
  return scores.reduce<Band>((best, value, band) => value > scores[best] ? band as Band : best, current);
}

function projectedThreat(state: StageState, quality: number) {
  const p = state.player;
  const vx = p.vx ?? 0, vz = p.vz ?? 0;
  const lookahead = BOT_POLICY.lookaheadMin + (BOT_POLICY.lookaheadMax - BOT_POLICY.lookaheadMin) * quality;
  const margin = BOT_POLICY.dodgeMarginMin + (BOT_POLICY.dodgeMarginMax - BOT_POLICY.dodgeMarginMin) * quality;
  return (hazard: Position & { vx?: number; vz?: number }, radius: number): boolean => {
    const x = hazard.x - p.x, z = hazard.z - p.z;
    const dx = (hazard.vx ?? 0) - vx, dz = (hazard.vz ?? 0) - vz;
    const speedSquared = dx * dx + dz * dz;
    const time = speedSquared > 0 ? clamp(-(x * dx + z * dz) / speedSquared, 0, lookahead) : 0;
    const offsetX = x + time * dx, offsetZ = z + time * dz;
    return offsetX * offsetX + offsetZ * offsetZ <= (radius + margin) ** 2;
  };
}

function perceive(state: StageState, profile: BotProfile, band: Band): StageState {
  const withinThreatRange = projectedThreat(state, profile.dodgeQuality);
  const onBand = (contact: Position) => nearestBand(contact.alt) === band;
  const p = state.player;
  const pickupRange = BOT_POLICY.salvageSightMinimum +
    (BOT_POLICY.salvageSightRange - BOT_POLICY.salvageSightMinimum) * profile.pickupGreed;
  const sameBand = state.enemies.filter(onBand);
  return {
    ...state,
    enemies: state.boss ? state.enemies : sameBand,
    shots: state.shots.filter(shot => shot.kind === 'hostile' && withinThreatRange(shot, HOSTILE_HIT_RADIUS)),
    enemyMines: state.enemyMines.filter(mine => withinThreatRange(mine, MINE_RADIUS)),
    effects: state.effects.filter(effect => effect.kind === 'flak' && withinThreatRange(effect, FLAK_RADIUS)),
    pickups: state.pickups.filter(pickup => onBand(pickup) && Math.hypot(pickup.x - p.x, pickup.z - p.z) <= pickupRange),
    chests: { ...state.chests, drops: state.chests.drops.filter(drop =>
      (profile.altitudeUse > 0.8 || onBand(drop)) && Math.hypot(drop.x - p.x, drop.z - p.z) <= pickupRange) },
  };
}

function cardValue(card: DraftCard, state: StageState): number {
  const { id, currentLevel, nextLevel } = card;
  const run = state.run;
  if (!run) return 0;
  const missing = state.maxHull - state.hull;
  if (id === 'repair') return missing >= DRAFT_RULES.repairHull ? BOT_POLICY.repairValue + missing * BOT_POLICY.missingHullValue : missing;
  if (id === 'damage' && currentLevel === DRAFT_RULES.maxDamageUpgrades) return BOT_DRAFT_VALUES.credits;
  let score = BOT_DRAFT_VALUES[id] + (nextLevel - currentLevel) * BOT_POLICY.levelValue;
  if (card.pairHint) score += BOT_POLICY.pairBonus;
  if (isWeaponId(id)) {
    const equipped = WEAPON_IDS.filter(weapon => run.weaponLevels[weapon]);
    if (!currentLevel) {
      score += BOT_POLICY.emptyWeaponBonus;
      const family = WEAPONS[id].family;
      score += equipped.filter(weapon => WEAPONS[weapon].family === family).length * BOT_POLICY.familyBonus;
    }
    if (run.buffLevels[EVOLUTIONS[id].buff]) score += BOT_POLICY.pairBonus * nextLevel / card.maxLevel;
  }
  if (card.variant === 'risky') score -= BOT_POLICY.riskHullCost * state.maxHull / state.hull;
  return score;
}

function rollDirection(state: StageState, profile: BotProfile, rng: { rng: number }): number | undefined {
  if (state.invulnerability > 0 || !canRoll(state)) return;
  const p = state.player, parry = ROLL_PARRY_TICKS / TICKS_PER_SECOND;
  const horizon = parry + BOT_POLICY.rollAnticipation * profile.rollDodgeQuality;
  const radius = HOSTILE_HIT_RADIUS + BOT_POLICY.rollPredictionMargin * profile.rollDodgeQuality;
  let earliest = Infinity, lateral = 0;
  for (const shot of state.shots) {
    if (shot.kind !== 'hostile' || !inBand(shot.alt, p.altitude)) continue;
    const hit = impactTime(shot, shot.vx - (p.vx ?? 0), shot.vz - (p.vz ?? 0), p, radius, 0, Math.min(shot.life, horizon));
    if (hit >= earliest) continue;
    earliest = hit;
    lateral = (shot.x - p.x) * Math.cos(p.yaw) - (shot.z - p.z) * Math.sin(p.yaw);
  }
  if (earliest === Infinity || random(rng) >= profile.rollUse) return;
  if (earliest <= parry && random(rng) < profile.parryTiming) return 0;
  return (random(rng) < profile.rollDodgeQuality ? -1 : 1) * (lateral < 0 ? -1 : 1);
}

/** A pilot's observations and reaction timing stay outside the flight state and are seeded independently. */
export function createBot(profileId: BotProfileId, seed: number): (state: StageState, ground?: Ground) => StageInput {
  const profile = BOT_PROFILES[profileId];
  const rng = rngStream(seed, `bot:${profileId}`);
  const rollRng = rngStream(seed, `bot:${profileId}:roll`);
  let nextDecision = 0;
  let nextScout = 0;
  let preferredBand: Band = 1;
  let seeksAltitude = false;
  let latestBill: string | null = null;
  let handlesBill = false;
  let held: StageInput = {};
  return (state, ground) => {
    if (state.phase === 'chest') {
      if (state.chestReveal) return { chestPick: 'continue' };
      const candidates = chestEvolutions(state);
      if (!candidates.length) return { chestPick: 'open' };
      const weapon = random(rng) < profile.chestPick
        ? candidates.reduce((best, candidate) => BOT_DRAFT_VALUES[candidate] > BOT_DRAFT_VALUES[best] ? candidate : best)
        : candidates[Math.floor(random(rng) * candidates.length)];
      return { chestPick: weapon };
    }
    if (state.phase === 'draft') {
      const cards = state.run?.cards;
      if (!cards?.length) return autopilotInput(state, 'full', ground);
      const randomPick = random(rng) >= profile.draftPickQuality;
      const card = randomPick ? cards[Math.floor(random(rng) * cards.length)] :
        cards.reduce((best, candidate) => cardValue(candidate, state) > cardValue(best, state) ? candidate : best);
      return { pick: card.id };
    }
    if (state.phase !== 'playing' || state.paused) return {};
    if (state.tick < nextDecision) return held;
    nextDecision = state.tick + profile.reactionDelayTicks;
    if (state.tick >= nextScout) {
      nextScout = state.tick + BOT_POLICY.scoutTicks;
      seeksAltitude = random(rng) < profile.altitudeUse;
      preferredBand = seeksAltitude ? scoutBand(state, profile) : nearestBand(state.player.altitude);
    }
    const activeBill = state.bills.active?.id ?? null;
    if (activeBill !== latestBill) {
      latestBill = activeBill;
      handlesBill = !!activeBill && random(rng) < profile.billsHandling;
    }
    const perceived = perceive(state, profile, preferredBand);
    if (!handlesBill) perceived.bills = { ...state.bills, active: null };
    const base = autopilotInput(perceived, 'full', ground);
    const aimOffset = (random(rng) * 2 - 1) * profile.aimErrorRad;
    const useManeuvers = random(rng) < profile.maneuverUse;
    held = {
      turn: base.turn === undefined ? undefined : clamp(base.turn + aimOffset * BOT_POLICY.turnGain, -1, 1),
      climb: state.boss && !seeksAltitude ? 0 : base.climb,
      boost: base.boost && useManeuvers,
    };
    const rollTurn = rollDirection(state, profile, rollRng);
    if (rollTurn !== undefined) return { ...held, toggleView: base.toggleView, roll: true, rollTurn };
    return { ...held, toggleView: base.toggleView, maneuver: useManeuvers ? base.maneuver : undefined,
      bomb: useManeuvers && base.bomb, flare: useManeuvers && base.flare };
  };
}
