// BLACKHOLE Drive Orbit (Seven Drives UI, issue #25). Shared, pure view
// used by both the web cockpit and the native Android controller - exactly
// like living-core-view.mjs and project-universe-view.mjs, this module
// owns no fetch: the host supplies a driveOrbitModel() result (plus
// screen/loading/notice) via updateState(), and only ever asks the host to
// act through the callbacks below (opening a linked project, closing back
// to Home). It never re-derives pressure, trend, or rationale itself.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = v => { const t = typeof v === 'number' ? v : Date.parse(v); return v && Number.isFinite(t) ? new Date(t).toLocaleString('ko-KR') : null; };
const truncate = (text, max) => { const value = String(text ?? ''); return value.length > max ? `${value.slice(0, max)}…` : value; };

function pressureLabel(pressure) {
  return pressure === null ? '평가 전' : `현재 압력 ${pressure}`;
}

function nodeHTML(drive) {
  return `<button type="button" class="dob-node ${drive.isMissionCausal ? 'is-causal' : ''}" data-dob-action="open-drive" data-drive-id="${esc(drive.driveId)}">
    <span class="dob-node-name">${esc(drive.worldName)}</span>
    ${drive.isMissionCausal ? '<span class="dob-node-badge">지배 욕망</span>' : ''}
    <span class="dob-node-pressure">${esc(pressureLabel(drive.pressure))}</span>
  </button>`;
}

function orbitScreenHTML(state) {
  const explanationLine = state.explanation
    ? `<p class="dob-explanation">${esc(state.explanation)}</p>`
    : `<p class="dob-explanation dob-empty-line">${state.missionCausalDriveId === null ? '현재 미션의 지배 욕망 없음' : ''}</p>`;
  return `
    <div class="dob-explain-card">
      <span class="eyebrow">왜 BLACKHOLE이 지금 이 목표를 선택했어?</span>
      ${explanationLine}
    </div>
    <div class="dob-orbit" role="list">${state.drives.map(nodeHTML).join('')}</div>
  `;
}

function detailScreenHTML(state) {
  const drive = state.drives.find(d => d.driveId === state.selectedDriveId);
  if (!drive) return `<p class="dob-empty-line">욕망을 찾을 수 없습니다.</p>`;
  let reasonLine;
  if (drive.pressure === null) reasonLine = '판단 근거 부족';
  else if (drive.evidenceCount > 0) reasonLine = esc(drive.reason);
  else reasonLine = '현재 이 욕망에 기여하는 제안 목표 없음';
  return `<div class="dob-detail">
    <button type="button" class="text-button dob-back" data-dob-action="back">← 목록으로</button>
    <h2>${esc(drive.worldName)}</h2>
    ${drive.isMissionCausal ? '<p class="dob-causal-line">현재 미션의 지배 욕망입니다.</p>' : ''}
    <p class="dob-pressure-line">${esc(pressureLabel(drive.pressure))}${drive.pressure !== null ? ' · 현재 기여' : ''}</p>
    <p class="dob-reason">${reasonLine}</p>
    ${drive.linkedGoal ? `<p class="dob-goal">연결된 목표: "${esc(truncate(drive.linkedGoal, 120))}"</p>` : ''}
    ${drive.linkedProjectId
      ? `<button type="button" class="button subtle" data-dob-action="open-project" data-project-id="${esc(drive.linkedProjectId)}">연결된 프로젝트 열기</button>`
      : `<p class="dob-empty-line">연결된 프로젝트 없음</p>`}
    <p class="dob-measured">${drive.measuredAt ? `측정 시각: ${esc(date(drive.measuredAt))}` : '평가 전'}</p>
    <p class="dob-trend">변화 기록 없음</p>
  </div>`;
}

export function createDriveOrbitView({root, onOpenProject = () => {}, onClose = () => {}}) {
  if (!root) throw new Error('욕망 화면에는 표시할 위치가 필요합니다.');
  root.classList.add('drive-orbit');
  let destroyed = false;
  let current = {screen: 'orbit', selectedDriveId: null, loading: false, notice: null, measuredAt: null, missionCausalDriveId: null, missionCausalWorldName: null, explanation: null, drives: []};

  function render() {
    if (destroyed) return;
    const isDetail = current.screen === 'detail';
    root.innerHTML = `
      <div class="dob-header">
        <span class="eyebrow">일곱 욕망</span>
        <button type="button" class="text-button dob-close" data-dob-action="close">닫기</button>
      </div>
      ${current.notice ? `<p class="dob-notice" role="alert">${esc(current.notice)}</p>` : ''}
      <div class="dob-screen ${isDetail ? 'dob-screen-detail' : 'dob-screen-orbit'}">
        ${current.loading && !current.drives.length ? '<div class="dob-loading" role="status">불러오는 중…</div>' : isDetail ? detailScreenHTML(current) : orbitScreenHTML(current)}
      </div>
    `;
  }

  function handleClick(event) {
    const button = event.target.closest?.('button[data-dob-action]');
    if (!button || !root.contains(button)) return;
    const action = button.dataset.dobAction;
    if (action === 'close') { onClose(); return; }
    if (action === 'back') { current = {...current, screen: 'orbit', selectedDriveId: null}; render(); return; }
    if (action === 'open-drive') { current = {...current, screen: 'detail', selectedDriveId: button.dataset.driveId}; render(); return; }
    if (action === 'open-project') { onOpenProject(button.dataset.projectId); }
  }

  root.addEventListener('click', handleClick);
  render();

  return {
    updateState(next) { if (destroyed) return; current = {...current, ...next}; render(); },
    reset() { if (destroyed) return; current = {screen: 'orbit', selectedDriveId: null, loading: false, notice: null, measuredAt: null, missionCausalDriveId: null, missionCausalWorldName: null, explanation: null, drives: []}; render(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.removeEventListener('click', handleClick);
      root.innerHTML = '';
    },
  };
}
