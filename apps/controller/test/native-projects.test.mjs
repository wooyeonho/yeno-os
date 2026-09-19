// BLACKHOLE native Projects destination (UI Slice 2, issue #25): proves
// native-projects.ts actually mounts the shared runtime/public/
// project-universe-view.mjs in the native DOM shape, and that its mutation
// flow calls the injected api() exactly like main.ts's real api() would,
// including honest 409 revision-conflict handling - matching
// native-home.test.mjs's convention for logic main.ts cannot itself be
// unit-tested for (it imports Tauri plugin APIs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createNativeProjects } from '../src/native-projects.ts';

function setup(apiImpl) {
  const dom = new JSDOM('<div id="project-universe-root"></div>', {url: 'https://example.test'});
  const root = dom.window.document.getElementById('project-universe-root');
  const calls = [];
  const navigated = [];
  const api = async (path, init) => {
    calls.push({path, init});
    return apiImpl ? apiImpl(path, init) : {};
  };
  const projects = createNativeProjects({root, api, requestId: () => 'req-1', onNavigate: target => navigated.push(target)});
  return {dom, root, projects, calls, navigated, close: () => dom.window.close()};
}

const emptyUniverse = () => ({milestones: {completed: 0, total: 0}, quests: [], jobs: [], sources: [], memoryEvents: [], outcomes: [], blockers: [], dominantDrives: []});

test('the shared Project Universe view actually mounts and renders a real project list, honestly empty otherwise', () => {
  const h = setup();
  h.projects.updateProjects([], []);
  assert.match(h.root.textContent, /등록된 프로젝트가 없습니다/);
  h.projects.updateProjects(
    [{id: 'p-1', name: '실제 프로젝트', status: 'active', version: 1, nextAction: '다음 단계', milestones: []}],
    [{id: 'j-1', projectId: 'p-1', status: 'paused', pauseReason: 'providerMissing'}],
  );
  assert.match(h.root.textContent, /실제 프로젝트/);
  assert.match(h.root.textContent, /확인 필요/);
  h.close();
});

test('opening a project fetches its real universe over the injected api() and renders identity/milestones/reason', async () => {
  const h = setup((path) => {
    assert.equal(path, '/projects/p-1/universe');
    return {...emptyUniverse(), dominantDrives: [{driveId: 'lust', worldName: '창조', worldNameEn: 'Creation', questCount: 1}], quests: [{id: 'q-1', goal: '실제 목표', driveId: 'lust', status: 'running', updatedAt: '2026-09-01T00:00:00.000Z'}]};
  });
  h.projects.updateProjects([{id: 'p-1', name: 'P', status: 'active', version: 1, nextAction: '다음 작업', milestones: []}], []);
  h.projects.openProject('p-1');
  await new Promise(r => setTimeout(r, 0));
  assert.match(h.root.textContent, /창조 욕망과 관련된 목표/);
  assert.match(h.root.textContent, /실제 목표/);
  h.close();
});

test('adding a milestone calls the injected api() with the real project id, current revision and requestId, RENDERS the server-confirmed project, and a following mutation uses the server-advanced revision', async () => {
  const bodies = [];
  const serverProjectAfterAdd = {id: 'p-1', name: 'P', status: 'active', version: 4, milestones: [{id: 'm-1', text: '새 마일스톤', completed: false, createdAt: '2026-09-01T00:00:00.000Z', completedAt: null}]};
  const h = setup((path, init) => {
    if (path === '/projects/p-1/universe') return emptyUniverse();
    bodies.push(JSON.parse(init.body));
    return {project: serverProjectAfterAdd, milestone: serverProjectAfterAdd.milestones[0]};
  });
  h.projects.updateProjects([{id: 'p-1', name: 'P', status: 'active', version: 3, milestones: []}], []);
  h.projects.openProject('p-1');
  await new Promise(r => setTimeout(r, 0));
  const form = h.root.querySelector('[data-puv-form="add-milestone"]');
  form.querySelector('input[name="text"]').value = '새 마일스톤';
  form.dispatchEvent(new h.dom.window.Event('submit', {bubbles: true, cancelable: true}));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(bodies[0].revision, 3);
  assert.equal(bodies[0].text, '새 마일스톤');
  assert.equal(bodies[0].requestId, 'req-1');
  // The rendered milestone list must reflect the SERVER's confirmed record
  // immediately, not wait for the next ~3s state poll.
  assert.match(h.root.textContent, /새 마일스톤/);
  // A following mutation must use the server-advanced revision (4), never
  // the stale locally-remembered one (3) - proving the cache was really
  // updated from the mutation response, not left as it was before.
  h.root.querySelector('[data-puv-action="remove-milestone"]').dispatchEvent(new h.dom.window.Event('click', {bubbles: true}));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(bodies[1].revision, 4);
  h.close();
});

test('toggling a milestone renders the server-confirmed completion state, and removing one renders the server-confirmed list', async () => {
  const afterToggle = {id: 'p-1', name: 'P', status: 'active', version: 6, milestones: [{id: 'm-1', text: '기존', completed: true, createdAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-02T00:00:00.000Z'}]};
  const afterRemove = {id: 'p-1', name: 'P', status: 'active', version: 7, milestones: []};
  let call = 0;
  const h = setup((path) => {
    if (path === '/projects/p-1/universe') return emptyUniverse();
    call++;
    return {project: call === 1 ? afterToggle : afterRemove};
  });
  h.projects.updateProjects([{id: 'p-1', name: 'P', status: 'active', version: 5, milestones: [{id: 'm-1', text: '기존', completed: false, createdAt: '2026-09-01T00:00:00.000Z', completedAt: null}]}], []);
  h.projects.openProject('p-1');
  await new Promise(r => setTimeout(r, 0));
  h.root.querySelector('[data-puv-action="toggle-milestone"]').dispatchEvent(new h.dom.window.Event('change', {bubbles: true}));
  await new Promise(r => setTimeout(r, 0));
  assert.match(h.root.textContent, /완료 기록/, 'must show the server-confirmed completed state');

  h.root.querySelector('[data-puv-action="remove-milestone"]').dispatchEvent(new h.dom.window.Event('click', {bubbles: true}));
  await new Promise(r => setTimeout(r, 0));
  assert.doesNotMatch(h.root.textContent, /기존/, 'the server-confirmed removal must actually disappear from the render');
  assert.match(h.root.textContent, /아직 등록한 마일스톤이 없습니다/);
  h.close();
});

test('a 409 revision conflict refetches the real canonical project list and renders THAT server state, never the stale local copy', async () => {
  let attempts = 0, projectsFetched = 0;
  const serverSideProject = {id: 'p-1', name: 'P', status: 'active', version: 9, milestones: [{id: 'm-server', text: '서버가 실제로 가진 항목', completed: true, createdAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-02T00:00:00.000Z'}]};
  const h = setup((path) => {
    if (path === '/projects/p-1/universe') return emptyUniverse();
    if (path === '/projects') { projectsFetched++; return {projects: [serverSideProject]}; }
    attempts++;
    const error = new Error('conflict');
    error.status = 409;
    throw error;
  });
  h.projects.updateProjects([{id: 'p-1', name: 'P', status: 'active', version: 5, milestones: [{id: 'm-local', text: '오래된 로컬 항목', completed: false, createdAt: '2026-09-01T00:00:00.000Z', completedAt: null}]}], []);
  h.projects.openProject('p-1');
  await new Promise(r => setTimeout(r, 0));
  const checkbox = h.root.querySelector('[data-puv-action="toggle-milestone"]');
  checkbox.dispatchEvent(new h.dom.window.Event('change', {bubbles: true}));
  await new Promise(r => setTimeout(r, 0));
  assert.match(h.root.textContent, /프로젝트가 변경되어 최신 정보를 다시 불러왔습니다/);
  assert.equal(attempts, 1);
  assert.equal(projectsFetched, 1, 'the conflict handler must fetch the real canonical project list, not just the universe projection');
  assert.match(h.root.textContent, /서버가 실제로 가진 항목/, 'must render the real server-side milestone');
  assert.doesNotMatch(h.root.textContent, /오래된 로컬 항목/, 'the stale local milestone must not still be shown after the conflict reload');
  h.close();
});

test('cross-surface navigation (sources/memory) calls the real onNavigate host callback', async () => {
  const h = setup(() => emptyUniverse());
  h.projects.updateProjects([{id: 'p-1', name: 'P', status: 'active', version: 1, milestones: []}], []);
  h.projects.openProject('p-1');
  await new Promise(r => setTimeout(r, 0));
  h.root.querySelector('[data-puv-action="navigate"][data-target="sources"]').dispatchEvent(new h.dom.window.Event('click', {bubbles: true}));
  assert.deepEqual(h.navigated, ['sources']);
  h.close();
});

test('showList() returns to the list from cached projects without an empty flash, reset() clears everything', async () => {
  const h = setup(() => emptyUniverse());
  h.projects.updateProjects([{id: 'p-1', name: '캐시된 프로젝트', status: 'active', version: 1, milestones: []}], []);
  h.projects.openProject('p-1');
  await new Promise(r => setTimeout(r, 0));
  h.projects.showList();
  assert.match(h.root.textContent, /캐시된 프로젝트/);
  h.projects.reset();
  assert.match(h.root.textContent, /등록된 프로젝트가 없습니다/);
  h.close();
});
