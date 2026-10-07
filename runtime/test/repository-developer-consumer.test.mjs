import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sha256} from '../lib/repository-patch.mjs';
import {createRepositoryDeveloperConsumer,fakeExecutorAdapter} from '../../workers/developer/consumer.mjs';
import {DeveloperGatewayError} from '../../workers/developer/gateway.mjs';

const artifactBytes=Buffer.from(JSON.stringify({schema:'blackhole.repository-patch.v1',baseCommit:'a'.repeat(40),changes:[{path:'projects/demo/main.mjs',beforeSha256:sha256('old'),content:'new'}]}));
const evidence=(order)=>({schema:1,contractId:order.jobId,baseCommit:order.baseCommit,testFiles:[{path:'projects/demo/main.test.mjs',sha256:sha256('test')}],dockerImageId:`sha256:${'b'.repeat(64)}`,attempts:[{number:1,exitCode:0,timedOut:false,outputOverflow:false,stdoutSha256:sha256('out'),stderrSha256:sha256('err'),isolation:'in-process-fake-executor',passed:true}],patchSha256:order.artifact.sha256,candidateCommit:null,publish:null,ciRun:null,approval:null,promotion:null,rollback:null,reportedAt:'2026-10-07T12:00:00.000Z'});

function fakeGateway({noWork=false,offline=false,beginStale=false,cancelOnHeartbeat=false,claimDelivery='normal',delivery='normal'}={}){
  const order={id:randomUUID(),jobId:randomUUID(),requestId:randomUUID(),status:'queued',workerStatus:'no-worker',baseCommit:'a'.repeat(40),artifact:{id:randomUUID(),sha256:sha256(artifactBytes)},fence:0,contractId:randomUUID()},calls=[];let submitCount=0,claimCount=0,claimedRequestId=null;
  const gateway={
    async listOrders(){calls.push(['list']);if(offline)throw new DeveloperGatewayError('offline',{outcome:'unknown'});return noWork?[]:[structuredClone(order)];},
    async claim(jobId,requestId){calls.push(['claim',jobId,requestId]);claimCount++;if(claimedRequestId!==requestId){claimedRequestId=requestId;order.status='claimed';order.workerStatus='claimed';order.fence++;}if(claimDelivery==='accept-then-lose'&&claimCount===1)throw new DeveloperGatewayError('transport_outcome_unknown',{outcome:'unknown'});return{jobId,order:structuredClone(order)};},
    async fetchArtifact(ref){calls.push(['artifact',ref.id]);return Buffer.from(artifactBytes);},
    async begin(jobId,fence,requestId){calls.push(['begin',jobId,fence,requestId]);if(beginStale)throw new DeveloperGatewayError('DEVELOPER_ORDER_RECEIPT_STALE',{status:409});order.status='begun';order.workerStatus='begun';return{jobId,order:structuredClone(order)};},
    async heartbeat(jobId,fence,requestId){calls.push(['heartbeat',jobId,fence,requestId]);if(cancelOnHeartbeat){order.status='held';order.workerStatus='uncertain-held';order.holdReason='owner-cancelled-after-begin';throw new DeveloperGatewayError('DEVELOPER_ORDER_RECEIPT_STALE',{status:409,payload:{order:structuredClone(order)}});}return{jobId,order:structuredClone(order)};},
    async submitEvidence(jobId,fence,report,requestId){calls.push(['evidence',jobId,fence,requestId]);submitCount++;if(delivery==='lose-before'&&submitCount===1)throw new DeveloperGatewayError('transport_outcome_unknown',{outcome:'unknown'});order.status='evidence-received';order.workerStatus='evidence-received';if(delivery==='accept-then-lose'&&submitCount===1)throw new DeveloperGatewayError('transport_outcome_unknown',{outcome:'unknown'});return{jobId,job:{repositoryPlan:{developerOrder:{status:order.status}}}};},
  };return{gateway,order,calls,get submitCount(){return submitCount;},get claimCount(){return claimCount;}};
}

async function setup(t,options={}){
  const root=await fs.promises.mkdtemp(path.join(os.tmpdir(),'b5-consumer-')),repositoryRoot=path.join(root,'repo'),journalDir=path.join(root,'journal');await fs.promises.mkdir(repositoryRoot);const fake=fakeGateway(options);let executions=0;
  const executor=fakeExecutorAdapter(async({order,guard})=>{executions++;await guard();return evidence(order);});
  const create=()=>createRepositoryDeveloperConsumer({gateway:fake.gateway,executor,repositoryRoot,allowedRoots:[repositoryRoot],journalDir,testFiles:['projects/demo/main.test.mjs'],heartbeatIntervalMs:10000});
  t.after(()=>fs.promises.rm(root,{recursive:true,force:true}));return{root,repositoryRoot,journalDir,fake,create,get executions(){return executions;}};
}

test('fake gateway/executor normal flow claims, begins, heartbeats, executes once and delivers evidence',async t=>{
  const h=await setup(t),result=await h.create().runOnce();assert.equal(result.status,'completed');assert.equal(h.executions,1);assert.deepEqual(h.fake.calls.map(call=>call[0]).filter((value,index,array)=>index===0||value!==array[index-1]).slice(0,7),['list','claim','artifact','begin','heartbeat','list','evidence']);const journal=JSON.parse(await fs.promises.readFile(path.join(h.journalDir,`order-${h.fake.order.id}.json`),'utf8'));assert.equal(journal.status,'completed');assert.equal(journal.fence,1);assert.equal(journal.evidence.patchSha256,h.fake.order.artifact.sha256);
});

test('accepted claim with a lost response replays the same claim identity and proceeds without an uncertain execution hold',async t=>{
  const h=await setup(t,{claimDelivery:'accept-then-lose'}),first=await h.create().runOnce();assert.equal(first.status,'claim-unknown');assert.equal(h.executions,0);const second=await h.create().runOnce();assert.equal(second.status,'completed');assert.equal(h.executions,1);assert.equal(h.fake.claimCount,2);const claims=h.fake.calls.filter(call=>call[0]==='claim');assert.equal(claims[0][2],claims[1][2]);assert.equal(h.fake.order.fence,1);
});

test('restart after a durable claim reconciles the exact fence and continues before begin',async t=>{
  const h=await setup(t);await h.fake.gateway.claim(h.fake.order.jobId,'developer-consumer:test:claim:0');const journal={schema:1,orderId:h.fake.order.id,jobId:h.fake.order.jobId,status:'claimed',fence:h.fake.order.fence,order:structuredClone(h.fake.order),claimRequestId:'developer-consumer:test:claim:0',beginRequestId:'developer-consumer:test:begin:0',evidenceRequestId:'developer-consumer:test:evidence:0',heartbeatSequence:0,evidence:null,reason:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};await fs.promises.mkdir(h.journalDir);await fs.promises.writeFile(path.join(h.journalDir,`order-${journal.orderId}.json`),JSON.stringify(journal));const result=await h.create().runOnce();assert.equal(result.status,'completed');assert.equal(h.executions,1);assert.equal(h.fake.claimCount,1);assert.equal(h.fake.calls.filter(call=>call[0]==='begin').length,1);
});

test('lost evidence response retries the same delivery identity after restart without rerunning fake execution',async t=>{
  const h=await setup(t,{delivery:'lose-before'}),first=await h.create().runOnce();assert.equal(first.status,'delivery-unknown');assert.equal(h.executions,1);const second=await h.create().runOnce();assert.equal(second.status,'completed');assert.equal(h.executions,1);const deliveries=h.fake.calls.filter(call=>call[0]==='evidence');assert.equal(deliveries.length,2);assert.equal(deliveries[0][3],deliveries[1][3]);
});

test('accepted evidence with a lost response reconciles terminal core state without duplicate execution or delivery',async t=>{
  const h=await setup(t,{delivery:'accept-then-lose'}),first=await h.create().runOnce();assert.equal(first.status,'delivery-unknown');assert.equal(h.executions,1);const second=await h.create().runOnce();assert.equal(second.status,'completed');assert.equal(second.reconciled,true);assert.equal(h.executions,1);assert.equal(h.fake.submitCount,1);
});

test('restart with a begun or executing journal holds unknown work and never calls the fake executor',async t=>{
  const h=await setup(t),journal={schema:1,orderId:h.fake.order.id,jobId:h.fake.order.jobId,status:'executing',fence:1,order:{...h.fake.order,status:'begun',fence:1},claimRequestId:'claim',beginRequestId:'begin',evidenceRequestId:'evidence',heartbeatSequence:1,evidence:null,reason:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};await fs.promises.mkdir(h.journalDir);await fs.promises.writeFile(path.join(h.journalDir,`order-${journal.orderId}.json`),JSON.stringify(journal));const result=await h.create().runOnce();assert.equal(result.status,'held-local-unknown');assert.equal(h.executions,0);assert.equal(h.fake.calls.length,0);
});

test('known stale fence at begin becomes superseded and never invokes the fake executor',async t=>{
  const h=await setup(t,{beginStale:true}),result=await h.create().runOnce();assert.equal(result.status,'superseded');assert.equal(h.executions,0);assert.equal(h.fake.calls.some(call=>call[0]==='begin'),true);assert.equal(h.fake.calls.some(call=>call[0]==='evidence'),false);
});

test('owner cancellation observed by heartbeat aborts before fake execution',async t=>{
  const h=await setup(t,{cancelOnHeartbeat:true}),result=await h.create().runOnce();assert.equal(result.status,'held-local-unknown');assert.equal(h.executions,0);assert.equal(h.fake.calls.some(call=>call[0]==='heartbeat'),true);
});

test('no-worker/no-order and offline gateway are explicit and create no journal',async t=>{
  const idle=await setup(t,{noWork:true});assert.deepEqual(await idle.create().runOnce(),{status:'no-work'});assert.equal(fs.readdirSync(idle.journalDir).length,0);const offline=await setup(t,{offline:true});const result=await offline.create().runOnce();assert.equal(result.status,'offline');assert.equal(offline.executions,0);assert.equal(fs.readdirSync(offline.journalDir).length,0);
});

test('repository root must be an exact host allowlist member and journal must be outside it',async t=>{
  const h=await setup(t),other=path.join(h.root,'other');await fs.promises.mkdir(other);assert.throws(()=>createRepositoryDeveloperConsumer({gateway:h.fake.gateway,executor:fakeExecutorAdapter(async()=>{}),repositoryRoot:h.repositoryRoot,allowedRoots:[other],journalDir:h.journalDir,testFiles:['projects/demo/main.test.mjs']}),/repository_root_not_allowlisted/);assert.throws(()=>createRepositoryDeveloperConsumer({gateway:h.fake.gateway,executor:fakeExecutorAdapter(async()=>{}),repositoryRoot:h.repositoryRoot,allowedRoots:[h.repositoryRoot],journalDir:path.join(h.repositoryRoot,'journal'),testFiles:['projects/demo/main.test.mjs']}),/journal_must_be_outside_source/);
});

test('journal containment rejects a junction or symlink target and linked parent inside the repository',async t=>{
  const h=await setup(t),target=path.join(h.repositoryRoot,'.consumer-journal'),linked=path.join(h.root,'outside-looking-journal'),parentTarget=path.join(h.repositoryRoot,'.journal-parent'),linkedParent=path.join(h.root,'outside-looking-parent');await fs.promises.mkdir(target);await fs.promises.mkdir(parentTarget);await fs.promises.symlink(target,linked,process.platform==='win32'?'junction':'dir');await fs.promises.symlink(parentTarget,linkedParent,process.platform==='win32'?'junction':'dir');const createAt=journalDir=>createRepositoryDeveloperConsumer({gateway:h.fake.gateway,executor:fakeExecutorAdapter(async()=>{}),repositoryRoot:h.repositoryRoot,allowedRoots:[h.repositoryRoot],journalDir,testFiles:['projects/demo/main.test.mjs']});assert.throws(()=>createAt(linked),/journal_must_be_outside_source/);assert.throws(()=>createAt(path.join(linkedParent,'new-journal')),/journal_must_be_outside_source/);assert.equal(fs.existsSync(path.join(parentTarget,'new-journal')),false);
});

test('a legitimate external journal is canonicalized and used outside the repository',async t=>{
  const h=await setup(t,{noWork:true}),externalParent=path.join(h.root,'external-parent'),external=path.join(externalParent,'journal');await fs.promises.mkdir(externalParent);const consumer=createRepositoryDeveloperConsumer({gateway:h.fake.gateway,executor:fakeExecutorAdapter(async()=>{}),repositoryRoot:h.repositoryRoot,allowedRoots:[h.repositoryRoot],journalDir:external,testFiles:['projects/demo/main.test.mjs']});assert.equal(consumer.journalDir,fs.realpathSync(external));assert.equal((await consumer.runOnce()).status,'no-work');assert.equal(fs.existsSync(path.join(h.repositoryRoot,'consumer.lock')),false);
});

test('a dead process lock is recovered while a live process lock is refused',async t=>{
  const h=await setup(t,{noWork:true}),consumer=h.create(),lock=path.join(h.journalDir,'consumer.lock');await fs.promises.writeFile(lock,JSON.stringify({schema:1,pid:2147483647,token:randomUUID(),createdAt:new Date().toISOString()}));assert.equal((await consumer.runOnce()).status,'no-work');assert.equal(fs.existsSync(lock),false);await fs.promises.writeFile(lock,JSON.stringify({schema:1,pid:process.pid,token:randomUUID(),createdAt:new Date().toISOString()}));await assert.rejects(h.create().runOnce(),/consumer_already_running/);
});
