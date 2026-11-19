import { BANDS, clamp, MAX_ALTITUDE, MIN_ALTITUDE, STEP } from './stage-combat.ts';
import type { Band, Enemy, Maneuver, ManeuverKind, ManeuverTrail, StageState } from './stage-types.ts';

export const CRUISE_SPEED = 34;
export const INVERTED_FLIGHT_TICKS = 150;
export const BODY_GRACE_TICKS = 36;
const HALF_LOOP_TICKS = 96;
const ROLL_IN_TICKS = 20;
const ROLL_OUT_TICKS = 24;
const HALF_LOOP_TRAVEL = 96;
const HALF_LOOP_RADIUS = 45;
const HALF_LOOP_OFFSET = 22;
export const MANEUVERS = {
  immelmann: { ticks: HALF_LOOP_TICKS + INVERTED_FLIGHT_TICKS + ROLL_OUT_TICKS, cooldown: 240, boost: 0, flipTick: HALF_LOOP_TICKS },
  'split-s': { ticks: ROLL_IN_TICKS + HALF_LOOP_TICKS + INVERTED_FLIGHT_TICKS + ROLL_OUT_TICKS, cooldown: 240, boost: 0,
    flipTick: ROLL_IN_TICKS + HALF_LOOP_TICKS },
  'j-turn': { ticks: 52, cooldown: 420, boost: 0.4, flipTick: 1 },
};
export const TRAIL_SAMPLE_TICKS = 3;
export const TRAIL_LIMIT = Math.ceil(MANEUVERS['split-s'].ticks / TRAIL_SAMPLE_TICKS) + 1;
export const TRAIL_LINGER_TICKS = 150;
const TURN_BURST_TICKS = 18;
const CAMERA_LAG_TICKS = 3;
const CAMERA_SWEEP_TICKS = 24;
const ease = (u: number): number => (1 - Math.cos(Math.PI * u)) / 2;
const mix = (start: number, end: number, u: number): number => start + (end - start) * u;

export function nearestBand(altitude: number): Band {
  return altitude <= 92.5 ? 0 : altitude <= 127.5 ? 1 : 2;
}

export function chooseManeuver(turn: number, climb: number): ManeuverKind {
  if (climb <= -0.5) return 'split-s';
  if (Math.abs(climb) < 0.5 && Math.abs(turn) >= 0.5) return 'j-turn';
  return 'immelmann';
}

export function maneuverForKey(code: string, turn: number, climb: number): ManeuverKind | undefined {
  if (code === 'Space') return chooseManeuver(turn, climb);
}

export function exitAltitude(altitude: number, kind: ManeuverKind): number {
  const band = nearestBand(altitude);
  if (kind === 'immelmann' && band < 2) return BANDS[band + 1];
  if (kind === 'split-s' && band > 0) return BANDS[band - 1];
  return altitude;
}

export function canManeuver(state: StageState, kind: ManeuverKind): boolean {
  const spec = MANEUVERS[kind];
  return !!spec && state.phase === 'playing' && !state.paused && !state.maneuver
    && state.tick > state.graceUntil && state.tick >= state.maneuverReadyAt
    && state.boost >= spec.boost;
}

function isHalfLoop(kind: ManeuverKind): boolean {
  return kind === 'immelmann' || kind === 'split-s';
}

export function maneuverAllowsControl(maneuver: Maneuver | null): boolean {
  return !maneuver || (isHalfLoop(maneuver.kind) && maneuver.elapsed >= MANEUVERS[maneuver.kind].flipTick);
}

type Frame = {
  forward: number;
  lateral?: number;
  altitude: number;
  pitch: number;
  roll: number;
  reversed: boolean;
};

function halfLoopFrame(m: Maneuver, tick: number): Frame {
  const { altitude, exitAltitude: exit } = m;
  const split = m.kind === 'split-s';
  const rollIn = split ? ROLL_IN_TICKS : 0;
  const startDistance = rollIn * CRUISE_SPEED * STEP;
  if (tick < rollIn) {
    return { forward: tick * CRUISE_SPEED * STEP, altitude, pitch: 0,
      roll: Math.PI * ease(tick / rollIn), reversed: false };
  }
  const loopTick = tick - rollIn;
  if (loopTick >= HALF_LOOP_TICKS) {
    const recovery = clamp((loopTick - HALF_LOOP_TICKS - INVERTED_FLIGHT_TICKS) / ROLL_OUT_TICKS, 0, 1);
    return { forward: startDistance + HALF_LOOP_TRAVEL, lateral: m.side * HALF_LOOP_OFFSET,
      altitude: exit, pitch: 0, roll: Math.PI * (1 - ease(recovery)), reversed: true };
  }

  // Carry the half-ellipse forward and sideways. Its start and finish tangents still point in opposite directions.
  const u = loopTick / HALF_LOOP_TICKS, angle = Math.PI * u;
  const sin = Math.sin(angle), cos = Math.cos(angle), progress = ease(u);
  const rise = exit !== altitude ? 0 : split ? Math.max(MIN_ALTITUDE, altitude - 14) - altitude
    : Math.min(MAX_ALTITUDE, altitude + 18) - altitude;
  const forwardTangent = HALF_LOOP_TRAVEL / 2 * sin + HALF_LOOP_RADIUS * cos;
  const pitch = Math.atan2((split ? -1 : 1) * Math.max(24, Math.abs(exit - altitude)) / 2 * sin, forwardTangent);
  return { forward: startDistance + HALF_LOOP_TRAVEL * progress + HALF_LOOP_RADIUS * sin,
    lateral: m.side * HALF_LOOP_OFFSET * progress, altitude: mix(altitude, exit, progress) + rise * sin ** 2,
    pitch, roll: split ? Math.PI + pitch : 0, reversed: false };
}

function frameAt(m: Maneuver, tick: number): Frame {
  const { altitude } = m;
  switch (m.kind) {
    case 'immelmann':
    case 'split-s':
      return halfLoopFrame(m, tick);
    case 'j-turn': {
      const u = tick / MANEUVERS['j-turn'].ticks, angle = Math.PI * (0.65 * u + 0.35 * ease(u));
      const bend = Math.sin(angle);
      // Carry wide of the pursuit lane, then come back partway so it stays visible on the reversed heading.
      return { forward: 60 * ease(u) + 27 * bend, lateral: m.side * (14 * (1 - Math.cos(angle)) + 28 * bend ** 2),
        altitude, pitch: 0, roll: m.side * 0.64 * bend, reversed: tick > 0 };
    }
  }
}

export function advanceManeuver(maneuver: Maneuver) {
  const prior = frameAt(maneuver, maneuver.elapsed);
  const current = frameAt(maneuver, ++maneuver.elapsed);
  const distance = current.forward - prior.forward;
  const slide = (current.lateral ?? 0) - (prior.lateral ?? 0);
  const speed = Math.hypot(distance, slide) / STEP;
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
  const lead = isHalfLoop(trail.kind) ? 17 : -CAMERA_LAG_TICKS;
  const progress = ease(clamp((elapsed - flip + lead) / CAMERA_SWEEP_TICKS, 0, 1));
  return p.yaw + trail.side * Math.PI * (progress - (elapsed >= flip ? 1 : 0));
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

export function maneuverAttitude(maneuver: Maneuver, bank = 0) {
  const { kind, elapsed } = maneuver;
  const { pitch, roll: baseRoll } = frameAt(maneuver, elapsed);
  const cockpitPitch = Math.asin(Math.sin(pitch)), degree = Math.PI / 180;
  const roll = baseRoll - bank;
  let cameraBank = roll;
  if (kind === 'immelmann' && elapsed < HALF_LOOP_TICKS) {
    // Convert the last part of the pitch-over into a camera roll while the camera follows the turn.
    cameraBank = Math.PI * ease(clamp((elapsed - HALF_LOOP_TICKS + 23) / 23, 0, 1));
  } else if (kind === 'split-s' && elapsed >= ROLL_IN_TICKS && elapsed < MANEUVERS['split-s'].flipTick) {
    cameraBank = Math.PI;
  }
  return {
    pitch, roll,
    cockpitPitch,
    cameraPitch: clamp(cockpitPitch, -28 * degree, 34 * degree),
    cameraBank,
    inverted: Math.cos(pitch) * Math.cos(roll) < 0,
  };
}
