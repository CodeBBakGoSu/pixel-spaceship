import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Object3D, PerspectiveCamera, Vector3 } from 'three';
import { autopilotInput } from '../src/autoplay.ts';
import { CLOUDS, FLIGHT_SURFACE, WING_TRAIL } from '../src/data/flight-world.ts';
import { BOOST_SPEED, CRUISE_SPEED } from '../src/flight.ts';
import { FlightAtmosphere, cloudFixturePoint } from '../src/flight-atmosphere.ts';
import { FlightMotion } from '../src/flight-feel.ts';
import { FlightSurface, WingtipRing } from '../src/flight-surface.ts';
import { rollAttitude } from '../src/roll.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';
import { World } from '../src/world.ts';

test('the wing ring overwrites its oldest points and retains both wing coordinates', () => {
  const ring = new WingtipRing(), left = new Vector3(-8, 1, 2), right = new Vector3(8, 4, 7);
  for (let tick = 0; tick <= WING_TRAIL.capacity; tick++) {
    left.y = tick;
    ring.push(tick, left, right, 0.5);
  }
  assert.equal(ring.count, WING_TRAIL.capacity);
  const latest = ring.offset(0), oldest = ring.offset(ring.count - 1);
  assert.deepEqual(Array.from(ring.points.subarray(latest, latest + 8)),
    [-8, WING_TRAIL.capacity, 2, 8, 4, 7, 0.5, WING_TRAIL.capacity]);
  assert.equal(ring.points[oldest + 7], 1);
  ring.clear();
  assert.equal(ring.count, 0);
  ring.push(50, left, right, 0.5);
  assert.equal(ring.points[ring.offset(0) + 7], 50);
});

test('surface cues sample both wing tips above cruise, emit low wake, and expire without new motion', () => {
  for (const phone of [false, true]) {
    const ground = () => 35, altitude = 75;
    const surface = new FlightSurface(ground);
    const stage = createStage(parseStageOptions('?t=0'), ground);
    const ship = new Object3D(), camera = new PerspectiveCamera();
    stage.player.altitude = altitude;
    const frame = (tick, speed, altitude) => {
      stage.tick = tick;
      stage.speed = speed;
      stage.player.z = tick * speed / 60;
      stage.player.altitude = altitude;
      ship.position.set(stage.player.x, altitude, -stage.player.z);
      camera.position.copy(ship.position).add(new Vector3(0, 10, 40));
      surface.update(stage, ship, camera, undefined, 3, speed > CRUISE_SPEED ? 1 : 0, phone);
    };
    frame(0, CRUISE_SPEED, altitude);
    frame(6, CRUISE_SPEED, altitude);
    assert.equal(surface.clearance, 40);
    assert.equal(surface.trailSegments, 0);
    assert.ok(surface.wakeMarks >= 4);
    frame(9, BOOST_SPEED, altitude);
    frame(12, BOOST_SPEED, altitude);
    assert.equal(surface.trailSegments, 2);
    frame(12 + WING_TRAIL.lifeTicks + 1, CRUISE_SPEED, 35 + FLIGHT_SURFACE.clearance);
    assert.equal(surface.trailSegments, 0);
    assert.equal(surface.wakeMarks, 0);
    assert.equal(surface.clearance, FLIGHT_SURFACE.clearance);
  }
});

test('cloud flash and whoosh tokens track entry and re-entry at a flight band', () => {
  const stage = createStage(parseStageOptions('?t=0'), () => 35);
  const atmosphere = new FlightAtmosphere(stage.arena);
  const cloud = cloudFixturePoint(stage.arena);
  Object.assign(stage.player, { x: cloud.x, z: cloud.z, altitude: cloud.altitude });
  const frame = (tick, altitude, reduced = false) => {
    stage.tick = tick;
    stage.player.altitude = altitude;
    atmosphere.update(null, stage, 1, reduced, 0, false);
  };
  frame(0, cloud.altitude + 10);
  assert.equal(atmosphere.cloudPass, 0);
  frame(1, cloud.altitude);
  assert.equal(atmosphere.cloudPass, 1);
  assert.equal(atmosphere.cloudFlash, 1);
  frame(1 + CLOUDS.flashTicks, cloud.altitude);
  assert.equal(atmosphere.cloudFlash, 0);
  assert.equal(atmosphere.cloudPass, 1);
  frame(CLOUDS.flashTicks + 2, cloud.altitude + 10);
  frame(CLOUDS.flashTicks + 3, cloud.altitude);
  assert.equal(atmosphere.cloudPass, 1);
  frame(CLOUDS.reentryTicks + 1, cloud.altitude + 10);
  frame(CLOUDS.reentryTicks + 2, cloud.altitude, true);
  assert.equal(atmosphere.cloudPass, 2);
  assert.ok(atmosphere.cloudFlash > 0 && atmosphere.cloudFlash < 0.5);
});

test('the same replay has equal terminal hashes with flight effects on and off', () => {
  const world = new World(), ground = (x, z) => world.height(x, z);
  const options = parseStageOptions('?autoplay=1&t=0&mode=legacy&seed=11');
  function replay(enabled) {
    const state = createStage(options, ground);
    const atmosphere = enabled ? new FlightAtmosphere(state.arena) : null;
    const surface = enabled ? new FlightSurface(ground, world.texture) : null;
    const motion = enabled ? new FlightMotion() : null;
    const camera = new PerspectiveCamera(60, 1.6, 0.8, 1060), ship = new Object3D();
    const events = motion ? {
      hit: () => motion.shock('hit', state.tick),
      parry: () => motion.shock('parry', state.tick),
    } : undefined;
    let rendered = 0, wingSegments = 0, windInstances = 0;
    for (let frame = 0; frame < 11_000 && ['playing', 'draft'].includes(state.phase); frame++) {
      const input = autopilotInput(state, 'full', ground);
      if (state.tick % 420 === 120) {
        input.roll = true;
        input.rollTurn = 1;
      }
      stepStage(state, input, ground, undefined, events);
      if (!surface || !atmosphere || !motion || frame % 3 !== 0) continue;
      const p = state.player, roll = (state.roll ? rollAttitude(state.roll) : 0) - p.bank;
      motion.advance(state, p.yaw, roll, !!state.roll, false, false);
      ship.position.set(p.x, p.altitude, -p.z);
      ship.rotation.set(-state.climbRate * 0.005, -p.yaw, roll, 'YXZ');
      camera.position.set(p.x - Math.sin(p.yaw) * 40, p.altitude + 15, -p.z + Math.cos(p.yaw) * 40);
      camera.lookAt(ship.position);
      camera.updateMatrixWorld();
      windInstances += atmosphere.update(camera, state, 3, false, motion.boost, false);
      surface.update(state, ship, camera, undefined, 3, motion.boost, false);
      wingSegments += surface.trailSegments;
      rendered++;
    }
    assert.ok(['clear', 'lost', 'timeout'].includes(state.phase), state.phase);
    if (enabled) assert.ok(rendered > 100 && wingSegments > 0 && windInstances > 0);
    return createHash('sha256').update(JSON.stringify(state)).digest('hex');
  }
  assert.equal(replay(true), replay(false));
});
