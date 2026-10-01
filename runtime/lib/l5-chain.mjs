import {createHash} from 'node:crypto';import {resolveVerifiedResult} from './blackhole-core.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function causalChain(state,missionId,readArtifact){
 const missionJobs=state.jobs.filter(j=>j.shadowAssignment?.missionId===missionId),builder=missionJobs.find(j=>j.shadowAssignment.role==='builder'),semantic=missionJobs.find(j=>j.shadowAssignment.role==='semanticVerifier');
 if(!builder||!semantic)return {ok:false,reason:'mission_jobs_missing',authorizesDispatch:false};
 const verified=resolveVerifiedResult(semantic,state).ref;if(!verified)return {ok:false,reason:'verdict_not_verified',authorizesDispatch:false};
 const finalArtifact=state.artifacts[verified.artifactId];if(!finalArtifact||sha(readArtifact(finalArtifact))!==verified.artifactSha256)return {ok:false,reason:'final_artifact_hash_mismatch',authorizesDispatch:false};
 const actualBody=readArtifact(finalArtifact).toString('utf8'),priorFailed=state.jobs.some(j=>j.shadowAssignment?.missionId!==missionId&&j.shadowAssignment?.goal===builder.shadowAssignment.goal&&j.projectId===builder.projectId&&j.createdAt<builder.createdAt&&j.status==='failed');
 if(!priorFailed)return {ok:false,reason:'no_prior_failed_same_goal_mission',authorizesDispatch:false};
 for(const draft of state.absorbInbox.entries.filter(e=>e.kind==='research-draft'&&e.status==='draft')){
  const gap=state.gapScout.gaps.find(g=>g.id===draft.payload.gapId);if(!gap)continue;
  for(const receipt of state.kirby.absorptions.filter(r=>r.inboxId===draft.id)){
   const cap=state.capabilities.entries.find(e=>e.id===receipt.capabilityId),version=cap?.versions.find(v=>v.hash===receipt.hash);if(!version?.verification||!cap.activeHash||cap.activeHash!==receipt.hash)continue;
   if(version.manifest.source.url!==draft.payload.candidate.url||version.manifest.source.license!==draft.payload.candidate.license)continue;
   for(const run of state.capabilities.history.filter(h=>h.action==='run'&&h.id===cap.id&&h.hash===version.hash)){
    const job=state.jobs.find(j=>j.id===run.runId&&j.type==='capability'&&j.status==='completed'&&j.capabilityRequest?.hash===version.hash),ref=job?.artifacts?.[0],artifact=ref&&state.artifacts[ref.id];if(!artifact||artifact.jobId!==job.id)continue;
    const bytes=readArtifact(artifact),content=bytes.toString('utf8');if(sha(bytes)!==artifact.sha256||sha(content)!==run.outputSha256)return {ok:false,reason:'capability_artifact_hash_mismatch',authorizesDispatch:false};
    const evidence=builder.input;
    if(!evidence.includes(`<builder_evidence>`)||!evidence.includes(run.runId)||!evidence.includes(run.outputSha256)||!evidence.includes(content))return {ok:false,reason:'capability_output_not_in_builder_input',authorizesDispatch:false};
    if(!actualBody.includes(content))return {ok:false,reason:'capability_output_not_in_builder_result',authorizesDispatch:false};
    return {ok:true,evidenceClass:draft.synthetic?'SYNTHETIC_SEARCH_WITH_REAL_LOCAL_JOBS':'SOURCE_METADATA_VERIFIED',gapId:gap.id,inboxId:draft.id,capabilityId:cap.id,version:version.manifest.version,hash:version.hash,runId:run.runId,missionId,artifactHash:verified.artifactSha256,verdict:semantic.semanticVerdict.verdict,priorFailed:true,authorizesDispatch:false};
   }
  }
 }
 return {ok:false,reason:'no_complete_gap_to_result_chain',authorizesDispatch:false};
}
