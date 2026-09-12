import crypto from 'node:crypto';

export class WebSessionError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHORT_MS = 8 * 60 * 60 * 1000;
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

// This module never stores raw device/owner credentials. The existing device
// registry remains the authority for revocation and encrypted backup recovery.
export function createWebSessions({key, now = Date.now}) {
  const mac = (domain, value = '') => crypto.createHmac('sha256', key).update(`YENO/${domain}/v1\0${value}`).digest('base64url');
  const attempts = new Map();
  const storageScope = mac('web-storage');

  function context(req) {
    const host = req.headers.host;
    let target;
    try { target = new URL(`http://${host}`); }
    catch { throw new WebSessionError(403, '브라우저 접속 주소를 확인해 주세요.'); }
    const local = LOOPBACK.has(target.hostname.toLowerCase());
    // Public hosts are always HTTPS, including trusted TLS-terminating proxies.
    // Untrusted X-Forwarded-* headers never relax the cookie/origin boundary.
    const secure = Boolean(req.socket.encrypted) || !local;
    const origin = new URL(`${secure ? 'https' : 'http'}://${host}`).origin;
    return {origin, secure, name: secure ? '__Host-yeno-web-v1' : 'yeno-web-dev-v1'};
  }

  function guard(req, {mutation = false} = {}) {
    const {origin} = context(req);
    if (req.headers['x-yeno-browser'] !== '1') throw new WebSessionError(403, '브라우저 요청 확인 정보가 필요합니다. 새로고침해 주세요.');
    if ((mutation || req.headers.origin !== undefined) && req.headers.origin !== origin) throw new WebSessionError(403, '현재 블랙홀 주소에서 요청해 주세요.');
    if (mutation && !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) throw new WebSessionError(415, 'JSON 브라우저 요청이 필요합니다.');
  }

  function cookieValue(req) {
    const {name} = context(req), header = req.headers.cookie;
    if (header === undefined) return null;
    if (typeof header !== 'string' || header.length > 8192) throw new WebSessionError(401, '브라우저 연결을 다시 확인해 주세요.');
    const values = header.split(';').map(item => item.trim()).filter(item => item.startsWith(`${name}=`));
    if (values.length > 1) throw new WebSessionError(401, '브라우저 연결 정보가 중복되어 있습니다.');
    return values.length ? values[0].slice(name.length + 1) : null;
  }

  function read(req, {allowExpired = false} = {}) {
    const value = cookieValue(req);
    if (!value) return null;
    const parts = value.split('.');
    if (value.length > 512 || parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) throw new WebSessionError(401, '브라우저 연결 정보가 올바르지 않습니다.');
    const expected = mac('web-cookie', parts[0]);
    if (!crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expected))) throw new WebSessionError(401, '브라우저 연결 정보가 올바르지 않습니다.');
    let valueObject;
    try { valueObject = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
    catch { throw new WebSessionError(401, '브라우저 연결 정보가 올바르지 않습니다.'); }
    if (!valueObject || Array.isArray(valueObject) || Object.keys(valueObject).length !== 2 || !UUID.test(valueObject.id) || !Number.isSafeInteger(valueObject.expiresAt) || valueObject.expiresAt <= 0) throw new WebSessionError(401, '브라우저 연결 정보가 올바르지 않습니다.');
    if (!allowExpired && valueObject.expiresAt <= now()) throw new WebSessionError(401, '브라우저 연결 기간이 끝났습니다. 개인 연결 키로 다시 연결해 주세요.');
    return valueObject;
  }

  function attributes(req) {
    const info = context(req);
    return `${info.name}=; Path=/; HttpOnly; SameSite=Strict${info.secure ? '; Secure' : ''}`;
  }

  function issue(req, device, remember) {
    const expiresAt = Date.parse(device.createdAt) + (remember ? REMEMBER_MS : SHORT_MS);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now()) throw new WebSessionError(409, '이전 브라우저 등록 기간이 끝났습니다. 새 연결 요청으로 다시 연결해 주세요.');
    const payload = Buffer.from(JSON.stringify({id: device.id, expiresAt})).toString('base64url');
    const value = `${payload}.${mac('web-cookie', payload)}`;
    const cookie = attributes(req).replace('=;', `=${value};`) + (remember ? `; Max-Age=${Math.max(1, Math.floor((expiresAt - now()) / 1000))}; Expires=${new Date(expiresAt).toUTCString()}` : '');
    return {cookie, expiresAt};
  }

  function clear(req) { return `${attributes(req)}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`; }

  function session(device, expiresAt) {
    return {authenticated: true, device: {id: device.id, name: device.name, platform: device.platform, createdAt: device.createdAt}, expiresAt: new Date(expiresAt).toISOString(), storageScope};
  }

  function loginLimit(req) {
    const time = now(), address = String(req.socket.remoteAddress ?? 'unknown');
    for (const [id, value] of attempts) if (value.until <= time) attempts.delete(id);
    let entry = attempts.get(address);
    if (!entry) {
      if (attempts.size >= 128) return {allowed: false, retryAfter: Math.ceil(LOGIN_WINDOW_MS / 1000)};
      entry = {count: 0, until: time + LOGIN_WINDOW_MS}; attempts.set(address, entry);
    }
    entry.count++;
    return {allowed: entry.count <= 10, retryAfter: Math.max(1, Math.ceil((entry.until - time) / 1000))};
  }

  return {guard, read, issue, clear, session, loginLimit};
}
