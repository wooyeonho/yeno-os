import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewCapabilityIntake, SecurityIntakeError } from '../lib/agent-security-intake.mjs';
import { qualifyExternalCandidate } from '../lib/capability-discovery.mjs';

const BASE = {
  sourceUrl: 'https://example.com/research',
  title: '방어적 에이전트 보안 연구',
  summary: '다중 모델 역할 분리와 샌드박스 검증을 비교한다.',
  requestedCapabilities: ['multi-model-orchestration', 'defensive-security-review', 'sandboxed-code-test'],
  requestedActions: ['read public documentation', 'run bounded sandbox fixtures'],
  licenseId: 'MIT',
  licenseReviewed: true,
  readingStatus: 'read',
};

test('safe orchestration and defensive review become a candidate, never an execution grant', () => {
  const result = reviewCapabilityIntake(BASE);
  assert.equal(result.status, 'candidate');
  assert.equal(result.decision, 'candidate');
  assert.equal(result.readingStatus, 'read');
  assert.deepEqual(result.safeCapabilities, BASE.requestedCapabilities);
  assert.equal(result.ownerApprovalRequired, true);
  assert.equal(result.executionBoundary.network, 'deny-by-default');
  assert.equal(result.executionBoundary.credentials, 'none');
});

test('jailbreak and platform/ad evasion are rejected even when the source also mentions useful orchestration', () => {
  const result = reviewCapabilityIntake({...BASE, title: 'Astra jailbreak + multi-model orchestration', summary: 'bypass keyword ad moderation'});
  assert.equal(result.status, 'rejected');
  assert.equal(result.decision, 'rejected');
  assert.ok(result.blockedSignals.includes('jailbreak'));
  assert.ok(result.blockedSignals.includes('evasion'));
  assert.ok(result.blockers.includes('platform_or_ad_evasion'));
});

test('credential extraction is rejected and secrets never enter the result', () => {
  assert.throws(() => reviewCapabilityIntake({...BASE, summary: 'extract API key: sk-abcdefghijklmnopqrstuvwxyz'}), error => error instanceof SecurityIntakeError && error.code === 'secret_like_input');
  assert.throws(() => reviewCapabilityIntake({...BASE, requestedActions: ['dump token=sk-abcdefghijklmnopqrstuvwxyz']}), error => error.code === 'secret_like_input');
});

test('prompt injection and tool poisoning require owner review', () => {
  const result = reviewCapabilityIntake({...BASE, summary: 'scan prompt injection and tool poisoning in an MCP skill'});
  assert.equal(result.status, 'needs_owner_review');
  assert.equal(result.decision, 'pending');
  assert.ok(result.blockedSignals.includes('prompt-injection'));
});

test('AGPL source is preserved as read evidence but cannot auto-enter the registry', () => {
  const result = reviewCapabilityIntake({...BASE, sourceUrl: 'https://github.com/Open-Dev-Society/OpenStock', title: 'OpenStock market research', summary: 'read-only market data research', requestedCapabilities: ['market-data-research'], licenseId: 'AGPL-3.0'});
  assert.equal(result.status, 'needs_owner_review');
  assert.equal(result.decision, 'pending');
  assert.ok(result.blockers.includes('copyleft_license_requires_compatibility_review'));
  assert.equal(result.safeCapabilities[0], 'market-data-research');
});

test('unread or unavailable evidence never becomes a candidate', () => {
  for (const readingStatus of ['unread', 'partial', 'unavailable']) {
    const result = reviewCapabilityIntake({...BASE, readingStatus});
    assert.equal(result.status, 'needs_owner_review');
    assert.equal(result.decision, 'pending');
    assert.ok(result.blockers.includes('source_not_fully_read'));
  }
});

test('external effects are not silently authorized', () => {
  const result = reviewCapabilityIntake({...BASE, requestedActions: ['publish a post', 'send an external message']});
  assert.equal(result.status, 'needs_owner_review');
  assert.ok(result.blockers.includes('external_effect_requires_owner'));
});

test('unknown capabilities are fail-closed and fingerprints are deterministic', () => {
  const first = reviewCapabilityIntake({...BASE, requestedCapabilities: ['self-replicating-agent']});
  const second = reviewCapabilityIntake({...BASE, requestedCapabilities: ['self-replicating-agent']});
  assert.equal(first.status, 'needs_owner_review');
  assert.ok(first.blockers.includes('capability_not_allowlisted'));
  assert.equal(first.sourceFingerprint, second.sourceFingerprint);
});

test('invalid source URLs, duplicate fields and malformed states fail closed', () => {
  assert.throws(() => reviewCapabilityIntake({...BASE, sourceUrl: 'http://example.com'}), error => error.code === 'invalid_public_source');
  assert.throws(() => reviewCapabilityIntake({...BASE, requestedCapabilities: ['multi-model-orchestration', 'multi-model-orchestration']}), error => error.code === 'duplicate_capabilities');
  assert.throws(() => reviewCapabilityIntake({...BASE, licenseReviewed: 'yes'}), error => error.code === 'invalid_review_state');
});

test('external capability qualification composes the existing Kirby gate without creating a second engine', () => {
  const candidate = {origin: 'active', engine: 'declarative-v1', id: 'defensive-review', hash: 'a'.repeat(64), verified: true, fixtureCount: 2};
  const safe = qualifyExternalCandidate(candidate, {intake: BASE});
  assert.equal(safe.eligible, true);
  assert.equal(safe.action, 'reuse');
  assert.equal(safe.security.status, 'candidate');
  const blocked = qualifyExternalCandidate(candidate, {intake: {...BASE, title: 'jailbreak', summary: 'bypass safety'}});
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.action, 'blocked');
  assert.ok(blocked.blockers.includes('security:jailbreak_or_guardrail_bypass'));
});
