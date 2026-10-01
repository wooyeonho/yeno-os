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

const RECOVERY_BLOCKERS = Object.freeze({
  providerMissing: '필요한 모델 연결이 설정되지 않았어요.',
  moduleDisabled: 'AI 기능이 꺼져 있어요.',
  outcomeUnknown: '이전 호출의 결과를 확인할 수 없어요. 중복 실행을 막았어요.',
  projectChanged: '프로젝트 범위가 바뀌어 임무를 멈췄어요.',
  dailyBudget: '오늘 허용된 호출 한도에 도달했어요.',
  schedulerHold: '작업 실행 조건을 다시 확인해야 해요.',
});
const RECOVERY_ACTIONS = Object.freeze({owner_review:'설정·권한을 검토해 주세요',wait:'상태를 바꾼 뒤 다시 확인하기'});
const RESOURCE_NAMES = Object.freeze({
  'model-provider':'모델 연결','local-model-provider':'로컬 모델','ai-module':'AI 기능','local-job-record':'임무 기록',
});
const RESOURCE_STATES = Object.freeze({available:'사용 가능',unavailable:'사용 불가',unknown:'확인 필요'});
const RECOVERY_NEXT_STEPS = Object.freeze({
  owner_or_policy_gate_review:'소유자가 설정과 추천을 확인해야 해요.',
  hold_until_emergency_stop_cleared:'전체 멈춤을 유지해요.',
  refresh_resources_and_verifier_evidence:'자원 상태와 검증 근거를 다시 확인해야 해요.',
  request_owner_budget_decision:'소유자가 비용 한도를 확인해야 해요.',
  ask_owner_to_replan:'소유자 확인 뒤 목표나 범위를 다시 정해야 해요.',
});

function recoveryCardHTML(state) {
  const decisions=state?.jev?.recentRecoveryDecisions;
  const decision=Array.isArray(decisions)?decisions.at(-1):null;
  if(!decision||decision.authorizesDispatch!==false)return '';
  const blockedJobId=decision.blocker?.evidenceRefs?.find(ref=>ref.type==='job')?.id;
  const blockedJob=(state?.jobs??[]).find(job=>job.id===blockedJobId);
  if(!blockedJob||!['paused','queued'].includes(blockedJob.status))return '';
  const validUntil=Date.parse(decision.resourceSnapshot?.validUntil??'');
  const fresh=Number.isFinite(validUntil)&&validUntil>=Date.now();
  const blocker=RECOVERY_BLOCKERS[decision.blocker?.code]||'작업이 멈춰 원인을 확인하고 있어요.';
  const resources=Array.isArray(decision.resourceSnapshot?.resources)?decision.resourceSnapshot.resources:[];
  const resourceRows=resources.map(resource=>{
    const name=RESOURCE_NAMES[resource.id]||'자원';
    const status=fresh?(RESOURCE_STATES[resource.status]||'확인 필요'):'다시 확인 필요';
    return `<li>${esc(name)}: ${esc(status)}</li>`;
  }).join('');
  const assessments=new Map((Array.isArray(decision.assessments)?decision.assessments:[]).map(item=>[item.alternativeId,item]));
  const suggestions=fresh?(Array.isArray(decision.recommendedAlternativeIds)?decision.recommendedAlternativeIds:[])
    .map(id=>({id,action:RECOVERY_ACTIONS[String(id).split(':',1)[0]],assessment:assessments.get(id)}))
    .filter(item=>item.action&&item.assessment?.status==='PASS')
    .map(item=>`<li>${esc(item.action)}</li>`).join(''):'';
  const next=fresh?(RECOVERY_NEXT_STEPS[decision.nextStep]||'소유자가 다음 단계를 검토해야 해요.'):'자원 정보가 만료됐어요. 다시 확인해야 해요.';
  return `<section class="living-recovery" aria-label="JEV 막힘 진단">
    <span class="eyebrow">JEV · 안전 점검 (자동 실행 안 함)</span>
    <p><strong>막힌 이유</strong> ${esc(blocker)}</p>
    ${resourceRows?`<ul aria-label="확인된 자원">${resourceRows}</ul>`:''}
    <p><strong>검증된 선택지</strong></p>
    ${suggestions?`<ul>${suggestions}</ul>`:'<p>안전성을 확인한 우회 경로가 아직 없어요.</p>'}
    <p><strong>다음 행동</strong> ${esc(next)}</p>
  </section>`;
}


// F09 - which core is this screen looking at. Read straight from the server's
// own runtimeIdentity (source commit detected from deployment metadata or the
// checkout, data dir name, deployment kind); nothing is inferred client-side,
// and a missing value is shown as unknown rather than filled in.
function identityFooterHTML(state) {
  const id = state?.runtimeIdentity;
  if (!id) return '';
  const sha = typeof id.sourceCommit === 'string' ? id.sourceCommit.slice(0, 12) : '알 수 없음';
  return `<p class="cockpit-fine living-identity" data-living-identity="${esc(id.sourceCommit ?? '')}">코어 ${esc(id.deployment ?? 'unknown')} · 소스 ${esc(sha)} · API v${esc(state?.apiVersion ?? '?')} · 데이터 ${esc(id.dataDirName ?? '?')}</p>`;
}

export function createLivingCoreView({root, onNavigate = () => {}}) {
  if (!root) throw new Error('Living Core에는 표시할 위치가 필요합니다.');
  root.classList.add('living-core');
  let destroyed = false;

  function render(state, online) {
    if (destroyed) return;
    const core = state?.core || null;
    const visualState = coreVisualState({activity: core?.activity, emergencyStop: state?.emergencyStop === true, online});
    const voiceReady = online && state?.emergencyStop !== true;
    root.innerHTML = `
      <div class="living-orb-wrap">
        <div class="living-orb ${esc(visualState)}" aria-hidden="true"><span class="living-orb-ring"></span><span class="living-orb-core"></span></div>
        <div class="living-orb-text">
          <span class="eyebrow">BLACKHOLE</span>
          <p class="living-sentence">${esc(sentenceFor(core, visualState))}</p>
        </div>
      </div>
      <button type="button" class="button primary living-voice-cta" data-living-action="voice" ${voiceReady ? '' : 'disabled'}>블랙홀에게 말하기</button>
      ${missionCardHTML(core)}
      ${recoveryCardHTML(state)}
      ${signalRowHTML(core)}
      ${projectOrbitHTML(state?.projects)}
      ${recentItemHTML(core, state?.memories)}
      ${identityFooterHTML(state)}
    `;
  }

  function handleClick(event) {
    const button = event.target.closest?.('[data-living-action]');
    if (!button || !root.contains(button) || button.disabled) return;
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
