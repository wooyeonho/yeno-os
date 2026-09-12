// Real temporary HTTP core + shipped web scripts. Browser cookies, Web Locks
// lifecycle and DOM are simulated; this is not a physical Android test.
import {createRequire} from 'node:module';
import {readFileSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {webcrypto,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {start} from '../runtime/server.mjs';
const require=createRequire(new URL('../apps/controller/package.json',import.meta.url));
const {JSDOM,CookieJar,VirtualConsole}=require('jsdom');
const {build}=require('esbuild');
const root=fileURLToPath(new URL('../runtime/public/',import.meta.url));
const source=readFileSync(join(root,'app.js'),'utf8').replace(/import\('\//g,"import('./");
const bundle=await build({stdin:{contents:source,resolveDir:root,loader:'js'},bundle:true,format:'iife',write:false});
const html=readFileSync(join(root,'index.html'),'utf8');
const dataDir=mkdtempSync(join(tmpdir(),'blackhole-web-ui-'));
const owner='web-ui-synthetic-owner-key-only';
const core=await start({host:'127.0.0.1',port:0,dataDir,token:owner,env:{}});
const origin=`http://127.0.0.1:${core.server.address().port}`;
const jar=new CookieJar(), persisted=new Map(), calls=[], reads=[], doms=new Set(), errors=[];
let held=false,losePath='',dom,activeNetwork=0;
const storage={getItem:key=>persisted.get(key)??null,setItem:(key,value)=>persisted.set(key,String(value)),removeItem:key=>persisted.delete(key)};
const locks={async request(name,options,callback){assert.equal(name,'blackhole-web-controller-v1');if(held)return callback(null);held=true;try{return await callback({name});}finally{held=false;}}};
const until=async(check,label)=>{const until=Date.now()+10000;while(!check()){if(Date.now()>until)throw new Error(`Timed out: ${label}; ${dom?.window.document.getElementById('pair-error')?.textContent}; pairHidden=${dom?.window.document.getElementById('pair-screen')?.hidden}; studio=${dom?.window.document.querySelector('.studio-status')?.textContent}; reads=${reads.join(',')}; ${errors.join(';')}`);await new Promise(resolve=>setTimeout(resolve,20));}};
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
    if(init.body){const body=JSON.parse(init.body);calls.push({path:url.pathname,body});if(url.pathname===losePath){losePath='';throw new TypeError('Synthetic response loss after commit');}}
    return new Response(bytes,{status:response.status,headers:response.headers});
    } finally {activeNetwork--;}
  };
  w.eval(bundle.outputFiles[0].text);return page;
}
const $=selector=>dom.window.document.querySelector(selector);
function click(selector){assert.ok($(selector),selector);$(selector).click();}
function submit(selector,values){const form=$(selector);assert.ok(form,selector);for(const [id,value]of Object.entries(values)){const el=form.querySelector(`[name="${id}"],#${id}`);assert.ok(el,id);el.value=value;}form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));}
async function close(page){page.window.dispatchEvent(new page.window.Event('pagehide'));await until(()=>activeNetwork===0,'drain destroyed-window network');await new Promise(resolve=>setImmediate(resolve));page.window.close();doms.delete(page);await new Promise(resolve=>setImmediate(resolve));}
const proof={at:new Date().toISOString(),scope:'temporary actual HTTP core; JSDOM/cookies/locks simulated; no provider calls',checks:[]};
try{
  dom=openDom();await until(()=>reads.includes('/api/web/session'),'login form ready');submit('#pair-form',{'pair-token':owner});
  await until(()=>$('#pair-screen').hidden&&$('.studio-status')?.textContent.includes('본체 확인'),'cookie login and studio');
  assert.equal($('#tab-studio').hidden,false);assert.equal(dom.window.document.cookie,'');assert.ok(![...persisted.values()].join('').includes(owner));
  proof.checks.push('owner key exchanged for HttpOnly cookie; no owner key in web storage; operating studio default');
  click('[data-studio-tab="places"]');await until(()=>$('form[data-studio-form="place"] button[type="submit"]')&&!$('form[data-studio-form="place"] button[type="submit"]').disabled,'place form');
  submit('form[data-studio-form="place"]',{title:'브라우저에서 저장한 장소',address:'',note:'처음 메모',url:'',latitude:'',longitude:''});
  await until(()=>$('.studio-pane').textContent.includes('처음 메모'),'place saved');
  const first=dom;dom=openDom();await until(()=>$('#pair-error').textContent.includes('다른 탭'),'second tab denied');await close(dom);dom=first;
  losePath='/api/studio';submit('form[data-studio-form="place"]',{title:'응답 유실 장소',address:'',note:'같은 요청 보존',url:'',latitude:'',longitude:''});
  await until(()=>!$('.studio-pending').hidden&&!$('[data-studio-action="retry"]').disabled,'lost reply kept');
  const original=calls.filter(call=>call.path==='/api/studio').at(-1);assert.ok([...persisted.values()].some(value=>value.includes(original.body.requestId)));
  await close(dom);dom=openDom();await until(()=>$('#pair-screen').hidden&&$('[data-studio-action="retry"]')&&!$('[data-studio-action="retry"]').disabled,'close/reopen same cookie and pending');
  click('[data-studio-action="retry"]');await until(()=>$('.studio-pending').hidden,'same request receipt');
  assert.deepEqual(calls.filter(call=>call.path==='/api/studio').at(-1),original);
  click('[data-studio-tab="places"]');await until(()=>$('.studio-pane').textContent.includes('같은 요청 보존'),'both records after reopen');
  const places=await(await dom.window.fetch('/api/studio',{headers:{'X-Yeno-Browser':'1'}})).json();
  assert.equal(places.places.length,2);assert.equal(places.places.filter(place=>place.title==='응답 유실 장소').length,1);
  proof.checks.push('second tab blocked; accepted write response lost; close/reopen; same request ID replay; exactly two places');
  click('[data-tab="memory"]');losePath='/api/memory';submit('#memory-form',{'memory-text':'영속 접수 확인 기억'});
  await until(()=>!$('#other-request').hidden&&!$('#retry-other').disabled,'memory reply lost');const memoryCall=calls.filter(call=>call.path==='/api/memory').at(-1);
  await close(dom);dom=openDom();await until(()=>$('#pair-screen').hidden&&!$('#retry-other').disabled,'reopened generic request');click('#retry-other');await until(()=>$('#other-request').hidden,'memory replay');
  assert.deepEqual(calls.filter(call=>call.path==='/api/memory').at(-1),memoryCall);assert.equal(core.state().memories.filter(item=>item.text==='영속 접수 확인 기억').length,1);
  proof.checks.push('memory mutation survives browser close; exact ID replay without duplicate');
  losePath='/api/web/logout';click('#disconnect');await until(()=>$('#toast').textContent.includes('연결 해제를 확인하지 못했습니다'),'lost logout response');assert.equal(jar.getCookieStringSync(origin),'');
  const firstLogout=calls.filter(call=>call.path==='/api/web/logout').at(-1);
  await close(dom);const readsBefore=reads.length;dom=openDom();await until(()=>reads.length>readsBefore,'logged-out session read');await new Promise(resolve=>setTimeout(resolve,40));assert.equal($('#pair-screen').hidden,false);
  submit('#pair-form',{'pair-token':owner});await until(()=>$('#pair-screen').hidden&&$('.studio-status')?.textContent.includes('본체 확인'),'new browser login after uncertain logout');
  click('#disconnect');await until(()=>!$('#pair-screen').hidden,'new device logout');
  const secondLogout=calls.filter(call=>call.path==='/api/web/logout').at(-1);assert.notEqual(secondLogout.body.deviceId,firstLogout.body.deviceId);assert.notEqual(secondLogout.body.requestId,firstLogout.body.requestId);assert.equal(jar.getCookieStringSync(origin),'');
  assert.equal(errors.length,0,errors.join(';'));proof.checks.push('lost logout response then new login; per-device logout identity; cookie removed and private UI hidden');
  if(process.env.YENO_WEB_PROOF_PATH)writeFileSync(process.env.YENO_WEB_PROOF_PATH,JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify(proof));
}finally{for(const page of doms)await close(page);core.shutdown();await new Promise(resolve=>setTimeout(resolve,80));rmSync(dataDir,{recursive:true,force:true});}
