// Credentials stay in this trusted controller process, never in test containers.
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {sha256,parseRepositoryPatch} from '../../runtime/lib/repository-patch.mjs';
import {WorkerError,atomic} from './worker.mjs';
const fail=code=>{throw new WorkerError(code);};
async function bounded(response,max=2*1024*1024){
  if(!response.ok){await response.body?.cancel();fail('remote_http_'+response.status);}
  let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>max)fail('remote_response_limit');chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');
}
// Builds the full first-report evidence from a run() journal. Kept alongside
// CoreGateway (rather than inline in the CLI) so the exact same function the
// CLI actually runs is what a test can call and verify against a real core.
export function dockerEvidenceFrom(journal){
  const attempts=(journal.attempts??[]).filter(a=>a.test).map(a=>({number:a.number,exitCode:a.test.exitCode,timedOut:a.test.timedOut,outputOverflow:a.test.outputOverflow,stdoutSha256:a.test.stdoutSha256,stderrSha256:a.test.stderrSha256,isolation:a.test.isolation,passed:a.test.passed}));
  if(!attempts.length)return null;
  const imageId=(journal.attempts??[]).find(a=>a.test?.imageId)?.test.imageId??null;
  return {schema:1,contractId:journal.id,baseCommit:journal.baseCommit,testFiles:journal.tests??[],dockerImageId:imageId,attempts,
    patchSha256:journal.patchSha256??null,candidateCommit:journal.published?.candidateCommit??null,
    publish:journal.published?{repository:journal.published.repository,branch:journal.published.branch,candidateCommit:journal.published.candidateCommit,prNumber:journal.published.prNumber,url:journal.published.url,status:journal.published.status}:null,
    ciRun:null,approval:null,promotion:null,rollback:null,reportedAt:new Date().toISOString()};
}
export class CoreGateway {
  constructor({origin,token,fetchImpl=fetch}){
    const u=new URL(origin);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))fail('invalid_core_origin');
    if(typeof token!=='string'||token.length<16||/[\r\n]/.test(token))fail('core_credential_required');
    this.origin=u.origin;this.token=token;this.fetch=fetchImpl;
  }
  async request(route,body,signal){
    const response=await this.fetch(this.origin+route,{method:body?'POST':'GET',redirect:'error',headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
    return {response,text:await bounded(response)};
  }
  async state(signal){return JSON.parse((await this.request('/api/state',null,signal)).text);}
  async guard(signal){const s=await this.state(signal);if(s.emergencyStop||!s.modules?.ai)fail('core_stopped_or_ai_disabled');if(s.repositoryDevelopment?.patchDrafting!==true)fail('core_patch_api_not_deployed');return s;}
  async plan(task,requestId,signal){
    await this.guard(signal);
    const accepted=JSON.parse((await this.request('/api/developer/plan',{requestId,task},signal)).text);
    if(typeof accepted.jobId!=='string')fail('core_job_identity_missing');
    // Remembered so this same run can report evidence back against the right
    // job without the caller having to thread the ID through separately.
    this.lastJobId=accepted.jobId;
    for(let i=0;i<180;i++){
      const s=await this.guard(signal),job=s.jobs.find(j=>j.id===accepted.jobId);
      if(!job)fail('core_job_missing');
      if(['failed','paused','cancelled'].includes(job.status)){const error=new WorkerError(job.agent?.unknownCalls?'model_outcome_unknown':'core_job_'+job.status);error.settled=job.status==='failed'&&job.agent?.calls===1&&job.agent?.unknownCalls===0;throw error;}
      if(job.status==='completed'){
        const ref=job.artifacts.find(a=>/^repository-patch-.*\.json$/.test(a.name));if(!ref)fail('patch_artifact_missing');
        const {response,text}=await this.request('/api/artifacts/'+encodeURIComponent(ref.id),null,signal);
        if(response.headers.get('X-Content-SHA256')!==sha256(text))fail('patch_artifact_hash_mismatch');
        return JSON.stringify(parseRepositoryPatch(text,task));
      }
      await delay(1000,undefined,{signal});
    }
    fail('model_outcome_unknown');
  }
  // Reports what this trusted host actually saw back into durable core state,
  // instead of leaving it only in the worker's own local journal file.
  async reportEvidence(jobId,evidence,requestId,signal){
    if(typeof jobId!=='string'||!jobId)fail('core_job_identity_missing');
    const {text}=await this.request('/api/developer/evidence',{requestId,jobId,evidence},signal);
    return JSON.parse(text);
  }
}
// The Docker run (or GitHub write) this evidence describes already happened
// and must never be repeated just because the core was briefly unreachable
// when reporting it. So a failed report is never dropped on the floor: it is
// parked at `pendingPath` as {jobId,evidence} so a later call with the same
// arguments - a replay of the run() journal that produced it, or an explicit
// operator resync - can safely resend the exact same evidence. That resend is
// safe because mergeDeveloperEvidence requires an already-reported fact to
// match exactly rather than advance, so it can never be told twice by
// accident. Kept alongside CoreGateway (rather than inline in the CLI) so the
// exact function the CLI runs is what a test can call against a real core.
export async function reportEvidenceDurably(core,jobId,evidence,pendingPath,signal){
  if(!evidence||!jobId)return true;
  try{
    await core.reportEvidence(jobId,evidence,randomUUID(),signal);
    if(pendingPath)try{fs.rmSync(pendingPath);}catch{}
    return true;
  }catch(error){
    if(pendingPath)atomic(pendingPath,{jobId,evidence,error:error.code??String(error)});
    return false;
  }
}
export class GitHubGateway {
  constructor({token,repository='wooyeonho/yeno-os',fetchImpl=fetch}){
    if(repository!=='wooyeonho/yeno-os')fail('repository_not_authorized');
    if(typeof token!=='string'||!token.trim()||/[\r\n]/.test(token))fail('github_credential_required');
    this.repository=repository;this.token=token;this.fetch=fetchImpl;
  }
  async request(route,body,signal,method=body?'POST':'GET'){
    const r=await this.fetch('https://api.github.com/repos/'+this.repository+route,{method,redirect:'error',headers:{Authorization:'Bearer '+this.token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
    return JSON.parse(await bounded(r));
  }
  async stage({contract,patch,evidence},signal){
    if(evidence.phase!=='publishing'||!evidence.attempts.at(-1)?.test?.passed||evidence.patchSha256!==sha256(JSON.stringify(patch)))fail('verified_candidate_required');
    const base=await this.request('/git/ref/heads/codex',null,signal);if(base.object.sha!==contract.baseCommit)fail('remote_base_changed');
    const original=await this.request('/git/commits/'+contract.baseCommit,null,signal);
    const tree=await this.request('/git/trees',{base_tree:original.tree.sha,tree:patch.changes.map(c=>({path:c.path,mode:'100644',type:'blob',content:c.content}))},signal);
    const commit=await this.request('/git/commits',{message:`BLACKHOLE candidate ${contract.id}\n\nPatch SHA-256: ${evidence.patchSha256}`,tree:tree.sha,parents:[contract.baseCommit]},signal);
    const branch='blackhole/worker/'+contract.id;
    // Never overwrite an existing branch, never auto-merge. Unknown writes are held.
    await this.request('/git/refs',{ref:'refs/heads/'+branch,sha:commit.sha},signal);
    const pr=await this.request('/pulls',{head:branch,base:'codex',draft:true,title:'BLACKHOLE 검증 후보: '+contract.goal.slice(0,120),body:`Candidate only; production unchanged.\n\nBase: ${contract.baseCommit}\nCandidate: ${commit.sha}\nPatch: ${evidence.patchSha256}\nImmutable tests: ${evidence.tests.map(t=>t.path+' '+t.sha256).join('\n')}\nModel requests: ${evidence.attempts.length}\nSandbox: ${evidence.attempts.at(-1).test.isolation}\nOwner review and commit-bound CI are required before promotion.`},signal);
    return {repository:this.repository,branch,candidateCommit:commit.sha,baseCommit:contract.baseCommit,baseTree:original.tree.sha,candidateTree:tree.sha,prNumber:pr.number,url:pr.html_url,status:'awaiting_owner_approval'};
  }
  async approvePromotion({receipt,approvedCommit,expectedProductionHead,verificationRunId},signal){
    if(!receipt||receipt.repository!==this.repository||receipt.candidateCommit!==approvedCommit||!/^[a-f0-9]{40}$/.test(approvedCommit)||!/^[a-f0-9]{40}$/.test(expectedProductionHead)||!Number.isSafeInteger(verificationRunId))fail('exact_owner_approval_required');
    const branch=await this.request('/git/ref/heads/'+receipt.branch,null,signal);if(branch.object.sha!==approvedCommit)fail('approved_candidate_changed');
    const candidate=await this.request('/git/commits/'+approvedCommit,null,signal);
    if(candidate.tree.sha!==receipt.candidateTree||candidate.parents.length!==1||candidate.parents[0].sha!==receipt.baseCommit)fail('candidate_provenance_changed');
    const run=await this.request('/actions/runs/'+verificationRunId,null,signal);
    if(run.head_sha!==approvedCommit||run.status!=='completed'||run.conclusion!=='success'||run.event!=='push'||run.path!=='.github/workflows/developer-worker.yml')fail('commit_bound_verification_required');
    const target=await this.request('/git/ref/heads/yeno-koyeb-pilot',null,signal);
    if(target.object.sha!==expectedProductionHead)fail('production_head_changed');
    const before=await this.request('/git/commits/'+expectedProductionHead,null,signal);
    // Deliberately strict: divergent deployed code/data migrations require review.
    if(before.tree.sha!==receipt.baseTree)fail('production_base_tree_mismatch');
    const promoted=await this.request('/git/commits',{message:'Owner-approved BLACKHOLE candidate '+approvedCommit,tree:candidate.tree.sha,parents:[expectedProductionHead,approvedCommit]},signal);
    await this.request('/git/refs/heads/yeno-koyeb-pilot',{sha:promoted.sha,force:false},signal,'PATCH');
    return {status:'deployment_requested_not_verified',sourceCommit:promoted.sha,previousCommit:expectedProductionHead,previousTree:before.tree.sha,candidateCommit:approvedCommit,verificationRunId};
  }
  async approveRollback({deployment,approvedSourceCommit,expectedProductionHead},signal){
    if(!deployment||deployment.sourceCommit!==approvedSourceCommit||expectedProductionHead!==deployment.sourceCommit||!/^[a-f0-9]{40}$/.test(expectedProductionHead))fail('exact_rollback_approval_required');
    const ref=await this.request('/git/ref/heads/yeno-koyeb-pilot',null,signal);if(ref.object.sha!==expectedProductionHead)fail('production_head_changed');
    const previous=await this.request('/git/commits/'+deployment.previousCommit,null,signal);if(previous.tree.sha!==deployment.previousTree)fail('rollback_tree_mismatch');
    const restored=await this.request('/git/commits',{message:'Owner-approved code rollback of '+expectedProductionHead,tree:previous.tree.sha,parents:[expectedProductionHead]},signal);
    await this.request('/git/refs/heads/yeno-koyeb-pilot',{sha:restored.sha,force:false},signal,'PATCH');
    return {status:'rollback_requested_not_verified',sourceCommit:restored.sha,dataRestored:false};
  }
}
