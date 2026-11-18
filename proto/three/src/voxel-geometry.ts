import { BufferGeometry, Color, DataTexture, Float32BufferAttribute, NearestFilter, PlaneGeometry, SRGBColorSpace } from 'three';
import { buildFaces, type Face } from '../../../src/voxel.ts';
import { dronePalette, filledVoxels, makeDroneModel, type Palette } from '../../shared/models.ts';

const faceShade = [0.72, 0.51, 0.52, 0.79, 1, 0.38];
const cell = (u: number, v: number) => `${u},${v}`;

/** Merge exposed, coplanar faces of the same color. Internal voxels never reach the GPU. */
export function bakeVoxels(faces: Face[], palette: Palette, size: number): BufferGeometry {
  const layers = Array.from({ length: 6 }, () => new Map<number, Map<string, number>>());
  for (const { x, y, z, side, material } of faces) {
    const coordinates = [x, y, z];
    const axis = side >> 1, plane = coordinates[axis];
    let layer = layers[side].get(plane);
    if (!layer) {
      layer = new Map();
      layers[side].set(plane, layer);
    }
    layer.set(cell(coordinates[(axis + 1) % 3], coordinates[(axis + 2) % 3]), material);
  }

  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const swatches = palette.map(([r, g, b]) => new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace));
  const point = [0, 0, 0];
  for (let side = 0; side < layers.length; side++) {
    const axis = side >> 1, uAxis = (axis + 1) % 3, vAxis = (axis + 2) % 3;
    const positive = side % 2 === 0;
    for (const [plane, layer] of layers[side]) {
      point[axis] = plane + (positive ? 0.5 : -0.5);
      for (const [key, material] of layer) {
        const [u, v] = key.split(',').map(Number);
        let width = 1, height = 1;
        while (layer.get(cell(u + width, v)) === material) width++;
        rows: while (true) {
          for (let column = 0; column < width; column++) {
            if (layer.get(cell(u + column, v + height)) !== material) break rows;
          }
          height++;
        }
        for (let row = 0; row < height; row++) {
          for (let column = 0; column < width; column++) layer.delete(cell(u + column, v + row));
        }

        const base = positions.length / 3;
        const color = swatches[material], shade = faceShade[side];
        for (const [du, dv] of [[0, 0], [width, 0], [width, height], [0, height]]) {
          point[uAxis] = u + du - 0.5;
          point[vAxis] = v + dv - 0.5;
          positions.push(point[0] * size, point[2] * size, point[1] * size);
          colors.push(color.r * shade, color.g * shade, color.b * shade);
        }
        // Swapping model Y/Z reverses winding and puts the nose along world -Z.
        if (positive) indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
        else indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Keep the same swept wings and engine silhouette when the original voxels are subpixel. */
export function bakeDistantDrone(size: number): BufferGeometry {
  const model = makeDroneModel();
  const block = 4;
  const width = Math.ceil(model.width / block), length = Math.ceil(model.length / block);
  const height = Math.ceil(model.height / block), materials = dronePalette.length;
  const data = new Uint8Array(width * length * height);
  const counts = new Uint16Array(data.length * materials);
  const [px, py, pz] = model.pivot;
  for (const voxel of filledVoxels(model)) {
    const x = Math.floor((voxel.x + px) / block), y = Math.floor((voxel.y + py) / block);
    const z = Math.floor((voxel.z + pz) / block);
    counts[((z * length + y) * width + x) * materials + voxel.material]++;
  }
  for (let i = 0; i < data.length; i++) {
    let solid = 0, dominant = 0, bestCount = 0;
    for (let material = 1; material < materials; material++) {
      const count = counts[i * materials + material];
      solid += count;
      if (count > bestCount) {
        bestCount = count;
        dominant = material;
      }
    }
    if (solid >= 8) data[i] = dominant;
  }
  const pivot: [number, number, number] = [Math.floor(px / block), Math.floor(py / block), Math.floor(pz / block)];
  const geometry = bakeVoxels(buildFaces({ width, length, height, data, pivot }), dronePalette, size * block);
  const center = (block - 1) / 2;
  geometry.translate(
    (pivot[0] * block + center - px) * size,
    (pivot[2] * block + center - pz) * size,
    (pivot[1] * block + center - py) * size,
  );
  return geometry;
}

/** In an overhead orthographic view each voxel column projects to one texel. */
export function bakeOverheadDrone(size: number) {
  const model = makeDroneModel();
  const { width, length, height, data, pivot } = model;
  const pixels = new Uint8Array(width * length * 4);
  for (let y = 0; y < length; y++) {
    for (let x = 0; x < width; x++) {
      for (let z = height - 1; z >= 0; z--) {
        const material = data[(z * length + y) * width + x];
        if (!material) continue;
        const [r, g, b] = dronePalette[material];
        pixels.set([r, g, b, 255], ((length - 1 - y) * width + x) * 4);
        break;
      }
    }
  }
  const texture = new DataTexture(pixels, width, length);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  const geometry = new PlaneGeometry(width * size, length * size).rotateX(-Math.PI / 2).translate(
    ((width - 1) / 2 - pivot[0]) * size,
    (height - pivot[2]) * size,
    ((length - 1) / 2 - pivot[1]) * size,
  );
  geometry.computeBoundingSphere();
  return { geometry, texture };
}
