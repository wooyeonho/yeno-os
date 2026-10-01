import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createConnectorRegistry, ConnectorError} from '../lib/connectors/registry.mjs';

async function fixture(t, handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = {path: req.url, method: req.method, body, authorization: req.headers.authorization};
    requests.push(request);
    await handler(request, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return {endpoint: `http://127.0.0.1:${server.address().port}`, requests};
}
const localEnv = endpoint => ({YENO_AGENT_PROVIDER: 'local', YENO_LOCAL_MODEL: 'fixture-model',
  YENO_LOCAL_BASE_URL: `${endpoint}/v1/chat/completions`, YENO_AGENT_DAILY_CALL_LIMIT: '1'});
const validReply = (_req, res) => { res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({choices: [{message: {role: 'assistant', content: 'OK'}, finish_reason: 'stop'}]})); };
const row = (registry, id) => registry.list().find(item => item.id === id);

test('registry lists every connector with honest status and connector-specific auth', () => {
  // Given no configured endpoints or receipts. When status is read. Then no connector is connected.
  const registry = createConnectorRegistry({env: {}});
  const rows = registry.list();
  assert.equal(new Set(rows.map(item => item.id)).size, rows.length);
  assert.ok(rows.length >= 25);
  assert.equal(rows.some(item => item.status === 'connected'), false);
  assert.equal(row(registry, 'quantum-circuit').status, 'installed');
  assert.equal(row(registry, 'ollama').status, 'needs_owner');
  assert.equal(row(registry, 'obsidian').status, 'needs_owner');
  for (const item of rows.filter(item => !item.implemented)) {
    assert.equal(item.status, 'not_implemented');
    assert.equal(item.canCheck, false);
  }
  assert.equal(row(registry, 'openai').auth.shape, 'llm-provider');
  assert.deepEqual(row(registry, 'ibm-quantum').auth.fields, ['token', 'instance']);
  assert.equal(row(registry, 'obsidian').auth.shape, 'api-key+ca');
  assert.equal(row(registry, 'supabase').auth.shape, 'service-key');
  assert.equal(row(registry, 'promptfoo').fallback, 'jev_v0_rules');
  const reach = row(registry, 'agent-reach');
  assert.equal(reach.mode, 'process');
  assert.equal(reach.kind, 'scout');
  assert.equal(reach.status, 'not_implemented');
  assert.equal(reach.canCheck, false);
  assert.equal(reach.authorizesDispatch, false);
  assert.equal(reach.policy.selfInstall, false);
  assert.deepEqual(reach.policy.firstScope, ['github','rss','public-web','youtube-captions']);
  assert.equal(JSON.stringify(reach).includes('apiKey'), false);
  for(const id of ['owner-analytics','owner-publication','owner-revenue']){
    const pending=row(registry,id);
    assert.equal(pending.status,'not_implemented');
    assert.equal(pending.canCheck,false);
    assert.equal(pending.policy.providerSelected,false);
    assert.equal(pending.policy.readOnly,true);
  }
  assert.equal(row(registry,'owner-revenue').policy.transfers,false);
});

test('quantum connection requires the actual installed library Bell self-check', async () => {
  // Given no prior self-check. When explicitly checked. Then the actual local simulator is live evidence.
  const registry = createConnectorRegistry({env: {}});
  const result = await registry.check('quantum-circuit');
  assert.equal(result.status, 'connected');
  assert.equal(result.lastCheck.evidence.class, 'live');
  assert.equal(result.lastCheck.evidence.countsOrigin, 'local_statevector_simulator');
  assert.equal(result.lastCheck.evidence.bellVerified, true);
  assert.equal(result.authorizesDispatch, false);
});

test('configured Ollama has no calls until an explicit bounded check and fixture evidence stays synthetic', async t => {
  // Given a real HTTP fixture. When the owner explicitly checks. Then exactly one bounded generation is sent.
  const backend = await fixture(t, validReply);
  const registry = createConnectorRegistry({env: localEnv(backend.endpoint), synthetic: true});
  assert.equal(row(registry, 'ollama').status, 'installed');
  assert.equal(backend.requests.length, 0);
  const result = await registry.check('ollama');
  assert.equal(result.status, 'connected');
  assert.equal(result.lastCheck.evidence.class, 'synthetic');
  assert.equal(backend.requests.length, 1);
  const sent = JSON.parse(backend.requests[0].body);
  assert.equal(sent.model, 'fixture-model');
  assert.equal(sent.stream, false);
  assert.equal(sent.max_tokens, 8);
  assert.equal(result.lastCheck.evidence.backend, 'local_openai_compatible');
  assert.equal(JSON.stringify(result).includes('fixture-model'), false);
});

test('legacy local environment names remain valid without rewriting provider configuration', async t => {
  // Given the existing YENO_AGENT_MODEL local configuration. When checked. Then that model is used once.
  const backend = await fixture(t, validReply);
  const env = {YENO_AGENT_PROVIDER: 'local', YENO_AGENT_MODEL: 'legacy-fixture', YENO_AGENT_DAILY_CALL_LIMIT: '1'};
  const registry = createConnectorRegistry({env, fetchImpl: async (_url, options) => fetch(`${backend.endpoint}/v1/chat/completions`, options)});
  const result = await registry.check('ollama');
  assert.equal(result.status, 'connected');
  assert.equal(result.lastCheck.evidence.class, 'synthetic');
  assert.equal(JSON.parse(backend.requests[0].body).model, 'legacy-fixture');
});

test('non-loopback and credential-bearing local endpoints are blocked before network', async () => {
  // Given hostile endpoint configuration. When checked. Then no request is sent.
  let calls = 0;
  for (const endpoint of ['http://example.com/v1/chat/completions', 'https://127.0.0.1/v1/chat/completions', 'http://secret@127.0.0.1/', 'http://127.0.0.1/?secret=x']) {
    const registry = createConnectorRegistry({env: {...localEnv('http://127.0.0.1'), YENO_LOCAL_BASE_URL: endpoint}, fetchImpl: () => { calls++; }});
    assert.equal((await registry.check('ollama')).status, 'blocked');
  }
  assert.equal(calls, 0);
});

test('invalid functional HTTP responses never establish connected status', async t => {
  // Given a listening service with an unrelated HTTP 200 response. When checked. Then function validation fails.
  const backend = await fixture(t, (_req, res) => res.end('{"status":"ok"}'));
  const registry = createConnectorRegistry({env: localEnv(backend.endpoint), synthetic: true});
  const result = await registry.check('ollama');
  assert.equal(result.status, 'blocked');
  assert.equal(result.lastCheck.ok, false);
});

test('Obsidian reuses read-only draft search without disclosing matches or credentials', async t => {
  // Given a real HTTP fixture containing draft and raw entries. When checked. Then only safe metadata returns.
  const backend = await fixture(t, (_req, res) => res.end(JSON.stringify([
    {filename: '01_DRAFTS/private-note.md', matches: [{context: 'private search text'}]},
    {filename: '00_INBOX_RAW/private.md', matches: [{context: 'raw private text'}]},
  ])));
  const env = {YENO_OBSIDIAN_REST_ENABLED: 'true', YENO_OBSIDIAN_REST_ENDPOINT: `${backend.endpoint}/`, YENO_OBSIDIAN_REST_API_KEY: 'synthetic-secret-key'};
  const registry = createConnectorRegistry({env, synthetic: true});
  const result = await registry.check('obsidian');
  assert.equal(result.status, 'connected');
  assert.equal(result.lastCheck.evidence.class, 'synthetic');
  assert.equal(result.lastCheck.evidence.readOnly, true);
  assert.equal(result.lastCheck.evidence.scope, '01_DRAFTS');
  assert.equal(backend.requests[0].method, 'POST');
  assert.equal(backend.requests[0].authorization, 'Bearer synthetic-secret-key');
  const publicText = JSON.stringify(registry.list());
  for (const secret of ['synthetic-secret-key', 'private-note', 'private search text', 'raw private text', backend.endpoint]) assert.equal(publicText.includes(secret), false);
});

test('Obsidian HTTPS requires the existing trusted CA and rejects remote endpoints', async () => {
  // Given missing CA or a remote address. When checked. Then no request is sent.
  let calls = 0;
  for (const endpoint of ['https://127.0.0.1:27124/', 'http://example.com/']) {
    const registry = createConnectorRegistry({env: {YENO_OBSIDIAN_REST_ENABLED: 'true', YENO_OBSIDIAN_REST_API_KEY: 'synthetic-key', YENO_OBSIDIAN_REST_ENDPOINT: endpoint}, fetchImpl: () => { calls++; }});
    assert.notEqual((await registry.check('obsidian')).status, 'connected');
  }
  assert.equal(calls, 0);
});

test('successful receipts expire and never survive creating a new registry', async () => {
  // Given a successful live self-check. When its TTL elapses. Then status requires another check.
  let clock = 1000;
  const registry = createConnectorRegistry({env: {}, now: () => clock, ttlMs: 1000});
  await registry.check('quantum-circuit');
  clock = 2000;
  assert.equal(row(registry, 'quantum-circuit').status, 'installed');
  assert.equal(row(registry, 'quantum-circuit').reason, 'check_expired');
  assert.equal(createConnectorRegistry({env: {}}).list().some(item => item.status === 'connected'), false);
});

test('changing configuration invalidates receipts even if a previous value is later restored', async t => {
  // Given a successful fixture check. When configuration changes. Then its receipt is discarded.
  const backend = await fixture(t, validReply);
  const env = localEnv(backend.endpoint);
  const registry = createConnectorRegistry({env, synthetic: true});
  await registry.check('ollama');
  env.YENO_LOCAL_MODEL = 'changed';
  assert.equal(row(registry, 'ollama').status, 'installed');
  assert.equal(row(registry, 'ollama').lastCheck, null);
  env.YENO_LOCAL_MODEL = 'fixture-model';
  assert.notEqual(row(registry, 'ollama').status, 'connected');
});

test('all checks are serial and repeated checks are rate limited', async t => {
  // Given an in-flight generation. When another connector or duplicate is requested. Then neither overlaps.
  let release;
  let notify;
  const seen = new Promise(resolve => { notify = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const backend = await fixture(t, async (req, res) => { notify(); await gate; validReply(req, res); });
  const registry = createConnectorRegistry({env: localEnv(backend.endpoint), synthetic: true});
  const pending = registry.check('ollama');
  await seen;
  await assert.rejects(registry.check('ollama'), error => error instanceof ConnectorError && error.code === 'connector_busy');
  await assert.rejects(registry.check('quantum-circuit'), error => error.code === 'connector_busy');
  release();
  await pending;
  await assert.rejects(registry.check('ollama'), error => error.code === 'connector_rate_limited');
});

test('timeouts and provider errors expose only fixed sanitized failure codes', async t => {
  // Given a fixture that never responds. When its bounded probe expires. Then status is blocked without raw errors.
  const backend = await fixture(t, () => {});
  const registry = createConnectorRegistry({env: localEnv(backend.endpoint), synthetic: true, timeoutMs: 100});
  const result = await registry.check('ollama');
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'check_timeout');
  assert.equal(result.lastCheck.evidenceClass, 'synthetic');
  const failing = createConnectorRegistry({env: localEnv(backend.endpoint), fetchImpl: async () => { throw new Error('secret-sk-key prompt private contents'); }});
  const failed = await failing.check('ollama');
  assert.equal(failed.reason, 'check_failed');
  assert.equal(JSON.stringify(failed).includes('secret-sk-key'), false);
});

test('an unimplemented adapter cannot be promoted by credentials or a check request', async () => {
  // Given cloud credentials for an adapter outside CP1. When checked. Then no function call is invented.
  const registry = createConnectorRegistry({env: {YENO_OPENAI_API_KEY: 'synthetic-key', YENO_OPENAI_MODEL: 'model', YENO_AGENT_DAILY_CALL_LIMIT: '1'}});
  const result = await registry.check('openai');
  assert.equal(result.status, 'not_implemented');
  assert.equal(result.lastCheck, null);
  await assert.rejects(registry.check('unknown'), error => error.code === 'connector_not_found');
});

test('core Ollama hook owns its durable job and exposes only validated receipt metadata', async () => {
  // Given a synthetic durable-job hook. When checked. Then the direct transport is never used.
  let calls = 0;
  const jobId = 'f31c6e14-efff-4891-90a6-c75aaff52a45';
  const registry = createConnectorRegistry({env: localEnv('http://127.0.0.1:11434'), synthetic: true,
    ollamaProbe: async ({signal}) => { calls++; assert.equal(signal.aborted, false);
      return {nonEmpty: true, replyLength: 2, jobId, reply: 'private text ignored'}; }});
  const result = await registry.check('ollama');
  assert.equal(calls, 1);
  assert.equal(result.status, 'connected');
  assert.equal(result.lastCheck.evidence.jobId, jobId);
  assert.equal(result.lastCheck.evidence.class, 'synthetic');
  assert.equal(JSON.stringify(result).includes('private text'), false);
});

test('configuration changed during a check cannot gain a connected receipt', async () => {
  // Given an in-flight check. When the provider changes during its response. Then that result is discarded.
  const env = localEnv('http://127.0.0.1:11434');
  const registry = createConnectorRegistry({env, synthetic: true, ollamaProbe: async () => {
    env.YENO_LOCAL_MODEL = 'different'; return {nonEmpty: true, replyLength: 2};
  }});
  const result = await registry.check('ollama');
  assert.equal(result.status, 'installed');
  assert.equal(result.reason, 'config_changed');
  assert.equal(result.lastCheck, null);
});
