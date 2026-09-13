import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCodeBundle, validateCodeBundle, CodeSandboxError, CODE_LIMITS } from '../lib/code-sandbox.mjs';

const bundle = (content, input = null, more = []) => ({ entry: 'main.js', input, files: [{ path: 'main.js', content }, ...more] });
const codeIs = (...codes) => err => err instanceof CodeSandboxError && codes.includes(err.code);

test('genuine JavaScript supports algorithms, local modules and JSON results', async () => {
  const result = await executeCodeBundle(bundle("import { fibonacci } from './lib/math.mjs'; export const run = ({n}) => ({sequence:Array.from({length:n},(_,i)=>fibonacci(i))});", { n: 8 }, [
    { path: 'lib/math.mjs', content: "import {add} from '../add.js'; export function fibonacci(n) { if(n<2)return n; return add(fibonacci(n-1),fibonacci(n-2)); }" },
    { path: 'add.js', content: 'export const add = (a,b)=>a+b;' },
  ]));
  assert.deepEqual(result.output, { sequence: [0,1,1,2,3,5,8,13] });
  assert.equal(result.outputBytes, Buffer.byteLength(JSON.stringify(result.output)));
  assert.equal(result.engine, 'quickjs-wasm');
});

test('default export, pure promises, top-level await and local dynamic imports work', async () => {
  const result = await executeCodeBundle(bundle("const offset=await Promise.resolve(3); export default async ({n}) => { const {double} = await import('./double.js'); return {answer:double(n)+offset}; };", { n: 4 }, [{ path: 'double.js', content: 'export const double = n=>n*2;' }]));
  assert.deepEqual(result.output, { answer: 11 });
});

test('each invocation resets the heap, fixed clock, random seed and input', async () => {
  const input = { count: 7 };
  const source = bundle("globalThis.secret = 1; export function run(x){x.count++; return {count:x.count,clock:Date.now(),date:+new Date(),indirect:new Date().constructor.now(),random:[Math.random(),Math.random()]};}", input);
  const first = await executeCodeBundle(source);
  assert.deepEqual((await executeCodeBundle(source)).output, first.output);
  assert.equal(first.output.clock, 0); assert.equal(first.output.date, 0); assert.equal(first.output.indirect, 0);
  assert.equal(input.count, 7);
  assert.equal((await executeCodeBundle(bundle('export default () => typeof secret;'))).output, 'undefined');
});

test('Node, network, filesystem and host bridges are absent, including Function constructors', async () => {
  const result = await executeCodeBundle(bundle(`export function run() { return {
    process: typeof process, fetch: typeof fetch, require: typeof require, Buffer: typeof Buffer,
    WebAssembly: typeof WebAssembly, timers: typeof setTimeout, parentPort: typeof parentPort,
    constructor: ({}).constructor.constructor('return typeof process')()
  }; }`.replace('constructor:', 'indirect:')));
  assert.deepEqual(Object.values(result.output), Array(8).fill('undefined'));
  for (const specifier of ['node:fs', 'node:child_process', 'https://example.com/a.js', '/etc/passwd', '../../secret.js', 'lodash', 'data:text/javascript,export default 1']) {
    await assert.rejects(executeCodeBundle(bundle(`import * as forbidden from ${JSON.stringify(specifier)}; export default () => forbidden;`)), codeIs('EXECUTION_FAILED'));
  }
});

test('guest prototype modification cannot mutate host objects or escape the WASM heap', async () => {
  const result = await executeCodeBundle(bundle("Object.prototype.sandboxPollution='guest'; export const run=()=>({value:'ok'});"));
  assert.deepEqual(result.output, { value: 'ok' });
  assert.equal({}.sandboxPollution, undefined);
  await assert.rejects(executeCodeBundle(bundle('export const run=()=>JSON.parse(\'{"__proto__":{"polluted":true}}\');')), codeIs('OUTPUT_INVALID'));
  assert.equal({}.polluted, undefined);
});

test('CPU loops terminate without blocking the host event loop and leave executor usable', async () => {
  let hostTick = false;
  const tick = setTimeout(() => { hostTick = true; }, 30);
  const started = Date.now();
  await assert.rejects(executeCodeBundle(bundle('export function run(){while(true){}}'), { timeoutMs: 500 }), codeIs('TIMEOUT'));
  clearTimeout(tick);
  assert.equal(hostTick, true); assert.ok(Date.now() - started < 1800);
  assert.equal((await executeCodeBundle(bundle('export default () => 42;'))).output, 42);
});

test('memory exhaustion is contained to the disposable interpreter', async () => {
  await assert.rejects(executeCodeBundle(bundle('export default ()=>new ArrayBuffer(128*1024*1024);'), { timeoutMs: 3000 }), codeIs('MEMORY_LIMIT'));
  assert.equal((await executeCodeBundle(bundle('export default () => "alive";'))).output, 'alive');
});

test('abort before and during execution rejects only after terminating the worker', async () => {
  await assert.rejects(executeCodeBundle(bundle('export default()=>1;'), { signal: AbortSignal.abort() }), codeIs('ABORTED'));
  const controller = new AbortController();
  const active = executeCodeBundle(bundle('export function run(){while(true){}}'), { signal: controller.signal, timeoutMs: 3000 });
  setTimeout(() => controller.abort(), 250);
  await assert.rejects(active, codeIs('ABORTED'));
  assert.equal((await executeCodeBundle(bundle('export default()=>true;'))).output, true);
});

test('unresolved promises and endless microtask chains cannot hang execution', async () => {
  await assert.rejects(executeCodeBundle(bundle('export default()=>new Promise(()=>{});')), codeIs('UNRESOLVED_PROMISE'));
  await assert.rejects(executeCodeBundle(bundle('export default async()=>{while(true)await Promise.resolve();};'), { timeoutMs: 750 }), codeIs('TIMEOUT'));
});

test('bundle path, source size, input schema and timeout limits reject before execution', async () => {
  for (const path of ['../main.js', '/main.js', './main.js', 'lib//main.js', 'node:fs.js', 'a\\main.js', 'main.ts']) {
    assert.throws(() => validateCodeBundle({ entry: path, files: [{ path, content: 'export default()=>1' }], input: null }), CodeSandboxError);
  }
  assert.throws(() => validateCodeBundle(bundle(' '.repeat(CODE_LIMITS.sourceBytes) + 'export default()=>1')), codeIs('SOURCE_LIMIT'));
  assert.throws(() => validateCodeBundle(bundle('export default()=>1', 'x'.repeat(CODE_LIMITS.inputBytes))), codeIs('INPUT_LIMIT'));
  const circular = {}; circular.self = circular;
  for (const input of [undefined, NaN, Infinity, 1n, circular, new Date(), JSON.parse('{"constructor":3}'), [,1]]) assert.throws(() => validateCodeBundle({ ...bundle('export default()=>1'), input }), CodeSandboxError);
  const getter = { get read() { throw new Error('must not run'); } };
  assert.throws(() => validateCodeBundle(bundle('export default()=>1', getter)), CodeSandboxError);
  await assert.rejects(executeCodeBundle(bundle('export default()=>1'), { timeoutMs: 10000 }), CodeSandboxError);
});

test('outputs must be bounded finite JSON, without silent conversion or accessors', async () => {
  for (const expression of ['undefined', 'NaN', 'Infinity', '1n', '()=>1', 'new Date()', '({get a(){return 1}})', '(()=>{const x={};x.self=x;return x;})()', '({[Symbol("x")]:1})']) {
    await assert.rejects(executeCodeBundle(bundle(`export default()=>(${expression});`)), codeIs('OUTPUT_INVALID'));
  }
  await assert.rejects(executeCodeBundle(bundle(`export default()=>"가".repeat(${Math.ceil(CODE_LIMITS.outputBytes/3)});`)), codeIs('OUTPUT_LIMIT'));
  await assert.rejects(executeCodeBundle(bundle('export default()=>"x".repeat(300000);')), codeIs('OUTPUT_LIMIT'));
});

test('syntax errors and missing entry exports return usable failure reasons', async () => {
  await assert.rejects(executeCodeBundle(bundle('export function run( {')), codeIs('EXECUTION_FAILED'));
  await assert.rejects(executeCodeBundle(bundle('export const answer = 42;')), codeIs('ENTRY_INVALID'));
  await assert.rejects(executeCodeBundle(bundle('export default()=>{throw new Error("fixture failure");};')), err => err.code === 'EXECUTION_FAILED' && err.message.includes('fixture failure'));
});

test('guest serializer and prototype changes cannot substitute unchecked output', async () => {
  const result = await executeCodeBundle(bundle(`Array.prototype.toJSON = () => JSON.parse('{"__proto__":{"polluted":true}}'); JSON.stringify = () => '"forged"'; export default () => [1,2,3];`));
  assert.deepEqual(result.output, [1,2,3]);
  assert.equal({}.polluted, undefined);
});

test('concurrent requests are bounded and stopping releases executor slots', async () => {
  const controller = new AbortController();
  const active = [1,2].map(() => executeCodeBundle(bundle('export default()=>{while(true){}};'), { signal: controller.signal, timeoutMs: 3000 }));
  const completed = Promise.all(active.map(promise => assert.rejects(promise, codeIs('ABORTED'))));
  await assert.rejects(executeCodeBundle(bundle('export default()=>1;')), codeIs('SANDBOX_BUSY'));
  controller.abort(); await completed;
  assert.equal((await executeCodeBundle(bundle('export default()=>1;'))).output, 1);
});
