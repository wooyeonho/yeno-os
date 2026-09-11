import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sourceDestination,sourceCoverage,absorptionDocument} from '../public/absorption-routing.mjs';
test('references route to features, existing projects or review without creating projects or changing reading status',()=>{
 const projects=[{id:'a',name:'A01 — For-Ai',status:'active'},{id:'old',name:'yeno-os',status:'archived'}];
 const god={id:'s',title:'공개 데이터를 모은 세계 상황판',canonicalUrl:'https://instagram.com/reel/DcjMGA9vHxU',projectId:'old',readingStatus:'unread',decision:'pending'};
 const before=structuredClone({god,projects});assert.equal(sourceDestination(god,projects).kind,'feature');
 assert.equal(sourceDestination({...god,title:'GEO 검색',canonicalUrl:'https://example.com/geo'},projects).projectId,'a');
 assert.equal(sourceDestination({...god,title:'Life Clock',canonicalUrl:'https://example.com/new'},projects).code,'A04');
 assert.equal(sourceDestination({...god,title:'제목 불명',canonicalUrl:'https://example.com/unknown'},projects).kind,'unclassified');
 assert.equal(sourceDestination({...god,projectId:'a'},projects).kind,'project');
 assert.match(absorptionDocument([god],projects),/unread\/pending/);assert.deepEqual({god,projects},before);
 const many=Array.from({length:1000},(_,i)=>({...god,id:`s${i}`,title:'가'.repeat(160),projectId:null}));assert.ok(absorptionDocument(many,projects).length<80000);
});
test('specific reference purpose wins over broad agent, memory or publishing terms',()=>{
 const s=title=>({title,canonicalUrl:'https://example.com/reference',projectId:null});
 assert.equal(sourceDestination(s('OSIRIS: 공개 정보 변화 감지')).key,'discovery');
 assert.equal(sourceDestination(s('Claude로만든 Polymarket 퀀트봇')).code,'V03');
 assert.equal(sourceDestination(s('GitHub: 검사와 배포 환경 권한 분리')).key,'release');
 assert.equal(sourceDestination(s('개인정보 삭제 자동화 소개')).key,'privacy');
 assert.equal(sourceDestination(s('No Results Found 조사형 게임')).code,'V11');
});
test('reviewed page identities correct stale titles without overwriting owner links or review states',()=>{
 const pages=[
  ['https://www.instagram.com/reel/DdBgyy7TCrB/?stkn=example','memory'],
  ['https://www.threads.com/share/BAVbqbnjbv/','android-test'],
  ['https://github.com/google/artemis','android-test'],
  ['https://github.com/bilawalsidhu/gods-eye-view','world'],
  ['https://openai.com/index/introducing-the-agents-api/','execution'],
  ['https://developers.openai.com/api/docs/guides/agents-api/overview','execution']
 ];
 for(const [url,key] of pages){
  const source={id:'s',url,title:'주도적인 자료 발굴',readingStatus:'partial',decision:'pending'};
  const before=structuredClone(source);
  assert.equal(sourceDestination(source).key,key,url);
  assert.deepEqual(source,before);
  assert.equal(sourceDestination({...source,projectId:'owned'},[{id:'owned',name:'A01 — For-Ai',status:'active'}]).projectId,'owned');
 }
 for(const url of ['https://github.com.evil.test/google/artemis','https://github.com/random/artemis','https://example.com/?x=DcjMGA9vHxU','https://user@github.com/google/artemis','http://github.com/google/artemis','https://threads.com/share/BAVbqbnjbv/other']){
  assert.equal(sourceDestination({url,canonicalUrl:url,title:'제목 미확인'}).kind,'unclassified',url);
 }
});
test('coverage retains every reference and exposes broken links and incomplete candidate evidence',()=>{
 const sources=[
  {id:'known',title:'기억',projectId:'archived',readingStatus:'partial',decision:'pending'},
  {id:'unknown',title:'미확인',projectId:'missing',readingStatus:'unavailable',decision:'pending'},
  {id:'missing-project',title:'GEO',readingStatus:'read',decision:'candidate',summary:'읽음',application:'적용',riskNotes:'조건'},
  {id:'bad-review',title:'미확인',readingStatus:'partial',decision:'candidate'},
  {id:'known',title:'중복 ID',readingStatus:'unread',decision:'pending'},
  {title:'ID 없음',readingStatus:'unread',decision:'pending'}
 ];
 const before=structuredClone(sources), coverage=sourceCoverage(sources,[{id:'archived',name:'A01 — For-Ai',status:'archived'}]);
 assert.equal(coverage.total,6);assert.equal(coverage.entries.length,6);
 assert.deepEqual(coverage.entries.map(e=>e.sourceId),sources.map(s=>s.id??null));
 assert.equal(coverage.attentionCount,6);assert.equal(Object.values(coverage.counts).reduce((a,b)=>a+b,0),6);
 assert.deepEqual(coverage.entries.map(e=>e.issues),[
  ['inactive-project-link'],['inactive-project-link'],['missing-destination-project'],['incomplete-candidate-evidence'],['duplicate-source-id'],['missing-source-id']
 ]);
 assert.deepEqual(sources,before);
});
test('all 103 registered references survive classification with the complete 49-project portfolio and separate V11',()=>{
 const registry=JSON.parse(readFileSync(new URL('../../docs/ALL_PROJECTS_AND_SOURCES_20260911.json',import.meta.url)));
 const projects=registry.projects.map(p=>({id:p.projectId,name:p.name,status:'active'}));
 assert.equal(projects.length,50);assert.equal(registry.projects.filter(p=>p.code!=='V11').length,49);
 const sources=registry.sources.map(s=>({...s,id:s.sourceId,canonicalUrl:s.url}));
 const before=structuredClone(sources),coverage=sourceCoverage(sources,projects);
 assert.equal(coverage.total,103);assert.equal(new Set(coverage.entries.map(e=>e.sourceId)).size,103);
 assert.deepEqual(coverage.entries.map(e=>[e.sourceId,e.readingStatus,e.decision]),sources.map(s=>[s.id,s.readingStatus,s.decision]));
 assert.equal(Object.values(coverage.counts).reduce((a,b)=>a+b,0),103);
 assert.deepEqual(sources,before);
});
test('bounded document accounts for references omitted by both group and item limits',()=>{
 const projects=Array.from({length:50},(_,i)=>({id:`p${i}`,name:`Project ${i}`,status:'active'}));
 const sources=projects.map((p,i)=>({id:`s${i}`,title:'참고',projectId:p.id,readingStatus:'unread',decision:'pending'}));
 const doc=absorptionDocument(sources,projects);
 assert.match(doc,/전체 50개 중 이 문서에 30개 표시 · 20개 생략/);
 assert.equal((doc.match(/· ID /g)||[]).length,30);
 const many=Array.from({length:1000},(_,i)=>({...sources[0],id:`s${i}`}));
 assert.match(absorptionDocument(many,projects),/전체 1000개 중 이 문서에 15개 표시 · 985개 생략/);
});
