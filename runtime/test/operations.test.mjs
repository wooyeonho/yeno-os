import test from 'node:test';
import assert from 'node:assert/strict';
import { operatingBriefDocument } from '../lib/operations.mjs';

test('operating brief counts actual stored states without treating completed history or candidates as new work', () => {
  const report = operatingBriefDocument({
    generatedAt: '2026-09-09T22:00:00Z',
    jobs: [
      { id: 'old', title: '지난 기록', status: 'completed', updatedAt: '2020-01-01T00:00:00Z', artifacts: [{ id: 'one' }, { id: 'two' }] },
      { status: 'completed' }, { status: 'queued' }, { status: 'queued' },
      { status: 'running' }, { status: 'paused' }, { status: 'failed' },
      { status: 'cancelled' }, { status: 'in_progress' },
    ],
    sources: [
      { readingStatus: 'read', decision: 'candidate' },
      { readingStatus: 'read', decision: 'deferred' },
      { readingStatus: 'partial', decision: 'pending' },
      { readingStatus: 'unavailable', decision: 'rejected' },
    ], memories: [{ text: 'one' }, { text: 'two' }],
  });
  assert.match(report, /전체 9개/);
  assert.match(report, /대기 \(queued\) \| 2/);
  assert.match(report, /완료 \(completed\) \| 2/);
  for (const status of ['running', 'paused', 'failed', 'cancelled']) assert.ok(report.includes(`(${status}) | 1 |`));
  assert.match(report, /미분류 \| 1/);
  assert.match(report, /지난 기록 \| old \| 완료 \| 2020-01-01T00:00:00Z \| 2/);
  assert.match(report, /오늘 완료한 수가 아닙니다/);
  assert.match(report, /read 2개/);
  assert.match(report, /candidate 1개/);
  assert.match(report, /deferred 1개/);
  assert.match(report, /저장된 기억: 2개/);
  assert.match(report, /candidate는 구현·검사 통과·배포·실제 사용 확인과 다릅니다/);
});

test('first active project wins in stored order even when its next action is missing; stop overrides its action', () => {
  const projects = [
    { id: 'paused', name: '보류 프로젝트', status: 'paused', nextAction: '선택 금지' },
    { id: 'first', name: '첫 프로젝트', status: 'active', nextAction: '' },
    { id: 'second', name: '둘째 프로젝트', status: 'active', nextAction: '나중에 실행' },
    { id: 'legacy', name: '이름만 진행', status: 'running', nextAction: '선택 금지' },
  ];
  const before = structuredClone(projects);
  const report = operatingBriefDocument({ projects, aiConfigured: false, developerWorker: false });
  const priority = report.split('## 먼저 확인할 한 가지')[1].split('## 실행 가능 범위')[0];
  assert.match(priority, /우선 프로젝트: 첫 프로젝트/);
  assert.match(priority, /다음 작업 미등록/);
  assert.doesNotMatch(priority, /나중에 실행|선택 금지/);
  assert.match(report, /active 상태 2개 \/ 등록 전체 4개/);
  assert.match(report, /AI 공급자: 미설정/);
  assert.match(report, /개발 작업자: 미연결/);
  const stopped = operatingBriefDocument({ projects, emergencyStop: true, aiConfigured: true, developerWorker: true });
  const stopPriority = stopped.split('## 먼저 확인할 한 가지')[1].split('## 실행 가능 범위')[0];
  assert.match(stopPriority, /소유자가 멈춤을 해제한 뒤 필요한 작업을 개별 재개/);
  assert.doesNotMatch(stopPriority, /우선 프로젝트|나중에 실행/);
  assert.match(stopped, /실제 호출 성공과 비용 한도 검증은 이 문서에서 확인하지 않았습니다/);
  assert.match(stopped, /실제 코드 수정·빌드를 실행하거나 검증하지 않았습니다/);
  assert.deepEqual(projects, before, 'report must not reorder, resume or fill in project metadata');
  assert.match(operatingBriefDocument({ projects: projects.filter(project => project.status !== 'active') }), /active 상태인 프로젝트가 없습니다/);
});

test('bounded inert metadata protects the persisted report from huge fields and private content', () => {
  const hostile = '![external](https://evil.invalid/image)<img src=x> **bold** `code` |\n\u202e'.repeat(100);
  const secret = 'DO_NOT_COPY_PRIVATE_CONTENT';
  const projects = Array.from({ length: 101 }, (_, index) => ({
    id: `project-${index}`, name: hostile, nextAction: hostile, status: 'active', updatedAt: hostile,
    summary: secret, repositoryUrl: `https://user:${secret}@example.invalid`, token: secret,
  }));
  const jobs = Array.from({ length: 1000 }, (_, index) => ({
    id: `job-${index}`, title: hostile, status: 'queued', updatedAt: hostile,
    input: secret, normalized: secret, draft: secret, error: secret,
    artifacts: [{ id: secret, filename: secret, content: secret }], token: secret,
  }));
  const input = { projects, jobs, generatedAt: hostile, sources: [{ body: secret, summary: secret }], memories: [{ text: secret }], devices: { token: secret } };
  const original = structuredClone(input);
  const report = operatingBriefDocument(input);
  assert.ok(report.length < 30000, `report has ${report.length} characters`);
  assert.match(report, /표시 20개 \/ 전체 1000개/);
  assert.match(report, /표시 20개 \/ 전체 101개/);
  assert.match(report, /대기 \(queued\) \| 1000/);
  assert.doesNotMatch(report, new RegExp(secret));
  assert.doesNotMatch(report, /<img|\u202e/);
  assert.ok(report.includes('\\!\\[external\\]\\(https://evil.invalid/image\\)'));
  assert.ok(report.includes('&lt;img src=x&gt;'));
  assert.doesNotMatch(report, /project-20|job-20/);
  assert.deepEqual(input, original, 'formatting must never truncate stored originals');
  assert.equal(operatingBriefDocument(input), report, 'caller-supplied snapshot produces the same document');
  const inflated = '&'.repeat(4000);
  const maximallyEscaped = operatingBriefDocument({
    generatedAt: inflated,
    projects: projects.map(project => ({ ...project, name: inflated, id: inflated, nextAction: inflated, updatedAt: inflated })),
    jobs: jobs.map(job => ({ ...job, title: inflated, id: inflated, updatedAt: inflated })),
  });
  assert.ok(maximallyEscaped.length < 30000, 'HTML entities must not bypass the output bound');
});

test('missing collections and nonboolean capability values do not fabricate enabled integrations', () => {
  const report = operatingBriefDocument({ projects: null, jobs: {}, memories: 12, sources: null, aiConfigured: 'false', developerWorker: {} });
  assert.match(report, /전체 0개/);
  assert.match(report, /생성 시각: 미기록/);
  assert.match(report, /AI 공급자: 미설정/);
  assert.match(report, /개발 작업자: 미연결/);
  assert.match(report, /저장된 기억: 0개/);
});
