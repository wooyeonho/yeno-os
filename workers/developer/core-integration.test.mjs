// Real HTTP core + actual repository patching. Provider replies are explicitly synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {start} from '../../runtime/server.mjs';
import {openStore} from '../../runtime/lib/store.mjs';
import {PATCH_SCHEMA, sha256} from '../../runtime/lib/repository-patch.mjs';
import {CoreGateway,dockerEvidenceFrom} from './gateways.mjs';
import {headOf,runDeveloperTask,DockerSandbox} from './worker.mjs';
const initial='export const sum = xs => 0;\n';
const correct='export const sum = xs => xs.reduce((a,b)=>a+b,0);\n';
async function integrated(t,realDocker){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-core-worker-'));
  fs.chmodSync(dir,0o755);
  const root=path.join(dir,'repo'), source='projects/demo/main.mjs';
  fs.mkdirSync(path.join(root,'projects/demo'),{recursive:true});
  fs.writeFileSync(path.join(root,source),initial);
  fs.writeFileSync(path.join(root,'projects/demo/main.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';import {sum} from './main.mjs';test('sum',()=>{assert.equal(sum([2,4]),6);assert.equal(sum([]),0);assert.equal(sum([-2,1]),-1);});\n");
  for(const args of [['init','-q'],['add','.'],['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','baseline']])execFileSync('git',args,{cwd:root});
  const baseCommit=headOf(root),dataDir=path.join(dir,'core'),store=openStore(dataDir);
  store.state.modules.ai=true;store.save();
  const token='synthetic-core-worker-owner-token';let calls=0;
  const core=await start({dataDir,host:'127.0.0.1',port:0,token,
    env:{YENO_AGENT_PROVIDER:'openai',YENO_AGENT_DAILY_CALL_LIMIT:'20',YENO_OPENAI_MODEL:'synthetic-integration-model',YENO_OPENAI_API_KEY:'synthetic-api-key'},
    agentFetch:async()=>{
      calls++;
      const content=calls===1?'export const sum = xs => 1;\n':correct;
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({schema:PATCH_SCHEMA,baseCommit,changes:[{path:source,beforeSha256:sha256(initial),content}]})}}],usage:{prompt_tokens:10,completion_tokens:20}}),{headers:{'Content-Type':'application/json'}});
    }});
  t.after(()=>{core.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  const gateway=new CoreGateway({origin:`http://127.0.0.1:${core.server.address().port}`,token});
  // The synthetic path still reports a well-formed (but fake) pinned image ID,
  // matching what a real DockerSandbox result looks like, so the evidence
  // pipeline itself (schema, core round-trip) can be exercised without Docker;
  // it never claims real isolation - isolation stays 'synthetic-test-adapter'.
  const sandbox=realDocker?new DockerSandbox({imageId:process.env.BLACKHOLE_WORKER_IMAGE_ID,timeoutMs:30000}):{run:async({workspace})=>({exitCode:fs.readFileSync(path.join(workspace,source),'utf8')===correct?0:1,stdout:'synthetic test adapter; not Docker evidence',stderr:'',isolation:'synthetic-test-adapter',imageId:'sha256:'+'0'.repeat(64)})};
  const options={root,contract:{id:'core-integration',baseCommit,goal:'Fix numeric sum',editablePaths:[source],contextPaths:[],testFiles:['projects/demo/main.test.mjs']},journalPath:path.join(dir,'journal.json'),sandbox,guard:()=>gateway.guard(),model:(task,id,signal)=>gateway.plan(task,id,signal)};
  const result=await runDeveloperTask(options);
  assert.equal(result.phase,'candidate_verified',JSON.stringify(result));
  assert.equal(result.attempts.length,2);assert.equal(calls,2);
  assert.equal(result.attempts[0].test.passed,false);assert.equal(result.attempts[1].test.passed,true);
  assert.equal((await runDeveloperTask(options)).patchSha256,result.patchSha256);assert.equal(calls,2);
  assert.equal(fs.readFileSync(path.join(root,source),'utf8'),initial);
  const state=await gateway.state();
  assert.equal(state.jobs.filter(j=>j.repositoryPlan).length,2);
  assert.ok(state.jobs.filter(j=>j.repositoryPlan).every(j=>j.status==='completed'));
  // This is the exact function the CLI runs after run() finishes, against the
  // exact CoreGateway method it calls - not a hand-built evidence object -
  // reported to the same real HTTP core the patch was drafted against.
  const evidence=dockerEvidenceFrom(result);
  assert.ok(evidence,'a real failed-then-passed run must produce reportable Docker evidence');
  assert.equal(gateway.lastJobId,state.jobs.find(j=>j.repositoryPlan?.baseCommit===baseCommit)?.id);
  await gateway.reportEvidence(gateway.lastJobId,evidence,'evidence-'+gateway.lastJobId);
  const withEvidence=(await gateway.state()).jobs.find(j=>j.id===gateway.lastJobId);
  assert.equal(withEvidence.repositoryPlan.executionStatus,'docker-verified');
  assert.equal(withEvidence.repositoryPlan.evidence.attempts.length,2);
  assert.equal(withEvidence.repositoryPlan.evidence.attempts[0].passed,false);
  assert.equal(withEvidence.repositoryPlan.evidence.attempts[1].passed,true);
}
test('real HTTP core gateway -> patch -> failure -> repair -> durable replay; synthetic provider/runner',t=>integrated(t,false));
test('real HTTP core gateway + real Docker -> failure -> repair; synthetic provider only',{skip:process.env.DEVELOPER_DOCKER_REQUIRED!=='1'},t=>integrated(t,true));
