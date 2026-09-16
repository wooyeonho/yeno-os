import crypto from 'node:crypto';
import { executeCodeBundle } from './code-sandbox.mjs';

export class CodeWorkshopError extends Error {
  constructor(status, message, code = 'CODE_WORKSHOP_INVALID') {
    super(message); this.name = 'CodeWorkshopError'; this.status = status; this.code = code; this.extra = { code };
  }
}
const fail = (message, status = 400, code) => { throw new CodeWorkshopError(status, message, code); };
const ID = /^[a-z][a-z0-9-]{1,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => isObject(value) && Object.keys(value).sort().join() === keys.slice().sort().join();
const text = (value, limit) => typeof value === 'string' && !!value.trim() && value.length <= limit;
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const at = options => { const value = options?.at ?? new Date().toISOString(); if (!iso(value)) fail('기록 시각이 올바르지 않습니다.'); return value; };
const clone = value => structuredClone(value);

function jsonValue(value, depth = 0) {
  if (depth > 12) fail('JSON 구조는 12단계 이하로 입력하세요.');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('유한한 숫자가 필요합니다.'); return; }
  if (typeof value === 'string') { if (value.length > 65536) fail('텍스트가 너무 깁니다.'); return; }
  if (Array.isArray(value)) { if (value.length > 500) fail('목록은 500개 이하로 입력하세요.'); for (const child of value) jsonValue(child, depth + 1); return; }
  if (!isObject(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('일반 JSON 값이 필요합니다.');
  if (Object.keys(value).length > 64) fail('JSON 필드가 너무 많습니다.');
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || key.length > 160) fail('허용하지 않는 JSON 필드입니다.');
    jsonValue(child, depth + 1);
  }
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function bounded(value, limit = 65536) {
  jsonValue(value);
  const bytes = canonical(value);
  if (Buffer.byteLength(bytes) > limit) fail('코드 묶음과 입력은 각각 64KB 이하로 줄여 주세요.');
  return bytes;
}
export function codeHash(value) { return crypto.createHash('sha256').update(bounded(value)).digest('hex'); }
// The exact bytes codeHash digests, so a stored artifact can carry the run
// output with sha256(artifact) === run.outputSha256.
export function canonicalCode(value) { return bounded(value); }

// Explicit, fixture-verified input contract. A QuickJS capability that wants
// to be discoverable by General Kirby declares the record fields it consumes;
// every fixture input must then be `{records:[...]}` rows carrying exactly
// those fields with those types, so the contract is proven by the same
// fixtures the sandbox re-runs - never inferred from code or description.
export const CONTRACT_TYPES = Object.freeze(['string', 'number', 'boolean']);
export function validateInputContract(contract) {
  if (!exact(contract, ['records']) || !exact(contract.records, ['fields']) || !isObject(contract.records.fields)) fail('입력 계약은 {records:{fields}} 형식이어야 합니다.');
  const names = Object.keys(contract.records.fields);
  if (names.length < 1 || names.length > 16 || names.some(name => !/^[a-z][A-Za-z0-9]{0,39}$/.test(name) || !CONTRACT_TYPES.includes(contract.records.fields[name]))) fail('입력 계약 필드 이름·타입을 확인하세요.');
  return true;
}
export function inputMatchesContract(contract, input) {
  if (!exact(input, ['records']) || !Array.isArray(input.records) || !input.records.length) return false;
  const fields = contract.records.fields, names = Object.keys(fields).sort().join();
  return input.records.every(row => isObject(row) && Object.keys(row).sort().join() === names && Object.keys(fields).every(name => typeof row[name] === fields[name]));
}
export function codeInputFields(manifest) { return manifest?.inputContract?.records?.fields ?? null; }

function validPath(path, javascript = false) {
  return typeof path === 'string' && path.length <= 180 && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path)
    && path.split('/').every(part => part !== '.' && part !== '..' && part !== 'node_modules' && !part.startsWith('.'))
    && (!javascript || /\.(?:mjs|js)$/.test(path));
}
function githubRepo(value) {
  let url;
  try { url = new URL(value); } catch { fail('GitHub 저장소 주소를 확인하세요.'); }
  const parts = url.pathname.replace(/\/$/, '').split('/').slice(1);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash || parts.length !== 2
      || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(parts[0]) || !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[1]) || ['.', '..'].includes(parts[1])) {
    fail('https://github.com/소유자/저장소 형식의 공개 저장소 주소가 필요합니다.');
  }
  const repository = parts[1].replace(/\.git$/, '');
  if (!repository || ['.', '..'].includes(repository)) fail('GitHub 저장소 주소를 확인하세요.');
  return { owner: parts[0], repository, url: `https://github.com/${parts[0]}/${repository}` };
}

export function validateCodeManifest(manifest) {
  bounded(manifest);
  const withContract = Object.hasOwn(manifest ?? {}, 'inputContract');
  if (!exact(manifest, ['schemaVersion', 'id', 'version', 'name', 'description', 'source', 'files', 'entry', 'fixtures', ...(withContract ? ['inputContract'] : [])])
      || manifest.schemaVersion !== 1 || !ID.test(manifest.id) || !VERSION.test(manifest.version) || !text(manifest.name, 100) || !text(manifest.description, 600)) {
    fail('코드 기능의 이름·버전·형식을 확인하세요.');
  }
  const source = manifest.source;
  if (!exact(source, ['kind', 'url', 'commit', 'license', 'licenseText']) || !['owner', 'generated', 'github'].includes(source.kind)
      || typeof source.url !== 'string' || typeof source.commit !== 'string' || !text(source.license, 160) || !text(source.licenseText, 32000)) {
    fail('코드 출처와 원본 이용 조건을 포함하세요.');
  }
  if (source.kind === 'github' || (source.kind === 'generated' && (source.url || source.commit))) {
    if (githubRepo(source.url).url !== source.url || !COMMIT.test(source.commit)) fail('GitHub 코드는 정규 저장소 주소와 고정 커밋이 필요합니다.');
  } else if (source.url !== '' || source.commit !== '') fail('직접 작성·생성한 코드는 외부 출처로 표시할 수 없습니다.');
  if (!Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 16) fail('JavaScript 파일을 1~16개 포함하세요.');
  const paths = new Set();
  for (const file of manifest.files) {
    if (!exact(file, ['path', 'content']) || !validPath(file.path, true) || !text(file.content, 65536) || paths.has(file.path)) fail('중복 없는 상대 경로의 .js 또는 .mjs 파일이 필요합니다.');
    paths.add(file.path);
  }
  if (!validPath(manifest.entry, true) || !paths.has(manifest.entry)) fail('실행할 entry 파일이 코드 묶음에 있어야 합니다.');
  if (!Array.isArray(manifest.fixtures) || manifest.fixtures.length < 2 || manifest.fixtures.length > 8) fail('서로 다른 시험 입력과 예상 결과를 2~8개 포함하세요.');
  if (withContract) validateInputContract(manifest.inputContract);
  const names = new Set(), inputs = new Set();
  for (const fixture of manifest.fixtures) {
    if (!exact(fixture, ['name', 'input', 'expected']) || !text(fixture.name, 100) || names.has(fixture.name)) fail('시험 이름·입력·예상 결과를 확인하세요.');
    const digest = codeHash(fixture.input);
    if (inputs.has(digest)) fail('시험마다 서로 다른 입력이 필요합니다.');
    codeHash(fixture.expected); names.add(fixture.name); inputs.add(digest);
    if (withContract && !inputMatchesContract(manifest.inputContract, fixture.input)) fail(`시험 ${fixture.name}의 입력이 선언한 입력 계약과 다릅니다.`);
  }
  return true;
}

export function initialCodeWorkshop() { return { version: 1, entries: [], history: [] }; }
function proofMatches(manifest, hash, proof) {
  if (!exact(proof, ['engine', 'hash', 'passed', 'deterministic', 'fixtures']) || proof.engine !== 'quickjs-v1' || proof.hash !== hash
      || proof.passed !== manifest.fixtures.length || proof.deterministic !== true || !Array.isArray(proof.fixtures) || proof.fixtures.length !== manifest.fixtures.length) return false;
  return proof.fixtures.every((fixture, index) => exact(fixture, ['name', 'inputSha256', 'outputSha256'])
    && fixture.name === manifest.fixtures[index].name && fixture.inputSha256 === codeHash(manifest.fixtures[index].input) && fixture.outputSha256 === codeHash(manifest.fixtures[index].expected));
}
export function validateCodeWorkshop(registry) {
  if (!exact(registry, ['version', 'entries', 'history']) || registry.version !== 1 || !Array.isArray(registry.entries) || registry.entries.length > 10
      || !Array.isArray(registry.history) || registry.history.length > 500) fail('저장된 코드 기능 목록을 검증하지 못했습니다.');
  const ids = new Set(); let count = 0;
  for (const entry of registry.entries) {
    if (!exact(entry, ['id', 'versions', 'activeHash', 'previousHash']) || !ID.test(entry.id) || ids.has(entry.id) || !Array.isArray(entry.versions) || !entry.versions.length) fail('저장된 코드 항목이 올바르지 않습니다.');
    ids.add(entry.id); count += entry.versions.length;
    const hashes = new Set(), versions = new Set();
    for (const version of entry.versions) {
      if (!exact(version, ['hash', 'manifest', 'importedAt', 'verifiedAt', 'verification']) || !HASH.test(version.hash) || !iso(version.importedAt)
          || !(version.verifiedAt === null || iso(version.verifiedAt))) fail('코드 버전 기록이 올바르지 않습니다.');
      validateCodeManifest(version.manifest);
      if (version.manifest.id !== entry.id || codeHash(version.manifest) !== version.hash || hashes.has(version.hash) || versions.has(version.manifest.version)) fail('코드 원본과 저장된 해시가 일치하지 않습니다.');
      hashes.add(version.hash); versions.add(version.manifest.version);
      if (version.verification === null ? version.verifiedAt !== null : (!version.verifiedAt || !proofMatches(version.manifest, version.hash, version.verification))) fail('코드의 시험 증거를 검증하지 못했습니다.');
    }
    if ([entry.activeHash, entry.previousHash].some(hash => hash !== null && !hashes.has(hash))) fail('활성 코드 버전을 찾을 수 없습니다.');
    if (entry.activeHash && !entry.versions.find(version => version.hash === entry.activeHash).verification) fail('시험하지 않은 코드는 활성화할 수 없습니다.');
  }
  if (count > 30) fail('코드 버전은 총 30개까지 보관할 수 있습니다.', 409);
  const runs = new Set();
  for (const event of registry.history) {
    if (!exact(event, ['at', 'action', 'id', 'hash', 'runId', 'inputSha256', 'outputSha256']) || !iso(event.at)
        || !['import', 'verify', 'activate', 'disable', 'rollback', 'run', 'restore'].includes(event.action)
        || !(event.id === null || ID.test(event.id)) || ![event.hash, event.inputSha256, event.outputSha256].every(value => value === null || HASH.test(value))
        || !(event.runId === null || text(event.runId, 100))) fail('코드 기능 이력이 올바르지 않습니다.');
    if (event.action === 'run') {
      if (!event.id || !event.hash || !event.runId || !event.inputSha256 || !event.outputSha256 || runs.has(event.runId)) fail('코드 실행 이력이 올바르지 않습니다.');
      runs.add(event.runId);
    } else if (event.runId !== null || event.inputSha256 !== null || event.outputSha256 !== null) fail('코드 이력의 실행 증거가 올바르지 않습니다.');
    if (event.action === 'restore' ? (event.id !== null || event.hash !== null) : (!event.id || !event.hash)) fail('코드 이력의 대상이 올바르지 않습니다.');
  }
  return true;
}
function copy(registry) { validateCodeWorkshop(registry); return clone(registry); }
function group(registry, id) { const entry = registry.entries.find(item => item.id === id); if (!entry) fail('가져온 코드 기능을 찾을 수 없습니다.', 404); return entry; }
function versionOf(entry, hash) { const version = entry.versions.find(item => item.hash === (hash ?? entry.versions.at(-1).hash)); if (!version) fail('코드 버전을 찾을 수 없습니다.', 404); return version; }
function event(registry, action, id, hash, options = {}, extra = {}) {
  registry.history.unshift({ at: at(options), action, id, hash, runId: null, inputSha256: null, outputSha256: null, ...extra });
  registry.history = registry.history.slice(0, 500);
}
export function importCode(registry, manifest, options = {}) {
  const result = copy(registry); validateCodeManifest(manifest); const hash = codeHash(manifest);
  let entry = result.entries.find(item => item.id === manifest.id);
  if (entry?.versions.some(version => version.hash === hash)) return { registry: result, result: { id: entry.id, hash, alreadyImported: true } };
  if (entry?.versions.some(version => version.manifest.version === manifest.version)) fail('같은 버전의 원본 코드를 덮어쓸 수 없습니다.', 409);
  if (!entry) { entry = { id: manifest.id, versions: [], activeHash: null, previousHash: null }; result.entries.push(entry); }
  entry.versions.push({ hash, manifest: clone(manifest), importedAt: at(options), verifiedAt: null, verification: null });
  event(result, 'import', entry.id, hash, options); validateCodeWorkshop(result);
  return { registry: result, result: { id: entry.id, hash } };
}
export function getCodeVersion(registry, id, hash) {
  validateCodeWorkshop(registry); return clone(versionOf(group(registry, id), hash));
}
export async function testCodeManifest(manifest, options = {}) {
  validateCodeManifest(manifest); const hash = codeHash(manifest); const fixtures = [];
  for (const fixture of manifest.fixtures) {
    const outputs = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await executeCodeBundle({ files: manifest.files, entry: manifest.entry, input: clone(fixture.input) }, { signal: options.signal });
      outputs.push(codeHash(result.output));
    }
    if (outputs[0] !== outputs[1]) fail(`시험 결과가 실행마다 다릅니다: ${fixture.name}`, 409, 'CODE_NONDETERMINISTIC');
    if (outputs[0] !== codeHash(fixture.expected)) fail(`코드 시험 실패: ${fixture.name}`, 409, 'CODE_TEST_FAILED');
    fixtures.push({ name: fixture.name, inputSha256: codeHash(fixture.input), outputSha256: outputs[0] });
  }
  return { engine: 'quickjs-v1', hash, passed: fixtures.length, deterministic: true, fixtures };
}
// Merge the independently obtained proof into CURRENT state, never an async snapshot.
export function recordCodeVerification(registry, id, hash, verification, options = {}) {
  const result = copy(registry), version = versionOf(group(result, id), hash);
  if (!proofMatches(version.manifest, version.hash, verification)) fail('시험 증거와 고정된 코드 원본이 다릅니다.', 409);
  version.verification = clone(verification); version.verifiedAt = at(options);
  event(result, 'verify', id, version.hash, options); validateCodeWorkshop(result);
  return { registry: result, result: { id, hash: version.hash, ...clone(verification) } };
}
export function activateCode(registry, id, hash, options = {}) {
  const result = copy(registry), entry = group(result, id), version = versionOf(entry, hash);
  if (!version.verification) fail('코드를 먼저 시험하세요.', 409);
  if (entry.activeHash !== version.hash) { entry.previousHash = entry.activeHash; entry.activeHash = version.hash; event(result, 'activate', id, version.hash, options); }
  return { registry: result, result: { id, hash: version.hash, active: true } };
}
export function disableCode(registry, id, options = {}) {
  const result = copy(registry), entry = group(result, id);
  if (entry.activeHash) { entry.previousHash = entry.activeHash; entry.activeHash = null; event(result, 'disable', id, entry.previousHash, options); }
  return { registry: result, result: { id, active: false } };
}
export function rollbackCode(registry, id, options = {}) {
  validateCodeWorkshop(registry); const entry = group(registry, id);
  if (!entry.previousHash) fail('복원할 이전 코드 버전이 없습니다.', 409);
  const result = activateCode(registry, id, entry.previousHash, options);
  event(result.registry, 'rollback', id, result.result.hash, options); return result;
}
export function disableCodeForRestore(registry, options = {}) {
  const result = copy(registry);
  for (const entry of result.entries) if (entry.activeHash) { entry.previousHash = entry.activeHash; entry.activeHash = null; event(result, 'disable', entry.id, entry.previousHash, options); }
  event(result, 'restore', null, null, options); return { registry: result, result: { disabled: true } };
}
export function createCodeRequest(registry, id, input) {
  validateCodeWorkshop(registry); const entry = group(registry, id);
  if (!entry.activeHash) fail('코드를 시험하고 활성화한 뒤 실행하세요.', 409);
  return { id, hash: entry.activeHash, input: clone(input), inputSha256: codeHash(input) };
}
export function validateCodeRequest(request, registry) {
  if (!exact(request, ['id', 'hash', 'input', 'inputSha256']) || !ID.test(request.id) || !HASH.test(request.hash) || !HASH.test(request.inputSha256)) fail('저장된 코드 실행 입력이 올바르지 않습니다.');
  getCodeVersion(registry, request.id, request.hash);
  if (codeHash(request.input) !== request.inputSha256) fail('코드 실행 입력과 해시가 다릅니다.');
  return true;
}
export function recordCodeRun(registry, id, hash, run, options = {}) {
  const result = copy(registry), entry = group(result, id), version = versionOf(entry, hash);
  if (!exact(run, ['runId', 'inputSha256', 'outputSha256']) || !text(run.runId, 100) || !HASH.test(run.inputSha256) || !HASH.test(run.outputSha256)) fail('코드 실행 증거가 올바르지 않습니다.');
  const previous = result.history.find(item => item.action === 'run' && item.runId === run.runId);
  if (previous) {
    if (previous.id !== id || previous.hash !== hash || previous.inputSha256 !== run.inputSha256 || previous.outputSha256 !== run.outputSha256) fail('같은 실행 번호의 원본·입력·결과가 다릅니다.', 409);
    return { registry: result, result: { id, hash, ...clone(run), alreadyRecorded: true } };
  }
  if (entry.activeHash !== version.hash || !version.verification) fail('실행 중 코드가 중지되거나 활성 버전이 바뀌었습니다.', 409);
  event(result, 'run', id, hash, options, clone(run)); validateCodeWorkshop(result);
  return { registry: result, result: { id, hash, ...clone(run) } };
}
export function getCodeStatus(registry) {
  validateCodeWorkshop(registry);
  return registry.entries.map(entry => {
    const version = versionOf(entry, entry.activeHash ?? undefined), manifest = version.manifest;
    const runs = registry.history.filter(item => item.action === 'run' && item.id === entry.id);
    return { id: entry.id, name: manifest.name, description: manifest.description, activeHash: entry.activeHash, previousHash: entry.previousHash,
      status: entry.activeHash ? 'active' : 'inactive', source: { kind: manifest.source.kind, url: manifest.source.url, commit: manifest.source.commit, license: manifest.source.license },
      entry: manifest.entry, files: manifest.files.map(file => ({ path: file.path, bytes: Buffer.byteLength(file.content) })), sampleInput: clone(manifest.fixtures[0].input),
      runCount: runs.length, lastRunAt: runs[0]?.at ?? null, versions: entry.versions.map(item => ({ hash: item.hash, version: item.manifest.version,
        verified: !!item.verification, fixtureCount: item.manifest.fixtures.length, importedAt: item.importedAt, verifiedAt: item.verifiedAt })) };
  });
}

async function fetchText(url, fetchImpl, signal, limit) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['api.github.com', 'raw.githubusercontent.com'].includes(parsed.hostname) || parsed.port || parsed.username || parsed.password) fail('허용하지 않은 코드 출처입니다.');
  const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BLACKHOLE-code-intake' } });
  if (!response.ok || response.status < 200 || response.status >= 300 || response.redirected || (response.url && response.url !== url)) fail(`GitHub 원문을 읽지 못했습니다 (${response.status}).`, 502, 'CODE_SOURCE_UNAVAILABLE');
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) { await response.body?.cancel().catch(() => {}); fail('선택한 코드 원문이 너무 큽니다.', 413); }
  const reader = response.body?.getReader();
  if (!reader) fail('GitHub 원문 응답이 비어 있습니다.', 502);
  const chunks = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); fail('선택한 코드 원문이 너무 큽니다.', 413); } chunks.push(value); }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch (error) { await reader.cancel().catch(() => {}); if (error instanceof CodeWorkshopError || signal?.aborted) throw error; fail('GitHub 원문은 UTF-8 텍스트여야 합니다.', 502); }
  finally { reader.releaseLock(); }
}
function publicLicense(licenseText) {
  if (/Permission is hereby granted, free of charge/i.test(licenseText) && /THE SOFTWARE IS PROVIDED [“"']?AS IS/i.test(licenseText)) return 'MIT';
  if (/Apache License/i.test(licenseText) && /Version 2\.0/i.test(licenseText)) return 'Apache-2.0';
  if (/Redistribution and use in source and binary forms/i.test(licenseText) && /THIS SOFTWARE IS PROVIDED/i.test(licenseText)) return /Neither the name/i.test(licenseText) ? 'BSD-3-Clause' : 'BSD-style';
  if (/ISC License/i.test(licenseText) || /Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee/i.test(licenseText)) return 'ISC';
  if (/This is free and unencumbered software released into the public domain/i.test(licenseText)) return 'Unlicense';
  fail('이용 조건을 자동 분류하지 못했습니다. 원본 라이선스를 검토한 뒤 직접 코드 묶음으로 가져오세요.', 422, 'CODE_LICENSE_REVIEW_REQUIRED');
}
export async function fetchGithubCode(request, options = {}) {
  if (!isObject(request) || Object.keys(request).some(key => !['url', 'paths', 'licensePath', 'entry', 'id', 'version', 'name', 'description', 'fixtures'].includes(key))) fail('GitHub 코드 가져오기 입력을 확인하세요.');
  bounded(request);
  const repo = githubRepo(request.url);
  const licensePath = request.licensePath ?? 'LICENSE';
  if (!Array.isArray(request.paths) || !request.paths.length || request.paths.length > 16 || request.paths.some(path => !validPath(path, true)) || new Set(request.paths).size !== request.paths.length
      || !validPath(licensePath) || !request.paths.includes(request.entry)) fail('선택할 JavaScript 경로·실행 파일·라이선스 경로를 확인하세요.');
  // Validate all owner-supplied metadata BEFORE making external requests.
  const placeholder = { schemaVersion: 1, id: request.id, version: request.version, name: request.name, description: request.description,
    source: { kind: 'github', url: repo.url, commit: '0'.repeat(40), license: 'pending', licenseText: 'pending' },
    files: request.paths.map(path => ({ path, content: '/* pending fetch */' })), entry: request.entry, fixtures: request.fixtures };
  validateCodeManifest(placeholder);
  const deadline = AbortSignal.timeout(30000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const api = `https://api.github.com/repos/${repo.owner}/${repo.repository}`;
  let info, head;
  try { info = JSON.parse(await fetchText(api, fetchImpl, signal, 65536)); } catch (error) { if (error instanceof SyntaxError) fail('GitHub 저장소 정보를 읽지 못했습니다.', 502); throw error; }
  if (!isObject(info) || info.private !== false || typeof info.default_branch !== 'string' || !info.default_branch || info.default_branch.length > 200
      || /[\u0000-\u0020\u007f\\~^:?*\[\]]/.test(info.default_branch) || info.default_branch.includes('..') || info.default_branch.includes('@{')
      || info.default_branch.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock'))) fail('공개 GitHub 저장소의 기본 브랜치를 확인하지 못했습니다.', 422);
  const branch = info.default_branch.split('/').map(encodeURIComponent).join('/');
  try { head = JSON.parse(await fetchText(`${api}/git/ref/heads/${branch}`, fetchImpl, signal, 16384)); } catch (error) { if (error instanceof SyntaxError) fail('GitHub 커밋을 확인하지 못했습니다.', 502); throw error; }
  const commit = head?.object?.sha;
  if (!COMMIT.test(commit) || head?.object?.type !== 'commit') fail('고정할 GitHub 커밋을 확인하지 못했습니다.', 502);
  const raw = `https://raw.githubusercontent.com/${repo.owner}/${repo.repository}/${commit}/`;
  const readPath = path => fetchText(raw + path.split('/').map(encodeURIComponent).join('/'), fetchImpl, signal, 65536);
  const licenseText = await readPath(licensePath);
  if (!text(licenseText, 32000)) fail('원본 라이선스가 없거나 너무 큽니다.', 422);
  const license = publicLicense(licenseText);
  const files = []; let total = Buffer.byteLength(licenseText);
  for (const path of request.paths) {
    const content = await readPath(path); total += Buffer.byteLength(content);
    if (total > 65536) fail('선택한 코드와 이용 조건의 합이 64KB를 넘습니다.', 413);
    files.push({ path, content });
  }
  const manifest = { ...placeholder, source: { kind: 'github', url: repo.url, commit, license, licenseText }, files };
  validateCodeManifest(manifest);
  return manifest;
}
