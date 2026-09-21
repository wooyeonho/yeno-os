// Setup-only UI. The existing BLACKHOLE workspace owns commands and results.
// Bootstrap authorization stays in this document's closure, never browser storage.
const bootstrapHash = new URLSearchParams(window.location.hash.slice(1));
const setupToken = bootstrapHash.get('setup') || '';
window.history.replaceState(null, '', window.location.pathname + window.location.search);

const $ = id => document.getElementById(id);
const providerLabels = new Map([
  ['openai', 'OpenAI · GPT'], ['anthropic', 'Anthropic · Claude'],
  ['gemini', 'Google · Gemini'], ['xai', 'xAI · Grok'],
  ['moonshot', 'Moonshot · Kimi'], ['nvidia', 'NVIDIA'],
]);
const providerInputs = [];
const originalProviderParent = $('provider-details').parentElement;
let currentState = null;
let workspaceUrl = null;
let busy = false;
const providerTestRequestStorageKey = 'blackhole.providerTestRequestId';
let providerTestRequestId = '';
try { providerTestRequestId = sessionStorage.getItem(providerTestRequestStorageKey) || ''; } catch {}
function providerTestRequest() {
  if (!providerTestRequestId) {
    providerTestRequestId = crypto.randomUUID();
    try { sessionStorage.setItem(providerTestRequestStorageKey, providerTestRequestId); } catch {}
  }
  return providerTestRequestId;
}
function clearProviderTestRequest() {
  providerTestRequestId = '';
  try { sessionStorage.removeItem(providerTestRequestStorageKey); } catch {}
}

for (const [provider, label] of providerLabels) {
  const details = document.createElement('details');
  details.className = 'provider-entry';
  const summary = document.createElement('summary');
  summary.textContent = label;
  const providerStatus = document.createElement('small');
  providerStatus.textContent = '입력하지 않음';
  summary.append(providerStatus);
  details.append(summary);
  const inputs = {provider};
  for (const [name, title, type] of [['apiKey', 'API 키', 'password'], ['model', '모델 API ID', 'text']]) {
    const field = document.createElement('label');
    field.className = 'field';
    const text = document.createElement('span');
    text.textContent = title;
    const input = document.createElement('input');
    input.id = `provider-${provider}-${name}`;
    field.htmlFor = input.id;
    input.type = type;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = name === 'apiKey' ? 4096 : 120;
    if (name === 'model') input.placeholder = '공급자에서 확인한 정확한 모델 ID';
    field.append(text, input);
    details.append(field);
    inputs[name] = input;
    input.addEventListener('input', () => {
      const keyPresent = inputs.apiKey?.value.trim();
      const modelPresent = inputs.model?.value.trim();
      providerStatus.textContent = keyPresent && modelPresent ? '입력됨 · 응답 미확인' : keyPresent || modelPresent ? '키와 모델 ID 모두 필요' : '입력하지 않음';
    });
  }
  providerInputs.push(inputs);
  $('provider-fields').append(details);
}

function message(text = '', error = false) {
  $('setup-message').textContent = text;
  $('setup-message').hidden = !text;
  $('setup-message').classList.toggle('is-error', error);
}

function setBusy(value, button, label) {
  busy = value;
  $('setup-panel').setAttribute('aria-busy', String(value));
  document.querySelectorAll('button, input, summary').forEach(element => {
    if (element.matches('summary')) return;
    element.disabled = value;
  });
  if (button && label) button.firstChild.textContent = label;
}

const knownErrors = {
  DESKTOP_KEY_MISMATCH: '연결 키가 일치하지 않습니다. 이 PC에 설정한 키를 확인해주세요.',
  DESKTOP_NEW_STORE_CONFIRMATION_REQUIRED: '기존 기록이 이전되지 않는 새 코어를 만드는지 확인해주세요.',
  DESKTOP_PAUSE_JOBS_FIRST: '진행 중인 작업이 있습니다. 운영실에서 먼저 일시정지한 뒤 다시 진행해주세요.',
  DESKTOP_CORE_REQUEST_FAILED: '코어 요청을 마치지 못했습니다. 현재 상태를 확인한 뒤 다시 진행해주세요.',
  DESKTOP_RATE_LIMITED: '시도 횟수가 많습니다. 잠시 뒤 연결 키를 확인하고 다시 시도해주세요.',
  DESKTOP_OPERATION_FAILED: '요청을 마치지 못했습니다. 현재 상태를 확인한 뒤 다시 진행해주세요.',
  DESKTOP_INVALID_KEY: '연결 키를 확인해주세요. 공백 없이 16자 이상이어야 합니다.',
  DESKTOP_ALREADY_INITIALIZED: '이미 만들어진 작업 공간이 있습니다. 현재 상태를 다시 확인해주세요.',
  DESKTOP_UNAUTHORIZED: '설정 연결이 만료되었습니다. BLACKHOLE.exe를 다시 열어주세요.',
  unauthorized: '설정 연결이 만료되었습니다. BLACKHOLE.exe를 다시 열어주세요.',
  invalid_setup_token: '설정 연결이 만료되었습니다. BLACKHOLE.exe를 다시 열어주세요.',
  invalid_pairing_key: '연결 키를 확인해주세요. 공백 없이 16자 이상이어야 합니다.',
  invalid_token: '연결 키가 일치하지 않습니다. 이 PC에 설정한 키를 확인해주세요.',
  already_initialized: '이미 만들어진 작업 공간이 있습니다. 현재 상태를 다시 확인해주세요.',
  existing_store: '기존 저장소가 있어 새로 만들지 않았습니다. 기존 기록은 그대로 보존됩니다.',
  invalid_provider: 'AI 공급자 설정을 확인해주세요.',
  invalid_provider_config: 'API 키와 정확한 모델 ID를 함께 입력해주세요.',
  invalid_daily_limit: '하루 호출 상한은 1~20 사이의 정수로 입력해주세요.',
  core_start_failed: '코어를 시작하지 못했습니다. 기존 기록을 보존한 채 현재 상태를 다시 확인해주세요.',
  core_not_running: '코어가 실행 중이 아닙니다. BLACKHOLE.exe를 다시 열어주세요.',
  active_jobs: '진행 중인 작업이 있습니다. 운영실에서 먼저 일시정지한 뒤 다시 저장해주세요.',
  core_busy: '진행 중인 작업이 있습니다. 운영실에서 먼저 일시정지한 뒤 다시 저장해주세요.',
  emergency_stop: '전체 멈춤 상태입니다. 운영실에서 상태를 확인해주세요.',
  DESKTOP_PROVIDER_TEST_FAILED: '모델 연결 시험을 시작하지 못했습니다. 저장된 설정과 코어 상태를 확인해주세요.',
};

async function api(path, body) {
  if (!setupToken) throw new Error('설정 연결 정보가 없습니다. BLACKHOLE.exe를 다시 열어주세요.');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {'X-Blackhole-Setup': setupToken, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok === false) {
      const code = typeof data?.code === 'string' ? data.code : typeof data?.error === 'string' ? data.error : data?.error?.code;
      // Never reflect server error text: a provider or filesystem error may contain secrets.
      throw new Error(knownErrors[code] || (response.status === 401 || response.status === 403
        ? knownErrors.unauthorized
        : '요청을 마치지 못했습니다. 현재 상태를 확인한 뒤 다시 진행해주세요.'));
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) {
      throw new Error('응답을 확인하지 못했습니다. 중복 실행하지 않았습니다. ‘현재 상태 다시 확인’을 눌러주세요.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function showPanel(id) {
  for (const candidate of ['first-setup', 'unlock-form', 'ready-panel', 'stopped-panel']) $(candidate).hidden = candidate !== id;
}

function showState(state) {
  currentState = state;
  $('source-revision').textContent = typeof state.sourceRevision === 'string' && /^[a-f0-9]{7,40}$/i.test(state.sourceRevision) ? `소스 ${state.sourceRevision.slice(0, 7)}` : '';
  $('connection-state').lastChild.textContent = state.running ? '이 PC 코어 실행 중' : '이 PC에서 설정';
  $('connection-state').classList.toggle('is-ready', state.running === true);
  $('panel-kicker').textContent = state.initialized ? '다시 만나서 반갑습니다' : '처음 한 번만 설정하세요';
  $('panel-title').textContent = state.initialized ? '작업 공간 이어서 열기' : '어디에서 시작할까요?';
  $('panel-description').textContent = state.initialized ? '연결 키로 이 PC의 작업 공간을 여세요.' : '사용할 코어를 선택하고 시작하세요.';
  showPanel(state.initialized ? 'unlock-form' : 'first-setup');
  if (!state.initialized) {
    originalProviderParent.insertBefore($('provider-details'), originalProviderParent.querySelector('.confirmation'));
    $('provider-form-description').textContent = '사용할 공급자의 API 키와 정확한 모델 ID를 입력하세요. 비워두면 AI 연결 없이 작업 공간을 엽니다. 여러 개를 입력하면 목록의 첫 공급자를 기본으로 사용합니다.';
  }
}

function safeWorkspaceUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) throw new Error('코어 주소를 확인하지 못했습니다. BLACKHOLE.exe를 다시 열어주세요.');
  return url.href;
}

function showReady(result) {
  workspaceUrl = safeWorkspaceUrl(result.redirectUrl || result.coreUrl || currentState?.coreUrl);
  showPanel('ready-panel');
  $('panel-kicker').textContent = '시작 준비가 되었습니다';
  $('panel-title').textContent = '작업을 이어가세요';
  $('panel-description').textContent = '기존 BLACKHOLE 운영실로 연결됩니다.';
  $('connection-state').lastChild.textContent = '이 PC 코어 실행 중';
  $('connection-state').classList.add('is-ready');
  const providerSummary = result.providers || currentState?.providers;
  const summaries = Array.isArray(providerSummary) ? providerSummary : providerSummary?.providers || [];
  const configured = summaries.filter(item => item.configured === true);
  $('provider-state').textContent = configured.length
    ? `${configured.length}개 설정 · 실제 응답은 별도 확인`
    : result.providerConfigured ? '설정됨 · 실제 응답은 별도 확인' : '연결하지 않음';
  $('retry-state').hidden = true;
  $('ready-provider-slot').append($('provider-details'));
  $('provider-details').open = false;
  $('provider-form-description').textContent = '입력한 목록으로 AI 설정을 교체합니다. 유지할 공급자도 API 키와 모델 ID를 모두 입력하세요. 여러 개를 입력하면 목록의 첫 공급자를 기본으로 사용합니다.';
  $('daily-call-limit').value = String(providerSummary?.dailyCallLimit || 4);
  $('providers-update-controls').hidden = true;
}

function readProviderConfig(requireProvider = false) {
  const providers = [];
  for (const input of providerInputs) {
    const apiKey = input.apiKey.value.trim();
    const model = input.model.value.trim();
    if (!apiKey && !model) continue;
    if (!apiKey || !model) throw new Error(`${providerLabels.get(input.provider)}의 API 키와 모델 ID를 함께 입력해주세요.`);
    providers.push({provider: input.provider, apiKey, model});
  }
  if (requireProvider && !providers.length) throw new Error('저장할 공급자의 API 키와 모델 ID를 입력해주세요.');
  const dailyCallLimit = Number($('daily-call-limit').value);
  if (!Number.isInteger(dailyCallLimit) || dailyCallLimit < 1 || dailyCallLimit > 20) throw new Error(knownErrors.invalid_daily_limit);
  return {version: 1, providers, primaryProvider: providers[0]?.provider || null, dailyCallLimit};
}

function clearProviderSecrets() {
  providerInputs.forEach(input => {
    input.apiKey.value = '';
    input.model.value = '';
    input.apiKey.dispatchEvent(new Event('input'));
  });
}

async function updateProviderSummary(result) {
  try {
    currentState = await api('/setup/state');
    showReady({...result, providers: currentState.providers});
  } catch { /* Initialization already succeeded. Never repeat it to refresh a summary. */ }
}

async function refreshState() {
  if (busy) return;
  setBusy(true);
  try {
    const state = await api('/setup/state');
    message();
    showState(state);
    $('retry-state').hidden = true;
  } catch (error) {
    $('panel-title').textContent = '설정 연결을 확인해주세요';
    $('panel-description').textContent = '이 화면은 BLACKHOLE.exe에서 열어야 합니다.';
    message(error.message, true);
    $('retry-state').hidden = !setupToken;
  } finally { setBusy(false); }
}

document.querySelectorAll('input[name="setup-mode"]').forEach(input => input.addEventListener('change', () => {
  const local = input.value === 'local';
  $('initialize-form').hidden = !local;
  $('existing-form').hidden = local;
  message();
}));

$('existing-form').addEventListener('submit', event => {
  event.preventDefault();
  if (busy) return;
  try {
    const url = new URL($('existing-url').value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error('로그인 정보나 매개변수 없는 HTTPS 코어 주소를 입력해주세요.');
    // Explicit navigation only. This setup service never fetches or modifies that server.
    window.location.assign(url.href);
  } catch (error) { message(error instanceof TypeError ? '올바른 HTTPS 코어 주소를 입력해주세요.' : error.message, true); }
});

$('initialize-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const pairingKey = $('new-pairing-key').value;
  if (pairingKey.length < 16 || pairingKey.length > 512 || /\s/.test(pairingKey)) return message(knownErrors.invalid_pairing_key, true);
  if (!$('confirm-new-store').checked) return message('새 코어를 만드는지 확인해주세요.', true);
  let providers;
  try { providers = readProviderConfig(); }
  catch (error) { return message(error.message, true); }
  message();
  setBusy(true, $('initialize-button'), '새 코어를 준비하고 있습니다');
  try {
    const result = await api('/setup/initialize', {pairingKey, confirmNewStore: true, providers});
    $('new-pairing-key').value = '';
    clearProviderSecrets();
    showReady(result);
    await updateProviderSummary(result);
  } catch (error) {
    message(error.message, true);
    $('retry-state').hidden = false;
  } finally { setBusy(false, $('initialize-button'), '새 코어 만들고 시작'); }
});

$('unlock-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  message();
  setBusy(true, $('unlock-button'), '작업 공간을 열고 있습니다');
  try {
    const result = await api('/setup/unlock', {pairingKey: $('unlock-pairing-key').value});
    $('unlock-pairing-key').value = '';
    showReady(result);
    await updateProviderSummary(result);
  } catch (error) {
    message(error.message, true);
    $('retry-state').hidden = false;
  } finally { setBusy(false, $('unlock-button'), '잠금 해제하고 시작'); }
});

$('provider-details').addEventListener('toggle', () => {
  $('providers-update-controls').hidden = !($('provider-details').open && $('ready-provider-slot').contains($('provider-details')));
});

$('providers-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  let providers;
  try { providers = readProviderConfig(true); }
  catch (error) { return message(error.message, true); }
  message();
  setBusy(true, $('providers-button'), '설정을 저장하고 있습니다');
  try {
    const result = await api('/setup/providers', {pairingKey: $('providers-pairing-key').value, providers});
    $('providers-pairing-key').value = '';
    clearProviderSecrets();
    showReady(result);
    await updateProviderSummary(result);
    message('AI 설정을 저장했습니다. 운영실에서 AI를 켜면 사용할 수 있습니다. 실제 모델 응답은 아직 확인하지 않았습니다.');
  } catch (error) { message(error.message, true); $('retry-state').hidden = false; }
  finally { setBusy(false, $('providers-button'), 'AI 설정 저장하고 코어 다시 시작'); }
});

$('provider-test-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  message();
  setBusy(true, $('provider-test-button'), '모델을 한 번 호출하고 있습니다');
  try {
    const result = await api('/setup/provider-test', {pairingKey: $('provider-test-pairing-key').value, requestId: providerTestRequest()});
    $('provider-test-pairing-key').value = '';
    const live = result.liveVerification || {};
    const status = typeof live.status === 'string' ? live.status : 'REQUESTED';
    $('provider-test-result').textContent = status === 'LIVE_VERIFIED'
      ? '실제 네트워크 응답을 확인했습니다. 운영실에서 provider/model과 호출 기록을 확인하세요.'
      : status === 'SYNTHETIC_VERIFIED'
        ? '합성 전송 결과입니다. 실제 모델 응답으로 표시하지 않았습니다.'
        : `연결 시험 상태: ${status}. 결과를 다시 확인해 주세요.`;
    $('provider-test-result').hidden = false;
    if (!['REQUESTED', 'OUTCOME_UNKNOWN', 'RUNNING'].includes(status)) clearProviderTestRequest();
  } catch (error) { message(error.message, true); $('retry-state').hidden = false; }
  finally { setBusy(false, $('provider-test-button'), '실제 모델 1회 호출'); }
});

$('intake-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  message();
  setBusy(true, $('intake-button'), '검토 목록을 가져오고 있습니다');
  try {
    const result = await api('/setup/intake', {pairingKey: $('intake-pairing-key').value});
    $('intake-pairing-key').value = '';
    const count = Number.isSafeInteger(result.createdCount) && result.createdCount >= 0 ? result.createdCount : null;
    $('intake-result').textContent = count === null ? '가져오기 응답을 받았습니다. 운영실에서 실제 검토 목록을 확인하세요.' : `${count}개 항목을 새로 등록했습니다. 기존 항목은 유지됩니다. 실행·완료된 프로젝트가 아닙니다.`;
    $('intake-result').hidden = false;
  } catch (error) { message(error.message, true); $('retry-state').hidden = false; }
  finally { setBusy(false, $('intake-button'), '기존 프로젝트·키워드 목록 가져오기'); }
});

$('open-workspace').addEventListener('click', () => {
  if (!busy && workspaceUrl) window.location.assign(workspaceUrl);
});

$('stop-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  message();
  setBusy(true);
  try {
    await api('/setup/stop', {pairingKey: $('stop-pairing-key').value});
    $('stop-pairing-key').value = '';
    workspaceUrl = null;
    showPanel('stopped-panel');
    $('panel-kicker').textContent = '종료됨';
    $('panel-title').textContent = '기록을 보존하고 종료했습니다';
    $('panel-description').textContent = '';
    $('connection-state').lastChild.textContent = '이 PC 코어 종료됨';
    $('connection-state').classList.remove('is-ready');
  } catch (error) {
    message(error.message, true);
    $('retry-state').hidden = false;
  } finally { setBusy(false); }
});

$('retry-state').addEventListener('click', refreshState);
$('reconnect-core').addEventListener('click', refreshState);
refreshState();
