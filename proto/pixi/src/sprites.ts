import { Mesh, MeshGeometry, Rectangle, Texture } from 'pixi.js';
import { droneFaces, dronePalette, filledVoxels, makeShipModel, shipPalette } from '@shared/models';
import { BANDS, type SimState, type ViewName } from '@shared/sim';
import { projectModel, VoxelProjector } from '../../../src/voxel.ts';
import { project, type Camera, type Projection } from './camera';

const DRONE_TILE = 32;
const DRONE_SIZE = DRONE_TILE - 2;
export const DRONE_BAKE_SCALE = 1.4;

const BAND_COLORS = [[255, 153, 98], [103, 233, 208], [179, 187, 255]];
const DRONE_POSES = {
  top: { pitch: Math.PI / 2, yaw: 0 },
  chase: { pitch: 0.42, yaw: Math.PI - 0.55 },
  cockpit: { pitch: 0.16, yaw: Math.PI - 0.38 },
} satisfies Record<ViewName, { pitch: number; yaw: number }>;

function nearestTexture(canvas: HTMLCanvasElement): Texture {
  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'nearest';
  return texture;
}

export function bakeActorSheet() {
  const views = Object.keys(DRONE_POSES) as ViewName[];
  const sheet = document.createElement('canvas');
  sheet.width = BANDS.length * DRONE_TILE;
  const bulletY = views.length * DRONE_TILE + 1;
  sheet.height = bulletY + 10;
  const context = sheet.getContext('2d')!;
  const tile = document.createElement('canvas');
  tile.width = tile.height = DRONE_SIZE;
  const tileContext = tile.getContext('2d')!;
  const projector = new VoxelProjector();
  const faces = droneFaces();
  const palettes = BAND_COLORS.map((accent) => dronePalette.map((color, material) => {
    const blend = material === 4 ? 0.94 : material === 3 ? 0.38 : 0.14;
    return color.map((channel, i) => Math.round(channel + (accent[i] - channel) * blend));
  }));

  views.forEach((view, row) => {
    palettes.forEach((palette, band) => {
      tileContext.clearRect(0, 0, DRONE_SIZE, DRONE_SIZE);
      projectModel(projector, tileContext, faces, palette, {
        cx: DRONE_SIZE / 2, cy: DRONE_SIZE / 2, scale: DRONE_BAKE_SCALE,
        ...DRONE_POSES[view], roll: 0, lift: 1, perspective: 0,
      });
      context.drawImage(tile, band * DRONE_TILE + 1, row * DRONE_TILE + 1);
    });
  });

  context.fillStyle = '#ec9a4e';
  context.fillRect(1, bulletY + 2, 3, 6);
  context.fillStyle = '#fff4bf';
  context.fillRect(2, bulletY, 1, 9);

  const texture = nearestTexture(sheet);
  const drones = Object.fromEntries(views.map((view, row) => [view, BANDS.map((_, band) => new Texture({
    source: texture.source,
    frame: new Rectangle(band * DRONE_TILE + 1, row * DRONE_TILE + 1, DRONE_SIZE, DRONE_SIZE),
  }))])) as Record<ViewName, Texture[]>;
  const bullet = new Texture({ source: texture.source, frame: new Rectangle(1, bulletY, 3, 9) });
  return { texture, drones, bullet };
}

export function createShipStack() {
  const model = makeShipModel();
  const { width, length, height, pivot: [px, py, pz] } = model;
  const layerStride = length + 2;
  const sheet = document.createElement('canvas');
  sheet.width = width + 2;
  sheet.height = layerStride * height;
  const context = sheet.getContext('2d')!;
  const occupiedLevels = new Set<number>();
  for (const { x, y, z, material } of filledVoxels(model)) {
    occupiedLevels.add(z);
    const level = z + pz;
    const shade = 0.76 + 0.24 * level / (height - 1);
    const color = shipPalette[material].map((channel) => Math.round(channel * shade));
    context.fillStyle = `rgb(${color.join(',')})`;
    context.fillRect(x + px + 1, level * layerStride + y + py + 1, 1, 1);
  }

  const layers = Array.from(occupiedLevels, (alt, i) => ({ alt, vertex: i * 4, depth: 0 }));
  const positions = new Float32Array(layers.length * 8);
  const uvs = new Float32Array(positions.length);
  const indices = new Uint32Array(layers.length * 6);
  const left = 1 / sheet.width;
  const right = (width + 1) / sheet.width;
  for (const layer of layers) {
    const top = ((layer.alt + pz) * layerStride + 1) / sheet.height;
    const bottom = top + length / sheet.height;
    uvs.set([left, top, right, top, right, bottom, left, bottom], layer.vertex * 2);
  }

  const geometry = new MeshGeometry({ positions, uvs, indices });
  // The slice order changes in the index buffer, so draw this mesh directly.
  geometry.batchMode = 'no-batch';
  const mesh = new Mesh({ geometry, texture: nearestTexture(sheet) });
  const corners = [
    [-px - 0.5, py + 0.5], [width - px - 0.5, py + 0.5],
    [width - px - 0.5, py - length + 0.5], [-px - 0.5, py - length + 0.5],
  ];
  const point: Projection = { x: 0, y: 0, depth: 0, scale: 0 };

  return {
    mesh,
    update(camera: Camera, sim: SimState) {
      mesh.visible = camera.view !== 'cockpit';
      if (!mesh.visible) return;

      const { player, time } = sim;
      const sinYaw = Math.sin(player.yaw);
      const cosYaw = Math.cos(player.yaw);
      const bank = 0.08 + 0.32 * Math.sin(time * 0.92);
      const sinBank = Math.sin(bank);
      const cosBank = Math.cos(bank);
      for (const layer of layers) {
        layer.depth = 0;
        for (let corner = 0; corner < corners.length; corner++) {
          const [x, forward] = corners[corner];
          const lateral = x * cosBank + layer.alt * sinBank;
          const alt = player.alt + layer.alt * cosBank - x * sinBank;
          project(camera, player.x + lateral * cosYaw + forward * sinYaw,
            player.z - lateral * sinYaw + forward * cosYaw, alt, point);
          const offset = (layer.vertex + corner) * 2;
          positions[offset] = point.x;
          positions[offset + 1] = point.y;
          layer.depth += point.depth;
        }
      }

      // Paint the textured horizontal slices back to front after applying yaw and bank.
      layers.sort((a, b) => b.depth - a.depth);
      layers.forEach(({ vertex }, i) => {
        indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], i * 6);
      });
      geometry.getBuffer('aPosition').update();
      geometry.getIndex().update();
    },
  };
}
