import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {start} from '../runtime/server.mjs';
import {openStore} from '../runtime/lib/store.mjs';
import {missionStatus} from '../runtime/lib/shadow-army.mjs';

const require=createRequire(new URL('../apps/controller/package.json',import.meta.url));
const {chromium}=require('playwright');
const output=new URL('../build-artifacts/living-20260927/',import.meta.url);
mkdirSync(output,{recursive:true});
const dataDir=mkdtempSync(join(tmpdir(),'blackhole-s1-'));
const token=randomBytes(32).toString('hex');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const env={YENO_AGENT_PROVIDER:'openai',YENO_OPENAI_API_KEY:'synthetic-s1-not-a-real-key',YENO_OPENAI_MODEL:'synthetic-s1-model',YENO_AGENT_DAILY_CALL_LIMIT:'20'};
const verdict={verdict:'pass',confidence:0.9,criteria:[{criterion:'검증 가능한 산출물',status:'met',reason:'저장된 내용과 일치',evidenceRefs:['실제 Shadow 산출물 본문']}],summary:'저장된 산출물과 근거가 일치함'};
const agentFetch=async(_url,request)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.parse(request.body).messages.some(message=>typeof message.content==='string'&&message.content.includes('independent semantic verifier'))?JSON.stringify(verdict):'실제 Shadow 산출물 본문',tool_calls:[]}}],usage:{prompt_tokens:30,completion_tokens:20}}),{headers:{'Content-Type':'application/json'}});
let core,browser;
try{
  core=await start({host:'127.0.0.1',port:0,dataDir,token,env,agentFetch});
  const origin=`http://127.0.0.1:${core.server.address().port}`;
  const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  const get=async path=>{const response=await fetch(origin+path,{headers});return {status:response.status,body:await response.json()};};
  const post=async(path,body)=>{const response=await fetch(origin+path,{method:'POST',headers,body:JSON.stringify({requestId:randomUUID(),...body})});return {status:response.status,body:await response.json()};};
  const waitMission=async id=>{
    for(let attempt=0;attempt<400;attempt++){
      const mission=missionStatus(id,openStore(dataDir).state);
      if(['completed','failed'].includes(mission?.phase))return mission;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    throw new Error('S1 mission did not settle');
  };
  const project=await post('/api/projects',{name:'S1 검증 프로젝트',status:'active'});
  assert.equal(project.status,201);
  const records=[];
  for(let index=0;index<2;index++){
    const mission=await post('/api/shadow-army/missions',{projectId:project.body.project.id,goal:`S1 검증 산출물 ${index+1}`,successCriterion:'검증 가능한 산출물 1개'});
    assert.equal(mission.status,201,JSON.stringify(mission.body));
    const settled=await waitMission(mission.body.missionId);
    assert.equal(settled.phase,'completed',JSON.stringify(settled));
    const response=await get('/api/shadow-army/roster');
    assert.equal(response.status,200);
    assert.equal(response.body.roster.entries.length,4);
    assert.ok(response.body.roster.entries.every(entry=>entry.missions.length===index+1));
    const file=index===0?'s1-roster-before.json':'s1-roster-after.json';
    writeFileSync(new URL(file,output),JSON.stringify({missionId:mission.body.missionId,roster:response.body.roster,overview:response.body.overview},null,2)+'\n');
    records.push({file,missionId:mission.body.missionId,entryCount:response.body.roster.entries.length,missionCounts:response.body.roster.entries.map(entry=>entry.missions.length),sha256:sha256(readFileSync(new URL(file,output)))});
  }
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext({baseURL:origin,viewport:{width:400,height:840},reducedMotion:'reduce'});
  const page=await context.newPage();
  await page.goto('/jarvis');
  await page.locator('#pair-screen').waitFor({state:'visible',timeout:12000});
  await page.locator('#device-connect').click();
  const reference=page.locator('#device-connect-reference');await reference.waitFor({state:'visible'});
  const requestId=await reference.textContent();
  const approval=await context.request.post('/api/web/pairing/approve',{headers:{Authorization:`Bearer ${token}`,Origin:origin},data:{requestId}});
  assert.equal(approval.status(),200);
  await page.locator('#pair-screen').waitFor({state:'hidden'});
  await page.locator('#control-toggle').click();
  await page.waitForFunction(()=>document.querySelector('#shadow-count')?.textContent==='4명');
  const expectedNames=['정찰자 1호','연구자 1호','건설자 1호','검증자 1호'];
  assert.deepEqual(await page.locator('#shadow-roster-list li span').allTextContents(),expectedNames);
  assert.deepEqual(await page.locator('#shadow-roster-list li small').allTextContents(),['E','E','E','E']);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  const image='s1-drawer.png';
  await page.screenshot({path:fileURLToPath(new URL(image,output)),fullPage:true});
  const report={evidenceClass:'SYNTHETIC_PROVIDER_REAL_CORE_AND_EDGE',missions:records,rosterCount:4,visibleNames:expectedNames,visibleRanks:await page.locator('#shadow-roster-list li small').allTextContents(),image,screenSha256:sha256(readFileSync(new URL(image,output)))};
  writeFileSync(new URL('s1-report.json',output),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{
  await browser?.close();
  const closed=core?new Promise(resolve=>core.server.once('close',resolve)):null;
  core?.shutdown();core?.server.closeAllConnections();
  await closed;
  await rm(dataDir,{recursive:true,force:true});
}
