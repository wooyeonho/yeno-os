import {verifyExecution} from './outcome-verification.mjs';
import {buildSkillHistory, validateSkillHistory, INTERVENTION_KINDS} from './solo-leveling.mjs';

// BLACKHOLE Solo Leveling evidence derivation (pure, no wiring).
//
// `solo-leveling.mjs` grades from execution / intervention / verdict records
// but does not know where they come from. This leaf derives them from the
// durable state the store already validates — jobs, quests with a `loop`
// block, stored artifact digests and each engine's registry history — so a
// B (composition) or A (autonomy) grade is always traceable to real jobs:
//
//   execution   one record per completed/failed capability|code job whose
//               registry `run` exists; executionVerified is recomputed with
//               verifyExecution() against the stored artifact SHA, never read
//               from a flag on the job; authorizedBy comes from the quest's
//               `loop.authorizedBy` (owner|autopilot) or the job's autopilot mark.
//   intervention one record per owner act on such a job that the state still
//               shows: cancellation → stop, owner pause → pause, registry
//               rollback after the run → rollback. Interventions are never
//               counted from prose events or model text.
//
// Nothing here mutates state or grants authority. Histories are recomputed
// from evidence on every call; the stored previous history only carries the
// promotion trail.
export const LEVELING_EVIDENCE_VERSION = 1;
export const ENGINES = Object.freeze({capability: 'capabilities', code: 'codeWorkshop'});
const OWNER_PAUSE_REASONS = Object.freeze(['owner', 'autopilotStopped']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const registryOf = (state, engine) => state[ENGINES[engine]];
const skillIdOf = (job, engine) => engine === 'capability' ? job.capabilityRequest?.id ?? null : job.codeTask?.request?.id ?? null;
const requestOf = (job, engine) => engine === 'capability' ? job.capabilityRequest : job.codeTask?.request;
const isEngineJob = (job, engine) => engine === 'capability' ? job.type === 'capability' : job.type === 'code' && job.codeTask?.mode === 'run';

function artifactShas(job, state) {
  return (job.artifacts ?? []).map(ref => state.artifacts?.[ref.id]?.sha256).filter(sha => typeof sha === 'string');
}

function authorizedByFor(job, state) {
  const quest = job.questId ? state.quests.find(q => q.id === job.questId) : null;
  if (quest?.loop?.jobId === job.id && ['owner', 'autopilot'].includes(quest.loop.authorizedBy)) return quest.loop.authorizedBy;
  return job.autopilot ? 'autopilot' : 'owner';
}

// Execution records for one engine. A completed job with no matching run or
// with an artifact that does not digest to the run's output is a *failure*
// (executionVerified:false), which solo-leveling counts against the skill.
export function executionsFromState(state, engine) {
  if (!Object.hasOwn(ENGINES, engine)) throw new TypeError(`unknown engine ${String(engine)}`);
  const registry = registryOf(state, engine);
  if (!registry || !Array.isArray(registry.history)) return [];
  const out = [];
  for (const job of state.jobs ?? []) {
    if (!isEngineJob(job, engine) || !UUID.test(job.id ?? '') || !['completed', 'failed'].includes(job.status)) continue;
    const skillId = skillIdOf(job, engine);
    if (!skillId) continue;
    const run = registry.history.find(h => h.action === 'run' && h.runId === job.id && h.id === skillId) ?? null;
    let executionVerified = false;
    if (job.status === 'completed' && run) {
      const request = requestOf(job, engine);
      executionVerified = artifactShas(job, state).some(sha => verifyExecution({artifactSha256: sha, run, job: {...job, capabilityRequest: request}}).executionVerified);
    }
    out.push({jobId: job.id, skillId, status: job.status, executionVerified, authorizedBy: authorizedByFor(job, state), at: job.updatedAt ?? job.createdAt});
  }
  return out.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : a.jobId < b.jobId ? -1 : 1);
}

// Owner interventions that the durable state still attests to.
export function interventionsFromState(state, engine) {
  if (!Object.hasOwn(ENGINES, engine)) throw new TypeError(`unknown engine ${String(engine)}`);
  const registry = registryOf(state, engine);
  if (!registry || !Array.isArray(registry.history)) return [];
  const out = [];
  const push = (job, skillId, kind, at) => {
    if (!INTERVENTION_KINDS.includes(kind) || !UUID.test(job.id ?? '') || typeof at !== 'string') return;
    if (!out.some(i => i.jobId === job.id && i.kind === kind)) out.push({jobId: job.id, skillId, kind, by: 'owner', at});
  };
  for (const job of state.jobs ?? []) {
    if (!isEngineJob(job, engine)) continue;
    const skillId = skillIdOf(job, engine);
    if (!skillId) continue;
    if (job.status === 'cancelled') push(job, skillId, 'stop', job.updatedAt ?? job.createdAt);
    if (job.status === 'paused' && OWNER_PAUSE_REASONS.includes(job.pauseReason)) push(job, skillId, 'pause', job.updatedAt ?? job.createdAt);
    if (job.status === 'completed') {
      const run = registry.history.find(h => h.action === 'run' && h.runId === job.id && h.id === skillId);
      // A rollback of this skill after its run means the owner rejected what
      // that run's version did — charged to the latest run before the rollback.
      if (run) {
        const rollback = registry.history.find(h => h.action === 'rollback' && h.id === skillId && h.at > run.at
          && !registry.history.some(other => other.action === 'run' && other.id === skillId && other.at > run.at && other.at < h.at));
        if (rollback) push(job, skillId, 'rollback', rollback.at);
      }
    }
  }
  return out.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : a.jobId < b.jobId ? -1 : 1);
}

// Rebuild every skill history for one engine from state. `previous` maps
// skillId → stored history (promotion trail carried forward, fail-closed).
export function levelingHistoriesFromState(state, engine, {previous = {}, verdicts = []} = {}) {
  const registry = registryOf(state, engine);
  if (!registry || !Array.isArray(registry.entries)) return [];
  const executions = executionsFromState(state, engine);
  const interventions = interventionsFromState(state, engine);
  const skillIds = [...new Set([...registry.entries.map(e => e.id), ...executions.map(e => e.skillId)])].sort();
  return skillIds.map(skillId => {
    const prior = previous[skillId] ?? null;
    if (prior !== null) validateSkillHistory(prior);
    return buildSkillHistory(prior, {registry, skillId, executions, interventions, verdicts: verdicts.filter(v => executions.some(e => e.jobId === v.jobId && e.skillId === skillId))});
  });
}

// Compact B/A evidence view for readiness/UI: which concrete jobs support the
// composition and autonomy checks and what is still missing. Purely derived.
export function levelingEvidenceSummary(histories) {
  histories.forEach(validateSkillHistory);
  return {
    version: LEVELING_EVIDENCE_VERSION,
    skills: histories.map(h => ({
      skillId: h.skillId, grade: h.grade,
      B: {met: h.checks.B.met, compositions: h.compositions.map(c => ({jobId: c.jobId, upstreamSkillId: c.upstreamSkillId, upstreamJobId: c.upstreamJobId})), reason: h.checks.B.reason ?? null},
      A: {met: h.checks.A.met, autonomousVerified: h.successes.filter(s => s.authorizedBy === 'autopilot' && !h.interventions.some(i => i.jobId === s.jobId)).map(s => s.jobId), interventions: h.interventions.length, reason: h.checks.A.reason ?? null},
      S: {met: h.checks.S.met, reason: h.checks.S.reason ?? null}
    }))
  };
}
