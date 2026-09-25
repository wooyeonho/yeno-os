// Local-only, owner-triggered acceptance check for one existing project goal.
// Default mode is read-only. `--run` creates one Shadow mission through the
// real /api/voice route; it never creates a project/quest or retries a send.
import {fileURLToPath} from 'node:url';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CHECK_ID=/^[A-Za-z0-9_-]{8,64}$/;
const LOCAL_HOSTS=new Set(['127.0.0.1','localhost','[::1]']);
const LIVE_REQUEST='blackhole-p3-living-loop-v1';
const MODEL_CALL_HEADROOM=12;
const MAX_RESPONSE_BYTES=2*1024*1024;

class VerificationError extends Error {
  constructor(code,status){super(code);this.name='VerificationError';this.code=code;this.status=status;}
}
const requireCheck=(condition,code)=>{if(!condition)throw new VerificationError(code);};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function localOrigin(raw){
  let url;
  try{url=new URL(raw??'http://127.0.0.1:8790');}catch{throw new VerificationError('invalid_local_origin');}
  requireCheck(url.protocol==='http:'&&LOCAL_HOSTS.has(url.hostname)&&!url.username&&!url.password&&!url.search&&!url.hash
    &&(url.pathname==='/'||url.pathname===''),'origin_must_be_loopback_http');
  return url.origin;
}

function publicStateSummary(state){
  return {
    emergencyStop:state?.emergencyStop,
    provider:state?.agent?.provider??null,
    model:state?.agent?.model??null,
    dailyCallLimit:state?.agent?.dailyCallLimit??null,
    callsUsed:state?.agent?.usage?.attempts??null,
    activeJobs:Array.isArray(state?.jobs)?state.jobs.filter(job=>['queued','running'].includes(job.status)).length:null,
  };
}

function missionReport(mission){
  return {
    missionId:mission.missionId,
    plannerQuestId:mission.plannerQuestId,
    projectId:mission.projectId,
    phase:mission.phase,
    shadows:(mission.shadows??[]).map(job=>({jobId:job.jobId,role:job.role,status:job.status,provider:job.provider,model:job.model,artifactCount:job.artifacts?.length??0})),
    deterministicVerifier:mission.verify?{jobId:mission.verify.jobId,status:mission.verify.status,passed:mission.verify.result?.verified===true}:null,
    semanticVerifier:mission.semantic?{jobId:mission.semantic.jobId,status:mission.semantic.status,verdict:mission.semantic.verdict?.verdict??null}:null,
  };
}

export async function verifyLivingLoop({env=process.env,fetchImpl=fetch,run=false,write=console.log,delayImpl=sleep,timeoutMs=600_000}={}){
  const report={schemaVersion:1,at:new Date().toISOString(),status:'BLOCKED',mode:run?'owner_triggered_live':'read_only_preflight',checks:[],limitations:[
    '모델 worker가 전부 local provider로 기록됐는지는 확인하지만, OS 전체 네트워크 패킷을 감시하지 않으므로 전체 외부 트래픽 0건을 주장하지 않는다.',
    '이 검사는 실제 서버 재시작을 수행하지 않는다. 재시작 지속성은 별도의 합성 회귀로 검증한다.',
    'JEV blocked-recovery 대안 검토는 별도의 합성 통합 시험 대상이며, 이 정상 완료 시험이 실사용 복구까지 증명하지 않는다.',
  ]};
  let voiceSubmitted=false,voiceAccepted=false;

  try{
    requireCheck(typeof env.YENO_TOKEN==='string'&&env.YENO_TOKEN.length>=16&&env.YENO_TOKEN.length<=4096
      &&env.YENO_TOKEN.trim()===env.YENO_TOKEN&&/^[\x20-\x7e]+$/.test(env.YENO_TOKEN),'existing_owner_token_required');
    const origin=localOrigin(env.YENO_ORIGIN);
    const expectedModel=env.YENO_LIVING_LOOP_EXPECTED_MODEL??'qwen2.5:3b';
    requireCheck(typeof expectedModel==='string'&&/^[A-Za-z0-9._:-]{1,120}$/.test(expectedModel),'invalid_expected_model');
    const expectedSha=env.YENO_LIVING_LOOP_EXPECTED_SHA;
    requireCheck(typeof expectedSha==='string'&&/^[a-f0-9]{40}$/i.test(expectedSha),'expected_source_sha_required');
    let requestId=null;
    if(run){
      requireCheck(typeof env.YENO_LIVING_LOOP_CHECK_ID==='string'&&CHECK_ID.test(env.YENO_LIVING_LOOP_CHECK_ID),'unique_check_id_required');
      requestId=`${LIVE_REQUEST}:${env.YENO_LIVING_LOOP_CHECK_ID}`;
      requireCheck(requestId.length<=160,'check_id_too_long');
      requireCheck(typeof env.YENO_LIVING_LOOP_QUEST_ID==='string'&&UUID.test(env.YENO_LIVING_LOOP_QUEST_ID),'existing_project_quest_id_required');
    }

    const headers={Authorization:`Bearer ${env.YENO_TOKEN}`};
    async function http(route,{method='GET',body}={}){
      let response,bytes;
      try{
        response=await fetchImpl(new URL(route,origin),{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},
          ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15_000)});
        bytes=Buffer.from(await response.arrayBuffer());
      }catch(error){throw new VerificationError(method==='POST'?'voice_outcome_unknown':'read_transport_failed');}
      requireCheck(bytes.length<=MAX_RESPONSE_BYTES,'response_too_large');
      if(!response.ok){
        if(method==='POST'&&response.status>=500)throw new VerificationError('voice_outcome_unknown',response.status);
        throw new VerificationError(`http_${response.status}`,response.status);
      }
      try{return JSON.parse(bytes.toString('utf8'));}catch{throw new VerificationError('invalid_json_response',response.status);}
    }

    report.origin=origin;
    const [state,questState,readiness]=await Promise.all([http('/api/state'),http('/api/quests'),http('/api/readiness')]);
    const summary=publicStateSummary(state);
    report.runtime=summary;
    report.sourceCommit=readiness.sourceCommit??null;
    requireCheck(readiness.persistentStore?.durable===true,'persistent_store_not_durable');
    requireCheck(typeof readiness.sourceCommit?.sha==='string'&&readiness.sourceCommit.sha.toLowerCase()===expectedSha.toLowerCase(),'runtime_source_sha_mismatch');
    requireCheck(state.emergencyStop===false,'emergency_stop_active');
    requireCheck(state.agent?.provider==='local','primary_provider_not_local');
    requireCheck(state.agent?.model===expectedModel,'local_model_mismatch');
    requireCheck(Number.isSafeInteger(state.agent?.dailyCallLimit)&&Number.isSafeInteger(state.agent?.usage?.attempts)
      &&state.agent.dailyCallLimit-state.agent.usage.attempts>=MODEL_CALL_HEADROOM,'local_call_headroom_below_12');
    requireCheck(summary.activeJobs===0,'runtime_has_active_jobs');
    const selected=questState?.decision?.top;
    const questId=run?env.YENO_LIVING_LOOP_QUEST_ID:selected?.questId;
    const quest=(questState?.quests??[]).find(item=>item.id===questId);
    requireCheck(!!quest,'eligible_existing_quest_not_found');
    requireCheck(questId===selected?.questId,'requested_quest_is_not_homunculus_top_choice');
    requireCheck(quest.status==='proposed'&&!quest.synthesis,'quest_must_be_owner_proposed_and_unstarted');
    requireCheck(UUID.test(quest.projectId??''),'quest_must_belong_to_a_project');
    const project=(state.projects??[]).find(item=>item.id===quest.projectId);
    requireCheck(project?.status==='active','quest_project_not_active');
    report.target={questId:quest.id,projectId:quest.projectId};
    report.checks.push('expected source SHA, durable store, local Ollama provider/model, emergency stop, call headroom and idle runtime verified',
      'Homunculus current top choice is the specified existing owner goal in an active project');

    if(!run){
      report.status='PREFLIGHT_READY';
      report.checks.push('read-only preflight; no job, mission or model call created');
      write(`LIVING_LOOP_PREFLIGHT ${JSON.stringify(report)}`);
      return report;
    }

    // Reusing a durable request ID would only replay an earlier acceptance,
    // so refuse it before creating any work. A POST is sent once; uncertainty
    // is recorded and never retried under a fresh ID.
    try{await http(`/api/requests/${encodeURIComponent(requestId)}`);throw new VerificationError('check_id_already_used');}
    catch(error){if(!(error instanceof VerificationError)||error.status!==404)throw error;}
    report.requestId=requestId;
    voiceSubmitted=true;
    const accepted=await http('/api/voice',{method:'POST',body:{requestId,text:'지금 가장 먼저 할 일을 정해줘',history:[],expectedQuestId:quest.id}});
    voiceAccepted=true;
    requireCheck(accepted.kind==='shadowMission'&&UUID.test(accepted.missionId??''),'voice_did_not_create_shadow_mission');
    requireCheck(accepted.plannerQuestId===quest.id&&accepted.mission?.missionId===accepted.missionId,'mission_identity_mismatch');
    const missionId=accepted.missionId;
    report.missionId=missionId;
    report.checks.push('real /api/voice request selected the expected goal and created one linked Jarvis/Shadow mission');

    const deadline=Date.now()+Math.max(1_000,Math.min(900_000,timeoutMs));
    let mission=null;
    while(Date.now()<deadline){
      const result=await http(`/api/quests/${encodeURIComponent(quest.id)}/shadow-missions`);
      mission=(result.missions??[]).find(item=>item.missionId===missionId)??null;
      requireCheck(!!mission,'mission_not_visible_after_acceptance');
      if(['completed','blocked','failed'].includes(mission.phase))break;
      await delayImpl(1_000);
    }
    requireCheck(mission&&['completed','blocked','failed'].includes(mission.phase),'mission_status_timeout');
    requireCheck(mission.phase==='completed','shadow_mission_blocked_or_failed');
    requireCheck((mission.shadows??[]).some(job=>job.role==='scout')&&(mission.shadows??[]).some(job=>job.role==='researcher')
      &&(mission.shadows??[]).some(job=>job.role==='builder'),'required_shadow_roles_missing');
    requireCheck((mission.shadows??[]).filter(job=>['scout','researcher','builder'].includes(job.role)).every(job=>job.status==='completed'),'shadow_worker_not_completed');
    requireCheck(mission.verify?.status==='completed'&&mission.verify.result?.verified===true,'deterministic_verifier_failed');
    requireCheck(mission.semantic?.status==='completed'&&mission.semantic.verdict?.verdict==='pass','semantic_verifier_failed');

    const after=await http('/api/state');
    const missionJobs=(after.jobs??[]).filter(job=>job.shadowAssignment?.missionId===missionId);
    requireCheck(missionJobs.length>=5,'mission_job_trace_incomplete');
    const modelJobs=missionJobs.filter(job=>job.agent);
    requireCheck(modelJobs.length>=4&&modelJobs.every(job=>job.agent.provider==='local'&&job.agent.model===expectedModel
      &&job.agent.calls>0&&job.agent.unknownCalls===0),'mission_provider_receipts_not_all_local_and_settled');
    const dispatchEvidence=(after.jev?.recentShadowDecisions??[]).filter(entry=>entry.missionId===missionId);
    requireCheck(dispatchEvidence.length>=3,'jev_dispatch_evidence_missing');
    requireCheck(after.jev?.authorizesDispatch===false&&after.jev?.recoveryAuthorizesDispatch===false,'jev_dispatch_authority_must_remain_disabled');
    report.mission=missionReport(mission);
    report.modelReceipts=modelJobs.map(job=>({jobId:job.id,role:job.shadowAssignment.role,provider:job.agent.provider,model:job.agent.model,calls:job.agent.calls,unknownCalls:job.agent.unknownCalls}));
    report.jev={missionDispatchRecords:dispatchEvidence.length,authorizesDispatch:false,recoveryLiveStatus:'NOT_TESTED'};
    report.restartPersistence='NOT_TESTED_BY_THIS_SCRIPT';
    report.networkEgress='OS_WIDE_NOT_MEASURED';
    report.status='VERIFIED';
    report.checks.push('Scout/Researcher/Builder, deterministic verifier, semantic verifier and JEV observations share the same mission ID',
      'all mission model receipts identify the configured local provider/model and settled calls',
      'verified mission did not grant JEV dispatch authority');
  }catch(error){
    const uncertain=['voice_outcome_unknown','read_transport_failed','invalid_json_response','mission_status_timeout','mission_not_visible_after_acceptance'].includes(error.code);
    report.status=!voiceSubmitted?'BLOCKED':uncertain?'UNKNOWN':!voiceAccepted&&error.status>=400&&error.status<500?'REJECTED':'FAILED_AFTER_ACCEPTANCE';
    report.code=error instanceof VerificationError?error.code:'verification_internal_error';
    if(error instanceof VerificationError&&Number.isInteger(error.status))report.httpStatus=error.status;
  }

  const label=report.status==='VERIFIED'?'LIVING_LOOP_VERIFIED':report.status==='PREFLIGHT_READY'?'LIVING_LOOP_PREFLIGHT':'LIVING_LOOP_BLOCKED';
  write(`${label} ${JSON.stringify(report)}`);
  return report;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const run=process.argv.includes('--run');
  verifyLivingLoop({run}).then(report=>{if(!['VERIFIED','PREFLIGHT_READY'].includes(report.status))process.exitCode=1;});
}
