import type { WeaponId } from './data/items.ts';
import { BANDS } from './bands.ts';
import type { Position, Shot, StageState, WeaponFx } from './stage-types.ts';

export const SORTIE_VFX_IDS = [
  'W01-F', 'W01-H', 'W02-F', 'W02-H', 'W03-F', 'W03-H', 'W04-F', 'W04-H', 'W05-F', 'W05-H',
  'W06-F', 'W06-H', 'W07-F', 'W07-H', 'W08-F', 'W08-H', 'W09-F', 'W09-H', 'W10-F', 'W10-H',
  'D01', 'D02', 'D03', 'D04',
] as const;
export type SortieVfxId = typeof SORTIE_VFX_IDS[number];
export type VfxRoute = 'fire' | 'hit';

const WEAPON_IDS: Record<WeaponId, readonly [SortieVfxId, SortieVfxId]> = {
  twin: ['W01-F', 'W01-H'], pods: ['W02-F', 'W02-H'], seeker: ['W03-F', 'W03-H'],
  rail: ['W04-F', 'W04-H'], flak: ['W05-F', 'W05-H'], ion: ['W06-F', 'W06-H'],
  drones: ['W07-F', 'W07-H'], phoenix: ['W08-F', 'W08-H'],
  'bomb-bay': ['W09-F', 'W09-H'], arc: ['W10-F', 'W10-H'],
};

const COLORS: Record<WeaponId, string> = {
  twin: '#ffc36c', pods: '#91e9ef', seeker: '#f0e4cd', rail: '#9edbff', flak: '#ff965b',
  ion: '#71e0cc', drones: '#b8bed3', phoenix: '#ffd080', 'bomb-bay': '#c98465', arc: '#9ebaff',
};

const DURATIONS: Record<SortieVfxId, number> = {
  'W01-F': 0.3, 'W01-H': 0.48, 'W02-F': 0.34, 'W02-H': 0.46, 'W03-F': 1.4, 'W03-H': 0.68,
  'W04-F': 1, 'W04-H': 0.57, 'W05-F': 1.05, 'W05-H': 0.56, 'W06-F': 1.1, 'W06-H': 0.8,
  'W07-F': 1.05, 'W07-H': 0.84, 'W08-F': 1.05, 'W08-H': 1, 'W09-F': 1.05, 'W09-H': 1,
  'W10-F': 1.5, 'W10-H': 0.84, D01: 1.02, D02: 1.02, D03: 1.4, D04: 1.55,
};

const MAX_CUES = 80;
const MAX_SEEN_KEYS = 256;
const MAX_PENDING_FORMATIONS = 16;
const FORMATION_WINDOW_SECONDS = 0.12;
const MAX_PROJECTILE_TRAILS = 56;
const MAX_WAKE_SEGMENTS = 24;

type Cue = {
  active: boolean;
  effect: SortieVfxId;
  born: number;
  until: number;
  duration: number;
  priority: number;
  seed: number;
  position: Position;
  source: Position;
  target: Position;
  hasSource: boolean;
  hasTarget: boolean;
  positions: Position[];
};

type ScreenPoint = { x: number; y: number };
export type SortieProjection = (point: Position) => ScreenPoint | null;
export type SortieSegmentProjection = (from: Position, to: Position) => {
  from: { x: number; y: number };
  to: { x: number; y: number };
} | null;
export type SortieVfxMode = 'flight' | 'defeat';
export function sortieVfxMode(state: Pick<StageState, 'phase' | 'paused' | 'boss'>, blocked = false): SortieVfxMode | null {
  if (blocked) return null;
  if (state.phase === 'playing') return state.paused ? null : 'flight';
  if (state.phase === 'title' || state.phase === 'draft' || state.phase === 'chest') return null;
  return state.boss?.defeatedAt != null ? 'defeat' : null;
}
export type PickupVisualEvent =
  | { type: 'pickupDropped' | 'pickupContacted'; pickupId: number; kind: 'salvage' | 'magnet'; position: Position; tick: number; sourceEventId?: number }
  | { type: 'pickupCollected'; pickupId: number; kind: 'salvage' | 'magnet'; position: Position; tick: number; sourceEventId?: number; xp: number; credits: number; playerPosition: Position };

export function weaponVfxId(weapon: WeaponId, route: VfxRoute): SortieVfxId {
  return WEAPON_IDS[weapon][route === 'fire' ? 0 : 1];
}

export function defeatVfxId({ armored = false, formation = false, boss = false }: {
  armored?: boolean; formation?: boolean; boss?: boolean;
}): SortieVfxId {
  return boss ? 'D04' : formation ? 'D03' : armored ? 'D02' : 'D01';
}

function point(x = 0, z = 0, alt = 0): Position { return { x, z, alt }; }
function copyPoint(into: Position, from: Position): void { into.x = from.x; into.z = from.z; into.alt = from.alt; }
function copyPosition(from: Position): Position { return point(from.x, from.z, from.alt); }
function createCue(): Cue {
  return { active: false, effect: 'W01-F', born: 0, until: 0, duration: 1, priority: 0, seed: 0,
    position: point(), source: point(), target: point(), hasSource: false, hasTarget: false, positions: [] };
}
function shotWeapon(shot: Shot): WeaponId | null {
  if (shot.kind === 'twin' || shot.kind === 'strafe') return 'twin';
  if (shot.kind === 'pods') return 'pods';
  if (shot.kind === 'seeker') return 'seeker';
  if (shot.kind === 'flak-shell') return 'flak';
  if (shot.kind === 'drone-bolt') return 'drones';
  return null;
}
function vfxWeapon(fx: WeaponFx): WeaponId | null {
  if (fx.kind === 'rail-beam') return 'rail';
  if (fx.kind === 'arc-link') return 'arc';
  return null;
}
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function noise(seed: number, index: number): number {
  const value = Math.sin((seed + index * 78.233) * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function maskCircle(ctx: CanvasRenderingContext2D, center: ScreenPoint, radius: number): void {
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function maskCorridor(ctx: CanvasRenderingContext2D, from: ScreenPoint, to: ScreenPoint, radius: number): void {
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
  if (length < 1) {
    maskCircle(ctx, from, radius);
    return;
  }
  const nx = -dy / length * radius, ny = dx / length * radius;
  ctx.beginPath();
  ctx.moveTo(from.x + nx, from.y + ny);
  ctx.lineTo(to.x + nx, to.y + ny);
  ctx.lineTo(to.x - nx, to.y - ny);
  ctx.lineTo(from.x - nx, from.y - ny);
  ctx.closePath();
  ctx.fill();
  maskCircle(ctx, from, radius);
  maskCircle(ctx, to, radius);
}

function maskHazards(ctx: CanvasRenderingContext2D, state: StageState, project: SortieProjection,
  bossArea: { x: number; y: number; radius: number } | null, unit: number, projectSegment?: SortieSegmentProjection): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  for (const shot of state.shots) {
    if (shot.kind !== 'hostile') continue;
    const screen = project(shot);
    if (screen) maskCircle(ctx, screen, 8 * unit);
  }
  for (const enemy of state.enemies) {
    if (enemy.maneuver?.phase !== 'warning') continue;
    const from = { x: enemy.x, z: enemy.z, alt: enemy.alt };
    const target = { x: enemy.x, z: enemy.z, alt: BANDS[enemy.maneuver.band] };
    if (projectSegment) {
      const segment = projectSegment(from, target);
      if (segment) maskCorridor(ctx, segment.from, segment.to, 12 * unit);
    } else {
      const start = project(from), end = project(target);
      if (start && end) maskCorridor(ctx, start, end, 12 * unit);
    }
  }
  if (bossArea) maskCircle(ctx, bossArea, bossArea.radius + 12 * unit);
  ctx.restore();
}

export class SortieVfx {
  private readonly ticksPerSecond: number;
  private readonly cues = Array.from({ length: MAX_CUES }, createCue);
  private readonly seenKeys = new Map<string, number>();
  private seenShots = new WeakSet<object>();
  private seenWeaponFx = new WeakSet<object>();
  private seenFlares = new WeakSet<object>();
  private seenBombs = new WeakSet<object>();
  private formations = new Map<number, { born: number; members: { id: number; tick: number; position: Position; armored: boolean }[] }>();
  private sequence = 0;
  private lastTick = -1;
  private pickupActivityUntil = -1;
  private visualLoad = 0;
  private _dropped = 0;
  private terminalClock: { tick: number; now: number } | null = null;

  constructor(ticksPerSecond: number) {
    this.ticksPerSecond = ticksPerSecond;
    if (!Number.isFinite(ticksPerSecond) || ticksPerSecond <= 0) throw new RangeError('ticksPerSecond must be positive');
  }

  get activeCount(): number { return this.cues.reduce((count, cue) => count + Number(cue.active), 0); }
  get droppedCount(): number { return this._dropped; }

  fire(weapon: WeaponId, event: { tick: number; position: Position; source?: Position; target?: Position; eventId?: number | string }): void {
    this.addCue(weaponVfxId(weapon, 'fire'), event.tick, event.position, event.source, event.target, [], 1,
      event.eventId === undefined ? undefined : 'fire:' + weapon + ':' + event.eventId);
  }

  hit(weapon: WeaponId, event: { tick: number; position: Position; source?: Position; targetId?: number; eventId?: number | string }): void {
    this.addCue(weaponVfxId(weapon, 'hit'), event.tick, event.position, event.source, undefined, [], 2,
      event.eventId === undefined ? undefined : 'hit:' + weapon + ':' + event.eventId);
  }

  enemyDefeated(event: { id: number; tick: number; position: Position; armored?: boolean; formationId?: number }): void {
    const key = 'enemy:' + event.id + ':' + event.tick;
    if (!this.claim(key, event.tick)) return;
    const member = { id: event.id, tick: event.tick, position: copyPosition(event.position), armored: !!event.armored };
    if (event.formationId === undefined) {
      this.addCue(defeatVfxId({ armored: member.armored }), event.tick, member.position, undefined, undefined, [], 2);
      return;
    }
    let group = this.formations.get(event.formationId);
    if (!group) {
      if (this.formations.size >= MAX_PENDING_FORMATIONS) {
        const oldest = [...this.formations.entries()].sort((a, b) => a[1].born - b[1].born)[0];
        if (oldest) this.flushFormation(oldest[0], event.tick);
      }
      group = { born: event.tick, members: [] };
      this.formations.set(event.formationId, group);
    }
    group.members.push(member);
    if (group.members.length >= 3) {
      const members = group.members.splice(0, 3);
      this.addCue('D03', event.tick, members[0].position, undefined, undefined, members.map(item => item.position), 2);
      if (group.members.length === 0) this.formations.delete(event.formationId);
    }
  }

  bossDefeated(event: { id: number; tick: number; position: Position; eventId?: number | string }): void {
    const key = 'boss:' + (event.eventId ?? event.id + ':' + event.tick);
    if (!this.claim(key, event.tick)) return;
    this.addCue('D04', event.tick, event.position, undefined, undefined, [], 3);
  }

  pickupEvent(event: PickupVisualEvent): void {
    const key = event.type + ':' + event.pickupId;
    if (!this.claim(key, event.tick)) return;
    this.pickupActivityUntil = Math.max(this.pickupActivityUntil, event.tick + Math.round(this.ticksPerSecond * 0.4));
  }

  pickupTrailCapacity(tick: number): number | undefined {
    if (this.visualLoad >= 24) return 0;
    if (this.visualLoad >= 14 || tick <= this.pickupActivityUntil) return 12;
    if (this.visualLoad >= 8) return 28;
    return undefined;
  }

  observeState(state: StageState): void {
    if (state.tick < this.lastTick) this.clear();
    this.lastTick = state.tick;
    for (const shot of state.shots) {
      if (shot.kind === 'hostile' || this.seenShots.has(shot)) continue;
      this.seenShots.add(shot);
      const weapon = shotWeapon(shot);
      if (!weapon) continue;
      const position = point(shot.x, shot.z, shot.alt);
      const born = 'born' in shot && typeof shot.born === 'number' ? shot.born : state.tick;
      this.fire(weapon, { tick: born, position, source: position, eventId: 'shot:' + this.sequence++ });
    }
    for (const fx of state.weaponFx) {
      if (this.seenWeaponFx.has(fx)) continue;
      this.seenWeaponFx.add(fx);
      const weapon = vfxWeapon(fx);
      if (!weapon) continue;
      const position = fx.to ?? fx.from;
      this.fire(weapon, { tick: state.tick, position, source: fx.from, target: fx.to, eventId: 'fx:' + this.sequence++ });
    }
    for (const flare of state.flares) {
      if (this.seenFlares.has(flare)) continue;
      this.seenFlares.add(flare);
      this.fire('phoenix', { tick: flare.born, position: flare, source: flare, eventId: 'flare:' + this.sequence++ });
    }
    for (const bomb of state.rearBombs) {
      if (this.seenBombs.has(bomb)) continue;
      this.seenBombs.add(bomb);
      this.fire('bomb-bay', { tick: bomb.born, position: bomb, source: bomb, eventId: 'bomb:' + this.sequence++ });
    }
    this.flushExpiredFormations(state.tick);
    this.visualLoad = this.activeCount + Math.ceil(state.shots.length / 5) + state.weaponFx.length
      + Math.ceil(state.effects.length / 2) + Math.ceil(state.pickups.length / 4);
    this.pruneKeys(state.tick);
  }

  draw(ctx: CanvasRenderingContext2D, state: StageState, project: SortieProjection,
    groundAt: (x: number, z: number) => number, bossArea: { x: number; y: number; radius: number } | null,
    reducedMotion = false, mode: SortieVfxMode = 'flight', nowMs = 0,
    projectSegment?: SortieSegmentProjection): void {
    let renderTick = state.tick;
    if (mode === 'defeat') {
      if (state.boss?.defeatedAt === null || state.boss?.defeatedAt === undefined) {
        this.clear();
        return;
      }
      if (!this.terminalClock) {
        this.terminalClock = { tick: state.tick, now: nowMs };
        for (const cue of this.cues) if (cue.effect !== 'D04') cue.active = false;
        this.formations.clear();
      }
      renderTick = Math.max(state.tick, this.terminalClock.tick
        + Math.floor(Math.max(0, nowMs - this.terminalClock.now) * this.ticksPerSecond / 1000));
    } else {
      this.terminalClock = null;
      this.observeState(state);
    }
    const density = this.visualLoad >= 20 ? 0.36 : this.visualLoad >= 12 ? 0.58 : this.visualLoad >= 7 ? 0.78 : 1;
    const unit = clamp(Math.min(ctx.canvas.width / 640, ctx.canvas.height / 360), 0.55, 1.15);
    for (const cue of this.cues) {
      if (!cue.active) continue;
      if (mode === 'defeat' && cue.effect !== 'D04') continue;
      if (renderTick >= cue.until) { cue.active = false; continue; }
      const hasLineSegment = cue.effect === 'W04-F' || cue.effect === 'W10-F';
      const segment = hasLineSegment && cue.hasSource && cue.hasTarget
        ? projectSegment?.(cue.source, cue.target) ?? null
        : null;
      const projectedOrigin = project(cue.position);
      if (!projectedOrigin && !segment) continue;
      const origin = projectedOrigin ?? segment!.from;
      const progress = clamp((renderTick - cue.born) / cue.duration, 0, 1);
      const source = segment?.from ?? (cue.hasSource ? project(cue.source) : null);
      const target = segment?.to ?? (cue.hasTarget ? project(cue.target) ?? origin : origin);
      const protectedBoss = bossArea && cue.effect !== 'D04'
        && Math.hypot(origin.x - bossArea.x, origin.y - bossArea.y) < bossArea.radius + 12 * unit;
      const detail = reducedMotion ? 0.25 : protectedBoss ? density * 0.38 : density;
      drawCue(ctx, cue, origin, source, target, progress, unit, detail, protectedBoss ? 12 * unit : Infinity,
        reducedMotion, project);
    }
    if (mode === 'flight') {
      if (!reducedMotion) {
        this.drawProjectileTrails(ctx, state, project, unit, density);
        this.drawIonWake(ctx, state, project, unit, density);
        this.drawOrbitRibbons(ctx, state, project, unit, density);
        this.drawFlares(ctx, state, project, groundAt, unit, density);
        this.drawBombShadows(ctx, state, project, groundAt, unit, density);
      }
    }
    maskHazards(ctx, state, project, bossArea, unit, projectSegment);
    ctx.globalAlpha = 1;
  }

  clear(): void {
    for (const cue of this.cues) cue.active = false;
    this.seenKeys.clear();
    this.seenShots = new WeakSet();
    this.seenWeaponFx = new WeakSet();
    this.seenFlares = new WeakSet();
    this.seenBombs = new WeakSet();
    this.formations.clear();
    this.sequence = 0;
    this.lastTick = -1;
    this.pickupActivityUntil = -1;
    this.visualLoad = 0;
    this._dropped = 0;
    this.terminalClock = null;
  }

  private addCue(effect: SortieVfxId, tick: number, position: Position, source?: Position, target?: Position,
    positions: readonly Position[] = [], priority = 1, key?: string): void {
    if (key && !this.claim(key, tick)) return;
    let cue = this.cues.find(item => !item.active || item.until <= tick);
    if (!cue) {
      cue = this.cues.reduce((weakest, item) => item.priority < weakest.priority
        || (item.priority === weakest.priority && item.born < weakest.born) ? item : weakest);
      if (cue.priority > priority) { this._dropped++; return; }
      this._dropped++;
    }
    const live = this.activeCount;
    const compression = live >= 18 ? 0.58 : live >= 10 ? 0.78 : 1;
    cue.active = true;
    cue.effect = effect;
    cue.born = tick;
    cue.duration = Math.max(1, Math.round(this.ticksPerSecond * DURATIONS[effect] * compression));
    cue.until = tick + cue.duration;
    cue.priority = priority;
    cue.seed = (tick * 131 + this.sequence++ * 17 + effect.charCodeAt(1) * 7) >>> 0;
    copyPoint(cue.position, position);
    cue.hasSource = source !== undefined;
    cue.hasTarget = target !== undefined;
    if (source) copyPoint(cue.source, source);
    if (target) copyPoint(cue.target, target);
    cue.positions.length = Math.min(3, positions.length);
    for (let i = 0; i < cue.positions.length; i++) {
      if (!cue.positions[i]) cue.positions[i] = point();
      copyPoint(cue.positions[i], positions[i]);
    }
  }

  private claim(key: string, tick: number): boolean {
    if (this.seenKeys.has(key)) return false;
    this.seenKeys.set(key, tick + Math.round(this.ticksPerSecond * 2));
    if (this.seenKeys.size > MAX_SEEN_KEYS) this.seenKeys.delete(this.seenKeys.keys().next().value!);
    return true;
  }

  private pruneKeys(tick: number): void {
    for (const [key, until] of this.seenKeys) if (tick > until) this.seenKeys.delete(key);
  }

  private flushExpiredFormations(tick: number): void {
    const window = Math.max(1, Math.round(this.ticksPerSecond * FORMATION_WINDOW_SECONDS));
    for (const [id, group] of this.formations) if (tick - group.born >= window) this.flushFormation(id, tick);
  }

  private flushFormation(id: number, tick: number): void {
    const group = this.formations.get(id);
    if (!group) return;
    for (const member of group.members) {
      this.addCue(defeatVfxId({ armored: member.armored }), member.tick, member.position, undefined, undefined, [], 2);
    }
    this.formations.delete(id);
    this.lastTick = Math.max(this.lastTick, tick);
  }

  private drawProjectileTrails(ctx: CanvasRenderingContext2D, state: StageState, project: SortieProjection,
    unit: number, density: number): void {
    let drawn = 0;
    for (const shot of state.shots) {
      const weapon = shotWeapon(shot);
      if (!weapon || drawn >= Math.max(8, Math.round(MAX_PROJECTILE_TRAILS * density))) continue;
      const current = project(shot);
      const vy = 'vy' in shot && typeof shot.vy === 'number' ? shot.vy : 0;
      const tail = project(point(shot.x - shot.vx * 0.12, shot.z - shot.vz * 0.12, shot.alt - vy * 0.12));
      if (!current || !tail) continue;
      const color = COLORS[weapon];
      line(ctx, tail.x, tail.y, current.x, current.y, color, Math.max(1, 2.4 * unit), 0.78);
      drawn++;
    }
  }

  private drawIonWake(ctx: CanvasRenderingContext2D, state: StageState, project: SortieProjection, unit: number, density: number): void {
    const wake = state.ionWake;
    const start = Math.max(1, wake.length - Math.round(MAX_WAKE_SEGMENTS * density));
    const previousByLane = new Map<number, StageState['ionWake'][number]>();
    for (let i = 0; i < wake.length; i++) {
      const b = wake[i], lane = b.lane ?? 0, a = previousByLane.get(lane);
      if (i >= start && a && b.until >= state.tick) {
        const from = project(a), to = project(b);
        if (from && to) line(ctx, from.x, from.y, to.x, to.y, i % 2 ? '#71e0cc' : '#d4fff5', 2 * unit,
          clamp((b.until - state.tick) / 36, 0.12, 0.66));
      }
      previousByLane.set(lane, b);
    }
  }

  private drawOrbitRibbons(ctx: CanvasRenderingContext2D, state: StageState, project: SortieProjection, unit: number, density: number): void {
    const center = project(point(state.player.x, state.player.z, state.player.altitude));
    if (!center) return;
    const max = Math.min(state.orbitDrones.length, Math.max(1, Math.ceil(state.orbitDrones.length * density)));
    for (let i = 0; i < max; i++) {
      const drone = state.orbitDrones[i], tip = project(drone);
      if (!tip) continue;
      const radius = Math.max(4 * unit, Math.hypot(tip.x - center.x, tip.y - center.y));
      const angle = Math.atan2(tip.y - center.y, tip.x - center.x);
      ctx.beginPath(); ctx.arc(center.x, center.y, radius, angle - 0.9, angle - 0.04);
      ctx.strokeStyle = i % 2 ? '#c8d4ff' : '#71d9ff'; ctx.lineWidth = 2 * unit; ctx.globalAlpha = 0.55 * density; ctx.stroke();
      box(ctx, tip.x - 2 * unit, tip.y - 2 * unit, 4 * unit, 4 * unit, '#b8bed3', 0.9);
    }
  }

  private drawFlares(ctx: CanvasRenderingContext2D, state: StageState, project: SortieProjection,
    _groundAt: (x: number, z: number) => number, unit: number, density: number): void {
    const max = Math.min(state.flares.length, Math.max(1, Math.ceil(state.flares.length * density)));
    for (let i = 0; i < max; i++) {
      const flare = state.flares[i], head = project(flare);
      const tail = project(point(flare.x - flare.vx * 0.16, flare.z - flare.vz * 0.16, flare.alt - flare.vy * 0.16));
      if (!head || !tail) continue;
      line(ctx, tail.x, tail.y, head.x, head.y, '#ffb14e', 4 * unit, 0.64);
      line(ctx, tail.x, tail.y, head.x, head.y, '#fff1bd', 1.2 * unit, 0.92);
    }
  }

  private drawBombShadows(ctx: CanvasRenderingContext2D, state: StageState, project: SortieProjection,
    groundAt: (x: number, z: number) => number, unit: number, density: number): void {
    const max = Math.min(state.rearBombs.length, Math.max(1, Math.ceil(state.rearBombs.length * density)));
    for (let i = 0; i < max; i++) {
      const bomb = state.rearBombs[i], shadow = project(point(bomb.x, bomb.z, groundAt(bomb.x, bomb.z)));
      if (!shadow) continue;
      ctx.beginPath(); ctx.ellipse(shadow.x, shadow.y, 5 * unit, 2.8 * unit, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#b4d5ed'; ctx.lineWidth = 1.5 * unit; ctx.globalAlpha = 0.72; ctx.stroke();
      const head = project(bomb);
      if (head) line(ctx, head.x, head.y, shadow.x, shadow.y, '#c2d7e3', 1.2 * unit, 0.3);
    }
  }
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number,
  color: string, width: number, alpha = 1): void {
  ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(Math.round(x1), Math.round(y1)); ctx.lineTo(Math.round(x2), Math.round(y2)); ctx.stroke();
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string, alpha = 1): void {
  ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string,
  width: number, alpha = 1): void {
  ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.arc(x, y, Math.max(1, radius), 0, Math.PI * 2); ctx.stroke();
}

function sparks(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, progress: number,
  seed: number, count: number, radius: number, unit: number, detail: number): void {
  const n = Math.max(1, Math.ceil(count * detail));
  const spread = radius * (0.2 + progress * 0.8) * unit;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 + noise(seed, i) * 0.6;
    const r = spread * (0.45 + noise(seed + 5, i) * 0.75);
    line(ctx, x + Math.cos(angle) * r * 0.3, y + Math.sin(angle) * r * 0.3,
      x + Math.cos(angle) * r, y + Math.sin(angle) * r, i % 2 ? color : '#fff0bc', 1.4 * unit, 1 - progress * 0.68);
  }
}

function shard(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, progress: number,
  angle: number, radius: number, size: number, unit: number, alpha: number): void {
  const travel = radius * (1 - (1 - progress) * (1 - progress)) * unit;
  const cx = x + Math.cos(angle) * travel, cy = y + Math.sin(angle) * travel + progress * progress * 10 * unit;
  const dx = Math.cos(angle + progress * 1.8) * size * unit, dy = Math.sin(angle + progress * 1.8) * size * 0.55 * unit;
  ctx.globalAlpha = alpha * (1 - progress); ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(cx - dx, cy - dy); ctx.lineTo(cx + dx, cy); ctx.lineTo(cx - dx * 0.3, cy + dy); ctx.closePath(); ctx.fill();
}

function drawCue(ctx: CanvasRenderingContext2D, cue: Cue, origin: ScreenPoint, source: ScreenPoint | null,
  target: ScreenPoint, progress: number, unit: number, detail: number, protectedRadius: number, reducedMotion: boolean,
  project: SortieProjection): void {
  const color = cue.effect.startsWith('D') ? '#ffc36c' : COLORS[weaponForEffect(cue.effect)];
  const start = source ?? origin, dx = target.x - start.x, dy = target.y - start.y;
  const length = Math.max(1, Math.hypot(dx, dy)), nx = -dy / length, ny = dx / length;
  const pulse = 1 - progress;
  const radiusCap = Math.min(1, protectedRadius / Math.max(1, 54 * unit));
  ctx.save();
  if (reducedMotion) {
    circle(ctx, origin.x, origin.y, 4 * unit, color, 2 * unit, 0.66);
    ctx.restore(); return;
  }
  switch (cue.effect) {
    case 'W01-F':
      circle(ctx, origin.x, origin.y, 3 * pulse * unit + 1, '#ffd788', 1.5 * unit, pulse);
      break;
    case 'W01-H':
      sparks(ctx, origin.x, origin.y, color, progress, cue.seed, 7, 13 * radiusCap, unit, detail);
      break;
    case 'W02-F':
      line(ctx, origin.x - 4 * unit, origin.y + 3 * unit, origin.x + 4 * unit, origin.y - 3 * unit, color, 2 * unit, 0.82);
      break;
    case 'W02-H':
      line(ctx, origin.x - 8 * unit, origin.y + 9 * unit, origin.x + 6 * unit, origin.y - 8 * unit, '#d7fcff', 2 * unit, pulse);
      line(ctx, origin.x + 1 * unit, origin.y + 11 * unit, origin.x + 12 * unit, origin.y - 4 * unit, color, 1.4 * unit, pulse * 0.8);
      break;
    case 'W03-F':
      circle(ctx, origin.x, origin.y, (2 + 3 * pulse) * unit, '#f0e4cd', 1.4 * unit, pulse);
      circle(ctx, origin.x, origin.y, (4 + 3 * progress) * unit, color, 1 * unit, 0.45 * pulse);
      break;
    case 'W03-H':
      for (let j = 0; j < 3; j++) if (progress >= j / 4) {
        const offset = (j - 1) * 6 * unit;
        sparks(ctx, origin.x + offset, origin.y + (j % 2) * 4 * unit, color, clamp((progress - j / 4) * 1.5, 0, 1), cue.seed + j, 5, 10, unit, detail);
      }
      break;
    case 'W04-F':
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2, r = (1 - progress) * 19 * unit + 4 * unit;
        line(ctx, start.x + Math.cos(a) * r, start.y + Math.sin(a) * r, start.x + Math.cos(a) * 3 * unit,
          start.y + Math.sin(a) * 3 * unit, color, 1.3 * unit, 0.7);
      }
      line(ctx, start.x, start.y, target.x, target.y, '#336985', 6 * unit, 0.25 * pulse);
      line(ctx, start.x, start.y, target.x, target.y, color, 1.6 * unit, 0.82 * pulse);
      break;
    case 'W04-H':
      line(ctx, origin.x - 8 * unit, origin.y - 6 * unit, origin.x + 4 * unit, origin.y + 8 * unit,
        '#d7fcff', 2.4 * unit, pulse);
      line(ctx, origin.x - 4 * unit, origin.y - 8 * unit, origin.x + 8 * unit, origin.y + 5 * unit,
        color, 1.4 * unit, pulse * 0.8);
      break;
    case 'W05-F': {
      circle(ctx, origin.x, origin.y, (2 + 3 * pulse) * unit, '#edbd7c', 1.3 * unit, 0.9 * pulse);
      break;
    }
    case 'W05-H':
      circle(ctx, origin.x, origin.y, (4 + progress * 22) * unit * radiusCap, color, 1.8 * unit, pulse);
      line(ctx, origin.x, origin.y - 2 * unit, origin.x, origin.y - (8 + 18 * pulse) * unit,
        '#fff3bf', 3 * unit, 0.66 * pulse);
      sparks(ctx, origin.x, origin.y, '#e9d8c1', progress, cue.seed, 14, 18, unit, detail);
      break;
    case 'W06-F':
      for (let i = 0; i < 3; i++) {
        const t = Math.max(0, progress - i * 0.09), bend = Math.sin(t * Math.PI * 2) * 5 * unit;
        line(ctx, start.x + nx * bend, start.y + ny * bend, start.x + dx * t + nx * bend, start.y + dy * t + ny * bend,
          i ? '#3b9cab' : color, (i ? 1 : 3) * unit, 0.62 * pulse);
      }
      break;
    case 'W06-H':
      ctx.beginPath(); ctx.ellipse(origin.x, origin.y, (4 + 29 * progress) * unit * radiusCap,
        (4 + 14 * progress) * unit * radiusCap, 0, 0, Math.PI * 2);
      ctx.strokeStyle = color; ctx.lineWidth = 2 * unit; ctx.globalAlpha = pulse; ctx.stroke();
      sparks(ctx, origin.x, origin.y, color, progress, cue.seed, 6, 11, unit, detail);
      break;
    case 'W07-F': {
      const radius = Math.max(8 * unit, Math.hypot(origin.x - start.x, origin.y - start.y));
      const angle = Math.atan2(origin.y - start.y, origin.x - start.x);
      ctx.beginPath(); ctx.arc(start.x, start.y, radius, angle - 1.25, angle - 0.18);
      ctx.strokeStyle = color; ctx.lineWidth = 2 * unit; ctx.globalAlpha = 0.75 * pulse; ctx.stroke();
      box(ctx, origin.x - 2 * unit, origin.y - 2 * unit, 4 * unit, 4 * unit, '#b8bed3', 0.9);
      break;
    }
    case 'W07-H':
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3, r1 = 7 * unit + progress * 9 * unit, r2 = r1 + 5 * unit;
        line(ctx, origin.x + Math.cos(a) * r1, origin.y + Math.sin(a) * r1,
          origin.x + Math.cos(a + 0.7) * r2, origin.y + Math.sin(a + 0.7) * r2, color, 1.5 * unit, pulse);
      }
      break;
    case 'W08-F':
      line(ctx, origin.x - 2 * unit, origin.y + 3 * unit, origin.x + 3 * unit, origin.y - 5 * unit,
        '#fff1bd', 2 * unit, 0.72 * pulse);
      break;
    case 'W08-H':
      for (let i = 0; i < Math.max(2, Math.ceil(7 * detail)); i++) {
        const x = origin.x + i * 3 * unit - 10 * unit;
        line(ctx, x, origin.y + 3 * unit, x + 2 * unit, origin.y - (5 + noise(cue.seed, i) * 13) * unit,
          i % 2 ? color : '#ffcf7e', 1.6 * unit, pulse);
      }
      break;
    case 'W09-F':
      circle(ctx, origin.x, origin.y, (3 + 12 * progress) * unit, '#b3b2a4', 1.5 * unit, 0.6 * pulse);
      line(ctx, start.x, start.y, origin.x, origin.y, '#c98465', 2 * unit, 0.42 * pulse);
      break;
    case 'W09-H':
      ctx.beginPath(); ctx.ellipse(origin.x, origin.y, (6 + 48 * progress) * unit * radiusCap,
        (3 + 12 * progress) * unit * radiusCap, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#a17e66'; ctx.lineWidth = 2.4 * unit; ctx.globalAlpha = pulse; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(origin.x, origin.y, (5 + 38 * progress) * unit * radiusCap,
        (2 + 9 * progress) * unit * radiusCap, 0, 0, Math.PI * 2);
      ctx.strokeStyle = color; ctx.lineWidth = 1.4 * unit; ctx.globalAlpha = pulse * 0.8; ctx.stroke();
      for (let i = 0; i < Math.ceil(9 * detail); i++) shard(ctx, origin.x, origin.y, color, progress,
        -Math.PI * i / 8, 24 + i % 3 * 9, 3, unit, 0.8);
      break;
    case 'W10-F':
      for (let j = 0; j < 3; j++) {
        const t = clamp(progress * 1.3 - j * 0.23, 0, 1), ax = j ? start.x + dx * ((j - 1) / 2) : start.x;
        const ay = j ? start.y + dy * ((j - 1) / 2) : start.y, bx = start.x + dx * Math.min(1, (j + 1) / 2);
        const by = start.y + dy * Math.min(1, (j + 1) / 2);
        const midX = (ax + bx) / 2 + (noise(cue.seed, j) - 0.5) * 12 * unit;
        const midY = (ay + by) / 2 + (noise(cue.seed + 8, j) - 0.5) * 12 * unit;
        line(ctx, ax, ay, midX, midY, '#659adc', 3.2 * unit, 0.75 * pulse);
        line(ctx, midX, midY, bx, by, '#e4f5ff', 1.3 * unit, 0.9 * pulse * t);
      }
      break;
    case 'W10-H':
      circle(ctx, origin.x, origin.y, (7 + progress * 16) * unit * radiusCap, color, 1.5 * unit, pulse);
      sparks(ctx, origin.x, origin.y, '#e4f5ff', progress, cue.seed, 7, 12, unit, detail);
      break;
    case 'D01':
      circle(ctx, origin.x, origin.y, 5 * unit * (1 - progress * 0.5), '#c6b6a2', 2 * unit, pulse);
      sparks(ctx, origin.x, origin.y, '#eab093', progress, cue.seed, 6, 22, unit, detail);
      for (let i = 0; i < Math.ceil(9 * detail); i++) shard(ctx, origin.x, origin.y, i % 2 ? '#ce7d67' : '#eab093', progress,
        i * 0.84, 21 + i * 2.3, 3 + i % 3, unit, 0.9);
      break;
    case 'D02':
      for (let i = 0; i < Math.ceil(3 * detail); i++) shard(ctx, origin.x, origin.y,
        ['#c69fa0', '#8e7182', '#e2b7a2'][i], progress, i * 2.15 + 0.3, 35 + i * 8, 8, unit, 0.9);
      line(ctx, origin.x - 8 * unit, origin.y - 12 * unit, origin.x - 2 * unit, origin.y - 4 * unit, '#ffe3bb', 2 * unit, pulse);
      circle(ctx, origin.x, origin.y, 6 * unit * (1 + progress), '#aa796e', 1.5 * unit, pulse);
      break;
    case 'D03':
      for (let i = 0; i < cue.positions.length; i++) {
        const screen = project(cue.positions[i]) ?? origin;
        const beat = clamp((progress - i * 0.2) * 2.5, 0, 1);
        circle(ctx, screen.x, screen.y, (3 + beat * 10) * unit, '#ffe5a5', 1.5 * unit, 1 - beat);
        sparks(ctx, screen.x, screen.y, '#ce7d67', beat, cue.seed + i, 5, 16, unit, detail);
      }
      break;
    case 'D04':
      if (progress < 0.32) {
        const contraction = progress / 0.32;
        circle(ctx, origin.x, origin.y, (34 * (1 - contraction) + 4) * unit, '#ba91b4', 2.4 * unit, 0.82);
        box(ctx, origin.x - 4 * unit, origin.y - 4 * unit, 8 * unit, 8 * unit, '#e6c8ff', 1 - contraction);
      } else {
        const release = (progress - 0.32) / 0.68;
        circle(ctx, origin.x, origin.y, (8 + 66 * release) * unit, '#ba91b4', 3 * unit, 1 - release);
        circle(ctx, origin.x, origin.y, (5 + 53 * release) * unit, '#e6c8ff', 1.4 * unit, 0.8 * (1 - release));
        sparks(ctx, origin.x, origin.y, '#ba91b4', release, cue.seed, 16, 34, unit, detail);
        for (let i = 0; i < Math.ceil(9 * detail); i++) shard(ctx, origin.x, origin.y, '#ba91b4', release,
          i * 0.81, 37 + i % 4 * 8, 4 + i % 3, unit, 0.9);
      }
      break;
  }
  ctx.restore();
}

function weaponForEffect(effect: SortieVfxId): WeaponId {
  const index = SORTIE_VFX_IDS.indexOf(effect);
  return (['twin', 'pods', 'seeker', 'rail', 'flak', 'ion', 'drones', 'phoenix', 'bomb-bay', 'arc'] as const)[Math.floor(index / 2)];
}
