import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initialState } from '../lib/store.mjs';
import { BACKUP_MAX_PLAINTEXT_BYTES } from '../lib/backup.mjs';
import { VIDEO_LIMITS } from '../lib/video.mjs';
import { assertProductionCapacity, productionCapacity, ProductionCapacityError, PRODUCTION_CAPACITY_HEADROOM_BYTES, FORAI_RESERVED_ARTIFACT_BYTES } from '../lib/production-capacity.mjs';

function job(type = 'video', status = 'queued') { return { id: randomUUID(), type, status, artifacts: [] }; }
function artifact(state, size, type = 'video') {
  const target = job(type, 'completed'), id = randomUUID(); target.artifacts.push({ id, name: 'result.mp4' });
  state.jobs.push(target); state.artifacts[id] = { id, filename: `${id}.mp4`, bytes: size, jobId: target.id };
}
const blocked = error => error instanceof ProductionCapacityError && error.status === 507 && error.code === 'production_backup_capacity';

test('production capacity counts serialized private state and artifact base64 with one MiB headroom without mutation', () => {
  const state = initialState(); artifact(state, 3);
  state.memories.push({ text: '한글 원문' });
  const before = structuredClone(state), summary = productionCapacity(state);
  assert.equal(summary.stateBytes, Buffer.byteLength(JSON.stringify(state)));
  assert.equal(summary.artifactRawBytes, 3);
  assert.ok(summary.artifactArchiveBytes > 4);
  assert.equal(summary.headroomBytes, PRODUCTION_CAPACITY_HEADROOM_BYTES);
  assert.equal(summary.estimatedBytes - summary.estimatedArchiveBytes, 1024 * 1024);
  assert.equal(summary.remainingBytes, BACKUP_MAX_PLAINTEXT_BYTES - summary.estimatedBytes);
  assert.equal(summary.canCreateVideo, true); assert.equal(summary.canCreateForAi, true);
  assert.deepEqual(state, before);
});

test('production capacity reserves every queued/running/paused video once and releases terminal reservations', () => {
  const state = initialState();
  for (const status of ['queued', 'running', 'paused', 'completed', 'cancelled', 'failed']) state.jobs.push(job('video', status));
  const withArtifact = job('video', 'paused'); withArtifact.artifacts.push({ id: randomUUID() }); state.jobs.push(withArtifact);
  state.jobs.push(job('document', 'running'));
  const summary = productionCapacity(state);
  assert.equal(summary.pendingVideoCount, 3);
  assert.equal(summary.pendingArchiveBytes, 3 * (4 * Math.ceil(VIDEO_LIMITS.bytes / 3) + 256));
  assert.equal(summary.artifactArchiveBytes, 0);
});

test('simultaneous pending video admissions cannot oversubscribe the full backup', () => {
  const state = initialState();
  for (let count = 0; count < 5; count++) {
    assertProductionCapacity(state, { reserveVideoBytes: VIDEO_LIMITS.bytes });
    state.jobs.push(job('video', count === 2 ? 'paused' : 'queued'));
  }
  assert.equal(productionCapacity(state).pendingVideoCount, 5);
  assert.equal(productionCapacity(state).canCreateVideo, false);
  const before = structuredClone(state);
  assert.throws(() => assertProductionCapacity(state, { reserveVideoBytes: VIDEO_LIMITS.bytes }), blocked);
  assert.deepEqual(state, before);
  state.jobs[0].status = 'cancelled';
  assert.doesNotThrow(() => assertProductionCapacity(state, { reserveVideoBytes: VIDEO_LIMITS.bytes }));
});

test('pending For-Ai reports and evidence both reserve space and remain counted across pause', () => {
  const state = initialState();
  for (const status of ['queued', 'running', 'paused']) state.jobs.push(job('forai', status));
  const summary = productionCapacity(state);
  assert.equal(summary.pendingForAiCount, 3);
  assert.equal(summary.pendingArchiveBytes, 3 * (4 * Math.ceil(FORAI_RESERVED_ARTIFACT_BYTES / 3) + 512));
  const reserved = assertProductionCapacity(state, { reserveTextBytes: FORAI_RESERVED_ARTIFACT_BYTES });
  assert.equal(reserved.additionalArchiveBytes, 4 * Math.ceil(FORAI_RESERVED_ARTIFACT_BYTES / 3) + 512);
});

test('capacity boundary accepts exact usable limit and rejects the next state byte', () => {
  const state = initialState(); state.capacityPadding = '';
  const initial = productionCapacity(state);
  state.capacityPadding = 'x'.repeat(initial.remainingBytes);
  const exact = assertProductionCapacity(state);
  assert.equal(exact.estimatedBytes, exact.maxBytes);
  assert.equal(exact.remainingBytes, 0);
  assert.equal(exact.canCreateVideo, false); assert.equal(exact.canCreateForAi, false);
  state.capacityPadding += 'x';
  assert.throws(() => assertProductionCapacity(state), blocked);
});

test('existing complete media, not only unfinished jobs, can block new production', () => {
  const state = initialState();
  for (let count = 0; count < 6; count++) artifact(state, VIDEO_LIMITS.bytes);
  const summary = productionCapacity(state);
  assert.equal(summary.pendingVideoCount, 0);
  assert.equal(summary.withinCapacity, false);
  assert.throws(() => assertProductionCapacity(state, { reserveTextBytes: 1 }), blocked);
  assert.ok(summary.estimatedArchiveBytes > BACKUP_MAX_PLAINTEXT_BYTES);
});

test('invalid reservation values and unavailable sizes fail closed with safe public messages', () => {
  for (const value of [-1, 1.5, Infinity, NaN, '100', BACKUP_MAX_PLAINTEXT_BYTES + 1]) {
    assert.throws(() => assertProductionCapacity(initialState(), { reserveVideoBytes: value }), error => error.status === 400);
    assert.throws(() => assertProductionCapacity(initialState(), { reserveTextBytes: value }), error => error.status === 400);
  }
  for (const state of [null, {}, { jobs: [], artifacts: { bad: { filename: 'DO_NOT_LOG_PRIVATE_NAME', bytes: -1 } } }]) assert.throws(() => productionCapacity(state), error => error.status === 507 && error.code === 'production_capacity_unknown' && !error.message.includes('DO_NOT_LOG'));
});
