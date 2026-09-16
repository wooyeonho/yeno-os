// Runtime glue between the persisted wealth/honor/fame/adoption ledger
// (quests.mjs recordQuestOutcome, always verification:'self_reported') and the
// pure outcome-verification layer. It never mutates the ledger and never grants
// action authority: for every stored outcome it re-derives, from durable state
// only, two separate facts -
//   executionVerified: the linked job's artifact SHA equals an independent
//                      registry 'run' record (capability jobs); agent jobs have
//                      no independent run record and stay false with the reason
//   outcomeVerified:   only an external structured source could make this true;
//                      no external source connector exists in this runtime yet,
//                      so every ledger record is reported honestly as unverified
// Growth's S gate consumes only verdicts with outcomeVerified && highGradeCandidate.
import {verifyExecution, OUTCOME_VERIFYING_TYPES} from './outcome-verification.mjs';

export const OUTCOME_REALITY_VERSION = 1;
export const EXTERNAL_SOURCE_STATUS = 'NOT_WIRED';

function runRecordFor(state, job) {
  if (!job || job.type !== 'capability' || !job.capabilityRequest) return null;
  const registry = state.capabilities;
  if (!registry || !Array.isArray(registry.history)) return null;
  return registry.history.find(event => event.action === 'run' && event.runId === job.id && event.id === job.capabilityRequest.id) ?? null;
}

export function outcomeReality(outcome, state) {
  const job = (state.jobs ?? []).find(item => item.id === outcome.jobId) ?? null;
  const run = runRecordFor(state, job);
  const execution = job && job.type === 'capability'
    ? verifyExecution({artifactSha256: outcome.artifactSha256, run, job})
    : {executionVerified: false, reasons: job ? ['run_record_missing'] : ['job_missing']};
  const reasons = [];
  if (!OUTCOME_VERIFYING_TYPES.includes(outcome.verification)) reasons.push(`type_not_outcome_verifying:${outcome.verification}`);
  reasons.push(`external_source:${EXTERNAL_SOURCE_STATUS}`);
  return {
    version: OUTCOME_REALITY_VERSION,
    outcomeId: outcome.id,
    questId: outcome.questId,
    jobId: outcome.jobId,
    artifactSha256: outcome.artifactSha256,
    capabilityId: job?.capabilityRequest?.id ?? null,
    ledger: outcome.ledger,
    verificationType: outcome.verification,
    executionVerified: execution.executionVerified === true,
    executionReasons: execution.reasons,
    outcomeVerified: false,
    highGradeCandidate: false,
    reasons,
    authorizesAction: false
  };
}

export function outcomeRealities(state) {
  return (state.outcomes ?? []).map(outcome => outcomeReality(outcome, state));
}

// Verified-outcome verdicts grouped by the capability whose execution the
// outcome is linked to. Only entries an external verifier could have produced
// count for growth; today this is always an empty map, which is the truth.
export function verifiedOutcomesByCapability(state) {
  const grouped = {};
  for (const reality of outcomeRealities(state)) {
    if (!reality.capabilityId || !reality.outcomeVerified || !reality.highGradeCandidate) continue;
    (grouped[reality.capabilityId] ??= []).push(reality);
  }
  return grouped;
}
