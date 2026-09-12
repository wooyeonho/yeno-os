import {validateResearchBundle} from './research.mjs';
import {FORAI_MAX_BYTES,validateForAiInput} from './forai.mjs';
import {validateVideoInput} from './video.mjs';

// Deterministic derivatives of already verified research artifacts. The caller
// must verify job completion and the artifact hashes before passing their bytes.
// No network, model, publication, arbitrary HTML rendering or experiment runs.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DRAFT_SCOPE='검증 전 연구 초안입니다. 공개 검색 최대4건의 초록 발췌·서지정보만 확인했으며 원문·원자료 분석·실험·독립 검증은 수행하지 않았습니다. 검색 일치는 과학적 결론의 입증이 아닙니다.';
const clean=value=>String(value??'').toWellFormed().normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu,' ');
const line=value=>clean(value).replace(/\s+/gu,' ').trim();
const escapeHtml=value=>clean(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function clip(value,max){
  const text=line(value);if(text.length<=max)return text;
  let part=text.slice(0,max-1);if(/[\ud800-\udbff]$/.test(part))part=part.slice(0,-1);
  return part.trimEnd()+'…';
}
function checked(job,bundle,answer){
  validateResearchBundle(bundle);
  if(!job||!UUID.test(job.id)||typeof answer!=='string'||!answer.trim()||!bundle.sources.length)throw new Error('Verified research job, evidence and answer are required.');
  if(job.researchRequest&&['question','query','projectId','trackCode'].some(key=>job.researchRequest[key]!==bundle[key]))throw new Error('Research derivative scope mismatch.');
}
function csvCell(value){
  let text=clean(value);
  // Quote every field, and make formula-looking cells explicit text. Leading
  // tab/newline also triggers spreadsheet interpretation in some importers.
  if(/^[\t\r\n]/u.test(text)||/^[\s]*[=+\-@]/u.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
export function researchEvidenceCsv(bundle){
  validateResearchBundle(bundle);
  const header=['citation_id','title','year','doi','url','read_level','provider','raw_sha256','authors','abstract_excerpt','retraction_notices','raw_references','question','query','track_code','collected_at','scope'];
  const rows=bundle.sources.map(s=>[s.citationId,s.title,s.year??'',s.doi??'',s.url,s.readLevel,s.provider,s.rawSha256,s.authors.join('; '),s.abstract,s.retractionNotices.join('; '),JSON.stringify(s.rawReferences),bundle.question,bundle.query,bundle.trackCode??'',bundle.collectedAt,s.scope]);
  return '\ufeff'+[header,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}

export function researchForAiInput(job,bundle,answer){
  checked(job,bundle,answer);
  const title=clip(`검증 전 연구 노트 · ${bundle.trackCode??'문제의 답'} · ${bundle.question}`,160);
  const description='비공개 연구 초안의 문서 구조 점검용 HTML. 출처·열람 범위·미실행 검증을 보존하며 외부 발행과 검색 순위 개선은 수행하지 않습니다.';
  const jsonLd=JSON.stringify({'@context':'https://schema.org','@type':'ResearchArticle',headline:title,description:DRAFT_SCOPE,inLanguage:'ko',creativeWorkStatus:'Research draft; not independently validated',citation:bundle.sources.map(s=>({'@type':'CreativeWork',name:s.title,url:s.url,description:s.readLevel==='abstract'?'초록 최대1200자 발췌만 확인':'제목·서지정보만 확인'}))})
    .replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const sources=bundle.sources.map(s=>`<li><h3>${escapeHtml(s.citationId)} · ${escapeHtml(s.title)}</h3><p>${escapeHtml(s.provider)} · ${escapeHtml(s.year??'연도 미확인')} · ${s.readLevel==='abstract'?'초록 발췌 최대1200자':'제목·서지정보만 확인'}</p><p>출처: <a href="${escapeHtml(s.url)}" rel="noreferrer noopener">${escapeHtml(s.url)}</a></p><p>원 응답 SHA-256: ${escapeHtml(s.rawSha256)}</p>${s.retractionNotices.length?`<p>정정·철회 관련 표시: ${escapeHtml(s.retractionNotices.join('; '))}</p>`:''}</li>`).join('\n');
  const searches=bundle.searches.map(s=>`${s.provider}: ${s.status==='ok'?`검색 결과 ${s.resultCount}건`:'검색 실패'}`).join(' / ');
  const prefix=`<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><script type="application/ld+json">${jsonLd}</script></head><body><article><h1>${escapeHtml(title)}</h1><p>${escapeHtml(DRAFT_SCOPE)}</p><p>외부 게시하지 않은 비공개 문서 구조 점검용 파생본입니다. Markdown 본문은 실행하지 않고 텍스트로 표시합니다.</p><h2>질문</h2><p>${escapeHtml(bundle.question)}</p><p>근거 수집: ${escapeHtml(bundle.collectedAt)} · ${escapeHtml(searches)} · 원 작업 ${escapeHtml(job.id)}</p><h2>실제로 확인한 문헌</h2><ul>${sources}</ul><h2>AI 연구 답안 · 검증 전</h2>`;
  const suffix='</article></body></html>';
  const text=clean(answer),wrap=value=>'<pre>'+escapeHtml(value)+'</pre>';
  let content=prefix+wrap(text)+suffix;
  if(Buffer.byteLength(content,'utf8')>FORAI_MAX_BYTES){
    const notice='<p>64KiB 점검 한도 때문에 아래 답안은 앞부분 발췌입니다. 잘린 문장을 근거로 판단하지 말고 원 작업의 전체 답안·근거 파일을 확인하세요.</p>';
    let low=0,high=text.length;
    while(low<high){const mid=Math.ceil((low+high)/2);let part=text.slice(0,mid);if(/[\ud800-\udbff]$/.test(part))part=part.slice(0,-1);if(Buffer.byteLength(prefix+notice+wrap(part)+suffix,'utf8')<=FORAI_MAX_BYTES)low=mid;else high=mid-1;}
    let excerpt=text.slice(0,low);if(/[\ud800-\udbff]$/.test(excerpt))excerpt=excerpt.slice(0,-1);
    content=prefix+notice+wrap(excerpt)+suffix;
  }
  return validateForAiInput({mode:'html',content});
}

// The installed Korean raster font is guaranteed for Hangul/basic Latin, not
// arbitrary emoji or supplementary mathematical glyphs. Titles are excerpts;
// the complete unmodified evidence remains in the CSV and original artifacts.
const cardText=(value,max)=>clip(line(value).normalize('NFKC').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[—–]/g,'-').replace(/…/g,'...').replace(/[^\u0020-\u007e\u00b7\u3130-\u318f\uac00-\ud7a3]/gu,' '),max).replace(/…/g,'...');
export function researchVideoInput(job,bundle,answer){
  checked(job,bundle,answer);
  const label=cardText(bundle.trackCode??'문제의 답',16),sources=bundle.sources;
  const scenes=[{heading:`${label} 연구 질문`,body:cardText('질문 발췌: '+bundle.question,165),seconds:5}];
  for(const source of sources.slice(0,2)){
    const provider=source.provider==='europepmc'?'Europe PMC':'Crossref';
    const level=source.readLevel==='abstract'?'초록 일부 확인':'제목·서지정보만 확인';
    scenes.push({heading:`${source.citationId} · ${provider} · ${source.year??'연도 미확인'}`,body:cardText(`${level}. 문헌 제목 발췌: ${source.title}`,165),seconds:5});
  }
  scenes.push({heading:'AI 검증 제안 · 미실행',body:'원 작업에 잠정 답과 다음 검증 제안을 보관했습니다. 실제 데이터 확보·가설 동결·독립 검증은 아직 수행하지 않았습니다.',seconds:5});
  scenes.push({heading:'검증 전 연구 노트',body:`전체 근거 ${sources.length}건. 이 영상은 질문과 문헌 목록 안내입니다. 전체 답안·원 응답·출처는 연구 작업에서 확인하세요. 효과·난제 해결을 입증한 영상이 아닙니다.`,seconds:5});
  return validateVideoInput({title:cardText(`BLACKHOLE ${label} 검증 전 연구 노트`,58),scenes});
}
