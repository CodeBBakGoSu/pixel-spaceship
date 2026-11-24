import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneLayout } from '../src/layout.ts';
import { findTouchCueRect, pointBehindTouchControls, screenArrowRotation, screenPointObscured, touchOcclusionCue } from '../src/touch-cue-layout.ts';

const sizes = [[390, 844], [844, 390]];
const safe = { top: 0, right: 0, bottom: 0, left: 0 };
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;
const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y
  && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

for (const [width, height] of sizes) for (const cueSize of [{ width: 48, height: 40 }, { width: 160, height: 44 }]) {
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

test('projected bounds need a cue when outside the viewport or behind UI/ship overlays', () => {
  const viewport = { width: 390, height: 844 };
  const controls = { x: 0, y: 684, width: 390, height: 160 };
  const ship = { x: 175, y: 560, width: 40, height: 40 };
  assert.equal(screenPointObscured({ x: 195, y: 700, depth: 20 }, viewport, [controls]), true);
  assert.equal(screenPointObscured({ x: -1, y: 320, depth: 20 }, viewport, []), true);
  assert.equal(screenPointObscured({ x: 195, y: 580, depth: 20 }, viewport, [ship]), true);
  assert.equal(screenPointObscured({ x: 195, y: 400, depth: 20 }, viewport, []), false);
  assert.equal(screenPointObscured({ x: 195, y: 400, depth: -1 }, viewport, []), true);
});
