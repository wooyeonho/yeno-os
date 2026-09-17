import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {randomUUID} from 'node:crypto';
import {outcomeReality,outcomeRealities,verifiedOutcomesByCapability,outcomeConnectorReadiness} from '../lib/outcome-reality.mjs';
import {createOutcomeEvidence,sha256} from '../lib/outcome-verification.mjs';
import {createConnector,readingFingerprint,OUTCOME_CONNECTOR_VERSION} from '../lib/outcome-connector.mjs';

const sha=v=>crypto.createHash('sha256').update(v).digest('hex');

function reading(connector,records,readAt){
  const r={version:OUTCOME_CONNECTOR_VERSION,connectorId:connector.id,sourceType:connector.sourceType,sourceId:connector.sourceId,transport:connector.transport,readAt,records,recordsSha256:sha256(records),fingerprint:null};
  r.fingerprint=readingFingerprint(r);
  return r;
}

function fixture({jobType='capability'}={}) {
  const questId=randomUUID(),jobId=randomUUID(),capabilityId='cap-revenue',artifactSha256=sha('artifact'),inputSha256=sha('input');
  const job=jobType==='capability'
    ? {id:jobId,type:'capability',status:'completed',capabilityRequest:{id:capabilityId,inputSha256}}
    : {id:jobId,type:'agent',status:'completed'};
  const run={action:'run',runId:jobId,id:capabilityId,outputSha256:artifactSha256,inputSha256};
  const outcome={id:randomUUID(),questId,jobId,artifactSha256,ledger:'wealth',verification:'self_reported'};
  const connector=createConnector({id:'toss-conn',sourceType:'payment_processor',sourceId:'toss:store-1',transport:'owner_export_json',locator:'docs/exports/fixture.json',metrics:['wealth.revenue']},{declaredAt:'2026-09-01T00:00:00.000Z'});
  const record={metric:'wealth.revenue',value:250000,unit:'KRW',timestamp:'2026-09-01T00:00:00.000Z'};
  const evidence=createOutcomeEvidence({questId,jobId,artifactSha256,metric:'wealth.revenue',value:250000,unit:'KRW',sourceType:'payment_processor',sourceId:'toss:store-1',sourceTimestamp:'2026-09-01T00:00:00.000Z',verificationType:'external_structured',authority:'external',confidence:1},{collectedAt:'2026-09-01T00:05:00.000Z'});
  const state={jobs:jobType==='capability'?[job]:[job],capabilities:{history:jobType==='capability'?[run]:[]},outcomes:[outcome],outcomeEvidence:[evidence],outcomeConnectors:[connector],outcomeReadings:[reading(connector,[record],'2026-09-01T00:10:00.000Z')]};
  return {state,outcome,record,evidence,connector,capabilityId,artifactSha256};
}

test('outcomeReality: execution-verified capability job + matching real reading -> outcomeVerified, but never highGradeCandidate for external_structured (only external_verified is high grade)',()=>{
  const {state,outcome,capabilityId}=fixture();
  const reality=outcomeReality(outcome,state,{at:'2026-09-01T00:10:05.000Z'});
  assert.equal(reality.executionVerified,true);
  assert.equal(reality.evidenceDeclared,true);
  assert.equal(reality.outcomeVerified,true);
  assert.equal(reality.highGradeCandidate,false);
  assert.equal(reality.capabilityId,capabilityId);
  assert.deepEqual(reality.reasons,[]);
  // Growth's S-gate only ever sees highGradeCandidate verdicts.
  assert.deepEqual(verifiedOutcomesByCapability(state,'2026-09-01T00:10:05.000Z'),{});
});

test('outcomeReality: the ledger outcome keeps verification:"self_reported" untouched - outcomeReality never mutates it',()=>{
  const {state,outcome}=fixture();
  outcomeReality(outcome,state,{at:'2026-09-01T00:10:05.000Z'});
  assert.equal(state.outcomes[0].verification,'self_reported');
});

test('outcomeReality: no declared evidence -> honestly unverified',()=>{
  const {state,outcome}=fixture();
  state.outcomeEvidence=[];
  const reality=outcomeReality(outcome,state,{at:'2026-09-01T00:10:05.000Z'});
  assert.equal(reality.outcomeVerified,false);
  assert.ok(reality.reasons.includes('no_outcome_evidence_declared'));
});

test('outcomeReality: evidence declared but no matching reading (source not read yet) -> honestly unverified',()=>{
  const {state,outcome}=fixture();
  state.outcomeReadings=[];
  const reality=outcomeReality(outcome,state,{at:'2026-09-01T00:10:05.000Z'});
  assert.equal(reality.outcomeVerified,false);
  assert.ok(reality.reasons.includes('no_matching_reading_available'));
});

test('outcomeReality: the source drifted after the claim (value changed at the same source/timestamp) -> fails closed',()=>{
  const {state,outcome,connector}=fixture();
  state.outcomeReadings=[reading(connector,[{metric:'wealth.revenue',value:999,unit:'KRW',timestamp:'2026-09-01T00:00:00.000Z'}],'2026-09-02T00:00:00.000Z')];
  const reality=outcomeReality(outcome,state,{at:'2026-09-02T00:00:05.000Z'});
  assert.equal(reality.outcomeVerified,false);
  assert.ok(reality.reasons.some(r=>r.includes('source_changed')));
});

test('outcomeReality: a non-capability (agent) job is judged purely on the external source, never gates on execution, and never feeds skill grading (capabilityId stays null)',()=>{
  const {state,outcome}=fixture({jobType:'agent'});
  const reality=outcomeReality(outcome,state,{at:'2026-09-01T00:10:05.000Z'});
  assert.equal(reality.executionVerified,false);
  assert.equal(reality.capabilityId,null);
  assert.equal(reality.outcomeVerified,true,JSON.stringify(reality.reasons));
  assert.deepEqual(verifiedOutcomesByCapability(state,'2026-09-01T00:10:05.000Z'),{});
});

test('outcomeReality: a capability job whose artifact does not match the real run record fails execution verification and outcomeVerified',()=>{
  const {state,outcome}=fixture();
  outcome.artifactSha256=sha('tampered');
  const reality=outcomeReality(outcome,state,{at:'2026-09-01T00:10:05.000Z'});
  assert.equal(reality.executionVerified,false);
  assert.equal(reality.outcomeVerified,false);
});

test('outcomeConnectorReadiness: NOT_WIRED with no connector; WIRED_UNVERIFIED with a connector but no successful reading; SYNTHETIC_VERIFIED for owner_export; LIVE_VERIFIED only for a real https_json reading',()=>{
  assert.equal(outcomeConnectorReadiness({outcomeConnectors:[],outcomeReadings:[]}).status,'NOT_WIRED');
  const {connector}=fixture();
  assert.equal(outcomeConnectorReadiness({outcomeConnectors:[connector],outcomeReadings:[]}).status,'WIRED_UNVERIFIED');
  const ownerReading=reading(connector,[{metric:'wealth.revenue',value:1,unit:'KRW',timestamp:'2026-09-01T00:00:00.000Z'}],'2026-09-01T00:00:00.000Z');
  assert.equal(outcomeConnectorReadiness({outcomeConnectors:[connector],outcomeReadings:[ownerReading]}).status,'SYNTHETIC_VERIFIED');
  const liveReading={...ownerReading,transport:'https_json',fingerprint:null};
  liveReading.fingerprint=readingFingerprint(liveReading);
  assert.equal(outcomeConnectorReadiness({outcomeConnectors:[connector],outcomeReadings:[liveReading]}).status,'LIVE_VERIFIED');
});
