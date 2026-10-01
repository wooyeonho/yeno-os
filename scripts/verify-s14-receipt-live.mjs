import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {start} from '../runtime/server.mjs';
import {openStore} from '../runtime/lib/store.mjs';
import {missionStatus} from '../runtime/lib/shadow-army.mjs';
import {verifyReceiptDirectory} from '../runtime/lib/mission-receipts.mjs';

const out=path.resolve('build-artifacts/s14-20261001');fs.mkdirSync(out,{recursive:true});
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-s14-live-'));
const token=randomBytes(32).toString('hex');
const env={YENO_AGENT_PROVIDER:'auto',YENO_AGENT_DAILY_CALL_LIMIT:'20',YENO_LOCAL_MODEL:'synthetic-local',YENO_NVIDIA_MODEL:'synthetic-remote',YENO_NVIDIA_API_KEY:'synthetic-fixture-only'};
const verdict={verdict:'pass',confidence:0.9,criteria:[{criterion:'검증 가능한 산출물',status:'met',reason:'저장된 내용과 일치',evidenceRefs:['실제 Shadow 산출물 본문']}],summary:'저장된 산출물과 근거가 일치함'};
const agentFetch=async(_url,request)=>{
  const body=JSON.parse(request.body);
  const semantic=body.messages.some(message=>typeof message.content==='string'&&message.content.includes('independent semantic verifier'));
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:semantic?JSON.stringify(verdict):'실제 Shadow 산출물 본문',tool_calls:[]}}],usage:{prompt_tokens:12,completion_tokens:8}}),{headers:{'Content-Type':'application/json'}});
};
let core;
try{
  core=await start({host:'127.0.0.1',port:0,dataDir,token,env,agentFetch});
  const base=`http://127.0.0.1:${core.server.address().port}`;
  const post=async(route,input)=>{const response=await fetch(base+route,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),...input})});return {status:response.status,body:await response.json()};};
  const project=await post('/api/projects',{name:'S14 synthetic receipt',status:'active'});assert.equal(project.status,201);
  const mission=await post('/api/shadow-army/missions',{projectId:project.body.project.id,goal:'S14 synthetic receipt mission',successCriterion:'one artifact'});
  assert.equal(mission.status,201,JSON.stringify(mission.body));
  for(let i=0;i<400;i++){if(missionStatus(mission.body.missionId,openStore(dataDir).state)?.phase==='completed')break;await new Promise(resolve=>setTimeout(resolve,25));}
  assert.equal(missionStatus(mission.body.missionId,openStore(dataDir).state)?.phase,'completed');
  const response=await fetch(base+'/api/receipts',{headers:{Authorization:`Bearer ${token}`}});
  assert.equal(response.status,200);const view=await response.json();
  assert.equal(view.public,false);assert.equal(view.entries.length,1);
  const dir=path.join(dataDir,'receipts');const receipts=verifyReceiptDirectory(dir);
  assert.equal(receipts.length,1);assert.equal(receipts[0].evidenceClass,'synthetic');
  const dest=path.join(out,`receipts-${mission.body.missionId}`);fs.mkdirSync(dest,{recursive:true});
  for(const name of fs.readdirSync(dir))fs.copyFileSync(path.join(dir,name),path.join(dest,name));
  const artifactDest=path.join(out,`artifact-by-id-${mission.body.missionId}`);fs.mkdirSync(artifactDest,{recursive:true});
  const state=openStore(dataDir).state;
  for(const ref of receipts[0].steps.flatMap(step=>step.artifactHashes)){
    const source=state.artifacts[ref.artifactId];assert.ok(source);
    fs.copyFileSync(path.join(dataDir,'artifacts',source.filename),path.join(artifactDest,ref.artifactId));
  }
  const report={ok:true,missionId:mission.body.missionId,receiptDir:path.relative(out,dest),artifactDir:path.relative(out,artifactDest),receiptHash:receipts[0].receiptHash,chainHead:view.chainHead,evidenceClass:receipts[0].evidenceClass,verdict:receipts[0].verdict,steps:receipts[0].steps.length,artifactCount:receipts[0].steps.reduce((n,step)=>n+step.artifactHashes.length,0),public:view.public,authorizesDispatch:view.authorizesDispatch};
  assert.equal(report.chainHead,report.receiptHash);
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{core?.shutdown();}
