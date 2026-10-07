const byId=id=>document.getElementById(id);
const ui={heading:byId('answer-heading'),description:byId('answer-description'),details:byId('answer-details'),meal:byId('answer-meal'),due:byId('answer-due'),status:byId('answer-status'),buttons:byId('answer-buttons'),ate:byId('answer-ate'),notYet:byId('answer-not-yet'),retry:byId('answer-retry'),consent:byId('answer-consent')};
const mealNames={breakfast:'아침',lunch:'점심',dinner:'저녁',other:'식사'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let id='',token='',pending=null,busy=false,view=null;
function status(message,state=''){ui.status.textContent=message;ui.status.dataset.state=state;}
function storageKey(){return `blackhole-hankki-pending:${id}`;}
function rememberPending(){try{if(pending)sessionStorage.setItem(storageKey(),JSON.stringify(pending));else sessionStorage.removeItem(storageKey());}catch{}}
function readPending(){try{const item=JSON.parse(sessionStorage.getItem(storageKey())??'null');if(item&&typeof item.requestId==='string'&&UUID.test(item.requestId)&&['ate','not_yet'].includes(item.answer)&&Object.keys(item).length===2)pending=item;}catch{}}
function setBusy(value){busy=value;ui.ate.disabled=value||Boolean(pending&&pending.answer!=='ate');ui.notYet.disabled=value||Boolean(pending&&pending.answer!=='not_yet');ui.retry.disabled=value;}
function normalizeView(data){
  const result=data?.checkin??data?.view??data;
  if(!result||result.checkinId!==id||!Object.hasOwn(mealNames,result.meal)||typeof result.dueAt!=='string'||!Number.isFinite(Date.parse(result.dueAt))||!['pending','answered','cancelled'].includes(result.status)||(result.status==='answered'&&!['ate','not_yet'].includes(result.answer)))throw new Error('invalid-response');
  return result;
}
function render(result){
  view=result;ui.details.hidden=false;ui.meal.textContent=mealNames[result.meal];
  ui.due.textContent=new Intl.DateTimeFormat('ko-KR',{month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(result.dueAt));
  ui.buttons.hidden=result.status!=='pending';ui.consent.hidden=result.status!=='pending';
  ui.retry.hidden=false;ui.retry.textContent='다시 확인';
  if(result.status==='answered'){
    pending=null;rememberPending();ui.heading.textContent='안부가 기록됐어요';ui.description.textContent='응답해 주셔서 감사합니다.';
    status(result.answer==='ate'?'먹었어요, 라고 기록됐어요.':'아직이에요, 라고 기록됐어요.','saved');
  }else if(result.status==='cancelled'){
    ui.heading.textContent='종료된 안부예요';ui.description.textContent='이 요청은 취소되어 응답할 수 없어요.';status('');
  }else{
    ui.heading.textContent='식사하셨나요?';ui.description.textContent='두 가지 중 하나를 눌러 짧게 안부를 남겨 주세요.';
    status(pending?'이전 응답의 저장 여부를 확인하려면 같은 버튼을 다시 눌러 주세요.':'한 번 저장한 응답은 이 링크에서 바꿀 수 없어요.');
  }
  setBusy(false);
}
async function request(method,body){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),16000);
  try{
    const headers={Authorization:`Checkin ${token}`};if(body)headers['Content-Type']='application/json';
    const response=await fetch(`/api/hankki/checkins/${encodeURIComponent(id)}`,{method,headers,body:body?JSON.stringify(body):undefined,credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});
    if(!response.ok){const error=new Error('request-failed');error.status=response.status;throw error;}
    return normalizeView(await response.json());
  }finally{clearTimeout(timeout);}
}
function unavailable(){
  ui.heading.textContent='응답 링크를 확인해 주세요';ui.description.textContent='기한이 지났거나 요청자가 링크를 종료했을 수 있어요.';ui.buttons.hidden=true;ui.consent.hidden=true;ui.details.hidden=true;
  status('링크를 보내 준 사람에게 새 안부 요청을 부탁해 주세요.','error');ui.retry.hidden=!pending;ui.retry.textContent=pending?'이전 응답 저장 여부 확인':'다시 확인';
}
async function load(){
  if(busy)return;setBusy(true);status('안부 내용을 확인하고 있어요.');
  try{render(await request('GET'));}
  catch(error){
    if(error.status===404)unavailable();
    else{status(error.status===429?'잠시 후 다시 확인해 주세요.':'연결을 확인하지 못했어요. 다시 확인을 눌러 주세요.','error');ui.retry.hidden=false;}
    setBusy(false);
  }
}
async function answer(choice){
  if(busy)return;
  if(!pending){if(!['ate','not_yet'].includes(choice)||view?.status!=='pending')return;pending={requestId:crypto.randomUUID(),answer:choice};rememberPending();}
  if(choice&&pending.answer!==choice)return;
  setBusy(true);status('응답을 저장하고 있어요.');
  try{render(await request('POST',pending));}
  catch(error){
    if(error.status===404)unavailable();
    else if(error.status===409){setBusy(false);await load();return;}
    else{
      status(error.status===429?'잠시 후 같은 버튼을 다시 눌러 주세요.':error.status===423||error.status===503?'지금은 요청자의 안부 기록이 일시정지됐어요. 잠시 후 같은 응답으로 다시 확인해 주세요.':'저장 여부를 아직 확인하지 못했어요. 다시 누르면 같은 요청으로 확인합니다.','error');
      ui.retry.hidden=false;ui.retry.textContent='같은 응답으로 다시 확인';
    }
    setBusy(false);
  }
}
ui.ate.addEventListener('click',()=>answer('ate'));
ui.notYet.addEventListener('click',()=>answer('not_yet'));
ui.retry.addEventListener('click',()=>pending?answer(pending.answer):load());
try{
  const fragment=location.hash.slice(1);if(location.search||fragment.length>300)throw new Error('invalid-link');
  const parts=new URLSearchParams(fragment);if([...parts.keys()].length!==2||parts.getAll('id').length!==1||parts.getAll('token').length!==1)throw new Error('invalid-link');
  id=parts.get('id')??'';token=parts.get('token')??'';
  if(!UUID.test(id)||!/^v1\.[1-9][0-9]{0,15}\.[A-Za-z0-9_-]{43}$/.test(token))throw new Error('invalid-link');
  // The capability remains only in this fragment and page memory. Pending
  // response storage contains the random request ID and chosen answer only.
  readPending();load();
}catch{unavailable();}
