import { BACKUP_MAX_PLAINTEXT_BYTES } from './backup.mjs';
import { VIDEO_LIMITS } from './video.mjs';

// This is a conservative backup-size admission check, not a filesystem free-space
// probe. Keep room for subsequent state saves, request receipts and stop actions.
// Reservations follow durable unfinished jobs, including owner-paused jobs, so
// a later resume cannot make an already admitted batch exceed the backup limit.
export const PRODUCTION_CAPACITY_HEADROOM_BYTES = 1024 * 1024;
export const FORAI_RESERVED_ARTIFACT_BYTES = 128 * 1024;
export const RESEARCH_RESERVED_ARTIFACT_BYTES = 1536 * 1024;
const ARCHIVE_ENVELOPE_BYTES = 256;
const NEW_ARTIFACT_RECORD_BYTES = 256;
const PENDING = new Set(['queued', 'running', 'paused']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bytes = value => Number.isSafeInteger(value) && value >= 0;
const base64Bytes = size => 4 * Math.ceil(size / 3);
const estimateNewArtifacts = (size, count = 1) => size === 0 ? 0 : base64Bytes(size) + NEW_ARTIFACT_RECORD_BYTES * count;

export class ProductionCapacityError extends Error {
  constructor(message, status = 507, code = 'production_backup_capacity') {
    super(message); this.name = 'ProductionCapacityError'; this.status = status; this.code = code;
  }
}
const unknown = () => { throw new ProductionCapacityError('결과 보관 용량을 확인하지 못해 새 제작을 접수하지 않았습니다. 기존 기록과 백업 상태를 확인하세요.', 507, 'production_capacity_unknown'); };
function optionsChecked({ reserveVideoBytes = 0, reserveTextBytes = 0 } = {}) {
  if (!bytes(reserveVideoBytes) || !bytes(reserveTextBytes) || reserveVideoBytes > BACKUP_MAX_PLAINTEXT_BYTES || reserveTextBytes > BACKUP_MAX_PLAINTEXT_BYTES) {
    throw new ProductionCapacityError('제작 결과의 예약 용량을 확인하세요.', 400, 'invalid_production_reservation');
  }
  return { reserveVideoBytes, reserveTextBytes };
}

function estimate(state, reservation) {
  if (!record(state) || !Array.isArray(state.jobs) || !record(state.artifacts)) unknown();
  let stateBytes;
  try { stateBytes = Buffer.byteLength(JSON.stringify(state), 'utf8'); } catch { unknown(); }
  let artifactRawBytes = 0, artifactArchiveBytes = 0;
  for (const artifact of Object.values(state.artifacts)) {
    if (!record(artifact) || !bytes(artifact.bytes) || artifact.bytes > BACKUP_MAX_PLAINTEXT_BYTES || typeof artifact.filename !== 'string') unknown();
    artifactRawBytes += artifact.bytes;
    artifactArchiveBytes += base64Bytes(artifact.bytes) + Buffer.byteLength(JSON.stringify({ filename: artifact.filename, content: '' }), 'utf8') + 1;
  }
  const pending = state.jobs.filter(job => record(job) && PENDING.has(job.status) && (job.artifacts?.length ?? 0) === 0);
  const pendingVideoCount = pending.filter(job => job.type === 'video').length;
  const pendingForAiCount = pending.filter(job => job.type === 'forai').length;
  const pendingResearchCount = state.jobs.filter(job=>record(job)&&PENDING.has(job.status)&&job.researchRequest).length;
  const pendingArchiveBytes = pendingVideoCount * estimateNewArtifacts(VIDEO_LIMITS.bytes)
    + pendingForAiCount * estimateNewArtifacts(FORAI_RESERVED_ARTIFACT_BYTES, 2)
    + pendingResearchCount * estimateNewArtifacts(RESEARCH_RESERVED_ARTIFACT_BYTES, 4);
  const additionalArchiveBytes = estimateNewArtifacts(reservation.reserveVideoBytes)
    + estimateNewArtifacts(reservation.reserveTextBytes, 2);
  const estimatedArchiveBytes = ARCHIVE_ENVELOPE_BYTES + stateBytes + artifactArchiveBytes + pendingArchiveBytes + additionalArchiveBytes;
  const estimatedBytes = estimatedArchiveBytes + PRODUCTION_CAPACITY_HEADROOM_BYTES;
  const remainingBytes = Math.max(0, BACKUP_MAX_PLAINTEXT_BYTES - estimatedBytes);
  return {
    maxBytes: BACKUP_MAX_PLAINTEXT_BYTES,
    estimatedBytes, estimatedArchiveBytes, headroomBytes: PRODUCTION_CAPACITY_HEADROOM_BYTES,
    remainingBytes, stateBytes, artifactRawBytes, artifactArchiveBytes,
    pendingVideoCount, pendingForAiCount, pendingResearchCount, pendingArchiveBytes, additionalArchiveBytes,
    withinCapacity: estimatedBytes <= BACKUP_MAX_PLAINTEXT_BYTES,
    canCreateVideo: estimatedBytes + estimateNewArtifacts(VIDEO_LIMITS.bytes) <= BACKUP_MAX_PLAINTEXT_BYTES,
    canCreateForAi: estimatedBytes + estimateNewArtifacts(FORAI_RESERVED_ARTIFACT_BYTES, 2) <= BACKUP_MAX_PLAINTEXT_BYTES,
    basis: 'estimated_full_backup_with_pending_results',
  };
}

export function productionCapacity(state) {
  return estimate(state, { reserveVideoBytes: 0, reserveTextBytes: 0 });
}

export function assertProductionCapacity(state, options) {
  const summary = estimate(state, optionsChecked(options));
  if (!summary.withinCapacity) throw new ProductionCapacityError('기존 결과와 대기 중인 제작을 포함하면 전체 백업 용량 한도에 도달합니다. 새 제작은 접수하지 않았습니다. 기존 결과와 전체 백업을 내려받은 뒤 보관 용량을 확장하세요. 내려받기만으로 서버 용량이 줄어들지는 않습니다.');
  return summary;
}
