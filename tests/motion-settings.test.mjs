import test from 'node:test';
import assert from 'node:assert/strict';
import { initialScreenShake, normalizeScreenShake } from '../src/motion-settings.ts';
import { shockworthyBlast } from '../src/scene.ts';

test('player bombs, flak and rapid small bursts do not trigger camera shock', () => {
  assert.equal(shockworthyBlast({ kind: 'bomb-blast', life: 0.8 }), false);
  assert.equal(shockworthyBlast({ kind: 'flak', life: 0.6 }), false);
  assert.equal(shockworthyBlast({ kind: 'burst', life: 0.42 }), false);
  assert.equal(shockworthyBlast({ kind: 'burst', life: 0.66 }), true);
});

test('screen shake defaults to half strength, zero with reduced motion, and clamps storage', () => {
  const empty = { getItem: () => null };
  assert.equal(initialScreenShake(empty, false), 50);
  assert.equal(initialScreenShake(empty, true), 0);
  assert.equal(normalizeScreenShake('125'), 100);
  assert.equal(normalizeScreenShake('-4'), 0);
  assert.equal(normalizeScreenShake('noise'), undefined);
});
