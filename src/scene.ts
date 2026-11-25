import {
  BoxGeometry, Color, CylinderGeometry, DoubleSide, DynamicDrawUsage, Fog, Group,
  InstancedBufferAttribute, InstancedMesh, Object3D,
  Mesh, MeshBasicMaterial, NearestFilter, OrthographicCamera, PerspectiveCamera, PlaneGeometry,
  RingGeometry, Scene, TorusGeometry, Vector3, WebGLRenderer, WebGLRenderTarget,
  Vector4, type BufferGeometry, type Camera,
} from 'three';
import { bakeVoxels } from '../proto/three/src/voxel-geometry.ts';
import { crosswingTrail, CROSSWING_TRAIL_SEGMENTS } from './attack-trail.ts';
import { batchBursts, gnatBursts } from './combat-feedback.ts';
import { COMBAT_FEEDBACK } from './data/combat-feedback.ts';
import { cockpitFov, frameCockpit, type PitchMark } from './camera.ts';
import { chestDefinition } from './chests.ts';
import { AEGIS_INNER_RADIUS, AEGIS_OUTER_RADIUS, AEGIS_VOLUME_OUTLINE, createAegisRingGeometry } from './aegis-volume-render.ts';
import { projectCameraContact, type ContactProjection } from './contact-projection.ts';
import { CLOSE_EVOLUTIONS } from './data/close-evolutions.ts';
import { FLIGHT_CAMERA, FLIGHT_FEEL } from './data/flight-feel.ts';
import { WING_TRAIL } from './data/flight-world.ts';
import type { HostileShape } from './data/hostile-fire.ts';
import { CHESTS, WEAPONS, type WeaponId } from './data/items.ts';
import { PHASES, SWARM_CAPS } from './data/phases.ts';
// --- S7f lane ---
import { DEFAULT_QUALITY, RENDER_QUALITY, type RenderQuality } from './data/render-quality.ts';
import { renderBuffer } from './layout.ts';
import { PickupVisuals } from './pickup-visuals.ts';
import { SortieVfx, type PickupVisualEvent, type SortieVfxMode } from './sortie-vfx.ts';
import { AdaptiveQuality } from './render-quality.ts';
import { ROLLS } from './data/roll.ts';
import { ENEMY_KINDS, NEW_ENEMY_KINDS, type EnemyKind } from './enemy-kinds.ts';
import { EngineExhaust } from './engine-exhaust.ts';
import { FlareVisuals } from './flare-visuals.ts';
import { FlightAtmosphere } from './flight-atmosphere.ts';
import { cameraBank, FlightMotion } from './flight-feel.ts';
import { FlightSurface } from './flight-surface.ts';
import { HostileVisuals } from './hostile-visuals.ts';
import type { CockpitLayout, HudLayout, PhoneLayout, Rect } from './layout.ts';
import { hitWindow } from './loadout.ts';
import { activeTrail, formerPursuer, MANEUVERS, maneuverAllowsControl, maneuverAttitude, maneuverViewYaw,
  TRAIL_LINGER_TICKS, TRAIL_LIMIT, trailEnd } from './maneuvers.ts';
import { enemyAirframe, gnatGeometry, playerAirframe } from './models.ts';
import { aceAirframe } from './models-roster.ts';
import { choosePostTier, FlightPost, installSteppedHaze, visibleHazeCutoff } from './post.ts';
import { RosterVisuals } from './roster-visuals.ts';
import { ROSTER_SHEET_CAMERA } from './roster-sheet.ts';
import { frameRearCamera, glimpseWipe, layoutRearInset, layoutRearMirror,
  REAR_INSET_HEIGHT, REAR_INSET_WIDTH, REAR_VIEW_ASPECT } from './rear-glimpse.ts';
import { rollAltitude, rollAttitude } from './roll.ts';
import { BOMB_BLAST_RADIUS, clamp, FLAK_LIFE, FLAK_RADIUS, MINE_LIMIT, SHOT_LIMIT,
  STEP, TICKS_PER_SECOND } from './stage-combat.ts';
import type { Effect, ManeuverTrail, Position, Roll, Shot, StageState } from './stage-types.ts';
import { orbitDroneGeometry, WeaponMounts } from './weapon-render.ts';
// --- S7d lane ---
import { TERRAIN_STREAM } from './data/terrain-stream.ts';
import { chaseEyeHeight, TerrainStream } from './terrain-stream.ts';
import { HAZE, SHADOW } from './data/palette.ts';
import { jetShadowTexture, shadowOffset } from './shadow-shape.ts';
import { makeSky } from './sky.ts';
import { altitudeHaze, terrainFogFar, type World } from './world.ts';

export const overheadZoom = (altitude: number): number => clamp((altitude - 20) / 90, 0.75, 1.4) ** 0.7;

const instanceRanges = new WeakMap<InstancedBufferAttribute, { start: number; count: number }>();

function instances(geometry: BufferGeometry, capacity: number, material = new MeshBasicMaterial()): InstancedMesh<BufferGeometry, MeshBasicMaterial> {
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

// --- S7f lane ---
function bakeAirframe({ faces, palette, size }: ReturnType<typeof playerAirframe>): BufferGeometry {
  return bakeVoxels(faces, palette, size);
}

function airframeLod(mesh: Mesh, bakeDetailed: () => BufferGeometry) {
  return { mesh, bakeDetailed, coarse: mesh.geometry, detailed: undefined as BufferGeometry | undefined };
}

export function makeGnatBatch(detailed = false, capacity: number = SWARM_CAPS.desktop): InstancedMesh {
  const mesh = instances(gnatGeometry(detailed), capacity, new MeshBasicMaterial({ vertexColors: true }));
  mesh.name = 'Gnat swarm';
  return mesh;
}

export function makeChestBatch(): InstancedMesh {
  const mesh = instances(new BoxGeometry(), CHESTS.length * 3);
  mesh.name = 'Carrier beacons and supply crates';
  return mesh;
}

type Projection = { x: number; y: number };

export function clipProjectSortieSegment(camera: Camera, width: number, height: number,
  from: Position, to: Position): { from: Projection; to: Projection } | null {
  const a = new Vector4(from.x, from.alt, -from.z, 1)
    .applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  const b = new Vector4(to.x, to.alt, -to.z, 1)
    .applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  let enter = 0, exit = 1;
  const clip = (fromDistance: number, toDistance: number): boolean => {
    if (fromDistance < 0 && toDistance < 0) return false;
    if (fromDistance < 0) enter = Math.max(enter, fromDistance / (fromDistance - toDistance));
    if (toDistance < 0) exit = Math.min(exit, fromDistance / (fromDistance - toDistance));
    return enter <= exit;
  };
  if (!clip(a.z + a.w, b.z + b.w) || !clip(a.w - a.z, b.w - b.z)) return null;
  const clippedFrom = a.clone().lerp(b, enter), clippedTo = a.clone().lerp(b, exit);
  if (!clippedFrom.w || !clippedTo.w) return null;
  return {
    from: { x: (clippedFrom.x / clippedFrom.w + 1) * width / 2, y: (1 - clippedFrom.y / clippedFrom.w) * height / 2 },
    to: { x: (clippedTo.x / clippedTo.w + 1) * width / 2, y: (1 - clippedTo.y / clippedTo.w) * height / 2 },
  };
}
const TOP_FLIGHT = 152;
export const OVERHEAD_EFFECT_PLANE_ALTITUDE = TOP_FLIGHT + 2.5;
const GNAT_BAND_TINTS = [0xa9d1ff, 0xffd6a8, 0xffa89d] as const;
const GNAT_LIVERY = {
  armored: { width: 1.75, height: 2.25, length: 1.25, tints: [0x6485aa, 0x778198, 0x886e80] },
  sting: { width: 0.66, height: 1.12, length: 1.75, tints: [0xff5896, 0xff4c64, 0xff663f] },
} as const;
const REGULAR_RENDER_CAP = Math.max(ENEMY_KINDS.patrol.cap, ...PHASES.map(phase => phase.regularCap));
const FLAK_RING_LIMIT = 24;
const BOMB_VISUAL_LIMIT = 16;
const WEAPON_LINK_LIMIT = 128;
// Render-only Ion Wake look: small motes (m), hidden near the chase/cockpit eye so the wake never fills the view.
const ION_MOTE = { size: 1.6, plasmaSize: 2.1, edgeScale: 0.6, fadeTicks: 84, chaseClearance: 70, cockpitClearance: 110,
  cockpitScale: 0.7 } as const;
const WEAPON_RING_LIMIT = 16;
const FLAK_COLUMN_LIMIT = 8;
const ORBIT_DRONE_LIMIT = Math.max(CLOSE_EVOLUTIONS.collector.count, ...WEAPONS.drones.tuning.count);
const RANGED_SHOT_STYLE: Partial<Record<Shot['kind'], readonly [width: number, length: number, color: number]>> = {
  seeker: [1.8, 5.8, 0xffd18c],
  'flak-shell': [2.25, 3.2, 0xff965b],
  'flak-shard': [1.3, 3.9, 0xffd768],
  'drone-bolt': [1.18, 5.2, 0x7ad3ff],
};
const TRAIL_COLORS = { immelmann: 0xafffd1, 'split-s': 0xffbe87, 'j-turn': 0x9eecff };
const COCKPIT_TRACER_CLEARANCE = 17;
const MAIN_CAMERA_LAYER = 1;
const shieldFlash = (tick: number): boolean => Math.floor(tick * 16 / TICKS_PER_SECOND) % 2 === 0;
type Framing = {
  width: number;
  height: number;
  phone: PhoneLayout | null;
  cockpit: CockpitLayout | null;
};

export type FlightRenderOptions = {
  enabled?: boolean;
  fixture?: string | null;
  quality?: RenderQuality;
  comparisonScale?: number;
};

export class FlightScene {
  private readonly renderer: WebGLRenderer;
  // --- S7f lane ---
  private readonly quality: AdaptiveQuality;
  private readonly comparisonScale: number | undefined;
  private readonly world: World;
  private readonly terrain: TerrainStream;
  private readonly scene = new Scene();
  private readonly fog = new Fog(HAZE, TERRAIN_STREAM.fogNear, TERRAIN_STREAM.desktop.fogFar);
  private readonly screen = new Scene();
  private readonly screenCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 2);
  private readonly target = new WebGLRenderTarget(1, 1, { magFilter: NearestFilter, minFilter: NearestFilter });
  private readonly rearTarget = new WebGLRenderTarget(REAR_INSET_WIDTH, REAR_INSET_HEIGHT,
    { magFilter: NearestFilter, minFilter: NearestFilter });
  private readonly rearCamera = new PerspectiveCamera(52, REAR_VIEW_ASPECT, 0.8, FLIGHT_CAMERA.rearFar);
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
  private readonly feelEnabled: boolean;
  private readonly fixture: string | null;
  private readonly atmosphere: FlightAtmosphere;
  private readonly surface: FlightSurface | null;
  private readonly post: FlightPost | null;
  private readonly motion = new FlightMotion();
  private readonly seenBlasts = new WeakSet<Effect>();
  private lastMotionTick = -1;
  private boostLens = 0;
  private topZoom = 1;
  private readonly cockpitPose = { cameraPitch: 0, fovPitch: 0, cameraBank: 0 };
  private readonly cockpitLens = { widening: 0, pullback: 0, shake: 0, shakeVertical: 0 };
  private readonly flightView = {
    fov: 0, setback: 0, streaks: 0, shake: 0, boost: 0, sink: 0, shipBank: 0, cameraBank: 0, rearBank: 0, yawLag: 0,
    cloudFlash: 0, trailSegments: 0, wakeMarks: 0, clearance: 0,
  };
  private readonly top = new OrthographicCamera(-1, 1, 1, -1, 0.5, 1200);
  private readonly chase = new PerspectiveCamera(59, 1, 0.8, FLIGHT_CAMERA.far);
  private readonly cockpit = new PerspectiveCamera(60, 1, 0.65, FLIGHT_CAMERA.far);
  private camera: Camera = this.top;
  private framing: Framing = { width: 0, height: 0, phone: null, cockpit: null };
  private readonly voxelMaterial = new MeshBasicMaterial({ vertexColors: true });
  private readonly ship = new Mesh(bakeAirframe(playerAirframe(false)), this.voxelMaterial.clone());
  private readonly weaponMounts = new WeaponMounts(this.ship);
  private readonly bodyShimmer = new Mesh(new TorusGeometry(1, 0.032, 4, 24),
    new MeshBasicMaterial({ color: 0xabf4ff, transparent: true, depthWrite: false }));
  private readonly trailMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0.94, depthWrite: false });
  private readonly ghost = new Mesh(this.ship.geometry, new MeshBasicMaterial({ transparent: true, opacity: 0.25, depthWrite: false }));
  private readonly ribbon = instances(new BoxGeometry(), TRAIL_LIMIT, this.trailMaterial);
  private readonly pursuitRings = instances(new TorusGeometry(1, 0.064, 4, 24), REGULAR_RENDER_CAP);
  private readonly enemyTrails = instances(new BoxGeometry(), REGULAR_RENDER_CAP * 2 + CROSSWING_TRAIL_SEGMENTS * 2, new MeshBasicMaterial({
    color: 0xa6e5f0, transparent: true, opacity: 0.48, depthWrite: false,
  }));
  private readonly trailTip: Position = { x: 0, z: 0, alt: 0 };
  private readonly rollSample: Roll = { kind: 'aileron', side: 1, altitude: 110, elapsed: 0 };
  private readonly rollFrom: Position = { x: 0, z: 0, alt: 0 };
  private readonly rollTo: Position = { x: 0, z: 0, alt: 0 };
  private readonly rollPose = { pitch: 0, roll: 0, cockpitPitch: 0, cameraPitch: 0, cameraBank: 0, inverted: false };
  private readonly exhaust = new EngineExhaust(this.ship);
  private readonly flareVisuals = new FlareVisuals();
  // --- S7f lane ---
  private readonly drones = instances(bakeAirframe(enemyAirframe('patrol')), REGULAR_RENDER_CAP, this.voxelMaterial);
  private readonly gnats = makeGnatBatch();
  private readonly airframes = (['interceptor', ...NEW_ENEMY_KINDS, 'aegis'] as const).map(kind => ({
    kind, mesh: instances(bakeAirframe(enemyAirframe(kind)), ENEMY_KINDS[kind].cap, this.voxelMaterial), count: 0,
  }));
  private readonly airframeByKind = new Map<EnemyKind, (typeof this.airframes)[number]>(this.airframes.map(batch => [batch.kind, batch]));
  private readonly rosterVisuals = new RosterVisuals();
  private readonly airframeLods = [
    airframeLod(this.ship, () => bakeAirframe(playerAirframe(true))),
    airframeLod(this.drones, () => bakeAirframe(enemyAirframe('patrol', true))),
    airframeLod(this.gnats, () => gnatGeometry(true)),
    ...this.airframes.map(({ kind, mesh }) => airframeLod(mesh, () => bakeAirframe(enemyAirframe(kind, true)))),
    airframeLod(this.rosterVisuals.ace, () => bakeAirframe(aceAirframe(true))),
  ];
  private detailedAirframes = false;
  private readonly pickupVisuals = new PickupVisuals();
  private readonly sortieVfx = new SortieVfx(TICKS_PER_SECOND);
  private readonly chestMarkers = makeChestBatch();
  private readonly bullets = instances(new BoxGeometry(), SHOT_LIMIT);
  private readonly sparks = instances(new BoxGeometry(), 240);
  private readonly gnatBatch = { x: 0, z: 0, alt: 0, life: 0, count: 0 };
  private readonly shadows = instances(new PlaneGeometry(2, 2).rotateX(-Math.PI / 2), REGULAR_RENDER_CAP + 2,
    new MeshBasicMaterial({ color: SHADOW.color, map: jetShadowTexture(), opacity: SHADOW.enemyOpacity,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
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
  private readonly aegisInnerRings = instances(createAegisRingGeometry(AEGIS_INNER_RADIUS), 2,
    new MeshBasicMaterial({ color: 0x62edff, transparent: true, opacity: 0.5, depthWrite: false }));
  private readonly aegisOuterRings = instances(createAegisRingGeometry(AEGIS_OUTER_RADIUS), 2,
    new MeshBasicMaterial({ color: 0x62edff, transparent: true, opacity: 0.5, depthWrite: false }));
  private readonly aegisSupports = instances(new BoxGeometry(), 32,
    new MeshBasicMaterial({ color: 0x62edff, transparent: true, opacity: 0.38, depthWrite: false }));
  private readonly flakColumns = instances(new CylinderGeometry(1, 1, 2, 12, 1, true), FLAK_COLUMN_LIMIT,
    new MeshBasicMaterial({ transparent: true, opacity: 0.18, depthWrite: false, side: DoubleSide, forceSinglePass: true }));
  private readonly arcMiddle: Position = { x: 0, z: 0, alt: 0 };
  private readonly dummy = new Object3D();
  private readonly color = new Color();
  private readonly vector = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly ground = (x: number, z: number) => this.world.height(x, z);
  private readonly hostileVisuals = new HostileVisuals(this.ground);

  constructor(canvas: HTMLCanvasElement, world: World, arena: StageState['arena'], options: FlightRenderOptions = {}) {
    if (options.fixture === 'damage') {
      this.gnats.geometry.dispose();
      this.gnats = makeGnatBatch(false, 200);
      this.airframeLods[2] = airframeLod(this.gnats, () => gnatGeometry(true));
    }
    this.world = world;
    this.quality = new AdaptiveQuality(options.quality ?? DEFAULT_QUALITY);
    this.comparisonScale = options.comparisonScale;
    this.feelEnabled = options.enabled ?? true;
    // The binary silhouette supplies coverage. Its translucent ink can fall below a 0.5 alpha test.
    if (!this.feelEnabled) this.shadows.material.alphaTest = 0.5;
    this.fixture = options.fixture ?? null;
    this.atmosphere = new FlightAtmosphere(arena, this.feelEnabled);
    this.surface = this.feelEnabled ? new FlightSurface(this.ground) : null;
    this.post = this.feelEnabled ? new FlightPost(this.target.texture) : null;
    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    // Three r170 trims nullable WebGL info logs before its error callback can run.
    this.renderer.debug.checkShaderErrors = false;
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x081424);
    this.scene.background = this.fog.color;
    this.scene.fog = this.fog;
    this.terrain = new TerrainStream(world, this.feelEnabled);
    if (this.atmosphere.cloudShadow) this.terrain.lookMaterial?.setCloudShadow(this.atmosphere.cloudShadow);
    this.scene.add(this.terrain.group, this.atmosphere.group);
    if (this.feelEnabled) this.scene.add(makeSky());
    this.scene.add(this.ship, this.drones, this.gnats, this.rosterVisuals.group, this.pickupVisuals.group, this.chestMarkers, this.bullets, this.sparks,
      this.shadows, this.bombs, this.blast, this.mines, this.flak, this.ghost, this.ribbon, this.pursuitRings, this.bodyShimmer,
      this.flareVisuals.group, this.hostileVisuals.group, this.enemyTrails,
      this.defenseDrones, this.weaponLinks, this.weaponRings, this.aegisInnerRings, this.aegisOuterRings,
      this.aegisSupports, this.flakColumns);
    // The camera looking through the tail must skip the player's model and forward-facing markers.
    this.ship.traverse(object => object.layers.set(MAIN_CAMERA_LAYER));
    if (this.feelEnabled) this.atmosphere.wind.layers.set(MAIN_CAMERA_LAYER);
    else this.atmosphere.group.traverse(object => object.layers.set(MAIN_CAMERA_LAYER));
    if (this.surface) {
      this.surface.group.traverse(object => object.layers.set(MAIN_CAMERA_LAYER));
      this.scene.add(this.surface.group);
    }
    for (const marker of [this.bodyShimmer, this.ghost, this.pursuitRings]) marker.layers.set(MAIN_CAMERA_LAYER);
    for (const camera of [this.top, this.chase, this.cockpit]) camera.layers.enable(MAIN_CAMERA_LAYER);
    this.ghost.visible = false;
    for (const { mesh } of this.airframes) this.scene.add(mesh);
    if (this.feelEnabled) installSteppedHaze(this.scene);
    this.top.up.set(0, 0, -1);
    this.screenCamera.position.z = 1;
    this.screen.add(this.post?.mesh ?? new Mesh(new PlaneGeometry(2, 2), new MeshBasicMaterial({
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

  resize(framing: Framing & { hud: HudLayout }): void {
    if (this.contextLost) return;
    const { width, height, phone, cockpit, hud } = framing;
    // --- S7f lane ---
    if (width !== this.framing.width || height !== this.framing.height || !!phone !== !!this.framing.phone) {
      this.quality.resetSamples();
    }
    this.framing = framing;
    this.rearSlot = layoutRearInset(hud, height, phone);
    this.mirrorSlot = cockpit && layoutRearMirror(cockpit, phone);
    // Allocate for the full cockpit reveal once per layout, then reuse it throughout the wipe.
    const mirror = this.mirrorSlot?.focus;
    this.rearTarget.setSize(mirror?.width ?? REAR_INSET_WIDTH, mirror?.height ?? REAR_INSET_HEIGHT);
    this.rearRect = null;
    this.rearTick = -Infinity;
    this.resizeWorldBuffer();
  }

  // --- S7f lane ---
  private setAirframeDetail(detailed: boolean): void {
    if (this.detailedAirframes === detailed) return;
    this.detailedAirframes = detailed;
    for (const lod of this.airframeLods) {
      if (detailed) lod.detailed ??= lod.bakeDetailed();
      lod.mesh.geometry = detailed ? lod.detailed! : lod.coarse;
    }
    this.ghost.geometry = this.ship.geometry;
  }

  private resizeWorldBuffer(): void {
    const { width, height, phone } = this.framing;
    if (width === 0 || height === 0 || this.contextLost) return;
    const buffer = renderBuffer(width, height, phone, this.quality.tier, this.comparisonScale);
    this.setAirframeDetail(RENDER_QUALITY[this.quality.tier].detailedModels);
    this.post?.resize(buffer.width, buffer.height, choosePostTier(!!phone));
    if (this.target.width !== buffer.width || this.target.height !== buffer.height) {
      this.target.setSize(buffer.width, buffer.height);
      this.renderer.setSize(buffer.width, buffer.height, false);
    }
    const { style } = this.renderer.domElement;
    style.width = buffer.cssScale === null ? '' : `${buffer.width * buffer.cssScale}px`;
    style.height = buffer.cssScale === null ? '' : `${buffer.height * buffer.cssScale}px`;
    this.rearTick = -Infinity;
  }

  setRenderQuality(tier: RenderQuality): void {
    this.quality.select(tier);
    this.resizeWorldBuffer();
  }

  observeRenderFrame(milliseconds: number | null): boolean {
    if (this.contextLost || !this.quality.observe(milliseconds)) return false;
    this.resizeWorldBuffer();
    return true;
  }

  get renderQuality(): RenderQuality { return this.quality.tier; }

  get contextLost(): boolean { return this.renderer.getContext().isContextLost(); }

  lossExtension(): WEBGL_lose_context | null {
    return this.renderer.getContext().getExtension('WEBGL_lose_context');
  }

  dispose(): void {
    // Loss has already freed the GL allocations. Detach Three's canvas listeners and drop its caches.
    this.sortieVfx.clear();
    this.renderer.dispose();
  }

  get rearView(): Readonly<Rect> | null {
    return this.rearRect;
  }

  get speedFeel(): Readonly<typeof this.flightView> {
    return this.flightView;
  }

  get cloudPass(): number {
    return this.atmosphere.cloudPass;
  }

  shock(kind: 'hit' | 'parry', tick: number): void {
    if (this.feelEnabled && !this.reducedMotion.matches) this.motion.shock(kind, tick);
  }

  get terrainPending(): boolean {
    return this.terrain.pending;
  }

  get cockpitMirror(): Readonly<Rect> | null {
    return this.framing.cockpit ? this.rearRect : null;
  }

  hostileMuzzle(shot: Shot, shape: HostileShape, x: number, z: number, alt: number, tick: number): void {
    this.hostileVisuals.muzzle(shot, shape, x, z, alt, tick);
  }

  hostileImpact(shot: Shot, x: number, z: number, alt: number, tick: number): void {
    this.hostileVisuals.impact(shot, x, z, alt, tick);
  }

  hostileGraze(shot: Shot, x: number, z: number, alt: number, tick: number): void {
    this.hostileVisuals.graze(shot, x, z, alt, tick);
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

  private drawRearView(state: StageState, rearDanger: boolean, refresh: boolean, forwardBank: number, rearPursuit?: Position): void {
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
      const width = Math.round(this.rearSlot.width * (rearPursuit ? 1 : reveal));
      if (width >= 8) {
        this.rearRect = { ...this.rearSlot, width };
        crop = (width - 6) / (this.rearSlot.width - 6);
      }
    }
    if (!this.rearRect) {
      this.flightView.rearBank = 0;
      return;
    }
    this.placeRearView(this.rearRect, crop);
    this.rearInset.visible = true;
    const bezel = this.rearBezel.material.color;
    const lining = this.rearLining.material.color;
    bezel.setHex(0x637b83);
    lining.setHex(0x0c1720);
    if (glimpse && reveal > 0) {
      const flash = this.reducedMotion.matches ? 1 : Math.max(0, 1 - (tick - glimpse.since) / 16);
      const activeColor = this.color.setHex(glimpse.kind === 'bomb' ? 0xf490af : 0xffb363);
      activeColor.lerp(this.rearFlash, flash * 0.55);
      bezel.lerp(activeColor, reveal);
    } else if (rearDanger) {
      const pulse = this.reducedMotion.matches || Math.floor(tick / 8) % 2 ? 1 : 0.55;
      bezel.lerp(this.color.setHex(0xff6256), pulse);
    }
    if (view === 'cockpit' && state.invulnerability > 0) {
      const pulse = this.reducedMotion.matches || shieldFlash(tick);
      bezel.lerp(this.color.setHex(0x8afff4), pulse ? 1 : 0.38);
      lining.setHex(pulse ? 0x357f8c : 0x182e3a);
    }

    if (!refresh && tick >= this.rearTick && tick - this.rearTick < 2) return;
    this.rearTick = tick;
    this.flightView.rearBank = forwardBank;
    frameRearCamera(this.rearCamera, state.player, reveal > 0 || !!rearPursuit,
      reveal > 0 ? glimpse?.target : rearPursuit, forwardBank);
    // TOP uses a flattened altitude plane. Rebuild world instances only on rear-feed updates.
    if (view === 'overhead') this.updateWorld(state, 'rear');
    else if (view === 'chase') this.flareVisuals.update(state);
    const forwardFogFar = this.fog.far;
    this.fog.far = FLIGHT_CAMERA.rearFar;
    this.hostileVisuals.setView(this.rearTarget.height);
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
    const roll = state.roll;
    if (roll) {
      const intervals = FLIGHT_FEEL.rollTrailMinimumIntervals;
      const minimumAge = WING_TRAIL.intervalTicks[this.framing.phone ? 'phone' : 'desktop'] * intervals;
      if (this.surface && this.fixture !== 'roll' && roll.elapsed >= minimumAge && this.surface.trailSegments >= 2 * intervals) {
        upload(this.ribbon, 0);
      } else {
        this.drawRollTrail(state, roll, flat);
      }
      return;
    }
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

  private drawRollTrail(state: StageState, roll: Roll, flat: boolean): void {
    const { player: p } = state, { lateral } = ROLLS[roll.kind];
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw), wingSpan = flat ? 9.6 : 8.7;
    const phase = Math.abs(rollAttitude(roll)) / (2 * Math.PI);
    const bobOffset = p.altitude - rollAltitude(roll);
    const sample = this.rollSample;
    sample.kind = roll.kind;
    sample.side = roll.side;
    sample.altitude = roll.altitude;
    this.trailMaterial.opacity = 0.82;
    let segments = 0;
    for (let wing = -1; wing <= 1; wing += 2) {
      for (let age = 0; age <= roll.elapsed + 1; age++) {
        sample.elapsed = age - 1;
        const angle = rollAttitude(sample), progress = Math.abs(angle) / (2 * Math.PI);
        const offset = roll.side * lateral * (progress - phase) + wingSpan * wing * Math.cos(angle);
        const aft = (roll.elapsed + 1 - age) * state.speed * STEP + 3.5;
        this.rollTo.x = p.x - fx * aft + fz * offset;
        this.rollTo.z = p.z - fz * aft - fx * offset;
        this.rollTo.alt = rollAltitude(sample) + bobOffset + wingSpan * wing * Math.sin(angle);
        if (age) this.connect(this.ribbon, segments++, this.rollFrom, this.rollTo, flat ? 1.6 : 1.05,
          age < roll.elapsed * 0.46 ? 0x76b7d7 : 0xadfff2, flat ? TOP_FLIGHT + 1 : undefined);
        this.rollFrom.x = this.rollTo.x;
        this.rollFrom.z = this.rollTo.z;
        this.rollFrom.alt = this.rollTo.alt;
      }
    }
    upload(this.ribbon, segments);
  }

  private writePursuitRing(index: number, x: number, z: number, alt: number): void {
    this.dummy.position.set(x, alt, -z);
    this.dummy.quaternion.copy(this.camera.quaternion);
    this.dummy.scale.setScalar(10);
    this.dummy.updateMatrix();
    this.pursuitRings.setMatrixAt(index, this.dummy.matrix);
    this.pursuitRings.setColorAt(index, this.color.setHex(0x91fff1));
  }

  private writeShadow(index: number, x: number, z: number, sx: number, sz: number, yaw: number, alt?: number): void {
    const cast = shadowOffset(alt === undefined ? 0 : alt - this.ground(x, z));
    const gx = x + cast.x, gz = z + cast.z;
    this.write(this.shadows, index, gx, gz, this.ground(gx, gz) + 0.9, yaw, sx, 1, sz);
  }

  private updateCamera(state: StageState, yaw: number, ignitionShake: number): PitchMark[] {
    const { width, height, phone } = this.framing;
    const p = state.player, feel = this.feelEnabled;
    const aspect = width / Math.max(1, height);
    const lens = this.boostLens;
    const view = this.flightView;
    const shake = feel ? this.motion.shake : ignitionShake;
    const shakeVertical = feel ? this.motion.shakeVertical : 0;
    view.shake = state.view === 'overhead' ? 0 : shake;
    view.boost = lens;
    view.sink = view.yawLag = 0;
    this.fog.near = TERRAIN_STREAM.fogNear + (feel ? 220 * altitudeHaze(p.altitude) : 0);
    const review = this.fixture === 'roster-sheet' ? state.boss ?? state.enemies[0] : null;
    if (review) {
      const camera = this.chase, { distance, rise, fov } = ROSTER_SHEET_CAMERA;
      view.fov = camera.fov = fov;
      view.setback = view.shake = view.cameraBank = 0;
      camera.setViewOffset(width, height, 0, 0, width, height);
      const eyeZ = review.z - distance;
      const eyeY = chaseEyeHeight(this.ground, review.x, eyeZ, review.alt + rise);
      camera.position.set(review.x, eyeY, -eyeZ);
      camera.lookAt(review.x, review.alt, -review.z);
      this.fog.far = terrainFogFar(aspect, camera.fov, Math.atan2(review.alt - eyeY, distance), 0, !!phone);
      this.camera = camera;
    } else if (state.view === 'overhead') {
      view.fov = view.setback = view.cameraBank = 0;
      this.fog.far = (phone ? TERRAIN_STREAM.phone : TERRAIN_STREAM.desktop).fogFar;
      const top = FLIGHT_CAMERA.top;
      const halfHeight = Math.max(top.minHeight, (phone ? top.phoneHalfWidth : top.desktopHalfWidth) / aspect) * this.topZoom;
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
      const { cameraPitch: pitch, fovPitch, cameraBank: bank } = this.cockpitPose;
      const cockpitLens = this.cockpitLens;
      const widening = cockpitLens.widening = (feel ? FLIGHT_FEEL.cockpitWidening : 4) * lens;
      const pullback = cockpitLens.pullback = 1.4 * lens;
      cockpitLens.shake = shake + (feel ? this.motion.headX : 0);
      cockpitLens.shakeVertical = shakeVertical + (feel ? this.motion.headY : 0);
      view.fov = cockpitFov(aspect, fovPitch, widening);
      view.setback = pullback;
      view.cameraBank = bank;
      this.fog.far = terrainFogFar(aspect, view.fov, pitch, bank, !!phone, p.altitude);
      const visibleDepth = visibleHazeCutoff(this.fog.near, this.fog.far, feel);
      return frameCockpit(this.cockpit, p, this.framing, this.cockpitPose, this.ground, visibleDepth, yaw, cockpitLens);
    } else {
      const camera = this.chase;
      const field = phone?.playfield;
      const m = state.maneuver;
      const motion = m ? Math.sin(Math.PI * m.elapsed / MANEUVERS[m.kind].ticks) : 0;
      const chase = FLIGHT_CAMERA.chase;
      const retreat = m ? chase.maneuverRetreat[m.kind] : 0;
      const lift = m?.kind === 'split-s' ? 11 : m?.kind === 'immelmann' ? 8 : 0;
      const baseSetback = chase.setback + Math.max(0, 1 - aspect) * chase.portraitSetback;
      view.setback = (feel ? -baseSetback * FLIGHT_FEEL.chaseCloser : 8) * lens;
      view.sink = feel ? FLIGHT_FEEL.chaseSink * lens : 0;
      const setback = baseSetback + motion * retreat + view.setback;
      const elevation = 15 + motion * lift - view.sink;
      const lookHeight = 1 + (m?.kind === 'immelmann' || m?.kind === 'split-s' ? this.cockpitPose.cameraPitch * 48 : 0);
      const center = field ? (field.y + field.height * 0.39) / height : 0.43;
      const shift = clamp(center, 0.29, 0.64);
      const widening = (feel ? FLIGHT_FEEL.chaseWidening : 10) * lens;
      camera.fov = view.fov = Math.max(60, 2 * Math.atan(Math.tan(16 * Math.PI / 180) / aspect) * 180 / Math.PI) + widening;
      view.cameraBank = feel ? this.motion.chaseBank : 0;
      camera.setViewOffset(width, height, 0, Math.round(height * (0.5 - shift)), width, height);
      const followYaw = feel ? this.motion.chaseYaw : yaw;
      const fx = Math.sin(followYaw), fz = Math.cos(followYaw);
      const eyeX = p.x + fz * shake, eyeZ = p.z - fx * shake;
      // The camera trails the ship's climb a little and tilts with its path: up the sky in a climb, down at the ground in a dive.
      const tilt = feel ? this.motion.chaseTilt : 0, tilting = FLIGHT_FEEL.chaseTilt;
      const followAlt = feel && Number.isFinite(this.motion.followAlt) ? this.motion.followAlt : p.altitude;
      const eyeY = followAlt + shakeVertical;
      const x = eyeX - fx * setback, z = eyeZ - fz * setback;
      const desiredY = eyeY + elevation - setback * Math.sin(tilt) * tilting.drop;
      const y = chaseEyeHeight(this.ground, x, z, desiredY);
      const aimDistance = chase.lookAhead + setback;
      let aimAltitude = eyeY + lookHeight + Math.tan(tilt) * aimDistance * tilting.aim;
      if (y > desiredY + 1e-6) {
        // Keep the ship inside the flight viewport as the camera rises over an obstacle.
        const pitchDelta = Math.atan2(eyeY - y, setback) + Math.atan2(desiredY - eyeY, setback);
        aimAltitude = y + Math.tan(Math.atan2(aimAltitude - desiredY, aimDistance) + pitchDelta) * aimDistance;
      }
      this.fog.far = terrainFogFar(aspect, camera.fov, Math.atan2(aimAltitude - y, aimDistance), view.cameraBank, !!phone, p.altitude);
      camera.position.set(x, y, -z);
      camera.lookAt(eyeX + fx * chase.lookAhead, aimAltitude, -(eyeZ + fz * chase.lookAhead));
      if (view.cameraBank) camera.rotateZ(view.cameraBank);
      view.yawLag = yaw - followYaw;
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

  recordWeaponHit(weapon: WeaponId, position: Position, tick: number, source?: Position): void {
    this.sortieVfx.hit(weapon, { tick, position, source });
  }

  recordEnemyDefeat(event: { id: number; tick: number; position: Position; formationId?: number; armored?: boolean }): void {
    this.sortieVfx.enemyDefeated(event);
  }

  recordBossDefeat(event: { id: number; tick: number; position: Position }): void {
    this.sortieVfx.bossDefeated(event);
  }

  recordPickupVfx(event: PickupVisualEvent): void {
    this.sortieVfx.pickupEvent(event);
  }

  drawSortieVfx(ctx: CanvasRenderingContext2D, state: StageState, mode: SortieVfxMode, nowMs: number): void {
    const boss = mode === 'flight' && state.boss?.hp ? this.projectAirframe(state, 'boss') : null;
    this.sortieVfx.draw(ctx, state, point => this.project(point), (x, z) => this.world.height(x, z), boss,
      this.reducedMotion.matches, mode, nowMs,
      (from, to) => clipProjectSortieSegment(this.camera, this.framing.width, this.framing.height, from, to));
  }

  clearSortieVfx(): void { this.sortieVfx.clear(); }

  // Match the model size and the flattened TOP presentation, not its simulation altitude.
  projectAirframe(state: StageState, subject: 'boss' | 'player') {
    const boss = subject === 'boss', vehicle = boss ? state.boss : state.player;
    if (!vehicle) return null;
    const mesh = boss ? this.rosterVisuals.ace : this.ship;
    const alt = state.view === 'overhead' ? TOP_FLIGHT + (boss ? 1 : 3) : 'alt' in vehicle ? vehicle.alt : vehicle.altitude;
    const point = this.project({ x: vehicle.x, z: vehicle.z, alt });
    if (!point) return null;
    const depth = -this.vector.set(vehicle.x, alt, -vehicle.z).applyMatrix4(this.camera.matrixWorldInverse).z;
    const scale = this.framing.height * this.camera.projectionMatrix.elements[5] / 2;
    const radius = (mesh.geometry.boundingSphere?.radius ?? 0) * mesh.scale.x * scale / (this.camera === this.top ? 1 : depth);
    return { ...point, radius };
  }

  // Keep unclipped screen coordinates so cockpit markers can point outside the glass.
  projectContact(target: Position, out: ContactProjection): void {
    projectCameraContact(this.camera, this.framing, target, out, this.vector);
  }

  private updatePlayer(state: StageState, attitude: ReturnType<typeof maneuverAttitude> | null): void {
    const p = state.player, flat = state.view === 'overhead';
    const chase = state.view === 'chase', external = flat || chase;
    this.ship.visible = this.fixture !== 'roster-sheet' && external && (state.invulnerability <= 0 || shieldFlash(state.tick));
    this.ship.position.set(p.x, flat ? TOP_FLIGHT + 3 : p.altitude, -p.z);
    this.ship.scale.setScalar(chase ? 0.9 : 1);
    const climbPitch = flat || state.roll || !maneuverAllowsControl(state.maneuver) ? 0
      : this.feelEnabled ? this.motion.pitch : p.pitch;
    const bank = attitude?.roll ?? (flat && !this.feelEnabled ? 0 : -p.bank);
    this.flightView.shipBank = bank;
    this.ship.rotation.set((attitude?.pitch ?? 0) + climbPitch, -p.yaw, bank, 'YXZ');
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

  private drawWeaponEffects(state: StageState, view: StageState['view'] | 'rear', flat: boolean, links: number): void {
    const plane = flat ? OVERHEAD_EFFECT_PLANE_ALTITUDE : undefined;
    let rings = 0, columns = 0, drones = 0, aegisInnerRingCount = 0, aegisOuterRingCount = 0, aegisSupportCount = 0;
    if (state.run?.evolutions.pods) {
      const p = state.player;
      const centerAlt = plane ?? p.altitude, tint = 0x62edff;
      for (const boundary of AEGIS_VOLUME_OUTLINE.rings) {
        const alt = centerAlt + (flat ? 0 : boundary.alt);
        if (boundary.radius === AEGIS_INNER_RADIUS) {
          this.write(this.aegisInnerRings, aegisInnerRingCount++, p.x, p.z, alt, 0, 1, 1, 1, tint);
        } else {
          this.write(this.aegisOuterRings, aegisOuterRingCount++, p.x, p.z, alt, 0, 1, 1, 1, tint);
        }
      }
      if (!flat) {
        for (const support of AEGIS_VOLUME_OUTLINE.supports) {
          const from = { x: p.x + support.from.x, z: p.z + support.from.z, alt: p.altitude + support.from.alt };
          const to = { x: p.x + support.to.x, z: p.z + support.to.z, alt: p.altitude + support.to.alt };
          this.connect(this.aegisSupports, aegisSupportCount++, from, to, 0.3, tint);
        }
      }
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
          const charge = fx.kind === 'rail-charge', glow = fx.kind === 'rail-glow';
          const width = charge ? 0.64 : (fx.radius ?? 3) * (glow ? 0.22 : 0.5) * (0.45 + fade * 0.55);
          this.connect(this.weaponLinks, links++, from, to, width, charge ? 0x79baff : glow ? 0x477fb2 : 0xbbfaff, plane);
        }
      } else if (fx.radius) {
        const tint = fx.kind === 'flak-blast' ? 0xffa363 : fx.kind === 'arc-blast' ? 0xffdf72
          : fx.kind === 'ground-fire' ? 0xff692c : fx.kind === 'flare-spread' ? 0xffb546 : 0xffb69b;
        const radius = fx.kind === 'ground-fire' ? fx.radius : fx.radius * (1 - 0.31 * Math.min(1, left / 20));
        if (rings < WEAPON_RING_LIMIT) {
          this.write(this.weaponRings, rings++, from.x, from.z, plane ?? from.alt, 0, radius, 1, radius, tint);
        }
        if (!flat && fx.kind === 'flak-blast' && columns < FLAK_COLUMN_LIMIT) {
          const height = fx.halfHeight ?? hitWindow(state, WEAPONS.flak.tuning.halfHeight);
          this.write(this.flakColumns, columns++, from.x, from.z, from.alt, 0, radius, height, radius, tint);
        }
      }
    }
    // Sparse Ion Wake motes follow the hit path outside the camera clearance.
    const wake = state.ionWake;
    const plasma = !!state.run?.evolutions.ion;
    const width = WEAPONS.ion.tuning.width[(state.run?.weaponLevels.ion ?? 1) - 1]
      * (plasma ? CLOSE_EVOLUTIONS.plasma.widthScale : 1);
    const eye = flat ? null : (view === 'rear' ? this.rearCamera : this.camera).position;
    const clearance = view === 'chase' ? ION_MOTE.chaseClearance : ION_MOTE.cockpitClearance;
    const base = (plasma ? ION_MOTE.plasmaSize : ION_MOTE.size) * (eye && view !== 'chase' ? ION_MOTE.cockpitScale : 1);
    const nextInLane: (typeof wake)[number][] = [];
    const dense = wake.some(mote => mote.lane !== undefined);
    for (let i = wake.length - 1; i >= 0 && links < WEAPON_LINK_LIMIT; i--) {
      const mote = wake[i], left = mote.until - state.tick;
      const lane = mote.lane ?? 0, next = nextInLane[lane];
      nextInLane[lane] = mote;
      if (left <= 0) continue;
      const alt = plane ?? mote.alt;
      if (eye && (mote.x - eye.x) ** 2 + (alt - eye.y) ** 2 + (mote.z + eye.z) ** 2 < clearance ** 2) continue;
      const fade = Math.min(1, left / ION_MOTE.fadeTicks), size = base * (0.45 + 0.55 * fade);
      const lit = ((state.tick >> 2) + i) & 1;
      const tint = plasma ? lit ? 0xe4bdff : 0xba93ff : lit ? 0x8affe6 : 0x43c6b3;
      this.write(this.weaponLinks, links++, mote.x, mote.z, alt, 0, size, size, size, tint);
      // Every other sample marks the wake's hit width with two edge motes.
      if (i % (dense ? 5 : 2) || links + 2 > WEAPON_LINK_LIMIT) continue;
      if (!next) continue;
      const dx = next.x - mote.x, dz = next.z - mote.z, run = Math.hypot(dx, dz) || 1;
      const sideX = dz / run * width, sideZ = -dx / run * width, edge = size * ION_MOTE.edgeScale;
      for (const side of [-1, 1]) {
        const x = mote.x + side * sideX, z = mote.z + side * sideZ;
        if (eye && (x - eye.x) ** 2 + (alt - eye.y) ** 2 + (z + eye.z) ** 2 < clearance ** 2) continue;
        this.write(this.weaponLinks, links++, x, z, alt, 0, edge, edge, edge, tint);
      }
    }
    upload(this.defenseDrones, drones);
    upload(this.weaponLinks, links);
    upload(this.weaponRings, rings);
    upload(this.aegisInnerRings, aegisInnerRingCount);
    upload(this.aegisOuterRings, aegisOuterRingCount);
    upload(this.aegisSupports, aegisSupportCount);
    upload(this.flakColumns, columns);
  }

  private updateWorld(state: StageState, view: StageState['view'] | 'rear'): void {
    const p = state.player, flat = view === 'overhead';
    const chase = view === 'chase', external = flat || chase;
    const castShadows = this.feelEnabled || !flat;
    const trail = activeTrail(state);
    this.drawTrail(state, trail, flat, external);
    const fireTint = Math.floor(state.tick / 6) % 2 ? 0xff9564 : 0xffbf78;

    let shadows = 0, drones = 0, gnats = 0, rings = 0, marked = 0, trails = 0, chestMarkers = 0;
    if (chase && !this.surface) this.writeShadow(shadows++, p.x, p.z, 9.5, 8, p.yaw, p.altitude);
    for (const batch of this.airframes) batch.count = 0;
    for (const enemy of state.enemies) {
      if (enemy.kind === 'gnat') {
        if (gnats < state.swarmCap) {
          const livery = enemy.gnatVariant && GNAT_LIVERY[enemy.gnatVariant];
          const tint = (enemy.burnUntil ?? 0) > state.tick ? fireTint
            : livery ? livery.tints[flat ? enemy.band : 1] : flat ? GNAT_BAND_TINTS[enemy.band] : 0xffb289;
          this.write(this.gnats, gnats++, enemy.x, enemy.z, flat ? TOP_FLIGHT - 1 : enemy.alt,
            enemy.yaw, livery?.width ?? 1, livery?.height ?? 1, livery?.length ?? 1, tint, flat ? 0 : enemy.bank);
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
      const attackTrail = enemy.kind === 'crosswing' ? crosswingTrail(enemy) : null;
      if (attackTrail && trails + attackTrail.length - 1 <= this.enemyTrails.instanceMatrix.count) {
        const recoveryFade = enemy.crosswing?.phase === 'recovery'
          ? clamp(((enemy.crosswing.until ?? state.tick) - state.tick) / 60, 0, 1) : 1;
        for (let segment = 0; segment + 1 < attackTrail.length; segment++) {
          const recency = (segment + 1) / (attackTrail.length - 1);
          const brightness = (0.32 + 0.68 * recency) * recoveryFade;
          this.connect(this.enemyTrails, trails++, attackTrail[segment], attackTrail[segment + 1],
            flat ? 1.65 : 1.1, this.color.setRGB(brightness, brightness, brightness).getHex(), flat ? TOP_FLIGHT + 1 : undefined);
        }
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
      if (castShadows && enemy.kind !== 'turret') this.writeShadow(shadows++, enemy.x, enemy.z, 7, 5.5, enemy.yaw, enemy.alt);
    }
    upload(this.drones, drones);
    upload(this.gnats, gnats);
    upload(this.pursuitRings, marked);
    upload(this.enemyTrails, trails);
    for (const { mesh, count } of this.airframes) upload(mesh, count);

    // --- S7e lane ---
    const boss = state.boss;
    if (castShadows && boss && !boss.crashed) this.writeShadow(shadows++, boss.x, boss.z, 14, 11, boss.yaw, boss.alt);
    this.rosterVisuals.update(state, flat ? TOP_FLIGHT : undefined, this.reducedMotion.matches);
    upload(this.shadows, shadows);

    // --- S7f lane ---
    this.pickupVisuals.update(state, flat ? TOP_FLIGHT + 5 : undefined, this.reducedMotion.matches,
      this.sortieVfx.pickupTrailCapacity(state.tick));

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
      if (shot.kind === 'hostile') continue;
      const yaw = Math.atan2(shot.vx, shot.vz);
      const strafe = shot.kind === 'strafe', reversal = !!shot.reversal;
      // Keep the closest ends of the boosted tracers out of the pilot's eyeline.
      if (eye && reversal && (shot.x - eye.x) ** 2 + (shot.alt - eye.y) ** 2 + (shot.z + eye.z) ** 2 < COCKPIT_TRACER_CLEARANCE ** 2) continue;
      const vy = shot.vy ?? 0;
      const pitch = flat ? 0 : Math.atan2(vy, Math.hypot(shot.vx, shot.vz));
      const style = RANGED_SHOT_STYLE[shot.kind];
      const size = shot.tracerScale ?? 1;
      const width = (style?.[0] ?? (reversal ? (eye ? 2.6 : 3.4) : 1.15)) * size;
      const length = (style?.[1] ?? (reversal ? (eye ? 12 : 15.5) : strafe ? 9 : 7.2)) * size;
      const tint = shot.aurora ? reversal ? 0x89ffea : 0xbd96ff
        : style?.[2] ?? (reversal ? 0xbaffff : strafe ? 0xffb45c : shot.kind === 'pods'
          ? shot.pierce ? 0x7cdfff : 0x73ffb4
          : shot.pierce ? 0xffb65d : 0xf6ffad);
      this.write(this.bullets, bullets++, shot.x, shot.z, flat ? TOP_FLIGHT + 2 : shot.alt, yaw,
        width, width, length, tint, 0, pitch);
      if (shot.kind === 'seeker' && weaponLinks < WEAPON_LINK_LIMIT) {
        const tail = 8 / Math.max(1, Math.hypot(shot.vx, shot.vz, vy));
        this.write(this.weaponLinks, weaponLinks++, shot.x - shot.vx * tail, shot.z - shot.vz * tail,
          flat ? TOP_FLIGHT + 2 : shot.alt - vy * tail, yaw, 1.25, 1.25, 11, 0xc5bcae, 0, pitch);
      }
    }
    upload(this.bullets, bullets);
    this.drawWeaponEffects(state, view, flat, weaponLinks);

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
    const batchedGnats = batchBursts(state.effects, effect => gnatBursts.has(effect), this.gnatBatch);
    if (batchedGnats) {
      const batch = this.gnatBatch;
      for (let i = 0; i < COMBAT_FEEDBACK.batchParticles && sparks < 240; i++) {
        const angle = i * 2.4, reach = 4 + (0.42 - batch.life) * 65;
        this.write(this.sparks, sparks++, batch.x + Math.sin(angle) * reach, batch.z + Math.cos(angle) * reach,
          flat ? TOP_FLIGHT + 7 : batch.alt + Math.cos(angle) * reach, angle, 3, 3, 7, 0xffd780);
      }
    }
    for (const effect of state.effects) {
      if (batchedGnats && gnatBursts.has(effect)) continue;
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

  private noteBlasts(state: StageState): void {
    const p = state.player, range = FLIGHT_FEEL.explosionRange;
    let strength = 0;
    for (const effect of state.effects) {
      if (effect.kind !== 'bomb-blast' && effect.kind !== 'flak' && effect.kind !== 'burst') continue;
      if (this.seenBlasts.has(effect)) continue;
      this.seenBlasts.add(effect);
      const distance = Math.hypot(effect.x - p.x, effect.alt - p.altitude, effect.z - p.z);
      const scale = effect.kind === 'burst' ? FLIGHT_FEEL.burstSize : 1;
      if (distance < range) strength = Math.max(strength, (1 - distance / range) * scale);
    }
    if (strength > 0) this.motion.shock('explosion', state.tick, strength);
  }

  draw(state: StageState, rearDanger = false, rearPursuit?: Position): PitchMark[] | null {
    if (this.contextLost) return null;
    try {
      const ladder = this.drawFrame(state, rearDanger, rearPursuit);
      return this.contextLost ? null : ladder;
    } catch (error) {
      // Loss can begin in a draw call before the canvas event is dispatched.
      if (!this.contextLost) throw error;
      return null;
    }
  }

  private drawFrame(state: StageState, rearDanger: boolean, rearPursuit?: Position): PitchMark[] {
    const reduceMotion = this.reducedMotion.matches;
    const phone = !!this.framing.phone;
    const delta = state.tick - this.lastMotionTick;
    this.lastMotionTick = state.tick;
    const ticks = clamp(delta, 0, 12);
    const yaw = maneuverViewYaw(state);
    const bank = -state.player.bank;
    let attitude = state.maneuver ? maneuverAttitude(state.maneuver, state.player.bank) : null;
    if (state.roll) {
      const pose = this.rollPose;
      pose.roll = rollAttitude(state.roll) + (this.feelEnabled ? bank : 0);
      pose.cameraBank = reduceMotion ? 0 : pose.roll;
      pose.inverted = Math.cos(pose.roll) < 0;
      attitude = pose;
    }
    this.cockpitPose.cameraPitch = this.cockpitPose.fovPitch = attitude?.cameraPitch ?? 0;
    let ignitionShake = 0, rearBank = 0;
    if (this.feelEnabled) {
      const spinning = !!state.roll;
      if (!reduceMotion) this.noteBlasts(state);
      const p = state.player, controlled = !state.roll && maneuverAllowsControl(state.maneuver);
      this.motion.advance(state, yaw, spinning ? this.rollPose.roll : bank, spinning, phone, reduceMotion,
        { altitude: p.altitude, pitch: p.pitch, climbRate: state.climbRate, controlled, turn: p.bank / 1.5 });
      if (!attitude) this.cockpitPose.cameraPitch = this.motion.pitch;
      this.boostLens = this.motion.boost;
      rearBank = this.cockpitPose.cameraBank = cameraBank(attitude?.cameraBank ?? bank, 'cockpit', phone, reduceMotion, spinning);
    } else {
      if (delta < 0 || reduceMotion) this.boostLens = 0;
      const target = reduceMotion ? 0 : Number(state.boosting);
      this.boostLens += (target - this.boostLens) * (1 - Math.exp(-ticks / (target ? 4.5 : 8)));
      const ignition = state.boostTicks;
      if (!reduceMotion && ignition > 0 && ignition <= 8) ignitionShake = Math.sin(ignition * 1.8) * (9 - ignition) * 0.028;
      this.cockpitPose.cameraBank = attitude?.cameraBank ?? 0;
    }
    const terrainWasPending = this.terrain.pending;
    if (this.terrain.lookMaterial) this.terrain.lookMaterial.time.value = state.tick * STEP;
    const terrainBuilt = this.terrain.update(state.player.x, state.player.z, phone, state.worldSites);
    const terrainSettled = (terrainWasPending || terrainBuilt > 0) && !this.terrain.pending;
    // Overhead: lower flight zooms in on the ground, higher flight takes in more of it.
    const zoomGoal = this.feelEnabled ? overheadZoom(state.player.altitude) : 1;
    this.topZoom = delta < 0 || delta > 60 ? zoomGoal : this.topZoom + (zoomGoal - this.topZoom) * (1 - Math.exp(-3 * ticks * STEP));
    const ladder = this.updateCamera(state, yaw, ignitionShake);
    const view = this.flightView;
    view.streaks = this.atmosphere.update(this.fixture !== 'roster-sheet' && this.camera instanceof PerspectiveCamera ? this.camera : null,
      state, ticks, reduceMotion, this.boostLens, phone, this.fixture);
    view.cloudFlash = this.atmosphere.cloudFlash;
    this.updatePlayer(state, attitude);
    const surface = this.surface;
    if (surface && this.fixture !== 'roster-sheet') {
      const plane = state.view === 'overhead' ? TOP_FLIGHT + 1 : undefined;
      surface.update(state, this.ship, this.camera, plane, ticks, this.boostLens, phone, this.fixture);
      view.trailSegments = surface.trailSegments;
      view.wakeMarks = surface.wakeMarks;
      view.clearance = surface.clearance;
    }
    this.updateWorld(state, state.view);
    const hostileColorsChanged = this.hostileVisuals.update(state);
    this.hostileVisuals.setView(this.target.height, state.view === 'overhead' ? TOP_FLIGHT + 6 : undefined);
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.drawRearView(state, rearDanger, hostileColorsChanged || terrainSettled, rearBank, rearPursuit);
    this.post?.prepare(this.renderer, this.boostLens, view.cloudFlash, state.tick);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.screen, this.screenCamera);
    return ladder;
  }
}
