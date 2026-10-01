import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {start} from '../server.mjs';
import {publicJob} from '../lib/job-view.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('state response contains no secret material and exposes task routing',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-jarvis-state-'));
  const owner='synthetic-jarvis-owner';
  const secret='zz99xx-private-provider-key-yy88qq';
  const runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token:owner,env:{YENO_AGENT_PROVIDER:'auto',YENO_AGENT_DAILY_CALL_LIMIT:'2',YENO_NVIDIA_MODEL:'synthetic-model',YENO_NVIDIA_API_KEY:secret}});
  t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${runtime.server.address().port}`;
  const response=await fetch(`${base}/api/state`,{headers:{Authorization:`Bearer ${owner}`}});
  assert.equal(response.status,200);
  const body=await response.text();
  for(const [index,value] of [secret,secret.slice(0,6),secret.slice(-6),owner].entries())assert.equal(body.includes(value),false,`redaction candidate ${index}`);
  const state=JSON.parse(body);
  assert.equal(state.agent.routing.routes.goal.includes('local'),false);
  assert.equal(state.agent.routing.routes.chat[0],'local');
  assert.equal(state.agent.routing.retryLimit,0);
});

test('public job redacts journal including Authorization and exposes only provider/model',()=>{
  const job={id:'synthetic',type:'agent',title:'test',input:'test',status:'completed',step:3,totalSteps:3,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),error:null,version:1,artifacts:[],agentJournal:{provider:'nvidia',model:'synthetic-model',calls:[],history:[{role:'user',content:'Authorization: Bearer synthetic-sensitive'}]}};
  const publicValue=publicJob(job);
  assert.equal(publicValue.provider,'nvidia');
  assert.equal(publicValue.model,'synthetic-model');
  assert.equal(JSON.stringify(publicValue).includes('Bearer'),false);
  assert.equal(JSON.stringify(publicValue).includes('Authorization'),false);
});

test('jarvis html has external script and style only',()=>{
  const html=fs.readFileSync(path.join(root,'public','jarvis.html'),'utf8');
  assert.doesNotMatch(html,/<script(?![^>]*\bsrc=)/i);
  assert.doesNotMatch(html,/<style\b|\bonclick\s*=|\bstyle\s*=/i);
});

test('security headers remain on the Jarvis page and state API',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-jarvis-headers-'));
  const owner='synthetic-jarvis-headers';
  const runtime=await start({host:'127.0.0.1',port:0,dataDir:dir,token:owner,env:{}});
  t.after(()=>{runtime.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${runtime.server.address().port}`;
  for(const route of ['/jarvis','/api/state']){
    const response=await fetch(base+route,{headers:{Authorization:`Bearer ${owner}`}});
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-security-policy')??'',/script-src 'self'/);
    assert.equal(response.headers.get('x-frame-options'),'DENY');
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.equal(response.headers.get('referrer-policy'),'no-referrer');
    assert.equal(response.headers.get('cache-control'),'no-store');
  }
});
