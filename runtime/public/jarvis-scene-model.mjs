export const DRIVE_COLOR = Object.freeze({
  greed:'#c98500',gluttony:'#3987e5',envy:'#199e70',pride:'#9085e9',
  lust:'#d55181',wrath:'#e66767',sloth:'#d95926',
});

export const ACTIVITY_KO = Object.freeze({idle:'대기 중',planning:'분석 중',executing:'실행 중',verifying:'검증 중',waiting_owner:'승인 대기 중',paused:'일시 정지',stopped:'정지'});
export const PUBLIC_BRAND_NAME='BLACKHOLE';
const SCENE_NOTICE=Object.freeze([
  {prefix:'욕망 정산 ·',label:'정산'},
  {prefix:'욕망 막힘 ·',label:'욕망'},
  {prefix:'[시스템]',label:'그림자'},
  {prefix:'일어나라',label:'그림자'},
  {prefix:'흡입!',label:'커비'},
  {prefix:'카피!',label:'커비'},
  {prefix:'별이 튕겨나왔습니다.',label:'커비'},
]);
export function sceneMoments(notices){
  if(!Array.isArray(notices))return [];
  return notices.flatMap(value=>{
    if(typeof value!=='string'||value.length>280)return [];
    const type=SCENE_NOTICE.find(entry=>value.startsWith(entry.prefix));
    return type?[{label:type.label,text:value}]:[];
  }).slice(-3);
}
const DRIVE_IDS = Object.freeze(Object.keys(DRIVE_COLOR));

export function normalizeJarvisAddress(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)) throw new TypeError('호칭은 제어문자 없이 1~32자로 입력해 주십시오.');
  const address = value.normalize('NFC').trim();
  if (!address || Array.from(address).length > 32) throw new TypeError('호칭은 제어문자 없이 1~32자로 입력해 주십시오.');
  return address;
}

function validHunger(hunger) {
  return hunger && typeof hunger === 'object' && !Array.isArray(hunger) && Object.keys(hunger).length === 7 && DRIVE_IDS.every(id => Number.isFinite(hunger[id]) && hunger[id] >= 0 && hunger[id] <= 100);
}

function idleEvidence(core, measured) {
  if (core?.activity !== 'idle' || core.pendingApprovalCount > 0 || !Array.isArray(measured?.lastDebate) || measured.lastDebate.length !== 3 || !Array.isArray(measured.drives) || measured.drives.length !== 7 || !validHunger(measured.hunger)) return null;
  if (new Set(measured.drives.map(drive => drive.driveId)).size !== 7 || !measured.drives.every(drive => DRIVE_IDS.includes(drive.driveId))) return null;
  const hungriest = measured.drives.reduce((best, drive) => !best || measured.hunger[drive.driveId] > measured.hunger[best.driveId] ? drive : best, null);
  return measured.hunger[hungriest.driveId] > 50 && measured.hungryVoice?.driveId === hungriest.driveId && typeof measured.hungryVoice.text === 'string' && measured.hungryVoice.text.trim() ? hungriest : null;
}

export function measuredDriveTint(drives, dominantDriveId, neutral) {
  const measured = Array.isArray(drives) ? drives.find(drive=>drive.driveId===dominantDriveId) : null;
  return typeof measured?.pressure==='number' && Number.isFinite(measured.pressure) && measured.pressure>0
    ? DRIVE_COLOR[dominantDriveId] || neutral : neutral;
}

export function heartbeatChanged(previous, next) {
  return previous !== null && typeof next === 'string' && next.length > 0 && next !== previous;
}

export function composeFromCore(core, address = '주인님') {
  if (core.activity === 'waiting_owner' || core.pendingApprovalCount > 0) return `${address}, 승인할 작업이 있습니다. 검토하실 때까지 대기하겠습니다.`;
  const target = core.missionGoal || core.focusProjectName;
  if (target && ['planning','executing','verifying'].includes(core.activity)) return `「${target}」 — ${ACTIVITY_KO[core.activity]}입니다.`;
  if (core.activity === 'paused') return '작업을 일시 정지했습니다. 재개 요청을 기다리겠습니다.';
  if (core.activity === 'stopped') return '작업이 정지되었습니다. 소유자의 지시를 기다리겠습니다.';
  if (core.activity === 'idle') return `${address}, 대기 중입니다. 조용하다고 자리를 비운 것은 아닙니다.`;
  return `${address}, 상태를 확인하고 있습니다.`;
}

export function idleDriveSpeech(core, measured) {
  if (!idleEvidence(core, measured)) return null;
  const [push, contest] = measured.lastDebate;
  if (typeof push?.text !== 'string' || typeof contest?.text !== 'string' || !push.text.startsWith('[push] ') || !contest.text.startsWith('[contest] ') || push.driveId === contest.driveId) return null;
  return `추진 의견: 「${push.text.slice(7)}」\n반대 의견: 「${contest.text.slice(10)}」`;
}

export function anticipationSpeech(core, measured, state = {}, address = '주인님') {
  if (state.emergencyStop) return null;
  const drive = idleEvidence(core, measured);
  if (!drive) return null;
  const label = drive.legacyName || drive.label;
  if (typeof label !== 'string' || !label.trim()) return null;
  const evidence = [`배고픔 ${measured.hunger[drive.driveId]}/100`];
  const total = state.shadowArmy?.roster?.total;
  if (Number.isInteger(total) && total >= 0) evidence.push(`명부 ${total}명`);
  if (Array.isArray(state.events)) evidence.push(`운영 기록 ${state.events.length}건`);
  return `${address}, 곧 ${label}의 움직임이 커질 것 같습니다 — ${evidence.join(' · ')}. 기록에 따른 예상입니다.`;
}

export function hungerCurveModel(measured) {
  const history = Array.isArray(measured?.history) ? measured.history : [];
  const samples = history.flatMap((entry, index) => [2,3].includes(entry?.version) && validHunger(entry.hungerSnapshot) && Number.isFinite(Date.parse(entry.at))
    ? [{index, at:entry.at, time:Date.parse(entry.at), hunger:{...entry.hungerSnapshot}}] : []);
  return {samples, missingCount:history.length - samples.length, drives:DRIVE_IDS.map(driveId => {
    const drive = measured?.drives?.find(entry => entry.driveId === driveId);
    return {driveId, label:drive?.legacyName || drive?.label || driveId, worldName:drive?.worldName || null,
      current:validHunger(measured?.hunger) ? measured.hunger[driveId] : null};
  })};
}

export function artifactPlainText(value) {
  const plain=String(value??'').replace(/^\s{0,3}#{1,6}\s*/gm,'').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1').trim();
  const characters=Array.from(plain);
  return characters.length>120?characters.slice(0,120).join('')+'…':plain;
}

export function resultSpeech(job, artifact, address = '주인님') {
  if (job?.type === 'document') {
    const title = Array.from(String(job.title ?? '').replace(/^문서\s*[:：]\s*/, '').trim()).slice(0, 54).join('');
    return `문서를 완성했습니다, ${address}.${title ? ` 「${title}」.` : ''} 전체 결과에 올려두었습니다.`;
  }
  const excerpt = artifactPlainText(artifact);
  return `결과를 준비했습니다, ${address}.${excerpt ? ` 「${excerpt}」` : ''}`;
}

const FAILURE_REASON=Object.freeze({
  timeout:'응답 대기 시간을 초과했습니다',
  empty_model_response:'모델이 빈 응답을 반환했습니다',
  context_limit:'입력 길이 제한을 초과했습니다',
  http_401:'모델 인증에 실패했습니다',
  http_403:'모델 접근이 거부되었습니다',
  http_429:'모델 호출 제한에 도달했습니다',
  http_500:'모델 서버에서 오류가 발생했습니다',
  request_failed_or_stopped:'요청이 중단되었습니다',
  research_tools_disabled:'이 작업에서는 도구 사용이 허용되지 않습니다',
  invalid_json:'모델 응답 형식이 올바르지 않습니다',
  mission_call_limit:'작업의 호출 한도에 도달했습니다',
  dependency_failed:'앞 단계가 실패했습니다',
  cancelled:'작업이 취소되었습니다',
  stopped:'작업이 중단되었습니다',
});
export function failureCode(code) {
  return String(code??'').replace(/^Agent:\s*/,'').split(/\s+/,1)[0];
}
export function failureSpeech(code) {
  const key=failureCode(code).replace(/^http_5\d\d$/,'http_500');
  return `완료하지 못했습니다. 원인: ${FAILURE_REASON[key]??'아직 확인하지 못했습니다'}. 숨기지 않겠습니다.`;
}

export function workCommandText(input) {
  const text=String(input??'').trim();
  // Explicit local commands keep the server's no-model route. Free text remains a goal.
  const passthrough=/^(자동\s*운영\s*(시작|중지|현황)|목표\s*현황|일곱\s*욕망|성과\s*장부|봇\s*현황|세계\s*현황|목표\s*(저장|실행)\s*[:：]|연구\s*[:：]|교차\s*검토\s*[:：]|운영\s*(브리핑|현황)$|(?:문서\s*만들어|document)\s*[:：]|(?:진단해|diagnose|개선점\s*찾아줘|evolve)$)/i.test(text);
  return passthrough?text:`목표: ${text}`;
}

function latestReportableJob(jobs) {
  if (!Array.isArray(jobs)) return null;
  const candidates = jobs.filter(job => job && (['failed','cancelled','stopped'].includes(job.status) || job.status === 'completed' && job.artifacts?.length));
  const recordedTime = job => Date.parse(job.updatedAt || job.createdAt || '') || 0;
  return candidates.sort((a,b) => recordedTime(b) - recordedTime(a))[0] || null;
}

export function resultJobToShow(jobs, spokenIds, firstTick=false) {
  const latest = latestReportableJob(jobs);
  return latest?.status === 'completed' && (firstTick || !spokenIds.has(latest.id)) ? latest : null;
}

export function failureJobToShow(jobs, spokenIds, firstTick=false) {
  const latest = latestReportableJob(jobs);
  return latest && latest.status !== 'completed' && (firstTick || !spokenIds.has(latest.id)) ? latest : null;
}

const plainInline=text=>text.replace(/\*\*([^*]+)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1');

export function parseArtifactBlocks(source) {
  const blocks=[],paragraph=[],list=[];
  let code=null;
  const flushParagraph=()=>{if(paragraph.length)blocks.push({type:'paragraph',text:paragraph.splice(0).join('\n')});};
  const flushList=()=>{if(list.length)blocks.push({type:'list',items:list.splice(0)});};
  for(const line of String(source??'').replace(/\r\n?/g,'\n').split('\n')) {
    if(/^ {0,3}```/.test(line)) {
      if(code!==null){blocks.push({type:'code',text:code.join('\n')});code=null;}
      else {flushParagraph();flushList();code=[];}
      continue;
    }
    if(code!==null){code.push(line);continue;}
    if(!line.trim()){flushParagraph();flushList();continue;}
    const heading=/^ {0,3}(#{1,6})[ \t]+(.+)$/.exec(line);
    if(heading){flushParagraph();flushList();blocks.push({type:'heading',level:heading[1].length,text:plainInline(heading[2].trim())});continue;}
    if(/^ {0,3}(?:-{3,}|\*{3,})\s*$/.test(line)){flushParagraph();flushList();blocks.push({type:'rule'});continue;}
    const item=/^ {0,3}[-*+]\s+(.+)$/.exec(line);
    if(item){flushParagraph();list.push(plainInline(item[1].trim()));continue;}
    flushList();paragraph.push(plainInline(line.trim()));
  }
  flushParagraph();flushList();
  if(code!==null)blocks.push({type:'code',text:code.join('\n')});
  return blocks;
}

export function renderArtifactDocument(container, source) {
  const doc=container.ownerDocument;
  container.replaceChildren();
  for(const block of parseArtifactBlocks(source)) {
    let element;
    if(block.type==='heading') element=doc.createElement(`h${Math.min(block.level+2,6)}`);
    else if(block.type==='list') {
      element=doc.createElement('ul');
      for(const item of block.items){const li=doc.createElement('li');li.textContent=item;element.append(li);}
    } else if(block.type==='code') {
      element=doc.createElement('pre');
      const code=doc.createElement('code');code.textContent=block.text;element.append(code);
    } else element=doc.createElement(block.type==='rule'?'hr':'p');
    if(block.text!==undefined&&block.type!=='code')element.textContent=block.text;
    container.append(element);
  }
}
