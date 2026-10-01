import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../lib/store.mjs';
import {allowedShadowTools,setShadowProfile,profileForShadow} from '../lib/shadow-profiles.mjs';
import {agentTool} from '../lib/agent-engine.mjs';

const id='11111111-1111-4111-8111-111111111111';
const member={id,role:'scout',status:'active'};
const state=()=>{const s=initialState();s.shadowRoster.entries=[member];return s;};
const connected=[{id:'ollama',kind:'inference',status:'connected'}];

test('S11 profile refuses tools beyond role and rank and disconnected model',()=>{
  const s=state();
  assert.deepEqual(allowedShadowTools('scout','E'),['project_sources']);
  assert.deepEqual(allowedShadowTools('builder','S'),['project_read']);
  assert.throws(()=>setShadowProfile(s,{shadowId:id,modelBinding:'local',toolScope:['project_read'],budgetShare:1},connected));
  assert.throws(()=>setShadowProfile(s,{shadowId:id,modelBinding:'openai',toolScope:['project_sources'],budgetShare:1},connected));
  assert.throws(()=>setShadowProfile(s,{shadowId:id,modelBinding:'local',toolScope:['project_sources'],budgetShare:5},connected));
  s.shadowArise.storedIds=[id];
  assert.throws(()=>setShadowProfile(s,{shadowId:id,modelBinding:'local',toolScope:['project_sources'],budgetShare:1},connected));
});

test('S11 connected model profile is durable data and inherits when unset',()=>{
  const s=state();
  assert.equal(profileForShadow(s,id).modelBinding,null);
  assert.equal(profileForShadow(s,id).budgetShare,4);
  const next=setShadowProfile(s,{shadowId:id,modelBinding:'local',toolScope:['project_sources'],budgetShare:2},connected);
  assert.deepEqual(next.entries,[{shadowId:id,modelBinding:'local',toolScope:['project_sources'],budgetShare:2}]);
  s.shadowProfiles=next;
  assert.equal(profileForShadow(s,id).modelBinding,'local');
  assert.equal(profileForShadow(s,id).budgetShare,2);
});

test('S11 out-of-role tool call is rejected before any read or network transport',async()=>{
  let networkCalls=0;
  const job={shadowAssignment:{role:'scout',toolScope:['project_sources']}};
  const response=await agentTool({name:'source_read_release',args:{sourceId:'anything'}},{},async()=>{networkCalls++;throw Error('unexpected network');},new AbortController().signal,job);
  assert.deepEqual(response,{error:'shadow_tool_outside_scope'});
  assert.equal(networkCalls,0);
  assert.deepEqual(await agentTool({name:'project_read',args:{}},{},async()=>{networkCalls++;},new AbortController().signal,{shadowAssignment:{role:'builder',toolScope:[]}}),{error:'shadow_tool_outside_scope'});
});
