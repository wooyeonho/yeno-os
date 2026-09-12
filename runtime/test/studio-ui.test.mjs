import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudioView} from '../public/studio-view.mjs';
import {applyStudioAction,emptyStudio,studioOverview} from '../lib/studio.mjs';
import {validateForAiInput} from '../lib/forai.mjs';
import {validateVideoInput} from '../lib/video.mjs';

// Minimal UI port for request/controller checks. This is not device or layout
// verification; domain writes below use the actual studio validator.
class Element {
  constructor(){this.dataset={};this.classList={add(){},toggle(){}};this.value='';this.elements=[];this.innerHTML='';this.textContent='';this.hidden=false;}
  querySelectorAll(){return [];}
  querySelector(){return null;}
  setAttribute(){}
  scrollIntoView(){}
}
class Root extends Element {
  constructor(){super();this.nodes=new Map();this.handlers={};}
  querySelector(selector){if(!this.nodes.has(selector))this.nodes.set(selector,new Element());return this.nodes.get(selector);}
  addEventListener(event,handler){this.handlers[event]=handler;}
  contains(){return true;}
  click(action,id=''){const button=new Element();button.dataset={studioAction:action,id};button.closest=selector=>selector==='[data-studio-action]'?button:null;this.handlers.click({target:button});}
  tab(id){const button=new Element();button.dataset={studioTab:id};button.closest=selector=>selector==='[data-studio-tab]'?button:null;this.handlers.click({target:button});}
  submit(name,values){const form=new Element();form.dataset={studioForm:name};form.values=values;form.reportValidity=()=>true;form.closest=()=>form;this.handlers.submit({target:form,preventDefault(){}});}
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function storage(){const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key),map};}
function harness({sharedStorage=storage(),loseResponse=false,invalidResponse=false}={}){
  globalThis.sessionStorage=sharedStorage;
  globalThis.FormData=class {constructor(form){this.values=form.values;}*[Symbol.iterator](){yield*Object.entries(this.values);}};
  let studio=emptyStudio(),calls=[],generationCalls=0,lose=loseResponse,invalid=invalidResponse;
  const root=new Root();
  const api=async(path,body)=>{
    if(path==='/api/capabilities')return {capabilities:[{id:'test',name:'<script>unsafe</script>',description:'a&b',status:'working',lastCompletedAt:'2026-09-12T12:00:00.000Z'},{id:'grok-bot',name:'Grok Bot',status:'connection_required',description:'계정 연결 필요'}]};
    if(path==='/api/studio'&&!body)return studioOverview(studio);
    calls.push(structuredClone({path,body}));
    let result;
    if(path==='/api/hankki/invite'||path==='/api/hankki/revoke'){
      const outcome=applyStudioAction(studio,{requestId:body.requestId,action:path.endsWith('/invite')?'checkin.invite':'checkin.revoke',id:body.checkinId,expectedRevision:body.expectedRevision});studio=outcome.studio;result={result:outcome.result,...(path.endsWith('/invite')?{responseUrl:`https://example.com/hankki/answer#id=${body.checkinId}&token=synthetic-recipient-token`}:{})};
    } else if(path==='/api/studio/import'){
      const outcome=applyStudioAction(studio,{requestId:body.requestId,action:'chapter.create',seriesId:body.seriesId,number:body.number,title:body.title,content:'완료된 합성 집필 결과'});studio=outcome.studio;result={result:outcome.result};
    } else if(path==='/api/studio'){
      const outcome=applyStudioAction(studio,body);studio=outcome.studio;result={result:outcome.result};
    } else {if(body.kind==='forai')validateForAiInput(body.input);if(body.kind==='video')validateVideoInput(body.input);generationCalls++;result={job:{id:'job-one',status:'queued'}};}
    if(lose){lose=false;throw new TypeError('Connection lost after acceptance');}
    if(invalid){invalid=false;return {};}
    return result;
  };
  const view=createStudioView({root,api});view.setState({jobs:[],updatedAt:new Date().toISOString()});
  return {root,view,calls,sharedStorage,get studio(){return studio;},get generationCalls(){return generationCalls;},set studio(next){studio=next;},set loseNextResponse(next){lose=next;}};
}

test('studio UI contact consent, novel creation/update and place writes obey actual domain contracts',async()=>{
  const h=harness();await h.view.refresh();
  h.root.submit('contact',{name:'테스트 연락처',relationship:'친구',contactInfo:'',consent:'granted',consentNote:'오늘 통화에서 동의'});await settle();
  assert.equal(h.studio.contacts.length,1);assert.equal(h.studio.contacts[0].consentSource,'owner_report');
  assert.equal(h.calls[0].body.source,undefined);
  h.root.submit('series',{title:'시험 작품',genre:'판타지',premise:'원본 설정',characters:'등장인물',outline:'전개'});await settle();
  assert.equal(h.studio.series.length,1);
  h.root.submit('chapter',{title:'첫 회차',number:'1',content:'첫 원고',notes:''});await settle();
  const first=h.studio.chapters[0];assert.equal(first.content,'첫 원고');
  h.root.click('edit-chapter',first.id);
  h.root.submit('chapter',{title:'첫 회차 수정',number:'1',content:'두 번째 원고',notes:'수정'});await settle();
  assert.equal(h.studio.chapters[0].content,'두 번째 원고');assert.equal(h.studio.chapters[0].history[0].content,'첫 원고');
  assert.equal(h.calls.at(-1).body.seriesId,undefined);
  h.root.submit('place',{title:'공원',address:'주소',note:'장소 기억',url:'https://example.com',latitude:'37.5',longitude:'127.0'});await settle();
  assert.equal(h.studio.places.length,1);assert.deepEqual(h.studio.places[0].coordinates,{latitude:37.5,longitude:127});
});

test('studio UI freezes the edit revision while another device changes the record',async()=>{
  const h=harness();await h.view.refresh();h.root.submit('place',{title:'처음',address:'',note:'',url:'',latitude:'',longitude:''});await settle();
  const first=h.studio.places[0];h.root.click('edit-place',first.id);
  h.studio=applyStudioAction(h.studio,{requestId:'other-device',action:'place.update',id:first.id,expectedRevision:1,title:'다른 기기 수정'}).studio;
  await h.view.refresh();
  h.root.submit('place',{title:'오래된 화면의 수정',address:'',note:'',url:'',latitude:'',longitude:''});await settle();
  assert.equal(h.calls.at(-1).body.expectedRevision,1);
  assert.equal(h.studio.places[0].title,'다른 기기 수정');
  assert.match(h.root.querySelector('.studio-error').textContent,/다른 기기|최신 기록/);
});

test('lost studio response blocks fresh writes and retry retains exact identity and payload',async()=>{
  const h=harness({loseResponse:true});await h.view.refresh();
  h.root.submit('place',{title:'한 번만 저장',address:'',note:'원문',url:'',latitude:'',longitude:''});await settle();
  assert.equal(h.studio.places.length,1);assert.equal(h.sharedStorage.map.size,1);
  h.root.submit('place',{title:'중복 금지',address:'',note:'',url:'',latitude:'',longitude:''});await settle();assert.equal(h.calls.length,1);
  h.root.click('retry');await settle();
  assert.equal(h.studio.places.length,1);assert.equal(h.calls.length,2);assert.deepEqual(h.calls[0],h.calls[1]);assert.equal(h.sharedStorage.map.size,0);
});

test('invalid success body stays unresolved and blocked storage sends nothing',async()=>{
  const h=harness({invalidResponse:true});await h.view.refresh();h.root.submit('place',{title:'접수 확인',address:'',note:'',url:'',latitude:'',longitude:''});await settle();
  assert.equal(h.studio.places.length,1);assert.equal(h.sharedStorage.map.size,1);h.root.click('retry');await settle();assert.equal(h.studio.places.length,1);
  const blocked=harness({sharedStorage:{getItem(){throw new Error('Storage blocked');}}});await blocked.view.refresh();blocked.root.submit('place',{title:'보내면 안 됨'});await settle();assert.equal(blocked.calls.length,0);assert.match(blocked.root.querySelector('.studio-pending p').textContent,/보관할 수 없어/);
});

test('video and For-Ai inputs reach production jobs and display untrusted capability text safely',async()=>{
  const h=harness();await h.view.refresh();
  h.root.submit('video',{title:'실제 영상',heading0:'첫 장면',body0:'영상 문장',seconds0:'5'});await settle();
  assert.deepEqual(h.calls[0].body.input,{title:'실제 영상',scenes:[{heading:'첫 장면',body:'영상 문장',seconds:5}]});assert.equal(h.calls[0].path,'/api/production/run');
  h.root.submit('forai',{mode:'html',content:'<h1>원문</h1>',url:'',name:'브랜드',description:'설명',siteUrl:'https://example.com',author:''});await settle();
  assert.equal(h.calls[1].body.kind,'forai');assert.equal(h.calls[1].body.input.content,'<h1>원문</h1>');
  h.root.tab('capabilities');const html=h.root.querySelector('.studio-pane').innerHTML;
  assert.match(html,/&lt;script&gt;unsafe&lt;\/script&gt;/);assert.match(html,/a&amp;b/);assert.doesNotMatch(html,/<script>/);
  assert.match(html,/마지막 결과 생성/);assert.match(html,/https:\/\/grok\.com\/\?product=grok-bot/);assert.match(html,/https:\/\/play\.google\.com\/store\/apps\/details\?id=ai\.x\.grok\.bot/);
});

test('video bounds and UTF-8 For-Ai limit reject invalid submissions before transport',async()=>{
  const h=harness();await h.view.refresh();h.root.tab('video');
  const html=h.root.querySelector('.studio-pane').innerHTML;
  assert.match(html,/name="title"[^>]*maxlength="60"/);assert.match(html,/name="heading0"[^>]*maxlength="70"/);assert.match(html,/name="body0"[^>]*maxlength="180"/);assert.match(html,/name="seconds0"[^>]*min="2"[^>]*max="10"/);
  const valid={title:'실제 영상',heading0:'첫 장면',body0:'문장',seconds0:'2'};
  for(const change of [{title:'가'.repeat(61)},{heading0:'가'.repeat(71)},{body0:'가'.repeat(181)},{seconds0:'1'},{seconds0:'11'},{seconds0:'2.5'},{body0:'제어\u202e문자'}]){h.root.submit('video',{...valid,...change});await settle();assert.equal(h.calls.length,0);}
  h.root.submit('video',valid);await settle();assert.equal(h.calls.length,1);
  h.root.tab('forai');assert.match(h.root.querySelector('.studio-pane').innerHTML,/UTF-8 기준 64 KiB/);
  h.root.submit('forai',{mode:'text',content:'가'.repeat(21846)});await settle();assert.equal(h.calls.length,1);assert.match(h.root.querySelector('.studio-error').textContent,/64 KiB/);
  h.root.submit('forai',{mode:'text',content:'가'.repeat(21845)});await settle();assert.equal(h.calls.length,2);assert.equal(Buffer.byteLength(h.calls.at(-1).body.input.content),65535);
});

test('series and chapter visible limits match persisted domain and oversized draft stays unsent',async()=>{
  const h=harness();await h.view.refresh();h.root.submit('series',{title:'장편 작품',genre:'장르',premise:'설정',characters:'인물',outline:'줄거리'});await settle();h.root.tab('novels');
  const html=h.root.querySelector('.studio-pane').innerHTML;
  assert.match(html,/name="genre"[^>]*maxlength="160"/);assert.match(html,/name="premise"[^>]*maxlength="12000"/);assert.match(html,/name="characters"[^>]*maxlength="20000"/);assert.match(html,/name="outline"[^>]*maxlength="20000"/);assert.match(html,/name="content"[^>]*maxlength="60000"/);assert.match(html,/name="notes"[^>]*maxlength="10000"/);assert.match(html,/800~1,200자/);
  const count=h.calls.length;h.root.submit('chapter',{title:'첫 회차',number:'1',content:'가'.repeat(60001),notes:''});await settle();assert.equal(h.calls.length,count);assert.match(h.root.querySelector('.studio-error').textContent,/60,000/);
});

test('recipient link issuance and revoke retain request identity without storing the response token',async()=>{
  const h=harness();await h.view.refresh();
  h.root.submit('contact',{name:'답변자',relationship:'친구',contactInfo:'',consent:'granted',consentNote:'오늘 동의 확인'});await settle();
  h.root.submit('checkin',{contactId:h.studio.contacts[0].id,dueAt:new Date(Date.now()+3600000).toISOString(),meal:'dinner',note:''});await settle();
  const id=h.studio.checkins[0].id;h.loseNextResponse=true;h.root.click('hankki-invite',id);await settle();
  assert.equal(h.studio.checkins[0].invitation.status,'active');assert.equal(h.sharedStorage.map.size,1);
  assert.doesNotMatch([...h.sharedStorage.map.values()].join(''),/synthetic-recipient-token/);
  const first=h.calls.at(-1);h.root.click('retry');await settle();assert.deepEqual(h.calls.at(-1),first);assert.equal(h.studio.checkins[0].revision,2);assert.equal(h.sharedStorage.map.size,0);
  h.root.click('hankki-revoke',id);await settle();assert.equal(h.studio.checkins[0].invitation.status,'revoked');assert.equal(h.calls.at(-1).body.expectedRevision,2);
});

test('novel import offers only this series completed agent quest and persisted jobs survive UI reconstruction',async()=>{
  const h=harness();await h.view.refresh();
  h.root.submit('series',{title:'현재 작품',genre:'판타지',premise:'설정',characters:'등장인물',outline:'줄거리'});await settle();
  const seriesId=h.studio.series[0].id;
  const candidate={id:'own-result',type:'agent',questId:'own-quest',studioSeriesId:seriesId,status:'completed',artifacts:[{id:'artifact'}],title:'가져올 원고'};
  const jobs=[candidate,{...candidate,id:'foreign-result',studioSeriesId:'another-series',title:'다른 작품 원고'},{...candidate,id:'unlinked-result',questId:undefined,title:'목표 연결 없는 작업'},{...candidate,id:'document-result',type:'document',title:'일반 문서'},{...candidate,id:'running-result',status:'running',title:'진행 중 원고'},{...candidate,id:'missing-artifact',artifacts:[],title:'결과 파일 없는 작업'}];
  h.view.reset();h.view.setState({jobs});await h.view.refresh();h.root.tab('novels');
  const pane=h.root.querySelector('.studio-pane').innerHTML;
  const options=pane.match(/<select name="jobId">([\s\S]*?)<\/select>/)[1];
  assert.match(options,/own-result/);assert.doesNotMatch(options,/foreign-result|unlinked-result|document-result|running-result|missing-artifact/);
  assert.match(h.root.querySelector('.studio-jobs').innerHTML,/가져올 원고/);
  assert.match(pane,/name="instructions"[^>]*maxlength="1500"/);
  const calls=h.calls.length;
  h.root.submit('import',{jobId:'foreign-result',title:'가져오면 안 됨',number:'1'});await settle();assert.equal(h.calls.length,calls);assert.match(h.root.querySelector('.studio-error').textContent,/이 작품/);
  h.root.submit('generate',{instructions:'가'.repeat(1501)});await settle();assert.equal(h.calls.length,calls);assert.match(h.root.querySelector('.studio-error').textContent,/1,500/);
  h.root.submit('import',{jobId:'own-result',title:'첫 회차',number:'1'});await settle();assert.equal(h.calls.at(-1).path,'/api/studio/import');assert.equal(h.calls.at(-1).body.seriesId,seriesId);assert.equal(h.studio.chapters[0].content,'완료된 합성 집필 결과');
});
