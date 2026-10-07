import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateDeveloperEvidence} from '../../runtime/lib/repository-patch.mjs';
import {DeveloperGatewayError} from './gateway.mjs';

const TERMINAL=new Set(['completed','superseded','failed']);
const UUID=/^[a-f0-9-]{36}$/;
const fail=code=>{const error=new Error(`Developer consumer: ${code}`);error.code=code;throw error;};
const real=value=>fs.realpathSync(path.resolve(value));
const comparable=value=>process.platform==='win32'?path.normalize(value).toLowerCase():path.normalize(value);
const samePath=(left,right)=>comparable(left)===comparable(right);
const sameOrDescendant=(root,candidate)=>{const relative=path.relative(comparable(root),comparable(candidate));return relative===''||(relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative));};
function prospectiveCanonical(target){
  let cursor=target;const tail=[];
  while(!fs.existsSync(cursor)){const parent=path.dirname(cursor);if(parent===cursor)fail('invalid_journal_path');tail.unshift(path.basename(cursor));cursor=parent;}
  return path.resolve(fs.realpathSync(cursor),...tail);
}
const requestId=(orderId,action,sequence=0)=>`developer-consumer:${orderId}:${action}:${sequence}`;
const delay=(ms,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(resolve,ms);const stop=()=>{clearTimeout(timer);reject(signal.reason??Object.assign(Error('aborted'),{code:'ABORTED'}));};signal.addEventListener('abort',stop,{once:true});});
function atomicJournal(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temp=`${file}.${randomUUID()}.tmp`,fd=fs.openSync(temp,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temp,file);
  // Windows cannot portably open/fsync a directory and the inherited upstream
  // helper can terminate this Node build. POSIX retains the stronger barrier.
  if(process.platform!=='win32'){const directory=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}}
}
function processAlive(pid){
  if(pid===process.pid)return true;
  try{process.kill(pid,0);return true;}catch(error){return error?.code!=='ESRCH';}
}
function acquireLock(file){
  const token=randomUUID(),owner={schema:1,pid:process.pid,token,createdAt:new Date().toISOString()},temp=`${file}.${token}.tmp`,fd=fs.openSync(temp,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(owner)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  try{
    for(let attempt=0;attempt<3;attempt++){
      try{fs.linkSync(temp,file);return token;}catch(error){
        if(error?.code!=='EEXIST')throw error;
        let previous;try{previous=JSON.parse(fs.readFileSync(file,'utf8'));}catch{fail('consumer_lock_unrecoverable');}
        if(previous?.schema!==1||!Number.isSafeInteger(previous.pid)||typeof previous.token!=='string')fail('consumer_lock_unrecoverable');
        if(processAlive(previous.pid))fail('consumer_already_running');
        const stale=`${file}.stale-${randomUUID()}`;try{fs.renameSync(file,stale);fs.unlinkSync(stale);}catch(reclaimError){if(reclaimError?.code!=='ENOENT')throw reclaimError;}
      }
    }
    fail('consumer_lock_contention');
  }finally{try{fs.unlinkSync(temp);}catch(error){if(error?.code!=='ENOENT')throw error;}}
}
function releaseLock(file,token){
  let owner;try{owner=JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error?.code==='ENOENT')return;throw error;}
  if(owner?.pid===process.pid&&owner?.token===token)fs.unlinkSync(file);
}

function validateOrder(order){
  if(!order||!UUID.test(order.id??'')||!UUID.test(order.jobId??'')||!['queued','claimed','begun','held','cancelled','evidence-received'].includes(order.status)||!/^[a-f0-9]{40}$/.test(order.baseCommit??'')||!UUID.test(order.artifact?.id??'')||!/^[a-f0-9]{64}$/.test(order.artifact?.sha256??''))fail('invalid_order');
  return structuredClone(order);
}
function loadJournals(directory){
  if(!fs.existsSync(directory))return[];
  return fs.readdirSync(directory).filter(name=>/^order-[a-f0-9-]{36}\.json$/.test(name)).sort().map(name=>{const value=JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));if(value?.schema!==1||!UUID.test(value.orderId??'')||typeof value.status!=='string')fail('invalid_journal');return value;});
}

export function createRepositoryDeveloperConsumer({gateway,executor,repositoryRoot,allowedRoots,journalDir,testFiles,heartbeatIntervalMs=15000,now=()=>new Date().toISOString()}={}){
  if(!gateway||!executor||typeof executor.execute!=='function'||!Array.isArray(allowedRoots)||!allowedRoots.length||!Array.isArray(testFiles)||!testFiles.length||!Number.isInteger(heartbeatIntervalMs)||heartbeatIntervalMs<10)fail('invalid_configuration');
  const root=real(repositoryRoot),allowed=allowedRoots.map(real);if(!allowed.some(item=>samePath(item,root)))fail('repository_root_not_allowlisted');
  const configuredJournal=path.resolve(journalDir);if(sameOrDescendant(root,configuredJournal)||sameOrDescendant(root,prospectiveCanonical(configuredJournal)))fail('journal_must_be_outside_source');fs.mkdirSync(configuredJournal,{recursive:true,mode:0o700});
  const journalRoot=real(configuredJournal);if(sameOrDescendant(root,journalRoot))fail('journal_must_be_outside_source');
  const journalFile=orderId=>path.join(journalRoot,`order-${orderId}.json`),save=journal=>atomicJournal(journalFile(journal.orderId),journal);
  const getCurrent=async journal=>{const orders=await gateway.listOrders();return orders.find(order=>order.id===journal.orderId)??null;};
  const deliver=async journal=>{
    try{
      const current=await getCurrent(journal);if(!current){journal.status='superseded';journal.reason='order_not_visible';journal.updatedAt=now();save(journal);return{status:'superseded',orderId:journal.orderId};}
      if(current.status==='evidence-received'){journal.status='completed';journal.updatedAt=now();save(journal);return{status:'completed',orderId:journal.orderId,reconciled:true};}
      await gateway.submitEvidence(journal.jobId,journal.fence,journal.evidence,journal.evidenceRequestId);journal.status='completed';journal.updatedAt=now();save(journal);return{status:'completed',orderId:journal.orderId};
    }catch(error){if(error instanceof DeveloperGatewayError&&error.outcome==='unknown'){journal.status='delivery-unknown';journal.reason='evidence_delivery_outcome_unknown';journal.updatedAt=now();save(journal);return{status:'delivery-unknown',orderId:journal.orderId};}journal.status='superseded';journal.reason=error.code??'evidence_rejected';journal.updatedAt=now();save(journal);return{status:'superseded',orderId:journal.orderId};}
  };
  const executeClaimed=async(journal,claimed,signal)=>{
    if(claimed.status!=='claimed'||!Number.isSafeInteger(claimed.fence))fail('invalid_claim_response');journal.status='claimed';journal.fence=claimed.fence;journal.order=claimed;journal.updatedAt=now();save(journal);
    const artifact=await gateway.fetchArtifact(claimed.artifact);
    journal.status='beginning';journal.updatedAt=now();save(journal);
    let begun;try{begun=validateOrder((await gateway.begin(journal.jobId,journal.fence,journal.beginRequestId)).order);}catch(error){journal.status=error instanceof DeveloperGatewayError&&error.outcome==='unknown'?'begin-unknown':'superseded';journal.reason=error.code??'begin_rejected';journal.updatedAt=now();save(journal);return{status:journal.status,orderId:journal.orderId};}
    if(begun.status!=='begun'||begun.fence!==journal.fence)fail('invalid_begin_response');journal.status='begun';journal.order=begun;journal.updatedAt=now();save(journal);
    const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});let stopped=false,heartbeatFailure=null;
    const heartbeat=async()=>{if(stopped||controller.signal.aborted)return;const id=requestId(journal.orderId,'heartbeat',journal.heartbeatSequence++);journal.lastHeartbeatRequestId=id;journal.updatedAt=now();save(journal);try{const response=await gateway.heartbeat(journal.jobId,journal.fence,id),order=validateOrder(response.order);if(!['claimed','begun'].includes(order.status)||order.fence!==journal.fence)fail('heartbeat_authority_changed');journal.order=order;journal.updatedAt=now();save(journal);}catch(error){heartbeatFailure=error;journal.status='held-local-unknown';journal.reason=error.code??'heartbeat_outcome_unknown';journal.updatedAt=now();save(journal);controller.abort(error);}};
    await heartbeat();if(heartbeatFailure)return{status:'held-local-unknown',orderId:journal.orderId};
    const loop=(async()=>{while(!stopped&&!controller.signal.aborted){try{await delay(heartbeatIntervalMs,controller.signal);await heartbeat();}catch{break;}}})();
    journal.status='executing';journal.updatedAt=now();save(journal);
    try{
      const evidence=await executor.execute({repositoryRoot:root,order:begun,artifactBytes:artifact,testFiles:[...testFiles],guard:heartbeat,signal:controller.signal});if(controller.signal.aborted||heartbeatFailure)throw heartbeatFailure??Object.assign(Error('heartbeat authority changed'),{code:'heartbeat_authority_changed'});validateDeveloperEvidence(evidence);if(evidence.contractId!==journal.jobId||evidence.baseCommit!==begun.baseCommit||evidence.patchSha256!==begun.artifact.sha256)fail('executor_evidence_conflict');journal.evidence=evidence;journal.status='result-ready';journal.updatedAt=now();save(journal);
    }catch(error){journal.status=controller.signal.aborted?'held-local-unknown':'failed';journal.reason=error.code??(controller.signal.aborted?'execution_cancelled_or_unknown':'executor_failed');journal.updatedAt=now();save(journal);return{status:journal.status,orderId:journal.orderId};}
    finally{stopped=true;controller.abort();await loop;signal?.removeEventListener('abort',abort);}
    return await deliver(journal);
  };
  async function runOnce({signal}={}){
    const lock=path.join(journalRoot,'consumer.lock'),lockToken=acquireLock(lock);
    try{
      const pending=loadJournals(journalRoot).find(journal=>!TERMINAL.has(journal.status));
      if(pending){
        if(['result-ready','delivery-unknown'].includes(pending.status))return await deliver(pending);
        if(pending.status==='claiming'){
          let claimed;try{claimed=validateOrder((await gateway.claim(pending.jobId,pending.claimRequestId)).order);}catch(error){if(error instanceof DeveloperGatewayError&&error.outcome==='unknown')return{status:'claim-unknown',orderId:pending.orderId};pending.status='superseded';pending.reason=error.code??'claim_rejected';pending.updatedAt=now();save(pending);return{status:'superseded',orderId:pending.orderId};}
          return await executeClaimed(pending,claimed,signal);
        }else if(pending.status==='claimed'){
          let current;try{current=validateOrder(await getCurrent(pending));}catch(error){if(error instanceof DeveloperGatewayError&&error.outcome==='unknown')return{status:'offline',reason:error.code,orderId:pending.orderId};pending.status='held-local-unknown';pending.reason=error.code??'claim_reconciliation_failed';pending.updatedAt=now();save(pending);return{status:'held-local-unknown',orderId:pending.orderId};}
          if(current.status==='claimed'&&current.fence===pending.fence)return await executeClaimed(pending,current,signal);
          pending.status='held-local-unknown';pending.reason='claim_authority_changed';pending.updatedAt=now();save(pending);return{status:'held-local-unknown',orderId:pending.orderId};
        }else{
          if(!['held-local-unknown'].includes(pending.status)){pending.status='held-local-unknown';pending.reason='restart_after_possible_begin';pending.updatedAt=now();save(pending);}
          return{status:'held-local-unknown',orderId:pending.orderId};
        }
      }
      let orders;try{orders=await gateway.listOrders();}catch(error){return{status:'offline',reason:error.code??'gateway_unavailable'};}
      const offered=orders.find(order=>order.status==='queued');if(!offered)return{status:'no-work'};const initial=validateOrder(offered);
      const journal={schema:1,orderId:initial.id,jobId:initial.jobId,status:'claiming',fence:null,order:initial,claimRequestId:requestId(initial.id,'claim'),beginRequestId:requestId(initial.id,'begin'),evidenceRequestId:requestId(initial.id,'evidence'),heartbeatSequence:0,evidence:null,reason:null,createdAt:now(),updatedAt:now()};save(journal);
      let claimed;try{claimed=validateOrder((await gateway.claim(journal.jobId,journal.claimRequestId)).order);}catch(error){if(error instanceof DeveloperGatewayError&&error.outcome==='unknown')return{status:'claim-unknown',orderId:journal.orderId};journal.status='superseded';journal.reason=error.code??'claim_rejected';journal.updatedAt=now();save(journal);return{status:'superseded',orderId:journal.orderId};}
      return await executeClaimed(journal,claimed,signal);
    }finally{releaseLock(lock,lockToken);}
  }
  return{runOnce,repositoryRoot:root,journalDir:journalRoot};
}

export function fakeExecutorAdapter(execute){if(typeof execute!=='function')fail('invalid_fake_executor');return{kind:'in-process-fake-executor',execute};}
