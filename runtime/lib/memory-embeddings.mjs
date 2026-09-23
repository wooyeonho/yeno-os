import {randomUUID} from 'node:crypto';

// BLACKHOLE local memory embeddings (P2 §2-4): a small, pure, provider-shaped
// store for text + vector pairs, plus real local-embedding retrieval over
// loopback only. This is deliberately separate from memory-events.mjs (an
// append-only fingerprinted autobiography ledger by design) and from the
// legacy `memories` array (no update/delete anywhere in the codebase): a
// record here CAN be edited and deleted, because a real "fix a remembered
// fact" / "forget this" workflow needs both, and semantic (embedding)
// recall - not the existing token-overlap recallMemories() - is what lets a
// paraphrased question still find it.
//
// Nothing here grants execution authority or interprets recalled text as
// instructions - identical posture to memory-recall.mjs's recallPromptBlock.
export const MEMORY_EMBEDDING_VERSION = 1;
export const MAX_TEXT = 4000;
export const MAX_RECORDS = 5000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const RECORD_FIELDS = Object.freeze(['id', 'version', 'text', 'embedding', 'model', 'createdAt', 'updatedAt', 'deletedAt']);

export class MemoryEmbeddingError extends Error {
  constructor(message, code = 'MEMORY_EMBEDDING_INVALID') { super(message); this.code = code; }
}
const fail = (message, code) => { throw new MemoryEmbeddingError(message, code); };

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const validText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TEXT;
const validVector = value => Array.isArray(value) && value.length >= 8 && value.length <= 8192 && value.every(n => typeof n === 'number' && Number.isFinite(n));

// Same fail-closed loopback contract as provider-config-engine.mjs's
// localEndpoint(): an embedding server is always local inference, never a
// way to add an arbitrary HTTPS destination.
export function localEmbedEndpoint(env) {
  const raw = env.YENO_LOCAL_EMBED_BASE_URL;
  const base = raw === undefined || raw === '' ? 'http://127.0.0.1:11434/api/embeddings' : raw;
  let url;
  try { url = new URL(base); } catch { return null; }
  if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash) return null;
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null;
  return url.href;
}

// Real network call - the only impure function in this module. Callers in
// tests inject fetchImpl; the live verification script uses the real fetch.
export async function embedText(env, text, {fetchImpl = fetch} = {}) {
  if (!validText(text)) fail('embedText에는 1~4000자 텍스트가 필요합니다.');
  const endpoint = localEmbedEndpoint(env);
  if (endpoint === null) fail('embedding endpoint가 loopback이 아니거나 잘못되었습니다.', 'INVALID_EMBED_ENDPOINT');
  const model = env.YENO_LOCAL_EMBED_MODEL;
  if (typeof model !== 'string' || !model.trim()) fail('YENO_LOCAL_EMBED_MODEL이 필요합니다.', 'MISSING_EMBED_MODEL');
  const response = await fetchImpl(endpoint, {
    method: 'POST', redirect: 'error', headers: {'content-type': 'application/json'},
    body: JSON.stringify({model, prompt: text}),
  });
  if (!response.ok) fail(`embedding 서버가 ${response.status}를 반환했습니다.`, 'EMBED_HTTP_ERROR');
  const payload = await response.json();
  const embedding = payload.embedding ?? payload.embeddings?.[0];
  if (!validVector(embedding)) fail('embedding 서버 응답에 유효한 벡터가 없습니다.', 'INVALID_EMBED_RESPONSE');
  return {embedding, model};
}

export function cosineSimilarity(a, b) {
  if (!validVector(a) || !validVector(b) || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]; }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function validateMemoryEmbeddingRecord(record) {
  if (!object(record) || Object.keys(record).length !== RECORD_FIELDS.length || RECORD_FIELDS.some(f => !Object.hasOwn(record, f))) fail(`memory embedding record는 정확히 ${RECORD_FIELDS.join(', ')} 필드를 가져야 합니다.`);
  if (typeof record.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(record.id)) fail('id는 UUID여야 합니다.');
  if (record.version !== MEMORY_EMBEDDING_VERSION) fail('version이 올바르지 않습니다.');
  if (!validText(record.text)) fail('text는 1~4000자여야 합니다.');
  if (!validVector(record.embedding)) fail('embedding은 8~8192 길이의 유한 숫자 배열이어야 합니다.');
  if (typeof record.model !== 'string' || !record.model.trim()) fail('model이 필요합니다.');
  if (!iso(record.createdAt)) fail('createdAt은 ISO 시각이어야 합니다.');
  if (!iso(record.updatedAt)) fail('updatedAt은 ISO 시각이어야 합니다.');
  if (record.deletedAt !== null && !iso(record.deletedAt)) fail('deletedAt은 null이거나 ISO 시각이어야 합니다.');
  return true;
}

export function createMemoryEmbeddingRecord({text, embedding, model}, {at}) {
  const record = {id: randomUUID(), version: MEMORY_EMBEDDING_VERSION, text, embedding, model, createdAt: at, updatedAt: at, deletedAt: null};
  validateMemoryEmbeddingRecord(record);
  return record;
}

// Same id, new text/embedding/updatedAt - the previous text is not kept
// (this store is "current fact", not a revision history).
export function updateMemoryEmbeddingRecord(record, {text, embedding, model}, {at}) {
  validateMemoryEmbeddingRecord(record);
  if (record.deletedAt !== null) fail('삭제된 기억은 수정할 수 없습니다.', 'MEMORY_EMBEDDING_DELETED');
  const next = {...record, text, embedding, model, updatedAt: at};
  validateMemoryEmbeddingRecord(next);
  return next;
}

// Soft delete: the record stays (auditable), but every search path below
// filters deletedAt records out, so a deleted memory is never recalled again.
export function deleteMemoryEmbeddingRecord(record, {at}) {
  validateMemoryEmbeddingRecord(record);
  if (record.deletedAt !== null) return record;
  const next = {...record, deletedAt: at};
  validateMemoryEmbeddingRecord(next);
  return next;
}

export function addMemoryEmbeddingRecord(list, record) {
  if (list.length >= MAX_RECORDS) fail('memory embedding 보관 한도에 도달했습니다.', 'MEMORY_EMBEDDING_CAPACITY');
  validateMemoryEmbeddingRecord(record);
  if (list.some(r => r.id === record.id)) fail('id가 중복됩니다.');
  return [...list, record];
}

export function replaceMemoryEmbeddingRecord(list, next) {
  validateMemoryEmbeddingRecord(next);
  const index = list.findIndex(r => r.id === next.id);
  if (index === -1) fail('해당 id의 기억을 찾을 수 없습니다.', 'MEMORY_EMBEDDING_NOT_FOUND');
  return [...list.slice(0, index), next, ...list.slice(index + 1)];
}

// Returns [{id, text, score, model, createdAt, updatedAt}], best first.
// Deleted records are excluded unconditionally - not a filter the caller can
// disable - so "삭제한 기억은 검색에서 제외" is a property of this function,
// not of callers remembering to filter.
export function searchMemoryEmbeddings(list, queryEmbedding, {limit = 5, minScore = 0} = {}) {
  if (!validVector(queryEmbedding)) fail('query embedding이 유효하지 않습니다.');
  return list.filter(r => r.deletedAt === null)
    .map(r => ({id: r.id, text: r.text, score: cosineSimilarity(r.embedding, queryEmbedding), model: r.model, createdAt: r.createdAt, updatedAt: r.updatedAt}))
    .filter(r => r.score > minScore)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, limit));
}
