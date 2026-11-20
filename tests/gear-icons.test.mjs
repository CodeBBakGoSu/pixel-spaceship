import test from 'node:test';
import assert from 'node:assert/strict';
import { BUFF_IDS, EVOLUTIONS, OVERFLOW_IDS, WEAPON_IDS } from '../src/data/items.ts';
import { GEAR_ICON_IDS, gearIconPixels } from '../src/gear-icons.ts';

test('the icon registry covers all gear, evolutions, draft overflow and reward badges', () => {
  const required = [...WEAPON_IDS, ...BUFF_IDS, ...OVERFLOW_IDS,
    ...Object.values(EVOLUTIONS).map(recipe => recipe.id),
    'chest', 'bill', 'locked', 'set-ballistic', 'set-ordnance', 'set-energy'];
  assert.deepEqual(GEAR_ICON_IDS.toSorted(), required.toSorted());
});

test('each icon produces distinct deterministic art on a 32px pixel grid', () => {
  const designs = new Set();
  for (const id of GEAR_ICON_IDS) {
    const pixels = gearIconPixels(id);
    assert.equal(pixels.length, 32 * 32 * 4, id);
    assert.deepEqual(gearIconPixels(id), pixels, id);
    const silhouette = [];
    for (let y = 4; y < 28; y++) {
      for (let x = 4; x < 28; x++) {
        const index = (y * 32 + x) * 4;
        assert.equal(pixels[index + 3], 255, id);
        silhouette.push(...pixels.slice(index, index + 3));
      }
    }
    designs.add(Buffer.from(silhouette).toString('base64'));
  }
  assert.equal(designs.size, GEAR_ICON_IDS.length);
});

test('all evolutions carry the gold frame even when their base family differs', () => {
  const rim = (id) => [...gearIconPixels(id).slice((32 + 16) * 4, (32 + 16) * 4 + 4)];
  for (const weapon of WEAPON_IDS) {
    assert.notDeepEqual(rim(weapon), [255, 204, 51, 255]);
    assert.deepEqual(rim(EVOLUTIONS[weapon].id), [255, 204, 51, 255]);
  }
});
