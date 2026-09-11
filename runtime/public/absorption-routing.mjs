import { sourceReferenceNames } from './source-reference-labels.mjs';

const project = (projects, code) => projects.find(p => p.status !== 'archived' && (p.name === code || p.name.startsWith(`${code} — `))) ?? null;
export function sourceDestination(source, projects = []) {
  // A routing proposal based on stored titles; never an automatic source review,
  // project creation, installation, or claim about unseen video contents.
  const explicit = projects.find(p => p.id === source.projectId && p.status !== 'archived');
  if (explicit) return { kind: 'project', name: explicit.name, projectId: explicit.id, basis: '등록된 프로젝트 연결', stage: '검토 대기' };
  const text = [source.title, ...sourceReferenceNames(source)].join(' ');
  const feature = (key, name, stage = '구현 대기', command = null) => ({ kind: 'feature', key, name, stage, command, basis: '원본 자료명에 따른 기능 분류 제안' });
  const apply = (code, name) => ({ kind: 'project', code, name, projectId: project(projects, code)?.id ?? null, stage: '적용 검토', basis: '기존 프로젝트 목표와 원본 자료명 대조' });
  // Specific domains precede broad agent/marketing keywords. Reading status
  // stays independent: routing an unread reference is not adopting its claims.
  if (/Polymarket|퀀트|예측 시장|투자 발언|주가 데이터/i.test(text)) return apply('V03', 'V03 · 예측시장 모의 연구 (실거래 제외)');
  if (/No Results Found/i.test(text)) return apply('V11', 'V11 · BLACKHOLE 기록실');
  if (/Life Clock/i.test(text)) return apply('A04', 'A04 · 시간·문화 캘린더 참고');
  if (/Photon Matrix/i.test(text)) return apply('C01', 'C01 · 외부 하드웨어 조사 (도입 보류)');
  if (/AI 안경|스마트글래스|Yeogie/i.test(text)) return apply('A02', 'A02 · 여기·스마트글래스 입력');
  if (/개인정보|사이버보안|보안 에이전트/i.test(text)) return feature('privacy', '개인정보·권한·보안 점검', '기기 폐기·백업 구현 / 외부 삭제 자동화 미연결');
  if (/OSIRIS|자료 발굴|주도적인 자료|변화 감지/i.test(text)) return feature('discovery', '공개 자료 발견·변화 확인', 'GitHub 주제·공식 릴리스 수집 / 모든 SNS 자동 열람 미연결');
  if (/W3C PROV|출처와 파생/i.test(text)) return feature('provenance', '출처·파생 관계 추적', '기본 출처·해시 구현 / 표준 전체 통합 대기');
  if (/검사와 배포 환경|GitHub.*배포/i.test(text)) return feature('release', '빌드·배포·복원 검증', 'APK 빌드·코어 검사 구현 / 운영 승격 별도');
  if (/NotebookLM|LangGraph|작업 상태와 장기 기억/i.test(text)) return feature('memory', '지속 기억·관련 내용 검색', '기본 기억 사용 가능 / 외부 도구 통합 대기', '찾아줘: 검색어');
  if (/MoneyPrinterTurbo|스프라이트|이미지 생성|빈티지 스케치|모션 추적|라이브 월페이퍼/i.test(text)) return feature('content-render', '글·영상 제작', '영상 CLI 준비 / 폰 실행 연결 대기');
  if (/경영진 역할|Hermes Agent|OpenHands|gemini-cli|claude-code/i.test(text)) return feature('execution', '작업 배정·실행·검증', '일부 읽기 도구 구현 / 무인 개발 미연결');
  if (/수익화|사업|기회/i.test(text)) return apply('C01', 'C01 · Buzz 기회 조사');
  if (/AI 프롬프트/i.test(text)) return feature('prompts', '검증한 작업 지시문 재사용', '자료 분류 / 실행 효과 검증 대기');
  if (/Private Tutor|학습 홍보/i.test(text)) return feature('learning', '학습·근거 확인 도우미');
  if (/인터랙티브 웹|웹 앱 제작/i.test(text)) return feature('app-builder', '화면·앱 제작 도구', '현재 세션 구현 / 무인 생성 미연결');
  if (/배틀그라운드|게임 설계/i.test(text)) return apply('V09', 'V09 · 게임 설계 참고 (원문 검증 전)');
  if (/블로그 키워드|마케팅 레퍼런스/i.test(text)) return apply('A01', 'A01 · 검색·콘텐츠 근거 조사');
  if (/유튜브 창작|TikTok Shop|K뷰티/i.test(text)) return apply('B02', 'B02 · ShoppingShorts');
  if (/DcjMGA9vHxU/.test(source.canonicalUrl) || /세계 상황판|God.?s?\s*Eye|USGS|Natural Earth/i.test(text)) return feature('world', '세계 상황판', '지진 조회 구현·검사 완료 / 운영 반영 확인 필요', '세계 현황');
  if (/screenpipe|화면 기억/i.test(text)) return feature('screen-memory', '선택한 화면의 기억', '권한·라이선스 검토');
  if (/MegaMemory|ArcRift|기억|memory/i.test(text)) return feature('memory', '지속 기억·관련 내용 검색', '기본 기억 사용 가능 / 외부 도구 통합 대기', '찾아줘: 검색어');
  if (/Postiz|social-media-skills|배포|SNS 콘텐츠 재가공/i.test(text)) return apply('B02-6', 'B02-6 · 콘텐츠 배포');
  if (/ComfyUI|Pollo|Higgsfield|영상 생성|영상 제작|링크.*영상|TouchDesigner/i.test(text)) return feature('content-render', '글·영상 제작', '영상 CLI 준비 / 폰 실행 연결 대기');
  if (/Grok|Jarvis|자비스|에이전트|스킬|Claude Code|Codex|n8n/i.test(text)) return feature('execution', '작업 배정·실행·검증', '일부 읽기 도구 구현 / 무인 개발 미연결');
  if (/Qwen|OmniRoute|Token|모델|비용 관찰/i.test(text)) return feature('model-routing', '모델 선택·비용 관리', '연결부 구현 / 실제 모델 인증 대기');
  if (/Fish Audio|음성/i.test(text)) return feature('voice', '음성 입력·응답');
  if (/GEO|SEO|For.?Ai/i.test(text)) return apply('A01', 'A01 · For-Ai');
  if (/Polymarket|퀀트|예측 시장|투자 발언/i.test(text)) return apply('V03', 'V03 · 예측시장 모의 연구 (실거래 제외)');
  if (/캐릭터|소설|세계관|동물 힐링/i.test(text)) return apply('B04', 'B04 · 소설·캐릭터 IP');
  if (/숏폼|광고|쇼핑|릴스|SideShift|콘텐츠|당근스토리/i.test(text)) return apply('B02', 'B02 · ShoppingShorts');
  if (/Buzz|사업|수익화|기회/i.test(text)) return apply('C01', 'C01 · Buzz 기회 조사');
  if (/Life Clock|Photon Matrix|No Results Found/i.test(text)) return { kind: 'project-review', name: '독립 프로젝트 여부 검토', stage: '고객·결과물·기존 프로젝트 중복 확인 전', basis: '독립 결과물이 있는 원본 아이디어; 신규 프로젝트는 아직 만들지 않음' };
  return { kind: 'unclassified', name: '원문 확인 후 분류', stage: '대기', basis: '이름만으로 기능이나 프로젝트를 확정할 근거 부족' };
}

export function absorptionDocument(sources, projects) {
  const groups = new Map();
  for (const source of sources) {
    const dest = sourceDestination(source, projects), key = `${dest.kind}:${dest.name}`;
    if (!groups.has(key)) groups.set(key, { dest, sources: [] });
    groups.get(key).sources.push(source);
  }
  const labels = { feature: '공통 기능', project: '기존 프로젝트 적용', 'project-review': '새 프로젝트 검토', unclassified: '분류 대기' };
  const counts = Object.fromEntries(Object.keys(labels).map(kind => [kind, sources.filter(s => sourceDestination(s, projects).kind === kind).length]));
  let remaining = 120;
  const line = s => `- ${s.title.replace(/[\r\n]/g, ' ')} · ${s.readingStatus}/${s.decision} · ID ${s.id}`;
  return `# BLACKHOLE 흡수 계획\n\n${Object.entries(counts).map(([kind, count]) => `${labels[kind]} ${count}개 자료`).join(' / ')}\n\n원본 자료명과 기존 프로젝트 목표를 대조한 분류입니다. 원문 읽기/채택 상태는 그대로 보존합니다. 설치·프로젝트 생성·기능 실행은 각각 별도이며 등록만으로 완료 처리하지 않습니다.\n\n${[...groups.values()].slice(0, 30).map(({ dest, sources: items }) => { const shown=items.slice(0,Math.min(15,remaining));remaining-=shown.length;return `## ${labels[dest.kind]} — ${dest.name}\n- 상태: ${dest.stage}\n- 분류 근거: ${dest.basis}\n${dest.command ? `- 실행 명령: ${dest.command}\n` : ''}${dest.projectId ? `- 기존 프로젝트 ID: ${dest.projectId}\n` : ''}${shown.map(line).join('\n')}${items.length > shown.length ? `\n- 나머지 ${items.length - shown.length}개는 자료 목록에서 조회` : ''}`;}).join('\n\n')}\n\n## 새 자료를 추가하는 기준\n원 제작자 문서/코드 확인 → 권리·비용·개인정보 확인 → 기존 기능/프로젝트 중복 대조 → 최소 실행과 결과·중단·복구 시험. 공통으로 재사용할 능력은 기능으로, 고객과 결과물이 분명한 독립 과제는 프로젝트로 분리합니다. 여행 자료는 개선 후보에서 제외합니다.\n\n현재 상주 수집기의 GitHub 검색 범위와, 이 대화에서 수행한 Product Hunt·Reddit·X·Instagram 공개 조사를 구분합니다. 모든 사이트의 트렌드를 코어가 자동 열람하도록 연결된 상태는 아닙니다.\n`;
}
