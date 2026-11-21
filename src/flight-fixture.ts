import { FLIGHT_SURFACE } from './data/flight-world.ts';
import { ROLLS } from './data/roll.ts';
import { BOOST_SPEED, CRUISE_SPEED } from './flight.ts';
import { cloudFixturePoint } from './flight-atmosphere.ts';
import type { CombatEvents } from './hostile-events.ts';
import { LANDMARKS } from './reach.ts';
import { stepStage } from './stage.ts';
import { clamp } from './stage-combat.ts';
import type { Ground, StageState } from './stage-types.ts';

export function isFlightFixture(name: string | null): boolean {
  return name === 'hud' || name === 'bank' || name === 'roll' || name === 'boost'
    || name === 'trails' || name === 'low' || name === 'cloud';
}

export function primeFlightFixture(state: StageState, query: URLSearchParams, ground: Ground, events?: CombatEvents): void {
  const fixture = query.get('fixture');
  const { player: p } = state;
  Object.assign(p, { x: -128, z: -320, yaw: 0, bank: 0, altitude: 110 });
  state.tick = 317 * 60;
  state.speed = CRUISE_SPEED;
  state.level = 14;
  state.xp = 15;
  state.hull = 7;
  state.boost = 0.82;
  if (state.run) {
    state.run.weaponSlots = 4;
    state.run.weaponLevels = { twin: 4, seeker: 3, pods: 2 };
    state.run.buffLevels = { capacitor: 2, 'hull-plating': 1 };
    if (query.get('ion') === '1') {
      state.run.weaponLevels.ion = 3;
      primeIonWake(state);
    }
  }
  if (fixture === 'bank') {
    const bank = Number(query.get('bank') ?? 1.5);
    p.bank = Number.isFinite(bank) ? clamp(bank, -1.5, 1.5) : 1.5;
  } else if (fixture === 'boost' || fixture === 'trails') {
    state.boosting = true;
    state.boostTicks = 32;
    state.speed = BOOST_SPEED;
    if (fixture === 'trails') p.bank = 1.12;
  } else if (fixture === 'low') {
    const land = query.get('surface') === 'land';
    const point = land ? LANDMARKS.ridge : LANDMARKS.strait;
    const clearance = land ? FLIGHT_SURFACE.fixture.landClearance : FLIGHT_SURFACE.fixture.waterClearance;
    Object.assign(p, {
      x: point.x, z: point.z, bank: 0.22, yaw: land ? -0.66 : 0,
      altitude: ground(point.x, point.z) + clearance,
    });
  } else if (fixture === 'cloud') {
    const point = cloudFixturePoint(state.arena);
    Object.assign(p, { x: point.x, z: point.z, altitude: point.altitude });
  } else if (fixture === 'roll') {
    const cue = query.get('cue'), side = query.get('side') === 'left' ? -1 : 1;
    const aileron = query.get('kind') === 'aileron';
    if (cue === 'parry') state.shots.push({
      x: p.x - 2, z: p.z + 9, alt: p.altitude, vx: 105, vz: -480, kind: 'hostile',
      life: 0.5, damage: 2, volley: 0, nearMiss: false, lockId: null,
    });
    const phase = Number(query.get('progress') ?? 0.36);
    const ticks = ROLLS[aileron ? 'aileron' : 'barrel'].ticks;
    const age = Math.round(ticks * (Number.isFinite(phase) ? clamp(phase, 0, 0.94) : 0.36));
    stepStage(state, { roll: true, rollTurn: aileron ? 0 : side }, ground, undefined, events);
    for (let i = 0; i < age; i++) stepStage(state, {}, ground);
    if (state.view === 'chase') state.rearGlimpse = { kind: 'flare', since: state.tick - 18, until: state.tick + 60 };
  }
}

// Lay a curved Ion Wake behind the fixture player for render review.
function primeIonWake(state: StageState): void {
  const { player: p } = state;
  state.ionWake.length = 0;
  for (let k = 36; k >= 0; k--) {
    const back = 18 + k * 14, curve = (k * 14) ** 2 * 0.0006;
    state.ionWake.push({
      x: p.x - Math.sin(p.yaw) * back + Math.cos(p.yaw) * curve,
      z: p.z - Math.cos(p.yaw) * back - Math.sin(p.yaw) * curve,
      alt: p.altitude - Math.min(12, k * 0.5),
      until: state.tick + 300 - k * 8,
    });
  }
}
