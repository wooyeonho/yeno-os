import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {
  initialPersistentBots,
  validatePersistentBots,
  appendPersistentMemory,
  putPersistentRoutine,
  recordPersistentHandoff,
  persistentBotOverview
} from '../lib/persistent-bots.mjs';

const at = '2026-09-17T00:00:00.000Z';

test('persistent roster is deterministic, bounded, and explicitly disconnected from external products', () => {
  const registry = initialPersistentBots(at);
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.bots.length, 6);
  assert.ok(registry.bots.every(bot => bot.status === 'idle'));
  assert.ok(registry.bots.every(bot => bot.externalProductConnected === false));
  assert.ok(registry.bots.every(bot => bot.routines.every(routine => routine.enabled === false && routine.status === 'not_wired')));
  assert.doesNotThrow(() => validatePersistentBots(registry));
  const overview = persistentBotOverview(registry);
  assert.equal(overview.execution.routineExecutor, false);
  assert.equal(overview.execution.androidControl, false);
  assert.equal(overview.execution.paidVideoProvider, false);
});

test('source-backed memory is classified and never accepts credentials or unsafe URLs', () => {
  const registry = initialPersistentBots(at);
  const result = appendPersistentMemory(registry, 'scout', {
    kind: 'source',
    text: 'Google ARTEMIS is a candidate Android control adapter; the device test is still unwired.',
    sourceUrl: 'https://github.com/google/artemis',
    sourceTitle: 'Google ARTEMIS',
    confidence: 'high',
    disposition: 'adopted',
    evidenceRefs: ['reference:artemis']
  }, {at});
  assert.equal(registry.bots.find(bot => bot.id === 'scout').memory.length, 0);
  assert.equal(result.registry.bots.find(bot => bot.id === 'scout').memory[0].sourceUrl, 'https://github.com/google/artemis');
  assert.equal(result.memory.disposition, 'adopted');
  assert.throws(() => appendPersistentMemory(registry, 'scout', {
    text: 'unsafe',
    sourceUrl: 'http://example.com'
  }, {at}), /HTTPS/);
  assert.throws(() => appendPersistentMemory(registry, 'scout', {
    text: 'secret',
    apiKey: 'do-not-store'
  }, {at}), /classified evidence fields/);
});

test('routines remain declarative and handoffs remain owner-gated', () => {
  const registry = initialPersistentBots(at);
  const routine = putPersistentRoutine(registry, 'eureka', {
    id: 'verify-artemis',
    name: 'ARTEMIS 검증',
    trigger: {kind: 'manual', value: null},
    objective: '공식 문서와 실제 기기 시험 결과를 분리해 기록한다.',
    inputRefs: ['reference:artemis']
  }, {at});
  assert.equal(routine.routine.status, 'not_wired');
  assert.equal(routine.routine.enabled, false);
  assert.throws(() => putPersistentRoutine(registry, 'eureka', {
    id: 'unsafe',
    name: 'unsafe',
    trigger: {kind: 'manual', value: null},
    objective: 'unsafe',
    inputRefs: [],
    enabled: true
  }, {at}), /declarative/);
  const handoff = recordPersistentHandoff(registry, {
    fromBotId: 'scout',
    toBotId: 'eureka',
    summary: '공식 ARTEMIS 자료를 실제 AndroidWorld 시험으로 이어갈지 검토해 주세요.',
    evidenceRefs: ['reference:artemis', 'reference:androidworld']
  }, {at});
  assert.equal(handoff.handoff.status, 'awaiting_owner');
  assert.equal(handoff.handoff.requiresOwnerApproval, true);
  assert.throws(() => recordPersistentHandoff(registry, {
    fromBotId: 'scout',
    toBotId: 'scout',
    summary: 'self handoff',
    evidenceRefs: []
  }, {at}), /cannot hand off to itself/);
});


test('owner API persists classified memory and survives runtime restart', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yeno-persistent-bots-'));
  const token = 'persistent-bot-owner-token';
  let runtime = await start({dataDir, host: '127.0.0.1', port: 0, token, env: {}});
  t.after(() => {
    runtime.shutdown();
    fs.rmSync(dataDir, {recursive: true, force: true});
  });
  const base = () => 'http://127.0.0.1:' + runtime.server.address().port;
  const request = async (route, body) => {
    const response = await fetch(base() + route, {
      method: body ? 'POST' : 'GET',
      headers: {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
      ...(body ? {body: JSON.stringify({requestId: randomUUID(), ...body})} : {})
    });
    return {status: response.status, body: await response.json()};
  };
  const initial = await request('/api/persistent-bots');
  assert.equal(initial.status, 200);
  assert.equal(initial.body.bots.length, 6);
  const saved = await request('/api/persistent-bots', {
    action: 'memory',
    botId: 'scout',
    memory: {
      kind: 'source',
      text: 'A reviewed source remains a candidate until a reproducible test exists.',
      sourceUrl: 'https://github.com/google/artemis',
      confidence: 'high',
      disposition: 'candidate',
      evidenceRefs: ['reference:artemis']
    }
  });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.memory.sourceUrl, 'https://github.com/google/artemis');
  assert.equal(runtime.state().persistentBots.bots[1].memoryCount, 1);
  runtime.shutdown();
  runtime = await start({dataDir, host: '127.0.0.1', port: 0, token, env: {}});
  const afterRestart = await request('/api/persistent-bots');
  assert.equal(afterRestart.status, 200);
  assert.equal(afterRestart.body.bots.find(bot => bot.id === 'scout').memory.length, 1);
  assert.equal((await request('/api/state')).body.capabilities.externalPublishing, false);
});

test('F02 integration: a bot memory append is also one canonical memory event (same store + outbox path), never a second memory store', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yeno-persistent-bots-fabric-'));
  const vault = path.join(dataDir, 'vault'); fs.mkdirSync(vault);
  const token = 'persistent-bot-owner-token';
  const runtime = await start({dataDir, host: '127.0.0.1', port: 0, token, env: {YENO_OBSIDIAN_EXPORT_ENABLED: 'true', YENO_OBSIDIAN_VAULT_PATH: vault}});
  t.after(() => { runtime.shutdown(); fs.rmSync(dataDir, {recursive: true, force: true}); });
  const base = 'http://127.0.0.1:' + runtime.server.address().port;
  const r = await fetch(base + '/api/persistent-bots', {method: 'POST', headers: {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, body: JSON.stringify({requestId: randomUUID(), action: 'memory', botId: 'scout', memory: {kind: 'source', text: 'Artemis 저장소는 참고용', sourceUrl: 'https://github.com/google/artemis', sourceTitle: 'artemis', confidence: 'high', disposition: 'candidate', evidenceRefs: ['reference:artemis']}})});
  const body = await r.json();
  assert.equal(r.status, 201, JSON.stringify(body));
  assert.ok(body.memoryEventId, 'the canonical memory event id is returned');
  const state = openStore(dataDir).state;
  const ev = state.memoryEvents.find(e => e.id === body.memoryEventId);
  assert.ok(ev); assert.equal(ev.type, 'source'); assert.equal(ev.confidence, 0.9); assert.match(ev.text, /scout\/source\/candidate/);
  assert.equal(state.memorySyncOutbox.filter(i => i.eventId === ev.id).map(i => i.destination).join(), 'obsidian', 'queued for the configured destination');
  assert.equal(state.memoryEvents.filter(e => e.text.includes('Artemis')).length, 1, 'exactly one canonical record');
});
