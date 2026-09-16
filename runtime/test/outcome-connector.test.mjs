import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createConnector, validateConnector, readConnector, validateReading, toVerificationSource, connectorReadiness, normalizeRecords
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
const fetchWith = (status, body, {throws = false} = {}) => async (url, init) => {
  fetchWith.calls.push({url, init});
  if (throws) throw new Error('ECONNREFUSED');
  return {status, text: async () => typeof body === 'string' ? body : JSON.stringify(body)};
};
fetchWith.calls = [];
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

test('https_json read: injected fetch, headers not persisted, structured records normalized and fingerprinted', async () => {
  const c = declare();
  fetchWith.calls = [];
  const fetch = fetchWith(200, payload([{...REC, timestamp: '2026-09-15T01:00:00.000Z', value: 5}, REC]));
  const out = await readConnector(c, {readAt: AT, fetch, headers: {authorization: 'Bearer sk-live-secret'}});
  assert.equal(out.ok, true);
  assert.equal(fetchWith.calls[0].init.headers.authorization, 'Bearer sk-live-secret');
  assert.equal(fetchWith.calls[0].init.redirect, 'error');
  assert.equal(validateReading(out.reading), true);
  assert.deepEqual(out.reading.records.map(r => r.timestamp), ['2026-09-15T00:00:00.000Z', '2026-09-15T01:00:00.000Z']);
  assert.doesNotMatch(JSON.stringify(out.reading), /sk-live|authorization/i);
  const again = await readConnector(c, {readAt: AT, fetch: fetchWith(200, payload([REC, {...REC, timestamp: '2026-09-15T01:00:00.000Z', value: 5}]))});
  assert.equal(again.reading.fingerprint, out.reading.fingerprint, 'same source data → same fingerprint regardless of order');
  assert.throws(() => validateReading({...out.reading, records: [{...REC, value: 999}]}), e => e.code === 'READING_TAMPERED');
});

test('read failures are closed: unreachable, unauthorized, non-200, malformed, foreign sourceId, bad records, secrets, unconfigured transport', async () => {
  const c = declare();
  const reason = async (fetch) => (await readConnector(c, {readAt: AT, fetch})).reason;
  assert.equal(await reason(fetchWith(200, null, {throws: true})), 'source_unreachable');
  assert.equal(await reason(fetchWith(401, {})), 'source_unauthorized');
  assert.equal(await reason(fetchWith(503, {})), 'source_http_503');
  assert.equal(await reason(fetchWith(200, '<html>')), 'source_not_json');
  assert.equal(await reason(fetchWith(200, {total: 5})), 'source_shape_invalid');
  assert.equal(await reason(fetchWith(200, {sourceId: 'acct_other', records: [REC]})), 'source_id_mismatch');
  assert.equal(await reason(fetchWith(200, payload([]))), 'source_empty');
  assert.equal(await reason(fetchWith(200, payload([{...REC, value: '120000'}]))), 'record_value_not_number');
  assert.equal(await reason(fetchWith(200, payload([{...REC, unit: 'USD_cents'}]))), 'record_unit_invalid');
  assert.equal(await reason(fetchWith(200, payload([{...REC, metric: 'fame.views', unit: 'count'}]))), 'record_metric_undeclared');
  assert.equal(await reason(fetchWith(200, payload([REC, {...REC, value: 1}]))), 'record_duplicate_metric_timestamp');
  assert.equal(await reason(fetchWith(200, payload([{...REC, note: 'x'}]))), 'record_fields_invalid');
  assert.equal(await reason(null), 'transport_unconfigured');
  assert.equal(normalizeRecords([{...REC, timestamp: 'sk-abcdef'}], c).reason, 'record_timestamp_invalid');
  const readOnly = declare({transport: 'owner_export_json', locator: 'exports/ledger.json'});
  assert.equal((await readConnector(readOnly, {readAt: AT})).reason, 'transport_unconfigured');
  assert.equal((await readConnector(readOnly, {readAt: AT, readFile: async () => JSON.stringify([REC])})).ok, true);
});

test('adapter into verifyOutcome: reading confirms the claim, changed/missing source values fail, model text never counts', async () => {
  const c = declare();
  const evidence = evidenceFor(c);
  const links = {questId: Q, jobId: J, artifactSha256: ART};
  const good = (await readConnector(c, {readAt: AT, fetch: fetchWith(200, payload([REC]))})).reading;
  const verified = verifyOutcome(evidence, {links, source: toVerificationSource(good, evidence), at: AT});
  assert.equal(verified.outcomeVerified, true);
  const changed = (await readConnector(c, {readAt: AT, fetch: fetchWith(200, payload([{...REC, value: 90000}]))})).reading;
  assert.equal(verifyOutcome(evidence, {links, source: toVerificationSource(changed, evidence), at: AT}).outcomeVerified, false);
  assert.ok(verifyOutcome(evidence, {links, source: toVerificationSource(changed, evidence), at: AT}).reasons.includes('source_changed'));
  const other = (await readConnector(declare({id: 'other', sourceId: 'acct_other'}), {readAt: AT, fetch: fetchWith(200, {sourceId: 'acct_other', records: [REC]})})).reading;
  assert.equal(toVerificationSource(other, evidence), null);
  assert.ok(verifyOutcome(evidence, {links, source: null, at: AT}).reasons.includes('source_unavailable'));
  const unreachable = await readConnector(c, {readAt: AT, fetch: fetchWith(200, null, {throws: true})});
  assert.equal(unreachable.reading, null);
  assert.throws(() => createConnector({id: 'llm', sourceType: 'model_output', sourceId: 'gpt', transport: 'https_json',
    locator: 'https://e.test/a', metrics: ['wealth.revenue']}, {declaredAt: AT}), /외부 구조화 source/);
});

test('connector readiness taxonomy: NOT_WIRED → WIRED_UNVERIFIED → SYNTHETIC_VERIFIED(owner export) → LIVE_VERIFIED(https reading)', async () => {
  const c = declare();
  assert.equal(connectorReadiness([], []).status, 'NOT_WIRED');
  assert.equal(connectorReadiness([c], []).status, 'WIRED_UNVERIFIED');
  const exp = declare({id: 'exp', transport: 'owner_export_json', locator: 'exports/ledger.json'});
  const local = (await readConnector(exp, {readAt: AT, readFile: async () => JSON.stringify([REC])})).reading;
  assert.equal(connectorReadiness([c, exp], [local]).status, 'SYNTHETIC_VERIFIED');
  const live = (await readConnector(c, {readAt: AT, fetch: fetchWith(200, payload([REC]))})).reading;
  assert.equal(connectorReadiness([c, exp], [local, live]).status, 'LIVE_VERIFIED');
  assert.equal(connectorReadiness([c], [{...live, records: [{...REC, value: 1}]}]).status, 'WIRED_UNVERIFIED', 'tampered reading is not evidence');
});
