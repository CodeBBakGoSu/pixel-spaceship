import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { autopilotInput } from '../src/autoplay.ts';
import { PickupVisuals } from '../src/pickup-visuals.ts';
import { AdaptiveQuality } from '../src/render-quality.ts';
import { createStage, parseStageOptions, RUN_END_TICK, stepStage } from '../src/stage.ts';
import { World } from '../src/world.ts';

// Seed-1 terminal hashes: horde caps, encirclement and fly-in pursuit, production terrain, full-view pilot.
const terminalHashes = {
  legacy: '99ceb9d711974517ada3b63dee361023844d22ecd1dc9b7555fa642bd6020df2',
  survivors: '843a76c2218cf374bc7137d5e3e1faa2acebe45cfed4c2911ffc66124bb89c3b',
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
