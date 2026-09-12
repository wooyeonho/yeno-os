import test from 'node:test';
import assert from 'node:assert/strict';
import {createResearchView} from '../public/research-view.mjs';

// Small DOM port for controller/receipt checks. This is not layout or device proof.
class Element {
  constructor(){this.dataset={};this.classList={add(){}};this.value='';this.innerHTML='';this.textContent='';this.hidden=false;this.disabled=false;this.nodes=new Map();}
  querySelector(selector){if(!this.nodes.has(selector))this.nodes.set(selector,new Element());return this.nodes.get(selector);}
  querySelectorAll(){return [...this.nodes.values()];}
  reportValidity(){return true;}
}
class Root extends Element {
  constructor(){super();this.handlers={};}
  addEventListener(type,handler){this.handlers[type]=handler;}
  removeEventListener(type,handler){if(this.handlers[type]===handler)delete this.handlers[type];}
  contains(){return true;}
  input(name){return this.querySelector('[data-research-form]').querySelector(`[name="${name}"]`);}
  click(action,id=''){
    const button=this.querySelector(`[data-research-action="${action}"]`);button.dataset={researchAction:action,id};button.closest=()=>button;
    this.handlers.click?.({target:button});
  }
  choose(id){this.input('projectId').value=id;this.handlers.change?.({target:this.input('projectId')});}
  submit(question,query,projectId=this.input('projectId').value){
    this.input('question').value=question;this.input('query').value=query;this.input('projectId').value=projectId;
    const form=this.querySelector('[data-research-form]');form.closest=()=>form;
    this.handlers.submit?.({target:form,preventDefault(){}});
  }
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function storage(){const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key),map};}
const trackId='41fc971a-7f43-4b6d-b3c0-fd4243b43343';
function harness({sharedStorage=storage(),ledger=new Map(),fail=''}={}) {
  const root=new Root(),calls=[],opened=[],created=[],openedJobs=[];
  let failure=fail;
  const overview={tracks:[{code:'E01',projectId:trackId,name:'보존된 연구 트랙',defaultEnglishQuery:'seawater desalination membrane energy',scope:'공개 실험 근거 비교'}],jobs:[],providerReady:true,usage:{attempts:5},dailyCallLimit:20};
  const api=async(path,body)=>{
    if(path==='/api/research')return structuredClone({...overview,jobs:[...ledger.values()].map(result=>result.job)});
    assert.equal(path,'/api/research/run');calls.push(structuredClone({path,body}));
    if(failure==='400'){failure='';throw Object.assign(new Error('영어 검색어를 확인해 주세요.'),{status:400});}
    if(!ledger.has(body.requestId))ledger.set(body.requestId,{job:{id:`job-${ledger.size+1}`,title:body.question,status:'queued',research:{question:body.question,projectId:body.projectId},createdAt:'2026-09-12T17:00:00.000Z',artifacts:[]},quest:{id:`quest-${ledger.size+1}`}});
    if(failure==='lost'){failure='';throw new TypeError('Response lost after acceptance');}
    if(failure==='invalid'){failure='';return {};}
    return structuredClone(ledger.get(body.requestId));
  };
  const view=createResearchView({root,api,storage:sharedStorage,onJobCreated:job=>created.push(job),onOpenJob:job=>openedJobs.push(job.id),onOpenArtifact:id=>opened.push(id)});
  view.setState({online:true,jobs:[]});
  return {root,view,calls,overview,sharedStorage,ledger,created,opened,openedJobs};
}

test('research UI keeps canonical track identity and uses one bounded request contract',async()=>{
  const h=harness();await h.view.refresh();h.root.choose(trackId);
  assert.equal(h.root.input('query').value,'seawater desalination membrane energy');
  assert.equal(h.root.querySelector('.research-scope').textContent,'공개 실험 근거 비교');
  h.root.submit('담수화 에너지 감소 방법을 검증해 줘',h.root.input('query').value);await settle();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.projectId,trackId);assert.equal(h.calls[0].body.provider,'auto');
  assert.deepEqual(Object.keys(h.calls[0].body).sort(),['projectId','provider','query','question','requestId']);
  assert.equal(h.ledger.size,1);assert.equal(h.sharedStorage.map.size,0);assert.equal(h.created.length,1);
  assert.match(h.root.querySelector('.research-jobs').innerHTML,/담수화 에너지 감소/);
  assert.match(h.root.innerHTML,/AI 호출 최대 1회/);
});

test('uncertain research response blocks a fresh question; reopening retries exact original request once',async()=>{
  const sharedStorage=storage(),ledger=new Map(),first=harness({sharedStorage,ledger,fail:'lost'});
  await first.view.refresh();first.root.choose(trackId);first.root.submit('원래 질문','original evidence query');await settle();
  assert.equal(ledger.size,1);assert.equal(sharedStorage.map.size,1);
  assert.equal(first.view.pending.body.question,'원래 질문');
  first.root.submit('새 질문을 자동 실행하지 않음','new query');await settle();assert.equal(first.calls.length,1);
  first.view.destroy();
  const reopened=harness({sharedStorage,ledger});await reopened.view.refresh();
  assert.equal(reopened.root.input('question').value,'원래 질문');assert.equal(reopened.root.input('query').value,'original evidence query');assert.equal(reopened.root.input('projectId').value,trackId);
  reopened.root.click('retry');reopened.root.click('retry');await settle();
  assert.equal(reopened.calls.length,1);assert.deepEqual(reopened.calls[0],first.calls[0]);assert.equal(ledger.size,1);assert.equal(sharedStorage.map.size,0);
});

test('invalid acceptance remains pending, definite validation rejection permits correction, blocked storage never sends',async()=>{
  const invalid=harness({fail:'invalid'});await invalid.view.refresh();invalid.root.submit('원래 질문','evidence');await settle();
  assert.equal(invalid.sharedStorage.map.size,1);invalid.root.click('retry');await settle();assert.equal(invalid.ledger.size,1);assert.equal(invalid.sharedStorage.map.size,0);
  const rejected=harness({fail:'400'});await rejected.view.refresh();rejected.root.submit('질문','query');await settle();
  assert.equal(rejected.sharedStorage.map.size,0);assert.match(rejected.root.querySelector('.research-error').textContent,/영어 검색어/);
  rejected.root.submit('수정한 질문','corrected query');await settle();assert.equal(rejected.ledger.size,1);
  const blocked=harness({sharedStorage:{getItem(){throw new Error('Storage blocked');}}});await blocked.view.refresh();blocked.root.submit('질문','query');await settle();
  assert.equal(blocked.calls.length,0);assert.match(blocked.root.querySelector('.research-pending p').textContent,/보관할 수 없어/);
});

test('missing provider, stop, and budget prevent fresh paid requests but still allow receipt recovery',async()=>{
  const h=harness();h.overview.providerReady=false;await h.view.refresh();assert.equal(h.root.querySelector('[data-research-run]').disabled,true);
  h.root.submit('질문','query');await settle();assert.equal(h.calls.length,0);assert.match(h.root.querySelector('.research-status').textContent,/AI 연결/);
  h.overview.providerReady=true;h.overview.usage.attempts=20;await h.view.refresh();h.root.submit('질문','query');await settle();assert.equal(h.calls.length,0);assert.match(h.root.querySelector('.research-status').textContent,/한도/);
  h.overview.usage.attempts=5;await h.view.refresh();h.view.updateState({online:true,emergencyStop:true,jobs:[]});h.root.submit('질문','query');await settle();assert.equal(h.calls.length,0);
  const pending=harness({fail:'lost'});await pending.view.refresh();pending.root.submit('한 번 접수한 질문','evidence');await settle();pending.overview.providerReady=false;pending.overview.usage.attempts=20;pending.view.updateState({online:true,emergencyStop:true,jobs:[]});await pending.view.refresh();
  assert.equal(pending.root.querySelector('[data-research-action="retry"]').disabled,false);pending.root.click('retry');await settle();assert.equal(pending.ledger.size,1);assert.equal(pending.sharedStorage.map.size,0);
});

test('refresh and job updates preserve typed drafts, expose saved artifacts and escape all result text',async()=>{
  const h=harness();h.overview.tracks[0].name='<script>track()</script>';await h.view.refresh();
  h.root.input('question').value='작성 중인 질문';h.root.input('query').value='draft evidence';
  await h.view.refresh();assert.equal(h.root.input('question').value,'작성 중인 질문');assert.equal(h.root.input('query').value,'draft evidence');
  assert.match(h.root.input('projectId').innerHTML,/&lt;script&gt;track/);assert.doesNotMatch(h.root.input('projectId').innerHTML,/<script>/);
  const job={id:'saved-research',status:'completed',createdAt:'2026-09-12T17:00:00.000Z',research:{question:'<img src=x onerror=alert(1)>',trackCode:'E01'},artifacts:[{id:'report-id',name:'<script>result</script>.md'}]};
  h.view.updateState({online:true,jobs:[job]});const html=h.root.querySelector('.research-jobs').innerHTML;
  assert.match(html,/연구 초안 완료/);assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;result/);assert.doesNotMatch(html,/<script>|<img /);assert.equal(h.root.input('question').value,'작성 중인 질문');
  h.root.click('open-artifact','report-id');await settle();assert.deepEqual(h.opened,['report-id']);h.root.click('open-artifact','foreign-result');await settle();assert.deepEqual(h.opened,['report-id']);
  h.root.click('open-job','saved-research');assert.deepEqual(h.openedJobs,['saved-research']);assert.equal(h.created.length,0);
  h.view.updateState({online:true,jobs:[{...job,status:'failed',error:'<script>failed()</script>',artifacts:[]}]});assert.match(h.root.querySelector('.research-jobs').innerHTML,/실패 · 검증된 답안 없음/);assert.match(h.root.querySelector('.research-jobs').innerHTML,/&lt;script&gt;failed/);
});

test('input bounds reject unsupported tracks and missing English query without sending',async()=>{
  const h=harness();await h.view.refresh();
  for(const [question,query,project] of [['','query',''],['가'.repeat(2001),'query',''],['질문','',''],['질문','한글 검색어',''],['질문','a'.repeat(301),''],['질문','query','unknown-project']]){h.root.submit(question,query,project);await settle();assert.equal(h.calls.length,0);}
  h.root.submit('일반 문제','general problem evidence','');await settle();assert.equal(h.calls[0].body.projectId,null);
});

test('destroy invalidates in-flight reads and removes all listeners',async()=>{
  let resolve;const root=new Root(),view=createResearchView({root,storage:storage(),api:()=>new Promise(done=>resolve=done)});
  view.setState({online:true,jobs:[]});const refresh=view.refresh();view.destroy();resolve({tracks:[],jobs:[],providerReady:true,usage:{attempts:0},dailyCallLimit:20});await refresh;
  assert.equal(root.innerHTML,'');assert.deepEqual(root.handlers,{});
});
