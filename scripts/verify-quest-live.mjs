// Runs inside the existing core container. Credentials never leave its API
// authentication header and are never written to stdout or an artifact.
import {createHash} from 'node:crypto';
const run=process.argv.includes('--run');
if(process.argv.slice(2).some(arg=>!['--run','--inspect'].includes(arg)))throw new Error('Use --inspect or --run');
const base=`http://127.0.0.1:${process.env.YENO_PORT||8790}`;
const token=process.env.YENO_TOKEN;
if(!token)throw new Error('Existing core owner credential is required in the container environment');
const checkId='blackhole-a-stage-20260912-v1';
async function request(route,body){
  const r=await fetch(base+route,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const result=await r.json();if(!r.ok)throw new Error(`Core HTTP ${r.status}: ${String(result.error||'request rejected').slice(0,200)}`);return result;
}
const before=await request('/api/state');
const goals=await request('/api/quests');
const summary={checkedAt:new Date().toISOString(),mode:run?'one-provider-goal':'read-only',revision:before.revision,globalStop:before.emergencyStop,active:before.jobs.filter(j=>['running','queued'].includes(j.status)).length,
  collections:Object.fromEntries(['jobs','projects','sources','memories','snapshots'].map(k=>[k,{count:before[k].length,idsSha256:createHash('sha256').update(before[k].map(x=>x.id).sort().join(',')).digest('hex')}])),
  providers:goals.providers,usage:goals.usage,questCount:goals.total};
console.log('BLACKHOLE_INSPECT '+JSON.stringify(summary));
if(run){
  if(before.emergencyStop||summary.active)throw new Error('Live check requires an idle core with global stop already released');
  const body={requestId:`${checkId}:create`,drive:'lust',provider:'gemini',maxCalls:1,durationMinutes:5,
    goal:'추가 조사나 도구 호출 없이, 아래 제공 정보만으로 블랙홀을 소개하는 한국어 45초 쇼츠 영상의 완성 대본을 작성해줘. 각 장면의 시간·화면 연출·내레이션·자막을 표로 제시하고 마지막에 게시용 소개문 초안 2개를 붙여줘. 제공 정보: 휴대폰에서 목표를 맡기고 서버에 결과를 저장하는 개인 작업 도구. 일곱 동기를 선택해 목표를 작성하고, 실제 모델이 결과 문서를 만들며, 사용자가 중단·재개와 결과 확인을 한다. 다른 모델 검토와 부·명예·인지도 사용자 성과 기록을 지원한다. 아직 자동 코딩·PC 조작·자동 게시·수익 보장을 제공하지 않는다. 미구현 기능을 광고하지 말고 영상 제작에 바로 사용할 본문을 완성해줘.',
    baseline:'소개 영상 대본이 없음',successCriterion:'총45초의 장면별 완성 대본, 자막, 게시문2개. 실제 제공 정보에 없는 기능을 주장하지 않는다.'};
  const created=await request('/api/quests',body);
  const started=await request(`/api/quests/${created.quest.id}/run`,{requestId:checkId+':run'});
  const jobId=started.job.id;let job;
  for(let attempt=0;attempt<100;attempt++){
    job=(await request('/api/state')).jobs.find(j=>j.id===jobId);
    if(['completed','failed','paused','cancelled'].includes(job.status))break;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(job.status!=='completed')throw new Error(`Saved live goal ${created.quest.id}, job ${jobId}: ${job.status}; ${job.error||job.pauseReason||'inspect the existing job before retrying'}`);
  const artifact=job.artifacts[0];const r=await fetch(base+`/api/artifacts/${artifact.id}`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error(`Artifact HTTP ${r.status}`);
  const bytes=Buffer.from(await r.arrayBuffer());const sha256=createHash('sha256').update(bytes).digest('hex');
  if(sha256!==r.headers.get('x-content-sha256'))throw new Error('Artifact hash mismatch');
  const replay=await request(`/api/quests/${created.quest.id}/run`,{requestId:checkId+':run'});
  if(replay.job.id!==jobId)throw new Error('Request identity changed');
  const after=await request('/api/state');
  if(job.agent.provider!=='gemini'||job.agent.calls!==1||job.agent.unknownCalls!==0)throw new Error('Live provider/call receipt did not match the one-call contract');
  if(before.modules.ai!==after.modules.ai)throw new Error('Individual goal changed the global AI setting');
  const preserved=['projects','sources','memories','snapshots'].every(k=>createHash('sha256').update(after[k].map(x=>x.id).sort().join(',')).digest('hex')===summary.collections[k].idsSha256)&&before.jobs.every(j=>after.jobs.some(current=>current.id===j.id));
  if(!preserved)throw new Error('Existing collection identity was not preserved');
  console.log('BLACKHOLE_LIVE_RESULT '+JSON.stringify({questId:created.quest.id,jobId,status:job.status,provider:job.agent.provider,model:job.agent.model,modelCalls:job.agent.calls,unknownCalls:job.agent.unknownCalls,artifactId:artifact.id,artifactName:artifact.name,bytes:bytes.length,sha256,replaySameJob:true,existingDataPreserved:preserved,globalAISettingPreserved:true,usage:after.agent.usage,checkedAt:new Date().toISOString()}));
}
