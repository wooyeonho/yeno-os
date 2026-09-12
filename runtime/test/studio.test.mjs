import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {emptyStudio,validateStudio,applyStudioAction,studioOverview,studioExport,isStudioSafetyAction,StudioError,STUDIO_LIMITS} from '../lib/studio.mjs';

const NOW='2026-09-12T12:00:00.000Z';
const HOUR='2026-09-12T13:00:00.000Z';
const error=(code,status=400)=>e=>e instanceof StudioError&&e.code===code&&e.status===status;
const digest=v=>createHash('sha256').update(v).digest('hex');
function fixture(){
  let studio=emptyStudio(),counter=0;
  return {
    get studio(){return studio;},
    run(action,fields={},options={}){const response=applyStudioAction(studio,{action,requestId:`studio-test-${++counter}`,...fields},{now:NOW,...options});studio=response.studio;return response.result;},
  };
}
function withContact(f,extra={}){return f.run('contact.create',{name:'테스트 가족',relationship:'가족',consent:'granted',consentNote:'테스트용 가상 당사자가 안부 기록에 동의함',...extra});}
function withChapter(f){const series=f.run('series.create',{title:'누적하는 세계',genre:'판타지',premise:'이야기 설정'});const chapter=f.run('chapter.create',{seriesId:series.id,number:1,title:'첫 기록',content:'첫 번째 원고\n\n결말까지 그대로 보존.'});return {series,chapter};}

test('private place notes persist exact user coordinates and preserve input on every transition',()=>{
  const initial=emptyStudio(),body={action:'place.create',requestId:'place-1',title:'여기에서 본 풍경',note:'첫 문단\n\n둘째 문단',address:'사용자가 직접 입력한 주소',coordinates:{latitude:40.7829,longitude:-73.9654},visitedAt:'2026-09-12T08:00:00-04:00',tags:['풍경','다시 방문'],url:'https://example.test/place'};
  const copy=structuredClone(body),{studio,result}=applyStudioAction(initial,body,{now:NOW});
  assert.deepEqual(initial,emptyStudio());assert.deepEqual(body,copy);
  assert.equal(studio.places[0].visitedAt,NOW);assert.equal(studio.places[0].note,body.note);assert.deepEqual(studio.places[0].coordinates,body.coordinates);
  validateStudio(JSON.parse(JSON.stringify(studio)));
  const overview=studioOverview(studio,{now:NOW});assert.equal(overview.receipts,undefined);assert.equal(overview.capabilities.automaticLocation,false);assert.equal(overview.counts.places,1);
  overview.places[0].coordinates.latitude=0;assert.equal(studio.places[0].coordinates.latitude,40.7829);
  const updated=applyStudioAction(studio,{action:'place.update',requestId:'place-2',id:result.id,expectedRevision:1,note:'고친 문단',coordinates:null},{now:NOW});
  assert.equal(updated.studio.places[0].id,result.id);assert.equal(updated.studio.places[0].revision,2);assert.equal(updated.studio.places[0].coordinates,null);assert.equal(studio.places[0].note,body.note);
});

test('all inputs are bounded and reject implicit geolocation, unsafe links and fake publication',()=>{
  const f=fixture();
  for(const body of [null,[],{}, {action:'place.delete',requestId:'a'}])assert.throws(()=>applyStudioAction(f.studio,body,{now:NOW}),error('unknown_action'));
  for(const field of ['published','verified','autoLocation','status','delivery','model'])assert.throws(()=>f.run('place.create',{title:'장소',[field]:true}),error('unsupported_field'));
  for(const title of ['',null,42,'a'.repeat(161),'a\0b'])assert.throws(()=>f.run('place.create',{title}),error('invalid_field'));
  for(const c of [{latitude:'4',longitude:2},{latitude:91,longitude:0},{latitude:0,longitude:181},{latitude:0,longitude:0,accuracy:1}])assert.throws(()=>f.run('place.create',{title:'장소',coordinates:c}));
  for(const url of ['javascript:alert(1)','data:text/plain,test','https://user:password@example.test','file:///etc/passwd'])assert.throws(()=>f.run('place.create',{title:'장소',url}),error('invalid_url'));
  assert.throws(()=>f.run('place.create',{title:'장소',tags:['같음','같음']}),error('invalid_tags'));
  assert.throws(()=>f.run('place.create',{title:'장소',tags:Array.from({length:21},(_,i)=>String(i))}),error('invalid_tags'));
  assert.equal(f.studio.places.length,0);
});

test('contact consent is explicitly owner reported and required before any check-in record',()=>{
  const f=fixture(),c=f.run('contact.create',{name:'연락처'});
  assert.equal(f.studio.contacts[0].consent,'not_asked');assert.equal(f.studio.contacts[0].consentSource,'owner_report');
  assert.throws(()=>f.run('checkin.create',{contactId:c.id,dueAt:HOUR,meal:'lunch'}),error('consent_required',409));
  assert.throws(()=>f.run('contact.update',{id:c.id,expectedRevision:1,consent:'granted'}),error('consent_evidence_required'));
  f.run('contact.update',{id:c.id,expectedRevision:1,consent:'granted',consentNote:'가상 상대방의 동의 경위를 소유자가 기록함'});
  const checkin=f.run('checkin.create',{contactId:c.id,dueAt:HOUR,meal:'lunch',note:'점심 확인'});
  assert.equal(f.studio.checkins[0].delivery,'not_sent');assert.equal(f.studio.checkins[0].recordedBy,'owner');assert.equal(f.studio.checkins[0].id,checkin.id);
  assert.throws(()=>f.run('checkin.create',{contactId:c.id,dueAt:HOUR,meal:'dinner'}),error('checkin_already_pending',409));
  assert.equal(studioOverview(f.studio,{now:NOW}).capabilities.recipientMessaging,false);
});

test('revocation cancels all pending requests atomically and regrant never reopens them',()=>{
  const f=fixture(),c=withContact(f),first=f.run('checkin.create',{contactId:c.id,dueAt:HOUR,meal:'lunch'});
  const second=f.run('checkin.create',{contactId:c.id,dueAt:'2026-09-12T15:00:00Z',meal:'dinner'},{now:'2026-09-12T14:00:00Z'});
  const original=structuredClone(f.studio);
  f.run('contact.update',{id:c.id,expectedRevision:1,consent:'revoked',consentNote:'안부 기록 동의를 철회했다고 보고함'},{now:'2026-09-12T14:30:00Z'});
  assert.equal(original.checkins[0].status,'pending');assert.ok(f.studio.checkins.every(r=>r.status==='cancelled'&&r.cancelReason==='consent_revoked'&&r.revision===2));
  assert.throws(()=>f.run('checkin.respond',{id:first.id,expectedRevision:2,answer:'ate'},{now:'2026-09-12T14:30:00Z'}),error('checkin_closed',409));
  f.run('contact.update',{id:c.id,expectedRevision:2,consent:'granted',consentNote:'새로 동의했다고 보고함'},{now:'2026-09-12T14:30:00Z'});
  assert.equal(f.studio.checkins.find(r=>r.id===second.id).status,'cancelled');assert.equal(f.studio.contacts[0].consentHistory.length,3);
  validateStudio(JSON.parse(JSON.stringify(f.studio)));
});

test('timezone offsets normalize to UTC and overdue is derived without changing stored data',()=>{
  const f=fixture(),c=withContact(f);
  f.run('checkin.create',{contactId:c.id,dueAt:'2026-09-12T09:00:00-04:00',meal:'breakfast'});
  assert.equal(f.studio.checkins[0].dueAt,HOUR);
  assert.equal(studioOverview(f.studio,{now:HOUR}).checkins[0].displayStatus,'pending');
  assert.equal(studioOverview(f.studio,{now:'2026-09-12T22:00:00.001+09:00'}).checkins[0].displayStatus,'overdue');
  assert.equal(f.studio.checkins[0].status,'pending');assert.equal(f.studio.checkins[0].healthStatus,undefined);
  for(const visitedAt of ['2026-09-12T13:00:00','2026-02-30T13:00:00Z','2026-09-12T25:00:00Z','2026-09-12T13:00:00+14:01','2026-09-12T13:00:00+25:00'])assert.throws(()=>fixture().run('place.create',{title:'장소',visitedAt}),error('invalid_time'));
  const fresh=fixture(),fc=withContact(fresh);
  for(const dueAt of [NOW,'2026-09-13T12:00:00.001Z'])assert.throws(()=>fresh.run('checkin.create',{contactId:fc.id,dueAt,meal:'lunch'}),error('invalid_deadline'));
  fresh.run('checkin.create',{contactId:fc.id,dueAt:'2026-09-13T12:00:00Z',meal:'lunch'});
  validateStudio(fresh.studio);
});

test('response at exact deadline is accepted once; closed and overdue requests cannot be rewritten',()=>{
  const f=fixture(),c=withContact(f),r=f.run('checkin.create',{contactId:c.id,dueAt:HOUR,meal:'lunch'});
  const body={action:'checkin.respond',requestId:'response-1',id:r.id,expectedRevision:1,answer:'ate',note:'소유자가 들은 응답을 기록'};
  const answered=applyStudioAction(f.studio,body,{now:HOUR});
  assert.equal(answered.studio.checkins[0].answer,'ate');assert.equal(answered.studio.checkins[0].answeredAt,HOUR);assert.equal(answered.studio.checkins[0].note,'');
  assert.deepEqual(applyStudioAction(answered.studio,body,{now:'2026-09-13T13:00:00Z'}),answered);
  assert.throws(()=>applyStudioAction(answered.studio,{...body,requestId:'response-2',expectedRevision:2,answer:'not_yet'},{now:HOUR}),error('checkin_closed',409));
  assert.throws(()=>applyStudioAction(f.studio,{...body,requestId:'late'},{now:'2026-09-12T13:00:00.001Z'}),error('checkin_overdue',409));
  assert.equal(f.studio.checkins[0].status,'pending');
});

test('optimistic editing prevents a second device from silently losing the first edit',()=>{
  const f=fixture(),p=f.run('place.create',{title:'원래 이름'});
  f.run('place.update',{id:p.id,expectedRevision:1,title:'첫 기기 수정'});
  assert.throws(()=>f.run('place.update',{id:p.id,expectedRevision:1,title:'늦은 기기 수정'}),error('revision_conflict',409));
  assert.throws(()=>f.run('place.update',{id:p.id,title:'수정 번호 없음'}),error('revision_required'));
  assert.equal(f.studio.places[0].title,'첫 기기 수정');
  f.run('place.archive',{id:p.id,expectedRevision:2});
  assert.equal(f.studio.places[0].id,p.id);assert.equal(f.studio.places[0].title,'첫 기기 수정');assert.equal(studioOverview(f.studio,{now:NOW}).counts.places,0);
  assert.throws(()=>f.run('place.update',{id:p.id,expectedRevision:3,title:'다시 수정'}),error('record_archived',409));
});

test('novel revisions retain exact original manuscript, identity and export order after restart',()=>{
  const f=fixture(),{series,chapter}=withChapter(f),first=structuredClone(f.studio.chapters[0]);
  f.run('chapter.create',{seriesId:series.id,number:2,title:'둘째 기록',content:'다음 회차 본문'});
  f.run('chapter.update',{id:chapter.id,expectedRevision:1,title:'첫 기록 개정',content:'  새 첫 문단\n\n마지막 문단\n',notes:'수정 메모'});
  const current=f.studio.chapters[0];assert.equal(current.id,chapter.id);assert.equal(current.revision,2);assert.equal(current.history[0].content,first.content);assert.equal(current.history[0].title,first.title);assert.equal(current.contentSha256,digest(current.content));
  const restored=JSON.parse(JSON.stringify(f.studio));validateStudio(restored);
  const output=studioExport(restored,{kind:'series',id:series.id});assert.equal(output.mimeType,'text/markdown; charset=utf-8');assert.ok(output.content.indexOf('1화')<output.content.indexOf('2화'));assert.ok(output.content.includes(current.content));
  f.run('chapter.archive',{id:chapter.id,expectedRevision:2});assert.equal(f.studio.chapters[0].history.length,2);assert.equal(f.studio.chapters[0].history[1].content,current.content);
  assert.ok(!studioExport(f.studio,{kind:'series',id:series.id}).content.includes('1화'));
  assert.ok(studioExport(f.studio,{kind:'chapter',id:chapter.id}).content.includes(current.content));
  assert.equal(studioOverview(f.studio,{now:NOW}).capabilities.externalPublishing,false);
});

test('duplicate chapter numbering and cross-series overwrite attempts leave all drafts intact',()=>{
  const f=fixture(),{series,chapter}=withChapter(f),before=structuredClone(f.studio);
  assert.throws(()=>f.run('chapter.create',{seriesId:series.id,number:1,title:'중복'}),error('chapter_number_conflict',409));
  assert.throws(()=>f.run('chapter.update',{id:chapter.id,expectedRevision:1,seriesId:randomUUID(),title:'옮기기'}),error('unsupported_field'));
  assert.throws(()=>f.run('chapter.create',{seriesId:randomUUID(),number:1,title:'없는 작품'}),error('record_not_found',404));
  for(const number of [0,-1,1.5,'1',10001])assert.throws(()=>f.run('chapter.create',{seriesId:series.id,number,title:'잘못된 번호'}),error('invalid_chapter_number'));
  assert.deepEqual(f.studio,before);
});

test('stable request identities survive JSON restart and preserve historical response revisions',()=>{
  const body={action:'place.create',requestId:'create-once',title:'중복되지 않는 기록',coordinates:{longitude:127,latitude:37}};
  const first=applyStudioAction(emptyStudio(),body,{now:NOW});
  const second=applyStudioAction(first.studio,{...body,coordinates:{latitude:37,longitude:127}},{now:NOW});assert.deepEqual(second,first);
  const edited=applyStudioAction(first.studio,{action:'place.update',requestId:'edit-later',id:first.result.id,expectedRevision:1,title:'나중에 바꾼 이름'},{now:HOUR});
  const replay=applyStudioAction(JSON.parse(JSON.stringify(edited.studio)),body,{now:'not-a-date'});
  assert.deepEqual(replay.result,first.result);assert.equal(replay.studio.places.length,1);assert.equal(replay.studio.places[0].title,'나중에 바꾼 이름');assert.equal(replay.studio.revision,2);
  assert.throws(()=>applyStudioAction(replay.studio,{...body,title:'요청 내용 위조'},{now:HOUR}),error('request_conflict',409));
});

test('clock rollback is rejected across unrelated entities while exact retries remain recoverable',()=>{
  const f=fixture();f.run('place.create',{title:'뒤의 시각'},{now:HOUR});
  assert.throws(()=>f.run('series.create',{title:'이전 시각'}),error('clock_moved_backwards',409));
  assert.equal(f.studio.series.length,0);assert.equal(f.studio.places.length,1);
});

test('strict restore rejects unknown fields, forged states, hash changes and broken references',()=>{
  const f=fixture(),c=withContact(f);withChapter(f);f.run('checkin.create',{contactId:c.id,dueAt:HOUR,meal:'lunch'});
  const changes=[
    s=>{s.published=true;},s=>{s.chapters[0].content='바뀐 원문';},s=>{s.chapters[0].history=[{}];},
    s=>{s.checkins[0].contactId=randomUUID();},s=>{s.checkins[0].consentRevision=999;},s=>{s.checkins[0].delivery='sent';},s=>{s.checkins[0].status='healthy';},
    s=>{s.contacts[0].consentSource='verified';},s=>{s.contacts[0].consentHistory[0].consent='revoked';},
    s=>{s.receipts[0].payloadHash='bogus';},s=>{s.receipts.push({...s.receipts[0]});},s=>{s.revision++;},s=>{s.series[0].id=s.contacts[0].id;},s=>{s.receipts=[];s.revision=0;},
  ];
  for(const change of changes){const copy=structuredClone(f.studio);change(copy);assert.throws(()=>validateStudio(copy));}
  validateStudio(f.studio);
});

test('capacity refusal never trims accepted manuscripts or original revisions',()=>{
  const f=fixture(),{chapter}=withChapter(f);
  for(let revision=1;revision<=STUDIO_LIMITS.chapterHistory;revision++)f.run('chapter.update',{id:chapter.id,expectedRevision:revision,content:`수정 ${revision}`});
  const before=structuredClone(f.studio);
  assert.throws(()=>f.run('chapter.update',{id:chapter.id,expectedRevision:101,content:'보존 한도 밖 수정'}),error('history_capacity',409));
  assert.deepEqual(f.studio,before);assert.equal(f.studio.chapters[0].history[0].content,'첫 번째 원고\n\n결말까지 그대로 보존.');
});

test('check-in and place exports are complete private data with explicit no-delivery provenance',()=>{
  const f=fixture(),c=withContact(f);f.run('checkin.create',{contactId:c.id,dueAt:HOUR,meal:'other'});f.run('place.create',{title:'개인 장소'});
  const exportData=JSON.parse(studioExport(f.studio,{kind:'checkins'}).content);assert.equal(exportData.contacts[0].id,c.id);assert.equal(exportData.checkins[0].delivery,'not_sent');assert.equal(exportData.version,1);
  assert.equal(JSON.parse(studioExport(f.studio,{kind:'places'}).content).places[0].title,'개인 장소');
  assert.throws(()=>studioExport(f.studio,{kind:'publish'}),error('invalid_export'));
});

function reservedFixture(){
  const f=fixture(),contact=withContact(f),checkin=f.run('checkin.create',{contactId:contact.id,dueAt:HOUR,meal:'lunch'});
  f.run('checkin.invite',{id:checkin.id,expectedRevision:1});
  const place=f.run('place.create',{requestId:'reserved-place-create',title:'보존할 장소'});
  return {f,contact,checkin,place};
}
function syntheticReceipt(studio,record,action){
  studio.receipts.push({requestId:`synthetic-capacity-${studio.receipts.length}`,payloadHash:'a'.repeat(64),action,id:record.id,revision:record.revision,at:NOW});studio.revision++;
}

test('full ordinary receipt capacity retains enough slots for revoke, cancel and both consent withdrawals',()=>{
  const {f,contact,checkin,place}=reservedFixture(),studio=structuredClone(f.studio),p=studio.places[0];
  const capacity=studioOverview(studio,{now:NOW}).storage;assert.equal(capacity.reservedReceiptSlots,4);
  while(studio.receipts.length<capacity.ordinaryReceiptLimit){p.revision++;syntheticReceipt(studio,p,'place.update');}
  validateStudio(studio);const originals=structuredClone(studio.receipts);
  assert.throws(()=>applyStudioAction(studio,{action:'place.update',requestId:'ordinary-over-capacity',id:place.id,expectedRevision:p.revision,title:'새 이름'},{now:NOW}),error('studio_capacity',409));
  let next=applyStudioAction(studio,{action:'checkin.revoke',requestId:'closing-revoke',id:checkin.id,expectedRevision:2},{now:NOW}).studio;
  next=applyStudioAction(next,{action:'checkin.cancel',requestId:'closing-cancel',id:checkin.id,expectedRevision:3,reason:'안부 종료'},{now:NOW}).studio;
  const unchanged=next.contacts[0];
  const withdrawal={action:'contact.update',requestId:'closing-not-asked',id:contact.id,expectedRevision:1,name:unchanged.name,relationship:unchanged.relationship,contactInfo:unchanged.contactInfo,consent:'not_asked',consentNote:'동의 확인 철회'};
  assert.equal(isStudioSafetyAction(next,withdrawal),true);assert.equal(isStudioSafetyAction(next,{...withdrawal,name:'다른 이름도 수정'}),false);
  next=applyStudioAction(next,withdrawal,{now:NOW}).studio;
  const last={action:'contact.update',requestId:'closing-revoked',id:contact.id,expectedRevision:2,consent:'revoked',consentNote:'철회 기록'};
  next=applyStudioAction(next,last,{now:NOW}).studio;
  assert.equal(next.receipts.length,STUDIO_LIMITS.receipts);assert.equal(next.revision,next.receipts.length);assert.deepEqual(next.receipts.slice(0,originals.length),originals);
  assert.equal(next.checkins[0].status,'cancelled');assert.equal(next.checkins[0].invitation.status,'revoked');assert.equal(next.contacts[0].consent,'revoked');
  assert.deepEqual(applyStudioAction(next,last,{now:NOW}).studio,next,'closing retry must work even at hard capacity');
  assert.equal(isStudioSafetyAction(next,{...last,requestId:'repeat-no-op',expectedRevision:3}),false);
  validateStudio(JSON.parse(JSON.stringify(next)));
});

test('full ordinary byte capacity reserves maximum-length closing notes without erasing manuscripts',()=>{
  const {f,contact,checkin,place}=reservedFixture(),{chapter}=withChapter(f),studio=structuredClone(f.studio),c=studio.chapters.find(record=>record.id===chapter.id);
  c.content='a'.repeat(60000);c.contentSha256=digest(c.content);
  for(let index=0;index<100;index++){
    c.history.push({revision:c.revision,title:c.title,number:c.number,content:c.content,notes:c.notes,contentSha256:c.contentSha256,archivedAt:null,at:NOW});c.revision++;syntheticReceipt(studio,c,'chapter.update');
  }
  const capacity=studioOverview(studio,{now:NOW}).storage;
  const extra=capacity.ordinaryMaxBytes-Buffer.byteLength(JSON.stringify(studio));assert.ok(extra>0);
  const unicodeCount=Math.floor(extra/(2*101)),content='가'.repeat(unicodeCount)+'a'.repeat(60000-unicodeCount);
  c.content=content;c.contentSha256=digest(content);for(const previous of c.history){previous.content=content;previous.contentSha256=c.contentSha256;}
  const remainder=capacity.ordinaryMaxBytes-Buffer.byteLength(JSON.stringify(studio));assert.ok(remainder>=0&&remainder<202);studio.places[0].note='x'.repeat(remainder);
  validateStudio(studio);assert.equal(Buffer.byteLength(JSON.stringify(studio)),capacity.ordinaryMaxBytes);
  const originalHash=c.contentSha256;
  assert.throws(()=>applyStudioAction(studio,{action:'place.update',requestId:'bytes-over-capacity',id:place.id,expectedRevision:1,note:studio.places[0].note+'!'},{now:NOW}),error('studio_capacity',409));
  let next=applyStudioAction(studio,{action:'checkin.revoke',requestId:'bytes-revoke',id:checkin.id,expectedRevision:2},{now:NOW}).studio;
  const maxEscapedNote='\ud800'.repeat(2000);
  next=applyStudioAction(next,{action:'checkin.cancel',requestId:'bytes-cancel',id:checkin.id,expectedRevision:3,reason:maxEscapedNote},{now:NOW}).studio;
  next=applyStudioAction(next,{action:'contact.update',requestId:'bytes-not-asked',id:contact.id,expectedRevision:1,consent:'not_asked',consentNote:maxEscapedNote},{now:NOW}).studio;
  next=applyStudioAction(next,{action:'contact.update',requestId:'bytes-revoked',id:contact.id,expectedRevision:2,consent:'revoked',consentNote:maxEscapedNote},{now:NOW}).studio;
  assert.ok(Buffer.byteLength(JSON.stringify(next))<=STUDIO_LIMITS.bytes);assert.equal(next.chapters[0].contentSha256,originalHash);assert.equal(next.chapters[0].history.length,100);assert.equal(next.checkins[0].cancelReason,maxEscapedNote);
  assert.equal(next.revision,next.receipts.length);validateStudio(next);
});

test('ordinary consent history keeps two closing entries reserved at its existing 100-entry limit',()=>{
  const f=fixture(),contact=withContact(f);
  for(let revision=1;revision<100;revision++)f.run('contact.update',{id:contact.id,expectedRevision:revision,consentNote:`가상 동의 경위 수정 ${revision}`});
  assert.equal(f.studio.contacts[0].consentHistory.length,100);
  assert.throws(()=>f.run('contact.update',{id:contact.id,expectedRevision:100,consentNote:'일반 수정 한도 밖'}),error('history_capacity',409));
  f.run('contact.update',{id:contact.id,expectedRevision:100,consent:'not_asked',consentNote:'동의 확인 철회'});
  f.run('contact.update',{id:contact.id,expectedRevision:101,consent:'revoked',consentNote:'동의 철회 확정'});
  assert.equal(f.studio.contacts[0].consentHistory.length,102);assert.equal(f.studio.contacts[0].consentHistory[0].consent,'granted');assert.equal(f.studio.contacts[0].consent,'revoked');validateStudio(f.studio);
});
