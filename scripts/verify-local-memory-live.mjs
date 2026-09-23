// Manual, real-network live verification for local memory embeddings (P2 §2-4).
// NOT part of `npm test` (see package.json's `test` script and README note in
// this folder) - it makes real HTTP calls to a real local embedding server
// (Ollama's /api/embeddings) and is meant to be run by hand, across separate
// process invocations, so a real restart of YENO/the model server sits
// between "store" and "query" - a single long-lived script can't prove that.
//
// The store this script reads/writes is intentionally NOT the production
// YENO data directory - it's an isolated JSON file under the OS temp dir,
// so this never touches real owner memory.
//
// Usage (PowerShell, from the repo root; each line is a SEPARATE run):
//   $env:YENO_LOCAL_EMBED_MODEL = "nomic-embed-text"
//   node scripts/verify-local-memory-live.mjs store "<고유한 사실 문장>"
//   node scripts/verify-local-memory-live.mjs query "<완전히 다른 표현의 질문>"
//   node scripts/verify-local-memory-live.mjs edit <id> "<수정된 사실 문장>"
//   node scripts/verify-local-memory-live.mjs query "<같은 질문>"   # now returns the edited text
//   node scripts/verify-local-memory-live.mjs delete <id>
//   node scripts/verify-local-memory-live.mjs query "<같은 질문>"   # must no longer return it
//   node scripts/verify-local-memory-live.mjs list
//
// Run the full store->query sequence once with internet ON, and again after
// (a) restarting Ollama and (b) turning internet OFF, to satisfy P2 §3-4.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  embedText, createMemoryEmbeddingRecord, updateMemoryEmbeddingRecord,
  deleteMemoryEmbeddingRecord, addMemoryEmbeddingRecord, replaceMemoryEmbeddingRecord,
  searchMemoryEmbeddings, localEmbedEndpoint,
} from '../runtime/lib/memory-embeddings.mjs';

const STORE_PATH = process.env.YENO_MEMORY_LIVE_STORE || path.join(os.tmpdir(), 'yeno-memory-embeddings-live-store.json');

const calls = []; // every fetch target this process attempts, for the external-call log
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  calls.push(typeof url === 'string' ? url : url?.url ?? String(url));
  return realFetch(url, options);
};

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) return [];
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}
function saveStore(list) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(list, null, 2));
}
function printFetchLog() {
  const external = calls.filter(target => !/^https?:\/\/(127\.0\.0\.1|localhost|\[?::1\]?)(:|\/)/.test(target));
  console.log('fetch targets  :', JSON.stringify(calls));
  console.log('external calls :', external.length, external.length ? JSON.stringify(external) : '(none)');
  return external.length === 0;
}

const env = {
  YENO_LOCAL_EMBED_MODEL: process.env.YENO_LOCAL_EMBED_MODEL || 'nomic-embed-text',
  YENO_LOCAL_EMBED_BASE_URL: process.env.YENO_LOCAL_EMBED_BASE_URL || undefined,
};

async function main() {
  const [, , command, ...rest] = process.argv;
  const endpoint = localEmbedEndpoint(env);
  if (endpoint === null) { console.error('FAIL: embedding endpoint is not loopback-only.'); process.exit(1); }
  console.log('store path     :', STORE_PATH);
  console.log('endpoint       :', endpoint);
  console.log('model          :', env.YENO_LOCAL_EMBED_MODEL);

  if (command === 'store') {
    const text = rest.join(' ');
    if (!text) { console.error('FAIL: usage: store "<text>"'); process.exit(1); }
    const {embedding, model} = await embedText(env, text);
    const record = createMemoryEmbeddingRecord({text, embedding, model}, {at: new Date().toISOString()});
    saveStore(addMemoryEmbeddingRecord(loadStore(), record));
    const ok = printFetchLog();
    console.log('stored id      :', record.id);
    console.log('stored text    :', record.text);
    console.log(ok ? 'OK: stored via local embedding only, 0 external calls.' : 'FAIL: external call(s) detected.');
    process.exit(ok ? 0 : 1);
  }

  if (command === 'query') {
    const text = rest.join(' ');
    if (!text) { console.error('FAIL: usage: query "<text>"'); process.exit(1); }
    const {embedding} = await embedText(env, text);
    const list = loadStore();
    const results = searchMemoryEmbeddings(list, embedding, {limit: 3});
    const ok = printFetchLog();
    console.log('query          :', text);
    console.log('records in store:', list.length, '(', list.filter(r => r.deletedAt === null).length, 'active )');
    console.log('top results    :', JSON.stringify(results, null, 2));
    console.log(ok ? 'OK: query served by local embedding only, 0 external calls.' : 'FAIL: external call(s) detected.');
    process.exit(ok ? 0 : 1);
  }

  if (command === 'edit') {
    const [id, ...textParts] = rest;
    const text = textParts.join(' ');
    if (!id || !text) { console.error('FAIL: usage: edit <id> "<new text>"'); process.exit(1); }
    const list = loadStore();
    const record = list.find(r => r.id === id);
    if (!record) { console.error('FAIL: no such id in store:', id); process.exit(1); }
    const {embedding, model} = await embedText(env, text);
    const updated = updateMemoryEmbeddingRecord(record, {text, embedding, model}, {at: new Date().toISOString()});
    saveStore(replaceMemoryEmbeddingRecord(list, updated));
    const ok = printFetchLog();
    console.log('updated id     :', updated.id);
    console.log('updated text   :', updated.text);
    console.log(ok ? 'OK: edited via local embedding only, 0 external calls.' : 'FAIL: external call(s) detected.');
    process.exit(ok ? 0 : 1);
  }

  if (command === 'delete') {
    const [id] = rest;
    if (!id) { console.error('FAIL: usage: delete <id>'); process.exit(1); }
    const list = loadStore();
    const record = list.find(r => r.id === id);
    if (!record) { console.error('FAIL: no such id in store:', id); process.exit(1); }
    const deleted = deleteMemoryEmbeddingRecord(record, {at: new Date().toISOString()});
    saveStore(replaceMemoryEmbeddingRecord(list, deleted));
    console.log('deleted id     :', deleted.id, 'deletedAt', deleted.deletedAt);
    console.log('OK: marked deleted (no network call needed for delete).');
    process.exit(0);
  }

  if (command === 'list') {
    const list = loadStore();
    console.log(JSON.stringify(list.map(r => ({id: r.id, text: r.text, createdAt: r.createdAt, updatedAt: r.updatedAt, deletedAt: r.deletedAt})), null, 2));
    process.exit(0);
  }

  console.error('FAIL: unknown command. Use: store | query | edit | delete | list');
  process.exit(1);
}

main().catch(error => { console.error('FAIL:', error.code || error.message); printFetchLog(); process.exit(1); });
