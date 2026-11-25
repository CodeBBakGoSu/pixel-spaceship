import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { autopilotInput } from '../src/autoplay.ts';
import { PickupVisuals } from '../src/pickup-visuals.ts';
import { AdaptiveQuality } from '../src/render-quality.ts';
import { createStage, parseStageOptions, RUN_END_TICK, stepStage } from '../src/stage.ts';
import { World } from '../src/world.ts';

// Survivors seed-1 covers minute waves, rings, minibosses/rest, production terrain, and the full-view pilot.
const terminalHashes = {
  legacy: '644ab8cb5d115dd6819b09bd6d1760e3fb67ca79b8b79a4d0fb98c3282f3c7df',
  survivors: '63461c3cd96addd7e0374920bab88d886a27f79a923d5add5bedcb982933845a',
};
const world = new World();
const ground = (x, z) => world.height(x, z);

for (const [mode, expected] of Object.entries(terminalHashes)) {
  test(`${mode} keeps its replay hash with fidelity rendering enabled or disabled`, () => {
    for (const enabled of [false, true]) {
      const stage = createStage(parseStageOptions(`?autoplay=1&mode=${mode}&seed=1`), ground);
      const pickups = enabled ? new PickupVisuals() : null;
      const quality = enabled ? new AdaptiveQuality('high') : null;
      for (let i = 0; i < RUN_END_TICK * 2 && ['playing', 'draft', 'chest'].includes(stage.phase); i++) {
        stepStage(stage, autopilotInput(stage, 'full', ground), ground);
        pickups?.update(stage, stage.view === 'overhead' ? stage.player.altitude : undefined);
        quality?.observe(18);
      }
      if (quality) assert.equal(quality.tier, 'low');
      assert.equal(stage.phase, 'clear');
      assert.equal(createHash('sha256').update(JSON.stringify(stage)).digest('hex'), expected);
    }
  });
}
