import type { createTranslator } from './i18n.ts';
import { NAV_MAP_RANGE, RADAR_RANGE } from './data/navigation.ts';
import type { EnemyKind } from './enemy-kinds.ts';
import { activeTrail, formerPursuer } from './maneuvers.ts';
import { LANDMARKS, type LandmarkId, type WorldSite } from './reach.ts';
import { activeAce, beaconTick } from './stage.ts';
import { angleTo, HIT_WINDOW, HOSTILE_HIT_RADIUS, impactTime, inBand, STEP } from './stage-combat.ts';
import type { Position, StageState } from './stage-types.ts';

export { RADAR_RANGE } from './data/navigation.ts';
const REAR_WARNING_SECONDS = 0.8;
const BODY_RADIUS = 7;
type Translate = ReturnType<typeof createTranslator>;
type SiteKind = WorldSite['kind'];
type MapMark = LandmarkId | SiteKind | 'ace' | 'chest';
export type AltitudeMark = '△' | '■' | '▽' | '^' | '=' | 'v';
export type Track = Position & { id: number; kind: EnemyKind | 'ace' | 'carrier' | 'salvage' | 'chest'; range: number; ahead: number; former?: true };
type Blip = { x: number; y: number; kind: Track['kind'] | SiteKind; mark: AltitudeMark | null; former?: true };
type RimTick = { angle: number; kind: 'enemy' | 'salvage' | 'ace' | 'chest' | SiteKind };
const MAP_LANDMARKS = Object.entries(LANDMARKS) as [LandmarkId, Position][];
const NO_SITES: readonly WorldSite[] = [];
const MAP_COLORS: Record<MapMark, string> = {
  ridge: '#a9c165', strait: '#6bc4c9', stacks: '#94a6a6', atoll: '#b7cda2',
  chest: '#ffe6a9', ace: '#ffd783', beacon: '#8adffc', supply: '#ffb1da', xp: '#97e994',
};
export type RearDanger = Position & { seconds: number } & ({ kind: 'shot' } | { kind: 'contact'; enemyId: number });
// --- S7e lane ---
export type RearPursuit = Track & { kind: 'ace' | 'hound' | 'interceptor' | 'harrier' };
export type RadarReadout = {
  contacts: Blip[]; priority: Track | null; salvage: Track | null;
  rear: boolean; rearCount: number; rearBandMatch: boolean;
  rearMarks: AltitudeMark[]; rearDanger: RearDanger | null; rearPursuit: RearPursuit | null;
  rim: RimTick[];
};

function isRearPursuer(track: Track): track is RearPursuit {
  return track.kind === 'ace' || track.kind === 'hound' || track.kind === 'interceptor' || track.kind === 'harrier';
}

export function beaconTrack(state: StageState): Position | null {
  if (state.boss) return activeAce(state);
  return state.tick >= beaconTick(state) ? state.rally ?? LANDMARKS.atoll : null;
}

export function worldSiteObjective(state: StageState, t: Translate): string | null {
  const { player } = state;
  let nearest: WorldSite | undefined;
  let distanceSquared = Infinity;
  for (const site of state.worldSites ?? NO_SITES) {
    if (site.claimed) continue;
    const rangeSquared = (site.x - player.x) ** 2 + (site.z - player.z) ** 2;
    if (rangeSquared >= distanceSquared) continue;
    nearest = site;
    distanceSquared = rangeSquared;
  }
  if (!nearest || distanceSquared > NAV_MAP_RANGE ** 2) return null;
  const angle = Math.atan2(nearest.x - player.x, nearest.z - player.z);
  const bearing = (Math.round(angle * 180 / Math.PI) + 360) % 360;
  return t('objective.worldSite', {
    name: t(`nav.site.${nearest.kind}`),
    bearing: String(bearing).padStart(3, '0'),
    distance: Math.round(Math.sqrt(distanceSquared)),
    altitude: Math.round(nearest.alt),
  });
}

function drawMapGlyph(c: CanvasRenderingContext2D, kind: MapMark, x: number, y: number): void {
  const px = Math.round(x), py = Math.round(y);
  c.fillStyle = c.strokeStyle = MAP_COLORS[kind];
  if (kind === 'ridge' || kind === 'beacon') {
    c.beginPath();
    c.moveTo(px, py - 4);
    c.lineTo(px - 4, kind === 'ridge' ? py + 3 : py);
    if (kind === 'beacon') c.lineTo(px, py + 4);
    c.lineTo(px + 4, kind === 'ridge' ? py + 3 : py);
    c.fill();
  } else if (kind === 'strait') {
    c.fillRect(px - 4, py - 1, 9, 3);
  } else if (kind === 'stacks') {
    c.fillRect(px - 3, py - 1, 3, 5);
    c.fillRect(px + 1, py - 4, 3, 7);
  } else if (kind === 'xp') {
    c.fillRect(px - 3, py, 7, 1);
    c.fillRect(px, py - 3, 1, 7);
  } else {
    const size = kind === 'ace' ? 9 : 5;
    c.strokeRect(px - size / 2, py - size / 2, size, size);
    if (kind === 'supply') c.fillRect(px - 1, py, 3, 1);
  }
}

function drawMapDestination(c: CanvasRenderingContext2D, kind: MapMark, dx: number, dz: number,
  center: number, middle: number, radius: number): void {
  const distance = Math.hypot(dx, dz);
  if (distance <= NAV_MAP_RANGE) {
    const scale = radius / NAV_MAP_RANGE;
    drawMapGlyph(c, kind, center + dx * scale, middle - dz * scale);
    return;
  }
  const nx = dx / distance, ny = -dz / distance;
  const x = center + nx * radius, y = middle + ny * radius;
  c.strokeStyle = MAP_COLORS[kind];
  c.beginPath();
  c.moveTo(x - nx * 3 - ny * 2, y - ny * 3 + nx * 2);
  c.lineTo(x + nx, y + ny);
  c.lineTo(x - nx * 3 + ny * 2, y - ny * 3 - nx * 2);
  c.stroke();
}

export function drawArenaMap(c: CanvasRenderingContext2D, state: StageState, t: Translate, font: string, yaw = state.player.yaw): void {
  const { width, height } = c.canvas;
  const center = width / 2, middle = height / 2 - 2, radius = Math.max(4, Math.min(width, height) / 2 - 10);
  const { player } = state;
  c.fillStyle = '#091d23';
  c.fillRect(0, 0, width, height);
  c.strokeStyle = '#52796b';
  c.strokeRect(0.5, 0.5, width - 1, height - 1);
  c.strokeStyle = '#294f42';
  c.beginPath();
  c.arc(center, middle, radius, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = '#9abebc';
  c.font = '9px ' + font;
  c.fillText(t('cockpit.north'), 4, 11);
  c.fillText(t('cockpit.range', { value: NAV_MAP_RANGE }), 4, height - 4);
  c.fillRect(center - 1, middle - radius - 3, 2, 4);
  for (const [kind, landmark] of MAP_LANDMARKS) {
    const dx = landmark.x - player.x, dz = landmark.z - player.z;
    if (dx ** 2 + dz ** 2 <= NAV_MAP_RANGE ** 2) {
      drawMapGlyph(c, kind, center + dx * radius / NAV_MAP_RANGE, middle - dz * radius / NAV_MAP_RANGE);
    }
  }
  for (const site of state.worldSites ?? NO_SITES) {
    if (!site.claimed) drawMapDestination(c, site.kind, site.x - player.x, site.z - player.z, center, middle, radius);
  }
  for (const drop of state.chests.drops) {
    drawMapDestination(c, 'chest', drop.x - player.x, drop.z - player.z, center, middle, radius);
  }
  const beacon = beaconTrack(state);
  if (beacon) drawMapDestination(c, 'ace', beacon.x - player.x, beacon.z - player.z, center, middle, radius);
  c.save();
  c.translate(center, middle);
  c.rotate(yaw);
  c.fillStyle = '#f6fddd';
  c.beginPath();
  c.moveTo(0, -5);
  c.lineTo(-3, 3);
  c.lineTo(3, 3);
  c.fill();
  c.restore();
}

export function relativeMark(delta: number, coarse: boolean): AltitudeMark {
  if (delta > HIT_WINDOW) return coarse ? '△' : '^';
  if (delta < -HIT_WINDOW) return coarse ? '▽' : 'v';
  return coarse ? '■' : '=';
}

export function altitudeDeltaText(delta: number, t: Translate): string {
  const value = Math.round(Math.abs(delta));
  return t('cockpit.altDelta', { sign: delta < 0 && value ? '−' : '+', value: String(value).padStart(2, '0') });
}

function findRearDanger(state: StageState, fx: number, fz: number): RearDanger | null {
  if (state.phase !== 'playing' || state.paused || state.invulnerability >= REAR_WARNING_SECONDS) return null;
  const p = state.player;
  const playerVx = p.vx ?? state.speed * fx, playerVz = p.vz ?? state.speed * fz;
  const climb = state.climbRate;
  const impact = (target: Position & { vx: number; vz: number }, radius: number, from: number, until: number): number => {
    const dx = target.x - p.x, dz = target.z - p.z;
    const height = target.alt - p.altitude;
    if (dx * fx + dz * fz >= 0 || Math.abs(height) > HIT_WINDOW) return Infinity;
    const vx = target.vx - playerVx, vz = target.vz - playerVz;
    if (dx * vx + dz * vz >= 0) return Infinity;
    // Stop projecting once the player's climb leaves the target's hit window.
    const bandExit = climb ? (HIT_WINDOW + Math.sign(climb) * height) / Math.abs(climb) : Infinity;
    const to = Math.min(REAR_WARNING_SECONDS, bandExit, until);
    if (from > to) return Infinity;
    const seconds = impactTime(target, vx, vz, p, radius, from, to);
    return seconds < state.invulnerability ? Infinity : seconds;
  };
  let closest: RearDanger | null = null;
  for (const shot of state.shots) {
    if (shot.kind !== 'hostile' || shot.life <= 0) continue;
    const seconds = impact(shot, HOSTILE_HIT_RADIUS, 0, shot.life);
    if (seconds < (closest?.seconds ?? Infinity)) closest = { kind: 'shot', x: shot.x, z: shot.z, alt: shot.alt, seconds };
  }
  if (closest) return closest;

  const bodyFrom = Math.max(STEP, (state.bodyGraceUntil + 1 - state.tick) * STEP);
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0 || enemy.entry || enemy.kind === 'gnat') continue;
    const seconds = impact(enemy, BODY_RADIUS, bodyFrom, Infinity);
    if (seconds < (closest?.seconds ?? Infinity)) {
      closest = { kind: 'contact', enemyId: enemy.id, x: enemy.x, z: enemy.z, alt: enemy.alt, seconds };
    }
  }
  return closest;
}

export function buildRadar(state: StageState, yaw = state.player.yaw): RadarReadout {
  const p = state.player;
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  const top = state.view === 'overhead';
  const contacts: Blip[] = [];
  const rim: RimTick[] = [];
  const rimTick = (kind: RimTick['kind'], dx: number, dz: number) => {
    const bin = Math.round(angleTo(yaw, dx, dz) * 8 / Math.PI);
    const angle = (bin + 16) % 16 * Math.PI / 8;
    if (!rim.some(tick => tick.kind === kind && tick.angle === angle)) rim.push({ kind, angle });
  };
  let rearCount = 0, rearBandMatch = false;
  let rearHigher = false, rearLower = false;
  const rearDanger = findRearDanger(state, fx, fz);
  // --- S7e lane ---
  const ace = activeAce(state);
  const running = state.phase === 'playing' && !state.paused;
  let rearPursuit: RearPursuit | null = null;
  const visible: { track: Track; across: number }[] = [];
  const hostiles: Track[] = [];
  const scan = (item: Position & { id: number }, kind: Track['kind'], former = false, tail = false): void => {
    const dx = item.x - p.x, dz = item.z - p.z;
    const range = Math.hypot(dx, dz), ahead = dx * sin + dz * cos;
    const track: Track = { x: item.x, z: item.z, alt: item.alt, id: item.id, kind, range, ahead };
    if (former) track.former = true;
    const hostile = kind !== 'salvage' && kind !== 'chest';
    if (!top && hostile) hostiles.push(track);
    if (kind === 'chest' && (range > RADAR_RANGE || (!top && ahead < 0))) {
      rimTick(kind, dx, dz);
      return;
    }
    if (range > RADAR_RANGE) {
      if (kind === 'salvage') rimTick(kind, dx, dz);
      else rimTick(kind === 'ace' ? 'ace' : 'enemy', dx, dz);
      return;
    }
    const aft = dx * fx + dz * fz < 0;
    if (aft && tail && running && isRearPursuer(track) && (kind === 'ace' || !rearPursuit || range < rearPursuit.range)) {
      rearPursuit = track;
    }
    if (!top && aft && hostile && kind !== 'turret' && kind !== 'gnat') {
      rearCount++;
      rearBandMatch ||= inBand(item.alt, p.altitude);
      rearHigher ||= item.alt - p.altitude > HIT_WINDOW;
      rearLower ||= p.altitude - item.alt > HIT_WINDOW;
    }
    if (!top && ahead < 0) return;
    visible.push({ track, across: dx * cos - dz * sin });
  };
  const scanDestination = (item: Position, kind: SiteKind | 'ace', tracked = false): void => {
    const dx = item.x - p.x, dz = item.z - p.z;
    const ahead = dx * sin + dz * cos;
    if (dx ** 2 + dz ** 2 > RADAR_RANGE ** 2 || (!top && ahead < 0)) rimTick(kind, dx, dz);
    else if (!tracked) contacts.push({ x: (dx * cos - dz * sin) / RADAR_RANGE, y: -ahead / RADAR_RANGE, kind, mark: null });
  };
  const trail = activeTrail(state);
  for (const enemy of state.enemies) if (enemy.hp) {
    const tail = !enemy.entry && enemy.tell?.kind === 'tail' && state.tick < enemy.tell.until;
    scan(enemy, enemy.carrier ? 'carrier' : enemy.kind, formerPursuer(state, trail, enemy), tail);
  }
  if (ace) scan(ace, 'ace', false, ace.tail && !ace.entry);
  for (const pickup of state.pickups) scan(pickup, 'salvage');
  state.chests.drops.forEach((drop, index) => scan({ ...drop, id: -2 - index }, 'chest'));
  const beacon = beaconTrack(state);
  for (const site of state.worldSites ?? NO_SITES) {
    if (site.claimed || (beacon && site.kind === 'beacon' && site.x === beacon.x && site.z === beacon.z)) continue;
    scanDestination(site, site.kind);
  }
  if (beacon) scanDestination(beacon, 'ace', !!ace);
  const nearest = (tracks: Track[]): Track | null =>
    tracks.reduce<Track | null>((best, track) => !best || track.range < best.range ? track : best, null);
  const forward = visible.map(({ track }) => track);
  const charging = !top && state.enemies.find(enemy => enemy.tell?.kind === 'snipe');
  const priority = top ? null : forward.find(track => track.id === (state.lock?.id ?? ace?.id)) ??
    (charging ? forward.find(track => track.id === charging.id) : undefined) ??
    nearest(forward.filter(track => track.kind !== 'salvage' && track.kind !== 'chest'));
  const salvage = top ? null : nearest(forward.filter(track => track.kind === 'salvage'));
  for (const { track, across } of visible) {
    const marked = top || track.kind === 'chest' || track.kind === 'ace' || track.id === priority?.id || track.id === salvage?.id;
    const blip: Blip = {
      x: across / RADAR_RANGE,
      y: -track.ahead / RADAR_RANGE,
      kind: track.kind,
      mark: marked ? relativeMark(track.alt - p.altitude, top) : null,
    };
    if (track.former) blip.former = true;
    contacts.push(blip);
  }
  const rearMarks: AltitudeMark[] = [];
  if (rearHigher) rearMarks.push('△');
  if (rearBandMatch) rearMarks.push('■');
  if (rearLower) rearMarks.push('▽');
  return { contacts, rim, priority: priority ?? nearest(hostiles), salvage,
    rear: rearCount > 0, rearCount, rearBandMatch, rearMarks, rearDanger, rearPursuit };
}

export class RadarDisplay {
  private readonly face = document.createElement('canvas');
  private readonly staticLayer = this.face.getContext('2d')!;
  private x = 0;
  private y = 0;
  private radius = 0;

  resize(width: number, height: number, font: string, label: string, labelSize?: number): void {
    this.face.width = width;
    this.face.height = height;
    const c = this.staticLayer;
    this.x = Math.round(width / 2);
    const short = height < 65;
    this.y = Math.round(height / 2) + (short ? 2 : 5);
    this.radius = Math.max(4, Math.min(width / 2 - 8, height / 2 - (short ? 8 : 13)));
    const { x, y, radius } = this;
    c.fillStyle = '#0a201f';
    c.fillRect(0, 0, width, height);
    c.strokeStyle = '#52796b';
    c.strokeRect(0.5, 0.5, width - 1, height - 1);
    c.strokeStyle = '#294f42';
    for (const scale of [0.48, 1]) {
      c.beginPath();
      c.arc(x, y, radius * scale, 0, Math.PI * 2);
      c.stroke();
    }
    c.fillStyle = '#28493d';
    c.fillRect(x - radius, y, radius * 2, 1);
    c.fillRect(x, y - radius, 1, radius * 2);
    c.fillStyle = '#95ccaf';
    const size = labelSize ?? (short ? 8 : 10);
    c.font = `${size}px ${font}`;
    c.fillText(label, 4, size + 2);
  }

  draw(c: CanvasRenderingContext2D, left: number, top: number, readout: RadarReadout, yaw: number, tick: number): void {
    c.drawImage(this.face, left, top);
    const x = left + this.x, y = top + this.y, radius = this.radius;
    const beam = tick * 0.039;
    c.fillStyle = 'rgba(96,232,133,.11)';
    c.beginPath();
    c.moveTo(x, y);
    c.arc(x, y, radius, beam - 0.47, beam);
    c.fill();
    c.fillStyle = '#c8f5c6';
    c.strokeStyle = '#ddf9c5';
    c.beginPath();
    c.moveTo(x - Math.sin(yaw) * (radius + 1), y - Math.cos(yaw) * (radius + 1));
    c.lineTo(x - Math.sin(yaw) * (radius + 5), y - Math.cos(yaw) * (radius + 5));
    c.stroke();
    c.fillRect(x - 1, y - 1, 3, 3);

    // Offset glyphs sharing a planar pixel so a stack can show both sides of the window.
    const occupied: { x: number; y: number; count: number }[] = [];
    const offsets = [0, 7, -7, 14, -14];
    for (const contact of readout.contacts) {
      let px = Math.round(x + contact.x * (radius - 3));
      const py = Math.round(y + contact.y * (radius - 3));
      if (contact.mark) {
        const cluster = occupied.find(point => Math.abs(point.x - px) < 5 && Math.abs(point.y - py) < 5);
        if (cluster) px += offsets[Math.min(++cluster.count, offsets.length - 1)];
        else occupied.push({ x: px, y: py, count: 0 });
      }
      px = Math.max(left + 4, Math.min(left + this.face.width - 5, px));
      this.drawBlip(c, px, py, contact);
    }
    for (const { kind, angle } of readout.rim) {
      const dx = Math.sin(angle), dy = -Math.cos(angle);
      c.strokeStyle = kind === 'salvage' ? '#7cece0' : kind === 'enemy' ? '#ff9683' : MAP_COLORS[kind];
      const offset = kind === 'chest' || kind === 'supply' ? 5 : kind === 'salvage' || kind === 'xp' ? -5
        : kind === 'ace' || kind === 'beacon' ? 2 : 0;
      c.beginPath();
      c.moveTo(x + dx * (radius - 3 + offset), y + dy * (radius - 3 + offset));
      c.lineTo(x + dx * (radius + offset), y + dy * (radius + offset));
      c.stroke();
    }
    if (readout.rear || readout.rearPursuit) {
      c.strokeStyle = readout.rearPursuit ? '#ff9a78' : '#a8c5bb';
      c.lineWidth = readout.rearPursuit || readout.rearBandMatch ? 2 : 1;
      c.beginPath();
      c.arc(x, y, radius, Math.PI * 0.35, Math.PI * 0.65);
      c.moveTo(x - 4, y + radius - 4);
      c.lineTo(x, y + radius - 1);
      c.lineTo(x + 4, y + radius - 4);
      c.stroke();
      c.lineWidth = 1;
    }
  }

  private drawBlip(c: CanvasRenderingContext2D, x: number, y: number, contact: Blip): void {
    const { kind, mark } = contact;
    if (kind === 'beacon' || kind === 'supply' || kind === 'xp' || (kind === 'ace' && !mark)) {
      drawMapGlyph(c, kind, x, y);
      return;
    }
    const salvage = kind === 'salvage';
    const chest = kind === 'chest';
    const ace = kind === 'ace';
    const aegis = kind === 'aegis';
    const carrier = kind === 'carrier';
    const base = salvage ? '#7cece0' : ace || carrier ? '#ffd783' : aegis ? '#9acbff' : '#ff9683';
    if (contact.former) {
      c.strokeStyle = '#91fff1';
      c.strokeRect(x - 4.5, y - 4.5, 9, 9);
    }
    c.fillStyle = base;
    if (chest) {
      c.strokeStyle = '#ffe6a9';
      c.strokeRect(x - 2.5, y - 2.5, 5, 5);
    } else if (salvage) {
      c.fillRect(x, y - 2, 1, 5);
      c.fillRect(x - 1, y - 1, 3, 3);
      c.fillRect(x - 2, y, 5, 1);
    } else if (carrier) {
      c.fillRect(x - 3, y - 1, 7, 3);
      c.fillRect(x - 2, y - 3, 5, 1);
    } else if (ace || aegis) {
      c.strokeStyle = base;
      c.beginPath();
      c.moveTo(x, y - 3);
      c.lineTo(x + 3, y);
      c.lineTo(x, y + 3);
      c.lineTo(x - 3, y);
      c.closePath();
      c.stroke();
    } else if (mark !== '△' && mark !== '▽') {
      c.fillRect(x - 1, y - 1, 3, 3);
    }
    if (!mark || mark === '■') return;
    const palette = mark === '^' || mark === '△' ? '#ffb380' : mark === 'v' || mark === '▽' ? '#96c7ff' : '#bcf7ae';
    c.strokeStyle = palette;
    c.lineWidth = 1;
    c.beginPath();
    if (mark === '=') {
      c.moveTo(x + 2.5, y - 4.5);
      c.lineTo(x + 7.5, y - 4.5);
      c.moveTo(x + 2.5, y - 2.5);
      c.lineTo(x + 7.5, y - 2.5);
    } else {
      const triangle = mark === '△' || mark === '▽';
      const direction = mark === '^' || mark === '△' ? 1 : -1;
      const cx = x + (!triangle || salvage || chest || ace || aegis || carrier ? 5 : 0), cy = y - (!triangle ? 3 : 0);
      c.moveTo(cx - 2.5, cy + direction * 2.5);
      c.lineTo(cx, cy - direction * 2.5);
      c.lineTo(cx + 2.5, cy + direction * 2.5);
      if (triangle) c.closePath();
    }
    c.stroke();
  }
}

// The mirror follows a closing aircraft long enough to read a response.
export class RearMirrorThreat {
  private current: number | null = null;
  private holdUntil = 0;
  private pending: number | null = null;
  private pendingSince = 0;
  private lastTick = 0;

  clear(): void {
    this.current = this.pending = null;
    this.holdUntil = this.pendingSince = 0;
  }

  update(state: StageState) {
    const { player, tick } = state;
    if (tick < this.lastTick) this.clear();
    this.lastTick = tick;
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    const vx = player.vx ?? state.speed * fx, vz = player.vz ?? state.speed * fz;
    let current = null, best = null;
    for (const enemy of state.enemies) {
      if (enemy.hp <= 0 || enemy.kind === 'turret' || enemy.kind === 'gnat') continue;
      const dx = enemy.x - player.x, dz = enemy.z - player.z;
      const aft = -(dx * fx + dz * fz), distance = Math.hypot(dx, dz);
      if (aft <= 0 || distance > 140) continue;
      const closing = -(dx * (enemy.vx - vx) + dz * (enemy.vz - vz)) / distance;
      if (closing <= 0 && enemy.id !== this.current) continue;
      const lateral = dx * fz - dz * fx, delta = enemy.alt - player.altitude;
      const threat = { id: enemy.id, alt: enemy.alt, distance, lateral,
        side: lateral < -aft * 0.25 ? 'Left' as const : lateral > aft * 0.25 ? 'Right' as const : 'Centre' as const,
        height: delta > HIT_WINDOW ? 'Above' as const : delta < -HIT_WINDOW ? 'Below' as const : 'Level' as const,
        score: distance / Math.max(5, closing) + Math.abs(delta) * 0.08, closing };
      if (enemy.id === this.current) current = threat;
      if (closing > 0 && (!best || threat.score < best.score)) best = threat;
    }

    if ((best?.id ?? null) !== this.pending) {
      this.pending = best?.id ?? null;
      this.pendingSince = tick;
    }
    if (best && best.id === current?.id) this.holdUntil = tick + 15;
    if (best && tick >= this.pendingSince + 9 && (!current || tick >= this.holdUntil)) {
      this.current = best.id;
      this.holdUntil = tick + 15;
      return best;
    }
    return current && (current.closing > 0 || tick < this.holdUntil) ? current : null;
  }
}
