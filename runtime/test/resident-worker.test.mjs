// Static policy tripwires only. Real execution is in resident-runtime.test.mjs
// and Windows PowerShell Task Scheduler CI; these alone are not acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const script = read('../../scripts/blackhole-resident.ps1');
const resident = read('../resident.mjs');

test('resident uses existing standalone runtime; hosted Linux lease stays intact', () => {
  assert.ok(resident.includes("import { start } from './server.mjs'"));
  assert.doesNotMatch(resident, /containerLease:\s*true/);
  assert.match(read('../service.mjs'), /containerLease:\s*true/);
  assert.ok(script.includes('runtime\\resident.mjs'));
  assert.doesNotMatch(script, /service\.mjs/);
});

test('installer has one complete dispatcher and bounded resident task policy', () => {
  assert.equal(script.split('switch ($Action)').length - 1, 1);
  const names = [...script.matchAll(/^function ([\w-]+)/gm)].map(m => m[1]);
  assert.equal(new Set(names).size, names.length);
  for (const action of ['install','start','stop','restart','status','uninstall','run','phone-install','phone-uninstall']) {
    assert.ok(script.includes("'" + action + "' {"));
  }
  assert.match(script, /-LogonType Interactive\b/);
  assert.doesNotMatch(script, /-LogonType InteractiveToken\b/);
  assert.ok(script.includes('-ExecutionTimeLimit ([TimeSpan]::Zero)'));
  assert.ok(script.includes('-MultipleInstances IgnoreNew'));
  assert.ok(script.includes('-RestartCount 5'));
});

test('installer preserves ownership and data with masked pairing-key input', () => {
  assert.ok(script.includes('-AsSecureString'));
  assert.ok(script.includes('ZeroFreeBSTR'));
  assert.ok(script.includes('SetAccessRuleProtection($true,$false)'));
  assert.ok(script.includes('InitializeNewStore'));
  assert.ok(script.includes('function Get-OwnedTask'));
  assert.doesNotMatch(script, /Stop-Process|taskkill|Stop-ScheduledTask|Remove-Item/);
  assert.doesNotMatch(script, /ExecutionPolicy Bypass|Register-ScheduledTask[^\n]*-Force/);
});

test('Windows CI executes real parser and scheduler acceptance', () => {
  const workflow = read('../../.github/workflows/windows-resident.yml');
  const acceptance = read('../../scripts/test-resident-windows.ps1');
  assert.ok(workflow.includes('runs-on: windows-latest'));
  assert.ok(workflow.includes('shell: powershell'));
  assert.ok(workflow.includes('test-resident-windows.ps1'));
  assert.ok(acceptance.includes('Parser]::ParseFile'));
  assert.ok(acceptance.includes('Export-ScheduledTask'));
  assert.ok(acceptance.includes('artifactSha256'));
});
