import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAce } from '../src/ace.ts';
import { scaleTravel } from '../src/data/speed.ts';
import { WEAPONS } from '../src/data/items.ts';
import { weaponDamage } from '../src/loadout.ts';
import { advanceRangedShot, advanceRangedWeapons } from '../src/ranged-weapons.ts';
import { BANDS } from '../src/stage-combat.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { createStage, parseStageOptions } from '../src/stage.ts';
import { pointSegmentDistanceSquared3d } from '../src/spatial.ts';

const ground = () => 35;
const [low, mid, high] = BANDS;

function setup(weapon, evolution) {
  const state = createStage(parseStageOptions('?mode=survivors&t=0&seed=23'), ground);
  Object.assign(state.player, { x: 0, z: 0, altitude: mid, yaw: 0 });
  state.run.weaponLevels = { [weapon]: 7 };
  state.run.evolutions = { [weapon]: evolution };
  return state;
}

function contact(state, x, z, alt = mid) {
  const enemy = makeEnemy(state, x, z, 1, 'patrol', alt - mid);
  enemy.hp = 12;
  state.enemies.push(enemy);
  return enemy;
}

function projectiles(state, count) {
  for (let tick = 0; tick < count; tick++) {
    const present = state.shots.length;
    for (let i = 0; i < present; i++) advanceRangedShot(state, state.shots[i], ground);
    state.shots = state.shots.filter(shot => shot.life > 0);
    state.tick++;
  }
}

test('Swarm Rack launches twelve rockets for an engaged carrier and fits two volleys in the pool', () => {
  const state = setup('seeker', 'swarm-rack');
  contact(state, 0, 35);
  const carrier = contact(state, 2, 97, high);
  carrier.carrier = 'coast-supply';
  const incoming = contact(state, 0, 52);
  incoming.carrier = 'first-evolution';
  incoming.entry = {};

  advanceRangedWeapons(state, ground);
  assert.equal(state.shots.length, 12);
  assert.ok(state.shots.every(shot => shot.targetId === carrier.id));
  state.tick = state.weaponFireAt.seeker;
  advanceRangedWeapons(state, ground);
  assert.equal(state.shots.length, 24);
  state.tick = state.weaponFireAt.seeker;
  advanceRangedWeapons(state, ground);
  assert.equal(state.shots.length, 24);
});

test('Prism Lance charges and strikes along a terrain-clipped three-ray 3D fan', () => {
  const state = setup('rail', 'prism-lance');
  state.player.altitude = mid + 8;
  const sourceAltitude = state.player.altitude;
  const leading = contact(state, 0, 69, sourceAltitude);
  const overlapping = contact(state, 0, 10, sourceAltitude);
  overlapping.hp = 500;
  const wrongHeight = contact(state, 0, 69, sourceAltitude + 80);
  const behindWall = contact(state, 0, 130, sourceAltitude);
  const flyingIn = contact(state, 0, 65, sourceAltitude);
  flyingIn.entry = {};
  const ridge = (_, z) => z >= 83 && z <= 96 ? 150 : 35;
  advanceRangedWeapons(state, ridge);
  assert.equal(state.railChargeAt, 54);
  const charges = state.weaponFx.filter(fx => fx.kind === 'rail-charge');
  assert.equal(charges.length, 3);
  assert.deepEqual(charges.map(fx => fx.from.alt), [sourceAltitude, sourceAltitude, sourceAltitude]);
  assert.equal(new Set(charges.map(fx => `${fx.to.x}:${fx.to.z}:${fx.to.alt}`)).size, 3);

  state.tick = state.railChargeAt;
  advanceRangedWeapons(state, ridge);
  assert.ok(leading.hp < 12);
  assert.equal(wrongHeight.hp, 12);
  assert.equal(behindWall.hp, 12);
  assert.equal(flyingIn.hp, 12);
  const beams = state.weaponFx.filter(fx => fx.kind === 'rail-beam');
  assert.equal(beams.length, 3);
  assert.deepEqual(beams.map(beam => beam.from.alt), [sourceAltitude, sourceAltitude, sourceAltitude]);
  assert.ok(beams.every(beam => beam.to.z < behindWall.z));
  const afterglows = state.weaponFx.filter(fx => fx.kind === 'rail-glow');
  assert.equal(afterglows.length, 3);
  assert.ok(afterglows.every(glow => pointSegmentDistanceSquared3d(overlapping, glow.from, glow.to)
    <= (glow.radius + 6) ** 2), 'the target overlaps all three afterglow beams');
  const afterDirectHit = overlapping.hp;
  state.tick++;
  advanceRangedWeapons(state, ridge);
  assert.equal(overlapping.hp, afterDirectHit - afterglows[0].damage,
    'overlapping Prism afterglows damage a target only once per volley');
  assert.strictEqual(afterglows[0].hits, afterglows[1].hits);
  assert.strictEqual(afterglows[1].hits, afterglows[2].hits);
});

test('Skybreaker damages the bounded 3D blast volume and launches one generation of three secondary shells', () => {
  const state = setup('flak', 'skybreaker');
  const range = scaleTravel(90);
  const stacked = [mid - 12, mid, mid + 12].map(alt => contact(state, 0, range, alt));
  const wing = contact(state, scaleTravel(35), scaleTravel(99), mid + 8);
  const incoming = contact(state, 0, scaleTravel(87), mid + 8);
  incoming.entry = {};
  advanceRangedWeapons(state, ground);
  projectiles(state, 36);
  assert.ok(stacked.every(enemy => enemy.hp < 12));
  assert.equal(incoming.hp, 12);
  assert.equal(wing.hp, 12);
  assert.equal(state.shots.length, 3);
  assert.ok(state.shots.every(shot => shot.kind === 'flak-shell' && shot.skybreaker === 'secondary'));
  const blast = state.weaponFx.find(fx => fx.kind === 'flak-blast');
  assert.equal(blast.from.alt, state.player.altitude);
  assert.ok(blast.radius > 0);
  projectiles(state, 36);
  assert.ok(wing.hp < 12);
  assert.equal(incoming.hp, 12);
  assert.equal(state.shots.length, 0);
  assert.equal(state.weaponFx.filter(fx => fx.kind === 'flak-blast').length, 4);
});

test('Skybreaker reaches a continuous-height Ace only when the shot has its lock', () => {
  for (const ready of [false, true]) {
    const state = setup('flak', 'skybreaker');
    const ace = state.boss = makeAce(state, 0, scaleTravel(90));
    ace.alt = state.player.altitude + 15;
    state.lock = { id: ace.id, ready };
    advanceRangedWeapons(state, ground);
    assert.equal(state.shots.length, Number(ready));
    projectiles(state, 36);
    assert.equal(ace.hp < ace.maxHp, ready);
  }
});

test('Storm Crown strikes at uncollected salvage and retains the normal orb reward', () => {
  const state = setup('arc', 'storm-crown');
  const source = { id: 501, x: 4, z: 94, alt: low, xp: 3, born: 0 };
  state.pickups.push(source);
  const victim = contact(state, 7, 103, low);
  const wrongBand = contact(state, 6, 102, high);
  const approaching = contact(state, 7, 100, low);
  approaching.entry = {};
  advanceRangedWeapons(state, ground);
  assert.ok(victim.hp < 12);
  assert.equal(wrongBand.hp, 12);
  assert.equal(approaching.hp, 12);
  assert.deepEqual(state.pickups, [source]);
  const link = state.weaponFx.find(fx => fx.kind === 'arc-link');
  assert.equal(link.to.alt, low);
  assert.equal(link.to.z, source.z);
  assert.ok(link.from.alt > link.to.alt);
  assert.ok(state.weaponFireAt.arc > state.tick);
});

test('three Ordnance weapons extend a missile explosion by twenty percent', () => {
  const state = setup('seeker', 'swarm-rack');
  state.run.weaponLevels['bomb-bay'] = 1;
  state.run.weaponLevels.phoenix = 1;
  contact(state, 0, 86);
  advanceRangedWeapons(state, ground);
  assert.ok(state.shots.length > 0);
  assert.ok(state.shots.every(shot => Math.abs(shot.radius - scaleTravel(19.2) * 1.2) < 1e-9));
});

test('three Ballistic weapons let a flak fragment penetrate two contacts once apiece', () => {
  const state = setup('flak');
  state.run.weaponLevels = { twin: 1, pods: 1, flak: 5 };
  contact(state, 0, scaleTravel(89));
  advanceRangedWeapons(state, ground);
  projectiles(state, 36);
  const shard = state.shots.find(shot => shot.kind === 'flak-shard');
  assert.ok(shard);
  state.shots = [shard];
  state.enemies = [];
  const first = contact(state, shard.x, shard.z + scaleTravel(5));
  const second = contact(state, shard.x, shard.z + scaleTravel(16));
  const third = contact(state, shard.x, shard.z + scaleTravel(27));
  projectiles(state, 18);
  const damage = weaponDamage(state, 'flak', WEAPONS.flak.tuning.fragmentDamage);
  assert.ok(Math.abs(first.hp - (12 - damage)) < 1e-9);
  assert.ok(Math.abs(second.hp - (12 - damage)) < 1e-9);
  assert.equal(third.hp, 12);
});
