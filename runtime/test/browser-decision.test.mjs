import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {
  BrowserDecisionError,
  browserDecisionStatus,
  indexedDomDecisionInput,
  parseBrowserDecisionDraft,
  planBrowserAction,
  validateIndexedDomSnapshot,
} from '../lib/browser-decision.mjs';
import {start} from '../server.mjs';

const snapshot = (overrides = {}) => ({
  url: 'https://example.test/search',
  title: 'Example search',
  revision: 7,
  observedAt: '2026-09-20T00:00:00.000Z',
  elements: [
    {index: 0, role: 'link', text: 'Read result', href: 'https://example.test/result', visible: true, enabled: true},
    {index: 1, role: 'textbox', label: 'Search', inputType: 'text', visible: true, enabled: true},
    {index: 2, role: 'textbox', label: 'Password', inputType: 'password', text: 'never persist me', visible: true, enabled: true},
    {index: 3, role: 'button', text: 'Submit', visible: true, enabled: true},
    {index: 4, role: 'combobox', label: 'Sort', visible: true, enabled: true},
  ],
  ...overrides,
});
const draft = (operation, overrides = {}) => ({
  operation,
  targetIndex: null,
  text: null,
  option: null,
  reason: 'bounded synthetic decision',
  snapshotRevision: 7,
  ...overrides,
});

test('indexed DOM input is bounded and redacts credential-like fields before a provider sees it', () => {
  const normalized = validateIndexedDomSnapshot(snapshot());
  assert.equal(normalized.elements.find(element => element.index === 2).text, '[redacted]');
  assert.equal(normalized.elements.find(element => element.index === 2).sensitive, true);
  const input = indexedDomDecisionInput({snapshot: snapshot(), goal: 'read the visible search result'});
  assert.equal(input.policy.credentials, false);
  assert.equal(input.page.revision, 7);
  assert.equal(input.elements.find(element => element.index === 2).text, '[redacted]');
  assert.equal(JSON.stringify(input).includes('never persist me'), false);
});

test('only indexed, fresh, read-only targets are accepted', () => {
  const click = planBrowserAction({snapshot: snapshot(), draft: draft('CLICK', {targetIndex: 0})});
  assert.equal(click.action.operation, 'CLICK');
  assert.equal(click.target.href, 'https://example.test/result');
  assert.equal(click.dispatchAllowed, false);

  const type = planBrowserAction({snapshot: snapshot(), draft: draft('TYPE_TEXT', {targetIndex: 1, text: 'public query'})});
  assert.equal(type.target.role, 'textbox');

  const select = planBrowserAction({snapshot: snapshot(), draft: draft('SELECT', {targetIndex: 4, option: 'recent'})});
  assert.equal(select.target.role, 'combobox');

  assert.throws(() => planBrowserAction({snapshot: snapshot(), draft: draft('CLICK', {targetIndex: 3})}), /unsafe_target_role/);
  assert.throws(() => planBrowserAction({snapshot: snapshot(), draft: draft('TYPE_TEXT', {targetIndex: 2, text: 'secret'})}), /sensitive_target_blocked/);
  assert.throws(() => planBrowserAction({snapshot: snapshot(), draft: draft('CLICK', {targetIndex: 0, snapshotRevision: 6})}), /stale_browser_snapshot/);
  assert.throws(() => planBrowserAction({snapshot: snapshot(), draft: draft('WAIT', {snapshotRevision: 6})}), /stale_browser_snapshot/);
});

test('DONE is fail-closed until independent outcome evidence exists', () => {
  assert.throws(() => planBrowserAction({snapshot: snapshot(), draft: draft('DONE')}), /done_requires_independent_verification/);
  const done = planBrowserAction({
    snapshot: snapshot(),
    draft: draft('DONE'),
    independentOutcome: {status: 'verified', evidenceRefs: ['artifact:result-1']},
  });
  assert.equal(done.independentlyVerified, true);
  assert.equal(done.dispatchAllowed, false);
  assert.throws(() => planBrowserAction({
    snapshot: snapshot(),
    draft: draft('DONE'),
    independentOutcome: {status: 'verified', evidenceRefs: ['']},
  }), /invalid_done_evidence/);
});

test('malformed or unsafe drafts fail closed, while BLOCKED is an explicit non-dispatch decision', () => {
  assert.throws(() => parseBrowserDecisionDraft(JSON.stringify({...draft('CLICK'), operation: 'RUN_JS'})), /invalid_browser_operation/);
  assert.throws(() => parseBrowserDecisionDraft(JSON.stringify({...draft('TYPE_TEXT'), targetIndex: null, text: null})), /missing_browser_text/);
  assert.throws(() => validateIndexedDomSnapshot({...snapshot(), url: 'file:///etc/passwd'}), /invalid_dom_snapshot_url/);
  const blocked = planBrowserAction({snapshot: snapshot(), draft: draft('BLOCKED')});
  assert.equal(blocked.dispatchAllowed, false);
  assert.equal(blocked.action.operation, 'BLOCKED');
});

test('browser decision preview is durable HTTP integration but explicitly not live browser execution', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-browser-decision-'));
  const token = 'synthetic-browser-owner-token';
  const runtime = await start({host: '127.0.0.1', port: 0, dataDir, token, env: {}});
  const request = async (method, route, body) => {
    const response = await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`, {
      method,
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
    return {status: response.status, body: await response.json()};
  };
  t.after(() => { runtime.shutdown(); fs.rmSync(dataDir, {recursive: true, force: true}); });
  const preview = await request('POST', '/api/browser/decision', {
    requestId: randomUUID(),
    goal: 'read the visible search result',
    snapshot: snapshot(),
    draft: draft('CLICK', {targetIndex: 0}),
  });
  assert.equal(preview.status, 201, JSON.stringify(preview.body));
  assert.equal(preview.body.decision.dispatchAllowed, false);
  assert.equal(preview.body.policy.liveBrowserHarness, false);
  assert.equal(preview.body.input.policy.externalActions, false);

  const state = await request('GET', '/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.body.browserDecision.status, browserDecisionStatus().status);
  assert.equal(state.body.capabilities.browserAutomation, false);
});
