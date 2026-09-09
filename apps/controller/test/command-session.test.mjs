import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandSession, HttpFailure, PendingCommandConflict } from '../src/command-session.ts';

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
function session(store, send, overrides = {}) {
  return new CommandSession({ origin: 'https://core.example', deviceId: 'device-a', storage: store, createId: () => 'request-a', send, ...overrides });
}

test('definitive 4xx frees the command slot for corrected text and a fresh ID', async () => {
  for (const status of [400, 401, 403, 409, 413, 422, 429]) {
    const store = storage();
    await assert.rejects(session(store, async () => { throw new HttpFailure(status, 'rejected'); }).submit('bad command'));
    let sent;
    const next = session(store, async command => { sent = command; return { kind: 'memory', memory: { text: 'new' } }; }, { createId: () => 'new-id' });
    assert.equal(next.pending, null);
    await next.submit('기억해: new');
    assert.deepEqual(sent, { text: '기억해: new', requestId: 'new-id' });
  }
});

test('network, timeout, 408 and 5xx preserve exact identity across app restart', async () => {
  for (const error of [new TypeError('network'), new DOMException('timed out', 'AbortError'), new HttpFailure(408, 'timeout'), new HttpFailure(500, 'failed'), new HttpFailure(503, 'unavailable')]) {
    const store = storage();
    const first = session(store, async () => { throw error; });
    await assert.rejects(first.submit('문서 만들어: one'));
    const pending = first.pending;
    let sent;
    const restarted = session(store, async command => { sent = command; return { kind: 'job', job: { id: 'same-job' } }; });
    await assert.rejects(restarted.submit('문서 만들어: different'), PendingCommandConflict);
    assert.deepEqual(restarted.pending, pending);
    await restarted.submit(pending.text);
    assert.deepEqual(sent, pending);
    assert.equal(restarted.pending, null);
    assert.equal(session(store, async () => {}).receipt.payload.job.id, 'same-job');
  }
});

test('rapid identical submissions coalesce; different text cannot replace in-flight work', async () => {
  let resolve, calls = 0;
  const current = session(storage(), () => { calls++; return new Promise(done => { resolve = done; }); });
  const first = current.submit('찾아줘: notes');
  const second = current.submit('찾아줘: notes');
  assert.equal(first, second);
  await assert.rejects(current.submit('기억해: different'), PendingCommandConflict);
  assert.throws(() => current.clearLocal(), /접수 확인/);
  resolve({ kind: 'search', memories: [] });
  await first;
  assert.equal(calls, 1);
});

test('pending commands and receipts never cross origin or device boundaries', async () => {
  const store = storage();
  const first = session(store, async () => { throw new TypeError('network'); });
  await assert.rejects(first.submit('기억해: private'));
  assert.equal(session(store, async () => {}, { deviceId: 'device-b' }).pending, null);
  assert.equal(session(store, async () => {}, { origin: 'https://other.example' }).pending, null);
  const restored = session(store, async () => ({ kind: 'memory', memory: { text: 'private' } }));
  await restored.submit('기억해: private');
  assert.equal(session(store, async () => {}, { deviceId: 'device-b' }).receipt, null);
  assert.equal(session(store, async () => {}, { origin: 'https://other.example' }).receipt, null);
  assert.equal(restored.receipt.payload.memory.text, 'private');
});

test('failed pending persistence prevents any transmission', async () => {
  let calls = 0;
  const store = storage();
  store.setItem = () => { throw new Error('disk full'); };
  const current = session(store, async () => { calls++; });
  await assert.rejects(current.submit('기억해: save first'), /disk full/);
  assert.equal(calls, 0);
});

test('failed receipt persistence retains exact request and can recover after restart', async () => {
  const store = storage(), set = store.setItem;
  store.setItem = (key, value) => { if (key.endsWith(':receipt')) throw new Error('disk full'); set(key, value); };
  const current = session(store, async () => ({ kind: 'memory', memory: { id: 'one' } }));
  await assert.rejects(current.submit('기억해: one'), /disk full/);
  assert.equal(current.pending.requestId, 'request-a');
  store.setItem = set;
  let sent;
  await session(store, async command => { sent = command; return { kind: 'memory', memory: { id: 'one' } }; }).submit('기억해: one');
  assert.equal(sent.requestId, 'request-a');
});
