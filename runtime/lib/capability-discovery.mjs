import { reviewCapabilityIntake } from './agent-security-intake.mjs';
import crypto from 'node:crypto';
import {publicQuest} from './quests.mjs';
import {validateCapabilities, initialCapabilities, importCapability} from './capabilities.mjs';
import {validateCodeWorkshop, validateCodeManifest, codeHash, codeInputFields} from './code-workshop.mjs';

// General Kirby capability discovery (pure, no wiring yet).
//
//   Goal (autonomous quest) -> required capability (record type + fields the
//   goal's own evidence can supply) -> search of what Kirby already holds
//   (capabilities.mjs + code-workshop.mjs registries) and of the reviewed
//   manifests committed in this repo -> missing-capability gap or a
//   reviewed, sandboxable candidate.
//
// Nothing here maps an archetype to a capability id. A goal needs a capability
// that can consume the durable records its provenance references; a manifest
// matches when every input field it declares is a field those records really
// carry, with the same type. Anything the registries do not hold and the
// repository has not reviewed is reported as a gap with the exact schema a
// future capability would need - never authored, never fetched, never guessed
// from goal text or a model. Activation and execution stay in Kirby/closed-loop.
export const DISCOVERY_VERSION = 1;
export const CANDIDATE_ORIGINS = Object.freeze(['active', 'inactive_owner_review', 'reviewed_manifest']);
export const GAP_KINDS = Object.freeze(['none', 'inactive_owner_review', 'acquire_reviewed', 'missing', 'evidence_changed', 'no_records']);
export const RISK_CLASSES = Object.freeze(['local-reversible', 'capability-change', 'external-code']);
export const QUALIFY_CHECKS = Object.freeze(['manifest', 'source', 'license', 'pinnedCommit', 'hash', 'fixtures', 'sandbox', 'ownerState', 'emergencyStop']);
const GITHUB_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT = /^[a-f0-9]{40}$/;

const MAX_RECORDS = 30;
const clip = (value, max) => String(value ?? '').slice(0, max);
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : JSON.stringify(value);
const sha256 = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');

// How each durable record type becomes capability-input rows. Field types are
// the declarative schema's (string|number|boolean); values are copied from the
// stored record only.
export const RECORD_PROJECTIONS = Object.freeze({
  job: Object.freeze({
    fields: Object.freeze({id: 'string', title: 'string', status: 'string', error: 'string', nextStep: 'string'}),
    find: (state, id) => (state.jobs ?? []).find(job => job.id === id) ?? null,
    project: job => ({id: job.id, title: clip(job.title, 400), status: job.status, error: clip(job.error, 400),
      nextStep: job.agentJournal?.calls?.some(call => call.status !== 'settled') ? '이전 응답 미확인: 재호출 없이 호출 기록 확인' : '보관된 입력으로 원인 재현, 수정 전후 결과 비교'}),
  }),
  outcome: Object.freeze({
    fields: Object.freeze({ledger: 'string', summary: 'string', value: 'number', unit: 'string'}),
    find: (state, id) => (state.outcomes ?? []).find(outcome => outcome.id === id && typeof outcome.value === 'number') ?? null,
    project: outcome => ({ledger: outcome.ledger, summary: clip(outcome.summary, 400), value: outcome.value, unit: clip(outcome.unit, 40)}),
  }),
  quest: Object.freeze({
    fields: Object.freeze({id: 'string', title: 'string', status: 'string', resultStatus: 'string', artifactCount: 'number', outcomeCount: 'number'}),
    find: (state, id) => {const quest = (state.quests ?? []).find(item => item.id === id); return quest ? publicQuest(quest, state) : null;},
    project: quest => ({id: quest.id, title: clip(quest.goal, 400), status: quest.status, resultStatus: String(quest.resultStatus ?? ''),
      artifactCount: (quest.artifacts ?? []).length, outcomeCount: (quest.outcomeRecords ?? []).length}),
  }),
  project: Object.freeze({
    fields: Object.freeze({id: 'string', title: 'string', status: 'string'}),
    find: (state, id) => (state.projects ?? []).find(project => project.id === id) ?? null,
    project: project => ({id: project.id, title: clip(project.name ?? project.title, 400), status: String(project.status ?? '')}),
  }),
});

// Which record type carries the material for each evidence kind and the
// status those records must still have. A referenced record that vanished or
// left that status means the goal's reality changed and no capability may be
// applied to it. New observers register here; nothing is inferred from text.
export const EVIDENCE_RECORDS = Object.freeze({
  repeated_failed_jobs: Object.freeze({type: 'job', still: job => job.status === 'failed'}),
  repeated_owner_pause: Object.freeze({type: 'job', still: job => job.status === 'paused'}),
  completed_without_verified_artifact: Object.freeze({type: 'quest', still: quest => quest.status === 'completed'}),
  completed_without_outcome: Object.freeze({type: 'quest', still: quest => quest.status === 'completed'}),
  demanded_capability_inactive: Object.freeze({type: 'outcome', still: () => true}),
  active_project_without_execution_evidence: Object.freeze({type: 'project', still: project => project.status === 'active'}),
});

// Goal -> required capability. The requirement is the record type and the
// exact fields those records can supply, derived from the quest's own
// provenance references, plus a fingerprint so the same requirement is
// recognised across polls and restarts.
export function requiredCapability(state, quest) {
  const synthesis = quest?.synthesis;
  if (!synthesis || !Array.isArray(synthesis.evidence)) return {ok: false, reason: 'not_autonomous', questId: quest?.id ?? null};
  const item = synthesis.evidence.find(entry => EVIDENCE_RECORDS[entry.kind]);
  if (!item) return {ok: false, reason: 'unknown_evidence_kind', questId: quest.id, kinds: synthesis.evidence.map(entry => entry.kind)};
  const rule = EVIDENCE_RECORDS[item.kind], projection = RECORD_PROJECTIONS[rule.type];
  const references = [...new Set(item.references.filter(ref => ref.type === rule.type).map(ref => ref.id))].sort();
  if (!references.length) return {ok: false, reason: 'no_records', questId: quest.id, evidenceKind: item.kind, recordType: rule.type};
  const missing = [], records = [];
  for (const id of references) {
    const record = projection.find(state, id);
    if (!record || !rule.still(record)) missing.push(id); else records.push(projection.project(record));
  }
  if (missing.length) return {ok: false, reason: 'evidence_changed', questId: quest.id, evidenceKind: item.kind, recordType: rule.type, missing};
  const requirement = {version: DISCOVERY_VERSION, questId: quest.id, archetype: synthesis.archetype, evidenceKind: item.kind, recordType: rule.type,
    fields: {...projection.fields}, recordIds: references, recordCount: records.length,
    demandedCapabilityIds: [...new Set(item.references.filter(ref => ref.type === 'capability').map(ref => ref.id))].sort()};
  requirement.fingerprint = sha256({version: DISCOVERY_VERSION, evidenceKind: item.kind, recordType: rule.type, fields: projection.fields, recordIds: references});
  return {ok: true, requirement, records};
}

// A manifest fits a requirement when every field it declares exists on the
// projected records with the same type - the declarative engine validates rows
// with an exact key set, so the caller must project down to exactly these fields.
// Declarative manifests carry `inputSchema.fields`; QuickJS manifests carry an
// explicit fixture-verified `inputContract.records.fields`. Nothing else counts.
export function manifestInputFields(manifest) {
  return manifest?.inputSchema?.fields ?? codeInputFields(manifest) ?? null;
}

export function manifestFits(manifest, requirement) {
  const fields = manifestInputFields(manifest);
  if (!fields || typeof fields !== 'object') return {fits: false, coverage: 0, missing: [], mismatched: [], reason: manifest?.files ? 'no_input_contract' : 'no_declarative_schema'};
  const missing = [], mismatched = [];
  for (const [name, type] of Object.entries(fields)) {
    if (!(name in requirement.fields)) missing.push(name); else if (requirement.fields[name] !== type) mismatched.push(name);
  }
  const fits = !missing.length && !mismatched.length;
  return {fits, coverage: fits ? Object.keys(fields).length / Object.keys(requirement.fields).length : 0, missing, mismatched, reason: fits ? null : missing.length ? 'fields_not_supplied' : 'type_mismatch'};
}

function heldCandidates(state) {
  const list = [];
  if (state.capabilities) {
    validateCapabilities(state.capabilities);
    for (const entry of state.capabilities.entries) {
      const version = entry.versions.find(item => item.hash === entry.activeHash) ?? entry.versions[entry.versions.length - 1];
      list.push({origin: entry.activeHash ? 'active' : 'inactive_owner_review', engine: 'declarative-v1', id: entry.id, hash: entry.activeHash ?? version.hash,
        version: version.manifest.version, manifest: version.manifest, verified: !!version.verification, fixtureCount: version.manifest.fixtures.length});
    }
  }
  if (state.codeWorkshop) {
    validateCodeWorkshop(state.codeWorkshop);
    for (const entry of state.codeWorkshop.entries) {
      const version = entry.versions.find(item => item.hash === entry.activeHash) ?? entry.versions[entry.versions.length - 1];
      list.push({origin: entry.activeHash ? 'active' : 'inactive_owner_review', engine: 'quickjs-v1', id: entry.id, hash: entry.activeHash ?? version.hash,
        version: version.manifest.version, manifest: version.manifest, verified: !!version.verification, fixtureCount: version.manifest.fixtures.length});
    }
  }
  return list;
}

const ORIGIN_RANK = Object.fromEntries(CANDIDATE_ORIGINS.map((origin, index) => [origin, index]));
const rank = (a, b) => ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin] || b.fit.coverage - a.fit.coverage || a.id.localeCompare(b.id);

// Requirement -> what Kirby holds / what the repository has reviewed. Reviewed
// manifests are only ever the ones the caller loaded from runtime/capabilities;
// a manifest whose id is already held is not a second candidate.
export function searchCapabilities(state, requirement, {manifests = []} = {}) {
  const held = heldCandidates(state), heldIds = new Set(held.map(item => item.id));
  const reviewed = manifests.filter(manifest => manifest && !heldIds.has(manifest.id)).map(manifest => ({origin: 'reviewed_manifest', engine: 'declarative-v1', id: manifest.id,
    hash: null, version: manifest.version, manifest, verified: false, fixtureCount: Array.isArray(manifest.fixtures) ? manifest.fixtures.length : 0}));
  const scored = [...held, ...reviewed].map(item => ({...item, fit: manifestFits(item.manifest, requirement)}));
  const matches = scored.filter(item => item.fit.fits).sort(rank).map(({manifest, ...item}) => item);
  const rejected = scored.filter(item => !item.fit.fits).map(({manifest, ...item}) => ({id: item.id, origin: item.origin, engine: item.engine, reason: item.fit.reason, missing: item.fit.missing, mismatched: item.fit.mismatched}));
  return {matches, rejected, searched: scored.length};
}

// Project the requirement's records down to exactly the fields a matched
// manifest declares. Pure; the caller still goes through createCapabilityRequest.
export function projectInput(records, manifest) {
  const fields = Object.keys(manifestInputFields(manifest));
  return {records: records.slice(0, MAX_RECORDS).map(record => Object.fromEntries(fields.map(name => [name, record[name]])))};
}

// Goal -> gap classification. `acquire_reviewed` is the only candidate Kirby
// could act on and it is sandboxable by construction (declarative fixtures
// re-run through the same transform, no network); `missing` reports the schema
// a capability would need so an owner or a reviewed PR can supply one.
export function discoverCapability(state, quest, {manifests = []} = {}) {
  const required = requiredCapability(state, quest);
  const base = {version: DISCOVERY_VERSION, questId: quest?.id ?? null, archetype: quest?.synthesis?.archetype ?? null};
  if (!required.ok) return {...base, gap: required.reason === 'evidence_changed' ? 'evidence_changed' : 'no_records', requirement: null, reason: required.reason, detail: required, candidate: null, matches: [], rejected: []};
  const {requirement, records} = required;
  const search = searchCapabilities(state, requirement, {manifests});
  const best = search.matches[0] ?? null;
  const gap = !best ? 'missing' : best.origin === 'active' ? 'none' : best.origin === 'inactive_owner_review' ? 'inactive_owner_review' : 'acquire_reviewed';
  const candidate = best ? {...best, sandboxable: best.fixtureCount >= 2 && (best.engine === 'declarative-v1' || best.verified === true), demand: {recordType: requirement.recordType, recordCount: records.length, recordIds: requirement.recordIds}} : null;
  const reason = gap === 'none' ? `활성 기능 ${best.id}이(가) ${requirement.recordType} 기록 ${records.length}건을 바로 처리할 수 있습니다.`
    : gap === 'inactive_owner_review' ? `${best.id}은(는) 가져왔지만 비활성 상태입니다(소유자 비활성화 또는 시험 불합격). 커비는 스스로 재활성화하지 않습니다.`
    : gap === 'acquire_reviewed' ? `검토된 원본 ${best.id} ${best.version}이(가) 요구 스키마에 맞습니다. 시험 ${best.fixtureCount}건을 통과해야 활성화됩니다.`
    : `${requirement.recordType} 기록 ${records.length}건을 처리할 기능이 등록·검토된 것 중에 없습니다. 필요한 입력 필드: ${Object.keys(requirement.fields).join(', ')}.`;
  return {...base, gap, requirement, reason, candidate, matches: search.matches, rejected: search.rejected, searched: search.searched};
}

export function discoverCapabilities(state, {manifests = []} = {}) {
  return (state.quests ?? []).filter(quest => quest.synthesis).map(quest => discoverCapability(state, quest, {manifests}));
}

// Candidate -> may Kirby acquire it, and under which gate? Pure verdict over
// the manifest and the registry facts the candidate already carries; nothing
// is fetched, imported, tested or activated here. Every check is recorded so
// an owner (or closed-loop wiring later) sees exactly why activation is
// refused. Risk: reusing an active capability is local-reversible; importing
// a native reviewed manifest or owner/generated code is a capability change
// (owner approval, as in goal-synthesis); GitHub code is external code
// (owner approval, plus license + pinned commit + sandbox proof, no exceptions).
export function qualifyCandidate(candidate, {manifest = null, emergencyStop = false} = {}) {
  const checks = Object.fromEntries(QUALIFY_CHECKS.map(name => [name, null])), blockers = [];
  const block = (name, reason) => {checks[name] = false; blockers.push(reason);};
  const pass = name => {checks[name] = true;};
  if (emergencyStop) block('emergencyStop', 'emergency_stop'); else pass('emergencyStop');
  if (!candidate || !CANDIDATE_ORIGINS.includes(candidate.origin)) block('ownerState', 'unknown_candidate');
  else if (candidate.origin === 'inactive_owner_review') block('ownerState', 'owner_disabled_or_fixture_failed');
  else pass('ownerState');

  let risk = 'local-reversible', hash = candidate?.hash ?? null;
  if (candidate?.origin === 'active') {
    for (const name of ['manifest', 'source', 'license', 'pinnedCommit', 'hash', 'fixtures', 'sandbox']) pass(name);
  } else if (candidate?.engine === 'declarative-v1') {
    risk = 'capability-change';
    try {
      hash = importCapability(initialCapabilities(), manifest).result.hash; pass('manifest');
      if (candidate.hash && candidate.hash !== hash) block('hash', 'hash_mismatch'); else pass('hash');
      if (manifest.source.kind === 'native' && manifest.source.url === '') pass('source'); else block('source', 'declarative_source_not_native');
      if (manifest.source.license) pass('license'); else block('license', 'license_missing');
      pass('pinnedCommit');
      if (manifest.fixtures.length >= 2) pass('fixtures'); else block('fixtures', 'fixtures_insufficient');
      pass('sandbox');
    } catch (error) {
      block('manifest', 'manifest_invalid'); for (const name of ['source', 'license', 'pinnedCommit', 'hash', 'fixtures', 'sandbox']) if (checks[name] === null) checks[name] = false;
    }
  } else if (candidate?.engine === 'quickjs-v1') {
    try {
      validateCodeManifest(manifest); pass('manifest');
      const source = manifest.source;
      risk = source.kind === 'github' ? 'external-code' : 'capability-change';
      hash = codeHash(manifest);
      if (candidate.hash && candidate.hash !== hash) block('hash', 'hash_mismatch'); else pass('hash');
      pass('source');
      const licensePending = !source.license || source.license === 'pending' || !source.licenseText || source.licenseText === 'pending';
      if (licensePending) block('license', 'license_unreviewed'); else pass('license');
      if (source.kind === 'github') {
        if (GITHUB_URL.test(source.url) && COMMIT.test(source.commit) && source.commit !== '0'.repeat(40)) pass('pinnedCommit'); else block('pinnedCommit', 'commit_not_pinned');
      } else pass('pinnedCommit');
      if (manifest.fixtures.length >= 2) pass('fixtures'); else block('fixtures', 'fixtures_insufficient');
      if (candidate.verified === true) pass('sandbox'); else block('sandbox', 'sandbox_proof_missing');
    } catch (error) {
      block('manifest', 'manifest_invalid'); risk = 'external-code'; for (const name of ['source', 'license', 'pinnedCommit', 'hash', 'fixtures', 'sandbox']) if (checks[name] === null) checks[name] = false;
    }
  } else block('manifest', 'unknown_engine');

  const approvalRequired = risk !== 'local-reversible';
  const eligible = blockers.length === 0;
  const action = !eligible ? 'blocked' : candidate.origin === 'active' ? 'reuse' : 'acquire_with_owner_approval';
  return {version: DISCOVERY_VERSION, id: candidate?.id ?? null, engine: candidate?.engine ?? null, origin: candidate?.origin ?? null, hash, risk, approvalRequired, eligible, action, checks, blockers};
}


// External references pass through the same Kirby checks plus the security
// intake gate. This is pure qualification: no fetch, import, activation,
// model call or execution is performed here.
export function qualifyExternalCandidate(candidate, {manifest = null, intake, emergencyStop = false} = {}) {
  const security = reviewCapabilityIntake(intake);
  const base = qualifyCandidate(candidate, {manifest, emergencyStop});
  const blockers = [...base.blockers, ...security.blockers.map(reason => 'security:' + reason)];
  const eligible = base.eligible && security.status === 'candidate';
  return {...base, security, eligible, action: eligible ? base.action : 'blocked', blockers};
}
