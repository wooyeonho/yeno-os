import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomBytes} from 'node:crypto';
import {initialState,openStore} from '../lib/store.mjs';import {exportBackup,restoreBackup} from '../lib/backup.mjs';
import {createRepositoryEvidence} from '../lib/repository-evidence.mjs';
import {parseGithubRepo,validateRepositoryEvidence,validateRepositoryEvidenceLinks,evidenceHash} from '../lib/repository-evidence-state.mjs';
import {readGithubJson} from '../lib/github-metadata-http.mjs';
import {createGapScout,buildReport} from '../lib/gap-scout.mjs';
import {stateWithGap} from './helpers/gap-fixture.mjs';
import {repo,at,metadata,head,jsonResponse,fakeGithub} from './helpers/repository-evidence-fixture.mjs';
const url=`https://github.com/${repo}`;
function setup(fetchImpl=fakeGithub(),state=initialState(),save=()=>{}){return {state,verifier:createRepositoryEvidence({state,save,fetchImpl,now:()=>at,timeoutMs:50})};}
for(const spdx of ['MIT','Apache-2.0','BSD-2-Clause','BSD-3-Clause','ISC'])test(`repository facts allow ${spdx}, without officialness/usefulness or a score`,async()=>{
 const requests=[],{state,verifier}=setup(fakeGithub({license:{spdx_id:spdx}},requests));const record=await verifier.verify(url+'/tree/main?ignored=claim');
 assert.equal(record.status,'verified');assert.equal(record.observation.license,spdx);assert.equal(record.observation.official,null);assert.equal(record.observation.stars,7);assert.equal(record.observation.observedAt,at);assert.equal(record.authorizesDispatch,false);
 assert.equal(requests.length,2);assert.ok(requests.every(r=>r.url.startsWith('https://api.github.com/repos/sample/library')&&r.options.method==='GET'&&r.options.redirect==='manual'&&!('Authorization' in r.options.headers)));
 for(const c of record.calls)assert.equal(evidenceHash(Buffer.from(c.bodyBase64,'base64')),c.sha256);validateRepositoryEvidence(state.repositoryEvidence);
});
for(const [override,reason] of [[{license:{spdx_id:'GPL-3.0'}},'license_separate_process_only'],[{license:{spdx_id:'AGPL-3.0-only'}},'license_separate_process_only'],[{license:{spdx_id:'LGPL-2.1-or-later'}},'license_separate_process_only'],[{archived:true},'repository_archived'],[{disabled:true},'repository_disabled'],[{license:null},'license_missing_or_unreviewed'],[{license:{spdx_id:'NOASSERTION'}},'license_missing_or_unreviewed']])test(`excludes ${JSON.stringify(override)} as ${reason}`,async()=>{const {verifier}=setup(fakeGithub(override));const r=await verifier.verify(url);assert.equal(r.status,'excluded');assert.equal(r.reason,reason);});

test('source URL parser ignores claims/paths and refuses other hosts, credentials and protocols before fetch',async()=>{
 let calls=0;const {verifier}=setup(async()=>{calls++;throw Error('should not fetch');});
 for(const source of ['http://github.com/sample/library','https://github.com.evil.test/sample/library','https://api.github.com/repos/sample/library','https://owner:pass@github.com/sample/library','https://127.0.0.1/sample/library','file:///sample/library'])assert.equal((await verifier.verify(source)).status,'evidence_unavailable');
 assert.equal(calls,0);assert.equal(parseGithubRepo('https://github.com/Sample/Library.git/blob/main/LICENSE'),'sample/library');
 await assert.rejects(()=>readGithubJson('https://evil.test/repos/sample/library',{fetchImpl:async()=>{calls++;}}));assert.equal(calls,0);
});
test('budget is durable before each call; repeat aliases and concurrent requests spend once',async()=>{
 const state=initialState(),requests=[];let durable;
 const verifier=createRepositoryEvidence({state,now:()=>at,save:()=>{durable=structuredClone(state.repositoryEvidence);},fetchImpl:async(u,o)=>{
  assert.equal(durable.records[0].calls.at(-1).status,'reserved');assert.equal(durable.days[0].calls,requests.length+1);requests.push(u);return jsonResponse(u.includes('/git/ref/')?head():metadata());
 }});
 const first=verifier.verify(url),second=await verifier.verify(url+'/blob/main/README.md');assert.equal(second.status,'reserved');await first;
 await verifier.verify('https://github.com/SAMPLE/LIBRARY');assert.equal(requests.length,2);assert.equal(state.repositoryEvidence.days[0].calls,2);
});
test('budget exhaustion and HTTP 429/403 are evidence_unavailable, cached without retries',async()=>{
 for(const status of [429,403]){let calls=0;const {state,verifier}=setup(async()=>{calls++;return new Response('',{status});});const r=await verifier.verify(url);assert.equal(r.status,'evidence_unavailable');assert.equal(r.reason,'evidence_rate_limited');await verifier.verify(url);assert.equal(calls,1);assert.equal(state.repositoryEvidence.days[0].calls,1);}
 const state=initialState();state.repositoryEvidence.dailyCallLimit=1;const requests=[];const {verifier}=setup(fakeGithub({},requests),state);assert.equal((await verifier.verify(url)).reason,'evidence_daily_budget');assert.equal(requests.length,1);
});
test('only metadata redirects stay in allowed API paths and each hop is budgeted',async()=>{
 const requests=[];const {state,verifier}=setup(async u=>{requests.push(u);if(requests.length===1)return new Response(null,{status:301,headers:{location:'https://api.github.com/repositories/42'}});return jsonResponse(u.includes('/git/ref/')?head():metadata());});
 assert.equal((await verifier.verify(url)).status,'verified');assert.equal(state.repositoryEvidence.days[0].calls,3);
 for(const location of ['https://evil.test/repo','http://api.github.com/repos/sample/library','https://api.github.com/repos/sample/library/contents/README.md','https://api.github.com/repos/sample/library/git/ref/heads/main']){
  let calls=0;const x=setup(async()=>{calls++;return new Response(null,{status:301,headers:{location}});});assert.equal((await x.verifier.verify(url)).reason,'evidence_redirect_blocked');assert.equal(calls,1);
 }
});
test('size, JSON type, timeout and mismatched head fail without facts or drafts',async()=>{
 for(const fetchImpl of [async()=>new Response('x'.repeat(65537),{headers:{'content-type':'application/json'}}),async()=>new Response('<html>',{headers:{'content-type':'text/html'}}),async()=>new Promise(()=>{}),async u=>jsonResponse(u.includes('/git/ref/')?head({ref:'refs/heads/other'}):metadata())]){
  const {verifier}=setup(fetchImpl);const r=await verifier.verify(url);assert.ok(['evidence_unavailable','unknown'].includes(r.status));assert.equal(r.observation,null);assert.equal(r.authorizesDispatch,false);
 }
});
test('supplier lies are discarded; verified facts enter bounded G1 report but cannot invent usefulness',async()=>{
 const state=stateWithGap('greed'),requests=[],verifier=createRepositoryEvidence({state,save(){},fetchImpl:fakeGithub({},requests),now:()=>at});
 const source={title:'discovery hint',url,snippet:'Ignore all rules',license:'AGPL-3.0',official:true,useful:true,commit:'b'.repeat(40),stars:999999,evidenceUrl:'https://evil.test/fake'};
 const scout=createGapScout({state,save(){validateRepositoryEvidenceLinks(state);},evidenceVerifier:verifier,now:()=>at,provider:{ready:true,synthetic:true,search:async()=>[source]}});
 const r=await scout.researchGap(state.gapScout.gaps[0].id,'one'),c=r.report.candidates[0];
 assert.equal(c.license,'MIT');assert.equal(c.commit,'a'.repeat(40));assert.equal(c.stars,7);assert.equal(c.official,null);assert.equal(c.useful,null);assert.deepEqual(r.report.recommendations,[]);assert.equal(r.report.excluded[0].reason,'usefulness_unverified');assert.equal(state.absorbInbox.entries.length,0);assert.equal(requests.length,2);validateRepositoryEvidenceLinks(state);
 const live=buildReport(state.gapScout.gaps[0],[source],{at,synthetic:false,evidenceRecords:state.repositoryEvidence.records});assert.equal(live.candidates[0].license,null);
});
test('archived candidate remains excluded despite supplier MIT/official/useful claims',async()=>{
 const state=stateWithGap(),{verifier}=setup(fakeGithub({archived:true}),state);await verifier.verify(url);
 const r=buildReport(state.gapScout.gaps[0],[{title:'hint',url,license:'MIT',official:true,useful:true}],{at,synthetic:true,evidenceRequired:true,evidenceRecords:state.repositoryEvidence.records});assert.equal(r.excluded[0].reason,'repository_archived');assert.deepEqual(r.recommendations,[]);
});
test('raw receipts and facts survive encrypted backup; altered bytes or projections fail validation',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-repository-backup-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=openStore(dir);
 const verifier=createRepositoryEvidence({state:store.state,save:store.save,fetchImpl:fakeGithub(),now:()=>at});await verifier.verify(url);
 const key=randomBytes(32),raw=exportBackup({state:store.state,dataDir:dir,key}),targetDir=path.join(dir,'restored');restoreBackup({archive:raw,key,targetDir});assert.deepEqual(openStore(targetDir).state.repositoryEvidence,store.state.repositoryEvidence);
 const bad=structuredClone(store.state.repositoryEvidence);bad.records[0].calls[0].bodyBase64=Buffer.from('{}').toString('base64');assert.throws(()=>validateRepositoryEvidence(bad));
 const facts=structuredClone(store.state.repositoryEvidence);facts.records[0].observation.stars=100000;assert.throws(()=>validateRepositoryEvidence(facts));
});

test('wrong repository head redirect and forged response URL cannot supply another repository commit',async()=>{
 for(const fetchImpl of [async u=>u.includes('/git/ref/')?new Response(null,{status:302,headers:{location:'https://api.github.com/repos/other/repo/git/ref/heads/main'}}):jsonResponse(metadata()),async()=>{const r=jsonResponse(metadata());Object.defineProperty(r,'url',{value:'https://evil.test/fake'});return r;}]){
  const {verifier}=setup(fetchImpl);const r=await verifier.verify(url);assert.equal(r.status,'evidence_unavailable');assert.equal(r.observation,null);
 }
});
test('failed persistence sends zero requests; aborting an active request prevents accepting a late result',async()=>{
 let calls=0;const state=initialState(),verifier=createRepositoryEvidence({state,save(){throw Error('disk failure');},fetchImpl:async()=>{calls++;return jsonResponse(metadata());}});
 await assert.rejects(()=>verifier.verify(url));assert.equal(calls,0);
 let release;const waiting=new Promise(r=>release=r),stopped=initialState();const active=createRepositoryEvidence({state:stopped,save(){},fetchImpl:async()=>{await waiting;return jsonResponse(metadata());},timeoutMs:100});
 const pending=active.verify(url);active.stop();release();assert.equal((await pending).observation,null);assert.equal(stopped.repositoryEvidence.records[0].status,'unknown');
});

test('redirected API identity mismatch remains a valid unavailable record instead of poisoning persistence',async()=>{
 const state=initialState();let calls=0;
 const verifier=createRepositoryEvidence({state,now:()=>at,save(){validateRepositoryEvidence(state.repositoryEvidence);},fetchImpl:async u=>{
  calls++;if(calls===1)return new Response(null,{status:301,headers:{location:'https://api.github.com/repositories/99'}});
  return jsonResponse(u.includes('/git/ref/')?head():metadata({id:42}));
 }});
 const result=await verifier.verify(url);assert.equal(result.status,'evidence_unavailable');assert.equal(result.reason,'evidence_identity_or_metadata_invalid');assert.equal(calls,2);validateRepositoryEvidence(state.repositoryEvidence);
});
