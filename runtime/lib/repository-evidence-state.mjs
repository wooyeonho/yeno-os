import {createHash} from 'node:crypto';

export const EVIDENCE_MAX_BYTES=65536;
export const initialRepositoryEvidence=()=>({version:1,dailyCallLimit:20,days:[],records:[]});
export const evidenceHash=value=>createHash('sha256').update(value).digest('hex');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const check=v=>{if(!v)throw Error('Invalid repository evidence');};
const iso=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v));
const safe=v=>typeof v==='string'&&v.length>0&&v.length<=255&&!/[\x00-\x1f\x7f]/.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function parseGithubRepo(value){
 try{const url=new URL(value);if(url.protocol!=='https:'||url.hostname!=='github.com'||url.port||url.username||url.password)return null;
 const [owner,raw]=url.pathname.slice(1).split('/');const repo=raw?.replace(/\.git$/i,'');
 if(!/^[a-z\d][a-z\d-]{0,38}$/i.test(owner??'')||!/^[-\w.]{1,100}$/.test(repo??'')||['.','..'].includes(repo))return null;
 return `${owner}/${repo}`.toLowerCase();}catch{return null;}
}
export const evidenceId=(repo,synthetic)=>evidenceHash(JSON.stringify([1,repo,synthetic]));
export function evidenceEndpoint(value){
 try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='api.github.com'&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash
 &&(/^\/repositories\/\d+$/.test(u.pathname)||/^\/repos\/[a-z\d-]+\/[-\w.]+(?:\/git\/ref\/heads\/[^?#]+)?$/i.test(u.pathname));}catch{return false;}
}
export function licensePolicy(id){
 if(['MIT','Apache-2.0','BSD-2-Clause','BSD-3-Clause','ISC'].includes(id))return 'allowed';
 return /^(?:A?GPL|LGPL)-/.test(id??'')?'separate_process_only':'unreviewed';
}
export function repoMetadata(json,repo){
 check(json&&json.full_name?.toLowerCase()===repo&&json.owner?.login?.toLowerCase()===repo.split('/')[0]
 &&json.name?.toLowerCase()===repo.split('/')[1]&&json.private===false&&typeof json.archived==='boolean'&&typeof json.disabled==='boolean');
 check(safe(json.default_branch)&&Number.isSafeInteger(json.stargazers_count)&&json.stargazers_count>=0);
 const license=json.license?.spdx_id??null;check(license===null||(typeof license==='string'&&/^[A-Za-z\d.+-]{1,64}$/.test(license)));
 check(json.pushed_at===null||(typeof json.pushed_at==='string'&&Number.isFinite(Date.parse(json.pushed_at))));
 return {repo,license,archived:json.archived,disabled:json.disabled,defaultBranch:json.default_branch,
 pushedAt:json.pushed_at===null?null:new Date(json.pushed_at).toISOString(),stars:json.stargazers_count,licensePolicy:licensePolicy(license),official:null};
}
export function observeRepository(metadata,reference,repo,at){
 const m=repoMetadata(metadata,repo);check(reference?.ref===`refs/heads/${m.defaultBranch}`&&reference.object?.type==='commit'&&/^[a-f0-9]{40}$/.test(reference.object.sha));
 return {...m,commit:reference.object.sha,observedAt:at};
}
export const evidenceReason=o=>o.archived?'repository_archived':o.disabled?'repository_disabled':o.licensePolicy==='separate_process_only'?'license_separate_process_only':o.licensePolicy!=='allowed'?'license_missing_or_unreviewed':null;
export function receiptJson(c){const bytes=Buffer.from(c.bodyBase64,'base64');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
export function validateRepositoryEvidence(value){
 check(exact(value,['version','dailyCallLimit','days','records'])&&value.version===1&&Number.isSafeInteger(value.dailyCallLimit)&&value.dailyCallLimit>=1&&value.dailyCallLimit<=20);
 check(Array.isArray(value.records)&&value.records.length<=128&&Array.isArray(value.days));const ids=new Set(),days=new Map();
 for(const r of value.records){
  check(exact(r,['id','repo','synthetic','startedAt','finishedAt','status','reason','calls','observation','authorizesDispatch']));
  check(parseGithubRepo(`https://github.com/${r.repo}`)===r.repo&&typeof r.synthetic==='boolean'&&r.id===evidenceId(r.repo,r.synthetic)&&!ids.has(r.id));ids.add(r.id);
  check(iso(r.startedAt)&&(r.finishedAt===null||iso(r.finishedAt))&&r.authorizesDispatch===false);
  check(['reserved','verified','excluded','evidence_unavailable','unknown'].includes(r.status)&&(r.reason===null||safe(r.reason)));
  check((r.status==='reserved')===(r.finishedAt===null));check(Array.isArray(r.calls)&&r.calls.length<=6);
  for(const c of r.calls){
   check(exact(c,['kind','sourceUrl','startedAt','fetchedAt','status','httpStatus','sha256','bodyBase64']));
   check(['repo','head'].includes(c.kind)&&evidenceEndpoint(c.sourceUrl)&&iso(c.startedAt)&&(c.fetchedAt===null||iso(c.fetchedAt)));
   check(['reserved','settled','unknown'].includes(c.status)&&(c.httpStatus===null||(Number.isInteger(c.httpStatus)&&c.httpStatus>=100&&c.httpStatus<=599)));
   if(c.bodyBase64!==null){check(typeof c.bodyBase64==='string'&&c.bodyBase64.length<=Math.ceil(EVIDENCE_MAX_BYTES/3)*4);const bytes=Buffer.from(c.bodyBase64,'base64');check(bytes.length<=EVIDENCE_MAX_BYTES&&bytes.toString('base64')===c.bodyBase64&&hash(c.sha256)&&evidenceHash(bytes)===c.sha256&&iso(c.fetchedAt)&&c.httpStatus===200);receiptJson(c);}
   else check(c.sha256===null);
   const d=c.startedAt.slice(0,10);days.set(d,(days.get(d)??0)+1);
  }
  if(r.observation!==null){
   check(['verified','excluded'].includes(r.status));const repo=r.calls.findLast(c=>c.kind==='repo'&&c.bodyBase64!==null),head=r.calls.findLast(c=>c.kind==='head'&&c.bodyBase64!==null);check(repo&&head);
   const repoJson=receiptJson(repo),repoPath=new URL(repo.sourceUrl).pathname;
   check(repoPath.toLowerCase()===`/repos/${r.repo}`||(/^\/repositories\/\d+$/.test(repoPath)&&String(repoJson.id)===repoPath.split('/').at(-1)));
   const expected=observeRepository(repoJson,receiptJson(head),r.repo,r.finishedAt);
   check(head.sourceUrl===`https://api.github.com/repos/${r.repo}/git/ref/heads/${encodeURIComponent(expected.defaultBranch)}`);
   check(JSON.stringify(r.observation)===JSON.stringify(expected)&&r.reason===evidenceReason(expected)&&r.status===(r.reason?'excluded':'verified'));
  }else check(!['verified','excluded'].includes(r.status));
 }
 check(value.days.length===days.size&&new Set(value.days.map(d=>d.day)).size===value.days.length);
 for(const d of value.days)check(exact(d,['day','calls'])&&d.calls===days.get(d.day)&&d.calls<=value.dailyCallLimit);
 return true;
}

export function candidateEvidenceFields(record){
 if(!record?.observation||!['verified','excluded'].includes(record.status))return null;
 const o=record.observation,head=record.calls.findLast(c=>c.kind==='head'&&c.bodyBase64!==null);
 return {license:o.license,commit:o.commit,lastCommit:o.pushedAt,stars:o.stars,evidenceUrl:head.sourceUrl,official:null,
  repositoryEvidence:{id:record.id,status:record.status,reason:record.reason}};
}
export function validateRepositoryEvidenceLinks(state){
 validateRepositoryEvidence(state.repositoryEvidence);
 for(const search of state.gapScout.searches)for(const candidate of search.report?.candidates??[]){
  if(!candidate.repositoryEvidence)continue;
  const record=state.repositoryEvidence.records.find(r=>r.id===candidate.repositoryEvidence.id);
  check(record&&record.synthetic===search.synthetic&&record.repo===parseGithubRepo(candidate.url));
  const fields=candidateEvidenceFields(record);check(fields);
  for(const [key,value] of Object.entries(fields))check(JSON.stringify(candidate[key])===JSON.stringify(value));
  // This verifier never certifies usefulness or product officialness.
  check(candidate.useful===null);
 }
 return true;
}
