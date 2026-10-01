import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ACTIVITY_KO,anticipationSpeech,composeFromCore,failureJobToShow,failureSpeech,hungerCurveModel,idleDriveSpeech,normalizeJarvisAddress,resultJobToShow,resultSpeech} from '../public/jarvis-scene-model.mjs';
import {DRIVE_CANON} from '../lib/seven-drives.mjs';
import {normalizeJarvisAddress as normalizeServerAddress} from '../lib/jarvis-settings.mjs';

const hunger = {greed:20,gluttony:62,envy:52,pride:20,lust:54,wrath:57,sloth:55};
const measured = () => ({hunger:{...hunger},drives:DRIVE_CANON.map(drive=>({...drive,driveId:drive.id})),
  lastDebate:[{driveId:'pride',text:'[push] 검증 공백 2건. 내 이름을 걸 수 없다.',weightedScore:18},{driveId:'greed',text:'[contest] 반대. 내 기여 8점, 오만과 차이 -2점.',weightedScore:12},{driveId:'sloth',text:'[contest] 반대. 내 기여 1점, 오만과 차이 -9점.',weightedScore:1}],
  hungryVoice:{driveId:'gluttony',text:'오래된 근거 3건. 다 삼킨다.'}});

test('activity_labels_v2',()=>{
  assert.deepEqual(ACTIVITY_KO,{idle:'대기 중',planning:'분석 중',executing:'실행 중',verifying:'검증 중',waiting_owner:'승인 대기 중',paused:'일시 정지',stopped:'정지'});
  assert.match(composeFromCore({activity:'waiting_owner'},'사령관님'),/^사령관님,.*대기하겠습니다\.$/);
  assert.match(composeFromCore({activity:'idle',pendingApprovalCount:2}),/승인할 작업/);
  assert.match(composeFromCore({activity:'paused'}),/일시 정지했습니다/);
  assert.match(composeFromCore({activity:'stopped'}),/정지되었습니다/);
});

test('result_and_failure_use_formal_register_and_keep_honesty_line',()=>{
  assert.equal(resultSpeech({type:'document',title:'문서: 검증 보고'},'# 원문','사령관님'),'문서를 완성했습니다, 사령관님. 「검증 보고」. 전체 결과에 올려두었습니다.');
  assert.equal(resultSpeech({type:'document'},''),'문서를 완성했습니다, 주인님. 전체 결과에 올려두었습니다.');
  assert.equal(resultSpeech({type:'other'},'내가 쓴 반말이야'),'결과를 준비했습니다, 주인님. 「내가 쓴 반말이야」');
  for (const code of ['timeout','empty_model_response','context_limit','http_401','http_403','http_429','http_503','request_failed_or_stopped','research_tools_disabled','invalid_json','mission_call_limit','dependency_failed','cancelled','stopped','unrecognized']) {
    const text = failureSpeech(code);
    assert.match(text,/^완료하지 못했습니다\. 원인: .+\. 숨기지 않겠습니다\.$/);
    assert.doesNotMatch(text,/했어|줬어|할게|없어|ㅋㅋ|농담/);
  }
});

test('anticipation_line_only_from_real_state',()=>{
  const facts = measured();
  const state = {shadowArmy:{roster:{total:2}},events:[{type:'one'},{type:'two'},{type:'three'}]};
  assert.equal(anticipationSpeech({activity:'idle'},facts,state,'사령관님'),'사령관님, 곧 폭식의 움직임이 커질 것 같습니다 — 배고픔 62/100 · 명부 2명 · 운영 기록 3건. 기록에 따른 예상입니다.');
  assert.equal(anticipationSpeech({activity:'idle'},facts),'주인님, 곧 폭식의 움직임이 커질 것 같습니다 — 배고픔 62/100. 기록에 따른 예상입니다.');
  for (const activity of ['planning','executing','verifying','waiting_owner','paused','stopped']) assert.equal(anticipationSpeech({activity},facts,state),null);
  assert.equal(anticipationSpeech({activity:'idle',pendingApprovalCount:1},facts,state),null);
  assert.equal(anticipationSpeech({activity:'idle'},facts,{...state,emergencyStop:true}),null);
  for (const invalid of [null,{...facts,lastDebate:[]},{...facts,hungryVoice:null},{...facts,hungryVoice:{driveId:'wrath',text:'다른 목소리'}},{...facts,drives:Array(7).fill(facts.drives[0])},{...facts,hunger:{...hunger,greed:NaN}},{...facts,hunger:{...hunger,greed:101}},{...facts,hunger:Object.fromEntries(Object.keys(hunger).map(id=>[id,50]))}]) assert.equal(anticipationSpeech({activity:'idle'},invalid,state),null);
});

test('idle_quotes_one_push_and_one_contest_without_rewriting_recorded_evidence',()=>{
  const facts = measured();
  const speech = idleDriveSpeech({activity:'idle'},facts);
  assert.ok(speech.includes(facts.lastDebate[0].text.slice(7)));
  assert.ok(speech.includes(facts.lastDebate[1].text.slice(10)));
  assert.ok(!speech.includes(facts.lastDebate[2].text.slice(10)));
  assert.equal(speech.split('\n').length,2);
  assert.equal(idleDriveSpeech({activity:'idle'},{...facts,lastDebate:facts.lastDebate.map(voice=>({...voice,text:'이전 수치 나열'}))}),null);
  assert.equal(idleDriveSpeech({activity:'idle',pendingApprovalCount:1},facts),null);
});

test('hunger_curves_use_only_recorded_complete_v2_snapshots_and_preserve_missing_intervals',()=>{
  const first = {...hunger,greed:0};
  const last = {...hunger,gluttony:80,pride:33};
  const facts = {...measured(),history:[
    {version:1,at:'2026-09-29T00:00:00.000Z',hungerSnapshot:null},
    {version:2,at:'2026-09-29T00:01:00.000Z',hungerSnapshot:first},
    {version:1,at:'2026-09-29T00:02:00.000Z',hungerSnapshot:null},
    {version:2,at:'2026-09-29T00:06:00.000Z',hungerSnapshot:last},
    {version:2,at:'2026-09-29T00:07:00.000Z',hungerSnapshot:{greed:40}},
  ]};
  const curve = hungerCurveModel(facts);
  assert.deepEqual(curve.samples.map(sample=>sample.index),[1,3]);
  assert.equal(curve.samples[0].hunger.greed,0);
  assert.equal(curve.samples[1].time-curve.samples[0].time,300000);
  assert.equal(curve.missingCount,3);
  assert.equal(curve.drives.length,7);
  assert.equal(curve.drives.find(drive=>drive.driveId==='pride').label,'오만');
  assert.equal(curve.drives.find(drive=>drive.driveId==='lust').label,'색욕');
  assert.deepEqual(hungerCurveModel(facts),curve);
  assert.equal(hungerCurveModel(measured()).samples.length,0);
  assert.equal(hungerCurveModel({...facts,history:[facts.history[1]]}).samples.length,1);
  assert.equal(hungerCurveModel({...facts,history:[{...facts.history[1],hungerSnapshot:{...first,lust:Infinity}}]}).samples.length,0);
});

test('owner_address_validation_matches_server_unicode_and_control_boundaries',()=>{
  for (const input of ['  사령관님  ','주인님','😀'.repeat(32)]) assert.equal(normalizeJarvisAddress(input),normalizeServerAddress(input));
  for (const input of ['',null,'x'.repeat(33),'주인\n님','주인\u0000님','주인\u202e님']) {
    assert.throws(()=>normalizeJarvisAddress(input),TypeError);
    assert.throws(()=>normalizeServerAddress(input),TypeError);
  }
});

test('owner_drawer_has_labeled_settings_and_external_csp_safe_scripts',async()=>{
  const html = await readFile(new URL('../public/jarvis.html',import.meta.url),'utf8');
  const source = await readFile(new URL('../public/jarvis.mjs',import.meta.url),'utf8');
  assert.match(html,/<label for="jarvis-address">/);
  assert.match(html,/id="hunger-chart"[^>]+aria-labelledby="hunger-heading hunger-summary"/);
  assert.doesNotMatch(html,/\s(?:style|on\w+)\s*=/i);
  assert.match(source,/api\('\/api\/jarvis\/settings', pendingAddressWrite\)/);
  assert.doesNotMatch(source,/lastRevision/);
});

test('hydration_reports_newest_terminal_failure_instead_of_resurrecting_older_result',()=>{
  const completed = {id:'older-result',status:'completed',updatedAt:'2026-09-29T18:14:00.000Z',artifacts:[{id:'document'}]};
  const failed = {id:'newer-failure',status:'failed',updatedAt:'2026-09-29T18:15:00.000Z',error:'empty_model_response'};
  for (const status of ['failed','cancelled','stopped']) {
    const failure = {...failed,status};
    const unordered = [completed,failure];
    assert.equal(resultJobToShow(unordered,new Set(),true),null);
    assert.equal(failureJobToShow(unordered,new Set(),true),failure);
    assert.equal(failureJobToShow(unordered,new Set([failure.id]),false),null);
    assert.equal(resultJobToShow(unordered,new Set([failure.id]),false),null);
  }
  const recovered = {...completed,id:'recovered',updatedAt:'2026-09-29T18:16:00.000Z'};
  assert.equal(resultJobToShow([failed,completed,recovered],new Set(),true),recovered);
  assert.equal(failureJobToShow([failed,completed,recovered],new Set(),true),null);
});
