import test from 'node:test';import assert from 'node:assert/strict';
import {sha256,validateRepositoryTask,parseRepositoryPatch,editablePath,safeSourcePath,repositoryPrompt,validateRepositoryJob,validateDeveloperEvidence,mergeDeveloperEvidence,developerEvidenceStatus,validateJobEvidence,PATCH_SCHEMA} from '../lib/repository-patch.mjs';
const source='export const sum = xs => 0;\n';
const task=()=>({baseCommit:'a'.repeat(40),goal:'Fix sum',files:[{path:'projects/demo/main.mjs',content:source,sha256:sha256(source)}],editablePaths:['projects/demo/main.mjs'],feedback:''});
const patch=()=>({schema:PATCH_SCHEMA,baseCommit:'a'.repeat(40),changes:[{path:'projects/demo/main.mjs',beforeSha256:sha256(source),content:'export const sum = xs => xs.reduce((a,b)=>a+b,0);\n'}]});
test('patch matches original source, base commit and explicit editable scope',()=>{assert.deepEqual(parseRepositoryPatch(JSON.stringify(patch()),task()),patch());assert.deepEqual(validateRepositoryTask(task()),task());});
for(const p of ['../bad.mjs','/tmp/x','a//x.mjs','a/../b','a\\b','runtime/data/state.json','00_INBOX_RAW/raw.md','runtime/.env','config/private-key.pem','runtime/lib/token-reader.mjs'])test('refuse unsafe path '+p,()=>assert.throws(()=>safeSourcePath(p)));
for(const p of ['runtime/server.mjs','runtime/lib/agent.mjs','runtime/lib/repository-patch.mjs','runtime/lib/store.mjs','workers/developer/worker.mjs','.github/workflows/ci.yml','package.json','runtime/test/foo.test.mjs','projects/demo/main.test.mjs',
  // runtime/lib/ is default-deny: every current control/policy module, and any
  // file not yet individually reviewed and allowlisted, must stay unreachable.
  'runtime/lib/agent-engine.mjs','runtime/lib/independent-core.mjs','runtime/lib/independent-core-engine.mjs','runtime/lib/job-view-engine.mjs','runtime/lib/provider-config-engine.mjs','runtime/lib/motivation.mjs','runtime/lib/quests.mjs','runtime/lib/capabilities.mjs','runtime/lib/future-policy.mjs'])
  test('worker cannot modify trusted boundary '+p,()=>assert.throws(()=>editablePath(p)));
test('reject changed base, changed source hash, duplicates and empty patches',()=>{
  for(const mutate of [p=>p.baseCommit='b'.repeat(40),p=>p.changes[0].beforeSha256='b'.repeat(64),p=>p.changes.push(p.changes[0]),p=>p.changes[0].content=source,p=>p.command='npm test',p=>p.changes[0].path='projects/other/main.mjs']){const p=patch();mutate(p);assert.throws(()=>parseRepositoryPatch(JSON.stringify(p),task()));}
});
test('source digest, context size and exact schema are mandatory',()=>{const t=task();t.files[0].content+='tamper';assert.throws(()=>validateRepositoryTask(t));const x=task();x.files[0].content='x'.repeat(12001);x.files[0].sha256=sha256(x.files[0].content);assert.throws(()=>validateRepositoryTask(x));assert.throws(()=>validateRepositoryTask({...task(),approve:true}));});
test('persisted plan stays one-call and cannot cross into another execution mode',()=>{const t=task();const j={type:'agent',callLimit:1,repositoryTask:t,input:repositoryPrompt(t)};validateRepositoryJob(j);assert.throws(()=>validateRepositoryJob({...j,callLimit:2}));assert.throws(()=>validateRepositoryJob({...j,voiceConversation:true}));assert.throws(()=>validateRepositoryJob({...j,input:'different'}));});

const dockerImage='sha256:'+'a'.repeat(64);
const attempt=(number,passed)=>({number,exitCode:passed?0:1,timedOut:false,outputOverflow:false,stdoutSha256:sha256('out'+number),stderrSha256:sha256('err'+number),isolation:'docker-no-network',passed});
const baseEvidence=()=>({schema:1,contractId:'demo-contract',baseCommit:'a'.repeat(40),testFiles:[{path:'projects/demo/main.test.mjs',sha256:sha256('test')}],dockerImageId:dockerImage,attempts:[attempt(1,false),attempt(2,true)],patchSha256:sha256('patch'),candidateCommit:'b'.repeat(40),publish:null,ciRun:null,approval:null,promotion:null,rollback:null,reportedAt:new Date().toISOString()});
test('evidence status reflects only what has actually been reported, in order',()=>{
  assert.equal(developerEvidenceStatus(null),'patch-drafted');
  const failedOnly={...baseEvidence(),attempts:[attempt(1,false)],candidateCommit:null,patchSha256:null};
  assert.equal(developerEvidenceStatus(failedOnly),'docker-failed');
  assert.equal(developerEvidenceStatus(baseEvidence()),'docker-verified');
});
test('a candidate commit requires at least one passing Docker attempt',()=>{
  const bad={...baseEvidence(),attempts:[attempt(1,false)]};
  assert.throws(()=>validateDeveloperEvidence(bad));
});
test('publish, CI, approval, promotion and rollback must be reported in that order with matching commits',()=>{
  const verified=baseEvidence();
  assert.throws(()=>validateDeveloperEvidence({...verified,ciRun:{id:1,conclusion:'success'}}));
  const published={...verified,publish:{repository:'wooyeonho/yeno-os',branch:'blackhole/worker/demo',candidateCommit:verified.candidateCommit,prNumber:9,url:'https://github.com/wooyeonho/yeno-os/pull/9',status:'awaiting_owner_approval'}};
  assert.throws(()=>validateDeveloperEvidence({...published,approval:{approvedBy:'owner',approvedCommit:verified.candidateCommit,expectedProductionHead:'c'.repeat(40)}}));
  const ciGreen={...published,ciRun:{id:123,conclusion:'success'}};
  assert.equal(developerEvidenceStatus(ciGreen),'awaiting-approval');
  const approved={...ciGreen,approval:{approvedBy:'owner',approvedCommit:verified.candidateCommit,expectedProductionHead:'c'.repeat(40)}};
  assert.equal(developerEvidenceStatus(approved),'approved');
  assert.throws(()=>validateDeveloperEvidence({...approved,promotion:{sourceCommit:'d'.repeat(40),previousCommit:'z'.repeat(40)}}));
  const promoted={...approved,promotion:{sourceCommit:'d'.repeat(40),previousCommit:'c'.repeat(40)}};
  assert.equal(developerEvidenceStatus(promoted),'promoted');
  assert.throws(()=>validateDeveloperEvidence({...promoted,rollback:{sourceCommit:'wrong'.padEnd(40,'0')}}));
  const rolledBack={...promoted,rollback:{sourceCommit:'d'.repeat(40)}};
  assert.equal(developerEvidenceStatus(rolledBack),'rolled-back');
});
test('merged evidence can only extend the record, never contradict or erase it',()=>{
  const first=mergeDeveloperEvidence(null,baseEvidence());
  assert.equal(developerEvidenceStatus(first),'docker-verified');
  assert.throws(()=>mergeDeveloperEvidence(first,{...baseEvidence(),contractId:'other'}));
  assert.throws(()=>mergeDeveloperEvidence(first,{...baseEvidence(),attempts:[attempt(2,true)]}));
  const published={...baseEvidence(),publish:{repository:'wooyeonho/yeno-os',branch:'blackhole/worker/demo',candidateCommit:first.candidateCommit,prNumber:9,url:'https://github.com/wooyeonho/yeno-os/pull/9',status:'awaiting_owner_approval'}};
  const extended=mergeDeveloperEvidence(first,published);
  assert.equal(developerEvidenceStatus(extended),'awaiting-ci');
  assert.throws(()=>mergeDeveloperEvidence(extended,baseEvidence()));
});
test('a repository job\'s evidence must reference the same base commit as its own patch task',()=>{
  const t=task();const j={type:'agent',callLimit:1,repositoryTask:t,input:repositoryPrompt(t),developerEvidence:{...baseEvidence(),baseCommit:t.baseCommit}};
  validateJobEvidence(j);
  assert.throws(()=>validateJobEvidence({...j,developerEvidence:{...j.developerEvidence,baseCommit:'z'.repeat(40)}}));
});
