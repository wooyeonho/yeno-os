import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {sha256,PATCH_SCHEMA} from '../lib/repository-patch.mjs';
import {executeBoundedRepositoryOrder} from '../../workers/developer/bounded-order-executor.mjs';

test('real bounded executor primitives apply the core artifact only in a disposable snapshot and use a clearly fake sandbox',async t=>{
  const root=await fs.promises.mkdtemp(path.join(os.tmpdir(),'b5-executor-')),repo=path.join(root,'repo');await fs.promises.mkdir(path.join(repo,'projects','demo'),{recursive:true});const source='export const sum = xs => 0;',testSource="import test from 'node:test';\n";await fs.promises.writeFile(path.join(repo,'projects','demo','main.mjs'),source);await fs.promises.writeFile(path.join(repo,'projects','demo','main.test.mjs'),testSource);const git=(...args)=>execFileSync('git',args,{cwd:repo,stdio:'pipe'});git('init');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');git('add','.');git('commit','-m','fixture');const baseCommit=git('rev-parse','HEAD').toString().trim(),patch={schema:PATCH_SCHEMA,baseCommit,changes:[{path:'projects/demo/main.mjs',beforeSha256:sha256(source),content:'export const sum = xs => xs.reduce((a,b)=>a+b,0);'}]},artifactBytes=Buffer.from(JSON.stringify(patch)),order={id:randomUUID(),jobId:randomUUID(),baseCommit,artifact:{id:randomUUID(),sha256:sha256(artifactBytes)}};let runs=0;
  const sandbox={kind:'in-process-fake-sandbox',async run({workspace,testFiles}){runs++;assert.equal(await fs.promises.readFile(path.join(workspace,'projects','demo','main.mjs'),'utf8'),patch.changes[0].content);assert.deepEqual(testFiles,['projects/demo/main.test.mjs']);return{exitCode:0,timedOut:false,outputOverflow:false,stdout:'synthetic pass',stderr:'',imageId:`sha256:${'c'.repeat(64)}`,isolation:'in-process-fake-sandbox'};}};
  const evidence=await executeBoundedRepositoryOrder({repositoryRoot:repo,order,artifactBytes,testFiles:['projects/demo/main.test.mjs'],sandbox,now:()=> '2026-10-07T12:00:00.000Z'});assert.equal(runs,1);assert.equal(evidence.contractId,order.jobId);assert.equal(evidence.patchSha256,order.artifact.sha256);assert.equal(evidence.attempts[0].isolation,'in-process-fake-sandbox');assert.equal(await fs.promises.readFile(path.join(repo,'projects','demo','main.mjs'),'utf8'),source);t.after(()=>fs.promises.rm(root,{recursive:true,force:true}));
});
