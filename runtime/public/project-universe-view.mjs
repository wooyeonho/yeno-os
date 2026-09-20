// BLACKHOLE Project Universe (UI Slice 2, issue #25). A shared, pure view
// used by both the web cockpit and the native Android controller - exactly
// like living-core-view.mjs and growth-view.mjs, this module owns no fetch:
// the host supplies a view model via updateState() and this module only
// ever asks the host to act, through the callbacks below, then waits for
// the host to call updateState() again with whatever really happened.
//
// This is deliberate for milestone mutation (see onMilestoneAction): a
// checkbox toggle or an add/remove never flips its own rendered state
// optimistically. It shows a busy state, calls the host, and only ever
// reflects what updateState() reports next - including a real 409 revision
// conflict, which the host resolves by reloading the latest project and
// passing back a `notice` string, never by silently overwriting the
// owner's edit or the server's rejection.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = v => { const t = typeof v === 'number' ? v : Date.parse(v); return v && Number.isFinite(t) ? new Date(t).toLocaleString('ko-KR') : null; };
const truncate = (text, max) => { const value = String(text ?? ''); return value.length > max ? `${value.slice(0, max)}…` : value; };

export const STATUS_LABEL = {active: '진행', paused: '보류', archived: '보관'};
const READING_LABEL = {unread: '아직 안 읽음', reading: '읽는 중', read: '읽음'};
const DECISION_LABEL = {pending: '판단 대기', candidate: '후보', adopted: '채택', rejected: '보류'};
const JOB_STATUS_LABEL = {queued: '대기 중', running: '진행 중', paused: '멈춤', completed: '완료', failed: '실패', cancelled: '취소됨'};
const BROWSER_VERIFICATION_LABEL = Object.freeze({verified: '결정론적 검증 통과', rejected: '결정론적 검증 불합격', pass: '내용 검증 통과', fail: '내용 검증 불합격', uncertain: '내용 검증 불확실'});
const MEMORY_TYPE_LABEL = {episode: '경험', decision: '결정', result: '결과', relationship: '관계', skill: '능력', source: '자료', project: '프로젝트'};
// Shadow Army (issue #25 §D): real durable jobs already gated by
// shadow-army.mjs's own dependsOnJobIds/callLimit/restart-safety contract.
// This section only ever renders fields missionStatus() actually returns -
// no progress bar, no agent count, no confidence is invented here.
const SHADOW_ROLE_LABEL = Object.freeze({scout: 'Scout · 자료 탐색', researcher: 'Researcher · 대안 조사', builder: 'Builder · 결과 작성'});
const SHADOW_PHASE_LABEL = Object.freeze({planning: '계획 중', running: '실행 중', blocked: '대기·차단', verifying: '결정론적 검증 중', semantic_verifying: '내용 검증 중', completed: '완료', failed: '실패'});
const SHADOW_JOB_STATUS_LABEL = Object.freeze({queued: '대기 중', running: '진행 중', paused: '멈춤', completed: '완료', failed: '실패', cancelled: '취소됨'});
const SEMANTIC_VERDICT_LABEL = Object.freeze({pass: '내용 검증 통과', fail: '내용 검증 불합격', uncertain: '내용 검증 불확실'});
const INDEPENDENCE_LABEL = Object.freeze({'independent-model': '독립 모델(provider 상이)', 'independent-context': '독립 컨텍스트(동일 provider, 별도 실행)'});

function shadowJobHTML(job) {
  const label = SHADOW_ROLE_LABEL[job.role] || job.role;
  const status = SHADOW_JOB_STATUS_LABEL[job.status] || job.status || '상태 없음';
  const dependencies = Array.isArray(job.dependsOnJobIds) && job.dependsOnJobIds.length
    ? `<span>선행 작업 ${job.dependsOnJobIds.length}개</span>` : '<span>독립 작업</span>';
  const artifacts = Array.isArray(job.artifacts) ? `<span>산출물 ${job.artifacts.length}개</span>` : '';
  const provider = [job.provider, job.model].filter(Boolean).join(' · ');
  return `<li class="puv-shadow-job" data-shadow-job-id="${esc(job.jobId)}">
    <div class="puv-shadow-job-top"><strong>${esc(label)}</strong><span class="puv-status puv-status-${esc(job.status || 'queued')}">${esc(status)}</span></div>
    <div class="puv-shadow-job-meta">${dependencies}${artifacts ? ` · ${artifacts}` : ''}</div>
    ${job.pauseReason ? `<small class="puv-shadow-warning">대기 이유 · ${esc(job.pauseReason)}</small>` : ''}
    ${job.failureReason ? `<small class="puv-shadow-warning">실패 사유 · ${esc(job.failureReason)}</small>` : ''}
    ${provider ? `<small class="puv-shadow-provider">실행 제공자 · ${esc(provider)}</small>` : ''}
  </li>`;
}

// Deterministic verifier (mission.verify) is the artifact-existence/
// integrity check; semantic verifier (mission.semantic) is the separate,
// independently-dispatched content judgment (pass/fail/uncertain) that runs
// in its own durable job/context - the two are never merged into one line.
function verificationSectionHTML(mission) {
  const verify = mission.verify;
  const deterministic = !verify ? '결정론적 검증 대기'
    : verify.status !== 'completed' ? (SHADOW_JOB_STATUS_LABEL[verify.status] || verify.status)
    : verify.result?.verified ? '결정론적 검증 통과' : '결정론적 검증 불합격';
  const semantic = mission.semantic;
  const semanticLine = !semantic ? null
    : semantic.status !== 'completed' ? `${SHADOW_JOB_STATUS_LABEL[semantic.status] || semantic.status}${semantic.failureReason ? ` · ${esc(semantic.failureReason)}` : ''}`
    : semantic.verdict ? `${SEMANTIC_VERDICT_LABEL[semantic.verdict.verdict] || semantic.verdict.verdict}${semantic.independence ? ` · ${INDEPENDENCE_LABEL[semantic.independence] || semantic.independence}` : ''}` : '판정 없음';
  return `<div class="puv-shadow-verification"><span>결정론적 검증(산출물 존재·실행)</span><strong>${esc(deterministic)}</strong></div>
    ${semantic ? `<div class="puv-shadow-verification"><span>내용 검증(semantic, 별도 job/context)</span><strong>${esc(semanticLine)}</strong></div>` : ''}
    ${semantic?.status === 'completed' && semantic.verdict ? `<small class="puv-shadow-disclaimer">${esc(semantic.verdict.summary || '')}</small>` : ''}`;
}

function shadowMissionHTML(mission, index) {
  const shadows = Array.isArray(mission.shadows) ? mission.shadows : [];
  const phase = SHADOW_PHASE_LABEL[mission.phase] || mission.phase || '상태 없음';
  const completed = shadows.filter(shadow => shadow.status === 'completed').length;
  return `<article class="puv-shadow-mission" data-shadow-mission-id="${esc(mission.missionId)}">
    <div class="puv-shadow-mission-top">
      <div><h4>Shadow 임무 ${index + 1}</h4><small>작업 ${completed} / ${shadows.length} 완료</small></div>
      <span class="puv-status puv-status-${esc(mission.phase || 'planning')}">${esc(phase)}</span>
    </div>
    ${shadows.length ? `<ul class="puv-shadow-job-list">${shadows.map(shadowJobHTML).join('')}</ul>` : '<p class="puv-empty-line">연결된 Shadow 작업이 없습니다.</p>'}
    ${verificationSectionHTML(mission)}
    <small class="puv-shadow-disclaimer">산출물 존재·실행 기록과 별도 내용 검증 결과를 확인한 상태입니다. 외부 성과나 품질을 자동 보증하지 않습니다.</small>
  </article>`;
}

function shadowArmySectionHTML(detail, emergencyStop) {
  const missions = detail.shadowMissions ?? [];
  return `<section class="puv-section puv-shadow-army" data-puv-surface="shadow-army">
    <div class="puv-section-heading"><h3>Shadow Army</h3><span class="puv-progress">실제 임무 ${missions.length}개</span></div>
    <p class="puv-shadow-intro">이 프로젝트에 연결된 실제 작업과 결정론적·내용 검증 상태입니다.</p>
    ${emergencyStop ? '<p class="puv-notice" role="alert">전체 멈춤이 적용되어 있어 새 Shadow 작업이 진행되지 않습니다.</p>' : ''}
    ${missions.length ? `<div class="puv-shadow-mission-list">${missions.map(shadowMissionHTML).join('')}</div>` : '<p class="puv-empty-line">현재 배정된 실제 Shadow 임무가 없습니다.</p>'}
  </section>`;
}

function milestoneProgressText(milestones) {
  const completed = milestones?.completed ?? 0, total = milestones?.total ?? 0;
  return `${completed} / ${total}`;
}

function projectCardHTML(project) {
  const badges = [];
  if (project.hasBlocker) badges.push('<span class="puv-badge puv-badge-blocker">확인 필요</span>');
  if (project.hasActiveWork) badges.push('<span class="puv-badge puv-badge-active">진행 중</span>');
  return `<button type="button" class="puv-card" data-puv-action="open" data-project-id="${esc(project.id)}">
    <div class="puv-card-top"><strong>${esc(truncate(project.name, 40))}</strong><span class="puv-status puv-status-${esc(project.status)}">${esc(STATUS_LABEL[project.status] || project.status)}</span></div>
    <div class="puv-card-meta"><span class="puv-milestones">마일스톤 ${esc(milestoneProgressText(project.milestones))}</span>${badges.join('')}</div>
    <p class="puv-card-next">${project.nextAction ? esc(truncate(project.nextAction, 80)) : '다음 작업을 아직 정하지 않았습니다.'}</p>
  </button>`;
}

function browserJobHTML(job) {
  const status = JOB_STATUS_LABEL[job.status] || job.status || '상태 없음';
  const deterministic = job.deterministic ? BROWSER_VERIFICATION_LABEL[job.deterministic] || job.deterministic : '결정론적 검증 대기';
  const semantic = job.semantic ? BROWSER_VERIFICATION_LABEL[job.semantic] || job.semantic : '내용 검증 대기';
  const intake = [job.readingStatus ? (READING_LABEL[job.readingStatus] || job.readingStatus) : null, job.decision ? (DECISION_LABEL[job.decision] || job.decision) : null].filter(Boolean).join(' · ');
  const source = job.sourceUrl ? esc(truncate(job.sourceUrl, 90)) : '공개 URL 없음';
  return `<li class="puv-browser-job" data-browser-status="${esc(job.status || 'queued')}">
    <div class="puv-browser-job-top"><strong>${esc(truncate(job.goal, 92))}</strong><span class="puv-status puv-status-${esc(job.status || 'queued')}">${esc(status)}</span></div>
    <p class="puv-browser-job-source">${source}</p>
    <div class="puv-browser-job-verification"><span>${esc(deterministic)}</span><span>${esc(semantic)}</span></div>
    ${intake ? `<small class="puv-browser-job-intake">자료 상태 · ${esc(intake)}</small>` : ''}
    ${job.artifactHash ? `<small class="puv-browser-job-hash">artifact SHA-256 · ${esc(job.artifactHash.slice(0, 16))}…</small>` : ''}
  </li>`;
}

function browserHarnessSectionHTML(state) {
  const jobs = state.browserJobs || [];
  return `<section class="puv-section puv-browser-harness" data-puv-surface="browser-harness">
    <div class="puv-section-heading"><h3>Browser Harness</h3><span class="puv-progress">실제 작업 ${jobs.length}개</span></div>
    <p class="puv-browser-intro">폰 명령과 공개 URL 결과의 현재 증거를 표시합니다. live 브라우저·Jev 연결을 추정하지 않습니다.</p>
    ${jobs.length ? `<ul class="puv-browser-job-list">${jobs.map(browserJobHTML).join('')}</ul>` : '<p class="puv-empty-line">아직 접수된 Browser 작업이 없습니다.</p>'}
  </section>`;
}

function listScreenHTML(state) {
  const projects = state.projects || [];
  const browser = browserHarnessSectionHTML(state);
  if (!projects.length) return `<div>${browser}<div class="puv-empty"><span class="eyebrow">프로젝트 유니버스</span><p>등록된 프로젝트가 없습니다.</p></div></div>`;
  return `<div>${browser}<div class="puv-list" role="list">${projects.map(projectCardHTML).join('')}</div></div>`;
}

function milestoneItemHTML(milestone, projectId, busyId) {
  const busy = busyId === milestone.id;
  const completedAt = milestone.completed && milestone.completedAt ? date(milestone.completedAt) : null;
  return `<li class="puv-milestone-item ${milestone.completed ? 'is-complete' : ''}">
    <label class="puv-milestone-check">
      <input type="checkbox" ${milestone.completed ? 'checked' : ''} ${busy ? 'disabled' : ''} data-puv-action="toggle-milestone" data-project-id="${esc(projectId)}" data-milestone-id="${esc(milestone.id)}" data-completed="${milestone.completed ? 'false' : 'true'}">
      <span>${esc(milestone.text)}</span>
    </label>
    ${milestone.completed ? `<small class="puv-milestone-note">완료 기록${completedAt ? ` · ${esc(completedAt)}` : ''}</small>` : ''}
    <button type="button" class="text-button puv-milestone-remove" data-puv-action="remove-milestone" data-project-id="${esc(projectId)}" data-milestone-id="${esc(milestone.id)}" ${busy ? 'disabled' : ''} aria-label="마일스톤 삭제">삭제</button>
  </li>`;
}

function milestonesSectionHTML(detail, busyId) {
  const items = detail.milestones?.items ?? [];
  return `<section class="puv-section">
    <div class="puv-section-heading"><h3>마일스톤</h3><span class="puv-progress">${esc(milestoneProgressText(detail.milestones))}</span></div>
    ${items.length ? `<ul class="puv-milestone-list">${items.map(m => milestoneItemHTML(m, detail.projectId, busyId)).join('')}</ul>` : '<p class="puv-empty-line">아직 등록한 마일스톤이 없습니다.</p>'}
    <form class="puv-milestone-add" data-puv-form="add-milestone" data-project-id="${esc(detail.projectId)}">
      <input type="text" name="text" maxlength="300" placeholder="새 마일스톤 (예: 첫 초안 완성)" required>
      <button type="submit" class="button subtle" ${busyId === 'add' ? 'disabled' : ''}>추가</button>
    </form>
  </section>`;
}

function reasonSectionHTML(detail) {
  return `<section class="puv-section puv-reason">
    <h3>왜 이 프로젝트인가?</h3>
    <p>${esc(detail.reason || '판단 근거 부족')}</p>
  </section>`;
}

function blockersSectionHTML(detail) {
  const blockers = detail.blockers ?? [];
  if (!blockers.length) return '';
  return `<section class="puv-section puv-blockers">
    <h3>확인이 필요해요</h3>
    <ul class="puv-blocker-list">${blockers.map(b => `<li><strong>${esc(b.title || '작업')}</strong><span>${esc(b.reason)}</span></li>`).join('')}</ul>
  </section>`;
}

function activeWorkSectionHTML(detail) {
  const quests = detail.quests ?? [], jobs = detail.jobs ?? [];
  const items = [
    ...quests.map(q => `<li><span class="puv-status puv-status-${esc(q.status)}">${esc(JOB_STATUS_LABEL[q.status] || q.status)}</span><p>${esc(truncate(q.goal, 90))}</p>${q.pauseReason ? `<small>${esc(q.pauseReason)}</small>` : ''}</li>`),
    ...jobs.map(j => `<li><span class="puv-status puv-status-${esc(j.status)}">${esc(JOB_STATUS_LABEL[j.status] || j.status)}</span><p>${esc(truncate(j.title, 90))}</p></li>`),
  ];
  return `<details class="puv-details" open>
    <summary>현재 작업 (${items.length})</summary>
    ${items.length ? `<ul class="puv-work-list">${items.join('')}</ul>` : '<p class="puv-empty-line">진행 중인 작업이 없습니다.</p>'}
  </details>`;
}

function drivesSectionHTML(detail) {
  const drives = detail.dominantDrives ?? [];
  if (!drives.length) return '';
  return `<details class="puv-details">
    <summary>관련 욕망</summary>
    <ul class="puv-drive-list">${drives.map(d => `<li><span class="puv-drive-chip">${esc(d.worldName)}</span><small>목표 ${d.questCount}개</small></li>`).join('')}</ul>
  </details>`;
}

function sourcesSectionHTML(detail) {
  const sources = detail.sources ?? [];
  return `<details class="puv-details">
    <summary>연결된 자료 (${sources.length})</summary>
    ${sources.length ? `<ul class="puv-linked-list">${sources.map(s => `<li><p>${esc(truncate(s.title, 70))}</p><small>${esc(READING_LABEL[s.readingStatus] || s.readingStatus)} · ${esc(DECISION_LABEL[s.decision] || s.decision)}</small></li>`).join('')}</ul>` : '<p class="puv-empty-line">연결된 자료가 없습니다.</p>'}
    <button type="button" class="text-button" data-puv-action="navigate" data-target="sources" data-project-id="${esc(detail.projectId)}">자료 화면에서 보기</button>
  </details>`;
}

function memorySectionHTML(detail) {
  const events = detail.memoryEvents ?? [];
  return `<details class="puv-details">
    <summary>연결된 기억 (${events.length})</summary>
    ${events.length ? `<ul class="puv-linked-list">${events.map(e => `<li><p>${esc(truncate(e.text, 90))}</p><small>${esc(MEMORY_TYPE_LABEL[e.type] || e.type)}${e.createdAt ? ` · ${esc(date(e.createdAt))}` : ''}</small></li>`).join('')}</ul>` : '<p class="puv-empty-line">연결된 기억이 없습니다.</p>'}
    <button type="button" class="text-button" data-puv-action="navigate" data-target="memory" data-project-id="${esc(detail.projectId)}">기억 화면에서 보기</button>
  </details>`;
}

function outcomesSectionHTML(detail) {
  const outcomes = detail.outcomes ?? [];
  return `<details class="puv-details">
    <summary>기록된 성과 (${outcomes.length})</summary>
    ${outcomes.length ? `<ul class="puv-linked-list">${outcomes.map(o => `<li><p>${esc(truncate(o.summary, 90))}</p><small>${o.value !== null ? `${esc(o.value)}${esc(o.unit ? ' ' + o.unit : '')} · ` : ''}소유자 기록</small></li>`).join('')}</ul>` : '<p class="puv-empty-line">기록된 성과가 없습니다.</p>'}
  </details>`;
}

function futureSurfacesHTML() {
  return `<details class="puv-details puv-deferred">
    <summary>흡수 · 성장</summary>
    <p class="puv-empty-line">아직 연결되지 않았습니다. 다음 단계에서 제공됩니다.</p>
  </details>`;
}

function detailScreenHTML(state) {
  const detail = state.detail;
  if (state.loading && !detail) return `<div class="puv-loading" role="status">불러오는 중…</div>`;
  if (!detail) return `<div class="puv-empty"><p>프로젝트를 찾을 수 없습니다.</p></div>`;
  return `<div class="puv-detail">
    ${state.notice ? `<p class="puv-notice" role="alert">${esc(state.notice)}</p>` : ''}
    <header class="puv-detail-header">
      <div class="puv-detail-title"><h2>${esc(detail.name)}</h2><span class="puv-status puv-status-${esc(detail.status)}">${esc(STATUS_LABEL[detail.status] || detail.status)}</span></div>
      ${detail.summary ? `<details class="puv-summary"><summary>개요</summary><p>${esc(detail.summary)}</p></details>` : ''}
      <p class="puv-next-action"><span class="eyebrow">다음 작업</span>${detail.nextAction ? esc(detail.nextAction) : '아직 정하지 않았습니다.'}</p>
    </header>
    ${reasonSectionHTML(detail)}
    ${blockersSectionHTML(detail)}
    ${milestonesSectionHTML(detail, state.busyMilestoneId)}
    ${shadowArmySectionHTML(detail, state.emergencyStop === true)}
    ${activeWorkSectionHTML(detail)}
    ${drivesSectionHTML(detail)}
    ${sourcesSectionHTML(detail)}
    ${memorySectionHTML(detail)}
    ${outcomesSectionHTML(detail)}
    ${futureSurfacesHTML()}
  </div>`;
}

export function createProjectUniverseView({root, onOpenProject = () => {}, onBack = () => {}, onMilestoneAction = () => Promise.resolve(), onNavigate = () => {}}) {
  if (!root) throw new Error('프로젝트 유니버스에는 표시할 위치가 필요합니다.');
  root.classList.add('project-universe');
  let destroyed = false, epoch = 0, current = {screen: 'list', projects: [], detail: null, loading: false, notice: null, busyMilestoneId: null, emergencyStop: false};

  function render() {
    if (destroyed) return;
    const isDetail = current.screen === 'detail';
    root.innerHTML = `
      <div class="puv-header">
        ${isDetail ? '<button type="button" class="text-button puv-back" data-puv-action="back">← 목록으로</button>' : '<span class="eyebrow">프로젝트 유니버스</span>'}
      </div>
      <div class="puv-screen ${isDetail ? 'puv-screen-detail' : 'puv-screen-list'}">
        ${isDetail ? detailScreenHTML(current) : listScreenHTML(current)}
      </div>
    `;
  }

  async function handleMilestoneAction(action, payload, busyId) {
    const generation = epoch;
    current = {...current, busyMilestoneId: busyId, notice: null};
    render();
    try {
      const next = await onMilestoneAction(action, payload);
      if (generation !== epoch || destroyed) return;
      current = {...current, ...next, busyMilestoneId: null};
    } catch (error) {
      if (generation !== epoch || destroyed) return;
      current = {...current, busyMilestoneId: null, notice: error?.message || '요청을 처리하지 못했습니다.'};
    }
    render();
  }

  function handleClick(event) {
    // The milestone checkbox also carries data-puv-action (for the change
    // handler below) but must never be dispatched again here - click and
    // change both fire on a checkbox toggle, and this handler only ever
    // acts on actual buttons.
    const button = event.target.closest?.('button[data-puv-action]');
    if (!button || !root.contains(button)) return;
    const action = button.dataset.puvAction, projectId = button.dataset.projectId;
    if (action === 'open') { onOpenProject(projectId); return; }
    if (action === 'back') { onBack(); return; }
    if (action === 'navigate') { onNavigate(button.dataset.target, {projectId}); return; }
    if (action === 'remove-milestone') {
      const milestoneId = button.dataset.milestoneId;
      void handleMilestoneAction('remove', {projectId, milestoneId}, milestoneId);
    }
  }

  function handleSubmit(event) {
    const form = event.target.closest?.('[data-puv-form="add-milestone"]');
    if (!form || !root.contains(form)) return;
    event.preventDefault();
    const projectId = form.dataset.projectId, input = form.querySelector('input[name="text"]');
    const text = input.value.trim();
    if (!text) return;
    void handleMilestoneAction('add', {projectId, text}, 'add').then(() => { if (!destroyed) form.reset?.(); });
  }

  // The checkbox itself fires input.change - toggling must never rely on
  // click bubbling through a disabled/readonly checkbox on some WebViews.
  function handleChange(event) {
    const input = event.target.closest?.('[data-puv-action="toggle-milestone"]');
    if (!input || !root.contains(input)) return;
    const projectId = input.dataset.projectId, milestoneId = input.dataset.milestoneId, completed = input.dataset.completed === 'true';
    void handleMilestoneAction('toggle', {projectId, milestoneId, completed}, milestoneId);
  }

  root.addEventListener('click', handleClick);
  root.addEventListener('submit', handleSubmit);
  root.addEventListener('change', handleChange);
  render();

  return {
    updateState(next) { if (destroyed) return; current = {...current, ...next}; render(); },
    reset() { if (destroyed) return; epoch++; current = {screen: 'list', projects: [], detail: null, loading: false, notice: null, busyMilestoneId: null, emergencyStop: false}; render(); },
    destroy() {
      if (destroyed) return;
      destroyed = true; epoch++;
      root.removeEventListener('click', handleClick);
      root.removeEventListener('submit', handleSubmit);
      root.removeEventListener('change', handleChange);
      root.innerHTML = '';
    },
  };
}
