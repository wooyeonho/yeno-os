import fs from 'node:fs';
import path from 'node:path';
import {atomicWrite} from './lib/store.mjs';
import {validateResidentConfig} from './resident.mjs';

export async function ownerLocalModel(home, action, model, fetchImpl=fetch) {
  const file=path.join(home,'config.json');
  const config=validateResidentConfig(JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')));
  const response=await fetchImpl('http://127.0.0.1:11434/api/tags',{redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('LOCAL_MODEL_UNAVAILABLE');
  const body=await response.json();
  const models=body.models?.map(value=>value.name).filter(value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,119}$/.test(value))??[];
  if(action==='models')return {models,selected:config.localModel??null};
  if(action!=='save-model'||!models.includes(model))throw new Error('SELECT_INSTALLED_LOCAL_MODEL');
  const token=fs.readFileSync(config.tokenFile,'utf8').replace(/^\uFEFF/,'').trim();
  const stateResponse=await fetchImpl(`http://127.0.0.1:${config.port}/api/state`,{redirect:'error',signal:AbortSignal.timeout(5000),headers:{authorization:`Bearer ${token}`}});
  if(!stateResponse.ok)throw new Error('CORE_NOT_READY');
  const state=await stateResponse.json();
  if(state.jobs.some(job=>['queued','running'].includes(job.status)))throw new Error('WAIT_FOR_ACTIVE_JOBS');
  const next=validateResidentConfig({...config,localModel:model});
  atomicWrite(file,JSON.stringify(next)+'\n');
  return {saved:true,model,requiresRestart:true,aiEnabled:false};
}
