import test from 'node:test';
import assert from 'node:assert/strict';
import {addAbsorbDraft,validateAbsorbInbox} from '../lib/absorb-inbox.mjs';
import {initialAbsorbInbox} from '../lib/gap-state.mjs';
import {initialState} from '../lib/store.mjs';
import {driveCues} from '../lib/drive-outcomes.mjs';

const at='2026-10-01T00:00:00.000Z';
const claim={sourceUrl:'https://github.com/Jakubantalik/thinking-orbs',claim:'릴이 이 도구를 추천했다',sharedReason:'소유자가 검토를 요청함',verificationStatus:'unverified'};

test('reference claim remains an inert unverified inbox record',()=>{
  const {inbox,entry}=addAbsorbDraft(initialAbsorbInbox(),{kind:'reference-claim',payload:claim,at});
  assert.equal(entry.status,'draft');assert.equal(entry.authorizesDispatch,false);
  assert.equal(entry.payload.verificationStatus,'unverified');
  const state=initialState();state.absorbInbox=inbox;
  assert.equal(Object.values(driveCues(state)).reduce((a,b)=>a+b,0),0);
  assert.throws(()=>validateAbsorbInbox({version:1,entries:[{...entry,payload:{...claim,verificationStatus:'verified'}}]}));
});

test('experiment and content drafts cannot carry a fabricated success or publication route',()=>{
  const first=addAbsorbDraft(initialAbsorbInbox(),{kind:'reference-claim',payload:claim,at});
  const experiment={claimId:first.entry.id,hypothesis:'공개 글을 쓰면 조회 기록을 얻을 수 있다',metric:'fame.views',sourceType:'analytics_platform',startAt:at,verificationStatus:'unverified',observation:null};
  const second=addAbsorbDraft(first.inbox,{kind:'experiment',payload:experiment,at});
  const content={claimId:first.entry.id,format:'card-news',title:'실험 초안',content:'출처를 확인한 뒤 소유자가 직접 게시할 초안',publicationStatus:'draft-only'};
  const third=addAbsorbDraft(second.inbox,{kind:'content-draft',payload:content,at});
  assert.equal(third.inbox.entries.length,3);assert.ok(third.inbox.entries.every(entry=>entry.authorizesDispatch===false));
  assert.throws(()=>addAbsorbDraft(third.inbox,{kind:'experiment',payload:{...experiment,success:true},at}));
  assert.throws(()=>addAbsorbDraft(third.inbox,{kind:'experiment',payload:{...experiment,metric:'invented.score'},at}));
  assert.throws(()=>addAbsorbDraft(third.inbox,{kind:'content-draft',payload:{...content,publishUrl:'https://example.org'},at}));
});
