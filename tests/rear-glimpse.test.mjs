import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { cockpitLadderSpan } from '../src/camera.ts';
import { TAIL_TRACK_RANGE } from '../src/data/navigation.ts';
import { scaleTravel } from '../src/data/speed.ts';
import { RearMirrorThreat } from '../src/instruments.ts';
import { cockpitLayout, desktopLayout, phoneLayout } from '../src/layout.ts';
import { frameRearCamera, glimpseWipe, layoutRearInset, layoutRearMirror, REAR_VIEW_ASPECT } from '../src/rear-glimpse.ts';

const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;
const safe = { top: 32, right: 7, bottom: 20, left: 7 };

test('the rear inset clears the objective, instruments and phone controls', () => {
  const desktop = desktopLayout(1280, 800, safe);
  const desktopInset = layoutRearInset(desktop, 800, null);
  assert.ok(desktopInset.width >= 190);
  assert.ok(desktopInset.x >= safe.left);
  assert.ok(desktopInset.y >= desktop.objective.y + desktop.objective.height);
  for (const view of ['overhead', 'chase']) {
    for (const [width, height] of [[390, 844], [844, 390]]) {
      const phone = phoneLayout(width, height, safe, view);
      const inset = layoutRearInset(phone, height, phone);
      assert.ok(inset.width >= 90 && inset.width < desktopInset.width);
      assert.ok(inset.x >= phone.playfield.x && inset.y >= phone.playfield.y);
      assert.ok(inset.y + inset.height < phone.controls.y);
      for (const region of [phone.radio, phone.radar, phone.alt, phone.objective]) {
        assert.equal(intersects(inset, region), false);
      }
    }
  }
});

test('the larger cockpit mirror keeps the HUD and center ladder clear at rest and during a glimpse', () => {
  for (const [width, height, mobile] of [[1280, 720, false], [1920, 1080, false], [360, 780, true], [390, 844, true], [430, 932, true], [844, 390, true]]) {
    for (const insets of [{ top: 0, right: 0, bottom: 0, left: 0 }, safe]) {
      const phone = mobile ? phoneLayout(width, height, insets, 'cockpit') : null;
      const hud = phone ?? desktopLayout(width, height, insets);
      const cockpit = phone?.cockpit ?? cockpitLayout(width, height, insets, hud.objective);
      const label = `${width}×${height}, top inset ${insets.top}`;
      const mirror = layoutRearMirror(cockpit, phone);
      assert.ok(mirror, label);
      const { rest, focus } = mirror;
      assert.ok(rest.height >= 14, label);
      assert.equal(focus.x + focus.width, rest.x + rest.width, label);
      assert.equal(focus.y, rest.y, label);
      assert.ok(focus.width > rest.width && focus.height > rest.height, label);
      if (width >= 1280) {
        assert.ok(rest.width >= 256 && rest.width <= 320 && rest.height >= 112 && rest.height <= 140, label);
      }
      if (width === 1920) {
        assert.ok(focus.x + focus.width <= 1745, `${label}: the mirror runs under the canopy strut`);
      }
      if (mobile && height > width) {
        assert.ok(rest.width >= 165 && rest.height >= 72, label);
        assert.ok(focus.width >= rest.width * 1.1, label);
      }

      const { aiming, glass } = cockpit;
      const ladderHalfWidth = Math.ceil(cockpitLadderSpan(cockpit)) + 4;
      const centerLadder = { x: aiming.x + aiming.width / 2 - ladderHalfWidth, width: 2 * ladderHalfWidth,
        y: Math.floor(aiming.y + aiming.height * 0.48) - 24, height: 48 };
      const protectedRegions = { hud: hud.hud, radio: hud.radio, objective: hud.objective, centerLadder,
        heading: cockpit.heading, speed: cockpit.speed, altitude: cockpit.altitude,
        stores: cockpit.stores, message: cockpit.message, dashboard: cockpit.dashboard, controls: phone?.controls, pause: phone?.pause };
      for (const [name, region] of Object.entries(protectedRegions)) {
        if (region) assert.equal(intersects(focus, region), false, `${label}: mirror covers ${name}`);
      }
      assert.ok(focus.x >= glass.x && focus.y >= glass.y, label);
      assert.ok(focus.x + focus.width <= glass.x + glass.width && focus.y + focus.height <= glass.y + glass.height, label);
    }
  }
});

test('a repeat extends the current rear wipe without replaying its entrance', () => {
  const first = { since: 100, until: 184 };
  const repeat = { since: 100, until: 266 };
  const entrance = glimpseWipe(102, first);
  const exit = glimpseWipe(181, first);
  assert.ok(entrance > 0 && entrance < 1);
  assert.ok(exit > 0 && exit < 1);
  assert.equal(glimpseWipe(146, first), 1);
  assert.equal(glimpseWipe(181, repeat), 1);
  assert.equal(glimpseWipe(266, repeat), 0);
});

test('reduced motion displays the rear image as soon as the glimpse starts', () => {
  const glimpse = { since: 120, until: 204 };
  assert.equal(glimpseWipe(119, glimpse, true), 0);
  assert.equal(glimpseWipe(120, glimpse, true), 1);
  assert.equal(glimpseWipe(203, glimpse, true), 1);
  assert.equal(glimpseWipe(204, glimpse, true), 0);
});

test('the rear camera shows a close flare and a lower pursuer at their own altitudes', () => {
  const player = { x: 20, z: 40, yaw: Math.PI / 2, altitude: 110, bank: 1 };
  const camera = new PerspectiveCamera(52, REAR_VIEW_ASPECT, 0.8, 640);
  frameRearCamera(camera, player, true);
  const flare = new Vector3(7, 107, -40).project(camera);
  const high = new Vector3(-30, 110, -40).project(camera);
  const low = new Vector3(-30, 90, -40).project(camera);
  assert.ok(Math.abs(flare.x) < 1 && Math.abs(flare.y) < 1 && Math.abs(flare.z) < 1);
  assert.ok(Math.abs(low.y) < 1 && low.y < high.y - 0.4);
  assert.ok(Math.abs(low.x - high.x) < 0.001);
});

test('a delayed bomb blast stays in the rear feed after the pilot turns', () => {
  const camera = new PerspectiveCamera(52, REAR_VIEW_ASPECT, 0.8, 640);
  const player = { x: 20, z: 40, yaw: Math.PI, altitude: 150, bank: 0 };
  const blast = { x: -120, z: -60, alt: 40 };
  frameRearCamera(camera, player, true, blast);
  const impact = new Vector3(blast.x, blast.alt, -blast.z).project(camera);
  assert.ok(Math.abs(impact.z) < 1);
  assert.ok(Math.abs(impact.x) < 0.35 && Math.abs(impact.y) < 0.35);
});

test('the rear mirror confirms one closing contact, keeps it briefly, and clears contacts outside range', () => {
  const first = { id: 1, kind: 'fighter', x: scaleTravel(-40), z: scaleTravel(-70), alt: 124, hp: 1, vx: 0, vz: scaleTravel(75) };
  const second = { id: 2, kind: 'fighter', x: 0, z: -TAIL_TRACK_RANGE, alt: 110, hp: 1, vx: 0, vz: scaleTravel(55) };
  const state = { tick: 300, speed: scaleTravel(50), player: { x: 0, z: 0, yaw: 0, altitude: 110 }, enemies: [first, second] };
  const mirror = new RearMirrorThreat();
  assert.equal(mirror.update(state), null);
  state.tick += 9;
  const primary = mirror.update(state);
  assert.deepEqual([primary.id, primary.side, primary.height], [first.id, 'Left', 'Above']);
  Object.assign(second, { x: scaleTravel(30), z: scaleTravel(-40), alt: 95, vz: scaleTravel(120) });
  state.tick++;
  assert.equal(mirror.update(state).id, first.id);
  state.tick += 9;
  assert.equal(mirror.update(state).id, first.id);
  state.tick += 5;
  const next = mirror.update(state);
  assert.deepEqual([next.id, next.side, next.height], [second.id, 'Right', 'Below']);
  second.z = -TAIL_TRACK_RANGE - 5;
  state.tick++;
  assert.equal(mirror.update(state), null);
});
