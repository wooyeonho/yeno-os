import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {start} from '../runtime/server.mjs';

const require = createRequire(new URL('../apps/controller/package.json', import.meta.url));
const {chromium} = require('playwright');
const out = new URL('../build-artifacts/jarvis-webgl-20260927/', import.meta.url);
mkdirSync(out, {recursive:true});
const dataDir = mkdtempSync(join(tmpdir(), 'blackhole-webgl-'));
const token = randomBytes(32).toString('hex');
const sha256 = name => createHash('sha256').update(readFileSync(new URL(name, out))).digest('hex');
let core;
let browser;
const report = {webgl:null,mobileFps:null,reducedMotion:null,fallback:null,contextLoss:null,ownerDrawer:null,stateFixture:null,csp:null,externalRequests:[],errors:[],screenshots:{}};

async function pairedPage(context, origin) {
  const page = await context.newPage();
  await page.goto('/jarvis');
  await page.locator('#device-connect').click();
  const reference = page.locator('#device-connect-reference');
  await reference.waitFor({state:'visible'});
  const requestId = await reference.textContent();
  assert.match(requestId,/^[a-f0-9-]{36}$/);
  const approval = await context.request.post('/api/web/pairing/approve', {
    headers:{Authorization:`Bearer ${token}`,Origin:origin,'Content-Type':'application/json'},
    data:{requestId},
  });
  assert.equal(approval.status(),200);
  await page.waitForFunction(()=>document.querySelector('#pair-screen')?.hidden===true);
  return page;
}

try {
  core = await start({host:'127.0.0.1',port:0,dataDir,token,env:{}});
  const origin = `http://127.0.0.1:${core.server.address().port}`;
  browser = await chromium.launch({headless:true,channel:'msedge'});
  const context = await browser.newContext({baseURL:origin,viewport:{width:400,height:800}});
  context.on('request',request=>{if(new URL(request.url()).origin!==origin)report.externalRequests.push(request.url());});
  const page = await pairedPage(context,origin);
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  report.csp = (await context.request.get('/jarvis')).headers()['content-security-policy'];
  assert.match(report.csp,/script-src 'self'/);
  await page.waitForFunction(()=>document.querySelector('#orb')?.dataset.renderer==='webgl',null,{timeout:12000});
  report.webgl = await page.evaluate(()=>({renderer:document.querySelector('#orb').dataset.renderer,canvas:!!document.querySelector('#orb-webgl')}));
  assert.deepEqual(report.webgl,{renderer:'webgl',canvas:true});
  await page.setViewportSize({width:1440,height:900});
  await page.locator('#orb-webgl').screenshot({path:fileURLToPath(new URL('desktop-motion-0.png',out))});
  await page.waitForTimeout(2000);
  await page.locator('#orb-webgl').screenshot({path:fileURLToPath(new URL('desktop-motion-2.png',out))});
  assert.notEqual(sha256('desktop-motion-0.png'),sha256('desktop-motion-2.png'),'Desktop WebGL rings move over two seconds');
  await page.setViewportSize({width:400,height:800});
  await page.waitForTimeout(100);
  await page.locator('#orb-webgl').screenshot({path:fileURLToPath(new URL('motion-0.png',out))});
  await page.waitForTimeout(2000);
  await page.locator('#orb-webgl').screenshot({path:fileURLToPath(new URL('motion-2.png',out))});
  assert.notEqual(sha256('motion-0.png'),sha256('motion-2.png'),'WebGL rings move over two seconds');
  report.mobileFps = await page.evaluate(async()=>{
    const canvas=document.querySelector('#orb-webgl');
    const before=Number(canvas.dataset.renderedFrames);
    const begun=performance.now();
    await new Promise(resolve=>setTimeout(resolve,2000));
    const elapsed=performance.now()-begun;
    return Math.round((Number(canvas.dataset.renderedFrames)-before)*1000/elapsed);
  });
  assert.ok(report.mobileFps>=30,`400px WebGL frame rate: ${report.mobileFps}`);
  await page.locator('#control-toggle').click();
  await page.locator('#controls').waitFor({state:'visible'});
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await page.screenshot({path:fileURLToPath(new URL('controls-focused-400.png',out))});
  report.ownerDrawer={open:await page.locator('#controls').isVisible(),focus:await page.locator('#control-close').evaluate(el=>document.activeElement===el),focusVisible:await page.locator('#control-close').evaluate(el=>el.matches(':focus-visible'))};
  assert.deepEqual(report.ownerDrawer,{open:true,focus:true,focusVisible:true});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#controls').isVisible(),false,'Escape closes the owner drawer');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForTimeout(250);
  await page.locator('#orb-webgl').screenshot({path:fileURLToPath(new URL('reduced-0.png',out))});
  await page.waitForTimeout(700);
  await page.locator('#orb-webgl').screenshot({path:fileURLToPath(new URL('reduced-1.png',out))});
  report.reducedMotion = sha256('reduced-0.png')===sha256('reduced-1.png');
  assert.equal(report.reducedMotion,true,'Reduced motion freezes the WebGL scene');
  const lossSupported=await page.evaluate(()=>{
    const extension=document.querySelector('#orb-webgl').getContext('webgl2')?.getExtension('WEBGL_lose_context');
    if(!extension)return false;
    extension.loseContext();
    return true;
  });
  report.contextLoss={extensionSupported:lossSupported,fallbackObserved:false};
  if(lossSupported){
    await page.waitForFunction(()=>document.querySelector('#orb')?.dataset.renderer==='2d');
    report.contextLoss.fallbackObserved=await page.locator('#orb').evaluate(el=>getComputedStyle(el).visibility==='visible');
    assert.equal(report.contextLoss.fallbackObserved,true,'WebGL loss resumes 2D renderer');
    await page.screenshot({path:fileURLToPath(new URL('context-loss-fallback.png',out))});
  }
  const fallbackContext = await browser.newContext({baseURL:origin,viewport:{width:400,height:800}});
  fallbackContext.on('request',request=>{if(new URL(request.url()).origin!==origin)report.externalRequests.push(request.url());});
  await fallbackContext.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){
      if(kind==='webgl'||kind==='webgl2')return null;
      return original.call(this,kind,...args);
    };
  });
  const fallback = await pairedPage(fallbackContext,origin);
  await fallback.waitForFunction(()=>document.querySelector('#orb')?.dataset.renderer==='2d',null,{timeout:12000});
  report.fallback = await fallback.evaluate(()=>({renderer:document.querySelector('#orb').dataset.renderer,visible:getComputedStyle(document.querySelector('#orb')).visibility}));
  assert.deepEqual(report.fallback,{renderer:'2d',visible:'visible'});
  await fallback.waitForFunction(()=>{
    const line=document.querySelector('#line');
    return line.textContent!=='연결을 확인하고 있어.'&&Number(getComputedStyle(line).opacity)>.95;
  });
  await fallback.locator('#orb').screenshot({path:fileURLToPath(new URL('fallback-2d.png',out))});
  const statePage=await context.newPage();
  await statePage.goto('/jarvis.css');
  await statePage.setContent('<!doctype html><html><head><link rel="stylesheet" href="/jarvis.css"></head><body><div class="app"><canvas id="orb"></canvas></div></body></html>');
  await statePage.evaluate(async()=>{
    const {createWebGLOrb}=await import('/jarvis-webgl.mjs');
    window.__scene={online:true,core:{activity:'idle',activeShadowCount:0,pendingApprovalCount:0}};
    window.__renderer=createWebGLOrb(document.querySelector('#orb'),window.__scene,()=>'#9dc8c7',()=>0,()=>{});
  });
  await statePage.waitForFunction(()=>document.querySelector('#orb-webgl')?.dataset.visibleSatellites==='0');
  await statePage.locator('#orb-webgl').screenshot({path:fileURLToPath(new URL('state-idle.png',out))});
  await statePage.evaluate(()=>{window.__scene.core={activity:'waiting_owner',activeShadowCount:3,pendingApprovalCount:1};});
  await statePage.waitForFunction(()=>{
    const canvas=document.querySelector('#orb-webgl');
    return canvas?.dataset.pendingRing==='true'&&canvas.dataset.visibleSatellites==='3';
  });
  await statePage.locator('#orb-webgl').screenshot({path:fileURLToPath(new URL('state-pending-shadows.png',out))});
  report.stateFixture={scope:'synthetic renderer state',pendingRing:true,visibleSatellites:3,pixelsChanged:sha256('state-idle.png')!==sha256('state-pending-shadows.png')};
  assert.equal(report.stateFixture.pixelsChanged,true,'Pending owner and shadow state change the rendered scene');
  await statePage.close();
  assert.deepEqual(report.errors,[]);
  assert.deepEqual(report.externalRequests,[],'Jarvis loads no external CDN or font request');
  for(const name of ['desktop-motion-0.png','desktop-motion-2.png','motion-0.png','motion-2.png','controls-focused-400.png','reduced-0.png','reduced-1.png','fallback-2d.png','state-idle.png','state-pending-shadows.png'])report.screenshots[name]=sha256(name);
  if(lossSupported)report.screenshots['context-loss-fallback.png']=sha256('context-loss-fallback.png');
  writeFileSync(new URL('report.json',out),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  const closed=core?new Promise(resolve=>core.server.once('close',resolve)):null;
  core?.shutdown();
  await closed;
}
