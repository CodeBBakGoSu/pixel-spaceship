import assert from 'node:assert/strict';
import test from 'node:test';
import { stageRenderTick } from '../src/render-cadence.ts';

test('render cadence follows terminal settlement while preserving the sortie clock', () => {
  const state = { tick: 7200, pendingFinish: { settlementTick: 7200 } };
  let lastRendered = stageRenderTick(state);
  state.pendingFinish.settlementTick++;
  assert.equal(state.tick, 7200);
  assert.notEqual(stageRenderTick(state), lastRendered);
  lastRendered = stageRenderTick(state);
  state.pendingFinish.settlementTick++;
  assert.notEqual(stageRenderTick(state), lastRendered);
  lastRendered = stageRenderTick(state);
  delete state.pendingFinish;
  assert.notEqual(stageRenderTick(state), lastRendered);
  assert.equal(stageRenderTick(state), 7200);
});
