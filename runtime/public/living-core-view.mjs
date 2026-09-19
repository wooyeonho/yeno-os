// BLACKHOLE Living Core (FINAL UI Slice 1 - issue #25, "FINAL ORGANIC UI
// IMPLEMENTATION CONTRACT"). This is the persistent visual anchor for the
// Home surface: one entity, not a dashboard widget.
//
// Every value here is read straight from data app.js already fetches -
// this module owns no fetch and no mutation, exactly like the other
// *-view.mjs modules (see growth-view.mjs).
//
//   - `state.core.activity` is the REAL activity enum blackhole-core.mjs
//     produces (see ACTIVITY_STATES there). Today only idle/executing/
//     emergency are ever actually written by the backend; the other visual
//     states this module supports (listening/thinking/absorbing/planning/
//     verifying/remembering/leveling/blocked) simply never render until a
//     later phase starts writing them - this module never invents a cycle
//     between states on its own timer. Animation is a view of state, never
//     a generator of it.
//   - `online` is a client-side connectivity fact (never a server activity
//     value) passed in separately, so a real disconnect is never confused
//     with, or overwritten by, a real Core activity.
//   - emergencyStop always wins over both: a real emergency stop must never
//     be hidden behind a stale "idle" sentence.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = v => { const t = typeof v === 'number' ? v : Date.parse(v); return v && Number.isFinite(t) ? new Date(t).toLocaleString('ko-KR') : null; };

// One truthful sentence per real activity - never a generic "working..."
// filler. Only idle/executing/emergency are reachable today; the rest are
// defined now so a later phase can start writing that activity value
// without this module needing to change.
const ACTIVITY_SENTENCE = {
  idle: '명령을 기다리고 있어요.',
  listening: '듣고 있어요.',
  thinking: '생각을 정리하고 있어요.',
  absorbing: '새 자료를 받아들이고 있어요.',
  planning: '다음 단계를 계획하고 있어요.',
  executing: '실행 중이에요.',
  verifying: '결과를 확인하고 있어요.',
  remembering: '기억을 정리하고 있어요.',
  leveling: '한 단계 성장하고 있어요.',
  blocked: '확인이 필요한 항목이 있어요.',
};

function coreVisualState({activity, emergencyStop, online}) {
  if (emergencyStop) return 'emergency';
  if (!online) return 'offline';
  return activity && ACTIVITY_SENTENCE[activity] ? activity : 'idle';
}

function sentenceFor(core, visualState) {
  if (visualState === 'offline') return '본체 연결을 확인하고 있어요.';
  if (visualState === 'emergency') return '전체 멈춤 상태예요. 해제하면 다시 움직여요.';
  return ACTIVITY_SENTENCE[core?.activity] || ACTIVITY_SENTENCE.idle;
}

function missionCardHTML(core) {
  if (!core?.missionGoal) return `<article class="living-mission empty"><span class="eyebrow">현재 미션</span><p>진행 중인 미션 없음</p></article>`;
  const goal = core.missionGoal.length > 60 ? `${core.missionGoal.slice(0, 60)}…` : core.missionGoal;
  // UI Slice 2 (issue #25): when this mission is real evidence tied to a
  // real project (focusProjectId), the card opens that project's Universe
  // detail directly - otherwise it falls back to the existing goal/quest
  // surface exactly as before.
  const target = core.focusProjectId ? `data-id="project-universe" data-project-id="${esc(core.focusProjectId)}"` : 'data-id="quests"';
  return `<button type="button" class="living-mission" data-living-action="navigate" ${target}><span class="eyebrow">현재 미션</span><p>${esc(goal)}</p>${core.focusProjectName ? `<small>${esc(core.focusProjectName)}</small>` : ''}</button>`;
}

function signalRowHTML(core) {
  // Seven Drives UI (issue #25): the normal owner-facing Home shows only
  // the canonical owner-facing world name (부/진화/지식/자유/명예/영향력/
  // 창조), never the old internal sin vocabulary - that stays available
  // only through blackholeCore's own advanced/diagnostic fields, not here.
  // The chip is a real drill-down entry into the Drive Orbit surface; the
  // Shadow chip stays inert until a real Shadow Army owner-facing surface
  // exists.
  const driveLabel = core?.dominantDriveWorldName ? esc(core.dominantDriveWorldName) : '욕망 평가 전';
  const shadows = core?.activeShadowCount > 0 ? `그림자 ${core.activeShadowCount}개 활동 중` : '활동 중인 그림자 없음';
  return `<div class="living-signals"><button type="button" class="living-signal-chip living-signal-drive" data-living-action="navigate" data-id="drive-orbit">${driveLabel}</button><span class="living-signal-chip">${esc(shadows)}</span></div>`;
}

function projectOrbitHTML(projects) {
  const active = (projects || []).filter(p => p.status === 'active');
  if (!active.length) return `<div class="living-orbit empty"><span class="eyebrow">프로젝트</span><p>진행 중인 프로젝트 없음</p></div>`;
  const shown = active.slice(0, 4);
  const rest = active.length - shown.length;
  // UI Slice 2 (issue #25): each node opens that exact project's real
  // Universe detail (data-project-id), not the generic list - tapping a
  // specific project should go straight to it, not make the owner find it
  // again in a list they just tapped it out of.
  const nodes = shown.map(p => {
    const label = p.name.length > 10 ? `${p.name.slice(0, 10)}…` : p.name;
    return `<button type="button" class="living-orbit-node" data-living-action="navigate" data-id="project-universe" data-project-id="${esc(p.id)}" title="${esc(p.name)}">${esc(label)}</button>`;
  }).join('');
  const more = rest > 0 ? `<button type="button" class="living-orbit-node living-orbit-more" data-living-action="navigate" data-id="project-universe">+${rest}</button>` : '';
  return `<div class="living-orbit"><span class="eyebrow">프로젝트</span><div class="living-orbit-row">${nodes}${more}</div></div>`;
}

function recentItemHTML(core, memories) {
  const latest = (memories || []).slice().sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))[0];
  if (latest) {
    const text = latest.text.length > 70 ? `${latest.text.slice(0, 70)}…` : latest.text;
    const when = date(latest.createdAt);
    return `<button type="button" class="living-recent" data-living-action="navigate" data-id="memory"><span class="eyebrow">최근 기억</span><p>${esc(text)}</p>${when ? `<small>${esc(when)}</small>` : ''}</button>`;
  }
  if (core?.recentArtifactResult) return `<button type="button" class="living-recent" data-living-action="navigate" data-id="control"><span class="eyebrow">최근 결과물</span><p>최근 결과물 있음</p></button>`;
  return `<div class="living-recent empty"><span class="eyebrow">최근 활동</span><p>최근 결과물 없음</p></div>`;
}

export function createLivingCoreView({root, onNavigate = () => {}}) {
  if (!root) throw new Error('Living Core에는 표시할 위치가 필요합니다.');
  root.classList.add('living-core');
  let destroyed = false;

  function render(state, online) {
    if (destroyed) return;
    const core = state?.core || null;
    const visualState = coreVisualState({activity: core?.activity, emergencyStop: state?.emergencyStop === true, online});
    root.innerHTML = `
      <div class="living-orb-wrap">
        <div class="living-orb ${esc(visualState)}" aria-hidden="true"><span class="living-orb-ring"></span><span class="living-orb-core"></span></div>
        <div class="living-orb-text">
          <span class="eyebrow">BLACKHOLE</span>
          <p class="living-sentence">${esc(sentenceFor(core, visualState))}</p>
        </div>
      </div>
      <button type="button" class="button primary living-voice-cta" data-living-action="voice">블랙홀에게 말하기</button>
      ${missionCardHTML(core)}
      ${signalRowHTML(core)}
      ${projectOrbitHTML(state?.projects)}
      ${recentItemHTML(core, state?.memories)}
    `;
  }

  function handleClick(event) {
    const button = event.target.closest?.('[data-living-action]');
    if (!button || !root.contains(button)) return;
    if (button.dataset.livingAction === 'voice') onNavigate('voice');
    // The optional second projectId argument is additive: every existing
    // caller that only reads the first argument keeps working unchanged.
    else if (button.dataset.livingAction === 'navigate') onNavigate(button.dataset.id, button.dataset.projectId ?? null);
  }
  root.addEventListener('click', handleClick);

  return {
    updateState(state, online) { render(state, online); },
    reset() { if (destroyed) return; root.innerHTML = ''; },
    destroy() { if (destroyed) return; destroyed = true; root.removeEventListener('click', handleClick); root.innerHTML = ''; },
  };
}
