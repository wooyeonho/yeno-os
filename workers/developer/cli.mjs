#!/usr/bin/env node
// Only run on a disposable trusted worker host with Docker; not on the Koyeb core.
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {runDeveloperTask,DockerSandbox} from './worker.mjs';
import {CoreGateway,GitHubGateway} from './gateways.mjs';
const args=process.argv.slice(2),mode=args.shift();
const arg=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const abort=new AbortController();process.once('SIGINT',()=>abort.abort(new Error('owner_stop')));process.once('SIGTERM',()=>abort.abort(new Error('owner_stop')));
let watcher;
try{
  if(mode==='run'){
    const contract=read(arg('--contract')),root=path.resolve(arg('--repo')??'.'),journalPath=arg('--journal');
    if(!journalPath)throw Error('An external --journal path is required');
    const core=new CoreGateway({origin:process.env.BLACKHOLE_CORE_ORIGIN,token:process.env.BLACKHOLE_WORKER_DEVICE_TOKEN});
    // Pulling/installing images is an explicit host preparation step, never model-driven.
    const imageId=process.env.BLACKHOLE_WORKER_IMAGE_ID;if(!imageId)throw Error('BLACKHOLE_WORKER_IMAGE_ID must pin an already installed Docker image');
    execFileSync('docker',['image','inspect',imageId],{stdio:'ignore',timeout:10000});
    const sandbox=new DockerSandbox({imageId});
    let checking=false;watcher=setInterval(async()=>{if(checking)return;checking=true;try{await core.guard(abort.signal);}catch{abort.abort(new Error('core_stop_or_connection_lost'));}finally{checking=false;}},2000);
    const github=args.includes('--publish')?new GitHubGateway({token:process.env.BLACKHOLE_GITHUB_TOKEN}):null;
    const result=await runDeveloperTask({root,contract,journalPath,model:(t,id,s)=>core.plan(t,id,s),sandbox,guard:()=>core.guard(abort.signal),publish:github?(x,s)=>github.stage(x,s):undefined,signal:abort.signal});
    console.log(JSON.stringify({phase:result.phase,attempts:result.attempts.length,patchSha256:result.patchSha256??null,pr:result.published?.url??null,error:result.error??null}));
    process.exitCode=['candidate_verified','awaiting_approval'].includes(result.phase)?0:1;
  }else if(mode==='promote'||mode==='rollback'){
    // This explicit operator command is not reachable by the model or sandbox.
    const record=read(arg('--record')),approved=arg('--approve'),head=arg('--expected-head');
    const github=new GitHubGateway({token:process.env.BLACKHOLE_GITHUB_TOKEN});
    if(mode==='promote'){const core=new CoreGateway({origin:process.env.BLACKHOLE_CORE_ORIGIN,token:process.env.BLACKHOLE_WORKER_DEVICE_TOKEN});await core.guard(abort.signal);}
    const result=mode==='promote'?await github.approvePromotion({receipt:record.published,approvedCommit:approved,expectedProductionHead:head,verificationRunId:Number(arg('--verification-run'))},abort.signal):await github.approveRollback({deployment:record,approvedSourceCommit:approved,expectedProductionHead:head},abort.signal);
    console.log(JSON.stringify(result));
  }else throw Error('Use run --repo PATH --contract FILE --journal OUTSIDE_REPO [--publish], or promote/rollback with exact approval and expected head.');
}catch(error){console.error(JSON.stringify({error:error.code??'worker_configuration_or_execution_failed'}));process.exitCode=1;}finally{clearInterval(watcher);}
