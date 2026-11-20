import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneLayout, renderBuffer } from '../src/layout.ts';
import { AdaptiveQuality, initialRenderQuality, saveRenderQuality } from '../src/render-quality.ts';

test('quality is saved, validated, and overridable by a reproducible fixture URL', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(initialRenderQuality(new URLSearchParams(), storage), 'high');
  saveRenderQuality('low', storage);
  assert.equal(initialRenderQuality(new URLSearchParams(), storage), 'low');
  assert.equal(initialRenderQuality(new URLSearchParams('quality=medium'), storage), 'medium');
  assert.equal(initialRenderQuality(new URLSearchParams('quality=bad'), storage), 'low');
  const denied = () => { throw new Error('storage denied'); };
  assert.equal(initialRenderQuality(new URLSearchParams(), { getItem: denied }), 'high');
  assert.doesNotThrow(() => saveRenderQuality('medium', { setItem: denied }));
});

test('desktop and portrait start at one CSS pixel per render pixel', () => {
  const desktop = quality => renderBuffer(1920, 1080, null, quality);
  const phone = phoneLayout(390, 844, { top: 32, bottom: 20, left: 0, right: 0 }, 'cockpit');
  const portrait = quality => renderBuffer(390, 844, phone, quality);
  for (const [actual, expected] of [
    [desktop('high'), [1920, 1080]], [desktop('medium'), [960, 540]], [desktop('low'), [640, 360]],
    [portrait('high'), [390, 844]], [portrait('medium'), [336, 727]], [portrait('low'), [195, 422]],
  ]) {
    assert.deepEqual([actual.width, actual.height], expected);
  }
  const odd = renderBuffer(1281, 801, null, 'medium');
  assert.equal(odd.width * odd.cssScale, 1282);
  assert.equal(odd.height * odd.cssScale, 802);
});

test('each phone fallback reduces pixel count on narrow phones and wide touchscreens', () => {
  for (const [width, height] of [[320, 568], [1920, 1080]]) {
    const phone = phoneLayout(width, height, { top: 0, bottom: 0, left: 0, right: 0 }, 'chase');
    const pixelCount = tier => {
      const buffer = renderBuffer(width, height, phone, tier);
      return buffer.width * buffer.height;
    };
    assert.ok(pixelCount('high') > pixelCount('medium'), `${width}px High to Medium`);
    assert.ok(pixelCount('medium') > pixelCount('low'), `${width}px Medium to Low`);
  }
});

test('frame p95 lowers a tier only after a sustained over-budget sample', () => {
  const quality = new AdaptiveQuality('high');
  const frames = (count, elapsed) => {
    for (let i = 0; i < count; i++) quality.observe(typeof elapsed === 'function' ? elapsed(i) : elapsed);
  };
  frames(240, i => i % 30 ? 16.7 : 33.3);
  assert.equal(quality.tier, 'high', 'rare spikes leave the p95 under budget');
  frames(300, 18);
  assert.equal(quality.tier, 'low', 'each sustained overrun can lower one step');
  frames(300, 10);
  assert.equal(quality.tier, 'low', 'the lower setting remains stable for this flight');
  quality.select('high');
  assert.equal(quality.tier, 'high');
  frames(100, 22);
  quality.observe(null);
  frames(100, 22);
  assert.equal(quality.tier, 'high', 'a pause breaks the sample window');
});

test('long active frames still count toward the p95 fallback', () => {
  const quality = new AdaptiveQuality('high');
  for (let i = 0; i < 144; i++) quality.observe(i % 9 === 0 ? 260 : 16.7);
  assert.equal(quality.tier, 'medium');
});

test('timestamp rounding at the frame budget keeps the preferred tier', () => {
  const quality = new AdaptiveQuality('high');
  for (let i = 0; i < 144; i++) quality.observe(16.8000000000007);
  assert.equal(quality.tier, 'high');
});
