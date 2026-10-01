import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {start} from '../runtime/server.mjs';
import {readLedgerFile} from '../runtime/lib/ledger-import.mjs';
import {exportBackup,decryptBackup} from '../runtime/lib/backup.mjs';

const sourceVault = process.argv[2];
const output = process.argv[3];
if (!sourceVault || !output || !path.isAbsolute(sourceVault) || !path.isAbsolute(output)) throw new Error('absolute vault and output paths required');
const source = readLedgerFile({enabled: true, vaultRoot: sourceVault});
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-ledger-live-'));
const vault = path.join(root, 'vault');
const dataDir = path.join(root, 'data');
const subpath = path.join('01_DRAFTS', '20260926_BLACKHOLE_IDEA_LEDGER_R3_RECHECK_COMPLETE', 'data');
const copyDir = path.join(vault, subpath);
fs.mkdirSync(copyDir, {recursive: true});
fs.copyFileSync(path.join(sourceVault, subpath, 'ALL_IDEA_RECORDS.json'), path.join(copyDir, 'ALL_IDEA_RECORDS.json'));
const copied = readLedgerFile({enabled: true, vaultRoot: vault});
if (copied.fileSha256 !== source.fileSha256) throw new Error('ledger copy hash mismatch');
const token = 'synthetic-ledger-verification-owner';
const env = {YENO_OBSIDIAN_EXPORT_ENABLED: 'true', YENO_OBSIDIAN_VAULT_PATH: vault};
let core;
const request = async (method, route, body) => {
  const response = await fetch(`http://127.0.0.1:${core.server.address().port}${route}`, {
    method, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: body ? JSON.stringify(body) : undefined,
  });
  return {status: response.status, body: await response.json()};
};
try {
  core = await start({host: '127.0.0.1', port: 0, dataDir, token, env});
  const imported = await request('POST', '/api/ledger/import', {requestId: randomUUID()});
  if (imported.status !== 201) throw new Error(`import status ${imported.status}`);
  const state = await request('GET', '/api/state');
  const found = await request('GET', '/api/ledger/search?q=AlohaGo');
  const repeated = await request('POST', '/api/ledger/import', {requestId: randomUUID()});
  const stored = JSON.parse(JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8')).payload);
  const backupKey = randomBytes(32);
  const archive = exportBackup({state: stored, dataDir, key: backupKey});
  const backupLedger = decryptBackup(archive, backupKey).state.ledger;
  core.shutdown();
  core = await start({host: '127.0.0.1', port: 0, dataDir, token, env});
  const restarted = await request('GET', '/api/state');
  const recovered = await request('GET', '/api/ledger/search?q=AlohaGo');
  const alohaIds = new Set(source.records.filter(record => /AlohaGo/i.test(record.name) || /AlohaGo/i.test(String(record.aliases ?? ''))).map(record => record.id));
  const sourceAfter = readLedgerFile({enabled: true, vaultRoot: sourceVault});
  const report = {
    sourceSha256: source.fileSha256, sourceAfterSha256: sourceAfter.fileSha256, copiedSha256: copied.fileSha256,
    sourceCount: source.count, importedStatus: imported.status, repeatStatus: repeated.status,
    stateCount: state.body.ledger?.count, categoryCount: Object.keys(state.body.ledger?.categories ?? {}).length,
    natureCounts: state.body.ledger?.natures, memoryCount: state.body.memory?.count,
    backupBytes: archive.length, backupLedgerCount: backupLedger.entries.length, backupFingerprint: backupLedger.fingerprint,
    fingerprint: state.body.ledger?.fingerprint, restartFingerprint: restarted.body.ledger?.fingerprint,
    recallIds: found.body.recalled?.map(item => item.id), restartRecallIds: recovered.body.recalled?.map(item => item.id),
    isolated: true,
  };
  if (report.sourceSha256 !== report.sourceAfterSha256 || report.sourceCount !== report.stateCount || report.backupLedgerCount !== report.stateCount || report.fingerprint !== report.backupFingerprint || report.fingerprint !== report.restartFingerprint || !report.recallIds?.some(id => alohaIds.has(id)) || !report.restartRecallIds?.some(id => alohaIds.has(id)) || repeated.status !== 200) throw new Error('ledger acceptance mismatch');
  fs.mkdirSync(output, {recursive: true});
  fs.writeFileSync(path.join(output, 'm1-isolated-report.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'm1-import-report.json'), JSON.stringify({sourceSha256: report.sourceSha256, sourceCount: report.sourceCount, importedStatus: report.importedStatus, repeatStatus: report.repeatStatus, stateCount: report.stateCount, memoryCount: report.memoryCount, fingerprint: report.fingerprint, restartFingerprint: report.restartFingerprint, backupLedgerCount: report.backupLedgerCount, backupFingerprint: report.backupFingerprint, backupBytes: report.backupBytes, isolated: true}, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'm1-nature-counts.json'), JSON.stringify({count: report.stateCount, categoryCount: report.categoryCount, categories: state.body.ledger.categories, natures: report.natureCounts}, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  core?.shutdown();
  fs.rmSync(root, {recursive: true, force: true});
}
