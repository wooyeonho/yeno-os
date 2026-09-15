// Real app.js/growth-view.mjs wiring, not just createGrowthView() called
// directly: this is the actual regression the HIGH-1 fix promises - a
// background render (the app already re-renders growth data on every
// refresh() cycle regardless of which tab is showing, see render() in
// app.js) must never consume a "새로 확인"/"승급" badge the owner has not
// actually looked at, and only leaving the growth tab (showTab()) may
// commit the seen-grades snapshot.
import {createRequire} from 'node:module';
import {readFileSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {webcrypto,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {start} from '../runtime/server.mjs';
import {capabilityInputSha256} from '../runtime/lib/capabilities.mjs';
const require=createRequire(new URL('../apps/controller/package.json',import.meta.url));
const {JSDOM,CookieJar,VirtualConsole}=require('jsdom');
const {build}=require('esbuild');
const root=fileURLToPath(new URL('../runtime/public/',import.meta.url));
const source=readFileSync(join(root,'app.js'),'utf8').replace(/import\('\//g,"import('./");
const bundle=await build({stdin:{contents:source,resolveDir:root,loader:'js'},bundle:true,format:'iife',write:false});
const html=readFileSync(join(root,'index.html'),'utf8');
const dataDir=mkdtempSync(join(tmpdir(),'blackhole-growth-badges-'));
const owner='growth-badges-synthetic-owner-key';
const core=await start({host:'127.0.0.1',port:0,dataDir,token:owner,env:{}});
const origin=`http://127.0.0.1:${core.server.address().port}`;
const jar=new CookieJar(),persisted=new Map(),doms=new Set(),errors=[],reads=[];
let held=false,dom,activeNetwork=0;
const storage={getItem:key=>persisted.get(key)??null,setItem:(key,value)=>persisted.set(key,String(value)),removeItem:key=>persisted.delete(key)};
const locks={async request(name,options,callback){assert.equal(name,'blackhole-web-controller-v1');if(held)return callback(null);held=true;try{return await callback({name});}finally{held=false;}}};
const until=async(check,label)=>{const deadline=Date.now()+10000;while(!check()){if(Date.now()>deadline)throw new Error(`Timed out: ${label}`);await new Promise(resolve=>setTimeout(resolve,20));}};
function openDom(){
  const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>{if(!error.message.includes('navigation'))errors.push(error.message);});
  const page=new JSDOM(html,{url:origin,runScripts:'outside-only',pretendToBeVisual:true,cookieJar:jar,virtualConsole});
  doms.add(page);const w=page.window;
  Object.defineProperty(w,'localStorage',{value:storage});Object.defineProperty(w,'crypto',{value:webcrypto});Object.defineProperty(w.navigator,'locks',{value:locks});
  w.structuredClone=structuredClone;w.AbortSignal=AbortSignal;w.Blob=Blob;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.HTMLMediaElement.prototype.pause=function(){};
  w.HTMLElement.prototype.scrollIntoView=function(){};w.URL.createObjectURL=()=>`blob:${origin}/${randomUUID()}`;w.URL.revokeObjectURL=()=>{};
  w.fetch=async(route,init={})=>{
    activeNetwork++;
    try {
      reads.push(String(route));
      const url=new URL(route,origin);assert.equal(url.origin,origin);
      const cookie=jar.getCookieStringSync(url.href);const headers={...init.headers,...(cookie?{Cookie:cookie}:{}),...(init.method==='POST'?{Origin:origin}:{})};
      const response=await fetch(url,{...init,headers});
      const bytes=await response.arrayBuffer();
      for(const value of response.headers.getSetCookie())jar.setCookieSync(value,url.href);
      return new Response(bytes,{status:response.status,headers:response.headers});
    } finally {activeNetwork--;}
  };
  w.eval(bundle.outputFiles[0].text);return page;
}
const $=selector=>dom.window.document.querySelector(selector);
function click(selector){assert.ok($(selector),selector);$(selector).click();}
function submit(selector,values){const form=$(selector);assert.ok(form,selector);for(const [id,value]of Object.entries(values)){const el=form.querySelector(`[name="${id}"],#${id}`);assert.ok(el,id);el.value=value;}form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));}
async function close(page){page.window.dispatchEvent(new page.window.Event('pagehide'));await until(()=>activeNetwork===0,'drain destroyed-window network');await new Promise(resolve=>setImmediate(resolve));page.window.close();doms.delete(page);await new Promise(resolve=>setImmediate(resolve));}
function seenGrades(){ try { return JSON.parse(persisted.get([...persisted.keys()].find(key=>key.endsWith(':blackhole-growth-seen-grades-v1'))??'') || '{}'); } catch { return {}; } }
async function runCapability(id,recordsJson){
  const expectedInputSha256=capabilityInputSha256(JSON.parse(recordsJson));
  click(`[data-cap-action="prepare"][data-id="${id}"]`);
  $('[data-cap-input]').value=recordsJson;
  click('[data-cap-action="run"]');
  await until(()=>/작업을 접수했습니다/.test($('[data-cap-message]')?.textContent||''),`${id} run accepted`);
  // core.state() returns the same public job shape as /api/state - the raw
  // capabilityRequest field is internal-only, so match on the public
  // capability.inputSha256 the server itself computed for this exact input.
  await until(()=>core.state().jobs.some(job=>job.type==='capability'&&job.status==='completed'&&job.capability?.id===id&&job.capability?.inputSha256===expectedInputSha256),`${id} job completed`);
}

const proof={at:new Date().toISOString(),scope:'real app.js/growth-view.mjs wiring against a real temporary core; JSDOM/cookies/locks simulated',checks:[]};
try {
  dom=openDom();await until(()=>reads.includes('/api/web/session'),'login form ready');submit('#pair-form',{'pair-token':owner});
  await until(()=>$('#pair-screen').hidden===true,'cookie login');

  // 1) First-ever visit to the growth tab: both bootstrapped capabilities
  // (evidence-gap-brief, failure-triage) are honestly "새로 확인".
  click('[data-tab="growth"]');
  await until(()=>/새로 확인/.test($('#growth-root').textContent)&&$('#growth-root').textContent.includes('연구 근거 공백 정리'),'first growth view shows both as newly seen');
  assert.equal(Object.keys(seenGrades()).length,0,'첫 방문에서 아직 떠나지 않았으므로 저장값은 비어 있어야 합니다');

  // Leaving the tab commits E for both.
  click('[data-tab="control"]');
  await until(()=>seenGrades()['capability:evidence-gap-brief']==='E'&&seenGrades()['capability:failure-triage']==='E','leaving growth tab commits the initial E grades');
  proof.checks.push('first visit shows 새로 확인 for both bootstrapped capabilities; leaving the tab commits E for both');

  // 2) A real background change while the owner is on a *different* tab:
  // run evidence-gap-brief on two genuinely different inputs through the
  // real autopilot tab's Kirby panel (the exact C-grade requirement from
  // growth.mjs), while never visiting the growth tab.
  click('[data-tab="autopilot"]');
  await runCapability('evidence-gap-brief','{"records":[{"title":"자료 A","evidenceCount":0,"priority":3,"nextStep":"원문 확인"}]}');
  await runCapability('evidence-gap-brief','{"records":[{"title":"자료 B","evidenceCount":1,"priority":2,"nextStep":"재현 확인"}]}');
  assert.equal(core.state().growth.capabilities.skills.find(s=>s.id==='evidence-gap-brief').grade,'C','실제로 C등급에 도달해야 합니다');
  // app.js's own render() cascade (render -> renderQuests -> renderGrowth)
  // runs on every refresh() regardless of active tab - proving the real
  // background-render path this bug lived in still calls updateState()...
  assert.equal(seenGrades()['capability:evidence-gap-brief'],'E','...but a background render on another tab must never consume the badge - storage must stay at E');
  proof.checks.push('running evidence-gap-brief to a real C grade from the autopilot tab (background render) leaves stored grade at E');

  // 3) The owner now actually opens the growth tab: sees the real E->C
  // upgrade, and it survives several more background-triggered re-renders
  // while the tab stays open (a second, harmless capability run).
  click('[data-tab="growth"]');
  await until(()=>/승급 E→C/.test($('#growth-root').textContent),'real E->C upgrade shown on entering the growth tab');
  // app.js runs a real setInterval(() => { if (!document.hidden) refresh(); }, 1500)
  // - staying on the growth tab (never navigating away) for a few cycles is
  // the real background-render path this bug lived in, not a simulated one.
  await new Promise(resolve=>setTimeout(resolve,3600));
  assert.match($('#growth-root').textContent,/승급 E→C/,'실제 1.5초 주기 자동 새로고침이 여러 번 지나가도 배지가 유지돼야 합니다');
  assert.equal(seenGrades()['capability:evidence-gap-brief'],'E','성장 탭에 머무는 동안 자동 새로고침이 반복돼도 아직 떠나지 않았으므로 저장값은 그대로여야 합니다');
  proof.checks.push('upgrade badge survives several real 1.5s auto-refresh cycles while the growth tab stays open; storage stays at E until the owner leaves');

  // 4) Leaving the growth tab commits the acknowledged C grade.
  click('[data-tab="control"]');
  await until(()=>seenGrades()['capability:evidence-gap-brief']==='C','leaving the growth tab commits the real C grade');
  proof.checks.push('leaving the growth tab commits the acknowledged C grade to storage');

  // 5) A fresh app load (same persisted storage, standing in for closing and
  // reopening the app) no longer shows the badge for an already-acknowledged
  // grade - it was genuinely seen, not silently dropped.
  await close(dom);dom=openDom();
  await until(()=>$('#pair-screen').hidden===true,'auto-login via the persisted cookie after reload');
  click('[data-tab="growth"]');
  await until(()=>$('#growth-root').textContent.includes('연구 근거 공백 정리'),'growth tab loaded after reload');
  assert.doesNotMatch($('#growth-root').textContent,/승급 E→C|새로 확인/,'이미 확인한 등급은 재시작 후 다시 배지로 나오면 안 됩니다');
  proof.checks.push('after a real app reload, the already-acknowledged grade shows no stale badge');

  assert.equal(errors.length,0,errors.join(';'));
  proof.ok=true;
  if(process.env.YENO_GROWTH_BADGES_PROOF_PATH)writeFileSync(process.env.YENO_GROWTH_BADGES_PROOF_PATH,JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify(proof,null,2));
} finally {
  for(const page of doms)await close(page);
  core.shutdown();
  await new Promise(resolve=>setTimeout(resolve,80));
  rmSync(dataDir,{recursive:true,force:true});
}
