// Execute the shipped HTML + Vite bundle against a real temporary core.
// Rust IPC, Stronghold, OS dialogs and the media player are simulated here;
// this verifies UI wiring, not Android installation, encryption or playback.
import {JSDOM} from 'jsdom';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {webcrypto,createHash} from 'node:crypto';
import {start} from '../../runtime/server.mjs';
import {videoAvailability} from '../../runtime/lib/video.mjs';

const dataDir=mkdtempSync(join(tmpdir(),'blackhole-native-ui-'));
const owner='synthetic-ui-owner-credential';
const core=await start({host:'127.0.0.1',port:0,dataDir,token:owner,env:{}});
const origin=`http://127.0.0.1:${core.server.address().port}`;
const html=readFileSync(new URL('./dist/index.html',import.meta.url),'utf8');
const script=html.match(/<script[^>]+src="([^"]+)"/)[1];
const code=readFileSync(new URL(`./dist${script}`,import.meta.url),'utf8');
const vault=new Map(),savedFiles=new Map(),blobUrls=new Map(),callbacks=new Map();
let sequence=0,saveCount=0,dom,local={},activeRequests=new Map(),responses=new Map(),copied='';
const sha=value=>createHash('sha256').update(value).digest('hex');
const until=async(check,label)=>{const deadline=Date.now()+15000;while(!check()){if(Date.now()>deadline)throw new Error(`Timed out: ${label}`);await new Promise(resolve=>setTimeout(resolve,20));}};
const $=selector=>dom.window.document.querySelector(selector);
const submit=(selector,values)=>{const form=$(selector);assert.ok(form,selector);for(const [name,value] of Object.entries(values))form.elements.namedItem(name).value=value;form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));};
const click=selector=>{assert.ok($(selector),selector);$(selector).click();};
const studioTab=async tab=>{click('[data-native-view="studio"]');click(`[data-studio-tab="${tab}"]`);await until(()=>$(`form[data-studio-form="${{places:'place',novels:'series',forai:'forai',video:'video'}[tab]}"]`)&&!$(`form[data-studio-form="${{places:'place',novels:'series',forai:'forai',video:'video'}[tab]}"] button[type=submit]`).disabled,`${tab} form`);};

async function invoke(command,args={},options={}) {
  if(command==='plugin:path|resolve_directory')return '/synthetic-app-data';
  if(command==='plugin:path|join')return args.paths.join('/');
  if(command.startsWith('plugin:stronghold|')) {
    if(command.endsWith('|get_store_record'))return vault.get(args.key)??null;
    if(command.endsWith('|save_store_record'))vault.set(args.key,args.value);
    if(command.endsWith('|remove_store_record'))vault.delete(args.key);
    return null;
  }
  if(command==='plugin:http|fetch'){assert.equal(args.clientConfig.maxRedirections,0);const id=++sequence;activeRequests.set(id,args.clientConfig);return id;}
  if(command==='plugin:http|fetch_send') {
    const c=activeRequests.get(args.rid);assert.equal(new URL(c.url).origin,origin);assert.match(new URL(c.url).pathname,/^\/api\/v1\//);
    const response=await fetch(c.url,{method:c.method,headers:c.headers,...(c.data?{body:new Uint8Array(c.data)}:{}),redirect:'error'});
    responses.set(args.rid,new Uint8Array(await response.arrayBuffer()));
    return {status:response.status,statusText:response.statusText,url:c.url,headers:[...response.headers],rid:args.rid};
  }
  if(command==='plugin:http|fetch_read_body') {
    const body=responses.get(args.rid);args.streamChannel.onmessage(new Uint8Array([...body,0]));args.streamChannel.onmessage(new Uint8Array([1]));
    responses.delete(args.rid);activeRequests.delete(args.rid);return;
  }
  if(command==='plugin:http|fetch_cancel')return;
  if(command==='plugin:dialog|save')return `content://synthetic-picker/${++saveCount}/${args.options.defaultPath}`;
  if(command==='plugin:fs|write_file'){savedFiles.set(decodeURIComponent(options.headers.path),new Uint8Array(args));return;}
  if(command==='plugin:fs|read_file')return new Uint8Array(savedFiles.get(args.path));
  if(command==='plugin:opener|open_url'){assert.match(args.url,/^https:\/\//);return;}
  throw new Error(`Unexpected native IPC: ${command}`);
}
function openDom() {
  const next=new JSDOM(html,{url:'http://tauri.localhost',runScripts:'outside-only',pretendToBeVisual:true});
  const w=next.window;
  for(const [name,value] of Object.entries({TextEncoder,TextDecoder,Request,Response,Headers,ReadableStream,Blob,AbortController,structuredClone}))w[name]=value;
  Object.defineProperty(w,'crypto',{value:webcrypto});
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>{copied=text;}}});
  w.HTMLMediaElement.prototype.pause=function(){};w.HTMLMediaElement.prototype.load=function(){};
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.URL.createObjectURL=blob=>{const url=`blob:synthetic-${++sequence}`;blobUrls.set(url,blob);return url;};w.URL.revokeObjectURL=url=>blobUrls.delete(url);
  w.__TAURI_INTERNALS__={invoke,transformCallback:fn=>{const id=++sequence;callbacks.set(id,fn);return id;},unregisterCallback:id=>callbacks.delete(id),metadata:{}};
  for(const [key,value]of Object.entries(local))w.localStorage.setItem(key,value);
  vm.runInContext(code,next.getInternalVMContext(),{filename:'shipped-native-bundle.js'});
  return next;
}
const evidence={scope:'Built HTML/JS with real local core and simulated native IPC; not Android device verification',checks:[]};
try {
  dom=openDom();assert.equal($('#workspace').hidden,true);
  submit('#pair',{origin,pairing:owner,'vault-password':'synthetic-unlock-password'});
  await until(()=>!$('#workspace').hidden&&$('.studio-status').textContent.includes('본체 확인'),'pair and load studio');
  await studioTab('places');submit('form[data-studio-form="place"]',{title:'화면에서 남긴 장소',address:'직접 입력한 주소',note:'처음 저장한 메모',url:'',latitude:'',longitude:''});
  await until(()=>core.state().revision>0&&$('.studio-pane').textContent.includes('처음 저장한 메모'),'save place');
  assert.equal([...vault.keys()].some(key=>key.startsWith('blackhole.studio.v1:')),false);
  assert.equal(Object.values({...dom.window.localStorage}).some(value=>value.includes('처음 저장한 메모')),false);
  evidence.checks.push('pairing, studio load, place create, encrypted-store adapter receipt clearing');
  await studioTab('novels');submit('form[data-studio-form="series"]',{title:'화면 검증용 작품',genre:'단편',premise:'첫 설정',characters:'주인공',outline:'기록을 찾는다'});
  await until(()=>$('form[data-studio-form="chapter"]')&&!$('form[data-studio-form="chapter"] button[type=submit]').disabled,'chapter form');
  submit('form[data-studio-form="chapter"]',{title:'첫 회차',number:'1',content:'처음부터 끝까지 보존할 원고입니다.',notes:''});
  await until(()=>$('[data-studio-action="export"][data-kind="chapter"]'),'chapter receipt');
  click('[data-studio-action="export"][data-kind="chapter"]');await until(()=>savedFiles.size===1&&$('#message').textContent.includes('확인했습니다'),'export and read back');
  assert.match(new TextDecoder().decode([...savedFiles.values()][0]),/처음부터 끝까지 보존할 원고입니다/);
  evidence.checks.push('series/chapter create, native save dialog adapter, identical file readback');
  await studioTab('forai');submit('form[data-studio-form="forai"]',{mode:'text',content:'연호님의 서비스 소개를 확인할 테스트 본문입니다.',url:'',name:'검증용 서비스',description:'공개 데이터 테스트',siteUrl:'',author:''});
  await until(()=>core.state().jobs.some(job=>job.type==='forai'&&job.status==='completed'),'For-Ai completed');click('[data-native-view="jobs"]');click('#refresh');
  await until(()=>[...dom.window.document.querySelectorAll('.artifact')].some(el=>el.textContent.endsWith('.md')),'artifact button');
  [...dom.window.document.querySelectorAll('.artifact')].find(el=>el.textContent.endsWith('.md')).click();
  await until(()=>!$('#artifact-result').hidden&&$('#artifact-body').textContent.length>0,'verified artifact text');
  click('#copy-artifact');await until(()=>copied.length>0,'copy text');assert.equal(copied,$('#artifact-body').textContent);
  evidence.checks.push('For-Ai real core job, artifact open and checksum, clipboard adapter');
  const video=await videoAvailability();evidence.videoRendererAvailable=video.available;
  if(video.available) {
    await studioTab('video');submit('form[data-studio-form="video"]',{title:'앱 영상 검증',heading0:'실제 MP4 결과',body0:'한글로 만든 짧은 장면입니다.',seconds0:'2'});
    await until(()=>core.state().jobs.some(job=>job.type==='video'&&['completed','failed'].includes(job.status)),'video completion');
    const job=core.state().jobs.find(job=>job.type==='video');assert.equal(job.status,'completed',job.error);click('[data-native-view="jobs"]');click('#refresh');
    await until(()=>[...dom.window.document.querySelectorAll('.artifact')].some(el=>el.textContent.endsWith('.mp4')),'MP4 button');
    [...dom.window.document.querySelectorAll('.artifact')].find(el=>el.textContent.endsWith('.mp4')).click();
    await until(()=>!$('#artifact-video').hidden&&blobUrls.has($('#artifact-video').src),'MP4 source attached');
    const mp4=new Uint8Array(await blobUrls.get($('#artifact-video').src).arrayBuffer());assert.equal(new TextDecoder().decode(mp4.slice(4,8)),'ftyp');
    assert.equal($('#copy-artifact').hidden,true);const prior=savedFiles.size;click('#save-artifact');await until(()=>savedFiles.size===prior+1&&!$('#save-artifact').disabled,'save MP4');
    assert.equal(sha([...savedFiles.values()].at(-1)),sha(mp4));evidence.video={bytes:mp4.length,sha256:sha(mp4),player:'source attached only; playback simulated'};
    evidence.checks.push('real Korean MP4 rendering, video element blob source, identical native-save adapter output');
  }
  click('[data-native-view="world"]');assert.equal($('#tab-world').hidden,false);assert.ok($('#world-layer'));assert.match($('#world-land').getAttribute('href'),/world-land.*\.svg/);
  evidence.checks.push('God Eye tab and bundled map asset');
  local=Object.fromEntries(Object.entries(dom.window.localStorage));dom.window.close();dom=openDom();assert.equal($('#unlock').hidden,false);assert.equal($('#workspace').hidden,true);
  submit('#unlock-form',{'unlock-password':'synthetic-unlock-password'});await until(()=>!$('#workspace').hidden&&$('.studio-status').textContent.includes('본체 확인'),'unlock reloaded UI');
  await studioTab('places');assert.match($('.studio-pane').textContent,/처음 저장한 메모/);
  evidence.checks.push('UI close/reload, vault unlock adapter, same saved place');
  click('[data-native-view="jobs"]');click('#disconnect');await until(()=>$('#workspace').hidden&&!vault.has('connection'),'revoke and forget');
  assert.equal($('#artifact-result').hidden,true);assert.equal($('#artifact-body').textContent,'');
  evidence.checks.push('real server device revocation and cleared local UI');
  evidence.ok=true;console.log(JSON.stringify(evidence,null,2));
} finally {dom?.window.close();core.shutdown();rmSync(dataDir,{recursive:true,force:true});}
