import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Object3D } from 'three';
import { droneFaces, dronePalette, shipFaces, shipPalette } from '../proto/shared/models.ts';
import { bakeVoxels } from '../proto/three/src/voxel-geometry.ts';
import { EVOLUTIONS, WEAPON_IDS } from '../src/data/items.ts';
import { ENEMY_KINDS, NEW_ENEMY_KINDS } from '../src/enemy-kinds.ts';
import { SHIP_VOXEL_SIZE } from '../src/engine-exhaust.ts';
import { HostileVisuals } from '../src/hostile-visuals.ts';
import { enemyAirframe } from '../src/models.ts';
import { aceAirframe, aegisAirframe } from '../src/models-roster.ts';
import { RosterVisuals } from '../src/roster-visuals.ts';
import * as flightScene from '../src/scene.ts';
import { enemyLimit } from '../src/spawn-director.ts';
import { SHOT_LIMIT, STEP } from '../src/stage-combat.ts';
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

test('player and roster details fit the craft budgets and the heaviest legal cap mix', () => {
  const playerFaces = shipFaces();
  assert.ok(playerFaces.some(face => face.material === 9 && face.side === 4), 'teal canopy panels');
  const player = triangleCount(playerFaces, shipPalette);
  const ace = aceAirframe(), aegis = aegisAirframe();
  const aceTriangles = triangleCount(ace.faces, ace.palette);
  const aegisTriangles = triangleCount(aegis.faces, aegis.palette);
  assert.ok(player <= 1620, `player: ${player}`);
  assert.ok(ace.size <= 0.6 && aegis.size <= 0.6, 'roster airframes use half-size cells');
  assert.ok(aceTriangles > 0 && aceTriangles <= 1500, `Ace: ${aceTriangles}`);
  assert.ok(aegisTriangles > 0 && aegisTriangles <= 300, `Aegis: ${aegisTriangles}`);

  const kinds = [
    ['patrol', triangleCount(droneFaces(), dronePalette)],
    ['interceptor', triangleCount(droneFaces('interceptor'), dronePalette)],
    ['aegis', aegisTriangles],
    ...NEW_ENEMY_KINDS.map(kind => {
      const { faces, palette } = enemyAirframe(kind);
      return [kind, triangleCount(faces, palette)];
    }),
  ];
  const byCost = kinds.flatMap(([kind, count]) => Array(ENEMY_KINDS[kind].cap).fill(count)).sort((a, b) => b - a);
  const atCap = cap => byCost.slice(0, cap).reduce((sum, count) => sum + count, 0);
  const wave = player + atCap(enemyLimit({ boss: null, tick: Infinity }));
  const boss = player + aceTriangles + atCap(enemyLimit({ boss: {} }));
  assert.ok(wave <= 6032 * 1.25, `wave: ${wave}`);
  assert.ok(boss <= 5360 * 1.25, `boss: ${boss}`);
});

test('Flak warnings expand in their target altitude plane in one rear-visible cue batch', () => {
  const visuals = new RosterVisuals();
  const state = { tick: 0, boss: null, swarmCap: 80, enemies: [
    { kind: 'turret', hp: 4, x: 11, z: 13, alt: 49, tell: { kind: 'flak', x: 100, z: 150, alt: 110, started: 0, until: 84 } },
  ] };
  const cue = visuals.group.getObjectByName('Enemy warning rings');
  const matrix = new Matrix4();
  visuals.update(state, undefined, false);
  assert.equal(cue.count, 1);
  cue.getMatrixAt(0, matrix);
  const initialRadius = matrix.elements[0];
  assert.equal(matrix.elements[13], 110);
  assert.equal(cue.layers.mask, 1);
  state.tick = 63;
  visuals.update(state, undefined, false);
  cue.getMatrixAt(0, matrix);
  assert.ok(matrix.elements[0] > initialRadius);
  assert.equal(matrix.elements[13], 110);
  state.tick = 84;
  visuals.update(state, undefined, false);
  assert.equal(cue.visible, false);
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

test('hostile heads, four trail samples and full spark bursts fit two instanced world batches', () => {
  const visuals = new HostileVisuals(() => 35);
  const state = {
    tick: 0, hull: 10, invulnerability: 0, player: { x: 0, z: 0, altitude: 110 },
    shots: Array.from({ length: SHOT_LIMIT }, (_, i) => ({
      kind: 'hostile', x: SHOT_LIMIT - i, z: 12, alt: 110, vx: 0, vz: 180, life: 2,
    })),
  };
  for (; state.tick < 11; state.tick++) {
    visuals.update(state);
    for (const shot of state.shots) shot.z += shot.vz * STEP;
  }
  for (const shot of state.shots) visuals.impact(shot, shot.x, shot.z, shot.alt, state.tick - 4);
  visuals.update(state);

  const [drops, glyphs] = visuals.group.children;
  assert.equal(visuals.group.children.length, 2);
  assert.ok(glyphs.geometry.isInstancedBufferGeometry);
  assert.ok(drops.isLineSegments && drops.geometry.isInstancedBufferGeometry);
  assert.equal(drops.layers.mask, 1, 'the rear camera sees the height cues');
  assert.equal(glyphs.layers.mask, 1, 'the rear camera sees the same glyphs');
  assert.equal(drops.geometry.instanceCount, 48);
  const x = drops.geometry.getAttribute('dropCenter');
  for (let i = 0; i < drops.geometry.instanceCount; i++) assert.equal(x.getX(i), i + 1, 'nearest first');

  // Legacy shot caps can exceed the survivor cap of 64. Each glyph is two triangles.
  const quadCount = glyphs.geometry.instanceCount;
  assert.equal(quadCount, SHOT_LIMIT * (1 + 4) + 24 * 5);
  assert.equal(quadCount * glyphs.geometry.index.count / 3, 2160);
});

test('hostile glyphs retain their emitted shapes across altitude and shield changes', () => {
  const visuals = new HostileVisuals(() => 35);
  const state = {
    tick: 20, hull: 10, invulnerability: 0, player: { x: 0, z: 0, altitude: 110 },
    shots: [118, 119, 101].map((alt, i) => ({
      kind: 'hostile', x: i * 10, z: 30, alt, vx: 0, vz: -78, life: 2,
    })),
  };
  for (const [index, shape] of ['orb', 'needle', 'diamond'].entries()) {
    const shot = state.shots[index];
    visuals.muzzle(shot, shape, shot.x, shot.z + 4, shot.alt, state.tick - 3);
  }
  const [drops, glyphs] = visuals.group.children;
  const styles = glyphs.geometry.getAttribute('glyphStyle');
  const heads = () => {
    const result = [];
    for (let i = 0; i < glyphs.geometry.instanceCount; i++) {
      if (styles.getY(i) <= 3 && styles.getW(i) === 1) result.push([styles.getX(i), styles.getY(i)]);
    }
    return result;
  };
  visuals.update(state);
  assert.deepEqual(heads(), [[0, 0], [1, 1], [2, 2]]);
  assert.ok(glyphs.geometry.instanceCount > 3, 'the same batch contains trails and muzzle flashes');
  state.player.altitude = 111;
  assert.equal(visuals.update(state), true, 'crossing the band boundary refreshes the rear feed');
  assert.deepEqual(heads(), [[0, 0], [1, 0], [2, 2]]);
  state.invulnerability = 0.25;
  assert.equal(visuals.update(state), true);
  assert.deepEqual(heads(), [[0, 3], [1, 3], [2, 2]]);

  visuals.setView(400, 158);
  assert.equal(drops.visible, false);
  visuals.setView(56);
  assert.equal(drops.visible, true);
  assert.deepEqual(heads(), [[0, 3], [1, 3], [2, 2]]);
});

test('Ace missiles keep their narrow rocket glyph when restored without a muzzle event', () => {
  const visuals = new HostileVisuals(() => 35);
  const state = {
    tick: 20, hull: 10, invulnerability: 0, player: { x: 0, z: 0, altitude: 110 },
    shots: [{ kind: 'hostile', hostileKind: 'ace-missile', x: 0, z: 32, alt: 110, vx: 0, vz: -200, life: 2 }],
  };
  visuals.update(state);
  const glyphs = visuals.group.getObjectByName('Hostile projectile glyphs');
  const style = glyphs.geometry.getAttribute('glyphStyle');
  const last = glyphs.geometry.instanceCount - 1;
  assert.equal(style.getX(last), 4);
  assert.equal(style.getY(last), 0, 'same-band danger colors are unchanged');
  assert.equal(style.getW(last), 1);
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
