// Runtime glue between the persisted wealth/honor/fame/adoption ledger
// (quests.mjs recordQuestOutcome, always verification:'self_reported') and the
// pure outcome-verification/outcome-connector layers. It never mutates the
// ledger and never grants action authority: for every stored outcome it
// re-derives, from durable state only, two separate facts -
//   executionVerified: the linked job's artifact SHA equals an independent
//                      registry 'run' record (capability jobs); agent jobs have
//                      no independent run record and stay false with the reason
//   outcomeVerified:   true only when the owner separately declared structured
//                      outcome evidence for this exact outcome (questId/jobId/
//                      artifactSha256) AND a real connector reading - taken
//                      over the actual pinned HTTPS transport, never a
//                      caller-supplied object - still holds the same claim.
//                      The ledger's own `verification:'self_reported'` string
//                      is never read here and never promoted by this process;
//                      it stays exactly what the owner typed. A missing
//                      declaration or a stale/mismatched reading stays
//                      honestly unverified.
// Growth's S gate consumes only verdicts with outcomeVerified && highGradeCandidate.
import {verifyExecution, verifyOutcome} from './outcome-verification.mjs';
import {toVerificationSource, connectorReadiness} from './outcome-connector.mjs';

export const OUTCOME_REALITY_VERSION = 1;

function runRecordFor(state, job) {
  if (!job || job.type !== 'capability' || !job.capabilityRequest) return null;
  const registry = state.capabilities;
  if (!registry || !Array.isArray(registry.history)) return null;
  return registry.history.find(event => event.action === 'run' && event.runId === job.id && event.id === job.capabilityRequest.id) ?? null;
}

// The most recent reading whose (sourceType, sourceId) matches the evidence's
// claimed source - not necessarily from the connector the owner originally
// declared for a different id, since what matters is the source identity the
// evidence itself names.
function latestMatchingReading(readings, evidence) {
  const matches = (readings ?? []).filter(r => r.sourceType === evidence.sourceType && r.sourceId === evidence.sourceId);
  return matches.length ? matches.reduce((a, b) => a.readAt > b.readAt ? a : b) : null;
}

export function outcomeReality(outcome, state, {at} = {}) {
  const job = (state.jobs ?? []).find(item => item.id === outcome.jobId) ?? null;
  const run = runRecordFor(state, job);
  const execution = job && job.type === 'capability'
    ? verifyExecution({artifactSha256: outcome.artifactSha256, run, job})
    : {executionVerified: false, reasons: job ? ['run_record_missing'] : ['job_missing']};
  const reasons = [];
  // The stored ledger record's own `verification` is always 'self_reported'
  // by contract - it is never itself an outcome-verifying type, and that is
  // by design, never a bug to "fix" here. Only a separately declared evidence
  // claim, checked against a real reading below, can move outcomeVerified;
  // reasons therefore only ever reflects that evidence-side check, so an
  // outcomeVerified:true result always carries an empty reasons list.
  const evidence = (state.outcomeEvidence ?? []).find(e => e.questId === outcome.questId && e.jobId === outcome.jobId && e.artifactSha256 === outcome.artifactSha256) ?? null;
  let outcomeVerified = false, highGradeCandidate = false, verdict = null;
  if (!evidence) reasons.push('no_outcome_evidence_declared');
  else {
    const reading = latestMatchingReading(state.outcomeReadings, evidence);
    if (!reading) reasons.push('no_matching_reading_available');
    const source = reading ? toVerificationSource(reading, evidence) : null;
    // Execution-integrity is only meaningful (and only required) for a
    // capability/skill job - Solo Leveling's S-grade is scoped to those. An
    // outcome linked to any other job type is judged purely on whether the
    // external source confirms the claim; it never feeds skill grading
    // anyway (capabilityId stays null for it below).
    const executionGate = job?.type === 'capability' ? execution : null;
    verdict = verifyOutcome(evidence, {links: {questId: outcome.questId, jobId: outcome.jobId, artifactSha256: outcome.artifactSha256}, source, execution: executionGate, at: at ?? evidence.collectedAt});
    outcomeVerified = verdict.outcomeVerified === true;
    highGradeCandidate = verdict.highGradeCandidate === true;
    if (!outcomeVerified) reasons.push(...verdict.reasons.map(r => `evidence_${r}`));
  }
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
    evidenceDeclared: !!evidence,
    evidenceFingerprint: evidence?.fingerprint ?? null,
    outcomeVerified,
    highGradeCandidate,
    reasons,
    authorizesAction: false
  };
}

export function outcomeRealities(state, at) {
  return (state.outcomes ?? []).map(outcome => outcomeReality(outcome, state, {at}));
}

// Verified-outcome verdicts grouped by the capability whose execution the
// outcome is linked to. Only entries a real external reading actually
// produced count for growth.
export function verifiedOutcomesByCapability(state, at) {
  const grouped = {};
  for (const reality of outcomeRealities(state, at)) {
    if (!reality.capabilityId || !reality.outcomeVerified || !reality.highGradeCandidate) continue;
    (grouped[reality.capabilityId] ??= []).push(reality);
  }
  return grouped;
}

// Readiness of the connector layer as a whole, for readiness.mjs.
export function outcomeConnectorReadiness(state) {
  return connectorReadiness(state.outcomeConnectors ?? [], state.outcomeReadings ?? []);
}
