import test from 'node:test';
import assert from 'node:assert/strict';
import { droneFaces, dronePalette, shipFaces, shipPalette } from '../proto/shared/models.ts';
import { bakeVoxels } from '../proto/three/src/voxel-geometry.ts';
import { ENEMY_KINDS, NEW_ENEMY_KINDS } from '../src/enemy-kinds.ts';
import { SHIP_VOXEL_SIZE } from '../src/engine-exhaust.ts';
import { enemyAirframe, wardenFaces, wardenPalette } from '../src/models.ts';
import { enemyLimit } from '../src/spawn-director.ts';

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
