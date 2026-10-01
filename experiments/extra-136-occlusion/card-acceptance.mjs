// Task-specific, fail-closed acceptance for the verified EXTRA-136 2D scene.
// The model's semantic verdict cannot replace these source-bound checks.
import {projectObject} from './scene-core.mjs';
import {isDeepStrictEqual} from 'node:util';

const same=isDeepStrictEqual;
const keys=(value,expected)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&same(Object.keys(value).sort(),expected.slice().sort());
const korean=value=>typeof value==='string'&&value.length>=8&&value.length<=300&&/[가-힣]/.test(value);
const ids=['source','scene','states','tests','execution'];

function parseCard(artifact){
  if(typeof artifact!=='string'||Buffer.byteLength(artifact)>30000)return null;
  const withoutHeader=artifact.trim().replace(/^### builder · job [^\n]+\n+/,'');
  const body=withoutHeader.split(/\n---\nBLACKHOLE AI 초안/)[0].trim();
  const match=/^```extra136-card-v1\r?\n([\s\S]+)\r?\n```$/.exec(body);
  if(!match||Buffer.byteLength(match[1])>12000)return null;
  try{return JSON.parse(match[1]);}catch{return null;}
}

export function evaluateExtra136Card(artifact,{sceneInput,sourceId,sceneInputSha256}){
  const card=parseCard(artifact);
  if(!card||!keys(card,['version','ledgerId','sourceId','sourceStatus','unknowns','scene','states','tests','outputs','workSteps','evidence']))
    return {passed:false,checks:ids.map(id=>({id,passed:false,reason:'missing_or_invalid_contract'}))};

  const source=card.version===1&&card.ledgerId==='EXTRA-136'&&card.sourceId===sourceId&&card.sourceStatus==='partial/pending'
    &&keys(card.unknowns,['originalVideo','device','engine','arTracking','actualTest'])
    &&Object.values(card.unknowns).every(value=>value===false);
  const expectedPortal={center:sceneInput.portal.center,radius:sceneInput.portal.radius,depthPlane:sceneInput.portal.depthPlane};
  const scene=keys(card.scene,['canvas','portal','background','occluder','subject','path'])
    &&same(card.scene.canvas,sceneInput.canvas)&&same(card.scene.portal,expectedPortal)
    &&korean(card.scene.background)&&korean(card.scene.occluder)&&card.scene.occluder.includes('불투명')
    &&card.scene.subject===sceneInput.subject&&same(card.scene.path,[0,50,78,100]);
  const expectedStates=sceneInput.frames.map(frame=>{
    const projected=projectObject({position:frame.position,depth:frame.depth});
    return {name:frame.name,position:frame.position,depth:frame.depth,visibility:projected.visibility,layer:projected.layer};
  });
  const states=Array.isArray(card.states)&&card.states.length===expectedStates.length
    &&card.states.every((state,index)=>keys(state,['name','position','depth','visibility','layer'])&&same(state,expectedStates[index]));
  const expectedTests=[
    {kind:'fixed',frames:['front','hidden','reappear'],rejectForegroundLeak:true,status:'planned'},
    {kind:'boundary',frames:['reappear','partial-edge','outside'],rejectForegroundLeak:true,status:'planned'},
  ];
  const tests=Array.isArray(card.tests)&&card.tests.length===2&&card.tests.every((value,index)=>keys(value,['kind','frames','rejectForegroundLeak','status'])&&same(value,expectedTests[index]))
    &&same(card.outputs,{screenshots:3,videos:1,videoStatus:'planned'});
  const expectedEvidence={sceneInputSha256,htmlSha256:sceneInput.htmlSha256,browserReportSha256:sceneInput.browserChecks.reportSha256};
  const stepKinds=['build','capture','boundary-check'];
  const execution=Array.isArray(card.workSteps)&&card.workSteps.length===3
    &&card.workSteps.every((step,index)=>keys(step,['kind','instruction'])&&step.kind===stepKinds[index]&&korean(step.instruction))
    &&same(card.evidence,expectedEvidence);
  const values=[source,scene,states,tests,execution];
  const checks=ids.map((id,index)=>({id,passed:values[index],reason:values[index]?null:'contract_mismatch'}));
  return {passed:values.every(Boolean),checks};
}
