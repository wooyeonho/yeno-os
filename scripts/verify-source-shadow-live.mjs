// Isolated, owner-triggered acceptance: one partially read source -> one real
// project mission -> real local-model workers and verifier -> durable result.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {start} from '../runtime/server.mjs';
import {openStore} from '../runtime/lib/store.mjs';
import {missionStatus} from '../runtime/lib/shadow-army.mjs';

export async function verifySourceShadow({input, output, model='qwen2.5:3b'}) {
  const fixture=JSON.parse(fs.readFileSync(input,'utf8'));
  const item=fixture.items?.find(value=>value.ledgerId==='EXTRA-136');
  assert.ok(item?.source?.readingStatus==='partial','EXTRA-136 partial source required');
  fs.mkdirSync(output,{recursive:false});
  const dataDir=path.join(output,'runtime');
  const seed=openStore(dataDir);seed.state.modules.ai=true;seed.save();
  const token=randomBytes(32).toString('base64url');
  const env={YENO_AGENT_PROVIDER:'local',YENO_LOCAL_MODEL:model,YENO_LOCAL_BASE_URL:'http://127.0.0.1:11434/v1/chat/completions',YENO_AGENT_DAILY_CALL_LIMIT:'12'};
  const report={version:1,at:new Date().toISOString(),sourceLedgerId:item.ledgerId,packageSha256:fixture.packageSha256,model,scope:'isolated loopback core and local Ollama; no phone or operational deployment',ok:false,checks:[]};
  let runtime;
  async function boot(){runtime=await start({host:'127.0.0.1',port:0,dataDir,token,env});}
  async function stop(){if(!runtime)return;const closed=once(runtime.server,'close');runtime.shutdown();await closed;runtime=null;}
  async function request(route,body){
    const response=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{method:body?'POST':'GET',redirect:'error',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',connection:'close'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
    const value=await response.json();return {status:response.status,value};
  }
  async function post(route,body){const result=await request(route,{requestId:randomUUID(),...body});assert.ok(result.status>=200&&result.status<300,`${route}: HTTP ${result.status} ${JSON.stringify(result.value)}`);return result.value;}
  try{
    await boot();
    const project=(await post('/api/projects',{name:'EXTRA-136 공간 연출 검토',summary:`원장 ${item.ledgerId}. 영상 원문은 이번 실행에서 열람하지 못함. ${item.source.summary}`,nextAction:'독자 에셋으로 깊이 가림 조건의 최소 장면을 검토하고 미확인 기기·엔진·권리를 남긴다.',status:'active'})).project;
    const source=(await post('/api/sources/import',{sources:[{...item.source,projectId:project.id}]})).sources[0];
    assert.equal(source.readingStatus,'partial');assert.equal(source.decision,'pending');
    const goal=`${item.ledgerId} 원장과 부분 관찰을 바탕으로 독자 에셋 공간 연출의 깊이 가림 조건을 검토한다. 영상 원문과 구현 기기/엔진은 확인하지 못했음을 밝히고, 입력·상태·출력·검증 조건 및 바로 사용할 수 있는 작업 카드를 한국어로 작성한다. 소스 ID ${source.id}.`;
    const receipt=await post('/api/shadow-army/missions',{projectId:project.id,goal,successCriterion:'독자 에셋 최소 장면의 깊이 가림 시험 조건과 미확인 항목을 구분한 한국어 작업 카드 1개'});
    const missionId=receipt.missionId;
    report.projectId=project.id;report.sourceId=source.id;report.missionId=missionId;
    const deadline=Date.now()+600000;let mission;
    while(Date.now()<deadline){
      const snapshot=openStore(dataDir).state;
      mission=missionStatus(missionId,snapshot);
      const active=snapshot.jobs.some(job=>job.shadowAssignment?.missionId===missionId&&['queued','running'].includes(job.status));
      if(mission&&['completed','failed','blocked'].includes(mission.phase)&&!active)break;
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    assert.ok(mission&&['completed','failed','blocked'].includes(mission.phase),'mission did not settle before deadline');
    assert.equal(openStore(dataDir).state.jobs.some(job=>job.shadowAssignment?.missionId===missionId&&['queued','running'].includes(job.status)),false,'mission worker still active');
    const before=openStore(dataDir).state;
    report.phase=mission.phase;
    report.roles=[...mission.shadows,mission.verify,mission.semantic].map(value=>({role:value.role??(value===mission.verify?'verifier':'semanticVerifier'),jobId:value.jobId,status:value.status,pauseReason:value.pauseReason??null,failureReason:value.failureReason??null}));
    report.verifier={deterministic:mission.verify?.result?.verified??false,semantic:mission.semantic?.verdict?.verdict??null,independence:mission.semantic?.independence??null};
    report.memoryEventIds=before.memoryEvents.filter(event=>event.sourceRefs?.some(ref=>ref.type==='job'&&ref.id===mission.semantic?.jobId)).map(event=>event.id);
    const builder=mission.shadows.find(value=>value.role==='builder');
    const artifactId=builder?.artifacts?.[0]?.id;
    if(artifactId){
      const response=await fetch(`http://127.0.0.1:${runtime.server.address().port}/api/artifacts/${artifactId}`,{headers:{authorization:`Bearer ${token}`,connection:'close'},signal:AbortSignal.timeout(20000)});
      assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());const sha256=createHash('sha256').update(bytes).digest('hex');assert.equal(sha256,response.headers.get('x-content-sha256'));
      fs.writeFileSync(path.join(output,'EXTRA-136-shadow-result.md'),bytes);report.artifact={id:artifactId,sha256,bytes:bytes.length};
    }
    await stop();await boot();
    const restored=openStore(dataDir).state;
    const again=missionStatus(missionId,restored);
    assert.equal(again.phase,mission.phase);assert.ok(restored.sources.some(value=>value.id===source.id&&value.readingStatus==='partial'&&value.decision==='pending'));
    report.restartPreserved=true;
    report.checks=['source kept partial/pending','real local-model shadow workers settled before shutdown','stored mission and source survived restart',...(report.artifact?['builder artifact bytes matched HTTP SHA256']:[])];
    report.ok=mission.phase==='completed'&&report.verifier.deterministic&&report.verifier.semantic==='pass'&&report.memoryEventIds.length>0&&!!report.artifact;
  }catch(error){report.error=error.message;}
  finally{await stop();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));}
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [input,output,model]=process.argv.slice(2);
  if(!input||!output)throw new Error('Usage: node scripts/verify-source-shadow-live.mjs <four-inputs.json> <new-output-directory> [installed-local-model]');
  const report=await verifySourceShadow({input,output,model});
  console.log(JSON.stringify({ok:report.ok,phase:report.phase??null,output,error:report.error??null}));
  if(!report.ok)process.exitCode=1;
}
