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
  const errorBox = $('pair-error'), form = $('pair-form');
  let generation = 0, live = true, first = true, metadata, loginAttempted = false;
  const showError = message => { errorBox.textContent = message; };
  const lock = await holdControllerLock({locks, events, onRelease: () => { live = false; generation++; },
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
    if (!response.ok) { const error = new Error(body.error?.message || body.error || '연결 키와 네트워크를 확인하세요.'); error.status = response.status; throw error; }
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
    $('pair-token').value = '';
    $('pair-screen').hidden = true;
    return scoped;
  }
  let resolveLogin;
  const loginReady = new Promise(resolve => { resolveLogin = resolve; });
  form.addEventListener('submit', async event => {
    event.preventDefault(); loginAttempted = true; const button = form.querySelector('[type="submit"]'); button.disabled = true; showError('');
    try {
      let pending = storage.getItem('blackhole-web-login-request-v1');
      if (pending) pending = JSON.parse(pending);
      else { pending = {requestId: crypto.randomUUID(), name: 'BLACKHOLE 휴대폰 브라우저', remember: $('remember-browser').checked}; storage.setItem('blackhole-web-login-request-v1', JSON.stringify(pending)); }
      const value = await json('/api/web/session', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${$('pair-token').value.trim()}`}, body: JSON.stringify(pending), signal: AbortSignal.timeout(12000)});
      const scoped = activate(value);
      if (!first) { location.reload(); return; }
      first = false; resolveLogin(scoped);
    } catch (error) { if (error.status && [400,404,409,410,422].includes(error.status)) storage.removeItem('blackhole-web-login-request-v1'); showError(error.status === 401 ? '개인 연결 키를 확인해 주세요.' : error.message); }
    finally { button.disabled = false; }
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
