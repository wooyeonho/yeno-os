// BLACKHOLE cost ledger (F14) - a bounded, honest total-spend guardrail on
// top of the existing per-day CALL COUNT limit (agentUsage/dailyCallLimit).
//
// Design decision (researched existing code first): agentUsage() already
// counts calls per UTC day from each job's agentJournal.calls, but a call
// count is not a spend guarantee - the existing operator-facing text already
// says so ("호출 횟수 제한은 결제 금액 보장이 아닙니다"). This module adds an
// ESTIMATED USD total, computed only from real settled token counts
// (call.inputTokens/outputTokens, never guessed) against a small, explicitly
// versioned, manually-maintained unit-price snapshot - never fetched live,
// never assumed current. A provider missing from the snapshot, or a call
// whose tokens are not settled, is priced as null (unknown), never as $0.
//
// Fail-closed rule: when an owner has configured a daily cost cap and ANY of
// today's settled calls is unpriced, today's true total is unknowable, so the
// cap cannot be honestly certified as "still under limit" - the ledger
// reports it as blocked (reason 'cost_pricing_unknown') rather than silently
// letting spend continue past an unverifiable point. This mirrors the same
// fail-closed posture used throughout this candidate (F04/F06 verified
// result derivation): an unknown state is never treated as a safe one.
export const COST_LEDGER_VERSION = 1;

// USD per 1,000 tokens, by provider only (not per exact model - this is a
// deliberately coarse, owner-reviewable band for a soft budget guardrail,
// never an exact invoice reconstruction). The snapshot's own version/asOf
// travel with every report so a stale snapshot is visible, never silent.
export const PROVIDER_UNIT_PRICES_SNAPSHOT = Object.freeze({
  version: 1,
  asOf: '2026-09-23',
  currency: 'USD',
  prices: Object.freeze({
    anthropic: Object.freeze({inputPer1k: 0.003, outputPer1k: 0.015}),
    openai: Object.freeze({inputPer1k: 0.005, outputPer1k: 0.015}),
    gemini: Object.freeze({inputPer1k: 0.00125, outputPer1k: 0.005}),
    xai: Object.freeze({inputPer1k: 0.002, outputPer1k: 0.01}),
    moonshot: Object.freeze({inputPer1k: 0.0006, outputPer1k: 0.0025}),
    // nvidia: intentionally absent - many NVIDIA-hosted endpoints vary
    // between free and paid per model; guessing a price here would be worse
    // than reporting it honestly as unpriced until the owner sets one.
  }),
});

const integer = value => Number.isSafeInteger(value) && value >= 0;
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function priceFor(provider, snapshot = PROVIDER_UNIT_PRICES_SNAPSHOT) {
  return snapshot.prices[provider] ?? null;
}

// Returns a non-negative USD number, or null when the call cannot be honestly
// priced (unsettled/missing token counts, or a provider absent from the
// snapshot). Never returns 0 for an unknown case.
export function estimateCallCostUsd(call, provider, snapshot = PROVIDER_UNIT_PRICES_SNAPSHOT) {
  if (!call || call.status !== 'settled' || !integer(call.inputTokens) || !integer(call.outputTokens)) return null;
  const price = priceFor(provider, snapshot);
  if (!price) return null;
  return (call.inputTokens / 1000) * price.inputPer1k + (call.outputTokens / 1000) * price.outputPer1k;
}

// Same call-collection shape as agentUsage(jobs, at): every settled call from
// today (UTC date of `at`), across every job, keyed to that JOB's own fixed
// provider (agentJournal.provider/model are checkpointed immutable per job -
// see agent-engine.mjs's provider_changed_since_checkpoint guard - so every
// call inside one job really was sent to that one provider).
export function dailyCostUsage(jobs, at = new Date().toISOString(), snapshot = PROVIDER_UNIT_PRICES_SNAPSHOT) {
  const day = at.slice(0, 10);
  let estimatedTotalUsd = 0, pricedCalls = 0, unpricedCalls = 0;
  for (const job of jobs) {
    const provider = job.agentJournal?.provider;
    if (!provider) continue;
    for (const call of job.agentJournal.calls ?? []) {
      if (call.at?.slice(0, 10) !== day) continue;
      if (call.status !== 'settled') continue; // reservation-time gating (dailyCallLimit) already covers unsettled calls; never counted as spend, never assumed free
      const cost = estimateCallCostUsd(call, provider, snapshot);
      if (cost === null) { unpricedCalls++; continue; }
      estimatedTotalUsd += cost; pricedCalls++;
    }
  }
  return {
    version: COST_LEDGER_VERSION, date: day,
    estimatedTotalUsd: Math.round(estimatedTotalUsd * 1e6) / 1e6,
    pricedCalls, unpricedCalls,
    snapshotVersion: snapshot.version, snapshotAsOf: snapshot.asOf, currency: snapshot.currency,
  };
}

// dailyCostLimitUsd: null/undefined means no cap is configured (the existing
// per-day call-count limit remains the primary safety rail in that case).
export function dailyCostLimitStatus(jobs, dailyCostLimitUsd, at = new Date().toISOString(), snapshot = PROVIDER_UNIT_PRICES_SNAPSHOT) {
  const usage = dailyCostUsage(jobs, at, snapshot);
  if (dailyCostLimitUsd === null || dailyCostLimitUsd === undefined) return {...usage, limitUsd: null, blocked: false, reason: null};
  if (!finite(dailyCostLimitUsd)) throw new RangeError('invalid_daily_cost_limit');
  if (usage.unpricedCalls > 0) return {...usage, limitUsd: dailyCostLimitUsd, blocked: true, reason: 'cost_pricing_unknown'};
  const blocked = usage.estimatedTotalUsd >= dailyCostLimitUsd;
  return {...usage, limitUsd: dailyCostLimitUsd, blocked, reason: blocked ? 'daily_cost_limit' : null};
}
