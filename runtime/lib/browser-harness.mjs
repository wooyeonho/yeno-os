// BLACKHOLE sandbox Browser Harness — public HTTPS, read-only, injected transport.
//
// This is an execution boundary, not a Chrome driver. It never starts a
// browser, executes JavaScript, runs a shell, uses a profile, accepts a
// credential, uploads a file, or claims a live provider. A future Chrome
// adapter must be injected and must return the bounded transport shape below.

import dns from 'node:dns/promises';
import net from 'node:net';
import crypto from 'node:crypto';
import {
  BROWSER_DECISION_VERSION,
  BROWSER_OPERATIONS,
  indexedDomDecisionInput,
  parseBrowserDecisionDraft,
  validateIndexedDomSnapshot,
  planBrowserAction,
} from './browser-decision.mjs';

export const BROWSER_HARNESS_VERSION = 1;
export const BROWSER_HARNESS_STATUS = 'sandbox-contract';
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_LINKS = 100;
export const MAX_ACTIONS = 8;
export const MAX_ACTION_EVIDENCE = 32;
export const SECRET_PATTERN = /(?:password|passwd|passcode|secret|token|api[ _-]?key|private[ _-]?key|authorization|bearer|cookie|session|recovery|seed phrase|비밀번호|암호|토큰|인증|쿠키|세션)/i;
export const BLOCKED_HOSTNAMES = Object.freeze(new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal', 'metadata']));
export const ALLOWED_SANDBOX_OPERATIONS = Object.freeze(['CLICK', 'TYPE_TEXT', 'SELECT', 'SCROLL_UP', 'SCROLL_DOWN', 'WAIT', 'DONE', 'BLOCKED']);

export class BrowserHarnessError extends Error {
  constructor(code, evidence = '') { super(evidence ? code + ': ' + evidence : code); this.code = code; }
}
const fail = (code, evidence) => { throw new BrowserHarnessError(code, evidence); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const integer = value => Number.isInteger(value) && value >= 0;
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const byteLength = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value ?? null));
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const clip = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const secretQuery = /^(?:api[_-]?key|access[_-]?token|auth(?:orization)?|bearer|cookie|password|passwd|secret|session|token|private[_-]?key)$/i;

function ipv4Number(value) {
  const parts = value.split('.').map(Number);
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    ? (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0 : null;
}
function ipv6ToBytes(value) {
  const clean = value.split('%')[0].toLowerCase();
  if (!clean.includes(':')) return null;
  const halves = clean.split('::');
  if (halves.length > 2) return null;
  const expand = parts => {
    const out = [];
    for (const part of parts) {
      if (part.includes('.')) {
        const n = ipv4Number(part); if (n === null) return null;
        out.push((n >>> 16).toString(16), (n & 0xffff).toString(16));
      } else if (/^[0-9a-f]{1,4}$/i.test(part)) out.push(part);
      else return null;
    }
    return out;
  };
  const left = expand(halves[0] ? halves[0].split(':') : []);
  const right = expand(halves.length === 2 && halves[1] ? halves[1].split(':') : []);
  if (!left || !right || (halves.length === 1 ? left.length !== 8 : left.length + right.length >= 8)) return null;
  const parts = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  if (parts.length !== 8) return null;
  const out = Buffer.alloc(16); parts.forEach((part, i) => out.writeUInt16BE(parseInt(part, 16), i * 2)); return out;
}
function isPrivateIp(value) {
  const family = net.isIP(value);
  if (family === 4) {
    const n = ipv4Number(value);
    return n === null || n === 0 || (n >= 0x0a000000 && n <= 0x0affffff) ||
      (n >= 0x64400000 && n <= 0x647fffff) || (n >= 0x7f000000 && n <= 0x7fffffff) ||
      (n >= 0xa9fe0000 && n <= 0xa9feffff) || (n >= 0xac100000 && n <= 0xac1fffff) ||
      (n >= 0xc0000000 && n <= 0xc00000ff) || (n >= 0xc0a80000 && n <= 0xc0a8ffff) || n >= 0xe0000000;
  }
  if (family !== 6) return true;
  const b = ipv6ToBytes(value); if (!b) return true;
  const first = b.readUInt16BE(0), second = b.readUInt16BE(2);
  const zero = b.every(x => x === 0);
  const mapped = b.subarray(0, 10).every(x => x === 0) && b[10] === 0xff && b[11] === 0xff
    ? [b[12], b[13], b[14], b[15]].join('.') : null;
  return zero || (zero && b[15] === 1) || (first & 0xffc0) === 0xfe80 ||
    (first & 0xfe00) === 0xfc00 || (first & 0xff00) === 0xff00 ||
    (first === 0x2001 && second === 0x0db8) || (mapped ? isPrivateIp(mapped) : false);
}
function hostnameBlocked(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (net.isIP(host)) return isPrivateIp(host);
  return !host || host.includes('..') || host.length > 253 || !/^[a-z0-9.-]+$/i.test(host);
}
function assertSafeQuery(url) {
  for (const key of url.searchParams.keys()) if (secretQuery.test(key)) fail('secret_query_blocked', key);
}
export function validatePublicHttpsUrl(value) {
  if (!nonEmpty(value, 2000)) fail('invalid_source_url');
  let url; try { url = new URL(value); } catch { fail('invalid_source_url'); }
  if (url.protocol !== 'https:') fail('https_required');
  if (url.username || url.password) fail('url_credentials_blocked');
  if (url.port && url.port !== '443') fail('non_default_port_blocked');
  if (hostnameBlocked(url.hostname)) fail('private_or_invalid_host', url.hostname);
  assertSafeQuery(url); url.hash = ''; return url.href;
}
export function validateResolvedAddresses(addresses) {
  if (!Array.isArray(addresses) || !addresses.length) fail('dns_resolution_empty');
  for (const address of addresses) {
    const value = typeof address === 'string' ? address : address?.address;
    if (typeof value !== 'string' || isPrivateIp(value)) fail('dns_rebinding_or_private_address', String(value ?? 'unknown'));
  }
  return addresses.map(address => typeof address === 'string' ? address : address.address);
}
export async function resolvePublicHttpsUrl(value, {resolveHost = host => dns.lookup(host, {all: true, verbatim: true})} = {}) {
  const url = validatePublicHttpsUrl(value);
  let addresses; try { addresses = await resolveHost(new URL(url).hostname); } catch { fail('dns_resolution_failed'); }
  validateResolvedAddresses(addresses); return {url, addresses: addresses.map(address => typeof address === 'string' ? address : address.address)};
}
export function redactSecrets(value) {
  if (typeof value === 'string') return value
    .replace(/(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '[redacted-auth]')
    .replace(/(?:password|passwd|passcode|secret|token|api[_ -]?key|authorization|cookie|session)\s*[:=]\s*[^\s,;]+/gi, '[redacted-secret]');
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_PATTERN.test(key) ? '[redacted]' : redactSecrets(item)]));
  return value;
}
function normalizeLink(link) {
  if (!object(link)) fail('invalid_link');
  const href = validatePublicHttpsUrl(link.href ?? link.url);
  return {text: clip(redactSecrets(link.text ?? link.title), 500), href, rel: clip(link.rel, 80) || null};
}
function normalizeElement(element, index) {
  if (!object(element)) fail('invalid_dom_element', String(index));
  if (Object.keys(element).some(key => !['index','role','text','ariaLabel','name','label','inputType','enabled','visible','href','sensitive'].includes(key))) fail('unknown_dom_element_field', String(index));
  const role = clip(element.role, 60).toLowerCase(); if (!role) fail('invalid_dom_role', String(index));
  const sensitive = element.sensitive === true || SECRET_PATTERN.test([role, element.name, element.label, element.ariaLabel, element.inputType].filter(Boolean).join(' '));
  const href = element.href == null ? null : validatePublicHttpsUrl(element.href);
  return {index: element.index ?? index, role, text: sensitive ? '[redacted]' : clip(redactSecrets(element.text), 600), ariaLabel: sensitive ? '[redacted]' : clip(redactSecrets(element.ariaLabel), 600), name: sensitive ? '[redacted]' : clip(redactSecrets(element.name), 120), label: sensitive ? '[redacted]' : clip(redactSecrets(element.label), 600), inputType: clip(element.inputType, 40).toLowerCase() || null, enabled: element.enabled !== false, visible: element.visible !== false, href, sensitive};
}
export function normalizeBrowserSnapshot(raw, {resolvedAddresses = null} = {}) {
  if (!object(raw)) fail('invalid_snapshot');
  const url = validatePublicHttpsUrl(raw.url); if (resolvedAddresses) validateResolvedAddresses(resolvedAddresses);
  const title = clip(redactSecrets(raw.title), 600); if (!title.trim()) fail('invalid_snapshot_title');
  if (byteLength(raw.body) > MAX_BODY_BYTES) fail('dom_body_limit');
  const body = clip(redactSecrets(raw.body), MAX_BODY_BYTES);
  const links = (raw.links ?? []).map(normalizeLink); if (links.length > MAX_LINKS) fail('link_limit');
  const elements = (raw.elements ?? []).map(normalizeElement); if (elements.length > 200) fail('dom_element_limit');
  const revision = raw.revision ?? 1; if (!integer(revision) || revision > 1000000000) fail('invalid_snapshot_revision');
  const observedAt = raw.observedAt ?? new Date().toISOString(); if (!iso(observedAt)) fail('invalid_snapshot_time');
  const snapshot = {url, title, revision, observedAt, elements};
  const validated = validateIndexedDomSnapshot(snapshot);
  return {...validated, body, links};
}
export function browserDecisionInput(snapshot, goal) {
  const normalized = normalizeBrowserSnapshot(snapshot); return indexedDomDecisionInput({snapshot: normalized, goal});
}
function safeActionPlan(snapshot, draft, independentOutcome) {
  const action = parseBrowserDecisionDraft(draft);
  const target = action.targetIndex === null ? null : snapshot.elements.find(item => item.index === action.targetIndex);
  if (action.operation === 'TYPE_TEXT' && (!target || target.sensitive || SECRET_PATTERN.test([target.role,target.name,target.label,target.ariaLabel,target.inputType].filter(Boolean).join(' ')))) fail('sensitive_target_blocked');
  const plan = planBrowserAction({snapshot, draft: action, independentOutcome});
  if (action.operation === 'CLICK' && !target?.href) fail('click_target_must_be_public_link');
  if (action.operation === 'DONE' && (!independentOutcome || independentOutcome.status !== 'verified')) fail('done_requires_independent_evidence');
  if (action.operation === 'BLOCKED') return {version: BROWSER_HARNESS_VERSION, action, sandboxDispatchAllowed: false, reason: action.reason};
  return {version: BROWSER_HARNESS_VERSION, action, sandboxDispatchAllowed: ['CLICK','TYPE_TEXT','SELECT','SCROLL_UP','SCROLL_DOWN','WAIT'].includes(action.operation), externalSideEffect: false, credentialInput: false, policyPlan: plan};
}
export function buildBrowserArtifact({snapshot, goal, actionEvidence = []}) {
  if (!object(snapshot) || !nonEmpty(goal, 1200)) fail('invalid_browser_artifact_input');
  if (!Array.isArray(actionEvidence) || actionEvidence.length > MAX_ACTION_EVIDENCE) fail('action_evidence_limit');
  const safe = normalizeBrowserSnapshot(snapshot);
  const content = ['# Public page snapshot','- URL: ' + safe.url,'- Title: ' + safe.title,'- Revision: ' + safe.revision,'- Observed at: ' + safe.observedAt,'','## Body',safe.body || '(본문 없음)','','## Links',...(safe.links.length ? safe.links.map(link => '- [' + (link.text || link.href) + '](' + link.href + ')') : ['- (링크 없음)']),'','## Action evidence',...actionEvidence.map(item => '- ' + redactSecrets(JSON.stringify(item)))].join('\n');
  return {content, sha256: hash(content), sourceHash: hash({url:safe.url,title:safe.title,revision:safe.revision,body:safe.body,links:safe.links}), title:safe.title, url:safe.url, revision:safe.revision};
}
export function deterministicBrowserVerification({snapshot, artifact, actionEvidence = [], providerOutcome = 'settled'}) {
  const reasons = [];
  if (providerOutcome !== 'settled') reasons.push('provider_outcome_not_settled');
  if (!object(snapshot) || !object(artifact)) reasons.push('artifact_or_snapshot_missing');
  if (object(artifact)) {
    if (!nonEmpty(artifact.content, MAX_BODY_BYTES * 2)) reasons.push('artifact_content_missing');
    else if (hash(artifact.content) !== artifact.sha256) reasons.push('artifact_hash_mismatch');
    try { const checked = normalizeBrowserSnapshot(snapshot); if (artifact.url !== checked.url || artifact.revision !== checked.revision) reasons.push('artifact_snapshot_mismatch'); }
    catch { reasons.push('snapshot_invalid'); }
  }
  if (!Array.isArray(actionEvidence) || actionEvidence.length < 1) reasons.push('action_evidence_missing');
  return {version: BROWSER_HARNESS_VERSION, status: reasons.length ? 'rejected' : 'verified', verified: reasons.length === 0, reasons, checkedAt: new Date().toISOString()};
}
export function validateBrowserJob(job) {
  if (!object(job) || job.type !== 'browser') fail('invalid_browser_job');
  const request = job.browserRequest;
  if (!object(request) || !nonEmpty(request.goal, 1200) || !nonEmpty(request.sourceUrl, 2000)) fail('invalid_browser_request');
  validatePublicHttpsUrl(request.sourceUrl);
  if (request.successCriterion !== undefined && !nonEmpty(request.successCriterion, 2000)) fail('invalid_browser_success_criterion');
  if (!['queued','running','paused','completed','failed','cancelled'].includes(job.status)) fail('invalid_browser_job_status');
  if (job.browser?.snapshotRevision !== undefined && (!Number.isInteger(job.browser.snapshotRevision) || job.browser.snapshotRevision < 0)) fail('invalid_browser_snapshot_revision');
  if (job.browser?.artifactHash !== undefined && !/^[a-f0-9]{64}$/i.test(job.browser.artifactHash)) fail('invalid_browser_artifact_hash');
  return true;
}
export function browserHarnessStatus({adapterConfigured = false, provider = null} = {}) {
  return {version: BROWSER_HARNESS_VERSION, status: adapterConfigured ? 'sandbox-ready' : BROWSER_HARNESS_STATUS, liveProvider: provider?.status === 'configured', liveBrowserHarness: adapterConfigured, externalActions: false, credentialInput: false, allowedOperations: [...ALLOWED_SANDBOX_OPERATIONS], limitations: adapterConfigured ? ['public HTTPS only','read-only action allowlist','no credentials, JS, shell, upload or side effects'] : ['sandbox transport not configured','TypeSafe Jev endpoint/credential not configured']};
}
export function typesafeJevProviderStatus(env = process.env) {
  const fields = ['YENO_JEV_BASE_URL','YENO_JEV_API_KEY','YENO_JEV_MODEL'];
  const missing = fields.filter(key => typeof env[key] !== 'string' || !env[key].trim());
  return {provider:'typesafe-jev', status:missing.length ? 'unavailable' : 'configured', missing:missing.map(key => key.replace(/^YENO_JEV_/, '').toLowerCase()), reason:missing.length ? 'official endpoint or credential not configured' : null};
}
export async function runSandboxBrowserHarness({goal, sourceUrl, resolveHost, fetchPublicPage, decisionProvider, executeAction, signal, maxActions = MAX_ACTIONS} = {}) {
  if (typeof fetchPublicPage !== 'function') fail('browser_harness_unavailable');
  if (typeof decisionProvider !== 'function') fail('jev_provider_unavailable');
  const resolved = await resolvePublicHttpsUrl(sourceUrl, {resolveHost});
  if (signal?.aborted) fail('cancelled');
  let raw = await fetchPublicPage({url: resolved.url, signal}); if (!object(raw)) fail('invalid_transport_snapshot');
  let snapshot = normalizeBrowserSnapshot({...raw, url: resolved.url}, {resolvedAddresses: resolved.addresses});
  const evidence = []; let action = null;
  for (let count = 0; count < Math.min(maxActions, MAX_ACTIONS); count += 1) {
    const input = browserDecisionInput(snapshot, goal); const draft = await decisionProvider(input);
    const plan = safeActionPlan(snapshot, draft, null); action = plan.action;
    evidence.push({operation: action.operation, targetIndex: action.targetIndex, snapshotRevision: snapshot.revision, at: new Date().toISOString()});
    if (plan.sandboxDispatchAllowed && typeof executeAction === 'function') {
      const result = await executeAction({action: plan.action, snapshot, signal});
      if (result?.snapshot) { const next = normalizeBrowserSnapshot({...result.snapshot, url: result.snapshot.url ?? snapshot.url}); if (next.revision <= snapshot.revision) fail('stale_snapshot'); snapshot = next; }
    }
    if (action.operation === 'DONE' || action.operation === 'BLOCKED' || !plan.sandboxDispatchAllowed) break;
  }
  const artifact = buildBrowserArtifact({snapshot, goal, actionEvidence:evidence});
  const deterministic = deterministicBrowserVerification({snapshot, artifact, actionEvidence:evidence, providerOutcome:'settled'});
  return {snapshot, action, actionEvidence:evidence, artifact, deterministic, input:browserDecisionInput(snapshot, goal), provider:'typesafe-jev', mode:'sandbox-injected'};
}
