import { type HostileShape } from './data/hostile-fire.ts';
import { HOSTILE_SHOT_LIMIT, PICKUP_LIMIT, PLAYER_SHOT_LIMIT } from './data/run-balance.ts';
import { scaleTravel } from './data/speed.ts';
import { TERRAIN_STREAM } from './data/terrain-stream.ts';
import { ENEMY_KINDS, type RegularEnemyKind } from './enemy-kinds.ts';
import { BOOST_SPEED, CRUISE_SPEED } from './flight.ts';
import type { CombatEvents } from './hostile-events.ts';
import { advanceShots, BANDS, clamp, MINE_LIMIT, STEP } from './stage-combat.ts';
import { makeEnemy } from './stage-enemies.ts';
import type { Band, Ground, Shot, StageState } from './stage-types.ts';
import { makeAce, setAceTell } from './ace.ts';

const SHAPES = ['orb', 'needle', 'diamond'] as const;
const KINDS = Object.keys(ENEMY_KINDS).filter((kind): kind is RegularEnemyKind => kind !== 'gnat') as RegularEnemyKind[];
const POSE = { x: -128, z: -320, yaw: 0, bank: 0, vx: 0, vz: CRUISE_SPEED };
const STRESS_ORIGIN = { x: 6 * TERRAIN_STREAM.chunkSize - 32, z: -5.5 * TERRAIN_STREAM.chunkSize };
const FIXTURE_TICK = 24_000;
const STRESS_TICK = 26_640;

export function createHostileFixture(state: StageState, query: URLSearchParams, ground: Ground) {
  const stress = query.get('stress') === '1';
  const boostFlight = stress && query.get('flight') === 'boost';
  const cue = query.get('cue');
  const requested = query.get('shape');
  const closeup = SHAPES.find(shape => shape === requested);
  const rawAlt = Number(query.get('alt') ?? 110);
  const altitude = Number.isFinite(rawAlt) ? clamp(rawAlt, 75, 145) : 110;
  state.tick = stress ? STRESS_TICK : FIXTURE_TICK + (cue === 'shield' && query.get('blink') === '1' ? 4 : 0);
  const { player: p } = state;
  const pose = (height: number) => {
    Object.assign(p, POSE);
    if (boostFlight) Object.assign(p, STRESS_ORIGIN);
    p.altitude = height;
  };
  pose(altitude);
  state.speed = CRUISE_SPEED;

  const shot = (x: number, z: number, alt: number, vx = 0, vz = -78): Shot => ({
    x: p.x + x, z: p.z + z, alt, vx: scaleTravel(vx), vz: scaleTravel(vz), kind: 'hostile', life: 3.75,
    damage: 2, volley: 0, nearMiss: false, lockId: null,
  });

  function add(events: CombatEvents | undefined, bullet: Shot, shape: HostileShape): void {
    state.shots.push(bullet);
    events?.muzzle?.(bullet, shape, bullet.x - bullet.vx * 0.17, bullet.z - bullet.vz * 0.17, bullet.alt);
  }

  function fillStress(events?: CombatEvents): void {
    pose(110);
    if (boostFlight) {
      const turnRate = 1.7, radius = BOOST_SPEED / turnRate;
      const angle = (state.tick - STRESS_TICK) * STEP * turnRate;
      p.x += radius * (1 - Math.cos(angle));
      p.z += radius * Math.sin(angle);
      p.yaw = angle;
      p.vx = BOOST_SPEED * Math.sin(angle);
      p.vz = BOOST_SPEED * Math.cos(angle);
      p.bank = 1.2;
      state.speed = BOOST_SPEED;
      state.boosting = true;
      state.boostTicks = 32;
    }
    state.hull = state.maxHull;
    state.xp = 0;
    if (!state.boss) {
      const ace = state.boss = makeAce(state, p.x + 18, p.z + 146);
      ace.phase = 3;
      ace.hp = Math.floor(ace.maxHp / 4);
      ace.bank = 1.1;
      ace.boosting = true;
      setAceTell(state, ace, 'missile', { x: p.x, z: p.z + 40, alt: p.altitude });
    }
    let regular = 0, gnats = 0, enemyShots = 0;
    for (const enemy of state.enemies) {
      if (enemy.kind === 'gnat') gnats++;
      else regular++;
    }
    for (const bullet of state.shots) if (bullet.kind === 'hostile') enemyShots++;
    const contacts = 24;
    for (let i = regular; i < contacts; i++) {
      const x = p.x + (i % 12 - 5.5) * 21, z = p.z + (i % 4 === 0 ? -95 : 125) + i * 2;
      state.enemies.push(makeEnemy(state, x, z, (i % 3) as Band, KINDS[i % KINDS.length]));
    }
    for (let i = gnats; i < state.swarmCap; i++) {
      const x = p.x + (i % 15 - 7) * 17, z = p.z + 102 + (i * 31 % 120);
      const gnat = makeEnemy(state, x, z, (i % 3) as Band, 'gnat');
      gnat.leaveAt = state.tick + 460;
      gnat.vz = scaleTravel(-32);
      state.enemies.push(gnat);
    }
    const friendly = state.shots.length - enemyShots;
    for (let i = enemyShots; i < HOSTILE_SHOT_LIMIT; i++) {
      const bolt = shot((i % 16 - 7.5) * 13, 53 + i * 43 % 135, BANDS[i % 3], 7, -67);
      add(events, bolt, SHAPES[i % 3]);
    }
    for (let i = friendly; i < PLAYER_SHOT_LIMIT; i++) {
      state.shots.push({ ...shot((i % 19 - 9) * 11, 44 + i * 31 % 110, BANDS[i % 3], 3, 172),
        kind: i % 2 ? 'twin' : 'pods', damage: 1, volley: ++state.nextVolley });
    }
    for (let i = state.pickups.length; i < PICKUP_LIMIT; i++) {
      state.pickups.push({ x: p.x + (i % 21 - 10) * 11, z: p.z + 42 + i * 31 % 118, alt: BANDS[i % 3],
        id: ++state.nextId, xp: 1, born: state.tick });
    }
    for (let i = state.enemyMines.length; i < MINE_LIMIT; i++) {
      state.enemyMines.push({ x: p.x + (i % 8 - 3.5) * 26, z: p.z + 74 + (i * 17 % 64), alt: 110, born: state.tick });
    }
  }

  function prime(events?: CombatEvents): void {
    if (stress) {
      fillStress(events);
      return;
    }
    if (cue === 'hit') {
      add(undefined, shot(4.2, 8, altitude, -252, -480), 'needle');
      advanceShots(state, ground, events);
    } else if (cue === 'graze') {
      for (let i = 0; i < 3; i++) add(undefined, shot(7.4 + i * 0.5, 3 + i, altitude, 0, -300), 'orb');
      advanceShots(state, ground, events);
    } else if (cue === 'shield') {
      state.hull = state.maxHull - 3;
      state.invulnerability = 0.61;
    }
    if (closeup) {
      const bullet = shot(0, 38, altitude, -7, -64);
      add(events, bullet, closeup);
      add(events, shot(-13, 64, altitude + 12, 13, -63), closeup);
      add(events, shot(19, 79, altitude - 14, -16, -74), closeup);
      const source = closeup === 'orb' ? 'patrol' : closeup === 'needle' ? 'spotter' : 'bomber';
      state.enemies.push(makeEnemy(state, p.x + 2, p.z + 49, 1, source, altitude - BANDS[1]));
      events?.impact?.(bullet, p.x + 8, p.z + 31, altitude - 2);
      return;
    }
    for (let i = 0; i < 3; i++) {
      add(events, shot(i === 0 ? -10 : (i - 1) * 16, 58 + i * 10, altitude, (1 - i) * 14, -81), SHAPES[i]);
      add(events, shot((i - 1) * 12, -46 - i * 6, altitude, (1 - i) * 13, 71), SHAPES[i]);
      add(events, shot((i - 1) * 22, 107 + i * 12, BANDS[i], 10, -68), SHAPES[(i + 1) % 3]);
    }
    add(events, shot(-15, 71, altitude + 13, 14, -93), 'needle');
    add(events, shot(20, 74, altitude - 13, -11, -64), 'diamond');
    add(events, shot(-8, -44, altitude + 12, 11, 70), 'needle');
    add(events, shot(9, -42, altitude - 12, -10, 75), 'diamond');
    if (cue === 'rear' || state.view === 'chase') {
      state.rearGlimpse = { kind: 'flare', since: state.tick - 18, until: state.tick + 60 };
    }
  }

  return { stress, prime, fillStress, cue };
}
