import test from 'node:test';
import assert from 'node:assert/strict';
import { enemyLimit, relocateStragglers } from '../src/spawn-director.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { advanceEnemies, makeEnemy } from '../src/stage-enemies.ts';
import { World } from '../src/world.ts';

const world = new World();
const ground = (x, z) => world.height(x, z);
const fixture = kind => createStage(parseStageOptions('?fixture=' + kind), ground);
const advance = (state, count, input = {}) => {
  for (let tick = 0; tick < count; tick++) stepStage(state, tick === 0 ? input : {}, ground);
};

test('a Skimmer follows the water surface in SKIM and fires two planar darts', () => {
  const state = fixture('skimmer');
  assert.equal(state.enemies[0]?.kind, 'skimmer');
  const skimmer = state.enemies[0];
  assert.equal(skimmer.hp, 2);
  const launchAlt = ground(skimmer.x, skimmer.z) + 30;
  skimmer.shotAt = state.tick + 1;
  advance(state, 1);
  assert.equal(skimmer.tell?.kind, 'strafe');
  advance(state, skimmer.tell.until - state.tick - 1);
  assert.equal(state.shots.filter(shot => shot.kind === 'hostile').length, 0);
  advance(state, 1);
  const shots = state.shots.filter(shot => shot.kind === 'hostile');
  assert.equal(shots.length, 2);
  assert.ok(shots.every(shot => shot.alt === launchAlt));
  advance(state, 85, { turn: 1 });
  assert.equal(skimmer.alt, ground(skimmer.x, skimmer.z) + 30);
  assert.equal(skimmer.skim, true);
  assert.ok(ground(skimmer.x, skimmer.z) <= 39);
});

test('a Spotter charges a fixed shot for 0.8 s and buffs a nearby Hound by 20%', () => {
  const state = fixture('spotter');
  const spotter = state.enemies[0];
  assert.equal(spotter?.kind, 'spotter');
  assert.equal(spotter.hp, 4);
  const hound = fixture('hound').enemies[0];
  hound.id = 91;
  hound.z = spotter.z - 115;
  hound.x = spotter.x;
  state.enemies.push(hound);
  const comparison = structuredClone(state);
  comparison.enemies.shift();
  spotter.shotAt = state.tick + 1;
  advance(state, 1);
  advance(comparison, 1);
  const speed = e => Math.hypot(e.vx, e.vz);
  assert.ok(Math.abs(speed(hound) / speed(comparison.enemies[0]) - 1.2) < 1e-6);
  assert.equal(spotter.tell.until - state.tick, 48);
  const aim = spotter.tell.target;
  advance(state, 47);
  assert.deepEqual(spotter.tell.target, aim);
  assert.equal(state.shots.filter(shot => shot.alt === 145 && shot.kind === 'hostile').length, 0);
  advance(state, 1);
  const shots = state.shots.filter(shot => shot.alt === 145 && shot.kind === 'hostile');
  assert.equal(shots.length, 1);
  const [shot] = shots;
  assert.ok(Math.abs((aim.x - shot.x) * shot.vz - (aim.z - shot.z) * shot.vx) < 1e-6);
});

test('Flankers hold to the side at their assigned weapon height', () => {
  const state = fixture('flanker');
  const flanker = state.enemies[0];
  assert.equal(flanker?.kind, 'flanker');
  advance(state, 180);
  const angle = Math.abs(Math.atan2(flanker.x - state.player.x, flanker.z - state.player.z));
  assert.ok(angle >= 70 * Math.PI / 180 && angle <= 100 * Math.PI / 180);
  assert.ok([75, 145].includes(flanker.alt));
});

test('a rear Harrier telegraphs one adjacent hop in answer to an Immelmann', () => {
  const state = fixture('harrier');
  const harrier = state.enemies[0];
  assert.equal(harrier?.kind, 'harrier');
  harrier.x = state.player.x;
  harrier.z = state.player.z - 78;
  harrier.yaw = state.player.yaw;
  advance(state, 1, { maneuver: 'immelmann' });
  assert.equal(harrier.maneuver?.band, 2);
  assert.equal(harrier.maneuver?.diveAt - state.tick, 75);
  advance(state, 75);
  assert.equal(harrier.maneuver?.phase, 'diving');
  advance(state, 75);
  assert.equal(harrier.alt, 145);
  assert.equal(harrier.maneuver, null);
});

test('a Diver flashes for 1.2 s and fires one three-way fan during its plunge', () => {
  const state = fixture('diver');
  const diver = state.enemies[0];
  assert.equal(diver?.kind, 'diver');
  diver.maneuverAt = state.tick + 1;
  advance(state, 1);
  assert.equal(diver.maneuver?.diveAt - state.tick, 72);
  advance(state, 72);
  assert.ok(diver.alt < 145);
  assert.equal(state.shots.filter(shot => shot.kind === 'hostile').length, 0);
  for (let i = 0; i < 65 && !state.shots.some(shot => shot.kind === 'hostile'); i++) advance(state, 1);
  assert.equal(state.shots.filter(shot => shot.kind === 'hostile').length, 3);
});

test('a Bomber has two patrol escorts and its mines fall from CRUISE to LOW', () => {
  const state = fixture('bomber');
  const bomber = state.enemies[0];
  assert.equal(bomber?.kind, 'bomber');
  assert.equal(bomber.hp, 10);
  assert.equal(state.enemies.filter(enemy => enemy.formation?.leader === bomber.id).length, 2);
  bomber.shotAt = state.tick + 1;
  advance(state, 1);
  assert.equal(bomber.tell?.kind, 'mine');
  advance(state, bomber.tell.until - state.tick);
  assert.equal(state.enemyMines.length, 1);
  const mine = state.enemyMines[0];
  assert.ok(mine.alt > 109 && mine.alt <= 110);
  advance(state, 160, { turn: 1 });
  assert.equal(mine.alt, 75);
});

test('a landmark turret fixes a single-band flak position after a 1.4 s warning', () => {
  const state = fixture('turret');
  const turret = state.enemies[0];
  assert.equal(turret?.kind, 'turret');
  assert.equal(turret.alt, ground(turret.x, turret.z) + 5);
  state.twinAt = state.podsAt = state.strafeAt = Infinity;
  turret.shotAt = state.tick + 1;
  advance(state, 1);
  assert.equal(turret.tell?.until - state.tick, 84);
  const warning = { ...turret.tell };
  advance(state, 84);
  const puff = state.effects.find(effect => effect.kind === 'flak');
  assert.deepEqual([puff.x, puff.z, puff.alt], [warning.x, warning.z, warning.alt]);
});

test('an early sortie stages a high patrol in the aft quarter to run a flyby', () => {
  const state = createStage(parseStageOptions('?autoplay=1'));
  state.twinAt = state.podsAt = Infinity;
  for (let i = 0; i < 185; i++) stepStage(state);
  const patrol = state.enemies.find(enemy => enemy.kind === 'patrol' && enemy.band === 2);
  assert.equal(patrol?.flyby?.phase, 'overtake');
  assert.ok(patrol.z < state.player.z);
});

test('an aft fighter passes a wingtip and sweeps across the nose through a gentle heading correction', () => {
  for (const turn of [0, 0.07]) {
    const state = fixture('hound'), p = state.player;
    state.twinAt = state.podsAt = Infinity;
    const fighter = makeEnemy(state, p.x + 48, p.z - 104, 2, 'interceptor', 3);
    Object.assign(fighter, { yaw: p.yaw, maneuverAt: Infinity, shotAt: Infinity });
    state.enemies = [fighter];
    let wingtip = false, acrossTheNose = false, priorSide = fighter.x - p.x;
    for (let i = 0; i < 445 && !acrossTheNose; i++) {
      const { x, z } = fighter;
      advance(state, 1, { turn: i < 60 ? turn : 0 });
      const dx = fighter.x - p.x, dz = fighter.z - p.z, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      const ahead = dx * fx + dz * fz, side = dx * fz - dz * fx;
      assert.equal(fighter.band, 2);
      assert.equal(fighter.alt, 148);
      assert.ok(Math.hypot(fighter.x - x, fighter.z - z) < 3);
      if (Math.abs(ahead) <= 6) wingtip ||= fighter.flyby?.phase === 'overtake' && side >= 48;
      if (priorSide > 0 && side <= 0) acrossTheNose ||= fighter.flyby?.phase === 'cross' && ahead >= 96 && ahead <= 200;
      priorSide = side;
    }
    assert.ok(wingtip, `side clearance at turn ${turn}`);
    assert.ok(acrossTheNose, `nose crossing at turn ${turn}`);
  }
});

test('opening patrols arrive far enough out to read before their slower-than-boost bolts fire', () => {
  const state = createStage(parseStageOptions('?autoplay=1'));
  state.twinAt = state.podsAt = state.strafeAt = Infinity;
  state.player.altitude = 145;
  advance(state, 120);
  const engaged = state.enemies.filter(enemy => !enemy.entry);
  assert.equal(engaged.length, 2);
  const firstVolley = Math.min(...engaged.map(enemy => enemy.shotAt));
  for (const enemy of engaged) {
    const range = Math.hypot(enemy.x - state.player.x, enemy.z - state.player.z);
    assert.ok(range >= 230 && range < 276);
  }
  assert.ok(firstVolley - state.tick >= 82 && firstVolley - state.tick <= 106);
  advance(state, firstVolley - state.tick - 1);
  assert.equal(state.shots.length, 0);
  advance(state, 1);
  assert.ok(state.shots.length > 0 && state.shots.every(shot => shot.kind === 'hostile'
    && Math.abs(Math.hypot(shot.vx, shot.vz) - 116) < 1e-6));
});

test('boost opens a gap from the dedicated tail aircraft without turning them into flybys', () => {
  const state = fixture('hound'), p = state.player;
  state.twinAt = state.podsAt = Infinity;
  state.enemies = ['hound', 'harrier'].map(kind => {
    const enemy = makeEnemy(state, p.x + 20, p.z - 54, 1, kind);
    return Object.assign(enemy, { yaw: p.yaw, shotAt: Infinity });
  });
  advance(state, 60);
  const before = state.enemies.map(enemy => p.z - enemy.z);
  for (let i = 0; i < 80; i++) stepStage(state, { boost: true }, ground);
  for (const [index, enemy] of state.enemies.entries()) {
    assert.equal(enemy.flyby, undefined);
    assert.ok(p.z - enemy.z > before[index] + 50);
  }
});

test('an airborne straggler re-enters the forward quarter only after staying far aft', () => {
  const state = fixture('hound'), p = state.player;
  const patrol = makeEnemy(state, p.x + 72, p.z - 450, 2, 'patrol', -2);
  patrol.hp = 1;
  state.enemies = [patrol];
  for (let i = 0; i < 155; i++) {
    state.tick++;
    relocateStragglers(state, ground);
  }
  assert.ok(patrol.z < p.z - 400);
  state.tick++;
  relocateStragglers(state, ground);
  assert.ok(patrol.entry && Math.hypot(patrol.x - p.x, patrol.z - p.z) >= 1280);
  while (patrol.entry) {
    state.tick++;
    advanceEnemies(state, ground);
  }
  const dx = patrol.x - p.x, dz = patrol.z - p.z, range = Math.hypot(dx, dz);
  assert.ok(dz > 0 && Math.abs(Math.atan2(dx, dz)) <= Math.PI / 3);
  assert.ok(range >= 350 && range <= 450);
  assert.equal(patrol.hp, 1);
  assert.equal(patrol.band, 2);
  assert.equal(patrol.alt, 143);
  assert.equal(state.pickups.length, 0);
});

test('the old rim leaves re-entry open while nearby flanking and pursuit contacts stay put', () => {
  const state = fixture('hound'), p = state.player;
  Object.assign(p, { x: 0, z: 455 });
  const aft = makeEnemy(state, p.x + 40, p.z - 450, 2);
  const wide = makeEnemy(state, p.x + 670, p.z - 240, 2);
  const tail = makeEnemy(state, p.x - 20, p.z - 520, 2, 'harrier');
  state.enemies = [aft, wide, tail];
  const positions = state.enemies.map(({ x, z }) => [x, z]);
  for (let i = 0; i < 420; i++) {
    state.tick++;
    relocateStragglers(state, ground);
  }
  assert.ok(aft.entry?.target.z > p.z + 200);
  assert.deepEqual(state.enemies.slice(1).map(({ x, z }) => [x, z]), positions.slice(1));
});

test('a Split-S does not pull a water-only Skimmer through a sea stack', () => {
  const state = fixture('skimmer');
  Object.assign(state.player, { x: 288, z: 308, yaw: 0, altitude: 110 });
  const skimmer = state.enemies[0];
  Object.assign(skimmer, { x: 288, z: 208 });
  advance(state, 90, { maneuver: 'split-s' });
  assert.equal(skimmer.alt, ground(skimmer.x, skimmer.z) + 30);
  assert.ok(ground(skimmer.x, skimmer.z) <= 39);
});

test('a far turret transfers to a local ground site ahead and keeps its HP', () => {
  const state = fixture('turret');
  const turret = state.enemies[0];
  Object.assign(state.player, { x: -5, z: 278, yaw: Math.PI / 2, altitude: 145 });
  Object.assign(turret, { x: state.player.x - 450, z: state.player.z, farTicks: 155, hp: 2 });
  advance(state, 1);
  const { x, z } = state.player;
  assert.ok(turret.entry && turret.alt > 140);
  while (turret.entry && state.phase === 'playing') advance(state, 1);
  assert.equal(turret.entry, undefined);
  assert.ok(turret.x > 400 && Math.hypot(turret.x - x, turret.z - z) > 350);
  assert.equal(turret.alt, ground(turret.x, turret.z) + 5);
  assert.equal(turret.skim, true);
  assert.equal(turret.hp, 2);
  assert.equal(state.pickups.length, 0);
});

test('seeded sorties keep fly-in and combat turns within 3.2 radians per second', () => {
  const kinds = new Set();
  const duration = 105 * 60;
  for (const seed of [1, 11, 53]) {
    const state = createStage(parseStageOptions('?autoplay=1&seed=' + seed), ground);
    state.twinAt = state.podsAt = Infinity;
    state.graceUntil = Infinity;
    state.invulnerability = Infinity;
    const bomberBeats = [];
    for (let tick = 0; tick < duration; tick++) {
      const before = new Map(state.enemies.map(enemy => [enemy.id, enemy.yaw]));
      stepStage(state, { turn: Math.sin(tick / 137) * 0.6 }, ground);
      assert.ok(state.enemies.length <= enemyLimit(state));
      for (const enemy of state.enemies) {
        if (!enemy.hp) continue;
        const previous = before.get(enemy.id);
        if (previous === undefined && enemy.kind === 'bomber') {
          bomberBeats.push(state.tick);
          assert.equal(state.enemies.filter(contact => contact.formation?.leader === enemy.id).length, 2);
        }
        // A straggler gets a fresh heading only when sent to the off-screen origin.
        if (previous === undefined || enemy.entry?.startedAt === state.tick) continue;
        kinds.add(enemy.kind);
        const delta = enemy.yaw - previous;
        const turn = Math.atan2(Math.sin(delta), Math.cos(delta));
        assert.ok(Math.abs(turn) <= 3.2 / 60 + 1e-9, `${enemy.kind} turned ${turn} rad at tick ${tick} (seed ${seed})`);
      }
    }
    assert.equal(state.tick, duration);
    assert.deepEqual(bomberBeats, [4110, 5310], `reserved bomber formations for seed ${seed}`);
  }
  // The saturated patrol cap can skip individual fighters between the two reserved waves.
  for (const kind of ['hound', 'interceptor']) {
    const state = fixture('hound');
    const enemy = makeEnemy(state, state.player.x + 32, state.player.z - 78, 1, kind);
    state.enemies = [enemy];
    let steered = false;
    for (let tick = 0; tick < 90; tick++) {
      assert.ok(enemy.hp > 0);
      const yaw = enemy.yaw;
      stepStage(state, { turn: 0.6 }, ground);
      const turn = Math.atan2(Math.sin(enemy.yaw - yaw), Math.cos(enemy.yaw - yaw));
      assert.ok(Math.abs(turn) <= 3.2 / 60 + 1e-9, `${kind} turned ${turn} rad at tick ${tick}`);
      steered ||= turn !== 0;
    }
    assert.ok(steered);
    kinds.add(kind);
  }
  assert.equal(kinds.size, 10, `only checked ${[...kinds]}`);
});

test('a patrol keeps its close steering mode on both sides of the nominal range', () => {
  const state = fixture('hound');
  const patrol = makeEnemy(state, state.player.x, state.player.z + 40, 1);
  state.enemies = [patrol];
  for (const [range, expected] of [[40, false], [26, false], [18, true], [30, true], [36, false]]) {
    patrol.x = state.player.x;
    patrol.z = state.player.z + range;
    state.tick++;
    advanceEnemies(state, ground);
    assert.equal(patrol.closeRange, expected);
  }
});

test('an enemy holds its terrain escape heading when its requested course clears briefly', () => {
  const state = fixture('hound');
  const patrol = makeEnemy(state, 0, 0, 1);
  Object.assign(patrol, { yaw: 0, shotAt: Infinity });
  Object.assign(state.player, { x: 0, z: 100, yaw: 0 });
  state.enemies = [patrol];

  advanceEnemies(state, (x, z) => Math.abs(x) < 6 && z >= 10 ? 110 : 0);
  const escape = patrol.terrainTurn;
  assert.ok(escape);
  state.tick++;
  advanceEnemies(state, () => 0);
  assert.equal(patrol.terrainTurn, escape);
  assert.ok(Math.sign(patrol.yaw) === Math.sign(escape.yaw));

  state.tick = escape.until;
  advanceEnemies(state, () => 0);
  assert.equal(patrol.terrainTurn, undefined);
});
