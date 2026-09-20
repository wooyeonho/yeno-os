// Independent encrypted-backup retention adapter.
//
// The canonical archive format and encryption remain in runtime/lib/backup.mjs.
// This module only verifies an already-created archive and stores it in a
// separately provisioned directory. It never writes the core data directory,
// never stores the encryption key, and never replaces an existing archive.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const RETENTION_VERSION = 1;
export const DEFAULT_MAX_BACKUPS = 7;
export const MAX_MANIFEST_BYTES = 64 * 1024;
export const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024 + 36;

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_REF = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/;
const ISO = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const fail = code => { throw new RetentionError(code); };

export class RetentionError extends Error {
  constructor(code) { super(`Independent backup retention: ${code}`); this.code = code; }
}

function regularDirectory(input) {
  if (typeof input !== 'string' || !input.trim()) fail('directory_required');
  const resolved = path.resolve(input);
  let stat;
  try { stat = fs.lstatSync(resolved); } catch { fail('directory_missing'); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('directory_must_be_real');
  let real;
  try { real = fs.realpathSync(resolved); } catch { fail('directory_unresolvable'); }
  if (real !== resolved) fail('directory_symlink_component');
  return real;
}

function regularFile(input, maxBytes = Number.MAX_SAFE_INTEGER) {
  if (typeof input !== 'string' || !input.trim()) fail('file_required');
  const resolved = path.resolve(input);
  let stat;
  try { stat = fs.lstatSync(resolved); } catch { fail('file_missing'); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maxBytes) fail('file_must_be_bounded_regular');
  return resolved;
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

export function assertIndependentStorage({sourcePath, targetDir}) {
  const target = regularDirectory(targetDir);
  if (sourcePath !== undefined && sourcePath !== null) {
    const source = regularFile(sourcePath);
    const sourceParent = fs.realpathSync(path.dirname(source));
    if (inside(sourceParent, target) || inside(target, sourceParent)) fail('storage_not_independent');
  }
  return target;
}

function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function timestamp(value) { if (!ISO(value)) fail('invalid_timestamp'); }
function safeSourceRef(value) { if (typeof value !== 'string' || !SAFE_REF.test(value)) fail('invalid_source_ref'); return value; }
function backupFilename(at, sha256) {
  timestamp(at);
  const compact = at.replace(/[-:.]/g, '');
  return `blackhole-backup-${compact}-${sha256}.yenobk`;
}
function manifestFilename(archiveFilename) { return `${archiveFilename}.manifest.json`; }

function validateVerification(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_archive_verification');
  if (value.format !== 1 || !ISO(value.createdAt) || !Number.isSafeInteger(value.revision) || value.revision < 0) fail('invalid_archive_verification');
  for (const key of ['projects', 'sources', 'jobs', 'artifacts']) if (!Number.isSafeInteger(value[key]) || value[key] < 0) fail('invalid_archive_verification');
  return {
    format: 1,
    createdAt: value.createdAt,
    revision: value.revision,
    projects: value.projects,
    sources: value.sources,
    jobs: value.jobs,
    artifacts: value.artifacts
  };
}

function validateManifest(value) {
  const keys = ['version', 'archiveFilename', 'archiveSha256', 'bytes', 'verifiedAt', 'archiveCreatedAt', 'sourceRef', 'verification'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('invalid_manifest_shape');
  if (value.version !== RETENTION_VERSION || typeof value.archiveFilename !== 'string' || !/^blackhole-backup-[0-9TZ]+-[a-f0-9]{64}\.yenobk$/.test(value.archiveFilename) || !SHA256.test(value.archiveSha256)) fail('invalid_manifest_identity');
  if (!Number.isSafeInteger(value.bytes) || value.bytes <= 36) fail('invalid_manifest_size');
  timestamp(value.verifiedAt); timestamp(value.archiveCreatedAt); safeSourceRef(value.sourceRef); validateVerification(value.verification);
  return value;
}

function readBoundedFile(file, maximum) {
  const resolved = regularFile(file, maximum);
  const bytes = fs.readFileSync(resolved);
  if (bytes.length > maximum) fail('file_changed_during_read');
  return bytes;
}

function writeAtomic(directory, filename, bytes) {
  const destination = path.join(directory, filename);
  if (fs.existsSync(destination)) fail('archive_name_collision');
  const temporary = path.join(directory, `.${filename}.${crypto.randomUUID()}.pending`);
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } catch (error) { try { fs.closeSync(fd); } catch {} try { fs.unlinkSync(temporary); } catch {} throw error; }
  fs.closeSync(fd);
  fs.renameSync(temporary, destination);
  const dirFd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  return destination;
}

export function listIndependentBackups(targetDir) {
  const directory = regularDirectory(targetDir);
  const entries = [];
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith('.yenobk.manifest.json')) continue;
    const manifestPath = path.join(directory, name);
    const manifest = validateManifest(JSON.parse(readBoundedFile(manifestPath, MAX_MANIFEST_BYTES).toString('utf8')));
    if (manifestFilename(manifest.archiveFilename) !== name) fail('manifest_filename_mismatch');
    const archivePath = path.join(directory, manifest.archiveFilename);
    const archive = readBoundedFile(archivePath, MAX_ARCHIVE_BYTES);
    if (archive.length !== manifest.bytes || digest(archive) !== manifest.archiveSha256) fail('archive_hash_mismatch');
    entries.push({manifestPath, archivePath, manifest});
  }
  entries.sort((a, b) => Date.parse(b.manifest.archiveCreatedAt) - Date.parse(a.manifest.archiveCreatedAt) || a.manifest.archiveSha256.localeCompare(b.manifest.archiveSha256));
  return entries;
}

export async function storeIndependentBackup({archive, targetDir, sourcePath, sourceRef, verifyArchive, at = new Date().toISOString(), maxBackups = DEFAULT_MAX_BACKUPS, prune = false} = {}) {
  if (!Buffer.isBuffer(archive) || archive.length <= 36) fail('archive_required');
  if (archive.length > 16 * 1024 * 1024 + 36) fail('archive_too_large');
  timestamp(at); safeSourceRef(sourceRef);
  if (!Number.isSafeInteger(maxBackups) || maxBackups < 1 || maxBackups > 100) fail('invalid_retention_limit');
  if (typeof verifyArchive !== 'function') fail('archive_verifier_required');
  const directory = assertIndependentStorage({sourcePath, targetDir});
  const verification = validateVerification(await verifyArchive(Buffer.from(archive)));
  const archiveSha256 = digest(archive);
  const existing = listIndependentBackups(directory).find(item => item.manifest.archiveSha256 === archiveSha256);
  if (existing) return {stored: false, reused: true, archivePath: existing.archivePath, manifestPath: existing.manifestPath, manifest: existing.manifest, pruned: 0};
  const archiveFilename = backupFilename(at, archiveSha256);
  const manifest = {
    version: RETENTION_VERSION,
    archiveFilename,
    archiveSha256,
    bytes: archive.length,
    verifiedAt: new Date().toISOString(),
    archiveCreatedAt: verification.createdAt,
    sourceRef,
    verification
  };
  const archivePath = writeAtomic(directory, archiveFilename, archive);
  let manifestPath;
  try { manifestPath = writeAtomic(directory, manifestFilename(archiveFilename), Buffer.from(JSON.stringify(manifest, null, 2) + '\n')); }
  catch (error) { try { fs.unlinkSync(archivePath); } catch {} throw error; }
  let pruned = 0;
  if (prune) {
    const entries = listIndependentBackups(directory);
    for (const entry of entries.slice(maxBackups)) {
      if (entry.archivePath === archivePath) continue;
      fs.unlinkSync(entry.manifestPath);
      fs.unlinkSync(entry.archivePath);
      pruned++;
    }
  }
  return {stored: true, reused: false, archivePath, manifestPath, manifest, pruned};
}

export async function verifyStoredBackup({manifestPath, verifyArchive} = {}) {
  const manifestFile = regularFile(manifestPath, MAX_MANIFEST_BYTES);
  const manifest = validateManifest(JSON.parse(readBoundedFile(manifestFile, MAX_MANIFEST_BYTES).toString('utf8')));
  if (typeof verifyArchive !== 'function') fail('archive_verifier_required');
  const archivePath = path.join(path.dirname(manifestFile), manifest.archiveFilename);
  const archive = readBoundedFile(archivePath, MAX_ARCHIVE_BYTES);
  if (archive.length !== manifest.bytes || digest(archive) !== manifest.archiveSha256) fail('archive_hash_mismatch');
  const verification = validateVerification(await verifyArchive(Buffer.from(archive)));
  if (verification.createdAt !== manifest.archiveCreatedAt || verification.revision !== manifest.verification.revision) fail('archive_verification_mismatch');
  return {manifestPath: manifestFile, archivePath, manifest, verification};
}
