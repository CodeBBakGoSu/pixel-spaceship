import { BILLS, BILL_UNPAID_XP_SCALE, type BillDefinition } from './data/items.ts';
import { nearestBand } from './maneuvers.ts';
import { inBand, TICKS_PER_SECOND } from './stage-combat.ts';
import type { Enemy, Pickup, StageState } from './stage-types.ts';

export type BillId = typeof BILLS[number]['id'];
export type ActiveBill = {
  id: BillId;
  startedAt: number;
  deadline: number;
  progress: number;
  unharmedTicks: number;
  bandKills: [number, number, number];
};
export type BillState = {
  next: number;
  active: ActiveBill | null;
  last: { id: BillId; paid: boolean; tick: number } | null;
  offered: number;
  paid: number;
  interest: boolean;
};

const REAR_WEAPONS: ReadonlySet<string> = new Set(['pods', 'phoenix', 'bomb-bay']);

export function createBillState(): BillState {
  return { next: 0, active: null, last: null, offered: 0, paid: 0, interest: false };
}

export const billDefinition = (id: BillId): BillDefinition & { id: BillId } =>
  BILLS.find(bill => bill.id === id)!;

/** Call before combat so the offer's first tick can contribute to the objective. */
export function startBillTick(state: StageState): void {
  const run = state.run;
  if (!run || state.bills.active) return;
  const bills = state.bills;
  while (bills.next < BILLS.length) {
    const definition = BILLS[bills.next];
    const startedAt = definition.second * TICKS_PER_SECOND;
    if (state.tick < startedAt) return;
    const deadline = startedAt + definition.duration * TICKS_PER_SECOND;
    bills.next++;
    // A fixture can advance the starting clock past one or more offers.
    if (state.tick > deadline) continue;
    if (definition.demand.kind === 'pursuer-kills'
      && (run.weaponLevels.pods ?? 0) <= 0 && (run.weaponLevels.phoenix ?? 0) <= 0
      && (run.weaponLevels['bomb-bay'] ?? 0) <= 0
      && Object.keys(run.weaponLevels).length >= run.weaponSlots) continue;
    bills.active = { id: definition.id, startedAt, deadline, progress: 0, unharmedTicks: 0, bandKills: [0, 0, 0] };
    bills.offered++;
    bills.interest = false;
    return;
  }
}

export function noteBillKill(state: StageState, enemy: Enemy): void {
  const bill = state.bills.active;
  if (!bill || state.tick > bill.deadline || !enemy.shotDown || enemy.entry) return;
  switch (billDefinition(bill.id).demand.kind) {
    case 'same-band-kills':
      if (inBand(state.player.altitude, enemy.alt)) {
        const band = nearestBand(enemy.alt);
        bill.progress = Math.max(bill.progress, ++bill.bandKills[band]);
      }
      break;
    case 'pursuer-kills': {
      const credit = enemy.killCredit;
      if (credit?.rear && credit.weapon && REAR_WEAPONS.has(credit.weapon)
        && enemy.kind !== 'gnat' && enemy.kind !== 'turret' && !enemy.carrier) bill.progress++;
      break;
    }
    case 'full-repayment':
      bill.progress++;
      break;
  }
}

// --- S7d lane ---
export function noteBillPickup(state: StageState, pickup: Pick<Pickup, 'alt' | 'skim'>): void {
  const bill = state.bills.active;
  if (bill?.id === 'high-recovery' && state.tick <= bill.deadline && !pickup.skim && nearestBand(pickup.alt) === 2) bill.progress++;
}

export function billXpScale(state: StageState): number {
  return state.run && state.bills.interest ? BILL_UNPAID_XP_SCALE : 1;
}

/** Resolve after combat. Objective progress on the deadline can still pay the Bill. */
export function finishBillTick(state: StageState): { definition: BillDefinition & { id: BillId }; paid: boolean } | null {
  const bills = state.bills, bill = bills.active;
  if (!bill) return null;
  const definition = billDefinition(bill.id), demand = definition.demand;
  if (demand.kind === 'ace-wipe') {
    const kills = state.reversal?.killTicks ?? [];
    const streak = kills.filter(tick => tick >= bill.startedAt && tick <= bill.deadline).length;
    bill.progress = Math.max(bill.progress, streak);
  }
  if (demand.kind === 'full-repayment') {
    bill.unharmedTicks = Math.max(0, Math.min(state.tick, bill.deadline) - Math.max(bill.startedAt, state.lastHitTick));
  }
  const fulfilled = demand.kind === 'full-repayment'
    ? bill.progress >= demand.kills && bill.unharmedTicks >= demand.unharmedSeconds * TICKS_PER_SECOND
    : bill.progress >= demand.count;
  const paid = state.hull > 0 && fulfilled;
  if (!paid && state.tick < bill.deadline) return null;

  bills.active = null;
  bills.last = { id: bill.id, paid, tick: state.tick };
  bills.interest = !paid;
  if (paid) bills.paid++;
  return { definition, paid };
}
