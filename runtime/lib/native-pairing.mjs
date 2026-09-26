import crypto from 'node:crypto';
import {WebSessionError} from './web-session.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { throw new WebSessionError(status, message); };

// Invitations live only in this process: restart cancels every outstanding QR.
// The existing durable ledger stores enrollment metadata, never these secrets.
export function createNativePairings({now = Date.now, lifetime = 300000, capacity = 32} = {}) {
  const entries = new Map();
  const key = crypto.randomBytes(32);
  const credential = entry => crypto.createHmac('sha256', key).update(entry.id).update(entry.nonce).digest('base64url');
  function issue(requestId, origin) {
    if (!UUID.test(requestId ?? '')) fail(400, 'A valid invitation requestId is required.');
    if (!/^https:\/\/[a-z0-9.-]+\.ts\.net:9443$/.test(origin)) fail(409, 'Private phone HTTPS is not configured.');
    const existing = entries.get(requestId);
    if (existing) {
      if (existing.cancelled || existing.expiresAt <= now() || existing.enrollmentId) fail(410, 'Start a new phone invitation.');
      return view(existing);
    }
    for (const [id, entry] of entries) if (entry.expiresAt <= now()) entries.delete(id);
    if (entries.size >= capacity) fail(429, 'Too many pending invitations.');
    const entry = {id:requestId, origin, expiresAt:now() + lifetime, cancelled:false, enrollmentId:null, nonce:crypto.randomBytes(16)};
    entry.tokenHash = hash(credential(entry));
    entries.set(requestId, entry);
    return view(entry);
  }
  function view(entry) { return {id:entry.id, origin:entry.origin, expiresAt:new Date(entry.expiresAt).toISOString(), token:credential(entry)}; }
  function cancel(id) {
    const entry = entries.get(id);
    if (!entry) fail(410, 'Invitation expired or core restarted.');
    entry.cancelled = true;
    return {cancelled:true};
  }
  function claim(token, requestId) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail(401, 'Invalid phone invitation.');
    const candidate = hash(token);
    const entry = [...entries.values()].find(value => crypto.timingSafeEqual(Buffer.from(value.tokenHash), Buffer.from(candidate)));
    if (!entry) fail(401, 'Invalid invitation or core restarted. Scan a new QR.');
    if (entry.cancelled || entry.expiresAt <= now()) fail(410, 'Invitation expired or cancelled. Scan a new QR.');
    if (!UUID.test(requestId ?? '')) fail(400, 'A valid enrollment requestId is required.');
    if (entry.enrollmentId && entry.enrollmentId !== requestId) fail(409, 'Invitation already used by another enrollment.');
    entry.enrollmentId = requestId;
    return entry.id;
  }
  return {issue, cancel, claim};
}
