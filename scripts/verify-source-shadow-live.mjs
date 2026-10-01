// Isolated, owner-triggered acceptance: one partially read source -> one real
// project mission -> real local-model workers and verifier -> durable result.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {start} from '../runtime/server.mjs';
import {openStore} from '../runtime/lib/store.mjs';
import {missionStatus,shadowDependenciesMet} from '../runtime/lib/shadow-army.mjs';
import {projectObject} from '../experiments/extra-136-occlusion/scene-core.mjs';
import {evaluateExtra136Card} from '../experiments/extra-136-occlusion/card-acceptance.mjs';
import {AGENT_ENDPOINTS,agentConfigForProvider} from '../runtime/lib/provider-config.mjs';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const MIN_FREE_BYTES=3*1024**3;

export function memoryPreflight({freeBytes,ollamaPs},provider='local'){
  assert.ok(Number.isFinite(freeBytes)&&freeBytes>=0,'free memory reading required');
  assert.ok(Object.hasOwn(AGENT_ENDPOINTS,provider),'known provider required');
  const applies=provider==='local';
  return {provider,applies,freeGiB:Number((freeBytes/1024**3).toFixed(3)),minimumGiB:applies?3:null,ollamaPs:applies?ollamaPs:'not_applicable',ready:!applies||freeBytes>=MIN_FREE_BYTES};
}

function localSystemProbe(provider='local'){
  const freeBytes=os.freemem();
  if(provider!=='local')return {freeBytes,ollamaPs:'not_applicable'};
  let ollamaPs;
  try{ollamaPs=execFileSync('ollama',['ps'],{encoding:'utf8',timeout:5000,maxBuffer:4096}).trim();}
  catch{ollamaPs='unavailable';}
  return {freeBytes,ollamaPs};
}

export function missionSettled(mission,state){
  if(!mission)return false;
  const jobs=state.jobs.filter(job=>job.shadowAssignment?.missionId===mission.missionId);
  if(jobs.some(job=>['queued','running'].includes(job.status)))return false;
  if(['completed','failed'].includes(mission.phase))return true;
  if(mission.phase!=='blocked')return false;
  return !jobs.some(job=>job.status==='paused'&&job.pauseReason==='dependencyPending'&&shadowDependenciesMet(job,jobs));
}

export function acceptedShadowResult(report){
  return !!report.taskSpecSha256&&!!report.sceneInputSha256
    &&report.phase==='completed'&&report.verifier?.deterministic===true&&report.verifier?.semantic==='pass'
    &&report.memoryEventIds?.length>0&&!!report.artifact
    &&report.contentAcceptance?.passed===true;
}

export function extra136BuilderEvidence(sceneInput,sceneInputSha256,sourceId){
  const sceneBrief={canvas:sceneInput.canvas,portal:{center:sceneInput.portal.center,radius:sceneInput.portal.radius,depthPlane:sceneInput.portal.depthPlane},subject:sceneInput.subject,frames:sceneInput.frames.map(frame=>[frame.name,frame.position,frame.depth,frame.visibility,frame.layer]),screenshots:sceneInput.browserChecks.screenshots};
  return [
    `검증된 독자 2D 장면 입력 SHA-256 ${sceneInputSha256}. 프레임은 [이름,수평위치,깊이,가시성,레이어]. 원본 영상/실제 AR 증거 아님. ${JSON.stringify(sceneBrief)}`,
    `수락용 작업 카드는 다른 본문 없이 fenced extra136-card-v1 JSON 블록 1개로 낸다. 필수 키: version=1, ledgerId=EXTRA-136, sourceId=${sourceId}, sourceStatus=partial/pending, unknowns={originalVideo:false,device:false,engine:false,arTracking:false,actualTest:false}.`,
    `scene={canvas,portal,background(독자 방),occluder(불투명 문틀·벽),subject,path:[0,50,78,100]}; states는 위 프레임 6개를 {name,position,depth,visibility,layer}로 작성. tests=[{kind:fixed,frames:[front,hidden,reappear],rejectForegroundLeak:true,status:planned},{kind:boundary,frames:[reappear,partial-edge,outside],rejectForegroundLeak:true,status:planned}]. outputs={screenshots:3,videos:1,videoStatus:planned}; workSteps=[{kind:build,instruction:한국어},{kind:capture,instruction:한국어},{kind:boundary-check,instruction:한국어}]. evidence={sceneInputSha256:${sceneInputSha256},htmlSha256:${sceneInput.htmlSha256},browserReportSha256:${sceneInput.browserChecks.reportSha256}}.`,
  ].join(' ');
}

export async function verifySourceShadow({input, output, model=null, provider='local', taskSpecPath=null, sceneInputPath=null, systemProbe=localSystemProbe, providerEnvironment=process.env}) {
  assert.ok(Object.hasOwn(AGENT_ENDPOINTS,provider),'known provider required');
  const prefix=`YENO_${provider.toUpperCase()}`;
  const selectedModel=model??(provider==='local'?'qwen2.5:3b':providerEnvironment[`${prefix}_MODEL`]??'');
  const fixture=JSON.parse(fs.readFileSync(input,'utf8'));
  const item=fixture.items?.find(value=>value.ledgerId==='EXTRA-136');
  assert.ok(item?.source?.readingStatus==='partial','EXTRA-136 partial source required');
  const taskSpecBytes=taskSpecPath?fs.readFileSync(taskSpecPath):null;
  const taskSpec=taskSpecBytes?JSON.parse(taskSpecBytes.toString('utf8')):null;
  if(taskSpec){
    assert.deepEqual(Object.keys(taskSpec).sort(),['successCriterion'],'task spec must contain only a success criterion');
    assert.ok(typeof taskSpec.successCriterion==='string'&&taskSpec.successCriterion.trim().length>0&&taskSpec.successCriterion.length<=2000,'task success criterion must fit the mission contract');
  }
  const sceneInputBytes=sceneInputPath?fs.readFileSync(sceneInputPath):null;
  const sceneInput=sceneInputBytes?JSON.parse(sceneInputBytes.toString('utf8')):null;
  if(sceneInput){
    assert.equal(sceneInput.version,1);
    assert.equal(sceneInput.ledgerId,item.ledgerId);
    assert.equal(sceneInput.evidenceClass,'verified-local-2d-svg');
    assert.deepEqual(sceneInput.canvas,[960,600]);
    assert.deepEqual(sceneInput.portal?.center,[480,286]);
    assert.deepEqual(sceneInput.portal?.radius,[170,200]);
    assert.equal(sceneInput.portal?.depthPlane,50);
    assert.ok(Array.isArray(sceneInput.frames)&&sceneInput.frames.length>=3);
    for(const frame of sceneInput.frames){
      const projected=projectObject({position:frame.position,depth:frame.depth});
      assert.equal(frame.visibility,projected.visibility,`scene frame ${frame.name} visibility`);
      assert.equal(frame.layer,projected.layer,`scene frame ${frame.name} layer`);
    }
    const evidenceDir=path.dirname(input);
    assert.equal(sha256(fs.readFileSync(path.join(evidenceDir,'EXTRA-136-occlusion-offline-v3.html'))),sceneInput.htmlSha256,'existing HTML evidence hash');
    const browserDir=path.join(evidenceDir,'extra136-offline-browser-v3');
    const browserBytes=fs.readFileSync(path.join(browserDir,'report.json'));
    assert.equal(sha256(browserBytes),sceneInput.browserChecks?.reportSha256,'existing browser report hash');
    const browser=JSON.parse(browserBytes.toString('utf8'));
    assert.equal(browser.ok,true);
    assert.equal(browser.screenshots.length,sceneInput.browserChecks.screenshots);
    assert.deepEqual(browser.sizes,sceneInput.browserChecks.widths);
    for(const shot of browser.screenshots)assert.equal(sha256(fs.readFileSync(path.join(browserDir,shot.file))),shot.sha256,`existing screenshot ${shot.file} hash`);
  }
  const preflight=memoryPreflight(systemProbe(provider),provider);
  if(!preflight.ready){
    const report={version:1,at:new Date().toISOString(),status:'BLOCKED',blockReason:'insufficient_memory',ok:false,provider,model:selectedModel,preflight};
    fs.mkdirSync(output,{recursive:false});
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
    return report;
  }
  const env={YENO_AGENT_PROVIDER:provider,YENO_AGENT_DAILY_CALL_LIMIT:'12',...(provider==='local'?{YENO_LOCAL_MODEL:selectedModel,YENO_LOCAL_BASE_URL:'http://127.0.0.1:11434/v1/chat/completions'}:{[`${prefix}_MODEL`]:selectedModel,[`${prefix}_API_KEY`]:providerEnvironment[`${prefix}_API_KEY`]??''})};
  if(!agentConfigForProvider(env,provider).ready){
    const report={version:1,at:new Date().toISOString(),status:'BLOCKED',blockReason:'provider_not_configured',ok:false,provider,model:selectedModel,providerConfigured:false,preflight};
    fs.mkdirSync(output,{recursive:false});
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
    return report;
  }
  fs.mkdirSync(output,{recursive:false});
  const dataDir=path.join(output,'runtime');
  const seed=openStore(dataDir);seed.state.modules.ai=true;seed.save();
  const token=randomBytes(32).toString('base64url');
  const report={version:1,at:new Date().toISOString(),sourceLedgerId:item.ledgerId,packageSha256:fixture.packageSha256,provider,model:selectedModel,providerConfigured:true,scope:provider==='local'?'isolated loopback core and local Ollama; no phone or operational deployment':'isolated loopback core and owner-configured remote model; no phone or operational deployment',taskSpecSha256:taskSpecBytes?sha256(taskSpecBytes):null,sceneInputSha256:sceneInputBytes?sha256(sceneInputBytes):null,sceneInputScope:sceneInput?'builder-only':null,preflight,ok:false,checks:[]};
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
    const builderEvidence=sceneInput?extra136BuilderEvidence(sceneInput,report.sceneInputSha256,source.id):null;
    assert.ok(!builderEvidence||builderEvidence.length<=2000,'verified scene input must fit builder-only evidence limit');
    const receipt=await post('/api/shadow-army/missions',{projectId:project.id,goal,successCriterion:taskSpec?.successCriterion??'독자 에셋 최소 장면의 깊이 가림 시험 조건과 미확인 항목을 구분한 한국어 작업 카드 1개',...(builderEvidence?{builderEvidence}:{})});
    const missionId=receipt.missionId;
    report.projectId=project.id;report.sourceId=source.id;report.missionId=missionId;
    // Local inference is serialized on resource-limited PCs. Keep the
    // acceptance wait long enough for separate bounded role calls to finish.
    const deadline=Date.now()+900000;let mission;
    while(Date.now()<deadline){
      const snapshot=openStore(dataDir).state;
      mission=missionStatus(missionId,snapshot);
      if(missionSettled(mission,snapshot))break;
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    assert.ok(missionSettled(mission,openStore(dataDir).state),'mission did not settle before deadline');
    assert.equal(openStore(dataDir).state.jobs.some(job=>job.shadowAssignment?.missionId===missionId&&['queued','running'].includes(job.status)),false,'mission worker still active');
    const before=openStore(dataDir).state;
    report.phase=mission.phase;
    report.roles=[...mission.shadows,mission.verify,mission.semantic].map(value=>({role:value.role??(value===mission.verify?'verifier':'semanticVerifier'),jobId:value.jobId,status:value.status,pauseReason:value.pauseReason??null,failureReason:value.failureReason??null}));
    report.verifier={deterministic:mission.verify?.result?.verified??false,semantic:mission.semantic?.verdict?.verdict??null,independence:mission.semantic?.independence??null};
    report.memoryEventIds=before.memoryEvents.filter(event=>event.sourceRefs?.some(ref=>ref.type==='job'&&ref.id===mission.semantic?.jobId)).map(event=>event.id);
    const builder=mission.shadows.find(value=>value.role==='builder');
    const artifactId=builder?.artifacts?.[0]?.id;
    let artifactText='';
    if(artifactId){
      const response=await fetch(`http://127.0.0.1:${runtime.server.address().port}/api/artifacts/${artifactId}`,{headers:{authorization:`Bearer ${token}`,connection:'close'},signal:AbortSignal.timeout(20000)});
      assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());const sha256=createHash('sha256').update(bytes).digest('hex');assert.equal(sha256,response.headers.get('x-content-sha256'));
      fs.writeFileSync(path.join(output,'EXTRA-136-shadow-result.md'),bytes);report.artifact={id:artifactId,sha256,bytes:bytes.length};artifactText=bytes.toString('utf8');
    }
    if(sceneInput)report.contentAcceptance=evaluateExtra136Card(artifactText,{sceneInput,sourceId:source.id,sceneInputSha256:report.sceneInputSha256});
    await stop();await boot();
    const restored=openStore(dataDir).state;
    const again=missionStatus(missionId,restored);
    assert.equal(again.phase,mission.phase);assert.ok(restored.sources.some(value=>value.id===source.id&&value.readingStatus==='partial'&&value.decision==='pending'));
    report.restartPreserved=true;
    report.checks=['source kept partial/pending','real model shadow workers settled before shutdown','stored mission and source survived restart',...(report.artifact?['builder artifact bytes matched HTTP SHA256']:[])];
    report.ok=acceptedShadowResult(report);
  }catch(error){report.error=provider==='local'?error.message:(typeof error.code==='string'&&/^[a-z_]{1,80}$/i.test(error.code)?error.code:'remote_run_failed');}
  finally{await stop();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));}
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [input,output,model,taskSpecPath,sceneInputPath,provider='local']=process.argv.slice(2);
  if(!input||!output)throw new Error('Usage: node scripts/verify-source-shadow-live.mjs <four-inputs.json> <new-output-directory> [model] [task-spec.json] [scene-input.json] [provider]');
  const report=await verifySourceShadow({input,output,model,taskSpecPath,sceneInputPath,provider});
  console.log(JSON.stringify({ok:report.ok,status:report.status??null,reason:report.blockReason??null,phase:report.phase??null,output,error:report.error??null}));
  if(!report.ok)process.exitCode=1;
}
