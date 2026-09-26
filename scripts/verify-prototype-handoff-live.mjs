// Owner-triggered local acceptance: attach a tested prototype's hash and
// limits to a durable source -> document job -> artifact -> result memory chain.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {start} from '../runtime/server.mjs';
import {openStore} from '../runtime/lib/store.mjs';
import {recallMemories,recallPromptBlock} from '../runtime/lib/memory-recall.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function verifyPrototypeHandoff({fixturePath,htmlPath,browserReportPath,output}){
  const fixture=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
  const item=fixture.items.find(entry=>entry.ledgerId==='EXTRA-136');
  assert.ok(item?.source?.readingStatus==='partial'&&item.source.decision==='pending');
  const html=fs.readFileSync(htmlPath);
  const browser=JSON.parse(fs.readFileSync(browserReportPath,'utf8'));
  assert.ok(browser.ok&&browser.origin==='offline file'&&browser.screenshots.length===17,'offline Chrome checks required');
  for(const shot of browser.screenshots){
    const bytes=fs.readFileSync(path.join(path.dirname(browserReportPath),shot.file));
    assert.equal(digest(bytes),shot.sha256,`Screenshot hash: ${shot.file}`);
  }
  fs.mkdirSync(output,{recursive:false});
  const dataDir=path.join(output,'runtime');
  const token=randomBytes(32).toString('base64url');
  const report={version:1,at:new Date().toISOString(),scope:'isolated local core; not production, source adoption, phone or AR acceptance',ledgerId:item.ledgerId,html:{file:path.basename(htmlPath),bytes:html.length,sha256:digest(html)},browser:{screenshots:browser.screenshots.length,reportSha256:digest(fs.readFileSync(browserReportPath))},checks:[],ok:false};
  let runtime;
  const boot=async()=>{runtime=await start({host:'127.0.0.1',port:0,dataDir,token});};
  const stop=async()=>{if(!runtime)return;const closed=once(runtime.server,'close');runtime.shutdown();await closed;runtime=null;};
  async function request(route,body){
    const response=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{method:body?'POST':'GET',redirect:'error',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',connection:'close'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
    return {status:response.status,value:await response.json()};
  }
  async function post(route,body){const result=await request(route,{requestId:randomUUID(),...body});assert.ok(result.status>=200&&result.status<300,`${route}: HTTP ${result.status}`);return result.value;}
  try{
    await boot();
    const project=(await post('/api/projects',{name:'EXTRA-136 독자 2D 공간 가림 시험',summary:'원장 EXTRA-136 부분 관찰을 기반으로 독자 에셋의 깊이/가림 조건만 로컬에서 시험',nextAction:'브라우저 시연 결과를 확인하고 원본 영상/실제 AR/기기 구현과 구분한다.',status:'active'})).project;
    const source=(await post('/api/sources/import',{sources:[{...item.source,projectId:project.id}]})).sources[0];
    assert.equal(source.readingStatus,'partial');assert.equal(source.decision,'pending');
    const application=`독자 SVG 2D 깊이 가림 시험 완료: HTML SHA256 ${report.html.sha256}, Chromium file:// 17화면 통과. AR 공간 추적/실기기/원본 영상 전체 확인은 미실시.`;
    const updated=(await post(`/api/sources/${source.id}/update`,{revision:source.version,application})).source;
    assert.equal(updated.readingStatus,'partial');assert.equal(updated.decision,'pending');
    const receipt=await post('/api/commands',{text:`자료 브리핑: ${source.id}`});
    const jobId=receipt.job.id;
    let job;
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){job=openStore(dataDir).state.jobs.find(value=>value.id===jobId);if(job?.status==='completed')break;assert.ok(!['failed','cancelled','paused'].includes(job?.status),`job ${job?.status}`);await new Promise(resolve=>setTimeout(resolve,100));}
    assert.equal(job?.status,'completed');
    const artifactId=job.artifacts[0]?.id;assert.ok(artifactId);
    const response=await fetch(`http://127.0.0.1:${runtime.server.address().port}/api/artifacts/${artifactId}`,{headers:{authorization:`Bearer ${token}`,connection:'close'},signal:AbortSignal.timeout(15000)});
    assert.equal(response.status,200);
    const artifact=Buffer.from(await response.arrayBuffer());
    const artifactSha=digest(artifact);assert.equal(artifactSha,response.headers.get('x-content-sha256'));
    assert.ok(artifact.toString('utf8').includes(report.html.sha256),'source brief must carry tested HTML hash');
    fs.writeFileSync(path.join(output,'EXTRA-136-prototype-brief.md'),artifact);
    const claim=`EXTRA-136 독자 SVG 2D 깊이 가림 시험: file:// Chrome 375/768/1280px 17화면 통과, 장면/깊이 슬라이더 동시 관찰, 부분 가림 확인. HTML SHA256 ${report.html.sha256}. 원본 영상은 부분 관찰이고 실제 AR/Android 기기 검증은 하지 않았다.`;
    const memory=(await post('/api/memory-events',{type:'result',text:claim,confidence:0.9,projectId:project.id,questId:null,sourceRefs:[{type:'source',id:source.id},{type:'job',id:jobId}]})).memoryEvent;
    report.projectId=project.id;report.sourceId=source.id;report.sourceVersion=updated.version;report.jobId=jobId;report.artifact={id:artifactId,sha256:artifactSha,bytes:artifact.length};report.memoryEventId=memory.id;
    await stop();await boot();
    const restored=openStore(dataDir).state;
    assert.ok(restored.sources.some(value=>value.id===source.id&&value.readingStatus==='partial'&&value.decision==='pending'));
    assert.ok(restored.jobs.some(value=>value.id===jobId&&value.status==='completed'&&value.artifacts.some(ref=>ref.id===artifactId)));
    assert.ok(restored.memoryEvents.some(value=>value.id===memory.id&&value.sourceRefs.some(ref=>ref.type==='source'&&ref.id===source.id)&&value.sourceRefs.some(ref=>ref.type==='job'&&ref.id===jobId)));
    const prompt=recallPromptBlock(recallMemories(restored,'EXTRA-136 깊이 가림 HTML 시험'));
    assert.ok(prompt.includes(report.html.sha256));
    fs.writeFileSync(path.join(output,'prototype-recall.txt'),prompt);
    report.checks=['offline HTML and all 17 screenshot hashes verified','partial/pending source kept after local application update','source document job artifact HTTP SHA matches stored bytes','result memory links existing source and job','restart preserved source/job/artifact/memory and recall includes HTML hash'];
    report.ok=true;
  }finally{await stop();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));}
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [fixturePath,htmlPath,browserReportPath,output]=process.argv.slice(2);
  if(!fixturePath||!htmlPath||!browserReportPath||!output)throw new Error('Usage: node verify-prototype-handoff-live.mjs <four-inputs.json> <offline.html> <browser-report.json> <new-output-dir>');
  const report=await verifyPrototypeHandoff({fixturePath,htmlPath,browserReportPath,output});
  console.log(JSON.stringify({ok:report.ok,sourceId:report.sourceId??null,jobId:report.jobId??null,output}));
}
