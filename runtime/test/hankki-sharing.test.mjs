import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyStudio,applyStudioAction,validateStudio,StudioError} from '../lib/studio.mjs';
import {issueHankkiInvite,revokeHankkiInvite,getHankkiRecipientView,respondToHankkiInvite,createHankkiRateLimiter} from '../lib/hankki-sharing.mjs';

const NOW='2026-09-12T12:00:00.000Z',DUE='2026-09-12T13:00:00.000Z';
const KEY='synthetic-hankki-test-key-never-a-live-owner-secret';
const error=(code,status)=>e=>e instanceof StudioError&&e.code===code&&e.status===status;
function fixture(){
  let studio=emptyStudio();
  const contact=applyStudioAction(studio,{action:'contact.create',requestId:'contact-create',name:'가상 가족 이름',contactInfo:'synthetic-private-contact@example.test',consent:'granted',consentNote:'합성 동의 기록'},{now:NOW});studio=contact.studio;
  const checkin=applyStudioAction(studio,{action:'checkin.create',requestId:'checkin-create',contactId:contact.result.id,dueAt:DUE,meal:'lunch',note:'링크에 표시하면 안 되는 개인 메모'},{now:NOW});studio=checkin.studio;
  const body={requestId:'invite-create',checkinId:checkin.result.id,expectedRevision:1};
  const invited=issueHankkiInvite(studio,body,{key:KEY,now:NOW});
  return {original:studio,...invited,body,contactId:contact.result.id,id:checkin.result.id};
}

test('invitation replay reconstructs a scoped token without retaining raw credentials',()=>{
  const f=fixture();assert.match(f.token,/^v1\.2\.[A-Za-z0-9_-]{43}$/);
  assert.equal(f.studio.checkins[0].invitation.revision,2);assert.equal(f.original.checkins[0].invitation,undefined);
  const serialized=JSON.stringify(f.studio);assert.ok(!serialized.includes(f.token));assert.ok(!serialized.includes(KEY));assert.ok(!JSON.stringify(f.receipt).includes(f.token));
  const reload=JSON.parse(serialized);validateStudio(reload);
  const replay=issueHankkiInvite(reload,f.body,{key:KEY,now:NOW});assert.equal(replay.token,f.token);assert.deepEqual(replay.studio,f.studio);assert.deepEqual(replay.receipt,f.receipt);
  assert.throws(()=>issueHankkiInvite(reload,{...f.body,expectedRevision:2},{key:KEY,now:NOW}),error('request_conflict',409));
});

test('recipient view includes only scoped meal state and never contact identity or notes',()=>{
  const f=fixture(),before=JSON.stringify(f.studio),view=getHankkiRecipientView(f.studio,f.id,f.token,{key:KEY,now:NOW});
  assert.deepEqual(Object.keys(view).sort(),['answer','answeredAt','checkinId','dueAt','meal','status']);assert.equal(view.meal,'lunch');assert.equal(view.status,'pending');
  assert.ok(!JSON.stringify(view).includes('가상 가족'));assert.ok(!JSON.stringify(view).includes('@'));assert.ok(!JSON.stringify(view).includes('메모'));assert.equal(JSON.stringify(f.studio),before);
});

test('missing tokens, wrong scopes, altered MACs and changed owner keys are indistinguishable 404s',()=>{
  const f=fixture(),cases=[
    [f.id,undefined,KEY],[f.id,'',KEY],[randomUUID(),f.token,KEY],[f.id,f.token.slice(0,-1)+(f.token.endsWith('A')?'B':'A'),KEY],
    [f.id,f.token.replace('v1.2.','v1.3.'),KEY],[f.id,f.token,'another-synthetic-owner-key'],['not-an-id',f.token,KEY],[f.id,'v1.0002.invalid',KEY],
  ];
  for(const [id,token,key] of cases)assert.throws(()=>getHankkiRecipientView(f.studio,id,token,{key,now:NOW}),error('checkin_unavailable',404));
  assert.throws(()=>respondToHankkiInvite(f.studio,f.id,'invalid-token',{unknown:true},{key:KEY,now:NOW}),error('checkin_unavailable',404));
});

test('recipient response is attributed correctly, retained once, and recoverable after a lost reply',()=>{
  const f=fixture(),body={requestId:'recipient-answer-1',answer:'ate'};
  const answered=respondToHankkiInvite(f.studio,f.id,f.token,body,{key:KEY,now:DUE});
  assert.equal(answered.studio.checkins[0].recordedBy,'recipient');assert.equal(answered.view.answer,'ate');assert.equal(answered.view.answeredAt,DUE);assert.equal(answered.studio.checkins[0].responseNote,'');
  assert.equal(answered.studio.receipts.at(-1).requestId,`hankki:${f.id}:${body.requestId}`);
  validateStudio(JSON.parse(JSON.stringify(answered.studio)));
  const replay=respondToHankkiInvite(JSON.parse(JSON.stringify(answered.studio)),f.id,f.token,body,{key:KEY,now:'2026-09-12T14:00:00Z'});assert.deepEqual(replay,answered);
  assert.throws(()=>respondToHankkiInvite(answered.studio,f.id,f.token,{...body,answer:'not_yet'},{key:KEY,now:DUE}),error('request_conflict',409));
  assert.throws(()=>respondToHankkiInvite(answered.studio,f.id,f.token,{requestId:'second-answer',answer:'not_yet'},{key:KEY,now:DUE}),error('revision_conflict',409));
  assert.equal(f.studio.checkins[0].status,'pending');
});

test('a new or missing recipient response cannot be written after the deadline',()=>{
  const f=fixture(),late='2026-09-12T13:00:00.001Z';
  assert.throws(()=>getHankkiRecipientView(f.studio,f.id,f.token,{key:KEY,now:late}),error('checkin_unavailable',404));
  assert.throws(()=>respondToHankkiInvite(f.studio,f.id,f.token,{requestId:'late',answer:'ate'},{key:KEY,now:late}),error('checkin_unavailable',404));
  assert.equal(f.studio.checkins[0].status,'pending');
});

test('owner revocation and check-in cancellation immediately invalidate previously copied links',()=>{
  const f=fixture(),revoked=revokeHankkiInvite(f.studio,{requestId:'revoke',checkinId:f.id,expectedRevision:2},{now:NOW});
  assert.equal(revoked.studio.checkins[0].invitation.status,'revoked');assert.equal(revoked.studio.checkins[0].status,'pending');
  assert.throws(()=>getHankkiRecipientView(revoked.studio,f.id,f.token,{key:KEY,now:NOW}),error('checkin_unavailable',404));
  const oldReplay=issueHankkiInvite(revoked.studio,f.body,{key:KEY,now:NOW});assert.equal(oldReplay.token,f.token);assert.equal(oldReplay.invitation.active,false);
  const cancelled=applyStudioAction(f.studio,{action:'checkin.cancel',requestId:'cancel',id:f.id,expectedRevision:2},{now:NOW});assert.equal(cancelled.studio.checkins[0].invitation.status,'revoked');
  assert.throws(()=>getHankkiRecipientView(cancelled.studio,f.id,f.token,{key:KEY,now:NOW}),error('checkin_unavailable',404));
});

test('rotating a link preserves old receipt recovery but never reactivates the old capability',()=>{
  const f=fixture(),rotated=issueHankkiInvite(f.studio,{requestId:'new-link',checkinId:f.id,expectedRevision:2},{key:KEY,now:NOW});
  assert.notEqual(rotated.token,f.token);assert.equal(rotated.invitation.revision,3);
  assert.throws(()=>getHankkiRecipientView(rotated.studio,f.id,f.token,{key:KEY,now:NOW}),error('checkin_unavailable',404));
  assert.equal(getHankkiRecipientView(rotated.studio,f.id,rotated.token,{key:KEY,now:NOW}).status,'pending');
  const old=issueHankkiInvite(rotated.studio,f.body,{key:KEY,now:NOW});assert.equal(old.token,f.token);assert.equal(old.invitation.active,false);assert.deepEqual(old.studio,rotated.studio);
});

test('consent withdrawal invalidates answered links permanently even after a later regrant',()=>{
  const f=fixture(),answered=respondToHankkiInvite(f.studio,f.id,f.token,{requestId:'answer',answer:'not_yet'},{key:KEY,now:NOW});
  const withdrawn=applyStudioAction(answered.studio,{action:'contact.update',requestId:'withdraw',id:f.contactId,expectedRevision:1,consent:'revoked',consentNote:'가상 동의 철회'},{now:'2026-09-12T12:10:00Z'});
  assert.equal(withdrawn.studio.checkins[0].status,'answered');assert.equal(withdrawn.studio.checkins[0].answer,'not_yet');assert.equal(withdrawn.studio.checkins[0].invitation.status,'revoked');
  const regrant=applyStudioAction(withdrawn.studio,{action:'contact.update',requestId:'regrant',id:f.contactId,expectedRevision:2,consent:'granted',consentNote:'가상 새 동의'},{now:'2026-09-12T12:20:00Z'});
  validateStudio(regrant.studio);assert.throws(()=>getHankkiRecipientView(regrant.studio,f.id,f.token,{key:KEY,now:'2026-09-12T12:20:00Z'}),error('checkin_unavailable',404));
});

test('recipient JSON cannot forge attribution, target, revisions or owner-level actions',()=>{
  const f=fixture();
  for(const extra of [{recordedBy:'owner'},{checkinId:randomUUID()},{expectedRevision:2},{action:'contact.update'},{note:'내부 메모'},{token:f.token}])assert.throws(()=>respondToHankkiInvite(f.studio,f.id,f.token,{requestId:'answer',answer:'ate',...extra},{key:KEY,now:NOW}),error('invalid_sharing_request',400));
  for(const requestId of ['', 'x'.repeat(81),'contains space'])assert.throws(()=>respondToHankkiInvite(f.studio,f.id,f.token,{requestId,answer:'ate'},{key:KEY,now:NOW}),error('invalid_request_id',400));
  assert.throws(()=>respondToHankkiInvite(f.studio,f.id,f.token,{requestId:'a',answer:'a'.repeat(1024)},{key:KEY,now:NOW}),error('sharing_request_too_large',400));
  assert.throws(()=>applyStudioAction(f.studio,{action:'checkin.recipientRespond',requestId:'fake-recipient',id:f.id,expectedRevision:2,answer:'ate'},{now:NOW}),error('recipient_auth_required',403));
  assert.throws(()=>issueHankkiInvite(f.studio,{...f.body,token:f.token},{key:KEY,now:NOW}),error('invalid_sharing_request',400));
});

test('old owner-recorded check-ins remain valid without any invitation metadata',()=>{
  const f=fixture();assert.equal(f.original.checkins[0].invitation,undefined);validateStudio(JSON.parse(JSON.stringify(f.original)));
  const owner=applyStudioAction(f.original,{action:'checkin.respond',requestId:'owner-answer',id:f.id,expectedRevision:1,answer:'ate'},{now:NOW});assert.equal(owner.studio.checkins[0].recordedBy,'owner');validateStudio(owner.studio);
  const forged=structuredClone(f.studio);forged.checkins[0].invitation.rawToken=f.token;assert.throws(()=>validateStudio(forged));
  assert.throws(()=>issueHankkiInvite(f.original,f.body,{key:'short',now:NOW}),error('sharing_unavailable',503));
});

test('public rate limiter counts all attempts, bounds memory, and expires without evicting active limits',()=>{
  let at=1000;const allow=createHankkiRateLimiter({limit:2,windowMs:1000,maxKeys:2,now:()=>at});
  assert.deepEqual(allow('one'),{allowed:true,retryAfterSeconds:0});assert.equal(allow('one').allowed,true);assert.deepEqual(allow('one'),{allowed:false,retryAfterSeconds:1});
  assert.equal(allow('two').allowed,true);assert.equal(allow('third-new-peer').allowed,false);assert.equal(allow('one').allowed,false);
  at=2000;assert.equal(allow('third-new-peer').allowed,true);assert.equal(allow('one').allowed,true);
});
