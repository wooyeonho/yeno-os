import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';

// Track A server wiring: owner declaration -> durable connector state ->
// actual read (a real disk read for owner_export_json, never a caller-
// supplied object) -> readiness. A device credential must never be able to
// declare, remove, trigger a read for, or supply evidence about an external
// source - that authority is the owner pairing credential only.
//
// The real production default resolves an owner_export_json locator against
// the actual repository root; tests instead inject a throwaway directory
// (ownerExportRoot) so this suite never has to write into the checkout
// itself, which a read-only CI checkout cannot support.

async function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-outcome-connector-')),token='synthetic-owner-token';
  const exportRoot=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-owner-export-'));
  const runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env:{},ownerExportRoot:exportRoot});
  const request=async(method,route,body,headers={})=>{const r=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
  const post=(route,body={},headers)=>request('POST',route,{requestId:randomUUID(),...body},headers);
  const get=(route,headers)=>request('GET',route,undefined,headers);
  t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(exportRoot,{recursive:true,force:true});});
  return {request,post,get,exportRoot,disk:()=>openStore(dir).state};
}

function writeExport(exportRoot,records){
  const rel=`outcome-connector-test-${randomUUID()}.json`;
  fs.writeFileSync(path.join(exportRoot,rel),JSON.stringify(records));
  return rel;
}

test('a device credential cannot declare, remove, read-trigger or supply evidence for an outcome connector; owner pairing credential can',async t=>{
  const app=await setup(t);
  const enrolled=(await app.post('/api/v1/devices/enroll',{name:'Pixel',platform:'android'})).body.device;
  const deviceAuth={Authorization:`Bearer ${enrolled.deviceToken}`};
  const claim={id:'device-blocked-conn',sourceType:'payment_processor',sourceId:'stripe:acct_dev',transport:'owner_export_json',locator:'nonexistent.json',metrics:['wealth.revenue']};
  assert.equal((await app.post('/api/outcome-connectors',claim,deviceAuth)).status,403);
  assert.equal((await app.post('/api/outcome-connectors/device-blocked-conn/remove',{},deviceAuth)).status,403);
  assert.equal((await app.post('/api/outcome-connectors/device-blocked-conn/read',{},deviceAuth)).status,403);
  assert.equal((await app.post('/api/outcome-evidence',{questId:randomUUID(),jobId:randomUUID()},deviceAuth)).status,403);
  assert.equal((await app.get('/api/outcome-connectors',deviceAuth)).status,403);
  // The owner pairing credential can declare the same connector.
  const declared=await app.post('/api/outcome-connectors',claim);
  assert.equal(declared.status,201,JSON.stringify(declared.body));
  assert.equal(declared.body.connector.declaredBy,'owner');
  assert.equal(app.disk().outcomeConnectors.length,1);
});

test('owner declares an owner_export_json connector, triggers a real disk read (never a caller-supplied object), stays SYNTHETIC_VERIFIED never LIVE; emergency stop blocks the read; removal cascades readings',async t=>{
  const app=await setup(t);
  const record={metric:'wealth.revenue',value:250000,unit:'KRW',timestamp:'2026-09-01T00:00:00.000Z'};
  const rel=writeExport(app.exportRoot,[record]);
  const claim={id:'export-conn-1',sourceType:'payment_processor',sourceId:'toss:store-1',transport:'owner_export_json',locator:rel,metrics:['wealth.revenue']};
  const declared=await app.post('/api/outcome-connectors',claim);
  assert.equal(declared.status,201,JSON.stringify(declared.body));

  // Emergency stop blocks a new external read before any read is attempted.
  assert.ok([200,201].includes((await app.post('/api/control',{action:'stop'})).status));
  assert.equal((await app.post('/api/outcome-connectors/export-conn-1/read')).status,409);
  assert.ok([200,201].includes((await app.post('/api/control',{action:'resume'})).status));

  const read=await app.post('/api/outcome-connectors/export-conn-1/read');
  assert.equal(read.status,201,JSON.stringify(read.body));
  assert.equal(read.body.ok,true);
  assert.deepEqual(read.body.reading.records,[record]);
  assert.equal(read.body.reading.transport,'owner_export_json');
  const disk=app.disk();
  assert.equal(disk.outcomeReadings.length,1);
  assert.equal(disk.outcomeReadings[0].fingerprint,read.body.reading.fingerprint);

  // owner_export is structured and real (a disk read actually happened), but
  // is never treated as a live external verification.
  const readiness=(await app.get('/api/readiness')).body;
  assert.equal(readiness.outcomeVerification.externalSourceConnector,'SYNTHETIC_VERIFIED');
  assert.equal(readiness.outcomeVerification.connectors,1);

  // Removing the connector cascades its readings, so a stale reading can
  // never point at a connector the store no longer knows about.
  const removed=await app.post('/api/outcome-connectors/export-conn-1/remove');
  assert.equal(removed.status,200,JSON.stringify(removed.body));
  assert.equal(app.disk().outcomeConnectors.length,0);
  assert.equal(app.disk().outcomeReadings.length,0);
  const after=(await app.get('/api/readiness')).body;
  assert.equal(after.outcomeVerification.externalSourceConnector,'NOT_WIRED');
});

test('outcome evidence declaration is idempotent per requestId and rejects a caller claiming a model authored it',async t=>{
  const app=await setup(t);
  const claim={questId:randomUUID(),jobId:randomUUID(),artifactSha256:'a'.repeat(64),metric:'wealth.revenue',value:1,unit:'KRW',sourceType:'payment_processor',sourceId:'toss:store-1',sourceTimestamp:'2026-09-01T00:00:00.000Z',verificationType:'external_structured',authority:'external',confidence:1};
  const requestId=randomUUID();
  const first=await app.request('POST','/api/outcome-evidence',{requestId,...claim});
  assert.equal(first.status,201,JSON.stringify(first.body));
  const replay=await app.request('POST','/api/outcome-evidence',{requestId,...claim});
  assert.deepEqual(replay.body,first.body);
  assert.equal(app.disk().outcomeEvidence.length,1);
  const modelClaim={...claim,jobId:randomUUID(),authority:'model',verificationType:'internal_observed',sourceType:'model_output'};
  const rejected=await app.post('/api/outcome-evidence',modelClaim);
  assert.equal(rejected.status,400,JSON.stringify(rejected.body));
  assert.equal(app.disk().outcomeEvidence.length,1);
});
