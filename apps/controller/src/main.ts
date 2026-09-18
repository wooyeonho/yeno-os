import '../../../runtime/public/studio.css';
import '../../../runtime/public/living-core.css';
import '../../../runtime/public/project-universe.css';
import './style.css';
import { fetch } from '@tauri-apps/plugin-http';
import { appDataDir, join } from '@tauri-apps/api/path';
import { Stronghold, type Store } from '@tauri-apps/plugin-stronghold';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, readFile } from '@tauri-apps/plugin-fs';
import { openUrl } from '@tauri-apps/plugin-opener';
import { createStudioView } from '../../../runtime/public/studio-view.mjs';
import { createWorldView } from '../../../runtime/public/world-view.mjs';
import worldLand from '../../../runtime/public/world-land.svg?url';
import { CommandSession, HttpFailure, isDefinitiveRejection, type CommandReceipt } from './command-session.ts';
import { normalizeOrigin, versionedUrl, createStudioApi, studioStorageKey, SecureRequestStorage, readVerifiedFile, saveVerifiedFile, type Connection, type VerifiedFile } from './native-studio.ts';
import { createNativeLiveVoiceView } from './native-live-voice-view.ts';
import { createLivingCoreView } from '../../../runtime/public/living-core-view.mjs';
import { createNativeHomeNavigation } from './native-home.ts';
import { createNativeProjects } from './native-projects.ts';

type Job = { id: string; title: string; status: string; version: number; updatedAt: string; artifacts: { id: string; name: string }[]; projectId?: string; pauseReason?: string };
// BLACKHOLE Living Core (Phase A): a trimmed, already-derived projection of
// the real Persistent Core record, embedded directly in GET /api/state so
// this binding needs no second network round trip. Every field here is real
// evidence-derived state from server.mjs's coreHomeSummary(), never a client
// guess - dominantDriveId/dominantDriveName are null whenever there is no
// live mission to attribute a drive to, and the UI must say so plainly.
type CoreHomeSummary = {
  activity: string; missionGoal: string | null; focusProjectName: string | null;
  dominantDriveId: string | null; dominantDriveName: string | null; dominantDriveWorldName: string | null;
  activeShadowCount: number;
  // recentArtifactResult: a completed job's attached file - real, but only
  // integrity evidence, never called "verified" (see verifiedResult).
  recentArtifactResult: { questId: string } | null;
  // verifiedResult: stays null until a durable outcome-verification verdict
  // exists in this codebase; the UI must never treat an artifact alone as
  // verified.
  verifiedResult: unknown | null;
  lastHeartbeatAt: string | null;
};
// projects/memories: the same real, already-durable records the web cockpit
// already reads (server.mjs's state() embeds the full arrays regardless of
// which client asked) - the Living Core Home reuses them for the Project
// Orbit preview and the one recent-memory item. No new endpoint, no new
// per-card request.
// UI Slice 2 (issue #25): widened from {id,name,status} to the full real
// project record - Project Universe needs version (revision-checked
// milestone mutation), nextAction, summary and milestones, all of which
// server.mjs's state() already embeds unchanged.
type Project = { id: string; name: string; status: string; version: number; summary?: string; nextAction?: string; milestones?: {id: string; text: string; completed: boolean; createdAt: string; completedAt: string | null}[] };
type State = { name: string; apiVersion: string; revision: number; emergencyStop: boolean; jobs: Job[]; world?: Record<string, unknown>; modules?: {documents?: boolean}; core?: CoreHomeSummary; projects?: Project[]; memories?: Memory[] };
type Memory = { id?: string; text: string; createdAt?: string };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const encoder = new TextEncoder(), decoder = new TextDecoder();
const vaultMarker = 'yeno.native-vault.v1';
let connection: Connection | null = null;
let state: State | null = null;
let commands: CommandSession | null = null;
let lastSeen: Date | null = null;
let connectionStatus: 'checking' | 'online' | 'unavailable' = 'checking';
let refreshing = false, submitting = false, pairing = false, disconnecting = false;
let nativeVault: { stronghold: Stronghold; store: Store } | null = null;
let vaultPassword: string | null = null;
let studio: ReturnType<typeof createStudioView> | null = null;
let studioStorage: SecureRequestStorage | null = null;
let activeView: 'studio' | 'world' | 'jobs' | 'projects' = 'studio';
let artifactFile: VerifiedFile | null = null, artifactUrl: string | null = null, artifactEpoch = 0, savingFile = false;
// Native Gemini Live: an additive path owned entirely by native-live-voice-view.ts,
// built on the exact same reused runtime/public/live-voice-client.mjs state
// machine the browser uses. It never touches typed-command submission/
// pairing/Stronghold storage above.
const liveVoiceView = createNativeLiveVoiceView($('live-voice'));
// BLACKHOLE Living Core Home (FINAL UI Slice 1 correction, issue #25): the
// exact same shared runtime/public/living-core-view.mjs the web cockpit
// uses, mounted natively - never a second divergent implementation.
const nativeHomeNavigation = createNativeHomeNavigation({liveVoiceRoot: $('live-voice'), showJobsView: () => showView('jobs'), showProjectsView: projectId => { showView('projects'); if (projectId) nativeProjects.openProject(projectId); }});
const livingCoreView = createLivingCoreView({root: $('living-core-root'), onNavigate: (id, projectId) => nativeHomeNavigation.navigate(id, projectId)});
// UI Slice 2 (issue #25): the real native Projects destination, mounting
// the exact same shared runtime/public/project-universe-view.mjs the web
// cockpit uses. api() here already prefixes /api and attaches the current
// device credential exactly like every other native call.
const nativeProjects = createNativeProjects({root: $('project-universe-root'), api, requestId, onNavigate: target => { if (target === 'sources' || target === 'memory') showView('studio'); }});

async function openVault(password: string) {
  if (nativeVault && vaultPassword === password) return nativeVault;
  if (nativeVault) { await nativeVault.stronghold.unload(); nativeVault = null; }
  const path = await join(await appDataDir(), 'controller.hold');
  const stronghold = await Stronghold.load(path, password);
  try {
    let client;
    try { client = await stronghold.loadClient('controller'); }
    catch { client = await stronghold.createClient('controller'); }
    nativeVault = { stronghold, store: client.getStore() };
    vaultPassword = password;
    return nativeVault;
  } catch (error) { await stronghold.unload(); throw error; }
}
async function saveConnection(value: Connection | null) {
  if (!nativeVault) throw new Error('보관소를 먼저 여세요.');
  if (value) await nativeVault.store.insert('connection', Array.from(encoder.encode(JSON.stringify(value))));
  else await nativeVault.store.remove('connection');
  await nativeVault.stronghold.save();
}
function requestId() { return crypto.randomUUID(); }
function showMessage(value = '') { $('message').textContent = value; }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }

// The timer covers body consumption too. Redirects must not forward a device credential.
async function request<T>(url: string, init: RequestInit, decode: (response: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, connectTimeout: 10_000, maxRedirections: 0 });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new HttpFailure(response.status, body?.error || `HTTP ${response.status}`);
    }
    return await decode(response);
  } finally { window.clearTimeout(timer); }
}
async function api<T>(path: string, init: RequestInit = {}, target = connection): Promise<T> {
  if (!target) throw new Error('기기가 연결되지 않았습니다.');
  try {
    return await request(versionedUrl(target.origin, `/api${path}`), {
      ...init,
      headers: { authorization: `Bearer ${target.token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    }, response => response.json() as Promise<T>);
  } catch (error) {
    if (target === connection) { connectionStatus = 'unavailable'; renderConnection(); }
    throw error;
  }
}
async function activate(value: Connection) {
  if (!nativeVault) throw new Error('보관소를 먼저 여세요.');
  const vault = nativeVault, key = studioStorageKey(value);
  const saved = await vault.store.get(key);
  const storage = new SecureRequestStorage(key, saved ? decoder.decode(new Uint8Array(saved)) : null, async next => {
    if (next === null) await vault.store.remove(key);
    else await vault.store.insert(key, Array.from(encoder.encode(next)));
    await vault.stronghold.save();
  });
  studio?.reset(); world.reset(); nativeProjects.reset(); clearArtifact();
  const root = $('native-studio').cloneNode(false) as HTMLElement;
  $('native-studio').replaceWith(root);
  liveVoiceView.setConnection(value);
  connection = value;
  state = null;
  lastSeen = null;
  connectionStatus = 'checking';
  commands = new CommandSession({
    origin: value.origin, deviceId: value.deviceId, storage: localStorage, createId: requestId,
    send: command => api('/commands', { method: 'POST', body: JSON.stringify(command) }, value),
  });
  studioStorage = storage;
  studio = createStudioView({root, api: createStudioApi({connection:value, request, isCurrent:() => connection === value && !disconnecting}),
    storage, storageKey:key, notify:showMessage, saveFile:async ({blob,filename,sha256}) => {
      if (connection !== value || !sha256) throw new Error('파일을 다시 열어 주세요.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (connection !== value) throw new Error('기기 연결이 변경됐습니다. 파일을 다시 열어 주세요.');
      await saveResult({bytes,name:filename,mime:blob.type,sha256});
    }, onJobCreated: () => { if (connection === value) { showView('jobs'); guard(refresh); } },
  });
  $('local-forget').hidden = true;
  $('artifact-result').hidden = true;
  $('artifact-body').textContent = '';
  render();
  showView('studio');
  renderReceipt(commands.receipt);
  const pending = commands.pending;
  if (pending) $<HTMLTextAreaElement>('text').value = pending.text;
}
function renderConnection() {
  const connected = !!connection, locked = !connected && localStorage.getItem(vaultMarker) === 'present';
  $('unlock').hidden = !locked;
  $('setup').hidden = connected || locked;
  $('workspace').hidden = !connected;
  $('connection').textContent = !connected ? (locked ? '보관소 잠김' : '연결 안 됨') : connectionStatus === 'online' ? '코어 응답 확인됨' : connectionStatus === 'checking' ? '연결 확인 중' : '최신 상태 확인 실패';
  $('seen').textContent = lastSeen ? `마지막 상태 확인 · ${lastSeen.toLocaleString()} · revision ${state?.revision ?? '?'}` : '서버 상태를 아직 확인하지 못했습니다.';
  $('stop').textContent = state?.emergencyStop ? '전체 멈춤 해제' : '전체 멈춤';
  livingCoreView.updateState(state, connectionStatus === 'online' && !disconnecting);
  nativeProjects.updateProjects(state?.projects, state?.jobs);
  studio?.setState(state ? {...state, online: connectionStatus === 'online' && !disconnecting} : null);
  void world.update(state?.world, connected && connectionStatus === 'online' && !state?.emergencyStop && state?.modules?.documents !== false && !commands?.pending && !submitting && !disconnecting);
  liveVoiceView.update({online: connectionStatus === 'online', emergencyStop: state?.emergencyStop === true, busy: disconnecting});
}
function renderPending() {
  const pending = commands?.pending;
  $('pending').textContent = pending ? `접수 확인 대기: ${pending.text}\n앱을 다시 열어도 이 명령과 요청 ID를 보존합니다.` : '';
  $('retry-command').hidden = !pending;
  $<HTMLButtonElement>('submit-command').disabled = submitting || disconnecting;
  $<HTMLButtonElement>('retry-command').disabled = submitting || disconnecting;
}
const JOB_STATUS_LABEL: Record<string, string> = {
  queued: '대기 중', running: '진행 중', paused: '일시정지됨',
  completed: '완료', cancelled: '취소됨', failed: '실패',
};
function render() {
  renderConnection();
  renderPending();
  if (!state) { $('jobs').replaceChildren(); return; }
  $('jobs').replaceChildren(...state.jobs.map(job => {
    const node = document.createElement('article');
    node.className = 'job';
    const title = document.createElement('strong'); title.textContent = job.title;
    const meta = document.createElement('p'); meta.textContent = `${JOB_STATUS_LABEL[job.status] ?? job.status} · ${new Date(job.updatedAt).toLocaleString()}`;
    node.append(title, meta);
    for (const artifact of job.artifacts) {
      const button = document.createElement('button'); button.className = 'artifact'; button.textContent = `결과 열기: ${artifact.name}`;
      button.onclick = () => guard(() => openArtifact(artifact.id, artifact.name)); node.append(button);
    }
    if (['queued', 'running', 'paused'].includes(job.status)) {
      for (const action of job.status === 'paused' ? ['resume', 'cancel'] : ['pause', 'cancel']) {
        const button = document.createElement('button'); button.textContent = action === 'pause' ? '일시정지' : action === 'resume' ? '재개' : '취소';
        button.onclick = () => guard(() => jobAction(job, action)); node.append(button);
      }
    }
    return node;
  }));
}
function renderReceipt(receipt: CommandReceipt | null) {
  $('command-result').hidden = !receipt;
  $('receipt-body').replaceChildren();
  if (!receipt) return;
  // Request IDs are a support/debug detail, not something a nondeveloper
  // owner needs on the primary screen - kept, but behind 상세.
  $('receipt-meta').textContent = `${receipt.text}\n접수 확인 ${new Date(receipt.receivedAt).toLocaleString()}`;
  const payload = receipt.payload as { kind?: string; memory?: Memory; memories?: Memory[]; job?: Job };
  const paragraph = (text: string) => { const node = document.createElement('p'); node.textContent = text; $('receipt-body').append(node); };
  if (payload.kind === 'memory' && payload.memory) {
    paragraph('기억을 저장했습니다.'); paragraph(payload.memory.text);
  } else if (payload.kind === 'search' && Array.isArray(payload.memories)) {
    paragraph(`찾은 기억 ${payload.memories.length}개`);
    for (const memory of payload.memories) paragraph(memory.text);
  } else if (payload.kind === 'job' && payload.job) {
    paragraph(`작업을 접수했습니다: ${payload.job.title}`);
    paragraph('진행 상태와 생성된 파일은 아래 작업 목록에서 확인하세요.');
  } else paragraph(JSON.stringify(receipt.payload, null, 2));
  const details = document.createElement('details'); details.className = 'meta-details';
  const summary = document.createElement('summary'); summary.textContent = '상세';
  const requestLine = document.createElement('p'); requestLine.textContent = `요청 ID: ${receipt.requestId}`;
  details.append(summary, requestLine); $('receipt-body').append(details);
}
async function refresh() {
  if (!connection || refreshing || disconnecting) return;
  const target = connection;
  refreshing = true;
  try {
    const next = await api<State>('/state', {}, target), changed = state?.revision !== next.revision;
    if (target !== connection) return;
    state = next; lastSeen = new Date(); connectionStatus = 'online'; render();
    if (changed && activeView === 'studio') await studio?.refresh();
  } catch (error) {
    if (target === connection) { connectionStatus = 'unavailable'; renderConnection(); $('seen').textContent += ` · ${errorText(error)}`; }
  } finally { refreshing = false; }
}
async function pair(event: SubmitEvent) {
  event.preventDefault();
  if (pairing) return;
  pairing = true; $<HTMLButtonElement>('pair-button').disabled = true;
  try {
    showMessage();
    const origin = normalizeOrigin($<HTMLInputElement>('origin').value);
    const password = $<HTMLInputElement>('vault-password').value;
    if (password.length < 8) throw new Error('보관소 암호를 8자 이상 입력하세요.');
    await openVault(password);
    // Persist an enrollment ID before transmission. Network retries must not register more devices.
    const enrollmentKey = `yeno.enrollment.v1:${encodeURIComponent(origin)}`;
    const enrollmentId = localStorage.getItem(enrollmentKey) || requestId();
    localStorage.setItem(enrollmentKey, enrollmentId);
    let body: { device: { id: string; deviceToken: string } };
    try {
      body = await request(`${origin}/api/v1/devices/enroll`, {
        method: 'POST', headers: { authorization: `Bearer ${$<HTMLInputElement>('pairing').value}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'YENO Android Controller', platform: 'android', requestId: enrollmentId }),
      }, response => response.json());
    } catch (error) {
      if (isDefinitiveRejection(error)) localStorage.removeItem(enrollmentKey);
      throw error;
    }
    if (!body.device?.id || !body.device.deviceToken) throw new Error('기기 등록 응답을 확인하지 못했습니다. 같은 연결로 재시도하세요.');
    const value = { origin, deviceId: body.device.id, token: body.device.deviceToken };
    await saveConnection(value);
    localStorage.setItem(vaultMarker, 'present');
    localStorage.removeItem(enrollmentKey);
    $<HTMLInputElement>('pairing').value = ''; $<HTMLInputElement>('vault-password').value = '';
    await activate(value); await refresh();
  } finally { pairing = false; $<HTMLButtonElement>('pair-button').disabled = false; }
}
async function submit(event?: SubmitEvent) {
  event?.preventDefault();
  if (submitting || disconnecting || !commands) return;
  const current = commands;
  const input = $<HTMLTextAreaElement>('text');
  const text = input.value.trim();
  if (!text) return;
  submitting = true;
  try {
    const operation = current.submit(text);
    renderPending();
    const receipt = await operation;
    if (current !== commands) return;
    renderReceipt(receipt); showMessage();
    if (input.value.trim() === text) input.value = '';
    await refresh();
  } finally { submitting = false; renderPending(); }
}
async function retryCommand() {
  if (!commands?.pending) return;
  $<HTMLTextAreaElement>('text').value = commands.pending.text;
  await submit();
}
async function jobAction(job: Job, action: string) {
  await api(`/jobs/${encodeURIComponent(job.id)}/action`, { method: 'POST', body: JSON.stringify({ action, revision: job.version, requestId: requestId() }) });
  await refresh();
}
async function openArtifact(id: string, name: string) {
  if (!connection) return;
  clearArtifact();
  const target = connection, generation = artifactEpoch;
  let file: VerifiedFile;
  try {
    file = await request(versionedUrl(target.origin, `/api/artifacts/${id}`), { headers: { authorization: `Bearer ${target.token}` } }, response => readVerifiedFile(response, name));
  } catch (error) {
    if (target === connection) { connectionStatus = 'unavailable'; renderConnection(); }
    throw error;
  }
  if (target !== connection || generation !== artifactEpoch) return;
  artifactFile = file;
  const video = $<HTMLVideoElement>('artifact-video');
  $('artifact-title').textContent = file.name;
  $('artifact-meta').textContent = `${file.bytes.byteLength.toLocaleString()}바이트 · SHA-256 확인됨 · ${file.sha256.slice(0,16)}`;
  const isVideo = file.mime === 'video/mp4', isText = file.mime.startsWith('text/') || file.mime === 'application/json';
  video.hidden = !isVideo; $('artifact-body').hidden = isVideo; $('copy-artifact').hidden = !isText;
  if (isVideo) { artifactUrl = URL.createObjectURL(new Blob([file.bytes], {type:file.mime})); video.src = artifactUrl; video.load(); }
  else $('artifact-body').textContent = isText ? decoder.decode(file.bytes) : '미리보기가 없는 파일입니다. 파일 저장으로 내보낼 수 있습니다.';
  $('artifact-result').hidden = false;
  $('artifact-result').scrollIntoView({ block: 'nearest' });
}
function clearArtifact() {
  artifactEpoch++; artifactFile = null;
  const video = $<HTMLVideoElement>('artifact-video'); video.pause(); video.removeAttribute('src'); video.load(); video.hidden = true;
  if (artifactUrl) URL.revokeObjectURL(artifactUrl); artifactUrl = null;
  $('artifact-result').hidden = true; $('artifact-body').textContent = ''; $('artifact-meta').textContent = '';
}
async function saveResult(file: VerifiedFile) {
  if (savingFile || disconnecting || !connection) throw new Error('현재 파일 저장이 끝난 뒤 다시 시도하세요.');
  savingFile = true; $<HTMLButtonElement>('save-artifact').disabled = true;
  try {
    const written = await saveVerifiedFile(file, {
      choose: name => save({defaultPath:name, title:'BLACKHOLE 파일 저장'}),
      write: (path, bytes) => writeFile(path, bytes), read: async path => new Uint8Array(await readFile(path)),
    });
    showMessage(written ? `${file.name} · 선택한 위치에 저장하고 파일 내용을 확인했습니다.` : '저장을 취소했습니다.');
  } finally { savingFile = false; $<HTMLButtonElement>('save-artifact').disabled = false; }
}
async function copyArtifact() {
  try { await navigator.clipboard.writeText($('artifact-body').textContent || ''); showMessage('결과를 복사했습니다.'); }
  catch { showMessage('자동 복사를 사용할 수 없습니다. 아래 결과는 그대로 열려 있으며 직접 선택해 복사할 수 있습니다.'); }
}
async function globalStop() {
  await api('/control', { method: 'POST', body: JSON.stringify({ action: state?.emergencyStop ? 'resume' : 'stop', ...(state?.emergencyStop ? { revision: state.revision } : {}), requestId: requestId() }) });
  await refresh();
}
async function unlock(event: SubmitEvent) {
  event.preventDefault();
  const v = await openVault($<HTMLInputElement>('unlock-password').value);
  const bytes = await v.store.get('connection');
  if (!bytes) throw new Error('저장된 연결을 찾지 못했습니다.');
  const value = JSON.parse(decoder.decode(new Uint8Array(bytes))) as Connection;
  if (!value.deviceId || !value.token || normalizeOrigin(value.origin) !== value.origin) throw new Error('저장된 연결 정보가 올바르지 않습니다.');
  $<HTMLInputElement>('unlock-password').value = '';
  await activate(value); await refresh();
}
async function forgetConnection() {
  if (connection && studioStorage) { studioStorage.removeItem(studioStorageKey(connection)); await studioStorage.flush(); }
  await saveConnection(null);
  commands?.clearLocal();
  localStorage.removeItem(vaultMarker);
  liveVoiceView.setConnection(null);
  connection = null; commands = null; state = null; lastSeen = null;
  studio?.reset(); studio = null; studioStorage = null; world.reset(); nativeProjects.reset(); clearArtifact();
  if (nativeVault) { await nativeVault.stronghold.unload(); nativeVault = null; }
  vaultPassword = null;
  $('receipt-body').replaceChildren(); $('artifact-body').textContent = ''; $<HTMLTextAreaElement>('text').value = '';
  render();
}
async function disconnect(localOnly = false) {
  if (!connection || disconnecting) return;
  if (submitting || studio?.sending || savingFile) throw new Error('진행 중인 접수 확인·파일 저장이 끝난 뒤 연결을 해제하세요.');
  if (localOnly && !window.confirm('이 폰의 연결 정보와 접수 대기 기록만 지웁니다. 서버의 기기 토큰 폐기는 확인되지 않았으며 맡긴 작업은 계속될 수 있습니다. 계속할까요?')) return;
  disconnecting = true; renderPending();
  try {
    if (!localOnly) {
      try {
        const result = await api<{ revoked: boolean; deviceId: string }>('/devices/revoke', { method: 'POST', body: JSON.stringify({ requestId: requestId() }) });
        if (result.revoked !== true || result.deviceId !== connection.deviceId) throw new Error('폐기 확인 응답이 올바르지 않습니다.');
      } catch (error) {
        $('local-forget').hidden = false;
        showMessage(`서버의 기기 토큰 폐기를 확인하지 못했습니다. 연결 정보는 보존했습니다. 다시 해제하거나 이 폰에서만 지우기를 선택할 수 있습니다. ${errorText(error)}`);
        return;
      }
    }
    await forgetConnection();
    showMessage(localOnly ? '이 폰의 연결 정보만 지웠습니다. 서버 토큰 폐기와 작업 중단은 확인되지 않았습니다.' : '서버에서 이 기기 토큰을 폐기하고 폰의 연결 정보를 지웠습니다. 이미 맡긴 작업은 별도로 중단할 수 있습니다.');
  } finally { disconnecting = false; renderPending(); }
}
function guard(task: () => Promise<void>) { void task().catch(error => showMessage(errorText(error))); }
function showView(view: typeof activeView) {
  activeView = view;
  $('cockpit').hidden = view !== 'jobs'; $('native-studio').hidden = view !== 'studio'; $('tab-world').hidden = view !== 'world'; $('tab-projects').hidden = view !== 'projects';
  // Android WebView :has() support is uncertain across older devices, so the
  // home/tools-drawer visibility for the world/jobs tabs is driven by this
  // explicit class rather than a :has() selector reading nav aria-pressed.
  $('workspace').classList.remove('view-studio', 'view-world', 'view-jobs', 'view-projects');
  $('workspace').classList.add(`view-${view}`);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-native-view]')) button.setAttribute('aria-pressed', String(button.dataset.nativeView === view));
  if (view === 'studio' && connectionStatus === 'online') guard(async () => { await studio?.refresh(); });
}
const world = createWorldView({load: () => api('/world'), submit: async () => {
  if (!commands || submitting || disconnecting || commands.pending) return;
  submitting = true; render();
  try { const current = commands; const receipt = await current.submit('세계 현황'); if (current === commands) { renderReceipt(receipt); await refresh(); } }
  catch (error) { showMessage(errorText(error)); showView('jobs'); }
  finally { submitting = false; render(); }
}});
$('world-land').setAttribute('href', worldLand);
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-native-view]')) button.onclick = () => { const view = button.dataset.nativeView as typeof activeView; if (view === 'projects') nativeProjects.showList(); showView(view); };
document.addEventListener('click', event => {
  const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
  if (!link) return; event.preventDefault();
  guard(async () => { const url = new URL(link.href); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('HTTPS 외부 링크만 열 수 있습니다.'); await openUrl(url.href); });
});
$('unlock-form').addEventListener('submit', event => guard(() => unlock(event as SubmitEvent)));
$('pair').addEventListener('submit', event => guard(() => pair(event as SubmitEvent)));
$('command').addEventListener('submit', event => guard(() => submit(event as SubmitEvent)));
$('refresh').onclick = () => guard(refresh);
$('retry-command').onclick = () => guard(retryCommand);
$('stop').onclick = () => guard(globalStop);
$('disconnect').onclick = () => guard(() => disconnect());
$('local-forget').onclick = () => guard(() => disconnect(true));
$('copy-artifact').onclick = () => guard(copyArtifact);
$('save-artifact').onclick = () => guard(async () => { if (artifactFile) await saveResult(artifactFile); });
$('artifact-video').addEventListener('error', () => { if (artifactFile?.mime === 'video/mp4') showMessage('이 기기의 영상 미리보기가 실패했습니다. 파일 저장으로 MP4를 내보내 기본 영상 앱에서 열어 주세요.'); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) guard(refresh); });
render();
window.setInterval(() => { if (!document.hidden) guard(refresh); }, 3000);
