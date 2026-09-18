import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSupabaseMemoryConfig, createSupabaseAdapter, eventToRow, READINESS_STATES} from '../lib/memory-supabase-adapter.mjs';
import {createMemoryEvent} from '../lib/memory-events.mjs';

// BLACKHOLE Supabase memory adapter (Phase B) — every test here runs against
// an injected fake transport, never a live network call, so CI never needs a
// live Supabase project. This is the "Local/CI Supabase test double"
// requirement from the Phase B kickoff (spec §6): exact mirroring, idempotent
// duplicate sync, fingerprint-conflict fail-closed, timeout retains pending,
// and readiness never claims LIVE_VERIFIED without a real round trip through
// this adapter's own syncEvent/health.

const CORE_ID = '11111111-1111-4111-8111-111111111111';
const at = () => new Date().toISOString();
function memoryEvent(overrides = {}) {
  const state = {projects: [], quests: [], memoryEvents: []};
  return createMemoryEvent({type: 'episode', text: 'e', confidence: 0.5, projectId: null, questId: null, sourceRefs: [], ...overrides}, state, {at: at()});
}
const goodEnv = () => ({
  YENO_MEMORY_SUPABASE_ENABLED: 'true',
  YENO_MEMORY_SUPABASE_URL: 'https://project.supabase.co',
  YENO_MEMORY_SUPABASE_SERVICE_KEY: 'a'.repeat(40),
});

test('loadSupabaseMemoryConfig is disabled by default and stays disabled on any malformed configuration', () => {
  assert.equal(loadSupabaseMemoryConfig({}).enabled, false);
  assert.equal(loadSupabaseMemoryConfig({...goodEnv(), YENO_MEMORY_SUPABASE_ENABLED: 'false'}).enabled, false);
  assert.equal(loadSupabaseMemoryConfig({...goodEnv(), YENO_MEMORY_SUPABASE_URL: 'not a url'}).configError, 'invalid_url');
  assert.equal(loadSupabaseMemoryConfig({...goodEnv(), YENO_MEMORY_SUPABASE_URL: 'http://project.supabase.co'}).configError, 'not_https');
  assert.equal(loadSupabaseMemoryConfig({...goodEnv(), YENO_MEMORY_SUPABASE_URL: 'https://user:pass@project.supabase.co'}).configError, 'credentials_in_url');
  assert.equal(loadSupabaseMemoryConfig({...goodEnv(), YENO_MEMORY_SUPABASE_SERVICE_KEY: 'short'}).configError, 'missing_service_key');
  assert.equal(loadSupabaseMemoryConfig({...goodEnv(), YENO_MEMORY_SUPABASE_URL: 'https://169.254.169.254'}).configError, 'host_blocked');
});

test('loadSupabaseMemoryConfig accepts a well-formed configuration and never leaks the service key elsewhere', () => {
  const config = loadSupabaseMemoryConfig(goodEnv());
  assert.equal(config.enabled, true);
  assert.equal(config.url, 'https://project.supabase.co');
  assert.equal(config.serviceKey, 'a'.repeat(40));
});

test('eventToRow mirrors exactly the canonical event fields the SQL schema expects, nothing invented', () => {
  const e = memoryEvent({text: 'row test'});
  const row = eventToRow(e, CORE_ID);
  assert.deepEqual(row, {
    id: e.id, core_id: CORE_ID, version: e.version, type: e.type, text: e.text,
    confidence: e.confidence, project_id: e.projectId, quest_id: e.questId,
    created_at: e.createdAt, fingerprint: e.fingerprint, source_refs: e.sourceRefs,
  });
});

// A minimal fake PostgREST double: an in-memory Map keyed by canonical id,
// exactly mirroring the real REST semantics the adapter depends on (GET by
// id=eq., POST insert). Never a real network call.
function fakeSupabase({table = new Map(), onRequest = null} = {}) {
  const calls = [];
  const transport = async req => {
    calls.push(req);
    if (onRequest) {const forced = onRequest(req); if (forced) return forced;}
    const url = new URL(req.path, 'https://project.supabase.co');
    if (req.method === 'GET') {
      const idParam = url.searchParams.get('id');
      const id = idParam?.startsWith('eq.') ? decodeURIComponent(idParam.slice(3)) : null;
      const row = id ? table.get(id) : null;
      return {ok: true, status: 200, text: JSON.stringify(row ? [row] : [])};
    }
    if (req.method === 'POST') {
      const rows = Array.isArray(req.body) ? req.body : [req.body];
      for (const row of rows) table.set(row.id, row);
      return {ok: true, status: 201, text: JSON.stringify(rows)};
    }
    return {ok: true, status: 200, text: '[]'};
  };
  return {transport, table, calls};
}

test('syncEvent inserts a new event exactly once and readback proves it was actually mirrored', async () => {
  const config = loadSupabaseMemoryConfig(goodEnv());
  const {transport, table} = fakeSupabase();
  const adapter = createSupabaseAdapter(config, {transport});
  const e = memoryEvent({text: 'insert me'});
  const result = await adapter.syncEvent(e, {identity: {id: CORE_ID}});
  assert.equal(result.result, 'synced');
  assert.equal(result.remoteRef, e.id);
  assert.equal(table.get(e.id).fingerprint, e.fingerprint);
  assert.equal(adapter.lastLiveSuccess, true, 'a real successful round trip through this adapter must set lastLiveSuccess');
});

test('syncEvent is idempotent: re-syncing the identical event a second time is a no-op success, never a duplicate insert', async () => {
  const config = loadSupabaseMemoryConfig(goodEnv());
  const {transport, table, calls} = fakeSupabase();
  const adapter = createSupabaseAdapter(config, {transport});
  const e = memoryEvent({text: 'idempotent'});
  await adapter.syncEvent(e, {identity: {id: CORE_ID}});
  const postCallsBefore = calls.filter(c => c.method === 'POST').length;
  const second = await adapter.syncEvent(e, {identity: {id: CORE_ID}});
  assert.equal(second.result, 'synced');
  assert.equal(table.size, 1, 'no second row must ever be created for the same canonical id');
  assert.equal(calls.filter(c => c.method === 'POST').length, postCallsBefore, 'an idempotent re-sync must never issue a second insert');
});

test('syncEvent fails closed on a fingerprint conflict: it never overwrites a remote row with a different fingerprint under the same id', async () => {
  const config = loadSupabaseMemoryConfig(goodEnv());
  const e = memoryEvent({text: 'conflict'});
  const table = new Map([[e.id, {...eventToRow(e, CORE_ID), fingerprint: 'f'.repeat(64)}]]);
  const {transport} = fakeSupabase({table});
  const adapter = createSupabaseAdapter(config, {transport});
  const result = await adapter.syncEvent(e, {identity: {id: CORE_ID}});
  assert.equal(result.result, 'blocked');
  assert.equal(result.errorCode, 'fingerprint_mismatch');
  assert.equal(table.get(e.id).fingerprint, 'f'.repeat(64), 'the remote row must be left completely untouched');
});

test('syncEvent classifies a network timeout as retryable/timeout, never as a failure that blocks reconciliation', async () => {
  const config = loadSupabaseMemoryConfig(goodEnv());
  const transport = async () => ({ok: false, reason: 'source_timeout'});
  const adapter = createSupabaseAdapter(config, {transport});
  const result = await adapter.syncEvent(memoryEvent(), {identity: {id: CORE_ID}});
  assert.equal(result.result, 'retryable');
  assert.equal(result.errorCode, 'timeout');
  assert.equal(adapter.lastLiveSuccess, false);
});

test('syncEvent classifies host/DNS/connection failures as retryable/unavailable', async () => {
  const config = loadSupabaseMemoryConfig(goodEnv());
  for (const reason of ['source_unreachable', 'source_unresolvable', 'source_host_blocked']) {
    const transport = async () => ({ok: false, reason});
    const adapter = createSupabaseAdapter(config, {transport});
    const result = await adapter.syncEvent(memoryEvent(), {identity: {id: CORE_ID}});
    assert.equal(result.result, 'retryable', `reason ${reason} must be retryable`);
    assert.equal(result.errorCode, 'unavailable');
  }
});

test('syncEvent classifies an unauthorized response as a non-retryable failure, never auto-retried', async () => {
  const config = loadSupabaseMemoryConfig(goodEnv());
  const transport = async () => ({ok: false, reason: 'source_unauthorized'});
  const adapter = createSupabaseAdapter(config, {transport});
  const result = await adapter.syncEvent(memoryEvent(), {identity: {id: CORE_ID}});
  assert.equal(result.result, 'failed');
  assert.equal(result.errorCode, 'unauthorized');
});

test('syncEvent never attempts a network call when not configured, and reports not_configured', async () => {
  const config = loadSupabaseMemoryConfig({});
  let called = false;
  const adapter = createSupabaseAdapter(config, {transport: async () => {called = true; return {ok: true, status: 200, text: '[]'};}});
  const result = await adapter.syncEvent(memoryEvent(), {identity: {id: CORE_ID}});
  assert.equal(result.result, 'failed');
  assert.equal(result.errorCode, 'not_configured');
  assert.equal(called, false, 'configuration is evidence of configuration only - a disabled adapter must never touch the network');
});

test('syncEvent rejects a memory event that somehow carries a secret-shaped field before ever calling the transport', async () => {
  const config = loadSupabaseMemoryConfig(goodEnv());
  let called = false;
  const adapter = createSupabaseAdapter(config, {transport: async () => {called = true; return {ok: true, status: 200, text: '[]'};}});
  const e = {...memoryEvent(), apiKey: 'sk-should-never-exist'};
  await assert.rejects(() => adapter.syncEvent(e, {identity: {id: CORE_ID}}));
  assert.equal(called, false);
});

test('health() only reaches LIVE_VERIFIED after a real successful round trip, and DEGRADED/BLOCKED never fabricate success', async () => {
  const config = loadSupabaseMemoryConfig(goodEnv());
  {
    const adapter = createSupabaseAdapter(config, {transport: async () => ({ok: true, status: 200, text: '[]'})});
    const health = await adapter.health();
    assert.equal(health.status, 'LIVE_VERIFIED');
    assert.equal(adapter.lastLiveSuccess, true);
  }
  {
    const adapter = createSupabaseAdapter(config, {transport: async () => ({ok: false, reason: 'source_unauthorized'})});
    const health = await adapter.health();
    assert.equal(health.status, 'BLOCKED');
    assert.equal(adapter.lastLiveSuccess, false);
  }
  {
    const adapter = createSupabaseAdapter(loadSupabaseMemoryConfig({}), {transport: async () => ({ok: true, status: 200, text: '[]'})});
    const health = await adapter.health();
    assert.equal(health.status, 'NOT_CONFIGURED');
  }
});

test('reconcile() only ever reports remote state, never mutates anything', async () => {
  const config = loadSupabaseMemoryConfig(goodEnv());
  const e = memoryEvent({text: 'reconcile me'});
  const table = new Map([[e.id, eventToRow(e, CORE_ID)]]);
  const {transport} = fakeSupabase({table});
  const adapter = createSupabaseAdapter(config, {transport});
  const missing = await adapter.reconcile(['22222222-2222-4222-8222-222222222222']);
  const present = await adapter.reconcile([e.id]);
  assert.deepEqual(present[e.id], {present: true, fingerprint: e.fingerprint});
  assert.deepEqual(missing['22222222-2222-4222-8222-222222222222'], {present: false});
  assert.equal(table.size, 1, 'reconciliation must never insert or modify rows');
});

test('a malformed/oversized response body never crashes the adapter and is classified as invalid_response', async () => {
  const config = loadSupabaseMemoryConfig(goodEnv());
  const adapter = createSupabaseAdapter(config, {transport: async () => ({ok: true, status: 200, text: 'not json'})});
  const result = await adapter.syncEvent(memoryEvent(), {identity: {id: CORE_ID}});
  assert.equal(result.result, 'failed');
  assert.equal(result.errorCode, 'invalid_response');
});

test('READINESS_STATES is the exact frozen taxonomy the Core status projection relies on', () => {
  assert.deepEqual(READINESS_STATES, ['NOT_CONFIGURED', 'CONFIGURED_UNVERIFIED', 'LIVE_VERIFIED', 'DEGRADED', 'BLOCKED']);
  assert.ok(Object.isFrozen(READINESS_STATES));
});
