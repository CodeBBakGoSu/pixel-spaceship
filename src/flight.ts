export type View = 'overhead' | 'chase' | 'cockpit';
export type Flight = {
  x: number; z: number; yaw: number; altitude: number;
  speed: number; boost: number; pitch: number; roll: number;
};
export type Input = { turn: number; climb: number; boost: boolean };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function initialView(search: string): View {
  const view = new URLSearchParams(search).get('view');
  return view === 'overhead' || view === 'cockpit' || view === 'chase' ? view : 'chase';
}

export function createFlight(): Flight {
  return { x: 0, z: 0, yaw: 0, altitude: 78, speed: 24, boost: 0, pitch: 0, roll: 0 };
}

export function advanceFlight(ship: Flight, input: Input, elapsed: number, ground: (x: number, z: number) => number): void {
  const dt = clamp(elapsed, 0, 0.05);
  const turn = clamp(input.turn, -1, 1);
  const climb = clamp(input.climb, -1, 1);
  ship.yaw += turn * 1.25 * dt;
  ship.boost += ((input.boost ? 1 : 0) - ship.boost) * Math.min(1, dt * 4);
  ship.speed = 24 + ship.boost * 28;
  ship.x += Math.sin(ship.yaw) * ship.speed * dt;
  ship.z += Math.cos(ship.yaw) * ship.speed * dt;
  ship.altitude = clamp(ship.altitude + climb * 25 * dt, ground(ship.x, ship.z) + 22, 200);
  ship.pitch += (climb - ship.pitch) * Math.min(1, dt * 3);
  if (ship.roll > 0) ship.roll = Math.max(0, ship.roll - dt / 0.85);
}

export function startRoll(ship: Flight): void {
  if (ship.roll === 0) ship.roll = 1;
}
