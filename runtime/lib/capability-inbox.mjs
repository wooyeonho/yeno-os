import crypto from 'node:crypto';
import {importCapability, verifyCapability, activateCapability} from './capabilities.mjs';

export class CapabilityInboxError extends Error {
  constructor(status, message, code = 'CAPABILITY_INBOX_INVALID') {
    super(message); this.status = status; this.code = code; this.extra = {code};
  }
}
const fail = (message, status = 400, code = 'CAPABILITY_INBOX_INVALID') => { throw new CapabilityInboxError(status, message, code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9-]{1,63}$/;
const UUID = /^[a-f0-9-]{36}$/;
const EVIDENCE = new Set(['SANDBOX_SYNTHETIC', 'LIVE']);
const STATUSES = new Set(['pending', 'promoted', 'rejected']);
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : object(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : JSON.stringify(value);
const hash = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const exact = (value, keys) => object(value) && Object.keys(value).sort().join() === keys.slice().sort().join();
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

export const INBOX_VERSION = 1;
const ENTRY_KEYS = ['id','kind','jobId','commandId','sourceUrl','goal','artifactRef','artifactHash','deterministicStatus','semanticVerdict','semanticIndependence','evidenceClass','sourceReadingStatus','sourceDecision','status','ownerApproved','createdAt','updatedAt','promotedAt','registryCapabilityId'];

export function initialCapabilityInbox() { return {version: INBOX_VERSION, entries: []}; }

function validateEntry(entry) {
  if (!exact(entry, ENTRY_KEYS) || !ID.test(entry.id) || entry.kind !== 'browser-readonly' || !UUID.test(entry.jobId)
    || !(entry.commandId === null || text(entry.commandId, 100)) || !text(entry.sourceUrl, 2000)
    || !text(entry.goal, 1200) || !text(entry.artifactRef, 200) || !HASH.test(entry.artifactHash)
    || entry.deterministicStatus !== 'verified' || entry.semanticVerdict !== 'pass'
    || !['independent-model','independent-context'].includes(entry.semanticIndependence)
    || !EVIDENCE.has(entry.evidenceClass) || entry.sourceReadingStatus !== 'partial' || entry.sourceDecision !== 'pending'
    || !STATUSES.has(entry.status) || typeof entry.ownerApproved !== 'boolean' || !iso(entry.createdAt) || !iso(entry.updatedAt)
    || !(entry.promotedAt === null || iso(entry.promotedAt))
    || !(entry.registryCapabilityId === null || ID.test(entry.registryCapabilityId))) fail('기능 흡수 대기 항목이 올바르지 않습니다.');
  let url;
  try { url = new URL(entry.sourceUrl); } catch { fail('기능 흡수 출처 주소가 올바르지 않습니다.'); }
  if (url.protocol !== 'https:' || url.username || url.password) fail('기능 흡수 출처는 인증정보 없는 HTTPS여야 합니다.');
  return true;
}

export function validateCapabilityInbox(inbox) {
  if (!exact(inbox, ['version','entries']) || inbox.version !== INBOX_VERSION || !Array.isArray(inbox.entries) || inbox.entries.length > 50) fail('기능 흡수 대기함을 검증하지 못했습니다.');
  const ids = new Set(), jobs = new Set();
  for (const entry of inbox.entries) {
    validateEntry(entry);
    if (ids.has(entry.id) || jobs.has(entry.jobId)) fail('같은 Browser 결과를 두 번 흡수할 수 없습니다.');
    ids.add(entry.id); jobs.add(entry.jobId);
    if (entry.status === 'promoted' && (!entry.ownerApproved || !entry.promotedAt || !entry.registryCapabilityId)) fail('승격된 기능의 승인·시각·registry 연결이 필요합니다.');
    if (entry.status !== 'promoted' && (entry.promotedAt !== null || entry.registryCapabilityId !== null)) fail('승격되지 않은 기능에 registry 연결이 있을 수 없습니다.');
  }
  return true;
}

function copy(inbox) { validateCapabilityInbox(inbox); return structuredClone(inbox); }
function entryFor(inbox, id) {
  if (!ID.test(id)) fail('기능 흡수 항목 ID가 올바르지 않습니다.');
  const entry = inbox.entries.find(item => item.id === id);
  if (!entry) fail('기능 흡수 항목을 찾을 수 없습니다.', 404, 'CAPABILITY_INBOX_NOT_FOUND');
  return entry;
}

export function admitBrowserCapability(inbox, job, options = {}) {
  const next = copy(inbox);
  if (!object(job) || job.type !== 'browser' || job.status !== 'completed' || !object(job.browser)) fail('완료된 Browser 작업만 흡수 대기함에 넣을 수 있습니다.', 409, 'BROWSER_NOT_ELIGIBLE');
  const browser = job.browser, deterministic = browser.deterministicVerification, semantic = browser.semanticVerification;
  const deterministicPass = deterministic?.status === 'verified' || deterministic?.verified === true;
  if (!deterministicPass || semantic?.verdict !== 'pass' || !['independent-model','independent-context'].includes(semantic?.independence)) fail('결정론·내용 검증을 모두 통과한 Browser 결과만 흡수할 수 있습니다.', 409, 'BROWSER_NOT_VERIFIED');
  if (browser.sourceIntake?.readingStatus !== 'partial' || browser.sourceIntake?.decision !== 'pending') fail('자료 접수 초안은 partial·pending 상태여야 합니다.', 409, 'SOURCE_REVIEW_STATE_INVALID');
  if (!text(browser.artifactRef, 200) || !HASH.test(browser.artifactHash)) fail('Browser 결과 artifact 근거가 없습니다.', 409, 'BROWSER_ARTIFACT_MISSING');
  const existing = next.entries.find(item => item.jobId === job.id);
  if (existing) return {inbox: next, result: {id: existing.id, jobId: job.id, alreadyAdmitted: true, status: existing.status}};
  const at = options.at ?? new Date().toISOString();
  const id = `browser-${job.id.slice(0, 12)}`;
  const entry = {
    id, kind: 'browser-readonly', jobId: job.id, commandId: browser.commandId ?? null,
    sourceUrl: job.browserRequest.sourceUrl, goal: job.browserRequest.goal, artifactRef: browser.artifactRef,
    artifactHash: browser.artifactHash, deterministicStatus: 'verified', semanticVerdict: 'pass',
    semanticIndependence: semantic.independence, evidenceClass: EVIDENCE.has(browser.evidenceClass) ? browser.evidenceClass : 'SANDBOX_SYNTHETIC',
    sourceReadingStatus: 'partial', sourceDecision: 'pending', status: 'pending', ownerApproved: false,
    createdAt: at, updatedAt: at, promotedAt: null, registryCapabilityId: null,
  };
  next.entries.unshift(entry);
  validateCapabilityInbox(next);
  return {inbox: next, result: {id, jobId: job.id, alreadyAdmitted: false, status: 'pending', promotionBlockedReason: entry.evidenceClass === 'LIVE' ? null : 'live_evidence_required'}};
}

export function listCapabilityInbox(inbox) {
  validateCapabilityInbox(inbox);
  return structuredClone(inbox.entries);
}

export function promoteBrowserCapability(inbox, registry, id, manifest, options = {}) {
  const next = copy(inbox), entry = entryFor(next, id);
  if (entry.status !== 'pending') fail('이미 처리된 기능 흡수 항목입니다.', 409, 'CAPABILITY_INBOX_ALREADY_PROCESSED');
  if (options.ownerApproved !== true) fail('소유자 승인이 필요합니다.', 403, 'OWNER_APPROVAL_REQUIRED');
  if (entry.evidenceClass !== 'LIVE') fail('실제 Browser/Jev acceptance 전에는 capability registry로 승격할 수 없습니다.', 409, 'LIVE_EVIDENCE_REQUIRED');
  if (!object(manifest) || manifest.source?.url !== entry.sourceUrl) fail('승격 manifest의 원본 주소가 Browser 자료와 일치하지 않습니다.', 409, 'SOURCE_PROVENANCE_MISMATCH');
  const imported = importCapability(registry, manifest, options);
  const verified = verifyCapability(imported.registry, manifest.id, imported.result.hash, options);
  const activated = activateCapability(verified.registry, manifest.id, imported.result.hash, options);
  const at = options.at ?? new Date().toISOString();
  entry.status = 'promoted'; entry.ownerApproved = true; entry.updatedAt = at; entry.promotedAt = at; entry.registryCapabilityId = manifest.id;
  validateCapabilityInbox(next);
  return {inbox: next, registry: activated.registry, result: {id: entry.id, jobId: entry.jobId, capabilityId: manifest.id, hash: activated.result.hash, status: 'promoted'}};
}
