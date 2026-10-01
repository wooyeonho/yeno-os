import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {openStore} from '../lib/store.mjs';
import {exportBackup,restoreBackup} from '../lib/backup.mjs';
import {validateG1Links} from '../lib/gap-state.mjs';
import {stateWithGap,debates,at} from './helpers/gap-fixture.mjs';
import {detectGaps} from '../lib/gap-scout.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function evidence(name,value){if(process.env.G1_EVIDENCE_DIR){const dir=path.resolve(process.env.G1_EVIDENCE_DIR);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name),JSON.stringify(value,null,2)+'\n');}}
async function fixture(t,mode='complete'){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-g1-process-')),token=randomBytes(32).toString('hex');const seed=openStore(dir);Object.assign(seed.state,stateWithGap());seed.save();
 let child,port;
 async function boot(nextMode=mode){child=fork(new URL('./helpers/gap-core.mjs',import.meta.url),[],{execArgv:['--max-old-space-size=256'],silent:true});const ready=once(child,'message');child.send({dir,token,mode:nextMode});const [msg]=await ready;assert.ok(!msg.error,msg.error);port=msg.port;return msg.pid;}
 async function kill(){if(!child||child.exitCode!==null||child.signalCode!==null)return;const done=once(child,'exit');child.kill();await done;}
 t.after(async()=>{await kill();fs.rmSync(dir,{recursive:true,force:true});});
 const firstPid=await boot();
 async function call(route,input,credential=token){const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:input?'POST':'GET',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});return {status:response.status,body:await response.json()};}
 const sends=()=>fs.existsSync(path.join(dir,'synthetic-sends.txt'))?fs.readFileSync(path.join(dir,'synthetic-sends.txt'),'utf8').trim().split('\n').length:0;
 return {dir,call,kill,boot,sends,firstPid,gapId:seed.state.gapScout.gaps[0].id};
}
test('real separate-process restart preserves completed search, inbox and budget; HTTP replays cannot research same gap again',async t=>{
 const f=await fixture(t),requestId=randomUUID(),baselineCapabilities=structuredClone(openStore(f.dir).state.capabilities);const input={requestId,gapId:f.gapId};
 const first=await f.call('/api/gap-scout/research',input);assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.search.status,'completed');assert.equal(f.sends(),1);
 const inbox=(await f.call('/api/absorb-inbox')).body;assert.equal(inbox.entries.length,3);assert.equal(inbox.entries[0].status,'draft');
 await f.kill();const secondPid=await f.boot();assert.notEqual(secondPid,f.firstPid);
 for(const rid of [requestId,randomUUID()]){const replay=await f.call('/api/gap-scout/research',{...input,requestId:rid});assert.equal(replay.body.search.fingerprint,first.body.search.fingerprint);assert.equal(replay.body.search.status,'completed');}
 assert.equal(f.sends(),1);assert.equal((await f.call('/api/gap-scout')).body.budget.days[0].calls,1);
 const noOwner=await f.call('/api/gap-scout',null,'not-a-credential');assert.equal(noOwner.status,401);
 const enrolled=await f.call('/api/v1/devices/enroll',{requestId:randomUUID(),name:'synthetic device',platform:'android'});assert.equal((await f.call('/api/absorb-inbox',null,enrolled.body.device.deviceToken)).status,403);
 await f.kill();const stored=openStore(f.dir).state;validateG1Links(stored);assert.deepEqual(stored.capabilities,baselineCapabilities);
 const key=randomBytes(32),archive=exportBackup({state:stored,dataDir:f.dir,key}),targetDir=path.join(f.dir,'restored');restoreBackup({archive,key,targetDir});const restored=openStore(targetDir).state;assert.deepEqual(restored.gapScout,stored.gapScout);assert.deepEqual(restored.absorbInbox,stored.absorbInbox);assert.equal(restored.emergencyStop,true);
 evidence('g1-gap.json',stored.gapScout.gaps);evidence('g1-scout-report.json',stored.gapScout.searches[0]);evidence('g1-inbox.json',stored.absorbInbox);evidence('g1-restart.json',{synthetic:true,actualProcesses:true,firstPid:f.firstPid,secondPid,sendCount:1,sameRequestReplay:true,newRequestSameGapReplay:true,encryptedBackupRestored:true,authorizesDispatch:false,activatedCapabilities:0});
});
test('killed in-flight process retains unknown identity and charged budget; restart makes zero replacement sends',async t=>{
 const f=await fixture(t,'hang'),requestId=randomUUID();const pending=f.call('/api/gap-scout/research',{requestId,gapId:f.gapId}).catch(()=>null);
 for(let i=0;i<200&&f.sends()===0;i++)await delay(20);assert.equal(f.sends(),1);await f.kill();await pending;await f.boot('complete');
 const replay=await f.call('/api/gap-scout/research',{requestId,gapId:f.gapId});assert.equal(replay.body.search.status,'unknown');assert.equal(replay.body.search.reason,'restart_outcome_unknown');assert.equal(replay.body.search.calls[0].status,'unknown');assert.equal(f.sends(),1);assert.equal((await f.call('/api/absorb-inbox')).body.entries.length,0);
 evidence('g1-crash-restart.json',{synthetic:true,status:replay.body.search.status,reason:replay.body.search.reason,sendCount:1,chargedCalls:replay.body.search.calls.length,authorizesDispatch:false});
});
test('missing provider really reports BLOCKED through HTTP; stop rejects research and no fake completion',async t=>{
 const f=await fixture(t,'missing');const result=await f.call('/api/gap-scout/research',{requestId:randomUUID(),gapId:f.gapId});assert.equal(result.body.search.status,'blocked');assert.equal(result.body.search.reason,'search_provider_missing');assert.equal(f.sends(),0);
 await f.call('/api/control',{requestId:randomUUID(),action:'stop'});assert.equal((await f.call('/api/gap-scout/research',{requestId:randomUUID(),gapId:f.gapId})).status,409);
 evidence('g1-provider-blocked.json',{isolatedEnvironment:true,actualExternalSearches:0,status:'BLOCKED',reason:result.body.search.reason,authorizesDispatch:false});
});
