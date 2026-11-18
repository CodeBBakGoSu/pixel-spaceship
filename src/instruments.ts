import type { createTranslator } from './i18n.ts';
import { exitAltitude } from './maneuvers.ts';
import { activeWeakPoint, HIT_WINDOW, inBand } from './stage-combat.ts';
import type { Position, StageState } from './stage-types.ts';

export const RADAR_RANGE = 160;
export type AltitudeMark = '△' | '■' | '▽' | '^' | '=' | 'v';
export type Track = Position & { id: number; kind: 'patrol' | 'interceptor' | 'pod' | 'core' | 'warden' | 'salvage'; range: number; ahead: number };
type Blip = { x: number; y: number; kind: Track['kind']; mark: AltitudeMark | null };
export type RadarReadout = {
  contacts: Blip[]; priority: Track | null; salvage: Track | null;
  rear: boolean; rearCount: number; rearClose: boolean; rearBandMatch: boolean;
  rearMarks: AltitudeMark[];
};

export function relativeMark(delta: number, coarse: boolean): AltitudeMark {
  if (delta > HIT_WINDOW) return coarse ? '△' : '^';
  if (delta < -HIT_WINDOW) return coarse ? '▽' : 'v';
  return coarse ? '■' : '=';
}

export function altitudeDeltaText(delta: number, t: ReturnType<typeof createTranslator>): string {
  const value = Math.round(Math.abs(delta));
  return t('cockpit.altDelta', { sign: delta < 0 && value ? '−' : '+', value: String(value).padStart(2, '0') });
}

export function buildRadar(state: StageState): RadarReadout {
  const p = state.player;
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  const top = state.view === 'overhead';
  const contacts: Blip[] = [];
  let rearCount = 0, rearClose = false, rearBandMatch = false;
  let rearHigher = false, rearLower = false;
  const up = exitAltitude(p.altitude, 'immelmann'), down = exitAltitude(p.altitude, 'split-s');
  const active = activeWeakPoint(state);
  const visible: { track: Track; across: number }[] = [];
  const hostiles: Track[] = [];
  const scan = (item: Position & { id: number }, kind: Track['kind']): void => {
    const dx = item.x - p.x, dz = item.z - p.z;
    const range = Math.hypot(dx, dz), ahead = dx * sin + dz * cos;
    const track: Track = { x: item.x, z: item.z, alt: item.alt, id: item.id, kind, range, ahead };
    if (!top && kind !== 'salvage') hostiles.push(track);
    if (range > RADAR_RANGE) return;
    if (!top && ahead < 0) {
      if (kind !== 'salvage') {
        rearCount++;
        rearClose ||= range < 95;
        rearBandMatch ||= inBand(item.alt, p.altitude);
        rearHigher ||= item.alt - p.altitude > HIT_WINDOW && inBand(item.alt, up);
        rearLower ||= p.altitude - item.alt > HIT_WINDOW && inBand(item.alt, down);
      }
      return;
    }
    visible.push({ track, across: dx * cos - dz * sin });
  };
  for (const enemy of state.enemies) if (enemy.hp) scan(enemy, enemy.kind);
  // The flat radar resolves the Warden as one airframe. The forward views resolve its exposed hardware.
  if (active && state.boss) {
    if (top) scan({ id: -1, x: state.boss.x, z: state.boss.z, alt: state.boss.alt }, 'warden');
    else scan(active, active.kind);
  }
  for (const pickup of state.pickups) scan(pickup, 'salvage');
  if (!top && !rearClose) rearClose = state.shots.some(shot => {
    const dx = shot.x - p.x, dz = shot.z - p.z;
    return shot.kind === 'hostile' && dx * sin + dz * cos < 0 && Math.hypot(dx, dz) < 90;
  });
  const nearest = (tracks: Track[]): Track | null =>
    tracks.reduce<Track | null>((best, track) => !best || track.range < best.range ? track : best, null);
  const forward = visible.map(({ track }) => track);
  const priority = top ? null : forward.find(track => track.id === (state.lock?.id ?? active?.id)) ??
    nearest(forward.filter(track => track.kind !== 'salvage'));
  const salvage = top ? null : nearest(forward.filter(track => track.kind === 'salvage'));
  for (const { track, across } of visible) {
    const marked = top || track.id === priority?.id || track.id === salvage?.id;
    contacts.push({
      x: across / RADAR_RANGE,
      y: -track.ahead / RADAR_RANGE,
      kind: track.kind,
      mark: marked ? relativeMark(track.alt - p.altitude, top) : null,
    });
  }
  const rearMarks: AltitudeMark[] = [];
  if (rearHigher) rearMarks.push('△');
  if (rearBandMatch) rearMarks.push('■');
  if (rearLower) rearMarks.push('▽');
  return { contacts, priority: priority ?? nearest(hostiles), salvage,
    rear: rearCount > 0 || rearClose, rearCount, rearClose, rearBandMatch, rearMarks };
}

export class RadarDisplay {
  private readonly face = document.createElement('canvas');
  private readonly staticLayer = this.face.getContext('2d')!;
  private x = 0;
  private y = 0;
  private radius = 0;

  resize(width: number, height: number, font: string, label: string): void {
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
    c.font = (short ? '8px ' : '10px ') + font;
    c.fillText(label, 4, short ? 10 : 12);
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
    if (readout.rear) {
      const pulse = readout.rearClose && Math.floor(tick / 12) % 2 === 0;
      c.strokeStyle = pulse ? '#ff7965' : '#ffb064';
      c.lineWidth = readout.rearBandMatch ? 2 : 1;
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
    const salvage = kind === 'salvage';
    const base = salvage ? '#7cece0' : kind === 'pod' || kind === 'core' || kind === 'warden' ? '#ffd783' : '#ff9683';
    c.fillStyle = base;
    if (salvage) {
      c.fillRect(x, y - 2, 1, 5);
      c.fillRect(x - 1, y - 1, 3, 3);
      c.fillRect(x - 2, y, 5, 1);
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
      const cx = x + (!triangle || salvage ? 5 : 0), cy = y - (!triangle ? 3 : 0);
      c.moveTo(cx - 2.5, cy + direction * 2.5);
      c.lineTo(cx, cy - direction * 2.5);
      c.lineTo(cx + 2.5, cy + direction * 2.5);
      if (triangle) c.closePath();
    }
    c.stroke();
  }
}
