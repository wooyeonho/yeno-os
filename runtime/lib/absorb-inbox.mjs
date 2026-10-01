import {exact,hash,isHash,iso,text,check,validateCandidate,publicUrl} from './gap-state.mjs';
import {assertNoSecrets} from './jev.mjs';
import {METRICS} from './outcome-verification.mjs';
import {validateExchangePacket} from './capability-exchange.mjs';
import {editablePath,sha256} from './repository-patch.mjs';
export const ABSORB_KINDS=Object.freeze(['research-draft','local-document','ledger-tool','self-beautification','reference-claim','experiment','content-draft','exchanged-capability','self-change-proposal']);
const common=['id','kind','createdAt','status','noAbility','synthetic','authorizesDispatch','payload'];
export function validateAbsorbInbox(inbox){
 check(exact(inbox,['version','entries'])&&inbox.version===1&&Array.isArray(inbox.entries)&&inbox.entries.length<=4000);
 const ids=new Set();
 for(const e of inbox.entries){
  check(exact(e,common)&&ABSORB_KINDS.includes(e.kind)&&iso(e.createdAt)&&e.authorizesDispatch===false&&typeof e.synthetic==='boolean');
  check(['draft','noAbility','rejected'].includes(e.status)&&(e.noAbility===null||text(e.noAbility,300))&&((e.status==='noAbility')===(e.noAbility!==null)));
  const p=e.payload;
  if(e.kind==='research-draft'){check(exact(p,['gapId','searchFingerprint','candidate'])&&isHash(p.gapId)&&isHash(p.searchFingerprint));validateCandidate(p.candidate);check(p.candidate.license!==null&&p.candidate.commit!==null&&p.candidate.evidenceUrl!==null);}
  if(e.kind==='local-document')check(exact(p,['artifactId','artifactSha256','summary'])&&text(p.artifactId,100)&&isHash(p.artifactSha256)&&text(p.summary,1000));
  if(e.kind==='ledger-tool')check(exact(p,['ledgerId','ledgerFingerprint','summary'])&&text(p.ledgerId,100)&&isHash(p.ledgerFingerprint)&&text(p.summary,1000));
  if(e.kind==='self-beautification')check(exact(p,['surface','evidenceSha256','finding'])&&text(p.surface,100)&&isHash(p.evidenceSha256)&&text(p.finding,1000));
  if(e.kind==='reference-claim')check(exact(p,['sourceUrl','claim','sharedReason','verificationStatus'])&&publicUrl(p.sourceUrl)&&text(p.claim,300)&&text(p.sharedReason,300)&&p.verificationStatus==='unverified');
  if(e.kind==='experiment')check(exact(p,['claimId','hypothesis','metric','sourceType','startAt','verificationStatus','observation'])&&isHash(p.claimId)&&text(p.hypothesis,300)&&Object.hasOwn(METRICS,p.metric)&&METRICS[p.metric].sources.includes(p.sourceType)&&iso(p.startAt)&&p.verificationStatus==='unverified'&&p.observation===null);
  if(e.kind==='content-draft')check(exact(p,['claimId','format','title','content','publicationStatus'])&&isHash(p.claimId)&&['card-news','article'].includes(p.format)&&text(p.title,200)&&text(p.content,3000)&&p.publicationStatus==='draft-only');
  if(e.kind==='exchanged-capability'){check(exact(p,['packet']));validateExchangePacket(p.packet);}
  if(e.kind==='self-change-proposal'){
   check(exact(p,['reasonRef','reason','taskSha256','patch','patchSha256','staticGuard','testEvidence']));
   check(text(p.reasonRef,300)&&text(p.reason,1000)&&isHash(p.taskSha256)&&isHash(p.patchSha256)&&p.staticGuard==='passed');
   check(exact(p.patch,['schema','baseCommit','changes'])&&p.patch.schema==='blackhole.repository-patch.v1'&&Array.isArray(p.patch.changes)&&p.patch.changes.length>0&&p.patch.changes.length<=4);
   check(p.patchSha256===sha256(JSON.stringify(p.patch)));
   for(const change of p.patch.changes){check(exact(change,['path','beforeSha256','content'])&&isHash(change.beforeSha256)&&typeof change.content==='string');editablePath(change.path);}
   check(exact(p.testEvidence,['contractId','isolation','exitCode','stdoutSha256','stderrSha256'])&&text(p.testEvidence.contractId,64)&&['docker-no-network','synthetic-test-adapter'].includes(p.testEvidence.isolation)&&p.testEvidence.exitCode===0&&isHash(p.testEvidence.stdoutSha256)&&isHash(p.testEvidence.stderrSha256));
  }
  check(e.id===hash([1,e.kind,e.synthetic,e.payload])&&!ids.has(e.id));ids.add(e.id);assertNoSecrets(e);
 }
 for(const e of inbox.entries)if(['experiment','content-draft'].includes(e.kind))check(inbox.entries.some(source=>source.id===e.payload.claimId&&source.kind==='reference-claim'));
 return true;
}
export function addAbsorbDraft(inbox,{kind,payload,at,synthetic=false}){
 validateAbsorbInbox(inbox);
 const id=hash([1,kind,synthetic,payload]);
 if(inbox.entries.some(e=>e.id===id))return {inbox,entry:inbox.entries.find(e=>e.id===id)};
 const entry={id,kind,createdAt:at,status:'draft',noAbility:null,synthetic,authorizesDispatch:false,payload:structuredClone(payload)};
 const next={version:1,entries:[...inbox.entries,entry]};validateAbsorbInbox(next);return {inbox:next,entry};
}
export function recordNoAbility(inbox,id,reason){
 validateAbsorbInbox(inbox);check(inbox.entries.some(e=>e.id===id));
 const next={version:1,entries:inbox.entries.map(e=>e.id===id?{...e,status:'noAbility',noAbility:reason}:e)};validateAbsorbInbox(next);return next;
}
// No promotion API. Only reviewed conversion to an existing executable manifest
// can enter import -> verify -> owner activate outside this draft-only module.
