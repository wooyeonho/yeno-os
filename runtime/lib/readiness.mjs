// Real-use readiness and safe self-test, computed only from durable state and
// explicit runtime facts the server passes in. Nothing here infers a state
// from a name, a configured key, or a passing test:
//   NOT_WIRED          the path does not exist in this runtime
//   WIRED_UNVERIFIED   the path exists but this store holds no evidence it ran
//   SYNTHETIC_VERIFIED evidence exists but came from the self-test / injected transport
//   LIVE_VERIFIED      evidence of a real run in this store (real transport for providers)
//   DEVICE_VERIFIED    an owner observed it on a real client and recorded that
//   BLOCKED            a definite blocker is present
// Provider matrix: UNCONFIGURED | CONFIGURED_UNVERIFIED | LIVE_VERIFIED | DEGRADED | DISABLED.
// A settled call proves LIVE_VERIFIED only when the transport was the real
// network fetch (not an injected fetchImpl) - a key alone proves nothing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {searchCapabilities, projectInput} from './capability-discovery.mjs';
import {verifyExecution} from './outcome-verification.mjs';
import {gradeSkill} from './growth.mjs';
import {liveEvidence} from './brain-routing.mjs';
import {httpsReadiness, restartEvidence} from './https-evidence.mjs';
import {deviceVerification} from './device-evidence.mjs';

export const READINESS_VERSION = 1;
export const STATES = Object.freeze(['NOT_WIRED', 'WIRED_UNVERIFIED', 'SYNTHETIC_VERIFIED', 'LIVE_VERIFIED', 'DEVICE_VERIFIED', 'BLOCKED']);
export const PROVIDER_STATES = Object.freeze(['UNCONFIGURED', 'CONFIGURED_UNVERIFIED', 'LIVE_VERIFIED', 'DEGRADED', 'DISABLED']);
export const OVERALL = Object.freeze(['READY', 'PARTIAL_READY', 'BLOCKED']);
export const PROVIDER_BLOCKER = 'REAL_PROVIDER_CREDENTIAL_OR_APPROVAL';
export const MAX_SELF_TESTS = 20;
const SECRET_KEY = /key|secret|token|password|credential|authorization|cookie/i;
const SECRET_VALUE = /^(?:sk-|xai-|nvapi-|AIza|ya29\.|ghp_|gho_|Bearer\s|Basic\s)|BEGIN (?:RSA |EC )?PRIVATE KEY/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha256 = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function assertNoSecrets(value, at = '$') {
  if (Array.isArray(value)) { value.forEach((item, i) => assertNoSecrets(item, `${at}[${i}]`)); return; }
  if (object(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key) && !/^(?:tokenUsage|hash|Hash)$/.test(key)) throw new Error(`Readiness: secret-like field ${at}.${key}`);
      assertNoSecrets(item, `${at}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && SECRET_VALUE.test(value)) throw new Error(`Readiness: secret-like value at ${at}`);
}

// Source commit: explicit deployment metadata first, then the checkout itself.
export function detectSourceCommit(env, root) {
  for (const name of ['YENO_SOURCE_COMMIT', 'KOYEB_GIT_SHA', 'GIT_COMMIT', 'SOURCE_COMMIT']) {
    const value = env[name];
    if (typeof value === 'string' && /^[0-9a-f]{40}$/.test(value)) return {sha: value, source: name};
  }
  try {
    const head = fs.readFileSync(path.join(root, '.git', 'HEAD'), 'utf8').trim();
    if (/^[0-9a-f]{40}$/.test(head)) return {sha: head, source: 'git_head'};
    const ref = head.match(/^ref: (.+)$/)?.[1];
    if (ref) {
      const refFile = path.join(root, '.git', ref);
      if (fs.existsSync(refFile)) return {sha: fs.readFileSync(refFile, 'utf8').trim(), source: 'git_ref'};
      const packed = fs.readFileSync(path.join(root, '.git', 'packed-refs'), 'utf8').split('\n').find(line => line.endsWith(` ${ref}`));
      if (packed) return {sha: packed.slice(0, 40), source: 'git_packed_ref'};
    }
  } catch {}
  return {sha: null, source: 'unknown'};
}

// Read the durable store file exactly as a restart would (checksum-verified),
// without touching the live in-memory state. null when nothing durable exists.
export function readDurableState(directory) {
  const file = path.join(directory, 'state.json');
  if (!fs.existsSync(file)) return null;
  const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (crypto.createHash('sha256').update(envelope.payload).digest('hex') !== envelope.sha256) throw new Error('Durable store checksum mismatch');
  return JSON.parse(envelope.payload);
}

// Per-call transport provenance decides: LIVE_VERIFIED needs a settled call
// whose receipt names exactly this provider+model over the real network.
// Receipts without provenance (legacy) or via injected fetch are synthetic.
export function providerReality(entry, {jobs = [], liveTransport = false} = {}) {
  const related = jobs.filter(job => job.agentJournal?.provider === entry.provider && (entry.model == null || job.agentJournal.model === entry.model));
  const calls = related.flatMap(job => (job.agentJournal.calls ?? []).map(call => ({...call, selfTest: !!job.selfTestId})));
  const settled = calls.filter(call => call.status === 'settled');
  const unknown = calls.filter(call => call.status === 'unknown');
  const lastSettledAt = settled.map(call => call.at).sort().at(-1) ?? null;
  const exact = liveEvidence(jobs, {provider: entry.provider, model: entry.model ?? null});
  let state;
  if (!entry.configured) state = 'UNCONFIGURED';
  else if (entry.eligible === false) state = 'DISABLED';
  else if (exact.degraded || (unknown.length && (!lastSettledAt || unknown.some(call => call.at > lastSettledAt)))) state = 'DEGRADED';
  else if (exact.liveCalls > 0) state = 'LIVE_VERIFIED';
  else state = 'CONFIGURED_UNVERIFIED';
  return {
    provider: entry.provider, model: entry.model ?? null, state,
    configured: !!entry.configured, missing: entry.missing ?? [],
    transport: liveTransport ? 'network' : 'injected',
    settledCalls: settled.length, unknownCalls: unknown.length, selfTestCalls: calls.filter(call => call.selfTest).length,
    exactLiveCalls: exact.liveCalls, injectedCalls: exact.injectedCalls, lastLiveAt: exact.lastLiveAt, liveTriggers: exact.triggers,
    lastSettledAt,
    evidence: !entry.configured ? 'no_credentials_configured'
      : state === 'LIVE_VERIFIED' ? 'real_endpoint_response_recorded_for_exact_provider_model'
      : settled.length ? (exact.injectedCalls ? 'settled_calls_via_injected_transport_only' : 'settled_calls_without_exact_transport_provenance') : 'no_call_evidence'
  };
}

const evidenceState = (records, blocked = null) => blocked ? 'BLOCKED' : !records.length ? 'WIRED_UNVERIFIED' : records.every(r => r.selfTest) ? 'SYNTHETIC_VERIFIED' : 'LIVE_VERIFIED';

// facts: everything the server knows; this function only classifies.
export function buildReadiness(facts) {
  const {state, sourceCommit, runtimeVersion, apiVersion, store, request, principal, providers, brainPool, liveTransport, manifests = [], boots = [], currentBootId = null, deviceAcceptances = [], currentRelease = null, at} = facts;
  const blockers = [];
  const jobs = state.jobs ?? [];
  const selfTests = state.selfTests ?? [];
  const isSelfTest = job => !!job.selfTestId;
  const tag = job => ({id: job.id, selfTest: isSelfTest(job)});

  const persistentStore = {state: store.durable ? 'LIVE_VERIFIED' : 'BLOCKED', directory: store.directory, durable: store.durable, recovered: store.recovered, revision: state.revision};
  if (!store.durable) blockers.push('persistent_store_not_durable');

  const httpsReachable = httpsReadiness(request);
  blockers.push(...httpsReachable.blockers);

  const authentication = {state: principal ? 'LIVE_VERIFIED' : 'BLOCKED', kind: principal?.kind ?? null, versionedApi: principal?.versioned ?? false};
  const devices = Object.values(state.devices ?? {}).filter(device => !device.revokedAt);
  const devicePairing = {state: devices.length ? 'LIVE_VERIFIED' : 'WIRED_UNVERIFIED', enrolledDevices: devices.length, platforms: [...new Set(devices.map(device => device.platform))].sort()};

  const emergencyStop = {state: state.emergencyStop ? 'LIVE_VERIFIED' : 'WIRED_UNVERIFIED', active: !!state.emergencyStop, gate: 'blocks_new_jobs_loop_acquisition_and_transport'};
  if (state.emergencyStop) blockers.push('emergency_stop_active');

  const synthesized = (state.quests ?? []).filter(quest => quest.synthesis);
  const homunculusObservations = selfTests.filter(item => item.homunculus?.observed).length;
  const homunculus = {state: synthesized.length ? 'LIVE_VERIFIED' : homunculusObservations ? 'SYNTHETIC_VERIFIED' : 'WIRED_UNVERIFIED', synthesizedQuests: synthesized.length, autopilotEnabled: !!state.autopilot?.enabled, selfTestObservations: homunculusObservations};

  const loops = (state.quests ?? []).filter(quest => quest.loop);
  const closedLoop = {state: evidenceState(loops.map(quest => ({selfTest: false}))), loopRecords: loops.length, kirbyActions: [...new Set(loops.map(quest => quest.loop.kirbyAction))].sort()};

  const kirbyRecords = [...loops.map(quest => ({selfTest: false})), ...selfTests.filter(item => item.kirby?.action === 'reuse').map(() => ({selfTest: true}))];
  const kirbyDiscovery = {state: evidenceState(kirbyRecords), discoveries: loops.length, selfTestReuse: selfTests.filter(item => item.kirby?.action === 'reuse').length, reviewedManifests: manifests.length};

  const registry = state.capabilities ?? {entries: [], history: []};
  const active = registry.entries.filter(entry => entry.activeHash);
  const runs = registry.history.filter(event => event.action === 'run');
  const runJobs = runs.map(run => jobs.find(job => job.id === run.runId)).filter(Boolean);
  const capabilityRegistry = {state: !active.length ? 'BLOCKED' : evidenceState(runJobs.map(tag)), entries: registry.entries.length, active: active.length, runs: runs.length};
  if (!active.length) blockers.push('no_active_capability');

  const providerMatrix = providers.map(entry => providerReality(entry, {jobs, liveTransport}));
  const routedJobs = jobs.filter(job => job.routing);
  const routedLive = routedJobs.filter(job => job.routing.transportOutcome === 'settled' && !isSelfTest(job));
  const modelRouter = {
    state: !providerMatrix.some(p => p.configured) ? 'BLOCKED' : routedLive.length && liveTransport ? 'LIVE_VERIFIED' : routedJobs.some(job => job.routing.transportOutcome === 'settled') ? 'SYNTHETIC_VERIFIED' : 'WIRED_UNVERIFIED',
    declaredPool: brainPool.declared, configuredInPool: brainPool.configured, routedJobs: routedJobs.length, settled: routedJobs.filter(job => job.routing.transportOutcome === 'settled').length,
    outcomeUnknown: routedJobs.filter(job => job.routing.transportOutcome === 'outcomeUnknown').length, authorizesCall: false
  };
  if (!providerMatrix.some(p => p.state === 'LIVE_VERIFIED')) blockers.push(PROVIDER_BLOCKER);

  const outcomes = state.outcomes ?? [];
  const outcomeVerification = {state: outcomes.length || runJobs.length ? evidenceState(runJobs.map(tag)) : 'WIRED_UNVERIFIED', executionVerifiedRuns: runJobs.length, ledgerOutcomes: outcomes.length, externallyVerifiedOutcomes: 0, externalSourceConnector: 'NOT_WIRED'};

  const grades = active.map(entry => gradeSkill(registry, entry.id));
  const soloLeveling = {state: !active.length ? 'BLOCKED' : grades.some(g => g.grade !== 'E') ? evidenceState(runJobs.map(tag)) : 'WIRED_UNVERIFIED', grades: Object.fromEntries(grades.map(g => [g.id, g.grade])), blockedGrades: {B: 'composition_evidence_not_tracked', A: 'intervention_count_not_tracked', S: 'external_verified_outcome_required'}};

  const voice = {state: 'WIRED_UNVERIFIED', browserFallback: 'speechRecognition/speechSynthesis', liveVoice: 'NOT_WIRED', toolCallsGrantApproval: false};
  blockers.push('live_voice_not_wired');

  const android = deviceVerification(deviceAcceptances, {platform: 'android', current: currentRelease ? {sourceCommit: currentRelease.sourceCommit, client: currentRelease.client} : null, devices: state.devices ?? {}, at});
  const androidClient = {...android, enrolledAndroidDevices: devices.filter(device => /android/i.test(device.platform)).length, currentRelease: currentRelease ? {sourceCommit: currentRelease.sourceCommit, versionName: currentRelease.client?.versionName ?? null, versionCode: currentRelease.client?.versionCode ?? null, apkSha256: currentRelease.client?.apkSha256 ?? null} : null};
  blockers.push(...android.blockers.map(b => `android_${b}`));

  const restartPersistence = restartEvidence({selfTests, boots, currentBootId, recovered: !!store.recovered});
  blockers.push(...restartPersistence.blockers.map(b => `restart_${b}`));

  const overall = blockers.some(b => ['persistent_store_not_durable', 'emergency_stop_active', 'no_active_capability'].includes(b)) ? 'BLOCKED' : blockers.length ? 'PARTIAL_READY' : 'READY';
  const readiness = {version: READINESS_VERSION, at, sourceCommit, runtimeVersion, apiVersion, persistentStore, httpsReachable, authentication, devicePairing, emergencyStop, homunculus, closedLoop, kirbyDiscovery, capabilityRegistry, modelRouter, providers: providerMatrix, outcomeVerification, soloLeveling, voice, androidClient, restartPersistence, blockers, overall};
  assertNoSecrets(readiness);
  return readiness;
}

// Safe synthetic local goal: fixed records that only exercise a held
// declarative capability. Nothing external, nothing owner-visible is mutated.
export const SELF_TEST_RECORDS = Object.freeze([
  {id: 'self-test-1', title: 'BLACKHOLE self-test record A', status: 'failed', error: 'synthetic: deterministic self-test input', nextStep: '보관된 입력으로 재확인'},
  {id: 'self-test-2', title: 'BLACKHOLE self-test record B', status: 'paused', error: 'synthetic: deterministic self-test input', nextStep: '보관된 입력으로 재확인'}
]);
export const SELF_TEST_REQUIREMENT = Object.freeze({fields: Object.freeze({id: 'string', title: 'string', status: 'string', error: 'string', nextStep: 'string'})});

// Kirby step of the self-test: search what is actually held; reuse only an
// active match (never import/activate anything - that needs the owner).
export function selfTestDiscovery(state, {manifests = []} = {}) {
  const search = searchCapabilities(state, SELF_TEST_REQUIREMENT, {manifests});
  const top = search.matches[0] ?? null;
  const action = !top ? 'blocked' : top.origin === 'active' ? 'reuse' : 'blocked';
  return {action, reason: !top ? 'no_matching_capability' : top.origin === 'active' ? null : `top_candidate_${top.origin}`, capabilityId: top?.id ?? null, hash: top?.hash ?? null, origin: top?.origin ?? null, searched: search.searched, matches: search.matches.map(m => ({id: m.id, origin: m.origin})), fingerprint: sha256({fields: SELF_TEST_REQUIREMENT.fields, top: top ? {id: top.id, hash: top.hash} : null})};
}

export function selfTestInput(manifest) {
  return projectInput([...SELF_TEST_RECORDS], manifest);
}

export function validateSelfTests(list) {
  if (list === undefined) return true;
  if (!Array.isArray(list) || list.length > MAX_SELF_TESTS) throw new Error('Invalid self-test registry');
  for (const item of list) {
    if (!object(item) || item.version !== READINESS_VERSION || !UUID.test(item.id) || !ISO.test(item.startedAt) || !object(item.kirby) || !object(item.homunculus) || !object(item.providerLive)) throw new Error('Invalid self-test record');
    if (item.jobId !== null && !UUID.test(item.jobId)) throw new Error('Invalid self-test job link');
    if (item.durableReload !== null && !object(item.durableReload)) throw new Error('Invalid self-test reload record');
    if (Object.keys(item).some(key => !['version', 'id', 'startedAt', 'homunculus', 'kirby', 'jobId', 'capabilityId', 'providerLive', 'durableReload'].includes(key))) throw new Error('Untrusted self-test field');
    assertNoSecrets(item);
  }
  return true;
}

// Progress of one self-test, recomputed from durable evidence every time it is
// read (so the same answer after a restart is the persistence proof itself).
export function selfTestProgress(record, {state, directory, liveTransport}) {
  const job = record.jobId ? (state.jobs ?? []).find(item => item.id === record.jobId) ?? null : null;
  const artifact = job ? Object.values(state.artifacts ?? {}).find(item => item.jobId === job.id) ?? null : null;
  const run = job ? (state.capabilities?.history ?? []).find(event => event.action === 'run' && event.runId === job.id) ?? null : null;
  const execution = job && artifact ? verifyExecution({artifactSha256: artifact.sha256, run, job}) : {executionVerified: false, reasons: [job ? 'artifact_missing' : 'job_missing']};
  const growth = record.capabilityId && state.capabilities?.entries.some(entry => entry.id === record.capabilityId) ? gradeSkill(state.capabilities, record.capabilityId) : null;
  let durable = null;
  try {
    const disk = readDurableState(directory);
    const diskJob = disk ? (disk.jobs ?? []).find(item => item.id === record.jobId) ?? null : null;
    const diskArtifact = diskJob ? Object.values(disk.artifacts ?? {}).find(item => item.jobId === diskJob.id) ?? null : null;
    durable = {present: !!diskJob, matched: !!diskJob && diskJob.status === job?.status && (diskArtifact?.sha256 ?? null) === (artifact?.sha256 ?? null), diskStatus: diskJob?.status ?? null, diskArtifactSha256: diskArtifact?.sha256 ?? null};
  } catch (error) { durable = {present: false, matched: false, error: error.message}; }
  const providerJob = record.providerLive.jobId ? (state.jobs ?? []).find(item => item.id === record.providerLive.jobId) ?? null : null;
  const providerSettled = providerJob?.routing?.transportOutcome === 'settled';
  const providerLive = {...record.providerLive, status: record.providerLive.status !== 'REQUESTED' ? record.providerLive.status : providerJob?.status === 'completed' && providerSettled && liveTransport ? 'LIVE_VERIFIED' : providerJob?.status === 'completed' && providerSettled ? 'SYNTHETIC_VERIFIED' : providerJob?.routing?.transportOutcome === 'outcomeUnknown' ? 'OUTCOME_UNKNOWN' : ['failed'].includes(providerJob?.status) ? 'FAILED' : 'REQUESTED', jobStatus: providerJob?.status ?? null, transportOutcome: providerJob?.routing?.transportOutcome ?? null};
  const steps = {
    store: durable?.present ? 'PASSED' : 'PENDING',
    homunculus: record.homunculus.observed ? 'PASSED' : 'BLOCKED',
    kirby: record.kirby.action === 'reuse' ? 'PASSED' : 'BLOCKED',
    jarvis: job?.status === 'completed' ? 'PASSED' : job?.status === 'failed' ? 'FAILED' : job ? 'PENDING' : 'BLOCKED',
    artifact: artifact ? 'PASSED' : 'PENDING',
    executionVerification: execution.executionVerified ? 'PASSED' : job?.status === 'completed' ? 'FAILED' : 'PENDING',
    growth: growth && growth.grade !== 'E' ? 'PASSED' : 'PENDING',
    durableReload: durable?.matched ? 'PASSED' : 'PENDING',
    providerLive: providerLive.status
  };
  const done = ['store', 'homunculus', 'kirby', 'jarvis', 'artifact', 'executionVerification', 'growth', 'durableReload'].every(step => steps[step] === 'PASSED');
  const result = {...record, job: job ? {id: job.id, status: job.status, type: job.type} : null, artifactSha256: artifact?.sha256 ?? null, execution, outcomeVerified: false, growth: growth ? {grade: growth.grade, nextGrade: growth.nextGrade, blockedReason: growth.blockedReason} : null, durableReload: durable, providerLive, steps, status: done ? 'PASSED' : Object.values(steps).some(v => v === 'FAILED') ? 'FAILED' : Object.values(steps).some(v => v === 'BLOCKED') ? 'BLOCKED' : 'RUNNING', processRestart: 'not_performed_by_self_test'};
  assertNoSecrets(result);
  return result;
}
