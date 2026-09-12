// Existing core only; credentials stay in memory. One fixed accepted task is
// reused on subsequent checks. No automation, external messages or new keys.
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {RESEARCH_TRACKS,validateResearchBundle,researchCitationIds} from '../runtime/lib/research.mjs';
const ORIGIN='https://global-iris-gyeol-98386a17.koyeb.app';
const CHECK_ID='blackhole-research-20260912-v1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const assert=(ok,code)=>{if(!ok)throw new Error(code);};
export async function verifyResearch({env=process.env,fetchImpl=fetch,run=false,write=console.log}={}){
  assert(typeof env.YENO_TOKEN==='string'&&env.YENO_TOKEN.length>=16,'existing_owner_key_required');
  const headers={Authorization:`Bearer ${env.YENO_TOKEN}`};
  async function http(route,body){
    const response=await fetchImpl(ORIGIN+route,{method:body?'POST':'GET',headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
    const bytes=Buffer.from(await response.arrayBuffer());assert(response.ok,`http_${response.status}_${route}`);
    return {bytes,response,json:()=>JSON.parse(bytes)};
  }
  const before=(await http('/api/state')).json(),overview=(await http('/api/research')).json();
  assert(overview.tracks.length===9,'nine_canonical_tracks_missing');
  assert(overview.tracks.every(t=>RESEARCH_TRACKS.some(old=>old.code===t.code&&old.projectId===t.projectId)),'canonical_track_mismatch');
  const summary={at:new Date().toISOString(),checkId:CHECK_ID,origin:ORIGIN,tracks:overview.tracks.map(t=>({code:t.code,projectId:t.projectId})),before:{jobs:before.jobs.length,projects:before.projects.length,sources:before.sources.length,aiAttempts:before.agent.usage.attempts,dailyLimit:before.agent.dailyCallLimit,automaticReviews:before.agent.automaticReviews,emergencyStop:before.emergencyStop}};
  if(!run){write(`RESEARCH_INSPECTED ${JSON.stringify(summary)}`);return summary;}
  const body={requestId:`${CHECK_ID}:E02`,projectId:RESEARCH_TRACKS.find(t=>t.code==='E02').projectId,question:'Long COVID의 생물표지자를 단독 진단검사로 쓰기 전에 무엇을 검증해야 하는가? 공개 문헌에서 확인된 근거와 부족한 점을 비교하고, 사전 지정 다중표지자와 독립 코호트로 반증할 다음 검증 하나를 구체적으로 작성해줘.',query:'long COVID biomarkers',provider:'auto'};
  const accepted=(await http('/api/research/run',body)).json(),replayed=(await http('/api/research/run',body)).json();
  assert(accepted.job.id===replayed.job.id,'request_replay_duplicated_job');
  let job;
  for(let i=0;i<130;i++){
    job=(await http('/api/research')).json().jobs.find(job=>job.id===accepted.job.id);
    if(job&&['completed','failed','paused','cancelled'].includes(job.status))break;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  assert(job?.status==='completed',`research_${job?.status??'missing'}_${job?.error??''}`);
  assert(job.agent.calls===1&&job.agent.unknownCalls===0,'one_settled_model_call_required');
  const evidenceFile=job.artifacts.find(a=>a.id===job.researchEvidenceId),answerFile=job.artifacts.find(a=>a.name.startsWith('research-answer-'));
  assert(evidenceFile&&answerFile,'evidence_or_answer_missing');
  const evidenceResponse=await http(`/api/artifacts/${evidenceFile.id}`),bundle=evidenceResponse.json();validateResearchBundle(bundle);
  assert(bundle.sources.length>0&&bundle.projectId===body.projectId,'empty_or_wrong_evidence');
  const raw=[];
  for(const search of bundle.searches.filter(s=>s.status==='ok')){
    const ref=job.artifacts.find(a=>a.name===search.rawFileName);assert(ref,'raw_response_missing');
    const result=await http(`/api/artifacts/${ref.id}`);assert(hash(result.bytes)===search.rawSha256,'raw_response_hash_mismatch');
    raw.push({provider:search.provider,bytes:result.bytes.length,sha256:search.rawSha256});
  }
  const answer=await http(`/api/artifacts/${answerFile.id}`),text=answer.bytes.toString('utf8');
  assert(text.includes('검증 전 AI 초안')&&text.includes('[S1]'),'answer_scope_or_citations_missing');
  for(const id of researchCitationIds(text))assert(bundle.sources.some(source=>source.citationId===id),'invented_citation');
  const after=(await http('/api/state')).json();
  for(const key of ['projects','sources','memories','snapshots'])assert(before[key].every(old=>after[key].some(next=>next.id===old.id)),`lost_${key}`);
  assert(after.agent.automaticReviews===before.agent.automaticReviews&&after.agent.dailyCallLimit===before.agent.dailyCallLimit&&after.emergencyStop===before.emergencyStop,'settings_changed');
  const video=await http('/api/artifacts/0884a814-b933-49b1-bf81-3054a0811bf4');
  assert(hash(video.bytes)==='92d4f7ec9dce2612ca895e9649e1fed798283c137592132b30f66e17abd68bdc','prior_video_changed');
  Object.assign(summary,{jobId:job.id,questId:accepted.quest.id,status:job.status,provider:job.agent.provider,model:job.agent.model,modelCalls:job.agent.calls,unknownCalls:job.agent.unknownCalls,raw,evidence:{id:evidenceFile.id,sha256:hash(evidenceResponse.bytes),sources:bundle.sources.map(s=>({id:s.citationId,title:s.title,url:s.url,readLevel:s.readLevel})),searches:bundle.searches.map(s=>({provider:s.provider,status:s.status,resultCount:s.resultCount,error:s.error}))},answer:{id:answerFile.id,bytes:answer.bytes.length,sha256:hash(answer.bytes)},after:{jobs:after.jobs.length,projects:after.projects.length,sources:after.sources.length,aiAttempts:after.agent.usage.attempts},newModelCalls:before.jobs.some(j=>j.id===job.id)?0:1,checks:['one durable job for exact request replay','raw API response hashes verified','bounded literature evidence and one tool-free real model answer','canonical tracks and previous records preserved','prior Korean MP4 unchanged'],claimStatus:'research_draft_not_scientific_solution'});
  write(`RESEARCH_VERIFIED ${JSON.stringify(summary)}`);return summary;
}
if(process.argv[1]===fileURLToPath(import.meta.url))verifyResearch({run:process.argv.includes('--run')}).catch(error=>{console.log(`RESEARCH_VERIFY_FAILED ${JSON.stringify({at:new Date().toISOString(),checkId:CHECK_ID,code:error.message})}`);process.exitCode=1;});
