// F08 v1 default browser-sandbox-adapter tests.
//
// Two groups, deliberately kept apart per the standing synthetic/live
// evidence-separation rule:
//  - "synthetic" tests use an injected fetchPublicPage/resolveHost (no real
//    network), proving the wiring, gating and DONE-avoidance behave.
//  - the "LIVE NETWORK" test performs one real HTTPS GET against a real
//    public URL (example.com) through the actual fetchPublicPage()
//    implementation and the real DNS resolver, and is explicitly labelled as
//    such in its test name and in job.browser.evidenceClass, so it is never
//    confused with the synthetic runs above it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {fetchPublicPage, deterministicReadOnlyDecisionProvider} from '../lib/browser-adapter.mjs';

const token = 'synthetic-browser-adapter-owner-token';
const PUBLIC = 'https://example.com/';

async function setup(t, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-browser-adapter-'));
  const runtime = await start({host:'127.0.0.1',port:0,dataDir,token,...options});
  const port = runtime.server.address().port;
  const request = async (method, route, body) => {
    const response = await fetch('http://127.0.0.1:' + port + route, {method,headers:{Authorization:'Bearer ' + token,'Content-Type':'application/json'},...(body ? {body:JSON.stringify(body)} : {})});
    return {status:response.status,body:await response.json()};
  };
  const post = (route, body = {}) => request('POST',route,{requestId:randomUUID(),...body});
  const wait = async id => {
    for(let i=0;i<400;i+=1){const job=openStore(dataDir).state.jobs.find(item=>item.id===id);if(job && ['completed','failed','paused'].includes(job.status))return job;await new Promise(resolve=>setTimeout(resolve,20));}
    assert.fail('browser job did not settle');
  };
  t.after(() => {runtime.shutdown();fs.rmSync(dataDir,{recursive:true,force:true});});
  return {dataDir,post,request,wait,disk:()=>openStore(dataDir).state};
}

test('YENO_BROWSER_SANDBOX_ENABLED unset: default adapter stays off (unchanged safety default)', async t => {
  const h = await setup(t, {env:{...process.env, YENO_BROWSER_SANDBOX_ENABLED: undefined}});
  const queued = await h.post('/api/browser/harness',{goal:'테스트',sourceUrl:PUBLIC});
  assert.equal(queued.status,201);
  const job = await h.wait(queued.body.jobId);
  assert.equal(job.status,'failed');
  assert.match(job.error,/browser_harness_unavailable/);
});

test('YENO_BROWSER_SANDBOX_ENABLED=true wires a real fetch+deterministic-BLOCKED adapter (synthetic transport, no network)', async t => {
  const calls = [];
  const h = await setup(t, {
    env:{...process.env, YENO_BROWSER_SANDBOX_ENABLED:'true'},
    browserResolveHost: async () => ['93.184.216.34'],
    browserFetch: async ({url}) => { calls.push(url); return {url,title:'합성 페이지',body:'합성 본문 텍스트',links:[{text:'다음',href:'https://example.com/next'}],elements:[],revision:1,observedAt:new Date().toISOString()}; },
    browserDecisionProvider: deterministicReadOnlyDecisionProvider,
  });
  const queued = await h.post('/api/browser/harness',{goal:'제목·본문 읽기',sourceUrl:PUBLIC});
  assert.equal(queued.status,201,JSON.stringify(queued.body));
  const job = await h.wait(queued.body.jobId);
  // v1 never has a semantic verifier configured, so the job cannot reach
  // 'completed' (semanticGate stays blocked) - but the deterministic gate
  // (real fetch -> real snapshot -> real sha256 artifact) must be verified,
  // and the fetch must actually have been invoked exactly once (maxActions:1,
  // BLOCKED breaks the loop immediately).
  assert.equal(calls.length,1);
  assert.equal(calls[0],PUBLIC);
  assert.equal(job.browser.deterministicVerification.status,'verified');
  assert.equal(job.browser.selectedOperation,'BLOCKED');
  assert.equal(job.browser.provider,'sandbox-v1-read-only');
  assert.equal(job.browser.evidenceClass,'SANDBOX_SYNTHETIC'); // this test's transport is injected, not real network
  assert.equal(job.browser.sourceIntake.decision,'pending'); // never auto-promoted
  assert.match(job.error,/semantic_verification_unavailable/);
});

test('LIVE NETWORK: YENO_BROWSER_SANDBOX_ENABLED=true with the real fetchPublicPage performs one genuine HTTPS GET', async t => {
  if (process.env.YENO_SKIP_LIVE_NETWORK_TESTS === 'true') { t.skip('live network disabled for this run'); return; }
  const h = await setup(t, {
    env:{...process.env, YENO_BROWSER_SANDBOX_ENABLED:'true'},
    browserFetch: fetchPublicPage, // the REAL implementation - genuine network I/O
    browserDecisionProvider: deterministicReadOnlyDecisionProvider,
    // browserResolveHost intentionally omitted: real DNS resolution via node:dns/promises default
  });
  const queued = await h.post('/api/browser/harness',{goal:'실제 공개 페이지 읽기',sourceUrl:PUBLIC});
  assert.equal(queued.status,201,JSON.stringify(queued.body));
  const job = await h.wait(queued.body.jobId);
  assert.equal(job.browser.deterministicVerification.status,'verified');
  assert.equal(job.browser.evidenceClass,'LIVE');
  assert.equal(job.browser.provider,'sandbox-v1-read-only');
  const artifact = openStore(h.dataDir).state.artifacts[job.artifacts[0].id];
  assert.ok(artifact);
  const content = fs.readFileSync(path.join(h.dataDir,'artifacts',artifact.filename),'utf8');
  assert.match(content,/example/i); // real example.com content really was fetched
  assert.equal(job.browser.sourceIntake.decision,'pending');
});
