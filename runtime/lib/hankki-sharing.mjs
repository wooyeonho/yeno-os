import {createHmac,timingSafeEqual} from 'node:crypto';
import {applyStudioAction,validateStudio,StudioError} from './studio.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_REQUEST_ID=/^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const fail=(status,code,message)=>{throw new StudioError(status,code,message);};
const unavailable=()=>fail(404,'checkin_unavailable','이 응답 링크를 사용할 수 없습니다.');
function exact(body,keys){
  if(!object(body)||Object.keys(body).length!==keys.length||Object.keys(body).some(key=>!keys.includes(key)))fail(400,'invalid_sharing_request','응답 링크 요청 형식을 확인하세요.');
  let serialized;try{serialized=JSON.stringify(body);}catch{fail(400,'invalid_sharing_request','응답 링크 요청 형식을 확인하세요.');}
  if(Buffer.byteLength(serialized)>1024)fail(400,'sharing_request_too_large','응답 링크 요청이 너무 큽니다.');
}
function atTime(now){
  const value=typeof now==='function'?now():now instanceof Date?now.toISOString():now??new Date().toISOString();
  if(typeof value!=='string'||!/(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))fail(400,'invalid_time','현재 시각을 확인하세요.');
  return new Date(value).toISOString();
}
function signingKey(key){
  if(!(typeof key==='string'||Buffer.isBuffer(key)))fail(503,'sharing_unavailable','응답 링크 서명 설정이 준비되지 않았습니다.');
  const buffer=Buffer.from(key);if(buffer.length<16||buffer.length>4096)fail(503,'sharing_unavailable','응답 링크 서명 설정이 준비되지 않았습니다.');return buffer;
}
function signature(key,id,revision){return createHmac('sha256',key).update(`blackhole.hankki-response.v1\n${id}\n${revision}`).digest();}
function tokenFor(key,id,revision){return `v1.${revision}.${signature(key,id,revision).toString('base64url')}`;}
function publicView(checkin){return {checkinId:checkin.id,meal:checkin.meal,dueAt:checkin.dueAt,status:checkin.status,answer:checkin.answer,answeredAt:checkin.answeredAt};}
function authenticated(studio,id,token,{key,now,allowExpired=false}){
  validateStudio(studio);const signedKey=signingKey(key),at=atTime(now);
  const match=typeof token==='string'&&token.length<=100&&/^v1\.([1-9][0-9]{0,15})\.([A-Za-z0-9_-]{43})$/.exec(token);
  const revision=match?Number(match[1]):0;
  const validShape=typeof id==='string'&&UUID.test(id)&&Number.isSafeInteger(revision)&&revision>=2;
  const given=match?Buffer.from(match[2],'base64url'):Buffer.alloc(32);
  const expected=signature(signedKey,validShape?id:'00000000-0000-4000-8000-000000000000',validShape?revision:2);
  // Every authentication path performs an equal-length, constant-time MAC
  // comparison. Tokens, keys and private contact records never enter errors.
  const equal=timingSafeEqual(expected,given.length===32?given:Buffer.alloc(32));
  const canonicalMac=Boolean(match)&&given.toString('base64url')===match[2];
  const checkin=validShape?studio.checkins.find(record=>record.id===id):null;
  const contact=checkin?studio.contacts.find(record=>record.id===checkin.contactId):null;
  if(!validShape||!equal||!canonicalMac||!checkin||checkin.invitation?.revision!==revision||checkin.invitation?.status!=='active'||contact?.consent!=='granted'||checkin.status==='cancelled'||(!allowExpired&&at>checkin.dueAt))unavailable();
  return {checkin,at,revision};
}

// The caller is the existing authenticated owner API. Persist only studio and
// receipt. Never pass token or the complete return value to a mutation cache.
export function issueHankkiInvite(studio,body,{key,now}={}){
  exact(body,['requestId','checkinId','expectedRevision']);const signedKey=signingKey(key);
  const applied=applyStudioAction(studio,{action:'checkin.invite',requestId:body.requestId,id:body.checkinId,expectedRevision:body.expectedRevision},{now});
  const checkin=applied.studio.checkins.find(record=>record.id===applied.result.id),revision=applied.result.revision;
  return {studio:applied.studio,receipt:applied.result,token:tokenFor(signedKey,checkin.id,revision),invitation:{checkinId:checkin.id,revision,dueAt:checkin.dueAt,active:checkin.invitation?.revision===revision&&checkin.invitation.status==='active'&&atTime(now)<=checkin.dueAt}};
}
export function revokeHankkiInvite(studio,body,{now}={}){
  exact(body,['requestId','checkinId','expectedRevision']);
  const applied=applyStudioAction(studio,{action:'checkin.revoke',requestId:body.requestId,id:body.checkinId,expectedRevision:body.expectedRevision},{now});
  return {studio:applied.studio,receipt:applied.result};
}
export function getHankkiRecipientView(studio,checkinId,token,{key,now}={}){
  return publicView(authenticated(studio,checkinId,token,{key,now}).checkin);
}
export function respondToHankkiInvite(studio,checkinId,token,body,{key,now}={}){
  // Authenticate before interpreting the body to keep unauthenticated failures
  // indistinguishable. An accepted response can be recovered after its deadline
  // using the same request identity; a new late response remains unavailable.
  const auth=authenticated(studio,checkinId,token,{key,now,allowExpired:true});
  exact(body,['requestId','answer']);
  if(typeof body.requestId!=='string'||!PUBLIC_REQUEST_ID.test(body.requestId))fail(400,'invalid_request_id','응답 요청 번호를 확인하세요.');
  if(!['ate','not_yet'].includes(body.answer))fail(400,'invalid_answer','먹었어요 또는 아직이에요를 선택하세요.');
  const requestId=`hankki:${checkinId}:${body.requestId}`;
  const previous=studio.receipts.find(receipt=>receipt.requestId===requestId&&receipt.action==='checkin.recipientRespond'&&receipt.id===checkinId);
  if(auth.at>auth.checkin.dueAt&&!previous)unavailable();
  const applied=applyStudioAction(studio,{action:'checkin.recipientRespond',requestId,id:checkinId,expectedRevision:auth.revision,answer:body.answer},{now:auth.at,recipientAuthorization:auth.revision});
  return {studio:applied.studio,receipt:applied.result,view:publicView(applied.studio.checkins.find(record=>record.id===checkinId))};
}

// In-memory abuse control for the public endpoint, shared across successes and
// failures. Use the trusted socket peer, not arbitrary forwarded headers. Full
// capacity rejects new buckets until expiry instead of evicting live limits.
export function createHankkiRateLimiter({limit=60,windowMs=60000,maxKeys=1000,now=Date.now}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>10000||!Number.isSafeInteger(windowMs)||windowMs<1000||windowMs>3600000||!Number.isSafeInteger(maxKeys)||maxKeys<1||maxKeys>10000||typeof now!=='function')throw new Error('Invalid Hankki rate limit configuration');
  const buckets=new Map();
  return peer=>{
    const at=now();if(!Number.isFinite(at))return {allowed:false,retryAfterSeconds:Math.ceil(windowMs/1000)};
    const key=typeof peer==='string'&&peer.length>0&&peer.length<=200?peer:'unknown';
    for(const [id,bucket] of buckets)if(at>=bucket.until)buckets.delete(id);
    let bucket=buckets.get(key);
    if(!bucket){
      if(buckets.size>=maxKeys)return {allowed:false,retryAfterSeconds:Math.max(1,Math.ceil(Math.min(...[...buckets.values()].map(item=>item.until-at))/1000))};
      bucket={until:at+windowMs,count:0};buckets.set(key,bucket);
    }
    bucket.count++;return {allowed:bucket.count<=limit,retryAfterSeconds:bucket.count<=limit?0:Math.max(1,Math.ceil((bucket.until-at)/1000))};
  };
}
