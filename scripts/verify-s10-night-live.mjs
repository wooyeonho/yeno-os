import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../runtime/server.mjs';
import {openStore} from '../runtime/lib/store.mjs';
import {exportBackup,decryptBackup} from '../runtime/lib/backup.mjs';

const out=new URL('../build-artifacts/s10-20261001/',import.meta.url);
mkdirSync(out,{recursive:true});
const dataDir=mkdtempSync(join(tmpdir(),'blackhole-s10-night-live-'));
const token=randomBytes(32).toString('hex');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const nowMinute=()=>{
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(item=>[item.type,item.value]));
  return Number(parts.hour)*60+Number(parts.minute);
};
let core;
const report={evidenceClass:'SYNTHETIC_WINDOW_REAL_LOCAL_CORE',defaultDisabled:false,ownerOnly:false,chronicleSha256:null,restartedReportCount:null,backupReportCount:null,modelCalls:0,obsidianExport:'BLOCKED_VAULT_UNMODIFIED'};
const close=async()=>{if(!core)return;const closing=new Promise(resolve=>core.server.once('close',resolve));core.shutdown();await closing;core=null;};
try{
  core=await start({host:'127.0.0.1',port:0,dataDir,token,env:{YENO_AGENT_PROVIDER:'local'},agentFetch:async()=>{report.modelCalls++;throw Error('model must not run');}});
  let origin=`http://127.0.0.1:${core.server.address().port}`;
  const unauth=await fetch(`${origin}/api/night-cycle`);
  report.ownerOnly=unauth.status!==200;assert.equal(report.ownerOnly,true);
  const before=await fetch(`${origin}/api/night-cycle`,{headers:{Authorization:`Bearer ${token}`}});
  assert.equal(before.status,200);
  assert.equal((await before.json()).window,null);
  report.defaultDisabled=true;
  const minute=nowMinute(),window={timeZone:'Asia/Seoul',startMinute:(minute+1439)%1440,endMinute:(minute+5)%1440};
  const setting=await fetch(`${origin}/api/night-cycle/window`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),window})});
  assert.equal(setting.status,200,await setting.text());
  let stored;
  for(let i=0;i<40;i++){
    const response=await fetch(`${origin}/api/night-cycle`,{headers:{Authorization:`Bearer ${token}`}});
    assert.equal(response.status,200);
    stored=await response.json();
    if(stored.reports.length)break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(stored.reports.length,1);
  const row=stored.reports[0];
  const file=join(dataDir,'chronicle',`${row.cycleDate}.md`);
  for(let i=0;i<40&&!existsSync(file);i++)await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(existsSync(file),true);
  report.chronicleSha256=digest(readFileSync(file));
  assert.equal(report.chronicleSha256,row.sha256);
  assert.equal(row.summary.modelCalls,0);
  await close();
  core=await start({host:'127.0.0.1',port:0,dataDir,token,env:{YENO_AGENT_PROVIDER:'local'},agentFetch:async()=>{report.modelCalls++;throw Error('model must not run');}});
  await new Promise(resolve=>setTimeout(resolve,500));
  const state=openStore(dataDir).state;
  report.restartedReportCount=state.nightCycle.reports.length;
  assert.equal(report.restartedReportCount,1);
  const key=randomBytes(32);
  report.backupReportCount=decryptBackup(exportBackup({state,dataDir,key}),key).state.nightCycle.reports.length;
  assert.equal(report.backupReportCount,1);
  assert.equal(report.modelCalls,0);
  writeFileSync(new URL('night-live-report.json',out),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{
  await close();
  if(dataDir.startsWith(tmpdir())&&dataDir.includes('blackhole-s10-night-live-'))await rm(dataDir,{recursive:true,force:true});
}
