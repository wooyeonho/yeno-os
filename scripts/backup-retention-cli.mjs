#!/usr/bin/env node
// Owner-side adapter. First create an encrypted archive with scripts/backup.mjs;
// this command verifies it with the same canonical decryptBackup implementation
// and stores it in a separate pre-created directory.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {decryptBackup} from '../runtime/lib/backup.mjs';
import {storeIndependentBackup, listIndependentBackups, verifyStoredBackup} from './backup-retention.mjs';

function privateFile(file, max) {
  const resolved = path.resolve(file), fd = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.isSymbolicLink?.() || stat.nlink !== 1 || stat.size > max) throw new Error('private input invalid');
    if (process.platform !== 'win32' && (stat.mode & 0o077)) throw new Error('private input permissions invalid');
    const bytes = Buffer.alloc(stat.size); let offset = 0;
    while (offset < bytes.length) { const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset); if (!count) throw new Error('input truncated'); offset += count; }
    return bytes;
  } finally { fs.closeSync(fd); }
}
function key(file) {
  const value = privateFile(file, 128).toString('utf8').trim();
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('key must be 32 random bytes encoded as hex');
  return Buffer.from(value, 'hex');
}
function arg(args, name) { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; }
async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (command === 'list') return {backups: listIndependentBackups(arg(args, '--target')).map(item => item.manifest)};
  const archivePath = arg(args, '--archive'), targetDir = arg(args, '--target'), keyPath = arg(args, '--key-file');
  if (!archivePath || !targetDir || !keyPath) throw new Error('Usage: store|verify --archive FILE --key-file FILE --target DIRECTORY [--source-ref LABEL] [--prune]');
  const archive = privateFile(archivePath, 16 * 1024 * 1024 + 36), secret = key(keyPath);
  try {
    const verifyArchive = bytes => {
      const payload = decryptBackup(bytes, secret);
      return {format: payload.format, createdAt: payload.createdAt, revision: payload.state.revision, projects: payload.state.projects.length, sources: payload.state.sources.length, jobs: payload.state.jobs.length, artifacts: payload.artifacts.length};
    };
    if (command === 'verify') {
      const entries = listIndependentBackups(targetDir), verified = [];
      for (const entry of entries) verified.push(await verifyStoredBackup({manifestPath: entry.manifestPath, verifyArchive}));
      return {verified: verified.length, latest: verified[0]?.manifest ?? null};
    }
    if (command !== 'store') throw new Error('Unknown command');
    const result = await storeIndependentBackup({archive, targetDir, sourcePath: archivePath, sourceRef: arg(args, '--source-ref') ?? 'owner-export', maxBackups: Number(arg(args, '--max-backups') ?? 7), prune: args.includes('--prune'), verifyArchive});
    return {stored: result.stored, reused: result.reused, pruned: result.pruned, archiveSha256: result.manifest.archiveSha256, bytes: result.manifest.bytes, manifestPath: result.manifestPath};
  } finally { secret.fill(0); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => console.log(JSON.stringify(result))).catch(() => { console.error('Independent backup operation failed. Existing core data was not modified.'); process.exitCode = 1; });
}
