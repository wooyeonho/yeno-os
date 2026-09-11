// Original fiction and engine. No external game text, assets or code included.
export const CASE_ID = 'missing-tomorrow-v1';
export const RECORDS = [
  {id:'receipt',title:'접수증 041',tags:['비늘','041'],body:'전시실 「비늘」의 마지막 녹음이 사라졌다. 접수 시각 22:10. 장비 담당 서린은 “청록 운송함을 먼저 확인해 달라”고 적었다.'},
  {id:'crate',title:'청록 운송함 목록',tags:['청록','운송함'],body:'운송함에는 녹음기와 종이 봉투 하나가 있었다. 봉투에 적힌 이름은 「유리새」. 반출 승인자는 윤재. 봉투를 열지 않고 보관실로 옮겼다는 서명이 남아 있다.'},
  {id:'letter',title:'유리새의 편지',tags:['유리새','봉투'],body:'“작품은 지워지지 않았어요. 21:58에 보관실에서 직접 재생했습니다. 벽시계와 녹음기의 시간이 달랐어요. 점검표에는 오렌지라는 표시가 있었고요.” — 윤재'},
  {id:'clock',title:'오렌지 점검표',tags:['오렌지','점검표'],body:'22:00 정기 점검. 녹음기 내부 시계가 24시간 빠른 것을 확인했다. 파일을 삭제하지 않고 날짜만 수정할 예정. 날짜가 다른 파일은 오늘 목록에서 보이지 않는다. 담당: 서린.'},
  {id:'log',title:'보관실 읽기 기록',tags:['보관실','서린'],body:'보관실 원장에는 「익일함」 항목이 있다. 21:58 윤재: 재생. 22:00 서린: 점검. 삭제 요청: 0건. 반출: 0건. 내보내기 사본의 해시는 원본과 일치한다.'},
  {id:'archive',title:'익일함의 녹음',tags:['익일함'],body:'다음 날짜의 목록에서 마지막 녹음을 찾았다. 파일은 온전하다. 전시실 재생 목록은 오늘 날짜만 보여 주고 있었다. 날짜를 바로잡자 녹음이 다시 나타났다.'},
];
const ids = new Set(RECORDS.map(r=>r.id));
const key = value => String(value).normalize('NFKC').trim().toLocaleLowerCase();
export function search(query) {
  const q=key(query);
  if(q.length<2 || q.length>80) return [];
  return RECORDS.filter(r=>r.tags.some(tag=>key(tag).includes(q)||q.includes(key(tag))));
}
export function fresh() {return {caseId:CASE_ID,opened:[],ending:null};}
export function restore(raw) {
  try {
    const s=typeof raw==='string'?JSON.parse(raw):raw;
    if(!s || s.caseId!==CASE_ID || !Array.isArray(s.opened) || s.opened.length>RECORDS.length || s.opened.some(id=>!ids.has(id)) || new Set(s.opened).size!==s.opened.length) return fresh();
    const opened=[...s.opened];
    return {caseId:CASE_ID,opened,ending:s.ending==='recovered'&&['clock','log','archive'].every(id=>opened.includes(id))?'recovered':null};
  } catch {return fresh();}
}
export function openRecord(state,id) {
  const s=restore(state);
  if(ids.has(id)&&!s.opened.includes(id))s.opened.push(id);
  return s;
}
export function conclude(state,choice) {
  const s=restore(state);
  if(!['clock','log','archive'].every(id=>s.opened.includes(id))) return {state:s,message:'아직 근거가 부족합니다. 점검표·읽기 기록·녹음을 찾아 확인하세요.'};
  if(choice!=='clock')return {state:s,message:'기록과 맞지 않는 결론입니다. 삭제·반출 기록과 시계의 차이를 다시 확인하세요.'};
  s.ending='recovered';
  return {state:s,message:'사건 해결. 사라진 것은 파일이 아니라 오늘 목록에서의 위치였습니다. 시간 오차를 바로잡아 녹음을 복구했습니다.'};
}
