import test from 'node:test';
import assert from 'node:assert/strict';
import {initialResultRatings,recordResultRating,validateResultRatings} from '../lib/result-rating-state.mjs';

const jobId='4d3a9081-63b6-4d9a-9bf8-fdb214603d80';
const artifactId='e5e70efc-0612-4f60-83d5-360238b59d68';
const sha='a'.repeat(64);
const state={jobs:[{id:jobId,status:'completed',artifacts:[{id:artifactId}]}],artifacts:{[artifactId]:{sha256:sha}}};
const at='2026-10-01T01:00:00.000Z';

test('owner rating is a separate self-report linked to a completed artifact',()=>{
  const empty=initialResultRatings();
  assert.deepEqual(empty.entries,[]);
  const result=recordResultRating(empty,state,{jobId,artifactSha256:sha,stars:4,ratedAt:at});
  assert.equal(result.added,true);
  assert.deepEqual(result.row,{jobId,artifactSha256:sha,stars:4,verificationType:'self_reported',authority:'owner',sourceType:'owner_report',ratedAt:at,authorizesDispatch:false});
  assert.deepEqual(recordResultRating(result.ratings,state,{jobId,artifactSha256:sha,stars:4,ratedAt:at}).ratings,result.ratings);
  assert.throws(()=>recordResultRating(result.ratings,state,{jobId,artifactSha256:sha,stars:5,ratedAt:at}));
  assert.throws(()=>recordResultRating(empty,state,{jobId,artifactSha256:'b'.repeat(64),stars:4,ratedAt:at}));
  assert.throws(()=>recordResultRating(empty,{...state,jobs:[{...state.jobs[0],status:'failed'}]},{jobId,artifactSha256:sha,stars:4,ratedAt:at}));
  assert.throws(()=>recordResultRating(empty,state,{jobId,artifactSha256:sha,stars:0,ratedAt:at}));
  assert.throws(()=>validateResultRatings({version:1,entries:[{...result.row,authority:'model'}]},state));
  assert.throws(()=>validateResultRatings({version:1,entries:[{...result.row,outcomeVerified:true}]},state));
});
