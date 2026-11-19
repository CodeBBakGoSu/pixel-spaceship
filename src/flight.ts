const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const CRUISE_SPEED = 52;
export const BOOST_SPEED = 91;
export const BOOST_IGNITION_SPEED = 101;
export const BOOST_IGNITION_TICKS = 15;
export const TURN_RATE = 1.95;
export const BOOST_TURN_RATE = 2.3;

export function boostAirspeed(ticks: number): number {
  const surge = 1 - clamp((ticks - 1) / (BOOST_IGNITION_TICKS - 1), 0, 1);
  return BOOST_SPEED + surge * (BOOST_IGNITION_SPEED - BOOST_SPEED);
}

export function advanceBank(current: number, turn: number, dt: number): number {
  return current + (clamp(turn, -1, 1) * 0.65 - current) * (1 - Math.exp(-clamp(dt, 0, 0.05) * 5));
}
