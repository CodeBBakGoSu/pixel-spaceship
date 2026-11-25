import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldShowSwarmNotice } from '../src/hud-notices.ts';

test('Survivors hide the inactive global-recovery banner while retaining other and Legacy notices', () => {
  assert.equal(shouldShowSwarmNotice(true, 'recovery'), false);
  assert.equal(shouldShowSwarmNotice(true, 'ring'), true);
  assert.equal(shouldShowSwarmNotice(false, 'recovery'), true);
  assert.equal(shouldShowSwarmNotice(false, undefined), false);
});
