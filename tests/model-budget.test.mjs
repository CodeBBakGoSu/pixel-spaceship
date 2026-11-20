import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Mesh, Object3D, Raycaster, Vector3 } from 'three';
import { bakeVoxels } from '../proto/three/src/voxel-geometry.ts';
import { EVOLUTIONS, WEAPON_IDS } from '../src/data/items.ts';
import { SWARM_CAPS } from '../src/data/phases.ts';
import { ENEMY_KINDS, NEW_ENEMY_KINDS } from '../src/enemy-kinds.ts';
import { HostileVisuals } from '../src/hostile-visuals.ts';
import * as models from '../src/models.ts';
import { aceAirframe } from '../src/models-roster.ts';
import { RosterVisuals } from '../src/roster-visuals.ts';
import * as flightScene from '../src/scene.ts';
import { enemyLimit } from '../src/spawn-director.ts';
import { SHOT_LIMIT, STEP } from '../src/stage-combat.ts';
import * as voxels from '../src/voxel.ts';
import { orbitDroneGeometry, WeaponMounts } from '../src/weapon-render.ts';

const bake = ({ faces, palette, size }) => bakeVoxels(faces, palette, size);
const triangleCount = geometry => geometry.index.count / 3;
const craftTriangles = model => triangleCount(bake(model));
const enemyKinds = ['patrol', 'interceptor', ...NEW_ENEMY_KINDS];

function assertBounds(geometry, expected, label) {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  [...min.toArray(), ...max.toArray()].forEach((value, i) => {
    assert.ok(Math.abs(value - expected[i]) < 1e-5, `${label} bound ${i}: ${value}`);
  });
}

function assertSameSilhouette(low, detailed, label) {
  const origin = low.faces[0];
  for (const [side, axes] of [[0, ['y', 'z']], [2, ['x', 'z']], [4, ['x', 'y']]]) {
    const footprint = ({ faces, size }) => new Set(faces.filter(face => face.side === side).map(face =>
      axes.map(axis => Math.round(face[axis] * size / low.size - origin[axis])).join(',')));
    const before = footprint(low), after = footprint(detailed);
    assert.equal(after.size, before.size, `${label} profile ${side} area`);
    for (const cell of before) assert.ok(after.has(cell), `${label} profile ${side} lost cell ${cell}`);
  }
}

test('refining a voxel keeps its center and supports new half-cell material and cavity details', () => {
  const model = { width: 2, length: 1, height: 1, pivot: [0.5, 0, 0], data: Uint8Array.of(1, 2) };
  const refined = voxels.refineVoxelModel(model, (x, y, z, material, sample) => {
    if (x === -0.25 && y === -0.25 && z === 0.25) return 0;
    if (material === 2 && sample(x - 1, y, z) === 1 && z > 0) return 3;
    return material;
  });
  assert.deepEqual(refined.pivot, [1.5, 0.5, 0.5]);
  assert.deepEqual([...refined.data], [1, 1, 2, 2, 1, 1, 2, 2, 1, 0, 3, 3, 1, 1, 3, 3]);
  assert.deepEqual([...model.data], [1, 2]);
});

test('0.155 m player voxels preserve the world dimensions and the exhaust sockets', () => {
  const player = models.playerAirframe(true);
  assert.equal(player.size, 0.155);
  assert.ok(player.faces.some(face => face.material === 9 && face.side === 4), 'teal canopy panels');
  assertSameSilhouette(models.playerAirframe(false), player, 'player');
  const hull = new Mesh(bake(player));
  assertBounds(hull.geometry, [-10.23, -2.79, -12.71, 10.23, 6.51, 11.47], 'player');

  const aft = new Vector3(0, 0, -1);
  for (const x of [-3.41, 3.41]) {
    const rear = new Vector3(x, -0.62, 13.43);
    const [pocket] = new Raycaster(rear, aft).intersectObject(hull);
    const [collar] = new Raycaster(rear.clone().add(new Vector3(0, 1.42, 0)), aft).intersectObject(hull);
    assert.ok(pocket && pocket.point.z < 10.53, `exhaust ${x} has an open throat`);
    assert.ok(collar && Math.abs(collar.point.z - 11.43) < 0.08, `exhaust ${x} retains its collar`);
  }
});

test('the existing regular airframes keep their silhouettes at double voxel density', () => {
  for (const kind of enemyKinds) {
    const low = models.enemyAirframe(kind, false), detailed = models.enemyAirframe(kind, true);
    assert.equal(detailed.size, low.size / 2, kind);
    assertSameSilhouette(low, detailed, kind);
    const coarseGeometry = bake(low);
    coarseGeometry.computeBoundingBox();
    const { min, max } = coarseGeometry.boundingBox;
    assertBounds(bake(detailed), [...min.toArray(), ...max.toArray()], kind);
  }
});

test('the fine Ace and Aegis retain their authored hull bounds and fit their roster caps', () => {
  const ace = bake(aceAirframe());
  const aegis = bake(models.enemyAirframe('aegis', true));
  assert.equal(aceAirframe().size, 0.5);
  assert.equal(models.enemyAirframe('aegis', true).size, 0.55);
  assertBounds(ace, [-16.25, -2.25, -16.25, 16.25, 7.25, 14.75], 'Ace');
  assertBounds(aegis, [-10.175, -1.925, -7.975, 10.175, 2.475, 7.975], 'Aegis');
  assert.ok(triangleCount(ace) > craftTriangles(aceAirframe(false)) && triangleCount(ace) <= 1500);
  assert.ok(triangleCount(aegis) > craftTriangles(models.enemyAirframe('aegis')) && triangleCount(aegis) <= 300);
});

function cappedEnemyTriangles(detailed) {
  const kinds = [...enemyKinds, 'aegis'].map(kind => [kind, craftTriangles(models.enemyAirframe(kind, detailed))]);
  const byCost = kinds.flatMap(([kind, count]) => Array(ENEMY_KINDS[kind].cap).fill(count)).sort((a, b) => b - a);
  return cap => byCost.slice(0, cap).reduce((sum, count) => sum + count, 0);
}

test('the low craft LOD stays within the existing airframe caps', () => {
  const player = craftTriangles(models.playerAirframe(false));
  const ace = craftTriangles(aceAirframe(false));
  assert.ok(player <= 1620, `player: ${player}`);
  const atCap = cappedEnemyTriangles(false);
  const wave = player + atCap(enemyLimit({ boss: null, tick: Infinity }));
  const boss = player + ace + atCap(enemyLimit({ boss: {} }));
  assert.ok(wave <= 6032 * 1.25, `wave: ${wave}`);
  assert.ok(boss <= 5360 * 1.25, `boss: ${boss}`);
  const mobileStress = wave + ace + triangleCount(models.gnatGeometry(false)) * SWARM_CAPS.mobile;
  assert.ok(mobileStress <= 10000, `mobile max-load fixture: ${mobileStress}`);
});

test('the detailed craft LOD fits the combined wave and Ace budgets', () => {
  const player = craftTriangles(models.playerAirframe(true));
  const ace = craftTriangles(aceAirframe(true));
  assert.ok(player >= 2200 && player <= 3400, `player: ${player}`);
  for (const kind of enemyKinds) {
    const low = craftTriangles(models.enemyAirframe(kind, false));
    const detailed = craftTriangles(models.enemyAirframe(kind, true));
    assert.ok(detailed > low * 1.2 && detailed <= 1200, `${kind}: ${low} → ${detailed}`);
  }
  const atCap = cappedEnemyTriangles(true);
  const swarm = triangleCount(models.gnatGeometry(true)) * SWARM_CAPS.desktop;
  const wave = player + atCap(enemyLimit({ boss: null, tick: Infinity })) + swarm;
  const boss = player + ace + atCap(enemyLimit({ boss: {} })) + swarm;
  assert.ok(wave <= 17500, `wave with swarm: ${wave}`);
  assert.ok(boss <= 16500, `Ace with swarm: ${boss}`);
  // The profiling fixture stacks the Ace on the largest wave and swarm.
  assert.ok(wave + ace <= 21000, `desktop max-load fixture: ${wave + ace}`);
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

test('each Gnat LOD fits a full swarm in one instanced world batch', () => {
  assert.equal(typeof flightScene.makeGnatBatch, 'function');
  for (const detailed of [false, true]) {
    const batch = flightScene.makeGnatBatch(detailed);
    assert.ok(batch.isInstancedMesh);
    assert.equal(batch.count, 0);
    assert.equal(batch.instanceMatrix.count, SWARM_CAPS.desktop);
    assert.equal(batch.instanceColor.count, SWARM_CAPS.desktop);
    assert.equal(batch.layers.mask, 1, 'the world batch remains visible in the rear camera');
    assertBounds(batch.geometry, [-4.3, -0.95, -4.4, 4.3, 1.25, 3.5], 'Gnat');
    const triangles = triangleCount(batch.geometry);
    if (detailed) assert.ok(triangles > 16 && triangles <= 24, `detailed Gnat: ${triangles}`);
    else assert.equal(triangles, 16);
  }
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
