import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {main} from '../../scripts/blackhole-check.mjs';

// The packaged check tool must be a real, runnable command (directive §9/F12):
// isolated mode proves enroll -> command -> artifact hash -> process restart ->
// same job/hash -> revoke on a throwaway runtime, and the report never carries
// a token. live mode without YENO_TOKEN must stop as BLOCKED, never guess.

const capture = async argv => {
  const out = []; const orig = console.log; console.log = (...a) => out.push(a.join(' '));
  try { const code = await main(argv); return {code, out}; } finally { console.log = orig; }
};

test('isolated mode passes the full loop on a throwaway runtime and reports the five minimal fields', async () => {
  const jsonPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bh-check-')), 'report.json');
  const {code, out} = await capture(['--mode', 'isolated', '--json', jsonPath]);
  assert.equal(code, 0, out.join('\n'));
  const report = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  assert.equal(report.jobStatus, 'completed');
  assert.equal(report.sameJobIdSameArtifactHash, true);
  assert.match(report.artifactSha256, /^[a-f0-9]{64}$/);
  assert.equal(report.deviceRevokeStatus, 'success');
  assert.equal(report.errorMessage, null);
  assert.equal(report.restartReadback, 'PASS(process_restart)');
  // F09: the isolated runtime is started from this same checked-out source
  // tree, so the identity the core reports about itself (never something the
  // tool assumes or is told) must equal this tool's own git HEAD - proving
  // the comparison is real, not a hardcoded true.
  assert.equal(report.deploymentSha, report.sourceSha);
  assert.equal(report.deployment, 'local');
  assert.equal(report.deploymentMatchesSource, true);
  assert.ok(report.steps.find(s => s.name === 'deployment_identity')?.ok);
  assert.equal(report.outcome, 'PASS');
  assert.ok(report.steps.find(s => s.name === 'revoked_token_rejected')?.ok);
  const text = out.join('\n') + fs.readFileSync(jsonPath, 'utf8');
  assert.doesNotMatch(text, /check-[0-9a-f-]{36}-[0-9a-f-]{36}/, 'the synthetic pairing token never appears in output or report');
  assert.match(out[0], /통과  health/);
  assert.match(out[0], /jobStatus=completed/);
});

test('live mode without YENO_TOKEN is BLOCKED with deviceTokenMissing (exit 3), nothing guessed', async () => {
  const saved = process.env.YENO_TOKEN; delete process.env.YENO_TOKEN;
  try {
    const {code, out} = await capture(['--mode', 'live', '--core', 'http://127.0.0.1:9']);
    assert.equal(code, 3);
    assert.match(out.join('\n'), /deviceTokenMissing/);
    assert.match(out.join('\n'), /jobStatus=NOT_RUN/);
  } finally { if (saved !== undefined) process.env.YENO_TOKEN = saved; }
});

test('basic mode against an unreachable core is BLOCKED, not FAIL, and marks the loop fields NOT_RUN', async () => {
  const {code, out} = await capture(['--mode', 'basic', '--core', 'http://127.0.0.1:9']);
  assert.equal(code, 3);
  const report = JSON.parse(out.at(-1));
  assert.equal(report.outcome, 'BLOCKED');
  assert.equal(report.sameJobIdSameArtifactHash, 'NOT_RUN');
});
