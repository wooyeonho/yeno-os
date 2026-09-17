import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {synthesizeAutonomousGoal} from '../lib/goal-synthesis.mjs';
import {createCapabilityRequest,disableCapability,importCapability,verifyCapability,activateCapability} from '../lib/capabilities.mjs';
import {importCode} from '../lib/code-workshop.mjs';
import {requiredCapability,searchCapabilities,discoverCapability,discoverCapabilities,manifestFits,projectInput,qualifyCandidate,RECORD_PROJECTIONS,EVIDENCE_RECORDS,DISCOVERY_VERSION,QUALIFY_CHECKS} from '../lib/capability-discovery.mjs';
import {codeHash,recordCodeVerification} from '../lib/code-workshop.mjs';

const manifest=name=>JSON.parse(fs.readFileSync(new URL(`../capabilities/${name}.json`,import.meta.url),'utf8'));
const LEDGER_DIGEST=manifest('ledger-digest'),FAILURE_TRIAGE=manifest('failure-triage'),EVIDENCE_GAP_BRIEF=manifest('evidence-gap-brief');
const REVIEWED=[LEDGER_DIGEST,FAILURE_TRIAGE,EVIDENCE_GAP_BRIEF];
const MODEL_ENV={YENO_AGENT_PROVIDER:'openai',YENO_OPENAI_API_KEY:'synthetic-openai-key',YENO_OPENAI_MODEL:'synthetic-openai',YENO_AGENT_DAILY_CALL_LIMIT:'6'};
const ok=text=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:text,tool_calls:[]}}],usage:{prompt_tokens:30,completion_tokens:20}}),{headers:{'Content-Type':'application/json'}});
const NOW='2026-09-15T00:00:00.000Z';

// Real durable state only: goals and records come from the normal owner HTTP
// path (save goal -> Run -> provider really fails/succeeds -> outcome). The
// module under test is then run as the pure function it is, on the state the
// store validated. Model requests are counted so a hidden call fails here.
async function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-capability-discovery-')),token='synthetic-discovery-owner-token';
  const modelCalls=[];let mode='fail';
  const agentFetch=async(url,req)=>{modelCalls.push({url,body:JSON.parse(req.body)});if(mode==='fail')throw new Error('synthetic provider outage');return ok('합성 산출물 본문');};
  let runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env:MODEL_ENV,agentFetch});
  const request=async(method,route,body)=>{const r=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  const post=(route,body={})=>request('POST',route,{requestId:randomUUID(),...body});
  const wait=async id=>{for(let i=0;i<300;i++){const j=openStore(dir).state.jobs.find(j=>j.id===id);if(j&&['completed','failed','paused'].includes(j.status))return j;await new Promise(r=>setTimeout(r,20));}assert.fail('job did not reach target state');};
  const restart=async()=>{runtime.shutdown();runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env:MODEL_ENV,agentFetch});};
  const runOwnerQuest=async(goal,expected)=>{const quest=(await post('/api/quests',{goal,provider:'openai',maxCalls:1})).body.quest;const run=await post(`/api/quests/${quest.id}/run`);assert.equal(run.status,201,JSON.stringify(run.body));const job=await wait(run.body.job.id);assert.equal(job.status,expected,job.error);return {quest,job};};
  t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,post,restart,runOwnerQuest,modelCalls,setMode:next=>{mode=next;},disk:()=>openStore(dir).state};
}
const snapshot=state=>JSON.stringify(state);

test('repair goal -> required capability is derived from the failed-job records, found active in the registry, input projects to the exact schema',async t=>{
  const app=await setup(t);
  const a=await app.runOwnerQuest('첫 소유자 목표','failed'),b=await app.runOwnerQuest('둘째 소유자 목표','failed');
  const created=await app.post('/api/quests/synthesize');
  assert.equal(created.body.outcome,'new_quest');assert.equal(created.body.quest.synthesis.archetype,'repair');
  const calls=app.modelCalls.length,state=app.disk(),before=snapshot(state);
  const quest=state.quests.find(q=>q.synthesis);

  const required=requiredCapability(state,quest);
  assert.equal(required.ok,true);
  assert.equal(required.requirement.recordType,'job');assert.equal(required.requirement.evidenceKind,'repeated_failed_jobs');
  assert.deepEqual(required.requirement.recordIds,[a.job.id,b.job.id].sort(),'the requirement is the exact records the provenance names');
  assert.deepEqual(required.requirement.fields,RECORD_PROJECTIONS.job.fields);
  assert.equal(required.requirement.demandedCapabilityIds.length,0);
  assert.match(required.requirement.fingerprint,/^[a-f0-9]{64}$/);

  const found=discoverCapability(state,quest,{manifests:REVIEWED});
  assert.equal(found.gap,'none');assert.equal(found.candidate.id,'failure-triage');assert.equal(found.candidate.origin,'active');
  assert.equal(found.candidate.engine,'declarative-v1');assert.equal(found.candidate.sandboxable,true);
  assert.equal(found.candidate.demand.recordCount,2);
  assert.ok(!('manifest' in found.candidate),'plans carry ids and hashes, not whole manifests');
  assert.ok(found.rejected.some(r=>r.id==='ledger-digest'&&r.reason==='fields_not_supplied'&&r.missing.includes('ledger')),'ledger-digest needs ledger fields a job does not carry');
  assert.ok(found.rejected.some(r=>r.id==='evidence-gap-brief'&&r.missing.includes('evidenceCount')));
  assert.equal(found.searched,3,'two booted capabilities + one reviewed manifest not yet held; held ids are not counted twice');
  assert.ok(!Object.hasOwn(found,'archetypeCapability'),'no archetype -> capability id table is consulted');

  // The projected input is accepted by the real request contract as-is.
  const input=projectInput(required.records,FAILURE_TRIAGE);
  assert.deepEqual(Object.keys(input.records[0]).sort(),Object.keys(FAILURE_TRIAGE.inputSchema.fields).sort());
  assert.deepEqual(input.records.map(r=>r.id).sort(),[a.job.id,b.job.id].sort());
  const requestRecord=createCapabilityRequest(state.capabilities,'failure-triage',input);
  assert.equal(requestRecord.id,'failure-triage');assert.match(requestRecord.inputSha256,/^[a-f0-9]{64}$/);

  assert.equal(snapshot(state),before,'discovery is pure');
  assert.equal(app.modelCalls.length,calls,'zero model calls');
  assert.equal(app.disk().jobs.length,2,'no job, no activation, no execution was created by discovery');

  await app.restart();
  const again=requiredCapability(app.disk(),app.disk().quests.find(q=>q.synthesis));
  assert.equal(again.requirement.fingerprint,required.requirement.fingerprint,'same requirement after restart');
  assert.deepEqual(discoverCapabilities(app.disk(),{manifests:REVIEWED}).map(d=>[d.questId,d.gap,d.candidate?.id]),[[quest.id,'none','failure-triage']]);
});

test('acquire-capability goal -> reviewed manifest is the sandboxable candidate; without it the gap is honestly missing; held-but-inactive is owner review, never re-activation',async t=>{
  const app=await setup(t);
  app.setMode('ok');const paid=await app.runOwnerQuest('측정 대상 작업','completed');
  assert.equal((await app.post('/api/outcomes',{questId:paid.quest.id,ledger:'honor',summary:'측정',value:2,unit:'건'})).status,201);
  const disk=app.disk();
  // Kirby already acquired ledger-digest on that outcome (existing behaviour).
  // Rewind only the registry to the state before acquisition so the demand
  // is real but the capability is not held - the same situation a failed
  // fixture trial or a fresh restore leaves behind.
  const registry={...disk.capabilities,entries:disk.capabilities.entries.filter(e=>e.id!=='ledger-digest'),history:disk.capabilities.history.filter(h=>h.id!=='ledger-digest')};
  const state={...disk,capabilities:registry};
  const plan=synthesizeAutonomousGoal(state,NOW,{manifests:[LEDGER_DIGEST]});
  assert.equal(plan.outcome,'new_quest');assert.equal(plan.quest.synthesis.archetype,'acquire-capability');
  const withQuest={...state,quests:[...state.quests,plan.quest]};
  const outcomeId=disk.outcomes[0].id;

  const required=requiredCapability(withQuest,plan.quest);
  assert.equal(required.requirement.recordType,'outcome');assert.deepEqual(required.requirement.recordIds,[outcomeId]);
  assert.deepEqual(required.requirement.demandedCapabilityIds,['ledger-digest'],'the demanded id is carried as provenance, not used as the match');

  const reviewed=discoverCapability(withQuest,plan.quest,{manifests:REVIEWED});
  assert.equal(reviewed.gap,'acquire_reviewed');assert.equal(reviewed.candidate.origin,'reviewed_manifest');assert.equal(reviewed.candidate.id,'ledger-digest');
  assert.equal(reviewed.candidate.hash,null,'not imported yet');assert.equal(reviewed.candidate.sandboxable,true);assert.equal(reviewed.candidate.fixtureCount,LEDGER_DIGEST.fixtures.length);
  assert.equal(reviewed.candidate.version,LEDGER_DIGEST.version);
  assert.deepEqual(reviewed.candidate.demand,{recordType:'outcome',recordCount:1,recordIds:[outcomeId]});

  const unreviewed=discoverCapability(withQuest,plan.quest,{manifests:[]});
  assert.equal(unreviewed.gap,'missing');assert.equal(unreviewed.candidate,null);
  assert.deepEqual(Object.keys(unreviewed.requirement.fields),['ledger','summary','value','unit'],'the gap states the schema a capability would need');
  assert.match(unreviewed.reason,/ledger, summary, value, unit/);
  assert.ok(unreviewed.rejected.every(r=>r.reason==='fields_not_supplied'),'held capabilities are searched and rejected for a stated reason');

  // Import+verify+activate through the existing Kirby semantics -> no gap.
  let r=importCapability(registry,LEDGER_DIGEST,{at:NOW});r=verifyCapability(r.registry,'ledger-digest',r.result.hash,{at:NOW});r=activateCapability(r.registry,'ledger-digest',r.result.hash,{at:NOW});
  const active=discoverCapability({...withQuest,capabilities:r.registry},plan.quest,{manifests:REVIEWED});
  assert.equal(active.gap,'none');assert.equal(active.candidate.origin,'active');assert.equal(active.candidate.hash,r.result.hash);
  assert.equal(active.searched,3,'the held ledger-digest replaces the reviewed manifest instead of appearing twice');
  const projected=projectInput(required.records,LEDGER_DIGEST);
  assert.deepEqual(projected.records,[{ledger:'honor',summary:'측정',value:2,unit:'건'}]);
  createCapabilityRequest(r.registry,'ledger-digest',projected);

  // Owner disables it -> discovery reports owner review and offers nothing else.
  const disabled=disableCapability(r.registry,'ledger-digest',{at:NOW}).registry;
  const review=discoverCapability({...withQuest,capabilities:disabled},plan.quest,{manifests:REVIEWED});
  assert.equal(review.gap,'inactive_owner_review');assert.equal(review.candidate.origin,'inactive_owner_review');assert.equal(review.candidate.id,'ledger-digest');
  assert.equal(review.matches.length,1,'the reviewed manifest of a held id is not a fallback around the owner');
  assert.equal(snapshot(app.disk()),snapshot(disk),'nothing was persisted by any of this');
});

test('verify / measure-outcome goals have no fitting capability today -> missing with the quest schema, no invention',async t=>{
  const app=await setup(t);
  app.setMode('ok');const done=await app.runOwnerQuest('산출물 있는 완료 목표','completed');
  const created=await app.post('/api/quests/synthesize');
  assert.equal(created.body.quest.synthesis.archetype,'measure-outcome');
  const state=app.disk(),quest=state.quests.find(q=>q.synthesis);
  const found=discoverCapability(state,quest,{manifests:REVIEWED});
  assert.equal(found.requirement.recordType,'quest');assert.deepEqual(found.requirement.recordIds,[done.quest.id]);
  assert.equal(found.gap,'missing');assert.equal(found.candidate,null);
  assert.deepEqual(found.requirement.fields,RECORD_PROJECTIONS.quest.fields);
  const brief=found.rejected.find(r=>r.id==='evidence-gap-brief');
  assert.deepEqual(brief.missing.sort(),['evidenceCount','nextStep','priority'],'a title alone does not make evidence-gap-brief fit');
  assert.equal(manifestFits(EVIDENCE_GAP_BRIEF,found.requirement).fits,false);
});

test('fails closed: owner quests, vanished or re-statused records, unknown evidence kinds, code bundles without a declarative schema',async t=>{
  const app=await setup(t);
  await app.runOwnerQuest('첫 소유자 목표','failed');const b=await app.runOwnerQuest('둘째 소유자 목표','failed');
  await app.post('/api/quests/synthesize');
  const state=app.disk(),quest=state.quests.find(q=>q.synthesis),owner=state.quests.find(q=>!q.synthesis);

  assert.deepEqual(requiredCapability(state,owner),{ok:false,reason:'not_autonomous',questId:owner.id});
  assert.equal(discoverCapabilities(state,{manifests:REVIEWED}).length,1,'owner quests are never discovered against');

  const gone={...state,jobs:state.jobs.filter(j=>j.id!==b.job.id)};
  const vanished=discoverCapability(gone,quest,{manifests:REVIEWED});
  assert.equal(vanished.gap,'evidence_changed');assert.deepEqual(vanished.detail.missing,[b.job.id]);assert.equal(vanished.candidate,null);

  const restatused={...state,jobs:state.jobs.map(j=>j.id===b.job.id?{...j,status:'completed'}:j)};
  assert.equal(discoverCapability(restatused,quest,{manifests:REVIEWED}).gap,'evidence_changed','a job that is no longer failed is not repair material');

  const unknown={...quest,synthesis:{...quest.synthesis,evidence:[{kind:'made_up_signal',references:[{type:'job',id:b.job.id}],values:{}}]}};
  const unknownResult=discoverCapability(state,unknown,{manifests:REVIEWED});
  assert.equal(unknownResult.gap,'no_records');assert.equal(unknownResult.reason,'unknown_evidence_kind');

  const noRefs={...quest,synthesis:{...quest.synthesis,evidence:[{kind:'repeated_failed_jobs',references:[{type:'quest',id:quest.id}],values:{}}]}};
  assert.equal(discoverCapability(state,noRefs,{manifests:REVIEWED}).reason,'no_records');

  // A code bundle has fixtures but no declarative schema: searched, rejected, never matched.
  const code=importCode(state.codeWorkshop,{schemaVersion:1,id:'code-bundle',version:'1.0.0',name:'코드 묶음',description:'스키마 없는 코드',source:{kind:'owner',url:'',commit:'',license:'Owner','licenseText':'Owner use'},
    files:[{path:'index.mjs',content:'export default input=>input;'}],entry:'index.mjs',fixtures:[{name:'a',input:{records:[]},expected:{records:[]}},{name:'b',input:{records:[1]},expected:{records:[1]}}]},{at:NOW});
  const withCode=discoverCapability({...state,codeWorkshop:code.registry},quest,{manifests:REVIEWED});
  assert.equal(withCode.gap,'none');
  assert.deepEqual(withCode.rejected.find(r=>r.id==='code-bundle'),{id:'code-bundle',origin:'inactive_owner_review',engine:'quickjs-v1',reason:'no_input_contract',missing:[],mismatched:[]});

  assert.throws(()=>searchCapabilities({...state,capabilities:{...state.capabilities,version:2}},requiredCapability(state,quest).requirement),/검증/,'a corrupt registry is not searched');
  for(const [kind,rule] of Object.entries(EVIDENCE_RECORDS))assert.ok(RECORD_PROJECTIONS[rule.type],`${kind} projects a known record type`);
  assert.equal(DISCOVERY_VERSION,1);
});

const CODE=(source,fixtures=2)=>({schemaVersion:1,id:'ext-code',version:'1.0.0',name:'외부 코드',description:'외부에서 온 코드',source,
  files:[{path:'index.mjs',content:'export default input=>input;'}],entry:'index.mjs',fixtures:[{name:'a',input:{records:[]},expected:{records:[]}},{name:'b',input:{records:[1]},expected:{records:[1]}}].slice(0,fixtures)});
const COMMIT='a'.repeat(40);
const GITHUB={kind:'github',url:'https://github.com/example/tool',commit:COMMIT,license:'MIT',licenseText:'Permission is hereby granted, free of charge ... THE SOFTWARE IS PROVIDED "AS IS"'};
const proofFor=manifest=>({engine:'quickjs-v1',hash:codeHash(manifest),passed:manifest.fixtures.length,deterministic:true,fixtures:manifest.fixtures.map(f=>({name:f.name,inputSha256:codeHash(f.input),outputSha256:codeHash(f.expected)}))});
const codeCandidate=(manifest,verified)=>({origin:'reviewed_manifest',engine:'quickjs-v1',id:manifest.id,hash:null,version:manifest.version,verified,fixtureCount:manifest.fixtures.length});

test('qualifyCandidate: active -> reuse without acquisition; reviewed native manifest -> owner-approved capability change; external code needs license + pinned commit + sandbox proof + fixtures; owner-disabled never re-activates; emergency stop blocks everything',()=>{
  const active=qualifyCandidate({origin:'active',engine:'declarative-v1',id:'failure-triage',hash:'f'.repeat(64),verified:true,fixtureCount:2});
  assert.deepEqual([active.action,active.risk,active.approvalRequired,active.eligible,active.blockers],['reuse','local-reversible',false,true,[]]);
  assert.ok(QUALIFY_CHECKS.every(name=>active.checks[name]===true));

  const reviewed=qualifyCandidate({origin:'reviewed_manifest',engine:'declarative-v1',id:'ledger-digest',hash:null,verified:false,fixtureCount:LEDGER_DIGEST.fixtures.length},{manifest:LEDGER_DIGEST});
  assert.deepEqual([reviewed.action,reviewed.risk,reviewed.approvalRequired,reviewed.eligible],['acquire_with_owner_approval','capability-change',true,true]);
  assert.match(reviewed.hash,/^[a-f0-9]{64}$/,'hash comes from the manifest itself, not from the caller');
  assert.equal(qualifyCandidate({origin:'reviewed_manifest',engine:'declarative-v1',id:'ledger-digest',hash:'0'.repeat(64),verified:false,fixtureCount:2},{manifest:LEDGER_DIGEST}).blockers[0],'hash_mismatch');
  const tampered=qualifyCandidate({origin:'reviewed_manifest',engine:'declarative-v1',id:'ledger-digest',hash:null,verified:false,fixtureCount:2},{manifest:{...LEDGER_DIGEST,steps:[{op:'shell'}]}});
  assert.equal(tampered.eligible,false);assert.deepEqual(tampered.blockers,['manifest_invalid']);

  // Acceptance 3: external code candidate.
  const full=CODE(GITHUB);
  const good=qualifyCandidate(codeCandidate(full,true),{manifest:full});
  assert.deepEqual([good.action,good.risk,good.approvalRequired,good.eligible],['acquire_with_owner_approval','external-code',true,true],'even a fully verified external bundle still needs the owner');
  const noSandbox=qualifyCandidate(codeCandidate(full,false),{manifest:full});
  assert.deepEqual([noSandbox.eligible,noSandbox.blockers],[false,['sandbox_proof_missing']]);
  const pendingLicense=CODE({...GITHUB,license:'pending',licenseText:'pending'});
  assert.deepEqual(qualifyCandidate(codeCandidate(pendingLicense,true),{manifest:pendingLicense}).blockers,['license_unreviewed']);
  const unpinned=CODE({...GITHUB,commit:'0'.repeat(40)});
  assert.deepEqual(qualifyCandidate(codeCandidate(unpinned,true),{manifest:unpinned}).blockers,['commit_not_pinned']);
  const branchRef=CODE({...GITHUB,commit:'main'});
  assert.deepEqual(qualifyCandidate(codeCandidate(branchRef,true),{manifest:branchRef}).blockers,['manifest_invalid'],'code-workshop already refuses a non-commit ref');
  const oneFixture=CODE(GITHUB,1);
  assert.ok(qualifyCandidate(codeCandidate(oneFixture,true),{manifest:oneFixture}).blockers.includes('manifest_invalid'));
  assert.equal(qualifyCandidate({...codeCandidate(full,true),hash:'0'.repeat(64)},{manifest:full}).blockers[0],'hash_mismatch');
  const ownerCode=CODE({kind:'owner',url:'',commit:'',license:'Owner','licenseText':'Owner use'});
  assert.equal(qualifyCandidate(codeCandidate(ownerCode,true),{manifest:ownerCode}).risk,'capability-change');

  // Acceptance 4: owner-disabled -> no automatic re-activation, whatever else is true.
  const disabled=qualifyCandidate({origin:'inactive_owner_review',engine:'declarative-v1',id:'ledger-digest',hash:null,verified:true,fixtureCount:2},{manifest:LEDGER_DIGEST});
  assert.deepEqual([disabled.action,disabled.blockers],['blocked',['owner_disabled_or_fixture_failed']]);
  // Acceptance 16: emergency stop outranks even reuse.
  const stopped=qualifyCandidate({origin:'active',engine:'declarative-v1',id:'failure-triage',hash:'f'.repeat(64),verified:true,fixtureCount:2},{emergencyStop:true});
  assert.deepEqual([stopped.action,stopped.blockers,stopped.checks.emergencyStop],['blocked',['emergency_stop'],false]);
  assert.equal(qualifyCandidate(null).eligible,false);
  assert.equal(qualifyCandidate({origin:'reviewed_manifest',engine:'wasm',id:'x',hash:null}).blockers[0],'unknown_engine');
});

test('qualifyCandidate on real registry facts: imported GitHub code is blocked until its sandbox proof is recorded, then owner-gated; discovery still never matches it without a declarative schema',()=>{
  const full=CODE(GITHUB);
  let registry=importCode({version:1,entries:[],history:[]},full,{at:NOW}).registry;
  const held=()=>{const entry=registry.entries[0],version=entry.versions[0];return {origin:entry.activeHash?'active':'inactive_owner_review',engine:'quickjs-v1',id:entry.id,hash:version.hash,version:version.manifest.version,verified:!!version.verification,fixtureCount:version.manifest.fixtures.length,manifest:version.manifest};};
  let c=held();
  const before=qualifyCandidate({...c,origin:'reviewed_manifest'},{manifest:c.manifest});
  assert.deepEqual(before.blockers,['sandbox_proof_missing']);assert.equal(before.hash,c.hash,'hash agrees with the registry');
  registry=recordCodeVerification(registry,'ext-code',c.hash,proofFor(full),{at:NOW}).registry;
  c=held();
  const after=qualifyCandidate({...c,origin:'reviewed_manifest'},{manifest:c.manifest});
  assert.deepEqual([after.eligible,after.action,after.approvalRequired],[true,'acquire_with_owner_approval',true]);
  assert.equal(qualifyCandidate(c,{manifest:c.manifest}).blockers[0],'owner_disabled_or_fixture_failed','held but not active is never auto-activated');
});
