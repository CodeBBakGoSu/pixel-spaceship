import { COMBAT_FEEDBACK as C } from './data/combat-feedback.ts';
import type { Position, StageState } from './stage-types.ts';

type HitObserver = (id: number, damage: number, critical: boolean, target: Position) => void;
const observers = new WeakMap<StageState, HitObserver>();
export const gnatBursts = new WeakSet<object>();
export function observeDamage(state: StageState, observer: HitObserver): void { observers.set(state, observer); }
export function reportDamage(state: StageState, id: number, damage: number, critical: boolean, target: Position): void {
  observers.get(state)?.(id, damage, critical, target);
}

export class DamageFeedback {
  readonly slots = Array.from({ length: C.poolSize }, () => ({ id: 0, damage: 0, big: false, born: -Infinity, x: 0, z: 0, alt: 0 }));
  private created = 0;
  private readonly kills = new Float64Array(Math.ceil(C.counterWindow * 60) * 2);
  private previousKills = 0;
  private previousTime = -Infinity;
  beginFrame(): void { this.created = 0; }
  clear(): void { for (const slot of this.slots) slot.born = -Infinity; }
  hit(id: number, damage: number, critical: boolean, target: Position, now: number): boolean {
    if (!Number.isFinite(damage) || damage <= 0) return false;
    let slot = this.slots.find(s => s.id === id && now - s.born >= 0 && now - s.born <= C.mergeWindow);
    if (slot) {
      slot.damage += damage;
      slot.big ||= critical || slot.damage >= C.bigThreshold;
      return true;
    }
    if (this.created >= C.perFrame) return false;
    slot = this.slots.find(s => now - s.born >= C.lifetime);
    if (!slot) return false;
    this.created++;
    slot.id = id; slot.damage = damage; slot.big = critical || damage >= C.bigThreshold;
    slot.born = now; slot.x = target.x; slot.z = target.z; slot.alt = target.alt;
    return true;
  }
  count(total: number, now: number): number {
    if (now < this.previousTime || total < this.previousKills) {
      this.kills.fill(0); this.previousKills = total; this.clear();
    }
    const tick = Math.floor(now * 60);
    const buckets = this.kills.length / 2;
    const index = ((tick % buckets) + buckets) % buckets * 2;
    if (this.kills[index] !== tick + 1) { this.kills[index] = tick + 1; this.kills[index + 1] = 0; }
    this.kills[index + 1] += Math.max(0, total - this.previousKills);
    this.previousKills = total; this.previousTime = now;
    let count = 0;
    for (let i = 0; i < this.kills.length; i += 2) {
      const age = now - (this.kills[i] - 1) / 60;
      if (this.kills[i] && age >= 0 && age < C.counterWindow) count += this.kills[i + 1];
    }
    return count;
  }
}

export function batchBursts<T extends Position & { life: number }>(effects: readonly T[], isGnat: (effect: T) => boolean,
  out: { x: number; z: number; alt: number; life: number; count: number }): boolean {
  out.x = out.z = out.alt = out.life = out.count = 0;
  for (const effect of effects) if (isGnat(effect)) {
    out.x += effect.x; out.z += effect.z; out.alt += effect.alt; out.life = Math.max(out.life, effect.life); out.count++;
  }
  if (out.count < C.batchThreshold) return false;
  out.x /= out.count; out.z /= out.count; out.alt /= out.count;
  return true;
}
