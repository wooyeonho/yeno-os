import fs from 'node:fs';
import path from 'node:path';
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {start} from '../runtime/server.mjs';
import {openStore} from '../runtime/lib/store.mjs';
import {recallMemories, recallPromptBlock} from '../runtime/lib/memory-recall.mjs';

export async function verifySourceIntake({input, output, localModel}) {
  const fixture = JSON.parse(fs.readFileSync(input, 'utf8'));
  assert.equal(fixture.items?.length, 4, 'Four explicitly scoped intake records required');
  fs.mkdirSync(output, {recursive:false});
  const dataDir=path.join(output,'runtime');
  const env=localModel ? {YENO_AGENT_PROVIDER:'local',YENO_LOCAL_MODEL:localModel,YENO_LOCAL_BASE_URL:'http://127.0.0.1:11434/v1/chat/completions',YENO_AGENT_DAILY_CALL_LIMIT:'2'} : {};
  if(localModel){const store=openStore(dataDir);store.state.modules.ai=true;store.save();}
  const token=randomBytes(32).toString('base64url');
  let runtime;
  const report={version:1,at:new Date().toISOString(),packageSha256:fixture.packageSha256,evidenceSha256:fixture.evidenceSha256,scope:'isolated local core; not production or phone acceptance',localModel:localModel??null,items:[],checks:[],ok:false};
  async function boot(){runtime=await start({host:'127.0.0.1',port:0,dataDir,token,env});}
  async function stop(){if(!runtime)return;const closed=once(runtime.server,'close');runtime.shutdown();await closed;runtime=null;}
  async function request(route,body){
    const response=await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',connection:'close'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
    return {status:response.status,value:await response.json()};
  }
  async function post(route,body){const r=await request(route,{requestId:randomUUID(),...body});assert.ok(r.status>=200&&r.status<300,`HTTP ${r.status} on ${route}`);return r.value;}
  async function completed(id){
    const deadline=Date.now()+180000;
    while(Date.now()<deadline){const {value}=await request('/api/state');const job=value.jobs.find(j=>j.id===id);if(job?.status==='completed')return job;assert.ok(!['failed','cancelled','paused'].includes(job?.status),`Job ended as ${job?.status}`);await new Promise(resolve=>setTimeout(resolve,150));}
    throw new Error('Job deadline exceeded');
  }
  async function artifact(job,filename){
    const id=job.artifacts[0]?.id;assert.ok(id,'Artifact ID required');
    const response=await fetch(`http://127.0.0.1:${runtime.server.address().port}/api/artifacts/${id}`,{headers:{authorization:`Bearer ${token}`,connection:'close'},signal:AbortSignal.timeout(15000)});
    assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());const sha256=createHash('sha256').update(bytes).digest('hex');assert.equal(sha256,response.headers.get('x-content-sha256'));fs.writeFileSync(path.join(output,filename),bytes);return {id,sha256,bytes:bytes.length,file:filename};
  }
  try{
    await boot();
    const sources=fixture.items.map(item=>item.source);
    const imported=await post('/api/sources/import',{sources});assert.equal(imported.createdCount,4);
    const replay=await post('/api/sources/import',{sources});assert.equal(replay.createdCount,0);assert.equal(replay.reusedCount,4);
    for(let i=0;i<4;i++){
      const item=fixture.items[i],source=imported.sources[i];
      assert.equal(source.url,item.source.url);assert.equal(source.readingStatus,'partial');assert.equal(source.decision,'pending');
      const memory=await post('/api/memory-events',{type:'source',text:`${item.ledgerId} 인계 접수. ${source.title}. ${source.application}`,confidence:0.5,projectId:null,questId:null,sourceRefs:[{type:'source',id:source.id}]});
      const receipt=await post('/api/commands',{text:`자료 브리핑: ${source.id}`});
      const job=await completed(receipt.job.id);const result=await artifact(job,`${item.ledgerId}-next-action.md`);
      assert.ok(fs.readFileSync(path.join(output,result.file),'utf8').includes(item.ledgerId));
      report.items.push({ledgerId:item.ledgerId,intakeId:item.intakeId,sourceId:source.id,memoryEventId:memory.memoryEvent.id,jobId:job.id,artifact:result,readingStatus:source.readingStatus,decision:source.decision});
    }
    await stop();await boot();
    for(let i=0;i<4;i++){
      const found=await request(`/api/sources?q=${encodeURIComponent(fixture.items[i].query)}`);
      assert.ok(found.value.sources.some(s=>s.id===report.items[i].sourceId));
    }
    const views={};for(const view of ['all','now','queued','blocked']){const r=await request(`/api/sources?view=${view}`);assert.equal(r.status,200);views[view]=r.value.sources.length;}
    const old=imported.sources[2];
    const correction='다음 행동: 공간 연출의 깊이 가림 조건을 먼저 확인한다. '+old.application;
    const updated=await post(`/api/sources/${old.id}/update`,{revision:old.version,application:correction});assert.equal(updated.source.version,2);
    const conflict=await request(`/api/sources/${old.id}/update`,{requestId:randomUUID(),revision:old.version,application:'stale correction'});assert.equal(conflict.status,409);
    const unsafe=await request(`/api/sources/${old.id}/update`,{requestId:randomUUID(),revision:2,decision:'candidate'});assert.equal(unsafe.status,400);
    await stop();await boot();
    const stored=openStore(dataDir).state;const recall=recallMemories(stored,'공간 연출 다음 행동');const prompt=recallPromptBlock(recall);
    assert.ok(recall.recalled.some(r=>r.id===old.id&&r.kind==='source'&&r.version===2));assert.match(prompt,/깊이 가림 조건/);assert.match(prompt,/partial\/pending\/scoped/);
    fs.writeFileSync(path.join(output,'current-recall.txt'),prompt);
    if(localModel){
      const receipt=await post('/api/voice',{text:'지난번 공간 연출 자료의 다음 행동과 미확인 사항을 알려줘. 기록에 없는 사실을 만들지 마.',history:[]});
      const job=await completed(receipt.jobId);const actual=openStore(dataDir).state.jobs.find(j=>j.id===job.id);assert.ok(actual.memoryRecall.ids.includes(old.id));report.voice={jobId:job.id,sourceRecalled:true,artifact:await artifact(job,'local-model-recall.md'),claim:'real local generation; not independent semantic verification'};
    }
    report.views=views;report.checks=['original URL and ledger IDs preserved','four source/memory/job/artifact links','repeated intake reuses records','restart and alternate query recover all four','review correction persists and feeds current recall','stale revision returns 409','partial source cannot promote to candidate','artifact bytes match server SHA256'];report.ok=true;
  }finally{await stop();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));}
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [input,output,localModel]=process.argv.slice(2);
  if(!input||!output)throw new Error('Usage: node scripts/verify-source-intake-live.mjs <four-inputs.json> <new-output-directory> [installed-local-model]');
  const result=await verifySourceIntake({input,output,localModel});console.log(JSON.stringify({ok:result.ok,items:result.items.length,output,localModel:result.localModel}));
}