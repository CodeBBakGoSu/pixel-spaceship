import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, stepGame, parseGameOptions, restartGame, nextLoop, elevationBracket, calculateRank, wardenTargets } from '../src/game.ts';

const ground = () => 30;
const idle = { moveX: 0, moveY: 0, fire: false };
function advance(state, seconds, input = idle) {
  for (let i = 0; i < Math.round(seconds * 60); i++) state = stepGame(state, input, 1 / 60, ground);
  return state;
}
const shot = (x, z, alt, friendly = true) => ({ x, y: 0, z, alt, vx: 0, vy: 0, vz: 0, friendly, life: 1 });
const shootAt = (s, target, count = 1) => {
  s.bullets = Array.from({ length: count }, () => shot(target.x, target.z, target.alt));
  return stepGame(s, idle, 1 / 60, ground);
};

test('URL hooks validate route, view, seed, touch and autoplay', () => {
  const o = parseGameOptions('?segment=atoll&view=cockpit&seed=42&autoplay=1&loop=3&t=8&touch=1');
  assert.deepEqual(o, { segment: 'atoll', view: 'cockpit', seed: 42, autoplay: true, loop: 3, time: 8, touch: true });
  const bad = parseGameOptions('?segment=no&view=no&seed=no&loop=-2&t=-1');
  assert.equal(bad.segment, null); assert.equal(bad.view, null); assert.equal(bad.seed, 1); assert.equal(bad.loop, 1); assert.equal(bad.time, 0);
  assert.equal(parseGameOptions('?segment=boss').segment, 'orbit');
});

test('manual view cycles with a wipe and altitude works in every view', () => {
  let s = createGame(parseGameOptions('?segment=reach'), ground);
  for (const mode of ['chase', 'cockpit', 'overhead']) {
    s = stepGame(s, { ...idle, toggleView: true }, 1 / 60, ground);
    assert.equal(s.camera.mode, mode); assert.ok(s.wipeT > 0);
    const alt = s.player.altitude;
    s = advance(s, 0.5, { ...idle, moveY: -1 });
    assert.ok(s.player.altitude > alt); assert.equal(s.wipeT, 0);
  }
  assert.equal(elevationBracket(117, 100), 'inline');
  assert.equal(elevationBracket(118, 100), 'above');
  assert.equal(elevationBracket(82, 100), 'below');
});

test('overhead fire respects altitude, including the boundary', () => {
  let s = createGame(parseGameOptions('?segment=reach'), ground);
  s.spawnTimer = 10;
  s.entities = [{ kind: 'drone', x: 0, z: 40, alt: s.player.altitude + 18, vx: 0, vz: 0, hp: 1, waveId: 0, bank: 0, hitFlash: 0, fireTimer: 9, valt: 0 }];
  s = shootAt(s, { x: 0, z: 40, alt: s.player.altitude });
  assert.equal(s.entities[0].hp, 1);
  s.entities[0].alt = s.player.altitude + 17;
  s = shootAt(s, { x: 0, z: 40, alt: s.player.altitude });
  assert.equal(s.entities.length, 0);
});

test('boost drains and refills, bomb clears hostile fire and starts a roll', () => {
  let s = createGame(parseGameOptions('?segment=reach'), ground);
  s = advance(s, 1, { ...idle, boost: true });
  assert.ok(s.bst > 0.48 && s.bst < 0.52);
  s = advance(s, 3, { ...idle, boost: true });
  assert.equal(s.bst, 0); assert.equal(s.boosting, false);
  s = advance(s, 1);
  assert.ok(s.bst > 0.34 && s.bst < 0.36);
  s.bullets = [shot(80, s.player.z + 40, s.player.altitude, false), shot(0, s.player.z + 40, s.player.altitude)];
  const stock = s.bombs;
  s = stepGame(s, { ...idle, bomb: true }, 1 / 60, ground);
  assert.equal(s.bombs, stock - 1); assert.equal(s.bullets.filter(b => !b.friendly).length, 0); assert.ok(s.roll > 0);
});

test('power capsules raise weapon level to three and damage lowers it', () => {
  let s = createGame(parseGameOptions('?segment=reach'), ground);
  for (let i = 0; i < 3; i++) {
    s.entities.push({ kind: 'capsule', x: s.player.x, z: s.player.z + 1, alt: s.player.altitude, vx: 0, vz: 0, hp: 1, waveId: 0, bank: 0, hitFlash: 0, fireTimer: 9, valt: 0 });
    s = stepGame(s, idle, 1 / 60, ground);
  }
  assert.equal(s.weaponLv, 3);
  s.bullets = [shot(s.player.x, s.player.z, s.player.altitude, false)];
  s = stepGame(s, idle, 1 / 60, ground);
  assert.equal(s.weaponLv, 2); assert.equal(s.hull, 6);
});

test('pylons open an exit and both blast doors need their locks destroyed', () => {
  let s = createGame(parseGameOptions('?segment=atoll'), ground);
  assert.equal(s.entities.filter(e => e.kind === 'pylon').length, 4);
  for (const p of [...s.entities].filter(e => e.kind === 'pylon')) s = shootAt(s, p, 12);
  assert.equal(s.pylonsDown, 4); assert.ok(s.entities.some(e => e.kind === 'exit'));
  const exit = s.entities.find(e => e.kind === 'exit');
  exit.x = s.player.x; exit.alt = s.player.altitude; exit.z = s.player.z + 0.1;
  s = stepGame(s, idle, 1 / 60, ground); assert.equal(s.phase, 'transition');
  s = advance(s, 1.6); assert.equal(s.segment, 'canyon');
  for (let door = 0; door < 2; door++) {
    let locks = s.entities.filter(e => e.kind === 'lock'); assert.equal(locks.length, 2);
    s = shootAt(s, locks[0], 8); assert.equal(s.doorOpen, false);
    locks = s.entities.filter(e => e.kind === 'lock'); s = shootAt(s, locks[0], 8);
    assert.equal(s.doorOpen, true);
    s = advance(s, 1.1);
  }
  assert.equal(s.phase, 'transition'); s = advance(s, 1.6); assert.equal(s.segment, 'orbit');
});

test('Warden core is protected until all four pods are destroyed', () => {
  let s = createGame(parseGameOptions('?segment=orbit'), ground);
  const core = { x: s.boss.x, z: s.boss.z, alt: s.boss.alt };
  s = shootAt(s, core, 5); assert.equal(s.boss.coreHp, s.boss.maxCoreHp);
  for (let i = 0; i < 4; i++) {
    const pod = wardenTargets(s).find(t => t.kind === 'pod'); assert.ok(pod);
    s = shootAt(s, pod, 16);
  }
  assert.deepEqual(s.boss.pods, [0, 0, 0, 0]); assert.equal(s.phase, 'playing');
  s = shootAt(s, wardenTargets(s)[0], s.boss.maxCoreHp);
  assert.equal(s.phase, 'win'); assert.ok(s.rank); assert.ok(s.score > 0);
});

test('rank, lives, restart and faster next loop', () => {
  assert.deepEqual([0, 1, 2, 3, 5, 6].map(calculateRank), ['S', 'A', 'A', 'B', 'B', 'C']);
  let s = createGame(parseGameOptions('?segment=reach'), ground);
  for (let i = 0; i < 12; i++) {
    s.invulnTimer = 0; s.bullets = [shot(s.player.x, s.player.z, s.player.altitude, false)];
    s = stepGame(s, idle, 1 / 60, ground);
  }
  assert.equal(s.phase, 'game_over'); assert.equal(s.lives, 0);
  s = restartGame(s, ground); assert.equal(s.segment, 'reach'); assert.equal(s.lives, 3);
  s.phase = 'win'; s.score = 1234; s = nextLoop(s, ground);
  assert.equal(s.loop, 2); assert.equal(s.score, 1234); assert.equal(s.loopSpeed, 1.2);
});

test('seeded autoplay completes the route deterministically without mutating input', () => {
  const options = parseGameOptions('?segment=reach&seed=1&autoplay=1');
  const first = createGame(options, ground), snapshot = structuredClone(first);
  stepGame(first, idle, 1 / 60, ground); assert.deepEqual(first, snapshot);
  const run = () => {
    let s = createGame(options, ground); const seen = new Set();
    for (let i = 0; i < 180 * 60 && s.phase !== 'win' && s.phase !== 'game_over'; i++) { seen.add(s.segment); s = stepGame(s, idle, 1 / 60, ground); }
    return { s, seen: [...seen] };
  };
  const a = run(), b = run();
  assert.equal(a.s.phase, 'win'); assert.deepEqual(a.seen, ['reach', 'atoll', 'canyon', 'orbit']); assert.deepEqual(a, b);
});

test('pause freezes simulation until toggled again', () => {
  let s = createGame(parseGameOptions('?segment=atoll'), ground);
  s = stepGame(s, { ...idle, pause: true }, 1 / 60, ground);
  const time = s.phaseTime, z = s.player.z;
  s = advance(s, 2); assert.equal(s.phaseTime, time); assert.equal(s.player.z, z);
  s = stepGame(s, { ...idle, pause: true }, 1 / 60, ground); assert.equal(s.paused, false); assert.ok(s.player.z > z);
});


test('autoplay can complete objective gates when starting in each view', () => {
  for (const segment of ['atoll', 'canyon']) for (const view of ['overhead', 'chase', 'cockpit']) {
    let s = createGame(parseGameOptions(`?segment=${segment}&view=${view}&autoplay=1&seed=1`), ground);
    for (let i=0; i<80*60 && s.segment===segment && s.phase!=='game_over'; i++) s=stepGame(s,idle,1/60,ground);
    assert.notEqual(s.segment, segment, `${segment} in ${view}`);
  }
});

test('a destroyed supply drone drops a collectible power capsule', () => {
  let s = createGame(parseGameOptions('?segment=reach'), ground);
  s.spawnTimer = 20;
  s.entities = [{ kind: 'supply', x: 0, z: 40, alt: s.player.altitude, vx: 0, vz: 0, hp: 1, waveId: 0, bank: 0, hitFlash: 0, fireTimer: 9, valt: 0 }];
  s = shootAt(s, s.entities[0]);
  assert.ok(s.entities.some(e => e.kind === 'capsule'));
  s = advance(s, 1);
  assert.equal(s.weaponLv, 2);
});

test('view query is retained when starting from the title', () => {
  let s = createGame(parseGameOptions('?view=chase'), ground);
  assert.equal(s.phase, 'title');
  s = stepGame(s, { ...idle, start: true }, 1 / 60, ground);
  assert.equal(s.camera.mode, 'chase');
});

test('portrait aspect keeps all cockpit objectives reachable', () => {
  for (const segment of ['atoll', 'canyon', 'orbit']) {
    let s = createGame(parseGameOptions(`?segment=${segment}&view=cockpit&autoplay=1&seed=1`), ground);
    for (let i=0; i<110*60 && s.phase!=='win' && s.phase!=='game_over'; i++) s=stepGame(s,{ ...idle, aspect: 390/844 },1/60,ground);
    assert.equal(s.phase, 'win', segment);
  }
});

test('bomb removes an overlapping Warden orb before it can damage the player', () => {
  let s = createGame(parseGameOptions('?segment=orbit'), ground);
  s.entities = [{ kind: 'boss_orb', x: s.player.x, z: s.player.z, alt: s.player.altitude, vx: 0, vz: 0, hp: 1, waveId: 0, bank: 0, hitFlash: 0, fireTimer: 9, valt: 0 }];
  s = stepGame(s, { ...idle, bomb: true }, 1/60, ground);
  assert.equal(s.hull, 8); assert.equal(s.entities.filter(e => e.kind === 'boss_orb').length, 0);
});

test('a simultaneous fatal hit and Warden defeat ends in game over', () => {
  let s = createGame(parseGameOptions('?segment=orbit'), ground);
  s.lives = 1; s.hull = 2; s.boss.pods = [0,0,0,0]; s.boss.coreHp = 1;
  s.bullets = [shot(s.player.x,s.player.z,s.player.altitude,false), shot(s.boss.x,s.boss.z,s.boss.alt)];
  s = stepGame(s, idle, 1/60, ground);
  assert.equal(s.phase, 'game_over'); assert.equal(s.lives, 0);
});

test('each segment spawns a supply drone for power capsules', () => {
  for (const segment of ['reach', 'atoll', 'canyon', 'orbit']) {
    const s = advance(createGame(parseGameOptions(`?segment=${segment}`), ground), 2);
    assert.ok(s.entities.some(e => e.kind === 'supply'), segment);
  }
});

test('overhead capsules drift toward the player and 3D pickup tolerates altitude', () => {
  let s = createGame(parseGameOptions('?segment=reach'), ground);
  s.spawnTimer = 99;
  s.entities = [{ kind: 'capsule', x: s.player.x + 65, z: s.player.z + 50, alt: s.player.altitude, vx: 0, vz: 0, hp: 1, waveId: 0, bank: 0, hitFlash: 0, fireTimer: 9, valt: 0 }];
  const oldX = s.entities[0].x;
  s = advance(s, 0.5); assert.ok(s.entities[0].x < oldX - 5);
  s = createGame(parseGameOptions('?segment=atoll&view=chase'), ground);
  s.entities = [{ kind: 'capsule', x: s.player.x + 15, z: s.player.z + 10, alt: s.player.altitude + 40, vx: 0, vz: 0, hp: 1, waveId: 0, bank: 0, hitFlash: 0, fireTimer: 9, valt: 0 }];
  s = stepGame(s, idle, 1 / 60, ground); assert.equal(s.weaponLv, 2);
});

test('a full seeded autoplay run acquires weapon level three', () => {
  let s = createGame(parseGameOptions('?segment=reach&seed=1&autoplay=1'), ground), peak = 1;
  for (let i=0; i<300*60 && s.phase!=='win' && s.phase!=='game_over'; i++) { s=stepGame(s,idle,1/60,ground); peak=Math.max(peak,s.weaponLv); }
  assert.equal(s.phase, 'win'); assert.equal(peak, 3);
});
