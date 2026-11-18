import { BANDS, clamp, MAX_ALTITUDE, MIN_ALTITUDE, STEP } from './stage-combat.ts';
import type { Band, Maneuver, ManeuverKind, StageState } from './stage-types.ts';

export const CRUISE_SPEED = 34;
export const MANEUVERS = {
  immelmann: { ticks: 90, cooldown: 240, boost: 0 },
  'split-s': { ticks: 90, cooldown: 240, boost: 0 },
  cobra: { ticks: 60, cooldown: 180, boost: 0 },
  'j-turn': { ticks: 1, cooldown: 420, boost: 0.4 },
};

const HALF_LOOP_TICKS = 54;
const ROLL_TICKS = 18;
const COBRA_ENTRY = 9;
const COBRA_STALL = 48;
const COBRA_SPEED = 2;
const COBRA_PITCH = 70 * Math.PI / 180;
const ease = (u: number): number => (1 - Math.cos(Math.PI * u)) / 2;
const mix = (start: number, end: number, u: number): number => start + (end - start) * u;

export function nearestBand(altitude: number): Band {
  return altitude <= 92.5 ? 0 : altitude <= 127.5 ? 1 : 2;
}

export function chooseManeuver(turn: number, climb: number, brake: boolean): ManeuverKind {
  if (brake) return 'cobra';
  if (climb <= -0.5) return 'split-s';
  if (Math.abs(climb) < 0.5 && Math.abs(turn) >= 0.5) return 'j-turn';
  return 'immelmann';
}

export function exitAltitude(altitude: number, kind: ManeuverKind): number {
  const band = nearestBand(altitude);
  if (kind === 'immelmann') return BANDS[Math.min(2, band + 1)];
  if (kind === 'split-s') return BANDS[Math.max(0, band - 1)];
  return altitude;
}

export function canManeuver(state: StageState, kind: ManeuverKind): boolean {
  return state.phase === 'playing' && !state.paused && !state.maneuver
    && state.tick > state.graceUntil && state.tick >= state.maneuverReadyAt
    && state.boost >= MANEUVERS[kind].boost;
}

type Frame = {
  forward: number;
  altitude: number;
  pitch: number;
  roll: number;
  reversed: boolean;
};

function frameAt(m: Maneuver, tick: number): Frame {
  const { altitude, exitAltitude: exit } = m;
  switch (m.kind) {
    case 'immelmann': {
      const apex = Math.min(MAX_ALTITUDE, Math.max(altitude, exit) + 18);
      if (tick < HALF_LOOP_TICKS) {
        const u = tick / HALF_LOOP_TICKS;
        return { forward: 10 * Math.sin(Math.PI * u), altitude: mix(altitude, apex, ease(u)),
          pitch: Math.PI * u, roll: 0, reversed: false };
      }
      const recovery = tick - HALF_LOOP_TICKS;
      // At the apex, reversing yaw and adding a half roll preserves the inverted mesh pose.
      return { forward: -CRUISE_SPEED * recovery * STEP,
        altitude: mix(apex, exit, ease(recovery / (2 * ROLL_TICKS))), pitch: 0,
        roll: Math.PI * (1 - ease(Math.min(1, recovery / ROLL_TICKS))), reversed: true };
    }
    case 'split-s': {
      if (tick < ROLL_TICKS) {
        return { forward: CRUISE_SPEED * tick * STEP, altitude, pitch: 0,
          roll: Math.PI * ease(tick / ROLL_TICKS), reversed: false };
      }
      const trough = Math.max(MIN_ALTITUDE, Math.min(altitude, exit) - 12);
      const dive = tick - ROLL_TICKS, rollDistance = CRUISE_SPEED * ROLL_TICKS * STEP;
      if (dive < HALF_LOOP_TICKS) {
        const u = dive / HALF_LOOP_TICKS;
        return { forward: rollDistance + 10 * Math.sin(Math.PI * u), altitude: mix(altitude, trough, ease(u)),
          pitch: -Math.PI * u, roll: Math.PI, reversed: false };
      }
      const recovery = dive - HALF_LOOP_TICKS;
      return { forward: rollDistance - CRUISE_SPEED * recovery * STEP,
        altitude: mix(trough, exit, ease(recovery / ROLL_TICKS)), pitch: 0, roll: 0, reversed: true };
    }
    case 'cobra': {
      const entry = Math.min(tick, COBRA_ENTRY), stall = Math.max(0, Math.min(tick, COBRA_STALL) - COBRA_ENTRY);
      const recovery = Math.max(0, tick - COBRA_STALL);
      const entryAverage = mix(m.speed, COBRA_SPEED, entry / (2 * COBRA_ENTRY));
      const recoveryTicks = MANEUVERS.cobra.ticks - COBRA_STALL;
      const recoveryAverage = mix(COBRA_SPEED, CRUISE_SPEED, recovery / (2 * recoveryTicks));
      return { forward: STEP * (entry * entryAverage + stall * COBRA_SPEED + recovery * recoveryAverage), altitude,
        pitch: COBRA_PITCH * ease(entry / COBRA_ENTRY) * (1 - ease(recovery / recoveryTicks)), roll: 0, reversed: false };
    }
    case 'j-turn':
      return { forward: 0, altitude, pitch: 0, roll: 0, reversed: tick > 0 };
  }
}

export function advanceManeuver(maneuver: Maneuver) {
  const prior = frameAt(maneuver, maneuver.elapsed);
  const current = frameAt(maneuver, ++maneuver.elapsed);
  const distance = current.forward - prior.forward;
  let speed = Math.abs(distance) / STEP;
  if (maneuver.kind === 'cobra') {
    const tick = maneuver.elapsed;
    speed = tick < COBRA_ENTRY ? mix(maneuver.speed, COBRA_SPEED, tick / COBRA_ENTRY)
      : mix(COBRA_SPEED, CRUISE_SPEED, Math.max(0, tick - COBRA_STALL) / (MANEUVERS.cobra.ticks - COBRA_STALL));
  }
  return { distance, speed, altitude: current.altitude, reverse: current.reversed && !prior.reversed };
}

export function maneuverAttitude(maneuver: Maneuver) {
  const { pitch, roll } = frameAt(maneuver, maneuver.elapsed);
  const cockpitPitch = Math.asin(Math.sin(pitch)), degree = Math.PI / 180;
  return {
    pitch, roll,
    cockpitPitch,
    cameraPitch: clamp(cockpitPitch, -28 * degree, 34 * degree),
    cameraBank: clamp(roll, -20 * degree, 20 * degree),
    inverted: Math.cos(pitch) * Math.cos(roll) < 0,
    stalled: maneuver.kind === 'cobra' && maneuver.elapsed >= COBRA_ENTRY && maneuver.elapsed <= COBRA_STALL,
  };
}
