import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readLedgerFile, importLedger, validateLedger, ledgerSummary} from '../lib/ledger-import.mjs';
import {recallMemories, recallPromptBlock} from '../lib/memory-recall.mjs';
import {start} from '../server.mjs';
import {randomUUID} from 'node:crypto';

const at = '2026-09-27T00:00:00.000Z';
const raw = [
  {id: 'A01', name: 'AlohaGo', category: '원본프로젝트50', aliases: ['알로하고'], original_intent: '사용자 여정', next_action: '조사', evidence_status: '원문', source_refs: []},
  {id: 'B02', name: '화면 도구', category: '시스템 요구72', aliases: [], original_intent: '화면 모듈 기능', next_action: '', evidence_status: '부분', source_refs: []},
  {id: 'C03', name: '빈 항목', category: '미분류', aliases: [], original_intent: '', next_action: '', evidence_status: '미확인', source_refs: []},
];

test('ledger import preserves original IDs, every nature and idempotent fingerprint', () => {
  const first = importLedger(null, raw, at);
  assert.deepEqual(first.entries.map(e => [e.id, e.nature]), [['A01', 'project'], ['B02', 'tool'], ['C03', 'unclassified']]);
  assert.equal(ledgerSummary(first).count, 3);
  assert.equal(importLedger(first, raw, at), first);
  assert.throws(() => importLedger(first, raw.slice(0, 2), at), /ledger_missing_existing_id/);
  assert.equal(validateLedger(JSON.parse(JSON.stringify(first))), true);
  assert.throws(() => validateLedger({...first, entries: [{...first.entries[0], name: 'tampered'}, ...first.entries.slice(1)]}));
});

test('ledger reader stays inside configured vault and enforces size and schema', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-ledger-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const dir = path.join(root, '01_DRAFTS', '20260926_BLACKHOLE_IDEA_LEDGER_R3_RECHECK_COMPLETE', 'data');
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, 'ALL_IDEA_RECORDS.json');
  fs.writeFileSync(file, JSON.stringify(raw));
  assert.equal(readLedgerFile({enabled: true, vaultRoot: root}).records.length, 3);
  assert.throws(() => readLedgerFile({enabled: false, vaultRoot: root}), /ledger_unavailable/);
  fs.writeFileSync(file, '{}');
  assert.throws(() => readLedgerFile({enabled: true, vaultRoot: root}), /ledger_invalid/);
});

test('ledger record is recalled by original name and cites original ID and evidence status', () => {
  const ledger = importLedger(null, raw, at);
  const recall = recallMemories({ledger}, 'AlohaGo 뭐였지');
  assert.equal(recall.recalled[0]?.id, 'A01');
  assert.equal(recall.recalled[0]?.kind, 'ledger');
  assert.match(recallPromptBlock(recall), /ledger\/A01/);
  assert.match(recallPromptBlock(recall), /원문/);
});

test('owner imports a vault ledger through HTTP once, sees a safe summary, and restart preserves recall', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-ledger-http-'));
  const vault = path.join(root, 'vault');
  const dataDir = path.join(root, 'data');
  const ledgerDir = path.join(vault, '01_DRAFTS', '20260926_BLACKHOLE_IDEA_LEDGER_R3_RECHECK_COMPLETE', 'data');
  fs.mkdirSync(ledgerDir, {recursive: true});
  fs.writeFileSync(path.join(ledgerDir, 'ALL_IDEA_RECORDS.json'), JSON.stringify(raw));
  const token = 'synthetic-owner-token';
  const env = {YENO_OBSIDIAN_EXPORT_ENABLED: 'true', YENO_OBSIDIAN_VAULT_PATH: vault};
  let app = await start({host: '127.0.0.1', port: 0, dataDir, token, env});
  t.after(() => {app.shutdown(); fs.rmSync(root, {recursive: true, force: true});});
  const request = async (method, route, body) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}${route}`, {
      method, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined,
    });
    return {status: response.status, body: await response.json()};
  };
  const first = await request('POST', '/api/ledger/import', {requestId: randomUUID()});
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.ledger.count, 3);
  const anonymous = await fetch(`http://127.0.0.1:${app.server.address().port}/api/ledger/search?q=AlohaGo`);
  assert.equal(anonymous.status, 401);
  const second = await request('POST', '/api/ledger/import', {requestId: randomUUID()});
  assert.equal(second.status, 200);
  const state = await request('GET', '/api/state');
  assert.equal(state.body.ledger.count, 3);
  assert.equal(state.body.memory.ledgerCount, 3);
  app.shutdown();
  app = await start({host: '127.0.0.1', port: 0, dataDir, token, env});
  const after = await request('GET', '/api/state');
  assert.equal(after.body.ledger.fingerprint, state.body.ledger.fingerprint);
  const found = await request('GET', '/api/ledger/search?q=AlohaGo');
  assert.equal(found.status, 200);
  assert.equal(found.body.recalled[0]?.id, 'A01');
});
