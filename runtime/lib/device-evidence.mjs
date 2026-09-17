// TRACK C - durable owner-attested device acceptance evidence.
// DEVICE_VERIFIED is never inferred from an enrolled device, a build, or a
// passing test: it needs an owner-recorded acceptance whose release binding
// (backend sourceCommit + client versionCode/versionName + APK SHA-256) equals
// the release the runtime is serving *now*. Any drift makes the record STALE.
// Pure: no store, no server, no network.
import crypto from 'node:crypto';
import {assertNoSecrets} from './readiness.mjs';

export const DEVICE_EVIDENCE_VERSION = 1;
export const PLATFORMS = Object.freeze(['android', 'web']);
export const ACCEPTANCE_CHECKS = Object.freeze([
  'install_or_update', 'launch', 'https_core_pairing', 'vault_unlock', 'readiness_view', 'natural_language_command',
  'job_created', 'result_opened', 'force_close', 'relaunch', 'reconnect', 'same_job_result_after_relaunch', 'network_loss_recovery',
  'duplicate_request_no_duplicate_job', 'emergency_stop', 'resume', 'device_revoke_blocks_access', 'server_restart_reconnect', 'memory_jobs_results_preserved'
]);
export const RELEASE_KEYS = Object.freeze(['sourceCommit', 'clientVersionName', 'clientVersionCode', 'apkSha256']);
export const RECORD_KEYS = Object.freeze(['version', 'id', 'deviceId', 'platform', 'release', 'checks', 'observedBy', 'observedAt', 'complete', 'fingerprint', 'recordedAt']);
export const MAX_RECORDS = 50;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SHA1 = /^[a-f0-9]{40}$/, SHA256 = /^[a-f0-9]{64}$/, VERSION_NAME = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]{1,40})?$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export class DeviceEvidenceError extends Error { constructor(message, status = 400) { super(message); this.name = 'DeviceEvidenceError'; this.status = status; } }
const fail = (message, status) => { throw new DeviceEvidenceError(message, status); };
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : object(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');

// The release the owner tested. apkSha256 is null only for web (no APK).
export function validateRelease(release, platform = 'android') {
  if (!exact(release, RELEASE_KEYS)) fail('release must be exactly {sourceCommit, clientVersionName, clientVersionCode, apkSha256}');
  if (!SHA1.test(release.sourceCommit)) fail('release.sourceCommit must be a full 40-hex commit');
  if (!VERSION_NAME.test(release.clientVersionName)) fail('release.clientVersionName must be semver-like');
  if (!Number.isInteger(release.clientVersionCode) || release.clientVersionCode < 1) fail('release.clientVersionCode must be a positive integer');
  if (platform === 'android' ? !SHA256.test(release.apkSha256) : release.apkSha256 !== null) fail(platform === 'android' ? 'android release needs apkSha256' : 'web release has no APK');
  return true;
}

function fingerprintOf(record) {
  const {fingerprint, recordedAt, ...claim} = record;
  return sha256(`${DEVICE_EVIDENCE_VERSION}:${canonical(claim)}`);
}

// Owner action only. `checks` must name every acceptance check with an
// explicit boolean; `complete` is derived, never supplied.
export function createDeviceAcceptance({id, deviceId, platform, release, checks, observedBy, observedAt, recordedAt = observedAt}) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(id)) fail('acceptance id must be a stable 8-64 char identifier');
  if (typeof deviceId !== 'string' || !deviceId.trim()) fail('deviceId is required');
  if (!PLATFORMS.includes(platform)) fail('unknown platform');
  validateRelease(release, platform);
  if (!exact(checks, ACCEPTANCE_CHECKS) || ACCEPTANCE_CHECKS.some(check => typeof checks[check] !== 'boolean')) fail('checks must cover every acceptance check with true/false');
  if (observedBy !== 'owner') fail('only the owner attests device acceptance');
  if (!ISO.test(observedAt) || !ISO.test(recordedAt) || recordedAt < observedAt) fail('observedAt/recordedAt must be ISO timestamps, recordedAt not before observedAt');
  const record = {version: DEVICE_EVIDENCE_VERSION, id, deviceId, platform, release: {...release}, checks: {...checks}, observedBy, observedAt,
    complete: ACCEPTANCE_CHECKS.every(check => checks[check] === true), fingerprint: null, recordedAt};
  record.fingerprint = fingerprintOf(record);
  assertNoSecrets(record);
  return record;
}

export function validateDeviceAcceptance(record) {
  if (!exact(record, RECORD_KEYS)) fail('acceptance record has unexpected shape');
  if (record.version !== DEVICE_EVIDENCE_VERSION) fail('unsupported acceptance record version');
  const rebuilt = createDeviceAcceptance(record);
  if (rebuilt.fingerprint !== record.fingerprint || rebuilt.complete !== record.complete) fail('acceptance record tampered', 409);
  return true;
}

export function validateDeviceAcceptances(records) {
  if (!Array.isArray(records) || records.length > MAX_RECORDS) fail('acceptance records must be a bounded array');
  const ids = new Set();
  for (const record of records) { validateDeviceAcceptance(record); if (ids.has(record.id)) fail('duplicate acceptance record'); ids.add(record.id); }
  return true;
}

// Append-only: same id must be byte-identical (idempotent), never rewritten.
export function recordDeviceAcceptance(records, record) {
  validateDeviceAcceptances(records); validateDeviceAcceptance(record);
  const existing = records.find(item => item.id === record.id);
  if (existing) { if (existing.fingerprint !== record.fingerprint) fail('acceptance record id already used for a different observation', 409); return {records, added: false}; }
  if (records.length >= MAX_RECORDS) fail('acceptance record limit reached', 409);
  return {records: [...records, record], added: true};
}

// current: {sourceCommit, client:{versionName, versionCode, apkSha256}} as
// served now; devices: state.devices map (revoked devices do not count).
export function deviceVerification(records, {platform = 'android', current, devices = {}, at}) {
  validateDeviceAcceptances(records);
  const known = !!(current && SHA1.test(current.sourceCommit ?? '') && current.client && Number.isInteger(current.client.versionCode) && (platform !== 'android' || SHA256.test(current.client.apkSha256 ?? '')));
  const staleReasons = record => {
    const reasons = [];
    if (!record.complete) reasons.push('checks_incomplete');
    if (!known) reasons.push('current_release_evidence_missing');
    else {
      if (record.release.sourceCommit !== current.sourceCommit) reasons.push('source_commit_changed');
      if (record.release.clientVersionCode !== current.client.versionCode || record.release.clientVersionName !== current.client.versionName) reasons.push('client_version_changed');
      if (platform === 'android' && record.release.apkSha256 !== current.client.apkSha256) reasons.push('apk_sha_changed');
    }
    const device = devices[record.deviceId];
    if (!device) reasons.push('device_not_enrolled'); else if (device.revokedAt) reasons.push('device_revoked');
    if (at && record.observedAt > at) reasons.push('observed_in_future');
    return reasons;
  };
  const scoped = records.filter(record => record.platform === platform);
  const judged = scoped.map(record => ({id: record.id, deviceId: record.deviceId, observedAt: record.observedAt, sourceCommit: record.release.sourceCommit, stale: staleReasons(record)}));
  const matched = judged.filter(item => !item.stale.length);
  const state = matched.length ? 'DEVICE_VERIFIED' : !known ? 'BLOCKED' : scoped.length ? 'WIRED_UNVERIFIED' : Object.values(devices).some(device => !device.revokedAt && new RegExp(platform, 'i').test(device.platform ?? '')) ? 'WIRED_UNVERIFIED' : 'NOT_WIRED';
  const result = {version: DEVICE_EVIDENCE_VERSION, platform, state, currentReleaseKnown: known, ownerRecords: scoped.length, matched: matched.map(item => item.id),
    stale: judged.filter(item => item.stale.length), blockers: state === 'DEVICE_VERIFIED' ? [] : [!known ? 'current_release_evidence_missing' : 'owner_device_acceptance_missing_for_current_release'], physicalDeviceActionBy: 'owner'};
  assertNoSecrets(result);
  return result;
}
