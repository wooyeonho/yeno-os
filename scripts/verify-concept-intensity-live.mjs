import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {start} from '../runtime/server.mjs';
import {openStore} from '../runtime/lib/store.mjs';
import {rankMotivatedCandidates} from '../runtime/lib/motivation.mjs';
import {recordDriveDecision} from '../runtime/lib/drive-state.mjs';
import {autoAcquireCapability} from '../runtime/lib/kirby.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'build-artifacts','concept-20260928',...(process.argv.includes('--visual-final')?['visual-final']:[]));fs.mkdirSync(output,{recursive:true});
const home=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-e-cp1-'));
const dataDir=path.join(home,'data'),controlDir=path.join(home,'control');fs.mkdirSync(controlDir);
const token=randomBytes(32).toString('hex');
const write=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const store=openStore(dataDir);
for(let index=0;index<10;index++){
 const at=new Date(Date.now()-20000+index*1000).toISOString();
 const signals={assetGap:1+index%3,knowledgeGap:1+index%4,coverageGap:2,verificationGap:index%3,deliveryGap:index%2,repairNeed:index%2,reuseArtifacts:index%3,estimatedCalls:(index+1)/10,ownFailures:index%2,unknownCalls:0};
 const top=rankMotivatedCandidates({jobs:[]},[{action:{kind:'quest',taskKey:`e1:${index}`},goal:`격리 인수 목표 ${index+1}`,successCriterion:'실제 근거와 결과를 보존한다',signals}],at)[0];
 const next=recordDriveDecision(store.state,{top,candidates:[top]},{at,source:'owner'});
 store.state.driveState=next.driveState;store.state.driveDebates=next.driveDebates;
}
const manifest=JSON.parse(fs.readFileSync(path.join(root,'runtime','capabilities','ledger-digest.json'),'utf8'));
store.state.capabilities=autoAcquireCapability(store.state.capabilities,manifest,{at:new Date().toISOString()}).registry;
store.save();
write('e1-hunger-curves.json',{evidenceClass:'SYNTHETIC_DECISIONS_REAL_ENGINE',policyVersion:store.state.driveState.version,decisions:store.state.driveDebates.map(e=>({at:e.at,hunger:e.hungerSnapshot??null,fingerprint:e.stateFingerprint}))});
write('e1-voices.json',{evidenceClass:'SYNTHETIC_DECISIONS_REAL_ENGINE',debates:store.state.driveDebates});
let syntheticModelCalls=0;
const env={YENO_AGENT_PROVIDER:'auto',YENO_AGENT_DAILY_CALL_LIMIT:'2',YENO_NVIDIA_MODEL:'synthetic-browser-model',YENO_NVIDIA_API_KEY:'synthetic-fixture-not-a-credential'};
const agentFetch=async()=>{syntheticModelCalls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:syntheticModelCalls===1?'주인님, 확인 가능한 자료를 모으고, 우선순위 세 개를 정한 뒤, 결과를 검증해 주십시오.':''}}],usage:{prompt_tokens:12,completion_tokens:syntheticModelCalls===1?30:0}}),{headers:{'content-type':'application/json'}});};
const startCore=()=>start({host:'127.0.0.1',port:0,dataDir,token,env,agentFetch});
let core=await startCore();
let origin=`http://127.0.0.1:${core.server.address().port}`;
fs.writeFileSync(path.join(home,'token'),token,{mode:0o600});
const config=()=>({version:1,dataDir,controlDir,tokenFile:path.join(home,'token'),port:core.server.address().port,phone:null});
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config()));
fs.writeFileSync(path.join(home,'owner.json'),JSON.stringify({root,nodeExecutable:process.execPath,taskName:'synthetic-no-task',ownerSid:process.env.BLACKHOLE_QA_OWNER_SID??'qa-unused'}));
async function call(route,input){const r=await fetch(origin+route,{method:input?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},...(input?{body:JSON.stringify({requestId:randomUUID(),...input})}:{})});const b=await r.json();assert.ok(r.ok,`${route} HTTP ${r.status}`);return b;}
async function snapshot(){
 const connectors=await call('/api/connectors');write('cp1-registry.json',connectors);
 write('cp1-healthchecks.json',{scope:'isolated-core',checks:connectors.connectors.filter(r=>r.lastCheck).map(r=>({id:r.id,status:r.status,receipt:r.lastCheck})),realRemoteCalls:0});
 const drives=await call('/api/drives/status');write('e1-drive-status.json',drives);
 const s=openStore(dataDir).state;
 write('e1-core-evidence.json',{scope:'isolated-core',dataVersion:s.driveState.version,decisions:s.driveDebates.length,fingerprint:s.driveState.fingerprint,address:(await call('/api/jarvis/settings')).address,jobs:s.jobs.map(j=>({id:j.id,status:j.status,type:j.type,artifactCount:j.artifacts.length})),autopilotEnabled:s.autopilot?.enabled??false,syntheticModelCalls,realModelCalls:0,systemNotices:(await call('/api/state')).systemNotices});
 return {saved:true,connectorCount:connectors.connectors.length,driveCount:Object.keys(drives.hunger).length};
}
async function closeFixture(){
 core.shutdown();
 const resolved=path.resolve(home);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('blackhole-e-cp1-'));
 fs.rmSync(resolved,{recursive:true,force:true});
}
async function action(input){
 if(input.action==='approve'){await call('/api/web/pairing/approve',{requestId:input.requestId});return {approved:true};}
 if(input.action==='snapshot')return snapshot();
 if(input.action==='quantum'){const r=await call('/api/connectors/quantum-circuit/check',{});return {id:r.connector.id,status:r.connector.status};}
 if(input.action==='restart'){const before=openStore(dataDir).state.driveState.fingerprint;core.shutdown();core=await startCore();origin='http://127.0.0.1:'+core.server.address().port;fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config()));assert.equal(openStore(dataDir).state.driveState.fingerprint,before);write('e1-restart.json',{fingerprintBefore:before,fingerprintAfter:openStore(dataDir).state.driveState.fingerprint,matched:true,address:(await call('/api/jarvis/settings')).address});return {origin,restarted:true};}
 throw new Error('unknown_action');
}
export const qa={get origin(){return origin;},home,action,close:closeFixture};
if(!new URL(import.meta.url).searchParams.has('embedded')){
 console.log(JSON.stringify({origin,home,scope:'isolated-fixture',processId:process.pid}));
 const lines=readline.createInterface({input:process.stdin,terminal:false});
 try{for await(const line of lines){try{const input=JSON.parse(line);if(input.action==='stop'){console.log(JSON.stringify(await snapshot()));break;}console.log(JSON.stringify(await action(input)));}catch(error){console.log(JSON.stringify({error:error.name}));}}}
 finally{lines.close();await closeFixture();}
}
