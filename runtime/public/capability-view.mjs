const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createCapabilityView({root,onAction,onOpenJob=()=>{},notify=()=>{}}){
 let state={online:false,capabilities:[],jobs:[]},busy=false,epoch=0,destroyed=false,signature='';
 root.innerHTML=`<section class="cockpit-kirby" aria-label="능력 흡수와 재사용"><div class="cockpit-section-heading"><div><span class="eyebrow">KIRBY · 능력 획득</span><h3>시험을 통과한 능력</h3></div></div><p>새 기능을 가져와 시험하고, 활성화한 버전으로 실제 결과를 만듭니다.</p><div data-cap-list></div><details class="cockpit-details"><summary>새 기능 가져오기</summary><p class="cockpit-fine">BLACKHOLE 기능 JSON 파일을 선택하세요. 가져오기는 실행이나 활성화가 아닙니다.</p><input data-cap-file type="file" accept=".json,application/json" aria-label="기능 파일"><textarea data-cap-manifest aria-label="기능 JSON" placeholder="기능 파일 내용" rows="5"></textarea><button type="button" class="button" data-cap-action="import">가져오기</button></details><div data-cap-run hidden><h4 data-cap-run-title></h4><p class="cockpit-fine">아래 예시는 시험용 입력입니다. 실제 처리할 내용으로 바꾼 뒤 실행하세요.</p><textarea data-cap-input aria-label="기능 실행 입력" rows="7"></textarea><button type="button" class="button primary" data-cap-action="run">결과 만들기</button></div><p data-cap-message role="status" aria-live="polite"></p><p class="cockpit-fine">현재 지원: 데이터 선택·정렬·표 작성의 조합. 외부 프로그램 설치·무인 코드 수정은 별도 구현이 필요합니다.</p></section>`;
 const list=root.querySelector('[data-cap-list]'),message=root.querySelector('[data-cap-message]'),input=root.querySelector('[data-cap-input]'),run=root.querySelector('[data-cap-run]'),manifest=root.querySelector('[data-cap-manifest]');
 let selectedId=null;
 const allowed=()=>!destroyed&&state.online===true&&typeof onAction==='function';
 function render(){
  const sig=JSON.stringify(state.capabilities??[]);
  if(sig!==signature){signature=sig;list.innerHTML=(state.capabilities??[]).map(cap=>`<article class="cockpit-cap-card"><div><strong>${esc(cap.name)}</strong><span class="status ${cap.activeHash?'completed':''}">${cap.activeHash?'활성':'대기'}</span></div><p>${esc(cap.description)}</p><small>${cap.source?.kind==='native'?'BLACKHOLE 작성':esc(cap.source?.author)} · 사용 이력 ${Number(cap.runCount)||0}회</small><div class="studio-actions"><button type="button" class="button subtle" data-cap-action="prepare" data-id="${esc(cap.id)}">입력·실행</button><button type="button" class="button subtle" data-cap-action="disable" data-id="${esc(cap.id)}">끄기</button>${cap.previousHash?`<button type="button" class="button subtle" data-cap-action="rollback" data-id="${esc(cap.id)}">이전 버전 복원</button>`:''}</div><details><summary>원본·시험·버전 ${cap.versions.length}개</summary>${cap.versions.map(v=>`<div class="cockpit-version"><small>${esc(v.version)} · ${v.verified?'시험 통과':'미시험'}<br><code>${esc(v.hash)}</code></small><div class="studio-actions"><button type="button" class="button subtle" data-cap-action="verify" data-id="${esc(cap.id)}" data-hash="${esc(v.hash)}">시험</button><button type="button" class="button subtle" data-cap-action="activate" data-id="${esc(cap.id)}" data-hash="${esc(v.hash)}">활성화</button></div></div>`).join('')}</details></article>`).join('')||'<p>아직 가져온 기능이 없습니다.</p>';}
  for(const button of root.querySelectorAll('[data-cap-action]'))button.disabled=!allowed()||busy||(state.emergencyStop&&button.dataset.capAction!=='disable');
 }
 const handler=async event=>{
  const button=event.target.closest?.('[data-cap-action]');if(!button||button.disabled||!root.contains(button)||!allowed()||busy)return;
  const action=button.dataset.capAction,id=button.dataset.id;
  if(action==='prepare'){const cap=state.capabilities.find(x=>x.id===id);if(!cap)return;selectedId=id;input.value=JSON.stringify(cap.sampleInput,null,2);root.querySelector('[data-cap-run-title]').textContent=cap.name;run.hidden=false;input.focus();return;}
  let payload;
  try{payload=action==='import'?{manifest:JSON.parse(manifest.value)}:action==='run'?{id:selectedId,input:JSON.parse(input.value)}:{id,...(button.dataset.hash?{hash:button.dataset.hash}:{})};if(action==='run'&&!selectedId)throw new Error('사용할 기능을 먼저 선택하세요.');}catch(error){message.textContent=error.message;return;}
  const generation=epoch;busy=true;message.textContent='본체에서 확인하고 있습니다…';render();
  try{const result=await onAction(action,payload);if(generation!==epoch||destroyed)return;message.textContent=result.jobId?'작업을 접수했습니다. 아래 실행 기록에서 결과를 확인하세요.':({import:'가져왔습니다. 시험 후 활성화하세요.',verify:'시험을 통과했습니다.',activate:'이 버전을 활성화했습니다.',disable:'기능을 껐습니다.',rollback:'이전 버전으로 복원했습니다.'}[action]||'처리를 확인했습니다.');if(result.jobId)onOpenJob(result.jobId);}
  catch(error){if(generation===epoch&&!destroyed){message.textContent=error.message||'응답을 확인하지 못했습니다. 상단의 같은 요청 확인을 사용하세요.';notify(message.textContent);}}
  finally{if(generation===epoch&&!destroyed){busy=false;render();}}
 };
 root.addEventListener('click',handler);
 root.querySelector('[data-cap-file]').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;if(file.size>65536){message.textContent='파일은64KB 이하로 줄여 주세요.';return;}const generation=epoch;try{const value=await file.text();if(generation===epoch&&!destroyed)manifest.value=value;}catch{message.textContent='파일을 읽지 못했습니다.';}});
 render();
 return {updateState(next){if(destroyed)return;state=next;render();},reset(){epoch++;busy=false;selectedId=null;input.value='';manifest.value='';run.hidden=true;message.textContent='';state={online:false,capabilities:[],jobs:[]};render();},destroy(){epoch++;destroyed=true;root.removeEventListener('click',handler);root.innerHTML='';}};
}
