import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGENT_ENDPOINTS, agentConfigForProvider, agentProfiles } from '../lib/provider-config-engine.mjs';
import { agentConfig as runtimeAgentConfig } from '../lib/provider-config.mjs';
import { openStore } from '../lib/store.mjs';
import { runAgent } from '../lib/agent-engine.mjs';
import { DesktopProviderConfigError, validateDesktopProviders, desktopProviderEnvironment, desktopProviderSummary } from '../lib/desktop-provider-config.mjs';

const fixture = () => ({ version: 1, primaryProvider: 'openai', dailyCallLimit: 6,
  providers: Object.keys(AGENT_ENDPOINTS).map(provider => ({ provider, model: `fixture-${provider}-model`, apiKey: `synthetic-key-for-${provider}-NOT-LIVE` })) });
const bad = input => assert.throws(() => validateDesktopProviders(input), error => error instanceof DesktopProviderConfigError
  && error.code === 'invalid_desktop_provider_configuration' && error.message === 'Desktop provider configuration is invalid.');

test('six desktop providers reuse the real engine with their own fixed endpoint/key/model and one shared daily bound', () => {
  const input = fixture();
  const env = desktopProviderEnvironment(input);
  for (const entry of input.providers) {
    const selected = agentConfigForProvider(env, entry.provider);
    assert.equal(selected.ready, true);
    assert.equal(selected.provider, entry.provider);
    assert.equal(selected.model, entry.model);
    assert.equal(selected.key, entry.apiKey);
    assert.equal(selected.endpoint, AGENT_ENDPOINTS[entry.provider]);
    assert.equal(selected.dailyCallLimit, 6);
    assert.equal(selected.auto, false);
    assert.equal(selected.backgroundModelCalls, false);
  }
  const profiles = agentProfiles(env);
  assert.equal(profiles.primary.provider, 'openai');
  assert.equal(profiles.grok.ready, true);
  assert.equal(profiles.grok.dailyCallLimit, 6);
  assert.equal(profiles.grok.key, input.providers.find(entry => entry.provider === 'xai').apiKey);
});

test('configuration presence never authenticates a model, enables AI settings, or exposes private keys', t => {
  const input = fixture();
  const summary = desktopProviderSummary(input);
  assert.equal(summary.configured, true);
  assert.equal(summary.liveVerification, 'not_checked');
  assert.equal(summary.automaticCalls, false);
  assert.equal(summary.providers.length, 6);
  assert(summary.providers.every(entry => entry.status === 'configured' && entry.liveVerification === 'not_checked'));
  for (const entry of input.providers) assert(!JSON.stringify(summary).includes(entry.apiKey));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-desktop-provider-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = openStore(dir);
  const before = structuredClone(store.state.modules);
  desktopProviderEnvironment(input);
  assert.deepEqual(store.state.modules, before);
  assert.equal(store.state.modules.ai, false);
});

test('empty credentials stay offline and selecting a missing provider never borrows another provider key', () => {
  const empty = { version: 1, providers: [], primaryProvider: null, dailyCallLimit: 1 };
  const summary = desktopProviderSummary(empty);
  assert.equal(summary.configured, false);
  assert.equal(summary.primaryProvider, null);
  assert(summary.providers.every(entry => !entry.configured && entry.model === null));
  const input = fixture(); input.providers = input.providers.filter(entry => entry.provider === 'openai');
  const env = desktopProviderEnvironment(input);
  const missing = agentConfigForProvider(env, 'gemini');
  assert.equal(missing.ready, false);
  assert.equal(missing.key, '');
  assert.equal(agentProfiles(env).grok.ready, false);
  assert.equal(desktopProviderSummary(input).providers.filter(entry => entry.configured).length, 1);
});

test('strict schema rejects arbitrary endpoints, aliases, model guesses, secrets as labels, duplicate entries, controls and unsupported budget knobs', () => {
  for (const limit of [0, 21, 1.5, '6', NaN, Infinity]) bad({ ...fixture(), dailyCallLimit: limit });
  for (const patch of [{ version: 2 }, { primaryProvider: 'auto' }, { primaryProvider: 'constructor' }, { primaryProvider: null },
    { endpoint: 'https://example.invalid' }, { maxCallsPerJob: 1 }, { enabled: true }, { providers: null }]) bad({ ...fixture(), ...patch });
  for (const patch of [{ provider: 'grok' }, { provider: 'kimi' }, { provider: '__proto__' }, { provider: 'constructor' },
    { endpoint: 'https://example.invalid' }, { model: '' }, { model: 'm'.repeat(121) }, { model: 'https://example.invalid/model' },
    { model: 'sk-secret-accidentally-pasted' }, { model: 'bad\nmodel' }, { model: ' model' }, { apiKey: '' }, { apiKey: 'short' },
    { apiKey: 'secret\nheader' }, { apiKey: 'secret with space' }, { apiKey: 'secret\u007fheader' }, { apiKey: 'k'.repeat(4097) }]) {
    const input = fixture(); input.providers[0] = { ...input.providers[0], ...patch }; bad(input);
  }
  const duplicate = fixture(); duplicate.providers[1] = { ...duplicate.providers[0] }; bad(duplicate);
  const leaked = fixture(); leaked.providers[0].model = leaked.providers[1].apiKey; bad(leaked);
  const sparse = fixture(); delete sparse.providers[0]; bad(sparse);
  const hidden = fixture(); hidden.providers.secret = 'private'; bad(hidden);
  const symbol = fixture(); symbol[Symbol('secret')] = 'private'; bad(symbol);
  let read = false;
  const getter = fixture(); Object.defineProperty(getter, 'providers', { enumerable: true, get() { read = true; throw new Error('secret'); } });
  bad(getter); assert.equal(read, false);
});

test('configuration is detached, preserves exact user model IDs and bounds, and errors do not echo supplied secrets', () => {
  const input = fixture(); input.providers[0].model = 'owner-declared/model-1:preview';
  const result = validateDesktopProviders(input);
  assert.deepEqual(result, input);
  result.providers[0].apiKey = 'modified-copy';
  assert.notEqual(input.providers[0].apiKey, result.providers[0].apiKey);
  assert.equal(desktopProviderEnvironment({ ...input, dailyCallLimit: 20 }).YENO_AGENT_DAILY_CALL_LIMIT, '20');
  const secret = 'private-secret-should-never-be-in-an-error';
  const malformed = { ...input, privateEndpoint: secret };
  for (const operation of [validateDesktopProviders, desktopProviderEnvironment, desktopProviderSummary]) {
    assert.throws(() => operation(malformed), error => !String(error.stack).includes(secret)
      && !JSON.stringify(error).includes(secret) && error instanceof DesktopProviderConfigError);
  }
});

test('fresh environment rejects inherited provider, development automation and generic credential state', t => {
  const poison = { YENO_GEMINI_API_KEY: 'secret-inherited-gemini-key', YENO_GEMINI_MODEL: 'inherited-model',
    YENO_AGENT_API_KEY: 'secret-generic-key', YENO_AGENT_MODEL: 'inherited-model', YENO_AGENT_AUTORUN: 'true',
    YENO_DEVELOPMENT_BACKGROUND_MODEL_CALLS: 'true', NODE_ENV: 'development', YENO_AI_API_KEY: 'secret-legacy-key',
    YENO_AI_BASE_URL: 'https://unexpected.invalid', YENO_BRAIN_POOL: 'untrusted-inherited-pool' };
  const previous = Object.fromEntries(Object.keys(poison).map(key => [key, process.env[key]]));
  Object.assign(process.env, poison);
  t.after(() => { for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value; });
  const input = fixture(); input.providers = input.providers.filter(entry => entry.provider === 'openai');
  const env = desktopProviderEnvironment(input);
  const actual = runtimeAgentConfig(env);
  assert.equal(actual.auto, false);
  assert.equal(actual.backgroundModelCalls, false);
  assert.equal(actual.providers.find(entry => entry.provider === 'gemini').configured, false);
  for (const name of ['YENO_AGENT_API_KEY', 'YENO_AGENT_MODEL', 'YENO_GEMINI_API_KEY', 'YENO_AI_API_KEY', 'YENO_AI_BASE_URL', 'YENO_BRAIN_POOL']) assert(!Object.hasOwn(env, name));
  assert.equal(env.NODE_ENV, 'production');
});

test('existing execution engine retains output-token cap, call ledger and no-resend policy with the desktop environment (synthetic transport)', async () => {
  const input = fixture();
  input.dailyCallLimit = 1;
  for (const entry of input.providers) {
    const config = agentConfigForProvider(desktopProviderEnvironment(input), entry.provider);
    const job = { id: `synthetic-${entry.provider}`, input: 'Test bounded response', voiceConversation: true, callLimit: 1 };
    const state = { jobs: [job] };
    let sends = 0, saves = 0;
    const text = await runAgent({ job, state, config, save: () => { saves++; }, signal: new AbortController().signal,
      fetchImpl: async (endpoint, options) => {
        sends++;
        assert.equal(job.agentJournal.calls.length, 1);
        assert.equal(job.agentJournal.calls[0].status, 'reserved');
        assert.equal(endpoint, AGENT_ENDPOINTS[entry.provider]);
        assert.equal(options.redirect, 'error');
        const body = JSON.parse(options.body);
        assert.equal(body.model, entry.model);
        assert.equal(body.max_completion_tokens ?? body.max_tokens, 3072);
        assert.equal(body.tools, undefined);
        const payload = entry.provider === 'anthropic' ? { stop_reason: 'end_turn', content: [{ type: 'text', text: 'synthetic-result' }], usage: { input_tokens: 1, output_tokens: 1 } }
          : { choices: [{ finish_reason: 'stop', message: { content: 'synthetic-result' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
        return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
      } });
    assert.equal(text, 'synthetic-result');
    assert.equal(sends, 1); assert(saves > 0);
    assert.equal(job.agentJournal.calls[0].status, 'settled');
    const next = { id: 'synthetic-next', input: 'No extra call', voiceConversation: true, callLimit: 1 };
    state.jobs.push(next);
    await assert.rejects(runAgent({ job: next, state, config, save: () => {}, signal: new AbortController().signal,
      fetchImpl: async () => { throw new Error('must not send'); } }), error => error.code === 'daily_call_limit');
    const unknown = structuredClone(job); unknown.agentJournal.calls[0].status = 'unknown';
    await assert.rejects(runAgent({ job: unknown, state, config, save: () => {}, signal: new AbortController().signal,
      fetchImpl: async () => { throw new Error('must not resend'); } }), error => error.code === 'previous_call_outcome_unknown');
  }
});
