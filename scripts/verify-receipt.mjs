import path from 'node:path';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {verifyReceiptDirectory} from '../runtime/lib/mission-receipts.mjs';

const target=process.argv[2],artifactTarget=process.argv[3];
if(!target){console.error('Usage: node scripts/verify-receipt.mjs <private receipts directory> <artifact-by-id directory>');process.exitCode=2;}
else try{
  const dir=path.resolve(target),receipts=verifyReceiptDirectory(dir);
  const refs=receipts.flatMap(receipt=>receipt.steps.flatMap(step=>step.artifactHashes));
  if(refs.length&&!artifactTarget)throw Error('artifact_directory_required');
  if(artifactTarget){
    const artifactsDir=path.resolve(artifactTarget);
    for(const ref of refs){
      if(!/^[a-f0-9-]{36}$/i.test(ref.artifactId))throw Error('artifact_id_invalid');
      const file=path.resolve(artifactsDir,ref.artifactId);
      if(path.dirname(file)!==artifactsDir||!fs.existsSync(file)||createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==ref.sha256)throw Error('artifact_hash_mismatch');
    }
  }
  console.log(JSON.stringify({ok:true,count:receipts.length,artifactsVerified:refs.length,chainHead:receipts.at(-1)?.receiptHash??null}));
}catch(error){console.error(JSON.stringify({ok:false,reason:error.message}));process.exitCode=1;}
