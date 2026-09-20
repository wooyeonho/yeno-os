import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {storeIndependentBackup, listIndependentBackups, verifyStoredBackup} from '../../scripts/backup-retention.mjs';

const VERIFICATION = {format: 1, createdAt: '2026-09-20T00:00:00.000Z', revision: 4, projects: 2, sources: 3, jobs: 5, artifacts: 1};
const verifier = async () => ({...VERIFICATION});
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-retention-'));
  const source = path.join(root, 'source'); const target = path.join(root, 'independent');
  fs.mkdirSync(source); fs.mkdirSync(target); const archivePath = path.join(source, 'export.yenobk');
  fs.writeFileSync(archivePath, Buffer.from('encrypted-archive-fixture-' + 'x'.repeat(40))); fs.chmodSync(archivePath, 0o600);
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return {root, source, target, archivePath, archive: fs.readFileSync(archivePath)};
}

test('stores a verified archive in an independent directory and never persists the verifier secret', async t => {
  const f = fixture(t), result = await storeIndependentBackup({archive: f.archive, sourcePath: f.archivePath, targetDir: f.target, sourceRef: 'koyeb-export', verifyArchive: verifier, at: '2026-09-20T01:00:00.000Z'});
  assert.equal(result.stored, true); assert.equal(result.reused, false); assert.equal(result.pruned, 0);
  assert.equal(fs.existsSync(result.archivePath), true); assert.equal(fs.existsSync(result.manifestPath), true);
  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
  assert.equal(manifest.sourceRef, 'koyeb-export'); assert.equal('key' in manifest, false); assert.equal('token' in manifest, false);
  assert.equal(listIndependentBackups(f.target).length, 1);
  const checked = await verifyStoredBackup({manifestPath: result.manifestPath, verifyArchive: verifier});
  assert.equal(checked.verification.revision, 4);
});

test('replaying the same archive is idempotent and does not create a second record', async t => {
  const f = fixture(t), first = await storeIndependentBackup({archive: f.archive, sourcePath: f.archivePath, targetDir: f.target, sourceRef: 'owner-export', verifyArchive: verifier, at: '2026-09-20T01:00:00.000Z'});
  const second = await storeIndependentBackup({archive: f.archive, sourcePath: f.archivePath, targetDir: f.target, sourceRef: 'owner-export', verifyArchive: verifier, at: '2026-09-20T02:00:00.000Z'});
  assert.equal(second.reused, true); assert.equal(second.archivePath, first.archivePath); assert.equal(listIndependentBackups(f.target).length, 1);
});

test('same, nested, and symlinked storage is rejected', async t => {
  const f = fixture(t);
  await assert.rejects(() => storeIndependentBackup({archive: f.archive, sourcePath: f.archivePath, targetDir: f.source, sourceRef: 'x', verifyArchive: verifier}), /storage_not_independent/);
  const nested = path.join(f.source, 'nested'); fs.mkdirSync(nested);
  await assert.rejects(() => storeIndependentBackup({archive: f.archive, sourcePath: f.archivePath, targetDir: nested, sourceRef: 'x', verifyArchive: verifier}), /storage_not_independent/);
  const link = path.join(f.root, 'link'); fs.symlinkSync(f.target, link);
  await assert.rejects(() => storeIndependentBackup({archive: f.archive, sourcePath: f.archivePath, targetDir: link, sourceRef: 'x', verifyArchive: verifier}), /directory_must_be_real|directory_symlink_component/);
});

test('archive tampering fails before verifier acceptance', async t => {
  const f = fixture(t), result = await storeIndependentBackup({archive: f.archive, sourcePath: f.archivePath, targetDir: f.target, sourceRef: 'owner-export', verifyArchive: verifier});
  fs.appendFileSync(result.archivePath, 'tamper');
  await assert.rejects(() => verifyStoredBackup({manifestPath: result.manifestPath, verifyArchive: verifier}), /archive_hash_mismatch/);
});

test('optional pruning only removes older BLACKHOLE records after a new record is durable', async t => {
  const f = fixture(t);
  for (const [i, at] of ['2026-09-20T01:00:00.000Z', '2026-09-20T02:00:00.000Z', '2026-09-20T03:00:00.000Z'].entries()) {
    const archive = Buffer.from(`encrypted-archive-fixture-${i}-` + 'x'.repeat(40)); const sourcePath = path.join(f.source, `export-${i}.yenobk`); fs.writeFileSync(sourcePath, archive); fs.chmodSync(sourcePath, 0o600);
    await storeIndependentBackup({archive, sourcePath, targetDir: f.target, sourceRef: 'owner-export', verifyArchive: verifier, at, maxBackups: 2, prune: i === 2});
  }
  const entries = listIndependentBackups(f.target); assert.equal(entries.length, 2); assert.equal(entries[0].manifest.archiveCreatedAt, VERIFICATION.createdAt);
});
