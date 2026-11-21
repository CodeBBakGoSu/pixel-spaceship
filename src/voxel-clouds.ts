import {
  BoxGeometry, BufferGeometry, Color, DataTexture, Float32BufferAttribute, Group, Mesh,
  NearestFilter, RedFormat, Uint8BufferAttribute,
} from 'three';
import { CLOUDS } from './data/flight-world.ts';
import { FORGE_CLOUDS, SHADOW } from './data/palette.ts';
import type { CloudPatch } from './flight-atmosphere.ts';
import { shadowOffset } from './shadow-shape.ts';
import { WorldPaletteMaterial } from './post.ts';
import { worldHash } from './world.ts';

// Cell edges and shadow texel edges use the same world axes. A projected column
// therefore covers exactly one texel, even where several puffs overlap.
const CELL = 4;
const LAYER = 3;
const cube = new BoxGeometry(CELL, LAYER, CELL);
const corners = cube.getAttribute('position');
const rim = new Color(FORGE_CLOUDS.rim), crest = new Color(FORGE_CLOUDS.top);
const sideLow = new Color(FORGE_CLOUDS.sideLow), sideHigh = new Color(FORGE_CLOUDS.sideHigh);
const underside = new Color(FORGE_CLOUDS.underside);

export type CloudShadow = { texture: DataTexture; minX: number; minZ: number; size: number };
type Arena = { x: number; z: number; radius: number };
type Faces = { positions: number[]; colors: number[]; indices: number[] };

function cloudColumns(patch: CloudPatch, variant: number) {
  const { x, z, cos, sin, scale } = patch;
  const puffs = CLOUDS.blocks.map(([dx, dy, dz, width, height, depth], i) => {
    const hash = worldHash(variant, i, 0);
    const lx = (dx * (1.45 + (variant % 4) * 0.16) + ((hash & 7) - 3.5) * 0.5) * scale;
    const lz = (dz * 1.35 + (((hash >>> 4) & 7) - 3.5) * 0.5) * scale;
    const rx = (width * 0.72 + depth * 0.28) * 0.47 * scale;
    const rz = (depth * 0.62 + width * 0.38) * 0.50 * scale;
    return { x: x + lx * cos + lz * sin, z: z - lx * sin + lz * cos, rx, rz,
      radius: Math.max(rx, rz), rise: Math.min(rx, rz) * 0.68 + (height * 0.55 + dy * 0.65) * scale };
  });
  // The trailing wisps alternate ends. Some touch the main bank and others
  // leave a narrow opening through which the terrain and the sky are visible.
  const wisps = worldHash(variant, CLOUDS.blocks.length, 1);
  for (let i = 0; i < 1 + (wisps & 1); i++) {
    const hash = wisps >>> (i * 12 + 1);
    const sign = ((wisps >>> 27) & 1) === i ? -1 : 1;
    const end = sign < 0 ? puffs[0] : puffs[3];
    const rx = end.rx * (0.28 + (hash & 7) * 0.034), rz = rx * (0.85 + ((hash >>> 3) & 3) * 0.1);
    const along = sign * (end.rx + rx * (0.58 + ((hash >>> 5) & 7) * 0.22));
    const across = (((hash >>> 8) & 7) - 3.5) * scale * 0.88;
    puffs.push({ x: end.x + along * cos + across * sin, z: end.z - along * sin + across * cos,
      rx, rz, radius: Math.max(rx, rz), rise: end.rise * (0.39 + ((hash >>> 3) & 3) * 0.065) });
  }

  // Leave an empty ring for neighbour reads on the four sides of each column.
  const left = Math.floor(Math.min(...puffs.map(p => p.x - p.radius)) / CELL) - 1;
  const near = Math.floor(Math.min(...puffs.map(p => p.z - p.radius)) / CELL) - 1;
  const width = Math.ceil(Math.max(...puffs.map(p => p.x + p.radius)) / CELL) - left + 1;
  const depth = Math.ceil(Math.max(...puffs.map(p => p.z + p.radius)) / CELL) - near + 1;
  const levels = new Uint8Array(width * depth);
  for (const puff of puffs) {
    for (let gz = Math.floor((puff.z - puff.radius) / CELL); gz < Math.ceil((puff.z + puff.radius) / CELL); gz++) {
      const dz = (gz + 0.5) * CELL - puff.z;
      for (let gx = Math.floor((puff.x - puff.radius) / CELL); gx < Math.ceil((puff.x + puff.radius) / CELL); gx++) {
        const dx = (gx + 0.5) * CELL - puff.x;
        const lx = (dx * cos - dz * sin) / puff.rx, lz = (dx * sin + dz * cos) / puff.rz;
        const dome = 1 - lx * lx - lz * lz;
        if (dome <= 0) continue;
        const i = (gz - near) * width + gx - left;
        levels[i] = Math.max(levels[i], 1, Math.round(Math.sqrt(dome) * puff.rise / LAYER));
      }
    }
  }
  return { patch, left, near, width, depth, levels, offset: shadowOffset(patch.altitude - SHADOW.cloudGround) };
}

type Columns = ReturnType<typeof cloudColumns>;

function shadowAtlas(arena: Arena, grids: Columns[]): CloudShadow {
  const minX = Math.floor(Math.min(arena.x - arena.radius, ...grids.map(g => g.left * CELL + g.offset.x)) / CELL) * CELL - CELL;
  const minZ = Math.floor(Math.min(arena.z - arena.radius, ...grids.map(g => g.near * CELL + g.offset.z)) / CELL) * CELL - CELL;
  const maxX = Math.max(arena.x + arena.radius, ...grids.map(g => (g.left + g.width) * CELL + g.offset.x));
  const maxZ = Math.max(arena.z + arena.radius, ...grids.map(g => (g.near + g.depth) * CELL + g.offset.z));
  const pixels = Math.ceil(Math.max(maxX - minX, maxZ - minZ) / CELL) + 1;
  const texture = new DataTexture(new Uint8Array(pixels * pixels), pixels, pixels, RedFormat);
  texture.internalFormat = 'R8';
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return { texture, minX, minZ, size: pixels * CELL };
}

// BoxGeometry stores four corners per face in +X, -X, +Y, -Y, +Z, -Z order.
function face(out: Faces, side: number, x: number, y: number, z: number, color: Color, sx = 1, sz = 1): void {
  const v = out.positions.length / 3;
  const r = Math.round(color.r * 255), g = Math.round(color.g * 255), b = Math.round(color.b * 255);
  for (let j = side * 4; j < side * 4 + 4; j++) {
    out.positions.push(x + corners.getX(j) * sx, y + corners.getY(j), -z + corners.getZ(j) * sz);
    out.colors.push(r, g, b);
  }
  out.indices.push(v, v + 2, v + 1, v + 2, v + 3, v + 1);
}

function top(out: Faces, x0: number, x1: number, z0: number, z1: number, y: number, tint: Color): void {
  face(out, 2, (x0 + x1) * 0.5, y, (z0 + z1) * 0.5, tint, (x1 - x0) / CELL, (z1 - z0) / CELL);
}

function bakePatch(grid: Columns, out: Faces, shadow: CloudShadow): void {
  const { left, near, width, depth, levels, patch, offset } = grid;
  const base = patch.altitude - LAYER * 1.5;
  const tint = new Color();
  const { data, width: pixels } = shadow.texture.image;
  const dx = Math.round((offset.x - shadow.minX) / CELL), dz = Math.round((offset.z - shadow.minZ) / CELL);
  // These four faces point to east, west, -game Z and +game Z respectively.
  const faces = [0, 1, 4, 5], neighbour = [1, -1, -width, width];
  const sideLight = [0.91, 1.0, 0.94, 0.99];

  for (let row = 1; row < depth - 1; row++) for (let col = 1; col < width - 1; col++) {
    const i = row * width + col, h = levels[i];
    if (!h) continue;
    const gx = left + col, gz = near + row, x = (gx + 0.5) * CELL, z = (gz + 0.5) * CELL;
    data[(gz + dz) * pixels + gx + dx] = 255;

    // Height tints give an overhead camera the rounded relief also seen in profile.
    const slope = SHADOW.sunX * (levels[i + 1] - levels[i - 1])
      + SHADOW.sunZ * (levels[i + width] - levels[i - width]);
    const light = Math.max(0, Math.min(1, (h - 1) * 0.23 + slope * 0.34));
    // A higher neighbour shades the lip of the terrace down-sun of it. Bake
    // this strip into the top so the steps still read when viewed vertically.
    const lipX = Math.min(CELL - 1, Math.max(0, Math.round((levels[i - 1] - h) * LAYER * SHADOW.sunX * 1.45)));
    const lipZ = Math.min(CELL - 1, Math.max(0, Math.round((levels[i + width] - h) * LAYER * -SHADOW.sunZ * 1.85)));
    const x0 = gx * CELL, x1 = x0 + CELL, z0 = gz * CELL, z1 = z0 + CELL, y = base + (h - 0.5) * LAYER;
    tint.lerpColors(sideLow, sideHigh, Math.min(0.7, h * 0.06));
    if (lipX) top(out, x0, x0 + lipX, z0, z1, y, tint);
    if (lipZ) top(out, x0 + lipX, x1, z1 - lipZ, z1, y, tint);
    top(out, x0 + lipX, x1, z0, z1 - lipZ, y, tint.lerpColors(rim, crest, light));
    face(out, 3, x, base + LAYER * 0.5, z, underside);
    for (let edge = 0; edge < faces.length; edge++) {
      for (let k = levels[i + neighbour[edge]]; k < h; k++) {
        const upper = Math.max(0, (k + 1) / Math.max(4, h) - 0.48);
        tint.lerpColors(sideLow, sideHigh, Math.min(1, k * 0.20)).lerp(crest, upper * 1.35).multiplyScalar(sideLight[edge]);
        face(out, faces[edge], x, base + (k + 0.5) * LAYER, z, tint);
      }
    }
  }
}

export function makeVoxelClouds(arena: Arena, patches: CloudPatch[]): { clouds: Group; shadow: CloudShadow } {
  const grids = patches.map(cloudColumns);
  const shadow = shadowAtlas(arena, grids);
  const clouds = new Group();
  clouds.name = 'Altitude-band cloud patches';
  const sectors = new Map<string, Faces>();
  for (const grid of grids) {
    const key = Math.floor(grid.patch.x / 512) + ',' + Math.floor(grid.patch.z / 512);
    let out = sectors.get(key);
    if (!out) {
      out = { positions: [], colors: [], indices: [] };
      sectors.set(key, out);
    }
    bakePatch(grid, out, shadow);
  }
  const material = new WorldPaletteMaterial({ vertexColors: true });
  for (const { positions, colors, indices } of sectors.values()) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new Uint8BufferAttribute(colors, 3, true));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    clouds.add(new Mesh(geometry, material));
  }
  return { clouds, shadow };
}
