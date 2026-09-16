import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {validateQuestState} from '../lib/quests.mjs';
import {validateCodeManifest,codeHash,canonicalCode,importCode,testCodeManifest,recordCodeVerification,activateCode,createCodeRequest,recordCodeRun,inputMatchesContract} from '../lib/code-workshop.mjs';
import {discoverCapability,manifestFits,projectInput,qualifyCandidate,requiredCapability} from '../lib/capability-discovery.mjs';
import {kirbyStage,planClosedLoop,bindLoopExecution,closedLoopStatus,LOOP_VERSION,LOOP_KEYS} from '../lib/closed-loop.mjs';

// TRACK B - General Kirby x QuickJS. A code-workshop capability is only
// discoverable through an explicit, fixture-verified input contract; the loop
// executes an active QuickJS version only with sandbox proof; external code
// still needs the owner; emergency stop blocks reuse. Pure layer on real store
// state (server only produces the failed-job evidence). Server wiring of the
// code run job into the loop is the separate integration pass.
const manifest=name=>JSON.parse(fs.readFileSync(new URL(`../capabilities/${name}.json`,import.meta.url),'utf8'));
const REVIEWED=['ledger-digest','evidence-gap-brief'].map(manifest);
const MODEL_ENV={YENO_AGENT_PROVIDER:'openai',YENO_OPENAI_API_KEY:'synthetic-openai-key',YENO_OPENAI_MODEL:'synthetic-openai',YENO_AGENT_DAILY_CALL_LIMIT:'6'};
const NOW='2026-09-16T00:00:00.000Z';
const CONTRACT={records:{fields:{id:'string',status:'string'}}};
const CODE={schemaVersion:1,id:'status-tally',version:'1.0.0',name:'상태 집계',description:'기록 상태별 개수를 셉니다.',source:{kind:'owner',url:'',commit:'',license:'Owner',licenseText:'Owner use'},
  files:[{path:'index.mjs',content:'export default input=>{const tally={};for(const r of input.records)tally[r.status]=(tally[r.status]??0)+1;return {count:input.records.length,tally};}'}],entry:'index.mjs',
  fixtures:[{name:'one',input:{records:[{id:'a',status:'failed'}]},expected:{count:1,tally:{failed:1}}},{name:'two',input:{records:[{id:'a',status:'failed'},{id:'b',status:'paused'}]},expected:{count:2,tally:{failed:1,paused:1}}}],
  inputContract:CONTRACT};

async function failedJobs(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-kirby-quickjs-')),token='synthetic-kirby-owner-token';
  let runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env:MODEL_ENV,agentFetch:async()=>{throw new Error('synthetic provider outage');}});
  const post=async(route,body={})=>{const r=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),...body})});return {status:r.status,body:await r.json()};};
  const wait=async id=>{for(let i=0;i<300;i++){const j=openStore(dir).state.jobs.find(j=>j.id===id);if(j&&['completed','failed','paused'].includes(j.status))return j;await new Promise(r=>setTimeout(r,20));}assert.fail('job did not settle');};
  for(const goal of ['첫 소유자 목표','둘째 소유자 목표']){const quest=(await post('/api/quests',{goal,provider:'openai',maxCalls:1})).body.quest;const run=await post(`/api/quests/${quest.id}/run`);assert.equal(run.status,201);assert.equal((await wait(run.body.job.id)).status,'failed');}
  const created=await post('/api/quests/synthesize');assert.equal(created.body.quest.synthesis.archetype,'repair');
  runtime.shutdown();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return openStore(dir).state;
}
const snapshot=state=>JSON.stringify(state);

test('QuickJS input contract is explicit and fixture-verified; contract-less code is never matched',()=>{
  assert.equal(validateCodeManifest(CODE),true);
  assert.equal(inputMatchesContract(CONTRACT,{records:[{id:'x',status:'y'}]}),true);
  assert.equal(inputMatchesContract(CONTRACT,{records:[{id:'x',status:'y',extra:1}]}),false,'exact field set');
  assert.equal(inputMatchesContract(CONTRACT,{records:[]}),false,'empty rows prove nothing');
  assert.throws(()=>validateCodeManifest({...CODE,fixtures:[CODE.fixtures[0],{name:'bad',input:{records:[{id:'a',status:7}]},expected:{}}]}),/입력 계약과 다릅니다/,'a fixture violating the contract is rejected');
  assert.throws(()=>validateCodeManifest({...CODE,inputContract:{records:{fields:{id:'object'}}}}),/타입/);
  assert.throws(()=>validateCodeManifest({...CODE,inputContract:{records:{fields:{}}}}),/필드/);
  assert.throws(()=>validateCodeManifest({...CODE,inputContract:{records:{fields:{id:'string'}},apiKey:'k'}}),/형식/);
  const {inputContract,...legacy}=CODE;
  assert.equal(validateCodeManifest(legacy),true,'existing contract-less manifests stay valid');
  assert.notEqual(codeHash(legacy),codeHash(CODE),'the contract is part of the pinned code identity');
  const requirement={fields:{id:'string',title:'string',status:'string'}};
  assert.equal(manifestFits(legacy,requirement).reason,'no_input_contract');
  assert.equal(manifestFits(CODE,requirement).fits,true);
  assert.equal(manifestFits({...CODE,inputContract:{records:{fields:{id:'string',amount:'number'}}}},requirement).fits,false);
  assert.deepEqual(projectInput([{id:'a',title:'t',status:'failed'}],CODE),{records:[{id:'a',status:'failed'}]});
  assert.equal(crypto.createHash('sha256').update(canonicalCode({b:1,a:[2]})).digest('hex'),codeHash({a:[2],b:1}),'canonical bytes digest to codeHash');
});

test('active verified QuickJS capability is discovered, qualifies for reuse and is planned/bound as a loop execution; unproven or external code is not',async t=>{
  const base=await failedJobs(t);
  const quest=base.quests.find(q=>q.synthesis);
  // Take the declarative match out of the way so discovery must rely on code.
  const capabilities={...base.capabilities,entries:base.capabilities.entries.filter(e=>e.id!=='failure-triage'),history:base.capabilities.history.filter(h=>h.id!=='failure-triage')};
  const imported=importCode(base.codeWorkshop,CODE,{at:NOW});
  let state={...base,capabilities,codeWorkshop:imported.registry};

  // Imported but unproven: inactive, owner review, never auto-activated.
  let found=discoverCapability(state,quest,{manifests:REVIEWED});
  assert.equal(found.gap,'inactive_owner_review');assert.equal(found.candidate.id,'status-tally');assert.equal(found.candidate.engine,'quickjs-v1');
  assert.equal(found.candidate.sandboxable,false,'no sandbox proof yet');
  assert.equal(qualifyCandidate(found.candidate,{}).action,'blocked');
  assert.equal(planClosedLoop(state,NOW,{authorizedBy:'owner',manifests:REVIEWED}).kind,'none');

  // Real sandbox proof (QuickJS runs the fixtures twice) -> activate.
  const proof=await testCodeManifest(CODE);
  const verified=recordCodeVerification(state.codeWorkshop,'status-tally',imported.result.hash,proof,{at:NOW}).registry;
  state={...state,codeWorkshop:activateCode(verified,'status-tally',imported.result.hash,{at:NOW}).registry};
  const before=snapshot(state);
  found=discoverCapability(state,quest,{manifests:REVIEWED});
  assert.equal(found.gap,'none');assert.equal(found.candidate.origin,'active');assert.equal(found.candidate.engine,'quickjs-v1');assert.equal(found.candidate.sandboxable,true);
  const qualification=qualifyCandidate(found.candidate,{});
  assert.equal(qualification.action,'reuse');assert.equal(qualification.risk,'local-reversible');assert.equal(qualification.approvalRequired,false);

  const kirby=kirbyStage(state,quest,{manifests:REVIEWED});
  assert.equal(kirby.stage,'active');assert.equal(kirby.engine,'quickjs-v1');assert.equal(kirby.hash,imported.result.hash);
  assert.equal(kirbyStage(state,quest,{manifests:REVIEWED,emergencyStop:true}).stage,'blocked','emergency stop blocks even reuse');
  assert.equal(planClosedLoop(state,NOW,{emergencyStop:true,authorizedBy:'owner',manifests:REVIEWED}).reason,'emergency_stop');

  const plan=planClosedLoop(state,NOW,{authorizedBy:'autopilot',manifests:REVIEWED});
  assert.equal(plan.kind,'execute');assert.equal(plan.engine,'quickjs-v1');assert.equal(plan.capabilityId,'status-tally');assert.equal(plan.manifestHash,imported.result.hash);
  const ids=requiredCapability(state,quest).requirement.recordIds;
  assert.deepEqual(plan.input.records.map(r=>r.id).sort(),ids,'input is exactly the provenance records');
  assert.deepEqual(Object.keys(plan.input.records[0]).sort(),['id','status'],'projected to the contract fields only');
  assert.equal(inputMatchesContract(CONTRACT,plan.input),true);
  assert.equal(snapshot(state),before,'planning is pure');

  // Jarvis' code run job carries the same request the store accepts.
  const request=createCodeRequest(state.codeWorkshop,'status-tally',plan.input);
  const job={id:randomUUID(),type:'code',status:'queued',title:quest.goal,codeTask:{mode:'run',request},artifacts:[],version:1};
  const withJob={...state,jobs:[...state.jobs,job]};
  const bound=bindLoopExecution(withJob,quest,job,{authorizedBy:'autopilot',at:NOW,kirbyAction:plan.kirbyAction,discoveryFingerprint:plan.discoveryFingerprint});
  assert.equal(bound.loop.version,LOOP_VERSION);assert.equal(bound.loop.engine,'quickjs-v1');assert.equal(bound.loop.capabilityId,'status-tally');assert.equal(bound.loop.gradeBefore,'E');
  assert.equal(Object.keys(bound.loop).sort().join(),LOOP_KEYS);
  const linked={...withJob,quests:withJob.quests.map(q=>q.id===quest.id?bound:q),jobs:withJob.jobs.map(j=>j.id===job.id?{...j,questId:quest.id}:j)};
  validateQuestState(linked);
  assert.throws(()=>validateQuestState({...linked,quests:linked.quests.map(q=>q.id===quest.id?{...q,loop:{...q.loop,engine:'declarative-v1'}}:q)}),/Invalid quest loop execution/,'engine must match the job kind');
  assert.throws(()=>validateQuestState({...linked,quests:linked.quests.map(q=>q.id===quest.id?{...q,loop:{...q.loop,version:2}}:q)}),/Invalid quest loop record/);
  assert.throws(()=>bindLoopExecution(withJob,quest,{...job,codeTask:{mode:'verify',id:'status-tally',hash:request.hash,activate:false,activeAtAcceptance:null}},{authorizedBy:'owner',at:NOW,discoveryFingerprint:plan.discoveryFingerprint}),/execution request/);

  // Execution verification: the run record's outputSha256 must equal the SHA-256
  // of a persisted artifact (the canonical JSON output), same engine registry.
  const output={count:2,tally:{failed:2}};
  const ran=recordCodeRun(linked.codeWorkshop,'status-tally',request.hash,{runId:job.id,inputSha256:request.inputSha256,outputSha256:codeHash(output)},{at:NOW}).registry;
  const artifactId=randomUUID(),content=canonicalCode(output),sha256=crypto.createHash('sha256').update(content).digest('hex');
  const reportId=randomUUID();
  const done={...linked,codeWorkshop:ran,jobs:linked.jobs.map(j=>j.id===job.id?{...j,status:'completed',artifacts:[{id:reportId,name:'report.md'},{id:artifactId,name:'output.json'}]}:j),
    artifacts:{...linked.artifacts,[reportId]:{id:reportId,name:'report.md',filename:`${reportId}.md`,sha256:'0'.repeat(64),bytes:1,jobId:job.id},[artifactId]:{id:artifactId,name:'output.json',filename:`${artifactId}.json`,sha256,bytes:content.length,jobId:job.id,mimeType:'application/json'}}};
  const status=closedLoopStatus(done,NOW,{manifests:REVIEWED}).quests.find(q=>q.goal.questId===quest.id);
  assert.equal(status.execution.engine,'quickjs-v1');
  assert.equal(status.verification.executionVerified,true);assert.equal(status.verification.outcomeVerified,false,'integrity is not an outcome');
  assert.equal(status.growth.grade,'D');assert.equal(status.growth.promoted,true,'Solo Leveling reads the code-workshop run history');
  const tampered={...done,artifacts:{...done.artifacts,[artifactId]:{...done.artifacts[artifactId],sha256:'1'.repeat(64)}}};
  assert.equal(closedLoopStatus(tampered,NOW,{manifests:REVIEWED}).quests.find(q=>q.goal.questId===quest.id).verification.executionVerified,false);

  // GitHub-sourced code with a contract is discoverable but stays external-code:
  // owner approval is required and it is never acquired autonomously.
  const external={...CODE,id:'status-tally-ext',source:{kind:'github',url:'https://github.com/wooyeonho/yeno-os',commit:'a'.repeat(40),license:'MIT',licenseText:'MIT License text'}};
  const extState={...base,capabilities,codeWorkshop:importCode(base.codeWorkshop,external,{at:NOW}).registry};
  const ext=discoverCapability(extState,quest,{manifests:REVIEWED});
  assert.equal(ext.gap,'inactive_owner_review');
  const extQualified=qualifyCandidate(ext.candidate,{});
  assert.equal(extQualified.risk,'external-code');assert.equal(extQualified.approvalRequired,true);assert.equal(extQualified.action,'blocked');
  assert.equal(planClosedLoop(extState,NOW,{authorizedBy:'owner',manifests:REVIEWED}).kind,'none','no autonomous acquisition of external code');
});
