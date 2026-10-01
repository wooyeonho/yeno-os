import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes, createHash} from 'node:crypto';
import {copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {start} from '../runtime/server.mjs';

const require = createRequire(new URL('../apps/controller/package.json', import.meta.url));
const {chromium} = require('playwright');
const dataDir = mkdtempSync(join(tmpdir(), 'blackhole-jarvis-live-'));
const outDir = new URL('../build-artifacts/jarvis-e2e-20260927/', import.meta.url);
mkdirSync(outDir, {recursive:true});
const token = randomBytes(32).toString('hex');
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const screenshotNames = ['desktop-1440.png','mobile-400.png','controls-1440.png','controls-mobile-400.png','unpaired-mobile-400.png','model-missing-saved.png','idle-0.png','idle-900.png','reduced-motion-0.png','reduced-motion-700.png','a4-result.png','a5-mobile.png','a6-0.png','a6-1.png','a7-0.png','a7-1.png'];
let core, browser;
const report = {server:null,css:false,orbModule:false,csp:false,inlineStyles:false,externalFonts:0,desktop:null,mobile:null,motion:null,verifyingRing:null,controls:null,unpairedGate:null,conversationOffline:null,modelFallback:null,reducedMotion:null,errors:[]};
try {
  core = await start({host:'127.0.0.1',port:0,dataDir,token,env:{}});
  const origin = `http://127.0.0.1:${core.server.address().port}`;
  report.server = 'isolated-real-core';
  browser = await chromium.launch({headless:true,channel:'msedge'});
  const unpaired = await browser.newContext({baseURL:origin,viewport:{width:400,height:840}});
  const gatePage = await unpaired.newPage();
  await gatePage.goto('/jarvis');
  await gatePage.locator('#pair-screen').waitFor({state:'visible'});
  report.unpairedGate = {requestVisible:await gatePage.locator('#device-connect').isVisible(),secretFormVisible:await gatePage.locator('#pair-form').isVisible()};
  assert.deepEqual(report.unpairedGate,{requestVisible:true,secretFormVisible:false});
  await gatePage.screenshot({path:fileURLToPath(new URL('unpaired-mobile-400.png',outDir)),fullPage:true});
  await gatePage.locator('#device-connect').click();
  const reference = gatePage.locator('#device-connect-reference');
  await reference.waitFor({state:'visible'});
  const requestId = await reference.textContent();
  assert.match(requestId,/^[a-f0-9-]{36}$/);
  const approval = await unpaired.request.post('/api/web/pairing/approve', {
    headers:{Authorization:`Bearer ${token}`,Origin:origin,'Content-Type':'application/json'},
    data:{requestId},
  });
  assert.equal(approval.status(),200,'Owner approval of displayed browser request');
  await gatePage.waitForFunction(()=>document.querySelector('#pair-screen')?.hidden===true,null,{timeout:12000});
  report.unpairedGate.ownerApproved = true;
  const context = await browser.newContext({baseURL:origin,viewport:{width:1440,height:900},storageState:await unpaired.storageState()});
  // This suite covers the retained 2D scene. The separate WebGL suite tests
  // the primary renderer, motion, reduced motion, and the disabled-WebGL path.
  await context.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){
      if(kind==='webgl'||kind==='webgl2')return null;
      return original.call(this,kind,...args);
    };
  });
  await unpaired.close();
  const css = await context.request.get('/jarvis.css');
  report.css = css.status()===200 && (css.headers()['content-type']||'').includes('text/css');
  assert.equal(report.css,true,'CSS served by the real allowlist');
  const orbModule = await context.request.get('/jarvis-orb.mjs');
  report.orbModule = orbModule.status()===200 && (await orbModule.text()).includes('startJarvisOrb');
  assert.equal(report.orbModule,true,'Canvas module served by the real allowlist');
  const page = await context.newPage();
  const commandRoutes=[];
  page.on('request',request=>{const route=new URL(request.url()).pathname;if(['/api/voice','/api/commands'].includes(route))commandRoutes.push(route);});
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error' && !/Failed to load resource: the server responded with a status of (401|409)/.test(message.text()))report.errors.push(message.text());});
  page.on('request',request=>{if(/fonts\.(googleapis|gstatic)\.com|\.woff2?(?:$|\?)/i.test(request.url()))report.externalFonts++;});
  const response = await page.goto('/jarvis');
  assert.equal(response.status(),200);
  report.csp = (response.headers()['content-security-policy']||'').includes("style-src 'self'");
  assert.equal(report.csp,true,'Real CSP present');
  await page.waitForFunction(()=>document.querySelector('#mode')?.textContent!=='연결 중',null,{timeout:12000});
  report.inlineStyles = await page.locator('style,[style]').count()>0;
  assert.equal(report.inlineStyles,false,'No inline style under CSP');
  const desktopStyle = await page.locator('.app').evaluate(el=>({background:getComputedStyle(el).backgroundImage,width:Math.round(el.getBoundingClientRect().width)}));
  assert.match(desktopStyle.background,/gradient/);
  await page.waitForTimeout(400);
  await page.screenshot({path:fileURLToPath(new URL('desktop-1440.png',outDir)),fullPage:true});
  report.desktop = {width:desktopStyle.width,mode:await page.locator('#mode').textContent()};
  await page.setViewportSize({width:1280,height:800});
  const motionFrames=await page.evaluate(async()=>{
    const canvas=document.querySelector('#orb'),ctx=canvas.getContext('2d');
    const ratio=canvas.width/canvas.getBoundingClientRect().width;
    const x=Math.round(canvas.width*.5),y=Math.round(canvas.height*.35);
    const capture=()=>{
      const intensity=r=>{
        const data=ctx.getImageData(Math.round(x+r*ratio),y,1,1).data;
        return data[0]*.2126+data[1]*.7152+data[2]*.0722;
      };
      const peaks=[];
      for(let r=155;r<=205;r++){
        const value=intensity(r);
        if(value>intensity(r-1)&&value>=intensity(r+1))peaks.push({radius:r,intensity:Math.round(value*10)/10});
      }
      return {at:performance.now(),peaks:peaks.sort((a,b)=>b.intensity-a.intensity).slice(0,5),png:canvas.toDataURL('image/png').split(',')[1]};
    };
    await new Promise(resolve=>{const check=()=>Math.sin(performance.now()*Math.PI*2/1400)>.98?resolve():setTimeout(check,10);check();});
    const first=capture();
    await new Promise(resolve=>setTimeout(resolve,900));
    const second=capture();
    return {first,second};
  });
  writeFileSync(new URL('idle-0.png',outDir),Buffer.from(motionFrames.first.png,'base64'));
  writeFileSync(new URL('idle-900.png',outDir),Buffer.from(motionFrames.second.png,'base64'));
  report.motion={firstPeaks:motionFrames.first.peaks,secondPeaks:motionFrames.second.peaks,elapsedMs:Math.round(motionFrames.second.at-motionFrames.first.at),pixelShaEqual:sha256(fileURLToPath(new URL('idle-0.png',outDir)))===sha256(fileURLToPath(new URL('idle-900.png',outDir)))};
  assert.equal(report.motion.pixelShaEqual,false,'Idle orb changes with allowed motion');
  assert.ok(Math.abs(report.motion.firstPeaks[0].radius-report.motion.secondPeaks[0].radius)>=3,'Idle core ring radius changes by at least 3px');
  await page.setViewportSize({width:1440,height:900});
  await page.locator('#control-toggle').click();
  assert.equal(await page.locator('#controls').isVisible(),true);
  await page.screenshot({path:fileURLToPath(new URL('controls-1440.png',outDir)),fullPage:true});
  await page.locator('#emergency-toggle').click();
  assert.equal(await page.locator('#stop-confirm').isVisible(),true);
  assert.equal(await page.locator('#emergency-toggle').getAttribute('data-stopped'),'false','First click only asks for confirmation');
  await page.locator('#emergency-toggle').click();
  await page.waitForFunction(()=>document.querySelector('#emergency-toggle')?.dataset.stopped==='true');
  await page.locator('#emergency-toggle').click();
  await page.waitForFunction(()=>document.querySelector('#emergency-toggle')?.dataset.stopped==='false');
  report.controls = 'stop-and-resume-real-core';
  await page.locator('#control-close').click();
  await page.locator('#command-mode').click();
  assert.equal(await page.locator('#command-mode').getAttribute('aria-pressed'),'true');
  await page.locator('#in').fill('자동 운영 시작');
  const routeCount=commandRoutes.length;
  await page.locator('#send').click();
  await page.waitForFunction(()=>document.querySelector('#line')?.textContent?.includes('보관하지 않았어'),null,{timeout:12000});
  assert.deepEqual(commandRoutes.slice(routeCount),['/api/voice'],'Conversation mode never submits a control command');
  const afterConversation=await context.request.get('/api/state',{headers:{'X-Yeno-Browser':'1'}});
  assert.equal((await afterConversation.json()).autopilot.enabled,false);
  const beforeWork=await context.request.get('/api/quests',{headers:{'X-Yeno-Browser':'1'}});
  assert.equal(JSON.stringify(await beforeWork.json()).includes('자동 운영 시작'),false,'Offline conversation does not become a goal');
  report.conversationOffline='command-shaped-input-not-dispatched-or-retained';
  await page.locator('#command-mode').click();
  assert.equal(await page.locator('#command-mode').getAttribute('aria-pressed'),'false');
  await page.locator('#in').fill('격리 검증용 작은 목표');
  await page.locator('#send').click();
  await page.waitForFunction(()=>document.querySelector('#line')?.textContent?.includes('요청은 목표로 보관했어'),null,{timeout:12000});
  const quests = await context.request.get('/api/quests',{headers:{'X-Yeno-Browser':'1'}});
  const saved = await quests.json();
  report.modelFallback = JSON.stringify(saved).includes('격리 검증용 작은 목표') ? 'saved-in-real-core' : 'speech-only';
  assert.equal(report.modelFallback,'saved-in-real-core');
  await page.waitForTimeout(400);
  await page.screenshot({path:fileURLToPath(new URL('model-missing-saved.png',outDir)),fullPage:true});
  await page.setViewportSize({width:400,height:800});
  await page.screenshot({path:fileURLToPath(new URL('mobile-400.png',outDir)),fullPage:true});
  await page.locator('#control-toggle').click();
  await page.screenshot({path:fileURLToPath(new URL('controls-mobile-400.png',outDir)),fullPage:true});
  await page.locator('#control-close').click();
  report.mobile = await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,inputVisible:!!document.querySelector('#in')?.getBoundingClientRect().width}));
  assert.ok(report.mobile.scrollWidth<=report.mobile.width,'No horizontal overflow at 400px');
  await page.emulateMedia({reducedMotion:'reduce'});
  report.reducedMotion = await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  assert.equal(report.reducedMotion,true);
  await page.waitForResponse(response=>new URL(response.url()).pathname==='/api/drives/status'&&response.ok(),{timeout:5000});
  await page.waitForTimeout(100);
  const reducedFrames=await page.evaluate(async()=>{
    const canvas=document.querySelector('#orb');
    const first=canvas.toDataURL('image/png').split(',')[1];
    await new Promise(resolve=>setTimeout(resolve,700));
    return {first,second:canvas.toDataURL('image/png').split(',')[1]};
  });
  writeFileSync(new URL('reduced-motion-0.png',outDir),Buffer.from(reducedFrames.first,'base64'));
  writeFileSync(new URL('reduced-motion-700.png',outDir),Buffer.from(reducedFrames.second,'base64'));
  assert.equal(sha256(fileURLToPath(new URL('reduced-motion-0.png',outDir))),sha256(fileURLToPath(new URL('reduced-motion-700.png',outDir))),'Reduced-motion orb has no time-dependent animation');
  const statePage=await context.newPage();
  await statePage.goto('/jarvis.css');
  await statePage.setContent('<!doctype html><html><head><link rel="stylesheet" href="/jarvis.css"></head><body><canvas id="orb"></canvas></body></html>');
  const verifyingColor=await statePage.evaluate(async()=>{
    const strokes=[];
    window.__jarvisStrokeStyles=strokes;
    const original=CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.stroke=function(...args){strokes.push(this.strokeStyle);return original.apply(this,args);};
    const {startJarvisOrb}=await import('/jarvis-orb.mjs');
    const css=getComputedStyle(document.documentElement);
    startJarvisOrb({core:{activity:'verifying',activeShadowCount:0,pendingApprovalCount:0},online:true},()=>css.getPropertyValue('--j-focus').trim(),()=>0);
    return `rgba(${css.getPropertyValue('--j-focus-rgb').trim()},0.63)`;
  });
  await statePage.waitForFunction(expected=>window.__jarvisStrokeStyles?.some(value=>value.replaceAll(' ','')===expected.replaceAll(' ','')),verifyingColor,{timeout:2000});
  report.verifyingRing={expected:verifyingColor,matched:true};
  await statePage.close();
  assert.equal(report.externalFonts,0);
  assert.deepEqual(report.errors,[]);
  for (const [source,target] of [
    ['model-missing-saved.png','a4-result.png'],
    ['mobile-400.png','a5-mobile.png'],
    ['idle-0.png','a6-0.png'],
    ['idle-900.png','a6-1.png'],
    ['reduced-motion-0.png','a7-0.png'],
    ['reduced-motion-700.png','a7-1.png'],
  ]) copyFileSync(new URL(source,outDir),new URL(target,outDir));
  writeFileSync(new URL('console.txt',outDir),'CSP violations: 0\nConsole errors: 0\n');
  report.sourceSha256 = Object.fromEntries(['runtime/public/jarvis.html','runtime/public/jarvis.css','runtime/public/jarvis.mjs','runtime/public/jarvis-orb.mjs','runtime/public/jarvis-scene-model.mjs'].map(name=>[name,sha256(fileURLToPath(new URL(`../${name}`,import.meta.url)))]));
  report.screenshotSha256 = Object.fromEntries(screenshotNames.map(name=>[name,sha256(fileURLToPath(new URL(name,outDir)))]));
  writeFileSync(new URL('report.json',outDir),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  const closed = core ? new Promise(resolve => core.server.once('close',resolve)) : null;
  core?.shutdown();
  await closed;
  await rm(dataDir,{recursive:true,force:true});
}
