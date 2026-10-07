import {RepositoryPatchError,validateDeveloperEvidence} from './repository-patch.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const COMMIT=/^[a-f0-9]{40}$/;
const PLATFORMS=new Set(['developer-worker','developer-worker-fixture']);
const KEYS=['schema','workerDeviceId','workerPlatform','jobId','artifactId','patchSha256','baseCommit','contractId','receivedAt'];
const OPTIONAL_KEYS=['authority','withdrawnAt','withdrawalReason'];
const fail=code=>{throw new RepositoryPatchError(code);};
const fields=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&KEYS.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>KEYS.includes(key)||OPTIONAL_KEYS.includes(key));
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;

export function validateDeveloperEvidenceBinding(job){
  const evidence=job?.developerEvidence,binding=job?.developerEvidenceBinding;
  if(evidence===undefined&&binding===undefined)return true;
  if(evidence===undefined||binding===undefined||!job.repositoryTask||job.step!==3||job.artifacts.length!==1)fail('invalid_evidence_binding');
  validateDeveloperEvidence(evidence);
  if(!fields(binding)||binding.schema!==1||!UUID.test(binding.workerDeviceId)||!PLATFORMS.has(binding.workerPlatform)||!UUID.test(binding.jobId)||!UUID.test(binding.artifactId)||!HASH.test(binding.patchSha256)||!COMMIT.test(binding.baseCommit)||!UUID.test(binding.contractId)||!iso(binding.receivedAt))fail('invalid_evidence_binding');
  const authority=binding.authority??'active';
  if(authority==='active'){
    if(job.status!=='completed'||Object.hasOwn(binding,'withdrawnAt')||Object.hasOwn(binding,'withdrawalReason'))fail('invalid_evidence_binding');
  }else if(authority==='withdrawn'){
    if(job.status!=='failed'||binding.withdrawalReason!=='artifact-invalid'||!iso(binding.withdrawnAt)||job.error!=='Repository patch artifact changed; stored completion quarantined.')fail('invalid_evidence_binding');
  }else fail('invalid_evidence_binding');
  if(binding.jobId!==job.id||binding.contractId!==job.id||evidence.contractId!==job.id||binding.baseCommit!==job.repositoryTask.baseCommit||evidence.baseCommit!==binding.baseCommit||binding.patchSha256!==evidence.patchSha256)fail('evidence_conflict');
  const references=job.artifacts.filter(reference=>reference?.id===binding.artifactId);
  if(references.length!==1)fail('invalid_evidence_binding');
  return true;
}

export function createDeveloperEvidenceBinding({job,evidence,worker,artifact,receivedAt}){
  const binding={schema:1,workerDeviceId:worker.id,workerPlatform:worker.platform,jobId:job.id,artifactId:artifact.id,patchSha256:artifact.sha256,baseCommit:job.repositoryTask.baseCommit,contractId:job.id,receivedAt,authority:'active'};
  const candidate={...job,developerEvidence:evidence,developerEvidenceBinding:binding};
  validateDeveloperEvidenceBinding(candidate);
  return binding;
}

export function assertEvidenceWorker(principal,{fixtureMode=false}={}){
  const device=principal?.kind==='device'?principal.device:null;
  if(!device||!PLATFORMS.has(device.platform))fail('developer_worker_required');
  if(device.platform==='developer-worker-fixture'&&!fixtureMode)fail('fixture_worker_disabled');
  return device;
}

export function assertEvidenceReportBinding({job,evidence,artifact,worker,fixtureMode=false}){
  if(!job?.repositoryTask||job.status!=='completed')fail('repository_patch_not_ready');
  if(evidence.contractId!==job.id||evidence.baseCommit!==job.repositoryTask.baseCommit||evidence.patchSha256!==artifact.sha256)fail('evidence_conflict');
  if(fixtureMode&&worker.platform==='developer-worker-fixture'&&evidence.attempts.some(attempt=>attempt.isolation==='docker-no-network'))fail('fixture_cannot_claim_docker');
  const previous=job.developerEvidenceBinding;
  if(previous&&(previous.workerDeviceId!==worker.id||previous.workerPlatform!==worker.platform||previous.artifactId!==artifact.id||previous.patchSha256!==artifact.sha256))fail('evidence_conflict');
  return true;
}
