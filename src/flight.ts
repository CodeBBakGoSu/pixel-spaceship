import { FLIGHT_MODEL } from './data/flight-model.ts';
import { scaleTravel } from './data/speed.ts';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const MAX_BANK_STEP = 0.05;

export const CRUISE_SPEED = scaleTravel(52);
export const BOOST_SPEED = scaleTravel(91);
export const BOOST_IGNITION_SPEED = scaleTravel(101);
export const BOOST_IGNITION_TICKS = 15;
export const TURN_RATE = 1.95;
export const BOOST_TURN_RATE = 2.3;

export function boostAirspeed(ticks: number): number {
  const surge = 1 - clamp((ticks - 1) / (BOOST_IGNITION_TICKS - 1), 0, 1);
  return BOOST_SPEED + surge * (BOOST_IGNITION_SPEED - BOOST_SPEED);
}

export function advanceBankDrive(current: number, turn: number, dt: number): number {
  const command = clamp(turn, -1, 1);
  // Roll authority earned in one direction does not carry into the opposite turn.
  const drive = current * command < 0 ? 0 : current;
  const strength = Math.abs(command);
  const rate = strength > Math.abs(drive)
    ? strength / FLIGHT_MODEL.fullBankHoldSeconds : FLIGHT_MODEL.bankDriveReleaseRate;
  const limit = clamp(dt, 0, MAX_BANK_STEP) * rate;
  return drive + clamp(command - drive, -limit, limit);
}

export function advanceBank(current: number, turn: number, dt: number, drive = 0): number {
  const command = clamp(turn, -1, 1);
  const { tapBank, maxBank, rollInRate, rollOutRate, rollInResponse, rollOutResponse } = FLIGHT_MODEL;
  const held = clamp(drive * Math.sign(command), 0, 1);
  const target = command * (tapBank + (maxBank - tapBank) * held);
  const leveling = command === 0 || current * target > 0 && Math.abs(target) < Math.abs(current);
  const seconds = clamp(dt, 0, MAX_BANK_STEP);
  const limit = seconds * (leveling ? rollOutRate : rollInRate);
  const blend = 1 - Math.exp(-seconds * (leveling ? rollOutResponse : rollInResponse));
  return current + clamp((target - current) * blend, -limit, limit);
}

export function bankYawRate(bank: number, turn: number, boosting: boolean): number {
  const command = clamp(turn, -1, 1);
  if (command === 0) return 0;
  const { maxBank, fullStickYawFloor, peakYawGain } = FLIGHT_MODEL;
  const alignedBank = clamp(bank * Math.sign(command), 0, maxBank);
  // Small commands retain their fine control. The aligned bank tightens a held turn.
  const levelGain = 1 - Math.abs(command) * (1 - fullStickYawFloor);
  const gain = levelGain + (peakYawGain - levelGain) * Math.sin(alignedBank) ** 3;
  return command * (boosting ? BOOST_TURN_RATE : TURN_RATE) * gain;
}

export function bankThrustFactor(bank: number, turn: number): number {
  const { maxBank, levelTurnDrag, deepTurnDrag } = FLIGHT_MODEL;
  const progress = clamp(Math.abs(bank) / maxBank, 0, 1);
  const eased = progress ** 2 * (3 - 2 * progress);
  const drag = levelTurnDrag + (deepTurnDrag - levelTurnDrag) * eased;
  return 1 - Math.min(1, Math.abs(turn)) * drag;
}

export function advanceBankDrop(current: number, bank: number, dt: number): number {
  const { steepBank, maxBank, maxBankDrop, bankSinkRate, bankRecoveryRate } = FLIGHT_MODEL;
  const target = maxBankDrop * clamp((Math.abs(bank) - steepBank) / (maxBank - steepBank), 0, 1);
  const seconds = clamp(dt, 0, MAX_BANK_STEP);
  return current + clamp(target - current, -bankRecoveryRate * seconds, bankSinkRate * seconds);
}
