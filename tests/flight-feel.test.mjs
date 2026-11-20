import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { cockpitFov, frameCockpit } from '../src/camera.ts';
import { projectCameraContact } from '../src/contact-projection.ts';
import * as feel from '../src/flight-feel.ts';
import { cockpitLayout, desktopLayout, phoneLayout } from '../src/layout.ts';
import { visibleHazeCutoff } from '../src/post.ts';
import { frameRearCamera, REAR_VIEW_ASPECT } from '../src/rear-glimpse.ts';
import { terrainFogFar } from '../src/world.ts';

const degree = Math.PI / 180;
const safe = { top: 0, right: 0, bottom: 0, left: 0 };
const ground = () => 35;
const close = (value, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(value - expected) <= tolerance, `${value} vs. ${expected}`);

test('the boost lens eases to full in 15 ticks and returns to level in 30 ticks', () => {
  let previous = 0;
  for (let tick = 1; tick < 15; tick++) {
    const progress = feel.easedBoost(0, true, tick / 60);
    assert.ok(progress > previous && progress < 1);
    previous = progress;
  }
  assert.equal(feel.easedBoost(0, true, 0.25), 1);
  assert.equal(feel.easedBoost(1, false, 0), 1);
  for (let tick = 1; tick < 30; tick++) {
    const progress = feel.easedBoost(1, false, tick / 60);
    assert.ok(progress > 0 && progress < feel.easedBoost(1, false, (tick - 1) / 60));
  }
  assert.equal(feel.easedBoost(1, false, 0.5), 0);
  assert.equal(feel.easedBoost(0.45, false, 0), 0.45);
});

test('bank mapping uses the full cockpit attitude, a partial chase roll and a phone cap', () => {
  const bank = -85 * degree;
  close(feel.cameraBank(bank, 'cockpit', false), bank);
  close(feel.cameraBank(bank, 'chase', false), bank * 0.4);
  for (const view of ['cockpit', 'chase']) {
    close(feel.cameraBank(bank, view, true), -25 * degree);
    close(feel.cameraBank(-bank, view, true), 25 * degree);
    close(feel.cameraBank(bank, view, false, true), 0);
  }
  close(feel.cameraBank(2 * Math.PI, 'chase', false, false, true), 0);
  close(feel.cameraBank(2 * Math.PI, 'cockpit', true, false, true), 0);
});

test('chase yaw crosses the signed angle boundary on the short arc', () => {
  const shortCrossing = feel.laggedYaw(179 * degree, -179 * degree, 1 / 60);
  assert.ok(Math.abs(shortCrossing + 179 * degree) < 2 * degree);
  const hardTurn = feel.laggedYaw(0, 1.2, 1 / 60);
  assert.ok(hardTurn < 1.2 && hardTurn > 1.2 - 12 * degree);
});

test('chase roll eases in and back out while a same-tick phone resize applies the camera cap', () => {
  const motion = new feel.FlightMotion();
  const stage = { tick: 0, speed: 52, boosting: false, boostTicks: 0 };
  const bank = -85 * degree, chaseTarget = bank * 0.4;
  motion.advance(stage, 0, 0, false, false, false);
  stage.tick++;
  motion.advance(stage, 0, bank, false, false, false);
  assert.ok(motion.chaseBank < 0 && motion.chaseBank > chaseTarget);
  stage.tick += 60;
  motion.advance(stage, 0, bank, false, false, false);
  close(motion.chaseBank, chaseTarget, 0.001);
  motion.advance(stage, 0, bank, false, true, false);
  close(motion.chaseBank, -25 * degree);
  stage.tick++;
  motion.advance(stage, 0, 0, false, true, false);
  assert.ok(motion.chaseBank > -25 * degree && motion.chaseBank < 0);
  stage.tick += 60;
  motion.advance(stage, 0, 0, false, true, false);
  close(motion.chaseBank, 0, 0.001);
});

test('shake decays at 4.5/s and reduced motion clears both boost and camera movement', () => {
  close(feel.shockEnvelope(1, 0.25), Math.exp(-4.5 * 0.25));
  const motion = new feel.FlightMotion();
  const stage = { tick: 90, speed: 91, boosting: true, boostTicks: 30 };
  const original = { ...stage };
  motion.shock('parry', stage.tick);
  motion.advance(stage, 0.6, -1.4, false, false, false);
  assert.equal(motion.boost, 1);
  assert.ok(Math.hypot(motion.shake, motion.shakeVertical) > 0.02);
  close(motion.chaseBank, -1.4 * 0.4);
  motion.advance(stage, 0.6, -1.4, false, false, true);
  assert.deepEqual([motion.boost, motion.shake, motion.shakeVertical, motion.chaseBank], [0, 0, 0, 0]);
  assert.deepEqual(stage, original);
});

test('the zero pitch ladder follows the same far terrain plane beyond 60° bank', () => {
  const player = { x: 0, z: 0, altitude: 110, yaw: 0, bank: 85 * degree };
  for (const [width, height, phone] of [[1280, 800, false], [390, 844, true]]) {
    const cockpit = phone ? phoneLayout(width, height, safe, 'cockpit').cockpit
      : cockpitLayout(width, height, safe, desktopLayout(width, height, safe).objective);
    const aspect = width / height;
    const camera = new PerspectiveCamera(60, aspect, 0.65, 1060);
    const cameraBank = feel.cameraBank(-player.bank, 'cockpit', phone);
    const fov = cockpitFov(aspect, 0, 8);
    const depth = visibleHazeCutoff(245, terrainFogFar(aspect, fov, 0, cameraBank));
    // The near ridge is behind the camera. The far ridge lies beyond opaque haze.
    const ridgeTerrain = (_x, z) => z <= 0 || z >= 1024 ? 120 : ground();
    const marks = frameCockpit(camera, player, { width, height, cockpit },
      { cameraPitch: 0, cameraBank }, ridgeTerrain, depth, player.yaw, { widening: 8, pullback: 0, shake: 0 });
    const zero = marks.find(mark => mark.angle === 0);
    assert.ok(zero && depth > camera.near && depth < camera.far);
    const left = new Vector3(-80, ground(), camera.position.z - depth).project(camera);
    const right = new Vector3(80, ground(), camera.position.z - depth).project(camera);
    const dx = (right.x - left.x) * width / 2, dy = (left.y - right.y) * height / 2;
    const x = (left.x + 1) * width / 2, y = (1 - left.y) * height / 2;
    close(dy / dx, Math.tan(cameraBank), 1e-6);
    for (const segment of [...zero.left, ...zero.right]) {
      for (const point of [segment.from, segment.to]) {
        const distance = Math.abs(dx * (point.y - y) - dy * (point.x - x)) / Math.hypot(dx, dy);
        assert.ok(distance < 0.5);
        assert.ok(point.y >= cockpit.aiming.y && point.y <= cockpit.aiming.y + cockpit.aiming.height);
      }
    }

    const target = { x: 17, z: 75, alt: 125 };
    const marker = { x: 0, y: 0, depth: 0 };
    const projected = new Vector3(target.x, target.alt, -target.z).project(camera);
    projectCameraContact(camera, { width, height }, target, marker, new Vector3());
    close(marker.x, (1 + projected.x) * width / 2);
    close(marker.y, (1 - projected.y) * height / 2);
    assert.ok(marker.depth >= camera.near && marker.depth < depth);
  }
});

test('mirrored rear-camera roll presents the same horizon angle as the forward bank', () => {
  const bank = -85 * degree;
  const player = { x: 0, z: 0, altitude: 110, yaw: 0, bank: -bank };
  const camera = new PerspectiveCamera(52, REAR_VIEW_ASPECT, 0.8, 640);
  const behind = { x: 0, z: -100, alt: 110 };
  frameRearCamera(camera, player, true, behind, bank);
  const left = new Vector3(-20, 110, 100).project(camera);
  const right = new Vector3(20, 110, 100).project(camera);
  // Account for the target's horizontal flip and the conversion to screen pixels.
  const slope = (left.y - right.y) / ((left.x - right.x) * REAR_VIEW_ASPECT);
  close(slope, Math.tan(bank), 0.03);
});
