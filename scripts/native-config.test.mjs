import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Tauri HTTP scopes use URLPattern. These checks exercise representative URLs;
// a native build and on-device request are still required to verify the plugin.
const capability = JSON.parse(readFileSync(new URL('../apps/controller/src-tauri/capabilities/default.json', import.meta.url)));
const http = capability.permissions.find(p => typeof p === 'object' && p.identifier === 'http:default');
const patterns = (http?.allow ?? []).map(p => new URLPattern(p.url));
const allowed = value => patterns.some(pattern => pattern.test(value));

test('native API scope accepts enrollment, nested results, and private HTTPS ports', () => {
  for (const url of [
    'https://yeno.example.com/api/v1/devices/enroll',
    'https://yeno.example.com/api/v1/artifacts/abcdef',
    'https://owner.ts.net:9443/api/v1/jobs/abcdef/action',
    'http://localhost:8790/api/v1/state',
    'http://127.0.0.1:8790/api/v1/state',
  ]) assert.equal(allowed(url), true, url);
});

test('native API scope rejects remote cleartext, non-API paths, and local files', () => {
  for (const url of [
    'http://yeno.example.com/api/v1/state',
    'http://localhost.evil.example:8790/api/v1/state',
    'https://yeno.example.com/admin',
    'https://yeno.example.com/api/state',
    'https://yeno.example.com/api/v1/../../admin',
    'file:///data/user/0/secret',
  ]) assert.equal(allowed(url), false, url);
});
