import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {releaseManifestBytes,verifyReleaseManifest} from '../lib/release-trust.mjs';
import {remoteRunnerDecision,REMOTE_RUNNER_DENIED} from '../lib/remote-runner-policy.mjs';

const keys=generateKeyPairSync('ed25519');
const other=generateKeyPairSync('ed25519');
const packageBytes=Buffer.from('synthetic Windows package bytes');
const manifest={schema:1,version:'0.2.3',platform:'windows-x64',packageSha256:createHash('sha256').update(packageBytes).digest('hex'),issuedAt:'2026-10-01T00:00:00.000Z',signerId:'owner-test'};
const signature=sign(null,releaseManifestBytes(manifest),keys.privateKey).toString('base64');
const trustedKeys={'owner-test':keys.publicKey.export({type:'spki',format:'pem'})};

test('signed update manifest verifies bytes but never installs',()=>{
 assert.deepEqual(verifyReleaseManifest({manifest,signature,packageBytes,trustedKeys}),{version:'0.2.3',platform:'windows-x64',packageSha256:manifest.packageSha256,signatureVerified:true,authorizesInstall:false});
});
test('forged signer, altered bytes, unsigned version and extra fields fail closed',()=>{
 const input={manifest,signature,packageBytes,trustedKeys};
 assert.throws(()=>verifyReleaseManifest({...input,trustedKeys:{'owner-test':other.publicKey.export({type:'spki',format:'pem'})}}),/untrusted_release_manifest/);
 assert.throws(()=>verifyReleaseManifest({...input,packageBytes:Buffer.from('tamper')}),/untrusted_release_manifest/);
 assert.throws(()=>verifyReleaseManifest({...input,manifest:{...manifest,version:'0.2.4'}}),/untrusted_release_manifest/);
 assert.throws(()=>verifyReleaseManifest({...input,manifest:{...manifest,url:'https://example.test'}}),/untrusted_release_manifest/);
});
test('remote runner policy admits only owner mTLS scout/builder worker execution',()=>{
 const peerFingerprint='a'.repeat(64);
 const base={transport:'https-mutual-tls',peerFingerprint,ownerFingerprints:[peerFingerprint],role:'builder',action:'worker.execute'};
 assert.equal(remoteRunnerDecision(base).allowed,true);
 assert.equal(remoteRunnerDecision({...base,role:'verifier'}).allowed,false);
 assert.equal(remoteRunnerDecision({...base,action:'state.write'}).allowed,false);
 assert.equal(remoteRunnerDecision({...base,transport:'http'}).allowed,false);
 assert.equal(remoteRunnerDecision({...base,ownerFingerprints:[]}).allowed,false);
 assert.equal(REMOTE_RUNNER_DENIED.includes('code.promote'),true);
 assert.equal(remoteRunnerDecision(base).authorizesDispatch,false);
});
