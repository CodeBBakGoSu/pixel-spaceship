import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DoubleSide, DynamicDrawUsage, Group, InstancedMesh,
  LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Object3D, TorusGeometry,
} from 'three';
import { bakeVoxels } from '../proto/three/src/voxel-geometry.ts';
import { PHASES, SWARM_CAPS } from './data/phases.ts';
import { ROSTER } from './data/roster.ts';
import { ENEMY_KINDS } from './enemy-kinds.ts';
import { aceAirframe } from './models-roster.ts';
import { rollAttitude } from './roll.ts';
import { BANDS, clamp, FLAK_RADIUS } from './stage-combat.ts';
import type { Enemy, Position, StageState } from './stage-types.ts';

const SIGNAL_COLORS = {
  gun: 0xffac85, missile: 0xff655d, roll: 0xe6a7ff, snipe: 0xff77ae, flak: 0xffca68,
  tail: 0xff8775, strafe: 0xace5ff, dive: 0xffd99b, mine: 0xffb978, aegis: 0x9ff8ff,
  carrier: 0xffda83, gnat: 0xffecbf,
} as const;
const DESKTOP_GNAT_MARKS = 8;
const MOBILE_GNAT_MARKS = 4;
const RING_LIMIT = Math.max(...PHASES.map(phase => phase.regularCap)) + ENEMY_KINDS.diver.cap + DESKTOP_GNAT_MARKS + 1;
const CUE_VERTEX_LIMIT = RING_LIMIT * 32;
const SHIELD_RADIUS = 13;
const SHIELD_HALF_HEIGHT = 4.2;
const BLAST_CUE_RADIUS = 6;

/** Shared world-space batches are visible to the forward cameras and the rear camera. */
export class RosterVisuals {
  readonly group = new Group();
  readonly ace: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly afterburner = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 4);
  private readonly rings = new InstancedMesh(
    new TorusGeometry(1, 0.045, 4, 20).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ transparent: true, opacity: 0.86, depthTest: false, depthWrite: false, fog: false }),
    RING_LIMIT,
  );
  private readonly shields = new InstancedMesh(
    new CylinderGeometry(1, 1, 2, 14, 1, true, Math.PI - ROSTER.aegis.shieldHalfAngle, 2 * ROSTER.aegis.shieldHalfAngle),
    new MeshBasicMaterial({ color: 0x70f1ff, transparent: true, opacity: 0.25, depthWrite: false, side: DoubleSide, forceSinglePass: true }),
    ENEMY_KINDS.aegis.cap,
  );
  private readonly positions = new BufferAttribute(new Float32Array(CUE_VERTEX_LIMIT * 3), 3).setUsage(DynamicDrawUsage);
  private readonly colors = new BufferAttribute(new Float32Array(CUE_VERTEX_LIMIT * 3), 3).setUsage(DynamicDrawUsage);
  private readonly drawRange = { start: 0, count: 0 };
  private readonly signal: LineSegments;
  private readonly transform = new Object3D();
  private readonly paint = new Color();
  private vertices = 0;
  private ringCount = 0;
  private shieldCount = 0;

  constructor() {
    const { faces, palette, size } = aceAirframe(false);
    this.ace = new Mesh(bakeVoxels(faces, palette, size), new MeshBasicMaterial({ vertexColors: true }));
    this.ace.name = 'Ace fighter';
    this.ace.add(this.afterburner);
    this.afterburner.frustumCulled = false;
    this.afterburner.instanceMatrix.setUsage(DynamicDrawUsage);
    this.shields.frustumCulled = false;
    this.shields.instanceMatrix.setUsage(DynamicDrawUsage);
    this.rings.name = 'Enemy warning rings';
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 2;
    this.rings.instanceMatrix.setUsage(DynamicDrawUsage);
    this.rings.setColorAt(0, this.paint);
    this.rings.instanceColor!.setUsage(DynamicDrawUsage);
    for (let i = 0; i < 4; i++) this.afterburner.setColorAt(i, this.paint.setHex(i < 2 ? 0xff7840 : 0xffdfac));

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('color', this.colors);
    geometry.setDrawRange(0, 0);
    this.signal = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, depthWrite: false }));
    this.signal.name = 'Enemy attack warnings';
    this.signal.frustumCulled = false;
    this.group.add(this.shields, this.ace, this.rings, this.signal);
  }

  private stroke(x: number, z: number, y: number, tx: number, tz: number, ty: number): void {
    if (this.vertices + 2 > CUE_VERTEX_LIMIT) return;
    const i = this.vertices;
    this.positions.setXYZ(i, x, y, -z);
    this.positions.setXYZ(i + 1, tx, ty, -tz);
    const { r, g, b } = this.paint;
    this.colors.setXYZ(i, r, g, b);
    this.colors.setXYZ(i + 1, r, g, b);
    this.vertices += 2;
  }

  private marker(source: Position, alt: number, radius: number, flat: boolean): void {
    const { x, z } = source;
    if (this.ringCount >= RING_LIMIT) return;
    const { position, rotation, scale } = this.transform;
    position.set(x, alt, -z);
    rotation.set(0, 0, 0);
    scale.set(radius, Math.max(radius * 0.85, 3), radius);
    this.transform.updateMatrix();
    this.rings.setMatrixAt(this.ringCount, this.transform.matrix);
    this.rings.setColorAt(this.ringCount++, this.paint);
    // The four posts preserve the mark when a forward camera sees the altitude plane edge-on.
    if (!flat) {
      const rise = Math.max(3.8, radius * 0.28);
      this.stroke(x - radius, z, alt, x - radius, z, alt + rise);
      this.stroke(x + radius, z, alt, x + radius, z, alt + rise);
      this.stroke(x, z - radius, alt, x, z - radius, alt + rise);
      this.stroke(x, z + radius, alt, x, z + radius, alt + rise);
    }
  }

  private tracer(from: Position, to: Position, plane?: number, dashes = 8): void {
    const dx = to.x - from.x, dz = to.z - from.z;
    const alt = plane ?? from.alt, dy = plane === undefined ? to.alt - alt : 0;
    for (let i = 0; i < dashes; i++) {
      const start = (i + 0.3) / dashes, end = (i + 0.86) / dashes;
      this.stroke(from.x + dx * start, from.z + dz * start, alt + dy * start,
        from.x + dx * end, from.z + dz * end, alt + dy * end);
    }
  }

  private shield(enemy: Enemy, alt: number, charging: boolean, flat: boolean): void {
    if (this.shieldCount >= this.shields.instanceMatrix.count) return;
    const { x, z, yaw } = enemy;
    const { position, rotation, scale } = this.transform;
    position.set(x, alt, -z);
    rotation.set(0, -yaw, 0);
    scale.set(SHIELD_RADIUS, SHIELD_HALF_HEIGHT, SHIELD_RADIUS);
    this.transform.updateMatrix();
    this.shields.setMatrixAt(this.shieldCount++, this.transform.matrix);

    const angle = ROSTER.aegis.shieldHalfAngle, steps = 10;
    this.paint.setHex(charging ? 0xe2ffff : SIGNAL_COLORS.aegis);
    let previousX = x + Math.sin(yaw - angle) * SHIELD_RADIUS;
    let previousZ = z + Math.cos(yaw - angle) * SHIELD_RADIUS;
    const y = alt + SHIELD_HALF_HEIGHT;
    for (let i = 1; i <= steps; i++) {
      const heading = yaw - angle + i * 2 * angle / steps;
      const nx = x + Math.sin(heading) * SHIELD_RADIUS, nz = z + Math.cos(heading) * SHIELD_RADIUS;
      this.stroke(previousX, previousZ, y, nx, nz, y);
      if (!flat && (i === 1 || i === steps || i === steps / 2)) {
        this.stroke(nx, nz, y, nx, nz, alt - SHIELD_HALF_HEIGHT);
      }
      previousX = nx;
      previousZ = nz;
    }
  }

  private regularSignals(state: StageState, plane: number | undefined, reducedMotion: boolean): void {
    const flat = plane !== undefined;
    const gnatMarks = state.swarmCap === SWARM_CAPS.mobile ? MOBILE_GNAT_MARKS : DESKTOP_GNAT_MARKS;
    let gnats = 0;
    for (const enemy of state.enemies) {
      if (!enemy.hp || enemy.entry) continue;
      const tell = enemy.tell && state.tick < enemy.tell.until ? enemy.tell : undefined;
      if (enemy.kind === 'aegis') this.shield(enemy, plane ?? enemy.alt, tell?.kind === 'aegis', flat);
      if (enemy.maneuver?.phase === 'warning') {
        this.paint.setHex(SIGNAL_COLORS.dive);
        this.marker(enemy, flat ? plane + 4 : BANDS[enemy.maneuver.band], BLAST_CUE_RADIUS, flat);
        if (!flat) this.stroke(enemy.x, enemy.z, enemy.alt, enemy.x, enemy.z, BANDS[enemy.maneuver.band]);
      }
      if (!tell || tell.kind === 'aegis') continue;
      this.paint.setHex(SIGNAL_COLORS[tell.kind]);
      if (tell.kind === 'flak') {
        const start = tell.started ?? tell.until - ROSTER.flak.warningTicks;
        const progress = reducedMotion ? 1 : clamp((state.tick - start) / Math.max(1, tell.until - start), 0, 1);
        const burst = flat ? plane + 5 : tell.alt;
        const muzzle = flat ? plane + 2 : enemy.alt;
        this.marker(enemy, muzzle, 4.2 + progress * 2.4, flat);
        this.tracer(enemy, tell, flat ? plane + 3 : undefined, 7);
        this.marker(tell, burst, FLAK_RADIUS * (0.24 + progress * 0.76), flat);
        continue;
      }
      if (tell.kind === 'gnat' && ++gnats > gnatMarks) continue;
      const alt = flat ? plane + 4 : enemy.alt + (tell.kind === 'mine' ? -3 : 0);
      const radius = tell.kind === 'carrier' ? 11 : tell.kind === 'gnat' ? 3.5 : 8;
      this.marker(enemy, alt, radius, flat);
      if ('target' in tell && tell.target) this.tracer(enemy, tell.target, flat ? alt : undefined);
    }
  }

  private updateAce(state: StageState, plane: number | undefined, reducedMotion: boolean): void {
    const boss = state.boss;
    this.ace.visible = !!boss && !boss.crashed;
    if (!boss || !this.ace.visible) return;
    const alt = plane === undefined ? boss.alt : plane + 1;
    this.ace.position.set(boss.x, alt, -boss.z);
    this.ace.rotation.set(boss.pitch, -boss.yaw, boss.roll ? rollAttitude(boss.roll) : -boss.bank, 'YXZ');
    this.ace.material.color.setHex(boss.defeatedAt !== null ? 0xa39088 : boss.hitUntil > state.tick ? 0xfff0ac : 0xffffff);
    this.afterburner.visible = boss.boosting && boss.hp > 0;
    if (this.afterburner.visible) {
      const length = !reducedMotion && state.tick % 4 < 2 ? 9 : 11;
      const { position, rotation, scale } = this.transform;
      rotation.set(0, 0, 0);
      for (let i = 0; i < 4; i++) {
        const outer = i < 2, plume = outer ? length : length * 0.5;
        position.set(i % 2 ? 3.5 : -3.5, -0.25, 15 + plume / 2);
        scale.set(outer ? 2.3 : 1.5, outer ? 1.5 : 1.03, plume);
        this.transform.updateMatrix();
        this.afterburner.setMatrixAt(i, this.transform.matrix);
      }
      this.afterburner.instanceMatrix.needsUpdate = true;
    }
    const tell = boss.tell;
    if (tell && state.tick < tell.until) {
      this.paint.setHex(SIGNAL_COLORS[tell.kind]);
      this.marker(boss, alt + 1, tell.kind === 'roll' ? 20 : 18, plane !== undefined);
      if (tell.kind !== 'roll') this.tracer(boss, tell, plane === undefined ? undefined : alt + 2, tell.kind === 'gun' ? 6 : 10);
    }
  }

  update(state: StageState, plane: number | undefined, reducedMotion: boolean): void {
    this.vertices = 0;
    this.ringCount = 0;
    this.shieldCount = 0;
    this.regularSignals(state, plane, reducedMotion);
    this.updateAce(state, plane, reducedMotion);
    this.shields.count = this.shieldCount;
    this.shields.visible = this.shieldCount > 0;
    if (this.shieldCount > 0) this.shields.instanceMatrix.needsUpdate = true;
    this.rings.count = this.ringCount;
    this.rings.visible = this.ringCount > 0;
    if (this.ringCount > 0) this.rings.instanceMatrix.needsUpdate = this.rings.instanceColor!.needsUpdate = true;
    this.signal.geometry.setDrawRange(0, this.vertices);
    this.signal.visible = this.vertices > 0;
    if (!this.vertices) return;
    this.drawRange.count = this.vertices * 3;
    this.positions.clearUpdateRanges();
    this.colors.clearUpdateRanges();
    this.positions.updateRanges.push(this.drawRange);
    this.colors.updateRanges.push(this.drawRange);
    this.positions.needsUpdate = this.colors.needsUpdate = true;
  }
}
