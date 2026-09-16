import {METRICS, SOURCE_TYPES, assertNoSecrets, sha256, OutcomeVerificationError} from './outcome-verification.mjs';

// BLACKHOLE external structured outcome connector (pure, no wiring).
//
// A connector describes WHERE an external structured source lives and HOW it is
// read; a reading is the structured record set `verifyOutcome()` consumes as
// `source`. The connector never trusts a value it did not read itself from the
// declared source, never reads model output, and never carries credentials —
// the caller injects an authenticated `fetch`/`readFile` at read time and the
// connector only persists the source identity, the parsed records and a
// fingerprint of them. Any malformed, unreachable, mismatched or secret-bearing
// source fails closed as `{ok:false, reason}` and yields `source: null`.
export const OUTCOME_CONNECTOR_VERSION = 1;
export const CONNECTOR_TRANSPORTS = Object.freeze(['https_json', 'owner_export_json']);
export const CONNECTOR_FIELDS = Object.freeze(['version', 'id', 'sourceType', 'sourceId', 'transport', 'locator', 'metrics', 'declaredBy', 'declaredAt', 'fingerprint']);
export const RECORD_FIELDS = Object.freeze(['metric', 'value', 'unit', 'timestamp']);
export const READING_FIELDS = Object.freeze(['version', 'connectorId', 'sourceType', 'sourceId', 'transport', 'readAt', 'records', 'recordsSha256', 'fingerprint']);
export const MAX_RECORDS = 500;
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

export function connectorFingerprint(connector) {return sha256(strip(connector, 'fingerprint'));}
export function readingFingerprint(reading) {return sha256(strip(reading, 'fingerprint'));}

function validateLocator(transport, locator) {
  if (typeof locator !== 'string' || !locator) fail('locator가 비어 있습니다.');
  if (transport === 'https_json') {
    let url;
    try {url = new URL(locator);} catch {fail('https_json locator는 URL이어야 합니다.');}
    if (url.protocol !== 'https:') fail('외부 source는 https로만 읽습니다.');
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

async function transportRead(connector, {fetch, readFile, headers}) {
  if (connector.transport === 'https_json') {
    if (typeof fetch !== 'function') return {ok: false, reason: 'transport_unconfigured'};
    let response;
    try {response = await fetch(connector.locator, {method: 'GET', headers: {accept: 'application/json', ...(headers ?? {})}, redirect: 'error'});}
    catch {return {ok: false, reason: 'source_unreachable'};}
    if (!response || typeof response.status !== 'number') return {ok: false, reason: 'source_unreachable'};
    if (response.status === 401 || response.status === 403) return {ok: false, reason: 'source_unauthorized'};
    if (response.status !== 200) return {ok: false, reason: `source_http_${response.status}`};
    let text;
    try {text = await response.text();} catch {return {ok: false, reason: 'source_unreadable'};}
    return {ok: true, text};
  }
  if (typeof readFile !== 'function') return {ok: false, reason: 'transport_unconfigured'};
  try {return {ok: true, text: await readFile(connector.locator)};} catch {return {ok: false, reason: 'source_unreachable'};}
}

// Read the source now. `deps` carries the injected I/O; credentials live in the
// caller's `headers` and are never echoed into the reading or the failure.
export async function readConnector(connector, {readAt, fetch = null, readFile = null, headers = null} = {}) {
  validateConnector(connector);
  if (!ISO.test(readAt)) fail('readAt은 ISO 시각이어야 합니다.');
  const got = await transportRead(connector, {fetch, readFile, headers});
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
