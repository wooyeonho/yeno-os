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
// Toggled mid-test to exercise the offline state without actually tearing
// down the real core (see the network status check below).
const network={offline:false};
class FakeMediaStreamTrack {stop(){this.stopped=true;}}
class FakeMediaStream {getTracks(){return [new FakeMediaStreamTrack()];}}
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
    if(network.offline)throw new Error('simulated offline: network unreachable');
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
  // A fake getUserMedia is enough to make native-live-voice-view.ts's own
  // `supported` check pass, so #live-voice's Home visibility can actually be
  // exercised here - the deeper start()/socket mechanics stay covered by
  // live-voice-native.test.mjs and native-live-voice-view.test.mjs.
  Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async()=>new FakeMediaStream()}});
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

  // Mobile UX (issue #24): Home hierarchy, Live Voice visibility, Home/God
  // Eye/Work navigation, advanced-tools open/close, emergency stop and
  // offline - a fresh pairing so none of this disturbs the coverage above.
  submit('#pair',{origin,pairing:owner,'vault-password':'synthetic-unlock-password'});
  await until(()=>!$('#workspace').hidden&&$('.studio-status').textContent.includes('본체 확인'),'second pairing for mobile UX checks');
  assert.equal($('#workspace').classList.contains('view-studio'),true);
  assert.equal($('#live-voice').hidden,false,'Live Voice must be visible on Home once mediaDevices is available and the device is paired');
  assert.equal($('.tools-drawer').open,false,'advanced tools must start collapsed, not competing with the Home fold');
  click('.tools-drawer summary');
  assert.equal($('.tools-drawer').open,true,'advanced tools must open on tap');
  assert.ok($('.studio-tabs'),'Studio must still actually render inside the opened advanced-tools drawer');
  click('.tools-drawer summary');
  assert.equal($('.tools-drawer').open,false,'advanced tools must close on a second tap');
  // Android system back is represented by popstate once the native view has
  // created a history entry. It must close the drawer first, then return
  // from a secondary surface to Home instead of exiting the app.
  click('.tools-drawer summary');
  assert.equal($('.tools-drawer').open,true,'advanced tools must reopen from the full card');
  dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  assert.equal($('.tools-drawer').open,false,'back must close advanced tools before leaving Home');
  click('[data-native-view="world"]');
  assert.equal($('#workspace').classList.contains('view-world'),true);
  dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  assert.equal($('#workspace').classList.contains('view-studio'),true,'back must return to Home from a secondary surface');
  evidence.checks.push('Android-safe explicit advanced-tools toggle and back navigation: drawer closes first, secondary views return Home');

  click('[data-native-view="world"]');
  assert.equal($('#workspace').classList.contains('view-world'),true);assert.equal($('#tab-world').hidden,false);
  click('[data-native-view="jobs"]');
  assert.equal($('#workspace').classList.contains('view-jobs'),true);assert.equal($('#cockpit').hidden,false);
  click('[data-native-view="studio"]');
  assert.equal($('#workspace').classList.contains('view-studio'),true);
  evidence.checks.push('Home/God Eye/Work navigation switches an explicit view-* class (no :has() dependency, so it does not depend on uncertain Android WebView support)');

  // Emergency stop must also reach the Live Voice toggle, not just the
  // typed-command safety controls. Driven through the real UI/device token
  // (control is device-only; the owner pairing secret is not accepted here).
  click('[data-native-view="jobs"]');click('#stop');
  await until(()=>$('#stop').textContent==='전체 멈춤 해제','emergency stop reflected in UI');
  click('[data-native-view="studio"]');
  assert.equal($('[data-live-toggle]').disabled,true,'emergency stop must disable the Live Voice toggle too');
  click('[data-native-view="jobs"]');click('#stop');
  await until(()=>$('#stop').textContent==='전체 멈춤','emergency resume reflected in UI');
  evidence.checks.push('emergency stop/resume propagates to both the typed-command control and the Live Voice toggle');

  // Offline: a broken network must be shown plainly and must also disable
  // Live Voice, never silently pretend the core is still reachable.
  network.offline=true;
  click('#refresh');
  await until(()=>$('#connection').textContent==='최신 상태 확인 실패','offline reflected in the connection chip');
  click('[data-native-view="studio"]');
  assert.equal($('[data-live-toggle]').disabled,true,'offline must disable the Live Voice toggle too');
  network.offline=false;
  click('#refresh');
  await until(()=>$('#connection').textContent==='코어 응답 확인됨','reconnect after offline clears');
  evidence.checks.push('offline is shown plainly and also disables the Live Voice toggle; clears once reachable again');

  // BLACKHOLE Living Core (FINAL UI Slice 1 correction, issue #25): the
  // shared runtime/public/living-core-view.mjs mounted natively binds to the
  // real embedded core summary from GET /api/state, never a fabricated
  // drive/mission - with no live mission/drive it must say so plainly.
  // Already settled by the refreshes above (every one of them already
  // carried the real core field), so this asserts on the current DOM
  // directly rather than triggering yet another async refresh whose
  // completion nothing here would wait for.
  const livingCoreText=$('#living-core-root').textContent;
  assert.match(livingCoreText,/진행 중인 미션 없음/,'no live mission exists yet, so Home must say so plainly rather than fabricate one');
  assert.match(livingCoreText,/욕망 평가 전/,'no live drive evidence exists yet, so Home must never invent a drive name');
  assert.match(livingCoreText,/블랙홀에게 말하기/,'the native Home must expose the Living Core voice CTA');
  evidence.checks.push('native Home mounts the shared Living Core view, binds to the real embedded Core summary, and states "욕망 평가 전"/"진행 중인 미션 없음" rather than fabricating a drive or mission');

  evidence.ok=true;console.log(JSON.stringify(evidence,null,2));
} finally {dom?.window.close();core.shutdown();rmSync(dataDir,{recursive:true,force:true});}
