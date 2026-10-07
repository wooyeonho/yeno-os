import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {atomicWrite,digest} from './store.mjs';
import {parseRepositoryPatch} from './repository-patch.mjs';

export function repositoryPatchArtifactId(jobId,name){
  if(typeof jobId!=='string'||typeof name!=='string'||!name)throw new Error('Repository patch artifact identity is invalid');
  const hex=crypto.createHash('sha256').update(`repository-patch\0${jobId}\0${name}`).digest('hex').slice(0,32).split('');
  hex[12]='4';hex[16]=['8','9','a','b'][Number.parseInt(hex[16],16)%4];
  return `${hex.slice(0,8).join('')}-${hex.slice(8,12).join('')}-${hex.slice(12,16).join('')}-${hex.slice(16,20).join('')}-${hex.slice(20).join('')}`;
}

export function repositoryPatchArtifactIdentity(job){
  if(!job?.repositoryTask||typeof job.id!=='string')throw new Error('Repository patch job is required');
  const name=`repository-patch-${job.id.slice(0,8)}.json`,id=repositoryPatchArtifactId(job.id,name);
  return {id,name,filename:`${id}.json`};
}

export function reconcileRepositoryPatchArtifact({job,state,dataDir,content}){
  const {id,name,filename}=repositoryPatchArtifactIdentity(job),directory=path.join(dataDir,'artifacts'),file=path.join(directory,filename),bytes=Buffer.from(content),sha256=digest(bytes);
  parseRepositoryPatch(bytes.toString('utf8'),job.repositoryTask);
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  if(fs.existsSync(file)){
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size!==bytes.length||digest(fs.readFileSync(file))!==sha256)throw new Error('Repository patch partial artifact conflicts with deterministic bytes');
  }else{
    atomicWrite(file,bytes);
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size!==bytes.length||digest(fs.readFileSync(file))!==sha256)throw new Error('Repository patch deterministic write verification failed');
  }
  const expected={id,name,filename,sha256,bytes:bytes.length,jobId:job.id,mimeType:'application/json'};
  const matches=Object.entries(state.artifacts).filter(([key,item])=>key===id||item.id===id||item.filename===filename||item.jobId===job.id&&item.name===name);
  if(matches.length>1||matches.some(([key,item])=>key!==id||JSON.stringify(item)!==JSON.stringify(expected)))throw new Error('Repository patch artifact registry conflicts with deterministic receipt');
  if(job.artifacts.some(ref=>ref.id!==id||ref.name!==name))throw new Error('Repository patch job has a conflicting artifact reference');
  const refs=job.artifacts.filter(ref=>ref.id===id||ref.name===name);
  if(refs.length>1||refs.length===1&&(refs[0].id!==id||refs[0].name!==name))throw new Error('Repository patch job artifact reference conflicts with deterministic receipt');
  if(matches.length===0)state.artifacts[id]=expected;
  if(refs.length===0)job.artifacts.push({id,name});
  return id;
}
