import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { initialState, openStore, digest } from '../lib/store.mjs';
import { exportBackup, decryptBackup, restoreBackup, BACKUP_MAX_PLAINTEXT_BYTES, BACKUP_MAX_ARCHIVE_BYTES, BACKUP_MAX_ARTIFACTS } from '../lib/backup.mjs';

const at = '2026-01-01T00:00:00.000Z';
const key = crypto.randomBytes(32);
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yeno-backup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'original'); fs.mkdirSync(dataDir); fs.mkdirSync(path.join(dataDir, 'artifacts'));
  const state = initialState(), jobId = crypto.randomUUID(), artifactId = crypto.randomUUID(), deviceId = crypto.randomUUID(), content = Buffer.from('# 실제 문서\n\n보존할 내용입니다.\n');
  state.revision = 17;
  state.modules.ai = true;
  state.memories.push({ id: crypto.randomUUID(), text: '기억을 보존한다', createdAt: at });
  state.snapshots.push({ id: crypto.randomUUID(), label: '기억 저장', createdAt: at, data: { memories: structuredClone(state.memories), settings: { concurrency: 1, modules: structuredClone(state.modules) } } });
  state.events.push({ id: crypto.randomUUID(), at, text: 'A completed operation.' });
  const project = { id: crypto.randomUUID(), name: 'YENO', repositoryUrl: 'https://github.com/wooyeonho/yeno-os', summary: '개인 운영체제', nextAction: '복구 검증', status: 'active', version: 1, createdAt: at, updatedAt: at, milestones: [] };
  state.projects.push(project);
  state.sources.push({ id: crypto.randomUUID(), url: 'https://nodejs.org/api/crypto.html', canonicalUrl: 'https://nodejs.org/api/crypto.html', title: 'Node crypto', projectId: project.id, readingStatus: 'read', decision: 'candidate', summary: 'AES GCM', application: '암호화 백업', riskNotes: '원문 라이선스와 민감 정보 보관 조건 확인 필요', version: 1, createdAt: at, updatedAt: at });
  const job = { id: jobId, title: '문서 만들기', type: 'document', input: '실제 입력', status: 'completed', step: 3, totalSteps: 3, createdAt: at, updatedAt: at, error: null, version: 4, artifacts: [{ id: artifactId, name: 'document.md' }], projectId: project.id, sourceId: state.sources[0].id, sourceReport: true, normalized: '실제 입력', inputSha256: digest('실제 입력') };
  state.jobs.push(job);
  state.artifacts[artifactId] = { id: artifactId, name: 'document.md', filename: `${artifactId}.md`, sha256: digest(content), bytes: content.length, jobId };
  state.devices[deviceId] = { id: deviceId, name: 'Phone', platform: 'android', tokenHash: digest('device-secret'), createdAt: at, lastSeenAt: at, revokedAt: null };
  state.requests['saved-command'] = { hash: digest('idempotency-request'), status: 201, payload: { job: { id: jobId, status: 'queued' } } };
  state.requests['saved-enrollment'] = { hash: digest('enrollment-request'), status: 201, payload: { device: { id: deviceId, name: 'Phone', platform: 'android', createdAt: at, deviceToken: 'legacy-raw-token-never-export' } } };
  const filename = path.join(dataDir, 'artifacts', `${artifactId}.md`); fs.writeFileSync(filename, content);
  fs.writeFileSync(path.join(dataDir, 'pairing-token'), 'OWNER-SECRET-NEVER-EXPORT');
  fs.writeFileSync(path.join(dataDir, 'runtime.lock'), 'LOCK-NEVER-EXPORT');
  fs.writeFileSync(path.join(dataDir, 'artifacts', 'unreferenced.md'), 'UNREFERENCED-NEVER-EXPORT');
  return { root, dataDir, state, job, artifactId, deviceId, filename, content, export: () => exportBackup({ state, dataDir, key }) };
}
function reencrypt(payload) {
  const iv = crypto.randomBytes(12), magic = Buffer.from('YENOBK1\n'), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(magic); const content = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return Buffer.concat([magic, iv, cipher.getAuthTag(), content]);
}
function queuedJob(status, step) {
  return { id: crypto.randomUUID(), title: '맡긴 작업', type: 'document', input: '보존할 입력', status, step, totalSteps: 3, createdAt: at, updatedAt: at, error: null, version: 3, artifacts: [], ...(step >= 1 ? { normalized: '보존할 입력', inputSha256: digest('보존할 입력') } : {}), ...(step >= 2 ? { draft: '# 저장된 초안\n' } : {}) };
}

test('encrypted snapshot preserves full state and referenced bytes, omits raw enrollment and unrelated files', t => {
  const f = fixture(t), before = structuredClone(f.state), archive = f.export(), another = f.export();
  assert.notDeepEqual(archive, another, 'each backup uses a fresh IV');
  assert.equal(archive.subarray(0, 8).toString(), 'YENOBK1\n');
  const restored = decryptBackup(archive, key), expected = structuredClone(before);
  delete expected.requests['saved-enrollment'].payload.device.deviceToken;
  assert.deepEqual(restored.state, expected);
  assert.deepEqual(f.state, before, 'export does not mutate live state');
  assert.deepEqual(restored.artifacts, [{ filename: `${f.artifactId}.md`, content: f.content.toString('base64') }]);
  const decoded = JSON.stringify(restored);
  for (const secret of ['legacy-raw-token-never-export', 'OWNER-SECRET-NEVER-EXPORT', 'LOCK-NEVER-EXPORT', 'UNREFERENCED-NEVER-EXPORT']) {
    assert.equal(decoded.includes(secret), false); assert.equal(archive.includes(Buffer.from(secret)), false);
  }
  assert.throws(() => exportBackup({ state: f.state, dataDir: f.dataDir, key: 'not-a-binary-key' }), /32 random bytes/);
});

test('clean restore preserves histories, stops work and AI, revokes old devices, and produces a readable durable store', t => {
  const f = fixture(t), queued = queuedJob('queued', 1), running = queuedJob('running', 2), paused = queuedJob('paused', 0);
  paused.pauseReason = 'owner'; f.state.jobs.push(queued, running, paused);
  const revokedId = crypto.randomUUID();
  f.state.devices[revokedId] = { ...f.state.devices[f.deviceId], id: revokedId, revokedAt: at };
  const archive = f.export(), targetDir = path.join(f.root, 'restored'), summary = restoreBackup({ archive, key, targetDir });
  assert.equal(summary.jobs, 4); assert.equal(summary.artifacts, 1); assert.equal(summary.pausedJobCount, 2); assert.equal(summary.revokedDeviceCount, 1);
  assert.equal(summary.serverStarted, false); assert.equal(summary.pairingSecretImported, false);
  const recovered = openStore(targetDir).state;
  assert.equal(recovered.revision, 18); assert.equal(recovered.emergencyStop, true); assert.equal(recovered.modules.ai, false);
  for (const job of [queued, running]) {
    const copy = recovered.jobs.find(item => item.id === job.id);
    assert.equal(copy.status, 'paused'); assert.equal(copy.pauseReason, 'backupRestore'); assert.equal(copy.version, job.version + 1);
    assert.equal(copy.input, job.input); assert.equal(copy.draft, job.draft);
  }
  assert.deepEqual(recovered.jobs.find(job => job.id === paused.id), paused);
  assert.deepEqual(recovered.jobs[0], f.job);
  assert.equal(recovered.devices[f.deviceId].revokedAt, summary.restoredAt); assert.equal(recovered.devices[revokedId].revokedAt, at);
  for (const name of ['projects', 'sources', 'memories', 'snapshots', 'artifacts']) assert.deepEqual(recovered[name], f.state[name]);
  assert.deepEqual(recovered.requests['saved-command'], f.state.requests['saved-command']);
  assert.equal(Object.hasOwn(recovered.requests['saved-enrollment'].payload.device, 'deviceToken'), false);
  assert.deepEqual(recovered.events.slice(1), f.state.events); assert.match(recovered.events[0].text, /Fresh owner key\/device enrollment required/);
  assert.equal(digest(fs.readFileSync(path.join(targetDir, 'artifacts', `${f.artifactId}.md`))), digest(f.content));
  assert.equal(fs.existsSync(path.join(targetDir, 'pairing-token')), false); assert.equal(fs.existsSync(path.join(targetDir, 'restore-in-progress')), false);
  assert.equal(fs.statSync(targetDir).mode & 0o777, 0o700); assert.equal(fs.statSync(path.join(targetDir, 'state.json')).mode & 0o777, 0o600);
});

test('wrong keys, authenticated envelope tampering and truncation fail before creating a restore directory', t => {
  const f = fixture(t), archive = f.export(), badInputs = [archive.subarray(0, 35), archive.subarray(0, archive.length - 1)];
  for (const offset of [0, 8, 20, 36, archive.length - 1]) { const damaged = Buffer.from(archive); damaged[offset] ^= 1; badInputs.push(damaged); }
  const targetDir = path.join(f.root, 'must-not-exist');
  assert.throws(() => restoreBackup({ archive, key: crypto.randomBytes(32), targetDir }), /authentication failed/);
  for (const bad of badInputs) assert.throws(() => restoreBackup({ archive: bad, key, targetDir }), /Backup:/);
  assert.equal(fs.existsSync(targetDir), false);
});

test('authenticated but invalid metadata, paths, references and credentials are refused before writes', t => {
  const f = fixture(t), pristine = decryptBackup(f.export(), key), targetDir = path.join(f.root, 'invalid-restore');
  const cases = [
    payload => { payload.artifacts[0].filename = '../state.json'; },
    payload => { payload.state.artifacts[f.artifactId].filename = '../../pairing-token'; },
    payload => { payload.artifacts.push(structuredClone(payload.artifacts[0])); },
    payload => { payload.artifacts[0].content = Buffer.from('bad bytes').toString('base64'); },
    payload => { payload.artifacts[0].content = payload.artifacts[0].content.replace(/.$/, '!'); },
    payload => { payload.state.artifacts[f.artifactId].jobId = crypto.randomUUID(); },
    payload => { payload.state.artifacts[f.artifactId].name = 'wrong-name'; },
    payload => { delete payload.state.artifacts[f.artifactId]; },
    payload => { payload.state.jobs[0].artifacts = []; },
    payload => { payload.state.jobs.push(structuredClone(payload.state.jobs[0])); },
    payload => { payload.state.jobs[0].inputSha256 = digest('different input'); },
    payload => { payload.state.jobs.push(queuedJob('queued', 2)); delete payload.state.jobs[1].draft; },
    payload => { payload.state.devices[f.deviceId].tokenHash = 'not-a-hash'; },
    payload => { payload.state.devices[f.deviceId].deviceToken = 'raw-device-credential'; },
    payload => { payload.state.requests['saved-enrollment'].payload.device.deviceToken = 'raw-device-credential'; },
    payload => { payload.state.apiKey = 'provider-secret'; },
    payload => { payload.state.sources[0].projectId = crypto.randomUUID(); },
  ];
  for (const change of cases) {
    const payload = structuredClone(pristine); change(payload);
    assert.throws(() => restoreBackup({ archive: reencrypt(payload), key, targetDir }));
    assert.equal(fs.existsSync(targetDir), false);
  }
});

test('backup refuses missing or corrupted referenced files', t => {
  const f = fixture(t);
  fs.unlinkSync(f.filename); assert.throws(f.export, /ENOENT/);
  fs.writeFileSync(f.filename, Buffer.alloc(f.content.length, 65)); assert.throws(f.export, /checksum mismatch/);
  fs.writeFileSync(f.filename, 'too short'); assert.throws(f.export, /matching size/);
  fs.rmSync(path.join(f.dataDir, 'artifacts'), { recursive: true }); assert.throws(f.export, /ENOENT/);
});

test('backup rejects symlinked data or artifact paths and hardlinked artifacts', t => {
  const f = fixture(t), saved = path.join(f.root, 'saved.md'); fs.copyFileSync(f.filename, saved);
  fs.unlinkSync(f.filename); fs.symlinkSync(saved, f.filename); assert.throws(f.export, /regular unlinked file/);
  fs.unlinkSync(f.filename); fs.linkSync(saved, f.filename); assert.throws(f.export, /regular unlinked file/);
  fs.unlinkSync(f.filename); fs.copyFileSync(saved, f.filename);
  const linkedData = path.join(f.root, 'linked-data'); fs.symlinkSync(f.dataDir, linkedData);
  assert.throws(() => exportBackup({ state: f.state, dataDir: linkedData, key }), /directory must be real/);
  fs.renameSync(path.join(f.dataDir, 'artifacts'), path.join(f.root, 'real-artifacts'));
  fs.symlinkSync(path.join(f.root, 'real-artifacts'), path.join(f.dataDir, 'artifacts'));
  assert.throws(f.export, /directory must be real/);
});

test('restore refuses existing targets, symlink parents and target links without touching originals', t => {
  const f = fixture(t), archive = f.export(), targetDir = path.join(f.root, 'existing');
  fs.mkdirSync(targetDir); fs.writeFileSync(path.join(targetDir, 'keep'), 'KEEP');
  assert.throws(() => restoreBackup({ archive, key, targetDir }), /EEXIST/); assert.equal(fs.readFileSync(path.join(targetDir, 'keep'), 'utf8'), 'KEEP');
  const empty = path.join(f.root, 'empty'); fs.mkdirSync(empty); assert.throws(() => restoreBackup({ archive, key, targetDir: empty }), /EEXIST/);
  const link = path.join(f.root, 'target-link'); fs.symlinkSync(targetDir, link); assert.throws(() => restoreBackup({ archive, key, targetDir: link }), /EEXIST/);
  const linkedParent = path.join(f.root, 'parent-link'); fs.symlinkSync(targetDir, linkedParent);
  assert.throws(() => restoreBackup({ archive, key, targetDir: path.join(linkedParent, 'new') }), /directory must be real/);
  assert.equal(fs.existsSync(path.join(targetDir, 'new')), false);
});

test('backup and decode enforce archive, plaintext, artifact size and count bounds before reads', t => {
  const f = fixture(t);
  assert.throws(() => decryptBackup(Buffer.alloc(BACKUP_MAX_ARCHIVE_BYTES + 1), key), /size/);
  f.state.events[0].text = 'x'.repeat(BACKUP_MAX_PLAINTEXT_BYTES);
  assert.throws(f.export, /16 MiB/); f.state.events[0].text = 'event';
  const metadata = f.state.artifacts[f.artifactId]; metadata.bytes = BACKUP_MAX_PLAINTEXT_BYTES + 1;
  assert.throws(f.export, /artifact metadata/);
  metadata.bytes = 13 * 1024 * 1024;
  assert.throws(f.export, /16 MiB/, 'base64 expansion is checked before opening the file');
  for (let n = 0; n <= BACKUP_MAX_ARTIFACTS; n++) {
    const id = crypto.randomUUID();
    f.state.artifacts[id] = { id, filename: `${id}.md`, name: 'empty.md', bytes: 0, sha256: digest(''), jobId: f.job.id };
    f.job.artifacts.push({ id, name: 'empty.md' });
  }
  assert.throws(f.export, /artifact count/);
});

test('valid long job input and zero-artifact empty stores roundtrip within the declared runtime limits', t => {
  const f = fixture(t), long = queuedJob('queued', 0); long.input = 'a'.repeat(80000); f.state.jobs.push(long);
  assert.equal(decryptBackup(f.export(), key).state.jobs[1].input.length, 80000);
  const empty = path.join(f.root, 'empty-source'); fs.mkdirSync(empty);
  const archive = exportBackup({ state: initialState(), dataDir: empty, key });
  assert.deepEqual(decryptBackup(archive, key).artifacts, []);
  const targetDir = path.join(f.root, 'empty-restored'); restoreBackup({ archive, key, targetDir });
  assert.equal(openStore(targetDir).state.emergencyStop, true);
  fs.symlinkSync(path.join(f.root, 'missing-target'), path.join(empty, 'artifacts'));
  assert.throws(() => exportBackup({ state: initialState(), dataDir: empty, key }), /directory must be real/);
});

test('restore write and fsync failures remove partial commits, and incomplete restore sentinels block startup', t => {
  const f = fixture(t), archive = f.export();
  for (const fault of ['write', 'fsync']) {
    const targetDir = path.join(f.root, `failure-${fault}`), original = fault === 'write' ? fs.writeFileSync : fs.fsyncSync;
    let calls = 0;
    const replacement = (...args) => { calls++; if (calls === (fault === 'write' ? 3 : 9)) throw new Error('injected restore disk failure'); return original(...args); };
    if (fault === 'write') fs.writeFileSync = replacement; else fs.fsyncSync = replacement;
    try { assert.throws(() => restoreBackup({ archive, key, targetDir }), /injected restore disk failure/); }
    finally { if (fault === 'write') fs.writeFileSync = original; else fs.fsyncSync = original; }
    assert.equal(fs.existsSync(path.join(targetDir, 'state.json')), false);
    assert.equal(fs.existsSync(path.join(targetDir,'restore-in-progress')),true);
    assert.throws(()=>openStore(targetDir),/restore.*incomplete|incomplete.*restore/i);
  }
  const blocked = path.join(f.root, 'interrupted'); fs.mkdirSync(blocked); fs.writeFileSync(path.join(blocked, 'restore-in-progress'), 'pending');
  assert.throws(() => openStore(blocked), /restore.*incomplete|incomplete.*restore/i);
  const complete = path.join(f.root, 'complete'); restoreBackup({ archive, key, targetDir: complete });
  fs.writeFileSync(path.join(complete, 'restore-in-progress'), 'pending'); assert.throws(() => openStore(complete), /restore.*incomplete|incomplete.*restore/i);
});

test('failed cleanup keeps the incomplete restore guard and never deletes unknown target files', t => {
  const f = fixture(t), archive = f.export(), targetDir = path.join(f.root, 'cleanup-failed');
  const originalSync = fs.fsyncSync, originalUnlink = fs.unlinkSync;
  let syncCalls = 0;
  fs.fsyncSync = (...args) => { if (++syncCalls === 9) throw new Error('injected post-commit failure'); return originalSync(...args); };
  fs.unlinkSync = filename => { if (filename === path.join(targetDir, 'state.json')) { const error = new Error('injected unlink refusal'); error.code = 'EACCES'; throw error; } return originalUnlink(filename); };
  try { assert.throws(() => restoreBackup({ archive, key, targetDir }), /post-commit failure/); }
  finally { fs.fsyncSync = originalSync; fs.unlinkSync = originalUnlink; }
  assert.equal(fs.existsSync(path.join(targetDir, 'state.json')), true);
  assert.equal(fs.existsSync(path.join(targetDir, 'restore-in-progress')), true);
  assert.throws(() => openStore(targetDir), /restore.*incomplete|incomplete.*restore/i);
  const unexpectedTarget = path.join(f.root, 'unexpected-file');
  let injected = false;
  fs.fsyncSync = (...args) => { if (!injected) { injected = true; fs.writeFileSync(path.join(unexpectedTarget, 'foreign-data'), 'PRESERVE'); } return originalSync(...args); };
  try { assert.throws(() => restoreBackup({ archive, key, targetDir: unexpectedTarget }), /unexpected files/); }
  finally { fs.fsyncSync = originalSync; }
  assert.equal(fs.readFileSync(path.join(unexpectedTarget, 'foreign-data'), 'utf8'), 'PRESERVE');
  assert.throws(() => openStore(unexpectedTarget), /restore.*incomplete|incomplete.*restore/i);
});
