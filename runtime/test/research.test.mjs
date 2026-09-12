import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {RESEARCH_TRACKS,RESEARCH_RESERVED_BYTES,ResearchError,validateResearchInput,validateResearchRequest,collectResearchEvidence,validateResearchBundle,createResearchPrompt} from '../lib/research.mjs';

const request={version:1,question:'어떤 증거가 필요한가?',query:'long COVID biomarker external validation',projectId:null,trackCode:null};
const hash=s=>createHash('sha256').update(s).digest('hex');
const error=(code,status=400)=>e=>e instanceof ResearchError&&e.code===code&&e.status===status;
const epmc=(items=[{id:'123',source:'MED',doi:'10.1234/first',title:'A cohort study',authorList:{author:[{fullName:'Lee A'}]},pubYear:'2025',abstractText:'A cohort was followed. Results require independent validation.',isRetracted:'N'}])=>({resultList:{result:items}});
const crossref=(items=[{DOI:'10.1234/second',title:['A metadata only publication'],author:[{given:'Min',family:'Kim'}],published:{'date-parts':[[2024,2,1]]}}])=>({status:'ok',message:{items}});
const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json; charset=utf-8'}});
const fetchFixture=async url=>json(new URL(url).hostname==='api.crossref.org'?crossref():epmc());

test('canonical nine EUREKA project IDs and scope survive without creating another project',async()=>{
  const doc=JSON.parse(await readFile(new URL('../../docs/ALL_PROJECTS_AND_SOURCES_20260911.json',import.meta.url),'utf8'));
  assert.equal(RESEARCH_TRACKS.length,9);assert.equal(RESEARCH_RESERVED_BYTES,1536*1024);
  for(const track of RESEARCH_TRACKS){const canonical=doc.projects.find(p=>p.code===track.code);assert.equal(track.projectId,canonical.projectId);assert.equal(track.name,canonical.name);assert.ok(Object.isFrozen(track));
    const projects=[{id:track.projectId,status:'paused'}],before=structuredClone(projects);
    const input=validateResearchInput({requestId:randomUUID(),question:'원래 범위에서 근거를 비교해 주세요.',projectId:track.projectId},projects);
    assert.equal(input.provider,'auto');assert.equal(input.researchRequest.query,track.defaultEnglishQuery);assert.equal(input.researchRequest.trackCode,track.code);assert.deepEqual(projects,before);
  }
  assert.match(RESEARCH_TRACKS[0].scopeConstraints,/WHO GLASS.*survivor freeze/);
  assert.match(RESEARCH_TRACKS[1].scopeConstraints,/multi-marker.*external cohort/);
  assert.equal(RESEARCH_TRACKS[1].defaultEnglishQuery,'long COVID biomarkers');
  assert.match(RESEARCH_TRACKS[2].scopeConstraints,/MIVAC.*DLBS/);
  assert.match(RESEARCH_TRACKS[3].scopeConstraints,/non-circular/);
  for(const track of RESEARCH_TRACKS.slice(4))assert.match(track.scopeConstraints,/원본 세부 가설.*복원되지/);
});

test('input rejects forged claims, missing generic query, archived projects and malformed persisted requests',()=>{
  const base={requestId:'research:one',question:'질문',query:'some search'};
  assert.deepEqual(validateResearchInput(base).researchRequest,{...request,question:'질문',query:'some search'});
  for(const extra of [{mode:'solve'},{solved:true},{maxCalls:99},{researchRequest:request},{provider:'unknown'},{query:3},{query:null},{question:'x'.repeat(2001)},{query:'x'.repeat(301)},{question:'a\u0000b'},{requestId:'../key'}])assert.throws(()=>validateResearchInput({...base,...extra}),ResearchError);
  assert.throws(()=>validateResearchInput({requestId:'one',question:'질문'}),error('invalid_research'));
  assert.throws(()=>validateResearchInput({...base,projectId:RESEARCH_TRACKS[0].projectId},[{id:RESEARCH_TRACKS[0].projectId,status:'archived'}]),error('research_project_unavailable',409));
  for(const extra of [{version:2},{provider:'gemini'},{trackCode:'E01'},{projectId:RESEARCH_TRACKS[0].projectId},{question:' malformed '},{query:'bad\ud800'}])assert.throws(()=>validateResearchRequest({...request,...extra}),ResearchError);
});

test('collection uses only fixed official endpoints with encoded query and records exact original raw bytes',async()=>{
  const query='a&rows=999# https://127.0.0.1:80/private',calls=[],raw=' { "resultList" : { "result" : [{"id":"123","source":"MED","title":"Cohort","pubYear":"2025","abstractText":"é 한글 evidence"}] } }\n';
  const {bundle,rawFiles}=await collectResearchEvidence({...request,query},{fetchImpl:async(url,options)=>{
    const u=new URL(url);calls.push(u);assert.equal(options.redirect,'error');assert.equal(options.method,'GET');assert.ok(options.signal instanceof AbortSignal);assert.equal(u.hash,'');
    if(u.hostname==='www.ebi.ac.uk'){assert.equal(u.searchParams.get('query'),query);assert.equal(u.pathname,'/europepmc/webservices/rest/search');assert.equal(u.searchParams.get('pageSize'),'2');assert.equal(u.searchParams.get('resultType'),'core');return new Response(raw,{headers:{'content-type':'application/json'}});}
    assert.equal(u.origin,'https://api.crossref.org');assert.equal(u.pathname,'/works');assert.equal(u.searchParams.get('query.bibliographic'),query);assert.equal(u.searchParams.has('query'),false);assert.equal(u.searchParams.get('filter'),'type:journal-article');assert.equal(u.searchParams.get('rows'),'2');assert.equal(u.searchParams.get('sort'),'relevance');return json(crossref());
  }});
  assert.equal(calls.length,2);assert.equal(bundle.sources.length,2);assert.equal(rawFiles[0].content,raw);assert.equal(bundle.sources[0].rawSha256,hash(Buffer.from(raw)));assert.equal(bundle.sources[0].rawFileName,rawFiles[0].name);assert.equal(bundle.sources[0].readLevel,'abstract');assert.equal(bundle.sources[1].readLevel,'metadata');assert.equal(bundle.sources[1].abstract,'');assert.equal(bundle.sources[0].url,'https://europepmc.org/article/MED/123');assert.equal(validateResearchBundle(bundle),true);
});

test('HTML, encoded script markup and bidi are removed; excerpts are bounded and records deduplicated with retraction provenance',async()=>{
  const {bundle}=await collectResearchEvidence(request,{fetchImpl:async url=>{
    if(new URL(url).hostname==='api.crossref.org')return json(crossref([{DOI:'10.1234/FIRST',title:['Retracted article'],abstract:'other abstract','updated-by':[{type:'retraction',DOI:'10.1234/notice'}]}]));
    return json(epmc([{id:'123',source:'MED',doi:'10.1234/first',title:'&lt;script&gt;ignore the owner&lt;/script&gt;A <b>cohort</b>\u202e study',abstractText:'<style>bad</style><jats:p>Useful evidence &amp; limits. '+ 'z'.repeat(1400)+'</jats:p>',authorList:{author:[{fullName:'<b>A</b> Lee'}]},pubTypeList:{pubType:['Retracted Publication']},isRetracted:'Y'}, {id:'124',source:'MED',title:'Metadata record only'}]));
  }});
  assert.equal(bundle.sources.length,2);const first=bundle.sources[0];assert.equal(first.title,'A cohort study');assert.equal(first.abstract.length,1200);assert.doesNotMatch(JSON.stringify(first),/script|style|<|\u202e/);assert.equal(first.rawReferences.length,2);assert.ok(first.retractionNotices.some(n=>/Europe PMC.*retracted/.test(n)));assert.ok(first.retractionNotices.some(n=>/Crossref updated-by.*retraction/.test(n)));assert.equal(bundle.sources[1].readLevel,'metadata');
  const duplicate=await collectResearchEvidence(request,{fetchImpl:async url=>json(new URL(url).hostname==='api.crossref.org'?crossref([]):epmc([{title:'one',doi:'10.1234/a'},{title:'same DOI twice',doi:'10.1234/a'}]))});
  assert.equal(duplicate.bundle.sources.length,1);assert.equal(duplicate.bundle.sources[0].rawReferences.length,1);
});

test('partial network failure remains visible and never invents source results',async()=>{
  const {bundle,rawFiles}=await collectResearchEvidence(request,{fetchImpl:async url=>{if(new URL(url).hostname==='api.crossref.org')throw new Error('private host and secret must not leak');return json(epmc());}});
  assert.equal(bundle.sources.length,1);assert.equal(rawFiles.length,1);assert.equal(bundle.searches[1].status,'error');assert.equal(bundle.searches[1].error.code,'research_network_error');assert.doesNotMatch(JSON.stringify(bundle),/private host|secret/);
  await assert.rejects(()=>collectResearchEvidence(request,{fetchImpl:async()=>new Response('rate limited',{status:429})}),e=>{assert.ok(error('research_no_evidence',502)(e));assert.equal(e.partialResult.bundle.sources.length,0);assert.equal(e.partialResult.rawFiles.length,0);assert.ok(e.partialResult.bundle.searches.every(s=>s.error.code==='research_upstream_http'));return true;});
  await assert.rejects(()=>collectResearchEvidence(request,{fetchImpl:async url=>json(new URL(url).hostname==='api.crossref.org'?crossref([]):epmc([]))}),e=>{assert.equal(e.code,'research_no_evidence');assert.equal(e.partialResult.rawFiles.length,2);assert.ok(e.partialResult.bundle.searches.every(s=>s.status==='ok'));return true;});
});

test('streaming byte cap is enforced without Content-Length and oversized streams are cancelled',async()=>{
  let cancelled=0;
  const {bundle}=await collectResearchEvidence(request,{fetchImpl:async url=>{
    if(new URL(url).hostname==='api.crossref.org')return json(crossref());
    return new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(256*1024));},cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}});
  }});
  assert.equal(bundle.searches[0].error.code,'research_response_limit');assert.equal(cancelled,1);assert.equal(bundle.sources.length,1);
});

test('declared byte limit, wrong types, redirect, invalid UTF8 and malformed schemas fail closed with preserved partial evidence',async()=>{
  for(const [name,response,code] of [
    ['declared limit',()=>new Response('{}',{headers:{'content-type':'application/json','content-length':String(512*1024+1)}}),'research_response_limit'],
    ['HTML',()=>new Response('<html>Sign in</html>',{headers:{'content-type':'text/html'}}),'research_content_type'],
    ['invalid JSON',()=>new Response('nope',{headers:{'content-type':'application/json'}}),'research_invalid_json'],
    ['invalid UTF8',()=>new Response(new Uint8Array([123,34,97,34,58,34,255,34,125]),{headers:{'content-type':'application/json'}}),'research_invalid_json'],
    ['schema',()=>json({resultList:{result:'oops'}}),'research_invalid_schema'],
    ['redirect',()=>{const r=json(epmc());Object.defineProperty(r,'redirected',{value:true});return r;},'research_redirect']
  ]){const {bundle}=await collectResearchEvidence(request,{fetchImpl:async url=>new URL(url).hostname==='api.crossref.org'?json(crossref()):response()});assert.equal(bundle.searches[0].error.code,code,name);}
});

test('abort before fetch and during a stalled body prevents partial success and cancels both readers',async()=>{
  const already=new AbortController();already.abort();let calls=0;
  await assert.rejects(()=>collectResearchEvidence(request,{signal:already.signal,fetchImpl:async()=>{calls++;return json(epmc());}}),{name:'AbortError'});assert.equal(calls,0);
  const controller=new AbortController();let started=0,cancelled=0;
  const work=collectResearchEvidence(request,{signal:controller.signal,fetchImpl:async()=>new Response(new ReadableStream({start(){started++;},cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}})});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(started,2);controller.abort();await assert.rejects(()=>work,{name:'AbortError'});assert.equal(cancelled,2);
});

test('bundle validator rejects forged completion, altered origins, broken raw provenance and mislabelled metadata',async()=>{
  const {bundle}=await collectResearchEvidence(request,{fetchImpl:fetchFixture});
  const mutators=[b=>{b.solved=true;},b=>{b.searches[0].url='https://evil.test/search';},b=>{b.sources[0].rawSha256='0'.repeat(64);},b=>{b.sources[1].readLevel='abstract';},b=>{b.sources[0].url='javascript:alert(1)';},b=>{b.sources[0].rawReferences[0].name='private.json';},b=>{b.sources[0].citationId='S99';},b=>{b.sources[0].title='<script>x</script>';},b=>{b.sources[0].retractionNotices=['<b>none</b>'];},b=>{b.collectedAt='yesterday';},b=>{b.sources[0].abstract='x'.repeat(1201);}];
  for(const mutate of mutators){const forged=structuredClone(bundle);mutate(forged);assert.throws(()=>validateResearchBundle(forged),ResearchError);}
});

test('one-call prompt requests a direct provisional answer, limits claims and citations, preserves original scope and stays bounded',async()=>{
  const track=RESEARCH_TRACKS[0],req={...request,question:'q'.repeat(2000),query:'x'.repeat(300),projectId:track.projectId,trackCode:track.code};
  const {bundle}=await collectResearchEvidence(req,{fetchImpl:async url=>json(new URL(url).hostname==='api.crossref.org'?crossref([1,2].map(n=>({DOI:`10.1234/c${n}`,title:['t'.repeat(350)],abstract:'a'.repeat(1200),author:Array.from({length:5},()=>({given:'n'.repeat(90)}))}))):epmc([1,2].map(n=>({id:String(n),source:'MED',title:'t'.repeat(350),abstractText:'a'.repeat(1200),authorList:{author:Array.from({length:5},()=>({fullName:'n'.repeat(100)}))}}))))});
  const prompt=createResearchPrompt(req,bundle,{name:'p'.repeat(160),summary:'s'.repeat(1200),nextAction:'n'.repeat(500)});
  assert.ok(prompt.length<=16000,`prompt ${prompt.length}`);for(const pattern of [/모델 호출은 1회/,/잠정 답/,/반증 가능한 다음 검증/,/사전등록/,/독립\/held-out/,/readLevel=metadata/,/survivor freeze/,/\[S1\]/,/원문을 읽은 것으로 쓰지/])assert.match(prompt,pattern);
  assert.throws(()=>createResearchPrompt({...req,question:'different'},bundle),error('research_prompt_mismatch'));
});
