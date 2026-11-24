import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { autopilotInput } from '../src/autoplay.ts';
import { PickupVisuals } from '../src/pickup-visuals.ts';
import { AdaptiveQuality } from '../src/render-quality.ts';
import { createStage, parseStageOptions, RUN_END_TICK, stepStage } from '../src/stage.ts';
import { World } from '../src/world.ts';

// Survivors seed-1 covers the minute wave schedule, timed ring/rest events, production terrain, and the full-view pilot.
const terminalHashes = {
  legacy: '644ab8cb5d115dd6819b09bd6d1760e3fb67ca79b8b79a4d0fb98c3282f3c7df',
  survivors: '33102e068ea078df38310b70f0e6ed5e21f1c17e2756bf45ff6de3fe640d68a5',
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
