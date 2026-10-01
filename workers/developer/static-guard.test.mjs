import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCandidatePatchPolicy, StaticPolicyError} from './static-guard.mjs';

const check = (content, path = 'projects/demo/main.mjs') => assertCandidatePatchPolicy({changes: [{path, content}]});
const denied = (content, path, reason) => assert.throws(() => check(content, path), error => error instanceof StaticPolicyError && error.code === 'static_policy_rejected' && error.reason === reason);

test('safe algorithms, literal mentions in comments, local project imports and TypeScript types remain eligible', () => {
  assert.equal(check("// fetch('https://example.invalid') is only a comment\nimport {sum} from './math.mjs'; export const run = xs => sum(xs);"), true);
  assert.equal(check('export function sum(xs: number[]): number { return xs.reduce((a, b) => a + b, 0); }', 'projects/demo/main.ts'), true);
  assert.equal(check('<a href="https://example.org">Read source</a>', 'projects/demo/index.html'), true);
});

test('candidate JS/TS cannot directly call network or host APIs before Docker runs', () => {
  denied("export const run = () => fetch('https://example.invalid');", 'projects/demo/main.mjs', 'direct_effect');
  denied("export const run = () => globalThis['fetch']('https://example.invalid');", 'projects/demo/main.mjs', 'direct_effect');
  denied('const send = globalThis.fetch; export const run = () => send();', 'projects/demo/main.mjs', 'direct_effect');
  denied('const send = fetch; export const run = () => send();', 'projects/demo/main.mjs', 'direct_effect');
  denied('export const x = process.env.TOKEN;', 'projects/demo/main.mjs', 'host_global');
  denied("export const x = globalThis['process']['env'];", 'projects/demo/main.mjs', 'host_global');
  denied("import fs from 'node:fs'; export const x = fs.writeFileSync;", 'projects/demo/main.mjs', 'external_import');
  denied("export const x = require('node:fs');", 'projects/demo/main.mjs', 'direct_effect');
  denied("export const x = import('./inside.mjs');", 'projects/demo/main.mjs', 'dynamic_import');
  denied("import {x} from '../../runtime/lib/store.mjs'; export {x};", 'projects/demo/main.mjs', 'import_outside_projects');
});

test('candidate source rejects embedded credential shapes without repeating the value in an error', () => {
  const value = 'sk-abcdefghijklmnopqrstuvwxyz1234';
  assert.throws(() => check(`export const key = '${value}';`), error => error.code === 'static_policy_rejected' && error.reason === 'secret_literal' && !error.message.includes(value));
});

test('model-authored markup cannot silently load remote resources or executable markup', () => {
  denied('<script>alert(1)</script>', 'projects/demo/index.html', 'active_markup');
  denied('<img src="https://example.invalid/pixel">', 'projects/demo/index.html', 'external_resource');
  denied('<img src="//example.invalid/pixel">', 'projects/demo/index.html', 'external_resource');
  denied('<link rel="stylesheet" href="https://example.invalid/style.css">', 'projects/demo/index.html', 'external_resource');
  denied('<img srcset="https://example.invalid/pixel 1x">', 'projects/demo/index.html', 'external_resource');
  denied('.card{background:url(https://example.invalid/pixel)}', 'projects/demo/main.css', 'external_resource');
  denied('<svg><image href="https://example.invalid/x.png" /></svg>', 'projects/demo/icon.svg', 'active_svg_reference');
});
