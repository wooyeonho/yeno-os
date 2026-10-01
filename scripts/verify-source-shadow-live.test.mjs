import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as verifier from './verify-source-shadow-live.mjs';
import {missionSettled} from './verify-source-shadow-live.mjs';

test('an automatic semantic PASS cannot mark a scene-bound card accepted when content checks fail',()=>{
  assert.equal(typeof verifier.acceptedShadowResult,'function');
  const report={phase:'completed',verifier:{deterministic:true,semantic:'pass'},memoryEventIds:['result'],artifact:{id:'artifact'},taskSpecSha256:'task-hash',sceneInputSha256:'scene-hash',contentAcceptance:{passed:false}};
  assert.equal(verifier.acceptedShadowResult(report),false);
  assert.equal(verifier.acceptedShadowResult({...report,contentAcceptance:{passed:true}}),true);
  assert.equal(verifier.acceptedShadowResult({...report,sceneInputSha256:null,contentAcceptance:{passed:true}}),false,'omitting the scene evidence cannot bypass the gate');
  assert.equal(verifier.acceptedShadowResult({...report,taskSpecSha256:null,contentAcceptance:{passed:true}}),false,'omitting the predeclared task criterion cannot bypass the gate');
});

test('the Builder receives the bounded scene contract used by the independent gate',()=>{
  const scene=JSON.parse(fs.readFileSync(new URL('../experiments/extra-136-occlusion/SCENE_INPUT_20260927.json',import.meta.url),'utf8'));
  const sourceId='11111111-1111-4111-8111-111111111111';
  const evidence=verifier.extra136BuilderEvidence(scene,'a'.repeat(64),sourceId);
  assert.ok(evidence.length<=2000);
  assert.ok(evidence.includes(sourceId));
  assert.ok(evidence.includes('extra136-card-v1'));
  assert.ok(evidence.includes('partial-edge'));
  assert.ok(evidence.includes(scene.htmlSha256));
});

test('low-memory preflight blocks before a local model mission starts',async t=>{
  assert.equal(typeof verifier.memoryPreflight,'function');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-shadow-preflight-'));
  t.after(()=>{fs.unlinkSync(path.join(root,'input.json'));fs.unlinkSync(path.join(root,'result','report.json'));fs.rmdirSync(path.join(root,'result'));fs.rmdirSync(root);});
  const input=path.join(root,'input.json'),output=path.join(root,'result');
  fs.writeFileSync(input,JSON.stringify({packageSha256:'synthetic',items:[{ledgerId:'EXTRA-136',source:{readingStatus:'partial'}}]}));
  const report=await verifier.verifySourceShadow({input,output,systemProbe:()=>({freeBytes:2*1024**3,ollamaPs:'NAME ID SIZE PROCESSOR CONTEXT UNTIL'})});
  assert.equal(report.status,'BLOCKED');
  assert.equal(report.blockReason,'insufficient_memory');
  assert.equal(report.preflight.freeGiB,2);
  assert.equal(fs.existsSync(path.join(output,'runtime')),false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output,'report.json'),'utf8')).blockReason,'insufficient_memory');
});

test('remote provider does not inherit the local RAM gate',async()=>{
  const probe={freeBytes:0,ollamaPs:'not queried'};
  const local=verifier.memoryPreflight(probe,'local');
  const remote=verifier.memoryPreflight(probe,'gemini');
  assert.equal(local.applies,true);
  assert.equal(local.ready,false);
  assert.equal(remote.provider,'gemini');
  assert.equal(remote.applies,false);
  assert.equal(remote.ready,true);
  assert.equal(remote.minimumGiB,null);
});

test('remote run without a configured key stops before starting a core',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-shadow-remote-preflight-'));
  t.after(()=>{fs.unlinkSync(path.join(root,'input.json'));fs.unlinkSync(path.join(root,'result','report.json'));fs.rmdirSync(path.join(root,'result'));fs.rmdirSync(root);});
  const input=path.join(root,'input.json'),output=path.join(root,'result');
  fs.writeFileSync(input,JSON.stringify({packageSha256:'synthetic',items:[{ledgerId:'EXTRA-136',source:{readingStatus:'partial'}}]}));
  const report=await verifier.verifySourceShadow({input,output,provider:'gemini',model:'test-model',systemProbe:()=>({freeBytes:0,ollamaPs:'not queried'}),providerEnvironment:{}});
  assert.equal(report.status,'BLOCKED');
  assert.equal(report.blockReason,'provider_not_configured');
  assert.equal(report.preflight.applies,false);
  assert.equal(fs.existsSync(path.join(output,'runtime')),false);
  assert.equal(JSON.stringify(report).includes('API_KEY'),false);
});

test('acceptance waits through the completed-leaves to queued-builder transition',()=>{
  const missionId='mission';
  const job=(id,status,extra={})=>({id,status,shadowAssignment:{missionId,dependsOnJobIds:[]},...extra});
  const leaves=[job('scout','completed'),job('researcher','completed')];
  const builder=job('builder','paused',{pauseReason:'dependencyPending',shadowAssignment:{missionId,dependsOnJobIds:['scout','researcher']}});
  assert.equal(missionSettled({missionId,phase:'blocked'},{jobs:[...leaves,builder]}),false,'builder is eligible to leave dependencyPending');
  assert.equal(missionSettled({missionId,phase:'blocked'},{jobs:[...leaves,{...builder,pauseReason:'providerMissing'}]}),true,'a genuine provider hold remains blocked');
  assert.equal(missionSettled({missionId,phase:'failed'},{jobs:[...leaves,job('builder','running')]}),false,'an active worker must settle before shutdown');
  assert.equal(missionSettled({missionId,phase:'failed'},{jobs:[...leaves,job('builder','failed')]}),true);
});
