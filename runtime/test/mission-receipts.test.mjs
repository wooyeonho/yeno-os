import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {initialState} from '../lib/store.mjs';
import {ensureMissionReceipts,verifyReceiptDirectory,verifyReceiptForMission} from '../lib/mission-receipts.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const at='2026-10-01T00:00:00.000Z';
function mission(state,dir,goal){
  const missionId=randomUUID(),jobId=randomUUID(),artifactId=randomUUID();
  const bytes=Buffer.from('synthetic evidence');
  fs.mkdirSync(path.join(dir,'artifacts'),{recursive:true});
  fs.writeFileSync(path.join(dir,'artifacts',artifactId),bytes);
  state.artifacts[artifactId]={jobId,filename:artifactId,sha256:sha(bytes)};
  state.jobs.push({id:jobId,status:'completed',artifacts:[{id:artifactId,name:'private-name'}],agentJournal:{provider:'synthetic-local',model:'synthetic-model'},
    shadowAssignment:{missionId,role:'builder',projectId:randomUUID(),goal,successCriterion:'SECRET criterion'}});
  return {missionId,artifactId};
}

test('S14 private receipts chain real artifact bytes and exclude goal/body/credentials',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-s14-receipt-'));
  const state=initialState(),first=mission(state,dir,'PRIVATE owner goal');
  let receipts=ensureMissionReceipts(state,dir,at);
  assert.equal(receipts.length,1);
  assert.equal(receipts[0].evidenceClass,'synthetic');
  assert.equal(receipts[0].published,false);
  assert.equal(receipts[0].authorizesDispatch,false);
  assert.equal(receipts[0].steps[0].artifactHashes[0].sha256,sha('synthetic evidence'));
  const page=fs.readFileSync(path.join(dir,'receipts',`${first.missionId}.html`),'utf8');
  assert.equal(page.includes('PRIVATE'),false);
  assert.equal(page.includes('SECRET'),false);
  assert.equal(page.includes('synthetic evidence'),false);
  assert.equal(page.includes('private-name'),false);
  fs.unlinkSync(path.join(dir,'receipts',`${first.missionId}.html`));
  assert.equal(ensureMissionReceipts(state,dir,at)[0].receiptHash,receipts[0].receiptHash,'restart repairs a missing page from the intact JSON receipt');
  const second=mission(state,dir,'Another private goal');
  receipts=ensureMissionReceipts(state,dir,at);
  assert.equal(receipts.length,2);
  assert.equal(receipts[1].previousHash,receipts[0].receiptHash);
  assert.equal(ensureMissionReceipts(state,dir,at).length,2,'repeat save does not duplicate');
  assert.equal(verifyReceiptDirectory(path.join(dir,'receipts')).length,2);
  fs.writeFileSync(path.join(dir,'receipts',`${second.missionId}.html`),page);
  assert.throws(()=>verifyReceiptDirectory(path.join(dir,'receipts')),/page mismatch/);
});

test('S14 artifact checksum mismatch blocks receipt instead of blessing changed bytes',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-s14-tamper-'));
  const state=initialState(),{artifactId}=mission(state,dir,'PRIVATE');
  fs.writeFileSync(path.join(dir,'artifacts',artifactId),'changed');
  assert.throws(()=>ensureMissionReceipts(state,dir,at),/integrity mismatch/);
});

test('S19 local receipt recheck verifies stored bytes but never claims external outcome',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-s19-receipt-'));
  const state=initialState(),{missionId,artifactId}=mission(state,dir,'PRIVATE');
  ensureMissionReceipts(state,dir,at);
  const result=verifyReceiptForMission(state,dir,missionId);
  assert.equal(result.receiptIntegrityVerified,true);
  assert.equal(result.externalOutcomeVerified,false);
  assert.equal(result.artifactCount,1);
  assert.equal(result.authorizesDispatch,false);
  fs.writeFileSync(path.join(dir,'artifacts',artifactId),'changed');
  assert.throws(()=>verifyReceiptForMission(state,dir,missionId),/hash mismatch/);
});
