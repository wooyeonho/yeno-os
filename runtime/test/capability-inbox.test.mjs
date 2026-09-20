import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {initialCapabilities} from '../lib/capabilities.mjs';
import {CapabilityInboxError, initialCapabilityInbox, validateCapabilityInbox, admitBrowserCapability, listCapabilityInbox, promoteBrowserCapability} from '../lib/capability-inbox.mjs';

const PUBLIC = 'https://example.com/public';
const HASH = 'a'.repeat(64);
const makeJob = (evidenceClass = 'SANDBOX_SYNTHETIC') => ({
  id: randomUUID(), type: 'browser', status: 'completed',
  browserRequest: {sourceUrl: PUBLIC, goal: '공개 제목·본문·링크 추출'},
  browser: {
    commandId: randomUUID(), artifactRef: 'artifact-browser-1', artifactHash: HASH,
    deterministicVerification: {status: 'verified', verified: true},
    semanticVerification: {verdict: 'pass', independence: 'independent-context'},
    evidenceClass,
    sourceIntake: {readingStatus: 'partial', decision: 'pending'},
  },
});
const manifest = {
  schemaVersion: 1, id: 'browser-readonly', version: '1.0.0',
  name: '공개 페이지 기록', description: '검토된 공개 페이지 행을 제한된 표로 기록한다.',
  source: {kind: 'external', author: 'BLACKHOLE owner', license: 'MIT', url: PUBLIC},
  inputSchema: {fields: {sourceUrl: 'string', title: 'string'}},
  steps: [{op: 'limit', count: 1}],
  output: {title: '공개 페이지', description: '제목 기록', columns: [{field: 'sourceUrl', label: '주소'}, {field: 'title', label: '제목'}], footer: '외부 호출 없음.'},
  fixtures: [
    {name: 'one', input: {records: [{sourceUrl: PUBLIC, title: 'A'}]}, expectedRows: [{sourceUrl: PUBLIC, title: 'A'}]},
    {name: 'two', input: {records: [{sourceUrl: PUBLIC, title: 'B'}]}, expectedRows: [{sourceUrl: PUBLIC, title: 'B'}]},
  ],
};

test('only a deterministic+semantic pass enters Kirby inbox, and sandbox evidence stays pending', () => {
  const job = makeJob();
  let inbox = initialCapabilityInbox();
  const admitted = admitBrowserCapability(inbox, job, {at: '2026-09-20T00:00:00.000Z'});
  inbox = admitted.inbox;
  assert.equal(admitted.result.status, 'pending');
  assert.equal(admitted.result.promotionBlockedReason, 'live_evidence_required');
  assert.equal(listCapabilityInbox(inbox).length, 1);
  assert.equal(inbox.entries[0].sourceReadingStatus, 'partial');
  assert.equal(inbox.entries[0].sourceDecision, 'pending');
  assert.throws(() => promoteBrowserCapability(inbox, initialCapabilities(), inbox.entries[0].id, manifest, {ownerApproved: true}), error => error instanceof CapabilityInboxError && error.code === 'LIVE_EVIDENCE_REQUIRED');
});

test('same Browser job is idempotent and cannot create duplicate inbox entries', () => {
  const job = makeJob();
  let inbox = initialCapabilityInbox();
  const first = admitBrowserCapability(inbox, job, {at: '2026-09-20T00:00:00.000Z'});
  const second = admitBrowserCapability(first.inbox, job, {at: '2026-09-20T00:01:00.000Z'});
  assert.equal(second.result.alreadyAdmitted, true);
  assert.equal(second.inbox.entries.length, 1);
  assert.doesNotThrow(() => validateCapabilityInbox(second.inbox));
});

test('live evidence plus explicit owner approval promotes through the existing capability registry', () => {
  const job = makeJob('LIVE');
  const admitted = admitBrowserCapability(initialCapabilityInbox(), job, {at: '2026-09-20T00:00:00.000Z'});
  const promoted = promoteBrowserCapability(admitted.inbox, initialCapabilities(), admitted.result.id, manifest, {ownerApproved: true, at: '2026-09-20T00:02:00.000Z'});
  assert.equal(promoted.result.status, 'promoted');
  assert.equal(promoted.result.capabilityId, manifest.id);
  assert.equal(promoted.inbox.entries[0].ownerApproved, true);
  assert.equal(promoted.inbox.entries[0].registryCapabilityId, manifest.id);
  assert.equal(promoted.registry.entries[0].activeHash, promoted.result.hash);
  assert.doesNotThrow(() => validateCapabilityInbox(promoted.inbox));
});

test('invalid Browser evidence, provenance and approval fail closed', () => {
  const bad = makeJob('LIVE');
  bad.browser.semanticVerification.verdict = 'uncertain';
  assert.throws(() => admitBrowserCapability(initialCapabilityInbox(), bad), /검증/);
  const admitted = admitBrowserCapability(initialCapabilityInbox(), makeJob('LIVE'));
  assert.throws(() => promoteBrowserCapability(admitted.inbox, initialCapabilities(), admitted.result.id, {...manifest, source: {...manifest.source, url: 'https://example.com/other'}}, {ownerApproved: true}), /원본 주소/);
  assert.throws(() => promoteBrowserCapability(admitted.inbox, initialCapabilities(), admitted.result.id, manifest, {ownerApproved: false}), /승인/);
});
