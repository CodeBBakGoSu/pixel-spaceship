import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAce } from '../src/ace.ts';
import { skimAltitude, SKIM_BAND } from '../src/bands.ts';
import { scaleTravel } from '../src/data/speed.ts';
import { WEAPONS } from '../src/data/items.ts';
import { weaponDamage } from '../src/loadout.ts';
import { advanceRangedShot, advanceRangedWeapons } from '../src/ranged-weapons.ts';
import { BANDS } from '../src/stage-combat.ts';
import { makeEnemy } from '../src/stage-enemies.ts';
import { createStage, parseStageOptions } from '../src/stage.ts';

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

test('Prism Lance charges and strikes along exactly one terrain-clipped ray per band', () => {
  const state = setup('rail', 'prism-lance');
  state.player.altitude = mid + 8;
  const altitudes = [...BANDS, 49];
  const leading = altitudes.map(alt => contact(state, 0, 69, alt));
  const obscuredLow = contact(state, 0, 130, low);
  const flyingIn = contact(state, 0, 65, high);
  flyingIn.entry = {};
  const ridge = (_, z) => z >= 83 && z <= 96 ? 99 : 35;
  advanceRangedWeapons(state, ridge);
  assert.equal(state.railChargeAt, 54);
  assert.deepEqual(state.weaponFx.filter(fx => fx.kind === 'rail-charge').map(fx => fx.from.alt), altitudes);

  state.tick = state.railChargeAt;
  advanceRangedWeapons(state, ridge);
  assert.ok(leading.every(enemy => enemy.hp < 12));
  assert.equal(obscuredLow.hp, 12);
  assert.equal(flyingIn.hp, 12);
  const beams = state.weaponFx.filter(fx => fx.kind === 'rail-beam');
  assert.deepEqual(beams.map(beam => beam.from.alt), altitudes);
  assert.ok(beams[0].to.z < beams[1].to.z);
});

test('Skybreaker bursts through all four bands and launches one generation of three secondary shells', () => {
  const state = setup('flak', 'skybreaker');
  const range = scaleTravel(90);
  const stacked = BANDS.map(alt => contact(state, 0, range, alt));
  Object.assign(contact(state, 0, range, 65), { kind: 'skimmer', skim: true });
  stacked.push(state.enemies.at(-1));
  const wing = contact(state, scaleTravel(32), scaleTravel(99), high);
  const incoming = contact(state, 0, scaleTravel(87), low);
  incoming.entry = {};
  advanceRangedWeapons(state, ground);
  projectiles(state, 36);
  assert.ok(stacked.every(enemy => enemy.hp < 12));
  assert.equal(incoming.hp, 12);
  assert.equal(wing.hp, 12);
  assert.equal(state.shots.length, 3);
  assert.ok(state.shots.every(shot => shot.kind === 'flak-shell' && shot.skybreaker === 'secondary'));
  const blast = state.weaponFx.find(fx => fx.kind === 'flak-blast');
  assert.equal(blast.from.alt, mid);
  assert.ok(blast.halfHeight >= high - mid);
  projectiles(state, 36);
  assert.ok(wing.hp < 12);
  assert.equal(incoming.hp, 12);
  assert.equal(state.shots.length, 0);
  assert.equal(state.weaponFx.filter(fx => fx.kind === 'flak-blast').length, 4);
});

test('Skybreaker reaches a skimming Ace only when the shot has its lock', () => {
  for (const ready of [false, true]) {
    const state = setup('flak', 'skybreaker');
    const ace = state.boss = makeAce(state, 0, scaleTravel(90));
    ace.band = SKIM_BAND;
    ace.alt = skimAltitude(ground());
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
