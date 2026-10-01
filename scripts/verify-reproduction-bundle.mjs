import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const sha=value=>createHash('sha256').update(value).digest('hex');
const root=path.dirname(fileURLToPath(import.meta.url));

export function verifyBundle(dir){
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  if(manifest.format!=='blackhole-synthetic-reproduction-v1'||manifest.evidenceClass!=='synthetic'||!Array.isArray(manifest.files))throw Error('Invalid manifest');
  const seen=new Set();
  for(const entry of manifest.files){
    if(!/^(input\.json|receipt\.json|receipt\.html|README\.md|verify\.mjs|artifacts\/[a-f0-9-]{36})$/.test(entry.path)||seen.has(entry.path)||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Invalid manifest entry');
    seen.add(entry.path);
    const file=path.resolve(dir,entry.path);
    if(!file.startsWith(path.resolve(dir)+path.sep)||sha(fs.readFileSync(file))!==entry.sha256)throw Error('Bundle file hash mismatch');
  }
  for(const required of ['input.json','receipt.json','receipt.html','README.md','verify.mjs'])if(!seen.has(required))throw Error('Required bundle file missing');
  const input=JSON.parse(fs.readFileSync(path.join(dir,'input.json'),'utf8'));
  const receipt=JSON.parse(fs.readFileSync(path.join(dir,'receipt.json'),'utf8'));
  const {receiptHash,...payload}=receipt;
  if(receipt.format!=='blackhole-mission-receipt-v1'||receipt.evidenceClass!=='synthetic'||receipt.published!==false||receipt.authorizesDispatch!==false||receiptHash!==sha(JSON.stringify(payload)))throw Error('Receipt integrity mismatch');
  if(receipt.inputHash!==sha(JSON.stringify({projectId:input.projectId,goal:input.goal,successCriterion:input.successCriterion})))throw Error('Mission input mismatch');
  let artifactsVerified=0;
  for(const step of receipt.steps)for(const ref of step.artifactHashes){
    const name=`artifacts/${ref.artifactId}`;
    if(!seen.has(name)||sha(fs.readFileSync(path.join(dir,name)))!==ref.sha256)throw Error('Receipt artifact mismatch');
    artifactsVerified++;
  }
  if(seen.size!==5+artifactsVerified||receipt.previousHash!==null||receipt.sequence!==1)throw Error('Unexpected bundle chain');
  return {ok:true,evidenceClass:'synthetic',missionId:receipt.missionId,receiptHash,artifactsVerified,externalOutcomeVerified:false};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(verifyBundle(process.argv[2]?path.resolve(process.argv[2]):root)));}
  catch(error){console.error(JSON.stringify({ok:false,reason:error.message}));process.exitCode=1;}
}
