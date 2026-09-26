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
let holdAgent=false,releaseAgent;
const agentGate=new Promise(resolve=>{releaseAgent=resolve;});
const coreOptions={host:'127.0.0.1',port:0,dataDir,token:owner,env:{YENO_ALLOWED_HOSTS:'acceptance.example.ts.net:9443',YENO_AGENT_PROVIDER:'local',YENO_LOCAL_MODEL:'acceptance-model',YENO_AGENT_DAILY_CALL_LIMIT:'4'},agentFetch:async()=>{if(holdAgent)await agentGate;throw new Error('controlled local provider failure');}};
let core=await start(coreOptions);
const origin=`http://127.0.0.1:${core.server.address().port}`;
const html=readFileSync(new URL('./dist/index.html',import.meta.url),'utf8');
const script=html.match(/<script[^>]+src="([^"]+)"/)[1];
const code=readFileSync(new URL(`./dist${script}`,import.meta.url),'utf8');
const vault=new Map(),savedFiles=new Map(),blobUrls=new Map(),callbacks=new Map();
const uiIntervals=new WeakMap();
let sequence=0,saveCount=0,dom,local={},activeRequests=new Map(),responses=new Map(),copied='';
// Toggled mid-test to exercise the offline state without actually tearing
// down the real core (see the network status check below).
const network={offline:false,dropCommandReplyOnce:false};
class FakeMediaStreamTrack {stop(){this.stopped=true;}}
class FakeMediaStream {getTracks(){return [new FakeMediaStreamTrack()];}}
const sha=value=>createHash('sha256').update(value).digest('hex');
const until=async(check,label)=>{const deadline=Date.now()+15000;while(!check()){if(Date.now()>deadline)throw new Error(`Timed out: ${label}`);await new Promise(resolve=>setTimeout(resolve,20));}};
const $=selector=>dom.window.document.querySelector(selector);
const submit=(selector,values)=>{const form=$(selector);assert.ok(form,selector);for(const [name,value] of Object.entries(values))form.elements.namedItem(name).value=value;form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));};
const click=selector=>{assert.ok($(selector),selector);$(selector).click();};
const studioTab=async tab=>{click('[data-native-view="studio"]');click(`[data-studio-tab="${tab}"]`);await until(()=>$(`form[data-studio-form="${{places:'place',novels:'series',forai:'forai',video:'video'}[tab]}"]`)&&!$(`form[data-studio-form="${{places:'place',novels:'series',forai:'forai',video:'video'}[tab]}"] button[type=submit]`).disabled,`${tab} form`);};

async function invoke(command,args={},options={}) {
  if(command==='local_resident_origin')return origin;
  if(command==='enroll_local_resident'){
    assert.equal(args.expectedOrigin,origin);
    const response=await fetch(origin+'/api/v1/devices/enroll',{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json',origin:'http://tauri.localhost'},body:JSON.stringify({requestId:args.requestId,name:'Windows UI acceptance',platform:'windows'})});
    assert.equal(response.status,201);
    const {device}=await response.json();return {origin,deviceId:device.id,token:device.deviceToken};
  }
  if(command==='plugin:barcode-scanner|scan'){
    const reply=await fetch(origin+'/api/v1/pairing/invites',{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify({requestId:webcrypto.randomUUID()})});
    assert.equal(reply.status,201);
    return {content:JSON.stringify({version:1,...(await reply.json()).invitation}),format:'QR_CODE',bounds:null};
  }
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
    const c=activeRequests.get(args.rid);assert.ok(['https://acceptance.example.ts.net:9443',origin].includes(new URL(c.url).origin));assert.match(new URL(c.url).pathname,/^\/api\/v1\//);
    if(network.offline)throw new Error('simulated offline: network unreachable');
    const response=await fetch(origin+new URL(c.url).pathname+new URL(c.url).search,{method:c.method,headers:c.headers,...(c.data?{body:new Uint8Array(c.data)}:{}),redirect:'error'});
    responses.set(args.rid,new Uint8Array(await response.arrayBuffer()));
    if(network.dropCommandReplyOnce&&new URL(c.url).pathname==='/api/v1/commands'){
      network.dropCommandReplyOnce=false;responses.delete(args.rid);activeRequests.delete(args.rid);
      throw new Error('simulated response loss after core acceptance');
    }
    return {status:response.status,statusText:response.statusText,url:c.url,headers:[...response.headers],rid:args.rid};
  }
  if(command==='plugin:http|fetch_read_body') {
    const body=responses.get(args.rid);args.streamChannel.onmessage(new Uint8Array([...body,0]));args.streamChannel.onmessage(new Uint8Array([1]));
    responses.delete(args.rid);activeRequests.delete(args.rid);return;
  }
  if(command==='plugin:http|fetch_cancel'){activeRequests.delete(args.rid);responses.delete(args.rid);return;}
  if(command==='plugin:dialog|save')return `content://synthetic-picker/${++saveCount}/${args.options.defaultPath}`;
  if(command==='plugin:fs|write_file'){savedFiles.set(decodeURIComponent(options.headers.path),new Uint8Array(args));return;}
  if(command==='plugin:fs|read_file')return new Uint8Array(savedFiles.get(args.path));
  if(command==='plugin:opener|open_url'){assert.match(args.url,/^https:\/\//);return;}
  throw new Error(`Unexpected native IPC: ${command}`);
}
function openDom() {
  const next=new JSDOM(html,{url:'http://tauri.localhost',runScripts:'outside-only',pretendToBeVisual:true});
  const w=next.window;
  const nativeSetInterval=w.setInterval.bind(w),intervals=[];
  w.setInterval=(...args)=>{const id=nativeSetInterval(...args);intervals.push(id);return id;};
  uiIntervals.set(next,intervals);
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
function retireDom() {
  for(const id of uiIntervals.get(dom)??[])dom.window.clearInterval(id);
  // Keep the old jsdom document alive for any read-only /state request that
  // already entered the synthetic IPC adapter. Closing it first makes an
  // in-flight refresh render against an undefined document; the old view is
  // inert once its polling interval is cleared.
}
const evidence={scope:'Built HTML/JS with real local core and simulated native IPC; not Android device verification',checks:[]};
try {
  dom=openDom();assert.equal($('#workspace').hidden,true);
  click('#scan-invitation');await until(()=>$('#origin').value==='https://acceptance.example.ts.net:9443','private invitation scanned');
  submit('#pair',{'vault-password':'synthetic-unlock-password'});
  await until(()=>!$('#workspace').hidden&&$('.studio-status').textContent.includes('본체 확인'),'pair and load studio');
  const phoneRequest='문서 만들어: BLACKHOLE Android 화면 요청·결과 복구 검증';
  click('[data-native-view="jobs"]');
  submit('#command',{text:phoneRequest});
  await until(()=>core.state().jobs.some(job=>job.type==='document'&&job.status==='completed'),'Android-paired document job completion');
  const phoneJob=core.state().jobs.find(job=>job.type==='document');
  assert.ok(phoneJob?.artifacts?.length,'completed phone request must have an artifact');
  click('#refresh');
  await until(()=>$('#jobs').textContent.includes(phoneJob.title)&&$('#jobs').textContent.includes('완료'),'completed phone request in app');
  const phoneCard=[...dom.window.document.querySelectorAll('#jobs .job')].find(card=>card.textContent.includes(phoneJob.title));
  assert.ok(phoneCard,'the Android-paired app must show the same server job');
  phoneCard.querySelector('button.artifact').click();
  await until(()=>!$('#artifact-result').hidden&&$('#artifact-meta').textContent.includes('SHA-256 확인됨'),'verified phone-request artifact');
  const phoneArtifactMeta=$('#artifact-meta').textContent;
  assert.match($('#artifact-body').textContent,/BLACKHOLE Android 화면 요청·결과 복구 검증/);
  evidence.checks.push('Android-paired typed request reaches real core; completed job and SHA-checked artifact appear in app');
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
  const uncertainRequest='문서 만들어: BLACKHOLE 응답 유실 후 동일 요청 복구 검증';
  const beforeUncertain=new Set(core.state().jobs.map(job=>job.id));
  click('[data-native-view="jobs"]');network.dropCommandReplyOnce=true;
  submit('#command',{text:uncertainRequest});
  await until(()=>core.state().jobs.some(job=>!beforeUncertain.has(job.id)&&job.status==='completed'),'accepted work behind lost response');
  const uncertainJob=core.state().jobs.find(job=>!beforeUncertain.has(job.id));
  assert.notEqual(phoneJob.title,uncertainJob.title,'two phone requests must be distinguishable in the job list');
  assert.match(phoneJob.title,/Android 화면 요청·결과 복구 검증/);
  assert.match(uncertainJob.title,/응답 유실 후 동일 요청 복구 검증/);
  click('#refresh');
  await until(()=>$('#jobs').textContent.includes(phoneJob.title)&&$('#jobs').textContent.includes(uncertainJob.title),'distinct phone requests visible together');
  await until(()=>$('#pending').textContent.includes(uncertainRequest)&&!$('#retry-command').hidden,'uncertain command retained for retry');
  assert.equal(core.state().jobs.filter(job=>job.id===uncertainJob.id).length,1);
  evidence.checks.push('accepted core work with lost HTTP reply remains pending in app with original request identity');
  const closed=new Promise(resolve=>core.server.once('close',resolve));
  core.shutdown();await closed;
  click('#refresh');
  await until(()=>$('#connection').textContent==='최신 상태 확인 실패','actual stopped core shown as offline');
  assert.notEqual($('#connection').textContent,'코어 응답 확인됨');
  core=await start({...coreOptions,port:Number(new URL(origin).port)});
  const recoveredJob=core.state().jobs.find(job=>job.id===phoneJob.id);
  assert.equal(recoveredJob?.status,'completed');
  assert.equal(recoveredJob.artifacts[0].id,phoneJob.artifacts[0].id);
  assert.equal(core.state().jobs.find(job=>job.id===uncertainJob.id)?.status,'completed');
  click('#refresh');
  await until(()=>$('#connection').textContent==='코어 응답 확인됨'&&$('#jobs').textContent.includes(phoneJob.title),'actual restarted core reconnected in app');
  evidence.checks.push('actual core stop displays offline, actual same-port restart reconnects without re-pairing');
  local=Object.fromEntries(Object.entries(dom.window.localStorage));retireDom();
  dom=openDom();assert.equal($('#unlock').hidden,false);assert.equal($('#workspace').hidden,true);
  submit('#unlock-form',{'unlock-password':'synthetic-unlock-password'});await until(()=>!$('#workspace').hidden&&$('.studio-status').textContent.includes('본체 확인'),'unlock reloaded UI');
  assert.match($('#pending').textContent,/BLACKHOLE 응답 유실 후 동일 요청 복구 검증/);
  click('#retry-command');
  await until(()=>$('#pending').textContent===''&&$('#receipt-meta').textContent.includes(uncertainRequest),'same command receipt after retry');
  assert.equal(core.state().jobs.filter(job=>job.type==='document').length,2,'retry must not create another document job');
  evidence.checks.push('app reload and core runtime restart after accepted-but-lost reply recover exact pending request without a duplicate job');
  click('[data-native-view="jobs"]');
  await until(()=>$('#jobs').textContent.includes(phoneJob.title),'same phone request after app reload');
  const restoredCard=[...dom.window.document.querySelectorAll('#jobs .job')].find(card=>card.textContent.includes(phoneJob.title));
  assert.ok(restoredCard,'the original phone request must be individually identifiable after reload');
  restoredCard.querySelector('button.artifact').click();
  await until(()=>!$('#artifact-result').hidden&&$('#artifact-meta').textContent.includes('SHA-256 확인됨'),'same artifact after app reload');
  assert.equal($('#artifact-meta').textContent,phoneArtifactMeta);
  assert.match($('#artifact-body').textContent,/BLACKHOLE Android 화면 요청·결과 복구 검증/);
  evidence.checks.push('core runtime restart plus UI close/reload and vault unlock restore the same phone-request job and SHA-checked artifact');
  await studioTab('places');assert.match($('.studio-pane').textContent,/처음 저장한 메모/);
  evidence.checks.push('UI close/reload, vault unlock adapter, same saved place');
  click('[data-native-view="jobs"]');click('#disconnect');await until(()=>$('#workspace').hidden&&!vault.has('connection'),'revoke and forget');
  assert.equal($('#artifact-result').hidden,true);assert.equal($('#artifact-body').textContent,'');
  evidence.checks.push('real server device revocation and cleared local UI');

  // Mobile UX (issue #24): Home hierarchy, Live Voice visibility, Home/God
  // Eye/Work navigation, advanced-tools open/close, emergency stop and
  // offline - a fresh pairing so none of this disturbs the coverage above.
  click('#scan-invitation');await until(()=>$('#origin').value==='https://acceptance.example.ts.net:9443','private invitation scanned');
  submit('#pair',{'vault-password':'synthetic-unlock-password'});
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

  click('[data-native-view="jobs"]');click('#disconnect');
  await until(()=>$('#workspace').hidden&&!vault.has('connection'),'disconnect before local Windows enrollment');
  await until(()=>!$('#connect-local').hidden,'local owner entry available');click('#connect-local');
  assert.equal($('#origin').value,origin);
  submit('#pair',{'vault-password':'synthetic-unlock-password'});
  await until(()=>!$('#workspace').hidden&&$('.studio-status').textContent.includes('본체 확인'),'Windows local enrollment');
  assert.equal(Object.values({...dom.window.localStorage}).some(value=>value.includes(owner)),false);
  evidence.checks.push('Windows local enrollment UI uses scoped native result and loads the same real core; no owner key input/storage');
  const settings=await fetch(origin+'/api/settings',{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify({requestId:webcrypto.randomUUID(),modules:{ai:true}})});
  assert.equal(settings.status,200);
  click('[data-native-view="jobs"]');
  holdAgent=true;
  submit('#command',{text:'자율 임무: 설정되지 않은 모델의 실패 표시를 확인해줘.'});
  await until(()=>core.state().jobs.some(job=>job.type==='agent'&&job.status==='running'),'controlled agent job running on core');
  const running=core.state().jobs.find(job=>job.type==='agent'&&job.status==='running');
  click('#refresh');
  await until(()=>[...dom.window.document.querySelectorAll('#jobs .job')].some(card=>card.textContent.includes(running.title)&&card.textContent.includes('진행 중')),'same running job shown on app');
  const runningCard=[...dom.window.document.querySelectorAll('#jobs .job')].find(card=>card.textContent.includes(running.title));
  assert.doesNotMatch(runningCard.textContent,/완료 ·/);
  evidence.checks.push('real core running job is visibly in progress on the paired app before its controlled failure');
  releaseAgent();
  await until(()=>core.state().jobs.some(job=>job.type==='agent'&&job.status==='failed'),'controlled missing-provider failure');
  const failed=core.state().jobs.find(job=>job.type==='agent'&&job.status==='failed');
  click('#refresh');
  await until(()=>$('#jobs').textContent.includes(failed.error)&&$('#jobs').textContent.includes('자동 재실행하지 않습니다'),'failure reason and retry scope');
  const failedCard=[...dom.window.document.querySelectorAll('#jobs .job')].find(card=>card.textContent.includes(failed.title));
  assert.match(failedCard.textContent,/실패/);
  assert.equal(failedCard.textContent.includes('완료 ·'),false);
  evidence.checks.push('controlled real job failure displays server reason and manual new-request guidance, never success or automatic retry');
  evidence.ok=true;console.log(JSON.stringify(evidence,null,2));
} finally {if(dom)retireDom();core.shutdown();rmSync(dataDir,{recursive:true,force:true});}
