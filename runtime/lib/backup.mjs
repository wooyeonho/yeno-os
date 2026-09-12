import {validateWorldSnapshot} from './world.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { acquireRuntimeLock, digest } from './store.mjs';
import { validateProjectRegistry } from './projects.mjs';
import { validateSourceRegistry } from './sources.mjs';
import { validateRequestLedger } from './request-ledger.mjs';
import { validateDiscovery } from './discovery.mjs';
import { validateEcosystem } from './ecosystem.mjs';
import { validateAgentJournal, recoverAgentJournals } from './agent.mjs';
import {validateBotAssignment} from './project-bots.mjs';
import {validateQuestState} from './quests.mjs';
import {emptyStudio,validateStudio} from './studio.mjs';
import {validateVideoInput} from './video.mjs';
import {validateForAiInput} from './forai.mjs';

export const BACKUP_MAX_PLAINTEXT_BYTES = 16 * 1024 * 1024;
export const BACKUP_MAX_ARCHIVE_BYTES = BACKUP_MAX_PLAINTEXT_BYTES + 36;
export const BACKUP_MAX_ARTIFACTS = 10000;
const MAGIC = Buffer.from('YENOBK1\n');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const STATE_KEYS = ['revision', 'emergencyStop', 'concurrency', 'modules', 'jobs', 'memories', 'snapshots', 'events', 'requests', 'artifacts', 'devices', 'projects', 'sources'];
const JOB_KEYS = ['id', 'title', 'type', 'input', 'status', 'step', 'totalSteps', 'createdAt', 'updatedAt', 'error', 'version', 'artifacts', 'projectId', 'sourceId', 'projectReport', 'sourceReport', 'operatingReport', 'normalized', 'inputSha256', 'draft', 'pauseReason', 'agentJournal', 'botAssignment', 'worldSnapshot', 'selectedProvider', 'questId', 'callLimit', 'deadlineAt', 'productionEvidence', 'studioSeriesId', 'studioChapterId'];
const fail = message => { throw new Error(`Backup: ${message}`); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const string = (value, max = BACKUP_MAX_PLAINTEXT_BYTES) => typeof value === 'string' && value.length <= max;
function keys(value, allowed, required = allowed) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail('invalid record fields');
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('invalid timestamp');
}
function modules(value) {
  keys(value, ['memory', 'documents', 'diagnostics', 'ai']);
  if (Object.values(value).some(item => typeof item !== 'boolean')) fail('invalid modules');
}
function memories(value) {
  if (!Array.isArray(value)) fail('invalid memory list');
  const ids = new Set();
  for (const memory of value) {
    keys(memory, ['id', 'text', 'createdAt']);
    if (!UUID.test(memory.id) || ids.has(memory.id) || !string(memory.text, 20000)) fail('invalid memory');
    timestamp(memory.createdAt); ids.add(memory.id);
  }
}
function validateState(state) {
  keys(state, [...STATE_KEYS, 'requestLedger', 'discovery', 'ecosystem', 'quests', 'outcomes', 'studio'], STATE_KEYS);
  if (!Object.hasOwn(state, 'quests')) state.quests = [];
  if (!Object.hasOwn(state, 'outcomes')) state.outcomes = [];
  if (!Object.hasOwn(state, 'studio')) state.studio = emptyStudio();
  validateStudio(state.studio);
  validateQuestState(state);
  validateRequestLedger(state);
  if (Object.hasOwn(state, 'ecosystem')) validateEcosystem(state.ecosystem);
  if (Object.hasOwn(state, 'discovery')) validateDiscovery(state.discovery);
  if (!integer(state.revision, 0, Number.MAX_SAFE_INTEGER - 1) || typeof state.emergencyStop !== 'boolean' || !integer(state.concurrency, 1, 3)) fail('invalid runtime settings');
  modules(state.modules); memories(state.memories);
  validateProjectRegistry(state.projects); validateSourceRegistry(state.sources, state.projects);
  if (!Array.isArray(state.jobs) || !Array.isArray(state.snapshots) || !Array.isArray(state.events) || !record(state.requests) || !record(state.devices) || !record(state.artifacts)) fail('invalid state collections');
  const jobs = new Map(), references = new Set();
  for (const job of state.jobs) {
    keys(job, JOB_KEYS, ['id', 'title', 'type', 'input', 'status', 'step', 'totalSteps', 'createdAt', 'updatedAt', 'error', 'version', 'artifacts']);
    if (!UUID.test(job.id) || jobs.has(job.id) || !string(job.title, 160) || !string(job.input, job.type==='forai'?160000:80000) || !['document', 'diagnostics', 'evolution', 'ai', 'agent', 'world', 'video', 'forai'].includes(job.type) || !['queued', 'running', 'paused', 'completed', 'failed', 'cancelled'].includes(job.status) || !integer(job.step, 0, 3) || job.totalSteps !== 3 || !integer(job.version, 1, Number.MAX_SAFE_INTEGER - 1) || !Array.isArray(job.artifacts) || (job.error !== null && !string(job.error))) fail('invalid job');
    if(job.type==='video')validateVideoInput(JSON.parse(job.input));
    if(job.type==='forai')validateForAiInput(JSON.parse(job.input));
    if(Object.hasOwn(job,'productionEvidence')&&(job.type!=='forai'||!record(job.productionEvidence)||Buffer.byteLength(JSON.stringify(job.productionEvidence))>65536))fail('invalid production evidence');
    if(Object.hasOwn(job,'studioSeriesId')&&(job.type!=='agent'||!state.studio.series.some(item=>item.id===job.studioSeriesId)))fail('invalid novel series reference');
    if(Object.hasOwn(job,'studioChapterId')&&(!job.studioSeriesId||!state.studio.chapters.some(item=>item.id===job.studioChapterId&&item.seriesId===job.studioSeriesId)))fail('invalid novel chapter reference');
    if (job.agentJournal) validateAgentJournal(job.agentJournal);
    if (Object.hasOwn(job, 'selectedProvider') && !['openai', 'gemini', 'moonshot', 'xai', 'anthropic', 'nvidia'].includes(job.selectedProvider)) fail('invalid selected provider');
    if (Object.hasOwn(job, 'questId') && (typeof job.questId !== 'string' || !UUID.test(job.questId))) fail('invalid job quest reference');
    if (Object.hasOwn(job, 'callLimit') && !integer(job.callLimit, 1, 4)) fail('invalid job call limit');
    if (Object.hasOwn(job, 'deadlineAt')) timestamp(job.deadlineAt);
    if (Object.hasOwn(job, 'worldSnapshot')) { if (job.type !== 'world') fail('invalid world job'); validateWorldSnapshot(job.worldSnapshot); }
    if (job.type === 'world' && job.step >= 2 && !job.worldSnapshot) fail('missing world checkpoint');
    validateBotAssignment(job);
    timestamp(job.createdAt); timestamp(job.updatedAt);
    if (Date.parse(job.updatedAt) < Date.parse(job.createdAt)) fail('invalid job timestamp order');
    if (job.status === 'completed' && (job.step !== 3 || job.artifacts.length === 0)) fail('invalid completed job');
    if (['queued', 'running', 'paused'].includes(job.status) && job.step === 3) fail('invalid unfinished job');
    if (['queued', 'running', 'paused'].includes(job.status) && job.step >= 1 && (!string(job.normalized) || !HASH.test(job.inputSha256))) fail('missing job checkpoint');
    if (['queued', 'running', 'paused'].includes(job.status) && job.step === 2 && !string(job.draft)) fail('missing job draft checkpoint');
    for (const name of ['normalized', 'draft', 'pauseReason']) if (Object.hasOwn(job, name) && !string(job[name])) fail('invalid job text');
    if (Object.hasOwn(job, 'inputSha256') && (!HASH.test(job.inputSha256) || job.inputSha256 !== digest(job.input))) fail('invalid job input hash');
    for (const name of ['sourceReport', 'operatingReport']) if (Object.hasOwn(job, name) && typeof job[name] !== 'boolean') fail('invalid job flag');
    if (Object.hasOwn(job, 'projectReport') && !string(job.projectReport, 80)) fail('invalid project report');
    if (Object.hasOwn(job, 'projectId') && !state.projects.some(project => project.id === job.projectId)) fail('unknown job project');
    if (Object.hasOwn(job, 'sourceId') && !state.sources.some(source => source.id === job.sourceId)) fail('unknown job source');
    for (const artifact of job.artifacts) {
      keys(artifact, ['id', 'name']);
      if (!UUID.test(artifact.id) || references.has(artifact.id) || !string(artifact.name, 160)) fail('invalid job artifact reference');
      references.add(artifact.id);
    }
    jobs.set(job.id, job);
  }
  const artifactEntries = Object.entries(state.artifacts);
  if (artifactEntries.length > BACKUP_MAX_ARTIFACTS || artifactEntries.length !== references.size) fail('invalid artifact count or references');
  for (const [id, artifact] of artifactEntries) {
    keys(artifact, ['id', 'name', 'filename', 'sha256', 'bytes', 'jobId','mimeType'], ['id','name','filename','sha256','bytes','jobId']);
    const extension=artifact.mimeType==='video/mp4'?'mp4':artifact.mimeType==='application/json'?'json':'md';
    if(Object.hasOwn(artifact,'mimeType')&&!['video/mp4','application/json'].includes(artifact.mimeType))fail('invalid artifact media type');
    if (!UUID.test(id) || artifact.id !== id || artifact.filename !== `${id}.${extension}` || !HASH.test(artifact.sha256) || !integer(artifact.bytes, 0, BACKUP_MAX_PLAINTEXT_BYTES) || !string(artifact.name, 160) || !jobs.has(artifact.jobId) || !jobs.get(artifact.jobId).artifacts.some(item => item.id === id && item.name === artifact.name)) fail('invalid artifact metadata');
    if(extension==='mp4'&&jobs.get(artifact.jobId).type!=='video')fail('video artifact on non-video job');
  }
  for (const id of references) if (!Object.hasOwn(state.artifacts, id)) fail('missing artifact metadata');
  const snapshotIds = new Set();
  for (const snapshot of state.snapshots) {
    keys(snapshot, ['id', 'label', 'createdAt', 'data']);
    if (!UUID.test(snapshot.id) || snapshotIds.has(snapshot.id) || !string(snapshot.label, 160)) fail('invalid snapshot');
    timestamp(snapshot.createdAt); keys(snapshot.data, ['memories', 'settings']); memories(snapshot.data.memories);
    keys(snapshot.data.settings, ['concurrency', 'modules']); modules(snapshot.data.settings.modules);
    if (!integer(snapshot.data.settings.concurrency, 1, 3)) fail('invalid snapshot concurrency');
    snapshotIds.add(snapshot.id);
  }
  const eventIds = new Set();
  for (const event of state.events) {
    keys(event, ['id', 'at', 'text']);
    if (!UUID.test(event.id) || eventIds.has(event.id) || !string(event.text)) fail('invalid event');
    timestamp(event.at); eventIds.add(event.id);
  }
  for (const [requestId, receipt] of Object.entries(state.requests)) {
    keys(receipt, ['hash', 'status', 'payload']);
    if (!string(requestId, 160) || !requestId.trim() || !HASH.test(receipt.hash) || !integer(receipt.status, 200, 299) || !record(receipt.payload)) fail('invalid request receipt');
    if (record(receipt.payload.device) && Object.hasOwn(receipt.payload.device, 'deviceToken')) fail('raw enrollment credential in receipt');
  }
  for (const [id, device] of Object.entries(state.devices)) {
    keys(device, ['id', 'name', 'platform', 'tokenHash', 'createdAt', 'lastSeenAt', 'revokedAt']);
    if (!UUID.test(id) || device.id !== id || !string(device.name, 80) || !string(device.platform, 40) || !HASH.test(device.tokenHash)) fail('invalid device');
    timestamp(device.createdAt); timestamp(device.lastSeenAt); if (device.revokedAt !== null) timestamp(device.revokedAt);
  }
}
function checkKey(key) { if (!Buffer.isBuffer(key) || key.length !== 32) fail('key must be exactly 32 random bytes'); }
function realDirectory(directory) {
  const resolved = path.resolve(directory), stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(resolved) !== resolved) fail('directory must be real and contain no symlink components');
  return resolved;
}
function readArtifact(directory, artifact) {
  const filename = path.join(directory, artifact.filename), before = fs.lstatSync(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size !== artifact.bytes) fail('artifact must be a regular unlinked file with matching size');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const current = fs.fstatSync(fd);
    if (!current.isFile() || current.nlink !== 1 || current.dev !== before.dev || current.ino !== before.ino || current.size !== artifact.bytes) fail('artifact changed while opening');
    // Bound the allocation by validated metadata, and require exact bytes. A
    // growing file must not make readFileSync allocate without that bound.
    const content = Buffer.alloc(artifact.bytes);
    let offset = 0;
    while (offset < content.length) {
      const count = fs.readSync(fd, content, offset, content.length - offset, offset);
      if (!count) fail('artifact truncated during read');
      offset += count;
    }
    const after = fs.fstatSync(fd), pathAfter = fs.lstatSync(filename);
    if (after.size !== current.size || after.nlink !== 1 || after.mtimeMs !== current.mtimeMs || after.ctimeMs !== current.ctimeMs || pathAfter.dev !== current.dev || pathAfter.ino !== current.ino || pathAfter.isSymbolicLink() || digest(content) !== artifact.sha256) fail('artifact changed or checksum mismatch');
    return content;
  } finally { fs.closeSync(fd); }
}
function validateArchive(payload) {
  keys(payload, ['format', 'createdAt', 'state', 'artifacts']);
  if (payload.format !== 1 || !Array.isArray(payload.artifacts) || payload.artifacts.length > BACKUP_MAX_ARTIFACTS) fail('invalid archive format');
  timestamp(payload.createdAt); validateState(payload.state);
  if (payload.artifacts.length !== Object.keys(payload.state.artifacts).length) fail('incomplete archive');
  const seen = new Set();
  for (const file of payload.artifacts) {
    keys(file, ['filename', 'content']);
    if (typeof file.filename !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(?:md|json|mp4)$/.test(file.filename) || seen.has(file.filename)) fail('unsafe or duplicate archive path');
    const metadata = payload.state.artifacts[path.parse(file.filename).name];
    if(metadata?.filename!==file.filename)fail('artifact extension mismatch');
    if (!metadata || typeof file.content !== 'string' || file.content.length !== 4 * Math.ceil(metadata.bytes / 3)) fail('invalid artifact encoding or metadata');
    const content = Buffer.from(file.content, 'base64');
    if (content.length !== metadata.bytes || content.toString('base64') !== file.content || digest(content) !== metadata.sha256) fail('archive artifact checksum mismatch');
    seen.add(file.filename);
  }
  return payload;
}

// The caller holds the runtime lease and calls ensureDurable before this
// synchronous function. No await occurs between snapshot and artifact reads.
export function exportBackup({ state, dataDir, key }) {
  checkKey(key);
  const directory = realDirectory(dataDir);
  const stateJson = JSON.stringify(state);
  if (Buffer.byteLength(stateJson) > BACKUP_MAX_PLAINTEXT_BYTES) fail('plaintext exceeds 16 MiB');
  const snapshot = JSON.parse(stateJson);
  // Older candidates persisted this one raw derived device credential. Retain
  // the idempotency receipt while omitting the raw credential from the archive.
  for (const receipt of Object.values(snapshot.requests ?? {})) {
    if (record(receipt?.payload?.device)) delete receipt.payload.device.deviceToken;
  }
  validateState(snapshot);
  const payload = { format: 1, createdAt: new Date().toISOString(), state: snapshot, artifacts: [] };
  let size = Buffer.byteLength(JSON.stringify(payload));
  if (size > BACKUP_MAX_PLAINTEXT_BYTES) fail('plaintext exceeds 16 MiB');
  const artifactsDir = path.join(directory, 'artifacts');
  let artifactDirectoryExists = false;
  try { fs.lstatSync(artifactsDir); artifactDirectoryExists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (artifactDirectoryExists || Object.keys(snapshot.artifacts).length) realDirectory(artifactsDir);
  for (const artifact of Object.values(snapshot.artifacts)) {
    // Budget JSON overhead and base64 expansion before reading each file.
    size += Buffer.byteLength(JSON.stringify({ filename: artifact.filename, content: '' })) + 1 + 4 * Math.ceil(artifact.bytes / 3);
    if (size > BACKUP_MAX_PLAINTEXT_BYTES) fail('plaintext exceeds 16 MiB');
    payload.artifacts.push({ filename: artifact.filename, content: readArtifact(artifactsDir, artifact).toString('base64') });
  }
  const plaintext = Buffer.from(JSON.stringify(payload));
  if (plaintext.length > BACKUP_MAX_PLAINTEXT_BYTES) fail('plaintext exceeds 16 MiB');
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

export function decryptBackup(archive, key) {
  checkKey(key);
  if (!Buffer.isBuffer(archive) || archive.length <= 36 || archive.length > BACKUP_MAX_ARCHIVE_BYTES || !archive.subarray(0, 8).equals(MAGIC)) fail('invalid archive envelope or size');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, archive.subarray(8, 20));
  decipher.setAAD(MAGIC); decipher.setAuthTag(archive.subarray(20, 36));
  let plaintext;
  try { plaintext = Buffer.concat([decipher.update(archive.subarray(36)), decipher.final()]); }
  catch { fail('authentication failed; wrong key or damaged archive'); }
  let payload;
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)); }
  catch { fail('invalid archive JSON'); }
  return validateArchive(payload);
}

function syncDirectory(directory) {
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function writeExclusive(filename, content, createdFiles) {
  const fd = fs.openSync(filename, 'wx', 0o600);
  createdFiles?.push(filename);
  try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function restoreBackup({ archive, key, targetDir }) {
  // Authentication, checksums and all schema/path checks precede any writes.
  const payload = decryptBackup(archive, key);
  const target = path.resolve(targetDir), parent = realDirectory(path.dirname(target));
  if (target === parent) fail('restore requires a new target directory');
  const state = payload.state, restoredAt = new Date().toISOString();
  let pausedJobCount = 0, revokedDeviceCount = 0;
  state.emergencyStop = true; state.modules.ai = false; state.revision++;
  recoverAgentJournals(state.jobs);
  if(state.ecosystem){state.ecosystem.enabled=false;if(state.ecosystem.lastRun?.status==='running'){state.ecosystem.lastRun.status='interrupted';state.ecosystem.lastRun.finishedAt=restoredAt;}}
  if (state.discovery) {
    state.discovery.enabled = false;
    if (state.discovery.lastRun?.status === 'running') { state.discovery.lastRun.status = 'interrupted'; state.discovery.lastRun.finishedAt = restoredAt; }
  }
  for (const job of state.jobs) if (['queued', 'running'].includes(job.status)) {
    job.status = 'paused'; job.pauseReason = 'backupRestore'; job.updatedAt = restoredAt; job.version++; pausedJobCount++;
  }
  for (const device of Object.values(state.devices)) if (device.revokedAt === null) { device.revokedAt = restoredAt; revokedDeviceCount++; }
  state.events.unshift({ id: crypto.randomUUID(), at: restoredAt, text: `Encrypted backup restored (${payload.createdAt}); emergency stop enabled, AI disabled, ${pausedJobCount} unfinished job(s) paused, ${revokedDeviceCount} active device credential(s) revoked. Fresh owner key/device enrollment required; no server started.` });
  const serialized = JSON.stringify(state), envelope = JSON.stringify({ format: 1, sha256: digest(serialized), payload: serialized });
  const createdFiles = [], artifactDir = path.join(target, 'artifacts'), marker = path.join(target, 'restore-in-progress');
  let owned, madeArtifactDir = false, releaseLock;
  try {
    // mkdir without recursive never adopts or overwrites an existing target.
    fs.mkdirSync(target, { mode: 0o700 }); owned = fs.lstatSync(target);
    if (fs.realpathSync(target) !== target) fail('restore target changed');
    writeExclusive(marker, 'Restore is incomplete. Do not start this data directory.\n');
    syncDirectory(target); syncDirectory(parent);
    // The normal runtime lease prevents a cooperating process from starting
    // between marker creation and commit. Unknown files are never adopted.
    releaseLock = acquireRuntimeLock(target);
    if (fs.readdirSync(target).some(name => !['runtime.lock', 'restore-in-progress'].includes(name))) fail('restore target contains unexpected files');
    fs.mkdirSync(artifactDir, { mode: 0o700 }); madeArtifactDir = true;
    for (const file of payload.artifacts) {
      const destination = path.join(artifactDir, file.filename);
      writeExclusive(destination, Buffer.from(file.content, 'base64'), createdFiles);
    }
    syncDirectory(artifactDir);
    const temporary = path.join(target, 'restore-state.pending');
    writeExclusive(temporary, envelope, createdFiles);
    syncDirectory(target);
    // state.json is the commit marker; artifacts and state bytes are durable
    // before it appears, so a process crash cannot expose a partial state file.
    const committed = path.join(target, 'state.json');
    fs.renameSync(temporary, committed); createdFiles.push(committed);
    syncDirectory(target); syncDirectory(parent);
    fs.unlinkSync(marker); syncDirectory(target);
    releaseLock(); releaseLock = undefined;
  } catch (error) {
    // Only clean files created inside our still-identical new directory. Never
    // remove a preexisting target, an exchanged directory, or unknown files.
    let stillOwned = false;
    try { const current = fs.lstatSync(target); stillOwned = !!owned && !current.isSymbolicLink() && current.dev === owned.dev && current.ino === owned.ino; } catch {}
    if (stillOwned) {
      // Keep/recreate the startup guard while cleaning. If a disk failure or
      // foreign file prevents cleanup, the remaining directory stays blocked.
      try { writeExclusive(marker, 'Restore failed. Do not start this data directory.\n'); } catch {}
      for (const filename of createdFiles.reverse()) { try { fs.unlinkSync(filename); } catch {} }
      if (madeArtifactDir) { try { fs.rmdirSync(artifactDir); } catch {} }
      // Failed destinations remain marked even after complete file cleanup.
      // Removing the marker before rmdir would open a startup race with a core
      // that interprets the now-empty directory as a fresh installation.
      try { syncDirectory(target); } catch {}
      releaseLock?.(); releaseLock = undefined;
    }
    releaseLock?.();
    throw error;
  }
  return { format: 1, createdAt: payload.createdAt, restoredAt, revision: state.revision, jobs: state.jobs.length, artifacts: payload.artifacts.length, projects: state.projects.length, sources: state.sources.length, memories: state.memories.length, pausedJobCount, revokedDeviceCount, emergencyStop: true, aiEnabled: false, pairingSecretImported: false, serverStarted: false };
}
