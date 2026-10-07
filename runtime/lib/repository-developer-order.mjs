import {RepositoryPatchError} from './repository-patch.mjs';

export const DEVELOPER_ORDER_LEASE_MS=60_000;
export const REPOSITORY_DEVELOPER_AGENT={schema:1,id:'repository-developer-worker',kind:'external-developer-worker',attributes:{}};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const COMMIT=/^[a-f0-9]{40}$/;
const STATUSES=new Set(['queued','claimed','begun','held','cancelled','evidence-received']);
const KEYS=['schema','id','requestId','agent','status','jobId','contractId','baseCommit','artifactId','patchSha256','fence','workerDeviceId','createdAt','updatedAt','claimedAt','begunAt','heartbeatAt','leaseExpiresAt','heldAt','holdReason','cancelRequestedAt','completedAt'];
const fail=code=>{throw new RepositoryPatchError(code);};
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const nullableIso=value=>value===null||iso(value);
const exact=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===KEYS.slice().sort().join();

export function createDeveloperOrder({id,job,artifact,at,requestId,agent=REPOSITORY_DEVELOPER_AGENT}){
  const order={schema:1,id,requestId,agent:structuredClone(agent),status:'queued',jobId:job.id,contractId:job.id,baseCommit:job.repositoryTask.baseCommit,artifactId:artifact.id,patchSha256:artifact.sha256,fence:0,workerDeviceId:null,createdAt:at,updatedAt:at,claimedAt:null,begunAt:null,heartbeatAt:null,leaseExpiresAt:null,heldAt:null,holdReason:null,cancelRequestedAt:null,completedAt:null};
  validateDeveloperOrder(job,order,artifact);return order;
}

export function validateDeveloperOrder(job,order,artifact){
  if(!exact(order)||order.schema!==1||!UUID.test(order.id)||typeof order.requestId!=='string'||!order.requestId.trim()||order.requestId.length>160||!order.agent||typeof order.agent!=='object'||Array.isArray(order.agent)||Object.keys(order.agent).sort().join()!==['schema','id','kind','attributes'].sort().join()||order.agent.schema!==1||typeof order.agent.id!=='string'||!order.agent.id.trim()||order.agent.id.length>80||typeof order.agent.kind!=='string'||!order.agent.kind.trim()||order.agent.kind.length>80||!order.agent.attributes||typeof order.agent.attributes!=='object'||Array.isArray(order.agent.attributes)||Buffer.byteLength(JSON.stringify(order.agent.attributes))>2048||!STATUSES.has(order.status)||order.jobId!==job.id||order.contractId!==job.id||order.baseCommit!==job.repositoryTask?.baseCommit||!UUID.test(order.artifactId)||!HASH.test(order.patchSha256)||!Number.isSafeInteger(order.fence)||order.fence<0||!iso(order.createdAt)||!iso(order.updatedAt)||Date.parse(order.updatedAt)<Date.parse(order.createdAt))fail('invalid_developer_order');
  if(job.developerRequestId!==undefined&&order.requestId!==job.developerRequestId)fail('invalid_developer_order');
  if(job.developerAgent!==undefined&&JSON.stringify(order.agent)!==JSON.stringify(job.developerAgent))fail('invalid_developer_order');
  for(const key of ['claimedAt','begunAt','heartbeatAt','leaseExpiresAt','heldAt','cancelRequestedAt','completedAt'])if(!nullableIso(order[key]))fail('invalid_developer_order');
  if(order.workerDeviceId!==null&&!UUID.test(order.workerDeviceId))fail('invalid_developer_order');
  if(order.holdReason!==null&&!['restart-after-begin','lease-expired-after-begin','owner-cancelled-after-begin'].includes(order.holdReason))fail('invalid_developer_order');
  if(artifact&&(artifact.id!==order.artifactId||artifact.jobId!==job.id||artifact.sha256!==order.patchSha256||artifact.name!==`repository-patch-${job.id.slice(0,8)}.json`||artifact.mimeType!=='application/json'||job.artifacts.length!==1||job.artifacts[0].id!==artifact.id||job.artifacts[0].name!==artifact.name))fail('developer_order_artifact_conflict');
  const empty=keys=>keys.every(key=>order[key]===null),present=keys=>keys.every(key=>order[key]!==null);
  if(order.status==='queued'&&(order.workerDeviceId!==null||!empty(['claimedAt','begunAt','heartbeatAt','leaseExpiresAt','heldAt','holdReason','cancelRequestedAt','completedAt'])))fail('invalid_developer_order');
  if(order.status==='claimed'&&(!order.workerDeviceId||!present(['claimedAt','heartbeatAt','leaseExpiresAt'])||!empty(['begunAt','heldAt','holdReason','cancelRequestedAt','completedAt'])))fail('invalid_developer_order');
  if(order.status==='begun'&&(!order.workerDeviceId||!present(['claimedAt','begunAt','heartbeatAt','leaseExpiresAt'])||!empty(['heldAt','holdReason','cancelRequestedAt','completedAt'])))fail('invalid_developer_order');
  if(order.status==='held'&&(!order.workerDeviceId||!present(['claimedAt','begunAt','heartbeatAt','heldAt','holdReason'])||order.leaseExpiresAt!==null||order.completedAt!==null))fail('invalid_developer_order');
  if(order.status==='cancelled'&&(!present(['cancelRequestedAt','completedAt'])||order.begunAt!==null||order.leaseExpiresAt!==null||order.heldAt!==null||order.holdReason!==null))fail('invalid_developer_order');
  if(order.status==='evidence-received'&&(!order.workerDeviceId||!present(['claimedAt','begunAt','heartbeatAt','completedAt'])||!empty(['leaseExpiresAt','heldAt','holdReason','cancelRequestedAt'])))fail('invalid_developer_order');
  return true;
}

const leaseAt=at=>new Date(Date.parse(at)+DEVELOPER_ORDER_LEASE_MS).toISOString();
const resetQueued=(order,at)=>{order.status='queued';order.workerDeviceId=null;order.updatedAt=at;order.claimedAt=null;order.begunAt=null;order.heartbeatAt=null;order.leaseExpiresAt=null;return order;};
const hold=(order,at,reason)=>{order.status='held';order.updatedAt=at;order.leaseExpiresAt=null;order.heldAt=at;order.holdReason=reason;return order;};

export function reconcileDeveloperOrder(order,at,{restart=false}={}){
  if(restart&&order.status==='begun')return{changed:true,order:hold(order,at,'restart-after-begin')};
  if(restart&&order.status==='claimed')return{changed:true,order:resetQueued(order,at)};
  if(['claimed','begun'].includes(order.status)&&Date.parse(order.leaseExpiresAt)<=Date.parse(at))return{changed:true,order:order.status==='begun'?hold(order,at,'lease-expired-after-begin'):resetQueued(order,at)};
  return{changed:false,order};
}

export function claimDeveloperOrder(order,workerDeviceId,at){
  if(order.status==='claimed'&&order.workerDeviceId===workerDeviceId)return{changed:false,order};
  if(order.status!=='queued')fail('developer_order_unavailable');
  order.status='claimed';order.fence++;order.workerDeviceId=workerDeviceId;order.updatedAt=at;order.claimedAt=at;order.heartbeatAt=at;order.leaseExpiresAt=leaseAt(at);return{changed:true,order};
}

export function beginDeveloperOrder(order,workerDeviceId,fence,at){
  if(order.status==='begun'&&order.workerDeviceId===workerDeviceId&&order.fence===fence)return{changed:false,order};
  if(order.status!=='claimed'||order.workerDeviceId!==workerDeviceId||order.fence!==fence)fail('developer_order_stale_fence');
  order.status='begun';order.updatedAt=at;order.begunAt=at;order.heartbeatAt=at;order.leaseExpiresAt=leaseAt(at);return{changed:true,order};
}

export function heartbeatDeveloperOrder(order,workerDeviceId,fence,at){
  if(!['claimed','begun'].includes(order.status)||order.workerDeviceId!==workerDeviceId||order.fence!==fence)fail('developer_order_stale_fence');
  order.updatedAt=at;order.heartbeatAt=at;order.leaseExpiresAt=leaseAt(at);return{changed:true,order};
}

export function cancelDeveloperOrder(order,at){
  if(order.status==='cancelled'||(order.status==='held'&&order.holdReason==='owner-cancelled-after-begin'))return{changed:false,order};
  if(['held','evidence-received'].includes(order.status))fail('developer_order_terminal');
  order.cancelRequestedAt=at;
  if(order.status==='begun')return{changed:true,order:hold(order,at,'owner-cancelled-after-begin')};
  order.status='cancelled';order.updatedAt=at;order.leaseExpiresAt=null;order.completedAt=at;return{changed:true,order};
}

export function completeDeveloperOrder(order,workerDeviceId,fence,at){
  if(order.status!=='begun'||order.workerDeviceId!==workerDeviceId||order.fence!==fence)fail('developer_order_stale_fence');
  order.status='evidence-received';order.updatedAt=at;order.heartbeatAt=at;order.leaseExpiresAt=null;order.completedAt=at;return order;
}

export function publicDeveloperOrder(order){
  const workerStatus={queued:'no-worker',claimed:'claimed',begun:'begun',held:'uncertain-held',cancelled:'cancelled','evidence-received':'evidence-received'}[order.status];
  return{id:order.id,requestId:order.requestId,agent:structuredClone(order.agent),status:order.status,workerStatus,baseCommit:order.baseCommit,artifact:{id:order.artifactId,sha256:order.patchSha256},leaseExpiresAt:['claimed','begun'].includes(order.status)?order.leaseExpiresAt:null,cancellationRequested:order.cancelRequestedAt!==null,holdReason:order.holdReason,updatedAt:order.updatedAt};
}

export function workerDeveloperOrder(order){return{...publicDeveloperOrder(order),jobId:order.jobId,fence:order.fence,contractId:order.contractId};}
