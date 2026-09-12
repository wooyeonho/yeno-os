// Shipped app/index + temporary actual HTTP core. DOM, cookies, browser locks,
// public literature responses and provider response are simulated. No paid calls.
import {createRequire} from 'node:module';
import {readFileSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {webcrypto,randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {start} from '../runtime/server.mjs';
import {openStore} from '../runtime/lib/store.mjs';
import {RESEARCH_TRACKS} from '../runtime/lib/research.mjs';

const require=createRequire(new URL('../apps/controller/package.json',import.meta.url));
const {JSDOM,CookieJar,VirtualConsole}=require('jsdom');
const {build}=require('esbuild');
const publicRoot=fileURLToPath(new URL('../runtime/public/',import.meta.url));
const source=readFileSync(join(publicRoot,'app.js'),'utf8').replace(/import\('\//g,"import('./");
const bundle=await build({stdin:{contents:source,resolveDir:publicRoot,loader:'js'},bundle:true,format:'iife',write:false});
const html=readFileSync(join(publicRoot,'index.html'),'utf8');
const dataDir=mkdtempSync(join(tmpdir(),'blackhole-research-ui-'));
const owner='research-ui-synthetic-owner-key-only',providerKey='research-ui-synthetic-provider-key-only';
const stamp=new Date().toISOString(),store=openStore(dataDir);
store.state.projects.push(...RESEARCH_TRACKS.map(track=>({id:track.projectId,name:track.name,summary:'Synthetic preserved research project',nextAction:'Synthetic evidence check',repositoryUrl:'',status:'active',version:1,createdAt:stamp,updatedAt:stamp})));
store.save();
const rawResponses={
  'www.ebi.ac.uk':JSON.stringify({version:'6.9',hitCount:1,resultList:{result:[{id:'12345678',source:'MED',title:'Synthetic surveillance evidence',authorString:'Synthetic Researcher',pubYear:'2025',doi:'10.1000/synthetic-research-ui-primary',abstractText:'Synthetic surveillance detects an association. This is not evidence of causation.',isRetracted:'N'}]}},null,2)+'\n',
  'api.crossref.org':JSON.stringify({status:'ok','message-type':'work-list',message:{'total-results':1,items:[{DOI:'10.1000/synthetic-research-ui-replication',title:['Synthetic independent validation evidence'],published:{'date-parts':[[2024,5,2]]},author:[{given:'Synthetic',family:'Researcher'}],abstract:'<jats:p>A synthetic validation study reports substantial uncertainty.</jats:p>'}]}},null,2)+'\n',
};
let modelCalls=0,evidenceCalls=0;
const core=await start({host:'127.0.0.1',port:0,dataDir,token:owner,env:{YENO_AGENT_PROVIDER:'auto',YENO_AGENT_DAILY_CALL_LIMIT:'20',YENO_OPENAI_API_KEY:providerKey,YENO_OPENAI_MODEL:'synthetic-research-ui-model',YENO_AGENT_AUTORUN:'false'},
  researchFetch:async(url,init)=>{
    const parsed=new URL(url);assert.ok(Object.hasOwn(rawResponses,parsed.hostname));assert.equal(init.redirect,'error');evidenceCalls++;
    return new Response(rawResponses[parsed.hostname],{headers:{'Content-Type':'application/json'}});
  },
  agentFetch:async(url,init)=>{
    assert.equal(new URL(url).hostname,'api.openai.com');modelCalls++;
    const body=JSON.parse(init.body);assert.ok(!body.tools?.length);assert.match(JSON.stringify(body.messages),/Synthetic surveillance evidence/);assert.ok(!JSON.stringify(body.messages).includes(owner));
    const job=openStore(dataDir).state.jobs.find(item=>item.researchRequest);assert.ok(job.researchEvidenceId);assert.equal(job.callLimit,1);
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'합성 검증용 연구 초안: 현재 문헌 [S1]은 관찰적 연관성을 제시합니다. 인과관계나 인류 난제 해결은 입증하지 않았습니다. 독립 자료에서 사전등록한 가설을 검증해야 합니다.',tool_calls:[]}}],usage:{prompt_tokens:85,completion_tokens:45}}),{headers:{'Content-Type':'application/json'}});
  },
});
const origin=`http://127.0.0.1:${core.server.address().port}`;
const jar=new CookieJar(),persisted=new Map(),calls=[],reads=[],doms=new Set(),errors=[],blobs=new Map(),downloads=[];
let held=false,losePath='',dom,activeNetwork=0;
const storage={getItem:key=>persisted.get(key)??null,setItem:(key,value)=>persisted.set(key,String(value)),removeItem:key=>persisted.delete(key)};
const locks={async request(name,options,callback){assert.equal(name,'blackhole-web-controller-v1');if(held)return callback(null);held=true;try{return await callback({name});}finally{held=false;}}};
const until=async(check,label)=>{const deadline=Date.now()+12000;while(!check()){if(Date.now()>deadline)throw new Error(`Timed out: ${label}; pair=${dom?.window.document.getElementById('pair-error')?.textContent}; research=${dom?.window.document.querySelector('.research-status')?.textContent}; error=${dom?.window.document.querySelector('.research-error')?.textContent}; dialog=${dom?.window.document.getElementById('artifact-dialog')?.open}:${dom?.window.document.getElementById('artifact-title')?.textContent}; toast=${dom?.window.document.getElementById('toast')?.textContent}; ${errors.join(';')}`);await new Promise(resolve=>setTimeout(resolve,20));}};
function openDom(){
  const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>{if(!error.message.includes('navigation'))errors.push(error.message);});
  const page=new JSDOM(html,{url:origin,runScripts:'outside-only',pretendToBeVisual:true,cookieJar:jar,virtualConsole});doms.add(page);
  const w=page.window;
  Object.defineProperty(w,'localStorage',{value:storage});Object.defineProperty(w,'crypto',{value:webcrypto});Object.defineProperty(w.navigator,'locks',{value:locks});
  w.structuredClone=structuredClone;w.AbortSignal=AbortSignal;w.Blob=Blob;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};w.HTMLMediaElement.prototype.pause=function(){};
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.URL.createObjectURL=blob=>{const url=`blob:${origin}/${randomUUID()}`;blobs.set(url,blob);return url;};w.URL.revokeObjectURL=url=>blobs.delete(url);
  w.HTMLAnchorElement.prototype.click=function(){downloads.push({filename:this.download,blob:blobs.get(this.href)});};
  w.fetch=async(route,init={})=>{
    activeNetwork++;
    try{
      reads.push(String(route));const url=new URL(route,origin);assert.equal(url.origin,origin);
      const cookie=jar.getCookieStringSync(url.href),headers={...init.headers,...(cookie?{Cookie:cookie}:{}),...(init.method==='POST'?{Origin:origin}:{})};
      const response=await fetch(url,{...init,headers}),bytes=await response.arrayBuffer();
      for(const value of response.headers.getSetCookie())jar.setCookieSync(value,url.href);
      if(init.body){const body=JSON.parse(init.body);calls.push({path:url.pathname,body,status:response.status});if(url.pathname===losePath){assert.ok(response.ok,'only lose an actually accepted response');losePath='';throw new TypeError('Synthetic response loss after actual research commit');}}
      return new Response(bytes,{status:response.status,headers:response.headers});
    }finally{activeNetwork--;}
  };
  w.eval(bundle.outputFiles[0].text);return page;
}
const $=selector=>dom.window.document.querySelector(selector);
function click(selector){const element=$(selector);assert.ok(element,selector);assert.equal(element.disabled,false,`disabled: ${selector}`);element.click();}
function submit(selector,values){const form=$(selector);assert.ok(form,selector);for(const [id,value]of Object.entries(values)){const element=form.querySelector(`[name="${id}"],#${id}`);assert.ok(element,id);element.value=value;}form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));}
async function close(page){page.window.dispatchEvent(new page.window.Event('pagehide'));await until(()=>activeNetwork===0,'drain closing-window network');await new Promise(resolve=>setImmediate(resolve));page.window.close();doms.delete(page);await new Promise(resolve=>setImmediate(resolve));}
const proof={at:new Date().toISOString(),scope:'shipped web app and actual temporary HTTP core; JSDOM/cookies/locks and external API replies simulated; zero paid calls',checks:[]};
try{
  dom=openDom();await until(()=>reads.includes('/api/web/session'),'login ready');submit('#pair-form',{'pair-token':owner});
  await until(()=>$('#pair-screen').hidden&&$('.studio-status')?.textContent.includes('본체 확인'),'authenticated cookie session');
  assert.equal(dom.window.document.cookie,'');assert.ok(![...persisted.values()].join('').includes(owner));
  click('[data-tab="research"]');await until(()=>!$('#tab-research').hidden&&!$('[data-research-run]').disabled,'research navigation wired');
  assert.equal($('[name="projectId"]').options.length,10);
  const question='항생제 내성을 낮추는 가설을 어떤 독립 자료로 검증할 수 있나?',query='antimicrobial resistance independent surveillance validation';
  losePath='/api/research/run';submit('[data-research-form]',{projectId:'',question,query});
  await until(()=>!$('.research-pending').hidden&&!$('[data-research-action="retry"]').disabled,'lost accepted response remains pending');
  const original=calls.filter(call=>call.path==='/api/research/run').at(-1);assert.equal(original.status,201);assert.equal(original.body.projectId,null);
  assert.ok([...persisted.entries()].some(([key,value])=>key.endsWith(':blackhole-pending-research-v1')&&value.includes(original.body.requestId)));
  assert.equal(core.state().jobs.length,1);assert.equal(openStore(dataDir).state.quests.length,1);
  proof.checks.push('cookie login; research navigation; canonical nine tracks; actual POST committed before simulated reply loss; scoped pending request persisted');
  await close(dom);dom=openDom();
  await until(()=>$('#pair-screen').hidden&&!$('#tab-research').hidden&&!$('[data-research-action="retry"]')?.disabled,'reopen automatically shows pending research');
  assert.equal($('[name="question"]').value,question);assert.equal($('[name="query"]').value,query);assert.equal($('[name="projectId"]').value,'');
  click('[data-research-action="retry"]');await until(()=>$('.research-pending').hidden,'exact request receipt recovered');
  assert.deepEqual(calls.filter(call=>call.path==='/api/research/run').at(-1),original);assert.equal($('#tab-research').hidden,false,'accepted callback keeps the research tab');
  await until(()=>core.state().jobs[0]?.status==='completed','one research job completes');
  click('[data-research-action="refresh"]');await until(()=>$('.research-jobs').textContent.includes('연구 초안 완료'),'completed research result shown');
  const job=core.state().jobs[0],answer=job.artifacts.find(item=>item.name.startsWith('research-answer-'));
  assert.ok(answer);assert.equal(modelCalls,1);assert.equal(evidenceCalls,2);assert.equal(core.state().jobs.length,1);assert.equal(openStore(dataDir).state.quests.length,1);assert.equal(core.state().projects.length,9);
  assert.ok(![...persisted.values()].some(value=>value.includes(original.body.requestId)));
  proof.checks.push('close/reopen with same cookie and exact question; pending research opens automatically; same request ID replay; one job, one quest and one simulated model call');
  click(`[data-research-action="open-artifact"][data-id="${answer.id}"]`);
  await until(()=>$('#artifact-dialog').open&&$('#artifact-title').textContent===answer.name,'answer opened through root callback');
  assert.match($('#artifact-content').textContent,/합성 검증용 연구 초안/);assert.match($('#artifact-content').textContent,/\[S1\]/);
  assert.match($('#artifact-content').textContent,/https:\/\/doi\.org\//);
  click('#download-artifact');const downloadedAnswer=downloads.at(-1);assert.equal(downloadedAnswer.filename,answer.name);assert.equal(await downloadedAnswer.blob.text(),$('#artifact-content').textContent);
  click('[data-close="artifact-dialog"]');
  const rawChecks=[];
  for(const [host,filename]of [['www.ebi.ac.uk','research-europepmc.json'],['api.crossref.org','research-crossref.json']]){
    const artifact=job.artifacts.find(item=>item.name===filename);assert.ok(artifact);
    click(`[data-research-action="open-artifact"][data-id="${artifact.id}"]`);
    await until(()=>$('#artifact-dialog').open&&$('#artifact-title').textContent===filename,`${filename} JSON dialog`);
    assert.deepEqual(JSON.parse($('#artifact-content').textContent),JSON.parse(rawResponses[host]));assert.equal($('#artifact-content').textContent,rawResponses[host]);
    click('#download-artifact');const downloaded=downloads.at(-1);assert.equal(downloaded.filename,filename);assert.equal(await downloaded.blob.text(),rawResponses[host]);
    rawChecks.push({name:filename,sha256:createHash('sha256').update(await downloaded.blob.text()).digest('hex')});
    click('[data-close="artifact-dialog"]');
  }
  proof.checks.push('root artifact dialog opens answer with [S1] and source links; answer download matches; both raw JSON dialogs/downloads preserve exact source bytes');
  click(`[data-research-action="open-job"][data-id="${job.id}"]`);await until(()=>!$('#tab-control').hidden,'job callback opens execution records');
  click('[data-tab="research"]');await until(()=>!$('#tab-research').hidden&&$('.research-jobs').textContent.includes('연구 초안 완료'),'research history reopens');
  await close(dom);dom=openDom();await until(()=>$('#pair-screen').hidden&&$('.studio-status')?.textContent.includes('본체 확인'),'reopen after settlement');
  click('[data-tab="research"]');await until(()=>$('.research-jobs').textContent.includes('연구 초안 완료'),'saved answer after fresh tab');
  click(`[data-research-action="open-artifact"][data-id="${answer.id}"]`);await until(()=>$('#artifact-dialog').open&&$('#artifact-title').textContent===answer.name,'same saved artifact reopens');
  assert.match($('#artifact-content').textContent,/\[S1\]/);assert.equal(modelCalls,1);assert.equal(evidenceCalls,2);assert.equal(calls.filter(call=>call.path==='/api/research/run').length,2);assert.equal(errors.length,0,errors.join(';'));
  proof.checks.push('execution-record callback navigates correctly; settled result survives another tab close/reopen without another research submission or model call');
  Object.assign(proof,{modelCalls,evidenceCalls,paidCalls:0,jobs:1,quests:1,preservedProjects:9,artifacts:job.artifacts.length,rawFiles:rawChecks});
  if(process.env.YENO_RESEARCH_UI_PROOF_PATH)writeFileSync(process.env.YENO_RESEARCH_UI_PROOF_PATH,JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify(proof));
}finally{
  for(const page of doms)await close(page);core.shutdown();await new Promise(resolve=>setTimeout(resolve,80));rmSync(dataDir,{recursive:true,force:true});
}
