import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {start} from '../runtime/server.mjs';

const require = createRequire(new URL('../apps/controller/package.json', import.meta.url));
const {chromium} = require('playwright');
const out = new URL('../build-artifacts/reel-absorption-20261001/', import.meta.url);
mkdirSync(out, {recursive:true});
const dataDir = mkdtempSync(join(tmpdir(), 'blackhole-small-orb-'));
const token = randomBytes(32).toString('hex');
const sha = file => createHash('sha256').update(readFileSync(new URL(file, out))).digest('hex');
const report = {evidenceClass:'SYNTHETIC_PROVIDER_LOCAL_ISOLATED_CORE_AND_EDGE', screenshots:[], states:[], errors:[], externalRequests:0, commandCalls:0, modelCalls:0};
let core, browser;
try {
  core = await start({host:'127.0.0.1',port:0,dataDir,token,
    env:{YENO_AGENT_PROVIDER:'auto',YENO_AGENT_DAILY_CALL_LIMIT:'2',YENO_NVIDIA_MODEL:'synthetic-orb-model',YENO_NVIDIA_API_KEY:'synthetic-fixture-only'},
    agentFetch:async()=>{
      report.modelCalls++;
      await new Promise(resolve=>setTimeout(resolve,8000));
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'합성 오브 시험 결과입니다.'}}],usage:{prompt_tokens:10,completion_tokens:10}}),{status:200,headers:{'content-type':'application/json'}});
    }});
  const origin = `http://127.0.0.1:${core.server.address().port}`;
  browser = await chromium.launch({headless:true,channel:'msedge'});
  const context = await browser.newContext({baseURL:origin,viewport:{width:400,height:840},reducedMotion:'reduce'});
  const page = await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('request',request=>{
    if (new URL(request.url()).origin !== origin) report.externalRequests++;
    if (new URL(request.url()).pathname === '/api/commands') report.commandCalls++;
  });
  await page.goto('/jarvis');
  await page.locator('#device-connect').click();
  await page.locator('#device-connect-reference').waitFor({state:'visible'});
  const requestId = await page.locator('#device-connect-reference').textContent();
  const approval = await context.request.post('/api/web/pairing/approve',{
    headers:{Authorization:`Bearer ${token}`,Origin:origin},data:{requestId},
  });
  assert.equal(approval.status(),200);
  await page.locator('#pair-screen').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('#header-small-orb')?.dataset.orbState==='still');
  for (const [width,height] of [[400,840],[768,900],[1440,900]]) {
    await page.setViewportSize({width,height});
    const file = `small-orb-idle-${width}.png`;
    await page.screenshot({path:fileURLToPath(new URL(file,out)),fullPage:true});
    const state = await page.evaluate(()=>({orb:document.querySelector('#header-small-orb')?.dataset.orbState,
      label:document.querySelector('#header-small-orb .small-orb-label')?.textContent,
      overflow:document.documentElement.scrollWidth>innerWidth,
      canvasWidth:document.querySelector('#header-small-orb canvas')?.width}));
    assert.deepEqual({orb:state.orb,label:state.label,overflow:state.overflow},{orb:'still',label:'움직임 없음',overflow:false});
    report.screenshots.push({file,sha256:sha(file),width,height});
    report.states.push(state);
  }
  assert.equal(report.errors.length,0);
  assert.equal(report.externalRequests,0);
  assert.equal(report.commandCalls,0);
  await page.setViewportSize({width:400,height:840});
  await page.locator('#in').fill('오늘 할 일 세 개 정리해줘');
  await page.locator('#send').click();
  await page.waitForFunction(()=>document.querySelector('#header-small-orb')?.dataset.orbState==='working',null,{timeout:15000});
  const workingResponse=await context.request.get('/api/state',{headers:{'X-Yeno-Browser':'1'}});
  assert.equal(workingResponse.status(),200);
  const working=await workingResponse.json();
  assert.ok(['planning','executing'].includes(working.core.activity));
  const activeFile='small-orb-working-400.png';
  await page.screenshot({path:fileURLToPath(new URL(activeFile,out)),fullPage:true});
  report.screenshots.push({file:activeFile,sha256:sha(activeFile),width:400,height:840});
  report.states.push({orb:'working',sourceActivity:working.core.activity,sourceJobCount:working.jobs.filter(job=>job.status==='running').length});
  const reducedFrame=await page.locator('#header-small-orb canvas').evaluate(canvas=>canvas.toDataURL());
  await page.waitForTimeout(700);
  const reducedFrameLater=await page.locator('#header-small-orb canvas').evaluate(canvas=>canvas.toDataURL());
  report.reducedMotionStatic=reducedFrame===reducedFrameLater;
  assert.equal(report.reducedMotionStatic,true);
  await page.emulateMedia({reducedMotion:'no-preference'});
  const cdp=await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const metric=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(entry=>[entry.name,entry.value]));
  const before=await metric();
  const motionFrame=await page.locator('#header-small-orb canvas').evaluate(canvas=>canvas.toDataURL());
  await page.waitForTimeout(1000);
  const after=await metric();
  const motionFrameLater=await page.locator('#header-small-orb canvas').evaluate(canvas=>canvas.toDataURL());
  report.motionFrameChanged=motionFrame!==motionFrameLater;
  report.pageTaskDurationSeconds=Number((after.TaskDuration-before.TaskDuration).toFixed(4));
  report.pageMeasurementElapsedSeconds=Number((after.Timestamp-before.Timestamp).toFixed(4));
  assert.equal(report.motionFrameChanged,true);
  assert.ok(report.pageTaskDurationSeconds>=0);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>document.querySelector('#header-small-orb')?.dataset.orbState==='still',null,{timeout:30000});
  const finishedResponse=await context.request.get('/api/state',{headers:{'X-Yeno-Browser':'1'}});
  const finished=await finishedResponse.json();
  assert.equal(finished.core.activity,'idle');
  assert.equal(report.commandCalls,1);
  assert.equal(report.modelCalls,1);
  writeFileSync(new URL('small-orb-browser-report.json',out),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  const closed = core ? new Promise(resolve=>core.server.once('close',resolve)) : null;
  core?.shutdown();
  await closed;
  // This path was created by mkdtemp in the OS temp directory in this run.
  if (dataDir.startsWith(tmpdir()) && dataDir.includes('blackhole-small-orb-')) await rm(dataDir,{recursive:true,force:true});
}
