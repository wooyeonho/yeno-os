import {SHADOW_ROLES} from './shadow-army.mjs';
import {resolveVerifiedResult} from './blackhole-core.mjs';

// BLACKHOLE Shadow growth (F06) — pure derivation, no wiring, no mutation.
//
// Design record (why a separate leaf, not a wider leveling-evidence.mjs):
//   solo-leveling.mjs grades E~S from a skill REGISTRY (runId/input/output
//   hashes + verifyExecution on the very job). Shadow roles have no registry
//   run to hash, so forcing them into that engine would mean fabricating run
//   records - forbidden. Instead, XP and a numeric level for each Shadow ROLE
//   are derived here from the one durable evidence a mission leaves behind:
//   the persisted semantic verdict, resolved through the SAME predicate the
//   Living Core uses for verifiedResultRef (blackhole-core.resolveVerifiedResult).
//   The E~S grade engine is untouched; this is additive and read-only.
//
// Rules v1 (conservative; change the version to change them, never silently):
//   - Reward event  = one mission whose semanticVerifier job completed with
//     verdict 'pass' AND still resolves (deterministic gate passed, builder
//     artifact registered and unchanged). Fail/uncertain/cancelled/paused
//     missions award 0 XP and are listed as failures, never negative XP.
//   - Eligible jobs in that mission: every completed job carrying
//     shadowAssignment.missionId === missionId. Reward per role:
//       builder 20 · scout/researcher 10 · verifier 5 · semanticVerifier 5
//   - Dedup key = `${missionId}:${jobId}` (a job belongs to exactly one
//     mission and one role). Re-deriving, restarting, re-delivering a
//     completion or re-running a verifier for the SAME mission cannot add a
//     second event; a verifier only earns through a NEW mission.
//   - Evidence withdrawal: if the mission no longer resolves (artifact
//     deleted/replaced, verdict tampered) its events move to `held` with the
//     reason and are excluded from XP - history is not erased, just not
//     counted. Everything is recomputed from state on every call.
//   - Level = floor(sqrt(xp / 10)); level 1 at 10 XP, 2 at 40, 3 at 90 ...
//     Level never grants execution authority, budget or call limits.
export const SHADOW_GROWTH_VERSION = 1;
export const SHADOW_XP_BY_ROLE = Object.freeze({scout: 10, researcher: 10, builder: 20, verifier: 5, semanticVerifier: 5});
export const XP_PER_LEVEL_UNIT = 10;

export const levelForXp = xp => Math.floor(Math.sqrt(Math.max(0, xp) / XP_PER_LEVEL_UNIT));
export const xpForNextLevel = xp => (levelForXp(xp) + 1) ** 2 * XP_PER_LEVEL_UNIT;

const byAtThenKey = (a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

// Every growth-relevant event the durable state attests to, valid or held.
export function shadowGrowthEventsFromState(state) {
  const jobs = state.jobs ?? [];
  const seen = new Set();
  const events = [];
  const semanticJobs = jobs.filter(j => j.semanticVerifyRequest && j.status === 'completed' && j.semanticVerdict && j.shadowAssignment?.role === 'semanticVerifier');
  for (const semantic of semanticJobs) {
    const missionId = semantic.semanticVerdict.missionId;
    const {ref, reason} = resolveVerifiedResult(semantic, state);
    const verdict = semantic.semanticVerdict.verdict;
    const status = ref ? 'valid' : verdict === 'pass' ? 'held' : 'failed';
    for (const job of jobs) {
      if (job.shadowAssignment?.missionId !== missionId || job.status !== 'completed') continue;
      const role = job.shadowAssignment.role;
      if (!SHADOW_ROLES.includes(role)) continue;
      const key = `${missionId}:${job.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({key, missionId, jobId: job.id, role, skillId: `shadow:${role}`, status, reason: status === 'valid' ? null : (status === 'held' ? reason : `semantic_${verdict}`), xp: status === 'valid' ? SHADOW_XP_BY_ROLE[role] : 0, at: semantic.semanticVerdict.createdAt, rulesVersion: SHADOW_GROWTH_VERSION});
    }
  }
  return events.sort(byAtThenKey);
}

// Per-role XP/level snapshot. Deterministic for a given state.
export function shadowGrowthFromState(state) {
  const events = shadowGrowthEventsFromState(state);
  const roles = SHADOW_ROLES.map(role => {
    const mine = events.filter(e => e.role === role);
    const xp = mine.filter(e => e.status === 'valid').reduce((sum, e) => sum + e.xp, 0);
    return {
      role, skillId: `shadow:${role}`, xp, level: levelForXp(xp), nextLevelAt: xpForNextLevel(xp),
      verifiedMissions: mine.filter(e => e.status === 'valid').length,
      failedMissions: mine.filter(e => e.status === 'failed').length,
      heldMissions: mine.filter(e => e.status === 'held').length,
      lastVerifiedAt: mine.filter(e => e.status === 'valid').at(-1)?.at ?? null,
    };
  });
  return {
    version: SHADOW_GROWTH_VERSION,
    rules: {xpByRole: SHADOW_XP_BY_ROLE, levelFormula: 'floor(sqrt(xp/10))', grantsAuthority: false},
    roles,
    events,
    held: events.filter(e => e.status === 'held').map(e => ({key: e.key, missionId: e.missionId, jobId: e.jobId, role: e.role, reason: e.reason})),
  };
}
