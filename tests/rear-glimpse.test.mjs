import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { cockpitLayout, desktopLayout, phoneLayout } from '../src/layout.ts';
import { frameRearCamera, glimpseWipe, layoutRearInset, layoutRearMirror } from '../src/rear-glimpse.ts';

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

test('the cockpit mirror can expand without covering fixed instruments', () => {
  for (const [width, height, mobile] of [[1280, 800, false], [390, 844, true], [844, 390, true]]) {
    const phone = mobile ? phoneLayout(width, height, safe, 'cockpit') : null;
    const hud = phone ?? desktopLayout(width, height, safe);
    const cockpit = cockpitLayout(width, height, safe, hud.objective, phone?.controls);
    const { rest, focus } = layoutRearMirror(cockpit, phone);
    assert.ok(rest.height >= 14);
    assert.equal(focus.x + focus.width, rest.x + rest.width);
    assert.equal(focus.y, rest.y);
    assert.ok(focus.width >= rest.width);
    if (width === 390) assert.ok(focus.width > rest.width);
    for (const region of [cockpit.heading, cockpit.altitude, cockpit.message, cockpit.dashboard]) {
      assert.equal(intersects(focus, region), false);
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
  const camera = new PerspectiveCamera(52, 128 / 56, 0.8, 640);
  frameRearCamera(camera, player, true);
  const flare = new Vector3(7, 107, -40).project(camera);
  const high = new Vector3(-30, 110, -40).project(camera);
  const low = new Vector3(-30, 90, -40).project(camera);
  assert.ok(Math.abs(flare.x) < 1 && Math.abs(flare.y) < 1 && Math.abs(flare.z) < 1);
  assert.ok(Math.abs(low.y) < 1 && low.y < high.y - 0.4);
  assert.ok(Math.abs(low.x - high.x) < 0.001);
});

test('a delayed bomb blast stays in the rear feed after the pilot turns', () => {
  const camera = new PerspectiveCamera(52, 128 / 56, 0.8, 640);
  const player = { x: 20, z: 40, yaw: Math.PI, altitude: 150, bank: 0 };
  const blast = { x: -120, z: -60, alt: 40 };
  frameRearCamera(camera, player, true, blast);
  const impact = new Vector3(blast.x, blast.alt, -blast.z).project(camera);
  assert.ok(Math.abs(impact.z) < 1);
  assert.ok(Math.abs(impact.x) < 0.35 && Math.abs(impact.y) < 0.35);
});
