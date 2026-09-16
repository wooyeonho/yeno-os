import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {
  createConnector, validateConnector, readConnector, validateReading, toVerificationSource, connectorReadiness, normalizeRecords,
  hostAllowed, isPublicAddress, resolveVettedAddress, fetchPinned, MAX_RESPONSE_BYTES
} from '../lib/outcome-connector.mjs';
import {createOutcomeEvidence, verifyOutcome, OutcomeVerificationError} from '../lib/outcome-verification.mjs';

const AT = '2026-09-16T10:00:00.000Z';
const Q = '11111111-1111-4111-8111-111111111111';
const J = '22222222-2222-4222-8222-222222222222';
const ART = 'a'.repeat(64);
const declare = (over = {}) => createConnector({
  id: 'stripe-main', sourceType: 'payment_processor', sourceId: 'acct_yeno_main', transport: 'https_json',
  locator: 'https://ledger.example.test/exports/acct_yeno_main.json', metrics: ['wealth.revenue', 'wealth.transactions'], ...over
}, {declaredAt: AT});
const payload = records => ({sourceId: 'acct_yeno_main', records});
const REC = {metric: 'wealth.revenue', value: 120000, unit: 'KRW', timestamp: '2026-09-15T00:00:00.000Z'};

// A fake `node:https`-shaped `request(options, callback)`. `plan` describes
// the response: {status, headers, chunks, hang, errorImmediately}. `chunks`
// are delivered one per microtask so a byte-cap abort mid-stream is
// observable exactly like a real socket. `fn.calls[i].destroyed` reports
// whether the request built from that call was ever aborted.
function mockRequest(plan = {}) {
  const calls = [];
  const fn = (options, callback) => {
    const state = {destroyed: false};
    const req = new EventEmitter();
    calls.push({options, get destroyed() {return state.destroyed;}});
    req.destroy = () => {state.destroyed = true;};
    req.end = () => {
      if (plan.hang) return;
      queueMicrotask(() => {
        if (plan.errorImmediately) {req.emit('error', plan.errorImmediately); return;}
        const res = new EventEmitter();
        res.statusCode = plan.status ?? 200;
        res.headers = plan.headers ?? {'content-type': 'application/json'};
        res.resume = () => {};
        res.destroy = () => {state.destroyed = true;};
        callback(res);
        (async () => {
          for (const chunk of plan.chunks ?? []) {
            if (state.destroyed) return;
            res.emit('data', Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            await new Promise(r => setImmediate(r));
          }
          if (!state.destroyed) res.emit('end');
        })();
      });
    };
    return req;
  };
  fn.calls = calls;
  return fn;
}
const jsonRequest = (body, over = {}) => mockRequest({status: 200, headers: {'content-type': 'application/json'}, chunks: [JSON.stringify(body)], ...over});
const resolveTo = (...addresses) => async () => addresses;
const evidenceFor = (connector, rec = REC) => createOutcomeEvidence({
  questId: Q, jobId: J, artifactSha256: ART, metric: rec.metric, value: rec.value, unit: rec.unit,
  sourceType: connector.sourceType, sourceId: connector.sourceId, sourceTimestamp: rec.timestamp,
  verificationType: 'external_structured', authority: 'external', confidence: 0.9
}, {collectedAt: AT});

test('connector contract: owner-declared external source only; secrets and non-https locators fail closed', () => {
  const c = declare();
  assert.equal(validateConnector(c), true);
  assert.equal(c.declaredBy, 'owner');
  assert.throws(() => declare({sourceType: 'model_output', metrics: ['wealth.revenue']}), /외부 구조화 source/);
  assert.throws(() => declare({sourceType: 'app_store', metrics: ['wealth.revenue']}), /검증되지 않습니다/);
  assert.throws(() => declare({locator: 'http://ledger.example.test/x.json'}), /https/);
  assert.throws(() => declare({locator: 'https://user:pw@ledger.example.test/x.json'}), e => e.code === 'CONNECTOR_SECRET');
  assert.throws(() => declare({locator: 'https://ledger.example.test/x.json?api_key=abc'}), e => e.code === 'CONNECTOR_SECRET');
  assert.throws(() => validateConnector({...c, sourceId: 'acct_other'}), e => e.code === 'CONNECTOR_TAMPERED');
  assert.throws(() => validateConnector({...c, declaredBy: 'model', fingerprint: null}), /owner/);
  assert.throws(() => createConnector({id: 'x', sourceType: 'payment_processor', sourceId: 'a', transport: 'https_json',
    locator: 'https://e.test/a', metrics: ['wealth.revenue'], apiToken: 'sk-abc'}, {declaredAt: AT}), OutcomeVerificationError);
  assert.equal(declare({transport: 'owner_export_json', locator: 'exports/ledger.json'}).transport, 'owner_export_json');
  assert.throws(() => declare({transport: 'owner_export_json', locator: '../etc/passwd'}), /상대 경로/);
});

test('https_json read: pinned transport, headers not persisted, structured records normalized and fingerprinted', async () => {
  const c = declare();
  const resolve = resolveTo({address: '93.184.216.34', family: 4});
  const request = jsonRequest(payload([{...REC, timestamp: '2026-09-15T01:00:00.000Z', value: 5}, REC]));
  const out = await readConnector(c, {readAt: AT, resolve, request, headers: {authorization: 'Bearer sk-live-secret'}});
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(request.calls[0].options.headers.authorization, 'Bearer sk-live-secret');
  assert.equal(request.calls[0].options.host, 'ledger.example.test', 'Host stays the original hostname, never the pinned IP');
  assert.equal(request.calls[0].options.servername, 'ledger.example.test', 'SNI/cert validation stays on the hostname');
  assert.equal(typeof request.calls[0].options.lookup, 'function');
  assert.equal(validateReading(out.reading), true);
  assert.deepEqual(out.reading.records.map(r => r.timestamp), ['2026-09-15T00:00:00.000Z', '2026-09-15T01:00:00.000Z']);
  assert.doesNotMatch(JSON.stringify(out.reading), /sk-live|authorization/i);
  const again = await readConnector(c, {readAt: AT, resolve, request: jsonRequest(payload([REC, {...REC, timestamp: '2026-09-15T01:00:00.000Z', value: 5}]))});
  assert.equal(again.reading.fingerprint, out.reading.fingerprint, 'same source data → same fingerprint regardless of order');
  assert.throws(() => validateReading({...out.reading, records: [{...REC, value: 999}]}), e => e.code === 'READING_TAMPERED');
});

test('read failures are closed: unreachable, unauthorized, non-200, malformed, foreign sourceId, bad records, secrets, unconfigured transport', async () => {
  const c = declare();
  const resolve = resolveTo({address: '93.184.216.34', family: 4});
  const reason = async body => (await readConnector(c, {readAt: AT, resolve, request: jsonRequest(body)})).reason;
  assert.equal((await readConnector(c, {readAt: AT, resolve, request: mockRequest({errorImmediately: new Error('ECONNREFUSED')})})).reason, 'source_unreachable');
  assert.equal((await readConnector(c, {readAt: AT, resolve, request: mockRequest({status: 401})})).reason, 'source_unauthorized');
  assert.equal((await readConnector(c, {readAt: AT, resolve, request: mockRequest({status: 503})})).reason, 'source_http_503');
  assert.equal((await readConnector(c, {readAt: AT, resolve, request: mockRequest({chunks: ['<html>']})})).reason, 'source_not_json');
  assert.equal(await reason({total: 5}), 'source_shape_invalid');
  assert.equal(await reason({sourceId: 'acct_other', records: [REC]}), 'source_id_mismatch');
  assert.equal(await reason(payload([])), 'source_empty');
  assert.equal(await reason(payload([{...REC, value: '120000'}])), 'record_value_not_number');
  assert.equal(await reason(payload([{...REC, unit: 'USD_cents'}])), 'record_unit_invalid');
  assert.equal(await reason(payload([{...REC, metric: 'fame.views', unit: 'count'}])), 'record_metric_undeclared');
  assert.equal(await reason(payload([REC, {...REC, value: 1}])), 'record_duplicate_metric_timestamp');
  assert.equal(await reason(payload([{...REC, note: 'x'}])), 'record_fields_invalid');
  assert.equal(normalizeRecords([{...REC, timestamp: 'sk-abcdef'}], c).reason, 'record_timestamp_invalid');
  const readOnly = declare({transport: 'owner_export_json', locator: 'exports/ledger.json'});
  assert.equal((await readConnector(readOnly, {readAt: AT})).reason, 'transport_unconfigured');
  assert.equal((await readConnector(readOnly, {readAt: AT, readFile: async () => JSON.stringify([REC])})).ok, true);
});

test('adapter into verifyOutcome: reading confirms the claim, changed/missing source values fail, model text never counts', async () => {
  const c = declare();
  const resolve = resolveTo({address: '93.184.216.34', family: 4});
  const evidence = evidenceFor(c);
  const links = {questId: Q, jobId: J, artifactSha256: ART};
  const good = (await readConnector(c, {readAt: AT, resolve, request: jsonRequest(payload([REC]))})).reading;
  const verified = verifyOutcome(evidence, {links, source: toVerificationSource(good, evidence), at: AT});
  assert.equal(verified.outcomeVerified, true);
  const changed = (await readConnector(c, {readAt: AT, resolve, request: jsonRequest(payload([{...REC, value: 90000}]))})).reading;
  assert.equal(verifyOutcome(evidence, {links, source: toVerificationSource(changed, evidence), at: AT}).outcomeVerified, false);
  assert.ok(verifyOutcome(evidence, {links, source: toVerificationSource(changed, evidence), at: AT}).reasons.includes('source_changed'));
  const other = (await readConnector(declare({id: 'other', sourceId: 'acct_other'}), {readAt: AT, resolve, request: jsonRequest({sourceId: 'acct_other', records: [REC]})})).reading;
  assert.equal(toVerificationSource(other, evidence), null);
  assert.ok(verifyOutcome(evidence, {links, source: null, at: AT}).reasons.includes('source_unavailable'));
  const unreachable = await readConnector(c, {readAt: AT, resolve, request: mockRequest({errorImmediately: new Error('ECONNREFUSED')})});
  assert.equal(unreachable.reading, null);
  assert.throws(() => createConnector({id: 'llm', sourceType: 'model_output', sourceId: 'gpt', transport: 'https_json',
    locator: 'https://e.test/a', metrics: ['wealth.revenue']}, {declaredAt: AT}), /외부 구조화 source/);
});

test('connector readiness taxonomy: NOT_WIRED → WIRED_UNVERIFIED → SYNTHETIC_VERIFIED(owner export) → LIVE_VERIFIED(https reading)', async () => {
  const c = declare();
  const resolve = resolveTo({address: '93.184.216.34', family: 4});
  assert.equal(connectorReadiness([], []).status, 'NOT_WIRED');
  assert.equal(connectorReadiness([c], []).status, 'WIRED_UNVERIFIED');
  const exp = declare({id: 'exp', transport: 'owner_export_json', locator: 'exports/ledger.json'});
  const local = (await readConnector(exp, {readAt: AT, readFile: async () => JSON.stringify([REC])})).reading;
  assert.equal(connectorReadiness([c, exp], [local]).status, 'SYNTHETIC_VERIFIED');
  const live = (await readConnector(c, {readAt: AT, resolve, request: jsonRequest(payload([REC]))})).reading;
  assert.equal(connectorReadiness([c, exp], [local, live]).status, 'LIVE_VERIFIED');
  assert.equal(connectorReadiness([c], [{...live, records: [{...REC, value: 1}]}]).status, 'WIRED_UNVERIFIED', 'tampered reading is not evidence');
});

test('SSRF/bounds at declaration time: private/loopback/metadata/IP hosts and non-443 ports are refused before any resolve or request', () => {
  for (const bad of ['https://localhost/x.json', 'https://127.0.0.1/x.json', 'https://[::1]/x.json', 'https://169.254.169.254/latest/meta-data', 'https://metadata.google.internal/computeMetadata/v1',
    'https://10.0.0.5/x', 'https://192.168.1.1/x', 'https://172.16.0.1/x', 'https://ledger/x', 'https://svc.internal/x', 'https://a.local/x', 'https://ledger.example.test:8443/x']) {
    assert.throws(() => declare({locator: bad}), OutcomeVerificationError, bad);
  }
  assert.equal(hostAllowed('ledger.example.test'), true);
  assert.deepEqual(['8.8.8.8', '2606:4700::1111'].map(isPublicAddress), [true, true]);
  assert.deepEqual(['127.0.0.1', '10.1.2.3', '172.31.0.1', '192.168.0.9', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', 'not-an-ip'].map(isPublicAddress), Array(13).fill(false));
});

test('H1 DNS pinning: rebinding cannot change the socket target; mixed/private/unresolvable DNS answers fail closed with zero requests sent', async () => {
  const c = declare();
  // 1. Rebinding: even if a later, independent resolution WOULD return a
  //    private address, the pinned transport never performs one - the single
  //    vetted address is forced onto the socket via `lookup`, and the request
  //    object never receives the raw hostname as something to re-resolve.
  let resolveCalls = 0;
  const resolveOnce = async () => {resolveCalls++; return [{address: '93.184.216.34', family: 4}];};
  const request = jsonRequest(payload([REC]));
  const out = await readConnector(c, {readAt: AT, resolve: resolveOnce, request});
  assert.equal(out.ok, true);
  assert.equal(resolveCalls, 1, 'DNS resolved exactly once');
  const lookupResult = await new Promise(r => request.calls[0].options.lookup('ledger.example.test', {}, (err, address, family) => r({err, address, family})));
  assert.deepEqual(lookupResult, {err: null, address: '93.184.216.34', family: 4}, 'the socket-level lookup answers with the vetted address, not a fresh resolution');

  // 2. Hardened transport unavailable (unresolvable) → no request constructed at all.
  const spy = mockRequest({status: 200, chunks: [JSON.stringify(payload([REC]))]});
  assert.equal((await readConnector(c, {readAt: AT, resolve: async () => {throw new Error('ENOTFOUND');}, request: spy})).reason, 'source_unresolvable');
  assert.equal(spy.calls.length, 0, 'no socket is ever opened when DNS resolution fails');

  // 3. Mixed public/private answers fail closed (one accepted private answer is enough for a rebinder).
  const spy2 = mockRequest({status: 200, chunks: [JSON.stringify(payload([REC]))]});
  assert.equal((await readConnector(c, {readAt: AT, resolve: resolveTo({address: '169.254.169.254', family: 4}, {address: '8.8.8.8', family: 4}), request: spy2})).reason, 'source_host_blocked');
  assert.equal(spy2.calls.length, 0);

  // 4. Private IPv4 ranges blocked.
  for (const address of ['10.0.0.8', '192.168.1.1', '172.20.0.1', '100.64.0.1', '169.254.169.254', '0.0.0.0']) {
    const spyV4 = mockRequest({status: 200});
    assert.equal((await readConnector(c, {readAt: AT, resolve: resolveTo({address, family: 4}), request: spyV4})).reason, 'source_host_blocked', address);
    assert.equal(spyV4.calls.length, 0, address);
  }

  // 5. Private/link-local/IPv4-mapped IPv6 blocked.
  for (const address of ['::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
    const spyV6 = mockRequest({status: 200});
    assert.equal((await readConnector(c, {readAt: AT, resolve: resolveTo({address, family: 6}), request: spyV6})).reason, 'source_host_blocked', address);
    assert.equal(spyV6.calls.length, 0, address);
  }
  assert.equal((await readConnector(c, {readAt: AT, resolve: async () => {throw new Error('ENOTFOUND');}, request: mockRequest()})).reason, 'source_unresolvable');
  assert.deepEqual(await resolveVettedAddress('ledger.example.test', {resolve: resolveTo('93.184.216.34')}), {ok: true, address: '93.184.216.34', family: 4}, 'bare string DNS answers are accepted too');
});

test('H2 body/timeout: one deadline covers the whole request; body is capped as it streams; content-type/encoding enforced; redirects never followed', async () => {
  const c = declare();
  const resolve = resolveTo({address: '93.184.216.34', family: 4});

  // 6. Body stalls after headers (never emits data/end) → timeout aborts the request.
  const hanging = mockRequest({hang: true});
  const t0 = Date.now();
  assert.equal((await readConnector(c, {readAt: AT, resolve, request: hanging, timeoutMs: 30})).reason, 'source_timeout');
  assert.ok(Date.now() - t0 < 2000, 'the deadline actually fired instead of hanging the test');
  assert.equal(hanging.calls[0].destroyed, true, 'the socket is destroyed on timeout');

  // 7. Chunked body exceeding the cap → early abort, not a full buffered read.
  const oversizedChunks = mockRequest({status: 200, headers: {'content-type': 'application/json'}, chunks: [Buffer.alloc(4096, 'a'), Buffer.alloc(MAX_RESPONSE_BYTES, 'b')]});
  const url = new URL(c.locator);
  const chunkedResult = await fetchPinned(url, {address: '93.184.216.34', family: 4, request: oversizedChunks});
  assert.equal(chunkedResult.reason, 'source_too_large');
  assert.equal(oversizedChunks.calls[0].destroyed, true);

  // 8. A false, small Content-Length followed by an oversized stream still aborts.
  const lyingLength = mockRequest({status: 200, headers: {'content-type': 'application/json', 'content-length': '10'}, chunks: [Buffer.alloc(MAX_RESPONSE_BYTES + 1, 'c')]});
  const lyingResult = await fetchPinned(url, {address: '93.184.216.34', family: 4, request: lyingLength});
  assert.equal(lyingResult.reason, 'source_too_large');

  // 9. Content-Length already over the cap → the body is never consumed at all.
  const declaredTooBig = mockRequest({status: 200, headers: {'content-type': 'application/json', 'content-length': String(MAX_RESPONSE_BYTES + 1)}, chunks: [Buffer.alloc(10)]});
  const declaredResult = await fetchPinned(url, {address: '93.184.216.34', family: 4, request: declaredTooBig});
  assert.equal(declaredResult.reason, 'source_too_large');
  assert.equal(declaredTooBig.calls[0].destroyed, true);

  // 10. Exactly at the limit succeeds (tested against fetchPinned's own bound so the
  //     body does not also have to satisfy the record schema at the same time).
  const exactBody = 'x'.repeat(50);
  const exact = await fetchPinned(url, {address: '93.184.216.34', family: 4, maxBytes: exactBody.length, request: mockRequest({status: 200, headers: {'content-type': 'application/json'}, chunks: [exactBody]})});
  assert.equal(exact.ok, true);
  assert.equal(exact.text, exactBody);
  const overOne = await fetchPinned(url, {address: '93.184.216.34', family: 4, maxBytes: exactBody.length - 1, request: mockRequest({status: 200, headers: {'content-type': 'application/json'}, chunks: [exactBody]})});
  assert.equal(overOne.reason, 'source_too_large');

  // Redirects are never followed regardless of how the response frames it.
  assert.equal((await readConnector(c, {readAt: AT, resolve, request: mockRequest({status: 302, headers: {'content-type': 'application/json', location: 'https://evil.example.test/x.json'}})})).reason, 'source_redirected');

  // Compressed responses are refused even though we asked for identity.
  assert.equal((await readConnector(c, {readAt: AT, resolve, request: mockRequest({status: 200, headers: {'content-type': 'application/json', 'content-encoding': 'gzip'}, chunks: [JSON.stringify(payload([REC]))]})})).reason, 'source_compressed_response');
  // Every real request asks for identity encoding and JSON.
  const plain = jsonRequest(payload([REC]));
  await readConnector(c, {readAt: AT, resolve, request: plain});
  assert.equal(plain.calls[0].options.headers['accept-encoding'], 'identity');

  // Non-JSON content-type and oversized Content-Length via the full readConnector path.
  assert.equal((await readConnector(c, {readAt: AT, resolve, request: mockRequest({status: 200, headers: {'content-type': 'text/html'}, chunks: ['<html>']})})).reason, 'source_not_json');
  assert.equal((await readConnector(c, {readAt: AT, resolve, request: mockRequest({status: 200, headers: {'content-type': 'application/json', 'content-length': String(MAX_RESPONSE_BYTES + 1)}})})).reason, 'source_too_large');

  // Failure objects never echo headers/credentials.
  const r = await readConnector(c, {readAt: AT, resolve, request: mockRequest({status: 500}), headers: {authorization: 'Bearer sk_live_000'}});
  assert.doesNotMatch(JSON.stringify(r), /sk_live|authorization/i);
});
