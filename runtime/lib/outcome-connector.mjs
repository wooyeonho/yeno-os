import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';
import {METRICS, SOURCE_TYPES, assertNoSecrets, sha256, OutcomeVerificationError} from './outcome-verification.mjs';

// BLACKHOLE external structured outcome connector (pure, no wiring).
//
// A connector describes WHERE an external structured source lives and HOW it is
// read; a reading is the structured record set `verifyOutcome()` consumes as
// `source`. The connector never trusts a value it did not read itself from the
// declared source, never reads model output, and never carries credentials —
// the caller injects authenticated `headers`/`readFile` at read time and the
// connector only persists the source identity, the parsed records and a
// fingerprint of them. The `https_json` transport is a pinned `node:https`
// path with no generic-`fetch` fallback: see `resolveVettedAddress` (DNS
// resolved once, every address vetted, mixed public/private fails closed) and
// `fetchPinned` (the actual socket is forced onto the vetted address; one
// deadline covers connect/TLS/headers/body; the response body is capped as it
// streams in, never after a buffered read). Any malformed, unreachable,
// mismatched or secret-bearing source fails closed as `{ok:false, reason}`
// and yields `source: null`.
export const OUTCOME_CONNECTOR_VERSION = 1;
export const CONNECTOR_TRANSPORTS = Object.freeze(['https_json', 'owner_export_json']);
export const CONNECTOR_FIELDS = Object.freeze(['version', 'id', 'sourceType', 'sourceId', 'transport', 'locator', 'metrics', 'declaredBy', 'declaredAt', 'fingerprint']);
export const RECORD_FIELDS = Object.freeze(['metric', 'value', 'unit', 'timestamp']);
export const READING_FIELDS = Object.freeze(['version', 'connectorId', 'sourceType', 'sourceId', 'transport', 'readAt', 'records', 'recordsSha256', 'fingerprint']);
export const MAX_RECORDS = 500;
export const MAX_CONNECTORS = 20;
export const MAX_READINGS_PER_CONNECTOR = 20;
export const MAX_RESPONSE_BYTES = 256 * 1024;
export const READ_TIMEOUT_MS = 10_000;
const BLOCKED_HOST = /^(?:localhost|.*\.localhost|.*\.local|.*\.internal|.*\.localdomain|metadata\.google\.internal|metadata|instance-data|.*\.arpa)$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SOURCE_ID = /^[A-Za-z0-9._:\/-]{1,200}$/;
const URL_QUERY_SECRET = /[?&#](?:key|token|secret|api_key|apikey|access_token|sig|signature)=/i;
const EXPORT_PATH = /^[A-Za-z0-9._\/-]{1,300}$/;

const fail = (message, code = 'CONNECTOR_INVALID') => {throw new OutcomeVerificationError(message, code);};
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const finite = v => typeof v === 'number' && Number.isFinite(v);
const strip = (value, key) => Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));

// SSRF guard on the declared host and on any address it resolves to: only a
// public DNS name on the default HTTPS port; IP literals, loopback, private,
// link-local (cloud metadata), multicast, unspecified and CGNAT ranges fail.
export function isPublicAddress(ip) {
  if (typeof ip !== 'string') return false;
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (v4.slice(1).some(o => Number(o) > 255)) return false;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  const v6 = ip.toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(v6) || !v6.includes(':')) return false;
  if (v6 === '::' || v6 === '::1') return false;
  if (v6.startsWith('::ffff:')) return isPublicAddress(v6.slice(7));
  if (/^(?:fc|fd|fe[89ab]|ff)/.test(v6)) return false;
  return true;
}

export function hostAllowed(hostname) {
  if (typeof hostname !== 'string' || !hostname) return false;
  const h = hostname.replace(/^\[|\]$/g, '');
  if (/^[\d.]+$/.test(h) || h.includes(':')) return false;
  if (BLOCKED_HOST.test(h) || !h.includes('.')) return false;
  return true;
}

export function connectorFingerprint(connector) {return sha256(strip(connector, 'fingerprint'));}
export function readingFingerprint(reading) {return sha256(strip(reading, 'fingerprint'));}

function validateLocator(transport, locator) {
  if (typeof locator !== 'string' || !locator) fail('locator가 비어 있습니다.');
  if (transport === 'https_json') {
    let url;
    try {url = new URL(locator);} catch {fail('https_json locator는 URL이어야 합니다.');}
    if (url.protocol !== 'https:') fail('외부 source는 https로만 읽습니다.');
    if (url.port && url.port !== '443') fail('외부 source는 기본 https 포트로만 읽습니다.');
    if (!hostAllowed(url.hostname)) fail('외부 source host는 공개 DNS 이름이어야 합니다 (IP·loopback·사설망·metadata 금지).', 'CONNECTOR_HOST_BLOCKED');
    if (url.username || url.password) fail('locator에 자격증명을 넣을 수 없습니다.', 'CONNECTOR_SECRET');
    if (URL_QUERY_SECRET.test(url.search) || URL_QUERY_SECRET.test(url.hash)) fail('locator query에 비밀값을 넣을 수 없습니다.', 'CONNECTOR_SECRET');
  } else if (!EXPORT_PATH.test(locator) || locator.includes('..')) fail('owner_export_json locator는 저장소 상대 경로여야 합니다.');
}

export function validateConnector(connector) {
  if (!exact(connector, CONNECTOR_FIELDS)) fail(`connector는 정확히 ${CONNECTOR_FIELDS.join(', ')} 필드를 가져야 합니다.`);
  const c = connector;
  if (c.version !== OUTCOME_CONNECTOR_VERSION) fail('connector version이 올바르지 않습니다.');
  if (!ID.test(c.id)) fail('connector id가 올바르지 않습니다.');
  if (!Object.hasOwn(SOURCE_TYPES, c.sourceType) || !SOURCE_TYPES[c.sourceType].external) fail(`외부 구조화 source가 아닙니다: ${String(c.sourceType)}`);
  if (typeof c.sourceId !== 'string' || !SOURCE_ID.test(c.sourceId)) fail('sourceId가 올바르지 않습니다.');
  if (!CONNECTOR_TRANSPORTS.includes(c.transport)) fail(`transport는 ${CONNECTOR_TRANSPORTS.join('|')} 중 하나여야 합니다.`);
  validateLocator(c.transport, c.locator);
  if (!Array.isArray(c.metrics) || c.metrics.length === 0 || new Set(c.metrics).size !== c.metrics.length) fail('metrics는 비어 있지 않은 고유 목록이어야 합니다.');
  for (const m of c.metrics) {
    if (!Object.hasOwn(METRICS, m)) fail(`정의되지 않은 metric: ${String(m)}`);
    if (!METRICS[m].sources.includes(c.sourceType)) fail(`${m}은 ${c.sourceType} source로 검증되지 않습니다.`);
  }
  if (c.declaredBy !== 'owner') fail('connector는 owner만 선언할 수 있습니다.');
  if (!ISO.test(c.declaredAt)) fail('declaredAt은 ISO 시각이어야 합니다.');
  assertNoSecrets(strip(c, 'fingerprint'), 'connector');
  if (c.fingerprint !== connectorFingerprint(c)) fail('connector 지문이 다릅니다.', 'CONNECTOR_TAMPERED');
  return true;
}

export function createConnector(declaration, {declaredAt}) {
  if (!exact(declaration, ['id', 'sourceType', 'sourceId', 'transport', 'locator', 'metrics'])) fail('connector 선언 필드가 올바르지 않습니다.');
  const connector = {version: OUTCOME_CONNECTOR_VERSION, ...declaration, declaredBy: 'owner', declaredAt, fingerprint: null};
  connector.fingerprint = connectorFingerprint(connector);
  validateConnector(connector);
  return connector;
}

// Durable, owner-only collection. Bounded and duplicate-id-free so a store
// cannot silently accumulate unbounded external targets.
export function validateConnectors(connectors) {
  if (!Array.isArray(connectors) || connectors.length > MAX_CONNECTORS) fail('connectors는 20개 이하의 배열이어야 합니다.');
  const ids = new Set();
  for (const connector of connectors) {validateConnector(connector); if (ids.has(connector.id)) fail('중복된 connector id입니다.'); ids.add(connector.id);}
  return true;
}

// Append-only by (connectorId, fingerprint): a re-read of the same source at
// the same moment with the same claim is idempotent, never a fresh entry.
export function addConnector(connectors, connector) {
  validateConnectors(connectors); validateConnector(connector);
  if (connectors.some(item => item.id === connector.id)) fail('이미 사용 중인 connector id입니다.', 'CONNECTOR_DUPLICATE');
  if (connectors.length >= MAX_CONNECTORS) fail('connector 개수 한도에 도달했습니다.', 'CONNECTOR_CAPACITY');
  return [...connectors, connector];
}
export function removeConnector(connectors, id) {
  validateConnectors(connectors);
  if (!connectors.some(item => item.id === id)) fail('connector를 찾을 수 없습니다.', 'CONNECTOR_NOT_FOUND');
  return connectors.filter(item => item.id !== id);
}

// Structured record shape every transport must produce. Values are numbers
// read from the source; strings that look like numbers are rejected so a
// formatting change upstream cannot silently become a different outcome.
export function normalizeRecords(raw, connector) {
  if (!Array.isArray(raw)) return {ok: false, reason: 'source_not_array'};
  if (raw.length === 0) return {ok: false, reason: 'source_empty'};
  if (raw.length > MAX_RECORDS) return {ok: false, reason: 'source_too_large'};
  const records = [];
  for (const r of raw) {
    if (!exact(r, RECORD_FIELDS)) return {ok: false, reason: 'record_fields_invalid'};
    if (!connector.metrics.includes(r.metric)) return {ok: false, reason: 'record_metric_undeclared'};
    if (!finite(r.value)) return {ok: false, reason: 'record_value_not_number'};
    if (!METRICS[r.metric].units.includes(r.unit)) return {ok: false, reason: 'record_unit_invalid'};
    if (!ISO.test(r.timestamp)) return {ok: false, reason: 'record_timestamp_invalid'};
    records.push({metric: r.metric, value: r.value, unit: r.unit, timestamp: r.timestamp});
  }
  const keys = records.map(r => `${r.metric}@${r.timestamp}`);
  if (new Set(keys).size !== keys.length) return {ok: false, reason: 'record_duplicate_metric_timestamp'};
  try {assertNoSecrets(records, 'records');} catch {return {ok: false, reason: 'record_contains_secret'};}
  records.sort((a, b) => a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.metric < b.metric ? -1 : a.metric > b.metric ? 1 : 0);
  return {ok: true, records};
}

function parseJson(text) {
  if (typeof text !== 'string') return {ok: false, reason: 'source_not_text'};
  try {return {ok: true, value: JSON.parse(text)};} catch {return {ok: false, reason: 'source_not_json'};}
}

// The payload may be a bare array or `{sourceId, records}`; when the payload
// names a sourceId it must be the connector's own — a proxy answering for a
// different account is a mismatch, not a reading.
function unwrap(payload, connector) {
  if (Array.isArray(payload)) return {ok: true, raw: payload};
  if (payload && typeof payload === 'object' && Array.isArray(payload.records)) {
    if (Object.hasOwn(payload, 'sourceId') && payload.sourceId !== connector.sourceId) return {ok: false, reason: 'source_id_mismatch'};
    return {ok: true, raw: payload.records};
  }
  return {ok: false, reason: 'source_shape_invalid'};
}

// --- DNS pinning (H1: no uncontrolled second resolution) -------------------
//
// The declared host is resolved exactly ONCE, through `resolve` (real DNS by
// default). Every address the name currently has must be public - a single
// accepted private answer is enough for a rebinding attacker, so a mixed
// public/private answer set fails closed exactly like an all-private one.
// The chosen address is then forced onto the actual socket via Node's own
// `lookup` hook (below), so nothing re-resolves the hostname independently
// between this check and the real connection - there is no window for a
// second DNS answer to differ from the one we vetted.
async function defaultResolve(hostname) {
  return dns.promises.lookup(hostname, {all: true, verbatim: true});
}

// Races a promise against a hard wall-clock deadline. The loser's eventual
// settlement (a slow DNS answer arriving after the deadline) is discarded -
// it can still update internal resolver caches, but it can never reach the
// caller and can never cause a socket to be opened after time is up.
function raceDeadline(promise, deadlineAt) {
  return new Promise(resolve => {
    let settled = false;
    // Infinity (no deadline given) means genuinely no timer, not a 1ms one:
    // `setTimeout` cannot take an infinite duration.
    const timer = Number.isFinite(deadlineAt) ? setTimeout(() => {if (!settled) {settled = true; resolve({timedOut: true});}}, Math.max(0, deadlineAt - Date.now())) : null;
    promise.then(
      value => {if (!settled) {settled = true; if (timer) clearTimeout(timer); resolve({timedOut: false, value});}},
      error => {if (!settled) {settled = true; if (timer) clearTimeout(timer); resolve({timedOut: false, error});}}
    );
  });
}

// `deadlineAt` is the SAME wall-clock deadline the caller's whole read shares
// (DNS + connect + TLS + headers + body) - not a fresh budget for DNS alone.
// A resolver that is still running when the deadline passes is timed out
// here, before any request is ever constructed.
export async function resolveVettedAddress(hostname, {resolve = defaultResolve, deadlineAt = Infinity} = {}) {
  if (Date.now() >= deadlineAt) return {ok: false, reason: 'source_timeout'};
  const raced = await raceDeadline(Promise.resolve().then(() => resolve(hostname)), deadlineAt);
  if (raced.timedOut) return {ok: false, reason: 'source_timeout'};
  if (raced.error) return {ok: false, reason: 'source_unresolvable'};
  // The deadline can pass in the gap between the resolver settling and this
  // check running (e.g. it returned right at the wire) - still refuse to
  // open a socket with no time left rather than borrow from nowhere.
  if (Date.now() >= deadlineAt) return {ok: false, reason: 'source_timeout'};
  const answers = raced.value;
  const list = (Array.isArray(answers) ? answers : [answers])
    .map(a => typeof a === 'string' ? {address: a, family: net.isIP(a) || 4} : a)
    .filter(a => a && typeof a.address === 'string');
  if (list.length === 0) return {ok: false, reason: 'source_unresolvable'};
  if (!list.every(a => isPublicAddress(a.address))) return {ok: false, reason: 'source_host_blocked'};
  const chosen = list[0];
  return {ok: true, address: chosen.address, family: chosen.family === 6 ? 6 : 4};
}

// --- pinned transport (H2: one deadline, bounded body, no fallback) --------
//
// A real `node:https` request whose `lookup` hook always answers with the
// address `resolveVettedAddress` already vetted - the hostname is preserved
// for TLS SNI/certificate validation and for the Host header, but the actual
// TCP connection can never land anywhere else. Redirects are never followed
// (the core `https` module does not auto-follow; a 3xx is treated as a
// failure). The response is read as a stream so the byte cap is enforced on
// real bytes received, never on a Content-Length claim or a buffered
// `.text()`. One timer, started before the request, covers connect + TLS +
// headers + body; the socket is destroyed the instant the cap or the
// deadline is hit.
export function fetchPinned(url, {address, family, headers = {}, timeoutMs = READ_TIMEOUT_MS, maxBytes = MAX_RESPONSE_BYTES, request = https.request} = {}) {
  return new Promise(settle => {
    let done = false, req = null;
    const finish = result => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (req) req.destroy();
      settle(result);
    };
    const timer = setTimeout(() => finish({ok: false, reason: 'source_timeout'}), Math.max(0, timeoutMs));
    try {
      req = request({
        protocol: 'https:', hostname: url.hostname, host: url.hostname, port: 443,
        path: `${url.pathname}${url.search}`, method: 'GET', servername: url.hostname,
        headers: {accept: 'application/json', 'accept-encoding': 'identity', host: url.hostname, ...headers},
        // Only this address is ever dialed - Node calls this once per connect
        // and never falls back to its own resolver for this request.
        lookup: (_hostname, _options, callback) => callback(null, address, family)
      }, res => {
        if (done) {res.destroy(); return;}
        if (res.statusCode >= 300 && res.statusCode < 400) {res.resume(); return finish({ok: false, reason: 'source_redirected'});}
        if (res.statusCode === 401 || res.statusCode === 403) {res.resume(); return finish({ok: false, reason: 'source_unauthorized'});}
        if (res.statusCode !== 200) {res.resume(); return finish({ok: false, reason: `source_http_${res.statusCode}`});}
        const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
        if (encoding && encoding !== 'identity') {res.destroy(); return finish({ok: false, reason: 'source_compressed_response'});}
        // Content-Type must be explicit: a missing header is not an implicit
        // "trust me, it's JSON" - only application/json or application/*+json.
        const contentType = res.headers['content-type'];
        if (!contentType || !/^application\/(?:[a-z0-9.+-]+\+)?json\b/i.test(contentType)) {res.destroy(); return finish({ok: false, reason: 'source_not_json'});}
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) {res.destroy(); return finish({ok: false, reason: 'source_too_large'});}
        const chunks = [];
        let total = 0;
        res.on('data', chunk => {
          if (done) return;
          total += chunk.length;
          // Real bytes received, never the header's claim: a short declared
          // Content-Length followed by a longer body is caught here too.
          if (total > maxBytes) return finish({ok: false, reason: 'source_too_large'});
          chunks.push(chunk);
        });
        res.on('end', () => finish({ok: true, text: Buffer.concat(chunks).toString('utf8')}));
        res.on('error', () => finish({ok: false, reason: 'source_unreadable'}));
      });
    } catch {
      return finish({ok: false, reason: 'source_unreachable'});
    }
    req.on('error', () => finish({ok: false, reason: 'source_unreachable'}));
    req.end();
  });
}

async function transportRead(connector, {readFile, headers, resolve, request, timeoutMs}) {
  if (connector.transport === 'https_json') {
    const url = new URL(connector.locator);
    if (!hostAllowed(url.hostname)) return {ok: false, reason: 'source_host_blocked'};
    // One deadline for the whole read - DNS is not a separate budget. Whatever
    // time DNS spends comes out of the same clock the body/timeout below uses.
    const deadlineAt = Date.now() + timeoutMs;
    const vetted = await resolveVettedAddress(url.hostname, {resolve, deadlineAt});
    // Fail closed before any request object is ever constructed: an
    // unresolvable, non-public, or already-out-of-time answer means no
    // socket is opened at all.
    if (!vetted.ok) return vetted;
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) return {ok: false, reason: 'source_timeout'};
    return await fetchPinned(url, {address: vetted.address, family: vetted.family, headers: headers ?? {}, timeoutMs: remainingMs, request});
  }
  if (typeof readFile !== 'function') return {ok: false, reason: 'transport_unconfigured'};
  try {return {ok: true, text: await readFile(connector.locator)};} catch {return {ok: false, reason: 'source_unreachable'};}
}

// Read the source now. `deps` carries the injected I/O; credentials live in the
// caller's `headers` and are never echoed into the reading or the failure.
// There is no generic-`fetch` escape hatch: the https_json transport always
// goes through the pinned path above, real DNS and real sockets by default.
export async function readConnector(connector, {readAt, readFile = null, headers = null, resolve = null, request = null, timeoutMs = READ_TIMEOUT_MS} = {}) {
  validateConnector(connector);
  if (!ISO.test(readAt)) fail('readAt은 ISO 시각이어야 합니다.');
  if (headers !== null && (typeof headers !== 'object' || Array.isArray(headers))) fail('headers는 객체여야 합니다.');
  const got = await transportRead(connector, {readFile, headers, resolve: resolve ?? undefined, request: request ?? undefined, timeoutMs});
  if (!got.ok) return {ok: false, reason: got.reason, reading: null};
  const parsed = parseJson(got.text);
  if (!parsed.ok) return {ok: false, reason: parsed.reason, reading: null};
  const wrapped = unwrap(parsed.value, connector);
  if (!wrapped.ok) return {ok: false, reason: wrapped.reason, reading: null};
  const normalized = normalizeRecords(wrapped.raw, connector);
  if (!normalized.ok) return {ok: false, reason: normalized.reason, reading: null};
  const reading = {
    version: OUTCOME_CONNECTOR_VERSION, connectorId: connector.id, sourceType: connector.sourceType, sourceId: connector.sourceId,
    transport: connector.transport, readAt, records: normalized.records, recordsSha256: sha256(normalized.records), fingerprint: null
  };
  reading.fingerprint = readingFingerprint(reading);
  return {ok: true, reason: null, reading};
}

export function validateReading(reading) {
  if (!exact(reading, READING_FIELDS)) fail(`reading은 정확히 ${READING_FIELDS.join(', ')} 필드를 가져야 합니다.`);
  if (reading.version !== OUTCOME_CONNECTOR_VERSION || !ID.test(reading.connectorId) || !ISO.test(reading.readAt)) fail('reading 값이 올바르지 않습니다.');
  if (!Object.hasOwn(SOURCE_TYPES, reading.sourceType) || !SOURCE_ID.test(reading.sourceId ?? '') || !CONNECTOR_TRANSPORTS.includes(reading.transport)) fail('reading source 식별자가 올바르지 않습니다.');
  if (!Array.isArray(reading.records) || reading.records.length === 0 || !reading.records.every(r => exact(r, RECORD_FIELDS))) fail('reading records가 올바르지 않습니다.');
  if (reading.recordsSha256 !== sha256(reading.records)) fail('reading records 지문이 다릅니다.', 'READING_TAMPERED');
  if (reading.fingerprint !== readingFingerprint(reading)) fail('reading 지문이 다릅니다.', 'READING_TAMPERED');
  assertNoSecrets(reading, 'reading');
  return true;
}

// Durable, per-connector-bounded collection: only the most recent
// MAX_READINGS_PER_CONNECTOR readings for any one connector are kept, so a
// scheduled/owner-triggered re-read cannot grow the store without bound.
export function validateReadings(readings) {
  if (!Array.isArray(readings)) fail('readings는 배열이어야 합니다.');
  const perConnector = new Map();
  for (const reading of readings) {
    validateReading(reading);
    perConnector.set(reading.connectorId, (perConnector.get(reading.connectorId) ?? 0) + 1);
  }
  for (const count of perConnector.values()) if (count > MAX_READINGS_PER_CONNECTOR) fail('connector당 readings 개수 한도를 초과했습니다.');
  return true;
}
export function addReading(readings, reading) {
  validateReadings(readings); validateReading(reading);
  if (readings.some(item => item.fingerprint === reading.fingerprint)) return readings;
  const kept = readings.filter(item => item.connectorId !== reading.connectorId).concat(readings.filter(item => item.connectorId === reading.connectorId).slice(-(MAX_READINGS_PER_CONNECTOR - 1)));
  const next = [...kept, reading].sort((a, b) => a.readAt < b.readAt ? -1 : 1);
  validateReadings(next);
  return next;
}

// Adapter into `verifyOutcome({source})`. A reading from a different connector
// than the evidence claims is not a source at all (null → source_unavailable).
export function toVerificationSource(reading, evidence) {
  validateReading(reading);
  if (reading.sourceType !== evidence.sourceType || reading.sourceId !== evidence.sourceId) return null;
  return {sourceType: reading.sourceType, sourceId: reading.sourceId, records: reading.records.map(r => ({...r}))};
}

// Readiness of the connector layer, in the shared taxonomy. A declared
// connector without a successful reading is WIRED_UNVERIFIED; only a reading
// that was actually taken over the network from the declared https source is
// LIVE_VERIFIED. Owner exports are structured but not live.
export function connectorReadiness(connectors, readings) {
  if (!Array.isArray(connectors) || connectors.length === 0) return {status: 'NOT_WIRED', reason: 'no_connector_declared'};
  const ok = (readings ?? []).filter(r => {try {validateReading(r); return true;} catch {return false;}});
  if (ok.length === 0) return {status: 'WIRED_UNVERIFIED', reason: 'no_successful_reading'};
  if (ok.some(r => r.transport === 'https_json')) return {status: 'LIVE_VERIFIED', reason: null};
  return {status: 'SYNTHETIC_VERIFIED', reason: 'owner_export_only'};
}
