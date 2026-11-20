import test from 'node:test';
import assert from 'node:assert/strict';
import { Raycaster, Vector3 } from 'three';
import { TERRAIN_STREAM } from '../src/data/terrain-stream.ts';
import { chaseEyeHeight, TerrainStream } from '../src/terrain-stream.ts';
import { skimAltitude } from '../src/bands.ts';
import { World } from '../src/world.ts';

const size = TERRAIN_STREAM.chunkSize;

test('the chase eye clears the sea stack behind a SKIM pilot in both viewport shapes', () => {
  const world = new World();
  const ground = world.height.bind(world);
  const x = 288;
  for (const [z, aspect] of [[286, 1280 / 800], [302, 390 / 844]]) {
    const eyeZ = z - 46 - Math.max(0, 1 - aspect) * 30;
    const requested = skimAltitude(ground(x, z)) + 15;
    assert.ok(requested + 24 < ground(x, eyeZ));
    assert.equal(chaseEyeHeight(ground, x, eyeZ, requested), ground(x, eyeZ) + TERRAIN_STREAM.chaseEyeClearance);
    assert.equal(chaseEyeHeight(ground, x, eyeZ, 160), 160);
  }
});

function activeTerrain(stream) {
  return stream.group.children.filter(mesh => mesh.visible && !mesh.isInstancedMesh);
}

function terrainAt(stream, x, z) {
  return activeTerrain(stream).find(mesh => mesh.position.x === x && mesh.position.z === -z);
}

function settle(stream, x, z, mobile = false) {
  let total = 0;
  for (let draw = 0; draw < 100; draw++) {
    const builds = stream.update(x, z, mobile);
    assert.ok(builds <= TERRAIN_STREAM.generationBudget, `generated ${builds} chunks in one draw`);
    total += builds;
    if (builds === 0) return total;
  }
  assert.fail('terrain streaming did not settle');
}

test('terrain generation stays bounded during startup, a teleport, and a tier change', () => {
  const stream = new TerrainStream(new World(13));
  assert.ok(stream.pending);
  assert.equal(stream.update(0, 0, false), TERRAIN_STREAM.generationBudget);
  assert.ok(stream.pending);
  assert.ok(terrainAt(stream, 0, 0), 'the player chunk renders in the first draw');
  const pool = new Set(stream.group.children);
  settle(stream, 0, 0);
  const desktopCount = activeTerrain(stream).length;
  assert.equal(desktopCount, (TERRAIN_STREAM.desktop.radius * 2 + 1) ** 2);
  assert.equal(stream.pending, false);

  const x = -400 * size, z = 163 * size;
  settle(stream, x, z, true);
  const phoneCount = activeTerrain(stream).length;
  assert.equal(phoneCount, (TERRAIN_STREAM.phone.radius * 2 + 1) ** 2);
  assert.equal(stream.pending, false);
  assert.ok(phoneCount < desktopCount);
  assert.ok(!terrainAt(stream, 0, 0));
  const center = terrainAt(stream, x, z);
  assert.ok(center);

  settle(stream, x, z);
  assert.equal(activeTerrain(stream).length, desktopCount);
  assert.equal(terrainAt(stream, x, z), center);
  assert.deepEqual(new Set(stream.group.children), pool);
});

test('terrain reuses unchanged meshes as the player crosses into a neighboring chunk', () => {
  const stream = new TerrainStream(new World(13));
  settle(stream, -1, 1);
  const shared = terrainAt(stream, 0, 0);
  const { position } = shared.geometry.attributes;
  const version = position.version;
  settle(stream, 1, 1);
  assert.equal(terrainAt(stream, 0, 0), shared);
  assert.equal(position.version, version);
  assert.equal(stream.update(12, 13, false), 0);
  assert.equal(position.version, version);
});

function edge(mesh, x) {
  const { position } = mesh.geometry.attributes;
  const vertices = new Map();
  for (const index of mesh.geometry.index.array) {
    if (position.getX(index) === x) vertices.set(position.getZ(index), position.getY(index));
  }
  return vertices;
}

test('different terrain resolutions have identical shared border heights', () => {
  const stream = new TerrainStream(new World(47));
  const x = -8 * size, z = 13 * size;
  settle(stream, x, z);
  stream.group.updateMatrixWorld(true);

  for (const ring of [TERRAIN_STREAM.desktop.detailRadius, TERRAIN_STREAM.desktop.middleRadius]) {
    const near = terrainAt(stream, x + ring * size, z);
    const far = terrainAt(stream, x + (ring + 1) * size, z);
    assert.ok(near.geometry.index.count > far.geometry.index.count);
    const nearEdge = edge(near, size);
    assert.equal(nearEdge.size, size / 16 + 1);
    assert.deepEqual(nearEdge, edge(far, 0));
  }
});

test('the finest terrain mesh follows the gameplay surface between grid vertices', () => {
  const world = new World(47);
  const stream = new TerrainStream(world);
  const x = -1026.5, z = 1801.75;
  stream.update(x, z, true);
  stream.group.updateMatrixWorld(true);
  const mesh = terrainAt(stream, Math.floor(x / size) * size, Math.floor(z / size) * size);
  const down = new Raycaster(new Vector3(x, 300, -z), new Vector3(0, -1, 0));
  const [hit] = down.intersectObject(mesh, false);
  assert.ok(hit);
  assert.ok(Math.abs(hit.point.y - world.height(x, z)) < 0.00001);
});

test('changing the world seed refreshes the geometry of the current chunk within the budget', () => {
  const world = new World(5);
  const stream = new TerrainStream(world);
  const x = -8 * size, z = 13 * size;
  settle(stream, x, z);
  const mesh = terrainAt(stream, x, z);
  const { position } = mesh.geometry.attributes;
  const oldHeight = position.getY(0);
  world.seed = 874;
  assert.equal(stream.update(x, z, false), TERRAIN_STREAM.generationBudget);
  assert.equal(terrainAt(stream, x, z), mesh);
  assert.ok(Math.abs(position.getY(0) - world.height(x, z)) < 0.00001);
  assert.notEqual(position.getY(0), oldHeight);
});

test('revisiting a chunk recreates its decorative instances in the same places', () => {
  const stream = new TerrainStream(new World(47));
  const readDecor = () => {
    const [decor] = terrainAt(stream, 0, 0).children;
    assert.ok(decor.count > 0);
    return decor.instanceMatrix.array.slice(0, decor.count * 16);
  };
  stream.update(0, 0, false);
  const original = readDecor();
  stream.update(size * 13, size * 13, false);
  assert.ok(!terrainAt(stream, 0, 0));
  stream.update(0, 0, false);
  assert.deepEqual(readDecor(), original);
});

test('a site claimed in the current region disappears from the world markers', () => {
  const stream = new TerrainStream(new World(47));
  const sites = [
    { id: '0:0', kind: 'supply', x: 320, z: 348, alt: 110 },
    { id: '-1:0', kind: 'beacon', x: -310, z: 280, alt: 110 },
  ];
  stream.update(0, 0, true, sites);
  const markers = stream.group.getObjectByName('World site markers');
  assert.equal(markers.count, 2);
  sites[0].claimed = true;
  stream.update(0, 0, true, sites);
  assert.equal(markers.count, 1);
  assert.equal(markers.instanceMatrix.array[12], -310);
});
