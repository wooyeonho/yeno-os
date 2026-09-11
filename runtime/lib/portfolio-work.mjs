import {sourceDestination} from '../public/absorption-routing.mjs';

// Delivery definitions, not successful job executions or automatic bot orders.
// Original goals remain in the registry; this chooses the smallest first unit.
const units={
 C00:['전체 프로젝트·자료 연결표와 실행 증거 색인','원본49개 ID·목표 보존, 모든 자료가 연결 또는 확인 대기로 표시됨'],
 C01:['공개 근거를 남기는 기회 평가표와 1개 검증 사례','고객 문제·기존 지출·반증·다음 실험을 분리하고 홍보 수익 수치를 확정값으로 쓰지 않음'],
 E01:['AMR 공개 집계 CSV 입력·정규화·누락 보고서','국가·기간·병원체·검체·분모가 다른 수치를 섞지 않고 원자료/재현 경로 보존'],
 E02:['Long COVID 근거 표와 업데이트 비교 입력기','연구 설계·대상·평가 시점·불확실성을 구분하고 치료 조언으로 출력하지 않음'],
 E03:['노화 연구 평가변수·대상종 근거 표','동물/세포 결과를 사람 수명 효과로 합치지 않고 원문·한계 추적'],
 E04:['탄소 제거 주장·경계·기간 비교 계산기','단위·시스템 경계·영속성·중복 계상을 드러내고 검증 안 된 수치를 분리'],
 E05:['배터리 안전 자료의 시험조건 비교표','셀/팩·화학계·온도·측정 조건을 보존하고 실제 제어·실험은 수행하지 않음'],
 E06:['기후 이동·건강 공개 집계 데이터 연결표','지역/기간 대응과 결측을 표시하고 개인 위치/건강 데이터 수집 없이 재현'],
 E07:['공식 감염병 공지의 출처·시각·변경 비교기','발표일과 사건일, 확인과 추정을 분리하고 미확인 경보를 발송하지 않음'],
 E08:['재료 데이터셋 단위·분할·누출 점검기','중복 시료와 데이터 누출을 검출하며 새 물질 성능을 검증한 것처럼 표시하지 않음'],
 E09:['보건 데이터 가용성·결측·라이선스 목록','누락/비공개/접근 실패를 구분하고 실제 읽은 데이터만 사용 가능 처리'],
 V01:['Shopify 지급 예외 합성 CSV 대조기','누락·중복·금액 불일치 3종을 재현하고 은행 연결/송금 없이 결과 파일 생성'],
 V02:['계정 전환 전후 권한·설정 차이 보고서','비밀값 저장 없이 변경·누락·동일 항목 구분; 실제 계정 변경 없음'],
 V03:['예측시장 PAPER_ONLY 기록·비용 포함 모의 성과 계산기','미래 데이터 누출과 중복 사건 방지; 주문·지갑·실거래 연결 없음'],
 V04:['역할/관계/상태가 분리된 단일 대화 시나리오','캐릭터 설정 변경이 과거 사실을 덮어쓰지 않고 허구/실제 사용자를 구분'],
 V05:['PangPang Diffuser 사용 문제·제품 사양 초안','원본 목표와 확인된 사용자 문제를 대조하고 제조/안전/판매 승인을 완료로 표시하지 않음'],
 V06:['막걸리 취향 기록·제품 비교 입력 화면','평가/원자료/광고를 분리하고 검증 전 추천·구매 자동화 없음'],
 V07:['KBO 팬 활동 기록·원본 콘텐츠 보관 화면','팀/선수 사진·영상은 권리 확인 전 사용하지 않고 자체 기록 저장/삭제 확인'],
 V08:['틈새 수요 후보의 문제·지출 근거 비교표','경쟁·관측 표본·반증을 포함하고 별점/유행만으로 채택하지 않음'],
 V09:['역사 사실과 가상 분기를 나눈 작은 상태 전이 엔진','사실 출처 보존, 가상 분기 명시, 같은 입력 재현·되돌리기 확인'],
 V10:['동의된 기억만 쓰는 재구성 프로필·삭제/내보내기 흐름','실존인처럼 속이지 않고 AI 재구성 표시; 실제 고인/가족 자료 없이 합성 입력으로 검사'],
 A01:['공개 페이지의 출처·구조·AI 검색 노출 점검 보고서','관측 결과와 개선 가설 분리, 원본 문장 무단 복제·순위 보장 없음'],
 A02:['소유자가 선택한 장소 메모·미디어 접수 화면','명시적 선택 입력, 위치 기본 비공개, 삭제/내보내기, 안경 연결 여부 정확히 표시'],
 A03:['한끼 확인 요청·응답·미응답 상태 엔진','중복 응답·시간대·취소 처리, 실제 보호자 발송 없이 합성 입력으로 검증'],
 A04:['절기·기념일·관계 알림을 분리한 날짜 데이터 구조','출처와 시간대 보존, 미확인 Life Clock은 참고만 유지, 실제 알림 발송 전'],
 A05:['기억 근거와 상태를 보여 주는 개인 동반자 흐름','성격/기억/실행 권한 분리, 실제 AI 연결 상태 표시, 정지·삭제 가능'],
 B01:['기도/안부 요청의 공개 범위·응답 흐름','익명·비공개 기본, 삭제/차단 가능, 연락처 자동 수집/발송 없음'],
 B02:['원본 콘텐츠→제작→검토→배포 상태 연결표','하위6개 단계 산출물 연결과 원본 해시 보존; 게시 전 검토 상태 구분'],
 'B02-1':['쇼핑 공유 링크와 제휴 표시 기록기','URL 중복·권리·제휴 고지 필드를 검증하고 실제 링크 발급/게시 상태 구분'],
 'B02-2':['맛집 콘텐츠의 원본 근거·협찬 표시 초안','직접 경험과 제공 자료를 구분; 무단 사진/거짓 후기·자동 게시 없음'],
 'B02-3':['Daum 채널용 제목·본문·출처 초안 묶음','원본과 파생 문서 연결, 권리/광고 표시, 실제 발행은 별도'],
 'B02-4':['자체 원고·자체 이미지로 짧은 영상 파일 한 개 생성','실제 재생 파일·길이·코덱 확인; 권리 미확인 영상/음성 재사용 없음'],
 'B02-5':['제품 후보의 고객 문제·구매 조건 검증표','가격 확인 시각·재고 불확실성·반증 보존, 자동 구매/수익 보장 없음'],
 'B02-6':['원본 하나의 채널별 초안·예약·취소 상태 엔진','Postiz 구조 참고, 모의 채널에서 동일 요청 중복과 취소 확인; OAuth·외부 게시 별도'],
 B03:['오리지널 55mm 모션 조형물 사양과 미리보기','원본 형태·출력 치수·라이선스 확인; 실물 출력/판매 완료로 표시하지 않음'],
 B04:['각 작품의 설정집·정사·원고·검토 분리 구조','하위13개 작품을 빠짐없이 연결하고 캐릭터/사건 충돌을 기록'],
 V11:['검색 추리 게임 사라진 내일 플레이 시제품','6개 기록→근거 대조→결말과 진행 저장/복원; 실제 Android 조작은 확인 전'],
};

export function projectWork(project,sources,projects){
 const code=project.name.split(/\s+/)[0];
 const unit=/^B04-\d{2}$/.test(code)?[`${project.name.split(' — ').slice(1).join(' — ')}: 설정집·첫 장면·연속성 점검`, '기존 원본 설정을 보존하고 허구/역사 근거 분리, 원고와 검토 기록을 별도 보관; 다른 작품 설정 혼입 없음']:units[code];
 if(!unit)throw new Error(`Missing first delivery for ${code}`);
 const direct=sources.filter(s=>{const d=sourceDestination(s,projects);return d.kind==='project'&&(d.projectId===project.id||d.code===code);});
 const shared=sources.filter(s=>sourceDestination(s,projects).kind==='feature');
 return {projectId:project.id,code,name:project.name,originalGoal:project.summary,firstDeliverable:unit[0],acceptance:unit[1],stage:code==='V11'?'prototype-tested':'implementation-queued',directSourceIds:direct.map(s=>s.id),sharedSourceIds:shared.map(s=>s.id),blockedBy:code==='V11'?['Android actual file opening/reopen check']:[],completionEvidence:code==='V11'?['projects/blackhole-casebook/engine.test.mjs (2 passed)']:[]};
}
export function portfolioWork(projects,sources){
 const active=projects.filter(p=>p.status!=='archived');
 const shared=sources.filter(s=>sourceDestination(s,projects).kind==='feature').map(s=>s.id);
 return {basis:'Owner requested all original 49 projects and all available non-travel development references. These are delivery assignments, not completed product implementations.',sharedReferenceGroups:{'common-features':shared},projects:active.map(p=>{const {sharedSourceIds,...work}=projectWork(p,sources,projects);return {...work,sharedSourceCount:sharedSourceIds.length,sharedReferenceGroup:'common-features'};}),sources:sources.map(s=>({sourceId:s.id,url:s.canonicalUrl,title:s.title,readingStatus:s.readingStatus,decision:s.decision,destination:sourceDestination(s,projects)}))};
}
