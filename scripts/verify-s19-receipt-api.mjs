import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {start} from '../runtime/server.mjs';
import {openStore} from '../runtime/lib/store.mjs';
import {missionStatus} from '../runtime/lib/shadow-army.mjs';

const out=path.resolve('build-artifacts/s19-20261001');fs.mkdirSync(out,{recursive:true});
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-s19-api-'));
const token=randomBytes(32).toString('hex');
const env={YENO_AGENT_PROVIDER:'auto',YENO_AGENT_DAILY_CALL_LIMIT:'20',YENO_LOCAL_MODEL:'synthetic-local',YENO_NVIDIA_MODEL:'synthetic-remote',YENO_NVIDIA_API_KEY:'synthetic-fixture-only'};
const verdict={verdict:'pass',confidence:0.9,criteria:[{criterion:'검증 가능한 산출물',status:'met',reason:'저장된 내용과 일치',evidenceRefs:['실제 Shadow 산출물 본문']}],summary:'저장된 산출물과 근거가 일치함'};
const agentFetch=async(_url,request)=>{
 const body=JSON.parse(request.body),semantic=body.messages.some(message=>typeof message.content==='string'&&message.content.includes('independent semantic verifier'));
 return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:semantic?JSON.stringify(verdict):'실제 Shadow 산출물 본문',tool_calls:[]}}],usage:{prompt_tokens:12,completion_tokens:8}}),{headers:{'Content-Type':'application/json'}});
};
let core;
try{
 core=await start({host:'127.0.0.1',port:0,dataDir,token,env,agentFetch});
 const base=`http://127.0.0.1:${core.server.address().port}`;
 const post=async(route,input)=>{const response=await fetch(base+route,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),...input})});return {status:response.status,body:await response.json()};};
 const project=await post('/api/projects',{name:'S19 synthetic receipt API',status:'active'});assert.equal(project.status,201);
 const mission=await post('/api/shadow-army/missions',{projectId:project.body.project.id,goal:'S19 local receipt recheck',successCriterion:'one artifact'});assert.equal(mission.status,201);
 for(let i=0;i<400;i++){if(missionStatus(mission.body.missionId,openStore(dataDir).state)?.phase==='completed')break;await new Promise(resolve=>setTimeout(resolve,25));}
 assert.equal(missionStatus(mission.body.missionId,openStore(dataDir).state)?.phase,'completed');
 const route=`/api/receipts/${mission.body.missionId}/verify`;
 const unauth=await fetch(base+route);assert.equal(unauth.status,401);
 const response=await fetch(base+route,{headers:{Authorization:`Bearer ${token}`}});assert.equal(response.status,200,await response.clone().text());
 const verified=await response.json();assert.equal(verified.receiptIntegrityVerified,true);assert.equal(verified.externalOutcomeVerified,false);
 const state=openStore(dataDir).state,reference=state.jobs.find(job=>job.shadowAssignment?.missionId===mission.body.missionId&&job.artifacts?.length).artifacts[0];
 fs.writeFileSync(path.join(dataDir,'artifacts',state.artifacts[reference.id].filename),'tampered');
 const tampered=await fetch(base+route,{headers:{Authorization:`Bearer ${token}`}});assert.equal(tampered.status,409);
 const report={evidenceClass:'SYNTHETIC_PROVIDER_REAL_LOCAL_HTTP',ownerStatus:response.status,unauthStatus:unauth.status,tamperedStatus:tampered.status,artifactCount:verified.artifactCount,receiptIntegrityVerified:verified.receiptIntegrityVerified,externalOutcomeVerified:verified.externalOutcomeVerified,published:verified.published,authorizesDispatch:verified.authorizesDispatch};
 fs.writeFileSync(path.join(out,'receipt-api-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{core?.shutdown();}
