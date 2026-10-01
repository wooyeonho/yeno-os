import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9-]{36}$/i;
const TERMINAL=new Set(['completed','failed','cancelled']);
const ROLE_ORDER=['scout','researcher','builder','verifier','semanticVerifier'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeModel=value=>typeof value==='string'&&/^[a-zA-Z0-9_.:/-]{1,100}$/.test(value)?value:null;

export function receiptHtml(receipt){
  const json=JSON.stringify(receipt,null,2);
  return `<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'"><title>BLACKHOLE 영수증 ${escape(receipt.missionId)}</title></head><body><h1>BLACKHOLE 비공개 미션 영수증</h1><p>기록된 산출물 해시와 판정입니다. 내용 품질이나 외부 검증을 보장하지 않습니다.</p><pre>${escape(json)}</pre></body></html>\n`;
}

export function buildMissionReceipt(state,missionId,readArtifact,{sequence,previousHash=null,at}={}){
  if(!UUID.test(missionId)||!Number.isInteger(sequence)||sequence<1||sequence>10000||!(previousHash===null||SHA.test(previousHash))
    ||typeof at!=='string'||!Number.isFinite(Date.parse(at)))throw Error('Invalid receipt identity');
  const jobs=state.jobs.filter(job=>job.shadowAssignment?.missionId===missionId);
  if(!jobs.length||jobs.some(job=>!TERMINAL.has(job.status)))return null;
  const first=jobs[0].shadowAssignment;
  const steps=jobs.slice().sort((a,b)=>ROLE_ORDER.indexOf(a.shadowAssignment.role)-ROLE_ORDER.indexOf(b.shadowAssignment.role))
    .map(job=>{
      const artifactHashes=(job.artifacts??[]).map(ref=>{
        const artifact=state.artifacts[ref.id];
        if(!artifact||artifact.jobId!==job.id||!SHA.test(artifact.sha256)||sha(readArtifact(artifact))!==artifact.sha256)throw Error('Receipt artifact integrity mismatch');
        return {artifactId:ref.id,sha256:artifact.sha256};
      });
      return {jobId:job.id,role:job.shadowAssignment.role,status:job.status,
        provider:safeModel(job.agentJournal?.provider),model:safeModel(job.agentJournal?.model),artifactHashes};
    });
  const verify=jobs.find(job=>job.shadowAssignment.role==='verifier');
  const semantic=jobs.find(job=>job.shadowAssignment.role==='semanticVerifier');
  const jobIds=new Set(jobs.map(job=>job.id));
  const debateHashes=(state.driveDebates??[]).filter(row=>jobIds.has(row.jobId)||row.questId&&row.questId===first.plannerQuestId)
    .map(row=>sha(JSON.stringify(row)));
  const synthetic=jobs.some(job=>/synthetic/i.test(String(job.agentJournal?.provider??''))||/synthetic/i.test(String(job.agentJournal?.model??'')));
  const payload={format:'blackhole-mission-receipt-v1',sequence,previousHash,missionId,createdAt:at,
    inputHash:sha(JSON.stringify({projectId:first.projectId,goal:first.goal,successCriterion:first.successCriterion})),
    steps,verdict:semantic?.semanticVerdict?.verdict??'unverified',deterministicVerified:verify?.verifyResult?.verified??null,
    debateHashes,evidenceClass:synthetic?'synthetic':'unverified',published:false,authorizesDispatch:false};
  return {...payload,receiptHash:sha(JSON.stringify(payload))};
}

export function verifyReceiptDirectory(dir,{allowMissingPages=false}={}){
  if(!fs.existsSync(dir))return [];
  const files=fs.readdirSync(dir).filter(name=>name.endsWith('.json'));
  if(files.length>10000)throw Error('Receipt capacity exceeded');
  const receipts=files.map(name=>{
    const receipt=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
    if(!UUID.test(receipt.missionId)||name!==`${receipt.missionId}.json`)throw Error('Receipt name mismatch');
    const {receiptHash,...payload}=receipt;
    if(!SHA.test(receiptHash)||sha(JSON.stringify(payload))!==receiptHash||payload.format!=='blackhole-mission-receipt-v1'
      ||payload.published!==false||payload.authorizesDispatch!==false)throw Error('Receipt hash mismatch');
    const page=path.join(dir,`${receipt.missionId}.html`);
    if(!fs.existsSync(page)){if(!allowMissingPages)throw Error('Receipt page missing');}
    else if(fs.readFileSync(page,'utf8')!==receiptHtml(receipt))throw Error('Receipt page mismatch');
    return receipt;
  }).sort((a,b)=>a.sequence-b.sequence);
  for(let i=0;i<receipts.length;i++)if(receipts[i].sequence!==i+1||receipts[i].previousHash!==(i?receipts[i-1].receiptHash:null))throw Error('Receipt chain mismatch');
  return receipts;
}

export function verifyReceiptForMission(state,dataDir,missionId){
  if(!UUID.test(missionId))throw Error('Invalid mission ID');
  const receipts=verifyReceiptDirectory(path.join(dataDir,'receipts'));
  const receipt=receipts.find(row=>row.missionId===missionId);
  if(!receipt)throw Error('Receipt not found');
  const artifactsDir=path.resolve(dataDir,'artifacts');
  let artifactCount=0;
  for(const step of receipt.steps)for(const ref of step.artifactHashes){
    const artifact=state.artifacts?.[ref.artifactId];
    if(!artifact||artifact.jobId!==step.jobId||artifact.sha256!==ref.sha256)throw Error('Receipt artifact metadata mismatch');
    const file=path.resolve(artifactsDir,artifact.filename);
    if(path.dirname(file)!==artifactsDir||sha(fs.readFileSync(file))!==ref.sha256)throw Error('Receipt artifact hash mismatch');
    artifactCount++;
  }
  return {missionId,receiptHash:receipt.receiptHash,artifactCount,receiptIntegrityVerified:true,externalOutcomeVerified:false,published:false,authorizesDispatch:false};
}

export function ensureMissionReceipts(state,dataDir,at){
  const dir=path.join(dataDir,'receipts');fs.mkdirSync(dir,{recursive:true});
  const existing=verifyReceiptDirectory(dir,{allowMissingPages:true}),known=new Set(existing.map(row=>row.missionId));
  for(const receipt of existing){const page=path.join(dir,`${receipt.missionId}.html`);if(!fs.existsSync(page))fs.writeFileSync(page,receiptHtml(receipt),{flag:'wx'});}
  const artifactsDir=path.join(dataDir,'artifacts');
  const readArtifact=artifact=>{
    const file=path.resolve(artifactsDir,artifact.filename);
    if(path.dirname(file)!==artifactsDir)throw Error('Receipt artifact path invalid');
    return fs.readFileSync(file);
  };
  const ids=[...new Set(state.jobs.map(job=>job.shadowAssignment?.missionId).filter(Boolean))].sort();
  for(const id of ids){
    if(known.has(id))continue;
    const previous=existing.at(-1);
    const receipt=buildMissionReceipt(state,id,readArtifact,{sequence:existing.length+1,previousHash:previous?.receiptHash??null,at});
    if(!receipt)continue;
    fs.writeFileSync(path.join(dir,`${id}.json`),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
    fs.writeFileSync(path.join(dir,`${id}.html`),receiptHtml(receipt),{flag:'wx'});
    existing.push(receipt);known.add(id);
  }
  verifyReceiptDirectory(dir);return existing;
}
