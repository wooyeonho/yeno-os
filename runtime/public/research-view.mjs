import {createCommandRequest} from './command-request.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const date=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('ko-KR'):'시각 기록 없음';
const action=(name,label,id='')=>`<button type="button" class="button subtle" data-research-action="${esc(name)}" data-id="${esc(id)}">${esc(label)}</button>`;
const statuses={queued:'근거 수집 대기',running:'근거 수집·답안 작성 중',completed:'연구 초안 완료',paused:'멈춤 · 작업에서 사유 확인',cancelled:'종료됨',failed:'실패 · 검증된 답안 없음'};

// Authentication, private storage scope, and artifact downloads belong to the controller.
export function createResearchView({root,api,notify=()=>{},onJobCreated=()=>{},onOpenJob=onJobCreated,onOpenArtifact=()=>{},onJobAction=null,storage=globalThis.sessionStorage,storageKey='blackhole-pending-research-v1'}) {
  if(!root||typeof api!=='function')throw new Error('연구실 화면과 연결 함수가 필요합니다.');
  let data=null,state=null,error='',message='',storageError='',loading=false,epoch=0,destroyed=false,requests;
  const acceptedJobs=new Map();
  try {
    requests=createCommandRequest({storage,key:storageKey,allowPath:path=>path==='/api/research/run',transport:async(path,body)=>{
      const result=await api(path,body);
      if(typeof result?.job?.id!=='string'||typeof result?.quest?.id!=='string')throw new Error('연구 작업의 접수 응답을 확인하지 못했습니다.');
      return result;
    }});
  } catch(err) {storageError=err.message;}
  root.classList.add('studio','research');
  root.innerHTML=`<div class="studio-heading"><div><span class="eyebrow">EUREKA · RESEARCH</span><h2>문제의 답과, 다음에 검증할 해법</h2><p>질문 하나를 맡기면 공개 연구 근거를 모아 답안·반론·검증 방법을 파일로 남깁니다.</p></div>${action('refresh','새로고침')}</div><div class="research-status studio-status" role="status" aria-live="polite"></div><div class="research-pending studio-pending" role="status" hidden><p></p>${action('retry','같은 요청 접수 확인')}</div><div class="research-error studio-error" role="alert" hidden></div><div class="research-message studio-message" role="status" hidden></div><form class="research-form studio-card studio-form" data-research-form><h3>답을 찾을 문제</h3><div class="studio-fields"><label class="studio-wide">연구 트랙<select name="projectId" aria-describedby="research-track-scope"><option value="">일반 문제 · 직접 질문</option></select></label><p id="research-track-scope" class="research-scope studio-note studio-wide">기존 E01~E09 연구 프로젝트의 기록을 이어갑니다.</p><label class="studio-wide">알아내거나 해결할 것<textarea name="question" rows="5" maxlength="2000" required placeholder="예: 해수 담수화의 에너지 사용량을 줄이는 방법 중, 공개 실험으로 확인할 수 있는 접근과 비교 실험을 찾아줘."></textarea></label><label class="studio-wide">논문 검색어 · 영어<input name="query" maxlength="300" required placeholder="예: seawater desalination energy efficiency membrane" autocomplete="off"><small>트랙을 선택하면 검색어가 채워집니다. 질문에 맞게 좁혀 주세요.</small></label></div><p class="research-budget studio-note">한 작업당 AI 호출 최대 1회. 자료 수집에 실패하면 답안을 작성하지 않습니다.</p><div class="studio-actions"><button type="submit" class="button primary" data-research-run>근거 수집·답안 만들기</button></div><p class="studio-note">논문 제목·메타데이터와 제공된 초록을 기반으로 한 연구 초안입니다. 원문 검토·재현 실험이 필요한 주장은 구분해서 확인하세요.</p></form><section class="research-jobs studio-jobs" aria-label="연구 작업과 결과"></section>`;
  const $=selector=>root.querySelector(selector),form=$('[data-research-form]');
  const input=name=>form.querySelector(`[name="${name}"]`);
  const connected=()=>Boolean(state)&&state.online!==false&&!destroyed;
  const locked=()=>Boolean(storageError||requests?.pending||requests?.sending);
  const budgetReached=()=>Number.isFinite(data?.dailyCallLimit)&&Number.isFinite(data?.usage?.attempts)&&data.usage.attempts>=data.dailyCallLimit;
  const runnable=()=>connected()&&Boolean(data)&&data.providerReady===true&&!state?.emergencyStop&&!budgetReached()&&!locked();
  const track=()=>data?.tracks?.find(item=>item.projectId===input('projectId').value);

  function syncTrackOptions() {
    const selected=input('projectId').value||requests?.pending?.body?.projectId||'';
    input('projectId').innerHTML='<option value="">일반 문제 · 직접 질문</option>'+(data?.tracks||[]).map(item=>`<option value="${esc(item.projectId)}">${esc(item.code)} · ${esc(item.name)}</option>`).join('');
    if((data?.tracks||[]).some(item=>item.projectId===selected))input('projectId').value=selected;
    else input('projectId').value='';
    showScope();
  }
  function showScope() {const scope=track()?.scope||track()?.scopeConstraints;$('.research-scope').textContent=(Array.isArray(scope)?scope.join(' · '):scope)||'일반 질문은 별도 프로젝트를 만들지 않고 연구 작업으로 보관합니다.';}
  function restorePending() {
    const body=requests?.pending?.body;if(!body)return;
    input('question').value=typeof body.question==='string'?body.question:'';
    input('query').value=typeof body.query==='string'?body.query:'';
  }
  function jobs() {
    const map=new Map((data?.jobs||[]).map(job=>[job.id,job]));
    for(const [id,job] of acceptedJobs)if(!map.has(id))map.set(id,job);
    for(const job of state?.jobs||[])if(map.has(job.id)||job.research){
      const current=map.get(job.id);
      // A fresh overview may arrive before the controller's next state poll.
      if(current&&Number.isFinite(current.version)&&Number.isFinite(job.version)&&current.version>job.version)continue;
      if(current&&current.version===job.version&&Date.parse(current.updatedAt)>Date.parse(job.updatedAt))continue;
      map.set(job.id,job);
    }
    return [...map.values()].sort((a,b)=>Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0));
  }
  function renderJobs() {
    const entries=jobs().slice(0,20);
    $('.research-jobs').innerHTML=`<h3>저장된 연구와 답안 · ${jobs().length}</h3>${entries.length?`<div class="research-job-list">${entries.map(job=>{
      const files=Array.isArray(job.artifacts)?job.artifacts:[];
      return `<article class="studio-card research-job"><div class="studio-card-heading"><h3>${esc(job.research?.question||job.title||'연구 작업')}</h3><span class="status ${job.status==='completed'?'completed':''}">${esc(statuses[job.status]||'작업 상태 확인 필요')}</span></div><p class="studio-note">${esc(job.research?.trackCode||job.research?.code||'질문 연구')} · ${esc(date(job.createdAt))}</p>${job.status==='failed'?`<p class="studio-note">${esc(typeof job.error==='string'&&job.error?job.error:'접수 기록과 실패 사유를 확인하고 질문 또는 연결 상태를 점검해 주세요.')}</p>`:''}<div class="studio-actions">${action('open-job','작업과 실행 기록',job.id)}${files.map(file=>action('open-artifact',file.name||file.filename||'연구 결과 파일',file.id)).join('')}${onJobAction&&['queued','running','paused'].includes(job.status)?action('cancel-job','이 작업 종료',job.id):''}</div></article>`;
    }).join('')}</div>`:'<div class="studio-empty">첫 질문을 맡기면 수집한 근거와 연구 초안이 여기에 남습니다.</div>'}`;
  }
  function displayStatus() {
    if(destroyed)return;
    $('.research-status').textContent=!connected()?'본체 연결을 확인해 주세요.':loading?'연구 트랙과 저장한 작업을 불러오는 중…':!data?'연구실 정보를 불러와 주세요.':state?.emergencyStop?'전체 멈춤 중입니다.':data.providerReady!==true?'AI 연결 설정이 필요합니다.':budgetReached()?'오늘의 AI 호출 한도에 도달했습니다. 저장한 결과는 계속 열 수 있습니다.':`${data.tracks.length}개 연구 트랙 · AI ${Number(data.usage?.attempts)||0}/${Number.isFinite(data.dailyCallLimit)?data.dailyCallLimit:'설정 한도'}회 사용`;
    const pending=requests?.pending;
    $('.research-pending').hidden=!pending&&!storageError;
    $('.research-pending p').textContent=storageError?'요청을 안전하게 보관할 수 없어 실행을 멈췄습니다. 브라우저 저장 공간 접근을 확인해 주세요.':requests?.sending?'본체가 요청을 접수했는지 확인하고 있습니다.':'응답이 확인되지 않은 연구 요청이 있습니다. 같은 요청의 접수 여부를 확인하면 중복 실행을 피할 수 있습니다.';
    $('[data-research-action="retry"]').hidden=!pending;
    // Receipt lookup remains available after budget exhaustion or global stop.
    $('[data-research-action="retry"]').disabled=!connected()||Boolean(requests?.sending)||Boolean(storageError);
    $('[data-research-action="refresh"]').disabled=!connected()||loading;
    for(const element of form.querySelectorAll('input,textarea,select'))element.disabled=!connected()||!data||locked();
    $('[data-research-run]').disabled=!runnable();
    $('.research-error').textContent=error;$('.research-error').hidden=!error;
    $('.research-message').textContent=message;$('.research-message').hidden=!message;
  }
  async function refresh() {
    if(!connected()||loading)return;
    const generation=epoch;loading=true;displayStatus();
    try {
      const next=await api('/api/research');if(generation!==epoch||destroyed)return;
      if(!Array.isArray(next?.tracks)||!Array.isArray(next?.jobs))throw new Error('연구실 목록 형식을 읽을 수 없습니다.');
      data=next;error='';syncTrackOptions();renderJobs();
    } catch(err) {if(generation===epoch&&!destroyed)error=err.status===404?'이 본체에 연구실 업데이트가 아직 반영되지 않았습니다.':err.message;}
    finally {if(generation===epoch&&!destroyed){loading=false;displayStatus();}}
  }
  async function submit(body) {
    if(!connected()||!requests||requests.sending||storageError)return;
    if(body&&(!runnable()||requests.pending))return;
    const generation=epoch;error='';message='';
    try {
      if(body)requests.stage('/api/research/run',body);
      const response=requests.send();displayStatus();
      const outcome=await response;if(generation!==epoch||destroyed)return;
      if(outcome.kind==='accepted') {
        acceptedJobs.set(outcome.result.job.id,outcome.result.job);
        message='연구를 접수했습니다. 이 화면을 닫아도 본체에 남으며, 완료된 근거와 답안 파일을 다시 열 수 있습니다.';
        // Preserve the question for refinement, but never auto-submit a second task.
        onJobCreated(outcome.result.job);renderJobs();await refresh();
      } else if(outcome.kind==='rejected')error=outcome.error.message;
      else error='연구 요청의 접수 여부를 확인하지 못했습니다. 같은 요청 접수 확인을 눌러 주세요.';
    } catch(err) {if(generation===epoch&&!destroyed)error=err.message;}
    finally {if(generation===epoch&&!destroyed)displayStatus();}
  }
  const handleClick=event=>{
    const button=event.target.closest('[data-research-action]');if(!button||!root.contains(button)||button.disabled||destroyed)return;
    const name=button.dataset.researchAction,id=button.dataset.id;
    if(name==='refresh')void refresh();
    else if(name==='retry')void submit();
    else if(name==='open-job'){const job=jobs().find(item=>item.id===id);if(job)onOpenJob(job);}
    else if(name==='open-artifact'&&connected()&&jobs().some(job=>job.artifacts?.some(file=>file.id===id)))void Promise.resolve().then(()=>onOpenArtifact(id)).catch(err=>notify(err.message));
    else if(name==='cancel-job'&&connected()&&onJobAction&&jobs().some(job=>job.id===id&&['queued','running','paused'].includes(job.status)))void Promise.resolve().then(()=>onJobAction(id,'cancel')).catch(err=>notify(err.message));
  };
  const handleChange=event=>{
    if(event.target===input('projectId')){const selected=track();input('query').value=selected?.defaultEnglishQuery||'';showScope();}
  };
  const handleSubmit=event=>{
    const target=event.target.closest('[data-research-form]');if(!target||!root.contains(target)||destroyed)return;
    event.preventDefault();if(!runnable()||!target.reportValidity())return;
    const question=input('question').value.trim(),query=input('query').value.trim(),projectId=input('projectId').value;
    if(!question||question.length>2000){error='질문을 1~2,000자 이내로 적어 주세요.';displayStatus();return;}
    if(!query||query.length>300||!/[A-Za-z]/.test(query)){error='논문 검색어를 영어로 1~300자 이내로 적어 주세요.';displayStatus();return;}
    if(projectId&&!data.tracks.some(item=>item.projectId===projectId)){error='현재 연구 트랙을 다시 선택해 주세요.';displayStatus();return;}
    void submit({question,query,projectId:projectId||null,provider:'auto'});
  };
  root.addEventListener('click',handleClick);root.addEventListener('change',handleChange);root.addEventListener('submit',handleSubmit);
  restorePending();displayStatus();renderJobs();
  const setState=next=>{if(destroyed)return;state=next;if(data&&next?.agent?.usage)data={...data,usage:next.agent.usage,...(Number.isFinite(next.agent.dailyCallLimit)?{dailyCallLimit:next.agent.dailyCallLimit}:{})};displayStatus();renderJobs();};
  function reset(){epoch++;state=null;data=null;error='';message='';loading=false;acceptedJobs.clear();input('question').value='';input('query').value='';syncTrackOptions();displayStatus();renderJobs();}
  return {refresh,updateState:setState,setState,get pending(){return requests?.pending||null;},get sending(){return Boolean(requests?.sending);},reset,destroy(){if(destroyed)return;reset();destroyed=true;epoch++;root.removeEventListener('click',handleClick);root.removeEventListener('change',handleChange);root.removeEventListener('submit',handleSubmit);root.innerHTML='';}};
}
