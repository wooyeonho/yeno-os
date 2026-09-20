import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../runtime/server.mjs';
import {openStore} from '../runtime/lib/store.mjs';
import {buildSemanticVerdict, parseSemanticVerdictDraft} from '../runtime/lib/semantic-verification.mjs';
import {runSandboxBrowserHarness} from '../runtime/lib/browser-harness.mjs';

const token = 'synthetic-browser-owner-token';
const PUBLIC = 'https://example.com/docs';
const PASS = {verdict:'pass',confidence:0.9,criteria:[{criterion:'제목·본문·링크 보존',status:'met',reason:'공개 snapshot에 세 항목이 존재한다.',evidenceRefs:['browser-artifact']}],summary:'제한된 공개 페이지 산출물이 성공 기준을 충족한다.'};
const snapshot = {url:PUBLIC,title:'공개 문서',body:'공개 본문',revision:1,observedAt:'2026-09-20T00:00:00.000Z',links:[{text:'다음',href:'https://example.com/next'}],elements:[{index:0,role:'link',text:'다음',href:'https://example.com/next'}]};
const adapter = async ({job}) => {
  const result = await runSandboxBrowserHarness({
    goal:job.browserRequest.goal, sourceUrl:job.browserRequest.sourceUrl,
    resolveHost:async () => ['93.184.216.34'],
    fetchPublicPage:async ({url}) => ({...snapshot,url}),
    decisionProvider:async input => ({operation:'WAIT',targetIndex:null,text:null,option:null,reason:'읽기 전 대기',snapshotRevision:input.page.revision}),
    maxActions:1,
  });
  return {...result,provider:'typesafe-jev',model:'synthetic-jev',providerOutcome:'settled',semanticVerification:buildSemanticVerdict({draft:parseSemanticVerdictDraft(JSON.stringify(PASS)),missionId:randomUUID(),plannerQuestId:null,builderJobId:job.id,verifierJobId:randomUUID(),artifactRefs:['browser-artifact'],provider:'synthetic-verifier',model:'synthetic-verifier',at:'2026-09-20T00:00:00.000Z'}),semanticIndependence:'independent-context'};
};

async function setup(t, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-browser-live-'));
  let runtime = await start({host:'127.0.0.1',port:0,dataDir,token,...options});
  const port = () => runtime.server.address().port;
  const request = async (method, route, body) => {
    const response = await fetch('http://127.0.0.1:' + port() + route, {method,headers:{Authorization:'Bearer ' + token,'Content-Type':'application/json'},...(body ? {body:JSON.stringify(body)} : {})});
    return {status:response.status,body:await response.json()};
  };
  const post = (route, body = {}) => request('POST',route,{requestId:randomUUID(),...body});
  const wait = async id => {
    for(let i=0;i<300;i+=1){const job=openStore(dataDir).state.jobs.find(item=>item.id===id);if(job && ['completed','failed','paused'].includes(job.status))return job;await new Promise(resolve=>setTimeout(resolve,20));}
    assert.fail('browser job did not settle');
  };
  const restart = async (next = {}) => {runtime.shutdown();runtime=await start({host:'127.0.0.1',port:0,dataDir,token,...next});};
  t.after(() => {runtime.shutdown();fs.rmSync(dataDir,{recursive:true,force:true});});
  return {dataDir,post,request,wait,restart,disk:()=>openStore(dataDir).state};
}

test('sandbox browser route creates a durable job, source draft and phone-readable result only after both gates', async t => {
  const h = await setup(t,{browserHarnessAdapter:adapter});
  const queued = await h.post('/api/browser/harness',{goal:'공개 페이지 제목·본문·링크 읽기',sourceUrl:PUBLIC});
  assert.equal(queued.status,201,JSON.stringify(queued.body));
  const job = await h.wait(queued.body.jobId);
  assert.equal(job.status,'completed',job.error);
  assert.equal(job.browser.deterministicVerification.status,'verified');
  assert.equal(job.browser.semanticVerification.verdict,'pass');
  assert.equal(job.browser.sourceIntake.readingStatus,'partial');
  assert.equal(job.browser.sourceIntake.decision,'pending');
  const phone = await h.request('GET','/api/browser/jobs/' + job.id);
  assert.equal(phone.status,200);
  assert.equal(phone.body.job.id,job.id);
  assert.equal(phone.body.browser.artifactHash,job.browser.artifactHash);
});

test('no adapter stays unavailable and deterministic output cannot become a verified result', async t => {
  const h = await setup(t);
  const queued = await h.post('/api/browser/harness',{goal:'공개 페이지 읽기',sourceUrl:PUBLIC});
  assert.equal(queued.status,201);
  const job = await h.wait(queued.body.jobId);
  assert.equal(job.status,'failed');
  assert.match(job.error,/browser_harness_unavailable/);
  const state = h.disk();
  assert.equal(state.jobs.find(item=>item.id===job.id).browser.semanticVerification,null);
});

test('duplicate admission, emergency stop and restart preserve the same browser job without auto-resume', async t => {
  const h = await setup(t);
  const first = await h.post('/api/browser/harness',{goal:'중복 방지 확인',sourceUrl:PUBLIC});
  const duplicate = await h.post('/api/browser/harness',{goal:'중복 방지 확인',sourceUrl:PUBLIC});
  assert.equal(first.status,201);
  assert.equal(duplicate.status,409);
  const id = first.body.jobId;
  await h.restart();
  const paused = h.disk().jobs.find(item=>item.id===id);
  assert.equal(paused.status,'paused');
  assert.equal(paused.pauseReason,'restart');
  const after = h.disk().jobs.filter(item=>item.id===id);
  assert.equal(after.length,1);
});
