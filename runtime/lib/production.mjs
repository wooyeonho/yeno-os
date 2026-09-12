import {videoAvailability} from './video.mjs';

export const PRODUCTION_PROJECTS=Object.freeze({forai:'909c3180-eb2b-4d30-aba3-f5d26222cb01',yeogie:'2b999c34-a240-42cc-8154-99d66cebb32b',hankki:'327a7cca-59b3-4a43-a536-41330d7a2246',video:'61be3ace-df35-47c3-996c-de3715a94cd0',novels:'da912ff8-8a25-4011-8346-203ca2c50aeb'});
let videoCheck;
export function productionAvailability(){return videoCheck??=videoAvailability().catch(()=>({available:false,reason:'영상 제작 도구 확인이 필요합니다.'}));}
export function productionCapabilities(state,{videoAvailable=false,providerReady=false}={}){
  const completed=type=>state.jobs.filter(j=>j.type===type&&j.status==='completed');
  const capability=(id,name,status,description,types=[])=>{
    const jobs=types.flatMap(completed);return {id,name,status,description,completedOutputs:jobs.length,lastCompletedAt:jobs.map(j=>j.updatedAt).sort().at(-1)??null};
  };
  return {capabilities:[
    capability('world','God Eye · 공개 재난 관측','available','USGS 지진과 NASA EONET 자연재해를 출처·조회 시각과 함께 봅니다. 항공·선박·3D·카메라 연결은 포함되지 않습니다.',['world']),
    capability('forai','For-Ai · 페이지 점검','available','공개 페이지 또는 제공한 HTML의 구조를 실제 분석하고 수정 후보 파일을 만듭니다. AI 검색 순위 측정과 구분합니다.',['forai']),
    capability('yeogie','여기 · 장소 기록','available','선택한 장소·메모·좌표를 비공개로 보관하고 수정·내보냅니다. 안경 연결은 별도입니다.'),
    capability('hankki','한끼안부 · 식사 확인','available','동의 기록, 식사 확인 요청, 응답과 미응답 상태를 보관합니다. 외부 발송 연결 상태를 따로 표시합니다.'),
    capability('novels','소설 · 연재 작업실',providerReady?'available':'connection_required','작품 설정과 회차 원고·수정 이력을 보존하고 내려받습니다. AI 초안은 실제 결과를 확인한 후 회차로 가져옵니다.'),
    capability('video','세로 영상 제작',videoAvailable?'available':'connection_required',videoAvailable?'입력한 장면으로 한글 세로 MP4를 실제 렌더합니다. 무음·최대60초이며 자동 게시하지 않습니다.':'FFmpeg·Python·한글 폰트 설치 확인이 필요합니다.',['video']),
    capability('grok-bot','Grok Bot','connection_required','Grok Bot 계정과 앱 연결이 필요합니다. xAI 텍스트 API나 블랙홀 문서 작업을 실제 Grok Bot 실행으로 표시하지 않습니다.'),
  ],absorption:{mode:'shipped_adapters',description:'이 화면의 사용 가능 기능은 코어에 구현된 실행 경로입니다. 링크를 등록한 상태와 기능 설치를 구분합니다.',unattendedCodeExecution:false}};
}
