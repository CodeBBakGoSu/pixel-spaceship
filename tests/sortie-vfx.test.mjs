import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { autopilotInput } from '../src/autoplay.ts';
import { BANDS } from '../src/bands.ts';
import { CLOSE_EVOLUTIONS } from '../src/data/close-evolutions.ts';
import { WEAPONS } from '../src/data/items.ts';
import { observeDamage } from '../src/combat-feedback.ts';
import { advanceFlares, TICKS_PER_SECOND } from '../src/stage-combat.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { clipProjectSortieSegment } from '../src/scene.ts';
import { advanceSupportWeapons } from '../src/support-weapons.ts';
import { SORTIE_VFX_IDS, SortieVfx, defeatVfxId, sortieVfxMode, weaponVfxId } from '../src/sortie-vfx.ts';
import { World } from '../src/world.ts';

const weapons = [
  ['twin', 'W01-F', 'W01-H'], ['pods', 'W02-F', 'W02-H'], ['seeker', 'W03-F', 'W03-H'],
  ['rail', 'W04-F', 'W04-H'], ['flak', 'W05-F', 'W05-H'], ['ion', 'W06-F', 'W06-H'],
  ['drones', 'W07-F', 'W07-H'], ['phoenix', 'W08-F', 'W08-H'], ['bomb-bay', 'W09-F', 'W09-H'],
  ['arc', 'W10-F', 'W10-H'],
];

function state(tick = 0) {
  return {
    tick, phase: 'playing', paused: false, boss: null, enemies: [],
    player: { x: 1, z: 2, altitude: 3 },
    shots: [], weaponFx: [], flares: [], rearBombs: [], ionWake: [], orbitDrones: [], effects: [], pickups: [],
  };
}

function context() {
  let count = 0;
  const ellipses = [], arcs = [], fillRects = [], operations = [], stack = [];
  let path = [];
  const mark = () => { count++; };
  const ctx = {
    canvas: { width: 1280, height: 720 },
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '',
    save() {
      stack.push([this.globalAlpha, this.globalCompositeOperation, this.fillStyle]);
      operations.push({ type: 'save' }); mark();
    },
    restore() {
      [this.globalAlpha, this.globalCompositeOperation, this.fillStyle] = stack.pop() ?? [1, 'source-over', ''];
      operations.push({ type: 'restore', composite: this.globalCompositeOperation }); mark();
    },
    beginPath() { path = []; operations.push({ type: 'beginPath' }); mark(); },
    moveTo(...args) { path.push(['moveTo', ...args]); mark(); },
    lineTo(...args) { path.push(['lineTo', ...args]); mark(); },
    stroke() { operations.push({ type: 'stroke', composite: this.globalCompositeOperation, path: [...path] }); mark(); },
    fillRect(...args) { fillRects.push(args); operations.push({ type: 'fillRect', composite: this.globalCompositeOperation, args }); mark(); },
    fill() { operations.push({ type: 'fill', composite: this.globalCompositeOperation, path: [...path] }); mark(); },
    closePath() { path.push(['closePath']); mark(); },
    arc(...args) { path.push(['arc', ...args]); arcs.push(args); mark(); },
    ellipse(...args) { path.push(['ellipse', ...args]); ellipses.push(args.slice(2, 4)); mark(); },
    drawCount: () => count, ellipses, arcs, fillRects, operations,
  };
  return ctx;
}

test('all 24 selected IDs have a weapon or defeat route', () => {
  assert.deepEqual(SORTIE_VFX_IDS, [
    ...weapons.flatMap(([, fire, hit]) => [fire, hit]), 'D01', 'D02', 'D03', 'D04',
  ]);
  for (const [weapon, fire, hit] of weapons) {
    assert.equal(weaponVfxId(weapon, 'fire'), fire);
    assert.equal(weaponVfxId(weapon, 'hit'), hit);
    const vfx = new SortieVfx(TICKS_PER_SECOND);
    vfx.fire(weapon, { tick: 1, position: { x: 1, z: 2, alt: 3 }, source: { x: 0, z: 0, alt: 1 } });
    vfx.hit(weapon, { tick: 1, position: { x: 4, z: 5, alt: 6 }, source: { x: 0, z: 0, alt: 1 } });
    assert.equal(vfx.activeCount, 2);
    const rendered = context();
    vfx.draw(rendered, state(1), point => ({ x: point.x, y: point.z }), () => 0, null);
    assert.ok(rendered.drawCount() > 0, weapon + ' routes render');
  }
  assert.equal(defeatVfxId({}), 'D01');
  assert.equal(defeatVfxId({ armored: true }), 'D02');
  assert.equal(defeatVfxId({ formation: true }), 'D03');
  assert.equal(defeatVfxId({ boss: true }), 'D04');
  for (const event of [
    { id: 1, tick: 1, position: { x: 1, z: 2, alt: 3 } },
    { id: 2, tick: 1, position: { x: 1, z: 2, alt: 3 }, armored: true },
  ]) {
    const defeat = new SortieVfx(TICKS_PER_SECOND), rendered = context();
    defeat.enemyDefeated(event);
    defeat.draw(rendered, state(1), point => ({ x: point.x, y: point.z }), () => 0, null);
    assert.ok(rendered.drawCount() > 0);
  }
});

test('hit effects project the exact continuous-world anchor at the renderer boundary', () => {
  const vfx = new SortieVfx(TICKS_PER_SECOND), target = { x: 11, z: 22, alt: 33 }, projected = [];
  vfx.hit('arc', { tick: 8, position: target });
  vfx.draw(context(), state(8), point => {
    projected.push({ ...point });
    return { x: point.x, y: point.z };
  }, () => 0, null);
  assert.deepEqual(projected[0], target);
});

test('three authoritative formation defeats become one bounded D03 at all three positions', () => {
  const vfx = new SortieVfx(TICKS_PER_SECOND);
  const positions = [{ x: 10, z: 20, alt: 30 }, { x: 40, z: 50, alt: 60 }, { x: 70, z: 80, alt: 90 }];
  positions.forEach((position, index) => vfx.enemyDefeated({ id: index + 1, tick: 2, position, formationId: 41 }));
  assert.equal(vfx.activeCount, 1);
  const projected = [];
  vfx.draw(context(), state(2), point => {
    projected.push({ ...point });
    return { x: point.x, y: point.z };
  }, () => 0, null);
  for (const position of positions) assert.ok(projected.some(point => JSON.stringify(point) === JSON.stringify(position)));
});

test('bomber leaders and both escorts report the same formation ID to defeat observers', () => {
  const world = new World(), ground = (x, z) => world.height(x, z);
  const observed = createStage(parseStageOptions('?mode=survivors&t=0&fixture=bomber&seed=19'), ground);
  const bomber = observed.enemies.find(enemy => enemy.kind === 'bomber');
  assert.ok(bomber);
  const members = observed.enemies.filter(enemy => enemy.id === bomber.id || enemy.formation?.leader === bomber.id);
  assert.equal(members.length, 3);
  for (const enemy of members) { enemy.hp = 0; enemy.shotDown = true; }
  const defeats = [];
  stepStage(observed, {}, ground, undefined, { destroyed(...event) { defeats.push(event); } });
  assert.equal(defeats.length, 3);
  assert.deepEqual(defeats.map(event => event[5]), [bomber.id, bomber.id, bomber.id]);
});

test('formation defeats group across render frames and flush only after the tick window expires', () => {
  const vfx = new SortieVfx(TICKS_PER_SECOND), positions = [
    { x: 10, z: 20, alt: 30 }, { x: 40, z: 50, alt: 60 }, { x: 70, z: 80, alt: 90 },
  ];
  vfx.enemyDefeated({ id: 1, tick: 10, position: positions[0], formationId: 81 });
  vfx.draw(context(), state(10), point => ({ x: point.x, y: point.z }), () => 0, null);
  assert.equal(vfx.activeCount, 0);
  vfx.enemyDefeated({ id: 2, tick: 12, position: positions[1], formationId: 81 });
  vfx.draw(context(), state(12), point => ({ x: point.x, y: point.z }), () => 0, null);
  assert.equal(vfx.activeCount, 0);
  vfx.enemyDefeated({ id: 3, tick: 16, position: positions[2], formationId: 81 });
  const projected = [];
  vfx.draw(context(), state(16), point => {
    projected.push({ ...point });
    return { x: point.x, y: point.z };
  }, () => 0, null);
  assert.equal(vfx.activeCount, 1);
  for (const position of positions) assert.ok(projected.some(point => JSON.stringify(point) === JSON.stringify(position)));

  const expired = new SortieVfx(TICKS_PER_SECOND);
  expired.enemyDefeated({ id: 4, tick: 20, position: positions[0], formationId: 82 });
  expired.draw(context(), state(27), point => ({ x: point.x, y: point.z }), () => 0, null);
  assert.equal(expired.activeCount, 1);
});

test('observed spread and ground-fire FX never synthesize hit effects', () => {
  const vfx = new SortieVfx(TICKS_PER_SECOND), observed = state(12), position = { x: 8, z: 9, alt: 10 };
  observed.weaponFx = [
    { kind: 'flare-spread', from: position, radius: 6, until: 36 },
    { kind: 'ground-fire', from: position, radius: 6, until: 36 },
  ];
  vfx.observeState(observed);
  assert.equal(vfx.activeCount, 0);
  vfx.hit('phoenix', { tick: 12, position });
  assert.equal(vfx.activeCount, 1);
});

test('ion, drone, pod-shield and phoenix-burn Ace damage retains its weapon route', () => {
  const makeAce = () => {
    const world = new World(), ground = (x, z) => world.height(x, z);
    const simulation = createStage(parseStageOptions('?mode=survivors&t=0&fixture=ace&seed=19'), ground);
    assert.ok(simulation.boss && simulation.run);
    delete simulation.boss.entry;
    delete simulation.boss.roll;
    const vfx = new SortieVfx(TICKS_PER_SECOND), weapons = [];
    observeDamage(simulation, (id, _damage, _critical, target, weapon) => {
      weapons.push(weapon);
      if (weapon) vfx.hit(weapon, { tick: simulation.tick, position: target, eventId: id });
    });
    return { simulation, ground, vfx, weapons };
  };

  const ion = makeAce();
  ion.simulation.run.weaponLevels.ion = 1;
  ion.simulation.ionWake = [
    { x: ion.simulation.boss.x - 2, z: ion.simulation.boss.z, alt: ion.simulation.boss.alt, until: ion.simulation.tick + 20 },
    { x: ion.simulation.boss.x + 2, z: ion.simulation.boss.z, alt: ion.simulation.boss.alt, until: ion.simulation.tick + 20 },
  ];
  advanceSupportWeapons(ion.simulation, ion.ground);
  assert.deepEqual(ion.weapons, ['ion']);
  assert.equal(ion.vfx.activeCount, 1);

  const drones = makeAce();
  drones.simulation.run.weaponLevels.drones = 1;
  const player = drones.simulation.player, tuning = WEAPONS.drones.tuning;
  const orbit = 2 * Math.PI * drones.simulation.tick / tuning.periodTicks;
  const yaw = orbit + player.yaw, radius = tuning.radius[0];
  drones.simulation.boss.x = player.x + Math.sin(yaw) * radius;
  drones.simulation.boss.z = player.z + Math.cos(yaw) * radius;
  drones.simulation.boss.alt = player.altitude + Math.sin(orbit) * tuning.tilt;
  advanceSupportWeapons(drones.simulation, drones.ground);
  assert.deepEqual(drones.weapons, ['drones']);
  assert.equal(drones.vfx.activeCount, 1);

  const pods = makeAce();
  pods.simulation.run.evolutions.pods = true;
  pods.simulation.boss.x = pods.simulation.player.x + CLOSE_EVOLUTIONS.aegis.radius;
  pods.simulation.boss.z = pods.simulation.player.z;
  pods.simulation.boss.alt = pods.simulation.player.altitude;
  advanceSupportWeapons(pods.simulation, pods.ground);
  assert.deepEqual(pods.weapons, ['pods']);
  assert.equal(pods.vfx.activeCount, 1);

  const phoenix = makeAce();
  phoenix.simulation.boss.burnNextAt = phoenix.simulation.tick;
  phoenix.simulation.boss.burnUntil = phoenix.simulation.tick + 20;
  phoenix.simulation.boss.burnDamage = 1;
  advanceFlares(phoenix.simulation, phoenix.ground);
  assert.deepEqual(phoenix.weapons, ['phoenix']);
  assert.equal(phoenix.vfx.activeCount, 1);
});

test('fire accents anchor to live shot positions and leave no invented missile paths or bodies', () => {
  const vfx = new SortieVfx(TICKS_PER_SECOND), live = state(10);
  live.shots = [{ kind: 'seeker', x: 8, z: 9, alt: 3, vx: 0.3, vz: -0.2, vy: 0, born: 10 }];
  const rendered = context(), project = point => ({ x: point.x * 10, y: point.z * 10 });
  vfx.draw(rendered, live, project, () => 0, null);
  assert.ok(rendered.arcs.some(([x, y]) => x === 80 && y === 90));
  assert.equal(rendered.fillRects.length, 0);
  const liveTrail = rendered.operations.filter(operation => operation.type === 'stroke'
    && operation.composite === 'source-over'
    && operation.path.some(command => command[0] === 'moveTo' && operation.path.some(end => end[0] === 'lineTo')));
  assert.equal(liveTrail.length, 1);
  for (const command of liveTrail[0].path) if (command[0] === 'moveTo' || command[0] === 'lineTo') {
    assert.ok(Math.hypot(command[1] - 10, command[2] - 20) > 20);
  }

  live.shots = [];
  const dead = context();
  vfx.draw(dead, state(11), project, () => 0, null);
  assert.equal(dead.operations.filter(operation => operation.type === 'stroke' && operation.composite === 'source-over'
    && operation.path.some(command => command[0] === 'lineTo')).length, 0);
});

test('drone fire accent originates at the actual drone bolt, not the player', () => {
  const vfx = new SortieVfx(TICKS_PER_SECOND), observed = state(4);
  observed.shots = [{ kind: 'drone-bolt', x: 12, z: 13, alt: 4, vx: 0.1, vz: 0.1, born: 4 }];
  const rendered = context();
  vfx.draw(rendered, observed, point => ({ x: point.x * 10, y: point.z * 10 }), () => 0, null);
  assert.ok(rendered.arcs.some(([x, y]) => x === 120 && y === 130));
  assert.ok(!rendered.arcs.some(([x, y]) => x === 10 && y === 20));
});

test('reduced motion suppresses optional projectile, wake, orbit and flare movement', () => {
  const observed = state(8);
  observed.shots = [{ kind: 'twin', x: 8, z: 9, alt: 3, vx: 0.3, vz: 0.2, born: 8 }];
  observed.ionWake = [
    { x: 2, z: 3, alt: 4, until: 40 }, { x: 3, z: 4, alt: 5, until: 40 },
  ];
  observed.orbitDrones = [{ x: 5, z: 6, alt: 7, yaw: 0 }];
  observed.flares = [{ x: 6, z: 7, alt: 8, vx: 0.2, vz: 0.1, vy: 0.3, born: 8 }];
  observed.rearBombs = [{ x: 7, z: 8, alt: 9, born: 8 }];
  const project = point => ({ x: point.x * 10, y: point.z * 10 });
  const reduced = context();
  new SortieVfx(TICKS_PER_SECOND).draw(reduced, observed, project, () => 0, null, true);
  const movingStrokes = reduced.operations.filter(operation => operation.type === 'stroke'
    && operation.composite === 'source-over'
    && operation.path.some(command => command[0] === 'moveTo' && operation.path.some(end => end[0] === 'lineTo')));
  assert.equal(movingStrokes.length, 0);
  assert.ok(!reduced.arcs.some(([x, y]) => x === 10 && y === 20));

  const normal = context();
  new SortieVfx(TICKS_PER_SECOND).draw(normal, observed, project, () => 0, null);
  assert.ok(normal.operations.some(operation => operation.type === 'stroke'
    && operation.composite === 'source-over'
    && operation.path.some(command => command[0] === 'moveTo' && operation.path.some(end => end[0] === 'lineTo'))));
  assert.ok(normal.arcs.some(([x, y]) => x === 10 && y === 20));
});

test('ion wake strokes never bridge interleaved lanes', () => {
  const observed = state(8);
  observed.ionWake = [
    { x: 1, z: 11, alt: 2, until: 40, lane: 0 },
    { x: 2, z: 12, alt: 2, until: 40, lane: 1 },
    { x: 3, z: 13, alt: 2, until: 40, lane: 0 },
    { x: 4, z: 14, alt: 2, until: 40, lane: 0 },
    { x: 5, z: 15, alt: 2, until: 40, lane: 1 },
    { x: 6, z: 16, alt: 2, until: 40, lane: 1 },
  ];
  const rendered = context();
  new SortieVfx(TICKS_PER_SECOND).draw(rendered, observed,
    point => ({ x: point.x * 10, y: point.z * 10 }), () => 0, null);
  const wakeStrokes = rendered.operations.filter(operation => operation.type === 'stroke'
    && operation.path.some(command => command[0] === 'lineTo'));
  assert.deepEqual(wakeStrokes.map(operation => operation.path), [
    [['moveTo', 30, 130], ['lineTo', 40, 140]],
    [['moveTo', 50, 150], ['lineTo', 60, 160]],
  ]);
});

test('optional VFX are masked after drawing around hostile bullets, dive corridors and boss silhouette', () => {
  const vfx = new SortieVfx(TICKS_PER_SECOND), observed = state(1);
  observed.shots = [
    { kind: 'hostile', x: 9.94, z: 0, alt: 0, vx: 0, vz: 0 },
    { kind: 'twin', x: 10, z: 0, alt: 0, vx: 1, vz: 0, born: 1 },
  ];
  observed.enemies = [{ x: 8, z: 0, alt: 0, maneuver: { phase: 'warning', band: 0, diveAt: 10 } }];
  const rendered = context();
  vfx.draw(rendered, observed, point => ({ x: point.x * 10, y: point.z * 10 + point.alt }), () => 0,
    { x: 50, y: 50, radius: 16 });
  const masks = rendered.operations.filter(operation => operation.type === 'fill' && operation.composite === 'destination-out');
  assert.ok(masks.some(operation => operation.path.some(command => command[0] === 'arc'
    && Math.abs(command[1] - 99.4) < 0.01 && command[2] === 0)));
  assert.ok(masks.some(operation => operation.path.some(command => command[0] === 'moveTo')
    && operation.path.some(command => command[0] === 'lineTo')));
  assert.ok(masks.some(operation => operation.path.some(command => command[0] === 'arc'
    && command[1] === 50 && command[2] === 50 && command[3] > 28)));
  const maskStart = rendered.operations.findIndex(operation => operation.type === 'fill' && operation.composite === 'destination-out');
  const trailDrawn = rendered.operations.findIndex(operation => operation.type === 'stroke' && operation.composite === 'source-over'
    && operation.path.some(command => command[0] === 'moveTo' && operation.path.some(end => end[0] === 'lineTo')));
  assert.ok(trailDrawn >= 0 && maskStart > trailDrawn);
  assert.equal(rendered.globalCompositeOperation, 'source-over');
});

test('dive-warning mask follows its target altitude without requiring player projection', () => {
  const observed = state(1);
  observed.player = { x: 50, z: 60, altitude: 70 };
  observed.enemies = [{ x: 8, z: 9, alt: 20, maneuver: { phase: 'warning', band: 1, diveAt: 10 } }];
  const project = point => {
    if (point.x === observed.player.x && point.z === observed.player.z && point.alt === observed.player.altitude) return null;
    return { x: point.x * 10, y: point.alt * 2 + point.z };
  };
  const rendered = context();
  new SortieVfx(TICKS_PER_SECOND).draw(rendered, observed, project, () => 0, null);
  const targetY = BANDS[1] * 2 + observed.enemies[0].z;
  assert.ok(rendered.operations.some(operation => operation.type === 'fill'
    && operation.composite === 'destination-out'
    && operation.path.some(command => command[0] === 'arc' && command[1] === 80 && command[2] === targetY)));
});

test('actual Ace defeat VFX continues on render time after the simulation clock freezes', () => {
  const vfx = new SortieVfx(TICKS_PER_SECOND), position = { x: 3, z: 4, alt: 5 };
  vfx.bossDefeated({ id: 9, tick: 10, position });
  vfx.fire('twin', { tick: 10, position });
  const final = state(10);
  final.phase = 'clear';
  final.boss = { defeatedAt: 10, hp: 0 };
  const project = point => ({ x: point.x, y: point.z });
  vfx.draw(context(), final, project, () => 0, null, false, 'defeat', 1000);
  assert.equal(vfx.activeCount, 1);
  vfx.draw(context(), final, project, () => 0, null, false, 'defeat', 2000);
  assert.equal(vfx.activeCount, 1);
  vfx.draw(context(), final, project, () => 0, null, false, 'defeat', 2800);
  assert.equal(vfx.activeCount, 0);

  const noDefeat = new SortieVfx(TICKS_PER_SECOND);
  noDefeat.fire('twin', { tick: 10, position });
  noDefeat.draw(context(), state(10), project, () => 0, null, false, 'defeat', 1000);
  assert.equal(noDefeat.activeCount, 0);
});

test('VFX lifecycle hides menus and guide while allowing only an actual terminal boss defeat', () => {
  const playing = state(1), final = state(1);
  assert.equal(sortieVfxMode(playing), 'flight');
  assert.equal(sortieVfxMode(playing, true), null);
  assert.equal(sortieVfxMode({ ...playing, paused: true }), null);
  assert.equal(sortieVfxMode({ ...playing, phase: 'title' }), null);
  final.phase = 'clear';
  final.boss = { defeatedAt: 1, hp: 0 };
  assert.equal(sortieVfxMode(final), 'defeat');
  assert.equal(sortieVfxMode({ ...final, phase: 'timeout' }), 'defeat');
  assert.equal(sortieVfxMode({ ...final, phase: 'title' }), null);
  assert.equal(sortieVfxMode({ ...final, boss: { defeatedAt: null, hp: 10 } }), null);
});

test('boss defeat, deduplication, cleanup and expiry stay bounded', () => {
  const vfx = new SortieVfx(TICKS_PER_SECOND), position = { x: 3, z: 4, alt: 5 };
  vfx.bossDefeated({ id: 9, tick: 10, position });
  vfx.bossDefeated({ id: 9, tick: 10, position });
  const rendered = context();
  vfx.draw(rendered, state(10), point => ({ x: point.x, y: point.z }), () => 0, null);
  assert.ok(rendered.drawCount() > 0);
  vfx.hit('twin', { tick: 10, position, eventId: 'hit-1' });
  vfx.hit('twin', { tick: 10, position, eventId: 'hit-1' });
  assert.equal(vfx.activeCount, 2);
  for (let i = 0; i < 120; i++) vfx.fire('arc', { tick: 10, position, eventId: 'fire-' + i });
  assert.equal(vfx.activeCount, 80);
  assert.ok(vfx.droppedCount > 0);
  vfx.clear();
  assert.equal(vfx.activeCount, 0);
  assert.equal(vfx.droppedCount, 0);
  vfx.hit('twin', { tick: 0, position });
  vfx.draw(context(), state(TICKS_PER_SECOND * 3), () => ({ x: 0, y: 0 }), () => 0, null);
  assert.equal(vfx.activeCount, 0);
});

test('Ace D04 observer fires once after the actual defeat verdict', () => {
  const world = new World(), ground = (x, z) => world.height(x, z);
  const stateAfterHit = createStage(parseStageOptions('?mode=survivors&t=0&fixture=ace&seed=19'), ground);
  assert.ok(stateAfterHit.boss);
  stateAfterHit.boss.hp = 0;
  const observed = [], events = { aceDefeated: event => observed.push(event) };
  stepStage(stateAfterHit, {}, ground, undefined, events);
  assert.deepEqual(observed, [{ id: stateAfterHit.boss.id,
    position: { x: stateAfterHit.boss.x, z: stateAfterHit.boss.z, alt: stateAfterHit.boss.alt },
    tick: stateAfterHit.tick, outcome: 'defeated' }]);
  stepStage(stateAfterHit, {}, ground, undefined, events);
  assert.equal(observed.length, 1);

  const lost = createStage(parseStageOptions('?mode=survivors&t=0&fixture=ace&seed=20'), ground);
  lost.boss.hp = 0;
  lost.hull = 0;
  const notDefeated = [];
  stepStage(lost, {}, ground, undefined, { aceDefeated: event => notDefeated.push(event) });
  assert.equal(notDefeated.length, 0);
});

test('dense effects and pickup activity reduce optional XP trail capacity', () => {
  const position = { x: 1, z: 2, alt: 3 }, normal = new SortieVfx(TICKS_PER_SECOND);
  normal.observeState(state(1));
  assert.equal(normal.pickupTrailCapacity(1), undefined);
  const busy = new SortieVfx(TICKS_PER_SECOND);
  for (let i = 0; i < 24; i++) busy.fire('twin', { tick: 1, position, eventId: 'burst-' + i });
  busy.observeState(state(1));
  assert.equal(busy.pickupTrailCapacity(1), 0);
  const recentPickup = new SortieVfx(TICKS_PER_SECOND);
  recentPickup.pickupEvent({ type: 'pickupCollected', pickupId: 7, kind: 'salvage', position, tick: 1,
    xp: 2, credits: 1, playerPosition: position, sourceEventId: 55 });
  recentPickup.observeState(state(1));
  assert.equal(recentPickup.pickupTrailCapacity(1), 12);
});

test('large optional rings contract near the boss silhouette', () => {
  const vfx = new SortieVfx(TICKS_PER_SECOND), rendered = context();
  vfx.hit('bomb-bay', { tick: 0, position: { x: 0, z: 0, alt: 0 } });
  vfx.draw(rendered, state(30), point => ({ x: point.x, y: point.z }), () => 0,
    { x: 0, y: 0, radius: 10 });
  assert.ok(Math.max(...rendered.ellipses.flat()) <= (12 / 54) * (6 + 48 * 0.5) * 1.15 + 0.01);
});

test('drop, contact and collection observations are distinct one-time pickup events', () => {
  const vfx = new SortieVfx(TICKS_PER_SECOND), position = { x: 4, z: 5, alt: 6 };
  vfx.pickupEvent({ type: 'pickupDropped', pickupId: 7, kind: 'salvage', position, tick: 1, sourceEventId: 55 });
  vfx.pickupEvent({ type: 'pickupDropped', pickupId: 7, kind: 'salvage', position, tick: 10, sourceEventId: 55 });
  vfx.observeState(state(100));
  assert.equal(vfx.pickupTrailCapacity(100), undefined);

  vfx.pickupEvent({ type: 'pickupContacted', pickupId: 7, kind: 'salvage', position, tick: 100, sourceEventId: 55 });
  vfx.observeState(state(100));
  assert.equal(vfx.pickupTrailCapacity(100), 12);
  vfx.clear();
  vfx.pickupEvent({ type: 'pickupCollected', pickupId: 7, kind: 'magnet', position, tick: 100, xp: 0, credits: 0,
    playerPosition: { x: 8, z: 9, alt: 10 }, sourceEventId: 55 });
  vfx.observeState(state(100));
  assert.equal(vfx.pickupTrailCapacity(100), 12);
});

test('render observers and VFX state leave seeded simulation replay byte-identical', () => {
  const world = new World(), ground = (x, z) => world.height(x, z);
  const options = parseStageOptions('?mode=survivors&t=0&seed=42');
  const plain = createStage(options, ground), rendered = createStage(options, ground);
  const vfx = new SortieVfx(TICKS_PER_SECOND);
  observeDamage(rendered, (id, damage, critical, target, weapon) => {
    if (weapon) vfx.hit(weapon, { tick: rendered.tick, position: target });
  });
  const events = {
    destroyed(kind, elite, id, position, tick, formationId, armored) {
      if (id !== undefined && position && tick !== undefined) vfx.enemyDefeated({ id, position, tick, formationId, armored });
    },
    pickupDropped(event) { vfx.pickupEvent({ ...event, type: 'pickupDropped' }); },
    pickupContacted(event) { vfx.pickupEvent({ ...event, type: 'pickupContacted' }); },
    pickupCollected(event) { vfx.pickupEvent({ ...event, type: 'pickupCollected' }); },
    aceDefeated(event) { vfx.bossDefeated(event); },
  };
  for (let i = 0; i < TICKS_PER_SECOND * 20; i++) {
    const input = autopilotInput(plain, 'full', ground);
    stepStage(plain, input, ground);
    stepStage(rendered, input, ground, undefined, events);
    vfx.observeState(rendered);
    if (i % 120 === 0) assert.equal(JSON.stringify(rendered), JSON.stringify(plain));
  }
  assert.equal(JSON.stringify(rendered), JSON.stringify(plain));
});
