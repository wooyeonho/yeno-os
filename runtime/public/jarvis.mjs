// BLACKHOLE 자비스 — the living face over the real runtime.
//
// Nothing here is simulated: every number on screen is read from /api/state
// (coreHomeSummary: activity, dominant drive, heartbeat, shadows, pending
// approvals; agent: the configured model, e.g. Ollama via YENO_AI_BASE_URL),
// and everything typed into the box becomes a real command on /api/commands
// (`목표: …` runs a real quest through the real model router). Jarvis's own
// words come from the artifacts those jobs produce, fetched via /api/artifacts.
// Pairing reuses web-client.mjs verbatim, so this page shares the 운영실 session.
import {connectBrowser} from './web-client.mjs';

const $ = id => document.getElementById(id);
const DRIVE_COLOR = {greed:'#c98500',gluttony:'#3987e5',envy:'#199e70',pride:'#9085e9',lust:'#d55181',wrath:'#e66767',sloth:'#d95926'};
const ACTIVITY_KO = {idle:'쉬는 중',planning:'생각 중',executing:'일하는 중',verifying:'확인 중',waiting_owner:'네 결정 기다리는 중',paused:'멈춤',stopped:'멈춤'};
const POLL_MS = 3000;

const lineEl = $('line');
function say(text) {
  if (!text || lineEl.textContent === text) return;
  lineEl.classList.add('fade');
  setTimeout(() => { lineEl.textContent = text; lineEl.classList.remove('fade'); }, 160);
}
const doing = t => { $('doing').textContent = t || ''; };
const hint = html => { const h = $('hint'); h.hidden = !html; h.innerHTML = html || ''; };

let session, target = '#ff4d6d', pulseAt = 0, busy = false, lastHeartbeat = null, spokenJobs = new Set(), awaitingJobId = null, lastRevision = null;
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

function composeFromCore(core) {
  const drive = core.dominantDriveName ? `${core.dominantDriveName}(${core.dominantDriveWorldName ?? ''})` : null;
  const target = core.missionGoal || core.focusProjectName;
  if (core.activity === 'waiting_owner') return `여기서부터는 되돌릴 수 없어. 마지막은 네가 정해줘.`;
  if (drive && target) return `지금은 ${drive}이 제일 세. ${target} — 그걸 하고 있어.`;
  if (drive) return `지금은 ${drive}이 제일 세. 뭘 붙잡을지 고르는 중이야.`;
  if (core.activity === 'idle') return `조용한 박동. 그래도 나는 깨어 있어. 말 걸면 바로 움직일게.`;
  return `여기 있어.`;
}

async function tick() {
  let st;
  try { st = await api('/api/state'); }
  catch (e) { $('dot').classList.add('off'); $('mode').textContent = '본체와 끊김'; doing(e.message); return; }
  $('dot').classList.remove('off');
  const core = st.core || {};
  $('mode').textContent = ACTIVITY_KO[core.activity] || core.activity || '깨어 있음';
  target = DRIVE_COLOR[core.dominantDriveId] || '#ff4d6d';
  if (core.lastHeartbeatAt && core.lastHeartbeatAt !== lastHeartbeat) { lastHeartbeat = core.lastHeartbeatAt; pulseAt = performance.now(); }
  $('hb').textContent = core.lastHeartbeatAt ? new Date(core.lastHeartbeatAt).toLocaleTimeString('ko-KR', {hour12:false}) : '아직 안 뜀';

  // model badge — honest about what is actually wired
  const ag = st.agent || {};
  if (ag.configured && ag.model) { $('model').textContent = `${ag.provider ? ag.provider + ' · ' : ''}${ag.model}`; hint(''); }
  else { $('model').textContent = '모델 연결 안 됨'; hint('아직 말할 모델이 없어. 본체를 이렇게 켜줘: <code>YENO_AGENT_PROVIDER=local YENO_LOCAL_BASE_URL=http://127.0.0.1:11434/v1/chat/completions YENO_LOCAL_MODEL=qwen2.5:3b YENO_AGENT_DAILY_CALL_LIMIT=20</code> (Ollama). 그 전에도 상태는 보이고, 명령은 보관돼.'); }

  // gate
  const pending = core.pendingApprovalCount | 0;
  $('gate').hidden = pending === 0;
  if (pending) $('gate-text').textContent = `되돌릴 수 없는 일 ${pending}건이 네 승인을 기다려.`;

  // doing line: real activity + shadows + last event
  const parts = [];
  if (core.focusProjectName) parts.push(core.focusProjectName);
  if (core.activeShadowCount) parts.push(`그림자 ${core.activeShadowCount}명 일하는 중`);
  const ev = (st.events || [])[0];
  if (ev?.text) parts.push(ev.text);
  doing(parts.join(' · '));

  // speech: prefer a fresh result from a real job; otherwise speak from core
  const jobs = st.jobs || [];
  const fresh = jobs.find(j => j.artifacts?.length && !['running','queued','paused'].includes(j.status) && !spokenJobs.has(j.id));
  if (fresh) {
    rememberSpoken(fresh.id);
    const text = await artifactText(fresh.artifacts[0].id).catch(() => null);
    if (text) { say(text.length > 420 ? text.slice(0, 420) + '…' : text); if (awaitingJobId === fresh.id) { awaitingJobId = null; busy = false; $('send').disabled = false; } return; }
  }
  if (awaitingJobId) {
    const j = jobs.find(x => x.id === awaitingJobId);
    if (spokenJobs.has(awaitingJobId)) { awaitingJobId = null; busy = false; $('send').disabled = false; return; }
    if (j && ['failed','cancelled','stopped'].includes(j.status)) { say(`그 일은 못 끝냈어. ${j.error || j.status}. 숨기지 않을게.`); awaitingJobId = null; busy = false; $('send').disabled = false; }
    else doing((j?.title ? j.title + ' · ' : '') + '생각하는 중…');
    return;
  }
  if (st.revision !== lastRevision || !lineEl.textContent || lineEl.textContent === '…') { lastRevision = st.revision; say(composeFromCore(core)); }
}

$('ask').addEventListener('submit', async e => {
  e.preventDefault();
  const t = $('in').value.trim(); if (!t || busy) return;
  $('in').value = '';
  // known 운영실 commands pass through untouched; anything else becomes a real quest
  const passthrough = /^(자동\s*운영\s*(시작|중지|현황)|목표\s*현황|일곱\s*욕망|성과\s*장부|봇\s*현황|세계\s*현황|목표\s*(저장|실행)\s*[:：]|연구\s*[:：]|교차\s*검토\s*[:：])/.test(t);
  const text = passthrough ? t : `목표: ${t}`;
  busy = true; $('send').disabled = true; say('…');
  try {
    const out = await api('/api/commands', {requestId: crypto.randomUUID(), text});
    const job = out.job || out.payload?.job;
    if (job?.id) { awaitingJobId = job.id; doing(`${job.title || '작업'} · 받았어`); }
    else { busy = false; $('send').disabled = false; say('받았어.'); }
  } catch (err) {
    busy = false; $('send').disabled = false;
    if (err.status === 409 && /모델|AI/.test(err.message)) { say('말할 모델이 아직 안 붙어 있어. 위에 적힌 대로 본체를 켜주면 바로 대답할게.'); await api('/api/commands', {requestId: crypto.randomUUID(), text: `목표 저장: ${t}`}).then(() => doing('대신 목표로 보관해뒀어.')).catch(() => {}); }
    else say(err.message);
  }
});

// orb
const cv = $('orb'), ctx = cv.getContext('2d');
let c = {r:255,g:77,b:109};
const hex = h => ({r:parseInt(h.slice(1,3),16), g:parseInt(h.slice(3,5),16), b:parseInt(h.slice(5,7),16)});
function draw(t) {
  const W = cv.width, cx = W/2; ctx.clearRect(0,0,W,W);
  const tg = hex(target); c.r += (tg.r-c.r)*.03; c.g += (tg.g-c.g)*.03; c.b += (tg.b-c.b)*.03;
  const k = Math.max(0, 1-(t-pulseAt)/450), R = W*.24*(1+Math.sin(t/1400)*.04+k*.08), cs = `${c.r|0},${c.g|0},${c.b|0}`;
  const g = ctx.createRadialGradient(cx,cx,R*.6,cx,cx,R*2.1); g.addColorStop(0,`rgba(${cs},${.3+k*.25})`); g.addColorStop(1,'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0,0,W,W);
  if (busy) { ctx.beginPath(); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2; ctx.arc(cx,cx,R*1.3,t/300,t/300+1.2); ctx.stroke(); }
  if (!$('gate').hidden) { ctx.beginPath(); ctx.setLineDash([6,8]); ctx.strokeStyle = 'rgba(250,178,25,.8)'; ctx.lineWidth = 3; ctx.arc(cx,cx,R*1.14,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]); }
  const online = !$('dot').classList.contains('off');
  const core = ctx.createRadialGradient(cx-R*.3,cx-R*.3,R*.1,cx,cx,R); core.addColorStop(0,`rgba(255,255,255,${(online?.55:.2)+k*.3})`); core.addColorStop(.35,`rgba(${cs},${online?.95:.4})`); core.addColorStop(1,`rgba(${c.r*.35|0},${c.g*.35|0},${c.b*.35|0},1)`);
  ctx.beginPath(); ctx.fillStyle = core; ctx.arc(cx,cx,R,0,Math.PI*2); ctx.fill();
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

session = await connectBrowser();
$('pair-screen').hidden = true;
await tick();
setInterval(tick, POLL_MS);
