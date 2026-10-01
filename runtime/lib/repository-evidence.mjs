import {evidenceEndpoint,evidenceId,parseGithubRepo,repoMetadata,observeRepository,evidenceReason,validateRepositoryEvidence} from './repository-evidence-state.mjs';
import {readGithubJson} from './github-metadata-http.mjs';
const failure=reason=>Object.assign(Error(reason),{reason,known:true});
const stamp=()=>new Date().toISOString();
export function createRepositoryEvidence({state,save,fetchImpl,now=stamp,timeoutMs=12000}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>12000)throw failure('evidence_timeout_config');
 const synthetic=typeof fetchImpl==='function';const pool=state.repositoryEvidence;
 validateRepositoryEvidence(pool);let closed=false,recovered=false;const controllers=new Set();
 const persist=()=>{validateRepositoryEvidence(pool);save();};
 for(const r of pool.records)if(r.status==='reserved'){
  recovered=true;r.status='unknown';r.reason='restart_outcome_unknown';r.finishedAt=now();
  for(const c of r.calls)if(c.status==='reserved')c.status='unknown';
 }
 if(recovered)persist();
 function reserve(record,kind,url){
  if(!evidenceEndpoint(url))throw failure('evidence_host_or_path_blocked');
  const at=now(),day=at.slice(0,10);let count=pool.days.find(d=>d.day===day);
  if((count?.calls??0)>=pool.dailyCallLimit)throw failure('evidence_daily_budget');
  if(!count){count={day,calls:0};pool.days.push(count);}count.calls++;
  const call={kind,sourceUrl:url,startedAt:at,fetchedAt:null,status:'reserved',httpStatus:null,sha256:null,bodyBase64:null};
  record.calls.push(call);persist();return call;
 }
 async function request(record,kind,initial,signal){
  let url=initial;
  for(let redirect=0;redirect<=2;redirect++){
   const call=reserve(record,kind,url);let receipt;
   try{receipt=await readGithubJson(url,{fetchImpl,signal,timeoutMs});}
   catch(error){call.status=error.known?'settled':'unknown';call.httpStatus=error.httpStatus??null;throw error;}
   call.httpStatus=receipt.httpStatus;call.status='settled';call.fetchedAt=now();
   if(receipt.redirect!==undefined){
    let next;try{next=new URL(receipt.redirect,url).href;}catch{throw failure('evidence_redirect_blocked');}
    if(!evidenceEndpoint(next))throw failure('evidence_redirect_blocked');
    // A redirect may change repository addressing, never switch into contents/code endpoints.
    const pathname=new URL(next).pathname;
    if((kind==='repo'&&pathname.includes('/git/'))||(kind==='head'&&next!==initial))throw failure('evidence_redirect_blocked');
    if(redirect===2)throw failure('evidence_redirect_limit');url=next;persist();continue;
   }
   call.sha256=receipt.sha256;call.bodyBase64=receipt.bodyBase64;persist();return receipt.json;
  }
 }
 async function verify(url,{signal}={}){
  const repo=parseGithubRepo(url);if(!repo)return {status:'evidence_unavailable',reason:'unsupported_repository_url',authorizesDispatch:false};
  const id=evidenceId(repo,synthetic),cached=pool.records.find(r=>r.id===id);if(cached)return structuredClone(cached);
  if(closed||signal?.aborted||state.emergencyStop)return {status:'evidence_unavailable',reason:'evidence_stopped',authorizesDispatch:false};
  if(pool.records.length>=128)return {status:'evidence_unavailable',reason:'evidence_capacity',authorizesDispatch:false};
  const r={id,repo,synthetic,startedAt:now(),finishedAt:null,status:'reserved',reason:null,calls:[],observation:null,authorizesDispatch:false};
  pool.records.push(r);persist();
  const controller=new AbortController(),stop=()=>controller.abort();signal?.addEventListener('abort',stop,{once:true});controllers.add(controller);
  try{
   const metadata=await request(r,'repo',`https://api.github.com/repos/${repo}`,controller.signal);
   let m;try{
    m=repoMetadata(metadata,repo);
    const sourcePath=new URL(r.calls.findLast(c=>c.kind==='repo'&&c.bodyBase64!==null).sourceUrl).pathname;
    if(sourcePath.toLowerCase()!==`/repos/${repo}`&&sourcePath!==`/repositories/${metadata.id}`)throw Error('Repository identity mismatch');
   }catch{throw failure('evidence_identity_or_metadata_invalid');}
   if(closed||state.emergencyStop||controller.signal.aborted)throw failure('evidence_stopped');
   const head=await request(r,'head',`https://api.github.com/repos/${repo}/git/ref/heads/${encodeURIComponent(m.defaultBranch)}`,controller.signal);
   if(closed||state.emergencyStop||controller.signal.aborted)throw failure('evidence_stopped');
   const finished=now();let observation;try{observation=observeRepository(metadata,head,repo,finished);}catch{throw failure('evidence_head_invalid');}
   r.observation=observation;r.finishedAt=finished;r.reason=evidenceReason(observation);r.status=r.reason?'excluded':'verified';
   persist();return structuredClone(r);
  }catch(error){
   if(r.observation!==null)throw error;
   r.status=error.known?'evidence_unavailable':'unknown';r.reason=error.reason??'evidence_outcome_unknown';r.finishedAt=now();
   for(const c of r.calls)if(c.status==='reserved')c.status='unknown';persist();return structuredClone(r);
  }finally{controllers.delete(controller);signal?.removeEventListener('abort',stop);}
 }
 function stop(){for(const c of controllers)c.abort();}
 function close(){closed=true;stop();}
 return {verify,recovered,synthetic,stop,close};
}
