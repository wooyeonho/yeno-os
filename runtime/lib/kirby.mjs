import {importCapability, verifyCapability, activateCapability} from './capabilities.mjs';

// Kirby never invents a capability from a quest's goal text or a model call.
// The only thing it can auto-acquire is a manifest already reviewed and
// committed in this repo (runtime/capabilities/*.json) - "discovery" here
// means noticing that real stored evidence would already give a known,
// unauthored-by-Kirby template something genuine to summarize, and that the
// template is not active yet. See runtime/capabilities/ledger-digest.json.
export function detectLedgerDigestGap(state, manifest) {
  const active = (state.capabilities?.entries ?? []).some(entry => entry.id === manifest.id && entry.activeHash);
  if (active) return null;
  const measured = (state.outcomes ?? []).filter(o => typeof o.value === 'number' && o.value >= 0);
  if (!measured.length) return null;
  return {
    manifest,
    reason: `측정값이 있는 원장 기록 ${measured.length}건을 확인했습니다. "${manifest.name}"을(를) 흡수하면 바로 정리할 수 있습니다.`,
  };
}

// The real isolated trial: verifyCapability re-runs every fixture in the
// manifest through the exact deterministic, network-free transform used at
// execution time (capabilities.mjs -> fixtures()). A candidate that fails
// its own fixtures stays imported (an honest, inactive record that Kirby
// tried) but is never activated - that inertness is the recovery path, not
// something the caller must undo.
export function autoAcquireCapability(registry, manifest, options = {}) {
  const imported = importCapability(registry, manifest, options);
  try {
    const verified = verifyCapability(imported.registry, manifest.id, imported.result.hash, options);
    const activated = activateCapability(verified.registry, manifest.id, imported.result.hash, options);
    return {registry: activated.registry, result: {id: manifest.id, hash: imported.result.hash, acquired: true, stage: 'active'}};
  } catch (error) {
    return {registry: imported.registry, result: {id: manifest.id, hash: imported.result.hash, acquired: false, stage: 'verify', error: error.message}};
  }
}

// Runs the whole gap-to-activation pipeline in one call for a call site that
// just wants "did Kirby pick anything up," without duplicating the
// detect-then-acquire wiring at each caller.
export function tryAutoAcquireLedgerDigest(state, manifest, options = {}) {
  const gap = detectLedgerDigestGap(state, manifest);
  if (!gap) return null;
  const outcome = autoAcquireCapability(state.capabilities, gap.manifest, options);
  return {...outcome, reason: gap.reason};
}
