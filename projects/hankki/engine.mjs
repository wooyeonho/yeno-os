// A03 한끼안부: local prototype; no messages, location, contacts, or medical inference.
export function initialState(){return {schema:1,revision:0,stopped:false,requests:[],receipts:[]};}
const instant=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(v);
const fail=message=>{throw new Error(message);};
export function validateState(s){
 if(!s||s.schema!==1||!Number.isSafeInteger(s.revision)||s.revision<0||typeof s.stopped!=='boolean'||!Array.isArray(s.requests)||s.requests.length>1000||!Array.isArray(s.receipts)||s.receipts.length>2000)fail('기록 형식을 확인할 수 없습니다.');
 const seen=new Set();
 for(const r of s.requests){
  if(!r||!id(r.id)||seen.has(r.id)||!instant(r.createdAt)||!instant(r.dueAt)||Date.parse(r.dueAt)<=Date.parse(r.createdAt)||!['pending','answered','cancelled'].includes(r.status))fail('요청 기록이 손상되었습니다.');
  seen.add(r.id);
  if(r.status==='answered'&&(!['ate','not_yet'].includes(r.answer)||!instant(r.answeredAt)||Date.parse(r.answeredAt)<Date.parse(r.createdAt)||Date.parse(r.answeredAt)>Date.parse(r.dueAt)))fail('응답 기록이 손상되었습니다.');
  if(r.status==='cancelled'&&(!instant(r.cancelledAt)||Date.parse(r.cancelledAt)<Date.parse(r.createdAt)))fail('취소 기록이 손상되었습니다.');
 }
 const commands=new Set();for(const r of s.receipts){if(!r||!id(r.id)||commands.has(r.id)||typeof r.payload!=='string'||r.payload.length>600)fail('중복 방지 기록이 손상되었습니다.');commands.add(r.id);}
 return s;
}
export function statusAt(r,at){if(!instant(at))fail('시각이 올바르지 않습니다.');return r.status==='pending'&&Date.parse(at)>Date.parse(r.dueAt)?'unanswered':r.status;}
export function transition(state,command,at){
 validateState(state);
 if(!instant(at)||!command||!id(command.requestId)||!['create','answer','cancel','stop','resume'].includes(command.type))fail('요청 형식이 올바르지 않습니다.');
 const allowed={create:['requestId','type','id','dueAt'],answer:['requestId','type','id','answer'],cancel:['requestId','type','id'],stop:['requestId','type'],resume:['requestId','type']}[command.type];
 if(Object.keys(command).some(k=>!allowed.includes(k)))fail('알 수 없는 요청 필드입니다.');
 const payload=JSON.stringify(allowed.map(k=>[k,command[k]??null]));
 const receipt=state.receipts.find(r=>r.id===command.requestId);
 if(receipt){if(receipt.payload!==payload)fail('같은 요청 번호의 내용이 달라 실행하지 않았습니다.');return structuredClone(state);}
 if(state.receipts.length===2000)fail('기록 한도입니다. 새 요청을 받지 않습니다. 먼저 백업하세요.');
 const s=structuredClone(state);
 if(command.type==='stop')s.stopped=true;
 else if(command.type==='resume')s.stopped=false;
 else{
  if(s.stopped)fail('일시정지 상태입니다. 재개 후 기록하세요.');
  if(!id(command.id))fail('요청 번호가 올바르지 않습니다.');
  if(command.type==='create'){
   if(s.requests.length===1000)fail('요청 보관 한도입니다.');
   if(s.requests.some(r=>r.id===command.id))fail('이미 있는 요청입니다.');
   if(!instant(command.dueAt)||Date.parse(command.dueAt)<=Date.parse(at)||Date.parse(command.dueAt)-Date.parse(at)>86400000)fail('응답 기한은 지금부터 24시간 이내여야 합니다.');
   s.requests.push({id:command.id,createdAt:at,dueAt:command.dueAt,status:'pending'});
  }else{
   const r=s.requests.find(r=>r.id===command.id);if(!r)fail('요청을 찾을 수 없습니다.');
   if(Date.parse(at)<Date.parse(r.createdAt))fail('기기 시각이 이전으로 변경되었습니다.');
   if(r.status!=='pending')fail('이미 응답하거나 취소한 요청입니다.');
   if(command.type==='cancel'){r.status='cancelled';r.cancelledAt=at;}
   else{
    if(statusAt(r,at)==='unanswered')fail('응답 기한이 지났습니다. 새 요청을 만들어 주세요.');
    if(!['ate','not_yet'].includes(command.answer))fail('응답을 확인해 주세요.');
    r.status='answered';r.answer=command.answer;r.answeredAt=at;
   }
  }
 }
 s.revision++;s.receipts.push({id:command.requestId,payload});return validateState(s);
}
export function encodeState(s){return JSON.stringify(validateState(s));}
export function decodeState(text){if(typeof text!=='string'||text.length>1500000)fail('기록 크기가 올바르지 않습니다.');return validateState(JSON.parse(text));}
