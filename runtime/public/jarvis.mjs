// BLACKHOLE 자비스 — the living face over the real runtime.
//
// Nothing here is simulated: every number on screen is read from /api/state
// (coreHomeSummary: activity, dominant drive, heartbeat, shadows, pending
// approvals; agent: the configured model, including local Ollama),
// and the owner's explicit work/conversation mode sends to /api/commands or
// /api/voice. Work mode runs a real quest through the model router. Jarvis's own
// words come from the artifacts those jobs produce, fetched via /api/artifacts.
// Pairing reuses web-client.mjs verbatim, so this page shares the 운영실 session.
import {connectBrowser} from './web-client.mjs';
import {startJarvisOrb} from './jarvis-orb.mjs';
import {attachSmallOrb} from './small-orbs.mjs';
import {smallOrbState} from './small-orb-state.mjs';
import {ACTIVITY_KO,DRIVE_COLOR,PUBLIC_BRAND_NAME,sceneMoments,normalizeJarvisAddress,anticipationSpeech,hungerCurveModel,measuredDriveTint,heartbeatChanged,composeFromCore,idleDriveSpeech,resultSpeech,failureCode,failureSpeech,failureJobToShow,workCommandText,resultJobToShow,renderArtifactDocument} from './jarvis-scene-model.mjs';
const neutralTint = getComputedStyle(document.documentElement).getPropertyValue('--j-focus').trim();

const $ = id => document.getElementById(id);
document.querySelector('.brand span').textContent=PUBLIC_BRAND_NAME;
const JOB_KO = {running:'실행 중',queued:'대기 중',paused:'일시정지',completed:'완료',failed:'실패',cancelled:'취소',stopped:'중단'};
const POLL_MS = 3000;
const commandMode = $('command-mode');
let conversationMode = false;
commandMode.addEventListener('click',()=>{
  conversationMode = !conversationMode;
  commandMode.textContent = conversationMode ? '대화' : '작업';
  commandMode.setAttribute('aria-pressed',String(conversationMode));
  commandMode.setAttribute('aria-label',conversationMode ? '작업 모드로 전환' : '대화 모드로 전환');
  $('in').placeholder = conversationMode ? '말씀해 주세요.' : '작업을 입력하세요.';
  $('in').focus();
});

const lineEl = $('line');
const resultLink = $('result-link');
function clearResultLink() { resultLink.hidden = true; $('result-actions').hidden = true; $('result-rating').hidden = true; resultLink.removeAttribute('href'); $('speech-label').textContent = 'LIVE CORE / NOW'; }
function showResultLink(id) { resultLink.href = `/api/artifacts/${encodeURIComponent(id)}`; resultLink.hidden = false; $('result-actions').hidden = false; $('speech-label').textContent = '최근 완료 / RESULT'; }
async function showResultRating(job) {
  const panel=$('result-rating'),buttons=panel.querySelectorAll('button[data-stars]');
  panel.hidden=false;$('rating-prompt').hidden=false;$('rating-status').textContent='';
  buttons.forEach(button=>{button.disabled=false;button.hidden=false;});
  try {
    const ratings=await api('/api/result-ratings');
    if(!showingResult||currentResult?.job.id!==job.id)return;
    const prior=ratings.entries?.find(entry=>entry.jobId===job.id);
    if(prior){buttons.forEach(button=>{button.hidden=true;});$('rating-prompt').hidden=true;$('rating-status').textContent=`소유자 평가 ${prior.stars}/5 · 자체 보고`;}
  } catch { if(showingResult&&currentResult?.job.id===job.id) $('rating-status').textContent='평가 기록을 확인하지 못했습니다.'; }
}
$('result-rating').addEventListener('click',async event=>{
  const button=event.target.closest('button[data-stars]');
  if(!button||!currentResult?.job?.artifacts?.[0])return;
  const job=currentResult.job,stars=Number(button.dataset.stars);
  $('result-rating').querySelectorAll('button[data-stars]').forEach(item=>{item.disabled=true;});
  try {
    const response=await api('/api/result-ratings',{requestId:crypto.randomUUID(),jobId:job.id,artifactId:job.artifacts[0].id,stars});
    if(currentResult?.job.id!==job.id)return;
    $('result-rating').querySelectorAll('button[data-stars]').forEach(item=>{item.hidden=true;});$('rating-prompt').hidden=true;
    $('rating-status').textContent=`소유자 평가 ${response.rating.stars}/5 · 자체 보고`;
  } catch(error) {
    if(currentResult?.job.id===job.id){$('rating-status').textContent=`평가를 저장하지 못했습니다. ${error.message}`;$('result-rating').querySelectorAll('button[data-stars]').forEach(item=>{item.disabled=false;});}
  }
});
$('result-dismiss').addEventListener('click',()=>{
  showingResult = false;currentResult = null;speechHoldUntil = 0;failureDetails = '';clearResultLink();doing('');$('in').focus();void tick();
});
resultLink.addEventListener('click',async event=>{
  event.preventDefault();
  if(resultLink.hidden||!session)return;
  const href=resultLink.getAttribute('href');
  try {
    const response=await session.fetch(href);
    if(!response.ok)throw new Error(`결과를 열지 못했습니다. 응답 ${response.status}`);
    renderArtifactDocument($('result-body'),await response.text());
    $('result-dialog').showModal();
    $('result-close').focus();
  } catch(error) { doing(error.message); }
});
$('result-close').addEventListener('click',()=>$('result-dialog').close());
let sayVersion = 0;
function say(text) {
  if (!text || lineEl.textContent === text) return;
  const version = ++sayVersion;
  lineEl.classList.add('fade');
  setTimeout(() => { if (version !== sayVersion) return; lineEl.textContent = text; lineEl.classList.toggle('failure',text.startsWith('완료하지 못했습니다.')); lineEl.classList.toggle('anticipation',text.includes('기록에 따른 예상입니다.')); lineEl.classList.remove('fade'); }, 160);
}
const doing = t => { $('doing').textContent = t || ''; };
const hint = message => { const h = $('hint'); h.hidden = !message; h.textContent = message || ''; };
const showDebate = text => { $('drive-debate').hidden = !text; $('drive-debate').textContent = text ? `최근 논쟁을 보고드립니다.\n${text}` : ''; };

let session, target = neutralTint, pulseAt = 0, busy = false, lastHeartbeat = null, spokenJobs = new Set(), awaitingJobId = null, speechHoldUntil = 0, firstResultTick = true, showingResult = false, failureDetails = '';
let jarvisAddress = '주인님', settingsReady = false, settingsBusy = false, pendingAddressWrite = null, currentResult = null;
const sendButton=$('send');
function setBusy(value){busy=value;sendButton.disabled=value;sendButton.textContent=value?'보내는 중…':'보내기 ↗';}
const scene = {core:{},drives:[],online:false};
const headerOrb = attachSmallOrb($('header-small-orb'));
try { spokenJobs = new Set(JSON.parse(localStorage.getItem('jarvis-spoken-v1') || '[]')); } catch (e) {}
const rememberSpoken = id => { spokenJobs.add(id); try { localStorage.setItem('jarvis-spoken-v1', JSON.stringify([...spokenJobs].slice(-200))); } catch (e) {} };

function showFailureReport(job) {
  showingResult = false;
  currentResult = null;
  speechHoldUntil = Infinity;
  failureDetails = `${job.title || '작업'} · (${failureCode(job.error || job.status)})`;
  rememberSpoken(job.id);
  clearResultLink();
  $('result-actions').hidden = false;
  $('speech-label').textContent = '실패 보고 / FAILURE';
  showDebate(null);
  say(failureSpeech(job.error || job.status));
  doing(failureDetails);
}

async function api(path, body) {
  const r = await session.fetch(path, body === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (!r.ok) { const err = new Error(j.error?.message || j.error || j.message || `응답 ${r.status}`); err.status = r.status; throw err; }
  return j;
}
async function artifactText(id) {
  const r = await session.fetch(`/api/artifacts/${encodeURIComponent(id)}`);
  if (!r.ok) return null;
  const blob = await r.blob();
  if (!/^text\/|json|markdown/.test(blob.type) && blob.type) return null;
  // The runtime appends a provenance footer after '---'; keep it in the log line, not in Jarvis's mouth.
  return (await blob.text()).split(/\n-{3,}\n/)[0].trim();
}

let lastState = null, controlBusy = false;
let stopPending=false;
let editingShadowId=null;
const SHADOW_TOOL_LABEL={project_read:'배정된 프로젝트 읽기',project_sources:'배정된 근거 목록',source_read_release:'등록된 공식 릴리스 읽기'};
async function openShadowProfile(member){
  const panel=$('shadow-profile-panel'),status=$('shadow-profile-status');
  panel.hidden=false;status.textContent='설정을 확인하고 있습니다.';
  try{
    const response=await api('/api/shadow-army/profiles');
    const profile=response.profiles?.find(item=>item.shadowId===member.id);
    if(!profile||profile.status==='stored')throw Error('활성 그림자 설정만 바꿀 수 있습니다.');
    editingShadowId=member.id;
    $('shadow-profile-heading').textContent=`${profile.name} 실행 설정 · ${profile.rank}`;
    const select=$('shadow-profile-model');select.replaceChildren();
    const choices=[['','기본 모델 상속'],...(response.availableModels??[]).map(provider=>[provider,provider])];
    for(const [value,label] of choices){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}
    if(profile.modelBinding&&!choices.some(([value])=>value===profile.modelBinding))status.textContent=`기존 ${profile.modelBinding} 연결은 지금 확인되지 않았습니다. 다른 연결을 고르거나 상속으로 바꿔 주세요.`;
    else status.textContent='선택한 범위는 다음 임무부터 적용됩니다.';
    select.value=choices.some(([value])=>value===profile.modelBinding)?profile.modelBinding:'';
    $('shadow-profile-budget').value=String(profile.budgetShare);
    const tools=$('shadow-profile-tools');tools.replaceChildren(tools.querySelector('legend'));
    for(const name of profile.allowedTools){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=name;input.checked=profile.toolScope.includes(name);label.append(input,document.createTextNode(SHADOW_TOOL_LABEL[name]??name));tools.append(label);}
    panel.scrollIntoView({block:'nearest'});select.focus();
  }catch(error){editingShadowId=null;status.textContent=`실행 설정을 열지 못했습니다. ${error.message}`;}
}
$('shadow-profile-cancel').addEventListener('click',()=>{$('shadow-profile-panel').hidden=true;editingShadowId=null;});
$('shadow-profile-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!editingShadowId)return;
  const save=event.submitter;save.disabled=true;
  try{
    const response=await api('/api/shadow-army/profiles',{requestId:crypto.randomUUID(),shadowId:editingShadowId,
      modelBinding:$('shadow-profile-model').value||null,budgetShare:Number($('shadow-profile-budget').value),
      toolScope:[...$('shadow-profile-tools').querySelectorAll('input:checked')].map(input=>input.value)});
    $('shadow-profile-status').textContent=`${response.profile.modelBinding??'기본 모델 상속'} · 호출 상한 ${response.profile.budgetShare}회 저장됨. 다음 임무부터 적용됩니다.`;
  }catch(error){$('shadow-profile-status').textContent=`설정을 저장하지 못했습니다. ${error.message}`;}
  finally{save.disabled=false;}
});
const controls = $('controls'), controlToggle = $('control-toggle');
function showControls(open) {
  if(!open){stopPending=false;$('stop-confirm').hidden=true;if(lastState)setControlsState(lastState);}
  controls.hidden = !open;
  controlToggle.setAttribute('aria-expanded', String(open));
  if (open) { $('control-close').focus(); if (session && !settingsBusy) void loadJarvisSettings(); }
  else controlToggle.focus();
}
controlToggle.addEventListener('click', () => showControls(controls.hidden));
$('control-close').addEventListener('click', () => showControls(false));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !controls.hidden) showControls(false); });
function setControlsUnavailable() {
  lastState = null;
  $('will-state').textContent = '연결 끊김';
  $('life-state').textContent = '확인 불가';
  $('authority-state').textContent = '작업 전송 불가';
  $('autopilot-toggle').disabled = true;
  $('emergency-toggle').disabled = true;
  $('shadow-count').textContent = '확인 불가';
  $('shadow-roster-list').replaceChildren();
  $('jarvis-address').disabled = true;
  $('address-save').disabled = true;
  settingsReady = false;
  $('address-status').textContent = '연결이 끊겨 호칭을 변경할 수 없습니다.';
  $('hunger-chart').setAttribute('hidden', '');
  $('hunger-legend').replaceChildren();
  $('hunger-data').hidden = true;
  $('hunger-summary').textContent = '연결이 끊겨 배고픔 기록을 확인할 수 없습니다.';
  $('system-notices').parentElement.hidden = true;
  $('scene-moments').hidden = true;
}

function setSettingsAvailability() {
  $('jarvis-address').disabled = !lastState || settingsBusy || !settingsReady;
  $('address-save').disabled = !lastState || settingsBusy || !settingsReady;
  $('address-save').textContent = settingsBusy ? '확인 중…' : '저장';
}

async function loadJarvisSettings() {
  if (settingsBusy) return;
  settingsBusy = true;
  setSettingsAvailability();
  try {
    const settings = await api('/api/jarvis/settings');
    const previous = jarvisAddress;
    jarvisAddress = normalizeJarvisAddress(settings.address);
    if (!settingsReady || $('jarvis-address').value === previous) $('jarvis-address').value = jarvisAddress;
    settingsReady = true;
    $('address-status').textContent = `현재 호칭은 「${jarvisAddress}」입니다.`;
    if (showingResult && currentResult) say(resultSpeech(currentResult.job, currentResult.text, jarvisAddress));
  } catch (error) {
    $('address-status').textContent = `호칭을 확인하지 못했습니다. ${error.message}`;
  } finally { settingsBusy = false; setSettingsAvailability(); }
}

$('address-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!lastState || settingsBusy || !settingsReady) return;
  let address;
  try { address = normalizeJarvisAddress($('jarvis-address').value); }
  catch (error) { $('address-status').textContent = error.message; $('jarvis-address').focus(); return; }
  if (pendingAddressWrite?.address !== address) pendingAddressWrite = {requestId:crypto.randomUUID(), address};
  settingsBusy = true;
  setSettingsAvailability();
  $('address-status').textContent = '호칭을 저장하고 있습니다.';
  try {
    const saved = await api('/api/jarvis/settings', pendingAddressWrite);
    jarvisAddress = normalizeJarvisAddress(saved.address);
    $('jarvis-address').value = jarvisAddress;
    pendingAddressWrite = null;
    $('address-status').textContent = `앞으로 「${jarvisAddress}」으로 모시겠습니다.`;
    if (showingResult && currentResult) say(resultSpeech(currentResult.job, currentResult.text, jarvisAddress));
    await tick();
  } catch (error) { $('address-status').textContent = `호칭 저장을 확인하지 못했습니다. ${error.message}`; }
  finally { settingsBusy = false; setSettingsAvailability(); }
});

function renderHungerHistory(measured) {
  const {samples, missingCount, drives} = hungerCurveModel(measured);
  const svg = $('hunger-chart'), legend = $('hunger-legend');
  svg.replaceChildren(); legend.replaceChildren();
  svg.toggleAttribute('hidden', samples.length === 0);
  svg.dataset.sampleCount = String(samples.length);
  $('hunger-data').hidden = samples.length === 0;
  $('hunger-table-head').replaceChildren();
  $('hunger-table-body').replaceChildren();
  if (!measured) { $('hunger-summary').textContent = '배고픔 기록을 확인하지 못했습니다. 다시 연결을 확인하겠습니다.'; return; }
  const time = at => new Date(at).toLocaleTimeString('ko-KR', {hour12:false});
  $('hunger-summary').textContent = samples.length
    ? `저장된 결정 ${samples.length}회 · 배고픔 0–100 · ${time(samples[0].at)}–${time(samples.at(-1).at)}${missingCount ? ` · 값이 없는 이전 기록 ${missingCount}회는 표시하지 않습니다.` : ''}`
    : '저장된 배고픔 변화 기록이 없습니다. 첫 기록부터 곡선을 표시하겠습니다.';
  for (const drive of drives) {
    const row = document.createElement('li');
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    mark.setAttribute('viewBox', '0 0 16 8');mark.setAttribute('aria-hidden', 'true');
    const stroke = document.createElementNS(mark.namespaceURI, 'path');
    stroke.setAttribute('d', 'M0 4H16');stroke.setAttribute('stroke', DRIVE_COLOR[drive.driveId]);stroke.setAttribute('stroke-width', '2');mark.append(stroke);
    const label = document.createElement('span');label.textContent = `${drive.label}${drive.worldName ? ` — ${drive.worldName}의 영토` : ''}`;
    const value = document.createElement('strong');value.textContent = drive.current === null ? '확인 전' : String(drive.current);value.setAttribute('aria-label', `현재 배고픔 ${value.textContent}`);
    row.append(mark,label,value);const f=measured.fulfillment?.[drive.driveId];if(f){const note=document.createElement('span');note.className='drive-fulfillment';const counts=document.createElement('span');counts.textContent=`시도 ${f.attempts} · 충족 ${f.fulfilled} · 미충족 ${f.unfulfilled} · 미확인 ${f.unknown} · 검토 대기 ${measured.cues?.[drive.driveId]??0}건${f.stuck?' · 막힘':''}`;const last=document.createElement('span');last.textContent=`마지막: ${({fulfilled:'충족',unfulfilled:'미충족',unknown:'미확인'})[f.lastOutcome]??'없음'} · 작업 `;const id=document.createElement('code');id.textContent=f.lastJobId??'없음';last.append(id);note.append(counts,last);row.append(note);}legend.append(row);
  }
  if (!samples.length) return;
  const headingRow = document.createElement('tr');
  for (const label of ['결정 시각', ...drives.map(drive => drive.label)]) {
    const heading = document.createElement('th');heading.scope = 'col';heading.textContent = label;headingRow.append(heading);
  }
  $('hunger-table-head').append(headingRow);
  for (const sample of samples) {
    const row = document.createElement('tr');
    const heading = document.createElement('th');heading.scope = 'row';
    const timestamp = document.createElement('time');timestamp.dateTime = sample.at;timestamp.textContent = new Date(sample.at).toLocaleString('ko-KR', {hour12:false});heading.append(timestamp);row.append(heading);
    for (const drive of drives) { const cell = document.createElement('td');cell.textContent = String(sample.hunger[drive.driveId]);row.append(cell); }
    $('hunger-table-body').append(row);
  }
  const append = (tag, attributes, text) => {
    const element = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    if (text !== undefined) element.textContent = text;
    svg.append(element);return element;
  };
  for (const value of [0,50,100]) {
    const y = 160 - value * 1.48;
    append('path', {d:`M28 ${y}H308`, class:'hunger-grid'});
    append('text', {x:22,y:y + 4,'text-anchor':'end',class:'hunger-axis'}, String(value));
  }
  const firstTime = Math.min(...samples.map(sample=>sample.time)), lastTime = Math.max(...samples.map(sample=>sample.time));
  const x = sample => lastTime === firstTime ? 168 : 28 + (sample.time - firstTime) / (lastTime - firstTime) * 280;
  for (const drive of drives) {
    let previousIndex = -2;
    const path = samples.map(sample => {
      const operation = sample.index === previousIndex + 1 ? 'L' : 'M';
      previousIndex = sample.index;
      return `${operation}${x(sample)} ${160 - sample.hunger[drive.driveId] * 1.48}`;
    }).join(' ');
    append('path', {d:path,fill:'none',stroke:DRIVE_COLOR[drive.driveId],'stroke-width':2,'data-drive-id':drive.driveId});
    for (const sample of samples) append('circle', {cx:x(sample),cy:160 - sample.hunger[drive.driveId] * 1.48,r:2,fill:DRIVE_COLOR[drive.driveId]});
  }
}

function setControlsState(st) {
  lastState = st;
  setSettingsAvailability();
  const core = st.core || {}, automatic = Boolean(st.autopilot?.enabled);
  $('will-state').textContent = st.emergencyStop ? '전체 멈춤' : automatic ? '허가된 범위에서 자동 운영' : '소유자 요청 대기';
  $('life-state').textContent = core.lastHeartbeatAt ? `마지막 박동 ${new Date(core.lastHeartbeatAt).toLocaleTimeString('ko-KR',{hour12:false})}` : '박동 기록 없음';
  $('authority-state').textContent = core.pendingApprovalCount ? `${core.pendingApprovalCount}건 승인 대기` : '소유자 승인 경계 유지';
  const expiresAt=Date.parse(session?.metadata?.expiresAt??'');
  const remaining=Number.isFinite(expiresAt)?Math.max(0,Math.ceil((expiresAt-Date.now())/86400000)):null;
  $('session-expiry').textContent=remaining===null?'이 기기 연결 기간 —':`이 기기 연결 D-${remaining}일`;
  $('session-expiry').classList.toggle('expiring',remaining!==null&&remaining<=3);
  const auto = $('autopilot-toggle'), emergency = $('emergency-toggle');
  auto.textContent = automatic ? '자동 운영 멈추기' : '자동 운영 시작';
  auto.disabled = controlBusy || st.emergencyStop;
  emergency.textContent = st.emergencyStop ? '전체 멈춤 해제' : stopPending ? '전체 정지 확인' : '전체 멈춤';
  emergency.dataset.stopped = String(Boolean(st.emergencyStop));
  emergency.disabled = controlBusy;
  const equipped=st.kirby?.abilities?.find(a=>a.id===st.kirby.currentAbilityId);$('kirby-hat').hidden=!equipped;$('kirby-hat').textContent=equipped?`커비: ${equipped.hat.glyph} ${equipped.name}`:'';
  const roster = st.shadowArmy?.roster;
  const members = Array.isArray(roster?.members) ? roster.members : [];
  $('shadow-count').textContent = `${roster?.total ?? 0}명`;
  $('shadow-empty').hidden = members.length > 0;
  const shadowList = $('shadow-roster-list');shadowList.replaceChildren();
  for(const member of members){
    const row=document.createElement('li');
    const label=document.createElement('button');label.type='button';label.textContent=member.name;
    label.addEventListener('click',()=>{const missionJobs=(st.jobs??[]).filter(job=>job.shadowAssignment?.missionId===member.missionId);const lines=missionJobs.map(job=>`${job.title??job.id} · ${JOB_KO[job.status]??job.status}`);renderArtifactDocument($('result-body'),`# ${member.name}의 임무\n\n${lines.length?lines.join('\n\n'):'현재 임무 기록을 확인할 수 없습니다.'}`);$('result-dialog').showModal();$('result-close').focus();});
    const grade=document.createElement('small');grade.textContent=`${member.rankTitle??member.rank}(${member.rank})${member.status==='stored'?' · 보관':''}`;grade.setAttribute('aria-label',`등급 ${member.rank}`);
    const settings=document.createElement('button');settings.type='button';settings.className='shadow-profile-open';settings.textContent='실행 설정';settings.disabled=member.status==='stored';settings.addEventListener('click',()=>void openShadowProfile(member));
    row.append(label,grade,settings);shadowList.append(row);
  }
  const notices = Array.isArray(st.systemNotices) ? st.systemNotices.filter(notice=>typeof notice === 'string' && notice.trim()).slice(-5) : [];
  const noticeList = $('system-notices');noticeList.replaceChildren();noticeList.parentElement.hidden = notices.length === 0;
  for (const notice of notices) { const item = document.createElement('li');item.textContent = notice;noticeList.append(item); }
  const moments=sceneMoments(st.systemNotices);
  $('scene-moments').hidden=moments.length===0;
  const momentList=$('scene-moment-list');momentList.replaceChildren();
  for(const moment of moments){const item=document.createElement('li');const label=document.createElement('strong');label.textContent=moment.label;const description=document.createElement('span');description.textContent=moment.text;item.append(label,description);momentList.append(item);}
  const list = $('control-job-list'); list.replaceChildren();
  const jobs = (st.jobs || []).slice(0,5);
  if (!jobs.length) { list.textContent = '아직 작업이 없습니다.'; return; }
  for (const job of jobs) {
    const row = document.createElement('div'); row.className = 'control-job';
    const info = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = job.title || '제목 없는 작업';
    const preferred=job.shadowAssignment?.preferredShadowName;
    const meta = document.createElement('small'); meta.textContent = `${JOB_KO[job.status] || job.status} · ${new Date(job.updatedAt).toLocaleString('ko-KR')}${preferred ? ` · ${preferred}의 출전을 보고드립니다.` : ''}`;
    info.append(title, meta); row.append(info);
    if (['running','queued','paused'].includes(job.status)) {
      const action = document.createElement('button');
      action.type = 'button'; action.textContent = job.status === 'paused' ? '재개' : '일시정지';
      action.disabled = controlBusy || (job.status === 'paused' && st.emergencyStop);
      action.addEventListener('click', () => void performControl(`/api/jobs/${job.id}/action`, {requestId:crypto.randomUUID(),action:job.status === 'paused' ? 'resume' : 'pause',revision:job.version}));
      row.append(action);
    }
    list.append(row);
  }
}
async function performControl(path, body) {
  if (controlBusy || !lastState) return;
  controlBusy = true; $('control-error').textContent = '';
  setControlsState(lastState);
  try { await api(path, body); await tick(); }
  catch (error) { $('control-error').textContent = `변경하지 못했습니다. ${error.message}`; }
  finally { controlBusy = false; if (lastState) setControlsState(lastState); }
}
$('autopilot-toggle').addEventListener('click', () => {
  if (!lastState) return;
  void performControl('/api/autopilot',{requestId:crypto.randomUUID(),enabled:!Boolean(lastState.autopilot?.enabled)});
});
$('emergency-toggle').addEventListener('click', () => {
  if (!lastState) return;
  if(!lastState.emergencyStop&&!stopPending){stopPending=true;$('stop-confirm').hidden=false;setControlsState(lastState);return;}
  stopPending=false;$('stop-confirm').hidden=true;
  void performControl('/api/control',{requestId:crypto.randomUUID(),action:lastState.emergencyStop?'resume':'stop',revision:lastState.revision});
});
$('stop-cancel').addEventListener('click',()=>{stopPending=false;$('stop-confirm').hidden=true;if(lastState)setControlsState(lastState);});

async function tick() {
  let st;
  try { st = await api('/api/state'); }
  catch (e) { scene.online = false; headerOrb.set('still'); firstResultTick = true; showingResult = false; currentResult = null; failureDetails = ''; speechHoldUntil = 0; clearResultLink(); showDebate(null); $('dot').classList.add('off'); $('mode').textContent = '본체 연결 끊김'; say('본체와 연결이 끊겼습니다. 복구되면 바로 보고드리겠습니다.'); doing('다시 연결을 확인하고 있습니다.'); setControlsUnavailable(); return; }
  scene.online = true;
  $('dot').classList.remove('off');
  const rawCore = st.core || {};
  const core = rawCore.pendingApprovalCount>0 && rawCore.activity==='idle' ? {...rawCore,activity:'waiting_owner'} : rawCore;
  scene.core = core;
  headerOrb.set(smallOrbState({online:true,emergencyStop:st.emergencyStop,core,jobs:st.jobs}));
  const measured = await api('/api/drives/status').catch(() => null);
  renderHungerHistory(measured);
  scene.drives = Array.isArray(measured?.drives) ? measured.drives : [];
  $('mode').textContent = ACTIVITY_KO[core.activity] || '상태 확인 중';
  target = measuredDriveTint(scene.drives,core.dominantDriveId,neutralTint);
  if (heartbeatChanged(lastHeartbeat,core.lastHeartbeatAt)) pulseAt = performance.now();
  lastHeartbeat = core.lastHeartbeatAt || null;
  $('hb').textContent = core.lastHeartbeatAt ? new Date(core.lastHeartbeatAt).toLocaleTimeString('ko-KR', {hour12:false}) : '기록 없음';

  // model badge — honest about what is actually wired
  const ag = st.agent || {};
  const lastSpoken=(st.jobs||[]).find(job=>spokenJobs.has(job.id)&&job.provider&&job.model);
  if (lastSpoken || (ag.configured && ag.model)) { $('model').textContent = lastSpoken?`${lastSpoken.provider} · ${lastSpoken.model}`:`${ag.provider} · ${ag.model}`; hint(''); }
  else { $('model').textContent = '모델 연결 안 됨'; hint('이 PC의 BLACKHOLE 연결 창에서 로컬 모델을 선택하면 실행할 수 있습니다. 모델이 없는 동안 요청은 목표로 보관됩니다.'); }

  // gate
  const pending = core.pendingApprovalCount | 0;
  $('gate').hidden = pending === 0;
  if (pending) {
    const overview=await api('/api/quests').catch(()=>null);
    const oldest=(overview?.quests||[]).filter(quest=>quest.status==='proposed'&&quest.synthesis?.approvalRequired===true).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt))[0];
    $('gate-text').textContent = `${jarvisAddress}, 작업 ${pending}건이 승인을 기다리고 있습니다.${oldest?.goal?'\n'+oldest.goal:''}`;
  }
  setControlsState(st);
  if (!settingsReady && !settingsBusy) await loadJarvisSettings();

  // doing line: real activity + shadows + last event
  const parts = [];
  if (core.focusProjectName) parts.push(core.focusProjectName);
  if (core.activeShadowCount) parts.push(`그림자 ${core.activeShadowCount}명이 실행 중입니다.`);
  if (Date.now() >= speechHoldUntil) failureDetails = '';
  doing(failureDetails || parts.join(' · '));

  // speech: prefer a fresh result from a real job; otherwise speak from core
  const jobs = st.jobs || [];
  const fresh = resultJobToShow(jobs,spokenJobs,firstResultTick);
  const failed = failureJobToShow(jobs,spokenJobs,firstResultTick);
  if (firstResultTick) {
    firstResultTick = false;
    for (const job of jobs) if (job.status==='completed' && job.artifacts?.length) spokenJobs.add(job.id);
    try { localStorage.setItem('jarvis-spoken-v1',JSON.stringify([...spokenJobs].slice(-200))); } catch (e) {}
  }
  if (failed) {
    showFailureReport(failed);
    if (awaitingJobId === failed.id) { awaitingJobId = null; setBusy(false); }
    return;
  }
  if (fresh && !failureDetails) {
    const text = await artifactText(fresh.artifacts[0].id).catch(() => null);
    if (text) { rememberSpoken(fresh.id); showingResult = true; currentResult = {job:fresh,text}; showDebate(null); showResultLink(fresh.artifacts[0].id); void showResultRating(fresh); say(resultSpeech(fresh,text,jarvisAddress)); if (awaitingJobId === fresh.id) { awaitingJobId = null; setBusy(false); } return; }
  }
  if (awaitingJobId) {
    showDebate(null);
    const j = jobs.find(x => x.id === awaitingJobId);
    if (spokenJobs.has(awaitingJobId)) { awaitingJobId = null; setBusy(false); return; }
    if (j && ['failed','cancelled','stopped'].includes(j.status)) { showFailureReport(j); awaitingJobId = null; setBusy(false); }
    else if (!failureDetails) doing(`${j?.title||'작업'} · 분석 중 · ${j?.provider||'경로 선택 중'}`);
    return;
  }
  const canSpeakIdle = !showingResult && Date.now() >= speechHoldUntil && !st.emergencyStop && core.activity === 'idle';
  showDebate(canSpeakIdle ? idleDriveSpeech(core,measured) : null);
  if (!showingResult && Date.now() >= speechHoldUntil) {
    const speech = canSpeakIdle ? anticipationSpeech(core,measured,st,jarvisAddress) : null;
    say(speech || (core.activity === 'idle' && !ag.configured ? `${jarvisAddress}, 응답할 모델이 연결되지 않았습니다. 이 PC의 BLACKHOLE 연결 창에서 모델을 선택해 주십시오.` : composeFromCore(core,jarvisAddress)));
  }
}

$('ask').addEventListener('submit', async e => {
  e.preventDefault();
  const t = $('in').value.trim(); if (!t || busy) return;
  $('in').value = '';
  const text = workCommandText(t);
  const chat = conversationMode;
  setBusy(true); speechHoldUntil = 0; failureDetails = ''; showingResult = false; currentResult = null; clearResultLink(); showDebate(null); say('요청을 확인하고 있습니다.');
  try {
    const out = await api(chat ? '/api/voice' : '/api/commands', {requestId: crypto.randomUUID(), text: chat ? t : text, ...(chat ? {chatOnly:true} : {})});
    const job = out.job || out.payload?.job;
    if (job?.id) { awaitingJobId = job.id; doing(`${job.title || '작업'} · 접수했습니다.`); }
    else { setBusy(false); say(`접수했습니다, ${jarvisAddress}.`); }
  } catch (err) {
    setBusy(false);
    if (err.status === 409 && /모델|AI/i.test(err.message)) {
      if (chat) { speechHoldUntil = Date.now()+30000; say('현재 대화 기능을 사용할 수 없습니다. 모델 연결과 AI 사용 설정을 확인해 주십시오. 이 대화는 목표로 보관하지 않았습니다.'); return; }
      try {
        await api('/api/commands', {requestId: crypto.randomUUID(), text: `목표 저장: ${t}`});
        const localOnly=lastState?.agent?.providers?.some(entry=>entry.provider==='local'&&entry.configured)
          && !lastState?.agent?.routing?.routes?.goal?.some(name=>lastState.agent.providers.some(entry=>entry.provider===name&&entry.configured));
        speechHoldUntil = Date.now()+30000;
        say(localOnly?'작업용 모델이 없습니다. 요청은 목표로 보관했습니다.':'연결된 모델이 없습니다. 요청은 목표로 보관했습니다.');
        doing(localOnly?'작업용 원격 모델 연결 후 운영실에서 실행하실 수 있습니다.':'모델 연결 후 운영실에서 실행하실 수 있습니다.');
      }
      catch (saveError) { speechHoldUntil = Date.now()+30000; say('모델이 없으며 요청도 보관하지 못했습니다. 다시 보내기 전에 운영실에서 접수 여부를 확인해 주십시오. 숨기지 않겠습니다.'); doing(saveError.message); }
    }
    else { speechHoldUntil = Date.now()+30000; say(`요청을 완료하지 못했습니다. 서버 보고: 「${err.message}」. 숨기지 않겠습니다.`); }
  }
});

startJarvisOrb(scene,()=>target,()=>pulseAt);

session = await connectBrowser();
$('pair-screen').hidden = true;
await loadJarvisSettings();
await tick();
let polling = false;
setInterval(async () => {
  if (document.hidden || polling) return;
  polling = true;
  try { await tick(); } finally { polling = false; }
}, POLL_MS);
