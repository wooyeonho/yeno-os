import test from 'node:test';
import assert from 'node:assert/strict';
import { GRADES, gradeSkill, growthOverview } from '../lib/growth.mjs';

const hash = n => n.toString(16).padStart(64, '0');
function registryWith({ activated = false, runs = [], rollbacks = [] } = {}) {
  const entry = { id: 'demo-skill', versions: [{ hash: hash(1) }], activeHash: activated ? hash(1) : null, previousHash: null };
  const history = [
    ...runs.map((run, i) => ({ at: run.at, action: 'run', id: 'demo-skill', hash: hash(1), runId: 'run-' + i, inputSha256: run.inputSha256, outputSha256: hash(900 + i) })),
    ...rollbacks.map((at, i) => ({ at, action: 'rollback', id: 'demo-skill', hash: hash(1), runId: null, inputSha256: null, outputSha256: null })),
  ];
  return { version: 1, entries: [entry], history };
}

test('an imported but never-activated skill is E, blocked on activation', () => {
  const registry = registryWith({ activated: false });
  const result = gradeSkill(registry, 'demo-skill');
  assert.equal(result.grade, 'E');
  assert.equal(result.nextGrade, 'D');
  assert.match(result.blockedReason, /활성화된/);
});

test('an activated skill with no real run stays E, not D', () => {
  const registry = registryWith({ activated: true, runs: [] });
  const result = gradeSkill(registry, 'demo-skill');
  assert.equal(result.grade, 'E');
  assert.match(result.blockedReason, /실행 기록이 없습니다/);
});

test('one real run after activation reaches D', () => {
  const registry = registryWith({ activated: true, runs: [{ at: '2026-09-14T00:00:00.000Z', inputSha256: hash(2) }] });
  const result = gradeSkill(registry, 'demo-skill');
  assert.equal(result.grade, 'D');
  assert.equal(result.nextGrade, 'C');
});

test('replaying the same input twice does not count as reuse - stays D', () => {
  const registry = registryWith({ activated: true, runs: [
    { at: '2026-09-14T00:00:00.000Z', inputSha256: hash(2) },
    { at: '2026-09-14T00:05:00.000Z', inputSha256: hash(2) },
  ] });
  const result = gradeSkill(registry, 'demo-skill');
  assert.equal(result.grade, 'D');
  assert.match(result.blockedReason, /동일 입력 재실행은 재사용으로 인정하지 않습니다/);
});

test('two genuinely different inputs reach C', () => {
  const registry = registryWith({ activated: true, runs: [
    { at: '2026-09-14T00:00:00.000Z', inputSha256: hash(2) },
    { at: '2026-09-14T00:05:00.000Z', inputSha256: hash(3) },
  ] });
  const result = gradeSkill(registry, 'demo-skill');
  assert.equal(result.grade, 'C');
  assert.equal(result.nextGrade, 'B');
  // No rollback exists yet, so the recovery half of B is what's missing first.
  assert.match(result.blockedReason, /복구/);
});

test('B stays blocked on composition tracking even once recovery is proven', () => {
  const registry = registryWith({
    activated: true,
    runs: [
      { at: '2026-09-14T00:00:00.000Z', inputSha256: hash(2) },
      { at: '2026-09-14T00:05:00.000Z', inputSha256: hash(3) },
      { at: '2026-09-14T00:20:00.000Z', inputSha256: hash(4) }, // after the rollback below
    ],
    rollbacks: ['2026-09-14T00:10:00.000Z'],
  });
  const result = gradeSkill(registry, 'demo-skill');
  assert.equal(result.grade, 'C', 'recovery alone is not enough - composition is still untracked');
  assert.equal(result.nextGrade, 'B');
  assert.match(result.blockedReason, /조합/);
  assert.equal(result.evidence.rollbackCount, 1);
});

test('A and S are unreachable today no matter what evidence is supplied, and say why', () => {
  const registry = registryWith({
    activated: true,
    runs: [
      { at: '2026-09-14T00:00:00.000Z', inputSha256: hash(2) },
      { at: '2026-09-14T00:05:00.000Z', inputSha256: hash(3) },
      { at: '2026-09-14T00:20:00.000Z', inputSha256: hash(4) },
    ],
    rollbacks: ['2026-09-14T00:10:00.000Z'],
  });
  const outcomes = [{ ledger: 'wealth', verification: 'independent_audit' }]; // even a hypothetical externally-verified outcome
  const result = gradeSkill(registry, 'demo-skill', { outcomes });
  assert.equal(result.grade, 'C');
  assert.equal(result.checks.A.met, false);
  assert.equal(result.checks.S.met, false);
  assert.match(result.checks.A.reason, /B 단계를 먼저/);
});

test('growthOverview aggregates per-grade counts across every skill in a registry', () => {
  const registry = {
    version: 1,
    entries: [
      { id: 'a', versions: [{ hash: hash(1) }], activeHash: null, previousHash: null },
      { id: 'b', versions: [{ hash: hash(2) }], activeHash: hash(2), previousHash: null },
      { id: 'c', versions: [{ hash: hash(3) }], activeHash: hash(3), previousHash: null },
    ],
    history: [
      { at: '2026-09-14T00:00:00.000Z', action: 'run', id: 'b', hash: hash(2), runId: 'r1', inputSha256: hash(10), outputSha256: hash(11) },
      { at: '2026-09-14T00:00:00.000Z', action: 'run', id: 'c', hash: hash(3), runId: 'r2', inputSha256: hash(10), outputSha256: hash(11) },
      { at: '2026-09-14T00:05:00.000Z', action: 'run', id: 'c', hash: hash(3), runId: 'r3', inputSha256: hash(20), outputSha256: hash(21) },
    ],
  };
  const overview = growthOverview(registry, 'capability');
  assert.equal(overview.total, 3);
  assert.equal(overview.counts.E, 1); // 'a' - never activated
  assert.equal(overview.counts.D, 1); // 'b' - one run, same-input reuse not attempted
  assert.equal(overview.counts.C, 1); // 'c' - two distinct-input runs
  assert.equal(GRADES.length, 6);
});
