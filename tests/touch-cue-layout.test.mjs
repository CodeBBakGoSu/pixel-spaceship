import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneLayout } from '../src/layout.ts';
import { AEGIS_CUE_SIZE, findTouchCueRect, findTouchCueRects, isDescendingDiveWarning, pointBehindTouchControls,
  screenArrowRotation, TOUCH_THREAT_CUE_SIZE, touchControlOcclusionRect, touchCueScreenReference, touchOcclusionCue } from '../src/touch-cue-layout.ts';

const sizes = [[390, 844], [844, 390]];
const safe = { top: 0, right: 0, bottom: 0, left: 0 };
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;
const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y
  && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

for (const [width, height] of sizes) for (const cueSize of [{ width: 48, height: 40 }, { width: 136, height: 40 }]) {
  test(`${cueSize.width}px cue uses a free control-panel slot at ${width}x${height}`, () => {
    const layout = phoneLayout(width, height, safe, 'chase', true);
    const cue = findTouchCueRect(layout, cueSize);
    assert.ok(cue);
    assert.ok(contains(layout.controls, cue));
    assert.equal(overlaps(layout.playfield, cue), false);
    for (const target of [layout.stick, layout.stickLabel, layout.loop, layout.roll, layout.boost, layout.view]) {
      assert.equal(overlaps(cue, target), false);
    }
  });
}

test('a covered dive target points from the player to its actual projected location', () => {
  const layout = phoneLayout(390, 844, safe, 'chase', true);
  const from = { x: 195, y: 580 };
  const target = { x: 195, y: layout.controls.y + 24 };
  const originalTarget = { ...target };
  const cue = touchOcclusionCue(layout, from, target, { width: 48, height: 40 });
  assert.ok(cue);
  assert.equal(cue.rotation, 180);
  assert.deepEqual(target, originalTarget);
  assert.ok(contains(layout.controls, cue.rect));
  assert.equal(overlaps(layout.playfield, cue.rect), false);
});

test('partial touch occlusion is detected while visible playfield targets do not trigger a cue', () => {
  const layout = phoneLayout(844, 390, safe, 'chase', true);
  assert.equal(pointBehindTouchControls({ x: 422, y: layout.controls.y - 6 }, layout.controls, 8), true);
  assert.equal(touchOcclusionCue(layout, { x: 422, y: 180 }, { x: 422, y: layout.controls.y - 6 },
    { width: 48, height: 40 }, 8)?.rotation, 180);
  assert.equal(touchOcclusionCue(layout, { x: 422, y: 180 }, { x: 422, y: layout.controls.y - 24 },
    { width: 48, height: 40 }, 8), null);
});

test('direction follows hazard movement and rejects a zero-length direction', () => {
  assert.equal(screenArrowRotation({ x: 100, y: 100 }, { x: 100, y: 200 }), 180);
  const diagonal = screenArrowRotation({ x: 100, y: 100 }, { x: 150, y: 200 });
  assert.ok(diagonal > 150 && diagonal < 160);
  assert.equal(screenArrowRotation({ x: 5, y: 5 }, { x: 5, y: 5 }), null);
});

test('full touch backdrop occlusion includes safe-inset edges and reserves the visible audio control', () => {
  const layout = phoneLayout(390, 844, { top: 0, right: 12, bottom: 30, left: 12 }, 'chase', true);
  const backdrop = touchControlOcclusionRect(layout, { width: 390, height: 844 });
  const target = { x: 2, y: layout.controls.y + 10 };
  assert.equal(pointBehindTouchControls(target, layout.controls), false);
  assert.equal(pointBehindTouchControls(target, backdrop), true);
  assert.deepEqual(layout.audio, {
    x: layout.stick.x + layout.stick.width + 9,
    y: layout.controls.y + 9,
    width: 44,
    height: 44,
  });
});

test('obstacle-edge search finds distinct Aegis and dive cue slots in short portrait cockpits', () => {
  for (const width of [360, 390]) {
    const layout = phoneLayout(width, 844, { top: 0, right: 0, bottom: 0, left: 0 }, 'cockpit', true);
    const [aegis, threat] = findTouchCueRects(layout, [AEGIS_CUE_SIZE, TOUCH_THREAT_CUE_SIZE]);
    assert.ok(aegis, `${width}x844 Aegis slot`);
    assert.ok(threat, `${width}x844 threat slot`);
    const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    assert.equal(overlaps(aegis, threat), false);
    for (const cue of [aegis, threat]) {
      assert.ok(cue.x >= layout.controls.x && cue.y >= layout.controls.y);
      assert.ok(cue.x + cue.width <= layout.controls.x + layout.controls.width);
      assert.ok(cue.y + cue.height <= layout.controls.y + layout.controls.height);
      assert.equal(overlaps(cue, layout.audio), false);
      assert.equal(overlaps(cue, layout.playfield), false);
      for (const target of [layout.pause, layout.stick, layout.stickLabel, layout.loop, layout.roll, layout.boost, layout.view]) {
        assert.equal(overlaps(cue, target), false);
      }
    }
  }
});

test('descending warning state is independent of HUD message selection', () => {
  assert.equal(isDescendingDiveWarning({ phase: 'warning', band: 1 }, 2), true);
  assert.equal(isDescendingDiveWarning({ phase: 'warning', band: 2 }, 2), false);
  assert.equal(isDescendingDiveWarning({ phase: 'warning', band: 3 }, 2), false);
  assert.equal(isDescendingDiveWarning({ phase: 'attack', band: 1 }, 2), false);
  assert.equal(isDescendingDiveWarning(null, 2), false);
  assert.equal(isDescendingDiveWarning(undefined, 2), false);
});

test('cockpit cue direction uses the aiming reference when the player is behind the camera', () => {
  const layout = phoneLayout(390, 844, { top: 0, right: 0, bottom: 0, left: 0 }, 'cockpit', true);
  const reference = touchCueScreenReference({ x: 12, y: 34, depth: -0.2 }, layout);
  assert.deepEqual(reference, {
    x: layout.cockpit.aiming.x + layout.cockpit.aiming.width / 2,
    y: layout.cockpit.aiming.y + layout.cockpit.aiming.height * 0.72,
  });
  assert.deepEqual(touchCueScreenReference({ x: 14, y: 18, depth: 3 }, layout), { x: 14, y: 18 });
});
