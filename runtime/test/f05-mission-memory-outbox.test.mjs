import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {missionStatus} from '../lib/shadow-army.mjs';

// F05 — a verified Shadow Army mission must reach the SAME memory write path
// as /api/memory-events: milestone + memory event + sync outbox item for every
// configured destination, in one persisted state, and never twice for the same
// verdict. Harness mirrors semantic-verification.test.mjs (real HTTP server,
// real on-disk store, real restart) - no second harness idiom.

const OPENAI_KEY = 'synthetic-openai-key-not-a-real-credential';
const MODEL_ENV = {YENO_AGENT_PROVIDER: 'openai', YENO_OPENAI_API_KEY: OPENAI_KEY, YENO_OPENAI_MODEL: 'synthetic-openai', YENO_AGENT_DAILY_CALL_LIMIT: '20'};
const ok = text => new Response(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: text, tool_calls: []}}], usage: {prompt_tokens: 30, completion_tokens: 20}}), {headers: {'Content-Type': 'application/json'}});
const isSemanticRequest = body => body.messages.some(m => typeof m.content === 'string' && m.content.includes('independent semantic verifier'));
const PASS_VERDICT = {verdict: 'pass', confidence: 0.9, criteria: [{criterion: '목표 충족', status: 'met', reason: '산출물이 목표와 성공 기준을 실제로 다룸', evidenceRefs: ['builder-artifact']}], summary: '목표를 실제로 달성함'};

async function setup(t, {obsidian = false} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-f05-')), token = 'synthetic-f05-owner-token';
  const vaultDir = path.join(dir, 'vault'); fs.mkdirSync(vaultDir);
  const env = {...MODEL_ENV, ...(obsidian ? {YENO_OBSIDIAN_EXPORT_ENABLED: 'true', YENO_OBSIDIAN_VAULT_PATH: vaultDir} : {})};
  const agentFetch = async (url, req) => { const body = JSON.parse(req.body); return ok(isSemanticRequest(body) ? JSON.stringify(PASS_VERDICT) : '실제 Shadow 산출물 본문'); };
  let runtime = await start({host: '127.0.0.1', port: 0, dataDir: dir, token, env, agentFetch});
  const base = () => `http://127.0.0.1:${runtime.server.address().port}`;
  const post = async (p, body) => { const r = await fetch(base() + p, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`}, body: JSON.stringify({requestId: randomUUID(), ...body})}); return {status: r.status, body: await r.json()}; };
  const wait = async (id, statuses = ['completed', 'failed', 'paused']) => { for (let i = 0; i < 400; i++) { const j = openStore(dir).state.jobs.find(j => j.id === id); if (j && statuses.includes(j.status)) return j; await new Promise(r => setTimeout(r, 20)); } assert.fail('job did not reach target state'); };
  const restart = async () => { runtime.shutdown(); runtime = await start({host: '127.0.0.1', port: 0, dataDir: dir, token, env, agentFetch}); };
  t.after(() => { runtime.shutdown(); fs.rmSync(dir, {recursive: true, force: true}); });
  return {dir, post, wait, restart, disk: () => openStore(dir).state};
}

async function verifiedMission(h) {
  const p = await h.post('/api/projects', {name: `F05 프로젝트 ${randomUUID().slice(0, 8)}`, status: 'active'});
  assert.equal(p.status, 201, JSON.stringify(p.body));
  const m = await h.post('/api/shadow-army/missions', {projectId: p.body.project.id, goal: '실제 산출물을 완성한다', successCriterion: '검증 가능한 결과물 1개'});
  assert.equal(m.status, 201, JSON.stringify(m.body));
  const mission = m.body.mission;
  const builder = mission.shadows.find(s => s.role === 'builder');
  assert.equal((await h.wait(builder.jobId, ['completed', 'failed'])).status, 'completed');
  assert.equal((await h.wait(mission.verify.jobId, ['completed', 'failed'])).status, 'completed');
  const semanticJob = await h.wait(mission.semantic.jobId, ['completed', 'failed']);
  assert.equal(semanticJob.status, 'completed', semanticJob.error);
  assert.equal(semanticJob.semanticVerdict.verdict, 'pass');
  assert.equal(missionStatus(m.body.missionId, h.disk()).phase, 'completed');
  return {project: p.body.project, missionId: m.body.missionId, semanticJob};
}

const resultEventsFor = (state, jobId) => state.memoryEvents.filter(e => e.type === 'result' && e.sourceRefs.some(r => r.type === 'job' && r.id === jobId));
const milestonesFor = (state, projectId, missionId) => state.projects.find(p => p.id === projectId).milestones.filter(m => m.text.includes(missionId.slice(0, 8)));

test('F05: a verified mission records milestone + memory event + one outbox item per configured destination, in the same persisted state', async t => {
  const h = await setup(t, {obsidian: true});
  const {project, missionId, semanticJob} = await verifiedMission(h);
  const state = h.disk();
  const events = resultEventsFor(state, semanticJob.id);
  assert.equal(events.length, 1, 'exactly one result memory event for this verdict');
  assert.equal(milestonesFor(state, project.id, missionId).length, 1, 'exactly one completed milestone');
  const items = state.memorySyncOutbox.filter(i => i.eventId === events[0].id);
  assert.deepEqual(items.map(i => i.destination), ['obsidian'], 'the verified mission memory must be queued for the configured destination');
  assert.equal(items[0].fingerprint, events[0].fingerprint);
});

test('F05: with no destination configured the memory event is still recorded and the outbox stays empty (no fabricated delivery)', async t => {
  const h = await setup(t, {obsidian: false});
  const {semanticJob} = await verifiedMission(h);
  const state = h.disk();
  assert.equal(resultEventsFor(state, semanticJob.id).length, 1);
  assert.equal(state.memorySyncOutbox.length, 0);
});

test('F05: restart + re-processing never duplicates milestone, memory event or outbox item for the same verdict', async t => {
  const h = await setup(t, {obsidian: true});
  const {project, missionId, semanticJob} = await verifiedMission(h);
  const before = h.disk();
  await h.restart();
  await new Promise(r => setTimeout(r, 600)); // let scheduler ticks run after restart
  const after = h.disk();
  assert.equal(resultEventsFor(after, semanticJob.id).length, 1);
  assert.equal(milestonesFor(after, project.id, missionId).length, 1);
  assert.equal(after.memorySyncOutbox.filter(i => i.eventId === resultEventsFor(before, semanticJob.id)[0].id).length, 1);
  assert.equal(after.jobs.find(j => j.id === semanticJob.id).status, 'completed', 'a completed verifier job stays completed across restart');
});
