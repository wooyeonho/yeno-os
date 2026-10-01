

import {randomUUID} from 'node:crypto';
import {planRecovery} from '../../lib/jev-recovery.mjs';
import {buildJevRecoveryVerificationResult} from '../../lib/jev-recovery-verifier.mjs';
import {
  RecoveryOneOfError, buildRecoveryOneOfCircuit, decodeRecoveryOneOfCounts,
  validateRecoveryOneOfCircuit, validateRecoveryOneOfSelection,
} from '../../lib/recovery-one-of-qpu.mjs';
import {optimizeRecoveryOneOf} from '../../lib/quantum-statevector.mjs';

const missionId='11111111-1111-4111-8111-111111111111';
const projectId='22222222-2222-4222-8222-222222222222';
const blockedJobId='33333333-3333-4333-8333-333333333333';
const AT=new Date().toISOString();
const ref=(id,seed)=>({type:'artifact',id,sha256:seed.repeat(64)});
const parameters={gamma:0.31,beta:0.27,shots:128};

export function contextFor(count=2,{mixedRisk=false,equalCosts=false}={}) {
  const resourceSnapshot={version:1,missionId,projectId,capturedAt:AT,validUntil:new Date(Date.parse(AT)+600000).toISOString(),
    scope:{projectIds:[projectId],actionTypes:['reconcile']},
    budget:{currency:'USD',limitMinor:1000,reservedMinor:100,spentMinor:100},
    resources:[{id:'local-index',capabilityIds:['memory.read'],status:'available',projectIds:[projectId],checkedAt:AT,
      validUntil:new Date(Date.parse(AT)+300000).toISOString(),evidenceRefs:[ref('index-health','a')]}],evidenceRefs:[ref('mission-goal','b')]};
  const alternatives=Array.from({length:count},(_,index)=>({
    id:`alternative-${index+1}`,missionId,projectId,actionType:'reconcile',requiredResourceIds:['local-index'],
    requiredCapabilityIds:['memory.read'],evidenceRefs:[ref(`input-${index+1}`,'c')],
    cost:{currency:'USD',amountMinor:equalCosts?100:[100,200,300,400][index]},riskClass:mixedRisk&&index===count-1?'moderate':'low',
    sideEffects:['read_private'],reversible:true,approvalId:null,
  }));
  const blocker={code:'provider_unavailable',evidenceRefs:[ref('blocked-provider','e')]};
  const policy={emergencyStop:false,approvedApprovalIds:[],allowedRiskClasses:['low','moderate'],maxCostMinor:500};
  const initial=planRecovery({missionId,projectId,blocker,resourceSnapshot,alternatives,verifierReviews:[],policy,at:AT});
  const request={version:1,missionId,projectId,blockedJobId,initialDecisionFingerprint:initial.fingerprint,
    projectVersion:1,projectStatus:'active',goal:'Recover the interrupted local task.',
    successCriterion:'Complete the next safe step with a checked artifact.',blocker,resourceSnapshot,alternatives,policy,createdAt:AT};
  const draft={alternatives:alternatives.map(alternative=>({alternativeId:alternative.id,objectiveFit:'PASS',preconditions:'PASS',
    evidenceRefs:[alternative.evidenceRefs[0]],reason:'The cited input supports this reversible next step.'}))};
  const result=buildJevRecoveryVerificationResult({draft,request,verifierJobId:randomUUID(),provider:'local',model:'qwen2.5:3b',
    checkedAt:AT,outputArtifactRef:ref(randomUUID(),'f')});
  const decision=planRecovery({missionId,projectId,blocker,resourceSnapshot,alternatives,verifierReviews:result.reviews,policy,at:AT});
  return {request,result,decision,parameters};
}
