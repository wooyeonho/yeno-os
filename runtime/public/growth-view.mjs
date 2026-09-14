// A single mobile screen answering "무엇을 하고 있고, 무엇을 갖췄는가": the
// current quest, why Homunculus picked it, Kirby's skills and their real
// E->D->C->B->A->S grades, anything paused waiting on the owner, and the
// wealth/honor/fame ledger. Every value here is read straight from what the
// server already computed (growth.mjs, decide.mjs, quests.mjs) - this module
// never invents a level, a percentage, or a "new" badge that isn't a real
// comparison against a value seen before. Like the other *-view.mjs modules,
// this is a pure display: it owns no fetch and no mutation.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = v => { const t = typeof v === 'number' ? v : Date.parse(v); return v && Number.isFinite(t) ? new Date(t).toLocaleString('ko-KR') : null; };
const QUEST_STATUS_LABEL = {proposed:'저장됨 · 실행 대기',assigned:'배정됨',queued:'실행 대기',running:'진행 중',paused:'멈춤 · 확인 필요',completed:'결과 생성 완료',failed:'실패',cancelled:'종료됨'};
const PAUSE_LABEL = {restart:'재시작 후 재개 대기',codeVersionChanged:'기능 버전이 바뀌어 정지',autopilotStopped:'자동 운영 정지와 함께 멈춤',owner:'소유자가 직접 멈춤',dailyBudget:'오늘 호출 한도 도달',deadline:'실행 시간 상한 도달',emergency:'전체 멈춤',moduleDisabled:'관련 기능이 꺼져 있음',shutdown:'본체 재시작으로 정지'};
const LEDGER_LABEL = {wealth:'부', honor:'명예', fame:'인지도'};
const GRADE_ORDER = ['E','D','C','B','A','S'];

function driveName(id, drives) {
  const drive = (drives || []).find(item => item.id === id);
  return drive?.label || drive?.name || id;
}
function namedSkills(skills, catalog, kind) {
  return (skills || []).map(skill => {
    const meta = (catalog || []).find(item => item.id === skill.id);
    return {...skill, kind, name: meta?.name || skill.id};
  });
}

export function createGrowthView({root, onNavigate = () => {}, storage = null}) {
  if (!root) throw new Error('성장 화면에는 표시할 위치가 필요합니다.');
  root.classList.add('cockpit', 'growth-view');
  let destroyed = false;
  const SEEN_KEY = 'blackhole-growth-seen-grades-v1';
  // A skill's "새로 확인"/"승급" badge is a real diff against the last grade
  // this exact browser saw for that exact skill id - never a fabricated
  // recency window. First-ever view of a skill list honestly shows everything
  // as newly seen; that is what "new to this device" actually means.
  function readSeen() {
    if (!storage) return {};
    try { const value = JSON.parse(storage.getItem(SEEN_KEY) || '{}'); return value && typeof value === 'object' ? value : {}; }
    catch { return {}; }
  }
  function writeSeen(value) { if (!storage) return; try { storage.setItem(SEEN_KEY, JSON.stringify(value)); } catch { /* per-device convenience only */ } }

  function gradeBadge(skill) {
    const blocked = skill.nextGrade ? `<small>다음 ${esc(skill.nextGrade)}단계: ${esc(skill.blockedReason)}</small>` : '<small>가장 높은 단계입니다.</small>';
    return `<span class="status ${skill.grade !== 'E' ? 'completed' : ''}">${esc(skill.grade)}등급</span>${blocked}`;
  }
  function skillCard(skill) {
    const changeBadge = skill.change === 'new' ? '<span class="quest-drive-chip">새로 확인</span>'
      : skill.change ? `<span class="quest-drive-chip">승급 ${esc(skill.change)}→${esc(skill.grade)}</span>` : '';
    return `<article class="cockpit-cap-card"><div><strong>${esc(skill.name)}</strong>${changeBadge}</div>${gradeBadge(skill)}<small>${skill.kind === 'code' ? '코드형' : '선언형'} 기능 · 실행 ${Number(skill.evidence?.runCount) || 0}회 · 서로 다른 입력 ${Number(skill.evidence?.distinctInputCount) || 0}건</small></article>`;
  }
  function driveRow(drive, dominant) {
    return `<div class="cockpit-drive"${dominant ? ' data-selected="true"' : ''}><div><strong>${esc(drive.label || drive.name || drive.id)}</strong><span>${Number(drive.completed) || 0} / ${Number(drive.total) || 0}개 완료</span></div><p>${esc(drive.description || drive.goal || '')}</p></div>`;
  }
  function ledgerRow(key, ledger) {
    const latest = (ledger?.records || [])[0];
    return `<article class="quest-ledger"><div><h3>${esc(LEDGER_LABEL[key])}</h3><span>${Number(ledger?.selfReported) || 0}건 <small>사용자 보고</small></span></div>${latest ? `<p>${esc(latest.summary)}${latest.value !== null && latest.value !== undefined ? ` · ${esc(latest.value)} ${esc(latest.unit)}` : ''}</p><small>${esc(date(latest.createdAt) || '')}</small>` : '<p class="muted">아직 기록한 실제 성과가 없습니다.</p>'}</article>`;
  }

  function render(state, questData) {
    if (destroyed) return;
    const drives = questData?.drives || [];
    const decision = questData?.decision || null;
    const quests = questData?.quests || [];
    const activeQuest = quests.find(q => ['queued', 'running'].includes(q.status))
      || (decision ? quests.find(q => q.id === decision.top.questId) : null);
    const pending = quests.filter(q => q.status === 'paused');

    const rawSkills = [
      ...namedSkills(state?.growth?.capabilities?.skills, state?.autopilot?.capabilities, 'capability'),
      ...namedSkills(state?.growth?.code?.skills, state?.codeWorkshop?.entries, 'code'),
    ];
    const seen = readSeen(), nextSeen = {};
    const skills = rawSkills.map(skill => {
      const key = `${skill.kind}:${skill.id}`, prior = seen[key];
      nextSeen[key] = skill.grade;
      return {...skill, change: prior === undefined ? 'new' : prior !== skill.grade ? prior : null};
    }).sort((a, b) => GRADE_ORDER.indexOf(b.grade) - GRADE_ORDER.indexOf(a.grade));
    writeSeen(nextSeen);

    const ledgers = questData?.ledgers || {};

    root.innerHTML = `
      <section class="cockpit-hero" aria-label="지금 상태" data-core-state="${state?.emergencyStop ? 'stopped' : activeQuest ? 'running' : 'waiting'}">
        <div class="cockpit-hero-copy">
          <span class="eyebrow">지금 하는 일</span>
          ${activeQuest
            ? `<h3>${esc(activeQuest.goal)}</h3><p>${esc(activeQuest.successCriterion)}</p><span class="status ${activeQuest.status === 'completed' ? 'completed' : ''}">${esc(QUEST_STATUS_LABEL[activeQuest.status] || activeQuest.status)}</span>`
            : `<h3>${questData ? '지금 실행 중인 목표가 없습니다.' : '본체 상태를 불러오는 중입니다.'}</h3><p>새 목표를 저장하거나 “지금 가장 먼저 해야 할 일을 정해줘”라고 말해보세요.</p>`}
        </div>
      </section>

      <section class="cockpit-mind" aria-label="일곱 욕망과 선택 이유">
        <div class="cockpit-section-heading"><div><span class="eyebrow">HOMUNCULUS · 일곱 욕망</span><h3>왜 이 목표를 골랐는가</h3></div></div>
        ${decision
          ? `<div class="cockpit-decision"><span class="cockpit-step-label">${esc(driveName(decision.top.motivation.dominantDrives[0], drives))}${decision.top.motivation.dominantDrives[1] ? ' · ' + esc(driveName(decision.top.motivation.dominantDrives[1], drives)) : ''}</span><h4>${esc(decision.top.goal)}</h4><p>${esc(decision.top.successCriterion)}</p></div>`
          : '<p class="studio-empty">저장된 목표가 없어 아직 결정할 것이 없습니다. 목표를 저장하면 판단 근거가 나타납니다.</p>'}
        <div class="cockpit-drives">${drives.map(drive => driveRow(drive, decision?.top.motivation.dominantDrives.includes(drive.id))).join('')}</div>
        <p class="cockpit-fine">완료 개수는 그 욕망이 이끈 목표 중 실제 결과 파일이 생긴 것만 셉니다.</p>
      </section>

      <section class="cockpit-kirby" aria-label="커비가 갖춘 능력">
        <div class="cockpit-section-heading"><div><span class="eyebrow">KIRBY · 성장 등급</span><h3>보유 능력과 E~S 등급</h3></div></div>
        ${skills.length ? skills.map(skillCard).join('') : '<p class="studio-empty">아직 흡수한 능력이 없습니다.</p>'}
        <p class="cockpit-fine">등급은 실제 활성화·실행·복구 기록으로만 계산합니다. 주장으로 올라가지 않습니다.</p>
      </section>

      <section class="autopilot-blockers" aria-label="확인이 필요한 목표">
        <h3>확인이 필요한 목표 · ${pending.length}</h3>
        ${pending.length
          ? pending.map(q => `<article class="studio-card"><h3>${esc(q.goal)}</h3><p>${esc(PAUSE_LABEL[q.pauseReason] || '소유자 확인이 필요합니다.')}</p><div class="studio-actions"><button type="button" class="button subtle" data-growth-action="navigate" data-id="quests">목표 화면에서 확인</button></div></article>`).join('')
          : '<div class="studio-empty">지금 소유자 확인이 필요한 목표가 없습니다.</div>'}
      </section>

      <section class="quest-outcomes-section" aria-label="부 명예 인지도 장부">
        <div class="section-heading"><div><h2>부 · 명예 · 인지도</h2><p class="muted">완료된 산출물에 연결해 직접 보고한 성과입니다.</p></div></div>
        <div class="quest-ledgers">${Object.keys(LEDGER_LABEL).map(key => ledgerRow(key, ledgers[key])).join('')}</div>
      </section>

      <section class="studio-card" aria-label="전체 멈춤 상태">
        <h3>전체 멈춤</h3>
        <p>${state?.emergencyStop ? '지금 모든 작업이 멈춰 있습니다.' : '지금 정상 운영 중입니다.'}</p>
        <div class="studio-actions"><button type="button" class="button subtle" data-growth-action="navigate" data-id="control">조종석에서 제어</button></div>
      </section>`;
  }

  function handleClick(event) {
    const button = event.target.closest?.('[data-growth-action]');
    if (!button || !root.contains(button)) return;
    if (button.dataset.growthAction === 'navigate') onNavigate(button.dataset.id);
  }
  root.addEventListener('click', handleClick);

  return {
    updateState(state, questData) { render(state, questData); },
    reset() { if (destroyed) return; root.innerHTML = ''; },
    destroy() { if (destroyed) return; destroyed = true; root.removeEventListener('click', handleClick); root.innerHTML = ''; },
  };
}
