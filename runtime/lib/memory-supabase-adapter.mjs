import https from 'node:https';
import {hostAllowed, resolveVettedAddress} from './outcome-connector.mjs';
import {assertNoSecrets} from './outcome-verification.mjs';

// BLACKHOLE Supabase memory adapter (Phase B).
//
// Supabase is an external durable/searchable mirror of the canonical local
// Memory Event - never a competing source of truth, and this module contains
// no business rules about what a memory event means (that stays entirely in
// memory-events.mjs/blackhole-core.mjs). It only knows how to durably mirror
// an already-validated event to a configured PostgREST endpoint and read it
// back, behind an injectable transport so CI never needs a live project.
//
// Reuses the exact SSRF-safe DNS-pinning primitives (hostAllowed,
// resolveVettedAddress) outcome-connector.mjs already built and tested,
// rather than reimplementing host validation for a second HTTPS client.
export const SUPABASE_ADAPTER_VERSION = 1;
export const READINESS_STATES = Object.freeze(['NOT_CONFIGURED', 'CONFIGURED_UNVERIFIED', 'LIVE_VERIFIED', 'DEGRADED', 'BLOCKED']);
export const MAX_RESPONSE_BYTES = 256 * 1024;
export const READ_TIMEOUT_MS = 10_000;
const SCHEMA = 'blackhole';
const TABLE = 'memory_events';

// Configuration is explicit and disabled by default; a missing or malformed
// value never silently degrades to "on" - it degrades to NOT_CONFIGURED,
// which never attempts a network call at all.
export function loadSupabaseMemoryConfig(env) {
  const disabled = {enabled: false, url: null, serviceKey: null, configError: null};
  if (env.YENO_MEMORY_SUPABASE_ENABLED !== 'true') return disabled;
  const rawUrl = env.YENO_MEMORY_SUPABASE_URL ?? '';
  const serviceKey = env.YENO_MEMORY_SUPABASE_SERVICE_KEY ?? '';
  let parsed;
  try {parsed = new URL(rawUrl);} catch {return {...disabled, configError: 'invalid_url'};}
  if (parsed.protocol !== 'https:') return {...disabled, configError: 'not_https'};
  if (parsed.username || parsed.password) return {...disabled, configError: 'credentials_in_url'};
  if (parsed.port && parsed.port !== '443') return {...disabled, configError: 'non_default_port'};
  if (!hostAllowed(parsed.hostname)) return {...disabled, configError: 'host_blocked'};
  if (typeof serviceKey !== 'string' || serviceKey.length < 20) return {...disabled, configError: 'missing_service_key'};
  return {enabled: true, url: parsed.origin, serviceKey, configError: null};
}

// A row is exactly the searchable-metadata mirror the SQL spec defines - the
// canonical event's own fields, never a derived or re-interpreted shape.
export function eventToRow(event, coreId) {
  return {
    id: event.id, core_id: coreId, version: event.version, type: event.type, text: event.text,
    confidence: event.confidence, project_id: event.projectId, quest_id: event.questId,
    created_at: event.createdAt, fingerprint: event.fingerprint, source_refs: event.sourceRefs,
  };
}

function classifyTransportFailure(result) {
  if (result.reason === 'source_timeout') return {result: 'retryable', errorCode: 'timeout'};
  if (['source_unreachable', 'source_unresolvable', 'source_host_blocked'].includes(result.reason)) return {result: 'retryable', errorCode: 'unavailable'};
  if (result.reason === 'source_unauthorized') return {result: 'failed', errorCode: 'unauthorized'};
  return {result: 'failed', errorCode: 'invalid_response'};
}

// The real, default transport: a pinned node:https request identical in
// security posture to outcome-connector.mjs's fetchPinned, generalized to
// carry a method/JSON body for PostgREST writes. Never follows a redirect,
// never trusts a declared Content-Length over real bytes received, one
// deadline covers DNS + connect + TLS + headers + body.
function defaultTransport(config) {
  return async function send({method, path, body, headers = {}}) {
    const url = new URL(path, config.url);
    if (url.protocol !== 'https:' || !hostAllowed(url.hostname)) return {ok: false, reason: 'source_host_blocked'};
    const deadlineAt = Date.now() + READ_TIMEOUT_MS;
    const vetted = await resolveVettedAddress(url.hostname, {deadlineAt});
    if (!vetted.ok) return vetted;
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    return new Promise(settle => {
      let done = false, req = null;
      const finish = result => {if (done) return; done = true; clearTimeout(timer); if (req) req.destroy(); settle(result);};
      const timer = setTimeout(() => finish({ok: false, reason: 'source_timeout'}), Math.max(0, deadlineAt - Date.now()));
      try {
        req = https.request({
          protocol: 'https:', hostname: url.hostname, host: url.hostname, port: 443,
          path: `${url.pathname}${url.search}`, method, servername: url.hostname,
          headers: {
            accept: 'application/json', 'accept-encoding': 'identity', host: url.hostname,
            apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}`,
            'content-profile': SCHEMA, 'accept-profile': SCHEMA,
            ...(payload ? {'content-type': 'application/json', 'content-length': String(payload.length)} : {}),
            ...headers,
          },
          lookup: (_hostname, _options, callback) => callback(null, vetted.address, vetted.family),
        }, res => {
          if (done) {res.destroy(); return;}
          if (res.statusCode >= 300 && res.statusCode < 400) {res.resume(); return finish({ok: false, reason: 'source_redirected'});}
          if (res.statusCode === 401 || res.statusCode === 403) {res.resume(); return finish({ok: false, reason: 'source_unauthorized'});}
          const declared = Number(res.headers['content-length']);
          if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {res.destroy(); return finish({ok: false, reason: 'source_too_large'});}
          const chunks = [];
          let total = 0;
          res.on('data', chunk => {
            if (done) return;
            total += chunk.length;
            if (total > MAX_RESPONSE_BYTES) return finish({ok: false, reason: 'source_too_large'});
            chunks.push(chunk);
          });
          res.on('end', () => finish({ok: true, status: res.statusCode, text: Buffer.concat(chunks).toString('utf8')}));
          res.on('error', () => finish({ok: false, reason: 'source_unreadable'}));
        });
      } catch {return finish({ok: false, reason: 'source_unreachable'});}
      req.on('error', () => finish({ok: false, reason: 'source_unreachable'}));
      if (payload) req.write(payload);
      req.end();
    });
  };
}

function parseRows(text) {
  let parsed;
  try {parsed = JSON.parse(text);} catch {return null;}
  return Array.isArray(parsed) ? parsed : null;
}

// createSupabaseAdapter(config, {transport, now}) — `transport` defaults to
// the real pinned HTTPS client above; tests inject a fake
// `async ({method,path,body,headers}) => ({ok,status,text}|{ok:false,reason})`
// so CI never needs a live Supabase project (see the Phase B kickoff's
// "Local/CI Supabase test double" requirement). `configured()` is evidence of
// configuration only, never of a successful sync - readiness only ever
// reaches LIVE_VERIFIED after this adapter's own health()/syncEvent() call
// actually round-trips successfully.
export function createSupabaseAdapter(config, {transport, now = () => new Date().toISOString()} = {}) {
  const send = transport ?? defaultTransport(config);
  let lastLiveSuccess = false;

  function configured() {return config.enabled === true;}

  async function health() {
    if (!config.enabled) return {status: 'NOT_CONFIGURED', reason: config.configError};
    const result = await send({method: 'GET', path: `/rest/v1/${TABLE}?select=id&limit=1`});
    if (!result.ok) {
      const failure = classifyTransportFailure(result);
      return {status: failure.errorCode === 'unauthorized' ? 'BLOCKED' : 'DEGRADED', reason: failure.errorCode};
    }
    if (result.status >= 400) return {status: 'DEGRADED', reason: 'invalid_response'};
    lastLiveSuccess = true;
    return {status: 'LIVE_VERIFIED', reason: null};
  }

  // Read-before-write idempotency: an existing remote row with the identical
  // fingerprint is treated as already synced (no-op success); a different
  // fingerprint under the same canonical id is a conflict this code must
  // never resolve by overwriting.
  async function getEvent(id) {
    const result = await send({method: 'GET', path: `/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`});
    if (!result.ok) return {ok: false, ...classifyTransportFailure(result)};
    if (result.status >= 400) return {ok: false, result: 'failed', errorCode: 'invalid_response'};
    const rows = parseRows(result.text);
    if (rows === null) return {ok: false, result: 'failed', errorCode: 'invalid_response'};
    return {ok: true, row: rows[0] ?? null};
  }

  async function syncEvent(event, core) {
    assertNoSecrets(event, 'memoryEvent');
    if (!config.enabled) return {result: 'failed', errorCode: 'not_configured'};
    const existing = await getEvent(event.id);
    if (!existing.ok) return {result: existing.result, errorCode: existing.errorCode};
    if (existing.row) {
      if (existing.row.fingerprint === event.fingerprint) {lastLiveSuccess = true; return {result: 'synced', remoteRef: existing.row.id};}
      return {result: 'blocked', errorCode: 'fingerprint_mismatch'};
    }
    const row = eventToRow(event, core.identity.id);
    const inserted = await send({method: 'POST', path: `/rest/v1/${TABLE}`, body: [row], headers: {prefer: 'return=representation,resolution=merge-duplicates'}});
    if (!inserted.ok) return classifyTransportFailure(inserted);
    if (inserted.status === 409) return {result: 'blocked', errorCode: 'remote_conflict'};
    if (inserted.status >= 400) return {result: 'failed', errorCode: 'invalid_response'};
    const rows = parseRows(inserted.text);
    if (rows === null || !rows[0]?.id) return {result: 'failed', errorCode: 'invalid_response'};
    lastLiveSuccess = true;
    return {result: 'synced', remoteRef: rows[0].id};
  }

  async function listByFilter(filterQuery) {
    if (!config.enabled) return {ok: false, result: 'failed', errorCode: 'not_configured'};
    const result = await send({method: 'GET', path: `/rest/v1/${TABLE}?${filterQuery}&select=*&order=created_at.desc&limit=100`});
    if (!result.ok) return {ok: false, ...classifyTransportFailure(result)};
    if (result.status >= 400) return {ok: false, result: 'failed', errorCode: 'invalid_response'};
    const rows = parseRows(result.text);
    if (rows === null) return {ok: false, result: 'failed', errorCode: 'invalid_response'};
    lastLiveSuccess = true;
    return {ok: true, rows};
  }
  const listByProject = projectId => listByFilter(`project_id=eq.${encodeURIComponent(projectId)}`);
  const listByType = type => listByFilter(`type=eq.${encodeURIComponent(type)}`);
  // Exact metadata filters only in Phase B (see spec §7); no synthesized text.
  const searchMetadata = filters => listByFilter(Object.entries(filters).map(([key, value]) => `${key}=eq.${encodeURIComponent(value)}`).join('&'));

  // Reconciliation never overwrites: it only reports, per event id, whether
  // the remote fingerprint now agrees, so a caller can decide whether a
  // previously blocked/failed item may safely be requeued.
  async function reconcile(eventIds) {
    const out = {};
    for (const id of eventIds) {
      const existing = await getEvent(id);
      out[id] = existing.ok ? (existing.row ? {present: true, fingerprint: existing.row.fingerprint} : {present: false}) : {present: null, errorCode: existing.errorCode};
    }
    return out;
  }

  return {configured, health, syncEvent, getEvent: id => getEvent(id), listByProject, listByType, searchMetadata, reconcile, get lastLiveSuccess() {return lastLiveSuccess;}};
}
