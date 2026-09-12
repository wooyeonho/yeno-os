import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createAutopilotView} from '../public/autopilot-view.mjs';

const require=createRequire(new URL('../../apps/controller/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const job={id:'research-1',title:'저장한 Long COVID 근거',status:'completed',createdAt:'2026-09-12T19:00:00Z',updatedAt:'2026-09-12T19:01:00Z',autopilot:{code:'E02'},artifacts:[{id:'answer-1',name:'검증할-답안.md'}]};
function fixture(overrides={}) {
  return {online:true,emergencyStop:false,jobs:[structuredClone(job)],autopilot:{enabled:true,dailyAiLimit:4,aiUsedToday:1,globalLimit:20,globalUsedToday:7,activeJobId:null,nextAt:'2026-09-13T01:00:00Z',summary:'세계 현황과 연구를 이어갑니다.',tracks:Array.from({length:9},(_,index)=>({code:`E0${index+1}`,name:`연구 ${index+1}`,phase:'research',status:'waiting',reason:'다음 근거 수집 대기',lastJobId:index===1?job.id:null})),blockers:[{id:'grok',title:'Grok Bot 제품',reason:'제품 계정 연결이 필요합니다.'}],recentJobs:[job.id],lastError:null},...overrides};
}
function harness({onControl=async()=>{}}={}) {
  const dom=new JSDOM('<main id="root"></main>'),root=dom.window.document.getElementById('root');
  const controls=[],openedJobs=[],openedArtifacts=[],notices=[];
  const view=createAutopilotView({root,onControl:async enabled=>{controls.push(enabled);return onControl(enabled);},onOpenJob:job=>openedJobs.push(job.id),onOpenArtifact:id=>openedArtifacts.push(id),notify:message=>notices.push(message)});
  const button=(action,id)=>[...root.querySelectorAll(`[data-autopilot-action="${action}"]`)].find(item=>id===undefined||item.dataset.id===id);
  return {dom,root,view,controls,openedJobs,openedArtifacts,notices,button,close(){view.destroy();dom.window.close();}};
}

test('automatic operation shows server work, all research tracks, real result actions and shared budget',async()=>{
  const h=harness();h.view.updateState(fixture());
  assert.match(h.root.querySelector('.autopilot-status').textContent,/자동 운영 중/);
  assert.equal(h.root.querySelectorAll('.autopilot-tracks article').length,9);
  assert.match(h.root.textContent,/1 \/ 4회/);assert.match(h.root.textContent,/7 \/ 20회/);
  assert.match(h.root.textContent,/Grok Bot 제품/);assert.match(h.root.textContent,/제품 계정 연결/);
  assert.match(h.root.textContent,/연구 결과는 검증할 초안/);assert.match(h.root.textContent,/자막 MP4/);
  h.button('open-job',job.id).click();h.button('open-artifact','answer-1').click();await settle();
  assert.deepEqual(h.openedJobs,[job.id]);assert.deepEqual(h.openedArtifacts,['answer-1']);
  const revised=fixture();revised.autopilot.globalLimit=12;
  for(let index=0;index<3;index++)revised.autopilot.tracks[index].phase=index;
  revised.autopilot.tracks[2].status='validation';revised.autopilot.tracks[3].phase='forai';h.view.updateState(revised);
  const cards=[...h.root.querySelectorAll('.autopilot-tracks article')];
  assert.match(cards[0].textContent,/근거 수집/);assert.match(cards[1].textContent,/반증 검토/);assert.match(cards[2].textContent,/재현 계획/);
  assert.match(cards[2].textContent,/실제 검증자료 대기/);assert.match(cards[3].textContent,/내부 연구 페이지 점검/);
  assert.match(h.root.textContent,/전체 하루 12회 한도/);assert.doesNotMatch(h.root.textContent,/전체 하루 20회 한도/);
  assert.deepEqual(h.controls,[]);h.close();
});

test('control waits for a fresh confirmed server state and cannot enqueue duplicates',async()=>{
  const request=deferred(),h=harness({onControl:()=>request.promise});
  const initial=fixture();initial.autopilot.enabled=false;h.view.updateState(initial);
  h.button('control').click();h.button('control').click();assert.deepEqual(h.controls,[true]);
  assert.equal(h.button('control').disabled,true);assert.equal(h.button('control').textContent,'자동 운영 시작');
  assert.match(h.root.querySelector('.autopilot-status').textContent,/자동 운영 멈춤/);
  request.resolve();await settle();
  assert.equal(h.button('control').disabled,true);assert.match(h.root.querySelector('.autopilot-control-status').textContent,/변경된 상태/);
  h.view.updateState(fixture());assert.equal(h.button('control').disabled,false);assert.equal(h.button('control').textContent,'자동 운영 멈춤');
  h.button('control').click();await settle();assert.deepEqual(h.controls,[true,false]);
  assert.match(h.root.querySelector('.autopilot-status').textContent,/자동 운영 중/);
  const stopped=fixture();stopped.autopilot.enabled=false;h.view.updateState(stopped);
  assert.equal(h.button('control').textContent,'자동 운영 시작');assert.equal(h.button('control').disabled,false);h.close();
});

test('failed control displays failure and preserves server state; reset discards a late private response',async()=>{
  let request=deferred();const h=harness({onControl:()=>request.promise});h.view.updateState(fixture());
  h.button('control').click();request.reject(new Error('요청을 저장하지 못했습니다.'));await settle();
  assert.equal(h.button('control').disabled,false);assert.equal(h.button('control').textContent,'자동 운영 멈춤');
  assert.match(h.root.querySelector('.autopilot-error').textContent,/저장하지 못했습니다/);assert.equal(h.notices.length,1);
  request=deferred();h.button('control').click();h.view.reset();request.reject(new Error('지난 계정의 비공개 오류'));await settle();
  assert.equal(h.notices.length,1);assert.doesNotMatch(h.root.textContent,/지난 계정|Long COVID/);
  assert.equal(h.button('control').disabled,true);h.close();
});

test('disconnect disables every action, and logout between click and callback prevents private file access',async()=>{
  const h=harness();h.view.updateState(fixture({online:false}));
  assert.ok([...h.root.querySelectorAll('button')].every(button=>button.disabled));
  for(const button of h.root.querySelectorAll('button'))button.click();await settle();
  assert.deepEqual(h.controls,[]);assert.deepEqual(h.openedJobs,[]);assert.deepEqual(h.openedArtifacts,[]);
  h.view.updateState(fixture());h.button('open-artifact','answer-1').click();h.view.reset();await settle();
  assert.deepEqual(h.openedArtifacts,[]);
  const stopped=fixture({emergencyStop:true});stopped.autopilot.enabled=false;h.view.updateState(stopped);
  assert.equal(h.button('control').disabled,true);assert.match(h.root.querySelector('.autopilot-status').textContent,/전체 멈춤/);h.close();
});

test('server strings are text and forged result IDs cannot access unrelated jobs or unfinished files',async()=>{
  const h=harness(),state=fixture(),attack='<img src=x onerror="globalThis.stolen=1">';
  state.autopilot.summary=attack;state.autopilot.tracks[0].name=attack;state.autopilot.tracks[0].phase=attack;state.autopilot.tracks[0].reason=attack;
  state.autopilot.blockers[0].title=attack;state.autopilot.blockers[0].reason=attack;state.autopilot.lastError=attack;
  state.jobs[0].title=attack;state.jobs[0].artifacts[0].name=attack;
  state.jobs.push({id:'foreign-job',status:'completed',artifacts:[{id:'foreign-file',name:'private.md'}]},{id:'unfinished-job',status:'failed',autopilot:{code:'E04'},artifacts:[{id:'unfinished-file',name:'partial.md'}]});
  h.view.updateState(state);
  assert.equal(h.root.querySelector('img,script'),null);assert.match(h.root.textContent,/globalThis.stolen/);
  for(const [action,id] of [['open-job','foreign-job'],['open-artifact','foreign-file'],['open-artifact','unfinished-file']]){
    const forged=h.dom.window.document.createElement('button');forged.dataset.autopilotAction=action;forged.dataset.id=id;h.root.append(forged);forged.click();
  }
  await settle();assert.deepEqual(h.openedJobs,[]);assert.deepEqual(h.openedArtifacts,[]);h.close();
});

test('current actual job and errors update without retaining replaced click handlers',async()=>{
  const h=harness(),state=fixture();state.autopilot.activeJobId=job.id;state.jobs[0].status='running';
  h.view.updateState(state);assert.match(h.root.querySelector('.autopilot-current').textContent,/진행 중/);
  assert.equal(h.root.querySelectorAll('[data-autopilot-action="open-artifact"]').length,0);
  for(let index=0;index<5;index++)h.view.updateState(fixture());
  h.button('open-artifact','answer-1').click();await settle();assert.deepEqual(h.openedArtifacts,['answer-1']);
  h.view.destroy();assert.equal(h.root.innerHTML,'');h.view.updateState(fixture());assert.equal(h.root.innerHTML,'');h.dom.window.close();
});
