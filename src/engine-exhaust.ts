import {
  AdditiveBlending, Color, DataTexture, DoubleSide, DynamicDrawUsage, InstancedMesh,
  LinearFilter, MeshBasicMaterial, Object3D, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Quaternion,
  SRGBColorSpace, Vector3, type BufferAttribute, type Camera,
} from 'three';
import { CRUISE_SPEED, trailEnd } from './maneuvers.ts';
import { SHIP_HULL_UNIT } from './models.ts';
import { clamp } from './stage-combat.ts';
import type { StageState } from './stage-types.ts';

export { SHIP_BASE_VOXEL_SIZE as SHIP_VOXEL_SIZE } from './models.ts';
// The outer faces of the housings, measured in the hull's design grid.
const NOZZLE_X = 5.5 * SHIP_HULL_UNIT;
const NOZZLE_Y = -SHIP_HULL_UNIT;
const NOZZLE_Z = 18.5 * SHIP_HULL_UNIT - 0.04;
const GLOW_LOCATIONS = [0.2, 0.6];

function ribbonTextures(): [DataTexture, DataTexture] {
  const width = 24, height = 64;
  const body = new Uint8Array(width * height * 4), shock = new Uint8Array(body.length);
  const rim = [[153, 46, 33], [188, 53, 34], [161, 54, 63], [105, 53, 151], [79, 60, 173]];
  const shell = [[255, 173, 68], [255, 132, 46], [245, 90, 48], [155, 88, 230], [116, 102, 242]];
  const core = [[255, 250, 218], [255, 225, 126], [255, 175, 92], [194, 168, 255], [149, 163, 255]];
  for (let y = 0; y < height; y++) {
    const u = y / (height - 1);
    const band = u < 0.2 ? 0 : u < 0.43 ? 1 : u < 0.69 ? 2 : u < 0.88 ? 3 : 4;
    const rimWidth = Math.pow(1 - u, 0.69) * (0.83 + 0.43 * Math.sin(Math.PI * Math.min(1, u * 1.75)));
    const cell = Math.round((u - 0.23) / 0.18);
    const cellDistance = Math.abs(u - (0.23 + cell * 0.18)) / 0.065;
    for (let x = 0; x < width; x++) {
      const row = (y * width + x) * 4;
      const across = Math.abs((x + 0.5) * 2 / width - 1);
      if (across > rimWidth) continue;
      const radial = across / rimWidth;
      const swatch = radial > 0.79 ? rim[band] : radial < 0.44 ? core[band] : shell[band];
      body.set(swatch, row);
      body[row + 3] = 255;

      const diamond = cellDistance + radial / 0.75;
      if (cell < 0 || cell > 3 || diamond > 1) continue;
      shock[row] = cell < 2 ? 255 : 163;
      shock[row + 1] = cell < 2 ? 230 : 177;
      shock[row + 2] = cell < 2 ? 169 : 255;
      shock[row + 3] = diamond < 0.45 ? 208 : 112;
    }
  }
  const plume = new DataTexture(body, width, height), diamonds = new DataTexture(shock, width, height);
  for (const tex of [plume, diamonds]) {
    tex.colorSpace = SRGBColorSpace;
    tex.needsUpdate = true;
  }
  return [plume, diamonds];
}

function haloTexture(): DataTexture {
  const size = 32, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const distance = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) * 2 / size;
    const row = (y * size + x) * 4;
    pixels[row] = pixels[row + 1] = pixels[row + 2] = 255;
    pixels[row + 3] = Math.round(Math.max(0, 1 - distance) ** 2.4 * 255);
  }
  const texture = new DataTexture(pixels, size, size);
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** The two nozzles share a cutout ribbon, additive shock cells and four soft glow quads. */
export class EngineExhaust {
  private readonly ship: Object3D;
  private readonly ribbon = new PlaneGeometry(1, 1, 1, 12).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  private readonly vertices = (this.ribbon.getAttribute('position') as BufferAttribute).setUsage(DynamicDrawUsage);
  private readonly plumes: InstancedMesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly diamonds: InstancedMesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly halos: InstancedMesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly pose = new Object3D();
  private readonly tint = new Color();
  private readonly eye = new Vector3();
  private readonly inverseShip = new Quaternion();
  private readonly billboard = new Quaternion();

  constructor(ship: Object3D) {
    this.ship = ship;
    const [plume, diamonds] = ribbonTextures();
    const additive = { blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false };
    this.plumes = new InstancedMesh(this.ribbon, new MeshBasicMaterial({ map: plume, side: DoubleSide, alphaTest: 0.5 }), 2);
    this.diamonds = new InstancedMesh(this.ribbon, new MeshBasicMaterial({
      ...additive, map: diamonds, side: DoubleSide, forceSinglePass: true,
    }), 2);
    this.halos = new InstancedMesh(new PlaneGeometry(), new MeshBasicMaterial({ ...additive, map: haloTexture() }), 4);
    this.plumes.name = 'Engine plumes';
    this.diamonds.name = 'Shock diamonds';
    this.halos.name = 'Engine halos';
    for (const mesh of [this.plumes, this.diamonds, this.halos]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      ship.add(mesh);
    }
    this.plumes.setColorAt(0, this.tint);
    this.halos.setColorAt(0, this.tint);
    this.plumes.instanceColor!.setUsage(DynamicDrawUsage);
    this.halos.instanceColor!.setUsage(DynamicDrawUsage);
    this.diamonds.visible = false;
  }

  update(state: StageState, camera: Camera): void {
    if (!this.ship.visible) return;
    const time = state.tick;
    const cruise = clamp(Math.hypot(state.speed, state.climbRate) / CRUISE_SPEED, 0, 1);
    const boost = Number(state.boosting);
    const trail = state.maneuverTrail;
    const turnAge = trail?.kind === 'j-turn' ? time - trailEnd(trail) : -1;
    const turnPulse = turnAge >= 0 ? Math.max(0, 1 - turnAge / 17) : 0;
    // In wide CHASE the camera is closer to the tail, so the same world-space plume projects longer.
    const chaseForeshortening = camera instanceof PerspectiveCamera ? clamp((camera.aspect - 0.75) / 0.65, 0, 1) : 0;
    const extension = Math.max((11.7 - 6.1 * chaseForeshortening) * boost, 6.2 * turnPulse);
    const length = 3.1 + 5.3 * cruise + extension;
    const width = 2.5 + 1.45 * cruise + 0.95 * boost + 0.8 * turnPulse;
    const brightness = 0.73 + 0.27 * cruise + 0.18 * boost + 0.16 * turnPulse;

    this.inverseShip.copy(this.ship.quaternion).invert();
    if (camera instanceof OrthographicCamera) camera.getWorldDirection(this.eye).negate();
    else this.eye.copy(camera.position).sub(this.ship.position);
    this.eye.applyQuaternion(this.inverseShip);
    const roll = Math.atan2(-this.eye.x, this.eye.y);
    this.billboard.copy(this.inverseShip).multiply(camera.quaternion);

    for (let i = 0; i < this.vertices.count; i++) {
      const u = this.vertices.getZ(i);
      const sway = (0.071 * Math.sin(time * 0.44 - u * 15) + 0.034 * Math.sin(time * 0.81 - u * 26)) * u;
      this.vertices.setX(i, (i % 2 === 0 ? -0.5 : 0.5) + sway);
    }
    this.vertices.needsUpdate = true;
    this.diamonds.visible = boost > 0 || turnPulse > 0.1;
    this.diamonds.material.opacity = Math.min(1, 0.83 * boost + 0.39 * turnPulse);
    this.halos.material.opacity = 0.39 + 0.24 * cruise + 0.19 * boost + 0.13 * turnPulse;

    for (let i = 0; i < 2; i++) {
      const x = (i === 0 ? -1 : 1) * NOZZLE_X;
      const flicker = 1 + 0.075 * Math.sin(time * 0.67 + 1.8 * i) + 0.033 * Math.sin(time * 1.33 - 2 * i);
      const jetLength = length * flicker;
      this.pose.position.set(x, NOZZLE_Y, NOZZLE_Z);
      this.pose.rotation.set(0, 0, roll);
      this.pose.scale.set(width * flicker, 1, jetLength);
      this.pose.updateMatrix();
      this.plumes.setMatrixAt(i, this.pose.matrix);
      this.plumes.setColorAt(i, this.tint.setScalar(brightness * flicker));
      if (this.diamonds.visible) this.diamonds.setMatrixAt(i, this.pose.matrix);
      for (let j = 0; j < GLOW_LOCATIONS.length; j++) {
        const u = GLOW_LOCATIONS[j];
        const size = (4.9 + 2.9 * cruise + 3.7 * boost + 2.6 * turnPulse) * flicker * (1 - u * 0.54);
        this.pose.position.set(x, NOZZLE_Y, NOZZLE_Z + u * jetLength);
        this.pose.quaternion.copy(this.billboard);
        this.pose.scale.set(size, size, 1);
        this.pose.updateMatrix();
        const index = i * GLOW_LOCATIONS.length + j;
        this.halos.setMatrixAt(index, this.pose.matrix);
        this.halos.setColorAt(index, this.tint.setHex(j === 0 ? 0xff8939 : boost ? 0xa276ff : 0xff6746));
      }
    }
    this.plumes.instanceMatrix.needsUpdate = true;
    this.plumes.instanceColor!.needsUpdate = true;
    this.diamonds.instanceMatrix.needsUpdate = this.diamonds.visible;
    this.halos.instanceMatrix.needsUpdate = true;
    this.halos.instanceColor!.needsUpdate = true;
  }
}
