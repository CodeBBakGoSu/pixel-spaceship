import { ACE_PHASES } from './data/ace.ts';
import { ROSTER } from './data/roster.ts';
import { beginAceDefeat, makeAce, setAceTell } from './ace.ts';
import { CRUISE_SPEED } from './flight.ts';
import { LANDMARKS } from './reach.ts';
import { BANDS } from './stage-combat.ts';
import { makeEnemy } from './stage-enemies.ts';
import type { EnemyKind } from './enemy-kinds.ts';
import type { AcePhase, Band, Enemy, Ground, StageState } from './stage-types.ts';

function stageReviewFlight(state: StageState): void {
  Object.assign(state.player, {
    x: LANDMARKS.strait.x, z: LANDMARKS.strait.z, yaw: 0, altitude: BANDS[1], vx: 0, vz: CRUISE_SPEED,
  });
  state.speed = CRUISE_SPEED;
}

export function stageAceFixture(state: StageState, phase: AcePhase, cue: string | undefined, legacy: boolean): void {
  const p = state.player;
  if (!legacy) stageReviewFlight(state);
  const tail = cue === 'tail';
  const ace = state.boss = makeAce(state, p.x + (tail ? 8 : -16), p.z + (tail ? -57 : 92));
  ace.phase = phase;
  if (phase === 2) ace.hp = Math.round(ace.maxHp * 0.52);
  if (phase === 3) ace.hp = Math.round(ace.maxHp * 0.24);
  ace.yaw = tail ? p.yaw : -2.58;
  ace.bank = phase === 3 ? 1.04 : phase === 2 ? -0.73 : 0.48;
  ace.pitch = phase === 3 ? 0.14 : 0;
  ace.tail = tail;
  ace.boosting = ACE_PHASES[phase].afterburner;
  if (legacy) {
    ace.band = BANDS.length - 1;
    ace.alt = BANDS[ace.band];
  }
  if (cue === 'missile' || cue === 'roll' || cue === 'gun' || (!cue && !legacy)) {
    const kind = cue === 'missile' || cue === 'roll' || cue === 'gun' ? cue : phase === 1 ? 'gun' : phase === 2 ? 'missile' : 'roll';
    setAceTell(state, ace, kind, { x: p.x, z: p.z + 17, alt: ace.alt });
  }
  if (cue === 'rolling') {
    ace.roll = { kind: 'barrel', side: 1, elapsed: 17, altitude: ace.alt };
  }
  if (cue === 'down') {
    ace.hp = 0;
    beginAceDefeat(state, ace);
    ace.defeatedAt = state.tick - 24;
    ace.bank = 2.1;
    ace.pitch = -0.45;
  }
}

const roster: readonly (readonly [string, EnemyKind, Band, number, number])[] = [
  ['spotter', 'spotter', 1, -29, 105], ['flak', 'turret', 1, 25, 130],
  ['aegis', 'aegis', 1, 14, 80], ['hound', 'hound', 1, -8, -48],
  ['interceptor', 'interceptor', 1, 16, -70], ['diver', 'diver', 2, 52, 125],
  ['skimmer', 'skimmer', 0, -44, 83], ['bomber', 'bomber', 1, 54, 159],
  ['carrier', 'bomber', 2, -53, 155], ['flanker', 'flanker', 1, -63, 110],
  ['patrol', 'patrol', 1, 39, 88], ['harrier', 'harrier', 1, 38, -86],
  ['gnat', 'gnat', 1, 3, 115],
];

export function stageRosterFixture(state: StageState, ground: Ground, cue?: string): void {
  const p = state.player;
  stageReviewFlight(state);
  const selected = roster.find(([key]) => key === cue || key === 'flak' && cue === 'turret');
  const origin = { x: p.x, z: p.z + (selected ? 8 : 30), alt: p.altitude };
  const t = state.tick;
  const stage = ([key, kind, band, side, depth]: typeof roster[number]): void => {
    const x = p.x + (selected ? side * 0.35 : side), z = p.z + (selected && depth > 0 ? Math.min(depth, 100) : depth);
    const enemy = makeEnemy(state, x, z, band, kind);
    enemy.yaw = depth < 0 ? 0 : Math.PI + (key === 'aegis' ? 0.23 : 0);
    const warn = (kind: Exclude<NonNullable<Enemy['tell']>['kind'], 'snipe' | 'flak'>, ticks: number) => {
      enemy.tell = { kind, started: t - Math.floor(ticks / 3), until: t + Math.ceil(ticks * 2 / 3) };
    };
    switch (key) {
      case 'spotter':
        enemy.tell = { kind: 'snipe', started: t - 16, until: t + 32, target: origin };
        break;
      case 'flak':
        enemy.alt = ground(x, z) + 5;
        enemy.tell = { kind: 'flak', x: origin.x + 12, z: origin.z + 27, alt: origin.alt,
          started: t - 39, until: t + ROSTER.flak.warningTicks - 39 };
        break;
      case 'diver':
        enemy.maneuver = { phase: 'warning', band: 0, diveAt: t + 32 };
        break;
      case 'hound':
      case 'interceptor':
        warn('tail', ROSTER.hound.warningTicks);
        break;
      case 'gnat':
        warn('gnat', ROSTER.gnat.warningTicks);
        break;
      case 'aegis':
        warn('aegis', ROSTER.aegis.warningTicks);
        break;
      case 'carrier':
        enemy.carrier = 'first-evolution';
        warn('carrier', ROSTER.carrier.warningTicks);
        break;
      case 'bomber':
        warn('mine', ROSTER.bomber.warningTicks);
        break;
      case 'flanker':
      case 'harrier':
      case 'skimmer':
        warn('strafe', ROSTER.flanker.warningTicks);
        break;
      default:
        warn('gun', ROSTER.patrol.warningTicks);
        break;
    }
    state.enemies.push(enemy);
  };
  for (const setup of selected ? [selected] : roster) stage(setup);
  if (!selected || selected[0] === 'gnat') {
    for (const side of [-24, -12, 12, 24]) {
      const enemy = makeEnemy(state, p.x + side, p.z + 115 - Math.abs(side), 1, 'gnat');
      enemy.yaw = Math.PI;
      state.enemies.push(enemy);
    }
  }
}
