import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  buildJevRecoveryVerificationResult, jevRecoveryVerificationPrompt, parseJevRecoveryVerifierDraft,
  validateJevRecoveryVerificationRequest, validateJevRecoveryVerificationResult,
} from '../lib/jev-recovery-verifier.mjs';

const missionId='11111111-1111-4111-8111-111111111111';
const projectId='22222222-2222-4222-8222-222222222222';
const blockedJobId='33333333-3333-4333-8333-333333333333';
const verifierJobId='44444444-4444-4444-8444-444444444444';
const artifactId='55555555-5555-4555-8555-555555555555';
const at='2026-09-24T12:00:00.000Z';
const ref=(id,seed)=>({type:'job',id,sha256:seed.repeat(64)});
const blockerRef=ref(blockedJobId,'a');
const resourceRef=ref('local-provider-health','b');
const altRef=ref('candidate-owner-review','c');
const altId='owner_review:33333333-3333-4333-8333-333333333333';

function request(overrides={}){
  return {
    version:1,missionId,projectId,blockedJobId,initialDecisionFingerprint:'d'.repeat(64),projectVersion:3,projectStatus:'active',
    goal:'막힌 작업을 안전하게 이어갈 수 있는 다음 단계를 찾는다',successCriterion:'근거가 확인된 대안만 소유자 검토에 제시한다',
    blocker:{code:'providerMissing',evidenceRefs:[blockerRef]},
    resourceSnapshot:{version:1,missionId,projectId,capturedAt:at,validUntil:'2026-09-24T12:05:00.000Z',
      scope:{projectIds:[projectId],actionTypes:['wait','owner_review']},budget:{currency:'USD',limitMinor:0,reservedMinor:0,spentMinor:0},
      resources:[{id:'local-provider',capabilityIds:['agent.generate'],status:'available',projectIds:[projectId],checkedAt:at,validUntil:'2026-09-24T12:05:00.000Z',evidenceRefs:[resourceRef]}],evidenceRefs:[resourceRef]},
    alternatives:[{id:altId,missionId,projectId,actionType:'owner_review',requiredResourceIds:[],requiredCapabilityIds:[],evidenceRefs:[altRef],
      cost:{currency:'USD',amountMinor:0},riskClass:'low',sideEffects:[],reversible:true,approvalId:null}],
    policy:{emergencyStop:false,approvedApprovalIds:[],allowedRiskClasses:['low'],maxCostMinor:0},createdAt:at,...overrides,
  };
}
const draftFor=req=>({alternatives:req.alternatives.map(alternative=>({alternativeId:alternative.id,objectiveFit:'PASS',preconditions:'PASS',
  evidenceRefs:[blockerRef,altRef],reason:'현재 근거에서 소유자 검토로 넘기는 단계는 실행 권한이나 외부 효과를 만들지 않는다.'}))});

test('recovery verifier prompt is bounded to typed evidence and creates no tools or execution authority',()=>{
  const req=request();
  assert.equal(validateJevRecoveryVerificationRequest(req),true);
  const prompt=jevRecoveryVerificationPrompt(req);
  assert.match(prompt,/도구도 사용할 수 없습니다/);
  assert.match(prompt,/objectiveFit/);
  assert.match(prompt,/evidenceCatalog/);
  assert.ok(Buffer.byteLength(prompt)<16000);
  assert.throws(()=>jevRecoveryVerificationPrompt(request({goal:'sk-private-value'})),/credential-shaped values/);
});

test('model reviews must cover every alternative and cite only exact supplied evidence hashes',()=>{
  const req=request(),draft=draftFor(req);
  const parsed=parseJevRecoveryVerifierDraft(JSON.stringify(draft),req);
  assert.equal(parsed.alternatives[0].alternativeId,altId);
  assert.throws(()=>parseJevRecoveryVerifierDraft(JSON.stringify({alternatives:[{...draft.alternatives[0],evidenceRefs:[ref('made-up','f')]}]}),req),/unprovided_evidence_citation/);
  assert.throws(()=>parseJevRecoveryVerifierDraft(JSON.stringify({alternatives:[]}),req),/invalid_draft_shape/);
  assert.throws(()=>parseJevRecoveryVerifierDraft(JSON.stringify({alternatives:[{...draft.alternatives[0],objectiveFit:'PASS',preconditions:'PASS',evidenceRefs:[altRef],reason:'x',surprise:true}]}),req),/invalid_draft_review/);
});

test('persisted semantic review is tied to the local verifier job, request fingerprint and raw output artifact',()=>{
  const req=request(),raw=JSON.stringify(draftFor(req));
  const outputArtifactRef={type:'artifact',id:artifactId,sha256:crypto.createHash('sha256').update(raw).digest('hex')};
  const result=buildJevRecoveryVerificationResult({draft:raw,request:req,verifierJobId,provider:'local',model:'qwen2.5:3b',checkedAt:at,outputArtifactRef});
  assert.equal(validateJevRecoveryVerificationResult(result,req),true);
  assert.equal(result.reviews[0].verifierId,`local-semantic-recovery:${verifierJobId}`);
  assert.ok(result.reviews[0].evidenceRefs.some(ref=>ref.id===artifactId&&ref.sha256===outputArtifactRef.sha256));
  assert.throws(()=>validateJevRecoveryVerificationResult({...result,reviews:[{...result.reviews[0],objectiveFit:'FAIL'}]},req),/result_fingerprint_mismatch/);
  assert.throws(()=>buildJevRecoveryVerificationResult({draft:raw,request:req,verifierJobId,provider:'openai',model:'cloud',checkedAt:at,outputArtifactRef}),/invalid_verifier_provenance/);
});
