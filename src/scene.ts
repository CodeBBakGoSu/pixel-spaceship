import {
  BoxGeometry, BufferGeometry, CircleGeometry, Color, CylinderGeometry, DataTexture, DoubleSide, DynamicDrawUsage, Float32BufferAttribute, Fog, Group,
  InstancedBufferAttribute, InstancedMesh, Object3D,
  EdgesGeometry, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, NearestFilter, OrthographicCamera, PerspectiveCamera, PlaneGeometry,
  RepeatWrapping, RingGeometry, Scene, SRGBColorSpace, TorusGeometry, Vector3, WebGLRenderer, WebGLRenderTarget,
  type Camera,
} from 'three';
import { droneFaces, dronePalette, shipFaces, shipPalette } from '../proto/shared/models.ts';
import { bakeVoxels } from '../proto/three/src/voxel-geometry.ts';
import { cockpitFov, frameCockpit, type PitchMark } from './camera.ts';
import { chestDefinition } from './chests.ts';
import { projectCameraContact, type ContactProjection } from './contact-projection.ts';
import { CLOSE_EVOLUTIONS } from './data/close-evolutions.ts';
import { CHESTS, WEAPONS } from './data/items.ts';
import { SWARM_CAPS } from './data/phases.ts';
import { PICKUP_LIMIT } from './data/run-balance.ts';
import { ENEMY_KINDS, NEW_ENEMY_KINDS, type EnemyKind } from './enemy-kinds.ts';
import { EngineExhaust, SHIP_VOXEL_SIZE } from './engine-exhaust.ts';
import { FlareVisuals } from './flare-visuals.ts';
import { FlightAtmosphere } from './flight-atmosphere.ts';
import type { CockpitLayout, HudLayout, PhoneLayout, Rect } from './layout.ts';
import { hitWindow } from './loadout.ts';
import { activeTrail, formerPursuer, MANEUVERS, maneuverAllowsControl, maneuverAttitude, maneuverViewYaw,
  TRAIL_LINGER_TICKS, TRAIL_LIMIT, trailEnd } from './maneuvers.ts';
import { enemyAirframe, wardenFaces, wardenPalette } from './models.ts';
import { frameRearCamera, glimpseWipe, layoutRearInset, layoutRearMirror,
  REAR_INSET_HEIGHT, REAR_INSET_WIDTH, REAR_VIEW_ASPECT } from './rear-glimpse.ts';
import { activeWeakPoint, BOMB_BLAST_RADIUS, clamp, FLAK_LIFE, FLAK_RADIUS, MINE_LIMIT, SHOT_LIMIT } from './stage-combat.ts';
import type { ManeuverTrail, Position, Shot, StageState } from './stage-types.ts';
import { orbitDroneGeometry, WeaponMounts } from './weapon-render.ts';
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

const instanceRanges = new WeakMap<InstancedBufferAttribute, { start: number; count: number }>();

function instances(geometry: BufferGeometry, capacity: number, material = new MeshBasicMaterial()): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3).setUsage(DynamicDrawUsage);
  instanceRanges.set(mesh.instanceMatrix, { start: 0, count: 0 });
  instanceRanges.set(mesh.instanceColor, { start: 0, count: 0 });
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

function uploadAttribute(attribute: InstancedBufferAttribute, count: number): void {
  const range = instanceRanges.get(attribute)!;
  range.count = count * attribute.itemSize;
  attribute.clearUpdateRanges();
  attribute.updateRanges.push(range);
  attribute.needsUpdate = true;
}

function upload(mesh: InstancedMesh, count: number): void {
  mesh.count = count;
  if (!count) return;
  uploadAttribute(mesh.instanceMatrix, count);
  if (mesh.instanceColor) uploadAttribute(mesh.instanceColor, count);
}

export function makeGnatBatch(): InstancedMesh {
  // The eight perimeter points and two ridges give the flight group a shaded silhouette in one draw.
  const outline = [
    [0, 0, -4.4], [-1.08, 0, -1.9], [-4.3, 0, 1.7], [-1.18, 0, 1.2],
    [0, 0, 3.5], [1.18, 0, 1.2], [4.3, 0, 1.7], [1.08, 0, -1.9],
  ];
  const top = outline.length, bottom = top + 1;
  const positions = [...outline.flat(), 0, 1.25, 0, 0, -0.95, 0];
  const swatches = [0xf3e8de, 0x9c9aae, 0x706b7d, 0xaa9fa7, 0xe3d2c6,
    0xaa9fa7, 0x706b7d, 0x9c9aae, 0xffffff, 0x636a82];
  const colors = swatches.flatMap(swatch => new Color(swatch).toArray());
  const indices: number[] = [];
  for (let index = 0; index < top; index++) {
    const next = (index + 1) % top;
    indices.push(top, index, next, bottom, next, index);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const mesh = instances(geometry, SWARM_CAPS.desktop, new MeshBasicMaterial({ vertexColors: true }));
  mesh.name = 'Gnat swarm';
  return mesh;
}

export function makeChestBatch(): InstancedMesh {
  const mesh = instances(new BoxGeometry(), CHESTS.length * 3);
  mesh.name = 'Carrier beacons and supply crates';
  return mesh;
}

type Projection = { x: number; y: number };
const TOP_FLIGHT = 152;
const GNAT_BAND_TINTS = [0xa9d1ff, 0xffd6a8, 0xffa89d] as const;
const FLAK_RING_LIMIT = 24;
const BOMB_VISUAL_LIMIT = 16;
const WEAPON_LINK_LIMIT = 128;
const WEAPON_RING_LIMIT = 16;
const FLAK_COLUMN_LIMIT = 8;
const ORBIT_DRONE_LIMIT = CLOSE_EVOLUTIONS.collector.count;
const RANGED_SHOT_STYLE: Partial<Record<Shot['kind'], readonly [width: number, length: number, color: number]>> = {
  seeker: [1.8, 5.8, 0xffd18c],
  'flak-shell': [2.25, 3.2, 0xff965b],
  'flak-shard': [1.3, 3.9, 0xffd768],
  'drone-bolt': [1.18, 5.2, 0x7ad3ff],
};
const TRAIL_COLORS = { immelmann: 0xafffd1, 'split-s': 0xffbe87, 'j-turn': 0x9eecff };
const DESKTOP_DOWNSCALE = 2;
const REAR_VIEW_FAR = 640;
const COCKPIT_TRACER_CLEARANCE = 17;
const MAIN_CAMERA_LAYER = 1;
type Framing = {
  width: number;
  height: number;
  phone: PhoneLayout | null;
  cockpit: CockpitLayout | null;
};

export class FlightScene {
  private readonly renderer: WebGLRenderer;
  private readonly world: World;
  private readonly scene = new Scene();
  private readonly fog = new Fog(0x9cbfcc, 245, 875);
  private readonly screen = new Scene();
  private readonly screenCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 2);
  private readonly target = new WebGLRenderTarget(1, 1, { magFilter: NearestFilter, minFilter: NearestFilter });
  private readonly rearTarget = new WebGLRenderTarget(REAR_INSET_WIDTH, REAR_INSET_HEIGHT,
    { magFilter: NearestFilter, minFilter: NearestFilter });
  private readonly rearCamera = new PerspectiveCamera(52, REAR_VIEW_ASPECT, 0.8, REAR_VIEW_FAR);
  private readonly rearInset = new Group();
  private readonly rearPlane = new PlaneGeometry(1, 1);
  private readonly rearBezel = new Mesh(this.rearPlane, new MeshBasicMaterial({
    color: 0x637b83, depthTest: false, depthWrite: false, toneMapped: false,
  }));
  private readonly rearLining = new Mesh(this.rearPlane, new MeshBasicMaterial({
    color: 0x0c1720, depthTest: false, depthWrite: false, toneMapped: false,
  }));
  private readonly rearGlass = new Mesh(this.rearPlane, new MeshBasicMaterial({
    map: this.rearTarget.texture, depthTest: false, depthWrite: false, toneMapped: false,
  }));
  private rearRect: Rect | null = null;
  private rearSlot: Rect | null = null;
  private mirrorSlot: ReturnType<typeof layoutRearMirror> = null;
  private rearTick = -Infinity;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly rearFlash = new Color(0xffedde);
  private readonly atmosphere: FlightAtmosphere;
  private lastMotionTick = -1;
  private boostLens = 0;
  private readonly flightView = { fov: 0, setback: 0, streaks: 0, shake: 0 };
  private readonly top = new OrthographicCamera(-1, 1, 1, -1, 0.5, 1200);
  private readonly chase = new PerspectiveCamera(59, 1, 0.8, 1060);
  private readonly cockpit = new PerspectiveCamera(60, 1, 0.65, 1060);
  private camera: Camera = this.top;
  private framing: Framing = { width: 0, height: 0, phone: null, cockpit: null };
  private readonly voxelMaterial = new MeshBasicMaterial({ vertexColors: true });
  private readonly ship = new Mesh(bakeVoxels(shipFaces(), shipPalette, SHIP_VOXEL_SIZE), this.voxelMaterial.clone());
  private readonly weaponMounts = new WeaponMounts(this.ship);
  private readonly bodyShimmer = new Mesh(new TorusGeometry(1, 0.032, 4, 24),
    new MeshBasicMaterial({ color: 0xabf4ff, transparent: true, depthWrite: false }));
  private readonly trailMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0.94, depthWrite: false });
  private readonly ghost = new Mesh(this.ship.geometry, new MeshBasicMaterial({ transparent: true, opacity: 0.25, depthWrite: false }));
  private readonly ribbon = instances(new BoxGeometry(), TRAIL_LIMIT, this.trailMaterial);
  private readonly pursuitRings = instances(new TorusGeometry(1, 0.064, 4, 24), ENEMY_KINDS.patrol.cap);
  private readonly enemyTrails = instances(new BoxGeometry(), 48, new MeshBasicMaterial({
    color: 0xa6e5f0, transparent: true, opacity: 0.48, depthWrite: false,
  }));
  private readonly trailTip: Position = { x: 0, z: 0, alt: 0 };
  private readonly exhaust = new EngineExhaust(this.ship);
  private readonly flareVisuals = new FlareVisuals();
  private readonly drones = instances(bakeVoxels(droneFaces(), dronePalette, 0.84), ENEMY_KINDS.patrol.cap, this.voxelMaterial);
  private readonly gnats = makeGnatBatch();
  private readonly airframes = (['interceptor', ...NEW_ENEMY_KINDS] as const).map(kind => {
    const { faces, palette, size } = kind === 'interceptor'
      ? { faces: droneFaces(kind), palette: dronePalette, size: 0.84 * 1.18 }
      : enemyAirframe(kind);
    return { kind, mesh: instances(bakeVoxels(faces, palette, size), ENEMY_KINDS[kind].cap, this.voxelMaterial), count: 0 };
  });
  private readonly airframeByKind = new Map<EnemyKind, (typeof this.airframes)[number]>(this.airframes.map(batch => [batch.kind, batch]));
  private readonly warden = new Mesh(bakeVoxels(wardenFaces(), wardenPalette, 0.65), this.voxelMaterial.clone());
  private readonly weakPoints = instances(new BoxGeometry(), 10);
  private readonly weakPointBorder = new LineSegments(new EdgesGeometry(this.weakPoints.geometry),
    new LineBasicMaterial({ color: 0xffefac }));
  private readonly pickups = instances(new BoxGeometry(), PICKUP_LIMIT);
  private readonly chestMarkers = makeChestBatch();
  private readonly pickupTrails = instances(new BoxGeometry(), PICKUP_LIMIT,
    new MeshBasicMaterial({ transparent: true, opacity: 0.58, depthWrite: false }));
  private readonly bullets = instances(new BoxGeometry(), SHOT_LIMIT);
  private readonly sparks = instances(new BoxGeometry(), 240);
  private readonly shadows = instances(new CircleGeometry(1, 10).rotateX(-Math.PI / 2), 26,
    new MeshBasicMaterial({ color: 0x051f21, opacity: 0.31, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  private readonly bombs = instances(new BoxGeometry(), BOMB_VISUAL_LIMIT);
  private readonly mines = instances(new BoxGeometry(), MINE_LIMIT);
  private readonly flak = instances(new TorusGeometry(1, 0.025, 4, 28).rotateX(-Math.PI / 2), FLAK_RING_LIMIT);
  private readonly blast = instances(new TorusGeometry(1, 0.03, 4, 48).rotateX(-Math.PI / 2), BOMB_VISUAL_LIMIT,
    new MeshBasicMaterial({ color: 0xffb957 }));
  private readonly defenseDrones = instances(orbitDroneGeometry(), ORBIT_DRONE_LIMIT, this.voxelMaterial);
  private readonly weaponLinks = instances(new BoxGeometry(), WEAPON_LINK_LIMIT,
    new MeshBasicMaterial({ transparent: true, opacity: 0.8, depthWrite: false }));
  private readonly weaponRings = instances(new RingGeometry(0.91, 1, 20).rotateX(-Math.PI / 2), WEAPON_RING_LIMIT,
    new MeshBasicMaterial({ transparent: true, opacity: 0.72, depthWrite: false, side: DoubleSide, forceSinglePass: true }));
  private readonly flakColumns = instances(new CylinderGeometry(1, 1, 2, 12, 1, true), FLAK_COLUMN_LIMIT,
    new MeshBasicMaterial({ transparent: true, opacity: 0.18, depthWrite: false, side: DoubleSide, forceSinglePass: true }));
  private readonly arcMiddle: Position = { x: 0, z: 0, alt: 0 };
  private readonly dummy = new Object3D();
  private readonly color = new Color();
  private readonly vector = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly ground = (x: number, z: number) => this.world.height(x, z);

  constructor(canvas: HTMLCanvasElement, world: World, arena: StageState['arena']) {
    this.world = world;
    this.atmosphere = new FlightAtmosphere(arena);
    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x081424);
    this.scene.background = this.fog.color;
    this.scene.fog = this.fog;
    this.scene.add(makeTerrain(world), this.makeCanopies(arena), this.makeBoundary(arena), this.atmosphere.group);
    this.scene.add(this.ship, this.drones, this.gnats, this.warden, this.weakPoints, this.pickups, this.chestMarkers, this.bullets, this.sparks,
      this.shadows, this.bombs, this.blast, this.mines, this.flak, this.ghost, this.ribbon, this.pursuitRings, this.bodyShimmer,
      this.flareVisuals.group, this.enemyTrails, this.pickupTrails, this.weakPointBorder,
      this.defenseDrones, this.weaponLinks, this.weaponRings, this.flakColumns);
    // The camera looking through the tail must skip the player's model and forward-facing markers.
    this.ship.traverse(object => object.layers.set(MAIN_CAMERA_LAYER));
    this.atmosphere.group.traverse(object => object.layers.set(MAIN_CAMERA_LAYER));
    for (const marker of [this.bodyShimmer, this.ghost, this.pursuitRings]) marker.layers.set(MAIN_CAMERA_LAYER);
    for (const camera of [this.top, this.chase, this.cockpit]) camera.layers.enable(MAIN_CAMERA_LAYER);
    this.ghost.visible = false;
    for (const { mesh } of this.airframes) this.scene.add(mesh);
    this.top.up.set(0, 0, -1);
    this.screenCamera.position.z = 1;
    this.screen.add(new Mesh(new PlaneGeometry(2, 2), new MeshBasicMaterial({
      map: this.target.texture, depthTest: false, depthWrite: false, toneMapped: false,
    })));
    this.rearTarget.texture.offset.x = 1;
    this.rearBezel.renderOrder = 1;
    this.rearLining.renderOrder = 2;
    this.rearGlass.renderOrder = 3;
    this.rearInset.visible = false;
    this.rearInset.add(this.rearBezel, this.rearLining, this.rearGlass);
    this.screen.add(this.rearInset);
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

  resize(framing: Framing & { hud: HudLayout }): void {
    const { width, height, phone, cockpit, hud } = framing;
    this.framing = framing;
    this.rearSlot = layoutRearInset(hud, height, phone);
    this.mirrorSlot = cockpit && layoutRearMirror(cockpit, phone);
    // Allocate for the full cockpit reveal once per layout, then reuse it throughout the wipe.
    const mirror = this.mirrorSlot?.focus;
    this.rearTarget.setSize(mirror?.width ?? REAR_INSET_WIDTH, mirror?.height ?? REAR_INSET_HEIGHT);
    this.rearRect = null;
    this.rearTick = -Infinity;
    const buffer = phone?.buffer ?? { width: Math.ceil(width / DESKTOP_DOWNSCALE), height: Math.ceil(height / DESKTOP_DOWNSCALE) };
    const w = Math.max(1, buffer.width), h = Math.max(1, buffer.height);
    if (this.target.width === w && this.target.height === h) return;
    this.target.setSize(w, h);
    // Keep the back buffer the same size as the target. The canvas presents it
    // with CSS nearest-neighbor scaling, including on high-DPR phones.
    this.renderer.setSize(w, h, false);
  }

  get rearView(): Readonly<Rect> | null {
    return this.rearRect;
  }

  get speedFeel(): Readonly<typeof this.flightView> {
    return this.flightView;
  }

  get cockpitMirror(): Readonly<Rect> | null {
    return this.framing.cockpit ? this.rearRect : null;
  }

  private placeRearView({ x, y, width: w, height: h }: Rect, crop = 1): void {
    const { width, height } = this.framing;
    this.rearInset.position.set((x + w / 2) * 2 / width - 1, 1 - (y + h / 2) * 2 / height, 0);
    this.rearInset.scale.set(w * 2 / width, h * 2 / height, 1);
    const bezel = this.mirrorSlot ? Math.max(3, Math.round(w / 48)) : 3;
    const rim = Math.round(bezel / 3);
    this.rearLining.scale.set(1 - 2 * rim / w, 1 - 2 * rim / h, 1);
    this.rearGlass.scale.set(1 - 2 * bezel / w, 1 - 2 * bezel / h, 1);
    // Reveal the mirror texture from the left without scaling the image during the wipe.
    this.rearTarget.texture.repeat.x = -crop;
  }

  private drawRearView(state: StageState, rearDanger: boolean): void {
    const { tick, view } = state;
    const glimpse = state.phase === 'playing' ? state.rearGlimpse : null;
    const reveal = glimpseWipe(tick, glimpse, this.reducedMotion.matches);
    this.rearRect = null;
    this.rearInset.visible = false;
    let crop = 1;
    if (view === 'cockpit' && this.mirrorSlot) {
      const { rest, focus } = this.mirrorSlot;
      const grow = Math.round((focus.width - rest.width) * reveal);
      this.rearRect = { ...rest, x: rest.x - grow, width: rest.width + grow,
        height: Math.round((rest.width + grow) / REAR_VIEW_ASPECT) };
    } else if (view !== 'cockpit' && this.rearSlot) {
      const width = Math.round(this.rearSlot.width * reveal);
      if (width < 8) return;
      this.rearRect = { ...this.rearSlot, width };
      crop = (width - 6) / (this.rearSlot.width - 6);
    }
    if (!this.rearRect) return;
    this.placeRearView(this.rearRect, crop);
    this.rearInset.visible = true;
    const bezel = this.rearBezel.material.color;
    bezel.setHex(0x637b83);
    if (glimpse && reveal > 0) {
      const flash = this.reducedMotion.matches ? 1 : Math.max(0, 1 - (tick - glimpse.since) / 16);
      const activeColor = this.color.setHex(glimpse.kind === 'bomb' ? 0xf490af : 0xffb363);
      activeColor.lerp(this.rearFlash, flash * 0.55);
      bezel.lerp(activeColor, reveal);
    } else if (view === 'cockpit' && rearDanger) {
      const pulse = this.reducedMotion.matches || Math.floor(tick / 8) % 2 ? 1 : 0.55;
      bezel.lerp(this.color.setHex(0xff6256), pulse);
    }

    if (tick >= this.rearTick && tick - this.rearTick < 2) return;
    this.rearTick = tick;
    frameRearCamera(this.rearCamera, state.player, reveal > 0, reveal > 0 ? glimpse?.target : undefined);
    // TOP uses a flattened altitude plane. Rebuild world instances only on rear-feed updates.
    if (view === 'overhead') this.updateWorld(state, 'rear');
    else if (view === 'chase') this.flareVisuals.update(state);
    const forwardFogFar = this.fog.far;
    this.fog.far = REAR_VIEW_FAR;
    this.renderer.setRenderTarget(this.rearTarget);
    this.renderer.render(this.scene, this.rearCamera);
    this.fog.far = forwardFogFar;
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

  private connect(mesh: InstancedMesh, index: number, from: Position, to: Position,
    width = 1.8, tint = 0x607887, plane?: number): void {
    const vector = this.vector.set(to.x - from.x, plane === undefined ? to.alt - from.alt : 0, from.z - to.z);
    const length = vector.length();
    this.dummy.position.set((from.x + to.x) / 2, plane ?? (from.alt + to.alt) / 2, -(from.z + to.z) / 2);
    this.dummy.scale.set(width, length, width);
    this.dummy.quaternion.setFromUnitVectors(this.up, vector.normalize());
    this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
    mesh.setColorAt(index, this.color.setHex(tint));
  }

  private drawTrail(state: StageState, trail: ManeuverTrail | null, flat: boolean, external: boolean): void {
    this.ghost.visible = false;
    if (!trail) {
      upload(this.ribbon, 0);
      return;
    }
    const tint = TRAIL_COLORS[trail.kind], fade = clamp(1 - (state.tick - trailEnd(trail)) / TRAIL_LINGER_TICKS, 0, 1);
    const { points } = trail, origin = points[0];
    const plane = flat ? TOP_FLIGHT + 0.5 : undefined;
    const width = flat ? 4 : 2.8;
    let segments = 0;
    this.trailMaterial.opacity = fade * 0.94;
    for (let i = 1; i < points.length; i++) this.connect(this.ribbon, segments++, points[i - 1], points[i], width, tint, plane);
    if (state.maneuver) {
      const p = state.player, from = points[points.length - 1];
      this.trailTip.x = p.x;
      this.trailTip.z = p.z;
      this.trailTip.alt = p.altitude;
      if (p.x !== from.x || p.z !== from.z || (!flat && p.altitude !== from.alt)) {
        this.connect(this.ribbon, segments++, from, this.trailTip, width, tint, plane);
      }
    }
    upload(this.ribbon, segments);
    if (!external) return;
    this.ghost.visible = true;
    this.ghost.material.color.setHex(tint);
    this.ghost.material.opacity = (flat ? 0.37 : 0.25) * fade;
    this.ghost.position.set(origin.x, flat ? TOP_FLIGHT + 1.5 : origin.alt, -origin.z);
    this.ghost.rotation.y = -trail.yaw;
    this.ghost.scale.setScalar(flat ? 1 : 0.9);
  }

  private writePursuitRing(index: number, x: number, z: number, alt: number): void {
    this.dummy.position.set(x, alt, -z);
    this.dummy.quaternion.copy(this.camera.quaternion);
    this.dummy.scale.setScalar(10);
    this.dummy.updateMatrix();
    this.pursuitRings.setMatrixAt(index, this.dummy.matrix);
    this.pursuitRings.setColorAt(index, this.color.setHex(0x91fff1));
  }

  private writeShadow(index: number, x: number, z: number, sx: number, sz: number, yaw: number): void {
    this.write(this.shadows, index, x, z, this.ground(x, z) + 0.9, yaw, sx, 1, sz);
  }

  private updateCamera(state: StageState, attitude: ReturnType<typeof maneuverAttitude> | null, shake: number): PitchMark[] {
    const { width, height, phone } = this.framing;
    const p = state.player, yaw = maneuverViewYaw(state), fx = Math.sin(yaw), fz = Math.cos(yaw);
    const aspect = width / Math.max(1, height);
    const lens = this.boostLens;
    const view = this.flightView;
    view.shake = state.view === 'overhead' ? 0 : shake;
    if (state.view === 'overhead') {
      view.fov = view.setback = 0;
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
      const widening = 4 * lens, pullback = 1.4 * lens;
      view.fov = cockpitFov(aspect, pitch, widening);
      view.setback = pullback;
      this.fog.far = terrainFogFar(aspect, view.fov, pitch, attitude?.cameraBank);
      // The last ~5% of terrain contrast blends into the sky under Three's smoothstep fog.
      const visibleDepth = this.fog.near + (this.fog.far - this.fog.near) * 0.865;
      return frameCockpit(this.cockpit, p, this.framing, attitude, this.ground, visibleDepth, yaw,
        { widening, pullback, shake });
    } else {
      const camera = this.chase;
      const field = phone?.playfield;
      const m = state.maneuver;
      const motion = m ? Math.sin(Math.PI * m.elapsed / MANEUVERS[m.kind].ticks) : 0;
      const retreat = m?.kind === 'immelmann' ? 22 : m?.kind === 'split-s' ? 18 : 29;
      const lift = m?.kind === 'split-s' ? 11 : m?.kind === 'immelmann' ? 8 : 0;
      view.setback = 8 * lens;
      const setback = 46 + Math.max(0, 1 - aspect) * 30 + motion * retreat + view.setback;
      const elevation = 15 + motion * lift;
      const lookHeight = 1 + (m?.kind === 'immelmann' || m?.kind === 'split-s' ? (attitude?.cameraPitch ?? 0) * 48 : 0);
      const center = field ? (field.y + field.height * 0.39) / height : 0.43;
      const shift = clamp(center, 0.29, 0.64);
      camera.fov = view.fov = Math.max(60, 2 * Math.atan(Math.tan(16 * Math.PI / 180) / aspect) * 180 / Math.PI) + 10 * lens;
      this.fog.far = terrainFogFar(aspect, camera.fov, Math.atan2(lookHeight - elevation, 105 + setback));
      camera.setViewOffset(width, height, 0, Math.round(height * (0.5 - shift)), width, height);
      const eyeX = p.x + fz * shake, eyeZ = p.z - fx * shake;
      camera.position.set(eyeX - fx * setback, p.altitude + elevation, -(eyeZ - fz * setback));
      camera.lookAt(eyeX + fx * 105, p.altitude + lookHeight, -(eyeZ + fz * 105));
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

  // Keep unclipped screen coordinates so cockpit markers can point outside the glass.
  projectContact(target: Position, out: ContactProjection): void {
    projectCameraContact(this.camera, this.framing, target, out, this.vector);
  }

  private updatePlayer(state: StageState, attitude: ReturnType<typeof maneuverAttitude> | null): void {
    const p = state.player, flat = state.view === 'overhead';
    const chase = state.view === 'chase', external = flat || chase;
    this.ship.visible = external && !(state.invulnerability > 0 && Math.floor(state.tick / 5) % 2);
    this.ship.position.set(p.x, flat ? TOP_FLIGHT + 3 : p.altitude, -p.z);
    this.ship.scale.setScalar(chase ? 0.9 : 1);
    const climbPitch = !flat && maneuverAllowsControl(state.maneuver) ? state.climbRate * 0.004 : 0;
    this.ship.rotation.set((attitude?.pitch ?? 0) + climbPitch, -p.yaw, attitude?.roll ?? (flat ? 0 : -p.bank), 'YXZ');
    this.ship.material.color.setHex(flat && attitude?.inverted ? 0x9ed9ee : 0xffffff);
    this.weaponMounts.update(state.run?.weaponLevels, state.run?.evolutions);
    this.bodyShimmer.visible = this.ship.visible && state.bodyGraceUntil > 0 && state.tick <= state.bodyGraceUntil;
    if (this.bodyShimmer.visible) {
      const pulse = (state.tick % 12) / 12;
      this.bodyShimmer.position.copy(this.ship.position);
      this.bodyShimmer.quaternion.copy(this.camera.quaternion);
      this.bodyShimmer.scale.setScalar(13 + pulse * 4);
      this.bodyShimmer.material.opacity = 0.8 - pulse * 0.55;
    }
    this.exhaust.update(state, this.camera);
  }

  private drawWeaponEffects(state: StageState, flat: boolean, links: number): void {
    const plane = flat ? TOP_FLIGHT + 2.5 : undefined;
    let rings = 0, columns = 0, drones = 0;
    if (state.run?.evolutions.pods) {
      const p = state.player, radius = CLOSE_EVOLUTIONS.aegis.radius;
      this.write(this.weaponRings, rings++, p.x, p.z, plane ?? p.altitude, 0, radius, 1, radius, 0xb3eaff);
    }
    for (const drone of state.orbitDrones) {
      if (drones === this.defenseDrones.instanceMatrix.count) break;
      this.write(this.defenseDrones, drones++, drone.x, drone.z, plane ?? drone.alt, drone.yaw, 1, 1, 1, 0xffffff);
    }
    for (const fx of state.weaponFx) {
      const left = fx.until - state.tick;
      if (left <= 0) continue;
      const { from, to } = fx;
      if (to) {
        if (links === WEAPON_LINK_LIMIT) continue;
        const fade = Math.min(1, left / 9);
        if (fx.kind === 'arc-link') {
          if (links + 1 < WEAPON_LINK_LIMIT) {
            const bend = Math.floor(fx.until / 3) % 2 ? 0.11 : -0.11;
            this.arcMiddle.x = (from.x + to.x) / 2 + (to.z - from.z) * bend;
            this.arcMiddle.z = (from.z + to.z) / 2 - (to.x - from.x) * bend;
            this.arcMiddle.alt = (from.alt + to.alt) / 2 + 2;
            this.connect(this.weaponLinks, links++, from, this.arcMiddle, 1.8 * fade, 0xffdf72, plane);
            this.connect(this.weaponLinks, links++, this.arcMiddle, to, 1.8 * fade, 0xffed9a, plane);
          } else this.connect(this.weaponLinks, links++, from, to, 1.8 * fade, 0xffed9a, plane);
        } else {
          const charge = fx.kind === 'rail-charge';
          const width = charge ? 0.64 : Math.min(2.2, (fx.radius ?? 3) * 0.5) * (0.45 + fade * 0.55);
          this.connect(this.weaponLinks, links++, from, to, width, charge ? 0x79baff : 0xbbfaff, plane);
        }
      } else if (fx.radius) {
        const tint = fx.kind === 'flak-blast' ? 0xffa363 : fx.kind === 'arc-blast' ? 0xffdf72 : 0xffb69b;
        const radius = fx.radius * (1 - 0.31 * Math.min(1, left / 20));
        if (rings < WEAPON_RING_LIMIT) {
          this.write(this.weaponRings, rings++, from.x, from.z, plane ?? from.alt, 0, radius, 1, radius, tint);
        }
        if (!flat && fx.kind === 'flak-blast' && columns < FLAK_COLUMN_LIMIT) {
          const height = fx.halfHeight ?? hitWindow(state, WEAPONS.flak.tuning.halfHeight);
          this.write(this.flakColumns, columns++, from.x, from.z, from.alt, 0, radius, height, radius, tint);
        }
      }
    }
    const wake = state.ionWake;
    const plasma = !!state.run?.evolutions.ion;
    const width = WEAPONS.ion.tuning.width[(state.run?.weaponLevels.ion ?? 1) - 1]
      * (plasma ? CLOSE_EVOLUTIONS.plasma.widthScale : 1);
    for (let i = 1; i < wake.length && links < WEAPON_LINK_LIMIT; i++) {
      const from = wake[i - 1], to = wake[i];
      const left = Math.min(from.until, to.until) - state.tick;
      if (left <= 0) continue;
      const size = width * (0.12 + 0.24 * Math.min(1, left / 84));
      const height = Math.abs(from.alt - to.alt);
      if (!flat && height > 1.5) {
        const dx = to.x - from.x, dz = to.z - from.z;
        this.write(this.weaponLinks, links++, (from.x + to.x) / 2, (from.z + to.z) / 2, (from.alt + to.alt) / 2,
          Math.atan2(dx, dz), size, height + size, Math.hypot(dx, dz) + size * 0.4, plasma ? 0xba93ff : 0x43c6b3);
      } else {
        this.connect(this.weaponLinks, links++, from, to, size, plasma ? 0xe4bdff : 0x66f5d9, plane);
      }
    }
    upload(this.defenseDrones, drones);
    upload(this.weaponLinks, links);
    upload(this.weaponRings, rings);
    upload(this.flakColumns, columns);
  }

  private updateWorld(state: StageState, view: StageState['view'] | 'rear'): void {
    const p = state.player, flat = view === 'overhead';
    const chase = view === 'chase', external = flat || chase;
    const trail = activeTrail(state);
    this.drawTrail(state, trail, flat, external);
    const fireTint = Math.floor(state.tick / 6) % 2 ? 0xff9564 : 0xffbf78;

    let shadows = 0, drones = 0, gnats = 0, rings = 0, marked = 0, trails = 0, chestMarkers = 0;
    if (chase) this.writeShadow(shadows++, p.x, p.z, 8.8, 10.8, p.yaw);
    for (const batch of this.airframes) batch.count = 0;
    for (const enemy of state.enemies) {
      if (enemy.kind === 'gnat') {
        if (gnats < state.swarmCap) {
          const tint = (enemy.burnUntil ?? 0) > state.tick ? fireTint
            : flat ? GNAT_BAND_TINTS[enemy.band] : 0xffb289;
          this.write(this.gnats, gnats++, enemy.x, enemy.z, flat ? TOP_FLIGHT - 1 : enemy.alt,
            enemy.yaw, 1, 1, 1, tint, flat ? 0 : enemy.bank);
        }
        continue;
      }
      const batch = this.airframeByKind.get(enemy.kind);
      const warning = (enemy.tell || enemy.maneuver?.phase === 'warning') && Math.floor(state.tick / 7) % 2;
      const paint = (enemy.burnUntil ?? 0) > state.tick ? fireTint : enemy.hitUntil > state.tick ? 0xffffc1 : warning ? 0xffd069
        : enemy.carrier ? 0xffe4aa : batch ? 0xffffff : 0xffe5db;
      const mesh = batch?.mesh ?? this.drones, index = batch ? batch.count++ : drones++;
      this.write(mesh, index, enemy.x, enemy.z, flat ? TOP_FLIGHT : enemy.alt, enemy.yaw, 1, 1, 1, paint, flat ? 0 : enemy.bank);
      if (enemy.carrier) {
        const alt = flat ? TOP_FLIGHT + 10 : enemy.alt + 13;
        const gold = enemy.entry ? 0xe0be8a : 0xffe5a3;
        this.write(this.chestMarkers, chestMarkers++, enemy.x - 1.9, enemy.z, alt, 0, 1.6, 6.8, 2, gold, Math.PI / 4);
        this.write(this.chestMarkers, chestMarkers++, enemy.x + 1.9, enemy.z, alt, 0, 1.6, 6.8, 2, gold, -Math.PI / 4);
      }
      if ((enemy.entry || enemy.flyby) && trails + 2 <= this.enemyTrails.instanceMatrix.count) {
        const fx = Math.sin(enemy.yaw), fz = Math.cos(enemy.yaw);
        const sideX = 3.2 * fz, sideZ = -3.2 * fx;
        const length = enemy.entry ? clamp(Math.hypot(enemy.vx, enemy.vz) * 0.09 + 7, 9, 54) : 11.2;
        const aftX = enemy.entry ? (6 + length / 2) * fx : 0.15 * enemy.vx;
        const aftZ = enemy.entry ? (6 + length / 2) * fz : 0.15 * enemy.vz;
        for (const side of [-1, 1]) {
          this.write(this.enemyTrails, trails++, enemy.x - aftX + side * sideX,
            enemy.z - aftZ + side * sideZ, flat ? TOP_FLIGHT + 1 : enemy.alt, enemy.yaw, enemy.entry ? 1.15 : 0.64, 0.48, length);
        }
      }
      if (external && formerPursuer(state, trail, enemy)) this.writePursuitRing(marked++, enemy.x, enemy.z, flat ? TOP_FLIGHT + 3 : enemy.alt);
      if (!flat && enemy.kind !== 'turret') this.writeShadow(shadows++, enemy.x, enemy.z, 6.5, 6, enemy.yaw);
      const tell = enemy.tell;
      if (tell?.kind === 'flak' && rings < FLAK_RING_LIMIT) {
        this.write(this.flak, rings++, tell.x, tell.z, flat ? TOP_FLIGHT + 4 : tell.alt, 0,
          FLAK_RADIUS, 1.6, FLAK_RADIUS, warning ? 0xffc879 : 0xd66c50);
      }
    }
    upload(this.drones, drones);
    upload(this.gnats, gnats);
    upload(this.pursuitRings, marked);
    upload(this.enemyTrails, trails);
    for (const { mesh, count } of this.airframes) upload(mesh, count);

    const boss = state.boss;
    const active = activeWeakPoint(state);
    let weakPoints = 0;
    this.warden.visible = !!active && !!boss;
    this.weakPointBorder.visible = false;
    if (boss && active) {
      const yaw = Math.atan2(p.x - boss.x, p.z - boss.z);
      this.warden.position.set(boss.x, flat ? TOP_FLIGHT - 5 : boss.alt, -boss.z);
      this.warden.rotation.y = -yaw;
      if (!flat) {
        this.writeShadow(shadows++, boss.x, boss.z, 22, 8, yaw);
        for (const point of boss.weakPoints) {
          if (!point.hp) continue;
          const highlighted = point.id === active.id;
          const paint = (point.burnUntil ?? 0) > state.tick ? fireTint
            : highlighted && active.exposed ? 0xd8a858 : 0x455761;
          const size = point.kind === 'core' ? 6 : 9;
          this.write(this.weakPoints, weakPoints++, point.x, point.z, point.alt, yaw, size, size * 0.83, size * 0.86, paint, Math.PI / 4);
          this.connect(this.weakPoints, weakPoints++, boss, point);
        }
      }
      if (active.exposed) {
        const size = active.kind === 'core' ? 6 : 9;
        this.weakPointBorder.visible = true;
        this.weakPointBorder.position.set(active.x, flat ? TOP_FLIGHT + 1 : active.alt, -active.z);
        this.weakPointBorder.rotation.set(0, -yaw, Math.PI / 4, 'YXZ');
        this.weakPointBorder.scale.set(size * 1.06, size * 0.88, size * 0.91);
      }
    }
    upload(this.weakPoints, weakPoints);
    upload(this.shadows, shadows);

    let salvage = 0, magnetTrails = 0;
    for (const pickup of state.pickups) {
      if (salvage === PICKUP_LIMIT) break;
      const { pulling, reversal } = pickup;
      const pulse = pulling && !this.reducedMotion.matches ? 0.4 * Math.sin(state.tick * 0.36 + salvage) : 0;
      const size = 3 + Math.min(pickup.xp, 5) * 0.8 + pulse;
      const alt = flat ? TOP_FLIGHT + 5 : pickup.alt;
      const tint = pulling ? reversal ? 0xd6fffc : 0xfff1b4 : pickup.xp >= 2 ? 0xffe49c : 0x8efbe8;
      this.write(this.pickups, salvage++, pickup.x, pickup.z, alt, state.tick / 37, size, size, size, tint, Math.PI / 4);
      if (pulling) {
        const yaw = Math.atan2(p.x - pickup.x, p.z - pickup.z);
        const trailLength = reversal ? 9 : 6;
        const offset = (size + trailLength) / 2;
        this.write(this.pickupTrails, magnetTrails++, pickup.x - Math.sin(yaw) * offset,
          pickup.z - Math.cos(yaw) * offset, alt, yaw, size * 0.3, size * 0.3, trailLength, tint);
      }
    }
    upload(this.pickups, salvage);
    upload(this.pickupTrails, magnetTrails);

    for (const drop of state.chests.drops) {
      const tint = chestDefinition(drop.id).kind === 'evolution' ? 0xffbd62 : 0x96e9d2;
      const alt = flat ? TOP_FLIGHT + 8 : drop.alt;
      const yaw = state.tick / 80;
      this.write(this.chestMarkers, chestMarkers++, drop.x, drop.z, alt, yaw, 10, 6, 8, 0x334c58);
      this.write(this.chestMarkers, chestMarkers++, drop.x, drop.z, alt + 3.1, yaw, 11, 2.4, 8.8, tint);
      this.write(this.chestMarkers, chestMarkers++, drop.x, drop.z, alt + 1.25, yaw, 2.8, 4.1, 9, 0xfff0b1);
    }
    upload(this.chestMarkers, chestMarkers);

    let bullets = 0, weaponLinks = 0;
    const eye = view === 'cockpit' ? this.cockpit.position : null;
    for (const shot of state.shots) {
      const hostile = shot.kind === 'hostile';
      const yaw = Math.atan2(shot.vx, shot.vz);
      const strafe = shot.kind === 'strafe', reversal = !!shot.reversal;
      // Keep the closest ends of the boosted tracers out of the pilot's eyeline.
      if (eye && reversal && (shot.x - eye.x) ** 2 + (shot.alt - eye.y) ** 2 + (shot.z + eye.z) ** 2 < COCKPIT_TRACER_CLEARANCE ** 2) continue;
      const vy = 'vy' in shot ? shot.vy : 0;
      const pitch = flat ? 0 : Math.atan2(vy, Math.hypot(shot.vx, shot.vz));
      const style = RANGED_SHOT_STYLE[shot.kind];
      const width = style?.[0] ?? (hostile ? 2.4 : reversal ? (eye ? 2.6 : 3.4) : 1.15);
      const length = style?.[1] ?? (hostile ? 4.3 : reversal ? (eye ? 12 : 15.5) : strafe ? 9 : 7.2);
      const tint = shot.aurora ? reversal ? 0x89ffea : 0xbd96ff
        : style?.[2] ?? (hostile ? 0xff7152 : reversal ? 0xbaffff : strafe ? 0xffb45c : shot.kind === 'pods' ? 0x73ffb4 : 0xf6ffad);
      this.write(this.bullets, bullets++, shot.x, shot.z, flat ? TOP_FLIGHT + 2 : shot.alt, yaw,
        width, width, length, tint, 0, pitch);
      if (shot.kind === 'seeker' && weaponLinks < WEAPON_LINK_LIMIT) {
        const tail = 8 / Math.max(1, Math.hypot(shot.vx, shot.vz, vy));
        this.write(this.weaponLinks, weaponLinks++, shot.x - shot.vx * tail, shot.z - shot.vz * tail,
          flat ? TOP_FLIGHT + 2 : shot.alt - vy * tail, yaw, 1.25, 1.25, 11, 0xc5bcae, 0, pitch);
      }
    }
    upload(this.bullets, bullets);
    this.drawWeaponEffects(state, flat, weaponLinks);

    let mines = 0;
    for (const mine of state.enemyMines) {
      this.write(this.mines, mines++, mine.x, mine.z, flat ? TOP_FLIGHT + 4 : mine.alt, state.tick / 21,
        4.8, 3.4, 4.8, Math.floor(state.tick / 8) % 2 ? 0xffbd77 : 0xe46151, Math.PI / 4);
    }
    upload(this.mines, mines);

    let sparks = 0, blasts = 0;
    let bombs = 0;
    for (const bomb of state.rearBombs) {
      if (bombs === BOMB_VISUAL_LIMIT) break;
      const yaw = Math.atan2(bomb.vx, bomb.vz), age = state.tick - bomb.born;
      this.write(this.bombs, bombs++, bomb.x, bomb.z, flat ? TOP_FLIGHT + 4 : bomb.alt, yaw, 3.7, 3.7, 5.4,
        bomb.carpet ? 0xffed99 : bomb.weapon === 'bomb-bay' ? 0xfac186 : 0xff91a8, age * 0.07);
      if (age > 0 && sparks < 240) {
        this.write(this.sparks, sparks++, bomb.x, bomb.z, flat ? TOP_FLIGHT + 4 : bomb.alt + 3.5, yaw, 1, 2, 1, 0xffb957);
      }
    }
    upload(this.bombs, bombs);
    for (const effect of state.effects) {
      if (effect.kind === 'miss') {
        if (!flat && sparks < 240) {
          const age = 0.55 - effect.life, scale = effect.life / 0.55;
          const travel = age * 0.12;
          this.write(this.sparks, sparks++, effect.x + effect.vx * travel, effect.z + effect.vz * travel, effect.alt,
            Math.atan2(effect.vx, effect.vz), scale + 0.35, scale + 0.2, 10 + scale * 6, effect.delta > 0 ? 0x8e93ad : 0xb48b79);
        }
      } else if (effect.kind === 'bomb-blast' && blasts < BOMB_VISUAL_LIMIT) {
        const radius = 5 + (1 - effect.life / 0.8) * ((effect.radius ?? BOMB_BLAST_RADIUS) - 5);
        this.write(this.blast, blasts++, effect.x, effect.z, flat ? TOP_FLIGHT + 6 : effect.alt, 0, radius, 1, radius);
      } else if (effect.kind === 'flak' && rings < FLAK_RING_LIMIT) {
        const radius = FLAK_RADIUS * (1.1 - 0.3 * effect.life / FLAK_LIFE);
        this.write(this.flak, rings++, effect.x, effect.z, flat ? TOP_FLIGHT + 6 : effect.alt, 0, radius, 3.2, radius, 0xffdbc0);
        for (let i = 0; i < 7 && sparks < 240; i++) {
          const angle = i * 2.4 + effect.life * 4;
          this.write(this.sparks, sparks++, effect.x + Math.sin(angle) * radius * 0.75,
            effect.z + Math.cos(angle) * radius * 0.75, flat ? TOP_FLIGHT + 6 : effect.alt + Math.sin(i * 4) * 5,
            angle, 3.5, 2.6, 4.4, i % 2 ? 0xffb86d : 0xb56d58);
        }
      } else if (effect.kind === 'hit' || effect.kind === 'burst') {
        const burst = effect.kind === 'burst';
        const spread = (burst ? 0.52 : 0.36) - effect.life;
        for (let i = 0; i < (burst ? 6 : 4) && sparks < 240; i++) {
          const angle = i * 2.4;
          const reach = 2 + spread * 23;
          const size = Math.max(0.7, effect.life * 6);
          this.write(this.sparks, sparks++, effect.x + Math.sin(angle) * reach, effect.z + Math.cos(angle) * reach,
            flat ? TOP_FLIGHT + 7 : effect.alt + Math.cos(angle) * reach, angle, size, size, size * 2.2, i % 2 ? 0xffaa59 : 0xffffb1);
        }
      }
    }
    upload(this.sparks, sparks);
    upload(this.blast, blasts);
    upload(this.flak, rings);
    this.flareVisuals.update(state, flat ? TOP_FLIGHT + 7 : undefined, chase ? this.chase : undefined);
  }

  draw(state: StageState, rearDanger = false): PitchMark[] {
    const reduceMotion = this.reducedMotion.matches;
    const delta = state.tick - this.lastMotionTick;
    if (delta < 0 || reduceMotion) this.boostLens = 0;
    this.lastMotionTick = state.tick;
    const ticks = clamp(delta, 0, 12);
    const target = reduceMotion ? 0 : Number(state.boosting);
    this.boostLens += (target - this.boostLens) * (1 - Math.exp(-ticks / (target ? 4.5 : 8)));
    const ignition = state.boostTicks;
    const shake = !reduceMotion && ignition > 0 && ignition <= 8 ? Math.sin(ignition * 1.8) * (9 - ignition) * 0.028 : 0;
    const attitude = state.maneuver ? maneuverAttitude(state.maneuver, state.player.bank) : null;
    const ladder = this.updateCamera(state, attitude, shake);
    this.flightView.streaks = this.atmosphere.update(this.camera instanceof PerspectiveCamera ? this.camera : null,
      state.speed, ticks, reduceMotion);
    this.updatePlayer(state, attitude);
    this.updateWorld(state, state.view);
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.drawRearView(state, rearDanger);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.screen, this.screenCamera);
    return ladder;
  }
}
