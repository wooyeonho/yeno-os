import crypto from 'node:crypto';
import {WebSessionError} from './web-session.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const PROOF = /^[A-Za-z0-9_-]{43}$/;
const LIFETIME_MS = 10 * 60 * 1000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const hash = value => crypto.createHash('sha256').update(value).digest();

// The visible reference is deliberately not a credential. Only the browser's
// independent random HttpOnly proof can collect an owner-approved session.
// Pending requests expire on restart; durable device enrollment is handled by
// the existing request ledger and never reconstructed from a public reference.
export function createWebPairings({now = Date.now, capacity = 128} = {}) {
  const pending = new Map(), attempts = new Map();
  function cookieContext(req) {
    const hostname = new URL(`http://${req.headers.host}`).hostname.toLowerCase();
    const secure = Boolean(req.socket.encrypted) || !LOOPBACK.has(hostname);
    return {secure, name: secure ? '__Host-yeno-pair-v1' : 'yeno-pair-dev-v1'};
  }
  function supplied(req) {
    const {name} = cookieContext(req), header = req.headers.cookie;
    if (header === undefined) return null;
    if (typeof header !== 'string' || header.length > 8192) throw new WebSessionError(401, '이 브라우저에서 새 연결 요청을 시작해 주세요.', {code: 'WEB_PAIRING_REQUIRED'});
    const values = header.split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
    if (values.length > 1) throw new WebSessionError(401, '연결 정보가 중복되어 있습니다. 브라우저를 다시 열어 주세요.', {code: 'WEB_PAIRING_REQUIRED'});
    return values.length ? values[0].slice(name.length + 1) : null;
  }
  function read(req) {
    const value = supplied(req), parts = value?.split('.');
    if (!parts || parts.length !== 2 || !UUID.test(parts[0]) || !PROOF.test(parts[1])) throw new WebSessionError(401, '이 브라우저에서 연결 요청을 시작해 주세요.', {code: 'WEB_PAIRING_REQUIRED'});
    const entry = pending.get(parts[0]);
    if (!entry || !crypto.timingSafeEqual(hash(parts[1]), entry.proofHash)) throw new WebSessionError(401, '이 브라우저의 연결 요청을 다시 시작해 주세요.', {code: 'WEB_PAIRING_REQUIRED'});
    if (entry.expiresAt <= now()) throw new WebSessionError(410, '연결 요청의 10분 유효기간이 끝났습니다. 새 요청을 시작해 주세요.', {code: 'WEB_PAIRING_EXPIRED'});
    return entry;
  }
  function cookie(req, value, expiresAt) {
    const {name, secure} = cookieContext(req);
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}; Max-Age=${Math.max(1, Math.floor((expiresAt - now()) / 1000))}; Expires=${new Date(expiresAt).toUTCString()}`;
  }
  function begin(req, remember) {
    let existing;
    try { existing = read(req); }
    catch (error) { if (!(error instanceof WebSessionError) || !['WEB_PAIRING_REQUIRED', 'WEB_PAIRING_EXPIRED'].includes(error.extra.code)) throw error; }
    if (existing) return {entry: existing, cookie: cookie(req, supplied(req), existing.expiresAt), created: false};
    const time = now();
    for (const [id, entry] of pending) if (entry.expiresAt <= time) pending.delete(id);
    for (const [address, entry] of attempts) if (entry.until <= time) attempts.delete(address);
    const address = String(req.socket.remoteAddress ?? 'unknown');
    let attempt = attempts.get(address);
    if (!attempt) {
      if (attempts.size >= 128) throw new WebSessionError(429, '잠시 후 연결 요청을 다시 시작해 주세요.', {code: 'WEB_PAIRING_RATE_LIMITED', retryAfterSeconds: 300});
      attempt = {count: 0, until: time + 300000}; attempts.set(address, attempt);
    }
    if (++attempt.count > 10 || pending.size >= capacity) throw new WebSessionError(429, '연결 요청이 많습니다. 잠시 후 다시 시작해 주세요.', {code: 'WEB_PAIRING_RATE_LIMITED', retryAfterSeconds: Math.max(1, Math.ceil((attempt.until - time) / 1000))});
    const id = crypto.randomUUID(), proof = crypto.randomBytes(32).toString('base64url');
    const entry = {id, proofHash: hash(proof), remember, name: 'BLACKHOLE 승인된 브라우저', expiresAt: time + LIFETIME_MS, deviceId: null};
    pending.set(id, entry);
    return {entry, cookie: cookie(req, `${id}.${proof}`, entry.expiresAt), created: true};
  }
  function get(id) {
    if (typeof id !== 'string' || !UUID.test(id)) throw new WebSessionError(400, '화면에 표시된 연결 요청 번호가 필요합니다.');
    const entry = pending.get(id);
    if (!entry || entry.expiresAt <= now()) throw new WebSessionError(410, '이 연결 요청이 만료되었거나 서버가 재시작되었습니다. 새 요청을 시작해 주세요.', {code: 'WEB_PAIRING_EXPIRED'});
    return entry;
  }
  function metadata(entry) {
    return {id: entry.id, status: entry.deviceId ? 'approved' : 'pending', expiresAt: new Date(entry.expiresAt).toISOString(), remember: entry.remember};
  }
  function clear(req) { return cookie(req, '', now()).replace(/Max-Age=\d+/, 'Max-Age=0'); }
  return {begin, read, get, metadata, clear};
}
