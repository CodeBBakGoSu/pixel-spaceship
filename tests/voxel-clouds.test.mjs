import assert from 'node:assert/strict';
import test from 'node:test';
import { NearestFilter, RedFormat, Vector3 } from 'three';
import { FlightAtmosphere, cloudFixturePoint } from '../src/flight-atmosphere.ts';
import { shadowOffset } from '../src/shadow-shape.ts';
import { makeVoxelClouds } from '../src/voxel-clouds.ts';

test('each opaque cloud column casts one texel at its projected game-world position', () => {
  const arena = { x: -170, z: 235, radius: 520 };
  const patch = cloudFixturePoint(arena);
  const { clouds, shadow } = makeVoxelClouds(arena, [patch]);
  const { geometry, material } = clouds.children[0];
  assert.ok(material.vertexColors && material.depthWrite && !material.transparent);
  const { texture, minX, minZ, size } = shadow, { data, width } = texture.image;
  assert.equal(texture.format, RedFormat);
  assert.equal(texture.magFilter, NearestFilter);
  assert.equal(texture.minFilter, NearestFilter);
  assert.equal(texture.generateMipmaps, false);

  const cell = size / width, position = geometry.getAttribute('position');
  const view = vertex => new Vector3().fromBufferAttribute(position, vertex);
  const topHeights = new Set(), baseHeights = new Set(), covered = new Set();
  const shift = shadowOffset(patch.altitude - 38);
  for (let i = 0; i < geometry.index.count; i += 3) {
    const a = view(geometry.index.getX(i)), b = view(geometry.index.getX(i + 1)), c = view(geometry.index.getX(i + 2));
    const normal = b.clone().sub(a).cross(c.clone().sub(a));
    if (!normal.y) continue;
    if (normal.y < 0) {
      baseHeights.add(a.y);
      continue;
    }
    // Both a sunlit top and its shaded lip belong to the same projected cell.
    const x = (Math.floor((a.x + b.x + c.x) / (3 * cell)) + 0.5) * cell;
    const z = (Math.floor(-(a.z + b.z + c.z) / (3 * cell)) + 0.5) * cell;
    const col = Math.floor((x + shift.x - minX) / size * width);
    const row = Math.floor((z + shift.z - minZ) / size * width);
    const texel = row * width + col;
    assert.equal(data[texel], 255);
    covered.add(texel);
    topHeights.add(a.y);
  }
  assert.equal(baseHeights.size, 1);
  assert.ok(topHeights.size >= 4);
  assert.equal(data.filter(byte => byte !== 0).length, covered.size);
  const second = makeVoxelClouds(arena, [patch]);
  assert.deepEqual(second.shadow.texture.image.data, data);
  assert.deepEqual(second.clouds.children[0].geometry.attributes.color.array, geometry.attributes.color.array);
});

test('legacy clouds still use the translucent batch and allocate no shadow atlas', () => {
  const air = new FlightAtmosphere({ x: 0, z: 0, radius: 400 }, false);
  assert.equal(air.cloudShadow, null);
  assert.ok(air.group.children[0].isInstancedMesh && air.group.children[0].material.transparent);
});
