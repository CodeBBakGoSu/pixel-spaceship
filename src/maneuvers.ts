import { BANDS, clamp, MAX_ALTITUDE, MIN_ALTITUDE, STEP } from './stage-combat.ts';
import type { Band, Enemy, Maneuver, ManeuverKind, ManeuverTrail, StageState } from './stage-types.ts';

export const CRUISE_SPEED = 34;
const HALF_LOOP_TICKS = 54;
const ROLL_TICKS = 18;
export const MANEUVERS = {
  immelmann: { ticks: 90, cooldown: 240, boost: 0, flipTick: HALF_LOOP_TICKS },
  'split-s': { ticks: 90, cooldown: 240, boost: 0, flipTick: HALF_LOOP_TICKS + ROLL_TICKS },
  cobra: { ticks: 60, cooldown: 180, boost: 0, flipTick: 0 },
  'j-turn': { ticks: 20, cooldown: 420, boost: 0.4, flipTick: 1 },
};
export const TRAIL_SAMPLE_TICKS = 3;
export const TRAIL_LIMIT = Math.ceil(MANEUVERS.immelmann.ticks / TRAIL_SAMPLE_TICKS) + 1;
export const TRAIL_LINGER_TICKS = 90;
const TURN_BURST_TICKS = 18;
const CAMERA_LAG_TICKS = 3;
const CAMERA_SWEEP_TICKS = 24;
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

export function maneuverForKey(code: string, turn: number, climb: number, brake: boolean): ManeuverKind | undefined {
  if (code === 'KeyC') return 'cobra';
  if (code === 'Space') return chooseManeuver(turn, climb, brake);
}

export function exitAltitude(altitude: number, kind: ManeuverKind): number {
  const band = nearestBand(altitude);
  if (kind === 'immelmann' && band < 2) return BANDS[band + 1];
  if (kind === 'split-s' && band > 0) return BANDS[band - 1];
  return altitude;
}

export function canManeuver(state: StageState, kind: ManeuverKind): boolean {
  return state.phase === 'playing' && !state.paused && !state.maneuver
    && state.tick > state.graceUntil && state.tick >= state.maneuverReadyAt
    && state.boost >= MANEUVERS[kind].boost;
}

type Frame = {
  forward: number;
  lateral?: number;
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
        return { forward: 17 * Math.sin(Math.PI * u), altitude: mix(altitude, apex, ease(u)),
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
        return { forward: rollDistance + 17 * Math.sin(Math.PI * u) - 12 * ease(u), altitude: mix(altitude, trough, ease(u)),
          pitch: -Math.PI * u, roll: Math.PI, reversed: false };
      }
      const recovery = dive - HALF_LOOP_TICKS;
      return { forward: rollDistance - 12 - CRUISE_SPEED * recovery * STEP,
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
    case 'j-turn': {
      const u = tick / MANEUVERS['j-turn'].ticks, angle = Math.PI * (0.25 * u + 0.75 * ease(u));
      return { forward: 8 * Math.sin(angle) - 5 * u * u, lateral: m.side * 9 * (1 - Math.cos(angle)), altitude,
        pitch: 0, roll: m.side * 0.42 * Math.sin(angle), reversed: tick > 0 };
    }
  }
}

export function advanceManeuver(maneuver: Maneuver) {
  const prior = frameAt(maneuver, maneuver.elapsed);
  const current = frameAt(maneuver, ++maneuver.elapsed);
  const distance = current.forward - prior.forward;
  const slide = (current.lateral ?? 0) - (prior.lateral ?? 0);
  let speed = Math.hypot(distance, slide) / STEP;
  if (maneuver.kind === 'cobra') {
    const tick = maneuver.elapsed;
    speed = tick < COBRA_ENTRY ? mix(maneuver.speed, COBRA_SPEED, tick / COBRA_ENTRY)
      : mix(COBRA_SPEED, CRUISE_SPEED, Math.max(0, tick - COBRA_STALL) / (MANEUVERS.cobra.ticks - COBRA_STALL));
  }
  return { distance, slide, speed, altitude: current.altitude, reverse: current.reversed && !prior.reversed };
}

export function trailEnd(trail: ManeuverTrail): number {
  return trail.startTick + MANEUVERS[trail.kind].ticks - 1;
}

export function activeTrail(state: StageState): ManeuverTrail | null {
  const trail = state.maneuverTrail;
  return trail && state.tick < trailEnd(trail) + TRAIL_LINGER_TICKS ? trail : null;
}

export function maneuverViewYaw(state: StageState): number {
  const { player: p, maneuverTrail: trail } = state;
  if (!trail) return p.yaw;
  const flip = MANEUVERS[trail.kind].flipTick, elapsed = state.tick - trail.startTick + 1;
  if (!flip || elapsed < flip) return p.yaw;
  const progress = clamp((elapsed - flip - CAMERA_LAG_TICKS) / CAMERA_SWEEP_TICKS, 0, 1);
  return p.yaw - trail.side * Math.PI * (1 - ease(progress));
}

export function turnExitBurst(state: StageState): number {
  const trail = state.maneuverTrail;
  if (trail?.kind !== 'j-turn') return 0;
  return 0.28 * clamp(1 - (state.tick - trailEnd(trail)) / TURN_BURST_TICKS, 0, 1);
}

export function formerPursuer(state: StageState, trail: ManeuverTrail | null, enemy: Enemy): boolean {
  if (!trail || !enemy.hp || !trail.pursuers.includes(enemy.id)) return false;
  const p = state.player;
  return (enemy.x - p.x) * Math.sin(p.yaw) + (enemy.z - p.z) * Math.cos(p.yaw) > 3;
}

export function maneuverAttitude(maneuver: Maneuver) {
  const { pitch, roll } = frameAt(maneuver, maneuver.elapsed);
  const cockpitPitch = Math.asin(Math.sin(pitch)), degree = Math.PI / 180;
  return {
    pitch, roll,
    cockpitPitch,
    cameraPitch: clamp(cockpitPitch, -28 * degree, 34 * degree),
    cameraBank: Math.sin(roll) * 20 * degree + (maneuver.kind === 'immelmann' ? Math.sin(2 * pitch) * 8 * degree : 0),
    inverted: Math.cos(pitch) * Math.cos(roll) < 0,
    stalled: maneuver.kind === 'cobra' && maneuver.elapsed >= COBRA_ENTRY && maneuver.elapsed <= COBRA_STALL,
  };
}
