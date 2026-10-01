import test from 'node:test';
import assert from 'node:assert/strict';
import {createSearchProvider} from '../lib/search-provider.mjs';
import {randomBytes} from 'node:crypto';
const config=()=>({YENO_SEARCH_BASE_URL:'https://search.example.org/query',YENO_SEARCH_API_KEY:randomBytes(24).toString('hex'),YENO_SEARCH_OFFICIAL_ENDPOINT_CONFIRMED:'true',YENO_SEARCH_API_STYLE:'blackhole-search-v1'});
const invoke=p=>p.search('public schema validation',{limit:3,signal:new AbortController().signal});
test('provider gate rejects missing, unconfirmed, credential/query/hash/HTTP endpoint; vendor mapping never guessed',()=>{
 assert.equal(createSearchProvider({}).reason,'search_provider_missing');
 for(const url of ['http://example.org','https://user:pass@example.org','https://example.org?q=1','https://example.org/#fragment','https://127.0.0.1/query'])assert.equal(createSearchProvider({...config(),YENO_SEARCH_BASE_URL:url}).ready,false);
 assert.equal(createSearchProvider({...config(),YENO_SEARCH_OFFICIAL_ENDPOINT_CONFIRMED:'false'}).ready,false);assert.equal(createSearchProvider({...config(),YENO_SEARCH_API_STYLE:'vendor-unknown'}).reason,'search_adapter_not_selected');
});
test('typed gateway sends bounded query only and rejects redirects, non-JSON, oversized body, secret reflection and wrong shape',async()=>{
 let request;const c=config();const p=createSearchProvider(c,{fetchImpl:async(_url,r)=>{request=r;return new Response(JSON.stringify({results:[]} ),{headers:{'content-type':'application/json'}});}});assert.deepEqual(await invoke(p),[]);assert.deepEqual(JSON.parse(request.body),{query:'public schema validation',limit:3});assert.equal(request.redirect,'error');
 for(const response of [new Response('html'),new Response(JSON.stringify({results:c.YENO_SEARCH_API_KEY}),{headers:{'content-type':'application/json'}}),new Response(JSON.stringify({results:'wrong'}),{headers:{'content-type':'application/json'}}),new Response('x'.repeat(262145),{headers:{'content-type':'application/json'}})])await assert.rejects(()=>invoke(createSearchProvider(c,{fetchImpl:async()=>response})));
});
test('only explicit 429 permits one retry; other HTTP failure is definite, fetch timeout remains ambiguous',async()=>{
 for(const code of [401,429,503]){let caught;try{await invoke(createSearchProvider(config(),{fetchImpl:async()=>new Response('',{status:code})}));}catch(e){caught=e;}assert.equal(caught.definite,true);assert.equal(caught.retryable,code===429);}
 await assert.rejects(()=>invoke(createSearchProvider(config(),{fetchImpl:async()=>{throw Error('timeout');}})),/timeout/);
});
