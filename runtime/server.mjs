import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {atomicWrite,openStore,acquireRuntimeLock,digest,uid,now} from './lib/store.mjs';
import {acquireContainerLease} from './lib/container-lease.mjs';
import {ProjectError,projectNameKey,validateProjectFields,resolveProject,projectRegistryDocument,projectBriefDocument} from './lib/projects.mjs';
import {SourceError,validateSourceFields,planSourceImport,resolveSource,sourceRegistryDocument,sourceBriefDocument} from './lib/sources.mjs';
import {operatingBriefDocument} from './lib/operations.mjs';
import {exportBackup} from './lib/backup.mjs';
import {DeviceAdminError,publicDevices,revokeDevice} from './lib/device-admin.mjs';
import {RequestLedgerError,validateRequestId,fingerprintRequest,findReceipt,checkCapacity,rememberReceipt,lookupRequest,REQUEST_LEDGER_MAX_ENTRIES,REQUEST_CACHE_MAX_BYTES} from './lib/request-ledger.mjs';
import {createDiscovery,discoveryDocument,DISCOVERY_REPOS} from './lib/discovery.mjs';
import {createEcosystem,publicEcosystem,ecosystemDocument} from './lib/ecosystem.mjs';
import {AGENT_TOOLS,agentConfig,agentUsage,runAgent,recoverAgentJournals,automaticMission,AgentError} from './lib/agent.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const VERSION='0.2.2';
const API_VERSION='1';
const MAX_BODY=256*1024;
class HttpError extends Error {constructor(status,message,extra={}){super(message);this.status=status;this.extra=extra;}}
function requiredText(value,maximum=80000){if(typeof value!=='string'||!value.trim())throw new HttpError(400,'text must be a non-empty string');if(value.length>maximum)throw new HttpError(400,`text is limited to ${maximum} characters`);return value.trim();}
function publicJob(job){const {input,normalized,draft,agentJournal,...out}=job;return {...out,...(agentJournal?{agent:{provider:agentJournal.provider,model:agentJournal.model,calls:agentJournal.calls.length,unknownCalls:agentJournal.calls.filter(call=>call.status!=='settled').length,toolResults:agentJournal.history.filter(message=>message.role==='tool').length}}:{})};}
function publicSnapshot(snapshot){const {data,...out}=snapshot;return out;}
const examples=['흡수 현황','자율 점검','자율 임무: 공식 자료를 읽고 다음 개선 초안을 만들어줘','운영 브리핑','운영 현황','기억해: 이번 주에는 YENO 한 프로젝트에 집중한다','찾아줘: YENO','문서 만들어: YENO의 첫 목표는 기억과 실행이다','프로젝트 목록','프로젝트 브리핑: 프로젝트 이름','프로젝트 작업: 프로젝트 이름 | 준비할 작업','자료 목록','자료 브리핑: 자료 ID','개선 후보: 자료 ID','진단해','개선점 찾아줘'];

export function createYenoServer(options={}) {
 const env=options.env??process.env;
 const agentSettings=agentConfig(env);
 const dataDir=path.resolve(options.dataDir??env.YENO_DATA_DIR??path.join(ROOT,'data'));
 const releaseLock=options.containerLease===true?acquireContainerLease(dataDir):acquireRuntimeLock(dataDir);
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
 if(store.recovered||(!aiEndpoint&&!agentSettings.ready))s.modules.ai=false;
 recoverAgentJournals(s.jobs);
 event('YENO runtime started.');store.save();
 function state(){return {name:'YENO OS',version:VERSION,apiVersion:API_VERSION,requestTracking:{retained:Object.keys(s.requestLedger).length,capacity:REQUEST_LEDGER_MAX_ENTRIES,cached:Object.keys(s.requests).length,cacheMaxBytes:REQUEST_CACHE_MAX_BYTES},revision:s.revision,emergencyStop:s.emergencyStop,concurrency:s.concurrency,modules:s.modules,ai:{configured:!!aiEndpoint||agentSettings.ready,draftConfigured:!!aiEndpoint,model:aiEndpoint?aiModel:agentSettings.ready?agentSettings.model:null},agent:{configured:agentSettings.ready,provider:agentSettings.provider,model:agentSettings.model||null,dailyCallLimit:agentSettings.dailyCallLimit,usage:agentUsage(s.jobs),automaticReviews:agentSettings.ready&&agentSettings.auto&&s.modules.ai&&(s.discovery.enabled||s.ecosystem.enabled)&&!s.emergencyStop,tools:AGENT_TOOLS.map(tool=>tool.name),developmentExecution:false},discovery:{...s.discovery,repositories:DISCOVERY_REPOS},ecosystem:publicEcosystem(s.ecosystem),jobs:s.jobs.map(publicJob),projects:s.projects,sources:s.sources,memories:s.memories,snapshots:s.snapshots.map(publicSnapshot),events:s.events,capabilities:{localDocuments:true,persistentMemory:true,projectManagement:true,sourceIntake:true,scheduledSourceDiscovery:true,boundedAgentLoop:true,ecosystemDiscovery:true,skillEvidenceIntake:true,developerWorker:false,diagnostics:true,evolution:'proposals-only',ai:!!aiEndpoint||agentSettings.ready,arbitraryShell:false,browserAutomation:false,remotePCControl:false,snapshotScope:['memories','settings'],maxConcurrency:3}};}
 // A failed filesystem write leaves its outcome uncertain. Retain its request
 // identity in memory, but never acknowledge a cached receipt or expose that
 // state through the API until the complete state has been persisted again.
 // Rolling back here would be unsafe if a rename committed before the failure.
 let persistencePending=false;
 const save=()=>{persistencePending=true;store.save();persistencePending=false;};
 const ensureDurable=()=>{if(persistencePending)save();};
 const ecosystem=createEcosystem({state:s,save,event,ensureDurable,fetchImpl:options.ecosystemFetch});
 const discovery=createDiscovery({state:s,save,event,ensureDurable,fetchImpl:options.discoveryFetch});
 function controlEcosystem(enabled){if(enabled&&s.emergencyStop)throw new HttpError(409,'전체 멈춤을 해제한 뒤 흡수를 시작하세요.');ecosystem.setEnabled(enabled);event(`Ecosystem intake ${enabled?'enabled':'disabled'}; no installation or model call.`);return {status:200,payload:{ecosystem:publicEcosystem(s.ecosystem)}};}
 function controlDiscovery(enabled){if(enabled&&s.emergencyStop)throw new HttpError(409,'Release emergency stop before enabling source discovery');discovery.setEnabled(enabled);event(`Official source discovery ${enabled?'enabled':'disabled'}; no model or coding execution.`);return {status:200,payload:{discovery:structuredClone(s.discovery)}};}
 const touch=job=>{job.updatedAt=now();job.version++;};
 const moduleFor=type=>type==='document'?'documents':['ai','agent'].includes(type)?'ai':'diagnostics';
 function requireModule(name){if(!s.modules[name])throw new HttpError(409,`${name} module is disabled`);}
 function newJob(body){
   const type=body.type;if(!['document','diagnostics','evolution','ai','agent'].includes(type))throw new HttpError(422,'Unsupported job type');
   if(type==='agent'&&!agentSettings.ready)throw new HttpError(409,'자율 임무는 모델 인증·모델 이름·하루 호출 상한 연결이 필요합니다. 자율 점검에서 연결 상태를 확인하세요.');
   requireModule(moduleFor(type));
   if(type==='ai'&&!aiEndpoint)throw new HttpError(409,'AI provider is not configured');
   if(s.emergencyStop)throw new HttpError(409,'Emergency stop is active. Resume the runtime first.');
   let project;
   if(body.projectId!==undefined){if(typeof body.projectId!=='string'||!s.projects.some(item=>item.id===body.projectId))throw new HttpError(404,'Project not found.');project=s.projects.find(item=>item.id===body.projectId);}
   const text=type==='diagnostics'||type==='evolution'?(body.text?requiredText(body.text):type):requiredText(body.text);
   if(type==='agent'&&text.length>20000)throw new HttpError(400,'Agent mission text is limited to 20000 characters');
   const title=body.title?requiredText(body.title,160):(type==='document'?'문서 만들기':type==='diagnostics'?'YENO 상태 진단':type==='evolution'?'경험 기반 개선 제안':type==='agent'?'YENO 자율 임무':'AI 초안 작성');
   const job={id:uid(),title,type,input:text,status:'queued',step:0,totalSteps:3,createdAt:now(),updatedAt:now(),error:null,version:1,artifacts:[]};
   if(type==='agent')job.agentJournal={provider:agentSettings.provider,model:agentSettings.model,calls:[],history:[{role:'user',content:text}]};
   if(project)job.projectId=project.id;
   s.jobs.unshift(job);event(`Job queued: ${title}`);return job;
 }
 function addMemory(body){requireModule('memory');const memory={id:uid(),text:requiredText(body.text,20000),createdAt:now()};s.memories.unshift(memory);event('Memory saved.');return memory;}
 function ensureUniqueProject(name,exceptId){if(s.projects.some(project=>project.id!==exceptId&&projectNameKey(project.name)===projectNameKey(name)))throw new ProjectError(409,'A project with this name already exists.');}
 function addProject(body){const fields=validateProjectFields(body,{creating:true});ensureUniqueProject(fields.name);const at=now(),project={id:uid(),...fields,version:1,createdAt:at,updatedAt:at};s.projects.push(project);event(`Project registered: ${project.name}`);return project;}
 function updateProject(id,body){const fields=validateProjectFields(body);const index=s.projects.findIndex(project=>project.id===id);if(index<0)throw new ProjectError(404,'Project not found.');const current=s.projects[index];if(body.revision!==current.version)throw new ProjectError(409,'Project changed; refresh before updating.',{project:current});if(fields.name)ensureUniqueProject(fields.name,id);const project={...current,...fields,version:current.version+1,updatedAt:now()};s.projects[index]=project;event(`Project updated: ${project.name} (${project.status})`);return project;}
 function projectDocumentJob(project,content,title,report){const job=newJob({type:'document',text:content,title,...(project?{projectId:project.id}:{})});job.projectReport=report;return publicJob(job);}
 function sourceRecord(fields){const at=now();return {id:uid(),...fields,version:1,createdAt:at,updatedAt:at};}
 function addSource(body){const fields=validateSourceFields(body,{creating:true,projects:s.projects});const existing=s.sources.find(source=>source.canonicalUrl===fields.canonicalUrl);if(existing)throw new SourceError(409,'This canonical source URL is already registered.',{source:existing});const source=sourceRecord(fields);s.sources.push(source);event(`Source registered: ${source.title}`);return source;}
 function updateSource(id,body){const index=s.sources.findIndex(source=>source.id===id);if(index<0)throw new SourceError(404,'Source not found.');const current=s.sources[index];const fields=validateSourceFields(body,{projects:s.projects,current});if(body.revision!==current.version)throw new SourceError(409,'Source changed; refresh before updating.',{source:current});const source={...current,...fields,version:current.version+1,updatedAt:now()};s.sources[index]=source;event(`Source reviewed: ${source.title} (${source.decision})`);return source;}
 function importSources(body){const planned=planSourceImport(body,s.sources,s.projects);const sources=planned.map(item=>item.source??sourceRecord(item.fields));const created=sources.filter((source,index)=>!planned[index].source);s.sources.push(...created);event(`Source import: ${created.length} registered, ${sources.length-created.length} reused.`);return {sources,createdCount:created.length,reusedCount:sources.length-created.length};}
 function sourceDocumentJob(source,content,title){const job=newJob({type:'document',text:content,title:title.slice(0,160),...(source?.projectId?{projectId:source.projectId}:{})});job.sourceReport=true;if(source)job.sourceId=source.id;return publicJob(job);}
 function takeSnapshot(label){const snapshot={id:uid(),label:label?requiredText(label,160):'수동 저장',createdAt:now(),data:structuredClone({memories:s.memories,settings:{concurrency:s.concurrency,modules:s.modules}})};s.snapshots.unshift(snapshot);event(`Snapshot created: ${snapshot.label}`);return snapshot;}
 function active(){return s.jobs.filter(j=>j.status==='running').length;}
 function schedule(){if(closed||schedulerTimer)return;schedulerTimer=setTimeout(tick,150);schedulerTimer.unref();}
 function tick(){schedulerTimer=null;if(closed)return;
   void discovery.tick();
   void ecosystem.tick();
   const mission=automaticMission(s,agentSettings);
   if(mission){const job=newJob({type:'agent',title:'YENO 자동 자료 검토',text:mission.text});job.agentJournal.automaticKey=mission.key;job.agentJournal.automaticScope=mission.scope;save();}
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
   return `# YENO 실제 상태 진단\n\n작성 시각: ${now()}\n\n- Node: ${process.version}\n- 운영체제: ${os.platform()} ${os.arch()}\n- CPU 논리 코어: ${os.cpus().length}\n- 시스템 메모리: ${(os.totalmem()/1024**3).toFixed(2)} GiB\n- 현재 여유 메모리: ${(os.freemem()/1024**3).toFixed(2)} GiB\n- YENO 프로세스 RSS: ${(process.memoryUsage().rss/1024**2).toFixed(1)} MiB\n- 동시 실행 한도: ${s.concurrency}\n- 기억: ${s.memories.length}개\n- 스냅샷: ${s.snapshots.length}개\n- AI 설정: ${aiEndpoint||agentSettings.ready?'설정됨 (이번 진단에는 호출하지 않음)':'설정 안 됨'}\n\n## 작업 상태\n${Object.entries(counts).map(([k,v])=>`- ${k}: ${v}`).join('\n')}\n\n## 본체 최상위 파일 실측\n${files.map(f=>`- ${f.name}: ${f.bytes} bytes`).join('\n')}\n\n## 범위\n이 실행 환경과 YENO 저장 상태만 측정했습니다. 연결되지 않은 집 PC나 원격 서비스를 진단하지 않았습니다.\n`;
 }
 function agentConnectionDocument(){
   const usage=agentUsage(s.jobs);
   return `\n## AI 실행 연결\n- 제공자: ${agentSettings.provider}\n- 준비: ${agentSettings.ready?'설정 있음 — 실제 호출 성공은 별도 확인':'모델 인증·모델 이름·호출 상한 연결 대기'}\n- 오늘 시도: ${usage.attempts} / 하루 상한 ${agentSettings.dailyCallLimit}회\n- 응답 미확인: ${usage.unknown}회\n- 사용량 누락: ${usage.usageMissing}회\n- 자동 자료 검토 설정: ${agentSettings.auto?'켜짐':'꺼짐'}\n- 명령: 자율 임무: 공식 자료를 읽고 다음 개선 초안을 만들어줘\n모델이 읽기 도구를 선택하고 결과를 문서로 남깁니다. 제공자 1개만 사용하며 코드·권한·결제·배포를 실행하지 않습니다. 호출 횟수 제한은 결제 금액 보장이 아닙니다.\n`;
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
         job.draft=job.operatingReport?`${job.normalized}\n\n---\n출처: YENO에 저장된 작업·프로젝트·자료의 생성 시점 상태.\n보고서 입력 SHA-256: ${job.inputSha256}\n`:`# ${job.title.replace(/[\r\n]/g,' ')}\n\n작성 시각: ${now()}\n\n## 입력 내용을 문서로 정리\n${paras.map((p,i)=>`### ${i+1}\n\n${p}`).join('\n\n')}\n\n## 출처와 처리 내역\n- 출처: ${job.sourceReport?'YENO에 등록된 자료와 검토 기록':job.projectReport?'YENO에 등록된 프로젝트 정보와 소유자의 요청':'연호님이 이 작업에 입력한 텍스트'}\n- 처리: 유니코드·줄바꿈 정규화, 빈 줄 기준 문단 분리, 제목·출처 부착\n- 외부 조사 또는 AI 호출: 없음\n- 입력 SHA-256: ${job.inputSha256}\n- 원문 의미를 해석하거나 사실 확인한 문서가 아닙니다.\n`;
       }else if(job.type==='diagnostics')job.draft=diagnosticDocument(job);
       else if(job.type==='evolution')job.draft=evolutionDocument();
       else if(job.type==='agent'){
         const controller=new AbortController();controllers.set(job.id,controller);
         const timeout=setTimeout(()=>controller.abort(),90000);
         try {const draft=await runAgent({job,state:s,config:agentSettings,save:()=>{if(closed)throw new AgentError('runtime_closed');save();},signal:controller.signal,fetchImpl:options.agentFetch});if(!valid())return;job.draft=draft;}
         finally{clearTimeout(timeout);if(controllers.get(job.id)===controller)controllers.delete(job.id);}
       }
       else {const draft=await aiDraft(job);if(!valid())return;job.draft=`# ${job.title}\n\n${draft}\n\n---\nAI 생성 초안 · 모델: ${aiModel}\n외부 사실 검증이나 도구 실행은 하지 않았습니다.\n입력 SHA-256: ${job.inputSha256}\n`;}
       job.step=2;
     }else if(job.step===2){writeArtifact(job,job.draft,`${job.type}-${job.id.slice(0,8)}.md`);delete job.draft;job.step=3;job.status='completed';event(`Job completed and output verified: ${job.title}`);}
     touch(job);save();
   }catch(error){if(!valid())return;job.status='failed';job.error=job.type==='agent'?(error instanceof AgentError?error.message:'Agent execution stopped or failed; inspect preserved checkpoints.'):job.type==='ai'?(String(error.message).startsWith('AI provider')?error.message:'AI request failed or timed out; no provider response details retained.'):String(error.message).slice(0,300);touch(job);event(`Job failed: ${job.title}`);save();}
   if(valid()){const timer=setTimeout(()=>runStep(job,generation),250);timer.unref();}
 }
 function bearer(req){const supplied=req.headers.authorization;if(typeof supplied!=='string'||!supplied.startsWith('Bearer '))return null;return supplied.slice(7);}
 function authenticate(req,deviceOnly=false){const credential=bearer(req);if(!credential)throw new HttpError(401,deviceOnly?'Device token required':'Pairing token required');const candidate=digest(credential);if(!deviceOnly&&crypto.timingSafeEqual(Buffer.from(candidate),Buffer.from(tokenHash)))return {kind:'pairing'};for(const device of Object.values(s.devices)){if(!device.revokedAt&&device.tokenHash===candidate){device.lastSeenAt=now();return {kind:'device',device};}}throw new HttpError(401,deviceOnly?'Invalid or revoked device token':'Invalid pairing token');}
 // A retry can recover the same credential without putting it in request receipts.
 // The pairing secret remains separate from the public device ID and saved hash.
 function deriveDeviceToken(id){return crypto.createHmac('sha256',token).update(`YENO/device-bearer/v1\0${id}`).digest('base64url');}
 function enrollDevice(b){const name=requiredText(b.name,80),platform=requiredText(b.platform,40);const id=uid(),createdAt=now();s.devices[id]={id,name,platform,tokenHash:digest(deriveDeviceToken(id)),createdAt,lastSeenAt:createdAt,revokedAt:null};event(`Device enrolled: ${name} (${platform})`);return {id,name,platform,createdAt};}
 function enrollmentResponse(metadata){
   const device=metadata&&s.devices[metadata.id];
   if(!device||device.revokedAt)throw new HttpError(409,'This enrollment is no longer active. Start a new enrollment with a new requestId.');
   const deviceToken=deriveDeviceToken(device.id);
   // Legacy random credentials remain valid, but cannot be reconstructed. A
   // rotated pairing secret must also never produce a successful wrong token.
   if(device.tokenHash!==digest(deviceToken))throw new HttpError(409,'This enrollment credential cannot be recovered. Start a new enrollment with a new requestId.');
   return {...metadata,deviceToken};
 }
 function checkHost(req){
   const raw=req.headers.host;
   if(typeof raw!=='string'||!raw||/[\s/@\\#?]/.test(raw))throw new HttpError(403,'Invalid Host');
   let base;
   try{base=new URL(`http://${raw}`);if(base.host!==raw.toLowerCase()&&!(raw.endsWith(':80')&&base.host===raw.slice(0,-3).toLowerCase()))throw new Error();}
   catch{throw new HttpError(403,'Invalid Host');}
   if(!allowedHosts.has(base.hostname.toLowerCase())&&!allowedHosts.has(raw.toLowerCase()))throw new HttpError(403,'Host is not allowed');
   if(req.headers.origin){
     let origin;
     try{origin=new URL(req.headers.origin);}catch{throw new HttpError(403,'Invalid Origin');}
     const direct=['http:','https:'].includes(origin.protocol)&&origin.host.toLowerCase()===raw.toLowerCase();
     const trustedProxy=origin.protocol==='https:'&&(env.YENO_ALLOWED_HOSTS??'').split(',').map(x=>x.trim().toLowerCase()).includes(origin.host.toLowerCase());
     // The installed Android app's pinned Tauri HTTP plugin adds its bundled
     // WebView Origin. Allow that exact origin only on the device API; it is
     // not proof of identity. Host checks above and bearer authentication below
     // still apply, and legacy/browser routes retain their existing boundary.
     const bundledNative=req.headers.origin==='http://tauri.localhost'&&req.url.startsWith('/api/v1/')&&new URL(req.url,base).pathname.startsWith('/api/v1/');
     if(origin.origin!==req.headers.origin||(!direct&&!trustedProxy&&!bundledNative))throw new HttpError(403,'Origin does not match Host');
   }
 }
 async function body(req){let total=0,parts=[];for await(const part of req){total+=part.length;if(total>MAX_BODY)throw new HttpError(413,'Request body exceeds 256 KB');parts.push(part);}if(!total)return {};let result;try{result=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new HttpError(400,'Invalid JSON body');}if(!result||typeof result!=='object'||Array.isArray(result))throw new HttpError(400,'JSON object required');return result;}
 function respond(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(payload));}
 function mutation(req,url,b,operation,{required=false,safetyAction=false,fingerprintPath=url.pathname}={}){
   ensureDurable();
   const requestId=validateRequestId(b.requestId,{required});
   const hash=fingerprintRequest(req.method,fingerprintPath,b);
   let persistReceipt=!!requestId;
   if(requestId){
     const receipt=findReceipt(s,requestId,hash);if(receipt)return receipt;
     try{checkCapacity(s,requestId);}catch(error){
       // A full ledger must never prevent an authenticated stop or revoke.
       // These safety actions converge on a disabled state and cannot start
       // work. The response explicitly discloses the unrecorded identity.
       if(!safetyAction||!(error instanceof RequestLedgerError)||error.extra.code!=='REQUEST_LEDGER_CAPACITY')throw error;
       persistReceipt=false;
     }
   }
   const result=operation();
   if(result.payload?.name==='YENO OS')result.payload.revision=s.revision+1;
   if(result.payload?.state?.name==='YENO OS')result.payload.state.revision=s.revision+1;
   if(persistReceipt)rememberReceipt(s,requestId,hash,result);
   else if(requestId)result.payload.receiptPersisted=false;
   save();schedule();return result;
 }
 const server=http.createServer(async(req,res)=>{
   res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
   try{
     checkHost(req);const url=new URL(req.url,`http://${req.headers.host}`);
     if(req.method==='GET'&&(url.pathname==='/api/health'||url.pathname==='/api/v1/health'))return respond(res,200,{name:'YENO OS',version:VERSION,apiVersion:API_VERSION,authRequired:true,authentication:'device-bearer'});
     if(!url.pathname.startsWith('/api/')){
       if(req.method!=='GET'&&req.method!=='HEAD')throw new HttpError(405,'Method not allowed');
       const allowed={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/command-request.mjs':'command-request.mjs','/style.css':'style.css','/manifest.webmanifest':'manifest.webmanifest','/icon.svg':'icon.svg'};
       const filename=allowed[url.pathname];if(!filename)throw new HttpError(404,'Not found');const file=path.join(ROOT,'public',filename);if(!fs.existsSync(file))throw new HttpError(404,'UI not available');const contentTypes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};res.writeHead(200,{'Content-Type':contentTypes[path.extname(file)]??'application/octet-stream'});if(req.method==='HEAD')return res.end();return fs.createReadStream(file).pipe(res);
     }
     const versioned=url.pathname.startsWith('/api/v1/');
     if(versioned&&req.method==='POST'&&url.pathname==='/api/v1/devices/enroll'){
       const b=await body(req);const credential=bearer(req);if(!credential||!crypto.timingSafeEqual(Buffer.from(digest(credential)),Buffer.from(tokenHash)))throw new HttpError(401,'Valid pairing token required');
       const result=mutation(req,url,b,()=>({status:201,payload:{device:enrollDevice(b)}}),{required:true});return respond(res,result.status,{device:enrollmentResponse(result.payload.device)});
     }
     const principal=authenticate(req,versioned);
     if(versioned)url.pathname=url.pathname.replace(/^\/api\/v1/,'/api');
     ensureDurable();
     if(req.method==='GET'&&url.pathname==='/api/devices'){
       if(versioned||principal.kind!=='pairing')throw new HttpError(403,'Owner pairing credential required for device administration');
       return respond(res,200,{devices:publicDevices(s)});
     }
     const ownerRevoke=url.pathname.match(/^\/api\/devices\/([^/]+)\/revoke$/);
     if(req.method==='POST'&&ownerRevoke){
       if(versioned||principal.kind!=='pairing')throw new HttpError(403,'Owner pairing credential required for device administration');
       const b=await body(req);
       if(typeof b.requestId!=='string'||!b.requestId.trim())throw new HttpError(400,'Persistent requestId required');
       const result=mutation(req,url,b,()=>{
         const receipt=revokeDevice(s,ownerRevoke[1]);
         if(!receipt.alreadyRevoked)event(`Device revoked by owner: ${receipt.deviceId}`);
         return {status:200,payload:receipt};
       },{required:true,safetyAction:true});
       return respond(res,result.status,result.payload);
     }
     // Full backups contain private state and credential hashes. Only the
     // owner's pairing credential may export them; device tokens cannot.
     // This read operation is deliberately outside mutation/receipt storage:
     // the one-use encryption key must never be saved in runtime state.
     if(req.method==='POST'&&url.pathname==='/api/backups/export'){
       if(versioned||principal.kind!=='pairing')throw new HttpError(403,'Owner pairing credential required for backup export');
       const b=await body(req);
       if(Object.keys(b).some(key=>key!=='encryptionKey')||typeof b.encryptionKey!=='string'||!/^[a-f0-9]{64}$/i.test(b.encryptionKey))throw new HttpError(400,'A random 32-byte hexadecimal encryptionKey is required');
       ensureDurable();
       const key=Buffer.from(b.encryptionKey,'hex');
       let archive;
       try{archive=exportBackup({state:s,dataDir,key});}finally{key.fill(0);delete b.encryptionKey;}
       res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="yeno-backup.yenobak"','Content-Length':archive.length,'X-Content-SHA256':digest(archive)});
       return res.end(archive);
     }
     if(req.method==='POST'&&url.pathname==='/api/devices/revoke'){
       const b=await body(req);const id=principal.device?.id;if(!id||!s.devices[id])throw new HttpError(404,'Device not found');
       // The effective target comes from authentication, not the body. Bind
       // that target into the fingerprint so another device cannot receive a
       // successful cached revocation for a different device and stay active.
       const result=mutation(req,url,b,()=>{s.devices[id].revokedAt=now();event(`Device revoked: ${s.devices[id].name}`);return {status:200,payload:{revoked:true,deviceId:id}};},{required:versioned,safetyAction:true,fingerprintPath:`/api/devices/${id}/self-revoke`});
       return respond(res,result.status,result.payload);
     }
     const requestMatch=url.pathname.match(/^\/api\/requests\/([^/]+)$/);
     if(req.method==='GET'&&requestMatch){let id;try{id=decodeURIComponent(requestMatch[1]);}catch{throw new HttpError(400,'Invalid encoded requestId');}return respond(res,200,{request:lookupRequest(s,id)});}
     if(req.method==='GET'&&url.pathname==='/api/state')return respond(res,200,state());
     if(req.method==='GET'&&url.pathname==='/api/projects')return respond(res,200,{projects:s.projects});
     if(req.method==='GET'&&url.pathname==='/api/sources')return respond(res,200,{sources:s.sources});
     if(req.method==='GET'&&url.pathname==='/api/memory'){requireModule('memory');const q=(url.searchParams.get('q')??'').toLocaleLowerCase();return respond(res,200,{memories:s.memories.filter(m=>m.text.toLocaleLowerCase().includes(q))});}
     const artifactMatch=url.pathname.match(/^\/api\/artifacts\/([a-f0-9-]+)$/);
     if(req.method==='GET'&&artifactMatch){const item=s.artifacts[artifactMatch[1]];if(!item)throw new HttpError(404,'Artifact not found');const file=path.join(dataDir,'artifacts',item.filename);if(path.dirname(file)!==path.join(dataDir,'artifacts')||!fs.existsSync(file))throw new HttpError(404,'Artifact file is missing');const bytes=fs.readFileSync(file);if(digest(bytes)!==item.sha256)throw new HttpError(409,'Artifact checksum mismatch; download blocked');res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="${item.name}"`,'X-Content-SHA256':item.sha256});return res.end(bytes);}
     if(req.method!=='POST')throw new HttpError(404,'Not found');
     const b=await body(req);
     const result=mutation(req,url,b,()=>{
       if(url.pathname==='/api/ecosystem'){
         if(typeof b.enabled!=='boolean'||Object.keys(b).some(key=>!['enabled','requestId'].includes(key))||!b.requestId)throw new HttpError(400,'Provide enabled:boolean and persistent requestId');
         return controlEcosystem(b.enabled);
       }
       if(url.pathname==='/api/discovery'){
         if(typeof b.enabled!=='boolean'||Object.keys(b).some(key=>!['enabled','requestId'].includes(key)))throw new HttpError(400,'Provide enabled:boolean and requestId only');
         if(!b.requestId)throw new HttpError(400,'Persistent requestId required');
         return controlDiscovery(b.enabled);
       }
       if(url.pathname==='/api/memory')return {status:201,payload:{memory:addMemory(b)}};
       if(url.pathname==='/api/projects')return {status:201,payload:{project:addProject(b)}};
       const projectUpdate=url.pathname.match(/^\/api\/projects\/([a-f0-9-]+)\/update$/);
       if(projectUpdate)return {status:200,payload:{project:updateProject(projectUpdate[1],b)}};
       if(url.pathname==='/api/sources')return {status:201,payload:{source:addSource(b)}};
       if(url.pathname==='/api/sources/import')return {status:201,payload:importSources(b)};
       const sourceUpdate=url.pathname.match(/^\/api\/sources\/([a-f0-9-]+)\/update$/);
       if(sourceUpdate)return {status:200,payload:{source:updateSource(sourceUpdate[1],b)}};
       if(url.pathname==='/api/jobs')return {status:201,payload:{job:publicJob(newJob(b))}};
       if(url.pathname==='/api/commands'){
         const text=requiredText(b.text);let match;
         if(/^흡수\s*현황$/.test(text))return {status:201,payload:{kind:'job',job:sourceDocumentJob(null,ecosystemDocument(s),'YENO 흡수 현황')}};
         if((match=text.match(/^흡수\s+(시작|중지)$/)))return controlEcosystem(match[1]==='시작');
         if((match=text.match(/^자율\s+임무\s*[:：]\s*(.+)$/is)))return {status:201,payload:{kind:'job',job:publicJob(newJob({type:'agent',text:match[1]}))}};
         if(/^자율\s*점검$/i.test(text))return {status:201,payload:{kind:'job',job:sourceDocumentJob(null,discoveryDocument(s.discovery)+ecosystemDocument(s)+agentConnectionDocument(),'YENO 자율 점검')}};
         if((match=text.match(/^자료\s+자동수집\s+(시작|중지)$/))){const result=controlDiscovery(match[1]==='시작');return {...result,payload:{kind:'discovery',...result.payload}};}
         if(/^운영\s+(?:브리핑|현황)$/i.test(text)){
           const report=operatingBriefDocument({projects:s.projects,jobs:s.jobs,sources:s.sources,memories:s.memories,emergencyStop:s.emergencyStop,aiConfigured:!!aiEndpoint||agentSettings.ready,developerWorker:false,generatedAt:now()});
           const job=newJob({type:'document',text:report,title:'YENO 운영 브리핑'});job.operatingReport=true;
           return {status:201,payload:{kind:'job',job:publicJob(job)}};
         }
         if(/^자료\s+목록$/i.test(text))return {status:201,payload:{kind:'job',job:sourceDocumentJob(null,sourceRegistryDocument(s.sources),'개선 자료 목록')}};
         if((match=text.match(/^자료\s+브리핑\s*[:：]\s*(.+)$/is))){const source=resolveSource(s.sources,match[1]);return {status:201,payload:{kind:'job',job:sourceDocumentJob(source,sourceBriefDocument(source),`${source.title} 자료 브리핑`)}};}
         if((match=text.match(/^개선\s+후보\s*[:：]\s*(.+)$/is))){const source=resolveSource(s.sources,match[1]);return {status:201,payload:{kind:'job',job:sourceDocumentJob(source,sourceBriefDocument(source,true),`${source.title} 개선 후보 준비서`)}};}
         if(/^프로젝트\s+목록$/i.test(text))return {status:201,payload:{kind:'job',job:projectDocumentJob(null,projectRegistryDocument(s.projects),'프로젝트 목록','registry')}};
         if((match=text.match(/^프로젝트\s+브리핑\s*[:：]\s*(.+)$/is))){const project=resolveProject(s.projects,match[1]);return {status:201,payload:{kind:'job',job:projectDocumentJob(project,projectBriefDocument(project),`${project.name} 프로젝트 브리핑`,'brief')}};}
         if((match=text.match(/^프로젝트\s+작업\s*[:：]\s*([^|]+)\|\s*(.+)$/is))){const project=resolveProject(s.projects,match[1]),work=requiredText(match[2],60000);return {status:201,payload:{kind:'job',job:projectDocumentJob(project,projectBriefDocument(project,work),`${project.name} 작업 준비서`,'preparation')}};}
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
         if(s.emergencyStop){discovery.stop();ecosystem.stop();for(const job of s.jobs)if(['running','queued'].includes(job.status)){job.status='paused';job.pauseReason='emergency';touch(job);invalidate(job);}}
         event(s.emergencyStop?'Emergency stop activated.':'Emergency stop released by owner; paused jobs require individual resume.');return {status:200,payload:state()};
       }
       if(url.pathname==='/api/settings'){
         if(b.concurrency!==undefined&&(!Number.isInteger(b.concurrency)||b.concurrency<1||b.concurrency>3))throw new HttpError(400,'concurrency must be 1, 2, or 3');
         if(b.modules!==undefined){if(!b.modules||typeof b.modules!=='object'||Array.isArray(b.modules))throw new HttpError(400,'modules must be an object');for(const [name,value]of Object.entries(b.modules)){if(!Object.hasOwn(s.modules,name)||typeof value!=='boolean')throw new HttpError(400,'Unknown module or non-boolean value');if(name==='ai'&&value&&!aiEndpoint&&!agentSettings.ready)throw new HttpError(409,'AI provider is not configured');}}
         if(b.concurrency!==undefined)s.concurrency=b.concurrency;if(b.modules)Object.assign(s.modules,b.modules);
         for(const job of s.jobs)if(['running','queued'].includes(job.status)&&!s.modules[moduleFor(job.type)]){job.status='paused';job.pauseReason='moduleDisabled';touch(job);invalidate(job);}
         event('Runtime settings updated.');return {status:200,payload:state()};
       }
       if(url.pathname==='/api/snapshots')return {status:201,payload:{snapshot:publicSnapshot(takeSnapshot(b.label))}};
       const restoreMatch=url.pathname.match(/^\/api\/snapshots\/([a-f0-9-]+)\/restore$/);
       if(restoreMatch){if(b.confirm!==true)throw new HttpError(400,'Explicit confirm:true is required');const snapshot=s.snapshots.find(x=>x.id===restoreMatch[1]);if(!snapshot)throw new HttpError(404,'Snapshot not found');if(s.jobs.some(j=>['running','queued'].includes(j.status)))throw new HttpError(409,'Pause or stop all active jobs before restoring');const pre=takeSnapshot(`복원 전 자동 저장 — ${snapshot.label}`);s.memories=structuredClone(snapshot.data.memories);s.concurrency=snapshot.data.settings.concurrency;s.modules=structuredClone(snapshot.data.settings.modules);if(!aiEndpoint&&!agentSettings.ready)s.modules.ai=false;event(`Memory/settings restored: ${snapshot.label}. Job and event history preserved.`);return {status:200,payload:{snapshot:publicSnapshot(snapshot),preRestoreSnapshot:publicSnapshot(pre),state:state()}};}
       throw new HttpError(404,'Not found');
     },{required:versioned,safetyAction:(url.pathname==='/api/control'&&b.action==='stop')||(['/api/discovery','/api/ecosystem'].includes(url.pathname)&&b.enabled===false)});
     respond(res,result.status,result.payload);
   }catch(error){if(res.headersSent){res.destroy();return;}const known=error instanceof HttpError||error instanceof ProjectError||error instanceof SourceError||error instanceof DeviceAdminError||error instanceof RequestLedgerError;respond(res,known?error.status:500,{error:known?error.message:'Internal runtime error; original data preserved.',...(known?error.extra:{})});}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;
 function shutdown(){if(closed)return;closed=true;discovery.close();ecosystem.close();clearTimeout(schedulerTimer);for(const job of s.jobs)if(['running','queued'].includes(job.status)){job.status='paused';job.pauseReason='shutdown';touch(job);}for(const controller of controllers.values())controller.abort();event('Runtime stopped; unfinished jobs paused.');try{save();}finally{releaseLock();server.close();}}
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
