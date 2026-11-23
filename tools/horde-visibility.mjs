import { createBot } from '../src/bot.ts';
import { seekStage } from '../src/autoplay.ts';
import { GNAT } from '../src/data/phases.ts';
import { parseStageOptions, stepStage } from '../src/stage.ts';
import { World } from '../src/world.ts';

const world = new World();
const ground = (x, z) => world.height(x, z);
const seed = Number(process.argv[2] ?? 1);
world.seed = seed;
const state = seekStage(parseStageOptions(`?autoplay=1&mode=survivors&seed=${seed}&t=540`), ground);
const pilot = createBot('average', seed);
const counts = [];
while (state.tick < 570 * 60 && ['playing', 'draft', 'chest'].includes(state.phase)) {
  stepStage(state, pilot(state, ground), ground);
  if (state.tick < 540 * 60 || state.phase !== 'playing') continue;
  const p = state.player;
  const yaw = Math.hypot(p.vx ?? 0, p.vz ?? 0) > 1 ? Math.atan2(p.vx, p.vz) : p.yaw;
  counts.push(state.enemies.filter(e => {
    const dx = e.x - p.x, dz = e.z - p.z;
    const distance = Math.hypot(dx, dz);
    return e.kind === 'gnat' && e.hp > 0 && distance <= GNAT.range * 1.5
      && dx * Math.sin(yaw) + dz * Math.cos(yaw) >= distance * 0.5;
  }).length);
}
counts.sort((a, b) => a - b);
if (state.tick !== 570 * 60 || counts.length < 1800) throw new Error(`Incomplete segment: tick ${state.tick}, phase ${state.phase}, samples ${counts.length}`);
console.log(`average seed ${seed}, production terrain, t=540–570, forward ±60°, range 1.5×GNAT.range: median ${(counts[Math.floor((counts.length - 1) / 2)] + counts[Math.ceil((counts.length - 1) / 2)]) / 2}, min ${counts[0]}, max ${counts.at(-1)}; samples ${counts.length}, end tick ${state.tick}, phase ${state.phase}`);
