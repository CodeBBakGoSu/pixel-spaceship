import { BoxGeometry, Color, DynamicDrawUsage, Group, InstancedMesh, MeshBasicMaterial, Object3D, type PerspectiveCamera } from 'three';
import { CRUISE_SPEED, BOOST_SPEED } from './flight.ts';
import { BANDS, clamp, STEP } from './stage-combat.ts';

const cloudShape = [[-13, 3, 27, 8], [3, -6, 36, 13], [22, 2, 26, 10], [-3, 9, 30, 9]];
const cloudPatches = 22;
const windCapacity = 32;

export class FlightAtmosphere {
  readonly group = new Group();
  private readonly pose = new Object3D();
  private readonly wind = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial({
    color: 0xc1e6e5, transparent: true, opacity: 0.48, depthWrite: false,
  }), windCapacity);
  private travel = 0;

  constructor(arena: { x: number; z: number; radius: number }) {
    const clouds = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial({
      transparent: true, opacity: 0.29, depthWrite: false,
    }), 2 * cloudPatches * cloudShape.length);
    const tint = new Color();
    for (let band = 0; band < 2; band++) {
      const altitude = (BANDS[band] + BANDS[band + 1]) / 2;
      for (let i = 0; i < cloudPatches; i++) {
        const angle = (i + band * 0.4) * 2.39996;
        const radius = Math.sqrt((i + 0.42) / cloudPatches) * (arena.radius + 55);
        const x = arena.x + Math.sin(angle) * radius, z = -arena.z + Math.cos(angle) * radius;
        this.pose.rotation.y = angle * 0.32;
        for (const [block, [dx, dz, width, depth]] of cloudShape.entries()) {
          const spread = 0.88 + (i % 5) * 0.08;
          const id = (band * cloudPatches + i) * cloudShape.length + block;
          this.pose.position.set(x + dx * spread, altitude + (block % 2) * 0.7, z + dz * spread);
          this.pose.scale.set(width * spread, 1.1 + block * 0.42, depth * spread);
          this.pose.updateMatrix();
          clouds.setMatrixAt(id, this.pose.matrix);
          clouds.setColorAt(id, tint.setHex(band === 0 ? 0xbadce3 : 0xeaf3e6).multiplyScalar(0.9 + block * 0.07));
        }
      }
    }
    this.wind.instanceMatrix.setUsage(DynamicDrawUsage);
    this.wind.frustumCulled = false;
    this.wind.count = 0;
    this.group.add(clouds, this.wind);
  }

  update(camera: PerspectiveCamera | null, speed: number, ticks: number, reduceMotion: boolean): number {
    this.group.visible = !!camera;
    this.wind.count = 0;
    if (!camera || reduceMotion || speed < CRUISE_SPEED * 0.7) return 0;

    const rush = clamp((speed - CRUISE_SPEED) / (BOOST_SPEED - CRUISE_SPEED), 0, 1);
    const count = 12 + Math.round(20 * rush), height = Math.tan(camera.fov * Math.PI / 360);
    this.travel = (this.travel + speed * 1.8 * ticks * STEP) % 156;
    this.wind.material.opacity = 0.25 + 0.38 * rush;
    for (let i = 0; i < count; i++) {
      const distance = 16 + ((i * 31.43 + 156 - this.travel) % 156);
      const along = distance * height, side = i % 2 ? -1 : 1;
      const across = side * (0.65 + (i % 5) * 0.067) * along * camera.aspect;
      const vertical = Math.sin(i * 2.39996) * along * 0.76;
      this.pose.position.set(across, vertical, -distance).applyMatrix4(camera.matrixWorld);
      // The near end runs outward along the same radial path as the air rushes past.
      this.pose.quaternion.copy(camera.quaternion);
      this.pose.rotateY(-Math.atan2(across, distance) * 0.56);
      this.pose.rotateX(Math.atan2(vertical, distance) * 0.56);
      const width = 0.17 + 0.3 * rush;
      this.pose.scale.set(width, width, 2.2 + 10.5 * rush);
      this.pose.updateMatrix();
      this.wind.setMatrixAt(i, this.pose.matrix);
    }
    this.wind.count = count;
    this.wind.instanceMatrix.clearUpdateRanges();
    this.wind.instanceMatrix.addUpdateRange(0, count * 16);
    this.wind.instanceMatrix.needsUpdate = true;
    return count;
  }
}
