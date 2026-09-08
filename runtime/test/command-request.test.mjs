import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandRequest} from '../public/command-request.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), {status});

test('command is persisted before transport and accepted receipt clears it', async () => {
  const storage = memoryStorage();
  const body = {type: 'document', text: '휴대폰에서 보낸 원문'};
  const request = createCommandRequest({storage, makeId: () => 'request-one', transport: async (path, sent) => {
    assert.equal(path, '/api/jobs');
    assert.deepEqual(sent, {type: 'document', text: '휴대폰에서 보낸 원문', requestId: 'request-one'});
    assert.equal(JSON.parse([...storage.values.values()][0]).body.requestId, sent.requestId);
    return {job: {id: 'job-one', status: 'queued'}};
  }});
  request.stage('/api/jobs', body);
  body.text = '전송할 원문을 바꾸면 안 됨';
  const displayed = request.pending;
  displayed.body.text = '화면에서 수정해도 보관 원문은 유지';
  const outcome = await request.send();
  assert.equal(outcome.kind, 'accepted');
  assert.equal(outcome.result.job.status, 'queued');
  assert.equal(request.pending, null);
  assert.equal(storage.values.size, 0);
});

test('lost response after server acceptance survives reload and retry executes once', async () => {
  const storage = memoryStorage(), receipts = new Map(), sentRequests = [];
  let executions = 0, loseFirstResponse = true;
  async function server(path, body) {
    sentRequests.push({path, body: structuredClone(body)});
    if (!receipts.has(body.requestId)) {
      executions += 1;
      receipts.set(body.requestId, {job: {id: `job-${executions}`, status: 'queued'}});
    }
    if (loseFirstResponse) {loseFirstResponse = false; throw new TypeError('Network connection lost after acceptance');}
    return receipts.get(body.requestId);
  }
  const beforeReload = createCommandRequest({storage, transport: server, makeId: () => 'stable-request'});
  beforeReload.stage('/api/commands', {text: '문서 만들어: 동일 요청 확인'});
  assert.equal((await beforeReload.send()).kind, 'uncertain');
  assert.equal(executions, 1);
  assert.equal(beforeReload.pending.body.requestId, 'stable-request');

  const afterReload = createCommandRequest({storage, transport: server, makeId: () => {throw new Error('Reload retry must not create a new ID');}});
  assert.deepEqual(afterReload.pending, beforeReload.pending);
  const retry = await afterReload.send();
  assert.equal(retry.kind, 'accepted');
  assert.equal(retry.result.job.id, 'job-1');
  assert.equal(executions, 1);
  assert.deepEqual(sentRequests[0], sentRequests[1]);
  assert.equal(afterReload.pending, null);
});

test('timeouts and server errors retain the request while definite rejection clears it', async () => {
  const storage = memoryStorage();
  let failure = httpError(503);
  const request = createCommandRequest({storage, makeId: () => 'retry-me', transport: async () => {throw failure;}});
  request.stage('/api/jobs', {type: 'diagnostics'});
  for (const error of [httpError(503), httpError(500), httpError(408), new DOMException('Timeout', 'TimeoutError')]) {
    failure = error;
    assert.equal((await request.send()).kind, 'uncertain');
    assert.equal(request.pending.body.requestId, 'retry-me');
    assert.equal(storage.values.size, 1);
  }
  failure = httpError(422);
  assert.equal((await request.send()).kind, 'rejected');
  assert.equal(request.pending, null);
  assert.equal(storage.values.size, 0);
  request.stage('/api/jobs', {type: 'document', text: '거절 확인 후 새 명령'});
  assert.equal(request.pending.body.text, '거절 확인 후 새 명령');
});

test('an unresolved request blocks replacement and overlapping sends share one transport', async () => {
  const storage = memoryStorage();
  let release, calls = 0;
  const request = createCommandRequest({storage, makeId: () => 'one-command', transport: () => {
    calls += 1;
    return new Promise(resolve => {release = resolve;});
  }});
  request.stage('/api/jobs', {type: 'evolution'});
  assert.throws(() => request.stage('/api/jobs', {type: 'diagnostics'}), /접수 여부/);
  const first = request.send(), duplicateClick = request.send();
  assert.equal(first, duplicateClick);
  assert.equal(request.sending, true);
  await Promise.resolve();
  assert.equal(calls, 1);
  release({job: {id: 'only-job', status: 'queued'}});
  await first;
  assert.equal(request.sending, false);
  assert.equal(request.pending, null);
});

test('unavailable or corrupt storage fails closed before any command is sent', async () => {
  let calls = 0;
  const storage = memoryStorage();
  storage.setItem = () => {throw new Error('Storage full');};
  const request = createCommandRequest({storage, makeId: () => 'never-sent', transport: async () => {calls += 1;}});
  assert.throws(() => request.stage('/api/jobs', {type: 'diagnostics'}), /Storage full/);
  assert.equal(request.pending, null);
  assert.equal(calls, 0);
  for (const corrupt of ['{broken', 'null', '{"version":1,"path":"/api/control","body":{"requestId":"old"}}']) {
    assert.throws(() => createCommandRequest({storage: {getItem: () => corrupt}, transport: async () => {calls += 1;}}));
  }
  assert.equal(calls, 0);
});

test('failure to clear an accepted request keeps the same ID for a safe retry', async () => {
  const storage = memoryStorage();
  const remove = storage.removeItem;
  storage.removeItem = () => {throw new Error('Storage removal unavailable');};
  const request = createCommandRequest({storage, makeId: () => 'accepted-but-retained', transport: async () => ({job: {id: 'known-job', status: 'queued'}})});
  request.stage('/api/jobs', {type: 'diagnostics'});
  assert.equal((await request.send()).kind, 'uncertain');
  assert.equal(request.pending.body.requestId, 'accepted-but-retained');
  storage.removeItem = remove;
  assert.equal((await request.send()).kind, 'accepted');
  assert.equal(request.pending, null);
});
