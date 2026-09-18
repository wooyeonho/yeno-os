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
const MEMORY_TYPE_LABEL = {episode: '경험', decision: '결정', result: '결과', relationship: '관계', skill: '능력', source: '자료', project: '프로젝트'};

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

function listScreenHTML(state) {
  const projects = state.projects || [];
  if (!projects.length) return `<div class="puv-empty"><span class="eyebrow">프로젝트 유니버스</span><p>등록된 프로젝트가 없습니다.</p></div>`;
  return `<div class="puv-list" role="list">${projects.map(projectCardHTML).join('')}</div>`;
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
    <summary>그림자 · 흡수 · 성장</summary>
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
  let destroyed = false, epoch = 0, current = {screen: 'list', projects: [], detail: null, loading: false, notice: null, busyMilestoneId: null};

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
    reset() { if (destroyed) return; epoch++; current = {screen: 'list', projects: [], detail: null, loading: false, notice: null, busyMilestoneId: null}; render(); },
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
