import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';

test('commands allow twenty unique owner requests per minute, reject the twenty-first, and replay an accepted ID',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-command-limit-'));
  const token='synthetic-command-limit-owner';
  const runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env:{}});
  t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${runtime.server.address().port}/api/commands`;
  const send=async requestId=>{
    const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({requestId,text:'목표 현황'})});
    return {status:response.status,headers:response.headers,body:await response.json()};
  };
  const ids=Array.from({length:21},()=>randomUUID());
  let first;
  for(const id of ids.slice(0,20)){
    const result=await send(id);
    assert.equal(result.status,201);
    first??=result;
  }
  const limited=await send(ids[20]);
  assert.equal(limited.status,429);
  assert.match(limited.headers.get('retry-after')??'',/^\d+$/);
  const replay=await send(ids[0]);
  assert.equal(replay.status,first.status);
  assert.equal(replay.body.job.id,first.body.job.id);
});

test('commands normalize harmless text while rejecting excess length and extra fields',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-command-text-'));
  const token='synthetic-command-text-owner';
  const runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env:{}});
  t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${runtime.server.address().port}/api/commands`;
  const send=async body=>{const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  const saved=await send({requestId:randomUUID(),text:'목표 저장: cafe\u0301\u0001 X'});
  assert.equal(saved.status,201);
  assert.equal(saved.body.quest.goal,'café X');
  assert.equal((await send({requestId:randomUUID(),text:'a'.repeat(2001)})).status,400);
  assert.equal((await send({requestId:randomUUID(),text:'목표 현황',extra:'unexpected'})).status,400);
});
