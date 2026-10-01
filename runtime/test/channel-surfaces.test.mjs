import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../lib/store.mjs';
import {channelPolicy,channelOverview} from '../lib/channel-surfaces.mjs';
import {start} from '../server.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';

test('S12 channel table denies code activation everywhere and leaves Telegram inbound untrusted',()=>{
  for(const channel of ['browser','android','voice','telegram']){
    const row=channelPolicy(channel);
    assert.equal(row.authorizesDispatch,false);
    assert.ok(row.denied.includes('code-activation'));
    assert.equal(row.write.includes('code-activation'),false);
  }
  assert.deepEqual(channelPolicy('telegram').read,[]);
  assert.deepEqual(channelPolicy('telegram').write,[]);
  assert.ok(channelPolicy('android').denied.includes('draft-approval'));
  assert.throws(()=>channelPolicy('untrusted'));
});

test('S12 authenticated projection contains only counts and report hash, never draft text or night markdown',()=>{
  const state=initialState();
  state.nightCycle.reports.push({cycleDate:'2026-10-01',sha256:'a'.repeat(64),markdown:'PRIVATE NIGHT CONTENT'});
  state.absorbInbox.entries.push({status:'draft',payload:{content:'PRIVATE DRAFT CONTENT'}});
  const view=channelOverview(state,'android');
  assert.equal(view.reviewDraftCount,1);
  assert.equal(view.nightReport.cycleDate,'2026-10-01');
  assert.equal(JSON.stringify(view).includes('PRIVATE'),false);
  assert.equal(view.authorizesDispatch,false);
  assert.throws(()=>channelOverview(state,'telegram'));
  assert.throws(()=>channelOverview(state,'voice'));
});

test('S12 real HTTP core exposes limited overview to paired Android, not unpaired or other device',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-s12-channel-'));
  const token=randomBytes(32).toString('hex');
  const core=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env:{}});
  t.after(()=>core.shutdown());
  const base=`http://127.0.0.1:${core.server.address().port}`;
  const get=(credential,route='/api/channel-overview')=>fetch(base+route,{headers:{Authorization:`Bearer ${credential}`}});
  const enroll=async platform=>{
    const response=await fetch(base+'/api/v1/devices/enroll',{method:'POST',headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),name:`synthetic ${platform}`,platform})});
    assert.equal(response.status,201);return (await response.json()).device.deviceToken;
  };
  const android=await enroll('android');
  const other=await enroll('desktop');
  const allowed=await get(android,'/api/v1/channel-overview');
  assert.equal(allowed.status,200);
  const view=await allowed.json();
  assert.equal(view.policy.channel,'android');
  assert.equal(view.authorizesDispatch,false);
  assert.equal(view.reviewDraftCount,0);
  assert.equal((await get(other,'/api/v1/channel-overview')).status,403);
  assert.equal((await get('invalid')).status,401);
  assert.equal((await get(token)).status,200);
});
