import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readVersioning, validateVersioning, validateLedger, appendLedger, signingEnvStatus, patchGradle, configureSigning,
  keystorePropertiesText, signerSha256, SIGNING_ENV, APP_IDENTIFIER, ReleaseError, TAURI_CONF
} from './android-release.mjs';

const conf = over => ({version: '0.2.1', identifier: APP_IDENTIFIER, bundle: {android: {versionCode: 2001}}, ...over});
const rel = (versionName, versionCode, signer = 'a'.repeat(64)) => ({
  sourceCommit: '1'.repeat(40), versionName, versionCode, apkSha256: 'b'.repeat(64), aabSha256: 'c'.repeat(64), signerSha256: signer,
  builtAt: '2026-09-16T00:00:00.000Z', workflowRun: '1'
});
const GRADLE = `plugins { id("com.android.application") }
android {
    compileSdk = 35
    defaultConfig {
        applicationId = "kr.yeno.controller"
    }
    buildTypes {
        getByName("debug") {
            isDebuggable = true
        }
        getByName("release") {
            isMinifyEnabled = true
        }
    }
}
`;
const ENV = {
  [SIGNING_ENV.keystoreBase64]: Buffer.from('fake-keystore-bytes').toString('base64'),
  [SIGNING_ENV.keystorePassword]: 'store-pass', [SIGNING_ENV.keyAlias]: 'yeno-release', [SIGNING_ENV.keyPassword]: 'key-pass'
};

test('repo tauri.conf.json satisfies the release versioning contract', () => {
  const v = readVersioning(JSON.parse(fs.readFileSync(TAURI_CONF, 'utf8')));
  assert.equal(v.identifier, APP_IDENTIFIER);
  assert.ok(v.versionCode >= 2000);
});

test('versioning: versionCode strictly increases, versionName never regresses, identifier fixed, ledger fail-closed', () => {
  assert.throws(() => readVersioning(conf({identifier: 'kr.yeno.other'})), e => e.code === 'IDENTIFIER_CHANGED');
  assert.throws(() => readVersioning(conf({version: '0.2'})), /MAJOR/);
  const ledger = {version: 1, releases: [rel('0.2.0', 2000)]};
  assert.equal(validateVersioning(readVersioning(conf()), ledger).ok, true);
  assert.equal(validateVersioning(readVersioning(conf({bundle: {android: {versionCode: 2000}}})), ledger).ok, false);
  assert.equal(validateVersioning(readVersioning(conf({version: '0.1.9'})), ledger).ok, false);
  assert.equal(validateVersioning(readVersioning(conf()), {version: 1, releases: []}).ok, true);
  assert.throws(() => validateLedger({version: 1, releases: [rel('0.2.0', 2001), rel('0.2.1', 2000)]}), e => e.code === 'LEDGER_INVALID');
  assert.throws(() => validateLedger({version: 1, releases: [{...rel('0.2.0', 2000), extra: 1}]}), e => e.code === 'LEDGER_INVALID');
  assert.equal(appendLedger(ledger, rel('0.2.1', 2001)).releases.length, 2);
  assert.throws(() => appendLedger(ledger, rel('0.2.1', 2001, 'f'.repeat(64))), e => e.code === 'SIGNER_CHANGED');
});

test('signing env: presence-only status, never values; missing → BLOCKED exit 2', () => {
  assert.deepEqual(signingEnvStatus({}).missing, Object.values(SIGNING_ENV));
  assert.equal(signingEnvStatus(ENV).ready, true);
  assert.equal(signingEnvStatus({...ENV, [SIGNING_ENV.keystoreBase64]: '   '}).ready, false);
  assert.doesNotMatch(JSON.stringify(signingEnvStatus(ENV)), /store-pass|key-pass|yeno-release/);
  const gen = fs.mkdtempSync(path.join(os.tmpdir(), 'yeno-gen-'));
  fs.mkdirSync(path.join(gen, 'app'));
  fs.writeFileSync(path.join(gen, 'app', 'build.gradle.kts'), GRADLE);
  assert.throws(() => configureSigning({genDir: gen, env: {}}), e => e.code === 'SIGNING_MISSING' && e.exitCode === 2);
  assert.equal(fs.existsSync(path.join(gen, 'keystore.properties')), false, 'nothing written when blocked');
});

test('gradle patch: release buildType bound to owner keystore, idempotent, unexpected template shape fails closed', () => {
  const once = patchGradle(GRADLE);
  assert.equal(once.changed, true);
  assert.match(once.source, /signingConfigs \{\s*create\("release"\)/);
  assert.match(once.source, /getByName\("release"\) \{\s*signingConfig = signingConfigs.getByName\("release"\)/);
  assert.match(once.source, /GradleException\("keystore.properties missing/);
  assert.doesNotMatch(once.source.split('getByName("debug")')[1].split('getByName("release")')[0], /signingConfig/, 'debug untouched');
  const twice = patchGradle(once.source);
  assert.equal(twice.changed, false);
  assert.equal(twice.source, once.source);
  assert.throws(() => patchGradle('android { }'), e => e.code === 'GRADLE_SHAPE');
  assert.throws(() => patchGradle(GRADLE.replace('getByName("release")', 'getByName("beta")')), e => e.code === 'GRADLE_SHAPE');
});

test('configure: keystore decoded outside the repo, keystore.properties written with 0600, gradle patched', () => {
  const gen = fs.mkdtempSync(path.join(os.tmpdir(), 'yeno-gen-'));
  const ks = fs.mkdtempSync(path.join(os.tmpdir(), 'yeno-ks-'));
  fs.mkdirSync(path.join(gen, 'app'));
  fs.writeFileSync(path.join(gen, 'app', 'build.gradle.kts'), GRADLE);
  const out = configureSigning({genDir: gen, env: ENV, keystoreDir: ks});
  assert.equal(out.gradlePatched, true);
  assert.equal(fs.readFileSync(out.storeFile, 'utf8'), 'fake-keystore-bytes');
  const props = fs.readFileSync(path.join(gen, 'keystore.properties'), 'utf8');
  assert.equal(props, keystorePropertiesText({storeFile: out.storeFile, keyAlias: 'yeno-release', storePassword: 'store-pass', keyPassword: 'key-pass'}));
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(gen, 'keystore.properties')).mode & 0o777, 0o600);
  assert.equal(configureSigning({genDir: gen, env: ENV, keystoreDir: ks}).gradlePatched, false, 'idempotent');
  assert.throws(() => configureSigning({genDir: gen, env: ENV, keystoreDir: path.join(path.resolve(import.meta.dirname, '..'), 'tmp-ks')}), e => e.code === 'KEYSTORE_IN_REPO');
});

test('signer digest: read from apksigner; debug certificate is never a release', () => {
  const digest = 'd'.repeat(64);
  const exec = out => () => out;
  assert.equal(signerSha256('x.apk', {exec: exec(`Signer #1 certificate DN: CN=YENO Owner\nSigner #1 certificate SHA-256 digest: ${digest}\n`)}), digest);
  assert.throws(() => signerSha256('x.apk', {exec: exec(`Signer #1 certificate DN: C=US, O=Android, CN=Android Debug\nSigner #1 certificate SHA-256 digest: ${digest}\n`)}), e => e.code === 'DEBUG_SIGNED');
  assert.throws(() => signerSha256('x.apk', {exec: exec('garbage')}), e => e.code === 'SIGNER_UNKNOWN');
  assert.ok(new ReleaseError('x') instanceof Error);
});
