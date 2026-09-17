import test from 'node:test';
import assert from 'node:assert/strict';
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
