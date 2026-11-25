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

function crossingSlots(state: StageState, event: SwarmEvent, preferred: Band, sign: number, ground: Ground): Slot[] {
  const p = state.player, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  const speed = sign * tuning.crossingTravel / event.duration;
  const flight = { x: fz * speed, z: -fx * speed };
  const slots: Slot[] = [];
  for (let rank = 0; rank < tuning.crossingRanks; rank++) {
    for (let file = -tuning.crossingWing; file <= tuning.crossingWing; file++) {
      const side = -sign * (tuning.crossingTravel / 2 + (Math.abs(file) * 0.7 + rank * 1.5) * tuning.fileSpacing);
      const depth = tuning.crossingLead + file * tuning.fileSpacing;
      slots.push({ x: p.x + fx * depth + fz * side, z: p.z + fz * depth - fx * side, band: preferred, flight });
    }
  }
  // Lift the entire V together rather than losing half a wing to a ridge.
  const floor = Math.max(...slots.map(slot => ground(slot.x, slot.z))) + GNAT.clearance;
  const band = ([0, 1, 2] as const).find(band => band >= preferred && BANDS[band] >= floor);
  if (band === undefined) return [];
  for (const slot of slots) slot.band = band;
  return slots;
}

function launch(state: StageState, event: SwarmEvent, ground: Ground, observe?: SwarmObserver): void {
  const rng = rngStream(state.seed, `swarm-event:${event.start}`);
  const p = state.player, preferred = fixedBand(p.altitude);
  const open: Band = preferred === 0 ? 1 : preferred === 2 ? 1 : 0;
  const ring = event.kind === 'ring';
  const slots = ring ? ringSlots(state, event, open, ground)
    : crossingSlots(state, event, preferred, random(rng) < 0.5 ? -1 : 1, ground);
  const live = state.enemies.filter(enemy => enemy.kind === 'gnat' && enemy.hp > 0);
  const requested = Math.min(state.swarmCap, slots.length);
  // Reserve event slots without awarding kills or touching regular contacts/carriers.
  const distance = (enemy: Point) => (enemy.x - p.x) ** 2 + (enemy.z - p.z) ** 2;
  live.sort((a, b) => Number(ring && b.band === open) - Number(ring && a.band === open)
    || distance(b) - distance(a) || b.id - a.id);
  const retire = new Set(live.filter((enemy, i) => i < live.length + requested - state.swarmCap || ring && enemy.band === open));
  if (retire.size) state.enemies = state.enemies.filter(enemy => !retire.has(enemy));
  const phase = phaseAt(event.start), until = (event.start + event.duration) * TICKS_PER_SECOND;
  for (const { x, z, band, flight } of slots.slice(0, requested)) {
    const enemy = makeGnat(state, x, z, band, gnatVariantAt(phase, random(rng)));
    enemy.eventFlight = flight;
    enemy.leaveAt = until;
    state.enemies.push(enemy);
  }
  state.swarmNotice = { kind: event.kind, band: ring ? open : slots[0]?.band ?? preferred, until };
  observe?.(live.length - retire.size + requested, state.swarmCap, slots.length > state.swarmCap - live.length);
}

/** A scheduled formation takes the place of the ordinary director. */
export function advanceSwarmEvent(state: StageState, ground: Ground, observe?: SwarmObserver): boolean {
  if (state.swarmNotice && state.tick >= state.swarmNotice.until) delete state.swarmNotice;
  const event = swarmWindowAt(state.tick / TICKS_PER_SECOND);
  if (!event) return false;
  if (state.suppressedSwarmEvents?.includes(event.start)) return true;
  if (state.tick === event.start * TICKS_PER_SECOND) launch(state, event, ground, observe);
  if (state.tick === (event.start + event.duration) * TICKS_PER_SECOND) {
    if (!state.run) {
      for (const pickup of state.pickups) {
        if (state.tick - pickup.born >= 60 * TICKS_PER_SECOND) continue;
        pickup.recovery = { until: state.tick + tuning.magnetTicks, sourceAlt: pickup.alt };
        pickup.pulling = true;
      }
    }
    state.swarmNotice = { kind: 'recovery', until: state.tick + tuning.recoverySeconds * TICKS_PER_SECOND };
  }
  return true;
}

export function suppressSwarmEvent(state: StageState): void {
  const event = swarmWindowAt(state.tick / TICKS_PER_SECOND);
  if (!event || state.tick < event.start * TICKS_PER_SECOND) return;
  state.suppressedSwarmEvents ??= [];
  if (!state.suppressedSwarmEvents.includes(event.start)) state.suppressedSwarmEvents.push(event.start);
  if (state.swarmNotice && state.swarmNotice.kind !== 'recovery') delete state.swarmNotice;
}
