import {createHash, randomUUID} from 'node:crypto';

// Owner-private, durable records. This module has no transport, publishing,
// geolocation, notification or model access. Consent and answers are reports
// recorded by the authenticated owner, not independently verified statements.
export const STUDIO_LIMITS = Object.freeze({places:1000,contacts:500,checkins:5000,series:100,chapters:3000,receipts:20000,chapterHistory:100,consentHistory:102,ordinaryConsentHistory:100,bytes:6*1024*1024});
const COLLECTIONS = {place:'places',contact:'contacts',checkin:'checkins',series:'series',chapter:'chapters'};
const COMMON = ['id','revision','createdAt','updatedAt','archivedAt'];
const FIELDS = {
  place:['title','note','address','url','coordinates','visitedAt','tags'],
  contact:['name','relationship','contactInfo','consent','consentNote'],
  series:['title','genre','premise','characters','outline'],
  chapter:['title','number','content','notes'],
};
const ACTION_FIELDS = {
  'place.create':FIELDS.place,'place.update':['id','expectedRevision',...FIELDS.place],'place.archive':['id','expectedRevision'],
  'contact.create':FIELDS.contact,'contact.update':['id','expectedRevision',...FIELDS.contact],
  'checkin.create':['contactId','dueAt','meal','note'],
  'checkin.respond':['id','expectedRevision','answer','note'],'checkin.cancel':['id','expectedRevision','reason'],
  'checkin.invite':['id','expectedRevision'],'checkin.revoke':['id','expectedRevision'],
  'checkin.recipientRespond':['id','expectedRevision','answer'],
  'series.create':FIELDS.series,'series.update':['id','expectedRevision',...FIELDS.series],
  'chapter.create':['seriesId',...FIELDS.chapter],'chapter.update':['id','expectedRevision',...FIELDS.chapter],'chapter.archive':['id','expectedRevision'],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const CONSENTS = ['not_asked','granted','revoked'];
const MEALS = ['breakfast','lunch','dinner','other'];
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const hash = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const integer = (value,min=0,max=Number.MAX_SAFE_INTEGER-1) => Number.isSafeInteger(value) && value>=min && value<=max;
const owns = (value,key) => Object.hasOwn(value,key);
export class StudioError extends Error {
  constructor(status,code,message){super(message);this.name='StudioError';this.status=status;this.code=code;}
}
const fail = (code,message,status=400) => {throw new StudioError(status,code,message);};
function exact(value,fields){
  if(!object(value)||Object.keys(value).some(key=>!fields.includes(key))||fields.some(key=>!owns(value,key)))fail('invalid_studio','저장된 운영 기록의 형식이 올바르지 않습니다.');
}
function text(value,label,max,{empty=false,trim=true}={}){
  if(typeof value!=='string'||value.length>max||CONTROL.test(value)||(!empty&&!value.trim()))fail('invalid_field',`${label} 입력을 확인하세요. 최대 ${max}자입니다.`);
  return trim?value.trim():value;
}
function optional(body,key,max,empty=true){return owns(body,key)?text(body[key],key,max,{empty}):'';}
function instant(value,label='시각'){
  const m=typeof value==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if(!m)fail('invalid_time',`${label}에는 UTC 또는 시간대가 포함된 날짜가 필요합니다.`);
  const [year,month,day,hour,minute,second]=[m[1],m[2],m[3],m[4],m[5],m[6]??'0'].map(Number);
  const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(month<1||month>12||day<1||day>days[month-1]||hour>23||minute>59||second>59||(m[8]!=='Z'&&(Number(m[10])>14||Number(m[11])>59||(Number(m[10])===14&&Number(m[11])!==0)))||!Number.isFinite(Date.parse(value)))fail('invalid_time',`${label}의 날짜와 시간대를 확인하세요.`);
  return new Date(value).toISOString();
}
function persistedInstant(value){if(instant(value)!==value)fail('invalid_studio','저장 시각은 UTC 형식이어야 합니다.');}
function nowValue(now){return instant(typeof now==='function'?now():now instanceof Date?now.toISOString():now??new Date().toISOString(),'현재 시각');}
function canonical(value,depth=0){
  if(depth>4)fail('invalid_request','요청 구조가 너무 깊습니다.');
  if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value)){if(value.length>30)fail('invalid_request','요청 목록이 너무 큽니다.');return '['+value.map(item=>canonical(item,depth+1)).join(',')+']';}
  if(object(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key],depth+1)).join(',')+'}';
  fail('invalid_request','요청은 올바른 JSON 값이어야 합니다.');
}
function coordinates(value){
  if(value===null)return null;
  exact(value,['latitude','longitude']);
  if(typeof value.latitude!=='number'||!Number.isFinite(value.latitude)||Math.abs(value.latitude)>90||typeof value.longitude!=='number'||!Number.isFinite(value.longitude)||Math.abs(value.longitude)>180)fail('invalid_coordinates','위도는 -90~90, 경도는 -180~180의 숫자여야 합니다.');
  return {latitude:value.latitude,longitude:value.longitude};
}
function safeUrl(value){
  const v=text(value,'URL',2000,{empty:true});if(v==='')return v;
  let url;try{url=new URL(v);}catch{fail('invalid_url','http 또는 https 주소를 입력하세요.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)fail('invalid_url','로그인 정보가 없는 http 또는 https 주소를 입력하세요.');
  return v;
}
function tags(value){
  if(!Array.isArray(value)||value.length>20)fail('invalid_tags','태그는 최대 20개입니다.');
  const result=value.map(v=>text(v,'태그',40));if(new Set(result).size!==result.length)fail('invalid_tags','중복 태그를 제거하세요.');return result;
}
function placeFields(body,existing){
  const base=existing??{title:'',note:'',address:'',url:'',coordinates:null,visitedAt:null,tags:[]};
  for(const key of FIELDS.place){if(!owns(body,key))continue;
    base[key]=key==='coordinates'?coordinates(body[key]):key==='visitedAt'?(body[key]===null?null:instant(body[key],'방문 시각')):key==='tags'?tags(body[key]):key==='url'?safeUrl(body[key]):text(body[key],key,{title:160,note:12000,address:1000}[key],{empty:key!=='title',trim:key!=='note'});
  }
  text(base.title,'장소 이름',160);return base;
}
function contactFields(body,existing){
  const base=existing??{name:'',relationship:'',contactInfo:'',consent:'not_asked',consentNote:''};
  for(const key of FIELDS.contact){if(!owns(body,key))continue;
    if(key==='consent'){if(!CONSENTS.includes(body[key]))fail('invalid_consent','동의 상태를 확인하세요.');base[key]=body[key];}
    else base[key]=text(body[key],key,{name:160,relationship:160,contactInfo:500,consentNote:2000}[key],{empty:key!=='name'});
  }
  text(base.name,'이름',160);if(base.consent==='granted'&&!base.consentNote.trim())fail('consent_evidence_required','동의를 받은 경위와 시점을 동의 메모에 기록하세요.');return base;
}
function seriesFields(body,existing){
  const base=existing??{title:'',genre:'',premise:'',characters:'',outline:''};
  for(const key of FIELDS.series)if(owns(body,key))base[key]=text(body[key],key,{title:200,genre:160,premise:12000,characters:20000,outline:20000}[key],{empty:key!=='title',trim:['title','genre'].includes(key)});
  text(base.title,'작품 이름',200);return base;
}
function chapterFields(body,existing){
  const base=existing??{title:'',number:null,content:'',notes:''};
  for(const key of FIELDS.chapter){if(!owns(body,key))continue;
    if(key==='number'){if(!integer(body[key],1,10000))fail('invalid_chapter_number','회차는 1~10000 정수여야 합니다.');base.number=body[key];}
    else base[key]=text(body[key],key,{title:200,content:60000,notes:10000}[key],{empty:key!=='title',trim:key==='title'});
  }
  text(base.title,'회차 제목',200);if(!integer(base.number,1,10000))fail('invalid_chapter_number','회차는 1~10000 정수여야 합니다.');
  return base;
}
export function emptyStudio(){return {schema:1,revision:0,places:[],contacts:[],checkins:[],series:[],chapters:[],receipts:[]};}
// Closing a pending check-in and separately revoking its link can consume two
// receipts. Consent can move granted -> not_asked -> revoked, never back, while
// using this reserve. Ordinary writes must leave enough room for every such
// remaining transition. The byte bounds include worst-case JSON escaping of
// the existing 2,000-character closing notes; no shorter emergency form is
// required, and accepted history is never evicted to make space.
function safetyReserve(value){
  const pending=value.checkins.filter(record=>record.status==='pending').length;
  const links=value.checkins.filter(record=>record.invitation?.status==='active').length;
  const withdrawals=value.contacts.reduce((sum,record)=>sum+(record.consent==='granted'?2:record.consent==='not_asked'?1:0),0);
  return {reservedReceiptSlots:pending+links+withdrawals,reservedBytes:pending*14000+links*1500+withdrawals*26000};
}
function storageCapacity(value){
  const reserve=safetyReserve(value);
  return {bytes:Buffer.byteLength(JSON.stringify(value)),maxBytes:STUDIO_LIMITS.bytes,receiptCount:value.receipts.length,maxReceipts:STUDIO_LIMITS.receipts,...reserve,ordinaryReceiptLimit:STUDIO_LIMITS.receipts-reserve.reservedReceiptSlots,ordinaryMaxBytes:STUDIO_LIMITS.bytes-reserve.reservedBytes};
}
export function isStudioSafetyAction(value,body){
  if(!object(body)||!object(value))return false;
  if(body.action==='checkin.cancel')return value.checkins?.some(record=>record.id===body.id&&record.status==='pending')===true;
  if(body.action==='checkin.revoke')return value.checkins?.some(record=>record.id===body.id&&record.invitation?.status==='active')===true;
  if(body.action!=='contact.update')return false;
  const contact=value.contacts?.find(record=>record.id===body.id);if(!contact)return false;
  const withdraw=body.consent==='revoked'&&contact.consent!=='revoked'||body.consent==='not_asked'&&contact.consent==='granted';
  if(!withdraw)return false;
  // The normal contact editor submits all fields. Unchanged name/relationship/
  // contact info are permitted; unrelated edits cannot spend closing reserves.
  return Object.keys(body).every(key=>['action','requestId','id','expectedRevision','consent','consentNote'].includes(key)||['name','relationship','contactInfo'].includes(key)&&typeof body[key]==='string'&&body[key].trim()===contact[key]);
}
function requireOrdinaryCapacity(value){
  const capacity=storageCapacity(value);
  if(capacity.receiptCount>capacity.ordinaryReceiptLimit||capacity.bytes>capacity.ordinaryMaxBytes)fail('studio_capacity','일반 기록 한도에 도달했습니다. 안부 취소·응답 링크 폐기·동의 철회를 위한 공간은 남겨 두었습니다.',409);
}
function validateCommon(record,fields,ids){
  exact(record,[...COMMON,...fields]);
  if(typeof record.id!=='string'||!UUID.test(record.id)||ids.has(record.id)||!integer(record.revision,1))fail('invalid_studio','기록 ID 또는 수정 번호가 손상되었습니다.');
  ids.add(record.id);persistedInstant(record.createdAt);persistedInstant(record.updatedAt);
  if(record.updatedAt<record.createdAt)fail('invalid_studio','수정 시각이 생성 시각보다 빠릅니다.');
  if(record.archivedAt!==null){persistedInstant(record.archivedAt);if(record.archivedAt!==record.updatedAt)fail('invalid_studio','보관 기록 시각이 손상되었습니다.');}
}
function chapterSnapshot(chapter){return {revision:chapter.revision,title:chapter.title,number:chapter.number,content:chapter.content,notes:chapter.notes,contentSha256:chapter.contentSha256,archivedAt:chapter.archivedAt,at:chapter.updatedAt};}
export function validateStudio(value){
  exact(value,['schema','revision',...Object.values(COLLECTIONS),'receipts']);
  if(value.schema!==1||!integer(value.revision))fail('invalid_studio','운영 기록 버전이 올바르지 않습니다.');
  for(const key of [...Object.values(COLLECTIONS),'receipts'])if(!Array.isArray(value[key])||value[key].length>STUDIO_LIMITS[key])fail('studio_capacity','운영 기록 수가 저장 한도를 초과했습니다.',409);
  const ids=new Set();
  for(const record of value.places){validateCommon(record,FIELDS.place,ids);placeFields(record);if(record.visitedAt!==null)persistedInstant(record.visitedAt);}
  for(const record of value.contacts){
    validateCommon(record,[...FIELDS.contact,'consentSource','consentHistory'],ids);contactFields(record);
    if(record.archivedAt!==null||record.consentSource!=='owner_report'||!Array.isArray(record.consentHistory)||record.consentHistory.length<1||record.consentHistory.length>STUDIO_LIMITS.consentHistory)fail('invalid_studio','동의 기록이 손상되었습니다.');
    let previousRevision=0,previousAt=record.createdAt;
    for(const entry of record.consentHistory){
      exact(entry,['consent','note','revision','at']);persistedInstant(entry.at);text(entry.note,'동의 메모',2000,{empty:true});
      if(!CONSENTS.includes(entry.consent)||(entry.consent==='granted'&&!entry.note.trim())||!integer(entry.revision,1,record.revision)||entry.revision<=previousRevision||entry.at<previousAt||entry.at>record.updatedAt)fail('invalid_studio','동의 변경 이력이 손상되었습니다.');
      previousRevision=entry.revision;previousAt=entry.at;
    }
    const latest=record.consentHistory.at(-1);if(latest.consent!==record.consent||latest.note!==record.consentNote)fail('invalid_studio','현재 동의와 변경 이력이 다릅니다.');
  }
  for(const record of value.series){validateCommon(record,FIELDS.series,ids);seriesFields(record);if(record.archivedAt!==null)fail('invalid_studio','작품 보관 기능은 제공되지 않습니다.');}
  for(const record of value.chapters){
    validateCommon(record,[...FIELDS.chapter,'seriesId','contentSha256','history'],ids);chapterFields(record);
    if(!value.series.some(s=>s.id===record.seriesId)||record.contentSha256!==hash(record.content)||!Array.isArray(record.history)||record.history.length>STUDIO_LIMITS.chapterHistory||record.history.length!==record.revision-1)fail('invalid_studio','원고 또는 회차 이력이 손상되었습니다.');
    let previousAt=record.createdAt;
    for(const [index,entry] of record.history.entries()){
      exact(entry,['revision','title','number','content','notes','contentSha256','archivedAt','at']);chapterFields(entry);persistedInstant(entry.at);
      if(entry.revision!==index+1||entry.contentSha256!==hash(entry.content)||entry.archivedAt!==null||entry.at<previousAt||entry.at>record.updatedAt)fail('invalid_studio','이전 원고 이력이 손상되었습니다.');previousAt=entry.at;
    }
  }
  const chapterNumbers=new Set();for(const c of value.chapters.filter(c=>c.archivedAt===null)){const key=`${c.seriesId}:${c.number}`;if(chapterNumbers.has(key))fail('invalid_studio','활성 회차 번호가 중복됩니다.');chapterNumbers.add(key);}
  for(const record of value.checkins){
    validateCommon(record,['contactId','contactName','consentRevision','dueAt','meal','note','status','answer','answeredAt','responseNote','cancelledAt','cancelReason','recordedBy','delivery',...(owns(record,'invitation')?['invitation']:[])],ids);
    text(record.contactName,'연락처 이름',160);text(record.note,'안부 메모',2000,{empty:true});text(record.responseNote,'응답 메모',2000,{empty:true});text(record.cancelReason,'취소 이유',2000,{empty:true});persistedInstant(record.dueAt);
    const contact=value.contacts.find(c=>c.id===record.contactId),consent=contact?.consentHistory.find(entry=>entry.revision===record.consentRevision);
    if(!contact||record.archivedAt!==null||!MEALS.includes(record.meal)||!['owner','recipient'].includes(record.recordedBy)||record.delivery!=='not_sent'||!['pending','answered','cancelled'].includes(record.status)||record.dueAt<=record.createdAt||Date.parse(record.dueAt)-Date.parse(record.createdAt)>86400000)fail('invalid_studio','안부 요청이 손상되었습니다.');
    if(!consent||consent.consent!=='granted'||consent.at>record.createdAt)fail('invalid_studio','안부 생성 당시의 동의 기록을 확인할 수 없습니다.');
    if(owns(record,'invitation')){
      const invitation=record.invitation;exact(invitation,['revision','issuedAt','status','revokedAt']);persistedInstant(invitation.issuedAt);
      if(!integer(invitation.revision,2,record.revision)||invitation.issuedAt<record.createdAt||invitation.issuedAt>record.updatedAt||invitation.issuedAt>record.dueAt||!['active','revoked'].includes(invitation.status))fail('invalid_studio','안부 응답 링크 기록이 손상되었습니다.');
      if(invitation.status==='active'&&(invitation.revokedAt!==null||contact.consent!=='granted'||record.status==='cancelled'))fail('invalid_studio','활성 응답 링크 기록이 손상되었습니다.');
      if(invitation.status==='revoked'){persistedInstant(invitation.revokedAt);if(invitation.revokedAt<invitation.issuedAt||invitation.revokedAt>record.updatedAt)fail('invalid_studio','폐기된 응답 링크 기록이 손상되었습니다.');}
    }
    if(record.recordedBy==='recipient'&&(record.status!=='answered'||!record.invitation))fail('invalid_studio','수신자 응답의 링크 기록이 없습니다.');
    if(record.status==='pending'&&(contact.consent!=='granted'||record.answer!==null||record.answeredAt!==null||record.cancelledAt!==null||record.responseNote!==''||record.cancelReason!==''))fail('invalid_studio','대기 안부 기록이 손상되었습니다.');
    if(record.status==='answered'){
      persistedInstant(record.answeredAt);
      if(!['ate','not_yet'].includes(record.answer)||record.answeredAt<record.createdAt||record.answeredAt>record.dueAt||record.answeredAt>record.updatedAt||record.cancelledAt!==null||record.cancelReason!=='')fail('invalid_studio','안부 응답이 손상되었습니다.');
    }
    if(record.status==='cancelled'){
      persistedInstant(record.cancelledAt);
      if(record.cancelledAt!==record.updatedAt||record.cancelledAt<record.createdAt||record.answer!==null||record.answeredAt!==null||record.responseNote!=='')fail('invalid_studio','취소된 안부 기록이 손상되었습니다.');
    }
  }
  const indexes=Object.fromEntries(Object.values(COLLECTIONS).map(key=>[key,new Map(value[key].map(record=>[record.id,record]))]));
  const receiptIds=new Set(),creationReceipts=new Map();let previousAt='';
  for(const receipt of value.receipts){
    exact(receipt,['requestId','payloadHash','action','id','revision','at']);persistedInstant(receipt.at);
    const collection=COLLECTIONS[receipt.action?.split('.')[0]],record=collection&&indexes[collection].get(receipt.id);
    if(!REQUEST_ID.test(receipt.requestId)||typeof receipt.requestId!=='string'||receiptIds.has(receipt.requestId)||typeof receipt.payloadHash!=='string'||!/^[a-f0-9]{64}$/.test(receipt.payloadHash)||!owns(ACTION_FIELDS,receipt.action)||!record||!integer(receipt.revision,1,record.revision)||receipt.at<previousAt||receipt.at<record.createdAt||receipt.at>record.updatedAt)fail('invalid_studio','요청 중복 방지 기록이 손상되었습니다.');
    receiptIds.add(receipt.requestId);previousAt=receipt.at;
    if(receipt.action.endsWith('.create')){
      if(creationReceipts.has(receipt.id))fail('invalid_studio','기록 생성 요청이 중복됩니다.');
      creationReceipts.set(receipt.id,receipt);
    }
  }
  for(const [kind,collection] of Object.entries(COLLECTIONS))for(const record of value[collection]){
    const created=creationReceipts.get(record.id);
    if(!created||created.action!==`${kind}.create`||created.revision!==1||created.at!==record.createdAt)fail('invalid_studio','원래 생성 요청이 없는 기록입니다.');
  }
  if(value.revision!==value.receipts.length)fail('invalid_studio','운영 수정 번호와 요청 이력이 다릅니다.');
  if(Buffer.byteLength(JSON.stringify(value))>STUDIO_LIMITS.bytes)fail('studio_capacity','운영 기록 보관 한도 6 MiB에 도달했습니다. 기존 기록은 보존됐습니다.',409);
  return value;
}
function recordFor(studio,kind,id){
  if(typeof id!=='string'||!UUID.test(id))fail('invalid_id','기록 ID를 확인하세요.');
  const record=studio[COLLECTIONS[kind]].find(r=>r.id===id);if(!record)fail('record_not_found','기록을 찾을 수 없습니다.',404);return record;
}
function editable(studio,kind,body,at){
  const record=recordFor(studio,kind,body.id);
  if(!integer(body.expectedRevision,1))fail('revision_required','화면의 수정 번호가 필요합니다. 새로고침 후 다시 시도하세요.');
  if(body.expectedRevision!==record.revision)fail('revision_conflict','다른 기기에서 변경됐습니다. 새로고침 후 내용을 확인하세요.',409);
  if(record.archivedAt!==null)fail('record_archived','보관된 기록은 수정할 수 없습니다.',409);
  if(at<record.updatedAt)fail('clock_moved_backwards','현재 시각이 마지막 기록보다 빠릅니다.',409);return record;
}
function bump(record,at){record.revision++;record.updatedAt=at;}
function rememberChapter(record){if(record.history.length>=STUDIO_LIMITS.chapterHistory)fail('history_capacity','회차의 이전 원고 보관 한도에 도달했습니다. 기존 원고를 내보내세요.',409);record.history.push(chapterSnapshot(record));}
function revokeInvitation(record,at){if(record.invitation?.status==='active'){record.invitation.status='revoked';record.invitation.revokedAt=at;return true;}return false;}
function cancelCheckin(record,at,reason){record.status='cancelled';record.cancelledAt=at;record.cancelReason=reason;revokeInvitation(record,at);bump(record,at);}
function consentEntry(record,at){return {consent:record.consent,note:record.consentNote,revision:record.revision,at};}
export function applyStudioAction(value,body,{now,uid=randomUUID,recipientAuthorization=null}={}){
  validateStudio(value);
  if(!object(body)||typeof body.action!=='string'||!owns(ACTION_FIELDS,body.action))fail('unknown_action','지원하지 않는 운영 요청입니다.');
  if(Object.keys(body).some(key=>!['action','requestId',...ACTION_FIELDS[body.action]].includes(key)))fail('unsupported_field','지원하지 않는 요청 필드입니다.');
  if(typeof body.requestId!=='string'||!REQUEST_ID.test(body.requestId))fail('invalid_request_id','중복 방지를 위한 요청 번호가 필요합니다.');
  // Only the separately authenticated, check-in-scoped sharing adapter supplies
  // this internal option. JSON body fields cannot impersonate a recipient.
  if(body.action==='checkin.recipientRespond'){
    const invitation=value.checkins.find(record=>record.id===body.id)?.invitation;
    if(!integer(recipientAuthorization,2)||invitation?.status!=='active'||invitation.revision!==recipientAuthorization)fail('recipient_auth_required','수신자 응답 링크 인증이 필요합니다.',403);
  }
  const payloadHash=hash(canonical(body)),receipt=value.receipts.find(r=>r.requestId===body.requestId);
  if(receipt){if(receipt.payloadHash!==payloadHash)fail('request_conflict','같은 요청 번호의 내용이 달라 실행하지 않았습니다.',409);return {studio:structuredClone(value),result:{action:receipt.action,id:receipt.id,revision:receipt.revision}};}
  if(value.receipts.length>=STUDIO_LIMITS.receipts)fail('studio_capacity','요청 기록 한도입니다. 기존 기록은 보존됐습니다.',409);
  const safetyAction=isStudioSafetyAction(value,body);
  const at=nowValue(now);if(value.receipts.length&&at<value.receipts.at(-1).at)fail('clock_moved_backwards','현재 시각이 마지막 기록보다 빠릅니다.',409);
  const studio=structuredClone(value),[kind,operation]=body.action.split('.');let record;
  if(operation==='create'){
    const collection=studio[COLLECTIONS[kind]];if(collection.length>=STUDIO_LIMITS[COLLECTIONS[kind]])fail('studio_capacity','이 종류의 기록 보관 한도에 도달했습니다.',409);
    const id=typeof uid==='function'?uid():uid;
    if(typeof id!=='string'||!UUID.test(id)||Object.values(COLLECTIONS).some(key=>studio[key].some(r=>r.id===id)))fail('invalid_generated_id','새 기록 ID를 만들지 못했습니다.',500);
    record={id,revision:1,createdAt:at,updatedAt:at,archivedAt:null};
    if(kind==='place')Object.assign(record,placeFields(body));
    if(kind==='contact'){Object.assign(record,contactFields(body),{consentSource:'owner_report',consentHistory:[]});record.consentHistory.push(consentEntry(record,at));}
    if(kind==='series')Object.assign(record,seriesFields(body));
    if(kind==='chapter'){
      recordFor(studio,'series',body.seriesId);Object.assign(record,chapterFields(body),{seriesId:body.seriesId,history:[]});record.contentSha256=hash(record.content);
      if(studio.chapters.some(c=>c.seriesId===record.seriesId&&c.number===record.number&&c.archivedAt===null))fail('chapter_number_conflict','이미 사용 중인 회차 번호입니다.',409);
    }
    if(kind==='checkin'){
      const contact=recordFor(studio,'contact',body.contactId);if(contact.consent!=='granted')fail('consent_required','안부를 기록하려면 먼저 당사자의 동의 경위를 기록하세요.',409);
      const dueAt=instant(body.dueAt,'응답 기한');if(dueAt<=at||Date.parse(dueAt)-Date.parse(at)>86400000)fail('invalid_deadline','응답 기한은 지금부터 24시간 이내여야 합니다.');
      if(!MEALS.includes(body.meal))fail('invalid_meal','아침·점심·저녁·기타 중 식사를 선택하세요.');
      if(studio.checkins.some(c=>c.contactId===contact.id&&c.status==='pending'&&c.dueAt>=at))fail('checkin_already_pending','이 연락처에는 아직 기한이 남은 안부 요청이 있습니다.',409);
      Object.assign(record,{contactId:contact.id,contactName:contact.name,consentRevision:contact.consentHistory.at(-1).revision,dueAt,meal:body.meal,note:optional(body,'note',2000),status:'pending',answer:null,answeredAt:null,responseNote:'',cancelledAt:null,cancelReason:'',recordedBy:'owner',delivery:'not_sent'});
    }
    collection.push(record);
  }else{
    record=editable(studio,kind,body,at);
    if(operation==='update'){
      if(!FIELDS[kind].some(key=>owns(body,key)))fail('empty_update','수정할 내용을 입력하세요.');
      if(kind==='place')placeFields(body,record);
      if(kind==='series')seriesFields(body,record);
      if(kind==='chapter'){
        rememberChapter(record);chapterFields(body,record);record.contentSha256=hash(record.content);
        if(studio.chapters.some(c=>c.id!==record.id&&c.seriesId===record.seriesId&&c.number===record.number&&c.archivedAt===null))fail('chapter_number_conflict','이미 사용 중인 회차 번호입니다.',409);
      }
      if(kind==='contact'){
        const priorConsent=record.consent,priorNote=record.consentNote;contactFields(body,record);
        if(priorConsent!==record.consent||priorNote!==record.consentNote){
          if(record.consentHistory.length>=(safetyAction?STUDIO_LIMITS.consentHistory:STUDIO_LIMITS.ordinaryConsentHistory))fail('history_capacity','동의 변경 이력의 일반 보관 한도입니다. 동의 철회를 위한 이력 공간은 남아 있습니다.',409);
          record.consentHistory.push({...consentEntry(record,at),revision:record.revision+1});
          if(record.consent!=='granted')for(const checkin of studio.checkins.filter(c=>c.contactId===record.id)){
            if(checkin.status==='pending')cancelCheckin(checkin,at,'consent_revoked');
            else if(revokeInvitation(checkin,at))bump(checkin,at);
          }
        }
      }
      bump(record,at);
    }else if(operation==='archive'){
      if(kind==='chapter')rememberChapter(record);record.archivedAt=at;bump(record,at);
    }else if(operation==='invite'){
      if(record.status!=='pending')fail('checkin_closed','이미 응답하거나 취소한 안부입니다.',409);
      if(at>record.dueAt)fail('checkin_overdue','응답 기한이 지났습니다. 새로운 안부 요청을 기록하세요.',409);
      if(recordFor(studio,'contact',record.contactId).consent!=='granted')fail('consent_required','안부 응답 링크에는 기록된 동의가 필요합니다.',409);
      bump(record,at);record.invitation={revision:record.revision,issuedAt:at,status:'active',revokedAt:null};
    }else if(operation==='revoke'){
      if(!revokeInvitation(record,at))fail('invitation_not_active','사용 중인 응답 링크가 없습니다.',409);
      bump(record,at);
    }else{
      if(record.status!=='pending')fail('checkin_closed','이미 응답하거나 취소한 안부입니다.',409);
      if(operation==='cancel')cancelCheckin(record,at,optional(body,'reason',2000));
      else{
        if(at>record.dueAt)fail('checkin_overdue','응답 기한이 지났습니다. 새로운 안부 요청을 기록하세요.',409);
        if(!['ate','not_yet'].includes(body.answer))fail('invalid_answer','먹었어요 또는 아직이에요를 선택하세요.');
        record.status='answered';record.answer=body.answer;record.answeredAt=at;record.responseNote=optional(body,'note',2000);record.recordedBy=operation==='recipientRespond'?'recipient':'owner';bump(record,at);
      }
    }
  }
  const result={action:body.action,id:record.id,revision:record.revision};
  studio.revision++;studio.receipts.push({requestId:body.requestId,payloadHash,...result,at});
  if(!safetyAction)requireOrdinaryCapacity(studio);
  validateStudio(studio);
  return {studio,result};
}
export function studioOverview(value,{now}={}){
  validateStudio(value);const at=nowValue(now),studio=structuredClone(value);
  delete studio.receipts;
  for(const checkin of studio.checkins)checkin.displayStatus=checkin.status==='pending'&&at>checkin.dueAt?'overdue':checkin.status;
  const counts={places:studio.places.filter(r=>r.archivedAt===null).length,contacts:studio.contacts.length,consentedContacts:studio.contacts.filter(r=>r.consent==='granted').length,checkins:studio.checkins.length,pending:studio.checkins.filter(r=>r.displayStatus==='pending').length,overdue:studio.checkins.filter(r=>r.displayStatus==='overdue').length,answered:studio.checkins.filter(r=>r.status==='answered').length,series:studio.series.length,chapters:studio.chapters.filter(r=>r.archivedAt===null).length};
  return {...studio,counts,checkedAt:at,capabilities:{privatePlaceNotes:true,automaticLocation:false,ownerRecordedCheckins:true,recipientResponseLinks:true,recipientMessaging:false,consentVerification:'owner_report',novelDrafts:true,chapterHistory:true,externalPublishing:false},storage:storageCapacity(value)};
}
export function studioExport(value,{kind,id}={}){
  validateStudio(value);let name,content;
  const chapterText=c=>`## ${c.number}화 · ${c.title}\n\n${c.content}\n`;
  if(kind==='chapter'){
    const c=recordFor(value,'chapter',id),series=recordFor(value,'series',c.seriesId);name=`blackhole-chapter-${c.id}.md`;content=`# ${series.title}\n\n${chapterText(c)}`;
  }else if(kind==='series'){
    const s=recordFor(value,'series',id);name=`blackhole-series-${s.id}.md`;content=`# ${s.title}\n\n${value.chapters.filter(c=>c.seriesId===s.id&&c.archivedAt===null).sort((a,b)=>a.number-b.number).map(chapterText).join('\n')}`;
  }else if(kind==='places'){
    name='blackhole-yeogie-places.json';content=JSON.stringify({format:'blackhole-private-places',version:1,places:value.places},null,2);
  }else if(kind==='checkins'){
    name='blackhole-hankki-records.json';content=JSON.stringify({format:'blackhole-owner-recorded-checkins',version:1,contacts:value.contacts,checkins:value.checkins},null,2);
  }else fail('invalid_export','지원하지 않는 내보내기 형식입니다.');
  return {name,mimeType:name.endsWith('.json')?'application/json; charset=utf-8':'text/markdown; charset=utf-8',content};
}
