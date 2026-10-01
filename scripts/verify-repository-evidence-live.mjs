import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {openStore} from '../runtime/lib/store.mjs';
import {createRepositoryEvidence} from '../runtime/lib/repository-evidence.mjs';
import {evidenceHash} from '../runtime/lib/repository-evidence-state.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'build-artifacts/g1-repository-evidence-20260930/live');fs.mkdirSync(output,{recursive:true});
const store=openStore(path.join(output,'isolated-state'));
const before=store.state.repositoryEvidence.records.reduce((n,r)=>n+r.calls.length,0);
const verifier=createRepositoryEvidence({state:store.state,save:store.save});
const results=[];
for(const repo of ['quantastica/quantum-circuit','rhasspy/piper']){
 const record=await verifier.verify(`https://github.com/${repo}`),receipts=[];
 for(const [i,c] of (record.calls??[]).entries())if(c.bodyBase64!==null){
  const name=`${repo.replace('/','--')}-${c.kind}-${i+1}.json`,bytes=Buffer.from(c.bodyBase64,'base64');
  if(evidenceHash(bytes)!==c.sha256)throw Error('Evidence hash mismatch');fs.writeFileSync(path.join(output,name),bytes);
  receipts.push({file:name,sourceUrl:c.sourceUrl,fetchedAt:c.fetchedAt,sha256:c.sha256});
 }
 results.push({repo,status:record.status,reason:record.reason,synthetic:record.synthetic,observation:record.observation,receipts,authorizesDispatch:false});
}
const after=store.state.repositoryEvidence.records.reduce((n,r)=>n+r.calls.length,0);
const report={executedAt:new Date().toISOString(),authenticated:false,searchProviderCalls:0,newMetadataHttpCalls:after-before,totalReservedMetadataCalls:after,results};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({newMetadataHttpCalls:after-before,results:results.map(r=>({repo:r.repo,status:r.status,reason:r.reason,observation:r.observation}))}));
