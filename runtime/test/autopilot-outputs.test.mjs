import test from 'node:test';
import assert from 'node:assert/strict';
import {researchEvidenceCsv,researchForAiInput,researchVideoInput} from '../lib/autopilot-outputs.mjs';
import {collectResearchEvidence} from '../lib/research.mjs';
import {validateForAiInput,FORAI_MAX_BYTES} from '../lib/forai.mjs';
import {validateVideoInput} from '../lib/video.mjs';

const request={version:1,question:'어떤 독립 검증이 필요한가?',query:'long COVID biomarkers',projectId:null,trackCode:null};
const job={id:'2fe32fcc-163f-466a-8f1e-aa0b8d96b1d0',researchRequest:request};
const answer='## 잠정 답\n현재 근거로 임상 효과를 판단할 수 없습니다. [S1]\n## 다음 검증 제안\n독립 코호트를 확보하고 분석 계획을 먼저 동결합니다. 실제 검증은 미실행입니다.';
async function fixture(extra={}){
  const req={...request,...extra};
  const {bundle}=await collectResearchEvidence(req,{clock:()=>Date.parse('2026-09-12T18:00:00.000Z'),fetchImpl:async url=>new Response(JSON.stringify(new URL(url).hostname==='api.crossref.org'?{message:{items:[{DOI:'10.1234/second',title:['External cohort metadata'],published:{'date-parts':[[2024]]}}]}}:{resultList:{result:[{id:'123',source:'MED',doi:'10.1234/first',title:'Biomarkers & "validation", cohort',pubYear:'2025',abstractText:'Research evidence only. Full text was not reviewed.',authorList:{author:[{fullName:'Lee A'}]}}]}}),{headers:{'content-type':'application/json'}})});
  return bundle;
}
function parseCsv(input){
  const rows=[],row=[];let cell='',quoted=false;
  for(let i=1;i<input.length;i++){const c=input[i];if(c==='"'){if(quoted&&input[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(!quoted&&c===','){row.push(cell);cell='';}else if(!quoted&&c==='\r'&&input[i+1]==='\n'){row.push(cell);rows.push([...row]);row.length=0;cell='';i++;}else cell+=c;}
  return rows;
}

test('evidence CSV round-trips quotes, commas, provenance and neutralizes spreadsheet formulas',async()=>{
  const bundle=await fixture({question:'=HYPERLINK("https://example.org","click")',query:'+SUM(1,2)'});
  bundle.sources[0].title='-1+2';bundle.sources[0].authors=['@SUM(1,2)'];
  const csv=researchEvidenceCsv(bundle),rows=parseCsv(csv),columns=Object.fromEntries(rows[0].map((v,i)=>[v,i]));
  assert.equal(rows.length,3);assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.endsWith('\r\n'));
  for(const field of ['title','authors','question','query'])assert.ok(rows[1][columns[field]].startsWith("'"),field);
  assert.equal(rows[1][columns.question].slice(1),bundle.question);assert.equal(rows[1][columns.raw_sha256],bundle.sources[0].rawSha256);
  assert.deepEqual(JSON.parse(rows[1][columns.raw_references]),bundle.sources[0].rawReferences);
  const normal=parseCsv(researchEvidenceCsv(await fixture()));assert.equal(normal[1][columns.title],'Biomarkers & "validation", cohort');
  for(const question of ['\t=SUM(1,2)','\n@SUM(1,2)','\r+SUM(1,2)'])assert.throws(()=>researchEvidenceCsv({...bundle,question}));
});

test('private For-Ai article escapes answer/question markup and safely serializes JSON-LD',async()=>{
  const bundle=await fixture({question:'</script><img src=x onerror="alert(1)"> 근거 & 한계?'});
  const hostile=answer+'\n<script>send(secret)</script>\n<img src="https://example.org/pixel">\n\u202e\u0000bad\ud800';
  const input=researchForAiInput({...job,researchRequest:{...request,question:bundle.question}},bundle,hostile);
  assert.deepEqual(validateForAiInput(input),input);assert.equal(input.mode,'html');assert.equal(input.url,undefined);assert.equal(input.profile,undefined);
  assert.equal((input.content.match(/<script\b/g)||[]).length,1);assert.equal((input.content.match(/<\/script>/g)||[]).length,1);
  assert.doesNotMatch(input.content,/<img\b|\u202e|\u0000|rel="canonical"|<script>send/);
  assert.match(input.content,/&lt;script&gt;send\(secret\)&lt;\/script&gt;/);
  const jsonLd=JSON.parse(input.content.match(/<script type="application\/ld\+json">([^]*?)<\/script>/)[1]);
  assert.equal(jsonLd['@type'],'ResearchArticle');assert.equal(jsonLd.author,undefined);assert.equal(jsonLd.url,undefined);assert.equal(jsonLd.datePublished,undefined);
  assert.equal(jsonLd.citation.length,bundle.sources.length);assert.match(jsonLd.creativeWorkStatus,/draft/);assert.ok(input.content.isWellFormed());
  assert.match(input.content,/noindex,nofollow/);assert.match(input.content,/외부 게시하지 않은/);
});

test('For-Ai derivative bounds escaped UTF-8 bytes and visibly labels truncated answers',async()=>{
  const bundle=await fixture(),long='한글🧪<&"\' 연구 문장\n'.repeat(10000);
  const input=researchForAiInput(job,bundle,long);
  assert.ok(Buffer.byteLength(input.content,'utf8')<=FORAI_MAX_BYTES);assert.ok(Buffer.byteLength(input.content,'utf8')>60000);
  assert.ok(input.content.isWellFormed());assert.match(input.content,/64KiB 점검 한도/);assert.match(input.content,/원 작업의 전체 답안/);assert.ok(input.content.endsWith('</article></body></html>'));
  for(const source of bundle.sources)assert.ok(input.content.includes(source.rawSha256));
});

test('video is deterministic Korean evidence overview with clear unexecuted validation and no answer claim extraction',async()=>{
  const bundle=await fixture(),input=researchVideoInput(job,bundle,answer+'\n기적의 치료가 입증되었다.');
  assert.deepEqual(validateVideoInput(input),input);assert.deepEqual(researchVideoInput(job,bundle,answer),input);
  assert.ok(input.scenes.length<=6);const seconds=input.scenes.reduce((sum,s)=>sum+s.seconds,0);assert.ok(seconds>=18&&seconds<=30);
  assert.ok(input.scenes.some(s=>s.heading.includes('S1')&&s.heading.includes('Europe PMC')));assert.ok(input.scenes.some(s=>s.heading.includes('S2')&&s.heading.includes('Crossref')));
  assert.match(JSON.stringify(input),/제목·서지정보만 확인/);assert.match(JSON.stringify(input),/AI 검증 제안 · 미실행/);assert.doesNotMatch(JSON.stringify(input),/기적의 치료/);
  for(const scene of input.scenes){assert.ok(scene.heading.length<=70);assert.ok(scene.body.length<=180);}
  const odd=await fixture({question:'emoji 🧪 악성\u202e문자\ud800 '+ '긴질문'.repeat(300)}).catch(()=>null);
  assert.equal(odd,null,'upstream evidence validator rejects malformed source questions');
  const unicode=await fixture({question:'한글 emoji 🧪 '+ '긴질문'.repeat(300)});
  const sanitized=researchVideoInput({...job,researchRequest:{...request,question:unicode.question}},unicode,answer+'\ud800');
  assert.deepEqual(validateVideoInput(sanitized),sanitized);assert.doesNotMatch(JSON.stringify(sanitized),/🧪|\u202e|\ud800/);
});

test('derivatives reject missing answer, mismatched scope and forged raw provenance',async()=>{
  const bundle=await fixture();for(const output of [researchForAiInput,researchVideoInput]){
    assert.throws(()=>output(job,bundle,''));assert.throws(()=>output({...job,id:'wrong'},bundle,answer));
    assert.throws(()=>output({...job,researchRequest:{...request,question:'다른 질문'}},bundle,answer));
  }
  const invalid=structuredClone(bundle);invalid.sources[0].rawSha256='0'.repeat(64);
  assert.throws(()=>researchEvidenceCsv(invalid));assert.throws(()=>researchForAiInput(job,invalid,answer));assert.throws(()=>researchVideoInput(job,invalid,answer));
});
