import { Graphics, Mesh, MeshGeometry, Texture } from 'pixi.js';
import { terrainHeight } from '@shared/sim';
import { project, type Camera, type Projection } from './camera';

const COLUMNS = 44;
const ROWS = 42;
const HAZE = [65, 86, 101];
const SKY = [0x101826, 0x142031, 0x19283a, 0x233347, 0x2c4052, 0x364c5c, 0x415665];

function groundPalette(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 12;
  canvas.height = 16;
  const context = canvas.getContext('2d')!;
  for (let y = 0; y < canvas.height; y++) {
    const fog = y / (canvas.height - 1);
    for (let x = 0; x < canvas.width; x++) {
      const height = x / (canvas.width - 1);
      const ground = [17 + 24 * height, 33 + 40 * height, 41 + 24 * height];
      const color = ground.map((channel, i) => Math.round(channel + (HAZE[i] - channel) * fog));
      context.fillStyle = `rgb(${color.join(',')})`;
      context.fillRect(x, y, 1, 1);
    }
  }
  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'nearest';
  return texture;
}

export function createTerrain() {
  const positions = new Float32Array((COLUMNS + 1) * (ROWS + 1) * 2);
  const uvs = new Float32Array(positions.length);
  const indices = new Uint32Array(COLUMNS * ROWS * 6);
  const distances = Array.from({ length: ROWS + 1 }, (_, row) => 28 * (3200 / 28) ** (row / ROWS));
  let offset = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLUMNS; col++) {
      const a = row * (COLUMNS + 1) + col;
      const b = a + COLUMNS + 1;
      indices.set([a, a + 1, b, b, a + 1, b + 1], offset);
      offset += 6;
    }
  }

  const geometry = new MeshGeometry({ positions, uvs, indices });
  const mesh = new Mesh({ geometry, texture: groundPalette() });
  const point: Projection = { x: 0, y: 0, depth: 0, scale: 0 };

  return {
    mesh,
    update(camera: Camera) {
      const top = camera.view === 'top';
      const frustum = camera.cx / camera.focal;
      let vertex = 0;
      for (let row = 0; row <= ROWS; row++) {
        const forward = distances[row];
        const halfWidth = frustum * (forward * camera.cosPitch + camera.alt * camera.sinPitch) + 8;
        const fog = top ? 0 : Math.min(1, forward / 1350);
        for (let col = 0; col <= COLUMNS; col++) {
          const across = col / COLUMNS;
          const lateral = (across * 2 - 1) * halfWidth;
          const x = top ? camera.x + (across * camera.width - camera.cx) / camera.focal
            : camera.x + forward * camera.sinYaw + lateral * camera.cosYaw;
          const z = top ? camera.z + (camera.cy - row / ROWS * camera.height) / camera.focal
            : camera.z + forward * camera.cosYaw - lateral * camera.sinYaw;
          const alt = terrainHeight(x, z);
          project(camera, x, z, alt, point);
          positions[vertex] = point.x;
          positions[vertex + 1] = point.y;
          uvs[vertex] = (alt - 7) / 22;
          uvs[vertex + 1] = fog;
          vertex += 2;
        }
      }
      geometry.getBuffer('aPosition').update();
      geometry.getBuffer('aUV').update();
    },
  };
}

export function drawSky(sky: Graphics, camera: Camera): void {
  sky.clear();
  if (camera.view === 'top') return;

  const { width, height, cy, focal, sinPitch, cosPitch } = camera;
  const horizon = Math.round(cy - focal * sinPitch / cosPitch);
  for (let i = 0; i < SKY.length; i++) {
    const y = Math.floor(i * horizon / SKY.length);
    const bottom = Math.floor((i + 1) * horizon / SKY.length);
    sky.rect(0, y, width, bottom - y).fill(SKY[i]);
  }
  sky.rect(0, horizon, width, height - horizon).fill(SKY[SKY.length - 1]);
  sky.rect(0, horizon, width, 1).fill(0x596f7c);
}
