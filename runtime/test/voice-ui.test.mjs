import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createVoiceView} from '../public/voice-view.mjs';
const {JSDOM}=createRequire(new URL('../../apps/controller/package.json',import.meta.url))('jsdom');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup({recognition=true,onSend=async()=>({jobId:'voice-job'}),onReadResult=async()=> '실제 답변입니다.'}={}) {
 const dom=new JSDOM('<main></main>',{pretendToBeVisual:true,url:'https://example.test'}),win=dom.window,root=win.document.querySelector('main');
 const sessions=[],spoken=[],synth={cancelled:0,cancel(){this.cancelled++;},speak(utterance){spoken.push(utterance);},getVoices(){return [{lang:'ko-KR',name:'한국어'}];}};
 class Recognition {constructor(){sessions.push(this);}start(){this.started=true;}abort(){this.aborted=true;this.onend?.();}stop(){this.stopped=true;}result(entries){const results=entries.map(([text,final])=>{const item=[{transcript:text}];item.isFinal=final;return item;});this.onresult?.({results});}end(){this.onend?.();}}
 if(recognition)win.SpeechRecognition=Recognition;
 win.speechSynthesis=synth;win.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
 const view=createVoiceView(root,{onSend,onReadResult});view.update({online:true,jobs:[]});
 const query=selector=>root.querySelector(selector),click=action=>query(`[data-voice-action="${action}"]`).click();
 const type=text=>{query('[data-voice-input]').value=text;query('[data-voice-input]').dispatchEvent(new win.Event('input'));};
 const check=(name,value=true)=>{query(`[data-voice-${name}]`).checked=value;query(`[data-voice-${name}]`).dispatchEvent(new win.Event('change',{bubbles:true}));};
 return {dom,win,root,view,query,click,type,check,sessions,spoken,synth,close(){view.destroy();dom.window.close();}};
}
test('push-to-talk retains editable final transcript; partial speech and repeated clicks never submit automatically',async()=>{
 const calls=[],h=setup({onSend:async(text,context)=>{calls.push({text,context});return {jobId:'one'};}});
 assert.match(h.query('.voice-privacy').textContent,/제공 업체로 전송/);
 h.click('listen');assert.equal(h.sessions[0].lang,'ko-KR');assert.equal(h.sessions[0].continuous,false);
 h.sessions[0].result([['작성 중',false]]);h.sessions[0].end();await tick();assert.equal(calls.length,0);assert.equal(h.query('[data-voice-input]').value,'');
 h.click('listen');h.sessions[1].result([['오늘 할 일',true],['추가 중',false]]);h.sessions[1].end();assert.equal(h.query('[data-voice-input]').value,'오늘 할 일');
 h.type('오늘 우선순위 세 가지');h.click('send');h.click('send');await tick();assert.equal(calls.length,1);assert.equal(calls[0].text,'오늘 우선순위 세 가지');
 h.sessions[1].result([['늦게 도착한 말',true]]);h.sessions[1].end();await tick();assert.equal(calls.length,1);h.close();
});
test('hands-free sends only a final utterance once and reads only its actual completed result before listening again',async()=>{
 const sent=[],readIds=[],h=setup({onSend:async text=>{sent.push(text);return {jobId:'requested'};},onReadResult:async job=>{readIds.push(job.id);return '요청한 실제 결과 한 문장.';}});
 h.check('handsfree');assert.equal(h.sessions.length,0);h.click('listen');const first=h.sessions[0];
 first.result([['일정을 정리해줘',false]]);assert.equal(sent.length,0);
 first.result([['일정을 정리해줘',true]]);first.result([['일정을 정리해줘',true]]);first.end();first.end();await tick();assert.deepEqual(sent,['일정을 정리해줘']);
 h.view.update({online:true,jobs:[{id:'other',status:'completed'},{id:'requested',status:'running'}]});await tick();assert.equal(readIds.length,0);assert.equal(h.spoken.length,0);
 h.view.update({online:true,jobs:[{id:'requested',status:'completed'}]});h.view.update({online:true,jobs:[{id:'requested',status:'completed'}]});await tick();
 assert.deepEqual(readIds,['requested']);assert.equal(h.spoken.length,1);assert.equal(h.spoken[0].text,'요청한 실제 결과 한 문장.');assert.equal(h.sessions.length,1);
 h.spoken[0].onend();assert.equal(h.sessions.length,2);assert.match(h.query('[data-voice-answer-text]').textContent,/실제 결과/);h.close();
});
test('stop, logout, page hiding and offline state abort microphone and ignore late speech or result callbacks',async()=>{
 let release;const sends=[],h=setup({onSend:async text=>{sends.push(text);return {jobId:'late'};},onReadResult:()=>new Promise(resolve=>{release=resolve;})});
 h.check('handsfree');h.click('listen');const mic=h.sessions[0];mic.result([['보내면 안 되는 말',true]]);h.click('stop');mic.end();await tick();assert.equal(sends.length,0);assert.equal(mic.aborted,true);
 h.type('요약해줘');h.click('send');await tick();h.view.update({online:true,jobs:[{id:'late',status:'completed'}]});await tick();h.click('stop');release('완료된 실제 결과');await tick();assert.equal(h.spoken.length,0);assert.match(h.query('[data-voice-answer-text]').textContent,/완료된 실제 결과/);
 h.click('replay');assert.equal(h.spoken.length,1);Object.defineProperty(h.win.document,'hidden',{configurable:true,value:true});h.win.document.dispatchEvent(new h.win.Event('visibilitychange'));h.spoken[0].onend();assert.equal(h.query('[data-voice-handsfree]').checked,false);
 Object.defineProperty(h.win.document,'hidden',{configurable:true,value:false});h.view.update({online:true,jobs:[]});h.type('오프라인 초안');h.click('listen');const offlineMic=h.sessions.at(-1);h.view.update({online:false,jobs:[]});assert.equal(offlineMic.aborted,true);assert.equal(h.query('[data-voice-action=send]').disabled,true);assert.equal(h.query('[data-voice-input]').value,'오프라인 초안');
 h.view.reset();assert.equal(h.query('[data-voice-input]').value,'');assert.equal(h.query('[data-voice-answer-text]').textContent,'');h.close();
});
test('reset while result is being fetched prevents the previous owner result from appearing or speaking',async()=>{
 let resolveResult;const h=setup({onReadResult:()=>new Promise(resolve=>{resolveResult=resolve;})});h.type('개인 질문');h.click('send');await tick();h.view.update({online:true,jobs:[{id:'voice-job',status:'completed'}]});await tick();h.view.reset();resolveResult('이전 사용자의 사적인 결과');await tick();assert.equal(h.spoken.length,0);assert.equal(h.query('[data-voice-answer]').hidden,true);assert.equal(h.query('[data-voice-answer-text]').textContent,'');h.close();
});
test('recognition permission error never sends captured text; unsupported browser offers typed input and actual readback',async()=>{
 const calls=[],h=setup({onSend:async text=>{calls.push(text);return {jobId:'permission'};}});h.check('handsfree');h.click('listen');h.sessions[0].result([['전송 안 함',true]]);h.sessions[0].onerror({error:'not-allowed'});h.sessions[0].end();await tick();assert.equal(calls.length,0);assert.match(h.query('[data-voice-status]').textContent,/마이크 권한/);h.close();
 const typed=setup({recognition:false});assert.equal(typed.query('[data-voice-action=listen]').disabled,true);assert.match(typed.query('[data-voice-support]').textContent,/키보드 음성 입력/);typed.type('글로 보낸 질문');typed.click('send');await tick();typed.view.update({online:true,jobs:[{id:'voice-job',status:'completed'}]});await tick();assert.equal(typed.spoken.length,1);typed.close();
});
test('failed result fetch is retryable without creating another job and subsequent question receives bounded conversation history',async()=>{
 let reads=0;const calls=[],h=setup({onSend:async(text,context)=>{calls.push({text,context});return {jobId:`job-${calls.length}`};},onReadResult:async()=>{if(++reads===1)throw new Error('일시적인 파일 응답 오류');return '<img src=x> 실제 원문';}});
 h.type('첫 질문');h.click('send');await tick();h.view.update({online:true,jobs:[{id:'job-1',status:'completed'}]});await tick();assert.equal(h.query('[data-voice-action=retry]').hidden,false);h.click('retry');await tick();assert.equal(calls.length,1);assert.equal(reads,2);assert.equal(h.root.querySelector('img'),null);assert.equal(h.query('[data-voice-answer-text]').textContent,'<img src=x> 실제 원문');
 h.click('stop');h.type('그 답변을 구체화해줘');h.click('send');await tick();assert.equal(calls.length,2);assert.deepEqual(calls[1].context.history,[{role:'user',content:'첫 질문'},{role:'assistant',content:'<img src=x> 실제 원문'}]);h.close();
});
test('ambiguous submission retains draft and disconnect during submission suppresses eventual spoken response',async()=>{
 const h=setup({onSend:async()=>{throw new Error('같은 요청 확인을 사용하세요.');}});h.type('유실되면 안 되는 초안');h.click('send');await tick();assert.equal(h.query('[data-voice-input]').value,'유실되면 안 되는 초안');assert.match(h.query('[data-voice-status]').textContent,/같은 요청/);h.close();
 let resolveSend;const late=setup({onSend:()=>new Promise(resolve=>{resolveSend=resolve;})});late.type('접수 중 연결 끊김');late.click('send');late.view.update({online:false,jobs:[]});resolveSend({jobId:'late-submit'});await tick();late.view.update({online:true,jobs:[{id:'late-submit',status:'completed'}]});await tick();assert.equal(late.spoken.length,0);late.close();
});
test('same-request receipt recovery uses the original uncertain turn, preserves edited next draft and never submits again',async()=>{
 let submissions=0;const contexts=[];const h=setup({onSend:async(text,context)=>{submissions++;contexts.push(context);throw new Error('같은 요청 확인을 사용하세요.');}});
 h.type('원래 전송한 질문');h.click('send');await tick();assert.equal(h.query('[data-voice-action=send]').disabled,true);
 h.type('다음에 보낼 편집한 질문');h.click('send');assert.equal(submissions,1);
 assert.equal(h.view.acceptReceipt({jobId:'recovered',job:{id:'recovered',status:'completed'}}),true);await tick();
 assert.equal(h.query('[data-voice-input]').value,'다음에 보낼 편집한 질문');assert.equal(h.spoken.length,1);
 assert.equal(h.view.acceptReceipt({jobId:'recovered',job:{id:'recovered',status:'completed'}}),false);await tick();assert.equal(h.spoken.length,1);assert.equal(submissions,1);
 h.click('stop');h.click('send');await tick();assert.equal(submissions,2);assert.equal(contexts[1].history[0].content,'원래 전송한 질문');
 h.view.reset();assert.equal(h.view.acceptReceipt({jobId:'old-receipt'}),false);h.close();
});
test('receipt forwarded before onSend resolves is adopted only once; definite rejection allows a new corrected turn',async()=>{
 let release;const h=setup({onSend:()=>new Promise(resolve=>{release=resolve;})});h.type('한 번 실행');h.click('send');
 const receipt={jobId:'early',job:{id:'early',status:'completed'}};assert.equal(h.view.acceptReceipt(receipt),true);release(receipt);await tick();assert.equal(h.spoken.length,1);h.close();
 const rejected=setup({onSend:async()=>{throw Object.assign(new Error('입력이 너무 깁니다.'),{status:422});}});rejected.type('수정할 질문');rejected.click('send');await tick();assert.equal(rejected.query('[data-voice-action=send]').disabled,false);rejected.close();
});
