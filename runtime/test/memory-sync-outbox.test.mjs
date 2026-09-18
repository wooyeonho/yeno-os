import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {
  enqueue, applyOutcome, requeueForReconciliation, pendingItems, outboxSummary,
  validateOutbox, validateOutboxItem, MemorySyncError, SYNC_DESTINATIONS, SYNC_STATUSES,
  MAX_ATTEMPTS_BEFORE_FAILED, MAX_OUTBOX_ITEMS,
} from '../lib/memory-sync-outbox.mjs';
import {createMemoryEvent} from '../lib/memory-events.mjs';

// BLACKHOLE Durable Memory Fabric (Phase B) — the sync outbox is the smallest
// durable structure for at-least-once delivery to idempotent destinations.
// These are pure-function tests: no network, no filesystem, no server.

const at = (offsetMs = 0) => new Date(Date.parse('2026-09-18T00:00:00.000Z') + offsetMs).toISOString();
function baseState(events = []) {
  return {projects: [], quests: [], memoryEvents: events};
}
function event(overrides = {}) {
  const state = baseState();
  return createMemoryEvent({type: 'episode', text: 'evt', confidence: 0.5, projectId: null, questId: null, sourceRefs: [], ...overrides}, state, {at: at()});
}

test('enqueue is idempotent: queuing the same event for the same destination twice never creates a second item', () => {
  const e = event();
  let outbox = enqueue([], e, ['supabase', 'obsidian'], at());
  assert.equal(outbox.length, 2);
  outbox = enqueue(outbox, e, ['supabase', 'obsidian'], at(1000));
  assert.equal(outbox.length, 2, 're-enqueueing an already-queued destination must be a no-op, not a duplicate');
  for (const item of outbox) {
    assert.equal(item.eventId, e.id);
    assert.equal(item.fingerprint, e.fingerprint);
    assert.equal(item.status, 'pending');
    assert.equal(item.attempts, 0);
  }
  validateOutbox(outbox, baseState([e]));
});

test('enqueue rejects an unknown destination and never partially mutates the outbox', () => {
  const e = event();
  assert.throws(() => enqueue([], e, ['supabase', 'not-a-destination'], at()), MemorySyncError);
});

test('applyOutcome: synced requires a safe remoteRef and clears retry/error state', () => {
  const e = event();
  let outbox = enqueue([], e, ['supabase'], at());
  assert.throws(() => applyOutcome(outbox, e.id, 'supabase', {result: 'synced', remoteRef: null}, at(1000)), MemorySyncError);
  outbox = applyOutcome(outbox, e.id, 'supabase', {result: 'synced', remoteRef: e.id}, at(1000));
  const item = outbox[0];
  assert.equal(item.status, 'synced');
  assert.equal(item.attempts, 1);
  assert.equal(item.syncedAt, at(1000));
  assert.equal(item.remoteRef, e.id);
  assert.equal(item.lastErrorCode, null);
  assert.equal(item.nextRetryAt, null);
});

test('applyOutcome: retryable only accepts unavailable/timeout, applies bounded exponential backoff and stays pending', () => {
  const e = event();
  let outbox = enqueue([], e, ['supabase'], at());
  assert.throws(() => applyOutcome(outbox, e.id, 'supabase', {result: 'retryable', errorCode: 'unauthorized'}, at(1000)), MemorySyncError, 'unauthorized must never be classified retryable');
  outbox = applyOutcome(outbox, e.id, 'supabase', {result: 'retryable', errorCode: 'timeout'}, at(1000));
  assert.equal(outbox[0].status, 'pending');
  assert.equal(outbox[0].attempts, 1);
  assert.ok(Date.parse(outbox[0].nextRetryAt) > Date.parse(at(1000)), 'a retryable outcome must set a future backoff window, never an immediate retry');
});

test('applyOutcome: retryable exhausts to failed after MAX_ATTEMPTS_BEFORE_FAILED, never retries forever', () => {
  const e = event();
  let outbox = enqueue([], e, ['supabase'], at());
  for (let i = 1; i < MAX_ATTEMPTS_BEFORE_FAILED; i++) {
    outbox = applyOutcome(outbox, e.id, 'supabase', {result: 'retryable', errorCode: 'unavailable'}, at(i * 1000));
    assert.equal(outbox[0].status, 'pending', `attempt ${i} should still be pending`);
  }
  outbox = applyOutcome(outbox, e.id, 'supabase', {result: 'retryable', errorCode: 'unavailable'}, at(MAX_ATTEMPTS_BEFORE_FAILED * 1000));
  assert.equal(outbox[0].status, 'failed', 'the attempt that reaches the cap must convert to failed, not retry indefinitely');
  assert.equal(outbox[0].attempts, MAX_ATTEMPTS_BEFORE_FAILED);
  assert.equal(outbox[0].nextRetryAt, null);
});

test('applyOutcome: failed and blocked require a valid error code and never auto-recover', () => {
  const e = event();
  let outbox = enqueue([], e, ['obsidian'], at());
  assert.throws(() => applyOutcome(outbox, e.id, 'obsidian', {result: 'failed', errorCode: 'not-a-real-code'}, at(1000)), MemorySyncError);
  outbox = applyOutcome(outbox, e.id, 'obsidian', {result: 'blocked', errorCode: 'fingerprint_mismatch'}, at(1000));
  assert.equal(outbox[0].status, 'blocked');
  assert.equal(outbox[0].lastErrorCode, 'fingerprint_mismatch');
});

test('applyOutcome rejects an item that does not exist in the outbox', () => {
  assert.throws(() => applyOutcome([], randomUUID(), 'supabase', {result: 'synced', remoteRef: 'x'}, at()), MemorySyncError);
});

test('requeueForReconciliation only moves failed/blocked items back to pending, and only explicitly', () => {
  const e = event();
  let outbox = enqueue([], e, ['supabase'], at());
  assert.throws(() => requeueForReconciliation(outbox, e.id, 'supabase', at(1000)), MemorySyncError, 'a pending item can never be requeued');
  outbox = applyOutcome(outbox, e.id, 'supabase', {result: 'failed', errorCode: 'unauthorized'}, at(1000));
  outbox = requeueForReconciliation(outbox, e.id, 'supabase', at(2000));
  assert.equal(outbox[0].status, 'pending');
  assert.equal(outbox[0].nextRetryAt, null);
  assert.equal(outbox[0].fingerprint, e.fingerprint, 'reconciliation must never mutate the idempotency-key fingerprint');
});

test('pendingItems is bounded, ordered oldest-first, filters by destination and respects the backoff window', () => {
  const e1 = event({text: 'first'});
  const e2 = event({text: 'second'});
  let outbox = enqueue([], e1, ['supabase'], at(0));
  outbox = enqueue(outbox, e2, ['supabase', 'obsidian'], at(500));
  outbox = applyOutcome(outbox, e1.id, 'supabase', {result: 'retryable', errorCode: 'timeout'}, at(1000));
  const stillBackingOff = pendingItems(outbox, {destination: 'supabase', now: at(1000), limit: 10});
  assert.deepEqual(stillBackingOff.map(i => i.eventId), [e2.id], 'an item inside its own backoff window must not be picked up early');
  const afterBackoff = pendingItems(outbox, {destination: 'supabase', now: at(120_000), limit: 10});
  assert.deepEqual(afterBackoff.map(i => i.eventId), [e1.id, e2.id], 'once backoff expires the oldest queued item must sort first');
  const bounded = pendingItems(outbox, {destination: 'supabase', now: at(120_000), limit: 1});
  assert.equal(bounded.length, 1, 'a scheduler batch must never exceed its own limit');
  const obsidianOnly = pendingItems(outbox, {destination: 'obsidian', now: at(0), limit: 10});
  assert.deepEqual(obsidianOnly.map(i => i.eventId), [e2.id]);
});

test('outboxSummary reports counts and the latest successful sync timestamp only, never per-item detail', () => {
  const e1 = event({text: 'a'});
  const e2 = event({text: 'b'});
  let outbox = enqueue([], e1, ['supabase'], at(0));
  outbox = enqueue(outbox, e2, ['supabase'], at(0));
  outbox = applyOutcome(outbox, e1.id, 'supabase', {result: 'synced', remoteRef: e1.id}, at(1000));
  outbox = applyOutcome(outbox, e2.id, 'supabase', {result: 'blocked', errorCode: 'remote_conflict'}, at(2000));
  const summary = outboxSummary(outbox, 'supabase');
  assert.equal(summary.total, 2);
  assert.equal(summary.counts.synced, 1);
  assert.equal(summary.counts.blocked, 1);
  assert.equal(summary.counts.pending, 0);
  assert.equal(summary.lastSyncedAt, at(1000));
  assert.equal(Object.keys(summary).includes('remoteRef'), false);
});

test('validateOutbox cross-checks each item against the real memory event it names and rejects a mismatched fingerprint', () => {
  const e = event();
  let outbox = enqueue([], e, ['supabase'], at());
  validateOutbox(outbox, baseState([e]));
  assert.throws(() => validateOutbox(outbox, baseState([])), MemorySyncError, 'an outbox item pointing at a non-existent memory event must fail closed');
  const tampered = [{...outbox[0], fingerprint: 'f'.repeat(64)}];
  assert.throws(() => validateOutbox(tampered, baseState([e])), MemorySyncError, 'a fingerprint that disagrees with the real event must be detected as tampering');
});

test('validateOutbox rejects a duplicate eventId+destination pair even if hand-constructed', () => {
  const e = event();
  const item = {
    eventId: e.id, destination: 'supabase', fingerprint: e.fingerprint, status: 'pending', attempts: 0,
    firstQueuedAt: at(), lastAttemptAt: null, syncedAt: null, remoteRef: null, lastErrorCode: null, nextRetryAt: null,
  };
  assert.throws(() => validateOutbox([item, {...item}], baseState([e])), MemorySyncError);
});

test('validateOutboxItem enforces cross-field consistency so a hand-tampered item cannot pass', () => {
  const e = event();
  const base = {
    eventId: e.id, destination: 'supabase', fingerprint: e.fingerprint, status: 'pending', attempts: 0,
    firstQueuedAt: at(), lastAttemptAt: null, syncedAt: null, remoteRef: null, lastErrorCode: null, nextRetryAt: null,
  };
  assert.throws(() => validateOutboxItem({...base, status: 'synced'}), MemorySyncError, 'synced without syncedAt/remoteRef must be rejected');
  assert.throws(() => validateOutboxItem({...base, status: 'pending', remoteRef: 'x'}), MemorySyncError, 'pending with a remoteRef must be rejected');
  assert.throws(() => validateOutboxItem({...base, status: 'failed', lastErrorCode: null}), MemorySyncError, 'failed without an error code must be rejected');
  assert.throws(() => validateOutboxItem({...base, status: 'synced', syncedAt: at(), remoteRef: `ghp_${'x'.repeat(36)}`}), Error, 'a credential-shaped remoteRef must be rejected');
  assert.equal(validateOutboxItem(base), true);
});

test('an outbox never exceeds its own storage cap', () => {
  const events = Array.from({length: 3}, (_, i) => event({text: `evt ${i}`}));
  let outbox = [];
  for (const e of events) outbox = enqueue(outbox, e, ['supabase'], at());
  assert.equal(outbox.length, 3);
  assert.ok(MAX_OUTBOX_ITEMS > 3);
});

test('SYNC_DESTINATIONS and SYNC_STATUSES are the exact frozen taxonomies the rest of the fabric relies on', () => {
  assert.deepEqual(SYNC_DESTINATIONS, ['supabase', 'obsidian']);
  assert.deepEqual(SYNC_STATUSES, ['pending', 'synced', 'failed', 'blocked']);
  assert.ok(Object.isFrozen(SYNC_DESTINATIONS));
  assert.ok(Object.isFrozen(SYNC_STATUSES));
});
