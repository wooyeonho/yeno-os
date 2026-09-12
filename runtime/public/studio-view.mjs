import {createCommandRequest} from './command-request.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const tabs = [['forai','For-Ai'],['places','여기'],['checkins','한끼안부'],['novels','소설'],['video','영상'],['capabilities','흡수한 능력']];
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ko-KR', {timeZoneName:'short'}) : '기록 없음';
const active = item => !item.archived && !item.archivedAt && item.status !== 'archived';
const actionButton = (action, label, id = '', extra = '') => `<button type="button" class="button subtle" data-studio-action="${esc(action)}" data-id="${esc(id)}" ${extra}>${esc(label)}</button>`;
const field = (name, label, value = '', options = {}) => `<label class="${options.wide?'studio-wide':''}">${esc(label)}${options.textarea?`<textarea name="${esc(name)}" rows="${options.rows||3}" ${options.required?'required':''} maxlength="${options.maxlength||6000}" ${options.placeholder?`placeholder="${esc(options.placeholder)}"`:''}>${esc(value)}</textarea>`:`<input name="${esc(name)}" type="${options.type||'text'}" value="${esc(value)}" ${options.required?'required':''} ${options.min!==undefined?`min="${esc(options.min)}"`:''} ${options.max!==undefined?`max="${esc(options.max)}"`:''} ${options.step?`step="${esc(options.step)}"`:''} maxlength="${options.maxlength||2000}" ${options.placeholder?`placeholder="${esc(options.placeholder)}"`:''}>`}</label>`;
const selectField = (name, label, entries, selected = '') => `<label>${esc(label)}<select name="${esc(name)}">${entries.map(([value, text])=>`<option value="${esc(value)}" ${String(value)===String(selected)?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
const empty = text => `<div class="studio-empty">${esc(text)}</div>`;
const safeUrl = value => {try {const url = new URL(value); return ['https:','http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;} catch {return null;}};
const link = (url, text) => {const href=safeUrl(url); return href?`<a class="text-button" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)} ↗</a>`:'';};
const localTime = (value = Date.now()+60*60*1000) => {const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60_000).toISOString().slice(0,16);};
const formLimits={place:{title:160,address:1000,note:12000,url:2000},contact:{name:160,relationship:160,contactInfo:500,consentNote:2000},checkin:{note:2000},series:{title:200,genre:160,premise:12000,characters:20000,outline:20000},chapter:{title:200,content:60000,notes:10000},import:{title:200},generate:{instructions:1500},forai:{name:160,description:1000,siteUrl:2000,author:160},video:{title:60}};
const fieldLabels={title:'제목',address:'주소',note:'메모',url:'주소',name:'이름',relationship:'관계',contactInfo:'연락 방법',consentNote:'동의 메모',genre:'장르',premise:'핵심 설정',characters:'등장인물',outline:'전체 줄거리',content:'본문',notes:'집필 메모',instructions:'이번 회차 요청',description:'서비스 소개',siteUrl:'사이트 주소',author:'작성자'};
const capabilityLinks=cap=>cap.id==='grok-bot'?`<div class="studio-actions">${link('https://grok.com/?product=grok-bot','공식 Grok Bot 열기')}${link('https://play.google.com/store/apps/details?id=ai.x.grok.bot','Android 앱 열기')}</div>`:'';

// The surrounding controller owns authentication and job/artifact controls.
export function createStudioView({root, api, notify = () => {}, onJobCreated = () => {}, storage = globalThis.sessionStorage, storageKey = 'blackhole-pending-studio-v1', saveFile}) {
  if (!root || typeof api !== 'function') throw new Error('운영실의 화면과 연결 함수가 필요합니다.');
  let data=null, capabilities=[], capabilityError='', state=null, currentTab='forai';
  let loading=false, error='', message='', epoch=0, selectedSeries='', showArchived=false;
  let editingPlace='', editingContact='', editingSeries='', editingChapter='', requests, storageError='';
  const drafts=new Map(), editRevisions=new Map(), createdJobIds=new Set(), invitationLinks=new Map();
  const allowedPaths=new Set(['/api/studio','/api/studio/generate','/api/studio/import','/api/production/run','/api/hankki/invite','/api/hankki/revoke']);
  try {
    requests=createCommandRequest({storage,key:storageKey,allowPath:path=>allowedPaths.has(path),transport:async(path,body)=>{
      const result=await api(path,body);
      const valid=path==='/api/production/run'?typeof result?.job?.id==='string':path==='/api/studio/generate'?typeof result?.job?.id==='string' && typeof result?.quest?.id==='string':typeof result?.result?.id==='string' && Number.isInteger(result?.result?.revision);
      if(!valid || (path==='/api/hankki/invite'&&!safeUrl(result?.responseUrl)))throw new Error('운영실 요청의 접수 응답을 확인하지 못했습니다.');
      return result;
    }});
  } catch(err) {storageError=err.message;}

  root.classList.add('studio');
  root.innerHTML=`<div class="studio-heading"><div><span class="eyebrow">BLACKHOLE STUDIO</span><h2>만들고, 기록하고, 이어서 운영하세요.</h2><p>저장한 내용과 결과는 이 본체에서 계속 이어집니다.</p></div>${actionButton('refresh','새로고침')}</div><nav class="studio-tabs" aria-label="운영실 서비스">${tabs.map(([id,label])=>`<button type="button" data-studio-tab="${id}" class="${id===currentTab?'active':''}" aria-pressed="${id===currentTab}">${label}</button>`).join('')}</nav><div class="studio-status" role="status" aria-live="polite"></div><div class="studio-pending" role="status" hidden><p></p>${actionButton('retry','같은 요청 재시도')}</div><div class="studio-error" role="alert" hidden></div><div class="studio-message" role="status" hidden></div><div class="studio-pane"></div><section class="studio-jobs" aria-label="운영실 작업"></section>`;
  const $=selector=>root.querySelector(selector);
  const pane=$('.studio-pane');
  const rows=key=>Array.isArray(data?.[key])?data[key]:[];
  const novelCandidates=()=>(state?.jobs||[]).filter(job=>job.type==='agent'&&job.questId&&job.studioSeriesId===selectedSeries&&job.status==='completed'&&job.artifacts?.length);
  const locked=()=>Boolean(requests?.pending||requests?.sending||storageError);
  const connected=()=>Boolean(state)&&state.online!==false;

  function captureDrafts() {
    for(const form of pane.querySelectorAll('form[data-studio-form]')) {
      const values={};
      for(const element of form.elements)if(element.name)values[element.name]=element.type==='checkbox'?element.checked:element.value;
      drafts.set(form.dataset.studioForm, values);
    }
  }
  function restoreDrafts() {
    for(const form of pane.querySelectorAll('form[data-studio-form]')) {
      const values=drafts.get(form.dataset.studioForm);if(!values)continue;
      for(const element of form.elements)if(element.name && Object.hasOwn(values,element.name)) {
        if(element.type==='checkbox')element.checked=values[element.name];
        else if(element.tagName!=='SELECT'||[...element.options].some(option=>option.value===values[element.name]))element.value=values[element.name];
      }
    }
  }
  function displayStatus() {
    $('.studio-status').textContent=!connected()?'본체 연결을 확인해 주세요.':loading?'저장한 운영 기록을 불러오는 중…':data?`본체 확인 ${date(data.checkedAt || data.updatedAt || state?.updatedAt)}${state.emergencyStop?' · 전체 멈춤 중':''}`:'운영 기록을 불러와 주세요.';
    const pending=requests?.pending;
    $('.studio-pending').hidden=!pending&&!storageError;
    $('.studio-pending p').textContent=storageError?'요청을 안전하게 보관할 수 없어 새 저장과 실행을 멈췄습니다. 이 브라우저 탭의 저장 공간 접근을 허용해 주세요.':requests?.sending?'본체가 요청을 접수했는지 확인하고 있습니다.':pending?'이전 요청의 응답이 확인되지 않았습니다. 같은 요청을 확인한 뒤 새 작업을 맡길 수 있습니다.':'';
    $('[data-studio-action="retry"]').hidden=!pending;
    $('[data-studio-action="retry"]').disabled=!connected()||Boolean(requests?.sending)||Boolean(storageError);
    $('[data-studio-action="refresh"]').disabled=!connected()||loading;
    $('.studio-error').textContent=error;$('.studio-error').hidden=!error;
    $('.studio-message').textContent=message;$('.studio-message').hidden=!message;
    for(const element of pane.querySelectorAll('input,textarea,select,button')) {
      const mutation=element.closest('form')||['archive-place','archive-chapter','checkin-ate','checkin-not-yet','checkin-cancel','hankki-invite','hankki-revoke'].includes(element.dataset.studioAction);
      if(mutation)element.disabled=!connected()||!data||locked()||element.dataset.unavailable==='true'||Boolean(element.closest('[data-execution]')&&state?.emergencyStop);
      else if(element.dataset.studioAction==='export')element.disabled=!connected();
    }
  }
  function renderJobs() {
    const jobs=(state?.jobs||[]).filter(job=>createdJobIds.has(job.id) || job.studioSeriesId || job.production || job.type==='production' || job.studio || job.type==='video' || job.type==='forai' || rows('chapters').some(ch=>ch.jobId===job.id));
    const latest=jobs.slice(0,6);
    $('.studio-jobs').innerHTML=latest.length?`<h3>최근 제작 작업</h3><div class="studio-job-list">${latest.map(job=>`<article><div><strong>${esc(job.title||job.type)}</strong><small>${esc({queued:'대기 중',running:'실행 중',completed:'결과 생성 완료',paused:'멈춤',cancelled:'종료',failed:'실패'}[job.status]||job.status)} · ${esc(date(job.createdAt))}</small></div>${actionButton('open-job','작업과 결과 열기',job.id)}</article>`).join('')}</div>`:'';
  }
  function formStart(name, title, note='', execution=false) {return `<form data-studio-form="${name}" class="studio-card studio-form" ${execution?'data-execution="true"':''}><h3>${esc(title)}</h3>${note?`<p class="studio-note">${esc(note)}</p>`:''}<div class="studio-fields">`;}
  function formEnd(button, edit=false) {return `</div><div class="studio-actions"><button type="submit" class="button primary">${esc(button)}</button>${edit?actionButton('reload-edit','저장된 내용 다시 불러오기')+actionButton('cancel-edit','새로 작성'):''}</div></form>`;}
  function renderForAi() {
    return `<div class="studio-intro"><span class="studio-kicker">A01 · For-Ai</span><h3>AI가 읽을 수 있는 페이지 만들기</h3><p>페이지 구조를 검사하고 수정할 항목과 검색용 파일을 만듭니다. 실제 AI 답변 노출률은 이 검사와 별도로 측정해야 합니다.</p></div>${formStart('forai','페이지 분석','공개 HTTPS 주소 또는 HTML·본문을 분석합니다. 붙여 넣기는 UTF-8 기준 64 KiB까지이며, 한글은 보통 한 글자에 3바이트입니다.',true)}${selectField('mode','입력 방식',[['url','공개 URL'],['html','HTML 붙여 넣기'],['text','본문 붙여 넣기']],'url')}${field('url','공개 페이지 주소','',{type:'url',placeholder:'https://example.com'})}${field('content','HTML 또는 본문','',{textarea:true,wide:true,maxlength:65536,rows:8})}${field('name','브랜드·서비스 이름','',{maxlength:160})}${field('description','서비스 소개','',{maxlength:1000})}${field('siteUrl','사이트 주소','',{type:'url'})}${field('author','작성자','',{maxlength:160})}${formEnd('분석 파일 만들기')}`;
  }
  function renderPlaces() {
    const item=rows('places').find(row=>row.id===editingPlace);
    const places=rows('places').filter(row=>showArchived||active(row));
    return `<div class="studio-intro"><span class="studio-kicker">A02 · 여기</span><h3>장소에 기억을 남기세요.</h3><p>직접 입력한 장소와 메모를 보관합니다. 위치나 주소록은 자동으로 가져오지 않습니다.</p></div><div class="studio-columns">${formStart('place',item?'장소 수정':'장소 기록')}${field('title','장소 이름',item?.title,{required:true,maxlength:160})}${field('address','주소',item?.address,{maxlength:1000})}${field('note','남길 기억',item?.note,{textarea:true,wide:true,maxlength:12000})}${field('url','관련 링크',item?.url,{type:'url'})}${field('latitude','위도 · 선택',item?.coordinates?.latitude??item?.latitude??'',{type:'number',min:-90,max:90,step:'any'})}${field('longitude','경도 · 선택',item?.coordinates?.longitude??item?.longitude??'',{type:'number',min:-180,max:180,step:'any'})}${formEnd(item?'변경 저장':'장소 저장',Boolean(item))}<section class="studio-records"><div class="studio-list-heading"><h3>저장한 장소 · ${places.length}</h3>${actionButton('export','내보내기','','data-kind="places"')}${actionButton('toggle-archived',showArchived?'현재 장소만':'보관한 장소도')}</div>${places.map(place=>`<article class="studio-card"><div class="studio-card-heading"><h3>${esc(place.title)}</h3>${!active(place)?'<span class="status">보관됨</span>':''}</div><p class="studio-note">${esc(place.address)}</p><p class="studio-body">${esc(place.note)}</p><small>${esc(date(place.updatedAt||place.createdAt))}</small><div class="studio-actions">${active(place)?actionButton('edit-place','수정',place.id):''}${active(place)?actionButton('archive-place','보관',place.id):''}${link(place.url,'관련 링크')}${place.coordinates?link(`https://www.openstreetmap.org/?mlat=${encodeURIComponent(place.coordinates.latitude)}&mlon=${encodeURIComponent(place.coordinates.longitude)}#map=16/${encodeURIComponent(place.coordinates.latitude)}/${encodeURIComponent(place.coordinates.longitude)}`,'지도'):''}</div></article>`).join('')||empty('처음 남길 장소를 입력해 주세요.')}</section></div>`;
  }
  function renderCheckins() {
    const contact=rows('contacts').find(row=>row.id===editingContact), contacts=rows('contacts').filter(active), consented=contacts.filter(row=>row.consent==='granted');
    const contactName=id=>contacts.find(row=>row.id===id)?.name||'보관된 연락처';
    const checkins=[...rows('checkins')].sort((a,b)=>Date.parse(b.createdAt||b.dueAt)-Date.parse(a.createdAt||a.dueAt));
    return `<div class="studio-intro"><span class="studio-kicker">A03 · 한끼안부</span><h3>한 끼를 묻고, 안부를 기록하세요.</h3><p>연호님이 확인한 동의와 식사 답변을 기록하는 개인 운영실입니다. 이 화면의 저장은 상대방에게 메시지를 보내지 않습니다.</p></div><div class="studio-columns"><div>${formStart('contact',contact?'연락처·동의 수정':'확인할 사람 등록')}${field('name','이름',contact?.name,{required:true,maxlength:160})}${field('relationship','관계',contact?.relationship,{maxlength:160})}${field('contactInfo','연락 방법 · 선택',contact?.contactInfo,{maxlength:500})}${selectField('consent','식사 확인 동의',[['not_asked','아직 확인하지 않음'],['granted','직접 동의를 확인함'],['revoked','동의 철회']],contact?.consent||'not_asked')}${field('consentNote','동의를 확인한 방법과 시점',contact?.consentNote,{textarea:true,wide:true,maxlength:2000,placeholder:'예: 오늘 통화에서 식사 여부를 기록해도 좋다고 동의'})}${formEnd(contact?'변경 저장':'연락처 저장',Boolean(contact))}${formStart('checkin','식사 확인 등록','동의를 기록한 사람만 선택할 수 있습니다. 시각은 현재 기기 시간대이며 24시간 이내로 지정합니다.')}${selectField('contactId','확인할 사람',consented.length?consented.map(row=>[row.id,row.name]):[['','먼저 동의를 기록해 주세요']])}${selectField('meal','식사',[['breakfast','아침'],['lunch','점심'],['dinner','저녁'],['other','기타']],'dinner')}${field('dueAt','확인할 시각',localTime(),{type:'datetime-local',required:true})}${field('note','메모','',{textarea:true,wide:true,maxlength:2000})}${formEnd('식사 확인 저장')}</div><section class="studio-records"><div class="studio-list-heading"><h3>안부 기록 · ${checkins.length}</h3>${actionButton('export','내보내기','','data-kind="checkins"')}</div>${checkins.map(row=>{const finished=['answered','responded','cancelled'].includes(row.status)||Boolean(row.answer||row.answeredAt||row.respondedAt);return `<article class="studio-card"><div class="studio-card-heading"><h3>${esc(contactName(row.contactId))} · ${esc({breakfast:'아침',lunch:'점심',dinner:'저녁',other:'기타'}[row.meal]||row.meal)}</h3><span class="status">${esc(row.status==='cancelled'?'취소':row.answer==='ate'?'먹었어요':row.answer==='not_yet'?'아직이에요':row.status==='overdue'||Date.parse(row.dueAt)<Date.now()?'미응답':'확인 예정')}</span></div><p class="studio-note">${esc(date(row.dueAt))}</p><p class="studio-body">${esc(row.note)}</p>${row.answer?`<small>${row.recordedBy==='recipient'?'응답 링크에서 받은 답변':'소유자가 기록한 답변'}</small>`:''}${!finished?`<div class="studio-actions">${actionButton('checkin-ate','먹었어요',row.id)}${actionButton('checkin-not-yet','아직이에요',row.id)}${actionButton('checkin-cancel','확인 취소',row.id)}</div>`:''}</article>`;}).join('')||empty('등록한 식사 확인이 여기에 표시됩니다.')}<h3 class="studio-subheading">등록한 사람</h3>${contacts.map(row=>`<article class="studio-card studio-contact"><div><h3>${esc(row.name)}</h3><p class="studio-note">${esc(row.relationship)} · ${esc({granted:'동의 확인 기록',revoked:'동의 철회',not_asked:'동의 미확인'}[row.consent]||row.consent)}</p></div>${actionButton('edit-contact','수정',row.id)}</article>`).join('')||empty('등록한 사람이 없습니다.')}</section></div>`;
  }
  function renderNovels() {
    const series=rows('series').filter(active);
    if(!series.some(row=>row.id===selectedSeries))selectedSeries=series[0]?.id||'';
    const selected=series.find(row=>row.id===selectedSeries), seriesEdit=series.find(row=>row.id===editingSeries), chapter=rows('chapters').find(row=>row.id===editingChapter);
    const chapters=rows('chapters').filter(row=>row.seriesId===selectedSeries&&(showArchived||active(row))).sort((a,b)=>a.number-b.number);
    const completed=novelCandidates();
    return `<div class="studio-intro"><span class="studio-kicker">B04 · 소설</span><h3>세계관부터 다음 회차까지 이어서 쓰세요.</h3><p>시리즈·회차 원고를 저장하고 파일로 내보냅니다. AI는 약 800~1,200자의 짧은 장면을 작성합니다. 완성된 결과를 확인한 뒤 회차로 가져옵니다.</p></div><div class="studio-columns"><div>${formStart('series',seriesEdit?'시리즈 설정 수정':'새 시리즈')}${field('title','작품명',seriesEdit?.title,{required:true,maxlength:200})}${field('genre','장르',seriesEdit?.genre,{maxlength:160})}${field('premise','핵심 설정',seriesEdit?.premise,{textarea:true,wide:true,maxlength:12000})}${field('characters','등장인물',seriesEdit?.characters,{textarea:true,wide:true,maxlength:20000})}${field('outline','전체 줄거리',seriesEdit?.outline,{textarea:true,wide:true,maxlength:20000})}${formEnd(seriesEdit?'설정 저장':'시리즈 저장',Boolean(seriesEdit))}${selected?`${formStart('chapter',chapter?'회차 원고 수정':'회차 원고 저장')}${field('title','회차 제목',chapter?.title,{required:true,maxlength:200})}${field('number','회차',chapter?.number??Math.max(0,...chapters.map(row=>row.number))+1,{type:'number',required:true,min:1,max:10000})}${field('content','원고',chapter?.content,{textarea:true,wide:true,maxlength:60000,rows:15})}${field('notes','집필 메모',chapter?.notes,{textarea:true,wide:true,maxlength:10000})}${formEnd(chapter?'원고 변경 저장':'원고 저장',Boolean(chapter))}`:''}</div><section class="studio-records"><div class="studio-card studio-series-picker">${selectField('selectedSeries','작업할 시리즈',series.length?series.map(row=>[row.id,row.title]):[['','시리즈를 먼저 저장해 주세요']],selectedSeries)}${selected?`<div class="studio-actions">${actionButton('edit-series','시리즈 설정',selected.id)}${actionButton('export','시리즈 내보내기',selected.id,'data-kind="series"')}</div>`:''}</div>${selected?`${formStart('generate','AI로 다음 회차 집필','AI는 약 800~1,200자의 짧은 장면을 작성합니다. 모델에 보낼 작품 설정은 합계 3,600자 이내로 요약해 주세요. 전체 원고는 별도로 보관됩니다.',true)}${field('instructions','이번 회차 요청','',{textarea:true,wide:true,required:true,maxlength:1500,placeholder:'전개, 분량, 시점, 다음 회차로 이어질 장면을 적어 주세요.'})}${formEnd('집필 작업 맡기기')}${formStart('import','완료된 집필 결과 가져오기','선택한 완료 작업의 결과 파일을 새 회차 원고로 저장합니다.')}${selectField('jobId','가져올 완료 작업',completed.length?completed.map(job=>[job.id,job.title||job.type]):[['','이 작품의 완료된 집필 결과가 아직 없습니다']])}${field('title','새 회차 제목','',{required:true,maxlength:200})}${field('number','회차',Math.max(0,...chapters.map(row=>row.number))+1,{type:'number',required:true,min:1,max:10000})}${formEnd('결과를 원고로 가져오기')}<div class="studio-list-heading"><h3>저장한 회차 · ${chapters.length}</h3>${actionButton('toggle-archived',showArchived?'현재 회차만':'보관한 회차도')}</div>${chapters.map(row=>`<article class="studio-card"><div class="studio-card-heading"><h3>${esc(row.number)}화 · ${esc(row.title)}</h3>${!active(row)?'<span class="status">보관됨</span>':''}</div><p class="studio-excerpt">${esc(row.content?.slice(0,350)||'아직 원고가 없습니다.')}</p><small>${esc((row.content||'').length.toLocaleString('ko-KR'))}자 · ${esc(date(row.updatedAt||row.createdAt))}</small><div class="studio-actions">${active(row)?actionButton('edit-chapter','원고 열기·수정',row.id):''}${actionButton('export','내보내기',row.id,'data-kind="chapter"')}${active(row)?actionButton('archive-chapter','보관',row.id):''}</div></article>`).join('')||empty('첫 회차 원고를 직접 저장하거나 AI에 맡겨 보세요.')}`:empty('작품명과 설정을 저장하면 회차를 이어서 쓸 수 있습니다.')}</section></div>`;
  }
  function renderVideo() {
    return `<div class="studio-intro"><span class="studio-kicker">B02-4 · 영상 제작</span><h3>입력한 장면을 실제 MP4로 만듭니다.</h3><p>720 × 1280 세로형 자막 영상입니다. 최대 6장면·60초이며 음성·배경음악은 포함하지 않습니다.</p></div>${formStart('video','장면 구성','영상 제목 60자, 장면 제목 70자, 문장 180자까지 입력합니다. 장면은 각각 2~10초이며, 결과에서 MP4를 내려받으세요.',true)}${field('title','영상 제목','',{required:true,maxlength:60,wide:true})}<div class="studio-scenes studio-wide">${Array.from({length:6},(_,i)=>`<fieldset><legend>장면 ${i+1}${i===0?' · 필수':' · 선택'}</legend><div class="studio-fields">${field(`heading${i}`,'장면 제목','',{required:i===0,maxlength:70})}${field(`seconds${i}`,'길이 · 초',5,{type:'number',min:2,max:10,step:1})}${field(`body${i}`,'화면에 표시할 문장','',{textarea:true,wide:true,maxlength:180,required:i===0,rows:2})}</div></fieldset>`).join('')}</div>${formEnd('MP4 제작 맡기기')}`;
  }
  function renderCapabilities() {
    const labels={working:'사용 가능',available:'사용 가능',ready:'사용 가능',implemented:'본체에 구현됨',configured:'연결 설정됨',connection_required:'연결 필요',needs_connection:'연결 필요',blocked:'연결 필요',partial:'일부 사용 가능',unavailable:'사용 불가',reference_only:'검토 자료'};
    return `<div class="studio-intro"><span class="studio-kicker">공통 능력</span><h3>본체가 실제로 실행할 수 있는 능력</h3><p>참고 자료 등록과 실행 가능한 기능을 구분해서 보여줍니다. 연결이 필요한 기능은 연결 상태가 바뀐 뒤 사용할 수 있습니다.</p></div>${capabilityError?`<p class="studio-error">${esc(capabilityError)}</p>`:''}<div class="studio-capabilities">${capabilities.map(cap=>`<article class="studio-card"><div class="studio-card-heading"><h3>${esc(cap.name||cap.id)}</h3><span class="status ${['working','available','ready'].includes(cap.status)?'completed':''}">${esc(labels[cap.status]||cap.status||'상태 확인 필요')}</span></div><p class="studio-body">${esc(cap.description||cap.scope||'')}</p>${capabilityLinks(cap)}${cap.reason||cap.missing?`<p class="studio-note">${esc(cap.reason||[].concat(cap.missing).join(' · '))}</p>`:''}${cap.lastCompletedAt?`<small>마지막 결과 생성 ${esc(date(cap.lastCompletedAt))}</small>`:''}</article>`).join('')||empty(capabilityError?'능력 상태를 다시 불러와 주세요.':'본체가 확인한 능력 목록이 아직 없습니다.')}</div>`;
  }
  function attachInvitations() {
    if(currentTab!=='checkins')return;
    for(const cancel of pane.querySelectorAll('[data-studio-action="checkin-cancel"]')) {
      const item=rows('checkins').find(row=>row.id===cancel.dataset.id);if(!item)continue;
      const card=cancel.closest('.studio-card'),expired=Date.parse(item.dueAt)<=Date.now();
      if(expired){for(const button of card.querySelectorAll('[data-studio-action="checkin-ate"],[data-studio-action="checkin-not-yet"]'))button.dataset.unavailable='true';continue;}
      const saved=invitationLinks.get(item.id),currentLink=saved&&saved.revision===item.revision?saved.url:'';
      const issued=item.invitation?.status==='active';
      card.insertAdjacentHTML('beforeend',`<div class="studio-invitation"><p class="studio-note">상대방이 직접 답할 수 있는 전용 링크입니다.</p>${currentLink?`<label>이 식사 확인의 응답 링크<input data-invitation-url="${esc(item.id)}" value="${esc(currentLink)}" readonly aria-label="응답 링크"></label><div class="studio-actions">${actionButton('hankki-copy','응답 링크 복사',item.id)}</div>`:''}<div class="studio-actions">${actionButton('hankki-invite',issued?'새 링크 만들기 · 이전 링크 만료':'응답 링크 만들기',item.id)}${issued?actionButton('hankki-revoke','응답 링크 폐기',item.id):''}</div><small>링크 전달은 직접 해 주세요. 이 안부의 식사 답변만 기록할 수 있으며 확인 시각이 지나면 만료됩니다.</small></div>`);
    }
  }
  function updateNovelCandidates() {
    const select=pane.querySelector('form[data-studio-form="import"] select[name="jobId"]');if(!select)return;
    const current=select.value,candidates=novelCandidates();
    const html=candidates.length?candidates.map(job=>`<option value="${esc(job.id)}">${esc(job.title||job.type)}</option>`).join(''):'<option value="">이 작품의 완료된 집필 결과가 아직 없습니다</option>';
    if(select.innerHTML===html)return;select.innerHTML=html;
    if(candidates.some(job=>job.id===current))select.value=current;
  }
  function renderPane(preserve=true) {
    if(preserve)captureDrafts();
    pane.innerHTML=!data?empty(error?'운영 기록을 불러오지 못했습니다. 새로고침으로 다시 확인할 수 있습니다.':'본체에 연결하면 운영 기록을 불러옵니다.'):{forai:renderForAi,places:renderPlaces,checkins:renderCheckins,novels:renderNovels,video:renderVideo,capabilities:renderCapabilities}[currentTab]();
    restoreDrafts();attachInvitations();displayStatus();renderJobs();
  }
  async function refresh() {
    if(!connected()||loading)return;
    const generation=epoch;loading=true;displayStatus();
    const results=await Promise.allSettled([api('/api/studio'),api('/api/capabilities')]);
    if(generation!==epoch)return;
    const overview=results[0];
    if(overview.status==='fulfilled'&&['places','contacts','checkins','series','chapters'].every(key=>Array.isArray(overview.value?.[key]))) {data=overview.value;error='';}
    else {const err=overview.status==='rejected'?overview.reason:new Error('운영실 목록 형식을 읽을 수 없습니다.');error=err.status===404?'이 본체에 운영실 업데이트가 아직 반영되지 않았습니다.':err.message;}
    const caps=results[1];capabilities=caps.status==='fulfilled'&&Array.isArray(caps.value?.capabilities)?caps.value.capabilities:[];capabilityError=caps.status==='rejected'?'실행 능력 목록을 불러오지 못했습니다.':caps.status==='fulfilled'&&!Array.isArray(caps.value?.capabilities)?'실행 능력 목록 형식을 읽을 수 없습니다.':'';
    loading=false;renderPane();
  }
  async function submit(path,body,formName) {
    if(!connected()||!requests||requests.sending||storageError)return;
    if(requests.pending&&body){error='먼저 같은 요청 재시도로 이전 접수 여부를 확인해 주세요.';displayStatus();return;}
    const generation=epoch;error='';message='';captureDrafts();
    try {
      if(body)requests.stage(path,body);
      const pending=requests.send();displayStatus();
      const outcome=await pending;if(generation!==epoch)return;
      if(outcome.kind==='accepted') {
        const sent=outcome.request.body;
        if(outcome.request.path==='/api/hankki/invite')invitationLinks.set(sent.checkinId,{url:outcome.result.responseUrl,revision:outcome.result.result.revision});
        if(outcome.request.path==='/api/hankki/revoke')invitationLinks.delete(sent.checkinId);
        const acceptedForm=formName||({video:'video',forai:'forai'}[sent.kind])||({place:'place',contact:'contact',checkin:'checkin',series:'series',chapter:'chapter'}[(sent.action||'').split('.')[0]])||(outcome.request.path.endsWith('/generate')?'generate':outcome.request.path.endsWith('/import')?'import':null);
        if(acceptedForm){drafts.delete(acceptedForm);editRevisions.delete(acceptedForm);}
        if(acceptedForm==='place')editingPlace='';if(acceptedForm==='contact')editingContact='';if(acceptedForm==='series')editingSeries='';if(acceptedForm==='chapter')editingChapter='';
        if(sent.action==='series.create')selectedSeries=outcome.result.result.id;
        message=outcome.result.job?'본체가 작업을 접수했습니다. 작업과 결과에서 실행 상태와 완성된 파일을 확인하세요.':'본체에 저장했습니다.';
        if(outcome.result.job){createdJobIds.add(outcome.result.job.id);onJobCreated(outcome.result.job);}
        // Do not recapture a submitted form when replacing it with fresh values.
        pane.innerHTML='';await refresh();
      } else if(outcome.kind==='rejected') {error=outcome.error.message;if(outcome.error.status===409){error+=' 최신 기록을 다시 불러왔습니다. 입력 내용과 변경된 기록을 확인해 주세요.';const kept=error;await refresh();error=kept;}}
      else error='본체의 접수 여부를 확인하지 못했습니다. 같은 요청 재시도로 확인해 주세요.';
    } catch(err) {error=err.message;}
    finally {if(generation===epoch)displayStatus();}
  }
  async function exportData(kind,id) {
    const generation=epoch;
    try {
      const response=await api(`/api/studio/export?kind=${encodeURIComponent(kind)}${id?`&id=${encodeURIComponent(id)}`:''}`,undefined,{raw:true});
      const blob=await response.blob();if(generation!==epoch)return;
      const filename=response.headers.get('content-disposition')?.match(/filename="([^"/\\]+)"/)?.[1]||`blackhole-${kind}-${new Date().toISOString().slice(0,10)}.md`;
      if(saveFile){await saveFile({blob,filename,sha256:response.headers.get('x-content-sha256')});return;}
      const url=URL.createObjectURL(blob);
      const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30_000);notify('파일을 내려받았습니다.');
    } catch(err) {if(generation===epoch){error=err.message;displayStatus();}}
  }
  root.addEventListener('click',event=>{
    const tab=event.target.closest('[data-studio-tab]');
    if(tab&&root.contains(tab)){captureDrafts();currentTab=tab.dataset.studioTab;for(const button of root.querySelectorAll('[data-studio-tab]')){button.classList.toggle('active',button===tab);button.setAttribute('aria-pressed',String(button===tab));}renderPane(false);return;}
    const button=event.target.closest('[data-studio-action]');if(!button||!root.contains(button)||button.disabled)return;
    const action=button.dataset.studioAction,id=button.dataset.id;
    if(action==='refresh'){void refresh();return;}if(action==='retry'){void submit();return;}if(action==='export'){void exportData(button.dataset.kind,id);return;}
    if(action==='open-job'){const job=(state?.jobs||[]).find(row=>row.id===id);if(job)onJobCreated(job);return;}
    if(action==='hankki-copy'){const saved=invitationLinks.get(id);if(!saved)return;const input=pane.querySelector(`[data-invitation-url="${id}"]`);if(globalThis.navigator?.clipboard?.writeText)void navigator.clipboard.writeText(saved.url).then(()=>notify('응답 링크를 복사했습니다. 전달할 사람에게 직접 보내 주세요.')).catch(()=>{input?.focus();input?.select();notify('링크를 길게 눌러 복사해 주세요.');});else{input?.focus();input?.select();notify('링크를 길게 눌러 복사해 주세요.');}return;}
    if(action==='toggle-archived'){showArchived=!showArchived;renderPane();return;}
    if(action==='cancel-edit'){const kind=button.closest('form')?.dataset.studioForm;captureDrafts();if(kind==='place')editingPlace='';if(kind==='contact')editingContact='';if(kind==='series')editingSeries='';if(kind==='chapter')editingChapter='';drafts.delete(kind);editRevisions.delete(kind);renderPane(false);return;}
    if(action==='reload-edit'){const kind=button.closest('form')?.dataset.studioForm;const selectedId={place:editingPlace,contact:editingContact,series:editingSeries,chapter:editingChapter}[kind];const item=rows({place:'places',contact:'contacts',series:'series',chapter:'chapters'}[kind]).find(row=>row.id===selectedId);if(item){captureDrafts();drafts.delete(kind);editRevisions.set(kind,item.revision);error='';renderPane(false);}return;}
    if(action.startsWith('edit-')){captureDrafts();const kind=action.slice(5);const item=rows({place:'places',contact:'contacts',series:'series',chapter:'chapters'}[kind]).find(row=>row.id===id);if(!item||!active(item))return;drafts.delete(kind);editRevisions.set(kind,item.revision);if(kind==='place')editingPlace=id;if(kind==='contact')editingContact=id;if(kind==='series')editingSeries=id;if(kind==='chapter')editingChapter=id;renderPane(false);pane.querySelector(`form[data-studio-form="${kind}"]`)?.scrollIntoView({block:'start',behavior:'smooth'});return;}
    if(locked()||!connected())return;
    const kind=action==='archive-place'?'places':action==='archive-chapter'?'chapters':'checkins';const item=rows(kind).find(row=>row.id===id);if(!item)return;
    if(action==='hankki-invite'||action==='hankki-revoke'){void submit(action==='hankki-invite'?'/api/hankki/invite':'/api/hankki/revoke',{checkinId:item.id,expectedRevision:item.revision});return;}
    if(action==='archive-place'||action==='archive-chapter')void submit('/api/studio',{action:`${kind==='places'?'place':'chapter'}.archive`,id,expectedRevision:item.revision});
    if(action==='checkin-ate'||action==='checkin-not-yet')void submit('/api/studio',{action:'checkin.respond',id,expectedRevision:item.revision,answer:action==='checkin-ate'?'ate':'not_yet',note:'소유자가 직접 확인한 답변'});
    if(action==='checkin-cancel')void submit('/api/studio',{action:'checkin.cancel',id,expectedRevision:item.revision,reason:'소유자가 확인 취소'});
  });
  root.addEventListener('change',event=>{
    if(event.target.name==='selectedSeries'){captureDrafts();selectedSeries=event.target.value;editingChapter='';for(const name of ['chapter','generate','import'])drafts.delete(name);renderPane(false);}
  });
  root.addEventListener('submit',event=>{
    const form=event.target.closest('form[data-studio-form]');if(!form||!root.contains(form))return;event.preventDefault();
    if(locked()||!connected()||!form.reportValidity())return;
    const name=form.dataset.studioForm,values=Object.fromEntries(new FormData(form));
    const text=name=>String(values[name]||'').trim();
    let path='/api/studio',body;
    try {
      for(const [key,max] of Object.entries(formLimits[name]||{}))if(String(values[key]||'').length>max)throw new Error(`${fieldLabels[key]||key}은 ${max.toLocaleString('ko-KR')}자 이내로 적어 주세요.`);
      if(['chapter','import'].includes(name)&&(!Number.isInteger(Number(values.number))||Number(values.number)<1||Number(values.number)>10000))throw new Error('회차는 1~10,000의 정수로 입력해 주세요.');
      if(name==='place') {
        const item=rows('places').find(row=>row.id===editingPlace);
        body={action:item?'place.update':'place.create',title:text('title'),address:text('address'),note:text('note'),url:text('url'),...(item?{id:item.id,expectedRevision:editRevisions.get('place')}:{})};
        if(text('latitude')||text('longitude')) {if(!text('latitude')||!text('longitude'))throw new Error('위도와 경도를 함께 입력해 주세요.');body.coordinates={latitude:Number(values.latitude),longitude:Number(values.longitude)};}
        else if(item?.coordinates)body.coordinates=null;
      } else if(name==='contact') {
        const item=rows('contacts').find(row=>row.id===editingContact);
        if(values.consent==='granted'&&!text('consentNote'))throw new Error('동의를 확인한 방법과 시점을 적어 주세요.');
        body={action:item?'contact.update':'contact.create',name:text('name'),relationship:text('relationship'),contactInfo:text('contactInfo'),consent:values.consent,consentNote:text('consentNote'),...(item?{id:item.id,expectedRevision:editRevisions.get('contact')}:{})};
      } else if(name==='checkin') {
        if(!values.contactId)throw new Error('동의를 기록한 사람을 먼저 선택해 주세요.');
        const due=new Date(values.dueAt).getTime();if(!Number.isFinite(due)||due<=Date.now()||due>Date.now()+86_400_000)throw new Error('확인할 시각을 지금부터 24시간 이내로 정해 주세요.');
        body={action:'checkin.create',contactId:values.contactId,dueAt:new Date(due).toISOString(),meal:values.meal,note:text('note')};
      } else if(name==='series') {
        const item=rows('series').find(row=>row.id===editingSeries);body={action:item?'series.update':'series.create',title:text('title'),genre:text('genre'),premise:text('premise'),characters:text('characters'),outline:text('outline'),...(item?{id:item.id,expectedRevision:editRevisions.get('series')}:{})};
      } else if(name==='chapter') {
        const item=rows('chapters').find(row=>row.id===editingChapter);body={action:item?'chapter.update':'chapter.create',title:text('title'),number:Number(values.number),content:String(values.content||''),notes:text('notes'),...(item?{id:item.id,expectedRevision:editRevisions.get('chapter')}:{seriesId:selectedSeries})};
      } else if(name==='generate') {if(text('instructions').length>1500)throw new Error('이번 회차 요청을 1,500자 이내로 적어 주세요.');path='/api/studio/generate';body={seriesId:selectedSeries,instructions:text('instructions')};}
      else if(name==='import') {if(!novelCandidates().some(job=>job.id===values.jobId))throw new Error('이 작품에서 생성한 완료 집필 결과를 선택해 주세요.');path='/api/studio/import';body={seriesId:selectedSeries,jobId:values.jobId,number:Number(values.number),title:text('title')};}
      else if(name==='forai') {const mode=values.mode;if(mode==='url'&&(!safeUrl(text('url'))||!text('url').startsWith('https://')))throw new Error('분석할 공개 HTTPS 주소를 입력해 주세요.');if(mode!=='url'&&!text('content'))throw new Error('분석할 HTML 또는 본문을 붙여 넣어 주세요.');if(mode!=='url'&&new TextEncoder().encode(values.content).byteLength>65536)throw new Error('분석할 본문을 64 KiB 이내로 줄여 주세요.');path='/api/production/run';body={kind:'forai',input:{mode,...(mode==='url'?{url:text('url')}:{content:String(values.content||'')}),profile:Object.fromEntries(['name','description','siteUrl','author'].filter(key=>text(key)).map(key=>[key,text(key)]))}};}
      else if(name==='video') {
        const invalid=/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
        if(!text('title')||text('title').includes('\n')||invalid.test(text('title')))throw new Error('영상 제목은 줄바꿈이나 특수 제어 문자 없이 입력해 주세요.');
        const scenes=[];for(let i=0;i<6;i++)if(text(`heading${i}`)||text(`body${i}`)){
          const heading=text(`heading${i}`),body=text(`body${i}`),seconds=Number(values[`seconds${i}`]);
          if(!heading||!body)throw new Error(`장면 ${i+1}의 제목과 문장을 함께 입력해 주세요.`);
          if(String(values[`heading${i}`]).length>70||String(values[`body${i}`]).length>180)throw new Error(`장면 ${i+1}의 제목은 70자, 문장은 180자 이내로 적어 주세요.`);
          if(invalid.test(heading)||invalid.test(body))throw new Error(`장면 ${i+1}의 문구에서 특수 제어 문자를 제거해 주세요.`);
          if(!Number.isInteger(seconds)||seconds<2||seconds>10)throw new Error(`장면 ${i+1}의 길이를 2~10초의 정수로 입력해 주세요.`);
          scenes.push({heading,body,seconds});
        }
        if(!scenes.length||scenes.reduce((sum,scene)=>sum+scene.seconds,0)>60)throw new Error('장면을 한 개 이상 작성하고 전체 길이를 60초 이내로 맞춰 주세요.');path='/api/production/run';body={kind:'video',input:{title:text('title'),scenes}};
      }
      if(body)void submit(path,body,name);
    } catch(err) {error=err.message;displayStatus();}
  });
  renderPane(false);
  return {
    refresh,
    get sending() {return Boolean(requests?.sending);},
    setState(next) {state=next;updateNovelCandidates();displayStatus();renderJobs();},
    reset() {epoch++;state=null;data=null;capabilities=[];capabilityError='';loading=false;error='';message='';selectedSeries='';editingPlace='';editingContact='';editingSeries='';editingChapter='';drafts.clear();editRevisions.clear();createdJobIds.clear();invitationLinks.clear();renderPane(false);},
  };
}
