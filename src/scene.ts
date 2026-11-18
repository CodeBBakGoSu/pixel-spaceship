import {
  BoxGeometry, CircleGeometry, Color, DataTexture, DynamicDrawUsage, Fog, InstancedBufferAttribute, InstancedMesh, Object3D,
  Mesh, MeshBasicMaterial, NearestFilter, OrthographicCamera, PerspectiveCamera, PlaneGeometry,
  RepeatWrapping, Scene, SRGBColorSpace, TorusGeometry, Vector3, WebGLRenderer, WebGLRenderTarget,
  type BufferGeometry, type Camera,
} from 'three';
import { droneFaces, dronePalette, shipFaces, shipPalette } from '../proto/shared/models.ts';
import { bakeVoxels } from '../proto/three/src/voxel-geometry.ts';
import { cockpitFov, frameCockpit, type PitchMark } from './camera.ts';
import { ENEMY_KINDS, NEW_ENEMY_KINDS, type EnemyKind } from './enemy-kinds.ts';
import { EngineExhaust, SHIP_VOXEL_SIZE } from './engine-exhaust.ts';
import type { CockpitLayout, PhoneLayout } from './layout.ts';
import { MANEUVERS, maneuverAttitude } from './maneuvers.ts';
import { enemyAirframe, wardenFaces, wardenPalette } from './models.ts';
import { activeWeakPoint, BOMB_BLAST_RADIUS, clamp, MAX_BOMBS, SHOT_LIMIT } from './stage-combat.ts';
import type { Position, StageState } from './stage-types.ts';
import { terrainFogFar, TERRAIN_HALF_WIDTH, TERRAIN_MESH_STEP, TERRAIN_SIZE, World } from './world.ts';

function makeTerrain(world: World): Mesh {
  const map = new DataTexture(world.texture, TERRAIN_SIZE, TERRAIN_SIZE);
  map.colorSpace = SRGBColorSpace;
  map.magFilter = map.minFilter = NearestFilter;
  map.wrapS = map.wrapT = RepeatWrapping;
  map.needsUpdate = true;
  const size = 2 * TERRAIN_HALF_WIDTH, cells = size / TERRAIN_MESH_STEP;
  const geometry = new PlaneGeometry(size, size, cells, cells).rotateX(-Math.PI / 2);
  const { position, uv } = geometry.attributes;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = -position.getZ(i);
    position.setY(i, world.height(x, z));
    uv.setXY(i, x / TERRAIN_SIZE, z / TERRAIN_SIZE);
  }
  return new Mesh(geometry, new MeshBasicMaterial({ map }));
}

function instances(geometry: BufferGeometry, capacity: number, material = new MeshBasicMaterial()): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

function upload(mesh: InstancedMesh, count: number): void {
  mesh.count = count;
  if (!count) return;
  mesh.instanceMatrix.clearUpdateRanges();
  mesh.instanceMatrix.addUpdateRange(0, count * 16);
  mesh.instanceMatrix.needsUpdate = true;
  const colors = mesh.instanceColor;
  if (colors) {
    colors.clearUpdateRanges();
    colors.addUpdateRange(0, count * 3);
    colors.needsUpdate = true;
  }
}

type Projection = { x: number; y: number };
type Framing = {
  width: number;
  height: number;
  phone: PhoneLayout | null;
  cockpit: CockpitLayout | null;
};

export class FlightScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly fog = new Fog(0x9cbfcc, 245, 875);
  private readonly screen = new Scene();
  private readonly screenCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 2);
  private readonly target = new WebGLRenderTarget(1, 1, { magFilter: NearestFilter, minFilter: NearestFilter });
  private readonly top = new OrthographicCamera(-1, 1, 1, -1, 0.5, 1200);
  private readonly chase = new PerspectiveCamera(59, 1, 0.8, 1060);
  private readonly cockpit = new PerspectiveCamera(60, 1, 0.65, 1060);
  private camera: Camera = this.top;
  private framing: Framing = { width: 0, height: 0, phone: null, cockpit: null };
  private readonly voxelMaterial = new MeshBasicMaterial({ vertexColors: true });
  private readonly ship = new Mesh(bakeVoxels(shipFaces(), shipPalette, SHIP_VOXEL_SIZE), this.voxelMaterial);
  private readonly exhaust = new EngineExhaust(this.ship);
  private readonly drones = instances(bakeVoxels(droneFaces(), dronePalette, 0.84), ENEMY_KINDS.patrol.cap, this.voxelMaterial);
  private readonly airframes = NEW_ENEMY_KINDS.map(kind => {
    const { faces, palette, size } = enemyAirframe(kind);
    return { kind, mesh: instances(bakeVoxels(faces, palette, size), ENEMY_KINDS[kind].cap, this.voxelMaterial), count: 0 };
  });
  private readonly airframeByKind = new Map<EnemyKind, (typeof this.airframes)[number]>(this.airframes.map(batch => [batch.kind, batch]));
  private readonly warden = new Mesh(bakeVoxels(wardenFaces(), wardenPalette, 0.65), this.voxelMaterial);
  private readonly weakPoints = instances(new BoxGeometry(), 10);
  private readonly pickups = instances(new BoxGeometry(), 80);
  private readonly bullets = instances(new BoxGeometry(), SHOT_LIMIT);
  private readonly sparks = instances(new BoxGeometry(), 240);
  private readonly shadows = instances(new CircleGeometry(1, 10).rotateX(-Math.PI / 2), 26,
    new MeshBasicMaterial({ color: 0x051f21, opacity: 0.31, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  private readonly bombs = instances(new BoxGeometry(), MAX_BOMBS);
  private readonly blast = instances(new TorusGeometry(1, 0.03, 4, 48).rotateX(-Math.PI / 2), MAX_BOMBS,
    new MeshBasicMaterial({ color: 0xffb957 }));
  private readonly dummy = new Object3D();
  private readonly color = new Color();
  private readonly vector = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly ground = (x: number, z: number) => this.world.height(x, z);

  constructor(canvas: HTMLCanvasElement, private readonly world: World, arena: StageState['arena']) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x081424);
    this.scene.background = this.fog.color;
    this.scene.fog = this.fog;
    this.scene.add(makeTerrain(world), this.makeCanopies(arena), this.makeBoundary(arena));
    this.scene.add(this.ship, this.drones, this.warden, this.weakPoints, this.pickups, this.bullets, this.sparks,
      this.shadows, this.bombs, this.blast);
    for (const { mesh } of this.airframes) this.scene.add(mesh);
    this.top.up.set(0, 0, -1);
    this.screenCamera.position.z = 1;
    this.screen.add(new Mesh(new PlaneGeometry(2, 2), new MeshBasicMaterial({
      map: this.target.texture, depthTest: false, depthWrite: false, toneMapped: false,
    })));
  }

  private makeBoundary(arena: StageState['arena']): InstancedMesh {
    const count = 192;
    const edge = instances(new BoxGeometry(), count, new MeshBasicMaterial({ color: 0xa99c68 }));
    for (let i = 0; i < count; i++) {
      const a = Math.PI * 2 * i / count;
      const x = arena.x + Math.sin(a) * arena.radius, z = arena.z + Math.cos(a) * arena.radius;
      this.write(edge, i, x, z, this.world.height(x, z) + 0.38, a, 6, 0.8, 1.25);
    }
    upload(edge, count);
    return edge;
  }

  private makeCanopies(arena: StageState['arena']): InstancedMesh {
    const trees = instances(new BoxGeometry(), 1600);
    const step = 29, reach = arena.radius + 100, cells = Math.ceil(reach / step);
    let count = 0;
    canopyRows: for (let row = -cells; row <= cells; row++) for (let col = -cells; col <= cells; col++) {
      if (Math.hypot(row, col) * step > reach) continue;
      const hash = Math.imul(row + 47, 374761393) ^ Math.imul(col + 61, 668265263);
      if ((hash & 15) > 8) continue;
      const x = arena.x + col * step + ((hash >>> 4) & 7);
      const z = arena.z + row * step + ((hash >>> 7) & 7);
      const y = this.world.height(x, z);
      if (y < 42 || y > 85) continue;
      const size = 2.8 + ((hash >>> 10) & 3) * 0.6;
      this.write(trees, count++, x, z, y + size * 0.55, 0, size * 2, size * 1.1, size * 1.7,
        hash & 1 ? 0x2b623f : 0x3b7149);
      this.write(trees, count++, x, z, y + size * 1.38, 0, size * 1.2, size * 0.65, size * 1.1,
        hash & 1 ? 0x477e4e : 0x5f8e55);
      if (count >= trees.instanceMatrix.count) break canopyRows;
    }
    upload(trees, count);
    return trees;
  }

  resize(framing: Framing): void {
    const { width, height, phone } = framing;
    this.framing = framing;
    const buffer = phone?.buffer ?? { width: Math.ceil(width / 4), height: Math.ceil(height / 4) };
    const w = Math.max(1, buffer.width), h = Math.max(1, buffer.height);
    if (this.target.width === w && this.target.height === h) return;
    this.target.setSize(w, h);
    // Keep the back buffer the same size as the target. The canvas presents it
    // with CSS nearest-neighbor scaling, including on high-DPR phones.
    this.renderer.setSize(w, h, false);
  }

  private write(mesh: InstancedMesh, index: number, x: number, z: number, alt: number, yaw: number,
    sx: number, sy: number, sz: number, tint?: number, roll = 0, pitch = 0): void {
    this.dummy.position.set(x, alt, -z);
    this.dummy.rotation.set(pitch, -yaw, roll, 'YXZ');
    this.dummy.scale.set(sx, sy, sz);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
    if (tint !== undefined) mesh.setColorAt(index, this.color.setHex(tint));
  }

  private connect(mesh: InstancedMesh, index: number, from: Position, to: Position): void {
    const vector = this.vector.set(to.x - from.x, to.alt - from.alt, from.z - to.z);
    const length = vector.length();
    this.dummy.position.set((from.x + to.x) / 2, (from.alt + to.alt) / 2, -(from.z + to.z) / 2);
    this.dummy.scale.set(1.8, length, 1.8);
    this.dummy.quaternion.setFromUnitVectors(this.up, vector.normalize());
    this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
    mesh.setColorAt(index, this.color.setHex(0x607887));
  }

  private writeShadow(index: number, x: number, z: number, sx: number, sz: number, yaw: number): void {
    this.write(this.shadows, index, x, z, this.ground(x, z) + 0.9, yaw, sx, 1, sz);
  }

  private updateCamera(state: StageState, attitude: ReturnType<typeof maneuverAttitude> | null): PitchMark[] {
    const { width, height, phone } = this.framing;
    const p = state.player, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const aspect = width / Math.max(1, height);
    if (state.view === 'overhead') {
      this.fog.far = 875;
      const halfHeight = Math.max(127, (phone ? 105 : 125) / aspect);
      const center = phone ? phone.shipY / height : 0.57;
      const z = p.z + (center * 2 - 1) * halfHeight;
      this.top.left = -halfHeight * aspect;
      this.top.right = halfHeight * aspect;
      this.top.top = halfHeight;
      this.top.bottom = -halfHeight;
      this.top.position.set(p.x, 290, -z);
      this.top.lookAt(p.x, 0, -z);
      this.top.updateProjectionMatrix();
      this.camera = this.top;
    } else if (state.view === 'cockpit') {
      this.camera = this.cockpit;
      const pitch = attitude?.cameraPitch ?? 0;
      this.fog.far = terrainFogFar(aspect, cockpitFov(aspect, pitch), pitch, attitude?.cameraBank);
      // The last ~5% of terrain contrast blends into the sky under Three's smoothstep fog.
      const visibleDepth = this.fog.near + (this.fog.far - this.fog.near) * 0.865;
      return frameCockpit(this.cockpit, p, this.framing, attitude, this.ground, visibleDepth);
    } else {
      const camera = this.chase;
      const field = phone?.playfield;
      const m = state.maneuver;
      const motion = m ? Math.sin(Math.PI * m.elapsed / MANEUVERS[m.kind].ticks) : 0;
      const retreat = m?.kind === 'immelmann' ? 22 : m?.kind === 'split-s' ? 18 : -12;
      const lift = m?.kind === 'split-s' ? 11 : m?.kind === 'immelmann' ? 8 : 0;
      const setback = 46 + Math.max(0, 1 - aspect) * 30 + motion * retreat;
      const elevation = 15 + motion * lift;
      const slide = m?.kind === 'cobra' ? motion * 8 : 0;
      const center = field ? (field.y + field.height * 0.39) / height : 0.43;
      const shift = clamp(center, 0.29, 0.64);
      camera.fov = Math.max(60, 2 * Math.atan(Math.tan(16 * Math.PI / 180) / aspect) * 180 / Math.PI);
      this.fog.far = terrainFogFar(aspect, camera.fov, Math.atan2(1 - elevation, 105 + setback));
      camera.setViewOffset(width, height, 0, Math.round(height * (0.5 - shift)), width, height);
      camera.position.set(p.x - fx * setback + fz * slide, p.altitude + elevation, -(p.z - fz * setback - fx * slide));
      camera.lookAt(p.x + fx * 105, p.altitude + 1, -(p.z + fz * 105));
      this.camera = camera;
    }
    this.camera.updateMatrixWorld();
    return [];
  }

  // Coordinates are in CSS pixels, so scene cues share the cockpit/portrait layout.
  project(target: Position): Projection | null {
    this.vector.set(target.x, target.alt, -target.z).project(this.camera);
    if (this.vector.z < -1 || this.vector.z > 1 || Math.abs(this.vector.x) > 1 || Math.abs(this.vector.y) > 1) return null;
    return {
      x: (this.vector.x + 1) * this.framing.width / 2,
      y: (1 - this.vector.y) * this.framing.height / 2,
    };
  }

  draw(state: StageState): PitchMark[] {
    const attitude = state.maneuver ? maneuverAttitude(state.maneuver) : null;
    const ladder = this.updateCamera(state, attitude);
    const p = state.player, flat = state.view === 'overhead';
    const chase = state.view === 'chase', external = flat || chase;
    this.ship.visible = external && !(state.invulnerability > 0 && Math.floor(state.tick / 5) % 2);
    this.ship.position.set(p.x, flat ? 104 : p.altitude, -p.z);
    this.ship.scale.setScalar(chase ? 0.9 : 1);
    this.ship.rotation.set(flat ? 0 : (attitude?.pitch ?? state.climbRate * 0.004), -p.yaw, flat ? 0 : (attitude?.roll ?? -p.bank), 'YXZ');
    this.exhaust.update(state, this.camera);

    let shadows = 0, drones = 0;
    if (chase) this.writeShadow(shadows++, p.x, p.z, 8.8, 10.8, p.yaw);
    for (const batch of this.airframes) batch.count = 0;
    for (const enemy of state.enemies) {
      const batch = this.airframeByKind.get(enemy.kind);
      const size = enemy.kind === 'interceptor' ? 1.18 : 1;
      const warning = (enemy.tell || enemy.maneuver?.phase === 'warning') && Math.floor(state.tick / 7) % 2;
      const paint = enemy.hitUntil > state.tick ? 0xffffc1 : warning ? 0xffd069
        : batch ? 0xffffff : enemy.kind === 'interceptor' ? 0xa9c2ff : 0xffe5db;
      const mesh = batch?.mesh ?? this.drones, index = batch ? batch.count++ : drones++;
      this.write(mesh, index, enemy.x, enemy.z, flat ? 101 : enemy.alt, enemy.yaw, size, size, size, paint, flat ? 0 : enemy.bank);
      if (!flat) this.writeShadow(shadows++, enemy.x, enemy.z, 6.5, 6, enemy.yaw);
    }
    upload(this.drones, drones);
    for (const { mesh, count } of this.airframes) upload(mesh, count);

    const boss = state.boss;
    const active = activeWeakPoint(state);
    let weakPoints = 0;
    this.warden.visible = !!active && !!boss;
    if (boss && active) {
      const yaw = Math.atan2(p.x - boss.x, p.z - boss.z);
      this.warden.position.set(boss.x, flat ? 96 : boss.alt, -boss.z);
      this.warden.rotation.y = -yaw;
      if (!flat) {
        this.writeShadow(shadows++, boss.x, boss.z, 22, 8, yaw);
        for (const point of boss.weakPoints) {
          if (!point.hp) continue;
          const highlighted = point.id === active.id;
          const paint = highlighted ? active.exposed ? 0xffe289 : (Math.floor(state.tick / 10) % 2 ? 0xe1ac55 : 0x93623f) : 0x455761;
          const size = point.kind === 'core' ? 6 : 9;
          this.write(this.weakPoints, weakPoints++, point.x, point.z, point.alt, yaw, size, size * 0.83, size * 0.86, paint, Math.PI / 4);
          this.connect(this.weakPoints, weakPoints++, boss, point);
        }
      }
    }
    upload(this.weakPoints, weakPoints);
    upload(this.shadows, shadows);

    let salvage = 0;
    for (const pickup of state.pickups) {
      if (salvage === 80) break;
      const size = pickup.xp === 2 ? 4.6 : 3.8;
      this.write(this.pickups, salvage++, pickup.x, pickup.z, flat ? 106 : pickup.alt, state.tick / 37, size, size, size,
        pickup.xp === 2 ? 0xffe49c : 0x8efbe8, Math.PI / 4);
    }
    upload(this.pickups, salvage);

    for (const [i, shot] of state.shots.entries()) {
      const hostile = shot.kind === 'hostile';
      const yaw = Math.atan2(shot.vx, shot.vz);
      this.write(this.bullets, i, shot.x, shot.z, flat ? 103 : shot.alt, yaw,
        hostile ? 2.4 : 1.15, hostile ? 2.4 : 1.15, hostile ? 4.3 : 7.2,
        hostile ? 0xff7152 : shot.kind === 'pods' ? 0x73ffb4 : 0xf6ffad);
    }
    upload(this.bullets, state.shots.length);

    let sparks = 0, blasts = 0;
    for (const [i, bomb] of state.rearBombs.entries()) {
      const yaw = Math.atan2(bomb.vx, bomb.vz), age = state.tick - bomb.born;
      this.write(this.bombs, i, bomb.x, bomb.z, flat ? 105 : bomb.alt, yaw, 3.7, 3.7, 5.4, 0xff91a8, age * 0.07);
      if (age > 0 && sparks < 240) {
        this.write(this.sparks, sparks++, bomb.x, bomb.z, flat ? 105 : bomb.alt + 3.5, yaw, 1, 2, 1, 0xffb957);
      }
    }
    upload(this.bombs, state.rearBombs.length);
    for (const effect of state.effects) {
      if (effect.kind === 'miss') {
        if (!flat && sparks < 240) {
          const age = 0.55 - effect.life, scale = effect.life / 0.55;
          const travel = age * 0.12;
          this.write(this.sparks, sparks++, effect.x + effect.vx * travel, effect.z + effect.vz * travel, effect.alt,
            Math.atan2(effect.vx, effect.vz), scale + 0.35, scale + 0.2, 10 + scale * 6, effect.delta > 0 ? 0x8e93ad : 0xb48b79);
        }
      } else if (effect.kind === 'bomb-blast' && blasts < MAX_BOMBS) {
        const radius = 5 + (1 - effect.life / 0.8) * (BOMB_BLAST_RADIUS - 5);
        this.write(this.blast, blasts++, effect.x, effect.z, flat ? 107 : effect.alt, 0, radius, 1, radius);
      } else if (effect.kind === 'hit' || effect.kind === 'burst') {
        const burst = effect.kind === 'burst';
        const spread = (burst ? 0.52 : 0.36) - effect.life;
        for (let i = 0; i < (burst ? 6 : 4) && sparks < 240; i++) {
          const angle = i * 2.4;
          const reach = 2 + spread * 23;
          const size = Math.max(0.7, effect.life * 6);
          this.write(this.sparks, sparks++, effect.x + Math.sin(angle) * reach, effect.z + Math.cos(angle) * reach,
            flat ? 108 : effect.alt + Math.cos(angle) * reach, angle, size, size, size * 2.2, i % 2 ? 0xffaa59 : 0xffffb1);
        }
      }
    }
    upload(this.sparks, sparks);
    upload(this.blast, blasts);

    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.screen, this.screenCamera);
    return ladder;
  }
}
