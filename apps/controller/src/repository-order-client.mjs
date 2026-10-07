export const PHONE_REPOSITORY_AGENT_ID='repository-developer-worker';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const fail=code=>{const error=new Error(`Repository order client: ${code}`);error.code=code;throw error;};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

export function projectPhoneRepositoryOrder(job){
  if(!object(job)||!UUID.test(job.id??'')||!object(job.repositoryPlan))fail('invalid_job');
  const plan=job.repositoryPlan,order=plan.developerOrder??null,evidence=plan.evidence??null;
  const artifact=order?.artifact??evidence?.artifact??(job.artifacts?.length===1?{id:job.artifacts[0].id,sha256:null,name:job.artifacts[0].name}:null);
  const verificationStatus=plan.verificationStatus??'not-received';
  const displayState=job.status==='failed'||plan.patchStatus==='artifact-invalid'||verificationStatus==='withdrawn'?'failed':job.pauseReason==='outcomeUnknown'?'outcome-unknown':order?.status==='held'?'held-unknown':order?.status==='cancelled'||job.status==='cancelled'?'cancelled':verificationStatus==='docker-verified'?'docker-verified':verificationStatus==='test-adapter-verified'?'test-only':plan.patchStatus==='patch-drafted'&&plan.workerStatus==='no-worker'?'awaiting-worker':plan.executionStatus??job.status;
  return{schema:1,jobId:job.id,requestId:plan.requestId,agentId:plan.agent?.id??null,jobStatus:job.status,displayState,error:job.error??null,pauseReason:job.pauseReason??null,patchStatus:plan.patchStatus,executionStatus:plan.executionStatus,workerStatus:plan.workerStatus,verificationStatus,realDockerVerified:verificationStatus==='docker-verified',syntheticEvidence:verificationStatus==='test-adapter-verified',order:order?{id:order.id,status:order.status,requestId:order.requestId,agentId:order.agent?.id??null,cancellationRequested:order.cancellationRequested,holdReason:order.holdReason}:null,artifact:artifact?{id:artifact.id,sha256:artifact.sha256??null,name:artifact.name??null}:null,evidence:evidence?{authority:evidence.authority,dockerImageId:evidence.dockerImageId,attempts:evidence.attempts,candidateCommit:evidence.candidateCommit}:null};
}

export function createPhoneRepositoryOrderClient({origin,token,fetchImpl=globalThis.fetch}={}){
  let base;try{base=new URL(origin);}catch{fail('invalid_origin');}
  const loopback=['127.0.0.1','localhost','::1'].includes(base.hostname);
  if(base.username||base.password||base.search||base.hash||!['','/'].includes(base.pathname)||!(base.protocol==='https:'||(base.protocol==='http:'&&loopback))||typeof token!=='string'||!token||typeof fetchImpl!=='function')fail('invalid_configuration');
  const request=async(method,pathname,body,{bytes=false}={})=>{
    let response;try{response=await fetchImpl(new URL(pathname,base),{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}catch{fail('transport_outcome_unknown');}
    if(bytes){if(!response.ok)fail(`http_${response.status}`);return{bytes:new Uint8Array(await response.arrayBuffer()),sha256:response.headers.get('x-content-sha256')};}
    let payload;try{payload=await response.json();}catch{fail('invalid_response');}if(!response.ok){const error=new Error(payload?.error??`HTTP ${response.status}`);error.code=payload?.code??`http_${response.status}`;error.status=response.status;throw error;}return payload;
  };
  const boundJob=(payload,jobId)=>{if(!object(payload)||payload.jobId!==jobId||!object(payload.job)||payload.job.id!==jobId)fail('identity_conflict');const view=projectPhoneRepositoryOrder(payload.job);if(view.jobId!==jobId)fail('identity_conflict');return view;};
  const boundCancellation=(payload,jobId)=>{const view=boundJob(payload,jobId),receipt=payload.order,projected=payload.job.repositoryPlan?.developerOrder;if(!object(receipt)||!object(projected)||JSON.stringify(receipt)!==JSON.stringify(projected)||!view.order||receipt.id!==view.order.id)fail('identity_conflict');return view;};
  return{
    submit:async({requestId,agentId=PHONE_REPOSITORY_AGENT_ID,task}={})=>{if(!UUID.test(requestId??'')||agentId!==PHONE_REPOSITORY_AGENT_ID||!object(task))fail('invalid_submit');const payload=await request('POST','/api/v1/developer/plan',{requestId,agentId,task});const view=projectPhoneRepositoryOrder(payload.job);if(view.jobId!==payload.jobId||view.requestId!==requestId||view.agentId!==agentId)fail('identity_conflict');return view;},
    read:async jobId=>{if(!UUID.test(jobId??''))fail('invalid_job_id');return boundJob(await request('GET',`/api/v1/developer/plan/${jobId}`),jobId);},
    cancel:async({requestId,jobId}={})=>{if(!UUID.test(requestId??'')||!UUID.test(jobId??''))fail('invalid_cancel');return boundCancellation(await request('POST','/api/v1/developer/orders/cancel',{requestId,jobId}),jobId);},
    fetchArtifact:async({id,sha256}={})=>{if(!UUID.test(id??'')||!HASH.test(sha256??''))fail('invalid_artifact');const result=await request('GET',`/api/v1/artifacts/${id}`,null,{bytes:true});const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',result.bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');if(result.sha256!==sha256||actual!==sha256)fail('artifact_digest_mismatch');return result.bytes;},
  };
}
