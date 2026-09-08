import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {atomicWrite,openStore,acquireRuntimeLock,digest,uid,now} from './lib/store.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const VERSION='0.1.1';
const MAX_BODY=256*1024;
class HttpError extends Error {constructor(status,message,extra={}){super(message);this.status=status;this.extra=extra;}}
function requiredText(value,maximum=80000){if(typeof value!=='string'||!value.trim())throw new HttpError(400,'text must be a non-empty string');if(value.length>maximum)throw new HttpError(400,`text is limited to ${maximum} characters`);return value.trim();}
function publicJob(job){const {input,normalized,draft,...out}=job;return out;}
function publicSnapshot(snapshot){const {data,...out}=snapshot;return out;}
const examples=['기억해: 다음 여행은 여유 있게 계획한다','찾아줘: 여행','문서 만들어: YENO의 첫 목표는 기억과 실행이다','진단해','개선점 찾아줘'];

export function createYenoServer(options={}) {
 const env=options.env??process.env;
 const dataDir=path.resolve(options.dataDir??env.YENO_DATA_DIR??path.join(ROOT,'data'));
 const releaseLock=acquireRuntimeLock(dataDir);
 let store;try{store=openStore(dataDir);}catch(error){releaseLock();throw error;}
 const s=store.state;
 const secretFile=path.join(dataDir,'pairing-token');
 let token=options.token??env.YENO_TOKEN;
 if(!token){if(fs.existsSync(secretFile))token=fs.readFileSync(secretFile,'utf8').trim();else{token=crypto.randomBytes(32).toString('base64url');atomicWrite(secretFile,`${token}\n`);}}
 if(typeof token!=='string'||token.length<16){releaseLock();throw new Error('YENO_TOKEN must contain at least 16 characters.');}
 const tokenHash=digest(token);
 const aiBase=env.YENO_AI_BASE_URL??'', aiModel=env.YENO_AI_MODEL??'', aiKey=env.YENO_AI_API_KEY??'';
 let aiEndpoint=null;
 if(aiBase&&aiModel&&aiKey){try{const base=new URL(aiBase);if(!['https:','http:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw new Error();if(base.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw new Error();base.pathname=base.pathname.replace(/\/+$/,'')+'/chat/completions';aiEndpoint=base.href;}catch{releaseLock();throw new Error('YENO_AI_BASE_URL must use HTTPS (HTTP is allowed only on loopback) and contain no credentials, query, or fragment.');}}
 const controllers=new Map(), generations=new Map();
 const invalidate=job=>{generations.set(job.id,(generations.get(job.id)??0)+1);controllers.get(job.id)?.abort();};
 let closed=false, schedulerTimer=null;
 const allowedHosts=new Set(['127.0.0.1','localhost','[::1]',...(env.YENO_ALLOWED_HOSTS??'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean)]);
 function event(text){s.events.unshift({id:uid(),at:now(),text});s.events=s.events.slice(0,300);}
 let restarted=0;
 for(const job of s.jobs)if(['running','queued'].includes(job.status)){job.status='paused';job.pauseReason='restart';job.updatedAt=now();job.version++;restarted++;}
 if(restarted)event(`${restarted} unfinished job(s) paused after restart; owner resume required.`);
 if(store.recovered)event('State recovered from the verified previous backup.');
 if(!aiEndpoint)s.modules.ai=false;
 event('YENO runtime started.');store.save();
 function state(){return {name:'YENO OS',version:VERSION,revision:s.revision,emergencyStop:s.emergencyStop,concurrency:s.concurrency,modules:s.modules,ai:{configured:!!aiEndpoint,model:aiEndpoint?aiModel:null},jobs:s.jobs.map(publicJob),memories:s.memories,snapshots:s.snapshots.map(publicSnapshot),events:s.events,capabilities:{localDocuments:true,persistentMemory:true,diagnostics:true,evolution:'proposals-only',ai:!!aiEndpoint,arbitraryShell:false,browserAutomation:false,remotePCControl:false,snapshotScope:['memories','settings'],maxConcurrency:3}};}
 const save=()=>store.save();
 const touch=job=>{job.updatedAt=now();job.version++;};
 const moduleFor=type=>type==='document'?'documents':type==='ai'?'ai':'diagnostics';
 function requireModule(name){if(!s.modules[name])throw new HttpError(409,`${name} module is disabled`);}
 function newJob(body){
   const type=body.type;if(!['document','diagnostics','evolution','ai'].includes(type))throw new HttpError(422,'Unsupported job type');
   requireModule(moduleFor(type));
   if(type==='ai'&&!aiEndpoint)throw new HttpError(409,'AI provider is not configured');
   if(s.emergencyStop)throw new HttpError(409,'Emergency stop is active. Resume the runtime first.');
   const text=type==='diagnostics'||type==='evolution'?(body.text?requiredText(body.text):type):requiredText(body.text);
   const title=body.title?requiredText(body.title,160):(type==='document'?'문서 만들기':type==='diagnostics'?'YENO 상태 진단':type==='evolution'?'경험 기반 개선 제안':'AI 초안 작성');
   const job={id:uid(),title,type,input:text,status:'queued',step:0,totalSteps:3,createdAt:now(),updatedAt:now(),error:null,version:1,artifacts:[]};
   s.jobs.unshift(job);event(`Job queued: ${title}`);return job;
 }
 function addMemory(body){requireModule('memory');const memory={id:uid(),text:requiredText(body.text,20000),createdAt:now()};s.memories.unshift(memory);event('Memory saved.');return memory;}
 function takeSnapshot(label){const snapshot={id:uid(),label:label?requiredText(label,160):'수동 저장',createdAt:now(),data:structuredClone({memories:s.memories,settings:{concurrency:s.concurrency,modules:s.modules}})};s.snapshots.unshift(snapshot);event(`Snapshot created: ${snapshot.label}`);return snapshot;}
 function active(){return s.jobs.filter(j=>j.status==='running').length;}
 function schedule(){if(closed||schedulerTimer)return;schedulerTimer=setTimeout(tick,150);schedulerTimer.unref();}
 function tick(){schedulerTimer=null;if(closed)return;
   if(!s.emergencyStop){for(const job of s.jobs.slice().reverse()){if(active()>=s.concurrency)break;if(job.status==='queued'){if(!s.modules[moduleFor(job.type)]){job.status='paused';job.pauseReason='moduleDisabled';touch(job);save();continue;}job.status='running';delete job.pauseReason;touch(job);save();const generation=(generations.get(job.id)??0)+1;generations.set(job.id,generation);runStep(job,generation);}}}
   schedule();
 }
 function writeArtifact(job,content,name){
   const id=uid(),filename=`${id}.md`,file=path.join(dataDir,'artifacts',filename);
   atomicWrite(file,content);
   const sha256=digest(content);if(digest(fs.readFileSync(file))!==sha256)throw new Error('Artifact SHA-256 verification failed');
   s.artifacts[id]={id,name,filename,sha256,bytes:Buffer.byteLength(content),jobId:job.id};
   job.artifacts.push({id,name});
 }
 async function aiDraft(job){
   const controller=new AbortController();controllers.set(job.id,controller);
   const timeout=setTimeout(()=>controller.abort(),60000);
   try{const response=await fetch(aiEndpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${aiKey}`},body:JSON.stringify({model:aiModel,messages:[{role:'system',content:'Create a useful draft from the user request. Do not claim to have researched, browsed, executed tools, or modified files. Mark assumptions and uncertainty clearly.'},{role:'user',content:job.normalized}],max_tokens:1800}),signal:controller.signal,redirect:'error'});
   if(!response.ok)throw new Error(`AI provider returned HTTP ${response.status}`);
   const reader=response.body.getReader();let count=0,chunks=[];while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>2*1024*1024){controller.abort();throw new Error('AI provider response exceeded 2 MB');}chunks.push(value);}const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));const result=data.choices?.[0]?.message?.content;if(typeof result!=='string'||!result.trim())throw new Error('AI provider did not return text');return result;
   }finally{clearTimeout(timeout);if(controllers.get(job.id)===controller)controllers.delete(job.id);}
 }
 function diagnosticDocument(job){
   const files=fs.readdirSync(ROOT,{withFileTypes:true}).filter(e=>e.isFile()).map(e=>({name:e.name,bytes:fs.statSync(path.join(ROOT,e.name)).size}));
   const counts=Object.fromEntries(['queued','running','paused','completed','failed','cancelled'].map(status=>[status,s.jobs.filter(j=>j.status===status).length]));
   return `# YENO 실제 상태 진단\n\n작성 시각: ${now()}\n\n- Node: ${process.version}\n- 운영체제: ${os.platform()} ${os.arch()}\n- CPU 논리 코어: ${os.cpus().length}\n- 시스템 메모리: ${(os.totalmem()/1024**3).toFixed(2)} GiB\n- 현재 여유 메모리: ${(os.freemem()/1024**3).toFixed(2)} GiB\n- YENO 프로세스 RSS: ${(process.memoryUsage().rss/1024**2).toFixed(1)} MiB\n- 동시 실행 한도: ${s.concurrency}\n- 기억: ${s.memories.length}개\n- 스냅샷: ${s.snapshots.length}개\n- AI 설정: ${aiEndpoint?'설정됨 (이번 진단에는 호출하지 않음)':'설정 안 됨'}\n\n## 작업 상태\n${Object.entries(counts).map(([k,v])=>`- ${k}: ${v}`).join('\n')}\n\n## 본체 최상위 파일 실측\n${files.map(f=>`- ${f.name}: ${f.bytes} bytes`).join('\n')}\n\n## 범위\n이 실행 환경과 YENO 저장 상태만 측정했습니다. 연결되지 않은 집 PC나 원격 서비스를 진단하지 않았습니다.\n`;
 }
 function evolutionDocument(){
   const failures=s.jobs.filter(j=>j.status==='failed');
   const restarts=s.events.filter(e=>e.text.includes('paused after restart'));
   const proposals=[];
   if(failures.length)proposals.push(`실패 작업 ${failures.length}건을 유형별로 재현하고, 같은 입력을 사용해 수정 전후 성공률을 비교합니다.\n${failures.slice(0,10).map(j=>`  - ${j.id}: ${j.type} — ${j.error}`).join('\n')}`);
   if(restarts.length)proposals.push(`재시작 일시정지 기록 ${restarts.length}건이 있습니다. 사용자가 재개하기 전 외부 작업이 실행되지 않는지 회귀 검증합니다.`);
   const cancelled=s.jobs.filter(j=>j.status==='cancelled').length;
   if(cancelled)proposals.push(`취소 ${cancelled}건이 있습니다. 취소 이유를 사용자가 기록한 뒤 작업 범위나 입력 화면의 개선 여부를 검토합니다. 취소만으로 사용자 선호를 추정하지 않습니다.`);
   if(!proposals.length)proposals.push('현재 저장된 실패·재시작·취소 증거가 부족합니다. 변경의 효과를 주장할 수 없습니다. 실제 작업 5건과 사용자의 수정 이유를 먼저 모읍니다.');
   return `# YENO 경험 기반 개선 후보\n\n작성 시각: ${now()}\n\n## 실제 관측\n- 누적 작업: ${s.jobs.length}\n- 실패: ${failures.length}\n- 취소: ${cancelled}\n- 보존된 재시작 정지 기록: ${restarts.length}\n\n## 개선 후보\n${proposals.map((p,i)=>`${i+1}. ${p}`).join('\n\n')}\n\n## 적용 조건\n후보 생성만 수행했습니다. 코드·권한·예산·프롬프트를 자동 변경하지 않았습니다. 분리된 사본에서 같은 입력으로 비교하고 연호님이 적용 여부를 결정해야 합니다.\n`;
 }
 async function runStep(job,generation){
   const valid=()=>!closed&&job.status==='running'&&generations.get(job.id)===generation;
   if(!valid())return;
   try{
     if(job.step===0){job.normalized=job.input.normalize('NFC').replace(/\r\n?/g,'\n').trim();job.inputSha256=digest(job.input);job.step=1;}
     else if(job.step===1){
       if(job.type==='document'){
         const paras=job.normalized.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean);
         job.draft=`# ${job.title.replace(/[\r\n]/g,' ')}\n\n작성 시각: ${now()}\n\n## 입력 내용을 문서로 정리\n${paras.map((p,i)=>`### ${i+1}\n\n${p}`).join('\n\n')}\n\n## 출처와 처리 내역\n- 출처: 연호님이 이 작업에 입력한 텍스트\n- 처리: 유니코드·줄바꿈 정규화, 빈 줄 기준 문단 분리, 제목·출처 부착\n- 외부 조사 또는 AI 호출: 없음\n- 입력 SHA-256: ${job.inputSha256}\n- 원문 의미를 해석하거나 사실 확인한 문서가 아닙니다.\n`;
       }else if(job.type==='diagnostics')job.draft=diagnosticDocument(job);
       else if(job.type==='evolution')job.draft=evolutionDocument();
       else {const draft=await aiDraft(job);if(!valid())return;job.draft=`# ${job.title}\n\n${draft}\n\n---\nAI 생성 초안 · 모델: ${aiModel}\n외부 사실 검증이나 도구 실행은 하지 않았습니다.\n입력 SHA-256: ${job.inputSha256}\n`;}
       job.step=2;
     }else if(job.step===2){writeArtifact(job,job.draft,`${job.type}-${job.id.slice(0,8)}.md`);delete job.draft;job.step=3;job.status='completed';event(`Job completed and output verified: ${job.title}`);}
     touch(job);save();
   }catch(error){if(!valid())return;job.status='failed';job.error=job.type==='ai'?(String(error.message).startsWith('AI provider')?error.message:'AI request failed or timed out; no provider response details retained.'):String(error.message).slice(0,300);touch(job);event(`Job failed: ${job.title}`);save();}
   if(valid()){const timer=setTimeout(()=>runStep(job,generation),250);timer.unref();}
 }
 function authenticate(req){const supplied=req.headers.authorization;if(typeof supplied!=='string'||!supplied.startsWith('Bearer '))throw new HttpError(401,'Pairing token required');const candidate=digest(supplied.slice(7));if(!crypto.timingSafeEqual(Buffer.from(candidate),Buffer.from(tokenHash)))throw new HttpError(401,'Invalid pairing token');}
 function checkHost(req){const raw=req.headers.host;if(typeof raw!=='string'||!raw||/[\s/@\\#?]/.test(raw))throw new HttpError(403,'Invalid Host');let base;try{base=new URL(`http://${raw}`);if(base.host!==raw.toLowerCase()&&!(raw.endsWith(':80')&&base.host===raw.slice(0,-3).toLowerCase()))throw new Error();}catch{throw new HttpError(403,'Invalid Host');}if(!allowedHosts.has(base.hostname.toLowerCase())&&!allowedHosts.has(raw.toLowerCase()))throw new HttpError(403,'Host is not allowed');if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{throw new HttpError(403,'Invalid Origin');}const direct=['http:','https:'].includes(origin.protocol)&&origin.host.toLowerCase()===raw.toLowerCase();const trustedProxy=origin.protocol==='https:'&&(env.YENO_ALLOWED_HOSTS??'').split(',').map(x=>x.trim().toLowerCase()).includes(origin.host.toLowerCase());if(origin.origin!==req.headers.origin||(!direct&&!trustedProxy))throw new HttpError(403,'Origin does not match Host');}}
 async function body(req){let total=0,parts=[];for await(const part of req){total+=part.length;if(total>MAX_BODY)throw new HttpError(413,'Request body exceeds 256 KB');parts.push(part);}if(!total)return {};let result;try{result=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new HttpError(400,'Invalid JSON body');}if(!result||typeof result!=='object'||Array.isArray(result))throw new HttpError(400,'JSON object required');return result;}
 function respond(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(payload));}
 function mutation(req,url,b,operation){
   const requestId=b.requestId;if(requestId!==undefined&&(typeof requestId!=='string'||!requestId.trim()||requestId.length>160))throw new HttpError(400,'requestId must be a string of 1–160 characters');
   const canonical=value=>{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;};
   const copy={...b};delete copy.requestId;const hash=digest(JSON.stringify({method:req.method,path:url.pathname,body:canonical(copy)}));
   if(requestId&&Object.hasOwn(s.requests,requestId)){const old=s.requests[requestId];if(old.hash!==hash)throw new HttpError(409,'requestId was already used for a different request');return {status:old.status,payload:old.payload};}
   const result=operation();
   if(result.payload?.name==='YENO OS')result.payload.revision=s.revision+1;
   if(result.payload?.state?.name==='YENO OS')result.payload.state.revision=s.revision+1;
   if(requestId){Object.defineProperty(s.requests,requestId,{value:structuredClone({hash,...result}),enumerable:true,writable:true,configurable:true});const keys=Object.keys(s.requests);for(const old of keys.slice(0,Math.max(0,keys.length-2000)))delete s.requests[old];}
   save();schedule();return result;
 }
 const server=http.createServer(async(req,res)=>{
   res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
   try{
     checkHost(req);const url=new URL(req.url,`http://${req.headers.host}`);
     if(req.method==='GET'&&url.pathname==='/api/health')return respond(res,200,{name:'YENO OS',version:VERSION,authRequired:true});
     if(!url.pathname.startsWith('/api/')){
       if(req.method!=='GET'&&req.method!=='HEAD')throw new HttpError(405,'Method not allowed');
       const allowed={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/command-request.mjs':'command-request.mjs','/style.css':'style.css','/manifest.webmanifest':'manifest.webmanifest','/icon.svg':'icon.svg'};
       const filename=allowed[url.pathname];if(!filename)throw new HttpError(404,'Not found');const file=path.join(ROOT,'public',filename);if(!fs.existsSync(file))throw new HttpError(404,'UI not available');const contentTypes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};res.writeHead(200,{'Content-Type':contentTypes[path.extname(file)]??'application/octet-stream'});if(req.method==='HEAD')return res.end();return fs.createReadStream(file).pipe(res);
     }
     authenticate(req);
     if(req.method==='GET'&&url.pathname==='/api/state')return respond(res,200,state());
     if(req.method==='GET'&&url.pathname==='/api/memory'){requireModule('memory');const q=(url.searchParams.get('q')??'').toLocaleLowerCase();return respond(res,200,{memories:s.memories.filter(m=>m.text.toLocaleLowerCase().includes(q))});}
     const artifactMatch=url.pathname.match(/^\/api\/artifacts\/([a-f0-9-]+)$/);
     if(req.method==='GET'&&artifactMatch){const item=s.artifacts[artifactMatch[1]];if(!item)throw new HttpError(404,'Artifact not found');const file=path.join(dataDir,'artifacts',item.filename);if(path.dirname(file)!==path.join(dataDir,'artifacts')||!fs.existsSync(file))throw new HttpError(404,'Artifact file is missing');const bytes=fs.readFileSync(file);if(digest(bytes)!==item.sha256)throw new HttpError(409,'Artifact checksum mismatch; download blocked');res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="${item.name}"`,'X-Content-SHA256':item.sha256});return res.end(bytes);}
     if(req.method!=='POST')throw new HttpError(404,'Not found');
     const b=await body(req);
     const result=mutation(req,url,b,()=>{
       if(url.pathname==='/api/memory')return {status:201,payload:{memory:addMemory(b)}};
       if(url.pathname==='/api/jobs')return {status:201,payload:{job:publicJob(newJob(b))}};
       if(url.pathname==='/api/commands'){
         const text=requiredText(b.text);let match;
         if((match=text.match(/^(?:기억해|remember)\s*[:：]\s*(.+)$/is)))return {status:201,payload:{kind:'memory',memory:addMemory({text:match[1]})}};
         if((match=text.match(/^(?:찾아줘|find)\s*[:：]\s*(.+)$/is))){requireModule('memory');return {status:200,payload:{kind:'search',memories:s.memories.filter(m=>m.text.toLocaleLowerCase().includes(match[1].trim().toLocaleLowerCase()))}};}
         if((match=text.match(/^(?:문서 만들어|document)\s*[:：]\s*(.+)$/is)))return {status:201,payload:{kind:'job',job:publicJob(newJob({type:'document',text:match[1]}))}};
         if(/^(?:진단해|diagnose)$/i.test(text))return {status:201,payload:{kind:'job',job:publicJob(newJob({type:'diagnostics'}))}};
         if(/^(?:개선점 찾아줘|evolve)$/i.test(text))return {status:201,payload:{kind:'job',job:publicJob(newJob({type:'evolution'}))}};
         throw new HttpError(422,'This command is not supported. Use one of the explicit commands.',{examples});
       }
       const actionMatch=url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)\/action$/);
       if(actionMatch){const job=s.jobs.find(j=>j.id===actionMatch[1]);if(!job)throw new HttpError(404,'Job not found');if(b.revision!==undefined&&b.revision!==job.version)throw new HttpError(409,'Job changed; refresh before retrying',{job:publicJob(job)});const action=b.action;if(!['pause','resume','cancel'].includes(action))throw new HttpError(400,'Unsupported action');if(['completed','cancelled','failed'].includes(job.status))throw new HttpError(409,'Terminal jobs cannot be changed');if(action==='pause'){if(!['queued','running'].includes(job.status))throw new HttpError(409,'Job is already paused');job.status='paused';job.pauseReason='owner';invalidate(job);}else if(action==='resume'){if(job.status!=='paused')throw new HttpError(409,'Only paused jobs can resume');if(s.emergencyStop)throw new HttpError(409,'Emergency stop is active');requireModule(moduleFor(job.type));job.status='queued';delete job.pauseReason;}else{job.status='cancelled';delete job.draft;invalidate(job);}touch(job);event(`Job ${action}: ${job.title}`);return {status:200,payload:{job:publicJob(job)}};}
       if(url.pathname==='/api/control'){
         if(b.action==='resume'&&b.revision!==undefined&&b.revision!==s.revision)throw new HttpError(409,'Runtime changed; refresh before resuming',{revision:s.revision});
         if(!['stop','resume'].includes(b.action))throw new HttpError(400,'Unsupported control action');s.emergencyStop=b.action==='stop';
         if(s.emergencyStop){for(const job of s.jobs)if(['running','queued'].includes(job.status)){job.status='paused';job.pauseReason='emergency';touch(job);invalidate(job);}}
         event(s.emergencyStop?'Emergency stop activated.':'Emergency stop released by owner; paused jobs require individual resume.');return {status:200,payload:state()};
       }
       if(url.pathname==='/api/settings'){
         if(b.concurrency!==undefined&&(!Number.isInteger(b.concurrency)||b.concurrency<1||b.concurrency>3))throw new HttpError(400,'concurrency must be 1, 2, or 3');
         if(b.modules!==undefined){if(!b.modules||typeof b.modules!=='object'||Array.isArray(b.modules))throw new HttpError(400,'modules must be an object');for(const [name,value]of Object.entries(b.modules)){if(!Object.hasOwn(s.modules,name)||typeof value!=='boolean')throw new HttpError(400,'Unknown module or non-boolean value');if(name==='ai'&&value&&!aiEndpoint)throw new HttpError(409,'AI provider is not configured');}}
         if(b.concurrency!==undefined)s.concurrency=b.concurrency;if(b.modules)Object.assign(s.modules,b.modules);
         for(const job of s.jobs)if(['running','queued'].includes(job.status)&&!s.modules[moduleFor(job.type)]){job.status='paused';job.pauseReason='moduleDisabled';touch(job);invalidate(job);}
         event('Runtime settings updated.');return {status:200,payload:state()};
       }
       if(url.pathname==='/api/snapshots')return {status:201,payload:{snapshot:publicSnapshot(takeSnapshot(b.label))}};
       const restoreMatch=url.pathname.match(/^\/api\/snapshots\/([a-f0-9-]+)\/restore$/);
       if(restoreMatch){if(b.confirm!==true)throw new HttpError(400,'Explicit confirm:true is required');const snapshot=s.snapshots.find(x=>x.id===restoreMatch[1]);if(!snapshot)throw new HttpError(404,'Snapshot not found');if(s.jobs.some(j=>['running','queued'].includes(j.status)))throw new HttpError(409,'Pause or stop all active jobs before restoring');const pre=takeSnapshot(`복원 전 자동 저장 — ${snapshot.label}`);s.memories=structuredClone(snapshot.data.memories);s.concurrency=snapshot.data.settings.concurrency;s.modules=structuredClone(snapshot.data.settings.modules);if(!aiEndpoint)s.modules.ai=false;event(`Memory/settings restored: ${snapshot.label}. Job and event history preserved.`);return {status:200,payload:{snapshot:publicSnapshot(snapshot),preRestoreSnapshot:publicSnapshot(pre),state:state()}};}
       throw new HttpError(404,'Not found');
     });
     respond(res,result.status,result.payload);
   }catch(error){if(res.headersSent){res.destroy();return;}respond(res,error instanceof HttpError?error.status:500,{error:error instanceof HttpError?error.message:'Internal runtime error; original data preserved.',...(error instanceof HttpError?error.extra:{})});}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;
 function shutdown(){if(closed)return;closed=true;clearTimeout(schedulerTimer);for(const job of s.jobs)if(['running','queued'].includes(job.status)){job.status='paused';job.pauseReason='shutdown';touch(job);}for(const controller of controllers.values())controller.abort();event('Runtime stopped; unfinished jobs paused.');try{save();}finally{releaseLock();server.close();}}
 schedule();
 return {server,state,token,dataDir,shutdown};
}
export async function start(options={}) {
 const env=options.env??process.env;
 const host=options.host??env.YENO_HOST??'127.0.0.1';
 const port=Number(options.port??env.YENO_PORT??8790);
 if(!Number.isInteger(port)||port<0||port>65535)throw new Error('YENO_PORT is invalid');
 const runtime=createYenoServer(options);
 try{await new Promise((resolve,reject)=>{runtime.server.once('error',reject);runtime.server.listen(port,host,resolve);});}
 catch(error){runtime.shutdown();throw error;}
 return runtime;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 start().then(runtime=>{const addr=runtime.server.address();console.log(`YENO OS ${VERSION} ready at http://${process.env.YENO_HOST??'127.0.0.1'}:${addr.port}`);console.log(`PAIRING TOKEN: ${runtime.token}`);console.log('Keep this token private. Pair in the browser; do not put the token in a URL.');for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{runtime.shutdown();setTimeout(()=>process.exit(0),100).unref();});}).catch(error=>{console.error(`YENO startup failed: ${error.message}`);process.exitCode=1;});
}
