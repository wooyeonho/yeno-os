import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {draftSelfChange} from '../lib/self-change-proposal.mjs';
import {validateAbsorbInbox} from '../lib/absorb-inbox.mjs';
import {sha256,PATCH_SCHEMA} from '../lib/repository-patch.mjs';

const source='export const value = 1;\n';
const task=()=>({baseCommit:'a'.repeat(40),goal:'Correct one local value',files:[{path:'projects/demo/main.mjs',content:source,sha256:sha256(source)}],editablePaths:['projects/demo/main.mjs'],feedback:''});
const patch=()=>({schema:PATCH_SCHEMA,baseCommit:'a'.repeat(40),changes:[{path:'projects/demo/main.mjs',beforeSha256:sha256(source),content:'export const value = 2;\n'}]});
const evidence=p=>({schema:1,contractId:'s16-isolated-fixture',baseCommit:'a'.repeat(40),testFiles:[{path:'projects/demo/main.test.mjs',sha256:sha256('fixture test')}],dockerImageId:'sha256:'+'b'.repeat(64),attempts:[{number:1,exitCode:0,timedOut:false,outputOverflow:false,stdoutSha256:sha256('passing fixture'),stderrSha256:sha256(''),isolation:'docker-no-network',passed:true}],patchSha256:sha256(JSON.stringify(p)),candidateCommit:null,publish:null,ciRun:null,approval:null,promotion:null,rollback:null,reportedAt:'2026-10-01T00:00:00.000Z'});
const inbox=()=>({version:1,entries:[]});
const args=()=>{const p=patch();return {task:task(),patchRaw:JSON.stringify(p),evidence:evidence(p),reasonRef:'night-cycle:failure-1',reason:'Recorded retry failure',at:'2026-10-01T00:00:00.000Z',synthetic:true};};

test('verified isolated patch becomes inert, deduplicated inbox draft without changing source tree',()=>{
 const file=new URL('../lib/solo-leveling.mjs',import.meta.url);
 const before=sha256(readFileSync(file));
 const first=draftSelfChange(inbox(),args());
 assert.equal(first.entry.kind,'self-change-proposal');
 assert.equal(first.entry.authorizesDispatch,false);
 assert.equal(first.entry.synthetic,true);
 validateAbsorbInbox(first.inbox);
 const again=draftSelfChange(first.inbox,args());
 assert.equal(again.inbox.entries.length,1);
 assert.equal(sha256(readFileSync(file)),before);
});
test('frozen target and unsafe code are rejected at proposal creation',()=>{
 const frozen=args();frozen.task.files[0].path='runtime/lib/solo-leveling.mjs';frozen.task.editablePaths[0]='runtime/lib/solo-leveling.mjs';frozen.evidence.testFiles[0].path='runtime/lib/solo-leveling.test.mjs';frozen.patchRaw=JSON.stringify({...patch(),changes:[{...patch().changes[0],path:'runtime/lib/solo-leveling.mjs'}]});
 assert.throws(()=>draftSelfChange(inbox(),frozen));
 const bad=args();const p=patch();p.changes[0].content='fetch("https://example.com")';bad.patchRaw=JSON.stringify(p);bad.evidence=evidence(p);
 assert.throws(()=>draftSelfChange(inbox(),bad),{code:'static_policy_rejected'});
});
test('missing or non-Docker test evidence cannot become a draft',()=>{
 const missing=args();missing.evidence.patchSha256=null;
 assert.throws(()=>draftSelfChange(inbox(),missing),/docker_evidence_required/);
 const adapter=args();adapter.evidence.attempts[0].isolation='test-adapter';
 assert.throws(()=>draftSelfChange(inbox(),adapter),/docker_evidence_required/);
});
