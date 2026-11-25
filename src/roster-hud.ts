import { ROSTER } from './data/roster.ts';
import type { MessageKey } from './i18n.ts';
import { activeAce } from './stage.ts';
import { FLAK_RADIUS } from './stage-combat.ts';
import type { EnemyTell, StageState } from './stage-types.ts';

const ACE_WARNINGS = {
  gun: 'hud.aceGun', missile: 'hud.aceMissile', roll: 'hud.aceRoll',
} as const satisfies Record<string, MessageKey>;

const ROSTER_WARNINGS: Record<EnemyTell['kind'], { key: MessageKey; priority: number } | null> = {
  flak: { key: 'hud.flakWarning', priority: 7 },
  snipe: { key: 'hud.spotterWarning', priority: 6 },
  mine: { key: 'hud.mineWarning', priority: 5 },
  strafe: { key: 'hud.rosterStrafe', priority: 4 },
  gun: { key: 'hud.rosterGun', priority: 3 },
  aegis: { key: 'hud.rosterAegis', priority: 2 },
  carrier: { key: 'hud.rosterCarrier', priority: 1 },
  gnat: { key: 'hud.rosterGnat', priority: 1 },
  charge: { key: 'hud.rosterCharge', priority: 5 },
  crossing: { key: 'hud.rosterCross', priority: 5 },
  pass: { key: 'hud.rosterPass', priority: 5 },
  repair: { key: 'hud.rosterRepair', priority: 2 },
  tail: null,
};

export function rosterThreatMessage(state: StageState, displayRange: number): MessageKey | null {
  if (state.phase !== 'playing' || state.paused) return null;
  const ace = activeAce(state);
  if (ace?.tell && state.tick < ace.tell.until) return ACE_WARNINGS[ace.tell.kind];
  if (ace?.roll) return 'hud.aceRoll';

  const p = state.player;
  let priority = 0, message: MessageKey | null = null;
  for (const enemy of state.enemies) {
    if (!enemy.hp || enemy.entry) continue;
    if (enemy.kind === 'diver' && enemy.maneuver?.phase === 'warning' && priority < 5
      && (p.x - enemy.x) ** 2 + (p.z - enemy.z) ** 2 <= ROSTER.diver.range ** 2) {
      priority = 5;
      message = 'hud.rosterDive';
    }
    const tell = enemy.tell;
    if (!tell || state.tick >= tell.until) continue;
    const warning = ROSTER_WARNINGS[tell.kind];
    if (!warning || warning.priority <= priority) continue;
    const source = tell.kind === 'flak' ? tell : enemy;
    const range = tell.kind === 'flak' ? ROSTER.flak.leadDistance + 2 * FLAK_RADIUS : displayRange;
    if ((p.x - source.x) ** 2 + (p.z - source.z) ** 2 > range ** 2) continue;
    priority = warning.priority;
    message = enemy.kind === 'skimmer' && tell.kind === 'strafe' ? 'hud.rosterSkim' : warning.key;
  }
  return message;
}
