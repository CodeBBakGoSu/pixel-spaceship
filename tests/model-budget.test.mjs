import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from 'three';
import { droneFaces, dronePalette, shipFaces, shipPalette } from '../proto/shared/models.ts';
import { bakeVoxels } from '../proto/three/src/voxel-geometry.ts';
import { EVOLUTIONS, WEAPON_IDS } from '../src/data/items.ts';
import { ENEMY_KINDS, NEW_ENEMY_KINDS } from '../src/enemy-kinds.ts';
import { SHIP_VOXEL_SIZE } from '../src/engine-exhaust.ts';
import { enemyAirframe, wardenFaces, wardenPalette } from '../src/models.ts';
import * as flightScene from '../src/scene.ts';
import { enemyLimit } from '../src/spawn-director.ts';
import { orbitDroneGeometry, WeaponMounts } from '../src/weapon-render.ts';

const triangleCount = (faces, palette) => bakeVoxels(faces, palette, 1).index.count / 3;

test('finer player voxels preserve the interceptor world dimensions', () => {
  assert.ok(SHIP_VOXEL_SIZE < 0.62);
  const hull = bakeVoxels(shipFaces(), shipPalette, SHIP_VOXEL_SIZE);
  hull.computeBoundingBox();
  const [low, high] = [hull.boundingBox.min, hull.boundingBox.max];
  const expected = [-10.23, -2.79, -12.71, 10.23, 6.51, 11.47];
  [...low.toArray(), ...high.toArray()].forEach((value, i) => {
    assert.ok(Math.abs(value - expected[i]) < 1e-5, `bound ${i}: ${value}`);
  });
});

test('player and Warden details fit the craft budgets and the heaviest legal cap mix', () => {
  const playerFaces = shipFaces();
  assert.ok(playerFaces.some(face => face.material === 9 && face.side === 4), 'teal canopy panels');
  const player = triangleCount(playerFaces, shipPalette);
  const warden = triangleCount(wardenFaces(), wardenPalette);
  assert.ok(player <= 1620, `player: ${player}`);
  assert.ok(warden > 1204 && warden <= 1500, `Warden: ${warden}`);

  const kinds = [
    ['patrol', triangleCount(droneFaces(), dronePalette)],
    ['interceptor', triangleCount(droneFaces('interceptor'), dronePalette)],
    ...NEW_ENEMY_KINDS.map(kind => {
      const { faces, palette } = enemyAirframe(kind);
      return [kind, triangleCount(faces, palette)];
    }),
  ];
  const byCost = kinds.flatMap(([kind, count]) => Array(ENEMY_KINDS[kind].cap).fill(count)).sort((a, b) => b - a);
  const atCap = cap => byCost.slice(0, cap).reduce((sum, count) => sum + count, 0);
  const wave = player + atCap(enemyLimit({ boss: null, tick: Infinity }));
  const boss = player + warden + atCap(enemyLimit({ boss: {} }));
  assert.ok(wave <= 6032 * 1.25, `wave: ${wave}`);
  assert.ok(boss <= 5360 * 1.25, `boss: ${boss}`);
});

test('a full Gnat swarm adds one instanced batch and at most 1,280 triangles', () => {
  assert.equal(typeof flightScene.makeGnatBatch, 'function');
  const batch = flightScene.makeGnatBatch();
  assert.ok(batch.isInstancedMesh);
  assert.equal(batch.count, 0);
  assert.equal(batch.instanceMatrix.count, 80);
  assert.equal(batch.instanceColor.count, 80);
  assert.equal(batch.layers.mask, 1, 'the world batch remains visible in the rear camera');
  const triangles = batch.geometry.index.count / 3;
  assert.ok(triangles > 0 && triangles * 80 <= 1280, `swarm: ${triangles * 80}`);
});

test('carrier beacons and crates share a single small world instance batch', () => {
  const batch = flightScene.makeChestBatch();
  assert.ok(batch.isInstancedMesh);
  assert.equal(batch.count, 0);
  assert.equal(batch.instanceMatrix.count, 12);
  assert.equal(batch.geometry.index.count / 3 * batch.instanceMatrix.count, 144);
  assert.equal(batch.layers.mask, 1, 'the rear camera can see the crate batch');
});

test('each weapon mounts one distinct mesh to the existing ship and the four heaviest fit the budget', () => {
  const ship = new Object3D();
  const mounts = new WeaponMounts(ship);
  assert.equal(ship.children.length, WEAPON_IDS.length);
  const costs = [], boxes = new Set();
  for (const id of WEAPON_IDS) {
    const levels = Object.freeze({ [id]: 1 });
    mounts.update(levels);
    const visible = ship.children.filter(mesh => mesh.visible);
    assert.equal(visible.length, 1, id);
    const [mesh] = visible;
    assert.equal(mesh.name, `Weapon mount ${id}`);
    const geometry = mesh.geometry;
    const box = geometry.boundingBox;
    assert.ok(box.min.x >= -11.8 && box.max.x <= 11.8 && box.min.z >= -14 && box.max.z <= 12, id);
    boxes.add(JSON.stringify([box.min, box.max]));
    costs.push(geometry.index.count / 3);
  }
  assert.equal(boxes.size, WEAPON_IDS.length, 'all ten equipped shapes have their own local envelope');
  mounts.update(undefined);
  assert.equal(ship.children.filter(mesh => mesh.visible).length, 0);

  const fourMounts = costs.sort((a, b) => b - a).slice(0, 4).reduce((total, triangles) => total + triangles, 0);
  const drones = orbitDroneGeometry().index.count / 3 * 4;
  assert.ok(fourMounts + drones <= 432, `mounts ${fourMounts} + drones ${drones}`);
});

test('all ten evolutions change their attached voxel shapes within the four-mount draw and triangle budget', () => {
  const ship = new Object3D();
  const mounts = new WeaponMounts(ship);
  const costs = new Map();
  for (const id of WEAPON_IDS) {
    const levels = Object.freeze({ [id]: 5 });
    const evolution = Object.freeze({ [id]: EVOLUTIONS[id].id });
    mounts.update(levels);
    const original = ship.children.find(mesh => mesh.visible);
    const base = original.geometry;

    mounts.update(levels, evolution);
    const visible = ship.children.filter(mesh => mesh.visible);
    assert.equal(visible.length, 1, id);
    assert.equal(visible[0], original, id);
    const evolved = visible[0].geometry;
    assert.notDeepEqual(evolved.boundingBox, base.boundingBox, `${id} visibly changes its silhouette`);
    const { min, max } = evolved.boundingBox;
    assert.ok(min.x >= -12.5 && max.x <= 12.5 && min.z >= -16 && max.z <= 14, id);
    const triangles = geometry => geometry.index.count / 3;
    costs.set(id, Math.max(triangles(base), triangles(evolved)));

    mounts.update(levels);
    assert.equal(original.geometry, base, id);
    mounts.update(levels, evolution);
    assert.equal(original.geometry, evolved, id);
  }

  const heaviest = [...costs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const levels = Object.fromEntries(heaviest.map(([id]) => [id, 5]));
  const evolutions = Object.fromEntries(heaviest.map(([id]) => [id, EVOLUTIONS[id].id]));
  mounts.update(levels, evolutions);
  assert.equal(ship.children.filter(mesh => mesh.visible).length, 4);
  const attachments = heaviest.reduce((total, [, triangles]) => total + triangles, 0);
  const drones = orbitDroneGeometry().index.count / 3 * 4;
  assert.ok(attachments + drones <= 576, `evolved mounts ${attachments} + drones ${drones}`);
});
