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
import {measuredDriveTint,heartbeatChanged,composeFromCore} from './jarvis-scene-model.mjs';
const tokens = getComputedStyle(document.documentElement);
const color = name => tokens.getPropertyValue(`--j-${name}`).trim();
const palette = Object.fromEntries(['bg','focus','offline','bg-rgb','field-rgb','muted-rgb','ink-rgb','warn-rgb','core-line-rgb','star-rgb','satellite-rgb','core-light-rgb','core-shadow-rgb','core-night-rgb'].map(name=>[name.replaceAll('-',''),color(name)]));

const $ = id => document.getElementById(id);
const ACTIVITY_KO = {idle:'쉬는 중',planning:'생각 중',executing:'일하는 중',verifying:'확인 중',waiting_owner:'네 결정 기다리는 중',paused:'멈춤',stopped:'멈춤'};
const JOB_KO = {running:'실행 중',queued:'대기 중',paused:'일시정지',completed:'완료',failed:'실패',cancelled:'취소',stopped:'중단'};
const POLL_MS = 3000;
const commandMode = $('command-mode');
let conversationMode = false;
commandMode.addEventListener('click',()=>{
  conversationMode = !conversationMode;
  commandMode.textContent = conversationMode ? '대화' : '작업';
  commandMode.setAttribute('aria-pressed',String(conversationMode));
  commandMode.setAttribute('aria-label',conversationMode ? '작업 모드로 전환' : '대화 모드로 전환');
  $('in').placeholder = conversationMode ? '무엇이 궁금해?' : '무엇을 함께 해볼까?';
  $('in').focus();
});

const lineEl = $('line');
let sayVersion = 0;
function say(text) {
  if (!text || lineEl.textContent === text) return;
  const version = ++sayVersion;
  lineEl.classList.add('fade');
  setTimeout(() => { if (version !== sayVersion) return; lineEl.textContent = text; lineEl.classList.remove('fade'); }, 160);
}
const doing = t => { $('doing').textContent = t || ''; };
const hint = html => { const h = $('hint'); h.hidden = !html; h.innerHTML = html || ''; };

let session, target = palette.focus, pulseAt = 0, busy = false, lastHeartbeat = null, spokenJobs = new Set(), awaitingJobId = null, lastRevision = null, speechHoldUntil = 0;
const scene = {core:{},drives:[],online:false};
try { spokenJobs = new Set(JSON.parse(localStorage.getItem('jarvis-spoken-v1') || '[]')); } catch (e) {}
const rememberSpoken = id => { spokenJobs.add(id); try { localStorage.setItem('jarvis-spoken-v1', JSON.stringify([...spokenJobs].slice(-200))); } catch (e) {} };

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
const controls = $('controls'), controlToggle = $('control-toggle');
function showControls(open) {
  controls.hidden = !open;
  controlToggle.setAttribute('aria-expanded', String(open));
  if (open) $('control-close').focus();
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
}
function setControlsState(st) {
  lastState = st;
  const core = st.core || {}, automatic = Boolean(st.autopilot?.enabled);
  $('will-state').textContent = st.emergencyStop ? '전체 멈춤' : automatic ? '허가된 범위에서 자동 운영' : '소유자 요청 대기';
  $('life-state').textContent = core.lastHeartbeatAt ? `마지막 박동 ${new Date(core.lastHeartbeatAt).toLocaleTimeString('ko-KR',{hour12:false})}` : '박동 기록 없음';
  $('authority-state').textContent = core.pendingApprovalCount ? `${core.pendingApprovalCount}건 승인 대기` : '소유자 승인 경계 유지';
  const auto = $('autopilot-toggle'), emergency = $('emergency-toggle');
  auto.textContent = automatic ? '자동 운영 멈추기' : '자동 운영 시작';
  auto.disabled = controlBusy || st.emergencyStop;
  emergency.textContent = st.emergencyStop ? '전체 멈춤 해제' : '전체 멈춤';
  emergency.dataset.stopped = String(Boolean(st.emergencyStop));
  emergency.disabled = controlBusy;
  const list = $('control-job-list'); list.replaceChildren();
  const jobs = (st.jobs || []).slice(-5).reverse();
  if (!jobs.length) { list.textContent = '아직 작업이 없습니다.'; return; }
  for (const job of jobs) {
    const row = document.createElement('div'); row.className = 'control-job';
    const info = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = job.title || '제목 없는 작업';
    const meta = document.createElement('small'); meta.textContent = `${JOB_KO[job.status] || job.status} · ${new Date(job.updatedAt).toLocaleString('ko-KR')}`;
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
  void performControl('/api/control',{requestId:crypto.randomUUID(),action:lastState.emergencyStop?'resume':'stop',revision:lastState.revision});
});

async function tick() {
  let st;
  try { st = await api('/api/state'); }
  catch (e) { scene.online = false; $('dot').classList.add('off'); $('mode').textContent = '본체와 끊김'; doing(e.message); setControlsUnavailable(); return; }
  scene.online = true;
  $('dot').classList.remove('off');
  const core = st.core || {};
  scene.core = core;
  const measured = await api('/api/drives/status').catch(() => null);
  scene.drives = Array.isArray(measured?.drives) ? measured.drives : [];
  $('mode').textContent = ACTIVITY_KO[core.activity] || core.activity || '깨어 있음';
  target = measuredDriveTint(scene.drives,core.dominantDriveId,palette.focus);
  if (heartbeatChanged(lastHeartbeat,core.lastHeartbeatAt)) pulseAt = performance.now();
  lastHeartbeat = core.lastHeartbeatAt || null;
  $('hb').textContent = core.lastHeartbeatAt ? new Date(core.lastHeartbeatAt).toLocaleTimeString('ko-KR', {hour12:false}) : '아직 안 뜀';

  // model badge — honest about what is actually wired
  const ag = st.agent || {};
  if (ag.configured && ag.model) { $('model').textContent = `${ag.provider ? ag.provider + ' · ' : ''}${ag.model}`; hint(''); }
  else { $('model').textContent = '모델 연결 안 됨'; hint('이 PC의 BLACKHOLE 연결 창에서 로컬 모델을 선택하면 실행할 수 있습니다. 모델이 없는 동안 요청은 목표로 보관됩니다.'); }

  // gate
  const pending = core.pendingApprovalCount | 0;
  $('gate').hidden = pending === 0;
  if (pending) $('gate-text').textContent = `되돌릴 수 없는 일 ${pending}건이 네 승인을 기다려.`;
  setControlsState(st);

  // doing line: real activity + shadows + last event
  const parts = [];
  if (core.focusProjectName) parts.push(core.focusProjectName);
  if (core.activeShadowCount) parts.push(`그림자 ${core.activeShadowCount}명 일하는 중`);
  doing(parts.join(' · '));

  // speech: prefer a fresh result from a real job; otherwise speak from core
  const jobs = st.jobs || [];
  const fresh = jobs.find(j => j.artifacts?.length && !['running','queued','paused'].includes(j.status) && !spokenJobs.has(j.id));
  if (fresh) {
    const text = await artifactText(fresh.artifacts[0].id).catch(() => null);
    if (text) { rememberSpoken(fresh.id); say(text.length > 420 ? text.slice(0, 420) + '…' : text); if (awaitingJobId === fresh.id) { awaitingJobId = null; busy = false; $('send').disabled = false; } return; }
  }
  if (awaitingJobId) {
    const j = jobs.find(x => x.id === awaitingJobId);
    if (spokenJobs.has(awaitingJobId)) { awaitingJobId = null; busy = false; $('send').disabled = false; return; }
    if (j && ['failed','cancelled','stopped'].includes(j.status)) { say(`그 일은 못 끝냈어. ${j.error || j.status}. 숨기지 않을게.`); awaitingJobId = null; busy = false; $('send').disabled = false; }
    else doing((j?.title ? j.title + ' · ' : '') + '생각하는 중…');
    return;
  }
  if (Date.now() >= speechHoldUntil && (st.revision !== lastRevision || !lineEl.textContent || lineEl.textContent === '…')) { lastRevision = st.revision; say(composeFromCore(core)); }
}

$('ask').addEventListener('submit', async e => {
  e.preventDefault();
  const t = $('in').value.trim(); if (!t || busy) return;
  $('in').value = '';
  // known 운영실 commands pass through untouched; anything else becomes a real quest
  const passthrough = /^(자동\s*운영\s*(시작|중지|현황)|목표\s*현황|일곱\s*욕망|성과\s*장부|봇\s*현황|세계\s*현황|목표\s*(저장|실행)\s*[:：]|연구\s*[:：]|교차\s*검토\s*[:：])/.test(t);
  const text = passthrough ? t : `목표: ${t}`;
  const chat = conversationMode;
  busy = true; speechHoldUntil = 0; $('send').disabled = true; say('…');
  try {
    const out = await api(chat ? '/api/voice' : '/api/commands', {requestId: crypto.randomUUID(), text: chat ? t : text, ...(chat ? {chatOnly:true} : {})});
    const job = out.job || out.payload?.job;
    if (job?.id) { awaitingJobId = job.id; doing(`${job.title || '작업'} · 받았어`); }
    else { busy = false; $('send').disabled = false; say('받았어.'); }
  } catch (err) {
    busy = false; $('send').disabled = false;
    if (err.status === 409 && /모델|AI/i.test(err.message)) {
      if (chat) { speechHoldUntil = Date.now()+30000; say('지금은 대화 기능을 사용할 수 없어. 모델 연결과 AI 사용 설정을 확인해줘. 이 대화는 목표로 보관하지 않았어.'); return; }
      try { await api('/api/commands', {requestId: crypto.randomUUID(), text: `목표 저장: ${t}`}); speechHoldUntil = Date.now()+30000; say('모델이 없어 지금 실행하지는 못해. 요청은 목표로 보관했어.'); doing('모델 연결 후 운영실에서 실행할 수 있어.'); }
      catch (saveError) { speechHoldUntil = Date.now()+30000; say('모델이 없고 요청도 보관하지 못했어. 같은 내용을 다시 보내기 전에 운영실에서 접수 여부를 확인해줘.'); doing(saveError.message); }
    }
    else say(err.message);
  }
});

const cv = $('orb'), ctx = cv.getContext('2d', {alpha:false});
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const hex = h => ({r:parseInt(h.slice(1,3),16),g:parseInt(h.slice(3,5),16),b:parseInt(h.slice(5,7),16)});
let c = hex(palette.focus), viewW = 0, viewH = 0, pixelRatio = 1, lastFrame = 0, pointerX = 0, pointerY = 0;
function resizeScene() {
  const rect = cv.getBoundingClientRect();
  viewW = Math.max(1,rect.width); viewH = Math.max(1,rect.height);
  pixelRatio = Math.min(devicePixelRatio || 1,2);
  cv.width = Math.round(viewW * pixelRatio); cv.height = Math.round(viewH * pixelRatio);
}
window.addEventListener('resize', resizeScene, {passive:true});
window.addEventListener('pointermove', event => {
  if (motion.matches) return;
  pointerX = event.clientX / Math.max(1,viewW) - .5;
  pointerY = event.clientY / Math.max(1,viewH) - .5;
}, {passive:true});
resizeScene();
const TAU = Math.PI * 2;
function ring(x,y,r,color,width=1,start=0,end=TAU,dash=[]) {
  ctx.beginPath(); ctx.lineWidth=width; ctx.strokeStyle=color; ctx.setLineDash(dash); ctx.arc(x,y,r,start,end); ctx.stroke(); ctx.setLineDash([]);
}
function draw(t) {
  requestAnimationFrame(draw);
  if (document.hidden || t-lastFrame<33) return;
  lastFrame=t;
  const W=viewW,H=viewH,still=motion.matches,px=still?0:pointerX,py=still?0:pointerY;
  const x=W*.5+px*12,y=H*.35+py*10;
  const base=Math.min(W*(W<640?.24:.15),H*.22,175);
  const breath=still?1:1+Math.sin(t/1750)*.04;
  const R=base*breath, online=scene.online;
  const chosen=hex(online?target:palette.offline);
  for(const channel of ['r','g','b']) c[channel]+=(chosen[channel]-c[channel])*.035;
  const cs=`${c.r|0},${c.g|0},${c.b|0}`;
  ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);
  ctx.fillStyle=palette.bg; ctx.fillRect(0,0,W,H);
  const field=ctx.createRadialGradient(x,y,R*.1,x,y,Math.max(W,H)*.68);
  field.addColorStop(0,`rgba(${cs},.14)`);field.addColorStop(.28,`rgba(${palette.fieldrgb},.57)`);field.addColorStop(1,`rgba(${palette.bgrgb},0)`);
  ctx.fillStyle=field;ctx.fillRect(0,0,W,H);
  for(let i=1;i<=8;i++) ring(x,y,R*(1.9+i*.52),`rgba(${palette.mutedrgb},.027)`,1);
  for(let i=0;i<32;i++) {
    const a=i*TAU/32;ctx.beginPath();ctx.moveTo(x+Math.cos(a)*R*1.75,y+Math.sin(a)*R*1.75);
    ctx.lineTo(x+Math.cos(a)*Math.max(W,H),y+Math.sin(a)*Math.max(W,H));
    ctx.strokeStyle=`rgba(${palette.mutedrgb},.018)`;ctx.lineWidth=1;ctx.stroke();
  }
  for(let i=0;i<86;i++) {
    const u=((i*37.37)%101)/101,v=((i*71.13)%103)/103;
    const dx=(u-.5)*W,dy=(v-.5)*H,near=1-Math.min(1,Math.hypot(dx,dy)/Math.max(W,H));
    ctx.fillStyle=`rgba(${palette.starrgb},${.035+near*.09})`;
    ctx.beginPath();ctx.arc(u*W+px*(i%3+1)*4,v*H+py*(i%4+1)*4,.35+near*.65,0,TAU);ctx.fill();
  }
  const halo=ctx.createRadialGradient(x,y,R*.28,x,y,R*1.9);
  halo.addColorStop(0,`rgba(${cs},.19)`);halo.addColorStop(.55,`rgba(${cs},.09)`);halo.addColorStop(1,`rgba(${cs},0)`);
  ctx.fillStyle=halo;ctx.beginPath();ctx.arc(x,y,R*1.9,0,TAU);ctx.fill();
  ring(x,y,R*1.06,`rgba(${cs},.3)`,1.2);
  ring(x,y,R*1.23,`rgba(${palette.corelinergb},.22)`,1);
  ring(x,y,R*1.39,`rgba(${palette.corelinergb},.1)`,1);
  ring(x,y,R*1.68,`rgba(${palette.corelinergb},.11)`,1);
  for(let i=0;i<56;i++) {
    const a=i*TAU/56,outer=R*(i%7===0?1.77:1.73),inner=R*1.69;
    ctx.beginPath();ctx.moveTo(x+Math.cos(a)*inner,y+Math.sin(a)*inner);
    ctx.lineTo(x+Math.cos(a)*outer,y+Math.sin(a)*outer);
    ctx.strokeStyle=`rgba(${palette.corelinergb},.16)`;ctx.lineWidth=1;ctx.stroke();
  }
  if(scene.core.pendingApprovalCount>0) ring(x,y,R*1.82,`rgba(${palette.warnrgb},.8)`,2,0,TAU,[4,8]);
  const count=Math.max(0,Math.floor(scene.core.activeShadowCount||0));
  for(let i=0;i<count;i++) {
    const a=(still?0:t/(scene.core.activity==='executing'?1800:3900))+i*TAU/count;
    const sx=x+Math.cos(a)*R*2.01,sy=y+Math.sin(a)*R*2.01;
    ctx.fillStyle=`rgba(${palette.satellitergb},.8)`;ctx.beginPath();ctx.arc(sx,sy,Math.max(2,R*.025),0,TAU);ctx.fill();
  }
  if(scene.core.activity==='planning' && !still) ring(x,y,R*.87,`rgba(${palette.inkrgb},.52)`,2,t/2300,t/2300+1.1);
  const core=ctx.createRadialGradient(x-R*.28,y-R*.32,R*.02,x,y,R);
  core.addColorStop(0,`rgba(${palette.corelightrgb},.96)`);core.addColorStop(.18,`rgba(${cs},.93)`);
  core.addColorStop(.53,`rgba(${cs},.38)`);core.addColorStop(.87,`rgba(${palette.coreshadowrgb},.88)`);core.addColorStop(1,`rgba(${palette.corenightrgb},.98)`);
  ctx.fillStyle=core;ctx.beginPath();ctx.arc(x,y,R,0,TAU);ctx.fill();
  ring(x,y,R*.81,`rgba(${palette.inkrgb},.14)`,1);
  ring(x,y,R*.64,`rgba(${cs},.19)`,1);
  const elapsed=t-pulseAt;
  if(online&&!still&&pulseAt>0&&elapsed>=0&&elapsed<1100) {
    const k=elapsed/1100;
    ring(x,y,R*(1.05+k*1.3),`rgba(${cs},${(1-k)*.56})`,2.2*(1-k));
  }
}
requestAnimationFrame(draw);

session = await connectBrowser();
$('pair-screen').hidden = true;
await tick();
let polling = false;
setInterval(async () => {
  if (document.hidden || polling) return;
  polling = true;
  try { await tick(); } finally { polling = false; }
}, POLL_MS);
