// Trusted worker wrapper. Guest source is NEVER evaluated by Node, imported by
// Node, or passed to a host callback. Each invocation owns one new WASM instance.
import { parentPort, workerData } from 'node:worker_threads';
import { posix } from 'node:path';
import { newQuickJSWASMModule } from 'quickjs-emscripten';

const { files, entry, inputJson, deadline, limits } = workerData;
const sources = new Map(files.map(file => [file.path, file.content]));
let runtime, context;
const handles = [];
const own = handle => { handles.push(handle); return handle; };
const error = (code, message) => Object.assign(new Error(message), { code });
const unwrap = result => {
  if (result.error) {
    let message = 'JavaScript 실행 오류';
    try { const value = context.dump(result.error); message = typeof value === 'string' ? value : String(value?.message || value?.name || message); } catch {}
    result.error.dispose();
    throw error(/out of memory/i.test(message) ? 'MEMORY_LIMIT' : /interrupted/i.test(message) ? 'TIMEOUT' : /OUTPUT_LIMIT/.test(message) ? 'OUTPUT_LIMIT' : /OUTPUT_INVALID/.test(message) ? 'OUTPUT_INVALID' : 'EXECUTION_FAILED', message.slice(0, 600));
  }
  return result.value;
};
const settled = handle => {
  for (let jobs = 0; jobs <= 10000; jobs++) {
    if (Date.now() >= deadline) throw error('TIMEOUT', '코드 실행 시간 제한을 넘었습니다.');
    const state = context.getPromiseState(handle);
    if (state.type === 'fulfilled') return own(state.value);
    if (state.type === 'rejected') return unwrap(state);
    if (!runtime.hasPendingJob()) throw error('UNRESOLVED_PROMISE', '외부 작업을 기다리는 Promise는 이 실행 환경에서 완료할 수 없습니다.');
    unwrap(runtime.executePendingJobs(1));
  }
  throw error('TIMEOUT', '비동기 계산 단계 제한을 넘었습니다.');
};

try {
  const module = await newQuickJSWASMModule();
  runtime = module.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(512 * 1024);
  runtime.setInterruptHandler(() => Date.now() >= deadline);
  runtime.setModuleLoader(name => sources.has(name) ? sources.get(name) : { error: new Error('코드 묶음에 없는 모듈입니다.') }, (base, request) => {
    if (typeof request !== 'string' || !/^(?:\.\/|\.\.\/)[A-Za-z0-9_./-]+\.(?:m?js)$/.test(request)) return { error: new Error('묶음 내부 상대 JS/MJS import만 사용할 수 있습니다.') };
    const resolved = posix.normalize(posix.join(posix.dirname(base), request));
    if (resolved.startsWith('../') || posix.isAbsolute(resolved) || !sources.has(resolved)) return { error: new Error('코드 묶음 바깥 모듈은 읽을 수 없습니다.') };
    return resolved;
  });
  context = runtime.newContext();
  // A fixed clock and seeded PRNG make repeat invocations reproducible. The
  // constructor is replaced too, preventing access to an unfixed original clock.
  own(unwrap(context.evalCode(`(() => {
    const NativeDate = Date;
    function FixedDate(...args) { return new.target ? Reflect.construct(NativeDate, args.length ? args : [0], new.target) : new NativeDate(0).toISOString(); }
    FixedDate.prototype = NativeDate.prototype;
    Object.defineProperty(FixedDate.prototype, 'constructor', { value: FixedDate });
    Object.defineProperties(FixedDate, { now: { value: () => 0 }, parse: { value: NativeDate.parse }, UTC: { value: NativeDate.UTC } });
    Object.defineProperty(globalThis, 'Date', { value: FixedDate, writable: false, configurable: false });
    let seed = 0x12345678;
    Object.defineProperty(Math, 'random', { value: () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }, writable: false, configurable: false });
  })()`, 'blackhole-clock.js', { type: 'global' })));
  // Capture trusted primordials before guest modules can mutate their globals.
  const serializer = own(unwrap(context.evalCode(`(() => {
    const stringify = JSON.stringify, keys = Object.keys, ownKeys = Reflect.ownKeys, descriptors = Object.getOwnPropertyDescriptors, proto = Object.getPrototypeOf, setProto = Object.setPrototypeOf, create = Object.create, isArray = Array.isArray, isFinite = Number.isFinite, own = Object.hasOwn, ObjProto = Object.prototype, Err = Error, toString = String, toNumber = Number;
    return value => {
      let nodes = 0; const ancestors = setProto([], null);
      function copy(v, depth) {
        if (++nodes > 10000 || depth > 20) throw new Err('OUTPUT_LIMIT: 출력 JSON 깊이/노드 제한');
        if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
        if (typeof v === 'number' && isFinite(v)) return v;
        if (typeof v !== 'object' || (!isArray(v) && proto(v) !== ObjProto && proto(v) !== null)) throw new Err('OUTPUT_INVALID: JSON 값만 반환할 수 있습니다.');
        for (let i = 0; i < ancestors.length; i++) if (ancestors[i] === v) throw new Err('OUTPUT_INVALID: 순환 출력');
        ancestors[ancestors.length] = v;
        const ds = descriptors(v), names = ownKeys(ds), out = isArray(v) ? setProto([], null) : create(null);
        if (isArray(v) && v.length > 10000) throw new Err('OUTPUT_LIMIT: 출력 배열 제한');
        for (let i = 0; i < names.length; i++) {
          const k = names[i], d = ds[k];
          if (isArray(v) && k === 'length') continue;
          if (typeof k !== 'string' || k === '__proto__' || k === 'constructor' || k === 'prototype' || !own(d, 'value') || !d.enumerable) throw new Err('OUTPUT_INVALID: 허용되지 않는 출력 속성');
          if (isArray(v) && (toString(toNumber(k)) !== k || toNumber(k) < 0 || toNumber(k) >= v.length || toNumber(k) % 1)) throw new Err('OUTPUT_INVALID: 배열 속성');
          out[k] = copy(d.value, depth + 1);
        }
        if (isArray(v) && keys(v).length !== v.length) throw new Err('OUTPUT_INVALID: 빈 배열 위치');
        ancestors.length--;
        return out;
      }
      const encoded = stringify(copy(value, 0));
      if (encoded.length > ${limits.outputBytes}) throw new Err('OUTPUT_LIMIT: 출력 크기 제한');
      return encoded;
    };
  })()`, 'blackhole-json.js', { type: 'global' })));
  const inputHandle = own(unwrap(context.evalCode(`JSON.parse(${JSON.stringify(inputJson)})`, 'blackhole-input.js', { type: 'global' })));
  const namespace = settled(own(unwrap(context.evalCode(sources.get(entry), entry, { type: 'module' }))));
  let fn = own(context.getProp(namespace, 'run'));
  if (context.typeof(fn) !== 'function') fn = own(context.getProp(namespace, 'default'));
  if (context.typeof(fn) !== 'function') throw error('ENTRY_INVALID', '진입 파일은 run(input) 또는 default 함수를 내보내야 합니다.');
  const result = settled(own(unwrap(context.callFunction(fn, context.undefined, inputHandle))));
  const outputHandle = own(unwrap(context.callFunction(serializer, context.undefined, result)));
  const outputJson = context.getString(outputHandle);
  if (Buffer.byteLength(outputJson) > limits.outputBytes) throw error('OUTPUT_LIMIT', '코드 출력은 256KiB 이하여야 합니다.');
  parentPort.postMessage({ ok: true, outputJson });
} catch (err) {
  const code = err.code || (/OUTPUT_LIMIT/.test(err.message) ? 'OUTPUT_LIMIT' : /OUTPUT_INVALID/.test(err.message) ? 'OUTPUT_INVALID' : 'EXECUTION_FAILED');
  parentPort.postMessage({ ok: false, code, message: String(err.message || '격리 실행 오류').slice(0, 600) });
} finally {
  for (let i = handles.length - 1; i >= 0; i--) { try { if (handles[i].alive) handles[i].dispose(); } catch {} }
  try { context?.dispose(); } catch {}
  try { runtime?.dispose(); } catch {}
  parentPort.close();
}
