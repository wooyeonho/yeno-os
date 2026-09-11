(async () => {
const {createCommandRequest} = await import('/command-request.mjs');
const {sourceMatches,sourceReferenceNames} = await import('/source-reference-labels.mjs');
const {sourceDestination,sourceCoverage} = await import('/absorption-routing.mjs');
const {createWorldView} = await import('/world-view.mjs');
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = (value) => value ? new Date(value).toLocaleString('ko-KR', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
let token = sessionStorage.getItem('yeno-token') || '';
let current = null, online = false, loading = false, lastRevision = null, selectedSnapshot = null, artifact = null;
let toastTimer, activeTab = 'control', commandRequests, commandStorageError, projectRequests, projectStorageError, editingProject = null;
let sourceRequests, sourceStorageError, editingSource = null, sourceImportPreview = null, sourceFileGeneration = 0;
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
  const response=await fetch(path,{method:data===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(options.timeout || 12000),cache:'no-store'});
  if(options.raw && response.ok)return response;
  let result;
  try {result=await response.json();} catch(error) {if(response.ok)throw new Error('본체의 접수 응답을 읽지 못했습니다.');result={};}
  if(!response.ok){if(response.status===401){worldView.reset();token='';sessionStorage.removeItem('yeno-token');$('pair-screen').hidden=false;$('project-dialog').close();$('source-dialog').close();$('source-import-dialog').close();connection(false);}const error=new Error(friendly(result.error?.message || result.error || result.message || `응답 ${response.status}`));error.status=response.status;error.project=result.project;error.source=result.source;throw error;}
  return result;
}
const worldView=createWorldView({load:()=>api('/api/world'),submit:()=>submitCommand('/api/commands',{text:'세계 현황'})});
const requestId=()=>crypto.randomUUID();
try {commandRequests=createCommandRequest({storage:sessionStorage,transport:(path,body)=>api(path,body)});}
catch(error) {commandStorageError=error;}
try {
  projectRequests=createCommandRequest({storage:sessionStorage,key:'yeno-pending-project-v1',
    allowPath:path=>path==='/api/projects' || /^\/api\/projects\/[a-zA-Z0-9-]+\/update$/.test(path),
    transport:async(path,body)=>{
      const result=await api(path,body);
      if(!result?.project?.id || !Number.isInteger(result.project.version))throw new Error('프로젝트의 접수 응답을 확인하지 못했습니다.');
      return result;
    }});
} catch(error) {projectStorageError=error;}
try {
  sourceRequests=createCommandRequest({storage:sessionStorage,key:'yeno-pending-source-v1',
    allowPath:path=>path==='/api/sources' || path==='/api/sources/import' || /^\/api\/sources\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/update$/i.test(path),
    transport:async(path,body)=>{
      const result=await api(path,body);
      const valid=source=>typeof source?.id==='string' && Number.isInteger(source.version);
      if(path==='/api/sources/import' ? !Array.isArray(result?.sources) || result.sources.length!==body.sources.length || !result.sources.every(valid) || !Number.isInteger(result.createdCount) || !Number.isInteger(result.reusedCount) || result.createdCount+result.reusedCount!==body.sources.length : !valid(result?.source))throw new Error('자료의 접수 응답을 확인하지 못했습니다.');
      return result;
    }});
} catch(error) {sourceStorageError=error;}
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
  online=ok; $('connection-dot').classList.toggle('online',ok);$('connection-text').textContent=ok?'실행 본체 연결됨':'연결 확인 필요';
  $('offline-banner').hidden=ok || !token; renderCommandRequest();renderProjectRequest();renderSourceRequest(); $('global-stop').disabled=!ok;
  if(ok)$('last-seen').textContent=`마지막 확인 ${new Date().toLocaleTimeString('ko-KR')}`;
  if(!ok && token){$('core-title').textContent='연결을 확인하고 있어요.';$('core-subtitle').textContent='마지막 상태를 표시합니다. 새 명령은 확인 후 실행하세요.';$('core-signal').className='core-signal';}
}
async function refresh(force=false) {
  if(!token || loading)return;
  loading=true;
  try {const s=await api('/api/state'); const wasOnline=online;current=s;connection(true);void worldView.update(s.world, !s.emergencyStop && s.modules.documents && !commandRequests?.pending && !commandRequests?.sending);$('pair-screen').hidden=true;if(force || !wasOnline || lastRevision!==s.revision){render(s);lastRevision=s.revision;}}
  catch(e){connection(false);if(force)notify(e.message);}
  finally{loading=false;}
}
function showTab(tab) {
  activeTab=tab;for(const el of document.querySelectorAll('.tab-panel'))el.hidden=el.id!==`tab-${tab}`;
  for(const el of document.querySelectorAll('.nav')){el.classList.toggle('active',el.dataset.tab===tab);el.setAttribute('aria-current',el.dataset.tab===tab?'page':'false');}
  $('page-title').textContent={control:'조종석',world:'세계 현황',projects:'프로젝트',sources:'자료',memory:'기억',recovery:'복구',settings:'능력·설정'}[tab];
}
function render(s) {
  const jobs=s.jobs || [], running=jobs.filter(j=>j.status==='running').length;
  $('core-title').textContent=s.emergencyStop?'모든 작업을 멈췄어요.':running?`${running}개의 일을 진행하고 있어요.`:'명령을 기다리고 있어요.';
  $('core-subtitle').textContent=s.emergencyStop?'정지를 해제한 뒤 원하는 작업을 개별 재개하세요.':'기억·문서·진단부터 바로 맡길 수 있어요.';
  $('core-signal').className=`core-signal ${s.emergencyStop?'stopped':running?'running':''}`;
  $('global-stop').textContent=s.emergencyStop?'전체 정지 해제':'모든 작업 멈춤';
  $('running-count').textContent=running;$('pending-count').textContent=jobs.filter(j=>['queued','paused'].includes(j.status)).length;$('done-count').textContent=jobs.filter(j=>j.status==='completed').length;$('slot-count').textContent=s.concurrency;
  $('ai-label').textContent=s.ai?.configured?'AI 설정됨 · 사용료 별도':'AI 미설정 · 기본 기능 사용';
  const aiOption=$('command-type').querySelector('option[value="ai"]');aiOption.disabled=!s.ai?.configured || !s.modules?.ai;aiOption.textContent=s.ai?.configured?'AI 작성':'AI 작성 · 연결 필요';
  $('jobs-count').textContent=`${jobs.length}개`;
  $('jobs-list').innerHTML=jobs.length?jobs.map(jobHTML).join(''):'<div class="empty">첫 작업을 맡겨보세요.<br>본체 진단은 입력 없이 바로 실행할 수 있어요.</div>';
  $('events-list').innerHTML=(s.events||[]).slice(0,12).map(e=>`<li><time>${esc(date(e.at || e.createdAt))}</time>${esc(e.text || e.message)}</li>`).join('') || '<li class="muted">아직 실행 기록이 없습니다.</li>';
  $('memory-count').textContent=(s.memories||[]).length;renderMemories();
  renderProjects();renderSources();
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
$('pair-form').addEventListener('submit',async(e)=>{e.preventDefault();const b=e.submitter;b.disabled=true;$('pair-error').textContent='';token=$('pair-token').value.trim();try{current=await api('/api/state');sessionStorage.setItem('yeno-token',token);$('pair-token').value='';$('pair-screen').hidden=true;connection(true);render(current);lastRevision=current.revision;}catch(err){token='';$('pair-error').textContent=err.message || '연결할 수 없습니다.';}finally{b.disabled=false;}});
$('command-form').addEventListener('submit',e=>{e.preventDefault();if(commandRequests?.pending){void submitCommand();return;}const text=$('command').value.trim(),type=$('command-type').value;if(!text)return;void submitCommand(type==='command'?'/api/commands':'/api/jobs',type==='command'?{text}:{type,text});});
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
$('memory-form').addEventListener('submit',e=>{e.preventDefault();perform(async()=>{await api('/api/memory',{text:$('memory-text').value.trim(),requestId:requestId()});$('memory-text').value='';notify('기억을 저장했습니다.');},e.submitter);});
$('snapshot-form').addEventListener('submit',e=>{e.preventDefault();perform(async()=>{await api('/api/snapshots',{label:$('snapshot-label').value.trim(),requestId:requestId()});$('snapshot-label').value='';notify('돌아갈 지점을 저장했습니다.');},e.submitter);});
$('memory-search').addEventListener('input',renderMemories);
$('global-stop').addEventListener('click',e=>perform(async()=>{const action=current.emergencyStop?'resume':'stop';await api('/api/control',{action,...(action==='resume'?{revision:current.revision}:{}),requestId:requestId()});notify(action==='stop'?'본체가 전체 멈춤을 확인했습니다.':'정지를 해제했습니다. 필요한 작업을 개별 재개하세요.');},e.currentTarget));
$('concurrency').addEventListener('change',e=>perform(()=>api('/api/settings',{concurrency:Number(e.target.value),requestId:requestId()})));
$('module-settings').addEventListener('change',e=>{if(e.target.dataset.module)perform(()=>api('/api/settings',{modules:{[e.target.dataset.module]:e.target.checked},requestId:requestId()}));});
$('compact-toggle').addEventListener('click',()=>{const compact=document.body.classList.toggle('compact');$('compact-toggle').textContent=compact?'펼치기':'작게';$('compact-toggle').setAttribute('aria-pressed',String(compact));});
function disconnect(){worldView.reset();token='';current=null;sessionStorage.removeItem('yeno-token');connection(false);$('pair-screen').hidden=false;}
$('disconnect').addEventListener('click',disconnect);$('disconnect-mobile').addEventListener('click',disconnect);
$('reconnect').addEventListener('click',()=>refresh(true));
document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.tab)showTab(b.dataset.tab);
  if(b.dataset.close)$(b.dataset.close).close();
  if(b.dataset.example && !b.disabled){$('command').value=b.dataset.example;$('command-type').value='command';$('command').focus();}
  if(b.dataset.quick && !b.disabled)void submitCommand('/api/jobs',{type:b.dataset.quick});
  if(b.dataset.projectEdit && !b.disabled)openProject((current?.projects||[]).find(project=>project.id===b.dataset.projectEdit));
  if(b.dataset.projectBrief && !b.disabled)prepareProject(b.dataset.projectBrief,'brief');
  if(b.dataset.projectWork && !b.disabled)prepareProject(b.dataset.projectWork,'work');
  if(b.dataset.sourceEdit && !b.disabled)openSource((current?.sources||[]).find(source=>source.id===b.dataset.sourceEdit));
  if(b.dataset.sourceBrief && !b.disabled)prepareSource(b.dataset.sourceBrief,'brief');
  if(b.dataset.sourceCandidate && !b.disabled)prepareSource(b.dataset.sourceCandidate,'candidate');
  if(b.hasAttribute('data-source-list') && !b.disabled){showTab('control');void submitCommand('/api/commands',{text:'자료 목록'});}
  if(b.dataset.sourceProject && !b.disabled){showTab('projects');const card=[...document.querySelectorAll('[data-project-edit]')].find(button=>button.dataset.projectEdit===b.dataset.sourceProject)?.closest('article');card?.scrollIntoView({block:'center'});}
  if(b.dataset.job)perform(()=>api(`/api/jobs/${encodeURIComponent(b.dataset.job)}/action`,{action:b.dataset.action,...(b.dataset.version&&b.dataset.version!=='undefined'?{revision:Number(b.dataset.version)}:{}),requestId:requestId()}),b);
  if(b.dataset.restore){selectedSnapshot=b.dataset.restore;$('restore-label').textContent=current.snapshots.find(s=>s.id===selectedSnapshot)?.label||'';$('restore-dialog').showModal();}
  if(b.dataset.artifact)perform(async()=>{const r=await api(`/api/artifacts/${encodeURIComponent(b.dataset.artifact)}`,undefined,{raw:true});const text=await r.text();artifact={text,name:b.dataset.name||'YENO-result.md'};$('artifact-title').textContent=artifact.name;$('artifact-content').textContent=text;$('artifact-dialog').showModal();},b);
});
$('confirm-restore').addEventListener('click',e=>perform(async()=>{await api(`/api/snapshots/${encodeURIComponent(selectedSnapshot)}/restore`,{confirm:true,requestId:requestId()});$('restore-dialog').close();notify('기억과 설정을 복원했습니다. 이전 상태도 보관했습니다.');},e.currentTarget));
$('download-artifact').addEventListener('click',()=>{if(!artifact)return;const url=URL.createObjectURL(new Blob([artifact.text],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=artifact.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});
window.addEventListener('online',()=>refresh(true));window.addEventListener('offline',()=>connection(false));
showTab(sourceRequests?.pending?'sources':projectRequests?.pending?'projects':'control');renderCommandRequest();renderProjectRequest();renderSourceRequest();if(token)refresh(true);setInterval(()=>{if(!document.hidden)refresh();},1500);
})().catch(error=>{const result=document.getElementById('command-result');if(result){result.hidden=false;result.textContent=`조종석을 시작하지 못했습니다. 새로고침해 주세요. ${error.message}`;}});
