import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fork} from 'node:child_process';import {once} from 'node:events';
import {openStore} from '../lib/store.mjs';
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-repo-restart-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
async function run(dir,mode,t){const child=fork(new URL('./helpers/repository-evidence-child.mjs',import.meta.url),[],{silent:true,execArgv:['--max-old-space-size=256'],windowsHide:true});const message=once(child,'message');const exited=once(child,'exit');t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill();await exited;}});child.send({dir,mode});const [result]=await message;return {child,result,exited};}
const sends=dir=>fs.readFileSync(path.join(dir,'sends.txt'),'utf8').trim().split('\n').length;
function artifact(name,value){if(process.env.REPOSITORY_EVIDENCE_TEST_DIR)fs.writeFileSync(path.join(process.env.REPOSITORY_EVIDENCE_TEST_DIR,name),JSON.stringify(value,null,2)+'\n');}
test('actual process restart reuses complete repository evidence without new HTTP calls',async t=>{
 const dir=fixture(t),first=await run(dir,'complete',t);await first.exited;assert.equal(first.result.record.status,'verified');
 const second=await run(dir,'complete',t);await second.exited;assert.notEqual(first.result.pid,second.result.pid);assert.deepEqual(second.result.record,first.result.record);assert.equal(sends(dir),2);assert.equal(second.result.charged,2);
 artifact('restart-complete.json',{synthetic:true,firstPid:first.result.pid,secondPid:second.result.pid,calls:2,charged:2,status:second.result.record.status,authorizesDispatch:false});
});
test('actual killed process leaves unknown evidence and restart cannot replay the reserved call',async t=>{
 const dir=fixture(t),first=await run(dir,'hang',t);assert.equal(first.result.phase,'sent');assert.equal(openStore(dir).state.repositoryEvidence.records[0].status,'reserved');first.child.kill();await first.exited;
 const second=await run(dir,'complete',t);await second.exited;assert.notEqual(first.result.pid,second.result.pid);assert.equal(second.result.record.status,'unknown');assert.equal(second.result.record.reason,'restart_outcome_unknown');assert.equal(second.result.record.calls[0].status,'unknown');assert.equal(sends(dir),1);assert.equal(second.result.charged,1);
 artifact('restart-unknown.json',{synthetic:true,firstPid:first.result.pid,secondPid:second.result.pid,calls:1,charged:1,status:second.result.record.status,authorizesDispatch:false});
});
