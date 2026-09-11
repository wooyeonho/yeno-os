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
  if (/DcjMGA9vHxU/.test(source.canonicalUrl) || /세계 상황판|God.?s?\s*Eye|USGS|Natural Earth/i.test(text)) return feature('world', '세계 상황판', '지진 조회 사용 가능', '세계 현황');
  if (/screenpipe|화면 기억/i.test(text)) return feature('screen-memory', '선택한 화면의 기억', '권한·라이선스 검토');
  if (/MegaMemory|ArcRift|OSIRIS|기억|memory/i.test(text)) return feature('memory', '지속 기억·관련 내용 검색', '기본 기억 사용 가능 / 외부 도구 통합 대기', '찾아줘: 검색어');
  if (/Postiz|social-media-skills|배포|SNS 콘텐츠 재가공/i.test(text)) return apply('B02-6', 'B02-6 · 콘텐츠 배포');
  if (/ComfyUI|Pollo|Higgsfield|영상 생성|영상 제작|링크.*영상|TouchDesigner/i.test(text)) return feature('content-render', '글·영상 제작', '영상 CLI 준비 / 폰 실행 연결 대기');
  if (/Grok|Jarvis|에이전트|스킬|Claude Code|Codex|n8n/i.test(text)) return feature('execution', '작업 배정·실행·검증', '일부 읽기 도구 구현 / 무인 개발 미연결');
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
