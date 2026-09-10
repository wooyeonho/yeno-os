import './style.css';
import { fetch } from '@tauri-apps/plugin-http';
import { appDataDir, join } from '@tauri-apps/api/path';
import { Stronghold, type Store } from '@tauri-apps/plugin-stronghold';
import { CommandSession, HttpFailure, isDefinitiveRejection, type CommandReceipt } from './command-session.ts';

type Job = { id: string; title: string; status: string; version: number; updatedAt: string; artifacts: { id: string; name: string }[] };
type State = { name: string; apiVersion: string; revision: number; emergencyStop: boolean; jobs: Job[] };
type Connection = { origin: string; deviceId: string; token: string };
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
function normalizeOrigin(raw: string) {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol) || !['', '/'].includes(url.pathname)) {
    throw new Error('경로 없이 HTTPS 코어 주소를 입력하세요.');
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('원격 코어는 HTTPS가 필요합니다.');
  return url.origin;
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
    return await request(`${target.origin}/api/v1${path}`, {
      ...init,
      headers: { authorization: `Bearer ${target.token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    }, response => response.json() as Promise<T>);
  } catch (error) {
    if (target === connection) { connectionStatus = 'unavailable'; renderConnection(); }
    throw error;
  }
}
function activate(value: Connection) {
  connection = value;
  state = null;
  lastSeen = null;
  connectionStatus = 'checking';
  commands = new CommandSession({
    origin: value.origin, deviceId: value.deviceId, storage: localStorage, createId: requestId,
    send: command => api('/commands', { method: 'POST', body: JSON.stringify(command) }, value),
  });
  $('local-forget').hidden = true;
  $('artifact-result').hidden = true;
  $('artifact-body').textContent = '';
  render();
  renderReceipt(commands.receipt);
  const pending = commands.pending;
  if (pending) $<HTMLTextAreaElement>('text').value = pending.text;
}
function renderConnection() {
  const connected = !!connection, locked = !connected && localStorage.getItem(vaultMarker) === 'present';
  $('unlock').hidden = !locked;
  $('setup').hidden = connected || locked;
  $('cockpit').hidden = !connected;
  $('connection').textContent = !connected ? (locked ? '보관소 잠김' : '연결 안 됨') : connectionStatus === 'online' ? '코어 응답 확인됨' : connectionStatus === 'checking' ? '연결 확인 중' : '최신 상태 확인 실패';
  $('seen').textContent = lastSeen ? `마지막 상태 확인 · ${lastSeen.toLocaleString()} · revision ${state?.revision ?? '?'}` : '서버 상태를 아직 확인하지 못했습니다.';
  $('headline').textContent = connectionStatus !== 'online' ? (state ? '마지막으로 확인한 상태입니다' : '코어 응답을 기다리고 있습니다') : state?.emergencyStop ? '전체 멈춤' : state?.jobs.some(job => ['queued', 'running'].includes(job.status)) ? '코어가 작업을 처리하고 있습니다' : '맡길 일을 기다리고 있습니다';
  $('stop').textContent = state?.emergencyStop ? '전체 멈춤 해제' : '전체 멈춤';
}
function renderPending() {
  const pending = commands?.pending;
  $('pending').textContent = pending ? `접수 확인 대기: ${pending.text}\n앱을 다시 열어도 이 명령과 요청 ID를 보존합니다.` : '';
  $('retry-command').hidden = !pending;
  $<HTMLButtonElement>('submit-command').disabled = submitting || disconnecting;
  $<HTMLButtonElement>('retry-command').disabled = submitting || disconnecting;
}
function render() {
  renderConnection();
  renderPending();
  if (!state) { $('jobs').replaceChildren(); return; }
  $('jobs').replaceChildren(...state.jobs.map(job => {
    const node = document.createElement('article');
    node.className = 'job';
    const title = document.createElement('strong'); title.textContent = job.title;
    const meta = document.createElement('p'); meta.textContent = `${job.status} · ${new Date(job.updatedAt).toLocaleString()}`;
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
  $('receipt-meta').textContent = `${receipt.text}\n접수 확인 ${new Date(receipt.receivedAt).toLocaleString()} · 요청 ${receipt.requestId}`;
  const payload = receipt.payload as { kind?: string; memory?: Memory; memories?: Memory[]; job?: Job };
  const paragraph = (text: string) => { const node = document.createElement('p'); node.textContent = text; $('receipt-body').append(node); };
  if (payload.kind === 'memory' && payload.memory) {
    paragraph('기억을 저장했습니다.'); paragraph(payload.memory.text);
  } else if (payload.kind === 'search' && Array.isArray(payload.memories)) {
    paragraph(`찾은 기억 ${payload.memories.length}개`);
    for (const memory of payload.memories) paragraph(memory.text);
  } else if (payload.kind === 'job' && payload.job) {
    paragraph(`작업을 접수했습니다: ${payload.job.title} · ${payload.job.id}`);
    paragraph('진행 상태와 생성된 파일은 아래 작업 목록에서 확인하세요.');
  } else paragraph(JSON.stringify(receipt.payload, null, 2));
}
async function refresh() {
  if (!connection || refreshing || disconnecting) return;
  const target = connection;
  refreshing = true;
  try {
    const next = await api<State>('/state', {}, target);
    if (target !== connection) return;
    state = next; lastSeen = new Date(); connectionStatus = 'online'; render();
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
    activate(value); await refresh();
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
  const target = connection;
  let text: string;
  try {
    text = await request(`${target.origin}/api/v1/artifacts/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${target.token}` } }, response => response.text());
  } catch (error) {
    if (target === connection) { connectionStatus = 'unavailable'; renderConnection(); }
    throw error;
  }
  if (target !== connection) return;
  $('artifact-title').textContent = name; $('artifact-body').textContent = text; $('artifact-result').hidden = false;
  $('artifact-result').scrollIntoView({ block: 'nearest' });
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
  activate(value); await refresh();
}
async function forgetConnection() {
  await saveConnection(null);
  commands?.clearLocal();
  localStorage.removeItem(vaultMarker);
  connection = null; commands = null; state = null; lastSeen = null;
  if (nativeVault) { await nativeVault.stronghold.unload(); nativeVault = null; }
  vaultPassword = null;
  $('receipt-body').replaceChildren(); $('artifact-body').textContent = ''; $<HTMLTextAreaElement>('text').value = '';
  render();
}
async function disconnect(localOnly = false) {
  if (!connection || disconnecting) return;
  if (submitting) throw new Error('명령 접수 확인이 끝난 뒤 연결을 해제하세요.');
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
$('unlock-form').addEventListener('submit', event => guard(() => unlock(event as SubmitEvent)));
$('pair').addEventListener('submit', event => guard(() => pair(event as SubmitEvent)));
$('command').addEventListener('submit', event => guard(() => submit(event as SubmitEvent)));
$('refresh').onclick = () => guard(refresh);
$('retry-command').onclick = () => guard(retryCommand);
$('stop').onclick = () => guard(globalStop);
$('disconnect').onclick = () => guard(() => disconnect());
$('local-forget').onclick = () => guard(() => disconnect(true));
$('copy-artifact').onclick = () => guard(copyArtifact);
document.addEventListener('visibilitychange', () => { if (!document.hidden) guard(refresh); });
render();
window.setInterval(() => { if (!document.hidden) guard(refresh); }, 3000);
