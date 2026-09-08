(async () => {
const {createCommandRequest} = await import('/command-request.mjs');
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = (value) => value ? new Date(value).toLocaleString('ko-KR', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
let token = sessionStorage.getItem('yeno-token') || '';
let current = null, online = false, loading = false, lastRevision = null, selectedSnapshot = null, artifact = null;
let toastTimer, activeTab = 'control', commandRequests, commandStorageError;
const names = {queued:'대기',running:'실행 중',paused:'멈춤',completed:'완료',failed:'실패',cancelled:'종료'};
const moduleInfo = {memory:['기억','내용을 저장하고 다시 찾습니다.'],documents:['문서','제공한 내용을 실제 문서 파일로 만듭니다.'],diagnostics:['진단·개선 제안','본체 상태와 실행 이력에서 개선 후보를 찾습니다.'],ai:['AI 작성','본체에 설정한 외부 AI로 작성합니다. 사용료가 발생할 수 있습니다.']};
function notify(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,4500); }
function friendly(message) {
  const pairs=[['Unauthorized','연결 키를 확인해 주세요.'],['Invalid pairing token','연결 키가 올바르지 않습니다.'],['Pairing token required','연결 키를 입력해 주세요.'],['Emergency stop is active','전체 멈춤 상태입니다. 먼저 정지를 해제해 주세요.'],['AI provider is not configured','본체에 AI 연결을 먼저 설정해 주세요.'],['Job changed; refresh before retrying','작업 상태가 바뀌었습니다. 최신 상태를 확인한 뒤 다시 눌러주세요.'],['Terminal jobs cannot be changed','이미 끝난 작업입니다.'],['Pause or stop all active jobs before restoring','작업을 먼저 모두 멈춘 뒤 복원해 주세요.'],['Module disabled','해당 능력이 꺼져 있습니다. 능력·설정에서 켜주세요.']];
  if(String(message).includes('module is disabled'))return '해당 능력이 꺼져 있습니다. 능력·설정에서 켜주세요.';
  for(const [a,b] of pairs)if(String(message).includes(a))return b;
  return String(message || '요청을 처리하지 못했습니다.');
}
async function api(path, data, options={}) {
  const response=await fetch(path,{method:data===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(options.timeout || 12000),cache:'no-store'});
  if(options.raw && response.ok)return response;
  let result;
  try {result=await response.json();} catch(error) {if(response.ok)throw new Error('본체의 접수 응답을 읽지 못했습니다.');result={};}
  if(!response.ok){if(response.status===401){token='';sessionStorage.removeItem('yeno-token');$('pair-screen').hidden=false;}const error=new Error(friendly(result.error?.message || result.error || result.message || `응답 ${response.status}`));error.status=response.status;throw error;}
  return result;
}
const requestId=()=>crypto.randomUUID();
try {commandRequests=createCommandRequest({storage:sessionStorage,transport:(path,body)=>api(path,body)});}
catch(error) {commandStorageError=error;}
function renderCommandRequest() {
  const pending=commandRequests?.pending, busy=commandRequests?.sending;
  $('command').readOnly=Boolean(pending || commandStorageError);
  $('command-type').disabled=Boolean(pending || commandStorageError);
  $('send-command').disabled=!online || Boolean(busy || commandStorageError);
  $('send-command').textContent=busy?'접수 확인 중…':pending?'같은 요청 재시도':'실행 ↗';
  for(const button of document.querySelectorAll('[data-example], [data-quick]'))button.disabled=Boolean(pending || busy || commandStorageError);
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
      $('command-result').textContent=r.memory?'기억을 본체에 저장했습니다.':r.memories?`${r.memories.length}개의 기억을 찾았습니다.\n\n${r.memories.map(m=>m.text).join('\n\n')}`:'본체가 작업을 접수했습니다. 아래에서 실제 진행을 확인하세요.';
    } else if(outcome.kind==='rejected') {
      $('command-result').hidden=false;$('command-result').textContent=`본체가 명령을 거절했습니다. ${outcome.error.message}`;
      notify(outcome.error.message);
    } else notify('접수 여부를 확인하지 못했습니다. 같은 요청 재시도로 확인해 주세요.');
  } catch(error) {notify(`명령을 보내지 못했습니다. ${error.message}`);}
  finally {renderCommandRequest();await refresh(true);}
}
function connection(ok) {
  online=ok; $('connection-dot').classList.toggle('online',ok);$('connection-text').textContent=ok?'실행 본체 연결됨':'연결 확인 필요';
  $('offline-banner').hidden=ok || !token; renderCommandRequest(); $('global-stop').disabled=!ok;
  if(ok)$('last-seen').textContent=`마지막 확인 ${new Date().toLocaleTimeString('ko-KR')}`;
  if(!ok && token){$('core-title').textContent='연결을 확인하고 있어요.';$('core-subtitle').textContent='마지막 상태를 표시합니다. 새 명령은 확인 후 실행하세요.';$('core-signal').className='core-signal';}
}
async function refresh(force=false) {
  if(!token || loading)return;
  loading=true;
  try {const s=await api('/api/state'); const wasOnline=online;current=s;connection(true);$('pair-screen').hidden=true;if(force || !wasOnline || lastRevision!==s.revision){render(s);lastRevision=s.revision;}}
  catch(e){connection(false);if(force)notify(e.message);}
  finally{loading=false;}
}
function showTab(tab) {
  activeTab=tab;for(const el of document.querySelectorAll('.tab-panel'))el.hidden=el.id!==`tab-${tab}`;
  for(const el of document.querySelectorAll('.nav')){el.classList.toggle('active',el.dataset.tab===tab);el.setAttribute('aria-current',el.dataset.tab===tab?'page':'false');}
  $('page-title').textContent={control:'조종석',memory:'기억',recovery:'복구',settings:'능력·설정'}[tab];
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
  $('snapshots-list').innerHTML=(s.snapshots||[]).map(sn=>`<article class="snapshot-item"><div><strong>${esc(sn.label)}</strong><small>${esc(date(sn.createdAt))}</small></div><button class="button subtle" data-restore="${esc(sn.id)}">이 시점으로</button></article>`).join('') || '<div class="empty">기억과 설정을 저장해 두면 이곳에서 돌아갈 수 있어요.</div>';
  $('concurrency').value=s.concurrency;
  $('module-settings').innerHTML=Object.entries(moduleInfo).map(([key,[name,desc]])=>`<div class="setting-row"><div><h3>${name}</h3><p>${desc}</p></div><input class="switch" type="checkbox" role="switch" aria-label="${name}" data-module="${key}" ${s.modules?.[key]?'checked':''} ${key==='ai'&&!s.ai?.configured?'disabled':''}></div>`).join('');
  $('runtime-info').textContent=`YENO ${s.version || '0.1.1'} · 상태 버전 ${s.revision} · ${s.ai?.configured?`AI 모델: ${s.ai.model}`:'외부 AI 미설정'}`;
}
function jobHTML(j) {
  const p=j.totalSteps?Math.min(100,Math.round((j.step||0)/j.totalSteps*100)):0;
  const canPause=['queued','running'].includes(j.status),canResume=j.status==='paused';
  const controls=[...(canPause?[['pause','멈춤']]:[]),...(canResume?[['resume','이어하기']]:[]),...(['queued','running','paused'].includes(j.status)?[['cancel','종료']]:[])].map(([action,label])=>`<button class="button subtle" data-job="${esc(j.id)}" data-action="${action}" data-version="${esc(j.version)}" ${action==='resume'&&current?.emergencyStop?'disabled':''}>${label}</button>`).join('');
  return `<article class="job"><div class="job-top"><h3 class="job-title">${esc(j.title || j.type)}</h3><span class="status ${esc(j.status)}">${esc(names[j.status]||j.status)}</span></div><div class="job-meta"><span>${esc(date(j.createdAt))}</span><span>${j.step||0} / ${j.totalSteps||0} 단계</span></div><progress class="job-progress" aria-label="작업 진행" value="${p}" max="100"></progress>${j.error?`<p class="job-error">${esc(friendly(typeof j.error==='string'?j.error:j.error.message))}</p>`:''}<div class="job-actions">${controls}${(j.artifacts||[]).map(a=>`<button class="button subtle" data-artifact="${esc(a.id)}" data-name="${esc(a.name)}">결과 열기 ↗</button>`).join('')}</div></article>`;
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
$('memory-form').addEventListener('submit',e=>{e.preventDefault();perform(async()=>{await api('/api/memory',{text:$('memory-text').value.trim(),requestId:requestId()});$('memory-text').value='';notify('기억을 저장했습니다.');},e.submitter);});
$('snapshot-form').addEventListener('submit',e=>{e.preventDefault();perform(async()=>{await api('/api/snapshots',{label:$('snapshot-label').value.trim(),requestId:requestId()});$('snapshot-label').value='';notify('돌아갈 지점을 저장했습니다.');},e.submitter);});
$('memory-search').addEventListener('input',renderMemories);
$('global-stop').addEventListener('click',e=>perform(async()=>{const action=current.emergencyStop?'resume':'stop';await api('/api/control',{action,...(action==='resume'?{revision:current.revision}:{}),requestId:requestId()});notify(action==='stop'?'본체가 전체 멈춤을 확인했습니다.':'정지를 해제했습니다. 필요한 작업을 개별 재개하세요.');},e.currentTarget));
$('concurrency').addEventListener('change',e=>perform(()=>api('/api/settings',{concurrency:Number(e.target.value),requestId:requestId()})));
$('module-settings').addEventListener('change',e=>{if(e.target.dataset.module)perform(()=>api('/api/settings',{modules:{[e.target.dataset.module]:e.target.checked},requestId:requestId()}));});
$('compact-toggle').addEventListener('click',()=>{const compact=document.body.classList.toggle('compact');$('compact-toggle').textContent=compact?'펼치기':'작게';$('compact-toggle').setAttribute('aria-pressed',String(compact));});
function disconnect(){token='';current=null;sessionStorage.removeItem('yeno-token');connection(false);$('pair-screen').hidden=false;}
$('disconnect').addEventListener('click',disconnect);$('disconnect-mobile').addEventListener('click',disconnect);
$('reconnect').addEventListener('click',()=>refresh(true));
document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.tab)showTab(b.dataset.tab);
  if(b.dataset.close)$(b.dataset.close).close();
  if(b.dataset.example && !b.disabled){$('command').value=b.dataset.example;$('command-type').value='command';$('command').focus();}
  if(b.dataset.quick && !b.disabled)void submitCommand('/api/jobs',{type:b.dataset.quick});
  if(b.dataset.job)perform(()=>api(`/api/jobs/${encodeURIComponent(b.dataset.job)}/action`,{action:b.dataset.action,...(b.dataset.version&&b.dataset.version!=='undefined'?{revision:Number(b.dataset.version)}:{}),requestId:requestId()}),b);
  if(b.dataset.restore){selectedSnapshot=b.dataset.restore;$('restore-label').textContent=current.snapshots.find(s=>s.id===selectedSnapshot)?.label||'';$('restore-dialog').showModal();}
  if(b.dataset.artifact)perform(async()=>{const r=await api(`/api/artifacts/${encodeURIComponent(b.dataset.artifact)}`,undefined,{raw:true});const text=await r.text();artifact={text,name:b.dataset.name||'YENO-result.md'};$('artifact-title').textContent=artifact.name;$('artifact-content').textContent=text;$('artifact-dialog').showModal();},b);
});
$('confirm-restore').addEventListener('click',e=>perform(async()=>{await api(`/api/snapshots/${encodeURIComponent(selectedSnapshot)}/restore`,{confirm:true,requestId:requestId()});$('restore-dialog').close();notify('기억과 설정을 복원했습니다. 이전 상태도 보관했습니다.');},e.currentTarget));
$('download-artifact').addEventListener('click',()=>{if(!artifact)return;const url=URL.createObjectURL(new Blob([artifact.text],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=artifact.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});
window.addEventListener('online',()=>refresh(true));window.addEventListener('offline',()=>connection(false));
showTab('control');renderCommandRequest();if(token)refresh(true);setInterval(()=>{if(!document.hidden)refresh();},1500);
})().catch(error=>{const result=document.getElementById('command-result');if(result){result.hidden=false;result.textContent=`조종석을 시작하지 못했습니다. 새로고침해 주세요. ${error.message}`;}});
