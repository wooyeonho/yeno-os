#!/usr/bin/env node
// Only run on a disposable trusted worker host with Docker; not on the Koyeb core.
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {runDeveloperTask,DockerSandbox,atomic} from './worker.mjs';
import {CoreGateway,GitHubGateway,dockerEvidenceFrom,reportEvidenceDurably} from './gateways.mjs';
const args=process.argv.slice(2),mode=args.shift();
const arg=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const abort=new AbortController();process.once('SIGINT',()=>abort.abort(new Error('owner_stop')));process.once('SIGTERM',()=>abort.abort(new Error('owner_stop')));
let watcher;

async function reportEvidence(core,jobId,evidence,pendingPath){
  const ok=await reportEvidenceDurably(core,jobId,evidence,pendingPath,abort.signal);
  if(!ok)console.error(JSON.stringify({warning:'evidence_report_failed',pendingPath}));
  return ok;
}

try{
  if(mode==='run'){
    const contract=read(arg('--contract')),root=path.resolve(arg('--repo')??'.'),journalPath=arg('--journal');
    if(!journalPath)throw Error('An external --journal path is required');
    const core=new CoreGateway({origin:process.env.BLACKHOLE_CORE_ORIGIN,token:process.env.BLACKHOLE_WORKER_DEVICE_TOKEN});
    // Pulling/installing images is an explicit host preparation step, never model-driven.
    const imageId=process.env.BLACKHOLE_WORKER_IMAGE_ID;if(!imageId)throw Error('BLACKHOLE_WORKER_IMAGE_ID must pin an already installed Docker image');
    execFileSync('docker',['image','inspect',imageId],{stdio:'ignore',timeout:10000});
    const sandbox=new DockerSandbox({imageId});
    let checking=false;watcher=setInterval(async()=>{if(checking)return;checking=true;try{await core.guard(abort.signal);}catch{abort.abort(new Error('core_stop_or_connection_lost'));}finally{checking=false;}},2000);
    const github=args.includes('--publish')?new GitHubGateway({token:process.env.BLACKHOLE_GITHUB_TOKEN}):null;
    const result=await runDeveloperTask({root,contract,journalPath,model:(t,id,s)=>core.plan(t,id,s),sandbox,guard:()=>core.guard(abort.signal),publish:github?(x,s)=>github.stage(x,s):undefined,signal:abort.signal});
    // core.lastJobId is set only once model() (core.plan) actually ran this
    // invocation; on a replay of an already-terminal journal it stays unset,
    // so the job identity is read back from the journal itself (persisted
    // below the first time it was known) - a replay must still be able to
    // retry a previously-failed evidence report without redoing any work.
    const priorJobId=(()=>{try{return read(journalPath).jobId;}catch{return undefined;}})();
    const jobId=core.lastJobId??priorJobId;
    let evidenceState='not_applicable';
    if(jobId){
      if(core.lastJobId&&core.lastJobId!==priorJobId){
        // Persisted so a later promote/rollback invocation (a separate process,
        // reading only its own --record) still knows which core job this is.
        atomic(journalPath,{...read(journalPath),jobId:core.lastJobId});
      }
      const evidence=dockerEvidenceFrom(result);
      if(evidence){
        const ok=await reportEvidence(core,jobId,evidence,journalPath+'.evidence-pending.json');
        evidenceState=ok?'reported':'pending';
      }
    }
    console.log(JSON.stringify({phase:result.phase,attempts:result.attempts.length,patchSha256:result.patchSha256??null,pr:result.published?.url??null,error:result.error??null,evidence:evidenceState}));
    process.exitCode=(['candidate_verified','awaiting_approval'].includes(result.phase)&&evidenceState!=='pending')?0:1;
  }else if(mode==='promote'||mode==='rollback'){
    // This explicit operator command is not reachable by the model or sandbox.
    // --record is the run() journal for promote (it needs record.published),
    // and promote's own printed result (carrying jobId forward) for rollback.
    const recordPath=arg('--record'),record=read(recordPath),approved=arg('--approve'),head=arg('--expected-head');
    const pendingPath=recordPath+'.evidence-pending.json';
    const github=new GitHubGateway({token:process.env.BLACKHOLE_GITHUB_TOKEN});
    const core=record.jobId?new CoreGateway({origin:process.env.BLACKHOLE_CORE_ORIGIN,token:process.env.BLACKHOLE_WORKER_DEVICE_TOKEN}):null;
    let evidenceOk=true;
    if(mode==='promote'){
      if(core)await core.guard(abort.signal);
      const verificationRunId=Number(arg('--verification-run'));
      const result=await github.approvePromotion({receipt:record.published,approvedCommit:approved,expectedProductionHead:head,verificationRunId},abort.signal);
      if(core)evidenceOk=await reportEvidence(core,record.jobId,{schema:1,ciRun:{id:verificationRunId,conclusion:'success'},approval:{approvedBy:arg('--approved-by')??'owner',approvedCommit:approved,expectedProductionHead:head},promotion:{sourceCommit:result.sourceCommit,previousCommit:result.previousCommit}},pendingPath);
      console.log(JSON.stringify({...result,jobId:record.jobId??null,evidence:core?(evidenceOk?'reported':'pending'):'not_applicable'}));
    }else{
      const result=await github.approveRollback({deployment:record,approvedSourceCommit:approved,expectedProductionHead:head},abort.signal);
      if(core)evidenceOk=await reportEvidence(core,record.jobId,{schema:1,rollback:{rollbackCommit:result.sourceCommit,revertedPromotionCommit:approved}},pendingPath);
      console.log(JSON.stringify({...result,evidence:core?(evidenceOk?'reported':'pending'):'not_applicable'}));
    }
    // The GitHub write already happened and must never be reported as failed
    // just because the core was unreachable afterward - that would invite a
    // retry that repeats the (non-idempotent) GitHub call. So this always
    // exits non-zero on a pending evidence report (it needs reconciling), but
    // never rolls the already-succeeded external operation back or repeats it.
    process.exitCode=evidenceOk?0:1;
  }else if(mode==='sync-evidence'){
    // Resends a previously-failed evidence report without touching Docker or
    // GitHub at all - the only thing this command is allowed to do.
    const pendingPath=arg('--pending');
    if(!pendingPath)throw Error('sync-evidence requires --pending PATH (the <record>.evidence-pending.json left behind by a failed report)');
    const pending=read(pendingPath);
    if(typeof pending?.jobId!=='string'||!pending?.evidence)throw Error('invalid_pending_evidence_record');
    const core=new CoreGateway({origin:process.env.BLACKHOLE_CORE_ORIGIN,token:process.env.BLACKHOLE_WORKER_DEVICE_TOKEN});
    const ok=await reportEvidence(core,pending.jobId,pending.evidence,pendingPath);
    console.log(JSON.stringify({jobId:pending.jobId,evidence:ok?'reported':'pending'}));
    process.exitCode=ok?0:1;
  }else throw Error('Use run --repo PATH --contract FILE --journal OUTSIDE_REPO [--publish], promote/rollback with exact approval and expected head, or sync-evidence --pending PATH to resend a previously-failed report.');
}catch(error){console.error(JSON.stringify({error:error.code??'worker_configuration_or_execution_failed'}));process.exitCode=1;}finally{clearInterval(watcher);}
