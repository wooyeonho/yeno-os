// growth-view.mjs is one mobile screen meant to answer, at a glance: what is
// running, why Homunculus picked it, what Kirby has grown into and its real
// grade, what needs the owner's attention, and the ledger. These are pure
// jsdom unit tests of that display module (matching the existing
// *-ui.test.mjs convention) - a real physical phone/browser viewport is not
// reproducible in this container, so instead we assert the module never
// hardcodes a fixed pixel width (the one thing that would actually break a
// narrow screen) and renders correctly from data shapes matching the real
// /api/state and /api/quests responses.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createGrowthView} from '../public/growth-view.mjs';
import {start} from '../server.mjs';
const {JSDOM}=createRequire(new URL('../../apps/controller/package.json',import.meta.url))('jsdom');

function memoryStorage() {
  const map=new Map();
  return {getItem:key=>map.has(key)?map.get(key):null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};
}
function fixtureState(overrides={}) {
  return {
    emergencyStop:false,
    growth:{capabilities:{skills:[
      {id:'evidence-gap-brief',grade:'C',nextGrade:'B',blockedReason:'복구(롤백 이후 실제 실행 재개) 기록이 없습니다.',evidence:{runCount:2,distinctInputCount:2,rollbackCount:0}},
      {id:'failure-triage',grade:'E',nextGrade:'D',blockedReason:'활성화된(시험을 통과한) 버전이 없습니다.',evidence:{runCount:0,distinctInputCount:0,rollbackCount:0}},
    ]},code:{skills:[
      {id:'demo-code',grade:'D',nextGrade:'C',blockedReason:'서로 다른 입력 2건 이상에서 실행된 기록이 없습니다.',evidence:{runCount:1,distinctInputCount:1,rollbackCount:0}},
    ]}},
    autopilot:{capabilities:[
      {id:'evidence-gap-brief',name:'연구 근거 공백 정리'},
      {id:'failure-triage',name:'실패 원인 점검표'},
    ]},
    codeWorkshop:{entries:[{id:'demo-code',name:'수요 예측 코드 기능'}]},
    ...overrides,
  };
}
function fixtureQuestData(overrides={}) {
  return {
    drives:[
      {id:'gluttony',name:'폭식',label:'폭식',description:'목표에 부족한 능력을 찾습니다.',total:2,completed:1},
      {id:'sloth',name:'나태',label:'나태',description:'개입을 줄입니다.',total:1,completed:0},
    ],
    decision:{at:'2026-09-15T00:00:00.000Z',top:{questId:'q-1',goal:'근거 공백을 확인한다',successCriterion:'근거가 부족한 항목을 정리한다.',motivation:{dominantDrives:['gluttony'],score:12}}},
    quests:[{id:'q-1',goal:'근거 공백을 확인한다',successCriterion:'근거가 부족한 항목을 정리한다.',status:'running',pauseReason:null}],
    ledgers:{wealth:{selfReported:0,records:[]},honor:{selfReported:1,records:[{summary:'실제 확인된 성과','value':1,unit:'건',createdAt:'2026-09-15T00:00:00.000Z'}]},fame:{selfReported:0,records:[]}},
    ...overrides,
  };
}
function setup({storage=memoryStorage()}={}) {
  const dom=new JSDOM('<main></main>'),root=dom.window.document.querySelector('main');
  const navigated=[];
  const view=createGrowthView({root,storage,onNavigate:id=>navigated.push(id)});
  return {dom,root,view,navigated,close(){view.destroy();dom.window.close();}};
}

test('shows the real current quest, its success criterion and never invents one when none is running',()=>{
  const h=setup();
  h.view.updateState(fixtureState(),fixtureQuestData());
  assert.match(h.root.textContent,/근거 공백을 확인한다/);
  assert.match(h.root.textContent,/근거가 부족한 항목을 정리한다/);
  h.view.updateState(fixtureState(),fixtureQuestData({decision:null,quests:[]}));
  assert.match(h.root.textContent,/실행 중인 목표가 없습니다/);
  assert.doesNotMatch(h.root.textContent,/근거 공백을 확인한다/);
  h.close();
});

test('Homunculus reasoning names the real dominant drive and never fabricates one without a decision',()=>{
  const h=setup();
  h.view.updateState(fixtureState(),fixtureQuestData());
  assert.match(h.root.textContent,/폭식/);
  assert.match(h.root.querySelector('.cockpit-decision').textContent,/근거 공백을 확인한다/);
  assert.match(h.root.textContent,/1 \/ 2개 완료/); // real per-drive counts, not a fabricated percentage
  h.close();
});

test('Kirby skills render with real names resolved from the capability/code catalogs and honest blocked reasons',()=>{
  const h=setup();
  h.view.updateState(fixtureState(),fixtureQuestData());
  assert.match(h.root.textContent,/연구 근거 공백 정리/);
  assert.match(h.root.textContent,/수요 예측 코드 기능/);
  assert.match(h.root.textContent,/복구\(롤백 이후 실제 실행 재개\) 기록이 없습니다/);
  const cards=[...h.root.querySelectorAll('.cockpit-cap-card')];
  assert.equal(cards[0].querySelector('strong').textContent,'연구 근거 공백 정리', '한 등급 위인 C가 먼저 나와야 합니다');
  h.close();
});

test('a skill grade change is a real diff against what this device last saw, not a fabricated recency window',()=>{
  const storage=memoryStorage(),h=setup({storage});
  h.view.updateState(fixtureState(),fixtureQuestData());
  assert.match(h.root.textContent,/새로 확인/, '첫 확인은 모두 새로 확인으로 표시됩니다');
  h.view.updateState(fixtureState(),fixtureQuestData());
  assert.doesNotMatch(h.root.textContent,/새로 확인/, '같은 등급을 다시 보면 새로 확인 배지가 없어야 합니다');
  const upgraded=fixtureState();
  upgraded.growth.capabilities.skills[1]={...upgraded.growth.capabilities.skills[1],grade:'D',nextGrade:'C',blockedReason:'서로 다른 입력 2건 이상에서 실행된 기록이 없습니다.'};
  h.view.updateState(upgraded,fixtureQuestData());
  assert.match(h.root.textContent,/승급 E→D/);
  h.close();
});

test('paused quests are the only "확인이 필요한 목표" and name the real pause reason; navigating goes to the quest tab',()=>{
  const h=setup();
  h.view.updateState(fixtureState(),fixtureQuestData({quests:[{id:'q-2',goal:'멈춘 목표',successCriterion:'x',status:'paused',pauseReason:'dailyBudget'}]}));
  assert.match(h.root.textContent,/멈춘 목표/);
  assert.match(h.root.textContent,/오늘 호출 한도 도달/);
  h.root.querySelector('[data-growth-action="navigate"][data-id="quests"]').click();
  assert.deepEqual(h.navigated,['quests']);
  h.view.updateState(fixtureState(),fixtureQuestData());
  assert.match(h.root.textContent,/확인이 필요한 목표가 없습니다/);
  h.close();
});

test('ledger shows real self-reported counts and the latest record, and never renders injected markup',()=>{
  const h=setup();
  const attack='<img src=x onerror="globalThis.stolen=1">';
  h.view.updateState(fixtureState(),fixtureQuestData({ledgers:{wealth:{selfReported:0,records:[]},honor:{selfReported:1,records:[{summary:attack,value:1,unit:'건',createdAt:'2026-09-15T00:00:00.000Z'}]},fame:{selfReported:0,records:[]}}}));
  assert.equal(h.root.querySelector('img'),null);
  assert.match(h.root.textContent,/globalThis.stolen/);
  assert.match(h.root.textContent,/1건/);
  h.close();
});

test('emergency stop status reflects real state and navigating goes to the control tab',()=>{
  const h=setup();
  h.view.updateState(fixtureState({emergencyStop:true}),fixtureQuestData());
  assert.match(h.root.textContent,/모든 작업이 멈춰 있습니다/);
  h.root.querySelector('[data-growth-action="navigate"][data-id="control"]').click();
  assert.deepEqual(h.navigated,['control']);
  h.close();
});

test('renders with no fixed pixel widths (would break a narrow phone screen) and destroy/reset clear the screen',()=>{
  const h=setup();
  h.view.updateState(fixtureState(),fixtureQuestData());
  assert.doesNotMatch(h.root.innerHTML,/width\s*:\s*\d+px/);
  h.view.reset();assert.equal(h.root.innerHTML,'');
  h.view.updateState(fixtureState(),fixtureQuestData());
  h.view.destroy();assert.equal(h.root.innerHTML,'');
  h.close();
});

// --- real server data, including a real restart, feeding the same view ---
// The fixtures above prove the view renders correctly; this proves the real
// /api/state and /api/quests responses actually have the shape those
// fixtures assumed, and that a real process restart does not lose any of it.
const env={YENO_AGENT_PROVIDER:'auto',YENO_AGENT_DAILY_CALL_LIMIT:'10',YENO_OPENAI_API_KEY:'synthetic-openai-key',YENO_OPENAI_MODEL:'synthetic-openai'};
const reply=text=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:text,tool_calls:[]}}],usage:{prompt_tokens:20,completion_tokens:20}}),{headers:{'Content-Type':'application/json'}});
async function setupServer(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-growth-'));
  const token='synthetic-growth-owner-token';
  let runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env,agentFetch:async()=>reply('실제 산출물 초안입니다.')});
  const request=async(method,route,body)=>{
    const r=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const text=await r.text();
    return {status:r.status,body:r.headers.get('content-type')?.includes('json')?JSON.parse(text):text};
  };
  const post=(route,body={})=>request('POST',route,{requestId:randomUUID(),...body});
  const get=route=>request('GET',route);
  const wait=async(id,statuses=['completed','failed','paused'])=>{
    for(let i=0;i<300;i++){const j=runtime.state().jobs.find(j=>j.id===id);if(j&&statuses.includes(j.status))return j;await new Promise(r=>setTimeout(r,15));}
    assert.fail('job did not reach a target state in time');
  };
  const restart=async()=>{runtime.shutdown();runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env});};
  t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  return {post,get,wait,restart};
}

test('the growth screen renders real quest/decision/skill/ledger data from the actual API and survives a real restart',async t=>{
  const app=await setupServer(t);
  const created=await app.post('/api/quests',{goal:'실제 성과를 기록한다',successCriterion:'완료된 산출물과 측정값을 남긴다.'});
  assert.equal(created.status,201);
  const ran=await app.post(`/api/quests/${created.body.quest.id}/run`);
  assert.equal(ran.status,201,JSON.stringify(ran.body));
  const finished=await app.wait(ran.body.job.id);
  assert.equal(finished.status,'completed',finished.error);
  const quest=(await app.get('/api/quests')).body.quests.find(q=>q.jobId===finished.id);
  const outcome=await app.post('/api/outcomes',{questId:quest.id,ledger:'wealth',summary:'실제 확인된 성과',artifactId:quest.artifacts[0].id,value:42,unit:'건'});
  assert.equal(outcome.status,201);
  assert.ok(outcome.body.kirbyAcquisition, '커비가 실제로 ledger-digest를 자동 흡수해야 성장 화면에 보여줄 등급이 생깁니다');
  // A second, still-proposed quest so decideQuest has a real candidate left to
  // pick - the first quest already completed and is honestly no longer "지금
  // 하는 일" once nothing is running or freshly decided for it.
  const next=await app.post('/api/quests',{goal:'다음으로 확인할 실측 성과를 정한다',successCriterion:'다음 목표의 실행 계획을 정리한다.'});
  assert.equal(next.status,201);

  async function renderFromRealApi(storage) {
    const state=(await app.get('/api/state')).body, questData=(await app.get('/api/quests')).body;
    const dom=new JSDOM('<main></main>'),root=dom.window.document.querySelector('main');
    const view=createGrowthView({root,storage});
    view.updateState(state,questData);
    return {dom,root,view,state,questData};
  }

  const storage=memoryStorage();
  const before=await renderFromRealApi(storage);
  assert.ok(before.questData.decision, '남은 제안된 목표가 있으므로 실제 결정이 있어야 합니다');
  assert.match(before.root.textContent,/다음으로 확인할 실측 성과를 정한다/, '실제 결정된 다음 목표가 지금 하는 일에 표시돼야 합니다');
  assert.match(before.root.textContent,/실제 확인된 성과/);
  assert.match(before.root.textContent,/ledger-digest|원장/i, JSON.stringify(before.state.growth.capabilities.skills));
  before.view.destroy();before.dom.window.close();

  await app.restart();
  const after=await renderFromRealApi(storage);
  assert.deepEqual(
    after.state.growth.capabilities.skills.find(s=>s.id==='ledger-digest'),
    before.state.growth.capabilities.skills.find(s=>s.id==='ledger-digest'),
    '재시작 후에도 같은 성장 등급 증거가 그대로 남아야 합니다',
  );
  assert.match(after.root.textContent,/실제 확인된 성과/);
  after.view.destroy();after.dom.window.close();
});
