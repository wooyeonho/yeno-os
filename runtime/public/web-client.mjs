// Browser credentials remain in HttpOnly cookies. Only exact unresolved
// request payloads and public core identity are kept in local storage.
export function scopedStorage(storage, scope) {
  if (!/^[a-zA-Z0-9_-]{43}$/.test(scope)) throw new Error('본체의 연결 정보를 확인하지 못했습니다.');
  const prefix = `blackhole-web-v1:${scope}:`;
  return {
    getItem: key => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, value),
    removeItem: key => storage.removeItem(prefix + key),
  };
}

export async function holdControllerLock({locks, onBlocked, onRelease, events = window}) {
  if (!locks?.request) throw new Error('이 브라우저는 안전한 작업 보관을 지원하지 않습니다. 최신 Chrome에서 열어주세요.');
  let release, active = true;
  const held = new Promise(resolve => { release = resolve; });
  const acquired = new Promise((resolve, reject) => {
    locks.request('blackhole-web-controller-v1', {ifAvailable: true}, async lock => {
      if (!lock) { resolve(false); return; }
      resolve(true);
      await held;
    }).catch(reject);
  });
  if (!(await acquired)) { onBlocked?.(); return null; }
  const stop = () => { if (!active) return; active = false; onRelease?.(); release(); };
  events.addEventListener('pagehide', stop, {once: true});
  events.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  return {get active() { return active; }, release: stop};
}

export async function connectBrowser({document: doc = document, fetchImpl = fetch, storage = localStorage,
  oldStorage = sessionStorage, locks = navigator.locks, events = window} = {}) {
  const $ = id => doc.getElementById(id);
  const errorBox = $('pair-error'), form = $('pair-form'), keyInput = $('pair-token'), keyToggle = $('pair-key-toggle');
  const button = form.querySelector('[type="submit"]');
  let generation = 0, live = true, first = true, metadata, loginAttempted = false, loginBusy = false, retryAt = 0;
  const showError = message => { errorBox.textContent = message; };
  const hideKey = () => { keyInput.type = 'password'; if (keyToggle) { keyToggle.textContent = '키 보기'; keyToggle.setAttribute('aria-pressed', 'false'); } };
  keyToggle?.addEventListener('click', () => {
    const visible = keyInput.type === 'password';
    keyInput.type = visible ? 'text' : 'password';
    keyToggle.textContent = visible ? '키 숨기기' : '키 보기';
    keyToggle.setAttribute('aria-pressed', String(visible));
  });
  keyInput.addEventListener('blur', hideKey);
  keyToggle?.addEventListener('blur', hideKey);
  doc.addEventListener?.('visibilitychange', () => { if (doc.hidden) hideKey(); });
  const lock = await holdControllerLock({locks, events, onRelease: () => { live = false; generation++; keyInput.value = ''; hideKey(); },
    onBlocked: () => { showError('다른 탭에서 운영실을 사용 중입니다. 그 탭을 닫고 아래에서 다시 연결하세요.'); form.querySelectorAll('input,button').forEach(input=>{input.disabled=true;}); $('web-retry').hidden = false; }});
  $('web-retry').addEventListener('click', () => location.reload());
  if (!lock) return new Promise(() => {});
  // Verify persistence before accepting a task or creating a browser device.
  const probe = 'blackhole-storage-probe'; storage.setItem(probe, '1'); storage.removeItem(probe);
  async function request(route, init = {}) {
    const epoch = generation;
    const response = await fetchImpl(route, {...init, credentials: 'same-origin', cache: 'no-store',
      headers: {'X-Yeno-Browser': '1', ...init.headers}});
    if (!live || epoch !== generation) throw new Error('연결이 바뀌어 이전 응답을 닫았습니다.');
    return response;
  }
  async function json(route, init) {
    const epoch = generation;
    const response = await request(route, init);
    let body; try { body = await response.json(); } catch { throw new Error('본체 응답을 확인하지 못했습니다. 다시 연결해 주세요.'); }
    if (!live || epoch !== generation) throw new Error('연결이 바뀌어 이전 응답을 닫았습니다.');
    if (!response.ok) {
      const error = new Error(body.error?.message || body.error || '연결 키와 네트워크를 확인하세요.');
      error.status = response.status; error.code = body.code;
      const wait = Number(response.headers.get('Retry-After') || body.retryAfterSeconds);
      if (Number.isFinite(wait) && wait > 0) error.retryAfterSeconds = Math.ceil(wait);
      throw error;
    }
    return body;
  }
  function activate(value) {
    if (!value.authenticated || !value.device?.id || !/^[a-zA-Z0-9_-]{43}$/.test(value.storageScope)) throw new Error('연결 응답이 올바르지 않습니다.');
    metadata = value;
    const scoped = scopedStorage(storage, metadata.storageScope);
    // Preserve every unresolved legacy request before removing a legacy key.
    for (const key of ['yeno-pending-command-v1','yeno-pending-project-v1','yeno-pending-source-v1','yeno-pending-quest-v1','blackhole-pending-studio-v1']) {
      const previous = oldStorage.getItem(key), current = scoped.getItem(key);
      if (previous !== null) {
        if (current !== null && current !== previous) throw new Error('이전 탭과 저장된 미확인 작업이 다릅니다. 원래 탭에서 접수 여부를 먼저 확인해 주세요.');
        scoped.setItem(key, previous); oldStorage.removeItem(key);
      }
    }
    oldStorage.removeItem('yeno-token');
    storage.removeItem('blackhole-web-login-request-v1');
    keyInput.value = ''; hideKey();
    $('pair-screen').hidden = true;
    return scoped;
  }
  let resolveLogin;
  const loginReady = new Promise(resolve => { resolveLogin = resolve; });
  function newEnrollment() {
    const pending = {requestId: crypto.randomUUID(), name: 'BLACKHOLE 휴대폰 브라우저', remember: $('remember-browser').checked};
    storage.setItem('blackhole-web-login-request-v1', JSON.stringify(pending));
    return pending;
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (loginBusy || !live) return;
    loginAttempted = true;
    const key = keyInput.value;
    // Never silently change a credential. Header serialization cannot preserve
    // trailing whitespace, and non-ASCII input is not a portable bearer value.
    let invalid = '';
    if (key !== key.trim()) invalid = '키 앞뒤에 공백이 있습니다. 저장한 키를 확인해 공백 없이 입력해 주세요. 자동으로 바꾸지 않았습니다.';
    else if (key.length < 16) invalid = '개인 연결 키는 16자 이상이어야 합니다. Koyeb 계정 비밀번호가 아니라 저장한 연결 키를 입력하세요.';
    else if (!/^[\x20-\x7e]+$/.test(key)) invalid = '연결 키에는 영문·숫자·기호를 입력해 주세요. 한글·줄바꿈·보이지 않는 문자가 포함되어 있습니다.';
    keyInput.setAttribute('aria-invalid', String(Boolean(invalid)));
    if (invalid) { showError(invalid); keyInput.focus(); return; }
    if (retryAt > Date.now()) { showError(`연결 시도가 많습니다. ${Math.ceil((retryAt - Date.now()) / 1000)}초 뒤 같은 요청으로 다시 연결하세요.`); return; }
    loginBusy = true; button.disabled = true; button.textContent = '연결 확인 중…'; showError('');
    try {
      let pending = storage.getItem('blackhole-web-login-request-v1');
      if (pending) pending = JSON.parse(pending);
      else pending = newEnrollment();
      const enroll = () => json('/api/web/session', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${key}`}, body: JSON.stringify(pending), signal: AbortSignal.timeout(12000)});
      let value;
      try { value = await enroll(); }
      catch (error) {
        // Only an authenticated, definitive stale/expired enrollment response
        // permits a new identity. Lost replies, wrong keys, capacity conflicts
        // and unknown 409s must retain their exact request for reconciliation.
        if (error.status !== 409 || !['WEB_ENROLLMENT_STALE', 'WEB_ENROLLMENT_EXPIRED'].includes(error.code)) throw error;
        pending = newEnrollment();
        value = await enroll();
      }
      const scoped = activate(value);
      if (!first) { location.reload(); return; }
      first = false; resolveLogin(scoped);
    } catch (error) {
      if (!live) return;
      if (error.status === 401) {
        keyInput.setAttribute('aria-invalid', 'true');
        showError(error.code === 'AUTH_HEADER_MISSING'
          ? '서버에 연결 키가 전달되지 않았습니다. 새로고침 후 다시 연결해 주세요. 계속되면 이 문구를 알려주세요.'
          : '입력한 키가 현재 서버의 연결 키와 일치하지 않습니다. ‘키 보기’로 대소문자·공백을 확인해 주세요. 방금 키를 변경했다면 서버에 적용됐는지도 확인해야 합니다.');
      } else if (error.status === 429) {
        const seconds = error.retryAfterSeconds || 300; retryAt = Date.now() + seconds * 1000;
        showError(`연결 시도가 많습니다. ${seconds}초 뒤 같은 요청으로 다시 연결하세요. 보관된 작업은 유지됩니다.`);
      } else if (error.status) showError(error.message);
      else showError('연결 결과를 받지 못했습니다. 네트워크를 확인한 뒤 다시 누르면 같은 연결 요청을 확인합니다. 보관된 작업은 유지됩니다.');
    }
    finally { loginBusy = false; button.disabled = !live; button.textContent = '운영실 열기'; }
  });
  try {
    const value = await json('/api/web/session', {signal: AbortSignal.timeout(12000)});
    if (!loginAttempted) { const scoped = activate(value); first = false; resolveLogin(scoped); }
  } catch (error) {
    if (!live) return new Promise(() => {});
    if (!loginAttempted) { $('pair-screen').hidden = false;
      if (error.status !== 401) showError('본체 연결을 확인하지 못했습니다. 네트워크를 확인하고 다시 연결하세요.'); }
    // Existing tab credentials are preserved until the user completes the
    // explicit cookie login. Never silently copy an owner key to persistent storage.
  }
  const requestStorage = await loginReady;
  return {
    storage: requestStorage, metadata,
    fetch: request,
    get active() { return live && lock.active; },
    invalidate() { generation++; },
    async logout() {
      const logoutKey = `logout-request:${metadata.device.id}`;
      let id = requestStorage.getItem(logoutKey);
      if (!id) { id = crypto.randomUUID(); requestStorage.setItem(logoutKey, id); }
      const result = await json('/api/web/logout', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({requestId: id, deviceId: metadata.device.id}), signal: AbortSignal.timeout(12000)});
      if (result.loggedOut !== true) throw new Error('연결 해제 응답을 확인하지 못했습니다. 다시 시도해 주세요.');
      generation++; requestStorage.removeItem(logoutKey);
      return result;
    },
  };
}

export function enableInstall({button, hint, nav = navigator, events = window} = {}) {
  let prompt;
  events.addEventListener('beforeinstallprompt', event => { event.preventDefault(); prompt = event; button.hidden = false; });
  events.addEventListener('appinstalled', () => { button.hidden = true; hint.textContent = '홈 화면에 추가했습니다.'; });
  button.addEventListener('click', async () => { if (!prompt) return; await prompt.prompt(); const choice = await prompt.userChoice; if (choice.outcome === 'accepted') button.hidden = true; prompt = null; });
  if ('serviceWorker' in nav) nav.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'}).catch(() => { hint.textContent = 'Chrome 메뉴에서 홈 화면에 추가할 수 있습니다. 오프라인 안내는 연결 후 다시 준비합니다.'; });
}
