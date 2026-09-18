import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {initialState, openStore, digest} from '../lib/store.mjs';
import {enqueue} from '../lib/memory-sync-outbox.mjs';
import {createMemoryEvent, addMemoryEvent} from '../lib/memory-events.mjs';

// BLACKHOLE Durable Memory Fabric (Phase B) — store.mjs/backup.mjs migration:
// a state.json saved before this phase existed (no memorySyncOutbox field at
// all) must open cleanly with an empty outbox migrated in, and a tampered
// outbox that disagrees with the real memoryEvents ledger must fail the
// runtime closed at startup rather than silently loading.

function writeEnvelope(dir, state) {
  const payload = JSON.stringify(state);
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({format: 1, sha256: digest(payload), payload}));
}

test('a pre-Phase-B state.json with no memorySyncOutbox field at all migrates in cleanly as an empty outbox', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-fabric-migration-'));
  try {
    const state = initialState();
    delete state.memorySyncOutbox;
    writeEnvelope(dir, state);
    const opened = openStore(dir);
    assert.deepEqual(opened.state.memorySyncOutbox, []);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('an outbox item pointing at a memory event with a disagreeing fingerprint fails the runtime closed at startup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-fabric-tamper-'));
  try {
    const state = initialState();
    const event = createMemoryEvent({type: 'episode', text: 'e', confidence: 0.5, projectId: null, questId: null, sourceRefs: []}, state, {at: new Date().toISOString()});
    state.memoryEvents = addMemoryEvent(state.memoryEvents, event, state);
    let outbox = enqueue([], event, ['obsidian'], new Date().toISOString());
    outbox = [{...outbox[0], fingerprint: 'f'.repeat(64)}];
    state.memorySyncOutbox = outbox;
    writeEnvelope(dir, state);
    assert.throws(() => openStore(dir), /Both state and backup are unreadable/);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('a real outbox referencing a real, matching memory event opens cleanly and round-trips exactly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-fabric-clean-'));
  try {
    const state = initialState();
    const event = createMemoryEvent({type: 'decision', text: 'clean round trip', confidence: 0.6, projectId: null, questId: null, sourceRefs: []}, state, {at: new Date().toISOString()});
    state.memoryEvents = addMemoryEvent(state.memoryEvents, event, state);
    state.memorySyncOutbox = enqueue([], event, ['supabase', 'obsidian'], new Date().toISOString());
    writeEnvelope(dir, state);
    const opened = openStore(dir);
    assert.equal(opened.state.memorySyncOutbox.length, 2);
    assert.equal(opened.state.memoryEvents.length, 1);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
