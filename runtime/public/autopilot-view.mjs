import {createAutopilotView as createEngineView} from './autopilot-view-engine.mjs';

function applyIndependentPolicy(root,state) {
  if(!root||state?.autopilot?.backgroundModelCalls!==false)return;
  const metric=root.querySelector('.cockpit-signals > div:first-child');
  if(metric){
    const label=metric.querySelector('small'),value=metric.querySelector('strong');
    if(label)label.textContent='백그라운드 AI';
    if(value)value.textContent='꺼짐';
  }
  const scope=root.querySelector('details[data-section="scope"] .studio-card');
  const automatic=scope?.querySelector('.studio-fields p:first-child');
  if(automatic)automatic.innerHTML='<strong>자동 AI 사용</strong><br>사용 안 함 · 명시적 호출만';
  const note=scope?.querySelector('.studio-note');
  if(note)note.textContent='독립 운영 모드입니다. 평상시 목표 선택·자료 관측·검증된 기능 실행·결과 저장·복구에는 모델을 호출하지 않습니다. AI는 연호님이 질문·음성·연구·코딩을 명시적으로 실행할 때만 사용합니다.';
}

export function createAutopilotView(options) {
  const view=createEngineView(options),root=options?.root;
  return {
    updateState(state){view.updateState(state);applyIndependentPolicy(root,state);},
    reset(){view.reset();},
    destroy(){view.destroy();},
  };
}
