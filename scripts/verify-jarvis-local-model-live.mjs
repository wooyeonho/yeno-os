import assert from 'node:assert/strict';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {start} from '../runtime/server.mjs';

const require=createRequire(new URL('../apps/controller/package.json',import.meta.url));
const {chromium}=require('playwright');
const out=new URL('../build-artifacts/jarvis-face-v2-20260926/',import.meta.url);
mkdirSync(out,{recursive:true});
const dataDir=mkdtempSync(join(tmpdir(),'blackhole-jarvis-model-'));
const ownerCredential=randomBytes(32).toString('hex');
const workMode=process.argv.includes('--work');
let core,browser;
try {
  const env={YENO_AGENT_PROVIDER:'local',YENO_AGENT_MODEL:'qwen2.5:3b',YENO_LOCAL_MODEL:'qwen2.5:3b',
    YENO_AGENT_DAILY_CALL_LIMIT:'3',YENO_LOCAL_BASE_URL:'http://127.0.0.1:11434/v1/chat/completions'};
  core=await start({host:'127.0.0.1',port:0,dataDir,token:ownerCredential,env});
  const origin=`http://127.0.0.1:${core.server.address().port}`;
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext({baseURL:origin,viewport:{width:1440,height:900}});
  const session=await context.request.post('/api/web/session',{headers:{Authorization:`Bearer ${ownerCredential}`,'X-Yeno-Browser':'1',Origin:origin},
    data:{requestId:randomUUID(),name:'Jarvis local-model verifier',remember:false}});
  assert.equal(session.status(),201);
  const enable=await context.request.post('/api/settings',{headers:{Authorization:`Bearer ${ownerCredential}`,Origin:origin},
    data:{requestId:randomUUID(),modules:{ai:true}}});
  assert.equal(enable.status(),200,'Owner enables the AI module in this isolated runtime');
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/jarvis');
  await page.waitForFunction(()=>document.querySelector('#model')?.textContent?.includes('qwen2.5:3b'),null,{timeout:12000});
  if(!workMode)await page.locator('#command-mode').click();
  assert.equal(await page.locator('#command-mode').getAttribute('aria-pressed'),String(!workMode));
  await page.locator('#in').fill('한 문장으로 한국어 인사말을 만들어줘. 외부 사실은 필요 없어.');
  const route=workMode?'/api/commands':'/api/voice';
  const commandResponse=page.waitForResponse(response=>new URL(response.url()).pathname===route,{timeout:15000});
  await page.locator('#send').click();
  const submitted=await commandResponse;
  assert.equal(submitted.status(),201,`${route} accepts the owner request`);
  const command=await submitted.json();
  assert.ok(command?.job?.id,'The real route returned a job');
  let job;
  for(let attempt=0;attempt<(workMode?210:60);attempt++){
    const response=await context.request.get('/api/state',{headers:{'X-Yeno-Browser':'1'}});
    assert.equal(response.status(),200);
    job=(await response.json()).jobs.find(item=>item.id===command.job.id);
    if(job&&['completed','failed','cancelled','stopped'].includes(job.status))break;
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  assert.equal(job?.status,'completed',`Local-model Jarvis job ended ${job?.status??'unknown'}: ${job?.error??''}`);
  assert.ok(job.artifacts?.length>0,'Completed model job has an artifact');
  const artifact=job.artifacts[0];
  const response=await context.request.get(`/api/artifacts/${artifact.id}`,{headers:{'X-Yeno-Browser':'1'}});
  assert.equal(response.status(),200);
  const bytes=Buffer.from(await response.body());
  const artifactSha256=createHash('sha256').update(bytes).digest('hex');
  assert.equal(artifactSha256,response.headers()['x-content-sha256']);
  await page.waitForFunction(()=>document.querySelector('#line')?.textContent?.length>10 && !document.querySelector('#line')?.textContent?.includes('조용한 박동'),null,{timeout:15000});
  await page.waitForTimeout(400);
  await page.screenshot({path:fileURLToPath(new URL(workMode?'local-work-result.png':'local-model-result.png',out)),fullPage:true});
  assert.deepEqual(errors,[]);
  const report={server:'isolated-real-core',mode:workMode?'work':'conversation',provider:'local',model:'qwen2.5:3b',jobStatus:job.status,jobId:job.id,
    artifactId:artifact.id,artifactSha256,artifactBytes:bytes.length,jarvisSpeechVisible:true,answerQuality:'not-independently-assessed',errors};
  writeFileSync(new URL(workMode?'local-work-report.json':'local-model-report.json',out),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  const closed=core?new Promise(resolve=>core.server.once('close',resolve)):null;
  core?.shutdown();await closed;
  await rm(dataDir,{recursive:true,force:true});
}
