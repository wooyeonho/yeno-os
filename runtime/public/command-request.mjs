// One unresolved command per browser tab. A retry must retain its request ID
// and payload because losing a response does not mean the server rejected it.
const DEFAULT_KEY = 'yeno-pending-command-v1';
const ALLOWED_PATHS = new Set(['/api/commands', '/api/jobs']);

function validRequest(value, allowPath) {
  return value?.version === 1 && typeof value.path === 'string' && allowPath(value.path) &&
    value.body && typeof value.body === 'object' && !Array.isArray(value.body) &&
    typeof value.body.requestId === 'string' && value.body.requestId.length > 0;
}

export function createCommandRequest({storage, transport, key = DEFAULT_KEY,
  makeId = () => crypto.randomUUID(), now = () => new Date().toISOString(),
  allowPath = (path) => ALLOWED_PATHS.has(path)}) {
  const stored = storage.getItem(key);
  let pending = stored === null ? null : JSON.parse(stored);
  if (stored !== null && !validRequest(pending, allowPath)) throw new Error('보관된 명령 요청을 읽을 수 없습니다.');
  let inFlight = null;
  const copy = (value) => value === null ? null : structuredClone(value);
  const clear = () => {
    // Keep the in-memory request if storage cannot be cleared. Retrying the
    // same accepted request remains safe under the server's idempotency ledger.
    storage.removeItem(key);
    pending = null;
  };

  return {
    get pending() { return copy(pending); },
    get sending() { return inFlight !== null; },
    stage(path, body) {
      if (pending) throw new Error('이전 명령의 접수 여부를 먼저 확인해 주세요.');
      if (typeof path !== 'string' || !allowPath(path)) throw new Error('지원하지 않는 명령 경로입니다.');
      const request = {version: 1, path, body: {...copy(body), requestId: makeId()}, createdAt: now()};
      if (!validRequest(request, allowPath)) throw new Error('명령 요청을 저장할 수 없습니다.');
      // Persist before the first network request, including the exact payload.
      storage.setItem(key, JSON.stringify(request));
      pending = request;
      return copy(pending);
    },
    send() {
      if (inFlight) return inFlight;
      if (!pending) return Promise.reject(new Error('다시 확인할 명령이 없습니다.'));
      const request = copy(pending);
      // Defer transport until inFlight is assigned, preventing duplicate sends.
      inFlight = Promise.resolve().then(async () => {
        try {
          const result = await transport(request.path, copy(request.body));
          clear();
          return {kind: 'accepted', result, request};
        } catch (error) {
          // A timeout, lost response, invalid success body, or 5xx can all follow
          // an accepted command. HTTP 408 likewise does not settle acceptance.
          // Authentication/Host checks happen before receipt lookup. A 401/403
          // after a lost response cannot prove the original write was rejected;
          // retain it so reconnecting can recover the same accepted receipt.
          const definite = Number.isInteger(error?.status) && error.status >= 400 &&
            error.status < 500 && ![401, 403, 408].includes(error.status);
          if (definite) {
            try { clear(); }
            catch (storageError) { return {kind: 'uncertain', error: storageError, request}; }
            return {kind: 'rejected', error, request};
          }
          return {kind: 'uncertain', error, request};
        }
      }).finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}
