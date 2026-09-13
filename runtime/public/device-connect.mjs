// A displayed request reference cannot sign in. The secret proof is confined
// to an HttpOnly cookie, and the server requires a separate owner approval.
export function deviceConnect({document: doc, json, onConnected, isLive, events}) {
  const button = doc.getElementById('device-connect');
  if (!button) return;
  const status = doc.getElementById('device-connect-status');
  const reference = doc.getElementById('device-connect-reference');
  let timer, busy = false, waiting = false, stopped = false, delay = 3000;
  const active = () => !stopped && isLive();
  function stop() { stopped = true; clearTimeout(timer); }
  events.addEventListener('pagehide', stop, {once: true});
  const schedule = () => { clearTimeout(timer); if (active() && waiting) timer = setTimeout(poll, delay); };
  async function receive(value) {
    if (!active()) return;
    if (value.authenticated === true) {
      try { await onConnected(value); }
      catch (error) { status.textContent = error.message || '보관된 작업을 확인하지 못했습니다. 이 화면을 유지해 주세요.'; }
      finally { stop(); }
      return;
    }
    if (value.status !== 'pending' || !/^[a-f0-9-]{36}$/.test(value.id)) throw new Error('연결 요청 응답을 확인하지 못했습니다.');
    waiting = true; delay = 3000;
    reference.textContent = value.id;
    reference.hidden = false;
    status.textContent = '소유자 확인을 기다리고 있습니다. 확인되면 이 기기에서 운영실이 자동으로 열립니다.';
    button.textContent = '연결 상태 확인';
    schedule();
  }
  function failure(error, quiet = false) {
    if (!active()) return;
    if ([401, 404, 410].includes(error.status) || error.code === 'WEB_PAIRING_REVOKED') {
      const hadRequest = waiting;
      waiting = false; clearTimeout(timer); reference.textContent = ''; reference.hidden = true;
      button.textContent = '이 기기 연결';
      if (!quiet || hadRequest) status.textContent = '연결 요청이 만료됐습니다. 이 기기 연결을 다시 눌러 주세요.';
      return;
    }
    if (!quiet) status.textContent = error.status === 429
      ? `요청이 많습니다. ${error.retryAfterSeconds || 300}초 후 다시 연결해 주세요.`
      : '연결 상태를 받지 못했습니다. 인터넷이 연결되면 같은 요청을 다시 확인합니다.';
    delay = Math.min(15000, delay * 2); schedule();
  }
  async function poll(quiet = false) {
    if (!active() || busy) return;
    busy = true;
    try { await receive(await json('/api/web/pairing', {signal: AbortSignal.timeout(12000)})); }
    catch (error) { failure(error, quiet); }
    finally { busy = false; }
  }
  button.addEventListener('click', async () => {
    if (!active() || busy) return;
    clearTimeout(timer);
    if (waiting) { await poll(); return; }
    busy = true; button.disabled = true; status.textContent = '이 기기의 연결 요청을 만들고 있습니다…';
    try {
      let value = await json('/api/web/pairing', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({remember: doc.getElementById('remember-browser').checked}), signal: AbortSignal.timeout(12000)});
      if (value.status === 'approved' && !value.authenticated) value = await json('/api/web/pairing', {signal: AbortSignal.timeout(12000)});
      await receive(value);
    } catch (error) { failure(error); }
    finally { busy = false; button.disabled = !active(); }
  });
  // Recover an existing request on reopen; never create a request on page load.
  void poll(true);
  return {stop};
}
