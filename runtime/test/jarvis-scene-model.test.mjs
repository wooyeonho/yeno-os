import test from 'node:test';
import assert from 'node:assert/strict';
import {measuredDriveTint,heartbeatChanged,composeFromCore,idleDriveSpeech,artifactPlainText,resultSpeech,failureSpeech,workCommandText,resultJobToShow} from '../public/jarvis-scene-model.mjs';

// E2/E3 intentionally replace the former single numeric voice and casual register.
test('idle speech quotes the recorded push and contest after a real decision',()=>{
  const hunger={greed:20,gluttony:62,envy:52,pride:20,lust:54,wrath:57,sloth:55};
  const drives=[{driveId:'greed',legacyName:'강욕',worldName:'부'},{driveId:'gluttony',legacyName:'폭식',worldName:'지식'},{driveId:'envy',legacyName:'질투',worldName:'영향력'},{driveId:'pride',legacyName:'오만',worldName:'명예'},{driveId:'lust',legacyName:'색욕',worldName:'창조'},{driveId:'wrath',legacyName:'분노',worldName:'진화'},{driveId:'sloth',legacyName:'나태',worldName:'자유'}];
  const storedVoice='폭식(지식) · 배고픔 62: 오래된 근거 3건';
  const measured={hunger,drives,lastDebate:[{driveId:'pride',text:'[push] 검증 공백 2건. 내 이름을 걸 수 없다.'},{driveId:'greed',text:'[contest] 반대. 내 기여 8점, 오만과 차이 2점.'},{driveId:'sloth',text:'[contest] 반대. 내 기여 1점, 오만과 차이 -5점.'}],hungryVoice:{driveId:'gluttony',text:storedVoice}};
  assert.equal(idleDriveSpeech({activity:'idle'},measured),'추진 의견: 「검증 공백 2건. 내 이름을 걸 수 없다.」\n반대 의견: 「반대. 내 기여 8점, 오만과 차이 2점.」');
  assert.equal(idleDriveSpeech({activity:'idle'},{...measured,lastDebate:[{driveId:'pride',text:storedVoice},{driveId:'greed',text:storedVoice},{driveId:'sloth',text:storedVoice}]}),null);
  assert.equal(idleDriveSpeech({activity:'executing'},measured),null);
  assert.equal(idleDriveSpeech({activity:'waiting_owner'},measured),null);
  assert.equal(idleDriveSpeech({activity:'idle'},{...measured,lastDebate:[]}),null);
  assert.equal(idleDriveSpeech({activity:'idle'},{...measured,hungryVoice:null}),null);
  assert.equal(idleDriveSpeech({activity:'idle'},{...measured,hunger:Object.fromEntries(Object.keys(hunger).map(id=>[id,50]))}),null);
});

test('only a measured positive dominant drive tints the central core',()=>{
  const drives=[{driveId:'greed',pressure:0},{driveId:'gluttony',pressure:25},{driveId:'envy',pressure:80}];
  assert.equal(measuredDriveTint(drives,'gluttony','#neutral'),'#3987e5');
  assert.equal(measuredDriveTint(drives,'greed','#neutral'),'#neutral');
  assert.equal(measuredDriveTint(drives,'pride','#neutral'),'#neutral');
  assert.equal(measuredDriveTint([{driveId:'envy',pressure:null}],'envy','#neutral'),'#neutral');
});

test('a heartbeat wave is triggered once per changed timestamp, not by unchanged polling or initial load',()=>{
  assert.equal(heartbeatChanged(null,'2026-09-26T00:00:00.000Z'),false);
  assert.equal(heartbeatChanged('2026-09-26T00:00:00.000Z','2026-09-26T00:00:00.000Z'),false);
  assert.equal(heartbeatChanged('2026-09-26T00:00:00.000Z','2026-09-26T00:00:01.000Z'),true);
  assert.equal(heartbeatChanged('2026-09-26T00:00:01.000Z',null),false);
});

test('core speech never reveals Seven Drive taxonomy even when the internal dominant drive is set',()=>{
  const core={activity:'executing',missionGoal:'자료를 정리해줘',dominantDriveName:'탐욕',dominantDriveWorldName:'금색 욕구'};
  assert.equal(composeFromCore(core),'「자료를 정리해줘」 — 실행 중입니다.');
  assert.doesNotMatch(composeFromCore(core),/탐욕|금색 욕구/);
  assert.doesNotMatch(composeFromCore({...core,activity:'idle',missionGoal:null}),/탐욕|금색 욕구/);
});

test('Jarvis reads the artifact as plain speech and limits its length',()=>{
  assert.equal(artifactPlainText('# 오늘 할 일\n**첫째** `자료 정리`'),'오늘 할 일\n첫째 자료 정리');
  assert.equal(artifactPlainText('x'.repeat(430)).length,121);
  assert.ok(artifactPlainText('x'.repeat(430)).endsWith('…'));
});

test('document completion uses a concise title while the full artifact remains linked',()=>{
  const text='## 1\n2026-09-27\n'+('x'.repeat(300));
  assert.equal(resultSpeech({type:'document',title:'문서: 오늘의 메모'},text),'문서를 완성했습니다, 주인님. 「오늘의 메모」. 전체 결과에 올려두었습니다.');
  assert.doesNotMatch(resultSpeech({type:'document',title:'문서: 오늘의 메모'},text),/## 1|2026/);
  assert.equal(resultSpeech({type:'other'},'**완료**'),'결과를 준비했습니다, 주인님. 「완료」');
});

test('known failures have Korean speech and unknown codes do not leak raw English',()=>{
  assert.equal(failureSpeech('timeout'),'완료하지 못했습니다. 원인: 응답 대기 시간을 초과했습니다. 숨기지 않겠습니다.');
  assert.equal(failureSpeech('empty_model_response'),'완료하지 못했습니다. 원인: 모델이 빈 응답을 반환했습니다. 숨기지 않겠습니다.');
  assert.equal(failureSpeech('http_401'),'완료하지 못했습니다. 원인: 모델 인증에 실패했습니다. 숨기지 않겠습니다.');
  assert.equal(failureSpeech('Agent: empty_model_response responseMeta={}'),'완료하지 못했습니다. 원인: 모델이 빈 응답을 반환했습니다. 숨기지 않겠습니다.');
  assert.equal(failureSpeech('provider_stack_trace'),'완료하지 못했습니다. 원인: 아직 확인하지 못했습니다. 숨기지 않겠습니다.');
});

test('work mode preserves explicit no-model commands instead of turning them into model-only goals',()=>{
  for(const command of ['문서 만들어: 오늘의 메모','document: local result','진단해','diagnose','운영 브리핑','목표 현황','목표 저장: 다음 주 일정']){
    assert.equal(workCommandText(command),command);
  }
  assert.equal(workCommandText('오늘 할 일 세 개 정리해줘'),'목표: 오늘 할 일 세 개 정리해줘');
  assert.equal(workCommandText('문서 만들어줘'),'목표: 문서 만들어줘');
});

test('reopened Jarvis shows the latest completed artifact once and does not replay older history',()=>{
  const jobs=[
    {id:'new',status:'completed',artifacts:[{id:'b'}]},
    {id:'failed',status:'failed',artifacts:[{id:'error'}]},
    {id:'old',status:'completed',artifacts:[{id:'a'}]},
  ];
  const spoken=new Set(['old','new']);
  assert.equal(resultJobToShow(jobs,spoken,true)?.id,'new');
  assert.equal(resultJobToShow(jobs,spoken,false),null);
  assert.equal(resultJobToShow(jobs,new Set(['old']),false)?.id,'new');
});
