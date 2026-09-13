import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CodeWorkshopError, initialCodeWorkshop, validateCodeWorkshop, validateCodeManifest, codeHash,
  importCode, testCodeManifest, recordCodeVerification, activateCode, disableCode, rollbackCode,
  disableCodeForRestore, getCodeStatus, getCodeVersion, createCodeRequest, validateCodeRequest,
  recordCodeRun, fetchGithubCode,
} from '../lib/code-workshop.mjs';
import { executeCodeBundle } from '../lib/code-sandbox.mjs';

const at = { at: '2026-09-13T12:00:00.000Z' };
const manifest = (changes = {}) => ({
  schemaVersion: 1, id: 'sum-records', version: '1.0.0', name: '합계 계산', description: '입력 배열을 실제 JavaScript로 합산한다.',
  source: { kind: 'owner', url: '', commit: '', license: 'Owner private code', licenseText: 'Written for the owner. No third-party code included.' },
  files: [{ path: 'main.mjs', content: 'import {sum} from "./sum.js"; export function run(input){return {total:sum(input.values)}}' },
    { path: 'sum.js', content: 'export const sum=values=>values.reduce((a,b)=>a+b,0);' }],
  entry: 'main.mjs', fixtures: [{ name: '정수', input: { values: [1, 2, 3] }, expected: { total: 6 } },
    { name: '음수', input: { values: [-5, 2] }, expected: { total: -3 } }], ...changes,
});
async function verified(registry = initialCodeWorkshop(), source = manifest()) {
  const imported = importCode(registry, source, at);
  const proof = await testCodeManifest(source);
  return recordCodeVerification(imported.registry, source.id, imported.result.hash, proof, at);
}

test('actual imported JavaScript modules pass fixtures twice, activate, run, pin, restore and roll back', async () => {
  const source = manifest();
  const imported = importCode(initialCodeWorkshop(), source, at);
  assert.throws(() => activateCode(imported.registry, source.id), /먼저 시험/);
  const proof = await testCodeManifest(source);
  assert.equal(proof.passed, 2); assert.equal(proof.deterministic, true);
  let registry = recordCodeVerification(imported.registry, source.id, imported.result.hash, proof, at).registry;
  registry = activateCode(registry, source.id, undefined, at).registry;
  const request = createCodeRequest(registry, source.id, { values: [10, -2, 7] });
  assert.equal(validateCodeRequest(request, registry), true);
  const execution = await executeCodeBundle({ ...getCodeVersion(registry, request.id, request.hash).manifest, input: request.input });
  assert.deepEqual(execution.output, { total: 15 });
  const run = { runId: 'job-real-execution', inputSha256: request.inputSha256, outputSha256: codeHash(execution.output) };
  registry = recordCodeRun(registry, request.id, request.hash, run, at).registry;
  assert.equal(recordCodeRun(registry, request.id, request.hash, run, at).registry.history.length, registry.history.length);
  assert.throws(() => recordCodeRun(registry, request.id, request.hash, { ...run, inputSha256: '0'.repeat(64) }, at), /같은 실행 번호/);
  const upgraded = manifest({ version: '1.1.0', files: [{ path: 'main.mjs', content: 'export default x=>({total:x.values.reduce((a,b)=>a+b,0)});' }] });
  registry = (await verified(registry, upgraded)).registry;
  registry = activateCode(registry, source.id, codeHash(upgraded), at).registry;
  assert.equal(registry.entries[0].previousHash, request.hash);
  assert.equal(validateCodeRequest(request, registry), true, 'historical pinned requests survive upgrades');
  registry = rollbackCode(registry, source.id, at).registry;
  assert.equal(registry.entries[0].activeHash, request.hash);
  assert.deepEqual((await executeCodeBundle({ ...getCodeVersion(registry, request.id, request.hash).manifest, input: request.input })).output, execution.output);
  const restored = disableCodeForRestore(registry, at).registry;
  assert.equal(restored.entries[0].activeHash, null);
  assert.equal(validateCodeRequest(request, restored), true);
  assert.equal(restored.history[0].action, 'restore');
  assert.throws(() => createCodeRequest(restored, source.id, request.input), /활성화/);
  assert.equal(validateCodeWorkshop(restored), true);
  assert.equal(disableCodeForRestore(initialCodeWorkshop(), at).registry.history[0].action, 'restore');
});

test('verification merges into current registry without erasing concurrent changes; immutable versions reject tampering', async () => {
  const source = manifest(), imported = importCode(initialCodeWorkshop(), source, at), proof = await testCodeManifest(source);
  const other = manifest({ id: 'separate-module', name: '다른 기능' });
  const current = importCode(imported.registry, other, at).registry;
  const merged = recordCodeVerification(current, source.id, codeHash(source), proof, at).registry;
  assert.equal(merged.entries.length, 2);
  assert.equal(merged.entries.find(entry => entry.id === other.id).versions[0].verification, null);
  const wrongProof = structuredClone(proof); wrongProof.fixtures[0].outputSha256 = '0'.repeat(64);
  assert.throws(() => recordCodeVerification(merged, source.id, codeHash(source), wrongProof, at), /시험 증거/);
  const tampered = structuredClone(merged); tampered.entries[0].versions[0].manifest.files[0].content += '\n// modified';
  assert.throws(() => validateCodeWorkshop(tampered), /해시/);
  assert.throws(() => importCode(merged, manifest({ description: 'changed bytes, same version' }), at), /덮어쓸/);
  assert.equal(importCode(merged, source, at).result.alreadyImported, true);
  const exposed = getCodeVersion(merged, source.id); exposed.manifest.files[0].content = 'modified returned copy';
  assert.equal(validateCodeWorkshop(merged), true);
});

test('wrong expected output and host access fail actual isolated fixtures and cannot create passing proof', async () => {
  const wrong = manifest(); wrong.fixtures[0].expected.total = 100;
  await assert.rejects(testCodeManifest(wrong), error => error instanceof CodeWorkshopError && error.code === 'CODE_TEST_FAILED');
  const host = manifest({ files: [{ path: 'main.mjs', content: 'export function run(){return process.env;}' }] });
  await assert.rejects(testCodeManifest(host), /process|Sandbox|코드|실행/i);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(testCodeManifest(manifest(), { signal: abort.signal }));
});

test('manifest format and byte limits reject path escapes, duplicate inputs, oversized source, dangerous JSON and bad provenance', () => {
  for (const path of ['../escape.js', '/absolute.js', 'a/../escape.js', 'a//b.js', 'node_modules/a.js', 'a\\b.js', 'a%2fb.js', '.git/x.js', 'main.py']) {
    const source = manifest({ files: [{ path, content: 'export default x=>x;' }], entry: path });
    assert.throws(() => validateCodeManifest(source), /경로|파일|묶음/);
  }
  const duplicate = manifest(); duplicate.fixtures[1].input = duplicate.fixtures[0].input;
  assert.throws(() => validateCodeManifest(duplicate), /서로 다른/);
  assert.throws(() => validateCodeManifest(manifest({ files: [{ path: 'main.mjs', content: '가'.repeat(23000) }] })), /64KB/);
  const bad = manifest(); bad.fixtures[0].input = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => validateCodeManifest(bad), /JSON 필드/);
  assert.throws(() => codeHash({ infinite: Infinity }), /유한/);
  assert.throws(() => codeHash({ values: Array(501).fill(1) }), /500/);
  const github = manifest({ source: { kind: 'github', url: 'https://github.com/example/repo', commit: 'main', license: 'MIT', licenseText: 'notice' } });
  assert.throws(() => validateCodeManifest(github), /고정 커밋/);
  const derived = manifest({ source: { kind: 'generated', url: 'https://github.com/example/repo', commit: 'a'.repeat(40), license: 'MIT',
    licenseText: 'Original notice. BLACKHOLE AI-modified derivative; upstream URL and commit identify its origin, not these modified bytes.' } });
  assert.equal(validateCodeManifest(derived), true);
  assert.throws(() => validateCodeManifest({ ...derived, source: { ...derived.source, commit: '' } }), /고정 커밋/);
  assert.throws(() => validateCodeManifest({ ...derived, source: { ...derived.source, kind: 'owner' } }), /외부 출처/);
  assert.equal(codeHash({ b: 2, a: 1 }), codeHash({ a: 1, b: 2 }));
  assert.notEqual(codeHash('x'), codeHash(['x']));
});

test('stopped code rejects new execution and late unrecorded results, but retained same-job receipts remain replayable', async () => {
  let registry = activateCode((await verified()).registry, 'sum-records').registry;
  const request = createCodeRequest(registry, 'sum-records', { values: [5] });
  const run = { runId: 'job-completed', inputSha256: request.inputSha256, outputSha256: codeHash({ total: 5 }) };
  registry = recordCodeRun(registry, request.id, request.hash, run).registry;
  registry = disableCode(registry, request.id).registry;
  assert.throws(() => createCodeRequest(registry, request.id, request.input), /활성화/);
  assert.throws(() => recordCodeRun(registry, request.id, request.hash, { ...run, runId: 'late-uncommitted' }), /중지/);
  assert.equal(recordCodeRun(registry, request.id, request.hash, run).result.alreadyRecorded, true);
  const corrupted = { ...request, input: { values: [6] } };
  assert.throws(() => validateCodeRequest(corrupted, registry), /해시/);
  const status = getCodeStatus(registry)[0];
  assert.equal(status.runCount, 1); assert.equal(status.status, 'inactive');
  assert.equal('licenseText' in status.source, false);
  assert.equal('content' in status.files[0], false);
});

const MIT = `MIT License\nCopyright (c) 2026 Test Author\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.\n`;
const sha = 'a'.repeat(40);
const intakeRequest = () => ({ url: 'https://github.com/example/calculator', paths: ['main.mjs', 'sum.js'], licensePath: 'LICENSE',
  entry: 'main.mjs', id: 'sum-records', version: '1.0.0', name: '합계 계산', description: '공개 저장소에서 가져온 코드', fixtures: manifest().fixtures });
function sourceFetch(overrides = {}) {
  const calls = [];
  const responseFor = path => {
    if (path === '/repos/example/calculator') return new Response(JSON.stringify({ private: false, default_branch: 'release/stable' }));
    if (path === '/repos/example/calculator/git/ref/heads/release/stable') return new Response(JSON.stringify({ object: { type: 'commit', sha } }));
    if (path.endsWith('/LICENSE')) return new Response(MIT);
    if (path.endsWith('/main.mjs')) return new Response(manifest().files[0].content);
    if (path.endsWith('/sum.js')) return new Response(manifest().files[1].content);
    throw new Error(`Unexpected path ${path}`);
  };
  return { calls, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    const parsed = new URL(url); const replacement = overrides[parsed.pathname];
    return replacement ? replacement(url, options) : responseFor(parsed.pathname);
  } };
}

test('GitHub intake pins the default branch once, fetches exact source and license bytes, then actually runs the imported code', async () => {
  const fake = sourceFetch();
  const imported = await fetchGithubCode(intakeRequest(), { fetchImpl: fake.fetchImpl });
  assert.equal(imported.source.commit, sha);
  assert.equal(imported.source.licenseText, MIT);
  assert.equal(imported.source.license, 'MIT');
  assert.equal(imported.files[1].content, manifest().files[1].content);
  assert.equal(fake.calls.length, 5);
  for (const call of fake.calls) {
    assert.equal(call.options.method, 'GET'); assert.equal(call.options.redirect, 'error');
    assert.equal('Authorization' in call.options.headers, false);
    if (new URL(call.url).hostname === 'raw.githubusercontent.com') assert.ok(call.url.includes(`/${sha}/`));
  }
  assert.equal((await testCodeManifest(imported)).passed, 2);
  assert.equal(importCode(initialCodeWorkshop(), imported).registry.entries[0].activeHash, null, 'intake never activates');
});

test('GitHub intake rejects untrusted origins, traversal and invalid metadata before any request', async () => {
  let calls = 0; const fetchImpl = () => { calls++; throw new Error('must not fetch'); };
  for (const url of ['http://github.com/example/calculator', 'https://github.com.evil.test/example/calculator', 'https://127.0.0.1/a/b',
    'https://user:secret@github.com/example/calculator', 'https://github.com/example/calculator?token=secret', 'https://github.com/example/calculator/blob/main/main.js']) {
    await assert.rejects(fetchGithubCode({ ...intakeRequest(), url }, { fetchImpl }), CodeWorkshopError);
  }
  await assert.rejects(fetchGithubCode({ ...intakeRequest(), paths: ['../private.js'] }, { fetchImpl }), CodeWorkshopError);
  await assert.rejects(fetchGithubCode({ ...intakeRequest(), licensePath: '../LICENSE' }, { fetchImpl }), CodeWorkshopError);
  await assert.rejects(fetchGithubCode({ ...intakeRequest(), fixtures: [] }, { fetchImpl }), CodeWorkshopError);
  assert.equal(calls, 0);
});

test('GitHub intake refuses redirects, unknown license, oversized or non-UTF8 streams and noncommit heads', async () => {
  const apiPath = '/repos/example/calculator';
  const cases = [
    { [apiPath]: () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } }) },
    { [apiPath]: () => new Response(JSON.stringify({ private: true, default_branch: 'main' })) },
    { [apiPath]: () => new Response(JSON.stringify({ private: false, default_branch: '../other/branch' })) },
    { [`${apiPath}/git/ref/heads/release/stable`]: () => new Response(JSON.stringify({ object: { type: 'tag', sha } })) },
    { [`/example/calculator/${sha}/LICENSE`]: () => new Response('No permission is granted. All rights reserved.') },
    { [`/example/calculator/${sha}/main.mjs`]: () => new Response('a'.repeat(65537)) },
    { [`/example/calculator/${sha}/main.mjs`]: () => new Response(new Uint8Array([0xc0, 0xaf])) },
    { [`/example/calculator/${sha}/sum.js`]: () => new Response('unavailable', { status: 404 }) },
  ];
  for (const overrides of cases) {
    const fake = sourceFetch(overrides);
    await assert.rejects(fetchGithubCode(intakeRequest(), { fetchImpl: fake.fetchImpl }), CodeWorkshopError);
  }
});
