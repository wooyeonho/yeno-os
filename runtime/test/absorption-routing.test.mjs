import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceDestination,absorptionDocument} from '../public/absorption-routing.mjs';
test('references route to features, existing projects or review without creating projects or changing reading status',()=>{
 const projects=[{id:'a',name:'A01 — For-Ai',status:'active'},{id:'old',name:'yeno-os',status:'archived'}];
 const god={id:'s',title:'공개 데이터를 모은 세계 상황판',canonicalUrl:'https://instagram.com/reel/DcjMGA9vHxU',projectId:'old',readingStatus:'unread',decision:'pending'};
 const before=structuredClone({god,projects});assert.equal(sourceDestination(god,projects).kind,'feature');
 assert.equal(sourceDestination({...god,title:'GEO 검색',canonicalUrl:'https://example.com/geo'},projects).projectId,'a');
 assert.equal(sourceDestination({...god,title:'Life Clock',canonicalUrl:'https://example.com/new'},projects).kind,'project-review');
 assert.equal(sourceDestination({...god,title:'제목 불명',canonicalUrl:'https://example.com/unknown'},projects).kind,'unclassified');
 assert.equal(sourceDestination({...god,projectId:'a'},projects).kind,'project');
 assert.match(absorptionDocument([god],projects),/unread\/pending/);assert.deepEqual({god,projects},before);
 const many=Array.from({length:1000},(_,i)=>({...god,id:`s${i}`,title:'가'.repeat(160),projectId:null}));assert.ok(absorptionDocument(many,projects).length<80000);
});
