import test from 'node:test';
import assert from 'node:assert/strict';
import {gradeSkill, growthOverview} from '../lib/growth.mjs';
import {levelingHistoriesFromState} from '../lib/leveling-evidence.mjs';
import {sha256} from '../lib/outcome-verification.mjs';

// Track C wiring: growth.mjs's B (composition) and A (autonomy) grades used
// to be permanently blocked - this proves a real solo-leveling.mjs history,
// built by leveling-evidence.mjs from ordinary job/quest/registry state (the
// same evidence readiness.mjs and server.mjs's growthState() now use), can
// actually promote a skill to B and A, and that the old no-leveling path
// (used by every pre-existing growth.test.mjs case) is untouched.
const uuid = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const at = i => `2026-09-${String(10 + i).padStart(2, '0')}T00:00:00.000Z`;
const h = s => sha256(s);
const run = (id, i, input, output) => ({at: at(i), action: 'run', id, hash: h('v'), runId: uuid(i), inputSha256: h(input), outputSha256: h(output)});

function job(i, id, input, output, {questId = null, autopilot = false} = {}) {
  const artId = `art-${i}`;
  return {
    job: {id: uuid(i), type: 'capability', status: 'completed', questId, autopilot, createdAt: at(i), updatedAt: at(i),
      capabilityRequest: {id, inputSha256: h(input)}, artifacts: [{id: artId, name: 'out.json'}]},
    artifact: [artId, {id: artId, name: 'out.json', sha256: h(output), bytes: 1, jobId: uuid(i)}]
  };
}
function stateFrom(jobs, history, quests = []) {
  const s = {jobs: [], artifacts: {}, quests, capabilities: {version: 1, entries: [{id: 'triage', versions: [{hash: h('v')}], activeHash: h('v'), previousHash: null}, {id: 'digest', versions: [{hash: h('v')}], activeHash: h('v'), previousHash: null}], history}, codeWorkshop: {version: 1, entries: [], history: []}};
  for (const {job: j, artifact} of jobs) {s.jobs.push(j); if (artifact) s.artifacts[artifact[0]] = artifact[1];}
  return s;
}
const loopQuest = (qi, jobI, authorizedBy) => ({id: uuid(qi), loop: {jobId: uuid(jobI), authorizedBy, capabilityId: 'digest'}});

test('growth.mjs gradeSkill without a leveling history stays exactly as blocked on B/A as before (no regression)',()=>{
  const registry={version:1,entries:[{id:'demo',versions:[{hash:h('v')}],activeHash:h('v'),previousHash:null}],history:[run('demo',1,'a','b'),run('demo',2,'c','d')]};
  const result=gradeSkill(registry,'demo');
  assert.equal(result.grade,'C');
  assert.equal(result.checks.B.met,false);
  assert.match(result.checks.B.reason,/복구/);
});

test('growth.mjs gradeSkill wired to a real solo-leveling history reaches B on real structural composition, and A on 3 zero-intervention autopilot successes',()=>{
  const jobs=[
    job(1,'triage','jobs-a','triage-out-a'),
    job(2,'digest','triage-out-a','digest-out-a',{questId:uuid(902)}), // composes triage's output
    job(3,'digest','ledger-b','digest-out-b',{questId:uuid(903)}),
    job(4,'digest','ledger-c','digest-out-c',{questId:uuid(904)}),
    job(5,'digest','ledger-d','digest-out-d',{questId:uuid(905)})
  ];
  const history=[run('triage',1,'jobs-a','triage-out-a'),run('digest',2,'triage-out-a','digest-out-a'),run('digest',3,'ledger-b','digest-out-b'),run('digest',4,'ledger-c','digest-out-c'),run('digest',5,'ledger-d','digest-out-d')];
  const quests=[loopQuest(902,2,'owner'),loopQuest(903,3,'autopilot'),loopQuest(904,4,'autopilot'),loopQuest(905,5,'autopilot')];
  const state=stateFrom(jobs,history,quests);
  const levelingById=Object.fromEntries(levelingHistoriesFromState(state,'capability').map(h=>[h.skillId,h]));

  const digest=gradeSkill(state.capabilities,'digest',{leveling:levelingById.digest});
  assert.equal(digest.grade,'A',JSON.stringify(digest.checks));
  assert.equal(digest.checks.B.met,true);
  assert.equal(digest.checks.A.met,true);
  assert.equal(digest.nextGrade,'S');
  assert.match(digest.blockedReason,/외부/);

  // growthOverview threads levelingById per skill id, same shape the UI reads.
  const overview=growthOverview(state.capabilities,'capability',{levelingById});
  assert.equal(overview.skills.find(s=>s.id==='digest').grade,'A');
  assert.equal(overview.counts.A,1);

  // triage itself never composed anything (nothing consumes its output before
  // it), so it should not be incorrectly promoted past D/C.
  const triage=gradeSkill(state.capabilities,'triage',{leveling:levelingById.triage});
  assert.notEqual(triage.grade,'B');
  assert.notEqual(triage.grade,'A');
});

test('an owner intervention on one of the autopilot runs drops A back to blocked, tracing to the same intervention reason solo-leveling reports',()=>{
  const jobs=[
    job(1,'triage','jobs-a','triage-out-a'),
    job(2,'digest','triage-out-a','digest-out-a',{questId:uuid(902)}),
    {...job(3,'digest','ledger-b','digest-out-b',{questId:uuid(903)}),job:{...job(3,'digest','ledger-b','digest-out-b',{questId:uuid(903)}).job,status:'cancelled'}},
    job(4,'digest','ledger-c','digest-out-c',{questId:uuid(904)}),
    job(5,'digest','ledger-d','digest-out-d',{questId:uuid(905)})
  ];
  const history=[run('triage',1,'jobs-a','triage-out-a'),run('digest',2,'triage-out-a','digest-out-a'),run('digest',4,'ledger-c','digest-out-c'),run('digest',5,'ledger-d','digest-out-d')];
  const quests=[loopQuest(902,2,'owner'),loopQuest(904,4,'autopilot'),loopQuest(905,5,'autopilot')];
  const state=stateFrom(jobs,history,quests);
  const levelingById=Object.fromEntries(levelingHistoriesFromState(state,'capability').map(h=>[h.skillId,h]));
  const digest=gradeSkill(state.capabilities,'digest',{leveling:levelingById.digest});
  assert.equal(digest.checks.A.met,false);
  assert.match(digest.checks.A.reason,/개입/);
});
