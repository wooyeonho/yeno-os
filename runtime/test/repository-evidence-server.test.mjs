import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomBytes,randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
test('repository evidence status is owner-only and a read never starts verification',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-evidence-http-')),token=randomBytes(32).toString('hex');
 const core=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env:{}});t.after(()=>{core.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
 const call=async(route,credential=token,body)=>{const r=await fetch(`http://127.0.0.1:${core.server.address().port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
 const first=await call('/api/gap-scout/evidence');assert.equal(first.status,200);assert.deepEqual(first.body.records,[]);assert.deepEqual(first.body.days,[]);assert.equal(first.body.authorizesDispatch,false);
 assert.equal((await call('/api/gap-scout/evidence','invalid')).status,401);
 const enrolled=await call('/api/v1/devices/enroll',token,{requestId:randomUUID(),name:'synthetic evidence test',platform:'android'});
 assert.equal((await call('/api/gap-scout/evidence',enrolled.body.device.deviceToken)).status,403);
 assert.equal((await call('/api/gap-scout/evidence',token,{})).status,405);
 assert.deepEqual((await call('/api/gap-scout/evidence')).body.records,[]);
});
