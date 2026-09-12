import { HttpFailure } from './command-session.ts';

export type Connection = { origin: string; deviceId: string; token: string };
export type VerifiedFile = { bytes: Uint8Array<ArrayBuffer>; name: string; mime: string; sha256: string };
export type NativeRequest = <T>(url: string, init: RequestInit, decode: (response: Response) => Promise<T>) => Promise<T>;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export function normalizeOrigin(raw: string) {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol) || !['', '/'].includes(url.pathname)) throw new Error('경로 없이 HTTPS 코어 주소를 입력하세요.');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('원격 코어는 HTTPS가 필요합니다.');
  return url.origin;
}

// Never let an injected URL, traversal, fragment or redirect receive the device token.
export function versionedUrl(origin: string, path: string) {
  if (normalizeOrigin(origin) !== origin || !/^\/api\/[a-z0-9/-]+(?:\?[^#\\\s]*)?$/.test(path) || path.includes('..') || path.includes('//')) throw new Error('지원하지 않는 본체 주소입니다.');
  const url = new URL('/api/v1/' + path.slice(5), origin);
  if (url.origin !== origin || !url.pathname.startsWith('/api/v1/')) throw new Error('본체 주소 범위를 벗어났습니다.');
  return url.href;
}

export function studioStorageKey(value: Pick<Connection, 'origin' | 'deviceId'>) {
  if (!value.deviceId || normalizeOrigin(value.origin) !== value.origin) throw new Error('기기 연결을 확인해 주세요.');
  return `blackhole.studio.v1:${encodeURIComponent(value.origin)}:${encodeURIComponent(value.deviceId)}`;
}

// The request helper calls flush before transmission and before acknowledging a receipt.
// Only the Stronghold adapter persists these values; no manuscript/contact is copied to localStorage.
export class SecureRequestStorage {
  private value: string | null;
  private key: string;
  private write: (value: string | null) => Promise<void>;
  constructor(key: string, value: string | null, write: (value: string | null) => Promise<void>) { this.key = key; this.value = value; this.write = write; }
  private check(key: string) { if (key !== this.key) throw new Error('다른 기기의 접수 기록에 접근할 수 없습니다.'); }
  getItem(key: string) { this.check(key); return this.value; }
  setItem(key: string, value: string) { this.check(key); this.value = value; }
  removeItem(key: string) { this.check(key); this.value = null; }
  async flush() { await this.write(this.value); }
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function safeFilename(value: string, fallback = 'blackhole-result.txt') {
  const name = value.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '_').replace(/^\.+/, '').trim().slice(0, 180);
  return name || fallback;
}
export async function readVerifiedFile(response: Response, fallback = 'blackhole-result.txt'): Promise<VerifiedFile> {
  if (!response.ok) throw new HttpFailure(response.status, `결과 다운로드 실패 · HTTP ${response.status}`);
  const expected = response.headers.get('x-content-sha256');
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('결과 파일의 검증 정보를 확인하지 못했습니다.');
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_FILE_BYTES)) throw new Error('파일이 앱의 8 MiB 다운로드 한도를 넘었습니다.');
  const chunks: Uint8Array[] = []; let total = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new Error('파일 본문을 읽을 수 없습니다.');
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > MAX_FILE_BYTES) { await reader.cancel(); throw new Error('파일이 앱의 8 MiB 다운로드 한도를 넘었습니다.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (length !== null && Number(length) !== total) throw new Error('파일 다운로드가 중간에 끊겼습니다. 다시 열어 주세요.');
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (await sha256(bytes) !== expected) throw new Error('결과 파일의 SHA-256이 일치하지 않아 열기를 멈췄습니다.');
  const mime = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (mime === 'video/mp4' && (bytes.length < 12 || new TextDecoder().decode(bytes.slice(4,8)) !== 'ftyp')) throw new Error('MP4 파일 형식이 올바르지 않습니다.');
  const name = safeFilename(response.headers.get('content-disposition')?.match(/filename="([^"/\\]+)"/)?.[1] || fallback);
  return {bytes, name, mime, sha256: expected};
}

const reads = new Set(['/api/studio', '/api/capabilities', '/api/studio/export', '/api/world']);
const writes = new Set(['/api/studio', '/api/studio/generate', '/api/studio/import', '/api/production/run', '/api/hankki/invite', '/api/hankki/revoke']);
export function createStudioApi({connection, request, isCurrent}: { connection: Connection; request: NativeRequest; isCurrent: () => boolean }) {
  return async (path: string, body?: Record<string, unknown>, options?: {raw?: boolean}) => {
    if (!isCurrent()) throw new Error('기기 연결이 변경됐습니다. 다시 열어 주세요.');
    const route = path.split('?')[0];
    if (!(body ? writes : reads).has(route) || (body && path.includes('?'))) throw new Error('지원하지 않는 운영실 요청입니다.');
    if (body && (typeof body.requestId !== 'string' || !body.requestId)) throw new Error('접수 요청 ID가 필요합니다.');
    if (options?.raw && (body || route !== '/api/studio/export')) throw new Error('지원하지 않는 파일 요청입니다.');
    const result = await request(versionedUrl(connection.origin, path), {
      method: body ? 'POST' : 'GET', headers: {authorization: `Bearer ${connection.token}`, ...(body ? {'content-type':'application/json'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {}),
    }, async response => {
      if (!options?.raw) return response.json();
      const file = await readVerifiedFile(response);
      return new Response(file.bytes, {headers: response.headers});
    });
    if (!isCurrent()) throw new Error('기기 연결이 변경돼 이전 응답 표시를 멈췄습니다.');
    return result;
  };
}

export async function saveVerifiedFile(file: VerifiedFile, io: {
  choose: (name: string) => Promise<string | null>;
  write: (path: string, bytes: Uint8Array<ArrayBuffer>) => Promise<void>;
  read: (path: string) => Promise<Uint8Array<ArrayBuffer>>;
}) {
  if (file.bytes.byteLength > MAX_FILE_BYTES || await sha256(file.bytes) !== file.sha256) throw new Error('저장할 파일 검증에 실패했습니다.');
  const path = await io.choose(safeFilename(file.name));
  if (path === null) return false;
  await io.write(path, file.bytes);
  const saved = await io.read(path);
  if (saved.byteLength !== file.bytes.byteLength || await sha256(saved) !== file.sha256) throw new Error('저장된 파일을 다시 확인하지 못했습니다. 저장 위치를 확인해 주세요.');
  return true;
}
