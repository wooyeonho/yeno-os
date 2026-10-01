import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';

const scene=JSON.parse(fs.readFileSync(new URL('../../experiments/extra-136-occlusion/SCENE_INPUT_20260927.json',import.meta.url),'utf8'));
const sourceId=randomUUID(),sceneInputSha256='a'.repeat(64);
const goodCard=()=>({
  version:1,ledgerId:'EXTRA-136',sourceId,sourceStatus:'partial/pending',
  unknowns:{originalVideo:false,device:false,engine:false,arTracking:false,actualTest:false},
  scene:{canvas:scene.canvas,portal:{center:scene.portal.center,radius:scene.portal.radius,depthPlane:scene.portal.depthPlane},background:'독자 제작한 어두운 방',occluder:'불투명한 타원 문틀과 벽',subject:scene.subject,path:[0,50,78,100]},
  states:scene.frames.map(({name,position,depth,visibility,layer})=>({name,position,depth,visibility,layer})),
  tests:[{kind:'fixed',frames:['front','hidden','reappear'],rejectForegroundLeak:true,status:'planned'},{kind:'boundary',frames:['reappear','partial-edge','outside'],rejectForegroundLeak:true,status:'planned'}],
  outputs:{screenshots:3,videos:1,videoStatus:'planned'},
  workSteps:[{kind:'build',instruction:'독자 SVG 장면을 생성한다'},{kind:'capture',instruction:'고정 키프레임을 캡처한다'},{kind:'boundary-check',instruction:'경계 이동에서 가림 누출을 확인한다'}],
  evidence:{sceneInputSha256,htmlSha256:scene.htmlSha256,browserReportSha256:scene.browserChecks.reportSha256},
});
const block=card=>`\`\`\`extra136-card-v1\n${JSON.stringify(card)}\n\`\`\``;
const input={sceneInput:scene,sourceId,sceneInputSha256};

test('a matching structured EXTRA-136 card satisfies all five predeclared acceptance groups',async()=>{
  const {evaluateExtra136Card}=await import('../../experiments/extra-136-occlusion/card-acceptance.mjs');
  const result=evaluateExtra136Card(block(goodCard()),input);
  assert.equal(result.passed,true);
  assert.deepEqual(result.checks.map(check=>check.passed),[true,true,true,true,true]);
  const reordered=goodCard();reordered.scene.portal={depthPlane:50,radius:scene.portal.radius,center:scene.portal.center};
  assert.equal(evaluateExtra136Card(block(reordered),input).passed,true,'JSON object key order has no semantic effect');
});

test('the historical freeform Builder card and contradictory prose cannot be accepted',async()=>{
  const {evaluateExtra136Card}=await import('../../experiments/extra-136-occlusion/card-acceptance.mjs');
  assert.equal(evaluateExtra136Card('침실 벽·침대·커튼·빛나는 구름. 영상 3개.',input).passed,false);
  assert.equal(evaluateExtra136Card(`침실로 바꿉니다.\n${block(goodCard())}`,input).passed,false);
});

test('a fabricated source, wrong visibility or video count fails its own acceptance group',async()=>{
  const {evaluateExtra136Card}=await import('../../experiments/extra-136-occlusion/card-acceptance.mjs');
  const forged=goodCard();forged.sourceId=randomUUID();
  assert.equal(evaluateExtra136Card(block(forged),input).checks[0].passed,false);
  const wrongState=goodCard();wrongState.states[1].visibility='front';
  assert.equal(evaluateExtra136Card(block(wrongState),input).checks[2].passed,false);
  const wrongOutput=goodCard();wrongOutput.outputs.videos=3;
  assert.equal(evaluateExtra136Card(block(wrongOutput),input).checks[3].passed,false);
  const wrongStep=goodCard();wrongStep.workSteps[2].kind='research';
  assert.equal(evaluateExtra136Card(block(wrongStep),input).checks[4].passed,false);
});
