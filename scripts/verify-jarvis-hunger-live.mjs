import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {start} from '../runtime/server.mjs';
import {openStore} from '../runtime/lib/store.mjs';
import {rankMotivatedCandidates} from '../runtime/lib/motivation.mjs';
import {recordDriveDecision} from '../runtime/lib/drive-state.mjs';

const require=createRequire(new URL('../apps/controller/package.json',import.meta.url));
const {chromium}=require('playwright');
const output=new URL('../build-artifacts/living-20260927/',import.meta.url);
mkdirSync(output,{recursive:true});
const dataDir=mkdtempSync(join(tmpdir(),'blackhole-h2-'));
const token=randomBytes(32).toString('hex');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
let core,browser;
try{
  const store=openStore(dataDir);
  for(let index=0;index<3;index++){
    const at=new Date(Date.now()+index*1000).toISOString();
    const top=rankMotivatedCandidates({jobs:[]},[{action:{kind:'quest',taskKey:`h2:${index}`},goal:'합성 근거 작업',successCriterion:'출처와 결과 확인',signals:{reuseArtifacts:0,assetGap:1,knowledgeGap:0,verificationGap:1,estimatedCalls:0.5,ownFailures:0,unknownCalls:0}}],at)[0];
    const recorded=recordDriveDecision(store.state,{at,top,candidates:[top]},{at,source:'owner'});
    store.state.driveState=recorded.driveState;
    store.state.driveDebates=recorded.driveDebates;
  }
  store.save();
  core=await start({host:'127.0.0.1',port:0,dataDir,token,env:{}});
  const origin=`http://127.0.0.1:${core.server.address().port}`;
  const stateResponse=await fetch(origin+'/api/state',{headers:{Authorization:`Bearer ${token}`}});
  assert.equal(stateResponse.status,200);
  const state=await stateResponse.json();
  assert.equal(state.core.activity,'idle');
  const driveResponse=await fetch(origin+'/api/drives/status',{headers:{Authorization:`Bearer ${token}`}});
  assert.equal(driveResponse.status,200);
  const measured=await driveResponse.json();
  assert.equal(Object.keys(measured.hunger).length,7);
  assert.equal(measured.lastDebate.length,3);
  const hungriest=measured.drives.reduce((winner,drive)=>measured.hunger[drive.driveId]>measured.hunger[winner.driveId]?drive:winner);
  assert.equal(measured.hungryVoice?.driveId,hungriest.driveId);
  const expected=measured.hungryVoice.text;
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext({baseURL:origin,viewport:{width:400,height:840},reducedMotion:'reduce'});
  const page=await context.newPage();
  let dispatched=0;
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/commands')dispatched++;});
  await page.goto('/jarvis');
  await page.locator('#pair-screen').waitFor({state:'visible',timeout:12000});
  await page.locator('#device-connect').click();
  const reference=page.locator('#device-connect-reference');
  await reference.waitFor({state:'visible'});
  const requestId=await reference.textContent();
  const approval=await context.request.post('/api/web/pairing/approve',{headers:{Authorization:`Bearer ${token}`,Origin:origin},data:{requestId}});
  assert.equal(approval.status(),200);
  await page.locator('#pair-screen').waitFor({state:'hidden'});
  await page.waitForFunction(text=>document.querySelector('#line')?.textContent===text,expected,{timeout:12000});
  await page.waitForFunction(()=>!document.querySelector('#line')?.classList.contains('fade'));
  assert.equal(await page.locator('#mode').textContent(),'쉬는 중');
  assert.equal(dispatched,0);
  const images=[];
  for(const [width,height,file] of [[400,840,'h2-idle-voice.png'],[1440,900,'h2-idle-voice-desktop.png']]){
    const priorFrames=await page.evaluate(()=>Number(document.querySelector('canvas[data-rendered-frames]')?.dataset.renderedFrames??0));
    await page.setViewportSize({width,height});
    await page.waitForFunction(previous=>{const canvas=document.querySelector('canvas[data-rendered-frames]');return !canvas||Number(canvas.dataset.renderedFrames)>=previous+2;},priorFrames,{timeout:5000});
    await page.screenshot({path:fileURLToPath(new URL(file,output)),fullPage:true});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
    assert.equal(overflow,false,`${width}px viewport overflows`);
    images.push({file,width,height,sha256:sha256(readFileSync(new URL(file,output)))});
  }
  const report={evidenceClass:'SYNTHETIC_DRIVE_STATE_REAL_BROWSER',coreActivity:state.core.activity,driveCount:7,debateVoices:3,hungriestDriveId:hungriest.driveId,hunger:measured.hunger[hungriest.driveId],visibleSpeech:expected,automaticCommands:dispatched,images};
  writeFileSync(new URL('h2-report.json',output),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{
  await browser?.close();
  const closed=core?new Promise(resolve=>core.server.once('close',resolve)):null;
  core?.shutdown();
  await closed;
  await rm(dataDir,{recursive:true,force:true});
}
