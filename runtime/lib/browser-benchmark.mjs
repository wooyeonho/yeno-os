// BLACKHOLE Browser Harness benchmark — synthetic evidence only.
//
This module measures deterministic policy behavior in a bounded local suite.
It never calls a provider, opens Chrome, fetches the network, or claims
semantic quality. A result with evidenceClass SANDBOX_SYNTHETIC is a
regression signal, not live browser acceptance.
import {
  buildBrowserArtifact,
  deterministicBrowserVerification,
  normalizeBrowserSnapshot,
  redactSecrets,
  validatePublicHttpsUrl,
  MAX_BODY_BYTES
} from './browser-harness.mjs';

export const BROWSER_BENCHMARK_VERSION = 1;
export const BROWSER_BENCHMARK_EVIDENCE = 'SANDBOX_SYNTHETIC';
const CLASSES = Object.freeze(['url-policy', 'redaction', 'artifact-integrity', 'bounded-dom']);
const ISO = value => typeof value === 'string' && value.endsWith('Z') && Number.isFinite(Date.parse(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fail = code => { throw new Error('Browser benchmark: ' + code); };

function expectThrow(fn) { try { fn(); return false; } catch { return true; } }
function fixture(at) {
  return {
    url: 'https://public.example.test/',
    title: 'Public example',
    revision: 1,
    observedAt: at,
    body: 'A bounded public page used only for local regression.',
    links: [{text: 'Docs', href: 'https://public.example.test/docs'}],
    elements: [{index: 0, role: 'link', text: 'Docs', ariaLabel: 'Docs', name: '', label: 'Docs', inputType: null, enabled: true, visible: true, href: 'https://public.example.test/docs', sensitive: false}]
  };
}

function runCase(name, category, fn) {
  let passed = false;
  let failure = null;
  try { passed = fn() === true; if (!passed) failure = 'assertion_false'; }
  catch (error) { failure = error instanceof Error ? error.message.slice(0, 160) : 'unknown_failure'; }
  return {name, category, passed, evidenceRefs: ['synthetic:browser-harness:' + name], failure};
}

export function runSyntheticBrowserBenchmark({at = new Date().toISOString()} = {}) {
  if (!ISO(at)) fail('invalid_timestamp');
  const snapshot = fixture(at);
  const artifact = buildBrowserArtifact({snapshot, goal: 'read the public page and preserve its title, body, and links', actionEvidence: [{operation: 'WAIT', snapshotRevision: 1}]});
  const deterministic = deterministicBrowserVerification({snapshot, artifact, actionEvidence: [{operation: 'WAIT', snapshotRevision: 1}], providerOutcome: 'settled'});
  const cases = [
    runCase('public_https_allowed', 'url-policy', () => validatePublicHttpsUrl(snapshot.url) === snapshot.url),
    runCase('private_network_blocked', 'url-policy', () => expectThrow(() => validatePublicHttpsUrl('https://127.0.0.1/private'))),
    runCase('secret_redaction', 'redaction', () => !JSON.stringify(redactSecrets({label: 'token: hidden'})).includes('hidden')),
    runCase('artifact_hash_gate', 'artifact-integrity', () => deterministic.status === 'verified' && deterministic.verified === true),
    runCase('unknown_provider_fails_closed', 'artifact-integrity', () => deterministicBrowserVerification({snapshot, artifact, actionEvidence: [{operation: 'WAIT', snapshotRevision: 1}], providerOutcome: 'unknown'}).status === 'rejected'),
    runCase('oversized_dom_blocked', 'bounded-dom', () => expectThrow(() => normalizeBrowserSnapshot({...snapshot, body: 'x'.repeat(MAX_BODY_BYTES + 1)}))),
  ];
  const total = cases.length;
  const passed = cases.filter(item => item.passed).length;
  const failed = total - passed;
  return {
    version: BROWSER_BENCHMARK_VERSION,
    suiteId: 'browser-harness-synthetic-v1',
    evaluatedAt: at,
    evidenceClass: BROWSER_BENCHMARK_EVIDENCE,
    live: false,
    classes: [...CLASSES],
    cases,
    summary: {total, passed, failed, score: total === 0 ? 0 : passed / total},
    baseline: null,
    comparison: 'no_live_baseline',
    providerCalls: 0,
    networkRequests: 0
  };
}

export function validateBrowserBenchmark(result) {
  const keys = ['version', 'suiteId', 'evaluatedAt', 'evidenceClass', 'live', 'classes', 'cases', 'summary', 'baseline', 'comparison', 'providerCalls', 'networkRequests'];
  if (!exact(result, keys)) fail('invalid_result_shape');
  if (result.version !== BROWSER_BENCHMARK_VERSION || result.suiteId !== 'browser-harness-synthetic-v1') fail('invalid_version');
  if (!ISO(result.evaluatedAt) || result.evidenceClass !== BROWSER_BENCHMARK_EVIDENCE || result.live !== false) fail('live_or_timestamp_claim');
  if (!Array.isArray(result.classes) || result.classes.some(item => !CLASSES.includes(item))) fail('invalid_classes');
  if (!Array.isArray(result.cases) || result.cases.length > 32) fail('invalid_cases');
  for (const item of result.cases) {
    if (!exact(item, ['name', 'category', 'passed', 'evidenceRefs', 'failure'])) fail('invalid_case_shape');
    if (typeof item.name !== 'string' || !CLASSES.includes(item.category) || typeof item.passed !== 'boolean') fail('invalid_case');
    if (!Array.isArray(item.evidenceRefs) || item.evidenceRefs.length < 1 || item.evidenceRefs.some(ref => typeof ref !== 'string' || !ref.startsWith('synthetic:'))) fail('invalid_case_evidence');
    if (item.failure !== null && typeof item.failure !== 'string') fail('invalid_case_failure');
  }
  if (!exact(result.summary, ['total', 'passed', 'failed', 'score']) || result.summary.total !== result.cases.length || result.summary.passed !== result.cases.filter(item => item.passed).length || result.summary.failed !== result.summary.total - result.summary.passed || result.summary.score !== (result.summary.total === 0 ? 0 : result.summary.passed / result.summary.total)) fail('invalid_summary');
  if (result.baseline !== null || result.comparison !== 'no_live_baseline' || result.providerCalls !== 0 || result.networkRequests !== 0) fail('invalid_evidence_boundary');
  return true;
}

export function browserBenchmarkStatus({env = process.env, at} = {}) {
  const result = runSyntheticBrowserBenchmark({at});
  validateBrowserBenchmark(result);
  return {
    version: result.version,
    suiteId: result.suiteId,
    evidenceClass: result.evidenceClass,
    live: result.live,
    evaluatedAt: result.evaluatedAt,
    summary: result.summary,
    providerConfigured: env.YENO_JEV_OFFICIAL_ENDPOINT_CONFIRMED === 'true' && typeof env.YENO_JEV_MODEL === 'string' && env.YENO_JEV_MODEL.length > 0
  };
}
// Benchmark output remains synthetic until live acceptance is recorded.
