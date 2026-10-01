import test from 'node:test';
import assert from 'node:assert/strict';
import {createGapScout,QUERY_BIAS,buildReport} from '../lib/gap-scout.mjs';
import {CAPS} from '../lib/gap-state.mjs';
import {stateWithGap,rows,at} from './helpers/gap-fixture.mjs';

test('a private ASCII error value never becomes an outbound query or spends search budget',async()=>{
 const state=stateWithGap('wrath');state.jobs[0].error='PrivateOwnerAddress123';let calls=0;
 const scout=createGapScout({state,save(){},now:()=>at,provider:{ready:true,synthetic:true,async search(){calls++;return [];}}});
 const result=await scout.researchGap(state.gapScout.gaps[0].id,'private-error');
 assert.equal(calls,0);assert.equal(result.reason,'failure_cause_undetermined');assert.deepEqual(state.gapScout.budget.days,[]);
});

test('all seven outbound queries exclude raw goal, vault, owner, request and source text',async()=>{
 for(const drive of Object.keys(CAPS)){
  const state=stateWithGap(drive);const privateText='PRIVATE_GOAL_VAULT_OWNER_SENTINEL';
  state.driveDebates.forEach(d=>{d.goal=privateText;d.voices.forEach(v=>v.text=privateText);});
  state.jarvisSettings.address=privateText;state.sources=[{text:privateText}];state.memories=[{text:privateText}];
  let sent;const scout=createGapScout({state,save(){},now:()=>at,provider:{ready:true,synthetic:true,async search(query,options){sent={query,limit:options.limit};return [];}}});
  await scout.researchGap(state.gapScout.gaps[0].id,privateText);
  assert.deepEqual(sent,{query:QUERY_BIAS[drive]+(drive==='wrath'?' empty_model_response':''),limit:CAPS[drive]});
  assert.ok(!JSON.stringify(sent).includes(privateText));
 }
});

test('live provider claims are not license, officialness or usefulness evidence',()=>{
 const report=buildReport(stateWithGap('pride').gapScout.gaps[0],rows(1),{at,synthetic:false});
 assert.equal(report.candidates.length,1);assert.deepEqual(report.recommendations,[]);
 for(const field of ['license','official','useful','commit','evidenceUrl','stars','lastCommit','method'])assert.equal(report.candidates[0][field],null);
 assert.deepEqual(report.candidates[0].reusableFor,[]);
 assert.equal(report.excluded[0].reason,'license_missing_or_unreviewed');
 const synthetic=buildReport(stateWithGap('pride').gapScout.gaps[0],rows(1),{at,synthetic:true});
 assert.equal(synthetic.recommendations.length,1);assert.equal(synthetic.synthetic,true);
});
