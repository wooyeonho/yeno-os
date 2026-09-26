import {projectObject} from './scene-core.mjs';

const workspace=document.querySelector('.workspace');
const position=document.querySelector('#position');
const depth=document.querySelector('#depth');
const rearOrb=document.querySelector('#rearOrb');
const frontOrb=document.querySelector('#frontOrb');
const presets={front:{position:50,depth:20},through:{position:50,depth:70},hidden:{position:0,depth:70}};
const copy={
  front:['문 앞에서 보임','물체가 깊이 기준 앞에 있어 문 바깥에서도 보입니다.'],
  through:['문 안쪽에서 보임','물체가 깊이 기준 뒤에 있지만 문의 열린 영역 안에 있습니다.'],
  hidden:['문 뒤에 완전히 가려짐','물체가 깊이 기준 뒤에 있고 열린 영역 바깥에 있어 보이지 않습니다.'],
};
const value=(selector,text)=>{document.querySelector(selector).textContent=String(text);};

function render(){
  const result=projectObject({position:Number(position.value),depth:Number(depth.value)});
  const transform=`translate(${result.x} ${result.y}) scale(${result.radius})`;
  rearOrb.setAttribute('transform',transform);
  frontOrb.setAttribute('transform',transform);
  rearOrb.toggleAttribute('hidden',result.layer!=='behind'||!result.visible);
  frontOrb.toggleAttribute('hidden',result.layer!=='front');
  workspace.dataset.visibility=result.visibility;
  value('#positionValue',result.position);
  value('#depthValue',result.depth);
  value('#result-title',copy[result.visibility][0]);
  value('#resultDetail',copy[result.visibility][1]);
  value('#metricX',Math.round(result.x));
  value('#metricDepth',result.depth);
  value('#metricLayer',result.layer==='behind'?'뒤쪽 / 클립':'앞쪽 / 전체');
  value('#scene-desc',`물체 깊이 ${result.depth}, 수평 위치 ${result.position}. ${copy[result.visibility][0]}.`);
  for(const button of document.querySelectorAll('[data-preset]')){
    const preset=presets[button.dataset.preset];
    button.setAttribute('aria-pressed',String(preset.position===result.position&&preset.depth===result.depth));
  }
}

for(const slider of [position,depth])slider.addEventListener('input',render);
for(const button of document.querySelectorAll('[data-preset]'))button.addEventListener('click',()=>{
  const preset=presets[button.dataset.preset];
  position.value=String(preset.position);
  depth.value=String(preset.depth);
  render();
});
render();