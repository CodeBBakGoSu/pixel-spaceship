import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { autopilotInput } from '../src/autoplay.ts';
import { observeDamage } from '../src/combat-feedback.ts';
import { ImpactBatch } from '../src/impact-audio.ts';
import { PickupVisuals } from '../src/pickup-visuals.ts';
import { ProjectileTrails } from '../src/projectile-trails.ts';
import { AdaptiveQuality } from '../src/render-quality.ts';
import { createStage, parseStageOptions, RUN_END_TICK, stepStage } from '../src/stage.ts';
import { World } from '../src/world.ts';

// Survivors seed-1 uses desktop Gnat floors 22/44/90/130/166 and rates 70/160/320/480/600; mobile values do not affect this hash.
// Seed-1 terminal hashes also cover timed swarm formations and recovery pulses, production terrain, and the full-view pilot.
const terminalHashes = {
  legacy: 'cfe30ddaf2a97ef808244d507845819ea76ce2de6f2dd26661bc2e159ccf3903',
  survivors: '1cede4023fb8ad248a8eef93bc7dc79f0da81989555e3f74a4f1be948f0e5905',
};
const world = new World();
const ground = (x, z) => world.height(x, z);

for (const [mode, expected] of Object.entries(terminalHashes)) {
  test(`${mode} keeps its replay hash with fidelity rendering enabled or disabled`, () => {
    for (const enabled of [false, true]) {
      const stage = createStage(parseStageOptions(`?autoplay=1&mode=${mode}&seed=1`), ground);
      const pickups = enabled ? new PickupVisuals() : null;
      const quality = enabled ? new AdaptiveQuality('high') : null;
      const trails = enabled ? new ProjectileTrails() : null;
      const impacts = enabled ? new ImpactBatch() : null;
      if (impacts) observeDamage(stage, (_id, damage, critical) => impacts.hit(stage.tick * 1000 / 60, damage, critical));
      for (let i = 0; i < RUN_END_TICK * 2 && ['playing', 'draft', 'chest'].includes(stage.phase); i++) {
        impacts?.drain(stage.tick * 1000 / 60);
        stepStage(stage, autopilotInput(stage, 'full', ground), ground);
        pickups?.update(stage, stage.view === 'overhead' ? stage.player.altitude : undefined);
        trails?.advance(stage.shots, stage.tick, stage.run?.weaponLevels.twin ?? 1, true);
        quality?.observe(18);
      }
      if (quality) assert.equal(quality.tier, 'low');
      assert.equal(stage.phase, 'clear');
      assert.equal(createHash('sha256').update(JSON.stringify(stage)).digest('hex'), expected);
    }
  });
}
