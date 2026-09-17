#!/usr/bin/env node
// BLACKHOLE Android release pipeline helper (owner-controlled persistent signing,
// monotonic versioning, release App Bundle + APK, no secrets in repo/logs).
//
//   node scripts/android-release.mjs check                       versioning + signing readiness (no secret values printed)
//   node scripts/android-release.mjs configure --gen <gen/android> write keystore.properties + patch build.gradle.kts (after `tauri android init`)
//   node scripts/android-release.mjs permissions --gen <gen/android> add RECORD_AUDIO to AndroidManifest.xml (after `tauri android init`; safe for debug and release builds, no secrets needed)
//   node scripts/android-release.mjs ledger --apk <p> --aab <p>  append the built release to docs/builds/android-release-ledger.json
//
// Signing material is supplied ONLY through environment variables (GitHub
// secrets / owner shell); the keystore is decoded to a path outside the
// repository and referenced from gen/android/keystore.properties, which is
// gitignored together with gen/android itself. Missing material fails closed
// (exit 2, `BLOCKED: ANDROID_SIGNING_SECRET`); a debug-signed artifact is never
// a release. Pure helpers are exported for scripts/android-release.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const SIGNING_ENV = Object.freeze({
  keystoreBase64: 'YENO_ANDROID_KEYSTORE_BASE64',
  keystorePassword: 'YENO_ANDROID_KEYSTORE_PASSWORD',
  keyAlias: 'YENO_ANDROID_KEY_ALIAS',
  keyPassword: 'YENO_ANDROID_KEY_PASSWORD'
});
export const APP_IDENTIFIER = 'kr.yeno.controller';
export const LEDGER_FIELDS = Object.freeze(['sourceCommit', 'versionName', 'versionCode', 'apkSha256', 'aabSha256', 'signerSha256', 'builtAt', 'workflowRun']);
const SEMVER = /^\d+\.\d+\.\d+$/;
const HEX64 = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..');
export const TAURI_CONF = path.join(REPO_ROOT, 'apps/controller/src-tauri/tauri.conf.json');
export const LEDGER_PATH = path.join(REPO_ROOT, 'docs/builds/android-release-ledger.json');

export class ReleaseError extends Error {
  constructor(message, code = 'RELEASE_INVALID', exitCode = 1) {super(message); this.code = code; this.exitCode = exitCode;}
}

// --- versioning ----------------------------------------------------------------

export function readVersioning(conf) {
  const versionName = conf?.version;
  const versionCode = conf?.bundle?.android?.versionCode;
  const identifier = conf?.identifier;
  if (typeof versionName !== 'string' || !SEMVER.test(versionName)) throw new ReleaseError('tauri.conf.json version은 MAJOR.MINOR.PATCH여야 합니다.');
  if (!Number.isInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) throw new ReleaseError('bundle.android.versionCode는 1..2100000000 정수여야 합니다.');
  if (identifier !== APP_IDENTIFIER) throw new ReleaseError(`identifier가 ${APP_IDENTIFIER}에서 바뀌면 기존 설치 위 업데이트가 불가능합니다.`, 'IDENTIFIER_CHANGED');
  return {versionName, versionCode, identifier};
}

// versionCode must strictly increase over every released build; versionName
// must not go backwards and a repeated versionName must still carry a higher
// versionCode (Play rejects reused codes; devices refuse downgrades).
export function validateVersioning(current, ledger) {
  const releases = validateLedger(ledger);
  const last = releases.at(-1) ?? null;
  const reasons = [];
  if (last) {
    if (current.versionCode <= last.versionCode) reasons.push(`versionCode ${current.versionCode}는 마지막 릴리스 ${last.versionCode}보다 커야 합니다.`);
    if (compareSemver(current.versionName, last.versionName) < 0) reasons.push(`versionName ${current.versionName}은 마지막 릴리스 ${last.versionName}보다 낮을 수 없습니다.`);
    if (releases.some(r => r.versionCode === current.versionCode)) reasons.push('이미 사용한 versionCode입니다.');
  }
  return {ok: reasons.length === 0, reasons, last};
}
const compareSemver = (a, b) => {
  const [x, y] = [a, b].map(v => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

export function validateLedger(ledger) {
  if (!ledger || typeof ledger !== 'object' || ledger.version !== 1 || !Array.isArray(ledger.releases)) throw new ReleaseError('ledger는 {version:1, releases[]}여야 합니다.', 'LEDGER_INVALID');
  let prev = 0;
  for (const r of ledger.releases) {
    const keys = Object.keys(r);
    if (keys.length !== LEDGER_FIELDS.length || !LEDGER_FIELDS.every(k => Object.hasOwn(r, k))) throw new ReleaseError('ledger 기록 필드가 올바르지 않습니다.', 'LEDGER_INVALID');
    if (!SHA.test(r.sourceCommit) || !SEMVER.test(r.versionName) || !Number.isInteger(r.versionCode) || !HEX64.test(r.apkSha256) || !HEX64.test(r.aabSha256) || !HEX64.test(r.signerSha256) || !ISO.test(r.builtAt) || typeof r.workflowRun !== 'string') throw new ReleaseError('ledger 기록 값이 올바르지 않습니다.', 'LEDGER_INVALID');
    if (r.versionCode <= prev) throw new ReleaseError('ledger versionCode가 단조 증가하지 않습니다.', 'LEDGER_INVALID');
    prev = r.versionCode;
  }
  return ledger.releases;
}

// Same signer certificate across releases is what makes an install-over-
// install update possible (and keeps the app's vault/device state). A signer
// change is refused unless the ledger is empty.
export function appendLedger(ledger, record) {
  const releases = validateLedger(ledger);
  const next = {version: 1, releases: [...releases, record]};
  validateLedger(next);
  const last = releases.at(-1);
  if (last && last.signerSha256 !== record.signerSha256) throw new ReleaseError('서명 인증서가 이전 릴리스와 다릅니다 — 기존 설치 위 업데이트가 불가능합니다.', 'SIGNER_CHANGED');
  return next;
}

// --- signing ---------------------------------------------------------------------

// Reports presence only; never the values, never their lengths beyond "set".
export function signingEnvStatus(env) {
  const missing = Object.entries(SIGNING_ENV).filter(([, name]) => !(typeof env[name] === 'string' && env[name].trim().length > 0)).map(([, name]) => name);
  let keystoreDecodes = null;
  if (!missing.includes(SIGNING_ENV.keystoreBase64)) {
    try {keystoreDecodes = Buffer.from(env[SIGNING_ENV.keystoreBase64], 'base64').length > 0;} catch {keystoreDecodes = false;}
  }
  return {ready: missing.length === 0 && keystoreDecodes === true, missing, keystoreDecodes};
}

export function keystorePropertiesText({storeFile, keyAlias, storePassword, keyPassword}) {
  const esc = v => String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
  return `storeFile=${esc(storeFile)}\nkeyAlias=${esc(keyAlias)}\nstorePassword=${esc(storePassword)}\nkeyPassword=${esc(keyPassword)}\n`;
}

const SIGNING_BLOCK = `    signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            if (!keystorePropertiesFile.exists()) {
                throw GradleException("keystore.properties missing: release builds require owner signing material (BLOCKED: ANDROID_SIGNING_SECRET)")
            }
            val keystoreProperties = java.util.Properties()
            java.io.FileInputStream(keystorePropertiesFile).use { keystoreProperties.load(it) }
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["keyPassword"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["storePassword"] as String
        }
    }
`;
const MARKER = '// yeno-release-signing';

// Patch the Tauri-generated app/build.gradle.kts so `release` uses the owner
// keystore. Idempotent; fails closed when the template shape is unexpected so
// a silently debug-signed "release" cannot come out of CI.
export function patchGradle(source) {
  if (source.includes(MARKER)) return {changed: false, source};
  const buildTypes = source.match(/^(\s*)buildTypes\s*\{/m);
  if (!buildTypes) throw new ReleaseError('build.gradle.kts에서 buildTypes 블록을 찾지 못했습니다.', 'GRADLE_SHAPE');
  const release = source.match(/getByName\("release"\)\s*\{/);
  if (!release) throw new ReleaseError('build.gradle.kts에서 release buildType을 찾지 못했습니다.', 'GRADLE_SHAPE');
  if (/signingConfigs\s*\{/.test(source)) throw new ReleaseError('build.gradle.kts에 이미 다른 signingConfigs가 있습니다.', 'GRADLE_SHAPE');
  let out = source.slice(0, buildTypes.index) + `${MARKER}\n` + SIGNING_BLOCK + source.slice(buildTypes.index);
  out = out.replace(/getByName\("release"\)\s*\{/, m => `${m}\n            signingConfig = signingConfigs.getByName("release")`);
  return {changed: true, source: out};
}

// --- Android manifest permissions ----------------------------------------------

// Native Live Voice (issue #21) needs RECORD_AUDIO for getUserMedia() inside
// the WebView; nothing else. gen/android is regenerated fresh by `tauri
// android init` and gitignored, so the permission is injected here as a
// POST-init patch rather than hand-edited in the repo. Idempotent and
// tolerant of any attribute order/whitespace on the <manifest> tag; fails
// closed if no <manifest> tag is found at all, so a template shape change
// can never silently ship without the permission.
const RECORD_AUDIO_PERMISSION = 'android.permission.RECORD_AUDIO';

export function patchManifestPermissions(source) {
  if (source.includes(RECORD_AUDIO_PERMISSION)) return {changed: false, source};
  const manifestOpen = source.match(/<manifest\b[^>]*>/);
  if (!manifestOpen) throw new ReleaseError('AndroidManifest.xml에서 <manifest> 태그를 찾지 못했습니다.', 'MANIFEST_SHAPE');
  const insertAt = manifestOpen.index + manifestOpen[0].length;
  const line = `\n    <uses-permission android:name="${RECORD_AUDIO_PERMISSION}" />`;
  return {changed: true, source: source.slice(0, insertAt) + line + source.slice(insertAt)};
}

export function configurePermissions({genDir}) {
  const manifestPath = path.join(genDir, 'app', 'src', 'main', 'AndroidManifest.xml');
  if (!fs.existsSync(manifestPath)) throw new ReleaseError(`${manifestPath} 없음 — 먼저 tauri android init을 실행하세요.`, 'GEN_MISSING');
  const patched = patchManifestPermissions(fs.readFileSync(manifestPath, 'utf8'));
  if (patched.changed) fs.writeFileSync(manifestPath, patched.source);
  return {manifestPatched: patched.changed};
}

export function configureSigning({genDir, env, keystoreDir}) {
  const status = signingEnvStatus(env);
  if (!status.ready) throw new ReleaseError(`BLOCKED: ANDROID_SIGNING_SECRET (missing: ${status.missing.join(', ') || 'keystore undecodable'})`, 'SIGNING_MISSING', 2);
  const gradlePath = path.join(genDir, 'app', 'build.gradle.kts');
  if (!fs.existsSync(gradlePath)) throw new ReleaseError(`${gradlePath} 없음 — 먼저 tauri android init을 실행하세요.`, 'GEN_MISSING');
  const resolvedKeystoreDir = keystoreDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'yeno-keystore-'));
  if (path.resolve(resolvedKeystoreDir).startsWith(REPO_ROOT + path.sep)) throw new ReleaseError('keystore는 저장소 밖에 두어야 합니다.', 'KEYSTORE_IN_REPO');
  const storeFile = path.join(resolvedKeystoreDir, 'release.jks');
  fs.writeFileSync(storeFile, Buffer.from(env[SIGNING_ENV.keystoreBase64], 'base64'), {mode: 0o600});
  fs.writeFileSync(path.join(genDir, 'keystore.properties'), keystorePropertiesText({
    storeFile, keyAlias: env[SIGNING_ENV.keyAlias], storePassword: env[SIGNING_ENV.keystorePassword], keyPassword: env[SIGNING_ENV.keyPassword]
  }), {mode: 0o600});
  const patched = patchGradle(fs.readFileSync(gradlePath, 'utf8'));
  if (patched.changed) fs.writeFileSync(gradlePath, patched.source);
  return {storeFile, gradlePatched: patched.changed};
}

// --- artifacts ----------------------------------------------------------------------

export const fileSha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Signer certificate digest via apksigner (build-tools). Debug certificates
// are rejected so a debug build can never be recorded as a release.
export function signerSha256(apkPath, {exec = execFileSync, apksigner = 'apksigner'} = {}) {
  const out = String(exec(apksigner, ['verify', '--print-certs', apkPath], {encoding: 'utf8'}));
  const dn = out.match(/certificate DN:\s*(.+)/i)?.[1] ?? '';
  const digest = out.match(/certificate SHA-256 digest:\s*([a-f0-9]{64})/i)?.[1] ?? null;
  if (!digest) throw new ReleaseError('apksigner에서 서명 인증서 digest를 읽지 못했습니다.', 'SIGNER_UNKNOWN');
  if (/Android Debug/i.test(dn)) throw new ReleaseError('debug 인증서로 서명된 APK는 릴리스가 아닙니다.', 'DEBUG_SIGNED');
  return digest;
}

// --- CLI -----------------------------------------------------------------------------

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const emptyLedger = () => ({version: 1, releases: []});
const arg = (argv, name) => {const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined;};

export function main(argv, env = process.env) {
  const [cmd] = argv;
  if (cmd === 'check') {
    const current = readVersioning(readJson(TAURI_CONF));
    const ledger = fs.existsSync(LEDGER_PATH) ? readJson(LEDGER_PATH) : emptyLedger();
    const versioning = validateVersioning(current, ledger);
    const signing = signingEnvStatus(env);
    const lines = [
      `VERSION: ${current.versionName} (versionCode ${current.versionCode}) identifier ${current.identifier}`,
      `LAST_RELEASE: ${versioning.last ? `${versioning.last.versionName}/${versioning.last.versionCode} @ ${versioning.last.sourceCommit.slice(0, 7)}` : 'none'}`,
      `VERSIONING: ${versioning.ok ? 'OK' : 'FAIL ' + versioning.reasons.join(' | ')}`,
      `SIGNING: ${signing.ready ? 'READY (owner keystore via env)' : 'BLOCKED: ANDROID_SIGNING_SECRET missing ' + signing.missing.join(',')}`
    ];
    if (!versioning.ok) throw new ReleaseError(lines.join('\n'), 'VERSIONING', 1);
    if (!signing.ready) throw new ReleaseError(lines.join('\n'), 'SIGNING_MISSING', 2);
    return lines.join('\n');
  }
  if (cmd === 'configure') {
    const genDir = arg(argv, '--gen') ?? path.join(REPO_ROOT, 'apps/controller/src-tauri/gen/android');
    const result = configureSigning({genDir, env, keystoreDir: env.RUNNER_TEMP ? path.join(env.RUNNER_TEMP, 'yeno-keystore') : undefined});
    if (env.RUNNER_TEMP) fs.mkdirSync(path.dirname(result.storeFile), {recursive: true});
    return `SIGNING CONFIGURED: gradle ${result.gradlePatched ? 'patched' : 'already patched'}; keystore outside repo`;
  }
  if (cmd === 'permissions') {
    const genDir = arg(argv, '--gen') ?? path.join(REPO_ROOT, 'apps/controller/src-tauri/gen/android');
    const result = configurePermissions({genDir});
    return `PERMISSIONS: AndroidManifest.xml ${result.manifestPatched ? 'patched (RECORD_AUDIO added)' : 'already has RECORD_AUDIO'}`;
  }
  if (cmd === 'ledger') {
    const apk = arg(argv, '--apk'), aab = arg(argv, '--aab');
    if (!apk || !aab) throw new ReleaseError('--apk와 --aab가 필요합니다.');
    const current = readVersioning(readJson(TAURI_CONF));
    const ledger = fs.existsSync(LEDGER_PATH) ? readJson(LEDGER_PATH) : emptyLedger();
    const record = {
      sourceCommit: env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], {cwd: REPO_ROOT, encoding: 'utf8'}).trim(),
      versionName: current.versionName, versionCode: current.versionCode,
      apkSha256: fileSha256(apk), aabSha256: fileSha256(aab), signerSha256: signerSha256(apk),
      builtAt: new Date().toISOString(), workflowRun: env.GITHUB_RUN_ID ?? 'local'
    };
    const next = appendLedger(ledger, record);
    fs.mkdirSync(path.dirname(LEDGER_PATH), {recursive: true});
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(next, null, 2) + '\n');
    return `LEDGER: ${record.versionName}/${record.versionCode} apk ${record.apkSha256.slice(0, 12)} aab ${record.aabSha256.slice(0, 12)} signer ${record.signerSha256.slice(0, 12)}`;
  }
  throw new ReleaseError('usage: android-release.mjs check|configure|permissions|ledger');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {console.log(main(process.argv.slice(2)));}
  catch (error) {console.error(error instanceof ReleaseError ? error.message : String(error?.stack ?? error)); process.exit(error?.exitCode ?? 1);}
}
