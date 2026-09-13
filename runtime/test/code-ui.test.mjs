import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {createCodeView} from '../public/code-view.mjs';
const {JSDOM}=createRequire(new URL('../../apps/controller/package.json',import.meta.url))('jsdom');
test('code drafts survive live polling, wrong JSON makes no request, receipts retain uncertain inputs and logout clears drafts',async()=>{
 const dom=new JSDOM('<main></main>'),root=dom.window.document.querySelector('main'),calls=[];const view=createCodeView(root,{onAction:async(a,b)=>{calls.push([a,b]);throw Error('same request pending');},onOpenArtifact:()=>{}});const state={online:true,codeWorkshop:{entries:[],jobs:[]}};view.update(state);
 const form=root.querySelector('[data-generate]');form.elements.goal.value='실제 새 기능';form.elements.fixtures.value='[';form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await new Promise(r=>setImmediate(r));assert.equal(calls.length,0);
 form.elements.fixtures.value='[]';view.update(state);assert.equal(form.elements.goal.value,'실제 새 기능');form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);assert.equal(form.elements.goal.value,'실제 새 기능');assert.match(root.textContent,/same request pending/);
 view.update({...state,online:false});assert.ok([...root.querySelectorAll('button')].every(b=>b.disabled));view.reset();assert.equal(form.elements.goal.value,'');dom.window.close();
});
