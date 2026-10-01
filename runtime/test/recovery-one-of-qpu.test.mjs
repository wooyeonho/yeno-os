import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {planRecovery} from '../lib/jev-recovery.mjs';
import {buildJevRecoveryVerificationResult} from '../lib/jev-recovery-verifier.mjs';
import {
  RecoveryOneOfError, buildRecoveryOneOfCircuit, decodeRecoveryOneOfCounts,
  validateRecoveryOneOfCircuit, validateRecoveryOneOfSelection,
} from '../lib/recovery-one-of-qpu.mjs';
import {optimizeRecoveryOneOf} from '../lib/quantum-statevector.mjs';

const missionId='11111111-1111-4111-8111-111111111111';
const projectId='22222222-2222-4222-8222-222222222222';
const blockedJobId='33333333-3333-4333-8333-333333333333';
const AT='2026-09-24T12:00:00.000Z';
const ref=(id,seed)=>({type:'artifact',id,sha256:seed.repeat(64)});
const parameters={gamma:0.31,beta:0.27,shots:128};

function contextFor(count=2,{mixedRisk=false,equalCosts=false}={}) {
  const resourceSnapshot={version:1,missionId,projectId,capturedAt:AT,validUntil:'2026-09-24T12:10:00.000Z',
    scope:{projectIds:[projectId],actionTypes:['reconcile']},
    budget:{currency:'USD',limitMinor:1000,reservedMinor:100,spentMinor:100},
    resources:[{id:'local-index',capabilityIds:['memory.read'],status:'available',projectIds:[projectId],checkedAt:AT,
      validUntil:'2026-09-24T12:05:00.000Z',evidenceRefs:[ref('index-health','a')]}],evidenceRefs:[ref('mission-goal','b')]};
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

const build=(context=contextFor())=>buildRecoveryOneOfCircuit(context);

test('open-source simulator runs an actual three-alternative recovery circuit without dispatch authority',()=>{
  const result=optimizeRecoveryOneOf(contextFor(3),{gridSize:8,shots:128,seed:91});
  assert.equal(result.sweep.length,64);
  assert.equal(result.best.uniformBaseline,3/8);
  assert.ok(result.best.feasibleProbability>=0.6,`feasible probability ${result.best.feasibleProbability}`);
  assert.equal(result.counts.reduce((sum,item)=>sum+item.count,0),128);
  assert.equal(result.selection.observedShots,128);
  assert.equal(result.authorizesDispatch,false);
  assert.equal(result.selection.authorizesDispatch,false);
});

test('builds a replay-bound OpenQASM 3 gate circuit only from 2–4 PASS-verified JEV alternatives',()=>{
  const context=contextFor();
  const circuit=build(context);
  assert.equal(circuit.version,'recovery-one-of-qaoa-openqasm3-v1');
  assert.deepEqual(circuit.variableOrder,['alternative-1','alternative-2']);
  assert.equal(circuit.authorizesDispatch,false);
  assert.equal(circuit.qasmSha256.length,64);
  assert.equal(circuit.depth,7);
  assert.equal(circuit.qasm.startsWith('OPENQASM 3.0;\ninclude "stdgates.inc";'),true);
  assert.match(circuit.qasm,/h q\[0\];\nh q\[1\];\nbarrier q;/);
  assert.doesNotMatch(circuit.qasm,/\brzz\s*\(/);
  assert.match(circuit.qasm,/cx q\[0\], q\[1\];\nbarrier q;\nrz\([^\n]+\) q\[1\];\nbarrier q;\ncx q\[0\], q\[1\];/);
  assert.deepEqual(circuit.gateCounts,{h:2,rz:3,cx:2,rx:2,measure:2});
  assert.match(circuit.qasm,/rx\([^\n]+\) q\[0\];\nrx\([^\n]+\) q\[1\];/);
  assert.match(circuit.qasm,/c\[0\] = measure q\[0\];\nc\[1\] = measure q\[1\];/);
  assert.deepEqual(circuit.qubitMap.map(item=>[item.alternativeId,item.qubitIndex]),[['alternative-1',0],['alternative-2',1]]);
  assert.deepEqual(circuit.classicalBitMap.map(item=>[item.alternativeId,item.classicalBitIndex,item.measuresQubitIndex]),
    [['alternative-1',0,0],['alternative-2',1,1]]);
  assert.equal(validateRecoveryOneOfCircuit(circuit,context),true);
});

test('colors a four-choice complete interaction graph into valid gate layers and reports its actual logical depth',()=>{
  const circuit=build(contextFor(4));
  assert.equal(circuit.variableOrder.length,4);
  assert.equal(circuit.entanglerLayers.length,3);
  assert.equal(circuit.depth,13);
  assert.deepEqual(circuit.gateCounts,{h:4,rz:10,cx:12,rx:4,measure:4});
  const edges=circuit.entanglerLayers.flat();
  assert.equal(edges.length,6);
  assert.equal(new Set(edges.map(edge=>`${edge.left}:${edge.right}`)).size,6);
  for(const layer of circuit.entanglerLayers) {
    const touched=layer.flatMap(edge=>[edge.left,edge.right]);
    assert.equal(new Set(touched).size,touched.length,'gates in one entangler layer must act on disjoint qubits');
  }
});

test('QUBO and Ising energies agree for every assignment and the penalty leaves only the cheapest one-hot minimum',()=>{
  const circuit=build(contextFor(4));
  const energies=[];
  for(let mask=0;mask<2**circuit.variableOrder.length;mask++) {
    const bits=circuit.variableOrder.map((_,index)=>(mask>>index)&1);
    const qubo=circuit.qubo.constant+circuit.qubo.linear.reduce((sum,coefficient,index)=>sum+coefficient*bits[index],0)
      +circuit.qubo.quadratic.reduce((sum,term)=>sum+term.coefficient*bits[term.left]*bits[term.right],0);
    const z=bits.map(bit=>bit? -1:1);
    const ising=circuit.ising.constant+circuit.ising.linear.reduce((sum,term)=>sum+term.coefficient*z[term.index],0)
      +circuit.ising.quadratic.reduce((sum,term)=>sum+term.coefficient*z[term.left]*z[term.right],0);
    assert.ok(Math.abs(qubo-ising)<1e-9,`QUBO/Ising mismatch at ${bits.join('')}: ${qubo} vs ${ising}`);
    energies.push({bits,energy:ising});
  }
  const minimum=Math.min(...energies.map(item=>item.energy));
  const minimizers=energies.filter(item=>item.energy===minimum).map(item=>item.bits);
  assert.deepEqual(minimizers,[[1,0,0,0]]);
  assert.equal(minimum,circuit.objectiveCosts[0].objectiveCost);
});

test('decodes explicit classical bit order, retains counts, and deterministically selects the modal valid one-hot result',()=>{
  const context=contextFor();
  const circuit=build(context);
  const counts=[{bitstring:'01',count:80},{bitstring:'10',count:48}];
  const selection=decodeRecoveryOneOfCounts({circuit,counts,bitOrder:'c0-rightmost'},context);
  assert.equal(selection.winnerAlternativeId,'alternative-1');
  assert.equal(selection.selectedAlternativeId,'alternative-1');
  assert.equal(selection.validShots,128);
  assert.equal(selection.rejectedShots,0);
  assert.equal(selection.authorizesDispatch,false);
  assert.deepEqual(selection.rawCounts,counts);
  assert.equal(validateRecoveryOneOfSelection(selection,circuit),true);
  const oppositeOrder=decodeRecoveryOneOfCounts({circuit,counts,bitOrder:'c0-leftmost'},context);
  assert.equal(oppositeOrder.winnerAlternativeId,'alternative-2');
});

test('uses the JEV-ordered classical fallback when every observed bitstring is invalid one-hot data',()=>{
  const context=contextFor();
  const circuit=build(context);
  const selection=decodeRecoveryOneOfCounts({circuit,counts:[{bitstring:'00',count:64},{bitstring:'11',count:64}],bitOrder:'c0-leftmost'},context);
  assert.equal(selection.winnerAlternativeId,null);
  assert.equal(selection.validShots,0);
  assert.equal(selection.rejectedShots,128);
  assert.equal(selection.selectionSource,'classical_fallback');
  assert.equal(selection.selectedAlternativeId,circuit.classicalFallbackAlternativeId);
  assert.equal(validateRecoveryOneOfSelection(selection,circuit),true);
});

test('fails closed on altered counts, context, decision, parameters, and malformed histograms',()=>{
  const context=contextFor();
  const circuit=build(context);
  const counts=[{bitstring:'01',count:80},{bitstring:'10',count:48}];
  const selection=decodeRecoveryOneOfCounts({circuit,counts,bitOrder:'c0-rightmost'},context);
  assert.throws(()=>validateRecoveryOneOfSelection({...selection,selectedAlternativeId:'alternative-2'},circuit),RecoveryOneOfError);
  assert.throws(()=>validateRecoveryOneOfSelection({...selection,rawCounts:[{bitstring:'01',count:127},{bitstring:'10',count:1}]},circuit),RecoveryOneOfError);
  assert.throws(()=>decodeRecoveryOneOfCounts({circuit,counts:[{bitstring:'01',count:127}],bitOrder:'c0-rightmost'},context),
    error=>error instanceof RecoveryOneOfError&&error.code==='shot_count_mismatch');
  assert.throws(()=>buildRecoveryOneOfCircuit({...context,parameters:{...parameters,gamma:9}}),
    error=>error instanceof RecoveryOneOfError&&error.code==='invalid_qaoa_parameters');
  assert.throws(()=>buildRecoveryOneOfCircuit({...context,decision:{...context.decision,assessedAt:'2026-09-24T12:01:00.000Z'}}),
    error=>error.name==='JevRecoveryError');
  assert.throws(()=>buildRecoveryOneOfCircuit(contextFor(1)),
    error=>error instanceof RecoveryOneOfError&&error.code==='classical_fallback_required');
  assert.throws(()=>buildRecoveryOneOfCircuit(contextFor(3,{mixedRisk:true})),
    error=>error instanceof RecoveryOneOfError&&error.code==='classical_fallback_required');
  assert.throws(()=>buildRecoveryOneOfCircuit(contextFor(2,{equalCosts:true})),
    error=>error instanceof RecoveryOneOfError&&error.code==='classical_fallback_required');
  const stale={...context,request:{...context.request,goal:'A changed goal.'}};
  assert.throws(()=>buildRecoveryOneOfCircuit(stale),error=>error.message.includes('JEV recovery verifier: invalid_result'));
});
