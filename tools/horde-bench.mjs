import { performance } from 'node:perf_hooks';
import { autopilotInput } from '../src/autoplay.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { createStage, parseStageOptions, stepStage } from '../src/stage.ts';

// Fixed late-run load isolates simulation cost from changing spawn schedules.
const ground = () => 35;
const samples = [];
for (let run = 0; run < 7; run++) {
  const state = createStage(parseStageOptions('?autoplay=1&mode=survivors&seed=1'), ground);
  state.tick = 540 * 60;
  state.swarmCap = 240;
  state.hull = state.maxHull = 100000;
  for (let i = 0; i < 240; i++) {
    const angle = i * Math.PI * 2 / 240;
    const enemy = makeEnemy(state, Math.sin(angle) * 300, Math.cos(angle) * 300, i % 3, 'gnat');
    enemy.leaveAt = state.tick + 1200;
    state.enemies.push(enemy);
  }
  const start = performance.now();
  for (let i = 0; i < 120; i++) stepStage(state, autopilotInput(state, 'full', ground), ground);
  samples.push((performance.now() - start) / 120);
}
samples.sort((a, b) => a - b);
console.log(`t=540s, 240 initial gnats, flat terrain, pilot+sim: median ${samples[3].toFixed(3)} ms/tick (7 x 120 ticks)`);
