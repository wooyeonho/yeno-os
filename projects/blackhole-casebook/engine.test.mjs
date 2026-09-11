import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh,restore,search,openRecord,conclude} from './engine.mjs';
test('case can be solved through discoverable clues, retained and restored',()=>{
 let s=fresh();
 for(const query of ['비늘','청록','유리새','오렌지','보관실','익일함']){const result=search(query);assert.ok(result.length);s=openRecord(s,result[0].id);s=restore(JSON.stringify(s));}
 assert.equal(s.opened.length,6);assert.equal(conclude(s,'deleted').state.ending,null);
 s=conclude(s,'clock').state;assert.equal(s.ending,'recovered');assert.deepEqual(restore(JSON.stringify(s)),s);
});
test('no premature solution, malformed restore, duplicate progress or query execution',()=>{
 assert.equal(conclude(fresh(),'clock').state.ending,null);
 assert.deepEqual(search('<script>alert(1)</script>'),[]);assert.deepEqual(search(''),[]);
 assert.deepEqual(restore('{'),fresh());assert.deepEqual(restore({caseId:'different',opened:[]}),fresh());
 assert.equal(restore({...fresh(),ending:'recovered'}).ending,null);
 let s=openRecord(fresh(),'receipt');s=openRecord(s,'receipt');assert.deepEqual(s.opened,['receipt']);assert.deepEqual(openRecord(s,'invalid'),s);
});
