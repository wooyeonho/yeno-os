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

test('project edits preserve the original revision and payload across timeout and reload', async () => {
  const storage = memoryStorage();
  const allowPath = path => path === '/api/projects' || /^\/api\/projects\/[a-zA-Z0-9-]+\/update$/.test(path);
  const path = '/api/projects/project-one/update';
  const sent = [], receipts = new Map();
  let loseResponse = true, revision = 4;
  const transport = async (url, body) => {
    sent.push({url, body: structuredClone(body)});
    if (!receipts.has(body.requestId)) {
      assert.equal(body.revision, revision);
      revision += 1;
      receipts.set(body.requestId, {project: {id: 'project-one', name: body.name, version: revision}});
    }
    if (loseResponse) {loseResponse = false; throw new DOMException('Response lost after save', 'TimeoutError');}
    return receipts.get(body.requestId);
  };
  const options = {storage, transport, allowPath, key: 'project-queue', makeId: () => 'project-edit-request'};
  const before = createCommandRequest(options);
  before.stage(path, {revision: 4, name: 'YENO', nextAction: '실제 재시작 검증'});
  assert.equal((await before.send()).kind, 'uncertain');
  assert.equal(revision, 5);
  const commands = createCommandRequest({storage, transport: async () => ({job: {id: 'independent-command'}}), makeId: () => 'command-request'});
  commands.stage('/api/jobs', {type: 'diagnostics'});
  assert.equal((await commands.send()).kind, 'accepted');
  assert.equal(storage.values.size, 1, 'unrelated command must not clear the pending project edit');
  const reloaded = createCommandRequest({...options, makeId: () => {throw new Error('Retry must preserve its ID');}});
  assert.equal(reloaded.pending.body.revision, 4);
  const accepted = await reloaded.send();
  assert.equal(accepted.kind, 'accepted');
  assert.equal(accepted.result.project.version, 5);
  assert.equal(revision, 5);
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(reloaded.pending, null);
});

test('project path access requires explicit opt-in and only definite rejections clear project requests', async () => {
  const storage = memoryStorage();
  const defaultRequests = createCommandRequest({storage, transport: async () => ({})});
  assert.throws(() => defaultRequests.stage('/api/projects', {name: 'YENO'}), /지원하지 않는/);
  let failure = httpError(500);
  const projectRequests = createCommandRequest({storage, key: 'project-queue', makeId: () => 'project-request',
    allowPath: path => path === '/api/projects', transport: async () => {throw failure;}});
  assert.throws(() => projectRequests.stage('/api/control', {action: 'resume'}), /지원하지 않는/);
  assert.throws(() => projectRequests.stage('https://example.com/api/projects', {name: 'YENO'}), /지원하지 않는/);
  projectRequests.stage('/api/projects', {name: 'YENO'});
  assert.equal((await projectRequests.send()).kind, 'uncertain');
  assert.equal(projectRequests.pending.body.requestId, 'project-request');
  failure = httpError(400);
  assert.equal((await projectRequests.send()).kind, 'rejected');
  assert.equal(projectRequests.pending, null);
  projectRequests.stage('/api/projects', {name: 'YENO'});
  failure = httpError(409);
  assert.equal((await projectRequests.send()).kind, 'rejected');
  assert.equal(projectRequests.pending, null);
  storage.setItem('project-queue', JSON.stringify({version: 1, path: '/api/control', body: {requestId: 'invalid-reload'}}));
  assert.throws(() => createCommandRequest({storage, key: 'project-queue', transport: async () => ({}), allowPath: path => path === '/api/projects'}), /보관된 명령/);
});

test('authentication failures after a lost response retain the receipt identity through reauthentication', async () => {
  for (const path of ['/api/commands', '/api/projects']) {
    const storage = memoryStorage(), receipts = new Map(), sent = [];
    let executions = 0, loseFirstResponse = true, authFailure = null;
    const transport = async (url, body) => {
      sent.push({url, body: structuredClone(body)});
      // Like the core, authentication rejects before consulting the ledger.
      if (authFailure) throw httpError(authFailure);
      if (!receipts.has(body.requestId)) {
        executions += 1;
        receipts.set(body.requestId, {acceptedId: 'first-and-only-result'});
      }
      if (loseFirstResponse) {loseFirstResponse = false; throw new TypeError('Response lost after acceptance');}
      return receipts.get(body.requestId);
    };
    const options = {storage, transport, makeId: () => 'auth-continuity-request',
      ...(path === '/api/projects' ? {key: 'project-queue', allowPath: candidate => candidate === path} : {})};
    let requests = createCommandRequest(options);
    requests.stage(path, path === '/api/projects' ? {name: 'YENO'} : {text: '문서 만들어: 인증 재연결 검사'});
    assert.equal((await requests.send()).kind, 'uncertain');
    assert.equal(executions, 1);
    for (const status of [401, 403]) {
      authFailure = status;
      assert.equal((await requests.send()).kind, 'uncertain');
      assert.equal(requests.pending.body.requestId, 'auth-continuity-request');
      assert.equal(storage.values.size, 1);
    }
    requests = createCommandRequest({...options, makeId: () => {throw new Error('Reauthentication must preserve the pending ID');}});
    authFailure = null;
    const accepted = await requests.send();
    assert.equal(accepted.kind, 'accepted');
    assert.equal(accepted.result.acceptedId, 'first-and-only-result');
    assert.equal(executions, 1);
    assert.deepEqual(sent.at(-1), sent[0]);
    assert.equal(requests.pending, null);
    assert.equal(storage.values.size, 0);
  }
});
