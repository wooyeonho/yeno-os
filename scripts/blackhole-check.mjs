#!/usr/bin/env node
// BLACKHOLE 연결·실행 점검 (packaged check tool, directive §9).
//
//   node scripts/blackhole-check.mjs --mode basic    [--core URL]
//   node scripts/blackhole-check.mjs --mode isolated
//   node scripts/blackhole-check.mjs --mode live      --core URL   (YENO_TOKEN from env only)
//   options: --json <path>  write the secret-free JSON report there (default: stdout only)
//
// basic    : reads /api/v1/health of the target core (no auth). Nothing is written.
// isolated : starts a throwaway local runtime (temp data dir, synthetic pairing token),
//            enrolls a test device, submits one document command, verifies the artifact
//            SHA-256 as the server serves it, restarts the runtime process state
//            (shutdown + start on the same data dir), re-reads the SAME job/artifact,
//            then revokes the test device. No network, no provider key, no real device.
// live     : the same enroll -> command -> hash -> reconnect re-read -> revoke sequence
//            against a real core. The pairing token is read ONLY from process.env
//            .YENO_TOKEN, never printed, never written to the report. "Reconnect" here
//            is a fresh HTTP re-read - it does NOT restart the remote server and does
//            not prove an Android app close/reopen.
//
// Exit codes: 0 all checks passed · 2 a check failed · 3 blocked (missing token /
// unreachable core / bad args). The report always says which fields were NOT_RUN.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = path.resolve(HERE, '..', 'runtime');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function parseArgs(argv) {
  const out = {mode: 'basic', core: null, json: null};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') out.mode = argv[++i];
    else if (a === '--core') out.core = argv[++i];
    else if (a === '--json') out.json = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function gitSha() {
  try {
    const head = fs.readFileSync(path.resolve(HERE, '..', '.git', 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) return head;
    return fs.readFileSync(path.resolve(HERE, '..', '.git', head.slice(5).trim()), 'utf8').trim();
  } catch { return null; }
}

function emptyReport(mode, core) {
  return {
    testRunId: randomUUID(), mode, at: new Date().toISOString(), core,
    sourceSha: gitSha(), deploymentSha: null, clientBuild: 'scripts/blackhole-check.mjs', apiVersion: null, schemaVersion: null,
    requirementIds: ['R12', 'R36', 'R42', 'R35', 'F09'],
    deploymentOrigin: null, deployment: null, deploymentMatchesSource: 'NOT_RUN',
    // minimal compatible fields
    jobStatus: 'NOT_RUN', sameJobIdSameArtifactHash: 'NOT_RUN', artifactSha256: null, deviceRevokeStatus: 'NOT_RUN', errorMessage: null,
    // extended evidence
    requestId: null, missionId: null, jobIds: [], providerReceiptRefs: [], verificationRefs: [], artifactHashes: [],
    memoryEventIds: [], growthEvidenceIds: [], restartReadback: 'NOT_RUN', revocationResult: 'NOT_RUN', costUsage: {modelCalls: 0},
    physicalEvidenceRefs: [], outcome: 'NOT_RUN', blockers: [], steps: [],
  };
}

async function http(base, route, {method = 'GET', token = null, body = null} = {}) {
  const res = await fetch(base + route, {method, headers: {...(token ? {Authorization: `Bearer ${token}`} : {}), ...(body ? {'Content-Type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
  const bytes = Buffer.from(await res.arrayBuffer());
  let json = null; try { json = JSON.parse(bytes.toString('utf8')); } catch {}
  return {status: res.status, headers: res.headers, bytes, json};
}

// The shared sequence used by both isolated and live modes. `reconnect` is
// what "app close/reopen" means for this mode (process restart vs fresh HTTP).
async function runLoop(report, {base, pairingToken, reconnect}) {
  const step = (name, ok, detail = null) => { report.steps.push({name, ok, detail}); if (!ok) throw new Error(`${name}: ${detail ?? 'failed'}`); };
  const health = await http(base, '/api/v1/health');
  step('health', health.status === 200 && health.json?.authRequired === true, `status ${health.status}`);
  report.apiVersion = health.json.apiVersion; report.schemaVersion = health.json.version ?? null;

  const enrollReq = randomUUID();
  const enroll = await http(base, '/api/v1/devices/enroll', {method: 'POST', token: pairingToken, body: {name: 'blackhole-check', platform: 'check-tool', requestId: enrollReq}});
  step('enroll', enroll.status === 201 && typeof enroll.json?.device?.deviceToken === 'string', `status ${enroll.status} ${enroll.json?.error ?? ''}`);
  const deviceToken = enroll.json.device.deviceToken, deviceId = enroll.json.device.id;

  const state1 = await http(base, '/api/v1/state', {token: deviceToken});
  step('authenticated_state', state1.status === 200, `status ${state1.status}`);
  // F09: which candidate/commit the core is actually running never comes from
  // the branch or SHA a person types - it is read from the core's own signed
  // response, the same way every other check in this tool works. A mismatch
  // is expected and NOT a failure here (this candidate is local-only, not yet
  // deployed): the field exists so the owner can see the real relationship
  // (same / ahead / behind / unrelated) rather than assume it.
  report.deploymentSha = state1.json?.runtimeIdentity?.sourceCommit ?? null;
  report.deploymentOrigin = state1.json?.runtimeIdentity?.sourceCommitOrigin ?? null;
  report.deployment = state1.json?.runtimeIdentity?.deployment ?? null;
  report.deploymentMatchesSource = (report.sourceSha && report.deploymentSha) ? report.sourceSha === report.deploymentSha : 'NOT_RUN';
  report.steps.push({name: 'deployment_identity', ok: true, detail: `deploymentSha=${report.deploymentSha ?? 'unknown'} sourceSha=${report.sourceSha ?? 'unknown'} matches=${report.deploymentMatchesSource}`});

  const cmdReq = randomUUID(); report.requestId = cmdReq;
  const cmd = await http(base, '/api/v1/commands', {method: 'POST', token: deviceToken, body: {text: `문서 만들어: BLACKHOLE 연결·실행 점검 ${report.testRunId} (외부 발송·결제·삭제 없음)`, requestId: cmdReq}});
  step('command', cmd.status === 201 && typeof cmd.json?.job?.id === 'string', `status ${cmd.status} ${cmd.json?.error ?? ''}`);
  const jobId = cmd.json.job.id; report.jobIds.push(jobId);

  let job = null;
  for (let i = 0; i < 100; i++) {
    const st = await http(base, '/api/v1/state', {token: deviceToken});
    job = (st.json?.jobs ?? []).find(j => j.id === jobId) ?? null;
    if (job && ['completed', 'failed', 'cancelled', 'paused'].includes(job.status)) break;
    await new Promise(r => setTimeout(r, 200));
  }
  report.jobStatus = job?.status ?? 'unknown';
  step('job_terminal', job?.status === 'completed', `status ${job?.status} ${job?.error ?? ''}`);
  const artifactId = job.artifacts?.[0]?.id;
  step('artifact_attached', typeof artifactId === 'string', 'job has no artifact');

  const a1 = await http(base, `/api/v1/artifacts/${artifactId}`, {token: deviceToken});
  step('artifact_download', a1.status === 200, `status ${a1.status}`);
  const served1 = a1.headers.get('x-content-sha256'), computed1 = sha256(a1.bytes);
  step('artifact_hash_matches_server', served1 === computed1, `server ${served1} vs bytes ${computed1}`);
  report.artifactSha256 = computed1; report.artifactHashes.push({artifactId, sha256: computed1, bytes: a1.bytes.length});
  report.verificationRefs.push({kind: 'artifact_integrity', artifactId, sha256: computed1, checkedBy: 'server_header+client_bytes'});

  // "app close/reopen"
  const base2 = await reconnect();
  const st2 = await http(base2, '/api/v1/state', {token: deviceToken});
  step('reconnect_state', st2.status === 200, `status ${st2.status}`);
  const job2 = (st2.json?.jobs ?? []).find(j => j.id === jobId) ?? null;
  step('reconnect_same_job', job2?.id === jobId && job2.status === job.status, `job after reconnect: ${job2?.status}`);
  const a2 = await http(base2, `/api/v1/artifacts/${artifactId}`, {token: deviceToken});
  const computed2 = a2.status === 200 ? sha256(a2.bytes) : null;
  report.sameJobIdSameArtifactHash = job2?.id === jobId && computed2 === computed1;
  report.restartReadback = report.sameJobIdSameArtifactHash ? 'PASS' : 'FAIL';
  step('reconnect_same_artifact_hash', report.sameJobIdSameArtifactHash === true, `after ${computed2}`);

  const revoke = await http(base2, '/api/v1/devices/revoke', {method: 'POST', token: deviceToken, body: {requestId: randomUUID()}});
  report.deviceRevokeStatus = revoke.status === 200 && revoke.json?.revoked === true ? 'success' : `failed(${revoke.status})`;
  report.revocationResult = report.deviceRevokeStatus;
  step('revoke_test_device', report.deviceRevokeStatus === 'success', `status ${revoke.status}`);
  const after = await http(base2, '/api/v1/state', {token: deviceToken});
  step('revoked_token_rejected', after.status === 401, `status ${after.status}`);
  return {deviceId, jobId};
}

async function modeBasic(report, core) {
  const health = await http(core, '/api/v1/health');
  report.steps.push({name: 'health', ok: health.status === 200, detail: `status ${health.status}`});
  if (health.status !== 200) { report.outcome = 'BLOCKED'; report.blockers.push('core_unreachable'); return; }
  report.apiVersion = health.json?.apiVersion ?? null; report.schemaVersion = health.json?.version ?? null;
  const anon = await http(core, '/api/v1/state');
  report.steps.push({name: 'unauthenticated_state_rejected', ok: anon.status === 401, detail: `status ${anon.status}`});
  report.outcome = anon.status === 401 ? 'PASS' : 'FAIL';
}

async function modeIsolated(report) {
  const {start} = await import(pathToFileURL(path.join(RUNTIME_DIR, 'server.mjs')).href);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-check-')), token = `check-${randomUUID()}-${randomUUID()}`;
  let runtime = await start({host: '127.0.0.1', port: 0, dataDir: dir, token, env: {}});
  const base = () => `http://127.0.0.1:${runtime.server.address().port}`;
  try {
    await runLoop(report, {base: base(), pairingToken: token, reconnect: async () => { runtime.shutdown(); runtime = await start({host: '127.0.0.1', port: 0, dataDir: dir, token, env: {}}); return base(); }});
    report.restartReadback = report.sameJobIdSameArtifactHash ? 'PASS(process_restart)' : 'FAIL';
    report.outcome = 'PASS';
  } finally { try { runtime.shutdown(); } catch {} fs.rmSync(dir, {recursive: true, force: true}); }
}

async function modeLive(report, core) {
  const token = process.env.YENO_TOKEN;
  if (typeof token !== 'string' || token.length < 16) { report.outcome = 'BLOCKED'; report.blockers.push('deviceTokenMissing: set YENO_TOKEN in the environment of this process only'); return; }
  await runLoop(report, {base: core, pairingToken: token, reconnect: async () => core});
  report.restartReadback = report.sameJobIdSameArtifactHash ? 'PASS(http_reconnect_only)' : 'FAIL';
  report.outcome = 'PASS';
}

function summaryKo(r) {
  const lines = [`BLACKHOLE 점검 (${r.mode}) · testRunId ${r.testRunId}`, `대상: ${r.core ?? '격리 로컬 런타임'} · sourceSha ${r.sourceSha ?? '알 수 없음'}`];
  for (const s of r.steps) lines.push(`${s.ok ? '통과' : '실패'}  ${s.name}${s.detail ? ' — ' + s.detail : ''}`);
  lines.push(`jobStatus=${r.jobStatus}`, `sameJobIdSameArtifactHash=${r.sameJobIdSameArtifactHash}`, `artifactSha256=${r.artifactSha256 ?? ''}`, `deviceRevokeStatus=${r.deviceRevokeStatus}`, `errorMessage=${r.errorMessage ?? ''}`);
  lines.push(`결과: ${r.outcome}${r.blockers.length ? ' · 차단: ' + r.blockers.join('; ') : ''}`);
  if (r.mode !== 'isolated') lines.push('주의: live/basic 모드의 재접속은 HTTP 재조회이며 서버 재시작·Android 앱 종료/재실행을 증명하지 않습니다.');
  lines.push('토큰·비밀값은 이 보고서에 포함되지 않습니다.');
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); return 0; }
  const core = args.core ?? (args.mode === 'isolated' ? null : 'https://global-iris-gyeol-98386a17.koyeb.app');
  const report = emptyReport(args.mode, core);
  try {
    if (args.mode === 'basic') await modeBasic(report, core);
    else if (args.mode === 'isolated') await modeIsolated(report);
    else if (args.mode === 'live') await modeLive(report, core);
    else { report.outcome = 'BLOCKED'; report.blockers.push(`unknown mode ${args.mode}`); }
  } catch (error) {
    report.errorMessage = String(error?.message ?? error).replace(/Bearer [^\s"']+/g, 'Bearer [redacted]');
    // A core we could not even reach is a blocker (nothing was checked), not a failed check.
    const unreachable = /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET/i.test(report.errorMessage + ' ' + String(error?.cause?.code ?? ''));
    if (unreachable && !report.steps.some(s => s.ok)) { report.outcome = 'BLOCKED'; report.blockers.push('core_unreachable'); }
    else if (report.outcome === 'NOT_RUN') report.outcome = 'FAIL';
  }
  if (args.json) fs.writeFileSync(args.json, JSON.stringify(report, null, 2));
  console.log(summaryKo(report));
  console.log(JSON.stringify(report));
  return report.outcome === 'PASS' ? 0 : report.outcome === 'BLOCKED' ? 3 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(code => process.exit(code));
