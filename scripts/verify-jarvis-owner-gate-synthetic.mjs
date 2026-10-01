import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {start} from '../runtime/server.mjs';

const require=createRequire(new URL('../apps/controller/package.json',import.meta.url));
const {chromium}=require('playwright');
const output=new URL('../build-artifacts/jarvis-e2e-20260927/',import.meta.url);
mkdirSync(output,{recursive:true});
const dataDir=mkdtempSync(join(tmpdir(),'blackhole-jarvis-gate-'));
const token=randomBytes(32).toString('hex');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
let core,browser,modelCalls=0;
const report={evidenceClass:'SYNTHETIC_PROVIDER_REAL_OWNER_GATE',networkModelCalls:0,modelCalls:0,questId:null,approvalQuestId:null,pendingCount:null,gateText:null,approveButtonCount:null,screenshot:null};
try{
  core=await start({host:'127.0.0.1',port:0,dataDir,token,env:{YENO_AGENT_PROVIDER:'openai',YENO_OPENAI_MODEL:'synthetic-gate-model',YENO_OPENAI_API_KEY:'synthetic-gate-key',YENO_AGENT_DAILY_CALL_LIMIT:'4'},agentFetch:async()=>{
    modelCalls++;
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'검증 가능한 합성 산출물'}}],usage:{prompt_tokens:9,completion_tokens:9}}),{status:200,headers:{'content-type':'application/json'}});
  }});
  const origin=`http://127.0.0.1:${core.server.address().port}`;
  const post=async(route,body={})=>{
    const response=await fetch(origin+route,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),...body})});
    return {status:response.status,body:await response.json()};
  };
  const quest=await post('/api/quests',{goal:'검증 작업',provider:'openai',maxCalls:1});
  assert.equal(quest.status,201);
  report.questId=quest.body.quest.id;
  const run=await post(`/api/quests/${report.questId}/run`);
  assert.equal(run.status,201);
  let job;
  for(let i=0;i<160;i++){
    job=core.state().jobs.find(item=>item.id===run.body.job.id);
    if(job?.status==='completed')break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(job?.status,'completed');
  assert.equal(job.artifacts.length,1);
  assert.equal((await post('/api/control',{action:'stop'})).status,200);
  const outcome=await post('/api/outcomes',{questId:report.questId,ledger:'wealth',summary:'격리 검증 측정값',value:1,unit:'건'});
  assert.equal(outcome.status,201);
  assert.equal((await post('/api/control',{action:'resume'})).status,200);
  const synthesis=await post('/api/quests/synthesize');
  assert.equal(synthesis.status,201);
  assert.equal(synthesis.body.quest.synthesis.archetype,'acquire-capability');
  assert.equal(synthesis.body.quest.synthesis.approvalRequired,true);
  report.approvalQuestId=synthesis.body.quest.id;
  const state=core.state();
  report.pendingCount=state.core.pendingApprovalCount;
  assert.equal(report.pendingCount,1);

  browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext({baseURL:origin,viewport:{width:400,height:840}});
  const page=await context.newPage();
  await page.goto('/jarvis');
  await page.locator('#device-connect').click();
  const reference=page.locator('#device-connect-reference');
  await reference.waitFor({state:'visible'});
  const requestId=await reference.textContent();
  const approval=await context.request.post('/api/web/pairing/approve',{headers:{Authorization:`Bearer ${token}`,Origin:origin},data:{requestId}});
  assert.equal(approval.status(),200);
  await page.locator('#pair-screen').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('#line')?.textContent?.includes('마지막은 네가 정해줘'),null,{timeout:12000});
  await page.locator('#control-toggle').click();
  await page.locator('#gate').waitFor({state:'visible'});
  report.gateText=await page.locator('#gate-text').textContent();
  assert.match(report.gateText,/되돌릴 수 없는 일 1건이 네 승인을 기다려/);
  assert.ok(report.gateText.includes(synthesis.body.quest.goal));
  report.approveButtonCount=await page.locator('#gate button').count();
  assert.equal(report.approveButtonCount,0,'Jarvis links to owner review but never approves itself');
  const filename='a8-gate.png';
  const file=fileURLToPath(new URL(filename,output));
  await page.screenshot({path:file,fullPage:true});
  report.screenshot={file:filename,sha256:sha256(readFileSync(file))};
  report.modelCalls=modelCalls;
  assert.equal(report.modelCalls,1);
  writeFileSync(new URL('a8-report.json',output),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}finally{
  await browser?.close();
  const closed=core?new Promise(resolve=>core.server.once('close',resolve)):null;
  core?.shutdown();
  await closed;
  await rm(dataDir,{recursive:true,force:true});
}
