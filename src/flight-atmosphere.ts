import { BoxGeometry, Color, DynamicDrawUsage, Group, InstancedMesh, MeshBasicMaterial, Object3D, type PerspectiveCamera } from 'three';
import { CLOUDS, WIND } from './data/flight-world.ts';
import { scaleTravel } from './data/speed.ts';
import { CRUISE_SPEED, BOOST_SPEED } from './flight.ts';
import { BANDS, clamp, STEP } from './stage-combat.ts';
import type { StageState } from './stage-types.ts';

type Arena = StageState['arena'];
type CloudPatch = ReturnType<typeof cloudPatch>;

function cloudPatch(arena: Arena, band: number, index: number, count: number = CLOUDS.patchesPerBand) {
  const angle = (index + band * 0.4) * 2.39996;
  const radius = Math.sqrt((index + 0.42) / count) * (arena.radius + CLOUDS.extraRadius);
  const yaw = angle * 0.32;
  return {
    x: arena.x + Math.sin(angle) * radius, z: arena.z - Math.cos(angle) * radius,
    altitude: BANDS[band], yaw, cos: Math.cos(yaw), sin: Math.sin(yaw), scale: scaleTravel(0.8 + (index % 5) * 0.10),
  };
}

export const cloudFixturePoint = (arena: Arena) => cloudPatch(arena, 1, CLOUDS.fixtureIndex);

function containsCloud(patch: CloudPatch, x: number, z: number, altitude: number): boolean {
  const rise = altitude - patch.altitude, dx = x - patch.x, dz = z - patch.z;
  if (Math.abs(rise) > 5 || dx * dx + dz * dz > CLOUDS.checkRadius ** 2) return false;
  const localX = (dx * patch.cos - dz * patch.sin) / patch.scale;
  const localZ = (dx * patch.sin + dz * patch.cos) / patch.scale;
  for (const block of CLOUDS.blocks) {
    if (Math.abs(localX - block[0]) <= block[3] / 2 && Math.abs(localZ - block[2]) <= block[5] / 2
      && Math.abs(rise - block[1]) <= block[4] / 2) return true;
  }
  return false;
}

export class FlightAtmosphere {
  readonly group = new Group();
  readonly wind = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial({
    color: 0xc1e6e5, transparent: true, opacity: 0.48, depthWrite: false,
  }), WIND.capacity);
  cloudFlash = 0;
  cloudPass = 0;
  private readonly pose = new Object3D();
  private readonly patches: CloudPatch[] = [];
  private readonly windRange = { start: 0, count: 0 };
  private readonly enabled: boolean;
  private travel = 0;
  private inside = false;
  private passAt = -Infinity;

  constructor(arena: Arena, enabled = true) {
    this.enabled = enabled;
    this.group.add(enabled ? this.makeClouds(arena) : this.makeLegacyClouds(arena), this.wind);
    this.wind.instanceMatrix.setUsage(DynamicDrawUsage);
    this.wind.frustumCulled = false;
    this.wind.count = 0;
  }

  private makeClouds(arena: Arena): InstancedMesh {
    const clouds = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial({
      transparent: true, opacity: CLOUDS.opacity, depthWrite: false,
    }), BANDS.length * CLOUDS.patchesPerBand * CLOUDS.blocks.length);
    clouds.name = 'Altitude-band cloud patches';
    const tint = new Color();
    let meshIndex = 0;
    for (let band = 0; band < BANDS.length; band++) for (let i = 0; i < CLOUDS.patchesPerBand; i++) {
      const patch = cloudPatch(arena, band, i);
      this.patches.push(patch);
      this.pose.rotation.set(0, -patch.yaw, 0);
      for (let block = 0; block < CLOUDS.blocks.length; block++) {
        const [dx, dy, dz, width, height, depth] = CLOUDS.blocks[block];
        const { cos, sin, scale } = patch;
        this.pose.position.set(patch.x + scale * (dx * cos + dz * sin), patch.altitude + dy,
          -patch.z + scale * (dx * sin - dz * cos));
        this.pose.scale.set(width * scale, height, depth * scale);
        this.pose.updateMatrix();
        clouds.setMatrixAt(meshIndex, this.pose.matrix);
        clouds.setColorAt(meshIndex++, tint.setHex(CLOUDS.colors[band]).multiplyScalar(0.86 + 0.035 * block));
      }
    }
    return clouds;
  }

  private makeLegacyClouds(arena: Arena): InstancedMesh {
    const blocks = [[-13, 3, 27, 8], [3, -6, 36, 13], [22, 2, 26, 10], [-3, 9, 30, 9]];
    const count = 22;
    const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial({
      transparent: true, opacity: 0.29, depthWrite: false,
    }), 2 * count * blocks.length);
    const tint = new Color();
    let meshIndex = 0;
    for (let band = 0; band < 2; band++) for (let i = 0; i < count; i++) {
      const patch = cloudPatch(arena, band, i, count);
      const altitude = (BANDS[band] + BANDS[band + 1]) / 2;
      this.pose.rotation.set(0, patch.yaw, 0);
      for (let block = 0; block < blocks.length; block++) {
        const [dx, dz, width, depth] = blocks[block], spread = 0.88 + (i % 5) * 0.08;
        this.pose.position.set(patch.x + dx * spread, altitude + (block % 2) * 0.7, -patch.z + dz * spread);
        this.pose.scale.set(width * spread, 1.1 + block * 0.42, depth * spread);
        this.pose.updateMatrix();
        mesh.setMatrixAt(meshIndex, this.pose.matrix);
        mesh.setColorAt(meshIndex++, tint.setHex(band === 0 ? 0xbadce3 : 0xeaf3e6).multiplyScalar(0.9 + block * 0.07));
      }
    }
    return mesh;
  }

  private updateClouds(state: StageState, reduceMotion: boolean): void {
    if (state.tick < this.passAt) {
      this.inside = false;
      this.passAt = -Infinity;
    }
    const p = state.player;
    let inside = false;
    for (const patch of this.patches) {
      if (containsCloud(patch, p.x, p.z, p.altitude)) {
        inside = true;
        break;
      }
    }
    if (inside && !this.inside && state.tick - this.passAt >= CLOUDS.reentryTicks && state.phase === 'playing') {
      this.cloudPass++;
      this.passAt = state.tick;
    }
    this.inside = inside;
    const flash = Math.max(0, 1 - (state.tick - this.passAt) / CLOUDS.flashTicks);
    this.cloudFlash = flash * flash * (reduceMotion ? 0.26 : 1);
  }

  update(camera: PerspectiveCamera | null, state: StageState, ticks: number, reduceMotion: boolean,
    boost: number, phone: boolean, fixture?: string | null): number {
    this.group.visible = this.enabled || !!camera;
    if (this.enabled) this.updateClouds(state, reduceMotion);
    this.wind.count = 0;
    const speed = state.speed;
    if (!camera || reduceMotion || speed < CRUISE_SPEED * WIND.minimumSpeedRatio) return 0;

    const speedRush = clamp((speed - CRUISE_SPEED) / (BOOST_SPEED - CRUISE_SPEED), 0, 1);
    const rush = this.enabled ? Math.max(boost, speedRush * 0.6) : speedRush;
    const extra = !this.enabled ? 20 : phone ? WIND.boostCount.phone : WIND.boostCount.desktop;
    const count = WIND.idleCount + Math.round(extra * rush);
    const height = Math.tan(camera.fov * Math.PI / 360);
    const repeat = WIND.repeatDistance;
    const travel = (this.travel + speed * 1.8 * ticks * STEP) % repeat;
    this.travel = fixture === 'boost' && this.travel === 0 ? repeat * 0.34 : travel;
    this.wind.material.opacity = 0.25 + 0.38 * rush;
    for (let i = 0; i < count; i++) {
      const distance = WIND.nearDistance + ((i * WIND.spacing + repeat - this.travel) % repeat);
      const along = distance * height, side = i % 2 ? -1 : 1;
      const across = side * (0.65 + (i % 5) * 0.067) * along * camera.aspect;
      const vertical = Math.sin(i * 2.39996) * along * 0.76;
      this.pose.position.set(across, vertical, -distance).applyMatrix4(camera.matrixWorld);
      // The near end runs outward along the same radial path as the air rushes past.
      this.pose.quaternion.copy(camera.quaternion);
      this.pose.rotateY(-Math.atan2(across, distance) * 0.56);
      this.pose.rotateX(Math.atan2(vertical, distance) * 0.56);
      const width = scaleTravel(0.17 + 0.3 * rush);
      this.pose.scale.set(width, width, WIND.baseLength + (this.enabled ? WIND.boostLength : WIND.legacyBoostLength) * rush);
      this.pose.updateMatrix();
      this.wind.setMatrixAt(i, this.pose.matrix);
    }
    this.wind.count = count;
    this.windRange.count = count * this.wind.instanceMatrix.itemSize;
    this.wind.instanceMatrix.clearUpdateRanges();
    this.wind.instanceMatrix.updateRanges.push(this.windRange);
    this.wind.instanceMatrix.needsUpdate = true;
    return count;
  }
}
