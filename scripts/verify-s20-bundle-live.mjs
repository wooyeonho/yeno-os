import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {start} from '../runtime/server.mjs';
import {openStore} from '../runtime/lib/store.mjs';
import {missionStatus} from '../runtime/lib/shadow-army.mjs';
import {verifyReceiptDirectory} from '../runtime/lib/mission-receipts.mjs';
import {verifyBundle} from './verify-reproduction-bundle.mjs';

const require=createRequire(new URL('../runtime/package.json',import.meta.url));
const {zipSync,unzipSync}=require('fflate');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const out=path.resolve('build-artifacts/s20-20261001');fs.mkdirSync(out,{recursive:true});
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-s20-core-'));
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
  const project=await post('/api/projects',{name:'S20 synthetic bundle',status:'active'});assert.equal(project.status,201);
  const input={projectId:project.body.project.id,goal:'S20 synthetic reproduction mission',successCriterion:'one stored artifact'};
  const mission=await post('/api/shadow-army/missions',input);assert.equal(mission.status,201,JSON.stringify(mission.body));
  for(let i=0;i<400;i++){if(missionStatus(mission.body.missionId,openStore(dataDir).state)?.phase==='completed')break;await new Promise(resolve=>setTimeout(resolve,25));}
  assert.equal(missionStatus(mission.body.missionId,openStore(dataDir).state)?.phase,'completed');
  const receipts=verifyReceiptDirectory(path.join(dataDir,'receipts'));
  assert.equal(receipts.length,1);const receipt=receipts[0];
  assert.equal(receipt.evidenceClass,'synthetic');assert.equal(receipt.sequence,1);assert.equal(receipt.previousHash,null);
  const folder=path.join(out,'synthetic-bundle');fs.mkdirSync(path.join(folder,'artifacts'),{recursive:true});
  const files={
    'input.json':Buffer.from(JSON.stringify(input,null,2)+'\n'),
    'receipt.json':fs.readFileSync(path.join(dataDir,'receipts',`${receipt.missionId}.json`)),
    'receipt.html':fs.readFileSync(path.join(dataDir,'receipts',`${receipt.missionId}.html`)),
  };
  const state=openStore(dataDir).state;
  for(const ref of receipt.steps.flatMap(step=>step.artifactHashes)){
    const artifact=state.artifacts[ref.artifactId];assert.ok(artifact);
    files[`artifacts/${ref.artifactId}`]=fs.readFileSync(path.join(dataDir,'artifacts',artifact.filename));
  }
  const readme=`# BLACKHOLE 합성 재현 번들\n\n이 자료는 격리 코어와 합성 모델 응답으로 만든 미션 1건입니다. 실제 모델 품질·외부 검증·실기기 동작의 증거가 아닙니다. 로컬 해시 체인은 누군가 전체 번들을 다시 썼는지 외부에서 증명하지 못합니다.\n\nNode.js 20 이상: \`node verify.mjs\`\n`;
  files['README.md']=Buffer.from(readme);
  files['verify.mjs']=fs.readFileSync(path.resolve('scripts/verify-reproduction-bundle.mjs'));
  const manifest={format:'blackhole-synthetic-reproduction-v1',evidenceClass:'synthetic',missionId:receipt.missionId,files:Object.entries(files).map(([name,bytes])=>({path:name,sha256:sha(bytes)}))};
  files['manifest.json']=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  for(const [name,bytes] of Object.entries(files)){const dest=path.join(folder,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);}
  const first=verifyBundle(folder);assert.equal(first.artifactsVerified,receipt.steps.reduce((sum,step)=>sum+step.artifactHashes.length,0));
  const zip=Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,new Uint8Array(bytes)])),{level:0}));
  const zipPath=path.join(out,'synthetic-reproduction.zip');fs.writeFileSync(zipPath,zip);
  const extract=path.join(out,'extracted-verify');fs.mkdirSync(extract,{recursive:true});
  for(const [name,bytes] of Object.entries(unzipSync(zip))){const dest=path.resolve(extract,name);assert.ok(dest.startsWith(extract+path.sep));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);}
  assert.deepEqual(verifyBundle(extract),first);
  const artifactName=manifest.files.find(row=>row.path.startsWith('artifacts/')).path;
  fs.appendFileSync(path.join(extract,artifactName),'tampered');
  assert.throws(()=>verifyBundle(extract),/hash mismatch/i);
  fs.writeFileSync(path.join(extract,artifactName),files[artifactName]);
  assert.deepEqual(verifyBundle(extract),first);
  const report={ok:true,evidenceClass:'synthetic',missionId:receipt.missionId,artifactCount:first.artifactsVerified,bundleSha256:sha(zip),receiptHash:receipt.receiptHash,localFreshExtractionVerified:true,tamperRejected:true,otherMachineVerified:false,authorizesDispatch:false};
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{core?.shutdown();}
