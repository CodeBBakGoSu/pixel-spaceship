import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildBaseline, BASELINE_SEED, BASELINE_TICKS, renderKoreanReport, simulateFixture } from '../tools/p0-weapon-baseline.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

test('baseline fixtures preserve one Lv4 weapon, 900 ticks and deterministic matched comparisons', () => {
  const callerCwd = process.cwd();
  let baseline;
  try {
    process.chdir(homedir());
    baseline = buildBaseline({ seed: BASELINE_SEED, verifyRepeatability: true });
  } finally {
    process.chdir(callerCwd);
  }
  assert.equal(baseline.interpretation, 'BASELINE ONLY / not P0 final');
  assert.equal(baseline.source.commitLabel, 'runtime HEAD');
  assert.equal(baseline.source.commit, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim());
  assert.match(baseline.source.srcTreeSha256, /^[a-f0-9]{64}$/);
  assert.equal(baseline.source.harnessSha256, createHash('sha256')
    .update(readFileSync(new URL('../tools/p0-weapon-baseline.mjs', import.meta.url))).digest('hex'));
  assert.equal(baseline.fixtures.length, 31);
  assert.ok(baseline.fixtures.every(fixture => fixture.ticksRun === BASELINE_TICKS && fixture.durationSeconds === 15));
  assert.ok(baseline.fixtures.every(fixture => fixture.weaponLevel === 4));
  assert.ok(baseline.fixtures.every(fixture => Number.isSafeInteger(fixture.emittedProjectileCount)
    && Object.values(fixture.emittedProjectilesByWeapon).reduce((sum, count) => sum + count, 0) === fixture.emittedProjectileCount));
  assert.ok(baseline.fixtures.every(fixture => fixture.saturation.completeClear
    === (fixture.targetCount > 0 && fixture.killedTargets === fixture.targetCount)));
  assert.ok(baseline.fixtures.some(fixture => fixture.saturation.completeClear));

  for (const group of ['primary-forward', 'primary-stings', 'primary-ace-near', 'primary-ace-middle', 'primary-ace-far']) {
    const matched = baseline.fixtures.filter(fixture => fixture.group === group);
    assert.equal(matched.length, 3, group);
    assert.equal(new Set(matched.map(fixture => fixture.playerPathSha256)).size, 1, group);
    assert.equal(new Set(matched.map(fixture => fixture.targetPlanSha256)).size, 1, group);
  }

  const rolePairs = baseline.fixtures.filter(fixture => fixture.pairGroup && fixture.pairGroup.startsWith('role-'));
  assert.equal(new Set(rolePairs.map(fixture => fixture.pairGroup)).size, 7);
  const aceFixtures = baseline.fixtures.filter(fixture => fixture.kind === 'vulnerable-ready-locked-ace');
  assert.equal(aceFixtures.length, 9);
  assert.ok(aceFixtures.every(fixture => fixture.ace.lockReadyTicks === BASELINE_TICKS && !fixture.ace.depleted));
  assert.ok(aceFixtures.every(fixture => fixture.ace.successfulHitCount === fixture.targetAudit[0].successfulHitCount
    && fixture.ace.actualCappedHpReduction === fixture.targetAudit[0].actualDamage));
  assert.ok(aceFixtures.some(fixture => fixture.ace.successfulHitCount > 0));
  assert.ok(baseline.fixtures.filter(fixture => fixture.group === 'primary-ace-far')
    .every(fixture => fixture.metricScope === 'range/flight diagnostic; not common-effective-range acceptance'));
  const arcPair = baseline.fixtures.filter(fixture => fixture.pairGroup === 'role-arc');
  assert.equal(arcPair.length, 2);
  assert.ok(arcPair.every(fixture => fixture.comparisonMode === 'qualitative-chain-coverage-not-matched-damage'));
  assert.ok(baseline.fixtures.some(fixture => fixture.id === 'phoenix-rear' && fixture.automaticFlareCount > 0));
  assert.ok(baseline.fixtures.some(fixture => fixture.id === 'bomb-bay-below' && fixture.automaticBombCount > 0));
  const lockPair = baseline.fixtures.filter(fixture => fixture.pairGroup === 'seeker-lock-diagnostic');
  assert.equal(lockPair.length, 2);
  assert.equal(lockPair.find(fixture => fixture.ace.lockPolicy === 'ready').ace.naturallyReadyLockTicks, BASELINE_TICKS);
  assert.ok(lockPair.find(fixture => fixture.ace.lockPolicy === 'suppressed').ace.naturallyReadyLockTicks > 0);
  assert.equal(lockPair.find(fixture => fixture.ace.lockPolicy === 'suppressed').ace.lockReadyTicks, 0);
  assert.ok(lockPair.find(fixture => fixture.ace.lockPolicy === 'ready').ace.actualCappedHpReduction
    > lockPair.find(fixture => fixture.ace.lockPolicy === 'suppressed').ace.actualCappedHpReduction);
  assert.ok(baseline.fixtures.every(fixture => fixture.targetAudit.every(target =>
    target.actualDamage === target.initialHp - target.finalHp && target.finalHp >= 0)));
  assert.match(renderKoreanReport(baseline, '/artifacts/raw.json'), /BASELINE ONLY \/ P0 최종 검증 아님/);
  assert.match(renderKoreanReport(baseline, '/artifacts/raw.json'), /## 역할 강점\/약점 증거/);
  assert.match(renderKoreanReport(baseline, '/artifacts/raw.json'), /CEILING SATURATED; not a meaningful tie/);
  assert.match(renderKoreanReport(baseline, '/artifacts/raw.json'), /Ace 성공 명중/);
  assert.match(renderKoreanReport(baseline, '/artifacts/raw.json'), /range\/flight diagnostic; not acceptance/);
  assert.match(renderKoreanReport(baseline, '/artifacts/raw.json'), /정량 피해 비교 아님/);
  assert.match(renderKoreanReport(baseline, '/artifacts/raw.json'), /자동 플레어/);
  assert.match(renderKoreanReport(baseline, '/artifacts/raw.json'), /자동 폭탄/);
});

test('empty target fixture still runs the complete baseline window', () => {
  const result = simulateFixture({ id: 'empty', durationTicks: BASELINE_TICKS, targets: [] }, 'twin', BASELINE_SEED);
  assert.equal(result.ticksRun, BASELINE_TICKS);
  assert.equal(result.targetCount, 0);
  assert.equal(result.targetDamage, 0);
  assert.equal(result.emittedProjectileCount, 0);
  assert.equal(result.saturation.completeClear, false);
  assert.deepEqual(result.targetAudit, []);
});

test('fixture validation rejects unknown weapons and duplicate target IDs', () => {
  const empty = { id: 'invalid', durationTicks: BASELINE_TICKS, targets: [] };
  assert.throws(() => simulateFixture(empty, 'not-a-weapon', BASELINE_SEED), /Unknown weapon/);
  const duplicate = {
    ...empty,
    targets: [
      { id: 'same', kind: 'patrol', motion: 'fixed-ahead', spawnTick: 1, x: 0, forwardOffset: 100, alt: 125 },
      { id: 'same', kind: 'patrol', motion: 'fixed-ahead', spawnTick: 2, x: 0, forwardOffset: 100, alt: 125 },
    ],
  };
  assert.throws(() => simulateFixture(duplicate, 'twin', BASELINE_SEED), /duplicate target IDs/);
});
