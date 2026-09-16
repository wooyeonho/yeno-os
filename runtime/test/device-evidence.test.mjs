import test from 'node:test';
import assert from 'node:assert/strict';
import {ACCEPTANCE_CHECKS,RECORD_KEYS,createDeviceAcceptance,validateDeviceAcceptance,validateDeviceAcceptances,recordDeviceAcceptance,deviceVerification,validateRelease} from '../lib/device-evidence.mjs';

const T='2026-09-16T01:00:00.000Z';
const COMMIT='a'.repeat(40),APK='b'.repeat(64);
const release={sourceCommit:COMMIT,clientVersionName:'1.4.0',clientVersionCode:14,apkSha256:APK};
const allTrue=Object.fromEntries(ACCEPTANCE_CHECKS.map(c=>[c,true]));
const devices={'dev-1':{id:'dev-1',platform:'android',revokedAt:null},'dev-2':{id:'dev-2',platform:'android',revokedAt:'2026-09-16T02:00:00.000Z'}};
const current={sourceCommit:COMMIT,client:{versionName:'1.4.0',versionCode:14,apkSha256:APK}};
const mk=over=>createDeviceAcceptance({id:'acc-00000001',deviceId:'dev-1',platform:'android',release,checks:allTrue,observedBy:'owner',observedAt:T,...over});

test('owner acceptance record: 19 explicit checks, release binding, fingerprint, fail-closed validation',()=>{
  assert.equal(ACCEPTANCE_CHECKS.length,19);
  const rec=mk();
  assert.equal(rec.complete,true);assert.match(rec.fingerprint,/^[a-f0-9]{64}$/);assert.deepEqual(Object.keys(rec).sort(),[...RECORD_KEYS].sort());
  assert.equal(validateDeviceAcceptance(rec),true);
  assert.equal(mk({recordedAt:'2026-09-17T00:00:00.000Z'}).fingerprint,rec.fingerprint,'recording time is not part of the claim');
  assert.equal(mk({checks:{...allTrue,resume:false}}).complete,false,'one unchecked item = incomplete, never DEVICE_VERIFIED');
  assert.throws(()=>mk({checks:{...allTrue,extra:true}}),/every acceptance check/);
  assert.throws(()=>mk({checks:Object.fromEntries(ACCEPTANCE_CHECKS.slice(1).map(c=>[c,true]))}),/every acceptance check/);
  assert.throws(()=>mk({observedBy:'model'}),/owner/);
  assert.throws(()=>mk({observedBy:'devin'}),/owner/);
  assert.throws(()=>mk({release:{...release,sourceCommit:'abc'}}),/40-hex/);
  assert.throws(()=>mk({release:{...release,clientVersionCode:0}}),/positive integer/);
  assert.throws(()=>mk({release:{...release,apkSha256:null}}),/apkSha256/);
  assert.throws(()=>mk({release:{...release,signingKey:'x'}}),/exactly/);
  assert.throws(()=>mk({platform:'ios'}),/platform/);
  assert.throws(()=>mk({deviceId:'dev-1',checks:allTrue,recordedAt:'2026-09-15T00:00:00.000Z'}),/recordedAt/);
  assert.equal(validateRelease({...release,apkSha256:null},'web'),true);
  assert.throws(()=>validateDeviceAcceptance({...rec,complete:true,checks:{...allTrue,resume:false}}),/tampered/);
  assert.throws(()=>validateDeviceAcceptance({...rec,release:{...release,sourceCommit:'c'.repeat(40)}}),/tampered/,'re-pointing an old record at a new commit fails');
  assert.throws(()=>validateDeviceAcceptance({...rec,version:2}),/version/);
  assert.throws(()=>validateDeviceAcceptances([rec,rec]),/duplicate/);
  assert.throws(()=>validateDeviceAcceptances({}),/bounded/);
  // Append-only, idempotent on the same observation, refuses rewrites.
  const first=recordDeviceAcceptance([],rec);assert.equal(first.added,true);
  assert.equal(recordDeviceAcceptance(first.records,rec).added,false);
  assert.throws(()=>recordDeviceAcceptance(first.records,mk({observedAt:'2026-09-16T03:00:00.000Z'})),/already used/);
});

test('DEVICE_VERIFIED only for a complete owner record bound to the currently served release; stale/revoked/unknown release never counts',()=>{
  const rec=mk();
  const ok=deviceVerification([rec],{current,devices,at:'2026-09-16T05:00:00.000Z'});
  assert.equal(ok.state,'DEVICE_VERIFIED');assert.deepEqual(ok.matched,['acc-00000001']);assert.deepEqual(ok.blockers,[]);assert.equal(ok.physicalDeviceActionBy,'owner');

  const newCommit=deviceVerification([rec],{current:{...current,sourceCommit:'c'.repeat(40)},devices});
  assert.equal(newCommit.state,'WIRED_UNVERIFIED');assert.deepEqual(newCommit.stale[0].stale,['source_commit_changed']);assert.deepEqual(newCommit.blockers,['owner_device_acceptance_missing_for_current_release']);
  assert.deepEqual(deviceVerification([rec],{current:{...current,client:{...current.client,apkSha256:'d'.repeat(64)}},devices}).stale[0].stale,['apk_sha_changed'],'a rebuilt APK needs a fresh acceptance');
  assert.deepEqual(deviceVerification([rec],{current:{...current,client:{...current.client,versionCode:15,versionName:'1.5.0'}},devices}).stale[0].stale,['client_version_changed']);
  assert.deepEqual(deviceVerification([mk({deviceId:'dev-2'})],{current,devices}).stale[0].stale,['device_revoked']);
  assert.deepEqual(deviceVerification([mk({deviceId:'dev-9'})],{current,devices}).stale[0].stale,['device_not_enrolled']);
  assert.deepEqual(deviceVerification([mk({checks:{...allTrue,emergency_stop:false}})],{current,devices}).stale[0].stale,['checks_incomplete']);
  assert.deepEqual(deviceVerification([rec],{current,devices,at:'2026-09-16T00:00:00.000Z'}).stale[0].stale,['observed_in_future']);

  // The runtime does not know its own release (no APK SHA / commit): nothing
  // can be matched, and that is reported as BLOCKED, not guessed.
  const unknown=deviceVerification([rec],{current:{sourceCommit:null,client:{versionName:'1.4.0',versionCode:14,apkSha256:null}},devices});
  assert.equal(unknown.state,'BLOCKED');assert.equal(unknown.currentReleaseKnown,false);assert.deepEqual(unknown.blockers,['current_release_evidence_missing']);
  assert.equal(deviceVerification([],{current,devices}).state,'WIRED_UNVERIFIED','enrolled android device without owner record');
  assert.equal(deviceVerification([],{current,devices:{}}).state,'NOT_WIRED');
  assert.equal(deviceVerification([rec],{platform:'web',current:{...current,client:{...current.client,apkSha256:null}},devices}).ownerRecords,0,'platforms are judged separately');
  assert.throws(()=>deviceVerification([{...rec,fingerprint:'0'.repeat(64)}],{current,devices}),/tampered/);
});
