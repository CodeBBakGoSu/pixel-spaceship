import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TERRAIN_STREAM } from '../src/data/terrain-stream.ts';
import { WORLD_TERRAIN } from '../src/data/world.ts';
import { FOREST_THRESHOLD, forestCover } from '../src/forge-terrain.ts';
import { TerrainStream } from '../src/terrain-stream.ts';
import { TERRAIN_SIZE, World } from '../src/world.ts';

test('gameplay terrain retains the Stage A double-precision samples across Reach and the seeded world', () => {
  const world = new World(), digest = createHash('sha256'), sample = Buffer.alloc(8);
  for (const seed of [1, 47, 0xf3a2fc98]) {
    world.seed = seed;
    for (let x = -832; x <= 832; x += 37) for (let z = -819; z <= 819; z += 41) {
      sample.writeDoubleLE(world.height(x + 0.25, z + 0.875));
      digest.update(sample);
    }
  }
  assert.equal(digest.digest('hex'), '62783f544ddb047c9c9ca69ca80f8a75979d10f42cdb6cfab6eac25b225d4f41');
});

test('the render seabed keeps land elevations, deepens submerged vertices and wraps with the world', () => {
  const world = new World(47);
  let deep = 0, land = 0;
  for (let z = -960; z < 960; z += 32) for (let x = -960; x < 960; x += 32) {
    const height = world.height(x, z), bed = world.seabed(x, z);
    assert.ok(bed <= height);
    if (height > WORLD_TERRAIN.shallows) {
      land++;
      assert.equal(bed, height);
    }
    if (bed + 2 < WORLD_TERRAIN.seaLevel) deep++;
  }
  assert.ok(deep > 100 && land > 100);
  for (const [x, z] of [[-177.75, -126.25], [284.5, 491.75], [3872, -5760]]) {
    assert.equal(world.seabed(x, z), world.seabed(x + TERRAIN_SIZE, z - TERRAIN_SIZE));
  }
});

function terrainAt(stream, x, z) {
  return stream.group.children.find(mesh => mesh.visible && mesh.material === stream.lookMaterial
    && mesh.position.x === x && mesh.position.z === -z);
}

test('all Forge LODs upload matching height, seabed and slope samples after a seed change', () => {
  const world = new World(47), stream = new TerrainStream(world, true);
  const step = WORLD_TERRAIN.step, size = TERRAIN_STREAM.chunkSize, x = -2 * size, z = size;
  for (const seed of [47, 0xf3a2fc98]) {
    world.seed = seed;
    do { stream.update(x, z, true); } while (stream.pending);
    assert.equal(stream.lookMaterial.seed.value, seed);
    // Include both endpoints of every shared edge across the fine, middle and coarse rings.
    for (let ring = 0; ring <= TERRAIN_STREAM.phone.radius; ring++) {
      const chunkX = x + ring * size, mesh = terrainAt(stream, chunkX, z);
      const { position, aSeabed, aSlope, color } = mesh.geometry.attributes;
      assert.equal(color, undefined);
      for (const index of new Set(mesh.geometry.index.array)) {
        const wx = chunkX + position.getX(index), wz = z - position.getZ(index);
        assert.equal(position.getY(index), Math.fround(world.height(wx, wz)));
        assert.equal(aSeabed.getX(index), Math.fround(world.seabed(wx, wz)));
        assert.equal(aSlope.getX(index), Math.fround((world.height(wx + step, wz) - world.height(wx - step, wz)) / (2 * step)));
        assert.equal(aSlope.getY(index), Math.fround((world.height(wx, wz + step) - world.height(wx, wz - step)) / (2 * step)));
      }
    }
  }
});

test('near voxel trees follow the shared forest mask and reproduce on a slot revisit', () => {
  const world = new World(47), stream = new TerrainStream(world, true), size = TERRAIN_STREAM.chunkSize;
  stream.update(0, 0, false);
  const [batch] = terrainAt(stream, 0, 0).children;
  const original = batch.instanceMatrix.array.slice(0, batch.count * 16);
  const tints = batch.instanceColor.array.slice(0, batch.count * 3);
  assert.ok(batch.material.vertexColors);
  assert.ok(batch.geometry.getAttribute('color').array.some(channel => channel < 0.9));
  let groves = 0, scattered = 0;
  for (let i = 0; i < batch.count; i++) {
    const x = original[i * 16 + 12], z = -original[i * 16 + 14];
    const height = world.height(x, z);
    assert.ok(height >= 42, 'trees and rocks stay off the beach and sea');
    if (height >= 73) continue;
    if (forestCover(world.seed, x, z) >= FOREST_THRESHOLD) groves++;
    else scattered++;
    const crown = (++i) * 16;
    assert.ok(Math.abs(original[crown + 12] - x) < 2 && Math.abs(original[crown + 14] + z) < 2);
    assert.ok(original[crown + 13] > original[crown - 16 + 13], 'a smaller crown sits above each canopy');
  }
  assert.ok(groves > 16 && groves > 4 * scattered);
  // Cross both the near-decoration and terrain ring periods, then return to the same world site.
  stream.update(39 * size, -39 * size, false);
  while (stream.pending) stream.update(39 * size, -39 * size, false);
  const near = [];
  stream.group.traverse(obj => { if (obj.name === batch.name) near.push(obj); });
  assert.equal(near.length, (2 * TERRAIN_STREAM.desktop.detailRadius + 1) ** 2);
  for (const object of near) {
    assert.ok(Math.abs(object.parent.position.x - 39 * size) <= size);
    assert.ok(Math.abs(object.parent.position.z - 39 * size) <= size);
  }
  stream.update(0, 0, true);
  const [rebuilt] = terrainAt(stream, 0, 0).children;
  assert.equal(rebuilt, batch);
  assert.deepEqual(rebuilt.instanceMatrix.array.slice(0, rebuilt.count * 16), original);
  assert.deepEqual(rebuilt.instanceColor.array.slice(0, rebuilt.count * 3), tints);
});
