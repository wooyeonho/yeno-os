import crypto from 'node:crypto';

export const REQUEST_LEDGER_MAX_ENTRIES = 20000;
export const REQUEST_CACHE_MAX_ENTRIES = 2000;
export const REQUEST_CACHE_MAX_BYTES = 2 * 1024 * 1024;

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const COLLECTIONS = { job: 'jobs', memory: 'memories', device: 'devices', project: 'projects', source: 'sources' };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => Object.hasOwn(value, key);
const put = (object, key, value) => Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });
const validId = value => typeof value === 'string' && value.length <= 160 && value.trim().length > 0;
const success = value => Number.isInteger(value) && value >= 200 && value <= 299;

export class RequestLedgerError extends Error {
  constructor(status, message, extra = {}) { super(message); this.name = 'RequestLedgerError'; this.status = status; this.extra = extra; }
}

const invalid = message => { throw new RequestLedgerError(500, `Invalid request ledger: ${message}`); };
function fields(value, allowed, required) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !own(value, key))) invalid('malformed record');
}
function validateReference(reference) {
  fields(reference, ['collection', 'id', 'payloadKey', 'kind'], ['collection', 'id', 'payloadKey']);
  if (!own(COLLECTIONS, reference.payloadKey) || COLLECTIONS[reference.payloadKey] !== reference.collection || !UUID.test(reference.id)) invalid('malformed reference');
  if (own(reference, 'kind') && (typeof reference.kind !== 'string' || !reference.kind.length || reference.kind.length > 80)) invalid('malformed response kind');
}
function referenceFor(payload) {
  for (const [payloadKey, collection] of Object.entries(COLLECTIONS)) {
    if (!own(payload, payloadKey) || !record(payload[payloadKey]) || typeof payload[payloadKey].id !== 'string' || !UUID.test(payload[payloadKey].id)) continue;
    const reference = { collection, id: payload[payloadKey].id, payloadKey };
    if (typeof payload.kind === 'string' && payload.kind.length > 0 && payload.kind.length <= 80) reference.kind = payload.kind;
    return reference;
  }
  return undefined;
}
function validateReceipt(receipt) {
  fields(receipt, ['hash', 'status', 'payload'], ['hash', 'status', 'payload']);
  if (typeof receipt.hash !== 'string' || !HASH.test(receipt.hash) || !success(receipt.status) || !record(receipt.payload)) invalid('malformed cached receipt');
}
function referencesMatch(left, right) {
  return left.collection === right.collection && left.id === right.id && left.payloadKey === right.payloadKey && left.kind === right.kind;
}

// Old stores have no ledger. Their cached hashes are already canonical request
// identities: migrate those exact hashes, never recompute them from responses.
export function validateRequestLedger(state) {
  if (!own(state, 'requestLedger')) return true;
  if (!record(state.requestLedger) || !record(state.requests)) invalid('expected ledger and response-cache objects');
  if (Object.keys(state.requestLedger).length > REQUEST_LEDGER_MAX_ENTRIES) invalid('identity capacity exceeded');
  for (const [id, entry] of Object.entries(state.requestLedger)) {
    if (!validId(id)) invalid('invalid requestId');
    fields(entry, ['hash', 'status', 'reference'], ['hash', 'status']);
    if (typeof entry.hash !== 'string' || !HASH.test(entry.hash) || !success(entry.status)) invalid('malformed identity');
    if (own(entry, 'reference')) validateReference(entry.reference);
  }
  for (const [id, receipt] of Object.entries(state.requests)) {
    if (!validId(id)) invalid('invalid cached requestId');
    validateReceipt(receipt);
    if (!own(state.requestLedger, id)) continue; // additive migration below
    const entry = state.requestLedger[id];
    if (receipt.hash !== entry.hash || receipt.status !== entry.status) invalid('cached receipt conflicts with identity');
    const reference = referenceFor(receipt.payload);
    if (entry.reference && (!reference || !referencesMatch(entry.reference, reference))) invalid('cached receipt conflicts with reference');
  }
  return true;
}

function trimCache(cache) {
  const ids = Object.keys(cache);
  // Count the exact UTF-8 JSON representation, including escaped IDs, property
  // delimiters, commas and braces. Avoid reserializing the entire cache per drop.
  const sizes = ids.map(id => Buffer.byteLength(JSON.stringify(id)) + 1 + Buffer.byteLength(JSON.stringify(cache[id])));
  let count = ids.length;
  let bytes = 2 + sizes.reduce((sum, size) => sum + size, 0) + Math.max(0, count - 1);
  for (let index = 0; count > REQUEST_CACHE_MAX_ENTRIES || bytes > REQUEST_CACHE_MAX_BYTES; index++) {
    delete cache[ids[index]];
    bytes -= sizes[index] + (count > 1 ? 1 : 0);
    count--;
  }
}

export function initializeRequestLedger(state) {
  if (!record(state) || !record(state.requests)) invalid('expected state and response-cache objects');
  // All validation and bounded-cache preparation happen on copies before either
  // original field is replaced. A bad legacy receipt cannot erase valid IDs.
  validateRequestLedger(state);
  const ledger = own(state, 'requestLedger') ? structuredClone(state.requestLedger) : {};
  const cache = structuredClone(state.requests);
  for (const [id, receipt] of Object.entries(cache)) {
    if (!validId(id)) invalid('invalid cached requestId');
    validateReceipt(receipt);
    const reference = referenceFor(receipt.payload);
    if (!own(ledger, id)) put(ledger, id, { hash: receipt.hash, status: receipt.status, ...(reference ? { reference } : {}) });
    else if (!ledger[id].reference && reference) ledger[id].reference = reference;
  }
  if (Object.keys(ledger).length > REQUEST_LEDGER_MAX_ENTRIES) invalid('migration exceeds identity capacity');
  trimCache(cache);
  state.requestLedger = ledger;
  state.requests = cache;
  return state;
}

export function validateRequestId(value, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  if (!validId(value)) throw new RequestLedgerError(400, 'requestId must be a string of 1–160 characters');
  return value;
}

export function fingerprintRequest(method, pathname, body) {
  // Preserve the pre-ledger runtime algorithm byte for byte, including nested
  // requestId fields (only the top-level transport identity is excluded).
  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  };
  const copy = { ...body }; delete copy.requestId;
  return crypto.createHash('sha256').update(JSON.stringify({ method, path: pathname, body: canonical(copy) })).digest('hex');
}

function currentPayload(state, reference) {
  if (!reference) return null;
  const collection = state[reference.collection];
  const item = reference.collection === 'devices'
    ? (record(collection) && own(collection, reference.id) ? collection[reference.id] : null)
    : (Array.isArray(collection) ? collection.find(value => value?.id === reference.id) : null);
  if (!item || item.id !== reference.id) return null;
  let value;
  if (reference.collection === 'jobs') {
    const { input, normalized, draft, ...publicJob } = item;
    value = publicJob;
  } else if (reference.collection === 'devices') {
    const { id, name, platform, createdAt } = item;
    value = { id, name, platform, createdAt };
  } else value = item;
  return { ...(reference.kind ? { kind: reference.kind } : {}), [reference.payloadKey]: structuredClone(value) };
}

export function findReceipt(state, id, hash) {
  validateRequestId(id, { required: true });
  const entry = record(state.requestLedger) && own(state.requestLedger, id) ? state.requestLedger[id] : null;
  const cached = record(state.requests) && own(state.requests, id) ? state.requests[id] : null;
  if (!entry && !cached) return null;
  if ((entry && entry.hash !== hash) || (cached && cached.hash !== hash)) throw new RequestLedgerError(409, 'requestId was already used for a different request');
  if (cached) return structuredClone({ status: cached.status, payload: cached.payload });
  const payload = currentPayload(state, entry.reference);
  if (payload) return { status: entry.status, payload };
  throw new RequestLedgerError(410, 'This request was already accepted, but its response is no longer available. Do not submit it under a new requestId without checking its outcome.', {
    code: 'REQUEST_RECEIPT_EXPIRED', requestId: id, reference: entry.reference ? structuredClone(entry.reference) : null,
  });
}

export function checkCapacity(state, id) {
  validateRequestId(id, { required: true });
  if (!record(state.requestLedger)) invalid('ledger is not initialized');
  if (!own(state.requestLedger, id) && Object.keys(state.requestLedger).length >= REQUEST_LEDGER_MAX_ENTRIES) {
    throw new RequestLedgerError(507, 'Request identity capacity is full. Existing requests can still be inspected or retried; new work is blocked until capacity is safely migrated.', { code: 'REQUEST_LEDGER_CAPACITY' });
  }
}

export function rememberReceipt(state, id, hash, result) {
  checkCapacity(state, id);
  const receipt = structuredClone({ hash, status: result.status, payload: result.payload });
  validateReceipt(receipt);
  if (own(state.requestLedger, id)) {
    const previous = state.requestLedger[id];
    if (previous.hash !== hash) throw new RequestLedgerError(409, 'requestId was already used for a different request');
    if (previous.status !== receipt.status) invalid('receipt status changed');
    return; // An existing durable identity is never replaced by a new outcome.
  }
  const reference = referenceFor(receipt.payload);
  put(state.requestLedger, id, { hash, status: receipt.status, ...(reference ? { reference } : {}) });
  put(state.requests, id, receipt);
  trimCache(state.requests);
}

export function lookupRequest(state, id) {
  validateRequestId(id, { required: true });
  const entry = record(state.requestLedger) && own(state.requestLedger, id) ? state.requestLedger[id] : null;
  const cached = record(state.requests) && own(state.requests, id) ? state.requests[id] : null;
  if (!entry && !cached) throw new RequestLedgerError(404, 'Request not found');
  const reference = entry?.reference ?? (cached ? referenceFor(cached.payload) : undefined);
  return { requestId: id, status: (entry ?? cached).status, cached: !!cached, reference: reference ? structuredClone(reference) : null };
}
