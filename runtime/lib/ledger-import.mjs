import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const PARTS = ['01_DRAFTS', '20260926_BLACKHOLE_IDEA_LEDGER_R3_RECHECK_COMPLETE', 'data', 'ALL_IDEA_RECORDS.json'];
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_RECORDS = 2000;
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const fail = reason => { throw new Error(reason); };
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const aliasesOf = value => Array.isArray(value) ? value.filter(x => typeof x === 'string').map(x => x.slice(0, 200)) : typeof value === 'string' && value.trim() ? [value.slice(0, 200)] : [];

export const emptyLedger = () => ({version: 1, entries: [], history: [], fingerprint: hash([])});

export function readLedgerFile(config) {
  if (!config?.enabled || !path.isAbsolute(config.vaultRoot ?? '')) fail('ledger_unavailable');
  const root = fs.realpathSync(config.vaultRoot);
  if (!fs.lstatSync(root).isDirectory()) fail('ledger_unavailable');
  let target = root;
  for (const part of PARTS) {
    target = path.join(target, part);
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) fail('ledger_unsafe_path');
  }
  if (!fs.realpathSync(target).startsWith(root + path.sep)) fail('ledger_unsafe_path');
  const stat = fs.statSync(target);
  if (!stat.isFile() || stat.size > MAX_BYTES) fail('ledger_invalid');
  const content = fs.readFileSync(target, 'utf8');
  if (Buffer.byteLength(content) > MAX_BYTES) fail('ledger_invalid');
  let records;
  try { records = JSON.parse(content); } catch { fail('ledger_invalid'); }
  if (!Array.isArray(records) || records.length > MAX_RECORDS) fail('ledger_invalid');
  return {records, fileSha256: hash(content), count: records.length};
}

export function ledgerNature(record) {
  if (['시스템 요구72', '추가아이디어·능력145'].includes(record.category)) return 'tool';
  if (['원본프로젝트50', '등록자료103'].includes(record.category)) return 'project';
  const matches = String(record.original_intent ?? '').match(/기능|도구|모듈|API|화면|명령/g);
  return (matches?.length ?? 0) >= 2 ? 'tool' : 'unclassified';
}

function projectRecord(record, at) {
  if (!record || typeof record.id !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(record.id) || typeof record.name !== 'string' || !record.name.trim()) fail('ledger_invalid');
  const nature = ledgerNature(record);
  const fields = {
    id: record.id, name: text(record.name, 300), category: text(record.category, 120), aliases: aliasesOf(record.aliases),
    intent: text(record.original_intent, 2000), nextAction: text(record.next_action, 1000),
    evidenceStatus: text(record.evidence_status, 150), sourceRefs: Array.isArray(record.source_refs) ? structuredClone(record.source_refs) : [],
    nature, natureReason: nature === 'unclassified' ? 'evidence_insufficient' : nature === 'project' ? 'category_project' : 'category_or_intent_tool',
    sourceSha256: hash(record), importedAt: at,
  };
  return {...fields, recordSha256: hash(fields)};
}

export function validateLedger(ledger) {
  if (!ledger || ledger.version !== 1 || !Array.isArray(ledger.entries) || ledger.entries.length > MAX_RECORDS || !Array.isArray(ledger.history)) fail('ledger_invalid');
  const ids = new Set();
  for (const entry of ledger.entries) {
    const {recordSha256, ...fields} = entry;
    if (ids.has(entry.id) || recordSha256 !== hash(fields)) fail('ledger_invalid');
    ids.add(entry.id);
  }
  if (ledger.fingerprint !== hash(ledger.entries.map(e => [e.id, e.recordSha256]))) fail('ledger_invalid');
  return true;
}

export function importLedger(current, records, at) {
  if (!Array.isArray(records) || records.length > MAX_RECORDS || typeof at !== 'string' || !Number.isFinite(Date.parse(at))) fail('ledger_invalid');
  if (current) validateLedger(current);
  const previous = new Map((current?.entries ?? []).map(e => [e.id, e]));
  const seen = new Set();
  const history = [...(current?.history ?? [])];
  let changed = false;
  const entries = records.map(record => {
    const next = projectRecord(record, at);
    if (seen.has(next.id)) fail('ledger_duplicate_id');
    seen.add(next.id);
    const prior = previous.get(next.id);
    if (prior?.sourceSha256 === next.sourceSha256) return prior;
    changed = true;
    if (prior) history.push({id: next.id, previousSha256: prior.sourceSha256, sourceSha256: next.sourceSha256, at});
    return next;
  });
  if (current && [...previous.keys()].some(id => !seen.has(id))) fail('ledger_missing_existing_id');
  if (current && !changed && entries.length === current.entries.length) return current;
  const result = {version: 1, entries, history: history.slice(-2000), fingerprint: hash(entries.map(e => [e.id, e.recordSha256]))};
  validateLedger(result);
  return result;
}

export function ledgerSummary(ledger) {
  validateLedger(ledger);
  const categories = {}, natures = {tool: 0, project: 0, unclassified: 0};
  for (const entry of ledger.entries) {
    categories[entry.category] = (categories[entry.category] ?? 0) + 1;
    natures[entry.nature]++;
  }
  return {count: ledger.entries.length, categories, natures, fingerprint: ledger.fingerprint};
}
