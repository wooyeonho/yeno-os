import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const script = fs.readFileSync(
  new URL('../../scripts/blackhole-resident.ps1', import.meta.url),
  'utf8'
);

test('resident launcher reuses the hosted service entrypoint', () => {
  assert.match(script, /runtime[\\/']\s*['"]?service\.mjs/);
  assert.match(script, /YENO_TOKEN_FILE/);
  assert.match(script, /YENO_DATA_DIR/);
  assert.match(script, /service\.mjs/);
});

test('resident launcher has one-instance and restart protections', () => {
  assert.match(script, /BLACKHOLE Core/);
  assert.match(script, /MultipleInstances\s+IgnoreNew/);
  assert.match(script, /RestartCount\s+5/);
  assert.match(script, /acquire|lock/i);
});

test('resident launcher keeps the local service loopback-only and never prints secrets', () => {
  assert.match(script, /YENO_HOST\s*=\s*['"]127\.0\.0\.1['"]/);
  assert.match(script, /never prints|never.*value/i);
  assert.match(script, /RemoveSecret/);
  assert.match(script, /Unregister-ScheduledTask/);
});
