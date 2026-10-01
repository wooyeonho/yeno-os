import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {initialState,openStore} from '../lib/store.mjs';
import {exportBackup,decryptBackup,restoreBackup} from '../lib/backup.mjs';
import {normalizeJarvisAddress,jarvisAddress,initialJarvisSettings} from '../lib/jarvis-settings.mjs';

const fixture=async(t,env={})=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-e-settings-'));
 const token=randomBytes(32).toString('hex');
 let core=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env});
 const call=async(route,input,credential=token)=>{
  const response=await fetch(`http://127.0.0.1:${core.server.address().port}${route}`,{method:input?'POST':'GET',headers:{Authorization:`Bearer ${credential}`,'content-type':'application/json'},...(input?{body:JSON.stringify({requestId:randomUUID(),...input})}:{})});
  return {status:response.status,body:await response.json()};
 };
 t.after(()=>{core.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,call,restart:async()=>{core.shutdown();core=await start({host:'127.0.0.1',port:0,dataDir:dir,token,env});}};
};

test('address normalizes NFC, bounds length, rejects controls, and defaults without leaking invalid env',()=>{
 assert.equal(normalizeJarvisAddress(' cafe\u0301 '),'café');
 for(const value of ['',null,'a'.repeat(33),'이름\n줄','이름\u202e'])assert.throws(()=>normalizeJarvisAddress(value));
 assert.equal(jarvisAddress(initialJarvisSettings()),'주인님');
 assert.equal(jarvisAddress(initialJarvisSettings(),{YENO_JARVIS_ADDRESS:'소유자님'}),'소유자님');
 assert.equal(jarvisAddress(initialJarvisSettings(),{YENO_JARVIS_ADDRESS:'\ninvalid'}),'주인님');
});

test('address changes persist on real core restart while native device settings writes are rejected',async t=>{
 const f=await fixture(t,{YENO_JARVIS_ADDRESS:'소유자님'});
 assert.equal((await f.call('/api/jarvis/settings')).body.address,'소유자님');
 const saved=await f.call('/api/jarvis/settings',{address:'연호님'});
 assert.equal(saved.status,200);assert.equal(saved.body.address,'연호님');
 assert.equal((await f.call('/api/jarvis/settings',{address:'x',unexpected:true})).status,400);
 assert.equal((await f.call('/api/jarvis/settings',{address:'x\n'})).status,400);
 const enrolled=await f.call('/api/v1/devices/enroll',{name:'합성 Android',platform:'android'});
 assert.equal(enrolled.status,201);
 assert.equal((await f.call('/api/jarvis/settings',{address:'침입'},enrolled.body.device.deviceToken)).status,403);
 await f.restart();
 assert.equal((await f.call('/api/jarvis/settings')).body.address,'연호님');
});

test('old snapshots restore with default address; new address survives encrypted backup',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-e-backup-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dataDir=path.join(root,'source');fs.mkdirSync(dataDir);fs.mkdirSync(path.join(dataDir,'artifacts'));
 const state=initialState(),key=randomBytes(32);
 delete state.jarvisSettings;
 const legacy=exportBackup({state,dataDir,key});
 assert.deepEqual(decryptBackup(legacy,key).state.jarvisSettings,initialJarvisSettings());
 const targetDir=path.join(root,'restored');restoreBackup({archive:legacy,key,targetDir});
 assert.deepEqual(openStore(targetDir).state.jarvisSettings,initialJarvisSettings());
 state.jarvisSettings={version:1,address:'연호님'};
 assert.equal(decryptBackup(exportBackup({state,dataDir,key}),key).state.jarvisSettings.address,'연호님');
 state.jarvisSettings.version=2;
 assert.throws(()=>exportBackup({state,dataDir,key}));
});
