import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryEmbeddingError, localEmbedEndpoint, embedText, cosineSimilarity,
  createMemoryEmbeddingRecord, updateMemoryEmbeddingRecord, deleteMemoryEmbeddingRecord,
  addMemoryEmbeddingRecord, replaceMemoryEmbeddingRecord, searchMemoryEmbeddings,
  validateMemoryEmbeddingRecord,
} from '../lib/memory-embeddings.mjs';

const AT = '2026-09-24T00:00:00.000Z';
const AT2 = '2026-09-24T01:00:00.000Z';
const AT3 = '2026-09-24T02:00:00.000Z';
// Small hand-built vectors standing in for real embeddings: 'unique' and its
// paraphrase point the same direction (high cosine similarity); 'other' does not.
const unique = [1, 0, 0, 0, 0, 0, 0, 0];
const paraphrase = [0.9, 0.1, 0, 0, 0, 0, 0, 0];
const other = [0, 1, 0, 0, 0, 0, 0, 0];

test('localEmbedEndpoint defaults to Ollama-shaped loopback and rejects anything non-loopback', () => {
  assert.equal(localEmbedEndpoint({}), 'http://127.0.0.1:11434/api/embeddings');
  assert.equal(localEmbedEndpoint({YENO_LOCAL_EMBED_BASE_URL: ''}), 'http://127.0.0.1:11434/api/embeddings');
  assert.equal(localEmbedEndpoint({YENO_LOCAL_EMBED_BASE_URL: 'http://localhost:11434/api/embeddings'}), 'http://localhost:11434/api/embeddings');
  for (const bad of ['https://api.openai.com/v1/embeddings', 'http://evil.example.com/api/embeddings', 'http://127.0.0.1:11434/api/embeddings?x=1', 'not a url', 'ftp://127.0.0.1/x'])
    assert.equal(localEmbedEndpoint({YENO_LOCAL_EMBED_BASE_URL: bad}), null);
});

test('embedText calls only the resolved loopback endpoint with the configured model and validates the response shape', async () => {
  let calledUrl, calledBody;
  const fetchImpl = async (url, options) => {
    calledUrl = url; calledBody = JSON.parse(options.body);
    return new Response(JSON.stringify({embedding: unique}), {headers: {'content-type': 'application/json'}});
  };
  const result = await embedText({YENO_LOCAL_EMBED_MODEL: 'nomic-embed-text'}, '고유한 사실입니다', {fetchImpl});
  assert.equal(calledUrl, 'http://127.0.0.1:11434/api/embeddings');
  assert.deepEqual(calledBody, {model: 'nomic-embed-text', prompt: '고유한 사실입니다'});
  assert.deepEqual(result, {embedding: unique, model: 'nomic-embed-text'});

  await assert.rejects(embedText({YENO_LOCAL_EMBED_MODEL: 'm'}, '', {fetchImpl}), err => err instanceof MemoryEmbeddingError);
  await assert.rejects(embedText({YENO_LOCAL_EMBED_BASE_URL: 'https://example.com', YENO_LOCAL_EMBED_MODEL: 'm'}, 'x', {fetchImpl}), err => err.code === 'INVALID_EMBED_ENDPOINT');
  await assert.rejects(embedText({}, 'x', {fetchImpl}), err => err.code === 'MISSING_EMBED_MODEL');
  await assert.rejects(embedText({YENO_LOCAL_EMBED_MODEL: 'm'}, 'x', {fetchImpl: async () => new Response('{}', {status: 500})}), err => err.code === 'EMBED_HTTP_ERROR');
  await assert.rejects(embedText({YENO_LOCAL_EMBED_MODEL: 'm'}, 'x', {fetchImpl: async () => new Response(JSON.stringify({embedding: [1]}), {headers: {'content-type': 'application/json'}})}), err => err.code === 'INVALID_EMBED_RESPONSE');
});

test('cosineSimilarity ranks a paraphrase near its source and far from an unrelated vector', () => {
  const same = cosineSimilarity(unique, unique);
  const near = cosineSimilarity(unique, paraphrase);
  const far = cosineSimilarity(unique, other);
  assert.ok(Math.abs(same - 1) < 1e-9);
  assert.ok(near > far);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
});

test('create/update/delete validate their fields and reject malformed records', () => {
  const record = createMemoryEmbeddingRecord({text: '유일한 사실', embedding: unique, model: 'm'}, {at: AT});
  validateMemoryEmbeddingRecord(record);
  assert.equal(record.deletedAt, null);
  assert.equal(record.createdAt, AT);
  assert.equal(record.updatedAt, AT);

  const updated = updateMemoryEmbeddingRecord(record, {text: '수정된 사실', embedding: paraphrase, model: 'm'}, {at: AT2});
  assert.equal(updated.id, record.id);
  assert.equal(updated.text, '수정된 사실');
  assert.equal(updated.createdAt, AT);
  assert.equal(updated.updatedAt, AT2);

  const deleted = deleteMemoryEmbeddingRecord(updated, {at: AT3});
  assert.equal(deleted.deletedAt, AT3);
  assert.throws(() => updateMemoryEmbeddingRecord(deleted, {text: 'x', embedding: unique, model: 'm'}, {at: AT3}), err => err.code === 'MEMORY_EMBEDDING_DELETED');
  // Deleting an already-deleted record is a no-op, not an error.
  assert.deepEqual(deleteMemoryEmbeddingRecord(deleted, {at: AT3}), deleted);

  for (const bad of [{...record, id: 'not-a-uuid'}, {...record, embedding: [1]}, {...record, text: ''}, {...record, model: ''}, {...record, extra: 1}])
    assert.throws(() => validateMemoryEmbeddingRecord(bad), err => err instanceof MemoryEmbeddingError);
});

test('addMemoryEmbeddingRecord and replaceMemoryEmbeddingRecord keep a list consistent', () => {
  const a = createMemoryEmbeddingRecord({text: 'a', embedding: unique, model: 'm'}, {at: AT});
  let list = addMemoryEmbeddingRecord([], a);
  assert.equal(list.length, 1);
  assert.throws(() => addMemoryEmbeddingRecord(list, a), err => /중복/.test(err.message));

  const updatedA = updateMemoryEmbeddingRecord(a, {text: 'a2', embedding: paraphrase, model: 'm'}, {at: AT2});
  list = replaceMemoryEmbeddingRecord(list, updatedA);
  assert.equal(list[0].text, 'a2');
  assert.throws(() => replaceMemoryEmbeddingRecord(list, {...updatedA, id: '00000000-0000-4000-8000-000000000000'}), err => err.code === 'MEMORY_EMBEDDING_NOT_FOUND');
});

test('searchMemoryEmbeddings finds a paraphrase by meaning, never returns a deleted record, and reflects an edit', () => {
  const at = new Date();
  const iso = offsetMs => new Date(at.getTime() + offsetMs).toISOString();
  const factA = createMemoryEmbeddingRecord({text: '유읽한 사실 A: 코드명은 자수정-7', embedding: unique, model: 'm'}, {at: iso(0)});
  const factB = createMemoryEmbeddingRecord({text: '무관한 사실 B', embedding: other, model: 'm'}, {at: iso(1)});
  let list = addMemoryEmbeddingRecord(addMemoryEmbeddingRecord([], factA), factB);

  // Paraphrased query embedding (not identical to the stored one) still finds factA first.
  const results = searchMemoryEmbeddings(list, paraphrase, {limit: 5});
  assert.equal(results[0].id, factA.id);
  assert.equal(results[0].text, factA.text);
  assert.ok(results[0].score > results.find(r => r.id === factB.id).score);

  // Edit factA - the search must now return the updated text under the same id.
  const editedA = updateMemoryEmbeddingRecord(factA, {text: '유일한 사실 A: 코드명은 자수정-9로 변경됨', embedding: unique, model: 'm'}, {at: iso(2)});
  list = replaceMemoryEmbeddingRecord(list, editedA);
  const afterEdit = searchMemoryEmbeddings(list, paraphrase, {limit: 5});
  assert.equal(afterEdit[0].id, factA.id);
  assert.match(afterEdit[0].text, /자수정-9/);

  // Delete factA - it must never come back from search again, at any limit.
  const deletedA = deleteMemoryEmbeddingRecord(editedA, {at: iso(3)});
  list = replaceMemoryEmbeddingRecord(list, deletedA);
  const afterDelete = searchMemoryEmbeddings(list, paraphrase, {limit: 10});
  assert.ok(!afterDelete.some(r => r.id === factA.id));
  assert.ok(!searchMemoryEmbeddings(list, unique, {limit: 10}).some(r => r.id === factA.id));
});
