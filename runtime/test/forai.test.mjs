import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { FORAI_MAX_BYTES, FORAI_PROJECT_ID, ForAiError, validateForAiInput, runForAiAudit, fetchForAiPage, forAiAddressIsPublic } from '../lib/forai.mjs';

const html = '<!doctype html><html><head><title>BLACKHOLE &amp; For-Ai</title><meta content="페이지 점검 도구" name="description"><link rel="canonical" href="https://example.com/page"><meta name="author" content="테스트 작성자"><meta name="robots" content="index, follow"><script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"BLACKHOLE"}</script></head><body><h1>페이지 점검</h1><h2>근거 <em>보존</em></h2><p>작성한 설명입니다.</p></body></html>';
const profile = { name: 'BLACKHOLE', description: '소유자가 제공한 설명', siteUrl: 'https://example.com/', author: '테스트 작성자' };
const publicDns = async () => [{ address: '93.184.216.34', family: 4 }, { address: '2606:4700::1111', family: 6 }];
function transport({ status = 200, headers = {}, chunks = [Buffer.from(html)], hang = false, onOptions } = {}) {
  let calls = 0, destroyed = false;
  const requestImpl = (options, onResponse) => {
    calls++; onOptions?.(options);
    const req = new EventEmitter();
    req.destroy = () => { destroyed = true; };
    req.end = () => {
      queueMicrotask(() => {
        const response = new PassThrough();
        response.statusCode = status;
        response.headers = { 'content-type': 'text/html; charset=utf-8', ...headers };
        onResponse(response);
        if (!hang) { for (const chunk of chunks) if (!response.destroyed) response.write(chunk); if (!response.destroyed) response.end(); }
      });
    };
    return req;
  };
  return { requestImpl, calls: () => calls, destroyed: () => destroyed };
}

test('For-Ai validates UTF-8 size, schema, modes and public source URLs before work', () => {
  assert.deepEqual(validateForAiInput({ content: '  <h1>원문</h1>  ' }), { mode: 'html', content: '<h1>원문</h1>' });
  assert.equal(validateForAiInput({ mode: 'url', url: 'https://www.example.com/path#part' }).url, 'https://www.example.com/path');
  for (const value of [null, [], {}, { mode: 'other' }, { content: ' ' }, { content: 'x', secrets: true }, { mode: 'url', url: 'https://example.com', content: 'x' }, { mode: 'html', content: '한'.repeat(FORAI_MAX_BYTES / 2) }, { content: 'x', profile: { key: 'secret' } }]) assert.throws(() => validateForAiInput(value), ForAiError);
  for (const url of ['http://example.com', 'file:///etc/passwd', 'https://localhost/', 'https://app.internal/', 'https://metadata.google.internal/', 'https://127.0.0.1/', 'https://2130706433/', 'https://0177.0.0.1/', 'https://0x7f000001/', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://user:secret@example.com/', 'https://example.com:8443/', 'https://example.com/?token=DO_NOT_LOG_THIS', 'https://example.com/?%2574oken=secret', 'https://example.com/#access_token=secret', 'https://example.com\\@localhost/']) {
    assert.throws(() => validateForAiInput({ mode: 'url', url }), error => error instanceof ForAiError && !/DO_NOT_LOG_THIS|passwd/.test(error.message), url);
  }
});

test('For-Ai excludes local, special, mapped and transition IPv4/IPv6 addresses', () => {
  for (const address of ['0.0.0.0','10.1.2.3','100.100.100.200','127.0.0.1','169.254.169.254','172.16.2.3','192.168.1.1','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','168.63.129.16','::','::1','::ffff:93.184.216.34','fc00::1','fe80::1','fe80::1%eth0','2001:db8::1','2002:7f00:1::','64:ff9b::7f00:1','3fff::1','not-an-ip']) assert.equal(forAiAddressIsPublic(address), false, address);
  for (const address of ['1.1.1.1','8.8.8.8','93.184.216.34','2606:4700::1111','2001:4860:4860::8888']) assert.equal(forAiAddressIsPublic(address), true, address);
});

test('For-Ai pasted HTML produces real source hash and deterministic observations without network or model calls', async () => {
  let fetches = 0;
  const result = await runForAiAudit({ input: { mode: 'html', content: html, url: 'https://example.com/source', profile }, fetchImpl: () => { fetches++; throw new Error('must not fetch'); } });
  assert.equal(fetches, 0);
  assert.equal(result.evidence.projectId, FORAI_PROJECT_ID);
  assert.equal(result.evidence.source.readMethod, 'owner_paste');
  assert.equal(result.evidence.source.status, null);
  assert.equal(result.evidence.source.sha256, createHash('sha256').update(html).digest('hex'));
  assert.equal(result.evidence.source.bytes, Buffer.byteLength(html));
  assert.deepEqual(result.evidence.observations.titles, ['BLACKHOLE & For-Ai']);
  assert.deepEqual(result.evidence.observations.descriptions, ['페이지 점검 도구']);
  assert.deepEqual(result.evidence.observations.headings, [{ level: 1, text: '페이지 점검' }, { level: 2, text: '근거 보존' }]);
  assert.deepEqual(result.evidence.observations.jsonLd, { total: 1, valid: 1, invalid: 0, types: ['WebSite'] });
  assert.equal(result.evidence.findings.find(item => item.code === 'ai_visibility').state, 'unknown');
  const schema = JSON.parse(result.evidence.candidates.schemaJson);
  assert.equal(schema.description, profile.description);
  assert.equal(schema.author.name, profile.author);
  assert.equal(schema.url, profile.siteUrl);
  assert.doesNotMatch(JSON.stringify(schema), /rating|rank|review/);
  assert.match(result.report, /schema\.json|llms\.txt/);
  assert.match(result.report, /실제 내려받았다는 증거가 아닙니다/);
  const second = await runForAiAudit({ input: { content: html, profile } });
  assert.deepEqual(second.evidence.observations, result.evidence.observations);
  assert.deepEqual(second.evidence.findings, result.evidence.findings);
});

test('For-Ai ignores comments, scripts, templates and title rawtext while reporting actual malformed metadata', async () => {
  const input = '<!-- <title>fake</title> --><script>"<meta name=description content=fake><h1>fake</h1>"</script><template><title>fake</title><meta name=author content=fake></template><title>Real <meta name=description content=fake></title><meta name=robots content=noindex><script type="application/ld+json">{broken</script><h2>Only H2</h2>';
  const { evidence, report } = await runForAiAudit({ input: { content: input } });
  assert.equal(evidence.observations.titles.length, 1);
  assert.equal(evidence.observations.descriptions.length, 0);
  assert.equal(evidence.observations.sourceInfo.authors.length, 0);
  assert.equal(evidence.observations.headings.length, 1);
  assert.equal(evidence.observations.jsonLd.invalid, 1);
  assert.equal(evidence.findings.find(item => item.code === 'robots_directives').state, 'needs_review');
  assert.equal(evidence.candidates.status, 'needs_owner_profile');
  assert.equal(evidence.candidates.schemaJson, null);
  assert.doesNotMatch(report, /<meta name=description/);
});

test('For-Ai text-only input keeps all HTML/search findings unknown and neutralizes report markup', async () => {
  const { evidence, report } = await runForAiAudit({ input: { mode: 'text', content: '<title>not an HTML audit</title>', profile: { ...profile, name: '<img src=x onerror=alert(1)>```', description: '```\n# fake report\n[x](javascript:alert(1))' } } });
  assert.equal(evidence.observations.htmlMetadata, 'not_observed_in_text_input');
  assert.ok(evidence.findings.every(finding => finding.state === 'unknown'));
  assert.equal(JSON.parse(evidence.candidates.schemaJson).name, '<img src=x onerror=alert(1)>```');
  assert.doesNotMatch(report, /<img src=x|\n# fake report|\n```\n# fake report/);
  assert.equal((report.match(/^```/gm) ?? []).length, 4, 'only the intended two code fences');
});

test('For-Ai HTTPS transport pins the validated IP with original TLS host and sends no credentials', async () => {
  let lookups = 0;
  const fixture = transport({ onOptions(options) {
    assert.equal(options.hostname, 'example.com'); assert.equal(options.servername, 'example.com');
    assert.equal(options.agent, false); assert.equal(options.rejectUnauthorized, true); assert.equal(options.autoSelectFamily, false);
    assert.equal(options.method, 'GET'); assert.equal(options.path, '/page?q=one');
    assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'Accept-Encoding', 'User-Agent']);
    options.lookup('example.com', {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, '93.184.216.34'); assert.equal(family, 4); });
    options.lookup('example.com', { all: true }, (error, addresses) => { assert.equal(error, null); assert.deepEqual(addresses, [{ address: '93.184.216.34', family: 4 }]); });
    options.lookup('private.internal', {}, error => assert.ok(error));
  } });
  const page = await fetchForAiPage({ url: 'https://example.com/page?q=one#fragment', lookupImpl: async () => { lookups++; return publicDns(); }, requestImpl: fixture.requestImpl });
  assert.equal(lookups, 1); assert.equal(fixture.calls(), 1); assert.equal(page.raw.toString(), html); assert.equal(page.status, 200);
});

test('For-Ai refuses mixed public/private DNS answers before opening a socket', async () => {
  const fixture = transport();
  for (const addresses of [[{ address: '127.0.0.1', family: 4 }], [{ address: '1.1.1.1', family: 4 }, { address: '169.254.169.254', family: 4 }], [{ address: '::ffff:127.0.0.1', family: 6 }], [{ address: '1.1.1.1', family: 6 }], []]) {
    await assert.rejects(fetchForAiPage({ url: 'https://example.com', lookupImpl: async () => addresses, requestImpl: fixture.requestImpl }), /DNS/);
  }
  assert.equal(fixture.calls(), 0);
});

test('For-Ai blocks all redirects, oversized bodies, nontext responses, compression and invalid UTF-8', async () => {
  for (const setup of [
    { status: 302, headers: { location: 'https://127.0.0.1/private?token=DO_NOT_LOG' } },
    { status: 401 }, { headers: { 'content-length': String(FORAI_MAX_BYTES + 1) } },
    { chunks: [Buffer.alloc(FORAI_MAX_BYTES), Buffer.from('x')] },
    { headers: { 'content-type': 'application/json' } }, { headers: { 'content-encoding': 'gzip' } },
    { headers: { 'content-type': 'text/html; charset=euc-kr' } },
    { chunks: [Buffer.from([0xff, 0xfe, 0xff])] }, { chunks: [] },
  ]) {
    const fixture = transport(setup);
    await assert.rejects(fetchForAiPage({ url: 'https://example.com', lookupImpl: publicDns, requestImpl: fixture.requestImpl }), error => error instanceof ForAiError && !/DO_NOT_LOG|127\.0\.0\.1/.test(error.message));
    assert.equal(fixture.calls(), 1); assert.equal(fixture.destroyed(), true);
  }
});

test('For-Ai stop applies before network, during DNS and during body read with bounded timeout', async () => {
  const before = new AbortController(); before.abort();
  let calls = 0;
  await assert.rejects(fetchForAiPage({ url: 'https://example.com', signal: before.signal, lookupImpl: async () => { calls++; return publicDns(); } }), /중단/);
  assert.equal(calls, 0);
  await assert.rejects(runForAiAudit({ input: { content: html }, signal: before.signal }), /중단/);
  await assert.rejects(fetchForAiPage({ url: 'https://example.com', lookupImpl: () => new Promise(() => {}), timeoutMs: 20 }), /중단/);
  const hanging = transport({ hang: true });
  await assert.rejects(fetchForAiPage({ url: 'https://example.com', lookupImpl: publicDns, requestImpl: hanging.requestImpl, timeoutMs: 20 }), /중단/);
  assert.equal(hanging.destroyed(), true);
  await assert.rejects(runForAiAudit({ input: { mode: 'url', url: 'https://example.com' }, fetchImpl: async () => new Response(html) }), /DNS 고정/);
});

test('For-Ai dense input preserves bounded evidence and marks observation truncation', async () => {
  const { evidence } = await runForAiAudit({ input: { content: '<title>example</title>' + '<h2>짧은 제목</h2>'.repeat(2000) } });
  assert.equal(evidence.observations.headings.length, 30);
  assert.equal(evidence.observations.inspectionTruncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(evidence)) < 32 * 1024);
});
