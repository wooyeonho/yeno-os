import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BrowserHarnessError,
  MAX_BODY_BYTES,
  buildBrowserArtifact,
  browserDecisionInput,
  browserHarnessStatus,
  deterministicBrowserVerification,
  normalizeBrowserSnapshot,
  redactSecrets,
  resolvePublicHttpsUrl,
  runSandboxBrowserHarness,
  typesafeJevProviderStatus,
  validateBrowserJob,
  validatePublicHttpsUrl,
  validateResolvedAddresses,
} from '../lib/browser-harness.mjs';

const PUBLIC = 'https://example.com/docs';
const publicAddresses = ['93.184.216.34'];
const baseSnapshot = {
  url: PUBLIC,
  title: '공개 문서',
  body: '읽을 수 있는 공개 본문',
  revision: 1,
  observedAt: '2026-09-20T00:00:00.000Z',
  links: [{text: '공개 링크', href: 'https://example.com/next'}],
  elements: [
    {index: 0, role: 'link', text: '공개 링크', href: 'https://example.com/next'},
    {index: 1, role: 'textbox', label: '검색어', inputType: 'search'},
    {index: 2, role: 'textbox', label: '비밀번호', inputType: 'password'},
  ],
};
const waitDraft = {operation: 'WAIT', targetIndex: null, text: null, option: null, reason: '공개 문서를 읽기 위해 잠시 기다림', snapshotRevision: 1};
const doneDraft = {operation: 'DONE', targetIndex: null, text: null, option: null, reason: '독립 증거가 확보됨', snapshotRevision: 1};

test('public HTTPS is allowed while localhost/private/link-local/metadata/credentials are denied', () => {
  assert.equal(validatePublicHttpsUrl(PUBLIC), PUBLIC);
  for (const url of [
    'http://example.com',
    'https://localhost',
    'https://127.0.0.1',
    'https://10.0.0.2',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]',
    'https://user:pass@example.com',
    'https://example.com:8443',
    'https://example.com/?api_key=secret',
  ]) assert.throws(() => validatePublicHttpsUrl(url), BrowserHarnessError);
});

test('DNS rebinding protection rejects private answers and requires a non-empty resolution', async () => {
  await assert.rejects(resolvePublicHttpsUrl(PUBLIC, {resolveHost: async () => [{address: '127.0.0.1'}]}), /dns_rebinding_or_private_address/);
  await assert.rejects(resolvePublicHttpsUrl(PUBLIC, {resolveHost: async () => []}), /dns_resolution_empty/);
  const resolved = await resolvePublicHttpsUrl(PUBLIC, {resolveHost: async () => [{address: publicAddresses[0]}]});
  assert.deepEqual(resolved.addresses, publicAddresses);
  assert.throws(() => validateResolvedAddresses(['192.168.1.1']), /dns_rebinding_or_private_address/);
});

test('snapshot bounds DOM/body/links and redacts secrets before decision/artifact', () => {
  const snapshot = normalizeBrowserSnapshot(baseSnapshot, {resolvedAddresses: publicAddresses});
  assert.equal(snapshot.elements[2].text, '[redacted]');
  assert.equal(snapshot.elements[2].sensitive, true);
  assert.equal(browserDecisionInput(snapshot, '제목과 본문을 읽는다').policy.credentials, false);
  assert.ok(redactSecrets('Authorization: Bearer abc123').includes('[redacted'));
  assert.throws(() => normalizeBrowserSnapshot({...baseSnapshot, body: 'x'.repeat(MAX_BODY_BYTES + 1)}), /dom_body_limit/);
  assert.throws(() => normalizeBrowserSnapshot({...baseSnapshot, links: Array.from({length: 101}, () => ({href: 'https://example.com'}))}), /link_limit/);
});

test('unsafe targets and stale snapshots fail closed', async () => {
  const snapshot = normalizeBrowserSnapshot(baseSnapshot);
  const unsafe = {operation: 'TYPE_TEXT', targetIndex: 2, text: 'secret', option: null, reason: 'fill', snapshotRevision: 1};
  await assert.rejects(runSandboxBrowserHarness({
    goal: '공개 문서 읽기', sourceUrl: PUBLIC,
    resolveHost: async () => publicAddresses,
    fetchPublicPage: async () => snapshot,
    decisionProvider: async () => unsafe,
  }), /sensitive_target_blocked/);
  await assert.rejects(runSandboxBrowserHarness({
    goal: '공개 문서 읽기', sourceUrl: PUBLIC,
    resolveHost: async () => publicAddresses,
    fetchPublicPage: async () => snapshot,
    decisionProvider: async () => ({...waitDraft, targetIndex: null}),
    executeAction: async () => ({snapshot}),
  }), /stale_snapshot/);
});

test('sandbox harness accepts an injected public transport only and records bounded action evidence', async () => {
  const result = await runSandboxBrowserHarness({
    goal: '제목·본문·링크를 읽는다',
    sourceUrl: PUBLIC,
    resolveHost: async () => publicAddresses,
    fetchPublicPage: async ({url}) => ({...baseSnapshot, url}),
    decisionProvider: async input => ({...waitDraft, snapshotRevision: input.page.revision}),
    executeAction: async () => ({snapshot: {...baseSnapshot, revision: 2}}),
    maxActions: 1,
  });
  assert.equal(result.mode, 'sandbox-injected');
  assert.equal(result.provider, 'typesafe-jev');
  assert.equal(result.deterministic.verified, true);
  assert.equal(result.snapshot.revision, 2);
  assert.equal(result.actionEvidence.length, 1);
  assert.ok(result.artifact.sha256.length === 64);
});

test('DONE without independent evidence and malformed provider output are rejected', async () => {
  await assert.rejects(runSandboxBrowserHarness({
    goal: '읽기', sourceUrl: PUBLIC, resolveHost: async () => publicAddresses,
    fetchPublicPage: async () => baseSnapshot, decisionProvider: async () => doneDraft,
  }), /done_requires_independent/);
  await assert.rejects(runSandboxBrowserHarness({
    goal: '읽기', sourceUrl: PUBLIC, resolveHost: async () => publicAddresses,
    fetchPublicPage: async () => baseSnapshot, decisionProvider: async () => 'not-json',
  }), /invalid_decision_json/);
  await assert.rejects(runSandboxBrowserHarness({goal: '읽기', sourceUrl: PUBLIC}), /browser_harness_unavailable/);
});

test('artifact deterministic gate requires hash, action evidence and settled provider outcome', () => {
  const snapshot = normalizeBrowserSnapshot(baseSnapshot);
  const artifact = buildBrowserArtifact({snapshot, goal: '읽기', actionEvidence: [{operation: 'WAIT'}]});
  assert.equal(deterministicBrowserVerification({snapshot, artifact, actionEvidence: [{operation: 'WAIT'}]}).status, 'verified');
  assert.equal(deterministicBrowserVerification({snapshot, artifact: {...artifact, sha256: '0'.repeat(64)}, actionEvidence: [{operation: 'WAIT'}]}).status, 'rejected');
  assert.equal(deterministicBrowserVerification({snapshot, artifact, actionEvidence: [], providerOutcome: 'unknown'}).status, 'rejected');
});

test('browser job validation is additive to the existing state.jobs record', () => {
  const job = {type: 'browser', status: 'queued', browserRequest: {goal: '공개 자료 읽기', sourceUrl: PUBLIC}};
  assert.equal(validateBrowserJob(job), true);
  assert.throws(() => validateBrowserJob({...job, browserRequest: {...job.browserRequest, sourceUrl: 'http://example.com'}}), /https_required/);
  assert.throws(() => validateBrowserJob({...job, browser: {artifactHash: 'bad'}}), /invalid_browser_artifact_hash/);
});

test('status is honest: no adapter or TypeSafe credentials means unavailable, never live', () => {
  assert.equal(browserHarnessStatus().liveBrowserHarness, false);
  assert.equal(typesafeJevProviderStatus({}).status, 'unavailable');
  assert.equal(typesafeJevProviderStatus({YENO_JEV_BASE_URL: 'https://jev.example', YENO_JEV_API_KEY: 'synthetic', YENO_JEV_MODEL: 'jev'}).status, 'unavailable');
  assert.equal(typesafeJevProviderStatus({YENO_JEV_BASE_URL: 'https://jev.example', YENO_JEV_API_KEY: 'synthetic', YENO_JEV_MODEL: 'jev', YENO_JEV_OFFICIAL_ENDPOINT_CONFIRMED: 'true'}).status, 'configured');
});
