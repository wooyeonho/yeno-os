import crypto from 'node:crypto';
import { sourceUrl } from './sources.mjs';

export const SECURITY_INTAKE_VERSION = 1;
export const SECURITY_INTAKE_STATUSES = Object.freeze(['candidate', 'needs_owner_review', 'rejected']);
export const SECURITY_INTAKE_DECISIONS = Object.freeze(['candidate', 'pending', 'rejected']);
export const SAFE_CAPABILITIES = Object.freeze([
  'multi-model-orchestration',
  'defensive-security-review',
  'sandboxed-code-test',
  'read-only-browser',
  'market-data-research',
  'tos-compliant-ad-analytics',
  'capability-registry',
]);

const READING = new Set(['unread', 'partial', 'read', 'unavailable']);
const INPUT_FIELDS = Object.freeze([
  'sourceUrl',
  'title',
  'summary',
  'requestedCapabilities',
  'requestedActions',
  'licenseId',
  'licenseReviewed',
  'readingStatus',
]);
const SECRET_VALUE = /(?:sk-[A-Za-z0-9_-]{12,}|xai-[A-Za-z0-9_-]{12,}|nvapi-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})/;
const SECRET_ASSIGNMENT = /(?:api[_ -]?key|password|passwd|secret|token|authorization|credential)\s*[:=]\s*\S+/i;
const JAILBREAK = /\bjailbreak\b|탈옥|재탈옥|guardrail.{0,24}(?:bypass|evasion)|safety.{0,24}(?:bypass|override)|안전.{0,12}우회|정책.{0,12}우회/i;
const EVASION = /(?:(?:ad|keyword|creative|moderation|platform|policy).{0,28}(?:bypass|circumvent|evad|우회)|(?:bypass|circumvent|evad|우회).{0,28}(?:ad|keyword|creative|moderation|platform|policy)|광고.{0,18}우회|소재.{0,18}우회|플랫폼.{0,18}우회)/i;
const CREDENTIAL_EXFILTRATION = /(?:steal|dump|extract|exfiltrat|leak).{0,36}(?:api[_ -]?key|token|password|secret|credential)|(?:api[_ -]?key|token|password|secret).{0,36}(?:훔치|탈취|빼내|유출)/i;
const PROMPT_INJECTION = /prompt injection|ignore (?:all|any|the|previous) instructions|system prompt|tool poisoning|rug pull|프롬프트 인젝션|도구 오염|지시 무시/i;
const EXTERNAL_EFFECT = /\b(?:publish|post|send|pay|payment|login|subscribe|upload|delete)\b|게시|발행|발송|결제|로그인|구독|업로드|삭제/i;
const COPYLEFT = /^(?:AGPL|GPL|LGPL|EUPL|SSPL)(?:[-.0-9]|$)/i;
const PERMISSIVE = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'MPL-2.0']);
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : JSON.stringify(value);
const sha256 = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = (value, field, max, required = false) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) throw new SecurityIntakeError('invalid_' + field);
  return value.trim();
};

export class SecurityIntakeError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function validateInput(input) {
  if (!object(input) || Object.keys(input).some(key => !INPUT_FIELDS.includes(key)) || INPUT_FIELDS.some(key => !Object.hasOwn(input, key))) throw new SecurityIntakeError('invalid_intake_shape');
  const sourceUrlValue = clean(input.sourceUrl, 'source_url', 2048, true);
  let source;
  try { source = sourceUrl(sourceUrlValue); } catch { throw new SecurityIntakeError('invalid_public_source'); }
  const title = clean(input.title, 'title', 160, true);
  const summary = clean(input.summary, 'summary', 12000, true);
  if (!Array.isArray(input.requestedCapabilities) || input.requestedCapabilities.length > 12 || input.requestedCapabilities.length === 0 || input.requestedCapabilities.some(value => typeof value !== 'string' || value.length > 80)) throw new SecurityIntakeError('invalid_capabilities');
  if (new Set(input.requestedCapabilities).size !== input.requestedCapabilities.length) throw new SecurityIntakeError('duplicate_capabilities');
  const requestedActions = input.requestedActions;
  if (!Array.isArray(requestedActions) || requestedActions.length > 12 || requestedActions.some(value => typeof value !== 'string' || value.length > 160)) throw new SecurityIntakeError('invalid_actions');
  if (new Set(requestedActions).size !== requestedActions.length) throw new SecurityIntakeError('duplicate_actions');
  if (input.licenseId !== null && (typeof input.licenseId !== 'string' || input.licenseId.length > 40 || !/^[A-Za-z0-9.+-]+$/.test(input.licenseId))) throw new SecurityIntakeError('invalid_license');
  if (typeof input.licenseReviewed !== 'boolean' || !READING.has(input.readingStatus)) throw new SecurityIntakeError('invalid_review_state');
  const allText = [sourceUrlValue, title, summary, ...input.requestedCapabilities, ...requestedActions].join('\n');
  if (SECRET_VALUE.test(allText) || SECRET_ASSIGNMENT.test(allText)) throw new SecurityIntakeError('secret_like_input');
  return {sourceUrl: sourceUrlValue, canonicalUrl: source.canonicalUrl, title, summary, requestedCapabilities: [...input.requestedCapabilities], requestedActions: [...requestedActions], licenseId: input.licenseId, licenseReviewed: input.licenseReviewed, readingStatus: input.readingStatus};
}

function signalList(input) {
  const text = [input.title, input.summary, ...input.requestedCapabilities].join('\n');
  const actionText = input.requestedActions.join('\n');
  const signals = [];
  if (JAILBREAK.test(text)) signals.push('jailbreak');
  if (EVASION.test(text)) signals.push('evasion');
  if (CREDENTIAL_EXFILTRATION.test(text)) signals.push('credential-exfiltration');
  if (PROMPT_INJECTION.test(text)) signals.push('prompt-injection');
  if (PROMPT_INJECTION.test(actionText) && !signals.includes('prompt-injection')) signals.push('prompt-injection');
  if (EXTERNAL_EFFECT.test(actionText)) signals.push('external-effect');
  if (input.requestedCapabilities.some(capability => !SAFE_CAPABILITIES.includes(capability))) signals.push('unknown-capability');
  if (!input.licenseReviewed || !input.licenseId || (!PERMISSIVE.has(input.licenseId) && !COPYLEFT.test(input.licenseId))) signals.push('license-review');
  if (input.licenseId && COPYLEFT.test(input.licenseId) && !signals.includes('license-review')) signals.push('license-review');
  return signals;
}

function reasonsFor(signals, input) {
  const reasons = [];
  if (signals.includes('jailbreak')) reasons.push('jailbreak_or_guardrail_bypass');
  if (signals.includes('evasion')) reasons.push('platform_or_ad_evasion');
  if (signals.includes('credential-exfiltration')) reasons.push('credential_exfiltration');
  if (signals.includes('prompt-injection')) reasons.push('prompt_injection_or_tool_poisoning');
  if (signals.includes('external-effect')) reasons.push('external_effect_requires_owner');
  if (signals.includes('unknown-capability')) reasons.push('capability_not_allowlisted');
  if (signals.includes('license-review')) {
    if (input.licenseId && COPYLEFT.test(input.licenseId)) reasons.push('copyleft_license_requires_compatibility_review');
    else reasons.push('license_not_verified');
  }
  if (input.readingStatus !== 'read') reasons.push('source_not_fully_read');
  return [...new Set(reasons)];
}

export function reviewCapabilityIntake(raw) {
  const input = validateInput(raw);
  const signals = signalList(input);
  const blockers = reasonsFor(signals, input);
  const hardReject = signals.some(signal => ['jailbreak', 'evasion', 'credential-exfiltration'].includes(signal));
  const status = hardReject ? 'rejected' : blockers.length ? 'needs_owner_review' : 'candidate';
  const decision = status === 'candidate' ? 'candidate' : status === 'rejected' ? 'rejected' : 'pending';
  const sourceFingerprint = sha256({
    sourceUrl: input.canonicalUrl,
    title: input.title,
    summary: sha256(input.summary),
    requestedCapabilities: input.requestedCapabilities,
    requestedActions: input.requestedActions,
    licenseId: input.licenseId,
    licenseReviewed: input.licenseReviewed,
    readingStatus: input.readingStatus,
  });
  const result = {
    version: SECURITY_INTAKE_VERSION,
    status,
    readingStatus: input.readingStatus,
    decision,
    canonicalUrl: input.canonicalUrl,
    sourceFingerprint,
    safeCapabilities: input.requestedCapabilities.filter(capability => SAFE_CAPABILITIES.includes(capability)),
    blockedSignals: signals,
    blockers,
    ownerApprovalRequired: true,
    executionBoundary: {
      sandboxRequired: true,
      network: 'deny-by-default',
      credentials: 'none',
      externalEffects: 'owner-approved-only',
      codeExecution: 'isolated-only',
    },
  };
  if (result.status === 'candidate' && result.decision !== 'candidate') throw new SecurityIntakeError('candidate_gate_inconsistent');
  if (result.status !== 'candidate' && result.decision === 'candidate') throw new SecurityIntakeError('pending_gate_inconsistent');
  return result;
}
