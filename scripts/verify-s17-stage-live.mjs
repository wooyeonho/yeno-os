import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {start} from '../runtime/server.mjs';

const require=createRequire(new URL('../apps/controller/package.json',import.meta.url));
const {chromium}=require('playwright');
const output=new URL('../build-artifacts/s17-20261001/',import.meta.url);
mkdirSync(output,{recursive:true});
const dataDir=mkdtempSync(join(tmpdir(),'blackhole-s17-'));
const token=randomBytes(32).toString('hex');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
let core,browser;
try{
 core=await start({host:'127.0.0.1',port:0,dataDir,token,env:{}});
 const origin=`http://127.0.0.1:${core.server.address().port}`;
 browser=await chromium.launch({headless:true,channel:'msedge'});
 const context=await browser.newContext({baseURL:origin,viewport:{width:400,height:840},reducedMotion:'reduce'});
 const page=await context.newPage();
 let commands=0;page.on('request',request=>{if(new URL(request.url()).pathname==='/api/commands')commands++;});
 await page.goto('/jarvis');
 await page.locator('#device-connect').click();
 await page.locator('#device-connect-reference').waitFor({state:'visible'});
 const requestId=await page.locator('#device-connect-reference').textContent();
 const approval=await context.request.post('/api/web/pairing/approve',{headers:{Authorization:`Bearer ${token}`,Origin:origin},data:{requestId}});
 assert.equal(approval.status(),200);
 await page.locator('#pair-screen').waitFor({state:'hidden'});
 await context.route('**/api/state',async route=>{
  const response=await route.fetch();const state=await response.json();
  state.systemNotices=['욕망 정산 · 충족 · greed · synthetic-job','[시스템] 그림자 정찰자 1호가 일어났습니다.','카피! 합성 능력 모자를 썼습니다.'];
  await route.fulfill({response,json:state});
 });
 await page.reload();
 await page.locator('#scene-moments').waitFor({state:'visible',timeout:12000});
 await page.waitForFunction(()=>!document.querySelector('#line')?.classList.contains('fade'));
 assert.equal(await page.locator('#scene-moment-list li').count(),3);
 const images=[];
 for(const [width,height,file] of [[400,840,'stage-400.png'],[768,900,'stage-768.png'],[1440,900,'stage-1440.png']]){
  const previous=await page.evaluate(()=>Number(document.querySelector('#orb-webgl[data-rendered-frames],#orb[data-rendered-frames]')?.dataset.renderedFrames??0));
  await page.setViewportSize({width,height});
  await page.waitForFunction(value=>Number(document.querySelector('#orb-webgl[data-rendered-frames],#orb[data-rendered-frames]')?.dataset.renderedFrames??0)>=value+2,previous,{timeout:10000});
  await page.waitForTimeout(400);
  await page.screenshot({path:fileURLToPath(new URL(file,output)),fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  assert.equal(overflow,false,`${width}px overflow`);
  images.push({file,width,height,sha256:digest(readFileSync(new URL(file,output)))});
 }
 assert.equal(commands,0);
 const report={evidenceClass:'SYNTHETIC_NOTICE_REAL_BROWSER',reason:'state notice fixture injected after owner pairing; no claim of persisted operational events',moments:3,commands,images};
 writeFileSync(new URL('report.json',output),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}finally{
 await browser?.close();
 const closed=core?new Promise(resolve=>core.server.once('close',resolve)):null;
 core?.shutdown();await closed;
 await rm(dataDir,{recursive:true,force:true});
}
