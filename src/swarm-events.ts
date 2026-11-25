import { BANDS, fixedBand } from './bands.ts';
import { GNAT, gnatVariantAt, phaseAt, SWARM_EVENT as tuning, swarmWindowAt, type SwarmEvent } from './data/phases.ts';
import { TICKS_PER_SECOND } from './stage-combat.ts';
import { makeGnat } from './stage-enemies.ts';
import { random, rngStream } from './stage-random.ts';
import type { Band, Ground, Point, StageState } from './stage-types.ts';
import type { SwarmObserver } from './swarm.ts';

type Slot = Point & { band: Band; flight: Point };

function ringSlots(state: StageState, event: SwarmEvent, open: Band, ground: Ground): Slot[] {
  const slots: Slot[] = [], p = state.player;
  const bands = ([0, 1, 2] as const).filter(band => band !== open);
  const speed = (tuning.ringExitRadius - tuning.ringRadius) / event.duration;
  for (let i = 0; i < tuning.ringSize; i++) {
    const angle = p.yaw + 2 * Math.PI * i / tuning.ringSize;
    const dx = Math.sin(angle), dz = Math.cos(angle), band = bands[i % bands.length];
    const x = p.x + dx * tuning.ringRadius, z = p.z + dz * tuning.ringRadius;
    if (ground(x, z) + GNAT.clearance <= BANDS[band]) slots.push({ x, z, band, flight: { x: dx * speed, z: dz * speed } });
  }
  return slots;
}

function launch(state: StageState, event: SwarmEvent, ground: Ground, observe?: SwarmObserver): void {
  const rng = rngStream(state.seed, `swarm-event:${event.start}`);
  const p = state.player, preferred = fixedBand(p.altitude);
  const open: Band = preferred === 0 ? 1 : preferred === 2 ? 1 : 0;
  const slots = ringSlots(state, event, open, ground);
  const live = state.enemies.filter(enemy => enemy.kind === 'gnat' && enemy.hp > 0);
  const requested = Math.min(state.swarmCap, slots.length);
  // Reserve event slots without awarding kills or touching regular contacts/carriers.
  const distance = (enemy: Point) => (enemy.x - p.x) ** 2 + (enemy.z - p.z) ** 2;
  live.sort((a, b) => Number(b.band === open) - Number(a.band === open)
    || distance(b) - distance(a) || b.id - a.id);
  const retire = new Set(live.filter((enemy, i) => i < live.length + requested - state.swarmCap || enemy.band === open));
  if (retire.size) state.enemies = state.enemies.filter(enemy => !retire.has(enemy));
  const phase = phaseAt(event.start), until = (event.start + event.duration) * TICKS_PER_SECOND;
  for (const { x, z, band, flight } of slots.slice(0, requested)) {
    const enemy = makeGnat(state, x, z, band, gnatVariantAt(phase, random(rng)));
    enemy.eventFlight = flight;
    enemy.leaveAt = until;
    state.enemies.push(enemy);
  }
  state.swarmNotice = { kind: 'ring', band: open, until };
  observe?.(live.length - retire.size + requested, state.swarmCap, slots.length > state.swarmCap - live.length);
}

/** A scheduled formation takes the place of the ordinary director. */
export function advanceSwarmEvent(state: StageState, ground: Ground, observe?: SwarmObserver): boolean {
  if (state.swarmNotice && state.tick >= state.swarmNotice.until) delete state.swarmNotice;
  const event = swarmWindowAt(state.tick / TICKS_PER_SECOND);
  if (!event) return false;
  if (state.suppressedSwarmEvents?.includes(event.start)) return false;
  if (state.tick === event.start * TICKS_PER_SECOND) launch(state, event, ground, observe);
  if (state.tick === (event.start + event.duration) * TICKS_PER_SECOND) {
    if (!state.run) {
      for (const pickup of state.pickups) {
        if (state.tick - pickup.born >= 60 * TICKS_PER_SECOND) continue;
        pickup.recovery = { until: state.tick + tuning.legacyMagnetTicks, sourceAlt: pickup.alt };
        pickup.pulling = true;
      }
    }
    state.swarmNotice = { kind: state.run ? 'rest' : 'recovery', until: state.tick + tuning.restSeconds * TICKS_PER_SECOND };
  }
  return true;
}

export function suppressSwarmEvent(state: StageState): void {
  const event = swarmWindowAt(state.tick / TICKS_PER_SECOND);
  if (!event || state.tick < event.start * TICKS_PER_SECOND) return;
  state.suppressedSwarmEvents ??= [];
  if (!state.suppressedSwarmEvents.includes(event.start)) state.suppressedSwarmEvents.push(event.start);
  if (state.swarmNotice) delete state.swarmNotice;
}
