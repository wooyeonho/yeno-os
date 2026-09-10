import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  RequestLedgerError, REQUEST_LEDGER_MAX_ENTRIES, REQUEST_CACHE_MAX_ENTRIES, REQUEST_CACHE_MAX_BYTES,
  initializeRequestLedger, validateRequestLedger, validateRequestId, fingerprintRequest,
  findReceipt, checkCapacity, rememberReceipt, lookupRequest,
} from '../lib/request-ledger.mjs';

const uid = () => crypto.randomUUID();
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const createState = () => initializeRequestLedger({ requests: {}, jobs: [], memories: [], devices: {}, projects: [], sources: [] });
const hasStatus = status => error => error instanceof RequestLedgerError && error.status === status;
const define = (object, key, value) => Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });

test('request fingerprints preserve the original canonical format and nested requestId meaning', () => {
  const first = { requestId: 'transport-one', z: { b: 2, a: 1 }, list: [{ y: 2, x: 1 }], text: '한글', nested: { requestId: 'business-one' } };
  const second = { nested: { requestId: 'business-one' }, text: '한글', list: [{ x: 1, y: 2 }], z: { a: 1, b: 2 }, requestId: 'transport-two' };
  const expected = hash('{"method":"POST","path":"/api/command","body":{"list":[{"x":1,"y":2}],"nested":{"requestId":"business-one"},"text":"한글","z":{"a":1,"b":2}}}');
  assert.equal(fingerprintRequest('POST', '/api/command', first), expected);
  assert.equal(fingerprintRequest('POST', '/api/command', second), expected);
  for (const candidate of [
    fingerprintRequest('PUT', '/api/command', first),
    fingerprintRequest('POST', '/api/jobs', first),
    fingerprintRequest('POST', '/api/command', { ...first, nested: { requestId: 'business-two' } }),
    fingerprintRequest('POST', '/api/command', { ...first, list: [{ x: 1 }, { y: 2 }] }),
  ]) assert.notEqual(candidate, expected);
  const prototypeBody = JSON.parse('{"__proto__":{"b":2,"a":1},"requestId":"one"}');
  assert.equal(fingerprintRequest('POST', '/', prototypeBody), hash('{"method":"POST","path":"/","body":{"__proto__":{"a":1,"b":2}}}'));
  assert.equal(prototypeBody.requestId, 'one', 'fingerprinting must not mutate input');
});

test('request IDs reject absent required, blank, non-string and excessive IDs without normalizing valid IDs', () => {
  assert.equal(validateRequestId(undefined), undefined);
  assert.throws(() => validateRequestId(undefined, { required: true }), hasStatus(400));
  for (const value of [null, '', ' \t\n', 1, {}, [], 'x'.repeat(161)]) assert.throws(() => validateRequestId(value), hasStatus(400));
  for (const value of ['x'.repeat(160), ' same ID ', '__proto__', 'constructor', 'toString']) assert.equal(validateRequestId(value, { required: true }), value);
});

test('migration preserves exact old receipt hashes and status, and adds cached identities absent from a partial ledger', () => {
  const job = { id: uid(), status: 'queued', title: 'stored original' };
  const originalReceipt = { hash: hash('do not recompute me'), status: 201, payload: { kind: 'job', job } };
  const originalCache = { old: structuredClone(originalReceipt) };
  const state = { requests: originalCache, jobs: [job], projects: [], sources: [] };
  assert.equal(validateRequestLedger(state), true, 'legacy absence is valid');
  initializeRequestLedger(state);
  assert.deepEqual(state.requests.old, originalReceipt);
  assert.deepEqual(originalCache, { old: originalReceipt }, 'migration must not mutate an old object retained by a caller');
  assert.deepEqual(state.requestLedger.old, { hash: originalReceipt.hash, status: 201, reference: { collection: 'jobs', id: job.id, payloadKey: 'job', kind: 'job' } });
  state.requests.additive = { hash: hash('additive'), status: 200, payload: { ok: true } };
  initializeRequestLedger(state);
  assert.equal(state.requestLedger.additive.hash, hash('additive'));
  assert.equal(state.requestLedger.old.hash, originalReceipt.hash);
  assert.equal(validateRequestLedger(state), true);
});

test('malformed ledger or conflicting cached records never partially alter state during migration', () => {
  const base = createState();
  rememberReceipt(base, 'old', hash('old'), { status: 201, payload: { job: { id: uid() } } });
  const badStates = [
    { ...base, requestLedger: null },
    { ...base, requestLedger: [] },
    { ...base, requestLedger: { old: { hash: 'bad', status: 201 } } },
    { ...base, requestLedger: { old: { hash: hash('old'), status: 500 } } },
    { ...base, requestLedger: { old: { hash: hash('old'), status: 201, token: 'not a ledger field' } } },
    { ...base, requestLedger: { old: { hash: hash('old'), status: 201, reference: { collection: 'devices', payloadKey: 'job', id: uid() } } } },
    { ...base, requestLedger: { old: { hash: hash('changed'), status: 201 } } },
    { ...base, requestLedger: { old: { hash: hash('old'), status: 200 } } },
    { ...base, requests: { first: { hash: hash('first'), status: 200, payload: {} }, broken: { hash: hash('broken'), status: 200, payload: [] } } },
    { ...base, requests: { old: { ...base.requests.old, payload: { job: { id: uid() } } } } },
  ];
  for (const input of badStates) {
    const state = structuredClone(input), before = structuredClone(state);
    assert.throws(() => initializeRequestLedger(state), hasStatus(500));
    assert.deepEqual(state, before);
  }
});

test('bounded full receipts can expire while the first job identity remains replayable from current durable state', () => {
  const state = createState();
  const firstJob = { id: uid(), status: 'queued', input: 'private input', normalized: 'private normalized', draft: 'private draft', artifacts: [] };
  state.jobs.push(firstJob);
  rememberReceipt(state, 'first', hash('first'), { status: 201, payload: { kind: 'job', job: { id: firstJob.id, status: 'queued', artifacts: [] } } });
  for (let index = 0; index < REQUEST_CACHE_MAX_ENTRIES + 1; index++) {
    const id = `later-${index}`;
    rememberReceipt(state, id, hash(id), { status: 200, payload: { ok: true } });
  }
  assert.equal(Object.keys(state.requests).length, REQUEST_CACHE_MAX_ENTRIES);
  assert.equal(Object.keys(state.requestLedger).length, REQUEST_CACHE_MAX_ENTRIES + 2);
  assert.equal(Object.hasOwn(state.requests, 'first'), false);
  firstJob.status = 'completed'; firstJob.artifacts = [{ id: uid(), name: 'real-result.md' }];
  const replay = findReceipt(state, 'first', hash('first'));
  assert.deepEqual(replay, { status: 201, payload: { kind: 'job', job: { id: firstJob.id, status: 'completed', artifacts: firstJob.artifacts } } });
  assert.doesNotMatch(JSON.stringify(replay), /private|normalized|draft|input/);
  replay.payload.job.artifacts[0].name = 'caller changed';
  assert.equal(firstJob.artifacts[0].name, 'real-result.md');
  assert.throws(() => findReceipt(state, 'first', hash('different work')), hasStatus(409));
  assert.equal(validateRequestLedger(state), true);
});

test('full receipt cache respects the exact UTF-8 byte cap and preserves identities of oversized responses', () => {
  const state = createState();
  for (let index = 0; index < 6; index++) {
    const id = `"한글\\${index}`;
    rememberReceipt(state, id, hash(id), { status: 200, payload: { body: '한글'.repeat(110000) } });
    assert.ok(Buffer.byteLength(JSON.stringify(state.requests)) <= REQUEST_CACHE_MAX_BYTES);
  }
  assert.equal(Object.keys(state.requestLedger).length, 6);
  assert.ok(Object.keys(state.requests).length < 6);
  rememberReceipt(state, 'oversized', hash('oversized'), { status: 200, payload: { body: 'x'.repeat(REQUEST_CACHE_MAX_BYTES) } });
  assert.equal(Object.hasOwn(state.requests, 'oversized'), false);
  assert.ok(Buffer.byteLength(JSON.stringify(state.requests)) <= REQUEST_CACHE_MAX_BYTES);
  assert.equal(lookupRequest(state, 'oversized').cached, false);
  assert.throws(() => findReceipt(state, 'oversized', hash('oversized')), error => error.status === 410 && error.extra.code === 'REQUEST_RECEIPT_EXPIRED' && error.extra.reference === null);
});

test('an oversized legacy cache is compacted only after all old identities are retained', () => {
  const requests = {};
  for (let index = 0; index < REQUEST_CACHE_MAX_ENTRIES + 1; index++) requests[`old-${index}`] = { hash: hash(`old-${index}`), status: 200, payload: { body: 'é'.repeat(1000) } };
  const state = { requests };
  initializeRequestLedger(state);
  assert.equal(Object.keys(state.requestLedger).length, REQUEST_CACHE_MAX_ENTRIES + 1);
  assert.ok(Buffer.byteLength(JSON.stringify(state.requests)) <= REQUEST_CACHE_MAX_BYTES);
  assert.equal(Object.keys(requests).length, REQUEST_CACHE_MAX_ENTRIES + 1, 'original cache retained by caller stays intact');
  assert.throws(() => findReceipt(state, 'old-0', hash('old-0')), hasStatus(410));
});

test('full-cache replay returns the original response clone and cannot be mutated through caller references', () => {
  const state = createState();
  const result = { status: 201, payload: { job: { id: uid(), title: 'original', artifacts: [] } } };
  rememberReceipt(state, 'job', hash('job'), result);
  result.payload.job.title = 'mutated original';
  const replay = findReceipt(state, 'job', hash('job'));
  assert.equal(replay.payload.job.title, 'original');
  replay.payload.job.artifacts.push({ id: uid(), name: 'fake' });
  assert.equal(state.requests.job.payload.job.artifacts.length, 0);
  assert.throws(() => findReceipt(state, 'job', hash('different')), hasStatus(409));
  assert.equal(findReceipt(state, 'unknown', hash('unknown')), null);
});

test('prototype-looking IDs are ordinary own properties and cannot alias or pollute the object prototype', () => {
  const state = createState();
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(findReceipt(state, id, hash(id)), null);
    rememberReceipt(state, id, hash(id), { status: 200, payload: { ok: true } });
    assert.equal(Object.hasOwn(state.requestLedger, id), true);
    assert.deepEqual(findReceipt(state, id, hash(id)), { status: 200, payload: { ok: true } });
    assert.equal(lookupRequest(state, id).requestId, id);
  }
  assert.equal(Object.getPrototypeOf(state.requestLedger), Object.prototype);
  assert.equal(Object.getPrototypeOf(state.requests), Object.prototype);
  assert.equal({}.hash, undefined);
  initializeRequestLedger(state);
  assert.equal(Object.hasOwn(state.requestLedger, '__proto__'), true);
  assert.equal(validateRequestLedger(state), true);
});

test('capacity is checked before new work, preserves all identities and allows checking existing IDs', () => {
  const state = createState();
  for (let index = 0; index < REQUEST_LEDGER_MAX_ENTRIES; index++) define(state.requestLedger, `id-${index}`, { hash: hash(`id-${index}`), status: 200 });
  const before = structuredClone(state);
  assert.throws(() => checkCapacity(state, 'new'), error => error.status === 507 && error.extra.code === 'REQUEST_LEDGER_CAPACITY');
  assert.doesNotThrow(() => checkCapacity(state, 'id-0'));
  assert.throws(() => rememberReceipt(state, 'new', hash('new'), { status: 200, payload: {} }), hasStatus(507));
  assert.deepEqual(state, before);
  assert.equal(findReceipt({ ...state, requests: { 'id-0': { hash: hash('id-0'), status: 200, payload: { ok: true } } } }, 'id-0', hash('id-0')).payload.ok, true);
  state.requests.additive = { hash: hash('additive'), status: 200, payload: {} };
  const fullBefore = structuredClone(state);
  assert.throws(() => initializeRequestLedger(state), hasStatus(500));
  assert.deepEqual(state, fullBefore, 'over-capacity migration must not drop the oldest known identity');
});

test('retired references expose only public identity and yield 410 when their original target is unavailable', () => {
  const state = createState();
  const jobId = uid();
  rememberReceipt(state, 'retired', hash('retired'), { status: 201, payload: { kind: 'job', job: { id: jobId } } });
  delete state.requests.retired;
  const reference = { collection: 'jobs', id: jobId, payloadKey: 'job', kind: 'job' };
  assert.throws(() => findReceipt(state, 'retired', hash('retired')), error => {
    assert.equal(error.status, 410);
    assert.deepEqual(error.extra, { code: 'REQUEST_RECEIPT_EXPIRED', requestId: 'retired', reference });
    error.extra.reference.id = 'caller changed';
    return true;
  });
  assert.deepEqual(lookupRequest(state, 'retired'), { requestId: 'retired', status: 201, cached: false, reference });
  const metadata = lookupRequest(state, 'retired'); metadata.reference.id = 'caller changed';
  assert.equal(state.requestLedger.retired.reference.id, jobId);
  assert.throws(() => lookupRequest(state, 'never-seen'), hasStatus(404));
  assert.throws(() => findReceipt(state, 'retired', hash('another request')), hasStatus(409));
});

test('device replay after cache expiration exposes enrollment metadata without any stored credential or activity fields', () => {
  const state = createState();
  const device = { id: uid(), name: 'phone', platform: 'android', createdAt: '2026-09-10T00:00:00.000Z', lastSeenAt: '2026-09-10T01:00:00.000Z', tokenHash: hash('secret credential'), deviceToken: 'must never expose', revokedAt: null };
  state.devices[device.id] = device;
  rememberReceipt(state, 'enroll', hash('enroll'), { status: 201, payload: { device: { id: device.id, name: device.name, platform: device.platform, createdAt: device.createdAt } } });
  delete state.requests.enroll;
  const result = findReceipt(state, 'enroll', hash('enroll'));
  assert.deepEqual(result.payload, { device: { id: device.id, name: device.name, platform: device.platform, createdAt: device.createdAt } });
  assert.doesNotMatch(JSON.stringify({ result, lookup: lookupRequest(state, 'enroll'), ledger: state.requestLedger }), /tokenHash|deviceToken|lastSeenAt|secret credential/);
});

test('memory, project and source reconstruction retains current records and command kind without altering state', () => {
  const state = createState();
  for (const [payloadKey, collection] of [['memory', 'memories'], ['project', 'projects'], ['source', 'sources']]) {
    const item = { id: uid(), text: 'original', version: 1 };
    state[collection].push(item);
    rememberReceipt(state, payloadKey, hash(payloadKey), { status: 201, payload: { kind: payloadKey, [payloadKey]: item } });
    delete state.requests[payloadKey];
    item.text = 'latest'; item.version = 2;
    const result = findReceipt(state, payloadKey, hash(payloadKey));
    assert.deepEqual(result, { status: 201, payload: { kind: payloadKey, [payloadKey]: item } });
    result.payload[payloadKey].text = 'caller changed';
    assert.equal(item.text, 'latest');
  }
});
