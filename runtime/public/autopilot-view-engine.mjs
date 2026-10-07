import {createCapabilityView} from './capability-view.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const list=value=>Array.isArray(value)?value:[];
const count=value=>Number.isFinite(value)&&value>=0?String(value):'확인 중';
const timestamp=value=>{
  const parsed=typeof value==='number'?value:Date.parse(value);
  return value&&Number.isFinite(parsed)?new Date(parsed).toLocaleString('ko-KR'):'아직 예정 없음';
};
const statusLabels={queued:'실행 대기',running:'진행 중',completed:'결과 저장됨',paused:'멈춤',cancelled:'종료됨',failed:'실패',blocked:'진행 조건 확인 필요',waiting:'다음 실행 대기',ready:'실행 준비',idle:'대기',pending:'대기',disabled:'멈춤',validation:'실제 검증자료 대기'};
const phaseLabels={0:'근거 수집',1:'반증 검토',2:'재현 계획',research:'근거 수집·연구 초안',video:'자막 영상 만들기',world:'세계 현황 갱신',forai:'내부 연구 페이지 점검',evidence:'근거 수집',answer:'연구 초안',complete:'결과 보관',done:'결과 보관'};

// The controller owns authentication, durable requests and artifact downloads.
// This view displays server state; it never schedules work or retries a mutation.
export function createAutopilotView({root,onControl,onOpenJob=()=>{},onOpenArtifact=()=>{},onCapabilityAction,onNavigate=()=>{},notify=()=>{}}) {
  if(!root||typeof onControl!=='function')throw new Error('자동 운영 화면과 제어 함수가 필요합니다.');
  let state=null,busy=false,awaiting=null,error='',epoch=0,destroyed=false;
  root.classList.add('studio','autopilot','cockpit');
  root.innerHTML='<div data-cockpit-main></div><div data-cockpit-capabilities></div>';
  const main=root.querySelector('[data-cockpit-main]');
  const capabilityView=createCapabilityView({root:root.querySelector('[data-cockpit-capabilities]'),onAction:onCapabilityAction,onOpenJob:id=>{const job=actualJob(id);if(job)invoke(onOpenJob,job);},onOpenArtifact:id=>invoke(onOpenArtifact,id),notify});
  const connected=()=>state?.online===true&&!destroyed;
  const data=()=>state?.autopilot||null;
  const jobs=()=>list(state?.jobs);
  const actualJob=id=>typeof id==='string'?jobs().find(job=>job.id===id):null;
  function recentJobs() {
    const ids=new Set(list(data()?.recentJobs));
    return jobs().filter(job=>ids.has(job.id)||job.autopilot||job.capability).sort((a,b)=>(Date.parse(b.updatedAt||b.createdAt)||0)-(Date.parse(a.updatedAt||a.createdAt)||0)).slice(0,8);
  }
  const button=(action,label,id='',disabled=false)=>`<button type="button" class="button subtle" data-autopilot-action="${esc(action)}" data-id="${esc(id)}"${disabled?' disabled':''}>${esc(label)}</button>`;
  function jobCard(job,{active=false}={}) {
    return `<article class="studio-card"><div class="studio-card-heading"><h3>${esc(job.title||job.research?.question||'자동 운영 작업')}</h3><span class="status ${job.status==='completed'?'completed':''}">${esc(statusLabels[job.status]||'상태 확인 필요')}</span></div><p class="studio-note">${esc(job.research?.trackCode||job.autopilot?.code||'자동 운영')} · ${esc(timestamp(job.updatedAt||job.createdAt))}</p>${job.error?`<p class="studio-note">${esc(job.error)}</p>`:''}<div class="studio-actions">${button('open-job','작업과 실행 기록',job.id,!connected())}${(!active&&job.status==='completed'?list(job.artifacts):[]).filter(file=>typeof file.id==='string').map(file=>button('open-artifact',file.name||file.filename||'저장된 결과 열기',file.id,!connected())).join('')}</div></article>`;
  }

  function corePanel(info,active,online) {
    const running=online&&info?.enabled===true&&!state?.emergencyStop&&active&&['queued','running'].includes(active.status);
    const stopped=online&&(state?.emergencyStop||info?.enabled===false);
    const coreState=!online?'offline':stopped?'stopped':running?'running':'waiting';
    const title=!online?'연결 확인 필요':stopped?'멈춤':running?'실행 중':'다음 판단 대기';
    const selected=active?.autopilot?.motivation??info?.mind?.selected??info?.mind?.lastDecision;
    const latest=list(info?.mind?.feedback).find(item=>item.artifactCount>0);
    return `<section class="cockpit-hero" aria-label="블랙홀 실행 상태" data-core-state="${coreState}">
      <div class="cockpit-core" aria-hidden="true"><i class="core-orbit orbit-one"></i><i class="core-orbit orbit-two"></i><i class="core-orbit orbit-three"></i><div class="core-center"><span>BLACK</span><strong>HOLE</strong><small>${esc(title)}</small></div></div>
      <div class="cockpit-hero-copy"><span class="eyebrow">JARVIS · 실행 총괄</span><h3>${esc(active?.title||selected?.goal||title)}</h3><p>${esc(selected?.successCriterion||'현재 상태와 저장된 결과를 확인하고, 허용된 다음 작업을 선택합니다.')}</p><div class="cockpit-signals"><div><small>오늘 자동 AI</small><strong>${count(info?.aiUsedToday)} <em>/ ${count(info?.dailyAiLimit)}회</em></strong></div><div><small>최근 결과 파일</small><strong>${latest?count(latest.artifactCount)+'개':'확인 전'}</strong></div><div><small>다음 판단</small><strong class="cockpit-date">${info?.enabled?esc(timestamp(info?.nextAt)):'운영 멈춤'}</strong></div></div><div class="studio-actions cockpit-shortcuts">${button('navigate','명령하기','control',!online)}${button('navigate','목표 맡기기','quests',!online)}${button('navigate','God Eye','world',!online)}${button('navigate','제작실','studio',!online)}</div></div>
    </section>`;
  }
  function mindPanel(mind,online) {
    const drives=list(mind?.drives),selected=mind?.selected??mind?.lastDecision,feedback=list(mind?.feedback).slice(0,3);
    const names=ids=>list(ids).map(id=>drives.find(drive=>drive.id===id)?.name||id).join(' · ');
    const kindNames={world:'God Eye 관측',research:'EUREKA 연구',video:'자막 MP4',forai:'For-Ai 페이지 점검',capability:'검증된 능력 실행'};
    return `<section class="cockpit-mind" aria-label="일곱 욕망과 판단 근거"><div class="cockpit-section-heading"><div><span class="eyebrow">HOMUNCULUS · 동기와 학습</span><h3>왜 이 일을 하는가</h3></div><small>${mind?.at?'판단 '+esc(timestamp(mind.at)):'첫 판단 대기'}</small></div>
      ${drives.length?`<div class="cockpit-drives">${drives.map(drive=>{const measured=Number.isFinite(drive.pressure)&&drive.pressure>=0&&drive.pressure<=100;return `<article class="cockpit-drive"${list(selected?.dominantDrives).includes(drive.id)?' data-selected="true"':''}><div><strong>${esc(drive.name)}</strong><span>${measured?drive.pressure.toFixed(0)+'점':'측정 전'}</span></div><meter min="0" max="100" value="${measured?drive.pressure:0}" aria-label="${esc(drive.name)} 우선 압력">${measured?drive.pressure:0}</meter><p>${esc(drive.reason||drive.description||'관측 자료 대기')}</p></article>`;}).join('')}</div><p class="cockpit-fine">점수는 현재 작업을 고르는 상대적인 압력입니다. 성공률이나 생명 수치가 아닙니다.</p>`:'<p class="studio-empty">본체가 저장된 작업과 결과를 읽으면 일곱 욕망의 판단 근거가 나타납니다.</p>'}
      <div class="cockpit-decision"><span class="cockpit-step-label">최근 선택</span><div><small>${esc(selected?names(selected.dominantDrives):'측정 자료 대기')}</small><h4>${esc(selected?.goal||'아직 선택한 목표가 없습니다.')}</h4><p>${esc(selected?.successCriterion||'실제 결과를 확인할 수 있는 작업부터 선택합니다.')}</p>${selected?`<span class="cockpit-capability-chip">사용 능력 · ${esc(kindNames[selected.kind]||selected.kind)}</span>`:''}</div></div>
      ${feedback.length?`<div class="cockpit-feedback"><h4>실행 뒤 확인한 것</h4>${feedback.map(item=>`<article><div><strong>${esc(item.goal||kindNames[item.kind]||'최근 자동 작업')}</strong><span class="status ${item.criterionMet===true?'completed':''}">${item.criterionMet===true?'기준 충족':esc(statusLabels[item.status]||'결과 확인')}</span></div><p>${esc(item.lesson||'다음 판단에 사용할 실행 기록을 보관했습니다.')}</p><small>${esc(timestamp(item.at))} · 파일 ${count(item.artifactCount)}개${Number.isFinite(item.artifactBytes)?' · '+new Intl.NumberFormat('ko-KR').format(item.artifactBytes)+' B':''}</small>${actualJob(item.jobId)?`<div class="studio-actions">${button('feedback-job','근거 열기',item.jobId,!online)}</div>`:''}</article>`).join('')}</div>`:''}
      ${list(mind?.candidates).length?`<details class="cockpit-details" data-section="choices"><summary>비교한 다음 작업 · ${mind.candidates.length}</summary><ol class="cockpit-candidates">${mind.candidates.slice(0,12).map(item=>`<li><strong>${esc(item.goal)}</strong><span>${Number.isFinite(item.score)?item.score.toFixed(1)+'점':'측정 전'}${item.selected?' · 선택됨':''}</span><p>${esc(item.successCriterion)}</p></li>`).join('')}</ol></details>`:''}
    </section>`;
  }
  function render() {
    if(destroyed)return;
    const openSections=[...main.querySelectorAll('details[open][data-section]')].map(el=>el.dataset.section);
    const info=data(),enabled=info?.enabled===true,active=actualJob(info?.activeJobId),online=connected();
    const mode=!online?'연결 끊김 · 마지막 확인 상태':!info?'자동 운영 상태 확인 중':state.emergencyStop?'전체 멈춤':enabled?(active&&['queued','running'].includes(active.status)?'자동 운영 중 · 작업 진행':'자동 운영 중'):'자동 운영 멈춤';
    const controlDisabled=!online||!info||busy||awaiting!==null||(!enabled&&state.emergencyStop===true);
    const recent=recentJobs().filter(job=>job.id!==active?.id);
    const tracks=list(info?.tracks),blockers=list(info?.blockers);
    main.innerHTML=`<div class="studio-heading cockpit-heading"><div><span class="eyebrow">BLACKHOLE / PERSONAL OPERATING CORE</span><h2>연호님의 실행 코어</h2><p>판단하고, 실행하고, 결과로 다음 판단을 바꿉니다.</p></div><button type="button" class="button ${enabled?'subtle':'primary'}" data-autopilot-action="control"${controlDisabled?' disabled':''}>${enabled?'자동 운영 멈춤':'자동 운영 시작'}</button></div>
      <div class="studio-status autopilot-status" role="status" aria-live="polite">${esc(mode)}</div>
      <div class="studio-error autopilot-error" role="alert"${error?'':' hidden'}>${esc(error)}</div>
      <div class="studio-message autopilot-control-status" role="status" aria-live="polite"${busy||awaiting!==null?'':' hidden'}>${busy?'본체에 제어 요청을 전달하고 있습니다.':awaiting!==null?'본체의 변경된 상태를 확인하고 있습니다.':''}</div>
      ${corePanel(info,active,online)}
      ${mindPanel(info?.mind,online)}
      <details class="cockpit-details" data-section="scope"><summary>운영 범위와 AI 사용 한도</summary><section class="studio-card" aria-label="자동 운영 범위와 한도"><h3>${esc(info?.summary||'연구와 세계 현황의 실제 작업·결과를 이곳에서 확인합니다.')}</h3><div class="studio-fields"><p><strong>자동 AI 사용</strong><br>${count(info?.aiUsedToday)} / ${count(info?.dailyAiLimit)}회</p><p><strong>전체 AI 사용</strong><br>${count(info?.globalUsedToday)} / ${count(info?.globalLimit)}회</p><p class="studio-wide"><strong>다음 확인 시각</strong><br>${enabled?esc(timestamp(info?.nextAt)):'자동 운영을 시작하면 본체가 다음 일을 확인합니다.'}</p></div><p class="studio-note">자동 AI 기본 한도는 하루 4회이며 전체 하루 ${count(info?.globalLimit)}회 한도 안에서 함께 사용합니다. 연구와 세계 현황은 6시간 간격으로 다음 작업을 확인합니다.</p><p class="studio-note">저장한 연구 초안으로 내부 페이지 점검과 자막 MP4를 하루 최대 1개씩 만듭니다. 연구 결과는 검증할 초안입니다. 생성형 영상과 외부 게시는 포함하지 않습니다.</p></section></details>
      <section class="autopilot-current" aria-label="지금 하는 일"><h3>지금 하는 일</h3>${active?jobCard(active,{active:true}):`<div class="studio-empty">${!online?'본체와 다시 연결하면 현재 실행 상태를 확인합니다.':!info?'본체 상태를 불러오는 중입니다.':state.emergencyStop?'전체 멈춤이 적용되어 있습니다.':enabled?'현재 실행 중인 작업이 없습니다. 다음 확인 시각과 진행 조건을 확인해 주세요.':'자동 운영이 멈춰 있습니다. 기존 작업과 결과는 보관됩니다.'}</div>`}</section>
      <section class="autopilot-results" aria-label="최근 자동 운영 결과"><h3>최근 작업과 저장된 결과</h3>${recent.length?recent.map(job=>jobCard(job)).join(''):'<div class="studio-empty">자동으로 접수한 작업이 생기면 실행 기록과 저장된 파일이 여기에 남습니다.</div>'}</section>
      <details class="cockpit-details" data-section="tracks"><summary>인류난제 연구 트랙 · ${tracks.length}</summary><section class="autopilot-tracks" aria-label="연구 트랙 진행"><h3>인류난제 연구 · ${tracks.length}개 트랙</h3>${tracks.length?tracks.map(track=>`<article class="studio-card"><div class="studio-card-heading"><h3>${esc(track.code)} · ${esc(track.name)}</h3><span class="status">${esc(statusLabels[track.status]||track.status||'대기')}</span></div>${track.phase!==undefined&&track.phase!==null&&track.phase!==''?`<p>${esc(phaseLabels[track.phase]||track.phase)}</p>`:''}${track.reason?`<p class="studio-note">${esc(track.reason)}</p>`:''}${actualJob(track.lastJobId)?`<div class="studio-actions">${button('open-job','최근 연구 기록',track.lastJobId,!online)}</div>`:''}</article>`).join(''):'<div class="studio-empty">본체에서 확인한 연구 트랙을 불러옵니다.</div>'}</section></details>
      <details class="cockpit-details" data-section="blockers"${blockers.length?' open':''}><summary>연결·실행 조건 · ${blockers.length}</summary><section class="autopilot-blockers" aria-label="진행을 막는 항목"><h3>진행을 막는 항목 · ${blockers.length}</h3>${blockers.length?blockers.map(item=>`<article class="studio-card"><h3>${esc(item.title||'확인할 항목')}</h3><p>${esc(item.reason||'본체에 기록된 사유를 확인해 주세요.')}</p></article>`).join(''):`<div class="studio-empty">${info?'현재 자동 운영 범위에 별도로 기록된 차단 항목이 없습니다.':'본체가 확인한 연결·실행 조건을 불러옵니다.'}</div>`}${info?.lastError?`<p class="studio-error" role="status">최근 실행 확인: ${esc(info.lastError)}</p>`:''}</section></details>`;
    for(const key of openSections)main.querySelector(`details[data-section="${key}"]`)?.setAttribute('open','');
    capabilityView.updateState({online,emergencyStop:state?.emergencyStop===true,capabilities:info?.capabilities||[],jobs:jobs()});
  }
  async function control() {
    const info=data();
    if(!connected()||!info||busy||awaiting!==null||(!info.enabled&&state.emergencyStop))return;
    const generation=epoch,target=info.enabled!==true;
    busy=true;awaiting=target;error='';render();
    try {
      await onControl(target);
      if(generation!==epoch||destroyed)return;
      if(data()?.enabled===target)awaiting=null;
    } catch(err) {
      if(generation!==epoch||destroyed)return;
      awaiting=null;error=err?.message||'자동 운영 제어 결과를 확인하지 못했습니다.';
      notify(error);
    } finally {
      if(generation===epoch&&!destroyed){busy=false;render();}
    }
  }
  function invoke(callback,value) {
    const generation=epoch;
    void Promise.resolve().then(()=>{
      if(generation===epoch&&connected())return callback(value);
    }).catch(err=>{if(generation===epoch&&connected())notify(err?.message||'저장된 결과를 열지 못했습니다.');});
  }
  function handleClick(event) {
    const target=event.target?.closest?.('[data-autopilot-action]');
    if(!target||!root.contains(target)||target.disabled||!connected())return;
    const action=target.dataset.autopilotAction,id=target.dataset.id;
    if(action==='control')void control();
    else if(action==='navigate'&&['control','quests','world','studio'].includes(id))invoke(onNavigate,id);
    else if(action==='feedback-job'){
      const job=actualJob(id);if(job&&list(data()?.mind?.feedback).some(item=>item.jobId===id))invoke(onOpenJob,job);
    } else if(action==='open-job'){
      const job=actualJob(id);
      const allowed=job&&(job.id===data()?.activeJobId||recentJobs().some(item=>item.id===id)||list(data()?.tracks).some(track=>track.lastJobId===id));
      if(allowed)invoke(onOpenJob,job);
    } else if(action==='open-artifact'){
      if(recentJobs().some(job=>job.status==='completed'&&list(job.artifacts).some(file=>file.id===id)))invoke(onOpenArtifact,id);
    }
  }
  root.addEventListener('click',handleClick);render();
  function reset(){if(destroyed)return;epoch++;state=null;busy=false;awaiting=null;error='';capabilityView.reset();render();}
  return {
    updateState(next){if(destroyed)return;state=next;if(connected()&&awaiting!==null&&data()?.enabled===awaiting)awaiting=null;render();},
    reset,
    destroy(){if(destroyed)return;reset();destroyed=true;epoch++;root.removeEventListener('click',handleClick);capabilityView.destroy();root.innerHTML='';}
  };
}
