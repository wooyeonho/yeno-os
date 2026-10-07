import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {PATCH_SCHEMA,sha256} from '../lib/repository-patch.mjs';
import {createDeveloperOrderGateway} from '../../workers/developer/gateway.mjs';
import {createRepositoryDeveloperConsumer,fakeExecutorAdapter} from '../../workers/developer/consumer.mjs';
import {PHONE_REPOSITORY_AGENT_ID,createPhoneRepositoryOrderClient,projectPhoneRepositoryOrder} from '../../apps/controller/src/repository-order-client.mjs';

const source='export const sum = xs => 0;';
const task={baseCommit:'a'.repeat(40),goal:'Fix the bounded sum implementation',files:[{path:'projects/demo/main.mjs',content:source,sha256:sha256(source)}],editablePaths:['projects/demo/main.mjs'],feedback:''};
const patch={schema:PATCH_SCHEMA,baseCommit:task.baseCommit,changes:[{path:task.files[0].path,beforeSha256:task.files[0].sha256,content:'export const sum = xs => xs.reduce((a,b)=>a+b,0);'}]};
const modelReply=()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(patch)}}],usage:{prompt_tokens:10,completion_tokens:20}}),{headers:{'Content-Type':'application/json'}});
const publicJob=(id=randomUUID(),requestId=randomUUID())=>({id,status:'completed',error:null,pauseReason:null,artifacts:[],repositoryPlan:{requestId,agent:{id:PHONE_REPOSITORY_AGENT_ID},patchStatus:'patch-drafted',executionStatus:'not-received',workerStatus:'no-worker',verificationStatus:'not-received',developerOrder:null,evidence:null}});
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

test('exact phone payload keeps request, agent, order and artifact identity through the existing consumer and supports idempotent owner cancellation',async t=>{
  const root=await fs.promises.mkdtemp(path.join(os.tmpdir(),'b6-phone-order-')),dataDir=path.join(root,'data'),repositoryRoot=path.join(root,'repo'),journalDir=path.join(root,'journal'),pairingToken='synthetic-b6-pairing-only';await fs.promises.mkdir(repositoryRoot);
  const store=openStore(dataDir);store.state.modules.ai=true;store.save();let modelCalls=0;
  const core=await start({dataDir,host:'127.0.0.1',port:0,token:pairingToken,fixtureMode:true,env:{NODE_ENV:'test',YENO_AGENT_PROVIDER:'openai',YENO_AGENT_DAILY_CALL_LIMIT:'10',YENO_OPENAI_MODEL:'synthetic-b6-model',YENO_OPENAI_API_KEY:'synthetic-b6-key'},agentFetch:async()=>{modelCalls++;return modelReply();}}),origin=`http://127.0.0.1:${core.server.address().port}`;
  const raw=async(route,token,body)=>{const response=await fetch(origin+route,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});let value;try{value=await response.json();}catch{value=null;}return{status:response.status,value};};
  const phoneEnrollment=await raw('/api/v1/devices/enroll',pairingToken,{requestId:randomUUID(),name:'synthetic B6 phone',platform:'android'});assert.equal(phoneEnrollment.status,201);const phone=createPhoneRepositoryOrderClient({origin,token:phoneEnrollment.value.device.deviceToken});
  assert.equal((await raw('/api/v1/developer/plan',phoneEnrollment.value.device.deviceToken,{requestId:randomUUID(),agentId:'different-agent',task})).status,400);assert.equal(modelCalls,0);
  const waitFor=async(jobId,predicate)=>{for(let n=0;n<160;n++){const view=await phone.read(jobId);if(predicate(view))return view;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('phone order timeout');};
  const phonePayload={requestId:randomUUID(),agentId:PHONE_REPOSITORY_AGENT_ID,task},admitted=await phone.submit(phonePayload);assert.equal(admitted.requestId,phonePayload.requestId);assert.equal(admitted.agentId,phonePayload.agentId);
  const queued=await waitFor(admitted.jobId,view=>view.order?.status==='queued');assert.equal(queued.order.requestId,phonePayload.requestId);assert.equal(queued.order.agentId,phonePayload.agentId);assert.equal(queued.artifact.id!==null,true);assert.match(queued.artifact.sha256,/^[a-f0-9]{64}$/);
  const workerEnrollment=await raw('/api/v1/devices/enroll',pairingToken,{requestId:randomUUID(),name:'synthetic B6 fixture worker',platform:'developer-worker-fixture'});assert.equal(workerEnrollment.status,201);const workerToken=workerEnrollment.value.device.deviceToken;assert.equal((await raw(`/api/v1/developer/plan/${admitted.jobId}`,workerToken)).status,403);assert.equal((await raw('/api/v1/developer/plan',workerToken,{requestId:randomUUID(),agentId:PHONE_REPOSITORY_AGENT_ID,task})).status,403);assert.equal(modelCalls,1);const gateway=createDeveloperOrderGateway({origin,token:workerToken,allowInsecureLoopback:true});let executions=0;
  const executor=fakeExecutorAdapter(async({order})=>{executions++;return{schema:1,contractId:order.jobId,baseCommit:order.baseCommit,testFiles:[{path:'projects/demo/main.test.mjs',sha256:sha256('test')}],dockerImageId:`sha256:${'d'.repeat(64)}`,attempts:[{number:1,exitCode:0,timedOut:false,outputOverflow:false,stdoutSha256:sha256('out'),stderrSha256:sha256('err'),isolation:'in-process-fake-executor',passed:true}],patchSha256:order.artifact.sha256,candidateCommit:null,publish:null,ciRun:null,approval:null,promotion:null,rollback:null,reportedAt:'2026-10-07T12:00:00.000Z'};});
  const consumer=createRepositoryDeveloperConsumer({gateway,executor,repositoryRoot,allowedRoots:[repositoryRoot],journalDir,testFiles:['projects/demo/main.test.mjs'],heartbeatIntervalMs:10000});assert.equal((await consumer.runOnce()).status,'completed');
  const completed=await phone.read(admitted.jobId);assert.equal(completed.requestId,phonePayload.requestId);assert.equal(completed.agentId,phonePayload.agentId);assert.equal(completed.order.id,queued.order.id);assert.equal(completed.artifact.id,queued.artifact.id);assert.equal(completed.artifact.sha256,queued.artifact.sha256);assert.equal(completed.verificationStatus,'test-adapter-verified');assert.equal(completed.syntheticEvidence,true);assert.equal(completed.realDockerVerified,false);assert.equal(executions,1);assert.deepEqual(JSON.parse(new TextDecoder().decode(await phone.fetchArtifact(completed.artifact))),patch);assert.equal((await consumer.runOnce()).status,'no-work');assert.equal((await phone.submit(phonePayload)).jobId,admitted.jobId);assert.equal(modelCalls,1);
  const cancelPayload={requestId:randomUUID(),agentId:PHONE_REPOSITORY_AGENT_ID,task:{...task,goal:'Cancel this bounded repository task before worker execution'}},cancelAdmitted=await phone.submit(cancelPayload),cancelQueued=await waitFor(cancelAdmitted.jobId,view=>view.order?.status==='queued'),cancelRequestId=randomUUID();const cancelled=await phone.cancel({requestId:cancelRequestId,jobId:cancelQueued.jobId}),cancelReplay=await phone.cancel({requestId:cancelRequestId,jobId:cancelQueued.jobId});assert.equal(cancelled.displayState,'cancelled');assert.equal(cancelReplay.displayState,'cancelled');assert.equal(cancelReplay.order.id,cancelled.order.id);assert.equal((await consumer.runOnce()).status,'no-work');assert.equal(executions,1);assert.equal(modelCalls,2);
  t.after(async()=>{core.shutdown();await fs.promises.rm(root,{recursive:true,force:true});});
});

test('phone display distinguishes failure, unknown outcome and synthetic verification',()=>{
  const base={id:randomUUID(),status:'paused',error:null,pauseReason:'outcomeUnknown',artifacts:[],repositoryPlan:{requestId:randomUUID(),agent:{id:PHONE_REPOSITORY_AGENT_ID},patchStatus:'patch-pending',workerStatus:'awaiting-worker',verificationStatus:'not-received',executionStatus:'not-received',developerOrder:null,evidence:null}};
  assert.equal(projectPhoneRepositoryOrder(base).displayState,'outcome-unknown');assert.equal(projectPhoneRepositoryOrder({...base,status:'failed',error:'Synthetic failure',pauseReason:null}).displayState,'failed');const synthetic=projectPhoneRepositoryOrder({...base,status:'completed',pauseReason:null,repositoryPlan:{...base.repositoryPlan,patchStatus:'patch-drafted',verificationStatus:'test-adapter-verified',executionStatus:'test-adapter-verified'}});assert.equal(synthetic.displayState,'test-only');assert.equal(synthetic.realDockerVerified,false);assert.equal(synthetic.syntheticEvidence,true);
});

test('detail rejects a crossed job response and accepts an exactly bound response',async()=>{
  const requested=randomUUID(),returned=randomUUID(),crossed=createPhoneRepositoryOrderClient({origin:'http://127.0.0.1:1',token:'fixture',fetchImpl:async()=>json({jobId:returned,job:publicJob(returned)})});await assert.rejects(crossed.read(requested),error=>error.code==='identity_conflict');const valid=createPhoneRepositoryOrderClient({origin:'http://127.0.0.1:1',token:'fixture',fetchImpl:async()=>json({jobId:requested,job:publicJob(requested)})});assert.equal((await valid.read(requested)).jobId,requested);
});

test('cancel rejects a crossed job response',async()=>{
  const requested=randomUUID(),returned=randomUUID(),job=publicJob(returned);job.repositoryPlan.developerOrder={id:randomUUID(),status:'cancelled',requestId:job.repositoryPlan.requestId,agent:{id:PHONE_REPOSITORY_AGENT_ID},cancellationRequested:true,holdReason:null};const client=createPhoneRepositoryOrderClient({origin:'http://127.0.0.1:1',token:'fixture',fetchImpl:async()=>json({jobId:returned,reconciled:false,job,order:structuredClone(job.repositoryPlan.developerOrder)})});await assert.rejects(client.cancel({requestId:randomUUID(),jobId:requested}),error=>error.code==='identity_conflict');
});

test('cancel rejects a conflicting order receipt and accepts an exactly bound receipt',async()=>{
  const jobId=randomUUID(),job=publicJob(jobId);job.repositoryPlan.developerOrder={id:randomUUID(),status:'cancelled',requestId:job.repositoryPlan.requestId,agent:{id:PHONE_REPOSITORY_AGENT_ID},cancellationRequested:true,holdReason:null};const conflict={...job.repositoryPlan.developerOrder,id:randomUUID()},crossed=createPhoneRepositoryOrderClient({origin:'http://127.0.0.1:1',token:'fixture',fetchImpl:async()=>json({jobId,reconciled:false,job,order:conflict})});await assert.rejects(crossed.cancel({requestId:randomUUID(),jobId}),error=>error.code==='identity_conflict');const valid=createPhoneRepositoryOrderClient({origin:'http://127.0.0.1:1',token:'fixture',fetchImpl:async()=>json({jobId,reconciled:false,job,order:structuredClone(job.repositoryPlan.developerOrder)})});const view=await valid.cancel({requestId:randomUUID(),jobId});assert.equal(view.jobId,jobId);assert.equal(view.order.id,job.repositoryPlan.developerOrder.id);
});
