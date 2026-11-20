import { ROLLS } from './data/roll.ts';
import { CRUISE_SPEED } from './flight.ts';
import type { CombatEvents } from './hostile-events.ts';
import { stepStage } from './stage.ts';
import { clamp } from './stage-combat.ts';
import type { Ground, StageState } from './stage-types.ts';

export function isFlightFixture(name: string | null): boolean {
  return name === 'hud' || name === 'bank' || name === 'roll';
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
  }
  if (fixture === 'bank') {
    const bank = Number(query.get('bank') ?? 1.5);
    p.bank = Number.isFinite(bank) ? clamp(bank, -1.5, 1.5) : 1.5;
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
