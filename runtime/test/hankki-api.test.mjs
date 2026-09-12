import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {emptyStudio,applyStudioAction} from '../lib/studio.mjs';
import {issueHankkiInvite} from '../lib/hankki-sharing.mjs';

const OWNER='synthetic-hankki-http-owner-key-not-a-live-credential';
async function fixture(t,{studio}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-hankki-http-'));
  if(studio){const store=openStore(dir);store.state.studio=studio;store.save();}
  let core=await start({host:'127.0.0.1',port:0,dataDir:dir,token:OWNER,env:{}});
  t.after(()=>{core.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  const base=()=>`http://127.0.0.1:${core.server.address().port}`;
  const request=async(method,route,body,{auth=`Bearer ${OWNER}`,headers={}}={})=>{
    const response=await fetch(base()+route,{method,headers:{...(auth?{Authorization:auth}:{}),'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const text=await response.text();let json;if(response.headers.get('content-type')?.includes('application/json'))json=JSON.parse(text);
    return {status:response.status,json,text,headers:response.headers};
  };
  const post=(route,body,options)=>request('POST',route,{requestId:randomUUID(),...body},options);
  const get=(route,options)=>request('GET',route,undefined,options);
  const restart=async()=>{core.shutdown();core=await start({host:'127.0.0.1',port:0,dataDir:dir,token:OWNER,env:{}});};
  return {dir,base,request,post,get,restart,state:()=>openStore(dir).state};
}
async function makeCheckin(app){
  const contact=await app.post('/api/studio',{action:'contact.create',name:'HTTP 합성 가족 이름',contactInfo:'private-synthetic-contact@example.test',relationship:'합성 가족 관계',consent:'granted',consentNote:'시험용 가상 동의 경위'});
  assert.equal(contact.status,200,contact.text);
  const dueAt=new Date(Date.now()+3600000).toISOString();
  const checkin=await app.post('/api/studio',{action:'checkin.create',contactId:contact.json.result.id,dueAt,meal:'lunch',note:'응답 링크에서 공개하면 안 되는 개인 메모'});
  assert.equal(checkin.status,200,checkin.text);return {contactId:contact.json.result.id,id:checkin.json.result.id,dueAt};
}
function linkParts(result,app){
  const url=new URL(result.responseUrl);assert.equal(url.origin,app.base());assert.equal(url.pathname,'/hankki/answer');assert.equal(url.search,'');
  const fragment=new URLSearchParams(url.hash.slice(1));assert.equal(fragment.get('id'),result.invitation.checkinId);const token=fragment.get('token');assert.match(token,/^v1\.[1-9][0-9]*\.[A-Za-z0-9_-]{43}$/);return {token,url};
}
async function invited(app){
  const record=await makeCheckin(app),body={requestId:randomUUID(),checkinId:record.id,expectedRevision:1};
  const response=await app.post('/api/hankki/invite',body);assert.equal(response.status,200,response.text);
  const {token}=linkParts(response.json,app);return {...record,body,response,token,route:`/api/hankki/checkins/${record.id}`};
}
function assertNoTokenOnDisk(app,tokens){
  const disk=app.state(),text=JSON.stringify(disk);
  for(const token of tokens){assert.equal(text.includes(token),false,'raw response token leaked into persisted state');for(const name of ['state.json','state.json.bak'])if(fs.existsSync(path.join(app.dir,name)))assert.equal(fs.readFileSync(path.join(app.dir,name),'utf8').includes(token),false,`raw response token leaked into ${name}`);}
  assert.equal(text.includes(OWNER),false);return disk;
}

test('Hankki owner creates and recovers a scoped link without persisting its token',async t=>{
  const app=await fixture(t),record=await makeCheckin(app),body={requestId:randomUUID(),checkinId:record.id,expectedRevision:1};
  assert.equal((await app.post('/api/hankki/invite',body,{auth:null})).status,401);
  assert.equal((await app.get('/api/hankki/invite')).status,404);
  assert.equal((await app.post('/api/hankki/invite',body,{headers:{Origin:'https://untrusted.invalid'}})).status,403);
  assert.equal(app.state().studio.checkins[0].invitation,undefined);
  const response=await app.post('/api/hankki/invite',body);assert.equal(response.status,200,response.text);const {token}=linkParts(response.json,app);
  assert.deepEqual(response.json.result,{action:'checkin.invite',id:record.id,revision:2});assert.equal(response.json.invitation.active,true);
  assert.deepEqual((await app.post('/api/hankki/invite',body)).json,response.json);
  assertNoTokenOnDisk(app,[token]);
  await app.restart();const replay=await app.post('/api/hankki/invite',body);assert.equal(replay.status,200,replay.text);assert.equal(linkParts(replay.json,app).token,token);assert.deepEqual(replay.json.result,response.json.result);
  assert.equal(app.state().studio.checkins.length,1);assert.equal(app.state().studio.checkins[0].revision,2);assertNoTokenOnDisk(app,[token]);
});

test('Hankki registered owner device can create a scoped link without exposing its device credential',async t=>{
  const app=await fixture(t),record=await makeCheckin(app);
  const enrollment=await app.post('/api/v1/devices/enroll',{name:'synthetic-scoped-device',platform:'android'});assert.equal(enrollment.status,201);
  const deviceToken=enrollment.json.device.deviceToken,body={requestId:randomUUID(),checkinId:record.id,expectedRevision:1};
  const response=await app.post('/api/v1/hankki/invite',body,{auth:`Bearer ${deviceToken}`,headers:{Origin:'http://tauri.localhost'}});
  assert.equal(response.status,200,response.text);const {token}=linkParts(response.json,app);assert.equal(response.text.includes(deviceToken),false);
  assert.equal((await app.get(`/api/hankki/checkins/${record.id}`,{auth:`Checkin ${token}`})).status,200);assertNoTokenOnDisk(app,[token,deviceToken]);
});

test('Hankki public scope works without owner auth and exposes no contact information',async t=>{
  const app=await fixture(t),f=await invited(app),auth=`Checkin ${f.token}`;
  const response=await app.get(f.route,{auth});assert.equal(response.status,200,response.text);assert.equal(response.json.ok,true);
  assert.deepEqual(Object.keys(response.json.checkin).sort(),['answer','answeredAt','checkinId','dueAt','meal','status']);
  assert.equal(response.json.checkin.checkinId,f.id);assert.equal(response.json.checkin.status,'pending');assert.equal(response.json.checkin.meal,'lunch');
  for(const secret of ['합성 가족','private-synthetic-contact','개인 메모',OWNER,f.token])assert.equal(response.text.includes(secret),false);
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  const unauthorized=[];
  for(const supplied of [null,`Bearer ${OWNER}`,'Checkin invalid-token',`Checkin ${f.token.slice(0,-4)}AAAA`])unauthorized.push(await app.get(f.route,{auth:supplied}));
  unauthorized.push(await app.get(`/api/hankki/checkins/${randomUUID()}`,{auth}));
  unauthorized.push(await app.get(`${f.route}?token=${encodeURIComponent(f.token)}`,{auth:null}));
  for(const result of unauthorized){assert.equal(result.status,404,result.text);assert.deepEqual(result.json,unauthorized[0].json);}
  const viewBefore=app.state().studio;
  assert.equal((await app.get(f.route,{auth})).status,200);assert.deepEqual(app.state().studio,viewBefore,'public GET changed durable state');
});

test('Hankki recipient response commits once and survives replay, restart and conflicting input',async t=>{
  const app=await fixture(t),f=await invited(app),auth=`Checkin ${f.token}`,body={requestId:randomUUID(),answer:'ate'};
  assert.equal((await app.post(f.route,{...body,contactId:randomUUID()},{auth})).status,400);
  assert.equal((await app.post(f.route,{...body,recordedBy:'owner'},{auth})).status,400);
  assert.equal((await app.post('/api/studio',{action:'checkin.recipientRespond',id:f.id,expectedRevision:2,answer:'ate'})).status,400);
  const accepted=await app.post(f.route,body,{auth});assert.equal(accepted.status,200,accepted.text);assert.equal(accepted.json.ok,true);assert.equal(accepted.json.checkin.answer,'ate');
  const receiptCount=app.state().studio.receipts.length;
  assert.deepEqual((await app.post(f.route,body,{auth})).json,accepted.json);assert.equal(app.state().studio.receipts.length,receiptCount);
  assert.equal((await app.post(f.route,{...body,answer:'not_yet'},{auth})).status,409);
  assert.equal((await app.post(f.route,{requestId:randomUUID(),answer:'not_yet'},{auth})).status,409);
  const stored=assertNoTokenOnDisk(app,[f.token]);assert.equal(stored.studio.checkins[0].recordedBy,'recipient');assert.equal(stored.studio.checkins[0].answer,'ate');
  assert.equal(stored.studio.receipts.filter(receipt=>receipt.action==='checkin.recipientRespond').length,1);
  await app.restart();assert.deepEqual((await app.post(f.route,body,{auth})).json,accepted.json);assert.equal((await app.get(f.route,{auth})).json.checkin.status,'answered');assertNoTokenOnDisk(app,[f.token]);
});

test('Hankki global stop blocks new invitations and replies while allowing reads and link revocation',async t=>{
  const app=await fixture(t),f=await invited(app),auth=`Checkin ${f.token}`;
  assert.equal((await app.post('/api/control',{action:'stop'})).status,200);
  const revision=app.state().studio.revision;
  assert.equal((await app.post('/api/hankki/invite',{checkinId:f.id,expectedRevision:2})).status,409);
  assert.equal((await app.post(f.route,{answer:'ate'},{auth})).status,409);
  assert.equal(app.state().studio.revision,revision);assert.equal((await app.get(f.route,{auth})).status,200);
  const revoke={requestId:randomUUID(),checkinId:f.id,expectedRevision:2};
  const result=await app.post('/api/hankki/revoke',revoke);assert.equal(result.status,200,result.text);assert.equal(app.state().studio.checkins[0].invitation.status,'revoked');
  assert.deepEqual((await app.post('/api/hankki/revoke',revoke)).json,result.json);
  assert.equal((await app.get(f.route,{auth})).status,404);assert.equal(app.state().studio.checkins[0].status,'pending');
  assert.equal((await app.post('/api/control',{action:'resume'})).status,200);assert.equal((await app.post(f.route,{answer:'ate'},{auth})).status,404);assertNoTokenOnDisk(app,[f.token]);
});

test('Hankki consent withdrawal permanently closes a copied link after a recorded response',async t=>{
  const app=await fixture(t),f=await invited(app),auth=`Checkin ${f.token}`;
  const response=await app.post(f.route,{answer:'not_yet'},{auth});assert.equal(response.status,200,response.text);const answeredAt=response.json.checkin.answeredAt;
  assert.equal((await app.post('/api/studio',{action:'contact.update',id:f.contactId,expectedRevision:1,consent:'revoked',consentNote:'시험용 동의 철회'})).status,200);
  assert.equal((await app.get(f.route,{auth})).status,404);
  assert.equal((await app.post('/api/studio',{action:'contact.update',id:f.contactId,expectedRevision:2,consent:'granted',consentNote:'시험용 새 동의'})).status,200);
  assert.equal((await app.get(f.route,{auth})).status,404);const checkin=app.state().studio.checkins[0];assert.equal(checkin.answer,'not_yet');assert.equal(checkin.answeredAt,answeredAt);assert.equal(checkin.invitation.status,'revoked');
});

test('Hankki expired scoped credentials fail through the real HTTP route',async t=>{
  const at=new Date(Date.now()-7200000).toISOString(),dueAt=new Date(Date.now()-3600000).toISOString();
  const contact=applyStudioAction(emptyStudio(),{action:'contact.create',requestId:'old-contact',name:'지난 요청용 가상 연락처',consent:'granted',consentNote:'가상 동의 기록'},{now:at});
  const checkin=applyStudioAction(contact.studio,{action:'checkin.create',requestId:'old-checkin',contactId:contact.result.id,dueAt,meal:'breakfast'},{now:at});
  const invite=issueHankkiInvite(checkin.studio,{requestId:'old-invite',checkinId:checkin.result.id,expectedRevision:1},{key:OWNER,now:at});
  const app=await fixture(t,{studio:invite.studio}),route=`/api/hankki/checkins/${checkin.result.id}`,auth=`Checkin ${invite.token}`;
  assert.equal((await app.get(route,{auth})).status,404);assert.equal((await app.post(route,{answer:'ate'},{auth})).status,404);assert.equal(app.state().studio.checkins[0].status,'pending');assertNoTokenOnDisk(app,[invite.token]);
});

test('Hankki recipient page and local assets are available without an owner credential',async t=>{
  const app=await fixture(t),html=await app.get('/hankki/answer',{auth:null});
  assert.equal(html.status,200,html.text);assert.match(html.headers.get('content-type'),/^text\/html/);assert.match(html.text,/<title>한끼안부/);assert.match(html.text,/name="referrer" content="no-referrer"/);assert.match(html.text,/src="\/hankki-answer\.mjs"/);assert.match(html.text,/href="\/hankki-answer\.css"/);
  const js=await app.get('/hankki-answer.mjs',{auth:null}),css=await app.get('/hankki-answer.css',{auth:null});
  assert.equal(js.status,200);assert.match(js.headers.get('content-type'),/javascript/);assert.match(js.text,/location\.hash/);assert.match(js.text,/Authorization:`Checkin \$\{token\}`/);
  assert.equal(css.status,200);assert.match(css.headers.get('content-type'),/^text\/css/);assert.ok(css.text.includes('answer-card'));
  assert.equal((await app.request('HEAD','/hankki/answer',undefined,{auth:null})).status,200);
  assert.equal(app.state().studio.checkins.length,0);
});
