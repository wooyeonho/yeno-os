import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';

const runtimeRoot = new URL('../', import.meta.url);
const safeEnv = Object.fromEntries(
  ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'OS', 'ComSpec']
    .filter(name => process.env[name] !== undefined)
    .map(name => [name, process.env[name]]),
);

for (const [entry, args, ready] of [
  ['server.mjs', [], /ready at http:\/\/127\.0\.0\.1:\d+/],
  ['launch.mjs', ['--no-open'], /PC: http:\/\/127\.0\.0\.1:\d+/],
]) {
  test(`${entry} starts without exposing its owner credential on stdout or stderr`, async t => {
    const dataDir = mkdtempSync(join(tmpdir(), 'blackhole-startup-secrecy-'));
    const token = `synthetic-${randomBytes(24).toString('hex')}`;
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: runtimeRoot,
      env: {...safeEnv, YENO_TOKEN: token, YENO_DATA_DIR: dataDir, YENO_HOST: '127.0.0.1', YENO_PORT: '0'},
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const exit = new Promise(resolve => child.once('exit', resolve));
        child.kill();
        await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 3000))]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
      rmSync(dataDir, {recursive: true, force: true});
    });
    const deadline = Date.now() + 10000;
    while (!ready.test(output) && child.exitCode === null && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.match(output, ready, 'entrypoint should report its listening address');
    assert.equal(output.includes(token), false, 'startup output must not contain the owner credential');
    assert.equal(output.includes('PAIRING TOKEN:'), false, 'startup must not invite manual credential copying');
  });
}
