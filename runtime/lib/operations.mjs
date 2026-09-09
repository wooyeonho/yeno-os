const JOB_STATES = [
  ['queued', '대기'], ['running', '실행 중'], ['paused', '일시정지'],
  ['failed', '실패'], ['completed', '완료'], ['cancelled', '취소'],
];
const READING_STATES = ['unread', 'partial', 'read', 'unavailable'];
const DECISIONS = ['pending', 'candidate', 'deferred', 'rejected'];
const DISPLAY_LIMIT = 20;

const list = value => Array.isArray(value) ? value : [];

// Metadata is displayed as one bounded, inert Markdown line. Never render a
// project action as instructions/HTML, or copy job inputs, drafts or secrets.
function plain(value, maximum = 120, fallback = '미기록') {
  if (typeof value !== 'string') return fallback;
  const clean = value.slice(0, maximum + 1)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  let rendered = '', truncated = value.length > maximum;
  for (const character of clean) {
    const escaped = ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]
      ?? (/[\\`*_{}\[\]()#!|~]/.test(character) ? `\\${character}` : character);
    // Bound the escaped result as well as the input, without cutting an HTML
    // entity or Markdown escape in half. Ampersands can otherwise grow 5x.
    if (rendered.length + escaped.length > maximum) { truncated = true; break; }
    rendered += escaped;
  }
  return rendered + (truncated ? '… (일부 표시)' : '');
}

function countBy(records, field, states) {
  const counts = new Map(states.map(status => [status, 0]));
  let unknown = 0;
  for (const record of records) {
    const status = record?.[field];
    if (counts.has(status)) counts.set(status, counts.get(status) + 1);
    else unknown++;
  }
  return { counts, unknown };
}

function displayed(total, shown) {
  return `표시 ${shown}개 / 전체 ${total}개 (저장 순서, 최대 ${DISPLAY_LIMIT}개).`;
}

/** A deterministic point-in-time document; no scheduling, AI calls or writes. */
export function operatingBriefDocument({
  projects = [], jobs = [], sources = [], memories = [], emergencyStop = false,
  aiConfigured = false, developerWorker = false, generatedAt,
} = {}) {
  const projectList = list(projects), jobList = list(jobs), sourceList = list(sources);
  const activeProjects = projectList.filter(project => project?.status === 'active');
  const jobCounts = countBy(jobList, 'status', JOB_STATES.map(([status]) => status));
  const reading = countBy(sourceList, 'readingStatus', READING_STATES);
  const decisions = countBy(sourceList, 'decision', DECISIONS);
  const first = activeProjects[0];
  const nextAction = plain(first?.nextAction, 400, '다음 작업 미등록');
  const rows = [
    '# YENO 운영 브리핑', '',
    `생성 시각: ${plain(generatedAt, 64)}`,
    '저장된 상태를 생성 시점에 정리한 문서입니다. 이후 상태는 앱에서 새로 확인하세요.',
    '이 문서를 만들면서 프로젝트 실행·백그라운드 AI 시작·코드 수정·배포를 수행하지 않았습니다.', '',
    '## 먼저 확인할 한 가지',
  ];
  if (emergencyStop === true) {
    rows.push('전체 멈춤이 켜져 있습니다. 소유자가 멈춤을 해제한 뒤 필요한 작업을 개별 재개해야 합니다. 자동으로 해제하거나 재개하지 않습니다.');
  } else if (!first) {
    rows.push('active 상태인 프로젝트가 없습니다. 진행할 프로젝트와 다음 작업을 등록해야 우선 작업을 고를 수 있습니다.');
  } else {
    rows.push(`우선 프로젝트: ${plain(first.name)} (ID: ${plain(first.id, 80)})`,
      `다음 작업: ${nextAction}`,
      '선택 기준: 저장 순서에서 첫 active 프로젝트. 사업 성과나 수익을 평가한 순위가 아닙니다.');
    if (nextAction === '다음 작업 미등록') rows.push('이 프로젝트의 다음 작업을 먼저 등록하세요. 다른 프로젝트의 작업으로 임의 대체하지 않았습니다.');
  }
  rows.push('', '## 실행 가능 범위',
    `- 전체 멈춤: ${emergencyStop === true ? '켜짐' : '꺼짐'}`,
    `- AI 공급자: ${aiConfigured === true ? '설정 있음. 실제 호출 성공과 비용 한도 검증은 이 문서에서 확인하지 않았습니다.' : '미설정. AI가 필요한 실행은 연결과 비용 한도 확인 전까지 대기합니다.'}`,
    `- 개발 작업자: ${developerWorker === true ? '연결 표시 있음. 이번 문서 생성에서 실제 코드 수정·빌드를 실행하거나 검증하지 않았습니다.' : '미연결. 자동 코드 수정·빌드 실행은 작업자 연결 전까지 대기합니다.'}`,
    '- AI 설정과 개발 작업자 연결은 별개이며, 일반 자율 실행이나 운영 배포 완료를 뜻하지 않습니다.', '',
    '## 저장된 작업 현황',
    `전체 ${jobList.length}개. 완료 수는 현재 보관 중인 기록의 상태 집계이며 오늘 완료한 수가 아닙니다.`, '',
    '| 상태 | 개수 |', '| --- | ---: |',
    ...JOB_STATES.map(([status, label]) => `| ${label} (${status}) | ${jobCounts.counts.get(status)} |`),
    ...(jobCounts.unknown ? [`| 미분류 | ${jobCounts.unknown} |`] : []), '',
    displayed(jobList.length, Math.min(jobList.length, DISPLAY_LIMIT)), '',
    '| 작업 | ID | 상태 | 마지막 수정 | 결과 파일 수 |', '| --- | --- | --- | --- | ---: |',
    ...jobList.slice(0, DISPLAY_LIMIT).map(job => {
      const status = JOB_STATES.find(([value]) => value === job?.status)?.[1] ?? '미분류';
      return `| ${plain(job?.title)} | ${plain(job?.id, 80)} | ${status} | ${plain(job?.updatedAt, 40)} | ${list(job?.artifacts).length} |`;
    }),
    ...(jobList.length ? [] : ['저장된 작업이 없습니다.']), '',
    '## 진행 프로젝트',
    `active 상태 ${activeProjects.length}개 / 등록 전체 ${projectList.length}개. 프로젝트 관리 상태이며 서버 가동이나 실제 개발 착수 여부는 아닙니다.`,
    displayed(activeProjects.length, Math.min(activeProjects.length, DISPLAY_LIMIT)), '',
    '| 프로젝트 | ID | 다음 작업 | 마지막 수정 |', '| --- | --- | --- | --- |',
    ...activeProjects.slice(0, DISPLAY_LIMIT).map(project =>
      `| ${plain(project.name)} | ${plain(project.id, 80)} | ${plain(project.nextAction, 240, '다음 작업 미등록')} | ${plain(project.updatedAt, 40)} |`),
    ...(activeProjects.length ? [] : ['진행 프로젝트가 없습니다.']), '',
    '## 자료와 기억',
    `- 등록 자료: ${sourceList.length}개. 본문은 이 브리핑에 복사하지 않았습니다.`,
    `- 읽기 상태: ${READING_STATES.map(status => `${status} ${reading.counts.get(status)}개`).join(' · ')}${reading.unknown ? ` · 미분류 ${reading.unknown}개` : ''}.`,
    `- 검토 결정: ${DECISIONS.map(status => `${status} ${decisions.counts.get(status)}개`).join(' · ')}${decisions.unknown ? ` · 미분류 ${decisions.unknown}개` : ''}.`,
    '- 읽기·검토 상태는 저장된 검토 기록입니다. candidate는 구현·검사 통과·배포·실제 사용 확인과 다릅니다.',
    `- 저장된 기억: ${list(memories).length}개. 기억 본문은 출력하지 않았습니다.`, '',
    '작업 입력·초안·오류 본문·결과 파일 내용·기기 인증 정보는 출력 대상에서 제외했습니다.',
    '표의 긴 항목은 일부만 표시합니다. 원본 기록은 변경하지 않았습니다.', '',
  );
  return rows.join('\n');
}
