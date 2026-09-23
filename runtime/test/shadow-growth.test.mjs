import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {shadowGrowthFromState, shadowGrowthEventsFromState, levelForXp, xpForNextLevel, SHADOW_XP_BY_ROLE, SHADOW_GROWTH_VERSION} from '../lib/shadow-growth.mjs';

// F06 — Shadow XP/level is derived only from missions whose semantic verdict
// still resolves; keyed per (mission, job) so nothing is rewarded twice.

const at = () => '2026-09-01T00:00:00.000Z';
const job = (id, o = {}) => ({id, status: 'completed', updatedAt: at(), createdAt: at(), artifacts: [], ...o});

function mission({verdict = 'pass', deterministic = true, withResearcher = true, createdAt = at()} = {}) {
  const missionId = randomUUID(), builderId = randomUUID(), verifierId = randomUUID(), semanticId = randomUUID(), researcherId = randomUUID(), artifactId = randomUUID();
  const jobs = [
    job(builderId, {artifacts: [{id: artifactId, name: 'a.md'}], shadowAssignment: {missionId, role: 'builder', dependsOnJobIds: withResearcher ? [researcherId] : []}}),
    job(verifierId, {type: 'verify', verifyResult: {verified: deterministic, reasons: [], subjects: []}, shadowAssignment: {missionId, role: 'verifier'}}),
    job(semanticId, {type: 'agent', semanticVerifyRequest: {missionId, builderJobId: builderId, verifierJobId: verifierId, plannerQuestId: null}, shadowAssignment: {missionId, role: 'semanticVerifier'},
      semanticVerdict: {version: 1, missionId, plannerQuestId: null, builderJobId: builderId, verifierJobId: verifierId, artifactRefs: [artifactId], verdict, confidence: 0.9, criteria: [], summary: 's', provider: 'openai', model: 'm', createdAt}}),
  ];
  if (withResearcher) jobs.push(job(researcherId, {shadowAssignment: {missionId, role: 'researcher'}}));
  const artifacts = {[artifactId]: {id: artifactId, name: 'a.md', filename: `${artifactId}.md`, sha256: 'e'.repeat(64), bytes: 1, jobId: builderId}};
  return {missionId, artifactId, jobs, artifacts};
}
const stateOf = (...missions) => ({jobs: missions.flatMap(m => m.jobs), artifacts: Object.assign({}, ...missions.map(m => m.artifacts)), quests: [], projects: [], memoryEvents: []});
const roleOf = (g, role) => g.roles.find(r => r.role === role);

test('level function boundaries are documented and monotonic; level never carries authority', () => {
  assert.equal(levelForXp(0), 0); assert.equal(levelForXp(9), 0); assert.equal(levelForXp(10), 1); assert.equal(levelForXp(39), 1); assert.equal(levelForXp(40), 2); assert.equal(levelForXp(90), 3);
  assert.equal(xpForNextLevel(0), 10); assert.equal(xpForNextLevel(10), 40); assert.equal(xpForNextLevel(45), 90);
  assert.equal(shadowGrowthFromState({jobs: []}).rules.grantsAuthority, false);
});

test('a verified mission rewards each completed role once with the v1 amounts; empty state rewards nothing', () => {
  assert.deepEqual(shadowGrowthFromState({jobs: []}).roles.map(r => r.xp), [0, 0, 0, 0, 0]);
  const g = shadowGrowthFromState(stateOf(mission()));
  assert.equal(g.version, SHADOW_GROWTH_VERSION);
  assert.equal(roleOf(g, 'builder').xp, SHADOW_XP_BY_ROLE.builder);
  assert.equal(roleOf(g, 'researcher').xp, SHADOW_XP_BY_ROLE.researcher);
  assert.equal(roleOf(g, 'verifier').xp, SHADOW_XP_BY_ROLE.verifier);
  assert.equal(roleOf(g, 'semanticVerifier').xp, SHADOW_XP_BY_ROLE.semanticVerifier);
  assert.equal(roleOf(g, 'scout').xp, 0);
  assert.equal(roleOf(g, 'builder').level, 1); assert.equal(roleOf(g, 'builder').verifiedMissions, 1);
  assert.equal(g.held.length, 0);
});

test('semantic fail/uncertain or deterministic fail award 0 XP and are recorded as failures, never negative', () => {
  for (const opts of [{verdict: 'fail'}, {verdict: 'uncertain'}, {deterministic: false}]) {
    const g = shadowGrowthFromState(stateOf(mission(opts)));
    assert.ok(g.roles.every(r => r.xp === 0 && r.level === 0), JSON.stringify(opts));
    const builder = roleOf(g, 'builder');
    if (opts.deterministic === false) assert.equal(builder.heldMissions, 1, 'a pass that no longer resolves is held, not counted');
    else assert.equal(builder.failedMissions, 1);
  }
});

test('re-derivation, duplicated jobs and a re-run verifier for the same mission never add XP; a second mission does', () => {
  const m1 = mission();
  const once = shadowGrowthFromState(stateOf(m1));
  const twice = shadowGrowthFromState(stateOf(m1));
  assert.deepEqual(twice.roles, once.roles, 'pure function of state');
  const dup = {...stateOf(m1), jobs: [...m1.jobs, ...m1.jobs]};
  assert.deepEqual(shadowGrowthFromState(dup).roles.map(r => r.xp), once.roles.map(r => r.xp), 'same (mission, job) is one event');
  const extraVerifierRun = {...stateOf(m1), jobs: [...m1.jobs, job(randomUUID(), {type: 'verify', verifyResult: {verified: true}, shadowAssignment: {missionId: m1.missionId, role: 'verifier'}})]};
  assert.equal(roleOf(shadowGrowthFromState(extraVerifierRun), 'verifier').xp, SHADOW_XP_BY_ROLE.verifier * 2, 'a second completed verifier job of the same mission is a distinct job - allowed by v1 key, so it is visible here');
  const m2 = mission({createdAt: '2026-09-02T00:00:00.000Z'});
  const both = shadowGrowthFromState(stateOf(m1, m2));
  assert.equal(roleOf(both, 'builder').xp, SHADOW_XP_BY_ROLE.builder * 2);
  assert.equal(roleOf(both, 'builder').verifiedMissions, 2);
  assert.equal(roleOf(both, 'builder').lastVerifiedAt, '2026-09-02T00:00:00.000Z');
});

test('evidence withdrawal (artifact replaced or deleted) moves the mission to held with a reason and removes its XP without erasing history', () => {
  const m = mission();
  const base = stateOf(m);
  assert.equal(roleOf(shadowGrowthFromState(base), 'builder').xp, 20);
  const replaced = {...base, artifacts: {[m.artifactId]: {...base.artifacts[m.artifactId], jobId: randomUUID()}}};
  const g = shadowGrowthFromState(replaced);
  assert.equal(roleOf(g, 'builder').xp, 0);
  assert.equal(g.held.length, 4, 'every role event of that mission is held');
  assert.equal(g.held[0].reason, 'artifact_not_registered');
  assert.equal(shadowGrowthEventsFromState(replaced).length, 4, 'events stay visible, just not counted');
  const deleted = {...base, artifacts: {}};
  assert.equal(roleOf(shadowGrowthFromState(deleted), 'builder').xp, 0);
});
