import test from 'node:test';
import assert from 'node:assert/strict';
import { activeWeakPoint, createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { autopilotInput, seekStage } from '../src/autoplay.ts';
import { relativeMark } from '../src/instruments.ts';
import { World } from '../src/world.ts';

const world = new World();
const ground = (x, z) => world.height(x, z);
const stage = query => createStage(parseStageOptions(query), ground);
const run = (state, ticks, input = {}) => {
  for (let i = 0; i < ticks; i++) stepStage(state, input, ground);
  return state;
};

function atPlayer(state, alt, friendly = false) {
  return {
    x: state.player.x, z: state.player.z + 0.7, alt,
    vx: 0, vz: 0, life: 1, damage: 2, kind: friendly ? 'twin' : 'hostile',
    volley: 42, nearMiss: false, lockId: null,
  };
}

test('the title launches a one-life sortie in cruise with both weapons and three bombs', () => {
  const state = stage('?seed=22');
  assert.equal(state.phase, 'title');
  run(state, 1, { start: true });
  assert.equal(state.phase, 'playing');
  assert.equal(state.view, 'overhead');
  assert.equal(state.player.altitude, 110);
  assert.equal(state.hull, 8);
  assert.equal(state.boost, 1);
  assert.equal(state.bombs, 3);
  assert.equal(state.twinRank, 1);
  assert.equal(state.podRank, 1);
});

test('the stack fixture has the same planar contact at 75, 110 and 145 m in every view', () => {
  for (const view of ['overhead', 'chase', 'cockpit']) {
    const state = stage('?fixture=stack&view=' + view);
    assert.equal(state.tick, 30 * 60);
    assert.deepEqual(state.enemies.map(e => e.alt), [75, 110, 145]);
    assert.ok(state.enemies.every(e => e.x === state.enemies[0].x && e.z === state.enemies[0].z));
    run(state, 44);
    assert.deepEqual(state.enemies.map(e => e.alt), [75, 145]);
    assert.equal(state.pickups[0].alt, 110);
  }
});

test('hit and miss feedback use the bolt launch height and emit one miss for a paired volley', () => {
  const state = stage('?fixture=stack');
  state.enemies = state.enemies.filter(enemy => enemy.alt === 145);
  run(state, 18);
  assert.equal(state.shots.filter(shot => shot.kind === 'twin').length, 0);
  assert.equal(state.altitudeHint.delta, 35);
  run(state, 1, { fire: true });
  assert.equal(state.shots.length, 0, 'legacy manual fire cannot bypass acquisition');
  state.enemies[0].alt = 110;
  run(state, 1);
  const bolts = state.shots.filter(shot => shot.kind === 'twin');
  assert.equal(bolts.length, 2);
  assert.ok(bolts.every(shot => shot.alt === 110));
  state.enemies[0].alt = 145;
  run(state, 25, { climb: 1 });
  assert.equal(state.enemies[0].hp, 2);
  assert.equal(state.effects.filter(effect => effect.kind === 'miss').length, 1);
  assert.equal(state.effects.find(effect => effect.kind === 'miss').delta, 35);
});

test('shot and body overlap only damage the player through the inclusive eight-metre window', () => {
  for (const offset of [8, 8.01, -8, -8.01]) {
    const state = stage('?fixture=stack');
    state.enemies = [];
    state.shots.push(atPlayer(state, 110 + offset));
    run(state, 1);
    assert.equal(state.hull, Math.abs(offset) <= 8 ? 6 : 8);
  }
  const state = stage('?fixture=stack');
  const enemy = state.enemies[0];
  enemy.x = state.player.x;
  enemy.z = state.player.z + 1;
  state.enemies = [enemy];
  run(state, 1);
  assert.equal(state.hull, 8);
  state.player.altitude = 75;
  run(state, 1);
  assert.equal(state.hull, 6);
});

test('salvage pulls from 22 m and collects inside 8 m, only while inside the altitude window', () => {
  const state = stage('?fixture=stack');
  state.enemies = [];
  const { x, z } = state.player;
  state.pickups = [{ id: 10, x, z: z + 21, alt: 75, xp: 2, born: state.tick }];
  run(state, 3);
  assert.equal(state.pickups[0].z, z + 21);
  state.player.altitude = 83;
  run(state, 1);
  assert.ok(state.pickups[0].z < z + 21);
  state.player.altitude = 90;
  const afterPull = state.pickups[0].z;
  run(state, 3);
  assert.equal(state.pickups[0].z, afterPull);
  state.player.altitude = 83;
  state.pickups[0].z = state.player.z + 7;
  run(state, 1);
  assert.equal(state.xp, 2);
  assert.equal(state.salvage, 2);
  assert.equal(state.pickups.length, 0);
});

test('the three draft cards pause active time, apply once and keep three legal choices on round two', () => {
  for (let pick = 0; pick < 3; pick++) {
    const state = stage('?fixture=draft');
    assert.equal(state.tick, 45 * 60);
    assert.equal(state.phase, 'draft');
    assert.deepEqual(state.draft, ['twin-2', 'pods-2', 'twin-damage']);
    const { x, z } = state.player;
    run(state, 120, { boost: true, bomb: true, toggleView: true, climb: 1 });
    assert.equal(state.tick, 45 * 60);
    assert.deepEqual([state.player.x, state.player.z, state.bombs, state.boost], [x, z, 3, 1]);
    run(state, 1, { pick: 'twin-3' });
    assert.equal(state.phase, 'draft');
    run(state, 1, { pick: state.draft[pick], boost: true, bomb: true, toggleView: true });
    assert.equal(state.phase, 'playing');
    assert.equal(state.level, 2);
    assert.equal(state.xp, 0);
    assert.equal(state.twinRank, pick === 0 ? 2 : 1);
    assert.equal(state.podRank, pick === 1 ? 2 : 1);
    assert.equal(state.twinDamage, pick === 2 ? 2 : 1);
    run(state, 18, { boost: true, bomb: true, toggleView: true });
    assert.equal(state.boost, 1);
    assert.equal(state.bombs, 3);
    assert.equal(state.view, 'overhead');
    run(state, 1, { boost: true });
    assert.equal(state.boost, 1);
    run(state, 1);
    run(state, 1, { boost: true });
    assert.ok(state.boost < 1);
    state.pickups.push({ id: 20, ...atPlayer(state, state.player.altitude), xp: 12, born: state.tick });
    run(state, 1);
    assert.equal(state.draft.length, 3);
    assert.equal(new Set(state.draft).size, 3);
    run(state, 1, { pick: state.draft[0] });
    assert.equal(state.level, 3);
    assert.equal(state.xp, 2);
    assert.equal(state.salvage, 18);
  }
});

test('the boss fixture opens on a high weak point and rejects cruise bolts', () => {
  const state = stage('?fixture=boss&view=cockpit');
  assert.equal(state.tick, 108 * 60);
  assert.equal(state.player.altitude, 110);
  const point = activeWeakPoint(state);
  assert.ok(point.exposed);
  assert.ok(point.alt >= 139);
  run(state, 32);
  assert.equal(state.boss.weakPoints[0].hits, 0);
  assert.ok(state.altitudeHint.delta > 0);

  state.player.altitude = point.alt;
  run(state, 12);
  assert.ok(state.lock.progress > 0 && state.lock.progress < 1);
  run(state, 1, { toggleView: true });
  assert.ok(state.lock.progress > 0);
  assert.equal(state.view, 'overhead');
  run(state, 65);
  assert.ok(state.boss.weakPoints[0].hits > 0);
  assert.equal(state.boss.weakPoints[1].hits, 0);
  for (let i = 0; i < 600 && state.boss.index === 0; i++) stepStage(state, autopilotInput(state), ground);
  const next = activeWeakPoint(state);
  assert.ok(next.alt < 81);
  assert.equal(next.exposed, false);
  assert.ok(state.boss.exposeTick - state.boss.changedTick >= 180);
});

test('the small boss has to be fought in different bands and its destruction ends the sortie', () => {
  const state = stage('?fixture=boss');
  for (let i = 0; i < 72 * 60 && state.phase !== 'clear'; i++) {
    stepStage(state, autopilotInput(state), ground);
  }
  assert.equal(state.phase, 'clear');
  assert.ok(state.tick < 180 * 60);
  assert.ok(state.boss.weakPoints.every(point => point.hp === 0 && point.hits > 0));
  assert.ok('SABC'.includes(state.rank));
});

test('time expiry shows a ranked timeout with a live boss and does not advance past 03:00', () => {
  const state = stage('?fixture=boss');
  state.tick = 180 * 60 - 1;
  run(state, 1);
  assert.equal(state.phase, 'timeout');
  assert.equal(state.tick, 180 * 60);
  assert.equal(state.rank, 'S');
  run(state, 60);
  assert.equal(state.tick, 180 * 60);
  run(state, 1, { start: true });
  assert.equal(state.tick, 0);
  assert.equal(state.phase, 'playing');
});

test('last-tick damage, weak-point hits and an earned draft resolve before the result', () => {
  function finalTick(hull) {
    const state = stage('?fixture=boss');
    state.tick = 180 * 60 - 1;
    state.boss.orbitStartTick = state.tick + 2;
    state.hull = hull;
    state.xp = 5;
    const point = state.boss.weakPoints[0];
    point.hp = 1;
    for (const other of state.boss.weakPoints.slice(1)) other.hp = 0;
    state.shots.push({ ...atPlayer(state, point.alt, true), x: point.x, z: point.z, lockId: point.id });
    state.shots.push(atPlayer(state, state.player.altitude));
    state.pickups.push({ id: 70, ...atPlayer(state, state.player.altitude), xp: 1, born: state.tick });
    return run(state, 1);
  }
  const alive = finalTick(8);
  assert.equal(alive.phase, 'draft');
  assert.equal(alive.hull, 6);
  assert.equal(alive.boss.weakPoints[0].hits, 1);
  run(alive, 1, { pick: alive.draft[0] });
  assert.equal(alive.phase, 'clear');
  assert.equal(alive.rank, 'A');
  const dead = finalTick(2);
  assert.equal(dead.phase, 'lost');
  assert.equal(dead.boss.weakPoints[0].hits, 1);
});

test('an explicit view sets the camera after a deterministic absolute seek', () => {
  const options = parseStageOptions('?t=47&seed=11&view=cockpit&touch=1');
  const first = seekStage(options, ground);
  const second = seekStage(options, ground);
  assert.equal(first.tick, 47 * 60);
  assert.equal(first.view, 'cockpit');
  assert.equal(options.touch, true);
  assert.deepEqual(first, second);
  assert.equal(seekStage(parseStageOptions('?fixture=stack&t=31'), ground).tick, 31 * 60);
  assert.equal(seekStage(parseStageOptions('?fixture=stack&t=10'), ground).tick, 10 * 60);
});

test('seeded waves respect phase caps and warn before interceptor altitude changes', () => {
  const state = stage('?autoplay=1&seed=11');
  let warned = 0;
  const warnings = new Map();
  for (let i = 0; i < 180 * 60 + 30 && ['playing', 'draft'].includes(state.phase); i++) {
    stepStage(state, autopilotInput(state), ground);
    assert.ok(state.enemies.length <= (state.tick < 2400 ? 8 : state.tick < 4200 ? 16 : state.tick < 6300 ? 24 : 14));
    for (const enemy of state.enemies.filter(enemy => enemy.kind === 'interceptor')) {
      if (enemy.maneuver?.phase === 'warning') {
        if (!warnings.has(enemy.id)) warnings.set(enemy.id, [state.tick, enemy.alt]);
        assert.equal(enemy.alt, warnings.get(enemy.id)[1]);
        warned++;
      } else if (enemy.maneuver?.phase === 'diving' && warnings.has(enemy.id)) {
        assert.ok(state.tick - warnings.get(enemy.id)[0] >= 75);
      } else {
        warnings.delete(enemy.id);
      }
    }
  }
  assert.ok(warned > 75);
  assert.ok(['clear', 'timeout', 'lost'].includes(state.phase));
});

test('a successful stacked volley does not also report a wrong-height miss', () => {
  const state = stage('?fixture=stack');
  state.twinDamage = 2;
  run(state, 25);
  assert.equal(state.enemies.length, 2);
  assert.equal(state.effects.filter(effect => effect.kind === 'miss').length, 0);
});

test('Wing Pods cover a side contact at launch height and upgrades improve both weapons independently', () => {
  const state = stage('?fixture=draft');
  run(state, 1, { pick: 'pods-2' });
  const target = stage('?fixture=stack').enemies[1];
  target.x = state.player.x - 38;
  target.z = state.player.z;
  target.hp = 12;
  target.shotAt = state.tick + 120;
  state.enemies = [target];
  run(state, 1);
  assert.equal(state.shots[0].kind, 'pods');
  assert.equal(state.shots[0].alt, 110);
  assert.equal(state.podsAt - state.tick, 25);
  assert.equal(state.twinRank, 1);
});

// The TOP pilot may use learned band centers, the health bar and the timing of
// the coarse radar glyph. It avoids bolts from their visible planar paths.
function radarOnlyPilot() {
  let contactId, entryDirection = 0, wantAltitude = null;
  let radar = null, dodgeUntil = 0, dodgeDirection = 0, nextDodge = 0, coreSeen = null;
  const clampStick = value => Math.max(-1, Math.min(1, value));
  const nearest = (items, p) => items.reduce((best, item) =>
    best && Math.hypot(best.x - p.x, best.z - p.z) <= Math.hypot(item.x - p.x, item.z - p.z) ? best : item, null);

  return state => {
    const pilot = autopilotInput(state, 'top');
    if (state.phase !== 'playing') return pilot;
    const p = state.player, alt = Math.round(p.altitude);
    let climb = 0;
    if (state.boss) {
      const life = state.boss.weakPoints.reduce((hp, part) => hp + part.hp, 0);
      if (life <= 8) coreSeen ??= state.tick;
      const memorizedAltitude = life > 18 ? 145 : life > 8 ? 75
        : Math.floor((state.tick - coreSeen) / 260) % 2 === 0 ? 105 : 115;
      climb = clampStick((memorizedAltitude - alt) / 4);
    } else {
      const salvage = nearest(state.pickups, p);
      const track = salvage && Math.hypot(salvage.x - p.x, salvage.z - p.z) <= 150
        ? salvage : nearest(state.enemies, p);
      if (state.tick % 3 === 0) {
        radar = track && Math.hypot(track.x - p.x, track.z - p.z) <= 160
          ? { id: track.id, mark: relativeMark(track.alt - p.altitude, true) } : null;
      }
      if (radar) {
        if (radar.id !== contactId) {
          contactId = radar.id;
          entryDirection = 0;
          wantAltitude = null;
        }
        if (radar.mark !== '■') {
          entryDirection = radar.mark === '△' ? 1 : -1;
          climb = entryDirection;
          wantAltitude = null;
        } else {
          wantAltitude ??= alt + 7.2 * entryDirection;
          climb = clampStick((wantAltitude - alt) / 4);
        }
      }
    }

    pilot.bomb = false;
    if (state.tick >= nextDodge && state.invulnerability === 0) {
      for (const shot of state.shots) {
        if (shot.kind !== 'hostile') continue;
        const x = shot.x - p.x, z = shot.z - p.z;
        if (Math.hypot(x, z) > 55) continue;
        const vx = shot.vx - Math.sin(p.yaw) * state.speed, vz = shot.vz - Math.cos(p.yaw) * state.speed;
        const time = -(x * vx + z * vz) / (vx * vx + vz * vz);
        if (time < 0.18 || time > 0.55 || Math.hypot(x + vx * time, z + vz * time) > 9) continue;
        if (state.hull <= 4 && state.bombs > 0) {
          pilot.bomb = true;
          nextDodge = state.tick + 45;
        } else {
          dodgeUntil = state.tick + Math.ceil((time + 0.06) * 60);
          nextDodge = dodgeUntil + 25;
          dodgeDirection = alt > 142 ? -1 : alt < 80 || climb >= 0 ? 1 : -1;
        }
        break;
      }
    }
    pilot.climb = state.tick < dodgeUntil ? dodgeDirection : climb;
    return pilot;
  };
}

test('the six-seed replay gate clears with all views and produces no TOP-only clears', () => {
  let clearWithAllViews = 0, topOnlyClears = 0;
  for (const seed of [1, 11, 27, 42, 128, 2026]) {
    for (const mode of ['full', 'top']) {
      const state = stage('?autoplay=1&seed=' + seed);
      const views = new Set([state.view]);
      const pilot = mode === 'full' ? state => autopilotInput(state, 'full', ground) : radarOnlyPilot();
      for (let i = 0; i < 10810 && ['playing', 'draft'].includes(state.phase); i++) {
        stepStage(state, pilot(state), ground);
        views.add(state.view);
      }
      assert.ok(['clear', 'timeout', 'lost'].includes(state.phase));
      const good = state.phase === 'clear' && state.level === 3 && state.salvageBands.filter(Boolean).length >= 2;
      if (mode === 'full' && good && views.size === 3) clearWithAllViews++;
      if (mode === 'top' && state.phase === 'clear') topOnlyClears++;
    }
  }
  assert.ok(clearWithAllViews >= 4);
  assert.equal(topOnlyClears, 0);
});

test('a late seek reaches its absolute active tick and returns a live sortie for manual controls', () => {
  const state = seekStage(parseStageOptions('?seed=1&t=179&view=chase'), ground);
  assert.equal(state.tick, 10740);
  assert.equal(state.phase, 'playing');
  assert.equal(state.view, 'chase');
  const yaw = state.player.yaw;
  run(state, 1, { turn: 1 });
  assert.notEqual(state.player.yaw, yaw);
  const end = seekStage(parseStageOptions('?fixture=boss&t=180&seed=11'), ground);
  assert.equal(end.tick, 10800);
  assert.equal(end.phase, 'timeout');
});

test('fresh boost is ignored during the draft input grace', () => {
  const state = stage('?fixture=draft');
  run(state, 1, { pick: state.draft[0] });
  run(state, 1);
  run(state, 17, { boost: true });
  assert.equal(state.tick, 2718);
  assert.equal(state.boost, 1);
  run(state, 1, { boost: true });
  assert.ok(state.boost < 1);
});

test('four damaging hits exhaust the one life and earn Rank C', () => {
  const state = stage('?fixture=boss');
  state.enemies = [];
  for (let i = 0; i < 4; i++) {
    state.invulnerability = 0;
    state.shots = [atPlayer(state, state.player.altitude)];
    run(state, 1);
  }
  assert.equal(state.phase, 'lost');
  assert.equal(state.hull, 0);
  assert.equal(state.hitsTaken, 4);
  assert.equal(state.rank, 'C');
});

test('the full pilot can pursue off-radar salvage and intercept the advance Warden signal', () => {
  const salvage = stage('?autoplay=1');
  salvage.pickups.push({ id: 91, x: -200, z: salvage.player.z, alt: 75, xp: 2, born: 0 });
  const pickup = autopilotInput(salvage, 'full', ground);
  assert.ok(pickup.turn < 0 && pickup.climb < 0);

  const beacon = stage('?autoplay=1');
  beacon.tick = 92 * 60;
  beacon.level = 3;
  Object.assign(beacon.player, { x: -350, z: -100, yaw: 1.6 });
  assert.ok(autopilotInput(beacon, 'full', ground).turn > 0);
  assert.ok(autopilotInput(beacon, 'top', ground).turn < 0);
});

test('seeded placement, hazards and combat stay identical across view choices', () => {
  const top = stage('?autoplay=1&seed=1&view=top');
  const cockpit = stage('?autoplay=1&seed=1&view=cockpit');
  const seen = new Set();
  for (let i = 0; i < 10810 && ['playing', 'draft'].includes(top.phase); i++) {
    const input = autopilotInput(top, 'full', ground);
    delete input.toggleView;
    stepStage(top, input, ground);
    stepStage(cockpit, input, ground);
    for (const enemy of top.enemies) seen.add(enemy.kind);
  }
  const simulation = ({ view, initialView, wipe, viewTag, ...state }) => state;
  assert.deepEqual(simulation(top), simulation(cockpit));
  assert.ok(['skimmer', 'spotter', 'hound', 'flanker', 'harrier', 'diver', 'bomber', 'turret'].every(kind => seen.has(kind)));
});
