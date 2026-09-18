import crypto from 'node:crypto';

// BLACKHOLE Real Outcome Verification (pure, no wiring yet).
//
//   executionVerified : the run really produced the artifact it claims
//                       (artifact SHA-256 == capability run outputSha256,
//                       run input == job request). Integrity only.
//   outcomeVerified   : a trusted, structured, external source holds the very
//                       metric/value/unit the evidence claims, linked to the
//                       same quest/job/artifact. Reality, not integrity.
//
// Nothing here grants execution authority, reads secrets or infers a value.
// A model's text, an owner's sentence, "매출 발생" — none of them verify anything.
export const OUTCOME_VERIFICATION_VERSION = 1;
export const EVIDENCE_FIELDS = Object.freeze(['version', 'questId', 'jobId', 'artifactSha256', 'metric', 'value', 'unit', 'sourceType', 'sourceId', 'sourceTimestamp', 'verificationType', 'authority', 'confidence', 'collectedAt', 'fingerprint']);
export const VERIFICATION_TYPES = Object.freeze(['self_reported', 'internal_observed', 'external_structured', 'external_verified']);
export const OUTCOME_VERIFYING_TYPES = Object.freeze(['external_structured', 'external_verified']);
export const HIGH_GRADE_TYPES = Object.freeze(['external_verified']);
export const AUTHORITIES = Object.freeze(['owner', 'runtime', 'model', 'external', 'external_attested']);
// Which authority may carry which verificationType. A model is never an authority for an outcome.
export const TYPE_AUTHORITY = Object.freeze({
  self_reported: Object.freeze(['owner']),
  internal_observed: Object.freeze(['runtime']),
  external_structured: Object.freeze(['external']),
  external_verified: Object.freeze(['external_attested'])
});
export const SOURCE_TYPES = Object.freeze({
  owner_report: Object.freeze({external: false}),
  runtime_record: Object.freeze({external: false}),
  model_output: Object.freeze({external: false}),
  payment_processor: Object.freeze({external: true}),
  bank_statement: Object.freeze({external: true}),
  invoice_ledger: Object.freeze({external: true}),
  package_registry: Object.freeze({external: true}),
  app_store: Object.freeze({external: true}),
  analytics_platform: Object.freeze({external: true}),
  publication_platform: Object.freeze({external: true}),
  award_registry: Object.freeze({external: true}),
  citation_index: Object.freeze({external: true}),
  review_platform: Object.freeze({external: true})
});
// Defined metrics only. Each names its ledger, the units it accepts and the
// external source types allowed to verify it. Anything else is not a metric.
export const METRICS = Object.freeze({
  'wealth.revenue': Object.freeze({ledger: 'wealth', units: ['KRW', 'USD', 'EUR', 'JPY'], sources: ['payment_processor', 'bank_statement', 'invoice_ledger']}),
  'wealth.transactions': Object.freeze({ledger: 'wealth', units: ['count'], sources: ['payment_processor', 'bank_statement', 'invoice_ledger']}),
  'adoption.installs': Object.freeze({ledger: 'adoption', units: ['count'], sources: ['package_registry', 'app_store']}),
  'adoption.active_users': Object.freeze({ledger: 'adoption', units: ['count'], sources: ['analytics_platform', 'app_store']}),
  'fame.followers': Object.freeze({ledger: 'fame', units: ['count'], sources: ['publication_platform', 'analytics_platform']}),
  'fame.views': Object.freeze({ledger: 'fame', units: ['count'], sources: ['publication_platform', 'analytics_platform']}),
  'honor.awards': Object.freeze({ledger: 'honor', units: ['count'], sources: ['award_registry']}),
  'honor.citations': Object.freeze({ledger: 'honor', units: ['count'], sources: ['citation_index']}),
  'honor.rating': Object.freeze({ledger: 'honor', units: ['stars', 'score'], sources: ['review_platform']})
});
export const LEDGERS = Object.freeze(['wealth', 'honor', 'fame', 'adoption']);
const SECRET_KEY = /key|secret|token|password|credential|authorization|cookie|session/i;
const SECRET_VALUE = /^(?:sk-|xai-|nvapi-|AIza|ya29\.|ghp_|gho_|Bearer\s|Basic\s)|BEGIN (?:RSA |EC )?PRIVATE KEY/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const SOURCE_ID = /^[A-Za-z0-9._:\/-]{1,200}$/;

export class OutcomeVerificationError extends Error {
  constructor(message, code = 'OUTCOME_INVALID') {super(message); this.code = code;}
}
const fail = (message, code) => {throw new OutcomeVerificationError(message, code);};
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : JSON.stringify(value);
export const sha256 = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function assertNoSecrets(value, path = '$') {
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) fail(`${path}: 자격 증명 형태의 값은 성과 근거에 들어올 수 없습니다.`, 'OUTCOME_SECRET');
    return;
  }
  if (Array.isArray(value)) {value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`)); return;}
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) fail(`${path}.${key}: 자격 증명 이름의 필드는 성과 근거에 들어올 수 없습니다.`, 'OUTCOME_SECRET');
      assertNoSecrets(item, `${path}.${key}`);
    }
  }
}

// The identity of a piece of evidence is everything it claims, not when we
// happened to collect it: restart / polling recollection keeps the fingerprint.
export function evidenceFingerprint(evidence) {
  const {fingerprint, collectedAt, ...claim} = evidence;
  return sha256(claim);
}

export function validateOutcomeEvidence(evidence) {
  if (!exact(evidence, EVIDENCE_FIELDS)) fail(`성과 근거는 정확히 ${EVIDENCE_FIELDS.join(', ')} 필드를 가져야 합니다.`);
  assertNoSecrets(evidence, 'evidence');
  const e = evidence;
  if (e.version !== OUTCOME_VERIFICATION_VERSION) fail('성과 근거 version이 올바르지 않습니다.');
  if (!UUID.test(e.questId) || !UUID.test(e.jobId)) fail('questId/jobId는 UUID여야 합니다.');
  if (!HASH.test(e.artifactSha256)) fail('artifactSha256은 SHA-256 hex여야 합니다.');
  if (!Object.hasOwn(METRICS, e.metric)) fail(`정의되지 않은 metric: ${String(e.metric)}`);
  const metric = METRICS[e.metric];
  if (!finite(e.value)) fail(`${e.metric}: value는 유한한 숫자여야 합니다.`);
  if (!metric.units.includes(e.unit)) fail(`${e.metric}: unit은 ${metric.units.join('|')} 중 하나여야 합니다.`);
  if (!Object.hasOwn(SOURCE_TYPES, e.sourceType)) fail(`알 수 없는 sourceType: ${String(e.sourceType)}`);
  if (typeof e.sourceId !== 'string' || !SOURCE_ID.test(e.sourceId)) fail('sourceId가 올바르지 않습니다.');
  if (!ISO.test(e.sourceTimestamp) || !ISO.test(e.collectedAt)) fail('sourceTimestamp/collectedAt은 ISO 시각이어야 합니다.');
  if (!VERIFICATION_TYPES.includes(e.verificationType)) fail(`verificationType은 ${VERIFICATION_TYPES.join('|')} 중 하나여야 합니다.`);
  if (!AUTHORITIES.includes(e.authority)) fail(`authority는 ${AUTHORITIES.join('|')} 중 하나여야 합니다.`);
  if (!TYPE_AUTHORITY[e.verificationType].includes(e.authority)) fail(`${e.verificationType}에는 authority ${TYPE_AUTHORITY[e.verificationType].join('|')}만 허용됩니다.`);
  if (!finite(e.confidence) || e.confidence < 0 || e.confidence > 1) fail('confidence는 0..1 숫자여야 합니다.');
  const external = SOURCE_TYPES[e.sourceType].external;
  if (OUTCOME_VERIFYING_TYPES.includes(e.verificationType) && !external) fail(`${e.verificationType}는 외부 구조화 source가 필요합니다 (${e.sourceType}는 외부 source가 아닙니다).`);
  if (OUTCOME_VERIFYING_TYPES.includes(e.verificationType) && !metric.sources.includes(e.sourceType)) fail(`${e.metric}은 ${metric.sources.join('|')} source로만 외부 검증됩니다.`);
  if (e.sourceType === 'model_output' && e.verificationType !== 'internal_observed') fail('model_output은 internal_observed로만 기록됩니다.');
  if (e.verificationType === 'self_reported' && e.sourceType !== 'owner_report') fail('self_reported는 owner_report source여야 합니다.');
  if (e.fingerprint !== evidenceFingerprint(e)) fail('성과 근거 지문이 다릅니다.', 'OUTCOME_TAMPERED');
  return true;
}

export function createOutcomeEvidence(claim, {collectedAt}) {
  if (!exact(claim, EVIDENCE_FIELDS.filter(f => !['version', 'collectedAt', 'fingerprint'].includes(f)))) fail('성과 근거 claim 필드가 올바르지 않습니다.');
  const evidence = {version: OUTCOME_VERIFICATION_VERSION, ...claim, collectedAt, fingerprint: null};
  evidence.fingerprint = evidenceFingerprint(evidence);
  validateOutcomeEvidence(evidence);
  return evidence;
}

export const MAX_EVIDENCE = 500;
// Durable, bounded, at-most-one-claim-per-(questId,jobId,metric) collection:
// a later claim for the same outcome+metric replaces the earlier one instead
// of accumulating contradictory claims about the same execution.
export function validateOutcomeEvidences(list) {
  if (!Array.isArray(list) || list.length > MAX_EVIDENCE) fail(`성과 근거는 ${MAX_EVIDENCE}개 이하의 배열이어야 합니다.`);
  const seen = new Set();
  for (const evidence of list) {
    validateOutcomeEvidence(evidence);
    const key = `${evidence.questId}:${evidence.jobId}:${evidence.metric}`;
    if (seen.has(key)) fail('같은 목표·작업·metric에 대한 성과 근거가 중복됩니다.');
    seen.add(key);
  }
  return true;
}
export function addOutcomeEvidence(list, evidence) {
  validateOutcomeEvidences(list); validateOutcomeEvidence(evidence);
  const key = e => `${e.questId}:${e.jobId}:${e.metric}`;
  const next = [...list.filter(item => key(item) !== key(evidence)), evidence];
  validateOutcomeEvidences(next);
  return next;
}

export function parseOutcomeEvidence(text) {
  let parsed;
  try {parsed = JSON.parse(text);} catch {fail('성과 근거 JSON을 읽을 수 없습니다.');}
  validateOutcomeEvidence(parsed);
  return parsed;
}

// Execution integrity: the stored artifact is byte-identical to what the
// capability run emitted, and the run consumed the job's own request.
export function verifyExecution({artifactSha256, run, job}) {
  const reasons = [];
  if (!HASH.test(artifactSha256 ?? '')) reasons.push('artifact_hash_missing');
  if (!run || typeof run !== 'object') reasons.push('run_record_missing');
  else {
    if (run.action !== 'run') reasons.push('run_record_not_run');
    if (!job || run.runId !== job.id) reasons.push('run_job_mismatch');
    if (!HASH.test(run.outputSha256 ?? '')) reasons.push('run_output_hash_missing');
    else if (run.outputSha256 !== artifactSha256) reasons.push('artifact_hash_mismatch');
    if (!job || !job.capabilityRequest || run.inputSha256 !== job.capabilityRequest.inputSha256) reasons.push('run_input_mismatch');
  }
  if (job && job.status !== 'completed') reasons.push('job_not_completed');
  return {executionVerified: reasons.length === 0, reasons};
}

// Outcome reality. `links` are the durable quest/job/artifact the evidence
// must point at; `source` is the structured external record set we were able
// to read right now (null when the source is gone). The claim verifies only
// when the same source, by identity, still holds the same metric/value/unit at
// the same timestamp.
export function verifyOutcome(evidence, {links, source, execution = null, at}) {
  validateOutcomeEvidence(evidence);
  if (!ISO.test(at)) fail('at은 ISO 시각이어야 합니다.');
  if (!exact(links, ['questId', 'jobId', 'artifactSha256'])) fail('links는 {questId, jobId, artifactSha256}여야 합니다.');
  if (source !== null && (!exact(source, ['sourceType', 'sourceId', 'records']) || !Array.isArray(source.records))) fail('source는 null 또는 {sourceType, sourceId, records[]}여야 합니다.');
  assertNoSecrets({links, source}, 'verify');
  const reasons = [];
  const type = evidence.verificationType;
  if (!OUTCOME_VERIFYING_TYPES.includes(type)) reasons.push(`type_not_outcome_verifying:${type}`);
  if (evidence.authority === 'model' || evidence.sourceType === 'model_output') reasons.push('model_output_is_not_evidence');
  for (const key of ['questId', 'jobId', 'artifactSha256']) if (links[key] !== evidence[key]) reasons.push(`link_mismatch:${key}`);
  if (source === null) reasons.push('source_unavailable');
  else {
    if (source.sourceType !== evidence.sourceType) reasons.push('source_type_mismatch');
    if (source.sourceId !== evidence.sourceId) reasons.push('source_id_mismatch');
    if (source.sourceType === evidence.sourceType && source.sourceId === evidence.sourceId) {
      const sameClaim = source.records.filter(r => r && typeof r === 'object' && r.metric === evidence.metric && r.timestamp === evidence.sourceTimestamp);
      if (!sameClaim.length) reasons.push('claim_not_in_source');
      else if (!sameClaim.some(r => r.value === evidence.value && r.unit === evidence.unit)) reasons.push('source_changed');
    }
  }
  if (execution !== null && execution.executionVerified !== true) reasons.push('execution_not_verified');
  const outcomeVerified = reasons.length === 0;
  const verdict = {
    version: OUTCOME_VERIFICATION_VERSION,
    evidenceFingerprint: evidence.fingerprint,
    questId: evidence.questId, jobId: evidence.jobId, artifactSha256: evidence.artifactSha256,
    metric: evidence.metric, ledger: METRICS[evidence.metric].ledger,
    verificationType: type,
    executionVerified: execution === null ? null : execution.executionVerified === true,
    outcomeVerified,
    highGradeCandidate: outcomeVerified && HIGH_GRADE_TYPES.includes(type),
    reasons,
    checkedAt: at,
    authorizesAction: false,
    fingerprint: null
  };
  verdict.fingerprint = verdictFingerprint(verdict);
  return verdict;
}

export function verdictFingerprint(verdict) {
  const {fingerprint, checkedAt, ...body} = verdict;
  return sha256(body);
}

export function validateOutcomeVerdict(verdict) {
  if (!exact(verdict, ['version', 'evidenceFingerprint', 'questId', 'jobId', 'artifactSha256', 'metric', 'ledger', 'verificationType', 'executionVerified', 'outcomeVerified', 'highGradeCandidate', 'reasons', 'checkedAt', 'authorizesAction', 'fingerprint'])) fail('verdict 필드가 올바르지 않습니다.');
  assertNoSecrets(verdict, 'verdict');
  if (verdict.version !== OUTCOME_VERIFICATION_VERSION || verdict.authorizesAction !== false || !ISO.test(verdict.checkedAt) || !HASH.test(verdict.evidenceFingerprint)) fail('verdict 값이 올바르지 않습니다.');
  if (typeof verdict.outcomeVerified !== 'boolean' || !Array.isArray(verdict.reasons) || (verdict.outcomeVerified && verdict.reasons.length) || (!verdict.outcomeVerified && !verdict.reasons.length)) fail('verdict 결과와 사유가 일치하지 않습니다.');
  if (!OUTCOME_VERIFYING_TYPES.includes(verdict.verificationType) && verdict.outcomeVerified) fail('허용되지 않은 verificationType이 outcomeVerified입니다.', 'OUTCOME_TAMPERED');
  if (verdict.highGradeCandidate && !(verdict.outcomeVerified && HIGH_GRADE_TYPES.includes(verdict.verificationType))) fail('highGradeCandidate는 외부 검증 성과만 가능합니다.', 'OUTCOME_TAMPERED');
  if (verdict.fingerprint !== verdictFingerprint(verdict)) fail('verdict 지문이 다릅니다.', 'OUTCOME_TAMPERED');
  return true;
}
