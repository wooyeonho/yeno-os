import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,createHash} from 'node:crypto';
import {createReceiptAttestation,verifyReceiptAttestation} from '../lib/receipt-attestation.mjs';
import {exchangeSignerId} from '../lib/capability-exchange.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
  const owner=generateKeyPairSync('ed25519'),reviewer=generateKeyPairSync('ed25519'),other=generateKeyPairSync('ed25519');
  const missionId=randomUUID(),artifactId=randomUUID(),bytes=Buffer.from('synthetic artifact');
  const body={format:'blackhole-mission-receipt-v1',sequence:1,previousHash:null,missionId,
    createdAt:'2026-10-01T00:00:00.000Z',inputHash:sha('private input'),
    steps:[{jobId:randomUUID(),role:'builder',status:'completed',provider:'synthetic',model:'synthetic',artifactHashes:[{artifactId,sha256:sha(bytes)}]}],
    verdict:'unverified',deterministicVerified:null,debateHashes:[],evidenceClass:'synthetic',published:false,authorizesDispatch:false};
  const receipt={...body,receiptHash:sha(JSON.stringify(body))};
  return {owner,reviewer,other,receipt,artifactId,bytes,read:id=>id===artifactId?bytes:Buffer.from('missing')};
}

test('S15 synthetic third-party signature verifies receipt bytes but never creates an outcome or S grade',()=>{
  const f=fixture(),attestation=createReceiptAttestation(f.receipt,f.read,f.reviewer.privateKey,'2026-10-01T01:00:00.000Z');
  const result=verifyReceiptAttestation(attestation,f.receipt,f.read,{trustedPublicKeys:[f.reviewer.publicKey],ownerSignerId:exchangeSignerId(f.owner.publicKey)});
  assert.equal(result.signatureValid,true);
  assert.equal(result.receiptIntegrityVerified,true);
  assert.equal(result.externalPersonVerified,false);
  assert.equal(result.outcomeVerified,false);
  assert.equal(result.highGradeCandidate,false);
  assert.equal(result.authorizesDispatch,false);
});

test('S15 owner self-attestation, untrusted signer, changed bytes and changed receipt fail closed',()=>{
  const f=fixture(),ownerId=exchangeSignerId(f.owner.publicKey),att=createReceiptAttestation(f.receipt,f.read,f.reviewer.privateKey,'2026-10-01T01:00:00.000Z');
  assert.throws(()=>verifyReceiptAttestation(att,f.receipt,f.read,{trustedPublicKeys:[],ownerSignerId:ownerId}));
  assert.throws(()=>verifyReceiptAttestation(att,f.receipt,f.read,{trustedPublicKeys:[f.other.publicKey],ownerSignerId:ownerId}));
  assert.throws(()=>verifyReceiptAttestation(att,f.receipt,()=>Buffer.from('changed'),{trustedPublicKeys:[f.reviewer.publicKey],ownerSignerId:ownerId}));
  assert.throws(()=>verifyReceiptAttestation(att,{...f.receipt,receiptHash:'0'.repeat(64)},f.read,{trustedPublicKeys:[f.reviewer.publicKey],ownerSignerId:ownerId}));
  const own=createReceiptAttestation(f.receipt,f.read,f.owner.privateKey,'2026-10-01T01:00:00.000Z');
  assert.throws(()=>verifyReceiptAttestation(own,f.receipt,f.read,{trustedPublicKeys:[f.owner.publicKey],ownerSignerId:ownerId}));
});
