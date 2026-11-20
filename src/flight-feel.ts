import { FLIGHT_FEEL } from './data/flight-feel.ts';
import { BOOST_SPEED } from './flight.ts';
import { clamp, STEP } from './stage-combat.ts';
import type { StageState } from './stage-types.ts';

type FlightSample = Pick<StageState, 'tick' | 'speed' | 'boosting' | 'boostTicks'>;
type Shock = keyof typeof FLIGHT_FEEL.shockSize;

export function easedBoost(from: number, active: boolean, elapsed: number): number {
  const duration = active ? FLIGHT_FEEL.boostAttackSeconds : FLIGHT_FEEL.boostReleaseSeconds;
  const rate = active ? FLIGHT_FEEL.boostAttackRate : FLIGHT_FEEL.boostReleaseRate;
  const phase = clamp(elapsed, 0, duration);
  const progress = Math.expm1(-rate * phase) / Math.expm1(-rate * duration);
  const eased = progress * progress * (3 - 2 * progress);
  return from + (Number(active) - from) * eased;
}

export function cameraBank(roll: number, view: 'chase' | 'cockpit', phone: boolean, reducedMotion = false,
  spinning = false): number {
  if (reducedMotion) return 0;
  // Keep the following view upright again when a complete barrel roll ends.
  const follow = spinning && (phone || view === 'chase') ? Math.sin(roll) : roll;
  const amount = view === 'chase' ? follow * FLIGHT_FEEL.chaseBankScale : follow;
  const limit = FLIGHT_FEEL.phoneBankLimit;
  return phone ? clamp(amount, -limit, limit) : amount;
}

export function laggedYaw(previous: number, target: number, seconds: number): number {
  const angle = target - previous;
  const difference = Math.atan2(Math.sin(angle), Math.cos(angle));
  const limit = FLIGHT_FEEL.chaseYawLimit;
  return target - clamp(difference * Math.exp(-FLIGHT_FEEL.chaseYawRate * seconds), -limit, limit);
}

export function shockEnvelope(amplitude: number, age: number): number {
  return age < 0 ? 0 : amplitude * Math.exp(-FLIGHT_FEEL.shockDecay * age);
}

export class FlightMotion {
  boost = 0;
  chaseYaw = 0;
  chaseBank = 0;
  shake = 0;
  shakeVertical = 0;
  private lastTick = -1;
  private boostFrom = 0;
  private boostAt = 0;
  private boostGoal = false;
  private shockAt = 0;
  private shockAmplitude = 0;

  shock(kind: Shock, tick: number, strength = 1): void {
    this.shockAmplitude = Math.max(FLIGHT_FEEL.shockSize[kind] * strength, this.shockAtTick(tick));
    this.shockAt = tick;
  }

  advance(state: FlightSample, yaw: number, roll: number, spinning: boolean, phone: boolean, reducedMotion: boolean): void {
    const { tick, boosting, boostTicks, speed } = state;
    const delta = tick - this.lastTick;
    const snap = this.lastTick < 0 || delta < 0;
    const seconds = Math.max(0, delta) * STEP;
    this.lastTick = tick;
    const targetBank = cameraBank(roll, 'chase', phone, reducedMotion, spinning);
    const limit = FLIGHT_FEEL.phoneBankLimit;
    this.chaseYaw = snap || reducedMotion ? yaw : laggedYaw(this.chaseYaw, yaw, seconds);
    const bank = snap || reducedMotion ? targetBank : targetBank + (this.chaseBank - targetBank)
      * Math.exp(-FLIGHT_FEEL.chaseBankRate * seconds);
    this.chaseBank = phone ? clamp(bank, -limit, limit) : bank;

    if (reducedMotion) {
      this.boost = this.boostFrom = this.shake = this.shakeVertical = this.shockAmplitude = 0;
      this.boostGoal = false;
      return;
    }
    if (snap || this.boostGoal !== boosting) {
      this.boostFrom = snap ? 0 : this.boost;
      this.boostAt = tick - (boosting ? Math.max(1, boostTicks) : 1);
      this.boostGoal = boosting;
    }
    this.boost = easedBoost(this.boostFrom, this.boostGoal, (tick - this.boostAt) * STEP);

    if (tick < this.shockAt) this.shockAmplitude = 0;
    const { tremble, shockVertical } = FLIGHT_FEEL;
    const time = tick * STEP;
    const shock = this.shockAtTick(tick);
    const phase = (tick - this.shockAt) * STEP * FLIGHT_FEEL.shockRate;
    const trembleSize = clamp(speed / BOOST_SPEED, 0, tremble.speedLimit) * tremble.size;
    this.shake = trembleSize * Math.sin(time * tremble.rate) + shock * Math.cos(phase);
    this.shakeVertical = tremble.sizeVertical * trembleSize * Math.sin(time * tremble.rateVertical)
      + shockVertical.size * shock * Math.sin(phase * shockVertical.rate);
  }

  private shockAtTick(tick: number): number {
    return shockEnvelope(this.shockAmplitude, (tick - this.shockAt) * STEP);
  }
}
