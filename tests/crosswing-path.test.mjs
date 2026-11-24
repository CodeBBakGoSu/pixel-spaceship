import assert from 'node:assert/strict';
import test from 'node:test';
import { autopilotInput } from '../src/autoplay.ts';
import { TICKS_PER_SECOND } from '../src/simulation-time.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { advanceEnemies, makeEnemy } from '../src/stage-enemies.ts';
import { World } from '../src/world.ts';

const orientation = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
const onSegment = (a, b, c) => c.x >= Math.min(a.x, b.x) - 1e-8 && c.x <= Math.max(a.x, b.x) + 1e-8
  && c.z >= Math.min(a.z, b.z) - 1e-8 && c.z <= Math.max(a.z, b.z) + 1e-8;
function segmentsIntersect(a, b, c, d) {
  const abC = orientation(a, b, c), abD = orientation(a, b, d);
  const cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  if (Math.abs(abC) <= 1e-8 && onSegment(a, b, c)) return true;
  if (Math.abs(abD) <= 1e-8 && onSegment(a, b, d)) return true;
  if (Math.abs(cdA) <= 1e-8 && onSegment(c, d, a)) return true;
  if (Math.abs(cdB) <= 1e-8 && onSegment(c, d, b)) return true;
  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

test('seed 4 full-step Crosswing paths intersect and recover only after both exit', () => {
  const world = new World();
  const ground = (x, z) => world.height(x, z);
  const state = createStage(parseStageOptions('?autoplay=1&mode=survivors&seed=4'), ground);
  for (const weapon of Object.keys(state.run.weaponLevels)) state.run.weaponLevels[weapon] = 0;
  let actualSpawnTick, tellTick, recoveryTick, ids, crossingPoint;
  const traces = new Map();
  const finishes = new Map();

  for (let frame = 0; frame < 151 * TICKS_PER_SECOND && recoveryTick === undefined; frame++) {
    const before = new Map(state.enemies.filter(enemy => enemy.kind === 'crosswing').map(enemy => [enemy.id, {
      position: { x: enemy.x, z: enemy.z }, crossed: enemy.crosswing?.crossed ?? false,
    }]));
    const input = autopilotInput(state, 'full', ground);
    input.fire = false;
    stepStage(state, input, ground);
    const pair = state.enemies.filter(enemy => enemy.kind === 'crosswing');
    if (pair.length === 2) actualSpawnTick ??= state.tick;
    if (!ids && pair.length === 2 && pair.every(enemy => enemy.crosswing?.phase === 'warning')) {
      tellTick = state.tick;
      ids = pair.map(enemy => enemy.id);
      crossingPoint = pair[0].crosswing.crossingPoint;
      assert.deepEqual(pair[0].crosswing.start, before.get(pair[0].id).position);
      assert.deepEqual(pair[1].crosswing.start, before.get(pair[1].id).position);
      assert.deepEqual(pair[1].crosswing.crossingPoint, crossingPoint);
      assert.notDeepEqual(pair[0].crosswing.target, pair[1].crosswing.target);
    }
    if (ids) {
      for (const enemy of pair) {
        if (!ids.includes(enemy.id)) continue;
        const previous = before.get(enemy.id);
        const current = { x: enemy.x, z: enemy.z };
        if (previous) {
          const segments = traces.get(enemy.id) ?? [];
          if (!previous.crossed && enemy.crosswing.crossed) {
            segments.push({ from: previous.position, to: crossingPoint }, { from: crossingPoint, to: current });
          } else {
            segments.push({ from: previous.position, to: current });
          }
          traces.set(enemy.id, segments);
        }
        if (enemy.crosswing.finishedAt !== undefined) finishes.set(enemy.id, enemy.crosswing.finishedAt);
      }
      if (pair.length === 2 && pair.every(enemy => enemy.crosswing?.phase === 'recovery')) {
        recoveryTick = state.tick;
      }
    }
  }

  assert.ok(actualSpawnTick >= 140 * TICKS_PER_SECOND);
  assert.ok(tellTick >= actualSpawnTick);
  assert.equal(finishes.size, 2);
  assert.ok(recoveryTick >= Math.max(...finishes.values()));
  const [first, second] = ids;
  assert.ok(traces.get(first).some(a => traces.get(second).some(b => segmentsIntersect(a.from, a.to, b.from, b.to))));
});

test('Crosswing cancels the un-crossed path when its mate dies during warning', () => {
  const ground = () => 35;
  const state = createStage(parseStageOptions('?mode=survivors&t=0'), ground);
  const first = makeEnemy(state, -30, 120, 1, 'crosswing');
  const second = makeEnemy(state, 30, 120, 1, 'crosswing');
  first.crosswing = { mate: second.id, side: -1 };
  second.crosswing = { mate: first.id, side: 1 };
  first.maneuverAt = second.maneuverAt = state.tick;
  state.enemies.push(first, second);
  advanceEnemies(state, ground);
  assert.equal(first.crosswing.phase, 'warning');

  second.hp = 0;
  state.tick++;
  advanceEnemies(state, ground);
  assert.equal(first.crosswing.phase, 'cancelled');
  assert.equal(first.crosswing.crossed, false);
  assert.equal(first.tell, undefined);
});
