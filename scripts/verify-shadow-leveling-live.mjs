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
const out=new URL('../build-artifacts/living-20260927/s1plus/',import.meta.url);
mkdirSync(out,{recursive:true});
const dataDir=mkdtempSync(join(tmpdir(),'blackhole-s1plus-'));
const token=randomBytes(32).toString('hex');
const env={YENO_AGENT_PROVIDER:'openai',YENO_OPENAI_API_KEY:'synthetic-only',YENO_OPENAI_MODEL:'synthetic-only',YENO_AGENT_DAILY_CALL_LIMIT:'20'};
const pass=JSON.stringify({verdict:'pass',confidence:0.9,criteria:[{criterion:'목표 충족',status:'met',reason:'본문에 실제 결과가 있음',evidenceRefs:['실제 Shadow 산출물 본문']}],summary:'목표를 실제로 달성함'});
const agentFetch=async(_url,request)=>{
  const body=JSON.parse(request.body);
  const semantic=body.messages.some(message=>typeof message.content==='string'&&message.content.includes('independent semantic verifier'));
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:semantic?pass:'실제 Shadow 산출물 본문',tool_calls:[]}}],usage:{prompt_tokens:30,completion_tokens:20}}),{headers:{'Content-Type':'application/json'}});
};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
let core,browser;
async function launch(){core=await start({host:'127.0.0.1',port:0,dataDir,token,env,agentFetch});}
async function stop(){if(!core)return;const closed=new Promise(resolve=>core.server.once('close',resolve));core.shutdown();await closed;core=null;}
function origin(){return `http://127.0.0.1:${core.server.address().port}`;}
async function post(route,body){const response=await fetch(origin()+route,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),...body})});return {status:response.status,body:await response.json()};}
async function waitFor(missionId){for(let i=0;i<500;i++){
  const phase=missionStatus(missionId,openStore(dataDir).state)?.phase;
  if(phase==='completed')return;
  if(phase==='failed')throw new Error('Synthetic mission failed');
  await new Promise(resolve=>setTimeout(resolve,20));
}throw new Error('Synthetic mission did not settle');}
function snapshot(name){const state=openStore(dataDir).state;const overview=core.state().shadowArmy.roster;const report={evidenceClass:'SYNTHETIC_PROVIDER_REAL_HTTP_AND_STORE',rosterFingerprint:state.shadowRoster.fingerprint,byRank:overview.byRank,members:overview.members.map(({name,rank,rankReason})=>({name,rank,rankReason}))};writeFileSync(new URL(name,out),JSON.stringify(report,null,2)+'\n');return report;}
try{
  await launch();
  const project=await post('/api/projects',{name:'S1+ 격리 검증',status:'active'});
  assert.equal(project.status,201,JSON.stringify(project.body));
  const projectId=project.body.project.id;
  const before=snapshot('s1plus-grade-before.json');assert.equal(before.byRank.E,0);
  const first=await post('/api/shadow-army/missions',{projectId,goal:'첫 번째 검증 산출물을 작성한다'});
  assert.equal(first.status,201,JSON.stringify(first.body));
  assert.ok(first.body.mission.shadows.every(shadow=>shadow.preferredShadowId===null));
  await waitFor(first.body.missionId);
  const afterOne=snapshot('s1plus-grade-after-1.json');assert.equal(afterOne.byRank.D,4);
  await stop();await launch();
  assert.equal(core.state().shadowArmy.roster.byRank.D,4);
  const second=await post('/api/shadow-army/missions',{projectId,goal:'다른 입력의 두 번째 검증 산출물을 작성한다'});
  assert.equal(second.status,201,JSON.stringify(second.body));
  const assignments=second.body.mission.shadows.map(({role,preferredShadowId,preferredShadowName})=>({role,preferredShadowId,preferredShadowName}));
  assert.ok(assignments.every(item=>item.preferredShadowId&&item.preferredShadowName));
  writeFileSync(new URL('s1plus-preferred-assignment.json',out),JSON.stringify({evidenceClass:'SYNTHETIC_PROVIDER_REAL_HTTP_AND_STORE',missionId:second.body.missionId,assignments},null,2)+'\n');
  await waitFor(second.body.missionId);
  const afterTwo=snapshot('s1plus-grade-after-2.json');assert.equal(afterTwo.byRank.C,4);

  browser=await chromium.launch({headless:true,channel:'msedge',timeout:20000});
  const context=await browser.newContext({baseURL:origin(),viewport:{width:400,height:840},reducedMotion:'reduce'});
  const page=await context.newPage();
  await page.goto('/jarvis');
  await page.locator('#pair-screen').waitFor({state:'visible',timeout:12000});
  await page.locator('#device-connect').click();
  await page.locator('#device-connect-reference').waitFor({state:'visible'});
  const requestId=await page.locator('#device-connect-reference').textContent();
  const approval=await context.request.post('/api/web/pairing/approve',{headers:{Authorization:`Bearer ${token}`,Origin:origin()},data:{requestId}});
  assert.equal(approval.status(),200);
  await page.locator('#pair-screen').waitFor({state:'hidden'});
  await page.locator('#control-toggle').click();
  await page.locator('#controls').waitFor({state:'visible'});
  await page.getByText('이번엔 정찰자 1호가 나선다').waitFor({state:'visible'});
  await page.locator('#control-job-list').scrollIntoViewIfNeeded();
  const screenshot=fileURLToPath(new URL('s1plus-drawer.png',out));
  await page.screenshot({path:screenshot,fullPage:true,timeout:10000});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  assert.equal(overflow,false);
  const report={evidenceClass:'SYNTHETIC_PROVIDER_REAL_HTTP_AND_BROWSER',firstMissionId:first.body.missionId,secondMissionId:second.body.missionId,afterOne:afterOne.byRank,afterTwo:afterTwo.byRank,assignments,screenshotSha256:sha256(readFileSync(screenshot)),horizontalOverflow:overflow};
  writeFileSync(new URL('s1plus-report.json',out),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{
  await browser?.close();
  await stop();
  await rm(dataDir,{recursive:true,force:true});
}
