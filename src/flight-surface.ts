import {
  Color, DataTexture, DoubleSide, DynamicDrawUsage, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  NearestFilter, Object3D, PlaneGeometry, Vector3, type BufferAttribute, type Camera, type InstancedBufferAttribute, type OrthographicCamera,
} from 'three';
import { FLIGHT_SURFACE, WING_TRAIL } from './data/flight-world.ts';
import { CRUISE_SPEED } from './flight.ts';
import { clamp, STEP } from './stage-combat.ts';
import type { Ground, StageState } from './stage-types.ts';
import { TERRAIN_SIZE } from './world.ts';

const TRAIL_STRIDE = 8;
const WAKE_STRIDE = 5;

export class WingtipRing {
  readonly points: Float32Array;
  count = 0;
  private cursor = 0;

  constructor() {
    this.points = new Float32Array(WING_TRAIL.capacity * TRAIL_STRIDE);
  }

  clear(): void { this.cursor = this.count = 0; }

  push(tick: number, left: Vector3, right: Vector3, width: number): void {
    const offset = this.cursor * TRAIL_STRIDE, points = this.points;
    points[offset] = left.x;
    points[offset + 1] = left.y;
    points[offset + 2] = left.z;
    points[offset + 3] = right.x;
    points[offset + 4] = right.y;
    points[offset + 5] = right.z;
    points[offset + 6] = width;
    points[offset + 7] = tick;
    this.cursor = (this.cursor + 1) % WING_TRAIL.capacity;
    this.count = Math.min(this.count + 1, WING_TRAIL.capacity);
  }

  offset(age: number): number {
    return ((this.cursor + WING_TRAIL.capacity - 1 - age) % WING_TRAIL.capacity) * TRAIL_STRIDE;
  }
}

function makeDynamicQuads(name: string, count: number, opacity: number): InstancedMesh<PlaneGeometry, MeshBasicMaterial> {
  const mesh = new InstancedMesh(new PlaneGeometry(), new MeshBasicMaterial({
    side: DoubleSide, transparent: true, depthWrite: false, forceSinglePass: true, opacity,
  }), count);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.setColorAt(0, new Color());
  mesh.instanceColor!.setUsage(DynamicDrawUsage);
  mesh.count = 0;
  return mesh;
}

function upload(attribute: InstancedBufferAttribute, range: { start: number; count: number }, count: number): void {
  attribute.clearUpdateRanges();
  range.count = count * attribute.itemSize;
  attribute.updateRanges.push(range);
  attribute.needsUpdate = true;
}

function shadowBlob(): Mesh<PlaneGeometry, MeshBasicMaterial> {
  const { textureSize, segments, color } = FLIGHT_SURFACE.shadow;
  const pixels = new Uint8Array(textureSize * textureSize * 4);
  for (let y = 0; y < textureSize; y++) for (let x = 0; x < textureSize; x++) {
    const radius = Math.hypot(x + 0.5 - textureSize / 2, y + 0.5 - textureSize / 2) * 2 / textureSize;
    const index = (y * textureSize + x) * 4;
    pixels[index] = pixels[index + 1] = pixels[index + 2] = 255;
    pixels[index + 3] = Math.round(Math.max(0, 1 - radius ** 1.8) * 7) * 36;
  }
  const texture = new DataTexture(pixels, textureSize, textureSize);
  texture.magFilter = texture.minFilter = NearestFilter;
  texture.needsUpdate = true;
  const geometry = new PlaneGeometry(1, 1, segments, segments).rotateX(-Math.PI / 2);
  (geometry.getAttribute('position') as BufferAttribute).setUsage(DynamicDrawUsage);
  const mesh = new Mesh(geometry, new MeshBasicMaterial({
    map: texture, color, depthWrite: false, transparent: true,
  }));
  mesh.name = 'Ship ground shadow';
  mesh.frustumCulled = false;
  return mesh;
}

export class FlightSurface {
  readonly group = new Group();
  trailSegments = 0;
  wakeMarks = 0;
  clearance = Infinity;
  private readonly ground: Ground;
  private readonly terrain?: Uint8Array;
  private readonly trail = new WingtipRing();
  private readonly ribbons = makeDynamicQuads('Wingtip ribbons', 2 * (WING_TRAIL.capacity - 1), WING_TRAIL.opacity);
  private readonly wake = makeDynamicQuads('Foam and dust', FLIGHT_SURFACE.wakeCapacity * 4, FLIGHT_SURFACE.wakeOpacity);
  private readonly shadow = shadowBlob();
  private readonly trailColors = WING_TRAIL.colors.map(hex => new Color(hex));
  private readonly foamColors = FLIGHT_SURFACE.foamColors.map(hex => new Color(hex));
  private readonly dustColors = FLIGHT_SURFACE.dustColors.map(hex => new Color(hex));
  private readonly trailMatrices = { start: 0, count: 0 };
  private readonly trailSwatches = { start: 0, count: 0 };
  private readonly wakeMatrices = { start: 0, count: 0 };
  private readonly wakeSwatches = { start: 0, count: 0 };
  private readonly left = new Vector3();
  private readonly right = new Vector3();
  private readonly center = new Vector3();
  private readonly eye = new Vector3();
  private readonly forward = new Vector3();
  private readonly side = new Vector3();
  private readonly normal = new Vector3();
  private readonly wakePose = new Object3D();
  private readonly ribbonMatrix = new Matrix4();
  private readonly wakePoints = new Float32Array(FLIGHT_SURFACE.wakeCapacity * WAKE_STRIDE);
  private readonly fixtureShip = new Object3D();
  private wakeCursor = 0;
  private wakeSize = 0;
  private lastTick = -Infinity;
  private lastTrailTick = -Infinity;
  private lastWakeTick = -Infinity;

  constructor(ground: Ground, terrain?: Uint8Array) {
    this.ground = ground;
    this.terrain = terrain;
    this.group.add(this.shadow, this.ribbons, this.wake);
  }

  private isWater(x: number, z: number): boolean {
    if (!this.terrain) return this.ground(x, z) < 40;
    const mask = TERRAIN_SIZE - 1;
    const texel = (((Math.floor(z) & mask) * TERRAIN_SIZE) + (Math.floor(x) & mask)) * 4;
    const red = this.terrain[texel], green = this.terrain[texel + 1], blue = this.terrain[texel + 2];
    return blue - red >= 20 && green - red >= 20;
  }

  private storeWings(ship: Object3D, tick: number, width: number, altitudeShift: number): void {
    const tip = WING_TRAIL.tip;
    ship.updateWorldMatrix(true, false);
    this.left.set(-tip.x, tip.y, tip.z).applyMatrix4(ship.matrixWorld);
    this.right.set(tip.x, tip.y, tip.z).applyMatrix4(ship.matrixWorld);
    this.left.y -= altitudeShift;
    this.right.y -= altitudeShift;
    this.trail.push(tick, this.left, this.right, width);
    this.lastTrailTick = tick;
  }

  private storeWake(x: number, z: number, yaw: number, tick: number): void {
    const i = this.wakeCursor * WAKE_STRIDE, points = this.wakePoints;
    points[i] = x;
    points[i + 1] = z;
    points[i + 2] = yaw;
    points[i + 3] = tick;
    points[i + 4] = Number(this.isWater(x, z));
    this.wakeCursor = (this.wakeCursor + 1) % FLIGHT_SURFACE.wakeCapacity;
    this.wakeSize = Math.min(this.wakeSize + 1, FLIGHT_SURFACE.wakeCapacity);
    this.lastWakeTick = tick;
  }

  private primeHistory(state: StageState, interval: number, wakeInterval: number, width: number, fixture?: string | null): void {
    const trailing = fixture === 'trails', lowFlight = fixture === 'low';
    if (!trailing && !lowFlight && fixture !== 'boost') return;
    const p = state.player, bankSide = Math.sign(p.bank) || 1;
    const cos = Math.cos(p.yaw), sin = Math.sin(p.yaw);
    const turnRate = trailing ? WING_TRAIL.fixtureTurnRate : lowFlight ? FLIGHT_SURFACE.fixture.turnRate : 0;
    const radius = turnRate ? state.speed / turnRate : 0;
    const gap = lowFlight ? wakeInterval : interval;
    const life = lowFlight ? FLIGHT_SURFACE.wakeLifeTicks : WING_TRAIL.lifeTicks;
    for (let age = Math.floor((life - 1) / gap) * gap; age > 0; age -= gap) {
      const turn = turnRate * age * STEP;
      const across = bankSide * radius * (1 - Math.cos(turn));
      const along = radius ? radius * Math.sin(turn) : state.speed * age * STEP;
      const x = p.x + cos * across - sin * along, z = p.z - sin * across - cos * along;
      const yaw = p.yaw - bankSide * turn;
      if (lowFlight) {
        this.storeWake(x, z, yaw, state.tick - age);
      } else {
        this.fixtureShip.position.set(x, p.altitude, -z);
        this.fixtureShip.rotation.set(0, -yaw, -p.bank, 'YXZ');
        this.storeWings(this.fixtureShip, state.tick - age, width, 0);
      }
    }
  }

  private drawRibbons(tick: number, camera: Camera, altitudeShift: number, interval: number, phone: boolean): void {
    const { points } = this.trail;
    const count = Math.min(this.trail.count, phone ? WING_TRAIL.phoneCapacity : WING_TRAIL.capacity);
    const orthographic = (camera as OrthographicCamera).isOrthographicCamera;
    if (orthographic) camera.getWorldDirection(this.eye).negate();
    let written = 0;
    for (let i = 0; i < count - 1; i++) {
      const current = this.trail.offset(i), previous = this.trail.offset(i + 1);
      const age = (tick - points[previous + 7]) / WING_TRAIL.lifeTicks;
      if (age >= 1) break;
      if (points[current + 7] - points[previous + 7] > interval * 3) continue;
      const tint = this.trailColors[Math.min(2, Math.floor(age * 3))];
      const width = points[current + 6] * (1 - 0.78 * age);
      for (let wing = 0; wing < 6; wing += 3) {
        const a = current + wing, b = previous + wing;
        this.left.fromArray(points, a);
        this.right.fromArray(points, b);
        this.center.copy(this.left).lerp(this.right, 0.5);
        this.center.y += altitudeShift;
        this.forward.copy(this.left).sub(this.right);
        const length = this.forward.length();
        if (length < 0.04 || length > 28) continue;
        this.forward.multiplyScalar(1 / length);
        if (!orthographic) this.eye.copy(camera.position).sub(this.center);
        this.side.crossVectors(this.forward, this.eye).normalize();
        this.normal.crossVectors(this.side, this.forward);
        this.ribbonMatrix.makeBasis(this.side.multiplyScalar(width),
          this.forward.multiplyScalar(length + 0.18), this.normal).setPosition(this.center);
        this.ribbons.setMatrixAt(written, this.ribbonMatrix);
        this.ribbons.setColorAt(written++, tint);
      }
    }
    this.trailSegments = this.ribbons.count = written;
    if (!written) return;
    upload(this.ribbons.instanceMatrix, this.trailMatrices, written);
    upload(this.ribbons.instanceColor!, this.trailSwatches, written);
  }

  private drawShadow(x: number, z: number, yaw: number, height: number): void {
    const shadow = FLIGHT_SURFACE.shadow;
    const spread = clamp(this.clearance / shadow.fullSpreadClearance, 0, 1);
    this.shadow.material.opacity = shadow.nearOpacity + spread * (shadow.farOpacity - shadow.nearOpacity);
    const across = shadow.width + shadow.extraWidth * spread, along = shadow.length + shadow.extraLength * spread;
    const cos = Math.cos(yaw), sin = Math.sin(yaw), vertices = this.shadow.geometry.getAttribute('position');
    this.shadow.position.set(x, height, -z);
    this.shadow.rotation.y = -yaw;
    this.shadow.scale.set(across, 1, along);
    for (let i = 0; i < vertices.count; i++) {
      const u = vertices.getX(i) * across, v = vertices.getZ(i) * along;
      const y = this.ground(x + u * cos - v * sin, z - u * sin - v * cos);
      vertices.setY(i, y - height + shadow.bias);
    }
    vertices.needsUpdate = true;
  }

  private drawWake(tick: number): void {
    let drawn = 0;
    const cap = FLIGHT_SURFACE.wakeCapacity;
    for (let i = 0; i < this.wakeSize; i++) {
      const index = ((this.wakeCursor + cap - 1 - i) % cap) * WAKE_STRIDE;
      const x = this.wakePoints[index], z = this.wakePoints[index + 1], yaw = this.wakePoints[index + 2];
      const age = tick - this.wakePoints[index + 3];
      if (age >= FLIGHT_SURFACE.wakeLifeTicks) break;
      const water = this.wakePoints[index + 4] > 0;
      const life = age / FLIGHT_SURFACE.wakeLifeTicks;
      const swatch = Math.min(2, Math.floor(life * 3));
      const sin = Math.sin(yaw), cos = Math.cos(yaw);
      for (let side = -1; side <= 1; side += 2) {
        const spread = side * (2.2 + 9 * life), back = 6 + 8 * life;
        const wx = x - sin * back + cos * spread, wz = z - cos * back - sin * spread;
        const height = this.ground(wx, wz);
        const width = (water ? FLIGHT_SURFACE.foamWidth : FLIGHT_SURFACE.dustWidth) * (1 - 0.66 * life);
        this.wakePose.position.set(wx, height + (water ? 0.16 : 0.55 + 4 * life), -wz);
        this.wakePose.rotation.set(water ? -Math.PI / 2 : -0.74, -yaw + side * 0.58, 0, 'YXZ');
        this.wakePose.scale.set(width, water ? 4.5 + life * 4 : width * 0.71, 1);
        this.wakePose.updateMatrix();
        this.wake.setMatrixAt(drawn, this.wakePose.matrix);
        this.wake.setColorAt(drawn++, (water ? this.foamColors : this.dustColors)[swatch]);
        if (age >= FLIGHT_SURFACE.sprayLifeTicks) continue;
        // The youngest marks throw pixel-sized spray or dust above the wash.
        this.wakePose.position.y += 1 + age * 0.18;
        this.wakePose.rotation.set(-0.61, -yaw, side * 0.29, 'YXZ');
        this.wakePose.scale.setScalar(water ? 0.83 : 1.32);
        this.wakePose.updateMatrix();
        this.wake.setMatrixAt(drawn, this.wakePose.matrix);
        this.wake.setColorAt(drawn++, water ? this.foamColors[0] : this.dustColors[0]);
      }
    }
    this.wakeMarks = this.wake.count = drawn;
    if (!drawn) return;
    upload(this.wake.instanceMatrix, this.wakeMatrices, drawn);
    upload(this.wake.instanceColor!, this.wakeSwatches, drawn);
  }

  update(state: StageState, ship: Object3D, camera: Camera, topAltitude: number | undefined,
    ticks: number, boost: number, phone: boolean, fixture?: string | null): void {
    const tier = phone ? 'phone' : 'desktop', p = state.player, tick = state.tick;
    const interval = WING_TRAIL.intervalTicks[tier], wakeInterval = FLIGHT_SURFACE.wakeInterval[tier];
    const wingWidth = WING_TRAIL.width + Math.abs(p.bank) * WING_TRAIL.bankWidth + boost * WING_TRAIL.boostWidth
      + (state.roll ? WING_TRAIL.rollWidth : 0);
    const externalShift = topAltitude === undefined ? 0 : topAltitude - p.altitude;
    const ground = this.ground(p.x, p.z);
    this.clearance = Math.max(0, p.altitude - ground);
    if (tick < this.lastTick || tick - this.lastTick > 60) {
      this.trail.clear();
      this.wakeCursor = this.wakeSize = 0;
      this.lastTrailTick = this.lastWakeTick = -Infinity;
      this.primeHistory(state, interval, wakeInterval, wingWidth, fixture);
    }
    const moving = (ticks > 0 || tick !== this.lastTick) && state.phase === 'playing' && !state.paused;
    if (moving && tick - this.lastTrailTick >= interval && (state.speed >= CRUISE_SPEED * WING_TRAIL.thresholdRatio || state.roll)) {
      this.storeWings(ship, tick, wingWidth, externalShift);
    }
    if (moving && tick - this.lastWakeTick >= wakeInterval && this.clearance < FLIGHT_SURFACE.clearance
      && state.speed >= CRUISE_SPEED * FLIGHT_SURFACE.wakeMinSpeedRatio) {
      this.storeWake(p.x, p.z, p.yaw, tick);
    }
    this.lastTick = tick;
    this.drawShadow(p.x, p.z, p.yaw, ground);
    this.drawRibbons(tick, camera, externalShift, interval, phone);
    this.drawWake(tick);
  }
}
