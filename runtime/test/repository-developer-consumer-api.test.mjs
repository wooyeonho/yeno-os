import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {reconcileRepositoryPatchArtifact} from '../lib/repository-patch-artifact.mjs';
import {PATCH_SCHEMA,repositoryPrompt,sha256} from '../lib/repository-patch.mjs';
import {REPOSITORY_DEVELOPER_AGENT} from '../lib/repository-developer-order.mjs';
import {createDeveloperOrderGateway} from '../../workers/developer/gateway.mjs';
import {createRepositoryDeveloperConsumer,fakeExecutorAdapter} from '../../workers/developer/consumer.mjs';

test('real loopback core and gateway complete one order with a clearly fake executor and do not run it twice',async t=>{
  const root=await fs.promises.mkdtemp(path.join(os.tmpdir(),'b5-consumer-api-')),dataDir=path.join(root,'data'),repositoryRoot=path.join(root,'repo'),journalDir=path.join(root,'journal'),ownerToken='synthetic-b5-owner';await fs.promises.mkdir(repositoryRoot);
  const source='export const sum = xs => 0;',task={baseCommit:'a'.repeat(40),goal:'Fix bounded sum',files:[{path:'projects/demo/main.mjs',content:source,sha256:sha256(source)}],editablePaths:['projects/demo/main.mjs'],feedback:''},patch={schema:PATCH_SCHEMA,baseCommit:task.baseCommit,changes:[{path:task.files[0].path,beforeSha256:task.files[0].sha256,content:'export const sum = xs => xs.reduce((a,b)=>a+b,0);'}]},at='2026-10-07T12:00:00.000Z';
  const store=openStore(dataDir),job={id:randomUUID(),title:'Bounded repository patch',type:'agent',input:repositoryPrompt(task),status:'completed',step:3,totalSteps:3,createdAt:at,updatedAt:at,error:null,version:1,artifacts:[],callLimit:1,repositoryTask:task,developerRequestId:randomUUID(),developerAgent:structuredClone(REPOSITORY_DEVELOPER_AGENT)};reconcileRepositoryPatchArtifact({job,state:store.state,dataDir,content:JSON.stringify(patch)});store.state.jobs.push(job);store.save();
  const core=await start({dataDir,host:'127.0.0.1',port:0,token:ownerToken,env:{NODE_ENV:'test'}}),origin=`http://127.0.0.1:${core.server.address().port}`;
  const raw=async(route,token,body)=>{const response=await fetch(origin+route,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,value:await response.json()};};
  const enrolled=await raw('/api/v1/devices/enroll',ownerToken,{requestId:randomUUID(),name:'synthetic B5 worker',platform:'developer-worker'});assert.equal(enrolled.status,201);const gateway=createDeveloperOrderGateway({origin,token:enrolled.value.device.deviceToken,allowInsecureLoopback:true});let executions=0;
  const executor=fakeExecutorAdapter(async({order})=>{executions++;return{schema:1,contractId:order.jobId,baseCommit:order.baseCommit,testFiles:[{path:'projects/demo/main.test.mjs',sha256:sha256('test')}],dockerImageId:`sha256:${'d'.repeat(64)}`,attempts:[{number:1,exitCode:0,timedOut:false,outputOverflow:false,stdoutSha256:sha256('out'),stderrSha256:sha256('err'),isolation:'in-process-fake-executor',passed:true}],patchSha256:order.artifact.sha256,candidateCommit:null,publish:null,ciRun:null,approval:null,promotion:null,rollback:null,reportedAt:at};});
  const consumer=createRepositoryDeveloperConsumer({gateway,executor,repositoryRoot,allowedRoots:[repositoryRoot],journalDir,testFiles:['projects/demo/main.test.mjs'],heartbeatIntervalMs:10000}),result=await consumer.runOnce();assert.equal(result.status,'completed');assert.equal(executions,1);const state=(await raw('/api/v1/state',enrolled.value.device.deviceToken)).value.jobs.find(item=>item.id===job.id);assert.equal(state.repositoryPlan.developerOrder.status,'evidence-received');assert.equal(state.repositoryPlan.verificationStatus,'test-adapter-verified');assert.equal((await consumer.runOnce()).status,'no-work');assert.equal(executions,1);
  t.after(async()=>{core.shutdown();await fs.promises.rm(root,{recursive:true,force:true});});
});
