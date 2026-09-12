(async () => {
const {createCommandRequest} = await import('/command-request.mjs');
const {sourceMatches,sourceReferenceNames} = await import('/source-reference-labels.mjs');
const {sourceDestination,sourceCoverage} = await import('/absorption-routing.mjs');
const {createWorldView} = await import('/world-view.mjs');
const {createStudioView} = await import('/studio-view.mjs');
const {connectBrowser,enableInstall} = await import('/web-client.mjs');
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = (value) => value ? new Date(value).toLocaleString('ko-KR', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
enableInstall({button:$('install-app'),hint:$('install-hint')});
const browserSession = await connectBrowser();
const requestStorage = browserSession.storage;
let token = 'cookie-session', authEpoch = 0;
let current = null, online = false, loading = false, lastRevision = null, selectedSnapshot = null, artifact = null;
let toastTimer, activeTab = 'control', commandRequests, commandStorageError, projectRequests, projectStorageError, editingProject = null;
let sourceRequests, sourceStorageError, editingSource = null, sourceImportPreview = null, sourceFileGeneration = 0;
let questRequests, questStorageError, questData = null, questLoading = false, questEpoch = 0, questLoadedRevision = null, questError = '';
let questDrive = 'greed', questProjectOptions = '', questProviderOptions = '';
let questDriveOptions = '';
let questRenderedHTML = '';
let questOutcomeId = null;
const questReviewProviders = new Map();
const providerNames = {openai:'OpenAI · GPT',gemini:'Google · Gemini',moonshot:'Moonshot · Kimi',xai:'xAI · Grok',anthropic:'Anthropic · Claude',nvidia:'NVIDIA'};
const fallbackDrives = [
  {id:'greed',label:'강욕',description:'수익과 소유 자산을 늘릴 구체적인 결과를 만듭니다.'},
  {id:'gluttony',label:'폭식',description:'목표에 부족한 능력과 자료를 찾고 검증합니다.'},
  {id:'envy',label:'질투',description:'비교 대상의 강점을 분석하고 개선점을 찾습니다.'},
  {id:'pride',label:'긍지',description:'품질과 신뢰를 외부에서 확인할 기준을 세웁니다.'},
  {id:'lust',label:'매혹',description:'사용자가 자발적으로 찾는 매력과 이용 경험을 만듭니다.'},
  {id:'wrath',label:'분노',description:'오류와 반복되는 불편을 줄입니다.'},
  {id:'sloth',label:'나태',description:'같은 품질을 유지하면서 직접 해야 할 일을 줄입니다.'},
];
const names = {queued:'대기',running:'실행 중',paused:'멈춤',completed:'완료',failed:'실패',cancelled:'종료'};
const projectNames = {active:'진행',paused:'보류',archived:'보관'};
const readingNames = {unread:'아직 읽지 않음',partial:'일부 확인',read:'본문 확인',unavailable:'접근 불가'};
const decisionNames = {pending:'검토 대기',candidate:'개선 후보',deferred:'보류',rejected:'적용 제외'};
const moduleInfo = {memory:['기억','내용을 저장하고 다시 찾습니다.'],documents:['문서','제공한 내용을 실제 문서 파일로 만듭니다.'],diagnostics:['진단·개선 제안','본체 상태와 실행 이력에서 개선 후보를 찾습니다.'],ai:['AI 작성','본체에 설정한 외부 AI로 작성합니다. 사용료가 발생할 수 있습니다.']};
function notify(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,4500); }
function friendly(message) {
  const pairs=[['Unauthorized','연결 키를 확인해 주세요.'],['Invalid pairing token','연결 키가 올바르지 않습니다.'],['Pairing token required','연결 키를 입력해 주세요.'],['Emergency stop is active','전체 멈춤 상태입니다. 먼저 정지를 해제해 주세요.'],['AI provider is not configured','본체에 AI 연결을 먼저 설정해 주세요.'],['Job changed; refresh before retrying','작업 상태가 바뀌었습니다. 최신 상태를 확인한 뒤 다시 눌러주세요.'],['Terminal jobs cannot be changed','이미 끝난 작업입니다.'],['Pause or stop all active jobs before restoring','작업을 먼저 모두 멈춘 뒤 복원해 주세요.'],['Module disabled','해당 능력이 꺼져 있습니다. 능력·설정에서 켜주세요.'],['A project with this name already exists','같은 이름의 프로젝트가 있습니다. 다른 이름을 입력해 주세요.'],['Project changed; refresh before updating','프로젝트가 변경되었습니다. 최신 내용을 확인해 주세요.'],['Project not found','프로젝트를 찾을 수 없습니다. 목록과 이름을 확인해 주세요.'],['repositoryUrl must','GitHub 저장소의 HTTPS 주소를 입력해 주세요. 예: https://github.com/계정/저장소'],['Project names cannot contain','프로젝트 이름에는 줄바꿈이나 | 기호를 사용할 수 없습니다.'],['name must be','프로젝트 이름을 1~80자로 입력해 주세요.']];
  if(String(message).includes('module is disabled'))return '해당 능력이 꺼져 있습니다. 능력·설정에서 켜주세요.';
  const sourceErrors=[['Source changed','자료가 다른 곳에서 변경되었습니다. 최신 내용을 확인해 주세요.'],['Source not found','자료를 찾을 수 없습니다. 목록을 확인해 주세요.'],['canonical URL','같은 원본 주소의 자료가 있습니다. 기존 자료와 내용을 확인해 주세요.']];
  for(const [a,b] of sourceErrors)if(String(message).includes(a))return b;
  for(const [a,b] of pairs)if(String(message).includes(a))return b;
  return String(message || '요청을 처리하지 못했습니다.');
}
async function api(path, data, options={}) {
  const epoch=authEpoch;
  const response=await browserSession.fetch(path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(options.timeout || 12000)});
  if(epoch!==authEpoch||!token)throw new Error('연결이 바뀌어 이전 응답을 닫았습니다.');
  if(options.raw && response.ok)return response;
  let result;
  try {result=await response.json();} catch(error) {if(response.ok)throw new Error('본체의 접수 응답을 읽지 못했습니다.');result={};}
  if(epoch!==authEpoch||!token)throw new Error('연결이 바뀌어 이전 응답을 닫았습니다.');
  if(!response.ok){if(response.status===401){clearConnection();location.reload();}const error=new Error(friendly(result.error?.message || result.error || result.message || `응답 ${response.status}`));error.status=response.status;error.project=result.project;error.source=result.source;throw error;}
  return result;
}
const worldView=createWorldView({load:()=>api('/api/world'),submit:()=>submitCommand('/api/commands',{text:'세계 현황'})});
const studioView=createStudioView({root:$('studio-root'),api,storage:requestStorage,notify,onJobCreated:()=>{showTab('control');void refresh(true);}});
const requestId=()=>crypto.randomUUID();
let otherRequests,otherStorageError;
try{otherRequests=createCommandRequest({storage:requestStorage,key:'blackhole-pending-other-v1',allowPath:path=>['/api/memory','/api/snapshots','/api/settings','/api/control'].includes(path)||/^\/api\/(jobs|snapshots)\/[a-f0-9-]+\/(action|restore)$/.test(path),transport:(path,body)=>api(path,body)});}catch(error){otherStorageError=error;}
function renderOtherRequest(){const pending=otherRequests?.pending;$('other-request').hidden=!pending&&!otherStorageError;$('other-request-message').textContent=otherStorageError?'작업 보관함을 읽지 못해 새 저장을 멈췄습니다.':pending?'이전 저장·설정 변경의 접수 여부를 확인해야 합니다. 같은 요청으로 확인하세요.':'';$('retry-other').disabled=!online||!!otherStorageError||!!otherRequests?.sending;}
async function durableMutation(path,body){
  if(otherStorageError)throw otherStorageError;
  if(otherRequests.pending)throw new Error('상단의 같은 요청 확인을 눌러 이전 접수를 확인해 주세요.');
  otherRequests.stage(path,body);return retryOther();
}
async function retryOther(){const promise=otherRequests.send();renderOtherRequest();try{const outcome=await promise;if(outcome.kind==='accepted')return outcome.result;throw outcome.error;}finally{renderOtherRequest();}}
$('retry-other').addEventListener('click',()=>perform(async()=>{await retryOther();notify('이전 요청의 접수를 확인했습니다.');}));
try {commandRequests=createCommandRequest({storage:requestStorage,transport:(path,body)=>api(path,body)});}
catch(error) {commandStorageError=error;}
try {
  projectRequests=createCommandRequest({storage:requestStorage,key:'yeno-pending-project-v1',
    allowPath:path=>path==='/api/projects' || /^\/api\/projects\/[a-zA-Z0-9-]+\/update$/.test(path),
    transport:async(path,body)=>{
      const result=await api(path,body);
      if(!result?.project?.id || !Number.isInteger(result.project.version))throw new Error('프로젝트의 접수 응답을 확인하지 못했습니다.');
      return result;
    }});
} catch(error) {projectStorageError=error;}
try {
  sourceRequests=createCommandRequest({storage:requestStorage,key:'yeno-pending-source-v1',
    allowPath:path=>path==='/api/sources' || path==='/api/sources/import' || /^\/api\/sources\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/update$/i.test(path),
    transport:async(path,body)=>{
      const result=await api(path,body);
      const valid=source=>typeof source?.id==='string' && Number.isInteger(source.version);
      if(path==='/api/sources/import' ? !Array.isArray(result?.sources) || result.sources.length!==body.sources.length || !result.sources.every(valid) || !Number.isInteger(result.createdCount) || !Number.isInteger(result.reusedCount) || result.createdCount+result.reusedCount!==body.sources.length : !valid(result?.source))throw new Error('자료의 접수 응답을 확인하지 못했습니다.');
      return result;
    }});
} catch(error) {sourceStorageError=error;}
try {
  questRequests=createCommandRequest({storage:requestStorage,key:'yeno-pending-quest-v1',
    allowPath:path=>path==='/api/quests' || path==='/api/outcomes' || /^\/api\/quests\/[a-zA-Z0-9-]+\/(run|review)$/.test(path) || /^\/api\/jobs\/[a-zA-Z0-9-]+\/action$/.test(path),
    transport:async(path,body)=>{
      const result=await api(path,body);
      const action=path.endsWith('/action');
      const valid=path==='/api/outcomes'?typeof result?.outcome?.id==='string':action?typeof result?.job?.id==='string':typeof result?.quest?.id==='string' && (path==='/api/quests' || typeof result?.job?.id==='string');
      if(!valid)throw new Error('목표 요청의 접수 응답을 확인하지 못했습니다.');
      return result;
    }});
} catch(error) {questStorageError=error;}
function renderCommandRequest() {
  const pending=commandRequests?.pending, busy=commandRequests?.sending;
  $('command').readOnly=Boolean(pending || commandStorageError);
  $('command-type').disabled=Boolean(pending || commandStorageError);
  $('send-command').disabled=!online || Boolean(busy || commandStorageError);
  $('send-command').textContent=busy?'접수 확인 중…':pending?'같은 요청 재시도':'실행 ↗';
  for(const button of document.querySelectorAll('[data-example], [data-quick]'))button.disabled=Boolean(pending || busy || commandStorageError);
  for(const button of document.querySelectorAll('[data-project-brief], [data-project-work]'))button.disabled=!online || Boolean(pending || busy || commandStorageError);
  for(const button of document.querySelectorAll('[data-source-brief], [data-source-candidate], [data-source-list]'))button.disabled=!online || current?.capabilities?.sourceIntake!==true || Boolean(pending || busy || commandStorageError) || Boolean(button.dataset.sourceCandidate && !canPrepareSource((current?.sources||[]).find(source=>source.id===button.dataset.sourceCandidate)));
  if(pending) {
    $('command').value=pending.body.text || ({diagnostics:'진단해',evolution:'개선점 찾아줘'}[pending.body.type] || '이전 명령');
    $('command-type').value=pending.path==='/api/commands'?'command':(['document','ai'].includes(pending.body.type)?pending.body.type:'command');
    $('command-result').hidden=false;
    $('command-result').textContent=busy?'접수 확인 중 · 본체의 응답을 기다리고 있습니다.':'접수 확인 중 · 이전 요청의 응답이 확인되지 않았습니다.\n같은 요청 재시도를 누르면 보관한 명령을 다시 확인합니다. 새 명령은 접수 여부를 확인한 뒤 입력할 수 있습니다.';
  }
  if(commandStorageError) {
    $('command-result').hidden=false;
    $('command-result').textContent='보관된 명령을 확인할 수 없어 새 명령을 멈췄습니다. 브라우저의 저장 공간 접근을 확인해 주세요.';
  }
}
async function submitCommand(path,body) {
  if(!online){notify('먼저 실행 본체와 연결해 주세요.');return;}
  if(!commandRequests || commandRequests.sending)return;
  try {
    if(!commandRequests.pending)commandRequests.stage(path,body);
    const request=commandRequests.send();renderCommandRequest();
    const outcome=await request;
    if(outcome.kind==='accepted') {
      const r=outcome.result;$('command').value='';$('command-result').hidden=false;
      $('command-result').textContent=r.memory?'기억을 본체에 저장했습니다.':r.memories?`${r.memories.length}개의 기억을 찾았습니다.\n\n${r.memories.map(m=>m.text).join('\n\n')}`:r.projects?`${r.projects.length}개의 프로젝트를 확인했습니다.\n\n${r.projects.map(p=>`${p.name} · ${projectNames[p.status]||p.status}\n다음 작업: ${p.nextAction || '아직 정하지 않았습니다.'}`).join('\n\n')}`:'본체가 작업을 접수했습니다. 아래에서 실제 진행을 확인하세요.';
    } else if(outcome.kind==='rejected') {
      $('command-result').hidden=false;$('command-result').textContent=`본체가 명령을 거절했습니다. ${outcome.error.message}`;
      notify(outcome.error.message);
    } else notify('접수 여부를 확인하지 못했습니다. 같은 요청 재시도로 확인해 주세요.');
  } catch(error) {notify(`명령을 보내지 못했습니다. ${error.message}`);}
  finally {renderCommandRequest();await refresh(true);}
}
function connection(ok) {
  studioView.setState(current?{...current,online:ok}:{online:ok});
  online=ok;renderOtherRequest(); $('connection-dot').classList.toggle('online',ok);$('connection-text').textContent=ok?'실행 본체 연결됨':'연결 확인 필요';
  $('offline-banner').hidden=ok || !token; renderCommandRequest();renderProjectRequest();renderSourceRequest();renderQuestRequest(); $('global-stop').disabled=!ok;
  if(ok)$('last-seen').textContent=`마지막 확인 ${new Date().toLocaleTimeString('ko-KR')}`;
  if(!ok && token){$('core-title').textContent='연결을 확인하고 있어요.';$('core-subtitle').textContent='마지막 상태를 표시합니다. 새 명령은 확인 후 실행하세요.';$('core-signal').className='core-signal';}
}
async function refresh(force=false) {
  if(!token || loading)return;
  loading=true;
  try {const s=await api('/api/state'); const wasOnline=online;current=s;connection(true);void worldView.update(s.world, !s.emergencyStop && s.modules.documents && !commandRequests?.pending && !commandRequests?.sending);$('pair-screen').hidden=true;if(force || !wasOnline || lastRevision!==s.revision){render(s);lastRevision=s.revision;if(activeTab==='studio')void studioView.refresh();}if(!questData || activeTab==='quests')void refreshQuests(force);}
  catch(e){if(browserSession.active){connection(false);if(force)notify(e.message);}}
  finally{loading=false;}
}
function showTab(tab) {
  activeTab=tab;for(const el of document.querySelectorAll('.tab-panel'))el.hidden=el.id!==`tab-${tab}`;
  for(const el of document.querySelectorAll('.nav')){el.classList.toggle('active',el.dataset.tab===tab);el.setAttribute('aria-current',el.dataset.tab===tab?'page':'false');}
  $('page-title').textContent={control:'조종석',quests:'목표 실행',studio:'운영실',world:'세계 현황',projects:'프로젝트',sources:'자료',memory:'기억',recovery:'복구',settings:'능력·설정'}[tab];
  if(tab==='quests')void refreshQuests(true);
  if(tab==='studio')void studioView.refresh();
}
function render(s) {
  const jobs=s.jobs || [], running=jobs.filter(j=>j.status==='running').length;
  $('core-title').textContent=s.emergencyStop?'모든 작업을 멈췄어요.':running?`${running}개의 일을 진행하고 있어요.`:'명령을 기다리고 있어요.';
  $('core-subtitle').textContent=s.emergencyStop?'정지를 해제한 뒤 원하는 작업을 개별 재개하세요.':'운영실에서 영상 제작·소설 집필·장소 기록·한끼안부·For-Ai를 사용하세요.';
  $('core-signal').className=`core-signal ${s.emergencyStop?'stopped':running?'running':''}`;
  $('global-stop').textContent=s.emergencyStop?'전체 정지 해제':'모든 작업 멈춤';
  $('running-count').textContent=running;$('pending-count').textContent=jobs.filter(j=>['queued','paused'].includes(j.status)).length;$('done-count').textContent=jobs.filter(j=>j.status==='completed').length;$('slot-count').textContent=s.concurrency;
  $('ai-label').textContent=s.ai?.configured?'AI 설정됨 · 사용료 별도':'AI 미설정 · 기본 기능 사용';
  const aiOption=$('command-type').querySelector('option[value="ai"]');aiOption.disabled=!s.ai?.configured || !s.modules?.ai;aiOption.textContent=s.ai?.configured?'AI 작성':'AI 작성 · 연결 필요';
  $('jobs-count').textContent=`${jobs.length}개`;
  $('jobs-list').innerHTML=jobs.length?jobs.map(jobHTML).join(''):'<div class="empty">첫 작업을 맡겨보세요.<br>본체 진단은 입력 없이 바로 실행할 수 있어요.</div>';
  $('events-list').innerHTML=(s.events||[]).slice(0,12).map(e=>`<li><time>${esc(date(e.at || e.createdAt))}</time>${esc(e.text || e.message)}</li>`).join('') || '<li class="muted">아직 실행 기록이 없습니다.</li>';
  $('memory-count').textContent=(s.memories||[]).length;renderMemories();
  renderProjects();renderSources();renderQuests();
  $('snapshots-list').innerHTML=(s.snapshots||[]).map(sn=>`<article class="snapshot-item"><div><strong>${esc(sn.label)}</strong><small>${esc(date(sn.createdAt))}</small></div><button class="button subtle" data-restore="${esc(sn.id)}">이 시점으로</button></article>`).join('') || '<div class="empty">기억과 설정을 저장해 두면 이곳에서 돌아갈 수 있어요.</div>';
  $('concurrency').value=s.concurrency;
  $('module-settings').innerHTML=Object.entries(moduleInfo).map(([key,[name,desc]])=>`<div class="setting-row"><div><h3>${name}</h3><p>${desc}</p></div><input class="switch" type="checkbox" role="switch" aria-label="${name}" data-module="${key}" ${s.modules?.[key]?'checked':''} ${key==='ai'&&!s.ai?.configured?'disabled':''}></div>`).join('');
  $('runtime-info').textContent=`YENO ${s.version || '0.1.1'} · 상태 버전 ${s.revision} · ${s.ai?.configured?`AI 모델: ${s.ai.model}`:'외부 AI 미설정'}`;
}
function jobHTML(j) {
  const p=j.totalSteps?Math.min(100,Math.round((j.step||0)/j.totalSteps*100)):0;
  const canPause=['queued','running'].includes(j.status),canResume=j.status==='paused';
  const controls=[...(canPause?[['pause','멈춤']]:[]),...(canResume?[['resume','이어하기']]:[]),...(['queued','running','paused'].includes(j.status)?[['cancel','종료']]:[])].map(([action,label])=>`<button class="button subtle" data-job="${esc(j.id)}" data-action="${action}" data-version="${esc(j.version)}" ${action==='resume'&&current?.emergencyStop?'disabled':''}>${label}</button>`).join('');
  const project=(current?.projects||[]).find(project=>project.id===j.projectId);
  return `<article class="job"><div class="job-top"><h3 class="job-title">${esc(j.title || j.type)}</h3><span class="status ${esc(j.status)}">${esc(names[j.status]||j.status)}</span></div>${project?`<p class="job-project">프로젝트 · ${esc(project.name)}</p>`:''}<div class="job-meta"><span>${esc(date(j.createdAt))}</span><span>${j.step||0} / ${j.totalSteps||0} 단계</span></div><progress class="job-progress" aria-label="작업 진행" value="${p}" max="100"></progress>${j.error?`<p class="job-error">${esc(friendly(typeof j.error==='string'?j.error:j.error.message))}</p>`:''}<div class="job-actions">${controls}${(j.artifacts||[]).map(a=>`<button class="button subtle" data-artifact="${esc(a.id)}" data-name="${esc(a.name)}">결과 열기 ↗</button>`).join('')}</div></article>`;
}
function resetQuests() {
  questEpoch+=1;questData=null;questLoadedRevision=null;questError='';questLoading=false;
  questProjectOptions='';questProviderOptions='';questDriveOptions='';questReviewProviders.clear();questOutcomeId=null;$('quest-outcome-dialog').close();
}
async function refreshQuests(force=false) {
  if(!token || !online || questLoading || (!force && questLoadedRevision===current?.revision))return;
  const epoch=questEpoch, revision=current?.revision, requestToken=token;
  questLoading=true;renderQuestRequest();
  try {
    const result=await api('/api/quests');
    if(epoch!==questEpoch || token!==requestToken)return;
    if(!Array.isArray(result?.quests) || !Array.isArray(result?.drives) || !Array.isArray(result?.providers))throw new Error('목표 목록의 응답을 읽을 수 없습니다.');
    questData=result;questError='';questLoadedRevision=revision;
  } catch(error) {
    if(epoch!==questEpoch || token!==requestToken)return;
    questError=error.status===404?'연결한 본체에 목표 실행 업데이트가 아직 반영되지 않았습니다.':error.message;
    if(error.status===404)questLoadedRevision=revision;
  } finally {
    if(epoch===questEpoch&&browserSession.active){questLoading=false;renderQuests();}
  }
}
function questProviders() {return Array.isArray(questData?.providers)?questData.providers:[];}
function questProviderId(quest,job) {return job?.agent?.provider || quest.actualProvider || (quest.provider==='auto'?questData?.selectedProvider:quest.provider);}
function questCanExecute(provider) {
  const chosen=provider==='auto'?questData?.selectedProvider:provider;
  return online && !current?.emergencyStop && questProviders().some(p=>p.provider===chosen && p.configured);
}
function renderQuestRequest() {
  const pending=questRequests?.pending,busy=questRequests?.sending,locked=Boolean(pending || busy || questStorageError),available=Boolean(questData);
  for(const field of document.querySelectorAll('#quest-form input, #quest-form textarea, #quest-form select'))field.disabled=locked || !online || !available;
  $('save-quest').disabled=!online || !available || locked;
  $('save-quest').textContent=busy && pending?.path==='/api/quests'?'접수 확인 중…':'목표 저장 ↗';
  $('refresh-quests').disabled=!online || questLoading;
  for(const button of document.querySelectorAll('[data-quest-run], [data-quest-action], [data-quest-review], [data-quest-outcome]'))button.disabled=!online || locked || button.dataset.executionBlocked==='true';
  for(const select of document.querySelectorAll('[data-quest-review-provider]'))select.disabled=!online || locked;
  for(const field of document.querySelectorAll('#quest-outcome-form input, #quest-outcome-form textarea, #quest-outcome-form select'))field.disabled=locked;
  $('save-quest-outcome').disabled=!online || locked;
  $('quest-request-status').hidden=!pending && !questStorageError;
  $('retry-quest').hidden=!pending;$('retry-quest').disabled=!online || Boolean(busy || questStorageError);
  if(questStorageError)$('quest-request-message').textContent='보관한 목표 요청을 읽을 수 없어 새 요청을 멈췄습니다. 이 브라우저 탭의 저장 공간 접근을 확인해 주세요.';
  else if(pending)$('quest-request-message').textContent=busy?'본체의 접수 응답을 확인하고 있습니다.':`이전 ${pending.path==='/api/quests'?'목표 저장':pending.path==='/api/outcomes'?'성과 기록':pending.path.endsWith('/run')?'실행':pending.path.endsWith('/review')?'교차 검토':'작업 제어'}의 응답을 확인하지 못했습니다. ‘같은 요청 확인’으로 원래 요청의 접수 여부를 확인하세요.`;
}
function renderQuestForm() {
  const drives=questData?.drives?.length?questData.drives:fallbackDrives;
  if(!drives.some(drive=>drive.id===questDrive))questDrive=drives[0]?.id||'greed';
  const driveHTML=drives.map(drive=>`<label class="quest-drive"><input type="radio" name="quest-drive" value="${esc(drive.id)}"><span>${esc(drive.label||drive.name||drive.id)}</span></label>`).join('');
  if(questDriveOptions!==driveHTML){$('quest-drives').innerHTML=driveHTML;questDriveOptions=driveHTML;}
  for(const input of $('quest-drives').querySelectorAll('input'))input.checked=input.value===questDrive;
  const drive=drives.find(drive=>drive.id===questDrive);
  $('quest-drive-description').textContent=drive?.description||drive?.goal||'';
  const projectHTML='<option value="">공통 목표</option>'+(current?.projects||[]).filter(project=>project.status!=='archived').map(project=>`<option value="${esc(project.id)}">${esc(project.name)}</option>`).join('');
  if(questProjectOptions!==projectHTML){const selected=$('quest-project').value;$('quest-project').innerHTML=projectHTML;questProjectOptions=projectHTML;if([...$('quest-project').options].some(option=>option.value===selected))$('quest-project').value=selected;}
  const primary=questData?.selectedProvider;
  const providerHTML=`<option value="auto">현재 기본${primary?` · ${esc(providerNames[primary]||primary)}`:''}</option>`+Object.entries(providerNames).map(([id,label])=>`<option value="${id}">${esc(label)}${questProviders().some(p=>p.provider===id && p.configured)?' · 설정됨':' · 연결 필요'}</option>`).join('');
  if(questProviderOptions!==providerHTML){const selected=$('quest-provider').value;$('quest-provider').innerHTML=providerHTML;questProviderOptions=providerHTML;$('quest-provider').value=selected||'auto';}
}
function renderQuestProviders() {
  const usage=questData?.usage||current?.agent?.usage,limit=questData?.dailyCallLimit??current?.agent?.dailyCallLimit;
  $('quest-budget').textContent=usage && Number.isFinite(limit)?`오늘 모델 호출 시도 ${usage.attempts||0} / ${limit}회 · 응답 미확인 ${usage.unknown||0}회`:'모델 호출 기록은 본체 연결 후 표시됩니다.';
  $('quest-provider-status').innerHTML=Object.entries(providerNames).map(([id,label])=>{
    const provider=questProviders().find(p=>p.provider===id),confirmed=Boolean(provider?.lastSuccessfulAt),configured=provider?.configured===true;
    const missing=(provider?.missing||[]).map(reason=>({api_key:'API 키',apiKey:'API 키',key:'API 키',model:'모델 이름',daily_call_limit:'호출 상한',dailyCallLimit:'호출 상한'}[reason]||'연결 설정'));
    return `<div class="quest-provider-row"><div><strong>${esc(label)}</strong><small>${esc(provider?.model||'모델 연결 대기')}</small></div><span class="quest-provider-state ${configured?(confirmed?'verified':'configured'):''}">${configured?(confirmed?'응답 확인':'설정됨'):'연결 필요'}</span>${confirmed?`<p>마지막 성공 ${esc(date(provider.lastSuccessfulAt))}${Number.isInteger(provider.successfulCalls)?` · ${provider.successfulCalls}회`:''}</p>`:configured?'<p>실제 모델 응답은 아직 확인되지 않았습니다.</p>':missing.length?`<p>${esc([...new Set(missing)].join(' · '))} 필요</p>`:''}</div>`;
  }).join('');
}
function questHTML(quest) {
  const job=(current?.jobs||[]).find(job=>job.id===quest.jobId),status=job?.status||quest.status||'planned';
  const statusLabel={planned:'저장됨',proposed:'저장됨',assigned:'배정됨',draft:'저장됨',ready:'저장됨',missing_job:'작업 확인 필요',...names,completed:'결과 생성 완료'}[status]||status;
  const drive=(questData?.drives||fallbackDrives).find(drive=>drive.id===(quest.driveId||quest.drive));
  const project=(current?.projects||[]).find(project=>project.id===quest.projectId),provider=questProviderId(quest,job),providerLabel=providerNames[provider]||'현재 기본 제공자';
  const artifacts=job?.artifacts||quest.artifacts||[],usage=quest.executionUsage||{},active=['queued','running','paused'].includes(status);
  const controls=[];
  if(!quest.jobId)controls.push(`<button class="button primary" data-quest-run="${esc(quest.id)}" data-execution-blocked="${!questCanExecute(quest.provider||'auto')}">실행 ↗</button>`);
  if(job && active){
    if(status!=='paused')controls.push(`<button class="button subtle" data-quest-action="pause" data-quest-job="${esc(job.id)}" data-version="${esc(job.version)}">멈춤</button>`);
    if(status==='paused')controls.push(`<button class="button subtle" data-quest-action="resume" data-quest-job="${esc(job.id)}" data-version="${esc(job.version)}" data-execution-blocked="${!questCanExecute(provider) || (usage.unknown??job.agent?.unknownCalls??0)>0}">이어하기</button>`);
    controls.push(`<button class="button subtle" data-quest-action="cancel" data-quest-job="${esc(job.id)}" data-version="${esc(job.version)}">종료</button>`);
  }
  for(const item of artifacts)controls.push(`<button class="button ${status==='completed'?'primary':'subtle'}" data-artifact="${esc(item.id)}" data-name="${esc(item.name)}">결과 열기 ↗</button>`);
  if(status==='completed' && quest.artifacts?.length && !quest.outcomeUnknown)controls.push(`<button class="button subtle" data-quest-outcome="${esc(quest.id)}">성과 기록</button>`);
  const reviewProviders=questProviders().filter(item=>item.configured && item.provider!==provider),reviewSelection=questReviewProviders.get(quest.id);
  const review= status==='completed' && !quest.reviewOf && artifacts.length ? reviewProviders.length?`<div class="quest-review"><label for="quest-review-${esc(quest.id)}">다른 모델로 결과 검토<select id="quest-review-${esc(quest.id)}" data-quest-review-provider="${esc(quest.id)}">${reviewProviders.map(item=>`<option value="${esc(item.provider)}" ${reviewSelection===item.provider?'selected':''}>${esc(providerNames[item.provider]||item.provider)}</option>`).join('')}</select></label><button class="button subtle" data-quest-review="${esc(quest.id)}" data-execution-blocked="${!questCanExecute(reviewSelection||reviewProviders[0].provider)}">교차 검토 · 최대 2회</button><small>원본 결과를 읽는 별도 목표로 저장됩니다. 검토에도 모델 호출이 발생합니다.</small></div>`:'<p class="muted quest-review-note">두 번째 제공자를 연결하면 이 결과를 다른 모델로 교차 검토할 수 있습니다.</p>':'';
  const error=job?.error||quest.error;
  const pendingNote=!quest.jobId?current?.emergencyStop?'전체 멈춤을 해제하면 실행할 수 있습니다.':!questCanExecute(quest.provider||'auto')?'선택한 제공자의 API 연결이 필요합니다. 목표는 저장되어 있습니다.':'저장된 기준과 호출 한도 안에서 이 목표만 실행합니다.':'';
  return `<article class="quest-card" id="quest-card-${esc(quest.id)}"><div class="quest-card-top"><div class="quest-card-label"><span>${esc(drive?.label||drive?.name||quest.driveId||quest.drive)}</span><small>${esc(project?.name||'공통 목표')}${quest.reviewOf?' · 교차 검토':''}</small></div><span class="status ${esc(status)}">${esc(status==='completed'?'결과 생성 완료':statusLabel)}</span></div><h3>${esc(quest.goal)}</h3><div class="quest-success"><small>완료 기준</small><p>${esc(quest.successCriterion)}</p></div><details class="quest-contract"><summary>현재 상태와 실행 조건</summary><p>${esc(quest.baseline)}</p><dl><div><dt>제공자</dt><dd>${esc(providerLabel)}</dd></div><div><dt>최대 호출</dt><dd>${esc(quest.maxCalls)}회</dd></div><div><dt>시간 상한</dt><dd>${esc(quest.durationMinutes)}분</dd></div><div><dt>저장 시각</dt><dd>${esc(date(quest.createdAt))}</dd></div></dl><small class="quest-id">목표 ${esc(quest.id)}</small></details>${quest.jobId?`<div class="quest-usage"><span>모델 호출 <strong>${esc(usage.attempts??job?.agent?.calls??0)} / ${esc(quest.maxCalls)}</strong></span><span>응답 미확인 <strong>${esc(usage.unknown??job?.agent?.unknownCalls??0)}</strong></span>${Number.isFinite(usage.inputTokens)&&Number.isFinite(usage.outputTokens)?`<span>입력 / 출력 토큰 <strong>${esc(usage.inputTokens)} / ${esc(usage.outputTokens)}</strong></span>`:''}<small>사용량이 누락된 응답 ${esc(usage.usageMissing||0)}회 · 실제 비용: 청구 내역 확인 필요</small></div>`:''}${error?`<p class="job-error">${esc(friendly(typeof error==='string'?error:error.message))}</p>`:''}${pendingNote?`<p class="muted quest-pending-note">${esc(pendingNote)}</p>`:''}<div class="quest-actions">${controls.join('')}</div>${status==='completed'?'<p class="muted quest-result-note">결과 파일이 생성되었습니다. 완료 기준 충족 여부와 실제 성과는 내용을 확인해 판단하세요.</p>':''}${review}</article>`;
}
function renderQuests() {
  renderQuestForm();renderQuestProviders();
  $('quest-ledgers').innerHTML=Object.entries({wealth:'부',honor:'명예',fame:'인지도'}).map(([key,label])=>{const ledger=questData?.ledgers?.[key];return `<article class="quest-ledger"><div><h3>${label}</h3><span>${esc(ledger?.selfReported||0)}건 <small>사용자 보고</small></span></div>${ledger?.records?.length?`<ol>${ledger.records.slice(-5).reverse().map(record=>`<li><p>${esc(record.summary)}</p><small>${record.value!==null&&record.value!==undefined?`${esc(record.value)} ${esc(record.unit)} · `:''}${esc(date(record.createdAt))}</small></li>`).join('')}</ol>`:'<p class="muted">아직 기록한 실제 성과가 없습니다.</p>'}</article>`;}).join('');
  const available=Boolean(questData);
  $('quest-availability').hidden=available && !current?.emergencyStop;
  $('quest-availability').textContent=available?'전체 멈춤 상태입니다. 상단에서 정지를 해제한 뒤 원하는 작업을 개별 실행하거나 재개하세요.':questError||'본체에 연결하면 목표 실행 기능을 확인합니다.';
  $('quest-list-error').textContent=available && questError?`목표의 최신 상태를 확인하지 못했습니다. ${questError}`:'';
  const all=questData?.quests||[],filter=$('quest-filter').value;
  const quests=all.filter(quest=>{const status=(current?.jobs||[]).find(job=>job.id===quest.jobId)?.status||quest.status;return filter==='all'||filter==='active'&&!['completed','failed','cancelled'].includes(status)||filter==='completed'&&status==='completed'||filter==='attention'&&['failed','cancelled'].includes(status);});
  $('quest-count').textContent=`${all.length}개`;
  const html=quests.map(questHTML).join('')||`<div class="empty">${!available?'본체 연결 후 저장된 목표를 확인합니다.':filter!=='all'?'이 상태의 목표가 없습니다.':'첫 목표를 저장하면 실행과 결과를 여기서 이어갈 수 있습니다.'}</div>`;
  if(questRenderedHTML!==html){
    const expanded=[...$('quests-list').querySelectorAll('.quest-card details[open]')].map(details=>details.closest('.quest-card').id);
    const focused=document.activeElement,focusId=$('quests-list').contains(focused)?focused.id:null;
    $('quests-list').innerHTML=html;questRenderedHTML=html;
    for(const id of expanded){const details=document.getElementById(id)?.querySelector('details');if(details)details.open=true;}
    if(focusId)document.getElementById(focusId)?.focus({preventScroll:true});
  }
  renderQuestRequest();
}
async function submitQuest(path,body) {
  if(!online){notify('먼저 실행 본체와 연결해 주세요.');return;}
  if(!questRequests || questRequests.sending)return;
  try {
    if(!questRequests.pending)questRequests.stage(path,body);
    const request=questRequests.send();renderQuestRequest();$('quest-form-error').textContent='';
    const outcome=await request;
    if(outcome.kind==='accepted') {
      const saved=outcome.request.path==='/api/quests';
      if(questData && outcome.result.quest){const found=questData.quests.findIndex(quest=>quest.id===outcome.result.quest.id);if(found===-1)questData.quests.unshift(outcome.result.quest);else questData.quests[found]=outcome.result.quest;}
      if(current && outcome.result.job){const found=current.jobs.findIndex(job=>job.id===outcome.result.job.id);if(found===-1)current.jobs.unshift(outcome.result.job);else current.jobs[found]=outcome.result.job;}
      renderQuests();
      if(saved){$('quest-form').reset();questDrive='greed';notify('목표를 저장했습니다. 아래 목표에서 실행을 눌러 시작하세요.');}
      else if(outcome.request.path==='/api/outcomes'){$('quest-outcome-dialog').close();questOutcomeId=null;notify('성과를 사용자 보고로 저장했습니다.');}
      else notify(outcome.request.path.endsWith('/review')?'교차 검토를 별도 목표로 접수했습니다.':outcome.request.path.endsWith('/run')?'본체가 실행을 접수했습니다. 작업과 결과를 계속 보관합니다.':'본체가 작업 제어를 확인했습니다.');
      questLoadedRevision=null;
      await refresh(true);await refreshQuests(true);
      if(saved || outcome.request.path.endsWith('/review'))document.getElementById(`quest-card-${outcome.result.quest.id}`)?.scrollIntoView({block:'center',behavior:'smooth'});
    } else if(outcome.kind==='rejected') {$('quest-form-error').textContent=outcome.error.message;$('quest-outcome-error').textContent=outcome.error.message;notify(outcome.error.message);await refresh(true);}
    else {$('quest-outcome-dialog').close();notify('접수 여부를 확인하지 못했습니다. 같은 요청 확인으로 이어가세요.');}
  } catch(error) {$('quest-form-error').textContent=error.message;$('quest-outcome-error').textContent=error.message;notify(`목표 요청을 보내지 못했습니다. ${error.message}`);}
  finally {renderQuestRequest();}
}
function openQuestOutcome(id) {
  if(!online || questRequests?.pending || questRequests?.sending || questStorageError)return;
  const quest=questData?.quests.find(quest=>quest.id===id);
  if(!quest?.artifacts?.length || quest.outcomeUnknown)return;
  questOutcomeId=id;$('quest-outcome-form').reset();$('quest-outcome-error').textContent='';$('quest-outcome-goal').textContent=quest.goal;
  $('quest-outcome-artifact').innerHTML=quest.artifacts.map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
  renderQuestRequest();$('quest-outcome-dialog').showModal();$('quest-outcome-summary').focus();
}
function repositoryLink(value) {
  try {
    const url=new URL(value);
    if(url.protocol!=='https:' || url.hostname!=='github.com' || url.port || url.username || url.password || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname))return '';
    return `<a class="text-button project-repository" href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">GitHub 저장소 ↗</a>`;
  } catch {return '';}
}
function renderProjects() {
  const all=current?.projects||[], available=current?.capabilities?.projectManagement===true;
  const query=$('project-search').value.trim().toLocaleLowerCase(), filter=$('project-filter').value;
  const projects=all.filter(p=>(filter==='archived'?p.status==='archived':p.status!=='archived') && (!query || `${p.name} ${p.summary}`.toLocaleLowerCase().includes(query)));
  $('project-count').textContent=projects.length;
  $('project-worker-status').textContent=available?(current.capabilities.developerWorker===false?'개발 작업자 미연결':'프로젝트 문서 준비'):'프로젝트 기능 연결 필요';
  $('project-worker-detail').textContent=available?(current.capabilities.developerWorker===false?'프로젝트 정보로 브리핑과 작업 준비 문서를 만들 수 있습니다. 저장소의 코드를 바꾸거나 배포하는 개발 작업자는 아직 연결하지 않았습니다.':'이 화면에서는 프로젝트 정보로 브리핑과 작업 준비 문서를 만듭니다. 개발 작업자의 실제 연결·실행 상태는 별도 확인이 필요합니다.'):'현재 본체가 프로젝트 관리 기능을 제공하는지 확인해 주세요.';
  $('projects-list').innerHTML=projects.map(project=>`<article class="project-card"><div class="job-top"><h3>${esc(project.name)}</h3><span class="status ${esc(project.status)}">${esc(projectNames[project.status]||project.status)}</span></div><p class="project-summary">${esc(project.summary ? (project.summary.length>300?project.summary.slice(0,300)+'…':project.summary) : '목표와 현재 상황을 적어두면 다음에 이어가기 쉬워집니다.')}</p><div class="project-next"><small>다음 작업</small><p>${esc(project.nextAction||'아직 정하지 않았습니다.')}</p></div><div class="project-meta">${repositoryLink(project.repositoryUrl)}<small>수정 ${esc(date(project.updatedAt||project.createdAt))}</small></div><div class="project-actions"><button class="button subtle" data-project-brief="${esc(project.id)}">브리핑 만들기</button><button class="button subtle" data-project-work="${esc(project.id)}">다음 작업 준비</button><button class="text-button" data-project-edit="${esc(project.id)}">내용 수정</button></div></article>`).join('') || `<div class="empty">${available?'진행하던 프로젝트를 추가해 주세요.\n목표와 다음 작업을 본체에 보관합니다.':'연결한 본체의 프로젝트를 확인할 수 없습니다.'}</div>`;
  renderProjectRequest();renderCommandRequest();
}
function renderProjectRequest() {
  const pending=projectRequests?.pending, busy=projectRequests?.sending, locked=Boolean(pending || projectStorageError), available=current?.capabilities?.projectManagement===true;
  $('add-project').disabled=!online || !available || locked;
  for(const button of document.querySelectorAll('[data-project-edit]'))button.disabled=!online || !available || locked;
  for(const field of document.querySelectorAll('#project-form input, #project-form textarea, #project-form select'))field.disabled=locked;
  $('save-project').disabled=!online || !available || locked;
  $('save-project').textContent=busy?'접수 확인 중…':'프로젝트 저장';
  $('project-request-status').hidden=!pending && !projectStorageError;
  $('retry-project').hidden=!pending;
  $('retry-project').disabled=!online || Boolean(busy || projectStorageError);
  $('reload-project').disabled=locked;
  if(projectStorageError)$('project-request-message').textContent='보관된 프로젝트 요청을 읽을 수 없어 저장을 멈췄습니다. 이 브라우저 탭의 저장 공간 접근을 확인해 주세요.';
  else if(pending)$('project-request-message').textContent=busy?'프로젝트 저장을 확인하고 있습니다.':'프로젝트 저장 응답을 확인하지 못했습니다. 같은 요청을 재시도하면 중복 저장 없이 접수 여부를 확인합니다.';
}
function openProject(project=null) {
  if(projectRequests?.pending || projectStorageError || !online)return;
  editingProject=project?{id:project.id,version:project.version}:null;
  $('project-form-title').textContent=project?'프로젝트 수정':'프로젝트 추가';
  $('project-name').value=project?.name||'';$('project-repository').value=project?.repositoryUrl||'';
  $('project-summary').value=project?.summary||'';$('project-next-action').value=project?.nextAction||'';
  $('project-status').value=project?.status||'active';$('project-form-error').textContent='';$('reload-project').hidden=true;
  if(!$('project-dialog').open)$('project-dialog').showModal();
  $('project-name').focus();
}
async function submitProject(path,body) {
  if(!online){notify('먼저 실행 본체와 연결해 주세요.');return;}
  if(!projectRequests || projectRequests.sending)return;
  try {
    if(!projectRequests.pending)projectRequests.stage(path,body);
    const request=projectRequests.send();renderProjectRequest();
    const outcome=await request;
    if(outcome.kind==='accepted') {
      $('project-dialog').close();editingProject=null;notify('프로젝트를 본체에 저장했습니다.');
    } else if(outcome.kind==='rejected') {
      const conflict=outcome.error.status===409 && outcome.error.project && editingProject;
      const message=conflict?'프로젝트가 다른 곳에서 변경되었습니다. 최신 내용을 불러온 뒤 다시 수정해 주세요.':outcome.error.message;
      $('project-form-error').textContent=message;$('reload-project').hidden=!conflict;notify(message);
    } else {
      $('project-dialog').close();notify('접수 여부를 확인하지 못했습니다. 프로젝트의 같은 요청 재시도로 확인해 주세요.');
    }
  } catch(error) {$('project-form-error').textContent=error.message;notify(`프로젝트를 보내지 못했습니다. ${error.message}`);}
  finally {renderProjectRequest();await refresh(true);}
}
function prepareProject(id,kind) {
  const project=(current?.projects||[]).find(project=>project.id===id);
  if(!project || commandRequests?.pending || commandRequests?.sending || commandStorageError)return;
  showTab('control');
  if(kind==='work' && !project.nextAction) {
    $('command-type').value='command';$('command').value=`프로젝트 작업: ${project.name} | `;$('command').focus();
    notify('준비할 작업을 명령 뒤에 적어주세요.');return;
  }
  void submitCommand('/api/commands',{text:kind==='brief'?`프로젝트 브리핑: ${project.id}`:`프로젝트 작업: ${project.id} | ${project.nextAction}`});
}
function sourceURL(value) {
  try {
    if(typeof value!=='string' || !/^https:\/\//i.test(value.trim()) || /[\u0000-\u0020\u007f\\]/.test(value.trim()))return null;
    const url=new URL(value.trim()), host=url.hostname.toLowerCase().replace(/\.$/,'');
    if(url.protocol!=='https:' || url.username || url.password || url.port || !host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host) || /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home)$/.test(host) || host.endsWith('.home.arpa') || !host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))return null;
    const parameters=[url.searchParams];
    if(url.hash.includes('='))parameters.push(new URLSearchParams(url.hash.slice(1).replace(/^.*\?/,'')));
    for(const params of parameters)for(let key of params.keys()) {
      for(let n=0;n<3;n++){try{const decoded=decodeURIComponent(key);if(decoded===key)break;key=decoded;}catch{break;}}
      key=key.toLowerCase().replace(/[^a-z0-9]/g,'');
      if(/token|password|passwd|signature|secret|credential|authorization|apikey/.test(key) || /^(key|code|auth|sig|pwd|accesskey|clientkey)$/.test(key))return null;
    }
    return url;
  } catch {return null;}
}
function canPrepareSource(source) {
  return source?.decision==='candidate' && source.readingStatus==='read' && ['summary','application','riskNotes'].every(key=>typeof source[key]==='string' && source[key].trim());
}
function renderSources() {
  const all=current?.sources||[], available=current?.capabilities?.sourceIntake===true;
  const query=$('source-search').value.trim().toLocaleLowerCase(), filter=$('source-filter').value, destination=$('source-destination-filter').value;
  const sources=all.filter(source=>(destination==='all'||sourceDestination(source,current.projects).kind===destination) && (filter==='all'||source.readingStatus===filter) && sourceMatches(source,query));
  const coverage=sourceCoverage(all,current?.projects||[]);
  $('source-count').textContent=all.length;
  $('source-capability-status').textContent=available?`전체 ${all.length}개 · 표시 ${sources.length}개 · 분류 대기 ${coverage.unclassifiedCount}개 · 연결/검토 확인 ${coverage.attentionCount}개`:'자료 기능 연결 필요';
  $('sources-list').innerHTML=sources.map(source=>{
    const route=sourceDestination(source,current.projects);
    const linkIssue=source.projectId && !(current.projects||[]).some(p=>p.id===source.projectId && p.status!=='archived');
    const url=sourceURL(source.url), project=(current?.projects||[]).find(project=>project.id===source.projectId);
    const reading=readingNames[source.readingStatus]||'범위 확인 필요', decision=decisionNames[source.decision]||'판단 확인 필요';
    return `<article class="source-card"><div class="job-top"><h3>${esc(source.title)}</h3><span class="status ${source.readingStatus==='read'?'completed':''}">${esc(reading)}</span></div>${sourceReferenceNames(source).length?`<p class="muted">원본 자료명 · ${esc(sourceReferenceNames(source).join(" · "))}</p>`:""}<p class="muted">${esc(({feature:"공통 기능",project:"기존 프로젝트",'project-review':"새 프로젝트 검토",unclassified:"분류 대기"})[route.kind])} · ${esc(route.name)} · ${esc(route.stage)}</p>${linkIssue?'<p class="source-unavailable">기존 프로젝트 연결을 확인해야 합니다. 원본 자료는 보존되어 있습니다.</p>':''}<div class="source-meta"><span class="source-decision">${esc(decision)}</span>${project?`<button class="text-button" data-source-project="${esc(project.id)}">${esc(project.name)} ↗</button>`:'<small>프로젝트 미연결</small>'}</div>${url?`<a class="text-button source-url" href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(source.url)} ↗</a>`:`<span class="muted source-url">${esc(source.url)}</span>`}${source.readingStatus==='unavailable'?'<p class="source-unavailable">원문에 접근하지 못했습니다. 내용 확인 전에는 개선 후보로 준비하지 않습니다.</p>':''}<div class="source-note"><small>확인한 내용과 범위</small><p>${esc(source.summary||'아직 확인한 내용이 기록되지 않았습니다.')}</p></div><details class="source-review"><summary>응용 방법과 확인 사항</summary><div class="source-note"><small>YENO에 응용할 방법</small><p>${esc(source.application||'아직 정하지 않았습니다.')}</p></div><div class="source-note"><small>권리·개인정보·이용조건</small><p>${esc(source.riskNotes||'확인 기록이 없습니다.')}</p></div><small class="source-id">자료 ID · ${esc(source.id)}</small></details><div class="project-meta"><small>수정 ${esc(date(source.updatedAt||source.createdAt))}</small></div><div class="project-actions"><button class="button subtle" data-source-brief="${esc(source.id)}">브리핑 만들기</button><button class="button subtle" data-source-candidate="${esc(source.id)}" ${canPrepareSource(source)?'':'disabled'}>후보 검토서 준비</button><button class="text-button" data-source-edit="${esc(source.id)}">내용 수정</button></div></article>`;
  }).join('') || `<div class="empty">${!available?'연결한 본체의 자료 기능을 확인할 수 없습니다.':query||filter!=='all'?'이 조건에 맞는 자료가 없습니다.':'참고할 자료를 추가해 주세요.\n출처와 검토 내용을 다음 작업에 이어갑니다.'}</div>`;
  renderSourceRequest();renderCommandRequest();
}
function renderSourceRequest() {
  const pending=sourceRequests?.pending, busy=sourceRequests?.sending, locked=Boolean(pending||sourceStorageError), available=current?.capabilities?.sourceIntake===true;
  for(const id of ['add-source','import-sources','save-source'])$(id).disabled=!online || !available || locked;
  for(const button of document.querySelectorAll('[data-source-edit]'))button.disabled=!online || !available || locked;
  for(const field of document.querySelectorAll('#source-form input, #source-form textarea, #source-form select'))field.disabled=locked;
  $('source-url').readOnly=Boolean(editingSource);
  $('source-import-file').disabled=locked;
  $('confirm-source-import').disabled=!online || !available || locked || !sourceImportPreview;
  $('save-source').textContent=busy?'접수 확인 중…':'자료 저장';
  $('source-request-status').hidden=!pending && !sourceStorageError;
  $('retry-source').hidden=!pending;$('retry-source').disabled=!online || Boolean(busy||sourceStorageError);
  $('reload-source').disabled=locked;
  if(sourceStorageError)$('source-request-message').textContent='보관한 자료 요청을 읽을 수 없어 자료 저장을 멈췄습니다. 이 브라우저 탭의 저장 공간 접근을 확인해 주세요.';
  else if(pending)$('source-request-message').textContent=busy?'자료 접수를 확인하고 있습니다.':'자료 저장 응답을 확인하지 못했습니다. 같은 요청을 재시도하면 원래 내용과 요청 ID로 접수 여부를 확인합니다.';
}
function openSource(source=null) {
  if(sourceRequests?.pending || sourceStorageError || !online)return;
  editingSource=source?{id:source.id,version:source.version}:null;
  $('source-form-title').textContent=source?'자료 검토 수정':'자료 추가';
  $('source-title').value=source?.title||'';$('source-url').value=source?.url||'';
  $('source-project').innerHTML='<option value="">연결하지 않음</option>'+(current?.projects||[]).map(project=>`<option value="${esc(project.id)}">${esc(project.name)}</option>`).join('');
  $('source-project').value=source?.projectId||'';
  $('source-reading-status').value=source?.readingStatus||'unread';$('source-decision').value=source?.decision||'pending';
  $('source-summary').value=source?.summary||'';$('source-application').value=source?.application||'';$('source-risk-notes').value=source?.riskNotes||'';
  $('source-form-error').textContent='';$('reload-source').hidden=true;renderSourceRequest();
  if(!$('source-dialog').open)$('source-dialog').showModal();
  $('source-title').focus();
}
async function submitSource(path,body) {
  if(!online){notify('먼저 실행 본체와 연결해 주세요.');return;}
  if(!sourceRequests || sourceRequests.sending)return;
  try {
    if(!sourceRequests.pending)sourceRequests.stage(path,body);
    const request=sourceRequests.send();renderSourceRequest();
    const outcome=await request;
    if(outcome.kind==='accepted') {
      const imported=outcome.request.path==='/api/sources/import';
      $('source-dialog').close();$('source-import-dialog').close();editingSource=null;
      if(imported){sourceImportPreview=null;notify(`자료 ${outcome.result.createdCount}개 추가 · 기존 ${outcome.result.reusedCount}개 재사용했습니다.`);}
      else notify('자료와 검토 내용을 본체에 저장했습니다.');
    } else if(outcome.kind==='rejected') {
      const conflict=outcome.error.status===409 && outcome.error.source && editingSource;
      const message=conflict?'자료가 다른 곳에서 변경되었습니다. 최신 내용을 불러온 뒤 다시 수정해 주세요.':outcome.error.message;
      $('source-form-error').textContent=message;$('source-import-error').textContent=message;$('reload-source').hidden=!conflict;notify(message);
    } else {
      $('source-dialog').close();$('source-import-dialog').close();notify('자료 접수 여부를 확인하지 못했습니다. 자료 메뉴에서 같은 요청 재시도로 확인해 주세요.');
    }
  } catch(error) {$('source-form-error').textContent=error.message;$('source-import-error').textContent=error.message;notify(`자료를 보내지 못했습니다. ${error.message}`);}
  finally {renderSourceRequest();await refresh(true);}
}
function prepareSource(id,kind) {
  const source=(current?.sources||[]).find(source=>source.id===id);
  if(!source || current?.capabilities?.sourceIntake!==true || commandRequests?.pending || commandRequests?.sending || commandStorageError)return;
  if(kind==='candidate' && !canPrepareSource(source)){notify('본문 확인과 세 검토 항목을 채운 개선 후보부터 준비할 수 있습니다.');return;}
  showTab('control');
  void submitCommand('/api/commands',{text:kind==='candidate'?`개선 후보: ${source.id}`:`자료 브리핑: ${source.id}`});
}
function validateSourceInput(source,index) {
  const prefix=index===undefined?'':`${index+1}번째 자료: `;
  const fail=message=>{throw new Error(prefix+message);};
  if(!source || typeof source!=='object' || Array.isArray(source))fail('자료 항목은 JSON 객체여야 합니다.');
  const fields={url:2048,title:160,summary:8000,application:8000,riskNotes:4000};
  const allowed=new Set([...Object.keys(fields),'projectId','readingStatus','decision']);
  if(Object.keys(source).some(key=>!allowed.has(key)))fail('지원하지 않는 필드가 있습니다. ID·버전 등 서버 관리 필드는 제외해 주세요.');
  for(const [key,max] of Object.entries(fields)) {
    if(source[key]!==undefined && (typeof source[key]!=='string'||source[key].length>max))fail(`${key}는 ${max}자 이하의 텍스트여야 합니다.`);
  }
  if(!source.title?.trim() || !source.url?.trim())fail('title과 url이 필요합니다.');
  if(/[\u0000-\u001f\u007f]/.test(source.title.trim()))fail('자료 제목에 줄바꿈이나 제어 문자를 넣을 수 없습니다.');
  if(!sourceURL(source.url))fail('공개 HTTPS 주소를 사용하고 주소에서 인증·비밀값을 제외해 주세요.');
  if(source.projectId!==undefined && source.projectId!==null && !(current?.projects||[]).some(project=>project.id===source.projectId))fail('연결할 프로젝트 ID를 현재 프로젝트 목록에서 확인해 주세요.');
  const reading=source.readingStatus===undefined?'unread':source.readingStatus, decision=source.decision===undefined?'pending':source.decision;
  if(!Object.hasOwn(readingNames,reading)||!Object.hasOwn(decisionNames,decision))fail('읽은 범위 또는 적용 판단 값이 올바르지 않습니다.');
  if(decision==='candidate' && !canPrepareSource({...source,readingStatus:reading,decision}))fail('개선 후보는 본문을 확인하고 summary·application·riskNotes를 모두 채워야 합니다.');
}
async function previewSourceFile() {
  const generation=++sourceFileGeneration, file=$('source-import-file').files?.[0];
  sourceImportPreview=null;$('source-import-error').textContent='';$('source-import-preview').hidden=true;renderSourceRequest();
  if(!file)return;
  try {
    if(file.size>240*1024)throw new Error('240 KiB를 넘는 파일입니다. 자료 목록을 나눠서 가져와 주세요.');
    const sources=JSON.parse(await file.text());
    if(generation!==sourceFileGeneration)return;
    if(!Array.isArray(sources)||sources.length<1||sources.length>100)throw new Error('1~100개 자료 객체로 구성된 JSON 배열이 필요합니다.');
    sources.forEach((source,index)=>validateSourceInput(source,index));
    if(new TextEncoder().encode(JSON.stringify({sources,requestId:'00000000-0000-0000-0000-000000000000'})).length>250*1024)throw new Error('등록 본문이 너무 큽니다. 목록을 더 작은 파일로 나눠 주세요.');
    sourceImportPreview=sources;
    const counts=Object.entries(readingNames).map(([key,label])=>`${label} ${sources.filter(source=>(source.readingStatus||'unread')===key).length}개`).join(' · ');
    $('source-import-preview').innerHTML=`<h3>${sources.length}개 등록 내용 확인</h3><p class="muted">${esc(counts)}</p><ol>${sources.map(source=>`<li><strong>${esc(source.title)}</strong><span>${esc(readingNames[source.readingStatus||'unread'])} · ${esc(decisionNames[source.decision||'pending'])}</span></li>`).join('')}</ol>`;
    $('source-import-preview').hidden=false;
  } catch(error) {if(generation===sourceFileGeneration)$('source-import-error').textContent=error instanceof SyntaxError?'JSON 형식을 읽을 수 없습니다. 자료 목록 파일을 확인해 주세요.':error.message;}
  finally {if(generation===sourceFileGeneration)renderSourceRequest();}
}
function renderMemories() {
  const q=$('memory-search').value.toLocaleLowerCase(),memories=(current?.memories||[]).filter(m=>m.text.toLocaleLowerCase().includes(q));
  $('memories-list').innerHTML=memories.map(m=>`<article class="memory-item"><small>${esc(date(m.createdAt))}</small><p>${esc(m.text)}</p></article>`).join('') || `<div class="empty">${q?'일치하는 기억이 없습니다.':'아직 저장한 기억이 없습니다.'}</div>`;
}
async function perform(fn,button) {
  if(!online){notify('먼저 실행 본체와 연결해 주세요.');return;}
  if(button?.disabled)return;if(button)button.disabled=true;
  try{await fn();await refresh(true);}catch(e){notify(e.name==='TimeoutError'?'응답을 확인하지 못했습니다. 작업 목록을 확인한 뒤 다시 시도하세요.':e.message);await refresh();}finally{if(button)button.disabled=false;}
}
$('command-form').addEventListener('submit',e=>{e.preventDefault();if(commandRequests?.pending){void submitCommand();return;}const text=$('command').value.trim(),type=$('command-type').value;if(!text)return;void submitCommand(type==='command'?'/api/commands':'/api/jobs',type==='command'?{text}:{type,text});});
$('quest-form').addEventListener('submit',e=>{
  e.preventDefault();
  if(questRequests?.pending){void submitQuest();return;}
  const body={goal:$('quest-goal').value.trim(),drive:questDrive,successCriterion:$('quest-success').value.trim(),baseline:$('quest-baseline').value.trim(),projectId:$('quest-project').value||null,provider:$('quest-provider').value,maxCalls:Number($('quest-max-calls').value),durationMinutes:Number($('quest-duration').value)};
  if(!body.goal || !body.successCriterion || !body.baseline){$('quest-form-error').textContent='목표, 완료 기준, 현재 상태를 입력해 주세요.';return;}
  if(!Number.isInteger(body.durationMinutes) || body.durationMinutes<1 || body.durationMinutes>120){$('quest-form-error').textContent='실행 시간은 1~120분 사이의 정수로 입력해 주세요.';return;}
  void submitQuest('/api/quests',body);
});
$('quest-drives').addEventListener('change',e=>{if(e.target.name==='quest-drive'){questDrive=e.target.value;renderQuestForm();renderQuestRequest();}});
$('quest-filter').addEventListener('change',renderQuests);
$('quest-outcome-form').addEventListener('submit',e=>{
  e.preventDefault();
  if(questRequests?.pending){void submitQuest();return;}
  if(!questOutcomeId)return;
  const summary=$('quest-outcome-summary').value.trim(),valueText=$('quest-outcome-value').value.trim(),unit=$('quest-outcome-unit').value.trim();
  if(!summary){$('quest-outcome-error').textContent='직접 확인한 성과와 근거를 입력해 주세요.';return;}
  if(valueText && (!Number.isFinite(Number(valueText)) || !unit)){$('quest-outcome-error').textContent='측정값과 단위를 함께 입력해 주세요.';return;}
  const body={questId:questOutcomeId,ledger:$('quest-outcome-ledger').value,summary,artifactId:$('quest-outcome-artifact').value,...(valueText?{value:Number(valueText)}:{}),...(unit?{unit}:{})};
  void submitQuest('/api/outcomes',body);
});
$('retry-quest').addEventListener('click',()=>void submitQuest());
$('refresh-quests').addEventListener('click',async()=>{await refresh(true);await refreshQuests(true);});
$('quests-list').addEventListener('change',e=>{if(e.target.dataset.questReviewProvider)questReviewProviders.set(e.target.dataset.questReviewProvider,e.target.value);});
$('project-search').addEventListener('input',renderProjects);
$('project-filter').addEventListener('change',renderProjects);
$('add-project').addEventListener('click',()=>openProject());
$('project-form').addEventListener('submit',e=>{
  e.preventDefault();
  if(projectRequests?.pending){void submitProject();return;}
  const body={name:$('project-name').value.trim(),repositoryUrl:$('project-repository').value.trim(),summary:$('project-summary').value.trim(),nextAction:$('project-next-action').value.trim(),status:$('project-status').value};
  void submitProject(editingProject?`/api/projects/${encodeURIComponent(editingProject.id)}/update`:'/api/projects',editingProject?{...body,revision:editingProject.version}:body);
});
$('retry-project').addEventListener('click',()=>void submitProject());
$('reload-project').addEventListener('click',async()=>{await refresh(true);const project=(current?.projects||[]).find(project=>project.id===editingProject?.id);if(project)openProject(project);});
$('add-source').addEventListener('click',()=>openSource());
$('source-form').addEventListener('submit',e=>{
  e.preventDefault();
  if(sourceRequests?.pending){void submitSource();return;}
  const input={title:$('source-title').value.trim(),url:$('source-url').value.trim(),projectId:$('source-project').value||null,readingStatus:$('source-reading-status').value,decision:$('source-decision').value,summary:$('source-summary').value.trim(),application:$('source-application').value.trim(),riskNotes:$('source-risk-notes').value.trim()};
  try {validateSourceInput(input);$('source-form-error').textContent='';}
  catch(error){$('source-form-error').textContent=error.message;return;}
  const {url,...review}=input;
  void submitSource(editingSource?`/api/sources/${encodeURIComponent(editingSource.id)}/update`:'/api/sources',editingSource?{...review,revision:editingSource.version}:input);
});
$('retry-source').addEventListener('click',()=>void submitSource());
$('reload-source').addEventListener('click',async()=>{
  const id=editingSource?.id;await refresh(true);
  const source=(current?.sources||[]).find(source=>source.id===id);
  if(source)openSource(source);
  else if(online)$('source-form-error').textContent='자료를 찾을 수 없습니다. 창을 닫고 목록을 확인해 주세요.';
});
$('source-search').addEventListener('input',renderSources);
$('source-filter').addEventListener('change',renderSources);
$('source-destination-filter').addEventListener('change',renderSources);
$('absorption-plan').addEventListener('click',()=>submitCommand('/api/commands',{text:'흡수 계획'}));
$('import-sources').addEventListener('click',()=>{
  if(!online || current?.capabilities?.sourceIntake!==true || sourceRequests?.pending || sourceStorageError)return;
  sourceFileGeneration+=1;sourceImportPreview=null;$('source-import-form').reset();$('source-import-preview').hidden=true;$('source-import-error').textContent='';renderSourceRequest();
  $('source-import-dialog').showModal();
});
$('source-import-file').addEventListener('change',()=>void previewSourceFile());
$('source-import-form').addEventListener('submit',e=>{
  e.preventDefault();
  if(sourceRequests?.pending){void submitSource();return;}
  if(!sourceImportPreview)return;
  try {sourceImportPreview.forEach((source,index)=>validateSourceInput(source,index));}
  catch(error){$('source-import-error').textContent=error.message;return;}
  void submitSource('/api/sources/import',{sources:sourceImportPreview});
});
$('memory-form').addEventListener('submit',e=>{e.preventDefault();perform(async()=>{await durableMutation('/api/memory',{text:$('memory-text').value.trim()});$('memory-text').value='';notify('기억을 저장했습니다.');},e.submitter);});
$('snapshot-form').addEventListener('submit',e=>{e.preventDefault();perform(async()=>{await durableMutation('/api/snapshots',{label:$('snapshot-label').value.trim()});$('snapshot-label').value='';notify('돌아갈 지점을 저장했습니다.');},e.submitter);});
$('memory-search').addEventListener('input',renderMemories);
$('global-stop').addEventListener('click',e=>perform(async()=>{const action=current.emergencyStop?'resume':'stop';if(action==='stop')await api('/api/control',{action,requestId:requestId()});else await durableMutation('/api/control',{action,revision:current.revision});notify(action==='stop'?'본체가 전체 멈춤을 확인했습니다.':'정지를 해제했습니다. 필요한 작업을 개별 재개하세요.');},e.currentTarget));
$('concurrency').addEventListener('change',e=>perform(()=>durableMutation('/api/settings',{concurrency:Number(e.target.value)})));
$('module-settings').addEventListener('change',e=>{if(e.target.dataset.module)perform(()=>durableMutation('/api/settings',{modules:{[e.target.dataset.module]:e.target.checked}}));});
$('compact-toggle').addEventListener('click',()=>{const compact=document.body.classList.toggle('compact');$('compact-toggle').textContent=compact?'펼치기':'작게';$('compact-toggle').setAttribute('aria-pressed',String(compact));});
function clearConnection(){authEpoch++;browserSession.invalidate();worldView.reset();studioView.reset();resetQuests();token='';current=null;if(artifact?.url)URL.revokeObjectURL(artifact.url);artifact=null;$('artifact-video').pause();$('artifact-video').removeAttribute('src');$('artifact-content').textContent='';document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());document.querySelector('.shell').hidden=true;$('pair-screen').hidden=false;}
async function disconnect(){
  if(commandRequests?.sending||projectRequests?.sending||sourceRequests?.sending||questRequests?.sending||otherRequests?.sending||studioView.sending){notify('접수 응답을 기다리고 있습니다. 잠시 후 연결을 해제하세요.');return;}
  try{await browserSession.logout();clearConnection();location.reload();}catch(error){notify(`연결 해제를 확인하지 못했습니다. ${error.message}`);}
}
$('disconnect').addEventListener('click',disconnect);$('disconnect-mobile').addEventListener('click',disconnect);
$('reconnect').addEventListener('click',()=>refresh(true));
document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.tab)showTab(b.dataset.tab);
  if(b.dataset.close)$(b.dataset.close).close();
  if(b.dataset.example && !b.disabled){$('command').value=b.dataset.example;$('command-type').value='command';$('command').focus();}
  if(b.dataset.quick && !b.disabled)void submitCommand('/api/jobs',{type:b.dataset.quick});
  if(b.dataset.questRun && !b.disabled)void submitQuest(`/api/quests/${encodeURIComponent(b.dataset.questRun)}/run`,{});
  if(b.dataset.questAction && !b.disabled)void submitQuest(`/api/jobs/${encodeURIComponent(b.dataset.questJob)}/action`,{action:b.dataset.questAction,revision:Number(b.dataset.version)});
  if(b.dataset.questReview && !b.disabled){const provider=document.getElementById(`quest-review-${b.dataset.questReview}`)?.value;if(provider)void submitQuest(`/api/quests/${encodeURIComponent(b.dataset.questReview)}/review`,{provider,maxCalls:2});}
  if(b.dataset.questOutcome && !b.disabled)openQuestOutcome(b.dataset.questOutcome);
  if(b.dataset.projectEdit && !b.disabled)openProject((current?.projects||[]).find(project=>project.id===b.dataset.projectEdit));
  if(b.dataset.projectBrief && !b.disabled)prepareProject(b.dataset.projectBrief,'brief');
  if(b.dataset.projectWork && !b.disabled)prepareProject(b.dataset.projectWork,'work');
  if(b.dataset.sourceEdit && !b.disabled)openSource((current?.sources||[]).find(source=>source.id===b.dataset.sourceEdit));
  if(b.dataset.sourceBrief && !b.disabled)prepareSource(b.dataset.sourceBrief,'brief');
  if(b.dataset.sourceCandidate && !b.disabled)prepareSource(b.dataset.sourceCandidate,'candidate');
  if(b.hasAttribute('data-source-list') && !b.disabled){showTab('control');void submitCommand('/api/commands',{text:'자료 목록'});}
  if(b.dataset.sourceProject && !b.disabled){showTab('projects');const card=[...document.querySelectorAll('[data-project-edit]')].find(button=>button.dataset.projectEdit===b.dataset.sourceProject)?.closest('article');card?.scrollIntoView({block:'center'});}
  if(b.dataset.job)perform(()=>durableMutation(`/api/jobs/${encodeURIComponent(b.dataset.job)}/action`,{action:b.dataset.action,...(b.dataset.version&&b.dataset.version!=='undefined'?{revision:Number(b.dataset.version)}:{})}),b);
  if(b.dataset.restore){selectedSnapshot=b.dataset.restore;$('restore-label').textContent=current.snapshots.find(s=>s.id===selectedSnapshot)?.label||'';$('restore-dialog').showModal();}
  if(b.dataset.artifact)perform(async()=>{const epoch=authEpoch;const r=await api(`/api/artifacts/${encodeURIComponent(b.dataset.artifact)}`,undefined,{raw:true});const blob=await r.blob();const text=blob.type.startsWith('video/mp4')?'':await blob.text();if(epoch!==authEpoch||!token)return;if(artifact?.url)URL.revokeObjectURL(artifact.url);artifact={blob,name:b.dataset.name||'BLACKHOLE-result.md',url:URL.createObjectURL(blob)};const video=blob.type.startsWith('video/mp4');$('artifact-title').textContent=artifact.name;$('artifact-video').hidden=!video;$('artifact-content').hidden=video;if(video){$('artifact-video').src=artifact.url;$('artifact-content').textContent='';}else{$('artifact-video').removeAttribute('src');$('artifact-content').textContent=text;}$('artifact-dialog').showModal();},b);
});
$('confirm-restore').addEventListener('click',e=>perform(async()=>{await durableMutation(`/api/snapshots/${encodeURIComponent(selectedSnapshot)}/restore`,{confirm:true});$('restore-dialog').close();notify('기억과 설정을 복원했습니다. 이전 상태도 보관했습니다.');},e.currentTarget));
$('download-artifact').addEventListener('click',()=>{if(!artifact)return;const a=document.createElement('a');a.href=artifact.url;a.download=artifact.name;a.click();});
$('artifact-dialog').addEventListener('close',()=>{$('artifact-video').pause();$('artifact-video').removeAttribute('src');if(artifact?.url)URL.revokeObjectURL(artifact.url);artifact=null;});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});
window.addEventListener('online',()=>refresh(true));window.addEventListener('offline',()=>connection(false));
showTab(questRequests?.pending?'quests':sourceRequests?.pending?'sources':projectRequests?.pending?'projects':commandRequests?.pending?'control':'studio');renderCommandRequest();renderProjectRequest();renderSourceRequest();renderQuests();if(token)refresh(true);setInterval(()=>{if(!document.hidden)refresh();},1500);
})().catch(error=>{const result=document.getElementById('pair-error');if(result){document.getElementById('pair-screen').hidden=false;result.textContent=`운영실을 시작하지 못했습니다. ${error.message}`;}});
