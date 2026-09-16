// TRACK D - HTTPS reachability and restart evidence, classified fail-closed.
// HTTPS: only a TLS socket on this process, or an X-Forwarded-Proto header
// that arrived from an owner-listed trusted reverse proxy address, counts as
// https. Headers from anywhere else are ignored (never trusted, and flagged).
// Restart: `durableStoreReload` (the store re-read the same facts) is kept
// apart from `processRestartVerified` (a new process boot happened between a
// self-test run and its matching reload). Pure: no store, server, or network.
import {assertNoSecrets} from './readiness.mjs';

export const HTTPS_EVIDENCE_VERSION = 1;
export const BOOT_KEYS = Object.freeze(['version', 'bootId', 'bootedAt', 'revisionAtBoot', 'pid']);
export const MAX_BOOTS = 50;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/, IPV6ISH = /^[0-9a-f:.]+$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export class HttpsEvidenceError extends Error { constructor(message, status = 400) { super(message); this.name = 'HttpsEvidenceError'; this.status = status; } }
const fail = (message, status) => { throw new HttpsEvidenceError(message, status); };

const normalizeAddress = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/^::ffff:/, '') : '';
export function parseTrustedProxies(raw) {
  return [...new Set((raw ?? '').split(',').map(normalizeAddress).filter(Boolean))].filter(address => IPV4.test(address) || IPV6ISH.test(address));
}
export const parseAllowedHosts = raw => [...new Set((raw ?? '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean))];

const single = header => typeof header === 'string' && !header.includes(',') ? header.trim().toLowerCase() : null;

// One request -> {scheme, via, publicHost, forwarded}. Never throws on odd
// input: unknown is classified as plain http from an unknown host.
export function classifyRequest({socketEncrypted = false, remoteAddress = '', host = '', headers = {}, trustedProxies = [], allowedHosts = []} = {}) {
  const forwardedProto = headers['x-forwarded-proto'], forwardedHost = headers['x-forwarded-host'];
  const headerPresent = forwardedProto !== undefined || forwardedHost !== undefined;
  const proxyTrusted = trustedProxies.includes(normalizeAddress(remoteAddress));
  // The public host is the one the trusted proxy forwarded; otherwise the socket's own Host.
  const trustedHost = proxyTrusted ? single(forwardedHost) : null;
  const hostName = (typeof trustedHost === 'string' ? trustedHost : typeof host === 'string' ? host : '').trim().toLowerCase();
  const publicHost = allowedHosts.includes(hostName) ? hostName : null;
  let scheme = 'http', via = 'plain';
  if (socketEncrypted === true) { scheme = 'https'; via = 'direct-tls'; }
  else if (headerPresent && proxyTrusted) {
    const proto = single(forwardedProto);
    if (proto === 'https') { scheme = 'https'; via = 'trusted-proxy'; }
    else via = proto === null ? 'trusted-proxy-ambiguous' : 'trusted-proxy';
  } else if (headerPresent) via = 'untrusted-forwarded-header';
  const result = {version: HTTPS_EVIDENCE_VERSION, scheme, via, publicHost, encrypted: scheme === 'https', forwarded: {present: headerPresent, trusted: headerPresent && proxyTrusted, ignored: headerPresent && !proxyTrusted}, trustedProxyCount: trustedProxies.length, allowedHostCount: allowedHosts.length};
  assertNoSecrets(result);
  return result;
}

// Readiness classification of the request being served right now.
export function httpsReadiness(classification) {
  const live = classification.encrypted && !!classification.publicHost;
  const state = live ? 'LIVE_VERIFIED' : classification.publicHost || classification.allowedHostCount ? 'WIRED_UNVERIFIED' : 'BLOCKED';
  const blockers = [];
  if (!live) blockers.push(classification.via === 'untrusted-forwarded-header' ? 'forwarded_header_from_untrusted_source_ignored' : classification.via === 'trusted-proxy-ambiguous' ? 'forwarded_proto_ambiguous' : 'https_staging_not_verified_from_this_request');
  return {state, thisRequest: classification.scheme, via: classification.via, publicHost: classification.publicHost, allowedPublicHosts: classification.allowedHostCount, trustedProxies: classification.trustedProxyCount, forwarded: classification.forwarded, blockers, localhostCountsAsStaging: false};
}

// Durable boot record, appended once per process start by the server.
export function createBootRecord({bootId, bootedAt, revisionAtBoot, pid}) {
  const record = {version: HTTPS_EVIDENCE_VERSION, bootId, bootedAt, revisionAtBoot, pid};
  validateBootRecord(record);
  return record;
}
export function validateBootRecord(record) {
  if (!exact(record, BOOT_KEYS) || record.version !== HTTPS_EVIDENCE_VERSION) fail('boot record has unexpected shape');
  if (!UUID.test(record.bootId)) fail('boot record bootId must be a UUID');
  if (!ISO.test(record.bootedAt)) fail('boot record bootedAt must be ISO');
  if (!Number.isInteger(record.revisionAtBoot) || record.revisionAtBoot < 0) fail('boot record revision must be a non-negative integer');
  if (!Number.isInteger(record.pid) || record.pid < 1) fail('boot record pid must be a positive integer');
  return true;
}
export function validateBootRecords(records) {
  if (!Array.isArray(records) || records.length > MAX_BOOTS) fail('boot records must be a bounded array');
  const ids = new Set();
  let last = '';
  for (const record of records) {
    validateBootRecord(record);
    if (ids.has(record.bootId)) fail('duplicate boot record'); ids.add(record.bootId);
    if (record.bootedAt < last) fail('boot records must be chronological'); last = record.bootedAt;
  }
  return true;
}
export function appendBoot(records, record) {
  validateBootRecords(records); validateBootRecord(record);
  if (records.some(item => item.bootId === record.bootId)) return {records, added: false};
  if (records.length && record.bootedAt < records[records.length - 1].bootedAt) fail('boot record older than the last boot', 409);
  const next = [...records, record];
  return {records: next.length > MAX_BOOTS ? next.slice(next.length - MAX_BOOTS) : next, added: true};
}

// A self-test proves a real process restart only when some boot happened
// strictly after it started and its durable reload matched strictly after
// that boot: the reload was read by a different process than the one that
// ran the goal. Same-process reloads stay durableStoreReload only.
export function restartEvidence({selfTests = [], boots = [], currentBootId = null, recovered = false}) {
  validateBootRecords(boots);
  const reloads = selfTests.filter(item => item.durableReload?.matched === true);
  const restartProofs = reloads.filter(item => typeof item.durableReload.at === 'string' && boots.some(boot => boot.bootedAt > item.startedAt && item.durableReload.at > boot.bootedAt))
    .map(item => ({selfTestId: item.id, startedAt: item.startedAt, reloadedAt: item.durableReload.at}));
  const durableStoreReload = {verified: reloads.length > 0, checks: reloads.length};
  const processRestartVerified = {verified: restartProofs.length > 0, proofs: restartProofs, boots: boots.length, currentBootKnown: boots.some(boot => boot.bootId === currentBootId)};
  const state = recovered ? 'BLOCKED' : processRestartVerified.verified ? 'LIVE_VERIFIED' : durableStoreReload.verified ? 'SYNTHETIC_VERIFIED' : 'WIRED_UNVERIFIED';
  const blockers = recovered ? ['store_recovered_from_backup'] : processRestartVerified.verified ? [] : [durableStoreReload.verified ? 'process_restart_not_observed_after_self_test' : 'durable_reload_not_checked'];
  const result = {version: HTTPS_EVIDENCE_VERSION, state, durableStoreReload, processRestartVerified, blockers};
  assertNoSecrets(result);
  return result;
}
