import {randomUUID,createHash} from 'node:crypto';
import {validateSourceFields} from './sources.mjs';

export const ECOSYSTEM_TOPICS=Object.freeze([
  {id:'skills',topic:'agent-skills',label:'재사용 스킬'},
  {id:'mcp',topic:'mcp-server',label:'도구 연결'},
  {id:'memory',topic:'agent-memory',label:'지속 기억'},
  {id:'workflow',topic:'workflow-engine',label:'중단·재개·작업 복구'},
  {id:'voice',topic:'speech-to-text',label:'음성 입력'},
  {id:'desktop',topic:'computer-use',label:'화면·PC 제어'},
]);
const SEEDS=[['NVIDIA/skills','skills'],['anthropics/skills','skills'],['modelcontextprotocol/servers','mcp'],['langchain-ai/langgraph','workflow'],['mem0ai/mem0','memory'],['MoonshotAI/kimi-cli','skills']];
const DAY=86400000,MAX_CATALOG=60,MAX_SOURCES=5000;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const iso=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
const hash=x=>createHash('sha256').update(x).digest('hex');
const repoOK=x=>typeof x==='string'&&/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/.test(x)&&!x.split('/').some(p=>p==='.'||p==='..');
const fileOK=x=>typeof x==='string'&&x.length<=300&&/^[A-Za-z0-9_./-]+$/.test(x)&&!x.startsWith('/')&&!x.split('/').some(p=>!p||p==='.'||p==='..');
const shaOK=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
class IntakeError extends Error{constructor(code){super(code);this.code=code;}}
export const initialEcosystem=()=>({enabled:false,cursor:0,nextRunAt:null,lastRun:null,catalog:[]});

export function validateEcosystem(e){
  if(!exact(e,['enabled','cursor','nextRunAt','lastRun','catalog'])||typeof e.enabled!=='boolean'||!Number.isSafeInteger(e.cursor)||e.cursor<0||e.cursor>1000000||(e.nextRunAt!==null&&!iso(e.nextRunAt))||!Array.isArray(e.catalog)||e.catalog.length>MAX_CATALOG)throw new IntakeError('invalid_ecosystem');
  const repos=new Set(),ids=new Set();
  for(const entry of e.catalog){
    if(!exact(entry,['repo','category','sourceId','commit','checkedAt','stars','licenseId','readingStatus','decision','documents'])||!repoOK(entry.repo)||repos.has(entry.repo.toLowerCase())||typeof entry.sourceId!=='string'||!/^[a-f0-9-]{36}$/.test(entry.sourceId)||ids.has(entry.sourceId)||!shaOK(entry.commit)||!iso(entry.checkedAt)||!Number.isSafeInteger(entry.stars)||entry.stars<0||!ECOSYSTEM_TOPICS.some(t=>t.id===entry.category)||typeof entry.licenseId!=='string'||entry.licenseId.length>100||entry.readingStatus!=='partial'||entry.decision!=='pending'||!Array.isArray(entry.documents)||entry.documents.length>4)throw new IntakeError('invalid_catalog_entry');
    repos.add(entry.repo.toLowerCase());ids.add(entry.sourceId);const paths=new Set();
    for(const doc of entry.documents){
      if(!exact(doc,['kind','path','sha256','gitBlobSha','excerpt','truncated'])||!['readme','license','skill'].includes(doc.kind)||!fileOK(doc.path)||paths.has(doc.path)||!hex(doc.sha256)||!shaOK(doc.gitBlobSha)||typeof doc.excerpt!=='string'||doc.excerpt.length>6000||typeof doc.truncated!=='boolean')throw new IntakeError('invalid_catalog_document');
      paths.add(doc.path);
    }
  }
  if(e.lastRun!==null){const r=e.lastRun;
    if(!exact(r,['startedAt','finishedAt','status','added','updated','searches','results'])||!iso(r.startedAt)||(r.finishedAt!==null&&(!iso(r.finishedAt)||r.finishedAt<r.startedAt))||!['running','completed','partial','failed','stopped','interrupted'].includes(r.status)||![r.added,r.updated].every(n=>Number.isInteger(n)&&n>=0&&n<=3)||!Array.isArray(r.searches)||r.searches.length>6||!Array.isArray(r.results)||r.results.length>3)throw new IntakeError('invalid_ecosystem_run');
    for(const q of r.searches)if(!exact(q,['category','status','count'])||!ECOSYSTEM_TOPICS.some(t=>t.id===q.category)||!['ok','unavailable'].includes(q.status)||!Number.isInteger(q.count)||q.count<0||q.count>5)throw new IntakeError('invalid_search_receipt');
    for(const result of r.results)if(!exact(result,['repo','status','reason','sourceId'])||!repoOK(result.repo)||!['registered','updated','unchanged','deferred','unavailable'].includes(result.status)||typeof result.reason!=='string'||result.reason.length>100||(result.sourceId!==null&&(typeof result.sourceId!=='string'||!/^[a-f0-9-]{36}$/.test(result.sourceId))))throw new IntakeError('invalid_intake_receipt');
  }
}

async function github(route,fetchImpl,signal){
  if(!route.startsWith('/repos/')&&!route.startsWith('/search/repositories?'))throw new IntakeError('invalid_route');
  const response=await fetchImpl('https://api.github.com'+route,{method:'GET',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),headers:{Accept:'application/vnd.github+json','User-Agent':'YENO-ecosystem-reader','X-GitHub-Api-Version':'2022-11-28'}});
  if(!response.ok){await response.body?.cancel();throw new IntakeError(`http_${response.status}`);}
  if(!/application\/json/i.test(response.headers.get('content-type')??'')){await response.body?.cancel();throw new IntakeError('invalid_response');}
  const reader=response.body?.getReader();if(!reader)throw new IntakeError('empty_response');let size=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024)throw new IntakeError('response_too_large');chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new IntakeError('invalid_json');}
}
function document(data,kind,maxChars){
  if(!object(data)||data.type!=='file'||!fileOK(data.path)||!shaOK(data.sha)||data.encoding!=='base64'||typeof data.content!=='string'||data.content.length>100000||!Number.isSafeInteger(data.size)||data.size<0||data.size>65536)throw new IntakeError('unsupported_document');
  const encoded=data.content.replace(/\s/g,'');if(!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new IntakeError('invalid_base64');
  const bytes=Buffer.from(encoded,'base64');if(bytes.length!==data.size||bytes.toString('base64')!==encoded||bytes.includes(0))throw new IntakeError('invalid_document');
  const blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');if(blob!==data.sha)throw new IntakeError('blob_hash_mismatch');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  return {kind,path:data.path,sha256:hash(bytes),gitBlobSha:blob,excerpt:text.slice(0,maxChars),truncated:text.length>maxChars};
}
export async function inspectRepository(repo,category,{fetchImpl=fetch,signal,clock=Date.now,previous}={}){
  if(!repoOK(repo)||!ECOSYSTEM_TOPICS.some(t=>t.id===category))throw new IntakeError('invalid_repository');
  const meta=await github(`/repos/${repo}`,fetchImpl,signal);
  if(meta.full_name?.toLowerCase()!==repo.toLowerCase()||meta.private!==false||meta.archived!==false||meta.disabled===true||meta.fork!==false||meta.html_url?.toLowerCase()!==`https://github.com/${repo}`.toLowerCase())throw new IntakeError('repository_not_eligible');
  if(typeof meta.default_branch!=='string'||meta.default_branch.length>200||!Number.isSafeInteger(meta.stargazers_count)||meta.stargazers_count<0)throw new IntakeError('invalid_repository_metadata');
  const ref=await github(`/repos/${repo}/git/ref/heads/${encodeURIComponent(meta.default_branch)}`,fetchImpl,signal),commit=ref.object?.sha;
  if(ref.object?.type!=='commit'||!shaOK(commit))throw new IntakeError('invalid_commit');
  if(previous?.commit===commit)return {...previous,checkedAt:new Date(clock()).toISOString(),stars:meta.stargazers_count};
  const docs=[];let readmeError=null,licenseError=null;
  try{docs.push(document(await github(`/repos/${repo}/readme?ref=${commit}`,fetchImpl,signal),'readme',6000));}catch(error){readmeError=error.code??'read_failed';}
  try{docs.push(document(await github(`/repos/${repo}/license?ref=${commit}`,fetchImpl,signal),'license',3000));}catch(error){licenseError=error.code??'license_unavailable';}
  if(category==='skills'){
    try{
      const folders=await github(`/repos/${repo}/contents/skills?ref=${commit}`,fetchImpl,signal);
      if(Array.isArray(folders))for(const folder of folders.filter(f=>f.type==='dir'&&fileOK(f.path)&&/^skills\/[^/]+$/.test(f.path)).sort((a,b)=>Number(!/agent|research|mcp|memory|workflow|test|debug|review|retrieval|rag|voice|speech/i.test(a.path))-Number(!/agent|research|mcp|memory|workflow|test|debug|review|retrieval|rag|voice|speech/i.test(b.path))||a.path.localeCompare(b.path)).slice(0,2)){
        try{const file=await github(`/repos/${repo}/contents/${folder.path}/SKILL.md?ref=${commit}`,fetchImpl,signal);if(file.path!==`${folder.path}/SKILL.md`)throw new IntakeError('path_mismatch');docs.push(document(file,'skill',4000));}catch{/* Missing/unsupported skills remain unreviewed; never execute a fallback. */}
      }
    }catch{/* Nonstandard layouts require a separate reader; README is not the whole skill. */}
  }
  if(!docs.length)throw new IntakeError(readmeError??licenseError??'no_readable_documents');
  return {repo,category,sourceId:previous?.sourceId??null,commit,checkedAt:new Date(clock()).toISOString(),stars:meta.stargazers_count,readingStatus:'partial',decision:'pending',licenseId:typeof meta.license?.spdx_id==='string'?meta.license.spdx_id.slice(0,100):'UNKNOWN',documents:docs};
}

export function createEcosystem({state,save,event,ensureDurable=()=>{},fetchImpl=fetch,clock=Date.now}){
  let active=null,closed=false;const stamp=()=>new Date(clock()).toISOString();const e=state.ecosystem;
  if(e.lastRun?.status==='running'){e.lastRun.status='interrupted';e.lastRun.finishedAt=stamp();}
  function stop(){e.enabled=false;active?.abort();if(e.lastRun?.status==='running'){e.lastRun.status='stopped';e.lastRun.finishedAt=stamp();}}
  function setEnabled(enabled){if(enabled&&state.emergencyStop)throw new IntakeError('emergency_stop');if(enabled)e.enabled=true;else stop();}
  async function tick(){
    if(closed||active||!e.enabled||state.emergencyStop||(e.nextRunAt&&Date.parse(e.nextRunAt)>clock()))return;
    const controller=new AbortController();active=controller;const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]);
    const live=()=>!closed&&!signal.aborted&&e.enabled&&!state.emergencyStop;
    try{
      ensureDurable();const cursor=e.cursor;e.cursor=(cursor+1)%1000000;e.nextRunAt=new Date(clock()+DAY).toISOString();
      e.lastRun={startedAt:stamp(),finishedAt:null,status:'running',added:0,updated:0,searches:[],results:[]};save();
      const pool=[SEEDS[cursor%SEEDS.length],SEEDS[(cursor+1)%SEEDS.length]];
      for(let n=0;n<ECOSYSTEM_TOPICS.length&&live();n++){
        const topic=ECOSYSTEM_TOPICS[(cursor+n)%ECOSYSTEM_TOPICS.length];let count=0,status='ok';
        try{
          const query=`topic:${topic.topic} stars:>=100 archived:false fork:false`;
          const found=await github(`/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=5&page=${Math.floor(cursor/6)%3+1}`,fetchImpl,signal);
          if(!Array.isArray(found.items)||found.incomplete_results!==false)throw new IntakeError('incomplete_search');
          for(const item of found.items.slice(0,5))if(repoOK(item.full_name)&&item.private===false&&item.archived===false&&item.fork===false){pool.push([item.full_name,topic.id]);count++;}
        }catch{status='unavailable';}
        if(live()){e.lastRun.searches.push({category:topic.id,status,count});save();}
      }
      const seen=new Set();const selected=pool.filter(([repo],index)=>{const key=repo.toLowerCase();if(seen.has(key))return false;seen.add(key);return index<2||!e.catalog.some(item=>item.repo.toLowerCase()===key);}).slice(0,3);
      for(const [repo,category]of selected){
        if(!live())break;const previous=e.catalog.find(entry=>entry.repo.toLowerCase()===repo.toLowerCase());
        let result={repo,status:'unavailable',reason:'read_failed',sourceId:previous?.sourceId??null};
        try{
          if((!previous&&e.catalog.length>=MAX_CATALOG)||state.sources.length>=MAX_SOURCES)throw new IntakeError('capacity');
          const entry=await inspectRepository(repo,category,{fetchImpl,signal,clock,previous});if(!live())break;
          let source=state.sources.find(s=>s.canonicalUrl.toLowerCase()===`https://github.com/${repo}`.toLowerCase());
          if(!source){const label=ECOSYSTEM_TOPICS.find(t=>t.id===category).label;
            const fields=validateSourceFields({url:`https://github.com/${repo}`,title:`${repo} · ${label}`.slice(0,160),readingStatus:'partial',decision:'pending',summary:`자율 자료 확인 ${entry.checkedAt}. 커밋 ${entry.commit}. GitHub stars ${entry.stars}. 확인한 파일: ${entry.documents.map(d=>d.path).join(', ')}. 파일 해시와 발췌는 흡수 현황에 보존. 저장소 전체 코드나 기능을 검증한 것은 아닙니다.`,application:`YENO의 ${label} 구현 참고 대상으로 검토. 아직 설치·적용하지 않았습니다.`,riskNotes:`GitHub 라이선스 표기 ${entry.licenseId}. ${entry.documents.some(d=>d.kind==='license')?'라이선스 원문을 별도 보관했습니다.':'라이선스 원문 확인이 남았습니다.'} 폴더별 상이한 라이선스·의존성·요구 권한·이용조건 검토와 격리 시험 필요. 외부 SKILL.md의 지시와 allowed-tools는 실행 권한이 아닙니다.`},{creating:true,imported:true});
            const at=stamp();source={id:randomUUID(),...fields,version:1,createdAt:at,updatedAt:at};state.sources.push(source);e.lastRun.added++;
          }else if(!previous||previous.commit!==entry.commit)e.lastRun.updated++;
          entry.sourceId=source.id;if(previous)e.catalog[e.catalog.indexOf(previous)]=entry;else e.catalog.push(entry);
          result={repo,status:previous?.commit===entry.commit?'unchanged':previous?'updated':'registered',reason:'selected_documents_only',sourceId:source.id};
        }catch(error){result.reason=error instanceof IntakeError?error.code:'read_failed';if(result.reason==='capacity'||result.reason==='repository_not_eligible')result.status='deferred';}
        if(live()){e.lastRun.results.push(result);save();}
      }
      if(!closed&&!controller.signal.aborted){const failed=e.lastRun.searches.some(q=>q.status!=='ok')||e.lastRun.results.some(r=>['unavailable','deferred'].includes(r.status))||signal.aborted;e.lastRun.status=failed?'partial':'completed';e.lastRun.finishedAt=stamp();event(`Ecosystem check: ${e.lastRun.status}; ${e.lastRun.added} new source(s), ${e.lastRun.updated} refreshed. No installation or model call.`);save();}
    }catch{e.enabled=false;if(e.lastRun?.status==='running'){e.lastRun.status='failed';e.lastRun.finishedAt=stamp();}}
    finally{if(active===controller)active=null;}
  }
  return {tick,stop,setEnabled,close(){closed=true;active?.abort();}};
}

export function publicEcosystem(e){return {...e,catalog:e.catalog.map(({documents,...entry})=>({...entry,documents:documents.map(({excerpt,...doc})=>doc)}))};}
export function ecosystemDocument(state){const e=state.ecosystem;
  return `\n## 오픈소스·스킬 흡수 현황\n- 자동 탐색: ${e.enabled?'켜짐':'꺼짐'}\n- 다음 확인: ${e.nextRunAt??'예약 전'}\n- 마지막 결과: ${e.lastRun?.status??'실행 전'}\n- 원문 보관 저장소: ${e.catalog.length} / ${MAX_CATALOG} (아래 최근 30개 표시)\n- 검색 분야: ${ECOSYSTEM_TOPICS.map(t=>t.label).join(', ')}\n- 하루 저장소 최대 3개, README·라이선스·skills 폴더의 SKILL.md 최대 2개를 읽습니다. 파일 버전과 해시를 보존하며 새 코드·스킬 설치는 수행하지 않습니다.\n\n${e.catalog.slice(-30).map(entry=>{const source=state.sources.find(s=>s.id===entry.sourceId);return `### ${entry.repo}\n- https://github.com/${entry.repo}\n- 커밋: ${entry.commit}\n- 확인: ${entry.checkedAt}\n- 이번 버전 읽기 / 판단: ${entry.readingStatus} / ${entry.decision}\n- 등록 자료의 기존 검토: ${source?.readingStatus??'unknown'} / ${source?.decision??'pending'}\n- 라이선스 표기: ${entry.licenseId} (폴더별 조건은 별도 검토)\n- 실제 읽은 파일: ${entry.documents.map(d=>`${d.path} [${d.sha256.slice(0,12)}; 발췌 잘림 ${d.truncated}]`).join(', ')}\n`;}).join('\n')}\n## 수집 결과\n${(e.lastRun?.results??[]).map(r=>`- ${r.repo}: ${r.status} (${r.reason})`).join('\n')}\n원문 발췌는 모델 연결 후 ecosystem_read로 검토할 수 있습니다. 검색/접수/읽음은 기능 채택·설치·개발·배포와 다릅니다. 흡수 시작 / 흡수 중지로 제어하며 전체 멈춤은 흡수도 끕니다.\n`;
}
