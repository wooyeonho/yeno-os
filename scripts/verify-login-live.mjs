// Run only as an authorized, bounded diagnostic in the existing core container:
// YENO_VERIFY_LOGIN_ID=<nonsecret-deployment-or-incident-id> node scripts/verify-login-live.mjs
// The existing YENO_TOKEN and temporary cookie remain in memory. This script
// writes only one synthetic browser registration and its revocation receipts.
// A repeated ID never counts an earlier completed check as a fresh login test.
import {fileURLToPath} from 'node:url';

const ORIGIN = 'https://global-iris-gyeol-98386a17.koyeb.app';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const COLLECTIONS = ['jobs', 'projects', 'sources', 'memories', 'snapshots'];
class VerificationError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}
const requireCheck = (ok, code) => { if (!ok) throw new VerificationError(code); };

export async function verifyLogin({env = process.env, fetchImpl = fetch, write = console.log} = {}) {
  const report = {at: new Date().toISOString(), origin: ORIGIN, currentLoginVerified: false,
    status: 'failed', stage: 'configuration', checks: [], cleanup: 'not_needed', modelCallsSubmitted: 0};
  let ownerHeaders, loginBody, loginId, logoutId, cleanupId, cookie = '', deviceId = '', beforeDevices;
  let loginAttempted = false, logoutConfirmed = false;

  async function http(route, {body, owner = false, anonymous = false} = {}) {
    let response, bytes;
    try {
      response = await fetchImpl(ORIGIN + route, {method: body === undefined ? 'GET' : 'POST',
        headers: {...(owner ? ownerHeaders : anonymous ? {} : {Cookie: cookie, 'X-Yeno-Browser': '1'}),
          ...(body === undefined ? {} : {'X-Yeno-Browser': '1', Origin: ORIGIN, 'Content-Type': 'application/json'})},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}), redirect: 'error',
        signal: AbortSignal.timeout(15000)});
      bytes = Buffer.from(await response.arrayBuffer());
    } catch { throw new VerificationError('transport_outcome_unknown'); }
    requireCheck(bytes.length <= 16 * 1024 * 1024, 'response_exceeds_diagnostic_limit');
    let value;
    try { value = JSON.parse(bytes.toString('utf8')); }
    catch { throw new VerificationError('response_outcome_unknown', response.status); }
    return {response, status: response.status, value};
  }
  function expect(result, status) {
    if (result.status !== status) throw new VerificationError('unexpected_http_status', result.status);
    return result;
  }
  const devices = async () => {
    const value = expect(await http('/api/devices', {owner: true}), 200).value.devices;
    requireCheck(Array.isArray(value), 'invalid_device_list'); return value;
  };
  const receipt = async id => {
    const result = await http(`/api/requests/${encodeURIComponent(id)}`, {owner: true});
    if (result.status === 404) return null;
    expect(result, 200);
    requireCheck(result.value.request?.requestId === id, 'receipt_identity_mismatch');
    return result.value.request;
  };
  async function boundSyntheticDevice() {
    const existing = await receipt(loginId);
    if (!existing) return null;
    requireCheck(existing.status === 201 && existing.reference?.collection === 'devices'
      && existing.reference.payloadKey === 'device' && UUID.test(existing.reference.id), 'synthetic_receipt_invalid');
    const target = (await devices()).find(item => item.id === existing.reference.id);
    requireCheck(target?.platform === 'web' && target.name === loginBody.name, 'synthetic_device_identity_mismatch');
    requireCheck(!deviceId || deviceId === target.id, 'synthetic_device_changed');
    deviceId = target.id; return target;
  }
  async function boundedPost(route, body, owner = false) {
    // An ambiguous first response may have committed. Retry the exact body and
    // identity once; never create another registration to get past uncertainty.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await http(route, {body, owner});
        if (result.status >= 500 && attempt === 0) continue;
        return result;
      } catch (error) {
        if (attempt === 0 && ['transport_outcome_unknown', 'response_outcome_unknown'].includes(error.code)) continue;
        throw error;
      }
    }
  }
  async function cleanup() {
    if (!loginAttempted || logoutConfirmed) return;
    // Even if the login reply/cookie was lost, the durable request reference
    // identifies exactly the synthetic browser. Never revoke by name alone.
    report.cleanup = 'unconfirmed';
    try {
      const target = await boundSyntheticDevice();
      if (!target) { report.cleanup = 'no_registration_observed'; return; }
      if (!target.revokedAt) {
        const result = expect(await boundedPost(`/api/devices/${deviceId}/revoke`, {requestId: cleanupId}, true), 200);
        requireCheck(result.value.deviceId === deviceId, 'cleanup_identity_mismatch');
      }
      const after = await devices();
      requireCheck(after.find(item => item.id === deviceId)?.revokedAt, 'cleanup_revocation_unconfirmed');
      requireCheck((beforeDevices ?? []).filter(item => !item.revokedAt && item.id !== deviceId)
        .every(item => after.some(next => next.id === item.id && !next.revokedAt)), 'prior_device_changed');
      report.cleanup = 'synthetic_device_revoked';
    } catch { report.cleanup = 'unconfirmed'; }
  }

  try {
    const id = env.YENO_VERIFY_LOGIN_ID;
    requireCheck(typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id), 'nonsecret_verification_id_required');
    report.verificationId = id;
    requireCheck(typeof env.YENO_TOKEN === 'string' && env.YENO_TOKEN.length >= 16
      && env.YENO_TOKEN.length <= 4096 && /^[\x20-\x7e]+$/.test(env.YENO_TOKEN)
      && env.YENO_TOKEN.trim() === env.YENO_TOKEN, 'existing_browser_compatible_owner_key_required');
    ownerHeaders = {Authorization: `Bearer ${env.YENO_TOKEN}`};
    const prefix = `blackhole-login-diagnostic-v1:${id}`;
    loginId = `${prefix}:login`; logoutId = `${prefix}:logout`; cleanupId = `${prefix}:cleanup`;
    loginBody = {requestId: loginId, name: `BH login ${id}`, remember: true};

    report.stage = 'owner_authentication';
    const before = expect(await http('/api/state', {owner: true}), 200).value;
    for (const key of COLLECTIONS) requireCheck(Array.isArray(before[key]), 'invalid_state_collection');
    beforeDevices = await devices();
    report.checks.push('current_container_key_accepted_by_public_https');
    report.stage = 'prior_diagnostic_receipts';
    const priorLogout = await receipt(logoutId), priorCleanup = await receipt(cleanupId);
    if (priorLogout || priorCleanup) {
      report.status = 'previously_finished'; report.code = 'prior_receipt_is_not_a_fresh_login_verification';
    } else {
      const prior = await boundSyntheticDevice();
      requireCheck(!prior?.revokedAt, 'prior_synthetic_device_already_revoked');
      report.stage = 'web_login'; loginAttempted = true;
      const login = expect(await boundedPost('/api/web/session', loginBody, true), 201);
      const target = await boundSyntheticDevice();
      requireCheck(target && login.value.authenticated === true && login.value.device?.id === target.id, 'login_identity_mismatch');
      requireCheck(!JSON.stringify(login.value).includes(env.YENO_TOKEN) && !('deviceToken' in login.value.device), 'credential_in_login_response');
      const cookies = login.response.headers.getSetCookie();
      requireCheck(cookies.length === 1 && cookies[0].startsWith('__Host-yeno-web-v1='), 'secure_cookie_prefix');
      requireCheck(/; HttpOnly(?:;|$)/.test(cookies[0]) && /; Secure(?:;|$)/.test(cookies[0])
        && /; SameSite=Strict(?:;|$)/.test(cookies[0]) && /; Path=\/(?:;|$)/.test(cookies[0])
        && /; Max-Age=[1-9][0-9]*(?:;|$)/.test(cookies[0]) && !/; Domain=/i.test(cookies[0]), 'secure_cookie_attributes');
      cookie = cookies[0].split(';')[0];
      report.checks.push('new_https_login_and_secure_host_only_cookie');
      report.stage = 'cookie_reopen';
      const reopened = expect(await http('/api/web/session'), 200).value;
      requireCheck(reopened.authenticated === true && reopened.device?.id === deviceId, 'reopened_session_identity_mismatch');
      const state = expect(await http('/api/state'), 200).value;
      requireCheck(COLLECTIONS.every(key => Array.isArray(state[key])
        && before[key].every(old => state[key].some(next => next.id === old.id))), 'prior_records_missing');
      expect(await http('/api/devices'), 403);
      expect(await http('/api/v1/state'), 401);
      report.checks.push('independent_cookie_reopen_and_existing_records_readable', 'cookie_cannot_administer_devices_or_use_native_api');
      report.stage = 'logout';
      const out = expect(await boundedPost('/api/web/logout', {requestId: logoutId, deviceId}), 200).value;
      requireCheck(out.loggedOut === true && out.revoked === true && out.deviceId === deviceId, 'logout_unconfirmed');
      expect(await http('/api/web/session'), 401);
      const afterDevices = await devices();
      requireCheck(afterDevices.find(item => item.id === deviceId)?.revokedAt, 'logout_revocation_unconfirmed');
      requireCheck(beforeDevices.filter(item => !item.revokedAt && item.id !== deviceId)
        .every(item => afterDevices.some(next => next.id === item.id && !next.revokedAt)), 'prior_device_changed');
      logoutConfirmed = true; cookie = '';
      report.cleanup = 'synthetic_device_revoked';
      report.preservedActiveDevices = beforeDevices.filter(item => !item.revokedAt && item.id !== deviceId).length;
      report.checks.push('logout_revoked_synthetic_cookie_and_preserved_prior_devices');
      report.currentLoginVerified = true; report.status = 'verified'; report.stage = 'complete';
    }
  } catch (error) {
    report.code = error instanceof VerificationError ? error.code : 'diagnostic_internal_error';
    if (error instanceof VerificationError && Number.isInteger(error.status)) report.httpStatus = error.status;
    await cleanup();
  }
  // Only report fields constructed here are emitted. Never emit response bodies,
  // raw exceptions, credential hashes, cookies, or key-derived identifiers.
  write(`LOGIN_DIAGNOSTIC ${JSON.stringify(report)}`);
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyLogin().then(report => { if (!report.currentLoginVerified) process.exitCode = 1; })
    .catch(() => { console.error('LOGIN_DIAGNOSTIC_OUTPUT_FAILED'); process.exitCode = 1; });
}
