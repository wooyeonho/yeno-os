import test from 'node:test';
import assert from 'node:assert/strict';
import {executionsFromState, interventionsFromState, levelingHistoriesFromState, levelingEvidenceSummary} from '../lib/leveling-evidence.mjs';
import {sha256} from '../lib/outcome-verification.mjs';

const uuid = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const at = i => `2026-09-${String(10 + i).padStart(2, '0')}T00:00:00.000Z`;
const h = s => sha256(s);
const run = (id, i, input, output) => ({at: at(i), action: 'run', id, hash: h('v'), runId: uuid(i), inputSha256: h(input), outputSha256: h(output)});
const rollback = (id, i) => ({at: at(i), action: 'rollback', id, hash: h('v'), runId: null, inputSha256: null, outputSha256: null});

// A capability job as the store persists it: input hash bound in
// capabilityRequest, artifact refs resolved through state.artifacts.
function job(i, id, input, output, {status = 'completed', questId = null, autopilot = false, pauseReason, artifactOutput = output} = {}) {
  const artId = `art-${i}`;
  return {
    job: {id: uuid(i), type: 'capability', status, questId, autopilot, ...(pauseReason ? {pauseReason} : {}), createdAt: at(i), updatedAt: at(i),
      capabilityRequest: {id, inputSha256: h(input)}, artifacts: output ? [{id: artId, name: 'out.json'}] : []},
    artifact: output ? [artId, {id: artId, name: 'out.json', sha256: h(artifactOutput), bytes: 1, jobId: uuid(i)}] : null
  };
}
function state(jobs, history, quests = []) {
  const s = {jobs: [], artifacts: {}, quests, capabilities: {version: 1, entries: [{id: 'triage'}, {id: 'digest'}], history}, codeWorkshop: {version: 1, entries: [], history: []}};
  for (const {job: j, artifact} of jobs) {s.jobs.push(j); if (artifact) s.artifacts[artifact[0]] = artifact[1];}
  return s;
}
const loopQuest = (qi, jobI, authorizedBy) => ({id: uuid(qi), loop: {jobId: uuid(jobI), authorizedBy, capabilityId: 'digest'}});

test('executions: executionVerified is recomputed from artifact SHA vs run record, never from a job flag; authorizedBy from quest loop', () => {
  const s = state([
    job(1, 'triage', 'jobs-a', 'triage-out-a'),
    job(2, 'digest', 'triage-out-a', 'digest-out-a', {questId: uuid(900)}),
    job(3, 'digest', 'ledger-b', 'digest-out-b', {artifactOutput: 'tampered'}),
    job(4, 'digest', 'ledger-c', null),
    job(5, 'digest', 'ledger-d', 'digest-out-d', {status: 'failed'}),
    job(6, 'digest', 'ledger-e', 'digest-out-e', {status: 'running'})
  ], [run('triage', 1, 'jobs-a', 'triage-out-a'), run('digest', 2, 'triage-out-a', 'digest-out-a'), run('digest', 3, 'ledger-b', 'digest-out-b')],
  [loopQuest(900, 2, 'autopilot')]);
  s.jobs[0].executionVerified = true;
  const ex = executionsFromState(s, 'capability');
  assert.deepEqual(ex.map(e => [e.jobId.slice(0, 8), e.status, e.executionVerified, e.authorizedBy]), [
    ['00000001', 'completed', true, 'owner'],
    ['00000002', 'completed', true, 'autopilot'],
    ['00000003', 'completed', false, 'owner'],
    ['00000004', 'completed', false, 'owner'],
    ['00000005', 'failed', false, 'owner']
  ]);
  assert.equal(ex.length, 5, 'running job is not evidence');
  assert.deepEqual(executionsFromState(s, 'code'), []);
  assert.throws(() => executionsFromState(s, 'voice'), TypeError);
});

test('interventions: cancelled → stop, owner pause → pause, post-run rollback → rollback; system pauses are not interventions', () => {
  const s = state([
    job(1, 'digest', 'a', 'x', {status: 'cancelled'}),
    job(2, 'digest', 'b', 'y', {status: 'paused', pauseReason: 'owner'}),
    job(3, 'digest', 'c', 'z', {status: 'paused', pauseReason: 'restart'}),
    job(4, 'digest', 'd', 'w'),
    job(5, 'digest', 'e', 'v')
  ], [run('digest', 4, 'd', 'w'), rollback('digest', 6), run('digest', 7, 'e', 'v')]);
  s.jobs[4].id = uuid(7); s.artifacts['art-5'].jobId = uuid(7);
  const iv = interventionsFromState(s, 'capability');
  assert.deepEqual(iv.map(i => [i.jobId.slice(0, 8), i.kind, i.by]), [['00000001', 'stop', 'owner'], ['00000002', 'pause', 'owner'], ['00000004', 'rollback', 'owner']]);
  assert.equal(iv.find(i => i.kind === 'rollback').at, at(6));
});

test('B/A from state: composition = digest consumed triage output; A needs 3 autopilot verified successes with zero interventions; S stays blocked', () => {
  const jobs = [
    job(1, 'triage', 'jobs-a', 'triage-out-a'),
    job(2, 'digest', 'triage-out-a', 'digest-out-a', {questId: uuid(902)}),
    job(3, 'digest', 'ledger-b', 'digest-out-b', {questId: uuid(903)}),
    job(4, 'digest', 'ledger-c', 'digest-out-c', {questId: uuid(904)}),
    job(5, 'digest', 'ledger-d', 'digest-out-d', {questId: uuid(905)})
  ];
  const history = [run('triage', 1, 'jobs-a', 'triage-out-a'), run('digest', 2, 'triage-out-a', 'digest-out-a'), run('digest', 3, 'ledger-b', 'digest-out-b'), run('digest', 4, 'ledger-c', 'digest-out-c'), run('digest', 5, 'ledger-d', 'digest-out-d')];
  const quests = [loopQuest(902, 2, 'owner'), loopQuest(903, 3, 'autopilot'), loopQuest(904, 4, 'autopilot'), loopQuest(905, 5, 'autopilot')];
  const s = state(jobs, history, quests);
  const hs = levelingHistoriesFromState(s, 'capability');
  const digest = hs.find(x => x.skillId === 'digest');
  assert.equal(digest.grade, 'A');
  assert.equal(digest.compositions[0].upstreamSkillId, 'triage');
  assert.equal(digest.compositions[0].upstreamJobId, uuid(1));
  assert.equal(digest.checks.S.met, false);
  assert.match(digest.checks.S.reason, /external_verified/);
  assert.equal(hs.find(x => x.skillId === 'triage').grade, 'D');
  const summary = levelingEvidenceSummary(hs);
  assert.deepEqual(summary.skills.find(x => x.skillId === 'digest').A.autonomousVerified, [uuid(3), uuid(4), uuid(5)]);

  // One owner intervention on an autopilot job drops A (2 autonomous left), history demotes with trail.
  const s2 = state(jobs, [...history, rollback('digest', 6)], quests);
  const prev = Object.fromEntries(hs.map(x => [x.skillId, x]));
  const digest2 = levelingHistoriesFromState(s2, 'capability', {previous: prev}).find(x => x.skillId === 'digest');
  assert.equal(digest2.grade, 'B');
  assert.deepEqual(digest2.promotions.map(p => [p.from, p.to, p.kind]), [['E', 'A', 'promotion'], ['A', 'B', 'demotion']]);

  // Tampered artifact for the composition job removes B (and A) — nothing is kept on a claim.
  const s3 = state(jobs.map((j, i) => i === 1 ? job(2, 'digest', 'triage-out-a', 'digest-out-a', {questId: uuid(902), artifactOutput: 'forged'}) : j), history, quests);
  assert.equal(levelingHistoriesFromState(s3, 'capability').find(x => x.skillId === 'digest').grade, 'C');

  // Tampered previous history fails closed.
  assert.throws(() => levelingHistoriesFromState(s, 'capability', {previous: {digest: {...digest, grade: 'S'}}}), e => e.code === 'LEVELING_TAMPERED');

  // Restart-safe: same state → identical fingerprints.
  assert.deepEqual(levelingHistoriesFromState(s, 'capability').map(x => x.fingerprint), hs.map(x => x.fingerprint));
});
