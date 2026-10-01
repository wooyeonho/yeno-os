import {createHash,sign,verify} from 'node:crypto';
import {exchangeSignerId} from './capability-exchange.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9-]{36}$/i;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.slice().sort().join();
export const ATTESTATION_FORMAT='blackhole-receipt-attestation-v1';

function receiptEvidence(receipt,readArtifact){
  if(!receipt||!UUID.test(receipt.missionId)||!HASH.test(receipt.receiptHash)||typeof readArtifact!=='function')throw Error('Receipt unavailable');
  const {receiptHash,...body}=receipt;
  if(sha(JSON.stringify(body))!==receiptHash||body.format!=='blackhole-mission-receipt-v1')throw Error('Receipt hash mismatch');
  const artifacts=receipt.steps.flatMap(step=>step.artifactHashes);
  for(const item of artifacts){
    if(!UUID.test(item.artifactId)||!HASH.test(item.sha256)||sha(readArtifact(item.artifactId))!==item.sha256)throw Error('Receipt artifact mismatch');
  }
  return artifacts.map(item=>({artifactId:item.artifactId,sha256:item.sha256}));
}

export function createReceiptAttestation(receipt,readArtifact,privateKey,signedAt){
  if(privateKey?.type!=='private'||privateKey.asymmetricKeyType!=='ed25519')throw Error('Ed25519 private key required');
  if(typeof signedAt!=='string'||!Number.isFinite(Date.parse(signedAt)))throw Error('Invalid attestation time');
  const artifacts=receiptEvidence(receipt,readArtifact);
  const payload={format:ATTESTATION_FORMAT,missionId:receipt.missionId,receiptHash:receipt.receiptHash,artifacts,
    signedAt,claim:'receipt_integrity_only'};
  return {payload,signerId:exchangeSignerId(privateKey),signature:sign(null,Buffer.from(JSON.stringify(payload)),privateKey).toString('base64')};
}

export function verifyReceiptAttestation(attestation,receipt,readArtifact,{trustedPublicKeys,ownerSignerId}={}){
  if(!HASH.test(ownerSignerId??'')||!Array.isArray(trustedPublicKeys)||!trustedPublicKeys.length)throw Error('Owner-approved trust list required');
  if(!exact(attestation,['payload','signerId','signature'])||!HASH.test(attestation.signerId)||typeof attestation.signature!=='string')throw Error('Invalid attestation');
  const p=attestation.payload;
  if(!exact(p,['format','missionId','receiptHash','artifacts','signedAt','claim'])||p.format!==ATTESTATION_FORMAT
    ||p.claim!=='receipt_integrity_only'||p.missionId!==receipt.missionId||p.receiptHash!==receipt.receiptHash
    ||!Array.isArray(p.artifacts)||p.artifacts.length>100||typeof p.signedAt!=='string'||!Number.isFinite(Date.parse(p.signedAt)))throw Error('Attestation scope mismatch');
  if(attestation.signerId===ownerSignerId)throw Error('Owner cannot self-attest');
  const key=trustedPublicKeys.find(candidate=>exchangeSignerId(candidate)===attestation.signerId);
  if(!key||!verify(null,Buffer.from(JSON.stringify(p)),key,Buffer.from(attestation.signature,'base64')))throw Error('Attestation signature not trusted');
  const actual=receiptEvidence(receipt,readArtifact);
  if(JSON.stringify(actual)!==JSON.stringify(p.artifacts))throw Error('Attested artifacts mismatch');
  return {signatureValid:true,receiptIntegrityVerified:true,signerId:attestation.signerId,
    externalPersonVerified:false,outcomeVerified:false,highGradeCandidate:false,authorizesDispatch:false};
}
