import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group, InstancedBufferAttribute,
  InstancedMesh, Mesh, MeshBasicMaterial, Object3D, OctahedronGeometry, Sphere, Vector3,
} from 'three';
import { FORGE_GROUND } from './data/palette.ts';
import { SITE_MARKERS, TERRAIN_DECOR, TERRAIN_STREAM } from './data/terrain-stream.ts';
import { FOREST_THRESHOLD, forestCover, ForgeTerrainMaterial } from './forge-terrain.ts';
import { WorldPaletteMaterial } from './post.ts';
import type { WorldSite } from './reach.ts';
import type { Ground } from './stage-types.ts';
import { isWater, TERRAIN_MAX_ALTITUDE, TERRAIN_MESH_STEP, TERRAIN_MIN_ALTITUDE, worldHash, type World } from './world.ts';

const SIZE = TERRAIN_STREAM.chunkSize;
const CELLS = SIZE / TERRAIN_MESH_STEP;
const SIDE = TERRAIN_STREAM.desktop.radius * 2 + 1;
const FINE = 0, MIDDLE = 1, COARSE = 2;
const vertex = (col: number, row: number) => row * (CELLS + 1) + col;

export function chaseEyeHeight(ground: Ground, x: number, z: number, desired: number): number {
  return Math.max(desired, ground(x, z) + TERRAIN_STREAM.chaseEyeClearance);
}

const GRID = new Float32Array((CELLS + 1) ** 2 * 3);
for (let row = 0; row <= CELLS; row++) for (let col = 0; col <= CELLS; col++) {
  const index = vertex(col, row) * 3;
  GRID[index] = col * TERRAIN_MESH_STEP;
  GRID[index + 2] = -(row * TERRAIN_MESH_STEP);
}

function terrainLod(stride: number) {
  const indices: number[] = [];
  for (let row = 0; row < CELLS; row += stride) for (let col = 0; col < CELLS; col += stride) {
    const east = col + stride, north = row + stride;
    if (stride === 1 || (col > 0 && row > 0 && east < CELLS && north < CELLS)) {
      // Keep the gameplay surface's diagonal, with world Z reversed for Three.js.
      indices.push(vertex(col, north), vertex(col, row), vertex(east, north),
        vertex(col, row), vertex(east, row), vertex(east, north));
      continue;
    }
    // Fan the outside cells down to the same 16 m border on every resolution.
    const center = vertex(col + stride / 2, row + stride / 2);
    const southStep = row === 0 ? 1 : stride;
    const eastStep = east === CELLS ? 1 : stride;
    const northStep = north === CELLS ? 1 : stride;
    const westStep = col === 0 ? 1 : stride;
    for (let x = col; x < east; x += southStep) indices.push(center, vertex(x, row), vertex(x + southStep, row));
    for (let z = row; z < north; z += eastStep) indices.push(center, vertex(east, z), vertex(east, z + eastStep));
    for (let x = east; x > col; x -= northStep) indices.push(center, vertex(x, north), vertex(x - northStep, north));
    for (let z = north; z > row; z -= westStep) indices.push(center, vertex(col, z), vertex(col, z - westStep));
  }
  return { index: new BufferAttribute(new Uint16Array(indices), 1), vertices: new Uint16Array(new Set(indices)) };
}

const LODS = TERRAIN_STREAM.lodStrides.map(terrainLod);
const DECOR_STEP = TERRAIN_DECOR.spacing;
const DECOR_CELLS = DECOR_STEP / TERRAIN_MESH_STEP;
const DECOR_CAPACITY = (SIZE / DECOR_STEP) ** 2 * 2;
const TREE_CELLS = Math.round(SIZE / 24);
const TREE_SPACING = SIZE / TREE_CELLS;
const NEAR_SIDE = Math.max(TERRAIN_STREAM.desktop.detailRadius, TERRAIN_STREAM.phone.detailRadius) * 2 + 1;
const HEIGHT_RANGE = TERRAIN_MAX_ALTITUDE - TERRAIN_MIN_ALTITUDE;
const BOUNDS = new Sphere(new Vector3(SIZE / 2, TERRAIN_MIN_ALTITUDE + HEIGHT_RANGE / 2, -SIZE / 2),
  Math.hypot(SIZE / 2, HEIGHT_RANGE / 2, SIZE / 2));
const DECOR_BOUNDS = new Sphere(BOUNDS.center, BOUNDS.radius + 12);

const OFFSETS: { x: number; z: number; ring: number }[] = [];
for (let z = -TERRAIN_STREAM.desktop.radius; z <= TERRAIN_STREAM.desktop.radius; z++) {
  for (let x = -TERRAIN_STREAM.desktop.radius; x <= TERRAIN_STREAM.desktop.radius; x++) {
    OFFSETS.push({ x, z, ring: Math.max(Math.abs(x), Math.abs(z)) });
  }
}
OFFSETS.sort((a, b) => a.ring - b.ring || a.x ** 2 + a.z ** 2 - b.x ** 2 - b.z ** 2);

function instanceBatch(geometry: BufferGeometry, material: MeshBasicMaterial, capacity: number): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
  mesh.count = 0;
  mesh.visible = false;
  return mesh;
}

function finishBatch(mesh: InstancedMesh, count: number): void {
  mesh.count = count;
  mesh.visible = count > 0;
  if (!count) return;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor!.needsUpdate = true;
}

function shadedBox(): BoxGeometry {
  const geometry = new BoxGeometry();
  const normal = geometry.getAttribute('normal'), colors = new Float32Array(normal.count * 3);
  for (let i = 0; i < normal.count; i++) {
    const y = normal.getY(i);
    const shade = y > 0 ? 0 : normal.getX(i) < 0 ? 0.45 : normal.getZ(i) < 0 ? 0.62 : 1;
    colors[i * 3] = 1 - 0.38 * shade;
    colors[i * 3 + 1] = 1 - 0.33 * shade;
    colors[i * 3 + 2] = 1 - 0.20 * shade;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

type Chunk = { x: number; z: number; lod: number; mesh: Mesh; legacyDecor: InstancedMesh | null };
const wrapSlot = (coordinate: number, side = SIDE) => ((coordinate % side) + side) % side;

export class TerrainStream {
  readonly group = new Group();
  readonly lookMaterial: ForgeTerrainMaterial | null;
  private readonly world: World;
  private readonly chunks: Chunk[] = [];
  private readonly nearDecor: InstancedMesh[] = [];
  private readonly shape = new BoxGeometry();
  private readonly material = new MeshBasicMaterial();
  private readonly siteBases = instanceBatch(this.shape, this.material, SITE_MARKERS.capacity * 2);
  private readonly siteCaps = instanceBatch(new OctahedronGeometry(), this.material, SITE_MARKERS.capacity);
  private readonly transform = new Object3D();
  private readonly color = new Color();
  private sites: readonly WorldSite[] | undefined;
  private siteCount = 0;
  private seed = -1;
  private centerX = 0;
  private centerZ = 0;
  private mobile = false;
  private cursor = 0;
  private windowSize = OFFSETS.length;

  constructor(world: World, look = false) {
    this.world = world;
    this.lookMaterial = look ? new ForgeTerrainMaterial() : null;
    this.group.name = 'Streamed world';
    const material = this.lookMaterial ?? new MeshBasicMaterial({ vertexColors: true });
    if (look) {
      const shape = shadedBox(), foliage = new WorldPaletteMaterial({ vertexColors: true });
      for (let i = 0; i < NEAR_SIDE ** 2; i++) {
        const decor = instanceBatch(shape, foliage, TREE_CELLS ** 2 * 2);
        decor.name = 'Near voxel trees and rocks';
        decor.matrixAutoUpdate = false;
        decor.boundingSphere = DECOR_BOUNDS;
        this.group.add(decor);
        this.nearDecor.push(decor);
      }
    }
    for (let i = 0; i < SIDE ** 2; i++) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(GRID.slice(), 3).setUsage(DynamicDrawUsage));
      if (look) {
        geometry.setAttribute('aSeabed', new BufferAttribute(new Float32Array(GRID.length / 3), 1).setUsage(DynamicDrawUsage));
        geometry.setAttribute('aSlope', new BufferAttribute(new Float32Array(GRID.length / 3 * 2), 2).setUsage(DynamicDrawUsage));
      } else {
        geometry.setAttribute('color', new BufferAttribute(new Float32Array(GRID.length), 3).setUsage(DynamicDrawUsage));
      }
      geometry.boundingSphere = BOUNDS;
      const mesh = new Mesh(geometry, material);
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      const legacyDecor = look ? null : instanceBatch(this.shape, this.material, DECOR_CAPACITY);
      if (legacyDecor) {
        legacyDecor.matrixAutoUpdate = false;
        legacyDecor.boundingSphere = DECOR_BOUNDS;
        mesh.add(legacyDecor);
      }
      this.group.add(mesh);
      this.chunks.push({ x: 0, z: 0, lod: -1, mesh, legacyDecor });
    }
    this.siteBases.name = 'World site pedestals and beams';
    this.siteCaps.name = 'World site markers';
    this.group.add(this.siteBases, this.siteCaps);
  }

  get pending(): boolean {
    return this.cursor < this.windowSize;
  }

  update(x: number, z: number, mobile: boolean, sites?: readonly WorldSite[]): number {
    const cx = Math.floor(x / SIZE), cz = Math.floor(z / SIZE);
    const tier = mobile ? TERRAIN_STREAM.phone : TERRAIN_STREAM.desktop;
    const seedChanged = this.world.seed !== this.seed;
    if (seedChanged && this.lookMaterial) this.lookMaterial.seed.value = this.world.seed;
    this.updateSites(sites, seedChanged);
    if (seedChanged || mobile !== this.mobile || cx !== this.centerX || cz !== this.centerZ) {
      this.seed = this.world.seed;
      this.centerX = cx;
      this.centerZ = cz;
      this.mobile = mobile;
      this.cursor = 0;
      this.windowSize = (tier.radius * 2 + 1) ** 2;
      for (let i = 0; i < this.chunks.length; i++) {
        const chunk = this.chunks[i];
        if (seedChanged || Math.max(Math.abs(chunk.x - cx), Math.abs(chunk.z - cz)) > tier.radius) chunk.mesh.visible = false;
      }
    }

    let built = 0;
    while (this.pending && built < TERRAIN_STREAM.generationBudget) {
      const offset = OFFSETS[this.cursor++];
      const x = cx + offset.x, z = cz + offset.z;
      const lod = offset.ring <= tier.detailRadius ? FINE : offset.ring <= tier.middleRadius ? MIDDLE : COARSE;
      // At most one live coordinate can use a slot within the largest supported window.
      const chunk = this.chunks[wrapSlot(z) * SIDE + wrapSlot(x)];
      if (chunk.mesh.visible && chunk.x === x && chunk.z === z && chunk.lod === lod) continue;
      this.build(chunk, x, z, lod);
      built++;
    }
    return built;
  }

  private build(chunk: Chunk, x: number, z: number, lod: number): void {
    const { mesh } = chunk, { index, vertices } = LODS[lod];
    const { position, color, aSeabed, aSlope } = mesh.geometry.attributes;
    const originX = x * SIZE, originZ = z * SIZE;
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i];
      const wx = originX + position.getX(v), wz = originZ - position.getZ(v);
      position.setY(v, this.world.height(wx, wz));
      if (aSeabed) {
        aSeabed.setX(v, this.world.seabed(wx, wz));
        // Sample in game +x/+z at the same fixed distance on both sides of every LOD border.
        const step = TERRAIN_MESH_STEP;
        aSlope.setXY(v, (this.world.height(wx + step, wz) - this.world.height(wx - step, wz)) / (2 * step),
          (this.world.height(wx, wz + step) - this.world.height(wx, wz - step)) / (2 * step));
      } else {
        this.color.setHex(this.world.color(wx, wz));
        color.setXYZ(v, this.color.r, this.color.g, this.color.b);
      }
    }
    mesh.geometry.setIndex(index);
    position.needsUpdate = true;
    if (aSeabed) {
      aSeabed.needsUpdate = true;
      aSlope.needsUpdate = true;
    } else color.needsUpdate = true;
    mesh.position.set(originX, 0, -originZ);
    mesh.updateMatrix();
    chunk.x = x;
    chunk.z = z;
    chunk.lod = lod;
    if (chunk.legacyDecor) this.placeDecor(chunk, chunk.legacyDecor);
    else this.placeForgeDecor(chunk);
    mesh.visible = true;
  }

  private placeDecor(chunk: Chunk, decor: InstancedMesh): void {
    const { lod, mesh } = chunk;
    if (lod === COARSE) {
      finishBatch(decor, 0);
      return;
    }
    const { position } = mesh.geometry.attributes;
    const seed = this.seed ^ TERRAIN_DECOR.seedSalt;
    let count = 0;
    for (let row = 0; row < CELLS; row += DECOR_CELLS) for (let col = 0; col < CELLS; col += DECOR_CELLS) {
      const hash = worldHash(seed, chunk.x * SIZE / DECOR_STEP + col / DECOR_CELLS,
        chunk.z * SIZE / DECOR_STEP + row / DECOR_CELLS);
      if ((hash & 7) > 4) continue;
      const midCol = col + DECOR_CELLS / 2, midRow = row + DECOR_CELLS / 2;
      const x = midCol * TERRAIN_MESH_STEP, z = midRow * TERRAIN_MESH_STEP;
      const interior = col > 0 && row > 0 && col + DECOR_CELLS < CELLS && row + DECOR_CELLS < CELLS;
      const y = lod === MIDDLE && interior
        ? (position.getY(vertex(col, row)) + position.getY(vertex(col + DECOR_CELLS, row + DECOR_CELLS))) / 2
        : position.getY(vertex(midCol, midRow));
      const scale = 0.72 + ((hash >>> 6) & 15) * 0.045;
      const yaw = ((hash >>> 16) & 7) * Math.PI / 4;
      const tint = (hash >>> 20) & 1;
      if (isWater(y)) {
        this.write(decor, count++, x, y + 0.22, z, 13 * scale, 0.18, 1.6, yaw, TERRAIN_DECOR.water[tint]);
      } else if (y >= TERRAIN_DECOR.rockMinAltitude || ((hash >>> 24) & 15) === 0) {
        this.write(decor, count++, x, y + 0.9 * scale, z, 6 * scale, 3 * scale, 5 * scale, yaw, TERRAIN_DECOR.rock[tint]);
      } else if (y >= TERRAIN_DECOR.treeMinAltitude) {
        this.write(decor, count++, x, y + 1.7 * scale, z, 7 * scale, 4.2 * scale, 6 * scale, yaw, TERRAIN_DECOR.canopy[tint]);
        this.write(decor, count++, x, y + 4.6 * scale, z, 4.7 * scale, 2.3 * scale, 4.3 * scale, yaw, TERRAIN_DECOR.crown[tint]);
      }
    }
    finishBatch(decor, count);
  }

  private placeForgeDecor(chunk: Chunk): void {
    // Only the fine window needs silhouettes. The material draws the forest floor at every LOD.
    if (chunk.lod !== FINE) {
      if (chunk.mesh.children.length) chunk.mesh.children[0].visible = false;
      return;
    }
    const slot = wrapSlot(chunk.z, NEAR_SIDE) * NEAR_SIDE + wrapSlot(chunk.x, NEAR_SIDE);
    const decor = this.nearDecor[slot];
    if (decor.parent !== chunk.mesh) chunk.mesh.add(decor);
    const originX = chunk.x * SIZE, originZ = chunk.z * SIZE;
    let count = 0;
    for (let row = 0; row < TREE_CELLS; row++) for (let col = 0; col < TREE_CELLS; col++) {
      const hash = worldHash(this.seed ^ TERRAIN_DECOR.seedSalt, chunk.x * TREE_CELLS + col, chunk.z * TREE_CELLS + row);
      // Each jittered site stays inside its lattice cell, snapped to a 2 m material pixel.
      const x = 2 * Math.floor((col + 0.14 + (hash & 255) * (0.72 / 255)) * TREE_SPACING / 2) + 1;
      const z = 2 * Math.floor((row + 0.14 + ((hash >>> 8) & 255) * (0.72 / 255)) * TREE_SPACING / 2) + 1;
      const wx = originX + x, wz = originZ + z, y = this.world.height(wx, wz);
      if (y < TERRAIN_DECOR.treeMinAltitude) continue;
      const scale = 0.76 + ((hash >>> 16) & 15) * 0.04, tint = (hash >>> 20) & 1;
      if (y >= 73) {
        if (((hash >>> 21) & 7) === 0) {
          this.write(decor, count++, x, y + 0.8 * scale, z, 5 * scale, 2.8 * scale, 4.2 * scale, 0, FORGE_GROUND.stone[tint]);
        }
      } else if (forestCover(this.seed, wx, wz) >= FOREST_THRESHOLD || (hash >>> 26) === 0) {
        this.write(decor, count++, x, y + 1.9 * scale, z, 7.2 * scale, 4.5 * scale, 6.3 * scale, 0, FORGE_GROUND.canopy[tint]);
        this.write(decor, count++, x - 0.45 * scale, y + 4.65 * scale, z + 0.35 * scale,
          4.8 * scale, 3.1 * scale, 4.4 * scale, 0, FORGE_GROUND.crown[tint]);
      }
    }
    finishBatch(decor, count);
  }

  private updateSites(sites: readonly WorldSite[] | undefined, seedChanged: boolean): void {
    let visible = 0;
    if (sites) for (let i = 0; i < sites.length; i++) if (!sites[i].claimed) visible++;
    // A claim mutates the current list. Rebuild only when a site disappears or the list changes.
    if (sites === this.sites && visible === this.siteCount && !seedChanged) return;
    this.sites = sites;
    this.siteCount = visible;
    let count = 0;
    if (sites) for (let i = 0; i < sites.length && count < SITE_MARKERS.capacity; i++) {
      const site = sites[i];
      if (site.claimed) continue;
      const { x, z, alt } = site;
      const ground = this.world.height(x, z);
      const tint = SITE_MARKERS.colors[site.kind], rise = Math.max(4, alt - ground);
      this.write(this.siteBases, count * 2, x, ground + 0.5, z, 10, 2.8, 10, Math.PI / 4, SITE_MARKERS.pedestal);
      this.write(this.siteBases, count * 2 + 1, x, ground + rise / 2, z, 1.7, rise, 1.7, 0, tint);
      this.write(this.siteCaps, count++, x, ground + rise, z, 4.3, 5.5, 4.3, 0, tint);
    }
    finishBatch(this.siteBases, count * 2);
    finishBatch(this.siteCaps, count);
    if (count) {
      this.siteBases.computeBoundingSphere();
      this.siteCaps.computeBoundingSphere();
    }
  }

  private write(mesh: InstancedMesh, index: number, x: number, y: number, z: number, sx: number, sy: number,
    sz: number, yaw: number, tint: number): void {
    const transform = this.transform;
    transform.position.set(x, y, -z);
    transform.rotation.y = yaw;
    transform.scale.set(sx, sy, sz);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    mesh.setColorAt(index, this.color.setHex(tint));
  }
}
