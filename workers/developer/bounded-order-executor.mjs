import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateDeveloperEvidence,sha256,editablePath,parseRepositoryPatch,PATCH_SCHEMA} from '../../runtime/lib/repository-patch.mjs';
import {validateContract,snapshotRepository,buildTask,applyPatch,headOf} from './worker.mjs';

const fail=code=>{const error=new Error(`Bounded order executor: ${code}`);error.code=code;throw error;};
const attempt=(result,number=1)=>{if(!result||!Number.isInteger(result.exitCode)||typeof result.stdout!=='string'||typeof result.stderr!=='string')fail('invalid_sandbox_result');return{number,exitCode:result.exitCode,timedOut:!!result.timedOut,outputOverflow:!!result.outputOverflow,stdoutSha256:sha256(result.stdout),stderrSha256:sha256(result.stderr),isolation:result.isolation??'test-adapter',passed:result.exitCode===0&&!result.timedOut&&!result.outputOverflow};};
function applyPatchPortable(snapshot,candidate,patch,task){
  if(process.platform!=='win32')return applyPatch(snapshot,candidate,patch,task);
  const valid=parseRepositoryPatch(JSON.stringify(patch),task);if(fs.existsSync(candidate))fail('candidate_exists');
  // Node 24 on this Windows host terminates natively in recursive cpSync. The
  // snapshot contains only directories and regular files, so copy them with
  // exclusive file creation and preserve the upstream copy-once contract.
  const copy=(from,to)=>{fs.mkdirSync(to);for(const entry of fs.readdirSync(from,{withFileTypes:true})){const source=path.join(from,entry.name),target=path.join(to,entry.name);if(entry.isDirectory())copy(source,target);else if(entry.isFile())fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);else fail('invalid_snapshot_entry');}};copy(snapshot,candidate);
  for(const change of valid.changes){const file=path.join(candidate,change.path);if(!fs.lstatSync(file).isFile()||sha256(fs.readFileSync(file))!==change.beforeSha256)fail('candidate_base_mismatch');fs.writeFileSync(file,change.content);}
  return valid;
}
function removeWorkspace(workspace){
  if(process.platform!=='win32'){fs.rmSync(workspace,{recursive:true,force:true});return;}
  const resolved=fs.realpathSync(workspace),temporary=fs.realpathSync(os.tmpdir());if(path.dirname(resolved)!==temporary||!path.basename(resolved).startsWith('blackhole-order-'))fail('unsafe_workspace_cleanup');
  const remove=directory=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const target=path.join(directory,entry.name);if(entry.isDirectory())remove(target);else if(entry.isFile())fs.unlinkSync(target);else fail('invalid_workspace_entry');}fs.rmdirSync(directory);};remove(resolved);
}

export async function executeBoundedRepositoryOrder({repositoryRoot,order,artifactBytes,testFiles,sandbox,guard=async()=>{},signal,now=()=>new Date().toISOString()}={}){
  if(!order||typeof order.id!=='string'||typeof order.baseCommit!=='string'||order.artifact?.sha256!==sha256(artifactBytes)||!sandbox||typeof sandbox.run!=='function')fail('invalid_order_input');
  let patch;try{patch=JSON.parse(Buffer.from(artifactBytes).toString('utf8'));}catch{fail('invalid_patch_artifact');}
  if(patch?.schema!==PATCH_SCHEMA||patch.baseCommit!==order.baseCommit||!Array.isArray(patch.changes)||!patch.changes.length)fail('invalid_patch_artifact');
  const editablePaths=patch.changes.map(change=>editablePath(change.path));
  const contract=validateContract({id:order.id,baseCommit:order.baseCommit,goal:`Execute core-approved repository patch ${order.id}`,editablePaths,contextPaths:[],testFiles});
  const root=fs.realpathSync(repositoryRoot),workspace=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-order-'));
  try{
    const baseline=path.join(workspace,'baseline');fs.mkdirSync(baseline);
    await guard();signal?.throwIfAborted();snapshotRepository(root,contract.baseCommit,baseline);
    const immutableTests=contract.testFiles.map(file=>({path:file,sha256:sha256(fs.readFileSync(path.join(baseline,file)))}));
    const task=buildTask(baseline,contract),candidate=path.join(workspace,'candidate');applyPatchPortable(baseline,candidate,patch,task);
    for(const item of immutableTests)if(sha256(fs.readFileSync(path.join(candidate,item.path)))!==item.sha256)fail('acceptance_test_changed');
    await guard();signal?.throwIfAborted();const result=await sandbox.run({workspace:candidate,testFiles:contract.testFiles,signal});
    await guard();signal?.throwIfAborted();if(headOf(root)!==contract.baseCommit)fail('base_commit_changed');
    if(!/^sha256:[a-f0-9]{64}$/.test(result.imageId??''))fail('invalid_sandbox_image');
    const evidence={schema:1,contractId:order.jobId??order.id,baseCommit:contract.baseCommit,testFiles:immutableTests,dockerImageId:result.imageId,attempts:[attempt(result)],patchSha256:order.artifact.sha256,candidateCommit:null,publish:null,ciRun:null,approval:null,promotion:null,rollback:null,reportedAt:now()};
    validateDeveloperEvidence(evidence);return evidence;
  }finally{removeWorkspace(workspace);}
}
