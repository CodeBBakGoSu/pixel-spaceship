import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { autopilotInput } from '../src/autoplay.ts';
import { PickupVisuals } from '../src/pickup-visuals.ts';
import { AdaptiveQuality } from '../src/render-quality.ts';
import { createStage, parseStageOptions, RUN_END_TICK, stepStage } from '../src/stage.ts';
import { World } from '../src/world.ts';

// Survivors seed-1 covers phase timing, pickup rules, magnet drops, production terrain, and the full-view pilot.
const terminalHashes = {
  legacy: '1ba96a2d9956f3bcb8c10a6ccf51a4db02e523d41d6132b8fa2f4658a12942d5',
  survivors: 'a43beef8bf2fa56fab466fa545dbbe7b0fe334b0f1aea7242bf26747f848b87a',
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
