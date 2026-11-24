import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneLayout } from '../src/layout.ts';
import { AEGIS_CUE_SIZE, findTouchCueRect, findTouchCueRects, pointBehindTouchControls, screenArrowRotation,
  screenPointObscured, TOUCH_THREAT_CUE_SIZE, touchControlOcclusionRect, isDescendingDiveWarning,
  touchOcclusionCue } from '../src/touch-cue-layout.ts';

const sizes = [[390, 844], [844, 390]];
const safe = { top: 0, right: 0, bottom: 0, left: 0 };
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;
const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y
  && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

for (const [width, height] of sizes) for (const cueSize of [
  { width: 48, height: 40 },
  { width: 136, height: 40 },
  { width: 160, height: 44 },
]) {
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

for (const [width, height] of sizes) {
  test(`simultaneous dive and Aegis cues use distinct free slots at ${width}x${height}`, () => {
    const layout = phoneLayout(width, height, safe, 'chase', true);
    const aegis = findTouchCueRect(layout, { width: 160, height: 44 });
    assert.ok(aegis);
    const dive = touchOcclusionCue(layout, { x: width / 2, y: 20 },
      { x: width / 2, y: layout.controls.y + layout.controls.height / 2 }, { width: 48, height: 40 }, 8, [aegis]);
    assert.ok(dive);
    assert.equal(overlaps(aegis, dive.rect), false);
    assert.equal(overlaps(layout.playfield, aegis), false);
    assert.equal(overlaps(layout.playfield, dive.rect), false);
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
test('projected bounds need a cue when outside the viewport or behind UI/ship/projectile overlays', () => {
  const viewport = { width: 390, height: 844 };
  const controls = { x: 0, y: 684, width: 390, height: 160 };
  const ship = { x: 175, y: 560, width: 40, height: 40 };
  const projectile = { x: 190, y: 520, width: 10, height: 18 };
  assert.equal(screenPointObscured({ x: 195, y: 700, depth: 20 }, viewport, [controls]), true);
  assert.equal(screenPointObscured({ x: -1, y: 320, depth: 20 }, viewport, []), true);
  assert.equal(screenPointObscured({ x: 195, y: 580, depth: 20 }, viewport, [ship]), true);
  assert.equal(screenPointObscured({ x: 195, y: 528, depth: 20 }, viewport, [projectile]), true);
  assert.equal(screenPointObscured({ x: 195, y: 400, depth: 20 }, viewport, []), false);
  assert.equal(screenPointObscured({ x: 195, y: 400, depth: -1 }, viewport, []), true);
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
  assert.equal(isDescendingDiveWarning(undefined, 2), false);
});
