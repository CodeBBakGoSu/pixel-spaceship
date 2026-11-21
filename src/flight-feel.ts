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

export type FlightAttitudeSample = { altitude: number; climbRate: number; controlled: boolean; turn: number };

/** The path angle the ship is really flying at, from the sim's climb rate and airspeed. */
export function pathPitch(climbRate: number, speed: number): number {
  const limit = FLIGHT_FEEL.pitch.limit;
  return clamp(Math.atan2(climbRate, Math.max(20, speed)), -limit, limit);
}

export class FlightMotion {
  boost = 0;
  /** Smoothed path angle, rad (nose up positive). */
  pitch = 0;
  /** Altitude the chase camera follows: it lags a climb or dive so the ship moves in the frame. */
  followAlt = NaN;
  /** How far the chase camera looks up the sky (positive) or down at the ground, rad. */
  chaseTilt = 0;
  headX = 0;
  headY = 0;
  private headVX = 0;
  private headVY = 0;
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

  advance(state: FlightSample, yaw: number, roll: number, spinning: boolean, phone: boolean, reducedMotion: boolean,
    flight?: FlightAttitudeSample): void {
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
    if (flight) this.advanceAttitude(flight, speed, seconds, snap || reducedMotion, reducedMotion);

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

  private advanceAttitude(flight: FlightAttitudeSample, speed: number, seconds: number, snap: boolean, still: boolean): void {
    const { pitch, chaseAltitude, chaseTilt, head } = FLIGHT_FEEL;
    const target = flight.controlled ? pathPitch(flight.climbRate, speed) : 0;
    const ease = (rate: number) => 1 - Math.exp(-rate * seconds);
    this.pitch = snap ? target : this.pitch + (target - this.pitch) * ease(pitch.rate);
    if (snap || !Number.isFinite(this.followAlt)) {
      this.followAlt = flight.altitude;
    } else {
      // Carry most of the climb at once, then close the remaining gap: the ship drifts up or down the frame.
      const steep = clamp(Math.abs(flight.climbRate) * 1.5 / Math.max(20, speed), 0, 1);
      const carry = flight.controlled ? chaseAltitude.carry + chaseAltitude.steepCarry * steep : 1;
      this.followAlt += flight.climbRate * seconds * carry;
      this.followAlt += (flight.altitude - this.followAlt)
        * ease(flight.controlled ? chaseAltitude.catchUp : chaseAltitude.maneuverCatchUp);
    }
    this.chaseTilt = still ? 0 : chaseTilt.scale * Math.sin(this.pitch);
    if (still || snap) {
      this.headX = this.headY = this.headVX = this.headVY = 0;
      return;
    }
    // The pilot's head rides a soft spring: it sinks in a climb and under thrust, lifts in a dive, leans into turns.
    const lift = clamp(this.pitch / pitch.limit, -1, 1);
    const goalX = clamp(flight.turn, -1, 1) * head.turnLean;
    const goalY = -lift * head.climbSink - this.boost * head.boostSink;
    const step = Math.min(seconds, 0.05);
    this.headVX += ((goalX - this.headX) * head.stiffness - this.headVX * head.damping) * step;
    this.headVY += ((goalY - this.headY) * head.stiffness - this.headVY * head.damping) * step;
    this.headX = clamp(this.headX + this.headVX * step, -head.limit, head.limit);
    this.headY = clamp(this.headY + this.headVY * step, -head.limit, head.limit);
  }

  private shockAtTick(tick: number): number {
    return shockEnvelope(this.shockAmplitude, (tick - this.shockAt) * STEP);
  }
}
