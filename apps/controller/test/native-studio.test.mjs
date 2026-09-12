import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../../../runtime/server.mjs';
import {createCommandRequest} from '../../../runtime/public/command-request.mjs';
import {normalizeOrigin, versionedUrl, studioStorageKey, SecureRequestStorage, createStudioApi, readVerifiedFile, saveVerifiedFile, sha256} from '../src/native-studio.ts';
import {HttpFailure} from '../src/command-session.ts';

const connection = {origin:'https://core.example', deviceId:'device-a', token:'synthetic-device-token'};
const bytes = text => new TextEncoder().encode(text);
const fileResponse = async (value, headers = {}) => new Response(value, {headers:{'content-type':'text/plain; charset=utf-8','content-length':String(value.length),'x-content-sha256':await sha256(value),...headers}});

test('native studio keeps origins, devices, queries and API paths isolated', async () => {
  assert.equal(normalizeOrigin('https://core.example/'),connection.origin);
  assert.equal(versionedUrl(connection.origin,'/api/studio/export?kind=chapter&id=one'), 'https://core.example/api/v1/studio/export?kind=chapter&id=one');
  for (const path of ['https://evil.example/api/state','//evil.example/api/state','/api/../admin','/api/%2e%2e/admin','/api/studio#secret','/api/studio\\evil']) assert.throws(()=>versionedUrl(connection.origin,path));
  assert.throws(()=>normalizeOrigin('http://remote.example')); assert.throws(()=>normalizeOrigin('https://user:pass@core.example'));
  assert.notEqual(studioStorageKey(connection), studioStorageKey({...connection,deviceId:'device-b'}));
  assert.notEqual(studioStorageKey(connection), studioStorageKey({...connection,origin:'https://second.example'}));
  let calls=0;
  const api=createStudioApi({connection, isCurrent:()=>true, request:async (url,init,decode)=>{calls++; assert.equal(init.headers.authorization,`Bearer ${connection.token}`); assert.equal(new URL(url).pathname,'/api/v1/studio'); return decode(new Response('{}'));}});
  await api('/api/studio');
  for(const [path,body,options] of [['/api/control',{requestId:'a'}],['/api/studio',{}],['/api/studio?x=1',{requestId:'a'}],['/api/studio',undefined,{raw:true}]]) await assert.rejects(api(path,body,options));
  assert.equal(calls,1);
});

test('encrypted native requests persist before transport and survive lost responses across unlocks', async () => {
  const key=studioStorageKey(connection), events=[]; let durable=null, accepted=0;
  const acceptedIds=new Set();
  const write=async value=>{await Promise.resolve(); durable=value; events.push(value?'persist':'clear');};
  const storage=new SecureRequestStorage(key,null,write);
  const make=store=>createCommandRequest({storage:store,key,allowPath:p=>p==='/api/studio',makeId:()=>randomUUID(),transport:async(path,body)=>{
    assert.ok(durable); assert.equal(JSON.parse(durable).body.requestId,body.requestId); events.push('send');
    if(!acceptedIds.has(body.requestId)){acceptedIds.add(body.requestId); accepted++; throw new TypeError('lost accepted response');}
    return {result:{id:'one-place',revision:1}};
  }});
  const first=make(storage); first.stage('/api/studio',{action:'place.create',title:'암호화할 실제 메모'});
  assert.equal(durable,null); assert.equal((await first.send()).kind,'uncertain');
  assert.deepEqual(events,['persist','send']);
  const restarted=make(new SecureRequestStorage(key,durable,write));
  assert.deepEqual(restarted.pending,first.pending); assert.equal((await restarted.send()).kind,'accepted');
  assert.equal(accepted,1); assert.equal(durable,null); assert.equal(restarted.pending,null);
  assert.throws(()=>storage.getItem(studioStorageKey({...connection,deviceId:'other'})));
});

test('vault failures do not send unsaved requests or discard accepted-but-unacknowledged identities',async()=>{
  const key=studioStorageKey(connection); let failing=true, durable=null, calls=0;
  const storage=new SecureRequestStorage(key,null,async value=>{if(failing)throw new Error('vault unavailable');durable=value;});
  const requests=createCommandRequest({storage,key,allowPath:()=>true,transport:async()=>{calls++;failing=true;return {ok:true};}});
  requests.stage('/api/studio',{action:'place.create',title:'보존'});
  assert.equal((await requests.send()).kind,'uncertain'); assert.equal(calls,0);
  failing=false; const pending=requests.pending;
  assert.equal((await requests.send()).kind,'uncertain'); assert.equal(calls,1); assert.deepEqual(requests.pending,pending);
  assert.equal(JSON.parse(durable).body.requestId,pending.body.requestId);
  assert.equal(JSON.parse(storage.getItem(key)).body.requestId,pending.body.requestId);
});

test('download verifies UTF-8 text, binary MP4, size, truncation and checksum before display', async()=>{
  const text=bytes('원고와 한글 결과'); const file=await readVerifiedFile(await fileResponse(text,{'content-disposition':'attachment; filename="chapter.md"'}));
  assert.equal(new TextDecoder().decode(file.bytes),'원고와 한글 결과'); assert.equal(file.name,'chapter.md');
  const mp4=new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109]);
  assert.equal((await readVerifiedFile(await fileResponse(mp4,{'content-type':'video/mp4'}))).mime,'video/mp4');
  for(const override of [{'x-content-sha256':'0'.repeat(64)},{'content-length':'999'},{'content-length':String(9*1024*1024)},{'x-content-sha256':''},{'content-type':'video/mp4'}]) await assert.rejects(readVerifiedFile(await fileResponse(text,override)));
  await assert.rejects(readVerifiedFile(new Response(new Uint8Array(8*1024*1024+1),{headers:{'x-content-sha256':'0'.repeat(64)}})),/8 MiB/);
});

test('save completes only after reading back identical bytes and treats picker cancel as no write',async()=>{
  const file=await readVerifiedFile(await fileResponse(bytes('저장할 원고')));let written=null;
  const io={choose:async()=> 'content://synthetic-picker/chapter',write:async(path,data)=>{written=data;},read:async()=>new Uint8Array(written)};
  assert.equal(await saveVerifiedFile(file,io),true); assert.deepEqual(written,file.bytes);
  written=null; assert.equal(await saveVerifiedFile(file,{...io,choose:async()=>null}),false);assert.equal(written,null);
  await assert.rejects(saveVerifiedFile(file,{...io,read:async()=>bytes('different')}),/다시 확인/);
  await assert.rejects(saveVerifiedFile({...file,sha256:'0'.repeat(64)},io),/검증/);
});

test('connection replacement blocks unsent requests and suppresses late old-account responses',async()=>{
  let current=true,calls=0,finish;
  const api=createStudioApi({connection,isCurrent:()=>current,request:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
  const pending=api('/api/studio');current=false;finish({places:['private old account']});await assert.rejects(pending,/이전 응답/);
  await assert.rejects(api('/api/studio',{requestId:'b',action:'place.create'}),/연결이 변경/);assert.equal(calls,1);
});

test('real versioned core accepts native studio writes, replays them, exports verified bytes and revokes access',async t=>{
  const root=mkdtempSync(join(tmpdir(),'blackhole-native-studio-'));
  const owner='synthetic-native-owner-token';
  const core=await start({host:'127.0.0.1',port:0,dataDir:root,token:owner,env:{}});
  t.after(()=>{core.shutdown();rmSync(root,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${core.server.address().port}`;
  const enrollment=await fetch(`${origin}/api/v1/devices/enroll`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json',Origin:'http://tauri.localhost'},body:JSON.stringify({requestId:randomUUID(),name:'native-test',platform:'android'})}).then(r=>r.json());
  const device={origin,deviceId:enrollment.device.id,token:enrollment.device.deviceToken};
  const api=createStudioApi({connection:device,isCurrent:()=>true,request:async(url,init,decode)=>{const response=await fetch(url,{...init,redirect:'error',headers:{...init.headers,Origin:'http://tauri.localhost'}});if(!response.ok)throw new HttpFailure(response.status,(await response.json()).error);return decode(response);}});
  const body={requestId:randomUUID(),action:'place.create',title:'앱의 실제 저장 경로',note:'다시 열어도 유지'};
  const receipt=await api('/api/studio',body);assert.deepEqual(await api('/api/studio',body),receipt);
  assert.equal((await api('/api/studio')).places.length,1);
  const file=await readVerifiedFile(await api('/api/studio/export?kind=places',undefined,{raw:true}));
  assert.match(new TextDecoder().decode(file.bytes),/다시 열어도 유지/);
  assert.ok(Array.isArray((await api('/api/capabilities')).capabilities));
  const revoked=await fetch(`${origin}/api/v1/devices/revoke`,{method:'POST',headers:{authorization:`Bearer ${device.token}`,'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID()})});assert.equal(revoked.status,200);
  await assert.rejects(api('/api/studio'),e=>e.status===401);
});
