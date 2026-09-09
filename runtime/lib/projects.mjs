export class ProjectError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

export const projectNameKey = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

function text(value, field, maximum, required = false) {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) throw new ProjectError(400, `${field} must be ${required ? 'a non-empty' : 'a'} string of at most ${maximum} characters.`);
  return value.trim();
}

function repository(value) {
  const raw = text(value, 'repositoryUrl', 220);
  if (!raw) return '';
  // Parse the literal URL shape before URL normalization can hide dot-segments,
  // encoded paths, credentials, queries or fragments. This never fetches GitHub.
  const match = raw.match(/^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9_.-]{1,100})\/?$/);
  if (!match) throw new ProjectError(400, 'repositoryUrl must be an HTTPS github.com owner/repo URL without credentials, query or fragment.');
  const repo = match[2].replace(/\.git$/i, '');
  if (!repo || repo === '.' || repo === '..') throw new ProjectError(400, 'repositoryUrl must identify a repository.');
  return `https://github.com/${match[1]}/${repo}`;
}

export function validateProjectFields(body, { creating = false } = {}) {
  const allowed = new Set(['name', 'repositoryUrl', 'summary', 'nextAction', 'status', 'requestId', ...(creating ? [] : ['revision'])]);
  if (Object.keys(body).some(key => !allowed.has(key))) throw new ProjectError(400, 'Unknown or immutable project field.');
  if (typeof body.requestId !== 'string' || !body.requestId.trim() || body.requestId.length > 160) throw new ProjectError(400, 'Project changes require requestId of 1–160 characters.');
  const fields = creating ? { repositoryUrl: '', summary: '', nextAction: '', status: 'active' } : {};
  if (creating || Object.hasOwn(body, 'name')) {
    fields.name = text(body.name, 'name', 80, true).normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!fields.name || fields.name.length > 80) throw new ProjectError(400, 'Normalized project name must be non-empty and at most 80 characters.');
    if (/[|\u0000-\u001f\u007f]/.test(body.name) || fields.name.includes('|')) throw new ProjectError(400, 'Project names cannot contain control characters or |.');
  }
  if (Object.hasOwn(body, 'repositoryUrl')) fields.repositoryUrl = repository(body.repositoryUrl);
  if (Object.hasOwn(body, 'summary')) fields.summary = text(body.summary, 'summary', 8000);
  if (Object.hasOwn(body, 'nextAction')) fields.nextAction = text(body.nextAction, 'nextAction', 4000);
  if (Object.hasOwn(body, 'status')) {
    if (!['active', 'paused', 'archived'].includes(body.status)) throw new ProjectError(400, 'status must be active, paused or archived.');
    fields.status = body.status;
  }
  if (!creating && (!Number.isSafeInteger(body.revision) || body.revision < 1)) throw new ProjectError(400, 'Project update requires revision equal to the current project version.');
  if (!creating && Object.keys(fields).length === 0) throw new ProjectError(400, 'Provide at least one project field to update.');
  return fields;
}

export function validateProjectRegistry(projects) {
  if (!Array.isArray(projects)) throw new Error('invalid project registry');
  const ids = new Set(), names = new Set();
  for (const project of projects) {
    if (!project || typeof project !== 'object' || Array.isArray(project)) throw new Error('invalid project record');
    const { id, name, repositoryUrl, summary, nextAction, status, version, createdAt, updatedAt } = project;
    if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id) || ids.has(id)) throw new Error('invalid or duplicate project ID');
    const checked = validateProjectFields({ name, repositoryUrl, summary, nextAction, status, requestId: 'stored-project-validation' }, { creating: true });
    if (name !== checked.name || repositoryUrl !== checked.repositoryUrl || !Number.isSafeInteger(version) || version < 1) throw new Error('invalid stored project fields');
    const key = projectNameKey(name);
    if (names.has(key)) throw new Error('duplicate normalized project name');
    for (const timestamp of [createdAt, updatedAt]) {
      if (typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== (timestamp.includes('.') ? timestamp : timestamp.replace('Z', '.000Z'))) throw new Error('invalid project timestamp');
    }
    ids.add(id); names.add(key);
  }
}

export function resolveProject(projects, reference) {
  const value = reference.trim();
  const project = projects.find(item => item.id === value) ?? projects.find(item => projectNameKey(item.name) === projectNameKey(value));
  if (!project) throw new ProjectError(404, 'Project not found. Register it first or use its exact name or ID.');
  return project;
}

const statusLabel = value => ({ active: '진행', paused: '보류', archived: '보관' })[value];

export function projectRegistryDocument(projects) {
  const shown = projects.slice(0, 50);
  const excerpt = value => value.length > 500 ? `${value.slice(0, 500)}… (요약됨)` : value;
  return `# YENO 프로젝트 목록\n\n등록 프로젝트: ${projects.length}개\n관리 상태는 YENO 안의 분류이며 실제 호스팅 상태를 뜻하지 않습니다.\n목록은 최대 50개, 다음 작업은 500자까지 표시합니다. 전체 내용은 “프로젝트 브리핑: 이름 또는 ID”로 확인하세요.\n\n${shown.length ? shown.map(project => `## ${project.name}\n- ID: ${project.id}\n- 관리 상태: ${statusLabel(project.status)}\n- 저장소: ${project.repositoryUrl || '미등록'}\n- 다음 작업: ${excerpt(project.nextAction) || '미정'}`).join('\n\n') : '등록된 프로젝트가 없습니다.'}${projects.length > shown.length ? `\n\n표시 ${shown.length}개 / 전체 ${projects.length}개. 나머지 ${projects.length - shown.length}개는 웹의 프로젝트 목록에서 확인하거나 이름 또는 ID로 브리핑을 요청하세요.` : ''}\n\n개발 작업자 연결: 미연결. 이 문서는 저장된 등록정보로 작성했습니다.`;
}

export function projectBriefDocument(project, workText) {
  const mode = workText === undefined ? '프로젝트 브리핑' : '프로젝트 작업 준비서';
  return `# ${project.name} — ${mode}\n\n- 프로젝트 ID: ${project.id}\n- 등록정보 버전: ${project.version}\n- 관리 상태: ${statusLabel(project.status)} (YENO 안의 분류)\n- 저장소: ${project.repositoryUrl || '미등록'}\n\n## 프로젝트 설명\n${project.summary || '설명이 아직 없습니다.'}\n\n## 다음 작업\n${project.nextAction || '다음 작업이 아직 없습니다.'}${workText === undefined ? '' : `\n\n## 이번 요청\n${workText}\n\n## 개발 준비\n1. 저장소 사본과 적용할 작업 범위를 확인합니다.\n2. 기존 동작과 완료 조건을 확인합니다.\n3. 개발 작업자를 연결한 뒤 구현과 검사를 수행합니다.`}\n\n## 실행 상태\n현재 산출물은 저장된 프로젝트 정보${workText === undefined ? '' : '와 이번 요청'}를 정리한 문서입니다. 개발 작업자는 아직 연결되지 않았으며 코드 작성·실행·배포·외부 저장소 조회를 수행하지 않았습니다.`;
}
