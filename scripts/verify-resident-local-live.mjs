// A bounded live check: isolated resident store, real loopback Ollama, no cloud.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {startResident} from '../runtime/resident.mjs';

const home=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-local-live-'));
const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
const token=crypto.randomBytes(32).toString('base64url');
const config={version:1,dataDir:path.join(home,'data'),controlDir:path.join(home,'control'),tokenFile:path.join(home,'pairing.token'),port,phone:null,localModel:'qwen2.5:3b'};
fs.mkdirSync(config.dataDir);fs.mkdirSync(config.controlDir);fs.writeFileSync(config.tokenFile,token,{mode:0o600});
let resident;
const report={startedAt:new Date().toISOString(),source:process.env.BLACKHOLE_SOURCE_SHA??null,model:config.localModel,endpoint:'http://127.0.0.1:11434/v1/chat/completions',physicalAndroid:false,status:'running'};
async function call(route,body){
 const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{authorization:`Bearer ${token}`,'content-type':'application/json',connection:'close'},...(body?{body:JSON.stringify(body)}:{})});
 if(!response.ok)throw new Error(`HTTP_${response.status}`);return response.json();
}
try{
 resident=await startResident(config);
 await call('/api/settings',{requestId:crypto.randomUUID(),modules:{ai:true}});
 const receipt=await call('/api/commands',{requestId:crypto.randomUUID(),text:'자율 임무: 도구를 호출하지 말고, 오늘 할 일 한 가지를 한국어 한 문장으로 제안해줘.'});
 if(!receipt.job?.id)throw new Error('JOB_NOT_ACCEPTED');
 const deadline=Date.now()+240000;let job;
 do{
  const state=await call('/api/state');job=state.jobs.find(value=>value.id===receipt.job.id);
  if(['completed','failed','paused','cancelled'].includes(job?.status))break;
  await new Promise(resolve=>setTimeout(resolve,1000));
 }while(Date.now()<deadline);
 report.jobStatus=job?.status??'missing';report.jobId=receipt.job.id;
 if(job?.status!=='completed')throw new Error('LOCAL_JOB_NOT_COMPLETED');
 const artifactId=job.artifacts[0]?.id;if(!artifactId)throw new Error('NO_ARTIFACT');
 const artifact=await fetch(`http://127.0.0.1:${port}/api/artifacts/${artifactId}`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
 const bytes=Buffer.from(await artifact.arrayBuffer());
 report.artifactSha256=crypto.createHash('sha256').update(bytes).digest('hex');report.artifactBytes=bytes.length;
 if(!artifact.ok||report.artifactSha256!==artifact.headers.get('x-content-sha256'))throw new Error('ARTIFACT_HASH_MISMATCH');
 await resident.stop();resident=await startResident(config);
 const restored=await call('/api/state');
 if(restored.agent.provider!=='local'||restored.agent.model!==config.localModel||!restored.jobs.some(value=>value.id===job.id&&value.status==='completed'))throw new Error('RESTART_MISMATCH');
 report.restartPreserved=true;report.status='passed';
}catch(error){report.status='failed';report.reason=error.message;process.exitCode=1;}
finally{
 await resident?.stop();
 // Preserve isolated evidence; never expose the generated owner credential.
 report.finishedAt=new Date().toISOString();
 fs.writeFileSync('build-artifacts/acceptance-20260925/resident-local-live.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}
