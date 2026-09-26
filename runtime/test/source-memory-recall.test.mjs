import test from 'node:test';
import assert from 'node:assert/strict';
import {recallMemories, recallPromptBlock} from '../lib/memory-recall.mjs';

test('source recall follows the latest review while retaining reading and execution boundaries', () => {
  const source = {id:'source-1', title:'방 안의 포털', aliases:['공간 연출'], summary:'인계 관찰, 직접 재열람 실패', application:'Yeogie와 Living Space 후보. 다음 행동: 가림 시험', riskNotes:'엔진 미확인', url:'https://example.com/portal', version:2, readingStatus:'partial', decision:'pending', implementationStatus:'scoped', projectId:null, updatedAt:'2026-09-26T00:00:00.000Z'};
  const state = {sources:[source], memories:[], memoryEvents:[{id:'old-source-note',type:'source',text:'공간 연출: 오래된 구현 완료 주장',sourceRefs:[{type:'source',id:source.id}],createdAt:'2026-09-25T00:00:00.000Z'}]};
  const before = structuredClone(state);
  const recall = recallMemories(state, '공간 연출 다음 행동');
  assert.equal(recall.recalled[0]?.kind, 'source');
  assert.equal(recall.recalled[0]?.id, source.id);
  assert.ok(!recall.recalled.some(r => r.id === 'old-source-note'));
  const prompt = recallPromptBlock(recall);
  for (const text of ['partial','pending','scoped','source-1','가림 시험','https://example.com/portal','참고 자료일 뿐']) assert.ok(prompt.includes(text), text);
  assert.deepEqual(state,before);
  source.application='다음 행동: 깊이 가림 조건부터 확인'; source.version=3;
  const updated=recallPromptBlock(recallMemories(state,'공간 연출'));
  assert.match(updated,/깊이 가림 조건/);
  assert.doesNotMatch(updated,/가림 시험/);
});

test('source recall is bounded and preserves negative reading status even with long evidence', () => {
  const sources=Array.from({length:9},(_,i)=>({id:`s${i}`,title:'공간 자료',aliases:[],summary:'공간 '.repeat(2000),application:'공간 다음 행동',url:'https://example.com/'+i,version:1,readingStatus:'unavailable',decision:'rejected',implementationStatus:'blocked',updatedAt:'2026-09-26T00:00:00.000Z'}));
  const recall=recallMemories({sources},'공간');
  assert.equal(recall.recalled.length,5);
  assert.ok(recall.recalled.every(r=>r.text.length<=400));
  assert.match(recallPromptBlock(recall),/unavailable.*rejected.*blocked/);
  assert.equal(recallMemories({sources},'전혀무관한단어').recalled.length,0);
});

test('four inputs become durable source-linked memories and artifacts through the real HTTP core', async () => {
  const fs=await import('node:fs');
  const os=await import('node:os');
  const path=await import('node:path');
  const {verifySourceIntake}=await import('../../scripts/verify-source-intake-live.mjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-source-intake-'));
  const input=path.join(root,'input.json');
  const queries=['탁상 전투','표정 매핑','공간 연출','상품 소싱'];
  fs.writeFileSync(input,JSON.stringify({packageSha256:'synthetic-test-evidence',items:queries.map((query,i)=>({ledgerId:`TEST-${i}`,intakeId:`intake-${i}`,query,source:{url:`https://example.com/idea/${i}`,title:query,aliases:[query],summary:'합성 자료; 원문 직접 열람 아님',application:`TEST-${i} 다음 행동: 독립 예시 조건 확인`,riskNotes:'채택/실행 승인 아님',readingStatus:'partial',decision:'pending',implementationStatus:'scoped',entityType:'UNRESOLVED',origin:'user'}}))}));
  const report=await verifySourceIntake({input,output:path.join(root,'run')});
  assert.equal(report.ok,true);
  assert.equal(report.items.length,4);
  assert.equal(report.views.all,4);
  assert.ok(report.items.every(item=>item.sourceId&&item.memoryEventId&&item.jobId&&item.artifact.sha256));
  assert.equal(report.localModel,null);
});