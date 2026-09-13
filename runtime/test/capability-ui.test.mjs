import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createCapabilityView} from '../public/capability-view.mjs';
const {JSDOM}=createRequire(new URL('../../apps/controller/package.json',import.meta.url))('jsdom');
test('live refresh preserves an edited capability input; uncertain submission retains it; logout clears private drafts',async()=>{
 const dom=new JSDOM('<main></main>'),root=dom.window.document.querySelector('main'),calls=[];
 const view=createCapabilityView({root,onAction:async(action,payload)=>{calls.push({action,payload});throw new Error('같은 요청 확인이 필요합니다.');}});
 const item={id:'example',name:'<img src=x>',description:'실행 기능',activeHash:'a'.repeat(64),previousHash:null,source:{kind:'native'},runCount:0,versions:[],sampleInput:{records:[]}};
 view.updateState({online:true,capabilities:[item]});assert.equal(root.querySelector('img'),null);
 root.querySelector('[data-cap-action=prepare]').click();const input=root.querySelector('[data-cap-input]');input.value='{"records":[{"private":"보존할 입력"}]}';
 view.updateState({online:true,capabilities:[{...item,runCount:1}]});assert.match(input.value,/보존할 입력/);
 root.querySelector('[data-cap-action=run]').click();await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);assert.match(input.value,/보존할 입력/);assert.match(root.querySelector('[data-cap-message]').textContent,/같은 요청/);
 view.updateState({online:false,capabilities:[item]});assert.equal(root.querySelector('[data-cap-action=run]').disabled,true);
 view.reset();assert.equal(input.value,'');view.destroy();dom.window.close();
});
