import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

export const CODE_LIMITS = Object.freeze({ files: 16, sourceBytes: 128 * 1024, inputBytes: 64 * 1024, outputBytes: 256 * 1024, memoryBytes: 32 * 1024 * 1024, maxTimeoutMs: 5000 });
export class CodeSandboxError extends Error {
  constructor(message, code = 'INVALID_BUNDLE', status = 422) { super(message); this.name = 'CodeSandboxError'; this.code = code; this.status = status; }
}
const fail = (message, code) => { throw new CodeSandboxError(message, code); };
const blockedKeys = new Set(['__proto__', 'prototype', 'constructor']);
let running = 0;

// Recheck the actual JSON crossing the worker boundary. Guest modifications to
// its own JSON/prototypes must never bypass the core's data-only contract.
function validateOutput(value, depth = 0, count = { n: 0 }) {
  if (++count.n > 10000 || depth > 20) fail('코드 출력 JSON의 크기 또는 깊이 제한을 넘었습니다.', 'OUTPUT_LIMIT');
  if (value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value))) return;
  if (typeof value !== 'object') fail('코드 출력은 유한한 JSON 값이어야 합니다.', 'OUTPUT_INVALID');
  for (const key of Object.keys(value)) {
    if (blockedKeys.has(key)) fail('코드 출력에 허용되지 않는 속성이 있습니다.', 'OUTPUT_INVALID');
    validateOutput(value[key], depth + 1, count);
  }
}

// This validates the transfer contract, not the source language. Source executes
// only in the separate QuickJS WASM heap; no Node host function is exposed to it.
export function validateCodeBundle({ files, entry, input } = {}) {
  if (!Array.isArray(files) || !files.length || files.length > CODE_LIMITS.files) fail('코드 파일은 1~16개여야 합니다.');
  const paths = new Set(); let bytes = 0;
  for (const file of files) {
    if (!file || typeof file !== 'object' || Object.keys(file).some(k => !['path', 'content'].includes(k))) fail('코드 파일 형식이 올바르지 않습니다.');
    if (typeof file.path !== 'string' || file.path.length > 180 || !/^[A-Za-z0-9_-][A-Za-z0-9_./-]*\.(?:m?js)$/.test(file.path) || file.path.split('/').some(p => !p || p === '.' || p === '..' || blockedKeys.has(p))) fail('코드 경로는 묶음 내부의 JS/MJS 상대 경로여야 합니다.');
    if (paths.has(file.path)) fail('중복 코드 경로입니다.');
    paths.add(file.path);
    if (typeof file.content !== 'string' || !file.content.trim()) fail('코드 파일 내용이 필요합니다.');
    bytes += Buffer.byteLength(file.content, 'utf8');
    if (bytes > CODE_LIMITS.sourceBytes) fail('코드 묶음은 128KiB 이하여야 합니다.', 'SOURCE_LIMIT');
  }
  if (typeof entry !== 'string' || !paths.has(entry)) fail('실행 진입 파일이 코드 묶음에 없습니다.');
  let nodes = 0;
  const visit = (value, depth, seen) => {
    if (++nodes > 10000 || depth > 20) fail('입력 JSON의 크기 또는 깊이 제한을 넘었습니다.', 'INPUT_LIMIT');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) fail('입력은 유한한 숫자를 포함한 JSON 값이어야 합니다.');
    if (seen.has(value)) fail('순환하는 입력은 사용할 수 없습니다.');
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') continue;
      if (typeof key !== 'string' || blockedKeys.has(key)) fail('입력에 허용되지 않는 속성이 있습니다.');
      const desc = Object.getOwnPropertyDescriptor(value, key);
      if (!desc.enumerable || !Object.hasOwn(desc, 'value')) fail('입력 JSON에 접근자나 숨긴 속성을 사용할 수 없습니다.');
      if (Array.isArray(value) && (!/^(0|[1-9][0-9]*)$/.test(key) || +key >= value.length)) fail('배열 입력에는 숫자 위치만 사용할 수 있습니다.');
      visit(desc.value, depth + 1, seen);
    }
    if (Array.isArray(value) && Object.keys(value).length !== value.length) fail('입력 배열의 빈 위치를 채워 주세요.');
    seen.delete(value);
  };
  visit(input, 0, new Set());
  const inputJson = JSON.stringify(input);
  if (Buffer.byteLength(inputJson, 'utf8') > CODE_LIMITS.inputBytes) fail('실행 입력은 64KiB 이하여야 합니다.', 'INPUT_LIMIT');
  return { files: files.map(f => ({ path: f.path, content: f.content })), entry, inputJson };
}

export async function executeCodeBundle(bundle, { signal, timeoutMs = 2000 } = {}) {
  if (signal?.aborted) throw new CodeSandboxError('코드 실행을 중단했습니다.', 'ABORTED');
  const checked = validateCodeBundle(bundle);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > CODE_LIMITS.maxTimeoutMs) fail('실행 시간 제한은 50~5000ms여야 합니다.');
  if (running >= 2) throw new CodeSandboxError('다른 격리 코드 실행이 끝난 뒤 다시 시도해 주세요.', 'SANDBOX_BUSY', 429);
  running++;
  const started = performance.now();
  let worker;
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err, value) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        // Wait for termination before releasing the concurrency slot or reporting stop.
        Promise.resolve(worker?.terminate()).catch(() => {}).then(() => err ? reject(err) : resolve(value));
      };
      const abort = () => finish(new CodeSandboxError('코드 실행을 중단했습니다.', 'ABORTED'));
      const timer = setTimeout(() => finish(new CodeSandboxError('코드 실행 시간 제한을 넘었습니다.', 'TIMEOUT')), timeoutMs);
      try {
        worker = new Worker(new URL('./code-sandbox-worker.mjs', import.meta.url), {
          workerData: { ...checked, deadline: Date.now() + timeoutMs, limits: CODE_LIMITS },
          env: { TZ: 'UTC' }, execArgv: [], stdout: true, stderr: true,
          resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
        });
        // Interpreter diagnostics are private to the worker and cannot flood core logs.
        worker.stdout.resume(); worker.stderr.resume();
        worker.once('message', msg => {
          if (!msg || msg.ok !== true) return finish(new CodeSandboxError(msg?.message || '격리 코드 실행에 실패했습니다.', msg?.code || 'EXECUTION_FAILED'));
          try {
            if (typeof msg.outputJson !== 'string' || Buffer.byteLength(msg.outputJson) > CODE_LIMITS.outputBytes) fail('코드 출력이 제한을 넘었습니다.', 'OUTPUT_LIMIT');
            const output = JSON.parse(msg.outputJson);
            validateOutput(output);
            finish(null, { output, outputBytes: Buffer.byteLength(msg.outputJson), durationMs: Math.round(performance.now() - started), engine: 'quickjs-wasm' });
          } catch (err) { finish(err); }
        });
        worker.once('error', err => finish(new CodeSandboxError(err.code === 'ERR_WORKER_OUT_OF_MEMORY' ? '격리 코드 메모리 제한을 넘었습니다.' : '격리 실행기를 시작하거나 실행하지 못했습니다.', err.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'MEMORY_LIMIT' : 'EXECUTION_FAILED')));
        worker.once('exit', () => { if (!settled) finish(new CodeSandboxError('격리 실행기가 결과 없이 종료됐습니다.', 'EXECUTION_FAILED')); });
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      } catch (err) { finish(err); }
    });
  } finally { running--; }
}
