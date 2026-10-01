import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sceneMoments,PUBLIC_BRAND_NAME} from '../public/jarvis-scene-model.mjs';

test('public brand stays BLACKHOLE and scene only projects recorded known notices',()=>{
 assert.equal(PUBLIC_BRAND_NAME,'BLACKHOLE');
 assert.deepEqual(sceneMoments(undefined),[]);
 assert.deepEqual(sceneMoments(['unrelated','욕망 정산 · 충족 · greed · job-1','카피! 능력','별이 튕겨나왔습니다. 능력']),[
  {label:'정산',text:'욕망 정산 · 충족 · greed · job-1'},
  {label:'커비',text:'카피! 능력'},
  {label:'커비',text:'별이 튕겨나왔습니다. 능력'},
 ]);
 assert.equal(sceneMoments(['흡입! one','흡입! two','흡입! three','흡입! four']).length,3);
});
test('stage keeps a text category and no audio/autodispatch control',()=>{
 const html=readFileSync(new URL('../public/jarvis.html',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public/jarvis.css',import.meta.url),'utf8');
 const script=readFileSync(new URL('../public/jarvis.mjs',import.meta.url),'utf8');
 assert.match(html,/id="scene-moments"[^>]*hidden/);
 assert.match(html,/aria-label="저장된 사건"/);
 assert.match(script,/sceneMoments\(st\.systemNotices\)/);
 assert.match(script,/description\.textContent=moment\.text/);
 assert.match(css,/@media\(max-width:640px\)\{\.scene-moments/);
 assert.doesNotMatch(script,/new Audio\(|\.play\(\)/);
});
