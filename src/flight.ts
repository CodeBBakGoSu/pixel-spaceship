const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function rollAngle(remaining: number): number {
  return remaining > 0 ? (1 - Math.cos((1 - remaining) * Math.PI)) * Math.PI : 0;
}

export function advanceBank(current: number, turn: number, dt: number): number {
  return current + (clamp(turn, -1, 1) * 0.65 - current) * (1 - Math.exp(-clamp(dt, 0, 0.05) * 5));
}
