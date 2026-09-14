// Runs on a disposable developer host, NEVER inside the production core.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {sha256,safeSourcePath,editablePath,validateRepositoryTask,parseRepositoryPatch} from '../../runtime/lib/repository-patch.mjs';

export class WorkerError extends Error {constructor(code){super(`Developer worker: ${code}`);this.code=code;}}
const fail=code=>{throw new WorkerError(code);};
const git=(root,...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',...args],{cwd:root,env:{PATH:process.env.PATH,HOME:os.tmpdir(),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'},maxBuffer:12*1024*1024,timeout:15000,stdio:['ignore','pipe','pipe']});
export const headOf=root=>git(root,'rev-parse','HEAD').toString().trim();
export function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID()+'.tmp';const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
const clean=x=>String(x??'').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'').slice(-3000);
export function validateContract(c){
  if(!c||Object.keys(c).some(k=>!['id','baseCommit','goal','editablePaths','contextPaths','testFiles'].includes(k))||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(c.id??'')||!/^[a-f0-9]{40}$/.test(c.baseCommit??'')||typeof c.goal!=='string'||!c.goal.trim()||c.goal.length>1500)fail('invalid_contract');
  for(const k of ['editablePaths','contextPaths','testFiles'])if(!Array.isArray(c[k])||new Set(c[k]).size!==c[k].length)fail('invalid_paths');
  if(c.editablePaths.length<1||c.editablePaths.length>4||c.contextPaths.length>4||c.testFiles.length<1||c.testFiles.length>100)fail('scope_limit');
  c.editablePaths.forEach(editablePath);c.contextPaths.forEach(safeSourcePath);
  for(const file of c.testFiles){safeSourcePath(file);if(!file.endsWith('.test.mjs'))fail('immutable_node_test_required');}
  return structuredClone(c);
}
export function snapshotRepository(root,baseCommit,destination){
  if(headOf(root)!==baseCommit)fail('base_commit_changed');
  const entries=git(root,'ls-tree','-rz',baseCommit).toString().split('\0').filter(Boolean);let bytes=0,count=0;
  for(const entry of entries){
    const match=entry.match(/^(\d+) (\w+) ([a-f0-9]{40})\t([\s\S]+)$/);if(!match)fail('invalid_tree');
    const [,mode,type,oid,name]=match;
    // No .git, hidden configuration, runtime state, dependency trees or secrets.
    if(name.split('/').some(s=>s.startsWith('.'))||/(?:^|\/)(?:data|node_modules|00_INBOX_RAW|secrets|credentials)(?:\/|$)/i.test(name))continue;
    safeSourcePath(name);if(!['100644','100755'].includes(mode)||type!=='blob')fail('symlink_or_submodule');
    const content=git(root,'cat-file','blob',oid);bytes+=content.length;count++;
    if(content.length>3*1024*1024||bytes>16*1024*1024||count>2000)fail('snapshot_limit');
    const dest=path.join(destination,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content,{mode:0o644,flag:'wx'});
  }
  return {files:count,bytes};
}
export function buildTask(snapshot,c,feedback=''){
  const files=[...new Set([...c.editablePaths,...c.contextPaths])].map(p=>{const content=fs.readFileSync(path.join(snapshot,p),'utf8');return {path:p,content,sha256:sha256(content)};});
  return validateRepositoryTask({baseCommit:c.baseCommit,goal:c.goal,files,editablePaths:c.editablePaths,feedback:clean(feedback)});
}
export function applyPatch(snapshot,candidate,patch,task){
  const valid=parseRepositoryPatch(JSON.stringify(patch),task);
  fs.cpSync(snapshot,candidate,{recursive:true,errorOnExist:true,force:false,dereference:false});
  for(const change of valid.changes){const file=path.join(candidate,change.path);if(!fs.lstatSync(file).isFile()||sha256(fs.readFileSync(file))!==change.beforeSha256)fail('candidate_base_mismatch');fs.writeFileSync(file,change.content);}
  return valid;
}
export function dockerArguments({workspace,imageId,name,testFiles}){
  if(!/^sha256:[a-f0-9]{64}$/.test(imageId)||!/^blackhole-[a-f0-9-]{36}$/.test(name))fail('unverified_docker_image');
  if(!path.isAbsolute(workspace)||/[,:\n\r]/.test(workspace))fail('invalid_mount_path');
  if(!Array.isArray(testFiles)||!testFiles.length)fail('tests_required');testFiles.forEach(p=>{safeSourcePath(p);if(!p.endsWith('.test.mjs'))fail('invalid_test');});
  return ['run','--rm','--name',name,'--pull','never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges=true','--user','1000:1000','--memory','512m','--memory-swap','512m','--cpus','1','--pids-limit','128','--ulimit','nofile=1024:1024','--tmpfs','/tmp:rw,nosuid,nodev,size=268435456,mode=1777','--mount',`type=bind,src=${workspace},dst=/workspace,readonly`,'--workdir','/workspace','--env','HOME=/tmp','--env','NODE_ENV=test',imageId,'node','--test',...testFiles];
}
export class DockerSandbox {
  constructor({imageId,timeoutMs=120000}={}){if(!/^sha256:[a-f0-9]{64}$/.test(imageId??''))fail('pinned_local_image_required');this.imageId=imageId;this.timeoutMs=timeoutMs;this.kind='docker-no-network';}
  async run({workspace,testFiles,signal}){
    signal?.throwIfAborted();const name='blackhole-'+randomUUID();const args=dockerArguments({workspace:fs.realpathSync(workspace),imageId:this.imageId,name,testFiles});
    return new Promise((resolve,reject)=>{
      let stdout='',stderr='',bytes=0,stopped=false,timeout=false,overflow=false,killFailed=false;
      const child=spawn('docker',args,{shell:false,env:{PATH:process.env.PATH,HOME:os.tmpdir()},stdio:['ignore','pipe','pipe']});
      const stop=()=>{if(stopped)return;stopped=true;try{execFileSync('docker',['rm','-f',name],{timeout:10000,stdio:'ignore',env:{PATH:process.env.PATH,HOME:os.tmpdir()}});}catch{killFailed=true;}child.kill('SIGKILL');};
      const timer=setTimeout(()=>{timeout=true;stop();},this.timeoutMs);
      const onAbort=()=>stop();signal?.addEventListener('abort',onAbort,{once:true});
      const collect=stream=>chunk=>{bytes+=chunk.length;if(bytes>1024*1024){overflow=true;stop();return;}if(stream==='out')stdout+=chunk;else stderr+=chunk;};
      child.stdout.on('data',collect('out'));child.stderr.on('data',collect('err'));
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);};
      child.on('error',error=>{cleanup();reject(new WorkerError(error.code==='ENOENT'?'docker_unavailable':'sandbox_start_failed'));});
      child.on('close',(code,sig)=>{cleanup();if(killFailed){reject(new WorkerError('container_stop_unconfirmed'));return;}if(signal?.aborted){reject(signal.reason??new WorkerError('stopped'));return;}resolve({exitCode:code,signal:sig,timedOut:timeout,outputOverflow:overflow,stdout,stderr,imageId:this.imageId,isolation:this.kind});});
    });
  }
}
function evidence(result){if(!result||!Number.isInteger(result.exitCode)||typeof result.stdout!=='string'||typeof result.stderr!=='string')fail('invalid_runner_result');return {exitCode:result.exitCode,timedOut:!!result.timedOut,outputOverflow:!!result.outputOverflow,stdoutSha256:sha256(result.stdout),stderrSha256:sha256(result.stderr),feedback:clean(result.stdout+'\n'+result.stderr),imageId:result.imageId??null,isolation:result.isolation??'test-adapter',passed:result.exitCode===0&&!result.timedOut&&!result.outputOverflow};}
export async function runDeveloperTask({root,contract,journalPath,model,sandbox,publish,guard=async()=>{},signal}){
  const c=validateContract(contract);root=fs.realpathSync(root);journalPath=path.resolve(journalPath);
  if(journalPath===root||journalPath.startsWith(root+path.sep))fail('journal_must_be_outside_source');
  const fingerprint=sha256(JSON.stringify(c));fs.mkdirSync(path.dirname(journalPath),{recursive:true,mode:0o700});
  const lock=journalPath+'.lock';try{fs.mkdirSync(lock);}catch{fail('worker_already_running_or_unreconciled_lock');}
  let journal,workspace;
  const save=()=>atomic(journalPath,journal);
  const live=async()=>{signal?.throwIfAborted();await guard();signal?.throwIfAborted();};
  try{
    if(fs.existsSync(journalPath)){
      const previous=JSON.parse(fs.readFileSync(journalPath,'utf8'));
      if(previous.fingerprint!==fingerprint)fail('request_identity_conflict');
      journal=previous;
      if(['awaiting_approval','candidate_verified','failed','paused','unknown'].includes(journal.phase))return journal;
      journal.phase='unknown';journal.error='interrupted_operation_requires_reconciliation';save();return journal;
    }
    journal={schema:1,id:c.id,fingerprint,baseCommit:c.baseCommit,phase:'created',attempts:[],startedAt:new Date().toISOString(),published:null};save();
    workspace=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-developer-'));fs.chmodSync(workspace,0o755);
    const baseline=path.join(workspace,'baseline');fs.mkdirSync(baseline);
    await live();journal.snapshot=snapshotRepository(root,c.baseCommit,baseline);
    journal.tests=c.testFiles.map(p=>({path:p,sha256:sha256(fs.readFileSync(path.join(baseline,p)))}));
    const task=buildTask(baseline,c);journal.phase='baseline_testing';save();
    journal.baseline=evidence(await sandbox.run({workspace:baseline,testFiles:c.testFiles,signal}));save();
    let feedback='',patch;
    for(let attempt=0;attempt<2;attempt++){
      await live();journal.phase=attempt?'repairing':'generating';const receipt={number:attempt+1,requestId:`developer-${c.id}-${attempt+1}`,status:'reserved'};journal.attempts.push(receipt);save();
      // The model adapter uses the SAME durable core requestId on uncertain transport.
      // No paid retry is permitted after an unknown result.
      let raw;try{raw=await model({...task,feedback},receipt.requestId,signal);}catch(error){if(error.settled===true){receipt.status='settled';receipt.error=error.code;feedback='Previous plan was rejected: '+clean(error.code)+'. Return a valid patch against the original source.';save();continue;}receipt.status='unknown';journal.phase='unknown';journal.error=error.code??'model_outcome_unknown';save();return journal;}
      receipt.status='settled';receipt.responseSha256=sha256(typeof raw==='string'?raw:JSON.stringify(raw));save();
      try{patch=parseRepositoryPatch(typeof raw==='string'?raw:JSON.stringify(raw),task);}catch(error){receipt.error=error.code;feedback=`Patch rejected: ${error.code}. Return a valid patch against the ORIGINAL source hashes.`;save();continue;}
      const candidate=path.join(workspace,'candidate-'+attempt);applyPatch(baseline,candidate,patch,task);
      for(const t of journal.tests)if(sha256(fs.readFileSync(path.join(candidate,t.path)))!==t.sha256)fail('acceptance_test_changed');
      await live();journal.phase='testing';save();receipt.test=evidence(await sandbox.run({workspace:candidate,testFiles:c.testFiles,signal}));save();
      if(receipt.test.passed){
        await live();if(headOf(root)!==c.baseCommit)fail('base_commit_changed');
        journal.patch=patch;journal.patchSha256=sha256(JSON.stringify(patch));journal.phase='candidate_verified';save();
        if(publish){journal.phase='publishing';save();try{journal.published=await publish({contract:c,patch,evidence:structuredClone(journal)},signal);journal.phase='awaiting_approval';}catch(error){journal.phase='unknown';journal.error=error.code??'publish_outcome_unknown';}save();}
        return journal;
      }
      feedback=receipt.test.feedback;
    }
    journal.phase='failed';journal.error='repair_limit_reached';save();return journal;
  }catch(error){if(journal){journal.phase=signal?.aborted?'paused':'failed';journal.error=error.code??(signal?.aborted?'stopped':'worker_failed');save();return journal;}throw error;}
  finally{if(workspace)fs.rmSync(workspace,{recursive:true,force:true});fs.rmdirSync(lock);}
}
