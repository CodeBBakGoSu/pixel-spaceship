import { BoxGeometry, Color, DynamicDrawUsage, Group, InstancedMesh, MeshBasicMaterial, Object3D, type Camera } from 'three';
import { FLARE_GRAVITY, FLARE_LIFE_TICKS, STEP } from './stage-combat.ts';
import type { Ace, Enemy, Flare, StageState } from './stage-types.ts';

// Fit three volleys, a burning fleet and the Ace.
const FIRE_LIMIT = 144;
const SMOKE_LIMIT = 256;
const SMOKE_SAMPLES = 8;
const SAMPLE_TICKS = 4;

type VoxelBatch = InstancedMesh<BoxGeometry, MeshBasicMaterial>;

function batch(geometry: BoxGeometry, material: MeshBasicMaterial, capacity: number, name: string): VoxelBatch {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.name = name;
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.setColorAt(0, new Color());
  mesh.instanceColor!.setUsage(DynamicDrawUsage);
  return mesh;
}

function upload(mesh: VoxelBatch): void {
  if (!mesh.count) return;
  for (const attribute of [mesh.instanceMatrix, mesh.instanceColor!]) {
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, mesh.count * attribute.itemSize);
    attribute.needsUpdate = true;
  }
}

export class FlareVisuals {
  readonly group = new Group();
  private readonly geometry = new BoxGeometry();
  private readonly fire = batch(this.geometry, new MeshBasicMaterial({ toneMapped: false }), FIRE_LIMIT, 'Flare embers');
  private readonly smoke = batch(this.geometry, new MeshBasicMaterial({
    transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false,
  }), SMOKE_LIMIT, 'Flare smoke');
  private readonly pose = new Object3D();
  private readonly color = new Color();
  private chaseView?: readonly number[];

  constructor() {
    this.group.add(this.fire, this.smoke);
  }

  update(state: StageState, topAltitude?: number, chaseCamera?: Camera): void {
    this.chaseView = chaseCamera?.matrixWorldInverse.elements;
    this.fire.count = this.smoke.count = 0;
    for (const flare of state.flares) this.drawFlare(flare, state.tick, topAltitude);
    for (const enemy of state.enemies) this.drawBurn(enemy, enemy.yaw, state.tick, topAltitude);
    // --- S7e lane ---
    const ace = state.boss;
    if (ace && !ace.crashed) this.drawBurn(ace, ace.yaw, state.tick, topAltitude);
    upload(this.fire);
    upload(this.smoke);
  }

  private voxel(mesh: VoxelBatch, x: number, z: number, alt: number, size: number, tint: number,
    yaw = 0, length = 1): void {
    const index = mesh.count;
    if (index >= mesh.instanceMatrix.count) return;
    if (this.chaseView) {
      // Keep near-camera fire and smoke from filling the main flight view.
      const m = this.chaseView;
      const depth = -(m[2] * x + m[6] * alt - m[10] * z + m[14]);
      size = Math.min(size, (depth - 5) * 0.16);
      if (size <= 0) return;
    }
    this.pose.position.set(x, alt, -z);
    this.pose.rotation.set(0, -yaw, 0);
    this.pose.scale.set(size, size, size * length);
    this.pose.updateMatrix();
    mesh.setMatrixAt(index, this.pose.matrix);
    mesh.setColorAt(index, this.color.setHex(tint));
    mesh.count++;
  }

  private drawFlare(flare: Flare, tick: number, topAltitude?: number): void {
    const { x, z, alt, born, vx, vz, vy } = flare;
    const age = tick - born;
    const heat = Math.max(0, 1 - age / (flare.lifeTicks ?? FLARE_LIFE_TICKS));
    const phoenix = flare.weapon === 'phoenix';
    const firebird = flare.phoenix;
    const yaw = Math.atan2(vx, vz), phase = born * 0.17 + yaw * 3;
    const size = (3 + 1.3 * heat) * (1 + 0.09 * Math.sin(tick * 0.7 + phase));
    const tint = firebird ? 0xffefc8 : heat > 0.2 ? (phoenix ? 0xffe1a0 : 0xfff3b2) : (phoenix ? 0xff985c : 0xffba5e);
    this.voxel(this.fire, x, z, topAltitude ?? alt, size, tint, yaw);
    const tail = 2.7 / Math.max(1, Math.hypot(vx, vz, vy));
    this.voxel(this.fire, x - vx * tail, z - vz * tail, topAltitude === undefined ? alt - vy * tail : topAltitude - 0.7,
      size * 0.96, firebird ? 0xff704e : phoenix ? 0xf75945 : 0xff8738, yaw, 1.23);

    const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
    if (firebird) {
      const flap = 0.75 + 0.25 * Math.sin(tick * 0.24);
      for (const side of [-1, 1]) {
        this.voxel(this.fire, x + rightX * side * size * flap, z + rightZ * side * size * flap, topAltitude ?? alt,
          size * 0.72, 0xffa44e, yaw - side * 0.78, 1.7);
      }
    }
    const firstDelay = SAMPLE_TICKS + age % SAMPLE_TICKS;
    for (let i = 0; i < SMOKE_SAMPLES; i++) {
      const delay = firstDelay + i * SAMPLE_TICKS;
      if (delay > age) break;
      const emission = (age - delay) / SAMPLE_TICKS;
      const seconds = delay * STEP;
      const drift = Math.sin(phase + emission * 2.37) * seconds * 6.5;
      // Retrace the flare's discrete gravity steps before letting the smoke rise.
      const priorVY = firebird ? vy : vy + FLARE_GRAVITY * STEP * (delay - 1) / 2;
      const y = topAltitude === undefined ? alt - priorVY * seconds + seconds * 5 : topAltitude - 3;
      const px = x - vx * seconds + rightX * drift, pz = z - vz * seconds + rightZ * drift;
      const puff = (2.15 + seconds * 7.2) * (0.7 + heat * 0.3);
      this.voxel(this.smoke, px, pz, y, puff, emission % 2 ? 0x6e6167 : 0x48505d, phase + emission * 0.64, 1.08);
      if (i === 1) {
        this.voxel(this.fire, px + rightX * 1.6, pz + rightZ * 1.6, topAltitude ?? y, size * 0.43, 0xffa443, yaw);
      }
    }
  }

  private drawBurn(target: Enemy | Ace, yaw: number, tick: number, topAltitude?: number): void {
    const { x, z, alt, id, vx, vz, burnUntil = 0 } = target;
    const falling = target.kind === 'ace' && target.defeatedAt !== null;
    if (!falling && (!target.hp || burnUntil <= tick)) return;
    const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
    const fade = falling ? 1 : Math.min(1, (burnUntil - tick) / 16);
    for (let i = 0; i < 3; i++) {
      const rise = ((tick + id * 7 + i * 7) % 21) / 21;
      const across = (i - 1) * (3.6 + rise);
      const y = topAltitude ?? (alt + 3.8 + rise * 7);
      const size = (4.4 - rise * 2) * (0.65 + fade * 0.35);
      this.voxel(this.fire, x + rightX * across - vx * rise * 0.12, z + rightZ * across - vz * rise * 0.12,
        y, size, rise < 0.3 ? 0xffe27f : rise < 0.67 ? 0xff9940 : 0xe45635, yaw + i * 0.4);
    }
    for (let i = 0; i < 4; i++) {
      const rise = ((tick + id * 11 + i * 9) % 36) / 36;
      const across = (i % 2 ? -1 : 1) * (1.9 + rise * 3.4);
      const y = topAltitude === undefined ? alt + 4.3 + rise * (falling ? 21 : 14) : topAltitude - 3;
      const size = (2.7 + rise * 4.6) * (0.55 + fade * 0.45);
      const wake = rise * (falling ? 0.72 : 0.42);
      this.voxel(this.smoke, x + rightX * across - vx * wake, z + rightZ * across - vz * wake,
        y, size, i % 2 ? 0x765e62 : 0x4a454d, yaw + i * 0.7);
    }
  }
}
