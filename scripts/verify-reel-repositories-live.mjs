import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openStore} from '../runtime/lib/store.mjs';
import {createRepositoryEvidence} from '../runtime/lib/repository-evidence.mjs';
import {evidenceHash} from '../runtime/lib/repository-evidence-state.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'build-artifacts','reel-absorption-20261001');
fs.mkdirSync(output,{recursive:true});
const store=openStore(path.join(output,'isolated-state'));
const verifier=createRepositoryEvidence({state:store.state,save:store.save});
const before=store.state.repositoryEvidence.records.reduce((sum,item)=>sum+item.calls.length,0);
const results=[];

for(const repo of ['Jakubantalik/thinking-orbs','Panniantong/Agent-Reach']){
  const record=await verifier.verify(`https://github.com/${repo}`);
  const receipts=[];
  for(const [index,call] of record.calls.entries()){
    if(call.bodyBase64===null)continue;
    const bytes=Buffer.from(call.bodyBase64,'base64');
    if(evidenceHash(bytes)!==call.sha256)throw new Error('repository_receipt_hash_mismatch');
    const file=`${repo.replace('/','--')}-${call.kind}-${index+1}.json`;
    fs.writeFileSync(path.join(output,file),bytes);
    receipts.push({file,sourceUrl:call.sourceUrl,fetchedAt:call.fetchedAt,sha256:call.sha256});
  }
  results.push({repo,status:record.status,reason:record.reason,synthetic:record.synthetic,observation:record.observation,receipts,authorizesDispatch:false});
}

verifier.close();
const after=store.state.repositoryEvidence.records.reduce((sum,item)=>sum+item.calls.length,0);
const report={executedAt:new Date().toISOString(),authenticated:false,searchProviderCalls:0,newMetadataHttpCalls:after-before,totalReservedMetadataCalls:after,results};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({newMetadataHttpCalls:report.newMetadataHttpCalls,results:results.map(({repo,status,reason,observation})=>({repo,status,reason,observation}))}));
